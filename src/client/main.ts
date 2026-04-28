import * as THREE from 'three'
import { createWorld, getActiveCharacter, step, getHeight } from '@sim/index'
import { TICK_RATE, TEAM_AI, AIM_PHASE_DURATION, TERRAIN_CELL_SIZE } from '@shared/constants'
import { AIController } from './aiController'
import type { WorldState, GameInput, GamePhase } from '@shared/types'
import type { SerializedWorld } from '@shared/net'
import { TerrainRenderer } from './render/terrainRenderer'
import { CharacterRenderer } from './render/characterRenderer'
import { ProjectileRenderer } from './render/projectileRenderer'
import { ExplosionRenderer } from './render/explosionRenderer'
import { WaterRenderer } from './render/waterRenderer'
import { SkyRenderer } from './render/skyRenderer'
import { AimRenderer } from './render/aimRenderer'
import { BlindboxRenderer } from './render/blindboxRenderer'
import { GameCamera } from './camera'
import { InputManager } from './input'
import { HUD } from './ui/hud'
import { TouchControls } from './ui/touchControls'
import { WeaponPicker } from './ui/weaponPicker'
import { audio } from './audio'
import { NetClient } from './net'
import { PostProcessing } from './render/postProcessing'
import { DustParticles } from './render/dustParticles'
import { EnvironmentRenderer } from './render/environmentRenderer'
import { CloudRenderer } from './render/cloudRenderer'
import { perfMonitor } from './perfMonitor'

type AppState = 'menu' | 'lobby' | 'countdown' | 'playing'

class Game {
  private renderer: THREE.WebGLRenderer
  private scene: THREE.Scene
  private gameCamera: GameCamera
  private world!: WorldState

  private terrainRenderer!: TerrainRenderer
  private characterRenderer!: CharacterRenderer
  private projectileRenderer!: ProjectileRenderer
  private explosionRenderer!: ExplosionRenderer
  private waterRenderer!: WaterRenderer
  private aimRenderer!: AimRenderer
  private blindboxRenderer!: BlindboxRenderer
  private input!: InputManager
  private hud!: HUD
  private touchControls: TouchControls | null = null

  private accumulator = 0
  private lastTime = 0
  private tickInterval = 1000 / TICK_RATE
  private terrainVersion = 0
  private gameTime = 0
  private aiController = new AIController()
  private lastAITeamActive = false
  private isMultiplayer = false
  private localTeam = 0
  private lastWeapon: string = 'bazooka'
  private lastTimerWarning = -1
  private prevAlive = new Set<number>()
  private pendingDamageLabels: { charId: number; amount: number; isEnemy: boolean }[] = []

  private weaponPicker: WeaponPicker | null = null

  private portalGroup: THREE.Group | null = null
  private portalHintEl: HTMLElement | null = null
  private readonly PORTAL_SIM_X = 15
  private readonly PORTAL_SIM_Z = 128

  private appState: AppState = 'menu'
  private net: NetClient | null = null
  private postProcessing!: PostProcessing
  private dustParticles!: DustParticles
  private environmentRenderer!: EnvironmentRenderer
  private cloudRenderer!: CloudRenderer
  private menuEl!: HTMLElement
  private matchStatusEl: HTMLElement | null = null
  private renderersInitialized = false
  private previewWorld: WorldState | null = null
  private matchmakingTimeout: ReturnType<typeof setTimeout> | null = null

