/* PixelTriks — scene3d-ui.js
   UI for the 3D workspace (GF.scene3dUI). Owns the "3D" panel tab (objects,
   transform, material, environment, actions), the 3D options bar, and the
   the 3D workspace is always active. All scene mutations go through
   GF.scene3d — this file is DOM only. */
'use strict';
window.GF = window.GF || {};

GF.scene3dUI = (function () {
  const U = GF.util;
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

  let built = false;

  /* ================= workspace activation ================= */
  function enter() {
    ensurePane();
    S().enter().then(ok => { if (!ok) return; refresh(); });
    const tab = $('.ptab[data-tab="scene"]'); if (tab) tab.click();
  }
  function exit() { /* 3D-only: the workspace is always active */ updateUndoButtons(); }


  /* ================= panel pane ================= */
  function ensurePane() {
    if (built) return;
    built = true;
    const pane = $('.ptab-pane[data-pane="scene"]'); if (!pane) return;
    pane.innerHTML = `
      <h3 class="panel-h first">Objects</h3>
      ${PRIM_GROUPS.map(([label, prims], gi) =>
        `<details class="s3-group"${gi === 0 ? ' open' : ''}><summary>${label} <span class="s3-count">${prims.length}</span></summary>
         <div class="pro-grid s3-prims">${prims.map(([v, l]) => `<button class="pro-btn" data-prim="${v}">${l}</button>`).join('')}</div></details>`
      ).join('')}
      <div class="s3-row">
        <button class="text-btn ghost" id="s3-import">Import model…</button>
        <button class="text-btn ghost" id="s3-ph-model">Poly Haven…</button>
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
      <p class="s3-hint-line">Export &amp; publish live in the <b>Export</b> button (top-right).</p>
      <p class="s3-status" id="s3-status"></p>`;

    pane.querySelectorAll('[data-prim]').forEach(b => b.addEventListener('click', () => {
      S().addPrimitive(b.dataset.prim);
    }));
    $('#s3-import').addEventListener('click', () => $('#file-input').click());   // routes .glb/.gltf/.hdr back to scene3d
    $('#s3-hdr-file').addEventListener('click', () => $('#file-input').click());
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
    // Export / Publish now live only in the topbar Export menu; Refresh textures moves to the palette.
    if (GF.commands && !GF.commands.has('scene.refreshTex'))
      GF.commands.register({ id: 'scene.refreshTex', title: 'Refresh textures', group: '3D', run: () => { S().refreshAll(); U.toast('Textures refreshed'); } });

    S().setStatusCallback(msg => { const el = $('#s3-status'); if (el) el.textContent = msg; });
    S().onChange(() => { refresh(); });
    wireKeys();
  }

  /* ---- object list (renders into panel #s3-objects) ---- */
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
    const imgs = S().listImageSources();
    const srcOpts = (cur) =>
      `<option value=""${!cur ? ' selected' : ''}>None (flat color)</option>` +
      imgs.map(i => `<option value="${i.key}"${cur === i.key ? ' selected' : ''}>Image: ${i.name}</option>`).join('') +
      `<option value="__import">+ Import image…</option>`;
    const mapOpts = (cur) =>
      `<option value=""${!cur ? ' selected' : ''}>None</option>` +
      imgs.map(i => `<option value="${i.key}"${cur === i.key ? ' selected' : ''}>Image: ${i.name}</option>`).join('');

    host.innerHTML = `
      <h3 class="panel-h">Transform — ${t.name}</h3>
      <div class="s3-grid">
        ${num('s3-px', 'X', t.px, 0.1)}${num('s3-py', 'Y', t.py, 0.1)}${num('s3-pz', 'Z', t.pz, 0.1)}
        ${num('s3-rx', 'RX°', t.rx, 5)}${num('s3-ry', 'RY°', t.ry, 5)}${num('s3-rz', 'RZ°', t.rz, 5)}
        ${num('s3-sx', 'SX', t.sx, 0.1)}${num('s3-sy', 'SY', t.sy, 0.1)}${num('s3-sz', 'SZ', t.sz, 0.1)}
      </div>
      ${S().hasModelAnimations && S().hasModelAnimations() ? `
      <h3 class="panel-h">Animation</h3>
      <p class="s3-hint-line">Model loaded paused (rest pose).</p>
      <div class="s3-row">
        <button class="text-btn ghost" id="s3-anim-play">▶ Play</button>
        <button class="text-btn ghost" id="s3-anim-pause">⏸ Pause</button>
        <button class="text-btn ghost" id="s3-anim-stop">⏹ Reset</button>
      </div>` : ''}
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
          <label class="mini">Normal map<select id="s3-normal">${mapOpts(t.mat.normalSource)}</select></label>
          <label class="mini">Roughness map<select id="s3-roughmap">${mapOpts(t.mat.roughSource)}</select></label>
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
    const ap = $('#s3-anim-play'); if (ap) ap.addEventListener('click', () => { GF.animation ? GF.animation.play() : S().playAnimations(); });
    const apa = $('#s3-anim-pause'); if (apa) apa.addEventListener('click', () => { GF.animation ? GF.animation.pause() : S().pauseAnimations(); });
    const ast = $('#s3-anim-stop'); if (ast) ast.addEventListener('click', () => { GF.animation ? GF.animation.stop() : S().stopAnimations(); });
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
    const u = $('#btn-undo'), r = $('#btn-redo');
    if (u) u.disabled = !S().hist.canUndo();
    if (r) r.disabled = !S().hist.canRedo();
  }

  function refresh() { renderObjects(); renderInspector(); updateUndoButtons(); updateEmptyHint(); }
  function updateEmptyHint() {
    let el = document.getElementById('scene-empty-hint');
    const empty = !S() || !S().count();
    if (empty && !el) {
      el = document.createElement('div'); el.id = 'scene-empty-hint';
      el.innerHTML = `<div class="seh-card"><div class="seh-title">Add a shape to begin</div>` +
        `<div class="seh-sub">Pick a shape from the <b>Objects</b> panel on the right.<br>` +
        `Then <b>drag to move</b> · <b>Edit Mesh</b> to model · assign <b>material zones</b> to faces.</div></div>`;
      const vp = document.getElementById('viewport'); if (vp) vp.appendChild(el);
      if (!document.getElementById('seh-style')) {
        const s = document.createElement('style'); s.id = 'seh-style';
        s.textContent = `#scene-empty-hint{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:3}
          #scene-empty-hint .seh-card{text-align:center;color:#aeb6c2;max-width:340px;padding:1.2rem 1.5rem;border-radius:14px;background:rgba(20,22,28,.6);border:1px solid rgba(255,255,255,.06)}
          #scene-empty-hint .seh-title{font-size:16px;font-weight:700;color:#e8a33d;margin-bottom:.4rem}
          #scene-empty-hint .seh-sub{font-size:12.5px;line-height:1.6}`;
        document.head.appendChild(s);
      }
    } else if (!empty && el) { el.remove(); }
  }

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
      <label>Page title<input id="pb-title" value="My 3D scene"></label>
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
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { ensurePane(); refresh(); });
  else { ensurePane(); refresh(); }

  return { enter, exit, refresh, publishDialog };
})();
