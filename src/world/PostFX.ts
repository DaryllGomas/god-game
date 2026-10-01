import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

/** Quality tiers: 'high' = AO + bloom + grade, 'medium' = bloom + grade, 'low' = grade only. */
export type FxQuality = 'high' | 'medium' | 'low';

// Tuning knobs.
const AO_RADIUS = 5; // world units
const AO_INTENSITY = 0.85; // blend strength (0 = none)
const BLOOM_STRENGTH = 0.32;
const BLOOM_RADIUS = 0.55;
const BLOOM_THRESHOLD = 1.05; // linear HDR, so only emissive things and sun glints bloom
const WARMTH = new THREE.Vector3(1.035, 1.0, 0.95); // multiplied into the linear colour
const SHADOW_TINT = new THREE.Vector3(0.012, 0.014, 0.03); // lifted, cool shadows
const SATURATION = 1.05;
const VIGNETTE = 0.22;

/** Warm grade + soft vignette, applied in linear HDR just before tone mapping. */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uWarmth: { value: WARMTH },
    uShadow: { value: SHADOW_TINT },
    uSaturation: { value: SATURATION },
    uVignette: { value: VIGNETTE },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec3 uWarmth;
    uniform vec3 uShadow;
    uniform float uSaturation;
    uniform float uVignette;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uWarmth;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation);
      col += uShadow * (1.0 - smoothstep(0.0, 0.5, l)); // cool lift in the darks
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 1.15)));
      col *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

interface GtaoInternals {
  _overrideVisibility(): void;
  _restoreVisibility(): void;
}

/**
 * Post-processing chain: scene -> soft ambient occlusion -> bloom -> warm grade/vignette
 * -> tone mapping + sRGB. Passes are enabled per quality tier; see FxQuality.
 */
export class PostFX {
  quality: FxQuality = 'high';
  private readonly composer: EffectComposer;
  private readonly ao: GTAOPass;
  private readonly bloom: UnrealBloomPass;
  private readonly grade: ShaderPass;
  private readonly hidden: THREE.Object3D[] = [];

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
    /** Objects that shouldn't contribute to ambient occlusion (grass, water, sky). The array may grow later. */
    private readonly aoIgnore: THREE.Object3D[],
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    const pr = renderer.getPixelRatio();
    // Multisampled HDR target so edges stay smooth without a separate AA pass.
    const target = new THREE.WebGLRenderTarget(size.x * pr, size.y * pr, { type: THREE.HalfFloatType, samples: 4 });
    this.composer = new EffectComposer(renderer, target);
    this.composer.setPixelRatio(pr);
    this.composer.setSize(size.x, size.y);

    this.composer.addPass(new RenderPass(scene, camera));

    this.ao = new GTAOPass(scene, camera, size.x, size.y);
    this.ao.output = GTAOPass.OUTPUT.Default;
    this.ao.blendIntensity = AO_INTENSITY;
    this.ao.updateGtaoMaterial({ radius: AO_RADIUS, distanceExponent: 1, thickness: 2, scale: 1, samples: 12, distanceFallOff: 1 });
    this.ao.updatePdMaterial({ lumaPhi: 10, depthPhi: 2, normalPhi: 3, radius: 6, rings: 2, samples: 12 });
    // Keep the pointless things (water, sky, grass) out of the AO depth/normal pre-pass.
    const a = this.ao as unknown as GtaoInternals;
    const base = a._overrideVisibility.bind(a);
    const restore = a._restoreVisibility.bind(a);
    a._overrideVisibility = () => {
      base();
      this.hidden.length = 0;
      for (const o of this.aoIgnore) {
        if (o.visible) {
          o.visible = false;
          this.hidden.push(o);
        }
      }
    };
    a._restoreVisibility = () => {
      restore();
      for (const o of this.hidden) o.visible = true;
    };
    this.composer.addPass(this.ao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.setQuality('high');
  }

  setQuality(q: FxQuality) {
    this.quality = q;
    this.ao.enabled = q === 'high';
    this.bloom.enabled = q === 'high' || q === 'medium';
  }

  /** Seasonal grade: warmth multiplier (linear rgb), saturation and vignette strength. */
  setGrade(warm: THREE.Vector3, saturation: number, vignette: number) {
    const u = this.grade.uniforms;
    (u.uWarmth.value as THREE.Vector3).copy(warm);
    u.uSaturation.value = saturation;
    u.uVignette.value = vignette;
  }

  resize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(deltaTime: number) {
    this.composer.render(deltaTime);
  }
}
