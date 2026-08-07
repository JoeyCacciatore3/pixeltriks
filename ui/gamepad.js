/* PixelTriks — gamepad.js
   Physical controller support. The gamepad is a BINDING TABLE over the
   command registry: discrete inputs dispatch GF.commands.execute(), analog
   sticks drive the same transform verbs as the on-screen Transform Pad
   (transform.nudge / rotateStep / scaleStep), batched into gestures so one
   stick drag is ONE history entry.

   Grammar (Dreams-informed — docs/GAME-DECK-V2-ROADMAP.md §3):
   - Left stick        move selected layer / 3D object
   - L2 held + stick   rotate          R2 held + stick   scale
     (trigger half-press = fine control)
   - Right stick       orbit camera (3D) / pan canvas (2D)
   - D-pad ◄ ►        undo / redo     D-pad ▲ ▼        nudge 1px
   - X / Y             hotbar slots 1 / 2 (the hotbar IS the button legend)
   - A / B             confirm (palette) / deselect·close
   - L1 / R1           cycle layer (2D) or object (3D)   L3  fit view
   - Start             command palette     Select        2D ↔ 3D

   Browser notes: polled via navigator.getGamepads() (no button events);
   empty until the first button press while focused (W3C gesture gate);
   rumble is Chromium-only progressive enhancement. */
'use strict';
window.GF = window.GF || {};

