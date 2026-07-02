/* Forge Studio (Sprite) — application layer.
   Depends on js/core.js (PixelForgeCore). Classic script, no build step. */
(function () {
'use strict';
const C = window.PixelForgeCore;

/* ============ DOM HELPERS ============ */
const $ = id => document.getElementById(id);
const on = (el, ev, fn) => el.addEventListener(ev, fn);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function toast(msg, bad) {
  const t = document.createElement('div');
  t.className = 'toast' + (bad ? ' bad' : '');
  t.textContent = msg;
  $('toasts').appendChild(t);
  setTimeout(() => { t.classList.add('out'); setTimeout(() => t.remove(), 350); }, 2600);
}

function download(filename, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

/* ============ DEFAULTS ============ */
/* DawnBringer 32 — a proven general-purpose pixel art palette. */
const DB32 = ['#000000','#222034','#45283c','#663931','#8f563b','#df7126','#d9a066','#eec39a',
  '#fbf236','#99e550','#6abe30','#37946e','#4b692f','#524b24','#323c39','#3f3f74',
  '#306082','#5b6ee1','#639bff','#5fcde4','#cbdbfc','#ffffff','#9badb7','#847e87',
  '#696a6a','#595652','#76428a','#ac3232','#d95763','#d77bba','#8f974a','#8a6f30'];

function newProject(name, w, h) {
  return {
    name: name || 'sprite', w, h, fps: 8,
    palette: DB32.map(C.hexToU32),
    frames: [{ duration: 0 }],
    tags: [],
    layers: [{ name: 'Layer 1', visible: true, opacity: 1, blend: 'source-over', cels: [new Uint32Array(w * h)] }]
  };
}

/* ============ STATE ============ */
const S = {
  proj: newProject('sprite', 32, 32),
  frame: 0, layer: 0,
  color: C.hexToU32('#df7126'),
  tool: 'pencil',
  zoom: 12, panX: 0, panY: 0,
  selection: null,            // Uint8Array mask or null
  onion: false, grid: true,
  playing: false, playFrom: 0, playTo: 0, playAcc: 0, lastT: 0,
  undo: [], redo: [],
  drag: null,                 // active pointer gesture
  recolor: null,              // {from} during two-click recolor
  hover: null,
  pendingImage: null          // Image awaiting the import dialog
};
const UNDO_CAP = 64;

/* ============ CEL RENDER CACHE ============ */
const celCache = new WeakMap();
function celCanvas(cel, w, h) {
  let cv = celCache.get(cel);
  if (cv) return cv;
  cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  const img = ctx.createImageData(w, h);
  new Uint32Array(img.data.buffer).set(cel);
  ctx.putImageData(img, 0, 0);
  celCache.set(cel, cv);
  return cv;
}
function touchCel(cel) { celCache.delete(cel); }

function compositeFrame(f, replace) {
  const p = S.proj;
  const cv = document.createElement('canvas');
  cv.width = p.w; cv.height = p.h;
  const ctx = cv.getContext('2d');
  for (let li = 0; li < p.layers.length; li++) {
    const layer = p.layers[li];
    if (!layer.visible) continue;
    let cel = layer.cels[f];
    if (replace && replace.layer === li) cel = replace.data;
    if (!cel) continue;
    ctx.save();
    ctx.globalAlpha = layer.opacity == null ? 1 : layer.opacity;
    ctx.globalCompositeOperation = layer.blend || 'source-over';
    ctx.drawImage(celCanvas(cel, p.w, p.h), 0, 0);
    ctx.restore();
  }
  return cv;
}

/* ============ UNDO ============ */
function activeCel(create) {
  const layer = S.proj.layers[S.layer];
  let cel = layer.cels[S.frame];
  if (!cel && create) {
    cel = new Uint32Array(S.proj.w * S.proj.h);
    layer.cels[S.frame] = cel;
  }
  return cel;
}
function pushUndoCel() {
  const cel = activeCel(true);
  S.undo.push({ type: 'cel', layer: S.layer, frame: S.frame, data: new Uint32Array(cel) });
  if (S.undo.length > UNDO_CAP) S.undo.shift();
  S.redo.length = 0;
}
function pushUndoProj() {
  S.undo.push({ type: 'proj', json: C.serializeProject(S.proj), frame: S.frame, layer: S.layer });
  if (S.undo.length > UNDO_CAP) S.undo.shift();
  S.redo.length = 0;
}
function snapshotFor(entry) {
  if (entry.type === 'cel') {
    const cel = S.proj.layers[entry.layer] && S.proj.layers[entry.layer].cels[entry.frame];
    return { type: 'cel', layer: entry.layer, frame: entry.frame, data: cel ? new Uint32Array(cel) : new Uint32Array(S.proj.w * S.proj.h) };
  }
  return { type: 'proj', json: C.serializeProject(S.proj), frame: S.frame, layer: S.layer };
}
function applyEntry(entry) {
  if (entry.type === 'cel') {
    const layer = S.proj.layers[entry.layer];
    if (!layer) return;
    layer.cels[entry.frame] = new Uint32Array(entry.data);
    S.frame = clamp(entry.frame, 0, S.proj.frames.length - 1);
    S.layer = clamp(entry.layer, 0, S.proj.layers.length - 1);
  } else {
    S.proj = C.deserializeProject(entry.json);
    S.frame = clamp(entry.frame, 0, S.proj.frames.length - 1);
    S.layer = clamp(entry.layer, 0, S.proj.layers.length - 1);
    S.selection = null;
  }
  refreshAll();
}
function doUndo() {
  const e = S.undo.pop();
  if (!e) { toast('Nothing to undo'); return; }
  S.redo.push(snapshotFor(e));
  applyEntry(e);
}
function doRedo() {
  const e = S.redo.pop();
  if (!e) { toast('Nothing to redo'); return; }
  S.undo.push(snapshotFor(e));
  applyEntry(e);
}

/* ============ STAGE RENDERING ============ */
let stage, sctx, checker;
function makeChecker() {
  const cv = document.createElement('canvas');
  cv.width = 16; cv.height = 16;
  const x = cv.getContext('2d');
  x.fillStyle = '#20262e'; x.fillRect(0, 0, 16, 16);
  x.fillStyle = '#262d36'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
  return sctx.createPattern(cv, 'repeat');
}

let selOverlay = null;
function rebuildSelOverlay() {
  if (!S.selection) { selOverlay = null; return; }
  const p = S.proj;
  selOverlay = document.createElement('canvas');
  selOverlay.width = p.w; selOverlay.height = p.h;
  const ctx = selOverlay.getContext('2d');
  const img = ctx.createImageData(p.w, p.h);
  const px = new Uint32Array(img.data.buffer);
  const tint = C.packRGBA(111, 163, 207, 110);
  for (let i = 0; i < S.selection.length; i++) if (S.selection[i]) px[i] = tint;
  ctx.putImageData(img, 0, 0);
}

function fitView() {
  const r = stage.getBoundingClientRect();
  const p = S.proj;
  S.zoom = clamp(Math.floor(Math.min(r.width / p.w, r.height / p.h) * 0.8) || 1, 1, 48);
  S.panX = Math.round((r.width - p.w * S.zoom) / 2);
  S.panY = Math.round((r.height - p.h * S.zoom) / 2);
}

function renderStage() {
  const dpr = window.devicePixelRatio || 1;
  const r = stage.getBoundingClientRect();
  if (stage.width !== Math.round(r.width * dpr) || stage.height !== Math.round(r.height * dpr)) {
    stage.width = Math.round(r.width * dpr);
    stage.height = Math.round(r.height * dpr);
  }
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.imageSmoothingEnabled = false;
  sctx.clearRect(0, 0, r.width, r.height);

  const p = S.proj, z = S.zoom, ox = S.panX, oy = S.panY;
  const spriteW = p.w * z, spriteH = p.h * z;

  if (!checker) checker = makeChecker();
  sctx.fillStyle = checker;
  sctx.fillRect(ox, oy, spriteW, spriteH);

  // Onion skins
  if (S.onion && !S.playing) {
    if (S.frame > 0) {
      sctx.globalAlpha = 0.25;
      sctx.drawImage(compositeFrame(S.frame - 1), ox, oy, spriteW, spriteH);
    }
    if (S.frame < p.frames.length - 1) {
      sctx.globalAlpha = 0.12;
      sctx.drawImage(compositeFrame(S.frame + 1), ox, oy, spriteW, spriteH);
    }
    sctx.globalAlpha = 1;
  }

  // Current frame (with live move-drag preview)
  const drag = S.drag;
  if (drag && drag.mode === 'move') {
    sctx.drawImage(compositeFrame(S.frame, { layer: S.layer, data: drag.remaining }), ox, oy, spriteW, spriteH);
    sctx.drawImage(drag.extractedCanvas, ox + drag.dx * z, oy + drag.dy * z, spriteW, spriteH);
  } else {
    sctx.drawImage(compositeFrame(S.frame), ox, oy, spriteW, spriteH);
  }

  // Line tool preview
  if (drag && drag.mode === 'line' && S.hover) {
    sctx.fillStyle = C.u32ToHex(S.color);
    C.line(drag.x0, drag.y0, S.hover.x, S.hover.y, (x, y) => {
      if (C.inBounds(x, y, p.w, p.h)) sctx.fillRect(ox + x * z, oy + y * z, z, z);
    });
  }

  // Selection overlay
  if (selOverlay && !(drag && drag.mode === 'move')) {
    sctx.drawImage(selOverlay, ox, oy, spriteW, spriteH);
  }

  // Pixel grid
  if (S.grid && z >= 8) {
    sctx.strokeStyle = 'rgba(255,255,255,0.07)';
    sctx.lineWidth = 1;
    sctx.beginPath();
    for (let x = 1; x < p.w; x++) { sctx.moveTo(ox + x * z + 0.5, oy); sctx.lineTo(ox + x * z + 0.5, oy + spriteH); }
    for (let y = 1; y < p.h; y++) { sctx.moveTo(ox, oy + y * z + 0.5); sctx.lineTo(ox + spriteW, oy + y * z + 0.5); }
    sctx.stroke();
  }

  // Canvas frame + hover cell
  sctx.strokeStyle = '#2E3742';
  sctx.strokeRect(ox - 0.5, oy - 0.5, spriteW + 1, spriteH + 1);
  if (S.hover && !S.playing) {
    sctx.strokeStyle = '#FF8A3D';
    sctx.strokeRect(ox + S.hover.x * z + 0.5, oy + S.hover.y * z + 0.5, z - 1, z - 1);
  }
}

/* ============ LIVE PREVIEW (header forge viewport) ============ */
function renderLivePreview(frameIndex) {
  const cv = $('livePrev');
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, cv.width, cv.height);
  const p = S.proj;
  const scale = Math.max(1, Math.floor(Math.min(cv.width / p.w, cv.height / p.h)));
  const dx = Math.floor((cv.width - p.w * scale) / 2);
  const dy = Math.floor((cv.height - p.h * scale) / 2);
  ctx.drawImage(compositeFrame(frameIndex), dx, dy, p.w * scale, p.h * scale);
}

/* ============ MAIN LOOP ============ */
let liveFrame = 0, liveAcc = 0;
function loop(t) {
  const dt = S.lastT ? (t - S.lastT) / 1000 : 0;
  S.lastT = t;
  const p = S.proj;
  const frameDur = 1 / clamp(p.fps, 1, 60);

  if (S.playing) {
    S.playAcc += dt;
    while (S.playAcc >= frameDur) {
      S.playAcc -= frameDur;
      S.frame = S.frame >= S.playTo ? S.playFrom : S.frame + 1;
    }
    liveFrame = S.frame;
  } else {
    // The forge viewport keeps playing the selected range even while editing.
    liveAcc += dt;
    while (liveAcc >= frameDur) {
      liveAcc -= frameDur;
      const { from, to } = playRange();
      liveFrame = (liveFrame < from || liveFrame >= to) ? from : liveFrame + 1;
    }
  }
  renderStage();
  renderLivePreview(clamp(liveFrame, 0, p.frames.length - 1));
  requestAnimationFrame(loop);
}

function playRange() {
  const sel = $('playRange').value;
  if (sel !== 'all') {
    const tag = S.proj.tags[Number(sel)];
    if (tag) return { from: tag.from, to: tag.to };
  }
  return { from: 0, to: S.proj.frames.length - 1 };
}

/* ============ POINTER INPUT & TOOLS ============ */
function screenToPx(e) {
  const r = stage.getBoundingClientRect();
  return {
    x: Math.floor((e.clientX - r.left - S.panX) / S.zoom),
    y: Math.floor((e.clientY - r.top - S.panY) / S.zoom)
  };
}

function plotPixel(cel, x, y, color) {
  const p = S.proj;
  if (!C.inBounds(x, y, p.w, p.h)) return;
  const i = C.idx(x, y, p.w);
  if (S.selection && !S.selection[i]) return;
  cel[i] = color;
}

function fullMask() {
  return new Uint8Array(S.proj.w * S.proj.h).fill(1);
}

function beginMoveDrag(px) {
  const cel = activeCel(true);
  const mask = S.selection || fullMask();
  const { extracted, remaining } = C.extractMask(cel, mask);
  const exCv = document.createElement('canvas');
  exCv.width = S.proj.w; exCv.height = S.proj.h;
  const ctx = exCv.getContext('2d');
  const img = ctx.createImageData(S.proj.w, S.proj.h);
  new Uint32Array(img.data.buffer).set(extracted);
  ctx.putImageData(img, 0, 0);
  S.drag = { mode: 'move', start: px, dx: 0, dy: 0, srcCel: new Uint32Array(cel), mask, remaining, extractedCanvas: exCv };
}

function commitMoveDrag() {
  const d = S.drag;
  if (!d || (d.dx === 0 && d.dy === 0)) return;
  pushUndoCel();
  const moved = C.shiftMasked(d.srcCel, d.mask, S.proj.w, S.proj.h, d.dx, d.dy);
  S.proj.layers[S.layer].cels[S.frame] = moved.data;
  if (S.selection) { S.selection = moved.mask; rebuildSelOverlay(); }
  touchCel(moved.data);
  refreshThumbs();
}

function onPointerDown(e) {
  if (e.button === 1 || S.tool === 'pan' || (e.button === 0 && S.spaceHeld)) {
    S.drag = { mode: 'pan', sx: e.clientX, sy: e.clientY, px: S.panX, py: S.panY };
    stage.setPointerCapture(e.pointerId);
    return;
  }
  if (e.button !== 0 && e.pointerType === 'mouse') return;
  const px = screenToPx(e);
  const p = S.proj;
  stage.setPointerCapture(e.pointerId);

  switch (S.tool) {
    case 'pencil':
    case 'eraser': {
      pushUndoCel();
      const cel = activeCel(true);
      const color = S.tool === 'eraser' ? 0 : S.color;
      plotPixel(cel, px.x, px.y, color);
      touchCel(cel);
      S.drag = { mode: 'draw', last: px, color };
      refreshThumbs();
      break;
    }
    case 'line':
      S.drag = { mode: 'line', x0: px.x, y0: px.y };
      break;
    case 'fill': {
      if (!C.inBounds(px.x, px.y, p.w, p.h)) break;
      pushUndoCel();
      const cel = activeCel(true);
      const n = C.floodFill(cel, p.w, p.h, px.x, px.y, S.color, S.selection || undefined);
      if (n) { touchCel(cel); refreshThumbs(); } else S.undo.pop();
      break;
    }
    case 'wand': {
      if (!C.inBounds(px.x, px.y, p.w, p.h)) { clearSelection(); break; }
      const cel = activeCel(true);
      S.selection = C.magicWand(cel, p.w, p.h, px.x, px.y, !e.shiftKey ? true : false);
      if (C.maskCount(S.selection) === 0) S.selection = null;
      rebuildSelOverlay();
      updateSelInfo();
      break;
    }
    case 'picker': {
      if (!C.inBounds(px.x, px.y, p.w, p.h)) break;
      const comp = compositeFrame(S.frame).getContext('2d').getImageData(px.x, px.y, 1, 1);
      const c = new Uint32Array(comp.data.buffer)[0];
      if (C.alphaOf(c) > 0) {
        S.color = c;
        if (!S.proj.palette.includes(c)) S.proj.palette.push(c);
        refreshPalette();
      }
      break;
    }
    case 'move':
      beginMoveDrag(px);
      break;
  }
}

function onPointerMove(e) {
  const px = screenToPx(e);
  S.hover = C.inBounds(px.x, px.y, S.proj.w, S.proj.h) ? px : null;
  $('coords').textContent = S.hover ? S.hover.x + ', ' + S.hover.y : '\u2014';
  const d = S.drag;
  if (!d) return;
  if (d.mode === 'pan') {
    S.panX = d.px + (e.clientX - d.sx);
    S.panY = d.py + (e.clientY - d.sy);
  } else if (d.mode === 'draw') {
    const cel = activeCel(true);
    C.line(d.last.x, d.last.y, px.x, px.y, (x, y) => plotPixel(cel, x, y, d.color));
    touchCel(cel);
    d.last = px;
  } else if (d.mode === 'move') {
    d.dx = px.x - d.start.x;
    d.dy = px.y - d.start.y;
  }
}

function onPointerUp(e) {
  const d = S.drag;
  if (!d) return;
  if (d.mode === 'line') {
    const px = screenToPx(e);
    pushUndoCel();
    const cel = activeCel(true);
    C.line(d.x0, d.y0, px.x, px.y, (x, y) => plotPixel(cel, x, y, S.color));
    touchCel(cel);
    refreshThumbs();
  } else if (d.mode === 'move') {
    commitMoveDrag();
  } else if (d.mode === 'draw') {
    refreshThumbs();
  }
  S.drag = null;
}

function clearSelection() {
  S.selection = null;
  rebuildSelOverlay();
  updateSelInfo();
}

function extractSelectionToLayer() {
  if (!S.selection) { toast('Select a region with the wand first'); return; }
  const cel = activeCel(true);
  pushUndoProj();
  const { extracted, remaining } = C.extractMask(cel, S.selection);
  S.proj.layers[S.layer].cels[S.frame] = remaining;
  const part = {
    name: 'Part ' + (S.proj.layers.length + 1),
    visible: true,
    cels: S.proj.frames.map(() => null)
  };
  part.cels[S.frame] = extracted;
  S.proj.layers.splice(S.layer + 1, 0, part);
  S.layer = S.layer + 1;
  clearSelection();
  refreshAll();
  toast('Region isolated to "' + part.name + '" \u2014 edit or regenerate it independently');
}

/* ============ PANELS: LAYERS ============ */
function refreshLayers() {
  const list = $('layersList');
  list.innerHTML = '';
  const p = S.proj;
  for (let i = p.layers.length - 1; i >= 0; i--) {
    const layer = p.layers[i];
    const row = document.createElement('div');
    row.className = 'row' + (i === S.layer ? ' active' : '');
    const eye = document.createElement('button');
    eye.className = 'eye' + (layer.visible ? ' on' : '');
    eye.title = layer.visible ? 'Hide layer' : 'Show layer';
    eye.textContent = layer.visible ? '\u25C9' : '\u25CB';
    on(eye, 'click', ev => { ev.stopPropagation(); layer.visible = !layer.visible; refreshLayers(); refreshThumbs(); });
    const name = document.createElement('span');
    name.textContent = layer.name;
    on(row, 'click', () => { S.layer = i; refreshLayers(); });
    on(row, 'dblclick', () => {
      const n = prompt('Layer name', layer.name);
      if (n) { layer.name = n.trim().slice(0, 24) || layer.name; refreshLayers(); }
    });
    row.appendChild(eye); row.appendChild(name);
    list.appendChild(row);
  }
  const al = p.layers[S.layer];
  if (al) {
    $('layerOpacity').value = Math.round((al.opacity == null ? 1 : al.opacity) * 100);
    $('layerBlend').value = al.blend || 'source-over';
  }
}
function addLayer() {
  pushUndoProj();
  const p = S.proj;
  p.layers.splice(S.layer + 1, 0, {
    name: 'Layer ' + (p.layers.length + 1), visible: true, opacity: 1, blend: 'source-over',
    cels: p.frames.map(() => null)
  });
  S.layer++;
  refreshAll();
}
function deleteLayer() {
  const p = S.proj;
  if (p.layers.length <= 1) { toast('A project needs at least one layer', true); return; }
  pushUndoProj();
  p.layers.splice(S.layer, 1);
  S.layer = clamp(S.layer, 0, p.layers.length - 1);
  refreshAll();
}
function moveLayer(dir) {
  const p = S.proj, j = S.layer + dir;
  if (j < 0 || j >= p.layers.length) return;
  pushUndoProj();
  const [l] = p.layers.splice(S.layer, 1);
  p.layers.splice(j, 0, l);
  S.layer = j;
  refreshAll();
}

/* ============ PANELS: PALETTE ============ */
function refreshPalette() {
  const grid = $('paletteGrid');
  grid.innerHTML = '';
  const trans = document.createElement('button');
  trans.className = 'swatch trans' + (S.color === 0 ? ' active' : '');
  trans.title = 'Transparent (erase with pencil)';
  on(trans, 'click', () => swatchClick(0));
  grid.appendChild(trans);
  for (const c of S.proj.palette) {
    const b = document.createElement('button');
    b.className = 'swatch' + (c === S.color ? ' active' : '') +
      (S.recolor && S.recolor.from === c ? ' marked' : '');
    b.style.background = C.u32ToHex(c);
    b.title = C.u32ToHex(c);
    on(b, 'click', () => swatchClick(c));
    grid.appendChild(b);
  }
}
function swatchClick(c) {
  if (S.recolor) {
    if (S.recolor.from == null) {
      S.recolor.from = c;
      $('recolorHint').textContent = 'Now pick the replacement color';
      refreshPalette();
      return;
    }
    const from = S.recolor.from, to = c;
    S.recolor = null;
    $('recolorHint').textContent = '';
    $('btnRecolor').classList.remove('on');
    if (from === to) { toast('Same color \u2014 nothing to remap'); refreshPalette(); return; }
    pushUndoProj();
    let n = 0;
    for (const layer of S.proj.layers) {
      for (const cel of layer.cels) {
        if (!cel) continue;
        n += C.remapColor(cel, from, to);
        touchCel(cel);
      }
    }
    refreshAll();
    toast('Remapped ' + n + ' pixels ' + C.u32ToHex(from) + ' \u2192 ' + C.u32ToHex(to));
    return;
  }
  S.color = c;
  refreshPalette();
}
function startRecolor() {
  S.recolor = S.recolor ? null : { from: null };
  $('btnRecolor').classList.toggle('on', !!S.recolor);
  $('recolorHint').textContent = S.recolor ? 'Pick the color to replace' : '';
  refreshPalette();
}
function paletteFromSprite() {
  const seen = new Set();
  const merged = [];
  for (const layer of S.proj.layers) {
    for (const cel of layer.cels) {
      if (!cel) continue;
      for (const c of C.extractPalette(cel, 256)) {
        if (!seen.has(c)) { seen.add(c); merged.push(c); }
      }
    }
  }
  if (!merged.length) { toast('No opaque pixels found', true); return; }
  S.proj.palette = merged.slice(0, 64);
  refreshPalette();
  toast('Palette rebuilt from sprite: ' + S.proj.palette.length + ' colors');
}
function addPaletteColor() {
  const c = C.hexToU32($('colorInput').value);
  if (!S.proj.palette.includes(c)) S.proj.palette.push(c);
  S.color = c;
  refreshPalette();
}

/* ============ PANELS: TAGS ============ */
function refreshTags() {
  const list = $('tagsList');
  list.innerHTML = '';
  S.proj.tags.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'row';
    const name = document.createElement('span');
    name.textContent = t.name + '  [' + t.from + '\u2013' + t.to + ']';
    const del = document.createElement('button');
    del.className = 'mini'; del.textContent = '\u00D7'; del.title = 'Delete tag';
    on(del, 'click', () => { pushUndoProj(); S.proj.tags.splice(i, 1); refreshTags(); refreshPlayRange(); });
    row.appendChild(name); row.appendChild(del);
    list.appendChild(row);
  });
  refreshPlayRange();
}
function refreshPlayRange() {
  const sel = $('playRange');
  const prev = sel.value;
  sel.innerHTML = '';
  const all = document.createElement('option');
  all.value = 'all'; all.textContent = 'All frames';
  sel.appendChild(all);
  S.proj.tags.forEach((t, i) => {
    const o = document.createElement('option');
    o.value = String(i); o.textContent = t.name;
    sel.appendChild(o);
  });
  sel.value = [...sel.options].some(o => o.value === prev) ? prev : 'all';
}
function addTag() {
  const name = $('tagName').value.trim();
  const from = parseInt($('tagFrom').value, 10);
  const to = parseInt($('tagTo').value, 10);
  const max = S.proj.frames.length - 1;
  if (!name) { toast('Give the tag a name', true); return; }
  if (!(Number.isInteger(from) && Number.isInteger(to) && from >= 0 && to <= max && from <= to)) {
    toast('Tag range must be within 0\u2013' + max, true); return;
  }
  pushUndoProj();
  S.proj.tags.push({ name, from, to });
  $('tagName').value = '';
  refreshTags();
  toast('Tagged "' + name + '" \u2192 frames ' + from + '\u2013' + to);
}

