/* PixelTriks — exporter.js
   Image export (PNG / WebP / JPEG at any scale) and project files. */
'use strict';
window.GF = window.GF || {};

GF.exporter = (function () {
  const U = GF.util;
  const D = GF.doc;

  async function exportImage(opts) {
    // Layer-split export (Pixelorama pattern): one file per visible layer,
    // each at the layer's pixels (offset honored, document-aligned). Returns
    // the list of blobs so callers/tests can introspect.
    if (opts.splitLayers) return exportLayersSeparate(opts);

    const src = opts.activeOnly
      ? (() => {
          const L = D.active();
          const c = U.makeCanvas(D.doc.width, D.doc.height);
          U.ctx2d(c).drawImage(L.canvas, L.x, L.y);
          return c;
        })()
      : D.composite();

    let out = src;
    if (opts.scale !== 1) {
      out = U.makeCanvas(Math.max(1, Math.round(src.width * opts.scale)),
                         Math.max(1, Math.round(src.height * opts.scale)));
      const c = U.ctx2d(out);
      // nearest-neighbor when upscaling small art, smooth when downscaling
      c.imageSmoothingEnabled = opts.scale < 1;
      c.imageSmoothingQuality = 'high';
      c.drawImage(src, 0, 0, out.width, out.height);
    }
    if (opts.type === 'image/jpeg') {
      // JPEG has no alpha — flatten onto black so output is predictable
      const flat = U.makeCanvas(out.width, out.height);
      const c = U.ctx2d(flat);
      c.fillStyle = '#000';
      c.fillRect(0, 0, flat.width, flat.height);
      c.drawImage(out, 0, 0);
      out = flat;
    }
    const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[opts.type];
    const blob = await U.canvasToBlob(out, opts.type, opts.quality);
    U.downloadBlob(blob, (D.doc.name || 'texture') + (opts.activeOnly ? '-layer' : '') + '.' + ext);
    U.toast('Exported ' + out.width + '×' + out.height + ' ' + ext.toUpperCase());
    return blob;
  }

  /** One file per visible layer, document-aligned (offsets honored).
      Sanitizes layer names for filesystems; returns the array of blobs. */
  async function exportLayersSeparate(opts) {
    const ext = { 'image/png': 'png', 'image/webp': 'webp', 'image/jpeg': 'jpg' }[opts.type] || 'png';
    const base = D.doc.name || 'texture';
    const sanitize = n => (n || 'layer').replace(/[^\w\-]+/g, '_').slice(0, 48);
    const out = [];
    let i = 0;
    for (const L of D.doc.layers) {
      if (!L.visible) continue;
      const c = U.makeCanvas(D.doc.width, D.doc.height);
      U.ctx2d(c).drawImage(L.canvas, L.x, L.y);
      let img = c;
      if (opts.scale && opts.scale !== 1) {
        const s = U.makeCanvas(Math.max(1, Math.round(c.width * opts.scale)),
                               Math.max(1, Math.round(c.height * opts.scale)));
        const cc = U.ctx2d(s);
        cc.imageSmoothingEnabled = opts.scale < 1;
        cc.imageSmoothingQuality = 'high';
        cc.drawImage(c, 0, 0, s.width, s.height);
        img = s;
      }
      const blob = await U.canvasToBlob(img, opts.type, opts.quality);
      U.downloadBlob(blob, base + '-' + String(i).padStart(2, '0') + '-' + sanitize(L.name) + '.' + ext);
      out.push(blob);
      i++;
    }
    U.toast('Exported ' + out.length + ' layer file(s)');
    return out;
  }

  function saveProject() {
    const json = JSON.stringify(D.serialize());
    const blob = new Blob([json], { type: 'application/json' });
    U.downloadBlob(blob, (D.doc.name || 'untitled') + '.forge.json');
    U.toast('Project saved');
  }

  function loadProject(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let data;
      try { data = JSON.parse(reader.result); }
      catch { U.toast('That file is not a valid project.'); return; }
      D.deserialize(data).then(() => {
        GF.ui.onDocumentOpened();
        U.toast('Project loaded');
      }).catch(err => U.toast(err.message));
    };
    reader.onerror = () => U.toast('Could not read the file.');
    reader.readAsText(file);
  }

  function importImage(file) {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (!D.doc.open) {
        D.newDocument(img.naturalWidth, img.naturalHeight, 'transparent',
          file.name.replace(/\.[^.]+$/, ''));
        U.ctx2d(D.active().canvas).drawImage(img, 0, 0);
        GF.ui.onDocumentOpened();
      } else {
        GF.history.push(D.doc, 'import image');
        // Grow the canvas to fit a larger image (keeping existing layers) instead
        // of shrinking the image — import at full resolution.
        if (img.naturalWidth > D.doc.width || img.naturalHeight > D.doc.height) {
          D.resize(Math.max(D.doc.width, img.naturalWidth),
                   Math.max(D.doc.height, img.naturalHeight), false);
          U.$('#doc-dims').textContent = D.doc.width + '×' + D.doc.height;
        }
        const L = D.addLayer(file.name.replace(/\.[^.]+$/, ''));
        U.ctx2d(L.canvas).drawImage(img, 0, 0);
        GF.ui.refreshLayers();
        GF.view.zoomFit();   // always frame the whole canvas after an import
      }
      U.toast('Imported ' + file.name);
    };
    img.onerror = () => { URL.revokeObjectURL(url); U.toast('Could not load that image.'); };
    img.src = url;
  }

  function handleFiles(files) {
    // 3D-ish drops go to the 3D workspace. A .gltf needs its sibling
    // .bin/textures, so that case takes the whole batch; otherwise only the
    // .glb/.hdr files leave the list and the rest (projects, images) load here.
    let list = Array.from(files);
    if (GF.scene3d && list.some(f => /\.(glb|gltf|hdr)$/i.test(f.name))) {
      if (list.some(f => /\.gltf$/i.test(f.name))) { GF.scene3d.handleFiles(list); return; }
      GF.scene3d.handleFiles(list.filter(f => /\.(glb|hdr)$/i.test(f.name)));
      list = list.filter(f => !/\.(glb|hdr)$/i.test(f.name));
    }
    for (const f of list) {
      if (f.name.endsWith('.json')) loadProject(f);
      else if (f.type.startsWith('image/')) importImage(f);
      else U.toast('Unsupported file: ' + f.name);
    }
  }

  async function copyToClipboard() {
    if (!D.doc.open) { U.toast('Open an image first'); return false; }
    const flat = D.composite();
    const c = U.makeCanvas(flat.width, flat.height);
    U.ctx2d(c).drawImage(flat, 0, 0);
    try {
      const blob = await new Promise(resolve => c.toBlob(resolve, 'image/png'));
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
      U.toast('Copied to clipboard');
      return true;
    } catch (e) {
      U.toast('Clipboard copy failed: ' + e.message);
      return false;
    }
  }

  return { exportImage, exportLayersSeparate, saveProject, loadProject, importImage, handleFiles, copyToClipboard };
})();
