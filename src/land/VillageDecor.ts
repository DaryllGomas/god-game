import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { MAT, VILLAGER_PIVOT, jitterVerts, merge, paint, villagerParts } from '../art/Models';
import { seasonalMaterial } from '../entities/Forest';
import { treeVariant, TREE_VARIANTS } from '../entities/Nature';
import { assets } from '../assets';
import { VILLAGE_SITES, WORLD_SIZE } from '../config';
import { SHRINE_CLEARANCE } from '../shrines/stages';
import { Noise2D } from '../util/noise';
import { Rng } from '../util/rng';
import { smoothstep } from '../util/math';
import { ScatterSet, type ScatterItem } from './Scatter';
import { LAND_RES } from './groundLook';
import { LandPainter } from './LandMask';
import { TREE_TINTS } from './palette';
import { bushGeometry, flowerGeometry } from './Flora';
import type { Path } from './Roads';
import { PROP_MATS, barnGeometry, cartGeometry, haystackGeometry, lampGeometry, stallGeometry, wellGeometry, woodshedGeometry, workshopGeometry } from './VillageProps';

/**
 * Village density (v0.6): a lived-in village inside a woodland clearing. Purely visual (instanced, no collision, never an
 * entity): tree and bush clumps between the houses, a ring of woods round the edge, hedges, flowerbeds, garden plots and
 * wood piles by the cottages, and little walkers on the footpaths. Everything is re-checked against the live land mask and
 * the buildings every time the land plugin repaints (`refresh`): a decoration that would sit on a path, a building, a field,
 * a project site or the shrine ground is simply tucked away, so nothing here can ever stand where something is built.
 */

type Kind = 'tree' | 'bush' | 'flower' | 'hedge' | 'plot' | 'pile' | 'prop';
interface Entry {
  item: ScatterItem;
  kind: Kind;
  /** Base transform, restored whenever the spot is free. */
  y: number;
  sx: number;
  sy: number;
  sz: number;
  /** Own footprint radius. */
  r: number;
  /** The village it belongs to, and (for cottage garden bits) the one house it is allowed to touch. */
  v: Village;
  own: unknown;
  set: ScatterSet;
  hidden: boolean;
}

// Distance an item of each kind keeps from the centre of a building (before its own radius).
const HOUSE_R = 3.4;
const FIELD_R = 6.2;
const STORE_R = 5;

const CLUMP_COUNT = 15;
/** Extra villagers gathered round each prayer place, facing the heart. */
const GATHER = 9;
const WOOD_CELL = 6.2;

const LEAF = TREE_TINTS;
const WHITE = [new THREE.Color(1, 1, 1)];
const BLOOMS = [0xf2d24a, 0xf0a0b8, 0xf4f0e6, 0xa890e8];

function hedgeGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const n = 5;
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.7, 0.9);
    const g = jitterVerts(new THREE.IcosahedronGeometry(r, 1), r * 0.14, rng);
    g.scale(1, 0.85, 0.9);
    g.translate((i - (n - 1) / 2) * 0.95, r * 0.7, rng.range(-0.08, 0.08));
    parts.push(paint(g, [0x3d7a2a, 0x4c8a30, 0x356d27][i % 3], 0.2, rng));
  }
  return merge(parts);
}

function plotGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  parts.push(paint(new THREE.BoxGeometry(5.2, 0.5, 3.6).translate(0, 0.05, 0), 0x6a4a2a, 0.12, rng));
  const crops = [0x5a9a3a, 0x7aa83a, 0x4a8a3a, 0x8a5f8a];
  for (let row = 0; row < 4; row++) {
    const col = crops[row % crops.length];
    for (let i = 0; i < 6; i++) {
      const b = jitterVerts(new THREE.IcosahedronGeometry(rng.range(0.26, 0.38), 0), 0.04, rng);
      b.scale(1, 0.8, 1).translate(-2.1 + i * 0.84 + rng.range(-0.08, 0.08), 0.52, -1.25 + row * 0.83);
      parts.push(paint(b, col, 0.15, rng));
    }
  }
  // Two stakes with a string of rope across: reads as a tended plot.
  for (const x of [-2.5, 2.5]) parts.push(paint(new THREE.CylinderGeometry(0.06, 0.07, 1, 5).translate(x, 0.8, -1.9), 0x7a5a38));
  return merge(parts);
}

