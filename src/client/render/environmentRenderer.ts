import * as THREE from 'three'
import { TERRAIN_SIZE, TERRAIN_CELL_SIZE } from '@shared/constants'
import { getHeight } from '@sim/terrain'

const MAX_TREES = 120
const MAX_ROCKS = 60
const MAX_GRASS = 300

function seededRandom(seed: number): () => number {
  let s = seed | 0
  return () => {
    s = (s * 1664525 + 1013904223) | 0
    return (s >>> 0) / 4294967296
  }
}

function createTreeGeometry(): THREE.BufferGeometry {
  const merged = new THREE.BufferGeometry()
  const geos: THREE.BufferGeometry[] = []

  // Trunk
  const trunk = new THREE.CylinderGeometry(0.12, 0.18, 1.2, 5)
  trunk.translate(0, 0.6, 0)
  const trunkColors = new Float32Array(trunk.attributes.position.count * 3)
  for (let i = 0; i < trunk.attributes.position.count; i++) {
    trunkColors[i * 3] = 0.35 + Math.random() * 0.05
    trunkColors[i * 3 + 1] = 0.22 + Math.random() * 0.04
    trunkColors[i * 3 + 2] = 0.1
  }
  trunk.setAttribute('color', new THREE.BufferAttribute(trunkColors, 3))
  geos.push(trunk)

  // 3 cone layers
  const layers = [
    { radius: 0.9, height: 1.4, y: 1.8 },
    { radius: 0.7, height: 1.2, y: 2.6 },
    { radius: 0.45, height: 1.0, y: 3.2 },
  ]
  for (const l of layers) {
    const cone = new THREE.ConeGeometry(l.radius, l.height, 6)
    cone.translate(0, l.y, 0)
    // Jitter vertices for organic look
    const pos = cone.attributes.position
    for (let i = 0; i < pos.count; i++) {
      pos.setX(i, pos.getX(i) + (Math.random() - 0.5) * 0.12)
      pos.setZ(i, pos.getZ(i) + (Math.random() - 0.5) * 0.12)
    }
    const colors = new Float32Array(pos.count * 3)
    for (let i = 0; i < pos.count; i++) {
      const darkFactor = pos.getY(i) / 4.5
      colors[i * 3] = 0.1 + darkFactor * 0.12
      colors[i * 3 + 1] = 0.28 + darkFactor * 0.2 + Math.random() * 0.06
      colors[i * 3 + 2] = 0.08 + darkFactor * 0.05
    }
    cone.setAttribute('color', new THREE.BufferAttribute(colors, 3))
    geos.push(cone)
  }

  const arrays = mergeBufferGeometries(geos)
  merged.setAttribute('position', new THREE.BufferAttribute(arrays.positions, 3))
  merged.setAttribute('color', new THREE.BufferAttribute(arrays.colors, 3))
  merged.setIndex(new THREE.BufferAttribute(arrays.indices, 1))
  merged.computeVertexNormals()
  return merged
}

