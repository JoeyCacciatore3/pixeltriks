/* PixelTriks — library.js
   Asset sources for the canvas and the 3D workspace. Two kinds:
     • Procedural generators (pure-JS, fully offline): clouds, wood, marble,
       bricks, checker, gradient, stone, metal, grass, rust — rendered to a
       layer or a new document on demand (the `generate` api command).
     • Poly Haven (CC0 / public domain, no key, no signup): textures (PBR
       sets), HDRIs (3D environment lighting) and glTF models. Online-only;
       callers degrade gracefully without a connection.

   Poly Haven's API and CDNs send permissive CORS headers, so remote images
   load CORS-clean and stay editable/exportable on the canvas. */
'use strict';
window.GF = window.GF || {};

GF.library = (function () {
  const U = GF.util;
  const D = GF.doc;
  const API = 'https://api.polyhaven.com';
  const thumbUrl = id => `https://cdn.polyhaven.com/asset_img/thumbs/${id}.png?width=256&height=256`;

  let listCache = {};   // type -> assets object

  /* ============== Poly Haven API ============== */
  async function apiList(type) {
    if (listCache[type]) return listCache[type];
    const r = await fetch(`${API}/assets?t=${type}`);
    if (!r.ok) throw new Error('API request failed');
    const j = await r.json();
    listCache[type] = j;
    return j;
  }
  async function apiFiles(id) {
    const r = await fetch(`${API}/files/${id}`);
    if (!r.ok) throw new Error('API request failed');
    return r.json();
  }
  function loadImage(url) {
    return new Promise((res, rej) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => res(img);
      img.onerror = () => rej(new Error('Image failed to load (offline?)'));
      img.src = url;
    });
  }
  /** Find a usable URL for the first matching map key, with format/res fallback. */
  function pickUrl(files, keys, res) {
    for (const k of keys) {
      const m = files[k]; if (!m) continue;
      const r = m[res] || m['1k'] || m['2k'] || m[Object.keys(m)[0]]; if (!r) continue;
      const f = r.jpg || r.png || Object.values(r)[0];
      if (f && f.url) return f.url;
    }
    return null;
  }

  /* ============== document helpers (internal) ============== */
  function newDocFromImage(img, name) {
    D.newDocument(img.naturalWidth, img.naturalHeight, null, name);
    GF.ui.onDocumentOpened();
    U.ctx2d(D.active().canvas).drawImage(img, 0, 0);
    GF.ui.refreshLayers();
    GF.view.requestRender();
  }
  function addImageLayer(img, name) {
    GF.history.push(D.doc, 'import asset');
    const L = D.addLayer(name);
    const c = U.ctx2d(L.canvas);
    const s = Math.min(1, D.doc.width / img.naturalWidth, D.doc.height / img.naturalHeight);
    c.drawImage(img, 0, 0, img.naturalWidth * s, img.naturalHeight * s);
    GF.ui.refreshLayers();
    GF.view.requestRender();
  }
  function addMapLayer(img, name) {
    const L = D.addLayer(name);
    U.ctx2d(L.canvas).drawImage(img, 0, 0, D.doc.width, D.doc.height);
    L.visible = false; // map layers ride along hidden; the 3D workspace reads them by name
    return L;
  }

  /* ============== imports ============== */
  async function importTexture(id, name, res, mode) {
    const f = await apiFiles(id);
    const diff = pickUrl(f, ['Diffuse', 'diff', 'col', 'Color'], res);
    if (!diff) throw new Error('No diffuse map for this asset');
    const dimg = await loadImage(diff);
    if (mode === 'layer' && D.doc.open) addImageLayer(dimg, name);
    else newDocFromImage(dimg, name);

    if (mode === 'pbr') {
      const maps = [[['nor_gl', 'nor_dx'], 'normal'], [['Rough', 'rough'], 'roughness'], [['AO', 'ao'], 'ao']];
      for (const [keys, suffix] of maps) {
        const url = pickUrl(f, keys, res);
        if (!url) continue;
        try { addMapLayer(await loadImage(url), name + ' ' + suffix); } catch (e) { /* skip a missing map */ }
      }
      GF.ui.refreshLayers();
    }
  }

  /** HDRI url for a Poly Haven asset id (for GF.scene3d.setEnvironment). */
  async function hdriUrl(id, res) {
    const f = await apiFiles(id);
    const node = f.hdri && (f.hdri[res] || f.hdri['1k'] || f.hdri['2k']);
    const url = node && node.hdr && node.hdr.url;
    if (!url) throw new Error('No HDRI file for this asset');
    return url;
  }
  async function importBackground(id, name, res, mode) {
    if (mode === 'env') { await GF.scene3d.setEnvironment(await hdriUrl(id, res)); return; }
    const f = await apiFiles(id);
    const tone = (f.tonemapped && f.tonemapped.url) || pickUrl(f, ['hdri'], res);
    if (!tone) throw new Error('No preview image');
    const img = await loadImage(tone);
    if (mode === 'layer' && D.doc.open) addImageLayer(img, name);
    else newDocFromImage(img, name);
  }

  async function importModel(id, name, res) {
    const f = await apiFiles(id);
    const g = f.gltf && (f.gltf[res] || f.gltf['1k'] || f.gltf['2k']);
    const node = g && g.gltf;
    if (!node || !node.url) throw new Error('No glTF for this model');
    const includeMap = {};
    if (node.include) for (const k in node.include) includeMap[k] = node.include[k].url;
    const objId = await GF.scene3d.importModel(node.url, name, includeMap);
    if (objId == null) throw new Error('model failed to load');   // callers toast success otherwise
    return objId;
  }

  /* ============== procedural generators (offline) ============== */
  function mulberry32(a) {
    return function () { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  function noiseFn(seed) {
    const G = 256, rng = mulberry32(seed), grid = new Float32Array(G * G);
    for (let i = 0; i < G * G; i++) grid[i] = rng();
    const s = t => t * t * (3 - 2 * t);
    const v = (ix, iy) => grid[((iy & 255) * G) + (ix & 255)];
    return (x, y) => {
      const x0 = Math.floor(x), y0 = Math.floor(y), fx = s(x - x0), fy = s(y - y0);
      const a = v(x0, y0), b = v(x0 + 1, y0), c = v(x0, y0 + 1), d = v(x0 + 1, y0 + 1);
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    };
  }
  function fbm(n, x, y, oct) { let sum = 0, amp = 0.5, f = 1; for (let i = 0; i < oct; i++) { sum += amp * n(x * f, y * f); f *= 2; amp *= 0.5; } return sum; }
  const lerp = (a, b, t) => a + (b - a) * t;
  const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];

  const GENERATORS = {
    clouds: { label: 'Clouds', fn: pixelGen((x, y, w, h, n) => { const v = U.clamp(fbm(n, x / w * 6, y / h * 6, 5) * 1.4, 0, 1); return mix([30, 40, 70], [220, 230, 255], v); }) },
    wood:   { label: 'Wood',   fn: pixelGen((x, y, w, h, n) => { const g = fbm(n, x / w * 3, y / h * 3, 4); const r = Math.sin((x / w * 18) + g * 7) * 0.5 + 0.5; return mix([92, 56, 28], [173, 116, 66], r); }) },
    marble: { label: 'Marble', fn: pixelGen((x, y, w, h, n) => { const g = fbm(n, x / w * 4, y / h * 4, 6); const v = Math.sin((x / w + y / h) * 8 + g * 8) * 0.5 + 0.5; return mix([40, 40, 46], [232, 232, 238], Math.pow(v, 1.4)); }) },
    bricks: { label: 'Bricks', fn: pixelGen((x, y, w, h, n) => {
        const bw = w / 6, bh = h / 12, mortar = Math.max(1, w / 120);
        const row = Math.floor(y / bh); const ox = (row % 2) ? bw / 2 : 0;
        const lx = (x + ox) % bw, ly = y % bh;
        if (lx < mortar || ly < mortar) return [196, 192, 184];
        const j = fbm(n, (x + ox) / bw, row, 2) * 0.3;
        return mix([150, 60, 45], [120, 44, 34], j);
      }) },
    checker: { label: 'Checker', fn: pixelGen((x, y, w, h) => { const t = w / 8; return (((x / t | 0) + (y / t | 0)) & 1) ? [40, 44, 52] : [222, 226, 234]; }) },
    gradient: { label: 'Gradient', fn: pixelGen((x, y, w, h) => mix([232, 163, 61], [40, 30, 60], y / h)) },
    stone:  { label: 'Stone',  fn: (w, h, seed) => { // voronoi cells with dark mortar edges
        const rng = mulberry32(seed || 11), pts = [];
        for (let i = 0; i < 24; i++) pts.push([rng() * w, rng() * h, 150 + rng() * 60]);
        return pixelGen((x, y) => {
          let d1 = 1e9, d2 = 1e9, v = 128;
          for (const p of pts) { const dd = (x - p[0]) ** 2 + (y - p[1]) ** 2; if (dd < d1) { d2 = d1; d1 = dd; v = p[2]; } else if (dd < d2) d2 = dd; }
          const edge = Math.sqrt(d2) - Math.sqrt(d1) < w / 40 ? 0.45 : 1;
          return [v * edge, (v - 8) * edge, (v - 14) * edge];
        })(w, h, seed); } },
    metal:  { label: 'Metal',  fn: pixelGen((x, y, w, h, n) => { const band = fbm(n, x / w * 1.5, y / h * 60, 3); const v = 145 + band * 70 + Math.sin(y / h * 40) * 6; return [v, v + 4, v + 10]; }) },
    grass:  { label: 'Grass',  fn: pixelGen((x, y, w, h, n) => { const g = fbm(n, x / w * 14, y / h * 14, 5); return mix([34, 80, 24], [96, 160, 52], g * 1.3 - 0.1); }) },
    rust:   { label: 'Rust',   fn: pixelGen((x, y, w, h, n) => { const g = fbm(n, x / w * 5, y / h * 5, 5); return g > 0.52 ? mix([122, 58, 24], [180, 96, 38], (g - 0.52) * 4) : mix([96, 100, 108], [140, 144, 150], g * 1.6); }) }
  };

  /** Wrap a per-pixel color function into a canvas renderer. */
  function pixelGen(colorAt) {
    return (w, h, seed) => {
      const c = U.makeCanvas(w, h), ctx = U.ctx2d(c), img = ctx.createImageData(w, h), d = img.data;
      const n = noiseFn(seed || 1337);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const col = colorAt(x, y, w, h, n), i = (y * w + x) * 4;
        d[i] = col[0]; d[i + 1] = col[1]; d[i + 2] = col[2]; d[i + 3] = 255;
      }
      ctx.putImageData(img, 0, 0);
      return c;
    };
  }
  function generateProcedural(key, w, h, asLayer) {
    const g = GENERATORS[key]; if (!g) return;
    const seed = (Date.now() & 0xffff) || 1;
    const cnv = g.fn(w, h, seed);
    if (asLayer && D.doc.open) {
      GF.history.push(D.doc, 'procedural ' + key);
      const L = D.addLayer(g.label);
      U.ctx2d(L.canvas).drawImage(cnv, 0, 0, D.doc.width, D.doc.height);
      GF.ui.refreshLayers(); GF.view.requestRender();
    } else {
      D.newDocument(w, h, null, g.label);
      GF.ui.onDocumentOpened();
      U.ctx2d(D.active().canvas).drawImage(cnv, 0, 0);
      GF.ui.refreshLayers(); GF.view.requestRender();
    }
  }

  return { generateProcedural, GENERATORS,
           apiList, apiFiles, thumbUrl, hdriUrl,
           importTexture, importBackground, importModel };
})();
