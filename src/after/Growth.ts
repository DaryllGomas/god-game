import * as THREE from 'three';
import type { Game } from '../Game';
import type { Telor } from '../nexus/Telor';
import type { LandApi } from '../plugins/land';
import { CH_PATH, CH_WORN } from '../land/LandMask';
import type { Path } from '../land/Roads';
import { MAT } from '../art/Models';
import { LAMP_HEAD, TELOR_MATS, lampGeometry, townhouseGeometry } from '../nexus/TelorArt';
import { glowTexture } from '../rival/RivalVisuals';
import { aoSkip } from '../endings/CityLights';
import { Rng } from '../util/rng';
import { clamp, smoothstep } from '../util/math';
import { gardenGeometry } from './art';

// ------------------------------------------------------------------ tuning knobs

/** Telor's own wall and avenues (src/nexus/Telor.ts): the city grows outside them. */
const WALL_R = 93;
const AVENUE_HALF = 3.2;
/** Rings the city grows into past its walls (m from the Nexus): a road, houses facing it, their gardens behind. */
const RINGS = [
  { road: 101.5, house: 110, garden: 119 },
  { road: 128.5, house: 137, garden: 146 },
];
const ROAD_HALF = 2.2;
/** One lane step paves about this much road (m). */
const SEG_LEN = 34;
const HOUSE_GAP = 10.6;
const R_HOUSE = 4.7;
const R_GARDEN = 4.4;
const LAMP_GAP = 14;
/** Townhouse looks the edge of the city is built in (Telor's own seeds, so they match its streets). */
const HOUSE_SEEDS = [9100, 9100 + 2 * 37, 9100 + 4 * 37];
/** Game seconds: a house rises, a garden is dug, a lane is paved. */
const RISE = 2.6;
const RISE_GARDEN = 1.4;
const PAVE = 5;
/** Never more than this many steps of growth (the city's edge is the island's, in the end). */
const MAX_ITEMS = 150;
const SLAB = [0xd8c7a2, 0xcfbd96, 0xe0d0ad, 0xc8b68e, 0xd2c09a];
const KERB = 0x9a8a6e;
const LAMP_LIGHT = new THREE.Color(1.6, 1.08, 0.5);

export type GrowKind = 'lane' | 'house' | 'garden';

export interface GrowItem {
  kind: GrowKind;
  /** The lane it belongs to (index into the segments). */
  seg: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  r: number;
  /** House look (index into HOUSE_SEEDS) and its instance. */
  look: number;
  i: number;
  ring: number;
}

interface Segment {
  path: Path;
  ring: number;
  /** Vertex range of its paving in the road mesh. */
  from: number;
  to: number;
  /** Lamp instances along it. */
  lamps: number[];
  /** Game seconds since paving began (-1: not yet). */
  paved: number;
}

const distToPath = (p: Path, x: number, z: number): number => {
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
};

const cellKey = (x: number, z: number) => (Math.floor(x / 4) + 600) * 4096 + (Math.floor(z / 4) + 600);

/**
 * Telor keeps growing (after the true end, src/after): while you tend the island, the city adds a lane, a house or a
 * garden at its edge, one step at a time, outside its walls: a road round the wall with lamps, townhouses facing it,
 * kitchen gardens behind them, then a second ring further out. Planned once from the land (the same plan whenever it
 * is made, so a reload rebuilds exactly the city it had) and drawn instanced, on Telor's own materials.
 */
export class Growth {
  readonly group = new THREE.Group();
  readonly items: GrowItem[] = [];
  private readonly segs: Segment[] = [];
  /** Items fully built. */
  done = 0;
  /** The item rising now (index `done`), and game seconds into it. */
  private risingT = -1;
  private readonly houses: THREE.InstancedMesh[] = [];
  private readonly gardens: THREE.InstancedMesh;
  private readonly lamps: THREE.InstancedMesh;
  private readonly lampGlow: THREE.Points;
  private readonly lampAlpha: THREE.BufferAttribute;
  private readonly lampSeg: number[] = [];
  private readonly road: THREE.Mesh;
  private readonly cells = new Set<number>();
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly v = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private static readonly UP = new THREE.Vector3(0, 1, 0);
  /** An item has finished rising (not on a quiet rebuild). */
  onBuilt: ((it: GrowItem, index: number) => void) | null = null;

