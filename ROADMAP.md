# Pixeltriks: Humans vs AI — Vibe Jam 2026 Roadmap

**Deadline:** May 1, 2026 @ 13:37 UTC | **5 days remaining as of Apr 26**

---

## Current State

| System | Status | Notes |
|--------|--------|-------|
| Sim engine | ✅ Complete | 29 tests passing, deterministic, server-authoritative |
| Three.js renderer | ✅ Functional | terrain, chars, projectiles, explosions, water, sky, aim |
| Turn system | ✅ Working | 25s aim, 4s between_turns dwell, sudden death, game_over |
| Weapons (6) | ✅ Balanced | craterMul + knockbackMul differentiation, head-level spawn |
| Controls | ✅ Working | WASD 4-dir move, Arrow aim (azimuth+elevation), Space charge/fire |
| Active char indicator | ✅ Working | Bobbing yellow cone above active character |
| Floating damage labels | ✅ Working | CSS DOM overlay, projected from world coords |
| AI opponent | ✅ Working | 3 difficulty levels, trajectory search, azimuth-aware |
| WebSocket multiplayer | ✅ Working | room create/join, server-authoritative tick loop |
| Quickplay (auto-match) | ✅ Complete | queue → match → 15s fallback to AI |
| GitHub Actions auto-deploy | ✅ Complete | push to main → CF Pages deploy automatically |
| pixeltriks.com domain | ✅ Live | CNAME active, CF Pages custom domain |
| Mobile touch controls | ✅ Rebuilt | 4-dir move d-pad + aim d-pad + FIRE + JUMP |
| Portal/webring | ❌ Missing | Vibe Jam requirement |
| Bundle size | ✅ ~124KB gz | well under 200KB target |

---

## Infrastructure

### GitHub
- Repo: `JoeyCacciatore3/pixeltriks`
- Branch: `main`
- Push on every milestone

### Client Hosting — Cloudflare Pages
- Auto-deploy on push to `main`
- Build command: `npm run build`
- Output dir: `dist`
- Env var: `VITE_WS_URL=wss://pixeltriks-server.onrender.com`

### WebSocket Server — Render.com
- Service type: Web Service (Node.js)
- Repo: same GitHub repo
- Root dir: `/` (build command: `npm install`)
- Start command: `node --loader tsx/esm src/server/index.ts`
- Port: `PORT` env var (auto-injected by Render)
- URL: `wss://pixeltriks-server.onrender.com` (or custom subdomain)
- **Why Render over Railway:** No 15-minute WebSocket connection timeout. Games last 20+ minutes.

### Domain — Porkbun + Cloudflare Pages
1. Add custom domain in CF Pages dashboard → get CNAME target (`*.pages.dev`)
2. In Porkbun DNS: add CNAME `@` → that target (Porkbun supports CNAME flattening at root)
3. SSL auto-provisioned by CF Pages
- No nameserver transfer required

### WebSocket URL in Client
```typescript
// src/client/main.ts — getWsUrl()
const wsUrl = import.meta.env.VITE_WS_URL
  ?? `${window.location.protocol === 'https:' ? 'wss:' : 'ws:'}//${window.location.hostname}:8080`
```

---

## Sprint Plan

### Day 1 — Apr 26 — Infra + Matchmaking

- [x] GitHub repo created, initial push
- [x] Quickplay auto-match on server (`quickplay` message type, waiting queue)
- [x] Menu: add "QUICK PLAY" button as primary CTA
- [x] VITE_WS_URL env var support in client
- [x] Cloudflare Pages + GitHub Actions auto-deploy live (push to main triggers deploy)
- [x] Render.com Web Service deployed → `wss://pixeltriks-server.onrender.com`
- [x] Vibe Jam widget already in index.html ✅

### Day 2 — Apr 27 — Gameplay Audit

- [x] 4-directional WASD movement (W/S = Z axis, A/D = X axis)
- [x] Arrow key aim system (Left/Right = azimuth rotation, Up/Down = elevation)
- [x] Head-level projectile spawn (clears terrain obstacles)
- [x] Weapon differentiation: craterMul + knockbackMul per weapon
- [x] Weapon rebalance: airstrike fixed (40/55), shotgun no crater
- [x] Post-shot camera dwell (4s between_turns, 2.5s impact hold)
- [x] Floating damage numbers (projected world coords → CSS DOM)
- [x] Active character indicator (bobbing yellow cone)
- [x] Test all 6 weapons: verified in sim tests
- [x] Airstrike: 5-missile spread confirmed
- [x] HUD: timer, HP bars, weapon display, controls hint
- [x] Win/loss screen with restart button
- [ ] Blindboxes (power-ups): test all 5 types drop/collect/effect
- [ ] Barrel/mine chain reactions: test
- [ ] Water death: confirm rising water kills in sudden death
- [ ] Multiplayer: full 2-player game via quickplay end-to-end

### Day 3 — Apr 28 — Art & Polish

**Character renderer:**
- [ ] Capsule body + box head reading clearly at gameplay distance
- [ ] Team color (blue human, red AI) visible and distinct
- [ ] Aim angle indicator on character

