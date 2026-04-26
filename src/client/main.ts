import * as THREE from 'three'
import { createWorld, getActiveCharacter, step } from '@sim/index'
import { TICK_RATE, TEAM_AI, AIM_PHASE_DURATION } from '@shared/constants'
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
import { GameCamera } from './camera'
import { InputManager } from './input'
import { HUD } from './ui/hud'
import { TouchControls } from './ui/touchControls'
import { audio } from './audio'
import { NetClient } from './net'

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
  private input!: InputManager
  private hud!: HUD

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
  private lastChargePlaying = false
  private lastTimerWarning = -1
  private prevAlive = new Set<number>()

  private appState: AppState = 'menu'
  private net: NetClient | null = null
  private roomCode = ''
  private menuEl!: HTMLElement
  private renderersInitialized = false

  constructor() {
    this.scene = new THREE.Scene()

    this.renderer = new THREE.WebGLRenderer({ antialias: true })
    this.renderer.setSize(window.innerWidth, window.innerHeight)
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    this.renderer.shadowMap.enabled = false
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping
    document.getElementById('game')!.appendChild(this.renderer.domElement)

    this.gameCamera = new GameCamera(window.innerWidth / window.innerHeight)

    const ambient = new THREE.AmbientLight(0x6688aa, 0.6)
    this.scene.add(ambient)

    const sun = new THREE.DirectionalLight(0xffeedd, 1.2)
    sun.position.set(50, 80, 30)
    this.scene.add(sun)

    window.addEventListener('resize', this.onResize)

    this.showMenu()
    this.lastTime = performance.now()
    this.loop()
  }

  private showMenu(): void {
    this.appState = 'menu'
    this.menuEl = document.createElement('div')
    this.menuEl.id = 'menu-screen'
    this.menuEl.innerHTML = `
      <div class="menu-container">
        <h1 class="menu-title">PIXELTRIKS</h1>
        <p class="menu-subtitle">HUMANS vs AI</p>
        <div class="menu-buttons">
          <button id="btn-solo" class="menu-btn primary">SOLO vs AI</button>
          <button id="btn-create" class="menu-btn">CREATE ROOM</button>
          <div class="join-row">
            <input id="join-code" type="text" maxlength="4" placeholder="CODE" class="menu-input" />
            <button id="btn-join" class="menu-btn small">JOIN</button>
          </div>
        </div>
        <p class="menu-footer">A/D Move | W/S Aim | Space Fire | Tab Weapon</p>
      </div>
    `
    document.body.appendChild(this.menuEl)

    document.getElementById('btn-solo')!.onclick = () => this.startSolo()
    document.getElementById('btn-create')!.onclick = () => this.createRoom()
    document.getElementById('btn-join')!.onclick = () => {
      const code = (document.getElementById('join-code') as HTMLInputElement).value
      if (code.length === 4) this.joinRoom(code)
    }
    ;(document.getElementById('join-code') as HTMLInputElement).addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        const code = (e.target as HTMLInputElement).value
        if (code.length === 4) this.joinRoom(code)
      }
    })
  }

  private hideMenu(): void {
    this.menuEl?.remove()
  }

  private startSolo(): void {
    this.isMultiplayer = false
    this.hideMenu()
    this.initGame(Date.now())
  }

  private getWsUrl(): string {
    const loc = window.location
    const wsProtocol = loc.protocol === 'https:' ? 'wss:' : 'ws:'
    return `${wsProtocol}//${loc.hostname}:8080`
  }

  private createRoom(): void {
    this.isMultiplayer = true
    this.net = new NetClient(this.getWsUrl(), (event) => this.onNetEvent(event))
    this.net.connect()

    this.showLobby('Creating room...')
  }

  private joinRoom(code: string): void {
    this.isMultiplayer = true
    this.net = new NetClient(this.getWsUrl(), (event) => this.onNetEvent(event))
    this.net.connect()
    this.roomCode = code.toUpperCase()

    this.showLobby(`Joining ${this.roomCode}...`)
  }

  private showLobby(message: string): void {
    this.appState = 'lobby'
    this.hideMenu()

    this.menuEl = document.createElement('div')
    this.menuEl.id = 'menu-screen'
    this.menuEl.innerHTML = `
      <div class="menu-container">
        <h1 class="menu-title">PIXELTRIKS</h1>
        <p id="lobby-status" class="menu-subtitle">${message}</p>
        <p id="lobby-code" class="lobby-code"></p>
        <button id="btn-back" class="menu-btn small">BACK</button>
      </div>
    `
    document.body.appendChild(this.menuEl)

    document.getElementById('btn-back')!.onclick = () => {
      this.net?.disconnect()
      this.net = null
      this.hideMenu()
      this.showMenu()
    }
  }

  private updateLobby(text: string): void {
    const el = document.getElementById('lobby-status')
    if (el) el.textContent = text
  }

  private showLobbyCode(code: string): void {
    const el = document.getElementById('lobby-code')
    if (el) el.textContent = code
  }

  private onNetEvent(event: import('./net').NetEvent): void {
    switch (event.type) {
      case 'connected':
        if (this.roomCode) {
          this.net!.joinRoom(this.roomCode)
        } else {
          this.net!.createRoom()
        }
        break

      case 'room_created':
        this.roomCode = event.roomCode
        this.localTeam = event.team
        this.showLobbyCode(event.roomCode)
        this.updateLobby('Waiting for opponent...')
        this.net!.sendReady()
        break

      case 'player_joined':
        this.updateLobby('Opponent joined! Starting...')
        this.net!.sendReady()
        break

      case 'countdown':
        this.appState = 'countdown'
        this.updateLobby(`Starting in ${event.seconds}...`)
        break

      case 'game_start':
        this.localTeam = event.yourTeam
        this.hideMenu()
        this.initGame(event.seed)
        break

      case 'state':
        this.applyServerState(event.world)
        break

      case 'opponent_input':
        break

      case 'opponent_disconnected':
        if (this.appState === 'playing') {
          this.showDisconnectMessage()
        } else {
          this.updateLobby('Opponent disconnected')
        }
        break

      case 'error':
        this.updateLobby(event.message)
        break

      case 'disconnected':
        if (this.appState === 'playing') {
          this.showDisconnectMessage()
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

    this.terrainVersion++
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
      new SkyRenderer(this.scene)
      this.aimRenderer = new AimRenderer(this.scene)
      this.renderersInitialized = true
    }

    this.input = new InputManager()
    new TouchControls(this.input)
    this.hud = new HUD()
    this.hud.onRestart = this.doRestart

    this.terrainRenderer.update(this.world.heightmap, this.terrainVersion)

    for (const c of this.world.characters) {
      if (c.alive) this.prevAlive.add(c.id)
    }

    this.aiController.reset()
    this.lastAITeamActive = false
    this.lastWeapon = 'bazooka'
    this.lastChargePlaying = false
    this.lastTimerWarning = -1

    window.addEventListener('keydown', this.onRestartKey)
  }

  private doRestart = (): void => {
    if (!this.world || this.world.phase !== 'game_over') return
    window.removeEventListener('keydown', this.onRestartKey)
    this.hud?.reset()
    this.net?.disconnect()
    this.net = null
    this.showMenu()
  }

  private onRestartKey = (e: KeyboardEvent): void => {
    if (e.code === 'KeyR') this.doRestart()
  }

  private onResize = (): void => {
    const w = window.innerWidth
    const h = window.innerHeight
    this.renderer.setSize(w, h)
    this.gameCamera.resize(w / h)
  }

  private loop = (): void => {
    requestAnimationFrame(this.loop)

    const now = performance.now()
    const dt = now - this.lastTime
    this.lastTime = now

    if (this.appState !== 'playing') return

    this.gameTime += dt / 1000
    this.accumulator += dt

    while (this.accumulator >= this.tickInterval) {
      this.accumulator -= this.tickInterval
      this.tick()
    }

    this.render()
  }

  private tick(): void {
    if (this.world.phase === 'game_over') return

    let input: GameInput | null = null

    if (this.world.phase === 'aiming') {
      if (this.isMultiplayer) {
        const isLocalTurn = this.world.activeTeam === this.localTeam
        if (isLocalTurn) {
          input = this.input.getInput()
          if (input && (input.fire || input.moveDirection || input.jump || input.endTurn)) {
            this.net?.sendInput(input, this.world.tick)
          }
        }
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

    if (!this.isMultiplayer) {
      const events = step(this.world, input)

      if (input?.fire) {
        audio.fire(input.fire.weapon)
      }
      if (input?.jump) {
        audio.jump()
      }

      if (events.explosions.length > 0) {
        this.terrainVersion++
        for (const exp of events.explosions) {
          this.explosionRenderer.spawn(exp)
          this.gameCamera.shake(exp.radius * 0.15)
          this.gameCamera.onImpact(exp.x, exp.y, exp.z)
          audio.explosion(exp.radius)
        }
      }

      for (const dmg of events.damageDealt) {
        if (dmg.source === 'water') {
          audio.waterSplash()
        } else {
          audio.damage(dmg.amount)
        }
      }

      for (const c of this.world.characters) {
        if (!c.alive && this.prevAlive.has(c.id)) {
          audio.death()
          this.prevAlive.delete(c.id)
        }
      }

      if (events.turnAdvanced) {
        this.lastAITeamActive = false
        this.aiController.reset()
        audio.turnChange()
      }

      if (events.gameOver) {
        const humansAlive = this.world.characters.filter(c => c.team === 0 && c.alive).length
        audio.gameOver(humansAlive > 0)
      }
    } else {
      if (input?.fire) {
        audio.fire(input.fire.weapon)
      }
      if (input?.jump) {
        audio.jump()
      }
    }

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
      if (!this.lastChargePlaying) {
        this.lastChargePlaying = true
      }
      audio.chargeLoop(this.input.getChargePower())
    } else {
      this.lastChargePlaying = false
    }

    this.hud.update(this.world, this.input)
  }

  private render(): void {
    this.terrainRenderer.update(this.world.heightmap, this.terrainVersion)
    this.characterRenderer.update(this.world.characters)
    this.projectileRenderer.update(this.world.projectiles)
    this.explosionRenderer.update()
    this.waterRenderer.update(this.world.waterLevel, this.gameTime)

    const activeChar = getActiveCharacter(this.world)

    if (this.world.phase === 'firing' && this.world.projectiles.length > 0) {
      const proj = this.world.projectiles[0]
      this.gameCamera.followProjectile(proj.x, proj.y, proj.z)
    } else if (this.world.phase === 'resolving') {
      this.gameCamera.returnToCharacter()
      if (activeChar) {
        this.gameCamera.followTarget(activeChar.x, activeChar.y, activeChar.z)
      }
    } else if (activeChar) {
      this.gameCamera.followTarget(activeChar.x, activeChar.y, activeChar.z)
    }

    const isAiming = this.world.phase === 'aiming'
    const isLocalAiming = isAiming && (
      !this.isMultiplayer ||
      this.world.activeTeam === this.localTeam
    ) && (this.isMultiplayer || this.world.activeTeam !== TEAM_AI)

    this.aimRenderer.update(
      activeChar,
      this.input.getAimAngle(),
      this.input.getChargePower(),
      this.input.isCharging(),
      isLocalAiming,
      this.input.getSelectedWeapon()
    )

    this.gameCamera.update()
    this.renderer.render(this.scene, this.gameCamera.camera)
  }
}

new Game()
