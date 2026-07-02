/* Forge Studio — texture.js
   Game-asset generators. Sources are read from a layer; results are
   added as new layers so originals stay untouched. */
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

  /* ---------------- PBR estimates ---------------- */
  function grayCanvas(field, w, h, mapFn) {
    const out = U.makeCanvas(w, h);
    const img = U.ctx2d(out).createImageData(w, h);
    const d = img.data;
    for (let p = 0; p < field.length; p++) {
      const v = U.clamp(Math.round(mapFn(field[p]) * 255), 0, 255);
      const o = p * 4;
      d[o] = d[o + 1] = d[o + 2] = v; d[o + 3] = 255;
    }
    U.ctx2d(out).putImageData(img, 0, 0);
    return out;
  }

  function pbrSet(layer) {
    const { f, w, h } = heightField(layer);

    // Height: luminance, contrast-stretched
    let lo = 1, hi = 0;
    for (let i = 0; i < f.length; i++) { if (f[i] < lo) lo = f[i]; if (f[i] > hi) hi = f[i]; }
    const range = Math.max(1e-5, hi - lo);
    const height = grayCanvas(f, w, h, v => (v - lo) / range);

    // AO: occlusion where local height is below a blurred neighborhood
    const aoCanvas = U.makeCanvas(w, h);
    U.ctx2d(aoCanvas).drawImage(height, 0, 0);
    const blurred = U.ctx2d(aoCanvas).getImageData(0, 0, w, h);
    GF.filters.boxBlur(blurred, Math.max(2, Math.round(Math.min(w, h) / 64)), 2);
    const hImg = U.ctx2d(height).getImageData(0, 0, w, h);
    const aoImg = U.ctx2d(aoCanvas).createImageData(w, h);
    for (let i = 0; i < hImg.data.length; i += 4) {
      // cavity = how far below the smoothed surface this pixel sits
      const cavity = U.clamp((blurred.data[i] - hImg.data[i]) * 2, 0, 255);
      const v = 255 - cavity;
      aoImg.data[i] = aoImg.data[i + 1] = aoImg.data[i + 2] = v;
      aoImg.data[i + 3] = 255;
    }
    U.ctx2d(aoCanvas).putImageData(aoImg, 0, 0);

    // Roughness heuristic: darker + flatter detail = rougher is wrong in
    // general, so use inverted local contrast: smooth regions -> glossy.
    const rough = grayCanvas(f, w, h, v => 1 - Math.pow((v - lo) / range, 1.6) * 0.85);

    return { height, ao: aoCanvas, roughness: rough };
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

  /* ---------------- Dithering ---------------- */
  const PALETTES = {
    gameboy: [[15, 56, 15], [48, 98, 48], [139, 172, 15], [155, 188, 15]],
    gray4:   [[0, 0, 0], [85, 85, 85], [170, 170, 170], [255, 255, 255]]
  };

  function ditherFS(img, palette) {
    const w = img.width, h = img.height, d = img.data;
    // work in float to diffuse error
    const buf = new Float32Array(d.length);
    for (let i = 0; i < d.length; i++) buf[i] = d[i];
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] === 0) continue;
        const r = U.clamp(buf[i], 0, 255), g = U.clamp(buf[i + 1], 0, 255), b = U.clamp(buf[i + 2], 0, 255);
        const p = nearest(palette, r, g, b);
        const er = r - p[0], eg = g - p[1], eb = b - p[2];
        d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
        const spread = (dx, dy, f) => {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || nx >= w || ny >= h) return;
          const j = (ny * w + nx) * 4;
          buf[j] += er * f; buf[j + 1] += eg * f; buf[j + 2] += eb * f;
        };
        spread(1, 0, 7 / 16); spread(-1, 1, 3 / 16); spread(0, 1, 5 / 16); spread(1, 1, 1 / 16);
      }
    }
    return img;
  }

  const BAYER4 = [
    0, 8, 2, 10,
    12, 4, 14, 6,
    3, 11, 1, 9,
    15, 7, 13, 5
  ];

  function ditherBayer(img, palette) {
    const w = img.width, h = img.height, d = img.data;
    const amp = 255 / Math.max(2, palette.length); // threshold spread
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] === 0) continue;
        const t = (BAYER4[(y % 4) * 4 + (x % 4)] / 16 - 0.5) * amp;
        const p = nearest(palette,
          U.clamp(d[i] + t, 0, 255),
          U.clamp(d[i + 1] + t, 0, 255),
          U.clamp(d[i + 2] + t, 0, 255));
        d[i] = p[0]; d[i + 1] = p[1]; d[i + 2] = p[2];
      }
    }
    return img;
  }

  /* ---------------- Channel packing ---------------- */
  function packChannels(layerR, layerG, layerB, w, h) {
    const get = layer => {
      if (!layer) return null;
      // draw at document size in case the layer canvas differs
      const c = U.makeCanvas(w, h);
      U.ctx2d(c).drawImage(layer.canvas, layer.x, layer.y);
      return U.ctx2d(c).getImageData(0, 0, w, h).data;
    };
    const r = get(layerR), g = get(layerG), b = get(layerB);
    const out = U.makeCanvas(w, h);
    const img = U.ctx2d(out).createImageData(w, h);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = r ? Math.round(U.luminance(r[i], r[i + 1], r[i + 2])) : 0;
      d[i + 1] = g ? Math.round(U.luminance(g[i], g[i + 1], g[i + 2])) : 0;
      d[i + 2] = b ? Math.round(U.luminance(b[i], b[i + 1], b[i + 2])) : 0;
      d[i + 3] = 255;
    }
    U.ctx2d(out).putImageData(img, 0, 0);
    return out;
  }

  return { normalMap, pbrSet, makeSeamless, tilePreview, extractPalette,
           reduceToPalette, ditherFS, ditherBayer, PALETTES, packChannels };
})();
