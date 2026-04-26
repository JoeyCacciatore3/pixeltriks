import * as THREE from 'three'
import type { Projectile } from '@shared/types'
import { TERRAIN_CELL_SIZE } from '@shared/constants'

export class ProjectileRenderer {
  private group: THREE.Group
  private meshes: Map<number, THREE.Mesh> = new Map()

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    scene.add(this.group)
  }

  update(projectiles: Projectile[]): void {
    const activeIds = new Set<number>()

    for (let i = 0; i < projectiles.length; i++) {
      const proj = projectiles[i]
      if (!proj.active) continue

      const id = i
      activeIds.add(id)

      let mesh = this.meshes.get(id)
      if (!mesh) {
        const geom = new THREE.SphereGeometry(0.2, 6, 4)
        const mat = new THREE.MeshBasicMaterial({ color: 0xffff00 })
        mesh = new THREE.Mesh(geom, mat)
        this.meshes.set(id, mesh)
        this.group.add(mesh)
      }

      mesh.position.set(
        (proj.x - 128) * TERRAIN_CELL_SIZE,
        proj.y * TERRAIN_CELL_SIZE,
        (proj.z - 128) * TERRAIN_CELL_SIZE
      )
    }

    for (const [id, mesh] of this.meshes) {
      if (!activeIds.has(id)) {
        this.group.remove(mesh)
        mesh.geometry.dispose()
        ;(mesh.material as THREE.Material).dispose()
        this.meshes.delete(id)
      }
    }
  }

  dispose(): void {
    this.meshes.forEach(mesh => {
      mesh.geometry.dispose()
      ;(mesh.material as THREE.Material).dispose()
    })
  }
}