function createRockGeometry(): THREE.BufferGeometry {
  const geo = new THREE.IcosahedronGeometry(0.5, 0)
  const pos = geo.attributes.position
  for (let i = 0; i < pos.count; i++) {
    pos.setX(i, pos.getX(i) * (0.7 + Math.random() * 0.6))
    pos.setY(i, pos.getY(i) * (0.5 + Math.random() * 0.5))
    pos.setZ(i, pos.getZ(i) * (0.7 + Math.random() * 0.6))
  }
  const colors = new Float32Array(pos.count * 3)
  for (let i = 0; i < pos.count; i++) {
    const y = pos.getY(i)
    const mossFactor = y > 0.1 ? 0.15 : 0
    colors[i * 3] = 0.38 + Math.random() * 0.08 - mossFactor * 0.1
    colors[i * 3 + 1] = 0.36 + Math.random() * 0.06 + mossFactor
    colors[i * 3 + 2] = 0.32 + Math.random() * 0.06
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geo.computeVertexNormals()
  return geo
}

function createGrassGeometry(): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry()
  const bladeCount = 3
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  let vertIdx = 0

  for (let b = 0; b < bladeCount; b++) {
    const angle = (b / bladeCount) * Math.PI + Math.random() * 0.3
    const cos = Math.cos(angle) * 0.08
    const sin = Math.sin(angle) * 0.08
    const h = 0.3 + Math.random() * 0.25

    positions.push(-cos, 0, -sin)
    positions.push(cos, 0, sin)
    positions.push(0, h, 0)

    const g = 0.3 + Math.random() * 0.15
    colors.push(0.18, g, 0.1)
    colors.push(0.18, g, 0.1)
    colors.push(0.25, g + 0.15, 0.12)

    indices.push(vertIdx, vertIdx + 1, vertIdx + 2)
    vertIdx += 3
  }

  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3))
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3))
  geo.setIndex(indices)
  geo.computeVertexNormals()
  return geo
}

function mergeBufferGeometries(geos: THREE.BufferGeometry[]) {
  let totalVerts = 0
  let totalIdx = 0
  for (const g of geos) {
    totalVerts += g.attributes.position.count
    totalIdx += (g.index ? g.index.count : g.attributes.position.count)
  }
  const positions = new Float32Array(totalVerts * 3)
  const colors = new Float32Array(totalVerts * 3)
  const indices = new Uint16Array(totalIdx)
  let vertOff = 0
  let idxOff = 0
  for (const g of geos) {
    const pos = g.attributes.position
    const col = g.attributes.color
    for (let i = 0; i < pos.count; i++) {
      positions[(vertOff + i) * 3] = pos.getX(i)
      positions[(vertOff + i) * 3 + 1] = pos.getY(i)
      positions[(vertOff + i) * 3 + 2] = pos.getZ(i)
      if (col) {
        colors[(vertOff + i) * 3] = col.getX(i)
        colors[(vertOff + i) * 3 + 1] = col.getY(i)
        colors[(vertOff + i) * 3 + 2] = col.getZ(i)
      }
    }
    if (g.index) {
      for (let i = 0; i < g.index.count; i++) {
        indices[idxOff + i] = g.index.array[i] + vertOff
      }
      idxOff += g.index.count
    } else {
      for (let i = 0; i < pos.count; i++) {
        indices[idxOff + i] = vertOff + i
      }
      idxOff += pos.count
    }
    vertOff += pos.count
  }
  return { positions, colors, indices }
}

export class EnvironmentRenderer {
  private trees: THREE.InstancedMesh
  private rocks: THREE.InstancedMesh
  private grass: THREE.InstancedMesh
  private lastVersion = -1

