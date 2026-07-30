/* PixelTriks — transform-pad.js
   THE movement control (the on-screen "gamepad"). A 3×3 grid, fixed in the
   bottom-left corner, ALWAYS visible. It is the single source of truth for
   moving / rotating / scaling the selected 3D object — the viewport gizmo and
   drag-to-move were removed so there is exactly one way to transform.

   9 cells: 4 move (N/S/E/W on the ground plane), 2 rotate (NW/NE),
   2 scale (SW/SE), 1 center = axis lock (Free → X → Y → Z).
   Tap = one nudge · Hold = continuous with acceleration · Shift = 10×.
   The physical gamepad drives the same transform.* commands.
*/
'use strict';
window.GF = window.GF || {};

GF.transformPad = (function () {
  const S = () => GF.scene3d;

  let axisMode = 'free';       // free | x | y | z
  let holdTimer = null, holdDir = null, holdStart = 0;
  let padEl = null;

  const BASE_STEP = 0.1;       // units per tap
  const SHIFT_MULT = 10;
  const ACCEL_DELAY = 300, ACCEL_MAX = 8;
  const ROT_STEP = 15, ROT_STEP_FINE = 5;
  const SCALE_STEP = 1.1, SCALE_STEP_FINE = 1.02;

  const AXIS_MODES = ['free', 'x', 'y', 'z'];
  const AXIS_LABELS = { free: '⊕', x: 'X', y: 'Y', z: 'Z' };
  const AXIS_TITLES = { free: 'Free', x: 'X-axis lock', y: 'Y-axis lock', z: 'Z-axis lock' };

  const step = e => (e && e.shiftKey ? BASE_STEP * SHIFT_MULT : BASE_STEP);
  const rotStep = e => (e && e.shiftKey ? ROT_STEP_FINE : ROT_STEP);
  const scaleFactor = e => (e && e.shiftKey ? SCALE_STEP_FINE : SCALE_STEP);

  /* gesture batching for continuous input (gamepad sticks) */
  let inGesture = false;
  function startGesture() { inGesture = true; }
  function endGesture() { inGesture = false; }

  function node3D() { const o = S() && S().selected && S().selected(); return o ? (o.node || o) : null; }

  /* N/S = depth (Z), E/W = left/right (X); axis-lock Y routes N/S to up/down. */
  function move(dx, dy) {
    const n = node3D(); if (!n) return;
    let vx = dx, vy = 0, vz = dy;
    if (axisMode === 'x') { vz = 0; }
    else if (axisMode === 'y') { vx = 0; vy = -dy; vz = 0; }   // N = up, S = down
    else if (axisMode === 'z') { vx = 0; }
    GF.transformManager.requestTransform(n, { position: { x: n.position.x + vx, y: n.position.y + vy, z: n.position.z + vz } }, 'transform-pad');
  }
  function rotate(deg) {
    const n = node3D(); if (!n) return;
    const rad = deg * Math.PI / 180, rot = { x: n.rotation.x, y: n.rotation.y, z: n.rotation.z };
    if (axisMode === 'x') rot.x += rad; else if (axisMode === 'z') rot.z += rad; else rot.y += rad;
    GF.transformManager.requestTransform(n, { rotation: rot }, 'transform-pad');
  }
  function scale(factor) {
    const n = node3D(); if (!n) return;
    const s = { x: n.scale.x, y: n.scale.y, z: n.scale.z };
    if (axisMode === 'x') s.x *= factor; else if (axisMode === 'y') s.y *= factor; else if (axisMode === 'z') s.z *= factor;
    else { s.x *= factor; s.y *= factor; s.z *= factor; }
    GF.transformManager.requestTransform(n, { scale: s }, 'transform-pad');
  }
  function cycleAxis() { axisMode = AXIS_MODES[(AXIS_MODES.indexOf(axisMode) + 1) % AXIS_MODES.length]; updateCenter(); }

  const DIRS = {
    nw: e => rotate(-rotStep(e)),  n: e => move(0, -step(e)),   ne: e => rotate(+rotStep(e)),
    w:  e => move(-step(e), 0),    c: () => cycleAxis(),        e:  e => move(+step(e), 0),
    sw: e => scale(1 / scaleFactor(e)), s: e => move(0, +step(e)), se: e => scale(scaleFactor(e)),
  };

  function startHold(dir, e) {
    DIRS[dir](e);                              // the tap = exactly one nudge
    holdDir = dir; holdStart = performance.now();
    holdTimer = requestAnimationFrame(() => doHoldFrame(e));
  }
  function doHoldFrame(e) {
    if (!holdDir) return;
    const el = performance.now() - holdStart;
    if (el >= ACCEL_DELAY) {                    // only repeat once the button is HELD past the delay
      const p = Math.min((el - ACCEL_DELAY) / 2000, 1), times = Math.ceil(1 + p * (ACCEL_MAX - 1));
      for (let i = 0; i < times; i++) DIRS[holdDir](e);
    }
    holdTimer = requestAnimationFrame(() => doHoldFrame(e));
  }
  function stopHold() { holdDir = null; if (holdTimer) { cancelAnimationFrame(holdTimer); holdTimer = null; } }

  const ARROWS = {
    nw: '<svg viewBox="0 0 24 24"><path d="M12 5C7.6 5 4 8.6 4 13h2c0-3.3 2.7-6 6-6s6 2.7 6 6h2c0-4.4-3.6-8-8-8z"/><path d="M7 9L4 13l3 4"/></svg>',
    n:  '<svg viewBox="0 0 24 24"><path d="M12 4l-6 6h4v8h4v-8h4z"/></svg>',
    ne: '<svg viewBox="0 0 24 24"><path d="M12 5c4.4 0 8 3.6 8 8h-2c0-3.3-2.7-6-6-6s-6 2.7-6 6H4c0-4.4 3.6-8 8-8z"/><path d="M17 9l3 4-3 4"/></svg>',
    w:  '<svg viewBox="0 0 24 24"><path d="M4 12l6-6v4h8v4h-8v4z"/></svg>',
    e:  '<svg viewBox="0 0 24 24"><path d="M20 12l-6-6v4H6v4h8v4z"/></svg>',
    sw: '<svg viewBox="0 0 24 24"><path d="M5 19h14"/><path d="M8 15l4 4 4-4"/></svg>',
    s:  '<svg viewBox="0 0 24 24"><path d="M12 20l6-6h-4V6h-4v8H6z"/></svg>',
    se: '<svg viewBox="0 0 24 24"><path d="M5 5h14"/><path d="M8 9l4-4 4 4"/></svg>',
  };
  const TITLES = { nw: 'Rotate left', n: 'Move back', ne: 'Rotate right', w: 'Move left', e: 'Move right', sw: 'Scale down', s: 'Move forward', se: 'Scale up' };

  function build() {
    padEl = document.createElement('div');
    padEl.id = 'transform-pad';
    padEl.className = 'tpad tpad-idle';
    padEl.setAttribute('role', 'group');
    padEl.setAttribute('aria-label', 'Transform pad — move, rotate, scale the selected object');
    padEl.innerHTML =
      ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'].map(d =>
        d === 'c'
          ? `<button class="tpad-btn tpad-c" data-dir="c" data-axis="${axisMode}" title="Axis: Free — click to lock an axis"><span class="tpad-axis">${AXIS_LABELS[axisMode]}</span></button>`
          : `<button class="tpad-btn tpad-${d}" data-dir="${d}" title="${TITLES[d]}" aria-label="${TITLES[d]}">${ARROWS[d]}</button>`
      ).join('') + `<span class="tpad-hint">Select an<br>object</span><span class="tpad-label">Move · Rotate · Scale</span>`;
    padEl.addEventListener('pointerdown', onDown);
    padEl.addEventListener('contextmenu', e => e.preventDefault());
    // Release anywhere stops the hold — a button can never get "stuck moving"
    // if the pointer is released or lost off the pad.
    ['pointerup', 'pointercancel'].forEach(t => window.addEventListener(t, onUp));
    window.addEventListener('blur', onUp);
    document.body.appendChild(padEl);
    injectStyle();
    updateVisibility();
  }
  function onDown(e) {
    const btn = e.target.closest('[data-dir]'); if (!btn || padEl.classList.contains('tpad-idle')) return;
    e.preventDefault(); btn.classList.add('pressed');
    const dir = btn.dataset.dir;
    if (dir === 'c') { cycleAxis(); return; }
    startHold(dir, e);                          // applies one nudge now, repeats only if held
  }
  function onUp() { stopHold(); if (padEl) padEl.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed')); }

  function updateVisibility() {
    if (!padEl) return;
    const has = !!(S() && S().selected && S().selected());
    padEl.classList.toggle('tpad-active', has);
    padEl.classList.toggle('tpad-idle', !has);
  }
  function updateCenter() {
    if (!padEl) return;
    const c = padEl.querySelector('.tpad-c'); if (!c) return;
    c.querySelector('.tpad-axis').textContent = AXIS_LABELS[axisMode];
    c.title = 'Axis: ' + AXIS_TITLES[axisMode] + ' — click to cycle';
    c.dataset.axis = axisMode;
    padEl.querySelectorAll('[data-dir]').forEach(b => {
      const d = b.dataset.dir; let locked = false;
      if (axisMode === 'x' && (d === 'n' || d === 's')) locked = true;
      if (axisMode === 'z' && (d === 'e' || d === 'w')) locked = true;
      b.classList.toggle('axis-locked', locked);
    });
  }

  function init() {
    const reg = GF.commands.register;
    reg({ id: 'transform.nudge', title: 'Nudge selected', group: 'Transform', palette: false, run: a => move(a.dx || 0, a.dy || 0) });
    reg({ id: 'transform.rotateStep', title: 'Rotate selected by step', group: 'Transform', palette: false, run: a => rotate(a.deg == null ? ROT_STEP : a.deg) });
    reg({ id: 'transform.scaleStep', title: 'Scale selected by step', group: 'Transform', palette: false, run: a => scale(a.factor == null ? SCALE_STEP : a.factor) });
    reg({ id: 'transform.cycleAxis', title: 'Cycle transform axis lock', group: 'Transform', run: cycleAxis });
    build();
    if (S() && S().onChange) S().onChange(updateVisibility);
    window.addEventListener('pt:editmode', () => { if (padEl) padEl.style.display = GF.editmesh && GF.editmesh.isActive() ? 'none' : ''; });
  }

  function injectStyle() {
    if (document.getElementById('tpad-style')) return;
    const css = `
    #transform-pad{position:fixed;left:14px;bottom:34px;z-index:70;
      display:grid;grid-template-columns:repeat(3,44px);grid-template-rows:repeat(3,44px);gap:3px;padding:5px;
      background:rgba(18,20,26,.94);border:1px solid rgba(255,255,255,.1);border-radius:14px;
      box-shadow:0 8px 26px rgba(0,0,0,.5);backdrop-filter:blur(8px);transition:opacity .18s}
    #transform-pad.tpad-idle .tpad-btn:not(.tpad-c){opacity:.3;pointer-events:none}
    #transform-pad.tpad-idle .tpad-c{opacity:.5}
    #transform-pad.tpad-active{opacity:1}
    .tpad-hint{position:absolute;top:5px;left:5px;right:5px;bottom:22px;display:flex;align-items:center;
      justify-content:center;font-size:10px;color:#7d8794;pointer-events:none;text-align:center;
      line-height:1.4;opacity:0;transition:opacity .18s}
    #transform-pad.tpad-idle .tpad-hint{opacity:1}
    .tpad-btn{display:flex;align-items:center;justify-content:center;border-radius:9px;
      border:1.5px solid rgba(255,255,255,.1);background:rgba(255,255,255,.04);color:#c9ced6;
      cursor:pointer;padding:0;touch-action:none;user-select:none;transition:.1s}
    .tpad-btn svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
    .tpad-btn:hover{background:rgba(232,163,61,.16);color:#fff;border-color:#e8a33d}
    .tpad-btn:active,.tpad-btn.pressed{transform:scale(.9);background:#e8a33d;color:#1a1400;border-color:#e8a33d}
    .tpad-btn.axis-locked{opacity:.25;pointer-events:none}
    .tpad-c{background:rgba(255,255,255,.06);font-weight:800;font-size:14px}
    .tpad-c[data-axis="x"]{color:#e5634d;border-color:#e5634d}
    .tpad-c[data-axis="y"]{color:#5bbf7a;border-color:#5bbf7a}
    .tpad-c[data-axis="z"]{color:#5b9fd6;border-color:#5b9fd6}
    .tpad-nw{grid-area:1/1}.tpad-n{grid-area:1/2}.tpad-ne{grid-area:1/3}
    .tpad-w{grid-area:2/1}.tpad-c{grid-area:2/2}.tpad-e{grid-area:2/3}
    .tpad-sw{grid-area:3/1}.tpad-s{grid-area:3/2}.tpad-se{grid-area:3/3}
    .tpad-label{grid-column:1/4;text-align:center;font-size:9.5px;color:#7d8794;letter-spacing:.02em;margin-top:1px}
    @media (max-width:880px){#transform-pad{bottom:114px;grid-template-columns:repeat(3,40px);grid-template-rows:repeat(3,40px)}}`;
    const s = document.createElement('style'); s.id = 'tpad-style'; s.textContent = css; document.head.appendChild(s);
  }

  return { init, startGesture, endGesture, move, rotate, scale, cycleAxis };
})();
