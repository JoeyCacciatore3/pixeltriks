import * as THREE from 'three'
import { TERRAIN_CELL_SIZE } from '@shared/constants'
import { getHeight } from '@sim/terrain'

type CameraMode = 'character' | 'projectile' | 'impact'

export class GameCamera {
  camera: THREE.PerspectiveCamera
  private target = new THREE.Vector3()
  private currentPos = new THREE.Vector3()
  private offset = new THREE.Vector3(0, 32, 42)
  private trauma = 0         // 0–1, drives quadratic shake
  private mode: CameraMode = 'character'
  private impactTimer = 0
  private readonly IMPACT_DWELL = 120  // 2s at 60fps — player sees explosion result

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

  returnToCharacter(): void {
    if (this.mode !== 'impact') {
      this.mode = 'character'
    }
  }

  // trauma-based shake: additive 0–1, decays quadratically
  shake(intensity: number): void {
    this.trauma = Math.min(1, this.trauma + Math.min(0.5, intensity))
  }

  update(): void {
    if (this.mode === 'impact') {
      this.impactTimer--
      if (this.impactTimer <= 0) {
        this.mode = 'character'
      }
    }

    // Projectile tracking needs to be snappy — bazooka travels ~6 Three.js units/tick.
    // Impact dwell and character follow can be slower and more cinematic.
    const speed = this.mode === 'projectile' ? 0.20 : 0.05
    const goalPos = this.target.clone().add(this.offset)
    this.currentPos.lerp(goalPos, speed)
    this.camera.position.copy(this.currentPos)

    // Quadratic trauma shake: small hits barely register, big hits shake hard
    if (this.trauma > 0.01) {
      const mag = this.trauma * this.trauma * 6
      this.camera.position.x += (Math.random() - 0.5) * mag
      this.camera.position.y += (Math.random() - 0.5) * mag * 0.5
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
