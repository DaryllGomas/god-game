import * as THREE from 'three';
import type { Game } from '../Game';
import { findRoad, type Path } from '../land/Roads';
import type { Terrain } from '../world/Terrain';
import { CH_PATH, CH_WORN } from '../land/LandMask';
import type { LandApi } from '../plugins/land';
import { WALKER_MAT, walkerGeometry } from '../land/VillageDecor';
import { glowTexture } from '../rival/RivalVisuals';
import { aoSkip } from '../endings/CityLights';
import { Rng } from '../util/rng';
import { clamp, smoothstep } from '../util/math';
import { DAIS_R } from './NexusModel';
import { MARK_COUNT } from './glyphs';
import {
  LAMP_HEAD,
  TELOR_GLOW,
  TELOR_MATS,
  bannerGeometry,
  benchGeometry,
  fountainGeometry,
  gateTowerGeometry,
  hallGeometry,
  lampGeometry,
  planterGeometry,
  stallGeometry,
  towerGeometry,
  townhouseGeometry,
  wallGeometry,
} from './TelorArt';

// ------------------------------------------------------------------ tuning knobs

/**
 * The city grows in game seconds after the ring stands (Daryll: "once it's built, instead of a temple, now the city
 * starts to get built around it"). Each step is a window [from, to]; things in it appear one after another.
 */
export const CITY = {
  roads: [0, 26] as const,
  plaza: [14, 40] as const,
  lanes: [30, 56] as const,
  ringA: [42, 90] as const,
  ringB: [80, 132] as const,
  avenues: [112, 166] as const,
  walls: [146, 178] as const,
  built: 186,
};
/** The steps the age names (Ora's and the advisors' lines hang on them). */
export const STEPS: { id: TelorStep; at: number }[] = [
  { id: 'roads', at: CITY.roads[0] },
  { id: 'plaza', at: CITY.plaza[0] },
  { id: 'district', at: CITY.ringA[0] },
  { id: 'avenues', at: CITY.avenues[0] },
  { id: 'walls', at: CITY.walls[0] },
  { id: 'built', at: CITY.built },
];
export type TelorStep = 'roads' | 'plaza' | 'district' | 'avenues' | 'walls' | 'built';

/** Rings of the city (m from the Nexus): the plaza's edge, the two ring streets, the rows of houses, the wall. */
const PLAZA_R = 32;
const RING1 = 49;
const RING2 = 76;
const ROW_A = 40.5;
const ROW_B1 = 55.5;
const ROW_B2 = 67;
const ROW_C = 84.5;
const WALL_R = 93;
/** Avenues to the villages, ring streets and the seven lanes: half widths (m). */
const AVENUE_HALF = 3.2;
const RING_HALF = 2.4;
const LANE_HALF = 1.8;
/** Houses along the avenues out to the villages: spacing and offset from the centre line (m). */
const AVENUE_LOT_GAP = 12.5;
const AVENUE_LOT_OFFSET = 8.6;
/** A building rises over this many game seconds; a lamp or a prop over less. */
const RISE = 2.4;
const RISE_SMALL = 0.8;
/** Footprint radii (m) per kind of thing, for spacing. */
const R_HOUSE = 4.7;
const R_HALL = 8.2;
const R_TOWER = 3.4;
const R_GATE = 3.6;
/** Walkers on the streets and dancers round the Nexus. */
const WALKERS = { ring: 26, avenue: 14, lane: 3 };
const DANCERS = 26;
const DANCE_R = 22.5;
/** The villages' colours, and two of the city's own (navy, cream): the people of three villages, one people now. */
const TUNICS = [0x3f6fc4, 0xc4803f, 0x7a4fb0, 0x2c3e6a, 0xe8dcc0];
const SLAB = [0xd8c7a2, 0xcfbd96, 0xe0d0ad, 0xc8b68e, 0xd2c09a];
const KERB = 0x9a8a6e;
const LAMP_LIGHT = new THREE.Color(1.6, 1.08, 0.5);

enum K {
  House0 = 0,
  Hall0 = 6,
  Tower = 8,
  Gate = 9,
  Wall = 10,
  Lamp = 11,
  Fountain = 12,
  Planter = 13,
  Banner = 14,
  Stall0 = 15,
  Bench = 18,
}
const KINDS = 19;
const HOUSES = 6;

function geometryOf(k: number): THREE.BufferGeometry {
  if (k < K.Hall0) return townhouseGeometry(9100 + k * 37);
  if (k < K.Tower) return hallGeometry(9300 + (k - K.Hall0) * 41);
  if (k === K.Tower) return towerGeometry(9401);
  if (k === K.Gate) return gateTowerGeometry(9402);
  if (k === K.Wall) return wallGeometry();
  if (k === K.Lamp) return lampGeometry();
  if (k === K.Fountain) return fountainGeometry();
  if (k === K.Planter) return planterGeometry(9403);
  if (k === K.Banner) return bannerGeometry();
  if (k < K.Bench) return stallGeometry(9404 + k, TUNICS[k - K.Stall0]);
  return benchGeometry();
}

interface Lot {
  k: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  /** Scale along x (walls are one metre long, stretched). */
  sx: number;
  r: number;
  at: number;
  /** 0 not yet, 1 rising, 2 standing. */
  state: 0 | 1 | 2;
  /** Index in its kind's instanced mesh. */
  i: number;
  small: boolean;
}

interface Street {
  path: Path;
  cum: number[];
  len: number;
  half: number;
  from: number;
  to: number;
  mesh: THREE.Mesh | null;
  /** Triangles' vertices per step along the path. */
  perStep: number;
  steps: number;
  painted: boolean;
  kind: 'avenue' | 'ring' | 'lane' | 'plaza';
}

interface Walker {
  route: Street;
  look: number;
  i: number;
  t: number;
  speed: number;
  dir: 1 | -1;
  side: number;
  startAt: number;
}

const pathLength = (p: Path) => {
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
  return cum;
};

