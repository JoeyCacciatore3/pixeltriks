/* PixelTriks — texgen.js
   Texture generators that serve general image editing and the 3D workspace.
   Sources are read from a layer; results are added as new layers so
   originals stay untouched. (The old game-asset extras — PBR map sets,
   channel packing, retro dithering — were cut in the 2026-07 consolidation.) */
'use strict';
window.GF = window.GF || {};

GF.texture = (function () {
  const U = GF.util;

  /** Height field (Float32 0..1) from a layer's luminance. */
  function heightField(layer) {
    const w = layer.canvas.width, h = layer.canvas.height;
    const d = U.ctx2d(layer.canvas).getImageData(0, 0, w, h).data;
    const f = new Float32Array(w * h);
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      f[p] = U.luminance(d[i], d[i + 1], d[i + 2]) / 255;
    }
    return { f, w, h };
  }

  /* ---------------- Normal map (Sobel) ---------------- */
  function normalMap(layer, strength, invertY, wrap) {
    const { f, w, h } = heightField(layer);
    const out = U.makeCanvas(w, h);
    const img = U.ctx2d(out).createImageData(w, h);
    const d = img.data;
    const at = (x, y) => {
      if (wrap) { x = (x + w) % w; y = (y + h) % h; }
      else { x = U.clamp(x, 0, w - 1); y = U.clamp(y, 0, h - 1); }
      return f[y * w + x];
    };
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        // Sobel gradients
        const tl = at(x - 1, y - 1), t = at(x, y - 1), tr = at(x + 1, y - 1);
        const l  = at(x - 1, y),                       r  = at(x + 1, y);
        const bl = at(x - 1, y + 1), b = at(x, y + 1), br = at(x + 1, y + 1);
        const dx = (tr + 2 * r + br) - (tl + 2 * l + bl);
        let   dy = (bl + 2 * b + br) - (tl + 2 * t + tr);
        if (invertY) dy = -dy;
        // normalize the surface normal (-dx*s, -dy*s, 1)
        const nx = -dx * strength, ny = -dy * strength, nz = 1;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        const o = (y * w + x) * 4;
        d[o]     = Math.round((nx / len * 0.5 + 0.5) * 255);
        d[o + 1] = Math.round((ny / len * 0.5 + 0.5) * 255);
        d[o + 2] = Math.round((nz / len * 0.5 + 0.5) * 255);
        d[o + 3] = 255;
      }
    }
    U.ctx2d(out).putImageData(img, 0, 0);
    return out;
  }

  /* ---------------- Seamless tiling ---------------- */
  function makeSeamless(layer, blendPct) {
    const w = layer.canvas.width, h = layer.canvas.height;
    const half = U.makeCanvas(w, h);
    const hc = U.ctx2d(half);
    // offset by half in both axes (wrapping)
    hc.drawImage(layer.canvas, -w / 2, -h / 2);
    hc.drawImage(layer.canvas,  w / 2, -h / 2);
    hc.drawImage(layer.canvas, -w / 2,  h / 2);
    hc.drawImage(layer.canvas,  w / 2,  h / 2);

    // blend the original back over the offset copy everywhere EXCEPT a
    // cross-shaped band along the new center seams
    const band = (blendPct / 100);
    const src = U.ctx2d(layer.canvas).getImageData(0, 0, w, h);
    const off = hc.getImageData(0, 0, w, h);
    const out = hc.createImageData(w, h);
    const smooth = t => t * t * (3 - 2 * t); // smoothstep
    for (let y = 0; y < h; y++) {
      // distance from the horizontal center seam, 0 at seam -> 1 far away
      const fy = Math.min(1, Math.abs(y - h / 2) / (h * band));
      for (let x = 0; x < w; x++) {
        const fx = Math.min(1, Math.abs(x - w / 2) / (w * band));
        // near either seam keep the offset image, elsewhere fade to original
        const t = smooth(Math.min(fx, fy)); // 0 at seams, 1 away
        const i = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) {
          out.data[i + k] = off.data[i + k] * (1 - t) + src.data[i + k] * t;
        }
      }
    }
    const result = U.makeCanvas(w, h);
    U.ctx2d(result).putImageData(out, 0, 0);
    return result;
  }

  function tilePreview(layer) {
    const w = layer.canvas.width, h = layer.canvas.height;
    const out = U.makeCanvas(w * 3, h * 3);
    const c = U.ctx2d(out);
    for (let ty = 0; ty < 3; ty++) {
      for (let tx = 0; tx < 3; tx++) {
        c.drawImage(layer.canvas, tx * w, ty * h);
      }
    }
    return out;
  }

  /* ---------------- Palette (median cut) ---------------- */
  function extractPalette(layer, count) {
    const w = layer.canvas.width, h = layer.canvas.height;
    const d = U.ctx2d(layer.canvas).getImageData(0, 0, w, h).data;
    // sample at most ~40k pixels for speed
    const step = Math.max(1, Math.floor((w * h) / 40000));
    let px = [];
    for (let p = 0; p < w * h; p += step) {
      const i = p * 4;
      if (d[i + 3] < 16) continue;
      px.push([d[i], d[i + 1], d[i + 2]]);
    }
    if (!px.length) return [];

    let buckets = [px];
    while (buckets.length < count) {
      // split the bucket with the largest channel range
      let bi = -1, bChan = 0, bRange = -1;
      buckets.forEach((bk, idx) => {
        if (bk.length < 2) return;
        for (let ch = 0; ch < 3; ch++) {
          let lo = 255, hi = 0;
          for (const p of bk) { if (p[ch] < lo) lo = p[ch]; if (p[ch] > hi) hi = p[ch]; }
          if (hi - lo > bRange) { bRange = hi - lo; bi = idx; bChan = ch; }
        }
      });
      if (bi < 0) break;
      const bk = buckets[bi];
      bk.sort((a, b) => a[bChan] - b[bChan]);
      const mid = bk.length >> 1;
      buckets.splice(bi, 1, bk.slice(0, mid), bk.slice(mid));
    }
    return buckets.map(bk => {
      let r = 0, g = 0, b = 0;
      for (const p of bk) { r += p[0]; g += p[1]; b += p[2]; }
      const n = bk.length || 1;
      return [Math.round(r / n), Math.round(g / n), Math.round(b / n)];
    });
  }

  function nearest(palette, r, g, b) {
    let best = 0, bd = Infinity;
    for (let i = 0; i < palette.length; i++) {
      const p = palette[i];
      const dr = r - p[0], dg = g - p[1], db = b - p[2];
      const dist = dr * dr + dg * dg + db * db;
      if (dist < bd) { bd = dist; best = i; }
    }
    return palette[best];
  }

  function reduceToPalette(img, palette) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const p = nearest(palette, d[i], d[i + 1], d[i + 2]);
      d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
    }
    return img;
  }

  return { normalMap, makeSeamless, tilePreview, extractPalette, reduceToPalette };
})();
