/* PixelTriks — assets-ui.js
   Asset library panel in the left sidebar. Browsable grid with tabs
   (All | Models | Textures | HDRIs), search, drag-to-scene. */
'use strict';
window.GF = window.GF || {};

GF.assetsUI = (function () {
  const $ = s => document.querySelector(s);
  const A = () => GF.assets;
  const S = () => GF.scene3d;

  let currentTab = 'all';
  let searchQuery = '';

  function build() {
    const section = $('#asset-section');
    if (!section) return;
    section.innerHTML = `
      <h3 class="panel-h">Assets</h3>
      <input type="text" class="ph-search" id="asset-search" placeholder="Search assets…">
      <div class="asset-tabs">
        <button class="asset-tab on" data-type="all">All</button>
        <button class="asset-tab" data-type="model">Models</button>
        <button class="asset-tab" data-type="texture">Textures</button>
        <button class="asset-tab" data-type="material">Materials</button>
        <button class="asset-tab" data-type="hdri">HDRIs</button>
      </div>
      <div id="asset-grid" class="asset-grid"></div>
      <div class="s3-row" style="margin-top:.5rem">
        <button class="text-btn ghost" id="asset-import-btn">Import files…</button>
        <button class="text-btn ghost" id="asset-gen-btn">Generate…</button>
      </div>
    `;
    wire();
    refresh();
  }

  function wire() {
    const tabs = document.querySelectorAll('.asset-tab');
    tabs.forEach(t => t.addEventListener('click', () => {
      tabs.forEach(x => x.classList.toggle('on', x === t));
      currentTab = t.dataset.type;
      refresh();
    }));

    const search = $('#asset-search');
    if (search) {
      let timer = null;
      search.addEventListener('input', () => {
        clearTimeout(timer);
        timer = setTimeout(() => { searchQuery = search.value.trim(); refresh(); }, 200);
      });
    }

    const gen = $('#asset-gen-btn');
    if (gen) gen.addEventListener('click', () => showGenMenu(gen));

    const imp = $('#asset-import-btn');
    if (imp) imp.addEventListener('click', () => {
      const input = document.createElement('input');
      input.type = 'file';
      input.multiple = true;
      input.accept = 'image/*,.glb,.gltf,.hdr';
      input.addEventListener('change', async () => {
        if (!input.files.length) return;
        GF.util.toast('Importing ' + input.files.length + ' file' + (input.files.length > 1 ? 's' : '') + '…');
        const assets = await A().importFiles(Array.from(input.files));
        GF.util.toast(assets.length + ' asset' + (assets.length !== 1 ? 's' : '') + ' imported');
        refresh();
      });
      input.click();
    });
  }

  async function refresh() {
    const grid = $('#asset-grid');
    if (!grid) return;

    let assets;
    if (searchQuery) {
      assets = await A().search(searchQuery);
      if (currentTab !== 'all') assets = assets.filter(a => a.type === currentTab);
    } else {
      assets = await A().list(currentTab === 'all' ? undefined : currentTab);
    }

    if (!assets.length) {
      grid.innerHTML = currentTab === 'material'
        ? '<p class="s3-status">No materials yet.<br>Hit <b>Generate</b> below to create PBR presets.</p>'
        : '<p class="s3-status">No assets yet.<br>Import files or drag-drop.</p>';
      return;
    }

    grid.innerHTML = '';
    assets.forEach(a => {
      const card = document.createElement('div');
      card.className = 'asset-card';
      card.title = a.name + ' (' + a.type + ')';
      card.draggable = true;

      if (a.thumbnail) {
        const img = document.createElement('img');
        img.src = URL.createObjectURL(a.thumbnail);
        img.alt = a.name;
        card.appendChild(img);
      } else {
        const icon = document.createElement('span');
        icon.className = 'asset-icon';
        icon.textContent = a.type === 'model' ? '⬡' : a.type === 'hdri' ? '☀' : '🖼';
        card.appendChild(icon);
      }

      const label = document.createElement('span');
      label.className = 'asset-label';
      label.textContent = a.name;
      card.appendChild(label);

      card.addEventListener('click', () => useAsset(a));
      card.addEventListener('dragstart', e => {
        e.dataTransfer.setData('application/x-pixeltriks-asset', a.id);
        e.dataTransfer.effectAllowed = 'copy';
      });

      grid.appendChild(card);
    });
  }

  async function useAsset(asset) {
    if (asset.type === 'model') {
      const url = A().blobUrl(asset);
      if (url && S()) {
        await S().importModel(url, asset.name);
        GF.util.toast('Model added: ' + asset.name);
      }
    } else if (asset.type === 'material') {
      await applyMaterial(asset);
    } else if (asset.type === 'texture') {
      if (asset.data) {
        try {
          const blob = asset.data instanceof Blob ? asset.data : new Blob([asset.data]);
          const img = await loadImg(blob);
          GF.doc.newDocument(img.naturalWidth, img.naturalHeight, null, asset.name);
          if (GF.ui) GF.ui.onDocumentOpened();
          GF.util.ctx2d(GF.doc.active().canvas).drawImage(img, 0, 0);
          if (GF.ui) { GF.ui.refreshLayers(); GF.view.requestRender(); }
          GF.util.toast('Texture opened: ' + asset.name);
        } catch (e) { GF.util.toast('Could not open texture'); }
      }
    } else if (asset.type === 'hdri' && S()) {
      const url = A().blobUrl(asset);
      if (url) { await S().setEnvironment(url); GF.util.toast('HDRI applied: ' + asset.name); }
    }
  }

  async function applyMaterial(asset) {
    if (!S() || S().selectedId() == null) { GF.util.toast('Select a 3D object first'); return; }
    const id = S().selectedId();
    const full = await A().get(asset.id);
    if (!full) return;
    const colorCanvas = await canvasFromBlob(full.data);
    const colorKey = S().addImageSource(colorCanvas, asset.name + '-color');
    const patch = { mapSource: colorKey };
    if (full.materialData) {
      if (full.materialData.normal) {
        const normalCanvas = await canvasFromBlob(full.materialData.normal);
        patch.normalSource = S().addImageSource(normalCanvas, asset.name + '-normal');
      }
      if (full.materialData.metalness !== undefined) patch.metalness = full.materialData.metalness;
      if (full.materialData.roughnessVal !== undefined) patch.roughness = full.materialData.roughnessVal;
    }
    S().setMaterial(id, patch);
    GF.util.toast('Material applied: ' + asset.name);
  }

  function canvasFromBlob(blob) { return GF.util.blobToCanvas(blob); }

  function showGenMenu(anchor) {
    const old = document.querySelector('.gen-menu');
    if (old) { old.remove(); return; }
    const presets = GF.texture.listPresets();
    const menu = document.createElement('div');
    menu.className = 'gen-menu tb-dropdown-menu';
    menu.style.cssText = 'position:absolute;bottom:100%;left:0;z-index:999;max-height:280px;overflow-y:auto;';
    const allBtn = document.createElement('div');
    allBtn.className = 'tb-dropdown-item';
    allBtn.textContent = 'All materials (15)';
    allBtn.addEventListener('click', async () => {
      menu.remove();
      GF.util.toast('Generating materials…');
      let created = 0;
      for (const p of presets) {
        const existing = await A().search(p.label);
        if (existing.some(a => a.type === 'material' && a.name === p.label)) continue;
        const maps = GF.texture.generateMaterial(p.id);
        if (maps) { await A().saveMaterial(p.label, maps, maps.preset); created++; }
      }
      GF.util.toast(created ? created + ' materials generated' : 'All materials already exist');
      refresh();
    });
    menu.appendChild(allBtn);
    const sep = document.createElement('div'); sep.className = 'tb-dropdown-sep'; menu.appendChild(sep);
    presets.forEach(p => {
      const item = document.createElement('div');
      item.className = 'tb-dropdown-item';
      item.textContent = p.label;
      item.addEventListener('click', async () => {
        menu.remove();
        const maps = GF.texture.generateMaterial(p.id);
        if (maps) { await A().saveMaterial(p.label, maps, maps.preset); GF.util.toast(p.label + ' created'); refresh(); }
      });
      menu.appendChild(item);
    });
    anchor.parentElement.style.position = 'relative';
    anchor.parentElement.appendChild(menu);
    const close = e => { if (!menu.contains(e.target) && e.target !== anchor) { menu.remove(); document.removeEventListener('pointerdown', close); } };
    setTimeout(() => document.addEventListener('pointerdown', close), 0);
  }

  function loadImg(blob) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(img.src); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(img.src); reject(new Error('load failed')); };
      img.src = URL.createObjectURL(blob);
    });
  }

  // Build on DOM ready
  if (typeof window !== 'undefined') {
    const go = () => { if ($('#asset-section')) build(); };
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', go);
    else go();
  }

  return { build, refresh };
})();
