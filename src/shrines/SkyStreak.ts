import * as THREE from 'three';
import { clamp, smoothstep } from '../util/math';
import { starSpriteTexture } from './ShrineModels';

// ------------------------------------------------------------------ tuning knobs

/** Seconds for the light to cross, and to fade after it has passed. */
const CROSS = 3.4;
const FADE = 1.6;
/** Length of the glowing tail, as a share of the whole path. */
const TAIL = 0.34;
/** Thickness of the bright thread and of its soft glow, and the size of the star at its head (metres, at 300 m away; scaled with distance). */
const CORE = 0.45;
const HALO = 2.6;
const HEAD = 9;
/** The whole path stays at least this high over the land (metres). */
const CLEARANCE = 18;
/** Gold tail, white-hot head (linear HDR, so the bloom picks it up). */
const GOLD = new THREE.Color(1.7, 1.05, 0.42);
const WHITE = new THREE.Color(1.5, 1.1, 0.55);

interface Streak {
  t: number;
  curve: THREE.QuadraticBezierCurve3;
  meshes: THREE.Mesh[];
  head: THREE.Sprite;
  uniforms: { uHead: { value: number }; uFade: { value: number } };
}

/**
 * The visitor their records remember: once a village's prayer place has grown past the totem, an
 * answered prayer can send a soft streak of light across its sky, a white star with a long gold tail.
 * It crosses the view the player is looking through (above and beyond the village), so it is seen
 * rather than happening off-screen. No flashing: it eases in, glides, and fades.
 */
export class SkyStreaks {
  /** Every streak lives in here (kept out of the ambient-occlusion pass, which would hide it). */
  readonly group = new THREE.Group();
  private readonly active: Streak[] = [];
  private readonly headMat = new THREE.SpriteMaterial({
    map: starSpriteTexture(),
    color: WHITE,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    transparent: true,
    fog: false,
    toneMapped: false,
  });

  constructor(scene: THREE.Scene) {
    this.group.name = 'sky-streaks';
    scene.add(this.group);
  }

  get count(): number {
    return this.active.length;
  }

  /**
   * Send one across the sky over `at` (a village's centre), as seen by `camera`. It is placed in
   * screen space so it always crosses the view: in the sky above the horizon when the camera looks
   * out, or high over the land (between the camera and the ground) when it looks down.
   * Returns the path's middle (for a chime).
   */
  launch(at: THREE.Vector3, camera: THREE.PerspectiveCamera, ground: (x: number, z: number) => number): THREE.Vector3 {
    camera.updateMatrixWorld();
    const fov = THREE.MathUtils.degToRad(camera.fov);
    const tanHalf = Math.tan(fov / 2);
    const fwd = camera.getWorldDirection(new THREE.Vector3());
    const pitchDown = Math.asin(clamp(-fwd.y, -1, 1));
    // Where the horizon sits on screen (NDC y); above 1 means the camera only sees land.
    const horizon = Math.tan(pitchDown) / tanHalf;
    const sky = horizon < 0.85;
    let ndcY = sky ? clamp((Math.max(horizon, -0.6) + 1) / 2 + 0.08, 0.3, 0.86) : 0.22;
    const right = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    const up = new THREE.Vector3().setFromMatrixColumn(camera.matrixWorld, 1).normalize();
    const dir = Math.random() < 0.5 ? 1 : -1;
    const tmp = new THREE.Vector3();
    let curve: THREE.QuadraticBezierCurve3 | null = null;
    let depth = 0;
    // Never behind a hill: looking out, climb higher up the sky until the path clears the land; looking
    // down, come nearer the camera. Whatever still doesn't clear is lifted.
    for (let tries = 0; tries < 7; tries++) {
      const ray = new THREE.Vector3(0, ndcY, 0.5).unproject(camera).sub(camera.position).normalize();
      depth = clamp(camera.position.distanceTo(at) * 1.5, 140, 700) * (sky ? 1 : 0.7 ** tries);
      if (ray.y < -0.02) {
        const above = camera.position.y - ground(camera.position.x, camera.position.z);
        depth = Math.min(depth, (above / -ray.y) * 0.55);
      }
      const mid = camera.position.clone().addScaledVector(ray, depth);
      const span = depth * tanHalf * camera.aspect * 0.95;
      const drop = span * 0.22;
      const a = mid.clone().addScaledVector(right, -span * dir).addScaledVector(up, drop);
      const b = mid.clone().addScaledVector(right, span * dir).addScaledVector(up, -drop * 0.9);
      const ctrl = mid.clone().addScaledVector(up, span * 0.16);
      curve = new THREE.QuadraticBezierCurve3(a, ctrl, b);
      let short = 0;
      for (let i = 0; i <= 16; i++) {
        curve.getPoint(i / 16, tmp);
        short = Math.max(short, ground(tmp.x, tmp.z) + CLEARANCE - tmp.y);
      }
      if (short <= 0) break;
      if (tries === 6) for (const v of [curve.v0, curve.v1, curve.v2]) v.y += short;
      if (sky) ndcY = Math.min(0.94, ndcY + 0.07);
    }
    if (!curve) throw new Error('unreachable');
    const scale = depth / 300;

    const uniforms = { uHead: { value: 0 }, uFade: { value: 1 } };
    const meshes: THREE.Mesh[] = [];
    for (const [r, halo] of [
      [CORE, false],
      [HALO, true],
    ] as [number, boolean][]) {
      const geo = new THREE.TubeGeometry(curve, 140, r * scale, 8, false);
      const m = new THREE.Mesh(geo, this.material(uniforms, halo));
      m.frustumCulled = false;
      m.renderOrder = 5;
      this.group.add(m);
      meshes.push(m);
    }
    const head = new THREE.Sprite(this.headMat.clone());
    head.scale.setScalar(HEAD * scale);
    head.renderOrder = 6;
    head.position.copy(curve.v0);
    this.group.add(head);
    this.active.push({ t: 0, curve, meshes, head, uniforms });
    return curve.getPoint(0.5);
  }

