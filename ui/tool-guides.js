/* PixelTriks — tool-guides.js
   In-app documentation for each tool. Opened via the "?" button in the optbar. */
'use strict';
window.GF = window.GF || {};

GF.toolGuides = (function () {
  const GUIDES = {
    wand: { icon: '✨', title: 'Smart Select — click to select, then act',
      body: `<p class="g-lead">Click to select a region of similar colour. A bar of one-tap actions appears — remove, cut out, fill — so the selection immediately leads somewhere.</p>
        <h3>Options</h3><ul>
          <li><b>Tolerance</b> — how close in colour a pixel must be. Low = picky, high = grabs more.</li>
          <li><b>Auto-remove</b> — on: clicking removes the object immediately. Off: you choose what to do from the action bar.</li>
        </ul>
        <h3>Keyboard</h3><ul>
          <li>Hold <span class="kbd">Shift</span> to add to selection</li>
          <li>Hold <span class="kbd">Alt</span> to subtract from selection</li>
        </ul>` },
    select: { icon: '⬚', title: 'Marquee Select — rectangles, ellipses & lasso',
      body: `<p class="g-lead">Drag to select a precise shape. The same action bar appears afterwards.</p>
        <h3>Options</h3><ul><li><b>Shape</b> — Rect, Ellipse, or freehand Lasso.</li></ul>
        <h3>Keyboard</h3><ul>
          <li>Hold <span class="kbd">Shift</span> to add to selection</li>
          <li>Hold <span class="kbd">Alt</span> to subtract</li>
        </ul>` },
    brush: { icon: '🖌', title: 'Brush — paint and erase',
      body: `<p class="g-lead">Paint with the current colour. Toggle to eraser mode to erase to transparency. Strokes respect the active selection.</p>
        <h3>Options</h3><ul>
          <li><b>Size / Opacity</b> — brush dimensions and transparency.</li>
          <li><b>Erase mode</b> — flips to eraser without switching tools.</li>
          <li><b>Pixel</b> — snaps to integer coordinates for crisp pixel art.</li>
        </ul>
        <p class="g-lead"><span class="kbd">Alt</span>-click anywhere to pick that colour.</p>` },
    fill: { icon: '🪣', title: 'Fill — flat colour and gradients',
      body: `<p class="g-lead">Click to flood-fill, or drag for a gradient blend. Inside a selection, the fill is clipped to it.</p>
        <h3>Options</h3><ul>
          <li><b>Mode</b> — Flat (click) or Gradient (drag).</li>
          <li><b>Tolerance</b> — for flat fill, how far the colour spreads.</li>
          <li><b>Gradient type</b> — Linear or Radial.</li>
        </ul>` },
    crop: { icon: '⌗', title: 'Crop & Straighten',
      body: `<p class="g-lead">Drag the handles, pick an aspect preset, and use the rule-of-thirds grid to compose. The Straighten slider rotates and auto-expands the canvas.</p>` },
    text: { icon: 'T', title: 'Text',
      body: `<p class="g-lead">Click to place text. Pick a font, size, colour and outline. Text stays <b>re-editable</b> — double-click a text layer to change the words or style any time.</p>` },
    move: { icon: '✛', title: 'Move',
      body: `<p class="g-lead">Drag to reposition the active layer. Content moved off-canvas is never lost.</p>` },
    shape: { icon: '▭', title: 'Shape',
      body: `<p class="g-lead">Drag to draw a rectangle, ellipse or line. Hold <span class="kbd">Shift</span> for a perfect square/circle.</p>` },
    scene3d: { icon: '⬡', title: '3D workspace — models, GLB & your images',
      body: `<p class="g-lead">Import GLB/GLTF models or add primitives, pose them, and texture them. Export as <b>.glb</b>, or <b>Flatten to layer</b> to render back to 2D.</p>
        <h3>Basics</h3><ul>
          <li><b>Orbit / Move / Rotate / Scale</b> — pick a mode in the options bar.</li>
          <li><b>Texture</b> — set an object's texture to the document, a layer, or an imported image.</li>
          <li><b>Keys</b> — <span class="kbd">Del</span> removes, <span class="kbd">F</span> frames.</li>
        </ul>` },
  };

  function open(name) {
    const g = GUIDES[name]; if (!g) return;
    GF.ui.modal({ title: g.icon + '  ' + g.title, body: '<div class="tool-guide">' + g.body + '</div>', ok: 'Got it', noCancel: true });
  }

  function has(name) { return !!GUIDES[name]; }

  return { open, has };
})();
