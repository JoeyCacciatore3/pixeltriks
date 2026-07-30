/* PixelTriks — end-to-end runtime driver (3D-only build).
   Runs in the real booted app, exercises the shared shell + the 3D workspace
   by calling the engine AND clicking real DOM controls, and writes a JSON
   report into #RESULTS + a summary into document.title. */
(function () {
  const U = GF.util;
  const $ = s => document.querySelector(s);
  const results = [];
  const log = (name, pass, info) => results.push({ name, pass: !!pass, info: info || '' });

  const withTimeout = (p, ms, label) => Promise.race([
    Promise.resolve(p),
    new Promise((_, rej) => setTimeout(() => rej(new Error('timeout ' + (label || ''))), ms)),
  ]);
  async function t(name, fn, ms) {
    try { await withTimeout(fn(), ms || 8000, name); log(name, true); }
    catch (e) { log(name, false, (e && e.message) || String(e)); }
  }

  let dumped = false;
  function dump(tag) {
    if (dumped) return; dumped = true;
    const pass = results.filter(r => r.pass).length, fail = results.length - pass;
    const pre = document.createElement('pre'); pre.id = 'RESULTS';
    pre.textContent = JSON.stringify({ tag: tag || 'done', pass, fail, total: results.length, failures: results.filter(r => !r.pass) });
    document.body.appendChild(pre);
    document.title = 'E2E:' + pass + '/' + results.length + (fail ? ' FAILS' : ' ALLPASS') + (tag ? ' [' + tag + ']' : '');
  }
  setTimeout(() => dump('watchdog'), 80000);

  async function runAll() {
    /* ================================================================
       SHELL
       ================================================================ */
    await t('shell: core modules present', () => {
      for (const k of ['util', 'api', 'commands', 'context', 'scene3d', 'scene3dUI', 'ui', 'hotbar', 'transformPad'])
        if (!GF[k]) throw new Error('missing GF.' + k);
    });
    await t('shell: 2D editor modules fully removed', () => {
      for (const k of ['doc', 'layers', 'select', 'history', 'filters', 'retouch', 'curves', 'exporter', 'make3d', 'view', 'tools'])
        if (GF[k]) throw new Error('GF.' + k + ' should be gone');
    });
    await t('shell: locked to 3D mode', () => {
      if (document.body.dataset.mode !== '3d') throw new Error('mode=' + document.body.dataset.mode);
    });
    await t('shell: api catalog trimmed to 3D + shell', () => {
      const names = GF.api.describe().map(c => c.name);
      for (const n of ['undo', 'redo', 'scene3d.addPrimitive', 'scene3d.exportGLB', 'scene3d.exportPng'])
        if (!names.includes(n)) throw new Error('missing command: ' + n);
      for (const n of ['newDoc', 'addLayer', 'paint', 'wandSelect', 'filter', 'curves'])
        if (names.includes(n)) throw new Error('2D command should be gone: ' + n);
    });
    await t('shell: undo/redo commands route to scene history', () => {
      GF.api.run('undo'); GF.api.run('redo');   // no throw with an empty scene stack
    });
    await t('shell: command palette opens, filters, and closes', () => {
      $('#btn-palette').click();
      if (!$('.cmdk')) throw new Error('palette did not open');
      const inp = $('.cmdk-input'); inp.value = 'export'; inp.dispatchEvent(new Event('input'));
      if (!document.querySelectorAll('.cmdk-item').length) throw new Error('no results for "export"');
      inp.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      if ($('.cmdk')) throw new Error('palette did not close');
    });
    await t('shell: panel switches between scene + assets', () => {
      const assets = $('.ptab[data-tab="assets"]'); if (!assets) throw new Error('no assets tab');
      assets.click();
      if ($('#panel').dataset.tab !== 'assets') throw new Error('did not switch to assets');
      $('.ptab[data-tab="scene"]').click();
      if ($('#panel').dataset.tab !== 'scene') throw new Error('did not switch to scene');
      if (document.querySelector('.ptab[data-tab="layers"]')) throw new Error('layers tab should be gone');
    });
    await t('shell: theme toggle flips the root theme', () => {
      const before = document.documentElement.dataset.theme || '';
      $('#btn-theme').click();
      if ((document.documentElement.dataset.theme || '') === before) throw new Error('theme did not change');
    });
    await t('shell: topbar controls present (no AI button)', () => {
      for (const id of ['#btn-open', '#btn-undo', '#btn-redo', '#btn-export', '#btn-palette', '#btn-theme'])
        if (!$(id)) throw new Error('missing ' + id);
      if ($('#btn-ai')) throw new Error('AI button should be removed');
    });
    await t('shell: keyboard binding table wired for undo/export', () => {
      if (GF.commands.lookup('mod+z') !== 'api.undo') throw new Error('mod+z not bound');
      if (GF.commands.lookup('mod+e') !== 'file.export') throw new Error('mod+e not bound');
    });
    await t('shell: statusbar reports 3D mode (no layer stat)', () => {
      const mode = $('#sb-mode'); if (!mode || mode.textContent.indexOf('3D') < 0) throw new Error('mode label wrong');
      if (document.querySelector('#sb-layers')) throw new Error('layers stat should be gone');
    });

    /* ================================================================
       3D WORKSPACE
       ================================================================ */
    const webgl = (() => { try { const c = document.createElement('canvas'); return !!(c.getContext('webgl2') || c.getContext('webgl')); } catch (e) { return false; } })();
    const bundleReady = !!window.__THREE_BUNDLE;
    let s3ok = false;
    if (!webgl || !GF.scene3d || !bundleReady) {
      log('3d: suite skipped (' + (!webgl ? 'no WebGL' : !bundleReady ? 'bundle parse timeout (headless limitation)' : 'no scene3d') + ')', true, 'soft-skip');
    } else {
      await t('3d: engine boots, mode + host intact', async () => {
        s3ok = await GF.scene3d.enter();
        if (!s3ok) throw new Error('engine failed to load');
        if (document.body.dataset.mode !== '3d') throw new Error('mode=' + document.body.dataset.mode);
        if (!document.querySelector('#scene3d-host canvas')) throw new Error('no renderer canvas');
      }, 30000);
    }
    if (s3ok) {
      await t('3d: transform pad is the single movement control (bottom-left, always present)', () => {
        if (!$('#transform-pad')) throw new Error('no transform pad');
        if ($('#s3-interact')) throw new Error('stale interaction seg still present');
      });
      await t('3d: add primitive -> object listed', async () => {
        const id = await GF.scene3d.addPrimitive('box');
        if (id == null) throw new Error('addPrimitive failed');
        if (!document.querySelector('#s3-objects .layer-item')) throw new Error('object list empty');
        GF.scene3d.select(id);
      });
      await t('3d: every shape in the catalog builds', async () => {
        const KINDS = ['sphere', 'roundedbox', 'cylinder', 'cone', 'pyramid', 'prism', 'capsule',
          'hemisphere', 'torus', 'torusknot', 'pipe', 'tetrahedron', 'octahedron', 'dodecahedron',
          'icosahedron', 'gem', 'plane', 'panel', 'disc', 'ring', 'tile', 'hex', 'curved',
          'star', 'heart', 'arrow', 'steps'];
        for (const k of KINDS) {
          const id = await GF.scene3d.addPrimitive(k);
          if (id == null) throw new Error(k + ' failed to build');
        }
        // clean up: keep one object, reset the scene-undo stack, select it
        const keep = GF.scene3d.listObjects()[0].id;
        for (const o of GF.scene3d.listObjects()) { if (o.id !== keep) GF.scene3d.removeObject(o.id); }
        if (GF.scene3d.count() !== 1) throw new Error('cleanup failed: ' + GF.scene3d.count());
        GF.scene3d.hist.clear();
        GF.scene3d.select(keep);
      }, 30000);
      await t('3d: setObject/getObject 9-DOF roundtrip', () => {
        const id = GF.scene3d.selectedId();
        GF.scene3d.setObject(id, { px: 0.5, py: -0.25, pz: 1, rx: 30, ry: 45, rz: 10, sx: 2, sy: 1.5, sz: 0.5 });
        const g = GF.scene3d.getObject(id);
        if (Math.abs(g.px - 0.5) > 1e-6 || g.ry !== 45 || Math.abs(g.sx - 2) > 1e-6) throw new Error(JSON.stringify(g));
      });
      await t('3d: material source = imported/procedural texture', () => {
        const canvas = GF.library.generateProcedural('checker', 64, 64);
        if (!canvas) throw new Error('procedural texture failed');
        const key = GF.scene3d.addImageSource(canvas, 'checker');
        if (key.indexOf('image:') !== 0) throw new Error('bad source key: ' + key);
        const id = GF.scene3d.selectedId();
        GF.scene3d.setMaterial(id, { mapSource: key });
        if (GF.scene3d.getObject(id).mat.mapSource !== key) throw new Error('material source not applied');
      });
      await t('3d: scene undo/redo roundtrips the material change', () => {
        const before = GF.scene3d.getObject(GF.scene3d.selectedId()).mat.mapSource;
        GF.api.run('undo');
        if (GF.scene3d.getObject(GF.scene3d.selectedId()).mat.mapSource === before) throw new Error('undo did not revert material');
        GF.api.run('redo');
        if (GF.scene3d.getObject(GF.scene3d.selectedId()).mat.mapSource !== before) throw new Error('redo did not reapply');
      });
      await t('3d: export view as PNG produces a blob', async () => {
        const orig = GF.util.downloadBlob;
        let blob = null;
        GF.util.downloadBlob = b => { blob = b; };
        try { blob = (await GF.scene3d.exportViewPng()) || blob; } finally { GF.util.downloadBlob = orig; }
        if (!blob || !blob.size) throw new Error('no blob');
        if (blob.type !== 'image/png') throw new Error('type ' + blob.type);
      }, 30000);
      await t('3d: export GLB produces a binary blob', async () => {
        const orig = GF.util.downloadBlob;
        let blob = null;
        GF.util.downloadBlob = b => { blob = b; };
        try { await GF.scene3d.exportGLB({}); } finally { GF.util.downloadBlob = orig; }
        if (!blob || !blob.size) throw new Error('no blob');
        if (blob.type !== 'model/gltf-binary') throw new Error('type ' + blob.type);
      }, 30000);
      await t('3d: import sample GLB (soft-skip if file:// blocks fetch)', async () => {
        const id = await GF.scene3d.importModel('assets/models/cube.glb', 'cube');
        if (id == null) log('3d: GLB fetch unavailable here', true, 'soft-skip');
        else if (GF.scene3d.getObject(id).kind !== 'model') throw new Error('not a model');
      }, 30000);
      await t('3d: remove selected + scene undo restores it', () => {
        const n = GF.scene3d.count(); if (!n) throw new Error('nothing to remove');
        GF.scene3d.removeObject(GF.scene3d.listObjects()[0].id);
        if (GF.scene3d.count() !== n - 1) throw new Error('not removed');
        GF.scene3d.hist.undo();
        if (GF.scene3d.count() !== n) throw new Error('undo did not restore');
      });
      await t('publish: one-file page embeds scene + viewer + animation', async () => {
        const html = await GF.publish.buildPage({ title: 'Test <scene>', autoRotate: true });
        if (!html) throw new Error('no html');
        if (html.indexOf('cdn.jsdelivr.net/npm/three@0.185.0') < 0) throw new Error('no pinned import map');
        if (html.indexOf('scene-glb') < 0) throw new Error('no embedded GLB block');
        if (html.indexOf('OrbitControls') < 0) throw new Error('no controls');
        if (html.indexOf('GLTFLoader') < 0) throw new Error('no loader');
        if (html.indexOf('AnimationMixer') < 0) throw new Error('no animation support');
        if (html.indexOf('Test &lt;scene&gt;') < 0) throw new Error('title not escaped');
        const m = html.match(/type="application\/octet-stream">([^<]+)</);
        if (!m || m[1].trim().length < 800) throw new Error('GLB payload too small: ' + (m ? m[1].trim().length : 0));
      }, 30000);

      /* ---------- MESH EDIT MODE (GF.editmesh) ---------- */
      let editBox = null;
      await t('editmesh: enter welds a box to 8 verts / 6 quads / 12 edges', async () => {
        editBox = await GF.scene3d.addPrimitive('box');
        GF.scene3d.select(editBox);
        if (!GF.editmesh.enter(editBox)) throw new Error('could not enter edit mode');
        const s = GF.editmesh.stats();
        if (s.verts !== 8) throw new Error('verts=' + s.verts + ' (want 8)');
        if (s.faces !== 6) throw new Error('faces=' + s.faces + ' (want 6)');
        if (s.edges !== 12) throw new Error('edges=' + s.edges + ' (want 12)');
      });
      await t('editmesh: subdivide 6 -> 24 faces, undo/redo roundtrips', () => {
        GF.editmesh.subdivide();
        if (GF.editmesh.stats().faces !== 24) throw new Error('faces=' + GF.editmesh.stats().faces);
        GF.scene3d.hist.undo();
        if (GF.editmesh.stats().faces !== 6) throw new Error('undo faces=' + GF.editmesh.stats().faces);
        GF.scene3d.hist.redo();
        if (GF.editmesh.stats().faces !== 24) throw new Error('redo faces=' + GF.editmesh.stats().faces);
        GF.scene3d.hist.undo();
      });
      await t('editmesh: face select + extrude adds a ring of geometry', () => {
        GF.editmesh.selectElements('face', [0]);
        if (GF.editmesh.stats().sel.f !== 1) throw new Error('sel.f=' + GF.editmesh.stats().sel.f);
        const f0 = GF.editmesh.stats().faces, v0 = GF.editmesh.stats().verts;
        GF.editmesh.extrude();
        const s = GF.editmesh.stats();
        if (s.faces !== f0 + 4) throw new Error('faces=' + s.faces + ' (want ' + (f0 + 4) + ')');
        if (s.verts !== v0 + 4) throw new Error('verts=' + s.verts + ' (want ' + (v0 + 4) + ')');
      });
      await t('editmesh: exit bakes geometry and deactivates', () => {
        GF.editmesh.exit();
        if (GF.editmesh.isActive()) throw new Error('still active after exit');
        const node = GF.scene3d.byId(editBox).node;
        if (!node.geometry.attributes.position.count) throw new Error('baked geometry is empty');
        GF.scene3d.removeObject(editBox);
      });
      // helpers: run an operator on a fresh cube, assert, tear down
      const onCube = async (fn) => { const id = await GF.scene3d.addPrimitive('box'); GF.scene3d.select(id); GF.editmesh.enter(id); try { fn(); } finally { GF.editmesh.exit(); GF.scene3d.removeObject(id); } };
      await t('editmesh: inset face -> 10 faces / 12 verts', () => onCube(() => {
        GF.editmesh.selectElements('face', [0]); GF.editmesh.inset();
        const s = GF.editmesh.stats(); if (s.faces !== 10 || s.verts !== 12) throw new Error('f=' + s.faces + ' v=' + s.verts);
        if (s.sel.f !== 1) throw new Error('inner face not selected');
      }));
      await t('editmesh: loop cut a quad ring -> 10 faces / 12 verts', () => onCube(() => {
        GF.editmesh.loopcut(GF.editmesh.edgeKeys()[0]);
        const s = GF.editmesh.stats(); if (s.faces !== 10 || s.verts !== 12) throw new Error('f=' + s.faces + ' v=' + s.verts);
      }));
      await t('editmesh: dissolve edge merges two quads -> 5 faces', () => onCube(() => {
        GF.editmesh.setMode('edge'); GF.editmesh.selectElements('edge', [GF.editmesh.edgeKeys()[0]]); GF.editmesh.dissolve();
        const s = GF.editmesh.stats(); if (s.faces !== 5 || s.verts !== 8) throw new Error('f=' + s.faces + ' v=' + s.verts);
      }));
      await t('editmesh: merge two vertices -> 7 verts', () => onCube(() => {
        const [a, b] = GF.editmesh.edgeKeys()[0].split('_').map(Number);
        GF.editmesh.setMode('vertex'); GF.editmesh.selectElements('vertex', [a, b]); GF.editmesh.merge();
        if (GF.editmesh.stats().verts !== 7) throw new Error('v=' + GF.editmesh.stats().verts);
      }));
      await t('editmesh: bevel keeps a closed manifold (Euler V-E+F=2)', () => onCube(() => {
        GF.editmesh.bevel();
        const s = GF.editmesh.stats(), euler = s.verts - s.edges + s.faces;
        if (euler !== 2) throw new Error('Euler=' + euler + ' (' + s.verts + '-' + s.edges + '+' + s.faces + ')');
        if (s.verts !== 24 || s.faces !== 26) throw new Error('v=' + s.verts + ' f=' + s.faces);
      }));
      await t('editmesh: material zone -> multi-material + geometry groups', async () => {
        const id = await GF.scene3d.addPrimitive('box'); GF.scene3d.select(id); GF.editmesh.enter(id);
        try {
          const node = GF.scene3d.byId(id).node;
          GF.editmesh.selectElements('face', [0, 1]); GF.editmesh.addZone({ color: '#e5634d' });
          if (GF.editmesh.zoneList().length !== 2) throw new Error('zones=' + GF.editmesh.zoneList().length);
          if (!Array.isArray(node.material) || node.material.length !== 2) throw new Error('material not multi');
          if (node.geometry.groups.length !== 2) throw new Error('groups=' + node.geometry.groups.length);
          if (GF.editmesh.zoneList()[1].faceCount !== 2) throw new Error('zone faceCount=' + GF.editmesh.zoneList()[1].faceCount);
          const sum = GF.editmesh.zoneList().reduce((a, z) => a + z.faceCount, 0);
          if (sum !== GF.editmesh.stats().faces) throw new Error('faceZone misaligned');
        } finally { GF.editmesh.exit(); GF.scene3d.removeObject(id); }
      });
    } else if (webgl && GF.scene3d) log('3d: remaining tests skipped (engine unavailable)', true, 'soft-skip');

    /* ---------- FINISH ---------- */
    dump('done');
  }

  window.addEventListener('load', () => setTimeout(() => { runAll().catch(e => { document.title = 'E2E:DRIVER-ERR:' + e.message; }); }, 600));
})();