  private material(uniforms: Streak['uniforms'], halo: boolean): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      uniforms: { ...uniforms, uGold: { value: GOLD }, uWhite: { value: WHITE } },
      defines: { HALO: halo ? 1 : 0, TAIL: TAIL.toFixed(3) },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      fog: false,
      toneMapped: false,
      vertexShader: /* glsl */ `
        varying float vU;
        varying float vFace;
        void main() {
          vU = uv.x;
          vec4 wp = modelMatrix * vec4(position, 1.0);
          vec3 n = mat3(modelMatrix) * normal;
          vec3 v = cameraPosition - wp.xyz;
          vFace = abs(dot(n, v)) / max(length(n) * length(v), 1e-4); // guarded: no NaN (see docs/agents.md)
          gl_Position = projectionMatrix * viewMatrix * wp;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uHead;
        uniform float uFade;
        uniform vec3 uGold;
        uniform vec3 uWhite;
        varying float vU;
        varying float vFace;
        void main() {
          // Behind the head the tail glows and thins away; ahead of it there is nothing.
          float behind = uHead - vU;
          if (behind < 0.0) discard;
          float k = 1.0 - clamp(behind / TAIL, 0.0, 1.0);
          // The tail thins as it fades: a sharper edge falloff further back.
          float core = pow(clamp(vFace, 0.0, 1.0), (HALO == 1 ? 2.4 : 1.3) + (1.0 - k) * 7.0);
          float a = pow(k, 2.2) * core * uFade * (HALO == 1 ? 0.3 : 1.0);
          vec3 col = mix(uGold, uWhite, pow(k, 9.0));
          gl_FragColor = vec4(col * a, 1.0);
        }
      `,
    });
  }

  /** Per rendered frame (real seconds). Returns head positions so the caller can drop a sparkle. */
  frame(dt: number): THREE.Vector3[] {
    const heads: THREE.Vector3[] = [];
    for (let i = this.active.length - 1; i >= 0; i--) {
      const s = this.active[i];
      s.t += dt;
      const k = clamp(s.t / CROSS, 0, 1);
      // Eases in and out of the sky; the tail keeps travelling a little after the head has gone.
      const head = smoothstep(0, 1, k) * (1 + TAIL * 0.15);
      s.uniforms.uHead.value = head;
      const fadeIn = smoothstep(0, 0.12, k);
      const fadeOut = 1 - clamp((s.t - CROSS) / FADE, 0, 1);
      s.uniforms.uFade.value = fadeIn * fadeOut;
      s.curve.getPoint(Math.min(1, head), s.head.position);
      s.head.material.opacity = fadeIn * fadeOut * (k < 1 ? 1 : 0.6);
      s.head.visible = k < 1 || fadeOut > 0.05;
      if (k < 1) heads.push(s.head.position);
      if (s.t >= CROSS + FADE) {
        for (const m of s.meshes) {
          this.group.remove(m);
          m.geometry.dispose();
          (m.material as THREE.Material).dispose();
        }
        this.group.remove(s.head);
        s.head.material.dispose();
        this.active.splice(i, 1);
      }
    }
    return heads;
  }
}
