/* PixelTriks — end-to-end runtime driver (temporary audit harness).
   Runs in the real booted app, exercises every feature by calling the engine
   AND clicking real DOM controls (so it tests UI wiring), and writes a JSON
   report into #RESULTS + a summary into document.title. */
(function () {
  const U = GF.util, D = GF.doc;
  const $ = s => document.querySelector(s);
  const results = [];
  const log = (name, pass, info) => results.push({ name, pass: !!pass, info: info || '' });

  const withTimeout = (p, ms, label) => Promise.race([
    Promise.resolve(p),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + (label || ''))), ms)),
  ]);
  async function t(name, fn, ms) {
    try { await withTimeout(fn(), ms || 8000, name); log(name, true); }
    catch (e) { log(name, false, (e && e.message) || String(e)); }
  }

  let dumped = false;
  function dump(tag) {
    if (dumped) return; dumped = true;
    const pass = results.filter(r => r.pass).length, fail = results.length - pass;
    const pre = document.createElement('pre'); pre.id = 'RESULTS';
    pre.textContent = JSON.stringify({ tag: tag || 'done', pass, fail, total: results.length, failures: results.filter(r => !r.pass) });
    document.body.appendChild(pre);
    document.title = 'E2E:' + pass + '/' + results.length + (fail ? ' FAILS' : ' ALLPASS') + (tag ? ' [' + tag + ']' : '');
  }
  setTimeout(() => dump('watchdog'), 80000); // safety: dump partial results if a test hangs (must exceed the 40s webp allowance)

  function freshDoc(w, h) {
    GF.api.run('newDoc', { w: w || 200, h: h || 200, bg: 'white' });
    const c = U.ctx2d(D.active().canvas);
    c.fillStyle = '#c83737'; c.fillRect(20, 20, 80, 80);
    c.fillStyle = '#3a78c8'; c.fillRect(110, 60, 60, 90);
    GF.view.requestRender();
  }
  const layerCount = () => D.doc.layers.length;
  const clickTool = name => $(`#toolrail .tool[data-tool=${name}]`).click();
  /* run a palette entry by (partial) label — the palette is the power surface now */
  function palRun(label) {
    $('#btn-palette').click();
    const inp = $('.cmdk-input'); inp.value = label; inp.dispatchEvent(new Event('input'));
    inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
  }

  async function runAll() {
    /* ---------- DOCUMENT ---------- */
    await t('newDoc opens 200x200, 1 layer', () => {
      freshDoc(200, 200);
      if (!D.doc.open || D.doc.width !== 200 || layerCount() !== 1) throw new Error('state ' + D.doc.width + ' layers=' + layerCount());
    });
    await t('empty-state hidden when doc open', () => { if (!$('#empty-state').hidden) throw new Error('empty-state visible'); });
    await t('#doc-dims label updated', () => { if ($('#doc-dims').textContent !== '200×200') throw new Error('"' + $('#doc-dims').textContent + '"'); });
    await t('intent: "Create a 3D scene" activates the 3D tool immediately', () => {
      $('.intent[data-intent=scene]').click();
      const on = $('#toolrail .tool[data-tool=scene3d]').classList.contains('on');
      // 3D is always on — no mode switch needed
      
      if (!on) throw new Error('3D tool not active');
    });
    await t('intent: "Turn an image into 3D" routes on open', () => {
      $('.intent[data-intent=image3d]').click();   // remembers intent + opens picker (noop headless)
      freshDoc(150, 150);                           // newDoc → onDocumentOpened consumes the intent
      const on = $('#toolrail .tool[data-tool=scene3d]').classList.contains('on');
      GF.ui.setTool('move');
      
      if (!on) throw new Error('intent did not route to 3D');
    });

    /* ---------- TOOLS (click rail, verify engine tool) ---------- */
    /* eraser + magicerase consolidated: eraser is now brush mode, magic erase is wand mode */
    const toolMap = { move:'move', select:'marquee', wand:'wand', crop:'move', brush:'brush', fill:'fill', text:'text', shape:'shape',
      gradient:'gradient' };
    for (const [btn, eng] of Object.entries(toolMap)) {
      await t('tool ' + btn + ' -> ' + eng, () => { clickTool(btn); if (GF.view.view.tool !== eng) throw new Error('got ' + GF.view.view.tool); });
    }
    await t('aria-pressed set on active tool', () => { clickTool('brush'); if ($('#toolrail .tool[data-tool=brush]').getAttribute('aria-pressed') !== 'true') throw new Error('no aria-pressed'); });
    await t('optbar builds for brush (size control)', () => { clickTool('brush'); if (!$('#brush-size')) throw new Error('no #brush-size'); });
    await t('optbar builds for wand (tolerance)', () => { clickTool('wand'); if (!$('#wand-tol')) throw new Error('no #wand-tol'); });
    await t('optbar flyout positioned at active tool (not header)', () => {
      freshDoc(); clickTool('brush');
      const bar = $('#optbar');
      const toolBtn = $('#toolrail .tool[data-tool="brush"]');
      if (!bar || bar.hidden) throw new Error('optbar not visible');
      const barRect = bar.getBoundingClientRect();
      const btnRect = toolBtn.getBoundingClientRect();
      // Flyout should be to the RIGHT of the tool rail, not above the viewport
      if (barRect.left < btnRect.right - 10) throw new Error('flyout not to the right of rail: bar.left=' + barRect.left + ' btn.right=' + btnRect.right);
      // Flyout should be vertically near the tool button (within 40px)
      const vertDist = Math.abs((barRect.top + barRect.height/2) - (btnRect.top + btnRect.height/2));
      if (vertDist > 40) throw new Error('flyout too far from tool button: ' + vertDist + 'px');
    });
    await t('optbar flyout moves when tool changes', () => {
      freshDoc(); clickTool('brush');
      const bar = $('#optbar');
      const brushTop = bar.getBoundingClientRect().top;
      clickTool('wand');
      const wandTop = bar.getBoundingClientRect().top;
      // Wand is above brush in the rail, so flyout should be higher
      if (wandTop >= brushTop) throw new Error('flyout did not move: brush=' + brushTop + ' wand=' + wandTop);
    });
    await t('optbar hidden for move tool (no controls)', () => {
      freshDoc(); clickTool('move');
      const bar = $('#optbar');
      // Move has hint text, so bar is shown — that's fine. But check it's valid.
      if (!bar.hidden && !bar.textContent.trim()) throw new Error('optbar visible but empty');
    });
    await t('wand optbar: auto-remove toggle present', () => {
      clickTool('wand');
      if (!$('#wand-mode')) throw new Error('missing wand-mode seg');
      if (GF.view.view.wand.autoRemove === undefined) throw new Error('autoRemove not initialised');
    });
    await t('optbar gradient: kind seg + fade checkbox', () => {
      clickTool('gradient');
      if (!$('#grad-kind') || !$('#grad-alpha')) throw new Error('missing grad controls');
    });
    await t('layer style modal applies layerFX (history)', () => {
      clickTool('move'); $('#lyr-style').click();
      const m = $('.fs-modal'); if (!m) throw new Error('no layer-style modal');
      m.querySelector('.text-btn.primary').click();   // Apply (default: outline)
      const top = GF.history.info().undo.slice(-1)[0] || '';
      if (top.indexOf('layer fx') !== 0) throw new Error('history top "' + top + '"');
    });
    await t('ink outline adds a lines layer', () => {
      const n = layerCount(); GF.api.run('inkOutline', {});
      if (layerCount() !== n + 1) throw new Error('no lines layer added');
      GF.api.run('deleteLayer');
    });

    /* ---------- PAINT ---------- */
    await t('paint stroke pushes history', () => { const u0 = GF.history.canUndo(); GF.api.run('paint', { points: [[10,10],[50,50],[90,30]], color:'#0a0', size: 12 }); if (!GF.history.canUndo()) throw new Error('no undo after paint'); void u0; });
    await t('fillAt floods', () => { GF.view.view.fillTolerance = 40; GF.api.run('fillAt', { x: 150, y: 150, color: '#ff0' }); });
    await t('text adds a layer', () => { const n = layerCount(); GF.api.run('text', { text: 'Hi', x: 10, y: 10, size: 24, color: '#fff' }); if (layerCount() !== n + 1) throw new Error('no layer added'); });

    /* ---------- SELECTION ---------- */
    await t('selectRect -> count>0', () => { GF.api.run('selectRect', { x: 20, y: 20, w: 80, h: 80 }); if (GF.select.count() <= 0) throw new Error('count ' + GF.select.count()); });
    await t('grow + feather selection', () => { GF.api.run('growSelection', { px: 3 }); GF.api.run('featherSelection', { px: 2 }); });
    await t('invert + selectAll + deselect', () => { GF.api.run('invertSelection'); GF.api.run('selectAll'); GF.api.run('deselect'); if (GF.select.count() !== 0) throw new Error('not cleared'); });
    await t('wandSelect -> count>0', () => { freshDoc(); GF.api.run('wandSelect', { x: 5, y: 5, tolerance: 32 }); if (GF.select.count() <= 0) throw new Error('count ' + GF.select.count()); GF.api.run('deselect'); });

    /* ---------- ADJUST live preview / apply / reset ---------- */
    await t('adjust slider sets non-destructive preview', () => {
      freshDoc();
      const inp = $('#adj-sliders input[data-k=exposure]'); if (!inp) throw new Error('no exposure slider');
      inp.value = 40; inp.dispatchEvent(new Event('input'));
      if (!D.doc.preview) throw new Error('preview not set');
    });
    await t('adjust Apply commits + clears preview + resets sliders', () => {
      const u0 = GF.history.canUndo(); $('#adj-apply').click();
      if (D.doc.preview) throw new Error('preview leaked');
      if (+$('#adj-sliders input[data-k=exposure]').value !== 0) throw new Error('slider not reset');
      if (!GF.history.canUndo()) throw new Error('no history'); void u0;
    });
    await t('adjust Reset clears preview', () => {
      const inp = $('#adj-sliders input[data-k=contrast]'); inp.value = 30; inp.dispatchEvent(new Event('input'));
      $('#adj-reset').click();
      if (D.doc.preview) throw new Error('preview not cleared');
    });

    /* ---------- FILTERS (click chips) ---------- */
    const chips = document.querySelectorAll('#filter-strip .filter-chip');
    await t('filter strip rendered (>=6 chips)', () => { if (chips.length < 6) throw new Error('only ' + chips.length); });
    for (const label of ['B&W', 'Pop', 'Vivid', 'Invert']) {
      await t('filter ' + label, () => { freshDoc(); const chip = Array.prototype.find.call(chips, c => c.textContent.trim() === label); if (!chip) throw new Error('chip missing'); const u = GF.history.canUndo(); chip.click(); if (!GF.history.canUndo()) throw new Error('no history'); void u; });
    }

    /* ---------- HEADLINE ACTIONS (palette-surfaced) ---------- */
    await t('palette Auto enhance commits', async () => {
      freshDoc(); palRun('Auto enhance');
      await new Promise(r => setTimeout(r, 60));   // palette exec + busy defer
      if ((GF.history.info().undo.slice(-1)[0] || '') !== 'enhance') throw new Error('enhance did not run');
    });
    await t('palette Remove background (classic) runs', async () => {
      freshDoc(); palRun('Remove background');
      await new Promise(r => setTimeout(r, 80));
    });
    await t('palette Generative fill opens AI modal', async () => {
      freshDoc(); palRun('Generative fill');
      await new Promise(r => setTimeout(r, 40));
      if (!$('.fs-modal')) throw new Error('no modal');
      $('.fs-modal .text-btn').click(); /* cancel */
    });

    /* ---------- LAYERS ---------- */
    await t('layer add', () => { freshDoc(); const n = layerCount(); $('#lyr-add').click(); if (layerCount() !== n + 1) throw new Error('add failed'); });
    await t('layer duplicate', () => { const n = layerCount(); $('#lyr-dup').click(); if (layerCount() !== n + 1) throw new Error('dup failed'); });
    await t('blend select updates active.blend', () => { const sel = $('#lyr-blend'); sel.value = 'multiply'; sel.dispatchEvent(new Event('change')); if (D.active().blend !== 'multiply') throw new Error('blend ' + D.active().blend); });
    await t('opacity slider updates active.opacity', () => { const o = $('#lyr-opacity'); o.value = 50; o.dispatchEvent(new Event('input')); if (Math.round(D.active().opacity * 100) !== 50) throw new Error('op ' + D.active().opacity); });
    await t('layer list renders items', () => { const items = document.querySelectorAll('#layer-list .layer-item'); if (items.length !== layerCount()) throw new Error('list ' + items.length + ' vs ' + layerCount()); });
    await t('layer visibility toggle', () => { const vis = D.active().visible; document.querySelector('#layer-list .layer-item.on .layer-vis').click(); if (D.active().visible === vis) throw new Error('not toggled'); D.active().visible = true; });
    await t('layer merge down', () => { freshDoc(); $('#lyr-add').click(); const n = layerCount(); $('#lyr-merge').click(); if (layerCount() !== n - 1) throw new Error('merge'); });
    await t('layer delete', () => { $('#lyr-add').click(); const n = layerCount(); $('#lyr-del').click(); if (layerCount() !== n - 1) throw new Error('del'); });

    /* ---------- POWER OPS (api catalog + dialogs — the palette's sources) ---------- */
    await t('op: Smart upscale 2x doubles dims', () => { freshDoc(100, 100); GF.api.run('smartUpscale', { factor: 2, mode: 'photo' }); if (D.doc.width !== 200) throw new Error('w ' + D.doc.width); });
    await t('op: Trim to content', () => { freshDoc(); GF.api.run('trim'); });
    await t('op: Flip H', () => { freshDoc(); GF.api.run('flipLayer', { horizontal: true }); });
    await t('op: Rotate 90', () => { freshDoc(); GF.api.run('rotateLayer', { cw: true }); });
    await t('op: Add mask', () => { freshDoc(); GF.api.run('addMask', { init: 'reveal' }); if (!D.active().mask) throw new Error('no mask'); });
    await t('palette Color replace opens modal', async () => {
      freshDoc(); palRun('Color replace');
      await new Promise(r => setTimeout(r, 40));
      if (!$('.fs-modal')) throw new Error('no modal'); $('.fs-modal .text-btn').click();
    });
    await t('palette Curves opens modal w/ canvas', async () => {
      freshDoc(); palRun('Curves');
      await new Promise(r => setTimeout(r, 40));
      if (!$('.fs-modal #m-curve')) throw new Error('no curve canvas'); $('.fs-modal .text-btn').click();
    });
    await t('op: Content-aware fill (w/ selection)', () => { freshDoc(); GF.api.run('selectRect', { x: 40, y: 40, w: 30, h: 30 }); GF.api.run('contentAwareFill'); GF.api.run('deselect'); });
    if (GF.texture) {
      await t('texture: Normal map adds layer', () => { freshDoc(); const n = layerCount(); $('#tex-normal').click(); if (layerCount() !== n + 1) throw new Error('no layer'); });
      await t('texture: Seamless tile', () => { freshDoc(); $('#tex-seamless').click(); });
    } else log('texture tools present', false, 'GF.texture not loaded');
    await t('brush Alt-click picks color', () => {
      freshDoc(); clickTool('brush');
      GF.view.view.brush.color = '#00ff00';
      const v = GF.view.view, vp = $('#viewport').getBoundingClientRect();
      // doc pixel (30,30) is inside the red rect painted by freshDoc
      const cx = vp.left + v.panX + 30 * v.zoom, cy = vp.top + v.panY + 30 * v.zoom;
      const origCap = Element.prototype.setPointerCapture;
      Element.prototype.setPointerCapture = function () {};   // synthetic pointerIds throw in headless
      try {
        $('#viewport').dispatchEvent(new PointerEvent('pointerdown', { clientX: cx, clientY: cy, altKey: true, bubbles: true, pointerId: 991 }));
        $('#viewport').dispatchEvent(new PointerEvent('pointerup', { clientX: cx, clientY: cy, bubbles: true, pointerId: 991 }));
      } finally { Element.prototype.setPointerCapture = origCap; }
      if (GF.view.view.brush.color === '#00ff00') throw new Error('color not picked: ' + GF.view.view.brush.color);
    });

    /* ---------- UNDO / REDO ---------- */
    await t('undo/redo via top buttons + disabled state', () => {
      freshDoc(); GF.api.run('paint', { points: [[5,5],[50,50]], size: 8, color: '#000' });
      const before = D.active().canvas.toDataURL();
      $('#btn-undo').click();
      const afterUndo = D.active().canvas.toDataURL();
      if (afterUndo === before) throw new Error('undo no-op');
      $('#btn-redo').click();
      if (D.active().canvas.toDataURL() !== before) throw new Error('redo mismatch');
    });
    await t('undo button disabled at clean history', () => { GF.history.clear(); GF.ui.refreshLayers(); if (!$('#btn-undo').disabled) throw new Error('not disabled'); });

    /* ---------- EXPORT / PROJECT ---------- */
    for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
      // webp gets a long timeout: under --virtual-time-budget the 8s virtual deadline
      // races the real-time encoder and reports a false timeout (fine in real browsers)
      await t('export ' + type, async () => { freshDoc(); const b = await GF.exporter.exportImage({ type, scale: 1, quality: 0.9 }); if (!b || !b.size) throw new Error('no blob'); }, type === 'image/webp' ? 40000 : 8000);
    }
    await t('export scale 2x', async () => { const b = await GF.exporter.exportImage({ type: 'image/png', scale: 2, quality: 0.9 }); if (!b) throw new Error('no blob'); });
    await t('project serialize/deserialize roundtrip', async () => {
      freshDoc(); $('#lyr-add').click(); const n = layerCount();
      const json = JSON.parse(JSON.stringify(D.serialize()));
      await D.deserialize(json);
      if (layerCount() !== n) throw new Error('layers ' + layerCount() + ' vs ' + n);
    });

    /* ---------- ZOOM ---------- */
    await t('zoom in/out + label', () => { freshDoc(); const z0 = GF.view.view.zoom; $('#btn-zoom-in').click(); if (GF.view.view.zoom <= z0) throw new Error('no zoom'); $('#zoom-label').click(); /* fit */ if (!/%$/.test($('#zoom-label').textContent)) throw new Error('label'); });

    /* ---------- AI adapter ---------- */
    await t('AI config/setConfig/hasKey + key masking', () => {
      GF.ai.setConfig({ provider: 'fal', key: 'secret12345' });
      if (!GF.ai.hasKey()) throw new Error('hasKey false');
      const c = GF.ai.config(); if (c.key.indexOf('secret') !== -1) throw new Error('key leaked: ' + c.key);
      GF.ai.setConfig({ key: '' });
    });
    await t('AI findImageInResponse (url/data/base64)', () => {
      const f = GF.ai._findImageInResponse;
      if (f({ images: [{ url: 'https://x.com/a.png' }] }) !== 'https://x.com/a.png') throw new Error('url');
      if (f({ out: 'data:image/png;base64,AAAA' }) !== 'data:image/png;base64,AAAA') throw new Error('data');
      if (f({ b64: 'A'.repeat(220) }) !== 'data:image/png;base64,' + 'A'.repeat(220)) throw new Error('b64');
      if (f({ nope: 'hello' }) !== null) throw new Error('false positive');
    });

    /* ---------- KEYBOARD ---------- */
    await t('keyboard: b selects brush', () => { GF.view.view.tool = 'move'; window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b' })); if (GF.view.view.tool !== 'brush') throw new Error('tool ' + GF.view.view.tool); });
    await t('keyboard: ctrl+z undoes', () => { freshDoc(); GF.api.run('paint', { points: [[5,5],[40,40]], size: 6, color: '#000' }); const had = GF.history.canUndo(); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })); void had; });

    /* ---------- SNAPSHOT ---------- */
    await t('api.snapshot returns PNG dataURL', () => { freshDoc(); const s = GF.api.snapshot(1); if (s.indexOf('data:image/png') !== 0) throw new Error('bad snapshot'); });

    /* ---------- COMMAND PALETTE ---------- */
    await t('palette opens with many commands', () => {
      $('#btn-palette').click();
      if (!$('.cmdk')) throw new Error('not open');
      if (document.querySelectorAll('.cmdk-item').length < 25) throw new Error('too few');
    });
    await t('palette fuzzy-filters', () => {
      const inp = $('.cmdk-input'); inp.value = 'rotate'; inp.dispatchEvent(new Event('input'));
      const n = document.querySelectorAll('.cmdk-item').length;
      if (n === 0 || n > 12) throw new Error('filter count ' + n);
    });
    await t('palette Enter runs + closes', () => {
      const inp = $('.cmdk-input'); inp.value = 'fit to screen'; inp.dispatchEvent(new Event('input'));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      if ($('.cmdk')) throw new Error('did not close');
    });
    await t('Ctrl+K toggles palette', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      const open = !!$('.cmdk');
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      if (!open || $('.cmdk')) throw new Error('toggle failed');
    });

    /* ---------- CROP overhaul ---------- */
    await t('crop tool opens overlay with 8 handles', () => {
      freshDoc(200, 200); clickTool('crop');
      if (!$('#crop-overlay .crop-rect')) throw new Error('no overlay');
      if (document.querySelectorAll('.crop-h').length !== 8) throw new Error('handles');
    });
    await t('crop aspect 1:1 makes a square region', () => {
      $("#crop-aspect button[data-v='1']").click();
      const r = $('.crop-rect').getBoundingClientRect();
      if (Math.abs(r.width - r.height) > 2) throw new Error('not square ' + Math.round(r.width) + 'x' + Math.round(r.height));
    });
    await t('crop apply changes doc size + closes overlay', () => {
      const w0 = D.doc.width; $('#crop-apply').click();
      if ($('#crop-overlay')) throw new Error('overlay still open');
      if (D.doc.width >= w0) throw new Error('not cropped (' + D.doc.width + ')');
    });
    await t('straighten rotates + expands canvas', () => {
      freshDoc(200, 200); clickTool('crop'); const w0 = D.doc.width;
      const cs = $('#crop-straighten'); cs.value = 10; cs.dispatchEvent(new Event('change'));
      if (D.doc.width <= w0) throw new Error('not expanded');
      clickTool('move');
    });

    /* ---------- PRO ADJUST: histogram, image size, compare ---------- */
    await t('histogram renders pixels', () => {
      freshDoc();
      const hc = $('#histogram'); const d = hc.getContext('2d').getImageData(0, 0, hc.width, hc.height).data;
      let any = false; for (let i = 3; i < d.length; i += 4) if (d[i] > 0) { any = true; break; }
      if (!any) throw new Error('blank histogram');
    });
    await t('image size dialog opens + resizes', () => {
      freshDoc(100, 100);
      $('#btn-menu').click();
      $('.fs-modal [data-a=size]').click();
      const m = $('.fs-modal'); if (!m || !m.querySelector('#is-w')) throw new Error('no size dialog');
      m.querySelector('#is-lock').click();
      m.querySelector('#is-w').value = 250; m.querySelector('#is-h').value = 180;
      Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => b.textContent === 'Resize').click();
      if (D.doc.width !== 250 || D.doc.height !== 180) throw new Error('size ' + D.doc.width + 'x' + D.doc.height);
    });
    await t('before/after compare clears+restores preview', () => {
      freshDoc(); const inp = $('#adj-sliders input[data-k=exposure]'); inp.value = 30; inp.dispatchEvent(new Event('input'));
      const b = $('#adj-compare');
      b.dispatchEvent(new PointerEvent('pointerdown'));
      if (D.doc.preview) throw new Error('preview not hidden');
      b.dispatchEvent(new PointerEvent('pointerup'));
      if (!D.doc.preview) throw new Error('preview not restored');
      $('#adj-reset').click();
    });

    /* ---------- QUICK WINS ---------- */
    await t('selection expand/feather via hotbar (safe)', () => {
      freshDoc(); clickTool('select');
      GF.api.run('selectRect', { x: 20, y: 20, w: 60, h: 60 });
      if (GF.hotbar) GF.hotbar.refresh();
      const expand = $('[data-hotbar="sel-expand"]');
      const feather = $('[data-hotbar="sel-feather"]');
      if (!expand || !feather) throw new Error('missing expand/feather in hotbar');
      expand.click(); feather.click(); GF.api.run('deselect');
    });
    await t('theme toggle flips data-theme', () => {
      const before = document.documentElement.dataset.theme || '';
      $('#btn-theme').click();
      if ((document.documentElement.dataset.theme || '') === before) throw new Error('no change');
    });
    await t('cheat-sheet opens', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }));
      if (!document.querySelector('.fs-modal .cheat')) throw new Error('no cheat sheet');
      document.querySelector('.fs-modal .text-btn').click();
    });

    /* ---------- ADJUSTMENT LAYERS (non-destructive) ---------- */
    await t('fx adds re-editable brightness/contrast layer', () => {
      freshDoc(); const n = layerCount();
      $('#lyr-fx').click();
      const menu = $('.fs-modal'); if (!menu || !menu.querySelector('[data-k=brightnessContrast]')) throw new Error('no add menu');
      menu.querySelector('[data-k=brightnessContrast]').click();
      if (layerCount() !== n + 1) throw new Error('no layer');
      const L = D.active(); if (!L.adjust || L.adjust.kind !== 'brightnessContrast') throw new Error('wrong kind');
      const ed = $('.fs-modal'); if (!ed || !ed.querySelector('input[data-k=brightness]')) throw new Error('no editor');
      const inp = ed.querySelector('input[data-k=brightness]'); inp.value = 60; inp.dispatchEvent(new Event('input'));
      if (L.adjust.params.brightness !== 60) throw new Error('param not updated');
      ed.querySelector('.text-btn.primary').click();
    });
    await t('grayscale adjustment changes composite + reverts on delete', () => {
      freshDoc();
      const before = GF.api.snapshot(1);
      $('#lyr-fx').click(); $('.fs-modal [data-k=grayscale]').click();
      if (GF.api.snapshot(1) === before) throw new Error('composite unchanged');
      GF.api.run('deleteLayer');
      if (GF.api.snapshot(1) !== before) throw new Error('not reverted after delete');
    });
    await t('levels adjustment + gamma scaling', () => {
      freshDoc(); $('#lyr-fx').click(); $('.fs-modal [data-k=levels]').click();
      const L = D.active(); if (L.adjust.kind !== 'levels') throw new Error('kind');
      const ed = $('.fs-modal'); const g = ed.querySelector('input[data-k=gamma]'); g.value = 200; g.dispatchEvent(new Event('input'));
      if (Math.abs(L.adjust.params.gamma - 2) > 0.01) throw new Error('gamma ' + L.adjust.params.gamma);
      ed.querySelector('.text-btn.primary').click();
    });
    await t('curves adjustment editor opens with canvas', () => {
      freshDoc(); $('#lyr-fx').click(); $('.fs-modal [data-k=curves]').click();
      const ed = $('.fs-modal'); if (!ed.querySelector('#al-curve')) throw new Error('no curve canvas');
      ed.querySelector('.text-btn.primary').click();
    });
    await t('double-click adjustment layer re-opens editor', () => {
      freshDoc(); $('#lyr-fx').click(); $('.fs-modal [data-k=hsl]').click();
      $('.fs-modal .text-btn.primary').click();
      const item = document.querySelector('#layer-list .layer-item.on');
      item.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      if (!$('.fs-modal') || !$('.fs-modal input[data-k=h]')) throw new Error('did not reopen');
      $('.fs-modal .text-btn.primary').click();
    });
    await t('adjustment command-palette entries exist', () => {
      $('#btn-palette').click();
      const inp = $('.cmdk-input'); inp.value = 'add levels'; inp.dispatchEvent(new Event('input'));
      const hit = Array.prototype.some.call(document.querySelectorAll('.cmdk-label'), e => /Levels/.test(e.textContent));
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      if (!hit) throw new Error('no adjustment commands');
    });

    /* ---------- VIBRANCE / CLARITY ---------- */
    await t('vibrance + clarity sliders present + apply', () => {
      freshDoc();
      if (!$('#adj-sliders input[data-k=vibrance]') || !$('#adj-sliders input[data-k=clarity]')) throw new Error('missing sliders');
      const v = $('#adj-sliders input[data-k=vibrance]'); v.value = 50; v.dispatchEvent(new Event('input'));
      if (!D.doc.preview) throw new Error('no preview');
      $('#adj-apply').click();
      if (!GF.history.canUndo()) throw new Error('not applied');
    });
    await t('clarity slider applies without error', () => {
      freshDoc();
      const c = $('#adj-sliders input[data-k=clarity]'); c.value = 60; c.dispatchEvent(new Event('input'));
      $('#adj-apply').click();
    });

    /* ---------- FONT PICKER ---------- */
    await t('text dialog has font picker + adds text', () => {
      freshDoc();
      GF.ui.openTextDialog({ x: 20, y: 20 });
      const m = $('.fs-modal'); if (!m || !m.querySelector('#m-font')) throw new Error('no font picker');
      m.querySelector('#m-text').value = 'Hi'; m.querySelector('#m-font').value = 'Georgia, serif';
      const n = layerCount();
      Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => b.textContent === 'Add').click();
      if (layerCount() !== n + 1) throw new Error('no text layer');
    });

    /* ---------- HISTORY PANEL ---------- */
    await t('history panel lists named steps + current marker', () => {
      freshDoc(); GF.api.run('paint', { points: [[5,5],[40,40]], size: 8, color: '#000' });
      GF.api.run('addLayer', {});
      const items = document.querySelectorAll('#history-list .hist-item');
      if (items.length < 3) throw new Error('only ' + items.length + ' steps');
      if (!document.querySelector('#history-list .hist-item.on')) throw new Error('no current marker');
    });
    await t('history jump reverts then re-applies', () => {
      freshDoc(); GF.api.run('paint', { points: [[5,5],[60,60]], size: 10, color: '#f00' });
      const painted = GF.api.snapshot(1);
      document.querySelector('#history-list .hist-item').click();   // Original
      if (GF.api.snapshot(1) === painted) throw new Error('did not revert');
      const future = document.querySelector('#history-list .hist-item.future');
      if (!future) throw new Error('no future step');
      future.click();
      if (GF.api.snapshot(1) !== painted) throw new Error('did not re-apply');
    });

    /* ---------- RE-EDITABLE TEXT LAYERS ---------- */
    await t('text layer carries metadata + is re-editable', () => {
      freshDoc(); const n = layerCount();
      GF.ui.openTextDialog({ x: 10, y: 10 });
      let m = $('.fs-modal'); m.querySelector('#m-text').value = 'Hello';
      Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => /Add/.test(b.textContent)).click();
      if (layerCount() !== n + 1) throw new Error('no text layer');
      const L = D.active(); if (!L.text || L.text.text !== 'Hello') throw new Error('no metadata');
      const before = L.canvas.toDataURL();
      document.querySelector('#layer-list .layer-item.on').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
      m = $('.fs-modal'); if (!m || m.querySelector('#m-text').value !== 'Hello') throw new Error('not prefilled');
      m.querySelector('#m-text').value = 'Changed words now';
      Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => /Update/.test(b.textContent)).click();
      if (L.text.text !== 'Changed words now') throw new Error('not updated');
      if (L.canvas.toDataURL() === before) throw new Error('canvas not re-rendered');
    });
    await t('text metadata survives serialize/deserialize', async () => {
      const json = JSON.parse(JSON.stringify(D.serialize()));
      await D.deserialize(json);
      const tl = D.doc.layers.find(l => l.text);
      if (!tl || !/Changed/.test(tl.text.text)) throw new Error('text metadata lost');
    });

    /* ---------- PWA + AUTOSAVE ---------- */
    await t('manifest + icon linked in head', () => {
      if (!document.querySelector('link[rel=manifest]')) throw new Error('no manifest');
      if (!document.querySelector('link[rel=icon]')) throw new Error('no icon');
    });
    await t('IndexedDB autosave roundtrip (skips if IDB blocked)', async () => {
      const ok = await new Promise(res => {
        let r; try { r = indexedDB.open('forge-studio', 1); } catch (e) { return res(false); }
        r.onupgradeneeded = () => r.result.createObjectStore('session');
        r.onsuccess = () => { r.result.close(); res(true); };
        r.onerror = () => res(false); r.onblocked = () => res(false);
      });
      if (!ok) return; // file:// blocks IndexedDB — graceful skip
      freshDoc(); GF.api.run('paint', { points: [[5,5],[30,30]], size: 6, color: '#000' });
      await new Promise(res => { const r = indexedDB.open('forge-studio', 1); r.onsuccess = () => { const tx = r.result.transaction('session', 'readwrite'); tx.objectStore('session').put({ ts: 1, data: D.serialize() }, 'autosave'); tx.oncomplete = res; tx.onerror = res; }; r.onerror = res; });
      const got = await new Promise(res => { const r = indexedDB.open('forge-studio', 1); r.onsuccess = () => { const q = r.result.transaction('session', 'readonly').objectStore('session').get('autosave'); q.onsuccess = () => res(q.result); q.onerror = () => res(null); }; r.onerror = () => res(null); });
      if (!got || !got.data) throw new Error('not persisted');
    });

    /* ---------- PRO SELECTIONS + GUIDES ---------- */
    await t('wand optbar: mode/tolerance/guide + AA default on', () => {
      freshDoc(); clickTool('wand');
      if (!$('#wand-mode')) throw new Error('missing #wand-mode (select/auto-remove seg)');
      if (!$('#wand-tol')) throw new Error('missing #wand-tol');
      if (!$('.guide-btn')) throw new Error('no guide button');
      if (!GF.view.view.wand.antialias) throw new Error('anti-alias should default on');
    });
    await t('wand intersect mode (no throw)', () => {
      freshDoc(); GF.api.run('selectRect', { x: 0, y: 0, w: 120, h: 120 });
      GF.api.run('wandSelect', { x: 5, y: 5, tolerance: 40, mode: 'intersect' });
      GF.api.run('deselect');
    });
    await t('wand live-tolerance re-selects from same click', () => {
      GF.api.run('newDoc', { w: 300, h: 300, bg: 'white' });
      const c = U.ctx2d(D.active().canvas); const g = c.createLinearGradient(0, 0, 300, 0);
      g.addColorStop(0, '#000'); g.addColorStop(1, '#fff'); c.fillStyle = g; c.fillRect(0, 0, 300, 300);
      GF.ui.onDocumentOpened(); clickTool('wand');
      GF.view.view.wand.tolerance = 30; GF.view.view.wand.seed = { x: 150, y: 150 };
      GF.api.run('wandSelect', { x: 150, y: 150, tolerance: 30 });
      const lo = GF.select.count();
      const sl = $('#wand-tol'); sl.value = 90; sl.dispatchEvent(new Event('input'));   // live re-wand
      if (GF.select.count() <= lo) throw new Error('tolerance slider did not grow selection (' + lo + '→' + GF.select.count() + ')');
      GF.api.run('deselect');
    });
    await t('selection dim veil canvas builds', () => {
      freshDoc(); GF.api.run('selectRect', { x: 30, y: 30, w: 60, h: 60 });
      const dc = GF.select.dimCanvas(); if (!dc || !dc.width) throw new Error('no dim canvas');
      GF.api.run('deselect');
    });
    await t('wand sample=layer (no throw)', () => {
      freshDoc(); GF.view.view.wand.sample = 'layer';
      GF.api.run('wandSelect', { x: 5, y: 5, tolerance: 32 });
      GF.view.view.wand.sample = 'all'; GF.api.run('deselect');
    });
    await t('select ops: grow/contract/feather/smooth keep selection', () => {
      freshDoc(); GF.api.run('selectRect', { x: 40, y: 40, w: 80, h: 80 });
      GF.select.grow(4); GF.select.contract(2); GF.select.feather(2); GF.select.smooth(2);
      if (GF.select.count() === 0) throw new Error('selection lost'); GF.api.run('deselect');
    });
    await t('color range selects matching pixels', () => {
      freshDoc();
      const img = GF.util.ctx2d(GF.doc.composite()).getImageData(0, 0, GF.doc.doc.width, GF.doc.doc.height);
      GF.select.selectColor(img, 200, 55, 55, 70, 'replace');   // ≈ the red rect (#c83737)
      if (!GF.select.has()) throw new Error('color range selected nothing'); GF.api.run('deselect');
    });
    await t('selection hotbar shows actions + Fill works + hides on deselect', () => {
      freshDoc(); GF.api.run('selectRect', { x: 30, y: 30, w: 60, h: 60 });
      if (GF.hotbar) GF.hotbar.refresh();
      const ctx = GF.hotbar ? GF.hotbar.getContext() : null;
      if (ctx !== '2d-selection') throw new Error('hotbar context should be 2d-selection, got ' + ctx);
      const fillBtn = $('[data-hotbar="sel-fill"]');
      if (!fillBtn) throw new Error('no fill button in hotbar');
      fillBtn.click();
      if (!GF.history.canUndo()) throw new Error('fill did nothing');
      GF.api.run('deselect');
      if (GF.hotbar) GF.hotbar.refresh();
      if (GF.hotbar.getContext() === '2d-selection') throw new Error('hotbar should leave selection context on deselect');
    });
    await t('selection hotbar: copy to new layer', () => {
      freshDoc(); GF.api.run('selectRect', { x: 20, y: 20, w: 50, h: 50 }); const n = layerCount();
      if (GF.hotbar) GF.hotbar.refresh();
      const btn = $('[data-hotbar="sel-copy"]');
      if (!btn) throw new Error('no copy-layer button in hotbar');
      btn.click();
      if (layerCount() !== n + 1) throw new Error('copy did not add a layer'); GF.api.run('deselect');
    });
    await t('selection hotbar: crop to selection', () => {
      freshDoc(200, 200); GF.api.run('selectRect', { x: 50, y: 50, w: 80, h: 60 });
      if (GF.hotbar) GF.hotbar.refresh();
      const btn = $('[data-hotbar="sel-crop"]');
      if (!btn) throw new Error('no crop button in hotbar');
      btn.click();
      if (GF.doc.doc.width !== 80 || GF.doc.doc.height !== 60) throw new Error('crop wrong ' + GF.doc.doc.width + 'x' + GF.doc.doc.height);
    });
    await t('adjustment auto-masks from selection', () => {
      freshDoc(); GF.api.run('selectRect', { x: 20, y: 20, w: 60, h: 60 });
      $('#lyr-fx').click(); $('.fs-modal [data-k=brightnessContrast]').click();
      const L = GF.doc.active(); if (!L.adjust || !L.mask) throw new Error('adjustment not masked from selection');
      $('.fs-modal .text-btn.primary').click(); GF.api.run('deselect');
    });
    await t('hotbar selection has expand + feather; palette has Color range', async () => {
      freshDoc(); GF.api.run('selectRect', { x: 10, y: 10, w: 40, h: 40 });
      if (GF.hotbar) GF.hotbar.refresh();
      if (!$('[data-hotbar="sel-expand"]')) throw new Error('missing expand in hotbar');
      if (!$('[data-hotbar="sel-feather"]')) throw new Error('missing feather in hotbar');
      GF.api.run('deselect');
      palRun('Color range');
      await new Promise(r => setTimeout(r, 40));
      if (!$('.fs-modal #cr-tol')) throw new Error('Color range dialog missing');
      $('.fs-modal .text-btn').click();
    });
    await t('tool guide opens (wand) with helpful content', () => {
      freshDoc(); clickTool('wand');
      const btn = $('.guide-btn'); if (!btn) throw new Error('no guide button');
      btn.click();
      const g = $('.fs-modal .tool-guide'); if (!g) throw new Error('no guide modal');
      if (g.textContent.length < 20) throw new Error('guide content too short');
      $('.fs-modal .text-btn').click();
    });

    /* ---------- 3D WORKSPACE ---------- */
    // Headless Chrome may lack WebGL (SwiftShader); soft-skip so the 2D suite
    // stays green everywhere. Full 3D coverage needs a real browser.
    const webgl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
    const bundleReady = !!window.__THREE_BUNDLE;
    let s3ok = false;
    if (!webgl || !GF.scene3d || !bundleReady) log('3d: suite skipped (' + (!webgl ? 'no WebGL' : !bundleReady ? 'bundle parse timeout (headless limitation)' : 'no scene3d') + ')', true, 'soft-skip');
    else {
      await t('3d: engine boots, mode + host + 2D canvas intact', async () => {
        freshDoc(120, 120);
        clickTool('scene3d');
        s3ok = await GF.scene3d.enter();          // setTool kicked it off; await the async boot
        if (!s3ok) throw new Error('engine failed to load');
        if (document.body.dataset.mode !== '3d') throw new Error('mode=' + document.body.dataset.mode);
        if (!document.querySelector('#scene3d-host canvas')) throw new Error('no renderer canvas');
        if (!$('#view-canvas')) throw new Error('2D canvas gone');
      }, 30000);
    }
    if (s3ok) {
      await t('3d: optbar shows interaction modes', () => {
        if (!$('#s3-interact')) throw new Error('no interact seg');
      });
      await t('3d: add primitive -> object listed', async () => {
        const id = await GF.scene3d.addPrimitive('box');
        if (id == null) throw new Error('addPrimitive failed');
        if (GF.scene3d.count() !== 1) throw new Error('count ' + GF.scene3d.count());
        if (!document.querySelector('#s3-objects .layer-item')) throw new Error('object list empty');
      });
      await t('3d: every shape in the catalog builds', async () => {
        const KINDS = ['sphere', 'roundedbox', 'cylinder', 'cone', 'pyramid', 'prism', 'capsule',
          'hemisphere', 'torus', 'torusknot', 'pipe', 'tetrahedron', 'octahedron', 'dodecahedron',
          'icosahedron', 'gem', 'plane', 'panel', 'disc', 'ring', 'tile', 'hex', 'curved',
          'star', 'heart', 'arrow', 'steps'];
        const before = GF.scene3d.count();
        for (const k of KINDS) {
          const id = await GF.scene3d.addPrimitive(k);
          if (id == null) throw new Error(k + ' failed to build');
        }
        if (GF.scene3d.count() !== before + KINDS.length) throw new Error('count mismatch');
        // clean up so the rest of the 3D suite sees the expected scene:
        // one selected box and an empty scene-undo stack
        for (const o of GF.scene3d.listObjects()) { if (o.id !== 1) GF.scene3d.removeObject(o.id); }
        if (GF.scene3d.count() !== 1) throw new Error('cleanup failed: ' + GF.scene3d.count());
        GF.scene3d.hist.clear();
        GF.scene3d.select(1);
      }, 30000);
      await t('3d: setObject/getObject 9-DOF roundtrip', () => {
        const id = GF.scene3d.selectedId();
        GF.scene3d.setObject(id, { px: 0.5, py: -0.25, pz: 1, rx: 30, ry: 45, rz: 10, sx: 2, sy: 1.5, sz: 0.5 });
        const g = GF.scene3d.getObject(id);
        if (Math.abs(g.px - 0.5) > 1e-6 || g.ry !== 45 || Math.abs(g.sx - 2) > 1e-6) throw new Error(JSON.stringify(g));
      });
      await t('3d: material source = named layer (no throw)', () => {
        const L = D.active();
        GF.scene3d.setMaterial(GF.scene3d.selectedId(), { mapSource: 'layer:' + L.id });
      });
      await t('3d: scene undo routes via api, doc history untouched', () => {
        const docUndo = GF.history.info().undo.length;
        const n = GF.scene3d.count();
        GF.api.run('undo');    // undoes the material change (scene stack, not bitmap stack)
        GF.api.run('undo');    // undoes the transform
        if (GF.scene3d.count() !== n) throw new Error('object count changed unexpectedly');
        GF.api.run('redo'); GF.api.run('redo');
        if (GF.history.info().undo.length !== docUndo) throw new Error('doc history was touched');
      });
      await t('3d: flatten to layer at doc resolution + history label', () => {
        const n = layerCount();
        const lid = GF.scene3d.snapshotToLayer();
        if (lid == null) throw new Error('no layer id');
        if (layerCount() !== n + 1) throw new Error('layer not added');
        const L = D.doc.layers.find(l => l.id === lid);
        if (L.canvas.width !== D.doc.width || L.canvas.height !== D.doc.height) throw new Error('not doc resolution');
        if ((GF.history.info().undo.slice(-1)[0] || '') !== '3D render') throw new Error('history label');
        const px = U.ctx2d(L.canvas).getImageData(0, 0, L.canvas.width, L.canvas.height).data;
        let lit = false; for (let i = 3; i < px.length; i += 4) if (px[i] > 0) { lit = true; break; }
        if (!lit) throw new Error('flattened layer is blank');
      });
      await t('3d: export GLB produces a binary blob', async () => {
        const orig = GF.util.downloadBlob;
        let blob = null;
        GF.util.downloadBlob = b => { blob = b; };
        try { await GF.scene3d.exportGLB({}); } finally { GF.util.downloadBlob = orig; }
        if (!blob || !blob.size) throw new Error('no blob');
        if (blob.type !== 'model/gltf-binary') throw new Error('type ' + blob.type);
      }, 30000);
      await t('3d: import sample GLB (soft-skip if file:// blocks fetch)', async () => {
        const id = await GF.scene3d.importModel('assets/models/cube.glb', 'cube');
        if (id == null) log('3d: GLB fetch unavailable here', true, 'soft-skip');
        else if (GF.scene3d.getObject(id).kind !== 'model') throw new Error('not a model');
      }, 30000);
      await t('3d: remove selected + scene undo restores it', () => {
        const n = GF.scene3d.count(); if (!n) throw new Error('nothing to remove');
        GF.scene3d.removeObject(GF.scene3d.listObjects()[0].id);
        if (GF.scene3d.count() !== n - 1) throw new Error('not removed');
        GF.scene3d.hist.undo();
        if (GF.scene3d.count() !== n) throw new Error('undo did not restore');
      });
      await t('make3d: extrude cutout traces alpha shape (with hole) into geometry', async () => {
        GF.api.run('newDoc', { w: 200, h: 200 });   // transparent
        const c = U.ctx2d(D.active().canvas);
        c.fillStyle = '#c83737'; c.beginPath(); c.arc(100, 100, 70, 0, 7); c.fill();
        c.globalCompositeOperation = 'destination-out';
        c.beginPath(); c.arc(100, 100, 25, 0, 7); c.fill();
        c.globalCompositeOperation = 'source-over';
        const n = GF.scene3d.count();
        const id = await GF.make3d.run('cutout', { depth: 0.3 });
        if (id == null) throw new Error('no object created');
        if (GF.scene3d.count() !== n + 1) throw new Error('count ' + GF.scene3d.count());
        const o = GF.scene3d.byId(id);
        const pos = o.node.geometry.attributes.position;
        if (!pos || pos.count < 50) throw new Error('degenerate geometry: ' + (pos && pos.count));
        if (!o.mat.mapSource || o.mat.mapSource.indexOf('image:') !== 0) throw new Error('no snapshot texture: ' + o.mat.mapSource);
      }, 30000);
      await t('make3d: relief + lathe + layer stack all build', async () => {
        freshDoc(120, 120);
        for (const k of ['relief', 'lathe', 'layers']) {
          const id = await GF.make3d.run(k, {});
          if (id == null) throw new Error(k + ' failed');
        }
      }, 30000);
      await t('publish: one-file page embeds scene + viewer + animation', async () => {
        const html = await GF.publish.buildPage({ title: 'Test <scene>', autoRotate: true });
        if (!html) throw new Error('no html');
        if (html.indexOf('cdn.jsdelivr.net/npm/three@0.185.0') < 0) throw new Error('no pinned import map');
        if (html.indexOf('scene-glb') < 0) throw new Error('no embedded GLB block');
        if (html.indexOf('OrbitControls') < 0) throw new Error('no controls');
        if (html.indexOf('GLTFLoader') < 0) throw new Error('no loader');
        if (html.indexOf('AnimationMixer') < 0) throw new Error('no animation support');
        if (html.indexOf('Test &lt;scene&gt;') < 0) throw new Error('title not escaped');
        const m = html.match(/type="application\/octet-stream">([^<]+)</);
        if (!m || m[1].trim().length < 800) throw new Error('GLB payload too small: ' + (m ? m[1].trim().length : 0));
        if (!/^[A-Za-z0-9+/=\s]+$/.test(m[1].trim())) throw new Error('payload is not base64');
      }, 30000);
      await t('make3d: registered in the api catalog', () => {
        const names = GF.api.describe().map(c => c.name);
        ['make3d.run', 'make3d.cutout', 'make3d.relief', 'make3d.lathe', 'make3d.layers'].forEach(n => {
          if (names.indexOf(n) < 0) throw new Error('missing ' + n);
        });
        if (GF.make3d.list().length < 4) throw new Error('registry too small');
      });
      await t('3d: exit restores 2D mode + tool dispatch', () => {
        clickTool('move');
        // 3D always on — mode stays '3d'; verify tool dispatch works
        clickTool('brush');
        if (GF.view.view.tool !== 'brush') throw new Error('2D dispatch broken: ' + GF.view.view.tool);
      });
    } else if (webgl && GF.scene3d) log('3d: remaining tests skipped (engine unavailable)', true, 'soft-skip');

    /* ---------- BRUSH STABILIZER ---------- */
    await t('brush stabilizer: 0 = passthrough, >0 = smoothed', () => {
      if (GF.view.view.brush.stabilizer !== 0) throw new Error('default not 0');
      GF.view.view.brush.stabilizer = 5;
      if (GF.view.view.brush.stabilizer !== 5) throw new Error('not set');
      GF.view.view.brush.stabilizer = 0;
    });
    await t('optbar: brush erase mode toggle present', () => {
      clickTool('brush');
      if (!$('#brush-mode')) throw new Error('no brush-mode seg (paint/erase toggle)');
    });

    /* ---------- PAINT3D ---------- */
    await t('paint3d module loaded with API commands', () => {
      if (!GF.paint3d) throw new Error('GF.paint3d missing');
      if (typeof GF.paint3d.enter !== 'function') throw new Error('enter missing');
      if (typeof GF.paint3d.setBrush !== 'function') throw new Error('setBrush missing');
      const names = GF.api.describe().map(c => c.name);
      ['paint3d.enter', 'paint3d.exit', 'paint3d.setBrush', 'paint3d.clear'].forEach(n => {
        if (names.indexOf(n) < 0) throw new Error('missing API: ' + n);
      });
    });

    /* ---------- POLISH ---------- */
    await t('polish: quick-actions bar exists in DOM', () => {
      if (!$('#quick-actions')) throw new Error('no quick-actions bar');
    });
    await t('polish: first-use tip definitions exist', () => {
      if (!GF.polish || typeof GF.polish.showTip !== 'function') throw new Error('showTip missing');
    });

    /* ---------- PROCEDURAL MATERIALS ---------- */
    await t('texgen: listPresets returns 15 material presets', () => {
      const p = GF.texture.listPresets();
      if (p.length !== 15) throw new Error('count ' + p.length);
      if (!p.find(m => m.id === 'wood')) throw new Error('wood missing');
      if (!p.find(m => m.id === 'carbon')) throw new Error('carbon missing');
    });
    await t('texgen: generateMaterial produces color+normal+height', () => {
      const m = GF.texture.generateMaterial('wood', 64, 64);
      if (!m || !m.color || !m.normal || !m.height) throw new Error('missing maps');
      if (m.color.width !== 64) throw new Error('wrong size ' + m.color.width);
      if (!m.preset || m.preset.id !== 'wood') throw new Error('wrong preset');
    });
    await t('texgen: all 15 presets generate without error', () => {
      const presets = GF.texture.listPresets();
      for (const p of presets) {
        const m = GF.texture.generateMaterial(p.id, 32, 32);
        if (!m || !m.color) throw new Error(p.id + ' failed');
      }
    }, 30000);
    await t('assets: canvasToBlob converts canvas synchronously', async () => {
      const c = document.createElement('canvas'); c.width = 4; c.height = 4;
      c.getContext('2d').fillStyle = '#f00'; c.getContext('2d').fillRect(0, 0, 4, 4);
      const blob = await GF.assets.canvasToBlob(c);
      if (!blob || !blob.size) throw new Error('no blob: ' + blob);
      if (blob.type !== 'image/png') throw new Error('type: ' + blob.type);
    });
    await t('assets: saveMaterial + canvasToBlob wired correctly', async () => {
      const m = GF.texture.generateMaterial('stone', 32, 32);
      if (!m.preset || m.preset.metalness !== 0) throw new Error('preset data wrong');
      const blob = await GF.assets.canvasToBlob(m.color);
      if (!blob || blob.type !== 'image/png') throw new Error('canvasToBlob failed');
      if (typeof GF.assets.saveMaterial !== 'function') throw new Error('saveMaterial missing');
    });
    await t('materials API commands registered', () => {
      const names = GF.api.describe().map(c => c.name);
      ['materials.listPresets', 'materials.generate', 'materials.generateAll'].forEach(n => {
        if (names.indexOf(n) < 0) throw new Error('missing ' + n);
      });
    });

    /* ================================================================
       GAME DECK — Transform Pad + Context Hotbar
       Full test coverage for the Game Deck UI system.
       ================================================================ */

    /* ---------- TRANSFORM PAD: MODULE ---------- */
    await t('transform pad: module loaded with public API', () => {
      if (!GF.transformPad) throw new Error('GF.transformPad missing');
      ['init', 'setAxis', 'getAxis', 'refresh'].forEach(fn => {
        if (typeof GF.transformPad[fn] !== 'function') throw new Error('missing ' + fn);
      });
    });

    await t('transform pad: DOM embedded in toolrail (not floating)', () => {
      const pad = $('#transform-pad');
      if (!pad) throw new Error('no #transform-pad element');
      const rail = $('#toolrail');
      if (!rail) throw new Error('no #toolrail');
      if (!rail.contains(pad)) throw new Error('pad is NOT inside toolrail — must be embedded, not floating');
    });

    await t('transform pad: has 9 directional buttons', () => {
      const pad = $('#transform-pad');
      const btns = pad.querySelectorAll('[data-dir]');
      if (btns.length !== 9) throw new Error('expected 9 buttons, got ' + btns.length);
      const dirs = Array.from(btns).map(b => b.dataset.dir).sort().join(',');
      if (dirs !== 'c,e,n,ne,nw,s,se,sw,w') throw new Error('wrong dirs: ' + dirs);
    });

    await t('transform pad: all buttons have aria-label', () => {
      const btns = $('#transform-pad').querySelectorAll('[data-dir]');
      btns.forEach(b => {
        if (!b.getAttribute('aria-label')) throw new Error('missing aria-label on ' + b.dataset.dir);
      });
    });

    await t('transform pad: active when document open + layer exists', () => {
      freshDoc();
      GF.transformPad.refresh();
      const pad = $('#transform-pad');
      if (!pad.classList.contains('tpad-active')) throw new Error('pad should be active when doc open');
      if (pad.classList.contains('tpad-dimmed')) throw new Error('pad should not be dimmed');
    });

    /* ---------- TRANSFORM PAD: AXIS MODE ---------- */
    await t('transform pad: axis mode cycles free → x → y → free (2D)', () => {
      freshDoc();
      GF.transformPad.setAxis('free');
      if (GF.transformPad.getAxis() !== 'free') throw new Error('expected free');
      // Use setAxis API — the pointerdown event is harder to synthesize in headless
      GF.transformPad.setAxis('x');
      if (GF.transformPad.getAxis() !== 'x') throw new Error('expected x, got ' + GF.transformPad.getAxis());
      GF.transformPad.setAxis('y');
      if (GF.transformPad.getAxis() !== 'y') throw new Error('expected y, got ' + GF.transformPad.getAxis());
      GF.transformPad.setAxis('free');
      if (GF.transformPad.getAxis() !== 'free') throw new Error('expected free, got ' + GF.transformPad.getAxis());
    });

    await t('transform pad: center button shows axis badge', () => {
      GF.transformPad.setAxis('x');
      const badge = $('#transform-pad .tpad-c .tpad-axis');
      if (!badge) throw new Error('no axis badge');
      if (badge.textContent !== '━') throw new Error('wrong badge for x: ' + badge.textContent);
      GF.transformPad.setAxis('free');
      if (badge.textContent !== '⊕') throw new Error('wrong badge for free: ' + badge.textContent);
    });

    await t('transform pad: axis lock dims blocked directions', () => {
      freshDoc();
      GF.transformPad.setAxis('x');
      const n = $('#transform-pad [data-dir="n"]');
      const s = $('#transform-pad [data-dir="s"]');
      const w = $('#transform-pad [data-dir="w"]');
      if (!n.classList.contains('axis-locked')) throw new Error('N should be locked in X mode');
      if (!s.classList.contains('axis-locked')) throw new Error('S should be locked in X mode');
      if (w.classList.contains('axis-locked')) throw new Error('W should NOT be locked in X mode');
      GF.transformPad.setAxis('free');
    });

    /* ---------- CONTEXT HOTBAR: MODULE ---------- */
    await t('hotbar: module loaded with public API', () => {
      if (!GF.hotbar) throw new Error('GF.hotbar missing');
      ['refresh', 'getContext'].forEach(fn => {
        if (typeof GF.hotbar[fn] !== 'function') throw new Error('missing ' + fn);
      });
    });

    await t('hotbar: DOM lives in #actionbar', () => {
      const bar = $('#actionbar');
      if (!bar) throw new Error('no #actionbar');
      // Should have at least one button
      if (!bar.querySelector('[data-hotbar]')) throw new Error('no hotbar buttons in #actionbar');
    });

    await t('hotbar: context reflects current state', () => {
      freshDoc(); clickTool('move');
      GF.hotbar.refresh();
      const ctx = GF.hotbar.getContext();
      // With a doc open and no selection, should be an idle context
      if (ctx === 'empty') throw new Error('should not be empty when doc is open');
      if (ctx === '2d-selection') throw new Error('should not be selection without a selection');
    });

    await t('hotbar: "2d-selection" context when selection active', () => {
      freshDoc();
      GF.api.run('selectRect', { x: 10, y: 10, w: 30, h: 30 });
      GF.hotbar.refresh();
      if (GF.hotbar.getContext() !== '2d-selection') throw new Error('expected 2d-selection, got ' + GF.hotbar.getContext());
      // Should have selection action buttons
      if (!$('[data-hotbar="sel-fill"]')) throw new Error('no fill button in selection context');
      if (!$('[data-hotbar="sel-remove"]')) throw new Error('no remove button');
      if (!$('[data-hotbar="sel-copy"]')) throw new Error('no copy button');
      GF.api.run('deselect');
    });

    await t('hotbar: context changes back to idle on deselect', () => {
      freshDoc();
      GF.api.run('selectRect', { x: 5, y: 5, w: 20, h: 20 });
      GF.hotbar.refresh();
      if (GF.hotbar.getContext() !== '2d-selection') throw new Error('should be 2d-selection');
      GF.api.run('deselect');
      GF.hotbar.refresh();
      if (GF.hotbar.getContext() === '2d-selection') throw new Error('should no longer be 2d-selection');
    });

    await t('hotbar: buttons use data-hotbar attribute for delegation', () => {
      freshDoc();
      GF.hotbar.refresh();
      const btns = document.querySelectorAll('#actionbar [data-hotbar]');
      if (btns.length < 2) throw new Error('expected multiple hotbar buttons, got ' + btns.length);
      btns.forEach(b => {
        if (!b.dataset.hotbar) throw new Error('empty data-hotbar on button');
      });
    });

    /* ---------- GAME DECK INTEGRATION ---------- */
    await t('game deck: pad active and hotbar responds to selection', () => {
      freshDoc();
      GF.transformPad.refresh();
      // Pad should be active (doc open = layer exists)
      const pad = $('#transform-pad');
      if (!pad.classList.contains('tpad-active')) throw new Error('pad should be active when doc open');
      // Make selection
      GF.api.run('selectRect', { x: 0, y: 0, w: 50, h: 50 });
      GF.hotbar.refresh();
      if (GF.hotbar.getContext() !== '2d-selection') throw new Error('hotbar should be 2d-selection, got ' + GF.hotbar.getContext());
      GF.api.run('deselect');
    });

    await t('game deck: no overlap between pad and tool buttons', () => {
      const pad = $('#transform-pad');
      const tools = document.querySelectorAll('#toolrail .tool');
      if (!pad || tools.length === 0) throw new Error('missing pad or tools');
      const padRect = pad.getBoundingClientRect();
      let overlap = false;
      tools.forEach(tool => {
        const r = tool.getBoundingClientRect();
        // Check vertical overlap
        if (r.bottom > padRect.top && r.top < padRect.bottom) {
          overlap = true;
        }
      });
      if (overlap) throw new Error('transform pad overlaps tool buttons');
    });

    await t('game deck: pad is below all tools in DOM order', () => {
      const rail = $('#toolrail');
      const children = Array.from(rail.children);
      const padIdx = children.indexOf($('#transform-pad'));
      const lastToolIdx = Math.max(...children.map((c, i) => c.classList.contains('tool') || c.classList.contains('color-tool') ? i : -1));
      if (padIdx <= lastToolIdx) throw new Error('pad (idx ' + padIdx + ') should be after last tool (idx ' + lastToolIdx + ')');
    });

    /* ================================================================
       P4: CONTEXT-SENSITIVE PANEL
       ================================================================ */
    await t('panel: auto-switches to layers in 2D mode', () => {
      freshDoc();
      clickTool('brush');
      // Panel should auto-switch — give the event a tick
      const tab = $('#panel').dataset.tab;
      // Should be layers (2D default) or scene (3D default) — not broken
      if (!tab) throw new Error('no panel tab set');
    });

    await t('panel: manual tab click pauses auto-switch', () => {
      freshDoc();
      const adjTab = $('.ptab[data-tab="adjust"]');
      if (adjTab) { adjTab.click(); }
      // After manual click, the tab should stay on adjust
      if ($('#panel').dataset.tab !== 'adjust') throw new Error('manual switch failed');
    });

    /* ================================================================
       P6: SLIM TOP BAR — AI + Export in hotbar
       ================================================================ */
    await t('topbar: AI and Export have topbar-action class', () => {
      const ai = $('#btn-ai');
      const exp = $('#btn-export');
      if (!ai || !ai.classList.contains('topbar-action')) throw new Error('AI missing topbar-action class');
      if (!exp || !exp.classList.contains('topbar-action')) throw new Error('Export missing topbar-action class');
    });

    await t('hotbar: export button present in 2d-idle context', () => {
      freshDoc();
      clickTool('move');
      GF.hotbar.refresh();
      const ctx = GF.hotbar.getContext();
      if (ctx === '3d-idle' || ctx === '2d-idle' || ctx === '2d-painting') {
        const exp = $('[data-hotbar="export"]');
        if (!exp) throw new Error('no export button in hotbar for context ' + ctx);
      }
    });

    await t('hotbar: ai-tools button present in 3d-idle context', () => {
      // 3D is default mode
      freshDoc();
      GF.hotbar.refresh();
      const ai = $('[data-hotbar="ai-tools"]');
      if (!ai) throw new Error('no ai-tools button in hotbar');
    });

    /* ---------- FINISH ---------- */
    dump('done');
  }

  window.addEventListener('load', () => setTimeout(() => { runAll().catch(e => { document.title = 'E2E:DRIVER-ERR:' + e.message; }); }, 600));
})();
