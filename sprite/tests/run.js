'use strict';
/* PixelForge core test suite. Run: node tests/run.js */
const C = require('../js/core.js');

let pass = 0, fail = 0;
function ok(cond, msg) {
  if (cond) { pass++; console.log('  \u2713 ' + msg); }
  else { fail++; console.log('  \u2717 ' + msg); }
}
function throws(fn, msg) {
  try { fn(); fail++; console.log('  \u2717 ' + msg + ' (did not throw)'); }
  catch (e) { pass++; console.log('  \u2713 ' + msg); }
}
const RED = C.hexToU32('#ff0000'), GRN = C.hexToU32('#00ff00'), BLU = C.hexToU32('#0000ff');

console.log('COLORS');
ok(C.u32ToHex(RED) === '#ff0000' && C.u32ToHex(GRN) === '#00ff00' && C.u32ToHex(BLU) === '#0000ff',
  'hex \u2192 u32 \u2192 hex round-trips for all channels');
ok(C.alphaOf(RED) === 255 && C.alphaOf(0) === 0, 'alpha channel extraction');
throws(() => C.hexToU32('#xyz'), 'hexToU32 rejects malformed input');

console.log('FLOOD FILL');
{
  // 4x4: left half red, right half green
  const w = 4, h = 4, d = new Uint32Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) d[C.idx(x, y, w)] = x < 2 ? RED : GRN;
  const n = C.floodFill(d, w, h, 0, 0, BLU);
  ok(n === 8, 'fills exactly the 8-pixel contiguous region (got ' + n + ')');
  ok(d[C.idx(1, 3, w)] === BLU && d[C.idx(2, 0, w)] === GRN, 'fill stops at the color boundary');
  ok(C.floodFill(d, w, h, 3, 3, GRN) === 0, 'same-color fill is a no-op');
  ok(C.floodFill(d, w, h, 99, 0, BLU) === 0, 'out-of-bounds origin is a no-op');
}
{
  // diagonal touch must NOT connect (4-connectivity)
  const w = 2, h = 2, d = new Uint32Array([RED, GRN, GRN, RED]);
  C.floodFill(d, w, h, 0, 0, BLU);
  ok(d[3] === RED, 'diagonal pixels are not connected');
}
{
  // mask-limited fill (respects selection)
  const w = 3, h = 1, d = new Uint32Array([RED, RED, RED]);
  const allow = new Uint8Array([1, 1, 0]);
  const n = C.floodFill(d, w, h, 0, 0, BLU, allow);
  ok(n === 2 && d[2] === RED, 'fill confined to the allow mask');
}

console.log('MAGIC WAND');
{
  const w = 4, h = 1, d = new Uint32Array([RED, GRN, RED, RED]);
  const m1 = C.magicWand(d, w, h, 0, 0, true);
  ok(C.maskCount(m1) === 1 && m1[0] === 1, 'contiguous wand selects only the touching region');
  const m2 = C.magicWand(d, w, h, 0, 0, false);
  ok(C.maskCount(m2) === 3 && m2[2] === 1 && m2[3] === 1, 'global wand selects every matching pixel');
  const b = C.maskBounds(m2, w, h);
  ok(b.x === 0 && b.w === 4 && b.h === 1, 'mask bounds span the selection');
  ok(C.maskBounds(new Uint8Array(4), w, h) === null, 'empty mask has null bounds');
}

console.log('EXTRACT & MOVE (region isolation)');
{
  const w = 3, h = 1, d = new Uint32Array([RED, GRN, BLU]);
  const mask = new Uint8Array([0, 1, 0]);
  const { extracted, remaining } = C.extractMask(d, mask);
  ok(extracted[1] === GRN && extracted[0] === 0 && remaining[1] === 0 && remaining[0] === RED,
    'extractMask splits the cel into part + remainder');
  const moved = C.shiftMasked(d, mask, w, h, 1, 0);
  ok(moved.data[2] === GRN && moved.data[1] === 0 && moved.data[0] === RED && moved.mask[2] === 1,
    'shiftMasked relocates only the selected pixels');
  const clipped = C.shiftMasked(d, mask, w, h, 5, 0);
  ok(clipped.data[1] === 0 && C.maskCount(clipped.mask) === 0, 'pixels shifted off-canvas are clipped');
}

console.log('LINE');
{
  const pts = [];
  C.line(0, 0, 3, 2, (x, y) => pts.push([x, y]));
  ok(pts.length >= 4 && pts[0][0] === 0 && pts[0][1] === 0 &&
     pts[pts.length - 1][0] === 3 && pts[pts.length - 1][1] === 2,
    'Bresenham includes both endpoints');
}

