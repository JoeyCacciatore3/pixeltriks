/* PixelTriks — selection-bar.js
   Contextual outcome bar after any selection.
   ALL actions visible as a flat grid. No hidden menus. */
'use strict';
window.GF = window.GF || {};

GF.selectionBar = (function () {
  const U = GF.util, D = GF.doc;
  const $ = s => document.querySelector(s);
  const V = () => GF.view.view;
  const run = (n, a) => { try { return GF.api.run(n, a); } catch (e) { U.toast(e.message); } };

  let barEl = null, bounds = null, _vsig = '';

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

  /* Every action the user can take on a selection — all visible, no hiding */
  const ACTIONS = [
    { ic: '🩹', label: 'Remove',      fn: () => run('contentAwareFill') },
    { ic: '✂️', label: 'Cut Out',      fn: cutOut },
    { ic: '🪣', label: 'Fill',         fn: fillSelection },
    { ic: '✦',  label: 'AI Replace',   fn: () => GF.ui.openAIDialog && GF.ui.openAIDialog(), ai: true },
    { ic: '🎨', label: 'Recolor',      fn: () => run('addAdjustment', { kind: 'hsl' }) },
    { ic: '⧉',  label: 'Copy Layer',   fn: () => run('layerViaCopy') },
    { ic: '⌗',  label: 'Crop to This', fn: () => { const b = GF.select.bounds(); if (b) { GF.history.push(D.doc, 'crop'); cropTo(b.x, b.y, b.w, b.h); } } },
    { ic: '⇄',  label: 'Invert',       fn: () => { GF.select.invert(); GF.view.requestRender(); } },
    { ic: '🗑', label: 'Delete',        fn: deleteSelection },
  ];

  function ensure() {
    if (barEl) return barEl;
    const bar = document.createElement('div'); bar.id = 'sel-bar'; bar.hidden = true;
    const btns = ACTIONS.map((a, i) =>
      `<button class="sel-act${a.ai ? ' ai' : ''}" data-i="${i}" title="${a.label}">
         <span class="sa-ic">${a.ic}</span><span class="sa-lb">${a.label}</span>
       </button>`).join('');
    bar.innerHTML =
      `<div class="sel-head">
         <span class="sel-count"></span>
         <button class="sel-x" type="button" title="Deselect (Esc)">✕</button>
       </div>
       <div class="sel-actions">${btns}</div>`;
    $('#viewport').appendChild(bar);
    const act = fn => { if (!D.doc.open) return U.toast('Open an image first'); fn(); update(); };
    bar.querySelectorAll('.sel-act').forEach(b => b.addEventListener('click', () => act(ACTIONS[+b.dataset.i].fn)));
    bar.querySelector('.sel-x').addEventListener('click', () => { GF.select.clear(); GF.view.requestRender(); });
    const vp = $('#viewport');
    ['wheel', 'pointermove', 'pointerup'].forEach(ev => vp.addEventListener(ev, () => position(), { passive: true }));
    window.addEventListener('resize', () => position(true));
    barEl = bar; return bar;
  }

  function position(force) {
    const bar = barEl; if (!bar || bar.hidden) return;
    if (!matchMedia('(min-width: 881px)').matches) { bar.classList.remove('floating'); bar.style.left = ''; bar.style.top = ''; _vsig = ''; return; }
    const v = V(); if (!v || !bounds) return;
    const sig = Math.round(v.zoom * 1000) + '|' + Math.round(v.panX) + '|' + Math.round(v.panY);
    if (sig === _vsig && !force) return;
    _vsig = sig;
    bar.classList.add('floating');
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const vpr = $('#viewport').getBoundingClientRect();
    const cx = v.panX + (bounds.x + bounds.w / 2) * v.zoom;
    let top = v.panY + bounds.y * v.zoom - bh - 14;
    if (top < 8) top = v.panY + (bounds.y + bounds.h) * v.zoom + 14;
    const left = U.clamp(cx, bw / 2 + 8, vpr.width - bw / 2 - 8);
    top = U.clamp(top, 8, vpr.height - bh - 8);
    bar.style.left = left + 'px'; bar.style.top = top + 'px';
  }

  function update() {
    // The floating selection bar is DISABLED — the context hotbar (hotbar.js)
    // now owns the selection action UI. This module is kept for its utility
    // functions (cropTo, fillSelection) that the hotbar delegates to.
    if (barEl) barEl.hidden = true;
  }

  return { update, ensure, cropTo, fillSelection, deleteSelection, cutOut };
})();