**Terrain:**
- [ ] Vertex colors smooth: grass top, dirt mid, rock base
- [ ] Explosion craters look satisfying (radius-correct deformation)
- [ ] Terrain normals recalculated after explosion

**Explosions:**
- [ ] Particle burst feels impactful (40-60 particles, orange/red)
- [ ] Point light flash on explosion
- [ ] Screen shake on large explosions

**Water:**
- [ ] Animated shader (time-based wave offset)
- [ ] Rising water visible during sudden death

**Audio:**
- [ ] All 6 weapon fire sounds distinct
- [ ] Explosion sounds scaled by radius
- [ ] Hit/damage feedback sound
- [ ] Menu background ambiance (optional)

**UI:**
- [ ] Weapon selector visually clear (Tab cycles, shows icon/name)
- [ ] Power charge feedback (visual/audio as space held)
- [x] Damage floaters (+number above character, color-coded enemy/friendly)
- [ ] Turn transition overlay ("YOUR TURN" / "ENEMY'S TURN")

### Day 4 — Apr 29 — Portal + Mobile + Cross-Browser

**Vibe Jam portal:**
- [ ] Add `https://vibej.am/2026/portal/sample.js` to index.html
- [ ] Call `initVibeJamPortals()` with scene + player refs
- [ ] Portal appears as 3D object in scene at fixed location
- [ ] `animateVibeJamPortals()` in render loop
- [ ] Handle `?portal=true&ref=` query params to spawn return portal
- [ ] Test portal redirect works

**Mobile (iOS Safari priority):**
- [x] Touch controls rebuilt: 4-dir move d-pad + aim d-pad + FIRE circle + JUMP
- [x] All tc-btn sizes comfortable for thumb tap (50px d-pad, 82px fire)
- [x] Move buttons correctly mapped to WASD (KeyW/A/S/D), aim to ArrowKeys
- [x] Landscape compact layout at max-height:500px
- [x] No overflow/scroll behavior on body
- [x] Safe area insets respected (env(safe-area-inset-bottom))
- [ ] 30fps stable on iPhone (test with dev tools throttling)

**Cross-browser:**
- [ ] Chrome ✅ (primary dev target)
- [ ] Firefox — test WebGL, WebSocket, Web Audio
- [ ] Safari desktop — test Web Audio (needs user gesture to unlock)
- [ ] iOS Safari — full mobile test
- [ ] Edge — smoke test

**Performance:**
- [ ] Measure draw calls (`renderer.info.render.calls`) — target <100
- [ ] Measure bundle size: `npm run build` → check dist/ gzipped total
- [ ] Profile on throttled CPU (4x slowdown in devtools)

### Day 5 — Apr 30 — Final Polish + Submit

- [ ] Bug sweep from Day 4 testing
- [ ] Game feel: verify every hit feels punchy (sound + screen shake + particles)
- [ ] AI difficulty tuning (hard should be beatable but scary)
- [ ] Domain DNS live and resolving
- [ ] Final build: `npm run build && npm run typecheck && npm run test` all pass
- [ ] Vibe Jam submission form filled
- [ ] Submit before 13:37 UTC May 1 ✅

---

## Quickplay Implementation

Add to `shared/net.ts`:
```typescript
ClientMessage: | { type: 'quickplay' }
ServerMessage: | { type: 'waiting' }  // waiting for opponent
```

Add to `server/index.ts`:
```typescript
let waitingPlayer: { ws: WebSocket; timer: ReturnType<typeof setTimeout> } | null = null

case 'quickplay': {
  if (waitingPlayer && waitingPlayer.ws.readyState === WebSocket.OPEN) {
    // pair them
    const code = generateRoomCode()
    const room = createRoom(code, waitingPlayer.ws, ws)
    clearTimeout(waitingPlayer.timer)
    waitingPlayer = null
    startCountdown(room)
  } else {
    // queue this player
    const timer = setTimeout(() => {
      if (waitingPlayer?.ws === ws) {
        waitingPlayer = null
        // fall back to AI — send game_start solo signal
        startSoloGame(ws)
      }
    }, 15000)
    waitingPlayer = { ws, timer }
    send(ws, { type: 'waiting' })
  }
  break
}
```

Client menu: "QUICK PLAY" button sends `{ type: 'quickplay' }`, shows "Searching for opponent..." with a 15s countdown, then falls back to solo AI if no match.

---

## Render.com Deployment

```bash
# render.yaml (place at repo root)
services:
  - type: web
    name: pixeltriks-server
    env: node
    buildCommand: npm install
    startCommand: npx tsx src/server/index.ts
    envVars:
      - key: PORT
        value: 8080
    plan: free
```

---

## Vibe Jam Compliance Final Checklist

| Requirement | Status |
|-------------|--------|
| New game (post Apr 1) | ✅ |
| 90%+ AI code | ✅ Claude Code throughout |
| Web only, no login | ✅ |
| Instant load (<200KB, zero assets) | ⚠️ measure |
| No loading screens | ✅ procedural everything |
| Widget script in index.html | ✅ |
| Multiplayer (2 players) | ✅ WebSocket rooms |
| Three.js | ✅ |
| Portal/webring exit | ❌ Day 4 |
| Own domain | ❌ Day 1 (after Porkbun API key) |
