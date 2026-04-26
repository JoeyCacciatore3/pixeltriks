import type { WorldState } from '@shared/types'
import { TEAM_HUMAN, TEAM_AI, AIM_PHASE_DURATION, TICK_RATE } from '@shared/constants'
import type { InputManager } from '../input'

interface FloatLabel {
  el: HTMLElement
  life: number
  x: number
  y: number
}

export class HUD {
  private el: HTMLElement
  private turnInfo: HTMLElement
  private timer: HTMLElement
  private teamHP: HTMLElement
  private weaponDisplay: HTMLElement
  private gameOverOverlay: HTMLElement
  private controlsHint: HTMLElement
  private gameOverShown = false
  private floatLabels: FloatLabel[] = []
  onRestart: (() => void) | null = null

  constructor() {
    this.el = document.getElementById('hud')!

    this.turnInfo = document.createElement('div')
    this.turnInfo.className = 'hud-turn'
    this.el.appendChild(this.turnInfo)

    this.timer = document.createElement('div')
    this.timer.className = 'hud-timer'
    this.el.appendChild(this.timer)

    this.teamHP = document.createElement('div')
    this.teamHP.className = 'hud-teams'
    this.el.appendChild(this.teamHP)

    this.weaponDisplay = document.createElement('div')
    this.weaponDisplay.className = 'hud-weapon'
    this.el.appendChild(this.weaponDisplay)

    this.gameOverOverlay = document.createElement('div')
    this.gameOverOverlay.className = 'game-over'
    this.gameOverOverlay.style.display = 'none'
    document.body.appendChild(this.gameOverOverlay)

    this.controlsHint = document.createElement('div')
    this.controlsHint.className = 'hud-controls'
    this.controlsHint.innerHTML = 'WASD Move | Arrows Aim | Space Fire | Tab Weapon | J Jump | Enter End Turn'
    this.el.appendChild(this.controlsHint)
  }

  spawnDamageLabel(screenX: number, screenY: number, amount: number, isEnemy: boolean): void {
    const el = document.createElement('div')
    el.className = 'damage-float'
    el.textContent = `-${amount}`
    el.style.left = `${screenX}px`
    el.style.top = `${screenY}px`
    el.style.color = isEnemy ? '#ff4444' : '#ffaa00'
    document.body.appendChild(el)
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
    const teamName = world.activeTeam === TEAM_HUMAN ? 'HUMANS' : 'AI BOTS'
    const teamColor = world.activeTeam === TEAM_HUMAN ? '#38f' : '#f33'

    this.turnInfo.innerHTML = `<span style="color:${teamColor}">${teamName}</span> — Turn ${world.turn + 1}`

    if (world.phase === 'aiming') {
      const remaining = Math.ceil((AIM_PHASE_DURATION - world.phaseTimer) / TICK_RATE)
      this.timer.textContent = `${remaining}s`
      this.timer.style.color = remaining <= 5 ? '#f33' : '#fff'
    } else {
      this.timer.textContent = world.phase.replace('_', ' ').toUpperCase()
      this.timer.style.color = '#aaa'
    }

    const humanHP = world.characters
      .filter(c => c.team === TEAM_HUMAN)
      .reduce((sum, c) => sum + (c.alive ? c.hp : 0), 0)
    const aiHP = world.characters
      .filter(c => c.team === TEAM_AI)
      .reduce((sum, c) => sum + (c.alive ? c.hp : 0), 0)

    this.teamHP.innerHTML = `
      <span style="color:#38f">HUMANS: ${humanHP} HP</span>
      <span style="color:#f33">AI: ${aiHP} HP</span>
    `

    this.weaponDisplay.innerHTML = `
      <span class="weapon-name">${input.getSelectedWeapon().toUpperCase()}</span>
    `

    if (world.phase === 'game_over' && !this.gameOverShown) {
      this.gameOverShown = true
      const humansAlive = world.characters.filter(c => c.team === TEAM_HUMAN && c.alive).length
      const winner = humansAlive > 0 ? 'HUMANS WIN!' : 'AI WINS!'
      const winColor = humansAlive > 0 ? '#38f' : '#f33'
      this.gameOverOverlay.style.display = 'flex'
      this.gameOverOverlay.innerHTML = `
        <h1 style="color:${winColor}">${winner}</h1>
        <p>Press R or tap below to restart</p>
        <button class="restart-btn">PLAY AGAIN</button>
      `
      const btn = this.gameOverOverlay.querySelector('.restart-btn')
      if (btn) {
        btn.addEventListener('click', () => {
          if (this.onRestart) this.onRestart()
        })
        btn.addEventListener('touchend', (e) => {
          e.preventDefault()
          if (this.onRestart) this.onRestart()
        })
      }
    }
  }

  reset(): void {
    this.gameOverShown = false
    this.gameOverOverlay.style.display = 'none'
  }
}
