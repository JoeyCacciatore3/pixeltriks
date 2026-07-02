/* PixelTriks — scene3d.js
   The 3D workspace engine (GF.scene3d). Grown out of the old texture-app
   preview3d.js: instead of a read-only preview it owns a real scene — import
   GLB/GLTF models, add primitives, move/rotate/scale each object, texture
   them with the document, any layer, or an imported image, light with an
   HDRI, then export a .glb or flatten a doc-resolution render onto the 2D
   canvas as a normal layer.

   Three.js (0.160, vendored in vendor/three/) and its addons arrive via
   ui/three-bundle.js — a static ES module (resolved through the import map
   in index.html) that stashes them on window.__THREE_BUNDLE. Static imports
   are used because dynamic import() hangs on file:// in Chrome. A single
   THREE instance, so addon objects stay compatible. 2D editing never
   depends on the bundle loading.

   Color space is deliberate: base-color maps are tagged sRGB while
   normal/roughness maps stay linear, matching MeshStandardMaterial.

   3D edits keep their own small command-stack undo (GF.scene3d.hist) —
   scene graphs don't fit the bitmap snapshots of GF.history; the api.js
   undo/redo commands route here while the workspace is active. */
'use strict';
window.GF = window.GF || {};

GF.scene3d = (function () {
  const U = GF.util, D = GF.doc;

  let THREE = null, LIB = null, renderer = null, scene, camera, controls, raf = null;
  let sceneRoot = null;          // all user objects live under this group
  let helpers = null;            // selection highlight etc. — never exported
  let boxHelper = null;
  let envMap = null;
  let statusCb = () => {};       // scene3d-ui injects a status-line callback
  let changeCbs = [];            // fired on any scene mutation (UI refresh)

  const objects = [];            // [{id, name, kind, prim, node, visible, mat, material, _origMats}]
  let selectedId = null, nextId = 1;
  let interact = 'orbit';        // orbit | move | rotate | scale
  const bg = { mode: 'default', color: '#0c0e11' };   // default = dark; snapshot renders transparent unless 'color'

  const texCache = new Map();    // source-string -> { tex, srcCanvas }
  const images = new Map();      // 'image:<id>' -> canvas
  let compCanvas = null;         // persistent canvas backing the 'composite' texture
  let texDirty = false, lastTexAt = 0;
  let nextImageId = 1;

  function setStatus(msg) { try { statusCb(msg || ''); } catch (e) {} }
  function onChange(fn) { changeCbs.push(fn); }
  function emit() { changeCbs.forEach(fn => { try { fn(); } catch (e) {} }); }
  function isActive() { return document.body.dataset.mode === '3d'; }

  /* ---- three arrives via ui/three-bundle.js (static module) ---- */
  function libBundle() {
    if (LIB) return Promise.resolve(LIB);
    if (window.__THREE_BUNDLE) { LIB = window.__THREE_BUNDLE; THREE = LIB.THREE; return Promise.resolve(LIB); }
    setStatus('Loading 3D engine…');
    return new Promise((resolve, reject) => {
      const t0 = Date.now();
      const iv = setInterval(() => {
        if (window.__THREE_BUNDLE) {
          clearInterval(iv); setStatus('');
          LIB = window.__THREE_BUNDLE; THREE = LIB.THREE;
          resolve(LIB);
        } else if (Date.now() - t0 > 15000) {
          clearInterval(iv); reject(new Error('three bundle unavailable'));
        }
      }, 50);
    });
  }
  function offline(e) {
    setStatus('Could not load the 3D engine (vendor/three missing or blocked). 2D editing is unaffected.');
    U.toast('3D engine could not load — 2D editing still works');
    throw e;
  }

  /* =================================================================
     Undo — command stack (closures), separate from bitmap GF.history
     ================================================================= */
  const hist = (function () {
    const un = [], re = [];
    return {
      push(label, undo, redo) { un.push({ label, undo, redo }); if (un.length > 50) un.shift(); re.length = 0; emit(); },
      undo() { const e = un.pop(); if (!e) return; e.undo(); re.push(e); emit(); },
      redo() { const e = re.pop(); if (!e) return; e.redo(); un.push(e); emit(); },
      canUndo() { return un.length > 0; },
      canRedo() { return re.length > 0; },
      labels() { return un.map(e => e.label); },
      clear() { un.length = 0; re.length = 0; }
    };
  })();

  /* =================================================================
     Renderer / scene lifecycle
     ================================================================= */
  let rendererPromise = null;   // memoized so concurrent callers share one build
  function ensureRenderer() {
    if (renderer) return Promise.resolve(true);
    if (!rendererPromise) rendererPromise = buildRenderer().catch(e => { rendererPromise = null; throw e; });
    return rendererPromise;
  }
  async function buildRenderer() {
    const T = (await libBundle().catch(offline)).THREE;
    const host = U.$('#scene3d-host');
    renderer = new T.WebGLRenderer({ antialias: true, alpha: true });
    renderer.outputColorSpace = T.SRGBColorSpace;
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    host.appendChild(renderer.domElement);

    scene = new T.Scene();
    scene.background = new T.Color(bg.color);
    camera = new T.PerspectiveCamera(40, 1, 0.05, 200);
    camera.position.set(2.2, 1.6, 3.2);
    scene.add(new T.AmbientLight(0xffffff, 0.45));
    const key = new T.DirectionalLight(0xffffff, 1.6); key.position.set(2.5, 2.5, 3); scene.add(key);
    const rim = new T.DirectionalLight(0xe8a33d, 0.5); rim.position.set(-3, -1, -2); scene.add(rim);

    sceneRoot = new T.Group(); scene.add(sceneRoot);
    helpers = new T.Group(); scene.add(helpers);

    controls = new LIB.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;

    new ResizeObserver(resize).observe(U.$('#viewport'));
    resize();
    wirePointer(renderer.domElement, host);
    GF.history.onChange(() => { texDirty = true; });
    U.$('#viewport').addEventListener('pointerup', () => { texDirty = true; }, { passive: true });
    return true;
  }

  function resize() {
    if (!renderer) return;
    const r = U.$('#viewport').getBoundingClientRect();
    const w = Math.max(1, r.width), h = Math.max(1, r.height);
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    camera.aspect = w / h; camera.updateProjectionMatrix();
  }

  function animate() {
    raf = requestAnimationFrame(animate);
    if (controls) controls.update();
    if (texDirty && performance.now() - lastTexAt > 250) { lastTexAt = performance.now(); texDirty = false; refreshTextures(); }
    if (boxHelper) { const o = byId(selectedId); if (o) boxHelper.box.setFromObject(o.node); }
    renderer.render(scene, camera);
  }

  let modeEpoch = 0;   // guards the enter/exit race while the engine is still booting
  async function enter() {
    const epoch = ++modeEpoch;
    try { await ensureRenderer(); } catch (e) { return false; }
    if (epoch !== modeEpoch) return false;   // superseded by an exit() (user switched tools mid-boot)
    document.body.dataset.mode = '3d';
    if (!raf) animate();
    refreshAll();
    return true;
  }
  function exit() {
    modeEpoch++;
    document.body.dataset.mode = 'image';
    if (raf) { cancelAnimationFrame(raf); raf = null; }
  }

  /* =================================================================
     Textures — resolve a material source onto a (cached) CanvasTexture
     source: 'composite' | 'layer:<id>' | 'image:<id>' | 'auto:normal' |
             'auto:roughness' | null
     ================================================================= */
  const MAP_NAMES = ['normal', 'roughness', 'height', 'ao'];
  // token match, not substring — "Chaos"/"Normalize" must not count as ao/normal maps
  const mapTokenRe = name => new RegExp('(^|[^a-z])' + name + '([^a-z]|$)');
  function isMapLayerName(layerName) {
    const n = layerName.toLowerCase();
    return MAP_NAMES.some(m => mapTokenRe(m).test(n));
  }
  function findLayer(mapName) {
    const re = mapTokenRe(mapName.toLowerCase());
    return (D.doc.layers || []).find(L => re.test(L.name.toLowerCase())) || null;
  }
  function compositeCanvas() {
    if (!D.doc.open) return null;
    // hide map-convention layers so they don't pollute the base color
    const hidden = [];
    for (const L of D.doc.layers) {
      if (L.visible && isMapLayerName(L.name)) { L.visible = false; hidden.push(L); }
    }
    const flat = D.composite();
    hidden.forEach(L => { L.visible = true; });
    if (!compCanvas || compCanvas.width !== flat.width || compCanvas.height !== flat.height)
      compCanvas = U.makeCanvas(flat.width, flat.height);
    const c = U.ctx2d(compCanvas);
    c.clearRect(0, 0, compCanvas.width, compCanvas.height);
    c.drawImage(flat, 0, 0);
    return compCanvas;
  }
  function resolveSourceCanvas(source) {
    if (!source) return null;
    if (source === 'composite') return compositeCanvas();
    if (source === 'auto:normal') { const L = findLayer('normal'); return L && L.canvas; }
    if (source === 'auto:roughness') { const L = findLayer('roughness'); return L && L.canvas; }
    if (source.startsWith('layer:')) {
      const id = source.slice(6);
      const L = (D.doc.layers || []).find(l => String(l.id) === id);
      return (L && L.canvas) || null;
    }
    if (source.startsWith('image:')) return images.get(source) || null;
    return null;
  }
  function texFor(source, srgb, flipY) {
    flipY = flipY !== false;
    // cache key covers everything that forces a distinct GPU texture: the same
    // source can serve base (sRGB) and data maps (linear), and three-primitive
    // UVs (flipY) vs glTF UVs (no flip) can't share one texture either
    const key = source + (srgb ? '|srgb' : '|linear') + (flipY ? '' : '|noflip');
    const cnv = resolveSourceCanvas(source);
    if (!cnv) {
      const stale = texCache.get(key);
      if (stale) { stale.tex.dispose(); texCache.delete(key); }   // e.g. its layer was deleted
      return null;
    }
    let e = texCache.get(key);
    if (!e || e.srcCanvas !== cnv) {
      if (e) e.tex.dispose();
      const tex = new THREE.CanvasTexture(cnv);
      if (srgb) tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
      tex.flipY = flipY;
      e = { tex, srcCanvas: cnv, source, srgb, flipY };
      texCache.set(key, e);
    } else {
      e.tex.needsUpdate = true;
    }
    return e.tex;
  }
  /** Register an imported image file as a reusable texture source. */
  function addImageSource(canvas, name) {
    const key = 'image:' + (nextImageId++);
    canvas._srcName = name || 'image';
    images.set(key, canvas);
    emit();
    return key;
  }
  function listImageSources() { return [...images.entries()].map(([k, c]) => ({ key: k, name: c._srcName })); }

  function refreshTextures(force) {
    if (!renderer || (!force && !isActive())) return;
    // refresh backing canvases and re-upload every cached texture
    for (const e of [...texCache.values()]) texFor(e.source, e.srgb, e.flipY);
    objects.forEach(applyMaterial);
  }
  function refreshAll() {
    texDirty = false;
    for (const [, e] of texCache) e.tex.dispose();
    texCache.clear(); compCanvas = null;
    objects.forEach(applyMaterial);
    emit();
  }

  /* =================================================================
     Materials
     ================================================================= */
  function defaultMat(kind, prim) {
    const flat = (prim === 'plane' || prim === 'panel' || prim === 'curved');
    return {
      mapSource: (kind === 'model') ? null : (D.doc.open ? 'composite' : null),
      normalSource: 'auto:normal', roughSource: 'auto:roughness',
      color: '#cccccc', roughness: 0.65, metalness: 0.05,
      doubleSided: flat, keepOriginal: (kind === 'model')
    };
  }
  function applyMaterial(o) {
    if (!o || !THREE) return;
    if (o.kind === 'model' && o.mat.keepOriginal) { restoreOriginalMats(o); return; }
    const m = o.material;
    const flipY = o.kind !== 'model';   // glTF UVs are top-left origin — no flip
    m.map = o.mat.mapSource ? texFor(o.mat.mapSource, true, flipY) : null;
    m.normalMap = o.mat.normalSource ? texFor(o.mat.normalSource, false, flipY) : null;
    m.roughnessMap = o.mat.roughSource ? texFor(o.mat.roughSource, false, flipY) : null;
    m.color.set(m.map ? '#ffffff' : o.mat.color);
    m.roughness = o.mat.roughnessMap ? 1.0 : o.mat.roughness;
    m.metalness = o.mat.metalness;
    m.side = o.mat.doubleSided ? THREE.DoubleSide : THREE.FrontSide;
    m.needsUpdate = true;
    if (o.kind === 'model') o.node.traverse(ch => {
      if (ch.isMesh) { if (!o._origMats.has(ch)) o._origMats.set(ch, ch.material); ch.material = m; }
    });
  }
  function restoreOriginalMats(o) {
    if (!o._origMats) return;
    o.node.traverse(ch => { if (ch.isMesh && o._origMats.has(ch)) ch.material = o._origMats.get(ch); });
  }
  /** record=false gives a live, history-free preview (e.g. dragging the color
      picker); the caller then commits once with record=true against `base`
      (the mat snapshot from before the preview run) so undo restores it. */
  function setMaterial(id, patch, record, base) {
    const o = byId(id); if (!o) return;
    const before = base || Object.assign({}, o.mat);
    Object.assign(o.mat, patch);
    applyMaterial(o);
    if (record === false) return;
    const after = Object.assign({}, o.mat);
    hist.push('material', () => { o.mat = Object.assign({}, before); applyMaterial(o); },
                          () => { o.mat = Object.assign({}, after); applyMaterial(o); });
  }

  /* =================================================================
     Objects — primitives + imported models
     ================================================================= */
  function byId(id) { return objects.find(o => o.id === id) || null; }
  function count() { return objects.length; }
  function listObjects() {
    return objects.map(o => ({ id: o.id, name: o.name, kind: o.kind, visible: o.visible, selected: o.id === selectedId }));
  }
  function attach(o) { sceneRoot.add(o.node); if (!objects.includes(o)) objects.push(o); o.node.visible = o.visible; emit(); }
  function detach(o) { sceneRoot.remove(o.node); const i = objects.indexOf(o); if (i >= 0) objects.splice(i, 1); if (selectedId === o.id) select(null); emit(); }

  function primGeo(kind) {
    const T = THREE;
    switch (kind) {
      case 'box':      return new T.BoxGeometry(1, 1, 1);
      case 'cylinder': return new T.CylinderGeometry(0.5, 0.5, 1, 32);
      case 'cone':     return new T.ConeGeometry(0.5, 1, 32);
      case 'torus':    return new T.TorusGeometry(0.45, 0.18, 16, 48);
      case 'torusknot':return new T.TorusKnotGeometry(0.45, 0.16, 128, 24);
      case 'plane':    return new T.PlaneGeometry(1, 1);
      case 'capsule':  return new T.CapsuleGeometry(0.4, 0.6, 8, 24);
      // flat texturable shapes (signboards, tiles, backdrops)
      case 'panel':    return new T.BoxGeometry(1.4, 0.9, 0.06);
      case 'tile':     return new T.BoxGeometry(1, 0.1, 1);
      case 'hex':      return new T.CylinderGeometry(0.6, 0.6, 0.12, 6);
      case 'curved':   return new T.CylinderGeometry(1, 1, 1.1, 48, 1, true, -Math.PI / 3, (2 * Math.PI) / 3);
      default:         return new T.SphereGeometry(0.55, 48, 32);
    }
  }
  async function addPrimitive(kind) {
    try { await ensureRenderer(); } catch (e) { return null; }
    const prim = kind || 'sphere', id = nextId++;
    const o = {
      id, name: prim.charAt(0).toUpperCase() + prim.slice(1) + ' ' + id, kind: 'primitive', prim,
      node: null, visible: true, mat: defaultMat('primitive', prim), _origMats: new Map()
    };
    o.material = new THREE.MeshStandardMaterial({ roughness: o.mat.roughness, metalness: o.mat.metalness });
    o.node = new THREE.Mesh(primGeo(o.prim), o.material);
    // stagger so stacked adds don't z-fight
    o.node.position.x = (objects.length % 3) * 0.4 - 0.4;
    attach(o); applyMaterial(o); select(o.id);
    hist.push('add ' + o.prim, () => detach(o), () => { attach(o); applyMaterial(o); });
    setStatus(objects.length + (objects.length === 1 ? ' object' : ' objects'));
    return o.id;
  }

  async function importModel(url, name, includeMap) {
    try { await ensureRenderer(); } catch (e) { return null; }
    const T = THREE, GLTFLoader = LIB.GLTFLoader;
    setStatus('Loading model…');
    return new Promise(resolve => {
      const mgr = new T.LoadingManager();
      if (includeMap) mgr.setURLModifier(u => {
        for (const key in includeMap) { if (u === key || u.endsWith(key) || u.endsWith(key.split('/').pop())) return includeMap[key]; }
        return u;
      });
      new GLTFLoader(mgr).load(url, g => {
        const node = g.scene;
        const box = new T.Box3().setFromObject(node);
        const size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
        const scl = 2 / (Math.max(size.x, size.y, size.z) || 1);
        node.scale.setScalar(scl);
        node.position.set(-center.x * scl, -center.y * scl, -center.z * scl);
        const o = {
          id: nextId++, name: name || 'model', kind: 'model', prim: null,
          node, visible: true, mat: defaultMat('model'), _origMats: new Map()
        };
        o.material = new T.MeshStandardMaterial({ roughness: o.mat.roughness, metalness: o.mat.metalness });
        attach(o); select(o.id);
        hist.push('import ' + o.name, () => detach(o), () => attach(o));
        setStatus('Model loaded — ' + o.name);
        U.toast('Model loaded: ' + o.name);
        if (!isActive() && GF.ui && GF.ui.setTool) GF.ui.setTool('scene3d');   // dropping a model is an unambiguous intent
        resolve(o.id);
      }, undefined, () => { setStatus('Could not load that model.'); U.toast('Could not load that model'); resolve(null); });
    });
  }

  /** Route dropped/picked 3D-ish files: .glb/.gltf → import, .hdr → environment.
      A multi-file .gltf drop supplies its .bin/textures via an include map. */
  async function handleFiles(files) {
    files = Array.from(files);
    const urls = new Map(files.map(f => [f.name, URL.createObjectURL(f)]));
    const hasGltf = files.some(f => /\.gltf$/i.test(f.name));
    try {
      for (const f of files) {
        if (/\.hdr$/i.test(f.name)) await setEnvironment(urls.get(f.name));
        else if (/\.(glb|gltf)$/i.test(f.name)) {
          const includeMap = {};
          if (hasGltf) files.forEach(s => { if (s !== f) includeMap[s.name] = urls.get(s.name); });
          await importModel(urls.get(f.name), f.name.replace(/\.(glb|gltf)$/i, ''), includeMap);
        } else if (f.type && f.type.startsWith('image/') && !hasGltf) GF.exporter.importImage(f);
      }
    } finally {
      for (const u of urls.values()) URL.revokeObjectURL(u);
    }
  }

  function removeObject(id) {
    const o = byId(id); if (!o) return;
    detach(o);
    hist.push('remove ' + o.name, () => { attach(o); applyMaterial(o); }, () => detach(o));
  }
  function setVisible(id, v) {
    const o = byId(id); if (!o || o.visible === !!v) return;
    const apply = val => { o.visible = val; o.node.visible = val; emit(); };
    apply(!!v);
    hist.push((v ? 'show ' : 'hide ') + o.name, () => apply(!v), () => apply(!!v));
  }

  /* ---- transforms: full 9-DOF, one write path for inputs + drags ---- */
  const R2D = 180 / Math.PI, D2R = Math.PI / 180;
  function getObject(id) {
    const o = byId(id); if (!o) return null;
    const n = o.node;
    return {
      id: o.id, name: o.name, kind: o.kind, prim: o.prim, visible: o.visible,
      px: n.position.x, py: n.position.y, pz: n.position.z,
      // 0.1° precision: fine enough to survive an edit-one-field round-trip
      rx: Math.round(n.rotation.x * R2D * 10) / 10, ry: Math.round(n.rotation.y * R2D * 10) / 10, rz: Math.round(n.rotation.z * R2D * 10) / 10,
      sx: n.scale.x, sy: n.scale.y, sz: n.scale.z,
      mat: Object.assign({}, o.mat)
    };
  }
  function writeTransform(o, t) {
    const n = o.node;
    if (t.px !== undefined) n.position.x = t.px;
    if (t.py !== undefined) n.position.y = t.py;
    if (t.pz !== undefined) n.position.z = t.pz;
    if (t.rx !== undefined) n.rotation.x = t.rx * D2R;
    if (t.ry !== undefined) n.rotation.y = t.ry * D2R;
    if (t.rz !== undefined) n.rotation.z = t.rz * D2R;
    if (t.sx !== undefined) n.scale.x = t.sx;
    if (t.sy !== undefined) n.scale.y = t.sy;
    if (t.sz !== undefined) n.scale.z = t.sz;
    if (t.scale !== undefined) n.scale.setScalar(t.scale);
  }
  function snapTransform(o) {
    const n = o.node;
    return { px: n.position.x, py: n.position.y, pz: n.position.z,
             rx: n.rotation.x * R2D, ry: n.rotation.y * R2D, rz: n.rotation.z * R2D,
             sx: n.scale.x, sy: n.scale.y, sz: n.scale.z };
  }
  /** Committed transform (numeric inputs, api) — one history entry per call. */
  function setObject(id, t) {
    const o = byId(id); if (!o) return;
    const before = snapTransform(o);
    writeTransform(o, t);
    const after = snapTransform(o);
    hist.push('transform', () => writeTransform(o, before), () => writeTransform(o, after));
    emit();
  }

  /* =================================================================
     Selection + pointer interaction (move / rotate / scale / pick)
     ================================================================= */
  function select(id) {
    selectedId = id;
    if (!THREE) return;
    if (boxHelper) { helpers.remove(boxHelper); boxHelper.dispose(); boxHelper = null; }
    const o = byId(id);
    if (o) {
      boxHelper = new THREE.Box3Helper(new THREE.Box3().setFromObject(o.node), new THREE.Color(0xe8a33d));
      helpers.add(boxHelper);
    }
    emit();
  }
  function selected() { return byId(selectedId); }
  function setInteract(mode) { interact = mode; if (controls) controls.enabled = (mode === 'orbit'); }
  function getInteract() { return interact; }

  function pick(clientX, clientY) {
    if (!THREE || !renderer) return null;
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(sceneRoot.children, true);
    if (!hits.length) return null;
    let n = hits[0].object;
    while (n && n.parent !== sceneRoot) n = n.parent;
    const o = objects.find(x => x.node === n);
    return o ? o.id : null;
  }

  function wirePointer(el, host) {
    // shield the 2D engine: nothing here reaches #viewport's handlers
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(t =>
      host.addEventListener(t, e => e.stopPropagation()));
    host.addEventListener('wheel', e => e.stopPropagation(), { passive: false });

    let drag = null;   // {id, startX, startY, start, plane, grab, moved}
    el.addEventListener('pointerdown', e => {
      const o = selected();
      drag = { x0: e.clientX, y0: e.clientY, moved: false, id: null };
      if (interact !== 'orbit' && o) {
        drag.id = o.id;
        drag.start = snapTransform(o);
        if (interact === 'move') {
          const T = THREE;
          const dir = camera.getWorldDirection(new T.Vector3());
          drag.plane = new T.Plane().setFromNormalAndCoplanarPoint(dir, o.node.position.clone());
          const pt = planePoint(e, drag.plane);
          drag.grab = pt ? o.node.position.clone().sub(pt) : new T.Vector3();
        }
        el.setPointerCapture(e.pointerId);
      }
    });
    el.addEventListener('pointermove', e => {
      if (!drag) return;
      const dx = e.clientX - drag.x0, dy = e.clientY - drag.y0;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      const o = drag.id != null && byId(drag.id);
      if (!o || interact === 'orbit') return;
      if (interact === 'move') {
        const pt = planePoint(e, drag.plane);
        if (pt) o.node.position.copy(pt.add(drag.grab));
      } else if (interact === 'rotate') {
        o.node.rotation.y = drag.start.ry * D2R + dx * 0.01;
        o.node.rotation.x = drag.start.rx * D2R + dy * 0.01;
      } else if (interact === 'scale') {
        const f = Math.exp(-dy * 0.005);
        o.node.scale.set(drag.start.sx * f, drag.start.sy * f, drag.start.sz * f);
      }
    });
    const up = e => {
      if (!drag) return;
      const d = drag; drag = null;
      const o = d.id != null && byId(d.id);
      if (o && d.moved && interact !== 'orbit') {
        const before = d.start, after = snapTransform(o);
        hist.push(interact, () => writeTransform(o, before), () => writeTransform(o, after));
        emit();
      } else if (!d.moved) {
        select(pick(e.clientX, e.clientY));     // plain click (any mode) = pick / deselect
      }
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', () => {
      // commit the transform so far — a lost pointer must still be undoable
      if (!drag) return;
      const d = drag; drag = null;
      const o = d.id != null && byId(d.id);
      if (o && d.moved && interact !== 'orbit') {
        const before = d.start, after = snapTransform(o);
        hist.push(interact, () => writeTransform(o, before), () => writeTransform(o, after));
        emit();
      }
    });
  }
  function planePoint(e, plane) {
    const T = THREE, r = renderer.domElement.getBoundingClientRect();
    const ndc = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new T.Raycaster(); ray.setFromCamera(ndc, camera);
    const pt = new T.Vector3();
    return ray.ray.intersectPlane(plane, pt) ? pt : null;
  }
  /** Frame the selected object (or the whole scene) in view. */
  function frame() {
    if (!THREE || !renderer) return;
    const target = selected() ? selected().node : sceneRoot;
    const box = new THREE.Box3().setFromObject(target);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3()).length() || 2;
    const center = box.getCenter(new THREE.Vector3());
    controls.target.copy(center);
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(center.clone().add(dir.multiplyScalar(size * 1.4)));
  }

  /* =================================================================
     Environment / background
     ================================================================= */
  async function setEnvironment(url) {
    try {
      await ensureRenderer();
      const T = THREE;
      setStatus('Loading HDRI…');
      return await new Promise(resolve => {
        new LIB.RGBELoader().load(url, tex => {
          tex.mapping = T.EquirectangularReflectionMapping;
          const pmrem = new T.PMREMGenerator(renderer);
          pmrem.compileEquirectangularShader();
          const env = pmrem.fromEquirectangular(tex).texture;
          if (envMap) envMap.dispose();
          envMap = env;
          scene.environment = env;
          applyBackground();
          tex.dispose(); pmrem.dispose();
          setStatus('HDRI environment active');
          U.toast('HDRI environment applied');
          resolve(true);
        }, undefined, () => { setStatus('Could not load that HDRI.'); U.toast('Could not load that HDRI'); resolve(false); });
      });
    } catch (e) { return false; }
  }
  function clearEnvironment() {
    if (!scene) return;
    if (envMap) { envMap.dispose(); envMap = null; }
    scene.environment = null;
    applyBackground();
    setStatus('Environment cleared');
  }
  function setBackground(mode, color) {
    bg.mode = mode || 'default';
    if (color) bg.color = color;
    applyBackground();
  }
  function applyBackground() {
    if (!scene) return;
    if (bg.mode === 'transparent') scene.background = null;
    else if (bg.mode === 'color') scene.background = new THREE.Color(bg.color);
    else scene.background = envMap || new THREE.Color(0x0c0e11);
  }

  /* =================================================================
     Output — flatten to a 2D layer, export GLB
     ================================================================= */
  /** Render the scene once at DOCUMENT resolution (transparent unless a solid
      background color is chosen) and place it as a new layer. This is the
      "one canvas is the ops center" handoff back to 2D editing. */
  function snapshotToLayer() {
    if (!renderer || !objects.length) { U.toast('Add a 3D object first'); return null; }
    refreshTextures(true);   // may be invoked from 2D mode (palette) — don't bake stale textures
    if (!D.doc.open) { D.newDocument(1024, 1024, null, '3d-render'); GF.ui.onDocumentOpened(); }
    else GF.history.push(D.doc, '3D render');
    const W = D.doc.width, H = D.doc.height;
    const pr = renderer.getPixelRatio(), oldAspect = camera.aspect, oldBg = scene.background;
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    if (bg.mode !== 'color') scene.background = null;
    helpers.visible = false;
    renderer.render(scene, camera);
    const L = D.addLayer('3D render');
    U.ctx2d(L.canvas).drawImage(renderer.domElement, 0, 0);
    // restore the live viewport
    helpers.visible = true;
    scene.background = oldBg;
    camera.aspect = oldAspect; camera.updateProjectionMatrix();
    renderer.setPixelRatio(pr); resize();
    GF.ui.refreshLayers(); GF.view.requestRender();
    U.toast('3D render placed on a new layer');
    return L.id;
  }

  async function exportGLB(opts) {
    opts = opts || {};
    const target = (opts.selection === 'selected' && selected()) ? selected().node : sceneRoot;
    if (!objects.length) { U.toast('Add some 3D objects first'); return; }
    try {
      const GLTFExporter = LIB.GLTFExporter;
      return new Promise(resolve => {
        new GLTFExporter().parse(target,
          g => { U.downloadBlob(new Blob([g], { type: 'model/gltf-binary' }), (D.doc.name || 'scene') + '.glb'); U.toast('GLB exported'); resolve(true); },
          e => { U.toast('Export failed: ' + e.message); resolve(false); },
          { binary: true });
      });
    } catch (e) { U.toast('GLB exporter could not load'); }
  }

  return {
    // lifecycle
    enter, exit, isActive, onChange, setStatusCallback: fn => { statusCb = fn; },
    // objects
    addPrimitive, importModel, handleFiles, removeObject, setVisible,
    listObjects, getObject, setObject, byId, count,
    // selection / interaction
    select, selectedId: () => selectedId, setInteract, getInteract, pick, frame,
    // materials / textures
    setMaterial, addImageSource, listImageSources, refreshAll,
    // environment
    setEnvironment, clearEnvironment, setBackground, background: () => Object.assign({}, bg),
    // output
    snapshotToLayer, exportGLB,
    // undo
    hist
  };
})();

