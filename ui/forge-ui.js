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

  /* engine tool name per rail button */
  const TOOLMAP = {
    move:'move', select:'marquee', wand:'wand', crop:'marquee',
    brush:'brush', eraser:'eraser', fill:'fill', text:'text',
    shape:'shape', eyedropper:'picker', pan:'pan',
    magicerase:'magiceraser', clone:'clone', gradient:'gradient'
  };
  const SHORTCUTS = { v:'move', m:'select', w:'wand', c:'crop', b:'brush',
    e:'eraser', g:'fill', t:'text', u:'shape', i:'eyedropper', h:'pan',
    j:'magicerase', s:'clone', d:'gradient' };

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
    { key:'vibrance',   label:'Vibrance',   min:-100, max:100, adv:true },
    { key:'warmth',     label:'Warmth',     min:-100, max:100, adv:true },
    { key:'clarity',    label:'Clarity',    min:-100, max:100, adv:true },
  ];
  let adj = blankAdj();
  function blankAdj() { return { exposure:0, contrast:0, saturation:0, vibrance:0, warmth:0, clarity:0 }; }
  function adjActive() { return ADJ.some(s => adj[s.key] !== 0); }

  const FILTERS = [
    { name:'B&W',     fn:i => GF.filters.grayscale(i) },
    { name:'Pop',     fn:i => { GF.filters.autoLevels(i); GF.filters.hsl(i,0,18,0); } },
    { name:'Warm',    fn:i => warmth(i, 28) },
    { name:'Cool',    fn:i => warmth(i, -28) },
    { name:'Noir',    fn:i => { GF.filters.grayscale(i); GF.filters.brightnessContrast(i,-4,26); } },
    { name:'Sharp',   fn:i => GF.filters.sharpen(i) },
    { name:'Soft',    fn:i => GF.filters.blur(i) },
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
    buildProTools();
    wireTopbar();
    wireUIMode();
    wireTools();
    wirePanel();
    wireHero();
    wireLayers();
    wireKeyboard();
    wireDropAndFiles();
    wireMobile();
    wireGestures();
    wireProFeatures();
    GF.history.onChange(updateUndoRedo);
    setTool('brush');
    updateUndoRedo();
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
    stopCrop();
    if (V().wand) V().wand.seed = null;
    adj = blankAdj(); D.clearPreview(); syncAdjustUI();
    refreshLayers();
    GF.view.zoomFit();
    updateZoomLabel();
    setDims();
    drawHistogram();
    if (pendingIntent) { const k = pendingIntent; pendingIntent = null; runIntent(k); }
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

  GF.ui = { init, onDocumentOpened, refreshLayers, updateZoomLabel, showCursorPos, openTextDialog };

  /* =================================================================
     Build dynamic UI
     ================================================================= */
  function buildAdjustUI() {
    const host = $('#adj-sliders'); host.innerHTML = '';
    ADJ.forEach(s => {
      const row = document.createElement('div'); row.className = 'slider';
      if (s.adv) row.setAttribute('data-adv', '');   // hidden in Simple mode
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
    FILTERS.forEach(f => {
      const b = document.createElement('button'); b.className = 'filter-chip';
      b.innerHTML = `<span>${f.name}</span>`;
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
  function buildProTools() {
    const grid = $('#pro-grid'); if (!grid) return;
    const tools = [
      ['Content-aware fill', () => run('contentAwareFill')],
      ['Color replace', openColorReplace],
      ['Smart upscale 2×', () => run('smartUpscale', { factor: 2, mode: 'photo' })],
      ['Add mask', () => run('addMask', { init: 'reveal' })],
      ['Curves', openCurves],
      ['Trim to content', () => run('trim')],
      ['Flip H', () => run('flipLayer', { horizontal: true })],
      ['Rotate 90°', () => run('rotateLayer', { cw: true })],
      ['Layer style…', openLayerStyle],
      ['Ink outline', () => run('inkOutline', {})],
      ['Clean colors', () => run('cleanColors', {})],
    ];
    // In-app PBR / texture tools (only when the texture engine is loaded)
    if (GF.texture) tools.push(
      ['Normal map', makeNormalMap],
      ['Seamless tile', makeSeamless],
      ['PBR material', () => run('materialWizard', { tileable: true })],
      ['Retro dither', retroDither],
    );
    grid.innerHTML = '';
    tools.forEach(([label, fn]) => {
      const b = document.createElement('button'); b.className = 'pro-btn'; b.textContent = label;
      b.addEventListener('click', () => { if (!D.active() || !D.active().canvas) return U.toast('Open an image first'); fn(); });
      grid.appendChild(b);
    });
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
  function retroDither() {
    const L = D.active();
    GF.filters.applyToLayer(L, 'dither', img => GF.texture.ditherFS(img, GF.texture.extractPalette(L, 8)));
    GF.view.requestRender(); refreshLayers(); U.toast('Retro dither');
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
      pendingIntent = kind; pickFile();
    }));
  }
  function runIntent(kind) {
    switch (kind) {
      case 'enhance':  $('#hero-enhance').click(); break;
      case 'removebg': $('#hero-removebg').click(); break;
      case 'erase':    setTool('magicerase'); U.toast('Click the object you want to remove — it heals away'); break;
      case 'cutout':   setTool('wand'); U.toast('Tap the subject (background → ⇄ Invert), then ✂️ Cut out'); break;
      case 'genfill':  setTool('wand'); U.toast('Select a region, then ✦ Replace (AI)'); break;
    }
  }

  function wireTopbar() {
    $('#btn-open').addEventListener('click', pickFile);
    $('#empty-open').addEventListener('click', () => { pendingIntent = null; pickFile(); });
    $('#btn-new').addEventListener('click', openNewDialog);
    $('#empty-new').addEventListener('click', openNewDialog);
    wireIntents();
    $('#btn-undo').addEventListener('click', () => run('undo'));
    $('#btn-redo').addEventListener('click', () => run('redo'));
    $('#btn-export').addEventListener('click', openExportDialog);
    $('#btn-ai').addEventListener('click', openAIDialog);
    $('#btn-zoom-in').addEventListener('click', () => zoomBtn(1.25));
    $('#btn-zoom-out').addEventListener('click', () => zoomBtn(0.8));
    $('#zoom-label').addEventListener('click', () => { GF.view.zoomFit(); layoutCrop(); });
    $('#btn-menu').addEventListener('click', openMenu);
  }
  function zoomBtn(factor) {
    const r = $('#viewport').getBoundingClientRect();
    GF.view.zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
    layoutCrop();
  }

  /* Simple / Pro interface. Simple = a slim, uncluttered default (essential
     tools + Adjust/Layers); Pro reveals every tool and the More panel. Nothing
     is lost in Simple — the command palette (⌘K) still reaches everything. */
  const ADV_TOOLS = ['fill', 'shape', 'eyedropper', 'clone', 'gradient'];
  function wireUIMode() {
    const b = $('#btn-simple'); if (!b) return;
    const label = b.querySelector('.ui-mode');
    const apply = mode => {
      document.body.dataset.ui = mode;
      if (label) label.textContent = mode === 'simple' ? 'Simple' : 'Pro';
      b.classList.toggle('pro', mode === 'pro');
      b.title = mode === 'simple'
        ? 'Simple interface — click for Pro (every tool & the More panel)'
        : 'Pro interface — click for Simple';
      if (mode === 'simple') {
        if ($('#panel').dataset.tab === 'pro') { const at = $('.ptab[data-tab="adjust"]'); if (at) at.click(); }
        if (ADV_TOOLS.indexOf(curTool) >= 0) setTool('brush');   // don't strand an active, now-hidden tool
      }
      buildOptbar(curTool);   // reflect the new density in the current tool's options
      try { localStorage.setItem('forge.ui', mode); } catch (e) {}
    };
    b.addEventListener('click', () => {
      const next = document.body.dataset.ui === 'simple' ? 'pro' : 'simple';
      apply(next);
      U.toast(next === 'pro' ? 'Pro interface — all tools & panels shown' : 'Simple interface');
    });
    let saved = 'simple'; try { saved = localStorage.getItem('forge.ui') || 'simple'; } catch (e) {}
    apply(saved);
  }

  function wireTools() {
    $$('#toolrail .tool').forEach(b => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $('#brush-color').addEventListener('input', e => { V().brush.color = e.target.value; });
  }
  function setTool(name) {
    curTool = name;
    if (cropEl && name !== 'crop') stopCrop();
    cropMode = (name === 'crop');
    const eng = TOOLMAP[name] || name;
    // crop uses its own overlay (not the engine marquee); park the engine on move
    V().tool = (name === 'crop') ? 'move' : eng;
    $$('#toolrail .tool').forEach(b => { const on = b.dataset.tool === name; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on ? 'true' : 'false'); });
    buildOptbar(name);
    if (name === 'crop') startCrop();
    if (name === 'wand') showWandCoach();
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

  function buildOptbar(name) {
    const bar = $('#optbar');
    const simple = document.body.dataset.ui === 'simple';   // pare dense options in Simple mode
    let html = '';
    if (name === 'brush' || name === 'eraser') {
      html = optSlider('Size', 'brush-size', 1, 200, V().brush.size)
           + optSlider('Opacity', 'brush-op', 0, 100, Math.round((V().brush.opacity ?? 1) * 100))
           + (simple || name === 'eraser' ? '' : seg('brush-shape', [['round','Round'],['square','Square']], V().brush.shape || 'round'))
           + `<label class="opt"><input type="checkbox" id="brush-pixel" ${V().brush.pixel ? 'checked' : ''}> Pixel</label>`;
    } else if (name === 'magicerase') {
      html = `<span class="opt">Click an object to remove it</span>`
           + seg('me-mode', [['heal','Heal (rebuild)'],['erase','Erase (transparent)']], V().wand.heal ? 'heal' : 'erase')
           + optSlider('Tolerance', 'me-tol', 0, 128, V().wand.tolerance)
           + (simple ? '' : `<label class="opt"><input type="checkbox" id="me-cont" ${V().wand.contiguous ? 'checked' : ''}> Contiguous</label>`);
    } else if (name === 'clone') {
      html = `<span class="opt"><span class="kbd">Alt</span>-click a source, then paint</span>`
           + optSlider('Size', 'brush-size', 1, 200, V().brush.size)
           + optSlider('Opacity', 'brush-op', 0, 100, Math.round((V().brush.opacity ?? 1) * 100));
    } else if (name === 'gradient') {
      html = seg('grad-kind', [['linear','Linear'],['radial','Radial']], V().gradient.kind || 'linear')
           + `<label class="opt"><input type="checkbox" id="grad-alpha" ${V().gradient.toAlpha ? 'checked' : ''}> Fade to transparent</label>`
           + `<label class="opt">End color<input type="color" id="grad-c2" value="${V().gradient.color2 || '#1a1d24'}"></label>`
           + `<span class="opt">Drag on the canvas to draw</span>`;
    } else if (name === 'fill') {
      html = optSlider('Tolerance', 'fill-tol', 0, 128, V().fillTolerance);
    } else if (name === 'wand') {
      html = (simple ? '' : selModeSeg())
           + optSlider('Tolerance', 'wand-tol', 0, 128, V().wand.tolerance)
           + `<label class="opt"><input type="checkbox" id="wand-cont" ${V().wand.contiguous ? 'checked' : ''}> Contiguous</label>`
           + (simple ? '' : seg('wand-sample', [['all','All layers'],['layer','Layer']], V().wand.sample || 'all')
              + `<label class="opt"><input type="checkbox" id="wand-aa" ${V().wand.antialias ? 'checked' : ''}> Anti-alias</label>`)
           + `<button class="text-btn ghost" id="sel-menu">Select ▾</button>`;
    } else if (name === 'select') {
      html = (simple ? '' : selModeSeg())
           + seg('sel-shape', [['rect','Rect'],['ellipse','Ellipse'],['lasso','Lasso']], V().marquee.shape)
           + (simple ? '' : `<button class="text-btn ghost" id="sel-feather">Feather</button>`
              + `<button class="text-btn ghost" id="sel-grow">Grow</button>`)
           + `<button class="text-btn ghost" id="sel-menu">Select ▾</button>`;
    } else if (name === 'shape') {
      html = seg('shp-kind', [['rect','Rect'],['ellipse','Ellipse'],['line','Line']], V().shape.kind)
           + `<label class="opt"><input type="checkbox" id="shp-fill" ${V().shape.fill ? 'checked':''}> Fill</label>`;
    } else if (name === 'crop') {
      html = seg('crop-aspect', [['0','Free'],['1','1:1'],['0.8','4:5'],['1.7778','16:9'],['0.5625','9:16'],['1.5','3:2'],['orig','Orig']], '0')
           + `<label class="opt">Straighten<input type="range" id="crop-straighten" min="-15" max="15" value="0" step="0.5"><span class="opt-v" id="crop-straighten-v">0°</span></label>`
           + `<button class="text-btn primary" id="crop-apply">Crop</button>`
           + `<button class="text-btn ghost" id="crop-cancel">Cancel</button>`;
    } else if (name === 'text') {
      html = `<span class="opt">Click on the canvas to place text</span>`;
    } else if (name === 'move' || name === 'eyedropper' || name === 'pan') {
      html = `<span class="opt">${name === 'move' ? 'Drag to move the active layer' : name === 'pan' ? 'Drag to pan · pinch to zoom' : 'Click to pick a color'}</span>`;
    }
    if (html && GUIDES[name]) html += guideBtn(name);   // every tool gets a "?" guide
    if (!html) { bar.hidden = true; return; }
    bar.hidden = false; bar.innerHTML = html;
    wireOptbar(name);
  }
  function optSlider(label, id, min, max, val) {
    return `<label class="opt">${label}<input type="range" id="${id}" min="${min}" max="${max}" value="${val}"><span class="opt-v" id="${id}-v">${val}</span></label>`;
  }
  function seg(id, items, cur) {
    return `<span class="seg" id="${id}">` + items.map(([v,l]) => `<button data-v="${v}" class="${v===cur?'on':''}">${l}</button>`).join('') + `</span>`;
  }
  function selModeSeg() { return `<span class="opt">Mode</span>` + seg('sel-mode', [['replace','New'],['add','Add'],['subtract','Sub'],['intersect','Int']], V().selMode || 'replace'); }
  function guideBtn(name) { return `<button class="icon-btn sm guide-btn" data-guide="${name}" title="How to use this tool" aria-label="Tool guide">?</button>`; }
  function wireOptbar(name) {
    const bind = (id, fn) => { const el = $('#'+id); if (el) el.addEventListener('input', () => { fn(el); const v = $('#'+id+'-v'); if (v) v.textContent = el.value; }); };
    bind('brush-size', el => V().brush.size = +el.value);
    bind('brush-op',   el => V().brush.opacity = +el.value / 100);
    bind('fill-tol',   el => V().fillTolerance = +el.value);
    bind('wand-tol',   el => { V().wand.tolerance = +el.value; reWand(); });   // live re-select
    const chk = (id, fn) => { const el = $('#'+id); if (el) el.addEventListener('change', () => fn(el.checked)); };
    bind('me-tol',     el => V().wand.tolerance = +el.value);
    chk('brush-pixel', v => V().brush.pixel = v);
    chk('wand-cont',   v => { V().wand.contiguous = v; reWand(); });
    chk('me-cont',     v => V().wand.contiguous = v);
    chk('shp-fill',    v => V().shape.fill = v);
    chk('grad-alpha',  v => V().gradient.toAlpha = v);
    segWire('brush-shape', v => V().brush.shape = v);
    segWire('me-mode', v => V().wand.heal = (v === 'heal'));
    segWire('grad-kind', v => V().gradient.kind = v);
    const gc2 = $('#grad-c2'); if (gc2) gc2.addEventListener('input', () => V().gradient.color2 = gc2.value);
    segWire('sel-shape', v => V().marquee.shape = v);
    segWire('shp-kind',  v => V().shape.kind = v);
    segWire('sel-mode', v => V().selMode = v);
    segWire('wand-sample', v => { V().wand.sample = v; reWand(); });
    chk('wand-aa', v => { V().wand.antialias = v; reWand(); });
    const sm = $('#sel-menu'); if (sm) sm.addEventListener('click', openSelectMenu);
    const gb = $('.guide-btn'); if (gb) gb.addEventListener('click', () => openToolGuide(gb.dataset.guide));
    const fea = $('#sel-feather'); if (fea) fea.addEventListener('click', () => GF.select.has() ? run('featherSelection', { px: 4 }) : U.toast('Make a selection first'));
    const grw = $('#sel-grow'); if (grw) grw.addEventListener('click', () => GF.select.has() ? run('growSelection', { px: 4 }) : U.toast('Make a selection first'));
    // crop
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
      const tab = t.dataset.tab;
      $('#panel').dataset.tab = tab;
      $$('.ptab').forEach(x => { x.classList.toggle('on', x === t); x.setAttribute('aria-selected', x === t ? 'true' : 'false'); });
      $$('.ptab-pane').forEach(p => p.hidden = p.dataset.pane !== tab);
      const tg = $('#panel-toggle span'); if (tg) tg.textContent = t.textContent;
    }));
    $('.ptab').classList.add('on'); // default Adjust
    $('#adj-reset').addEventListener('click', resetAdjust);
    $('#adj-apply').addEventListener('click', applyAdjust);
    $$('[data-mode-open]').forEach(b => b.addEventListener('click', () => openMode(b.dataset.modeOpen)));
  }

  function wireHero() {
    const guard = fn => () => { if (!D.active() || !D.active().canvas) return U.toast('Open an image first'); fn(); };
    $('#hero-enhance').addEventListener('click', guard(() => {
      const L = D.active(); GF.filters.applyToLayer(L, 'enhance', i => { GF.filters.autoLevels(i); GF.filters.hsl(i,0,10,0); });
      GF.view.requestRender(); refreshLayers(); U.toast('Enhanced');
    }));
    $('#hero-removebg').addEventListener('click', guard(() => {
      // auto-upgrade to AI cutout when a remove.bg key is configured; else classic
      if (GF.ai && GF.ai.hasKey() && GF.ai.config().provider === 'removebg') {
        U.toast('Running AI cutout…'); GF.ai.run({}).catch(e => U.toast(e.message)); return;
      }
      busyHero('#hero-removebg', () => run('removeBackground'));
    }));
    $('#hero-erase').addEventListener('click', guard(() => {
      // with a selection: heal it. Without: hand the user the one-click Magic Erase tool.
      if (!GF.select.has || !GF.select.has()) {
        setTool('magicerase'); U.toast('Click the object you want to remove');
        return;
      }
      busyHero('#hero-erase', () => run('contentAwareFill'));
    }));
    $('#hero-genfill').addEventListener('click', guard(openAIDialog));
  }
  function busyHero(sel, fn) {
    const el = $(sel); el.classList.add('busy');
    // defer so the .busy state paints before the (synchronous, heavy) op runs
    setTimeout(() => { try { fn(); } finally { el.classList.remove('busy'); } }, 30);
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
      if (k === 'escape') { if (modalEl) closeModal(); else run('deselect'); return; }
      // a modal is open: don't let document/tool shortcuts fire behind it
      if (modalEl) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (typing) return;
      if ((e.ctrlKey || e.metaKey)) {
        if (k === 'z') { e.preventDefault(); run(e.shiftKey ? 'redo' : 'undo'); return; }
        if (k === 'y') { e.preventDefault(); run('redo'); return; }
        if (k === 's') { e.preventDefault(); GF.exporter.saveProject(); return; }
        if (k === 'e') { e.preventDefault(); openExportDialog(); return; }
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

  function openExportDialog() {
    if (!D.doc.open) return U.toast('Nothing to export yet');
    modal({
      title: 'Export',
      body: `<div class="row"><label>Format<select id="m-fmt"><option value="image/png">PNG</option><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select></label>
             <label>Scale<select id="m-scale"><option value="1">1× (${D.doc.width}×${D.doc.height})</option><option value="2">2×</option><option value="0.5">0.5×</option></select></label></div>`,
      ok: 'Download',
      extra: [['Save project', () => { GF.exporter.saveProject(); closeModal(); }],
              ['Export layers', () => { run('exportLayers', {}); closeModal(); }]],
      onOk: m => {
        const type = m.querySelector('#m-fmt').value, scale = +m.querySelector('#m-scale').value;
        GF.exporter.exportImage({ type, scale, quality: 0.92 });
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
             <label>CORS proxy <span style="color:var(--ink-3)">(if blocked from file://)</span><input id="ai-proxy" placeholder="http://localhost:8787/?url=" value="${cfg.proxy||''}"></label>`,
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

  function openMode(mode) {
    const url = mode === 'sprite' ? 'sprite/index.html' : 'texture/index.html';
    const title = mode === 'sprite' ? '👾 Sprite / Pixel' : '🧱 Game / PBR';
    const ov = $('#mode-overlay');
    ov.innerHTML =
      `<div class="mode-bar">
         <button class="text-btn ghost" id="mode-back">← Back to Image</button>
         <span class="mode-title">${title}</span>
       </div>
       <iframe src="${url}" title="${title}" allow="clipboard-write"></iframe>`;
    ov.hidden = false;
    $('#mode-back').addEventListener('click', () => { ov.hidden = true; ov.innerHTML = ''; });
  }

  /* =================================================================
     Helpers
     ================================================================= */
  function setDims() { const el = $('#doc-dims'); if (el) el.textContent = D.doc.open ? (D.doc.width + '×' + D.doc.height) : ''; }
  function updateUndoRedo() {
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = !GF.history.canUndo();
    if (r) r.disabled = !GF.history.canRedo();
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
  function commandList() {
    const tool = (l, t) => ({ group: 'Tools', label: l, run: () => setTool(t) });
    const cmds = [
      tool('Move', 'move'), tool('Select', 'select'), tool('Magic wand', 'wand'), tool('Crop', 'crop'),
      tool('Magic erase (one-click remove)', 'magicerase'), tool('Clone stamp', 'clone'), tool('Gradient', 'gradient'),
      tool('Brush', 'brush'), tool('Eraser', 'eraser'), tool('Fill', 'fill'), tool('Text', 'text'),
      tool('Shape', 'shape'), tool('Eyedropper', 'eyedropper'),
      { group: 'File', label: 'Open image…', run: pickFile },
      { group: 'File', label: 'New canvas…', run: openNewDialog },
      { group: 'File', label: 'Image size…', run: openImageSize },
      { group: 'File', label: 'Export…', hint: 'Ctrl+E', run: openExportDialog },
      { group: 'File', label: 'Save project', hint: 'Ctrl+S', run: () => GF.exporter.saveProject() },
      { group: 'Edit', label: 'Undo', hint: 'Ctrl+Z', run: () => run('undo') },
      { group: 'Edit', label: 'Redo', hint: 'Ctrl+Y', run: () => run('redo') },
      { group: 'Edit', label: 'Select all', hint: 'Ctrl+A', run: () => run('selectAll') },
      { group: 'Edit', label: 'Deselect', hint: 'Esc', run: () => run('deselect') },
      { group: 'Edit', label: 'Invert selection', hint: 'Ctrl+I', run: () => run('invertSelection') },
      { group: 'Edit', label: 'Paste image', hint: 'Ctrl+V', run: () => U.toast('Press Ctrl/⌘V to paste an image') },
      { group: 'Adjust', label: 'Auto enhance', run: () => $('#hero-enhance').click() },
      { group: 'Adjust', label: 'Curves…', hint: 'Ctrl+M', run: openCurves },
      { group: 'Retouch', label: 'Remove background', run: () => $('#hero-removebg').click() },
      { group: 'Retouch', label: 'Magic erase (content-aware)', run: () => $('#hero-erase').click() },
      { group: 'Retouch', label: 'Generative fill (AI)…', run: openAIDialog },
      { group: 'Retouch', label: 'Content-aware fill', run: () => guarded(() => run('contentAwareFill')) },
      { group: 'Retouch', label: 'Color replace…', run: () => guarded(openColorReplace) },
      { group: 'Retouch', label: 'Smart upscale 2×', run: () => guarded(() => run('smartUpscale', { factor: 2, mode: 'photo' })) },
      { group: 'Retouch', label: 'Ink outline (line art)', run: () => guarded(() => run('inkOutline', {})) },
      { group: 'Retouch', label: 'Clean colors (flatten & sharpen)', run: () => guarded(() => run('cleanColors', {})) },
      { group: 'Layer', label: 'Layer style (outline / glow / shadow)…', run: () => guarded(openLayerStyle) },
      { group: 'File', label: 'Export layers separately', run: () => guarded(() => run('exportLayers', {})) },
      { group: 'Layer', label: 'New layer', run: () => run('addLayer', {}) },
      { group: 'Layer', label: 'Duplicate layer', run: () => run('duplicateLayer') },
      { group: 'Layer', label: 'Merge down', run: () => run('mergeDown') },
      { group: 'Layer', label: 'Flatten image', run: () => run('flatten') },
      { group: 'Layer', label: 'Add mask', run: () => run('addMask', { init: 'reveal' }) },
      { group: 'Transform', label: 'Flip horizontal', run: () => run('flipLayer', { horizontal: true }) },
      { group: 'Transform', label: 'Rotate 90°', run: () => run('rotateLayer', { cw: true }) },
      { group: 'Transform', label: 'Trim to content', run: () => run('trim') },
      { group: 'View', label: 'Zoom in', hint: ']', run: () => zoomBtn(1.25) },
      { group: 'View', label: 'Zoom out', hint: '[', run: () => zoomBtn(0.8) },
      { group: 'View', label: 'Fit to screen', run: () => GF.view.zoomFit() },
      { group: 'View', label: 'Toggle light / dark theme', run: toggleTheme },
      { group: 'Help', label: 'Keyboard shortcuts', hint: '?', run: openCheatSheet },
      { group: 'Modes', label: 'Sprite / Pixel mode', run: () => openMode('sprite') },
      { group: 'Modes', label: 'Game / PBR mode', run: () => openMode('texture') },
    ];
    ADJ_LAYER_TYPES.forEach(t => cmds.push({ group: 'Adjustment', label: 'Add ' + t.label + ' layer', run: () => addAdjustmentLayer(t.kind) }));
    FILTERS.forEach(f => cmds.push({ group: 'Filters', label: 'Filter: ' + f.name, run: () => guarded(() => { GF.filters.applyToLayer(D.active(), f.name, f.fn); GF.view.requestRender(); refreshLayers(); U.toast(f.name); }) }));
    if (GF.texture) {
      const map = { 'Normal map': makeNormalMap, 'Seamless tile': makeSeamless, 'PBR material': () => run('materialWizard', { tileable: true }), 'Retro dither': retroDither };
      Object.keys(map).forEach(l => cmds.push({ group: 'Texture', label: l, run: () => guarded(map[l]) }));
    }
    return cmds;
  }
  function guarded(fn) { if (!D.active() || !D.active().canvas) return U.toast('Open an image first'); fn(); }
  function fuzzyScore(q, s) {
    if (!q) return 0; q = q.toLowerCase(); s = s.toLowerCase();
    let i = 0, score = 0, last = -1;
    for (let j = 0; j < s.length && i < q.length; j++) if (s[j] === q[i]) { score += (j - last); last = j; i++; }
    return i === q.length ? score : -1;
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
      ['Command palette', '⌘/Ctrl K'], ['Tools', 'V M W C B E G T U I'], ['Pan', 'Space / H'],
      ['Undo / Redo', '⌘Z / ⌘⇧Z'], ['Save project', '⌘S'], ['Export', '⌘E'],
      ['Select all / Invert', '⌘A / ⌘I'], ['Deselect', 'Esc'], ['Paste image', '⌘V'],
      ['Zoom out / in', '[ / ]'], ['Fit to screen', 'click %'], ['Shortcuts', '?'],
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
    { kind: 'posterize', label: 'Posterize' },
    { kind: 'grayscale', label: 'Black & White' },
    { kind: 'invert', label: 'Invert' },
    { kind: 'autoLevels', label: 'Auto Levels' },
  ];
  const ADJ_EDITABLE = ['brightnessContrast', 'hsl', 'posterize', 'levels', 'curves'];
  function adjustDefaults(kind) {
    return ({ brightnessContrast: { brightness: 0, contrast: 0 }, hsl: { h: 0, s: 0, l: 0 },
      posterize: { levels: 5 }, levels: { black: 0, white: 255, gamma: 1 }, curves: { curves: {} } })[kind] || {};
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
    else if (kind === 'posterize') body = adjModalSlider('Levels', 'levels', p.levels || 5, 2, 16);
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
    else U.toast('Install isn’t available here (already installed, or open over http to enable)');
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
    V().wand.heal = true;   // Magic Erase defaults to Heal (photo-first); the optbar can switch to Erase
    GF.select.onChange(updateSelBar); updateSelBar();
    $('#btn-palette') && $('#btn-palette').addEventListener('click', openPalette);
    $('#btn-theme') && $('#btn-theme').addEventListener('click', toggleTheme);
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); openPalette(); return; }
      if (paletteEl) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (!typing && !modalEl && e.key === '?') { e.preventDefault(); openCheatSheet(); }
    });
    checkRestore();
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

  function openSelectMenu() {
    if (!D.doc.open) return U.toast('Open an image first');
    const has = GF.select.has();
    const ops = [
      ['Grow 4px', () => GF.select.grow(4), has],
      ['Contract 4px', () => GF.select.contract(4), has],
      ['Feather 3px', () => GF.select.feather(3), has],
      ['Smooth', () => GF.select.smooth(2), has],
      ['Select similar', () => U.toast('Shift-click the wand to add similar areas, or use Color range'), true],
      ['Color range…', openColorRange, true],
      ['Select subject', () => { GF.select.selectBackground(composImg(), 32); GF.select.invert(); }, true],
      ['Invert (⌘I)', () => GF.select.invert(), has],
      ['Select all (⌘A)', () => GF.select.selectAll(), true],
      ['Deselect (Esc)', () => GF.select.clear(), has],
    ];
    modal({
      title: 'Select', sub: 'Refine or build a selection',
      body: `<div class="pro-grid">${ops.map((o, i) => `<button class="pro-btn${o[2] ? '' : ' dis'}" data-i="${i}">${o[0]}</button>`).join('')}</div>`,
      ok: 'Close', noCancel: true,
      mount: m => m.querySelectorAll('[data-i]').forEach(b => b.addEventListener('click', () => { const o = ops[+b.dataset.i]; if (!o[2]) return; closeModal(); o[1](); GF.view.requestRender(); }))
    });
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

  /* =================================================================
     Selection outcome bar — intent-first "what now?" for any selection.
     A selection is a means, not an end: the moment you make one (Magic
     Wand especially) we float the concrete OUTCOMES right at it, each a
     one-click, already-implemented action. This is what turns the wand
     from "marching ants, now what?" into the most obvious tool in the app.
     ================================================================= */
  let selBarEl = null, selBounds = null, _vsig = '';

  function fillSelection() {
    const L = D.active(); if (!L || !L.canvas) return U.toast('Pick a pixel layer');
    GF.history.push(D.doc, 'fill selection');
    const t = U.makeCanvas(D.doc.width, D.doc.height), tc = U.ctx2d(t);
    tc.fillStyle = V().brush.color; tc.fillRect(0, 0, t.width, t.height);
    tc.globalCompositeOperation = 'destination-in'; tc.drawImage(GF.select.maskCanvas(), 0, 0);
    U.ctx2d(L.canvas).drawImage(t, -(L.x || 0), -(L.y || 0));
    GF.view.requestRender(); refreshLayers(); U.toast('Filled selection');
  }
  function deleteSelection() {
    const L = D.active(); if (!L || !L.canvas) return U.toast('Pick a pixel layer');
    GF.retouch.eraseSelection(L, true); GF.view.requestRender(); refreshLayers(); U.toast('Deleted');
  }
  function cutOut() {
    if (!GF.select.has()) return;
    run('addMask', { init: 'selection' });   // non-destructive: hide everything outside the selection
    GF.select.clear(); GF.view.requestRender(); refreshLayers();
    U.toast('Cut out — the rest is hidden (edit the mask to refine)');
  }

  /* The 5 headline outcomes — icon, verb-first label, and a plain-language
     "what this does" line so the tool teaches itself. */
  const SEL_OUTCOMES = [
    { ic: '🩹', label: 'Erase & heal',  desc: 'Remove it, rebuild the background', fn: () => run('contentAwareFill') },
    { ic: '✂️', label: 'Cut out',       desc: 'Keep only this, hide the rest',     fn: cutOut },
    { ic: '🎨', label: 'Recolor',       desc: 'Shift this area’s colour',          fn: () => addAdjustmentLayer('hsl') },
    { ic: '✦', label: 'Replace (AI)',  desc: 'Generate something new here',       fn: openAIDialog, ai: true },
    { ic: '🪣', label: 'Fill',          desc: 'Flat-fill with your colour',        fn: fillSelection },
  ];
  /* Secondary refine/utility actions, tucked under "More". */
  const SEL_MORE = [
    ['⧉ Copy to layer', () => run('layerViaCopy')],
    ['⌗ Crop to this',  () => cropToSelection()],
    ['⇄ Invert',        () => { GF.select.invert(); GF.view.requestRender(); }],
    ['◌ Grow 4px',      () => { GF.select.grow(4); GF.view.requestRender(); }],
    ['◠ Feather 4px',   () => { GF.select.feather(4); GF.view.requestRender(); }],
    ['🗑 Delete',        deleteSelection],
  ];

  function ensureSelBar() {
    if (selBarEl) return selBarEl;
    const bar = document.createElement('div'); bar.id = 'sel-bar'; bar.hidden = true;
    const outs = SEL_OUTCOMES.map((o, i) =>
      `<button class="sel-out${o.ai ? ' ai' : ''}" data-i="${i}" title="${o.desc}">
         <span class="so-ic">${o.ic}</span>
         <span class="so-tx"><b>${o.label}</b><small>${o.desc}</small></span>
       </button>`).join('');
    const more = SEL_MORE.map((a, i) => `<button data-m="${i}">${a[0]}</button>`).join('');
    bar.innerHTML =
      `<div class="sel-head">
         <span class="sel-count"></span>
         <button class="sel-more-btn" type="button">More ▾</button>
         <button class="sel-x" type="button" title="Deselect (Esc)">✕</button>
       </div>
       <div class="sel-outs">${outs}</div>
       <div class="sel-more" hidden>${more}</div>`;
    $('#viewport').appendChild(bar);
    const act = fn => { if (!D.doc.open) return U.toast('Open an image first'); fn(); updateSelBar(); };
    bar.querySelectorAll('.sel-out').forEach(b => b.addEventListener('click', () => act(SEL_OUTCOMES[+b.dataset.i].fn)));
    bar.querySelectorAll('[data-m]').forEach(b => b.addEventListener('click', () => act(SEL_MORE[+b.dataset.m][1])));
    bar.querySelector('.sel-x').addEventListener('click', () => { GF.select.clear(); GF.view.requestRender(); });
    bar.querySelector('.sel-more-btn').addEventListener('click', () => {
      const m = bar.querySelector('.sel-more'); m.hidden = !m.hidden;
      bar.querySelector('.sel-more-btn').textContent = m.hidden ? 'More ▾' : 'Less ▴';
      positionSelBar(true);
    });
    // keep the bar pinned to the selection as the canvas pans / zooms
    const vp = $('#viewport');
    ['wheel', 'pointermove', 'pointerup'].forEach(ev => vp.addEventListener(ev, () => positionSelBar(), { passive: true }));
    window.addEventListener('resize', () => positionSelBar(true));
    selBarEl = bar; return bar;
  }

  /* On desktop, float the bar just above the selection (fall back to below,
     then clamp into the viewport). On mobile it stays docked at the bottom. */
  function positionSelBar(force) {
    const bar = selBarEl; if (!bar || bar.hidden) return;
    if (!matchMedia('(min-width: 881px)').matches) { bar.classList.remove('floating'); bar.style.left = ''; bar.style.top = ''; _vsig = ''; return; }
    const v = V(); if (!v || !selBounds) return;
    const sig = Math.round(v.zoom * 1000) + '|' + Math.round(v.panX) + '|' + Math.round(v.panY);
    if (sig === _vsig && !force) return;    // nothing moved — skip the layout read
    _vsig = sig;
    bar.classList.add('floating');
    const bw = bar.offsetWidth, bh = bar.offsetHeight;
    const vpr = $('#viewport').getBoundingClientRect();
    const cx = v.panX + (selBounds.x + selBounds.w / 2) * v.zoom;
    let top = v.panY + selBounds.y * v.zoom - bh - 14;                 // above
    if (top < 8) top = v.panY + (selBounds.y + selBounds.h) * v.zoom + 14;  // else below
    const left = U.clamp(cx, bw / 2 + 8, vpr.width - bw / 2 - 8);
    top = U.clamp(top, 8, vpr.height - bh - 8);
    bar.style.left = left + 'px'; bar.style.top = top + 'px';
  }

  function updateSelBar() {
    const bar = ensureSelBar();
    const n = GF.select && GF.select.has && GF.select.has() ? GF.select.count() : 0;
    bar.hidden = n === 0;
    if (!n) { selBounds = null; bar.querySelector('.sel-more').hidden = true; bar.querySelector('.sel-more-btn').textContent = 'More ▾'; return; }
    selBounds = GF.select.bounds();
    bar.querySelector('.sel-count').textContent = n.toLocaleString() + ' px selected';
    requestAnimationFrame(() => positionSelBar(true));
  }

  /* crop helpers (shared by the crop tool and "crop to selection") */
  function cropDocTo(x, y, w, h) {
    if (w < 1 || h < 1) return;
    GF.history.push(D.doc, 'crop');
    for (const L of D.doc.layers) {
      if (!L.canvas) continue;
      const c = U.makeCanvas(w, h); U.ctx2d(c).drawImage(L.canvas, (L.x || 0) - x, (L.y || 0) - y);
      L.canvas = c; L.x = 0; L.y = 0;
      if (L.mask) { const m = U.makeCanvas(w, h); U.ctx2d(m).drawImage(L.mask, -x, -y); L.mask = m; }
    }
    D.doc.width = w; D.doc.height = h;
    GF.select.clear(); GF.view.zoomFit(); refreshLayers(); setDims();
  }
  function cropToSelection() {
    const b = GF.select.bounds(); if (!b) return U.toast('Nothing selected');
    cropDocTo(b.x, b.y, b.w, b.h); U.toast('Cropped to selection ' + b.w + '×' + b.h);
  }

  /* =================================================================
     Tool guides — what each tool does + expansive pro uses
     ================================================================= */
  const GUIDES = {
    wand: { icon: '✨', title: 'Magic Wand — the selection powerhouse',
      body: `<p class="g-lead">Click to select a region of similar colour. Everything you do next — fill, cut, mask, adjust, erase — can be confined to that selection. This is the heart of high-end editing.</p>
        <h4>Options</h4><ul>
          <li><b>Tolerance</b> — how close in colour a pixel must be to get selected. Low = picky, high = grabs more.</li>
          <li><b>Contiguous</b> — on: only the connected blob you clicked. Off: every matching pixel in the image.</li>
          <li><b>Sample</b> — <b>All layers</b> reads the blended image; <b>Layer</b> reads only the active layer's own pixels.</li>
          <li><b>Anti-alias</b> — softens the selection edge by 1px for clean composites.</li>
          <li><b>Mode</b> — New / Add / Subtract / Intersect. Hold <span class="kbd">⇧</span> to add, <span class="kbd">⌥</span> to subtract, <span class="kbd">⇧⌥</span> to intersect — without changing the button.</li>
        </ul>
        <h4>What to do next</h4>
        <p class="g-lead">After you click, a bar appears at the selection with one-tap outcomes — no need to remember menus:</p>
        <ul>
          <li><b>🩹 Erase &amp; heal</b> — remove the object and rebuild the background behind it.</li>
          <li><b>✂️ Cut out</b> — keep only the selection; everything else is hidden (non-destructive).</li>
          <li><b>🎨 Recolor</b> — a Hue/Saturation adjustment clipped to the selection, so only it changes.</li>
          <li><b>✦ Replace (AI)</b> — generative-fill the region with something new.</li>
          <li><b>🪣 Fill</b> — flat-fill with your current colour.</li>
          <li><b>More ▾</b> — Copy to layer, Crop to this, Invert, Grow, Feather, Delete.</li>
        </ul>
        <p class="g-lead">Tip: to cut out a subject on a plain background, wand the <i>background</i>, hit <b>⇄ Invert</b>, then <b>✂️ Cut out</b>. Any filter or adjustment you apply also respects the selection.</p>` },
    select: { icon: '⬚', title: 'Marquee Select — rectangles, ellipses & lasso',
      body: `<p class="g-lead">Drag to select a precise shape. Combine with the Magic Wand using the same Add/Subtract/Intersect modes.</p>
        <h4>Options</h4><ul><li><b>Shape</b> — Rect, Ellipse, or freehand Lasso.</li>
          <li><b>Mode</b> — New / Add / Subtract / Intersect (or <span class="kbd">⇧</span>/<span class="kbd">⌥</span>).</li>
          <li><b>Feather / Grow</b> — soften or expand the edge.</li></ul>
        <h4>Uses</h4><ul><li>Constrain any tool or filter to the marquee.</li><li><b>⌗ Crop</b> to the selection.</li><li><b>◫ Mask</b> a layer to the shape.</li></ul>` },
    brush: { icon: '🖌', title: 'Brush', body: `<p class="g-lead">Paint with the current colour. Size, Opacity and a crisp Pixel mode in the options bar. Strokes respect the active selection — paint inside a marquee and nothing spills out.</p>` },
    eraser: { icon: '🩹', title: 'Eraser', body: `<p class="g-lead">Erase to transparency. Respects the active selection. For removing objects cleanly, prefer <b>Magic erase</b> (content-aware) over manual erasing.</p>` },
    fill: { icon: '🪣', title: 'Fill', body: `<p class="g-lead">Flood-fill connected pixels within Tolerance with the current colour. Inside a selection, the fill is clipped to it.</p>` },
    crop: { icon: '⌗', title: 'Crop & Straighten', body: `<p class="g-lead">Drag the handles, pick an aspect preset, and use the rule-of-thirds grid to compose. The Straighten slider rotates and auto-expands the canvas. You can also select a region and use <b>Crop to selection</b>.</p>` },
    text: { icon: 'T', title: 'Text', body: `<p class="g-lead">Click to place text. Pick a font, size, colour and outline. Text stays <b>re-editable</b> — double-click a text layer to change the words or style any time.</p>` },
    move: { icon: '✛', title: 'Move', body: `<p class="g-lead">Drag to reposition the active layer. Content moved off-canvas is never lost.</p>` },
    shape: { icon: '▭', title: 'Shape', body: `<p class="g-lead">Drag to draw a rectangle, ellipse or line. Hold <span class="kbd">⇧</span> for a perfect square/circle.</p>` },
    eyedropper: { icon: '⊙', title: 'Eyedropper', body: `<p class="g-lead">Click to sample a colour from the image into your brush colour.</p>` },
    magicerase: { icon: '🩹', title: 'Magic Erase — one-click object removal',
      body: `<p class="g-lead">Click an object or colour region and it's gone — in one step.</p>
        <h4>Options</h4><ul>
          <li><b>Heal (rebuild)</b> — fills the hole with matching texture from around it. Best for photos.</li>
          <li><b>Erase (transparent)</b> — punches through to transparency. Best for cutouts and graphics.</li>
          <li><b>Tolerance</b> — how much of the surrounding colour gets included per click.</li>
        </ul>
        <p class="g-lead">Tip: several small clicks beat one big one. For precise control, use the <b>Wand</b> instead — select first, review, then choose an action.</p>` },
    clone: { icon: '⌖', title: 'Clone Stamp — paint with another part of the image',
      body: `<p class="g-lead"><span class="kbd">Alt</span>-click (or <span class="kbd">Ctrl</span>-click) the spot you want to copy <i>from</i>, then paint where you want it to appear. A crosshair shows your source as you go.</p>
        <h4>Uses</h4><ul>
          <li><b>Remove blemishes &amp; wires</b> — clone clean texture over them.</li>
          <li><b>Duplicate details</b> — more leaves, more windows, more crowd.</li>
          <li><b>Fix seams</b> — after Magic Erase, clone over any repeats it left.</li>
        </ul>` },
    gradient: { icon: '◧', title: 'Gradient — smooth colour blends',
      body: `<p class="g-lead">Drag across the canvas: the blend runs from your brush colour at the start of the drag to the end colour (or to transparent). Inside a selection, it fills only the selection.</p>
        <h4>Uses</h4><ul>
          <li><b>Sky wash</b> — select the sky, drag a blue→transparent gradient.</li>
          <li><b>Vignette / fade</b> — radial, dark colour, fade to transparent, low layer opacity.</li>
          <li><b>Text backdrops</b> — dark→transparent band behind captions.</li>
        </ul>` },
  };
  let curTool = 'brush';
  function openToolGuide(name) {
    const g = GUIDES[name] || GUIDES[curTool]; if (!g) return;
    modal({ title: g.icon + '  ' + g.title, body: `<div class="tool-guide">${g.body}</div>`, ok: 'Got it', noCancel: true });
  }

  /* =================================================================
     Boot
     ================================================================= */
  function boot() {
    GF.view.init();
    GF.ui.init();
    $('#empty-state').hidden = false;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
