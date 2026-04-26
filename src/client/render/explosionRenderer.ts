import * as THREE from 'three'
import type { ExplosionEvent } from '@shared/types'
import { TERRAIN_CELL_SIZE } from '@shared/constants'
import { getHeight } from '@sim/terrain'

interface ActiveExplosion {
  particles: THREE.Points
  light: THREE.PointLight
  life: number
  maxLife: number
}

export class ExplosionRenderer {
  private group: THREE.Group
  private active: ActiveExplosion[] = []

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    scene.add(this.group)
  }

  spawn(event: ExplosionEvent, heightmap: Float32Array): void {
    const scale = Math.min(event.radius / 35, 1.5)
    const count = Math.floor(20 + scale * 50)  // 20–95 particles based on size
    const positions = new Float32Array(count * 3)
    const velocities = new Float32Array(count * 3)
    const colors = new Float32Array(count * 3)

    for (let i = 0; i < count; i++) {
      const theta = Math.random() * Math.PI * 2
      const phi = Math.random() * Math.PI
      const speed = (0.08 + Math.random() * 0.25) * (0.5 + scale * 0.5)

      positions[i * 3] = 0
      positions[i * 3 + 1] = 0
      positions[i * 3 + 2] = 0

      velocities[i * 3] = Math.sin(phi) * Math.cos(theta) * speed
      velocities[i * 3 + 1] = Math.cos(phi) * speed + 0.1
      velocities[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed

      const heat = 0.5 + Math.random() * 0.5
      colors[i * 3] = 1
      colors[i * 3 + 1] = heat * 0.6
      colors[i * 3 + 2] = heat * 0.1
    }

    const geom = new THREE.BufferGeometry()
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3))
    geom.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geom.setAttribute('velocity', new THREE.BufferAttribute(velocities, 3))

    const mat = new THREE.PointsMaterial({
      size: 0.2 + scale * 0.35,
      vertexColors: true,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    })

    const groundH = getHeight(heightmap, event.x, event.z)
    const particles = new THREE.Points(geom, mat)
    particles.position.set(
      (event.x - 128) * TERRAIN_CELL_SIZE,
      (2 * groundH - event.y) * TERRAIN_CELL_SIZE,
      (event.z - 128) * TERRAIN_CELL_SIZE
    )

    const lightRange = 10 + scale * 20
    const light = new THREE.PointLight(0xff6600, 3 + scale * 4, lightRange)
    light.position.copy(particles.position)

    this.group.add(particles)
    this.group.add(light)

    this.active.push({
      particles,
      light,
      life: 0,
      maxLife: Math.floor(50 + scale * 40),
    })
  }

  update(): void {
    for (let i = this.active.length - 1; i >= 0; i--) {
      const exp = this.active[i]
      exp.life++

      const t = exp.life / exp.maxLife
      const geom = exp.particles.geometry
      const positions = geom.attributes.position as THREE.BufferAttribute
      const velocities = geom.attributes.velocity as THREE.BufferAttribute

      for (let j = 0; j < positions.count; j++) {
        positions.array[j * 3] += velocities.array[j * 3]
        positions.array[j * 3 + 1] += velocities.array[j * 3 + 1]
        positions.array[j * 3 + 2] += velocities.array[j * 3 + 2]
        velocities.array[j * 3 + 1] -= 0.004
      }
      positions.needsUpdate = true

      const mat = exp.particles.material as THREE.PointsMaterial
      mat.opacity = 1 - t
      exp.light.intensity = 5 * (1 - t)

      if (exp.life >= exp.maxLife) {
        this.group.remove(exp.particles)
        this.group.remove(exp.light)
        geom.dispose()
        mat.dispose()
        this.active.splice(i, 1)
      }
    }
  }

  dispose(): void {
    for (const exp of this.active) {
      exp.particles.geometry.dispose()
      ;(exp.particles.material as THREE.Material).dispose()
    }
  }
}
