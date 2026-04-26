import * as THREE from 'three'
import { TERRAIN_SIZE, TERRAIN_CELL_SIZE } from '@shared/constants'

export class WaterRenderer {
  mesh: THREE.Mesh
  private material: THREE.MeshStandardMaterial

  constructor(scene: THREE.Scene) {
    const size = TERRAIN_SIZE * TERRAIN_CELL_SIZE
    const geom = new THREE.PlaneGeometry(size * 1.5, size * 1.5)
    geom.rotateX(-Math.PI / 2)

    this.material = new THREE.MeshStandardMaterial({
      color: 0x1166cc,
      transparent: true,
      opacity: 0.6,
      roughness: 0.1,
      metalness: 0.3,
      side: THREE.DoubleSide,
    })

    this.mesh = new THREE.Mesh(geom, this.material)
    scene.add(this.mesh)
  }

  update(waterLevel: number, time: number): void {
    this.mesh.position.y = waterLevel * TERRAIN_CELL_SIZE + Math.sin(time * 0.5) * 0.05
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
