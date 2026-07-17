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
  const DZ = 0.18;            // scaled radial dead zone
  const CURVE = 1.6;          // response exponent (slow start, fast finish)
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

  let raf = 0, last = 0, padIndex = null, prev = [], connected = false;
  let moveGesture = false;

  /* Scaled radial dead zone + power curve — motion ramps smoothly from zero,
     small deflections give sub-pixel precision, full deflection is fast. */
  function shape(x, y) {
    const mag = Math.hypot(x, y);
    if (mag < DZ) return { x: 0, y: 0, mag: 0 };
    const curved = Math.pow(Math.min(1, (mag - DZ) / (1 - DZ)), CURVE);
    return { x: x / mag * curved, y: y / mag * curved, mag: curved };
  }

  const exec = (id, args) => { try { GF.commands.execute(id, args); } catch (e) { GF.util.toast(e.message); } };

  function rumble(gp, ms, mag) {
    const act = gp && gp.vibrationActuator;
    if (act && act.playEffect) {
      try { act.playEffect('dual-rumble', { duration: ms, strongMagnitude: mag || 0.4, weakMagnitude: 0.15 }).catch(() => {}); } catch (e) {}
    }
  }

  /* ---- cycle selection: layers in 2D, objects in 3D ---- */
  function cycle(dir) {
    GF.context.sync();
    if (GF.context.get('mode3d')) {
      const S = GF.scene3d; if (!S) return;
      const list = S.listObjects(); if (!list.length) return;
      const idx = list.findIndex(o => o.id === S.selectedId());
      S.select(list[(idx + dir + list.length) % list.length].id);
    } else {
      const D = GF.doc, layers = D.doc.layers; if (!layers.length) return;
      const idx = layers.findIndex(l => l.id === D.doc.activeId);
      D.doc.activeId = layers[(idx + dir + layers.length) % layers.length].id;
      GF.ui.refreshLayers(); GF.view.requestRender();
    }
  }

  /* B = back: deselect object (3D) / clear selection (2D) */
  function back() {
    GF.context.sync();
    if (GF.context.get('mode3d')) { if (GF.scene3d) GF.scene3d.select(null); }
    else exec('api.deselect');
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
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, (t - last) / 1000) || 0.016; last = t;
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let gp = padIndex != null ? pads[padIndex] : null;
    if (!gp || !gp.connected) {
      gp = Array.prototype.find.call(pads, p => p && p.connected);
      padIndex = gp ? gp.index : null;
    }
    if (!gp) return;
    if (!connected) activate(gp);

    if (paletteOpen()) {
      // controller-navigable palette: d-pad browses, A runs, B closes
      if (pressed(gp, B.DOWN)) paletteKey('ArrowDown');
      if (pressed(gp, B.UP)) paletteKey('ArrowUp');
      if (pressed(gp, B.A)) paletteKey('Enter');
      if (pressed(gp, B.B) || pressed(gp, B.START)) paletteKey('Escape');
    } else {
      /* ---- discrete: pure binding table → registry ---- */
      if (pressed(gp, B.LEFT))  { exec('api.undo'); rumble(gp, 25); }
      if (pressed(gp, B.RIGHT)) { exec('api.redo'); rumble(gp, 25); }
      if (pressed(gp, B.UP))    exec('transform.nudge', { dy: -1 });
      if (pressed(gp, B.DOWN))  exec('transform.nudge', { dy: 1 });
      if (pressed(gp, B.START)) exec('view.commandPalette');
      if (pressed(gp, B.SELECT)) exec('view.toggleMode');
      if (pressed(gp, B.B)) back();
      if (pressed(gp, B.X)) slot(0);
      if (pressed(gp, B.Y)) slot(1);
      if (pressed(gp, B.L1)) exec('cycle.prev');
      if (pressed(gp, B.R1)) exec('cycle.next');
      if (pressed(gp, B.L3)) exec('view.fit');

      /* ---- analog: trigger clutches rebind the left stick ---- */
      const ls = shape(gp.axes[0] || 0, gp.axes[1] || 0);
      const rs = shape(gp.axes[2] || 0, gp.axes[3] || 0);
      const l2 = gp.buttons[B.L2] ? gp.buttons[B.L2].value : 0;
      const r2 = gp.buttons[B.R2] ? gp.buttons[B.R2].value : 0;
      const fine = v => (v > TRIGGER_ON && v < 0.7) ? FINE : 1;

      if (ls.mag) {
        if (!moveGesture) { moveGesture = true; GF.transformPad.startGesture('gamepad transform'); }
        if (l2 > TRIGGER_ON) {
          exec('transform.rotateStep', { deg: ls.x * ROT_RATE * dt * fine(l2) });
        } else if (r2 > TRIGGER_ON) {
          exec('transform.scaleStep', { factor: Math.pow(1 + SCALE_RATE * dt * fine(r2), -ls.y) });  // stick up = grow
        } else {
          const rate = (GF.context.get('mode3d') ? MOVE_RATE_3D : MOVE_RATE_2D) * dt;
          exec('transform.nudge', { dx: ls.x * rate, dy: ls.y * rate });
        }
      } else if (moveGesture) {
        moveGesture = false;
        GF.transformPad.endGesture();
      }

      if (rs.mag) {
        if (GF.context.get('mode3d') && GF.scene3d && GF.scene3d.orbitCamera) {
          GF.scene3d.orbitCamera(rs.x * ORBIT_RATE * dt, rs.y * ORBIT_RATE * dt);
        } else if (GF.view && GF.view.view) {
          GF.view.view.panX -= rs.x * PAN_RATE * dt;
          GF.view.view.panY -= rs.y * PAN_RATE * dt;
          GF.view.requestRender();
        }
      }
    }

    prev = gp.buttons.map(b => b.pressed);
  }

  function init() {
    GF.commands.register({ id: 'cycle.prev', title: 'Select previous layer / object', group: 'View', palette: false, run: () => cycle(-1) });
    GF.commands.register({ id: 'cycle.next', title: 'Select next layer / object', group: 'View', palette: false, run: () => cycle(1) });
    window.addEventListener('gamepaddisconnected', e => {
      if (padIndex === e.gamepad.index) {
        padIndex = null; connected = false;
        document.body.classList.remove('gamepad-on');
        GF.util.toast('Controller disconnected');
      }
    });
    if (!raf) raf = requestAnimationFrame(frame);
  }

  return { init, _shape: shape, isConnected: () => connected };
})();
