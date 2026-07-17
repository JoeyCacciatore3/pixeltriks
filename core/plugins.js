/* PixelTriks — plugins.js
   Buildless plugin loader. A plugin is an ES module whose default export is
   `function (GF) { … }` — it registers commands via GF.commands.register()
   (and optionally GF.api.register()) and instantly appears in the palette,
   the remap dialog, and any surface it declares. See docs/PLUGINS.md.

   Loaded URLs persist in localStorage and re-load on every boot, AFTER the
   built-in surfaces have registered (so plugins can bind keys safely).
   Loading a URL executes its code with full app access — trust it first. */
'use strict';
window.GF = window.GF || {};

GF.plugins = (function () {
  const LS = 'pt-plugins';
  const loaded = [];

  function list() { try { return JSON.parse(localStorage.getItem(LS) || '[]'); } catch (e) { return []; } }
  function save(a) { try { localStorage.setItem(LS, JSON.stringify(a)); } catch (e) {} }

  async function load(url) {
    try {
      // dynamic import() in a classic script resolves against THIS file's URL
      // (core/) — resolve against the page instead so './plugins/x.js' works
      const mod = await import(new URL(url, document.baseURI).href);
      if (mod && typeof mod.default === 'function') mod.default(window.GF);
      loaded.push(url);
      GF.util.toast('Plugin loaded: ' + url.split('/').pop());
      return true;
    } catch (e) {
      GF.util.toast('Plugin failed (' + url.split('/').pop() + '): ' + e.message);
      return false;
    }
  }

  async function add(url) {
    const a = list();
    if (!a.includes(url)) { a.push(url); save(a); }
    return load(url);
  }

  function remove(url) { save(list().filter(u => u !== url)); }

  function boot() { list().forEach(load); }

  return { add, remove, list, load, boot, loaded: () => loaded.slice() };
})();
