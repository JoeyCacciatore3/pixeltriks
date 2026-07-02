/* Forge Studio — history.js
   Bounded undo/redo. Each entry stores a full snapshot of document
   structure, but pixel data is SHARED between consecutive snapshots for
   any layer whose pixels didn't change between edits. A 25-deep stack on
   a multi-layer 4096² document therefore holds only the pixel buffers
   that actually changed, not 25 full copies of every layer — which is
   what keeps memory bounded on large canvases. Shared buffers are only
   ever read (putImageData reads from them; nothing writes back), so the
   sharing is safe. */
'use strict';
window.GF = window.GF || {};

GF.history = (function () {
  const MAX_STEPS = 25;
  let undoStack = [];
  let redoStack = [];
  let listeners = [];
  // Most-recently captured ImageData per layer id. Lets a new snapshot reuse
  // the previous snapshot's buffer for layers that haven't changed.
  let lastCaptured = new Map();

  function onChange(fn) { listeners.push(fn); }
  function emit() { listeners.forEach(fn => fn(canUndo(), canRedo())); }

  /** Byte-exact ImageData comparison. */
  function samePixels(a, b) {
    if (!a || !b || a.width !== b.width || a.height !== b.height) return false;
    const da = a.data, db = b.data;
    for (let i = 0; i < da.length; i++) if (da[i] !== db[i]) return false;
    return true;
  }

  /** Read a layer's pixels, but reuse the last captured buffer if unchanged. */
  function capture(L) {
    const cur = GF.util.ctx2d(L.canvas).getImageData(0, 0, L.canvas.width, L.canvas.height);
    const prev = lastCaptured.get(L.id);
    if (samePixels(prev, cur)) return prev; // share the existing buffer
    lastCaptured.set(L.id, cur);
    return cur;
  }

  /** Snapshot the whole document. Structure is always copied; pixel buffers
      are shared with the previous snapshot when a layer is unchanged. */
  function snapshot(doc) {
    return {
      width: doc.width,
      height: doc.height,
      activeId: doc.activeId,
      layers: doc.layers.map(L => ({
        id: L.id,
        name: L.name,
        visible: L.visible,
        opacity: L.opacity,
        blend: L.blend,
        x: L.x,
        y: L.y,
        nineSlice: L.nineSlice || null,
        clip: L.clip || false,
        adjust: L.adjust ? { kind: L.adjust.kind, params: Object.assign({}, L.adjust.params) } : null,
        pixels: L.canvas ? capture(L) : null,                 // null for adjustment layers
        mask: L.mask ? GF.util.ctx2d(L.mask).getImageData(0, 0, L.mask.width, L.mask.height) : null,
      }))
    };
  }

  function restore(doc, snap) {
    doc.width = snap.width;
    doc.height = snap.height;
    // The restored pixels become the current state, so reset the capture
    // cache to point at them — the next snapshot can then share unchanged ones.
    lastCaptured = new Map();
    doc.layers = snap.layers.map(s => {
      let canvas = null;
      if (s.pixels) {
        canvas = GF.util.makeCanvas(s.pixels.width, s.pixels.height);
        GF.util.ctx2d(canvas).putImageData(s.pixels, 0, 0);
        lastCaptured.set(s.id, s.pixels);
      }
      let mask = null;
      if (s.mask) { mask = GF.util.makeCanvas(s.mask.width, s.mask.height); GF.util.ctx2d(mask).putImageData(s.mask, 0, 0); }
      const L = {
        id: s.id, name: s.name, visible: s.visible, opacity: s.opacity,
        blend: s.blend, x: s.x, y: s.y, nineSlice: s.nineSlice || null, mask, canvas,
      };
      if (s.adjust) { L.adjust = { kind: s.adjust.kind, params: s.adjust.params }; L.clip = s.clip || false; }
      return L;
    });
    doc.activeId = snap.activeId;
  }

  /** Call BEFORE mutating the document. */
  function push(doc, label) {
    undoStack.push({ label: label || 'edit', snap: snapshot(doc) });
    if (undoStack.length > MAX_STEPS) undoStack.shift();
    redoStack = [];
    emit();
  }

  function undo(doc) {
    if (!undoStack.length) return false;
    redoStack.push({ label: 'redo', snap: snapshot(doc) });
    restore(doc, undoStack.pop().snap);
    emit();
    return true;
  }

  function redo(doc) {
    if (!redoStack.length) return false;
    undoStack.push({ label: 'undo', snap: snapshot(doc) });
    restore(doc, redoStack.pop().snap);
    emit();
    return true;
  }

  function clear() { undoStack = []; redoStack = []; lastCaptured = new Map(); emit(); }
  function canUndo() { return undoStack.length > 0; }
  function canRedo() { return redoStack.length > 0; }

  return { push, undo, redo, clear, canUndo, canRedo, onChange };
})();
