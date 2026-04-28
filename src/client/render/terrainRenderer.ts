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
    this.mesh.receiveShadow = true
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

      const n = h / 40
      // Multi-frequency noise for organic color breakup
      const n1 = Math.sin(ix * 0.7 + iz * 1.3) * 0.5 + Math.sin(ix * 2.1 - iz * 0.9) * 0.3
      const n2 = Math.sin(ix * 0.3 + iz * 0.8) * Math.cos(ix * 1.7 - iz * 0.5)
      const noise = n1 * 0.035
      const patch = n2 * 0.025

      // Compute slope from neighbors for cliff/rock detection
      const ixL = Math.max(0, ix - 1)
      const ixR = Math.min(TERRAIN_SIZE - 1, ix + 1)
      const izU = Math.max(0, iz - 1)
      const izD = Math.min(TERRAIN_SIZE - 1, iz + 1)
      const dx = heightmap[iz * TERRAIN_SIZE + ixR] - heightmap[iz * TERRAIN_SIZE + ixL]
      const dz = heightmap[izD * TERRAIN_SIZE + ix] - heightmap[izU * TERRAIN_SIZE + ix]
      const slope = Math.sqrt(dx * dx + dz * dz)
      const isSteep = slope > 3.0

      let r: number, g: number, b: number
      if (isSteep) {
        // Exposed rock on steep slopes
        r = 0.40 + noise; g = 0.38 + noise; b = 0.35 + noise
      } else if (n > 0.90) {
        // Snow caps
        r = 0.88 + noise; g = 0.88 + noise; b = 0.92 + noise
      } else if (n > 0.75) {
        // Alpine rock — grey with lichen patches
        const t = (n - 0.75) / 0.15
        r = 0.42 + t * 0.46 + noise; g = 0.42 + t * 0.46 + patch; b = 0.40 + t * 0.52 + noise
      } else if (n > 0.58) {
        // Dark forest green
        r = 0.15 + noise + patch; g = 0.38 + noise; b = 0.12 + noise
      } else if (n > 0.45) {
        // Lush grass — vivid green with yellow-green variation
        r = 0.22 + patch * 2; g = 0.52 + noise; b = 0.16 + noise
      } else if (n > 0.32) {
        // Light grass to dirt transition
        const t = (n - 0.32) / 0.13
        r = 0.48 - t * 0.26 + noise; g = 0.36 + t * 0.16 + patch; b = 0.14 + noise
      } else if (n > 0.18) {
        // Brown earth / dirt
        r = 0.48 + noise; g = 0.34 + patch; b = 0.14 + noise
      } else if (n > 0.08) {
        // Sandy shore
        const t = (n - 0.08) / 0.10
        r = 0.58 + noise - t * 0.10; g = 0.50 + noise - t * 0.16; b = 0.32 + noise - t * 0.18
      } else {
        // Wet rock near water — dark mossy
        r = 0.22 + noise; g = 0.26 + patch; b = 0.20 + noise
      }
      colors[i * 3] = r; colors[i * 3 + 1] = g; colors[i * 3 + 2] = b
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
