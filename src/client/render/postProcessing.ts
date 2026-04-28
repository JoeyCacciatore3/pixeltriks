import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    darkness: { value: 0.35 },
    offset: { value: 0.92 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() {
      vUv = uv;
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float darkness;
    uniform float offset;
    varying vec2 vUv;
    void main() {
      vec4 texel = texture2D(tDiffuse, vUv);
      vec2 center = vUv - 0.5;
      float dist = length(center);
      float vignette = smoothstep(offset, offset - 0.45, dist);
      texel.rgb *= mix(1.0 - darkness, 1.0, vignette);
      gl_FragColor = texel;
    }
  `,
}

export class PostProcessing {
  composer: EffectComposer
  private bloomPass: UnrealBloomPass

  constructor(
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.PerspectiveCamera
  ) {
    this.composer = new EffectComposer(renderer)

    const renderPass = new RenderPass(scene, camera)
    this.composer.addPass(renderPass)

    this.bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      0.3, 0.5, 0.88
    )
    this.composer.addPass(this.bloomPass)

    const vignettePass = new ShaderPass(VignetteShader)
    this.composer.addPass(vignettePass)

    const outputPass = new OutputPass()
    this.composer.addPass(outputPass)
  }

  resize(width: number, height: number): void {
    this.composer.setSize(width, height)
  }

  render(): void {
    this.composer.render()
  }

  dispose(): void {
    this.composer.dispose()
  }
}
