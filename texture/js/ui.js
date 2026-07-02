/* Forge Studio — ui.js
   Binds every control to the engine. No framework: direct DOM with
   delegated updates, so the whole app runs from a double-clicked
   index.html. */
'use strict';
window.GF = window.GF || {};

GF.ui = (function () {
  const U = GF.util;
  const D = GF.doc;
  const V = () => GF.view.view;
  let openTextDialogImpl = null; // bound during init; called by the text tool

  /* Per-tool guidance: one action-first line shown live in the options bar,
     and reused (with the longer "use it for" text) in the Help dialog. */
  const TOOL_HELP = {
    move:        { name: 'Move (V)',          hint: 'Drag or arrow-keys to move the layer · Shift+arrow = 10px',
                   use: 'Reposition the active layer. Content pushed off-canvas is kept — Texture → Canvas → Reveal all brings it back.' },
    brush:       { name: 'Brush (B)',         hint: 'Drag to paint · [ ] resize · PIXEL = crisp pixel art · selection confines strokes',
                   use: 'Freehand painting with the color well at the bottom of the toolbar. Make a selection first to paint inside the lines.' },
    eraser:      { name: 'Eraser (E)',        hint: 'Drag to erase to transparent · uses brush size & opacity',
                   use: 'Erase pixels on the active layer. Low opacity gives a soft partial erase.' },
    fill:        { name: 'Fill (G)',          hint: 'Click to flood similar colors · TOLERANCE = how similar',
                   use: 'Bucket-fill a connected region of similar color. A selection acts as a wall the fill cannot cross.' },
    picker:      { name: 'Eyedropper (I)',    hint: 'Click to sample any visible color into the brush',
                   use: 'Grab a color from the composite — handy with the Palette extractor in the Texture tab.' },
    pan:         { name: 'Pan (H)',           hint: 'Drag to pan · wheel zooms · or hold Space with any tool',
                   use: 'Navigate the canvas. Pinch with two fingers on touch devices.' },
    wand:        { name: 'Magic wand (W)',    hint: 'Click = select similar colors · Shift add · Alt subtract · Esc deselect',
                   use: 'Select by color, then everything you do — paint, fill, filters, Delete — only touches the selection. Grow/feather it in the Retouch tab.' },
    magiceraser: { name: 'Magic eraser (X)',  hint: 'Click a region to erase it · HEAL rebuilds the background instead',
                   use: 'One-click cutouts. With HEAL on it becomes one-click object removal: the region is reconstructed from surrounding texture instead of going transparent.' },
    marquee:     { name: 'Select (M / L)',    hint: 'Drag to select · SHAPE = rect / ellipse / lasso · Shift add · Alt subtract · click = deselect',
                   use: 'Geometric selections. L jumps straight to the lasso. Combine with Ctrl+J (layer via copy) or Lift & heal in the Retouch tab.' },
    gradient:    { name: 'Gradient (D)',      hint: 'Drag from start color to end · linear or radial',
                   use: 'Fades for skies, vignettes and lighting. Starts at the brush color; END color or transparent finishes it. Respects selections.' },
    shape:       { name: 'Shape (U)',         hint: 'Drag to draw · Shift = perfect square / circle · stroke color = gradient END color',
                   use: 'Rectangles, ellipses and lines with fill and/or stroke — UI panels, hitboxes, frames.' },
    text:        { name: 'Text (T)',          hint: 'Click where the text should start — outline width gives game-style text',
                   use: 'Renders to its own layer so you can move and restyle it. Use the outline for readable game text on any background.' },
    clone:       { name: 'Clone stamp (C)',   hint: 'ALT-click sets the source ✛ · then paint to copy from it',
                   use: 'Duplicate detail or repair areas by painting from another part of the layer. Size and opacity come from the brush settings.' }
  };

  const RECIPES = [
    ['Remove an object from a photo', 'Magic eraser (X) with HEAL checked → click the object. Or: select it with W/M, then Retouch → Content-aware fill.'],
    ['Cut out a background', 'Retouch → Remove background (auto, from the edges) — or W-click it and press Delete. DEFRINGE kills the halo.'],
    ['Move something already in the image', 'Select it (W or M) → Retouch → Lift & heal → drag the new layer with V.'],
    ['Full game material from any image', 'Texture → Material wizard: albedo + normal + AO + roughness + packed ORM in one click, then 3D tab → Start preview.'],
    ['Sticker / outlined sprite', 'Retouch → Layer FX → Outline (or Glow / Drop shadow). The effect lands behind the layer.'],
    ['Pixel-art icon from a photo', 'Adjust → Pixelate + Posterize → Texture → Dithering → Retouch → Smart upscale (Pixel art).']
  ];

  /* =============== document lifecycle =============== */
  function onDocumentOpened() {
    U.$('#empty-state').hidden = true;
    U.$('#doc-name').textContent = D.doc.name;
    U.$('#doc-dims').textContent = D.doc.width + '×' + D.doc.height;
    if (GF.select) GF.select.clear();
    GF.view.zoomFit();
    refreshLayers();
  }

  function updateZoomLabel() {
    U.$('#zoom-label').textContent = Math.round(V().zoom * 100) + '%';
  }

  function showCursorPos(p) {
    if (!D.doc.open) return;
    U.$('#cursor-pos').textContent = Math.floor(p.x) + ', ' + Math.floor(p.y);
  }

  /* =============== layer panel =============== */
  function refreshLayers() {
    const list = U.$('#layer-list');
    list.innerHTML = '';
    // top of list = top of stack
    for (let i = D.doc.layers.length - 1; i >= 0; i--) {
      const L = D.doc.layers[i];
      const li = document.createElement('li');
      li.className = 'layer-item' + (L.id === D.doc.activeId ? ' active' : '');
      li.dataset.id = L.id;

      const thumb = document.createElement('div');
      thumb.className = 'thumb';
      if (L.canvas) {
        const tc = U.makeCanvas(36, 36);
        const tctx = U.ctx2d(tc);
        const s = Math.min(36 / D.doc.width, 36 / D.doc.height);
        tctx.imageSmoothingEnabled = true;
        tctx.drawImage(L.canvas, 0, 0, D.doc.width * s, D.doc.height * s);
        thumb.appendChild(tc);
      } else {
        thumb.classList.add('adjust-thumb');   // adjustment layer — no pixels
        thumb.textContent = '◐';
      }
      // mask indicator chip (active layer shows it's mask-editable)
      if (L.mask) {
        const mk = document.createElement('span');
        mk.className = 'maskchip' + (D.doc.maskEdit && L.id === D.doc.activeId ? ' editing' : '');
        mk.textContent = 'M';
        mk.title = 'Layer has a mask' + (L.id === D.doc.activeId ? ' — click to toggle mask-edit' : '');
        mk.addEventListener('click', e => {
          e.stopPropagation();
          if (L.id !== D.doc.activeId) { D.doc.activeId = L.id; }
          D.doc.maskEdit = !D.doc.maskEdit;
          refreshLayers(); syncLayerControls && syncLayerControls();
        });
        thumb.appendChild(mk);
      }

      const name = document.createElement('span');
      name.className = 'lname';
      name.textContent = L.name + (L.adjust ? ' ⚙' : '');
      name.title = 'Double-tap to rename';

      const vis = document.createElement('button');
      vis.className = 'vis' + (L.visible ? ' on' : '');
      vis.textContent = L.visible ? '👁' : '–';
      vis.setAttribute('aria-label', L.visible ? 'Hide layer' : 'Show layer');
      vis.addEventListener('click', e => {
        e.stopPropagation();
        L.visible = !L.visible;
        refreshLayers();
        GF.view.requestRender();
      });

      li.appendChild(thumb); li.appendChild(name); li.appendChild(vis);
      li.addEventListener('click', () => {
        D.doc.activeId = L.id;
        D.clearPreview();
        refreshLayers();
        syncLayerControls();
      });
      li.addEventListener('dblclick', () => {
        const next = prompt('Layer name', L.name);
        if (next && next.trim()) { L.name = next.trim(); refreshLayers(); populatePackSelects(); }
      });
      list.appendChild(li);
    }
    syncLayerControls();
    populatePackSelects();
    updateNineSliceSummary();
    GF.view.requestRender();
  }

  /** Show/hide the 9-slice summary line under the layer controls. Hoisted so
      refreshLayers can call it before the bindings inside init() run. */
  function updateNineSliceSummary() {
    const el = U.$('#ns-summary');
    if (!el) return;
    const L = D.doc.open ? D.active() : null;
    if (L && L.nineSlice) {
      const ns = L.nineSlice;
      el.textContent = '9-slice: ' + ns.top + ' / ' + ns.right + ' / ' + ns.bottom + ' / ' + ns.left + ' (T / R / B / L)';
      el.hidden = false;
    } else {
      el.hidden = true;
    }
  }

  /** Recompute the curves-editor histogram from the active layer (or composite). */
  function refreshHistogram() {
    if (!D.doc.open || !window.GF.curveEditor) return;
    const L = D.active();
    const src = (L && L.canvas) ? D.docAligned(L).canvas : D.composite();
    try { GF.curveEditor.setHistogram(GF.filters.histogram(U.ctx2d(src).getImageData(0, 0, D.doc.width, D.doc.height), GF.curveEditor.getChannel())); } catch (e) {}
  }

  function syncLayerControls() {
    const L = D.active();
    if (!L) return;
    U.$('#layer-blend').value = L.blend;
    U.$('#layer-opacity').value = Math.round(L.opacity * 100);
    U.$('#layer-opacity-val').textContent = Math.round(L.opacity * 100);
    // mask controls
    const me = U.$('#mask-edit'); if (me) me.checked = !!(D.doc.maskEdit && L.mask);
    // adjustment-layer params sub-panel
    const ap = U.$('#adj-params');
    if (ap) {
      if (L.adjust) {
        ap.hidden = false;
        const show = { brightnessContrast: ['brightness', 'contrast'], hsl: ['h', 's', 'l'], posterize: ['levels'], invert: [], grayscale: [], autoLevels: [], curves: [] }[L.adjust.kind] || [];
        ap.querySelectorAll('.slider-row[data-p]').forEach(row => { row.hidden = !show.includes(row.dataset.p); });
        const p = L.adjust.params || {};
        show.forEach(k => { const el = U.$('#adjp-' + k); if (el) { el.value = p[k] != null ? p[k] : (k === 'levels' ? 4 : 0); const bb = el.closest('.slider-row').querySelector('b'); if (bb) bb.textContent = el.value; } });
        U.$('#adj-clip').checked = !!L.clip;
        if (L.adjust.kind === 'curves' && window.GF.curveEditor) { GF.curveEditor.setCurves(p.curves || {}); refreshHistogram(); }
      } else ap.hidden = true;
    }
  }

  function populatePackSelects() {
    ['#pack-r', '#pack-g', '#pack-b'].forEach(sel => {
      const el = U.$(sel);
      const cur = el.value;
      el.innerHTML = '<option value="">— none —</option>' +
        D.doc.layers.map(L => `<option value="${L.id}">${escapeHtml(L.name)}</option>`).join('');
      if ([...el.options].some(o => o.value === cur)) el.value = cur;
    });
  }
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  function requireLayer() {
    const L = D.active();
    if (!L) { U.toast('Open a document first'); return null; }
    return L;
  }

  /* =============== bind everything =============== */
  function init() {
    /* --- tabs --- */
    U.$$('.ptab').forEach(tab => tab.addEventListener('click', () => {
      U.$$('.ptab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      U.$$('.panel').forEach(p => { p.hidden = true; });
      U.$('#panel-' + tab.dataset.panel).hidden = false;
      D.clearPreview(); GF.view.requestRender();
      if (tab.dataset.panel === 'adjust') refreshHistogram();
    }));

    /* --- mobile drawer --- */
    const drawer = U.$('#drawer-toggle');
    drawer.addEventListener('click', () => {
      const open = U.$('#sidepanel').classList.toggle('open');
      drawer.textContent = open ? 'PANELS ▾' : 'PANELS ▴';
    });

    /* --- tools --- */
    U.$$('.tool-btn').forEach(btn => btn.addEventListener('click', () => setTool(btn.dataset.tool)));
    function setTool(tool) {
      V().tool = tool;
      U.$$('.tool-btn').forEach(b => b.classList.toggle('active', b.dataset.tool === tool));
      U.$('#opt-brush').hidden = !(tool === 'brush' || tool === 'eraser' || tool === 'clone');
      U.$('#opt-fill').hidden = tool !== 'fill';
      U.$('#opt-wand').hidden = !(tool === 'wand' || tool === 'magiceraser');
      U.$('#opt-marquee').hidden = tool !== 'marquee';
      U.$('#opt-gradient').hidden = tool !== 'gradient';
      U.$('#opt-shape').hidden = tool !== 'shape';
      U.$('#opt-clone').hidden = tool !== 'clone';
      U.$('#wand-heal-row').hidden = tool !== 'magiceraser';
      U.$('#tool-hint').textContent = TOOL_HELP[tool] ? TOOL_HELP[tool].hint : '';
      GF.view.requestRender(); // show/hide the move bounds outline
    }

    bindRange('#brush-size', '#brush-size-val', v => { V().brush.size = v; });
    bindRange('#brush-opacity', '#brush-opacity-val', v => { V().brush.opacity = v / 100; });
    bindRange('#brush-hardness', '#brush-hardness-val', v => { V().brush.hardness = v; });
    bindRange('#brush-flow', '#brush-flow-val', v => { V().brush.flow = v; });
    bindRange('#brush-spacing', '#brush-spacing-val', v => { V().brush.spacing = v; });
    bindRange('#fill-tolerance', '#fill-tolerance-val', v => { V().fillTolerance = v; });
    U.$('#brush-pixel').addEventListener('change', e => { V().brush.pixel = e.target.checked; });
    U.$('#brush-shape').addEventListener('change', e => { V().brush.shape = e.target.value; });
    U.$('#brush-color').addEventListener('input', e => { V().brush.color = e.target.value; });
    bindRange('#wand-tolerance', '#wand-tolerance-val', v => { V().wand.tolerance = v; });
    U.$('#wand-contiguous').addEventListener('change', e => { V().wand.contiguous = e.target.checked; });
    U.$('#wand-defringe').addEventListener('change', e => { V().wand.defringe = e.target.checked; });
    U.$('#wand-heal').addEventListener('change', e => { V().wand.heal = e.target.checked; });
    U.$('#marquee-shape').addEventListener('change', e => { V().marquee.shape = e.target.value; });
    U.$('#grad-kind').addEventListener('change', e => { V().gradient.kind = e.target.value; });
    U.$('#grad-toalpha').addEventListener('change', e => { V().gradient.toAlpha = e.target.checked; });
    U.$('#grad-color2').addEventListener('input', e => { V().gradient.color2 = e.target.value; });
    U.$('#shape-kind').addEventListener('change', e => { V().shape.kind = e.target.value; });
    U.$('#shape-fill').addEventListener('change', e => { V().shape.fill = e.target.checked; });
    U.$('#shape-stroke').addEventListener('change', e => { V().shape.stroke = e.target.checked; });
    bindRange('#shape-strokew', '#shape-strokew-val', v => { V().shape.strokeW = v; });

    // live selection HUD (pixel count) in the options bar
    GF.select.onChange(() => {
      const n = GF.select.count();
      U.$('#sel-count').textContent = n ? 'SEL ' + n.toLocaleString() + 'px' : '';
    });

    /* --- topbar --- */
    U.$('#btn-undo').addEventListener('click', doUndo);
    U.$('#btn-redo').addEventListener('click', doRedo);
    GF.history.onChange((u, r) => {
      U.$('#btn-undo').disabled = !u;
      U.$('#btn-redo').disabled = !r;
    });
    U.$('#btn-zoom-in').addEventListener('click', () => centerZoom(1.25));
    U.$('#btn-zoom-out').addEventListener('click', () => centerZoom(1 / 1.25));
    U.$('#btn-zoom-fit').addEventListener('click', () => GF.view.zoomFit());
    U.$('#btn-new').addEventListener('click', () => U.$('#dlg-new').showModal());
    U.$('#empty-new').addEventListener('click', () => U.$('#dlg-new').showModal());
    U.$('#btn-library').addEventListener('click', () => GF.library.open());
    U.$('#empty-lib').addEventListener('click', () => GF.library.open());
    U.$('#btn-open').addEventListener('click', () => U.$('#file-input').click());
    U.$('#btn-save').addEventListener('click', () => {
      if (!D.doc.open) { U.toast('Nothing to save yet'); return; }
      GF.exporter.saveProject();
    });
    U.$('#btn-export').addEventListener('click', () => {
      if (!D.doc.open) { U.toast('Nothing to export yet'); return; }
      U.$('#dlg-export').showModal();
    });

    function centerZoom(f) {
      const r = U.$('#viewport').getBoundingClientRect();
      GF.view.zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
    }
    function doUndo() { if (GF.history.undo(D.doc)) { refreshLayers(); U.toast('Undo'); } }
    function doRedo() { if (GF.history.redo(D.doc)) { refreshLayers(); U.toast('Redo'); } }

    /* --- file input + drag & drop --- */
    U.$('#file-input').addEventListener('change', e => {
      GF.exporter.handleFiles(e.target.files);
      e.target.value = '';
    });
    const vp = U.$('#viewport-wrap');
    vp.addEventListener('dragover', e => e.preventDefault());
    vp.addEventListener('drop', e => {
      e.preventDefault();
      if (e.dataTransfer.files.length) GF.exporter.handleFiles(e.dataTransfer.files);
    });

    /* --- new document dialog --- */
    U.$('#new-preset').addEventListener('change', e => {
      U.$('#new-custom').hidden = e.target.value !== 'custom';
    });
    U.$('#form-new').addEventListener('submit', e => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      let w, h;
      const preset = U.$('#new-preset').value;
      if (preset === 'custom') {
        w = U.clamp(parseInt(U.$('#new-w').value, 10) || 512, 1, 8192);
        h = U.clamp(parseInt(U.$('#new-h').value, 10) || 512, 1, 8192);
      } else {
        [w, h] = preset.split('x').map(Number);
      }
      const bg = U.$('#new-bg').value;
      D.newDocument(w, h, bg === 'transparent' ? null : bg, 'untitled');
      onDocumentOpened();
      if (w * h > 2048 * 2048) {
        U.toast('Heads up: filters on canvases above 2048² can take a few seconds.');
      }
    });

    /* --- export dialog --- */
    bindRange('#exp-quality', null, () => {});
    U.$('#exp-format').addEventListener('change', e => {
      U.$('#exp-quality').parentElement.style.display =
        e.target.value === 'image/png' ? 'none' : 'flex';
    });
    // 9-slice toggle reveals the W×H inputs
    U.$('#exp-nineslice').addEventListener('change', e => {
      U.$('#exp-nineslice-size').hidden = !e.target.checked;
      // pre-fill with the layer's own size when first opened so users have a sane anchor
      if (e.target.checked && D.doc.open) {
        const L = D.active();
        if (L) { U.$('#exp-ns-w').value = L.canvas.width; U.$('#exp-ns-h').value = L.canvas.height; }
      }
    });
    // split-layers and 9-slice are mutually exclusive at the export level
    U.$('#exp-split-layers').addEventListener('change', e => {
      if (e.target.checked) { U.$('#exp-nineslice').checked = false; U.$('#exp-nineslice-size').hidden = true; }
    });

    U.$('#form-export').addEventListener('submit', e => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      const opts = {
        type: U.$('#exp-format').value,
        quality: parseInt(U.$('#exp-quality').value, 10) / 100,
        scale: parseFloat(U.$('#exp-scale').value),
        activeOnly: U.$('#exp-active-only').checked,
        splitLayers: U.$('#exp-split-layers').checked
      };
      if (U.$('#exp-nineslice').checked) {
        const A = D.active();
        if (!A || !A.nineSlice) {
          U.toast('Set 9-slice insets on the active layer first (Layers panel → 9-slice…)', 5000);
          return;
        }
        opts.nineSliceTarget = {
          w: U.clamp(parseInt(U.$('#exp-ns-w').value, 10) || A.canvas.width, 1, 8192),
          h: U.clamp(parseInt(U.$('#exp-ns-h').value, 10) || A.canvas.height, 1, 8192)
        };
      }
      GF.exporter.exportImage(opts).catch(err => U.toast(err.message));
    });

    /* --- 9-slice dialog (Layers panel → 9-slice…) --- */
    U.$('#tf-nineslice').addEventListener('click', () => {
      if (!requireLayer()) return;
      const L = D.active();
      const ns = L.nineSlice || { top: 8, right: 8, bottom: 8, left: 8 };
      U.$('#ns-top').value    = ns.top;
      U.$('#ns-right').value  = ns.right;
      U.$('#ns-bottom').value = ns.bottom;
      U.$('#ns-left').value   = ns.left;
      U.$('#dlg-nineslice').showModal();
    });
    U.$('#form-nineslice').addEventListener('submit', e => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      const L = D.active();
      if (!L) return;
      if (e.submitter && e.submitter.value === 'clear') {
        L.nineSlice = null;
        updateNineSliceSummary();
        U.toast('9-slice cleared');
        return;
      }
      L.nineSlice = {
        top:    U.clamp(parseInt(U.$('#ns-top').value, 10)    || 0, 0, 4096),
        right:  U.clamp(parseInt(U.$('#ns-right').value, 10)  || 0, 0, 4096),
        bottom: U.clamp(parseInt(U.$('#ns-bottom').value, 10) || 0, 0, 4096),
        left:   U.clamp(parseInt(U.$('#ns-left').value, 10)   || 0, 0, 4096)
      };
      updateNineSliceSummary();
      U.toast('9-slice set — use Export → "9-slice" to render at any size');
    });

    /* --- layer masks --- */
    const afterDocEdit = () => { refreshLayers(); GF.view.requestRender(); };
    U.$('#mask-add').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      if (L.mask) { U.toast('Layer already has a mask'); return; }
      GF.history.push(D.doc, 'add mask'); D.addMask(L, 'reveal');
      D.doc.maskEdit = true; afterDocEdit();
    });
    U.$('#mask-from-sel').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      if (!GF.select.has()) { U.toast('Make a selection first (W)'); return; }
      GF.history.push(D.doc, 'mask from selection');
      D.removeMask(L); D.addMask(L, 'selection'); afterDocEdit();
    });
    U.$('#mask-invert').addEventListener('click', () => {
      const L = requireLayer(); if (!L || !L.mask) { U.toast('No mask on this layer'); return; }
      GF.history.push(D.doc, 'invert mask'); D.invertMask(L); afterDocEdit();
    });
    U.$('#mask-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L || !L.mask) { U.toast('No mask on this layer'); return; }
      GF.history.push(D.doc, 'apply mask'); D.applyMask(L); D.doc.maskEdit = false; afterDocEdit();
    });
    U.$('#mask-remove').addEventListener('click', () => {
      const L = requireLayer(); if (!L || !L.mask) { U.toast('No mask on this layer'); return; }
      GF.history.push(D.doc, 'remove mask'); D.removeMask(L); D.doc.maskEdit = false; afterDocEdit();
    });
    U.$('#mask-edit').addEventListener('change', e => {
      const L = D.active();
      if (e.target.checked && (!L || !L.mask)) { e.target.checked = false; U.toast('Add a mask first'); return; }
      D.doc.maskEdit = e.target.checked; refreshLayers();
    });

    /* --- adjustment layers --- */
    U.$('#adj-add').addEventListener('click', () => {
      if (!requireLayer()) return;
      const kind = U.$('#adj-kind').value;
      GF.history.push(D.doc, 'add adjustment');
      D.addAdjustment(kind, {});
      afterDocEdit();
    });
    U.$('#adj-clip').addEventListener('change', e => {
      const L = D.active(); if (!L || !L.adjust) return;
      GF.history.push(D.doc, 'clip adjustment'); L.clip = e.target.checked; afterDocEdit();
    });
    // adjustment param sliders: one undo step per drag (push on pointerdown), live update on input
    ['brightness', 'contrast', 'h', 's', 'l', 'levels'].forEach(k => {
      const el = U.$('#adjp-' + k);
      el.addEventListener('pointerdown', () => { const L = D.active(); if (L && L.adjust) GF.history.push(D.doc, 'edit adjustment'); });
      el.addEventListener('input', () => {
        const L = D.active(); if (!L || !L.adjust) return;
        const v = parseInt(el.value, 10);
        const bb = el.closest('.slider-row').querySelector('b'); if (bb) bb.textContent = v;
        D.setAdjust(L, { [k]: v });
        GF.view.requestRender();
      });
    });

    /* --- curves editor --- */
    GF.curveEditor.init({
      canvas: U.$('#curve-canvas'),
      onStart: () => { const L = D.active(); if (L && L.adjust && L.adjust.kind === 'curves') GF.history.push(D.doc, 'edit curves'); },
      onChange: () => {
        const L = D.active();
        if (L && L.adjust && L.adjust.kind === 'curves') { D.setAdjust(L, { curves: GF.curveEditor.getCurves() }); GF.view.requestRender(); }
      },
    });
    U.$('#curve-channel').addEventListener('change', e => { GF.curveEditor.setChannel(e.target.value); refreshHistogram(); });
    U.$('#curve-reset').addEventListener('click', () => GF.curveEditor.resetChannel());
    U.$('#curve-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const luts = GF.filters.curveLuts(GF.curveEditor.getCurves());
      GF.filters.applyToLayer(L, 'curves', img => GF.filters.curves(img, luts));
      refreshLayers(); refreshHistogram(); U.toast('Curves applied');
    });
    U.$('#curve-adjlayer').addEventListener('click', () => {
      if (!requireLayer()) return;
      GF.history.push(D.doc, 'add curves');
      D.addAdjustment('curves', { curves: GF.curveEditor.getCurves() });
      refreshLayers(); refreshHistogram(); GF.view.requestRender();
    });

    /* --- layer panel --- */
    U.$('#layer-add').addEventListener('click', () => {
      if (!requireLayer()) return;
      GF.history.push(D.doc, 'add layer');
      D.addLayer(null);
      refreshLayers();
    });
    U.$('#layer-dup').addEventListener('click', () => {
      if (!requireLayer()) return;
      GF.history.push(D.doc, 'duplicate');
      D.duplicateActive();
      refreshLayers();
    });
    U.$('#layer-del').addEventListener('click', () => {
      if (!requireLayer()) return;
      GF.history.push(D.doc, 'delete layer');
      if (!D.deleteActive()) { GF.history.undo(D.doc); U.toast('A document needs at least one layer.'); }
      refreshLayers();
    });
    U.$('#layer-merge').addEventListener('click', () => {
      if (!requireLayer()) return;
      GF.history.push(D.doc, 'merge down');
      if (!D.mergeDown()) { GF.history.undo(D.doc); U.toast('No layer below to merge into.'); }
      refreshLayers();
    });
    U.$('#layer-up').addEventListener('click', () => {
      if (!requireLayer()) return;
      GF.history.push(D.doc, 'reorder');
      if (!D.moveActive(1)) GF.history.undo(D.doc);
      refreshLayers();
    });
    U.$('#layer-down').addEventListener('click', () => {
      if (!requireLayer()) return;
      GF.history.push(D.doc, 'reorder');
      if (!D.moveActive(-1)) GF.history.undo(D.doc);
      refreshLayers();
    });
    U.$('#layer-blend').addEventListener('change', e => {
      const L = requireLayer(); if (!L) return;
      GF.history.push(D.doc, 'blend mode');
      L.blend = e.target.value;
      GF.view.requestRender();
    });
    U.$('#layer-opacity').addEventListener('input', e => {
      const L = D.active(); if (!L) return;
      L.opacity = parseInt(e.target.value, 10) / 100;
      U.$('#layer-opacity-val').textContent = e.target.value;
      GF.view.requestRender();
    });
    U.$('#layer-opacity').addEventListener('change', () => {
      // one history entry per slider gesture would need a pre-snapshot;
      // opacity is cheap and reversible by hand, so we keep it light.
      GF.view.requestRender();
    });

    /* --- adjust panel --- */
    wireSliderLabels('#panel-adjust');
    // Live preview: drag a slider to see the effect before committing (display
    // only — the pixels aren't touched until Apply).
    const previewFns = {
      light: () => { const b = +U.$('#adj-brightness').value, c = +U.$('#adj-contrast').value; return img => GF.filters.brightnessContrast(img, b, c); },
      color: () => { const h = +U.$('#adj-hue').value, s = +U.$('#adj-sat').value, l = +U.$('#adj-light').value; return img => GF.filters.hsl(img, h, s, l); },
      poster: () => { const lv = +U.$('#adj-poster').value; return img => GF.filters.posterize(img, lv); },
    };
    const livePreview = (sliders, key) => sliders.forEach(sel => U.$(sel).addEventListener('input', () => {
      const L = D.active(); if (!L || !L.canvas) return;
      D.setPreview(L.id, previewFns[key]()); GF.view.requestRender();
    }));
    livePreview(['#adj-brightness', '#adj-contrast'], 'light');
    livePreview(['#adj-hue', '#adj-sat', '#adj-light'], 'color');
    livePreview(['#adj-poster'], 'poster');

    U.$('#adj-light-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const b = +U.$('#adj-brightness').value, c = +U.$('#adj-contrast').value;
      if (!b && !c) { U.toast('Move a slider first'); return; }
      U.busy('Applying…', () => {
        D.clearPreview();
        GF.filters.applyToLayer(L, 'brightness/contrast', img => GF.filters.brightnessContrast(img, b, c));
        resetSliders(['#adj-brightness', '#adj-contrast']);
        refreshLayers();
      });
    });
    U.$('#adj-light-reset').addEventListener('click', () => { D.clearPreview(); resetSliders(['#adj-brightness', '#adj-contrast']); GF.view.requestRender(); });
    U.$('#adj-color-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const h = +U.$('#adj-hue').value, s = +U.$('#adj-sat').value, l = +U.$('#adj-light').value;
      if (!h && !s && !l) { U.toast('Move a slider first'); return; }
      U.busy('Applying…', () => {
        D.clearPreview();
        GF.filters.applyToLayer(L, 'hue/saturation', img => GF.filters.hsl(img, h, s, l));
        resetSliders(['#adj-hue', '#adj-sat', '#adj-light']);
        refreshLayers();
      });
    });
    U.$('#adj-color-reset').addEventListener('click', () => { D.clearPreview(); resetSliders(['#adj-hue', '#adj-sat', '#adj-light']); GF.view.requestRender(); });

    U.$$('#panel-adjust [data-quick]').forEach(btn => btn.addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const kind = btn.dataset.quick;
      U.busy('Applying ' + kind + '…', () => {
        GF.filters.applyToLayer(L, kind, img => GF.filters[kind === 'autolevel' ? 'autoLevels' : kind](img));
        refreshLayers();
      });
    }));

    U.$('#adj-poster-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const levels = +U.$('#adj-poster').value;
      U.busy('Posterizing…', () => {
        D.clearPreview();
        GF.filters.applyToLayer(L, 'posterize', img => GF.filters.posterize(img, levels));
        refreshLayers();
      });
    });
    U.$('#adj-pixel-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const block = +U.$('#adj-pixel').value;
      U.busy('Pixelating…', () => {
        D.bakeOffset(L);
        GF.history.push(D.doc, 'pixelate');
        const masked = GF.select.has();
        const orig = masked ? GF.filters.getData(L).data.slice() : null;
        GF.filters.pixelate(L, block);
        if (masked) {
          const img = GF.filters.getData(L);
          GF.filters.blendBySelection(L, img, orig);
          GF.filters.putData(L, img);
        }
        refreshLayers();
      });
    });

    /* --- texture panel --- */
    wireSliderLabels('#panel-texture');

    U.$('#nm-generate').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const strength = +U.$('#nm-strength').value;
      const invertY = U.$('#nm-invert-y').checked;
      const wrap = U.$('#nm-wrap').checked;
      U.busy('Generating normal map…', () => {
        const nm = GF.texture.normalMap(D.docAligned(L), strength, invertY, wrap);
        GF.history.push(D.doc, 'normal map');
        const NL = D.addLayer(L.name + ' normal');
        U.ctx2d(NL.canvas).drawImage(nm, 0, 0);
        refreshLayers();
        U.toast('Normal map added as a layer');
      });
    });

    U.$('#pbr-generate').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      U.busy('Generating PBR set…', () => {
        const set = GF.texture.pbrSet(D.docAligned(L));
        GF.history.push(D.doc, 'PBR set');
        [['height', set.height], ['ao', set.ao], ['roughness', set.roughness]].forEach(([suffix, cnv]) => {
          const NL = D.addLayer(L.name + ' ' + suffix);
          U.ctx2d(NL.canvas).drawImage(cnv, 0, 0);
          NL.visible = false; // PBR maps land hidden so they don't cover the artwork
        });
        refreshLayers();
        U.toast('Height, AO and roughness layers added (hidden — toggle to view)');
      });
    });

    U.$('#tile-make').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const pct = +U.$('#tile-blend').value;
      U.busy('Blending seams…', () => {
        const tiled = GF.texture.makeSeamless(D.docAligned(L), pct);
        GF.history.push(D.doc, 'seamless');
        const NL = D.addLayer(L.name + ' tileable');
        U.ctx2d(NL.canvas).drawImage(tiled, 0, 0);
        refreshLayers();
        U.toast('Tileable version added as a layer');
      });
    });

    U.$('#tile-preview').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      U.busy('Building 3×3 preview…', () => {
        const big = GF.texture.tilePreview(D.docAligned(L));
        GF.history.push(D.doc, 'tile preview');
        const NL = D.addLayer(L.name + ' 3×3 preview');
        const c = U.ctx2d(NL.canvas);
        c.imageSmoothingEnabled = true;
        c.drawImage(big, 0, 0, big.width, big.height, 0, 0, D.doc.width, D.doc.height);
        refreshLayers();
        U.toast('3×3 tiling preview added — delete the layer when done checking');
      });
    });

    let extractedPalette = null;
    U.$('#pal-extract').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const n = +U.$('#pal-count').value;
      U.busy('Extracting palette…', () => {
        extractedPalette = GF.texture.extractPalette(L, n);
        const box = U.$('#pal-swatches');
        box.innerHTML = '';
        extractedPalette.forEach(p => {
          const sw = document.createElement('button');
          sw.className = 'sw';
          const hex = U.rgbToHex(p[0], p[1], p[2]);
          sw.style.background = hex;
          sw.title = hex + ' — tap to use as brush color';
          sw.addEventListener('click', () => {
            V().brush.color = hex;
            U.$('#brush-color').value = hex;
            U.toast('Brush color ' + hex);
          });
          box.appendChild(sw);
        });
        U.toast(extractedPalette.length + ' colors extracted');
      });
    });
    U.$('#pal-reduce').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const n = +U.$('#pal-count').value;
      U.busy('Reducing colors…', () => {
        const pal = extractedPalette && extractedPalette.length ? extractedPalette
                  : GF.texture.extractPalette(L, n);
        GF.filters.applyToLayer(L, 'palette reduce', img => GF.texture.reduceToPalette(img, pal));
        refreshLayers();
      });
    });

    U.$('#dither-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const method = U.$('#dither-method').value;
      const palName = U.$('#dither-palette').value;
      let pal;
      if (palName === 'extracted') {
        pal = extractedPalette;
        if (!pal || !pal.length) { U.toast('Extract a palette first (Palette → Extract)'); return; }
      } else {
        pal = GF.texture.PALETTES[palName];
      }
      U.busy('Dithering…', () => {
        GF.filters.applyToLayer(L, 'dither', img =>
          method === 'fs' ? GF.texture.ditherFS(img, pal) : GF.texture.ditherBayer(img, pal));
        refreshLayers();
      });
    });

    U.$$('#panel-texture [data-chan]').forEach(btn => btn.addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      U.busy('Isolating channel…', () => {
        GF.filters.applyToLayer(L, 'channel', img => GF.filters.isolateChannel(img, btn.dataset.chan));
        refreshLayers();
        U.toast('Channel ' + btn.dataset.chan.toUpperCase() + ' isolated — undo to restore');
      });
    }));

    U.$('#pack-apply').addEventListener('click', () => {
      if (!requireLayer()) return;
      const pick = sel => D.byId(parseInt(U.$(sel).value, 10)) || null;
      const r = pick('#pack-r'), g = pick('#pack-g'), b = pick('#pack-b');
      if (!r && !g && !b) { U.toast('Choose at least one source layer'); return; }
      U.busy('Packing channels…', () => {
        const packed = GF.texture.packChannels(r, g, b, D.doc.width, D.doc.height);
        GF.history.push(D.doc, 'channel pack');
        const NL = D.addLayer('packed ORM');
        U.ctx2d(NL.canvas).drawImage(packed, 0, 0);
        refreshLayers();
        U.toast('Packed layer created');
      });
    });

    /* --- help dialog (built from TOOL_HELP + RECIPES) --- */
    function openHelp() {
      const body = U.$('#help-body');
      let html = '<h3 class="mono">TOOLS</h3><table class="help-table">';
      for (const k in TOOL_HELP) {
        const t = TOOL_HELP[k];
        html += `<tr><td class="mono">${t.name}</td><td>${t.use}</td></tr>`;
      }
      html += '</table><h3 class="mono">RECIPES</h3><table class="help-table">';
      RECIPES.forEach(([title, how]) => { html += `<tr><td class="mono">${title}</td><td>${how}</td></tr>`; });
      html += `</table><h3 class="mono">GLOBAL SHORTCUTS</h3><table class="help-table">
        <tr><td class="mono">Ctrl+Z / Ctrl+Y</td><td>Undo / redo (25 steps)</td></tr>
        <tr><td class="mono">Ctrl+A · Ctrl+I · Esc</td><td>Select all · invert selection · deselect</td></tr>
        <tr><td class="mono">Ctrl+J</td><td>Copy the selection (or whole layer) to a new layer</td></tr>
        <tr><td class="mono">Delete</td><td>Erase the selected pixels</td></tr>
        <tr><td class="mono">Ctrl+E · Ctrl+S</td><td>Merge down · save project file</td></tr>
        <tr><td class="mono">Space (hold) · wheel</td><td>Pan · zoom at the cursor</td></tr>
      </table><h3 class="mono">AI / AUTOMATION</h3><table class="help-table">
        <tr><td class="mono">GF.api.describe()</td><td>Machine-readable catalog of every command (name, params, doc)</td></tr>
        <tr><td class="mono">GF.api.run(name, args)</td><td>Execute any command — paint, select, filters, wizards, export</td></tr>
        <tr><td class="mono">GF.api.state() / snapshot()</td><td>Inspect the document, or get a PNG of the canvas so an agent can see its work</td></tr>
      </table>`;
      body.innerHTML = html;
      U.$('#dlg-help').showModal();
    }
    U.$('#btn-help').addEventListener('click', openHelp);
    U.$('#help-close').addEventListener('click', () => U.$('#dlg-help').close());

    /* --- text tool dialog --- */
    let textPoint = null;
    openTextDialogImpl = p => {
      if (!requireLayer()) return;
      textPoint = p;
      U.$('#dlg-text').showModal();
      U.$('#text-content').focus();
    };
    U.$('#form-text').addEventListener('submit', e => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      const txt = U.$('#text-content').value;
      if (!txt.trim() || !textPoint) return;
      const size = U.clamp(parseInt(U.$('#text-size').value, 10) || 48, 6, 512);
      const font = (U.$('#text-italic').checked ? 'italic ' : '') +
                   (U.$('#text-bold').checked ? 'bold ' : '') +
                   size + 'px ' + U.$('#text-font').value;
      const outlineW = U.clamp(parseInt(U.$('#text-outline-w').value, 10) || 0, 0, 40);
      GF.history.push(D.doc, 'text');
      const L = D.addLayer('Text: ' + txt.split('\n')[0].slice(0, 18));
      const c = U.ctx2d(L.canvas);
      c.font = font;
      c.textBaseline = 'top';
      c.lineJoin = 'round';
      const lines = txt.split('\n');
      lines.forEach((line, i) => {
        const y = textPoint.y + i * size * 1.2;
        if (outlineW > 0) {
          c.strokeStyle = U.$('#text-outline-color').value;
          c.lineWidth = outlineW * 2; // stroked behind the fill => visible outline = outlineW
          c.strokeText(line, textPoint.x, y);
        }
        c.fillStyle = U.$('#text-color').value;
        c.fillText(line, textPoint.x, y);
      });
      refreshLayers();
      U.toast('Text layer added — use Move (V) to position it');
    });

    /* --- transforms --- */
    function tfLayer(label, fn) {
      const L = requireLayer(); if (!L) return;
      GF.history.push(D.doc, label);
      fn(L);
      refreshLayers();
    }
    function tfCanvas(label, fn) {
      if (!requireLayer()) return;
      GF.history.push(D.doc, label);
      fn();
      GF.select.clear();
      U.$('#doc-dims').textContent = D.doc.width + '×' + D.doc.height;
      GF.view.zoomFit();
      refreshLayers();
    }
    U.$('#tf-flip-h').addEventListener('click', () => tfLayer('flip layer', L => D.flipLayer(L, true)));
    U.$('#tf-flip-v').addEventListener('click', () => tfLayer('flip layer', L => D.flipLayer(L, false)));
    U.$('#tf-rot-cw').addEventListener('click', () => tfLayer('rotate layer', L => D.rotateLayer90(L, true)));
    U.$('#tf-rot-ccw').addEventListener('click', () => tfLayer('rotate layer', L => D.rotateLayer90(L, false)));
    U.$('#tf-scale').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const pct = parseFloat(prompt('Scale layer to % of current size', '50'));
      if (!pct || pct <= 0 || pct > 800) return;
      GF.history.push(D.doc, 'scale layer');
      D.scaleLayer(L, pct);
      refreshLayers();
    });
    U.$('#tfc-flip-h').addEventListener('click', () => tfCanvas('flip canvas', () => D.flipCanvas(true)));
    U.$('#tfc-flip-v').addEventListener('click', () => tfCanvas('flip canvas', () => D.flipCanvas(false)));
    U.$('#tfc-rot-cw').addEventListener('click', () => tfCanvas('rotate canvas', () => D.rotateCanvas90(true)));
    U.$('#tfc-rot-ccw').addEventListener('click', () => tfCanvas('rotate canvas', () => D.rotateCanvas90(false)));

    /* --- canvas ops --- */
    U.$('#canvas-resize').addEventListener('click', () => {
      if (!requireLayer()) return;
      U.$('#rs-w').value = D.doc.width;
      U.$('#rs-h').value = D.doc.height;
      U.$('#dlg-resize').showModal();
    });
    U.$('#form-resize').addEventListener('submit', e => {
      if (e.submitter && e.submitter.value === 'cancel') return;
      const w = U.clamp(parseInt(U.$('#rs-w').value, 10) || D.doc.width, 1, 8192);
      const h = U.clamp(parseInt(U.$('#rs-h').value, 10) || D.doc.height, 1, 8192);
      GF.history.push(D.doc, 'resize');
      D.resize(w, h, U.$('#rs-scale').checked);
      GF.select.clear();
      U.$('#doc-dims').textContent = w + '×' + h;
      GF.view.zoomFit();
      refreshLayers();
    });
    U.$('#canvas-flatten').addEventListener('click', () => {
      if (!requireLayer()) return;
      GF.history.push(D.doc, 'flatten');
      D.flatten();
      refreshLayers();
    });
    U.$('#canvas-trim').addEventListener('click', () => {
      if (!requireLayer()) return;
      U.busy('Trimming…', () => tfCanvas('trim', () => {
        if (!D.trimToContent()) U.toast('Nothing to trim — the document is empty');
      }));
    });
    U.$('#canvas-reveal').addEventListener('click', () => {
      if (!requireLayer()) return;
      tfCanvas('reveal all', () => D.revealAll());
    });

    /* --- retouch panel --- */
    wireSliderLabels('#panel-retouch');
    function needSelection() {
      if (!GF.select.has()) { U.toast('Make a selection first (Wand tool)'); return false; }
      return true;
    }
    function eraseSelectionNow() {
      const L = requireLayer(); if (!L) return;
      if (!GF.select.has()) { U.toast('Nothing selected'); return; }
      GF.retouch.eraseSelection(L, U.$('#bg-defringe').checked);
      refreshLayers();
    }
    function layerViaCopy() {
      const L = requireLayer(); if (!L) return;
      GF.history.push(D.doc, 'layer via copy');
      const snap = D.docAligned(L).canvas;
      if (GF.select.has()) {
        const c = U.ctx2d(snap);
        c.globalCompositeOperation = 'destination-in';
        c.drawImage(GF.select.maskCanvas(), 0, 0);
      }
      const NL = D.addLayer(L.name + ' copy');
      U.ctx2d(NL.canvas).drawImage(snap, 0, 0);
      refreshLayers();
      U.toast(GF.select.has() ? 'Selection copied to a new layer' : 'Layer copied');
    }
    U.$('#sel-copy').addEventListener('click', layerViaCopy);
    U.$('#sel-lift').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      if (!GF.select.has()) { U.toast('Select what to lift first (W or M)'); return; }
      const srcId = L.id;
      U.busy('Lifting & healing…', () => {
        layerViaCopy();                       // selection -> its own layer (active)
        const lifted = D.doc.activeId;
        D.doc.activeId = srcId;               // heal the hole on the source layer
        GF.retouch.contentAwareFill(D.byId(srcId));
        D.doc.activeId = lifted;
        GF.select.clear();
        refreshLayers();
        U.toast('Lifted to a new layer — move it with V; the hole was healed');
      });
    });
    U.$('#sel-all').addEventListener('click', () => { if (requireLayer()) GF.select.selectAll(); });
    U.$('#sel-none').addEventListener('click', () => GF.select.clear());
    U.$('#sel-invert').addEventListener('click', () => { if (requireLayer()) GF.select.invert(); });
    U.$('#sel-grow').addEventListener('click', () => { if (needSelection()) U.busy('Growing…', () => GF.select.grow(2)); });
    U.$('#sel-contract').addEventListener('click', () => { if (needSelection()) U.busy('Shrinking…', () => GF.select.contract(2)); });
    U.$('#sel-feather').addEventListener('click', () => { if (needSelection()) U.busy('Feathering…', () => GF.select.feather(3)); });
    U.$('#sel-erase').addEventListener('click', eraseSelectionNow);

    U.$('#bg-remove').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const tol = +U.$('#bg-tolerance').value, defr = U.$('#bg-defringe').checked;
      U.busy('Removing background…', () => {
        GF.retouch.removeBackground(L, tol, defr);
        refreshLayers();
        U.toast(GF.select.has() ? 'Background removed' : 'No background-colored region found from the edges');
      });
    });

    U.$('#caf-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      if (!GF.select.has()) { U.toast('Select a region to fill first (Wand tool)'); return; }
      const b = GF.select.bounds();
      if (b && b.w * b.h > 700 * 700) U.toast('Large selection — fill may take a few seconds…', 4000);
      U.busy('Content-aware fill…', () => {
        GF.retouch.contentAwareFill(L);
        GF.select.clear();
        refreshLayers();
        U.toast('Filled from surrounding texture');
      });
    });

    U.$('#cr-mode').addEventListener('change', e => {
      const toColor = e.target.value === 'to';
      U.$('#cr-to-row').hidden = !toColor;
      U.$('#cr-hsl').hidden = toColor;
    });
    U.$('#cr-pick').addEventListener('click', () => {
      U.$('#cr-from').value = V().brush.color;
      U.toast('FROM set to ' + V().brush.color + ' — sample with the eyedropper (I), then Pick');
    });
    U.$('#cr-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const opts = { from: U.hexToRgb(U.$('#cr-from').value), tol: +U.$('#cr-tol').value, soft: +U.$('#cr-soft').value, dH: 0, dS: 0, dL: 0, to: null };
      if (U.$('#cr-mode').value === 'to') opts.to = U.hexToRgb(U.$('#cr-to').value);
      else { opts.dH = +U.$('#cr-h').value; opts.dS = +U.$('#cr-s').value; opts.dL = +U.$('#cr-l').value; }
      U.busy('Recoloring…', () => { GF.retouch.colorReplace(L, opts); refreshLayers(); });
    });

    /* --- layer FX (silhouette-based, lands behind the source layer) --- */
    U.$$('#panel-retouch [id^="fx-"]').forEach(btn => {
      if (btn.tagName !== 'BUTTON') return;
      btn.addEventListener('click', () => {
        const L = requireLayer(); if (!L) return;
        const kind = btn.id.replace('fx-', '');
        const color = U.$('#fx-color').value;
        const size = +U.$('#fx-size').value;
        const opts = { angle: +U.$('#fx-angle').value, depth: +U.$('#fx-depth').value / 100 };
        U.busy('Building ' + kind + '…', () => {
          GF.retouch.layerFX(L, kind, color, size, opts);
          refreshLayers();
          const onLayer = kind === 'bevel' || kind === 'emboss';
          U.toast(kind[0].toUpperCase() + kind.slice(1) + (onLayer ? ' applied to "' : ' layer added behind "') + L.name + '"');
        });
      });
    });

    /* --- ink / outline + clean colors + cut to layer (premium retouch) --- */
    const syncLabel = (id) => { const el = U.$(id), b = el.closest('.slider-row')?.querySelector('b'); if (b) b.textContent = el.value; };
    U.$('#ink-preset').addEventListener('change', (e) => {
      const p = { thin: { s: 65, t: 1 }, bold: { s: 50, t: 2 }, comic: { s: 40, t: 4 } }[e.target.value];
      if (!p) return;
      U.$('#ink-sens').value = p.s; U.$('#ink-thick').value = p.t; syncLabel('#ink-sens'); syncLabel('#ink-thick');
    });
    U.$('#ink-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      U.busy('Inking outlines…', () => {
        GF.retouch.inkOutline(L, {
          sensitivity: +U.$('#ink-sens').value, thickness: +U.$('#ink-thick').value,
          color: U.$('#ink-color').value, newLayer: U.$('#ink-newlayer').checked,
        });
        refreshLayers();
        U.toast(U.$('#ink-newlayer').checked ? 'Outlines added on a new layer' : 'Outlines inked');
      });
    });
    U.$('#clean-preset').addEventListener('change', (e) => {
      const c = { poster: 4, flat: 8, photo: 16 }[e.target.value];
      if (c == null) return;
      U.$('#clean-colors').value = c; syncLabel('#clean-colors');
    });
    U.$('#clean-apply').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      U.busy('Cleaning colors…', () => {
        GF.retouch.cleanColors(L, {
          colors: +U.$('#clean-colors').value, sharpen: +U.$('#clean-sharp').value / 100,
          defringe: U.$('#clean-defringe').checked, splitLayers: U.$('#clean-split').checked,
        });
        refreshLayers();
        U.toast('Colors cleaned');
      });
    });
    U.$('#sel-cut').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      if (!GF.select.has()) { U.toast('Select a region first (W)'); return; }
      U.busy('Cutting to layer…', () => {
        GF.retouch.cutToLayer(L, {
          cut: true, bevel: U.$('#sel-cut-bevel').checked,
          bevelOpts: { size: +U.$('#fx-size').value, angle: +U.$('#fx-angle').value, depth: +U.$('#fx-depth').value / 100 },
        });
        refreshLayers();
        U.toast('Selection cut to a new layer');
      });
    });

    /* Remember the premium-tool settings between sessions (easy customization). */
    const PERSIST = ['ink-sens', 'ink-thick', 'ink-color', 'ink-newlayer', 'clean-colors', 'clean-sharp', 'clean-defringe', 'clean-split', 'fx-angle', 'fx-depth'];
    try {
      const saved = JSON.parse(localStorage.getItem('gf.retouch') || '{}');
      for (const id of PERSIST) {
        const el = U.$('#' + id); if (!el || saved[id] == null) continue;
        if (el.type === 'checkbox') el.checked = saved[id]; else { el.value = saved[id]; if (el.type === 'range') syncLabel('#' + id); }
      }
    } catch {}
    const persistRetouch = () => {
      try {
        const o = {};
        for (const id of PERSIST) { const el = U.$('#' + id); o[id] = el.type === 'checkbox' ? el.checked : el.value; }
        localStorage.setItem('gf.retouch', JSON.stringify(o));
      } catch {}
    };
    for (const id of PERSIST) U.$('#' + id).addEventListener('change', persistRetouch);

    /* --- material wizard (texture panel) --- */
    U.$('#wiz-material').addEventListener('click', () => {
      const L = requireLayer(); if (!L) return;
      const tileable = U.$('#wiz-tileable').checked;
      U.busy('Running the material pipeline…', () => {
        GF.retouch.materialWizard(L, tileable);
        refreshLayers();
        U.toast('Material ready: albedo + normal + height/AO/roughness + ORM. Open the 3D tab → Start preview.');
      });
    });

    U.$('#up-apply').addEventListener('click', () => {
      if (!requireLayer()) return;
      const f = +U.$('#up-factor').value, mode = U.$('#up-mode').value;
      if (D.doc.width * f > 8192 || D.doc.height * f > 8192) { U.toast('Result would exceed 8192² — pick a smaller factor'); return; }
      U.busy('Upscaling…', () => {
        GF.retouch.smartUpscale(f, mode);
        U.$('#doc-dims').textContent = D.doc.width + '×' + D.doc.height;
        GF.view.zoomFit();
        refreshLayers();
        U.toast('Upscaled to ' + D.doc.width + '×' + D.doc.height);
      });
    });

    /* --- 3D --- */
    U.$('#p3d-start').addEventListener('click', () => GF.preview3d.start());
    U.$('#p3d-refresh').addEventListener('click', () => GF.preview3d.refresh());
    U.$('#p3d-clearenv').addEventListener('click', () => GF.preview3d.clearEnvironment());
    U.$('#p3d-shape').addEventListener('change', () => GF.preview3d.refresh());

    /* --- 3D builder --- */
    let b3dSel = -1;
    function b3dRefreshList() {
      const sel = U.$('#b3d-list');
      const objs = GF.preview3d.listObjects();
      sel.innerHTML = objs.map(o => `<option value="${o.i}">${o.i + 1}: ${o.kind}</option>`).join('');
      if (b3dSel >= objs.length) b3dSel = objs.length - 1;
      if (b3dSel >= 0) { sel.value = b3dSel; b3dSyncSliders(); }
    }
    function b3dSyncSliders() {
      const t = GF.preview3d.getObject(b3dSel); if (!t) return;
      const set = (id, v) => { const el = U.$(id); el.value = v; el.closest('.slider-row')?.querySelector('b') && (el.closest('.slider-row').querySelector('b').textContent = el.value); };
      set('#b3d-x', Math.round(t.x * 100)); set('#b3d-y', Math.round(t.y * 100)); set('#b3d-z', Math.round(t.z * 100));
      set('#b3d-rot', t.rot); set('#b3d-tilt', t.tilt); set('#b3d-scale', Math.round(t.scale * 100));
      U.$('#b3d-tex').checked = t.useTex;
      U.$('#b3d-color').value = t.color;
    }
    U.$('#b3d-add').addEventListener('click', async () => {
      const i = await GF.preview3d.addPrimitive(U.$('#b3d-kind').value);
      if (i >= 0) { b3dSel = i; b3dRefreshList(); }
    });
    U.$('#b3d-list').addEventListener('change', e => { b3dSel = +e.target.value; b3dSyncSliders(); });
    U.$('#b3d-del').addEventListener('click', () => { GF.preview3d.removeObject(b3dSel); b3dRefreshList(); });
    [['#b3d-x', v => ({ x: v / 100 })], ['#b3d-y', v => ({ y: v / 100 })], ['#b3d-z', v => ({ z: v / 100 })],
     ['#b3d-rot', v => ({ rot: v })], ['#b3d-tilt', v => ({ tilt: v })], ['#b3d-scale', v => ({ scale: v / 100 })]]
      .forEach(([id, fn]) => bindRange(id, null, v => {
        U.$(id).closest('.slider-row').querySelector('b').textContent = v;
        GF.preview3d.setObject(b3dSel, fn(v));
      }));
    U.$('#b3d-tex').addEventListener('change', e => GF.preview3d.setObject(b3dSel, { useTex: e.target.checked }));
    U.$('#b3d-color').addEventListener('input', e => GF.preview3d.setObject(b3dSel, { color: e.target.value }));
    U.$('#b3d-snap').addEventListener('click', () => GF.preview3d.snapshotToLayer());
    U.$('#b3d-glb').addEventListener('click', () => GF.preview3d.exportGLB());

    /* --- keyboard --- */
    window.addEventListener('keydown', e => {
      const tag = document.activeElement.tagName;
      if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA') return;
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'z' && !e.shiftKey) { e.preventDefault(); doUndo(); }
      else if ((e.ctrlKey || e.metaKey) && (k === 'y' || (k === 'z' && e.shiftKey))) { e.preventDefault(); doRedo(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'e') { e.preventDefault(); U.$('#layer-merge').click(); }
      else if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); U.$('#btn-save').click(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'a') { e.preventDefault(); if (D.doc.open) GF.select.selectAll(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'i') { e.preventDefault(); if (D.doc.open) GF.select.invert(); }
      else if ((e.ctrlKey || e.metaKey) && k === 'j') { e.preventDefault(); layerViaCopy(); }
      else if (k === 'escape' && GF.select.has()) { GF.select.clear(); }
      else if (!e.ctrlKey && !e.metaKey) {
        if (k === 'v') setTool('move');
        else if (k === 'b') setTool('brush');
        else if (k === 'e') setTool('eraser');
        else if (k === 'g') setTool('fill');
        else if (k === 'i') setTool('picker');
        else if (k === 'h') setTool('pan');
        else if (k === 'w') setTool('wand');
        else if (k === 'x') setTool('magiceraser');
        else if (k === 'm') setTool('marquee');
        else if (k === 'l') { V().marquee.shape = 'lasso'; U.$('#marquee-shape').value = 'lasso'; setTool('marquee'); }
        else if (k === 't') setTool('text');
        else if (k === 'u') setTool('shape');
        else if (k === 'd') setTool('gradient');
        else if (k === 'c') setTool('clone');
        else if (e.key === '?') { e.preventDefault(); openHelp(); }
        else if (k === 'delete' || k === 'backspace') { e.preventDefault(); eraseSelectionNow(); }
        else if (k === '[') nudgeBrush(-2);
        else if (k === ']') nudgeBrush(2);
        else if (V().tool === 'move' && k === 'arrowleft')  { e.preventDefault(); GF.view.nudge(-(e.shiftKey ? 10 : 1), 0); }
        else if (V().tool === 'move' && k === 'arrowright') { e.preventDefault(); GF.view.nudge(+(e.shiftKey ? 10 : 1), 0); }
        else if (V().tool === 'move' && k === 'arrowup')    { e.preventDefault(); GF.view.nudge(0, -(e.shiftKey ? 10 : 1)); }
        else if (V().tool === 'move' && k === 'arrowdown')  { e.preventDefault(); GF.view.nudge(0, +(e.shiftKey ? 10 : 1)); }
      }
    });
    function nudgeBrush(d) {
      const el = U.$('#brush-size');
      el.value = U.clamp(parseInt(el.value, 10) + d, 1, 200);
      el.dispatchEvent(new Event('input'));
    }

    setTool('brush');
  }

  /* --- helpers --- */
  function bindRange(sel, valSel, fn) {
    const el = U.$(sel);
    el.addEventListener('input', () => {
      const v = parseInt(el.value, 10);
      if (valSel) U.$(valSel).textContent = v;
      fn(v);
    });
  }
  function wireSliderLabels(panelSel) {
    U.$$(panelSel + ' .slider-row').forEach(row => {
      const input = row.querySelector('input[type=range]');
      const b = row.querySelector('b');
      if (input && b) input.addEventListener('input', () => { b.textContent = input.value; });
    });
  }
  function resetSliders(sels) {
    sels.forEach(s => {
      const el = U.$(s);
      el.value = el.id === 'adj-poster' || el.id === 'adj-pixel' ? el.value : 0;
      const b = el.closest('.slider-row').querySelector('b');
      if (b) b.textContent = el.value;
    });
  }

  function openTextDialog(p) { if (openTextDialogImpl) openTextDialogImpl(p); }

  return { init, onDocumentOpened, refreshLayers, updateZoomLabel, showCursorPos, openTextDialog };
})();
