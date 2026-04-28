import type { WorldState, Character } from '@shared/types'
import { TEAM_HUMAN, TEAM_AI, AIM_PHASE_DURATION, TICK_RATE } from '@shared/constants'
import type { InputManager } from '../input'
import { getWeaponSpriteStyle } from './weaponPicker'

interface FloatLabel {
  el: HTMLElement
  life: number
  x: number
  y: number
}

export class HUD {
  private humanPanel: HTMLElement
  private aiPanel: HTMLElement
  private humanHpFill: HTMLElement
  private humanHpGhost: HTMLElement
  private humanHpLabel: HTMLElement
  private humanDots: HTMLElement
  private aiHpFill: HTMLElement
  private aiHpGhost: HTMLElement
  private aiHpLabel: HTMLElement
  private aiDots: HTMLElement

  private timerPanel: HTMLElement
  private timerEl: HTMLElement
  private phaseLabel: HTMLElement
  private turnLabel: HTMLElement
  private weaponDisplay: HTMLElement
  private powerBarWrap: HTMLElement
  private powerBarFill: HTMLElement
  private turnBanner: HTMLElement
  private gameOverOverlay: HTMLElement
  private controlsHint: HTMLElement

  private gameOverShown = false
  private floatLabels: FloatLabel[] = []
  private lastTurn = -1
  private lastTeam = -1
  onRestart: (() => void) | null = null

  constructor() {
    // ── Human team panel (top-left) ──
    this.humanPanel = document.createElement('div')
    this.humanPanel.className = 'team-panel team-panel-human'
    this.humanPanel.innerHTML = `
      <div class="team-name team-name-human">HUMANS</div>
      <div class="team-hp-track">
        <div class="team-hp-ghost"></div>
        <div class="team-hp-fill"></div>
        <div class="team-hp-label"></div>
      </div>
      <div class="team-dots"></div>
    `
    document.body.appendChild(this.humanPanel)
    this.humanHpFill  = this.humanPanel.querySelector('.team-hp-fill')!
    this.humanHpGhost = this.humanPanel.querySelector('.team-hp-ghost')!
    this.humanHpLabel = this.humanPanel.querySelector('.team-hp-label')!
    this.humanDots    = this.humanPanel.querySelector('.team-dots')!

    // ── AI team panel (top-right) ──
    this.aiPanel = document.createElement('div')
    this.aiPanel.className = 'team-panel team-panel-ai'
    this.aiPanel.innerHTML = `
      <div class="team-name team-name-ai">AI BOTS</div>
      <div class="team-hp-track">
        <div class="team-hp-ghost"></div>
        <div class="team-hp-fill"></div>
        <div class="team-hp-label"></div>
      </div>
      <div class="team-dots"></div>
    `
    document.body.appendChild(this.aiPanel)
    this.aiHpFill  = this.aiPanel.querySelector('.team-hp-fill')!
    this.aiHpGhost = this.aiPanel.querySelector('.team-hp-ghost')!
    this.aiHpLabel = this.aiPanel.querySelector('.team-hp-label')!
    this.aiDots    = this.aiPanel.querySelector('.team-dots')!

    // ── Center timer panel (inside #hud) ──
    const hud = document.getElementById('hud')!
    this.timerPanel = document.createElement('div')
    const timerPanel = this.timerPanel
    timerPanel.className = 'timer-panel'
    timerPanel.innerHTML = `
      <div class="hud-phase-label"></div>
      <div class="hud-timer">25</div>
      <div class="hud-turn-label">TURN 1</div>
    `
    hud.appendChild(timerPanel)
    this.phaseLabel = timerPanel.querySelector('.hud-phase-label')!
    this.timerEl    = timerPanel.querySelector('.hud-timer')!
    this.turnLabel  = timerPanel.querySelector('.hud-turn-label')!

    // ── Weapon display (fixed, centered below timer) ──
    this.weaponDisplay = document.createElement('div')
    this.weaponDisplay.className = 'hud-weapon'
    document.body.appendChild(this.weaponDisplay)

    // ── Power bar ──
    this.powerBarWrap = document.createElement('div')
    this.powerBarWrap.className = 'hud-power-wrap'
    this.powerBarWrap.style.display = 'none'
    document.body.appendChild(this.powerBarWrap)

    this.powerBarFill = document.createElement('div')
    this.powerBarFill.className = 'hud-power-fill'
    this.powerBarWrap.appendChild(this.powerBarFill)

    // ── Turn announcement banner ──
    this.turnBanner = document.createElement('div')
    this.turnBanner.className = 'turn-banner'
    this.turnBanner.style.display = 'none'
    document.body.appendChild(this.turnBanner)

    // ── Game over overlay ──
    this.gameOverOverlay = document.createElement('div')
    this.gameOverOverlay.className = 'game-over'
    this.gameOverOverlay.style.display = 'none'
    document.body.appendChild(this.gameOverOverlay)

    // ── Controls hint ──
    this.controlsHint = document.createElement('div')
    this.controlsHint.className = 'hud-controls'
    this.controlsHint.innerHTML = 'WASD Move &nbsp;|&nbsp; Arrows Aim &nbsp;|&nbsp; Space Fire &nbsp;|&nbsp; Tab Weapon &nbsp;|&nbsp; J Jump &nbsp;|&nbsp; Enter End Turn'
    document.body.appendChild(this.controlsHint)
  }