/* ============ TIMELINE ============ */
function refreshThumbs() {
  const strip = $('framesStrip');
  strip.innerHTML = '';
  const p = S.proj;
  p.frames.forEach((f, i) => {
    const cell = document.createElement('div');
    cell.className = 'thumb' + (i === S.frame ? ' active' : '');
    const cv = document.createElement('canvas');
    cv.width = 44; cv.height = 44;
    const ctx = cv.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const scale = Math.max(1, Math.floor(Math.min(44 / p.w, 44 / p.h)));
    ctx.drawImage(compositeFrame(i),
      Math.floor((44 - p.w * scale) / 2), Math.floor((44 - p.h * scale) / 2),
      p.w * scale, p.h * scale);
    const num = document.createElement('span');
    num.textContent = i;
    on(cell, 'click', () => { S.frame = i; S.playing = false; refreshThumbs(); });
    cell.appendChild(cv); cell.appendChild(num);
    strip.appendChild(cell);
  });
  $('tagFrom').max = $('tagTo').max = String(p.frames.length - 1);
}
function addFrame(duplicate) {
  pushUndoProj();
  const p = S.proj;
  const at = S.frame + 1;
  p.frames.splice(at, 0, { duration: 0 });
  for (const layer of p.layers) {
    const src = duplicate && layer.cels[S.frame] ? new Uint32Array(layer.cels[S.frame]) : null;
    layer.cels.splice(at, 0, src);
  }
  for (const t of p.tags) {
    if (t.from >= at) t.from++;
    if (t.to >= at - 1 && t.to >= S.frame) t.to++;
  }
  S.frame = at;
  clearSelection();
  refreshAll();
}
function deleteFrame() {
  const p = S.proj;
  if (p.frames.length <= 1) { toast('A project needs at least one frame', true); return; }
  pushUndoProj();
  const at = S.frame;
  p.frames.splice(at, 1);
  for (const layer of p.layers) layer.cels.splice(at, 1);
  p.tags = p.tags.filter(t => !(t.from === at && t.to === at));
  for (const t of p.tags) {
    if (t.from > at) t.from--;
    if (t.to >= at) t.to = Math.max(t.from, t.to - 1);
  }
  S.frame = clamp(at, 0, p.frames.length - 1);
  clearSelection();
  refreshAll();
}
function togglePlay() {
  if (S.playing) { S.playing = false; refreshThumbs(); }
  else {
    const r = playRange();
    S.playFrom = r.from; S.playTo = r.to;
    S.frame = r.from; S.playAcc = 0;
    S.playing = true;
  }
  $('btnPlay').textContent = S.playing ? '\u25A0 Stop' : '\u25B6 Play';
}