GF.gamepad = (function () {
  const MOVE_RATE_2D = 240;   // px/sec at full deflection
  const MOVE_RATE_3D = 2.4;   // world units/sec
  const ROT_RATE = 140;       // deg/sec
  const SCALE_RATE = 1.0;     // scale speed
  const PAN_RATE = 520;       // canvas px/sec
  const ORBIT_RATE = 2.2;     // rad/sec
  const TRIGGER_ON = 0.12;    // trigger engage threshold
  const FINE = 0.25;          // half-press precision multiplier

  // W3C "standard" mapping indices
  const B = { A: 0, B: 1, X: 2, Y: 3, L1: 4, R1: 5, L2: 6, R2: 7,
              SELECT: 8, START: 9, L3: 10, R3: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15 };

  /* ─── Discrete button layout: pure DATA (button → command id [+ args]).
     User overrides persist in localStorage and win; ui/remap.js edits them. */
  const PAD_DEFAULTS = {
    LEFT:   { id: 'api.undo' },
    RIGHT:  { id: 'api.redo' },
    UP:     { id: 'transform.nudge', args: { dy: -1 } },
    DOWN:   { id: 'transform.nudge', args: { dy: 1 } },
    START:  { id: 'view.commandPalette' },
    B:      { id: 'edit.back' },
    X:      { id: 'hotbar.slot1' },
    Y:      { id: 'hotbar.slot2' },
    L1:     { id: 'cycle.prev' },
    R1:     { id: 'cycle.next' },
    L3:     { id: 'view.fit' },
  };
  const LS_PAD = 'pt-pad-overrides', LS_TUNE = 'pt-pad-tuning';
  let padMap = {};

  /* ─── Feel: user-tunable (Dreams a11y precedent — ui/remap.js sliders) ─── */
  const TUNE_DEFAULTS = { sens: 1, dz: 0.18, curve: 1.6 };
  let tune = Object.assign({}, TUNE_DEFAULTS);

  let raf = 0, last = 0, padIndex = null, prev = [], connected = false;
  let moveGesture = false;

  /* Scaled radial dead zone + power curve — motion ramps smoothly from zero,
     small deflections give sub-pixel precision, full deflection is fast. */
  function shape(x, y) {
    const mag = Math.hypot(x, y);
    if (mag < tune.dz) return { x: 0, y: 0, mag: 0 };
    const curved = Math.pow(Math.min(1, (mag - tune.dz) / (1 - tune.dz)), tune.curve);
    return { x: x / mag * curved, y: y / mag * curved, mag: curved };
  }

  function loadPrefs() {
    padMap = {};
    for (const k in PAD_DEFAULTS) padMap[k] = Object.assign({}, PAD_DEFAULTS[k]);
    try {
      const o = JSON.parse(localStorage.getItem(LS_PAD) || '{}');
      for (const k in o) if (padMap[k] && GF.commands.has(o[k])) padMap[k] = { id: o[k] };
    } catch (e) {}
    try { Object.assign(tune, JSON.parse(localStorage.getItem(LS_TUNE) || '{}')); } catch (e) {}
  }

  /* ─── Remap / tuning API (consumed by ui/remap.js) ─── */
  function getBindings() { const out = {}; for (const k in padMap) out[k] = padMap[k].id; return out; }
  function getDefaults() { const out = {}; for (const k in PAD_DEFAULTS) out[k] = PAD_DEFAULTS[k].id; return out; }
  function setBinding(btn, id) {
    if (!(btn in PAD_DEFAULTS)) throw new Error('unknown pad button: ' + btn);
    if (!GF.commands.has(id)) throw new Error('unknown command: ' + id);
    padMap[btn] = (id === PAD_DEFAULTS[btn].id) ? Object.assign({}, PAD_DEFAULTS[btn]) : { id };
    const o = {};
    for (const k in padMap) if (padMap[k].id !== PAD_DEFAULTS[k].id) o[k] = padMap[k].id;
    try { localStorage.setItem(LS_PAD, JSON.stringify(o)); } catch (e) {}
  }
  function getTuning() { return Object.assign({}, tune); }
  function setTuning(patch) {
    Object.assign(tune, patch);
    tune.sens = Math.min(3, Math.max(0.2, +tune.sens || 1));
    tune.dz = Math.min(0.4, Math.max(0.05, +tune.dz || TUNE_DEFAULTS.dz));
    tune.curve = Math.min(3, Math.max(1, +tune.curve || TUNE_DEFAULTS.curve));
    try { localStorage.setItem(LS_TUNE, JSON.stringify(tune)); } catch (e) {}
  }
  function resetPrefs() {
    try { localStorage.removeItem(LS_PAD); localStorage.removeItem(LS_TUNE); } catch (e) {}
    tune = Object.assign({}, TUNE_DEFAULTS);
    loadPrefs();
  }

  const exec = (id, args) => { try { GF.commands.execute(id, args); } catch (e) { GF.util.toast(e.message); } };

  function rumble(gp, ms, mag) {
    const act = gp && gp.vibrationActuator;
    if (act && act.playEffect) {
      try { act.playEffect('dual-rumble', { duration: ms, strongMagnitude: mag || 0.4, weakMagnitude: 0.15 }).catch(() => {}); } catch (e) {}
    }
  }

  /* ---- cycle selection: 3D objects ---- */
  function cycle(dir) {
    const S = GF.scene3d; if (!S) return;
    const list = S.listObjects(); if (!list.length) return;
    const idx = list.findIndex(o => o.id === S.selectedId());
    S.select(list[(idx + dir + list.length) % list.length].id);
  }

  /* B = back: deselect the 3D object */
  function back() {
    if (GF.scene3d) GF.scene3d.select(null);
  }

  /* X/Y run the first two hotbar slots — the hotbar is the button legend */
  function slot(n) {
    const ids = GF.hotbar && GF.hotbar.contextActions ? GF.hotbar.contextActions() : [];
    if (ids[n]) exec(ids[n]);
  }

  /* palette navigation: reuse the palette's own keyboard handling */
  function paletteOpen() { return !!document.querySelector('.cmdk'); }
  function paletteKey(key) {
    const input = document.querySelector('.cmdk-input');
    if (input) input.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }));
  }

  function pressed(gp, i) { return !!(gp.buttons[i] && gp.buttons[i].pressed) && !prev[i]; }

  function activate(gp) {
    connected = true;
    document.body.classList.add('gamepad-on');
    GF.util.toast('🎮 Controller connected — Start = palette · X/Y = hotbar · ◄► = undo/redo');
    rumble(gp, 120, 0.6);
    if (GF.hotbar) GF.hotbar.refresh();
  }

  function frame(t) {
    const dt = Math.min(0.05, (t - last) / 1000) || 0.016; last = t;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = padIndex != null ? pads[padIndex] : null;
    if (!gp || !gp.connected) {
      gp = Array.prototype.find.call(pads, p => p && p.connected);
      padIndex = gp ? gp.index : null;
    }
    /* BUG-022 fix: stop the RAF loop when no controller is connected.
       Restart via gamepadconnected event. Saves battery on mobile. */
    if (!gp) { raf = null; return; }
    raf = requestAnimationFrame(frame);
    if (!connected) activate(gp);

    if (paletteOpen()) {
      // controller-navigable palette: d-pad browses, A runs, B closes
      if (pressed(gp, B.DOWN)) paletteKey('ArrowDown');
      if (pressed(gp, B.UP)) paletteKey('ArrowUp');
      if (pressed(gp, B.A)) paletteKey('Enter');
      if (pressed(gp, B.B) || pressed(gp, B.START)) paletteKey('Escape');
    } else {
      /* ---- discrete: pure binding table → registry ---- */
      for (const btn in padMap) {
        if (pressed(gp, B[btn])) {
          exec(padMap[btn].id, padMap[btn].args);
          if (padMap[btn].id === 'api.undo' || padMap[btn].id === 'api.redo') rumble(gp, 25);
        }
      }

      /* ---- analog: trigger clutches rebind the left stick ---- */
      const ls = shape(gp.axes[0] || 0, gp.axes[1] || 0);
      const rs = shape(gp.axes[2] || 0, gp.axes[3] || 0);
      const l2 = gp.buttons[B.L2] ? gp.buttons[B.L2].value : 0;
      const r2 = gp.buttons[B.R2] ? gp.buttons[B.R2].value : 0;
      const fine = v => (v > TRIGGER_ON && v < 0.7) ? FINE : 1;

      if (ls.mag) {
        if (!moveGesture) { moveGesture = true; GF.transformPad.startGesture('gamepad transform'); }
        if (l2 > TRIGGER_ON) {
          exec('transform.rotateStep', { deg: ls.x * ROT_RATE * tune.sens * dt * fine(l2) });
        } else if (r2 > TRIGGER_ON) {
          exec('transform.scaleStep', { factor: Math.pow(1 + SCALE_RATE * tune.sens * dt * fine(r2), -ls.y) });  // stick up = grow
        } else {
          const rate = MOVE_RATE_3D * tune.sens * dt;
          exec('transform.nudge', { dx: ls.x * rate, dy: ls.y * rate });
        }
      } else if (moveGesture) {
        moveGesture = false;
        GF.transformPad.endGesture();
      }

      if (rs.mag) {
        if (GF.scene3d && GF.scene3d.orbitCamera) {
          GF.scene3d.orbitCamera(rs.x * ORBIT_RATE * tune.sens * dt, rs.y * ORBIT_RATE * tune.sens * dt);
        }
      }
    }

    prev = gp.buttons.map(b => b.pressed);
  }

  function init() {
    GF.commands.register({ id: 'cycle.prev', title: 'Select previous layer / object', group: 'View', palette: false, run: () => cycle(-1) });
    GF.commands.register({ id: 'cycle.next', title: 'Select next layer / object', group: 'View', palette: false, run: () => cycle(1) });
    GF.commands.register({ id: 'edit.back', title: 'Back — deselect / close', group: 'Edit', palette: false, run: back });
    GF.commands.register({ id: 'hotbar.slot1', title: 'Run hotbar slot 1', group: 'View', palette: false, run: () => slot(0) });
    GF.commands.register({ id: 'hotbar.slot2', title: 'Run hotbar slot 2', group: 'View', palette: false, run: () => slot(1) });
    loadPrefs();
    /* BUG-022 fix: start RAF loop on connect, stop on disconnect */
    window.addEventListener('gamepadconnected', () => { if (!raf) raf = requestAnimationFrame(frame); });
    window.addEventListener('gamepaddisconnected', e => {
      if (padIndex === e.gamepad.index) {
        padIndex = null; connected = false;
        document.body.classList.remove('gamepad-on');
        GF.util.toast('Controller disconnected');
      }
    });
    /* Check if a gamepad is already connected at init time */
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    if (Array.prototype.find.call(pads, p => p && p.connected)) { if (!raf) raf = requestAnimationFrame(frame); }
  }

  return { init, _shape: shape, isConnected: () => connected,
           getBindings, getDefaults, setBinding, getTuning, setTuning, resetPrefs };
})();
