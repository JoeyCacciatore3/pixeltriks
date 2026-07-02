/* PixelTriks — make3d.js
   2D → 3D converter registry (GF.make3d). Each converter is a registered
   entry, so future generators — AI depth maps, image-to-3D APIs, text
   extrusion, CSG results — plug in without touching the UI: the 3D panel's
   "Make 3D" section and the command palette both render from this registry.

     GF.make3d.register(key, {label, desc, options:[{key,label,min,max,step,def}],
                              build(ctx) -> {geometry|node, textureCanvas?, keepOriginal?}})
     GF.make3d.list()          -> [{key, label, desc, options}]
     GF.make3d.run(key, opts)  -> Promise<sceneObjectId|null>

   build(ctx) receives { canvas, width, height, opts, THREE, LIB } where
   canvas is the resolved 2D source: the selection cut from the active layer
   when a selection exists, else the active layer, else the composite —
   cropped to its visible content and capped for performance.
   Results land in the scene via GF.scene3d.addGenerated (snapshot texture,
   scene-undo entry, auto-enters 3D mode). */
'use strict';
window.GF = window.GF || {};

GF.make3d = (function () {
  const U = GF.util, D = GF.doc;
  const REG = {};
  const WORLD = 1.6;            // max world-size of generated objects (matches primGeo scale)
  const MAX_SRC = 1024;         // cap the tracer/height-field input for speed

  function register(key, def) { REG[key] = def; }
  function list() {
    return Object.keys(REG).map(k => ({ key: k, label: REG[k].label, desc: REG[k].desc, options: REG[k].options || [] }));
  }

  /* ---------------- source resolution ---------------- */
  function sourceLabel() {
    if (!D.doc.open) return 'no image open';
    if (GF.select.has()) return 'your selection';
    const L = D.active();
    return (L && L.canvas) ? 'the active layer' : 'the whole image';
  }
  /** Selection ∩ active layer > active layer > composite; cropped to content, capped. */
  function sourceCanvas() {
    if (!D.doc.open) return null;
    const L = D.active();
    const base = (L && L.canvas) ? D.docAligned(L).canvas : D.composite();
    let c = U.makeCanvas(D.doc.width, D.doc.height);
    let x = U.ctx2d(c);
    x.drawImage(base, 0, 0);
    if (GF.select.has()) {
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(GF.select.maskCanvas(), 0, 0);
    }
    // crop to visible content
    const d = x.getImageData(0, 0, c.width, c.height).data;
    let minX = c.width, minY = c.height, maxX = -1, maxY = -1;
    for (let y = 0; y < c.height; y++) for (let xx = 0; xx < c.width; xx++) {
      if (d[(y * c.width + xx) * 4 + 3] > 8) {
        if (xx < minX) minX = xx; if (xx > maxX) maxX = xx;
        if (y < minY) minY = y; if (y > maxY) maxY = y;
      }
    }
    if (maxX < 0) return null;   // fully transparent
    const w = maxX - minX + 1, h = maxY - minY + 1;
    const scale = Math.min(1, MAX_SRC / Math.max(w, h));
    const out = U.makeCanvas(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
    U.ctx2d(out).drawImage(c, minX, minY, w, h, 0, 0, out.width, out.height);
    return out;
  }

  async function run(key, opts) {
    const def = REG[key];
    if (!def) throw new Error('unknown converter: ' + key + ' — see GF.make3d.list()');
    if (!D.doc.open) { U.toast('Open or create an image first'); return null; }
    const canvas = sourceCanvas();
    if (!canvas) { U.toast('Nothing visible to convert — the source is fully transparent'); return null; }
    const { THREE, LIB } = await GF.scene3d.engine();
    const merged = {};
    (def.options || []).forEach(o => { merged[o.key] = o.def; });
    Object.assign(merged, opts || {});
    const out = await def.build({ canvas, width: canvas.width, height: canvas.height, opts: merged, THREE, LIB });
    if (!out) { U.toast('Could not build 3D from this image'); return null; }
    const id = GF.scene3d.addGenerated(out.node || out.geometry, def.label, {
      textureCanvas: out.textureCanvas, keepOriginal: out.keepOriginal, doubleSided: out.doubleSided
    });
    U.toast(def.label + ' created — drag to orbit');
    return id;
  }

  /* ---------------- shared helpers ---------------- */
  /** Planar-project the whole geometry's UVs from its xy bounds (front-facing
      texture; sides stretch edge pixels — fine for extrusions). */
  function setPlanarUVs(geo, THREE) {
    geo.computeBoundingBox();
    const b = geo.boundingBox, pos = geo.attributes.position;
    const sx = Math.max(1e-6, b.max.x - b.min.x), sy = Math.max(1e-6, b.max.y - b.min.y);
    const uv = new Float32Array(pos.count * 2);
    for (let i = 0; i < pos.count; i++) {
      uv[i * 2] = (pos.getX(i) - b.min.x) / sx;
      uv[i * 2 + 1] = (pos.getY(i) - b.min.y) / sy;
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  }
  /** Luminance×alpha height field sampled at (nx+1)×(ny+1) grid points. */
  function heightGrid(canvas, nx, ny) {
    const small = U.makeCanvas(nx + 1, ny + 1);
    U.ctx2d(small).drawImage(canvas, 0, 0, nx + 1, ny + 1);
    const d = U.ctx2d(small).getImageData(0, 0, nx + 1, ny + 1).data;
    const f = new Float32Array((nx + 1) * (ny + 1));
    for (let i = 0, p = 0; i < d.length; i += 4, p++) {
      f[p] = (U.luminance(d[i], d[i + 1], d[i + 2]) / 255) * (d[i + 3] / 255);
    }
    return f;
  }
  /** ImageTracer paths (for the dark "shape" color) → THREE.Shapes with holes. */
  function traceShapes(canvas, THREE) {
    const w = canvas.width, h = canvas.height;
    const src = U.ctx2d(canvas).getImageData(0, 0, w, h);
    // binary map: opaque pixels black, everything else white
    const bin = new ImageData(w, h);
    for (let i = 0; i < src.data.length; i += 4) {
      const v = src.data[i + 3] > 16 ? 0 : 255;
      bin.data[i] = bin.data[i + 1] = bin.data[i + 2] = v;
      bin.data[i + 3] = 255;
    }
    const td = window.ImageTracer.imagedataToTracedata(bin, {
      numberofcolors: 2, colorquantcycles: 1, ltres: 1, qtres: 1,
      pathomit: Math.max(8, Math.round((w * h) / 40000)), rightangleenhance: false, blurradius: 0
    });
    // the layer whose palette color is dark = the shape
    let li = 0, best = 1e9;
    td.palette.forEach((p, i) => { const lum = p.r + p.g + p.b; if (lum < best) { best = lum; li = i; } });
    const paths = td.layers[li] || [];
    const scale = WORLD / Math.max(w, h), ox = w / 2, oy = h / 2;
    const toPath = (segs, P) => {
      segs.forEach((s, i) => {
        const x1 = (s.x1 - ox) * scale, y1 = (oy - s.y1) * scale;   // canvas y-down → world y-up
        if (i === 0) P.moveTo(x1, y1);
        if (s.type === 'Q') P.quadraticCurveTo((s.x2 - ox) * scale, (oy - s.y2) * scale, (s.x3 - ox) * scale, (oy - s.y3) * scale);
        else P.lineTo((s.x2 - ox) * scale, (oy - s.y2) * scale);
      });
    };
    const shapes = [];
    paths.forEach(p => {
      if (p.isholepath || !p.segments || !p.segments.length) return;
      const shape = new THREE.Shape();
      toPath(p.segments, shape);
      (p.holechildren || []).forEach(hi => {
        const hp = paths[hi];
        if (!hp || !hp.segments || !hp.segments.length) return;
        const hole = new THREE.Path();
        toPath(hp.segments, hole);
        shape.holes.push(hole);
      });
      shapes.push(shape);
    });
    return shapes;
  }

  /* =================================================================
     Built-in converters
     ================================================================= */
  register('cutout', {
    label: 'Extrude cutout',
    desc: 'Trace the visible shape and extrude it into a solid piece, textured with your image',
    options: [
      { key: 'depth', label: 'Depth', min: 0.05, max: 1, step: 0.05, def: 0.2 },
      { key: 'bevel', label: 'Bevel', min: 0, max: 0.08, step: 0.01, def: 0.02 },
    ],
    build({ canvas, opts, THREE }) {
      const shapes = traceShapes(canvas, THREE);
      if (!shapes.length) return null;
      const geo = new THREE.ExtrudeGeometry(shapes, {
        depth: opts.depth, bevelEnabled: opts.bevel > 0,
        bevelThickness: opts.bevel, bevelSize: opts.bevel, bevelSegments: 2,
      });
      geo.translate(0, 0, -opts.depth / 2);
      setPlanarUVs(geo, THREE);
      return { geometry: geo, textureCanvas: canvas };
    }
  });

  register('relief', {
    label: 'Relief map',
    desc: 'Brightness becomes height — embossed art, terrain, logos',
    options: [
      { key: 'depth', label: 'Height', min: 0.05, max: 1, step: 0.05, def: 0.25 },
      { key: 'detail', label: 'Detail', min: 32, max: 200, step: 8, def: 128 },
    ],
    build({ canvas, width, height, opts, THREE }) {
      const aspect = width / height;
      const w = aspect >= 1 ? WORLD : WORLD * aspect;
      const h = aspect >= 1 ? WORLD / aspect : WORLD;
      const nx = Math.round(aspect >= 1 ? opts.detail : opts.detail * aspect);
      const ny = Math.round(aspect >= 1 ? opts.detail / aspect : opts.detail);
      const geo = new THREE.PlaneGeometry(w, h, nx, ny);
      const f = heightGrid(canvas, nx, ny), pos = geo.attributes.position;
      for (let i = 0; i < pos.count; i++) pos.setZ(i, f[i] * opts.depth);
      geo.computeVertexNormals();
      return { geometry: geo, textureCanvas: canvas, doubleSided: true };
    }
  });

  register('lathe', {
    label: 'Lathe (spin profile)',
    desc: 'Spins your shape’s silhouette around the vertical axis — vases, bottles, pillars',
    options: [
      { key: 'segments', label: 'Roundness', min: 8, max: 64, step: 4, def: 32 },
    ],
    build({ canvas, width, height, opts, THREE }) {
      const d = U.ctx2d(canvas).getImageData(0, 0, width, height).data;
      const rows = Math.min(48, height);
      const pts = [];
      const scale = WORLD / Math.max(width, height);
      for (let r = 0; r <= rows; r++) {
        const y = Math.min(height - 1, Math.round((r / rows) * (height - 1)));
        let minX = width, maxX = -1;
        for (let x = 0; x < width; x++) {
          if (d[(y * width + x) * 4 + 3] > 16) { if (x < minX) minX = x; if (x > maxX) maxX = x; }
        }
        const radius = maxX < 0 ? 0 : ((maxX - minX + 1) / 2) * scale;
        pts.push(new THREE.Vector2(Math.max(0.001, radius), (height - 1 - y) * scale - (height * scale) / 2));
      }
      if (!pts.some(p => p.x > 0.01)) return null;
      const geo = new THREE.LatheGeometry(pts, opts.segments);
      return { geometry: geo, textureCanvas: canvas };
    }
  });

  register('layers', {
    label: 'Layer stack',
    desc: 'Every visible layer becomes a floating plane — an instant diorama with depth',
    options: [
      { key: 'gap', label: 'Spacing', min: 0.05, max: 0.6, step: 0.05, def: 0.15 },
    ],
    build({ opts, THREE }) {
      const layers = (D.doc.layers || []).filter(l => l.visible && l.canvas);
      if (!layers.length) return null;
      const aspect = D.doc.width / D.doc.height;
      const w = aspect >= 1 ? WORLD : WORLD * aspect;
      const h = aspect >= 1 ? WORLD / aspect : WORLD;
      const group = new THREE.Group();
      layers.forEach((L, i) => {
        const snap = U.makeCanvas(D.doc.width, D.doc.height);
        U.ctx2d(snap).drawImage(D.docAligned(L).canvas, 0, 0);
        const tex = new THREE.CanvasTexture(snap);
        tex.colorSpace = THREE.SRGBColorSpace;
        const m = new THREE.MeshStandardMaterial({
          map: tex, transparent: true, side: THREE.DoubleSide, roughness: 0.75, metalness: 0
        });
        const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), m);
        mesh.position.z = (i - (layers.length - 1) / 2) * opts.gap;
        mesh.name = L.name;
        group.add(mesh);
      });
      return { node: group, keepOriginal: true };
    }
  });

  /* ---- agent/palette surface ---- */
  if (GF.api && GF.api.register) {
    GF.api.register('make3d.list', '', 'List the 2D→3D converters', () => list());
    GF.api.register('make3d.run', 'key(cutout|relief|lathe|layers), …options', 'Convert the current image/selection into a 3D scene object', a => run(a.key, a));
    [['cutout', 'Make 3D: Extrude cutout'], ['relief', 'Make 3D: Relief map'],
     ['lathe', 'Make 3D: Lathe from shape'], ['layers', 'Make 3D: Layer stack diorama']].forEach(([k, label]) =>
      GF.api.register('make3d.' + k, '…options', 'Run the ' + k + ' 2D→3D converter', a => run(k, a || {}),
        { group: '3D', label, needsDoc: true }));
  }

  return { register, list, run, sourceLabel };
})();
