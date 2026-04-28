import * as THREE from 'three'
import { GRAVITY, TERRAIN_CELL_SIZE } from '@shared/constants'
import type { Character, WeaponKind } from '@shared/types'
import { WEAPONS } from '@shared/types'
import { getHeight } from '@sim/terrain'

const PREVIEW_STEPS = 60
const PREVIEW_DOTS = 12

export class AimRenderer {
  private line: THREE.Line
  private dots: THREE.InstancedMesh
  private material: THREE.LineBasicMaterial
  private powerBar: THREE.Mesh
  private powerBarBg: THREE.Mesh
  private powerBarMat: THREE.MeshBasicMaterial
  private group: THREE.Group

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()

    this.material = new THREE.LineBasicMaterial({
      color: 0xffdd44,
      transparent: true,
      opacity: 0.85,
    })

    const geom = new THREE.BufferGeometry()
    const positions = new Float32Array(PREVIEW_STEPS * 3)
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    this.line = new THREE.Line(geom, this.material)
    this.group.add(this.line)

    const dotGeom = new THREE.SphereGeometry(0.2, 6, 4)
    const dotMat = new THREE.MeshBasicMaterial({ color: 0xffdd44, transparent: true, opacity: 0.9 })
    this.dots = new THREE.InstancedMesh(dotGeom, dotMat, PREVIEW_DOTS)
    this.dots.count = 0
    this.group.add(this.dots)

    const bgMat = new THREE.MeshBasicMaterial({ color: 0x333333, transparent: true, opacity: 0.5 })
    const bgGeom = new THREE.PlaneGeometry(3, 0.25)
    this.powerBarBg = new THREE.Mesh(bgGeom, bgMat)
    this.powerBarBg.visible = false
    this.group.add(this.powerBarBg)

    this.powerBarMat = new THREE.MeshBasicMaterial({ color: 0x00ff00 })
    const barGeom = new THREE.PlaneGeometry(2.8, 0.18)
    this.powerBar = new THREE.Mesh(barGeom, this.powerBarMat)
    this.powerBar.visible = false
    this.group.add(this.powerBar)

    scene.add(this.group)
  }

  update(
    char: Character | null,
    angle: number,
    azimuth: number,
    power: number,
    isCharging: boolean,
    visible: boolean,
    weapon: WeaponKind = 'bazooka',
    heightmap?: Float32Array
  ): void {
    this.group.visible = visible && char !== null

    if (!char || !visible) return

    const cx = (char.x - 128) * TERRAIN_CELL_SIZE
    const groundH = heightmap ? getHeight(heightmap, char.x, char.z) : char.y
    const cy = (2 * groundH - char.y) * TERRAIN_CELL_SIZE + 2.0
    const cz = (char.z - 128) * TERRAIN_CELL_SIZE

    const config = WEAPONS[weapon]
    const previewPower = isCharging ? power : 50
    const speed = config.speed * (previewPower / 100)
    const elevationAngle = -angle
    const hSpeed = Math.cos(elevationAngle) * speed

    let simX = char.x
    let simY = char.y - 4
    let simZ = char.z
    let vx = Math.cos(azimuth) * hSpeed
    let vy = Math.sin(elevationAngle) * speed
    let vz = Math.sin(azimuth) * hSpeed

    const positions = this.line.geometry.attributes.position as THREE.BufferAttribute
    const dummy = new THREE.Object3D()
    let dotIdx = 0
    let stepsDrawn = 0
    const dotInterval = Math.max(1, Math.floor(PREVIEW_STEPS / PREVIEW_DOTS))

    for (let i = 0; i < PREVIEW_STEPS; i++) {
      vy += GRAVITY * config.gravityMul

      simX += vx
      simY += vy
      simZ += vz

      if (config.drag) {
        vx *= (1 - config.drag)
        vz *= (1 - config.drag)
      }

      const worldPx = (simX - 128) * TERRAIN_CELL_SIZE
      const simGroundH = heightmap ? getHeight(heightmap, simX, simZ) : 0
      const worldPy = (2 * simGroundH - simY) * TERRAIN_CELL_SIZE
      const worldPz = (simZ - 128) * TERRAIN_CELL_SIZE

      if (heightmap && simY >= simGroundH && i > 4) break

      positions.setXYZ(i, worldPx, worldPy, worldPz)
      stepsDrawn = i + 1

      if (i > 0 && i % dotInterval === 0 && dotIdx < PREVIEW_DOTS) {
        dummy.position.set(worldPx, worldPy, worldPz)
        dummy.updateMatrix()
        this.dots.setMatrixAt(dotIdx, dummy.matrix)
        dotIdx++
      }
    }

    positions.needsUpdate = true
    this.line.geometry.setDrawRange(0, stepsDrawn)
    this.dots.count = dotIdx
    this.dots.instanceMatrix.needsUpdate = true

    this.powerBar.visible = isCharging
    this.powerBarBg.visible = isCharging
    if (isCharging) {
      const barY = cy + 3.5
      this.powerBarBg.position.set(cx, barY, cz)
      this.powerBarBg.lookAt(cx, barY + 100, cz + 100)
      this.powerBar.position.set(cx + (power / 100 - 1) * 1.4, barY, cz + 0.01)
      this.powerBar.scale.x = power / 100
      this.powerBar.lookAt(cx + (power / 100 - 1) * 1.4, barY + 100, cz + 100 + 0.01)
      this.powerBarMat.color.setHex(power > 80 ? 0xff0000 : power > 50 ? 0xffaa00 : 0x00ff00)
    }
  }

  dispose(): void {
    this.line.geometry.dispose()
    this.material.dispose()
    this.dots.geometry.dispose()
    ;(this.dots.material as THREE.Material).dispose()
    this.powerBar.geometry.dispose()
    this.powerBarMat.dispose()
    this.powerBarBg.geometry.dispose()
    ;(this.powerBarBg.material as THREE.Material).dispose()
  }
}
