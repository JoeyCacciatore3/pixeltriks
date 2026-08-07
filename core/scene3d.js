/* PixelTriks — scene3d.js
   The 3D workspace engine (GF.scene3d). Import GLB/GLTF models, add
   primitives, move/rotate/scale each object, texture them with imported
   images or procedural textures, light with an HDRI, then export a .glb
   or the current view as a PNG.

   Three.js r185 vendored in vendor/three/, loaded via ui/three-bundle.js
   (static ES module → window.__THREE_BUNDLE). Static imports because
   dynamic import() hangs on file:// in Chrome.

   Color space: base-color maps tagged sRGB, normal/roughness stay linear.

   3D edits keep their own command-stack undo (GF.scene3d.hist); api.js
   routes undo/redo here. */
'use strict';
window.GF = window.GF || {};

GF.scene3d = (function () {
  const U = GF.util;

  let THREE = null, LIB = null, renderer = null, scene, camera, controls, raf = null;
  let sceneRoot = null;          // all user objects live under this group
  let helpers = null;            // selection highlight etc. — never exported
  let boxHelper = null, selFill = null;
  let envMap = null;
  let statusCb = () => {};       // scene3d-ui injects a status-line callback
  let changeCbs = [];            // fired on any scene mutation (UI refresh)

  const objects = [];            // [{id, name, kind, prim, node, visible, mat, material, _origMats}]
  let selectedId = null, nextId = 1;
  let interact = 'orbit';        // camera control mode (only orbit now)
  const bg = { mode: 'default', color: '#0c0e11' };   // default = dark; snapshot renders transparent unless 'color'

  const texCache = new Map();    // source-string -> { tex, srcCanvas }
  const images = new Map();      // 'image:<id>' -> canvas
  let compCanvas = null;         // persistent canvas backing the 'composite' texture
  let texDirty = false, lastTexAt = 0;
  let nextImageId = 1;
  let clock = null;
  const mixers = new Map();
  let ambientLight = null, keyLight = null, rimLight = null;
  let shadowsEnabled = true;

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
      const grab = () => { LIB = window.__THREE_BUNDLE; THREE = LIB.THREE; setStatus(''); };
      const t0 = Date.now();
      const onReady = () => { clearInterval(iv); grab(); resolve(LIB); };
      window.addEventListener('three-bundle-ready', onReady, { once: true });
      const iv = setInterval(() => {
        if (window.__THREE_BUNDLE) {
          window.removeEventListener('three-bundle-ready', onReady);
          clearInterval(iv); grab(); resolve(LIB);
        } else if (Date.now() - t0 > 15000) {
          window.removeEventListener('three-bundle-ready', onReady);
          clearInterval(iv); reject(new Error('three bundle unavailable'));
        }
      }, 50);
    });
  }
  function offline(e) {
    setStatus('Could not load the 3D engine (vendor/three missing or blocked).');
    U.toast('3D engine could not load');
    throw e;
  }

  /* =================================================================
     Undo — command stack (closures) for scene-graph mutations
     ================================================================= */
  /* BUG-009 fix: history entries can carry an optional `dispose` callback
     that fires when the entry is evicted from the stack (past undo window).
     This lets removeObject / addPrimitive free GPU resources (geometry,
     material, textures) once they can no longer be undone/redone. */
  const hist = (function () {
    const un = [], re = [];
    function evict(e) { if (e && typeof e.dispose === 'function') try { e.dispose(); } catch (_) {} }
    return {
      push(label, undo, redo, dispose) { un.push({ label, undo, redo, dispose }); if (un.length > 50) evict(un.shift()); re.forEach(evict); re.length = 0; emit(); },
      undo() { const e = un.pop(); if (!e) return; e.undo(); re.push(e); emit(); },
      redo() { const e = re.pop(); if (!e) return; e.redo(); un.push(e); emit(); },
      canUndo() { return un.length > 0; },
      canRedo() { return re.length > 0; },
      labels() { return un.map(e => e.label); },
      clear() { un.forEach(evict); re.forEach(evict); un.length = 0; re.length = 0; }
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
    renderer.shadowMap.enabled = shadowsEnabled;
    renderer.shadowMap.type = T.PCFSoftShadowMap;
    host.appendChild(renderer.domElement);

    scene = new T.Scene();
    scene.background = new T.Color(bg.color);
    camera = new T.PerspectiveCamera(40, 1, 0.05, 200);
    camera.position.set(2.2, 1.6, 3.2);
    ambientLight = new T.AmbientLight(0xffffff, 0.45); scene.add(ambientLight);
    keyLight = new T.DirectionalLight(0xffffff, 1.6); keyLight.position.set(2.5, 2.5, 3);
    keyLight.castShadow = true;
    keyLight.shadow.mapSize.width = 1024; keyLight.shadow.mapSize.height = 1024;
    keyLight.shadow.camera.near = 0.5; keyLight.shadow.camera.far = 50;
    keyLight.shadow.camera.left = -8; keyLight.shadow.camera.right = 8;
    keyLight.shadow.camera.top = 8; keyLight.shadow.camera.bottom = -8;
    keyLight.shadow.bias = -0.001;
    scene.add(keyLight);
    rimLight = new T.DirectionalLight(0xe8a33d, 0.5); rimLight.position.set(-3, -1, -2); scene.add(rimLight);

    sceneRoot = new T.Group(); scene.add(sceneRoot);
    helpers = new T.Group(); scene.add(helpers);

    controls = new LIB.OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true; controls.dampingFactor = 0.08;
    clock = new T.Clock();
    // No transform gizmo: object movement is owned solely by the bottom-left
    // transform pad (GF.transformPad) + physical gamepad. Left-drag orbits.

    new ResizeObserver(resize).observe(U.$('#viewport'));
    resize();
    wirePointer(renderer.domElement, host);
    U.$('#viewport').addEventListener('pointerup', () => { texDirty = true; }, { passive: true });

    const vp = U.$('#viewport');
    vp.addEventListener('dragover', e => { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; });
    vp.addEventListener('drop', handleViewportDrop);

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
    const dt = clock ? clock.getDelta() : 0;
    for (const [, entry] of mixers) entry.mixer.update(dt);
    if (texDirty && performance.now() - lastTexAt > 250) { lastTexAt = performance.now(); texDirty = false; refreshTextures(); }
    if (boxHelper) {
      const o = byId(selectedId);
      if (o) {
        boxHelper.box.setFromObject(o.node);
        if (selFill) {
          const sz = boxHelper.box.getSize(new THREE.Vector3());
          const ct = boxHelper.box.getCenter(new THREE.Vector3());
          selFill.position.copy(ct);
          selFill.scale.set(sz.x || 0.01, sz.y || 0.01, sz.z || 0.01);
        }
      }
    }
    renderer.render(scene, camera);
  }

  let modeEpoch = 0;   // guards the enter/exit race while the engine is still booting
  async function enter() {
    const epoch = ++modeEpoch;
    try { await ensureRenderer(); } catch (e) { return false; }
    if (epoch !== modeEpoch) return false;
    document.body.dataset.mode = '3d';
    if (!raf) animate();
    refreshAll();
    window.dispatchEvent(new CustomEvent('pt:modechange', { detail: { mode: '3d' } }));
    return true;
  }
  function exit() {
    modeEpoch++;
    document.body.dataset.mode = 'image';
    if (raf) { cancelAnimationFrame(raf); raf = null; }
    window.dispatchEvent(new CustomEvent('pt:modechange', { detail: { mode: 'image' } }));
  }

  /* Auto-boot: start the 3D renderer as soon as the bundle is ready.
     The 3D viewport is always visible — no mode toggle needed. */
  function autoBoot() {
    enter().catch(() => {});
  }
  if (typeof window !== 'undefined') {
    if (window.__THREE_BUNDLE) autoBoot();
    else window.addEventListener('three-bundle-ready', autoBoot, { once: true });
  }

  /* =================================================================
     Textures — resolve a material source onto a (cached) CanvasTexture
     3D-only: sources are imported images + procedural textures, both
     registered as 'image:<id>' via addImageSource. (The 2D-document
     'composite' / 'layer:' / 'auto:*' sources went away with the 2D editor.)
     ================================================================= */
  function resolveSourceCanvas(source) {
    if (!source) return null;
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
  /* BUG-010 fix: provide a removal path for image sources so they don't
     accumulate forever. Called when objects using them are permanently gone. */
  function removeImageSource(key) { images.delete(key); texCache.delete(key); }

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
  // open/flat geometry is only usable double-sided
  const TWO_SIDED_PRIMS = ['plane', 'panel', 'curved', 'disc', 'ring', 'pipe', 'hemisphere'];
  function defaultMat(kind, prim) {
    const flat = TWO_SIDED_PRIMS.includes(prim);
    return {
      mapSource: null, normalSource: null, roughSource: null,
      color: '#cccccc', roughness: 0.65, metalness: 0.05,
      emissive: '#000000', emissiveIntensity: 0,
      opacity: 1,
      mapRepeatX: 1, mapRepeatY: 1, mapOffsetX: 0, mapOffsetY: 0,
      doubleSided: flat, keepOriginal: (kind === 'model')
    };
  }
  function applyMaterial(o) {
    if (!o || !THREE) return;
    if (o.mat.keepOriginal && o.kind !== 'primitive') { restoreOriginalMats(o); return; }
    const m = o.material;
    const flipY = o.kind !== 'model';   // glTF UVs are top-left origin — no flip
    m.map = o.mat.mapSource ? texFor(o.mat.mapSource, true, flipY) : null;
    m.normalMap = o.mat.normalSource ? texFor(o.mat.normalSource, false, flipY) : null;
    m.roughnessMap = o.mat.roughSource ? texFor(o.mat.roughSource, false, flipY) : null;
    m.color.set(m.map ? '#ffffff' : o.mat.color);
    m.roughness = o.mat.roughnessMap ? 1.0 : o.mat.roughness;
    m.metalness = o.mat.metalness;
    m.emissive.set(o.mat.emissive || '#000000');
    m.emissiveIntensity = o.mat.emissiveIntensity || 0;
    const opa = o.mat.opacity != null ? o.mat.opacity : 1;
    m.transparent = opa < 1;
    m.opacity = opa;
    // Apply UV tiling/offset to all texture channels so they stay in sync
    const uvRepeat = [o.mat.mapRepeatX || 1, o.mat.mapRepeatY || 1];
    const uvOffset = [o.mat.mapOffsetX || 0, o.mat.mapOffsetY || 0];
    for (const ch of [m.map, m.normalMap, m.roughnessMap]) {
      if (ch) { ch.repeat.set(...uvRepeat); ch.offset.set(...uvOffset); ch.needsUpdate = true; }
    }
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
     Studio lights — intensity / color / shadow controls
     ================================================================= */
  function setStudioLight(name, patch) {
    const lights = { ambient: ambientLight, key: keyLight, rim: rimLight };
    const light = lights[name]; if (!light) return;
    if (patch.intensity !== undefined) light.intensity = patch.intensity;
    if (patch.color !== undefined) light.color.set(patch.color);
  }
  function setShadows(enabled) {
    shadowsEnabled = !!enabled;
    if (renderer) { renderer.shadowMap.enabled = shadowsEnabled; renderer.shadowMap.needsUpdate = true; }
    if (keyLight) keyLight.castShadow = shadowsEnabled;
  }
  function getStudioLights() {
    return {
      ambient: ambientLight ? { intensity: ambientLight.intensity, color: '#' + ambientLight.color.getHexString() } : null,
      key: keyLight ? { intensity: keyLight.intensity, color: '#' + keyLight.color.getHexString() } : null,
      rim: rimLight ? { intensity: rimLight.intensity, color: '#' + rimLight.color.getHexString() } : null,
      shadows: shadowsEnabled,
    };
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
  /* BUG-009: dispose GPU resources for an object that is permanently gone
     (past the undo window). Traverses the Three.js subtree and frees
     geometry, material, and texture allocations. */
  function disposeNode(node) {
    if (!node) return;
    node.traverse(ch => {
      if (ch.geometry) ch.geometry.dispose();
      if (ch.material) {
        const mats = Array.isArray(ch.material) ? ch.material : [ch.material];
        mats.forEach(m => { if (m.map) m.map.dispose(); if (m.normalMap) m.normalMap.dispose(); m.dispose(); });
      }
    });
  }

  /** Faceted look for crystals/gems: flat per-face normals instead of the
      smooth spherical shading PolyhedronGeometry ships with. */
  function facet(g) {
    const ng = g.index ? g.toNonIndexed() : g;
    ng.computeVertexNormals();
    return ng;
  }
  function extrudeShape(builder, depth) {
    const T = THREE, s = new T.Shape();
    builder(s);
    const g = new T.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 });
    g.center();
    return g;
  }
  function starPath(s, points, R, r) {
    for (let i = 0; i < points * 2; i++) {
      const a = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
      const rr = (i % 2) ? r : R;
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
      i ? s.lineTo(x, y) : s.moveTo(x, y);
    }
    s.closePath();
  }
  function primGeo(kind) {
    const T = THREE;
    switch (kind) {
      /* ---- basics ---- */
      case 'box':        return new T.BoxGeometry(1, 1, 1);
      case 'roundedbox': return new LIB.RoundedBoxGeometry(1.05, 1.05, 1.05, 4, 0.12);
      case 'cylinder':   return new T.CylinderGeometry(0.5, 0.5, 1, 32);
      case 'cone':       return new T.ConeGeometry(0.5, 1, 32);
      case 'pyramid':    return facet(new T.ConeGeometry(0.68, 0.9, 4, 1));
      case 'prism':      return facet(new T.CylinderGeometry(0.58, 0.58, 1, 3, 1));
      case 'capsule':    return new T.CapsuleGeometry(0.4, 0.6, 8, 24);
      case 'hemisphere': return new T.SphereGeometry(0.62, 48, 24, 0, Math.PI * 2, 0, Math.PI / 2);
      case 'torus':      return new T.TorusGeometry(0.45, 0.18, 16, 48);
      case 'torusknot':  return new T.TorusKnotGeometry(0.45, 0.16, 128, 24);
      case 'pipe':       return new T.CylinderGeometry(0.32, 0.32, 1.2, 32, 1, true);
      /* ---- crystals (faceted platonic solids + a lathe-cut gem) ---- */
      case 'tetrahedron':  return facet(new T.TetrahedronGeometry(0.72));
      case 'octahedron':   return facet(new T.OctahedronGeometry(0.66));
      case 'dodecahedron': return facet(new T.DodecahedronGeometry(0.62));
      case 'icosahedron':  return facet(new T.IcosahedronGeometry(0.62));
      case 'gem': {
        const pts = [new T.Vector2(0.001, -0.55), new T.Vector2(0.44, 0.02), new T.Vector2(0.3, 0.3), new T.Vector2(0.001, 0.38)];
        return facet(new T.LatheGeometry(pts, 8));
      }
      /* ---- flat texturable shapes (signboards, tiles, backdrops) ---- */
      case 'plane':    return new T.PlaneGeometry(1, 1);
      case 'panel':    return new T.BoxGeometry(1.4, 0.9, 0.06);
      case 'disc':     return new T.CircleGeometry(0.62, 48);
      case 'ring':     return new T.RingGeometry(0.3, 0.62, 48);
      case 'tile':     return new T.BoxGeometry(1, 0.1, 1);
      case 'hex':      return new T.CylinderGeometry(0.6, 0.6, 0.12, 6);
      case 'curved':   return new T.CylinderGeometry(1, 1, 1.1, 48, 1, true, -Math.PI / 3, (2 * Math.PI) / 3);
      /* ---- extras (extruded outlines + built structures) ---- */
      case 'star':  return extrudeShape(s => starPath(s, 5, 0.62, 0.27), 0.2);
      case 'heart': return extrudeShape(s => {
        s.moveTo(0.25, 0.25);
        s.bezierCurveTo(0.25, 0.25, 0.2, 0, 0, 0);
        s.bezierCurveTo(-0.3, 0, -0.3, 0.35, -0.3, 0.35);
        s.bezierCurveTo(-0.3, 0.55, -0.1, 0.77, 0.25, 0.95);
        s.bezierCurveTo(0.6, 0.77, 0.8, 0.55, 0.8, 0.35);
        s.bezierCurveTo(0.8, 0.35, 0.8, 0, 0.5, 0);
        s.bezierCurveTo(0.35, 0, 0.25, 0.25, 0.25, 0.25);
      }, 0.2).rotateZ(Math.PI);   // the classic path is drawn point-up
      case 'arrow': return extrudeShape(s => {
        s.moveTo(-0.6, -0.14); s.lineTo(0.08, -0.14); s.lineTo(0.08, -0.34);
        s.lineTo(0.62, 0); s.lineTo(0.08, 0.34); s.lineTo(0.08, 0.14);
        s.lineTo(-0.6, 0.14); s.closePath();
      }, 0.16);
      case 'steps': {
        const n = 4, step = 0.85 / n, parts = [];
        for (let i = 0; i < n; i++) {
          const h = (i + 1) * step;
          const g = new T.BoxGeometry(1, h, step);
          g.translate(0, h / 2 - 0.425, -0.425 + (i + 0.5) * step);
          parts.push(g);
        }
        return LIB.mergeGeometries(parts);
      }
      default: return new T.SphereGeometry(0.55, 48, 32);
    }
  }
  const PRIM_LABELS = {
    roundedbox: 'Rounded box', torusknot: 'Torus knot', hemisphere: 'Dome',
    hex: 'Hex tile', curved: 'Curved wall',
  };
  function primLabel(prim) { return PRIM_LABELS[prim] || prim.charAt(0).toUpperCase() + prim.slice(1); }
  async function addPrimitive(kind) {
    try { await ensureRenderer(); } catch (e) { return null; }
    const prim = kind || 'sphere', id = nextId++;
    const o = {
      id, name: primLabel(prim) + ' ' + id, kind: 'primitive', prim,
      node: null, visible: true, mat: defaultMat('primitive', prim), _origMats: new Map()
    };
    o.material = new THREE.MeshStandardMaterial({ roughness: o.mat.roughness, metalness: o.mat.metalness });
    o.node = new THREE.Mesh(primGeo(o.prim), o.material);
    o.node.castShadow = true;
    o.node.receiveShadow = true;
    // stagger so stacked adds don't z-fight
    o.node.position.x = (objects.length % 3) * 0.4 - 0.4;
    attach(o); applyMaterial(o); select(o.id);
    if (objects.length === 1) frame();      // first shape → frame it so the user sees it appear
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
        node.traverse(ch => { if (ch.isMesh) { ch.castShadow = true; ch.receiveShadow = true; } });
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
        if (g.animations && g.animations.length) {
          // Load STATIC: build the actions but do NOT auto-play — the model
          // starts in its rest pose. The user starts playback from the anim
          // controls (▶ Play). Auto-playing looped forever with no way to stop.
          const mixer = new T.AnimationMixer(node);
          const actions = g.animations.map(clip => mixer.clipAction(clip));   // built but NOT played → model stays in its bind pose
          mixers.set(o.id, { mixer, clips: g.animations, actions, playing: false });
          if (GF.animation) GF.animation.importClips(g.animations);
          setStatus(o.name + ' — ' + g.animations.length + ' animation(s), paused. Press ▶ to play.');
        }
        hist.push('import ' + o.name, () => detach(o), () => attach(o));
        setStatus('Model loaded — ' + o.name);
        U.toast('Model loaded: ' + o.name);
        resolve(o.id);
      }, undefined, () => { setStatus('Could not load that model.'); U.toast('Could not load that model'); resolve(null); });
    });
  }

  /** Engine access for generated-geometry callers: boots the renderer if needed
      and hands back the shared THREE instance + addon bundle. */
  async function engine() {
    await ensureRenderer();
    return { THREE, LIB };
  }

  /** Adopt a generated geometry/Object3D as a first-class scene object.
      textureCanvas (optional) becomes a snapshot image source so the object
      keeps its look even if the 2D document changes afterwards.
      keepOriginal: the node manages its own materials (e.g. layer stacks). */
  function addGenerated(input, name, opts) {
    if (!THREE) return null;   // callers boot the engine (ensureRenderer) first
    opts = opts || {};
    const id = nextId++;
    const o = {
      id, name: (name || 'Generated') + ' ' + id, kind: 'generated', prim: null,
      node: null, visible: true, mat: defaultMat('generated'), _origMats: new Map()
    };
    o.mat.keepOriginal = !!opts.keepOriginal;
    o.mat.doubleSided = !!opts.doubleSided;
    o.material = new THREE.MeshStandardMaterial({ roughness: o.mat.roughness, metalness: o.mat.metalness });
    o.node = input.isObject3D ? input : new THREE.Mesh(input, o.material);
    o.node.traverse(ch => { if (ch.isMesh) { ch.castShadow = true; ch.receiveShadow = true; } });
    o.mat.mapSource = opts.textureCanvas ? addImageSource(opts.textureCanvas, o.name) : null;
    attach(o); applyMaterial(o); select(o.id);
    hist.push('make ' + (name || '3D'), () => detach(o), () => { attach(o); applyMaterial(o); });
    return o.id;
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
        } else if (f.type && f.type.startsWith('image/') && !hasGltf) await importImageAsTexture(f);
      }
    } finally {
      for (const u of urls.values()) URL.revokeObjectURL(u);
    }
  }

  async function handleViewportDrop(e) {
    e.preventDefault();
    const assetId = e.dataTransfer.getData('application/x-pixeltriks-asset');
    if (assetId && GF.assets) {
      const asset = await GF.assets.get(assetId);
      if (!asset) return;
      if (asset.type === 'model') {
        const url = GF.assets.blobUrl(asset);
        if (url) await importModel(url, asset.name);
      } else if (asset.type === 'material') {
        const o = selected();
        if (!o) { U.toast('Select an object to apply material'); return; }
        const colorCanvas = await _blobToCanvas(asset.data);
        const colorKey = addImageSource(colorCanvas, asset.name + '-color');
        const patch = { mapSource: colorKey };
        if (asset.materialData) {
          if (asset.materialData.normal) {
            const nc = await _blobToCanvas(asset.materialData.normal);
            patch.normalSource = addImageSource(nc, asset.name + '-normal');
          }
          if (asset.materialData.metalness !== undefined) patch.metalness = asset.materialData.metalness;
          if (asset.materialData.roughnessVal !== undefined) patch.roughness = asset.materialData.roughnessVal;
        }
        setMaterial(o.id, patch);
        U.toast('Material applied: ' + asset.name);
      } else if (asset.type === 'texture') {
        const o = selected();
        if (!o) { U.toast('Select an object to apply texture'); return; }
        const canvas = await _blobToCanvas(asset.data);
        setMaterial(o.id, { mapSource: addImageSource(canvas, asset.name) });
        U.toast('Texture applied: ' + asset.name);
      } else if (asset.type === 'hdri') {
        const url = GF.assets.blobUrl(asset);
        if (url) await setEnvironment(url);
      }
    } else if (e.dataTransfer.files.length) {
      handleFiles(e.dataTransfer.files);
    }
  }
  function _blobToCanvas(blob) { return U.blobToCanvas(blob); }

  /** Import an image file as a reusable texture source; apply it to the
      selected object if there is one, otherwise just register it. */
  async function importImageAsTexture(file) {
    try {
      const canvas = await U.blobToCanvas(file);
      const key = addImageSource(canvas, (file.name || 'image').replace(/\.[^.]+$/, ''));
      const o = selected();
      if (o) { setMaterial(o.id, { mapSource: key }); U.toast('Texture applied: ' + file.name); }
      else U.toast('Texture imported — select an object to apply it');
      return key;
    } catch (e) { U.toast('Could not load that image'); return null; }
  }

  function removeObject(id) {
    const o = byId(id); if (!o) return;
    /* BUG-003 fix: stash the mixer entry so undo can restore it.
       Previously mixers.delete ran before the undo closure captured
       anything — undoing a deletion left the model with dead animation. */
    const stashedMixer = mixers.has(id) ? mixers.get(id) : null;
    if (stashedMixer) {
      stashedMixer.mixer.stopAllAction(); mixers.delete(id);
      /* BUG-012 fix: remove imported clips so they don't ghost into exports */
      if (GF.animation && GF.animation.removeClips) GF.animation.removeClips(stashedMixer.clips);
    }
    /* BUG-013 fix: exit paint3d if we're deleting the object being painted */
    if (GF.paint3d && GF.paint3d.isActive() && GF.paint3d.targetObjId() === id) GF.paint3d.exit();
    detach(o);
    hist.push('remove ' + o.name,
      () => { attach(o); applyMaterial(o); if (stashedMixer) mixers.set(o.id, stashedMixer); },
      () => { if (mixers.has(o.id)) { mixers.get(o.id).mixer.stopAllAction(); mixers.delete(o.id); } detach(o); },
      () => { disposeNode(o.node); if (o.material) o.material.dispose(); });
  }
  /** Duplicate an object — primitive or imported model — with its transform
      and material, offset so the copy is visible. Returns the new id. */
  function duplicateObject(id) {
    const src = byId(id == null ? selectedId : id); if (!src) return null;
    const o = {
      id: nextId++, name: src.name + ' copy', kind: src.kind, prim: src.prim,
      node: src.node.clone(true), visible: src.visible,
      mat: Object.assign({}, src.mat), _origMats: new Map()
    };
    o.material = src.material.clone();
    // clone(true) shares material refs with the source — re-point ours at the copy
    o.node.traverse(ch => { if (ch.isMesh && ch.material === src.material) ch.material = o.material; });
    if (o.node.isMesh && o.node.material === src.material) o.node.material = o.material;
    o.node.position.x += 0.5;
    /* BUG-011 fix: clone animation mixer + clips for the duplicate so it
       has independent, working animation. Previously only the mesh was
       cloned — the mixer stayed on the original, leaving the copy dead. */
    if (mixers.has(src.id)) {
      const srcMix = mixers.get(src.id);
      const mixer = new THREE.AnimationMixer(o.node);
      const actions = srcMix.clips.map(clip => mixer.clipAction(clip));
      mixers.set(o.id, { mixer, clips: srcMix.clips, actions, playing: false });
    }
    attach(o); applyMaterial(o); select(o.id);
    hist.push('duplicate ' + src.name, () => detach(o), () => { attach(o); applyMaterial(o); });
    return o.id;
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
    if (selFill) { helpers.remove(selFill); selFill.geometry.dispose(); selFill.material.dispose(); selFill = null; }
    const o = byId(id);
    if (o) {
      const box = new THREE.Box3().setFromObject(o.node);
      boxHelper = new THREE.Box3Helper(box, new THREE.Color(0xe8a33d));
      helpers.add(boxHelper);
      /* translucent amber fill — makes selection obvious even on small/dark objects */
      const sz = box.getSize(new THREE.Vector3());
      const ct = box.getCenter(new THREE.Vector3());
      selFill = new THREE.Mesh(
        new THREE.BoxGeometry(1, 1, 1),
        new THREE.MeshBasicMaterial({ color: 0xe8a33d, transparent: true, opacity: 0.07, depthWrite: false, side: THREE.DoubleSide })
      );
      selFill.position.copy(ct);
      selFill.scale.set(sz.x || 0.01, sz.y || 0.01, sz.z || 0.01);
      selFill.renderOrder = 999;
      helpers.add(selFill);
    }
    emit();
  }
  function selected() { return byId(selectedId); }
  function setInteract(mode) { interact = mode; if (controls) controls.enabled = true; }   // camera orbit always on

  /* Imported-model animation playback (mixers). Models load paused; these drive
     the actions when the user hits ▶ / ⏸ / ⏹. */
  function playAnimations() { mixers.forEach(m => { if (m.actions) m.actions.forEach(a => { if (!a.isRunning()) a.play(); a.paused = false; }); m.playing = true; }); }
  function pauseAnimations() { mixers.forEach(m => { if (m.actions) m.actions.forEach(a => { a.paused = true; }); m.playing = false; }); }
  function stopAnimations() { mixers.forEach(m => { if (m.actions) m.actions.forEach(a => a.stop()); m.mixer.update(0); m.playing = false; }); }
  function hasModelAnimations() { return mixers.size > 0; }

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
  function raycastUV(clientX, clientY) {
    if (!THREE || !renderer) return null;
    const r = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - r.left) / r.width) * 2 - 1, -((clientY - r.top) / r.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, camera);
    const hits = ray.intersectObjects(sceneRoot.children, true);
    if (!hits.length || !hits[0].uv) return null;
    let n = hits[0].object;
    while (n && n.parent !== sceneRoot) n = n.parent;
    const o = objects.find(x => x.node === n);
    if (!o) return null;
    return { objectId: o.id, uv: { x: hits[0].uv.x, y: hits[0].uv.y }, point: hits[0].point };
  }

  function wirePointer(el, host) {
    // shield the 2D engine: nothing here reaches #viewport's handlers
    ['pointerdown', 'pointermove', 'pointerup', 'pointercancel'].forEach(t =>
      host.addEventListener(t, e => e.stopPropagation()));
    host.addEventListener('wheel', e => e.stopPropagation(), { passive: false });

    // Object movement lives in the transform pad only. Here the viewport just
    // does: left-drag = orbit (OrbitControls), click (no drag) = select/deselect.
    let down = null;
    el.addEventListener('pointerdown', e => {
      if (GF.editmesh && GF.editmesh.isActive()) { GF.editmesh.onPointerDown(e); return; }
      if (GF.paint3d && GF.paint3d.isActive() && GF.paint3d.onPointerDown(e)) return;
      down = { x: e.clientX, y: e.clientY };
    });
    el.addEventListener('pointermove', e => {
      if (GF.editmesh && GF.editmesh.isActive()) { GF.editmesh.onPointerMove(e); return; }
      if (GF.paint3d && GF.paint3d.isActive() && GF.paint3d.onPointerMove(e)) return;
    });
    el.addEventListener('pointerup', e => {
      if (GF.editmesh && GF.editmesh.isActive()) { GF.editmesh.onPointerUp(e); return; }
      if (GF.paint3d && GF.paint3d.isActive() && GF.paint3d.onPointerUp(e)) return;
      if (down && Math.abs(e.clientX - down.x) + Math.abs(e.clientY - down.y) < 4)
        select(pick(e.clientX, e.clientY));      // a click (not an orbit-drag) selects / deselects
      down = null;
    });
    el.addEventListener('pointercancel', () => { down = null; });
  }
  function planePoint(e, plane) {
    const T = THREE, r = renderer.domElement.getBoundingClientRect();
    const ndc = new T.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    const ray = new T.Raycaster(); ray.setFromCamera(ndc, camera);
    const pt = new T.Vector3();
    return ray.ray.intersectPlane(plane, pt) ? pt : null;
  }
  /** Orbit the camera around the controls target (gamepad right stick). */
  function orbitCamera(dYaw, dPitch) {
    if (!THREE || !camera || !controls) return;
    const off = camera.position.clone().sub(controls.target);
    const sph = new THREE.Spherical().setFromVector3(off);
    sph.theta -= dYaw;
    sph.phi = Math.max(0.05, Math.min(Math.PI - 0.05, sph.phi - dPitch));
    camera.position.copy(controls.target).add(new THREE.Vector3().setFromSpherical(sph));
    camera.lookAt(controls.target);
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

  /** Snap camera to a preset view direction at a comfortable distance. */
  function viewPreset(direction) {
    if (!THREE || !camera || !controls) return;
    const target = selected() ? selected().node : sceneRoot;
    const box = new THREE.Box3().setFromObject(target);
    const center = box.isEmpty() ? controls.target.clone() : box.getCenter(new THREE.Vector3());
    const dist = (box.isEmpty() ? 2 : box.getSize(new THREE.Vector3()).length()) * 1.6;
    const offsets = {
      front: [0, 0, 1], back: [0, 0, -1], right: [1, 0, 0], left: [-1, 0, 0],
      top: [0, 1, 0.001], bottom: [0, -1, 0.001],   // tiny Z offset avoids gimbal lock
    };
    const off = offsets[direction] || offsets.front;
    controls.target.copy(center);
    camera.position.set(center.x + off[0] * dist, center.y + off[1] * dist, center.z + off[2] * dist);
    camera.lookAt(center);
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
        new LIB.HDRLoader().load(url, tex => {
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
     Output — export view as PNG, export GLB
     ================================================================= */
  /** Render the current 3D view to a PNG blob and trigger a download.
      (Was "flatten to a 2D layer" — there is no 2D layer target anymore.)
      Returns the Blob so callers/tests can inspect it. */
  function exportViewPng(size) {
    if (!renderer || !objects.length) { U.toast('Add a 3D object first'); return Promise.resolve(null); }
    refreshTextures(true);
    const W = Math.max(1, Math.round(size || renderer.domElement.width || 1024));
    const H = Math.max(1, Math.round(size || renderer.domElement.height || 1024));
    const pr = renderer.getPixelRatio(), oldAspect = camera.aspect, oldBg = scene.background;
    renderer.setPixelRatio(1);
    renderer.setSize(W, H, false);
    camera.aspect = W / H; camera.updateProjectionMatrix();
    if (bg.mode !== 'color') scene.background = null;
    helpers.visible = false;
    renderer.render(scene, camera);
    const out = U.makeCanvas(W, H);
    U.ctx2d(out).drawImage(renderer.domElement, 0, 0);
    // restore the live viewport
    helpers.visible = true;
    scene.background = oldBg;
    camera.aspect = oldAspect; camera.updateProjectionMatrix();
    renderer.setPixelRatio(pr); resize();
    return new Promise(resolve => {
      out.toBlob(blob => {
        if (blob) { U.downloadBlob(blob, 'render.png'); U.toast('View exported as PNG'); }
        resolve(blob);
      }, 'image/png');
    });
  }

  /** Raw binary-GLB ArrayBuffer of the scene (or selected object) — shared by
      the .glb download and the web-page publisher. */
  function exportGLBBuffer(opts) {
    opts = opts || {};
    if (!objects.length || !LIB) return Promise.resolve(null);
    const target = (opts.selection === 'selected' && selected()) ? selected().node : sceneRoot;
    const exportOpts = { binary: true };
    if (GF.animation && GF.animation.hasAnimation()) {
      exportOpts.animations = GF.animation.getClips();
      exportOpts.trs = true;
    }
    return new Promise((resolve, reject) => {
      new LIB.GLTFExporter().parse(target, g => resolve(g), e => reject(e), exportOpts);
    });
  }
  async function exportGLB(opts) {
    if (!objects.length) { U.toast('Add some 3D objects first'); return; }
    try {
      const buf = await exportGLBBuffer(opts);
      if (!buf) return false;
      U.downloadBlob(new Blob([buf], { type: 'model/gltf-binary' }), 'scene.glb');
      U.toast('GLB exported');
      return true;
    } catch (e) { U.toast('Export failed: ' + e.message); return false; }
  }

  return {
    // lifecycle
    enter, exit, isActive, onChange, setStatusCallback: fn => { statusCb = fn; },
    // objects
    addPrimitive, importModel, addGenerated, engine, handleFiles, removeObject, duplicateObject, setVisible,
    listObjects, getObject, setObject, byId, count,
    // selection / interaction
    select, selected, selectedId: () => selectedId, setInteract, pick, raycastUV, frame, viewPreset, orbitCamera,
    playAnimations, pauseAnimations, stopAnimations, hasModelAnimations,
    rendererEl: () => renderer ? renderer.domElement : null,
    // materials / textures
    setMaterial, addImageSource, removeImageSource, listImageSources, refreshAll,
    // lighting
    setStudioLight, setShadows, getStudioLights,
    // environment
    setEnvironment, clearEnvironment, setBackground, background: () => Object.assign({}, bg),
    // output
    exportViewPng, exportGLB, exportGLBBuffer,
    // undo
    hist,
    // mesh edit-mode support (ui/editmesh.js) — live engine refs + selection-helper control
    editRefs: () => ({
      THREE, camera, renderer, scene, sceneRoot, hist, emit,
      screenRect: () => renderer ? renderer.domElement.getBoundingClientRect() : null,
      setControlsEnabled: v => { if (controls) controls.enabled = v; },
      hideObjectHandles: () => {
        if (boxHelper) { helpers.remove(boxHelper); boxHelper.dispose(); boxHelper = null; }
        if (selFill) { helpers.remove(selFill); selFill.geometry.dispose(); selFill.material.dispose(); selFill = null; }
      },
      restoreSelection: () => select(selectedId),
    }),
  };
})();

/* Agent/automation surface: the 3D workspace joins the shared command
   catalog like everything else (GF.api.run('scene3d.addPrimitive', …)). */
if (GF.api && GF.api.register) {
  const R = GF.api.register;
  R('scene3d.enter', '', 'Ensure the 3D workspace is active', () => { if (GF.scene3dUI) GF.scene3dUI.enter(); });
  R('scene3d.addPrimitive', 'kind(sphere|box|roundedbox|cylinder|cone|pyramid|prism|capsule|hemisphere|torus|torusknot|pipe|tetrahedron|octahedron|dodecahedron|icosahedron|gem|plane|panel|disc|ring|tile|hex|curved|star|heart|arrow|steps)', 'Add a primitive to the 3D scene', a => GF.scene3d.addPrimitive(a.kind || 'box'));
  R('scene3d.importModel', 'url, name?', 'Import a GLB/GLTF model into the 3D scene', a => GF.scene3d.importModel(a.url, a.name));
  R('scene3d.list', '', 'List the 3D scene objects', () => GF.scene3d.listObjects());
  R('scene3d.setObject', 'id, px?, py?, pz?, rx?(deg), ry?, rz?, sx?, sy?, sz?, scale?', 'Transform a 3D object', a => GF.scene3d.setObject(a.id, a));
  R('scene3d.setMaterial', 'id, mapSource?("image:<id>"|null), color?, roughness?(0-1), metalness?(0-1)', "Set a 3D object's material / texture source", a => {
    const p = {};
    ['mapSource', 'normalSource', 'roughSource', 'color', 'roughness', 'metalness', 'doubleSided', 'keepOriginal']
      .forEach(k => { if (a[k] !== undefined) p[k] = a[k]; });
    return GF.scene3d.setMaterial(a.id, p);
  });
  R('scene3d.exportPng', '', 'Export view as PNG', () => GF.scene3d.exportViewPng(),
    { group: '3D', label: 'Export view as PNG' });
  R('scene3d.deleteSelected', 'id?', 'Remove a 3D object (default: the selected one)', a => {
    const id = (a && a.id != null) ? a.id : GF.scene3d.selectedId();
    if (id == null) throw new Error('no 3D object selected');
    GF.scene3d.removeObject(id);
  });
  R('scene3d.duplicateSelected', 'id?', 'Duplicate a 3D object (default: the selected one)', a => {
    const id = (a && a.id != null) ? a.id : GF.scene3d.selectedId();
    if (id == null) throw new Error('no 3D object selected');
    return GF.scene3d.duplicateObject(id);
  });
  R('scene3d.frameSelected', '', 'Frame the selected object (or whole scene) in view', () => GF.scene3d.frame());
  R('scene3d.exportGLB', 'selection?("scene"|"selected")', 'Export the 3D scene as a .glb file', a => GF.scene3d.exportGLB(a || {}));
}