/* ============ EXPORT ============ */
function safeName() {
  return (S.proj.name || 'sprite').replace(/[^\w\-]+/g, '_');
}
function exportSheet() {
  const p = S.proj;
  const pack = C.packRows(p.w, p.h, p.frames.length, 4096);
  const sheet = document.createElement('canvas');
  sheet.width = pack.sheetW; sheet.height = pack.sheetH;
  const ctx = sheet.getContext('2d');
  p.frames.forEach((f, i) => {
    ctx.drawImage(compositeFrame(i), pack.positions[i].x, pack.positions[i].y);
  });
  const atlas = buildAtlasObject(pack);
  sheet.toBlob(blob => {
    if (!blob) { toast('Sheet export failed \u2014 the canvas could not encode a PNG', true); return; }
    download(safeName() + '.png', blob);
    download(safeName() + '.json', new Blob([JSON.stringify(atlas, null, 2)], { type: 'application/json' }));
    toast('Exported ' + p.frames.length + ' frames \u2192 ' + pack.sheetW + '\u00D7' + pack.sheetH + ' sheet + atlas');
  }, 'image/png');
}
function buildAtlasObject(pack) {
  const p = S.proj;
  pack = pack || C.packRows(p.w, p.h, p.frames.length, 4096);
  const dur = Math.round(1000 / clamp(p.fps, 1, 60));
  return C.buildAtlas({
    name: safeName(), fw: p.w, fh: p.h,
    sheetW: pack.sheetW, sheetH: pack.sheetH,
    positions: pack.positions,
    frameDurations: p.frames.map(() => dur),
    tags: p.tags
  });
}
function exportFramePNG() {
  compositeFrame(S.frame).toBlob(blob => {
    if (!blob) { toast('Export failed', true); return; }
    download(safeName() + '_frame' + S.frame + '.png', blob);
  }, 'image/png');
}
function saveProject() {
  const json = C.serializeProject(S.proj);
  download(safeName() + '.pixelforge.json', new Blob([json], { type: 'application/json' }));
  toast('Project saved \u2014 keep this file; nothing is stored in the browser');
}

