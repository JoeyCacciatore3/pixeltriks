'use strict';
/* Forge Studio — filters.test.js
   Pure ImageData transforms: brightness/contrast, hsl, grayscale, invert,
   posterize, convolutions. Validates the math without touching real DOM. */

require('./shim.js');
require('../js/util.js');
require('../js/filters.js');
const F = window.GF.filters;

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}

function img(w, h, rgba) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4]     = rgba[0];
    data[i * 4 + 1] = rgba[1];
    data[i * 4 + 2] = rgba[2];
    data[i * 4 + 3] = rgba[3] == null ? 255 : rgba[3];
  }
  return new global.ImageData(data, w, h);
}

console.log('FILTERS — grayscale');
const g = F.grayscale(img(2, 1, [255, 0, 0]));
ok(g.data[0] === g.data[1] && g.data[1] === g.data[2], 'r=g=b after grayscale');
ok(g.data[3] === 255, 'alpha preserved');
ok(g.data[0] === Math.round(0.2126 * 255), 'red luminance ≈ 54');

console.log('FILTERS — invert');
const inv = F.invert(img(1, 1, [10, 20, 30, 200]));
ok(inv.data[0] === 245, 'r inverted (255-10)');
ok(inv.data[1] === 235, 'g inverted');
ok(inv.data[2] === 225, 'b inverted');
ok(inv.data[3] === 200, 'alpha untouched');

console.log('FILTERS — brightnessContrast');
const bright = F.brightnessContrast(img(1, 1, [100, 100, 100]), 50, 0);
ok(bright.data[0] > 100, 'brightness +50 raises value');
const dim = F.brightnessContrast(img(1, 1, [100, 100, 100]), -50, 0);
ok(dim.data[0] < 100, 'brightness −50 lowers value');
const noop = F.brightnessContrast(img(1, 1, [128, 128, 128]), 0, 0);
ok(noop.data[0] === 128, 'b=0,c=0 is identity');

console.log('FILTERS — hsl (zero is identity)');
const h0 = F.hsl(img(1, 1, [200, 100, 50]), 0, 0, 0);
ok(h0.data[0] === 200 && h0.data[1] === 100 && h0.data[2] === 50, 'hsl(0,0,0) preserves rgb');

console.log('FILTERS — posterize');
const p = F.posterize(img(1, 1, [128, 128, 128]), 2);
ok(p.data[0] === 0 || p.data[0] === 255, '2-level posterize snaps to extremes');

console.log('FILTERS — autoLevels');
const lo = img(2, 1, [50, 50, 50]);
lo.data[4] = 200; lo.data[5] = 200; lo.data[6] = 200; lo.data[7] = 255;
const al = F.autoLevels(lo);
ok(al.data[0] === 0, 'darkest pixel stretches to 0');
ok(al.data[4] === 255, 'brightest pixel stretches to 255');

console.log('FILTERS — convolve3 sharpen identity sum');
// A flat-color image stays the same color under any kernel whose weights sum / divisor == 1
const flat = img(3, 3, [120, 120, 120]);
const sharp = F.sharpen(flat);
ok(sharp.data[16] === 120, 'sharpen preserves flat regions (center pixel)');

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
