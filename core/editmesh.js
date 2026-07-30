/* ============================================================
   PixelTriks — editmesh.js  (GF.editmesh)
   Blender-style mesh EDIT MODE for the 3D asset studio.

   Tab enters edit mode on the selected object. A primitive's
   triangulated BufferGeometry is welded into a clean editable
   model — verts + n-gon faces (quads recovered where coplanar) +
   derived edges. Vertex / edge / face sub-modes (1/2/3). Click to
   select (Shift = toggle). Modal transforms: G grab, R rotate,
   S scale (X/Y/Z to constrain, click/Enter confirm, Esc cancel).
   Operators: E extrude (faces), Subdivide. Everything is undoable
   through the scene's own history stack (GF.scene3d.hist).

   Rendering: overlays live in a Group pinned to the object's world
   matrix and drawn on top (depthTest off). The scene's continuous
   rAF loop paints them — no explicit render calls needed.
   ============================================================ */
'use strict';
window.GF = window.GF || {};

GF.editmesh = (function () {
  const U = GF.util;

  let THREE = null, refs = null;
  let active = false;
  let objId = null, node = null;            // the edited object + its Mesh node

  /* editable model — LOCAL space */
  let verts = [];                           // [THREE.Vector3]
  let faces = [];                           // [[vIdx,...]] convex n-gons (mostly quads/tris)
  let edges = new Map();                    // 'a_b'(a<b) -> {a,b}

  /* material zones — per-face material assignment ("textures in desired zones") */
  let zones = [];                           // [{name, color, roughness, metalness, tex}]  zone 0 = Base
  let faceZone = [];                        // parallel to faces: index into zones
  let activeZone = 0;                       // which zone the UI edits / assigns to
  const zoneTexCache = new Map();           // preset id -> THREE.CanvasTexture

  let selMode = 'vertex';                   // vertex | edge | face
  let selV = new Set(), selE = new Set(), selF = new Set();

  /* overlays */
  let grp = null, wire = null, pts = null, selWire = null, faceHi = null;
  let dispMap = [];                         // display-vertex slot -> vert index
  let triFace = [];                         // display triangle -> face index

  /* modal transform */
  let modal = null;                         // {kind, affected, orig, centroid, plane, startPt, axis, startMouse}
  let mouse = { x: 0, y: 0 };
  let keyHandler = null;

  const COL_BASE = 0x9aa4b2, COL_SEL = 0xe8a33d, COL_WIRE = 0x2a3340;

  /* ---------------- helpers ---------------- */
  function ek(a, b) { return a < b ? a + '_' + b : b + '_' + a; }
  function meshNode(o) {
    if (!o || !o.node) return null;
    if (o.node.isMesh && o.node.geometry) return o.node;
    let found = null;
    o.node.traverse(n => { if (!found && n.isMesh && n.geometry) found = n; });
    return found;
  }

  /* ---------------- build editable model from a triangulated geometry ---------------- */
  function fromGeometry(g) {
    const pos = g.attributes.position;
    const idx = g.index;
    const triCount = idx ? idx.count / 3 : pos.count / 3;
    const key = new Map();                  // welded-position key -> vert idx
    const V = [];
    const P = 1e4;                          // weld precision (round to 1e-4)
    const vid = (x, y, z) => {
      const k = Math.round(x * P) + ',' + Math.round(y * P) + ',' + Math.round(z * P);
      let i = key.get(k);
      if (i === undefined) { i = V.length; V.push(new THREE.Vector3(x, y, z)); key.set(k, i); }
      return i;
    };
    const get = i => idx ? idx.getX(i) : i;
    const tris = [];
    for (let t = 0; t < triCount; t++) {
      const a = get(t * 3), b = get(t * 3 + 1), c = get(t * 3 + 2);
      const ia = vid(pos.getX(a), pos.getY(a), pos.getZ(a));
      const ib = vid(pos.getX(b), pos.getY(b), pos.getZ(b));
      const ic = vid(pos.getX(c), pos.getY(c), pos.getZ(c));
      if (ia !== ib && ib !== ic && ia !== ic) tris.push([ia, ib, ic]);
    }
    verts = V;
    faces = mergeQuads(tris);
    recomputeEdges();
  }

  /* Recover quads: merge two triangles sharing an edge when their normals are
     nearly equal (coplanar) and the resulting quad stays convex. Greedy — good
     enough to turn a boxy primitive back into clean quads while leaving curved
     surfaces triangulated. */
  function triNormal(t) {
    const a = verts[t[0]], b = verts[t[1]], c = verts[t[2]];
    return b.clone().sub(a).cross(c.clone().sub(a)).normalize();
  }
  function mergeQuads(tris) {
    const byEdge = new Map();               // edgeKey -> [triIndex,...]
    tris.forEach((t, ti) => {
      for (let k = 0; k < 3; k++) {
        const key = ek(t[k], t[(k + 1) % 3]);
        (byEdge.get(key) || byEdge.set(key, []).get(key)).push(ti);
      }
    });
    const used = new Array(tris.length).fill(false);
    const out = [];
    const normals = tris.map(triNormal);
    tris.forEach((t, ti) => {
      if (used[ti]) return;
      let merged = null;
      for (let k = 0; k < 3 && !merged; k++) {
        const a = t[k], b = t[(k + 1) % 3];
        const pair = byEdge.get(ek(a, b)) || [];
        for (const tj of pair) {
          if (tj === ti || used[tj]) continue;
          if (normals[ti].dot(normals[tj]) < 0.999) continue;   // not coplanar
          const t2 = tris[tj];
          const opp = t2.find(v => v !== a && v !== b);          // 4th corner
          if (opp === undefined) continue;
          const c = t[(k + 2) % 3];                              // this tri's free corner
          const quad = [a, c, b, opp];                           // a -> c -> b -> opp
          if (isConvex(quad)) { merged = quad; used[ti] = used[tj] = true; break; }
        }
      }
      if (merged) out.push(merged);
      else { used[ti] = true; out.push(t.slice()); }
    });
    return out;
  }
  function isConvex(q) {
    const n = triNormal([q[0], q[1], q[2]]);
    let sign = 0;
    for (let i = 0; i < 4; i++) {
      const p0 = verts[q[i]], p1 = verts[q[(i + 1) % 4]], p2 = verts[q[(i + 2) % 4]];
      const cr = p1.clone().sub(p0).cross(p2.clone().sub(p1)).dot(n);
      const s = Math.sign(cr);
      if (s !== 0) { if (sign === 0) sign = s; else if (s !== sign) return false; }
    }
    return true;
  }
  function recomputeEdges() {
    edges = new Map();
    faces.forEach(f => {
      for (let k = 0; k < f.length; k++) {
        const a = f[k], b = f[(k + 1) % f.length];
        const key = ek(a, b);
        if (!edges.has(key)) edges.set(key, { a: Math.min(a, b), b: Math.max(a, b) });
      }
    });
  }
  function faceNormal(f) {
    const n = new THREE.Vector3(), a = verts[f[0]];
    for (let k = 1; k < f.length - 1; k++)
      n.add(verts[f[k]].clone().sub(a).cross(verts[f[k + 1]].clone().sub(a)));
    return n.normalize();
  }
  function faceCentroid(f) {
    const c = new THREE.Vector3(); f.forEach(v => c.add(verts[v])); return c.multiplyScalar(1 / f.length);
  }

  /* ---------------- material zones ---------------- */
  function syncZoneLen() {                    // guarantee faceZone aligns with faces (crash-proof)
    if (faceZone.length > faces.length) faceZone.length = faces.length;
    while (faceZone.length < faces.length) faceZone.push(0);
    for (let i = 0; i < faceZone.length; i++) if (!(faceZone[i] >= 0 && faceZone[i] < zones.length)) faceZone[i] = 0;
    if (activeZone >= zones.length) activeZone = 0;
  }
  function zoneTexture(z) {
    if (!z || !z.tex || !GF.texture) return null;
    let t = zoneTexCache.get(z.tex);
    if (!t) { const m = GF.texture.generateMaterial(z.tex, 256, 256); if (!m) return null; t = new THREE.CanvasTexture(m.color); t.wrapS = t.wrapT = THREE.RepeatWrapping; zoneTexCache.set(z.tex, t); }
    return t;
  }
  function zoneMaterial(z) {
    const m = new THREE.MeshStandardMaterial({ color: new THREE.Color(z.color || '#cccccc'), roughness: z.roughness == null ? 0.7 : z.roughness, metalness: z.metalness == null ? 0.05 : z.metalness, side: THREE.DoubleSide });
    const t = zoneTexture(z); if (t) m.map = t;
    return m;
  }
  function applyZoneMaterials() {
    if (!node) return;
    if (Array.isArray(node.material)) node.material.forEach(m => m && m.dispose());
    else if (node.material) node.material.dispose();
    node.material = zones.map(zoneMaterial);
  }

  /* ---------------- display geometry + overlays ---------------- */
  function buildDisplayGeometry() {
    syncZoneLen();
    dispMap = []; triFace = [];
    const tris = [];                          // {v:[i,i,i], face, zone}
    faces.forEach((f, fi) => { const z = faceZone[fi] || 0; for (let k = 1; k < f.length - 1; k++) tris.push({ v: [f[0], f[k], f[k + 1]], face: fi, zone: z }); });
    tris.sort((a, b) => a.zone - b.zone);      // contiguous runs per zone -> geometry groups
    const positions = [];
    tris.forEach(tri => { tri.v.forEach(v => { positions.push(verts[v].x, verts[v].y, verts[v].z); dispMap.push(v); }); triFace.push(tri.face); });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geo.computeVertexNormals();             // non-indexed -> flat, faceted look
    geo.computeBoundingSphere();
    let i = 0; while (i < tris.length) { let j = i; const z = tris[i].zone; while (j < tris.length && tris[j].zone === z) j++; geo.addGroup(i * 3, (j - i) * 3, z); i = j; }
    return geo;
  }
  function overlayMat(Ctor, opts) {
    const m = new Ctor(Object.assign({ depthTest: false, depthWrite: false, transparent: true }, opts));
    return m;
  }
  function buildOverlays() {
    disposeOverlays();
    grp = new THREE.Group();
    grp.matrixAutoUpdate = false;
    node.updateMatrixWorld(true);
    grp.matrix.copy(node.matrixWorld);
    grp.renderOrder = 999;

    // dim wireframe of every edge
    wire = new THREE.LineSegments(edgeGeometry([...edges.values()]), overlayMat(THREE.LineBasicMaterial, { color: COL_WIRE, opacity: 0.9 }));
    wire.renderOrder = 999;

    // all vertices as a point cloud with per-vertex colour
    const pg = new THREE.BufferGeometry();
    pg.setAttribute('position', new THREE.Float32BufferAttribute(vertPositions(), 3));
    pg.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(verts.length * 3), 3));
    pts = new THREE.Points(pg, overlayMat(THREE.PointsMaterial, { size: 8, sizeAttenuation: false, vertexColors: true }));
    pts.renderOrder = 1000;

    selWire = new THREE.LineSegments(new THREE.BufferGeometry(), overlayMat(THREE.LineBasicMaterial, { color: COL_SEL, opacity: 1 }));
    selWire.renderOrder = 1001;
    faceHi = new THREE.Mesh(new THREE.BufferGeometry(), overlayMat(THREE.MeshBasicMaterial, { color: COL_SEL, opacity: 0.28, side: THREE.DoubleSide }));
    faceHi.renderOrder = 998;

    grp.add(wire); grp.add(faceHi); grp.add(selWire); grp.add(pts);
    refs.scene.add(grp);
    refreshSelectionVisual();
  }
  function vertPositions() { const a = []; verts.forEach(v => a.push(v.x, v.y, v.z)); return a; }
  function edgeGeometry(list) {
    const p = [];
    list.forEach(e => { p.push(verts[e.a].x, verts[e.a].y, verts[e.a].z, verts[e.b].x, verts[e.b].y, verts[e.b].z); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); return g;
  }
  function faceGeometry(list) {
    const p = [];
    list.forEach(fi => { const f = faces[fi]; for (let k = 1; k < f.length - 1; k++)[f[0], f[k], f[k + 1]].forEach(v => p.push(verts[v].x, verts[v].y, verts[v].z)); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); if (p.length) g.computeVertexNormals(); return g;
  }
  function disposeOverlays() {
    if (grp && refs) refs.scene.remove(grp);
    [wire, pts, selWire, faceHi].forEach(o => { if (o) { o.geometry.dispose(); o.material.dispose(); } });
    grp = wire = pts = selWire = faceHi = null;
  }

  /* fast path — only vertex positions moved (modal transforms) */
  function refreshPositions() {
    const gp = node.geometry.attributes.position;
    for (let i = 0; i < dispMap.length; i++) { const v = verts[dispMap[i]]; gp.setXYZ(i, v.x, v.y, v.z); }
    gp.needsUpdate = true; node.geometry.computeVertexNormals();
    const pp = pts.geometry.attributes.position;
    for (let i = 0; i < verts.length; i++) pp.setXYZ(i, verts[i].x, verts[i].y, verts[i].z);
    pp.needsUpdate = true;
    wire.geometry.dispose(); wire.geometry = edgeGeometry([...edges.values()]);
    refreshSelectionVisual();
  }
  /* full path — topology changed */
  function rebuildAll() {
    const oldGeo = node.geometry; node.geometry = buildDisplayGeometry(); if (oldGeo) oldGeo.dispose();
    applyZoneMaterials();
    buildOverlays();
    setStatus();
  }
  function refreshSelectionVisual() {
    if (!pts) return;
    const col = pts.geometry.attributes.color;
    const base = new THREE.Color(COL_BASE), sel = new THREE.Color(COL_SEL);
    for (let i = 0; i < verts.length; i++) { const c = selV.has(i) ? sel : base; col.setXYZ(i, c.r, c.g, c.b); }
    col.needsUpdate = true;
    pts.material.size = selMode === 'vertex' ? 10 : 6;
    selWire.geometry.dispose(); selWire.geometry = edgeGeometry([...selE].map(k => edges.get(k)).filter(Boolean));
    selWire.visible = selMode === 'edge';
    faceHi.geometry.dispose(); faceHi.geometry = faceGeometry([...selF]);
    faceHi.visible = selMode === 'face';
  }

  /* ---------------- picking (screen space) ---------------- */
  function project(v) {
    const rect = refs.screenRect(); if (!rect) return null;
    const w = v.clone().applyMatrix4(node.matrixWorld).project(refs.camera);
    if (w.z > 1) return null;               // behind camera
    return { x: rect.left + (w.x * 0.5 + 0.5) * rect.width, y: rect.top + (-w.y * 0.5 + 0.5) * rect.height };
  }
  function pickVertex(mx, my) {
    let best = -1, bd = 14 * 14;
    for (let i = 0; i < verts.length; i++) { const s = project(verts[i]); if (!s) continue; const d = (s.x - mx) ** 2 + (s.y - my) ** 2; if (d < bd) { bd = d; best = i; } }
    return best;
  }
  function pickEdge(mx, my) {
    let best = null, bd = 10 * 10;
    edges.forEach((e, key) => {
      const A = project(verts[e.a]), B = project(verts[e.b]); if (!A || !B) return;
      const d = segDist(mx, my, A.x, A.y, B.x, B.y); if (d < bd) { bd = d; best = key; }
    });
    return best;
  }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0; t = Math.max(0, Math.min(1, t));
    const cx = x1 + t * dx, cy = y1 + t * dy; return (px - cx) ** 2 + (py - cy) ** 2;
  }
  function pickFace(e) {
    const rect = refs.screenRect(); if (!rect) return -1;
    const ndc = new THREE.Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, refs.camera);
    const hit = ray.intersectObject(node, false)[0];
    return hit ? triFace[hit.faceIndex] : -1;
  }

  function clickSelect(e, add) {
    if (!add) { selV.clear(); selE.clear(); selF.clear(); }
    if (selMode === 'vertex') { const i = pickVertex(e.clientX, e.clientY); if (i >= 0) flipSel(selV, i); }
    else if (selMode === 'edge') { const k = pickEdge(e.clientX, e.clientY); if (k) flipSel(selE, k); }
    else { const f = pickFace(e); if (f >= 0) flipSel(selF, f); }
    refreshSelectionVisual(); setStatus();
  }
  function flipSel(set, v) { if (set.has(v)) set.delete(v); else set.add(v); }
  function selectAll() {
    if (!active) return;
    if (selMode === 'vertex') selV = new Set(verts.map((_, i) => i));
    else if (selMode === 'edge') selE = new Set(edges.keys());
    else selF = new Set(faces.map((_, i) => i));
    refreshSelectionVisual(); setStatus();
  }
  function selectNone() { if (!active) return; selV.clear(); selE.clear(); selF.clear(); refreshSelectionVisual(); setStatus(); }
  /* deterministic selection (automation / scripting): indices are vertex/face
     numbers, or edge keys ('a_b') in edge mode. */
  function selectElements(mode, indices, additive) {
    if (!active) return;
    if (mode) selMode = mode;
    if (!additive) { selV.clear(); selE.clear(); selF.clear(); }
    const set = selMode === 'vertex' ? selV : selMode === 'edge' ? selE : selF;
    (indices || []).forEach(i => set.add(i));
    refreshSelectionVisual(); setStatus();
  }

  function affectedVerts() {
    const s = new Set();
    if (selMode === 'vertex') selV.forEach(v => s.add(v));
    else if (selMode === 'edge') selE.forEach(k => { const e = edges.get(k); if (e) { s.add(e.a); s.add(e.b); } });
    else selF.forEach(f => faces[f].forEach(v => s.add(v)));
    return [...s];
  }

  /* ---------------- undo snapshots ---------------- */
  function snapshot() {
    return { verts: verts.map(v => v.clone()), faces: faces.map(f => f.slice()), selMode,
      selV: new Set(selV), selE: new Set(selE), selF: new Set(selF),
      faceZone: faceZone.slice(), zones: zones.map(z => Object.assign({}, z)), activeZone };
  }
  function restore(s) {
    verts = s.verts.map(v => v.clone()); faces = s.faces.map(f => f.slice());
    selMode = s.selMode; selV = new Set(s.selV); selE = new Set(s.selE); selF = new Set(s.selF);
    faceZone = (s.faceZone || []).slice(); zones = (s.zones || []).map(z => Object.assign({}, z)); activeZone = s.activeZone || 0;
    recomputeEdges(); if (active) rebuildAll();
  }
  function commit(label, before) {
    syncZoneLen(); recomputeEdges(); rebuildAll();
    const after = snapshot();
    refs.hist.push('mesh: ' + label, () => restore(before), () => restore(after));
  }
  function op(label, fn) { const before = snapshot(); fn(); commit(label, before); }

  /* ---------------- modal transforms (G / R / S) ---------------- */
  function planePoint(mx, my, plane) {
    const rect = refs.screenRect(); if (!rect) return null;
    const ndc = new THREE.Vector2(((mx - rect.left) / rect.width) * 2 - 1, -((my - rect.top) / rect.height) * 2 + 1);
    const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, refs.camera);
    const out = new THREE.Vector3(); return ray.ray.intersectPlane(plane, out) ? out : null;
  }
  function beginModal(kind, forcedAxisLocal) {
    if (!active) { U.toast('Enter edit mode (Tab) first'); return; }
    const aff = affectedVerts();
    if (!aff.length) { U.toast('Select something first'); return; }
    cancelModal();                          // never stack
    refs.setControlsEnabled(false);         // suppress orbit while transforming
    const centroidLocal = new THREE.Vector3(); aff.forEach(v => centroidLocal.add(verts[v])); centroidLocal.multiplyScalar(1 / aff.length);
    const centroidWorld = centroidLocal.clone().applyMatrix4(node.matrixWorld);
    const nrm = refs.camera.getWorldDirection(new THREE.Vector3());
    const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(nrm, centroidWorld);
    modal = {
      kind, affected: aff, orig: aff.map(v => verts[v].clone()),
      centroidLocal, plane, before: snapshot(),
      startPt: planePoint(mouse.x, mouse.y, plane), startMouse: { x: mouse.x, y: mouse.y },
      axis: forcedAxisLocal || null,        // local-space unit vector or null (free)
    };
    setStatus();
  }
  function updateModal() {
    if (!modal) return;
    const m = modal, aff = m.affected;
    if (m.kind === 'grab') {
      const now = planePoint(mouse.x, mouse.y, m.plane); if (!now || !m.startPt) return;
      let wDelta = now.clone().sub(m.startPt);
      const inv = node.matrixWorld.clone().invert();
      let lDelta = m.startPt.clone().add(wDelta).applyMatrix4(inv).sub(m.startPt.clone().applyMatrix4(inv));
      if (m.axis) lDelta = m.axis.clone().multiplyScalar(lDelta.dot(m.axis));
      aff.forEach((v, i) => verts[v].copy(m.orig[i]).add(lDelta));
    } else if (m.kind === 'rotate') {
      const ang = (mouse.x - m.startMouse.x) * 0.01;
      const axisL = m.axis ? m.axis.clone() : refs.camera.getWorldDirection(new THREE.Vector3())
        .applyMatrix4(new THREE.Matrix4().extractRotation(node.matrixWorld).invert()).normalize();
      const q = new THREE.Quaternion().setFromAxisAngle(axisL, ang);
      aff.forEach((v, i) => verts[v].copy(m.orig[i]).sub(m.centroidLocal).applyQuaternion(q).add(m.centroidLocal));
    } else if (m.kind === 'scale') {
      const f = Math.exp((m.startMouse.y - mouse.y) * 0.006);
      const s = m.axis ? new THREE.Vector3(m.axis.x ? f : 1, m.axis.y ? f : 1, m.axis.z ? f : 1) : new THREE.Vector3(f, f, f);
      aff.forEach((v, i) => verts[v].copy(m.orig[i]).sub(m.centroidLocal).multiply(s).add(m.centroidLocal));
    }
    refreshPositions();
  }
  function confirmModal() {
    if (!modal) return; const m = modal; modal = null; refs.setControlsEnabled(true);
    commit(m.kind, m.before); setStatus();
  }
  function cancelModal() {
    if (!modal) return; const m = modal; modal = null; refs.setControlsEnabled(true);
    m.affected.forEach((v, i) => verts[v].copy(m.orig[i])); refreshPositions(); setStatus();
  }
  function setAxis(ax) {
    if (!modal) return;
    const world = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) }[ax];
    const local = world.applyMatrix4(new THREE.Matrix4().extractRotation(node.matrixWorld).invert()).normalize();
    // toggle off if same axis pressed twice
    modal.axis = (modal.axis && modal.axis.equals(local)) ? null : local;
    modal.affected.forEach((v, i) => verts[v].copy(modal.orig[i]));
    updateModal();
  }

  /* ---------------- operators ---------------- */
  function extrude() {
    if (!active) { U.toast('Enter edit mode (Tab) first'); return; }
    if (selMode !== 'face') { selMode = 'face'; }
    if (!selF.size) { U.toast('Select face(s) to extrude'); return; }
    const F = [...selF];
    op('extrude', () => {
      const edgeUse = new Map();            // boundary detection within the selected region
      F.forEach(fi => { const f = faces[fi]; for (let k = 0; k < f.length; k++) { const key = ek(f[k], f[(k + 1) % f.length]); edgeUse.set(key, (edgeUse.get(key) || 0) + 1); } });
      const used = new Set(); F.forEach(fi => faces[fi].forEach(v => used.add(v)));
      const dup = new Map(); used.forEach(v => { dup.set(v, verts.length); verts.push(verts[v].clone()); });
      // side walls along boundary edges (used by exactly one selected face)
      F.forEach(fi => { const f = faces[fi]; for (let k = 0; k < f.length; k++) { const a = f[k], b = f[(k + 1) % f.length]; if (edgeUse.get(ek(a, b)) === 1) { faces.push([a, b, dup.get(b), dup.get(a)]); faceZone.push(faceZone[fi] || 0); } } });
      // lift the selected faces onto the duplicated ring
      F.forEach(fi => { faces[fi] = faces[fi].map(v => dup.get(v)); });
      // keep the top faces selected so the follow-up grab moves them
      selV.clear(); selE.clear();
    });
    // auto-grab along the region normal (Blender's extrude-then-move)
    const nWorld = new THREE.Vector3(); F.forEach(fi => nWorld.add(faceNormal(faces[fi]))); nWorld.normalize();
    beginModal('grab', nWorld);
  }
  function subdivide() {
    if (!active) { U.toast('Enter edit mode (Tab) first'); return; }
    const targets = selF.size ? [...selF] : faces.map((_, i) => i);
    op('subdivide', () => {
      const mid = new Map();
      const edgeMid = (a, b) => { const key = ek(a, b); let m = mid.get(key); if (m === undefined) { m = verts.length; verts.push(verts[a].clone().add(verts[b]).multiplyScalar(0.5)); mid.set(key, m); } return m; };
      const set = new Set(targets), keep = [], keepZ = [], add = [], addZ = [];
      faces.forEach((f, fi) => {
        if (!set.has(fi)) { keep.push(f); keepZ.push(faceZone[fi] || 0); return; }
        const c = verts.length; verts.push(faceCentroid(f));
        const n = f.length;
        for (let k = 0; k < n; k++) { const prev = f[(k - 1 + n) % n], a = f[k], b = f[(k + 1) % n]; add.push([a, edgeMid(a, b), c, edgeMid(prev, a)]); addZ.push(faceZone[fi] || 0); }
      });
      faces = keep.concat(add); faceZone = keepZ.concat(addZ);
      selV.clear(); selE.clear(); selF.clear();
    });
  }
  /* ---- shared topology helpers ---- */
  function dedupeConsecutive(f) {
    const out = []; f.forEach(v => { if (out[out.length - 1] !== v) out.push(v); });
    if (out.length > 1 && out[0] === out[out.length - 1]) out.pop();
    return out;
  }
  function areAdjacent(f, a, b) { const n = f.length; for (let i = 0; i < n; i++) { const x = f[i], y = f[(i + 1) % n]; if ((x === a && y === b) || (x === b && y === a)) return true; } return false; }
  function facesOnEdge(a, b) { const out = []; faces.forEach((f, i) => { if (areAdjacent(f, a, b)) out.push(i); }); return out; }
  function oppositeEdge(f, edge) { for (let i = 0; i < 4; i++) { const x = f[i], y = f[(i + 1) % 4]; if ((x === edge[0] && y === edge[1]) || (x === edge[1] && y === edge[0])) return [f[(i + 2) % 4], f[(i + 3) % 4]]; } return null; }
  function orientQuad(f, entry) { for (let i = 0; i < 4; i++) { const x = f[i], y = f[(i + 1) % 4]; if ((x === entry[0] && y === entry[1]) || (x === entry[1] && y === entry[0])) return [f[i], f[(i + 1) % 4], f[(i + 2) % 4], f[(i + 3) % 4]]; } return null; }
  function rotateToEdge(f, x, y) { const n = f.length; for (let i = 0; i < n; i++) { if (f[i] === x && f[(i + 1) % n] === y) { const out = []; for (let k = 0; k < n; k++) out.push(f[(i + 1 + k) % n]); return out; } } return null; }

  /* ---- Inset: shrink each selected face inward, ringed by new quads ---- */
  function inset(amount) {
    if (!active) { U.toast('Enter edit mode (Tab) first'); return; }
    if (selMode !== 'face') selMode = 'face';
    if (!selF.size) { U.toast('Select face(s) to inset'); return; }
    amount = amount == null ? 0.28 : amount;
    const F = [...selF];
    op('inset', () => {
      const newSel = new Set();
      F.forEach(fi => {
        const f = faces[fi], c = faceCentroid(f);
        const inner = f.map(v => { const nv = verts.length; verts.push(verts[v].clone().lerp(c, amount)); return nv; });
        for (let k = 0; k < f.length; k++) { faces.push([f[k], f[(k + 1) % f.length], inner[(k + 1) % f.length], inner[k]]); faceZone.push(faceZone[fi] || 0); }
        faces[fi] = inner; newSel.add(fi);
      });
      selF = newSel; selV.clear(); selE.clear();
    });
  }

  /* ---- Merge: collapse selected vertices to their shared centroid ---- */
  function mergeVerts() {
    if (!active) { U.toast('Enter edit mode (Tab) first'); return; }
    const vids = selMode === 'vertex' ? [...selV] : affectedVerts();
    if (vids.length < 2) { U.toast('Select 2+ vertices to merge'); return; }
    op('merge', () => {
      const c = new THREE.Vector3(); vids.forEach(v => c.add(verts[v])); c.multiplyScalar(1 / vids.length);
      const target = vids[0]; verts[target].copy(c);
      const rm = new Set(vids.slice(1));
      const nf = [], nz = [];
      faces.forEach((f, fi) => { const d = dedupeConsecutive(f.map(v => rm.has(v) ? target : v)); if (d.length >= 3) { nf.push(d); nz.push(faceZone[fi] || 0); } });
      faces = nf; faceZone = nz;
      pruneVerts(); selV.clear(); selE.clear(); selF.clear();
    });
  }

  /* ---- Dissolve: remove elements, keeping the surface ---- */
  function dissolve() {
    if (!active) { U.toast('Enter edit mode (Tab) first'); return; }
    if (selMode === 'edge' && selE.size) op('dissolve edges', () => { [...selE].forEach(k => { const e = edges.get(k); if (e) dissolveEdge(e.a, e.b); }); selE.clear(); });
    else if (selMode === 'face' && selF.size >= 2) op('dissolve faces', () => { dissolveFaces([...selF]); selF.clear(); });
    else U.toast('Select edges (or 2+ faces) to dissolve');
  }
  function dissolveEdge(a, b) {
    const idxs = facesOnEdge(a, b); if (idxs.length !== 2) return;   // boundary/non-manifold — skip
    const f1 = faces[idxs[0]], f2 = faces[idxs[1]];
    const s1 = rotateToEdge(f1, a, b) || rotateToEdge(f1, b, a);
    const s2 = rotateToEdge(f2, b, a) || rotateToEdge(f2, a, b);
    if (!s1 || !s2) return;
    const merged = dedupeConsecutive(s1.concat(s2.slice(1, s2.length - 1)));
    if (merged.length < 3) return;
    faces[idxs[0]] = merged; faces.splice(idxs[1], 1); faceZone.splice(idxs[1], 1);
  }
  function dissolveFaces(list) {
    // merge a connected set of faces into one n-gon by dissolving their shared edges
    const set = new Set(list);
    const shared = new Map();      // edgeKey -> count within the set
    list.forEach(fi => { const f = faces[fi]; for (let k = 0; k < f.length; k++) { const key = ek(f[k], f[(k + 1) % f.length]); shared.set(key, (shared.get(key) || 0) + 1); } });
    [...shared.entries()].filter(([, n]) => n === 2).forEach(([key]) => { const [a, b] = key.split('_').map(Number); dissolveEdge(a, b); });
  }

  /* ---- Loop cut: insert an edge loop across a ring of quads ---- */
  function loopcut(startKey) {
    if (!active) { U.toast('Enter edit mode (Tab) first'); return; }
    const key = startKey || (selMode === 'edge' && selE.size ? [...selE][0] : null);
    const e0 = key ? edges.get(key) : null;
    if (!e0) { U.toast('Select an edge, then loop cut'); return; }
    op('loop cut', () => {
      let curFace = facesOnEdge(e0.a, e0.b).find(i => faces[i].length === 4);
      if (curFace === undefined) { U.toast('Loop cut needs a strip of quads'); return; }
      const ring = [], seen = new Set(); let entry = [e0.a, e0.b], guard = 0;
      while (curFace !== undefined && guard++ < 100000) {
        const f = faces[curFace];
        if (f.length !== 4 || seen.has(curFace)) break;
        seen.add(curFace);
        const exit = oppositeEdge(f, entry); if (!exit) break;
        ring.push({ face: curFace, entry: entry.slice(), exit });
        const nb = facesOnEdge(exit[0], exit[1]).find(i => i !== curFace && faces[i].length === 4);
        if (nb === undefined) break;                 // open strip — stop
        if (nb === ring[0].face) break;              // closed loop
        curFace = nb; entry = exit;
      }
      if (!ring.length) { U.toast('No loop from that edge'); return; }
      const midOf = new Map();
      const mid = (a, b) => { const k = ek(a, b); let m = midOf.get(k); if (m === undefined) { m = verts.length; verts.push(verts[a].clone().add(verts[b]).multiplyScalar(0.5)); midOf.set(k, m); } return m; };
      ring.forEach(seg => {
        const q = orientQuad(faces[seg.face], seg.entry); if (!q) return;
        const [q0, q1, q2, q3] = q;
        const me = mid(q0, q1), mx = mid(q2, q3);
        const z = faceZone[seg.face] || 0;
        faces[seg.face] = [q0, me, mx, q3];
        faces.push([me, q1, q2, mx]); faceZone.push(z);
      });
      selV.clear(); selE.clear(); selF.clear();
    });
  }

  /* ---- Bevel / chamfer: shrink every face, bridge every edge, cap every
     corner. Always produces valid closed topology (verified by Euler V-E+F=2).
     `amount` 0..0.49 = how far each face corner pulls toward its centre. ---- */
  function polyNormalPts(pts) { const n = new THREE.Vector3(), a = pts[0]; for (let k = 1; k < pts.length - 1; k++) n.add(pts[k].clone().sub(a).cross(pts[k + 1].clone().sub(a))); return n.lengthSq() < 1e-12 ? n.set(0, 1, 0) : n.normalize(); }
  function vertexNormalOf(v) { const n = new THREE.Vector3(); faces.forEach(f => { if (f.includes(v)) n.add(faceNormal(f)); }); return n.lengthSq() < 1e-12 ? n.set(0, 1, 0) : n.normalize(); }
  function weldFaces(NV, outFaces, outZones) {
    const P = 1e4, key = new Map(), map = new Array(NV.length), V2 = [];
    NV.forEach((p, i) => { const k = Math.round(p.x * P) + ',' + Math.round(p.y * P) + ',' + Math.round(p.z * P); let j = key.get(k); if (j === undefined) { j = V2.length; V2.push(p); key.set(k, j); } map[i] = j; });
    const F2 = [], Z2 = [];
    outFaces.forEach((f, i) => { const d = dedupeConsecutive(f.map(v => map[v])); if (d.length >= 3) { F2.push(d); Z2.push(outZones ? (outZones[i] || 0) : 0); } });
    return { V: V2, F: F2, Z: Z2 };
  }
  function bevel(amount) {
    if (!active) { U.toast('Enter edit mode (Tab) first'); return; }
    amount = amount == null ? 0.18 : Math.max(0.02, Math.min(0.49, amount));
    op('bevel', () => {
      const efaces = new Map();
      faces.forEach((f, fi) => { for (let k = 0; k < f.length; k++) { const key = ek(f[k], f[(k + 1) % f.length]); (efaces.get(key) || efaces.set(key, []).get(key)).push(fi); } });
      const cvi = new Map(), NV = [];
      faces.forEach((f, fi) => { const c = faceCentroid(f); f.forEach((v, slot) => { cvi.set(fi + ':' + slot, NV.length); NV.push(verts[v].clone().lerp(c, amount)); }); });
      const slotIn = (fi, val) => faces[fi].indexOf(val);
      const out = [], outZ = [];
      faces.forEach((f, fi) => { out.push(f.map((v, slot) => cvi.get(fi + ':' + slot))); outZ.push(faceZone[fi] || 0); });   // shrunk faces keep their zone
      efaces.forEach((fl, key) => {                                                        // edge bridges -> base zone
        if (fl.length !== 2) return;
        const [a, b] = key.split('_').map(Number), [f1, f2] = fl;
        const q = [cvi.get(f1 + ':' + slotIn(f1, a)), cvi.get(f1 + ':' + slotIn(f1, b)), cvi.get(f2 + ':' + slotIn(f2, b)), cvi.get(f2 + ':' + slotIn(f2, a))];
        const avg = faceNormal(faces[f1]).add(faceNormal(faces[f2])).normalize();
        if (polyNormalPts(q.map(i => NV[i])).dot(avg) < 0) q.reverse();
        out.push(q); outZ.push(0);
      });
      const vFaces = new Map();                                                            // corner caps
      faces.forEach((f, fi) => f.forEach((v, slot) => { (vFaces.get(v) || vFaces.set(v, []).get(v)).push({ fi, slot }); }));
      vFaces.forEach((list, v) => {
        if (list.length < 3) return;
        const nrm = vertexNormalOf(v), c = verts[v];
        const t1 = Math.abs(nrm.x) < 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
        const u = t1.clone().sub(nrm.clone().multiplyScalar(t1.dot(nrm))).normalize(), w2 = nrm.clone().cross(u);
        const ranked = list.map(cc => { const idx = cvi.get(cc.fi + ':' + cc.slot), d = NV[idx].clone().sub(c); return { idx, ang: Math.atan2(d.dot(w2), d.dot(u)) }; }).sort((x, y) => x.ang - y.ang);
        let cap = ranked.map(r => r.idx);
        if (polyNormalPts(cap.map(i => NV[i])).dot(nrm) < 0) cap.reverse();
        out.push(cap); outZ.push(0);
      });
      const r = weldFaces(NV, out, outZ); verts = r.V; faces = r.F; faceZone = r.Z;
      selV.clear(); selE.clear(); selF.clear();
    });
  }

  function deleteSelection() {
    if (selMode === 'face' && selF.size) {
      op('delete faces', () => { const rm = new Set(selF); faceZone = faceZone.filter((_, i) => !rm.has(i)); faces = faces.filter((_, i) => !rm.has(i)); selF.clear(); pruneVerts(); });
    } else if (selMode === 'vertex' && selV.size) {
      op('delete verts', () => { const rm = selV; const nf = [], nz = []; faces.forEach((f, i) => { if (!f.some(v => rm.has(v))) { nf.push(f); nz.push(faceZone[i] || 0); } }); faces = nf; faceZone = nz; selV.clear(); pruneVerts(); });
    } else U.toast('Nothing to delete');
  }

  /* ---------------- material zones API ("textures in desired zones") ---------------- */
  const ZONE_PALETTE = ['#e8a33d', '#5b9fd6', '#5bbf7a', '#e5634d', '#b07de0', '#e0c24d', '#4dc3c3', '#d67ab0'];
  function assignSelection(zoneIdx) {
    if (!active) return;
    if (selMode !== 'face' || !selF.size) { U.toast('Select faces, then assign a material zone'); return; }
    const z = zoneIdx == null ? activeZone : zoneIdx;
    if (z < 0 || z >= zones.length) return;
    op('assign zone', () => { selF.forEach(fi => faceZone[fi] = z); });
    activeZone = z; setStatus();
  }
  function addZone(patch) {
    const assignSel = active && selMode === 'face' && selF.size;
    let idx;
    op('add zone', () => {
      const zn = { name: 'Zone ' + zones.length, color: ZONE_PALETTE[(zones.length - 1) % ZONE_PALETTE.length], roughness: 0.7, metalness: 0.05, tex: null };
      Object.assign(zn, patch || {}); zones.push(zn); idx = zones.length - 1;
      if (assignSel) selF.forEach(fi => faceZone[fi] = idx);
    });
    activeZone = idx; setStatus(); return idx;
  }
  function setZone(idx, patch) {
    if (idx < 0 || idx >= zones.length) return;
    op('edit zone', () => { if (patch && 'tex' in patch) zoneTexCache.delete(zones[idx].tex); Object.assign(zones[idx], patch); });
    setStatus();
  }
  function deleteZone(idx) {
    if (idx <= 0 || idx >= zones.length) { U.toast('The base zone can’t be removed'); return; }
    op('delete zone', () => { zones.splice(idx, 1); faceZone = faceZone.map(z => z === idx ? 0 : z > idx ? z - 1 : z); });
    activeZone = Math.min(activeZone, zones.length - 1); setStatus();
  }
  function selectZoneFaces(idx) {
    if (!active || idx < 0 || idx >= zones.length) return;
    selMode = 'face'; selF = new Set(); faces.forEach((f, fi) => { if ((faceZone[fi] || 0) === idx) selF.add(fi); });
    selV.clear(); selE.clear(); activeZone = idx;
    refreshSelectionVisual(); setStatus();
  }
  function setActiveZone(idx) { if (idx >= 0 && idx < zones.length) { activeZone = idx; setStatus(); } }
  function zoneList() { return zones.map((z, i) => ({ index: i, name: z.name, color: z.color, tex: z.tex || null, active: i === activeZone, faceCount: faceZone.reduce((n, fz) => n + ((fz || 0) === i ? 1 : 0), 0) })); }
  function texturePresets() { return (GF.texture && GF.texture.listPresets) ? GF.texture.listPresets().map(p => ({ id: p.id, label: p.label })) : []; }
  function pruneVerts() {
    const keep = new Set(); faces.forEach(f => f.forEach(v => keep.add(v)));
    const remap = new Map(); const nv = [];
    verts.forEach((v, i) => { if (keep.has(i)) { remap.set(i, nv.length); nv.push(v); } });
    verts = nv; faces = faces.map(f => f.map(v => remap.get(v)));
  }

  /* ---------------- selection-mode switching ---------------- */
  function setMode(m) {
    if (m === selMode || !active) { selMode = m; }
    else {
      // carry the selection across representations so switching feels continuous
      const aff = affectedVerts();
      selMode = m;
      if (m === 'vertex') { selV = new Set(aff); }
      else if (m === 'edge') { selE = new Set(); edges.forEach((e, k) => { if (aff.includes(e.a) && aff.includes(e.b)) selE.add(k); }); }
      else { selF = new Set(); faces.forEach((f, i) => { if (f.every(v => aff.includes(v))) selF.add(i); }); }
    }
    refreshSelectionVisual(); setStatus();
  }

  /* ---------------- lifecycle ---------------- */
  function enter(id) {
    if (!GF.scene3d) return false;
    refs = GF.scene3d.editRefs(); THREE = refs.THREE;
    if (!THREE || !refs.camera) { U.toast('3D engine still loading'); return false; }
    const o = GF.scene3d.byId(id != null ? id : GF.scene3d.selectedId());
    const mn = meshNode(o);
    if (!mn) { U.toast('Select an object to edit'); return false; }
    objId = o.id; node = mn;
    GF.scene3d.setInteract('orbit');        // camera orbit stays; object drag-move is off
    refs.hideObjectHandles();
    fromGeometry(node.geometry);
    // material zones: zone 0 = the object's current base material
    const bm = o.mat || {};
    zones = [{ name: 'Base', color: bm.color || '#cccccc', roughness: bm.roughness == null ? 0.7 : bm.roughness, metalness: bm.metalness == null ? 0.05 : bm.metalness, tex: null }];
    faceZone = faces.map(() => 0); activeZone = 0;
    selMode = 'vertex'; selV.clear(); selE.clear(); selF.clear();
    active = true;
    rebuildAll();
    installKeys();
    window.dispatchEvent(new CustomEvent('pt:editmode', { detail: { active: true, objId } }));
    U.toast('Edit mode — 1/2/3 verts/edges/faces · G grab · E extrude · Tab exit');
    return true;
  }
  function exit() {
    if (!active) return;
    cancelModal();
    active = false;
    disposeOverlays();
    // bake the edited geometry back onto the object node
    if (node) { const oldGeo = node.geometry; node.geometry = buildDisplayGeometry(); if (oldGeo) oldGeo.dispose(); }
    removeKeys();
    if (refs) refs.restoreSelection();      // object-level selection handles return
    window.dispatchEvent(new CustomEvent('pt:editmode', { detail: { active: false, objId } }));
    objId = null; node = null;
    if (refs && refs.emit) refs.emit();     // refresh object-level UI (scene tree, etc.)
  }
  function toggle() {
    if (active) exit();
    else enter();
  }

  function setStatus() {
    if (!GF.editmeshUI) return;
    GF.editmeshUI.status({
      active, mode: selMode,
      counts: { v: verts.length, e: edges.size, f: faces.length },
      sel: { v: selV.size, e: selE.size, f: selF.size },
      modal: modal ? modal.kind : null, axis: modal && modal.axis ? 'on' : null,
      zones: zoneList(), activeZone, presets: texturePresets(),
    });
  }

  /* ---------------- input ---------------- */
  function onPointerDown(e) {
    if (!active) return false;
    if (modal) { confirmModal(); return true; }          // click confirms a modal transform
    e._downX = e.clientX; e._downY = e.clientY;
    node._downX = e.clientX; node._downY = e.clientY;     // stash for the up-handler
    return true;
  }
  function onPointerMove(e) {
    if (!active) return false;
    mouse.x = e.clientX; mouse.y = e.clientY;
    if (modal) updateModal();
    return true;
  }
  function onPointerUp(e) {
    if (!active) return false;
    if (node && Math.abs(e.clientX - (node._downX ?? e.clientX)) + Math.abs(e.clientY - (node._downY ?? e.clientY)) < 4)
      clickSelect(e, e.shiftKey);                         // a click (not an orbit-drag) selects
    return true;
  }

  function installKeys() {
    if (keyHandler) return;
    keyHandler = e => {
      if (!active) return;
      const k = e.key.toLowerCase();
      const modalKeys = { g: 'grab', r: 'rotate', s: 'scale' };
      if (e.key === 'Escape') { if (modal) { cancelModal(); e.preventDefault(); e.stopPropagation(); } else { exit(); e.preventDefault(); } return; }
      if (e.key === 'Enter') { if (modal) { confirmModal(); e.preventDefault(); e.stopPropagation(); } return; }
      if (e.key === 'Tab') { exit(); e.preventDefault(); e.stopPropagation(); return; }
      if (modal && (k === 'x' || k === 'y' || k === 'z')) { setAxis(k); e.preventDefault(); e.stopPropagation(); return; }
      // Blender-standard chorded operators (preventDefault stops browser reload/etc.)
      if ((e.ctrlKey || e.metaKey) && !modal && k === 'r') { loopcut(); e.preventDefault(); e.stopPropagation(); return; }
      if ((e.ctrlKey || e.metaKey) && !modal && k === 'x') { dissolve(); e.preventDefault(); e.stopPropagation(); return; }
      if ((e.ctrlKey || e.metaKey) && !modal && k === 'b') { bevel(); e.preventDefault(); e.stopPropagation(); return; }
      // otherwise let the shell keep its Ctrl/Cmd shortcuts (undo ⌘Z, export ⌘S) — don't hijack
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (k === '1') { setMode('vertex'); }
      else if (k === '2') { setMode('edge'); }
      else if (k === '3') { setMode('face'); }
      else if (modalKeys[k]) { beginModal(modalKeys[k]); }
      else if (k === 'e') { extrude(); }
      else if (k === 'i') { inset(); }
      else if (k === 'm') { mergeVerts(); }
      else if (k === 'a') { selectAll(); }
      else if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelection(); }
      else return;
      e.preventDefault(); e.stopPropagation();
    };
    window.addEventListener('keydown', keyHandler, true);
  }
  function removeKeys() { if (keyHandler) { window.removeEventListener('keydown', keyHandler, true); keyHandler = null; } }

  return {
    enter, exit, toggle, isActive: () => active,
    onPointerDown, onPointerMove, onPointerUp,
    setMode, mode: () => selMode, selectAll, selectNone, selectElements,
    edgeKeys: () => [...edges.keys()],
    // operators (also reachable from the registry / buttons)
    grab: () => beginModal('grab'), rotate: () => beginModal('rotate'), scale: () => beginModal('scale'),
    extrude, subdivide, inset, bevel, merge: mergeVerts, dissolve, loopcut, deleteSelection,
    // material zones
    assignSelection, addZone, setZone, deleteZone, selectZoneFaces, setActiveZone, zoneList, texturePresets,
    activeZone: () => activeZone,
    editingId: () => objId,
    stats: () => ({ verts: verts.length, edges: edges.size, faces: faces.length, zones: zones.length, sel: { v: selV.size, e: selE.size, f: selF.size } }),
  };
})();