function pileGeometry(seed: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const logs: [number, number][] = [
    [-0.5, 0.25],
    [0, 0.25],
    [0.5, 0.25],
    [-0.25, 0.68],
    [0.25, 0.68],
    [0, 1.1],
  ];
  for (const [z, y] of logs) {
    const len = rng.range(1.5, 1.9);
    parts.push(paint(new THREE.CylinderGeometry(0.24, 0.24, len, 7).rotateZ(Math.PI / 2).translate(rng.range(-0.1, 0.1), y, z), [0x8a5a32, 0x7a4a2a, 0x946236][rng.int(0, 2)], 0.15, rng));
  }
  return merge(parts);
}

/** Walkers: one tiny villager (body, arms, legs fixed) per instance. */
function walkerGeometry(seed: number, tunic: number): THREE.BufferGeometry {
  const p = villagerParts(seed, tunic);
  const parts: THREE.BufferGeometry[] = [p.body.clone()];
  const P = VILLAGER_PIVOT;
  for (const x of [-P.armX, P.armX]) parts.push(p.arm.clone().translate(x, P.armY, 0));
  for (const x of [-P.legX, P.legX]) parts.push(p.leg.clone().translate(x, P.legY, 0));
  const g = merge(parts.map((q) => (q.index ? q.toNonIndexed() : q)));
  return g;
}

interface Walker {
  route: number; // index into the village's route list
  t: number; // metres along the route
  speed: number;
  dir: 1 | -1;
}

interface VillageRoutes {
  v: Village;
  routes: { p: Path; len: number; cum: number[] }[];
  walkers: Walker[];
  /** Several looks per village (outfits, hair, hats), instances dealt round them. */
  meshes: THREE.InstancedMesh[];
}

/** Walker looks per village. */
const WALKER_LOOKS = 5;

export class VillageDecor {
  readonly sets: { set: ScatterSet; kind: 'tree' | 'small' | 'rock'; maxCam: number }[] = [];
  readonly count = { trees: 0, small: 0, walkers: 0 };
  private readonly entries: Entry[] = [];
  private readonly villages: VillageRoutes[] = [];
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly e = new THREE.Euler();
  private readonly s = new THREE.Vector3();
  private readonly p = new THREE.Vector3();

