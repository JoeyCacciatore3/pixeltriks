/* PixelTriks — timeline-ui.js
   Canvas-rendered animation timeline strip at the bottom of the stage.
   Shows playhead, object track rows with diamond keyframe markers,
   play/pause/stop controls. Theatre.js-inspired UX. */
'use strict';
window.GF = window.GF || {};

GF.timelineUI = (function () {
  const $ = s => document.querySelector(s);
  const A = () => GF.animation;

  let canvas = null, ctx = null;
  let expanded = false;
  const COLLAPSED_H = 36;
  const EXPANDED_H = 160;
  const TRACK_H = 24;

  function build() {
    const host = $('#timeline');
    if (!host) return;
    host.innerHTML = `
      <div class="tl-bar">
        <button class="icon-btn sm" id="tl-play" title="Play">▶</button>
        <button class="icon-btn sm" id="tl-stop" title="Stop">⏹</button>
        <button class="icon-btn sm" id="tl-record" title="Record keyframe at current time">◆</button>
        <span class="tl-time" id="tl-time">0:00</span>
        <span class="tl-sep">/</span>
        <span class="tl-time" id="tl-dur">2:00</span>
        <button class="icon-btn sm" id="tl-loop" title="Loop mode">🔄</button>
        <span style="flex:1"></span>
        <button class="icon-btn sm" id="tl-expand" title="Expand timeline">▼</button>
      </div>
      <canvas id="tl-canvas" height="${EXPANDED_H}"></canvas>
    `;
    canvas = $('#tl-canvas');
    ctx = canvas.getContext('2d');
    wire();
    setExpanded(false);
    A().onChange(render);
    render();
  }

  function wire() {
    $('#tl-play').addEventListener('click', () => { A().isPlaying() ? A().pause() : A().play(); });
    $('#tl-stop').addEventListener('click', () => A().stop());
    $('#tl-record').addEventListener('click', () => {
      const sel = GF.scene3d ? GF.scene3d.selectedId() : null;
      if (sel != null) A().recordKeyframe(sel);
      else GF.util.toast('Select an object first');
    });
    $('#tl-expand').addEventListener('click', () => setExpanded(!expanded));
    $('#tl-loop').addEventListener('click', () => {
      const modes = ['loop', 'once', 'pingpong'];
      const cur = modes.indexOf(A().getLoop());
      A().setLoop(modes[(cur + 1) % modes.length]);
      render();
    });

    canvas.addEventListener('pointerdown', e => {
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const t = (x / rect.width) * A().getDuration();
      A().setTime(t);
    });
  }

  function setExpanded(v) {
    expanded = v;
    const host = $('#timeline');
    if (!host) return;
    host.style.height = expanded ? (COLLAPSED_H + EXPANDED_H) + 'px' : COLLAPSED_H + 'px';
    canvas.style.display = expanded ? 'block' : 'none';
    const btn = $('#tl-expand');
    if (btn) btn.textContent = expanded ? '▲' : '▼';
  }

  function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return m + ':' + String(sec).padStart(2, '0') + (expanded ? '.' + String(ms).padStart(2, '0') : '');
  }

  function render() {
    const timeEl = $('#tl-time');
    const durEl = $('#tl-dur');
    const playBtn = $('#tl-play');
    if (timeEl) timeEl.textContent = formatTime(A().getTime());
    if (durEl) durEl.textContent = formatTime(A().getDuration());
    if (playBtn) playBtn.textContent = A().isPlaying() ? '⏸' : '▶';

    if (!expanded || !canvas || !ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth;
    const h = EXPANDED_H;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const dur = A().getDuration();
    const t = A().getTime();

    // background
    ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--bg-2').trim() || '#15171d';
    ctx.fillRect(0, 0, w, h);

    // time ruler
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--line').trim() || '#2c313b';
    ctx.lineWidth = 1;
    const step = dur <= 5 ? 0.5 : dur <= 20 ? 1 : 5;
    for (let s = 0; s <= dur; s += step) {
      const x = (s / dur) * w;
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, h); ctx.stroke();
    }

    // tracks
    const objects = GF.scene3d ? GF.scene3d.listObjects() : [];
    const kfs = A().getKeyframes();
    ctx.font = '11px Inter, sans-serif';
    objects.forEach((obj, i) => {
      const y = 20 + i * TRACK_H;
      if (y > h - 10) return;

      // label
      ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--ink-3').trim() || '#79808d';
      ctx.fillText(obj.name, 4, y + 14);

      // keyframe diamonds
      const objKfs = kfs.filter(k => k.objectId === obj.id);
      objKfs.forEach(k => {
        const x = (k.time / dur) * w;
        ctx.fillStyle = obj.selected
          ? (getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8a33d')
          : (getComputedStyle(document.documentElement).getPropertyValue('--ink-2').trim() || '#aeb6c4');
        ctx.beginPath();
        ctx.moveTo(x, y + 6); ctx.lineTo(x + 5, y + 12); ctx.lineTo(x, y + 18); ctx.lineTo(x - 5, y + 12);
        ctx.closePath(); ctx.fill();
      });

      // track line
      ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--line-soft').trim() || '#23272f';
      ctx.beginPath(); ctx.moveTo(0, y + 12); ctx.lineTo(w, y + 12); ctx.stroke();
    });

    // playhead
    const px = (t / dur) * w;
    ctx.strokeStyle = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '#e8a33d';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 0); ctx.lineTo(px, h); ctx.stroke();

    // playhead triangle
    ctx.fillStyle = ctx.strokeStyle;
    ctx.beginPath(); ctx.moveTo(px - 6, 0); ctx.lineTo(px + 6, 0); ctx.lineTo(px, 8); ctx.closePath(); ctx.fill();
  }

  // Build on DOM ready
  if (typeof window !== 'undefined') {
    const go = () => { if ($('#timeline')) build(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }

  return { build, render, setExpanded };
})();
