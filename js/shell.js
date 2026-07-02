/* Forge Studio — shell.js
   Hosts the two editors (Texture = GameForge, Sprite = PixelForge) as isolated
   file:// iframes and gives them one global top bar, a unified New flow, and a
   shared Asset Library. Because the frames are separate file:// origins ("null"),
   the shell can't touch their globals directly — it drives them over postMessage
   via forge-bridge.js (included in each editor). No editor logic is rewritten. */
'use strict';

const $ = (s, r = document) => r.querySelector(s);

const FRAMES = {
  texture: { el: $('#frame-texture'), src: 'texture/index.html', loaded: false, ready: null, _resolveReady: null },
  sprite:  { el: $('#frame-sprite'),  src: 'sprite/index.html',  loaded: false, ready: null, _resolveReady: null },
};
for (const f of Object.values(FRAMES)) f.ready = new Promise((res) => { f._resolveReady = res; });

const SIZES = {
  texture: [['512','512×512'], ['1024','1024×1024'], ['256','256×256 (tile)'], ['2048','2048×2048'], ['4096','4096×4096']],
  sprite:  [['32','32×32'], ['16','16×16'], ['48','48×48'], ['64','64×64'], ['128','128×128']],
};

// ── postMessage transport ────────────────────────────────────────────────────
let _msgId = 0;
const _pending = new Map();
window.addEventListener('message', (e) => {
  const m = e.data;
  if (!m || !m.forge) return;
  if (m.ready) {                       // a frame announced it booted
    const f = FRAMES[m.app];
    if (f) f._resolveReady(true);
    return;
  }
  if (m.reply != null && _pending.has(m.reply)) {
    const { resolve, reject } = _pending.get(m.reply);
    _pending.delete(m.reply);
    m.ok ? resolve(m.data) : reject(new Error(m.data || 'bridge error'));
  }
});

function send(mode, type, payload) {
  const f = FRAMES[mode];
  const id = ++_msgId;
  return f.ready.then(() => new Promise((resolve, reject) => {
    _pending.set(id, { resolve, reject });
    f.el.contentWindow.postMessage({ forge: true, id, type, payload }, '*');
    setTimeout(() => { if (_pending.has(id)) { _pending.delete(id); reject(new Error('frame timeout: ' + type)); } }, 8000);
  }));
}

// ── frame loading + mode switching ────────────────────────────────────────────
function ensureLoaded(mode) {
  const f = FRAMES[mode];
  if (!f.loaded) { f.loaded = true; f.el.src = f.src; }
  return f.ready;
}
async function setMode(mode) {
  for (const [m, f] of Object.entries(FRAMES)) f.el.classList.toggle('active', m === mode);
  document.querySelectorAll('.mode-tab').forEach((t) => t.classList.toggle('active', t.dataset.mode === mode));
  try { localStorage.setItem('forge.mode', mode); } catch {}
  ensureLoaded(mode);
  return mode;
}

// ── New flow ──────────────────────────────────────────────────────────────────
function fillSizes(kind) {
  const sel = $('#new-size'); sel.innerHTML = '';
  for (const [v, label] of SIZES[kind]) {
    const o = document.createElement('option'); o.value = v; o.textContent = label; sel.appendChild(o);
  }
}
function openNew() {
  fillSizes(document.querySelector('input[name="kind"]:checked')?.value || 'texture');
  $('#dlg-new').showModal();
}
async function createNew(kind, size) {
  await setMode(kind);
  const n = parseInt(size, 10) || (kind === 'texture' ? 512 : 32);
  return send(kind, 'new', { w: n, h: n, bg: 'transparent' });
}

// ── wiring ─────────────────────────────────────────────────────────────────────
document.querySelectorAll('.mode-tab').forEach((t) => t.addEventListener('click', () => setMode(t.dataset.mode)));
document.querySelectorAll('input[name="kind"]').forEach((r) => r.addEventListener('change', () => fillSizes(r.value)));
$('#shell-new').addEventListener('click', openNew);
$('#form-new').addEventListener('submit', (e) => {
  if (e.submitter && e.submitter.value === 'cancel') return;
  createNew(document.querySelector('input[name="kind"]:checked').value, $('#new-size').value);
});
$('#shell-help').addEventListener('click', () => $('#dlg-about').showModal());

// boot: restore last mode (default texture)
let initial = 'texture';
try { const s = localStorage.getItem('forge.mode'); if (s === 'sprite' || s === 'texture') initial = s; } catch {}
setMode(initial);

// expose for the headless verification harness
window.__FORGE = { setMode, createNew, send, FRAMES };