  constructor() {
    this.scene = new THREE.Scene()

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    this.renderer.toneMappingExposure = 1.0
    this.renderer.shadowMap.enabled = true
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap
    document.getElementById('game')!.appendChild(this.renderer.domElement)

    this.gameCamera = new GameCamera(window.innerWidth / window.innerHeight)

    const hemi = new THREE.HemisphereLight(0x88bbdd, 0x446633, 0.6)
    this.scene.add(hemi)

    const sun = new THREE.DirectionalLight(0xffeedd, 1.6)
    sun.position.set(50, 80, 30)
    sun.castShadow = true
    sun.shadow.mapSize.width = 1024
    sun.shadow.mapSize.height = 1024
    sun.shadow.camera.near = 1
    sun.shadow.camera.far = 200
    sun.shadow.camera.left = -80
    sun.shadow.camera.right = 80
    sun.shadow.camera.top = 80
    sun.shadow.camera.bottom = -80
    sun.shadow.bias = -0.002
    this.scene.add(sun)

    const fill = new THREE.DirectionalLight(0xffaa66, 0.25)
    fill.position.set(-30, 10, -20)
    this.scene.add(fill)

    const rim = new THREE.DirectionalLight(0x88bbff, 0.2)
    rim.position.set(-20, 40, -60)
    this.scene.add(rim)

    this.scene.fog = new THREE.FogExp2(0x8ab4d8, 0.006)

    new SkyRenderer(this.scene)
    this.dustParticles = new DustParticles(this.scene)
    this.environmentRenderer = new EnvironmentRenderer(this.scene)
    this.cloudRenderer = new CloudRenderer(this.scene)

    this.postProcessing = new PostProcessing(
      this.renderer, this.scene, this.gameCamera.camera
    )
    perfMonitor.setRenderer(this.renderer)

    window.addEventListener('resize', this.onResize)

    // Init a preview world so the 3D scene renders behind the menu
    this.initPreview()

    this.lastTime = performance.now()
    this.loop()

    const params = new URLSearchParams(window.location.search)
    if (params.get('portal') === 'true') {
      this.isMultiplayer = false
      this.initGame(Date.now())
    } else {
      this.showMenu()
    }
  }

  private initPreview(): void {
    this.previewWorld = createWorld(Date.now())
    if (!this.renderersInitialized) {
      this.terrainRenderer = new TerrainRenderer(this.scene)
      this.characterRenderer = new CharacterRenderer(this.scene)
      this.projectileRenderer = new ProjectileRenderer(this.scene)
      this.explosionRenderer = new ExplosionRenderer(this.scene)
      this.waterRenderer = new WaterRenderer(this.scene)
      this.aimRenderer = new AimRenderer(this.scene)
      this.blindboxRenderer = new BlindboxRenderer(this.scene)
      this.renderersInitialized = true
    }
    this.terrainRenderer.update(this.previewWorld.heightmap, this.terrainVersion)
    this.environmentRenderer.update(this.previewWorld.heightmap, this.terrainVersion)
    this.waterRenderer.update(this.previewWorld.waterLevel, 0, this.gameCamera.camera)
    this.characterRenderer.update(this.previewWorld.characters, -1, this.previewWorld.heightmap, 0)
  }

  private showMenu(): void {
    this.appState = 'menu'
    this.menuEl?.remove()
    this.menuEl = document.createElement('div')
    this.menuEl.id = 'menu-screen'
    this.menuEl.innerHTML = `
      <div class="menu-container">
        <img src="/title-art.png" alt="Humans vs AI" class="menu-art" />
        <h1 class="menu-title">PIXELTRIKS</h1>
        <p class="menu-subtitle">HUMANS vs AI</p>
        <button id="btn-play" class="menu-btn primary">PLAY</button>
        <p class="menu-footer">WASD Move | Arrows Aim | Space Fire | Tab Weapon</p>
      </div>
    `
    document.body.appendChild(this.menuEl)

    document.getElementById('btn-play')!.onclick = () => {
      audio.start()
      this.hideMenu()
      this.startMatchmaking()
    }
  }

  private startMatchmaking(): void {
    this.appState = 'lobby'

    // Show subtle status in bottom corner
    this.matchStatusEl?.remove()
    this.matchStatusEl = document.createElement('div')
    this.matchStatusEl.style.cssText = [
      'position:fixed', 'bottom:12px', 'right:12px',
      'font-family:var(--font-ui)', 'font-size:11px', 'font-weight:600',
      'letter-spacing:2px', 'color:rgba(255,255,255,0.35)',
      'pointer-events:none', 'z-index:25',
    ].join(';')
    this.matchStatusEl.textContent = 'SEARCHING FOR OPPONENT...'
    document.body.appendChild(this.matchStatusEl)

    // Try to connect — if server is unavailable, start solo immediately
    this.isMultiplayer = true
    this.net = new NetClient(this.getWsUrl(), (event) => this.onNetEvent(event))
    this.net.connect()

    // Fallback: if no match in 12s, start solo
    this.matchmakingTimeout = setTimeout(() => {
      if (this.appState !== 'playing') {
        this.net?.disconnect()
        this.net = null
        this.isMultiplayer = false
        this.matchStatusEl?.remove()
        this.matchStatusEl = null
        this.initGame(Date.now())
      }
    }, 12000)
  }

