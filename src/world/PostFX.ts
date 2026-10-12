import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { LOOK } from './lookKit';

/** Quality tiers: 'high' = AO + bloom + grade, 'medium' = bloom + grade, 'low' = grade only. */
export type FxQuality = 'high' | 'medium' | 'low';

// Tuning knobs live in the studio look kit (./lookKit).
const AO_RADIUS = LOOK.aoRadius; // world units
const AO_INTENSITY = LOOK.aoIntensity; // blend strength (0 = none)
const BLOOM_STRENGTH = LOOK.bloomStrength;
const BLOOM_RADIUS = LOOK.bloomRadius;
const BLOOM_THRESHOLD = LOOK.bloomThreshold; // linear HDR, so only emissive things and sun glints bloom
const WARMTH = LOOK.warmth.clone(); // multiplied into the linear colour
const SHADOW_TINT = new THREE.Vector3(0.012, 0.014, 0.03); // lifted, cool shadows
const SATURATION = LOOK.saturation;
const VIGNETTE = LOOK.vignette;

/**
 * Tilt-shift depth of field (miniature look): sharp band at the focus row, soft above and below. Screen-space and
 * depth-free, so it works at every quality tier. Golden-angle gather; each tap is weighted by its own blur so the
 * sharp band never bleeds into the soft areas.
 */
const TiltShader = {
  name: 'TiltShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uRes: { value: new THREE.Vector2(1920, 1080) },
    uFocusY: { value: 0.5 },
    uMaxR: { value: 0 }, // px
    uBand: { value: LOOK.dofBand },
    uFull: { value: LOOK.dofFull },
    uUpper: { value: LOOK.dofUpperScale },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform vec2 uRes;
    uniform float uFocusY, uMaxR, uBand, uFull, uUpper;
    varying vec2 vUv;
    float coc(float y) {
      float d = y - uFocusY;
      float k = smoothstep(uBand, uFull, abs(d));
      return k * (d > 0.0 ? uUpper : 1.0); // 0..1
    }
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      float cs = coc(vUv.y) * uMaxR;
      if (uMaxR < 0.5 || cs < 0.35) { gl_FragColor = c; return; }
      vec3 acc = c.rgb; float tot = 1.0;
      const int N = 40;
      for (int i = 1; i < N; i++) {
        float f = float(i) / float(N);
        float r = sqrt(f) * cs;
        float a = float(i) * 2.39996323;
        vec2 o = vec2(cos(a), sin(a)) * r / uRes;
        vec2 uv = vUv + o;
        float ss = coc(uv.y) * uMaxR;
        float w = smoothstep(r - 1.0, r + 1.0, max(ss, 0.0)) ;
        vec3 s = texture2D(tDiffuse, uv).rgb;
        s = min(s, vec3(8.0)); // keep a hot highlight from flaring the whole disc
        acc += s * w; tot += w;
      }
      gl_FragColor = vec4(acc / tot, c.a);
    }
  `,
};

/** Warm grade + soft vignette, applied in linear HDR just before tone mapping. */
const GradeShader = {
  name: 'GradeShader',
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uWarmth: { value: WARMTH },
    uShadow: { value: SHADOW_TINT },
    uSaturation: { value: SATURATION },
    uVignette: { value: VIGNETTE },
    // The world's balance (see src/balance), on top of the seasonal grade: saturation scale and a colour cast.
    uBalSat: { value: 1 },
    uBalTint: { value: new THREE.Vector3(1, 1, 1) },
    uTintShadow: { value: LOOK.tintShadow },
    uTintHigh: { value: LOOK.tintHigh },
    uContrast: { value: LOOK.contrast },
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
    uniform float uBalSat;
    uniform vec3 uBalTint;
    uniform vec3 uTintShadow, uTintHigh;
    uniform float uContrast;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * uWarmth * uBalTint;
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(uTintShadow, uTintHigh, smoothstep(0.02, 0.6, l)); // cool shadows, golden highlights
      col = 0.18 * pow(max(col, vec3(0.0)) / 0.18, vec3(uContrast)); // gentle S around mid grey
      l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(vec3(l), col, uSaturation * uBalSat);
      col += uShadow * (1.0 - smoothstep(0.0, 0.5, l)); // cool lift in the darks
      vec2 d = vUv - 0.5;
      float v = smoothstep(0.85, 0.2, length(d * vec2(1.0, 1.15)));
      col *= mix(1.0 - uVignette, 1.0, v);
      gl_FragColor = vec4(col, c.a);
    }
  `,
};

/**
 * Replaces any NaN/Inf pixel with black before the effects run. One bad pixel from any shader would otherwise be
 * smeared by the bloom blur into a large black block (it happened once: a belief ring's light column).
 */
const SanitizeShader = {
  name: 'SanitizeShader',
  uniforms: { tDiffuse: { value: null as THREE.Texture | null } },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      if (any(isnan(c)) || any(isinf(c))) c = vec4(0.0, 0.0, 0.0, 1.0);
      gl_FragColor = vec4(min(c.rgb, vec3(60000.0)), c.a);
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
  private readonly tilt: ShaderPass;
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
    this.composer.addPass(new ShaderPass(SanitizeShader));

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
      // Sprites and glow cards (transparent, no depth write) would draw into the pre-pass as solid quads,
      // which GTAO turns into dark rectangles (the golem's eye halos, the shrine/pace emblems).
      scene.traverse((o) => {
        if (!o.visible) return;
        const m = (o as THREE.Mesh).material as THREE.Material | THREE.Material[] | undefined;
        const mat = Array.isArray(m) ? m[0] : m;
        if ((o as THREE.Sprite).isSprite || (mat && mat.transparent && !mat.depthWrite)) {
          o.visible = false;
          this.hidden.push(o);
        }
      });
    };
    a._restoreVisibility = () => {
      restore();
      for (const o of this.hidden) o.visible = true;
    };
    this.composer.addPass(this.ao);

    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD);
    this.composer.addPass(this.bloom);
    this.tilt = new ShaderPass(TiltShader);
    this.composer.addPass(this.tilt);
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

  /** The world's balance: saturation scale (1 = unchanged) and colour cast (linear rgb multiplier), on top of the season's grade. */
  setBalanceGrade(saturation: number, tint: THREE.Vector3) {
    const u = this.grade.uniforms;
    u.uBalSat.value = saturation;
    (u.uBalTint.value as THREE.Vector3).copy(tint);
  }

  /** Tilt-shift focus: the focus row's screen height (0 bottom .. 1 top) and strength 0..1 (see lookKit.dofStrength). */
  setFocus(uvY: number, strength: number) {
    const u = this.tilt.uniforms;
    u.uFocusY.value = uvY;
    const h = this.renderer.domElement.height;
    u.uMaxR.value = strength * LOOK.dofMaxRadius * (h / 1080);
    (u.uRes.value as THREE.Vector2).set(this.renderer.domElement.width, h);
  }

  resize(w: number, h: number) {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(deltaTime: number) {
    this.composer.render(deltaTime);
  }
}
