/* PixelTriks — USER-FLOW audit (3D-only build).
   Drives the real app the way a person would and captures every
   console.error/warn, uncaught error, and promise rejection — TAGGED with the
   flow step that triggered it. Writes a JSON report to #RESULTS. */
(function () {
  const $ = s => document.querySelector(s);
  const log = []; let cur = 'boot';
  const rec = (level, msg) => log.push({ step: cur, level, msg: String(msg).slice(0, 240) });

  console.error = (...a) => rec('console.error', a.join(' '));
  console.warn = (...a) => rec('console.warn', a.join(' '));
  window.addEventListener('error', e => rec('uncaught', (e.message || '') + ' @' + ((e.filename || '').split('/').pop()) + ':' + e.lineno));
  window.addEventListener('unhandledrejection', e => rec('promise', (e.reason && e.reason.message) || e.reason));

  Element.prototype.setPointerCapture = function () {};
  Element.prototype.releasePointerCapture = function () {};

  const raf = () => new Promise(r => setTimeout(r, 0));
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

  async function run() {
    await step('boot: shell + 3D engine present', () => {
      for (const k of ['api', 'commands', 'scene3d', 'scene3dUI', 'ui'])
        if (!GF[k]) throw new Error('missing GF.' + k);
    });

    const webgl = (() => { try { return !!document.createElement('canvas').getContext('webgl2'); } catch (e) { return false; } })();
    const engineReady = webgl && !!window.__THREE_BUNDLE;
    if (engineReady) {
      await step('3d: enter workspace', async () => { await GF.scene3d.enter(); });
      await step('3d: add primitives via hotbar', () => {
        const b = $('[data-hotbar="add-box"]'); if (b) b.click();
        const s = $('[data-hotbar="add-sphere"]'); if (s) s.click();
      });
      await step('3d: select + transform', () => {
        const id = GF.scene3d.listObjects()[0] && GF.scene3d.listObjects()[0].id;
        if (id != null) { GF.scene3d.select(id); GF.scene3d.setObject(id, { px: 0.4 }); }
      });
      await step('3d: apply procedural texture', () => {
        const id = GF.scene3d.selectedId();
        const cnv = GF.library.generateProcedural('wood', 64, 64);
        if (id != null && cnv) GF.scene3d.setMaterial(id, { mapSource: GF.scene3d.addImageSource(cnv, 'wood') });
      });
      await step('3d: export view as PNG', async () => { await GF.scene3d.exportViewPng(); });
      await step('3d: undo / redo', () => { GF.api.run('undo'); GF.api.run('redo'); });
    } else {
      rec('soft', 'WebGL/three unavailable — 3D flow skipped');
    }

    await step('shell: command palette', () => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true }));
      const i = $('.cmdk-input');
      if (i) { i.value = 'export'; i.dispatchEvent(new Event('input')); i.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })); }
    });
    await step('shell: panel tabs', () => {
      $('.ptab[data-tab="assets"]').click();
      $('.ptab[data-tab="scene"]').click();
    });
    await step('shell: menu open / close', () => {
      $('#btn-menu').click();
      const m = $('.fs-modal');
      if (m) Array.prototype.find.call(m.querySelectorAll('.text-btn'), b => /Close/.test(b.textContent)).click();
    });
    await step('shell: theme toggle', () => { $('#btn-theme').click(); });
    dumpNow('done');
  }

  window.addEventListener('load', () => setTimeout(() => {
    run().catch(e => { document.title = 'FLOW:DRIVER-ERR:' + e.message; });
  }, 600));
})();
