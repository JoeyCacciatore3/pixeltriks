/* PixelTriks — transform-pad.js
   Redesigned transform pad — mode-tabbed (Move / Rotate / Scale) with text
   labels on every button, dedicated Y-axis controls, Undo/Redo on the pad,
   and no hidden axis-lock cycling.

   Layout:
     [Move] [Rotate] [Scale]   ← mode tabs
     [ grid adapts per mode ]  ← 3×3 or 2-button scale
     [Undo]  [step size]  [Redo] ← always-visible utility row

   Move mode  — N/S/E/W = XZ plane, diagonals = diagonal XZ, center = Y up/down
   Rotate mode— N/S = pitch, W/E = yaw (spin), NW/NE = roll, center = badge
   Scale mode — two big +/- buttons plus per-axis fine controls
*/
'use strict';
window.GF = window.GF || {};

GF.transformPad = (function () {
  const S  = () => GF.scene3d;
  const run = id => GF.api && GF.api.run(id);

  let mode     = 'move';   // 'move' | 'rotate' | 'scale'
  let fineMode = false;    // shift-equivalent toggle for touch users
  let padEl    = null;
  let holdTimer = null, holdTarget = null, holdStart = 0;

  /* ── step sizes ───────────────────────────────────────────── */
  const MOVE_STEP   = 0.15,  MOVE_FINE   = 0.02;
  const ROT_STEP    = 15,    ROT_FINE    = 5;       // degrees
  const SCALE_STEP  = 1.12,  SCALE_FINE  = 1.02;
  const ACCEL_DELAY = 320,   ACCEL_MAX   = 8;

  const mv  = () => fineMode ? MOVE_FINE  : MOVE_STEP;
  const rot = () => fineMode ? ROT_FINE   : ROT_STEP;
  const sc  = () => fineMode ? SCALE_FINE : SCALE_STEP;

  /* ── core transforms ─────────────────────────────────────── */
  function node3D() {
    const o = S() && S().selected && S().selected();
    return o ? (o.node || o) : null;
  }
  function moveXZ(dx, dz) {
    const n = node3D(); if (!n) return;
    GF.transformManager.requestTransform(n,
      { position: { x: n.position.x + dx, y: n.position.y, z: n.position.z + dz } },
      'transform-pad');
  }
  function moveY(dy) {
    const n = node3D(); if (!n) return;
    GF.transformManager.requestTransform(n,
      { position: { x: n.position.x, y: n.position.y + dy, z: n.position.z } },
      'transform-pad');
  }
  function rotateAxis(axis, deg) {
    const n = node3D(); if (!n) return;
    const rad = deg * Math.PI / 180;
    const r = { x: n.rotation.x, y: n.rotation.y, z: n.rotation.z };
    r[axis] += rad;
    GF.transformManager.requestTransform(n, { rotation: r }, 'transform-pad');
  }
  function scaleAll(factor) {
    const n = node3D(); if (!n) return;
    const s = { x: n.scale.x * factor, y: n.scale.y * factor, z: n.scale.z * factor };
    GF.transformManager.requestTransform(n, { scale: s }, 'transform-pad');
  }
  function scaleAxis(axis, factor) {
    const n = node3D(); if (!n) return;
    const s = { x: n.scale.x, y: n.scale.y, z: n.scale.z };
    s[axis] *= factor;
    GF.transformManager.requestTransform(n, { scale: s }, 'transform-pad');
  }
  function resetScale() {
    const n = node3D(); if (!n) return;
    GF.transformManager.requestTransform(n, { scale: { x: 1, y: 1, z: 1 } }, 'transform-pad');
  }

  /* ── per-mode grid button definitions ───────────────────── */
  // Each entry: { label, title, cls (optional extra class), fn (action), hold (repeat on hold) }
  const GRID = {
    move: [
      { id:'nw', label:'↖',     title:'Diagonal ← Back',     fn:() => moveXZ(-mv(), -mv()), hold:true },
      { id:'n',  label:'Back',   title:'Move away from camera',fn:() => moveXZ(0, -mv()),     hold:true },
      { id:'ne', label:'↗',     title:'Diagonal → Back',     fn:() => moveXZ(+mv(), -mv()), hold:true },
      { id:'w',  label:'Left',   title:'Move left',            fn:() => moveXZ(-mv(), 0),     hold:true },
      { id:'c',  label:'Y ↑',   title:'Move up · Fine: move down', fn:() => moveY(+mv()), hold:true, center:true },
      { id:'e',  label:'Right',  title:'Move right',           fn:() => moveXZ(+mv(), 0),    hold:true },
      { id:'sw', label:'↙',     title:'Diagonal ← Forward',  fn:() => moveXZ(-mv(), +mv()), hold:true },
      { id:'s',  label:'Fwd',    title:'Move toward camera',   fn:() => moveXZ(0, +mv()),     hold:true },
      { id:'se', label:'↘',     title:'Diagonal → Forward',  fn:() => moveXZ(+mv(), +mv()), hold:true },
    ],
    rotate: [
      { id:'nw', label:'Roll ↺', title:'Roll counter-clockwise (Z)',fn:() => rotateAxis('z', -rot()), hold:true },
      { id:'n',  label:'Tilt ↑', title:'Tilt up (X pitch)',         fn:() => rotateAxis('x', -rot()), hold:true },
      { id:'ne', label:'Roll ↻', title:'Roll clockwise (Z)',         fn:() => rotateAxis('z', +rot()), hold:true },
      { id:'w',  label:'Spin ←', title:'Spin left (Y yaw)',          fn:() => rotateAxis('y', -rot()), hold:true },
      { id:'c',  label:'ROT',    title:'Rotate mode',                fn:null, center:true, badge:true },
      { id:'e',  label:'Spin →', title:'Spin right (Y yaw)',         fn:() => rotateAxis('y', +rot()), hold:true },
      { id:'noop1', label:'',    title:'',                           fn:null, disabled:true },
      { id:'s',  label:'Tilt ↓', title:'Tilt down (X pitch)',        fn:() => rotateAxis('x', +rot()), hold:true },
      { id:'noop2', label:'',    title:'',                           fn:null, disabled:true },
    ],
    scale: null,   // scale uses a custom layout (see buildScaleGrid)
  };

  /* ── hold-to-repeat ──────────────────────────────────────── */
  function startHold(fn) {
    fn();
    holdTarget = fn; holdStart = performance.now();
    holdTimer = requestAnimationFrame(tickHold);
  }
  function tickHold() {
    if (!holdTarget) return;
    const elapsed = performance.now() - holdStart;
    if (elapsed >= ACCEL_DELAY) {
      const p = Math.min((elapsed - ACCEL_DELAY) / 2000, 1);
      const times = Math.ceil(1 + p * (ACCEL_MAX - 1));
      for (let i = 0; i < times; i++) holdTarget();
    }
    holdTimer = requestAnimationFrame(tickHold);
  }
  function stopHold() {
    holdTarget = null;
    if (holdTimer) { cancelAnimationFrame(holdTimer); holdTimer = null; }
  }

  /* ── build DOM ───────────────────────────────────────────── */
  function build() {
    padEl = document.createElement('div');
    padEl.id = 'transform-pad';
    padEl.setAttribute('role', 'group');
    padEl.setAttribute('aria-label', 'Transform — move, rotate, scale the selected object');
    padEl.innerHTML = `
      <!-- mode tabs -->
      <div class="tp-tabs">
        <button class="tp-tab tp-tab-move on" data-tab="move" title="Move selected object">Move</button>
        <button class="tp-tab tp-tab-rotate" data-tab="rotate" title="Rotate selected object">Rotate</button>
        <button class="tp-tab tp-tab-scale" data-tab="scale" title="Scale selected object">Scale</button>
      </div>

      <!-- grid (swapped per mode) -->
      <div class="tp-grid" id="tp-grid"></div>

      <!-- utility row -->
      <div class="tp-util">
        <button class="tp-util-btn" id="tp-undo" title="Undo last transform (Ctrl+Z)" aria-label="Undo">⌫ Undo</button>
        <button class="tp-fine-btn" id="tp-fine" title="Toggle fine / normal step size">Fine</button>
        <button class="tp-util-btn" id="tp-redo" title="Redo (Ctrl+Shift+Z)" aria-label="Redo">Redo ↪</button>
      </div>

      <!-- idle overlay -->
      <div class="tp-idle-msg" id="tp-idle">Select an object<br>to transform</div>
      <span class="tp-footer-label">Move · Rotate · Scale</span>
    `;
    document.body.appendChild(padEl);
    injectStyle();

    /* tabs */
    padEl.querySelectorAll('[data-tab]').forEach(btn =>
      btn.addEventListener('click', () => setMode(btn.dataset.tab)));

    /* undo / redo */
    padEl.querySelector('#tp-undo').addEventListener('click', () => run('undo'));
    padEl.querySelector('#tp-redo').addEventListener('click', () => run('redo'));

    /* fine mode toggle */
    const fineBtn = padEl.querySelector('#tp-fine');
    fineBtn.addEventListener('click', () => {
      fineMode = !fineMode;
      fineBtn.classList.toggle('on', fineMode);
      fineBtn.title = fineMode ? 'Fine mode ON — click for normal' : 'Toggle fine / normal step';
      updateCenterLabel();
    });

    /* stop hold on any pointer release */
    ['pointerup', 'pointercancel'].forEach(t => window.addEventListener(t, stopHold));
    window.addEventListener('blur', stopHold);

    buildGrid();
    updateVisibility();
  }

  function buildGrid() {
    const grid = padEl.querySelector('#tp-grid');
    grid.innerHTML = '';

    if (mode === 'scale') {
      buildScaleGrid(grid);
      return;
    }

    GRID[mode].forEach(def => {
      const btn = document.createElement('button');
      btn.className = 'tp-cell tp-cell-' + def.id;
      if (def.center) btn.classList.add('tp-center');
      if (def.badge)  btn.classList.add('tp-badge');
      if (def.disabled || (!def.fn && !def.badge)) btn.classList.add('tp-dim');
      btn.dataset.id = def.id;
      btn.title = def.title;
      btn.setAttribute('aria-label', def.title || def.label);
      btn.innerHTML = `<span class="tp-lbl">${def.label}</span>`;
      if (def.fn && !def.badge) {
        btn.addEventListener('pointerdown', e => {
          e.preventDefault(); btn.classList.add('pressed');
          if (def.hold) startHold(def.fn);
          else def.fn();
        });
      }
      grid.appendChild(btn);
    });

    /* special: center Y button shows ↓ when fine mode on */
    updateCenterLabel();
  }

  function buildScaleGrid(grid) {
    // Scale mode: simple + / - with per-axis fine controls below
    grid.innerHTML = `
      <div class="tp-scale-main">
        <button class="tp-scale-btn tp-scale-up" id="tp-sc-up" title="Scale up (all axes)">
          <span class="tp-sc-icon">＋</span>
          <span class="tp-sc-lbl">Scale Up</span>
        </button>
        <button class="tp-scale-btn tp-scale-dn" id="tp-sc-dn" title="Scale down (all axes)">
          <span class="tp-sc-icon">－</span>
          <span class="tp-sc-lbl">Scale Down</span>
        </button>
      </div>
      <div class="tp-scale-axes">
        <span class="tp-axes-label">Per axis:</span>
        <button class="tp-ax-btn" data-axis="x" data-dir="1"  title="Grow on X">+X</button>
        <button class="tp-ax-btn" data-axis="x" data-dir="-1" title="Shrink on X">−X</button>
        <button class="tp-ax-btn" data-axis="y" data-dir="1"  title="Grow on Y">+Y</button>
        <button class="tp-ax-btn" data-axis="y" data-dir="-1" title="Shrink on Y">−Y</button>
        <button class="tp-ax-btn" data-axis="z" data-dir="1"  title="Grow on Z">+Z</button>
        <button class="tp-ax-btn" data-axis="z" data-dir="-1" title="Shrink on Z">−Z</button>
        <button class="tp-ax-btn tp-ax-reset" id="tp-sc-reset" title="Reset scale to 1×1×1">1:1</button>
      </div>
    `;

    const up  = grid.querySelector('#tp-sc-up');
    const dn  = grid.querySelector('#tp-sc-dn');
    const rst = grid.querySelector('#tp-sc-reset');

    const holdUp = () => scaleAll(sc());
    const holdDn = () => scaleAll(1 / sc());
    up.addEventListener('pointerdown',  e => { e.preventDefault(); up.classList.add('pressed');  startHold(holdUp); });
    dn.addEventListener('pointerdown',  e => { e.preventDefault(); dn.classList.add('pressed');  startHold(holdDn); });
    rst.addEventListener('click', resetScale);

    grid.querySelectorAll('[data-axis]').forEach(btn => {
      btn.addEventListener('pointerdown', e => {
        e.preventDefault(); btn.classList.add('pressed');
        const axis = btn.dataset.axis, dir = +btn.dataset.dir;
        startHold(() => scaleAxis(axis, dir > 0 ? sc() : 1 / sc()));
      });
    });
  }

  /* ── mode switch ─────────────────────────────────────────── */
  function setMode(m) {
    mode = m;
    padEl.querySelectorAll('[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === m));
    buildGrid();
  }

  /* ── center cell label update ────────────────────────────── */
  function updateCenterLabel() {
    if (mode !== 'move') return;
    const c = padEl.querySelector('.tp-center .tp-lbl');
    if (c) c.textContent = fineMode ? 'Y ↓' : 'Y ↑';
    const cBtn = padEl.querySelector('.tp-center');
    if (cBtn) {
      // override the action for fine mode
      const def = GRID.move.find(d => d.id === 'c');
      if (def) def.fn = () => moveY(fineMode ? -mv() : +mv());
      cBtn.title = fineMode ? 'Move down (Fine ON)' : 'Move up · toggle Fine for down';
    }
  }

  /* ── visibility ──────────────────────────────────────────── */
  function updateVisibility() {
    if (!padEl) return;
    const has = !!(S() && S().selected && S().selected());
    padEl.classList.toggle('tp-active', has);
    padEl.classList.toggle('tp-idle',   !has);
    const idle = padEl.querySelector('#tp-idle');
    if (idle) idle.style.display = has ? 'none' : 'flex';
  }

  /* ── clean up pressed state on any release ──────────────── */
  window.addEventListener('pointerup',     () => { stopHold(); clearPressed(); });
  window.addEventListener('pointercancel', () => { stopHold(); clearPressed(); });
  function clearPressed() { if (padEl) padEl.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed')); }

  /* ── public API (gamepad still calls these) ─────────────── */
  function move(dx, dz)        { moveXZ(dx, dz); }
  function rotate(deg)         { rotateAxis('y', deg); }
  function scale(factor)       { scaleAll(factor); }
  function startGesture()      {}
  function endGesture()        {}
  function cycleAxis()         {}   // kept for backwards compat (gamepad)

  /* ── init ────────────────────────────────────────────────── */
  function init() {
    const reg = GF.commands.register;
    reg({ id:'transform.nudge',      title:'Nudge selected',         group:'Transform', palette:false, run:a => moveXZ(a.dx||0, a.dy||0) });
    reg({ id:'transform.rotateStep', title:'Rotate by step',         group:'Transform', palette:false, run:a => rotateAxis('y', a.deg ?? ROT_STEP) });
    reg({ id:'transform.scaleStep',  title:'Scale by step',          group:'Transform', palette:false, run:a => scaleAll(a.factor ?? SCALE_STEP) });
    reg({ id:'transform.cycleAxis',  title:'Cycle transform axis',   group:'Transform', run:cycleAxis });
    build();
    if (S() && S().onChange) S().onChange(updateVisibility);
    window.addEventListener('pt:editmode', () => {
      if (padEl) padEl.style.display = GF.editmesh && GF.editmesh.isActive() ? 'none' : '';
    });
  }

  /* ── styles ──────────────────────────────────────────────── */
  function injectStyle() {
    if (document.getElementById('tpad-style')) return;
    const css = `
    /* ── Transform pad ───────────────────────────────────── */
    #transform-pad {
      position: fixed; left: 14px; bottom: 34px; z-index: 70;
      width: 186px;
      display: flex; flex-direction: column; gap: 6px;
      padding: 8px;
      background: rgba(14,16,22,.96);
      border: 1px solid rgba(255,255,255,.1);
      border-radius: 14px;
      box-shadow: 0 8px 28px rgba(0,0,0,.55);
      backdrop-filter: blur(10px);
      font-size: 11px; color: #c8cdd6;
      transition: opacity .18s;
    }
    #transform-pad.tp-idle { opacity: .85; }
    #transform-pad.tp-active { opacity: 1; }

    /* ── mode tabs ──────────────────────────────────────── */
    .tp-tabs {
      display: grid; grid-template-columns: repeat(3,1fr); gap: 4px;
    }
    .tp-tab {
      padding: .32rem 0;
      border-radius: 7px;
      border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.03);
      color: #7d8794; font-size: 11px; font-weight: 600;
      cursor: pointer; text-align: center;
      transition: .12s;
    }
    .tp-tab:hover { color: #c8cdd6; background: rgba(255,255,255,.07); }
    .tp-tab.on   { color: #fff; border-color: rgba(255,255,255,.3); background: rgba(255,255,255,.12); }
    .tp-tab-move.on   { background: rgba(77,184,199,.2); border-color: #4db8c7; color: #4db8c7; }
    .tp-tab-rotate.on { background: rgba(232,163,61,.18); border-color: #e8a33d; color: #e8a33d; }
    .tp-tab-scale.on  { background: rgba(91,191,122,.18); border-color: #5bbf7a; color: #5bbf7a; }

    /* ── grid ───────────────────────────────────────────── */
    .tp-grid {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      grid-template-rows:    repeat(3, 1fr);
      gap: 3px;
    }

    /* move cells */
    .tp-cell {
      display: flex; align-items: center; justify-content: center;
      height: 44px; border-radius: 9px;
      border: 1px solid rgba(255,255,255,.09);
      background: rgba(255,255,255,.04);
      color: #c8cdd6; cursor: pointer;
      touch-action: none; user-select: none;
      transition: .1s;
    }
    .tp-cell:hover  { background: rgba(255,255,255,.1); color: #fff; border-color: rgba(255,255,255,.22); }
    .tp-cell.pressed { transform: scale(.88); background: #4db8c7; color: #060e14; border-color: #4db8c7; }
    .tp-tab-rotate.on ~ .tp-grid .tp-cell.pressed { background: #e8a33d; color: #1a1000; border-color: #e8a33d; }

    .tp-lbl { font-size: 10px; font-weight: 700; text-align: center; line-height: 1.2; }

    .tp-center {
      background: rgba(255,255,255,.07);
      border-color: rgba(255,255,255,.2);
      font-weight: 800; font-size: 12px;
    }
    .tp-badge { cursor: default; }
    .tp-badge:hover { background: rgba(255,255,255,.07); color: #c8cdd6; border-color: rgba(255,255,255,.2); }
    .tp-dim  { opacity: .18; pointer-events: none; }

    /* grid positions */
    .tp-cell-nw    { grid-area: 1/1; }
    .tp-cell-n     { grid-area: 1/2; }
    .tp-cell-ne    { grid-area: 1/3; }
    .tp-cell-w     { grid-area: 2/1; }
    .tp-center     { grid-area: 2/2; }
    .tp-cell-e     { grid-area: 2/3; }
    .tp-cell-noop1 { grid-area: 3/1; }
    .tp-cell-s     { grid-area: 3/2; }
    .tp-cell-noop2 { grid-area: 3/3; }
    .tp-cell-sw    { grid-area: 3/1; }
    .tp-cell-se    { grid-area: 3/3; }

    /* ── scale grid ─────────────────────────────────────── */
    .tp-scale-main {
      display: grid; grid-template-columns: 1fr 1fr; gap: 4px;
      margin-bottom: 4px;
    }
    .tp-scale-btn {
      display: flex; flex-direction: column; align-items: center; justify-content: center;
      height: 52px; border-radius: 10px;
      border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.04);
      color: #c8cdd6; cursor: pointer; gap: 2px;
      touch-action: none; user-select: none; transition: .1s;
    }
    .tp-scale-btn:hover  { background: rgba(255,255,255,.1); color: #fff; }
    .tp-scale-btn.pressed { transform: scale(.92); }
    .tp-scale-up:hover,  .tp-scale-up.pressed  { background: rgba(91,191,122,.2);  border-color: #5bbf7a; color: #5bbf7a; }
    .tp-scale-dn:hover,  .tp-scale-dn.pressed  { background: rgba(239,68,68,.15);  border-color: #f87171; color: #f87171; }
    .tp-sc-icon { font-size: 20px; font-weight: 800; line-height: 1; }
    .tp-sc-lbl  { font-size: 10px; font-weight: 700; }

    .tp-scale-axes {
      display: flex; flex-wrap: wrap; gap: 3px; align-items: center;
    }
    .tp-axes-label {
      font-size: 9px; color: rgba(255,255,255,.3); letter-spacing: .04em;
      text-transform: uppercase; width: 100%;
    }
    .tp-ax-btn {
      flex: 1; min-width: 0; padding: .28rem 0;
      border-radius: 6px; border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.04); color: #7d8794;
      font-size: 10px; font-weight: 700; cursor: pointer;
      touch-action: none; user-select: none; transition: .1s;
    }
    .tp-ax-btn:hover  { background: rgba(255,255,255,.1); color: #fff; }
    .tp-ax-btn.pressed { transform: scale(.9); background: rgba(91,191,122,.18); color: #5bbf7a; }
    .tp-ax-reset {
      flex: 1.2; background: rgba(255,255,255,.06);
      color: #c8cdd6; border-color: rgba(255,255,255,.2);
    }

    /* ── utility row ────────────────────────────────────── */
    .tp-util {
      display: grid; grid-template-columns: 1fr auto 1fr; gap: 4px;
      border-top: 1px solid rgba(255,255,255,.07); padding-top: 6px;
    }
    .tp-util-btn {
      padding: .32rem .4rem; border-radius: 7px;
      border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.04); color: #7d8794;
      font-size: 11px; font-weight: 600; cursor: pointer;
      transition: .1s;
    }
    .tp-util-btn:hover { background: rgba(255,255,255,.1); color: #c8cdd6; }
    .tp-fine-btn {
      padding: .32rem .5rem; border-radius: 7px;
      border: 1px solid rgba(255,255,255,.1);
      background: rgba(255,255,255,.04); color: #7d8794;
      font-size: 10px; font-weight: 700; cursor: pointer; transition: .1s;
    }
    .tp-fine-btn:hover { background: rgba(255,255,255,.08); color: #fff; }
    .tp-fine-btn.on {
      background: rgba(232,163,61,.16); border-color: rgba(232,163,61,.5);
      color: #e8a33d;
    }

    /* ── idle overlay ───────────────────────────────────── */
    .tp-idle-msg {
      display: none; position: absolute;
      inset: 0; border-radius: 14px;
      background: rgba(14,16,22,.88);
      align-items: center; justify-content: center;
      text-align: center; font-size: 11px; color: #5d6673;
      line-height: 1.5; pointer-events: none; z-index: 2;
    }
    #transform-pad.tp-idle .tp-idle-msg { display: flex; }
    #transform-pad.tp-idle .tp-tabs { opacity: .4; }

    .tp-footer-label {
      text-align: center; font-size: 9px; color: rgba(255,255,255,.2);
      letter-spacing: .04em; padding-top: 2px;
    }

    /* ── mobile — base adjustments (forge.css carries the rest) ─ */
    @media (max-width: 880px) {
      /* forge.css mobile block handles width/bottom/padding/cell sizes.
         Only keep what's not in forge.css: the bottom offset. */
      #transform-pad { bottom: 112px; }
    }
    `;
    const s = document.createElement('style');
    s.id = 'tpad-style'; s.textContent = css;
    document.head.appendChild(s);
  }

  return { init, startGesture, endGesture, move, rotate, scale, cycleAxis };
})();