  constructor(
    private readonly game: Game,
    private readonly telor: Telor,
    /** Where the city grows from first (the shore the newcomers come in at), or null: out from its gates. */
    toward: THREE.Vector3 | null = null,
  ) {
    this.group.name = 'telor-growth';
    game.scene.add(this.group);
    this.plan(toward);
    // Houses, by look.
    const counts = HOUSE_SEEDS.map(() => 0);
    let gardens = 0;
    for (const it of this.items) {
      if (it.kind === 'house') it.i = counts[it.look]++;
      else if (it.kind === 'garden') it.i = gardens++;
    }
    HOUSE_SEEDS.forEach((seed, k) => this.houses.push(this.instanced(townhouseGeometry(seed), TELOR_MATS, counts[k], `growth-house-${k}`, true)));
    this.gardens = this.instanced(gardenGeometry(4711), MAT.base, gardens, 'growth-gardens', true);
    // Lamps along the lanes, each with its glow.
    const lampPos: number[] = [];
    const lampLots: { x: number; y: number; z: number; yaw: number }[] = [];
    this.segs.forEach((sg, si) => {
      let side = 1;
      const cum = [0];
      for (let i = 1; i < sg.path.length; i++) cum.push(cum[i - 1] + Math.hypot(sg.path[i].x - sg.path[i - 1].x, sg.path[i].z - sg.path[i - 1].z));
      for (let s = 4, k = 0; s < cum[cum.length - 1] - 2; s += LAMP_GAP, k++) {
        let i = 1;
        while (i < cum.length - 1 && cum[i] < s) i++;
        const a = sg.path[i - 1];
        const b = sg.path[i];
        const dl = Math.hypot(b.x - a.x, b.z - a.z) || 1;
        const nx = -(b.z - a.z) / dl;
        const nz = (b.x - a.x) / dl;
        side = -side;
        const off = ROAD_HALF + 0.9;
        const x = a.x + nx * side * off;
        const z = a.z + nz * side * off;
        if (!this.telor.isClear(x, z, 1.2) || !this.clearOfMine(x, z, 1.2, false) || this.h(x, z) < 1.4) continue;
        const yaw = Math.atan2(nz * side, -nx * side);
        const y = this.game.terrain.baseHeightAt(x, z);
        lampLots.push({ x, y, z, yaw });
        this.lampSeg.push(si);
        sg.lamps.push(lampLots.length - 1);
        const c = Math.cos(yaw);
        const sn = Math.sin(yaw);
        lampPos.push(x + LAMP_HEAD.x * c + LAMP_HEAD.z * sn, y + LAMP_HEAD.y, z - LAMP_HEAD.x * sn + LAMP_HEAD.z * c);
      }
    });
    this.lamps = this.instanced(lampGeometry(), TELOR_MATS, lampLots.length, 'growth-lamps', false);
    for (const l of lampLots) {
      this.q.setFromAxisAngle(Growth.UP, l.yaw);
      this.lampMats.push(new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.y, l.z), this.q.clone(), new THREE.Vector3(1, 1, 1)));
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(lampPos, 3));
    this.lampAlpha = new THREE.BufferAttribute(new Float32Array(lampLots.length), 1);
    geo.setAttribute('aAlpha', this.lampAlpha);
    this.lampGlow = new THREE.Points(
      geo,
      new THREE.ShaderMaterial({
        uniforms: { uMap: { value: glowTexture() }, uColor: { value: LAMP_LIGHT.clone() }, uScale: { value: 900 } },
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
    this.lampGlow.visible = false;
    this.group.add(this.lampGlow);
    aoSkip(game, this.lampGlow);
    this.road = this.roadMesh();
    // Nothing grows back where the city has grown.
    game.keepClear.push((x, z) => this.cells.has(cellKey(x, z)));
  }

  private readonly lampMats: THREE.Matrix4[] = [];

  private instanced(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], n: number, name: string, shadow: boolean): THREE.InstancedMesh {
    const mesh = new THREE.InstancedMesh(geo, mat, Math.max(1, n));
    mesh.count = n;
    mesh.castShadow = shadow;
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < n; i++) mesh.setMatrixAt(i, this.m.makeScale(0, 0, 0));
    mesh.name = name;
    mesh.visible = false;
    this.group.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- planning

  private get land(): LandApi | null {
    return (this.game as unknown as { land?: LandApi }).land ?? null;
  }

  private h(x: number, z: number) {
    return this.game.terrain.baseHeightAt(x, z);
  }

  private clearOfVillages(x: number, z: number, r: number): boolean {
    for (const v of this.game.villages) {
      if (Math.hypot(v.center.x - x, v.center.z - z) < v.radius * 1.12 + r) return false;
      if (Math.hypot(v.worship.pos.x - x, v.worship.pos.z - z) < 16 + r) return false;
    }
    return true;
  }

  private clearOfAvenues(x: number, z: number, r: number): boolean {
    for (const st of this.telor.avenues) if (distToPath(st.path, x, z) < AVENUE_HALF + r) return false;
    return true;
  }

  private clearOfMine(x: number, z: number, r: number, roads = true): boolean {
    for (const it of this.items) if (it.kind !== 'lane' && Math.hypot(it.x - x, it.z - z) < it.r + r) return false;
    if (roads) for (const sg of this.segs) if (distToPath(sg.path, x, z) < ROAD_HALF + r) return false;
    return true;
  }

  /** Dry, gentle ground for a footprint w x d at (x, z) turned `yaw`: the floor height, or null (as Telor plans). */
  private ground(x: number, z: number, w: number, d: number, yaw: number): number | null {
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
    if (lo < 1.4 || hi > 48 || hi - lo > 3.2) return null;
    return lo + (hi - lo) * 0.35 - 0.1;
  }

  private tryLot(kind: 'house' | 'garden', x: number, z: number, seg: number, ring: number, look: number): GrowItem | null {
    const c = this.telor.center;
    const r = kind === 'house' ? R_HOUSE : R_GARDEN;
    const yaw = Math.atan2(c.x - x, c.z - z);
    if (!this.clearOfVillages(x, z, r) || !this.telor.isClear(x, z, r * 0.92) || !this.clearOfAvenues(x, z, r * 0.8) || !this.clearOfMine(x, z, r * 0.92)) return null;
    const y = kind === 'house' ? this.ground(x, z, 8.4, 7.6, yaw) : this.ground(x, z, 7.6, 5.6, yaw);
    if (y === null) return null;
    const it: GrowItem = { kind, seg, x, y, z, yaw, r, look, i: 0, ring };
    this.items.push(it);
    return it;
  }

  /** Runs of good road round the ring at radius R (no water, no cliffs, clear of the villages and the city). */
  private ringRuns(R: number): Path[] {
    const c = this.telor.center;
    const n = Math.round((Math.PI * 2 * R) / 2);
    const runs: Path[] = [];
    let run: Path = [];
    let prevH = NaN;
    for (let i = 0; i <= n; i++) {
      const a = (i / n) * Math.PI * 2;
      const x = c.x + Math.cos(a) * R;
      const z = c.z + Math.sin(a) * R;
      const hh = this.h(x, z);
      const ok =
        hh > 1.8 && hh < 46 && (isNaN(prevH) || Math.abs(hh - prevH) < 1.2) && this.clearOfVillages(x, z, 4) && this.telor.isClear(x, z, ROAD_HALF + 0.8) && this.clearOfAvenues(x, z, ROAD_HALF + 1.5);
      prevH = hh;
      if (ok) run.push({ x, z });
      else {
        if (run.length > 8) runs.push(run);
        run = [];
      }
    }
    if (run.length > 8) runs.push(run);
    if (runs.length > 1) {
      const first = runs[0][0];
      const lastRun = runs[runs.length - 1];
      const last = lastRun[lastRun.length - 1];
      if (Math.hypot(first.x - last.x, first.z - last.z) < 3) {
        runs.pop();
        runs[0] = [...lastRun, ...runs[0]];
      }
    }
    return runs;
  }

  private plan(toward: THREE.Vector3 | null) {
    const c = this.telor.center;
    const rng = new Rng(Math.round(c.x * 13 + c.z * 7) ^ 0x5eed);
    const angleOf = (x: number, z: number) => Math.atan2(z - c.z, x - c.x);
    // Where each avenue leaves the walls: the city grows out from its gates first.
    const gates = this.telor.avenues.map((st) => {
      let best = st.path[0];
      let bd = Infinity;
      for (const p of st.path) {
        const d = Math.abs(Math.hypot(p.x - c.x, p.z - c.z) - (WALL_R + 8));
        if (d < bd) {
          bd = d;
          best = p;
        }
      }
      return angleOf(best.x, best.z);
    });
    const fromGate = (a: number) => Math.min(Math.PI, ...gates.map((g) => Math.abs(Math.atan2(Math.sin(a - g), Math.cos(a - g)))));
    // 1. The lanes: runs of road round each ring, cut into steps.
    const segs: { path: Path; ring: number; score: number }[] = [];
    RINGS.forEach((ring, ri) => {
      for (const run of this.ringRuns(ring.road)) {
        const per = Math.round(SEG_LEN / 2);
        for (let s = 0; s < run.length - 1; s += per) {
          let e = Math.min(run.length, s + per + 1);
          if (run.length - e < per * 0.5) e = run.length;
          const path = run.slice(s, e);
          if (path.length < 6) continue;
          const mid = path[Math.floor(path.length / 2)];
          // Nearest the harbour first (the newcomers' street), spreading round the ring both ways; else out from the gates.
          const near = toward ? Math.hypot(mid.x - toward.x, mid.z - toward.z) : fromGate(angleOf(mid.x, mid.z)) * ring.road;
          segs.push({ path, ring: ri, score: ri * 10000 + near + rng.range(0, 4) });
          if (e === run.length) break;
        }
      }
    });
    segs.sort((a, b) => a.score - b.score);
    // 2. Per lane: the road, then the houses facing it with their gardens behind, a garden a step after its house.
    for (const sg of segs) {
      if (this.items.length >= MAX_ITEMS) break;
      const si = this.segs.length;
      this.segs.push({ path: sg.path, ring: sg.ring, from: 0, to: 0, lamps: [], paved: -1 });
      const ring = RINGS[sg.ring];
      this.items.push({ kind: 'lane', seg: si, x: sg.path[0].x, y: 0, z: sg.path[0].z, yaw: 0, r: 0, look: 0, i: 0, ring: sg.ring });
      const a0 = angleOf(sg.path[0].x, sg.path[0].z);
      const a1 = angleOf(sg.path[sg.path.length - 1].x, sg.path[sg.path.length - 1].z);
      let span = Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0));
      if (span < 0) span += Math.PI * 2;
      const step = HOUSE_GAP / ring.house;
      const houses: GrowItem[] = [];
      const gardens: GrowItem[] = [];
      for (let a = a0 + step * 0.5; a < a0 + span - step * 0.3; a += step) {
        // tryLot keeps each lot in the plan as it goes, so the next one keeps clear of it.
        const h = this.tryLot('house', c.x + Math.cos(a) * ring.house, c.z + Math.sin(a) * ring.house, si, sg.ring, rng.int(0, HOUSE_SEEDS.length - 1));
        if (!h) continue;
        houses.push(h);
        const g = this.tryLot('garden', c.x + Math.cos(a) * ring.garden, c.z + Math.sin(a) * ring.garden, si, sg.ring, 0);
        if (g) gardens.push(g);
      }
      // This lane's lots in the order they grow: house, house, garden, house, garden...
      this.items.splice(this.items.length - houses.length - gardens.length);
      let gi = 0;
      houses.forEach((h, k) => {
        this.items.push(h);
        if (k >= 1 && gi < gardens.length) this.items.push(gardens[gi++]);
      });
      while (gi < gardens.length) this.items.push(gardens[gi++]);
    }
    this.items.splice(MAX_ITEMS);
    // Only lanes that are in the plan are kept.
    const lanes = new Set(this.items.filter((it) => it.kind === 'lane').map((it) => it.seg));
    this.segs.forEach((sg, i) => {
      if (!lanes.has(i)) sg.path = sg.path.slice(0, 0);
    });
  }

  // ---------------------------------------------------------------- the road

  /** All the lanes' paving in one mesh, in the order they are paved, laid by its draw range. */
  private roadMesh(): THREE.Mesh {
    const g = this.game;
    const pos: number[] = [];
    const col: number[] = [];
    const rng = new Rng(9911);
    const c = new THREE.Color();
    const cols = [-1, -1 + 0.4 / ROAD_HALF, 0, 1 - 0.4 / ROAD_HALF, 1];
    const order = this.items.filter((it) => it.kind === 'lane').map((it) => it.seg);
    for (const si of order) {
      const sg = this.segs[si];
      const p = sg.path;
      sg.from = pos.length / 3;
      const at = (i: number, u: number): [number, number, number] => {
        const a = p[Math.max(0, i - 1)];
        const b = p[Math.min(p.length - 1, i + 1)];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const l = Math.hypot(dx, dz) || 1;
        const x = p[i].x + (-dz / l) * u * ROAD_HALF;
        const z = p[i].z + (dx / l) * u * ROAD_HALF;
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
      sg.to = pos.length / 3;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals();
    geo.setDrawRange(0, 0);
    const mesh = new THREE.Mesh(geo, ROAD_MAT);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.name = 'growth-road';
    mesh.visible = false;
    this.group.add(mesh);
    return mesh;
  }

  // ---------------------------------------------------------------- building

  get size(): number {
    return this.items.length;
  }

  get busy(): boolean {
    return this.risingT >= 0;
  }

  get next(): GrowItem | null {
    return this.items[this.done] ?? null;
  }

  /** Begin the next step (a lane, a house or a garden). False if there is nothing left to grow or one is rising. */
  start(): boolean {
    if (this.busy || this.done >= this.items.length) return false;
    this.risingT = 0;
    this.begin(this.items[this.done], false);
    return true;
  }

  /** Quietly stand the first `n` steps (a reload). */
  buildTo(n: number) {
    n = Math.min(n, this.items.length);
    while (this.done < n) {
      const it = this.items[this.done];
      this.begin(it, true);
      this.place(it, 1);
      if (it.kind === 'lane') this.segs[it.seg].paved = PAVE;
      this.done++;
    }
    this.risingT = -1;
    this.flush();
  }

  /** The ground under a step is cleared and worn, and kept clear. */
  private begin(it: GrowItem, quiet: boolean) {
    const g = this.game;
    const land = this.land;
    if (it.kind === 'lane') {
      const sg = this.segs[it.seg];
      const path = sg.path;
      sg.paved = 0;
      land?.clear((x, z) => distToPath(path, x, z) < ROAD_HALF + 2.2);
      land?.paint((p) => p.path(path, ROAD_HALF + 0.8, CH_PATH, 1, 0.75));
      for (const pt of path) {
        g.forEachNear(pt.x, pt.z, ROAD_HALF + 1.5, (e) => {
          if ((e.kind === 'tree' || e.kind === 'rock') && !e.held) g.remove(e);
        });
        this.claim(pt.x, pt.z, ROAD_HALF + 1);
      }
      for (const li of sg.lamps) this.claim(this.lampMats[li].elements[12], this.lampMats[li].elements[14], 1);
      return;
    }
    g.forEachNear(it.x, it.z, it.r + 1, (e) => {
      if ((e.kind === 'tree' || e.kind === 'rock') && !e.held) {
        if (!quiet) g.fx.dust(e.pos.x, e.pos.y, e.pos.z, 6, 0.6);
        g.remove(e);
      }
    });
    land?.clear((x, z) => Math.hypot(it.x - x, it.z - z) < it.r + 1.5);
    land?.paint((p) => p.disc(it.x, it.z, it.r + 2.5, CH_WORN, 0.9, 0.5));
    this.claim(it.x, it.z, it.r + 1);
    if (!quiet) {
      g.fx.dust(it.x, it.y + 1, it.z, it.kind === 'house' ? 18 : 10, 1.6, 0xc8b490);
      g.audio.stoneSet(this.v.set(it.x, it.y, it.z), it.kind === 'house' ? 1.6 : 0.9);
    }
  }

  private claim(x: number, z: number, r: number) {
    for (let dx = -r; dx <= r; dx += 2) for (let dz = -r; dz <= r; dz += 2) this.cells.add(cellKey(x + dx, z + dz));
  }

  private place(it: GrowItem, k: number) {
    if (it.kind === 'lane') {
      const sg = this.segs[it.seg];
      const e = smoothstep(0, 1, k);
      this.road.geometry.setDrawRange(0, sg.from + Math.floor(((sg.to - sg.from) * e) / 6) * 6);
      this.road.visible = true;
      for (const li of sg.lamps) {
        // Lamps come up behind the paving.
        const at = (sg.lamps.indexOf(li) + 1) / (sg.lamps.length + 1);
        const kk = clamp((e - at * 0.8) / 0.2, 0, 1);
        this.m.copy(this.lampMats[li]);
        this.m.scale(this.s.setScalar(Math.max(0.0001, kk)));
        this.lamps.setMatrixAt(li, this.m);
        this.lampAlpha.setX(li, kk);
      }
      this.lamps.instanceMatrix.needsUpdate = true;
      this.lampAlpha.needsUpdate = true;
      this.lamps.visible = this.lampGlow.visible = true;
      return;
    }
    const mesh = it.kind === 'house' ? this.houses[it.look] : this.gardens;
    const e = k * k * (3 - 2 * k);
    this.q.setFromAxisAngle(Growth.UP, it.yaw);
    this.m.compose(this.v.set(it.x, it.y, it.z), this.q, this.s.set(1, Math.max(0.001, e), 1));
    mesh.setMatrixAt(it.i, this.m);
    mesh.instanceMatrix.needsUpdate = true;
    mesh.visible = true;
  }

  private flush() {
    for (const m of [...this.houses, this.gardens, this.lamps]) m.instanceMatrix.needsUpdate = true;
  }

  /** Simulation step (game seconds): the step that is rising rises. */
  update(dt: number) {
    if (this.risingT < 0) return;
    const it = this.items[this.done];
    if (!it) {
      this.risingT = -1;
      return;
    }
    this.risingT += dt;
    const dur = it.kind === 'lane' ? PAVE : it.kind === 'house' ? RISE : RISE_GARDEN;
    const k = clamp(this.risingT / dur, 0, 1);
    this.place(it, k);
    if (k >= 1) {
      if (it.kind === 'lane') this.segs[it.seg].paved = PAVE;
      this.risingT = -1;
      this.done++;
      this.game.fx.sparkle(it.x, it.y + 3, it.z, 16, 0xfff0b0, it.kind === 'lane' ? 3 : 5);
      this.onBuilt?.(it, this.done - 1);
    }
  }

  /** Per frame: the lamps glow with the night. */
  frame(night: number) {
    (this.lampGlow.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(LAMP_LIGHT).multiplyScalar(0.25 + night * 1.1);
  }

  /** Where the people of house `index` go in: in front of its door. */
  door(index: number, out = 1.5): THREE.Vector3 | null {
    const it = this.items[index];
    if (!it || it.kind !== 'house') return null;
    const f = 3.9 + out;
    const x = it.x + Math.sin(it.yaw) * f;
    const z = it.z + Math.cos(it.yaw) * f;
    return new THREE.Vector3(x, Math.max(this.game.terrain.heightAt(x, z), 0.2) + 0.16, z);
  }

  /** The outermost reach of the city so far (m from the Nexus). */
  get reach(): number {
    let r = WALL_R + 12;
    for (let i = 0; i < this.done; i++) r = Math.max(r, RINGS[this.items[i].ring].garden + 6);
    return r;
  }

  counts() {
    const built = this.items.slice(0, this.done);
    return {
      planned: this.items.length,
      done: this.done,
      lanes: built.filter((i) => i.kind === 'lane').length,
      houses: built.filter((i) => i.kind === 'house').length,
      gardens: built.filter((i) => i.kind === 'garden').length,
      next: this.next?.kind ?? null,
      rising: this.busy,
    };
  }
}

/** Paving, as Telor's: vertex-coloured slabs pushed a little toward the camera so they never fight the ground. */
const ROAD_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
