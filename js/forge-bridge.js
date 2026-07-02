/* forge-bridge.js — included by each editor (Texture/Sprite) when it runs inside
   Forge Studio. The shell and editor are separate file:// frames (origin "null"),
   so the shell can't touch the editor's DOM/globals directly — they talk over
   postMessage. This bridge runs INSIDE the editor frame: it executes the shell's
   commands via the editor's existing API (window.GF / window.__PF), hides the nav
   the shell now owns, and announces readiness. Harmless when the editor is opened
   standalone (no parent listening). */
(function () {
  'use strict';
  if (window.parent === window) return; // opened standalone, not embedded

  const HIDE = {
    texture: '.brand,#btn-new,#btn-library,#btn-help{display:none!important}',
    sprite:  '.brand,#btnNew,#btnOpen{display:none!important}',
  };
  const appName = () => (window.GF ? 'texture' : (window.__PF ? 'sprite' : null));

  function reply(id, ok, data) {
    if (id != null) parent.postMessage({ forge: true, reply: id, ok, data }, '*');
  }
  async function whenApi() {
    for (let i = 0; i < 100 && !appName(); i++) await new Promise((r) => setTimeout(r, 50));
    return appName();
  }

  window.addEventListener('message', async (e) => {
    const m = e.data;
    if (!m || !m.forge || m.reply != null || m.ready) return; // ignore non-commands
    const { id, type, payload = {} } = m;
    try {
      const app = await whenApi();
      if (!app) return reply(id, false, 'editor API not ready');

      if (type === 'ping') return reply(id, true, { app });

      if (type === 'state') {
        if (app === 'texture') {
          const d = window.GF.doc.doc;
          return reply(id, true, { app, open: !!(d && d.open), w: d && d.width, h: d && d.height, layers: d ? d.layers.length : 0 });
        }
        const p = window.__PF.S.proj;
        return reply(id, true, { app, w: p.w, h: p.h, frames: p.frames.length });
      }

      if (type === 'new') {
        if (app === 'texture') window.GF.api.run('newDoc', { w: payload.w, h: payload.h, bg: payload.bg || 'transparent' });
        else window.__PF.newProjectTo(payload.w, payload.h);
        return reply(id, true, { app });
      }

      reply(id, false, 'unknown command: ' + type);
    } catch (err) {
      reply(id, false, String((err && err.message) || err));
    }
  });

  // Hide the duplicated nav + announce readiness once the editor has booted.
  (async function init() {
    const app = await whenApi();
    if (app) {
      try {
        const s = document.createElement('style');
        s.id = 'forge-shell-hide'; s.textContent = HIDE[app];
        document.head.appendChild(s);
      } catch {}
    }
    parent.postMessage({ forge: true, ready: true, app: app || '?' }, '*');
  })();
})();
