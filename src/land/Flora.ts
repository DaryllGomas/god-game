import * as THREE from 'three';
import type { Game } from '../Game';
import { MAT, jitterVerts, merge, paint, rockGeometry } from '../art/Models';
import { seasonalMaterial } from '../entities/Forest';
import { treeVariant, TREE_VARIANTS } from '../entities/Nature';
import { assets } from '../assets';
import { SEA_LEVEL, VILLAGE_SITES, WORLD_SIZE } from '../config';
import { Noise2D } from '../util/noise';
import { Rng } from '../util/rng';
import { smoothstep } from '../util/math';
import { ScatterSet, type ScatterItem } from './Scatter';
import { CH_FLOOR, LandPainter } from './LandMask';
import { TREE_TINTS } from './palette';

// ---- tuning knobs
const TREE_CELL = 5.4; // metres between decorative tree cells (jittered)
const TREE_CAP = 4600;
const SHRUB_CELL = 6.5;
const SHRUB_CAP = 3200;
const FLOWER_CELL = 7;
const FLOWER_CAP = 1800;
const ROCK_CAP = 1500;
/** Real groves (Game.buildWorld) reach 2.1 village radii; decor starts past that so every tree you can reach is a real one. */
const VILLAGE_CLEAR = 2.0;
const SHRUB_VILLAGE_CLEAR = 1.05;
const MIN_TREE_H = 2.7;
const MAX_TREE_H = 54;
const MIN_TREE_NY = 0.6; // steeper than this stays bare rock

const LEAF_TINTS = TREE_TINTS;
const ROCK_TINTS = [new THREE.Color(1, 1, 1), new THREE.Color(0.88, 0.8, 0.7), new THREE.Color(0.7, 0.8, 0.62), new THREE.Color(0.66, 0.63, 0.62)];
const WHITE = [new THREE.Color(1, 1, 1)];

/** A shrub: two or three low jittered blobs. */
export function bushGeometry(seed: number, hue: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const cols = [0x4c8a30, 0x3d7a2a, 0x5f9a38, 0x6b8f34][hue % 4];
  const n = rng.int(2, 3);
  for (let i = 0; i < n; i++) {
    const r = rng.range(0.55, 0.9);
    const g = jitterVerts(new THREE.IcosahedronGeometry(r, 1), r * 0.16, rng);
    g.scale(1, rng.range(0.62, 0.85), 1);
    g.translate(rng.range(-0.55, 0.55), r * 0.55, rng.range(-0.55, 0.55));
    parts.push(paint(g, cols, 0.22, rng));
  }
  return merge(parts);
}

/** A flowering clump: a squat green mound studded with coloured blooms. */
export function flowerGeometry(seed: number, bloom: number): THREE.BufferGeometry {
  const rng = new Rng(seed);
  const parts: THREE.BufferGeometry[] = [];
  const mound = jitterVerts(new THREE.IcosahedronGeometry(0.55, 1), 0.07, rng);
  mound.scale(1, 0.55, 1).translate(0, 0.18, 0);
  parts.push(paint(mound, 0x4a8a30, 0.2, rng));
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2);
    const d = rng.range(0, 0.38);
    const b = new THREE.IcosahedronGeometry(rng.range(0.09, 0.15), 0);
    b.translate(Math.cos(a) * d, 0.3 + (0.38 - d) * 0.35, Math.sin(a) * d);
    parts.push(paint(b, bloom, 0.12, rng));
  }
  return merge(parts);
}

export interface Flora {
  sets: { set: ScatterSet; kind: 'tree' | 'small' | 'rock'; maxCam: number }[];
  /** Forest-floor shade stamped under every decorative tree (copy it into the live mask each rebuild). */
  floor: LandPainter;
  count: { trees: number; shrubs: number; flowers: number; rocks: number };
}

/**
 * Builds all decorative nature: mixed forests in clusters and along the hills, shrubs, flower clumps and rocks,
 * with boulders and stone ledges along the shore. Static and deterministic; see Scatter.ts for the drawing.
 * `roads` is a painter whose path channel marks the road corridors to keep clear.
 */
