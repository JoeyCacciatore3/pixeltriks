import * as THREE from 'three'
import { Sky } from 'three/examples/jsm/objects/Sky.js'

export class SkyRenderer {
  sky: Sky
  sunPosition: THREE.Vector3

  constructor(scene: THREE.Scene) {
    this.sky = new Sky()
    this.sky.scale.setScalar(450000)
    scene.add(this.sky)

    const uniforms = this.sky.material.uniforms
    uniforms['turbidity'].value = 2
    uniforms['rayleigh'].value = 3
    uniforms['mieCoefficient'].value = 0.003
    uniforms['mieDirectionalG'].value = 0.7

    this.sunPosition = new THREE.Vector3()
    const phi = THREE.MathUtils.degToRad(90 - 40)
    const theta = THREE.MathUtils.degToRad(200)
    this.sunPosition.setFromSphericalCoords(1, phi, theta)
    uniforms['sunPosition'].value.copy(this.sunPosition)
  }

  dispose(): void {
    this.sky.geometry.dispose()
    ;(this.sky.material as THREE.Material).dispose()
  }
}
