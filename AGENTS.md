# AGENTS.md — PixelTriks operating rules

Rules for every agent (and human) working in this repo. This is a shared codebase
built by Joey (+ Nate, his agent) and Jake (+ Norm, his agent). These rules exist so
two agent/human pairs can work in parallel without stepping on each other or the
live site.

## The one rule that matters most

**`main` is production.** Cloudflare Pages deploys every push to `main` to
https://pixeltriks.com within ~15 seconds. There is no staging environment other
than branch previews.

Therefore: **never push directly to `main`.** Branch protection enforces this for
collaborators. All work lands via pull request.

## Workflow

1. Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, or `chore/<short-name>`.
2. Commit to your branch and push. Cloudflare Pages automatically builds a
   **preview URL** for every branch (`<branch>.pixeltriks.pages.dev`) — use it to
   verify visually before opening a PR.
3. Open a PR with:
   - What changed and why (one paragraph is fine).
   - The preview URL.
   - Confirmation that tests pass (see below).
4. Joey merges. Merge = deploy. Do not merge someone else's PR without their owner's OK.

## Before every PR

- Run the e2e tests in `tests/` and confirm they pass.
- Load `index.html` directly in a browser (the app runs from `file://` — no build
  step, no dev server). If it doesn't work from `file://`, it's broken.
- No console errors on load.

## Architecture constraints (do not violate)

- **Zero build step.** No bundlers, no transpilers, no `package.json`, no
  `node_modules`. Vanilla JS ES modules only. This is a load-bearing feature, not
  an accident — the app must keep running from `file://` and deploy as static files.
- **No new runtime dependencies** without explicit agreement from both owners.
  Vendored libraries go in `vendor/`.
- **Core engine lives in `core/`** — one module per concern. Extend via the
  existing registry patterns (e.g. the 2D→3D converter registry) rather than
  branching core modules with special cases.
- **AI features live in `ai/`** — keep provider calls isolated there.
- **`# AGENTS.md — PixelTriks operating rules

Rules for every agent (and human) working in this repo. This is a shared codebase
built by Joey (+ Nate, his agent) and Jake (+ Norm, his agent). These rules exist so
two agent/human pairs can work in parallel without stepping on each other or the
live site.

## The one rule that matters most

**`main` is production.** Cloudflare Pages deploys every push to `main` to
https://pixeltriks.com within ~15 seconds. There is no staging environment other
than branch previews.

Therefore: **never push directly to `main`.** Branch protection enforces this for
collaborators. All work lands via pull request.

## Workflow

1. Branch from `main`: `feat/<short-name>`, `fix/<short-name>`, or `chore/<short-name>`.
2. Commit to your branch and push. Cloudflare Pages automatically builds a
   **preview URL** for every branch (`<branch>.pixeltriks.pages.dev`) — use it to
   verify visually before opening a PR.
3. Open a PR with:
   - What changed and why (one paragraph is fine).
   - The preview URL.
   - Confirmation that tests pass (see below).
4. Joey merges. Merge = deploy. Do not merge someone else's PR without their owner's OK.

## Before every PR

- Run the e2e tests in `tests/` and confirm they pass.
- Load `index.html` directly in a browser (the app runs from `file://` — no build
  step, no dev server). If it doesn't work from `file://`, it's broken.
- No console errors on load.

 = querySelector (single element), `$` = querySelectorAll (NodeList).**
  Always use `$` when calling `.forEach()`. This has caused real production bugs.

## Game Deck UI architecture

The UI follows a "Game Deck" four-edge layout. Key modules:

| Module | Role |
|--------|------|
| `ui/forge-ui.js` | Main UI wiring, tool flyout (optbar extends from tool button) |
| `ui/hotbar.js` | Context-aware bottom bar — 7 auto-detected contexts |
| `ui/transform-pad.js` | 3×3 joystick grid (embedded at bottom of tool rail) |
| `ui/selection-bar.js` | Selection outcome utilities (Fill, Crop, Cut Out logic) |
| `ui/tool-guides.js` | In-app help per tool (? button in flyout) |

**Custom events** for module coordination:
- `pt:toolchange` — fired on tool switch (detail: `{ tool, prev }`)
- `pt:selectionchange` — fired on any selection change
- `pt:modechange` — fired on 2D↔3D mode switch (detail: `{ mode }`)
- `pt:docchange` — fired on document open/close

## Style

- Match the existing code style of the file you're editing.
- Prefer small, focused PRs (one concern each) over omnibus changes. Two agents
  merging omnibus PRs is how merge conflicts eat an afternoon.

## Coordination

- If you're starting something non-trivial, say so in the PR early (open it as a
  draft) so the other pair doesn't duplicate the work.
- Repo is **public** — no secrets, API keys, or tokens in the tree, ever.
  AI features requiring keys must take them at runtime from the user, never
  hardcoded.

## Owners

- Joey — repo owner, merge authority (agent: Nate, via OneStone)
- Jake — collaborator (agent: Norm)