  private hideMenu(): void {
    this.menuEl?.remove()
  }

  private getWsUrl(): string {
    if (import.meta.env.VITE_WS_URL) return import.meta.env.VITE_WS_URL as string
    const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProtocol}//${window.location.hostname}:8080`
  }

  private updateMatchStatus(text: string): void {
    if (this.matchStatusEl) this.matchStatusEl.textContent = text
  }

  private clearMatchmaking(): void {
    if (this.matchmakingTimeout) {
      clearTimeout(this.matchmakingTimeout)
      this.matchmakingTimeout = null
    }
    this.matchStatusEl?.remove()
    this.matchStatusEl = null
  }

  private startSoloFallback(): void {
    if (this.appState === 'playing') return
    this.net?.disconnect()
    this.net = null
    this.isMultiplayer = false
    this.clearMatchmaking()
    this.initGame(Date.now())
  }

  private onNetEvent(event: import('./net').NetEvent): void {
    switch (event.type) {
      case 'connected':
        this.net!.sendQuickplay()
        break

      case 'waiting':
        this.updateMatchStatus('SEARCHING FOR OPPONENT...')
        break

      case 'room_created':
        break

      case 'player_joined':
        this.updateMatchStatus('OPPONENT FOUND!')
        this.net!.sendReady()
        break

      case 'countdown':
        this.appState = 'countdown'
        this.updateMatchStatus(`STARTING IN ${event.seconds}...`)
        break

      case 'game_start':
        this.localTeam = event.yourTeam
        this.clearMatchmaking()
        this.initGame(event.seed)
        break

      case 'state':
        this.applyServerState(event.world)
        break

      case 'input_ack':
        break

      case 'opponent_disconnected':
        if (this.appState === 'playing' && this.isMultiplayer) {
          this.showDisconnectMessage()
        }
        break

      case 'error':
        this.startSoloFallback()
        break

      case 'disconnected':
        if (this.appState === 'playing' && this.isMultiplayer) {
          this.showDisconnectMessage()
        } else if (this.appState !== 'playing') {
          this.startSoloFallback()
        }
        break
    }
  }

  private showDisconnectMessage(): void {
    const overlay = document.createElement('div')
    overlay.className = 'game-over'
    overlay.innerHTML = `
      <h1 style="color:#f93">DISCONNECTED</h1>
      <p>Opponent left the game</p>
      <p style="margin-top:8px;color:#aaa">Press R to return to menu</p>
    `
    document.body.appendChild(overlay)
  }

  private applyServerState(state: SerializedWorld): void {
    if (!this.world) return

    const prevPhase = this.world.phase

    // Server is fully authoritative — overwrite all mutable world state.
    // tick, characters, projectiles all come from server truth.
    this.world.tick = state.tick
    this.world.phase = state.phase as GamePhase
    this.world.turn = state.turn
    this.world.activeTeam = state.activeTeam
    this.world.activeCharIndex = state.activeCharIndex
    this.world.phaseTimer = state.phaseTimer
    this.world.waterLevel = state.waterLevel
    this.world.prngState = state.prngState
    this.world.hash = state.hash

    for (let i = 0; i < state.characters.length; i++) {
      Object.assign(this.world.characters[i], state.characters[i])
    }
    this.world.projectiles = state.projectiles
    this.world.blindboxes = state.blindboxes

    // During aiming phase we skip local step(), so we handle turn-transition events
    // here that would normally come from step() events in tick().
    if (prevPhase === 'aiming' && state.phase !== 'aiming') {
      // Local player fired or turn timed out — weapon picker was confirmed
      this.input.resetWeaponConfirm()
      this.weaponPicker?.hide()
    }

    // Bump terrainVersion when a phase transition occurs — client will run step()
    // in the new phase to carve terrain from explosions. This forces the renderer
    // to re-read the heightmap.
    if (prevPhase !== state.phase) {
      this.terrainVersion++
    }
  }

  private initGame(seed: number): void {
    this.appState = 'playing'
    this.world = createWorld(seed)

    if (!this.renderersInitialized) {
      this.terrainRenderer = new TerrainRenderer(this.scene)
      this.characterRenderer = new CharacterRenderer(this.scene)
      this.projectileRenderer = new ProjectileRenderer(this.scene)
      this.explosionRenderer = new ExplosionRenderer(this.scene)
      this.waterRenderer = new WaterRenderer(this.scene)
      this.aimRenderer = new AimRenderer(this.scene)
      this.blindboxRenderer = new BlindboxRenderer(this.scene)
      this.renderersInitialized = true
    }

    this.input?.dispose()
    this.touchControls?.dispose()
    this.hud?.dispose()

    this.input = new InputManager()
    this.touchControls = new TouchControls(this.input)
    this.hud = new HUD()

    const startChar = getActiveCharacter(this.world)
    if (startChar) {
      const enemies = this.world.characters.filter(c => c.team !== this.localTeam && c.alive)
      if (enemies.length > 0) {
        const nearest = enemies.reduce((a, b) => {
          const da = (a.x - startChar.x) ** 2 + (a.z - startChar.z) ** 2
          const db = (b.x - startChar.x) ** 2 + (b.z - startChar.z) ** 2
          return da < db ? a : b
        })
        this.input.setAimAzimuth(Math.atan2(nearest.z - startChar.z, nearest.x - startChar.x))
      }
    }

    this.weaponPicker?.dispose()
    this.weaponPicker = new WeaponPicker()
    this.input.onWeaponPickRequired = () => {
      if (this.world?.phase === 'aiming' && this.world.activeTeam !== TEAM_AI) {
        this.weaponPicker!.show(this.input.getSelectedWeapon(), (weapon) => {
          this.input.confirmWeapon(weapon)
        })
      }
    }
    this.hud.onRestart = this.doRestart

    this.terrainRenderer.update(this.world.heightmap, this.terrainVersion)
    this.environmentRenderer.update(this.world.heightmap, this.terrainVersion)

    for (const c of this.world.characters) {
      if (c.alive) this.prevAlive.add(c.id)
    }

    this.aiController.reset()
    this.lastAITeamActive = false
    this.lastWeapon = 'bazooka'
    this.lastTimerWarning = -1

    this.createPortal()

    window.addEventListener('keydown', this.onRestartKey)
  }

  private createPortal(): void {
    if (this.portalGroup) {
      this.scene.remove(this.portalGroup)
      this.portalGroup = null
    }
    this.portalHintEl?.remove()
    this.portalHintEl = null

    const group = new THREE.Group()

    group.add(new THREE.Mesh(
      new THREE.TorusGeometry(3, 0.25, 8, 32),
      new THREE.MeshBasicMaterial({ color: 0x00ffaa })
    ))

    group.add(new THREE.Mesh(
      new THREE.CircleGeometry(2.75, 32),
      new THREE.MeshBasicMaterial({ color: 0x00ffaa, transparent: true, opacity: 0.2, side: THREE.DoubleSide })
    ))

    group.add(new THREE.PointLight(0x00ffaa, 4, 20))

    const groundH = getHeight(this.world.heightmap, this.PORTAL_SIM_X, this.PORTAL_SIM_Z)
    group.position.set(
      (this.PORTAL_SIM_X - 128) * TERRAIN_CELL_SIZE,
      groundH * TERRAIN_CELL_SIZE + 3,
      (this.PORTAL_SIM_Z - 128) * TERRAIN_CELL_SIZE
    )

    this.scene.add(group)
    this.portalGroup = group

    const hint = document.createElement('div')
    hint.style.cssText = [
      'position:fixed', 'bottom:56px', 'left:50%', 'transform:translateX(-50%)',
      'background:rgba(0,255,170,0.12)', 'border:1px solid rgba(0,255,170,0.5)',
      'color:#00ffaa', 'font-family:Segoe UI,system-ui,sans-serif', 'font-size:13px',
      'font-weight:700', 'letter-spacing:2px', 'padding:8px 20px',
      'border-radius:6px', 'pointer-events:none', 'z-index:30',
      'display:none', 'text-shadow:0 0 10px #00ffaa',
    ].join(';')
    hint.textContent = '✦ VIBE JAM PORTAL — walk in to travel'
    document.body.appendChild(hint)
    this.portalHintEl = hint
  }

  private doRestart = (): void => {
    if (!this.world || this.world.phase !== 'game_over') return
    window.removeEventListener('keydown', this.onRestartKey)
    this.hud?.reset()
    this.net?.disconnect()
    this.net = null
    if (this.portalGroup) {
      this.scene.remove(this.portalGroup)
      this.portalGroup = null
    }
    this.portalHintEl?.remove()
    this.portalHintEl = null
    this.weaponPicker?.dispose()
    this.weaponPicker = null
    this.clearMatchmaking()
    this.initPreview()
    this.showMenu()
  }

  private onRestartKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR') this.doRestart()
  }

  private onResize = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h)
    this.postProcessing.resize(w, h)
    this.gameCamera.resize(w / h)
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop)

    const now = performance.now()
    // Cap dt at 200ms — prevents spiral of death after tab switch or rendering spike.
    // Without this cap, a single slow frame (e.g. explosion render) queues 10+ sim ticks
    // and the game appears to fast-forward / shots explode instantly.
    const dt = Math.min(now - this.lastTime, 200)
    this.lastTime = now

    this.gameTime += dt / 1000

    if (this.appState !== 'playing') {
      this.renderPreview()
      return
    }
    this.accumulator += dt

    // Max 3 ticks per render frame (spiral-of-death guard).
    // The dt cap (200ms) already limits how much time can enter the accumulator.
    // Excess accumulator after the cap carries forward to the next frame — the sim
    // temporarily runs slower rather than faster, which is the correct tradeoff.
    let ticks = 0
    while (this.accumulator >= this.tickInterval && ticks < 3) {
      this.accumulator -= this.tickInterval
      this.tick()
      ticks++
    }

    this.render()
  }

  private tick(): void {
    if (this.world.phase === 'game_over') return

    let input: GameInput | null = null

    if (this.world.phase === 'aiming') {
      if (this.isMultiplayer) {
        // Server-authoritative during multiplayer aiming.
        // Read input only to send it — do NOT apply to local step().
        // Server broadcasts state every tick when movement is active (20Hz),
        // so character positions stay smooth without local prediction.
        if (this.world.activeTeam === this.localTeam) {
          const rawInput = this.input.getInput()
          if (rawInput) {
            this.net?.sendInput(rawInput, this.world.tick)
            // Trigger audio immediately — don't wait for server roundtrip
            if (rawInput.fire) audio.fire(rawInput.fire.weapon)
            if (rawInput.jump) audio.jump()
          }
        }
        // Skip step() — applyServerState drives world forward during aiming
        this.updateAudio()
        this.hud.update(this.world, this.input)
        this.checkPortal()
        return
      } else {
        const isAITurn = this.world.activeTeam === TEAM_AI

        if (isAITurn) {
          if (!this.lastAITeamActive) {
            this.aiController.startTurn()
            this.lastAITeamActive = true
          }
          input = this.aiController.tick(this.world)
        } else {
          this.lastAITeamActive = false
          input = this.input.getInput()
        }
      }
    }

    // Solo: always run step(). Multiplayer: run step() during firing/resolving/between_turns
    // (deterministic — no user input, so both client and server stay in sync).
    const events = step(this.world, input)

    if (input?.fire) audio.fire(input.fire.weapon)
    if (input?.jump) audio.jump()

    if (events.explosions.length > 0) {
      this.terrainVersion++
      for (const exp of events.explosions) {
        this.explosionRenderer.spawn(exp, this.world.heightmap)
        this.gameCamera.shake(exp.radius * 0.15)
        this.gameCamera.onImpact(exp.x, exp.y, exp.z, this.world.heightmap)
        audio.explosion(exp.radius)
        perfMonitor.log('explosion', { x: exp.x, z: exp.z, radius: exp.radius })
      }
    }

    for (const dmg of events.damageDealt) {
      if (dmg.source === 'water') {
        audio.waterSplash()
      } else if (dmg.source === 'heal') {
        audio.pickup()
      } else {
        audio.damage(dmg.amount)
      }
      const dmgChar = this.world.characters.find(c => c.id === dmg.charId)
      if (dmgChar) {
        const isEnemy = dmgChar.team !== this.localTeam
        // negative amount signals a heal — render as green "+X" label
        const labelAmount = dmg.source === 'heal' ? -dmg.amount : dmg.amount
        this.pendingDamageLabels.push({ charId: dmg.charId, amount: labelAmount, isEnemy })
      }
    }

    if (events.blindboxPicked && events.blindboxPicked !== 'healthPack') {
      // healthPack already plays via the heal DamageEvent above
      audio.pickup()
    }

    for (const c of this.world.characters) {
      if (!c.alive && this.prevAlive.has(c.id)) {
        audio.death()
        this.prevAlive.delete(c.id)
      }
    }

    if (events.turnAdvanced) {
      if (!this.isMultiplayer) {
        this.lastAITeamActive = false
        this.aiController.reset()
      }
      this.input.resetWeaponConfirm()
      this.weaponPicker?.hide()
      audio.turnChange()

      if (this.world.activeTeam === this.localTeam) {
        const activeChar = getActiveCharacter(this.world)
        if (activeChar) {
          const enemies = this.world.characters.filter(c => c.team !== this.localTeam && c.alive)
          if (enemies.length > 0) {
            const nearest = enemies.reduce((a, b) => {
              const da = (a.x - activeChar.x) ** 2 + (a.z - activeChar.z) ** 2
              const db = (b.x - activeChar.x) ** 2 + (b.z - activeChar.z) ** 2
              return da < db ? a : b
            })
            const az = Math.atan2(nearest.z - activeChar.z, nearest.x - activeChar.x)
            this.input.setAimAzimuth(az)
          }
        }
      }
    }

    if (events.gameOver) {
      const teamAlive = this.world.characters.filter(c => c.team === this.localTeam && c.alive).length
      audio.gameOver(teamAlive > 0)
      perfMonitor.log('game_over', { won: teamAlive > 0, turn: this.world.turn })
    }

    this.updateAudio()
    this.hud.update(this.world, this.input)
    this.checkPortal()
  }

  private updateAudio(): void {
    const currentWeapon = this.input.getSelectedWeapon()
    if (currentWeapon !== this.lastWeapon) {
      audio.weaponSwitch()
      this.lastWeapon = currentWeapon
    }

    if (this.world.phase === 'aiming') {
      const remaining = Math.ceil(
        (AIM_PHASE_DURATION - this.world.phaseTimer) / TICK_RATE
      )
      if (remaining <= 5 && remaining !== this.lastTimerWarning && remaining > 0) {
        audio.timerWarning()
        this.lastTimerWarning = remaining
      }
    } else {
      this.lastTimerWarning = -1
    }

    if (this.input.isCharging()) {
      audio.chargeLoop(this.input.getChargePower())
    }
  }

  private checkPortal(): void {
    if (!this.portalGroup) return
    const localChar = this.world.characters.find(c => c.team === this.localTeam && c.alive)
    if (!localChar) {
      if (this.portalHintEl) this.portalHintEl.style.display = 'none'
      return
    }
    const dx = localChar.x - this.PORTAL_SIM_X
    const dz = localChar.z - this.PORTAL_SIM_Z
    const dist = Math.sqrt(dx * dx + dz * dz)
    if (this.portalHintEl) {
      this.portalHintEl.style.display = dist < 20 ? 'block' : 'none'
    }
    if (dist < 5) {
      const ref = encodeURIComponent(window.location.hostname || 'pixeltriks.vibej.am')
      window.location.href = `https://vibej.am/portal/2026?ref=${ref}`
    }
  }

  private renderPreview(): void {
    if (!this.previewWorld) return
    const t = this.gameTime * 0.15
    const radius = 60
    const cx = Math.sin(t) * radius
    const cz = Math.cos(t) * radius
    this.gameCamera.camera.position.set(cx, 35, cz)
    this.gameCamera.camera.lookAt(0, 0, 0)
    this.waterRenderer.update(this.previewWorld.waterLevel, this.gameTime, this.gameCamera.camera)
    this.cloudRenderer.update(this.gameTime)
    this.dustParticles.update(this.gameTime, this.gameCamera.camera)
    this.postProcessing.render()
  }

  private render(): void {
    this.terrainRenderer.update(this.world.heightmap, this.terrainVersion)
    this.environmentRenderer.update(this.world.heightmap, this.terrainVersion)
    this.cloudRenderer.update(this.gameTime)

    const activeChar = getActiveCharacter(this.world)

    this.characterRenderer.update(this.world.characters, activeChar?.id ?? -1, this.world.heightmap, this.gameTime)
    this.projectileRenderer.update(this.world.projectiles, this.world.heightmap)
    this.explosionRenderer.update()
    this.blindboxRenderer.update(this.world.blindboxes, this.world.heightmap, this.gameTime)
    this.waterRenderer.update(this.world.waterLevel, this.gameTime, this.gameCamera.camera)
    this.dustParticles.update(this.gameTime, this.gameCamera.camera)

    const isAiming = this.world.phase === 'aiming'
    const isLocalAiming = isAiming && (
      !this.isMultiplayer ||
      this.world.activeTeam === this.localTeam
    ) && (this.isMultiplayer || this.world.activeTeam !== TEAM_AI)

    if (isLocalAiming && activeChar) {
      this.characterRenderer.setAzimuth(activeChar.id, this.input.getAimAzimuth())
      this.gameCamera.setAzimuth(this.input.getAimAzimuth())
    } else if (isAiming && activeChar && this.world.activeTeam === TEAM_AI) {
      const enemies = this.world.characters.filter(c => c.team !== TEAM_AI && c.alive)
      if (enemies.length > 0) {
        const nearest = enemies.reduce((a, b) => {
          const da = (a.x - activeChar.x) ** 2 + (a.z - activeChar.z) ** 2
          const db = (b.x - activeChar.x) ** 2 + (b.z - activeChar.z) ** 2
          return da < db ? a : b
        })
        const aiAz = Math.atan2(nearest.z - activeChar.z, nearest.x - activeChar.x)
        this.characterRenderer.setAzimuth(activeChar.id, aiAz)
        this.gameCamera.setAzimuth(aiAz)
      }
    }

    if (this.world.phase === 'firing' && this.world.projectiles.length > 0) {
      const proj = this.world.projectiles[0]
      this.gameCamera.followProjectile(proj.x, proj.y, proj.z, this.world.heightmap)
    } else if (isAiming && activeChar) {
      this.gameCamera.followTarget(activeChar.x, activeChar.y, activeChar.z, this.world.heightmap)
    }

    this.aimRenderer.update(
      activeChar,
      this.input.getAimAngle(),
      this.input.getAimAzimuth(),
      this.input.getChargePower(),
      this.input.isCharging(),
      isLocalAiming,
      this.input.getSelectedWeapon(),
      this.world.heightmap
    )

    if (this.portalGroup) {
      this.portalGroup.rotation.y = this.gameTime * 1.2
    }

    this.gameCamera.update()

    // Spawn damage labels using projected screen coords (after camera update)
    if (this.pendingDamageLabels.length > 0) {
      for (const label of this.pendingDamageLabels) {
        const char = this.world.characters.find(c => c.id === label.charId)
        if (char) {
          const groundH = getHeight(this.world.heightmap, char.x, char.z)
          const worldPos = new THREE.Vector3(
            (char.x - 128) * TERRAIN_CELL_SIZE,
            (2 * groundH - char.y) * TERRAIN_CELL_SIZE + 3,
            (char.z - 128) * TERRAIN_CELL_SIZE
          )
          worldPos.project(this.gameCamera.camera)
          const sx = (worldPos.x * 0.5 + 0.5) * window.innerWidth
          const sy = (-worldPos.y * 0.5 + 0.5) * window.innerHeight
          this.hud.spawnDamageLabel(sx, sy, label.amount, label.isEnemy)
        }
      }
      this.pendingDamageLabels = []
    }

    this.hud.tickFloats()

    this.postProcessing.render()
    perfMonitor.tick()
  }
}

new Game()
