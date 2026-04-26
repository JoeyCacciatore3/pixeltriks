import * as THREE from 'three'
import { TERRAIN_CELL_SIZE } from '@shared/constants'
import { getHeight } from '@sim/terrain'

type CameraMode = 'character' | 'projectile' | 'impact'

export class GameCamera {
  camera: THREE.PerspectiveCamera
  private target = new THREE.Vector3()
  private currentPos = new THREE.Vector3()
  private offset = new THREE.Vector3(0, 35, 45)
  private shakeIntensity = 0
  private shakeDecay = 0.92
  private mode: CameraMode = 'character'
  private impactTimer = 0

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000)
    this.camera.position.set(0, 35, 45)
    this.camera.lookAt(0, 0, 0)
    this.currentPos.copy(this.camera.position)
  }

  followTarget(x: number, simY: number, z: number, heightmap: Float32Array): void {
    if (this.mode === 'impact') return
    const groundH = getHeight(heightmap, x, z)
    this.target.set(
      (x - 128) * TERRAIN_CELL_SIZE,
      (2 * groundH - simY) * TERRAIN_CELL_SIZE,
      (z - 128) * TERRAIN_CELL_SIZE
    )
  }

  followProjectile(x: number, simY: number, z: number, heightmap: Float32Array): void {
    this.mode = 'projectile'
    const groundH = getHeight(heightmap, x, z)
    this.target.set(
      (x - 128) * TERRAIN_CELL_SIZE,
      (2 * groundH - simY) * TERRAIN_CELL_SIZE,
      (z - 128) * TERRAIN_CELL_SIZE
    )
  }

  onImpact(x: number, simY: number, z: number, heightmap: Float32Array): void {
    this.mode = 'impact'
    const groundH = getHeight(heightmap, x, z)
    this.target.set(
      (x - 128) * TERRAIN_CELL_SIZE,
      (2 * groundH - simY) * TERRAIN_CELL_SIZE,
      (z - 128) * TERRAIN_CELL_SIZE
    )
    this.impactTimer = 150
  }

  returnToCharacter(): void {
    this.mode = 'character'
  }

  shake(intensity: number): void {
    this.shakeIntensity = Math.max(this.shakeIntensity, intensity)
  }

  update(): void {
    if (this.mode === 'impact') {
      this.impactTimer--
      if (this.impactTimer <= 0) {
        this.mode = 'character'
      }
    }

    const speed = this.mode === 'projectile' ? 0.08 : 0.05
    const goalPos = this.target.clone().add(this.offset)

    this.currentPos.lerp(goalPos, speed)
    this.camera.position.copy(this.currentPos)

    if (this.shakeIntensity > 0.01) {
      this.camera.position.x += (Math.random() - 0.5) * this.shakeIntensity
      this.camera.position.y += (Math.random() - 0.5) * this.shakeIntensity
      this.shakeIntensity *= this.shakeDecay
    }

    this.camera.lookAt(this.target)
  }

  resize(aspect: number): void {
    this.camera.aspect = aspect
    this.camera.updateProjectionMatrix()
  }
}
