/* PixelTriks — select.js
   Pixel selection mask (0..255 coverage) shared by the magic wand, magic
   eraser, content-aware fill and color-replace tools. The mask is
   document-sized; operations read it as per-pixel coverage (255 = fully
   selected, 0 = outside, in-between = feathered edge).

   A "marching-ants" boundary canvas is cached and rebuilt only when the
   selection changes, so the per-frame viewport render is a single drawImage. */
'use strict';
window.GF = window.GF || {};

GF.select = (function () {
  const U = GF.util;
  const D = () => GF.doc.doc;

  let mask = null;      // Uint8ClampedArray, length w*h
  let mw = 0, mh = 0;
  let viz = [null, null]; // cached boundary canvases, two ant phases
  let maskCnv = null;     // cached canvas whose alpha = mask (clips paint ops)
  let dimCnv = null;      // cached dark veil that's transparent over the selection
  let cachedCount = -1;
  let listeners = [];

  function onChange(fn) { listeners.push(fn); }
  function emit() { viz = [null, null]; maskCnv = null; dimCnv = null; cachedCount = -1; listeners.forEach(f => f()); }

  function ensure() {
    const w = D().width, h = D().height;
    if (!mask || mw !== w || mh !== h) { mask = new Uint8ClampedArray(w * h); mw = w; mh = h; viz = null; }
    return mask;
  }

  function clear()    { ensure(); mask.fill(0);   emit(); }
  function selectAll(){ ensure(); mask.fill(255); emit(); }
  function invert()   { ensure(); for (let i = 0; i < mask.length; i++) mask[i] = 255 - mask[i]; emit(); }
  function get()      { return mask; }
  function dims()     { return { w: mw, h: mh }; }
  function has()      { return count() > 0; }
  function count() {
    if (!mask) return 0;
    if (cachedCount < 0) { let n = 0; for (let i = 0; i < mask.length; i++) if (mask[i] >= 128) n++; cachedCount = n; }
    return cachedCount;
  }

  /** Doc-sized canvas whose alpha channel is the selection coverage — used to
      clip strokes/gradients/shapes via destination-in compositing. */
  function maskCanvas() {
    if (maskCnv) return maskCnv;
    ensure();
    const c = GF.util.makeCanvas(mw, mh);
    const ctx = GF.util.ctx2d(c);
    const id = ctx.createImageData(mw, mh);
    for (let p = 0; p < mask.length; p++) id.data[p * 4 + 3] = mask[p];
    ctx.putImageData(id, 0, 0);
    maskCnv = c;
    return maskCnv;
  }

  /** Dark veil that's transparent over the selection — drawn over the canvas so
      the selected area stays bright and everything else dims. Makes a selection
      unmistakable. Cached; rebuilt only when the selection changes. */
  function dimCanvas() {
    if (dimCnv) return dimCnv;
    ensure();
    const c = GF.util.makeCanvas(mw, mh), ctx = GF.util.ctx2d(c);
    const id = ctx.createImageData(mw, mh), d = id.data;
    for (let p = 0; p < mask.length; p++) {
      const i = p * 4;
      d[i] = 8; d[i + 1] = 10; d[i + 2] = 14;
      d[i + 3] = Math.round((255 - mask[p]) * 0.55); // up to ~55% dim where unselected
    }
    ctx.putImageData(id, 0, 0);
    dimCnv = c;
    return dimCnv;
  }

  /** Rasterized-shape selection: read a doc-sized canvas's alpha (anti-aliased
      edges become soft coverage) and combine it into the mask. */
  function fromAlphaCanvas(canvas, mode) {
    ensure();
    const d = GF.util.ctx2d(canvas).getImageData(0, 0, mw, mh).data;
    const sel = new Uint8ClampedArray(mw * mh);
    for (let p = 0; p < sel.length; p++) sel[p] = d[p * 4 + 3];
    combine(sel, mode);
  }

  /** Combine an operation's selection into the master mask. */
  function combine(sel, mode) {
    ensure();
    if (mode === 'add')            { for (let i = 0; i < mask.length; i++) mask[i] = Math.max(mask[i], sel[i]); }
    else if (mode === 'subtract')  { for (let i = 0; i < mask.length; i++) mask[i] = Math.min(mask[i], 255 - sel[i]); }
    else if (mode === 'intersect') { for (let i = 0; i < mask.length; i++) mask[i] = Math.min(mask[i], sel[i]); }
    else                           { mask.set(sel); }
    emit();
  }

  /** Magic wand: select pixels similar to the one at (x0,y0). */
  function wand(img, x0, y0, tol, contiguous, mode) {
    ensure();
    const w = mw, h = mh, d = img.data;
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;
    const i0 = (y0 * w + x0) * 4;
    const sr = d[i0], sg = d[i0 + 1], sb = d[i0 + 2], sa = d[i0 + 3];
    const tol2 = tol * tol * 4;
    const match = i => {
      const dr = d[i] - sr, dg = d[i + 1] - sg, db = d[i + 2] - sb, da = d[i + 3] - sa;
      return dr * dr + dg * dg + db * db + da * da <= tol2;
    };
    const sel = new Uint8ClampedArray(w * h);
    if (contiguous) {
      const vis = new Uint8Array(w * h), st = [y0 * w + x0];
      while (st.length) {
        const p = st.pop();
        if (vis[p]) continue; vis[p] = 1;
        if (!match(p * 4)) continue;
        sel[p] = 255;
        const x = p % w, y = (p / w) | 0;
        if (x > 0) st.push(p - 1); if (x < w - 1) st.push(p + 1);
        if (y > 0) st.push(p - w); if (y < h - 1) st.push(p + w);
      }
    } else {
      for (let p = 0; p < w * h; p++) if (match(p * 4)) sel[p] = 255;
    }
    combine(sel, mode);
  }

  /** Select the background: flood from every border pixel that matches any
      corner color within tolerance. The result is the region to drop. */
  function selectBackground(img, tol) {
    ensure();
    const w = mw, h = mh, d = img.data, tol2 = tol * tol * 4;
    const corners = [[0, 0], [w - 1, 0], [0, h - 1], [w - 1, h - 1]].map(([x, y]) => {
      const i = (y * w + x) * 4; return [d[i], d[i + 1], d[i + 2], d[i + 3]];
    });
    const matchAny = i => corners.some(c => {
      const dr = d[i] - c[0], dg = d[i + 1] - c[1], db = d[i + 2] - c[2], da = d[i + 3] - c[3];
      return dr * dr + dg * dg + db * db + da * da <= tol2;
    });
    const sel = new Uint8ClampedArray(w * h), vis = new Uint8Array(w * h), st = [];
    for (let x = 0; x < w; x++) { st.push(x); st.push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { st.push(y * w); st.push(y * w + w - 1); }
    while (st.length) {
      const p = st.pop();
      if (vis[p]) continue; vis[p] = 1;
      if (!matchAny(p * 4)) continue;
      sel[p] = 255;
      const x = p % w, y = (p / w) | 0;
      if (x > 0) st.push(p - 1); if (x < w - 1) st.push(p + 1);
      if (y > 0) st.push(p - w); if (y < h - 1) st.push(p + w);
    }
    combine(sel, 'replace');
  }

  /** Soften the selection edge (separable box blur). */
  function feather(radius) {
    ensure();
    const r = Math.round(radius); if (r < 1) return;
    const w = mw, h = mh, src = Float32Array.from(mask), tmp = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let s = 0, c = 0;
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= w) continue; s += src[row + xx]; c++; }
        tmp[row + x] = s / c;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let s = 0, c = 0;
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; s += tmp[yy * w + x]; c++; }
        mask[y * w + x] = s / c;
      }
    }
    emit();
  }

  /** Grow (dilate) or shrink (erode) the selection by a pixel radius. */
  function morph(px, dilate) {
    ensure();
    const r = Math.round(Math.abs(px)); if (r < 1) return;
    const w = mw, h = mh, src = Uint8ClampedArray.from(mask), tmp = new Uint8ClampedArray(w * h);
    const fold = dilate ? Math.max : Math.min, init = dilate ? 0 : 255;
    for (let y = 0; y < h; y++) {
      const row = y * w;
      for (let x = 0; x < w; x++) {
        let v = init;
        for (let k = -r; k <= r; k++) { const xx = x + k; if (xx < 0 || xx >= w) continue; v = fold(v, src[row + xx]); }
        tmp[row + x] = v;
      }
    }
    for (let x = 0; x < w; x++) {
      for (let y = 0; y < h; y++) {
        let v = init;
        for (let k = -r; k <= r; k++) { const yy = y + k; if (yy < 0 || yy >= h) continue; v = fold(v, tmp[yy * w + x]); }
        mask[y * w + x] = v;
      }
    }
    emit();
  }
  function grow(px)     { morph(px, true); }
  function contract(px) { morph(px, false); }

  /** Smooth: round jagged edges (feather then re-harden at the midpoint). */
  function smooth(px) {
    ensure(); const r = Math.round(px); if (r < 1) return;
    feather(r);
    for (let i = 0; i < mask.length; i++) mask[i] = mask[i] >= 128 ? 255 : 0;
    emit();
  }

  /** Color range: select every pixel within tolerance of an RGB colour (global). */
  function selectColor(img, r, g, b, tol, mode) {
    ensure();
    const w = mw, h = mh, d = img.data, tol2 = tol * tol * 3;
    const sel = new Uint8ClampedArray(w * h);
    for (let p = 0; p < w * h; p++) {
      const i = p * 4, dr = d[i] - r, dg = d[i + 1] - g, db = d[i + 2] - b;
      if (dr * dr + dg * dg + db * db <= tol2) sel[p] = 255;
    }
    combine(sel, mode || 'replace');
  }

  /** Bounding box of selected pixels (cov>=8), or null. */
  function bounds() {
    if (!mask) return null;
    const w = mw, h = mh;
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (mask[y * w + x] >= 8) { if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y; }
    }
    if (maxX < 0) return null;
    return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /** Cached marching-ants boundary canvas (document space). Two phases are
      cached; the viewport alternates them on a timer for the classic crawl. */
  function vizCanvas(phase) {
    const ph = phase ? 1 : 0;
    if (viz[ph]) return viz[ph];
    ensure();
    const w = mw, h = mh, c = U.makeCanvas(w, h), ctx = U.ctx2d(c);
    const out = ctx.createImageData(w, h), o = out.data;
    const on = p => mask[p] >= 128;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const p = y * w + x;
      if (!on(p)) continue;
      const edge = (x === 0 || x === w - 1 || y === 0 || y === h - 1) ||
                   (x > 0 && !on(p - 1)) || (x < w - 1 && !on(p + 1)) ||
                   (y > 0 && !on(p - w)) || (y < h - 1 && !on(p + w));
      if (edge) {
        const i = p * 4, v = ((((x + y) >> 2) + ph) & 1) ? 255 : 0;
        o[i] = o[i + 1] = o[i + 2] = v; o[i + 3] = 255;
      }
    }
    ctx.putImageData(out, 0, 0);
    viz[ph] = c;
    return viz[ph];
  }

  return { onChange, ensure, clear, selectAll, invert, get, dims, has, count, wand,
           selectBackground, feather, grow, contract, smooth, selectColor, bounds, vizCanvas,
           maskCanvas, dimCanvas, fromAlphaCanvas, combine };
})();
