'use strict';
/* Forge Studio — texture/tests/texture.test.js
   Covers GF.texture: palette quantization (median cut), error-diffusion +
   Bayer dithering, normal-map gradients (Sobel), and PALETTES constants.
   pbrSet, makeSeamless, tilePreview, packChannels rely on canvas
   compositing (drawImage) — out of scope for the node shim; verify those
   in the browser smoke suite. */

const { makeFakeLayer } = require('./shim.js');

// Load util first — texture.js reads it via GF.util.
require('../js/util.js');
require('../js/texture.js');

const T = global.window.GF.texture;
const U = global.window.GF.util;

// ---- test runner -------------------------------------------------------
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log('  ✓ ' + name); passed++; }
  catch (e) { console.log('  ✗ ' + name + '\n      ' + e.message); failed++; }
}
function eq(a, b, msg) {
  if (a !== b) throw new Error((msg || 'eq') + ': expected ' + JSON.stringify(b) + ', got ' + JSON.stringify(a));
}
function ok(v, msg) { if (!v) throw new Error(msg || 'expected truthy'); }
function near(a, b, tol, msg) {
  if (Math.abs(a - b) > tol) throw new Error((msg || 'near') + ': |' + a + ' - ' + b + '| > ' + tol);
}

function makeImageData(w, h, fillFn) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = fillFn(x, y);
      const i = (y * w + x) * 4;
      data[i] = r; data[i + 1] = g; data[i + 2] = b;
      data[i + 3] = a == null ? 255 : a;
    }
  }
  return new global.ImageData(data, w, h);
}

function inPalette(palette, r, g, b) {
  return palette.some(p => p[0] === r && p[1] === g && p[2] === b);
}

console.log('GF.texture');

// ---- PALETTES constants ------------------------------------------------
test('PALETTES.gameboy has 4 RGB triplets', () => {
  ok(Array.isArray(T.PALETTES.gameboy));
  eq(T.PALETTES.gameboy.length, 4);
  T.PALETTES.gameboy.forEach(c => { eq(c.length, 3); });
});

test('PALETTES.gray4 spans black to white', () => {
  const g = T.PALETTES.gray4;
  eq(g.length, 4);
  eq(g[0][0], 0, 'darkest is black');
  eq(g[3][0], 255, 'lightest is white');
});

// ---- reduceToPalette ---------------------------------------------------
test('reduceToPalette maps every opaque pixel to a palette color', () => {
  // 8x8 gradient of grays, fully opaque
  const img = makeImageData(8, 8, (x, y) => {
    const v = Math.round((x + y) / 14 * 255);
    return [v, v, v, 255];
  });
  T.reduceToPalette(img, T.PALETTES.gray4);
  for (let i = 0; i < img.data.length; i += 4) {
    ok(inPalette(T.PALETTES.gray4, img.data[i], img.data[i + 1], img.data[i + 2]),
       'pixel ' + i / 4 + ' (' + img.data[i] + ',' + img.data[i + 1] + ',' + img.data[i + 2] + ') not in palette');
  }
});

test('reduceToPalette leaves fully transparent pixels untouched', () => {
  const img = makeImageData(4, 4, () => [200, 100, 50, 0]);
  T.reduceToPalette(img, T.PALETTES.gameboy);
  eq(img.data[0], 200, 'r preserved');
  eq(img.data[1], 100, 'g preserved');
  eq(img.data[2], 50,  'b preserved');
  eq(img.data[3], 0,   'a preserved');
});

test('reduceToPalette quantizes mid-gray to nearest gray4 color', () => {
  // pure mid-gray (127) — nearest gray4 color is either 85 or 170; both valid
  const img = makeImageData(2, 2, () => [127, 127, 127, 255]);
  T.reduceToPalette(img, T.PALETTES.gray4);
  const v = img.data[0];
  ok(v === 85 || v === 170, 'expected 85 or 170, got ' + v);
});

// ---- ditherFS (Floyd-Steinberg) ----------------------------------------
test('ditherFS output only contains palette colors', () => {
  const img = makeImageData(16, 16, (x, y) => {
    const v = Math.round((x + y) / 30 * 255);
    return [v, v, v, 255];
  });
  T.ditherFS(img, T.PALETTES.gray4);
  for (let i = 0; i < img.data.length; i += 4) {
    ok(inPalette(T.PALETTES.gray4, img.data[i], img.data[i + 1], img.data[i + 2]),
       'pixel ' + i / 4 + ' not in palette');
  }
});

test('ditherFS preserves transparent pixels', () => {
  const img = makeImageData(4, 4, () => [50, 60, 70, 0]);
  T.ditherFS(img, T.PALETTES.gameboy);
  eq(img.data[0], 50);
  eq(img.data[3], 0);
});

test('ditherFS on mid-gray produces a mix of palette colors (not flat)', () => {
  // Mid-gray (127, 127, 127) lies between gray4's 85 and 170; FS should
  // alternate pixels rather than collapse to one color.
  const img = makeImageData(8, 8, () => [127, 127, 127, 255]);
  T.ditherFS(img, T.PALETTES.gray4);
  const seen = new Set();
  for (let i = 0; i < img.data.length; i += 4) seen.add(img.data[i]);
  ok(seen.size >= 2, 'expected ≥2 distinct outputs from dither, got ' + seen.size);
});