  constructor(private scene: THREE.Scene) {
    const treeMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
    })
    this.trees = new THREE.InstancedMesh(createTreeGeometry(), treeMat, MAX_TREES)
    this.trees.castShadow = true
    this.trees.receiveShadow = true
    this.trees.count = 0
    scene.add(this.trees)

    const rockMat = new THREE.MeshStandardMaterial({
      vertexColors: true,
      flatShading: true,
    })
    this.rocks = new THREE.InstancedMesh(createRockGeometry(), rockMat, MAX_ROCKS)
    this.rocks.castShadow = true
    this.rocks.receiveShadow = true
    this.rocks.count = 0
    scene.add(this.rocks)

    const grassMat = new THREE.MeshBasicMaterial({
      vertexColors: true,
      side: THREE.DoubleSide,
    })
    this.grass = new THREE.InstancedMesh(createGrassGeometry(), grassMat, MAX_GRASS)
    this.grass.count = 0
    scene.add(this.grass)
  }

  update(heightmap: Float32Array, version: number): void {
    if (version === this.lastVersion) return
    this.lastVersion = version

    const rng = seededRandom(42 + version)
    const dummy = new THREE.Object3D()
    let treeIdx = 0
    let rockIdx = 0
    let grassIdx = 0

    for (let attempt = 0; attempt < 2000 && (treeIdx < MAX_TREES || rockIdx < MAX_ROCKS || grassIdx < MAX_GRASS); attempt++) {
      const sx = 8 + rng() * (TERRAIN_SIZE - 16)
      const sz = 8 + rng() * (TERRAIN_SIZE - 16)
      const h = getHeight(heightmap, sx, sz)
      const n = h / 40

      // Compute slope
      const ixL = Math.max(0, Math.floor(sx) - 1)
      const ixR = Math.min(TERRAIN_SIZE - 1, Math.floor(sx) + 1)
      const izU = Math.max(0, Math.floor(sz) - 1)
      const izD = Math.min(TERRAIN_SIZE - 1, Math.floor(sz) + 1)
      const dx = getHeight(heightmap, ixR, sz) - getHeight(heightmap, ixL, sz)
      const dz = getHeight(heightmap, sx, izD) - getHeight(heightmap, sx, izU)
      const slope = Math.sqrt(dx * dx + dz * dz)

      const wx = (sx - 128) * TERRAIN_CELL_SIZE
      const wy = h * TERRAIN_CELL_SIZE
      const wz = (sz - 128) * TERRAIN_CELL_SIZE

      // Trees: grass/forest band, flat ground
      if (treeIdx < MAX_TREES && n > 0.45 && n < 0.78 && slope < 2.5 && rng() < 0.35) {
        dummy.position.set(wx, wy, wz)
        const scale = 0.6 + rng() * 0.8
        dummy.scale.set(scale, scale * (0.8 + rng() * 0.4), scale)
        dummy.rotation.y = rng() * Math.PI * 2
        dummy.updateMatrix()
        this.trees.setMatrixAt(treeIdx++, dummy.matrix)
      }

      // Rocks: steep slopes, alpine, shoreline
      if (rockIdx < MAX_ROCKS && ((slope > 2.0 && rng() < 0.4) || (n > 0.7 && n < 0.9 && rng() < 0.25) || (n < 0.12 && n > 0.05 && rng() < 0.3))) {
        dummy.position.set(wx, wy, wz)
        const scale = 0.4 + rng() * 1.0
        dummy.scale.set(scale * (0.8 + rng() * 0.4), scale * (0.5 + rng() * 0.5), scale * (0.8 + rng() * 0.4))
        dummy.rotation.set(rng() * 0.4, rng() * Math.PI * 2, rng() * 0.4)
        dummy.updateMatrix()
        this.rocks.setMatrixAt(rockIdx++, dummy.matrix)
      }

      // Grass: lush grass band only
      if (grassIdx < MAX_GRASS && n > 0.40 && n < 0.60 && slope < 1.5 && rng() < 0.5) {
        dummy.position.set(wx, wy + 0.01, wz)
        const scale = 0.8 + rng() * 1.2
        dummy.scale.set(scale, scale, scale)
        dummy.rotation.y = rng() * Math.PI * 2
        dummy.updateMatrix()
        this.grass.setMatrixAt(grassIdx++, dummy.matrix)
      }
    }

    this.trees.count = treeIdx
    this.rocks.count = rockIdx
    this.grass.count = grassIdx
    this.trees.instanceMatrix.needsUpdate = true
    this.rocks.instanceMatrix.needsUpdate = true
    this.grass.instanceMatrix.needsUpdate = true
  }

  dispose(): void {
    this.trees.geometry.dispose()
    ;(this.trees.material as THREE.Material).dispose()
    this.rocks.geometry.dispose()
    ;(this.rocks.material as THREE.Material).dispose()
    this.grass.geometry.dispose()
    ;(this.grass.material as THREE.Material).dispose()
    this.scene.remove(this.trees, this.rocks, this.grass)
  }
}
