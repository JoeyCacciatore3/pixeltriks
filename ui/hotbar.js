/* PixelTriks — hotbar.js
   Context-aware bottom action bar. THE core of the Game Deck UI.
   Changes content based on: mode (2D/3D), selection state, active tool.
   Absorbs selection-bar.js outcomes as the '2d-selection' context.

   Architecture:
   - Each context defines a flat array of action buttons
   - render() rebuilds #actionbar innerHTML when context changes
   - detect() reads app state → returns context key
   - Wired to: tool change, selection change, mode change, doc open/close
*/
'use strict';
window.GF = window.GF || {};

GF.hotbar = (function () {
  const $ = s => document.querySelector(s);
  const D = () => GF.doc;
  const S = () => GF.scene3d;
  const V = () => GF.view;
  const U = GF.util;
  const is3D = () => document.body.dataset.mode === '3d';
  const run = (n, a) => { try { return GF.api.run(n, a); } catch (e) { U.toast(e.message); } };

  let barEl = null;
  let currentContext = null;

  /* ─── Action definitions ───
     Each action: { id, icon (SVG or emoji), label, action (fn), class? } */

  const ACTIONS = {
    // 3D primitives
    'add-box':      { icon: '□', svg: 'rect', label: 'Box',      action: () => run('scene3d.addPrimitive', { kind: 'box' }) },
    'add-sphere':   { icon: '○', svg: 'circle', label: 'Sphere',  action: () => run('scene3d.addPrimitive', { kind: 'sphere' }) },
    'add-cylinder': { icon: '◎', svg: 'cyl', label: 'Cylinder',  action: () => run('scene3d.addPrimitive', { kind: 'cylinder' }) },
    'add-plane':    { icon: '▭', svg: 'plane', label: 'Plane',   action: () => run('scene3d.addPrimitive', { kind: 'plane' }) },
    'import-model': { icon: '📂', label: 'Import', action: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.glb,.gltf,.obj,.fbx,.png,.jpg,.webp,.svg'; i.onchange = e => { if (e.target.files[0]) GF.library.handleDrop([e.target.files[0]]); }; i.click(); } },

    // 3D object actions
    'obj-delete':   { icon: '🗑', label: 'Delete',    action: () => run('scene3d.deleteSelected') },
    'obj-dup':      { icon: '⧉', label: 'Duplicate', action: () => run('scene3d.duplicateSelected') },
    'obj-group':    { icon: '⊞', label: 'Group',     action: () => run('scene3d.groupSelected') },
    'obj-material': { icon: '🎨', label: 'Material', action: () => { const p = $('#panel'); if (p) p.dataset.tab = 'scene'; } },
    'obj-frame':    { icon: '⊡', label: 'Frame',     action: () => run('scene3d.frameSelected') },
    'obj-flatten':  { icon: '⬇', label: 'Flatten',   action: () => run('scene3d.flattenToLayer') },

    // Animation
    'anim-play':    { icon: '▶', label: 'Play',  action: () => { if (GF.animation) GF.animation.play(); }, class: 'ab-accent' },
    'anim-pause':   { icon: '⏸', label: 'Pause', action: () => { if (GF.animation) GF.animation.pause(); } },
    'anim-stop':    { icon: '■', label: 'Stop',  action: () => { if (GF.animation) GF.animation.stop(); } },

    // 2D actions (no selection)
    'enhance':      { icon: '✨', label: 'Enhance',   action: () => run('adjust.autoLevels'), class: 'ab-ai' },
    'remove-bg':    { icon: '🪄', label: 'Remove BG', action: () => { if (GF.ai) GF.ai.removeBg(); }, class: 'ab-ai' },
    'ai-gen':       { icon: '🤖', label: 'AI Generate', action: () => { if (GF.ui) GF.ui.openAIDialog(); }, class: 'ab-ai' },
    'quick-adjust': { icon: '◐', label: 'Adjust',    action: () => { const p = $('#panel'); if (p) p.dataset.tab = 'adjust'; } },
    'filters':      { icon: '◈', label: 'Filters',   action: () => run('filters.open') },

    // 2D selection outcomes (from selection-bar.js)
    'sel-remove':   { icon: '✕', label: 'Remove',    action: () => selAction('remove') },
    'sel-cutout':   { icon: '✂', label: 'Cut Out',   action: () => selAction('cutout') },
    'sel-fill':     { icon: '🪣', label: 'Fill',     action: () => selAction('fill') },
    'sel-ai':       { icon: '🤖', label: 'AI Replace', action: () => selAction('aiReplace'), class: 'ab-ai' },
    'sel-recolor':  { icon: '🎨', label: 'Recolor',  action: () => selAction('recolor') },
    'sel-copy':     { icon: '📋', label: 'Copy Layer', action: () => selAction('copyLayer') },
    'sel-crop':     { icon: '⬚', label: 'Crop',      action: () => selAction('crop') },
    'sel-invert':   { icon: '◑', label: 'Invert',    action: () => run('select.invert') },
    'sel-delete':   { icon: '🗑', label: 'Delete',   action: () => selAction('delete') },
    'sel-expand':   { icon: '⊕', label: 'Expand',    action: () => selAction('expand') },
    'sel-feather':  { icon: '〰', label: 'Feather',  action: () => selAction('feather') },

    // 2D painting quick actions
    'swap-color':   { icon: '⇄', label: 'Swap',      action: () => run('brush.swapColors') },
    'new-layer':    { icon: '+', label: 'New Layer',   action: () => run('layer.add') },
    'merge-down':   { icon: '⬇', label: 'Merge',     action: () => run('layer.mergeDown') },

    // Empty state
    'open-file':    { icon: '📂', label: 'Open',     action: () => { if (GF.ui) document.querySelector('#btn-open').click(); } },
    'new-doc':      { icon: '+', label: 'New',        action: () => { if (GF.ui) document.querySelector('#empty-new').click(); } },

    // Assets
    'assets':       { icon: '🧩', label: 'Assets',   action: () => { const p = $('#panel'); if (p) p.dataset.tab = 'scene'; if (GF.assetsUI) GF.assetsUI.show(); } },
  };

  /* ─── Selection action engine ───
     Delegates to GF.selectionBar utility functions (selection-bar.js) for
     canvas-level operations (fill, cutout, crop). Falls back to GF.api
     engine commands for everything else. */
  function selAction(type) {
    const sb = GF.selectionBar;
    switch (type) {
      case 'remove':    run('contentAwareFill'); break;
      case 'cutout':    if (sb) sb.cutOut(); else { run('layerViaCopy'); run('eraseSelection'); } break;
      case 'fill':      if (sb) sb.fillSelection(); else run('eraseSelection'); break;
      case 'aiReplace': if (GF.ui) GF.ui.openAIDialog(); break;
      case 'recolor':   run('addAdjustment', { kind: 'hsl' }); break;
      case 'copyLayer': run('layerViaCopy'); break;
      case 'crop': {
        const b = GF.select.bounds();
        if (!b) { GF.util.toast('Nothing selected'); break; }
        if (sb) { GF.history.push(D().doc, 'crop to selection'); sb.cropTo(b.x, b.y, b.w, b.h); }
        break;
      }
      case 'invert':    GF.select.invert(); V().requestRender(); break;
      case 'delete':    if (sb) sb.deleteSelection(); else run('eraseSelection'); break;
      case 'expand':    if (GF.select.grow) { GF.select.grow(4); V().requestRender(); } break;
      case 'feather':   if (GF.select.feather) { GF.select.feather(3); V().requestRender(); } break;
    }
  }

  /* ─── Context definitions ───
     Each context: array of action IDs to show in the hotbar */

  const CONTEXTS = {
    'empty': ['open-file', 'new-doc'],
    '3d-idle': ['add-box', 'add-sphere', 'add-cylinder', 'add-plane', 'import-model', '|', 'anim-play', '|', 'ai-gen', 'assets'],
    '3d-selected': ['obj-delete', 'obj-dup', 'obj-group', 'obj-material', 'obj-flatten', 'obj-frame', '|', 'anim-play'],
    '2d-idle': ['enhance', 'remove-bg', 'ai-gen', 'quick-adjust', 'filters', '|', 'new-layer'],
    '2d-selection': ['sel-remove', 'sel-cutout', 'sel-fill', 'sel-ai', 'sel-recolor', 'sel-copy', 'sel-crop', 'sel-expand', 'sel-feather', 'sel-invert', 'sel-delete'],
    '2d-painting': ['swap-color', 'new-layer', 'merge-down', '|', 'ai-gen'],
    'animation': ['anim-stop', 'anim-pause'],
  };

  /* ─── Context detection ─── */
  function detect() {
    const doc = D();

    // No document open
    if (!doc || !doc.doc.open) return 'empty';

    // Animation playing
    if (GF.animation && GF.animation.isPlaying && GF.animation.isPlaying()) return 'animation';

    // Selection takes priority over mode — a selection always gets outcome actions
    const sel = GF.select;
    if (sel && sel.has && sel.has()) return '2d-selection';

    // 3D mode
    if (is3D()) {
      const scene = S();
      if (scene && scene.selected && scene.selected()) return '3d-selected';
      return '3d-idle';
    }

    // Check if actively painting
    const view = V();
    if (view && view.view && (view.view.tool === 'brush' || view.view.tool === 'fill' || view.view.tool === 'gradient')) {
      return '2d-painting';
    }

    return '2d-idle';
  }

  /* ─── Render ─── */
  function render(context) {
    if (!barEl) return;
    if (context === currentContext) return; // no change
    currentContext = context;

    const actions = CONTEXTS[context] || CONTEXTS['empty'];
    let html = '';

    for (const id of actions) {
      if (id === '|') {
        html += '<span class="ab-sep"></span>';
        continue;
      }
      const a = ACTIONS[id];
      if (!a) continue;
      const cls = 'ab-btn' + (a.class ? ' ' + a.class : '');
      html += `<button class="${cls}" data-hotbar="${id}" title="${a.label}">
        <span class="ab-icon">${a.icon}</span><span class="ab-label">${a.label}</span>
      </button>`;
    }

    barEl.innerHTML = html;
  }

  /* ─── Event wiring ─── */
  function wireEvents() {
    // Click delegation
    barEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-hotbar]');
      if (!btn) return;
      const action = ACTIONS[btn.dataset.hotbar];
      if (action) action.action();
    });

    // Listen to state changes and re-render
    window.addEventListener('pt:toolchange', refresh);
    window.addEventListener('pt:selectionchange', refresh);
    window.addEventListener('pt:modechange', refresh);
    window.addEventListener('pt:docopen', refresh);
    window.addEventListener('pt:docclose', refresh);
    window.addEventListener('pt:layerchange', refresh);
    window.addEventListener('pt:sceneselect', refresh);
    window.addEventListener('pt:animstate', refresh);

    // Also poll on a slow interval as a safety net
    setInterval(refresh, 2000);
  }

  /* ─── Public ─── */
  function init() {
    barEl = document.getElementById('actionbar');
    if (!barEl) {
      // Create it if missing
      barEl = document.createElement('div');
      barEl.id = 'actionbar';
      document.body.appendChild(barEl);
    }
    wireEvents();
    refresh();
  }

  function refresh() {
    const ctx = detect();
    render(ctx);
  }

  function getContext() { return currentContext; }

  return { init, refresh, detect, getContext };
})();
