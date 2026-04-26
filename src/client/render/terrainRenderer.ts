import * as THREE from 'three'
import { TERRAIN_SIZE, TERRAIN_CELL_SIZE } from '@shared/constants'

export class TerrainRenderer {
  mesh: THREE.Mesh
  private geometry: THREE.PlaneGeometry
  private material: THREE.MeshStandardMaterial
  private heightmapVersion = -1

  constructor(scene: THREE.Scene) {
    this.geometry = new THREE.PlaneGeometry(
      TERRAIN_SIZE * TERRAIN_CELL_SIZE,
      TERRAIN_SIZE * TERRAIN_CELL_SIZE,
      TERRAIN_SIZE - 1,
      TERRAIN_SIZE - 1
    )
    this.geometry.rotateX(-Math.PI / 2)

    this.material = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(this.geometry, this.material)
    scene.add(this.mesh)
  }

  update(heightmap: Float32Array, version: number): void {
    if (version === this.heightmapVersion) return
    this.heightmapVersion = version

    const positions = this.geometry.attributes.position
    const colors = new Float32Array(positions.count * 3)

    for (let i = 0; i < positions.count; i++) {
      const ix = i % TERRAIN_SIZE
      const iz = Math.floor(i / TERRAIN_SIZE)
      const h = heightmap[iz * TERRAIN_SIZE + ix]

      positions.setY(i, h * TERRAIN_CELL_SIZE)

      const normalizedH = h / 40
      if (normalizedH > 0.7) {
        colors[i * 3] = 0.3
        colors[i * 3 + 1] = 0.65
        colors[i * 3 + 2] = 0.2
      } else if (normalizedH > 0.3) {
        colors[i * 3] = 0.55
        colors[i * 3 + 1] = 0.45
        colors[i * 3 + 2] = 0.3
      } else {
        colors[i * 3] = 0.6
        colors[i * 3 + 1] = 0.55
        colors[i * 3 + 2] = 0.4
      }
    }

    this.geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    positions.needsUpdate = true
    this.geometry.computeVertexNormals()
  }

  dispose(): void {
    this.geometry.dispose()
    this.material.dispose()
  }
}
