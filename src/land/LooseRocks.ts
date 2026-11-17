import * as THREE from 'three';
import type { Game } from '../Game';
import { Rock } from '../entities/Nature';
import type { ScatterItem, ScatterSet } from './Scatter';

/**
 * Every rock you can see is a rock you can pick up (2026-11-17, Daryll: "almost any rock is unable to be picked up. I
 * have to move the hand all over randomly and I get lucky if I pick up a rock").
 *
 * The island draws about 1,500 scattered rocks (land/Flora.ts) with the very same shape and stone as the 64 or so real
 * boulders, but they were scenery: the hand passed through them. Now a scattered rock near the hand quietly becomes a
 * real boulder, in the same place, the same size, the same turn and the same tint, so nothing is seen to change, and
 * from then on it is hovered, grabbed, thrown and built with like any other.
 *
 * A woken rock that was never touched goes back to being scenery on the next load (it is not saved). One that was
 * taken, thrown, eaten or moved is saved as a real boulder, and its scenery twin stays gone (`taken`, saved here).
 */
export class LooseRocks {
  private readonly cells = new Map<number, { item: ScatterItem; set: ScatterSet; geo: number }[]>();
  private readonly woken = new Map<string, { rock: Rock; item: ScatterItem; set: ScatterSet }>();
  private readonly taken = new Set<string>();
  private readonly tinted = new Map<number, THREE.BufferGeometry>();
  private static readonly CELL = 16;

  constructor(
    private readonly game: Game,
    sets: { set: ScatterSet; geo: number }[],
    private readonly tints: THREE.Color[],
  ) {
    for (const s of sets) for (const item of s.set.items) this.cell(item.x, item.z, true)!.push({ item, set: s.set, geo: s.geo });
  }

  static key(it: ScatterItem): string {
    return `${Math.round(it.x * 10)},${Math.round(it.z * 10)}`;
  }

  private cell(x: number, z: number, make = false) {
    const k = Math.floor(x / LooseRocks.CELL) * 4096 + Math.floor(z / LooseRocks.CELL);
    let c = this.cells.get(k);
    if (!c && make) this.cells.set(k, (c = []));
    return c;
  }

  /** The set's own shape with the item's tint baked in: a single rock drawn exactly as its instance was. */
  private shape(set: ScatterSet, tint: number): THREE.BufferGeometry {
    const id = set.mesh.id * 8 + (tint % this.tints.length);
    let g = this.tinted.get(id);
    if (!g) {
      g = set.mesh.geometry.clone();
      const c = g.getAttribute('color');
      const t = this.tints[tint % this.tints.length];
      if (c) for (let i = 0; i < c.count; i++) c.setXYZ(i, c.getX(i) * t.r, c.getY(i) * t.g, c.getZ(i) * t.b);
      this.tinted.set(id, g);
    }
    return g;
  }

  private drop(item: ScatterItem, set: ScatterSet) {
    const i = set.items.indexOf(item);
    if (i >= 0) {
      set.items.splice(i, 1);
      set.invalidate();
    }
    (item as ScatterItem & { gone?: boolean }).gone = true;
  }

  /** Scattered rocks within `r` metres of (x, z) that are drawn right now become real boulders. Returns how many. */
  wake(x: number, z: number, r: number): number {
    let n = 0;
    const C = LooseRocks.CELL;
    for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++) {
      for (let cz = Math.floor((z - r) / C); cz <= Math.floor((z + r) / C); cz++) {
        const cell = this.cells.get(cx * 4096 + cz);
        if (!cell) continue;
        for (let i = cell.length - 1; i >= 0; i--) {
          const { item, set } = cell[i];
          if ((item as ScatterItem & { gone?: boolean }).gone) {
            cell.splice(i, 1); // cleared by a building or a street since (land.clear)
            continue;
          }
          if (!set.mesh.visible || Math.hypot(item.x - x, item.z - z) > r) continue;
          cell.splice(i, 1);
          this.drop(item, set);
          const radius = Math.min(3.2, Math.max(0.45, (item.sx + item.sz) / 2));
          const rock = new Rock(Math.round(item.x * 31 + item.z * 17) >>> 0, item.x, item.z, radius, { geo: this.shape(set, item.tint), yaw: item.yaw, sx: item.sx, sy: item.sy, sz: item.sz });
          rock.loose = LooseRocks.key(item);
          this.game.add(rock);
          rock.pos.set(item.x, item.y, item.z); // where it lay, half sunk in the ground, not set on top of it
          rock.home.copy(rock.pos);
          rock.syncObject();
          this.woken.set(rock.loose, { rock, item, set });
          n++;
        }
      }
    }
    return n;
  }

  /**
   * Woken rocks the hand has left behind (more than `r` metres from (x, z)) and never touched go back to being
   * scenery, so the island never carries more than a handful of extra boulders however far the hand roams. A rock
   * that was taken, moved or destroyed is counted as taken for good. Returns how many went back to sleep.
   */
  tidy(x: number, z: number, r: number): number {
    let n = 0;
    for (const [key, w] of this.woken) {
      if (!w.rock.stillScenery) {
        this.taken.add(key);
        this.woken.delete(key);
        continue;
      }
      if (Math.hypot(w.item.x - x, w.item.z - z) <= r || this.game.hand.hover === w.rock) continue;
      this.game.remove(w.rock);
      (w.item as ScatterItem & { gone?: boolean }).gone = false;
      w.set.items.push(w.item);
      w.set.invalidate();
      this.cell(w.item.x, w.item.z, true)!.push({ item: w.item, set: w.set, geo: 0 });
      this.woken.delete(key);
      n++;
    }
    return n;
  }

  /** Counts for tests and the README: scattered rocks still asleep, woken, and taken for good. */
  get count() {
    let asleep = 0;
    for (const c of this.cells.values()) asleep += c.length;
    return { asleep, woken: this.woken.size, taken: this.taken.size };
  }

  save(): unknown {
    const out = new Set(this.taken);
    for (const [k, w] of this.woken) if (!w.rock.stillScenery) out.add(k);
    return { taken: [...out] };
  }

  load(data: unknown) {
    const list = (data as { taken?: unknown })?.taken;
    if (!Array.isArray(list)) return;
    for (const k of list) if (typeof k === 'string') this.taken.add(k);
    if (!this.taken.size) return;
    for (const cell of this.cells.values()) {
      for (let i = cell.length - 1; i >= 0; i--) {
        if (!this.taken.has(LooseRocks.key(cell[i].item))) continue;
        this.drop(cell[i].item, cell[i].set);
        cell.splice(i, 1);
      }
    }
  }
}
