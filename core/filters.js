/* PixelTriks — filters.js
   Pixel-level adjustments. Each operates on an ImageData in place or
   returns a new one. Applied to layers via GF.filters.applyToLayer. */
'use strict';
window.GF = window.GF || {};

GF.filters = (function () {
  const U = GF.util;

  function getData(layer) {
    return U.ctx2d(layer.canvas).getImageData(0, 0, layer.canvas.width, layer.canvas.height);
  }
  function putData(layer, data) {
    U.ctx2d(layer.canvas).putImageData(data, 0, 0);
  }

  /** brightness, contrast: -100..100 */
  function brightnessContrast(img, brightness, contrast) {
    const d = img.data;
    const b = (brightness / 100) * 255;
    const c = contrast / 100;
    const f = (259 * (c * 255 + 255)) / (255 * (259 - c * 255));
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = U.clamp(f * (d[i]     - 128) + 128 + b, 0, 255);
      d[i + 1] = U.clamp(f * (d[i + 1] - 128) + 128 + b, 0, 255);
      d[i + 2] = U.clamp(f * (d[i + 2] - 128) + 128 + b, 0, 255);
    }
    return img;
  }

  /** hue: -180..180 deg, sat/light: -100..100 */
  function hsl(img, hue, sat, light) {
    const d = img.data;
    const dh = hue / 360, ds = sat / 100, dl = light / 100;
    for (let i = 0; i < d.length; i += 4) {
      let [h, s, l] = U.rgbToHsl(d[i], d[i + 1], d[i + 2]);
      h = (h + dh + 1) % 1;
      s = U.clamp(s + ds * (ds > 0 ? (1 - s) : s), 0, 1);
      l = U.clamp(l + dl * (dl > 0 ? (1 - l) : l), 0, 1);
      const [r, g, b] = U.hslToRgb(h, s, l);
      d[i] = r; d[i + 1] = g; d[i + 2] = b;
    }
    return img;
  }

  function grayscale(img) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.round(U.luminance(d[i], d[i + 1], d[i + 2]));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    return img;
  }

  function invert(img) {
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = 255 - d[i]; d[i + 1] = 255 - d[i + 1]; d[i + 2] = 255 - d[i + 2];
    }
    return img;
  }

  function posterize(img, levels) {
    const d = img.data;
    const step = 255 / (levels - 1);
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = Math.round(Math.round(d[i] / step) * step);
      d[i + 1] = Math.round(Math.round(d[i + 1] / step) * step);
      d[i + 2] = Math.round(Math.round(d[i + 2] / step) * step);
    }
    return img;
  }

  /** Stretch histogram so darkest -> 0 and lightest -> 255. */
  function autoLevels(img) {
    const d = img.data;
    let lo = 255, hi = 0;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      const v = U.luminance(d[i], d[i + 1], d[i + 2]);
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    if (hi - lo < 1) return img;
    const scale = 255 / (hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      d[i]     = U.clamp((d[i]     - lo) * scale, 0, 255);
      d[i + 1] = U.clamp((d[i + 1] - lo) * scale, 0, 255);
      d[i + 2] = U.clamp((d[i + 2] - lo) * scale, 0, 255);
    }
    return img;
  }

  /** 3x3 convolution. Edges clamp. Alpha preserved. */
  function convolve3(img, kernel, divisor, offset) {
    const w = img.width, h = img.height;
    const src = img.data;
    const out = new Uint8ClampedArray(src.length);
    const div = divisor || 1, off = offset || 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        let r = 0, g = 0, b = 0;
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const px = U.clamp(x + kx, 0, w - 1);
            const py = U.clamp(y + ky, 0, h - 1);
            const i = (py * w + px) * 4;
            const k = kernel[(ky + 1) * 3 + (kx + 1)];
            r += src[i] * k; g += src[i + 1] * k; b += src[i + 2] * k;
          }
        }
        const o = (y * w + x) * 4;
        out[o]     = U.clamp(r / div + off, 0, 255);
        out[o + 1] = U.clamp(g / div + off, 0, 255);
        out[o + 2] = U.clamp(b / div + off, 0, 255);
        out[o + 3] = src[o + 3];
      }
    }
    img.data.set(out);
    return img;
  }

  function blur(img)    { return convolve3(img, [1,2,1, 2,4,2, 1,2,1], 16, 0); }
  function sharpen(img) { return convolve3(img, [0,-1,0, -1,5,-1, 0,-1,0], 1, 0); }
  function edge(img)    { return convolve3(img, [-1,-1,-1, -1,8,-1, -1,-1,-1], 1, 0); }

  /** Repeated box blur with arbitrary radius (separable, for AO maps). */
  function boxBlur(img, radius, passes) {
    const w = img.width, h = img.height;
    let src = img.data;
    const tmp = new Uint8ClampedArray(src.length);
    const n = passes || 2;
    for (let p = 0; p < n; p++) {
      // horizontal
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, a = 0, cnt = 0;
          for (let k = -radius; k <= radius; k++) {
            const px = U.clamp(x + k, 0, w - 1);
            const i = (y * w + px) * 4;
            r += src[i]; g += src[i + 1]; b += src[i + 2]; a += src[i + 3]; cnt++;
          }
          const o = (y * w + x) * 4;
          tmp[o] = r / cnt; tmp[o + 1] = g / cnt; tmp[o + 2] = b / cnt; tmp[o + 3] = a / cnt;
        }
      }
      // vertical
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          let r = 0, g = 0, b = 0, a = 0, cnt = 0;
          for (let k = -radius; k <= radius; k++) {
            const py = U.clamp(y + k, 0, h - 1);
            const i = (py * w + x) * 4;
            r += tmp[i]; g += tmp[i + 1]; b += tmp[i + 2]; a += tmp[i + 3]; cnt++;
          }
          const o = (y * w + x) * 4;
          src[o] = r / cnt; src[o + 1] = g / cnt; src[o + 2] = b / cnt; src[o + 3] = a / cnt;
        }
      }
    }
    return img;
  }

  function pixelate(layer, block) {
    const w = layer.canvas.width, h = layer.canvas.height;
    const small = U.makeCanvas(Math.max(1, Math.ceil(w / block)), Math.max(1, Math.ceil(h / block)));
    const sc = U.ctx2d(small);
    sc.imageSmoothingEnabled = true;
    sc.drawImage(layer.canvas, 0, 0, small.width, small.height);
    const c = U.ctx2d(layer.canvas);
    c.imageSmoothingEnabled = false;
    c.clearRect(0, 0, w, h);
    c.drawImage(small, 0, 0, small.width, small.height, 0, 0, w, h);
  }

  /** Replace layer pixels with one channel rendered as grayscale. */
  function isolateChannel(img, chan) {
    const d = img.data;
    const idx = { r: 0, g: 1, b: 2, a: 3 }[chan];
    for (let i = 0; i < d.length; i += 4) {
      const v = d[i + idx];
      d[i] = d[i + 1] = d[i + 2] = v;
      if (chan === 'a') d[i + 3] = 255;
    }
    return img;
  }

  /** Blend filtered pixels back toward the originals using the selection mask
      as per-pixel coverage, so filters only touch the selected region. The
      layer canvas may be larger than the document (preserved off-canvas
      content) — pixels outside the document count as unselected. */
  function blendBySelection(layer, img, orig) {
    const sel = GF.select.get();
    const dw = GF.doc.doc.width, dh = GF.doc.doc.height;
    const w = img.width, h = img.height, d = img.data;
    for (let y = 0; y < h; y++) {
      const dy = y + layer.y;
      for (let x = 0; x < w; x++) {
        const dx = x + layer.x;
        const cov = (dx >= 0 && dy >= 0 && dx < dw && dy < dh) ? sel[dy * dw + dx] / 255 : 0;
        if (cov >= 1) continue;
        const i = (y * w + x) * 4;
        for (let k = 0; k < 4; k++) d[i + k] = orig[i + k] * (1 - cov) + d[i + k] * cov;
      }
    }
  }

  /** Wrap: snapshot history, run fn(imageData), write back, rerender.
      When a selection exists, the result is masked to it. */
  function applyToLayer(layer, label, fn) {
    if (!layer || !layer.canvas) { GF.util.toast('Not available on an adjustment layer'); return; }
    GF.doc.bakeOffset(layer);
    GF.history.push(GF.doc.doc, label);
    const img = getData(layer);
    const masked = GF.select.has();
    const orig = masked ? Uint8ClampedArray.from(img.data) : null;
    fn(img);
    if (masked) blendBySelection(layer, img, orig);
    putData(layer, img);
  }

  /** Build a 256-entry lookup table from curve control points [[x,y],…]
      (0–255), linearly interpolated and clamped. Missing/short → identity. */
  function buildLut(points) {
    const lut = new Uint8Array(256);
    const p = (points && points.length >= 2) ? points.slice().sort((a, b) => a[0] - b[0]) : [[0, 0], [255, 255]];
    let j = 0;
    for (let x = 0; x < 256; x++) {
      while (j < p.length - 2 && x > p[j + 1][0]) j++;
      const x0 = p[j][0], y0 = p[j][1], x1 = p[j + 1][0], y1 = p[j + 1][1];
      const t = x1 === x0 ? 0 : (x - x0) / (x1 - x0);
      lut[x] = Math.max(0, Math.min(255, Math.round(y0 + (y1 - y0) * t)));
    }
    return lut;
  }

  /** Apply per-channel lookup tables to an image. luts = {r,g,b} Uint8Array(256). */
  function curves(img, luts) {
    const d = img.data, r = luts.r, g = luts.g, b = luts.b;
    for (let i = 0; i < d.length; i += 4) { d[i] = r[d[i]]; d[i + 1] = g[d[i + 1]]; d[i + 2] = b[d[i + 2]]; }
    return img;
  }

  /** Compose a master (RGB) curve with per-channel curves into final r/g/b LUTs.
      curves = { rgb?, r?, g?, b? } each an array of [x,y] points. */
  function curveLuts(cv) {
    cv = cv || {};
    const m = buildLut(cv.rgb), cr = buildLut(cv.r), cg = buildLut(cv.g), cb = buildLut(cv.b);
    const R = new Uint8Array(256), G = new Uint8Array(256), B = new Uint8Array(256);
    for (let v = 0; v < 256; v++) { R[v] = cr[m[v]]; G[v] = cg[m[v]]; B[v] = cb[m[v]]; }
    return { r: R, g: G, b: B };
  }

  /** 256-bin histogram of an ImageData for a channel ('rgb'=luminance, or r/g/b). */
  function histogram(img, channel) {
    const d = img.data, h = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] === 0) continue;
      let v;
      if (channel === 'r') v = d[i]; else if (channel === 'g') v = d[i + 1]; else if (channel === 'b') v = d[i + 2];
      else v = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) | 0;
      h[v]++;
    }
    return h;
  }

  /** Sobel edge magnitude on luminance → an ImageData where strong edges are
      opaque (alpha 255) and everything else transparent. sensitivity 0–100
      (higher = more edges). Used by the Ink/Outline tool. */
  function sobelEdges(img, sensitivity) {
    const w = img.width, h = img.height, s = img.data;
    const lum = new Float32Array(w * h);
    for (let p = 0, i = 0; p < w * h; p++, i += 4) lum[p] = 0.299 * s[i] + 0.587 * s[i + 1] + 0.114 * s[i + 2];
    const out = new Uint8ClampedArray(s.length);
    const thr = Math.max(12, 255 * (1 - (sensitivity == null ? 50 : sensitivity) / 100));
    const at = (x, y) => lum[Math.min(h - 1, Math.max(0, y)) * w + Math.min(w - 1, Math.max(0, x))];
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const gx = (at(x + 1, y - 1) + 2 * at(x + 1, y) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x - 1, y) + at(x - 1, y + 1));
      const gy = (at(x - 1, y + 1) + 2 * at(x, y + 1) + at(x + 1, y + 1)) - (at(x - 1, y - 1) + 2 * at(x, y - 1) + at(x + 1, y - 1));
      if (Math.hypot(gx, gy) >= thr) out[(y * w + x) * 4 + 3] = 255;
    }
    return new ImageData(out, w, h);
  }

  /** Grow opaque regions outward by `px` pixels (alpha dilation) — line thickness. */
  function dilateAlpha(img, px) {
    const w = img.width, h = img.height, d = img.data;
    for (let pass = 0; pass < (px || 0); pass++) {
      const copy = Uint8ClampedArray.from(d);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (copy[i + 3] > 0) continue;
        for (let dy = -1; dy <= 1; dy++) { for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
          if (copy[(yy * w + xx) * 4 + 3] > 0) { d[i + 3] = 255; dy = 2; break; }
        } }
      }
    }
    return img;
  }

  /** Manual Levels: remap input [black,white] → [0,255] with gamma (midtones). */
  function levels(img, black, white, gamma) {
    black = black || 0; white = (white == null ? 255 : white); gamma = gamma || 1;
    const range = Math.max(1, white - black), inv = 1 / gamma, lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) { let v = (i - black) / range; v = v < 0 ? 0 : v > 1 ? 1 : v; lut[i] = Math.pow(v, inv) * 255; }
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = lut[d[i]]; d[i + 1] = lut[d[i + 1]]; d[i + 2] = lut[d[i + 2]]; }
  }

  return { getData, putData, brightnessContrast, hsl, grayscale, invert,
           posterize, autoLevels, blur, sharpen, edge, boxBlur, pixelate, levels,
           isolateChannel, applyToLayer, blendBySelection, sobelEdges, dilateAlpha,
           buildLut, curves, curveLuts, histogram };
})();
