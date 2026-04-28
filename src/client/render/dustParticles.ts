import * as THREE from 'three'

const PARTICLE_COUNT = 200
const SPREAD = 60
const HEIGHT_RANGE = 30

export class DustParticles {
  private points: THREE.Points
  private velocities: Float32Array

  constructor(scene: THREE.Scene) {
    const positions = new Float32Array(PARTICLE_COUNT * 3)
    this.velocities = new Float32Array(PARTICLE_COUNT * 3)

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      positions[i * 3] = (Math.random() - 0.5) * SPREAD
      positions[i * 3 + 1] = Math.random() * HEIGHT_RANGE + 2
      positions[i * 3 + 2] = (Math.random() - 0.5) * SPREAD

      this.velocities[i * 3] = (Math.random() - 0.5) * 0.02
      this.velocities[i * 3 + 1] = (Math.random() - 0.5) * 0.005
      this.velocities[i * 3 + 2] = (Math.random() - 0.5) * 0.02
    }

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))

    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      transparent: true,
      opacity: 0.35,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    })

    this.points = new THREE.Points(geom, mat)
    scene.add(this.points)
  }

  update(time: number, camera: THREE.Camera): void {
    const positions = this.points.geometry.attributes.position as THREE.BufferAttribute
    const camPos = camera.position

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      let x = positions.array[i * 3] + this.velocities[i * 3]
      let y = positions.array[i * 3 + 1] + this.velocities[i * 3 + 1]
      let z = positions.array[i * 3 + 2] + this.velocities[i * 3 + 2]

      x += Math.sin(time * 0.3 + i * 0.1) * 0.003

      const dx = x - camPos.x
      const dz = z - camPos.z
      if (dx * dx + dz * dz > SPREAD * SPREAD) {
        x = camPos.x + (Math.random() - 0.5) * SPREAD
        z = camPos.z + (Math.random() - 0.5) * SPREAD
      }
      if (y < 1) y = HEIGHT_RANGE
      if (y > HEIGHT_RANGE + 2) y = 2

      positions.array[i * 3] = x
      positions.array[i * 3 + 1] = y
      positions.array[i * 3 + 2] = z
    }

    positions.needsUpdate = true
  }

  dispose(): void {
    this.points.geometry.dispose()
    ;(this.points.material as THREE.Material).dispose()
  }
}