/* ============ IMPORT ============ */
function openProjectFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    try {
      const p = C.deserializeProject(String(reader.result));
      S.proj = p;
      S.frame = 0; S.layer = 0;
      S.undo.length = 0; S.redo.length = 0;
      clearSelection();
      fitView();
      refreshAll();
      toast('Opened "' + p.name + '" \u2014 ' + p.frames.length + ' frames, ' + p.layers.length + ' layers');
    } catch (err) {
      toast(err.message, true);
    }
  };
  reader.onerror = () => toast('Could not read the file', true);
  reader.readAsText(file);
}

function pristine() {
  const p = S.proj;
  if (p.frames.length !== 1 || p.layers.length !== 1) return false;
  const cel = p.layers[0].cels[0];
  if (!cel) return true;
  for (let i = 0; i < cel.length; i++) if (cel[i] !== 0) return false;
  return true;
}

function imageToU32(img, sx, sy, sw, sh, dw, dh) {
  const cv = document.createElement('canvas');
  cv.width = dw; cv.height = dh;
  const ctx = cv.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
  return new Uint32Array(ctx.getImageData(0, 0, dw, dh).data.buffer.slice(0));
}

function importSingle(img) {
  const p = S.proj;
  pushUndoProj();
  const cel = imageToU32(img, 0, 0, Math.min(img.width, p.w), Math.min(img.height, p.h), p.w, p.h);
  const layer = { name: 'Import', visible: true, cels: p.frames.map(() => null) };
  layer.cels[S.frame] = cel;
  p.layers.splice(S.layer + 1, 0, layer);
  S.layer++;
  refreshAll();
  const clippedNote = (img.width > p.w || img.height > p.h) ? ' (clipped to canvas)' : '';
  toast('Imported as layer "Import"' + clippedNote);
}

