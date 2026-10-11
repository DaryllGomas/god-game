import type { Game } from '../Game';
import { Tree } from '../entities/Nature';

// ------------------------------------------------------------------ tuning knobs

/** Forests spread on their own up to this many trees (the island starts with about 445). */
export const MAX_TREES = 520;
/** What you grow (rain groves, villagers replanting) may go past MAX_TREES up to this. */
export const HARD_CAP = 620;
/** Seconds between looks at the forest (as before v0.5 tuning). */
const TICK = 4;
/** Each look: seeds blown from random standing trees, landing 4-12 m away (the old spread, unchanged). */
const SPREAD_PER_TICK = 1;

/** Where a tree was taken (chopped down or lifted away) the forest heals, if a mature tree stands within reach. */
const SEED_REACH = 16;
/** A clearing rests this long before seeds take... */
const STUMP_REST = 45;
/** ...then each look it has this chance of a sapling (so on average ~16 s more). */
const STUMP_TAKE = 0.25;
/** Clearings remembered at once, and how long a clearing with no tree in reach stays remembered (3 game days). */
const STUMP_MAX = 240;
const STUMP_LIFE = 900;
/** Clearings looked at per look, taking turns. */
const STUMPS_PER_TICK = 8;

/** When the island is in tune, a villager who fells a tree sometimes plants a sapling in the stump. */
const REPLANT_BALANCE = 0.7;
const REPLANT_CHANCE = 0.5;
/** Seconds after the tree starts falling (it is gone after 4). */
const REPLANT_DELAY = 7;

/** Rain on open land: a handful of saplings springs up around where it lands, and young trees nearby shoot up. */
const GROVE_SAPLINGS = 6;
const GROVE_RADIUS: [number, number] = [2.5, 10];
const GROVE_BOOST = 0.25;
const GROVE_BOOST_RADIUS = 22;

const SAPLING = 0.05;
const LEAF = 0x9fe07a;

interface Stump {
  x: number;
  z: number;
  t: number;
}

/**
 * The forest's own life (v0.5 tuning): seeds blowing from standing trees, clearings healing from the
 * trees around them, villagers replanting while the world is in tune, and rain that grows groves.
 * Tree growth itself is in entities/Nature.ts (Tree.update; TREE_GROW_TIME).
 */
export class ForestCare {
  private tick = 0;
  private scan = 0;
  private readonly stumps: Stump[] = [];
  private cursor = 0;
  private readonly noted = new WeakSet<Tree>();
  private readonly replants: Stump[] = [];
  /** For tests: saplings by cause since the island loaded. */
  readonly stats = { spread: 0, healed: 0, replanted: 0, rain: 0 };

  constructor(private readonly game: Game) {
    game.events.on('grab', ({ entity }) => {
      if (entity instanceof Tree) this.clearing(entity);
    });
    game.events.on('miracle', ({ id, x, z }) => {
      if (id === 'water') this.rainGrove(x, z);
    });
  }

  private get balance(): number {
    return (this.game as unknown as { balance?: { value: number } }).balance?.value ?? 0.75;
  }

  update(dt: number) {
    const g = this.game;
    // Felled trees: twice a second is plenty (a tree takes 4 s to fall).
    this.scan -= dt;
    if (this.scan <= 0) {
      this.scan = 0.5;
      for (const e of g.entities) {
        if (e.kind !== 'tree' || !e.alive) continue;
        const t = e as Tree;
        if (!t.isFelling || this.noted.has(t)) continue;
        this.clearing(t);
        if (t.chopped > 0 && this.balance >= REPLANT_BALANCE && Math.random() < REPLANT_CHANCE) {
          this.replants.push({ x: t.pos.x, z: t.pos.z, t: g.time + REPLANT_DELAY });
        }
      }
    }
    for (let i = this.replants.length - 1; i >= 0; i--) {
      const r = this.replants[i];
      if (g.time < r.t) continue;
      this.replants.splice(i, 1);
      if (this.plant(r.x, r.z, HARD_CAP)) {
        this.stats.replanted++;
        this.forget(r.x, r.z);
        g.fx.dust(r.x, g.terrain.heightAt(r.x, r.z), r.z, 6, 0.5, 0x8a6a45);
      }
    }

    this.tick -= dt;
    if (this.tick > 0) return;
    this.tick = TICK;
    const trees: Tree[] = [];
    for (const e of g.entities) if (e.kind === 'tree' && e.alive) trees.push(e as Tree);
    let count = trees.length;

    // Clearings heal first, a few per look, taking turns (one that can't take a seed yet doesn't block the rest).
    let looked = 0;
    for (let k = this.stumps.length; k > 0 && looked < STUMPS_PER_TICK; k--) {
      if (this.cursor >= this.stumps.length) this.cursor = 0;
      const s = this.stumps[this.cursor];
      const age = g.time - s.t;
      if (age > STUMP_LIFE) {
        this.stumps.splice(this.cursor, 1);
        continue;
      }
      if (age < STUMP_REST) {
        this.cursor++;
        continue;
      }
      looked++;
      // A clearing only gives back a tree that was taken, so it may heal past MAX_TREES (else, on a full
      // island, seeds blowing elsewhere would always win the freed place and villages would go bare).
      const x = s.x + (Math.random() - 0.5) * 2;
      const z = s.z + (Math.random() - 0.5) * 2;
      if (count < HARD_CAP && Math.random() < STUMP_TAKE && this.parentNear(trees, x, z) && this.plant(x, z, HARD_CAP)) {
        this.stumps.splice(this.cursor, 1);
        this.stats.healed++;
        count++;
      } else this.cursor++;
    }

    // Seeds blow from random standing trees.
    for (let k = 0; k < SPREAD_PER_TICK && count < MAX_TREES && trees.length; k++) {
      const parent = trees[Math.floor(Math.random() * trees.length)];
      const a = Math.random() * Math.PI * 2;
      const d = 4 + Math.random() * 8;
      if (this.plant(parent.pos.x + Math.cos(a) * d, parent.pos.z + Math.sin(a) * d, MAX_TREES)) {
        this.stats.spread++;
        count++;
      }
    }
  }