/** The point `s` metres along a path, and its direction. */
function along(p: Path, cum: number[], s: number, out: { x: number; z: number; dx: number; dz: number }) {
  const L = cum[cum.length - 1];
  s = clamp(s, 0, L);
  let i = 1;
  while (i < p.length - 1 && cum[i] < s) i++;
  const a = p[i - 1];
  const b = p[i];
  const seg = Math.max(1e-6, cum[i] - cum[i - 1]);
  const k = (s - cum[i - 1]) / seg;
  out.x = a.x + (b.x - a.x) * k;
  out.z = a.z + (b.z - a.z) * k;
  out.dx = (b.x - a.x) / seg;
  out.dz = (b.z - a.z) / seg;
  return out;
}

/** Distance from (x, z) to a polyline. */
function distToPath(p: Path, x: number, z: number): number {
  let best = Infinity;
  for (let i = 1; i < p.length; i++) {
    const a = p[i - 1];
    const b = p[i];
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const l2 = dx * dx + dz * dz || 1e-6;
    const t = clamp(((x - a.x) * dx + (z - a.z) * dz) / l2, 0, 1);
    best = Math.min(best, Math.hypot(x - a.x - dx * t, z - a.z - dz * t));
  }
  return best;
}

/** Resample a polyline every `step` metres. */
function resample(p: Path, step: number): Path {
  const cum = pathLength(p);
  const L = cum[cum.length - 1];
  const n = Math.max(1, Math.round(L / step));
  const o = { x: 0, z: 0, dx: 0, dz: 0 };
  const out: Path = [];
  for (let i = 0; i <= n; i++) {
    along(p, cum, (i / n) * L, o);
    out.push({ x: o.x, z: o.z });
  }
  return out;
}

/**
 * Telor: the city that grows around the Nexus once the ring stands (the last age, src/nexus). Planned once from the
 * land (deterministic for a given island and site), then built by `build(t)` in visible steps over CITY.built game
 * seconds: the roads from the three villages are paved toward the Nexus, the plaza is laid ring by ring out from the
 * dais, seven lanes run out from the seven stones, two rings of houses and halls fill in between the ring streets,
 * houses line the avenues out to the villages until the villages' own houses join up, and walls of warm stone with
 * gates close the city. Lamps light along every street as it is paved, and people walk the new streets and dance on
 * the plaza. Nothing here is an entity: it is drawn (instanced), and the villages live on as they did.
 */
export class Telor {
  readonly group = new THREE.Group();
  readonly center: THREE.Vector3;
  private readonly lots: Lot[] = [];
  private readonly streets: Street[] = [];
  private readonly meshes: THREE.InstancedMesh[] = [];
  private readonly walkers: Walker[] = [];
  private readonly dancers: { i: number; look: number; a: number; r: number; startAt: number; ph: number }[] = [];
  private readonly walkerMeshes: THREE.InstancedMesh[] = [];
  private readonly lampGlow: THREE.Points;
  private readonly lampAt: Float32Array;
  private readonly lampAlpha: THREE.BufferAttribute;
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly o = { x: 0, z: 0, dx: 0, dz: 0 };
  /** Game seconds into the build. */
  t = -1;
  private soundAt = 0;
  private tidy = 0;
  private clearQueue: Lot[] = [];
  /** The people stop and gather (the true end): 0..1. */
  gather = 0;
  /** Where the people gather round and look (the lit Nexus), when they do. */
  readonly gatherAt = new THREE.Vector3();
  readonly avenues: Street[] = [];

