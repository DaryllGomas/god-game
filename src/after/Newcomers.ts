import * as THREE from 'three';
import type { Game } from '../Game';
import { findRoad, type Path } from '../land/Roads';
import type { Terrain } from '../world/Terrain';
import { clamp } from '../util/math';
import type { Boat } from './Boat';
import type { Growth } from './Growth';
import { TUNICS, type People, type Person } from './People';

// ------------------------------------------------------------------ tuning knobs

/** Walking pace from the shore to their new street (m per game second). */
const WALK = 2.1;
/** Game seconds to go in at their door once the house stands. */
const GO_IN = 3;

export type FamilyPhase = 'boat' | 'walk' | 'wait' | 'in';

export interface Family {
  /** Their colours (one look per person). */
  looks: number[];
  /** The house in the growth plan that will be theirs (-1: no room planned: they find a place in the city). */
  lot: number;
  phase: FamilyPhase;
  /** Metres along the walk, or game seconds into going in. */
  t: number;
  path: Path | null;
  cum: number[];
  people: (Person | null)[];
}

export interface FamilySave {
  looks: number[];
  lot: number;
  phase: FamilyPhase;
  t: number;
}

const lengths = (p: Path) => {
  const cum = [0];
  for (let i = 1; i < p.length; i++) cum.push(cum[i - 1] + Math.hypot(p[i].x - p[i - 1].x, p[i].z - p[i - 1].z));
  return cum;
};

/**
 * The newcomers (after the true end, src/after): a family comes in on the boat, steps off into the shallows, walks up
 * to the edge of Telor where their house will stand, and waits there until it does (no hurry: nobody ever leaves).
 * When it stands they go in at the door. People are drawn from the shared pool (src/after/People.ts).
 */
export class Newcomers {
  readonly families: Family[] = [];
  private readonly o = { x: 0, z: 0, dx: 0, dz: 0 };
  private readonly v = new THREE.Vector3();
  /** A family has gone into their new house (not on a reload). */
  onHome: ((f: Family) => void) | null = null;

  constructor(
    private readonly game: Game,
    private readonly people: People,
    private readonly growth: Growth,
    private readonly boat: Boat,
    private readonly center: THREE.Vector3,
  ) {}

  /** Families still on their way or waiting for a home. */
  get waiting(): number {
    return this.families.filter((f) => f.phase !== 'in').length;
  }

  /** The next house in the plan that nobody has claimed (built or not yet), or -1. */
  private nextLot(): number {
    const claimed = new Set(this.families.map((f) => f.lot));
    for (let i = this.growth.done; i < this.growth.items.length; i++) {
      if (this.growth.items[i].kind === 'house' && !claimed.has(i)) return i;
    }
    return -1;
  }

  /** A new family of `n` sets out on the boat (the boat's sail takes the first one's colour). */
  embark(n: number): Family {
    const looks = Array.from({ length: n }, () => Math.floor(Math.random() * TUNICS.length));
    const f: Family = { looks, lot: this.nextLot(), phase: 'boat', t: 0, path: null, cum: [0], people: [] };
    this.families.push(f);
    return f;
  }

  /** Where they walk to: in front of their door, or (no room planned) into the city by the plaza's edge. */
  private target(f: Family): THREE.Vector3 {
    const d = f.lot >= 0 ? this.growth.door(f.lot, 2.2) : null;
    if (d) return d;
    const s = this.boat.landing?.shore ?? this.center;
    const a = Math.atan2(s.z - this.center.z, s.x - this.center.x);
    return new THREE.Vector3(this.center.x + Math.cos(a) * 40, 0, this.center.z + Math.sin(a) * 40);
  }

  /** The boat lies in the shallows: they step off and walk up. */
  land(f: Family) {
    const L = this.boat.landing;
    if (!L) return;
    const to = this.target(f);
    const g = this.game;
    const base = { heightAt: (x: number, z: number) => g.terrain.baseHeightAt(x, z) } as unknown as Terrain;
    const road = findRoad(base, L.shore.x, L.shore.z, to.x, to.z);
    const path: Path = [{ x: L.water.x, z: L.water.z }, { x: L.shore.x, z: L.shore.z }];
    if (road && road.length > 1) {
      for (const p of road.slice(1, -1)) path.push(p);
    }
    path.push({ x: to.x, z: to.z });
    f.path = path;
    f.cum = lengths(path);
    f.phase = 'walk';
    f.t = Math.min(f.t, f.cum[f.cum.length - 1]);
  }

