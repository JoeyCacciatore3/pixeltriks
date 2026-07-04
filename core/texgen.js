/* PixelTriks — texgen.js
   Texture generators for image editing and the 3D workspace: normal maps,
   seamless tiling, palette extraction. Sources read from a layer; results
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

  /* ---- Procedural noise (deterministic seed for reproducible materials) ---- */
  const _P = new Uint8Array(512);
  (function () {
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    let s = 42;
    const rng = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      const tmp = p[i]; p[i] = p[j]; p[j] = tmp;
    }
    for (let i = 0; i < 512; i++) _P[i] = p[i & 255];
  })();
  function _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  function _noise(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x), yf = y - Math.floor(y);
    const u = _fade(xf), v = _fade(yf);
    const a = _P[X] + Y, b = _P[X + 1] + Y;
    const g = (h, dx, dy) => ((h & 1) ? -dx : dx) + ((h & 2) ? -dy : dy);
    return ((1 - v) * ((1 - u) * g(_P[a], xf, yf) + u * g(_P[b], xf - 1, yf)) +
      v * ((1 - u) * g(_P[a + 1], xf, yf - 1) + u * g(_P[b + 1], xf - 1, yf - 1))) * 0.5 + 0.5;
  }
  function _fbm(x, y, oct) {
    let sum = 0, amp = 1, freq = 1, max = 0;
    for (let i = 0; i < (oct || 4); i++) { sum += _noise(x * freq, y * freq) * amp; max += amp; amp *= 0.5; freq *= 2; }
    return sum / max;
  }
  function _cell(x, y) {
    const ix = Math.floor(x), iy = Math.floor(y);
    let min = 2;
    for (let j = -1; j <= 1; j++)
      for (let i = -1; i <= 1; i++) {
        const px = ix + i + _noise((ix + i) * 17.3, (iy + j) * 31.7);
        const py = iy + j + _noise((ix + i) * 47.1, (iy + j) * 23.9);
        const d = Math.sqrt((x - px) ** 2 + (y - py) ** 2);
        if (d < min) min = d;
      }
    return Math.min(1, min);
  }
  function _makeMap(w, h, fn) {
    const c = U.makeCanvas(w, h), ctx = U.ctx2d(c), img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const [r, g, b] = fn(x, y, w, h);
        const i = (y * w + x) * 4;
        img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
      }
    ctx.putImageData(img, 0, 0);
    return c;
  }

  /* ---- Material generators ---- */
  const _gens = {
    wood(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const n = _fbm(x * 0.02, y * 0.005, 5);
        const grain = Math.sin(y * 0.08 + n * 12) * 0.5 + 0.5;
        return [U.clamp(Math.round(120 + grain * 80 + (n - 0.5) * 30), 0, 255),
                U.clamp(Math.round(70 + grain * 50 + (n - 0.5) * 20), 0, 255),
                U.clamp(Math.round(30 + grain * 20), 0, 255)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const n = _fbm(x * 0.02, y * 0.005, 5);
        const v = U.clamp(Math.round((Math.sin(y * 0.08 + n * 12) * 0.3 + 0.5) * 255), 0, 255);
        return [v, v, v];
      });
      return { color, height };
    },
    'brushed-metal'(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const n = _noise(x * 0.3, y * 0.01);
        const v = U.clamp(Math.round(180 + (n - 0.5) * 40), 0, 255);
        return [v, v, v + 5 > 255 ? 255 : v + 5];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = Math.round(_noise(x * 0.5, y * 0.01) * 255);
        return [v, v, v];
      });
      return { color, height };
    },
    'rough-metal'(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const n = _fbm(x * 0.03, y * 0.03, 6);
        const v = U.clamp(Math.round(100 + (n - 0.5) * 60), 0, 255);
        return [v, Math.max(0, v - 2), Math.max(0, v - 5)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = Math.round(_fbm(x * 0.05, y * 0.05, 6) * 255);
        return [v, v, v];
      });
      return { color, height };
    },
    stone(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const n = _fbm(x * 0.015, y * 0.015, 6);
        const v = U.clamp(Math.round(140 + (n - 0.5) * 80), 0, 255);
        return [Math.max(0, v - 5), v, Math.min(255, v + 3)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = Math.round(_fbm(x * 0.02, y * 0.02, 6) * 255);
        return [v, v, v];
      });
      return { color, height };
    },
    marble(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const n = _fbm(x * 0.01, y * 0.01, 5);
        const vein = Math.sin(x * 0.02 + n * 8) * 0.5 + 0.5;
        const v = U.clamp(Math.round(220 + vein * 35 - (1 - vein) * 80), 0, 255);
        return [Math.max(0, v - 5), Math.max(0, v - 3), v];
      });
      const height = _makeMap(w, h, (x, y) => {
        const n = _fbm(x * 0.01, y * 0.01, 5);
        const v = U.clamp(Math.round((Math.sin(x * 0.02 + n * 8) * 0.3 + 0.7) * 255), 0, 255);
        return [v, v, v];
      });
      return { color, height };
    },
    brick(w, h) {
      const bW = 64, bH = 32, mo = 4;
      const color = _makeMap(w, h, (x, y) => {
        const row = Math.floor(y / bH), off = (row % 2) ? bW / 2 : 0;
        const bx = ((x + off) % bW), by = y % bH;
        if (bx < mo || by < mo) return [180, 175, 165];
        const n = _fbm(x * 0.04, y * 0.04, 3);
        return [U.clamp(Math.round(160 + n * 40), 0, 255), U.clamp(Math.round(60 + n * 30), 0, 255), U.clamp(Math.round(40 + n * 20), 0, 255)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const row = Math.floor(y / bH), off = (row % 2) ? bW / 2 : 0;
        const bx = ((x + off) % bW), by = y % bH;
        const v = (bx < mo || by < mo) ? 60 : U.clamp(Math.round(180 + _fbm(x * 0.05, y * 0.05, 3) * 40), 0, 255);
        return [v, v, v];
      });
      return { color, height };
    },
    concrete(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const n = _fbm(x * 0.04, y * 0.04, 5);
        const v = U.clamp(Math.round(160 + (n - 0.5) * 30), 0, 255);
        return [v, Math.max(0, v - 1), Math.max(0, v - 3)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = U.clamp(Math.round(_fbm(x * 0.06, y * 0.06, 5) * 200 + 30), 0, 255);
        return [v, v, v];
      });
      return { color, height };
    },
    fabric(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const wX = Math.sin(x * 0.5) > 0 ? 1 : 0, wY = Math.sin(y * 0.5) > 0 ? 1 : 0;
        const pat = (wX + wY) % 2;
        const n = _fbm(x * 0.08, y * 0.08, 3) * 0.15;
        const v = U.clamp(Math.round((pat ? 0.55 : 0.45 + n) * 255), 0, 255);
        return [Math.max(0, v - 10), v, Math.min(255, v + 15)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const wX = Math.sin(x * 0.5) > 0 ? 1 : 0, wY = Math.sin(y * 0.5) > 0 ? 1 : 0;
        const v = ((wX + wY) % 2) ? 180 : 120;
        return [v, v, v];
      });
      return { color, height };
    },
    leather(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const c = _cell(x * 0.04, y * 0.04), n = _fbm(x * 0.02, y * 0.02, 3) * 0.15;
        const base = 0.35 + c * 0.2 + n;
        return [U.clamp(Math.round(base * 200 + 40), 0, 255), U.clamp(Math.round(base * 140 + 20), 0, 255), U.clamp(Math.round(base * 80 + 10), 0, 255)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = U.clamp(Math.round(_cell(x * 0.04, y * 0.04) * 200 + 30), 0, 255);
        return [v, v, v];
      });
      return { color, height };
    },
    rust(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const n1 = _fbm(x * 0.015, y * 0.015, 5), n2 = _fbm(x * 0.04 + 100, y * 0.04 + 100, 4);
        if (n1 > 0.45) return [U.clamp(Math.round(160 + n2 * 60), 0, 255), U.clamp(Math.round(70 + n2 * 40), 0, 255), U.clamp(Math.round(20 + n2 * 15), 0, 255)];
        return [U.clamp(Math.round(80 + n2 * 30), 0, 255), U.clamp(Math.round(75 + n2 * 25), 0, 255), U.clamp(Math.round(70 + n2 * 20), 0, 255)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = U.clamp(Math.round(_fbm(x * 0.02, y * 0.02, 5) * 200 + 30), 0, 255);
        return [v, v, v];
      });
      return { color, height };
    },
    ceramic(w, h) {
      const tS = 128, gr = 6;
      const color = _makeMap(w, h, (x, y) => {
        if (x % tS < gr || y % tS < gr) return [80, 80, 75];
        const n = Math.round(_fbm(x * 0.02, y * 0.02, 2) * 8);
        return [U.clamp(235 + n, 0, 255), U.clamp(238 + n, 0, 255), U.clamp(240 + n, 0, 255)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = (x % tS < gr || y % tS < gr) ? 40 : 220;
        return [v, v, v];
      });
      return { color, height };
    },
    grass(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const n = _fbm(x * 0.03, y * 0.01, 5);
        const blade = Math.sin(x * 0.8 + _noise(x * 0.1, y * 0.02) * 6) * 0.2;
        return [U.clamp(Math.round((0.2 + n * 0.15 + blade) * 255), 0, 255),
                U.clamp(Math.round((0.45 + n * 0.25 + blade) * 255), 0, 255),
                U.clamp(Math.round((0.1 + n * 0.08) * 255), 0, 255)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = U.clamp(Math.round(_fbm(x * 0.04, y * 0.01, 4) * 200 + 30), 0, 255);
        return [v, v, v];
      });
      return { color, height };
    },
    sand(w, h) {
      const color = _makeMap(w, h, (x, y) => {
        const n = _fbm(x * 0.05, y * 0.05, 5);
        return [U.clamp(Math.round(200 + (n - 0.5) * 30), 0, 255),
                U.clamp(Math.round(180 + (n - 0.5) * 25), 0, 255),
                U.clamp(Math.round(140 + (n - 0.5) * 20), 0, 255)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = U.clamp(Math.round(_fbm(x * 0.08, y * 0.08, 5) * 180 + 40), 0, 255);
        return [v, v, v];
      });
      return { color, height };
    },
    checker(w, h) {
      const sq = 64;
      const color = _makeMap(w, h, (x, y) => {
        const v = ((Math.floor(x / sq) + Math.floor(y / sq)) % 2) ? 240 : 30;
        return [v, v, v];
      });
      const height = _makeMap(w, h, () => [128, 128, 128]);
      return { color, height };
    },
    carbon(w, h) {
      const cell = 16;
      const color = _makeMap(w, h, (x, y) => {
        const pat = (Math.floor(x / cell) + Math.floor(y / cell)) % 2;
        const diag = Math.sin((x + y) * 0.4) * 0.5 + 0.5;
        const n = _fbm(x * 0.05, y * 0.05, 2) * 0.05;
        const v = U.clamp(Math.round((pat ? 0.15 : 0.12 + diag * 0.06 + n) * 255), 0, 255);
        return [v, v, Math.min(255, v + 2)];
      });
      const height = _makeMap(w, h, (x, y) => {
        const v = ((Math.floor(x / cell) + Math.floor(y / cell)) % 2) ? 160 : 100;
        return [v, v, v];
      });
      return { color, height };
    },
  };

  const PRESETS = [
    { id: 'wood', label: 'Wood', metalness: 0, roughness: 0.7 },
    { id: 'brushed-metal', label: 'Brushed Metal', metalness: 0.9, roughness: 0.35 },
    { id: 'rough-metal', label: 'Rough Metal', metalness: 0.85, roughness: 0.6 },
    { id: 'stone', label: 'Stone', metalness: 0, roughness: 0.85 },
    { id: 'marble', label: 'Marble', metalness: 0, roughness: 0.3 },
    { id: 'brick', label: 'Brick', metalness: 0, roughness: 0.9 },
    { id: 'concrete', label: 'Concrete', metalness: 0, roughness: 0.95 },
    { id: 'fabric', label: 'Fabric', metalness: 0, roughness: 0.95 },
    { id: 'leather', label: 'Leather', metalness: 0, roughness: 0.7 },
    { id: 'rust', label: 'Rust', metalness: 0.3, roughness: 0.9 },
    { id: 'ceramic', label: 'Ceramic Tile', metalness: 0, roughness: 0.15 },
    { id: 'grass', label: 'Grass', metalness: 0, roughness: 0.9 },
    { id: 'sand', label: 'Sand', metalness: 0, roughness: 0.95 },
    { id: 'checker', label: 'Checker', metalness: 0, roughness: 0.5 },
    { id: 'carbon', label: 'Carbon Fiber', metalness: 0.4, roughness: 0.35 },
  ];

  function generateMaterial(preset, w, h) {
    w = w || 512; h = h || 512;
    const gen = _gens[preset];
    if (!gen) return null;
    const { color, height } = gen(w, h);
    const normal = normalMap({ canvas: height }, 3, false, true);
    const info = PRESETS.find(p => p.id === preset);
    return { color, normal, height, preset: info };
  }

  function listPresets() { return PRESETS.slice(); }

  return { normalMap, makeSeamless, tilePreview, extractPalette, reduceToPalette, generateMaterial, listPresets };
})();