  constructor(private readonly game: Game, roads: LandPainter) {
    const terrain = game.terrain;
    const half = WORLD_SIZE / 2;
    const rng = new Rng(0x71b11a9e);
    const nWood = new Noise2D(9301);
    const nrm = new THREE.Vector3();
    const K = LAND_RES / WORLD_SIZE;
    const roadAt = (x: number, z: number) => {
      const i = Math.floor((x + half) * K);
      const j = Math.floor((z + half) * K);
      if (i < 0 || j < 0 || i >= LAND_RES || j >= LAND_RES) return 0;
      return roads.data[(j * LAND_RES + i) * 4] / 255;
    };

    // Existing real trees and rocks, so decor never stacks on one.
    const solid: { x: number; z: number; r: number }[] = [];
    for (const e of game.entities) if (e.kind === 'tree' || e.kind === 'rock') solid.push({ x: e.pos.x, z: e.pos.z, r: e.kind === 'tree' ? 2.2 : 2.6 });
    const nearSolid = (x: number, z: number, pad: number) => solid.some((o) => Math.hypot(o.x - x, o.z - z) < o.r + pad);

    // ---- species groups (same as the world's decorative forest)
    const groups: Record<string, number[]> = { oak: [], pine: [], birch: [], blossom: [], any: [] };
    for (let i = 0; i < TREE_VARIANTS; i++) {
      const sp = assets.trees?.[i]?.species;
      (groups[sp ?? 'any'] ?? groups.any).push(i);
      groups.any.push(i);
    }
    const treeItems: ScatterItem[][] = Array.from({ length: TREE_VARIANTS }, () => []);
    const treeEntries: Entry[][] = Array.from({ length: TREE_VARIANTS }, () => []);
    const shrubGeos = [0, 1, 2, 3].map((i) => bushGeometry(300 + i * 31, i));
    const flowerGeos = BLOOMS.map((c, i) => flowerGeometry(500 + i * 13, c));
    const hedgeGeo = hedgeGeometry(811);
    const plotGeo = plotGeometry(812);
    const pileGeo = pileGeometry(813);
    const buckets = new Map<string, { items: ScatterItem[]; entries: Entry[] }>();
    const bucket = (k: string) => {
      let b = buckets.get(k);
      if (!b) buckets.set(k, (b = { items: [], entries: [] }));
      return b;
    };

    const addItem = (v: Village, kind: Kind, bucketKey: string, x: number, z: number, scale: number, own: unknown, r: number, opts: { yaw?: number; stretch?: number; tint?: number; lift?: number } = {}) => {
      const y = terrain.heightAt(x, z) - (opts.lift ?? 0.05);
      const sx = scale * (opts.stretch ?? 1);
      const item: ScatterItem = { x, y, z, yaw: opts.yaw ?? rng.range(0, 6.28), sx, sy: scale * rng.range(0.92, 1.12), sz: scale, tint: opts.tint ?? rng.int(0, LEAF.length - 1) };
      const entry: Entry = { item, kind, y, sx: item.sx, sy: item.sy, sz: item.sz, r, v, own, set: undefined as unknown as ScatterSet, hidden: false };
      const b = bucket(bucketKey);
      b.items.push(item);
      b.entries.push(entry);
      this.entries.push(entry);
      return entry;
    };

    const free = (x: number, z: number, v: Village, own: unknown, pad: number, maxSlope = 0.88) => {
      if (!terrain.isLand(x, z, 2.2)) return false;
      if (terrain.normalAt(x, z, nrm).y < maxSlope) return false;
      if (terrain.heightAt(x, z) > 46) return false;
      if (roadAt(x, z) > 0.1) return false;
      if (nearSolid(x, z, pad)) return false;
      return this.clearOfBuildings(x, z, v, own, pad, true);
    };
    const treeVar = (distFrac: number, h: number) => {
      const pine = 0.12 + 0.5 * smoothstep(0.9, 1.9, distFrac) + 0.4 * smoothstep(14, 30, h);
      const r = rng.next();
      const sp = r < pine ? 'pine' : r < pine + 0.2 ? 'birch' : r < pine + 0.215 ? 'blossom' : 'oak';
      const list = groups[sp].length ? groups[sp] : groups.any;
      return list[Math.floor(rng.next() * list.length)];
    };
    const putTree = (v: Village, x: number, z: number, size: number, distFrac: number) => {
      const h = terrain.heightAt(x, z);
      const vi = treeVar(distFrac, h);
      const y = h - 0.12;
      const item: ScatterItem = { x, y, z, yaw: rng.range(0, 6.28), sx: size, sy: size * rng.range(0.92, 1.18), sz: size, tint: rng.int(0, LEAF.length - 1) };
      const entry: Entry = { item, kind: 'tree', y, sx: item.sx, sy: item.sy, sz: item.sz, r: 3.4 * size + 0.8, v, own: null, set: undefined as unknown as ScatterSet, hidden: false };
      treeItems[vi].push(item);
      treeEntries[vi].push(entry);
      this.entries.push(entry);
      this.count.trees++;
    };

    for (const v of game.villages) {
      const c = v.center;
      const R = v.radius;
      const wp = v.worship.pos;

      // ---- lived-in props (village art pass 2026-10-16): a market round the storehouse, a well, a barn, a workshop,
      // woodsheds, carts, haystacks by the fields and lamp posts. Placed first, so the trees and bushes keep clear of them.
      const vIndex = Math.max(0, VILLAGE_SITES.findIndex((s) => s.name === v.name));
      const placeProp = (key: string, x: number, z: number, r: number, yaw: number) => {
        if (!free(x, z, v, null, r)) return false;
        if (nearSolid(x, z, r)) return false;
        addItem(v, 'prop', key, x, z, 1, null, r, { yaw, tint: 0, lift: 0.02 });
        solid.push({ x, z, r });
        this.count.small++;
        return true;
      };
      const facing = (x: number, z: number, tx: number, tz: number) => Math.atan2(tx - x, tz - z);
      const ringTry = (key: string, cx: number, cz: number, d0: number, d1: number, r: number, tries = 60, face?: [number, number]) => {
        for (let t = 0; t < tries; t++) {
          const a = rng.range(0, Math.PI * 2);
          const d = rng.range(d0, d1);
          const x = cx + Math.cos(a) * d;
          const z = cz + Math.sin(a) * d;
          const [fx, fz] = face ?? [cx, cz];
          if (Math.hypot(x - wp.x, z - wp.z) < SHRINE_CLEARANCE + r + 1) continue;
          if (placeProp(key, x, z, r, facing(x, z, fx, fz) + rng.range(-0.25, 0.25))) return true;
        }
        return false;
      };
      const sp = v.store.pos;
      for (let k = 0; k < 3; k++) ringTry(`stall-${vIndex}-${k}`, sp.x, sp.z, 8, 11.5, 2.2);
      ringTry('well', c.x, c.z, 7, 13, 1.7);
      ringTry('barn', c.x, c.z, 0.75 * R, 1.15 * R, 5.4, 120);
      for (let k = 0; k < 2; k++) ringTry('work', c.x, c.z, 0.45 * R, 1.05 * R, 3.9, 120);
      for (let k = 0; k < 2; k++) ringTry('shed', c.x, c.z, 0.45 * R, 1.1 * R, 2.6);
      for (let k = 0; k < 3; k++) ringTry(`cart-${k % 2}`, c.x, c.z, 0.2 * R, 0.9 * R, 1.7);
      for (const f of v.fields) for (let k = 0; k < 2; k++) ringTry(`hay-${k}`, f.pos.x, f.pos.z, 8, 10.5, 1.5, 30, [c.x, c.z]);
      // Lamps: round the market and the prayer place's approach, and one by each home's path.
      for (let k = 0; k < 4; k++) ringTry('lamp', sp.x, sp.z, 6.2, 7.5, 0.5, 20);
      for (let k = 0; k < 6; k++) {
        const a = (k / 6) * Math.PI * 2 + 0.3;
        const x = wp.x + Math.cos(a) * (SHRINE_CLEARANCE + 9.5);
        const z = wp.z + Math.sin(a) * (SHRINE_CLEARANCE + 9.5);
        placeProp('lamp', x, z, 0.5, facing(x, z, wp.x, wp.z));
      }
      for (const h of v.houses) ringTry('lamp', h.pos.x, h.pos.z, 5.5, 7, 0.5, 12);

      // ---- tree and bush clumps between the houses (inside the clearing)
      let clumps = 0;
      for (let t = 0; t < 400 && clumps < CLUMP_COUNT; t++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0.42, 1.12) * R;
        const x = c.x + Math.cos(a) * d;
        const z = c.z + Math.sin(a) * d;
        if (Math.hypot(x - wp.x, z - wp.z) < SHRINE_CLEARANCE + 4) continue;
        if (!free(x, z, v, null, 6)) continue;
        clumps++;
        const n = rng.int(2, 4);
        for (let i = 0; i < n; i++) {
          const ox = x + rng.range(-3.4, 3.4);
          const oz = z + rng.range(-3.4, 3.4);
          if (i && !free(ox, oz, v, null, 2.6)) continue;
          putTree(v, ox, oz, rng.range(0.42, 0.78), d / R);
        }
        for (let i = 0; i < rng.int(2, 4); i++) {
          const ox = x + rng.range(-4.6, 4.6);
          const oz = z + rng.range(-4.6, 4.6);
          if (!free(ox, oz, v, null, 1.6)) continue;
          const s = rng.range(0.7, 1.25);
          addItem(v, 'bush', `shrub-${rng.int(0, 3)}`, ox, oz, s, null, 1.3 * s, { stretch: rng.range(0.9, 1.25) });
          this.count.small++;
        }
      }
      // Scattered single bushes and flower drifts in the open ground.
      for (let t = 0; t < 260; t++) {
        const a = rng.range(0, Math.PI * 2);
        const d = rng.range(0.4, 1.25) * R;
        const x = c.x + Math.cos(a) * d;
        const z = c.z + Math.sin(a) * d;
        if (Math.hypot(x - wp.x, z - wp.z) < SHRINE_CLEARANCE + 3) continue;
        if (!free(x, z, v, null, 1.4)) continue;
        if (rng.next() < 0.45) {
          const s = rng.range(0.6, 1.1);
          addItem(v, 'bush', `shrub-${rng.int(0, 3)}`, x, z, s, null, 1.2 * s);
        } else {
          const k = rng.int(0, 3);
          addItem(v, 'flower', `flower-${k}`, x, z, rng.range(0.9, 1.5), null, 0.8, { tint: 0 });
        }
        this.count.small++;
      }

      // ---- the woodland rim: a loose ring of trees, thinning toward the clearing
      for (let gz = -2.0 * R; gz <= 2.0 * R; gz += WOOD_CELL) {
        for (let gx = -2.0 * R; gx <= 2.0 * R; gx += WOOD_CELL) {
          const x = c.x + gx + rng.range(-2.2, 2.2);
          const z = c.z + gz + rng.range(-2.2, 2.2);
          const d = Math.hypot(x - c.x, z - c.z) / R;
          if (d < 1.0 || d > 1.95) continue;
          const wood = nWood.fbm(x * 0.03, z * 0.03, 3) * 0.5 + 0.5;
          const p = smoothstep(1.0, 1.35, d) * (1 - 0.5 * smoothstep(1.7, 1.95, d)) * (0.35 + 0.8 * wood);
          if (rng.next() > p) continue;
          if (!free(x, z, v, null, 2.2, 0.8)) continue;
          putTree(v, x, z, rng.range(0.55, 1.15) * (0.8 + 0.3 * wood), d);
          if (rng.next() < 0.35) {
            const bx = x + rng.range(-3, 3);
            const bz = z + rng.range(-3, 3);
            if (free(bx, bz, v, null, 1.2, 0.8)) {
              const s = rng.range(0.8, 1.4);
              addItem(v, 'bush', `shrub-${rng.int(0, 3)}`, bx, bz, s, null, 1.3 * s);
              this.count.small++;
            }
          }
        }
      }

      // ---- cottage gardens: hedges, flowerbeds, a plot behind and a wood pile at the side
      for (const h of v.houses) {
        const hx = h.pos.x;
        const hz = h.pos.z;
        const rot = Math.atan2(c.x - hx, c.z - hz);
        const fx = Math.sin(rot); // toward the village centre
        const fz = Math.cos(rot);
        const px = -fz; // across
        const pz = fx;
        // Offsets were laid out round a 4.9 x 4.2 cottage: spread them with the house's own size.
        const kf = Math.max(1, h.footD / 4.2);
        const ks = Math.max(1, h.footW / 4.9);
        const at = (f: number, s: number): [number, number] => [hx + fx * f * kf + px * s * ks, hz + fz * f * kf + pz * s * ks];
        const tryAdd = (kind: Kind, key: string, f: number, s: number, scale: number, r: number, opts: { yaw?: number; stretch?: number; tint?: number; lift?: number } = {}) => {
          const [x, z] = at(f, s);
          if (!free(x, z, v, h, r * 0.6, 0.85)) return;
          addItem(v, kind, key, x, z, scale, h, r, opts);
          this.count.small++;
        };
        const across = Math.atan2(-pz, px); // a model's long x axis, turned to run across the house
        tryAdd('hedge', 'hedge', 4.6, -2.6, 1.0, 2.6, { yaw: across, tint: 0 });
        tryAdd('hedge', 'hedge', 4.6, 2.6, 1.0, 2.6, { yaw: across, tint: 0 });
        tryAdd('flower', `flower-${rng.int(0, 3)}`, 3.9, -1.2, rng.range(1.2, 1.6), 1, { tint: 0 });
        tryAdd('flower', `flower-${rng.int(0, 3)}`, 3.9, 1.3, rng.range(1.2, 1.6), 1, { tint: 0 });
        tryAdd('flower', `flower-${rng.int(0, 3)}`, 1.5, rng.pick([-4.2, 4.2]), rng.range(1.0, 1.4), 1, { tint: 0 });
        tryAdd('plot', 'plot', -7.2, rng.range(-1.5, 1.5), 1.0, 3.2, { yaw: across, tint: 0, lift: 0.18 });
        tryAdd('pile', 'pile', -1.2, rng.pick([-4.6, 4.6]), 1.0, 1.6, { yaw: across + rng.range(-0.4, 0.4), tint: 0, lift: 0.1 });
        tryAdd('bush', `shrub-${rng.int(0, 3)}`, -3.6, rng.pick([-3.8, 3.8]), rng.range(0.8, 1.2), 1.4);
      }

      // ---- walkers (routes get filled in by the land plugin on every repaint)
      const tunic = VILLAGE_SITES.find((s) => s.name === v.name)?.tunic ?? 0x3f6fc4;
      // Village art pass: more people about, as in the storyboard's busy village.
      const count = 20 + v.houses.length * 3 + GATHER;
      const meshes: THREE.InstancedMesh[] = [];
      for (let k = 0; k < WALKER_LOOKS; k++) {
        const mesh = new THREE.InstancedMesh(walkerGeometry(40 + this.villages.length * 17 + k * 101, tunic), MAT.base, Math.ceil(count / WALKER_LOOKS) + 1);
        mesh.count = 0;
        mesh.frustumCulled = false;
        mesh.castShadow = true;
        mesh.name = `walkers-${v.name}-${k}`;
        game.scene.add(mesh);
        meshes.push(mesh);
      }
      const walkers: Walker[] = [];
      for (let i = 0; i < count - GATHER; i++) walkers.push({ route: i, t: rng.range(0, 60), speed: rng.range(1.1, 1.7), dir: rng.next() < 0.5 ? 1 : -1 });
      this.villages.push({ v, routes: [], walkers, meshes });
      this.count.walkers += count;
    }

