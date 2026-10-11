import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from './Village';
import { VILLAGE } from '../config';
import { clamp, damp } from '../util/math';

// ------------------------------------------------------------------ tuning knobs

/** Ring radius around the totem: just outside the standing stones. */
const RADIUS = 14;
/** Line width (m) close up, plus this much per metre of camera distance so it stays a thread from far away. */
const LINE = 0.3;
const LINE_PER_DIST = 0.003;
/** The glow band around the line, in line widths. */
const HALO = 6;
const SEGMENTS = 192;
/** How quickly the arc catches up with the village's belief (per second). */
const FILL_RATE = 1.6;
/** A rise in belief of at least this much (a deed landing) makes the ring pulse. */
const PULSE_MIN = 0.4;
const PULSE_TIME = 2.2;
/** How far the ripple of a pulse travels outward (m). */
const RIPPLE_REACH = 11;
/** The soft light rising on the totem: its height at no belief and at full belief, and its radius. */
const COLUMN_LOW = 3;
const COLUMN_HIGH = 30;
const COLUMN_RADIUS = 1.6;
/** Seconds to fade in, or out once the village is yours. */
const FADE = 2.4;
/** Same gold as the drop sigil and the influence ring (sRGB 0xffd37a). */
const GOLD = new THREE.Color(0xffd37a);
/** The view the fill starts from: "12 o'clock" at the camera's default heading (GodCamera yaw 0.5). */
const START_YAW = 0.5;

const ringVert = /* glsl */ `
  attribute float aS;
  attribute float aSide;
  varying float vS;
  varying float vSide;
  void main() {
    vS = aS;
    vSide = aSide;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const ringFrag = /* glsl */ `
  uniform float uFill;
  uniform float uGain;
  uniform float uPulse;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uLine;
  uniform float uCirc;
  uniform vec3 uGold;
  varying float vS;
  varying float vSide;
  void main() {
    float x = abs(vSide);
    float aa = max(fwidth(vS) * 1.2, 1e-4);
    float filled = 1.0 - smoothstep(uFill - aa, uFill + aa, vS);
    // Beads at the quarters, like the nodes on the TEND orbit arcs (along-distance in band half-widths).
    float q = (fract(vS * 4.0 + 0.5) - 0.5) * 0.25 * uCirc;
    float bead = 1.0 - smoothstep(uLine * 1.5, uLine * 2.3, length(vec2(q, vSide)));
    // The leading edge carries a small glint while it is filling.
    float dh = (vS - uFill) * uCirc;
    float head = exp(-dh * dh / (uLine * uLine * 40.0)) * step(0.004, uFill) * step(uFill, 0.996);
    // Belief just won glows white-gold while the pulse lasts.
    float fresh = filled * step(uGain, vS) * uPulse;
  #if MODE == 0
    float line = 1.0 - smoothstep(uLine * 0.5, uLine, x);
    float a = line * mix(0.16, 1.0, filled) + bead * mix(0.22, 1.0, filled);
    vec3 col = mix(uGold * 0.82, vec3(1.0, 0.96, 0.86), clamp(fresh * 0.7 + head * 0.5, 0.0, 1.0));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAlpha);
  #elif MODE == 1
    float glow = exp(-x * x * 9.0);
    float core = exp(-x * x / (uLine * uLine * 2.0));
    float swell = 0.85 + 0.15 * sin(vS * 6.2831853 * 3.0 - uTime * 0.6);
    float k = glow * filled * (0.1 + 0.45 * uPulse) * swell + core * filled * (0.4 + 0.4 * uPulse)
            + core * head * 1.4 + glow * head * 0.5 + core * fresh * 1.2 + bead * filled * 0.5 + core * 0.02;
    gl_FragColor = vec4(uGold * k * uAlpha, 1.0);
  #else
    float line = exp(-x * x * 4.0);
    gl_FragColor = vec4(uGold * line * uPulse * uPulse * uAlpha * 0.7, 1.0);
  #endif
  }
`;

const columnVert = /* glsl */ `
  varying float vY;
  varying float vFace;
  void main() {
    vY = position.y;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 v = normalize(cameraPosition - wp.xyz);
    vFace = abs(dot(normalize(vec3(n.x, 0.0, n.z)), normalize(vec3(v.x, 0.0, v.z))));
    gl_Position = projectionMatrix * viewMatrix * wp;
  }
`;

const columnFrag = /* glsl */ `
  uniform float uStrength;
  uniform float uTime;
  uniform vec3 uGold;
  varying float vY;
  varying float vFace;
  void main() {
    float core = pow(vFace, 2.2);
    float rise = smoothstep(0.0, 0.05, vY) * pow(1.0 - vY, 1.8);
    float shimmer = 0.78 + 0.22 * sin(vY * 16.0 - uTime * 1.4);
    gl_FragColor = vec4(uGold * core * rise * shimmer * uStrength, 1.0);
  }
