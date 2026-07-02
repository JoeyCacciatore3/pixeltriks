/* Forge Studio — tools.js
   Viewport rendering (zoom/pan, checkerboard, DPR-aware) and pointer
   tools. One Pointer Events code path covers mouse, pen and touch;
   two simultaneous touches always pinch-zoom regardless of tool. */
'use strict';
window.GF = window.GF || {};

GF.view = (function () {
  const U = GF.util;
  const D = GF.doc;

  const view = {
    zoom: 1, panX: 0, panY: 0,
    tool: 'brush',
    // shape: round | square | line. `pixel` snaps stamps to integer coords for
    // crisp pixel-art output; orthogonal to shape (a round brush can still be pixel).
    brush: { size: 16, opacity: 1, color: '#e8a33d', pixel: false, shape: 'round', hardness: 100, flow: 100, spacing: 25 },
    fillTolerance: 24,
    wand: { tolerance: 32, contiguous: true, defringe: true, heal: false },
    marquee: { shape: 'rect' },                       // rect | ellipse | lasso
    gradient: { kind: 'linear', color2: '#1a1d24', toAlpha: true },
    shape: { kind: 'rect', fill: true, stroke: false, strokeW: 4 },
    cloneSource: null,                                // doc-space {x,y}
    spacePan: false
  };

  let viewportEl, canvasEl, ctx;
  let dirty = true;
  let checker = null;

  // stroke buffer for brush/eraser/clone (composited on pointer-up)
  let stroke = null;        // {canvas, ctx, mode, masked?, src?, offset?}
  let lastDocPt = null;
  let moveStart = null;     // for move tool {x,y,layerX,layerY}
  let selDrag = null;       // marquee/lasso in progress {x0,y0,x1,y1,pts,mode}
  let gradDrag = null;      // gradient drag {x0,y0,x1,y1}
  let shapeDrag = null;     // shape drag {x0,y0,x1,y1}
  let antsPhase = 0, antsTimer = 0;
  const pointers = new Map();
  let pinchStart = null;

  function init() {
    viewportEl = U.$('#viewport');
    canvasEl = U.$('#view-canvas');
    ctx = canvasEl.getContext('2d');
    makeChecker();

    new ResizeObserver(() => { fitCanvasToViewport(); requestRender(); }).observe(viewportEl);
    fitCanvasToViewport();

    viewportEl.addEventListener('pointerdown', onDown);
    viewportEl.addEventListener('pointermove', onMove);
    viewportEl.addEventListener('pointerup', onUp);
    viewportEl.addEventListener('pointercancel', onUp);
    viewportEl.addEventListener('wheel', onWheel, { passive: false });

    window.addEventListener('keydown', e => {
      if (e.code === 'Space' && !e.repeat && document.activeElement.tagName !== 'INPUT') {
        view.spacePan = true; e.preventDefault();
      }
    });
    window.addEventListener('keyup', e => { if (e.code === 'Space') view.spacePan = false; });

    GF.select.onChange(requestRender); // redraw when the selection changes

    rafLoop();
  }

  function makeChecker() {
    const c = U.makeCanvas(16, 16);
    const cc = U.ctx2d(c);
    cc.fillStyle = '#23262d'; cc.fillRect(0, 0, 16, 16);
    cc.fillStyle = '#181b20'; cc.fillRect(0, 0, 8, 8); cc.fillRect(8, 8, 8, 8);
    checker = ctx.createPattern(c, 'repeat');
  }

  function fitCanvasToViewport() {
    const dpr = window.devicePixelRatio || 1;
    const r = viewportEl.getBoundingClientRect();
    canvasEl.width = Math.max(1, Math.round(r.width * dpr));
    canvasEl.height = Math.max(1, Math.round(r.height * dpr));
    canvasEl.style.width = r.width + 'px';
    canvasEl.style.height = r.height + 'px';
  }

  function requestRender() { dirty = true; }

  function rafLoop(now) {
    // crawl the marching ants while a selection is live
    if (GF.select && GF.select.has() && now - antsTimer > 280) {
      antsTimer = now; antsPhase ^= 1; dirty = true;
    }
    if (dirty) { dirty = false; render(); }
    requestAnimationFrame(rafLoop);
  }

  function render() {
    const dpr = window.devicePixelRatio || 1;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    if (!D.doc.open) return;

    // The compositor render handles masks + adjustment layers; inject the live
    // brush stroke onto its target (layer pixels or mask) so painting previews.
    function compositeWithStroke() {
      if (!stroke) return D.composite();
      const L = D.active(), t = D.paintTarget();
      if (!t) return D.composite();
      const tmp = U.makeCanvas(t.canvas.width, t.canvas.height), tc = U.ctx2d(tmp);
      tc.drawImage(t.canvas, 0, 0);
      tc.globalAlpha = view.brush.opacity;
      tc.globalCompositeOperation = stroke.mode === 'eraser' ? 'destination-out' : 'source-over';
      tc.drawImage(stroke.masked || stroke.canvas, -t.x, -t.y);
      const key = t.isMask ? 'mask' : 'canvas';
      const orig = L[key]; L[key] = tmp;
      const out = D.composite();
      L[key] = orig;
      return out;
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(view.panX, view.panY);
    ctx.scale(view.zoom, view.zoom);
    ctx.imageSmoothingEnabled = view.zoom < 4; // crisp pixels when zoomed in
    ctx.imageSmoothingQuality = 'high';        // proper resampling when zoomed out

    // document well: checkerboard for transparency
    ctx.save();
    ctx.fillStyle = checker;
    ctx.fillRect(0, 0, D.doc.width, D.doc.height);
    ctx.restore();

    // layers. Masks + adjustment layers need the full compositor; the fast
    // per-layer path is used only when neither is present (the common case).
    if (D.doc.layers.some(L => L.adjust || L.mask)) {
      ctx.drawImage(compositeWithStroke(), 0, 0);
    } else {
      for (const L of D.doc.layers) {
        if (!L.visible || !L.canvas) continue;
        ctx.save();
        ctx.globalAlpha = L.opacity;
        ctx.globalCompositeOperation = L.blend;
        ctx.drawImage(D.previewedCanvas(L), L.x, L.y);
        // live stroke preview rides on the active layer
        if (stroke && L.id === D.doc.activeId) {
          ctx.globalCompositeOperation = stroke.mode === 'eraser' ? 'destination-out' : 'source-over';
          ctx.globalAlpha = L.opacity * view.brush.opacity;
          ctx.drawImage(stroke.masked || stroke.canvas, 0, 0); // doc space, selection-clipped
        }
        ctx.restore();
      }
    }

    // document border
    ctx.strokeStyle = 'rgba(232,163,61,.5)';
    ctx.lineWidth = 1 / view.zoom;
    ctx.strokeRect(0, 0, D.doc.width, D.doc.height);

    // active-layer outline while the Move tool is active, so it's clear what
    // a drag will shift (and where its edges are once moved off-canvas)
    const effTool = view.spacePan ? 'pan' : view.tool;
    if (effTool === 'move') {
      const L = D.active();
      if (L && L.canvas) {                 // adjustment layers have no canvas — skip the outline
        ctx.save();
        ctx.strokeStyle = 'rgba(232,163,61,.9)';
        ctx.lineWidth = 1 / view.zoom;
        ctx.setLineDash([6 / view.zoom, 4 / view.zoom]);
        ctx.strokeRect(L.x, L.y, L.canvas.width, L.canvas.height);
        ctx.restore();
      }
    }

    // selection: dim everything outside it (so it's unmistakable) + marching ants
    if (GF.select && GF.select.has()) {
      ctx.save();
      ctx.drawImage(GF.select.dimCanvas(), 0, 0);          // veil over the unselected area
      ctx.imageSmoothingEnabled = false;
      ctx.drawImage(GF.select.vizCanvas(antsPhase), 0, 0); // crisp boundary
      ctx.restore();
    }

    // in-progress drag previews (marquee / gradient / shape), document space
    if (selDrag || gradDrag || shapeDrag) {
      ctx.save();
      ctx.lineWidth = 1.5 / view.zoom;
      ctx.setLineDash([5 / view.zoom, 4 / view.zoom]);
      ctx.strokeStyle = '#fff';
      if (selDrag) {
        if (view.marquee.shape === 'lasso') {
          ctx.beginPath();
          selDrag.pts.forEach((p, i) => i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y));
          ctx.stroke();
        } else {
          const x = Math.min(selDrag.x0, selDrag.x1), y = Math.min(selDrag.y0, selDrag.y1);
          const w = Math.abs(selDrag.x1 - selDrag.x0), h = Math.abs(selDrag.y1 - selDrag.y0);
          ctx.beginPath();
          if (view.marquee.shape === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, w / 2, h / 2, 0, 0, Math.PI * 2);
          else ctx.rect(x, y, w, h);
          ctx.stroke();
        }
      }
      if (gradDrag) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(buildGradientCanvas(gradDrag), 0, 0);
        ctx.globalAlpha = 1;
        ctx.beginPath(); ctx.moveTo(gradDrag.x0, gradDrag.y0); ctx.lineTo(gradDrag.x1, gradDrag.y1); ctx.stroke();
      }
      if (shapeDrag) {
        ctx.globalAlpha = 0.85;
        ctx.drawImage(buildShapeCanvas(shapeDrag), 0, 0);
      }
      ctx.restore();
    }

    // clone-stamp source crosshair
    if (view.tool === 'clone' && view.cloneSource) {
      const s = view.cloneSource, r = 6 / view.zoom;
      ctx.save();
      ctx.strokeStyle = '#7fd0ff'; ctx.lineWidth = 1.5 / view.zoom;
      ctx.beginPath();
      ctx.moveTo(s.x - r, s.y); ctx.lineTo(s.x + r, s.y);
      ctx.moveTo(s.x, s.y - r); ctx.lineTo(s.x, s.y + r);
      ctx.stroke();
      ctx.beginPath(); ctx.arc(s.x, s.y, r * 0.8, 0, Math.PI * 2); ctx.stroke();
      ctx.restore();
    }
  }

  /** Render the current gradient drag to a doc-sized canvas (selection-clipped). */
  function buildGradientCanvas(g) {
    const c = U.makeCanvas(D.doc.width, D.doc.height), x = U.ctx2d(c);
    const o = view.gradient;
    let grad;
    if (o.kind === 'radial') {
      const r = Math.max(1, Math.hypot(g.x1 - g.x0, g.y1 - g.y0));
      grad = x.createRadialGradient(g.x0, g.y0, 0, g.x0, g.y0, r);
    } else {
      grad = x.createLinearGradient(g.x0, g.y0, g.x1, g.y1);
    }
    grad.addColorStop(0, view.brush.color);
    grad.addColorStop(1, o.toAlpha ? view.brush.color + '00' : o.color2);
    x.fillStyle = grad;
    x.fillRect(0, 0, c.width, c.height);
    if (GF.select.has()) {
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(GF.select.maskCanvas(), 0, 0);
    }
    return c;
  }

  /** Render the current shape drag to a doc-sized canvas (selection-clipped). */
  function buildShapeCanvas(s) {
    const c = U.makeCanvas(D.doc.width, D.doc.height), x = U.ctx2d(c);
    const o = view.shape;
    let x0 = s.x0, y0 = s.y0, x1 = s.x1, y1 = s.y1;
    if (s.square && o.kind !== 'line') { // shift = constrain square/circle
      const side = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0));
      x1 = x0 + Math.sign(x1 - x0 || 1) * side;
      y1 = y0 + Math.sign(y1 - y0 || 1) * side;
    }
    const rx = Math.min(x0, x1), ry = Math.min(y0, y1);
    const rw = Math.abs(x1 - x0), rh = Math.abs(y1 - y0);
    x.beginPath();
    if (o.kind === 'ellipse') x.ellipse(rx + rw / 2, ry + rh / 2, Math.max(1, rw / 2), Math.max(1, rh / 2), 0, 0, Math.PI * 2);
    else if (o.kind === 'line') { x.moveTo(x0, y0); x.lineTo(x1, y1); }
    else x.rect(rx, ry, rw, rh);
    if (o.kind === 'line') {
      x.strokeStyle = view.brush.color; x.lineWidth = o.strokeW; x.lineCap = 'round'; x.stroke();
    } else {
      if (o.fill) { x.fillStyle = view.brush.color; x.fill(); }
      if (o.stroke || !o.fill) { x.strokeStyle = o.fill ? view.gradient.color2 : view.brush.color; x.lineWidth = o.strokeW; x.stroke(); }
    }
    if (GF.select.has()) {
      x.globalCompositeOperation = 'destination-in';
      x.drawImage(GF.select.maskCanvas(), 0, 0);
    }
    return c;
  }

  /* ---------------- coordinates ---------------- */
  function screenToDoc(clientX, clientY) {
    const r = viewportEl.getBoundingClientRect();
    return {
      x: (clientX - r.left - view.panX) / view.zoom,
      y: (clientY - r.top - view.panY) / view.zoom
    };
  }

  function zoomFit() {
    if (!D.doc.open) return;
    const r = viewportEl.getBoundingClientRect();
    const pad = 40;
    view.zoom = Math.min((r.width - pad) / D.doc.width, (r.height - pad) / D.doc.height);
    view.zoom = U.clamp(view.zoom, 0.02, 32);
    view.panX = (r.width - D.doc.width * view.zoom) / 2;
    view.panY = (r.height - D.doc.height * view.zoom) / 2;
    requestRender();
    GF.ui.updateZoomLabel();
  }

  function zoomAt(clientX, clientY, factor) {
    const r = viewportEl.getBoundingClientRect();
    const px = clientX - r.left, py = clientY - r.top;
    const before = screenToDoc(clientX, clientY);
    view.zoom = U.clamp(view.zoom * factor, 0.02, 32);
    view.panX = px - before.x * view.zoom;
    view.panY = py - before.y * view.zoom;
    requestRender();
    GF.ui.updateZoomLabel();
  }

  function onWheel(e) {
    if (document.body.dataset.mode === '3d') return;   // the 3D workspace owns the pointer
    e.preventDefault();
    if (!D.doc.open) return;
    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    zoomAt(e.clientX, e.clientY, factor);
  }

  /* ---------------- pointer handling ---------------- */
  function onDown(e) {
    if (document.body.dataset.mode === '3d') return;   // the 3D workspace owns the pointer
    if (!D.doc.open) return;
    viewportEl.setPointerCapture(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      // entering pinch: cancel any in-progress stroke or drag
      cancelStroke();
      moveStart = null; selDrag = null; gradDrag = null; shapeDrag = null;
      const pts = [...pointers.values()];
      pinchStart = {
        dist: Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y),
        zoom: view.zoom,
        cx: (pts[0].x + pts[1].x) / 2,
        cy: (pts[0].y + pts[1].y) / 2,
        panX: view.panX, panY: view.panY
      };
      return;
    }
    if (pointers.size > 1) return;

    const tool = view.spacePan ? 'pan' : view.tool;
    const p = screenToDoc(e.clientX, e.clientY);
    const L = D.active();

    if (tool === 'pan') {
      moveStart = { px: e.clientX, py: e.clientY, panX: view.panX, panY: view.panY, panning: true };
      return;
    }
    if (!L) return;

    if (tool === 'move') {
      // history is pushed lazily on the first actual movement, so a plain
      // click with the move tool doesn't create a no-op undo step
      moveStart = { px: e.clientX, py: e.clientY, layerX: L.x, layerY: L.y, pushed: false };
    } else if (tool === 'brush' || tool === 'eraser') {
      if (e.altKey) { pickColor(p); return; }   // Alt-click samples color (replaces the eyedropper tool)
      if (beginStroke(tool === 'eraser' ? 'eraser' : 'brush')) stampTo(p);
    } else if (tool === 'fill') {
      if (e.altKey) { pickColor(p); return; }
      doFill(L, p);
    } else if (tool === 'picker') {
      pickColor(p);
    } else if (tool === 'wand' || tool === 'magiceraser') {
      const x = Math.floor(p.x), y = Math.floor(p.y);
      if (x < 0 || y < 0 || x >= D.doc.width || y >= D.doc.height) return;
      const img = U.ctx2d(D.composite()).getImageData(0, 0, D.doc.width, D.doc.height);
      if (tool === 'wand') {
        const mode = (e.shiftKey && e.altKey) ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : (view.selMode || 'replace');
        // sample the active layer's own pixels, or the flattened composite (default)
        const wimg = (view.wand.sample === 'layer' && L && L.canvas)
          ? U.ctx2d(D.docAligned(L).canvas).getImageData(0, 0, D.doc.width, D.doc.height) : img;
        GF.select.wand(wimg, x, y, view.wand.tolerance, view.wand.contiguous, mode);
        if (view.wand.antialias) GF.select.feather(1);
        view.wand.seed = { x: x, y: y };   // remembered so tolerance can re-select live
        const n = GF.select.count();
        U.toast(n ? n.toLocaleString() + ' px selected' : 'Nothing selected — try raising Tolerance');
      } else {
        GF.select.wand(img, x, y, view.wand.tolerance, view.wand.contiguous, 'replace');
        if (view.wand.heal) {
          // one-click object removal: pad the selection, then rebuild the
          // region from surrounding texture instead of leaving a hole
          GF.select.grow(2);
          GF.retouch.contentAwareFill(L);
          U.toast('Healed — region rebuilt from surrounding texture');
        } else {
          GF.retouch.eraseSelection(L, view.wand.defringe);
        }
        GF.select.clear(); // one-shot: don't leave a stale selection behind
        GF.ui.refreshLayers();
      }
      requestRender();
    } else if (tool === 'marquee') {
      const mmode = (e.shiftKey && e.altKey) ? 'intersect' : e.shiftKey ? 'add' : e.altKey ? 'subtract' : (view.selMode || 'replace');
      selDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, pts: [p], mode: mmode };
    } else if (tool === 'gradient') {
      gradDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y };
    } else if (tool === 'shape') {
      shapeDrag = { x0: p.x, y0: p.y, x1: p.x, y1: p.y, square: e.shiftKey };
    } else if (tool === 'clone') {
      if (e.altKey || e.ctrlKey) {
        view.cloneSource = { x: p.x, y: p.y };
        U.toast('Clone source set — now paint to stamp from it');
        requestRender();
      } else if (!view.cloneSource) {
        U.toast('Alt-click (or Ctrl-click) to set the clone source first');
      } else {
        if (beginStroke('clone', p)) stampTo(p);
      }
    } else if (tool === 'text') {
      GF.ui.openTextDialog(p);
    }
  }

  function onMove(e) {
    if (!D.doc.open) return;
    GF.ui.showCursorPos(screenToDoc(e.clientX, e.clientY));

    if (pointers.has(e.pointerId)) {
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (pointers.size === 2 && pinchStart) {
      const pts = [...pointers.values()];
      const dist = Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y);
      const cx = (pts[0].x + pts[1].x) / 2;
      const cy = (pts[0].y + pts[1].y) / 2;
      const factor = dist / Math.max(1, pinchStart.dist);
      view.zoom = U.clamp(pinchStart.zoom * factor, 0.02, 32);
      // keep pinch midpoint anchored + allow two-finger pan
      const r = viewportEl.getBoundingClientRect();
      const docX = (pinchStart.cx - r.left - pinchStart.panX) / pinchStart.zoom;
      const docY = (pinchStart.cy - r.top - pinchStart.panY) / pinchStart.zoom;
      view.panX = (cx - r.left) - docX * view.zoom;
      view.panY = (cy - r.top) - docY * view.zoom;
      requestRender();
      GF.ui.updateZoomLabel();
      return;
    }

    if (!pointers.has(e.pointerId)) return;

    if (moveStart && moveStart.panning) {
      view.panX = moveStart.panX + (e.clientX - moveStart.px);
      view.panY = moveStart.panY + (e.clientY - moveStart.py);
      requestRender();
      return;
    }
    if (moveStart) {
      const L = D.active();
      if (L) {
        const nx = Math.round(moveStart.layerX + (e.clientX - moveStart.px) / view.zoom);
        const ny = Math.round(moveStart.layerY + (e.clientY - moveStart.py) / view.zoom);
        if (nx !== L.x || ny !== L.y) {
          if (!moveStart.pushed) {
            GF.history.push(D.doc, 'move layer'); // snapshot only once, on first real move
            moveStart.pushed = true;
          }
          L.x = nx; L.y = ny;
          requestRender();
        }
        return;
      }
    }
    if (stroke) {
      stampTo(screenToDoc(e.clientX, e.clientY));
      return;
    }
    const p = screenToDoc(e.clientX, e.clientY);
    if (selDrag) {
      selDrag.x1 = p.x; selDrag.y1 = p.y;
      if (view.marquee.shape === 'lasso') {
        const last = selDrag.pts[selDrag.pts.length - 1];
        if (Math.hypot(p.x - last.x, p.y - last.y) > 1.5 / view.zoom) selDrag.pts.push(p);
      }
      requestRender();
    } else if (gradDrag) {
      gradDrag.x1 = p.x; gradDrag.y1 = p.y;
      requestRender();
    } else if (shapeDrag) {
      shapeDrag.x1 = p.x; shapeDrag.y1 = p.y; shapeDrag.square = e.shiftKey;
      requestRender();
    }
  }

  function onUp(e) {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchStart = null;
    if (pointers.size > 0) return;
    if (stroke) commitStroke();
    if (selDrag) commitMarquee();
    if (gradDrag) commitGradient();
    if (shapeDrag) commitShape();
    moveStart = null;
    GF.ui.refreshLayers();
  }

  /* ---------------- marquee / gradient / shape commits ---------------- */
  function commitMarquee() {
    const s = selDrag; selDrag = null;
    const dragged = Math.hypot(s.x1 - s.x0, s.y1 - s.y0) * view.zoom > 3 || s.pts.length > 3;
    if (!dragged) { GF.select.clear(); requestRender(); return; } // plain click = deselect
    const c = U.makeCanvas(D.doc.width, D.doc.height), x = U.ctx2d(c);
    x.fillStyle = '#fff';
    x.beginPath();
    if (view.marquee.shape === 'lasso') {
      s.pts.forEach((p, i) => i ? x.lineTo(p.x, p.y) : x.moveTo(p.x, p.y));
      x.closePath();
    } else if (view.marquee.shape === 'ellipse') {
      const rx = Math.min(s.x0, s.x1), ry = Math.min(s.y0, s.y1);
      const rw = Math.abs(s.x1 - s.x0), rh = Math.abs(s.y1 - s.y0);
      x.ellipse(rx + rw / 2, ry + rh / 2, Math.max(0.5, rw / 2), Math.max(0.5, rh / 2), 0, 0, Math.PI * 2);
    } else {
      x.rect(Math.min(s.x0, s.x1), Math.min(s.y0, s.y1), Math.abs(s.x1 - s.x0), Math.abs(s.y1 - s.y0));
    }
    x.fill();
    GF.select.fromAlphaCanvas(c, s.mode);
    const n = GF.select.count();
    U.toast(n ? n.toLocaleString() + ' px selected' : 'Selection empty');
    requestRender();
  }

  function commitGradient() {
    const g = gradDrag; gradDrag = null;
    const L = D.active();
    if (!L || Math.hypot(g.x1 - g.x0, g.y1 - g.y0) < 2) { requestRender(); return; }
    const maskMode = D.doc.maskEdit && L.mask;
    if (L.adjust && !maskMode) { U.toast('Adjustment layer — add a mask to paint on it'); requestRender(); return; }
    if (!maskMode) D.bakeOffset(L);
    GF.history.push(D.doc, 'gradient');
    const t = D.paintTarget();
    U.ctx2d(t.canvas).drawImage(buildGradientCanvas(g), -t.x, -t.y);
    requestRender();
  }

  function commitShape() {
    const s = shapeDrag; shapeDrag = null;
    const L = D.active();
    if (!L || (Math.hypot(s.x1 - s.x0, s.y1 - s.y0) < 2 && view.shape.kind !== 'line')) { requestRender(); return; }
    const maskMode = D.doc.maskEdit && L.mask;
    if (L.adjust && !maskMode) { U.toast('Adjustment layer — add a mask to paint on it'); requestRender(); return; }
    if (!maskMode) D.bakeOffset(L);
    GF.history.push(D.doc, 'shape');
    const t = D.paintTarget();
    U.ctx2d(t.canvas).drawImage(buildShapeCanvas(s), -t.x, -t.y);
    requestRender();
  }

  /* ---------------- brush / eraser / clone ---------------- */
  function beginStroke(mode, startPt) {
    const L = D.active();
    if (!L) return false;
    const maskMode = D.doc.maskEdit && L.mask;
    if (L.adjust && !maskMode) { U.toast('Adjustment layer — add a mask to paint on it'); return false; }
    if (!maskMode) D.bakeOffset(L);
    GF.history.push(D.doc, maskMode ? mode + ' (mask)' : mode);
    stroke = {
      mode,
      canvas: U.makeCanvas(D.doc.width, D.doc.height)
    };
    stroke.ctx = U.ctx2d(stroke.canvas);
    if (mode === 'clone') {
      // snapshot the layer in doc space so cloning never feeds on itself,
      // and lock the source offset for the whole stroke
      stroke.src = D.docAligned(L).canvas;
      stroke.offset = { x: startPt.x - view.cloneSource.x, y: startPt.y - view.cloneSource.y };
    }
    lastDocPt = null;
    return true;
  }

  /** Re-clip the live stroke against the selection mask (cached per stamp). */
  function maskStroke() {
    if (!GF.select.has()) { stroke.masked = null; return; }
    if (!stroke.maskedCnv) { stroke.maskedCnv = U.makeCanvas(D.doc.width, D.doc.height); }
    const m = U.ctx2d(stroke.maskedCnv);
    m.clearRect(0, 0, D.doc.width, D.doc.height);
    m.drawImage(stroke.canvas, 0, 0);
    m.globalCompositeOperation = 'destination-in';
    m.drawImage(GF.select.maskCanvas(), 0, 0);
    m.globalCompositeOperation = 'source-over';
    stroke.masked = stroke.maskedCnv;
  }

  /** A round brush stamp: a radial alpha falloff (hardness 0–100, 100=hard edge)
      tinted to `color`. Drawn repeatedly along a stroke with per-stamp flow. */
  function makeStamp(size, hardness, color) {
    const d = Math.max(2, Math.ceil(size) + 2);
    const c = U.makeCanvas(d, d), x = U.ctx2d(c);
    const r = Math.max(0.5, size / 2), cx = d / 2, cy = d / 2;
    const inner = r * Math.min(0.999, (hardness == null ? 100 : hardness) / 100);
    const g = x.createRadialGradient(cx, cy, inner, cx, cy, r);
    g.addColorStop(0, 'rgba(255,255,255,1)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, Math.PI * 2); x.fill();
    // tint the alpha falloff to the brush color
    x.globalCompositeOperation = 'source-in';
    x.fillStyle = color;
    x.fillRect(0, 0, d, d);
    return c;
  }

  function stampTo(p) {
    const s = stroke.ctx;
    const size = view.brush.size;
    if (stroke.mode === 'clone') {
      // stamp circles of the snapshot, shifted by the stroke's locked offset
      const from = lastDocPt || p;
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / Math.max(1, size / 4)));
      for (let i = 0; i <= steps; i++) {
        const x = from.x + (p.x - from.x) * (i / steps);
        const y = from.y + (p.y - from.y) * (i / steps);
        s.save();
        s.beginPath();
        s.arc(x, y, size / 2, 0, Math.PI * 2);
        s.clip();
        s.drawImage(stroke.src, stroke.offset.x, stroke.offset.y);
        s.restore();
      }
      lastDocPt = p;
      maskStroke();
      requestRender();
      return;
    }
    const shape = view.brush.shape || 'round';
    s.strokeStyle = stroke.mode === 'eraser' ? '#000' : view.brush.color;
    s.fillStyle = s.strokeStyle;
    if (view.brush.pixel) {
      // crisp pixel stamps along the segment — head is a rect (square/round) or a 1px line
      const from = lastDocPt || p;
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y)));
      const half = Math.floor(size / 2);
      for (let i = 0; i <= steps; i++) {
        const x = Math.floor(from.x + (p.x - from.x) * (i / steps)) - half;
        const y = Math.floor(from.y + (p.y - from.y) * (i / steps)) - half;
        if (shape === 'line') s.fillRect(x, y + half, size, 1);          // horizontal 1px line head
        else s.fillRect(x, y, size, size);                                 // square/round → square pixels
      }
    } else if (shape === 'square') {
      // square brush head, smooth interpolation: fillRect at each interpolated point
      const from = lastDocPt || p;
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / Math.max(1, size / 4)));
      const half = size / 2;
      for (let i = 0; i <= steps; i++) {
        const x = from.x + (p.x - from.x) * (i / steps);
        const y = from.y + (p.y - from.y) * (i / steps);
        s.fillRect(x - half, y - half, size, size);
      }
    } else if (shape === 'line') {
      // horizontal 1px-thick line head — used for hatching / scanline effects
      const from = lastDocPt || p;
      const steps = Math.max(1, Math.ceil(Math.hypot(p.x - from.x, p.y - from.y) / Math.max(1, size / 4)));
      const half = size / 2;
      for (let i = 0; i <= steps; i++) {
        const x = from.x + (p.x - from.x) * (i / steps);
        const y = from.y + (p.y - from.y) * (i / steps);
        s.fillRect(x - half, y, size, 1);
      }
    } else {
      // round brush — soft stamps along the segment (hardness/flow/spacing)
      if (!stroke.stamp) stroke.stamp = makeStamp(size, view.brush.hardness == null ? 100 : view.brush.hardness, stroke.mode === 'eraser' ? '#000' : view.brush.color);
      const stamp = stroke.stamp;
      const flow = (view.brush.flow == null ? 100 : view.brush.flow) / 100;
      const step = Math.max(0.5, (view.brush.spacing == null ? 25 : view.brush.spacing) / 100 * size);
      const from = lastDocPt || p;
      const dist = Math.hypot(p.x - from.x, p.y - from.y);
      const n = dist < 0.01 ? 0 : Math.max(1, Math.ceil(dist / step));
      s.save();
      s.globalAlpha = flow;
      for (let i = (lastDocPt ? 1 : 0); i <= n; i++) {
        const t = n === 0 ? 0 : i / n;
        const x = from.x + (p.x - from.x) * t, y = from.y + (p.y - from.y) * t;
        s.drawImage(stamp, x - stamp.width / 2, y - stamp.height / 2);
      }
      s.restore();
    }
    lastDocPt = p;
    maskStroke();
    requestRender();
  }

  function commitStroke() {
    const t = D.paintTarget();   // active layer pixels, or its mask in mask-edit mode
    if (t && stroke) {
      const c = U.ctx2d(t.canvas);
      c.save();
      c.globalAlpha = view.brush.opacity;
      c.globalCompositeOperation = stroke.mode === 'eraser' ? 'destination-out' : 'source-over';
      // stroke is in document space; the target canvas origin sits at (t.x, t.y).
      // The masked variant confines the stroke to the active selection.
      c.drawImage(stroke.masked || stroke.canvas, -t.x, -t.y);
      c.restore();
    }
    stroke = null;
    lastDocPt = null;
    requestRender();
  }

  function cancelStroke() {
    if (!stroke) return;
    stroke = null;
    lastDocPt = null;
    GF.history.undo(D.doc); // drop the snapshot taken at stroke start
    requestRender();
  }

  /* ---------------- flood fill ---------------- */
  function doFill(_L, p) {
    const L = D.active();
    if (!L) return;
    const maskMode = D.doc.maskEdit && L.mask;
    if (L.adjust && !maskMode) { U.toast('Adjustment layer — add a mask to paint on it'); return; }
    if (!maskMode) D.bakeOffset(L);
    // work in the target canvas's own pixel space; its origin is at (tx, ty)
    const tgt = D.paintTarget();
    const canvas = tgt.canvas, tx = tgt.x, ty = tgt.y;
    const w = canvas.width, h = canvas.height;
    const x0 = Math.floor(p.x - tx), y0 = Math.floor(p.y - ty);
    if (x0 < 0 || y0 < 0 || x0 >= w || y0 >= h) return;
    GF.history.push(D.doc, maskMode ? 'fill (mask)' : 'fill');

    const img = U.ctx2d(canvas).getImageData(0, 0, w, h);
    const d = img.data;
    const i0 = (y0 * w + x0) * 4;
    const target = [d[i0], d[i0 + 1], d[i0 + 2], d[i0 + 3]];
    const [fr, fg, fb] = U.hexToRgb(view.brush.color);
    const tol = view.fillTolerance;
    const tol2 = tol * tol * 4;

    const match = i => {
      const dr = d[i] - target[0], dg = d[i + 1] - target[1],
            db = d[i + 2] - target[2], da = d[i + 3] - target[3];
      return dr * dr + dg * dg + db * db + da * da <= tol2;
    };
    if (target[0] === fr && target[1] === fg && target[2] === fb && target[3] === 255 && tol === 0) return;

    // an active selection confines the fill (pixels outside it block the flood)
    const sel = GF.select.has() ? GF.select.get() : null;
    const dw = D.doc.width, dh = D.doc.height;
    const selected = (x, y) => {
      if (!sel) return true;
      const dx = x + tx, dy = y + ty; // target canvas space -> doc space
      return dx >= 0 && dy >= 0 && dx < dw && dy < dh && sel[dy * dw + dx] >= 128;
    };

    const visited = new Uint8Array(w * h);
    const stack = [x0 + y0 * w];
    while (stack.length) {
      const pos = stack.pop();
      if (visited[pos]) continue;
      visited[pos] = 1;
      const i = pos * 4;
      const x = pos % w, y = (pos / w) | 0;
      if (!selected(x, y) || !match(i)) continue;
      d[i] = fr; d[i + 1] = fg; d[i + 2] = fb; d[i + 3] = 255;
      if (x > 0) stack.push(pos - 1);
      if (x < w - 1) stack.push(pos + 1);
      if (y > 0) stack.push(pos - w);
      if (y < h - 1) stack.push(pos + w);
    }
    U.ctx2d(canvas).putImageData(img, 0, 0);
    requestRender();
  }

  /* ---------------- keyboard nudge (move tool) ---------------- */
  let nudgeTimer = null;
  function nudge(dx, dy) {
    if (!D.doc.open) return;
    const L = D.active();
    if (!L) return;
    // coalesce a burst of arrow-key presses into a single undo step
    if (nudgeTimer === null) GF.history.push(D.doc, 'nudge layer');
    else clearTimeout(nudgeTimer);
    L.x += dx; L.y += dy;
    nudgeTimer = setTimeout(() => { nudgeTimer = null; }, 700);
    requestRender();
  }

  function pickColor(p) {
    const flat = D.composite();
    const x = Math.floor(p.x), y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= flat.width || y >= flat.height) return;
    const px = U.ctx2d(flat).getImageData(x, y, 1, 1).data;
    if (px[3] === 0) { U.toast('Transparent pixel — color unchanged'); return; }
    view.brush.color = U.rgbToHex(px[0], px[1], px[2]);
    U.$('#brush-color').value = view.brush.color;
    U.toast('Picked ' + view.brush.color);
  }

  /** Programmatic flood fill at doc coords (used by GF.api). */
  function fillAt(x, y) { const L = D.active(); if (L) doFill(L, { x, y }); }

  return { view, init, requestRender, zoomFit, zoomAt, screenToDoc, nudge, fillAt };
})();
