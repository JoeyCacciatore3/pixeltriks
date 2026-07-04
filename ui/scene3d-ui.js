/* PixelTriks — scene3d-ui.js
   UI for the 3D workspace (GF.scene3dUI). Owns the "3D" panel tab (objects,
   transform, material, environment, actions), the 3D options bar, and the
   mode enter/exit handshake with GF.ui.setTool. All scene mutations go
   through GF.scene3d — this file is DOM only. */
'use strict';
window.GF = window.GF || {};

GF.scene3dUI = (function () {
  const U = GF.util, D = GF.doc;
  const $ = s => document.querySelector(s);
  const S = () => GF.scene3d;

  // plain text, matching the More tab's pro-grid style (no mixed-weight glyphs)
  const PRIM_GROUPS = [
    ['Basics', [
      ['sphere', 'Sphere'], ['box', 'Box'], ['roundedbox', 'Rounded box'], ['cylinder', 'Cylinder'],
      ['cone', 'Cone'], ['pyramid', 'Pyramid'], ['prism', 'Prism'], ['capsule', 'Capsule'],
      ['hemisphere', 'Dome'], ['torus', 'Torus'], ['torusknot', 'Torus knot'], ['pipe', 'Pipe'],
    ]],
    ['Crystals', [
      ['tetrahedron', 'Tetra'], ['octahedron', 'Octa'], ['dodecahedron', 'Dodeca'],
      ['icosahedron', 'Icosa'], ['gem', 'Gem'],
    ]],
    ['Flat', [
      ['plane', 'Plane'], ['panel', 'Panel'], ['disc', 'Disc'], ['ring', 'Ring'],
      ['tile', 'Tile'], ['hex', 'Hex tile'], ['curved', 'Curved wall'],
    ]],
    ['Extras', [
      ['star', 'Star'], ['heart', 'Heart'], ['arrow', 'Arrow'], ['steps', 'Steps'],
    ]],
  ];
  const SAMPLES = ['cube', 'sphere', 'cylinder', 'cone', 'plane'];

  let built = false;

  /* ================= mode handshake (called by setTool) ================= */
  function enter() {
    ensurePane();
    S().enter().then(ok => { if (!ok) return; refresh(); });
    const tab = $('.ptab[data-tab="scene"]'); if (tab) tab.click();
  }
  function exit() {
    S().exit();
    const tab = $('.ptab[data-tab="adjust"]'); if (tab) tab.click();
    updateUndoButtons();
  }

  /* ================= options bar ================= */
  function optbarHtml() {
    const cur = S().getInteract();
    const seg = [['orbit', 'Orbit'], ['move', 'Move'], ['rotate', 'Rotate'], ['scale', 'Scale']]
      .map(([v, l]) => `<button data-v="${v}" class="${v === cur ? 'on' : ''}">${l}</button>`).join('');
    return `<span class="seg" id="s3-interact">${seg}</span>`
      + `<span class="opt s3-hint">Click an object to select it</span>`
      + `<button class="text-btn primary" id="s3-flatten-ob">⬇ Flatten to layer</button>`
      + `<button class="text-btn ghost" id="s3-publish-ob">🌐 Publish…</button>`;
  }
  function wireOptbar() {
    const seg = $('#s3-interact');
    if (seg) seg.querySelectorAll('button').forEach(b => b.addEventListener('click', () => {
      seg.querySelectorAll('button').forEach(x => x.classList.remove('on'));
      b.classList.add('on');
      S().setInteract(b.dataset.v);
    }));
    const fl = $('#s3-flatten-ob'); if (fl) fl.addEventListener('click', flattenAndReturn);
    const pb = $('#s3-publish-ob'); if (pb) pb.addEventListener('click', publishDialog);
  }
  function flattenAndReturn() {
    const id = S().snapshotToLayer();
    if (id != null && GF.ui.setTool) GF.ui.setTool('move');   // land on the new layer in 2D
  }

  /* ================= panel pane ================= */
  function ensurePane() {
    if (built) return;
    built = true;
    const pane = $('.ptab-pane[data-pane="scene"]'); if (!pane) return;
    pane.innerHTML = `
      <h3 class="panel-h first">Make 3D — from your image</h3>
      <label class="mini">Converter<select id="m3-kind"></select></label>
      <div id="m3-opts"></div>
      <p class="s3-status" id="m3-src"></p>
      <div class="s3-row"><button class="text-btn primary" id="m3-run">✨ Create 3D</button></div>

      <h3 class="panel-h">Objects</h3>
      ${PRIM_GROUPS.map(([label, prims], gi) =>
        `<details class="s3-group"${gi === 0 ? ' open' : ''}><summary>${label} <span class="s3-count">${prims.length}</span></summary>
         <div class="pro-grid s3-prims">${prims.map(([v, l]) => `<button class="pro-btn" data-prim="${v}">${l}</button>`).join('')}</div></details>`
      ).join('')}
      <div class="s3-row">
        <button class="text-btn ghost" id="s3-import">Import model…</button>
        <button class="text-btn ghost" id="s3-ph-model">Poly Haven…</button>
      </div>
      <div class="s3-row">
        <label class="mini">Sample<select id="s3-sample"><option value="">Add a sample model…</option>${SAMPLES.map(s => `<option value="${s}">${s}</option>`).join('')}</select></label>
      </div>
      <ul id="s3-objects" class="layer-list"></ul>
      <div id="s3-inspector"></div>
      <h3 class="panel-h">Environment</h3>
      <div class="s3-row">
        <button class="text-btn ghost" id="s3-hdr-file">HDRI file…</button>
        <button class="text-btn ghost" id="s3-ph-hdri">Poly Haven…</button>
        <button class="text-btn ghost" id="s3-env-clear">Clear</button>
      </div>
      <div class="s3-row">
        <label class="mini">Background<select id="s3-bg">
          <option value="default">Studio (dark / HDRI)</option>
          <option value="transparent">Transparent</option>
          <option value="color">Solid color</option>
        </select></label>
        <input type="color" id="s3-bg-color" value="#0c0e11" title="Background color">
      </div>
      <h3 class="panel-h">Actions</h3>
      <div class="s3-row">
        <button class="text-btn primary" id="s3-flatten">⬇ Flatten to layer</button>
        <button class="text-btn primary" id="s3-publish">🌐 Publish page…</button>
      </div>
      <div class="s3-row">
        <button class="text-btn ghost" id="s3-glb">Export GLB</button>
        <button class="text-btn ghost" id="s3-glb-sel">Export selected</button>
      </div>
      <div class="s3-row">
        <button class="text-btn ghost" id="s3-refresh">↻ Refresh textures</button>
      </div>
      <p class="s3-status" id="s3-status"></p>`;

    pane.querySelectorAll('[data-prim]').forEach(b => b.addEventListener('click', () => {
      if (!S().isActive() && GF.ui && GF.ui.setTool) GF.ui.setTool('scene3d');   // pane is reachable before the 3D tool
      S().addPrimitive(b.dataset.prim);
    }));
    $('#s3-import').addEventListener('click', () => $('#file-input').click());   // exporter routes .glb/.gltf/.hdr back to scene3d
    $('#s3-hdr-file').addEventListener('click', () => $('#file-input').click());
    $('#s3-sample').addEventListener('change', e => {
      const v = e.target.value; e.target.value = '';
      if (v) S().importModel('assets/models/' + v + '.glb', v);
    });
    $('#s3-ph-model').addEventListener('click', () => phPicker('models', async (id, name) => {
      U.toast('Importing ' + name + '…', 60000);
      try { await GF.library.importModel(id, name, '1k'); U.toast('Imported ' + name); }
      catch (e) { U.toast('Import failed: ' + e.message); }
    }));
    $('#s3-ph-hdri').addEventListener('click', () => phPicker('hdris', async (id, name) => {
      U.toast('Loading ' + name + '…', 60000);
      try { await S().setEnvironment(await GF.library.hdriUrl(id, '1k')); }
      catch (e) { U.toast('HDRI failed: ' + e.message); }
    }));
    $('#s3-env-clear').addEventListener('click', () => S().clearEnvironment());
    $('#s3-bg').addEventListener('change', e => S().setBackground(e.target.value, $('#s3-bg-color').value));
    $('#s3-bg-color').addEventListener('input', e => S().setBackground('color', e.target.value));
    $('#s3-flatten').addEventListener('click', flattenAndReturn);
    $('#s3-publish').addEventListener('click', publishDialog);
    $('#s3-glb').addEventListener('click', () => S().exportGLB({}));
    $('#s3-glb-sel').addEventListener('click', () => S().exportGLB({ selection: 'selected' }));
    $('#s3-refresh').addEventListener('click', () => { S().refreshAll(); U.toast('Textures refreshed'); });

    S().setStatusCallback(msg => { const el = $('#s3-status'); if (el) el.textContent = msg; });
    S().onChange(() => {
      refresh();
      const es = $('#empty-state');
      if (es && S().count() > 0) es.hidden = true;
    });
    wireMake3d();
    wireKeys();
  }

  /* ---- Make 3D (renders whatever GF.make3d has registered) ---- */
  function wireMake3d() {
    const kind = $('#m3-kind'), optsHost = $('#m3-opts'), runBtn = $('#m3-run');
    if (!kind || !GF.make3d) return;
    const items = GF.make3d.list();
    kind.innerHTML = items.map(c => `<option value="${c.key}">${c.label}</option>`).join('');
    const renderOpts = () => {
      const def = items.find(c => c.key === kind.value);
      const hint = def ? `<p class="s3-status" style="margin:.2rem 0 .4rem">${def.desc}</p>` : '';
      optsHost.innerHTML = hint + (def ? def.options.map(o =>
        `<label class="mini"><span class="s3-top">${o.label}<span class="s3-val" id="m3v-${o.key}">${o.def}</span></span>
         <input type="range" id="m3o-${o.key}" min="${o.min}" max="${o.max}" step="${o.step}" value="${o.def}"></label>`).join('') : '');
      if (def) def.options.forEach(o => {
        const el = $('#m3o-' + o.key);
        el.addEventListener('input', () => { $('#m3v-' + o.key).textContent = el.value; });
      });
    };
    kind.addEventListener('change', renderOpts);
    renderOpts();
    runBtn.addEventListener('click', async () => {
      const def = items.find(c => c.key === kind.value); if (!def) return;
      const opts = {};
      def.options.forEach(o => { const el = $('#m3o-' + o.key); if (el) opts[o.key] = +el.value; });
      runBtn.disabled = true;
      try { await GF.make3d.run(kind.value, opts); }
      catch (e) { U.toast(e.message); }
      finally { runBtn.disabled = false; }
    });
  }
  function refreshMakeSource() {
    const el = $('#m3-src');
    if (el && GF.make3d) el.textContent = 'Converts ' + GF.make3d.sourceLabel() + '.';
  }

  /* ---- object list (renders to both panel #s3-objects AND sidebar #sidebar-objects) ---- */
  function renderObjectsInto(list) {
    if (!list) return;
    list.innerHTML = '';
    S().listObjects().forEach(o => {
      const li = document.createElement('li');
      li.className = 'layer-item' + (o.selected ? ' on' : '');
      const name = document.createElement('span');
      name.className = 'layer-name';
      name.textContent = (o.kind === 'model' ? '◆ ' : '') + o.name;
      const vis = document.createElement('button');
      vis.className = 'icon-btn sm layer-vis' + (o.visible ? '' : ' off');
      vis.textContent = o.visible ? '👁' : '–';
      vis.title = 'Toggle visibility';
      vis.addEventListener('click', e => { e.stopPropagation(); S().setVisible(o.id, !o.visible); });
      const del = document.createElement('button');
      del.className = 'icon-btn sm danger';
      del.textContent = '✕'; del.title = 'Remove';
      del.addEventListener('click', e => { e.stopPropagation(); S().removeObject(o.id); });
      li.addEventListener('click', () => S().select(o.id));
      li.appendChild(name); li.appendChild(vis); li.appendChild(del);
      list.appendChild(li);
    });
  }
  function renderObjects() {
    renderObjectsInto($('#s3-objects'));
    renderObjectsInto($('#sidebar-objects'));
  }

  /* ---- transform + material inspector for the selected object ---- */
  function num(id, label, val, step) {
    return `<label class="s3-num">${label}<input type="number" id="${id}" value="${(+val).toFixed(2).replace(/\.00$/, '')}" step="${step}"></label>`;
  }
  function renderInspector() {
    const host = $('#s3-inspector'); if (!host) return;
    // don't yank focus (and the half-typed value) out from under the user —
    // every committed edit fires onChange → refresh while they tab through fields
    if (host.contains(document.activeElement)) return;
    const t = S().getObject(S().selectedId());
    if (!t) { host.innerHTML = `<p class="s3-status">Select an object — or add one above.</p>`; return; }
    const layers = (D.doc.layers || []);
    const imgs = S().listImageSources();
    const srcOpts = (cur) =>
      `<option value=""${!cur ? ' selected' : ''}>None (flat color)</option>` +
      `<option value="composite"${cur === 'composite' ? ' selected' : ''}>Document (all layers)</option>` +
      layers.map(L => `<option value="layer:${L.id}"${cur === 'layer:' + L.id ? ' selected' : ''}>Layer: ${L.name}</option>`).join('') +
      imgs.map(i => `<option value="${i.key}"${cur === i.key ? ' selected' : ''}>Image: ${i.name}</option>`).join('') +
      `<option value="__import">+ Import image…</option>`;
    const mapOpts = (cur, kind) =>
      `<option value="auto:${kind}"${cur === 'auto:' + kind ? ' selected' : ''}>Auto ("${kind}" layer)</option>` +
      `<option value=""${!cur ? ' selected' : ''}>None</option>` +
      layers.map(L => `<option value="layer:${L.id}"${cur === 'layer:' + L.id ? ' selected' : ''}>Layer: ${L.name}</option>`).join('');

    host.innerHTML = `
      <h3 class="panel-h">Transform — ${t.name}</h3>
      <div class="s3-grid">
        ${num('s3-px', 'X', t.px, 0.1)}${num('s3-py', 'Y', t.py, 0.1)}${num('s3-pz', 'Z', t.pz, 0.1)}
        ${num('s3-rx', 'RX°', t.rx, 5)}${num('s3-ry', 'RY°', t.ry, 5)}${num('s3-rz', 'RZ°', t.rz, 5)}
        ${num('s3-sx', 'SX', t.sx, 0.1)}${num('s3-sy', 'SY', t.sy, 0.1)}${num('s3-sz', 'SZ', t.sz, 0.1)}
      </div>
      <h3 class="panel-h">Material</h3>
      ${t.kind === 'model' ? `<label class="ck"><input type="checkbox" id="s3-keep" ${t.mat.keepOriginal ? 'checked' : ''}> Keep the model's own materials</label>` : ''}
      <div id="s3-mat" ${t.kind === 'model' && t.mat.keepOriginal ? 'hidden' : ''}>
        <label class="mini">Texture<select id="s3-map">${srcOpts(t.mat.mapSource)}</select></label>
        <div class="s3-row">
          <label class="mini">Color<input type="color" id="s3-color" value="${t.mat.color}"></label>
          <label class="ck"><input type="checkbox" id="s3-2side" ${t.mat.doubleSided ? 'checked' : ''}> 2-sided</label>
        </div>
        <label class="mini"><span class="s3-top">Roughness<span class="s3-val" id="s3-rough-v">${t.mat.roughness.toFixed(2)}</span></span>
          <input type="range" id="s3-rough" min="0" max="100" value="${Math.round(t.mat.roughness * 100)}"></label>
        <label class="mini"><span class="s3-top">Metalness<span class="s3-val" id="s3-metal-v">${t.mat.metalness.toFixed(2)}</span></span>
          <input type="range" id="s3-metal" min="0" max="100" value="${Math.round(t.mat.metalness * 100)}"></label>
        <details class="s3-group"><summary>Advanced maps</summary>
          <label class="mini">Normal map<select id="s3-normal">${mapOpts(t.mat.normalSource, 'normal')}</select></label>
          <label class="mini">Roughness map<select id="s3-roughmap">${mapOpts(t.mat.roughSource, 'roughness')}</select></label>
        </details>
      </div>`;

    const id = t.id;
    const commitTransform = () => S().setObject(id, {
      px: +$('#s3-px').value, py: +$('#s3-py').value, pz: +$('#s3-pz').value,
      rx: +$('#s3-rx').value, ry: +$('#s3-ry').value, rz: +$('#s3-rz').value,
      sx: +$('#s3-sx').value, sy: +$('#s3-sy').value, sz: +$('#s3-sz').value,
    });
    ['px', 'py', 'pz', 'rx', 'ry', 'rz', 'sx', 'sy', 'sz'].forEach(k => {
      const el = $('#s3-' + k); if (el) el.addEventListener('change', commitTransform);
    });
    const keep = $('#s3-keep');
    if (keep) keep.addEventListener('change', () => S().setMaterial(id, { keepOriginal: keep.checked }));
    const map = $('#s3-map');
    if (map) map.addEventListener('change', () => {
      if (map.value === '__import') { importTextureImage(id); return; }
      S().setMaterial(id, { mapSource: map.value || null });
    });
    // live preview while dragging (no history), ONE undo entry on release
    const liveCommit = (el, valEl, patchOf) => {
      if (!el) return;
      let base = null;
      el.addEventListener('input', () => {
        base = base || Object.assign({}, S().getObject(id).mat);
        if (valEl) valEl.textContent = (el.value / 100).toFixed(2);
        S().setMaterial(id, patchOf(el), false);
      });
      el.addEventListener('change', () => { S().setMaterial(id, patchOf(el), true, base); base = null; });
    };
    liveCommit($('#s3-color'), null, el => ({ color: el.value }));
    liveCommit($('#s3-rough'), $('#s3-rough-v'), el => ({ roughness: el.value / 100 }));
    liveCommit($('#s3-metal'), $('#s3-metal-v'), el => ({ metalness: el.value / 100 }));
    const ts = $('#s3-2side'); if (ts) ts.addEventListener('change', () => S().setMaterial(id, { doubleSided: ts.checked }));
    const nrm = $('#s3-normal'); if (nrm) nrm.addEventListener('change', () => S().setMaterial(id, { normalSource: nrm.value || null }));
    const rm = $('#s3-roughmap'); if (rm) rm.addEventListener('change', () => S().setMaterial(id, { roughSource: rm.value || null }));
  }

  function importTextureImage(objId) {
    const fi = document.createElement('input');
    fi.type = 'file'; fi.accept = 'image/*';
    fi.addEventListener('change', () => {
      const f = fi.files[0]; if (!f) return;
      const url = URL.createObjectURL(f), img = new Image();
      img.onload = () => {
        URL.revokeObjectURL(url);
        const c = U.makeCanvas(img.naturalWidth, img.naturalHeight);
        U.ctx2d(c).drawImage(img, 0, 0);
        const key = S().addImageSource(c, f.name.replace(/\.[^.]+$/, ''));
        S().setMaterial(objId, { mapSource: key });
      };
      img.onerror = () => { URL.revokeObjectURL(url); U.toast('Could not load that image'); };
      img.src = url;
    });
    fi.click();
  }

  function updateUndoButtons() {
    const three = S().isActive();
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = three ? !S().hist.canUndo() : !GF.history.canUndo();
    if (r) r.disabled = three ? !S().hist.canRedo() : !GF.history.canRedo();
  }

  function refresh() { renderObjects(); renderInspector(); updateUndoButtons(); refreshMakeSource(); }

  /* ---- keyboard (only while the workspace is active) ---- */
  let keysWired = false;
  function wireKeys() {
    if (keysWired) return; keysWired = true;
    window.addEventListener('keydown', e => {
      if (!S().isActive()) return;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
      const k = e.key.toLowerCase();
      if (k === 'delete' || k === 'backspace') { const id = S().selectedId(); if (id != null) { e.preventDefault(); S().removeObject(id); } }
      else if (k === 'f') { e.preventDefault(); S().frame(); }
      else if (k === 'w') { e.preventDefault(); S().setGizmoMode('translate'); }
      else if (k === 'e') { e.preventDefault(); S().setGizmoMode('rotate'); }
      else if (k === 'r') { e.preventDefault(); S().setGizmoMode('scale'); }
      else if (k === 'q') { e.preventDefault(); S().setGizmoSpace(S().gizmoSpace() === 'world' ? 'local' : 'world'); }
    });
  }

  /* ---- publish: one-file interactive web page ---- */
  function publishDialog() {
    if (!S().count()) { U.toast('Add something to the 3D scene first'); return; }
    const bg = S().background();
    const wrap = document.createElement('div'); wrap.className = 'fs-modal';
    wrap.innerHTML = `<div class="card">
      <h2>🌐 Publish web page</h2>
      <p class="sub">One self-contained .html — your scene + an interactive viewer. Host it anywhere.</p>
      <label>Page title<input id="pb-title" value="${(D.doc.name || 'My 3D scene').replace(/"/g, '&quot;')}"></label>
      <div class="s3-row">
        <label class="mini">Background<select id="pb-bg">
          <option value="default"${bg.mode === 'default' ? ' selected' : ''}>Studio (dark)</option>
          <option value="transparent"${bg.mode === 'transparent' ? ' selected' : ''}>Transparent</option>
          <option value="color"${bg.mode === 'color' ? ' selected' : ''}>Solid color</option>
        </select></label>
        <input type="color" id="pb-color" value="${bg.color || '#0c0e11'}" title="Background color">
      </div>
      <label class="ck"><input type="checkbox" id="pb-spin" checked> Slow auto-rotate</label>
      <menu>
        <button class="text-btn" data-x>Cancel</button>
        <button class="text-btn primary" data-go>Download page</button>
      </menu></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-x]').addEventListener('click', close);
    wrap.querySelector('[data-go]').addEventListener('click', async () => {
      const btn = wrap.querySelector('[data-go]'); btn.disabled = true; btn.textContent = 'Building…';
      await GF.publish.downloadPage({
        title: wrap.querySelector('#pb-title').value.trim(),
        background: wrap.querySelector('#pb-bg').value,
        color: wrap.querySelector('#pb-color').value,
        autoRotate: wrap.querySelector('#pb-spin').checked,
      });
      close();
    });
  }

  /* ---- tiny Poly Haven picker (CC0; online-only, degrades with a message) ---- */
  function phPicker(type, onPick) {
    const wrap = document.createElement('div'); wrap.className = 'fs-modal';
    wrap.innerHTML = `<div class="card">
      <h2>Poly Haven — ${type === 'hdris' ? 'HDRI environments' : '3D models'}</h2>
      <p class="sub">Free CC0 assets · needs an internet connection</p>
      <input class="ph-search" placeholder="Search…" aria-label="Search assets">
      <div class="ph-grid"><p class="s3-status">Loading…</p></div>
      <menu><button class="text-btn" data-x>Close</button></menu></div>`;
    document.body.appendChild(wrap);
    const close = () => wrap.remove();
    wrap.addEventListener('mousedown', e => { if (e.target === wrap) close(); });
    wrap.querySelector('[data-x]').addEventListener('click', close);
    const grid = wrap.querySelector('.ph-grid'), search = wrap.querySelector('.ph-search');
    let assets = null;
    const render = () => {
      if (!assets) return;
      const q = (search.value || '').toLowerCase().trim();
      const ids = Object.keys(assets).filter(id => {
        if (!q) return true;
        const a = assets[id];
        return id.includes(q) || (a.name || '').toLowerCase().includes(q) ||
               (a.tags || []).some(t => t.includes(q));
      }).slice(0, 40);
      grid.innerHTML = ids.length ? '' : '<p class="s3-status">No matches.</p>';
      ids.forEach(id => {
        const b = document.createElement('button'); b.className = 'ph-card'; b.title = assets[id].name || id;
        b.innerHTML = `<img loading="lazy" src="${GF.library.thumbUrl(id)}" alt=""><span>${assets[id].name || id}</span>`;
        b.addEventListener('click', () => { close(); onPick(id, assets[id].name || id); });
        grid.appendChild(b);
      });
    };
    let timer = null;
    search.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(render, 250); });
    GF.library.apiList(type).then(a => { assets = a; render(); })
      .catch(() => { grid.innerHTML = '<p class="s3-status">Could not reach Poly Haven — are you online?</p>'; });
  }

  // Build the pane eagerly — the panel's "3D" tab is clickable before the 3D
  // tool is ever activated and must never show an empty pane.
  function wireSidebar() {
    const addBtn = $('#sidebar-add');
    const impBtn = $('#sidebar-import');
    if (addBtn) addBtn.addEventListener('click', () => {
      if (!S().isActive() && GF.ui && GF.ui.setTool) GF.ui.setTool('scene3d');
      S().addPrimitive('box');
    });
    if (impBtn) impBtn.addEventListener('click', () => $('#file-input').click());
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { ensurePane(); wireSidebar(); refresh(); });
  else { ensurePane(); wireSidebar(); refresh(); }

  return { enter, exit, optbarHtml, wireOptbar, refresh, publishDialog };
})();
