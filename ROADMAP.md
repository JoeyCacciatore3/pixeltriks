# Pixeltriks: Humans vs AI — Vibe Jam 2026 Roadmap

**Deadline:** May 1, 2026 @ 13:37 UTC | **5 days remaining as of Apr 26**

---

## Current State

| System | Status | Notes |
|--------|--------|-------|
| Sim engine | ✅ Complete | 29 tests passing, deterministic, server-authoritative |
| Three.js renderer | ✅ Functional | terrain, chars, projectiles, explosions, water, sky, aim |
| Turn system | ✅ Working | 25s aim, between_turns, sudden death, game_over |
| Weapons (6) | ✅ Working | bazooka, grenade, shotgun, airstrike, teleport, dynamite |
| AI opponent | ✅ Working | 3 difficulty levels, trajectory search |
| WebSocket multiplayer | ✅ Working | room create/join, server-authoritative tick loop |
| Quickplay (auto-match) | ✅ Complete | queue → match → 15s fallback to AI |
| Portal/webring | ❌ Missing | Vibe Jam requirement |
| Production deploy | ⚠️ Partial | Render ✅, CF Pages manual step pending |
| Mobile testing | ⚠️ Untested | touch controls exist, not validated |
| Bundle size | ⚠️ Unknown | needs measurement |

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
- [ ] Cloudflare Pages project created, connected to repo (manual step — see infra section)
- [x] Render.com Web Service deployed → `wss://pixeltriks-server.onrender.com`
- [x] Vibe Jam widget already in index.html ✅

### Day 2 — Apr 27 — Gameplay Audit

- [ ] Test all 6 weapons: verify damage, radius, bounce/fuse behavior
- [ ] Airstrike: confirm 5-projectile spread works correctly
- [ ] Grenade: verify 3-bounce + 3s fuse (180 tick)
- [ ] Teleport: confirm character moves to landing spot correctly
- [ ] Dynamite: confirm drop-at-feet + 120-tick fuse
- [ ] Blindboxes (power-ups): test all 5 types drop/collect/effect
- [ ] Barrel/mine chain reactions: test
- [ ] Fall damage: verify threshold + multiplier
- [ ] Water death: confirm rising water kills in sudden death
- [ ] Multiplayer: full 2-player game via quickplay end-to-end
- [ ] HUD: timer, HP bars, weapon display all correct
- [ ] Win/loss screen renders properly

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
- [ ] Damage floaters (+number above character)
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
- [ ] Touch controls visible and functional on portrait + landscape
- [ ] All tc-btn sizes comfortable for thumb tap
- [ ] 30fps stable on iPhone (test with dev tools throttling)
- [ ] No overflow/scroll behavior on body
- [ ] Safe area insets respected (notch phones)

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
