import type { GameInput, WeaponKind } from '@shared/types'

const WEAPON_ORDER: WeaponKind[] = ['bazooka', 'grenade', 'shotgun', 'airstrike', 'teleport', 'dynamite']

export class InputManager {
  private keys = new Set<string>()
  private touchKeys = new Set<string>()
  private aimAngle = 0          // elevation (up/down)
  private aimAzimuth = 0        // horizontal direction in radians (0 = right, π = left)
  private charging = false
  private chargeStart = 0
  private selectedWeapon: WeaponKind = 'bazooka'
  private weaponIndex = 0
  private pendingFire: { angle: number; power: number; weapon: WeaponKind; azimuth: number } | null = null
  private pendingEndTurn = false
  private pendingJump = false

  constructor() {
    window.addEventListener('keydown', this.onKeyDown)
    window.addEventListener('keyup', this.onKeyUp)
  }

  private onKeyDown = (e: KeyboardEvent): void => {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Space'].includes(e.code)) {
      e.preventDefault()
    }

    this.keys.add(e.code)

    if (e.code === 'Space' && !this.charging) {
      this.startCharge()
    }

    if (e.code === 'Tab') {
      e.preventDefault()
      this.cycleWeapon(1)
    }

    if (e.code === 'Enter' && !e.shiftKey) {
      this.pendingEndTurn = true
    }

    if (e.code === 'KeyJ' || (e.code === 'Enter' && e.shiftKey)) {
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
      azimuth: this.aimAzimuth,
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

  setAimAzimuth(az: number): void {
    this.aimAzimuth = az
  }

  private isPressed(code: string): boolean {
    return this.keys.has(code) || this.touchKeys.has(code)
  }

  getInput(): GameInput {
    const input: GameInput = {}

    // WASD = 4-directional movement
    const xDir = this.isPressed('KeyA') ? -1 : this.isPressed('KeyD') ? 1 : 0
    const zDir = this.isPressed('KeyW') ? -1 : this.isPressed('KeyS') ? 1 : 0

    if (xDir !== 0) input.moveDirection = xDir as -1 | 1
    if (zDir !== 0) input.moveZDirection = zDir as -1 | 1

    // Arrow keys = aim direction
    if (this.isPressed('ArrowUp')) {
      this.aimAngle = Math.min(this.aimAngle + 0.03, Math.PI / 2)
    }
    if (this.isPressed('ArrowDown')) {
      this.aimAngle = Math.max(this.aimAngle - 0.03, -Math.PI * 0.4)
    }
    if (this.isPressed('ArrowLeft')) {
      this.aimAzimuth = this.aimAzimuth - 0.04
    }
    if (this.isPressed('ArrowRight')) {
      this.aimAzimuth = this.aimAzimuth + 0.04
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

  getAimAzimuth(): number {
    return this.aimAzimuth
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
