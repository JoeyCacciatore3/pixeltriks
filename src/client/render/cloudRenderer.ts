import * as THREE from 'three'

const MAX_CLOUDS = 15

function createCloudGeometry(): THREE.BufferGeometry {
  const merged: THREE.BufferGeometry[] = []

  // 3-5 spheres merged into a cloud puff
  const puffCount = 3 + Math.floor(Math.random() * 3)
  for (let i = 0; i < puffCount; i++) {
    const radius = 1.0 + Math.random() * 1.5
    const sphere = new THREE.SphereGeometry(radius, 5, 4)
    sphere.translate(
      (Math.random() - 0.5) * 3,
      (Math.random() - 0.5) * 0.8,
      (Math.random() - 0.5) * 2
    )

    // Jitter vertices
    const pos = sphere.attributes.position
    for (let v = 0; v < pos.count; v++) {
      pos.setX(v, pos.getX(v) + (Math.random() - 0.5) * 0.3)
      pos.setY(v, pos.getY(v) + (Math.random() - 0.5) * 0.2)
      pos.setZ(v, pos.getZ(v) + (Math.random() - 0.5) * 0.3)
    }

    // Flat bottom: chop anything below -0.5
    for (let v = 0; v < pos.count; v++) {
      if (pos.getY(v) < -0.4) pos.setY(v, -0.4)
    }

    // Vertex colors: white to light grey
    const colors = new Float32Array(pos.count * 3)
    for (let v = 0; v < pos.count; v++) {
      const bright = 0.85 + Math.random() * 0.15
      const y = pos.getY(v)
      const shadow = y < 0 ? 0.08 : 0
      colors[v * 3] = bright - shadow
      colors[v * 3 + 1] = bright - shadow
      colors[v * 3 + 2] = bright - shadow * 0.5
    }
    sphere.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    merged.push(sphere)
  }

  // Merge all spheres
  let totalVerts = 0
  let totalIdx = 0
  for (const g of merged) {
    totalVerts += g.attributes.position.count
    totalIdx += (g.index ? g.index.count : g.attributes.position.count)
  }
  const positions = new Float32Array(totalVerts * 3)
  const colors = new Float32Array(totalVerts * 3)
  const indices = new Uint16Array(totalIdx)
  let vOff = 0, iOff = 0
  for (const g of merged) {
    const p = g.attributes.position
    const c = g.attributes.color
    for (let i = 0; i < p.count; i++) {
      positions[(vOff + i) * 3] = p.getX(i)
      positions[(vOff + i) * 3 + 1] = p.getY(i)
      positions[(vOff + i) * 3 + 2] = p.getZ(i)
      if (c) {
        colors[(vOff + i) * 3] = c.getX(i)
        colors[(vOff + i) * 3 + 1] = c.getY(i)
        colors[(vOff + i) * 3 + 2] = c.getZ(i)
      }
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices[iOff + i] = g.index.array[i] + vOff
      }
      iOff += g.index.count
    }
    vOff += p.count
  }

  const geo = new THREE.BufferGeometry()
  geo.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.setIndex(new THREE.BufferAttribute(indices, 1))
  geo.computeVertexNormals()
  return geo
}

export class CloudRenderer {
  private clouds: THREE.InstancedMesh
  private offsets: Float32Array

  constructor(scene: THREE.Scene) {
    const mat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
      transparent: true,
      opacity: 0.85,
    })

    const geo = createCloudGeometry()
    this.clouds = new THREE.InstancedMesh(geo, mat, MAX_CLOUDS)
    this.clouds.count = MAX_CLOUDS
    this.offsets = new Float32Array(MAX_CLOUDS)

    const dummy = new THREE.Object3D()
    for (let i = 0; i < MAX_CLOUDS; i++) {
      const x = (Math.random() - 0.5) * 120
      const y = 35 + Math.random() * 15
      const z = (Math.random() - 0.5) * 120
      dummy.position.set(x, y, z)
      const scale = 1.5 + Math.random() * 2.5
      dummy.scale.set(scale, scale * (0.4 + Math.random() * 0.3), scale)
      dummy.rotation.y = Math.random() * Math.PI * 2
      dummy.updateMatrix()
      this.clouds.setMatrixAt(i, dummy.matrix)
      this.offsets[i] = x
    }
    this.clouds.instanceMatrix.needsUpdate = true
    scene.add(this.clouds)
  }

  update(time: number): void {
    const dummy = new THREE.Object3D()
    const matrix = new THREE.Matrix4()
    const pos = new THREE.Vector3()
    const quat = new THREE.Quaternion()
    const scl = new THREE.Vector3()

    for (let i = 0; i < MAX_CLOUDS; i++) {
      this.clouds.getMatrixAt(i, matrix)
      matrix.decompose(pos, quat, scl)
      pos.x = this.offsets[i] + Math.sin(time * 0.02 + i) * 5 + time * 0.3
      // Wrap clouds
      if (pos.x > 80) {
        pos.x -= 160
        this.offsets[i] -= 160
      }
      dummy.position.copy(pos)
      dummy.quaternion.copy(quat)
      dummy.scale.copy(scl)
      dummy.updateMatrix()
      this.clouds.setMatrixAt(i, dummy.matrix)
    }
    this.clouds.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.clouds.geometry.dispose()
    ;(this.clouds.material as THREE.Material).dispose()
  }
}