  showTurnBanner(teamName: string, isHuman: boolean): void {
    this.turnBanner.textContent = isHuman ? 'YOUR TURN' : `${teamName}`
    this.turnBanner.style.color = isHuman ? '#3a8fff' : '#ff4a3a'
    this.turnBanner.style.display = 'flex'
    this.turnBanner.classList.remove('turn-banner-anim')
    void this.turnBanner.offsetWidth
    this.turnBanner.classList.add('turn-banner-anim')
    setTimeout(() => { this.turnBanner.style.display = 'none' }, 1800)
  }

  spawnDamageLabel(screenX: number, screenY: number, amount: number, isEnemy: boolean): void {
    const el = document.createElement('div')
    el.className = 'damage-float'
    const isHeal = amount < 0
    el.textContent = isHeal ? `+${Math.abs(amount)}` : `-${amount}`
    el.style.left = `${screenX}px`
    el.style.top = `${screenY}px`
    el.style.color = isHeal ? '#44ff88' : (isEnemy ? '#ff4444' : '#ffaa00')
    el.style.transform = 'translateX(-50%) scale(1.5)'
    el.style.transition = 'transform 0.12s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
    document.body.appendChild(el)
    requestAnimationFrame(() => {
      el.style.transform = 'translateX(-50%) scale(1.0)'
    })
    this.floatLabels.push({ el, life: 0, x: screenX, y: screenY })
  }

  tickFloats(): void {
    for (let i = this.floatLabels.length - 1; i >= 0; i--) {
      const f = this.floatLabels[i]
      f.life++
      f.y -= 1.2
      const opacity = Math.max(0, 1 - f.life / 60)
      f.el.style.top = `${f.y}px`
      f.el.style.opacity = String(opacity)
      if (f.life >= 60) {
        f.el.remove()
        this.floatLabels.splice(i, 1)
      }
    }
  }

