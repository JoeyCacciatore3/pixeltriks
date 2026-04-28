import * as THREE from 'three'
import { TERRAIN_SIZE, TERRAIN_CELL_SIZE } from '@shared/constants'

export class WaterRenderer {
  mesh: THREE.Mesh
  private material: THREE.ShaderMaterial

  constructor(scene: THREE.Scene) {
    const size = TERRAIN_SIZE * TERRAIN_CELL_SIZE
    const geom = new THREE.PlaneGeometry(size * 1.5, size * 1.5, 128, 128)
    geom.rotateX(-Math.PI / 2)

    this.material = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDeepColor: { value: new THREE.Color(0x061a2e) },
        uShallowColor: { value: new THREE.Color(0x1a7ab5) },
        uFoamColor: { value: new THREE.Color(0xddeeff) },
        uCameraPos: { value: new THREE.Vector3() },
      },
      vertexShader: `
        uniform float uTime;
        varying vec2 vUv;
        varying float vWave;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;
        void main() {
          vUv = uv;
          vec3 pos = position;
          float wave1 = sin(pos.x * 0.8 + uTime * 1.2) * 0.12;
          float wave2 = sin(pos.z * 1.1 - uTime * 0.9) * 0.08;
          float wave3 = sin((pos.x + pos.z) * 0.5 + uTime * 1.6) * 0.06;
          float wave4 = sin(pos.x * 2.3 - pos.z * 1.7 + uTime * 2.1) * 0.03;
          pos.y += wave1 + wave2 + wave3 + wave4;
          vWave = wave1 + wave2 + wave3 + wave4;
          vec4 worldPos = modelMatrix * vec4(pos, 1.0);
          vWorldPos = worldPos.xyz;
          vWorldNormal = normalize(mat3(modelMatrix) * vec3(0.0, 1.0, 0.0));
          gl_Position = projectionMatrix * viewMatrix * worldPos;
        }
      `,
      fragmentShader: `
        uniform vec3 uDeepColor;
        uniform vec3 uShallowColor;
        uniform vec3 uFoamColor;
        uniform float uTime;
        uniform vec3 uCameraPos;
        varying vec2 vUv;
        varying float vWave;
        varying vec3 vWorldPos;
        varying vec3 vWorldNormal;

        float causticPattern(vec2 p, float t) {
          float v1 = sin(p.x * 8.0 + t * 1.5) * sin(p.y * 6.0 - t * 1.2);
          float v2 = sin((p.x + p.y) * 5.0 + t * 0.8);
          float v3 = sin(length(p) * 12.0 - t * 2.0);
          return (v1 + v2 + v3) * 0.33;
        }

        void main() {
          // Fresnel: more opaque at glancing angles
          vec3 viewDir = normalize(uCameraPos - vWorldPos);
          float fresnel = 1.0 - max(dot(viewDir, vWorldNormal), 0.0);
          fresnel = pow(fresnel, 3.0);

          // Depth-like factor from distance to center (approximates shore proximity)
          float distFromCenter = length(vWorldPos.xz) / 60.0;
          float shoreFactor = smoothstep(0.6, 1.0, distFromCenter);

          // Shore foam bands
          float foamLine1 = smoothstep(0.02, 0.0, abs(sin(distFromCenter * 25.0 + uTime * 0.8) - 0.7));
          float foamLine2 = smoothstep(0.03, 0.0, abs(sin(distFromCenter * 18.0 - uTime * 0.5) - 0.8));
          float shoreFoam = (foamLine1 + foamLine2) * shoreFactor;

          // Wave peak foam
          float waveFoam = smoothstep(0.15, 0.22, vWave);

          // Color mixing
          float depthMix = smoothstep(-0.08, 0.15, vWave) + fresnel * 0.3;
          vec3 col = mix(uDeepColor, uShallowColor, clamp(depthMix, 0.0, 1.0));

          // Caustics
          float caustic = causticPattern(vWorldPos.xz * 0.05, uTime);
          col += vec3(0.02, 0.04, 0.06) * max(caustic, 0.0);

          // Apply foam
          float totalFoam = clamp(waveFoam + shoreFoam * 0.6, 0.0, 1.0);
          col = mix(col, uFoamColor, totalFoam * 0.5);

          // Shimmer
          float shimmer = sin(vUv.x * 60.0 + uTime * 3.0) * sin(vUv.y * 60.0 - uTime * 2.5);
          col += vec3(shimmer * 0.015);

          // Fresnel-based opacity
          float alpha = 0.55 + fresnel * 0.35;

          gl_FragColor = vec4(col, alpha);
        }
      `,
      transparent: true,
      side: THREE.DoubleSide,
      depthWrite: false,
    })

    this.mesh = new THREE.Mesh(geom, this.material)
    scene.add(this.mesh)
  }

  update(waterLevel: number, time: number, camera?: THREE.Camera): void {
    this.mesh.position.y = waterLevel * TERRAIN_CELL_SIZE
    this.material.uniforms.uTime.value = time
    if (camera) {
      this.material.uniforms.uCameraPos.value.copy(camera.position)
    }
  }

  dispose(): void {
    this.mesh.geometry.dispose()
    this.material.dispose()
  }
}
