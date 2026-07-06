/* PixelTriks — selection-bar.js
   Selection utility functions. The floating bar UI is removed —
   the context hotbar (hotbar.js) owns the selection action UI.
   This module provides the canvas operations that hotbar delegates to. */
'use strict';
window.GF = window.GF || {};

GF.selectionBar = (function () {
  const U = GF.util, D = GF.doc;
  const V = () => GF.view.view;
  const run = (n, a) => { try { return GF.api.run(n, a); } catch (e) { U.toast(e.message); } };

  function fillSelection() {
    const L = D.active(); if (!L || !L.canvas) return U.toast('Pick a pixel layer');
    GF.history.push(D.doc, 'fill selection');
    const t = U.makeCanvas(D.doc.width, D.doc.height), tc = U.ctx2d(t);
    tc.fillStyle = V().brush.color; tc.fillRect(0, 0, t.width, t.height);
    tc.globalCompositeOperation = 'destination-in'; tc.drawImage(GF.select.maskCanvas(), 0, 0);
    U.ctx2d(L.canvas).drawImage(t, -(L.x || 0), -(L.y || 0));
    GF.view.requestRender(); GF.ui.refreshLayers(); U.toast('Filled selection');
  }

  function deleteSelection() {
    const L = D.active(); if (!L || !L.canvas) return U.toast('Pick a pixel layer');
    GF.retouch.eraseSelection(L, true); GF.view.requestRender(); GF.ui.refreshLayers(); U.toast('Deleted');
  }

  function cutOut() {
    if (!GF.select.has()) return;
    run('addMask', { init: 'selection' });
    GF.select.clear(); GF.view.requestRender(); GF.ui.refreshLayers();
    U.toast('Cut out — the rest is hidden (edit the mask to refine)');
  }

  function cropTo(x, y, w, h) {
    if (w < 1 || h < 1) return;
    for (const L of D.doc.layers) {
      if (!L.canvas) continue;
      const c = U.makeCanvas(w, h); U.ctx2d(c).drawImage(L.canvas, (L.x || 0) - x, (L.y || 0) - y);
      L.canvas = c; L.x = 0; L.y = 0;
      if (L.mask) { const m = U.makeCanvas(w, h); U.ctx2d(m).drawImage(L.mask, -x, -y); L.mask = m; }
    }
    D.doc.width = w; D.doc.height = h;
    GF.select.clear(); GF.view.zoomFit(); GF.ui.refreshLayers();
  }

  /* update() is a no-op — kept for API compatibility with forge-ui.js */
  function update() {}

  return { update, cropTo, fillSelection, deleteSelection, cutOut };
})();
