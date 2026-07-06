/* PixelTriks — hotbar.js
   Context-aware bottom action bar. THE core of the Game Deck UI.
   Changes content based on: mode (2D/3D), selection state, active tool.
   Absorbs selection-bar.js outcomes as the '2d-selection' context.

   Architecture:
   - Each context defines a flat array of action buttons
   - render() rebuilds #actionbar innerHTML when context changes
   - detect() reads app state → returns context key
   - Wired to: tool change, selection change, mode change, doc open/close
   - ALL icons are inline SVG — no emoji, consistent across platforms
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

  /* ─── SVG icon library ───
     Every icon is an inline SVG string — pixel-perfect, theme-aware,
     no emoji rendering inconsistencies across platforms. */
  const I = {
    box:       '<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>',
    sphere:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/></svg>',
    cylinder:  '<svg viewBox="0 0 24 24"><ellipse cx="12" cy="6" rx="8" ry="3"/><path d="M4 6v12c0 1.66 3.58 3 8 3s8-1.34 8-3V6"/></svg>',
    plane:     '<svg viewBox="0 0 24 24"><path d="M2 16l10-6 10 6-10 6z"/></svg>',
    import:    '<svg viewBox="0 0 24 24"><path d="M12 3v12M12 15l-4-4M12 15l4-4"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
    trash:     '<svg viewBox="0 0 24 24"><path d="M5 7h14M9 7V5h6v2M7 7l1 13h8l1-13"/></svg>',
    duplicate: '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4h12"/></svg>',
    group:     '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><rect x="13" y="13" width="8" height="8" rx="1"/><path d="M11 7h2M7 11v2"/></svg>',
    material:  '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M8 8c2 4 6 4 8 0"/><path d="M12 3v18"/></svg>',
    frame:     '<svg viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/></svg>',
    flatten2d: '<svg viewBox="0 0 24 24"><path d="M12 3v12M8 11l4 4 4-4"/><rect x="4" y="19" width="16" height="2" rx="1"/></svg>',
    play:      '<svg viewBox="0 0 24 24"><polygon points="6,4 20,12 6,20"/></svg>',
    pause:     '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>',
    stop:      '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2"/></svg>',
    enhance:   '<svg viewBox="0 0 24 24"><path d="M12 3l1.5 3.5L17 8l-3.5 1.5L12 13l-1.5-3.5L7 8l3.5-1.5z"/><path d="M5 16l1 2 2 1-2 1-1 2-1-2-2-1 2-1z"/></svg>',
    wand:      '<svg viewBox="0 0 24 24"><path d="M4 20L13 11"/><path d="M16 3l1.2 2.8L20 7l-2.8 1.2L16 11l-1.2-2.8L12 7l2.8-1.2z" fill="currentColor" stroke="none"/></svg>',
    ai:        '<svg viewBox="0 0 24 24"><path d="M12 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"/><circle cx="18" cy="17" r="2"/><circle cx="6" cy="18" r="1.5"/></svg>',
    robot:     '<svg viewBox="0 0 24 24"><rect x="5" y="8" width="14" height="12" rx="3"/><circle cx="9" cy="14" r="1.5" fill="currentColor"/><circle cx="15" cy="14" r="1.5" fill="currentColor"/><path d="M12 3v5M9 3h6"/></svg>',
    adjust:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3v18" stroke-dasharray="2 2"/></svg>',
    filter:    '<svg viewBox="0 0 24 24"><path d="M4 4h16l-6 7v5l-4 3V11z"/></svg>',
    removeSel: '<svg viewBox="0 0 24 24"><path d="M12 3l2 4 4 2-4 2-2 4-2-4-4-2 4-2z"/><path d="M5 19l14-14" stroke-width="2.5"/></svg>',
    scissors:  '<svg viewBox="0 0 24 24"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4L8.12 15.88M14.47 14.48L20 20M8.12 8.12L12 12"/></svg>',
    bucket:    '<svg viewBox="0 0 24 24"><path d="M19 11l-8-8-8.6 8.6a2 2 0 0 0 0 2.8l5.2 5.2c.8.8 2 .8 2.8 0L19 11z"/><path d="M5 2l5 5M2 13h15"/></svg>',
    recolor:   '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3c0 5-4 9-9 9M12 3c0 5 4 9 9 9"/></svg>',
    copy:      '<svg viewBox="0 0 24 24"><rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V4h12"/></svg>',
    cropSel:   '<svg viewBox="0 0 24 24"><path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/></svg>',
    invert:    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9"/><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor"/></svg>',
    expand:    '<svg viewBox="0 0 24 24"><rect x="5" y="5" width="14" height="14" rx="2" stroke-dasharray="3 2"/><path d="M2 2l4 4M22 2l-4 4M2 22l4-4M22 22l-4-4"/></svg>',
    feather:   '<svg viewBox="0 0 24 24"><path d="M4 20s3-1 8-8c5-7 8-9 8-9"/><path d="M12 12l-6 6"/><path d="M16 4l-8 12"/></svg>',
    selectAll: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/></svg>',
    deselect:  '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2" stroke-dasharray="3 2"/><path d="M4 4l16 16" stroke-width="2.5"/></svg>',
    newLayer:  '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>',
    merge:     '<svg viewBox="0 0 24 24"><path d="M7 4h10M5 9h14M8 14h8M11 19h2"/></svg>',
    flatAll:   '<svg viewBox="0 0 24 24"><rect x="3" y="14" width="18" height="6" rx="2"/><path d="M7 4h10M5 9h14M12 14V9"/></svg>',
    swap:      '<svg viewBox="0 0 24 24"><path d="M8 3l-4 4 4 4"/><path d="M4 7h16"/><path d="M16 21l4-4-4-4"/><path d="M20 17H4"/></svg>',
    flipH:     '<svg viewBox="0 0 24 24"><path d="M12 3v18"/><path d="M16 7l4 5-4 5"/><path d="M8 7L4 12l4 5"/></svg>',
    flipV:     '<svg viewBox="0 0 24 24"><path d="M3 12h18"/><path d="M7 8L12 4l5 4"/><path d="M7 16l5 4 5-4"/></svg>',
    rotateCW:  '<svg viewBox="0 0 24 24"><path d="M12 5c4.4 0 8 3.6 8 8h-2c0-3.3-2.7-6-6-6s-6 2.7-6 6H4c0-4.4 3.6-8 8-8z"/><path d="M17 9l3 4-3 4"/></svg>',
    rotateCCW: '<svg viewBox="0 0 24 24"><path d="M12 5C7.6 5 4 8.6 4 13h2c0-3.3 2.7-6 6-6s6 2.7 6 6h2c0-4.4-3.6-8-8-8z"/><path d="M7 9L4 13l3 4"/></svg>',
    upscale:   '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="1"/><path d="M14 3h7v7M14 14h7v7H14zM3 14h7v7H3z" stroke-dasharray="2 2"/></svg>',
    trim:      '<svg viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="1"/><path d="M3 3h3M18 3h3M3 21h3M18 21h3"/></svg>',
    exportF:   '<svg viewBox="0 0 24 24"><path d="M12 15V3M8 7l4-4 4 4"/><rect x="4" y="14" width="16" height="7" rx="2"/></svg>',
    open:      '<svg viewBox="0 0 24 24"><path d="M4 4h5l2 2h9v14H4z"/></svg>',
    plus:      '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke-width="2.5"/></svg>',
    mask:      '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="12" cy="12" r="5" fill="currentColor"/></svg>',
    ink:       '<svg viewBox="0 0 24 24"><path d="M12 2C8 6 6 10 6 14a6 6 0 0 0 12 0c0-4-2-8-6-12z"/></svg>',
    clean:     '<svg viewBox="0 0 24 24"><circle cx="8" cy="8" r="3" fill="currentColor"/><circle cx="16" cy="8" r="3"/><circle cx="8" cy="16" r="3"/><circle cx="16" cy="16" r="3" fill="currentColor"/></svg>',
    assets:    '<svg viewBox="0 0 24 24"><path d="M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z"/></svg>',
    clipboard: '<svg viewBox="0 0 24 24"><rect x="6" y="4" width="12" height="16" rx="2"/><path d="M9 2h6v3H9z"/></svg>',
  };

  /* ─── Action definitions ───
     Each action: { icon (SVG string), label, action (fn), class? } */

  const ACTIONS = {
    // ─── 3D primitives ───
    'add-box':      { icon: I.box,       label: 'Box',      action: () => run('scene3d.addPrimitive', { kind: 'box' }) },
    'add-sphere':   { icon: I.sphere,    label: 'Sphere',   action: () => run('scene3d.addPrimitive', { kind: 'sphere' }) },
    'add-cylinder': { icon: I.cylinder,  label: 'Cylinder', action: () => run('scene3d.addPrimitive', { kind: 'cylinder' }) },
    'add-plane':    { icon: I.plane,     label: 'Plane',    action: () => run('scene3d.addPrimitive', { kind: 'plane' }) },
    'import-model': { icon: I.import,    label: 'Import',   action: () => { const i = document.createElement('input'); i.type = 'file'; i.accept = '.glb,.gltf,.obj,.fbx,.png,.jpg,.webp,.svg'; i.onchange = e => { if (e.target.files[0]) GF.library.handleDrop([e.target.files[0]]); }; i.click(); } },

    // ─── 3D object actions ───
    'obj-delete':   { icon: I.trash,     label: 'Delete',    action: () => run('scene3d.deleteSelected'), class: 'ab-face-b' },
    'obj-dup':      { icon: I.duplicate, label: 'Duplicate', action: () => run('scene3d.duplicateSelected') },
    'obj-group':    { icon: I.group,     label: 'Group',     action: () => run('scene3d.groupSelected') },
    'obj-material': { icon: I.material,  label: 'Material',  action: () => { const p = $('#panel'); if (p) p.dataset.tab = 'scene'; } },
    'obj-frame':    { icon: I.frame,     label: 'Frame',     action: () => run('scene3d.frameSelected') },
    'obj-flatten':  { icon: I.flatten2d, label: 'To 2D',     action: () => run('scene3d.flattenToLayer') },

    // ─── Animation ───
    'anim-play':    { icon: I.play,  label: 'Play',  action: () => { if (GF.animation) GF.animation.play(); }, class: 'ab-face-a' },
    'anim-pause':   { icon: I.pause, label: 'Pause', action: () => { if (GF.animation) GF.animation.pause(); } },
    'anim-stop':    { icon: I.stop,  label: 'Stop',  action: () => { if (GF.animation) GF.animation.stop(); } },

    // ─── 2D quick actions (image editing) ───
    'enhance':      { icon: I.enhance, label: 'Enhance',   action: () => run('adjust.autoLevels'), class: 'ab-ai' },
    'remove-bg':    { icon: I.wand,    label: 'Remove BG', action: () => { if (GF.ai) GF.ai.removeBg(); }, class: 'ab-ai' },
    'ai-gen':       { icon: I.robot,   label: 'AI Gen',    action: () => { if (GF.ui) GF.ui.openAIDialog(); }, class: 'ab-ai' },
    'quick-adjust': { icon: I.adjust,  label: 'Adjust',    action: () => { const p = $('#panel'); if (p) p.dataset.tab = 'adjust'; } },
    'filters':      { icon: I.filter,  label: 'Filters',   action: () => run('filters.open') },

    // ─── 2D selection outcomes ───
    'sel-remove':   { icon: I.removeSel, label: 'Remove',   action: () => selAction('remove') },
    'sel-cutout':   { icon: I.scissors,  label: 'Cut Out',  action: () => selAction('cutout') },
    'sel-fill':     { icon: I.bucket,    label: 'Fill',     action: () => selAction('fill') },
    'sel-ai':       { icon: I.robot,     label: 'AI Fill',  action: () => selAction('aiReplace'), class: 'ab-ai' },
    'sel-recolor':  { icon: I.recolor,   label: 'Recolor',  action: () => selAction('recolor') },
    'sel-copy':     { icon: I.copy,      label: 'Copy Lyr', action: () => selAction('copyLayer') },
    'sel-crop':     { icon: I.cropSel,   label: 'Crop',     action: () => selAction('crop') },
    'sel-invert':   { icon: I.invert,    label: 'Invert',   action: () => run('select.invert') },
    'sel-delete':   { icon: I.trash,     label: 'Delete',   action: () => selAction('delete'), class: 'ab-face-b' },
    'sel-expand':   { icon: I.expand,    label: 'Expand',   action: () => selAction('expand') },
    'sel-feather':  { icon: I.feather,   label: 'Feather',  action: () => selAction('feather') },
    'sel-none':     { icon: I.deselect,  label: 'Deselect', action: () => { GF.select.clear(); V().requestRender(); } },

    // ─── 2D painting workflow ───
    'swap-color':   { icon: I.swap,    label: 'Swap',      action: () => run('brush.swapColors') },
    'new-layer':    { icon: I.newLayer, label: 'New Layer', action: () => run('layer.add') },
    'merge-down':   { icon: I.merge,   label: 'Merge',     action: () => run('layer.mergeDown') },

    // ─── Transform operations ───
    'flip-h':       { icon: I.flipH,     label: 'Flip H',   action: () => run('flipLayer', { horizontal: true }) },
    'flip-v':       { icon: I.flipV,     label: 'Flip V',   action: () => run('flipLayer', { horizontal: false }) },
    'rotate-cw':    { icon: I.rotateCW,  label: 'Rot CW',   action: () => run('rotateLayer', { cw: true }) },
    'rotate-ccw':   { icon: I.rotateCCW, label: 'Rot CCW',  action: () => run('rotateLayer', { cw: false }) },
    'upscale':      { icon: I.upscale,   label: 'Upscale',  action: () => run('smartUpscale', { factor: 2, mode: 'photo' }) },
    'trim':         { icon: I.trim,      label: 'Trim',     action: () => run('trim') },
    'flatten-all':  { icon: I.flatAll,   label: 'Flatten',  action: () => run('flatten') },
    'dup-layer':    { icon: I.duplicate, label: 'Dup Lyr',  action: () => run('duplicateLayer') },
    'add-mask':     { icon: I.mask,      label: 'Mask',     action: () => run('addMask', { init: 'reveal' }) },

    // ─── Creative tools ───
    'ink-outline':  { icon: I.ink,   label: 'Ink Lines', action: () => run('inkOutline', { newLayer: true }) },
    'clean-colors': { icon: I.clean, label: 'Clean',     action: () => run('cleanColors', { colors: 8 }) },
    'copy-clip':    { icon: I.clipboard, label: 'Copy',  action: () => run('copyToClipboard') },

    // ─── Global / export ───
    'export':       { icon: I.exportF, label: 'Export', action: () => { const b = document.querySelector('#btn-export'); if (b) b.click(); }, class: 'ab-face-a' },
    'ai-tools':     { icon: I.ai,      label: 'AI',     action: () => { if (GF.ui) GF.ui.openAIDialog(); }, class: 'ab-ai' },

    // ─── Empty state ───
    'open-file':    { icon: I.open, label: 'Open', action: () => { if (GF.ui) document.querySelector('#btn-open').click(); } },
    'new-doc':      { icon: I.plus, label: 'New',  action: () => { if (GF.ui) document.querySelector('#empty-new').click(); } },

    // ─── Assets ───
    'assets':       { icon: I.assets, label: 'Assets', action: () => { const p = $('#panel'); if (p) p.dataset.tab = 'scene'; if (GF.assetsUI) GF.assetsUI.show(); } },
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

  /* ─── Context labels — shows what mode the hotbar is in ─── */
  const CTX_LABELS = {
    'empty':         'START',
    '3d-idle':       '3D SCENE',
    '3d-selected':   '3D OBJECT',
    '2d-idle':       'IMAGE',
    '2d-selection':  'SELECTION',
    '2d-painting':   'PAINTING',
    '2d-text':       'TEXT',
    'animation':     'PLAYING',
  };

  /* ─── Context definitions ───
     Each context: array of action IDs. '|' = separator.
     Ordered by frequency of use within the workflow. */

  const CONTEXTS = {
    'empty': ['open-file', 'new-doc'],

    '3d-idle': [
      'add-box', 'add-sphere', 'add-cylinder', 'add-plane', 'import-model',
      '|', 'anim-play',
      '|', 'ai-tools', 'assets', 'export'
    ],

    '3d-selected': [
      'obj-delete', 'obj-dup', 'obj-group', 'obj-material', 'obj-flatten', 'obj-frame',
      '|', 'anim-play',
      '|', 'export'
    ],

    '2d-idle': [
      'enhance', 'remove-bg', 'ai-tools', 'quick-adjust', 'filters',
      '|',
      'flip-h', 'flip-v', 'rotate-cw',
      '|',
      'new-layer', 'dup-layer', 'flatten-all',
      '|',
      'trim', 'copy-clip', 'export'
    ],

    '2d-selection': [
      'sel-remove', 'sel-cutout', 'sel-fill', 'sel-ai', 'sel-recolor', 'sel-copy',
      '|',
      'sel-crop', 'sel-expand', 'sel-feather', 'sel-invert',
      '|',
      'sel-none'
    ],

    '2d-painting': [
      'swap-color', 'new-layer', 'dup-layer', 'merge-down',
      '|',
      'flip-h', 'rotate-cw',
      '|',
      'ai-tools', 'export'
    ],

    '2d-text': [
      'new-layer', 'dup-layer', 'merge-down',
      '|',
      'flip-h', 'flip-v', 'rotate-cw',
      '|',
      'ai-tools', 'export'
    ],

    'animation': ['anim-stop', 'anim-pause'],
  };

  /* ─── Context detection ─── */
  function detect() {
    const doc = D();

    // No document open
    if (!doc || !doc.doc.open) return 'empty';

    // Animation playing
    if (GF.animation && GF.animation.isPlaying && GF.animation.isPlaying()) return 'animation';

    // Selection takes priority — a selection always gets outcome actions
    const sel = GF.select;
    if (sel && sel.has && sel.has()) return '2d-selection';

    // 3D mode
    if (is3D()) {
      const scene = S();
      if (scene && scene.selected && scene.selected()) return '3d-selected';
      return '3d-idle';
    }

    // Check active tool for specialized contexts
    const view = V();
    if (view && view.view) {
      const tool = view.view.tool;
      if (tool === 'brush' || tool === 'fill' || tool === 'gradient') return '2d-painting';
      if (tool === 'text') return '2d-text';
    }

    return '2d-idle';
  }

  /* ─── Render ─── */
  function render(context) {
    if (!barEl) return;
    if (context === currentContext) return;

    // Trigger swap animation
    barEl.classList.add('ab-switching');
    currentContext = context;

    const actions = CONTEXTS[context] || CONTEXTS['empty'];
    const label = CTX_LABELS[context] || '';
    let html = '<span class="ab-ctx-label">' + label + '</span>';

    for (const id of actions) {
      if (id === '|') {
        html += '<span class="ab-sep"></span>';
        continue;
      }
      const a = ACTIONS[id];
      if (!a) continue;
      const cls = 'ab-btn' + (a.class ? ' ' + a.class : '');
      html += '<button class="' + cls + '" data-hotbar="' + id + '" title="' + a.label + '">' +
        '<span class="ab-icon">' + a.icon + '</span><span class="ab-label">' + a.label + '</span>' +
        '</button>';
    }

    barEl.innerHTML = html;

    // Animate in
    requestAnimationFrame(function () {
      barEl.classList.remove('ab-switching');
    });
  }

  /* ─── Event wiring ─── */
  function wireEvents() {
    // Click delegation
    barEl.addEventListener('click', function (e) {
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

    // Slow poll as safety net
    setInterval(refresh, 2000);
  }

  /* ─── Public ─── */
  function init() {
    barEl = document.getElementById('actionbar');
    if (!barEl) {
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