`;

type Uniforms = {
  uFill: { value: number };
  uGain: { value: number };
  uPulse: { value: number };
  uAlpha: { value: number };
  uTime: { value: number };
  uLine: { value: number };
  uCirc: { value: number };
  uGold: { value: THREE.Color };
};

/** A strip around the circle: (SEGMENTS + 1) x 2 vertices, `aS` 0..1 clockwise from 12 o'clock, `aSide` -1..1 across. */
function ringGeometry(): THREE.BufferGeometry {
  const n = SEGMENTS + 1;
  const geo = new THREE.BufferGeometry();
  const s = new Float32Array(n * 2);
  const side = new Float32Array(n * 2);
  const idx: number[] = [];
  for (let i = 0; i < n; i++) {
    s[i * 2] = s[i * 2 + 1] = i / SEGMENTS;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    if (i < SEGMENTS) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(idx);
  return geo;
}

/** Directions around the ring, clockwise as seen from the default camera, starting at the top of the screen. */
const DIRS: { x: number; z: number }[] = (() => {
  const fx = -Math.sin(START_YAW);
  const fz = -Math.cos(START_YAW);
  const rx = -fz;
  const rz = fx;
  const out: { x: number; z: number }[] = [];
  for (let i = 0; i <= SEGMENTS; i++) {
    const a = (i / SEGMENTS) * Math.PI * 2;
    out.push({ x: Math.cos(a) * fx + Math.sin(a) * rx, z: Math.cos(a) * fz + Math.sin(a) * rz });
  }
  return out;
})();

/**
 * Belief you can see, with no words: a thin gold ring on the ground around a village's totem that
 * fills clockwise as the village comes to believe in you, and a soft light rising on the totem that
 * grows with it (readable from far off). When a deed lands the ring pulses, the new arc glows
 * white-gold and a ripple runs outward. Hidden for villages that worship you; on conversion it
 * completes, flares and fades away.
 */
export class BeliefRing {
  readonly group = new THREE.Group();
  private readonly geo = ringGeometry();
  private readonly rippleGeo = ringGeometry();
  private readonly uniforms: Uniforms;
  private readonly rippleUniforms: Uniforms;
  private readonly columnUniforms = { uStrength: { value: 0 }, uTime: { value: 0 }, uGold: { value: GOLD.clone().multiplyScalar(1.6) } };
  private readonly column: THREE.Mesh;
  private readonly ripple: THREE.Mesh;
  /** What the ring shows (0..1), easing toward belief. */
  private fill = 0;
  private alpha = 0;
  private pulse = 0;
  private rippleT = -1;
  private lastBelief: number;
  private wasMine: boolean;
  private builtHalf = -1;
  private readonly cx: number;
  private readonly cz: number;

  constructor(
    private readonly game: Game,
    readonly village: Village,
  ) {
    const site = village.worship.pos;
    this.cx = site.x;
    this.cz = site.z;
    this.wasMine = village.owner === 'player';
    this.lastBelief = village.belief;
    this.fill = this.wasMine ? 1 : this.target();
    this.alpha = this.wasMine ? 0 : 1;

    const make = (mode: number, additive: boolean, u: Uniforms) =>
      new THREE.ShaderMaterial({
        uniforms: u,
        defines: { MODE: mode },
        vertexShader: ringVert,
        fragmentShader: ringFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide, // the strip runs clockwise seen from above
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        fog: false,
      });
    const uni = (): Uniforms => ({
      uFill: { value: this.fill },
      uGain: { value: 1 },
      uPulse: { value: 0 },
      uAlpha: { value: this.alpha },
      uTime: { value: 0 },
      uLine: { value: 1 / HALO },
      uCirc: { value: 1 },
      uGold: { value: GOLD.clone() },
    });
    this.uniforms = uni();
    this.rippleUniforms = uni();
    // The glow is HDR so it blooms; the ink copy is plain gold so the line reads on bright grass.
    const glowGold = GOLD.clone().multiplyScalar(1.25);
    const glowUniforms = { ...this.uniforms, uGold: { value: glowGold } };
    const ink = new THREE.Mesh(this.geo, make(0, false, this.uniforms));
    const glow = new THREE.Mesh(this.geo, make(1, true, glowUniforms));
    this.ripple = new THREE.Mesh(this.rippleGeo, make(2, true, { ...this.rippleUniforms, uGold: { value: glowGold } }));
    ink.renderOrder = 6;
    glow.renderOrder = 7;
    this.ripple.renderOrder = 7;
    this.ripple.visible = false;

    const cg = new THREE.CylinderGeometry(1, 1, 1, 40, 1, true);
    cg.translate(0, 0.5, 0);
    this.column = new THREE.Mesh(
      cg,
      new THREE.ShaderMaterial({
        uniforms: this.columnUniforms,
        vertexShader: columnVert,
        fragmentShader: columnFrag,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.column.position.set(site.x, game.terrain.heightAt(site.x, site.z), site.z);
    this.column.renderOrder = 7;
    for (const m of [ink, glow, this.ripple, this.column]) m.frustumCulled = false;
    this.group.add(ink, glow, this.ripple, this.column);
    this.group.name = `belief-ring-${village.name}`;
    game.scene.add(this.group);
  }

  private target(): number {
    return clamp(this.village.belief / VILLAGE.convertAt, 0, 1);
  }

  /** Lay a ring strip on the terrain at `radius` with half-width `half`. */
  private drape(geo: THREE.BufferGeometry, radius: number, half: number, lift: number) {
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const t = this.game.terrain;
    for (let i = 0; i <= SEGMENTS; i++) {
      const d = DIRS[i];
      for (let k = 0; k < 2; k++) {
        const r = radius + (k ? half : -half);
        const x = this.cx + d.x * r;
        const z = this.cz + d.z * r;
        pos.setXYZ(i * 2 + k, x, t.surfaceAt(x, z) + lift, z);
      }
    }
    pos.needsUpdate = true;
  }

  frame(dt: number, time: number) {
    const v = this.village;
    const g = this.game;
    const mine = v.owner === 'player';

    // A deed landed (belief rose): pulse, and remember where the new arc starts.
    if (!mine && v.belief - this.lastBelief >= PULSE_MIN) this.startPulse();
    this.lastBelief = v.belief;
    if (mine && !this.wasMine) this.startPulse(); // converted: complete and flare, then fade
    if (!mine && this.wasMine) this.fill = this.target(); // lost or turned: start again from what is left
    this.wasMine = mine;

    const goal = mine ? 1 : this.target();
    this.fill += (goal - this.fill) * damp(mine ? FILL_RATE * 3 : FILL_RATE, dt);
    const fadeGoal = mine ? (this.pulse > 0.35 ? 1 : 0) : 1;
    this.alpha = clamp(this.alpha + Math.sign(fadeGoal - this.alpha) * (dt / FADE), 0, 1);
    this.pulse = Math.max(0, this.pulse - dt / PULSE_TIME);
    this.group.visible = this.alpha > 0.002;
    if (!this.group.visible) return;

    // Line width follows the camera distance, so it is a fine thread close up and still reads from afar.
    const camDist = g.godCam.distance;
    const line = LINE + camDist * LINE_PER_DIST;
    const half = line * HALO * 0.5;
    const lift = 0.14 + camDist * 0.0012;
    if (Math.abs(half - this.builtHalf) > this.builtHalf * 0.03) {
      this.builtHalf = half;
      this.drape(this.geo, RADIUS, half, lift);
    }
    const u = this.uniforms;
    u.uFill.value = this.fill;
    u.uPulse.value = this.pulse;
    u.uAlpha.value = this.alpha;
    u.uTime.value = time;
    u.uCirc.value = (Math.PI * 2 * RADIUS) / half;
    u.uLine.value = 1 / HALO;

    // The ripple runs outward from the ring and fades.
    if (this.rippleT >= 0) {
      this.rippleT += dt / PULSE_TIME;
      const e = 1 - Math.pow(1 - Math.min(1, this.rippleT), 3);
      this.drape(this.rippleGeo, RADIUS + RIPPLE_REACH * e, half * 0.45, lift);
      const r = this.rippleUniforms;
      r.uPulse.value = Math.max(0, 1 - this.rippleT);
      r.uAlpha.value = this.alpha;
      r.uLine.value = 1 / HALO;
      this.ripple.visible = this.rippleT < 1;
      if (this.rippleT >= 1) this.rippleT = -1;
    }

    // The light on the totem rises with belief.
    const h = COLUMN_LOW + (COLUMN_HIGH - COLUMN_LOW) * this.fill;
    this.column.scale.set(COLUMN_RADIUS * (1 + this.pulse * 0.4), h, COLUMN_RADIUS * (1 + this.pulse * 0.4));
    this.columnUniforms.uStrength.value = this.alpha * (0.05 + 0.5 * this.fill + 0.9 * this.pulse * Math.max(0.3, this.fill));
    this.columnUniforms.uTime.value = time;
  }

  private startPulse() {
    this.pulse = 1;
    this.uniforms.uGain.value = Math.min(this.fill, 0.999);
    this.rippleT = 0;
    // A spark where the arc is about to grow.
    const g = this.game;
    const d = DIRS[Math.round(clamp(this.fill, 0, 1) * SEGMENTS)];
    const x = this.cx + d.x * RADIUS;
    const z = this.cz + d.z * RADIUS;
    g.fx.sparkle(x, g.terrain.surfaceAt(x, z) + 0.8, z, 16, 0xffe6a0, 1.8);
  }

  /** Meshes that must stay out of the ambient-occlusion pre-pass. */
  get aoIgnore(): THREE.Object3D[] {
    return [this.group];
  }
}
