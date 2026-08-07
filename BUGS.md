# PixelTriks Bug & Issue Tracker

> Full codebase audit performed 2026-08-07. Every file in the project was read
> and analyzed. This document is the source of truth for known issues.
>
> **Status key:** `[ ]` open · `[x]` fixed · `[~]` wontfix/deferred
>
> **How to verify:** Each entry includes the file, line number(s), and a
> description of how to reproduce or observe the issue. Line numbers are from
> the 2026-08-07 audit — they shift as fixes land. Use the description to
> relocate.

---

## P0 — Critical (crashes, data corruption, resource exhaustion)

### BUG-001: WebGL context leak in updateStatusBar()
- **File:** `ui/forge-ui.js:243`
- **Code:** `const gl = document.createElement('canvas').getContext('webgl2');`
- **Problem:** Creates a new canvas + WebGL2 context on **every call**.
  `updateStatusBar()` fires on every scene change (wired at line 42-43).
  Browsers limit WebGL contexts to ~8-16 per page. After sustained use (adding/
  removing objects, editing), the 3D renderer loses its context and crashes.
- **Reproduce:** Add and remove ~20 objects in a session, watch the console for
  `WebGL context lost` warnings.
- **Fix:** Check once at boot, cache the boolean result.
- **Status:** `[ ]`

### BUG-002: Undo during modal transform corrupts mesh geometry
- **File:** `core/editmesh.js` — keyHandler (lines 776-803), modal state
  (lines 397-418)
- **Problem:** The keyHandler doesn't intercept Ctrl+Z / Cmd+Z — they fall
  through to the global undo handler. If the user presses undo while a grab/
  rotate/scale modal is active, `restore()` overwrites `verts` and `faces`
  while `modal` still holds stale vertex indices and original positions. The
  next `updateModal()` writes to indices that may be out of bounds or belong
  to different vertices, silently corrupting geometry.
- **Reproduce:** Enter edit mode → select vertices → press G to grab → while
  moving, press Ctrl+Z → click to confirm → observe deformed/broken mesh.
- **Fix:** Either `cancelModal()` before any undo fires, or block global undo
  while `modal` is truthy (add early return in keyHandler for Ctrl/Cmd+Z).
- **Status:** `[ ]`

### BUG-003: removeObject undo loses animation mixer
- **File:** `core/scene3d.js:618-622`
- **Problem:** `removeObject` deletes the mixer via `mixers.delete(id)` before
  pushing the undo entry. The undo callback (`attach(o); applyMaterial(o)`)
  re-adds the node but never recreates the mixer. After undoing a model
  deletion, animation controls render but are completely dead —
  `playAnimations()` / `pauseAnimations()` iterate `mixers` and find nothing.
- **Reproduce:** Import an animated GLB → delete the model → Ctrl+Z to undo →
  press Play → nothing happens, no error in console.
- **Fix:** Stash the mixer entry in the undo closure and restore it on undo.
- **Status:** `[ ]`

### BUG-004: enter() without exit() leaks previous editing session
- **File:** `core/editmesh.js:702-723`
- **Problem:** `enter()` never checks `active` or calls `exit()`. If called
  directly via `GF.editmesh.enter(newId)` while already editing another mesh:
  - Previous object is left with flat-shaded non-indexed display geometry
  - `restoreSelection()` is never called for the old object (handles hidden)
  - Old object's visual state is permanently wrong until page reload
- **Scope:** `toggle()` (Tab key) does call `exit()` first, so this is only
  reachable via direct `enter()` calls (API, UI buttons, automation) — not
  the standard Tab workflow. Still a real bug for programmatic callers.
- **Reproduce:** Via console: `GF.editmesh.enter(1)` then `GF.editmesh.enter(2)`
  without exiting first → Object 1 is permanently corrupted.
- **Fix:** Add `if (active) exit();` at the top of `enter()`.
- **Status:** `[ ]`

