/* ============================================================
   PixelTriks — editmesh-ui.js  (GF.editmeshUI)
   The Edit-Mode surface: registers the mesh commands (Tab toggle,
   vertex/edge/face modes, operators, material zones), renders a
   floating edit toolbar while GF.editmesh is active, and shows live
   counts + a material-zones strip. Thin — all logic lives in
   core/editmesh.js.
   ============================================================ */
'use strict';
window.GF = window.GF || {};

GF.editmeshUI = (function () {
  const U = GF.util;
  const EM = () => GF.editmesh;
  let bar = null, zonesRow = null;

  const MODES = [['vertex', 'Verts', '1'], ['edge', 'Edges', '2'], ['face', 'Faces', '3']];
  const OPS = [
    ['grab', 'Grab', 'G', () => EM().grab()],
    ['rotate', 'Rotate', 'R', () => EM().rotate()],
    ['scale', 'Scale', 'S', () => EM().scale()],
    ['extrude', 'Extrude', 'E', () => EM().extrude()],
    ['inset', 'Inset', 'I', () => EM().inset()],
    ['bevel', 'Bevel', '⌃B', () => EM().bevel()],
    ['loopcut', 'Loop cut', '⌃R', () => EM().loopcut()],
    ['subdivide', 'Subdivide', '', () => EM().subdivide()],
    ['merge', 'Merge', 'M', () => EM().merge()],
    ['dissolve', 'Dissolve', '⌃X', () => EM().dissolve()],
    ['delete', 'Delete', '⌫', () => EM().deleteSelection()],
  ];

  function init() {
    injectStyle();
    registerCommands();
    buildBar();
    window.addEventListener('pt:editmode', e => show(e.detail.active));
  }

  function registerCommands() {
    const reg = GF.commands.register, bind = GF.commands.bind;
    reg({ id: 'mesh.editToggle', title: 'Edit mesh (enter / exit)', group: 'Mesh', hint: 'Tab', run: () => EM() && EM().toggle() });
    bind('tab', 'mesh.editToggle');
    MODES.forEach(([m, label]) => reg({ id: 'mesh.mode.' + m, title: 'Edit: ' + label, group: 'Mesh', palette: false, run: () => EM() && EM().setMode(m) }));
    reg({ id: 'mesh.grab', title: 'Grab (move) selection', group: 'Mesh', hint: 'G', run: () => EM() && EM().grab() });
    reg({ id: 'mesh.rotate', title: 'Rotate selection', group: 'Mesh', hint: 'R', run: () => EM() && EM().rotate() });
    reg({ id: 'mesh.scale', title: 'Scale selection', group: 'Mesh', hint: 'S', run: () => EM() && EM().scale() });
    reg({ id: 'mesh.extrude', title: 'Extrude faces', group: 'Mesh', hint: 'E', run: () => EM() && EM().extrude() });
    reg({ id: 'mesh.inset', title: 'Inset faces', group: 'Mesh', hint: 'I', run: () => EM() && EM().inset() });
    reg({ id: 'mesh.bevel', title: 'Bevel (chamfer edges)', group: 'Mesh', hint: 'Ctrl+B', run: () => EM() && EM().bevel() });
    reg({ id: 'mesh.loopcut', title: 'Loop cut', group: 'Mesh', hint: 'Ctrl+R', run: () => EM() && EM().loopcut() });
    reg({ id: 'mesh.subdivide', title: 'Subdivide', group: 'Mesh', run: () => EM() && EM().subdivide() });
    reg({ id: 'mesh.merge', title: 'Merge vertices', group: 'Mesh', hint: 'M', run: () => EM() && EM().merge() });
    reg({ id: 'mesh.dissolve', title: 'Dissolve selection', group: 'Mesh', hint: 'Ctrl+X', run: () => EM() && EM().dissolve() });
    reg({ id: 'mesh.delete', title: 'Delete selection', group: 'Mesh', run: () => EM() && EM().deleteSelection() });
    reg({ id: 'mesh.newZone', title: 'New material zone from selected faces', group: 'Mesh', run: () => EM() && EM().addZone() });
  }

  function buildBar() {
    bar = document.createElement('div');
    bar.id = 'editbar'; bar.hidden = true;
    bar.innerHTML =
      `<div class="eb-main">` +
        `<div class="eb-grp eb-modes">` +
          MODES.map(([m, l, k]) => `<button class="eb-btn" data-mode="${m}" title="${l} (${k})"><span>${l}</span><span class="eb-k">${k}</span></button>`).join('') +
        `</div><div class="eb-sep"></div><div class="eb-grp eb-ops">` +
          OPS.map(([id, l, k]) => `<button class="eb-btn" data-op="${id}" title="${l}${k ? ' (' + k + ')' : ''}"><span>${l}</span>${k ? `<span class="eb-k">${k}</span>` : ''}</button>`).join('') +
        `</div><div class="eb-sep"></div><span class="eb-stat" id="eb-stat"></span>` +
        `<button class="eb-btn eb-exit" data-exit title="Exit edit mode (Tab)">Done</button>` +
      `</div>` +
      `<div class="eb-zones" id="eb-zones" hidden>` +
        `<span class="eb-zlabel">Zones</span>` +
        `<div class="eb-swatches" id="eb-swatches"></div>` +
        `<button class="eb-btn eb-accent" id="eb-newzone" title="Make the selected faces a new material zone">＋ New from faces</button>` +
        `<button class="eb-btn" id="eb-assign" title="Assign the selected faces to the active zone">Assign →</button>` +
        `<label class="eb-zctl">Colour <input type="color" id="eb-zcolor" value="#e8a33d"></label>` +
        `<label class="eb-zctl">Texture <select id="eb-ztex"></select></label>` +
        `<button class="eb-btn eb-del" id="eb-delzone" title="Delete the active zone">🗑</button>` +
      `</div>`;
    document.body.appendChild(bar);
    bar.querySelectorAll('[data-mode]').forEach(b => b.addEventListener('click', () => EM().setMode(b.dataset.mode)));
    bar.querySelectorAll('[data-op]').forEach(b => { const o = OPS.find(x => x[0] === b.dataset.op); b.addEventListener('click', o[3]); });
    bar.querySelector('[data-exit]').addEventListener('click', () => EM().exit());
    zonesRow = bar.querySelector('#eb-zones');
    bar.querySelector('#eb-newzone').addEventListener('click', () => EM().addZone());
    bar.querySelector('#eb-assign').addEventListener('click', () => EM().assignSelection());
    bar.querySelector('#eb-zcolor').addEventListener('input', e => EM().setZone(EM().activeZone(), { color: e.target.value }));
    bar.querySelector('#eb-ztex').addEventListener('change', e => EM().setZone(EM().activeZone(), { tex: e.target.value || null }));
    bar.querySelector('#eb-delzone').addEventListener('click', () => EM().deleteZone(EM().activeZone()));
  }

  function show(on) { if (bar) bar.hidden = !on; document.body.classList.toggle('editing', !!on); }

  let texFilled = false;
  function status(s) {
    if (!bar) return;
    bar.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === s.mode));
    const stat = bar.querySelector('#eb-stat');
    if (stat) {
      const key = s.mode[0], selN = s.sel[key], totN = s.counts[key];
      stat.textContent = s.modal
        ? `${s.modal}${s.axis ? ' · axis' : ''} — move mouse, click to confirm, Esc cancel`
        : `${selN}/${totN} ${s.mode === 'vertex' ? 'verts' : s.mode + 's'} · ${s.counts.f} faces`;
    }
    // zones strip — only meaningful when selecting faces
    zonesRow.hidden = s.mode !== 'face';
    if (s.mode === 'face') renderZones(s);
  }

  function renderZones(s) {
    const wrap = bar.querySelector('#eb-swatches');
    wrap.innerHTML = (s.zones || []).map(z =>
      `<button class="eb-sw${z.active ? ' on' : ''}" data-z="${z.index}" title="${z.name} — ${z.faceCount} face(s). Click to select its faces.">` +
      `<span class="eb-dot" style="background:${z.color}"></span>${z.index === 0 ? 'Base' : z.name.replace('Zone ', 'Z')}<span class="eb-ct">${z.faceCount}</span></button>`).join('');
    wrap.querySelectorAll('[data-z]').forEach(b => {
      b.addEventListener('click', () => EM().selectZoneFaces(+b.dataset.z));
    });
    const active = (s.zones || [])[s.activeZone];
    const col = bar.querySelector('#eb-zcolor'); if (active && col) col.value = active.color || '#cccccc';
    const del = bar.querySelector('#eb-delzone'); if (del) del.disabled = s.activeZone === 0;
    const sel = bar.querySelector('#eb-ztex');
    if (sel && !texFilled) {
      sel.innerHTML = `<option value="">None (flat colour)</option>` + (s.presets || []).map(p => `<option value="${p.id}">${p.label}</option>`).join('');
      texFilled = true;
    }
    if (sel && active) sel.value = active.tex || '';
  }

  function injectStyle() {
    if (document.getElementById('editbar-style')) return;
    const css = `
    #editbar{position:fixed;left:50%;bottom:76px;transform:translateX(-50%);z-index:60;
      display:flex;flex-direction:column;gap:.4rem;padding:.45rem .55rem;border-radius:12px;
      background:rgba(18,20,26,.95);border:1px solid rgba(255,255,255,.09);
      box-shadow:0 8px 30px rgba(0,0,0,.45);backdrop-filter:blur(8px);font-size:12px;
      max-width:calc(100vw - 24px)}
    #editbar .eb-main{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;justify-content:center}
    #editbar .eb-grp{display:flex;gap:.25rem;flex-wrap:wrap}
    #editbar .eb-sep{width:1px;align-self:stretch;background:rgba(255,255,255,.1);margin:2px 0}
    #editbar .eb-btn{display:inline-flex;align-items:center;gap:.35rem;padding:.34rem .5rem;
      border-radius:8px;border:1px solid rgba(255,255,255,.08);background:rgba(255,255,255,.03);
      color:#d7dbe2;cursor:pointer;font-weight:600;line-height:1;white-space:nowrap}
    #editbar .eb-btn:hover{background:rgba(255,255,255,.09);color:#fff}
    #editbar .eb-btn:disabled{opacity:.4;cursor:default}
    #editbar .eb-btn.on{background:#e8a33d;border-color:#e8a33d;color:#1a1400}
    #editbar .eb-accent{background:rgba(232,163,61,.16);border-color:rgba(232,163,61,.45);color:#e8a33d}
    #editbar .eb-k{font-size:10px;opacity:.6;border:1px solid currentColor;border-radius:4px;padding:0 .25rem;line-height:1.3}
    #editbar .eb-exit{background:rgba(232,163,61,.14);border-color:rgba(232,163,61,.4);color:#e8a33d}
    #editbar .eb-stat{color:#96a0ad;padding:0 .3rem;min-width:120px;text-align:center}
    #editbar .eb-zones{display:flex;align-items:center;gap:.5rem;flex-wrap:wrap;justify-content:center;
      border-top:1px solid rgba(255,255,255,.08);padding-top:.4rem}
    #editbar .eb-zlabel{color:#e8a33d;font-weight:700;letter-spacing:.03em;text-transform:uppercase;font-size:10px}
    #editbar .eb-swatches{display:flex;gap:.25rem;flex-wrap:wrap}
    #editbar .eb-sw{display:inline-flex;align-items:center;gap:.3rem;padding:.28rem .45rem;border-radius:8px;
      border:1px solid rgba(255,255,255,.1);background:rgba(255,255,255,.03);color:#d7dbe2;cursor:pointer;font-weight:600}
    #editbar .eb-sw.on{border-color:#e8a33d;background:rgba(232,163,61,.12)}
    #editbar .eb-dot{width:12px;height:12px;border-radius:3px;box-shadow:0 0 0 1px rgba(0,0,0,.35) inset}
    #editbar .eb-ct{font-size:10px;opacity:.6}
    #editbar .eb-zctl{display:inline-flex;align-items:center;gap:.3rem;color:#96a0ad}
    #editbar .eb-zctl input[type=color]{width:26px;height:22px;border:none;background:none;padding:0;border-radius:5px;cursor:pointer}
    #editbar .eb-zctl select{background:#181b22;color:#d7dbe2;border:1px solid rgba(255,255,255,.12);border-radius:6px;padding:.2rem .3rem}
    @media (max-width:720px){#editbar .eb-stat{display:none}#editbar{bottom:64px}}`;
    const el = document.createElement('style'); el.id = 'editbar-style'; el.textContent = css;
    document.head.appendChild(el);
  }

  return { init, status, show };
})();
