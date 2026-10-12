import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { SEA_LEVEL, VILLAGE } from '../config';
import { clamp } from '../util/math';

// ------------------------------------------------------------------ tuning knobs

const SEGMENTS = 192;
const PATH_SEGMENTS = 220;
/** Waves: seconds to travel out, and the radius they start from (m). */
const WAVE_TIME = { shrine: 4.6, house: 3.0 };
const WAVE_START = 9;
/** A second, lagging wave follows a shrine stage's first (seconds). */
const SHRINE_ECHO = 0.7;
/** Line width (m) close up, plus this much per metre of camera distance. */
const WAVE_WIDTH = 3;
const WAVE_WIDTH_PER_DIST = 0.03;
const PATH_WIDTH = 1.1;
const PATH_WIDTH_PER_DIST = 0.008;
/** Paths start from the ring (m at most from the source centre) and stop this far from the target totem. */
const PATH_END_GAP = 17;
const PATH_MIN_LEN = 26;
/** Seconds to ease the path's fill, to fade it in, and the flare when it joins. */
const PATH_FILL_RATE = 1.4;
const PATH_FADE = 2.5;
const JOIN_TIME = 3.2;
/** A path only shows once its village has this much belief (0..convertAt). */
const PATH_SHOW_FROM = 3;
const GOLD = new THREE.Color(0xffd37a);

// -------------------------------------------------------------------- shaders

const stripVert = /* glsl */ `
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

// A travelling wave: bright leading edge on the outer side, softly trailing inward.
const waveFrag = /* glsl */ `
  uniform float uAlpha;
  uniform float uTime;
  uniform vec3 uGold;
  varying float vS;
  varying float vSide;
  void main() {
    float s = clamp(vSide * 0.5 + 0.5, 0.0, 1.0);
    float edge = exp(-pow((s - 0.86) * 7.5, 2.0));
    float trail = pow(s, 2.4) * 0.38;
    float sparkle = 0.82 + 0.18 * sin(vS * 6.2831853 * 38.0 + uTime * 3.0);
    float k = (edge + trail) * sparkle * (1.0 - smoothstep(0.93, 1.0, s));
    float a = clamp(k * uAlpha, 0.0, 1.0);
    gl_FragColor = vec4(uGold * a * 1.35, a);
  }
`;

// The path of light: a filled run from the ring, flowing motes, a bright head while it grows.
const pathFrag = /* glsl */ `
  uniform float uFill;
  uniform float uAlpha;
  uniform float uJoin;
  uniform float uTime;
  uniform float uLen;
  uniform float uHalf;
  uniform vec3 uGold;
  varying float vS;
  varying float vSide;
  void main() {
    float x = abs(vSide);
    float aa = max(fwidth(vS) * 1.5, 1e-4);
    float filled = 1.0 - smoothstep(uFill - aa, uFill + aa, vS);
    float core = 1.0 - smoothstep(0.12, 0.5, x);
    float glow = exp(-x * x * 5.0);
    float flow = 0.62 + 0.38 * sin(vS * uLen / 9.0 * 6.2831853 - uTime * 1.6);
    float dh = (vS - uFill) * uLen;
    float head = exp(-dh * dh / 18.0) * step(0.004, uFill) * step(uFill, 0.997);
    float sweep = exp(-pow((vS - uJoin) * uLen / 12.0, 2.0)) * step(0.0, uJoin) * step(uJoin, 1.2);
    float seed = 0.05 * (1.0 - filled) * glow;
  #if MODE == 0
    float a = (core * 0.85 * flow + glow * 0.2) * filled + seed * 0.5;
    vec3 col = mix(uGold * 0.9, vec3(1.0, 0.95, 0.8), clamp(head * 0.5 + sweep * 0.7, 0.0, 1.0));
    gl_FragColor = vec4(col, clamp(a, 0.0, 1.0) * uAlpha * 0.78);
  #else
    float k = (glow * 0.42 * flow + core * 0.5) * filled + head * (glow + core) * 1.3 + sweep * (glow + core) * 1.2 + seed;
    gl_FragColor = vec4(uGold * 1.25 * max(k, 0.0) * uAlpha, 1.0);
  #endif
  }
