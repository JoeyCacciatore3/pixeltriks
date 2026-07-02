/* Forge Studio — api.js
   AI-operator surface. Everything the UI can do is exposed as a flat,
   discoverable command catalog so an automated agent (LLM with JS eval,
   browser automation, an MCP wrapper) can drive the app:

     GF.api.describe()        -> [{name, params, doc}]  machine-readable catalog
     GF.api.run(name, args)   -> executes; returns a result or a Promise
     GF.api.state()           -> current document / layers / selection / tool
     GF.api.snapshot(scale?)  -> PNG dataURL of the composite (the agent's "eyes")
     GF.api.layerPng(id)      -> PNG dataURL of one layer

   run() auto-refreshes the layer panel and viewport after every command, so
   agents never need to touch the DOM. */
'use strict';
window.GF = window.GF || {};

GF.api = (function () {
  const U = GF.util, D = GF.doc;
  const C = {};
  // ui (optional): {group, label, hint?, needsDoc?} — commands carrying it are
  // surfaced in the command palette (see commandList in forge-ui.js), so every
  // user-facing action has exactly one implementation and one catalog entry.
  const cmd = (name, params, doc, fn, ui) => { C[name] = { params, doc, fn, ui }; };
  const L = () => { const l = D.active(); if (!l) throw new Error('no document open'); return l; };

  /* --- document & layers --- */
  cmd('newDoc', 'w, h, bg?("white"|"black")', 'Create a document', a => { D.newDocument(a.w, a.h, a.bg || null, a.name || 'untitled'); GF.ui.onDocumentOpened(); });
  cmd('resize', 'w, h, scale?(bool)', 'Resize the canvas', a => { GF.history.push(D.doc, 'resize'); D.resize(a.w, a.h, !!a.scale); GF.select.clear(); });
  cmd('addLayer', 'name?', 'Add an empty layer above the active one', a => { GF.history.push(D.doc, 'add layer'); return D.addLayer(a.name || null).id; },
      { group: 'Layer', label: 'New layer', needsDoc: true });
  cmd('duplicateLayer', '', 'Duplicate the active layer', () => { GF.history.push(D.doc, 'dup'); return D.duplicateActive().id; },
      { group: 'Layer', label: 'Duplicate layer', needsDoc: true });
  cmd('deleteLayer', '', 'Delete the active layer', () => { GF.history.push(D.doc, 'del'); D.deleteActive(); });
  cmd('setActiveLayer', 'id', 'Make a layer active', a => { D.doc.activeId = a.id; });
  cmd('setLayer', 'name?, visible?, opacity?(0-1), blend?, x?, y?', 'Set properties on the active layer', a => { const l = L(); ['name','visible','opacity','blend','x','y'].forEach(k => { if (a[k] !== undefined) l[k] = a[k]; }); });
  cmd('mergeDown', '', 'Merge active layer into the one below', () => { GF.history.push(D.doc, 'merge'); D.mergeDown(); },
      { group: 'Layer', label: 'Merge down', needsDoc: true });
  cmd('flatten', '', 'Flatten all layers', () => { GF.history.push(D.doc, 'flatten'); D.flatten(); },
      { group: 'Layer', label: 'Flatten image', needsDoc: true });
  /* --- non-destructive: masks + adjustment layers --- */
  cmd('addMask', 'init?("reveal"|"selection")', 'Add a non-destructive mask to the active layer', a => { GF.history.push(D.doc, 'add mask'); D.addMask(null, a.init || 'reveal'); },
      { group: 'Layer', label: 'Add mask', needsDoc: true });
  cmd('removeMask', '', 'Remove the active layer\'s mask (discard)', () => { GF.history.push(D.doc, 'remove mask'); D.removeMask(); });
  cmd('invertMask', '', 'Invert the active layer\'s mask', () => { GF.history.push(D.doc, 'invert mask'); D.invertMask(); });
  cmd('applyMask', '', 'Bake the mask into the layer pixels', () => { GF.history.push(D.doc, 'apply mask'); D.applyMask(); });
  cmd('maskEdit', 'on?(bool)', 'Toggle painting onto the active layer mask', a => { D.doc.maskEdit = a.on !== undefined ? !!a.on : !D.doc.maskEdit; return D.doc.maskEdit; });
  cmd('addAdjustment', 'kind("brightnessContrast"|"hsl"|"posterize"|"invert"|"grayscale"|"autoLevels"), params?(obj)', 'Add a re-editable adjustment layer affecting the layers below', a => { GF.history.push(D.doc, 'add adjustment'); return D.addAdjustment(a.kind, a.params || {}); });
  cmd('setAdjust', 'params(obj)', 'Update the active adjustment layer\'s parameters', a => { GF.history.push(D.doc, 'edit adjustment'); D.setAdjust(null, a.params || {}); });
  cmd('curves', 'curves(obj {rgb?,r?,g?,b?:[[x,y],…]}), newLayer?(bool)', 'Tone curves via per-channel LUTs — one-shot or as an adjustment layer', a => {
    if (a.newLayer) { GF.history.push(D.doc, 'add curves'); return D.addAdjustment('curves', { curves: a.curves || {} }); }
    const luts = GF.filters.curveLuts(a.curves || {});
    GF.filters.applyToLayer(L(), 'curves', img => GF.filters.curves(img, luts));
  });
  // While the 3D workspace is active, undo/redo route to its scene stack.
  cmd('undo', '', 'Undo', () => (GF.scene3d && GF.scene3d.isActive()) ? GF.scene3d.hist.undo() : GF.history.undo(D.doc),
      { group: 'Edit', label: 'Undo', hint: 'Ctrl+Z' });
  cmd('redo', '', 'Redo', () => (GF.scene3d && GF.scene3d.isActive()) ? GF.scene3d.hist.redo() : GF.history.redo(D.doc),
      { group: 'Edit', label: 'Redo', hint: 'Ctrl+Y' });

  /* --- painting --- */
  cmd('paint', 'points([[x,y],…]), color?, size?, erase?(bool)', 'Stroke a polyline on the active layer or its mask (respects selection)', a => {
    const l = L();
    const maskMode = D.doc.maskEdit && l.mask;
    if (l.adjust && !maskMode) throw new Error('adjustment layer — add a mask to paint on it');
    if (!maskMode) D.bakeOffset(l);
    GF.history.push(D.doc, maskMode ? 'api paint (mask)' : 'api paint');
    const s = U.makeCanvas(D.doc.width, D.doc.height), x = U.ctx2d(s);
    x.strokeStyle = x.fillStyle = a.color || GF.view.view.brush.color;
    x.lineWidth = a.size || 16; x.lineCap = x.lineJoin = 'round';
    x.beginPath();
    a.points.forEach((p, i) => i ? x.lineTo(p[0], p[1]) : x.moveTo(p[0], p[1]));
    if (a.points.length === 1) x.arc(a.points[0][0], a.points[0][1], (a.size || 16) / 2, 0, 7);
    a.points.length > 1 ? x.stroke() : x.fill();
    if (GF.select.has()) { x.globalCompositeOperation = 'destination-in'; x.drawImage(GF.select.maskCanvas(), 0, 0); }
    const t = D.paintTarget();
    const c = U.ctx2d(t.canvas);
    c.globalCompositeOperation = a.erase ? 'destination-out' : 'source-over';
    c.drawImage(s, -t.x, -t.y);
    c.globalCompositeOperation = 'source-over';
  });
  cmd('fillAt', 'x, y, color?, tolerance?', 'Flood-fill at a point', a => { const v = GF.view.view; if (a.color) v.brush.color = a.color; if (a.tolerance !== undefined) v.fillTolerance = a.tolerance; GF.view.fillAt(a.x, a.y); });
  cmd('text', 'text, x, y, size?, color?, font?, outline?, outlineColor?', 'Render text to a new layer', a => {
    GF.history.push(D.doc, 'api text');
    const l = D.addLayer('Text: ' + a.text.slice(0, 18)), c = U.ctx2d(l.canvas);
    c.font = 'bold ' + (a.size || 48) + 'px ' + (a.font || 'Impact, sans-serif');
    c.textBaseline = 'top'; c.lineJoin = 'round';
    if (a.outline) { c.strokeStyle = a.outlineColor || '#000'; c.lineWidth = a.outline * 2; c.strokeText(a.text, a.x, a.y); }
    c.fillStyle = a.color || '#fff'; c.fillText(a.text, a.x, a.y);
    return l.id;
  });

  /* --- selection --- */
  cmd('wandSelect', 'x, y, tolerance?, contiguous?, mode?("add"|"subtract")', 'Magic-wand select at a point', a => {
    const img = U.ctx2d(D.composite()).getImageData(0, 0, D.doc.width, D.doc.height);
    GF.select.wand(img, a.x, a.y, a.tolerance ?? 32, a.contiguous !== false, a.mode || 'replace');
    return GF.select.count();
  });
  cmd('selectRect', 'x, y, w, h, mode?', 'Rectangular selection', a => {
    const c = U.makeCanvas(D.doc.width, D.doc.height); const x = U.ctx2d(c);
    x.fillStyle = '#fff'; x.fillRect(a.x, a.y, a.w, a.h);
    GF.select.fromAlphaCanvas(c, a.mode || 'replace'); return GF.select.count();
  });
  cmd('selectAll', '', 'Select everything', () => GF.select.selectAll(),
      { group: 'Edit', label: 'Select all', hint: 'Ctrl+A', needsDoc: true });
  cmd('deselect', '', 'Clear the selection', () => GF.select.clear(),
      { group: 'Edit', label: 'Deselect', hint: 'Esc', needsDoc: true });
  cmd('invertSelection', '', 'Invert the selection', () => GF.select.invert(),
      { group: 'Edit', label: 'Invert selection', hint: 'Ctrl+I', needsDoc: true });
  cmd('growSelection', 'px', 'Dilate the selection', a => GF.select.grow(a.px || 2));
  cmd('featherSelection', 'px', 'Soften selection edges', a => GF.select.feather(a.px || 3));
  cmd('eraseSelection', 'defringe?(bool)', 'Erase selected pixels to transparent', a => GF.retouch.eraseSelection(L(), a.defringe !== false));
  cmd('layerViaCopy', '', 'Copy selection (or layer) to a new layer', () => { GF.history.push(D.doc, 'copy'); const snap = D.docAligned(L()).canvas; if (GF.select.has()) { const c = U.ctx2d(snap); c.globalCompositeOperation = 'destination-in'; c.drawImage(GF.select.maskCanvas(), 0, 0); } const nl = D.addLayer(L().name + ' copy'); U.ctx2d(nl.canvas).drawImage(snap, 0, 0); return nl.id; },
      { group: 'Layer', label: 'Copy selection to layer', needsDoc: true });

  /* --- retouch / filters / texture --- */
  cmd('contentAwareFill', '', 'Rebuild the selected region from surrounding texture', () => GF.retouch.contentAwareFill(L()),
      { group: 'Retouch', label: 'Content-aware fill', needsDoc: true });
  cmd('removeBackground', 'tolerance?, defringe?', 'Auto-remove the background from the edges', a => GF.retouch.removeBackground(L(), a.tolerance ?? 32, a.defringe !== false));
  cmd('colorReplace', 'from([r,g,b]), to?([r,g,b]), tol?, soft?, dH?, dS?, dL?', 'Replace/shift a color on the active layer', a => GF.retouch.colorReplace(L(), { from: a.from, to: a.to || null, tol: a.tol ?? 48, soft: a.soft ?? 32, dH: a.dH || 0, dS: a.dS || 0, dL: a.dL || 0 }));
  cmd('layerFX', 'kind("outline"|"glow"|"shadow"|"bevel"|"emboss"), color?, size?, angle?, depth?', 'Silhouette effect behind, or bevel/emboss depth on, the active layer', a => GF.retouch.layerFX(L(), a.kind, a.color || '#000', a.size || 4, { angle: a.angle, depth: a.depth, soft: a.soft }));
  cmd('inkOutline', 'sensitivity?(0-100), thickness?, color?, newLayer?(bool=true)', 'Bolden lines: Sobel edge-detect → bold ink outlines (to a new "lines" layer by default)', a => GF.retouch.inkOutline(L(), a),
      { group: 'Retouch', label: 'Ink outline (line art)', needsDoc: true });
  cmd('cleanColors', 'colors?(2-64), sharpen?(0-2), defringe?(bool), splitLayers?(bool)', 'Deblur + quantize to flat colors (kills edge blur/bleed); splitLayers puts each color on its own layer', a => GF.retouch.cleanColors(L(), a),
      { group: 'Retouch', label: 'Clean colors (flatten & sharpen)', needsDoc: true });
  cmd('cutToLayer', 'cut?(bool=true), bevel?(bool)', 'Cut the current selection onto its own layer (optionally beveled)', a => GF.retouch.cutToLayer(L(), a));
  cmd('smartUpscale', 'factor(2|4), mode?("pixel"|"photo")', 'Upscale the document', a => GF.retouch.smartUpscale(a.factor || 2, a.mode || 'pixel'));
  cmd('filter', 'name("grayscale"|"invert"|"blur"|"sharpen"|"edge"|"autoLevels"), …', 'Apply a one-shot filter (respects selection)', a => GF.filters.applyToLayer(L(), a.name, img => GF.filters[a.name](img)));
  cmd('brightnessContrast', 'brightness(-100..100), contrast(-100..100)', 'Adjust the active layer', a => GF.filters.applyToLayer(L(), 'bc', img => GF.filters.brightnessContrast(img, a.brightness || 0, a.contrast || 0)));
  cmd('hsl', 'h(-180..180), s(-100..100), l(-100..100)', 'Hue/saturation/lightness', a => GF.filters.applyToLayer(L(), 'hsl', img => GF.filters.hsl(img, a.h || 0, a.s || 0, a.l || 0)));
  cmd('flipLayer', 'horizontal?(bool)', 'Flip the active layer', a => { GF.history.push(D.doc, 'flip'); D.flipLayer(L(), a.horizontal !== false); },
      { group: 'Transform', label: 'Flip horizontal', needsDoc: true });
  cmd('rotateLayer', 'cw?(bool)', 'Rotate the active layer 90°', a => { GF.history.push(D.doc, 'rot'); D.rotateLayer90(L(), a.cw !== false); },
      { group: 'Transform', label: 'Rotate 90°', needsDoc: true });
  cmd('trim', '', 'Crop the document to visible content', () => { GF.history.push(D.doc, 'trim'); D.trimToContent(); GF.select.clear(); },
      { group: 'Transform', label: 'Trim to content', needsDoc: true });
  cmd('generate', 'kind(clouds|wood|marble|bricks|checker|gradient|stone|metal|grass|rust), asLayer?', 'Procedural texture', a => GF.library.generateProcedural(a.kind, D.doc.open ? D.doc.width : 512, D.doc.open ? D.doc.height : 512, !!a.asLayer));

  /* --- brush / export --- */
  cmd('setBrushShape', 'shape("round"|"square"|"line"), pixel?(bool)',
    'Switch the brush head shape (and optional pixel snapping)',
    a => { const v = GF.view.view; if (a.shape) v.brush.shape = a.shape; if (a.pixel !== undefined) v.brush.pixel = !!a.pixel; });
  cmd('exportLayers', 'type?("image/png"|"image/webp"|"image/jpeg"), scale?, quality?(0-1)',
    'Export every visible layer as a separate file (Pixelorama-style split export)',
    a => GF.exporter.exportImage({ splitLayers: true, type: a.type || 'image/png', scale: a.scale || 1, quality: a.quality ?? 0.92 }),
    { group: 'File', label: 'Export layers separately', needsDoc: true });

  /* --- introspection --- */
  function state() {
    return {
      doc: { open: D.doc.open, name: D.doc.name, width: D.doc.width, height: D.doc.height },
      layers: D.doc.layers.map(l => ({ id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, x: l.x, y: l.y, active: l.id === D.doc.activeId })),
      selection: { count: GF.select.count(), bounds: GF.select.bounds() },
      tool: GF.view.view.tool,
      history: { canUndo: GF.history.canUndo(), canRedo: GF.history.canRedo() }
    };
  }
  function snapshot(scale) {
    const flat = D.composite(), s = scale || Math.min(1, 1024 / Math.max(flat.width, flat.height));
    const c = U.makeCanvas(Math.max(1, Math.round(flat.width * s)), Math.max(1, Math.round(flat.height * s)));
    const x = U.ctx2d(c); x.imageSmoothingQuality = 'high';
    x.drawImage(flat, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  }
  function layerPng(id) { const l = D.byId(id); return l ? l.canvas.toDataURL('image/png') : null; }

  function describe() { return Object.keys(C).map(k => ({ name: k, params: C[k].params, doc: C[k].doc })); }
  /** Palette-facing subset: every command annotated with ui metadata. */
  function commands() { return Object.keys(C).filter(k => C[k].ui).map(k => Object.assign({ name: k }, C[k].ui)); }
  function run(name, args) {
    if (!C[name]) throw new Error('unknown command: ' + name + ' — call GF.api.describe()');
    const out = C[name].fn(args || {});
    GF.ui.refreshLayers();
    GF.view.requestRender();
    return out;
  }

  return { describe, run, state, snapshot, layerPng, commands, register: cmd };
})();
