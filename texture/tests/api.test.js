'use strict';
/* Forge Studio — api.test.js
   Verifies the AI-operator surface: every command is registered with the
   expected shape, describe() emits a stable catalog, and the new 2026-06
   additions (brush.shape, nineSlice, layer-split export) are wired in. */

require('./shim.js');
require('../js/util.js');

// Minimal stubs for every module api.js touches at registration time.
// Commands are only INVOKED in this suite via describe() / direct lookup —
// we don't fire them, so the stubs only need to exist as references.
window.GF = window.GF || {};
window.GF.doc = {
  doc: { open: false, name: '', width: 0, height: 0, layers: [], activeId: null },
  active: () => null, byId: () => null,
  newDocument() {}, resize() {}, addLayer: () => ({ id: 1 }), duplicateActive: () => ({ id: 2 }),
  deleteActive() {}, mergeDown() {}, flatten() {}, bakeOffset() {}, docAligned: () => ({ canvas: null }),
  flipLayer() {}, rotateLayer90() {}, trimToContent() {}, composite: () => null,
};
window.GF.view = { view: { brush: { color: '#fff', size: 16, shape: 'round', pixel: false }, fillTolerance: 24, tool: 'brush', zoom: 1 }, fillAt() {}, requestRender() {} };
window.GF.history = { push() {}, undo() {}, redo() {}, canUndo: () => false, canRedo: () => false, onChange() {} };
window.GF.select = { wand: () => 0, has: () => false, count: () => 0, bounds: () => null, clear() {}, selectAll() {}, invert() {}, grow() {}, feather() {}, fromAlphaCanvas() {}, maskCanvas: () => null };
window.GF.retouch = { eraseSelection() {}, contentAwareFill() {}, removeBackground() {}, colorReplace() {}, layerFX() {}, materialWizard() {}, smartUpscale() {} };
window.GF.filters = { applyToLayer() {}, brightnessContrast() {}, hsl() {} };
window.GF.library = { generateProcedural() {} };
window.GF.libsync = { save() {} };
window.GF.ui = { refreshLayers() {}, onDocumentOpened() {} };
window.GF.exporter = { exportImage() { return Promise.resolve(); } };

require('../js/api.js');
const A = window.GF.api;

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('API — describe shape');
const cat = A.describe();
ok(Array.isArray(cat), 'describe() returns an array');
ok(cat.length > 0, 'catalog is non-empty');
ok(cat.every(c => typeof c.name === 'string' && typeof c.params === 'string' && typeof c.doc === 'string'),
   'every entry has name/params/doc strings');

const names = new Set(cat.map(c => c.name));

console.log('API — core commands present');
['newDoc', 'addLayer', 'undo', 'redo', 'paint', 'fillAt', 'flatten', 'mergeDown',
 'wandSelect', 'selectAll', 'deselect', 'eraseSelection', 'contentAwareFill',
 'removeBackground', 'colorReplace', 'filter', 'flipLayer', 'rotateLayer',
 'trim', 'generate', 'saveToLibrary'].forEach(n => {
  ok(names.has(n), 'has ' + n);
});

console.log('API — new 2026-06 commands present');
['setBrushShape', 'setNineSlice', 'clearNineSlice', 'export9Slice', 'exportLayers'].forEach(n => {
  ok(names.has(n), 'has ' + n);
});

console.log('API — no duplicate command names');
ok(names.size === cat.length, 'all command names are unique');

console.log('API — run() rejects unknown commands');
let threw = false;
try { A.run('not_a_real_command'); } catch (e) { threw = e.message.includes('unknown command'); }
ok(threw, 'unknown command throws with helpful message');

console.log('API — state() returns expected keys');
const st = A.state();
ok(st && typeof st === 'object', 'state() returns an object');
ok('doc' in st && 'layers' in st && 'selection' in st && 'tool' in st && 'history' in st,
   'state has doc/layers/selection/tool/history');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