    // ---- build the draw sets
    for (let vi = 0; vi < TREE_VARIANTS; vi++) {
      if (!treeItems[vi].length) continue;
      const sp = assets.trees?.[vi]?.species ?? 'oak';
      const code = ({ oak: 0, pine: 1, birch: 2, blossom: 3 } as Record<string, number>)[sp] ?? 0;
      const set = new ScatterSet(game.scene, treeVariant(vi).geo, seasonalMaterial(code), treeItems[vi], LEAF, `vdecor-tree-${vi}`);
      for (const en of treeEntries[vi]) en.set = set;
      this.sets.push({ set, kind: 'tree', maxCam: 1e9 });
    }
    const leafMat = seasonalMaterial(0);
    for (const [key, b] of buckets) {
      let geo: THREE.BufferGeometry;
      let mat: THREE.Material = leafMat;
      let tints = LEAF;
      const idx = Number(key.split('-')[1]);
      if (key.startsWith('shrub-')) geo = shrubGeos[idx];
      else if (key.startsWith('flower-')) {
        geo = flowerGeos[idx];
        tints = WHITE;
      } else if (key === 'hedge') {
        geo = hedgeGeo;
        tints = WHITE;
      } else if (key.startsWith('stall-') || ['well', 'barn', 'work', 'shed', 'lamp'].includes(key) || key.startsWith('cart-') || key.startsWith('hay-')) {
        const k = key.split('-');
        geo =
          k[0] === 'stall' ? stallGeometry(900 + Number(k[2]) * 7 + Number(k[1]) * 31, VILLAGE_SITES[Number(k[1])]?.tunic ?? 0x3f6fc4)
          : k[0] === 'well' ? wellGeometry(901)
          : k[0] === 'barn' ? barnGeometry(902)
          : k[0] === 'work' ? workshopGeometry(903)
          : k[0] === 'shed' ? woodshedGeometry(904)
          : k[0] === 'cart' ? cartGeometry(905 + Number(k[1]))
          : k[0] === 'hay' ? haystackGeometry(907 + Number(k[1]))
          : lampGeometry();
        mat = k[0] === 'work' || k[0] === 'lamp' ? (PROP_MATS as unknown as THREE.Material) : MAT.base;
        tints = WHITE;
      } else if (key === 'plot') {
        geo = plotGeo;
        mat = MAT.base;
        tints = WHITE;
      } else {
        geo = pileGeo;
        mat = MAT.base;
        tints = WHITE;
      }
      const set = new ScatterSet(game.scene, geo, mat, b.items, tints, `vdecor-${key}`);
      for (const en of b.entries) en.set = set;
      // The village props are buildings-sized: they cast shadows and stay in view further out.
      const prop = b.entries[0]?.kind === 'prop';
      set.mesh.castShadow = prop;
      this.sets.push({ set, kind: 'small', maxCam: prop ? 900 : 420 });
    }
  }

  /** True when (x, z) with footprint `pad` is clear of every building, the shrine ground and project sites of village `v`. */
  private clearOfBuildings(x: number, z: number, v: Village, own: unknown, pad: number, loose = false): boolean {
    const near = (px: number, pz: number, r: number) => Math.hypot(px - x, pz - z) < r + pad;
    const shrine = v.worship.pos;
    if (near(shrine.x, shrine.z, SHRINE_CLEARANCE * (loose ? 0.95 : 1))) return false;
    if (near(v.store.pos.x, v.store.pos.z, STORE_R)) return false;
    for (const h of v.houses) if (h !== own && near(h.pos.x, h.pos.z, Math.max(HOUSE_R, h.footW * 0.62))) return false;
    for (const f of v.fields) if (near(f.pos.x, f.pos.z, FIELD_R)) return false;
    for (const o of v.obstacles) if (near(o.pos.x, o.pos.z, o.radius)) return false;
    if (v.projectSite && !v.projectSite.complete && near(v.projectSite.pos.x, v.projectSite.pos.z, v.projectSite.def.radius + 3)) return false;
    return true;
  }

  /** Re-test every decoration against the live land mask (paths) and the buildings; tuck away what would be in the way. */
  refresh(live: LandPainter, routes: Map<Village, Path[]>) {
    const half = WORLD_SIZE / 2;
    const K = LAND_RES / WORLD_SIZE;
    const pathAt = (x: number, z: number) => {
      const i = Math.floor((x + half) * K);
      const j = Math.floor((z + half) * K);
      if (i < 0 || j < 0 || i >= LAND_RES || j >= LAND_RES) return 0;
      return live.data[(j * LAND_RES + i) * 4] / 255;
    };
    const touched = new Set<ScatterSet>();
    for (const en of this.entries) {
      const it = en.item;
      const ownAlive = en.own ? (en.own as { alive: boolean }).alive : true;
      const rr = en.r * 0.45;
      let blocked =
        !ownAlive ||
        pathAt(it.x, it.z) > 0.07 ||
        pathAt(it.x + rr, it.z) > 0.12 ||
        pathAt(it.x - rr, it.z) > 0.12 ||
        pathAt(it.x, it.z + rr) > 0.12 ||
        pathAt(it.x, it.z - rr) > 0.12;
      if (!blocked) blocked = !this.clearOfBuildings(it.x, it.z, en.v, en.own, en.kind === 'tree' ? en.r * 0.8 : en.r * 0.4);
      if (blocked !== en.hidden) {
        en.hidden = blocked;
        if (blocked) {
          it.sx = it.sy = it.sz = 0.001;
          it.y = en.y - 40;
        } else {
          it.sx = en.sx;
          it.sy = en.sy;
          it.sz = en.sz;
          it.y = en.y;
        }
        touched.add(en.set);
      }
    }
    for (const s of touched) s.invalidate();
    for (const vr of this.villages) {
      const list = routes.get(vr.v) ?? [];
      vr.routes = list
        .filter((p) => p.length > 1)
        .map((p) => {
          const cum = [0];
          for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
          return { p, len: cum[cum.length - 1], cum };
        })
        .filter((r) => r.len > 8);
    }
  }

  /** Move the walkers along their routes; hidden when the camera is far out. */
  frame(dt: number, camDist: number) {
    const near = camDist < 480;
    const time = this.game.time;
    for (const vr of this.villages) {
      for (const m of vr.meshes) m.visible = near;
      if (!near) continue;
      let n = 0;
      const L = vr.meshes.length;
      const put = (k: number) => vr.meshes[k % L].setMatrixAt(Math.floor(k / L), this.m);
      for (const w of vr.walkers) {
        if (!vr.routes.length) break;
        const route = vr.routes[w.route % vr.routes.length];
        w.t += w.dir * w.speed * dt;
        if (w.t > route.len) {
          w.t = route.len;
          w.dir = -1;
        } else if (w.t < 0) {
          w.t = 0;
          w.dir = 1;
        }
        // Position and heading at distance w.t along the polyline.
        let i = 1;
        while (i < route.cum.length - 1 && route.cum[i] < w.t) i++;
        const seg = Math.max(route.cum[i] - route.cum[i - 1], 1e-4);
        const f = Math.min(1, Math.max(0, (w.t - route.cum[i - 1]) / seg));
        const a = route.p[i - 1];
        const b = route.p[i];
        const x = a.x + (b.x - a.x) * f;
        const z = a.z + (b.z - a.z) * f;
        const heading = Math.atan2((b.x - a.x) * w.dir, (b.z - a.z) * w.dir);
        const y = this.game.terrain.heightAt(x, z) + 0.06 * Math.abs(Math.sin(time * 6 + w.speed * 9));
        if (!Number.isFinite(x + y + z + heading)) continue;
        this.e.set(0, heading, Math.sin(time * 6 + w.speed * 9) * 0.04);
        this.q.setFromEuler(this.e);
        this.m.compose(this.p.set(x, y, z), this.q, this.s.set(1.32, 1.32, 1.32));
        put(n++);
      }
      // Gatherers: a loose ring round the heart, swaying a little, facing the centre.
      const wp = vr.v.worship.pos;
      for (let i = 0; i < GATHER; i++) {
        const ang = (i / GATHER) * Math.PI * 2 + 0.4 + Math.sin(i * 7.3) * 0.15;
        // Outside the stones once they stand (the court is theirs), close round the totem before that.
        const rad = (vr.v.shrineStage === 'totem' ? 9.5 : 13.6) + (i % 3) * 1.6;
        const gx = wp.x + Math.cos(ang) * rad;
        const gz = wp.z + Math.sin(ang) * rad;
        const gy = this.game.terrain.heightAt(gx, gz) + 0.05 * Math.abs(Math.sin(time * 1.6 + i * 2.1));
        const heading = Math.atan2(wp.x - gx, wp.z - gz);
        if (!Number.isFinite(gx + gy + gz + heading)) continue;
        this.e.set(0, heading, Math.sin(time * 1.1 + i) * 0.03);
        this.q.setFromEuler(this.e);
        this.m.compose(this.p.set(gx, gy, gz), this.q, this.s.set(1.32, 1.32, 1.32));
        put(n++);
      }
      for (let k = 0; k < L; k++) {
        vr.meshes[k].count = Math.floor(n / L) + (k < n % L ? 1 : 0);
        vr.meshes[k].instanceMatrix.needsUpdate = true;
      }
    }
  }
}