function importSheet(img, fw, fh) {
  const p = S.proj;
  if (!(fw > 0 && fh > 0)) { toast('Frame size must be positive', true); return; }
  if (fw > img.width || fh > img.height) { toast('Frame size exceeds the image', true); return; }
  if ((fw !== p.w || fh !== p.h)) {
    if (!pristine()) {
      toast('Frame size ' + fw + '\u00D7' + fh + ' doesn\u2019t match this ' + p.w + '\u00D7' + p.h + ' project. Open a new project for it.', true);
      return;
    }
    S.proj = newProject(p.name, fw, fh);
  }
  pushUndoProj();
  const proj = S.proj;
  const rects = C.sliceGrid(img.width, img.height, fw, fh);
  while (proj.frames.length < rects.length) {
    proj.frames.push({ duration: 0 });
    for (const layer of proj.layers) layer.cels.push(null);
  }
  const layer = { name: 'Sheet import', visible: true, cels: proj.frames.map(() => null) };
  rects.forEach((r, i) => { layer.cels[i] = imageToU32(img, r.x, r.y, r.w, r.h, fw, fh); });
  proj.layers.push(layer);
  S.layer = proj.layers.length - 1;
  S.frame = 0;
  clearSelection();
  fitView();
  refreshAll();
  toast('Sliced ' + rects.length + ' frames from the sheet');
}