console.log('PACKING & SLICING');
{
  const p = C.packRows(32, 32, 5);
  ok(p.cols === 3 && p.rows === 2 && p.sheetW === 96 && p.sheetH === 64, 'square-ish layout for 5 frames');
  ok(p.positions.length === 5 && p.positions[4].x === 32 && p.positions[4].y === 32,
    'positions are row-major');
  const seen = new Set(p.positions.map(q => q.x + ',' + q.y));
  ok(seen.size === 5, 'no two frames overlap');
  const capped = C.packRows(32, 32, 5, 64);
  ok(capped.cols === 2 && capped.sheetW === 64, 'maxWidth caps the column count');
  throws(() => C.packRows(0, 32, 5), 'packRows rejects zero frame size');
  const rects = C.sliceGrid(96, 64, 32, 32);
  ok(rects.length === 6 && rects[3].x === 0 && rects[3].y === 32, 'sliceGrid returns row-major rects');
}

console.log('ATLAS');
{
  const p = C.packRows(16, 16, 4);
  const atlas = C.buildAtlas({
    name: 'hero', fw: 16, fh: 16, sheetW: p.sheetW, sheetH: p.sheetH,
    positions: p.positions, frameDurations: [125, 125, 125, 125],
    tags: [{ name: 'walk', from: 0, to: 3 }]
  });
  ok(atlas.frames.length === 4 && atlas.frames[3].frame.x === p.positions[3].x,
    'atlas frames carry packed coordinates');
  ok(atlas.frames[0].duration === 125 && atlas.meta.frameTags[0].name === 'walk',
    'durations and frame tags are present (Aseprite-compatible)');
  throws(() => C.buildAtlas({
    name: 'x', fw: 16, fh: 16, sheetW: 32, sheetH: 32,
    positions: p.positions, frameDurations: [1, 1, 1, 1],
    tags: [{ name: 'bad', from: 2, to: 9 }]
  }), 'atlas rejects a tag range outside the frame count');
}

console.log('PALETTE');
{
  const d = new Uint32Array([RED, RED, GRN, 0, BLU, GRN]);
  const pal = C.extractPalette(d);
  ok(pal.length === 3 && pal[0] === RED && pal[1] === GRN && pal[2] === BLU,
    'palette is unique, ordered, and skips transparent pixels');
  ok(C.extractPalette(d, 2).length === 2, 'palette respects the cap');
  const n = C.remapColor(d, GRN, BLU);
  ok(n === 2 && d[2] === BLU && d[5] === BLU, 'remapColor replaces every matching pixel');
}

console.log('RLE');
{
  const src = new Uint32Array(500);
  for (let i = 0; i < src.length; i++) src[i] = (Math.random() * 4 | 0) === 0 ? RED : (i % 7 ? GRN : 0);
  const enc = C.rleEncode(src);
  const dec = C.rleDecode(enc, src.length);
  let same = true;
  for (let i = 0; i < src.length; i++) if (src[i] !== dec[i]) { same = false; break; }
  ok(same, 'encode \u2192 decode round-trips ' + src.length + ' pixels (' + enc.length + ' run entries)');
  throws(() => C.rleDecode([3, RED], 2), 'decode rejects overlong data');
  throws(() => C.rleDecode([1, RED], 2), 'decode rejects short data');
}

console.log('PROJECT SERIALIZATION');
{
  const w = 8, h = 8;
  const cel = new Uint32Array(w * h);
  cel[10] = RED; cel[11] = RED; cel[20] = GRN;
  const proj = {
    name: 'knight', w, h, fps: 10,
    palette: [RED, GRN, BLU],
    frames: [{ duration: 0 }, { duration: 0 }],
    tags: [{ name: 'idle', from: 0, to: 1 }],
    layers: [
      { name: 'Body', visible: true, opacity: 0.5, blend: 'multiply', cels: [cel, null] },
      { name: 'Glow', visible: false, cels: [null, null] },
    ]
  };
  const json = C.serializeProject(proj);
  const back = C.deserializeProject(json);
  ok(back.name === 'knight' && back.w === 8 && back.fps === 10, 'metadata round-trips');
  ok(back.palette.length === 3 && back.palette[0] === RED, 'palette round-trips');
  ok(back.layers[0].cels[0][10] === RED && back.layers[0].cels[0][20] === GRN,
    'pixel data round-trips through RLE');
  ok(back.layers[0].cels[1] === null && back.tags[0].to === 1, 'null cels and tags round-trip');
  ok(back.layers[0].opacity === 0.5 && back.layers[0].blend === 'multiply', 'layer opacity + blend round-trip');
  ok(back.layers[1].opacity === 1 && back.layers[1].blend === 'source-over', 'layer opacity/blend default when absent');
  throws(() => C.deserializeProject('{"format":"other"}'), 'rejects foreign file formats');
  throws(() => C.deserializeProject('not json'), 'rejects non-JSON input');
}

console.log('\nRESULT: ' + pass + ' passed, ' + fail + ' failed');
process.exit(fail ? 1 : 0);