  update(world: WorldState, input: InputManager): void {
    const isHumanTurn = world.activeTeam === TEAM_HUMAN

    // ── Timer ──
    if (world.phase === 'aiming') {
      const remaining = Math.ceil((AIM_PHASE_DURATION - world.phaseTimer) / TICK_RATE)
      this.timerEl.textContent = String(remaining)
      this.phaseLabel.textContent = isHumanTurn ? 'YOUR TURN' : 'AI TURN'
      if (remaining <= 5) {
        this.timerEl.classList.add('timer-danger')
      } else {
        this.timerEl.classList.remove('timer-danger')
      }
    } else {
      this.timerEl.textContent = world.phase === 'game_over' ? '' : '·'
      this.phaseLabel.textContent = world.phase.replace('_', ' ').toUpperCase()
      this.timerEl.classList.remove('timer-danger')
    }
    this.turnLabel.textContent = `TURN ${world.turn + 1}`

    // ── Team panels ──
    const humans = world.characters.filter(c => c.team === TEAM_HUMAN)
    const ais    = world.characters.filter(c => c.team === TEAM_AI)
    const humanHP = humans.reduce((s, c) => s + (c.alive ? c.hp : 0), 0)
    const aiHP    = ais.reduce((s, c) => s + (c.alive ? c.hp : 0), 0)

    this.updateTeamPanel(
      this.humanPanel, this.humanHpFill, this.humanHpGhost, this.humanHpLabel, this.humanDots,
      humans, humanHP, '#3a8fff', isHumanTurn
    )
    this.updateTeamPanel(
      this.aiPanel, this.aiHpFill, this.aiHpGhost, this.aiHpLabel, this.aiDots,
      ais, aiHP, '#ff4a3a', !isHumanTurn
    )

    // ── Weapon ──
    const wpn = input.getSelectedWeapon()
    this.weaponDisplay.innerHTML = `<div class="hud-weapon-icon" style="${getWeaponSpriteStyle(wpn)}"></div><span style="letter-spacing:2px">${wpn.toUpperCase()}</span>`

    // ── Power bar ──
    const isCharging = input.isCharging()
    if (isCharging) {
      const pct = input.getChargePower()
      this.powerBarWrap.style.display = 'block'
      this.powerBarFill.style.width = `${pct}%`
      const r = Math.round(pct < 50 ? (pct / 50) * 255 : 255)
      const g = Math.round(pct < 50 ? 220 : Math.max(0, (1 - (pct - 50) / 50) * 220))
      this.powerBarFill.style.background = `rgb(${r},${g},0)`
      this.powerBarFill.style.boxShadow = pct >= 98
        ? `0 0 10px rgb(${r},${g},0), 0 0 20px rgba(${r},${g},0,0.35)`
        : 'none'
    } else {
      this.powerBarWrap.style.display = 'none'
    }

    // ── Turn announcement ──
    if (world.turn !== this.lastTurn || world.activeTeam !== this.lastTeam) {
      this.lastTurn = world.turn
      this.lastTeam = world.activeTeam
      if (world.phase === 'aiming') {
        this.showTurnBanner(isHumanTurn ? 'HUMANS' : 'AI BOTS', isHumanTurn)
      }
    }

    // ── Game over ──
    if (world.phase === 'game_over' && !this.gameOverShown) {
      this.gameOverShown = true
      const humansAlive = world.characters.filter(c => c.team === TEAM_HUMAN && c.alive).length
      const aiAlive = world.characters.filter(c => c.team === TEAM_AI && c.alive).length
      const humanHP = world.characters.filter(c => c.team === TEAM_HUMAN).reduce((s, c) => s + Math.max(0, c.hp), 0)
      const aiHP = world.characters.filter(c => c.team === TEAM_AI).reduce((s, c) => s + Math.max(0, c.hp), 0)
      const winner    = humansAlive > 0 ? 'HUMANS WIN' : 'AI WINS'
      const winColor  = humansAlive > 0 ? '#3a8fff' : '#ff4a3a'
      this.gameOverOverlay.style.display = 'flex'
      this.gameOverOverlay.innerHTML = `
        <h1 style="color:${winColor}">${winner}</h1>
        <div class="game-over-stats">
          <div class="go-stat"><span class="go-label">Turns</span><span class="go-value">${world.turn}</span></div>
          <div class="go-stat"><span class="go-label" style="color:#3a8fff">Humans</span><span class="go-value">${humansAlive}/3 alive · ${humanHP} HP</span></div>
          <div class="go-stat"><span class="go-label" style="color:#ff4a3a">AI Bots</span><span class="go-value">${aiAlive}/3 alive · ${aiHP} HP</span></div>
        </div>
        <button class="restart-btn">PLAY AGAIN</button>
      `
      const btn = this.gameOverOverlay.querySelector('.restart-btn')
      if (btn) {
        btn.addEventListener('click', () => { if (this.onRestart) this.onRestart() })
        btn.addEventListener('touchend', (e) => {
          e.preventDefault()
          if (this.onRestart) this.onRestart()
        })
      }
    }
  }

  private updateTeamPanel(
    panel: HTMLElement,
    fill: HTMLElement,
    ghost: HTMLElement,
    label: HTMLElement,
    dots: HTMLElement,
    chars: Character[],
    hp: number,
    color: string,
    isActive: boolean
  ): void {
    const maxHP = chars.length * 100
    const pct = maxHP > 0 ? Math.max(0, (hp / maxHP) * 100) : 0

    fill.style.width = `${pct}%`
    ghost.style.width = `${pct}%`

    const hpColor = pct > 60 ? color : pct > 28 ? '#ffaa22' : '#ff3333'
    fill.style.background = `linear-gradient(90deg, ${hpColor}99 0%, ${hpColor} 100%)`
    fill.style.boxShadow  = `0 0 6px ${hpColor}66`

    label.textContent = `${hp}`

    panel.classList.toggle('team-active', isActive)

    dots.innerHTML = chars.map(c =>
      `<div class="char-dot${c.alive ? '' : ' dead'}" style="--dot-color:${c.alive ? color : '#333'}"></div>`
    ).join('')
  }

  reset(): void {
    this.gameOverShown = false
    this.gameOverOverlay.style.display = 'none'
    this.lastTurn = -1
    this.lastTeam = -1
  }

  dispose(): void {
    this.humanPanel.remove()
    this.aiPanel.remove()
    this.timerPanel.remove()
    this.weaponDisplay.remove()
    this.powerBarWrap.remove()
    this.turnBanner.remove()
    this.gameOverOverlay.remove()
    this.controlsHint.remove()
    for (const f of this.floatLabels) f.el.remove()
    this.floatLabels = []
  }
}