  /** Simulation step (game seconds). */
  update(dt: number) {
    for (let i = this.families.length - 1; i >= 0; i--) {
      const f = this.families[i];
      if (f.phase === 'walk' && f.path) {
        f.t += dt * WALK;
        const L = f.cum[f.cum.length - 1];
        if (f.t >= L) {
          f.t = L;
          f.phase = 'wait';
        }
      }
      // Their house stands: in they go (from wherever they have got to on their street).
      if ((f.phase === 'wait' || (f.phase === 'walk' && f.path && f.cum[f.cum.length - 1] - f.t < 6)) && (f.lot < 0 || this.growth.done > f.lot)) {
        f.phase = 'in';
        f.t = 0;
      }
      if (f.phase === 'in') {
        f.t += dt;
        if (f.t >= GO_IN) {
          for (const p of f.people) this.people.release(p);
          f.people = [];
          this.families.splice(i, 1);
          this.onHome?.(f);
        }
      }
    }
  }

  private along(f: Family, s: number) {
    const p = f.path!;
    const cum = f.cum;
    s = clamp(s, 0, cum[cum.length - 1]);
    let i = 1;
    while (i < p.length - 1 && cum[i] < s) i++;
    const a = p[i - 1];
    const b = p[i];
    const seg = Math.max(1e-6, cum[i] - cum[i - 1]);
    const k = (s - cum[i - 1]) / seg;
    this.o.x = a.x + (b.x - a.x) * k;
    this.o.z = a.z + (b.z - a.z) * k;
    this.o.dx = (b.x - a.x) / seg;
    this.o.dz = (b.z - a.z) / seg;
    return this.o;
  }

  /** Per frame: everyone where they are (in the boat, on the road, at their door, going in). */
  frame() {
    const g = this.game;
    const yAt = (x: number, z: number) => Math.max(g.terrain.heightAt(x, z), -0.45) + 0.16;
    for (const f of this.families) {
      while (f.people.length < f.looks.length) f.people.push(this.people.take(f.looks[f.people.length]));
      f.people.forEach((p, j) => {
        if (!p) return;
        if (f.phase === 'boat') {
          if (this.boat.phase === 'off') {
            this.people.set(p, 0, -50, 0, 0, 0, 0.0001);
            return;
          }
          this.boat.seat(j, this.v);
          this.people.set(p, this.v.x, this.v.y, this.v.z, this.boat.heading, 0);
          return;
        }
        if (!f.path) return;
        const L = f.cum[f.cum.length - 1];
        if (f.phase === 'walk') {
          const s = f.t - j * 1.5;
          const o = this.along(f, s);
          const side = (j % 2 ? 1 : -1) * 0.45;
          const x = o.x - o.dz * side;
          const z = o.z + o.dx * side;
          this.people.set(p, x, yAt(x, z), z, Math.atan2(o.dx, o.dz), s > 0 ? 1 : 0);
          return;
        }
        // At their door: a little knot of them looking at where the house is (or stands).
        const end = this.along(f, L);
        const door = f.lot >= 0 ? this.growth.items[f.lot] : null;
        const fx = door ? door.x : this.center.x;
        const fz = door ? door.z : this.center.z;
        const ang = Math.atan2(end.x - fx, end.z - fz);
        const spread = (j - (f.looks.length - 1) / 2) * 1.1;
        let x = end.x + Math.cos(ang) * spread;
        let z = end.z - Math.sin(ang) * spread;
        let scale = 1;
        let swing = 0;
        if (f.phase === 'in') {
          // Walk to the door and in.
          const k = clamp(f.t / GO_IN - j * 0.12, 0, 1);
          const dx = door ? fx + Math.sin(door.yaw) * 4 : fx;
          const dz = door ? fz + Math.cos(door.yaw) * 4 : fz;
          x += (dx - x) * k;
          z += (dz - z) * k;
          scale = 1 - clamp((k - 0.75) / 0.25, 0, 1);
          swing = k < 1 ? 1 : 0;
        }
        this.people.set(p, x, yAt(x, z), z, Math.atan2(fx - x, fz - z), swing, scale);
      });
    }
  }

  save(): FamilySave[] {
    return this.families.filter((f) => f.phase !== 'in').map((f) => ({ looks: [...f.looks], lot: f.lot, phase: f.phase, t: Math.round(f.t * 10) / 10 }));
  }

  /** Families as saved: on the water still, walking up, or waiting at their door. */
  load(list: FamilySave[]) {
    for (const s of list) {
      if (!Array.isArray(s.looks) || typeof s.lot !== 'number') continue;
      const f: Family = { looks: s.looks.slice(0, 4).map((k) => ((k % TUNICS.length) + TUNICS.length) % TUNICS.length), lot: s.lot, phase: s.phase === 'boat' ? 'boat' : 'walk', t: s.t ?? 0, path: null, cum: [0], people: [] };
      this.families.push(f);
      if (f.phase !== 'boat') {
        this.land(f);
        if (s.phase === 'wait') {
          f.t = f.cum[f.cum.length - 1];
          f.phase = 'wait';
        } else f.t = Math.min(s.t ?? 0, f.cum[f.cum.length - 1]);
      }
    }
  }
}
