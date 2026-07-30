/* PixelTriks — api.js
   AI-operator surface. Everything the UI can do is exposed as a flat,
   discoverable command catalog so an automated agent (LLM with JS eval,
   browser automation, an MCP wrapper) can drive the app:

     GF.api.describe()        -> [{name, params, doc}]  machine-readable catalog
     GF.api.run(name, args)   -> executes; returns a result or a Promise
     GF.api.state()           -> current 3D scene state
     GF.api.snapshot(scale?)  -> PNG dataURL of the 3D viewport (the agent's "eyes")

   3D-only build: the 2D document/layer/selection/filter commands were removed
   with the 2D editor. scene3d.* and materials.* commands register themselves
   from core/scene3d.js and core/assets.js via GF.api.register. */
'use strict';
window.GF = window.GF || {};

GF.api = (function () {
  const U = GF.util;
  const C = {};
  // ui (optional): {group, label, hint?} — commands carrying it are surfaced in
  // the command palette (GF.commands.importApi), so every user-facing action has
  // exactly one implementation and one catalog entry.
  const cmd = (name, params, doc, fn, ui) => { C[name] = { params, doc, fn, ui }; };

  /* --- edit: undo / redo always route to the 3D scene's own history stack --- */
  cmd('undo', '', 'Undo', () => GF.scene3d.hist.undo(),
      { group: 'Edit', label: 'Undo', hint: 'Ctrl+Z' });
  cmd('redo', '', 'Redo', () => GF.scene3d.hist.redo(),
      { group: 'Edit', label: 'Redo', hint: 'Ctrl+Y' });

  /* --- introspection --- */
  function state() {
    const S = GF.scene3d;
    return {
      mode: '3d',
      objects: S ? S.listObjects() : [],
      selected: S ? S.selectedId() : null,
      history: S ? { canUndo: S.hist.canUndo(), canRedo: S.hist.canRedo() } : { canUndo: false, canRedo: false }
    };
  }
  function snapshot() {
    const el = GF.scene3d && GF.scene3d.rendererEl && GF.scene3d.rendererEl();
    return el ? el.toDataURL('image/png') : null;
  }

  function describe() { return Object.keys(C).map(k => ({ name: k, params: C[k].params, doc: C[k].doc })); }
  /** Palette-facing subset: every command annotated with ui metadata. */
  function commands() { return Object.keys(C).filter(k => C[k].ui).map(k => Object.assign({ name: k }, C[k].ui)); }
  function run(name, args) {
    if (!C[name]) throw new Error('unknown command: ' + name + ' — call GF.api.describe()');
    const out = C[name].fn(args || {});
    if (GF.ui && GF.ui.refreshLayers) GF.ui.refreshLayers();
    return out;
  }

  return { describe, run, state, snapshot, commands, register: cmd };
})();