// ---- ditherBayer -------------------------------------------------------
test('ditherBayer output only contains palette colors', () => {
  const img = makeImageData(12, 12, (x, y) => {
    const v = Math.round((x + y) / 22 * 255);
    return [v, v, v, 255];
  });
  T.ditherBayer(img, T.PALETTES.gray4);
  for (let i = 0; i < img.data.length; i += 4) {
    ok(inPalette(T.PALETTES.gray4, img.data[i], img.data[i + 1], img.data[i + 2]),
       'pixel ' + i / 4 + ' not in palette');
  }
});

test('ditherBayer produces ordered pattern on flat input', () => {
  // Mid-gray flat input → Bayer threshold should create a repeating 4x4
  // pattern of palette colors. Check that we see both 85 and 170.
  const img = makeImageData(8, 8, () => [127, 127, 127, 255]);
  T.ditherBayer(img, T.PALETTES.gray4);
  const seen = new Set();
  for (let i = 0; i < img.data.length; i += 4) seen.add(img.data[i]);
  ok(seen.size >= 2, 'expected ≥2 distinct outputs');
});

test('ditherBayer preserves transparent pixels', () => {
  const img = makeImageData(4, 4, () => [99, 99, 99, 0]);
  T.ditherBayer(img, T.PALETTES.gameboy);
  eq(img.data[0], 99);
  eq(img.data[3], 0);
});

// ---- extractPalette ----------------------------------------------------
test('extractPalette returns count buckets for varied input', () => {
  // 16x16 with 4 distinct colors in quadrants
  const layer = makeFakeLayer(16, 16, (x, y) => {
    if (x < 8 && y < 8) return [255, 0, 0, 255];
    if (x >= 8 && y < 8) return [0, 255, 0, 255];
    if (x < 8 && y >= 8) return [0, 0, 255, 255];
    return [255, 255, 0, 255];
  });
  const palette = T.extractPalette(layer, 4);
  eq(palette.length, 4, 'should produce 4 buckets');
  palette.forEach(c => { eq(c.length, 3); });
});

test('extractPalette skips near-transparent pixels', () => {
  // mostly transparent (alpha < 16) with one opaque red region
  const layer = makeFakeLayer(8, 8, (x, y) => {
    if (x === 0 && y === 0) return [255, 0, 0, 255];
    return [128, 128, 128, 8]; // a < 16 → skipped
  });
  const palette = T.extractPalette(layer, 2);
  // Only one opaque pixel exists → palette has 1 entry (red)
  eq(palette.length, 1, 'one bucket from single opaque pixel');
  eq(palette[0][0], 255, 'red preserved');
  eq(palette[0][1], 0);
  eq(palette[0][2], 0);
});

test('extractPalette returns empty for fully transparent input', () => {
  const layer = makeFakeLayer(4, 4, () => [100, 100, 100, 0]);
  const palette = T.extractPalette(layer, 4);
  eq(palette.length, 0);
});

// ---- normalMap ---------------------------------------------------------
test('normalMap on flat layer yields neutral normals (0,0,1)', () => {
  // A constant-gray layer has zero gradients everywhere; the surface
  // normal should be (0, 0, 1) → encoded as (128, 128, 255).
  const layer = makeFakeLayer(8, 8, () => [128, 128, 128, 255]);
  const out = T.normalMap(layer, 2.0, false, false);
  const ctx = out.getContext('2d');
  const data = ctx.getImageData(0, 0, 8, 8).data;
  // Sample an interior pixel (gradient at edges is biased by clamp/wrap)
  const i = (3 * 8 + 3) * 4;
  near(data[i],     128, 1, 'r near 128');
  near(data[i + 1], 128, 1, 'g near 128');
  near(data[i + 2], 255, 1, 'b near 255');
  eq(data[i + 3], 255, 'alpha 255');
});

test('normalMap on left-to-right gradient produces leftward X normal', () => {
  // Brightness increasing in +x → surface tilts so normal points in -x.
  // Encoded R should be < 128.
  const layer = makeFakeLayer(16, 16, (x, _y) => {
    const v = Math.round((x / 15) * 255);
    return [v, v, v, 255];
  });
  const out = T.normalMap(layer, 2.0, false, false);
  const data = out.getContext('2d').getImageData(0, 0, 16, 16).data;
  // Interior pixel — avoid edge clamping noise
  const i = (8 * 16 + 8) * 4;
  ok(data[i] < 128, 'R channel should be < 128 (normal points -x), got ' + data[i]);
});

test('normalMap invertY flips the green channel', () => {
  // Top-to-bottom brightness gradient.
  const layer = makeFakeLayer(16, 16, (_x, y) => {
    const v = Math.round((y / 15) * 255);
    return [v, v, v, 255];
  });
  const a = T.normalMap(layer, 2.0, false, false);
  const b = T.normalMap(layer, 2.0, true, false);
  const da = a.getContext('2d').getImageData(0, 0, 16, 16).data;
  const db = b.getContext('2d').getImageData(0, 0, 16, 16).data;
  const i = (8 * 16 + 8) * 4;
  // G channels should be on opposite sides of 128.
  ok((da[i + 1] - 128) * (db[i + 1] - 128) < 0,
     'invertY should flip G across 128; got ' + da[i + 1] + ' and ' + db[i + 1]);
});

test('normalMap output has full opacity', () => {
  const layer = makeFakeLayer(8, 8, () => [200, 200, 200, 255]);
  const out = T.normalMap(layer, 1.0, false, false);
  const data = out.getContext('2d').getImageData(0, 0, 8, 8).data;
  for (let i = 3; i < data.length; i += 4) eq(data[i], 255, 'alpha at ' + i);
});

console.log('\n' + passed + ' passed, ' + failed + ' failed\n');
process.exit(failed === 0 ? 0 : 1);