export function buildFlora(game: Game, roads: LandPainter): Flora {
  const terrain = game.terrain;
  const half = WORLD_SIZE / 2;
  const rng = new Rng(0x7e11a);
  const noiseF = new Noise2D(9101);
  const noiseS = new Noise2D(9102);
  const noiseM = new Noise2D(9103);
  const noiseC = new Noise2D(9104);
  const nrm = new THREE.Vector3();
  const floor = new LandPainter();

  // Existing (real, game-entity) trees, so decor never overlaps one.
  const real = new Map<number, true>();
  const key = (x: number, z: number) => Math.floor(x / 4) * 4096 + Math.floor(z / 4);
  for (const e of game.entities) if (e.kind === 'tree' || e.kind === 'house' || e.kind === 'field' || e.kind === 'store') real.set(key(e.pos.x, e.pos.z), true);
  const nearReal = (x: number, z: number) => {
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) if (real.has(key(x + a * 4, z + b * 4))) return true;
    return false;
  };
  const roadAt = (x: number, z: number) => {
    const k = LAND_RES_K;
    const i = Math.floor((x + half) * k);
    const j = Math.floor((z + half) * k);
    if (i < 0 || j < 0 || i >= LAND_RES_N || j >= LAND_RES_N) return 0;
    return roads.data[(j * LAND_RES_N + i) * 4] / 255;
  };
  const villageDist = (x: number, z: number) => {
    let m = 1e9;
    for (const s of VILLAGE_SITES) m = Math.min(m, Math.hypot(x - s.x, z - s.z) / s.radius);
    return m;
  };

  // ---- species groups from the Blender set (or one pool when it's the procedural fallback)
  const groups: Record<string, number[]> = { oak: [], pine: [], birch: [], blossom: [], any: [] };
  for (let i = 0; i < TREE_VARIANTS; i++) {
    const sp = assets.trees?.[i]?.species;
    (groups[sp ?? 'any'] ?? groups.any).push(i);
    groups.any.push(i);
  }
  const pickFrom = (list: number[]) => list[Math.floor(rng.next() * list.length)];

  // ---- trees
  const treeItems: ScatterItem[][] = Array.from({ length: TREE_VARIANTS }, () => []);
  let trees = 0;
  for (let gz = -half; gz < half && trees < TREE_CAP; gz += TREE_CELL) {
    for (let gx = -half; gx < half && trees < TREE_CAP; gx += TREE_CELL) {
      const x = gx + rng.range(-2, 2) + TREE_CELL / 2;
      const z = gz + rng.range(-2, 2) + TREE_CELL / 2;
      const h = terrain.heightAt(x, z);
      if (h < MIN_TREE_H || h > MAX_TREE_H) continue;
      terrain.normalAt(x, z, nrm);
      if (nrm.y < MIN_TREE_NY) continue;
      const vd = villageDist(x, z);
      if (vd < VILLAGE_CLEAR) continue;
      // Forest clusters: broad noise picks woods, finer noise carves glades, hills and slopes pull trees in.
      const hills = smoothstep(9, 26, h) * 0.3 + (1 - nrm.y) * 0.9;
      const wood = noiseF.fbm(x * 0.012, z * 0.012, 3) * 0.55 + hills + noiseC.noise(x * 0.05, z * 0.05) * 0.18;
      const p = smoothstep(0.1, 0.48, wood) * (0.55 + 0.45 * smoothstep(1.9, 2.8, vd));
      if (rng.next() > p) continue;
      if (roadAt(x, z) > 0.12 || nearReal(x, z)) continue;
      // Species by altitude and slope: pines climb, broadleaf and birch hold the low ground.
      const pinePull = 0.12 + 0.62 * smoothstep(12, 34, h) + 0.5 * (1 - nrm.y);
      const r = rng.next();
      const sp = r < pinePull ? 'pine' : r < pinePull + 0.14 ? 'birch' : r < pinePull + 0.145 ? 'blossom' : 'oak';
      const list = groups[sp].length ? groups[sp] : groups.any;
      const v = pickFrom(list);
      // Big near the middle of a wood, smaller at the edges and up high.
      const size = (0.62 + 0.55 * rng.next() + 0.3 * smoothstep(0.1, 0.5, wood)) * (1 - 0.3 * smoothstep(34, 54, h));
      treeItems[v].push({ x, y: h - 0.12, z, yaw: rng.range(0, 6.28), sx: size, sy: size * rng.range(0.92, 1.18), sz: size, tint: rng.int(0, LEAF_TINTS.length - 1) });
      floor.disc(x, z, 4.4 * size + 1.2, CH_FLOOR, 0.95, 0.35);
      trees++;
    }
  }

  // ---- shrubs, flowers
  const shrubGeos = [0, 1, 2, 3].map((i) => bushGeometry(300 + i * 31, i));
  const shrubItems: ScatterItem[][] = shrubGeos.map(() => []);
  let shrubs = 0;
  for (let gz = -half; gz < half && shrubs < SHRUB_CAP; gz += SHRUB_CELL) {
    for (let gx = -half; gx < half && shrubs < SHRUB_CAP; gx += SHRUB_CELL) {
      const x = gx + rng.range(0, SHRUB_CELL);
      const z = gz + rng.range(0, SHRUB_CELL);
      const h = terrain.heightAt(x, z);
      if (h < 2.4 || h > 50) continue;
      terrain.normalAt(x, z, nrm);
      if (nrm.y < 0.62) continue;
      if (villageDist(x, z) < SHRUB_VILLAGE_CLEAR) continue;
      const d = noiseS.fbm(x * 0.02, z * 0.02, 3) * 0.6 + noiseS.noise(x * 0.11, z * 0.11) * 0.4;
      if (rng.next() > smoothstep(-0.1, 0.35, d) * 0.9) continue;
      if (roadAt(x, z) > 0.1 || nearReal(x, z)) continue;
      const s = rng.range(0.55, 1.35);
      shrubItems[rng.int(0, 3)].push({ x, y: h - 0.05, z, yaw: rng.range(0, 6.28), sx: s * rng.range(0.9, 1.3), sy: s, sz: s * rng.range(0.9, 1.3), tint: rng.int(0, LEAF_TINTS.length - 1) });
      shrubs++;
    }
  }
  const BLOOMS = [0xf2d24a, 0xf0a0b8, 0xf4f0e6, 0xa890e8];
  const flowerGeos = BLOOMS.map((c, i) => flowerGeometry(500 + i * 13, c));
  const flowerItems: ScatterItem[][] = flowerGeos.map(() => []);
  let flowers = 0;
  for (let gz = -half; gz < half && flowers < FLOWER_CAP; gz += FLOWER_CELL) {
    for (let gx = -half; gx < half && flowers < FLOWER_CAP; gx += FLOWER_CELL) {
      const x = gx + rng.range(0, FLOWER_CELL);
      const z = gz + rng.range(0, FLOWER_CELL);
      const h = terrain.heightAt(x, z);
      if (h < 2.8 || h > 36) continue;
      terrain.normalAt(x, z, nrm);
      if (nrm.y < 0.8) continue;
      if (villageDist(x, z) < 0.8) continue;
      const m = noiseM.fbm(x * 0.03, z * 0.03, 2);
      if (rng.next() > smoothstep(0.1, 0.45, m) * 0.85) continue;
      if (roadAt(x, z) > 0.08 || nearReal(x, z)) continue;
      const s = rng.range(0.8, 1.5);
      flowerItems[Math.min(3, Math.floor((m * 7 + 4) % 4))].push({ x, y: h - 0.05, z, yaw: rng.range(0, 6.28), sx: s, sy: s, sz: s, tint: 0 });
      flowers++;
    }
  }

  // ---- rocks: scattered boulders, hill outcrops, and the shoreline
  const rockGeos = [0, 1, 2, 3].map((i) => rockGeometry(700 + i * 17, 1));
  const rockItems: ScatterItem[][] = rockGeos.map(() => []);
  let rocks = 0;
  const addRock = (x: number, z: number, y: number, s: number, flat: number, tint: number) => {
    if (rocks >= ROCK_CAP) return;
    rockItems[rng.int(0, 3)].push({ x, y, z, yaw: rng.range(0, 6.28), sx: s * rng.range(0.9, 1.5), sy: s * flat, sz: s * rng.range(0.9, 1.4), tint });
    rocks++;
  };
  // Hills and open ground.
  for (let i = 0; i < 9000 && rocks < ROCK_CAP * 0.55; i++) {
    const x = rng.range(-half, half);
    const z = rng.range(-half, half);
    const h = terrain.heightAt(x, z);
    if (h < 3.0 || h > 62) continue;
    terrain.normalAt(x, z, nrm);
    const steep = 1 - nrm.y;
    if (rng.next() > 0.08 + steep * 1.6 + smoothstep(30, 55, h) * 0.5) continue;
    if (villageDist(x, z) < 1.1 || roadAt(x, z) > 0.1 || nearReal(x, z)) continue;
    const s = rng.range(0.5, 1.1) * (1 + steep * 2.2);
    addRock(x, z, h - 0.1 * s, s, rng.range(0.6, 0.95), rng.next() < 0.35 ? 2 : rng.next() < 0.5 ? 0 : 3);
  }
  // Shore: boulders in clusters and long stone ledges where the shore is steep enough to read as a cliff foot.
  for (let gz = -half; gz < half; gz += 3) {
    for (let gx = -half; gx < half; gx += 3) {
      if (rocks >= ROCK_CAP) break;
      const x = gx + rng.range(0, 3);
      const z = gz + rng.range(0, 3);
      const h = terrain.heightAt(x, z);
      if (h < 0.1 || h > 3.4) continue;
      // Is open water close by?
      let water = false;
      for (let a = 0; a < 6 && !water; a++) {
        const ang = a * 1.047;
        if (terrain.heightAt(x + Math.cos(ang) * 6, z + Math.sin(ang) * 6) < SEA_LEVEL - 0.2) water = true;
      }
      if (!water) continue;
      const shoreN = noiseS.noise(x * 0.025 + 40, z * 0.025);
      const rocky = smoothstep(-0.05, 0.4, shoreN);
      if (rng.next() > 0.05 + 0.5 * rocky * rocky) continue;
      if (villageDist(x, z) < 0.9 && rng.next() < 0.7) continue;
      const cluster = rng.int(1, 3);
      for (let c = 0; c < cluster; c++) {
        const ox = rng.range(-2, 2);
        const oz = rng.range(-2, 2);
        const y = Math.max(terrain.heightAt(x + ox, z + oz), 0.15);
        const big = rocky > 0.6 && rng.next() < 0.5;
        addRock(x + ox, z + oz, y - 0.25, big ? rng.range(1.7, 3.0) : rng.range(0.6, 1.5), big ? rng.range(0.7, 1.1) : rng.range(0.55, 0.9), big ? 3 : rng.next() < 0.5 ? 1 : 0);
      }
    }
  }

  // ---- build the draw sets
  const sets: Flora['sets'] = [];
  for (let v = 0; v < TREE_VARIANTS; v++) {
    if (!treeItems[v].length) continue;
    const sp = assets.trees?.[v]?.species ?? 'oak';
    const code = ({ oak: 0, pine: 1, birch: 2, blossom: 3 } as Record<string, number>)[sp] ?? 0;
    sets.push({ set: new ScatterSet(game.scene, treeVariant(v).geo, seasonalMaterial(code), treeItems[v], LEAF_TINTS, `decor-tree-${v}`), kind: 'tree', maxCam: 1e9 });
  }
  const leafMat = seasonalMaterial(0);
  shrubGeos.forEach((g, i) => {
    if (shrubItems[i].length) sets.push({ set: new ScatterSet(game.scene, g, leafMat, shrubItems[i], LEAF_TINTS, `decor-shrub-${i}`), kind: 'small', maxCam: 330 });
  });
  flowerGeos.forEach((g, i) => {
    if (flowerItems[i].length) sets.push({ set: new ScatterSet(game.scene, g, leafMat, flowerItems[i], WHITE, `decor-flower-${i}`), kind: 'small', maxCam: 220 });
  });
  rockGeos.forEach((g, i) => {
    if (rockItems[i].length) sets.push({ set: new ScatterSet(game.scene, g, MAT.base, rockItems[i], ROCK_TINTS, `decor-rock-${i}`), kind: 'rock', maxCam: 520 });
  });
  for (const s of sets) if (s.kind !== 'tree') s.set.mesh.castShadow = s.kind === 'rock';
  return { sets, floor, count: { trees, shrubs, flowers, rocks } };
}

const LAND_RES_N = 1024;
const LAND_RES_K = LAND_RES_N / WORLD_SIZE;
