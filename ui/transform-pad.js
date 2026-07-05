/* PixelTriks — transform-pad.js
   The "joystick" — a 3×3 grid of directional buttons for precise transforms.
   Positioned bottom-left (left thumb on a game controller).
   9 buttons: 4 move (N/S/E/W), 2 rotate (NW/NE), 2 scale (SW/SE), 1 center (axis mode).
   Works on 2D layers AND 3D objects through GF.api.

   Architecture:
   - Always visible when something is selected (dimmed otherwise)
   - Center button cycles axis lock: Free → X → Y → Z (3D only)
   - Tap = 1 unit nudge. Hold = continuous with acceleration.
   - Shift+tap = 10x nudge. Ctrl+tap = snap to grid.
*/
'use strict';
window.GF = window.GF || {};

GF.transformPad = (function () {
  const D = () => GF.doc;
  const S = () => GF.scene3d;
  const V = () => GF.view;
  const is3D = () => document.body.dataset.mode === '3d';

  /* ─── State ─── */
  let axisMode = 'free';       // free | x | y | z
  let holdTimer = null;        // requestAnimationFrame id
  let holdDir = null;          // currently held direction
  let holdStart = 0;           // timestamp of hold start
  let padEl = null;            // root DOM element
  let visible = false;

  /* ─── Config ─── */
  const BASE_STEP_2D = 1;     // 1px per tap
  const BASE_STEP_3D = 0.1;   // 0.1 units per tap
  const SHIFT_MULT = 10;      // shift multiplier
  const ACCEL_DELAY = 300;    // ms before acceleration starts
  const ACCEL_MAX = 8;        // max multiplier during hold
  const ROT_STEP = 15;        // degrees per tap
  const ROT_STEP_FINE = 5;    // degrees per tap with shift
  const SCALE_STEP = 1.1;     // 10% per tap
  const SCALE_STEP_FINE = 1.02; // 2% per tap with shift

  /* ─── Axis modes ─── */
  const AXIS_MODES_2D = ['free', 'x', 'y'];
  const AXIS_MODES_3D = ['free', 'x', 'y', 'z'];
  const AXIS_LABELS = { free: '⊕', x: '━', y: '┃', z: '⬡' };
  const AXIS_TITLES = { free: 'Free move', x: 'X-axis lock', y: 'Y-axis lock', z: 'Z-axis lock' };

  /* ─── Step calculation ─── */
  function step(e) {
    const base = is3D() ? BASE_STEP_3D : BASE_STEP_2D;
    return e && e.shiftKey ? base * SHIFT_MULT : base;
  }

  function rotStep(e) {
    return e && e.shiftKey ? ROT_STEP_FINE : ROT_STEP;
  }

  function scaleFactor(e) {
    return e && e.shiftKey ? SCALE_STEP_FINE : SCALE_STEP;
  }

  /* ─── Transform actions ─── */
  function move(dx, dy, dz) {
    // Apply axis lock
    if (axisMode === 'x') { dy = 0; dz = 0; }
    if (axisMode === 'y') { dx = 0; dz = 0; }
    if (axisMode === 'z') { dx = 0; dy = 0; }

    if (is3D()) {
      move3D(dx, dy, dz || 0);
    } else {
      move2D(dx, dy);
    }
  }

  function move2D(dx, dy) {
    const doc = D();
    if (!doc || !doc.doc.open) return;
    const layer = doc.activeLayer();
    if (!layer) return;
    GF.history.push(doc.doc, 'move');
    layer.ox = (layer.ox || 0) + dx;
    layer.oy = (layer.oy || 0) + dy;
    V().requestRender();
  }

  function move3D(dx, dy, dz) {
    const scene = S();
    if (!scene) return;
    const obj = scene.selected();
    if (!obj) return;
    obj.position.x += dx;
    obj.position.y += dz;  // Y is up in three.js
    obj.position.z += dy;  // Z is depth
    scene.requestRender();
  }

  function rotate(deg) {
    if (is3D()) {
      rotate3D(deg);
    } else {
      rotate2D(deg);
    }
  }

  function rotate2D(deg) {
    const doc = D();
    if (!doc || !doc.doc.open) return;
    const layer = doc.activeLayer();
    if (!layer) return;
    GF.history.push(doc.doc, 'rotate');
    layer.rotation = ((layer.rotation || 0) + deg) % 360;
    V().requestRender();
  }

  function rotate3D(deg) {
    const scene = S();
    if (!scene) return;
    const obj = scene.selected();
    if (!obj) return;
    const rad = deg * Math.PI / 180;
    if (axisMode === 'x') obj.rotation.x += rad;
    else if (axisMode === 'z') obj.rotation.z += rad;
    else obj.rotation.y += rad; // default: rotate around Y
    scene.requestRender();
  }

  function scale(factor) {
    if (is3D()) {
      scale3D(factor);
    } else {
      scale2D(factor);
    }
  }

  function scale2D(factor) {
    const doc = D();
    if (!doc || !doc.doc.open) return;
    const layer = doc.activeLayer();
    if (!layer) return;
    GF.history.push(doc.doc, 'scale');
    layer.scaleX = (layer.scaleX || 1) * factor;
    layer.scaleY = (layer.scaleY || 1) * factor;
    V().requestRender();
  }

  function scale3D(factor) {
    const scene = S();
    if (!scene) return;
    const obj = scene.selected();
    if (!obj) return;
    if (axisMode === 'x') obj.scale.x *= factor;
    else if (axisMode === 'y') obj.scale.y *= factor;
    else if (axisMode === 'z') obj.scale.z *= factor;
    else { obj.scale.x *= factor; obj.scale.y *= factor; obj.scale.z *= factor; }
    scene.requestRender();
  }

  function cycleAxis() {
    const modes = is3D() ? AXIS_MODES_3D : AXIS_MODES_2D;
    const idx = modes.indexOf(axisMode);
    axisMode = modes[(idx + 1) % modes.length];
    updateCenterButton();
    updateAxisDimming();
  }

  /* ─── Direction → action mapping ─── */
  const DIRS = {
    nw: (e) => rotate(-rotStep(e)),
    n:  (e) => move(0, -step(e), 0),
    ne: (e) => rotate(+rotStep(e)),
    w:  (e) => move(-step(e), 0, 0),
    c:  ()  => cycleAxis(),
    e:  (e) => move(+step(e), 0, 0),
    sw: (e) => scale(1 / scaleFactor(e)),
    s:  (e) => move(0, +step(e), 0),
    se: (e) => scale(scaleFactor(e)),
  };

  /* ─── Hold-to-repeat ─── */
  function startHold(dir, e) {
    if (dir === 'c') return; // center doesn't repeat
    holdDir = dir;
    holdStart = performance.now();
    doHoldFrame(e);
  }

  function doHoldFrame(e) {
    if (!holdDir) return;
    const elapsed = performance.now() - holdStart;
    if (elapsed > ACCEL_DELAY) {
      // Accelerate: ramp from 1x to ACCEL_MAX over 2 seconds
      const accelProgress = Math.min((elapsed - ACCEL_DELAY) / 2000, 1);
      const mult = 1 + accelProgress * (ACCEL_MAX - 1);
      // Execute multiple times for smooth acceleration
      const times = Math.ceil(mult);
      for (let i = 0; i < times; i++) DIRS[holdDir](e);
    } else {
      DIRS[holdDir](e);
    }
    holdTimer = requestAnimationFrame(() => doHoldFrame(e));
  }

  function stopHold() {
    holdDir = null;
    if (holdTimer) {
      cancelAnimationFrame(holdTimer);
      holdTimer = null;
    }
  }

  /* ─── DOM ─── */
  function build() {
    padEl = document.createElement('div');
    padEl.id = 'transform-pad';
    padEl.className = 'tpad';
    padEl.innerHTML = `
      <button class="tpad-btn tpad-nw" data-dir="nw" title="Rotate left (CCW)">
        <svg viewBox="0 0 24 24"><path d="M12 5C7.6 5 4 8.6 4 13h2c0-3.3 2.7-6 6-6s6 2.7 6 6h2c0-4.4-3.6-8-8-8z"/><path d="M7 9L4 13l3 4"/></svg>
        <span>↶</span>
      </button>
      <button class="tpad-btn tpad-n" data-dir="n" title="Move up">
        <svg viewBox="0 0 24 24"><path d="M12 4l-6 6h4v8h4v-8h4z"/></svg>
        <span>↑</span>
      </button>
      <button class="tpad-btn tpad-ne" data-dir="ne" title="Rotate right (CW)">
        <svg viewBox="0 0 24 24"><path d="M12 5c4.4 0 8 3.6 8 8h-2c0-3.3-2.7-6-6-6s-6 2.7-6 6H4c0-4.4 3.6-8 8-8z"/><path d="M17 9l3 4-3 4"/></svg>
        <span>↷</span>
      </button>
      <button class="tpad-btn tpad-w" data-dir="w" title="Move left">
        <svg viewBox="0 0 24 24"><path d="M4 12l6-6v4h8v4h-8v4z"/></svg>
        <span>←</span>
      </button>
      <button class="tpad-btn tpad-c" data-dir="c" title="Axis mode: Free">
        <span class="tpad-axis">${AXIS_LABELS[axisMode]}</span>
      </button>
      <button class="tpad-btn tpad-e" data-dir="e" title="Move right">
        <svg viewBox="0 0 24 24"><path d="M20 12l-6-6v4H6v4h8v4z"/></svg>
        <span>→</span>
      </button>
      <button class="tpad-btn tpad-sw" data-dir="sw" title="Scale down">
        <svg viewBox="0 0 24 24"><path d="M5 19h14M12 5v14M8 15l4 4 4-4"/></svg>
        <span>−</span>
      </button>
      <button class="tpad-btn tpad-s" data-dir="s" title="Move down">
        <svg viewBox="0 0 24 24"><path d="M12 20l6-6h-4V6h-4v8H6z"/></svg>
        <span>↓</span>
      </button>
      <button class="tpad-btn tpad-se" data-dir="se" title="Scale up">
        <svg viewBox="0 0 24 24"><path d="M5 5h14M12 5v14M8 9l4-4 4 4"/></svg>
        <span>+</span>
      </button>
    `;

    // Event delegation
    padEl.addEventListener('pointerdown', onDown);
    padEl.addEventListener('pointerup', onUp);
    padEl.addEventListener('pointerleave', onUp);
    padEl.addEventListener('contextmenu', e => e.preventDefault());

    document.body.appendChild(padEl);
    updateVisibility();
  }

  function onDown(e) {
    const btn = e.target.closest('[data-dir]');
    if (!btn) return;
    e.preventDefault();
    btn.classList.add('pressed');
    const dir = btn.dataset.dir;

    // Immediate tap action
    DIRS[dir](e);

    // Start hold for continuous movement (not center)
    if (dir !== 'c') {
      startHold(dir, e);
    }
  }

  function onUp(e) {
    stopHold();
    padEl.querySelectorAll('.pressed').forEach(b => b.classList.remove('pressed'));
  }

  /* ─── Visibility ─── */
  function updateVisibility() {
    if (!padEl) return;
    const hasTarget = hasSelection();
    padEl.classList.toggle('tpad-active', hasTarget);
    padEl.classList.toggle('tpad-dimmed', !hasTarget);
    visible = hasTarget;
  }

  function hasSelection() {
    if (is3D()) {
      const scene = S();
      return scene && scene.selected && scene.selected();
    } else {
      const doc = D();
      return doc && doc.doc.open && doc.activeLayer && doc.activeLayer();
    }
  }

  /* ─── Center button updates ─── */
  function updateCenterButton() {
    if (!padEl) return;
    const center = padEl.querySelector('.tpad-c');
    if (!center) return;
    const axisSpan = center.querySelector('.tpad-axis');
    if (axisSpan) axisSpan.textContent = AXIS_LABELS[axisMode];
    center.title = 'Axis mode: ' + AXIS_TITLES[axisMode];
    center.dataset.axis = axisMode;
  }

  function updateAxisDimming() {
    if (!padEl) return;
    // Dim directions that are locked out
    const dirs = padEl.querySelectorAll('[data-dir]');
    dirs.forEach(btn => {
      const dir = btn.dataset.dir;
      let dimmed = false;
      if (axisMode === 'x' && (dir === 'n' || dir === 's')) dimmed = true;
      if (axisMode === 'y' && (dir === 'w' || dir === 'e')) dimmed = true;
      if (axisMode === 'z' && (dir === 'n' || dir === 's' || dir === 'w' || dir === 'e')) dimmed = true;
      btn.classList.toggle('axis-locked', dimmed);
    });
  }

  /* ─── Public ─── */
  function init() {
    build();
    // Re-check visibility on relevant events
    document.addEventListener('selectionchange', updateVisibility);
    // Listen for custom events from the engine
    window.addEventListener('pt:layerchange', updateVisibility);
    window.addEventListener('pt:sceneselect', updateVisibility);
    window.addEventListener('pt:modechange', () => {
      // Reset axis mode when switching 2D/3D
      if (!is3D() && axisMode === 'z') axisMode = 'free';
      updateCenterButton();
      updateAxisDimming();
      updateVisibility();
    });
  }

  function show() { if (padEl) padEl.style.display = ''; }
  function hide() { if (padEl) padEl.style.display = 'none'; }
  function setAxis(mode) { axisMode = mode; updateCenterButton(); updateAxisDimming(); }
  function getAxis() { return axisMode; }
  function refresh() { updateVisibility(); }

  return { init, show, hide, setAxis, getAxis, refresh };
})();
