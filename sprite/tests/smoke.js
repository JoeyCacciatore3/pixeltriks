'use strict';
/* PixelForge app smoke test — loads the real app.js against a minimal DOM stub
   and drives it through editing, undo, frames, tags, atlas export, region
   isolation, and the AI Bridge image scanner. Run: node tests/smoke.js */

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}

/* ---- DOM / canvas stubs ---- */
function makeCtx(canvas) {
  return new Proxy({
    canvas,
    createImageData(w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    getImageData(x, y, w, h) { return { data: new Uint8ClampedArray(w * h * 4), width: w, height: h }; },
    createPattern() { return {}; },
    measureText() { return { width: 0 }; }
  }, {
    get(t, k) { if (k in t) return t[k]; return () => {}; },
    set() { return true; }
  });
}
function makeEl(tag) {
  const el = {
    tagName: String(tag || 'div').toUpperCase(),
    style: {}, dataset: {}, children: [], options: [],
    value: '', textContent: '', innerHTML: '', title: '', hidden: false,
    width: 300, height: 150, max: '', min: '',
    classList: {
      _s: new Set(),
      add(c) { this._s.add(c); }, remove(c) { this._s.delete(c); },
      toggle(c, f) { (f === undefined ? !this._s.has(c) : f) ? this._s.add(c) : this._s.delete(c); },
      contains(c) { return this._s.has(c); }
    },
    appendChild(c) { el.children.push(c); el.options.push(c); return c; },
    addEventListener(t, f) { (el._h = el._h || {})[t] = (el._h[t] || []); el._h[t].push(f); },
    removeEventListener() {},
    setPointerCapture() {}, releasePointerCapture() {},
    click() { (el._h && el._h.click || []).forEach(f => f({ stopPropagation() {}, preventDefault() {} })); },
    getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; },
    querySelector() { return makeEl('div'); },
    querySelectorAll() { return []; },
    focus() {}, blur() {}, remove() {},
    getContext() { return el._ctx = el._ctx || makeCtx(el); },
    toBlob(cb) { cb(null); }
  };
  Object.defineProperty(el, 'innerHTMLSet', { value: true });
  return new Proxy(el, {
    set(t, k, v) {
      if (k === 'innerHTML' && v === '') { t.children.length = 0; t.options.length = 0; }
      t[k] = v;
      return true;
    }
  });
}
const els = {};
global.document = {
  readyState: 'complete',
  title: '',
  getElementById(id) { return els[id] = els[id] || makeEl(id === 'stage' || id === 'livePrev' ? 'canvas' : 'div'); },
  createElement(tag) { return makeEl(tag); },
  querySelectorAll() { return []; },
  addEventListener() {},
  body: makeEl('body')
};
global.window = {
  devicePixelRatio: 1,
  addEventListener() {},
  PixelForgeCore: null
};
global.requestAnimationFrame = () => 0; // the loop is not exercised headlessly
global.URL = { createObjectURL: () => 'blob:x', revokeObjectURL: () => {} };
global.Image = function () { return { set src(v) {}, width: 0, height: 0 }; };
global.FileReader = function () { return { readAsText() {} }; };
global.prompt = () => null;
global.fetch = () => Promise.reject(new Error('no network in tests'));

/* ---- Load the real modules ---- */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ctx = vm.createContext(Object.assign(global, { globalThis: global }));
const load = f => vm.runInContext(fs.readFileSync(path.join(__dirname, '..', f), 'utf8'), ctx, { filename: f });
load('js/core.js');
window.PixelForgeCore = global.PixelForgeCore;
load('js/app.js');

const PF = global.window.__PF || (els && null);
const HOOK = (typeof window !== 'undefined' && window.__PF) || null;
const T = HOOK;
const C = global.PixelForgeCore;

console.log('SMOKE 1: app initialized against the stub DOM');
ok(!!T, 'test hooks exposed (init completed without exceptions)');
ok(T.S.proj.w === 32 && T.S.proj.layers.length === 1 && T.S.proj.frames.length === 1,
  'default 32\u00D732 project with one layer and frame');
ok(T.S.proj.palette.length === 32, 'DB32 palette loaded');

console.log('SMOKE 2: drawing and undo');
const RED = C.hexToU32('#ff0000');
T.setPixel(5, 5, RED);
let cel = T.S.proj.layers[0].cels[0];
ok(cel[C.idx(5, 5, 32)] === RED, 'setPixel wrote through the app plumbing');
T.doUndo();
cel = T.S.proj.layers[0].cels[0];
ok(cel[C.idx(5, 5, 32)] === 0, 'undo reverted the stroke');
T.doRedo();
cel = T.S.proj.layers[0].cels[0];
ok(cel[C.idx(5, 5, 32)] === RED, 'redo restored it');

console.log('SMOKE 3: frames, layers, tags');
T.addFrame(true);
ok(T.S.proj.frames.length === 2 && T.S.frame === 1, 'duplicated frame, selection advanced');
ok(T.S.proj.layers[0].cels[1][C.idx(5, 5, 32)] === RED, 'duplicate carried the pixels');
T.addLayer();
ok(T.S.proj.layers.length === 2 && T.S.layer === 1, 'layer added above and selected');
T.addTagDirect('walk', 0, 1);
ok(T.S.proj.tags.length === 1, 'tag registered');

console.log('SMOKE 4: atlas export object');
const atlas = T.buildAtlasObject();
ok(atlas.frames.length === 2 && atlas.meta.frameTags[0].name === 'walk',
  'atlas carries 2 frames and the walk tag');
ok(atlas.frames[0].frame.w === 32 && atlas.meta.size.w >= 32,
  'atlas geometry is sound');

console.log('SMOKE 5: region isolation to a new layer');
T.S.layer = 0; T.S.frame = 0;
T.S.selection = C.magicWand(T.S.proj.layers[0].cels[0], 32, 32, 5, 5, true);
const layersBefore = T.S.proj.layers.length;
T.extractSelectionToLayer();
ok(T.S.proj.layers.length === layersBefore + 1, 'extraction created a part layer');
ok(T.S.proj.layers[0].cels[0][C.idx(5, 5, 32)] === 0, 'pixel removed from the source layer');
ok(T.S.proj.layers[1].cels[0][C.idx(5, 5, 32)] === RED, 'pixel lives on the part layer');

console.log('SMOKE 6: project undo after structural change');
T.doUndo();
ok(T.S.proj.layers.length === layersBefore, 'structural undo restored the layer stack');

console.log('SMOKE 7: AI Bridge response scanning');
const sample = JSON.stringify({
  result: {
    image: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==',
    raw: 'iVBORw0KGgo' + 'A'.repeat(120),
    link: 'https://cdn.example.com/out/sprite_01.png?sig=abc'
  }
});
const found = T.scanForImages(sample);
ok(found.some(s => s.startsWith('data:image/png;base64,iVBORw0KGgoAAAANSUhEUg')), 'detects data URLs');
ok(found.some(s => s.includes('cdn.example.com')), 'detects image URLs');
ok(found.some(s => s === 'data:image/png;base64,iVBORw0KGgo' + 'A'.repeat(120)), 'detects raw base64 PNG payloads');

console.log('SMOKE 8: pristine detection guards sheet-import resizing');
T.newProjectTo(32, 32);
ok(T.pristine() === true, 'fresh project is pristine');
T.setPixel(0, 0, RED);
ok(T.pristine() === false, 'a single pixel makes it non-pristine');

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
