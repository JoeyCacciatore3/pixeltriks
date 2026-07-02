'use strict';
/* Forge Studio — select.test.js
   Selection mask logic: combine modes, grow/contract, invert, bounds, wand. */

require('./shim.js');
require('../js/util.js');
// select.js reads dims from GF.doc.doc — give it a tiny fake doc shim
window.GF = window.GF || {};
window.GF.doc = { doc: { width: 4, height: 4 } };
require('../js/select.js');
const S = window.GF.select;

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

console.log('SELECT — clear / selectAll / count');
S.clear();
ok(S.count() === 0, 'cleared mask has zero pixels');
S.selectAll();
ok(S.count() === 16, 'selectAll covers full 4×4');
S.clear();
ok(!S.has(), 'has() false after clear');

console.log('SELECT — combine modes');
const a = new Uint8ClampedArray(16); a[0] = 255; a[1] = 255;
S.combine(a, 'replace');
ok(S.count() === 2, 'replace sets exactly 2 pixels');
const b = new Uint8ClampedArray(16); b[1] = 255; b[2] = 255;
S.combine(b, 'add');
ok(S.count() === 3, 'add unions to 3 pixels');
S.combine(b, 'subtract');
ok(S.count() === 1, 'subtract removes the 2 overlap pixels, leaves 1');

console.log('SELECT — invert');
S.clear();
const c = new Uint8ClampedArray(16); c[0] = 255;
S.combine(c, 'replace');
S.invert();
ok(S.count() === 15, 'invert of 1-pixel selection → 15 pixels');

console.log('SELECT — bounds');
S.clear();
const d = new Uint8ClampedArray(16); d[5] = 255; d[10] = 255; // (1,1) and (2,2)
S.combine(d, 'replace');
const b1 = S.bounds();
ok(b1 && b1.x === 1 && b1.y === 1 && b1.w === 2 && b1.h === 2, 'bounds spans (1,1)→(2,2)');
S.clear();
ok(S.bounds() === null, 'empty mask → null bounds');

console.log('SELECT — grow / contract');
S.clear();
const e = new Uint8ClampedArray(16); e[5] = 255; // single pixel at (1,1)
S.combine(e, 'replace');
S.grow(1);
ok(S.count() > 1, 'grow 1px expands single pixel');
const after = S.count();
S.contract(1);
ok(S.count() < after, 'contract 1px reduces from grown size');

console.log('SELECT — wand (contiguous flood)');
S.clear();
// fake imagedata 4×4 — left half red, right half blue
const img = { data: new Uint8ClampedArray(64) };
for (let i = 0; i < 16; i++) {
  const x = i % 4;
  const off = i * 4;
  img.data[off]     = x < 2 ? 255 : 0;
  img.data[off + 1] = 0;
  img.data[off + 2] = x < 2 ? 0 : 255;
  img.data[off + 3] = 255;
}
S.wand(img, 0, 0, 10, true, 'replace');
ok(S.count() === 8, 'wand at (0,0) with low tol selects the 8 red pixels');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
