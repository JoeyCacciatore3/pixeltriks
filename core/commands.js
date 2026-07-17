/* PixelTriks — commands.js
   The command registry. Every user-facing action is declared ONCE, with its
   title, icon, context gate (when), placement metadata, and input bindings.
   Surfaces — palette, hotbar, keyboard, transform pad, (future) gamepad —
   RENDER from this registry; they never hard-code a label, icon, or handler.

   Enforcement over convention:
   - register() throws on a duplicate id and on a taken home slot
     (the "no same-view duplicates" rule as a lint, not a guideline)
   - bind() throws if the command id is not registered
   - assertIds() lets a surface verify its layout at boot, so a renamed
     command is a startup error instead of a silently dead button.

   Command shape:
   { id, title, group?, icon?(inline svg), hint?(shortcut label), keywords?,
     when?(context expr — visibility), home?{surface, section, order},
     hotbar?{class?}, palette?(bool, default true), run(args) } */
'use strict';
window.GF = window.GF || {};

GF.commands = (function () {
  const C = new Map();
  const bindings = {};   // 'mod+z' → command id

  function register(cmd) {
    if (!cmd || !cmd.id || typeof cmd.run !== 'function') throw new Error('commands.register: id and run are required');
    if (C.has(cmd.id)) throw new Error('commands.register: duplicate id "' + cmd.id + '"');
    if (cmd.home) {
      for (const other of C.values()) {
        if (other.home && other.home.surface === cmd.home.surface &&
            other.home.section === cmd.home.section && other.home.order === cmd.home.order)
          throw new Error('commands.register: home slot ' + cmd.home.surface + '/' + cmd.home.section + '/' + cmd.home.order + ' taken by "' + other.id + '" (registering "' + cmd.id + '")');
      }
    }
    C.set(cmd.id, cmd);
    return cmd;
  }

  function get(id) { return C.get(id) || null; }
  function has(id) { return C.has(id); }
  function visible(cmd) { return GF.context.evaluate(cmd.when); }

  function execute(id, args) {
    const cmd = C.get(id);
    if (!cmd) throw new Error('unknown command: ' + id);
    GF.context.sync();
    if (!visible(cmd)) { GF.util.toast(cmd.title + ' — open an image first'); return; }
    return cmd.run(args || {});
  }

  /* --- keyboard / gamepad binding table (pure data → command ids) --- */
  function bind(key, id) {
    if (!C.has(id)) throw new Error('commands.bind: unknown command "' + id + '" for key "' + key + '"');
    if (bindings[key] && bindings[key] !== id) throw new Error('commands.bind: key "' + key + '" already bound to "' + bindings[key] + '"');
    bindings[key] = id;
  }
  function lookup(key) { return bindings[key] || null; }
  /* User remapping (ui/remap.js): rebind overwrites without the boot-time
     collision check; unbindKey removes. Persistence lives in the remap UI. */
  function rebind(key, id) {
    if (!C.has(id)) throw new Error('commands.rebind: unknown command "' + id + '"');
    bindings[key] = id;
  }
  function unbindKey(key) { delete bindings[key]; }
  function allBindings() { return Object.assign({}, bindings); }

  /* --- surface feeds --- */
  /** Palette entries: every visible, palette-eligible command. */
  function palette() {
    GF.context.sync();
    const out = [];
    for (const cmd of C.values()) {
      if (cmd.palette === false) continue;
      if (!visible(cmd)) continue;
      out.push({
        id: cmd.id, group: cmd.group || 'Other', label: cmd.title, hint: cmd.hint,
        home: cmd.home ? (cmd.home.surface + ' ▸ ' + cmd.home.section) : null,
        keywords: cmd.keywords || '',
        run: () => execute(cmd.id),
      });
    }
    return out;
  }

  /** Import every ui-annotated GF.api engine command as 'api.<name>'. */
  function importApi() {
    GF.api.commands().forEach(c => {
      register({
        id: 'api.' + c.name, title: c.label, group: c.group, hint: c.hint,
        when: c.needsDoc ? 'docOpen' : '',
        run: () => GF.api.run(c.name, {}),
      });
    });
  }

  /** Boot check for layout tables (hotbar contexts etc.): every id must exist. */
  function assertIds(ids, surface) {
    const missing = ids.filter(id => !C.has(id));
    if (missing.length) throw new Error('commands.assertIds(' + surface + '): unregistered command(s): ' + missing.join(', '));
  }

  function list() { return [...C.keys()]; }

  return { register, get, has, execute, bind, lookup, rebind, unbindKey, allBindings, palette, importApi, assertIds, list };
})();
