/* PixelTriks — polish.js
   Phase 5 UX polish: first-use tooltips and visual undo snapshot.
   (The floating 3D quick-action chips were removed — the context hotbar's
   3d-selected context is the single home for those actions.) */
'use strict';
window.GF = window.GF || {};

GF.polish = (function () {
  const $ = s => document.querySelector(s);
  const LS_KEY = 'pt-dismissed-tips';

  /* =================================================================
     First-use tooltips — one-sentence hints, dismissible, stored
     ================================================================= */
  const TIPS = {
    brush: 'Drag to paint. Alt+click to pick a color. Use Stabilize for smoother lines.',
    eraser: 'Drag to erase. Switch to Pixel mode for crisp edges.',
    wand: 'Click to select similar pixels. Shift+click to add, Alt+click to subtract.',
    select: 'Drag to select a region. Hold Shift for square/circle.',
    fill: 'Click to flood-fill with the brush color.',
    crop: 'Drag the handles to crop. Use Straighten to rotate.',
    text: 'Click on the canvas to place text.',
    move: 'Drag to reposition the active layer.',
    shape: 'Drag to draw a shape. Hold Shift to constrain proportions.',
    gradient: 'Drag on the canvas to draw a gradient.',
    scene3d: 'W/E/R for translate/rotate/scale. Q toggles world/local space.',
  };
  let dismissed = {};

  function loadDismissed() {
    try { dismissed = JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { dismissed = {}; }
  }
  function saveDismissed() {
    try { localStorage.setItem(LS_KEY, JSON.stringify(dismissed)); } catch (e) {}
  }

  function showTip(toolName) {
    if (!TIPS[toolName] || dismissed[toolName]) return;
    const existing = document.querySelector('.first-tip');
    if (existing) existing.remove();

    const tip = document.createElement('div');
    tip.className = 'first-tip';
    tip.innerHTML = `<span>${TIPS[toolName]}</span><button class="tip-dismiss" title="Dismiss">✕</button>`;
    tip.querySelector('.tip-dismiss').addEventListener('click', () => {
      dismissed[toolName] = true;
      saveDismissed();
      tip.remove();
    });
    const vp = $('#viewport');
    if (vp) vp.appendChild(tip);
    setTimeout(() => { if (tip.parentNode) tip.remove(); }, 8000);
  }

  /* =================================================================
     Init — show the 3D workspace tip once
     ================================================================= */
  function init() {
    loadDismissed();
    // Nudge the 3D workspace tip on first object selection.
    if (GF.scene3d && GF.scene3d.onChange) GF.scene3d.onChange(() => {
      if (GF.scene3d.count() > 0) showTip('scene3d');
    });
  }

  if (typeof window !== 'undefined') {
    const go = () => init();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else setTimeout(go, 0);
  }

  return { showTip };
})();