/* Agent/automation surface: the 3D workspace joins the shared command
   catalog like everything else (GF.api.run('scene3d.addPrimitive', …)). */
if (GF.api && GF.api.register) {
  const R = GF.api.register;
  R('scene3d.enter', '', 'Open the 3D workspace', () => GF.ui.setTool('scene3d'));
  R('scene3d.exit', '', 'Leave the 3D workspace (back to image editing)', () => GF.ui.setTool('move'));
  R('scene3d.addPrimitive', 'kind(box|sphere|cylinder|cone|torus|torusknot|capsule|plane|panel|tile|hex|curved)', 'Add a primitive to the 3D scene', a => GF.scene3d.addPrimitive(a.kind || 'box'));
  R('scene3d.importModel', 'url, name?', 'Import a GLB/GLTF model into the 3D scene', a => GF.scene3d.importModel(a.url, a.name));
  R('scene3d.list', '', 'List the 3D scene objects', () => GF.scene3d.listObjects());
  R('scene3d.setObject', 'id, px?, py?, pz?, rx?(deg), ry?, rz?, sx?, sy?, sz?, scale?', 'Transform a 3D object', a => GF.scene3d.setObject(a.id, a));
  R('scene3d.setMaterial', 'id, mapSource?("composite"|"layer:<id>"|null), color?, roughness?(0-1), metalness?(0-1)', "Set a 3D object's material / texture source", a => {
    const p = {};
    ['mapSource', 'normalSource', 'roughSource', 'color', 'roughness', 'metalness', 'doubleSided', 'keepOriginal']
      .forEach(k => { if (a[k] !== undefined) p[k] = a[k]; });
    return GF.scene3d.setMaterial(a.id, p);
  });
  R('scene3d.snapshotToLayer', '', 'Render the 3D scene at document resolution onto a new 2D layer', () => GF.scene3d.snapshotToLayer());
  R('scene3d.exportGLB', 'selection?("scene"|"selected")', 'Export the 3D scene as a .glb file', a => GF.scene3d.exportGLB(a || {}));
}
