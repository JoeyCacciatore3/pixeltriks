/* Forge Studio — USER-FLOW audit.
   Drives the real app the way a person would: genuine PointerEvent drags through
   the engine's input pipeline (brush strokes, marquee, move, shape, crop handles),
   real dialogs, real keyboard. Captures every console.error/warn, uncaught error,
   and promise rejection — TAGGED with the flow step that triggered it — so we can
   pinpoint exact failures. Writes a JSON report to #RESULTS. */
(function () {
  const U = GF.util, D = GF.doc;
  const $ = s => document.querySelector(s), $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const log = []; let cur = 'boot';
  const rec = (level, msg) => log.push({ step: cur, level, msg: String(msg).slice(0, 240) });

  console.error = (...a) => rec('console.error', a.join(' '));
  console.warn = (...a) => rec('console.warn', a.join(' '));
  window.addEventListener('error', e => rec('uncaught', (e.message || '') + ' @' + ((e.filename || '').split('/').pop()) + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => rec('promise', (e.reason && e.reason.message) || e.reason));

  // Real browsers capture synthetic-free; headless throws on setPointerCapture for
  // synthetic events. Stub so we test the TOOL logic, not a harness artifact.
  Element.prototype.setPointerCapture = function () {};
  Element.prototype.releasePointerCapture = function () {};

  const raf = () => new Promise(r => setTimeout(r, 0)); // reliable yield (headless throttles rAF when not painting)
  async function step(label, fn) { cur = label; document.title = '@' + label; try { await fn(); } catch (e) { rec('throw', (e && e.message) || e); } await raf(); }

  let dumped = false;
  function dumpNow(tag) {
    if (dumped) return; dumped = true;
    const issues = log.filter(e => ['console.error', 'console.warn', 'uncaught', 'promise', 'throw'].indexOf(e.level) >= 0);
    const soft = log.filter(e => e.level === 'soft');
    const pre = document.createElement('pre'); pre.id = 'RESULTS';
    pre.textContent = JSON.stringify({ tag, lastStep: cur, issues, soft }, null, 1);
    document.body.appendChild(pre);
    document.title = 'FLOW:' + (tag === 'done' ? '' : '[' + tag + '@' + cur + '] ') + (issues.length ? issues.length + ' ISSUES' : 'CLEAN') + (soft.length ? ' (+' + soft.length + ' soft)' : '');
  }
  setTimeout(() => dumpNow('watchdog'), 22000);

  const vpRect = () => $('#viewport').getBoundingClientRect();
  const pt = (fx, fy) => { const r = vpRect(); return { clientX: Math.round(r.left + r.width * fx), clientY: Math.round(r.top + r.height * fy) }; };
  const PE = (type, p, extra) => new PointerEvent(type, Object.assign({ pointerId: 1, isPrimary: true, pointerType: 'mouse', bubbles: true, cancelable: true, button: 0, buttons: type === 'pointerup' ? 0 : 1 }, p, extra));
  const onEl = (el, type, p, extra) => el.dispatchEvent(PE(type, p, extra));
  function down(p, extra) { onEl($('#viewport'), 'pointerdown', p, extra); }
  function move(p) { onEl($('#viewport'), 'pointermove', p); }
  function up(p) { onEl($('#viewport'), 'pointerup', p); }
  async function drag(a, b, steps) {
    steps = steps || 6; down(a);
    for (let i = 1; i <= steps; i++) move({ clientX: a.clientX + (b.clientX - a.clientX) * i / steps, clientY: a.clientY + (b.clientY - a.clientY) * i / steps });
    up(b); await raf();
  }
  const tool = t => $(`#toolrail .tool[data-tool=${t}]`).click();

  /* --- touch + pinch helpers (mobile) --- */
  const TOUCH_OK = (() => { try { new Touch({ identifier: 0, target: document.body, clientX: 0, clientY: 0 }); return typeof TouchEvent === 'function'; } catch (e) { return false; } })();
  function fireTouch(type, pts) {
    const vp = $('#viewport');
    const touches = pts.map((p, i) => new Touch({ identifier: i + 1, target: vp, clientX: p.clientX, clientY: p.clientY, pageX: p.clientX, pageY: p.clientY }));
    const live = type === 'touchend' ? [] : touches;
    vp.dispatchEvent(new TouchEvent(type, { touches: live, targetTouches: live, changedTouches: touches, bubbles: true, cancelable: true }));
  }
  function tapFingers(n) { const c = pt(.5, .5); const pts = []; for (let i = 0; i < n; i++) pts.push({ clientX: c.clientX + i * 20, clientY: c.clientY }); fireTouch('touchstart', pts); fireTouch('touchend', pts); }
  function pinch(fromGap, toGap) {
    const vp = $('#viewport'), c = pt(.5, .5);
    const at = (id, g) => ({ clientX: c.clientX + (id === 1 ? -g / 2 : g / 2), clientY: c.clientY });
    vp.dispatchEvent(PE('pointerdown', at(1, fromGap), { pointerId: 1, pointerType: 'touch' }));
    vp.dispatchEvent(PE('pointerdown', at(2, fromGap), { pointerId: 2, pointerType: 'touch' }));
    for (let i = 1; i <= 6; i++) { const g = fromGap + (toGap - fromGap) * i / 6; vp.dispatchEvent(PE('pointermove', at(1, g), { pointerId: 1, pointerType: 'touch' })); vp.dispatchEvent(PE('pointermove', at(2, g), { pointerId: 2, pointerType: 'touch' })); }
    vp.dispatchEvent(PE('pointerup', at(1, toGap), { pointerId: 1, pointerType: 'touch', buttons: 0 }));
    vp.dispatchEvent(PE('pointerup', at(2, toGap), { pointerId: 2, pointerType: 'touch', buttons: 0 }));
  }

  function scene() {
    GF.api.run('newDoc', { w: 600, h: 400, bg: 'white' });
    const c = U.ctx2d(D.active().canvas);
    const g = c.createLinearGradient(0, 0, 600, 400); g.addColorStop(0, '#6ccaa0'); g.addColorStop(1, '#244c99');
    c.fillStyle = g; c.fillRect(0, 0, 600, 400);
    c.fillStyle = '#e23a3a'; c.beginPath(); c.arc(300, 200, 80, 0, 7); c.fill();
    c.fillStyle = '#ffcc00'; c.fillRect(60, 60, 90, 90);
    GF.ui.onDocumentOpened();
  }

  async function runDesktop() {
    // Default UI is now "simple"; force Pro so hidden tools (Fill/Shape/Eyedropper)
    // and the More panel are present for the full desktop flow.
    await step('force Pro interface for full-surface flow', () => { if (document.body.dataset.ui !== 'pro') { const b = $('#btn-simple'); if (b) b.click(); } });
    /* --- edge: everything must be safe BEFORE a document exists --- */
    await step('no-doc: tools + hero + palette are safe', () => {
      ['brush', 'move', 'crop', 'select', 'fill', 'text', 'wand'].forEach(t => tool(t));
      const p = pt(.5, .5); down(p); up(p);                 // a click on the empty canvas
      $('#hero-enhance').click(); $('#hero-removebg').click(); $('#hero-erase').click();
      $('#lyr-add').click(); $('#lyr-fx').click(); const m = $('.fs-modal'); if (m) Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => /Close|Cancel/.test(b.textContent)).click();
      $('#btn-undo').click(); $('#btn-redo').click();
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      const i = $('.cmdk-input'); if (i) i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });

    await step('open document', () => { scene(); if (!D.doc.open) throw new Error('doc not open'); });

    /* --- pointer-driven tools (the real input pipeline) --- */
    await step('brush stroke (drag)', async () => { tool('brush'); const ci = $('#brush-color'); ci.value = '#ff2299'; ci.dispatchEvent(new Event('input')); const before = D.active().canvas.toDataURL(); await drag(pt(.2, .3), pt(.7, .65), 10); if (D.active().canvas.toDataURL() === before) throw new Error('brush left no marks'); });
    await step('eraser stroke (drag)', async () => { tool('eraser'); await drag(pt(.3, .7), pt(.65, .72), 8); });
    await step('flood fill (click)', () => { tool('fill'); const p = pt(.88, .12); down(p); up(p); });
    await step('eyedropper pick (click)', () => { tool('eyedropper'); const p = pt(.5, .5); down(p); up(p); });
    await step('magic wand select (click)', () => { tool('wand'); const p = pt(.5, .5); down(p); up(p); if (!GF.select.has()) throw new Error('wand selected nothing'); });
    await step('marquee select (drag)', async () => { tool('select'); await drag(pt(.15, .2), pt(.55, .7), 8); if (!GF.select.has()) throw new Error('marquee selected nothing'); GF.api.run('deselect'); });
    await step('move layer (drag)', async () => { tool('move'); const x0 = D.active().x; await drag(pt(.5, .5), pt(.42, .56), 8); if (D.active().x === x0) rec('soft', 'move did not change layer x'); });
    await step('shape draw (drag)', async () => { tool('shape'); const n = D.doc.layers.length; await drag(pt(.2, .2), pt(.4, .45), 8); void n; });
    await step('text place -> dialog -> add', () => {
      tool('text'); const p = pt(.3, .3); down(p); up(p);
      const m = $('.fs-modal'); if (!m || !m.querySelector('#m-text')) throw new Error('text dialog did not open');
      m.querySelector('#m-text').value = 'Hello'; Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => /Add/.test(b.textContent)).click();
    });

    /* --- crop: real handle drag + aspect + straighten + apply --- */
    await step('crop: overlay + handle drag + aspect + apply', () => {
      tool('crop'); const ov = $('#crop-overlay'); if (!ov) throw new Error('crop overlay missing');
      const seBtn = $('#crop-aspect button[data-v="1"]'); if (seBtn) seBtn.click();
      const handle = $('.crop-h.se'); if (!handle) throw new Error('no crop handle');
      const hr = handle.getBoundingClientRect(), sx = hr.left + 7, sy = hr.top + 7;
      onEl(handle, 'pointerdown', { clientX: sx, clientY: sy });
      onEl(ov, 'pointermove', { clientX: sx - 40, clientY: sy - 30 });
      onEl(window, 'pointerup', { clientX: sx - 40, clientY: sy - 30 });
      $('#crop-apply').click();
      if ($('#crop-overlay')) throw new Error('crop overlay did not close after apply');
    });

    /* --- view: zoom wheel, pan via space+drag --- */
    await step('zoom (wheel)', () => { const p = pt(.5, .5); $('#viewport').dispatchEvent(new WheelEvent('wheel', { deltaY: -120, clientX: p.clientX, clientY: p.clientY, bubbles: true, cancelable: true })); });
    await step('pan (space + drag)', async () => { window.dispatchEvent(new KeyboardEvent('keydown', { code: 'Space' })); await drag(pt(.5, .5), pt(.6, .55), 6); window.dispatchEvent(new KeyboardEvent('keyup', { code: 'Space' })); });

    /* --- adjust panel: sliders, compare, apply --- */
    await step('adjust sliders + compare + apply', () => {
      $('.ptab[data-tab=adjust]').click();
      ['exposure', 'contrast', 'saturation', 'vibrance', 'warmth', 'clarity'].forEach(k => { const e = $(`#adj-sliders input[data-k=${k}]`); if (!e) throw new Error('missing slider ' + k); e.value = 25; e.dispatchEvent(new Event('input')); });
      const cmp = $('#adj-compare'); cmp.dispatchEvent(new PointerEvent('pointerdown')); cmp.dispatchEvent(new PointerEvent('pointerup'));
      $('#adj-apply').click();
    });
    await step('filters (apply 3)', () => { $$('#filter-strip .filter-chip').slice(0, 3).forEach(c => c.click()); });

    /* --- hero actions --- */
    await step('auto-enhance', () => $('#hero-enhance').click());
    await step('remove background', () => $('#hero-removebg').click());
    await step('magic erase (with selection)', () => { GF.api.run('selectRect', { x: 40, y: 40, w: 90, h: 90 }); $('#hero-erase').click(); GF.api.run('deselect'); });
    await step('generative fill dialog open/close', () => { $('#hero-genfill').click(); const m = $('.fs-modal'); if (m) Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => /Cancel|Run/.test(b.textContent)).click(); });

    /* --- adjustment layers --- */
    await step('add + edit adjustment layer', () => {
      $('.ptab[data-tab=layers]').click(); $('#lyr-fx').click();
      $('.fs-modal [data-k=brightnessContrast]').click();
      const ed = $('.fs-modal'); const b = ed.querySelector('input[data-k=brightness]'); b.value = 40; b.dispatchEvent(new Event('input'));
      ed.querySelector('.text-btn.primary').click();
    });
    await step('adjustment layer active: move + brush must not crash (canvas=null)', async () => {
      $('#lyr-fx').click(); $('.fs-modal [data-k=curves]').click(); $('.fs-modal .text-btn.primary').click();
      tool('move'); await drag(pt(.5, .5), pt(.45, .5), 4);   // render with Move tool over an adjustment layer (regression: tools.js:169)
      tool('brush'); const p = pt(.4, .4); down(p); move(pt(.5, .5)); up(pt(.5, .5)); // brushing onto an adjustment layer
      const del = $('#lyr-del'); if (del) del.click();
    });
    await step('layers ops (add/dup/blend/opacity/vis/merge/del)', () => {
      $('#lyr-add').click(); $('#lyr-dup').click();
      const sel = $('#lyr-blend'); sel.value = 'multiply'; sel.dispatchEvent(new Event('change'));
      const o = $('#lyr-opacity'); o.value = 60; o.dispatchEvent(new Event('input'));
      const vis = document.querySelector('#layer-list .layer-item .layer-vis'); if (vis) vis.click();
      $('#lyr-merge').click(); $('#lyr-del').click();
    });

    /* --- history, undo/redo, palette --- */
    await step('history panel jump', () => { $('.ptab[data-tab=pro]').click(); const items = $$('#history-list .hist-item'); if (items.length > 2) items[1].click(); });
    await step('undo/redo (keyboard)', () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true })); window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, shiftKey: true })); });
    await step('command palette run', () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); const i = $('.cmdk-input'); if (!i) throw new Error('palette not open'); i.value = 'fit to screen'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });

    /* --- dialogs / modes / export --- */
    await step('image size resize', () => { $('#btn-menu').click(); $('.fs-modal [data-a=size]').click(); const m = $('.fs-modal'); m.querySelector('#is-lock').click(); m.querySelector('#is-w').value = 480; Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => /Resize/.test(b.textContent)).click(); });
    await step('open Sprite mode overlay + back', () => { $('[data-mode-open=sprite]').click(); if (!$('#mode-overlay iframe')) throw new Error('mode overlay no iframe'); $('#mode-back').click(); });
    await step('export PNG', async () => { const b = await GF.exporter.exportImage({ type: 'image/png', scale: 1, quality: .9 }); if (!b || !b.size) throw new Error('no blob'); });
    await step('theme toggle x2', () => { $('#btn-theme').click(); $('#btn-theme').click(); });
    await step('cheat sheet open/close', () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' })); const m = $('.fs-modal .cheat'); if (!m) throw new Error('no cheat sheet'); document.querySelector('.fs-modal .text-btn').click(); });

    /* --- finish --- */
    dumpNow('done');
  }

  /* ============================ MOBILE / TOUCH PASS ============================ */
  async function runMobile() {
    await step('mobile: layout active', () => {
      if (!matchMedia('(max-width: 880px)').matches) throw new Error('not in mobile layout');
      if (getComputedStyle($('#panel-toggle')).display === 'none') rec('soft', 'panel-toggle FAB hidden at this width');
    });
    await step('open document', () => { scene(); if (!D.doc.open) throw new Error('doc not open'); });
    await step('bottom toolbar: pick tools', () => { ['brush', 'eraser', 'fill', 'select', 'move'].forEach(tool); if (GF.view.view.tool !== 'move') throw new Error('tool not set from bottom bar'); });
    await step('one-finger draw (touch pointer)', async () => {
      tool('brush'); const before = D.active().canvas.toDataURL();
      down(pt(.25, .4), { pointerType: 'touch' }); move(pt(.5, .5)); move(pt(.7, .6)); up(pt(.7, .6), { pointerType: 'touch' }); await raf();
      if (D.active().canvas.toDataURL() === before) rec('soft', 'one-finger draw left no marks');
    });
    await step('pinch zoom (two touch pointers)', () => { tool('move'); const z0 = GF.view.view.zoom; pinch(120, 280); if (GF.view.view.zoom === z0) rec('soft', 'pinch did not change zoom'); });
    await step('two-finger tap = undo', () => {
      if (!TOUCH_OK) return rec('soft', 'TouchEvent not constructible — gesture skipped');
      GF.api.run('paint', { points: [[10,10],[60,60]], size: 10, color: '#000' });
      const couldRedo = GF.history.canRedo();
      tapFingers(2);
      if (GF.history.canRedo() === couldRedo) rec('soft', '2-finger tap did not undo');
    });
    await step('three-finger tap = redo', () => { if (!TOUCH_OK) return; tapFingers(3); });
    await step('bottom sheet open / close', () => {
      $('#panel-toggle').click();
      if (!$('#panel').classList.contains('open')) throw new Error('sheet did not open');
      if (!document.body.classList.contains('sheet-open')) throw new Error('missing body.sheet-open');
      $('.panel-grip').click();
      if ($('#panel').classList.contains('open')) throw new Error('sheet did not close');
    });
    await step('sheet: adjust slider + apply', () => {
      $('#panel-toggle').click(); $('.ptab[data-tab=adjust]').click();
      const e = $('#adj-sliders input[data-k=exposure]'); e.value = 30; e.dispatchEvent(new Event('input')); $('#adj-apply').click();
      $('.panel-grip').click();
    });
    await step('touch companion (undo / fit / redo)', () => { ['#tc-undo', '#tc-fit', '#tc-redo'].forEach(id => { const b = $(id); if (!b) throw new Error('missing ' + id); b.click(); }); });
    await step('hamburger menu open / close', () => { $('#btn-menu').click(); const m = $('.fs-modal'); if (!m) throw new Error('menu did not open'); Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => /Close/.test(b.textContent)).click(); });
    await step('command palette (mobile)', () => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true })); const i = $('.cmdk-input'); if (i) { i.value = 'fit'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); } });
    await step('export PNG (mobile)', async () => { const b = await GF.exporter.exportImage({ type: 'image/png', scale: 1, quality: .9 }); if (!b || !b.size) throw new Error('no blob'); });
    dumpNow('done');
  }

  window.addEventListener('load', () => setTimeout(() => {
    const mobile = matchMedia('(max-width: 880px)').matches;
    (mobile ? runMobile : runDesktop)().catch(e => { document.title = 'FLOW:DRIVER-ERR:' + e.message; });
  }, 600));
})();
