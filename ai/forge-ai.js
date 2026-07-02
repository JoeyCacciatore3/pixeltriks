/* ============================================================
   PixelTriks — ai/forge-ai.js
   Provider-agnostic AI adapter. Bring-your-own-key; the key lives
   in memory for the session only (never written to disk/localStorage).

   Built-in providers:
     • removebg  — remove.bg one-click cutout (active layer -> transparent)
     • fal       — fal.ai generative fill / inpaint (selection + prompt)
     • custom    — any endpoint; response is scanned for an image
                   (data URL, image link, or raw base64), Sprite-AI-Bridge style.

   Results always come back as a NEW, non-destructive layer.

   CORS: pages opened from file:// (or a different origin than the API) may be
   blocked by the browser. Set a `proxy` prefix (e.g. the bundled
   tools/cors-proxy.js at http://localhost:8787/?url=) to forward the request.
   ============================================================ */
'use strict';
window.GF = window.GF || {};

GF.ai = (function () {
  const U = () => GF.util, D = () => GF.doc;

  // in-memory only
  let cfg = {
    provider: 'removebg',
    key: '',
    proxy: '',                         // e.g. 'http://localhost:8787/?url='
    endpoint: '',                      // custom provider URL
    falModel: 'fal-ai/flux-pro/v1/fill', // inpaint/fill model id
  };

  function config() { return Object.assign({}, cfg, { key: cfg.key ? '••••' + cfg.key.slice(-4) : '' }); }
  function setConfig(patch) { Object.assign(cfg, patch || {}); }
  function hasKey() { return !!cfg.key; }

  /* wrap a URL through the optional CORS proxy */
  function viaProxy(url) { return cfg.proxy ? cfg.proxy + encodeURIComponent(url) : url; }

  /* -------- canvas helpers -------- */
  function activeLayerCanvas() {
    const L = D().active();
    if (!L || !L.canvas) throw new Error('Open an image first');
    // document-aligned copy of the active layer
    const c = U().makeCanvas(D().doc.width, D().doc.height);
    U().ctx2d(c).drawImage(L.canvas, L.x || 0, L.y || 0);
    return c;
  }
  function compositeCanvas() { return D().composite(); }
  function selectionMaskCanvas() {
    // fal/inpaint convention: WHITE = fill area, black elsewhere.
    // GF.select.maskCanvas() encodes coverage in ALPHA with rgb=0, so we must
    // recolor the covered alpha to white before flattening onto black — drawing
    // it straight onto black would stay black (the original bug).
    if (!GF.select || !GF.select.has || !GF.select.has()) return null;
    const w = D().doc.width, h = D().doc.height;
    const white = U().makeCanvas(w, h), wc = U().ctx2d(white);
    wc.drawImage(GF.select.maskCanvas(), 0, 0);      // alpha = coverage, rgb = 0
    wc.globalCompositeOperation = 'source-in';
    wc.fillStyle = '#fff'; wc.fillRect(0, 0, w, h);  // -> white where selected
    const out = U().makeCanvas(w, h), oc = U().ctx2d(out);
    oc.fillStyle = '#000'; oc.fillRect(0, 0, w, h);
    oc.drawImage(white, 0, 0);                        // white-on-black
    return out;
  }
  function canvasToDataURL(c) { return c.toDataURL('image/png'); }
  function canvasToBlob(c) { return new Promise(res => c.toBlob(res, 'image/png')); }

  function addResultLayer(img, name) {
    GF.history.push(D().doc, 'ai: ' + name);
    const L = D().addLayer(name);
    const c = U().ctx2d(L.canvas), dw = D().doc.width, dh = D().doc.height;
    // cover-fit preserving aspect (avoid squashing when the model returns a
    // different aspect ratio); same-size results (e.g. remove.bg) draw 1:1.
    const s = Math.max(dw / img.width, dh / img.height);
    const w = img.width * s, h = img.height * s;
    c.drawImage(img, (dw - w) / 2, (dh - h) / 2, w, h);
    GF.ui.refreshLayers(); GF.view.requestRender();
    U().toast('AI result added as a new layer');
  }
  function loadImage(src) {
    return new Promise((res, rej) => {
      const im = new Image(); im.crossOrigin = 'anonymous';
      im.onload = () => res(im); im.onerror = () => rej(new Error('AI returned an image that failed to load'));
      im.src = src;
    });
  }

  /* scan an arbitrary JSON/text response for the first usable image */
  function findImageInResponse(any) {
    const seen = [];
    (function walk(v) {
      if (v == null) return;
      if (typeof v === 'string') { seen.push(v.trim()); return; }
      if (Array.isArray(v)) { v.forEach(walk); return; }
      if (typeof v === 'object') { Object.values(v).forEach(walk); }
    })(any);
    // strict: data URLs, image-extension URLs, long base64 (incl. base64url + whitespace)
    for (const s of seen) {
      if (/^data:image\//.test(s)) return s;
      if (/^https?:\/\/\S+\.(png|jpe?g|webp|gif|avif)(\?\S*)?$/i.test(s)) return s;
      const b = s.replace(/\s+/g, '');
      if (/^[A-Za-z0-9+/_-]{200,}={0,2}$/.test(b)) return 'data:image/png;base64,' + b;
    }
    // fallback: first plain http(s) URL that isn't an obvious web page —
    // fal.media / replicate CDNs commonly return extensionless image URLs.
    for (const s of seen) {
      if (/^https?:\/\/[^\s"']+$/.test(s) && !/\.(html?|json|txt|css|js)(\?|$)/i.test(s)) return s;
    }
    return null;
  }

  /* ===================== providers ===================== */

  // remove.bg — multipart upload, returns a binary PNG cutout
  async function removeBg() {
    if (!cfg.key) throw new Error('Add your remove.bg API key in ✦ AI');
    const blob = await canvasToBlob(activeLayerCanvas());
    const fd = new FormData();
    fd.append('image_file', blob, 'image.png');
    fd.append('size', 'auto');
    const r = await fetch(viaProxy('https://api.remove.bg/v1.0/removebg'), {
      method: 'POST', headers: { 'X-Api-Key': cfg.key }, body: fd,
    });
    if (!r.ok) throw new Error('remove.bg: ' + r.status + ' ' + (await r.text()).slice(0, 140));
    const out = await r.blob();
    const img = await loadImage(URL.createObjectURL(out));
    addResultLayer(img, 'cutout');
  }

  // fal.ai — generative fill / inpaint. Needs a selection (the area to fill).
  async function falFill(prompt) {
    if (!cfg.key) throw new Error('Add your fal.ai API key in ✦ AI');
    const mask = selectionMaskCanvas();
    if (!mask) throw new Error('Select the area to fill first (Smart select / Marquee)');
    if (!prompt) throw new Error('Describe what to generate (prompt)');
    const body = {
      prompt,
      image_url: canvasToDataURL(compositeCanvas()),
      mask_url: canvasToDataURL(mask),
    };
    const url = cfg.endpoint || ('https://fal.run/' + cfg.falModel);
    const r = await fetch(viaProxy(url), {
      method: 'POST',
      headers: { 'Authorization': 'Key ' + cfg.key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('fal.ai: ' + r.status + ' ' + (await r.text()).slice(0, 140));
    const json = await r.json();
    const src = findImageInResponse(json);
    if (!src) throw new Error('fal.ai returned no image');
    const img = await loadImage(/^https?:/.test(src) ? viaProxy(src) : src);
    addResultLayer(img, 'generative fill');
  }

  // custom — POST whatever the user configured; scan the response for an image
  async function customCall(prompt) {
    if (!cfg.endpoint) throw new Error('Set a custom endpoint in ✦ AI');
    const body = {
      prompt,
      image: canvasToDataURL(compositeCanvas()),
      mask: (() => { const m = selectionMaskCanvas(); return m ? canvasToDataURL(m) : undefined; })(),
    };
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.key) headers['Authorization'] = 'Bearer ' + cfg.key;
    const r = await fetch(viaProxy(cfg.endpoint), { method: 'POST', headers, body: JSON.stringify(body) });
    if (!r.ok) throw new Error('AI: ' + r.status + ' ' + (await r.text()).slice(0, 140));
    let payload; const txt = await r.text();
    try { payload = JSON.parse(txt); } catch { payload = txt; }
    const src = findImageInResponse(payload);
    if (!src) throw new Error('No image found in the AI response');
    const img = await loadImage(/^https?:/.test(src) ? viaProxy(src) : src);
    addResultLayer(img, 'ai result');
  }

  /* ===================== entry point ===================== */
  async function run(opts) {
    opts = opts || {};
    if (!D().doc.open) throw new Error('Open an image first');
    try {
      if (cfg.provider === 'removebg') return await removeBg();
      if (cfg.provider === 'fal')      return await falFill(opts.prompt || '');
      return await customCall(opts.prompt || '');
    } catch (e) {
      // CORS / network failures from file:// are common — guide the user
      if (e instanceof TypeError && /fetch|network/i.test(e.message || '')) {
        throw new Error('Request blocked (CORS/offline). Run tools/cors-proxy.js and set the proxy prefix in ✦ AI.');
      }
      throw e;
    }
  }

  return { config, setConfig, hasKey, run, _findImageInResponse: findImageInResponse };
})();

/* Register AI as a first-class command so the palette (and any automated
   agent driving GF.api) reaches it through the same catalog as everything
   else. With no key configured it opens the config dialog instead. */
if (GF.api && GF.api.register) {
  GF.api.register('aiGenerate', 'prompt?', 'Run the configured AI provider (opens the ✦ AI dialog when no key is set)', a => {
    if (!GF.ai.hasKey()) { GF.ui.openAIDialog(); return; }
    GF.util.toast('Running AI…');
    return GF.ai.run(a || {}).catch(e => GF.util.toast(e.message));
  }, { group: 'Retouch', label: 'Generative fill (AI)…', needsDoc: true });
}
