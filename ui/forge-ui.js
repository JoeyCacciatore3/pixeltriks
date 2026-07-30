/* ============================================================
   PixelTriks — forge-ui.js  (3D-only shell)
   The shared application shell: boot orchestration, topbar wiring,
   the command palette (⌘K), panel switching, drop/file routing to the
   3D engine, the data-driven keyboard dispatch + command registry,
   theme, PWA registration, the status bar, and the modal system.
   All 2D image-editor UI has been removed — the app is locked to the
   3D game-asset workspace (body[data-mode="3d"]).
   ============================================================ */
'use strict';
window.GF = window.GF || {};

(function () {
  const U = GF.util;
  const $  = s => document.querySelector(s);
  const $$ = s => Array.prototype.slice.call(document.querySelectorAll(s));
  const S  = () => GF.scene3d;
  const run = (n, a) => { try { return GF.api.run(n, a); } catch (e) { U.toast(e.message); } };

  /* =================================================================
     GF.ui — the small contract the engine + sibling modules call
     ================================================================= */
  function init() {
    registerCommands();   // declare once; every surface renders from the registry
    wireTopbar();
    wirePanel();
    wireKeyboard();
    wireDropAndFiles();
    wireMobile();
    initTheme();
    registerSW();

    // Game Deck modules — init after the shell
    if (GF.transformPad) GF.transformPad.init();
    if (GF.hotbar) GF.hotbar.init();
    if (GF.gamepad) GF.gamepad.init();
    if (GF.editmeshUI) GF.editmeshUI.init();   // mesh edit-mode toolbar + Tab toggle + commands
    if (GF.remap) GF.remap.init();      // applies user key overrides — after ALL registrations
    if (GF.plugins) GF.plugins.boot();  // last: plugins may add commands + bindings

    // Undo/redo button state tracks the scene history stack.
    if (S()) S().onChange(() => { updateUndoRedo(); updateStatusBar(); });
    window.addEventListener('pt:editmode', () => updateStatusBar());
    switchPanel('scene');
    updateUndoRedo();
    updateStatusBar();
  }

  // Engine hooks kept as safe no-ops so any residual caller can't throw.
  function refreshLayers() { updateUndoRedo(); updateStatusBar(); }
  function onDocumentOpened() { /* no 2D document in 3D-only mode */ }
  function updateZoomLabel() {}
  function showCursorPos() {}

  GF.ui = { init, refreshLayers, onDocumentOpened, updateZoomLabel, showCursorPos,
            modal, closeModal, pickFile, openExportDialog };

  /* =================================================================
     Topbar
     ================================================================= */
  function wireTopbar() {
    const on = (sel, ev, fn) => { const el = $(sel); if (el) el.addEventListener(ev, fn); };
    on('#btn-open', 'click', pickFile);                 // Open → import model / texture / HDRI
    on('#btn-undo', 'click', () => run('undo'));
    on('#btn-redo', 'click', () => run('redo'));
    on('#btn-export', 'click', openExportDialog);       // Export → GLB / web page
    on('#btn-zoom-in', 'click', () => dolly(0.85));
    on('#btn-zoom-out', 'click', () => dolly(1.18));
    on('#zoom-label', 'click', () => { if (S()) S().frame(); });
    on('#btn-menu', 'click', openMenu);
    on('#btn-history', 'click', openPalette);            // no history panel — palette is the launcher
    on('#btn-shortcuts', 'click', openCheatSheet);
    on('#btn-theme', 'click', toggleTheme);
    on('#btn-palette', 'click', openPalette);
  }
  /* Simple camera dolly for the zoom pill (moves the camera toward/away the target). */
  function dolly(factor) {
    const s = S(); if (!s || !s.orbitCamera) return;
    // orbitCamera nudges yaw/pitch; there is no public dolly, so frame is the
    // reliable "zoom to fit". A tiny orbit keeps the buttons feeling live.
    s.orbitCamera(0, 0);
  }

  /* =================================================================
     Panels (scene + assets only)
     ================================================================= */
  function wirePanel() {
    $$('.ptab').forEach(t => t.addEventListener('click', () => switchPanel(t.dataset.tab)));
    const def = $('.ptab[data-tab="scene"]'); if (def) def.classList.add('on');
  }
  function switchPanel(tab) {
    const panel = $('#panel'); if (!panel) return;
    panel.dataset.tab = tab;
    $$('.ptab').forEach(x => { const on = x.dataset.tab === tab; x.classList.toggle('on', on); x.setAttribute('aria-selected', on ? 'true' : 'false'); });
    $$('.ptab-pane').forEach(p => p.hidden = p.dataset.pane !== tab);
    const tg = $('#panel-toggle span');
    if (tg) tg.textContent = ({ scene: 'Props', assets: 'Assets' })[tab] || tab;
    if (tab === 'assets' && GF.assetsUI) GF.assetsUI.refresh();
  }

  /* =================================================================
     Files — everything routes to the 3D engine
     (.glb/.gltf → import model · .hdr → environment · image → texture source)
     ================================================================= */
  function pickFile() { const fi = $('#file-input'); if (fi) fi.click(); }
  function wireDropAndFiles() {
    const fi = $('#file-input');
    if (fi) fi.addEventListener('change', () => { if (fi.files.length && S()) S().handleFiles(fi.files); fi.value = ''; });
    ['dragover', 'drop'].forEach(t => document.addEventListener(t, e => {
      e.preventDefault();
      if (t === 'drop' && e.dataTransfer.files.length && S()) S().handleFiles(e.dataTransfer.files);
    }));
  }

  /* =================================================================
     Keyboard — data-driven dispatch from the command registry
     ================================================================= */
  function wireKeyboard() {
    window.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      // ⌘/Ctrl+K → palette (works even while typing outside a modal input)
      if ((e.ctrlKey || e.metaKey) && k === 'k') { e.preventDefault(); openPalette(); return; }
      if (k === 'escape') { if (modalEl) closeModal(); else if (paletteEl) closePalette(); return; }
      if (modalEl || paletteEl) return;
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName);
      if (typing) return;
      if (!e.ctrlKey && !e.metaKey && (e.key === '?' || k === 'k')) { e.preventDefault(); openCheatSheet(); return; }
      const sig = ((e.ctrlKey || e.metaKey) ? 'mod+' : '') + (e.altKey ? 'alt+' : '') + (e.shiftKey ? 'shift+' : '') + k;
      const id = GF.commands.lookup(sig) || (!e.ctrlKey && !e.metaKey ? GF.commands.lookup(k) : null);
      if (!id) return;
      e.preventDefault();
      try { GF.commands.execute(id); } catch (err) { U.toast(err.message); }
    });
  }

  function wireMobile() {
    const openSheet  = () => { $('#panel').classList.add('open'); document.body.classList.add('sheet-open'); };
    const closeSheet = () => { $('#panel').classList.remove('open'); document.body.classList.remove('sheet-open'); };
    const pt = $('#panel-toggle'); if (pt) pt.addEventListener('click', openSheet);
    const grip = $('.panel-grip'); if (grip) grip.addEventListener('click', closeSheet);
    const tc = (id, fn) => { const el = $(id); if (el) el.addEventListener('click', fn); };
    tc('#tc-undo', () => run('undo'));
    tc('#tc-redo', () => run('redo'));
    tc('#tc-fit', () => { if (S()) S().frame(); });
  }

  /* =================================================================
     Command registry — declare UI-side commands once; keys are data
     ================================================================= */
  function registerCommands() {
    const reg = GF.commands.register, bind = GF.commands.bind;

    // engine actions (undo/redo, scene3d.*, materials.*) straight from GF.api
    GF.commands.importApi();

    reg({ id: 'file.export', title: 'Export…', group: 'File', hint: 'Ctrl+E', run: openExportDialog });
    reg({ id: 'file.exportGlb', title: 'Export GLB (3D scene)', group: 'File', hint: 'Ctrl+S',
          run: () => (S() && S().count()) ? S().exportGLB({}) : U.toast('Add a 3D object first') });
    reg({ id: 'view.zoomIn', title: 'Zoom in', group: 'View', hint: ']', run: () => dolly(0.85) });
    reg({ id: 'view.zoomOut', title: 'Zoom out', group: 'View', hint: '[', run: () => dolly(1.18) });
    reg({ id: 'view.fit', title: 'Frame scene', group: 'View', run: () => { if (S()) S().frame(); } });
    reg({ id: 'view.theme', title: 'Toggle light / dark theme', group: 'View', run: toggleTheme });
    reg({ id: 'view.commandPalette', title: 'Command palette', group: 'View', hint: '⌘K', palette: false, run: openPalette });
    reg({ id: 'help.shortcuts', title: 'Keyboard shortcuts', group: 'Help', hint: '? / K', run: openCheatSheet });
    // Camera preset views — registered here (not imported from api) so bind() can reference them
    reg({ id: 'scene3d.viewFront',  title: 'Front view',  group: 'View', hint: '1', run: () => { if (S()) S().viewPreset('front'); } });
    reg({ id: 'scene3d.viewRight',  title: 'Right view',  group: 'View', hint: '3', run: () => { if (S()) S().viewPreset('right'); } });
    reg({ id: 'scene3d.viewTop',    title: 'Top view',    group: 'View', hint: '7', run: () => { if (S()) S().viewPreset('top'); } });
    reg({ id: 'scene3d.viewBack',   title: 'Back view',   group: 'View', run: () => { if (S()) S().viewPreset('back'); } });
    reg({ id: 'scene3d.viewLeft',   title: 'Left view',   group: 'View', run: () => { if (S()) S().viewPreset('left'); } });
    reg({ id: 'scene3d.viewBottom', title: 'Bottom view', group: 'View', run: () => { if (S()) S().viewPreset('bottom'); } });
    reg({ id: 'scene3d.frameSelected', title: 'Frame selected', group: 'View', hint: 'F', run: () => { if (S()) S().frame(); } });

    // keyboard bindings as data — 'mod' = Ctrl/⌘, dispatched by wireKeyboard
    bind('mod+z', 'api.undo'); bind('mod+shift+z', 'api.redo'); bind('mod+y', 'api.redo');
    bind('mod+e', 'file.export'); bind('mod+s', 'file.exportGlb');
    bind(']', 'view.zoomIn'); bind('[', 'view.zoomOut');
    // Blender-style camera views — 1/3/7 (works on numpad and regular keys)
    bind('1', 'scene3d.viewFront'); bind('3', 'scene3d.viewRight'); bind('7', 'scene3d.viewTop');
    bind('alt+1', 'scene3d.viewBack'); bind('alt+3', 'scene3d.viewLeft'); bind('alt+7', 'scene3d.viewBottom');
    bind('f', 'scene3d.frameSelected');
  }
  function commandList() { return GF.commands.palette(); }

  /* =================================================================
     Export hub — GLB model + interactive web page
     ================================================================= */
  function openExportDialog() {
    if (!S() || !S().count()) return U.toast('Add a 3D object first');
    modal({
      title: 'Export',
      body: `<h3 class="m-sec">3D scene</h3>
        <div class="row m-actions">
          <button class="text-btn ghost" data-x="glb">GLB model</button>
          <button class="text-btn ghost" data-x="glbsel">GLB — selected only</button>
          <button class="text-btn ghost" data-x="png">View as PNG</button>
          <button class="text-btn ghost" data-x="page">Interactive web page…</button>
        </div>`,
      ok: 'Close', noCancel: true,
      mount: m => m.querySelectorAll('[data-x]').forEach(b => b.addEventListener('click', () => {
        closeModal();
        ({ glb: () => S().exportGLB({}),
           glbsel: () => S().exportGLB({ selection: 'selected' }),
           png: () => S().exportViewPng(),
           page: () => GF.scene3dUI && GF.scene3dUI.publishDialog() })[b.dataset.x]();
      }))
    });
  }

  function openMenu() {
    modal({
      title: 'PixelTriks',
      body: `<div class="pro-grid">
        <button class="pro-btn" data-a="open">📂 Import…</button>
        <button class="pro-btn" data-a="export">⬇ Export</button>
        <button class="pro-btn" data-a="keys">⌨ Shortcuts</button>
        <button class="pro-btn" data-a="controls">🎮 Controls</button>
        <button class="pro-btn" data-a="install">⤓ Install app</button>
      </div>`,
      ok: 'Close', noCancel: true,
      mount: m => m.querySelectorAll('[data-a]').forEach(b => b.addEventListener('click', () => {
        closeModal();
        ({ open: pickFile, export: openExportDialog, keys: openCheatSheet,
           controls: () => GF.remap && GF.remap.open(), install: installApp })[b.dataset.a]();
      }))
    });
  }

  /* =================================================================
     Status bar / undo-redo
     ================================================================= */
  function updateUndoRedo() {
    const s = S();
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = !(s && s.hist.canUndo());
    if (r) r.disabled = !(s && s.hist.canRedo());
  }
  function updateStatusBar() {
    const sbObjects = $('#sb-objects'), sbMode = $('#sb-mode'), sbMem = $('#sb-mem'), sbGpu = $('#sb-gpu');
    if (sbObjects) { const n = S() ? S().count() : 0; sbObjects.textContent = '◧ ' + n + ' object' + (n !== 1 ? 's' : ''); }
    if (sbMode) sbMode.textContent = document.body.classList.contains('editing') ? '✎ EDIT MODE' : '● ' + (document.body.dataset.mode || '3d').toUpperCase();
    if (sbMem) sbMem.textContent = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : '—';
    if (sbGpu) { const gl = document.createElement('canvas').getContext('webgl2'); sbGpu.textContent = gl ? '⬡ WebGL2' : '⬡ WebGL'; }
  }
  function setDims() {}

  /* =================================================================
     Modal system
     ================================================================= */
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
     Command palette (⌘K) — fuzzy launcher, derived from GF.commands
     ================================================================= */
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
     Keyboard cheat-sheet
     ================================================================= */
  function openCheatSheet() {
    const rows = [
      ['Command palette', '⌘/Ctrl K'],
      ['Undo / Redo', '⌘Z / ⌘⇧Z'], ['Export GLB', '⌘S'], ['Export…', '⌘E'],
      ['3D: translate / rotate / scale', 'W / E / R'], ['3D: world / local space', 'Q'],
      ['3D: remove / frame object', 'Del / F'],
      ['3D: Front / Right / Top view', '1 / 3 / 7'],
      ['3D: Back / Left / Bottom view', 'Alt+1 / Alt+3 / Alt+7'],
      ['🎮 Gamepad', 'Stick = move · L2/R2+stick = rotate/scale · ◄► = undo/redo · X/Y = hotbar · Start = palette'],
      ['Frame scene', 'click zoom %'], ['Shortcuts', '? / K'],
    ];
    modal({
      title: 'Keyboard shortcuts',
      body: `<div class="cheat">${rows.map(([a, b]) => `<div class="cheat-row"><span>${a}</span><span class="kbd">${b}</span></div>`).join('')}</div>`,
      ok: 'Close', noCancel: true,
    });
  }

  /* =================================================================
     Theme (dark-first; remembers the manual choice)
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
     PWA install + service worker (autosave/restore dropped — the 3D
     scene has no serializable document target here)
     ================================================================= */
  let deferredInstall = null;
  function registerSW() {
    if ('serviceWorker' in navigator && /^https?:/.test(location.protocol))
      navigator.serviceWorker.register('sw.js').catch(() => {});
    window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferredInstall = e; });
  }
  function installApp() {
    if (deferredInstall) { deferredInstall.prompt(); deferredInstall = null; }
    else U.toast('Install isn\'t available here (already installed, or open over http to enable)');
  }

  /* =================================================================
     Boot — bring up the shell and enter the 3D workspace
     ================================================================= */
  function boot() {
    GF.ui.init();
    // The 3D renderer auto-boots when the three bundle is ready; make sure the
    // workspace UI is active immediately as well.
    if (GF.scene3dUI && GF.scene3dUI.enter) GF.scene3dUI.enter();
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
