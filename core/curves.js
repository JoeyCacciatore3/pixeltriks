/* PixelTriks — curves.js
   Interactive tone-curve editor widget: a square canvas with a draggable
   control-point curve per channel (RGB/R/G/B), drawn over a histogram.
   Pure UI — the LUT math lives in GF.filters (buildLut / curveLuts). */
'use strict';
window.GF = window.GF || {};

GF.curveEditor = (function () {
  const U = GF.util;
  const PAD = 14;
  let cv, ctx, W, H, onChange = () => {}, onStart = () => {};
  let channel = 'rgb';
  let points = identity();
  let hist = null;                 // Uint32Array(256) for the current channel
  let drag = -1;

  function identity() { return { rgb: [[0, 0], [255, 255]], r: [[0, 0], [255, 255]], g: [[0, 0], [255, 255]], b: [[0, 0], [255, 255]] }; }
  function cur() { return points[channel]; }

  // curve(0–255) <-> canvas px
  const cx = v => PAD + (v / 255) * (W - 2 * PAD);
  const cy = v => (H - PAD) - (v / 255) * (H - 2 * PAD);
  const ix = px => Math.round((px - PAD) / (W - 2 * PAD) * 255);
  const iy = py => Math.round(((H - PAD) - py) / (H - 2 * PAD) * 255);

  function render() {
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#0c0e11'; ctx.fillRect(0, 0, W, H);
    // histogram
    if (hist) {
      let max = 1; for (const v of hist) if (v > max) max = v;
      ctx.fillStyle = channel === 'r' ? 'rgba(220,80,80,.5)' : channel === 'g' ? 'rgba(80,200,100,.5)' : channel === 'b' ? 'rgba(90,140,230,.5)' : 'rgba(140,150,165,.45)';
      for (let i = 0; i < 256; i++) {
        const h = Math.pow(hist[i] / max, 0.5) * (H - 2 * PAD);
        ctx.fillRect(cx(i), (H - PAD) - h, Math.max(1, (W - 2 * PAD) / 256), h);
      }
    }
    // grid (diagonal + quarters)
    ctx.strokeStyle = '#272b33'; ctx.lineWidth = 1;
    for (let k = 0; k <= 4; k++) {
      ctx.beginPath(); ctx.moveTo(cx(k * 64), cy(0)); ctx.lineTo(cx(k * 64), cy(255)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(cx(0), cy(k * 64)); ctx.lineTo(cx(255), cy(k * 64)); ctx.stroke();
    }
    ctx.strokeStyle = '#3a4150'; ctx.beginPath(); ctx.moveTo(cx(0), cy(0)); ctx.lineTo(cx(255), cy(255)); ctx.stroke();
    // curve from the LUT
    const lut = GF.filters.buildLut(cur());
    ctx.strokeStyle = '#e8a33d'; ctx.lineWidth = 2; ctx.beginPath();
    for (let x = 0; x < 256; x++) { const px = cx(x), py = cy(lut[x]); x ? ctx.lineTo(px, py) : ctx.moveTo(px, py); }
    ctx.stroke();
    // points
    for (const [x, y] of cur()) {
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#e8a33d';
      ctx.beginPath(); ctx.arc(cx(x), cy(y), 4, 0, 7); ctx.fill(); ctx.stroke();
    }
  }

  function nearestPoint(px, py) {
    const p = cur(); let best = -1, bd = 12 * 12;
    for (let i = 0; i < p.length; i++) {
      const dx = cx(p[i][0]) - px, dy = cy(p[i][1]) - py, d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = i; }
    }
    return best;
  }

  function pointerPos(e) {
    const r = cv.getBoundingClientRect();
    return [(e.clientX - r.left) * (W / r.width), (e.clientY - r.top) * (H / r.height)];
  }

  function down(e) {
    cv.setPointerCapture(e.pointerId);
    onStart();
    const [px, py] = pointerPos(e);
    let i = nearestPoint(px, py);
    if (i < 0) {                       // add a new point
      const p = cur(); p.push([U.clamp(ix(px), 0, 255), U.clamp(iy(py), 0, 255)]);
      p.sort((a, b) => a[0] - b[0]);
      i = p.findIndex(q => q[0] === U.clamp(ix(px), 0, 255));
    }
    drag = i; move(e);
  }
  function move(e) {
    if (drag < 0) return;
    const p = cur(); const [px, py] = pointerPos(e);
    const isEnd = drag === 0 || drag === p.length - 1;
    let nx = U.clamp(ix(px), 0, 255), ny = U.clamp(iy(py), 0, 255);
    if (drag === 0) nx = 0; if (drag === p.length - 1) nx = 255;
    if (!isEnd) {                       // keep x between neighbours
      nx = U.clamp(nx, p[drag - 1][0] + 1, p[drag + 1][0] - 1);
    }
    p[drag][0] = nx; p[drag][1] = ny;
    render(); onChange();
  }
  function up(e) {
    if (drag > 0 && drag < cur().length - 1) {
      const [, py] = pointerPos(e);
      if (py < -8 || py > H + 8) { cur().splice(drag, 1); render(); onChange(); } // dragged off → delete
    }
    drag = -1;
  }

  function init(opts) {
    cv = opts.canvas; ctx = U.ctx2d(cv); W = cv.width; H = cv.height;
    onChange = opts.onChange || (() => {}); onStart = opts.onStart || (() => {});
    cv.addEventListener('pointerdown', down);
    cv.addEventListener('pointermove', move);
    cv.addEventListener('pointerup', up);
    cv.addEventListener('pointercancel', up);
    render();
  }

  // Return only the channels that differ from identity (compact for storage).
  function getCurves() {
    const out = {};
    for (const ch of ['rgb', 'r', 'g', 'b']) {
      const p = points[ch];
      const ident = p.length === 2 && p[0][0] === 0 && p[0][1] === 0 && p[1][0] === 255 && p[1][1] === 255;
      if (!ident) out[ch] = p.map(q => [q[0], q[1]]);
    }
    return out;
  }
  function setCurves(c) {
    points = identity();
    if (c) for (const ch of ['rgb', 'r', 'g', 'b']) if (c[ch]) points[ch] = c[ch].map(q => [q[0], q[1]]);
    render();
  }
  function setChannel(ch) { channel = ch; render(); }
  function resetChannel() { points[channel] = [[0, 0], [255, 255]]; render(); onChange(); }
  function setHistogram(h) { hist = h; render(); }
  function getChannel() { return channel; }

  return { init, getCurves, setCurves, setChannel, getChannel, resetChannel, setHistogram, render };
})();