function handleImageFile(file) {
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    URL.revokeObjectURL(url);
    openImportModal(img, file.name);
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Not a readable image file', true); };
  img.src = url;
}

function openImportModal(img, label) {
  S.pendingImage = img;
  $('importInfo').textContent = (label || 'image') + ' \u2014 ' + img.width + '\u00D7' + img.height + ' px';
  $('shW').value = S.proj.w;
  $('shH').value = S.proj.h;
  showModal('modalImport');
}

/* ============ MODALS ============ */
function showModal(id) { $(id).classList.add('open'); }
function hideModals() { document.querySelectorAll('.modal').forEach(m => m.classList.remove('open')); }

function createFromModal() {
  const name = $('npName').value.trim() || 'sprite';
  const w = parseInt($('npW').value, 10);
  const h = parseInt($('npH').value, 10);
  if (!(w >= 1 && w <= 512 && h >= 1 && h <= 512)) { toast('Size must be 1\u2013512', true); return; }
  S.proj = newProject(name, w, h);
  S.frame = 0; S.layer = 0;
  S.undo.length = 0; S.redo.length = 0;
  clearSelection();
  fitView();
  refreshAll();
  hideModals();
  toast('New ' + w + '\u00D7' + h + ' project "' + name + '"');
}

/* ============ AI BRIDGE ============ */
/* Generation-agnostic: send a request to any image-generation API
   (PixelLab, Retro Diffusion, a local ComfyUI, \u2026) and harvest every
   image found in the response. Credentials live only in these fields,
   only for this session \u2014 nothing is persisted. */
