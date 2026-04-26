import * as THREE from 'three'
import { TERRAIN_CELL_SIZE } from '@shared/constants'
import { getHeight } from '@sim/terrain'

type CameraMode = 'character' | 'projectile' | 'impact'

// Critically damped spring — Unity SmoothDamp algorithm.
// Frame-rate independent, no overshoot, reaches target and stops cleanly.
// smoothTime: time (seconds) to reach within ~1/e of target from rest.
function smoothDamp(
  current: number,
  target: number,
  vel: { v: number },
  smoothTime: number,
  dt: number
): number {
  const omega = 2 / smoothTime
  const x = omega * dt
  const exp = 1 / (1 + x + 0.48 * x * x + 0.235 * x * x * x)
  const delta = current - target
  const temp = (vel.v + omega * delta) * dt
  vel.v = (vel.v - omega * temp) * exp
  return target + (delta + temp) * exp
}

export class GameCamera {
  camera: THREE.PerspectiveCamera
  private target = new THREE.Vector3()
  private currentPos = new THREE.Vector3()
  private velX = { v: 0 }
  private velY = { v: 0 }
  private velZ = { v: 0 }
  private offset = new THREE.Vector3(0, 32, 42)
  private trauma = 0
  private shakePhase = 0
  private mode: CameraMode = 'character'
  private impactTimer = 0
  private lastUpdateMs = 0
  private readonly IMPACT_DWELL = 150  // 2.5s at 60fps

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(45, aspect, 0.1, 1000)
    this.camera.position.set(0, 32, 42)
    this.camera.lookAt(0, 0, 0)
    this.currentPos.copy(this.camera.position)
  }

  followTarget(x: number, simY: number, z: number, heightmap: Float32Array): void {
    if (this.mode === 'impact') return
    this.setTarget(x, simY, z, heightmap)
  }

  followProjectile(x: number, simY: number, z: number, heightmap: Float32Array): void {
    this.mode = 'projectile'
    this.setTarget(x, simY, z, heightmap)
  }

  onImpact(x: number, simY: number, z: number, heightmap: Float32Array): void {
    this.mode = 'impact'
    this.setTarget(x, simY, z, heightmap)
    this.impactTimer = this.IMPACT_DWELL
  }

  shake(intensity: number): void {
    this.trauma = Math.min(1, this.trauma + Math.min(0.5, intensity))
  }

  update(): void {
    const now = performance.now()
    const dt = this.lastUpdateMs > 0
      ? Math.min((now - this.lastUpdateMs) / 1000, 0.1)
      : 1 / 60
    this.lastUpdateMs = now

    if (this.mode === 'impact') {
      this.impactTimer--
      if (this.impactTimer <= 0) {
        this.mode = 'character'
      }
    }

    // Critically damped spring: 0.12s for projectile (snappy), 0.35s for character (cinematic)
    const smoothTime = this.mode === 'projectile' ? 0.12 : 0.35
    const goal = new THREE.Vector3().addVectors(this.target, this.offset)

    this.currentPos.x = smoothDamp(this.currentPos.x, goal.x, this.velX, smoothTime, dt)
    this.currentPos.y = smoothDamp(this.currentPos.y, goal.y, this.velY, smoothTime, dt)
    this.currentPos.z = smoothDamp(this.currentPos.z, goal.z, this.velZ, smoothTime, dt)
    this.camera.position.copy(this.currentPos)

    // Coherent trauma shake: product of coprime-frequency sin waves.
    // Unlike Math.random(), this is continuous and doesn't strobe between frames.
    if (this.trauma > 0.01) {
      const mag = this.trauma * this.trauma * 6
      this.shakePhase += 2.5
      const sx = Math.sin(this.shakePhase * 1.1) * Math.cos(this.shakePhase * 2.3)
      const sy = Math.sin(this.shakePhase * 0.7) * Math.cos(this.shakePhase * 3.1)
      this.camera.position.x += sx * mag
      this.camera.position.y += sy * mag * 0.5
      this.trauma *= 0.88
      if (this.trauma < 0.01) this.trauma = 0
    }

    this.camera.lookAt(this.target)
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }

  private setTarget(x: number, simY: number, z: number, heightmap: Float32Array): void {
    const groundH = getHeight(heightmap, x, z)
    this.target.set(
      (x - 128) * TERRAIN_CELL_SIZE,
      (2 * groundH - simY) * TERRAIN_CELL_SIZE,
      (z - 128) * TERRAIN_CELL_SIZE
    )
  }
}