  /** A tree is leaving its spot: remember the clearing so the forest can heal it. */
  private clearing(t: Tree) {
    if (this.noted.has(t)) return;
    this.noted.add(t);
    if (t.charred) return; // burnt land comes back only from the forest's edges
    this.stumps.push({ x: t.pos.x, z: t.pos.z, t: this.game.time });
    if (this.stumps.length > STUMP_MAX) this.stumps.shift();
  }

  private forget(x: number, z: number) {
    for (let i = this.stumps.length - 1; i >= 0; i--) {
      const s = this.stumps[i];
      if (Math.hypot(s.x - x, s.z - z) < 3) this.stumps.splice(i, 1);
    }
  }

  private parentNear(trees: Tree[], x: number, z: number): boolean {
    const r2 = SEED_REACH * SEED_REACH;
    for (const t of trees) {
      if (!t.mature || t.held || t.airborne) continue;
      const dx = t.pos.x - x;
      const dz = t.pos.z - z;
      if (dx * dx + dz * dz < r2) return true;
    }
    return false;
  }

  private treeCount(): number {
    let n = 0;
    for (const e of this.game.entities) if (e.kind === 'tree' && e.alive) n++;
    return n;
  }

  /** Plant a sapling at (x, z) if the ground allows and the island has room under `cap`. */
  private plant(x: number, z: number, cap: number): Tree | null {
    const g = this.game;
    if (this.treeCount() >= cap) return null;
    if (!g.canPlantTree(x, z)) return null;
    const t = new Tree(Math.floor(Math.random() * 1e6), x, z, SAPLING);
    t.pos.y = g.terrain.heightAt(x, z);
    g.add(t);
    return t;
  }

  /** The Water miracle landed at (x, z). On open land a little grove springs up; young trees nearby shoot up. */
  private rainGrove(x: number, z: number) {
    const g = this.game;
    if (!g.terrain.isLand(x, z, 1) || g.villageAt(x, z)) return;
    g.forEachNear(x, z, GROVE_BOOST_RADIUS, (e) => {
      if (e instanceof Tree && !e.mature && !e.charred && !e.held) e.water(GROVE_BOOST);
    });
    let planted = 0;
    const turn = Math.random() * Math.PI * 2;
    for (let i = 0; i < GROVE_SAPLINGS * 4 && planted < GROVE_SAPLINGS; i++) {
      // A loose golden-angle spiral, jittered: a natural clump rather than a ring or a carpet.
      const a = turn + i * 2.39996 + (Math.random() - 0.5) * 0.6;
      const d = GROVE_RADIUS[0] + (GROVE_RADIUS[1] - GROVE_RADIUS[0]) * Math.sqrt(((i % GROVE_SAPLINGS) + Math.random()) / GROVE_SAPLINGS);
      const px = x + Math.cos(a) * d;
      const pz = z + Math.sin(a) * d;
      const t = this.plant(px, pz, HARD_CAP);
      if (!t) continue;
      planted++;
      this.stats.rain++;
      this.forget(px, pz);
      g.fx.sparkle(px, t.pos.y + 0.6, pz, 10, LEAF, 1.4);
    }
  }
}
