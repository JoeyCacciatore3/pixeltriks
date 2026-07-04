/* PixelTriks — util.js
   Shared helpers. All modules attach to the GF namespace so the app
   runs from file:// (classic scripts, no bundler required). */
'use strict';
window.GF = window.GF || {};

GF.util = (function () {

  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function $(sel, root) { return (root || document).querySelector(sel); }
  function $$(sel, root) { return Array.prototype.slice.call((root || document).querySelectorAll(sel)); }

  /** Create a canvas of given size with its 2d context. */
  function makeCanvas(w, h) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    return c;
  }
  function ctx2d(canvas) {
    return canvas.getContext('2d', { willReadFrequently: true });
  }

  /** Rec.709 luminance of an rgb triplet (0–255). */
  function luminance(r, g, b) {
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function hexToRgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function rgbToHex(r, g, b) {
    return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
  }

  /** rgb [0-255] -> hsl [0-1] and back; used by HSL adjustment. */
  function rgbToHsl(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b);
    let h = 0, s = 0;
    const l = (max + min) / 2;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      switch (max) {
        case r: h = (g - b) / d + (g < b ? 6 : 0); break;
        case g: h = (b - r) / d + 2; break;
        default: h = (r - g) / d + 4;
      }
      h /= 6;
    }
    return [h, s, l];
  }
  function hslToRgb(h, s, l) {
    if (s === 0) { const v = Math.round(l * 255); return [v, v, v]; }
    const hue2rgb = (p, q, t) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1 / 6) return p + (q - p) * 6 * t;
      if (t < 1 / 2) return q;
      if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    return [
      Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
      Math.round(hue2rgb(p, q, h) * 255),
      Math.round(hue2rgb(p, q, h - 1 / 3) * 255)
    ];
  }

  /** Trigger a browser download of a Blob. */
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    // Give the browser a beat before revoking (Safari needs this).
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob(b => b ? resolve(b) : reject(new Error('Export failed — the canvas may be too large for this device.')), type, quality);
    });
  }

  let toastTimer = null;
  function toast(msg, ms) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove('show'), ms || 2400);
  }

  /** Run heavy work after the toast paints, so the UI shows feedback first. */
  function busy(msg, fn) {
    toast(msg, 60000);
    return new Promise((resolve, reject) => {
      setTimeout(() => {
        try {
          const out = fn();
          document.getElementById('toast').classList.remove('show');
          resolve(out);
        } catch (e) {
          toast('Error: ' + e.message);
          reject(e);
        }
      }, 30);
    });
  }

  return { clamp, $, $$, makeCanvas, ctx2d, luminance, hexToRgb, rgbToHex,
           rgbToHsl, hslToRgb, downloadBlob, canvasToBlob, toast, busy };
})();