  constructor(
    private readonly game: Game,
    center: THREE.Vector3,
  ) {
    this.center = center.clone();
    this.group.name = 'telor';
    game.scene.add(this.group);
    this.plan();
    // One instanced mesh per kind of thing.
    const counts = new Array(KINDS).fill(0);
    for (const l of this.lots) l.i = counts[l.k]++;
    for (let k = 0; k < KINDS; k++) {
      const mesh = new THREE.InstancedMesh(geometryOf(k), TELOR_MATS, Math.max(1, counts[k]));
      mesh.count = counts[k];
      mesh.castShadow = k !== K.Lamp && k !== K.Bench;
      mesh.receiveShadow = true;
      mesh.frustumCulled = false;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < counts[k]; i++) mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      mesh.name = `telor-${k}`;
      this.meshes.push(mesh);
      this.group.add(mesh);
    }
    // Lamp light: one soft glow per lamp, lit as its street is paved, brighter at night.
    const lamps = this.lots.filter((l) => l.k === K.Lamp);
    const pos = new Float32Array(lamps.length * 3);
    this.lampAt = new Float32Array(lamps.length);
    lamps.forEach((l, i) => {
      const c = Math.cos(l.yaw);
      const s = Math.sin(l.yaw);
      pos[i * 3] = l.x + LAMP_HEAD.x * c + LAMP_HEAD.z * s;
      pos[i * 3 + 1] = l.y + LAMP_HEAD.y;
      pos[i * 3 + 2] = l.z - LAMP_HEAD.x * s + LAMP_HEAD.z * c;
      this.lampAt[i] = l.at;
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    this.lampAlpha = new THREE.BufferAttribute(new Float32Array(lamps.length), 1);
    geo.setAttribute('aAlpha', this.lampAlpha);
    this.lampGlow = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: glowTexture() }, uColor: { value: LAMP_LIGHT }, uScale: { value: 900 } },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: /* glsl */ `
          attribute float aAlpha; varying float vA; uniform float uScale;
          void main() {
            vA = aAlpha;
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            gl_PointSize = clamp(uScale * 2.6 / max(-mv.z, 1.0), 1.0, 90.0);
            gl_Position = projectionMatrix * mv;
          }`,
        fragmentShader: /* glsl */ `
          uniform sampler2D uMap; uniform vec3 uColor; varying float vA;
          void main() { vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(uColor * t.a * vA, 1.0); }`,
      }),
    );
    this.lampGlow.frustumCulled = false;
    this.lampGlow.renderOrder = 5;
    this.group.add(this.lampGlow);
    aoSkip(game, this.lampGlow);
    this.makePeople();
    // Nothing grows or rolls into the city: inside the walls, and on the avenues out to the villages.
    const c = this.center;
    game.keepClear.push((x, z) => {
      const d = Math.hypot(x - c.x, z - c.z);
      if (d < WALL_R + 4) return true;
      if (d > 420) return false;
      for (const st of this.avenues) if (distToPath(st.path, x, z) < AVENUE_HALF + 3) return true;
      return false;
    });
  }

  /** No building, wall or prop of the city within `r` of (x, z) (for the true end's camera). */
  isClear(x: number, z: number, r: number): boolean {
    for (const l of this.lots) {
      const lr = l.k === K.Wall ? l.sx * 0.5 : l.r;
      if (Math.hypot(l.x - x, l.z - z) < lr + r) return false;
    }
    return true;
  }

  // ---------------------------------------------------------------- planning

  private get land(): LandApi | null {
    return (this.game as unknown as { land?: LandApi }).land ?? null;
  }

  /** The land as generated (not as levelled since), so the plan is the same whenever it is made. */
  private h(x: number, z: number) {
    return this.game.terrain.baseHeightAt(x, z);
  }

  /** Dry, gentle ground for a footprint w x d at (x, z) turned `yaw`: the floor height, or null. */
  private ground(x: number, z: number, w: number, d: number, yaw: number, maxRange = 3.2): number | null {
    const c = Math.cos(yaw);
    const s = Math.sin(yaw);
    let lo = Infinity;
    let hi = -Infinity;
    for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [-1, 1], [1, 1], [0, 1], [0, -1]]) {
      const lx = (u * w) / 2;
      const lz = (v * d) / 2;
      const hh = this.h(x + lx * c + lz * s, z - lx * s + lz * c);
      lo = Math.min(lo, hh);
      hi = Math.max(hi, hh);
    }
    if (lo < 1.4 || hi > 50 || hi - lo > maxRange) return null;
    return lo + (hi - lo) * 0.35 - 0.1;
  }

  /**
   * Clear of the villages themselves. Only what never moves counts (their centre, lands and prayer place), so the plan
   * is the same whenever it is made: an island reloaded mid-city rebuilds exactly the city it had.
   */
  private clearOfVillages(x: number, z: number, r: number): boolean {
    for (const v of this.game.villages) {
      if (Math.hypot(v.center.x - x, v.center.z - z) < v.radius * 1.12 + r) return false;
      if (Math.hypot(v.worship.pos.x - x, v.worship.pos.z - z) < 16 + r) return false;
    }
    return true;
  }

  private clearOfLots(x: number, z: number, r: number): boolean {
    for (const l of this.lots) if (Math.hypot(l.x - x, l.z - z) < l.r + r) return false;
    return true;
  }

  private clearOfStreets(x: number, z: number, r: number, except?: Street): boolean {
    for (const s of this.streets) if (s !== except && distToPath(s.path, x, z) < s.half + r) return false;
    return true;
  }

  private addLot(k: number, x: number, z: number, yaw: number, r: number, at: number, opts: { y?: number; sx?: number; small?: boolean } = {}): Lot {
    const l: Lot = { k, x, y: opts.y ?? this.h(x, z), z, yaw, sx: opts.sx ?? 1, r, at, state: 0, i: 0, small: !!opts.small };
    this.lots.push(l);
    return l;
  }

  /** A building that faces (fx, fz), if the ground and the neighbours allow. */
  private tryBuilding(k: number, x: number, z: number, faceX: number, faceZ: number, at: number): Lot | null {
    const hall = k >= K.Hall0 && k < K.Tower;
    const r = hall ? R_HALL : k === K.Tower ? R_TOWER : R_HOUSE;
    const w = hall ? 16 : k === K.Tower ? 5 : 8.4;
    const d = hall ? 13 : k === K.Tower ? 5 : 7.6;
    const yaw = Math.atan2(faceX - x, faceZ - z);
    if (!this.clearOfVillages(x, z, r) || !this.clearOfLots(x, z, r * 0.92) || !this.clearOfStreets(x, z, r * 0.8)) return null;
    if (Math.hypot(x - this.center.x, z - this.center.z) < PLAZA_R + r * 0.6) return null;
    const y = this.ground(x, z, w, d, yaw, hall ? 3.4 : 3.4);
    if (y === null) return null;
    return this.addLot(k, x, z, yaw, r, at, { y });
  }

  private street(path: Path, half: number, from: number, to: number, kind: Street['kind']): Street {
    const p = resample(path, 1.6);
    const cum = pathLength(p);
    const st: Street = { path: p, cum, len: cum[cum.length - 1], half, from, to, mesh: null, perStep: 0, steps: 0, painted: false, kind };
    this.streets.push(st);
    return st;
  }

  /** Split a ring into runs over good ground (no water, no cliffs). */
  private ringRuns(R: number): Path[] {
    const c = this.center;
    const n = Math.round((Math.PI * 2 * R) / 2);
    const runs: Path[] = [];
    let run: Path = [];
    let prevH = NaN;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = c.x + Math.cos(a) * R;
      const z = c.z + Math.sin(a) * R;
      const hh = this.h(x, z);
      const ok = hh > 1.6 && hh < 48 && (isNaN(prevH) || Math.abs(hh - prevH) < 1.3) && this.clearOfVillages(x, z, 2);
      prevH = hh;
      if (ok) run.push({ x, z });
      else {
        if (run.length > 6) runs.push(run);
        run = [];
      }
    }
    if (run.length > 6) runs.push(run);
    // A run that wraps all the way round: join its two ends.
    if (runs.length > 1 && runs[0][0] && Math.hypot(runs[0][0].x - runs[runs.length - 1][runs[runs.length - 1].length - 1].x, runs[0][0].z - runs[runs.length - 1][runs[runs.length - 1].length - 1].z) < 3) {
      const last = runs.pop()!;
      runs[0] = [...last, ...runs[0]];
    }
    return runs;
  }

  private plan() {
    const g = this.game;
    const c = this.center;
    const rng = new Rng(Math.round(c.x * 31 + c.z * 17) ^ 0x7e1a);
    const angleOf = (x: number, z: number) => Math.atan2(z - c.z, x - c.x);

    // 1. The avenues: from each village's edge to the plaza, paved from the village toward the Nexus.
    const vs = [...g.villages].sort((a, b) => a.center.distanceTo(c) - b.center.distanceTo(c));
    vs.forEach((v, i) => {
      const dx = v.center.x - c.x;
      const dz = v.center.z - c.z;
      const d = Math.hypot(dx, dz) || 1;
      const ux = dx / d;
      const uz = dz / d;
      const ax = v.center.x - ux * v.radius * 0.75;
      const az = v.center.z - uz * v.radius * 0.75;
      const bx = c.x + ux * (DAIS_R + 2.5);
      const bz = c.z + uz * (DAIS_R + 2.5);
      const base = { heightAt: (x: number, z: number) => g.terrain.baseHeightAt(x, z) } as unknown as Terrain;
      const road = findRoad(base, ax, az, bx, bz) ?? [
        { x: ax, z: az },
        { x: bx, z: bz },
      ];
      const st = this.street(road, AVENUE_HALF, CITY.roads[0] + i * 2.5, CITY.roads[1] - (2 - i) * 1.5, 'avenue');
      this.avenues.push(st);
      void v;
    });
    const avenueAngles = this.avenues.map((st) => {
      // Where it leaves the plaza (a little out from the edge).
      const pt = st.path.find((p) => Math.hypot(p.x - c.x, p.z - c.z) < PLAZA_R + 8) ?? st.path[st.path.length - 1];
      return angleOf(pt.x, pt.z);
    });
    const nearAvenue = (a: number, tol: number) => avenueAngles.some((b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))) < tol);

    // 2. The plaza (a street of its own kind: its mesh is a disc laid ring by ring).
    const plaza: Street = { path: [{ x: c.x, z: c.z }], cum: [0], len: 0, half: PLAZA_R, from: CITY.plaza[0], to: CITY.plaza[1], mesh: null, perStep: 0, steps: 0, painted: false, kind: 'plaza' };
    this.streets.push(plaza);

    // 3. The seven lanes, one out from each stone, and the two ring streets.
    const stoneAngles: number[] = [];
    for (let i = 0; i < MARK_COUNT; i++) {
      // The ring's stones stand at sin/cos of (i/7 * 2pi + 0.22) in the site's frame (x = sin a, z = -cos a).
      const a = (i / MARK_COUNT) * Math.PI * 2 + 0.22;
      stoneAngles.push(Math.atan2(-Math.cos(a), Math.sin(a)));
    }
    stoneAngles.forEach((a, i) => {
      if (nearAvenue(a, 0.22)) return;
      const pts: Path = [];
      let ok = true;
      for (let r = PLAZA_R; r <= RING2; r += 2) {
        const x = c.x + Math.cos(a) * r;
        const z = c.z + Math.sin(a) * r;
        const hh = this.h(x, z);
        if (hh < 1.6 || hh > 48 || !this.clearOfVillages(x, z, 2)) {
          ok = pts.length > 8;
          break;
        }
        pts.push({ x, z });
      }
      if (ok && pts.length > 4) this.street(pts, LANE_HALF, CITY.lanes[0] + i * 2.5, CITY.lanes[0] + i * 2.5 + 12, 'lane');
    });
    for (const [R, from] of [[RING1, CITY.lanes[0] + 4], [RING2, CITY.lanes[0] + 12]] as [number, number][]) {
      for (const run of this.ringRuns(R)) this.street(run, RING_HALF, from, from + 18, 'ring');
    }

    // 4. The plaza's things: banners between the stones, fountains, planters, benches and a market by the avenues.
    // Banners stand behind the stones, so every gap between two stones is an open way in.
    stoneAngles.forEach((a, i) => {
      const r = DAIS_R + 3.4;
      const x = c.x + Math.cos(a) * r;
      const z = c.z + Math.sin(a) * r;
      this.addLot(K.Banner, x, z, Math.atan2(c.x - x, c.z - z) + Math.PI / 2, 1, CITY.plaza[0] + 8 + i * 0.6, { small: true });
    });
    for (let i = 0; i < MARK_COUNT; i++) {
      const a = stoneAngles[i];
      if (nearAvenue(a, 0.3)) continue;
      if (i % 2) {
        const x = c.x + Math.cos(a) * 27.6;
        const z = c.z + Math.sin(a) * 27.6;
        if (this.h(x, z) > 1.4) this.addLot(K.Fountain, x, z, 0, 3.6, CITY.plaza[0] + 14 + i, { small: true });
      } else {
        for (const s of [-1, 1]) {
          const x = c.x + Math.cos(a + s * 0.1) * 27;
          const z = c.z + Math.sin(a + s * 0.1) * 27;
          this.addLot(K.Bench, x, z, Math.atan2(c.x - x, c.z - z), 1.4, CITY.plaza[0] + 16 + i, { small: true });
        }
      }
    }
    for (let k = 0; k < 28; k++) {
      const a = (k / 28) * Math.PI * 2 + 0.05;
      if (nearAvenue(a, 0.16) || stoneAngles.some((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s))) < 0.06)) continue;
      const x = c.x + Math.cos(a) * (PLAZA_R - 2.4);
      const z = c.z + Math.sin(a) * (PLAZA_R - 2.4);
      if (this.h(x, z) > 1.4 && this.clearOfLots(x, z, 1.4)) this.addLot(K.Planter, x, z, a, 1.5, CITY.plaza[0] + 10 + k * 0.5, { small: true });
    }
    avenueAngles.forEach((a, vi) => {
      for (const s of [-1, 1]) {
        for (let j = 0; j < 2; j++) {
          const b = a + s * (0.2 + j * 0.13);
          const x = c.x + Math.cos(b) * 27.5;
          const z = c.z + Math.sin(b) * 27.5;
          if (this.clearOfLots(x, z, 2) && this.h(x, z) > 1.4) this.addLot(K.Stall0 + (vi % 3), x, z, Math.atan2(c.x - x, c.z - z), 2, CITY.plaza[0] + 20 + j, { small: true });
        }
      }
    });

    // 5. The districts: a row of houses round the plaza (and two towers), then two rows either side of the second ring.
    const row = (R: number, gap: number, face: 1 | -1, win: readonly [number, number], hallEvery = 0, towers = 0) => {
      const n = Math.floor((Math.PI * 2 * R) / gap);
      const off = rng.range(0, Math.PI * 2);
      let placed = 0;
      for (let i = 0; i < n; i++) {
        const a = off + (i / n) * Math.PI * 2;
        const x = c.x + Math.cos(a) * R;
        const z = c.z + Math.sin(a) * R;
        // They rise in a sweep round the ring.
        const at = win[0] + (i / n) * (win[1] - win[0]) * 0.92;
        let k: number = K.House0 + rng.int(0, HOUSES - 1);
        if (hallEvery && placed % hallEvery === hallEvery - 1) k = K.Hall0 + rng.int(0, 1);
        if (towers && i % Math.floor(n / towers) === Math.floor(n / towers / 2)) k = K.Tower;
        const fx = face > 0 ? c.x : c.x + Math.cos(a) * R * 2;
        const fz = face > 0 ? c.z : c.z + Math.sin(a) * R * 2;
        const lot = this.tryBuilding(k, x, z, fx, fz, at) ?? (k !== K.House0 ? this.tryBuilding(K.House0 + rng.int(0, HOUSES - 1), x, z, fx, fz, at) : null);
        if (lot) placed++;
      }
    };
    row(ROW_A, 10.2, 1, CITY.ringA, 0, 3);
    row(ROW_B1, 10.4, 1, [CITY.ringA[0] + 18, CITY.ringA[1]]);
    row(ROW_B2, 11, -1, CITY.ringB, 4);
    row(ROW_C, 10.8, 1, [CITY.ringB[0] + 12, CITY.ringB[1]], 6);

    // 6. Houses along the avenues out to the villages, until the villages' own houses join up.
    for (const st of this.avenues) {
      const L = st.len;
      // The avenue runs village -> Nexus; the houses rise from the Nexus outward.
      for (let s = L - (WALL_R + 4); s > 4; s -= AVENUE_LOT_GAP) {
        along(st.path, st.cum, s, this.o);
        const nx = -this.o.dz;
        const nz = this.o.dx;
        const k = (L - s) / L;
        const at = CITY.avenues[0] + k * (CITY.avenues[1] - CITY.avenues[0]);
        for (const side of [-1, 1]) {
          const x = this.o.x + nx * side * AVENUE_LOT_OFFSET;
          const z = this.o.z + nz * side * AVENUE_LOT_OFFSET;
          this.tryBuilding(K.House0 + rng.int(0, HOUSES - 1), x, z, this.o.x, this.o.z, at + (side > 0 ? 0.6 : 0));
        }
      }
    }

    // 7. Lamps along every street, lit as it is paved (and round the plaza's edge).
    for (const st of this.streets) {
      if (st.kind === 'plaza') {
        for (let k = 0; k < 24; k++) {
          const a = (k / 24) * Math.PI * 2 + 0.13;
          if (nearAvenue(a, 0.12)) continue;
          const x = c.x + Math.cos(a) * (PLAZA_R - 0.6);
          const z = c.z + Math.sin(a) * (PLAZA_R - 0.6);
          if (this.h(x, z) > 1.4 && this.clearOfLots(x, z, 0.8)) this.addLot(K.Lamp, x, z, Math.PI - a, 0.5, st.from + 4 + (k / 24) * 8, { small: true });
        }
        continue;
      }
      const gap = st.kind === 'avenue' ? 11 : 13;
      let side = 1;
      for (let s = 3; s < st.len - 2; s += gap) {
        along(st.path, st.cum, s, this.o);
        const nx = -this.o.dz;
        const nz = this.o.dx;
        side = -side;
        const off = st.half + 0.9;
        const x = this.o.x + nx * side * off;
        const z = this.o.z + nz * side * off;
        if (Math.hypot(x - c.x, z - c.z) < PLAZA_R + 1) continue;
        if (this.h(x, z) < 1.2 || !this.clearOfLots(x, z, 1.2) || !this.clearOfVillages(x, z, 1)) continue;
        // The lamp's arm reaches over the street.
        this.addLot(K.Lamp, x, z, Math.atan2(nz * side, -nx * side), 0.5, st.from + (s / st.len) * (st.to - st.from) + 0.6, { small: true });
      }
    }

    // 8. The walls of warm stone, with a gate where each avenue goes through.
    const n = Math.round((Math.PI * 2 * WALL_R) / 6);
    const off = rng.range(0, 1);
    const gateAt = this.avenues.map((st) => {
      for (let i = st.path.length - 1; i > 0; i--) {
        const p = st.path[i];
        if (Math.hypot(p.x - c.x, p.z - c.z) >= WALL_R) return p;
      }
      return null;
    });
    for (const gp of gateAt) {
      if (!gp) continue;
      const a = angleOf(gp.x, gp.z);
      for (const sgn of [-1, 1]) {
        const b = a + (sgn * (AVENUE_HALF + 4.2)) / WALL_R;
        const x = c.x + Math.cos(b) * WALL_R;
        const z = c.z + Math.sin(b) * WALL_R;
        const y = this.ground(x, z, 5, 5, b, 4);
        if (y !== null && this.clearOfVillages(x, z, 3)) this.addLot(K.Gate, x, z, Math.atan2(c.x - x, c.z - z) + Math.PI, R_GATE, CITY.walls[0] + 1, { y });
      }
    }
    for (let i = 0; i < n; i++) {
      const a0 = ((i + off) / n) * Math.PI * 2;
      const a1 = ((i + 1 + off) / n) * Math.PI * 2;
      const x0 = c.x + Math.cos(a0) * WALL_R;
      const z0 = c.z + Math.sin(a0) * WALL_R;
      const x1 = c.x + Math.cos(a1) * WALL_R;
      const z1 = c.z + Math.sin(a1) * WALL_R;
      const mx = (x0 + x1) / 2;
      const mz = (z0 + z1) / 2;
      const h0 = this.h(x0, z0);
      const h1 = this.h(x1, z1);
      const hm = this.h(mx, mz);
      if (Math.min(h0, h1, hm) < 1.5 || Math.max(h0, h1, hm) > 50 || Math.max(h0, h1, hm) - Math.min(h0, h1, hm) > 3.4) continue;
      if (!this.clearOfVillages(mx, mz, 3) || !this.clearOfLots(mx, mz, 2.6)) continue;
      if (!this.clearOfStreets(mx, mz, 3)) continue;
      const len = Math.hypot(x1 - x0, z1 - z0) + 0.15;
      const at = CITY.walls[0] + 2 + (i / n) * (CITY.walls[1] - CITY.walls[0] - 2);
      this.addLot(K.Wall, mx, mz, Math.atan2(-(z1 - z0), x1 - x0), 2.4, at, { y: Math.min(h0, h1, hm) - 0.2, sx: len });
    }
  }

  // ---------------------------------------------------------------- the meshes

  /** A paved street as a strip that hugs the land: kerbs and slabs, ordered along it so it can be laid as it goes. */
  private streetMesh(st: Street): THREE.Mesh {
    const g = this.game;
    const p = st.path;
    const cols = [-1, -1 + 0.4 / st.half, 0, 1 - 0.4 / st.half, 1];
    const pos: number[] = [];
    const col: number[] = [];
    const rng = new Rng(p.length * 7 + Math.round(st.len));
    const c = new THREE.Color();
    const at = (i: number, u: number): [number, number, number] => {
      const a = p[Math.max(0, i - 1)];
      const b = p[Math.min(p.length - 1, i + 1)];
      const dx = b.x - a.x;
      const dz = b.z - a.z;
      const l = Math.hypot(dx, dz) || 1;
      const x = p[i].x + (-dz / l) * u * st.half;
      const z = p[i].z + (dx / l) * u * st.half;
      return [x, Math.max(g.terrain.heightAt(x, z), 0.2) + 0.16, z];
    };
    for (let i = 0; i < p.length - 1; i++) {
      for (let j = 0; j < cols.length - 1; j++) {
        const a = at(i, cols[j]);
        const b = at(i, cols[j + 1]);
        const cc = at(i + 1, cols[j + 1]);
        const d = at(i + 1, cols[j]);
        const kerb = j === 0 || j === cols.length - 2;
        c.set(kerb ? KERB : SLAB[rng.int(0, SLAB.length - 1)]).multiplyScalar(kerb ? 1 : 0.94 + rng.next() * 0.1);
        for (const v of [a, cc, b, a, d, cc]) {
          pos.push(...v);
          col.push(c.r, c.g, c.b);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    st.perStep = (cols.length - 1) * 6;
    st.steps = p.length - 1;
    const mesh = new THREE.Mesh(geo, STREET_MAT);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    geo.setDrawRange(0, 0);
    this.group.add(mesh);
    return mesh;
  }

  /** The plaza: rings of slabs from the dais out to its edge, hugging the land, laid ring by ring. */
  private plazaMesh(st: Street): THREE.Mesh {
    const g = this.game;
    const c = this.center;
    const pos: number[] = [];
    const col: number[] = [];
    const rng = new Rng(4242);
    const cc = new THREE.Color();
    const r0 = DAIS_R + 1.6;
    const step = 1.6;
    const rings = Math.ceil((PLAZA_R - r0) / step);
    const y = (x: number, z: number) => Math.max(g.terrain.heightAt(x, z), 0.2) + 0.14;
    for (let k = 0; k < rings; k++) {
      const ra = r0 + k * step;
      const rb = Math.min(PLAZA_R, ra + step);
      const n = Math.max(24, Math.round((Math.PI * 2 * rb) / 1.8));
      // Every third ring a band of darker stone, like the floor of the boards' Nexus hall.
      const band = k % 3 === 2;
      for (let i = 0; i < n; i++) {
        const a0 = (i / n) * Math.PI * 2;
        const a1 = ((i + 1) / n) * Math.PI * 2;
        const pts = [
          [ra, a0],
          [rb, a0],
          [rb, a1],
          [ra, a1],
        ].map(([r, a]) => {
          const x = c.x + Math.cos(a) * r;
          const z = c.z + Math.sin(a) * r;
          return [x, y(x, z), z];
        });
        cc.set(band ? 0xb9a47c : SLAB[rng.int(0, SLAB.length - 1)]).multiplyScalar(0.93 + rng.next() * 0.12);
        for (const v of [pts[0], pts[2], pts[1], pts[0], pts[3], pts[2]]) {
          pos.push(...v);
          col.push(cc.r, cc.g, cc.b);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    st.perStep = 6;
    st.steps = pos.length / 18;
    const mesh = new THREE.Mesh(geo, STREET_MAT);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    geo.setDrawRange(0, 0);
    this.group.add(mesh);
    return mesh;
  }

  private makePeople() {
    const rng = new Rng(5150);
    const routes = this.streets;
    const add = (st: Street, n: number) => {
      for (let i = 0; i < n; i++)
        this.walkers.push({ route: st, look: rng.int(0, TUNICS.length - 1), i: 0, t: rng.range(0, st.len), speed: rng.range(1.1, 1.6), dir: rng.next() < 0.5 ? 1 : -1, side: rng.range(-0.7, 0.7), startAt: st.to + rng.range(0, 14) });
    };
    for (const st of routes) {
      if (st.kind === 'ring') add(st, Math.max(2, Math.round((WALKERS.ring * st.len) / (Math.PI * 2 * RING2))));
      else if (st.kind === 'avenue') add(st, WALKERS.avenue);
      else if (st.kind === 'lane') add(st, WALKERS.lane);
    }
    for (let i = 0; i < DANCERS; i++) this.dancers.push({ i: 0, look: i % TUNICS.length, a: (i / DANCERS) * Math.PI * 2, r: DANCE_R + (i % 2) * 1.3, startAt: CITY.plaza[1] + 4 + rng.range(0, 10), ph: rng.range(0, 6.28) });
    const counts = new Array(TUNICS.length).fill(0);
    for (const w of this.walkers) w.i = counts[w.look]++;
    for (const d of this.dancers) d.i = counts[d.look]++;
    TUNICS.forEach((tunic, k) => {
      const geo = walkerGeometry(7000 + k * 13, tunic);
      geo.setAttribute('aSwing', new THREE.InstancedBufferAttribute(new Float32Array(Math.max(1, counts[k])), 1));
      const mesh = new THREE.InstancedMesh(geo, WALKER_MAT, Math.max(1, counts[k]));
      mesh.count = counts[k];
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      for (let i = 0; i < counts[k]; i++) mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
      this.walkerMeshes.push(mesh);
      this.group.add(mesh);
    });
  }

  // ---------------------------------------------------------------- building

  /** How far the city has come: the step it is on. */
  stepAt(t: number): TelorStep | null {
    let cur: TelorStep | null = null;
    for (const s of STEPS) if (t >= s.at) cur = s.id;
    return cur;
  }

  get done(): boolean {
    return this.t >= CITY.built;
  }

  /** How many buildings stand (for tests). */
  counts() {
    const by = (f: (l: Lot) => boolean) => this.lots.filter((l) => f(l)).length;
    return {
      buildings: by((l) => l.k < K.Gate),
      standing: by((l) => l.k < K.Gate && l.state === 2),
      walls: by((l) => l.k === K.Wall || l.k === K.Gate),
      lamps: by((l) => l.k === K.Lamp),
      props: by((l) => l.k > K.Lamp),
      streets: this.streets.length,
      paved: this.streets.filter((s) => this.t >= s.to).length,
      walkers: this.walkers.length,
    };
  }

  /** Move the build to `t` game seconds. `quiet`: no dust or sounds (a reload, a debug jump). */
  build(t: number, quiet = false) {
    const g = this.game;
    const prev = this.t;
    this.t = t;
    // Streets: meshes made on first need, laid along as their window passes; the ground under them painted once.
    for (const st of this.streets) {
      if (t < st.from) continue;
      if (!st.mesh) st.mesh = st.kind === 'plaza' ? this.plazaMesh(st) : this.streetMesh(st);
      const k = smoothstep(0, 1, clamp((t - st.from) / Math.max(0.01, st.to - st.from), 0, 1));
      st.mesh.geometry.setDrawRange(0, Math.floor(k * st.steps) * st.perStep);
      if (!st.painted) {
        st.painted = true;
        this.paintStreet(st);
      }
    }
    // Things rise.
    const touched = new Set<THREE.InstancedMesh>();
    for (const l of this.lots) {
      if (l.state === 2 || t < l.at) continue;
      const rise = l.small ? RISE_SMALL : RISE;
      const k = clamp((t - l.at) / rise, 0, 1);
      if (l.state === 0) {
        l.state = 1;
        this.clearQueue.push(l);
        if (!quiet && !l.small && t - prev < 5) {
          g.fx.dust(l.x, l.y + 1, l.z, 16, 1.6, 0xc8b490);
          if (g.realTime - this.soundAt > 0.5) {
            this.soundAt = g.realTime;
            g.audio.stoneSet(this.p.set(l.x, l.y, l.z), 1.6);
          }
        }
      }
      this.place(l, k);
      touched.add(this.meshes[l.k]);
      if (k >= 1) l.state = 2;
    }
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
    if (this.clearQueue.length) this.clearLots();
    // Lamps light a little after they stand.
    const arr = this.lampAlpha.array as Float32Array;
    for (let i = 0; i < arr.length; i++) arr[i] = smoothstep(0.5, 2.5, t - this.lampAt[i]);
    this.lampAlpha.needsUpdate = true;
  }

  private place(l: Lot, k: number) {
    const e = k * k * (3 - 2 * k);
    const sy = Math.max(0.001, e);
    const sxz = l.small ? Math.max(0.001, e) : 1;
    this.q.setFromAxisAngle(this.up, l.yaw);
    this.m.compose(this.p.set(l.x, l.y, l.z), this.q, this.s.set(l.sx * sxz, sy, sxz));
    this.meshes[l.k].setMatrixAt(l.i, this.m);
  }

  /** Trees, rocks and decorative nature give way where something is built; the ground there is worn. */
  private clearLots() {
    const g = this.game;
    const lots = this.clearQueue;
    this.clearQueue = [];
    for (const l of lots) {
      const r = l.k === K.Wall ? l.sx * 0.5 + 1 : l.r + 1;
      g.forEachNear(l.x, l.z, r, (e) => {
        if ((e.kind === 'tree' || e.kind === 'rock') && !e.held) {
          if (!l.small) g.fx.dust(e.pos.x, e.pos.y, e.pos.z, 6, 0.6);
          g.remove(e);
        }
      });
    }
    const big = lots.filter((l) => !l.small || l.k === K.Fountain);
    this.land?.clear((x, z) => big.some((l) => Math.hypot(l.x - x, l.z - z) < (l.k === K.Wall ? l.sx * 0.6 + 1.5 : l.r + 1.5)));
    if (big.length) this.land?.paint((p) => {
      for (const l of big) if (l.k !== K.Wall) p.disc(l.x, l.z, l.r + 2.5, CH_WORN, 0.9, 0.5);
    });
  }

  private paintStreet(st: Street) {
    const c = this.center;
    if (st.kind === 'plaza') {
      this.land?.clear((x, z) => Math.hypot(x - c.x, z - c.z) < PLAZA_R + 2);
      this.land?.paint((p) => p.disc(c.x, c.z, PLAZA_R + 1, CH_PATH, 1, 0.9));
      this.game.forEachNear(c.x, c.z, PLAZA_R + 1, (e) => {
        if ((e.kind === 'tree' || e.kind === 'rock') && !e.held) this.game.remove(e);
      });
      return;
    }
    const path = st.path;
    this.land?.clear((x, z) => distToPath(path, x, z) < st.half + 2.2);
    this.land?.paint((p) => p.path(path, st.half + 0.8, CH_PATH, 1, 0.75));
    for (const pt of path.filter((_, i) => i % 3 === 0)) {
      this.game.forEachNear(pt.x, pt.z, st.half + 1.5, (e) => {
        if ((e.kind === 'tree' || e.kind === 'rock') && !e.held) this.game.remove(e);
      });
    }
  }

  // ---------------------------------------------------------------- per frame

  /** People on the streets, the dancers, and the night: `night` 0..1. Real seconds `dt`; `t` game seconds into the build. */
  frame(dt: number, night: number) {
    const g = this.game;
    const t = this.t;
    // Now and then: anything that fell, rolled or was carried onto the plaza is tidied away.
    this.tidy -= dt;
    if (this.tidy <= 0 && t >= CITY.plaza[0]) {
      this.tidy = 4;
      g.forEachNear(this.center.x, this.center.z, PLAZA_R + 1, (e) => {
        if ((e.kind === 'tree' || e.kind === 'rock') && !e.held && !e.airborne) g.remove(e);
      });
    }
    TELOR_GLOW.emissiveIntensity = 0.35 + night * 2.6;
    (this.lampGlow.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(LAMP_LIGHT).multiplyScalar(0.25 + night * 1.1);
    const touched = new Set<number>();
    const gather = smoothstep(0, 1, this.gather);
    for (const w of this.walkers) {
      const mesh = this.walkerMeshes[w.look];
      touched.add(w.look);
      if (t < w.startAt) {
        mesh.setMatrixAt(w.i, this.m.makeScale(0, 0, 0));
        continue;
      }
      // Walkers stop where they are as the people gather (the true end).
      w.t += dt * w.speed * w.dir * (1 - gather);
      const L = w.route.len;
      if (w.t > L - 1 || w.t < 1) {
        w.dir = w.t > L - 1 ? -1 : 1;
        w.t = clamp(w.t, 1, L - 1);
      }
      along(w.route.path, w.route.cum, w.t, this.o);
      const nx = -this.o.dz;
      const nz = this.o.dx;
      const x = this.o.x + nx * w.side * w.route.half;
      const z = this.o.z + nz * w.side * w.route.half;
      let yaw = Math.atan2(this.o.dx * w.dir, this.o.dz * w.dir);
      if (gather > 0.01) yaw = Math.atan2(this.gatherAt.x - x, this.gatherAt.z - z);
      this.face(yaw, gather);
      this.m.compose(this.p.set(x, Math.max(g.terrain.heightAt(x, z), 0.2) + 0.16, z), this.q, this.s.set(1, 1, 1));
      mesh.setMatrixAt(w.i, this.m);
      (mesh.geometry.attributes.aSwing as THREE.InstancedBufferAttribute).setX(w.i, 1 - gather);
    }
    // A circle dance round the Nexus (no kneeling: they dance, then turn toward whoever has come among them).
    for (const d of this.dancers) {
      const mesh = this.walkerMeshes[d.look];
      touched.add(d.look);
      if (t < d.startAt) {
        mesh.setMatrixAt(d.i, this.m.makeScale(0, 0, 0));
        continue;
      }
      const appear = smoothstep(0, 2, t - d.startAt);
      d.a += dt * 0.16 * (1 - gather);
      const r = d.r - gather * 4.5;
      const x = this.center.x + Math.cos(d.a) * r;
      const z = this.center.z + Math.sin(d.a) * r;
      const hop = Math.abs(Math.sin(g.realTime * 3.2 + d.ph)) * 0.22 * (1 - gather);
      const yaw = gather > 0.01 ? Math.atan2(this.gatherAt.x - x, this.gatherAt.z - z) : Math.atan2(-Math.sin(d.a), Math.cos(d.a)) + Math.PI;
      this.face(yaw, gather);
      this.m.compose(this.p.set(x, Math.max(g.terrain.heightAt(x, z), 0.2) + 0.16 + hop, z), this.q, this.s.setScalar(appear));
      mesh.setMatrixAt(d.i, this.m);
      (mesh.geometry.attributes.aSwing as THREE.InstancedBufferAttribute).setX(d.i, 0.6 * (1 - gather));
    }
    for (const k of touched) {
      const mesh = this.walkerMeshes[k];
      mesh.instanceMatrix.needsUpdate = true;
      mesh.geometry.attributes.aSwing.needsUpdate = true;
    }
  }

  /** Turned to `yaw`; as they gather, leaning back a little, looking up at the light (no kneeling). */
  private face(yaw: number, gather: number) {
    this.q.setFromAxisAngle(this.up, yaw);
    if (gather > 0.01) this.q.multiply(this.tilt.setFromAxisAngle(this.side, -0.2 * gather));
  }
  private readonly tilt = new THREE.Quaternion();
  private readonly side = new THREE.Vector3(1, 0, 0);

  dispose() {
    this.game.scene.remove(this.group);
  }
}

/** Paving: vertex-coloured slabs, pushed a little toward the camera so they never fight the ground. */
const STREET_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });

