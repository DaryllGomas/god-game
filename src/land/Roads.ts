import type { Terrain } from '../world/Terrain';
import { SEA_LEVEL, WORLD_SIZE } from '../config';

/** A polyline in world xz. */
export type Path = { x: number; z: number }[];

const CELL = 5; // metres per search cell
const N = Math.round(WORLD_SIZE / CELL);
const HALF = WORLD_SIZE / 2;
const MIN_LAND = 2.0; // roads stay off the beach
const SLOPE_COST = 55; // how much a steep step is feared
const MAX_STEP_SLOPE = 0.7; // rise/run beyond this is impassable

/** Binary min-heap on (f, idx) for the A* open set. */
class Heap {
  private f: number[] = [];
  private v: number[] = [];
  get size() {
    return this.v.length;
  }
  push(f: number, v: number) {
    const F = this.f;
    const V = this.v;
    let i = V.length;
    F.push(f);
    V.push(v);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (F[p] <= F[i]) break;
      [F[p], F[i]] = [F[i], F[p]];
      [V[p], V[i]] = [V[i], V[p]];
      i = p;
    }
  }
  pop(): number {
    const F = this.f;
    const V = this.v;
    const top = V[0];
    const lf = F.pop()!;
    const lv = V.pop()!;
    if (V.length) {
      F[0] = lf;
      V[0] = lv;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < V.length && F[l] < F[m]) m = l;
        if (r < V.length && F[r] < F[m]) m = r;
        if (m === i) break;
        [F[m], F[i]] = [F[i], F[m]];
        [V[m], V[i]] = [V[i], V[m]];
        i = m;
      }
    }
    return top;
  }
}

const cx = (i: number) => (i % N) * CELL - HALF + CELL / 2;
const cz = (i: number) => Math.floor(i / N) * CELL - HALF + CELL / 2;
const cellOf = (x: number, z: number) =>
  Math.min(N - 1, Math.max(0, Math.floor((z + HALF) / CELL))) * N + Math.min(N - 1, Math.max(0, Math.floor((x + HALF) / CELL)));

/** Cheapest walkable route from (ax, az) to (bx, bz): around mountains, off the beach, preferring gentle ground. Null if none. */
export function findRoad(terrain: Terrain, ax: number, az: number, bx: number, bz: number, used?: Set<number>): Path | null {
  const start = cellOf(ax, az);
  const goal = cellOf(bx, bz);
  const g = new Float32Array(N * N).fill(Infinity);
  const from = new Int32Array(N * N).fill(-1);
  const open = new Heap();
  g[start] = 0;
  open.push(0, start);
  const hOf = (i: number) => terrain.heightAt(cx(i), cz(i));
  const gx = cx(goal);
  const gz = cz(goal);
  let guard = 0;
  while (open.size && guard++ < 200000) {
    const cur = open.pop();
    if (cur === goal) break;
    const x0 = cur % N;
    const z0 = Math.floor(cur / N);
    const h0 = hOf(cur);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dz) continue;
        const x1 = x0 + dx;
        const z1 = z0 + dz;
        if (x1 < 0 || z1 < 0 || x1 >= N || z1 >= N) continue;
        const nb = z1 * N + x1;
        const h1 = hOf(nb);
        if (h1 < MIN_LAND) continue;
        const run = Math.hypot(dx, dz) * CELL;
        const slope = Math.abs(h1 - h0) / run;
        if (slope > MAX_STEP_SLOPE) continue;
        const nc = g[cur] + (run * (1 + SLOPE_COST * slope * slope) + (h1 > 40 ? run * 2 : 0)) * (used?.has(nb) ? 0.3 : 1);
        if (nc < g[nb]) {
          g[nb] = nc;
          from[nb] = cur;
          open.push(nc + Math.hypot(cx(nb) - gx, cz(nb) - gz) * 0.98, nb);
        }
      }
    }
  }
  if (from[goal] < 0 && goal !== start) return null;
  const pts: Path = [{ x: ax, z: az }];
  const chain: number[] = [];
  for (let i = goal; i !== start && i >= 0; i = from[i]) chain.push(i);
  chain.reverse();
  if (used) for (const i of chain) used.add(i);
  for (const i of chain) pts.push({ x: cx(i), z: cz(i) });
  pts.push({ x: bx, z: bz });
  return smooth(smooth(pts));
}

/** Chaikin corner cutting: turns the grid staircase into a gentle curve. */
export function smooth(p: Path): Path {
  if (p.length < 3) return p;
  const out: Path = [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const a = p[i];
    const b = p[i + 1];
    out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 }, { x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
  }
  out.push(p[p.length - 1]);
  return out;
}

export { SEA_LEVEL };
