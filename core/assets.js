/* PixelTriks — assets.js
   IndexedDB-backed asset library. Stores models (.glb), textures (images),
   HDRIs, material presets, and projects with thumbnails for browsing.
   Batch transactions for bulk imports. Persistent storage requested on init. */
'use strict';
window.GF = window.GF || {};

GF.assets = (function () {
  const U = GF.util;
  const DB_NAME = 'pixeltriks-assets';
  const DB_VERSION = 1;
  const STORE = 'assets';
  let db = null;

  function open() {
    if (db) return Promise.resolve(db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const d = e.target.result;
        if (!d.objectStoreNames.contains(STORE)) {
          const s = d.createObjectStore(STORE, { keyPath: 'id' });
          s.createIndex('type', 'type', { unique: false });
          s.createIndex('name', 'name', { unique: false });
          s.createIndex('created', 'metadata.created', { unique: false });
        }
      };
      req.onsuccess = e => { db = e.target.result; resolve(db); };
      req.onerror = e => reject(e.target.error);
    });
  }

  async function init() {
    await open();
    if (navigator.storage && navigator.storage.persist) {
      try { await navigator.storage.persist(); } catch (e) {}
    }
  }

  function uid() { return 'asset_' + (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); }

  async function put(asset) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).put(asset);
      tx.oncomplete = () => resolve(asset.id);
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function putBatch(assets) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      const s = tx.objectStore(STORE);
      assets.forEach(a => s.put(a));
      tx.oncomplete = () => resolve(assets.length);
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function get(id) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const req = tx.objectStore(STORE).get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function list(type) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const s = tx.objectStore(STORE);
      const req = type ? s.index('type').getAll(type) : s.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = e => reject(e.target.error);
    });
  }

  async function remove(id) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readwrite');
      tx.objectStore(STORE).delete(id);
      tx.oncomplete = () => resolve(true);
      tx.onerror = e => reject(e.target.error);
    });
  }

  async function search(query) {
    const all = await list();
    const q = query.toLowerCase();
    return all.filter(a => a.name.toLowerCase().includes(q) || (a.tags || []).some(t => t.toLowerCase().includes(q)));
  }

  async function count(type) {
    const d = await open();
    return new Promise((resolve, reject) => {
      const tx = d.transaction(STORE, 'readonly');
      const s = tx.objectStore(STORE);
      const req = type ? s.index('type').count(type) : s.count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = e => reject(e.target.error);
    });
  }

  function makeThumbnail(source, size) {
    size = size || 256;
    const c = U.makeCanvas(size, size);
    const ctx = U.ctx2d(c);
    if (source instanceof HTMLImageElement || source instanceof HTMLCanvasElement) {
      const s = Math.min(size / source.width, size / source.height);
      const w = source.width * s, h = source.height * s;
      ctx.drawImage(source, (size - w) / 2, (size - h) / 2, w, h);
    }
    return canvasToBlob(c, 'image/png');
  }

  async function importFile(file) {
    const ext = file.name.split('.').pop().toLowerCase();
    const isModel = /^(glb|gltf)$/.test(ext);
    const isHDR = ext === 'hdr';
    const isImage = /^(png|jpg|jpeg|webp|gif|avif|svg)$/.test(ext);

    const data = await file.arrayBuffer();
    let thumbnail = null;
    let type = 'texture';
    const meta = { format: ext, size: data.byteLength, created: new Date().toISOString(), source: 'import' };

    if (isModel) {
      type = 'model';
    } else if (isHDR) {
      type = 'hdri';
    } else if (isImage) {
      type = 'texture';
      try {
        const img = await loadImageFromBlob(new Blob([data], { type: file.type }));
        meta.dimensions = { w: img.naturalWidth, h: img.naturalHeight };
        thumbnail = await makeThumbnail(img);
      } catch (e) {}
    }

    const asset = {
      id: uid(), type, name: file.name.replace(/\.[^.]+$/, ''),
      tags: [], thumbnail, data: new Blob([data], { type: file.type || 'application/octet-stream' }),
      metadata: meta
    };
    await put(asset);
    return asset;
  }

  async function importFiles(files) {
    const assets = [];
    for (const f of files) {
      try { assets.push(await importFile(f)); } catch (e) { console.warn('asset import failed:', f.name, e); }
    }
    return assets;
  }

  function canvasToBlob(canvas, type) {
    type = type || 'image/png';
    const url = canvas.toDataURL(type);
    const b64 = url.split(',')[1];
    const bin = atob(b64);
    const arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    return Promise.resolve(new Blob([arr], { type }));
  }

  async function saveMaterial(name, maps, presetInfo) {
    const colorBlob = await canvasToBlob(maps.color);
    const normalBlob = await canvasToBlob(maps.normal);
    const thumbnail = await makeThumbnail(maps.color);
    const asset = {
      id: uid(), type: 'material', name: name,
      tags: [presetInfo.id, 'procedural'],
      thumbnail, data: colorBlob,
      materialData: { normal: normalBlob, metalness: presetInfo.metalness, roughnessVal: presetInfo.roughness, preset: presetInfo.id },
      metadata: { format: 'png', size: colorBlob.size, created: new Date().toISOString(), source: 'generated' }
    };
    await put(asset);
    return asset;
  }

  function loadImageFromBlob(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('image load failed')); };
      img.src = URL.createObjectURL(blob);
    });
  }

  function blobUrl(asset) {
    if (!asset || !asset.data) return null;
    return URL.createObjectURL(asset.data instanceof Blob ? asset.data : new Blob([asset.data]));
  }

  // Init on load
  if (typeof window !== 'undefined') {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
    else init();
  }

  return { init, put, putBatch, get, list, remove, search, count, importFile, importFiles, makeThumbnail, blobUrl, uid, saveMaterial, canvasToBlob };
})();

if (GF.api && GF.api.register) {
  GF.api.register('assets.list', 'type?("model"|"texture"|"hdri"|"material")', 'List assets in the library', a => GF.assets.list(a && a.type));
  GF.api.register('assets.count', 'type?', 'Count assets by type', a => GF.assets.count(a && a.type));
  GF.api.register('assets.search', 'query', 'Search assets by name or tag', a => GF.assets.search(a.query || ''));
  GF.api.register('assets.remove', 'id', 'Remove an asset from the library', a => GF.assets.remove(a.id));
  GF.api.register('materials.listPresets', '', 'List procedural material presets', () => GF.texture.listPresets());
  GF.api.register('materials.generate', 'preset, width?(512), height?(512)', 'Generate a procedural material and store in library', async a => {
    const maps = GF.texture.generateMaterial(a.preset, a.width, a.height);
    if (!maps) return { error: 'unknown preset: ' + a.preset };
    return GF.assets.saveMaterial(maps.preset.label, maps, maps.preset);
  });
  GF.api.register('materials.generateAll', '', 'Generate all 15 procedural material presets', async () => {
    const presets = GF.texture.listPresets();
    const results = [];
    for (const p of presets) {
      const maps = GF.texture.generateMaterial(p.id);
      if (maps) results.push(await GF.assets.saveMaterial(p.label, maps, maps.preset));
    }
    return results;
  });
}
