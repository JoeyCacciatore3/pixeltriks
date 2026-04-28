import * as THREE from 'three'
import type { Projectile } from '@shared/types'
import { TERRAIN_CELL_SIZE } from '@shared/constants'
import { getHeight } from '@sim/terrain'

const TRAIL_LENGTH = 12

interface ProjEntry {
  mesh: THREE.Mesh
  glow: THREE.PointLight
  trail: THREE.Line
  trailPositions: Float32Array
  trailHead: number
}

export class ProjectileRenderer {
  private group: THREE.Group
  private entries: Map<number, ProjEntry> = new Map()

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    scene.add(this.group)
  }

  update(projectiles: Projectile[], heightmap: Float32Array): void {
    const activeIds = new Set<number>()

    for (let i = 0; i < projectiles.length; i++) {
      const proj = projectiles[i]
      if (!proj.active) continue

      const id = i
      activeIds.add(id)

      let entry = this.entries.get(id)
      if (!entry) {
        const geom = new THREE.SphereGeometry(0.22, 8, 6)
        const mat = new THREE.MeshBasicMaterial({ color: 0xffdd44 })
        const mesh = new THREE.Mesh(geom, mat)

        const glow = new THREE.PointLight(0xffaa22, 2, 8)

        const trailPositions = new Float32Array(TRAIL_LENGTH * 3)
        const trailGeom = new THREE.BufferGeometry()
        trailGeom.setAttribute('position', new THREE.BufferAttribute(trailPositions, 3))
        const trailMat = new THREE.LineBasicMaterial({
          color: 0xffaa22,
          transparent: true,
          opacity: 0.5,
          blending: THREE.AdditiveBlending,
        })
        const trail = new THREE.Line(trailGeom, trailMat)

        this.group.add(mesh)
        this.group.add(glow)
        this.group.add(trail)

        entry = { mesh, glow, trail, trailPositions, trailHead: 0 }
        this.entries.set(id, entry)
      }

      const groundH = getHeight(heightmap, proj.x, proj.z)
      const px = (proj.x - 128) * TERRAIN_CELL_SIZE
      const py = (2 * groundH - proj.y) * TERRAIN_CELL_SIZE
      const pz = (proj.z - 128) * TERRAIN_CELL_SIZE

      entry.mesh.position.set(px, py, pz)
      entry.glow.position.set(px, py, pz)

      // Update trail ring buffer
      const h = entry.trailHead
      entry.trailPositions[h * 3] = px
      entry.trailPositions[h * 3 + 1] = py
      entry.trailPositions[h * 3 + 2] = pz
      entry.trailHead = (h + 1) % TRAIL_LENGTH
      entry.trail.geometry.attributes.position.needsUpdate = true
    }

    for (const [id, entry] of this.entries) {
      if (!activeIds.has(id)) {
        this.group.remove(entry.mesh)
        this.group.remove(entry.glow)
        this.group.remove(entry.trail)
        entry.mesh.geometry.dispose()
        ;(entry.mesh.material as THREE.Material).dispose()
        entry.trail.geometry.dispose()
        ;(entry.trail.material as THREE.Material).dispose()
        this.entries.delete(id)
      }
    }
  }

  dispose(): void {
    this.entries.forEach(entry => {
      entry.mesh.geometry.dispose()
      ;(entry.mesh.material as THREE.Material).dispose()
      entry.trail.geometry.dispose()
      ;(entry.trail.material as THREE.Material).dispose()
    })
  }
}
