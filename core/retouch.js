/* Forge Studio — retouch.js
   High-end editing tools for working on existing images, all pure-JS and
   offline (no models, no network):
     • Magic eraser / background removal (+ defringe)
     • Content-aware fill via PatchMatch inpainting (size-capped, downscaled
       for large regions so it stays responsive)
     • Color replace / selective recolor
     • Smart upscale (Scale2x/EPX for pixel art, bicubic+unsharp for photos)

   Edits operate in document space against GF.select's mask, then write back
   into the active layer's document region — preserving any content the layer
   holds outside the document (see GF.doc.bakeOffset / docAligned). */
'use strict';
window.GF = window.GF || {};

GF.retouch = (function () {
  const U = GF.util;
  const D = GF.doc;
  const S = () => GF.select;

  /** Run fn(docImageData) on a document-sized snapshot of the layer, then
      write it back into the layer's document region (off-document pixels kept). */
  function applyDocEdit(L, label, fn) {
    if (!L || !L.canvas) { U.toast('Not available on an adjustment layer'); return; }
    GF.history.push(D.doc, label);
    const w = D.doc.width, h = D.doc.height;
    const snap = D.docAligned(L).canvas;
    const sctx = U.ctx2d(snap);
    const img = sctx.getImageData(0, 0, w, h);
    fn(img);
    sctx.putImageData(img, 0, 0);
    const c = U.ctx2d(L.canvas);
    c.clearRect(-L.x, -L.y, w, h);
    c.drawImage(snap, -L.x, -L.y);
  }

  /* ---------------- erase / background / defringe ---------------- */

  function eraseInPlace(img) {
    const sel = S().get(), d = img.data;
    for (let p = 0; p < sel.length; p++) {
      if (sel[p]) { const a = p * 4 + 3; d[a] = Math.round(d[a] * (1 - sel[p] / 255)); }
    }
  }

  /** Bleed solid colors into partially-transparent edge pixels, removing the
      colored halo left after cutting an object out of a background. */
  function defringe(img, passes) {
    const w = img.width, h = img.height, d = img.data;
    passes = passes || 2;
    for (let pass = 0; pass < passes; pass++) {
      const copy = Uint8ClampedArray.from(d);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (copy[i + 3] > 0 && copy[i + 3] < 250) {
          let r = 0, g = 0, b = 0, n = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
            const j = (yy * w + xx) * 4;
            if (copy[j + 3] >= 250) { r += copy[j]; g += copy[j + 1]; b += copy[j + 2]; n++; }
          }
          if (n > 0) { d[i] = r / n; d[i + 1] = g / n; d[i + 2] = b / n; }
        }
      }
    }
  }

  function eraseSelection(L, doDefringe) {
    applyDocEdit(L, 'erase selection', img => { eraseInPlace(img); if (doDefringe) defringe(img); });
  }

  function removeBackground(L, tol, doDefringe) {
    const comp = U.ctx2d(D.composite()).getImageData(0, 0, D.doc.width, D.doc.height);
    S().selectBackground(comp, tol);           // pick the background off the composite
    applyDocEdit(L, 'remove background', img => { eraseInPlace(img); if (doDefringe) defringe(img); });
  }

  /* ---------------- color replace / selective recolor ---------------- */

  function colorReplace(L, o) {
    applyDocEdit(L, 'color replace', img => {
      const d = img.data, sel = S().has() ? S().get() : null;
      const tol = o.tol, hi = tol + Math.max(1, o.soft);
      for (let p = 0; p < img.width * img.height; p++) {
        const i = p * 4;
        if (d[i + 3] === 0) continue;
        const dr = d[i] - o.from[0], dg = d[i + 1] - o.from[1], db = d[i + 2] - o.from[2];
        const dist = Math.sqrt(dr * dr + dg * dg + db * db);
        let wgt = dist <= tol ? 1 : dist >= hi ? 0 : 1 - (dist - tol) / (hi - tol);
        if (sel) wgt *= sel[p] / 255;
        if (wgt <= 0) continue;
        let r = d[i], g = d[i + 1], b = d[i + 2];
        if (o.to) { r += (o.to[0] - o.from[0]) * wgt; g += (o.to[1] - o.from[1]) * wgt; b += (o.to[2] - o.from[2]) * wgt; }
        if (o.dH || o.dS || o.dL) {
          let [hh, ss, ll] = U.rgbToHsl(r, g, b);
          hh = (hh + (o.dH / 360) * wgt + 1) % 1;
          ss = U.clamp(ss + (o.dS / 100) * wgt, 0, 1);
          ll = U.clamp(ll + (o.dL / 100) * wgt, 0, 1);
          const out = U.hslToRgb(hh, ss, ll); r = out[0]; g = out[1]; b = out[2];
        }
        d[i] = U.clamp(r, 0, 255); d[i + 1] = U.clamp(g, 0, 255); d[i + 2] = U.clamp(b, 0, 255);
      }
    });
  }

  /* ---------------- content-aware fill (PatchMatch) ---------------- */

  const PATCH = 7, HALF = 3, ITERS = 6, WORK_CAP = 192;

  function diffuseInit(R, G, B, w, h, hole, known) {
    const filled = Uint8Array.from(known);
    for (let pass = 0; pass < w + h; pass++) {
      let any = false;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const p = y * w + x;
        if (!hole[p] || filled[p]) continue;
        let r = 0, g = 0, b = 0, n = 0;
        if (x > 0 && filled[p - 1])     { r += R[p - 1]; g += G[p - 1]; b += B[p - 1]; n++; }
        if (x < w - 1 && filled[p + 1]) { r += R[p + 1]; g += G[p + 1]; b += B[p + 1]; n++; }
        if (y > 0 && filled[p - w])     { r += R[p - w]; g += G[p - w]; b += B[p - w]; n++; }
        if (y < h - 1 && filled[p + w]) { r += R[p + w]; g += G[p + w]; b += B[p + w]; n++; }
        if (n > 0) { R[p] = r / n; G[p] = g / n; B[p] = b / n; filled[p] = 1; any = true; }
      }
      if (!any) break;
    }
  }

  /** Fill hole==1 pixels in an RGBA buffer using surrounding texture. */
  function inpaint(data, w, h, hole) {
    const known = new Uint8Array(w * h);
    for (let p = 0; p < w * h; p++) known[p] = (!hole[p] && data[p * 4 + 3] > 8) ? 1 : 0;

    // prefix sum of "unknown" to test if a PATCHxPATCH window is fully source
    const pw = w + 1, U2 = new Int32Array(pw * (h + 1));
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      U2[(y + 1) * pw + (x + 1)] = (known[y * w + x] ? 0 : 1)
        + U2[y * pw + (x + 1)] + U2[(y + 1) * pw + x] - U2[y * pw + x];
    }
    const validSource = (cx, cy) => {
      const x0 = cx - HALF, y0 = cy - HALF, x1 = x0 + PATCH, y1 = y0 + PATCH;
      if (x0 < 0 || y0 < 0 || x1 > w || y1 > h) return false;
      return (U2[y1 * pw + x1] - U2[y0 * pw + x1] - U2[y1 * pw + x0] + U2[y0 * pw + x0]) === 0;
    };

    const R = new Float32Array(w * h), G = new Float32Array(w * h), B = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) { R[p] = data[p * 4]; G[p] = data[p * 4 + 1]; B[p] = data[p * 4 + 2]; }
    diffuseInit(R, G, B, w, h, hole, known);

    const srcCenters = [];
    for (let cy = HALF; cy < h - HALF; cy++) for (let cx = HALF; cx < w - HALF; cx++)
      if (validSource(cx, cy)) srcCenters.push(cy * w + cx);
    if (!srcCenters.length) return; // no clean source patches; leave the diffuse init

    const nnx = new Int32Array(w * h), nny = new Int32Array(w * h), nnd = new Float32Array(w * h);
    const holeCenters = [];
    for (let cy = 0; cy < h; cy++) for (let cx = 0; cx < w; cx++) {
      const p = cy * w + cx;
      if (hole[p]) { holeCenters.push(p); const s = srcCenters[(Math.random() * srcCenters.length) | 0]; nnx[p] = s % w; nny[p] = (s / w) | 0; nnd[p] = Infinity; }
    }

    const dist = (cx, cy, sx, sy, best) => {
      let sum = 0;
      for (let dy = -HALF; dy <= HALF; dy++) for (let dx = -HALF; dx <= HALF; dx++) {
        const tx = cx + dx, ty = cy + dy, ux = sx + dx, uy = sy + dy;
        if (tx < 0 || ty < 0 || tx >= w || ty >= h) { sum += 195075; continue; } // 3*255^2
        const tp = ty * w + tx, up = uy * w + ux;
        const dr = R[tp] - R[up], dg = G[tp] - G[up], db = B[tp] - B[up];
        sum += dr * dr + dg * dg + db * db;
        if (sum >= best) return sum;
      }
      return sum;
    };

    for (let it = 0; it < ITERS; it++) {
      const reverse = (it & 1) === 1, step = reverse ? -1 : 1;
      const list = reverse ? holeCenters.slice().reverse() : holeCenters;
      for (const c of list) {
        const cx = c % w, cy = (c / w) | 0;
        let bx = nnx[c], by = nny[c];
        let bd = nnd[c] === Infinity ? dist(cx, cy, bx, by, Infinity) : nnd[c];
        // propagate from horizontal & vertical neighbors
        const nxp = cx - step;
        if (nxp >= 0 && nxp < w) { const nc = cy * w + nxp, sx = nnx[nc] + step, sy = nny[nc]; if (validSource(sx, sy)) { const dd = dist(cx, cy, sx, sy, bd); if (dd < bd) { bd = dd; bx = sx; by = sy; } } }
        const nyp = cy - step;
        if (nyp >= 0 && nyp < h) { const nc = nyp * w + cx, sx = nnx[nc], sy = nny[nc] + step; if (validSource(sx, sy)) { const dd = dist(cx, cy, sx, sy, bd); if (dd < bd) { bd = dd; bx = sx; by = sy; } } }
        // random search, shrinking radius
        let radius = Math.max(w, h);
        while (radius >= 1) {
          const rx = bx + (((Math.random() * 2 - 1) * radius) | 0);
          const ry = by + (((Math.random() * 2 - 1) * radius) | 0);
          if (validSource(rx, ry)) { const dd = dist(cx, cy, rx, ry, bd); if (dd < bd) { bd = dd; bx = rx; by = ry; } }
          radius = (radius / 2) | 0;
        }
        nnx[c] = bx; nny[c] = by; nnd[c] = bd;
      }
      // reconstruct (vote)
      const aR = new Float32Array(w * h), aG = new Float32Array(w * h), aB = new Float32Array(w * h), aW = new Float32Array(w * h);
      for (const c of holeCenters) {
        const cx = c % w, cy = (c / w) | 0, sx = nnx[c], sy = nny[c];
        for (let dy = -HALF; dy <= HALF; dy++) for (let dx = -HALF; dx <= HALF; dx++) {
          const tx = cx + dx, ty = cy + dy;
          if (tx < 0 || ty < 0 || tx >= w || ty >= h) continue;
          const tp = ty * w + tx; if (!hole[tp]) continue;
          const up = (sy + dy) * w + (sx + dx);
          aR[tp] += R[up]; aG[tp] += G[up]; aB[tp] += B[up]; aW[tp]++;
        }
      }
      for (let p = 0; p < w * h; p++) if (hole[p] && aW[p] > 0) { R[p] = aR[p] / aW[p]; G[p] = aG[p] / aW[p]; B[p] = aB[p] / aW[p]; }
    }

    for (let p = 0; p < w * h; p++) if (hole[p]) {
      const i = p * 4; data[i] = U.clamp(R[p], 0, 255); data[i + 1] = U.clamp(G[p], 0, 255); data[i + 2] = U.clamp(B[p], 0, 255); data[i + 3] = 255;
    }
  }

  function contentAwareFill(L) {
    applyDocEdit(L, 'content-aware fill', img => {
      const w = img.width, h = img.height, sel = S().get();
      const scale = Math.min(1, WORK_CAP / Math.max(w, h));
      if (scale >= 1) {
        const hole = new Uint8Array(w * h);
        for (let p = 0; p < w * h; p++) hole[p] = sel[p] >= 128 ? 1 : 0;
        inpaint(img.data, w, h, hole);
        return;
      }
      // large image: inpaint a downscaled copy, then blend the fill back in
      const ww = Math.max(1, Math.round(w * scale)), hh = Math.max(1, Math.round(h * scale));
      const big = U.makeCanvas(w, h); U.ctx2d(big).putImageData(img, 0, 0);
      const small = U.makeCanvas(ww, hh), sctx = U.ctx2d(small);
      sctx.imageSmoothingEnabled = true; sctx.drawImage(big, 0, 0, ww, hh);
      const simg = sctx.getImageData(0, 0, ww, hh);
      const hole = new Uint8Array(ww * hh);
      for (let y = 0; y < hh; y++) for (let x = 0; x < ww; x++) {
        const sx = Math.min(w - 1, Math.floor(x / scale)), sy = Math.min(h - 1, Math.floor(y / scale));
        hole[y * ww + x] = sel[sy * w + sx] >= 128 ? 1 : 0;
      }
      inpaint(simg.data, ww, hh, hole);
      sctx.putImageData(simg, 0, 0);
      const up = U.makeCanvas(w, h), uctx = U.ctx2d(up);
      uctx.imageSmoothingEnabled = true; uctx.drawImage(small, 0, 0, ww, hh, 0, 0, w, h);
      const u = uctx.getImageData(0, 0, w, h).data, d = img.data;
      for (let p = 0; p < w * h; p++) {
        const cov = sel[p] / 255;
        if (cov > 0) { const i = p * 4; d[i] = d[i] * (1 - cov) + u[i] * cov; d[i + 1] = d[i + 1] * (1 - cov) + u[i + 1] * cov; d[i + 2] = d[i + 2] * (1 - cov) + u[i + 2] * cov; d[i + 3] = Math.max(d[i + 3], Math.round(255 * cov)); }
      }
    });
  }

  /* ---------------- smart upscale ---------------- */

  /** Scale2x / EPX — edge-preserving 2× for pixel art. */
  function scale2x(src, w, h) {
    const W = w * 2, out = new Uint8ClampedArray(W * h * 2 * 4);
    const at = (x, y) => (U.clamp(y, 0, h - 1) * w + U.clamp(x, 0, w - 1)) * 4;
    const eq = (i, j) => src[i] === src[j] && src[i + 1] === src[j + 1] && src[i + 2] === src[j + 2] && src[i + 3] === src[j + 3];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const P = at(x, y), A = at(x, y - 1), Bp = at(x + 1, y), C = at(x - 1, y), Dn = at(x, y + 1);
      let e0 = P, e1 = P, e2 = P, e3 = P;
      if (!eq(C, Bp) && !eq(A, Dn)) {
        if (eq(A, C)) e0 = A;
        if (eq(A, Bp)) e1 = A;
        if (eq(Dn, C)) e2 = Dn;
        if (eq(Dn, Bp)) e3 = Dn;
      }
      const put = (ex, ey, si) => { const o = ((y * 2 + ey) * W + (x * 2 + ex)) * 4; out[o] = src[si]; out[o + 1] = src[si + 1]; out[o + 2] = src[si + 2]; out[o + 3] = src[si + 3]; };
      put(0, 0, e0); put(1, 0, e1); put(0, 1, e2); put(1, 1, e3);
    }
    return { data: out, w: W, h: h * 2 };
  }

  function unsharp(img, amount) {
    const blur = new ImageData(Uint8ClampedArray.from(img.data), img.width, img.height);
    GF.filters.boxBlur(blur, 1, 1);
    const d = img.data, b = blur.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = U.clamp(d[i]     + amount * (d[i]     - b[i]),     0, 255);
      d[i + 1] = U.clamp(d[i + 1] + amount * (d[i + 1] - b[i + 1]), 0, 255);
      d[i + 2] = U.clamp(d[i + 2] + amount * (d[i + 2] - b[i + 2]), 0, 255);
    }
  }

  /** Upscale the whole document by an integer factor (2 or 4). */
  function smartUpscale(factor, mode) {
    const w = D.doc.width, h = D.doc.height, nw = w * factor, nh = h * factor;
    GF.history.push(D.doc, 'smart upscale');
    for (const L of D.doc.layers) {
      if (L.mask) {  // masks are doc-sized — scale to match (smooth)
        const nm = U.makeCanvas(nw, nh), mx = U.ctx2d(nm);
        mx.imageSmoothingEnabled = true; mx.drawImage(L.mask, 0, 0, nw, nh); L.mask = nm;
      }
      if (!L.canvas) continue;   // adjustment layer — re-applies at the new size
      const srcC = D.docAligned(L).canvas;
      const nc = U.makeCanvas(nw, nh), nctx = U.ctx2d(nc);
      if (mode === 'pixel') {
        let cur = { data: U.ctx2d(srcC).getImageData(0, 0, w, h).data, w, h }, f = 1;
        while (f < factor) { cur = scale2x(cur.data, cur.w, cur.h); f *= 2; }
        const tmp = U.makeCanvas(cur.w, cur.h);
        const id = U.ctx2d(tmp).createImageData(cur.w, cur.h); id.data.set(cur.data); U.ctx2d(tmp).putImageData(id, 0, 0);
        nctx.imageSmoothingEnabled = false;
        nctx.drawImage(tmp, 0, 0, nw, nh);
      } else {
        nctx.imageSmoothingEnabled = true; nctx.imageSmoothingQuality = 'high';
        nctx.drawImage(srcC, 0, 0, nw, nh);
        const im = nctx.getImageData(0, 0, nw, nh); unsharp(im, 0.6); nctx.putImageData(im, 0, 0);
      }
      L.canvas = nc; L.x = 0; L.y = 0;
    }
    D.doc.width = nw; D.doc.height = nh;
    GF.select.clear();
  }

  /* ---------------- layer FX (outline / glow / drop shadow) ---------------- */

  /** Build a styled silhouette of the layer on a new layer placed directly
      behind it — sticker outline, glow, or offset drop shadow. */
  function layerFX(L, kind, color, size, opts) {
    if (kind === 'bevel' || kind === 'emboss') return bevelEmboss(L, kind, size, opts || {});
    GF.history.push(D.doc, 'layer fx ' + kind);
    const w = D.doc.width, h = D.doc.height;
    const snap = D.docAligned(L).canvas;
    const fx = U.makeCanvas(w, h), x = U.ctx2d(fx);
    if (kind === 'shadow') {
      x.drawImage(snap, Math.max(1, Math.round(size * 0.7)), Math.max(1, Math.round(size * 0.7)));
    } else {
      // dilate the silhouette by stamping it around two rings of offsets
      const steps = 16;
      for (const r of [size, Math.max(1, size / 2)]) {
        for (let a = 0; a < steps; a++) {
          const t = (a / steps) * Math.PI * 2;
          x.drawImage(snap, Math.cos(t) * r, Math.sin(t) * r);
        }
      }
    }
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, w, h);
    x.globalCompositeOperation = 'source-over';
    if (kind !== 'outline') {
      const img = x.getImageData(0, 0, w, h);
      GF.filters.boxBlur(img, Math.max(1, Math.round(size / 2)), kind === 'glow' ? 2 : 1);
      x.putImageData(img, 0, 0);
      if (kind === 'glow') x.drawImage(fx, 0, 0); // double pass = stronger core
    }
    const NL = D.addLayer(L.name + ' ' + kind);
    U.ctx2d(NL.canvas).drawImage(fx, 0, 0);
    D.moveActive(-1);          // slip the effect underneath its source
    D.doc.activeId = L.id;     // keep the artwork active for further edits
  }

  /* ---------------- material wizard (one-click PBR pipeline) ---------------- */

  /** Chain the texture generators end-to-end on one layer:
      (seamless) albedo → normal → height/AO/roughness → packed ORM,
      named so the 3D preview and channel tools pick everything up. */
  function materialWizard(L, tileable) {
    if (!L || !L.canvas) { U.toast('Pick a pixel layer (not an adjustment layer)'); return; }
    GF.history.push(D.doc, 'material wizard');
    const w = D.doc.width, h = D.doc.height;
    const base = D.docAligned(L);
    const albedoCnv = tileable ? GF.texture.makeSeamless(base, 20) : base.canvas;
    const mk = (name, cnv, hidden) => {
      const NL = D.addLayer(name);
      U.ctx2d(NL.canvas).drawImage(cnv, 0, 0);
      NL.visible = !hidden;
      return NL;
    };
    const albedo = mk(L.name + ' albedo', albedoCnv, false);
    const srcObj = { canvas: albedoCnv, x: 0, y: 0 };
    mk(L.name + ' normal', GF.texture.normalMap(srcObj, 5, false, true), true);
    const set = GF.texture.pbrSet(srcObj);
    mk(L.name + ' height', set.height, true);
    const ao = mk(L.name + ' ao', set.ao, true);
    const rough = mk(L.name + ' roughness', set.roughness, true);
    mk(L.name + ' ORM', GF.texture.packChannels(ao, rough, null, w, h), true);
    L.visible = false;             // wizard output replaces the raw source visually
    D.doc.activeId = albedo.id;
  }

  /* ---------------- ink / outline (bolden lines) ---------------- */

  /** Detect edges (Sobel) and paint bold ink lines — to a new "lines" layer
      (default) or onto the layer. Helps define regions for recoloring. */
  function inkOutline(L, opts) {
    opts = opts || {};
    const w = D.doc.width, h = D.doc.height;
    const img = U.ctx2d(D.docAligned(L).canvas).getImageData(0, 0, w, h);
    let edges = GF.filters.sobelEdges(img, opts.sensitivity == null ? 50 : opts.sensitivity);
    const thickness = Math.max(1, Math.round(opts.thickness == null ? 2 : opts.thickness));
    if (thickness > 1) edges = GF.filters.dilateAlpha(edges, thickness - 1);
    const [r, g, b] = U.hexToRgb(opts.color || '#1a1a1a'), e = edges.data;
    for (let i = 0; i < e.length; i += 4) if (e[i + 3] > 0) { e[i] = r; e[i + 1] = g; e[i + 2] = b; }
    if (opts.newLayer === false) {
      applyDocEdit(L, 'ink outline', (im) => {
        const d = im.data;
        for (let i = 0; i < e.length; i += 4) if (e[i + 3] > 0) { d[i] = r; d[i + 1] = g; d[i + 2] = b; d[i + 3] = 255; }
      });
    } else {
      GF.history.push(D.doc, 'ink outline');
      const NL = D.addLayer(L.name + ' lines');
      const ec = U.makeCanvas(w, h); U.ctx2d(ec).putImageData(edges, 0, 0);
      U.ctx2d(NL.canvas).drawImage(ec, 0, 0);
    }
  }

  /* ---------------- clean colors (deblur + flatten) ---------------- */

  /** Sharpen (deblur) → quantize to N flat colors → defringe. Removes edge blur
      and colour bleed. Optionally splits each flat colour onto its own layer. */
  function cleanColors(L, opts) {
    if (!L || !L.canvas) { U.toast('Not available on an adjustment layer'); return; }
    opts = opts || {};
    const colors = U.clamp(Math.round(opts.colors == null ? 8 : opts.colors), 2, 64);
    const palette = GF.texture.extractPalette(L, colors);
    if (!palette.length) { U.toast('Nothing to clean on this layer'); return; }
    const sharpen = opts.sharpen == null ? 0.6 : opts.sharpen;

    if (opts.splitLayers) {
      GF.history.push(D.doc, 'clean colors → layers');
      const w = D.doc.width, h = D.doc.height;
      const img = U.ctx2d(D.docAligned(L).canvas).getImageData(0, 0, w, h);
      if (sharpen > 0) unsharp(img, sharpen);
      GF.texture.reduceToPalette(img, palette);
      const d = img.data;
      for (const [pr, pg, pb] of palette) {
        const lc = U.makeCanvas(w, h), out = U.ctx2d(lc).createImageData(w, h), o = out.data;
        let any = false;
        for (let i = 0; i < d.length; i += 4) {
          if (d[i + 3] > 0 && d[i] === pr && d[i + 1] === pg && d[i + 2] === pb) { o[i] = pr; o[i + 1] = pg; o[i + 2] = pb; o[i + 3] = 255; any = true; }
        }
        if (!any) continue;
        U.ctx2d(lc).putImageData(out, 0, 0);
        const NL = D.addLayer('color ' + U.rgbToHex(pr, pg, pb));
        U.ctx2d(NL.canvas).drawImage(lc, 0, 0);
      }
    } else {
      applyDocEdit(L, 'clean colors', (img) => {
        if (sharpen > 0) unsharp(img, sharpen);
        GF.texture.reduceToPalette(img, palette);
        if (opts.defringe !== false) defringe(img, 2);
      });
    }
  }

  /* ---------------- bevel / emboss (depth edges) ---------------- */

  function bevelEmboss(L, kind, size, opts) {
    GF.history.push(D.doc, 'layer fx ' + kind);
    const w = D.doc.width, h = D.doc.height, sz = Math.max(1, size || 4);
    const snap = D.docAligned(L).canvas, sctx = U.ctx2d(snap);
    const img = sctx.getImageData(0, 0, w, h), d = img.data;
    // Pseudo-height from blurred alpha.
    const ha = new ImageData(Uint8ClampedArray.from(d), w, h);
    GF.filters.boxBlur(ha, sz, 2);
    const ht = new Float32Array(w * h);
    for (let p = 0; p < w * h; p++) ht[p] = ha.data[p * 4 + 3] / 255;
    const ang = (opts.angle == null ? 135 : opts.angle) * Math.PI / 180;
    const lx = Math.cos(ang), ly = -Math.sin(ang), depth = (opts.depth == null ? 1 : opts.depth);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      if (d[i + 3] === 0) continue;
      const gx = ht[y * w + Math.min(w - 1, x + 1)] - ht[y * w + Math.max(0, x - 1)];
      const gy = ht[Math.min(h - 1, y + 1) * w + x] - ht[Math.max(0, y - 1) * w + x];
      const s = (gx * lx + gy * ly) * depth * 6;
      if (kind === 'emboss') {
        const v = U.clamp(128 + s * 128, 0, 255); d[i] = v; d[i + 1] = v; d[i + 2] = v;
      } else {
        const add = s * 70, m = 1 + U.clamp(s, -1, 1) * 0.5;
        d[i] = U.clamp(d[i] * m + add, 0, 255);
        d[i + 1] = U.clamp(d[i + 1] * m + add, 0, 255);
        d[i + 2] = U.clamp(d[i + 2] * m + add, 0, 255);
      }
    }
    sctx.putImageData(img, 0, 0);
    const c = U.ctx2d(L.canvas); c.clearRect(-L.x, -L.y, w, h); c.drawImage(snap, -L.x, -L.y);
  }

  /* ---------------- cut to layer (cutting half of the combo) ---------------- */

  /** Extract the current selection to its own layer; optionally erase it from
      the source (true cut) and/or bevel the new layer. */
  function cutToLayer(L, opts) {
    opts = opts || {};
    if (!S().has()) { U.toast('Select a region first (Wand)'); return null; }
    GF.history.push(D.doc, 'cut to layer');
    const w = D.doc.width, h = D.doc.height;
    const snap = D.docAligned(L).canvas, sc = U.ctx2d(snap);
    sc.globalCompositeOperation = 'destination-in';
    sc.drawImage(S().maskCanvas(), 0, 0);
    sc.globalCompositeOperation = 'source-over';
    const NL = D.addLayer(L.name + ' cut');
    U.ctx2d(NL.canvas).drawImage(snap, 0, 0);
    if (opts.cut !== false) {
      const c = U.ctx2d(L.canvas);
      c.save(); c.globalCompositeOperation = 'destination-out';
      c.drawImage(S().maskCanvas(), -L.x, -L.y);
      c.restore();
    }
    D.doc.activeId = NL.id;
    if (opts.bevel) bevelEmboss(NL, 'bevel', (opts.bevelOpts && opts.bevelOpts.size) || 4, opts.bevelOpts || {});
    S().clear();
    return NL.id;
  }

  return { eraseSelection, removeBackground, defringe, colorReplace,
           contentAwareFill, smartUpscale, applyDocEdit, layerFX, materialWizard,
           inkOutline, cleanColors, cutToLayer };
})();