`;

type Uniform<T> = { value: T };

function stripGeometry(n: number): THREE.BufferGeometry {
  const geo = new THREE.BufferGeometry();
  const s = new Float32Array((n + 1) * 2);
  const side = new Float32Array((n + 1) * 2);
  const idx: number[] = [];
  for (let i = 0; i <= n; i++) {
    s[i * 2] = s[i * 2 + 1] = i / n;
    side[i * 2] = -1;
    side[i * 2 + 1] = 1;
    if (i < n) {
      const a = i * 2;
      idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array((n + 1) * 2 * 3), 3).setUsage(THREE.DynamicDrawUsage));
  geo.setAttribute('aS', new THREE.BufferAttribute(s, 1));
  geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
  geo.setIndex(idx);
  return geo;
}

const num = (x: number, d = 0) => (Number.isFinite(x) ? x : d);

interface Wave {
  village: Village;
  /** Real seconds until it starts (the echo), then its age. */
  delay: number;
  t: number;
  dur: number;
  r1: number;
  strength: number;
}

/** A path of light from your ring toward one village. */
class Path {
  readonly group = new THREE.Group();
  private readonly geo = stripGeometry(PATH_SEGMENTS);
  private readonly uni: Record<string, Uniform<number | THREE.Color>>;
  fill = 0;
  alpha = 0;
  join = -1;
  joined = false;
  private key = '';
  private len = 100;
  private readonly pts: THREE.Vector3[] = [];

  constructor(
    private readonly game: Game,
    readonly target: Village,
  ) {
    this.uni = {
      uFill: { value: 0 },
      uAlpha: { value: 0 },
      uJoin: { value: -1 },
      uTime: { value: 0 },
      uLen: { value: 100 },
      uHalf: { value: 1 },
      uGold: { value: GOLD.clone() },
    };
    const make = (mode: number, additive: boolean) =>
      new THREE.ShaderMaterial({
        uniforms: this.uni as unknown as Record<string, THREE.IUniform>,
        defines: { MODE: mode },
        vertexShader: stripVert,
        fragmentShader: pathFrag,
        transparent: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        fog: false,
      });
    const ink = new THREE.Mesh(this.geo, make(0, false));
    const glow = new THREE.Mesh(this.geo, make(1, true));
    ink.renderOrder = 6;
    glow.renderOrder = 7;
    ink.frustumCulled = glow.frustumCulled = false;
    this.group.add(ink, glow);
    this.group.visible = false;
    game.scene.add(this.group);
  }

  /** Lay the strip on the ground (and over water, as a bridge of light) from `from` toward the target's totem. */
  private build(sx: number, sz: number, half: number, lift: number) {
    const g = this.game;
    const t = this.target.worship.pos;
    let dx = t.x - sx;
    let dz = t.z - sz;
    const dist = Math.max(1, Math.hypot(dx, dz));
    dx /= dist;
    dz /= dist;
    const ex = t.x - dx * PATH_END_GAP;
    const ez = t.z - dz * PATH_END_GAP;
    const total = Math.max(1, Math.hypot(ex - sx, ez - sz));
    const nx = -dz;
    const nz = dx;
    // A gentle meander that is seeded by the village, zero at both ends.
    const ph = (this.target.center.x * 0.013 + this.target.center.z * 0.021) % 6.28;
    const amp = Math.min(14, total * 0.09);
    this.pts.length = 0;
    let acc = 0;
    let px = sx;
    let pz = sz;
    for (let i = 0; i <= PATH_SEGMENTS; i++) {
      const u = i / PATH_SEGMENTS;
      const w = Math.sin(u * Math.PI);
      const off = (Math.sin(u * 7.3 + ph) * 0.7 + Math.sin(u * 3.1 + ph * 1.7) * 0.5) * amp * w;
      const x = sx + (ex - sx) * u + nx * off;
      const z = sz + (ez - sz) * u + nz * off;
      if (i > 0) acc += Math.hypot(x - px, z - pz);
      px = x;
      pz = z;
      this.pts.push(new THREE.Vector3(x, 0, z));
    }
    this.len = Math.max(1, acc);
    const pos = this.geo.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i <= PATH_SEGMENTS; i++) {
      const a = this.pts[Math.max(0, i - 1)];
      const b = this.pts[Math.min(PATH_SEGMENTS, i + 1)];
      let tx = b.x - a.x;
      let tz = b.z - a.z;
      const tl = Math.hypot(tx, tz) || 1;
      tx /= tl;
      tz /= tl;
      for (let k = 0; k < 2; k++) {
        const x = this.pts[i].x + -tz * half * (k ? 1 : -1);
        const z = this.pts[i].z + tx * half * (k ? 1 : -1);
        const h = Math.max(g.terrain.surfaceAt(x, z), SEA_LEVEL + 0.15);
        pos.setXYZ(i * 2 + k, x, num(h) + lift, z);
      }
    }
    pos.needsUpdate = true;
    this.uni.uLen.value = this.len;
    this.uni.uHalf.value = half;
  }

  /** `src` is the village the path starts from (its ring). */
  frame(dt: number, time: number, src: Village | null, goalFill: number, show: boolean) {
    const g = this.game;
    this.fill += (goalFill - this.fill) * (1 - Math.exp(-PATH_FILL_RATE * dt));
    if (!Number.isFinite(this.fill)) this.fill = goalFill;
    this.alpha = clamp(this.alpha + Math.sign((show && src ? 1 : 0) - this.alpha) * (dt / PATH_FADE), 0, 1);
    if (this.join >= 0) {
      this.join += dt / JOIN_TIME;
      if (this.join > 1.3) this.join = -1;
    }
    this.group.visible = this.alpha > 0.003 && !!src;
    if (!this.group.visible || !src) return;
    const cam = g.godCam.distance;
    const half = (PATH_WIDTH + cam * PATH_WIDTH_PER_DIST) * 0.5 * 2.6;
    const lift = 0.16 + cam * 0.0012;
    const t = this.target.worship.pos;
    const dist = Math.hypot(t.x - src.center.x, t.z - src.center.z);
    const start = Math.max(8, Math.min(src.influenceRadius, dist - PATH_END_GAP - PATH_MIN_LEN));
    const sx = src.center.x + ((t.x - src.center.x) / Math.max(1, dist)) * start;
    const sz = src.center.z + ((t.z - src.center.z) / Math.max(1, dist)) * start;
    const key = `${src.name}|${Math.round(sx)}|${Math.round(sz)}|${Math.round(half * 20)}`;
    if (key !== this.key) {
      this.key = key;
      this.build(sx, sz, half, lift);
    }
    const u = this.uni;
    u.uFill.value = clamp(num(this.fill), 0, 1);
    u.uAlpha.value = this.alpha;
    u.uJoin.value = this.join;
    u.uTime.value = time;
  }

  dispose() {
    this.game.scene.remove(this.group);
    this.geo.dispose();
  }
}

/**
 * Influence you can see (v0.6 pieces: "Reach", "The path of light"). No numbers, no words.
 * - A shrine stage pushes your ring out with a golden wave (and an echo); a finished house pulses it.
 * - A path of light grows on the ground from your ring toward each neighbour village as its belief fills,
 *   and joins (flares, then glows steadily) when it converts.
 */
export class Reach {
  readonly group = new THREE.Group();
  private readonly waves: Wave[] = [];
  private readonly slots: { geo: THREE.BufferGeometry; uni: { uAlpha: Uniform<number>; uTime: Uniform<number> }; mesh: THREE.Mesh }[] = [];
  private readonly paths = new Map<Village, Path>();
  private readonly dirs: { x: number; z: number }[] = [];
  private lastHouse = -1e9;

  constructor(private readonly game: Game) {
    for (let i = 0; i <= SEGMENTS; i++) {
      const a = (i / SEGMENTS) * Math.PI * 2;
      this.dirs.push({ x: Math.cos(a), z: Math.sin(a) });
    }
    for (let k = 0; k < 3; k++) {
      const geo = stripGeometry(SEGMENTS);
      const uni = { uAlpha: { value: 0 }, uTime: { value: 0 }, uGold: { value: GOLD.clone() } };
      const mesh = new THREE.Mesh(
        geo,
        new THREE.ShaderMaterial({
          uniforms: uni,
          vertexShader: stripVert,
          fragmentShader: waveFrag,
          transparent: true,
          depthWrite: false,
          side: THREE.DoubleSide,
          blending: THREE.AdditiveBlending,
          polygonOffset: true,
          polygonOffsetFactor: -5,
          polygonOffsetUnits: -5,
          fog: false,
        }),
      );
      mesh.frustumCulled = false;
      mesh.renderOrder = 8;
      mesh.visible = false;
      this.group.add(mesh);
      this.slots.push({ geo, uni, mesh });
    }
    this.group.name = 'reach';
    game.scene.add(this.group);

    game.events.on('shrineRaised', ({ village }) => {
      if (village.owner !== 'player') return;
      this.push(village, 'shrine', 1);
      this.push(village, 'shrine', 0.65, SHRINE_ECHO);
      this.push(village, 'shrine', 0.4, SHRINE_ECHO * 2);
    });
    game.events.on('houseBuilt', ({ house }) => {
      if (game.realTime - this.lastHouse < 0.6) return;
      const v = game.villageAt(house.pos.x, house.pos.z);
      if (!v || v.owner !== 'player') return;
      this.lastHouse = game.realTime;
      this.push(v, 'house', 0.55);
    });
    game.events.on('villageConverted', ({ village }) => {
      const p = this.paths.get(village);
      if (p) {
        p.join = 0;
        p.joined = true;
      }
    });
  }

  /** Send a wave out from a village's centre to its influence ring (also a debug handle). */
  push(village: Village, kind: 'shrine' | 'house', strength = 1, delay = 0) {
    const r1 = num(village.influenceRadius, 70);
    this.waves.push({ village, delay, t: 0, dur: WAVE_TIME[kind], r1, strength });
  }

  private source(target: Village): Village | null {
    let best: Village | null = null;
    let bd = Infinity;
    for (const v of this.game.villages) {
      if (v === target || v.owner !== 'player') continue;
      const d = Math.hypot(v.center.x - target.center.x, v.center.z - target.center.z);
      if (d < bd) {
        bd = d;
        best = v;
      }
    }
    return best;
  }

  frame(dt: number, time: number) {
    const g = this.game;
    dt = Math.min(dt, 0.1);
    this.frameWaves(dt, time);

    for (const v of g.villages) {
      if (v.isHome) continue;
      const mine = v.owner === 'player';
      const neutral = v.owner === null;
      let p = this.paths.get(v);
      if (!p) {
        if (!mine && !(neutral && v.belief >= PATH_SHOW_FROM)) continue;
        p = new Path(g, v);
        p.joined = mine;
        if (mine) {
          p.fill = 1;
          p.alpha = 1;
        }
        this.paths.set(v, p);
      }
      if (mine) p.joined = true;
      else if (p.joined) p.joined = false; // lost again: the road starts over from what is left
      const show = mine || (neutral && v.belief >= PATH_SHOW_FROM * 0.5);
      const goal = mine ? 1 : clamp(num(v.belief) / VILLAGE.convertAt, 0, 1);
      p.frame(dt, time, this.source(v), goal, show);
    }
  }

  private frameWaves(dt: number, time: number) {
    const g = this.game;
    const live: Wave[] = [];
    for (let i = this.waves.length - 1; i >= 0; i--) {
      const w = this.waves[i];
      if (w.delay > 0) {
        w.delay -= dt;
        continue;
      }
      w.t += dt / w.dur;
      if (w.t >= 1) this.waves.splice(i, 1);
      else live.push(w);
    }
    live.sort((a, b) => b.strength - a.strength);
    const camDist = g.godCam.distance;
    const lift = 0.2 + camDist * 0.0012;
    this.slots.forEach((slot, si) => {
      const w = live[si];
      slot.mesh.visible = !!w;
      if (!w) return;
      const e = 1 - Math.pow(1 - w.t, 3);
      const r = WAVE_START + (w.r1 - WAVE_START) * e;
      const half = (WAVE_WIDTH + camDist * WAVE_WIDTH_PER_DIST) * (1 + 3 * (1 - e)) * 0.5 + w.r1 * 0.04 * e;
      const pos = slot.geo.getAttribute('position') as THREE.BufferAttribute;
      const c = w.village.center;
      for (let i = 0; i <= SEGMENTS; i++) {
        const d = this.dirs[i];
        for (let k = 0; k < 2; k++) {
          const rr = Math.max(1, r + (k ? half * 0.35 : -half));
          const x = c.x + d.x * rr;
          const z = c.z + d.z * rr;
          pos.setXYZ(i * 2 + k, x, num(Math.max(g.terrain.surfaceAt(x, z), SEA_LEVEL + 0.1)) + lift, z);
        }
      }
      pos.needsUpdate = true;
      slot.uni.uAlpha.value = clamp(num(w.strength * (1 - Math.pow(w.t, 3)) * Math.min(1, w.t * 8)), 0, 1.2);
      slot.uni.uTime.value = time;
    });
  }

  get aoIgnore(): THREE.Object3D[] {
    return [this.group, ...[...this.paths.values()].map((p) => p.group)];
  }
}