function aiSend() {
  const url = $('aiUrl').value.trim();
  if (!/^https?:\/\//.test(url)) { toast('Enter a full http(s):// URL', true); return; }
  let headers = {};
  const headersRaw = $('aiHeaders').value.trim();
  if (headersRaw) {
    try { headers = JSON.parse(headersRaw); }
    catch (e) { toast('Headers must be a JSON object', true); return; }
  }
  const method = $('aiMethod').value;
  const body = $('aiBody').value;
  const init = { method, headers };
  if (method !== 'GET' && body.trim()) {
    init.body = body;
    if (!Object.keys(headers).some(k => k.toLowerCase() === 'content-type')) {
      headers['Content-Type'] = 'application/json';
    }
  }
  $('aiStatus').textContent = 'Sending\u2026';
  $('aiImages').innerHTML = '';
  $('aiResp').textContent = '';
  fetch(url, init).then(async res => {
    const text = await res.text();
    $('aiStatus').textContent = res.status + ' ' + res.statusText;
    let pretty = text;
    try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch (e) { /* keep raw */ }
    $('aiResp').textContent = pretty.slice(0, 20000);
    const found = scanForImages(text);
    if (!found.length) {
      $('aiImages').textContent = 'No images detected in the response.';
      return;
    }
    found.slice(0, 12).forEach(src => {
      const wrap = document.createElement('div');
      wrap.className = 'ai-img';
      const im = document.createElement('img');
      im.src = src;
      const btn = document.createElement('button');
      btn.className = 'btn';
      btn.textContent = 'Import';
      on(btn, 'click', () => {
        const full = new Image();
        full.crossOrigin = 'anonymous';
        full.onload = () => { hideModals(); openImportModal(full, 'AI result'); };
        full.onerror = () => toast('Could not load that image (CORS?) \u2014 try the proxy in tools/proxy.js', true);
        full.src = src;
      });
      wrap.appendChild(im); wrap.appendChild(btn);
      $('aiImages').appendChild(wrap);
    });
  }).catch(err => {
    $('aiStatus').textContent = 'Request failed: ' + err.message +
      ' \u2014 if this is a CORS block, run "node tools/proxy.js" and prefix the URL with http://localhost:8787/?url=';
  });
}
function scanForImages(text) {
  const out = new Set();
  let m;
  const dataRe = /data:image\/(?:png|gif|webp|jpe?g);base64,[A-Za-z0-9+/=]+/g;
  while ((m = dataRe.exec(text))) out.add(m[0]);
  const urlRe = /https?:\/\/[^\s"'\\<>]+?\.(?:png|gif|webp|jpe?g)(?:\?[^\s"'\\<>]*)?/g;
  while ((m = urlRe.exec(text))) out.add(m[0]);
  const rawPngRe = /"(iVBORw0KGgo[A-Za-z0-9+/=]{100,})"/g;
  while ((m = rawPngRe.exec(text))) out.add('data:image/png;base64,' + m[1]);
  return [...out];
}

/* ============ SELECTION INFO ============ */
function updateSelInfo() {
  const el = $('selInfo');
  if (!S.selection) { el.textContent = 'No selection'; return; }
  const n = C.maskCount(S.selection);
  const b = C.maskBounds(S.selection, S.proj.w, S.proj.h);
  el.textContent = n + ' px \u00B7 ' + (b ? b.w + '\u00D7' + b.h : '');
}

/* ============ REFRESH ============ */
function refreshAll() {
  refreshLayers();
  refreshPalette();
  refreshTags();
  refreshThumbs();
  updateSelInfo();
  $('fpsInput').value = S.proj.fps;
  $('projLabel').textContent = S.proj.name + ' \u00B7 ' + S.proj.w + '\u00D7' + S.proj.h;
  document.title = S.proj.name + ' \u2014 Forge Studio';
}

/* ============ WIRING ============ */
function setTool(t) {
  S.tool = t;
  document.querySelectorAll('[data-tool]').forEach(b =>
    b.classList.toggle('on', b.dataset.tool === t));
  stage.style.cursor = t === 'pan' ? 'grab' : 'crosshair';
}

function init() {
  stage = $('stage');
  sctx = stage.getContext('2d');

  on(stage, 'pointerdown', onPointerDown);
  on(stage, 'pointermove', onPointerMove);
  on(stage, 'pointerup', onPointerUp);
  on(stage, 'pointercancel', () => { S.drag = null; });
  on(stage, 'wheel', e => {
    e.preventDefault();
    const px = screenToPx(e);
    const old = S.zoom;
    S.zoom = clamp(S.zoom + (e.deltaY < 0 ? 1 : -1), 1, 48);
    // zoom toward the cursor
    S.panX -= px.x * (S.zoom - old);
    S.panY -= px.y * (S.zoom - old);
  }, { passive: false });

  document.querySelectorAll('[data-tool]').forEach(b =>
    on(b, 'click', () => setTool(b.dataset.tool)));

  on($('btnZoomIn'), 'click', () => { S.zoom = clamp(S.zoom + 1, 1, 48); });
  on($('btnZoomOut'), 'click', () => { S.zoom = clamp(S.zoom - 1, 1, 48); });
  on($('btnZoomFit'), 'click', fitView);
  on($('chkOnion'), 'change', e => { S.onion = e.target.checked; });
  on($('chkGrid'), 'change', e => { S.grid = e.target.checked; });

  on($('btnUndo'), 'click', doUndo);
  on($('btnRedo'), 'click', doRedo);
  on($('btnSelClear'), 'click', clearSelection);
  on($('btnSelExtract'), 'click', extractSelectionToLayer);

  on($('btnLayerAdd'), 'click', addLayer);
  on($('btnLayerDel'), 'click', deleteLayer);
  on($('btnLayerUp'), 'click', () => moveLayer(1));
  on($('btnLayerDown'), 'click', () => moveLayer(-1));
  // per-layer opacity + blend mode (live; one undo step per drag/change)
  let opacityDragging = false;
  on($('layerOpacity'), 'pointerdown', () => { opacityDragging = false; });
  on($('layerOpacity'), 'input', () => {
    const l = S.proj.layers[S.layer]; if (!l) return;
    if (!opacityDragging) { pushUndoProj(); opacityDragging = true; }
    l.opacity = clamp(+$('layerOpacity').value, 0, 100) / 100;
    refreshThumbs(); renderStage();
  });
  on($('layerOpacity'), 'change', () => { opacityDragging = false; });
  on($('layerBlend'), 'change', () => {
    const l = S.proj.layers[S.layer]; if (!l) return;
    pushUndoProj();
    l.blend = $('layerBlend').value;
    refreshThumbs(); renderStage();
  });

  on($('btnColorAdd'), 'click', addPaletteColor);
  on($('btnPalFromSprite'), 'click', paletteFromSprite);
  on($('btnRecolor'), 'click', startRecolor);

  on($('btnTagAdd'), 'click', addTag);

  on($('btnFrameAdd'), 'click', () => addFrame(false));
  on($('btnFrameDup'), 'click', () => addFrame(true));
  on($('btnFrameDel'), 'click', deleteFrame);
  on($('btnPlay'), 'click', togglePlay);
  on($('fpsInput'), 'change', e => {
    S.proj.fps = clamp(parseInt(e.target.value, 10) || 8, 1, 60);
    e.target.value = S.proj.fps;
  });

  on($('btnNew'), 'click', () => showModal('modalNew'));
  on($('btnCreate'), 'click', createFromModal);
  document.querySelectorAll('[data-preset]').forEach(b => on(b, 'click', () => {
    const [w, h] = b.dataset.preset.split('x');
    $('npW').value = w; $('npH').value = h;
  }));

  on($('btnOpen'), 'click', () => $('fileOpen').click());
  on($('fileOpen'), 'change', e => {
    if (e.target.files[0]) openProjectFile(e.target.files[0]);
    e.target.value = '';
  });
  on($('btnSave'), 'click', saveProject);

  on($('btnImport'), 'click', () => $('fileImport').click());
  on($('fileImport'), 'change', e => {
    if (e.target.files[0]) handleImageFile(e.target.files[0]);
    e.target.value = '';
  });
  on($('btnImportSingle'), 'click', () => {
    if (S.pendingImage) { importSingle(S.pendingImage); S.pendingImage = null; hideModals(); }
  });
  on($('btnImportSheet'), 'click', () => {
    if (!S.pendingImage) return;
    importSheet(S.pendingImage, parseInt($('shW').value, 10), parseInt($('shH').value, 10));
    S.pendingImage = null;
    hideModals();
  });

  on($('btnExportMenu'), 'click', e => {
    e.stopPropagation();
    $('exportMenu').classList.toggle('open');
  });
  on(document, 'click', () => $('exportMenu').classList.remove('open'));
  on($('btnExportSheet'), 'click', exportSheet);
  on($('btnExportFrame'), 'click', exportFramePNG);

  on($('btnAI'), 'click', () => showModal('modalAI'));
  on($('btnAiSend'), 'click', aiSend);

  document.querySelectorAll('[data-close]').forEach(b => on(b, 'click', hideModals));
  document.querySelectorAll('.modal').forEach(m =>
    on(m, 'mousedown', e => { if (e.target === m) hideModals(); }));

  // drag & drop import
  on(window, 'dragover', e => e.preventDefault());
  on(window, 'drop', e => {
    e.preventDefault();
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (/\.json$/i.test(f.name)) openProjectFile(f);
    else handleImageFile(f);
  });

  // keyboard
  on(window, 'keydown', e => {
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); doRedo(); return; }
    if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveProject(); return; }
    if (e.key === ' ') { e.preventDefault(); S.spaceHeld = true; return; }
    if (e.key === 'Escape') { if (S.recolor) startRecolor(); else clearSelection(); hideModals(); return; }
    const tools = { b: 'pencil', e: 'eraser', g: 'fill', l: 'line', w: 'wand', i: 'picker', v: 'move', h: 'pan' };
    if (tools[k]) { setTool(tools[k]); return; }
    if (k === 'p') togglePlay();
    if (k === ',') { S.frame = Math.max(0, S.frame - 1); refreshThumbs(); }
    if (k === '.') { S.frame = Math.min(S.proj.frames.length - 1, S.frame + 1); refreshThumbs(); }
    if (k === '[') S.zoom = clamp(S.zoom - 1, 1, 48);
    if (k === ']') S.zoom = clamp(S.zoom + 1, 1, 48);
  });
  on(window, 'keyup', e => { if (e.key === ' ') S.spaceHeld = false; });
  on(window, 'resize', () => {});

  setTool('pencil');
  fitView();
  refreshAll();
  requestAnimationFrame(loop);
}

/* Test hooks: only exposed so a headless harness can drive the app. */
window.__PF = {
  S, C,
  newProjectTo(w, h) { S.proj = newProject('test', w, h); S.frame = 0; S.layer = 0; refreshAll(); },
  setPixel(x, y, c) { pushUndoCel(); const cel = activeCel(true); plotPixel(cel, x, y, c); touchCel(cel); },
  addFrame, deleteFrame, addLayer, deleteLayer,
  addTagDirect(name, from, to) { S.proj.tags.push({ name, from, to }); },
  buildAtlasObject, doUndo, doRedo, compositeFrame, refreshLayers,
  extractSelectionToLayer, scanForImages, importSheet, pristine
};

if (document.readyState === 'loading') on(document, 'DOMContentLoaded', init);
else init();
})();
