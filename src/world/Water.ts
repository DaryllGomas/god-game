import * as THREE from 'three';
import { SEA_LEVEL, WORLD_SIZE } from '../config';

/** Stylised sea: depth-tinted, foamy shoreline, gentle animated ripples. */
export class Water {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.ShaderMaterial;

  constructor(heightTexture: THREE.Texture) {
    const geo = new THREE.PlaneGeometry(6000, 6000, 1, 1);
    geo.rotateX(-Math.PI / 2);

    this.material = new THREE.ShaderMaterial({
      transparent: true,
      fog: true,
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTime: { value: 0 },
          uHeight: { value: null },
          uWorldSize: { value: WORLD_SIZE },
          uShallow: { value: new THREE.Color(0x3fc1c9) },
          uDeep: { value: new THREE.Color(0x0e3f73) },
          uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
          uSunColor: { value: new THREE.Color(0xffffff) },
          uLight: { value: 1 },
        },
      ]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        varying vec3 vWorld;
        void main() {
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vWorld = wp.xyz;
          vec4 mvPosition = viewMatrix * wp;
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        uniform float uTime;
        uniform sampler2D uHeight;
        uniform float uWorldSize;
        uniform vec3 uShallow;
        uniform vec3 uDeep;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uLight;
        varying vec3 vWorld;

        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float vnoise(vec2 p) {
          vec2 i = floor(p); vec2 f = fract(p);
          vec2 u = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x), mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
        }

        void main() {
          vec2 uv = vWorld.xz / uWorldSize + 0.5;
          float h = -32.0;
          if (uv.x > 0.0 && uv.x < 1.0 && uv.y > 0.0 && uv.y < 1.0) {
            h = texture2D(uHeight, uv).r * 64.0 - 32.0;
          }
          float depth = max(0.0, -h);
          float t = uTime;

          // Ripple normal from two scrolling noise layers.
          vec2 p = vWorld.xz * 0.08;
          float n1 = vnoise(p + vec2(t * 0.35, t * 0.2));
          float n2 = vnoise(p * 2.3 - vec2(t * 0.25, -t * 0.3));
          vec3 nrm = normalize(vec3((n1 - 0.5) * 0.35 + (n2 - 0.5) * 0.2, 1.0, (n2 - 0.5) * 0.35));

          vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 14.0, depth));

          // Shoreline foam bands.
          float band = sin(depth * 2.2 - t * 1.6 + n1 * 3.0) * 0.5 + 0.5;
          float foam = (1.0 - smoothstep(0.0, 2.6, depth)) * smoothstep(0.42, 1.0, band + n2 * 0.3) * 0.8;
          foam += (1.0 - smoothstep(0.0, 0.9, depth)) * 0.9;
          col = mix(col, vec3(0.95, 0.98, 1.0), clamp(foam, 0.0, 1.0) * 0.7);

          // Lighting: diffuse-ish + sun glint.
          vec3 viewDir = normalize(cameraPosition - vWorld);
          vec3 halfV = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(nrm, halfV), 0.0), 120.0) * 1.6;
          float fres = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
          col *= (0.12 + 0.88 * uLight);
          col += uSunColor * spec * (0.25 + 0.75 * uLight);
          // Gentle sparkle: small drifting glints, strongest where the sky's sun reflects toward the eye.
          float sp = vnoise(vWorld.xz * 1.7 + vec2(t * 0.6, -t * 0.4)) * 0.5 + vnoise(vWorld.xz * 2.9 - vec2(t * 0.5, t * 0.7)) * 0.5;
          float toward = pow(max(dot(reflect(-viewDir, nrm), uSunDir), 0.0), 6.0);
          col += uSunColor * smoothstep(0.62, 0.88, sp) * toward * 0.55 * uLight * smoothstep(0.5, 4.0, depth);
          col = mix(col, col + vec3(0.15, 0.2, 0.25) * uLight, fres * 0.5);

          // Clear in the shallows, fully opaque when deep so the sea floor's edge never shows.
          float alpha = mix(0.72, 1.0, smoothstep(0.0, 10.0, depth));
          gl_FragColor = vec4(col, alpha);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    this.material.uniforms.uHeight.value = heightTexture;

    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.position.y = SEA_LEVEL;
    this.mesh.renderOrder = 1;
    this.mesh.name = 'water';
  }

  update(time: number, sunDir: THREE.Vector3, sunColor: THREE.Color, light: number) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor);
    u.uLight.value = light;
  }
}