### BUG-005: Blob URL memory leak in asset thumbnails
- **File:** `ui/assets-ui.js:103`
- **Code:** `img.src = URL.createObjectURL(a.thumbnail);`
- **Problem:** `refresh()` can be called repeatedly (tab switch, search,
  import). Each call creates new blob URLs that are never revoked. Memory
  grows unbounded. (The `loadImg` helper at line 220 revokes correctly —
  this spot doesn't.)
- **Reproduce:** Switch between asset library tabs repeatedly while watching
  `performance.memory.usedJSHeapSize` — it grows monotonically.
- **Fix:** Track previous URLs and revoke them before creating new ones, or
  use the existing `loadImg` helper.
- **Status:** `[ ]`

### BUG-006: Service worker fetch handler returns undefined on cache miss
- **File:** `sw.js:50`
- **Code:** `.catch(() => hit))` — `hit` is always `undefined` because the
  code only reaches the `fetch()` branch when `caches.match()` returned null.
- **Problem:** Offline requests get `undefined` instead of a proper error
  response. This causes a generic network error instead of a friendly
  offline message.
- **Fix:** Return `new Response('Offline', { status: 503 })` or remove the
  dead `.catch(() => hit)`.
- **Status:** `[ ]`

---

## P1 — High (wrong behavior, data loss potential, security)

### BUG-007: Scale axis constraint uses fragile truthy check
- **File:** `core/editmesh.js:413-416`
- **Problem:** The scale code uses a truthy check (`m.axis.x ? f : 1`) to
  decompose axis-constrained scaling. Currently `setAxis()` only produces
  clean unit vectors `(1,0,0)`, `(0,1,0)`, `(0,0,1)` where the truthy check
  happens to work correctly. But grab (line 405) and rotate (line 411) use
  proper projection math. If `setAxis` ever produces non-unit or diagonal
  axes (e.g. for local-space constraints on rotated objects), scale would
  produce shear instead of constrained scaling.
- **Severity:** Not a runtime bug today — fragile pattern that will break if
  axis generation changes. Grab and rotate already do this correctly.
- **Fix:** Use projection/rejection decomposition like grab does.
- **Status:** `[ ]`

### BUG-008: handleViewportDrop doesn't await handleFiles
- **File:** `core/scene3d.js:600`, also `ui/forge-ui.js:108,111`
- **Problem:** `handleFiles()` is async, but callers don't await it. If the
  promise rejects (corrupt GLB, network error), it becomes an unhandled
  rejection. The "Loading…" status toast stays forever. Object URLs created
  in `handleFiles` may race if two drops happen quickly.
- **Fix:** `await handleFiles(...)` and catch errors with user feedback.
- **Status:** `[ ]`

### BUG-009: Objects removed but GPU resources never disposed
- **File:** `core/scene3d.js:618-622, 361`
- **Problem:** `detach(o)` removes the node from `sceneRoot` and splices from
  `objects[]`, but never calls `.dispose()` on geometry, material, or textures.
  These survive in undo closures. When the undo stack truncates (50 entries,
  line 82), the closure is GC'd but GPU resources are already orphaned.
  Long sessions accumulate GPU memory.
- **Fix:** Add a disposal path when undo entries are evicted from the stack.
- **Status:** `[ ]`

### BUG-010: images Map grows unbounded — no removal path
- **File:** `core/scene3d.js:244-249`
- **Problem:** `addImageSource` inserts into `images` but there is no
  `removeImageSource` anywhere. Every imported texture image lives forever.
- **Fix:** Add `removeImageSource()` and call it when objects are permanently
  deleted (past undo window).
- **Status:** `[ ]`

### BUG-011: Duplicate animated model loses all animation data
- **File:** `core/scene3d.js:626-641`
- **Problem:** `duplicateObject` clones node/material but never clones the
  mixer or animation clips. The new object has no entry in the `mixers` Map.
  Animation controls may appear but operate on the original's mixer.
- **Reproduce:** Import animated GLB → duplicate it → select the clone →
  press Play → original animates, clone stays frozen.
- **Fix:** Clone the mixer and clips for the new object.
- **Status:** `[ ]`

### BUG-012: importedClips array never cleared on deletion
- **File:** `core/animation.js:151-153`
- **Problem:** Every `importModel` appends clips via `importClips()`.
  `removeObject()` cleans up the mixer but not the animation module's
  `importedClips` array. Import → delete → re-import accumulates duplicate
  clips that get baked into GLB exports via `getClips()`.
- **Fix:** Wire model removal into animation clip cleanup.
- **Status:** `[ ]`

### BUG-013: paint3d crash on object deletion while painting
- **File:** `core/paint3d.js:60-66`
- **Problem:** `exit()` nulls `targetId` but if the painted object is deleted
  externally while paint mode is active, the next `onPointerDown` calls
  `S().raycastUV()` against a dead reference.
- **Fix:** Wire `removeObject` to call `paint3d.exit()` if the target matches.
- **Status:** `[ ]`

### BUG-014: IndexedDB — no QuotaExceededError handling
- **File:** `core/assets.js:42-60`
- **Problem:** `put()` and `putBatch()` reject with raw DOMException but
  callers never catch `QuotaExceededError`. Large GLB imports produce an
  opaque error with no user feedback.
- **Fix:** Catch by error name, toast a message, offer cleanup.
- **Status:** `[ ]`

### BUG-015: IndexedDB — no onversionchange handler
- **File:** `core/assets.js:28`
- **Problem:** Two-tab scenario: one tab upgrades DB version, other tab's
  `db` reference goes stale. Writes silently fail.
- **Fix:** `db.onversionchange = () => { db.close(); db = null; };`
- **Status:** `[ ]`

### BUG-016: innerHTML XSS vectors via plugin/file names
- **Files:** `ui/forge-ui.js:299-300`, `ui/hotbar.js:160`, `ui/remap.js:66`
- **Problem:** Command palette injects `c.label`, `c.group`, `c.hint` raw
  into innerHTML. A malicious plugin registering
  `{ title: '<img onerror=alert(1)>' }` would execute arbitrary JS.
  Model file names could also carry payloads.
- **Fix:** Escape HTML entities before interpolation, or use textContent.
- **Status:** `[ ]`

---

## P2 — Medium (UX issues, performance, code quality)

### BUG-017: Double-execute on `f` key (frame scene twice)
- **Files:** `ui/scene3d-ui.js:399` + `ui/forge-ui.js:181`
- **Problem:** Both files bind separate handlers for the `f` key, both call
  `frame()`. Neither checks `e.defaultPrevented`.
- **Fix:** Remove one binding, or check `defaultPrevented`.
- **Status:** `[ ]`

### BUG-018: dissolveEdge batch splice shifts face indices
- **File:** `core/editmesh.js:527, 539`
- **Problem:** Multi-edge dissolve splices faces during iteration. `faceZone`
  can desync — zones shift to wrong faces.
- **Fix:** Collect all changes first, apply in reverse index order.
- **Status:** `[ ]`

### BUG-019: loopcut/subdivide push no-op undo entries
- **File:** `core/editmesh.js:557, 570`
- **Problem:** Early-return (via toast) inside `op()` callback still calls
  `commit()`, pushing an empty undo entry that does nothing when undone.
- **Fix:** Check preconditions before calling `op()`.
- **Status:** `[ ]`

### BUG-020: affectedVerts() crashes on stale face selection
- **File:** `core/editmesh.js:349`
- **Problem:** `selectElements()` API accepts unchecked indices. Out-of-bounds
  face index → `faces[f]` is undefined → `.forEach` throws TypeError.
- **Fix:** Validate indices in `selectElements()`, or guard in `affectedVerts`.
- **Status:** `[ ]`

### BUG-021: zoneTexCache never cleared on exit
- **File:** `core/editmesh.js:37`
- **Problem:** `CanvasTexture` objects persist across edit sessions, accumulating
  GPU memory.
- **Fix:** Dispose and clear in `exit()`.
- **Status:** `[ ]`

### BUG-022: Gamepad RAF loop runs permanently
- **File:** `ui/gamepad.js:226`
- **Problem:** `requestAnimationFrame(frame)` loops every frame even with no
  controller connected. Prevents mobile browser throttling.
- **Fix:** Only loop on `gamepadconnected`, stop on disconnect.
- **Status:** `[ ]`

### BUG-023: z-index 999 on generate menu escapes stacking
- **File:** `ui/assets-ui.js:183`
- **Problem:** Generate menu floats above modals (z:80) and command palette
  (z:90).
- **Fix:** Use z-index consistent with the app's layer system.
- **Status:** `[ ]`

### BUG-024: transform-manager.js is completely orphaned
- **File:** `core/transform-manager.js` (98 lines)
- **Problem:** No file references `GF.transformManager`. Dead code loaded at
  boot, cached by service worker. `pt:transform` event dispatched to nobody.
- **Fix:** Remove the file, or integrate it into the transform pipeline.
- **Status:** `[ ]`

### BUG-025: Service worker runtime-caches everything unbounded
- **File:** `sw.js:46-49`
- **Problem:** All GET requests that miss the static cache are fetched and
  cached indefinitely — including Poly Haven API responses, CDN textures,
  HDRIs (100+ MB each). No size cap, no TTL, no same-origin restriction.
- **Fix:** Only runtime-cache same-origin, add max-entries or TTL policy.
- **Status:** `[ ]`

### BUG-026: Animation pingpong can produce negative time
- **File:** `core/animation.js:59`
- **Problem:** Large `dt` (backgrounded tab) makes `currentTime - duration`
  exceed `duration`, producing negative result. No clamp.
- **Fix:** Clamp to `[0, duration]` after direction reversal.
- **Status:** `[ ]`

### BUG-027: Vector3 allocation every frame in animate()
- **File:** `core/scene3d.js:167-170`
- **Problem:** `new THREE.Vector3()` called twice per frame for selection-box
  updates. GC pressure at 60fps.
- **Fix:** Pre-allocate scratch vectors at module scope.
- **Status:** `[ ]`

### BUG-028: PCFSoftShadowMap deprecated
- **File:** `core/scene3d.js:108`
- **Problem:** Deprecated in Three.js r182 for WebGL. Use `PCFShadowMap`.
- **Status:** `[ ]`

### ~~BUG-029: THREE.Clock deprecated since r183~~ — FALSE POSITIVE
- **Verification:** Clock is used correctly for `getDelta()` feeding animation
  mixers. Not deprecated in a breaking way for this use case. Removed.
- **Status:** `[~]` wontfix

### BUG-030: Empty GLB creates invisible phantom object
- **File:** `core/scene3d.js:482-511`
- **Problem:** GLB with no meshes still creates a scene entry. User sees an
  invisible, unselectable item in the object list.
- **Fix:** Check for meshes before adding to scene. Toast a warning if empty.
- **Status:** `[ ]`

---

## P3 — Low (cosmetic, dead code, nice-to-have)

### BUG-031: Dead code — interact variable, compCanvas, planePoint()
- **File:** `core/scene3d.js`
- `interact` (line 31): set but never read for branching.
- `compCanvas` (line 36): always null. Remnant of removed 2D editor.
- `planePoint` (line 782-788): defined, never called. editmesh has its own.
- **Status:** `[ ]`

### BUG-032: setStudioLight has no undo history
- **File:** `core/scene3d.js:332-337`
- Light changes bypass `hist.push`. Not undoable.
- **Status:** `[ ]`

### BUG-033: API registry missing select, setEnvironment, clearEnvironment
- **File:** `core/scene3d.js:970-997`
- These are on the return object but not registered as API commands.
- **Status:** `[ ]`

### BUG-034: Mobile CSS .em-zones selector is dead
- **File:** `ui/editmesh-ui.js:541`
- Uses class `.em-zones` but the element has id `em-zones-section`.
- **Status:** `[ ]`

### BUG-035: _texFilled flag prevents texture preset updates
- **File:** `ui/editmesh-ui.js:223, 246`
- Set once, never reset. If presets change, dropdown never rebuilds.
- **Status:** `[ ]`

### BUG-036: Panel tabs missing ARIA attributes
- **File:** `index.html:121-122`
- `role="tab"` buttons lack `aria-selected`, `aria-controls`, `tabindex`.
- **Status:** `[ ]`

### BUG-037: PWA manifest purpose field — deprecated format
- `"purpose": "any maskable"` should be split into two icon entries.
- Missing raster fallbacks (192×192, 512×512 PNG).
- **Status:** `[ ]`

### BUG-038: No CSP meta tag
- No `Content-Security-Policy` on either page. Google Fonts is the only
  external resource.
- **Status:** `[ ]`

### BUG-039: util.busy() is defined but never called
- **File:** `core/util.js:114-128`
- Dead code.
- **Status:** `[ ]`

### BUG-040: api.js undo/redo assumes scene3d.hist exists at registration
- **File:** `core/api.js:26-27`
- The lambda captures `GF.scene3d.hist` via late binding (works), but the
  `cmd()` call executes at parse time and would throw if `scene3d.js`
  loaded after `api.js`. Currently safe due to script order in index.html,
  but fragile — no defensive guard.
- **Status:** `[ ]`

### ~~BUG-041: publish.js error handler crashes if #load removed~~ — FALSE POSITIVE
- **Verification:** GLTFLoader fires exactly one callback (success OR error),
  never both. The `#load` element cannot be removed by the success handler
  before the error handler fires — they are mutually exclusive code paths.
- **Status:** `[~]` wontfix

### BUG-042: Mesh edit keys not registered via bind() — can't be remapped
- **File:** `ui/editmesh-ui.js:65-76`
- Commands registered with `hint` metadata but no `bind()`. The remap
  dialog can't remap G/R/S/E/I/M — they use a separate keydown handler.
- **Status:** `[ ]`

### BUG-043: setInterval(refresh, 2000) in hotbar never cleared
- **File:** `ui/hotbar.js:199`
- Runs forever. Short-circuits if context unchanged, but still polls.
- **Status:** `[ ]`

---

## Test Coverage Gaps

| Area | Coverage | Notes |
|------|----------|-------|
| Boot / shell | ✅ Good | e2e.js + userflow.js |
| 3D primitives (28 shapes) | ✅ Good | e2e.js |
| Transforms (9-DOF) | ✅ Good | e2e.js |
| Materials | ✅ Good | e2e.js |
| Undo/Redo | ✅ Good | e2e.js |
| Export (PNG + GLB) | ✅ Good | e2e.js |
| Model import | ✅ Good | e2e.js |
| Edit mode operators | ✅ Good | Full suite in e2e.js |
| Hotbar / palette | ✅ Good | userflow.js |
| **IndexedDB / assets** | ❌ None | Zero coverage |
| **Animation system** | ❌ None | play/pause/stop/export untested |
| **paint3d** | ❌ None | enter/exit/brush/undo untested |
| **Plugin system** | ❌ None | load/security untested |
| **texgen (15 generators)** | ❌ None | No coverage |
| **Service worker** | ❌ None | Offline behavior untested |
| **Keyboard remapping** | ❌ None | remap.js untested |
| **Multi-file GLTF import** | ❌ None | .gltf + .bin + textures path |

---

## Audit Metadata

- **Date:** 2026-08-07
- **Method:** Parallel sub-agent audit (5 domains), every file read in full
- **Verification:** All 43 findings re-verified against actual code in a second
  pass. 2 false positives identified and marked (BUG-029, BUG-041). 2 findings
  refined with narrower scope (BUG-004, BUG-007). **41 confirmed real issues.**
- **Auditors:** Nate (OneStone agent) — automated code analysis
- **Repo state:** `main` branch, commit `7996a0c`
- **Stored in:** OneStone project knowledge `proj_20260807124825_cacdd5`
