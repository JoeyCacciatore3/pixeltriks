/* ============================================================
   PixelTriks — forge-ui.js
   The new general-purpose, responsive UI. Implements the small
   GF.ui contract the engine depends on (init, onDocumentOpened,
   refreshLayers, updateZoomLabel, showCursorPos, openTextDialog)
   and drives every feature through the engine's public surface
   (GF.api / GF.view / GF.doc / GF.filters / GF.retouch / GF.exporter).
   ============================================================ */
'use strict';
window.GF = window.GF || {};

(function () {
  const U = GF.util, D = GF.doc;
  const $  = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const V  = () => GF.view.view;
  const run = (n, a) => { try { return GF.api.run(n, a); } catch (e) { U.toast(e.message); } };

  /* engine tool name per rail button — consolidated: eraser is a brush mode,
     magic erase is a wand mode, gradient folds into fill */
  const TOOLMAP = {
    move:'move', select:'marquee', wand:'wand', crop:'marquee',
    brush:'brush', fill:'fill', text:'text',
    shape:'shape', pan:'pan', gradient:'gradient'
  };
  const SHORTCUTS = { v:'move', m:'select', w:'wand', c:'crop', b:'brush',
    g:'fill', t:'text', u:'shape', h:'pan', d:'gradient' };

  const BLENDS = [
    ['source-over','Normal'],['multiply','Multiply'],['screen','Screen'],['overlay','Overlay'],
    ['darken','Darken'],['lighten','Lighten'],['color-dodge','Dodge'],['color-burn','Burn'],
    ['hard-light','Hard light'],['soft-light','Soft light'],['difference','Difference'],
    ['exclusion','Exclusion'],['hue','Hue'],['saturation','Saturation'],['color','Color'],['luminosity','Luminosity']
  ];

  /* the 80/20 adjust sliders (live, non-destructive preview; commit on Apply) */
  const ADJ = [
    { key:'exposure',   label:'Exposure',   min:-100, max:100 },
    { key:'contrast',   label:'Contrast',   min:-100, max:100 },
    { key:'saturation', label:'Saturation', min:-100, max:100 },
    { key:'vibrance',   label:'Vibrance',   min:-100, max:100 },
    { key:'warmth',     label:'Warmth',     min:-100, max:100 },
    { key:'clarity',    label:'Clarity',    min:-100, max:100 },
  ];
  let adj = blankAdj();
  function blankAdj() { return { exposure:0, contrast:0, saturation:0, vibrance:0, warmth:0, clarity:0 }; }
  function adjActive() { return ADJ.some(s => adj[s.key] !== 0); }

  const FILTERS = [
    { name:'B&W',     fn:i => GF.filters.grayscale(i) },
    { name:'Pop',     fn:i => { GF.filters.autoLevels(i); GF.filters.hsl(i,0,18,0); } },
    { name:'Warm',    fn:i => warmth(i, 28) },
    { name:'Sharp',   fn:i => GF.filters.sharpen(i) },
    { name:'Invert',  fn:i => GF.filters.invert(i) },
    { name:'Vivid',   fn:i => { GF.filters.hsl(i,0,38,0); GF.filters.brightnessContrast(i,2,12); } },
  ];

  let cropMode = false;
  let lastCursor = null;

  /* ---- a small custom warmth op (R up / B down), in-place ImageData ---- */
  function warmth(img, amt) {
    const d = img.data, k = amt;
    for (let i = 0; i < d.length; i += 4) {
      d[i]   = U.clamp(d[i]   + k, 0, 255);
      d[i+2] = U.clamp(d[i+2] - k, 0, 255);
    }
  }
  /* Vibrance — saturation-weighted: boosts muted colors more than already-vivid ones. */
  function vibrance(img, amt) {
    const d = img.data, k = amt / 100;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i], g = d[i+1], b = d[i+2], avg = (r + g + b) / 3;
      const w = k * (1 - (Math.max(r, g, b) - Math.min(r, g, b)) / 255);
      d[i]   = U.clamp(r + (r - avg) * w, 0, 255);
      d[i+1] = U.clamp(g + (g - avg) * w, 0, 255);
      d[i+2] = U.clamp(b + (b - avg) * w, 0, 255);
    }
  }
  /* Clarity — local contrast (unsharp on a low-pass copy). */
  function clarity(img, amt) {
    const k = amt / 100;
    const blur = new ImageData(Uint8ClampedArray.from(img.data), img.width, img.height);
    GF.filters.blur(blur);
    const d = img.data, b = blur.data;
    for (let i = 0; i < d.length; i += 4)
      for (let c = 0; c < 3; c++) d[i+c] = U.clamp(d[i+c] + (d[i+c] - b[i+c]) * k, 0, 255);
  }

  /* =================================================================
     GF.ui — the contract the engine calls
     ================================================================= */
  function init() {
    buildAdjustUI();
    buildFilters();
    buildBlendOptions();
    wireTopbar();
    wireTools();
    wirePanel();
    wireTexture();
    wireLayers();
    wireKeyboard();
    wireDropAndFiles();
    wireMobile();
    wireGestures();
    wireProFeatures();
    wireActionBar();
    // Wire quick-action buttons in tool rail
    const qk = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };
    qk('#qk-fliph', () => run('flipH'));
    qk('#qk-flipv', () => run('flipV'));
    qk('#qk-rotcw', () => run('rotateCW'));
    qk('#qk-rotccw', () => run('rotateCCW'));
    qk('#qk-zoomfit', () => GF.view.zoomFit());
    qk('#qk-newlayer', () => run('addLayer', {}));

    // Tool rail scroll fade — remove bottom mask when fully scrolled
    const rail = $('#toolrail');
    if (rail) {
      const checkScroll = () => {
        const atEnd = rail.scrollHeight - rail.scrollTop - rail.clientHeight < 4;
        rail.classList.toggle('scrolled-end', atEnd);
        rail.classList.toggle('no-scroll', rail.scrollHeight <= rail.clientHeight);
      };
      rail.addEventListener('scroll', checkScroll, { passive: true });
      checkScroll();  // initial check
      new ResizeObserver(checkScroll).observe(rail);
    }

    // Inject keyboard shortcut badges on tool buttons
    const BADGE_MAP = { move:'V', select:'M', wand:'W', crop:'C', brush:'B',
      fill:'G', gradient:'D', text:'T', shape:'U' };
    document.querySelectorAll('#toolrail .tool[data-tool]').forEach(btn => {
      const key = BADGE_MAP[btn.dataset.tool];
      if (key) {
        const badge = document.createElement('span');
        badge.className = 'kbd-badge';
        badge.textContent = key;
        btn.appendChild(badge);
      }
    });

    // Game Deck modules — init after main UI
    if (GF.transformPad) GF.transformPad.init();
    if (GF.hotbar) GF.hotbar.init();
    GF.history.onChange(updateUndoRedo);
    setTool('move');
    updateUndoRedo();
    document.body.classList.toggle('no-doc', !D.doc.open);   // quiets panel/optbar chrome pre-document
  }

  /* Procreate-standard touch gestures (on top of the engine's pinch zoom/pan):
     quick 2-finger tap = undo, 3-finger tap = redo. Movement-gated so it never
     fights pinch (which always moves) or single-finger drawing. */
  function wireGestures() {
    const vp = $('#viewport'); if (!vp) return;
    let maxN = 0, t0 = 0, moved = 0, sx = 0, sy = 0;
    vp.addEventListener('touchstart', e => {
      maxN = Math.max(maxN, e.touches.length);
      if (e.touches.length >= 2) { t0 = Date.now(); moved = 0; sx = e.touches[0].clientX; sy = e.touches[0].clientY; }
    }, { passive: true });
    vp.addEventListener('touchmove', e => {
      if (e.touches.length >= 2) moved = Math.max(moved, Math.abs(e.touches[0].clientX - sx) + Math.abs(e.touches[0].clientY - sy));
    }, { passive: true });
    vp.addEventListener('touchend', e => {
      if (e.touches.length !== 0) return;       // wait until all fingers lift
      const quick = (Date.now() - t0) < 280 && moved < 14;
      if (quick && maxN === 2) run('undo');
      else if (quick && maxN >= 3) run('redo');
      maxN = 0;
    }, { passive: true });
  }

  function onDocumentOpened() {
    $('#empty-state').hidden = true;
    document.body.classList.remove('no-doc');
    stopCrop();
    if (V().wand) V().wand.seed = null;
    adj = blankAdj(); D.clearPreview(); syncAdjustUI();
    refreshLayers();
    GF.view.zoomFit();
    // re-fit once layout settles — hiding the empty state / mobile chrome can
    // change the viewport box after the synchronous fit above
    requestAnimationFrame(() => { GF.view.zoomFit(); updateZoomLabel(); });
    updateZoomLabel();
    setDims();
    drawHistogram();
    if (pendingIntent) { const k = pendingIntent; pendingIntent = null; runIntent(k); }
    // Notify Game Deck modules
    window.dispatchEvent(new CustomEvent('pt:docopen'));
    if (GF.transformPad) GF.transformPad.refresh();
  }

  function refreshLayers() {
    const list = $('#layer-list');
    if (!list) return;
    list.innerHTML = '';
    const layers = D.doc.layers || [];
    // top layer first
    for (let i = layers.length - 1; i >= 0; i--) {
      const L = layers[i];
      const li = document.createElement('li');
      li.className = 'layer-item' + (L.id === D.doc.activeId ? ' on' : '');
      li.dataset.id = L.id;
      const thumb = document.createElement('div');
      thumb.className = 'layer-thumb';
      if (L.canvas) { const c = L.canvas.cloneNode(); c.getContext('2d').drawImage(L.canvas,0,0); thumb.appendChild(c); }
      const name = document.createElement('span');
      name.className = 'layer-name'; name.textContent = L.name + (L.adjust ? ' ⚙' : '') + (L.text ? ' ✎' : '');
      const vis = document.createElement('button');
      vis.className = 'icon-btn sm layer-vis' + (L.visible ? '' : ' off');
      vis.innerHTML = L.visible
        ? '<svg viewBox="0 0 24 24"><path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7-10-7-10-7"/><circle cx="12" cy="12" r="3"/></svg>'
        : '<svg viewBox="0 0 24 24"><path d="M4 4l16 16M10 6a10 10 0 0 1 12 6 14 14 0 0 1-3 3M6 8a14 14 0 0 0-4 4s4 7 10 7a9 9 0 0 0 3-.5"/></svg>';
      vis.title = 'Toggle visibility';
      vis.addEventListener('click', e => { e.stopPropagation(); L.visible = !L.visible; GF.view.requestRender(); refreshLayers(); });
      li.addEventListener('click', () => {
        if (L.id !== D.doc.activeId) resetAdjust();   // pending adjust preview is keyed to a layer — don't let it bleed across
        D.doc.activeId = L.id; refreshLayers(); GF.view.requestRender();
      });
      if (L.adjust && ADJ_EDITABLE.indexOf(L.adjust.kind) >= 0)
        li.addEventListener('dblclick', () => { D.doc.activeId = L.id; openAdjustmentEditor(L); });
      if (L.text)
        li.addEventListener('dblclick', () => { D.doc.activeId = L.id; editTextLayer(L); });
      li.appendChild(thumb); li.appendChild(name); li.appendChild(vis);
      list.appendChild(li);
    }
    const A = D.active();
    const blend = $('#lyr-blend'), op = $('#lyr-opacity'), opv = $('#lyr-opacity-val');
    if (A && blend) { blend.value = A.blend || 'source-over'; op.value = Math.round((A.opacity ?? 1) * 100); opv.textContent = op.value + '%'; }
    updateUndoRedo();
    setDims();
  }

  function updateZoomLabel() {
    const z = V() ? V().zoom : 1;
    const el = $('#zoom-label'); if (el) el.textContent = Math.round(z * 100) + '%';
  }

  function showCursorPos(p) { lastCursor = p; }

  /* ---- re-editable text layers (params stored on L.text, re-rendered live) ---- */
  const TEXT_FONTS = [['Impact, sans-serif','Impact'],['system-ui, sans-serif','System'],
    ['Arial, Helvetica, sans-serif','Arial'],['Georgia, serif','Georgia'],["'Times New Roman', serif",'Times'],
    ["'Courier New', monospace",'Courier'],['Verdana, sans-serif','Verdana'],["'Trebuchet MS', sans-serif",'Trebuchet'],
    ["'Comic Sans MS', cursive",'Comic Sans']];
  const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  function textDialog(title, init, onCommit) {
    modal({
      title,
      body: `<label>Text<textarea id="m-text" placeholder="Your text">${esc(init.text || '')}</textarea></label>
             <label>Font<select id="m-font">${TEXT_FONTS.map(([v, l]) => `<option value="${v}"${v === init.font ? ' selected' : ''}>${l}</option>`).join('')}</select></label>
             <div class="row"><label>Size<input id="m-size" type="number" min="6" value="${init.size || 64}"></label>
             <label>Color<input id="m-color" type="color" value="${init.color || '#ffffff'}"></label></div>
             <label class="ck"><input type="checkbox" id="m-outline" ${init.outline ? 'checked' : ''}> Add outline</label>`,
      ok: init.text ? 'Update' : 'Add',
      onOk: m => {
        const text = m.querySelector('#m-text').value; if (!text.trim()) return;
        const size = +m.querySelector('#m-size').value || 64;
        onCommit({ text, font: m.querySelector('#m-font').value, size, color: m.querySelector('#m-color').value,
          outline: m.querySelector('#m-outline').checked ? Math.max(2, Math.round(size / 16)) : 0, outlineColor: '#000' });
      }
    });
  }
  function renderTextLayer(L) {
    const t = L.text, c = U.ctx2d(L.canvas);
    c.clearRect(0, 0, L.canvas.width, L.canvas.height);
    c.font = 'bold ' + t.size + 'px ' + t.font;
    c.textBaseline = 'top'; c.lineJoin = 'round';
    const lines = String(t.text).split('\n'), lh = t.size * 1.2;
    lines.forEach((ln, i) => {
      const y = t.y + i * lh;
      if (t.outline) { c.strokeStyle = t.outlineColor || '#000'; c.lineWidth = t.outline * 2; c.strokeText(ln, t.x, y); }
      c.fillStyle = t.color; c.fillText(ln, t.x, y);
    });
  }
  function openTextDialog(p) {
    const x = Math.round(p.x), y = Math.round(p.y);
    textDialog('Add text', { font: 'Impact, sans-serif', size: 64, color: '#ffffff' }, params => {
      GF.history.push(D.doc, 'text');
      const L = D.addLayer('Text: ' + params.text.slice(0, 16).replace(/\n/g, ' '));
      L.text = Object.assign({ x, y }, params);
      renderTextLayer(L); refreshLayers(); GF.view.requestRender();
    });
  }
  function editTextLayer(L) {
    if (!L.text) return;
    textDialog('Edit text', L.text, params => {
      GF.history.push(D.doc, 'edit text');
      Object.assign(L.text, params);
      L.name = 'Text: ' + params.text.slice(0, 16).replace(/\n/g, ' ');
      renderTextLayer(L); refreshLayers(); GF.view.requestRender();
    });
  }

  GF.ui = { init, onDocumentOpened, refreshLayers, updateZoomLabel, showCursorPos, openTextDialog, setTool, openAIDialog, modal };

  /* =================================================================
     Build dynamic UI
     ================================================================= */
  function buildAdjustUI() {
    const host = $('#adj-sliders'); host.innerHTML = '';
    ADJ.forEach(s => {
      const row = document.createElement('div'); row.className = 'slider';
      row.innerHTML =
        `<div class="slider-top"><b>${s.label}</b><span class="val" data-k="${s.key}">0</span></div>
         <input type="range" min="${s.min}" max="${s.max}" value="0" data-k="${s.key}">`;
      const input = row.querySelector('input'), val = row.querySelector('.val');
      input.addEventListener('input', () => {
        adj[s.key] = +input.value; val.textContent = (input.value > 0 ? '+' : '') + input.value;
        val.classList.toggle('changed', +input.value !== 0);
        refreshAdjPreview();
      });
      val.addEventListener('click', () => { input.value = 0; input.dispatchEvent(new Event('input')); });
      host.appendChild(row);
    });
  }
  function syncAdjustUI() {
    $$('#adj-sliders input').forEach(i => { i.value = adj[i.dataset.k] || 0; i.dispatchEvent(new Event('input')); });
  }
  function buildFilters() {
    const strip = $('#filter-strip'); strip.innerHTML = '';
    // one colorful base swatch, run through each filter = real preview thumbnails
    const TW = 56, TH = 40;
    const base = U.makeCanvas(TW, TH), bc = U.ctx2d(base);
    const grad = bc.createLinearGradient(0, 0, TW, TH);
    grad.addColorStop(0, '#e8a33d'); grad.addColorStop(0.5, '#c84b4b'); grad.addColorStop(1, '#3a78c8');
    bc.fillStyle = grad; bc.fillRect(0, 0, TW, TH);
    bc.fillStyle = '#e9edf3'; bc.beginPath(); bc.arc(TW * 0.7, TH * 0.35, 9, 0, 7); bc.fill();
    bc.fillStyle = '#1d2330'; bc.fillRect(6, TH - 13, 16, 8);
    FILTERS.forEach(f => {
      const b = document.createElement('button'); b.className = 'filter-chip';
      const c = U.makeCanvas(TW, TH), x = U.ctx2d(c);
      x.drawImage(base, 0, 0);
      try { const img = x.getImageData(0, 0, TW, TH); f.fn(img); x.putImageData(img, 0, 0); } catch (e) {}
      b.appendChild(c);
      const s = document.createElement('span'); s.textContent = f.name; b.appendChild(s);
      b.addEventListener('click', () => {
        const L = D.active(); if (!L || !L.canvas) return U.toast('Open an image first');
        GF.filters.applyToLayer(L, f.name, f.fn); GF.view.requestRender(); refreshLayers(); U.toast(f.name);
      });
      strip.appendChild(b);
    });
  }
  function buildBlendOptions() {
    const sel = $('#lyr-blend'); sel.innerHTML = '';
    BLENDS.forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); });
  }
  /* the Image tab's Texture row — everything else lives in the ⌘K palette */
  function wireTexture() {
    const bind = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', () => { if (!D.active() || !D.active().canvas) return U.toast('Open an image first'); fn(); }); };
    bind('#tex-normal', makeNormalMap);
    bind('#tex-seamless', makeSeamless);
  }

  function addCanvasLayer(name, cnv) {
    GF.history.push(D.doc, name); const L = D.addLayer(name);
    U.ctx2d(L.canvas).drawImage(cnv, 0, 0); refreshLayers(); GF.view.requestRender();
  }
  function makeNormalMap() {
    const L = D.active(); const nm = GF.texture.normalMap(D.docAligned(L), 5, false, true);
    addCanvasLayer(L.name + ' normal', nm); U.toast('Normal map');
  }
  function makeSeamless() {
    const L = D.active(); const s = GF.texture.makeSeamless(D.docAligned(L), 20);
    GF.history.push(D.doc, 'seamless');
    const c = U.makeCanvas(D.doc.width, D.doc.height); U.ctx2d(c).drawImage(s, 0, 0);
    L.canvas = c; L.x = 0; L.y = 0; refreshLayers(); GF.view.requestRender(); U.toast('Seamless tile');
  }

  /* =================================================================
     Wiring
     ================================================================= */
  /* Intent-first launcher: the empty-state cards name an OUTCOME. Picking one
     remembers the intent, opens the file picker, and once the image loads we
     route straight to that action (see runIntent, fired from onDocumentOpened). */
  let pendingIntent = null;
  function wireIntents() {
    $$('.intent').forEach(b => b.addEventListener('click', () => {
      const kind = b.dataset.intent;
      if (kind === 'blank') { pendingIntent = null; openNewDialog(); return; }
      // scene-first cards act immediately — no file required
      if (kind === 'scene') { pendingIntent = null; setTool('scene3d'); return; }
      if (kind === 'texturemodel') { pendingIntent = null; setTool('scene3d'); U.toast('Drop a .glb anywhere, or use Import model… in the 3D panel'); return; }
      pendingIntent = kind; pickFile();
    }));
  }
  function runIntent(kind) {
    switch (kind) {
      case 'image3d': setTool('scene3d'); U.toast('Pick a converter under Make 3D — Extrude cutout turns your subject into a 3D piece'); break;
      case 'edit':    break;   // just an open — the full editor is the destination
    }
  }

  function wireTopbar() {
    $('#btn-open').addEventListener('click', pickFile);
    $('#empty-open').addEventListener('click', () => { pendingIntent = null; pickFile(); });
    $('#empty-new').addEventListener('click', openNewDialog);
    wireIntents();
    $('#btn-undo').addEventListener('click', () => run('undo'));
    $('#btn-redo').addEventListener('click', () => run('redo'));
    $('#btn-export').addEventListener('click', openExportDialog);
    $('#btn-ai').addEventListener('click', openAIDialog);
    $('#btn-zoom-in').addEventListener('click', () => zoomBtn(1.25));
    $('#btn-zoom-out').addEventListener('click', () => zoomBtn(0.8));
    $('#zoom-label').addEventListener('click', () => { GF.view.zoomFit(); layoutCrop(); });
    const dims = $('#doc-dims');
    if (dims) dims.addEventListener('click', () => { if (D.doc.open) openImageSize(); });
    $('#btn-menu').addEventListener('click', openMenu);
    const histBtn = $('#btn-history');
    if (histBtn) histBtn.addEventListener('click', () => {
      switchPanel('layers'); // layers tab has history
      const p = $('#panel'); if (p && !p.classList.contains('open') && matchMedia('(max-width:880px)').matches) p.classList.add('open');
    });
    const kbdBtn = $('#btn-shortcuts');
    if (kbdBtn) kbdBtn.addEventListener('click', openCheatSheet);
  }
  function zoomBtn(factor) {
    const r = $('#viewport').getBoundingClientRect();
    GF.view.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
    layoutCrop();
  }

  function wireTools() {
    $$('#toolrail .tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('#brush-color').addEventListener('input', e => { V().brush.color = e.target.value; });

    // ── Face-button colour palette ──
    // Tracks 4 recent colours, persisted in localStorage.
    // Clicking a face button sets the brush colour; using the colour picker pushes
    // the previous colour onto the palette stack.
    const FACE_ORDER = ['a', 'b', 'x', 'y'];
    let recentColors;
    try { recentColors = JSON.parse(localStorage.getItem('forge.recentColors')) || []; } catch (e) { recentColors = []; }
    if (recentColors.length < 4) recentColors = ['#e8a33d', '#e5634d', '#5b9fd6', '#5bbf7a'].slice(0, 4);

    function updateFacePalette() {
      FACE_ORDER.forEach((f, i) => {
        const btn = $(`.face-swatch.face-${f}`);
        if (btn && recentColors[i]) btn.style.background = recentColors[i];
      });
    }
    function pushColor(color) {
      const hex = color.toLowerCase();
      const idx = recentColors.indexOf(hex);
      if (idx >= 0) recentColors.splice(idx, 1);
      recentColors.unshift(hex);
      if (recentColors.length > 4) recentColors.length = 4;
      try { localStorage.setItem('forge.recentColors', JSON.stringify(recentColors)); } catch (e) {}
      updateFacePalette();
    }

    updateFacePalette();

    // Push previous color when picker changes
    const colorInput = $('#brush-color');
    let prevPickerColor = colorInput.value;
    colorInput.addEventListener('change', () => {
      pushColor(prevPickerColor);
      prevPickerColor = colorInput.value;
    });

    // Click face button → set brush color
    $$('.face-swatch').forEach((btn, i) => {
      btn.addEventListener('click', () => {
        if (recentColors[i]) {
          colorInput.value = recentColors[i];
          V().brush.color = recentColors[i];
        }
      });
    });
  }
  function setTool(name) {
    const prev = curTool;
    curTool = name;
    if (cropEl && name !== 'crop') stopCrop();
    cropMode = (name === 'crop');
    if (prev === 'scene3d' && name !== 'scene3d' && GF.scene3dUI) GF.scene3dUI.exit();
    const eng = TOOLMAP[name] || name;
    // crop and the 3D workspace use their own overlays; park the engine on move
    V().tool = (name === 'crop' || name === 'scene3d') ? 'move' : eng;
    $$('#toolrail .tool').forEach(b => { const on = b.dataset.tool === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    buildOptbar(name);
    if (name === 'crop') startCrop();
    if (name === 'wand') showWandCoach();
    if (name === 'scene3d') { show3DCoach(); if (GF.scene3dUI) GF.scene3dUI.enter(); }
    // Notify Game Deck modules
    window.dispatchEvent(new CustomEvent('pt:toolchange', { detail: { tool: name, prev } }));
    if (GF.transformPad) GF.transformPad.refresh();
  }

  /* First-run coach mark: the wand only pays off once you know "click → then an
     action bar appears". Show that once, right when a new user first picks it. */
  function showWandCoach() {
    let seen; try { seen = localStorage.getItem('forge.wandSeen'); } catch (e) { return; }
    if (seen || !D.doc.open || $('#coach')) return;
    const c = document.createElement('div'); c.id = 'coach';
    c.innerHTML = `<div class="coach-card">
        <b>✨ Magic Wand</b>
        <p>Click an area of similar colour to select it — a bar of one-tap actions
           (erase, cut out, recolour, replace) then appears right at your selection.</p>
        <button class="text-btn primary sm" id="coach-ok">Got it</button>
      </div>`;
    $('#viewport').appendChild(c);
    const dismiss = () => { try { localStorage.setItem('forge.wandSeen', '1'); } catch (e) {} if (c.parentNode) c.remove(); };
    $('#coach-ok').addEventListener('click', dismiss);
    GF.select.onChange(() => { if (GF.select.has() && document.body.contains(c)) dismiss(); });  // or auto-dismiss on first real selection
  }

  /* First-run coach mark for 3D workspace: show once to highlight the
     2D→3D converter power (competitor research: Monster Mash pattern). */
  function show3DCoach() {
    let seen; try { seen = localStorage.getItem('forge.3dSeen'); } catch (e) { return; }
    if (seen || $('#coach')) return;
    const c = document.createElement('div'); c.id = 'coach';
    c.innerHTML = `<div class="coach-card">
        <b>✦ 3D Workspace</b>
        <p>Add primitives or import GLB models, then pose and texture them.
           Use <b>Extrude</b>, <b>Relief</b>, or <b>Lathe</b> to convert any 2D layer into 3D.</p>
        <button class="text-btn primary sm" id="coach-ok">Got it</button>
      </div>`;
    $('#viewport').appendChild(c);
    const dismiss = () => { try { localStorage.setItem('forge.3dSeen', '1'); } catch (e) {} if (c.parentNode) c.remove(); };
    $('#coach-ok').addEventListener('click', dismiss);
  }

  function buildOptbar(name) {
    const bar = $('#optbar');
    let html = '';
    /* Inline panel — no JS positioning needed. CSS grid column handles layout. */
    const toolLabel = { brush:'Brush', gradient:'Gradient', fill:'Fill', wand:'Smart Select',
      select:'Marquee', shape:'Shape', crop:'Crop', text:'Text', move:'Move', pan:'Pan',
      scene3d:'3D Scene' }[name] || name;
    if (name === 'brush') {
      html = title(toolLabel)
           + seg('brush-mode', [['paint','Paint'],['erase','Erase']], V().brush.erasing ? 'erase' : 'paint')
           + optSlider('Size', 'brush-size', 1, 200, V().brush.size)
           + optSlider('Opacity', 'brush-op', 0, 100, Math.round((V().brush.opacity ?? 1) * 100))
           + optCheck('Pixel', 'brush-pixel', V().brush.pixel);
    } else if (name === 'gradient') {
      html = title(toolLabel)
           + seg('grad-kind', [['linear','Linear'],['radial','Radial']], V().gradient.kind || 'linear')
           + optCheck('Fade to transparent', 'grad-alpha', V().gradient.toAlpha)
           + hint('Drag on canvas to draw');
    } else if (name === 'fill') {
      html = title(toolLabel)
           + optSlider('Tolerance', 'fill-tol', 0, 128, V().fillTolerance);
    } else if (name === 'wand') {
      html = title(toolLabel)
           + seg('wand-mode', [['select','Select'],['remove','Remove']], V().wand.autoRemove ? 'remove' : 'select')
           + optSlider('Tolerance', 'wand-tol', 0, 128, V().wand.tolerance)
           + hint('Click to select\nShift → add\nAlt → subtract');
    } else if (name === 'select') {
      html = title(toolLabel)
           + seg('sel-shape', [['rect','Rect'],['ellipse','Ellipse'],['lasso','Lasso']], V().marquee.shape)
           + hint('Shift → add\nAlt → subtract');
    } else if (name === 'shape') {
      html = title(toolLabel)
           + seg('shp-kind', [['rect','Rect'],['ellipse','Ellipse'],['line','Line']], V().shape.kind)
           + optCheck('Fill', 'shp-fill', V().shape.fill);
    } else if (name === 'crop') {
      html = title(toolLabel)
           + seg('crop-aspect', [['0','Free'],['1','1:1'],['0.8','4:5'],['1.7778','16:9'],['0.5625','9:16'],['1.5','3:2'],['orig','Orig']], '0')
           + optSlider('Straighten', 'crop-straighten', -15, 15, 0)
           + `<button class="text-btn primary" id="crop-apply">Apply Crop</button>`
           + `<button class="text-btn ghost" id="crop-cancel">Cancel</button>`;
    } else if (name === 'text') {
      html = title(toolLabel) + hint('Click on canvas to place text');
    } else if (name === 'move') {
      html = title(toolLabel) + hint('Drag to move the active layer');
    } else if (name === 'pan') {
      html = title(toolLabel) + hint('Drag to pan\nPinch to zoom');
    } else if (name === 'scene3d') {
      html = GF.scene3dUI ? GF.scene3dUI.optbarHtml() : '';
      if (html) html = title('3D Scene') + html;
    }
    if (html && GF.toolGuides && GF.toolGuides.has(name)) html += guideBtn(name);
    if (!html) { bar.classList.remove('open'); bar.innerHTML = ''; return; }
    bar.innerHTML = html;
    bar.classList.add('open');
    wireOptbar(name);
  }
  function title(t) { return `<span class="opt-title">${t}</span>`; }
  function hint(t) { return `<span class="opt-hint">${t.replace(/\n/g, '<br>')}</span>`; }
  function optCheck(label, id, checked) {
    return `<label class="opt-check"><input type="checkbox" id="${id}" ${checked ? 'checked' : ''}> ${label}</label>`;
  }
  function optSlider(label, id, min, max, val) {
    return `<label class="opt">${label}<div class="opt-row"><input type="range" id="${id}" min="${min}" max="${max}" value="${val}"><span class="opt-v" id="${id}-v">${val}</span></div></label>`;
  }
  function seg(id, items, cur) {
    return `<span class="seg" id="${id}">` + items.map(([v,l]) => `<button data-v="${v}" class="${v===cur?'on':''}">${l}</button>`).join('') + `</span>`;
  }
  function guideBtn(name) { return `<button class="icon-btn sm guide-btn" data-guide="${name}" title="How to use this tool" aria-label="Tool guide">?</button>`; }
  function wireOptbar(name) {
    if (name === 'scene3d' && GF.scene3dUI) { GF.scene3dUI.wireOptbar(); }
    const bind = (id, fn) => { const el = $('#'+id); if (el) el.addEventListener('input', () => { fn(el); const v = $('#'+id+'-v'); if (v) v.textContent = el.value; }); };
    bind('brush-size', el => V().brush.size = +el.value);
    bind('brush-op',   el => V().brush.opacity = +el.value / 100);
    bind('fill-tol',   el => V().fillTolerance = +el.value);
    bind('wand-tol',   el => { V().wand.tolerance = +el.value; reWand(); });
    const chk = (id, fn) => { const el = $('#'+id); if (el) el.addEventListener('change', () => fn(el.checked)); };
    chk('brush-pixel', v => V().brush.pixel = v);
    chk('shp-fill',    v => V().shape.fill = v);
    chk('grad-alpha',  v => V().gradient.toAlpha = v);
    segWire('brush-mode', v => { V().brush.erasing = (v === 'erase'); });
    segWire('wand-mode', v => { V().wand.autoRemove = (v === 'remove'); });
    segWire('grad-kind', v => V().gradient.kind = v);
    segWire('sel-shape', v => V().marquee.shape = v);
    segWire('shp-kind',  v => V().shape.kind = v);
    const gb = $('.guide-btn'); if (gb) gb.addEventListener('click', () => GF.toolGuides && GF.toolGuides.open(gb.dataset.guide));
    segWire('crop-aspect', v => setCropAspect(v === 'orig' ? (D.doc.width / D.doc.height) : parseFloat(v)));
    const cs = $('#crop-straighten'); if (cs) cs.addEventListener('change', () => { straighten(parseFloat(cs.value)); cs.value = 0; $('#crop-straighten-v').textContent = '0°'; });
    if (cs) cs.addEventListener('input', () => $('#crop-straighten-v').textContent = (cs.value > 0 ? '+' : '') + cs.value + '°');
    const ca = $('#crop-apply'); if (ca) ca.addEventListener('click', applyCropTool);
    const cc = $('#crop-cancel'); if (cc) cc.addEventListener('click', () => setTool('move'));
  }
  function segWire(id, fn) {
    const seg = $('#'+id); if (!seg) return;
    seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on')); b.classList.add('on'); fn(b.dataset.v);
    }));
  }

  function wirePanel() {
    $$('.ptab').forEach(t => t.addEventListener('click', () => {
      panelAutoSwitch = false;    // user manually picked — pause auto-switching
      switchPanel(t.dataset.tab);
    }));
    const defTab = $('.ptab[data-tab="scene"]') || $('.ptab');
    defTab.classList.add('on'); // default Properties (3D)
    $('#adj-reset').addEventListener('click', resetAdjust);
    $('#adj-apply').addEventListener('click', applyAdjust);

    // Re-enable auto-switch when mode/tool/selection changes
    window.addEventListener('pt:modechange', () => { panelAutoSwitch = true; autoPanelSwitch(); });
    window.addEventListener('pt:toolchange', e => { panelAutoSwitch = true; autoPanelSwitch(); });
    window.addEventListener('pt:selectionchange', () => { if (panelAutoSwitch) autoPanelSwitch(); });
  }

  let panelAutoSwitch = true;
  function switchPanel(tab) {
    const panel = $('#panel');
    panel.dataset.tab = tab;
    $$('.ptab').forEach(x => { x.classList.toggle('on', x.dataset.tab === tab); x.setAttribute('aria-selected', x.dataset.tab === tab ? 'true' : 'false'); });
    $$('.ptab-pane').forEach(p => p.hidden = p.dataset.pane !== tab);
    const tg = $('#panel-toggle span');
    if (tg) tg.textContent = { scene:'Properties', layers:'Layers', adjust:'Adjust', assets:'Assets', guide:'Guide' }[tab] || tab;
  }

  /** P4: Context-sensitive panel — auto-switches tab based on what's happening */
  function autoPanelSwitch() {
    if (!panelAutoSwitch) return;
    const mode = document.body.dataset.mode;
    if (mode === '3d') {
      switchPanel('scene');  // 3D mode → show Properties (objects, materials, scene tree)
    } else if (curTool === 'crop') {
      // Crop tool doesn't need panel — keep current
    } else if (GF.select && GF.select.has && GF.select.has()) {
      switchPanel('layers'); // Selection active → show layers (where to act)
    } else {
      switchPanel('layers'); // Default 2D → layers is most useful
    }
  }

  /* The four headline actions, named once. Every surface that offers them —
     wand bar, palette, api — calls these, never a sibling button's click(). */
  const ACTIONS = {
    enhance() {
      const L = D.active(); GF.filters.applyToLayer(L, 'enhance', i => { GF.filters.autoLevels(i); GF.filters.hsl(i,0,10,0); });
      GF.view.requestRender(); refreshLayers(); U.toast('Enhanced');
    },
    removeBg() {
      // auto-upgrade to AI cutout when a remove.bg key is configured; else classic
      if (GF.ai && GF.ai.hasKey() && GF.ai.config().provider === 'removebg') {
        U.toast('Running AI cutout…'); GF.ai.run({}).catch(e => U.toast(e.message)); return;
      }
      busyHero('#hero-removebg', () => run('removeBackground'));
    },
    magicErase() {
      if (!GF.select.has || !GF.select.has()) {
        V().wand.autoRemove = true;
        setTool('wand'); U.toast('Click the object you want to remove');
        return;
      }
      busyHero('#hero-erase', () => run('contentAwareFill'));
    },
    genFill() { openAIDialog(); },
  };

  /* defer so any pending UI state paints before the (synchronous, heavy) op runs */
  function busyHero(sel, fn) {
    const el = $(sel);
    if (el) el.classList.add('busy');
    setTimeout(() => { try { fn(); } finally { if (el) el.classList.remove('busy'); } }, 30);
  }

  /* Layer styles — the engine's layerFX (outline/glow/shadow/bevel/emboss),
     surfaced as a simple pick-and-apply dialog. */
  function openLayerStyle() {
    const L = D.active();
    if (!L || !L.canvas) return U.toast('Pick a pixel layer first');
    const kinds = [['outline','◯ Outline'],['glow','✦ Glow'],['shadow','◪ Drop shadow'],['bevel','◧ Bevel'],['emboss','▤ Emboss']];
    modal({
      title: 'Layer style',
      sub: 'Applied to the active layer — undo to remove',
      body: `<div class="seg" id="ls-kind" style="flex-wrap:wrap">${kinds.map(([v,l],i) => `<button data-v="${v}" class="${i===0?'on':''}">${l}</button>`).join('')}</div>
             <div class="row" style="margin-top:.8rem"><label>Color<input id="ls-color" type="color" value="#000000"></label>
             <label>Size <span id="ls-size-v">6</span><input id="ls-size" type="range" min="1" max="30" value="6"></label></div>`,
      ok: 'Apply',
      mount: m => {
        let kind = 'outline';
        m.querySelectorAll('#ls-kind button').forEach(b => b.addEventListener('click', () => {
          m.querySelectorAll('#ls-kind button').forEach(x => x.classList.remove('on')); b.classList.add('on'); kind = b.dataset.v;
        }));
        m.querySelector('#ls-size').addEventListener('input', e => m.querySelector('#ls-size-v').textContent = e.target.value);
        m._getStyle = () => ({ kind, color: m.querySelector('#ls-color').value, size: +m.querySelector('#ls-size').value });
      },
      onOk: m => { const s = m._getStyle(); run('layerFX', s); U.toast('Layer style: ' + s.kind); }
    });
  }

  function wireLayers() {
    $('#lyr-add').addEventListener('click', () => run('addLayer', {}));
    $('#lyr-fx').addEventListener('click', openAddAdjustment);
    const ls = $('#lyr-style'); if (ls) ls.addEventListener('click', openLayerStyle);
    $('#lyr-dup').addEventListener('click', () => run('duplicateLayer'));
    $('#lyr-merge').addEventListener('click', () => run('mergeDown'));
    $('#lyr-del').addEventListener('click', () => run('deleteLayer'));
    $('#lyr-blend').addEventListener('change', e => { const A = D.active(); if (A) { A.blend = e.target.value; GF.view.requestRender(); } });
    $('#lyr-opacity').addEventListener('input', e => {
      const A = D.active(); if (A) { A.opacity = +e.target.value / 100; $('#lyr-opacity-val').textContent = e.target.value + '%'; GF.view.requestRender(); }
    });
  }

  function wireKeyboard() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      // Escape works everywhere: close an open modal first, else clear selection
      // (the palette handles its own Escape — don't also nuke the selection)
      if (k === 'escape') { if (modalEl) closeModal(); else if (!paletteEl) run('deselect'); return; }
      // a modal is open: don't let document/tool shortcuts fire behind it
      if (modalEl) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (typing) return;
      if ((e.ctrlKey || e.metaKey)) {
        if (k === 'z') { e.preventDefault(); run(e.shiftKey ? 'redo' : 'undo'); return; }
        if (k === 'y') { e.preventDefault(); run('redo'); return; }
        if (k === 'c' && e.shiftKey) { e.preventDefault(); run('copyToClipboard'); return; }
        if (k === 's') { e.preventDefault(); GF.exporter.saveProject(); return; }
        if (k === 'e') { e.preventDefault(); openExportDialog(); return; }
        if (k === 'm') { e.preventDefault(); if (D.doc.open) openCurves(); return; }
        if (k === 'a') { e.preventDefault(); run('selectAll'); return; }
        if (k === 'i') { e.preventDefault(); run('invertSelection'); return; }
        return;
      }
      if (k === ']') { zoomBtn(1.2); return; }
      if (k === '[') { zoomBtn(0.83); return; }
      if (SHORTCUTS[k]) { setTool(SHORTCUTS[k]); }
    });
  }

  function wireDropAndFiles() {
    const fi = $('#file-input');
    fi.addEventListener('change', () => { if (fi.files.length) GF.exporter.handleFiles(fi.files); fi.value = ''; });
    ['dragover','drop'].forEach(t => document.addEventListener(t, e => {
      e.preventDefault();
      if (t === 'drop' && e.dataTransfer.files.length) GF.exporter.handleFiles(e.dataTransfer.files);
    }));
  }

  function wireMobile() {
    const openSheet  = () => { $('#panel').classList.add('open'); document.body.classList.add('sheet-open'); };
    const closeSheet = () => { $('#panel').classList.remove('open'); document.body.classList.remove('sheet-open'); };
    $('#panel-toggle').addEventListener('click', openSheet);
    $('.panel-grip').addEventListener('click', closeSheet);
    const tc = (id, fn) => $(id).addEventListener('click', fn);
    tc('#tc-undo', () => run('undo'));
    tc('#tc-redo', () => run('redo'));
    tc('#tc-fit', () => GF.view.zoomFit());
  }

  /* =================================================================
     Adjust: live preview + commit
     ================================================================= */
  function adjustFn() {
    return img => {
      if (adj.exposure || adj.contrast) GF.filters.brightnessContrast(img, adj.exposure, adj.contrast);
      if (adj.saturation) GF.filters.hsl(img, 0, adj.saturation, 0);
      if (adj.vibrance) vibrance(img, adj.vibrance);
      if (adj.warmth) warmth(img, adj.warmth);
      if (adj.clarity) clarity(img, adj.clarity);
    };
  }
  function refreshAdjPreview() {
    const L = D.active();
    if (!L || !L.canvas) return;
    if (adjActive()) D.setPreview(L.id, adjustFn()); else D.clearPreview();
    GF.view.requestRender(); drawHistogram();
  }
  function applyAdjust() {
    const L = D.active();
    if (!L || !L.canvas || !adjActive()) return;
    D.clearPreview();
    GF.filters.applyToLayer(L, 'adjust', adjustFn());
    adj = blankAdj(); syncAdjustUI();
    GF.view.requestRender(); refreshLayers(); drawHistogram(); U.toast('Applied');
  }
  function resetAdjust() {
    adj = blankAdj(); D.clearPreview(); syncAdjustUI(); GF.view.requestRender(); drawHistogram();
  }

  /* =================================================================
     Dialogs
     ================================================================= */
  function pickFile() { $('#file-input').click(); }

  function openNewDialog() {
    const sizes = [
      ['1080','1080','Square'],['1920','1080','Wide'],['1080','1920','Story'],
      ['1024','1024','Large'],['512','512','Medium'],['2048','2048','4K-ish'],
    ];
    let chosen = 0;
    modal({
      title: 'New canvas',
      body: `<div class="size-grid">` + sizes.map((s,i) =>
        `<button class="size-card${i===0?' on':''}" data-i="${i}">${s[2]}<small>${s[0]}×${s[1]}</small></button>`).join('') + `</div>
        <div class="row"><label>Width<input id="m-w" type="number" value="1080"></label>
        <label>Height<input id="m-h" type="number" value="1080"></label></div>
        <label>Background<select id="m-bg"><option value="white">White</option><option value="transparent">Transparent</option><option value="black">Black</option></select></label>`,
      ok: 'Create',
      mount: m => {
        m.querySelectorAll('.size-card').forEach(c => c.addEventListener('click', () => {
          m.querySelectorAll('.size-card').forEach(x => x.classList.remove('on')); c.classList.add('on');
          chosen = +c.dataset.i; m.querySelector('#m-w').value = sizes[chosen][0]; m.querySelector('#m-h').value = sizes[chosen][1];
        }));
      },
      onOk: m => {
        const w = U.clamp(+m.querySelector('#m-w').value || 1080, 1, 8192);
        const h = U.clamp(+m.querySelector('#m-h').value || 1080, 1, 8192);
        const bg = m.querySelector('#m-bg').value;
        run('newDoc', { w, h, bg: bg === 'transparent' ? null : bg });
      }
    });
  }

  /* One export hub, grouped by destination — replaces the old form + a pile
     of extra footer buttons. */
  function openExportDialog() {
    const has3d = GF.scene3d && GF.scene3d.count();
    if (!D.doc.open && !has3d) return U.toast('Nothing to export yet');
    modal({
      title: 'Export',
      body: (D.doc.open ? `
        <h3 class="m-sec">Image</h3>
        <div class="row"><label>Format<select id="m-fmt"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label>
        <label>Scale<select id="m-scale"><option value="1">1× (${D.doc.width}×${D.doc.height})</option><option value="2">2×</option><option value="0.5">0.5×</option></select></label></div>` : '')
      + (has3d ? `
        <h3 class="m-sec">3D scene</h3>
        <div class="row m-actions">
          <button class="text-btn ghost" data-x="glb">GLB model</button>
          <button class="text-btn ghost" data-x="page">Interactive web page…</button>
        </div>` : '')
      + `
        <h3 class="m-sec">Project</h3>
        <div class="row m-actions">
          <button class="text-btn ghost" data-x="save">Save project file</button>
          ${D.doc.open ? '<button class="text-btn ghost" data-x="layers">Layers as files</button>' : ''}
        </div>`,
      ok: D.doc.open ? 'Download image' : 'Close',
      noCancel: !D.doc.open,
      mount: m => m.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => {
        closeModal();
        ({ glb: () => GF.scene3d.exportGLB({}),
           page: () => GF.scene3dUI.publishDialog(),
           save: () => GF.exporter.saveProject(),
           layers: () => run('exportLayers', {}) })[b.dataset.x]();
      })),
      onOk: m => {
        if (!D.doc.open) return;
        GF.exporter.exportImage({ type: m.querySelector('#m-fmt').value, scale: +m.querySelector('#m-scale').value, quality: 0.92 });
      }
    });
  }

  function openColorReplace() {
    modal({
      title: 'Replace color',
      body: `<div class="row"><label>From<input id="m-from" type="color" value="#ffffff"></label>
             <label>To<input id="m-to" type="color" value="#000000"></label></div>
             <label>Tolerance <span id="m-tolv">48</span><input id="m-tol" type="range" min="0" max="128" value="48"></label>`,
      ok: 'Replace',
      mount: m => m.querySelector('#m-tol').addEventListener('input', e => m.querySelector('#m-tolv').textContent = e.target.value),
      onOk: m => {
        const from = U.hexToRgb(m.querySelector('#m-from').value), to = U.hexToRgb(m.querySelector('#m-to').value);
        run('colorReplace', { from: [from.r,from.g,from.b], to: [to.r,to.g,to.b], tol: +m.querySelector('#m-tol').value });
      }
    });
  }

  function openCurves() {
    if (!GF.curveEditor) return U.toast('Curves unavailable');
    modal({
      title: 'Curves',
      body: `<div style="display:grid;gap:.6rem;place-items:center">
               <canvas id="m-curve" width="300" height="220" style="border-radius:8px;touch-action:none;box-shadow:inset 0 0 0 1px var(--line)"></canvas>
               <div class="seg" id="m-curve-ch">
                 <button data-v="rgb" class="on">RGB</button><button data-v="r">R</button><button data-v="g">G</button><button data-v="b">B</button>
               </div>
             </div>`,
      ok: 'Apply',
      mount: m => {
        try {
          GF.curveEditor.init({ canvas: m.querySelector('#m-curve') });
          GF.curveEditor.setCurves(); GF.curveEditor.render();
          m.querySelectorAll('#m-curve-ch button').forEach(b => b.addEventListener('click', () => {
            m.querySelectorAll('#m-curve-ch button').forEach(x => x.classList.remove('on')); b.classList.add('on');
            GF.curveEditor.setChannel(b.dataset.v);
          }));
        } catch (e) {}
      },
      onOk: () => { try { run('curves', { curves: GF.curveEditor.getCurves() }); } catch (e) { U.toast('Could not apply curves'); } }
    });
  }

  function openAIDialog() {
    if (!GF.ai) return U.toast('AI adapter not loaded');
    const cfg = GF.ai.config();
    const sel = p => `<option value="${p}"${cfg.provider===p?' selected':''}>`;
    modal({
      title: '✦ AI tools',
      sub: 'Bring your own key — kept in memory for this session only.',
      body: `<label>Provider<select id="ai-prov">
               ${sel('removebg')}remove.bg — 1-click cutout</option>
               ${sel('fal')}fal.ai — generative fill (needs a selection)</option>
               ${sel('custom')}Custom endpoint</option>
             </select></label>
             <label>API key<input id="ai-key" type="password" placeholder="${GF.ai.hasKey()?'key set — leave blank to keep':'paste your key'}"></label>
             <label class="ai-only" data-for="fal custom">Prompt<textarea id="ai-prompt" placeholder="describe what to generate, e.g. a calm blue sky"></textarea></label>
             <label class="ai-only" data-for="custom">Endpoint URL<input id="ai-endpoint" placeholder="https://…" value="${cfg.endpoint||''}"></label>
             <details class="ai-adv"${cfg.proxy ? ' open' : ''}><summary>Advanced</summary>
               <label>Request proxy <span style="color:var(--ink-3)">— only needed if the browser blocks the provider</span>
               <input id="ai-proxy" placeholder="http://localhost:8787/?url=" value="${cfg.proxy||''}"></label>
             </details>`,
      ok: 'Run',
      mount: m => {
        const prov = m.querySelector('#ai-prov');
        const sync = () => m.querySelectorAll('.ai-only').forEach(el =>
          el.style.display = el.dataset.for.split(' ').includes(prov.value) ? '' : 'none');
        prov.addEventListener('change', sync); sync();
      },
      onOk: m => {
        const patch = {
          provider: m.querySelector('#ai-prov').value,
          proxy: m.querySelector('#ai-proxy').value.trim(),
        };
        const key = m.querySelector('#ai-key').value.trim(); if (key) patch.key = key;
        const ep = m.querySelector('#ai-endpoint'); if (ep) patch.endpoint = ep.value.trim();
        GF.ai.setConfig(patch);
        U.toast('Running AI…');
        GF.ai.run({ prompt: (m.querySelector('#ai-prompt') || {}).value || '' })
          .catch(e => U.toast(e.message));
      }
    });
  }

  function openMenu() {
    modal({
      title: 'PixelTriks',
      body: `<div class="pro-grid">
        <button class="pro-btn" data-a="open">📂 Open</button>
        <button class="pro-btn" data-a="new">✚ New canvas</button>
        <button class="pro-btn" data-a="size">📐 Image size</button>
        <button class="pro-btn" data-a="save">💾 Save project</button>
        <button class="pro-btn" data-a="export">⬇ Export</button>
        <button class="pro-btn" data-a="keys">⌨ Shortcuts</button>
        <button class="pro-btn" data-a="install">⤓ Install app</button>
      </div>`,
      ok: 'Close', noCancel: true,
      mount: m => m.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
        closeModal();
        ({ open: pickFile, new: openNewDialog, size: openImageSize, save: () => GF.exporter.saveProject(), export: openExportDialog, keys: openCheatSheet, install: installApp })[b.dataset.a]();
      }))
    });
  }

  /* =================================================================
     Helpers
     ================================================================= */
  function setDims() { const el = $('#doc-dims'); if (el) el.textContent = D.doc.open ? (D.doc.width + '×' + D.doc.height) : ''; }
  function updateUndoRedo() {
    const three = GF.scene3d && GF.scene3d.isActive();
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = three ? !GF.scene3d.hist.canUndo() : !GF.history.canUndo();
    if (r) r.disabled = three ? !GF.scene3d.hist.canRedo() : !GF.history.canRedo();
    renderHistory();
  }

  /* tiny modal system */
  let modalEl = null;
  function modal(opt) {
    closeModal();
    const wrap = document.createElement('div'); wrap.className = 'fs-modal';
    wrap.innerHTML = `<div class="card">
      <h2>${opt.title}</h2>${opt.sub ? `<p class="sub">${opt.sub}</p>` : ''}
      <div class="m-body">${opt.body || ''}</div>
      <menu></menu></div>`;
    const menu = wrap.querySelector('menu'), card = wrap.querySelector('.card');
    (opt.extra || []).forEach(([label, fn]) => { const b = document.createElement('button'); b.className = 'text-btn ghost'; b.textContent = label; b.addEventListener('click', fn); menu.appendChild(b); });
    if (!opt.noCancel) { const c = document.createElement('button'); c.className = 'text-btn'; c.textContent = 'Cancel'; c.addEventListener('click', closeModal); menu.appendChild(c); }
    const ok = document.createElement('button'); ok.className = 'text-btn primary'; ok.textContent = opt.ok || 'OK';
    ok.addEventListener('click', () => { try { opt.onOk && opt.onOk(card); } finally { closeModal(); } });
    menu.appendChild(ok);
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) closeModal(); });
    document.body.appendChild(wrap); modalEl = wrap;
    if (opt.mount) opt.mount(card);
    const first = card.querySelector('input,textarea,select'); if (first) setTimeout(() => first.focus(), 30);
  }
  function closeModal() { if (modalEl) { modalEl.remove(); modalEl = null; } }

  /* =================================================================
     Command palette (⌘K) — fuzzy launcher for every action
     ================================================================= */
  /* The palette is DERIVED, not hand-maintained: tools come from TOOLMAP +
     SHORTCUTS, engine actions from the GF.api catalog (every command carrying
     ui metadata), and only dialogs / composite UI actions are listed here. */
  const TOOL_LABELS = {
    move: 'Move', select: 'Select', wand: 'Smart select', crop: 'Crop',
    brush: 'Brush (paint/erase)', fill: 'Fill', gradient: 'Gradient',
    text: 'Text', shape: 'Shape', scene3d: '3D workspace',
  };
  function commandList() {
    const cmds = Object.keys(TOOL_LABELS).map(t => {
      const key = Object.keys(SHORTCUTS).find(k => SHORTCUTS[k] === t);
      return { group: 'Tools', label: TOOL_LABELS[t], hint: key ? key.toUpperCase() : undefined, run: () => setTool(t) };
    });
    cmds.push(
      // dialogs + composite actions that live UI-side by nature
      { group: 'File', label: 'Open image…', run: pickFile },
      { group: 'File', label: 'New canvas…', run: openNewDialog },
      { group: 'File', label: 'Image size…', run: openImageSize },
      { group: 'File', label: 'Export…', hint: 'Ctrl+E', run: openExportDialog },
      { group: 'File', label: 'Save project', hint: 'Ctrl+S', run: () => GF.exporter.saveProject() },
      { group: 'Edit', label: 'Paste image', hint: 'Ctrl+V', run: () => U.toast('Press Ctrl/⌘V to paste an image') },
      { group: 'Adjust', label: 'Auto enhance', run: () => guarded(ACTIONS.enhance) },
      { group: 'Adjust', label: 'Curves…', hint: 'Ctrl+M', run: openCurves },
      { group: 'Retouch', label: 'Remove background', run: () => guarded(ACTIONS.removeBg) },
      { group: 'Retouch', label: 'Color replace…', run: () => guarded(openColorReplace) },
      { group: 'Retouch', label: 'Smart upscale 2×', run: () => guarded(() => run('smartUpscale', { factor: 2, mode: 'photo' })) },
      { group: 'Select', label: 'Select subject', run: () => guarded(selectSubject) },
      { group: 'Select', label: 'Color range…', run: () => guarded(openColorRange) },
      { group: 'Layer', label: 'Layer style (outline / glow / shadow)…', run: () => guarded(openLayerStyle) },
      { group: 'View', label: 'Zoom in', hint: ']', run: () => zoomBtn(1.25) },
      { group: 'View', label: 'Zoom out', hint: '[', run: () => zoomBtn(0.8) },
      { group: 'View', label: 'Fit to screen', run: () => GF.view.zoomFit() },
      { group: 'View', label: 'Toggle light / dark theme', run: toggleTheme },
      { group: 'Help', label: 'Keyboard shortcuts', hint: '? / K', run: openCheatSheet },
      { group: '3D', label: 'Flatten 3D render to layer', run: () => { if (GF.scene3d && GF.scene3d.count()) { GF.scene3d.snapshotToLayer(); setTool('move'); } else U.toast('Add a 3D object first'); } },
      { group: '3D', label: 'Export GLB (3D scene)', run: () => GF.scene3d && GF.scene3d.count() ? GF.scene3d.exportGLB({}) : U.toast('Add a 3D object first') },
    );
    // every ui-annotated engine command, straight from the catalog.
    // needsDoc means "a document must be open" — NOT "active layer has pixels"
    // (guarded() would wrongly block these while an adjustment layer is active)
    const docGuarded = fn => D.doc.open ? fn() : U.toast('Open an image first');
    GF.api.commands().forEach(c => cmds.push({
      group: c.group, label: c.label, hint: c.hint,
      run: () => c.needsDoc ? docGuarded(() => run(c.name, {})) : run(c.name, {}),
    }));
    ADJ_LAYER_TYPES.forEach(t => cmds.push({ group: 'Adjustment', label: 'Add ' + t.label + ' layer', run: () => addAdjustmentLayer(t.kind) }));
    FILTERS.forEach(f => cmds.push({ group: 'Filters', label: 'Filter: ' + f.name, run: () => guarded(() => { GF.filters.applyToLayer(D.active(), f.name, f.fn); GF.view.requestRender(); refreshLayers(); U.toast(f.name); }) }));
    if (GF.texture) {
      const map = { 'Normal map': makeNormalMap, 'Seamless tile': makeSeamless };
      Object.keys(map).forEach(l => cmds.push({ group: 'Texture', label: l, run: () => guarded(map[l]) }));
    }
    return cmds;
  }
  function guarded(fn) { if (!D.active() || !D.active().canvas) return U.toast('Open an image first'); fn(); }
  /* Substring matches always outrank scattered-subsequence matches (typing
     "fill" must surface "Generative fill", not "FILter: cooL"), word-start
     substrings outrank mid-word ones, and subsequences too scattered to be
     intentional are rejected outright. */
  function fuzzyScore(q, s) {
    if (!q) return 0; q = q.toLowerCase(); s = s.toLowerCase();
    const idx = s.indexOf(q);
    if (idx >= 0) return idx + (idx === 0 || /[^a-z0-9]/.test(s[idx - 1]) ? 0 : 40);
    let i = 0, last = -1, gaps = 0;
    for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) { if (last >= 0) gaps += j - last - 1; last = j; i++; }
    if (i !== q.length || gaps > q.length * 3) return -1;
    return 400 + gaps;
  }
  let paletteEl = null, palItems = [], palIdx = 0;
  function openPalette() {
    if (paletteEl) return closePalette();
    const all = commandList();
    const wrap = document.createElement('div'); wrap.className = 'cmdk';
    wrap.innerHTML = `<div class="cmdk-box" role="dialog" aria-label="Command palette">
      <div class="cmdk-top"><svg viewBox="0 0 24 24" class="cmdk-ico"><circle cx="11" cy="11" r="7"/><path d="M21 21l-4-4"/></svg>
      <input class="cmdk-input" placeholder="Search actions…" autocomplete="off" spellcheck="false" aria-label="Search actions"></div>
      <ul class="cmdk-list" role="listbox"></ul>
      <div class="cmdk-foot"><span><span class="kbd">↑↓</span> navigate</span><span><span class="kbd">↵</span> run</span><span><span class="kbd">esc</span> close</span></div></div>`;
    document.body.appendChild(wrap); paletteEl = wrap;
    const input = wrap.querySelector('.cmdk-input'), list = wrap.querySelector('.cmdk-list');
    const render = q => {
      palItems = all.map(c => ({ c, s: fuzzyScore(q, c.label + ' ' + c.group) })).filter(m => m.s >= 0)
        .sort((a, b) => a.s - b.s).slice(0, 50).map(m => m.c);
      palIdx = 0;
      list.innerHTML = palItems.length ? palItems.map((c, i) =>
        `<li class="cmdk-item${i === 0 ? ' on' : ''}" data-i="${i}" role="option"><span class="cmdk-grp">${c.group}</span><span class="cmdk-label">${c.label}</span>${c.hint ? `<span class="kbd">${c.hint}</span>` : ''}</li>`).join('')
        : `<li class="cmdk-empty">No matching actions</li>`;
      list.querySelectorAll('.cmdk-item').forEach(li => {
        li.addEventListener('mousemove', () => setActive(+li.dataset.i));
        li.addEventListener('click', () => execIdx(+li.dataset.i));
      });
    };
    const setActive = i => { palIdx = i; list.querySelectorAll('.cmdk-item').forEach(li => li.classList.toggle('on', +li.dataset.i === i)); const on = list.querySelector('.cmdk-item.on'); if (on) on.scrollIntoView({ block: 'nearest' }); };
    const execIdx = i => { const c = palItems[i]; closePalette(); if (c) setTimeout(() => { try { c.run(); } catch (e) { U.toast(e.message); } }, 0); };
    input.addEventListener('input', () => render(input.value));
    input.addEventListener('keydown', e => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive(Math.min(palIdx + 1, palItems.length - 1)); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setActive(Math.max(palIdx - 1, 0)); }
      else if (e.key === 'Enter') { e.preventDefault(); execIdx(palIdx); }
      else if (e.key === 'Escape') { e.preventDefault(); closePalette(); }
    });
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) closePalette(); });
    render(''); setTimeout(() => input.focus(), 20);
  }
  function closePalette() { if (paletteEl) { paletteEl.remove(); paletteEl = null; } }

  /* =================================================================
     Histogram (live, reflects the non-destructive adjust preview)
     ================================================================= */
  function drawHistogram() {
    const cv = $('#histogram'); if (!cv) return;
    const ctx = cv.getContext('2d'), W = cv.width, H = cv.height;
    ctx.clearRect(0, 0, W, H);
    if (!D.doc.open) return;
    // baseline so the box never reads as empty/broken (near-white images
    // collapse into a single right-edge spike)
    ctx.fillStyle = 'rgba(160,170,185,.3)';
    ctx.fillRect(0, H - 1, W, 1);
    const comp = D.composite();
    const sw = Math.min(320, comp.width), sh = Math.max(1, Math.round(comp.height * sw / comp.width));
    const s = U.makeCanvas(sw, sh), sx = U.ctx2d(s); sx.drawImage(comp, 0, 0, sw, sh);
    const img = sx.getImageData(0, 0, sw, sh);
    const h = GF.filters.histogram(img, 'lum');
    let max = 1; for (const v of h) if (v > max) max = v;
    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, 'rgba(160,170,185,.85)'); grad.addColorStop(1, 'rgba(160,170,185,.25)');
    ctx.fillStyle = grad;
    for (let i = 0; i < 256; i++) { const bh = Math.pow(h[i] / max, 0.5) * (H - 2); ctx.fillRect(i / 256 * W, H - bh, W / 256 + 0.7, bh); }
  }

  /* =================================================================
     Image size / canvas resize
     ================================================================= */
  function openImageSize() {
    if (!D.doc.open) return U.toast('Open an image first');
    const w0 = D.doc.width, h0 = D.doc.height, ar = w0 / h0;
    modal({
      title: 'Image size',
      sub: `Current: ${w0} × ${h0}px`,
      body: `<div class="row"><label>Width<input id="is-w" type="number" value="${w0}" min="1" max="8192"></label>
             <label>Height<input id="is-h" type="number" value="${h0}" min="1" max="8192"></label></div>
             <label class="ck"><input type="checkbox" id="is-lock" checked> Lock aspect ratio</label>
             <label class="ck"><input type="checkbox" id="is-resample" checked> Resample (scale the image)</label>`,
      ok: 'Resize',
      mount: m => {
        const w = m.querySelector('#is-w'), h = m.querySelector('#is-h'), lk = m.querySelector('#is-lock');
        w.addEventListener('input', () => { if (lk.checked) h.value = Math.max(1, Math.round(w.value / ar)); });
        h.addEventListener('input', () => { if (lk.checked) w.value = Math.max(1, Math.round(h.value * ar)); });
      },
      onOk: m => run('resize', {
        w: U.clamp(+m.querySelector('#is-w').value || w0, 1, 8192),
        h: U.clamp(+m.querySelector('#is-h').value || h0, 1, 8192),
        scale: m.querySelector('#is-resample').checked,
      })
    });
  }

  /* =================================================================
     Keyboard cheat-sheet
     ================================================================= */
  function openCheatSheet() {
    const rows = [
      ['Command palette', '⌘/Ctrl K'], ['Tools', 'V M W J C B E G D T U'], ['Pan', 'Space / H'],
      ['Pick colour', 'Alt-click (brush/fill)'], ['Curves', '⌘M'],
      ['Undo / Redo', '⌘Z / ⌘⇧Z'], ['Save project', '⌘S'], ['Export', '⌘E'],
      ['Select all / Invert', '⌘A / ⌘I'], ['Deselect', 'Esc'], ['Paste image', '⌘V'],
      ['Zoom out / in', '[ / ]'], ['Fit to screen', 'click %'], ['Shortcuts', '? / K'],
      ['3D: remove / frame object', 'Del / F'],
    ];
    modal({
      title: 'Keyboard shortcuts',
      body: `<div class="cheat">${rows.map(([a, b]) => `<div class="cheat-row"><span>${a}</span><span class="kbd">${b}</span></div>`).join('')}</div>`,
      ok: 'Close', noCancel: true,
    });
  }

  /* =================================================================
     Theme toggle (dark-first; remembers the manual choice)
     ================================================================= */
  function toggleTheme() {
    const root = document.documentElement;
    const cur = root.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'light' ? 'dark' : 'light';
    root.dataset.theme = next;
    try { localStorage.setItem('forge.theme', next); } catch (e) {}
  }
  function initTheme() { try { const t = localStorage.getItem('forge.theme'); if (t) document.documentElement.dataset.theme = t; } catch (e) {} }

  /* =================================================================
     Before / after compare + clipboard paste
     ================================================================= */
  function wireCompare() {
    const b = $('#adj-compare'); if (!b) return;
    const show = () => { if (D.doc.preview) { b._p = D.doc.preview; D.clearPreview(); GF.view.requestRender(); drawHistogram(); } else U.toast('No pending adjustments to compare'); };
    const hide = () => { if (b._p) { D.doc.preview = b._p; b._p = null; GF.view.requestRender(); drawHistogram(); } };
    b.addEventListener('pointerdown', e => { e.preventDefault(); show(); });
    ['pointerup', 'pointerleave', 'pointercancel'].forEach(ev => b.addEventListener(ev, hide));
  }
  function wirePaste() {
    window.addEventListener('paste', e => {
      const items = e.clipboardData && e.clipboardData.items; if (!items) return;
      for (const it of items) if (it.type && it.type.indexOf('image/') === 0) {
        const f = it.getAsFile(); if (f) { e.preventDefault(); GF.exporter.handleFiles([f]); }
      }
    });
  }

  /* =================================================================
     Crop overlay — interactive rect, aspect presets, thirds grid, straighten
     ================================================================= */
  let crop = null, cropEl = null;
  function startCrop() {
    if (!D.doc.open) { U.toast('Open an image first'); return; }
    stopCrop();
    const W = D.doc.width, H = D.doc.height;
    crop = { x: Math.round(W * 0.08), y: Math.round(H * 0.08), w: Math.round(W * 0.84), h: Math.round(H * 0.84), aspect: 0 };
    const ov = document.createElement('div'); ov.id = 'crop-overlay';
    ov.innerHTML = `<div class="crop-rect">${['nw','ne','sw','se','n','s','e','w'].map(h => `<span class="crop-h ${h}" data-h="${h}"></span>`).join('')}</div>`;
    $('#viewport').appendChild(ov); cropEl = ov;
    ov.addEventListener('wheel', e => { e.stopPropagation(); }, { passive: true });
    wireCropInteraction(ov);
    layoutCrop();
  }
  function stopCrop() { if (cropEl) { if (cropEl._cleanup) cropEl._cleanup(); cropEl.remove(); cropEl = null; } crop = null; }
  function layoutCrop() {
    if (!cropEl || !crop) return; const v = V(), r = cropEl.querySelector('.crop-rect');
    r.style.left = (v.panX + crop.x * v.zoom) + 'px'; r.style.top = (v.panY + crop.y * v.zoom) + 'px';
    r.style.width = (crop.w * v.zoom) + 'px'; r.style.height = (crop.h * v.zoom) + 'px';
  }
  function setCropAspect(ar) {
    crop.aspect = ar;
    if (ar) {
      const W = D.doc.width, H = D.doc.height; let w = W, h = W / ar; if (h > H) { h = H; w = H * ar; }
      crop.w = Math.round(w * 0.94); crop.h = Math.round(h * 0.94);
      crop.x = Math.round((W - crop.w) / 2); crop.y = Math.round((H - crop.h) / 2);
    }
    layoutCrop();
  }
  function wireCropInteraction(ov) {
    let mode = null, start = null, orig = null;
    const onDown = e => { mode = e.target.dataset.h || 'move'; start = { x: e.clientX, y: e.clientY }; orig = Object.assign({}, crop); e.preventDefault(); e.stopPropagation(); };
    const onMove = e => {
      if (!mode) return; const v = V(), dx = (e.clientX - start.x) / v.zoom, dy = (e.clientY - start.y) / v.zoom;
      resizeCrop(mode, orig, dx, dy); layoutCrop();
    };
    const onUp = () => { mode = null; };
    ov.querySelector('.crop-rect').addEventListener('pointerdown', onDown);
    ov.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    ov._cleanup = () => window.removeEventListener('pointerup', onUp);
  }
  function resizeCrop(mode, o, dx, dy) {
    const W = D.doc.width, H = D.doc.height, ar = crop.aspect;
    let x = o.x, y = o.y, w = o.w, h = o.h;
    if (mode === 'move') { x = U.clamp(o.x + dx, 0, W - o.w); y = U.clamp(o.y + dy, 0, H - o.h); }
    else {
      if (mode.indexOf('e') >= 0) w = o.w + dx;
      if (mode.indexOf('s') >= 0) h = o.h + dy;
      if (mode.indexOf('w') >= 0) { x = o.x + dx; w = o.w - dx; }
      if (mode.indexOf('n') >= 0) { y = o.y + dy; h = o.h - dy; }
      w = Math.max(24, w); h = Math.max(24, h);
      if (ar) {
        if (mode === 'n' || mode === 's') w = h * ar; else h = w / ar;
        if (mode.indexOf('w') >= 0) x = o.x + o.w - w;
        if (mode.indexOf('n') >= 0) y = o.y + o.h - h;
      }
      x = Math.max(0, x); y = Math.max(0, y); w = Math.min(w, W - x); h = Math.min(h, H - y);
    }
    crop.x = x; crop.y = y; crop.w = w; crop.h = h;
  }
  function applyCropTool() {
    if (!crop) return;
    const x = Math.round(crop.x), y = Math.round(crop.y), w = Math.round(crop.w), h = Math.round(crop.h);
    if (w < 1 || h < 1) return;
    stopCrop();
    cropDocTo(x, y, w, h);            // shared with "crop to selection"
    setTool('move'); U.toast('Cropped to ' + w + '×' + h);
  }
  function straighten(deg) {
    if (!deg) return;
    const rad = deg * Math.PI / 180, W = D.doc.width, H = D.doc.height;
    const c = Math.abs(Math.cos(rad)), s = Math.abs(Math.sin(rad));
    const nw = Math.ceil(W * c + H * s), nh = Math.ceil(W * s + H * c);
    GF.history.push(D.doc, 'straighten');
    const rot = (src) => { const nc = U.makeCanvas(nw, nh), x = U.ctx2d(nc); x.translate(nw / 2, nh / 2); x.rotate(rad); x.translate(-W / 2, -H / 2); x.drawImage(src, 0, 0); return nc; };
    for (const L of D.doc.layers) {
      if (!L.canvas) continue;
      const base = D.docAligned(L);
      L.canvas = rot(base.canvas); L.x = 0; L.y = 0;
      if (L.mask) L.mask = rot(L.mask);
    }
    D.doc.width = nw; D.doc.height = nh;
    if (crop) { crop.x = 0; crop.y = 0; crop.w = nw; crop.h = nh; crop.aspect = 0; }
    GF.view.zoomFit(); refreshLayers(); setDims(); layoutCrop();
  }

  /* =================================================================
     History panel — scrubbable, named steps
     ================================================================= */
  function renderHistory() {
    const list = $('#history-list'); if (!list) return;
    const info = GF.history.info();
    list.innerHTML = '';
    const add = (label, cls, onClick) => {
      const li = document.createElement('li'); li.className = 'hist-item' + (cls ? ' ' + cls : '');
      li.textContent = label; if (onClick) li.addEventListener('click', onClick); list.appendChild(li);
    };
    add('Original', info.undo.length === 0 ? 'on' : 'base', () => jumpHistory(-info.undo.length));
    info.undo.forEach((label, i) => add(label, i === info.undo.length - 1 ? 'on' : '', () => jumpHistory(-(info.undo.length - 1 - i))));
    info.redo.forEach((label, j) => add(label, 'future', () => jumpHistory(j + 1)));
  }
  function jumpHistory(delta) {
    if (delta < 0) for (let i = 0; i < -delta; i++) GF.history.undo(D.doc);
    else for (let i = 0; i < delta; i++) GF.history.redo(D.doc);
    refreshLayers(); GF.view.requestRender(); drawHistogram();
  }

  /* =================================================================
     Non-destructive adjustment layers (re-editable, live, in the stack)
     ================================================================= */
  const ADJ_LAYER_TYPES = [
    { kind: 'brightnessContrast', label: 'Brightness / Contrast' },
    { kind: 'levels', label: 'Levels' },
    { kind: 'curves', label: 'Curves' },
    { kind: 'hsl', label: 'Hue / Saturation' },
    { kind: 'grayscale', label: 'Black & White' },
  ];
  const ADJ_EDITABLE = ['brightnessContrast', 'hsl', 'levels', 'curves'];
  function adjustDefaults(kind) {
    return ({ brightnessContrast: { brightness: 0, contrast: 0 }, hsl: { h: 0, s: 0, l: 0 },
      levels: { black: 0, white: 255, gamma: 1 }, curves: { curves: {} } })[kind] || {};
  }
  function openAddAdjustment() {
    if (!D.doc.open) return U.toast('Open an image first');
    modal({
      title: 'Add adjustment layer',
      sub: 'Non-destructive — re-edit or delete it any time',
      body: `<div class="pro-grid">${ADJ_LAYER_TYPES.map(t => `<button class="pro-btn" data-k="${t.kind}">${t.label}</button>`).join('')}</div>`,
      ok: 'Close', noCancel: true,
      mount: m => m.querySelectorAll('[data-k]').forEach(b => b.addEventListener('click', () => { closeModal(); addAdjustmentLayer(b.dataset.k); }))
    });
  }
  function addAdjustmentLayer(kind) {
    if (!D.doc.open) return U.toast('Open an image first');
    GF.history.push(D.doc, 'add adjustment');
    const L = D.addAdjustment(kind, adjustDefaults(kind));
    if (GF.select.has()) D.addMask(null, 'selection');   // selection → the adjustment only affects that area
    refreshLayers(); GF.view.requestRender(); drawHistogram();
    if (ADJ_EDITABLE.indexOf(kind) >= 0) openAdjustmentEditor(L);
    else U.toast(L.name + ' added');
  }
  function adjModalSlider(label, key, val, min, max, scale) {
    return `<div class="slider"><div class="slider-top"><b>${label}</b><span class="val" data-vk="${key}">${val}</span></div>
      <input type="range" data-k="${key}" data-scale="${scale || 1}" min="${min}" max="${max}" value="${val}"></div>`;
  }
  function openAdjustmentEditor(L) {
    if (!L || !L.adjust) return;
    const p = L.adjust.params, kind = L.adjust.kind;
    const upd = patch => { D.setAdjust(L, patch); GF.view.requestRender(); drawHistogram(); };
    let body = '', isCurves = false;
    if (kind === 'brightnessContrast') body = adjModalSlider('Brightness', 'brightness', p.brightness || 0, -100, 100) + adjModalSlider('Contrast', 'contrast', p.contrast || 0, -100, 100);
    else if (kind === 'hsl') body = adjModalSlider('Hue', 'h', p.h || 0, -180, 180) + adjModalSlider('Saturation', 's', p.s || 0, -100, 100) + adjModalSlider('Lightness', 'l', p.l || 0, -100, 100);
    else if (kind === 'levels') body = adjModalSlider('Black point', 'black', p.black || 0, 0, 254) + adjModalSlider('White point', 'white', p.white == null ? 255 : p.white, 1, 255) + adjModalSlider('Gamma', 'gamma', Math.round((p.gamma || 1) * 100), 10, 300, 0.01);
    else if (kind === 'curves') { isCurves = true; body = `<canvas id="al-curve" width="300" height="220" style="border-radius:8px;touch-action:none;box-shadow:inset 0 0 0 1px var(--line)"></canvas><div class="seg" id="al-ch" style="margin-top:.6rem"><button data-v="rgb" class="on">RGB</button><button data-v="r">R</button><button data-v="g">G</button><button data-v="b">B</button></div>`; }
    modal({
      title: 'Edit: ' + (L.name || kind), sub: 'Live · non-destructive',
      body: `<div style="display:grid;gap:.5rem;${isCurves ? 'place-items:center' : ''}">${body}</div>`,
      ok: 'Done', noCancel: true,
      extra: [['Delete', () => { closeModal(); GF.history.push(D.doc, 'delete adjustment'); D.doc.activeId = L.id; D.deleteActive(); refreshLayers(); GF.view.requestRender(); drawHistogram(); }]],
      mount: m => {
        if (isCurves) {
          try {
            GF.curveEditor.init({ canvas: m.querySelector('#al-curve'), onChange: () => upd({ curves: GF.curveEditor.getCurves() }) });
            GF.curveEditor.setCurves(p.curves && Object.keys(p.curves).length ? p.curves : undefined); GF.curveEditor.render();
            m.querySelectorAll('#al-ch button').forEach(b => b.addEventListener('click', () => { m.querySelectorAll('#al-ch button').forEach(x => x.classList.remove('on')); b.classList.add('on'); GF.curveEditor.setChannel(b.dataset.v); }));
          } catch (e) {}
        } else {
          m.querySelectorAll('input[data-k]').forEach(inp => inp.addEventListener('input', () => {
            const sc = parseFloat(inp.dataset.scale) || 1, raw = +inp.value;
            upd({ [inp.dataset.k]: sc === 1 ? raw : raw * sc });
            const sp = m.querySelector('.val[data-vk="' + inp.dataset.k + '"]'); if (sp) sp.textContent = inp.value;
          }));
        }
      }
    });
  }

  /* =================================================================
     PWA install + IndexedDB autosave / crash recovery
     ================================================================= */
  let deferredInstall = null;
  function registerSW() {
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol))
      navigator.serviceWorker.register('sw.js').catch(() => {});
  }
  function installApp() {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
    else U.toast('Install isn\'t available here (already installed, or open over http to enable)');
  }
  const IDB_STORE = 'session';
  function idb() {
    return new Promise((res, rej) => {
      let r; try { r = indexedDB.open('forge-studio', 1); } catch (e) { return rej(e); }
      r.onupgradeneeded = () => r.result.createObjectStore(IDB_STORE);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  function idbSet(key, val) { return idb().then(db => new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, 'readwrite'); tx.objectStore(IDB_STORE).put(val, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); })); }
  function idbGet(key) { return idb().then(db => new Promise((res, rej) => { const tx = db.transaction(IDB_STORE, 'readonly'); const rq = tx.objectStore(IDB_STORE).get(key); rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error); })); }
  let autosaveTimer = null;
  function scheduleAutosave() {
    if (!('indexedDB' in window)) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { if (D.doc.open) { try { idbSet('autosave', { ts: Date.now(), data: D.serialize() }).catch(() => {}); } catch (e) {} } }, 2500);
  }
  function checkRestore() {
    if (!('indexedDB' in window)) return;
    idbGet('autosave').then(s => { if (s && s.data && !D.doc.open) offerRestore(s); }).catch(() => {});
  }
  function offerRestore(s) {
    let when = 'a previous session'; try { when = new Date(s.ts).toLocaleString(); } catch (e) {}
    modal({
      title: 'Restore last session?',
      sub: 'Autosaved ' + when,
      body: `<p class="sub">Your last edits were saved automatically. Restore them, or start fresh.</p>`,
      ok: 'Restore',
      extra: [['Discard', () => { closeModal(); idbSet('autosave', null).catch(() => {}); }]],
      onOk: () => { D.deserialize(s.data).then(() => GF.ui.onDocumentOpened()).catch(() => U.toast('Could not restore session')); }
    });
  }

  /* =================================================================
     Wire the new pro features
     ================================================================= */
  function wireProFeatures() {
    initTheme();
    wireCompare(); wirePaste();
    registerSW();
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
    GF.history.onChange(scheduleAutosave);
    if (!V().selMode) V().selMode = 'replace';
    if (!('sample' in V().wand)) V().wand.sample = 'all';
    if (V().wand.autoRemove === undefined) V().wand.autoRemove = false;
    if (V().brush.erasing === undefined) V().brush.erasing = false;
    GF.select.onChange(updateSelBar); updateSelBar();
    $('#btn-palette') && $('#btn-palette').addEventListener('click', openPalette);
    $('#btn-theme') && $('#btn-theme').addEventListener('click', toggleTheme);
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); openPalette(); return; }
      if (paletteEl) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (!typing && !modalEl && (e.key === '?' || k === 'k')) { e.preventDefault(); openCheatSheet(); }
    });
    checkRestore();

    // Wire assets tab — 3D primitives
    $$('#asset-prims .pro-btn[data-prim]').forEach(b => b.addEventListener('click', () => {
      if (GF.scene3d) GF.scene3d.addPrimitive(b.dataset.prim);
      else U.toast('Switch to 3D mode first');
    }));
    const importModel = $('#asset-import-model');
    if (importModel) importModel.addEventListener('click', pickFile);
    const importTex = $('#asset-import-texture');
    if (importTex) importTex.addEventListener('click', pickFile);

    // Wire guide tab — updates on tool change
    window.addEventListener('pt:toolchange', updateGuide);
    updateGuide();
  }

  /* ---- Context-sensitive guide content ---- */
  const GUIDE_CONTENT = {
    move: { title: 'Move Tool', keys: [['V','Select this tool'],['Drag','Move active layer'],['Shift+Drag','Constrain axis']], tip: 'The transform pad (bottom-left) lets you nudge 1px at a time. Hold Shift for 10px steps.' },
    select: { title: 'Marquee Select', keys: [['M','Select this tool'],['Shift+Drag','Add to selection'],['Alt+Drag','Subtract'],['Ctrl+A','Select all']], tip: 'After selecting, use the action bar to fill, delete, cut out, or apply AI effects.' },
    wand: { title: 'Smart Select', keys: [['W','Select this tool'],['Click','Select similar pixels'],['Shift+Click','Add'],['Alt+Click','Subtract']], tip: 'Adjust Tolerance in the tool options to control how much is selected. Higher = more forgiving.' },
    crop: { title: 'Crop Tool', keys: [['C','Select this tool'],['Drag handles','Resize crop area'],['Drag center','Move crop area']], tip: 'Use the aspect ratio presets in tool options. Straighten slider rotates before cropping.' },
    brush: { title: 'Brush Tool', keys: [['B','Select this tool'],['[/]','Decrease/increase size'],['Alt+Click','Pick color'],['Shift+Click','Straight line']], tip: 'Toggle between Paint and Erase modes in tool options. Enable Pixel mode for crisp 1px drawing.' },
    fill: { title: 'Fill Tool', keys: [['G','Select this tool'],['Click','Flood fill area']], tip: 'Adjust Tolerance to control how far the fill spreads. Lower = more precise boundaries.' },
    gradient: { title: 'Gradient Tool', keys: [['D','Select this tool'],['Drag','Draw gradient']], tip: 'Choose Linear or Radial in tool options. Enable "Fade to transparent" for overlay effects.' },
    text: { title: 'Text Tool', keys: [['T','Select this tool'],['Click canvas','Place text']], tip: 'Double-click a text layer in the Layers panel to re-edit it. Add outlines for readable text on any background.' },
    shape: { title: 'Shape Tool', keys: [['U','Select this tool'],['Drag','Draw shape'],['Shift+Drag','Constrain proportions']], tip: 'Choose between Rect, Ellipse, and Line. Toggle Fill on/off for outlined vs filled shapes.' },
    scene3d: { title: '3D Workspace', keys: [['Orbit','Left-drag'],['Pan','Middle-drag / Shift+drag'],['Zoom','Scroll wheel'],['Delete','Remove selected'],['F','Frame selected']], tip: 'Add primitives from the Assets tab. Use the transform pad to nudge position, rotation, and scale precisely.' },
  };

  function updateGuide() {
    const body = $('#guide-body');
    if (!body) return;
    const g = GUIDE_CONTENT[curTool];
    if (!g) {
      body.innerHTML = '<p class="guide-intro">No guide available for this tool.</p>';
      return;
    }
    let html = '<div class="guide-section"><h3>Shortcuts</h3>';
    g.keys.forEach(([key, desc]) => {
      html += `<p><span class="kbd">${key}</span> ${desc}</p>`;
    });
    html += '</div>';
    html += `<div class="guide-section"><h3>Tips</h3><p>${g.tip}</p></div>`;
    body.innerHTML = html;
  }

  /* ---- action bar buttons (bottom hotbar + any [data-action] element) ---- */
  function wireActionBar() {
    $$('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const a = btn.dataset.action;
        if (a === 'add-box') GF.api.run('scene3d.addPrimitive', { kind: 'box' });
        else if (a === 'add-sphere') GF.api.run('scene3d.addPrimitive', { kind: 'sphere' });
        else if (a === 'add-cylinder') GF.api.run('scene3d.addPrimitive', { kind: 'cylinder' });
        else if (a === 'add-plane') GF.api.run('scene3d.addPrimitive', { kind: 'plane' });
        else if (a === 'import-model') $('#file-input').click();
      });
    });
    const gen = $('#ab-generate');
    if (gen) gen.addEventListener('click', () => { if (GF.ui.openAIDialog) GF.ui.openAIDialog(); });
    const assets = $('#ab-assets');
    if (assets) assets.addEventListener('click', () => {
      const tab = $('.ptab[data-tab="scene"]'); if (tab) tab.click();
    });
  }

  /* =================================================================
     Pro selections — modify menu, contextual "use selection" action bar
     ================================================================= */
  function composImg() { return U.ctx2d(D.composite()).getImageData(0, 0, D.doc.width, D.doc.height); }

  /* live re-select from the last wand click, so Tolerance/Contiguous/Sample
     update the selection in real time (the options have visible, logical effect). */
  function reWand() {
    const s = V().wand.seed; if (!s || !D.doc.open) return;
    const L = D.active();
    const img = (V().wand.sample === 'layer' && L && L.canvas)
      ? U.ctx2d(D.docAligned(L).canvas).getImageData(0, 0, D.doc.width, D.doc.height)
      : composImg();
    GF.select.wand(img, s.x, s.y, V().wand.tolerance, V().wand.contiguous, 'replace');
    if (V().wand.antialias) GF.select.feather(1);
    GF.view.requestRender();
  }

  function selectSubject() {
    GF.select.selectBackground(composImg(), 32); GF.select.invert(); GF.view.requestRender();
  }
  function openColorRange() {
    if (!D.doc.open) return;
    modal({
      title: 'Color range',
      sub: 'Select everything near a colour',
      body: `<div class="row"><label>Colour<input id="cr-col" type="color" value="${V().brush.color}"></label>
             <label>Fuzziness <span id="cr-tv">40</span><input id="cr-tol" type="range" min="0" max="160" value="40"></label></div>
             <label class="ck"><input type="checkbox" id="cr-add"> Add to current selection</label>`,
      ok: 'Select',
      mount: m => m.querySelector('#cr-tol').addEventListener('input', e => m.querySelector('#cr-tv').textContent = e.target.value),
      onOk: m => {
        const c = U.hexToRgb(m.querySelector('#cr-col').value);
        GF.select.selectColor(composImg(), c.r, c.g, c.b, +m.querySelector('#cr-tol').value, m.querySelector('#cr-add').checked ? 'add' : 'replace');
        GF.view.requestRender();
      }
    });
  }

  /* Selection bar — delegated to ui/selection-bar.js (GF.selectionBar) */
  function updateSelBar() { /* no-op — hotbar owns selection UI */ }

  function cropDocTo(x, y, w, h) {
    if (GF.selectionBar) GF.selectionBar.cropTo(x, y, w, h);
    else { /* fallback inline */ }
    refreshLayers(); setDims();
  }
  /* cropToSelection removed — hotbar sel-crop action (hotbar.js) is the canonical path */

  /* Tool guides — delegated to ui/tool-guides.js (GF.toolGuides) */
  let curTool = 'brush';

  /* =================================================================
     Boot
     ================================================================= */
  function boot() {
    GF.view.init();
    GF.ui.init();
    $('#empty-state').hidden = false;
  }
  /* =================================================================
     Status bar — thin system HUD at the very bottom
     ================================================================= */
  function updateStatusBar() {
    const sbLayers = $('#sb-layers');
    const sbTool = $('#sb-tool');
    const sbMode = $('#sb-mode');
    const sbMem = $('#sb-mem');
    const sbGpu = $('#sb-gpu');

    if (sbLayers) {
      const count = D.doc.open ? (D.doc.layers || []).length : 0;
      sbLayers.textContent = '◧ ' + count + ' layer' + (count !== 1 ? 's' : '');
    }
    if (sbTool) {
      const labels = { move:'Move', select:'Select', wand:'Wand', crop:'Crop', brush:'Brush',
        fill:'Fill', gradient:'Gradient', text:'Text', shape:'Shape', scene3d:'3D Scene', pan:'Pan' };
      sbTool.textContent = '▸ ' + (labels[curTool] || curTool);
    }
    if (sbMode) {
      const mode = document.body.dataset.mode || '2d';
      sbMode.textContent = '● ' + mode.toUpperCase();
    }
    if (sbMem && performance.memory) {
      const mb = Math.round(performance.memory.usedJSHeapSize / 1048576);
      sbMem.textContent = mb + ' MB';
    } else if (sbMem) {
      sbMem.textContent = '—';
    }
    if (sbGpu) {
      const gl = document.createElement('canvas').getContext('webgl2');
      sbGpu.textContent = gl ? '⬡ WebGL2' : '⬡ WebGL';
    }
  }

  // Wire status bar updates to existing events
  const origRefreshLayers = refreshLayers;
  function patchedRefreshLayers() {
    origRefreshLayers();
    updateStatusBar();
  }
  // Re-assign the reference used by the closure
  GF.ui.refreshLayers = patchedRefreshLayers;

  // Also update on tool change via the event bus
  window.addEventListener('pt:toolchange', updateStatusBar);
  window.addEventListener('pt:modechange', updateStatusBar);
  window.addEventListener('pt:docopen', updateStatusBar);

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
