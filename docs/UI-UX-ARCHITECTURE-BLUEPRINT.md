
# PixelTriks UI/UX Architecture Blueprint

> **2026-07-17:** `GAME-DECK-V2-ROADMAP.md` supersedes four rows of this doc
> (gamepad bindings: ABXY, D-pad zoom, D-pad tool switching, dual AI-tools home)
> and adds the command-registry architecture + duplication audit. Where the two
> conflict, the roadmap wins.

This document is the single source of truth for the PixelTriks UI refactor. It maps every core engine feature to a logical place within the new "Game Deck" user interface, eliminating redundancy and simplifying the user experience.

## Philosophy: The "Game Deck" Layout

Instead of one massive panel with five tabs, we distribute features logically across four dedicated screen quadrants, supplemented by gamepad-style controls.

1.  **Top Bar (Global Actions):** For app-level actions like File, Export, and AI.
2.  **Left Panel (Tool Selection):** The primary creative toolset, using flyout menus for related tools.
3.  **Right Panel (The Inspector):** Context-sensitive panel showing properties *only* for the currently selected item (layer, 3D object, tool, etc.). No more tabs.
4.  **Bottom Bar (Contextual Actions & Status):** For contextual buttons ("Apply Filter") and at-a-glance status.

## Verified Feature-to-UI Mapping

This table is our blueprint. It lists every identified feature and its proposed new, simplified home.

| Feature Category | Feature | Current Location (Cluttered) | **New Logical Home (Game Deck UI)** |
| :--- | :--- | :--- | :--- |
| **App & File** | Menu, Open, Export | Top Bar | (No change) |
| | Import Image as Layer | Hidden (File Input) | **Top Bar "File" Menu** |
| | Undo / Redo | Top Bar | **Start/Select Buttons** (Gamepad paradigm) |
| | Zoom Controls | Top Bar | **D-Pad Up/Down** + Pinch-to-Zoom |
| | Command Palette (Search) | Top Bar | (No change) |
| | History Panel | Layers Tab & Top Bar Button | **Right Panel** (when nothing is selected) |
| | Theme Toggle | Top Bar | **Top Bar** (unchanged) |
| **Core Tools** | Move, Select, Crop | Tool Rail | **Left Panel** (Move/Select on D-Pad Left/Right) |
| | Brush, Fill, Gradient, Text, Shape | Tool Rail | **Left Panel** (as primary creative tools) |
| | Color Picker | Tool Rail | **Left Panel** (primary/secondary color wells) |
| | Recent Colors | Face Palette (Tool Rail) | **ABXY Face Buttons** (as quick color swatches) |
| | AI Tools (Wand, 3D) | Tool Rail & Top Bar | **Top Bar "AI/FX" Menu** & Left Panel (distinct icons) |
| **Layer Management**| Layer List | Layers Tab (Right Panel) | **Right Panel** (dedicated, always visible Layer List) |
| | Blend Mode, Opacity | Layers Tab (Right Panel) | **Right Panel** (at top of Layer List) |
| | New/Delete Layer | Layers Tab (Right Panel) & Quick Actions | **Right Panel** (buttons below Layer List) |
| | Adjustment/Style Layer | Layers Tab (Right Panel) | **Right Panel** (buttons below Layer List) |
| | Duplicate/Merge Layer | Layers Tab (Right Panel) | **Right Panel** (buttons below Layer List) |
| **Adjustments** | Light & Color Sliders | Adjust Tab (Right Panel) | **Right Panel** (in a new "Adjustments" section, visible when a layer is selected) |
| | Curves Adjustment | (Engine only) | **Right Panel** ("Adjustments" section) |
| | Histogram | Adjust Tab (Right Panel) | **Right Panel** ("Adjustments" section) |
| | Filter Presets | Adjust Tab (Right Panel) | **Bottom Bar** (as a scrollable "Filter Strip" when in "Filter Mode") |
| | Blur, Sharpen | (Engine only) | **Right Panel** ("Adjustments" section) |
| | Texture Tools (Normal Map, Seamless) | Adjust Tab (Right Panel) | **Top Bar 'AI/FX' Menu** (These are advanced effects) |
| **3D Workspace** | Mode Toggle (2D/3D) | (Implicit via 3D tool) | **L/R Shoulder Buttons** (Gamepad paradigm for mode switching) |
| | 3D Primitives (Box, Sphere, etc.) | Assets Tab (Right Panel) | **Left Panel** (as a flyout from the "Shape" tool) |
| | Model/Texture Import | Assets Tab (Right Panel) | **Top Bar "File" Menu** (as "Import Model/Texture") |
| | Procedural Textures (Wood, etc.) | Assets Tab (Right Panel) | **Right Panel** (in the "Material" section of a selected 3D object) |
| | Object Properties (Transform) | Props Tab (Right Panel) | **Right Panel** (when a 3D object is selected) |
| | Material Properties (Color, etc.) | Props Tab (Right Panel) | **Right Panel** (when a 3D object is selected) |
| | Lighting Properties | Props Tab (Right Panel) | **Right Panel** (when a light is selected) |
| **Help & Guides** | Tool Guide | Guide Tab (Right Panel) | **Bottom Bar** (Info icon that reveals tips for current tool) |
| | Keyboard Shortcuts | Top Bar Button | (No change) |

## Verified Core Engine Capabilities (Ground Truth from `core/api.js`)

#### File I/O
- `new(w, h)`: New document.
- `open(file)`: Open a project file.
- `import(file)`: Import an image as a new layer.
- `loadState(json)`: Load a project from JSON.
- `export(type)`: Export final image (PNG, JPG, WEBP).
- `exportState()`: Export project to a `.json` file.

#### History
- `undo()`, `redo()`, `list()`

#### Core Objects & State
- `get('doc')`: Document properties (width, height, name).
- `get('tools')`: Get/set active tool.
- `get('mode')`: Toggle between 2D and 3D mode.
- `get('zoom')`: Get/set zoom level, fit to screen.

#### Selection
- The selection object has specific methods (`exists`, `rect`, `path`, `clear`) that are managed through the UI, primarily the floating selection bar.

#### Layer Management
- Standard: `add`, `remove`, `select`, `move`, `update` (opacity, blend), `duplicate`, `merge`.
- `addAdjustment(type, settings)`: Add special adjustment layers (e.g., Curves, Levels).

#### Image Adjustments & Filters
- Basic sliders: `brightness`, `contrast`, `saturate`, `hue`, `vibrance`, `noise`.
- One-click filters: `invert`, `sepia`, `grayscale`.
- Advanced Filters: `blur`, `sharpen`.
- `curves(settings)`: Full-featured curves adjustment.

#### Transformations
- `flip(h|v)`, `rotate(90|-90)`, `crop(rect)`.

#### Asset Library & 3D
- `getTexture(id)`, `addTexture(id, img)` for managing 3D textures.
