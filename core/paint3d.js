/* PixelTriks — paint3d.js
   UV-raycasting texture paint mode (GF.paint3d). Paint directly onto 3D
   objects through the viewport. Raycasts pointer events to UV coordinates,
   writes to a per-object canvas texture. Supports brush size, color, opacity,
   and multi-channel painting (color + roughness). */
'use strict';
window.GF = window.GF || {};

GF.paint3d = (function () {
  const U = GF.util;
  const S = () => GF.scene3d;

  let active = false;
  let targetId = null;
  let paintCanvas = null;
  let paintCtx = null;
  let roughCanvas = null;
  let roughCtx = null;
  let colorKey = null;
  let roughKey = null;
  const TEX_SIZE = 1024;

  let brush = { color: '#e8a33d', size: 24, opacity: 1, roughness: -1, channel: 'color' };
  let painting = false;
  let lastUV = null;
  let strokeSnapshot = null;

  function isActive() { return active; }

  function enter(objectId) {
    if (!S()) return false;
    const id = objectId != null ? objectId : S().selectedId();
    if (id == null) { U.toast('Select an object first'); return false; }
    targetId = id;
    active = true;

    if (!paintCanvas) {
      paintCanvas = U.makeCanvas(TEX_SIZE, TEX_SIZE);
      paintCtx = U.ctx2d(paintCanvas);
      paintCtx.fillStyle = '#ffffff';
      paintCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    }
    if (!roughCanvas) {
      roughCanvas = U.makeCanvas(TEX_SIZE, TEX_SIZE);
      roughCtx = U.ctx2d(roughCanvas);
      roughCtx.fillStyle = '#b3b3b3';
      roughCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    }

    colorKey = S().addImageSource(paintCanvas, 'paint-color');
    roughKey = S().addImageSource(roughCanvas, 'paint-rough');
    S().setMaterial(targetId, { mapSource: colorKey, roughSource: roughKey, roughness: 1 });

    S().setInteract('orbit');
    U.toast('Paint mode — draw on the 3D object');
    emit();
    return true;
  }

  function exit() {
    active = false;
    painting = false;
    targetId = null;
    lastUV = null;
    emit();
  }

  function setBrush(patch) {
    if (patch.color !== undefined) brush.color = patch.color;
    if (patch.size !== undefined) brush.size = Math.max(1, Math.min(200, patch.size));
    if (patch.opacity !== undefined) brush.opacity = Math.max(0, Math.min(1, patch.opacity));
    if (patch.roughness !== undefined) brush.roughness = patch.roughness;
    if (patch.channel !== undefined) brush.channel = patch.channel;
  }
  function getBrush() { return Object.assign({}, brush); }

  function onPointerDown(e) {
    if (!active || !S()) return false;
    const hit = S().raycastUV(e.clientX, e.clientY);
    if (!hit || hit.objectId !== targetId) return false;

    painting = true;
    strokeSnapshot = paintCtx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    lastUV = hit.uv;
    stamp(hit.uv);
    S().refreshAll();
    return true;
  }

  function onPointerMove(e) {
    if (!painting || !active || !S()) return false;
    const hit = S().raycastUV(e.clientX, e.clientY);
    if (!hit || hit.objectId !== targetId) return false;

    if (lastUV) interpolateStamps(lastUV, hit.uv);
    else stamp(hit.uv);
    lastUV = hit.uv;
    S().refreshAll();
    return true;
  }

  function onPointerUp() {
    if (!painting) return false;
    painting = false;
    lastUV = null;
    if (strokeSnapshot && S()) {
      const before = strokeSnapshot;
      const after = paintCtx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
      S().hist.push('paint 3D',
        () => { paintCtx.putImageData(before, 0, 0); S().refreshAll(); },
        () => { paintCtx.putImageData(after, 0, 0); S().refreshAll(); });
    }
    strokeSnapshot = null;
    return true;
  }

  function stamp(uv) {
    const px = uv.x * TEX_SIZE;
    const py = (1 - uv.y) * TEX_SIZE;
    const r = brush.size / 2;

    if (brush.channel !== 'roughness') {
      paintCtx.globalAlpha = brush.opacity;
      paintCtx.fillStyle = brush.color;
      paintCtx.beginPath();
      paintCtx.arc(px, py, r, 0, Math.PI * 2);
      paintCtx.fill();
      paintCtx.globalAlpha = 1;
    }

    if (brush.roughness >= 0 || brush.channel === 'roughness') {
      const rv = brush.roughness >= 0 ? brush.roughness : 0.5;
      const gray = Math.round(rv * 255);
      roughCtx.globalAlpha = brush.opacity;
      roughCtx.fillStyle = `rgb(${gray},${gray},${gray})`;
      roughCtx.beginPath();
      roughCtx.arc(px, py, r, 0, Math.PI * 2);
      roughCtx.fill();
      roughCtx.globalAlpha = 1;
    }
  }

  function interpolateStamps(a, b) {
    const dx = (b.x - a.x) * TEX_SIZE;
    const dy = (b.y - a.y) * TEX_SIZE;
    const dist = Math.sqrt(dx * dx + dy * dy);
    const spacing = Math.max(2, brush.size * 0.25);
    const steps = Math.ceil(dist / spacing);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      stamp({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }

  function clear() {
    if (!paintCanvas) return;
    const before = paintCtx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
    paintCtx.fillStyle = '#ffffff';
    paintCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    roughCtx.fillStyle = '#b3b3b3';
    roughCtx.fillRect(0, 0, TEX_SIZE, TEX_SIZE);
    if (S()) {
      S().refreshAll();
      const after = paintCtx.getImageData(0, 0, TEX_SIZE, TEX_SIZE);
      S().hist.push('clear paint',
        () => { paintCtx.putImageData(before, 0, 0); S().refreshAll(); },
        () => { paintCtx.putImageData(after, 0, 0); S().refreshAll(); });
    }
  }

  function getCanvas() { return paintCanvas; }
  function getRoughCanvas() { return roughCanvas; }

  let changeCbs = [];
  function onChange(fn) { changeCbs.push(fn); }
  function emit() { changeCbs.forEach(fn => { try { fn(); } catch (e) {} }); }

  return {
    enter, exit, isActive, setBrush, getBrush,
    onPointerDown, onPointerMove, onPointerUp,
    clear, getCanvas, getRoughCanvas, onChange
  };
})();

if (GF.api && GF.api.register) {
  GF.api.register('paint3d.enter', 'objectId?', 'Enter 3D paint mode on the selected object', a => GF.paint3d.enter(a && a.objectId));
  GF.api.register('paint3d.exit', '', 'Exit 3D paint mode', () => GF.paint3d.exit());
  GF.api.register('paint3d.setBrush', 'color?, size?(1-200), opacity?(0-1), roughness?(-1 to 1)', 'Set 3D paint brush properties', a => GF.paint3d.setBrush(a || {}));
  GF.api.register('paint3d.clear', '', 'Clear the 3D paint canvas', () => GF.paint3d.clear());
}
