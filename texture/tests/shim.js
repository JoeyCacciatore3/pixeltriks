'use strict';
/* Forge Studio — texture/tests/shim.js
   Minimal window/document stub so the classic-script texture modules can
   be loaded in node for unit testing pure logic. Loaders must require
   this BEFORE the module under test.

   Intentionally barebones: anything touching real DOM, canvas, blobs, or
   timers is out of scope — those tests live in tests/smoke.js (browser). */

if (!global.window) global.window = global;
if (!global.document) {
  global.document = {
    createElement(tag) {
      if (tag === 'canvas') return makeFakeCanvas(1, 1);
      throw new Error('document.createElement(' + tag + ') not available in node tests');
    },
    getElementById() { return null; },
    querySelector() { return null; },
    querySelectorAll() { return []; },
    body: { appendChild() {}, removeChild() {} },
  };
}
if (!global.URL) global.URL = { createObjectURL() { return ''; }, revokeObjectURL() {} };

/* Fake ImageData / canvas / 2d context — just enough to exercise the
   pixel-buffer-sharing logic in history.js. The fake canvas stores its
   pixel array directly; getImageData returns a NEW ImageData copy each
   call (matching real browser semantics), and putImageData copies the
   array back into the canvas. */
class FakeImageData {
  constructor(data, width, height) {
    if (data instanceof Uint8ClampedArray) {
      this.data = data;
      this.width = width;
      this.height = height;
    } else {
      this.width = data;
      this.height = width;
      this.data = new Uint8ClampedArray(this.width * this.height * 4);
    }
  }
}
if (!global.ImageData) global.ImageData = FakeImageData;

function makeFakeCanvas(w, h) {
  let pixels = new Uint8ClampedArray(w * h * 4);
  const canvas = {
    width: w,
    height: h,
    get _pixels() { return pixels; },
    set _pixels(p) { pixels = p; },
    getContext() {
      return {
        // Reflect canvas resizes — algorithms reuse one canvas at different sizes.
        getImageData: (x, y, ww, hh) => {
          if (pixels.length !== canvas.width * canvas.height * 4) {
            pixels = new Uint8ClampedArray(canvas.width * canvas.height * 4);
          }
          const out = new Uint8ClampedArray(ww * hh * 4);
          out.set(pixels.subarray(0, Math.min(out.length, pixels.length)));
          return new FakeImageData(out, ww, hh);
        },
        putImageData: (img) => {
          if (pixels.length !== img.data.length) pixels = new Uint8ClampedArray(img.data.length);
          pixels.set(img.data);
        },
        createImageData: (ww, hh) => new FakeImageData(ww, hh),
        // drawImage is a NO-OP — tests that need real compositing should
        // exercise pure ImageData functions instead.
        drawImage() {},
        imageSmoothingEnabled: true,
        imageSmoothingQuality: 'high',
        fillStyle: '#000',
        fillRect() {},
        willReadFrequently: true,
      };
    },
  };
  return canvas;
}

/** Build a fake "layer" (the shape texture.js expects: { canvas, x, y })
    with deterministic pixel content. fillFn(x, y) -> [r,g,b,a]. */
function makeFakeLayer(w, h, fillFn) {
  const c = makeFakeCanvas(w, h);
  if (fillFn) {
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const [r, g, b, a] = fillFn(x, y);
        const i = (y * w + x) * 4;
        c._pixels[i]     = r;
        c._pixels[i + 1] = g;
        c._pixels[i + 2] = b;
        c._pixels[i + 3] = a == null ? 255 : a;
      }
    }
  }
  return { canvas: c, x: 0, y: 0, opacity: 1, blend: 'normal', visible: true };
}

module.exports = {
  window: global.window,
  document: global.document,
  makeFakeCanvas,
  makeFakeLayer,
  FakeImageData,
};
