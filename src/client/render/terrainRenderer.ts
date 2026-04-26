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
      if (normalizedH > 0.88) {
        // Snow / exposed rock peak
        colors[i * 3] = 0.82; colors[i * 3 + 1] = 0.82; colors[i * 3 + 2] = 0.76
      } else if (normalizedH > 0.62) {
        // Lush grass (high ground)
        colors[i * 3] = 0.28; colors[i * 3 + 1] = 0.49; colors[i * 3 + 2] = 0.22
      } else if (normalizedH > 0.40) {
        // Mid grass / olive slope
        colors[i * 3] = 0.40; colors[i * 3 + 1] = 0.47; colors[i * 3 + 2] = 0.18
      } else if (normalizedH > 0.18) {
        // Dirt / brown slope
        colors[i * 3] = 0.55; colors[i * 3 + 1] = 0.36; colors[i * 3 + 2] = 0.17
      } else {
        // Base rock (dark, near water)
        colors[i * 3] = 0.38; colors[i * 3 + 1] = 0.36; colors[i * 3 + 2] = 0.40
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
