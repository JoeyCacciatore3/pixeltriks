/* PixelTriks — remap.js
   Controls & plugins dialog: rebind keyboard shortcuts, remap gamepad
   buttons, tune gamepad feel, and manage plugins. All possible because
   bindings are DATA — a key table in core/commands.js and a button table in
   ui/gamepad.js. User overrides persist in localStorage and are applied at
   boot (after every surface has registered its commands). */
'use strict';
window.GF = window.GF || {};

GF.remap = (function () {
  const LS_KEYS = 'pt-key-overrides';
  let keyDefaults = null;    // boot-time binding snapshot, for Reset

  function fmt(sig) {
    return sig.split('+').map(p =>
      p === 'mod' ? 'Ctrl/⌘' : p === 'shift' ? 'Shift' : p.length === 1 ? p.toUpperCase() : p
    ).join('+');
  }
  const loadOv = () => { try { return JSON.parse(localStorage.getItem(LS_KEYS) || '{}'); } catch (e) { return {}; } };
  const saveOv = o => { try { localStorage.setItem(LS_KEYS, JSON.stringify(o)); } catch (e) {} };

  function applyOverrides() {
    const o = loadOv();
    for (const sig in o) {
      if (o[sig] === null) GF.commands.unbindKey(sig);
      else if (GF.commands.has(o[sig])) GF.commands.rebind(sig, o[sig]);
    }
  }

  function title(id) { const c = GF.commands.get(id); return c ? c.title : id; }

  /* <select> of every registered command, grouped */
  function commandSelect(selectedId) {
    const groups = {};
    GF.commands.list().forEach(id => {
      const c = GF.commands.get(id), g = c.group || 'Other';
      (groups[g] = groups[g] || []).push({ id, title: c.title });
    });
    let html = '<select class="remap-select">';
    Object.keys(groups).sort().forEach(g => {
      html += `<optgroup label="${g}">` + groups[g]
        .sort((a, b) => a.title.localeCompare(b.title))
        .map(c => `<option value="${c.id}"${c.id === selectedId ? ' selected' : ''}>${c.title}</option>`)
        .join('') + '</optgroup>';
    });
    return html + '</select>';
  }

  function open() {
    GF.ui.modal({
      title: 'Controls & plugins',
      sub: 'Every binding is data — remap anything. Changes save automatically.',
      body: '<div id="remap-root" style="max-height:56vh;overflow-y:auto"></div>',
      ok: 'Done', noCancel: true,
      extra: [['Reset all to defaults', () => { resetAll(); render(document.querySelector('#remap-root')); }]],
      mount: card => render(card.querySelector('#remap-root')),
    });
  }

  function render(root) {
    if (!root) return;
    const binds = GF.commands.allBindings();
    const sigs = Object.keys(binds).sort((a, b) => title(binds[a]).localeCompare(title(binds[b])));
    let html = '<h3 class="panel-h first">Keyboard</h3><table class="remap-table">';
    sigs.forEach(sig => {
      /* BUG-016 fix: escape command titles before innerHTML insertion */
      html += `<tr><td>${GF.util.esc(title(binds[sig]))}</td><td><span class="kbd">${GF.util.esc(fmt(sig))}</span></td>
        <td><button class="text-btn ghost remap-change" data-sig="${sig}">Change</button></td></tr>`;
    });
    html += '</table>';

    if (GF.gamepad) {
      const pad = GF.gamepad.getBindings();
      const LABELS = { LEFT: '◄ D-pad', RIGHT: '► D-pad', UP: '▲ D-pad', DOWN: '▼ D-pad',
        B: 'Ⓑ', X: 'Ⓧ', Y: 'Ⓨ', L1: 'L1', R1: 'R1', L3: 'L3 (stick click)', START: 'Start', SELECT: 'Select' };
      html += '<h3 class="panel-h">Gamepad buttons</h3><table class="remap-table">';
      Object.keys(pad).forEach(btn => {
        html += `<tr><td><span class="kbd">${LABELS[btn] || btn}</span></td>
          <td colspan="2"><span class="remap-pad" data-btn="${btn}">${commandSelect(pad[btn])}</span></td></tr>`;
      });
      html += '</table>';

      const t = GF.gamepad.getTuning();
      html += `<h3 class="panel-h">Gamepad feel</h3>
        <label class="remap-slider">Sensitivity <span id="rm-sens-v">${t.sens.toFixed(1)}×</span>
          <input type="range" id="rm-sens" min="0.2" max="3" step="0.1" value="${t.sens}"></label>
        <label class="remap-slider">Dead zone <span id="rm-dz-v">${Math.round(t.dz * 100)}%</span>
          <input type="range" id="rm-dz" min="0.05" max="0.4" step="0.01" value="${t.dz}"></label>
        <label class="remap-slider">Response curve <span id="rm-curve-v">${t.curve.toFixed(1)}</span>
          <input type="range" id="rm-curve" min="1" max="3" step="0.1" value="${t.curve}"></label>`;
    }

    if (GF.plugins) {
      html += '<h3 class="panel-h">Plugins</h3><p class="sub" style="margin:.2rem 0 .5rem">ES modules that call <code>GF.commands.register()</code> — see docs/PLUGINS.md. Only load code you trust.</p>';
      const list = GF.plugins.list();
      html += list.length
        ? '<table class="remap-table">' + list.map(u =>
            `<tr><td style="word-break:break-all">${u}</td><td><button class="text-btn ghost remap-plug-rm" data-url="${u}">Remove</button></td></tr>`).join('') + '</table>'
        : '<p class="sub">No plugins loaded.</p>';
      html += `<div class="row" style="margin-top:.4rem"><input type="text" id="rm-plug-url" placeholder="./plugins/hello.js or https://…" style="flex:1">
        <button class="text-btn" id="rm-plug-add">Add & load</button></div>`;
    }

    root.innerHTML = html;
    wire(root);
  }

  function wire(root) {
    // keyboard: capture the next key press for this row's command
    root.querySelectorAll('.remap-change').forEach(btn => btn.addEventListener('click', () => {
      const oldSig = btn.dataset.sig, id = GF.commands.lookup(oldSig);
      if (!id) return render(root);
      btn.textContent = 'press keys…';
      const grab = e => {
        e.preventDefault(); e.stopPropagation();
        window.removeEventListener('keydown', grab, true);
        const k = e.key.toLowerCase();
        if (k === 'escape') return render(root);
        if (k === 'shift' || k === 'control' || k === 'meta' || k === 'alt') return render(root);
        const sig = ((e.ctrlKey || e.metaKey) ? 'mod+' : '') + (e.shiftKey ? 'shift+' : '') + k;
        const o = loadOv();
        GF.commands.unbindKey(oldSig); o[oldSig] = null;
        GF.commands.rebind(sig, id); o[sig] = id;
        saveOv(o);
        GF.util.toast(title(id) + ' → ' + fmt(sig));
        render(root);
      };
      window.addEventListener('keydown', grab, true);
    }));
    // gamepad buttons
    root.querySelectorAll('.remap-pad select').forEach(sel => sel.addEventListener('change', () => {
      const btn = sel.closest('.remap-pad').dataset.btn;
      try { GF.gamepad.setBinding(btn, sel.value); GF.util.toast(btn + ' → ' + title(sel.value)); }
      catch (e) { GF.util.toast(e.message); }
    }));
    // tuning sliders (live)
    const slider = (id, key, fmtV) => {
      const el = root.querySelector('#rm-' + id); if (!el) return;
      el.addEventListener('input', () => {
        GF.gamepad.setTuning({ [key]: +el.value });
        root.querySelector('#rm-' + id + '-v').textContent = fmtV(GF.gamepad.getTuning()[key]);
      });
    };
    slider('sens', 'sens', v => v.toFixed(1) + '×');
    slider('dz', 'dz', v => Math.round(v * 100) + '%');
    slider('curve', 'curve', v => v.toFixed(1));
    // plugins
    const add = root.querySelector('#rm-plug-add');
    if (add) add.addEventListener('click', async () => {
      const url = root.querySelector('#rm-plug-url').value.trim();
      if (!url) return;
      await GF.plugins.add(url);
      render(root);
    });
    root.querySelectorAll('.remap-plug-rm').forEach(b => b.addEventListener('click', () => {
      GF.plugins.remove(b.dataset.url);
      GF.util.toast('Removed (takes effect on reload)');
      render(root);
    }));
  }

  function resetAll() {
    const cur = GF.commands.allBindings();
    for (const k in cur) GF.commands.unbindKey(k);
    for (const k in keyDefaults) GF.commands.rebind(k, keyDefaults[k]);
    try { localStorage.removeItem(LS_KEYS); } catch (e) {}
    if (GF.gamepad) GF.gamepad.resetPrefs();
    GF.util.toast('Controls reset to defaults');
  }

  function init() {
    keyDefaults = GF.commands.allBindings();   // snapshot BEFORE user overrides
    applyOverrides();
    GF.commands.register({ id: 'help.controls', title: 'Controls & plugins… (remap keys / gamepad)', group: 'Help', run: open });
  }

  return { init, open };
})();
