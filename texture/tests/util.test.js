'use strict';
/* Forge Studio — texture mode unit tests.
   Run: node tests/run.js   (from texture/ or repo root) */

require('./shim.js');
require('../js/util.js');
const U = window.GF.util;

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  ✓ ' + msg); }
  else { fail++; console.log('  ✗ ' + msg); }
}
function near(a, b, eps) { return Math.abs(a - b) <= (eps || 1e-9); }

console.log('UTIL — clamp');
ok(U.clamp(5, 0, 10) === 5, 'in-range value passes through');
ok(U.clamp(-3, 0, 10) === 0, 'below-lo clamps to lo');
ok(U.clamp(99, 0, 10) === 10, 'above-hi clamps to hi');
ok(U.clamp(0, 0, 10) === 0, 'lo boundary stays at lo');
ok(U.clamp(10, 0, 10) === 10, 'hi boundary stays at hi');

console.log('UTIL — luminance (Rec.709)');
ok(near(U.luminance(255, 255, 255), 255), 'white = 255');
ok(near(U.luminance(0, 0, 0), 0), 'black = 0');
ok(near(U.luminance(255, 0, 0), 54.213), 'pure red weight 0.2126');
ok(near(U.luminance(0, 255, 0), 182.376), 'pure green weight 0.7152');
ok(near(U.luminance(0, 0, 255), 18.411), 'pure blue weight 0.0722');

console.log('UTIL — hex <-> rgb');
ok(JSON.stringify(U.hexToRgb('#ff0000')) === '[255,0,0]', 'red hex parses');
ok(JSON.stringify(U.hexToRgb('#00ff00')) === '[0,255,0]', 'green hex parses');
ok(JSON.stringify(U.hexToRgb('#0000ff')) === '[0,0,255]', 'blue hex parses');
ok(U.rgbToHex(255, 0, 0) === '#ff0000', 'red rgb -> hex');
ok(U.rgbToHex(0, 255, 0) === '#00ff00', 'green rgb -> hex');
ok(U.rgbToHex(0, 0, 255) === '#0000ff', 'blue rgb -> hex');
ok(U.rgbToHex(1, 2, 3) === '#010203', 'low values zero-pad');

console.log('UTIL — rgb <-> hsl round-trip');
const samples = [[255,0,0],[0,255,0],[0,0,255],[128,128,128],[200,50,100],[17,42,99],[0,0,0],[255,255,255]];
for (const [r,g,b] of samples) {
  const [h,s,l] = U.rgbToHsl(r,g,b);
  const [r2,g2,b2] = U.hslToRgb(h,s,l);
  ok(r2 === r && g2 === g && b2 === b, 'rgb [' + r + ',' + g + ',' + b + '] round-trips through hsl');
}

console.log('UTIL — hsl edge cases');
{
  const [h,s,l] = U.rgbToHsl(128,128,128);
  ok(s === 0, 'gray has zero saturation');
  ok(near(l, 128/255, 1e-9), 'gray lightness == channel value');
}
{
  const [r,g,b] = U.hslToRgb(0, 0, 0.5);
  ok(r === g && g === b, 'zero saturation produces achromatic rgb');
}

console.log('\n' + pass + ' passed, ' + fail + ' failed');
process.exit(fail > 0 ? 1 : 0);
