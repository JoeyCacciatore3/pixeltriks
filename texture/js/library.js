/* Forge Studio — library.js
   Integrated asset library. Two sources:
     • Procedural generators (pure-JS, fully offline): clouds, wood, marble,
       bricks, checker, gradient — rendered to a layer on demand.
     • Poly Haven (CC0 / public domain, no key, no signup): textures (PBR
       sets), HDRIs (backgrounds + 3D environment lighting) and 3D models.
       Online-only; the UI degrades gracefully without a connection.

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
  let curTab = 'procedural';

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

  /* ============== document helpers ============== */
  function newDocFromImage(img, name) {
    D.newDocument(img.naturalWidth, img.naturalHeight, 'transparent', name);
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
    L.visible = false; // map layers ride along hidden; 3D preview / packer read them
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

  async function importBackground(id, name, res, mode) {
    const f = await apiFiles(id);
    if (mode === 'env') {
      const hdr = pickUrl(f, ['hdri'], res) || (f.hdri && f.hdri[res] && f.hdri[res].hdr && f.hdri[res].hdr.url);
      const url = (f.hdri && (f.hdri[res] || f.hdri['1k']) && (f.hdri[res] || f.hdri['1k']).hdr || {}).url;
      if (!url) throw new Error('No HDRI file');
      await GF.preview3d.setEnvironment(url);
      return;
    }
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
    await GF.preview3d.loadModel(node.url, includeMap);
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

  /* ---- built-in vector shapes (crisp at any size, brush-colored) ---- */
  const SHAPES = {
    star:    (c, s) => { starPath(c, s, 5, 0.42); },
    hexagon: (c, s) => { starPath(c, s, 6, 1); },
    arrow:   (c, s) => { const u = s / 100; c.moveTo(10*u,40*u); c.lineTo(55*u,40*u); c.lineTo(55*u,20*u); c.lineTo(92*u,50*u); c.lineTo(55*u,80*u); c.lineTo(55*u,60*u); c.lineTo(10*u,60*u); c.closePath(); },
    heart:   (c, s) => { const u = s / 100; c.moveTo(50*u,86*u); c.bezierCurveTo(16*u,58*u,6*u,38*u,18*u,22*u); c.bezierCurveTo(30*u,8*u,48*u,16*u,50*u,30*u); c.bezierCurveTo(52*u,16*u,70*u,8*u,82*u,22*u); c.bezierCurveTo(94*u,38*u,84*u,58*u,50*u,86*u); },
    gear:    (c, s) => { const m = s/2, R = s*0.46, r = s*0.34, T = 8; for (let i=0;i<T*2;i++){ const a0=(i/(T*2))*Math.PI*2, rr=(i&1)?r:R; const x=m+Math.cos(a0)*rr, y=m+Math.sin(a0)*rr; i?c.lineTo(x,y):c.moveTo(x,y); const a1=((i+1)/(T*2))*Math.PI*2; c.lineTo(m+Math.cos(a1)*rr,m+Math.sin(a1)*rr); } c.closePath(); c.moveTo(m+s*0.14,m); c.arc(m,m,s*0.14,0,Math.PI*2,true); },
    shield:  (c, s) => { const u = s / 100; c.moveTo(50*u,8*u); c.lineTo(88*u,22*u); c.bezierCurveTo(88*u,60*u,72*u,82*u,50*u,94*u); c.bezierCurveTo(28*u,82*u,12*u,60*u,12*u,22*u); c.closePath(); },
    bolt:    (c, s) => { const u = s / 100; c.moveTo(58*u,6*u); c.lineTo(22*u,56*u); c.lineTo(44*u,56*u); c.lineTo(38*u,94*u); c.lineTo(78*u,40*u); c.lineTo(54*u,40*u); c.closePath(); },
    crescent:(c, s) => { const m = s/2; c.arc(m,m,s*0.42,Math.PI*0.5,Math.PI*1.5,false); c.arc(m+s*0.16,m,s*0.34,Math.PI*1.5,Math.PI*0.5,true); c.closePath(); },
    bubble:  (c, s) => { const u = s / 100; c.moveTo(20*u,16*u); c.lineTo(80*u,16*u); c.quadraticCurveTo(92*u,16*u,92*u,28*u); c.lineTo(92*u,58*u); c.quadraticCurveTo(92*u,70*u,80*u,70*u); c.lineTo(44*u,70*u); c.lineTo(26*u,90*u); c.lineTo(30*u,70*u); c.lineTo(20*u,70*u); c.quadraticCurveTo(8*u,70*u,8*u,58*u); c.lineTo(8*u,28*u); c.quadraticCurveTo(8*u,16*u,20*u,16*u); },
    ring:    (c, s) => { const m = s/2; c.arc(m,m,s*0.44,0,Math.PI*2); c.moveTo(m+s*0.28,m); c.arc(m,m,s*0.28,0,Math.PI*2,true); }
  };
  function starPath(c, s, points, inner) {
    const m = s / 2, R = s * 0.46, r = R * inner;
    for (let i = 0; i < points * 2; i++) {
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const rr = (i & 1) ? r : R;
      const x = m + Math.cos(a) * rr, y = m + Math.sin(a) * rr;
      i ? c.lineTo(x, y) : c.moveTo(x, y);
    }
    c.closePath();
  }
  function shapeCanvas(key, size, color) {
    const c = U.makeCanvas(size, size), x = U.ctx2d(c);
    x.fillStyle = color;
    x.beginPath();
    SHAPES[key](x, size);
    x.fill('evenodd');
    return c;
  }
  function placeShape(key, mode) {
    const color = GF.view.view.brush.color;
    if (mode === 'layer' && D.doc.open) {
      GF.history.push(D.doc, 'shape ' + key);
      const s = Math.min(D.doc.width, D.doc.height);
      const L = D.addLayer(key);
      U.ctx2d(L.canvas).drawImage(shapeCanvas(key, s, color), (D.doc.width - s) / 2, (D.doc.height - s) / 2);
    } else {
      D.newDocument(512, 512, 'transparent', key);
      GF.ui.onDocumentOpened();
      U.ctx2d(D.active().canvas).drawImage(shapeCanvas(key, 512, color), 0, 0);
    }
    GF.ui.refreshLayers(); GF.view.requestRender();
  }
  async function importIcon(icon, mode) {
    const [prefix, name] = icon.split(':');
    const color = encodeURIComponent(GF.view.view.brush.color);
    const img = await loadImage(`https://api.iconify.design/${prefix}/${name}.svg?height=1024&color=${color}`);
    if (mode === 'layer' && D.doc.open) addImageLayer(img, name);
    else newDocFromImage(img, name);
  }
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
      D.newDocument(w, h, 'transparent', g.label);
      GF.ui.onDocumentOpened();
      U.ctx2d(D.active().canvas).drawImage(cnv, 0, 0);
      GF.ui.refreshLayers(); GF.view.requestRender();
    }
  }

  /* ============== modal UI ============== */
  const ACTIONS = {
    procedural: [['layer', 'As new layer'], ['doc', 'As new document']],
    shapes:     [['layer', 'As new layer'], ['doc', 'As new document']],
    textures:   [['pbr', 'Full PBR set (layers)'], ['layer', 'Diffuse as layer'], ['doc', 'Diffuse as document']],
    hdris:      [['layer', 'Background as layer'], ['doc', 'Background as document'], ['env', 'Use in 3D (environment)']],
    models:     [['load', 'Load in 3D preview']]
  };

  function setStatus(msg) { const el = U.$('#lib-status'); if (el) el.textContent = msg || ''; }

  function populateActions() {
    const sel = U.$('#lib-action'); sel.innerHTML = '';
    ACTIONS[curTab].forEach(([v, label]) => { const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o); });
    const hasRes = curTab === 'textures' || curTab === 'hdris' || curTab === 'models';
    U.$('#lib-res').parentElement.style.display = hasRes ? '' : 'none';
    U.$('#lib-search').style.display = curTab !== 'procedural' ? '' : 'none';
  }

  function card(id, name, imgSrc, thumbCanvas) {
    const b = document.createElement('button');
    b.className = 'lib-card'; b.dataset.id = id; b.title = name;
    if (thumbCanvas) b.appendChild(thumbCanvas);
    else { const im = document.createElement('img'); im.loading = 'lazy'; im.crossOrigin = 'anonymous'; im.src = imgSrc; im.alt = name; b.appendChild(im); }
    const lbl = document.createElement('span'); lbl.className = 'lib-name'; lbl.textContent = name; b.appendChild(lbl);
    return b;
  }

  async function loadGrid() {
    const grid = U.$('#lib-grid'); grid.innerHTML = '';
    populateActions();
    if (curTab === 'procedural') {
      setStatus('');
      Object.keys(GENERATORS).forEach(key => {
        const g = GENERATORS[key];
        const thumb = g.fn(96, 96, 7);
        const c = card(key, g.label, null, thumb);
        grid.appendChild(c);
      });
      return;
    }
    if (curTab === 'shapes') {
      const q = (U.$('#lib-search').value || '').toLowerCase().trim();
      const color = GF.view.view.brush.color;
      Object.keys(SHAPES).filter(k => !q || k.includes(q)).forEach(key => {
        grid.appendChild(card(key, key, null, shapeCanvas(key, 96, color)));
      });
      if (!q) { setStatus('Built-in shapes use the brush color. Type to search 200,000+ open-source icons (Iconify).'); return; }
      if (!navigator.onLine) { setStatus('Offline — built-in shapes only.'); return; }
      setStatus('Searching icons…');
      try {
        const r = await fetch('https://api.iconify.design/search?query=' + encodeURIComponent(q) + '&limit=48');
        const j = await r.json();
        const cc = encodeURIComponent(color);
        (j.icons || []).forEach(icon => {
          const [prefix, name] = icon.split(':');
          const el = card(icon, name, `https://api.iconify.design/${prefix}/${name}.svg?height=96&color=${cc}`);
          el.dataset.icon = icon;
          grid.appendChild(el);
        });
        setStatus((j.icons || []).length ? '' : 'No icon matches — built-in shapes above.');
      } catch (e) { setStatus('Icon search unreachable — built-in shapes still work.'); }
      return;
    }
    if (!navigator.onLine) { setStatus('You appear to be offline. The Procedural tab works without a connection.'); return; }
    setStatus('Loading from Poly Haven…');
    try {
      const assets = await apiList(curTab);
      const q = (U.$('#lib-search').value || '').toLowerCase().trim();
      const ids = Object.keys(assets).filter(id => {
        if (!q) return true;
        const a = assets[id];
        return id.includes(q) || (a.name || '').toLowerCase().includes(q) ||
               (a.tags || []).some(t => t.includes(q)) || (a.categories || []).some(t => t.includes(q));
      }).slice(0, 60);
      setStatus(ids.length ? '' : 'No matches — try another search.');
      ids.forEach(id => grid.appendChild(card(id, assets[id].name || id, thumbUrl(id))));
    } catch (e) {
      setStatus('Could not reach Poly Haven (' + e.message + '). The Procedural tab works offline.');
    }
  }

  async function onCardClick(id, iconName) {
    const mode = U.$('#lib-action').value, res = U.$('#lib-res').value;
    const name = (listCache[curTab] && listCache[curTab][id] && listCache[curTab][id].name) || id;
    if (curTab === 'procedural') {
      const w = D.doc.open ? D.doc.width : 512, h = D.doc.open ? D.doc.height : 512;
      generateProcedural(id, w, h, mode === 'layer');
      U.toast('Generated ' + name); U.$('#dlg-library').close(); return;
    }
    if (curTab === 'shapes') {
      try {
        if (iconName) { await importIcon(iconName, mode); U.toast('Imported ' + iconName); }
        else { placeShape(id, mode); U.toast('Shape added: ' + id); }
        U.$('#dlg-library').close();
      } catch (e) { U.toast('Import failed: ' + e.message); }
      return;
    }
    if (res === '8k') U.toast('8k files are large (tens of MB) — this can take a while…', 6000);
    U.toast('Importing ' + name + '…', 60000); // persists until import resolves
    try {
      if (curTab === 'textures') await importTexture(id, name, res, mode);
      else if (curTab === 'hdris') await importBackground(id, name, res, mode);
      else if (curTab === 'models') await importModel(id, name, res);
      U.toast('Imported ' + name);
      if (mode !== 'env' && curTab !== 'models') U.$('#dlg-library').close();
    } catch (e) {
      U.toast('Import failed: ' + e.message);
    }
  }

  let searchTimer = null;
  function init() {
    U.$$('.lib-tab').forEach(t => t.addEventListener('click', () => {
      U.$$('.lib-tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      curTab = t.dataset.lib;
      loadGrid();
    }));
    U.$('#lib-close').addEventListener('click', () => U.$('#dlg-library').close());
    U.$('#lib-search').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(loadGrid, 250); });
    U.$('#lib-grid').addEventListener('click', e => { const c = e.target.closest('.lib-card'); if (c) onCardClick(c.dataset.id, c.dataset.icon); });
  }

  function open() { U.$('#dlg-library').showModal(); loadGrid(); }

  return { init, open, generateProcedural, GENERATORS, SHAPES, placeShape,
           importIcon, importTexture, importBackground, importModel };
})();
