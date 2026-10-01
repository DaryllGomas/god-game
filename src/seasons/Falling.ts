import * as THREE from 'three';

export type FallingKind = 'snow' | 'rain' | 'leaf';

interface Spec {
  count: number;
  /** Fall speed in m/s. */
  fall: number;
  /** Height of the falling column above the ground, in metres. */
  height: number;
  /** World size of a particle (rain: streak length). */
  size: number;
  /** Sideways wobble in metres. */
  sway: number;
  alpha: number;
  colors: [number, number, number];
}

const SPECS: Record<FallingKind, Spec> = {
  snow: { count: 4200, fall: 2.6, height: 70, size: 0.3, sway: 0.7, alpha: 0.95, colors: [0xffffff, 0xf0f6ff, 0xe4eeff] },
  rain: { count: 4200, fall: 42, height: 80, size: 1.2, sway: 0, alpha: 0.38, colors: [0xcfe6ff, 0xb9d6f5, 0xe0efff] },
  leaf: { count: 420, fall: 1.7, height: 55, size: 0.4, sway: 2.2, alpha: 1, colors: [0xe08a1c, 0xc8481a, 0xe8b830] },
};

/** Petals are leaves in spring colours. */
export const PETAL_COLORS: [number, number, number] = [0xff9fba, 0xffc4d4, 0xffe0e8];

/**
 * A volume of falling stuff (snow, rain streaks, leaves, petals) around the camera's focus.
 * Everything runs in the vertex shader from a fixed lattice of seeds that wraps around the focus,
 * so there's no per-particle CPU work and nothing swims as the camera moves.
 * `density` 0..1 thins it out per particle; `wind` slides it sideways (m/s).
 */
export class Falling {
  readonly object: THREE.Object3D;
  private readonly uniforms: Record<string, THREE.IUniform>;
  private readonly spec: Spec;

  constructor(readonly kind: FallingKind, colors?: [number, number, number]) {
    const spec = (this.spec = SPECS[kind]);
    const n = spec.count;
    const lines = kind === 'rain';
    const verts = lines ? n * 2 : n;
    const seed = new Float32Array(verts * 4);
    const rnd = new Float32Array(verts);
    const end = new Float32Array(verts);
    const pos = new Float32Array(verts * 3);
    for (let i = 0; i < n; i++) {
      const s = [Math.random(), Math.random(), Math.random(), Math.random()];
      const r = Math.random();
      for (let k = 0; k < (lines ? 2 : 1); k++) {
        const v = lines ? i * 2 + k : i;
        seed.set(s, v * 4);
        rnd[v] = r;
        end[v] = k;
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aSeed', new THREE.BufferAttribute(seed, 4));
    geo.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 1));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));

    const cols = colors ?? spec.colors;
    this.uniforms = {
      uTime: { value: 0 },
      uCenter: { value: new THREE.Vector3() },
      uR: { value: 80 },
      uH: { value: spec.height },
      uFall: { value: spec.fall },
      uSize: { value: spec.size },
      uSway: { value: spec.sway },
      uDensity: { value: 0 },
      uWind: { value: new THREE.Vector2() },
      uLight: { value: 1 },
      uAlpha: { value: spec.alpha },
      uScale: { value: 600 },
      uC0: { value: new THREE.Color(cols[0]) },
      uC1: { value: new THREE.Color(cols[1]) },
      uC2: { value: new THREE.Color(cols[2]) },
    };
    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: false,
      uniforms: this.uniforms,
      defines: { LINES: lines ? 1 : 0 },
      vertexShader: /* glsl */ `
        attribute vec4 aSeed;
        attribute float aRnd;
        attribute float aEnd;
        uniform float uTime, uR, uH, uFall, uSize, uSway, uDensity, uScale;
        uniform vec3 uCenter;
        uniform vec2 uWind;
        uniform vec3 uC0, uC1, uC2;
        varying float vA;
        varying vec3 vCol;
        void main() {
          float speed = uFall * (0.75 + 0.5 * aSeed.w);
          vec2 sxz = aSeed.xz * 2.0 * uR;
          vec2 rel = mod(sxz + uWind * uTime - uCenter.xz + uR, 2.0 * uR) - uR;
          float y = mod(aSeed.y * uH - uTime * speed, uH);
          vec3 wp = vec3(uCenter.x + rel.x, uCenter.y - 3.0 + y, uCenter.z + rel.y);
          wp.x += sin(uTime * 1.3 + aSeed.w * 40.0) * uSway;
          wp.z += cos(uTime * 1.1 + aSeed.x * 40.0) * uSway;
          float dist = length(rel);
          float vis = step(aRnd, uDensity);
          vA = vis * (1.0 - smoothstep(0.65 * uR, uR, dist)) * smoothstep(0.0, 3.0, y) * smoothstep(uH, uH - 8.0, y);
          vCol = aSeed.w < 0.34 ? uC0 : (aSeed.w < 0.67 ? uC1 : uC2);
          #if LINES
            float zoom = uR / 70.0;
            wp += vec3(-uWind.x * 0.03, 1.0, -uWind.y * 0.03) * uSize * zoom * aEnd;
          #endif
          vec4 mv = viewMatrix * vec4(wp, 1.0);
          #if !LINES
            gl_PointSize = vA > 0.0 ? uSize * (0.7 + 0.6 * aRnd) * uScale / max(-mv.z, 0.1) : 0.0;
          #endif
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uLight, uAlpha;
        varying float vA;
        varying vec3 vCol;
        void main() {
          if (vA <= 0.0) discard;
          float a = vA * uAlpha;
          #if !LINES
            vec2 d = gl_PointCoord - 0.5;
            float r = dot(d, d) * 4.0;
            if (r > 1.0) discard;
            a *= 1.0 - r * r;
          #endif
          gl_FragColor = vec4(vCol * uLight, a);
        }
      `,
    });
    const obj = lines ? new THREE.LineSegments(geo, mat) : new THREE.Points(geo, mat);
    obj.frustumCulled = false;
    obj.renderOrder = 6;
    obj.visible = false;
    this.object = obj;
  }

  setViewportHeight(px: number, fovDeg: number) {
    this.uniforms.uScale.value = px / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  /**
   * Per frame. `center` is the camera focus on the ground, `radius` the half-width of the volume,
   * `light` the scene brightness (so snow isn't glowing at night).
   */
  update(time: number, center: THREE.Vector3, radius: number, density: number, wind: THREE.Vector2, light: number) {
    const u = this.uniforms;
    this.object.visible = density > 0.004;
    if (!this.object.visible) return;
    u.uTime.value = time;
    (u.uCenter.value as THREE.Vector3).copy(center);
    u.uR.value = radius;
    u.uDensity.value = density;
    (u.uWind.value as THREE.Vector2).copy(wind);
    u.uLight.value = light;
    // Bigger flakes and longer streaks as the view widens, so they stay readable.
    u.uSize.value = this.spec.size * (this.kind === 'rain' ? 1 : Math.max(1, radius / 80));
  }
}
