import type { GameInput, WeaponKind } from '@shared/types'

const WEAPON_ORDER: WeaponKind[] = ['bazooka', 'grenade', 'shotgun', 'airstrike', 'teleport', 'dynamite']

export class InputManager {
  private keys = new Set<string>()
  private touchKeys = new Set<string>()
  private aimAngle = 0
  private charging = false
  private chargeStart = 0
  private selectedWeapon: WeaponKind = 'bazooka'
  private weaponIndex = 0
  private pendingFire: { angle: number; power: number; weapon: WeaponKind } | null = null
  private pendingEndTurn = false
  private pendingJump = false

  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    this.keys.add(e.code)

    if (e.code === 'Space' && !this.charging) {
      this.startCharge()
    }

    if (e.code === 'Tab') {
      e.preventDefault()
      this.cycleWeapon(1)
    }

    if (e.code === 'Enter') {
      this.pendingEndTurn = true
    }

    if (e.code === 'KeyJ') {
      this.pendingJump = true
    }
  }

  private onKeyUp = (e: KeyboardEvent): void => {
    this.keys.delete(e.code)

    if (e.code === 'Space' && this.charging) {
      this.releaseCharge()
    }
  }

  startCharge(): void {
    if (this.charging) return
    this.charging = true
    this.chargeStart = performance.now()
  }

  releaseCharge(): void {
    if (!this.charging) return
    this.charging = false
    const chargeTime = performance.now() - this.chargeStart
    const power = Math.min(100, (chargeTime / 2000) * 100)
    this.pendingFire = {
      angle: this.aimAngle,
      power: Math.max(10, power),
      weapon: this.selectedWeapon,
    }
  }

  cycleWeapon(dir: number): void {
    this.weaponIndex = (this.weaponIndex + dir + WEAPON_ORDER.length) % WEAPON_ORDER.length
    this.selectedWeapon = WEAPON_ORDER[this.weaponIndex]
  }

  triggerJump(): void {
    this.pendingJump = true
  }

  triggerEndTurn(): void {
    this.pendingEndTurn = true
  }

  setTouchKey(code: string, active: boolean): void {
    if (active) {
      this.touchKeys.add(code)
    } else {
      this.touchKeys.delete(code)
    }
  }

  private isPressed(code: string): boolean {
    return this.keys.has(code) || this.touchKeys.has(code)
  }

  getInput(): GameInput {
    const input: GameInput = {}

    if (this.isPressed('ArrowLeft') || this.isPressed('KeyA')) {
      input.moveDirection = -1
    } else if (this.isPressed('ArrowRight') || this.isPressed('KeyD')) {
      input.moveDirection = 1
    }

    if (this.isPressed('ArrowUp') || this.isPressed('KeyW')) {
      this.aimAngle = Math.min(this.aimAngle + 0.03, Math.PI / 2)
    }
    if (this.isPressed('ArrowDown') || this.isPressed('KeyS')) {
      this.aimAngle = Math.max(this.aimAngle - 0.03, -Math.PI * 0.4)
    }

    if (this.pendingJump) {
      input.jump = true
      this.pendingJump = false
    }

    if (this.pendingFire) {
      input.fire = this.pendingFire
      this.pendingFire = null
    }

    if (this.pendingEndTurn) {
      input.endTurn = true
      this.pendingEndTurn = false
    }

    return input
  }

  getAimAngle(): number {
    return this.aimAngle
  }

  getChargePower(): number {
    if (!this.charging) return 0
    const chargeTime = performance.now() - this.chargeStart
    return Math.min(100, (chargeTime / 2000) * 100)
  }

  getSelectedWeapon(): WeaponKind {
    return this.selectedWeapon
  }

  isCharging(): boolean {
    return this.charging
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown)
    window.removeEventListener('keyup', this.onKeyUp)
  }
}
