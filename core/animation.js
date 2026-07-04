/* PixelTriks — animation.js
   Basic keyframe animation engine (GF.animation). Wraps Three.js
   AnimationMixer + KeyframeTrack for object-level position/rotation/scale
   animation. Timeline UI reads from this; GLTFExporter gets clips from
   getClips(). */
'use strict';
window.GF = window.GF || {};

GF.animation = (function () {
  const U = GF.util;

  let duration = 2;       // seconds
  let currentTime = 0;
  let playing = false;
  let loopMode = 'loop';  // 'once' | 'loop' | 'pingpong'
  let rafId = null;
  let lastTick = 0;

  /* keyframes: array of { id, objectId, time, property, value }
     property: 'position' | 'rotation' | 'scale' | 'opacity'
     value: [x,y,z] for vec3, number for opacity */
  const keyframes = [];
  let nextKfId = 1;

  /* imported clips from GLB files */
  const importedClips = [];

  let changeCbs = [];
  function onChange(fn) { changeCbs.push(fn); }
  function emit() { changeCbs.forEach(fn => { try { fn(); } catch (e) {} }); }

  function setDuration(s) { duration = Math.max(0.1, s); emit(); }
  function getDuration() { return duration; }
  function setTime(t) { currentTime = Math.max(0, Math.min(t, duration)); applyAtTime(currentTime); emit(); }
  function getTime() { return currentTime; }
  function setLoop(mode) { loopMode = mode; }
  function getLoop() { return loopMode; }

  function play() {
    if (playing) return;
    playing = true;
    lastTick = performance.now();
    tick();
    emit();
  }
  function pause() { playing = false; if (rafId) { cancelAnimationFrame(rafId); rafId = null; } emit(); }
  function stop() { pause(); currentTime = 0; applyAtTime(0); emit(); }

  function tick() {
    if (!playing) return;
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    currentTime += dt;

    if (currentTime >= duration) {
      if (loopMode === 'loop') { currentTime = currentTime % duration; }
      else if (loopMode === 'pingpong') { currentTime = duration - (currentTime - duration); }
      else { currentTime = duration; pause(); }
    }

    applyAtTime(currentTime);
    emit();
    if (playing) rafId = requestAnimationFrame(tick);
  }

  function addKeyframe(objectId, time, property, value) {
    const id = nextKfId++;
    keyframes.push({ id, objectId, time: Math.max(0, Math.min(time, duration)), property, value });
    keyframes.sort((a, b) => a.time - b.time);
    emit();
    return id;
  }

  function removeKeyframe(id) {
    const i = keyframes.findIndex(k => k.id === id);
    if (i >= 0) { keyframes.splice(i, 1); emit(); }
  }

  function getKeyframes(objectId) {
    return objectId ? keyframes.filter(k => k.objectId === objectId) : keyframes.slice();
  }

  function applyAtTime(t) {
    if (!GF.scene3d) return;
    const objects = GF.scene3d.listObjects();
    const grouped = {};
    keyframes.forEach(k => {
      const key = k.objectId + '.' + k.property;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(k);
    });

    for (const key in grouped) {
      const kfs = grouped[key];
      if (kfs.length === 0) continue;
      const objId = kfs[0].objectId;
      const prop = kfs[0].property;
      const o = GF.scene3d.getObject(objId);
      if (!o) continue;

      const val = interpolate(kfs, t);
      if (!val) continue;

      const patch = {};
      if (prop === 'position') { patch.px = val[0]; patch.py = val[1]; patch.pz = val[2]; }
      else if (prop === 'rotation') { patch.rx = val[0]; patch.ry = val[1]; patch.rz = val[2]; }
      else if (prop === 'scale') { patch.sx = val[0]; patch.sy = val[1]; patch.sz = val[2]; }

      if (Object.keys(patch).length) {
        const node = GF.scene3d.byId(objId);
        if (node && node.node) {
          if (patch.px !== undefined) node.node.position.set(patch.px, patch.py, patch.pz);
          if (patch.rx !== undefined) node.node.rotation.set(patch.rx * Math.PI / 180, patch.ry * Math.PI / 180, patch.rz * Math.PI / 180);
          if (patch.sx !== undefined) node.node.scale.set(patch.sx, patch.sy, patch.sz);
        }
      }
    }
  }

  function interpolate(kfs, t) {
    if (kfs.length === 0) return null;
    if (kfs.length === 1) return kfs[0].value;
    if (t <= kfs[0].time) return kfs[0].value;
    if (t >= kfs[kfs.length - 1].time) return kfs[kfs.length - 1].value;

    let a = kfs[0], b = kfs[1];
    for (let i = 1; i < kfs.length; i++) {
      if (kfs[i].time >= t) { a = kfs[i - 1]; b = kfs[i]; break; }
    }

    const f = (t - a.time) / Math.max(0.001, b.time - a.time);
    if (Array.isArray(a.value)) {
      return a.value.map((v, i) => v + (b.value[i] - v) * f);
    }
    return a.value + (b.value - a.value) * f;
  }

  function importClips(clips) {
    if (!clips || !clips.length) return;
    clips.forEach(c => importedClips.push(c));
    if (clips[0] && clips[0].duration) duration = Math.max(duration, clips[0].duration);
    emit();
  }

  function getClips() {
    if (!window.__THREE_BUNDLE) return importedClips.slice();
    const THREE = window.__THREE_BUNDLE.THREE;
    const tracks = [];
    const grouped = {};

    keyframes.forEach(k => {
      const key = k.objectId + '.' + k.property;
      if (!grouped[key]) grouped[key] = { objectId: k.objectId, property: k.property, times: [], values: [] };
      grouped[key].times.push(k.time);
      if (Array.isArray(k.value)) k.value.forEach(v => grouped[key].values.push(v));
      else grouped[key].values.push(k.value);
    });

    for (const key in grouped) {
      const g = grouped[key];
      const o = GF.scene3d ? GF.scene3d.byId(g.objectId) : null;
      const name = o ? o.name.replace(/\s+/g, '_') : 'Object_' + g.objectId;
      let propPath = '.position';
      if (g.property === 'rotation') propPath = '.rotation';
      else if (g.property === 'scale') propPath = '.scale';

      tracks.push(new THREE.NumberKeyframeTrack(
        name + propPath, new Float32Array(g.times), new Float32Array(g.values)
      ));
    }

    const custom = tracks.length ? [new THREE.AnimationClip('animation', duration, tracks)] : [];
    return [...importedClips, ...custom];
  }

  function hasAnimation() { return keyframes.length > 0 || importedClips.length > 0; }

  function recordKeyframe(objectId) {
    const o = GF.scene3d ? GF.scene3d.getObject(objectId) : null;
    if (!o) return;
    addKeyframe(objectId, currentTime, 'position', [o.px, o.py, o.pz]);
    addKeyframe(objectId, currentTime, 'rotation', [o.rx, o.ry, o.rz]);
    addKeyframe(objectId, currentTime, 'scale', [o.sx, o.sy, o.sz]);
    U.toast('Keyframe recorded at ' + currentTime.toFixed(2) + 's');
  }

  return {
    setDuration, getDuration, setTime, getTime, setLoop, getLoop,
    play, pause, stop, isPlaying: () => playing,
    addKeyframe, removeKeyframe, getKeyframes, recordKeyframe,
    importClips, getClips, hasAnimation,
    onChange, emit
  };
})();

if (GF.api && GF.api.register) {
  GF.api.register('animation.play', '', 'Play the animation', () => GF.animation.play());
  GF.api.register('animation.pause', '', 'Pause the animation', () => GF.animation.pause());
  GF.api.register('animation.stop', '', 'Stop and rewind', () => GF.animation.stop());
  GF.api.register('animation.setTime', 'time(seconds)', 'Scrub to a specific time', a => GF.animation.setTime(a.time || 0));
  GF.api.register('animation.setDuration', 'seconds', 'Set animation duration', a => GF.animation.setDuration(a.seconds || 2));
  GF.api.register('animation.recordKeyframe', 'objectId', 'Record position/rotation/scale at current time', a => GF.animation.recordKeyframe(a.objectId));
  GF.api.register('animation.addKeyframe', 'objectId, time, property("position"|"rotation"|"scale"), value([x,y,z])', 'Add a keyframe', a => GF.animation.addKeyframe(a.objectId, a.time, a.property, a.value));
  GF.api.register('animation.getKeyframes', 'objectId?', 'List keyframes', a => GF.animation.getKeyframes(a && a.objectId));
}
