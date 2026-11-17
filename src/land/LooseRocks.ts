import * as THREE from 'three';
import type { Game } from '../Game';
import { Rock, type RockLook } from '../entities/Nature';
import type { ScatterItem, ScatterSet } from './Scatter';

type Item = ScatterItem & { gone?: boolean };

/**
 * Every rock you can see is a rock you can pick up (2026-11-17, Daryll: "almost any rock is unable to be picked up. I
 * have to move the hand all over randomly and I get lucky if I pick up a rock").
 *
 * The island draws about 970 scattered rocks (land/Flora.ts) with the very same shape and stone as the 64 or so real
 * boulders, but they were scenery: the hand passed through them. Now a scattered rock near the hand quietly becomes a
 * real boulder, in the same place, the same size, the same turn and the same tint, so nothing is seen to change, and
 * from then on it is hovered, grabbed, thrown and built with like any other.
 *
 * A woken rock that was never touched goes back to being scenery once the hand has moved on (`tidy`), and it is not
 * saved. One that was taken, thrown, eaten or moved is saved as a real boulder with its own look (`looks`), and its
 * scenery twin stays gone (`taken`).
 */
export class LooseRocks {
  private readonly cells = new Map<number, { item: Item; set: ScatterSet }[]>();
  /** Keyed by the scattered item itself: two rocks lying within 10 cm of each other share a place key (2 pairs of 967). */
  private readonly woken = new Map<Item, { rock: Rock; set: ScatterSet; key: string }>();
  private readonly taken = new Set<string>();
  /** Taken rocks still in the world: saved with their look, so they come back the same shape and colour. */
  private readonly kept = new Set<Rock>();
  private readonly tinted = new Map<number, THREE.BufferGeometry>();
  private readonly sets: ScatterSet[];
  /** The reach of the last wake: rocks a little beyond it go back to sleep (see plugins/land.ts). */
  lastReach = 12;
  private static readonly CELL = 16;

  constructor(
    private readonly game: Game,
    sets: ScatterSet[],
    private readonly tints: THREE.Color[],
  ) {
    this.sets = sets;
    for (const set of sets) for (const item of set.items) this.cell(item.x, item.z, true)!.push({ item, set });
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
    const id = this.sets.indexOf(set) * 8 + (tint % this.tints.length);
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

  private look(set: ScatterSet, tint: number, yaw: number, sx: number, sy: number, sz: number): RockLook {
    return { geo: this.shape(set, tint), yaw, sx, sy, sz, set: this.sets.indexOf(set), tint };
  }

  private drop(item: Item, set: ScatterSet) {
    const i = set.items.indexOf(item);
    if (i >= 0) {
      set.items.splice(i, 1);
      set.invalidate();
    }
    item.gone = true;
  }

  /** Scattered rocks within `r` metres of (x, z) that are drawn right now become real boulders. Returns how many. */
  wake(x: number, z: number, r: number): number {
    this.lastReach = r;
    let n = 0;
    const C = LooseRocks.CELL;
    for (let cx = Math.floor((x - r) / C); cx <= Math.floor((x + r) / C); cx++) {
      for (let cz = Math.floor((z - r) / C); cz <= Math.floor((z + r) / C); cz++) {
        const cell = this.cells.get(cx * 4096 + cz);
        if (!cell) continue;
        for (let i = cell.length - 1; i >= 0; i--) {
          const { item, set } = cell[i];
          if (item.gone) {
            cell.splice(i, 1); // cleared by a building or a street since (land.clear)
            continue;
          }
          if (!set.mesh.visible || Math.hypot(item.x - x, item.z - z) > r) continue;
          cell.splice(i, 1);
          this.drop(item, set);
          const radius = Math.min(3.2, Math.max(0.45, (item.sx + item.sz) / 2));
          const rock = new Rock(Math.round(item.x * 31 + item.z * 17) >>> 0, item.x, item.z, radius, this.look(set, item.tint, item.yaw, item.sx, item.sy, item.sz));
          rock.loose = LooseRocks.key(item);
          this.game.add(rock);
          rock.pos.set(item.x, item.y, item.z); // where it lay, half sunk in the ground, not set on top of it
          rock.home.copy(rock.pos);
          rock.syncObject();
          this.woken.set(item, { rock, set, key: rock.loose });
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
    for (const [item, w] of this.woken) {
      if (!w.rock.stillScenery) {
        this.taken.add(w.key);
        if (w.rock.alive) this.kept.add(w.rock);
        this.woken.delete(item);
        continue;
      }
      if (Math.hypot(item.x - x, item.z - z) <= r || this.game.hand.hover === w.rock) continue;
      this.game.remove(w.rock);
      item.gone = false;
      w.set.items.push(item);
      w.set.invalidate();
      this.cell(item.x, item.z, true)!.push({ item, set: w.set });
      this.woken.delete(item);
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
    const rocks = new Set(this.kept);
    for (const w of this.woken.values()) {
      if (w.rock.stillScenery) continue;
      out.add(w.key);
      rocks.add(w.rock);
    }
    // [x, z, set, tint, yaw, sx, sy, sz] for each taken rock still in the world, at the place the save puts it.
    const looks: number[][] = [];
    for (const r of rocks) {
      const l = r.look;
      if (!r.alive) this.kept.delete(r);
      else if (l) looks.push([r.pos.x, r.pos.z, l.set, l.tint, l.yaw, l.sx, l.sy, l.sz].map((v) => Math.round(v * 100) / 100));
    }
    return { taken: [...out], looks };
  }

  load(data: unknown) {
    const d = data as { taken?: unknown; looks?: unknown } | null;
    if (Array.isArray(d?.taken)) for (const k of d.taken) if (typeof k === 'string') this.taken.add(k);
    if (this.taken.size) {
      for (const cell of this.cells.values()) {
        for (let i = cell.length - 1; i >= 0; i--) {
          if (!this.taken.has(LooseRocks.key(cell[i].item))) continue;
          this.drop(cell[i].item, cell[i].set);
          cell.splice(i, 1);
        }
      }
    }
    // Taken rocks came back from the save as plain boulders: give each its own shape, turn, stretch and tint again.
    if (!Array.isArray(d?.looks)) return;
    const rocks = this.game.entities.filter((e): e is Rock => e instanceof Rock && e.alive);
    for (const l of d.looks) {
      if (!Array.isArray(l) || l.length < 8 || l.some((v) => typeof v !== 'number' || !Number.isFinite(v))) continue;
      const [x, z, si, tint, yaw, sx, sy, sz] = l as number[];
      const set = this.sets[si];
      const rock = rocks.find((r) => !r.loose && Math.abs(r.pos.x - x) < 0.06 && Math.abs(r.pos.z - z) < 0.06);
      if (!set || !rock) continue;
      rock.wear(this.look(set, tint, yaw, sx, sy, sz));
      rock.adopt(`${Math.round(x * 10)},${Math.round(z * 10)}`);
      rock.pos.y = this.game.terrain.heightAt(rock.pos.x, rock.pos.z) + rock.groundOffset;
      rock.syncObject();
      this.kept.add(rock);
    }
  }
}
