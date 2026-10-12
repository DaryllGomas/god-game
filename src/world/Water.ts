import * as THREE from 'three';
import { SEA_LEVEL, WORLD_SIZE } from '../config';
import { LOOK } from './lookKit';

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
          // Storyboard sea: turquoise shallows, a teal mid, a deep teal-navy far out (never royal blue).
          uShallow: { value: new THREE.Color(0x62dccb) },
          uMid: { value: new THREE.Color(0x1b8a9c) },
          uDeep: { value: new THREE.Color(0x0a3550) },
          uHorizon: { value: LOOK.horizonGold.clone() },
          uSunDir: { value: new THREE.Vector3(0.5, 0.8, 0.3) },
          uSunColor: { value: new THREE.Color(0xffffff) },
          uLight: { value: 1 },
          // The world's balance (see src/balance): xy = direction toward the rival's spire, z = how much the sea darkens there.
          uShade: { value: new THREE.Vector3(0, -1, 0) },
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
        uniform vec3 uMid;
        uniform vec3 uHorizon;
        uniform vec3 uSunDir;
        uniform vec3 uSunColor;
        uniform float uLight;
        uniform vec3 uShade;
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

          // Depth gradient: a turquoise ribbon hugging the shore, easing through teal into deep teal-navy.
          float dd = clamp(depth, 0.0, 40.0);
          vec3 col = mix(uShallow, uMid, smoothstep(0.3, 7.0, dd));
          col = mix(col, uDeep, smoothstep(5.0, 30.0, dd));
          // Slow broad patches of lighter and darker water so the open sea is never one flat tone.
          mat2 rot = mat2(0.8, -0.6, 0.6, 0.8);
          vec2 sq = rot * vWorld.xz;
          float swell = vnoise(sq * 0.016 + vec2(t * 0.012, 0.0)) * 0.45 + vnoise(rot * sq * 0.041 - vec2(0.0, t * 0.02)) * 0.35 + vnoise(sq * 0.11 + vec2(t * 0.05)) * 0.2;
          col *= 0.9 + 0.2 * swell;
          // Out of balance, the open sea on the rival's side turns dark and inky (never the shallows).
          if (uShade.z > 0.001) {
            float side = dot(normalize(vWorld.xz + 0.001), uShade.xy);
            float open = smoothstep(4.0, 20.0, depth) * smoothstep(150.0, 650.0, length(vWorld.xz));
            float k = uShade.z * open * smoothstep(-0.35, 0.85, side);
            col = mix(col, vec3(0.03, 0.025, 0.08), k * 0.85);
          }

          // Soft white foam where water meets sand and rock: a thin lapping line plus faint trailing bands.
          float lap = sin(depth * 2.6 - t * 1.3 + n1 * 3.5) * 0.5 + 0.5;
          float breakup = vnoise(vWorld.xz * 0.45 + vec2(t * 0.1, -t * 0.07));
          float foam = (1.0 - smoothstep(0.0, 2.4, depth)) * smoothstep(0.5, 1.0, lap + (breakup - 0.5) * 0.7) * 0.55;
          foam += (1.0 - smoothstep(0.0, 0.55 + 0.35 * breakup, depth)) * 0.95;
          col = mix(col, vec3(1.0, 0.98, 0.93), clamp(foam, 0.0, 1.0) * 0.8);

          // Lighting: diffuse-ish + sun glint.
          vec3 viewDir = normalize(cameraPosition - vWorld);
          vec3 halfV = normalize(uSunDir + viewDir);
          float spec = pow(max(dot(nrm, halfV), 0.0), 120.0) * 1.6;
          float fres = pow(1.0 - max(dot(viewDir, vec3(0.0, 1.0, 0.0)), 0.0), 3.0);
          col *= (0.12 + 0.88 * uLight);
          col += uSunColor * spec * (0.25 + 0.75 * uLight);
          // Golden-hour glints: tiny cells that twinkle slowly (well under 3 Hz), strongest toward the sun.
          vec2 gp = vWorld.xz * 0.55 + vec2(t * 0.12, -t * 0.08);
          vec2 gi = floor(gp); vec2 gf = fract(gp) - 0.5;
          float gh = hash(gi);
          float twinkle = pow(max(0.0, sin(t * (0.9 + gh * 1.1) + gh * 40.0)), 6.0);
          float gdot = smoothstep(0.26, 0.0, length(gf - (vec2(hash(gi + 7.3), hash(gi + 3.1)) - 0.5) * 0.5));
          float sp = gdot * twinkle * step(0.82, gh);
          float toward = pow(max(dot(reflect(-viewDir, nrm), uSunDir), 0.0), 3.0);
          col += uSunColor * (sp * (0.25 + 2.2 * toward) + 0.4 * toward * smoothstep(0.55, 0.9, n1)) * uLight * smoothstep(0.4, 3.0, depth);
          // Grazing angles pick up the warm peach of the sky.
          col = mix(col, uHorizon * (0.5 + 0.5 * uLight), fres * 0.38);

          // Clear in the shallows, fully opaque when deep so the sea floor's edge never shows.
          float alpha = mix(0.72, 1.0, smoothstep(0.0, 10.0, depth));
          if (!(col.r == col.r && col.g == col.g && col.b == col.b)) col = uMid;
          col = clamp(col, 0.0, 8.0);
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

  /** The world's balance: darken the open sea toward (dirX, dirZ) by `amount` 0..1. */
  setShade(dirX: number, dirZ: number, amount: number) {
    (this.material.uniforms.uShade.value as THREE.Vector3).set(dirX, dirZ, amount);
  }

  update(time: number, sunDir: THREE.Vector3, sunColor: THREE.Color, light: number) {
    const u = this.material.uniforms;
    u.uTime.value = time;
    u.uSunDir.value.copy(sunDir);
    u.uSunColor.value.copy(sunColor);
    u.uLight.value = light;
  }
}
