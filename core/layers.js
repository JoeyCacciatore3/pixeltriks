/* Forge Studio — layers.js
   Document model: an ordered stack of layers, each backed by its own
   canvas at document resolution. Compositing uses the browser's native
   GPU-accelerated blend modes via globalCompositeOperation. */
'use strict';
window.GF = window.GF || {};

GF.doc = (function () {
  const U = GF.util;
  let nextId = 1;

  const doc = {
    width: 0,
    height: 0,
    layers: [],   // index 0 = bottom
    activeId: null,
    name: 'untitled',
    open: false,
    maskEdit: false,  // when true, paint tools target the active layer's mask
    preview: null     // { id, fn } — display-only filter preview on one layer (live slider drag)
  };

  function createLayer(name, w, h) {
    return {
      id: nextId++,
      name: name,
      visible: true,
      opacity: 1,
      blend: 'source-over',
      x: 0, y: 0,           // layer offset within the document
      // 9-slice insets — when set, exporters can scale this layer to any
      // target size while keeping corners crisp and middles stretched.
      // null = no 9-slice; { top, right, bottom, left } in pixels otherwise.
      nineSlice: null,
      // Non-destructive layer mask: a doc-sized RGBA canvas whose ALPHA = coverage
      // (opaque = visible). null = no mask. Compositing uses destination-in.
      mask: null,
      canvas: U.makeCanvas(w, h)
    };
  }

  /** An adjustment layer: re-editable color/tone op applied to the layers below
      it. No pixels of its own (canvas:null); supports mask + opacity + clip. */
  function createAdjustmentLayer(kind, params) {
    return {
      id: nextId++, name: ADJUST_LABELS[kind] || kind,
      visible: true, opacity: 1, blend: 'source-over', x: 0, y: 0,
      nineSlice: null, mask: null,
      adjust: { kind, params: params || {} }, clip: false,
      canvas: null,
    };
  }

  const ADJUST_LABELS = {
    brightnessContrast: 'Brightness / Contrast', hsl: 'Hue / Saturation',
    posterize: 'Posterize', invert: 'Invert', grayscale: 'Grayscale', autoLevels: 'Auto Levels',
    curves: 'Curves', levels: 'Levels',
  };

  /** Render a layer with 9-slice scaling to a target (w, h) canvas.
      Insets clamp to the source dimensions so degenerate values still
      render something sensible instead of throwing. */
  function renderNineSliced(L, targetW, targetH) {
    const s = L.canvas;
    const sw = s.width, sh = s.height;
    const ns = L.nineSlice || { top: 0, right: 0, bottom: 0, left: 0 };
    const t = Math.max(0, Math.min(ns.top    | 0, Math.floor(sh / 2)));
    const b = Math.max(0, Math.min(ns.bottom | 0, Math.floor(sh / 2)));
    const l = Math.max(0, Math.min(ns.left   | 0, Math.floor(sw / 2)));
    const r = Math.max(0, Math.min(ns.right  | 0, Math.floor(sw / 2)));

    const out = U.makeCanvas(Math.max(1, targetW | 0), Math.max(1, targetH | 0));
    const x = U.ctx2d(out);
    x.imageSmoothingEnabled = false; // crisp stretches; flip on per-cell below if needed

    const sCenterW = Math.max(0, sw - l - r);
    const sCenterH = Math.max(0, sh - t - b);
    const dCenterW = Math.max(0, out.width  - l - r);
    const dCenterH = Math.max(0, out.height - t - b);

    // 9 cells: tl, t, tr, l, c, r, bl, b, br
    // corners — copy 1:1
    if (l && t) x.drawImage(s, 0,        0,        l, t, 0,              0,              l, t);
    if (r && t) x.drawImage(s, sw - r,   0,        r, t, out.width - r,  0,              r, t);
    if (l && b) x.drawImage(s, 0,        sh - b,   l, b, 0,              out.height - b, l, b);
    if (r && b) x.drawImage(s, sw - r,   sh - b,   r, b, out.width - r,  out.height - b, r, b);
    // edges — stretch the one open axis
    if (sCenterW && t)        x.drawImage(s, l,      0,      sCenterW, t,        l,              0,              dCenterW, t);
    if (sCenterW && b)        x.drawImage(s, l,      sh - b, sCenterW, b,        l,              out.height - b, dCenterW, b);
    if (sCenterH && l)        x.drawImage(s, 0,      t,      l,        sCenterH, 0,              t,              l,        dCenterH);
    if (sCenterH && r)        x.drawImage(s, sw - r, t,      r,        sCenterH, out.width - r,  t,              r,        dCenterH);
    // center — stretch both axes
    if (sCenterW && sCenterH) x.drawImage(s, l,      t,      sCenterW, sCenterH, l,              t,              dCenterW, dCenterH);
    return out;
  }

  function newDocument(w, h, bg, name) {
    doc.width = w; doc.height = h;
    doc.layers = [];
    doc.name = name || 'untitled';
    doc.open = true;
    const base = createLayer('Background', w, h);
    if (bg && bg !== 'transparent') {
      const c = U.ctx2d(base.canvas);
      c.fillStyle = bg;
      c.fillRect(0, 0, w, h);
    }
    doc.layers.push(base);
    doc.activeId = base.id;
    GF.history.clear();
  }

  function active() {
    return doc.layers.find(L => L.id === doc.activeId) || null;
  }
  function activeIndex() {
    return doc.layers.findIndex(L => L.id === doc.activeId);
  }
  function byId(id) { return doc.layers.find(L => L.id === id) || null; }

  function addLayer(name, opts) {
    const L = createLayer(name || ('Layer ' + nextId), doc.width, doc.height);
    if (opts && opts.canvas) {
      U.ctx2d(L.canvas).drawImage(opts.canvas, 0, 0);
    }
    const idx = activeIndex();
    doc.layers.splice(idx + 1, 0, L); // above active
    doc.activeId = L.id;
    return L;
  }

  function duplicateActive() {
    const src = active();
    if (!src) return null;
    let L;
    if (src.adjust) { L = createAdjustmentLayer(src.adjust.kind, Object.assign({}, src.adjust.params)); L.clip = src.clip; }
    else { L = createLayer(src.name + ' copy', doc.width, doc.height); U.ctx2d(L.canvas).drawImage(src.canvas, 0, 0); }
    L.name = src.name + ' copy';
    L.opacity = src.opacity; L.blend = src.blend; L.visible = src.visible; L.x = src.x; L.y = src.y;
    if (src.mask) { L.mask = U.makeCanvas(doc.width, doc.height); U.ctx2d(L.mask).drawImage(src.mask, 0, 0); }
    doc.layers.splice(activeIndex() + 1, 0, L);
    doc.activeId = L.id;
    return L;
  }

  function deleteActive() {
    if (doc.layers.length <= 1) return false; // always keep one layer
    const idx = activeIndex();
    doc.layers.splice(idx, 1);
    doc.activeId = doc.layers[Math.max(0, idx - 1)].id;
    return true;
  }

  function moveActive(delta) {
    const idx = activeIndex();
    const to = idx + delta;
    if (to < 0 || to >= doc.layers.length) return false;
    const [L] = doc.layers.splice(idx, 1);
    doc.layers.splice(to, 0, L);
    return true;
  }

  /** Merge the active layer into the one below it, honoring blend & opacity. */
  function mergeDown() {
    const idx = activeIndex();
    if (idx <= 0) return false;
    const top = doc.layers[idx];
    const below = doc.layers[idx - 1];
    if (top.adjust || below.adjust) return false; // adjustment layers can't be merged this way
    const topCanvas = top.mask ? maskedLayerCanvas(top) : top.canvas;
    const tx = top.mask ? 0 : top.x, ty = top.mask ? 0 : top.y;
    const c = U.ctx2d(below.canvas);
    c.save();
    c.globalAlpha = top.opacity;
    c.globalCompositeOperation = top.blend;
    c.drawImage(topCanvas, tx - below.x, ty - below.y);
    c.restore();
    doc.layers.splice(idx, 1);
    doc.activeId = below.id;
    return true;
  }

  function flatten() {
    const flat = composite();
    const L = createLayer('Flattened', doc.width, doc.height);
    U.ctx2d(L.canvas).drawImage(flat, 0, 0);
    doc.layers = [L];
    doc.activeId = L.id;
  }

  /* ---------------- non-destructive helpers ---------------- */

  /** The canvas to draw for a pixel layer, with a live filter preview applied
      (display only — never touches the stored pixels). */
  function previewedCanvas(L) {
    if (!(doc.preview && doc.preview.id === L.id && L.canvas)) return L.canvas;
    const t = U.makeCanvas(L.canvas.width, L.canvas.height), tc = U.ctx2d(t);
    tc.drawImage(L.canvas, 0, 0);
    const img = tc.getImageData(0, 0, t.width, t.height);
    try { doc.preview.fn(img); } catch (e) {}
    tc.putImageData(img, 0, 0);
    return t;
  }

  /** A doc-sized copy of a pixel layer with its mask applied (alpha = coverage). */
  function maskedLayerCanvas(L, srcCanvas) {
    const t = U.makeCanvas(doc.width, doc.height), tc = U.ctx2d(t);
    tc.drawImage(srcCanvas || L.canvas, L.x, L.y);
    tc.globalCompositeOperation = 'destination-in';
    tc.drawImage(L.mask, 0, 0);
    return t;
  }

  function setPreview(id, fn) { doc.preview = { id, fn }; }
  function clearPreview() { if (doc.preview) doc.preview = null; }

  /** Apply an adjustment in place to an ImageData via the existing GF.filters. */
  function applyAdjust(img, adj) {
    const F = GF.filters, p = adj.params || {};
    switch (adj.kind) {
      case 'brightnessContrast': F.brightnessContrast(img, p.brightness || 0, p.contrast || 0); break;
      case 'hsl': F.hsl(img, p.h || 0, p.s || 0, p.l || 0); break;
      case 'posterize': F.posterize(img, p.levels || 4); break;
      case 'invert': F.invert(img); break;
      case 'grayscale': F.grayscale(img); break;
      case 'autoLevels': F.autoLevels(img); break;
      case 'levels': F.levels(img, p.black || 0, p.white == null ? 255 : p.white, p.gamma || 1); break;
      case 'curves': F.curves(img, F.curveLuts(p.curves)); break;
    }
  }

  /** Doc-space alpha (0–255) of a pixel layer with its mask, for clip masks. */
  function layerAlphaDoc(L) {
    const src = L.mask ? maskedLayerCanvas(L) : (() => { const t = U.makeCanvas(doc.width, doc.height); U.ctx2d(t).drawImage(L.canvas, L.x, L.y); return t; })();
    return U.ctx2d(src).getImageData(0, 0, doc.width, doc.height).data;
  }

  /** Apply an adjustment layer to the running composite `out` (everything below).
      Coverage = opacity × mask × (clip ? layer-below alpha : 1). */
  function applyAdjustmentLayer(out, c, L, below) {
    const w = doc.width, h = doc.height;
    const base = c.getImageData(0, 0, w, h);
    const adj = new ImageData(Uint8ClampedArray.from(base.data), w, h);
    applyAdjust(adj, L.adjust);
    const maskA = L.mask ? U.ctx2d(L.mask).getImageData(0, 0, w, h).data : null;
    const clipA = (L.clip && below && !below.adjust) ? layerAlphaDoc(below) : null;
    const op = L.opacity == null ? 1 : L.opacity;
    const bd = base.data, ad = adj.data;
    for (let p = 0, i = 0; p < w * h; p++, i += 4) {
      let k = op;
      if (maskA) k *= maskA[i + 3] / 255;
      if (clipA) k *= clipA[i + 3] / 255;
      if (k <= 0) continue;
      bd[i] += (ad[i] - bd[i]) * k;
      bd[i + 1] += (ad[i + 1] - bd[i + 1]) * k;
      bd[i + 2] += (ad[i + 2] - bd[i + 2]) * k;
    }
    c.putImageData(base, 0, 0);
  }

  /** Render all visible layers into one canvas at document size. */
  function composite(opts) {
    const out = U.makeCanvas(doc.width, doc.height);
    const c = U.ctx2d(out);
    for (let i = 0; i < doc.layers.length; i++) {
      const L = doc.layers[i];
      if (!L.visible) continue;
      if (opts && opts.onlyId && L.id !== opts.onlyId) continue;
      if (L.adjust) {
        if (!(opts && opts.onlyId)) applyAdjustmentLayer(out, c, L, doc.layers[i - 1]);
        continue;
      }
      c.save();
      c.globalAlpha = L.opacity;
      c.globalCompositeOperation = L.blend;
      const src = previewedCanvas(L);
      c.drawImage(L.mask ? maskedLayerCanvas(L, src) : src, L.mask ? 0 : L.x, L.mask ? 0 : L.y);
      c.restore();
    }
    return out;
  }

  /* ---------------- masks + adjustment layers (public ops) ---------------- */

  function newMaskCanvas(init) {
    const m = U.makeCanvas(doc.width, doc.height);
    if (init === 'reveal') { const c = U.ctx2d(m); c.fillStyle = '#fff'; c.fillRect(0, 0, doc.width, doc.height); }
    else if (init === 'selection' && GF.select && GF.select.has()) { U.ctx2d(m).drawImage(GF.select.maskCanvas(), 0, 0); }
    else { const c = U.ctx2d(m); c.fillStyle = '#fff'; c.fillRect(0, 0, doc.width, doc.height); }
    return m;
  }
  function addMask(L, init) { L = L || active(); if (!L || L.mask) return; L.mask = newMaskCanvas(init || 'reveal'); }
  function removeMask(L) { L = L || active(); if (L) L.mask = null; }
  function invertMask(L) {
    L = L || active(); if (!L || !L.mask) return;
    const c = U.ctx2d(L.mask), img = c.getImageData(0, 0, doc.width, doc.height), d = img.data;
    for (let i = 0; i < d.length; i += 4) { d[i] = 255; d[i + 1] = 255; d[i + 2] = 255; d[i + 3] = 255 - d[i + 3]; }
    c.putImageData(img, 0, 0);
  }
  function applyMask(L) {
    L = L || active(); if (!L || !L.mask || !L.canvas) return;
    const baked = maskedLayerCanvas(L);
    const c = U.ctx2d(L.canvas); c.clearRect(0, 0, L.canvas.width, L.canvas.height);
    c.drawImage(baked, -L.x, -L.y);
    L.mask = null;
  }
  function addAdjustment(kind, params) {
    const L = createAdjustmentLayer(kind, params);
    doc.layers.splice(activeIndex() + 1, 0, L);
    doc.activeId = L.id;
    return L;
  }
  function setAdjust(L, params) { L = L || active(); if (L && L.adjust) Object.assign(L.adjust.params, params); }

  /** What the paint tools should draw into: the active layer's mask (mask-edit
      mode) or its pixel canvas. Returns {canvas, x, y} or null. */
  function paintTarget() {
    const L = active();
    if (!L) return null;
    if (doc.maskEdit && L.mask) return { canvas: L.mask, x: 0, y: 0, isMask: true };
    if (!L.canvas) return null; // adjustment layer with no mask-edit
    return { canvas: L.canvas, x: L.x, y: L.y, isMask: false };
  }

  function resize(w, h, scaleContent) {
    for (const L of doc.layers) {
      if (L.canvas) {
        const next = U.makeCanvas(w, h);
        const c = U.ctx2d(next);
        if (scaleContent) {
          c.drawImage(L.canvas, 0, 0, L.canvas.width, L.canvas.height, 0, 0, w, h);
          L.x = 0; L.y = 0;
        } else {
          c.drawImage(L.canvas, L.x, L.y);
          L.x = 0; L.y = 0;
        }
        L.canvas = next;
      }
      if (L.mask) {  // masks are doc-sized — keep them aligned with the canvas
        const nm = U.makeCanvas(w, h), mc = U.ctx2d(nm);
        if (scaleContent) mc.drawImage(L.mask, 0, 0, L.mask.width, L.mask.height, 0, 0, w, h);
        else mc.drawImage(L.mask, 0, 0);
        L.mask = nm;
      }
    }
    doc.width = w; doc.height = h;
  }

  /** Bake a layer's offset into its pixels (used before pixel filters/brush/fill).
      Grows the canvas to the union of the document and the shifted layer rather
      than clipping to the document, so content moved partly off-canvas survives —
      move it back and it's still there. Compositing/export already honor L.x/L.y,
      so an oversized, offset layer renders correctly. */
  function bakeOffset(L) {
    if (L.x === 0 && L.y === 0) return;
    const minX = Math.min(0, L.x), minY = Math.min(0, L.y);
    const maxX = Math.max(doc.width,  L.x + L.canvas.width);
    const maxY = Math.max(doc.height, L.y + L.canvas.height);
    const w = Math.round(maxX - minX), h = Math.round(maxY - minY);
    const next = U.makeCanvas(w, h);
    U.ctx2d(next).drawImage(L.canvas, L.x - minX, L.y - minY);
    L.canvas = next; L.x = minX; L.y = minY;
  }

  /** A document-sized, origin-aligned rasterization of a layer, for read-only
      analysis (normal map, PBR, tiling). Identical pixels to L.canvas when the
      layer has no offset, so unmoved-layer results are unchanged. */
  function docAligned(L) {
    const c = U.makeCanvas(doc.width, doc.height);
    if (L && L.canvas) U.ctx2d(c).drawImage(L.canvas, L.x, L.y);
    return { canvas: c, x: 0, y: 0 };
  }

  /* ---------- transforms (all offset-aware) ---------- */

  /** Mirror a layer's pixels and reflect its offset across the document axis,
      so what you see flips in place even for moved/oversized layers. */
  function flipLayer(L, horiz) {
    if (!L.canvas) return;   // adjustment layer — nothing to flip
    const w = L.canvas.width, h = L.canvas.height;
    const c = U.makeCanvas(w, h), x = U.ctx2d(c);
    x.translate(horiz ? w : 0, horiz ? 0 : h);
    x.scale(horiz ? -1 : 1, horiz ? 1 : -1);
    x.drawImage(L.canvas, 0, 0);
    L.canvas = c;
    if (horiz) L.x = doc.width - L.x - w; else L.y = doc.height - L.y - h;
    if (L.mask) {  // keep the mask aligned (doc-sized, flip about doc center)
      const m = U.makeCanvas(doc.width, doc.height), mx = U.ctx2d(m);
      mx.translate(horiz ? doc.width : 0, horiz ? 0 : doc.height);
      mx.scale(horiz ? -1 : 1, horiz ? 1 : -1);
      mx.drawImage(L.mask, 0, 0); L.mask = m;
    }
  }

  /** Rotate a layer 90° about the document center. */
  function rotateLayer90(L, cw) {
    if (!L.canvas) return;
    const w = L.canvas.width, h = L.canvas.height;
    const c = U.makeCanvas(h, w), x = U.ctx2d(c);
    x.translate(h / 2, w / 2);
    x.rotate((cw ? 1 : -1) * Math.PI / 2);
    x.drawImage(L.canvas, -w / 2, -h / 2);
    L.canvas = c;
    const cx = doc.width / 2, cy = doc.height / 2;
    const dx = (L.x + w / 2) - cx, dy = (L.y + h / 2) - cy;
    const ncx = cw ? cx - dy : cx + dy;
    const ncy = cw ? cy + dx : cy - dx;
    L.x = Math.round(ncx - h / 2); L.y = Math.round(ncy - w / 2);
  }

  /** Scale a layer about its own center. */
  function scaleLayer(L, pct) {
    if (!L.canvas) return;
    const f = pct / 100;
    const w = L.canvas.width, h = L.canvas.height;
    const nw = Math.max(1, Math.round(w * f)), nh = Math.max(1, Math.round(h * f));
    const c = U.makeCanvas(nw, nh), x = U.ctx2d(c);
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high';
    x.drawImage(L.canvas, 0, 0, nw, nh);
    L.canvas = c;
    L.x = Math.round(L.x + (w - nw) / 2);
    L.y = Math.round(L.y + (h - nh) / 2);
  }

  function flipCanvas(horiz) { for (const L of doc.layers) flipLayer(L, horiz); }

  /** Rotate the whole document 90°, swapping its dimensions. */
  function rotateCanvas90(cw) {
    const oldW = doc.width, oldH = doc.height;
    for (const L of doc.layers) {
      const w = L.canvas.width, h = L.canvas.height;
      const c = U.makeCanvas(h, w), x = U.ctx2d(c);
      x.translate(h / 2, w / 2);
      x.rotate((cw ? 1 : -1) * Math.PI / 2);
      x.drawImage(L.canvas, -w / 2, -h / 2);
      const nx = cw ? oldH - L.y - h : L.y;
      const ny = cw ? L.x : oldW - L.x - w;
      L.canvas = c; L.x = nx; L.y = ny;
    }
    doc.width = oldH; doc.height = oldW;
  }

  /* ---------- document fit (trim / reveal) ---------- */

  /** Crop the document to the bounding box of visible (non-transparent)
      composite content. Returns false when the document is empty. */
  function trimToContent() {
    const flat = composite();
    const d = U.ctx2d(flat).getImageData(0, 0, doc.width, doc.height).data;
    let minX = doc.width, minY = doc.height, maxX = -1, maxY = -1;
    for (let y = 0; y < doc.height; y++) for (let x = 0; x < doc.width; x++) {
      if (d[(y * doc.width + x) * 4 + 3] > 8) {
        if (x < minX) minX = x; if (x > maxX) maxX = x;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return false;
    for (const L of doc.layers) { L.x -= minX; L.y -= minY; }
    doc.width = maxX - minX + 1;
    doc.height = maxY - minY + 1;
    return true;
  }

  /** Grow the document to the union of all layer canvases, bringing content
      that was moved off-canvas back into view (capped at 8192²). */
  function revealAll() {
    let minX = 0, minY = 0, maxX = doc.width, maxY = doc.height;
    for (const L of doc.layers) {
      minX = Math.min(minX, L.x); minY = Math.min(minY, L.y);
      maxX = Math.max(maxX, L.x + L.canvas.width);
      maxY = Math.max(maxY, L.y + L.canvas.height);
    }
    const w = Math.min(8192, maxX - minX), h = Math.min(8192, maxY - minY);
    for (const L of doc.layers) { L.x -= minX; L.y -= minY; }
    doc.width = w; doc.height = h;
  }

  /* ---------- project save / load (.json with embedded PNGs) ---------- */

  function serialize() {
    return {
      app: 'GameForge', version: 1,
      name: doc.name, width: doc.width, height: doc.height,
      activeId: doc.activeId,
      layers: doc.layers.map(L => {
        const o = {
          id: L.id, name: L.name, visible: L.visible, opacity: L.opacity,
          blend: L.blend, x: L.x, y: L.y, nineSlice: L.nineSlice || null, clip: L.clip || false,
        };
        if (L.adjust) o.adjust = { kind: L.adjust.kind, params: L.adjust.params };
        else o.png = L.canvas.toDataURL('image/png');
        if (L.mask) o.mask = L.mask.toDataURL('image/png');
        if (L.text) o.text = L.text;     // re-editable text layer metadata
        return o;
      }),
    };
  }

  function deserialize(data) {
    const loadImg = (src) => new Promise((res, rej) => {
      const im = new Image(); im.onload = () => res(im);
      im.onerror = () => rej(new Error('A layer image in the project failed to load.')); im.src = src;
    });
    return new Promise((resolve, reject) => {
      if (!data || data.app !== 'GameForge' || !Array.isArray(data.layers)) {
        reject(new Error('Not a Forge Studio project file.'));
        return;
      }
      Promise.all(data.layers.map(async (s) => ({
        s, png: s.png ? await loadImg(s.png) : null, maskImg: s.mask ? await loadImg(s.mask) : null,
      }))).then(items => {
        doc.width = data.width; doc.height = data.height;
        doc.name = data.name || 'untitled';
        doc.open = true;
        doc.layers = items.map(({ s, png, maskImg }) => {
          let canvas = null;
          if (png) { canvas = U.makeCanvas(data.width, data.height); U.ctx2d(canvas).drawImage(png, 0, 0); }
          let mask = null;
          if (maskImg) { mask = U.makeCanvas(data.width, data.height); U.ctx2d(mask).drawImage(maskImg, 0, 0); }
          const L = {
            id: nextId++, name: s.name, visible: s.visible, opacity: s.opacity,
            blend: s.blend, x: s.x || 0, y: s.y || 0, nineSlice: s.nineSlice || null,
            mask, canvas,
          };
          if (s.adjust) { L.adjust = { kind: s.adjust.kind, params: s.adjust.params || {} }; L.clip = s.clip || false; }
          if (s.text) L.text = s.text;
          return L;
        });
        doc.activeId = doc.layers[doc.layers.length - 1].id;
        GF.history.clear();
        resolve();
      }).catch(reject);
    });
  }

  return { doc, newDocument, active, activeIndex, byId, addLayer, duplicateActive,
           deleteActive, moveActive, mergeDown, flatten, composite, resize,
           bakeOffset, docAligned, flipLayer, rotateLayer90, scaleLayer,
           flipCanvas, rotateCanvas90, trimToContent, revealAll,
           renderNineSliced, serialize, deserialize,
           addMask, removeMask, invertMask, applyMask, maskedLayerCanvas,
           addAdjustment, setAdjust, paintTarget, previewedCanvas, setPreview, clearPreview };
})();
