/* ============================================================
   PixelTriks — editmesh-ui.js  (GF.editmeshUI)
   Left-side edit panel: mode tabs, context-sensitive ops with
   descriptions, zones strip (face mode only), status line.
   Replaces the old bottom-floating bar that overlapped the viewport.
   ============================================================ */
'use strict';
window.GF = window.GF || {};

GF.editmeshUI = (function () {
  const U = GF.util;
  const EM = () => GF.editmesh;
  let panel = null, zonesSection = null;

  /* ── per-mode operation sets ─────────────────────────────── */
  const OP_DEFS = {
    vertex: [
      { id: 'grab',     label: 'Grab',     key: 'G',    desc: 'Move selected vertices',       run: () => EM().grab() },
      { id: 'rotate',   label: 'Rotate',   key: 'R',    desc: 'Rotate around selection',      run: () => EM().rotate() },
      { id: 'scale',    label: 'Scale',    key: 'S',    desc: 'Resize selection',             run: () => EM().scale() },
      { id: 'merge',    label: 'Merge',    key: 'M',    desc: 'Collapse verts to center',     run: () => EM().merge() },
      { id: 'dissolve', label: 'Dissolve', key: '⌃X',   desc: 'Remove without leaving hole',  run: () => EM().dissolve() },
      { id: 'delete',   label: 'Delete',   key: '⌫',    desc: 'Delete and leave a hole',      run: () => EM().deleteSelection() },
    ],
    edge: [
      { id: 'grab',     label: 'Grab',     key: 'G',    desc: 'Move selected edges',          run: () => EM().grab() },
      { id: 'rotate',   label: 'Rotate',   key: 'R',    desc: 'Rotate selection',             run: () => EM().rotate() },
      { id: 'scale',    label: 'Scale',    key: 'S',    desc: 'Resize selection',             run: () => EM().scale() },
      { id: 'bevel',    label: 'Bevel',    key: '⌃B',   desc: 'Chamfer / round edge',         run: () => EM().bevel() },
      { id: 'loopcut',  label: 'Loop Cut', key: '⌃R',   desc: 'Slice a new edge ring',        run: () => EM().loopcut() },
      { id: 'dissolve', label: 'Dissolve', key: '⌃X',   desc: 'Remove edge, merge faces',     run: () => EM().dissolve() },
      { id: 'delete',   label: 'Delete',   key: '⌫',    desc: 'Delete and leave a hole',      run: () => EM().deleteSelection() },
    ],
    face: [
      { id: 'grab',      label: 'Grab',      key: 'G',   desc: 'Move selected faces',          run: () => EM().grab() },
      { id: 'rotate',    label: 'Rotate',    key: 'R',   desc: 'Rotate selection',             run: () => EM().rotate() },
      { id: 'scale',     label: 'Scale',     key: 'S',   desc: 'Resize selection',             run: () => EM().scale() },
      { id: 'extrude',   label: 'Extrude',   key: 'E',   desc: 'Push / pull faces outward',    run: () => EM().extrude() },
      { id: 'inset',     label: 'Inset',     key: 'I',   desc: 'Shrink face inward',           run: () => EM().inset() },
      { id: 'subdivide', label: 'Subdivide', key: '',    desc: 'Split faces into smaller ones', run: () => EM().subdivide() },
      { id: 'delete',    label: 'Delete',    key: '⌫',   desc: 'Remove faces',                 run: () => EM().deleteSelection() },
    ],
  };

  const MODES = [
    { id: 'vertex', label: 'Verts', key: '1', tip: 'Select and move individual vertices' },
    { id: 'edge',   label: 'Edges', key: '2', tip: 'Select and cut edges' },
    { id: 'face',   label: 'Faces', key: '3', tip: 'Select and extrude faces' },
  ];

  /* ── init ───────────────────────────────────────────────── */
  function init() {
    injectStyle();
    registerCommands();
    buildPanel();
    window.addEventListener('pt:editmode', e => show(e.detail.active));
  }

  /* ── command registration (unchanged public API) ─────────── */
  function registerCommands() {
    const reg = GF.commands.register, bind = GF.commands.bind;
    reg({ id: 'mesh.editToggle', title: 'Edit mesh (enter / exit)', group: 'Mesh', hint: 'Tab', run: () => EM() && EM().toggle() });
    bind('tab', 'mesh.editToggle');
    MODES.forEach(m => reg({ id: 'mesh.mode.' + m.id, title: 'Edit: ' + m.label, group: 'Mesh', palette: false, run: () => EM() && EM().setMode(m.id) }));
    reg({ id: 'mesh.grab',      title: 'Grab (move) selection',        group: 'Mesh', hint: 'G',      run: () => EM() && EM().grab() });
    reg({ id: 'mesh.rotate',    title: 'Rotate selection',             group: 'Mesh', hint: 'R',      run: () => EM() && EM().rotate() });
    reg({ id: 'mesh.scale',     title: 'Scale selection',              group: 'Mesh', hint: 'S',      run: () => EM() && EM().scale() });
    reg({ id: 'mesh.extrude',   title: 'Extrude faces',                group: 'Mesh', hint: 'E',      run: () => EM() && EM().extrude() });
    reg({ id: 'mesh.inset',     title: 'Inset faces',                  group: 'Mesh', hint: 'I',      run: () => EM() && EM().inset() });
    reg({ id: 'mesh.bevel',     title: 'Bevel (chamfer edges)',        group: 'Mesh', hint: 'Ctrl+B', run: () => EM() && EM().bevel() });
    reg({ id: 'mesh.loopcut',   title: 'Loop cut',                     group: 'Mesh', hint: 'Ctrl+R', run: () => EM() && EM().loopcut() });
    reg({ id: 'mesh.subdivide', title: 'Subdivide',                    group: 'Mesh',                run: () => EM() && EM().subdivide() });
    reg({ id: 'mesh.merge',     title: 'Merge vertices',               group: 'Mesh', hint: 'M',      run: () => EM() && EM().merge() });
    reg({ id: 'mesh.dissolve',  title: 'Dissolve selection',           group: 'Mesh', hint: 'Ctrl+X', run: () => EM() && EM().dissolve() });
    reg({ id: 'mesh.delete',    title: 'Delete selection',             group: 'Mesh',                run: () => EM() && EM().deleteSelection() });
    reg({ id: 'mesh.newZone',   title: 'New material zone from faces', group: 'Mesh',                run: () => EM() && EM().addZone() });
  }

  /* ── DOM build ───────────────────────────────────────────── */
  function buildPanel() {
    panel = document.createElement('div');
    panel.id = 'em-panel';
    panel.hidden = true;
    panel.innerHTML = `
      <!-- header -->
      <div class="em-header">
        <span class="em-title">Edit Mode</span>
        <button class="em-exit-btn" id="em-exit" title="Exit edit mode (Tab)">Done ↩</button>
      </div>

      <!-- mode tabs -->
      <div class="em-section">
        <div class="em-section-label">SELECT</div>
        <div class="em-mode-row" id="em-modes">
          ${MODES.map(m => `
            <button class="em-mode-btn" data-mode="${m.id}" title="${m.tip}">
              <span class="em-mode-key">${m.key}</span>
              <span class="em-mode-label">${m.label}</span>
            </button>
          `).join('')}
        </div>
        <div class="em-tip" id="em-mode-tip">Click to select · A = select all · Click+drag box select</div>
      </div>

      <!-- ops (rebuilt per mode) -->
      <div class="em-section">
        <div class="em-section-label">OPERATIONS</div>
        <div class="em-ops" id="em-ops"></div>
      </div>

      <!-- zones (face mode only) -->
      <div class="em-section" id="em-zones-section" hidden>
        <div class="em-section-label">MATERIAL ZONES</div>
        <div class="em-swatches" id="em-swatches"></div>
        <div class="em-zone-actions">
          <button class="em-action-btn em-accent" id="em-newzone" title="Create a new material zone from the selected faces">＋ New zone</button>
          <button class="em-action-btn" id="em-assign" title="Assign selected faces to the active zone">Assign →</button>
        </div>
        <div class="em-zone-props" id="em-zone-props" hidden>
          <label class="em-prop-row">
            <span class="em-prop-label">Colour</span>
            <input type="color" id="em-zcolor" value="#e8a33d">
          </label>
          <label class="em-prop-row">
            <span class="em-prop-label">Texture</span>
            <select id="em-ztex"></select>
          </label>
          <button class="em-action-btn em-danger" id="em-delzone" title="Delete this zone">🗑 Delete zone</button>
        </div>
      </div>

      <!-- status line -->
      <div class="em-status" id="em-status">Tab to enter · click a mesh · Tab again to edit</div>
    `;

    document.body.appendChild(panel);

    /* exit */
    panel.querySelector('#em-exit').addEventListener('click', () => EM() && EM().exit());

    /* mode buttons */
    panel.querySelectorAll('[data-mode]').forEach(b =>
      b.addEventListener('click', () => EM() && EM().setMode(b.dataset.mode)));

    /* zones */
    zonesSection = panel.querySelector('#em-zones-section');
    panel.querySelector('#em-newzone').addEventListener('click', () => EM() && EM().addZone());
    panel.querySelector('#em-assign').addEventListener('click', () => EM() && EM().assignSelection());
    panel.querySelector('#em-zcolor').addEventListener('input', e => EM() && EM().setZone(EM().activeZone(), { color: e.target.value }));
    panel.querySelector('#em-ztex').addEventListener('change', e => EM() && EM().setZone(EM().activeZone(), { tex: e.target.value || null }));
    panel.querySelector('#em-delzone').addEventListener('click', () => EM() && EM().deleteZone(EM().activeZone()));
  }

  /* ── show / hide ─────────────────────────────────────────── */
  function show(on) {
    if (panel) panel.hidden = !on;
    document.body.classList.toggle('editing', !!on);
    /* BUG-035 fix: reset _texFilled so the dropdown rebuilds next time
       edit mode opens (presets may have changed between sessions) */
    if (!on) _texFilled = false;
  }

  /* ── ops list render ─────────────────────────────────────── */
  let currentMode = null;
  let texFilled = false;

  function renderOps(mode) {
    if (mode === currentMode) return;
    currentMode = mode;
    const ops = OP_DEFS[mode] || [];
    const el = panel.querySelector('#em-ops');
    el.innerHTML = ops.map(op => `
      <button class="em-op-btn" data-op="${op.id}" title="${op.desc}">
        <span class="em-op-row">
          <span class="em-op-label">${op.label}</span>
          ${op.key ? `<span class="em-op-key">${op.key}</span>` : ''}
        </span>
        <span class="em-op-desc">${op.desc}</span>
      </button>
    `).join('');
    el.querySelectorAll('[data-op]').forEach(b => {
      const op = ops.find(o => o.id === b.dataset.op);
      if (op) b.addEventListener('click', op.run);
    });

    /* update mode tip */
    const tipEl = panel.querySelector('#em-mode-tip');
    const mdef = MODES.find(m => m.id === mode);
    if (tipEl && mdef) tipEl.textContent = mdef.tip + ' · Click+drag to box-select';
  }

  /* ── main status update (called by core/editmesh.js) ────── */
  function status(s) {
    if (!panel) return;

    /* mode buttons highlight */
    panel.querySelectorAll('[data-mode]').forEach(b =>
      b.classList.toggle('on', b.dataset.mode === s.mode));

    /* rebuild ops if mode changed */
    renderOps(s.mode);

    /* status line */
    const stat = panel.querySelector('#em-status');
    if (stat) {
      if (s.modal) {
        stat.textContent = `${s.modal}${s.axis ? ' · axis locked' : ''} — move mouse · click to confirm · Esc to cancel`;
        stat.classList.add('active');
      } else {
        const key = s.mode[0];
        const selN = s.sel[key], totN = s.counts[key];
        const noun = s.mode === 'vertex' ? 'verts' : s.mode + 's';
        stat.textContent = selN > 0
          ? `${selN} of ${totN} ${noun} selected`
          : `${totN} ${noun} — click to select`;
        stat.classList.remove('active');
      }
    }

    /* zones strip — face mode only */
    const showZones = s.mode === 'face';
    if (zonesSection) zonesSection.hidden = !showZones;
    if (showZones) renderZones(s);
  }

  let _texFilled = false;
  function renderZones(s) {
    const wrap = panel.querySelector('#em-swatches');
    wrap.innerHTML = (s.zones || []).map(z =>
      `<button class="em-sw${z.active ? ' on' : ''}" data-z="${z.index}" title="${z.name} — ${z.faceCount} face(s)">
        <span class="em-dot" style="background:${z.color}"></span>
        <span>${z.index === 0 ? 'Base' : z.name.replace('Zone ', 'Z')}</span>
        <span class="em-ct">${z.faceCount}</span>
      </button>`).join('');

    wrap.querySelectorAll('[data-z]').forEach(b =>
      b.addEventListener('click', () => EM() && EM().selectZoneFaces(+b.dataset.z)));

    const active = (s.zones || [])[s.activeZone];
    const propsEl = panel.querySelector('#em-zone-props');
    if (propsEl) propsEl.hidden = !active;

    if (active) {
      const col = panel.querySelector('#em-zcolor');
      if (col) col.value = active.color || '#cccccc';
      const del = panel.querySelector('#em-delzone');
      if (del) del.disabled = s.activeZone === 0;

      if (!_texFilled) {
        const sel = panel.querySelector('#em-ztex');
        if (sel) {
          sel.innerHTML = `<option value="">None (flat colour)</option>` +
            (s.presets || []).map(p => `<option value="${p.id}">${p.label}</option>`).join('');
          _texFilled = true;
        }
      }
      const sel = panel.querySelector('#em-ztex');
      if (sel && active) sel.value = active.tex || '';
    }
  }

  /* ── styles ──────────────────────────────────────────────── */
  function injectStyle() {
    if (document.getElementById('em-panel-style')) return;
    const css = `
      /* ── Edit Mode panel — left side, never overlaps viewport ─ */
      #em-panel {
        position: fixed;
        left: 0; top: var(--bar-h, 52px); bottom: 0;
        width: 200px;
        z-index: 50;
        display: flex;
        flex-direction: column;
        background: rgba(14,16,22,0.97);
        border-right: 1px solid rgba(255,255,255,0.08);
        box-shadow: 4px 0 24px rgba(0,0,0,0.4);
        backdrop-filter: blur(10px);
        font-size: 12px;
        color: #c8cdd6;
        overflow-y: auto;
        overflow-x: hidden;
      }
      #em-panel[hidden] { display: none; }

      /* header */
      .em-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: .55rem .7rem .45rem;
        border-bottom: 1px solid rgba(255,255,255,0.08);
        flex-shrink: 0;
      }
      .em-title {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
        text-transform: uppercase;
        color: #4db8c7;
      }
      .em-exit-btn {
        font-size: 11px;
        font-weight: 600;
        color: #e8a33d;
        background: rgba(232,163,61,.12);
        border: 1px solid rgba(232,163,61,.35);
        border-radius: 6px;
        padding: .22rem .5rem;
        cursor: pointer;
        white-space: nowrap;
      }
      .em-exit-btn:hover { background: rgba(232,163,61,.22); }

      /* sections */
      .em-section {
        padding: .55rem .7rem;
        border-bottom: 1px solid rgba(255,255,255,0.06);
        flex-shrink: 0;
      }
      .em-section-label {
        font-size: 9px;
        font-weight: 700;
        letter-spacing: .1em;
        color: rgba(255,255,255,.3);
        margin-bottom: .45rem;
      }

      /* mode tabs */
      .em-mode-row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: .3rem;
        margin-bottom: .4rem;
      }
      .em-mode-btn {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: .15rem;
        padding: .45rem .2rem;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,.1);
        background: rgba(255,255,255,.03);
        color: #c8cdd6;
        cursor: pointer;
      }
      .em-mode-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
      .em-mode-btn.on {
        background: rgba(77,184,199,.18);
        border-color: #4db8c7;
        color: #4db8c7;
      }
      .em-mode-key {
        font-size: 10px;
        font-weight: 700;
        opacity: .55;
        border: 1px solid currentColor;
        border-radius: 3px;
        padding: 0 .3rem;
        line-height: 1.4;
      }
      .em-mode-label { font-size: 11px; font-weight: 600; }

      .em-tip {
        font-size: 10px;
        color: rgba(255,255,255,.3);
        line-height: 1.5;
      }

      /* ops list */
      .em-ops {
        display: flex;
        flex-direction: column;
        gap: .25rem;
      }
      .em-op-btn {
        display: flex;
        flex-direction: column;
        gap: .1rem;
        padding: .4rem .55rem;
        border-radius: 8px;
        border: 1px solid rgba(255,255,255,.07);
        background: rgba(255,255,255,.025);
        color: #c8cdd6;
        cursor: pointer;
        text-align: left;
        width: 100%;
      }
      .em-op-btn:hover {
        background: rgba(255,255,255,.08);
        border-color: rgba(255,255,255,.18);
        color: #fff;
      }
      .em-op-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: .3rem;
      }
      .em-op-label { font-weight: 600; font-size: 12px; }
      .em-op-key {
        font-size: 10px;
        opacity: .55;
        border: 1px solid currentColor;
        border-radius: 3px;
        padding: 0 .28rem;
        line-height: 1.4;
        flex-shrink: 0;
      }
      .em-op-desc {
        font-size: 10px;
        color: rgba(255,255,255,.35);
        line-height: 1.3;
      }

      /* zones */
      .em-swatches {
        display: flex;
        flex-wrap: wrap;
        gap: .25rem;
        margin-bottom: .4rem;
      }
      .em-sw {
        display: inline-flex;
        align-items: center;
        gap: .3rem;
        padding: .28rem .45rem;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,.1);
        background: rgba(255,255,255,.03);
        color: #c8cdd6;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
      }
      .em-sw.on { border-color: #e8a33d; background: rgba(232,163,61,.12); color: #e8a33d; }
      .em-sw:hover { background: rgba(255,255,255,.08); }
      .em-dot { width: 10px; height: 10px; border-radius: 3px; flex-shrink: 0; }
      .em-ct { font-size: 10px; opacity: .5; }

      .em-zone-actions {
        display: flex;
        gap: .3rem;
        margin-bottom: .4rem;
        flex-wrap: wrap;
      }
      .em-action-btn {
        flex: 1;
        padding: .35rem .4rem;
        border-radius: 7px;
        border: 1px solid rgba(255,255,255,.1);
        background: rgba(255,255,255,.04);
        color: #c8cdd6;
        cursor: pointer;
        font-size: 11px;
        font-weight: 600;
        white-space: nowrap;
      }
      .em-action-btn:hover { background: rgba(255,255,255,.1); color: #fff; }
      .em-action-btn:disabled { opacity: .35; cursor: default; }
      .em-accent {
        background: rgba(232,163,61,.12);
        border-color: rgba(232,163,61,.4);
        color: #e8a33d;
      }
      .em-accent:hover { background: rgba(232,163,61,.22); }
      .em-danger {
        background: rgba(239,68,68,.1);
        border-color: rgba(239,68,68,.35);
        color: #f87171;
        width: 100%;
        margin-top: .3rem;
      }
      .em-danger:hover { background: rgba(239,68,68,.2); }

      .em-zone-props { display: flex; flex-direction: column; gap: .35rem; }
      .em-prop-row {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: .4rem;
        font-size: 11px;
        color: #96a0ad;
      }
      .em-prop-label { flex-shrink: 0; }
      .em-prop-row input[type=color] { width: 32px; height: 24px; border: none; background: none; padding: 0; border-radius: 5px; cursor: pointer; }
      .em-prop-row select { flex: 1; background: #181b22; color: #d7dbe2; border: 1px solid rgba(255,255,255,.12); border-radius: 6px; padding: .2rem .3rem; font-size: 11px; }

      /* status line */
      .em-status {
        margin-top: auto;
        padding: .55rem .7rem;
        border-top: 1px solid rgba(255,255,255,0.08);
        font-size: 11px;
        color: rgba(255,255,255,.35);
        line-height: 1.5;
        flex-shrink: 0;
      }
      .em-status.active {
        color: #4db8c7;
        background: rgba(77,184,199,.06);
      }

      /* outline the 3D host to show edit mode is active */
      body.editing #scene3d-host {
        outline: 2px solid rgba(77,184,199,0.4);
        outline-offset: -2px;
      }

      /* mobile — panel slides up from bottom as a horizontal scroll strip.
         Breakpoint matches the main forge.css mobile breakpoint (880px).
         Bottom clears the actionbar: actionbar is at bottom:62px, height 44px
         → its top edge is at 106px. Add 4px gap = 110px. */
      @media (max-width: 880px) {
        #em-panel {
          left: 0; right: 0;
          top: auto; bottom: 110px;
          width: auto;
          height: auto;
          max-height: 36vh;
          border-right: none;
          border-top: 1px solid rgba(255,255,255,0.1);
          box-shadow: 0 -4px 24px rgba(0,0,0,0.4);
          flex-direction: row;
          flex-wrap: nowrap;
          overflow-x: auto;
          overflow-y: hidden;
          overflow-y: hidden;
          align-items: stretch;
          /* momentum scrolling on iOS */
          -webkit-overflow-scrolling: touch;
        }
        .em-header {
          flex-direction: column; gap: .3rem; padding: .5rem;
          min-width: 76px; flex-shrink: 0;
        }
        .em-section {
          border-bottom: none;
          border-right: 1px solid rgba(255,255,255,0.06);
          padding: .4rem .5rem;
          min-width: 130px; flex-shrink: 0;
        }
        .em-status { display: none; }
        #em-zones-section { min-width: 180px; flex-shrink: 0; } /* BUG-034 fix: was .em-zones (dead) */
        body.editing #scene3d-host { margin-left: 0; }
      }
    `;
    const el = document.createElement('style');
    el.id = 'em-panel-style';
    el.textContent = css;
    document.head.appendChild(el);
  }

  return { init, status, show };
})();
