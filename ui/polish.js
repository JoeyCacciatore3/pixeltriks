/* PixelTriks — polish.js
   Phase 5 UX polish: contextual quick-actions for 3D objects,
   first-use tooltips, and visual undo snapshot. */
'use strict';
window.GF = window.GF || {};

GF.polish = (function () {
  const $ = s => document.querySelector(s);
  const LS_KEY = 'pt-dismissed-tips';

  /* =================================================================
     Contextual quick-actions — floating chips near selected 3D object
     ================================================================= */
  let qBar = null;

  function buildQuickActions() {
    if (qBar) return;
    qBar = document.createElement('div');
    qBar.id = 'quick-actions';
    qBar.className = 'quick-actions';
    qBar.hidden = true;
    document.body.appendChild(qBar);

    if (GF.scene3d) {
      GF.scene3d.onChange(updateQuickActions);
    }
  }

  function updateQuickActions() {
    if (!qBar || !GF.scene3d) return;
    const id = GF.scene3d.selectedId();
    if (id == null) { qBar.hidden = true; return; }

    const actions = [
      { label: 'Paint', icon: '🖌', fn: () => { if (GF.paint3d) GF.paint3d.enter(id); } },
      { label: 'Material', icon: '◆', fn: () => showMaterialPicker(id) },
      { label: 'Frame', icon: '⊞', fn: () => GF.scene3d.frame() },
      { label: 'Duplicate', icon: '⊕', fn: () => duplicateObject(id) },
      { label: 'Delete', icon: '✕', fn: () => GF.scene3d.removeObject(id) },
    ];

    qBar.innerHTML = '';
    actions.forEach(a => {
      const chip = document.createElement('button');
      chip.className = 'qa-chip';
      chip.title = a.label;
      chip.innerHTML = `<span class="qa-icon">${a.icon}</span><span class="qa-label">${a.label}</span>`;
      chip.addEventListener('click', a.fn);
      qBar.appendChild(chip);
    });
    qBar.hidden = false;
  }

  function showMaterialPicker(id) {
    if (!GF.texture) return;
    const presets = GF.texture.listPresets();
    if (!presets.length) return;
    const existing = document.querySelector('.qa-mat-menu');
    if (existing) { existing.remove(); return; }

    const menu = document.createElement('div');
    menu.className = 'qa-mat-menu tb-dropdown-menu';
    menu.style.cssText = 'position:fixed;z-index:999;max-height:280px;overflow-y:auto;';
    const rect = qBar.getBoundingClientRect();
    menu.style.bottom = (window.innerHeight - rect.top + 4) + 'px';
    menu.style.right = '16px';

    presets.forEach(p => {
      const item = document.createElement('div');
      item.className = 'tb-dropdown-item';
      item.textContent = p.label;
      item.addEventListener('click', async () => {
        menu.remove();
        const maps = GF.texture.generateMaterial(p.id, 512, 512);
        if (!maps) return;
        const colorKey = GF.scene3d.addImageSource(maps.color, p.label + '-color');
        const normalKey = GF.scene3d.addImageSource(maps.normal, p.label + '-normal');
        GF.scene3d.setMaterial(id, {
          mapSource: colorKey, normalSource: normalKey,
          metalness: p.metalness, roughness: p.roughness
        });
        GF.util.toast(p.label + ' applied');
      });
      menu.appendChild(item);
    });
    document.body.appendChild(menu);
    const close = e => { if (!menu.contains(e.target)) { menu.remove(); document.removeEventListener('pointerdown', close); } };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
  }

  function duplicateObject(id) {
    if (!GF.scene3d) return;
    const o = GF.scene3d.getObject(id);
    if (!o) return;
    GF.scene3d.addPrimitive(o.prim || 'box').then(newId => {
      if (newId != null) {
        GF.scene3d.setObject(newId, { px: o.px + 0.5, py: o.py, pz: o.pz, rx: o.rx, ry: o.ry, rz: o.rz, sx: o.sx, sy: o.sy, sz: o.sz });
        GF.util.toast('Duplicated');
      }
    });
  }

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
     Visual undo — current-state snapshot thumbnail in history panel
     ================================================================= */
  function enhanceHistory() {
    const orig = GF.ui && GF.ui.renderHistory;
    if (!orig) return;
    GF.ui.renderHistory = function () {
      orig.call(GF.ui);
      addHistoryThumbnail();
    };
  }

  function addHistoryThumbnail() {
    const list = $('#history-list');
    if (!list || !GF.doc.doc.open) return;
    const current = list.querySelector('.hist-item.on');
    if (!current) return;
    const existing = current.querySelector('.hist-thumb');
    if (existing) return;

    try {
      const comp = GF.doc.composite();
      const thumb = document.createElement('canvas');
      thumb.className = 'hist-thumb';
      thumb.width = 36; thumb.height = 36;
      const tc = thumb.getContext('2d');
      const s = Math.min(36 / comp.width, 36 / comp.height);
      const w = comp.width * s, h = comp.height * s;
      tc.drawImage(comp, (36 - w) / 2, (36 - h) / 2, w, h);
      current.prepend(thumb);
    } catch (e) {}
  }

  /* =================================================================
     Init
     ================================================================= */
  function init() {
    loadDismissed();
    buildQuickActions();

    if (GF.ui && GF.ui.onToolChanged) {
      const origSetTool = GF.ui.setTool;
      if (origSetTool) {
        GF.ui.setTool = function (name) {
          origSetTool.call(GF.ui, name);
          showTip(name);
        };
      }
    }
    enhanceHistory();
  }

  if (typeof window !== 'undefined') {
    const go = () => init();
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else setTimeout(go, 0);
  }

  return { showTip, updateQuickActions };
})();
