/* Forge Studio (Sprite) core — pure, dependency-free pixel/atlas logic.
   Shared by the browser app and the Node test suite. No DOM, no canvas. */
(function (root, factory) {
  'use strict';
  const core = factory();
  if (typeof module === 'object' && module.exports) module.exports = core;
  root.PixelForgeCore = core;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const idx = (x, y, w) => y * w + x;
  const inBounds = (x, y, w, h) => x >= 0 && y >= 0 && x < w && y < h;

  /* ---- Colors ----------------------------------------------------------
     Pixels are 32-bit unsigned ints in canvas ImageData memory order on
     little-endian machines: 0xAABBGGRR. */
  function packRGBA(r, g, b, a) {
    return (((a & 255) << 24) | ((b & 255) << 16) | ((g & 255) << 8) | (r & 255)) >>> 0;
  }
  function hexToU32(hex) {
    const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex).trim());
    if (!m) throw new Error('hexToU32: expected #rrggbb, got "' + hex + '"');
    const n = parseInt(m[1], 16);
    return packRGBA((n >> 16) & 255, (n >> 8) & 255, n & 255, 255);
  }
  function u32ToHex(c) {
    const r = c & 255, g = (c >>> 8) & 255, b = (c >>> 16) & 255;
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }
  function alphaOf(c) { return (c >>> 24) & 255; }

  /* ---- Region operations ---------------------------------------------- */

  /* 4-connected flood fill. `allow` is an optional Uint8Array mask limiting
     where the fill may spread (used to respect an active selection).
     Returns the number of pixels changed. */
  function floodFill(data, w, h, x, y, color, allow) {
    if (!inBounds(x, y, w, h)) return 0;
    const start = idx(x, y, w);
    if (allow && !allow[start]) return 0;
    const target = data[start];
    color = color >>> 0;
    if (target === color) return 0;
    const stack = [start];
    let count = 0;
    while (stack.length) {
      const i = stack.pop();
      if (data[i] !== target) continue;
      if (allow && !allow[i]) continue;
      data[i] = color;
      count++;
      const px = i % w, py = (i - px) / w;
      if (px > 0) stack.push(i - 1);
      if (px < w - 1) stack.push(i + 1);
      if (py > 0) stack.push(i - w);
      if (py < h - 1) stack.push(i + w);
    }
    return count;
  }

  /* Select all pixels matching the color at (x, y).
     contiguous=true → 4-connected region; false → every matching pixel. */
  function magicWand(data, w, h, x, y, contiguous) {
    const mask = new Uint8Array(w * h);
    if (!inBounds(x, y, w, h)) return mask;
    const target = data[idx(x, y, w)];
    if (contiguous === false) {
      for (let i = 0; i < data.length; i++) if (data[i] === target) mask[i] = 1;
      return mask;
    }
    const stack = [idx(x, y, w)];
    while (stack.length) {
      const i = stack.pop();
      if (mask[i] || data[i] !== target) continue;
      mask[i] = 1;
      const px = i % w, py = (i - px) / w;
      if (px > 0) stack.push(i - 1);
      if (px < w - 1) stack.push(i + 1);
      if (py > 0) stack.push(i - w);
      if (py < h - 1) stack.push(i + w);
    }
    return mask;
  }

  function maskCount(mask) {
    let n = 0;
    for (let i = 0; i < mask.length; i++) if (mask[i]) n++;
    return n;
  }

  /* Bounding box of a mask, or null if the mask is empty. */
  function maskBounds(mask, w, h) {
    let minX = w, minY = h, maxX = -1, maxY = -1;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (mask[idx(x, y, w)]) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    return maxX < 0 ? null : { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
  }

  /* Split a cel by mask: the isolated region and what remains.
     This is the "isolate regions of assets" primitive. */
  function extractMask(data, mask) {
    const extracted = new Uint32Array(data.length);
    const remaining = new Uint32Array(data);
    for (let i = 0; i < data.length; i++) {
      if (mask[i]) { extracted[i] = data[i]; remaining[i] = 0; }
    }
    return { extracted, remaining };
  }

  /* Move the masked region of a cel by (dx, dy); pixels shifted off the
     canvas are clipped. Returns the new cel and the moved mask. */
  function shiftMasked(data, mask, w, h, dx, dy) {
    const out = new Uint32Array(data);
    const outMask = new Uint8Array(w * h);
    for (let i = 0; i < data.length; i++) if (mask[i]) out[i] = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = idx(x, y, w);
        if (!mask[i]) continue;
        const nx = x + dx, ny = y + dy;
        if (!inBounds(nx, ny, w, h)) continue;
        const j = idx(nx, ny, w);
        out[j] = data[i];
        outMask[j] = 1;
      }
    }
    return { data: out, mask: outMask };
  }

  /* Bresenham line; calls plot(x, y) for every point including endpoints. */
  function line(x0, y0, x1, y1, plot) {
    let dx = Math.abs(x1 - x0), sx = x0 < x1 ? 1 : -1;
    let dy = -Math.abs(y1 - y0), sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    for (;;) {
      plot(x0, y0);
      if (x0 === x1 && y0 === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /* ---- Sheet packing & atlas ------------------------------------------ */

  /* Row-major grid layout for uniform frames.
     maxWidth (optional) caps the sheet width in pixels. */
  function packRows(fw, fh, count, maxWidth) {
    if (!(fw > 0 && fh > 0 && count > 0)) throw new Error('packRows: fw, fh, count must be positive');
    let cols = Math.ceil(Math.sqrt(count));
    if (maxWidth > 0) cols = Math.min(cols, Math.max(1, Math.floor(maxWidth / fw)));
    cols = Math.max(1, Math.min(cols, count));
    const rows = Math.ceil(count / cols);
    const positions = [];
    for (let i = 0; i < count; i++) {
      positions.push({ x: (i % cols) * fw, y: Math.floor(i / cols) * fh });
    }
    return { cols, rows, sheetW: cols * fw, sheetH: rows * fh, positions };
  }

  /* Row-major rects for slicing a sheet into uniform frames. */
  function sliceGrid(W, H, fw, fh) {
    if (!(fw > 0 && fh > 0)) throw new Error('sliceGrid: frame size must be positive');
    const rects = [];
    for (let y = 0; y + fh <= H; y += fh) {
      for (let x = 0; x + fw <= W; x += fw) {
        rects.push({ x, y, w: fw, h: fh });
      }
    }
    return rects;
  }

  /* Aseprite json-array–compatible atlas, so existing loaders work as-is. */
  function buildAtlas(opts) {
    const { name, fw, fh, sheetW, sheetH, positions, frameDurations, tags } = opts;
    if (!positions || !frameDurations || positions.length !== frameDurations.length) {
      throw new Error('buildAtlas: positions and frameDurations must align');
    }
    const n = positions.length;
    for (const t of tags || []) {
      if (!(Number.isInteger(t.from) && Number.isInteger(t.to) && t.from >= 0 && t.to < n && t.from <= t.to)) {
        throw new Error('buildAtlas: tag "' + t.name + '" range [' + t.from + ',' + t.to + '] is outside 0..' + (n - 1));
      }
    }
    return {
      frames: positions.map((p, i) => ({
        filename: name + ' ' + i + '.png',
        frame: { x: p.x, y: p.y, w: fw, h: fh },
        rotated: false,
        trimmed: false,
        spriteSourceSize: { x: 0, y: 0, w: fw, h: fh },
        sourceSize: { w: fw, h: fh },
        duration: frameDurations[i]
      })),
      meta: {
        app: 'Forge Studio',
        version: '1.0.0',
        image: name + '.png',
        format: 'RGBA8888',
        size: { w: sheetW, h: sheetH },
        scale: '1',
        frameTags: (tags || []).map(t => ({ name: t.name, from: t.from, to: t.to, direction: 'forward' }))
      }
    };
  }

  /* ---- Palette --------------------------------------------------------- */

  /* Unique opaque-ish colors in first-seen order, capped. */
  function extractPalette(data, cap) {
    cap = cap || 64;
    const seen = new Set();
    const out = [];
    for (let i = 0; i < data.length && out.length < cap; i++) {
      const c = data[i];
      if (alphaOf(c) === 0) continue;
      if (!seen.has(c)) { seen.add(c); out.push(c); }
    }
    return out;
  }

  /* Replace every `from` pixel with `to`. Returns count changed. */
  function remapColor(data, from, to) {
    from = from >>> 0; to = to >>> 0;
    let n = 0;
    for (let i = 0; i < data.length; i++) {
      if (data[i] === from) { data[i] = to; n++; }
    }
    return n;
  }

  /* ---- Run-length encoding for project files --------------------------- */

  function rleEncode(u32) {
    const out = [];
    let i = 0;
    while (i < u32.length) {
      const v = u32[i];
      let run = 1;
      while (i + run < u32.length && u32[i + run] === v) run++;
      out.push(run, v);
      i += run;
    }
    return out;
  }

  function rleDecode(arr, len) {
    if (arr.length % 2 !== 0) throw new Error('rleDecode: malformed run list');
    const out = new Uint32Array(len);
    let p = 0;
    for (let i = 0; i < arr.length; i += 2) {
      const run = arr[i], v = arr[i + 1] >>> 0;
      if (!(Number.isInteger(run) && run > 0)) throw new Error('rleDecode: invalid run length');
      if (p + run > len) throw new Error('rleDecode: data longer than expected ' + len);
      out.fill(v, p, p + run);
      p += run;
    }
    if (p !== len) throw new Error('rleDecode: data shorter than expected ' + len + ' (got ' + p + ')');
    return out;
  }

  /* ---- Project (de)serialization --------------------------------------- */

  const FORMAT = 'pixelforge';
  const VERSION = 1;

  function serializeProject(p) {
    return JSON.stringify({
      format: FORMAT,
      version: VERSION,
      name: p.name,
      w: p.w,
      h: p.h,
      fps: p.fps,
      palette: p.palette.map(u32ToHex),
      frames: p.frames.map(f => ({ duration: f.duration || 0 })),
      tags: p.tags.map(t => ({ name: t.name, from: t.from, to: t.to })),
      layers: p.layers.map(l => ({
        name: l.name,
        visible: !!l.visible,
        opacity: l.opacity == null ? 1 : l.opacity,
        blend: l.blend || 'source-over',
        cels: l.cels.map(c => (c ? rleEncode(c) : null))
      }))
    });
  }

  function deserializeProject(str) {
    let d;
    try { d = JSON.parse(str); }
    catch (e) { throw new Error('Project file is not valid JSON'); }
    if (d.format !== FORMAT) throw new Error('Not a Forge Studio project file');
    if (d.version !== VERSION) throw new Error('Unsupported project version ' + d.version);
    if (!(Number.isInteger(d.w) && Number.isInteger(d.h) && d.w > 0 && d.h > 0)) {
      throw new Error('Project has invalid canvas size');
    }
    const len = d.w * d.h;
    const p = {
      name: String(d.name || 'sprite'),
      w: d.w,
      h: d.h,
      fps: Number(d.fps) > 0 ? Number(d.fps) : 8,
      palette: (d.palette || []).map(hexToU32),
      frames: (d.frames || []).map(f => ({ duration: Number(f.duration) || 0 })),
      tags: (d.tags || []).map(t => ({ name: String(t.name), from: t.from | 0, to: t.to | 0 })),
      layers: (d.layers || []).map(l => ({
        name: String(l.name || 'Layer'),
        visible: l.visible !== false,
        opacity: typeof l.opacity === 'number' ? Math.max(0, Math.min(1, l.opacity)) : 1,
        blend: typeof l.blend === 'string' ? l.blend : 'source-over',
        cels: (l.cels || []).map(c => (c == null ? null : rleDecode(c, len)))
      }))
    };
    if (p.frames.length === 0) throw new Error('Project has no frames');
    if (p.layers.length === 0) throw new Error('Project has no layers');
    for (const l of p.layers) {
      while (l.cels.length < p.frames.length) l.cels.push(null);
      l.cels.length = p.frames.length;
    }
    return p;
  }

  return {
    idx, inBounds, packRGBA, hexToU32, u32ToHex, alphaOf,
    floodFill, magicWand, maskCount, maskBounds, extractMask, shiftMasked, line,
    packRows, sliceGrid, buildAtlas,
    extractPalette, remapColor,
    rleEncode, rleDecode,
    serializeProject, deserializeProject
  };
});
