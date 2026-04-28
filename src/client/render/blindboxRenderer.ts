import * as THREE from 'three'
import type { Blindbox } from '@shared/types'
import { TERRAIN_CELL_SIZE } from '@shared/constants'
import { getHeight } from '@sim/terrain'

export class BlindboxRenderer {
  private scene: THREE.Scene
  private groups: THREE.Group[] = []

  constructor(scene: THREE.Scene) {
    this.scene = scene
  }

  update(blindboxes: Blindbox[], heightmap: Float32Array, time: number): void {
    // Sync pool size
    while (this.groups.length > blindboxes.length) {
      const g = this.groups.pop()!
      this.scene.remove(g)
      for (const child of g.children) {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          ;(child.material as THREE.Material).dispose()
        }
      }
    }
    while (this.groups.length < blindboxes.length) {
      const g = this.createMesh()
      this.scene.add(g)
      this.groups.push(g)
    }

    for (let i = 0; i < blindboxes.length; i++) {
      const box = blindboxes[i]
      const group = this.groups[i]

      const groundH = getHeight(heightmap, box.x, box.z)
      const worldY = (2 * groundH - box.y) * TERRAIN_CELL_SIZE + 1
      group.position.set(
        (box.x - 128) * TERRAIN_CELL_SIZE,
        worldY,
        (box.z - 128) * TERRAIN_CELL_SIZE
      )

      // Parachute visible while falling, spin while in air
      const parachute = group.children[2] as THREE.Mesh
      parachute.visible = !box.grounded
      if (!box.grounded) {
        group.rotation.y = time * 1.5
      }

      // Idle bob when grounded
      if (box.grounded) {
        group.rotation.y = time * 0.8
        group.position.y += Math.sin(time * 3 + box.x) * 0.05
      }
    }
  }

  private createMesh(): THREE.Group {
    const group = new THREE.Group()

    // Crate body
    const boxGeo = new THREE.BoxGeometry(1.8, 1.8, 1.8)
    const boxMat = new THREE.MeshToonMaterial({ color: 0xffcc00 })
    const crate = new THREE.Mesh(boxGeo, boxMat)
    group.add(crate)

    // Question mark symbol — small white box on top face
    const markGeo = new THREE.BoxGeometry(0.5, 0.5, 0.1)
    const markMat = new THREE.MeshBasicMaterial({ color: 0xffffff })
    const mark = new THREE.Mesh(markGeo, markMat)
    mark.position.set(0, 0.9, 0.95)
    group.add(mark)

    // Parachute — inverted cone above crate
    const chuteGeo = new THREE.ConeGeometry(2.5, 2.5, 8)
    const chuteMat = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      opacity: 0.65,
      side: THREE.DoubleSide,
    })
    const chute = new THREE.Mesh(chuteGeo, chuteMat)
    chute.position.y = 3.5
    chute.rotation.x = Math.PI  // point down (open side up)
    group.add(chute)

    return group
  }

  dispose(): void {
    for (const g of this.groups) {
      this.scene.remove(g)
      for (const child of g.children) {
        if (child instanceof THREE.Mesh) {
          child.geometry.dispose()
          ;(child.material as THREE.Material).dispose()
        }
      }
    }
    this.groups = []
  }
}
