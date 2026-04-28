import * as THREE from 'three'
import type { Character } from '@shared/types'
import { TERRAIN_CELL_SIZE, TEAM_HUMAN } from '@shared/constants'
import { getHeight } from '@sim/terrain'

const HUMAN_COLOR = 0x3388ff
const AI_COLOR = 0xff3333
const DEAD_COLOR = 0x555555

export class CharacterRenderer {
  private group: THREE.Group
  private meshes: Map<number, THREE.Group> = new Map()
  private hpBars: Map<number, THREE.Mesh> = new Map()
  private indicator: THREE.Mesh
  private charAzimuths: Map<number, number> = new Map()

  constructor(scene: THREE.Scene) {
    this.group = new THREE.Group()
    scene.add(this.group)

    const coneGeom = new THREE.ConeGeometry(0.35, 0.7, 6)
    coneGeom.rotateX(Math.PI)
    const coneMat = new THREE.MeshBasicMaterial({ color: 0xffff00 })
    this.indicator = new THREE.Mesh(coneGeom, coneMat)
    this.indicator.visible = false
    scene.add(this.indicator)
  }

  update(characters: Character[], activeCharId: number, heightmap: Float32Array, time: number): void {
    for (const char of characters) {
      let charGroup = this.meshes.get(char.id)

      if (!charGroup) {
        charGroup = this.createCharacterMesh(char)
        this.meshes.set(char.id, charGroup)
        this.group.add(charGroup)
      }

      const groundH = getHeight(heightmap, char.x, char.z)
      const posY = (2 * groundH - char.y) * TERRAIN_CELL_SIZE + 1
      charGroup.position.set(
        (char.x - 128) * TERRAIN_CELL_SIZE,
        posY,
        (char.z - 128) * TERRAIN_CELL_SIZE
      )

      charGroup.visible = char.alive
      const az = this.charAzimuths.get(char.id) ?? (char.facing > 0 ? 0 : Math.PI)
      charGroup.rotation.y = -az

      const hpBar = this.hpBars.get(char.id)
      if (hpBar) {
        hpBar.scale.x = Math.max(0, char.hp / 100)
        const mat = hpBar.material as THREE.MeshBasicMaterial
        mat.color.setHex(char.hp > 50 ? 0x00ff00 : char.hp > 25 ? 0xffaa00 : 0xff0000)
      }

      if (!char.alive) {
        charGroup.traverse(child => {
          if (child instanceof THREE.Mesh) {
            const mat = child.material as THREE.MeshStandardMaterial
            if (mat.emissive) mat.color.setHex(DEAD_COLOR)
          }
        })
      }

      if (char.id === activeCharId && char.alive) {
        const bob = Math.sin(time * 3) * 0.3
        this.indicator.visible = true
        this.indicator.position.set(
          (char.x - 128) * TERRAIN_CELL_SIZE,
          posY + 3.5 + bob,
          (char.z - 128) * TERRAIN_CELL_SIZE
        )
      }
    }
  }

  setAzimuth(charId: number, azimuth: number): void {
    this.charAzimuths.set(charId, azimuth)
  }

  hideIndicator(): void {
    this.indicator.visible = false
  }

  private createCharacterMesh(char: Character): THREE.Group {
    const group = new THREE.Group()
    const isHuman = char.team === TEAM_HUMAN
    const color = isHuman ? HUMAN_COLOR : AI_COLOR

    if (isHuman) {
      this.buildHumanMesh(group, color)
    } else {
      this.buildAIMesh(group, color)
    }

    group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.castShadow = true
        child.receiveShadow = true
      }
    })

    const hpGeom = new THREE.PlaneGeometry(1.5, 0.15)
    const hpMat = new THREE.MeshBasicMaterial({ color: 0x00ff00, side: THREE.DoubleSide })
    const hpBar = new THREE.Mesh(hpGeom, hpMat)
    hpBar.position.y = 2.8
    hpBar.lookAt(new THREE.Vector3(0, 100, 100))
    group.add(hpBar)
    this.hpBars.set(char.id, hpBar)

    return group
  }

  private buildHumanMesh(group: THREE.Group, color: number): void {
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.1 })

    const body = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.4, 0.8, 4, 8),
      bodyMat
    )
    body.position.y = 1
    group.add(body)

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xffcc99, roughness: 0.7 })
    )
    head.position.y = 2
    group.add(head)

    const legMat = new THREE.MeshStandardMaterial({ color: 0x334455, roughness: 0.8 })
    for (const side of [-0.2, 0.2]) {
      const leg = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.12, 0.5, 3, 6),
        legMat
      )
      leg.position.set(side, 0.25, 0)
      group.add(leg)
    }

    const armMat = new THREE.MeshStandardMaterial({ color, roughness: 0.6 })
    for (const side of [-0.55, 0.55]) {
      const arm = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.1, 0.4, 3, 6),
        armMat
      )
      arm.position.set(side, 1.2, 0)
      group.add(arm)
    }
  }

  private buildAIMesh(group: THREE.Group, color: number): void {
    const bodyMat = new THREE.MeshStandardMaterial({
      color, roughness: 0.3, metalness: 0.8
    })

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1, 0.6),
      bodyMat
    )
    body.position.y = 1
    group.add(body)

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.6, 0.5, 0.5),
      new THREE.MeshStandardMaterial({
        color: 0x222222, roughness: 0.2, metalness: 0.9
      })
    )
    head.position.y = 1.85
    group.add(head)

    const eyeMat = new THREE.MeshBasicMaterial({ color: 0xff0000 })
    for (const side of [-0.15, 0.15]) {
      const eye = new THREE.Mesh(
        new THREE.SphereGeometry(0.06, 6, 4),
        eyeMat
      )
      eye.position.set(side, 1.9, 0.26)
      group.add(eye)
    }

    const legMat = new THREE.MeshStandardMaterial({ color: 0x444444, metalness: 0.7 })
    for (const side of [-0.25, 0.25]) {
      const leg = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.12, 0.6, 6),
        legMat
      )
      leg.position.set(side, 0.25, 0)
      group.add(leg)
    }

    const antenna = new THREE.Mesh(
      new THREE.CylinderGeometry(0.02, 0.02, 0.4, 4),
      new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.9 })
    )
    antenna.position.set(0, 2.3, 0)
    group.add(antenna)

    const antennaTip = new THREE.Mesh(
      new THREE.SphereGeometry(0.05, 6, 4),
      new THREE.MeshBasicMaterial({ color: 0xff4444 })
    )
    antennaTip.position.set(0, 2.5, 0)
    group.add(antennaTip)
  }

  dispose(): void {
    this.group.traverse(child => {
      if (child instanceof THREE.Mesh) {
        child.geometry.dispose()
        if (child.material instanceof THREE.Material) {
          child.material.dispose()
        }
      }
    })
  }
}
