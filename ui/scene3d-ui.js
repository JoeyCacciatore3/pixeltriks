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
  let showView = null;   // set by ensurePane — navigates between main/shapes/inspector

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
      <!-- ── VIEW: main ───────────────────────────────────── -->
      <div class="s3-view" id="s3-view-main">
        <div class="s3-toolbar">
          <button class="s3-add-btn" id="s3-add-shape">＋ Add Shape</button>
          <button class="text-btn ghost s3-import-btn" id="s3-import">Import…</button>
          <button class="text-btn ghost s3-import-btn" id="s3-ph-model">Poly Haven…</button>
        </div>
        <ul id="s3-objects" class="layer-list"></ul>
        <p class="s3-empty-obj" id="s3-empty-obj">Click <b>+ Add Shape</b> to start.</p>
        <details class="s3-group" id="s3-env-group">
          <summary>Environment</summary>
          <div class="s3-group-body">
            <div class="s3-row">
              <button class="text-btn ghost" id="s3-hdr-file">HDRI file…</button>
              <button class="text-btn ghost" id="s3-ph-hdri">Poly Haven…</button>
              <button class="text-btn ghost" id="s3-env-clear">Clear</button>
            </div>
            <label class="mini">Background<select id="s3-bg">
              <option value="default">Studio (dark / HDRI)</option>
              <option value="transparent">Transparent</option>
              <option value="color">Solid color</option>
            </select></label>
            <input type="color" id="s3-bg-color" value="#0c0e11" title="Background color" style="margin-top:.3rem">
          </div>
        </details>
        <details class="s3-group" id="s3-light-group">
          <summary>Lighting</summary>
          <div class="s3-group-body">
            <label class="ck"><input type="checkbox" id="s3-shadows" checked> Cast shadows</label>
            <label class="mini"><span class="s3-top">Ambient<span class="s3-val" id="s3-amb-v">0.45</span></span>
              <input type="range" id="s3-amb" min="0" max="200" value="45"></label>
            <div class="s3-row">
              <label class="mini">Key color<input type="color" id="s3-key-color" value="#ffffff"></label>
              <label class="mini"><span class="s3-top">Key intensity<span class="s3-val" id="s3-key-v">1.60</span></span>
                <input type="range" id="s3-key" min="0" max="500" value="160"></label>
            </div>
            <div class="s3-row">
              <label class="mini">Rim color<input type="color" id="s3-rim-color" value="#e8a33d"></label>
              <label class="mini"><span class="s3-top">Rim intensity<span class="s3-val" id="s3-rim-v">0.50</span></span>
                <input type="range" id="s3-rim" min="0" max="200" value="50"></label>
            </div>
          </div>
        </details>
        <p class="s3-status" id="s3-status"></p>
      </div>

      <!-- ── VIEW: shape picker ───────────────────────────── -->
      <div class="s3-view" id="s3-view-shapes" hidden>
        <div class="s3-subnav">
          <button class="s3-back-btn" id="s3-shapes-back">← Scene</button>
          <span class="s3-subnav-title">Add Shape</span>
        </div>
        <p class="s3-subnav-hint">Tap a shape to add it. Return to Scene when done.</p>
        ${PRIM_GROUPS.map(([label, prims]) => `
          <div class="s3-shape-cat">
            <span class="s3-cat-label">${label}</span>
            <div class="pro-grid">${prims.map(([v, l]) =>
              `<button class="pro-btn" data-prim="${v}">${l}</button>`).join('')}</div>
          </div>`).join('')}
      </div>

      <!-- ── VIEW: object inspector ────────────────────────── -->
      <div class="s3-view" id="s3-view-inspector" hidden>
        <div class="s3-subnav">
          <button class="s3-back-btn" id="s3-insp-back">← Scene</button>
          <span class="s3-subnav-title" id="s3-insp-title">Object</span>
        </div>
        <div id="s3-inspector"></div>
      </div>`;

    /* ── navigation ──────────────────────────────────────── */
    showView = id => {
      pane.querySelectorAll('.s3-view').forEach(v => { v.hidden = v.id !== id; });
    };

    pane.querySelector('#s3-add-shape').addEventListener('click', () => showView('s3-view-shapes'));
    pane.querySelector('#s3-shapes-back').addEventListener('click', () => showView('s3-view-main'));
    pane.querySelector('#s3-insp-back').addEventListener('click', () => showView('s3-view-main'));

    /* ── shape picker ────────────────────────────────────── */
    pane.querySelectorAll('[data-prim]').forEach(b => b.addEventListener('click', () => {
      S().addPrimitive(b.dataset.prim);
      U.toast(b.textContent + ' added');
    }));

    /* ── imports ─────────────────────────────────────────── */
    $('#s3-import').addEventListener('click', () => $('#file-input').click());
    $('#s3-hdr-file').addEventListener('click', () => $('#file-input').click());
    pane.querySelector('#s3-ph-model').addEventListener('click', () => phPicker('models', async (id, name) => {
      U.toast('Importing ' + name + '…', 60000);
      try { await GF.library.importModel(id, name, '1k'); U.toast('Imported ' + name); }
      catch (e) { U.toast('Import failed: ' + e.message); }
    }));
    pane.querySelector('#s3-ph-hdri').addEventListener('click', () => phPicker('hdris', async (id, name) => {
      U.toast('Loading ' + name + '…', 60000);
      try { await S().setEnvironment(await GF.library.hdriUrl(id, '1k')); }
      catch (e) { U.toast('HDRI failed: ' + e.message); }
    }));
    pane.querySelector('#s3-env-clear').addEventListener('click', () => S().clearEnvironment());

    /* ── background ──────────────────────────────────────── */
    const bgSel = $('#s3-bg'), bgCol = $('#s3-bg-color');
    if (bgSel) bgSel.addEventListener('change', () => S().setBackground(bgSel.value, bgCol ? bgCol.value : '#0c0e11'));
    if (bgCol) bgCol.addEventListener('input', () => S().setBackground('color', bgCol.value));

    /* ── commands ────────────────────────────────────────── */
    if (GF.commands && !GF.commands.has('scene.refreshTex'))
      GF.commands.register({ id: 'scene.refreshTex', title: 'Refresh textures', group: '3D',
        run: () => { S().refreshAll(); U.toast('Textures refreshed'); } });

    S().setStatusCallback(msg => { const el = $('#s3-status'); if (el) el.textContent = msg; });
    S().onChange(() => { refresh(); });

    /* ── lighting ────────────────────────────────────────── */
    const shadowCk = $('#s3-shadows');
    if (shadowCk) shadowCk.addEventListener('change', () => {
      S().setShadows(shadowCk.checked);
      U.toast(shadowCk.checked ? 'Shadows on' : 'Shadows off');
    });
    const lightSlider = (sliderId, valId, lightName, scale) => {
      const el = $(sliderId), vel = $(valId); if (!el) return;
      el.addEventListener('input', () => {
        const v = el.value / scale;
        if (vel) vel.textContent = v.toFixed(2);
        S().setStudioLight(lightName, { intensity: v });
      });
    };
    lightSlider('#s3-amb', '#s3-amb-v', 'ambient', 100);
    lightSlider('#s3-key', '#s3-key-v', 'key', 100);
    lightSlider('#s3-rim', '#s3-rim-v', 'rim', 100);
    const keyColor = $('#s3-key-color');
    if (keyColor) keyColor.addEventListener('input', () => S().setStudioLight('key', { color: keyColor.value }));
    const rimColor = $('#s3-rim-color');
    if (rimColor) rimColor.addEventListener('input', () => S().setStudioLight('rim', { color: rimColor.value }));

    wireKeys();
  }

  /* ---- object list (renders into panel #s3-objects) ---- */
  function renderObjectsInto(list) {
    if (!list) return;
    list.innerHTML = '';
    const objs = S().listObjects();
    // empty hint
    const hint = $('#s3-empty-obj');
    if (hint) hint.style.display = objs.length ? 'none' : '';
    objs.forEach(o => {
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
      // clicking the object name selects AND opens the inspector sub-panel
      li.addEventListener('click', () => {
        S().select(o.id);
        const titleEl = $('#s3-insp-title');
        if (titleEl) titleEl.textContent = o.name;
        if (showView) showView('s3-view-inspector');
      });
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
      <div class="s3-insp-section">
        <div class="s3-insp-label">Transform</div>
        <div class="s3-grid">
          ${num('s3-px', 'X', t.px, 0.1)}${num('s3-py', 'Y', t.py, 0.1)}${num('s3-pz', 'Z', t.pz, 0.1)}
          ${num('s3-rx', 'RX°', t.rx, 5)}${num('s3-ry', 'RY°', t.ry, 5)}${num('s3-rz', 'RZ°', t.rz, 5)}
          ${num('s3-sx', 'SX', t.sx, 0.1)}${num('s3-sy', 'SY', t.sy, 0.1)}${num('s3-sz', 'SZ', t.sz, 0.1)}
        </div>
      </div>
      ${S().hasModelAnimations && S().hasModelAnimations() ? `
      <h3 class="panel-h">Animation</h3>
      <p class="s3-hint-line">Model loaded paused (rest pose).</p>
      <div class="s3-row">
        <button class="text-btn ghost" id="s3-anim-play">▶ Play</button>
        <button class="text-btn ghost" id="s3-anim-pause">⏸ Pause</button>
        <button class="text-btn ghost" id="s3-anim-stop">⏹ Reset</button>
      </div>` : ''}
      <div class="s3-insp-label">Material</div>
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
        <label class="mini"><span class="s3-top">Opacity<span class="s3-val" id="s3-opac-v">${(t.mat.opacity != null ? t.mat.opacity : 1).toFixed(2)}</span></span>
          <input type="range" id="s3-opac" min="0" max="100" value="${Math.round((t.mat.opacity != null ? t.mat.opacity : 1) * 100)}"></label>
        <div class="s3-row">
          <label class="mini">Emissive<input type="color" id="s3-emissive" value="${t.mat.emissive || '#000000'}"></label>
          <label class="mini"><span class="s3-top">Em. strength<span class="s3-val" id="s3-em-v">${(t.mat.emissiveIntensity || 0).toFixed(2)}</span></span>
            <input type="range" id="s3-em" min="0" max="300" value="${Math.round((t.mat.emissiveIntensity || 0) * 100)}"></label>
        </div>
        <details class="s3-group"><summary>Advanced maps</summary>
          <label class="mini">Normal map<select id="s3-normal">${mapOpts(t.mat.normalSource)}</select></label>
          <label class="mini">Roughness map<select id="s3-roughmap">${mapOpts(t.mat.roughSource)}</select></label>
          <div class="s3-row">
            <label class="mini">Repeat X<input type="number" id="s3-rep-x" step="0.5" min="0.1" value="${t.mat.mapRepeatX || 1}"></label>
            <label class="mini">Repeat Y<input type="number" id="s3-rep-y" step="0.5" min="0.1" value="${t.mat.mapRepeatY || 1}"></label>
          </div>
          <div class="s3-row">
            <label class="mini">Offset X<input type="number" id="s3-off-x" step="0.05" value="${t.mat.mapOffsetX || 0}"></label>
            <label class="mini">Offset Y<input type="number" id="s3-off-y" step="0.05" value="${t.mat.mapOffsetY || 0}"></label>
          </div>
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
    liveCommit($('#s3-opac'), $('#s3-opac-v'), el => ({ opacity: el.value / 100 }));
    liveCommit($('#s3-emissive'), null, el => ({ emissive: el.value }));
    liveCommit($('#s3-em'), $('#s3-em-v'), el => ({ emissiveIntensity: el.value / 100 }));
    const repX = $('#s3-rep-x'); if (repX) repX.addEventListener('change', () => S().setMaterial(id, { mapRepeatX: +repX.value || 1 }));
    const repY = $('#s3-rep-y'); if (repY) repY.addEventListener('change', () => S().setMaterial(id, { mapRepeatY: +repY.value || 1 }));
    const offX = $('#s3-off-x'); if (offX) offX.addEventListener('change', () => S().setMaterial(id, { mapOffsetX: +offX.value || 0 }));
    const offY = $('#s3-off-y'); if (offY) offY.addEventListener('change', () => S().setMaterial(id, { mapOffsetY: +offY.value || 0 }));
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
