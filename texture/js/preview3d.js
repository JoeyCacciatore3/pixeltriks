/* Forge Studio — preview3d.js
   Live material preview (Three.js) plus HDRI environment lighting and glTF
   model loading from the asset Library.

   Three.js and its addons (RGBELoader, GLTFLoader) are ES modules, loaded on
   demand via dynamic import() resolved through the import map in index.html —
   a single THREE instance, so addon objects are compatible with the scene.
   Everything needs an internet connection the first time it runs; if offline
   the panel explains that instead of failing silently.

   Color space is deliberate: the composite (base color) is tagged sRGB while
   normal/roughness maps stay linear, matching MeshStandardMaterial. */
'use strict';
window.GF = window.GF || {};

GF.preview3d = (function () {
  const U = GF.util;
  const D = GF.doc;

  let THREE = null, RGBELoaderC = null, GLTFLoaderC = null;
  let scene, camera, renderer, mesh, material, raf = null;
  let modelRoot = null, envMap = null;
  let baseTex, normalTex, roughTex;
  let dragging = false, lastX = 0, lastY = 0, rotX = 0.3, rotY = 0.6, autoSpin = true;

  function setStatus(msg) { U.$('#p3d-status').textContent = msg || ''; }

  /* ---- lazy ES-module loaders (resolved via the page import map) ---- */
  async function libThree() {
    if (!THREE) { setStatus('Loading 3D engine…'); THREE = await import('three'); setStatus(''); }
    return THREE;
  }
  async function libRGBE() {
    if (!RGBELoaderC) { ({ RGBELoader: RGBELoaderC } = await import('three/addons/loaders/RGBELoader.js')); }
    return RGBELoaderC;
  }
  async function libGLTF() {
    if (!GLTFLoaderC) { ({ GLTFLoader: GLTFLoaderC } = await import('three/addons/loaders/GLTFLoader.js')); }
    return GLTFLoaderC;
  }
  function offline(e) {
    setStatus('Could not load the 3D engine. The 3D preview needs an internet connection the first time it runs — everything else in Forge Studio works offline.');
    throw e;
  }

  function findLayer(nameContains) {
    const n = nameContains.toLowerCase();
    return D.doc.layers.find(L => L.name.toLowerCase().includes(n)) || null;
  }

  function buildTextures() {
    const T = THREE;
    const mapNames = ['normal', 'roughness', 'height', 'ao'];
    const hidden = [];
    for (const L of D.doc.layers) {
      if (mapNames.some(n => L.name.toLowerCase().includes(n)) && L.visible) { L.visible = false; hidden.push(L); }
    }
    const flat = D.composite();
    hidden.forEach(L => { L.visible = true; });

    if (baseTex) baseTex.dispose();
    baseTex = new T.CanvasTexture(flat);
    baseTex.colorSpace = T.SRGBColorSpace;
    baseTex.wrapS = baseTex.wrapT = T.RepeatWrapping;
    baseTex.anisotropy = renderer.capabilities.getMaxAnisotropy(); // sharp at oblique angles
    material.map = baseTex;

    const useN = U.$('#p3d-usenormal').checked, useR = U.$('#p3d-userough').checked;

    if (normalTex) { normalTex.dispose(); normalTex = null; material.normalMap = null; }
    const nL = useN ? findLayer('normal') : null;
    if (nL) { normalTex = new T.CanvasTexture(nL.canvas); normalTex.wrapS = normalTex.wrapT = T.RepeatWrapping; material.normalMap = normalTex; }

    if (roughTex) { roughTex.dispose(); roughTex = null; material.roughnessMap = null; }
    const rL = useR ? findLayer('roughness') : null;
    if (rL) { roughTex = new T.CanvasTexture(rL.canvas); roughTex.wrapS = roughTex.wrapT = T.RepeatWrapping; material.roughnessMap = roughTex; }
    material.roughness = rL ? 1.0 : 0.65;
    material.needsUpdate = true;
    setStatus('Maps: base' + (nL ? ' + normal' : '') + (rL ? ' + roughness' : '') + (envMap ? ' + HDRI env' : ''));
  }

  function buildMesh(shape) {
    const T = THREE;
    showShape();
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
    let geo;
    switch (shape) {
      case 'cube':     geo = new T.BoxGeometry(1.4, 1.4, 1.4); break;
      case 'plane':    geo = new T.PlaneGeometry(2, 2, 1, 1); break;
      case 'torus':    geo = new T.TorusKnotGeometry(0.7, 0.26, 128, 24); break;
      case 'cylinder': geo = new T.CylinderGeometry(0.9, 0.9, 1.7, 48); break;
      case 'cone':     geo = new T.ConeGeometry(1.0, 1.7, 48); break;
      case 'capsule':  geo = new T.CapsuleGeometry(0.7, 1.0, 8, 24); break;
      default:         geo = new T.SphereGeometry(1, 64, 48);
    }
    mesh = new T.Mesh(geo, material);
    scene.add(mesh);
  }

  /** Ensure the renderer/scene exist; returns true when ready. */
  async function ensureRenderer() {
    if (renderer) return true;
    const T = await libThree().catch(offline);
    const box = U.$('#p3d-container');
    renderer = new T.WebGLRenderer({ antialias: true });
    renderer.outputColorSpace = T.SRGBColorSpace;
    const size = box.clientWidth || 276;
    renderer.setSize(size, size);
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    box.innerHTML = ''; box.appendChild(renderer.domElement);

    scene = new T.Scene();
    scene.background = new T.Color(0x0c0e11);
    camera = new T.PerspectiveCamera(40, 1, 0.1, 50);
    camera.position.set(0, 0, 3.4);
    scene.add(new T.AmbientLight(0xffffff, 0.45));
    const key = new T.DirectionalLight(0xffffff, 1.6); key.position.set(2.5, 2.5, 3); scene.add(key);
    const rim = new T.DirectionalLight(0xe8a33d, 0.5); rim.position.set(-3, -1, -2); scene.add(rim);
    material = new T.MeshStandardMaterial({ roughness: 0.65, metalness: 0.05 });

    const el = renderer.domElement;
    el.addEventListener('pointerdown', e => { dragging = true; autoSpin = false; lastX = e.clientX; lastY = e.clientY; el.setPointerCapture(e.pointerId); });
    el.addEventListener('pointermove', e => { if (!dragging) return; rotY += (e.clientX - lastX) * 0.01; rotX += (e.clientY - lastY) * 0.01; rotX = U.clamp(rotX, -1.4, 1.4); lastX = e.clientX; lastY = e.clientY; });
    el.addEventListener('pointerup', () => { dragging = false; });
    return true;
  }

  async function start() {
    if (!D.doc.open) { U.toast('Open a document first'); return; }
    try {
      await ensureRenderer();
      buildMesh(U.$('#p3d-shape').value);
      buildTextures();
      if (!raf) animate();
      U.toast('3D preview running — drag to orbit');
    } catch (e) { /* offline status already set */ }
  }

  function animate() {
    raf = requestAnimationFrame(animate);
    const obj = modelRoot || (buildObjects.length ? buildRoot : mesh);
    if (!obj) return;
    if (autoSpin) rotY += 0.004;
    obj.rotation.x = rotX; obj.rotation.y = rotY;
    renderer.render(scene, camera);
  }

  function refresh() {
    if (!renderer || !material) { start(); return; }
    buildMesh(U.$('#p3d-shape').value);
    buildTextures();
    U.toast('Preview maps refreshed');
  }

  function showShape() { if (modelRoot) { scene.remove(modelRoot); modelRoot = null; } if (mesh) mesh.visible = true; }

  /* ---- HDRI environment lighting ---- */
  async function setEnvironment(url) {
    try {
      await ensureRenderer();
      if (!raf) animate();
      const T = THREE, Loader = await libRGBE().catch(offline);
      setStatus('Loading HDRI…');
      new Loader().load(url, tex => {
        tex.mapping = T.EquirectangularReflectionMapping;
        const pmrem = new T.PMREMGenerator(renderer);
        pmrem.compileEquirectangularShader();
        const env = pmrem.fromEquirectangular(tex).texture;
        if (envMap) envMap.dispose();
        envMap = env;
        scene.environment = env;
        scene.background = env;
        tex.dispose(); pmrem.dispose();
        if (material) { material.needsUpdate = true; }
        setStatus('HDRI environment active — drag to orbit reflections');
        U.toast('HDRI environment applied');
      }, undefined, () => setStatus('Could not load that HDRI (needs internet).'));
    } catch (e) { /* status set */ }
  }
  function clearEnvironment() {
    if (!scene) return;
    if (envMap) { envMap.dispose(); envMap = null; }
    scene.environment = null;
    scene.background = new THREE.Color(0x0c0e11);
    setStatus('Environment cleared');
  }

  /* ---- glTF model loading ---- */
  async function loadModel(url, includeMap) {
    try {
      await ensureRenderer();
      if (!raf) animate();
      const T = THREE, Loader = await libGLTF().catch(offline);
      setStatus('Loading model…');
      const mgr = new T.LoadingManager();
      if (includeMap) mgr.setURLModifier(u => {
        for (const key in includeMap) { if (u === key || u.endsWith(key) || u.endsWith(key.split('/').pop())) return includeMap[key]; }
        return u;
      });
      new Loader(mgr).load(url, g => {
        if (mesh) mesh.visible = false;
        if (modelRoot) scene.remove(modelRoot);
        modelRoot = g.scene;
        const box = new T.Box3().setFromObject(modelRoot);
        const size = box.getSize(new T.Vector3()), center = box.getCenter(new T.Vector3());
        const scl = 2 / (Math.max(size.x, size.y, size.z) || 1);
        modelRoot.scale.setScalar(scl);
        modelRoot.position.set(-center.x * scl, -center.y * scl, -center.z * scl);
        rotX = 0.2; rotY = 0.5;
        scene.add(modelRoot);
        setStatus('Model loaded — drag to orbit');
        U.toast('Model loaded');
      }, undefined, () => setStatus('Could not load that model (needs internet).'));
    } catch (e) { /* status set */ }
  }

  /* ---------------- 3D builder: compose primitives into an asset ----------------
     A simplified modeling workspace: stack/scale/rotate primitives, skin them
     with the canvas (or a flat color), light with an HDRI, then snapshot the
     render back onto the canvas or export the whole thing as a .glb. */
  let buildRoot = null, buildObjects = [];

  async function builderEnsure() {
    await ensureRenderer();
    if (!raf) animate();
    if (!buildRoot) { buildRoot = new THREE.Group(); scene.add(buildRoot); }
  }

  async function addPrimitive(kind) {
    try { await builderEnsure(); } catch (e) { return -1; }
    const T = THREE;
    let geo;
    switch (kind) {
      case 'box':      geo = new T.BoxGeometry(1, 1, 1); break;
      case 'cylinder': geo = new T.CylinderGeometry(0.5, 0.5, 1, 32); break;
      case 'cone':     geo = new T.ConeGeometry(0.5, 1, 32); break;
      case 'torus':    geo = new T.TorusGeometry(0.45, 0.18, 16, 48); break;
      case 'plane':    geo = new T.PlaneGeometry(1, 1); break;
      // ── flat texturable shapes (game surfaces + web/site 3D) ──
      case 'panel':    geo = new T.BoxGeometry(1.4, 0.9, 0.06); break;      // card / signboard / UI panel
      case 'tile':     geo = new T.BoxGeometry(1, 0.1, 1); break;           // flat floor/wall tile
      case 'hex':      geo = new T.CylinderGeometry(0.6, 0.6, 0.12, 6); break; // hexagonal tile
      case 'curved':   geo = new T.CylinderGeometry(1, 1, 1.1, 48, 1, true, -Math.PI / 3, (2 * Math.PI) / 3); break; // curved backdrop / wrap
      default:         geo = new T.SphereGeometry(0.55, 48, 32);
    }
    // Flats are best viewed/textured from both sides.
    const doubleSided = (kind === 'plane' || kind === 'panel' || kind === 'curved');
    const m = new T.Mesh(geo, new T.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05, side: doubleSided ? T.DoubleSide : T.FrontSide }));
    if (mesh) mesh.visible = false;                       // builder replaces the preview shape
    if (modelRoot) { scene.remove(modelRoot); modelRoot = null; }
    buildRoot.add(m);
    buildObjects.push({ kind, mesh: m, useTex: true, color: '#cccccc' });
    skinObject(buildObjects.length - 1);
    setStatus(buildObjects.length + ' object(s) — drag to orbit');
    return buildObjects.length - 1;
  }

  /** Apply canvas-composite texture or flat color to one object. */
  function skinObject(i) {
    const o = buildObjects[i]; if (!o) return;
    const T = THREE;
    if (o.useTex && D.doc.open) {
      if (!material.map) buildTextures();                 // ensures baseTex exists
      o.mesh.material.map = material.map;
      o.mesh.material.color.set('#ffffff');
    } else {
      o.mesh.material.map = null;
      o.mesh.material.color.set(o.color);
    }
    o.mesh.material.needsUpdate = true;
  }

  function setObject(i, t) {
    const o = buildObjects[i]; if (!o) return;
    if (t.x !== undefined) o.mesh.position.x = t.x;
    if (t.y !== undefined) o.mesh.position.y = t.y;
    if (t.z !== undefined) o.mesh.position.z = t.z;
    if (t.rot !== undefined) o.mesh.rotation.y = t.rot * Math.PI / 180;
    if (t.tilt !== undefined) o.mesh.rotation.x = t.tilt * Math.PI / 180;
    if (t.scale !== undefined) o.mesh.scale.setScalar(t.scale);
    if (t.useTex !== undefined) { o.useTex = t.useTex; skinObject(i); }
    if (t.color !== undefined) { o.color = t.color; if (!o.useTex) skinObject(i); }
  }
  function getObject(i) {
    const o = buildObjects[i]; if (!o) return null;
    const m = o.mesh;
    return { kind: o.kind, x: m.position.x, y: m.position.y, z: m.position.z,
             rot: Math.round(m.rotation.y * 180 / Math.PI), tilt: Math.round(m.rotation.x * 180 / Math.PI),
             scale: m.scale.x, useTex: o.useTex, color: o.color };
  }
  function removeObject(i) {
    const o = buildObjects[i]; if (!o) return;
    buildRoot.remove(o.mesh); o.mesh.geometry.dispose();
    buildObjects.splice(i, 1);
    if (!buildObjects.length && mesh) mesh.visible = true;
  }
  function listObjects() { return buildObjects.map((o, i) => ({ i, kind: o.kind })); }
  function refreshSkins() { buildObjects.forEach((o, i) => skinObject(i)); }

  /** Render the scene once and place it on the canvas as a new layer. */
  function snapshotToLayer() {
    if (!renderer) { U.toast('Start the 3D preview or add an object first'); return; }
    renderer.render(scene, camera);
    const src = renderer.domElement;
    if (!D.doc.open) { D.newDocument(src.width, src.height, 'transparent', '3d-render'); GF.ui.onDocumentOpened(); }
    else GF.history.push(D.doc, '3D snapshot');
    const L = D.addLayer('3D render');
    const c = GF.util.ctx2d(L.canvas);
    const s = Math.min(D.doc.width / src.width, D.doc.height / src.height);
    c.imageSmoothingQuality = 'high';
    c.drawImage(src, 0, 0, src.width * s, src.height * s);
    GF.ui.refreshLayers();
    U.toast('Render placed on a new layer');
  }

  async function exportGLB() {
    if (!buildObjects.length) { U.toast('Add some objects first'); return; }
    try {
      const { GLTFExporter } = await import('three/addons/exporters/GLTFExporter.js');
      new GLTFExporter().parse(buildRoot,
        g => { U.downloadBlob(new Blob([g], { type: 'model/gltf-binary' }), (D.doc.name || 'asset') + '.glb'); U.toast('GLB exported — drop it into any engine'); },
        e => U.toast('Export failed: ' + e.message),
        { binary: true });
    } catch (e) { U.toast('Exporter needs an internet connection once'); }
  }

  return { start, refresh, setEnvironment, clearEnvironment, loadModel,
           addPrimitive, setObject, getObject, removeObject, listObjects,
           refreshSkins, snapshotToLayer, exportGLB };
})();
