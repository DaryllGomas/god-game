import * as THREE from 'three';
import type { Game } from '../Game';
import { Field, House, Store, WorshipSite } from '../entities/Buildings';
import { Villager } from '../entities/Villager';
import type { Pile, Tree } from '../entities/Nature';
import { INFLUENCE, PLAYER, VILLAGE, type Owner, type VillageSite } from '../config';
import { Rng, rng } from '../util/rng';
import type { Site } from '../projects/Site';

/** One village in a save file (positions rounded; see systems/Save.ts). */
export interface VillageSave {
  owner: Owner;
  belief: number;
  worship: number;
  food: number;
  wood: number;
  /** Worship site position [x, z]. */
  totem: [number, number];
  /** [x, z, rotY, seed, progress, health] */
  houses: [number, number, number, number, number, number][];
  /** [x, z, rotY, growth, scorched] */
  fields: [number, number, number, number, number][];
}

let villagerSeed = 1;
/** Save/load: keep newborns' looks from repeating the seeds of restored villagers. */
export function bumpVillagerSeed(min: number) {
  villagerSeed = Math.max(villagerSeed, min);
}

/** A settlement: its buildings, people, stockpile and what it believes. */
export class Village {
  readonly name: string;
  readonly center: THREE.Vector3;
  readonly radius: number;
  readonly color: number;
  readonly isHome: boolean;
  owner: Owner;
  /** Neutral: belief in you (0..100, converts at 100). Owned: faith (0..100). */
  belief: number;
  worshipFraction: number;

  store!: Store;
  worship!: WorshipSite;
  readonly houses: House[] = [];
  readonly fields: Field[] = [];
  readonly villagers: Villager[] = [];

  /** Village project in progress, and the island Wonder when this village may help build it (set by the projects plugin). */
  projectSite: Site | null = null;
  wonderSite: Site | null = null;
  /** A festival green: while set, everyone dances there instead of at the totem. */
  festival: Site | null = null;
  /** Places the project plugin has built on (so houses and fields keep clear). */
  readonly obstacles: { pos: THREE.Vector3; radius: number }[] = [];

  dancers = 0;
  worshipperCount = 0;
  starving = 0;
  prayerRate = 0;
  /** > 0 while the rival god is pressing on this village (set by src/rival): if its faith hits 0 it turns to him instead of drifting away. */
  rivalPressure = 0;

  private roleTimer = 0;
  private birthTimer = 0;
  private fieldTimer = 0;
  private complaints = new Map<string, number>();
  private readonly layoutRng: Rng;

  /** `restoring`: skip the seeded layout; the caller fills the village from a save (see `restore`). */
  constructor(game: Game, site: VillageSite, seed: number, restoring = false) {
    this.name = site.name;
    this.radius = site.radius;
    this.color = site.tunic;
    this.owner = site.owner;
    this.isHome = site.owner === 'player';
    this.belief = this.owner === 'player' ? 80 : 0;
    this.worshipFraction = VILLAGE.defaultWorship;
    this.layoutRng = new Rng(seed);
    this.center = new THREE.Vector3(site.x, game.terrain.heightAt(site.x, site.z), site.z);
    if (!restoring) this.layout(game, site);
  }

  /** Rebuild this village from a save instead of the random layout. */
  restore(game: Game, d: VillageSave) {
    this.owner = d.owner;
    this.belief = d.belief;
    this.worshipFraction = d.worship;
    const c = this.center;
    this.store = new Store(this, c.x, c.y, c.z);
    this.store.food = d.food;
    this.store.wood = d.wood;
    game.add(this.store);
    const [wx, wz] = d.totem;
    this.worship = new WorshipSite(this, wx, game.terrain.heightAt(wx, wz), wz);
    game.add(this.worship);
    for (const [x, z, rot, seed, progress, health] of d.houses) {
      const h = new House(this, x, game.terrain.heightAt(x, z), z, rot, seed, true);
      h.setProgress(progress);
      h.health = health;
      this.houses.push(h);
      game.add(h);
    }
    for (const [x, z, rot, growth, scorched] of d.fields) {
      const f = new Field(this, x, game.terrain.heightAt(x, z), z, rot, growth);
      f.restore(growth, scorched);
      this.fields.push(f);
      game.add(f);
    }
  }

  // ----------------------------------------------------------------- layout

  private layout(game: Game, site: VillageSite) {
    const r = this.layoutRng;
    const c = this.center;
    this.store = new Store(this, c.x, c.y, c.z);
    game.add(this.store);

    const wa = r.range(0, Math.PI * 2);
    const wx = c.x + Math.cos(wa) * this.radius * 0.55;
    const wz = c.z + Math.sin(wa) * this.radius * 0.55;
    this.worship = new WorshipSite(this, wx, game.terrain.heightAt(wx, wz), wz);
    game.add(this.worship);

    for (let i = 0; i < site.houses; i++) {
      const spot = this.findSpot(game, 0.3, 0.75, 6.5);
      if (!spot) break;
      const h = new House(this, spot.x, spot.y, spot.z, Math.atan2(c.x - spot.x, c.z - spot.z), r.int(0, 1e6), true);
      this.houses.push(h);
      game.add(h);
    }

    for (let i = 0; i < site.fields; i++) {
      const spot = this.findSpot(game, 0.85, 1.25, 9);
      if (!spot) break;
      const f = new Field(this, spot.x, spot.y, spot.z, Math.atan2(c.x - spot.x, c.z - spot.z), r.range(0.3, 1));
      this.fields.push(f);
      game.add(f);
    }

    for (let i = 0; i < site.villagers; i++) {
      const a = r.range(0, Math.PI * 2);
      const d = r.range(4, this.radius * 0.5);
      const v = new Villager(this, c.x + Math.cos(a) * d, c.z + Math.sin(a) * d, villagerSeed++);
      v.pos.y = game.terrain.heightAt(v.pos.x, v.pos.z);
      this.addVillager(v);
      this.assignHome(v);
      game.add(v);
    }
  }

  /** Find open, flat, dry ground in a ring around the centre. */
  findSpot(game: Game, minR: number, maxR: number, clearance: number): THREE.Vector3 | null {
    const r = this.layoutRng;
    const n = new THREE.Vector3();
    for (let attempt = 0; attempt < 80; attempt++) {
      const a = r.range(0, Math.PI * 2);
      const d = r.range(minR, maxR) * this.radius;
      const x = this.center.x + Math.cos(a) * d;
      const z = this.center.z + Math.sin(a) * d;
      if (!game.terrain.isLand(x, z, 1.5)) continue;
      if (game.terrain.normalAt(x, z, n).y < 0.9) continue;
      if (!this.clearOf(x, z, clearance)) continue;
      return new THREE.Vector3(x, game.terrain.heightAt(x, z), z);
    }
    return null;
  }

  private clearOf(x: number, z: number, clearance: number): boolean {
    const near = (px: number, pz: number, r: number) => Math.hypot(px - x, pz - z) < r + clearance;
    if (near(this.store.pos.x, this.store.pos.z, 5)) return false;
    if (near(this.worship.pos.x, this.worship.pos.z, 10)) return false;
    for (const h of this.houses) if (near(h.pos.x, h.pos.z, 2.5)) return false;
    for (const f of this.fields) if (near(f.pos.x, f.pos.z, 5)) return false;
    for (const o of this.obstacles) if (near(o.pos.x, o.pos.z, o.radius)) return false;
    return true;
  }

  /** Where dancers gather: the festival green during a festival, else the totem. */
  get danceFloor(): { pos: THREE.Vector3; slotPosition(i: number, n: number, time: number, out: THREE.Vector3): THREE.Vector3 } {
    return this.festival ?? this.worship;
  }

  // ---------------------------------------------------------------- queries

  get population(): number {
    return this.villagers.length;
  }

  get capacity(): number {
    let c = 0;
    for (const h of this.houses) c += h.capacity;
    return c;
  }

  get completedHouses(): number {
    return this.houses.filter((h) => h.complete).length;
  }

  get influenceRadius(): number {
    return Math.min(INFLUENCE.max, INFLUENCE.base + INFLUENCE.perHouse * this.completedHouses);
  }

  contains(x: number, z: number, scale = 1.25): boolean {
    return Math.hypot(x - this.center.x, z - this.center.z) < this.radius * scale;
  }

  addVillager(v: Villager) {
    if (!this.villagers.includes(v)) this.villagers.push(v);
  }

  removeVillager(v: Villager) {
    const i = this.villagers.indexOf(v);
    if (i >= 0) this.villagers.splice(i, 1);
  }

  assignHome(v: Villager) {
    if (v.home) return;
    const h = this.houses.find((h) => h.vacancy > 0);
    if (h) {
      h.residents.push(v);
      v.home = h;
    }
  }

  removeHouse(game: Game, h: House) {
    const i = this.houses.indexOf(h);
    if (i >= 0) this.houses.splice(i, 1);
    game.remove(h);
  }

  constructionSite(): House | null {
    return this.houses.find((h) => !h.destroyed && h.progress < 1) ?? null;
  }

  builderCount(): number {
    return this.villagers.filter((v) => v.task.type === 'build').length;
  }

  findRipeField(v: Villager): Field | null {
    let best: Field | null = null;
    let bd = Infinity;
    for (const f of this.fields) {
      if (!f.ripe || f.burning || f.claimedBy) continue;
      const d = f.pos.distanceToSquared(v.pos);
      if (d < bd) {
        bd = d;
        best = f;
      }
    }
    return best;
  }

  findTree(game: Game, v: Villager): Tree | null {
    return game.nearest<Tree>('tree', v.pos.x, v.pos.z, this.radius * 2.4, (t) => {
      const tree = t as Tree;
      return tree.mature && !tree.claimedBy && !tree.burning && !tree.held && !tree.airborne && this.contains(t.pos.x, t.pos.z, 2.6);
    });
  }

  findPile(game: Game, v: Villager): Pile | null {
    const test = (e: { claimedBy: number; held: boolean; airborne: boolean; pos: THREE.Vector3 }) =>
      !e.claimedBy && !e.held && !e.airborne && this.contains(e.pos.x, e.pos.z, 1.8);
    return (
      game.nearest<Pile>('food', v.pos.x, v.pos.z, this.radius * 2, test) ??
      game.nearest<Pile>('wood', v.pos.x, v.pos.z, this.radius * 2, test)
    );
  }

  complain(game: Game, what: 'food' | 'homes') {
    if (this.owner !== 'player') return;
    const last = this.complaints.get(what) ?? -999;
    if (game.time - last < 45) return;
    this.complaints.set(what, game.time);
    if (what === 'food') game.message(`${this.name} is hungry! Their store is out of food.`, 'bad');
    else game.message(`${this.name} needs more homes.`, 'info');
  }

  // ----------------------------------------------------------------- update

  update(game: Game, dt: number) {
    this.roleTimer -= dt;
    if (this.roleTimer <= 0) {
      this.roleTimer = 1;
      this.assignRoles();
    }

    this.dancers = 0;
    this.starving = 0;
    for (const v of this.villagers) {
      if (v.isDancing) this.dancers++;
      if (v.hunger >= 1) this.starving++;
    }

    if (this.owner === 'player') {
      const faithMult = 0.5 + this.belief / 200;
      this.prayerRate = this.dancers * PLAYER.powerPerWorshipper * faithMult;
      game.player.addPower(this.prayerRate * dt);
      // Faith: slips while people starve, slowly recovers otherwise.
      if (this.starving > 0) this.belief -= dt * 0.35 * this.starving;
      else this.belief += dt * 0.4;
      this.belief = Math.min(100, this.belief);
      if (this.belief <= 0 && !this.isHome) this.abandon(game);
      this.belief = Math.max(this.isHome ? 5 : 0, this.belief);
    } else {
      this.prayerRate = 0;
      this.belief = Math.max(0, this.belief - VILLAGE.beliefDecay * dt);
    }

    this.updateGrowth(game, dt);
  }

  private assignRoles() {
    const frac = this.festival ? 1 : this.owner === 'player' ? this.worshipFraction : VILLAGE.neutralWorship;
    const adults = this.villagers.filter((v) => !v.dead);
    const want = Math.round(adults.length * frac);
    // The best-fed go to worship; everyone else works.
    const sorted = [...adults].sort((a, b) => a.hunger - b.hunger);
    let slot = 0;
    for (let i = 0; i < sorted.length; i++) {
      const v = sorted[i];
      const worship = i < want && v.hunger < 0.6;
      v.role = worship ? 'worship' : 'work';
      if (worship) v.danceSlot = slot++;
    }
    this.worshipperCount = slot;
  }

  private updateGrowth(game: Game, dt: number) {
    // Births
    this.birthTimer += dt;
    if (this.birthTimer > VILLAGE.birthInterval) {
      this.birthTimer = 0;
      const pop = this.population;
      if (pop < this.capacity && this.store.food > 12 + pop * 2 && pop > 1) {
        const h = this.houses.find((h) => h.vacancy > 0)!;
        const p = h.doorPoint(new THREE.Vector3());
        const v = new Villager(this, p.x, p.z, villagerSeed++);
        v.pos.y = game.terrain.heightAt(p.x, p.z);
        this.store.take('food', 10);
        this.addVillager(v);
        h.residents.push(v);
        v.home = h;
        game.add(v);
        game.fx.sparkle(p.x, p.y + 1.5, p.z, 20, 0xffc0e0, 2);
        game.events.emit('villagerBorn', { villager: v });
        if (this.owner === 'player') game.message(`A new villager is born in ${this.name}.`, 'good');
      }
    }

    // Farmland grows with the population.
    this.fieldTimer += dt;
    if (this.fieldTimer > 12) {
      this.fieldTimer = 0;
      const wanted = Math.min(VILLAGE.maxFields, 2 + Math.floor(this.population / 6));
      if (this.fields.length < wanted && this.store.wood >= 15) {
        const spot = this.findSpot(game, 0.85, 1.35, 9);
        if (spot) {
          const f = new Field(this, spot.x, spot.y, spot.z, Math.atan2(this.center.x - spot.x, this.center.z - spot.z), 0);
          this.store.take('wood', 15);
          this.fields.push(f);
          game.add(f);
        }
      }
    }

    // Construction: plan a house when nearly full and there's timber.
    if (
      !this.constructionSite() &&
      this.capacity - this.population <= 1 &&
      this.houses.length < VILLAGE.maxHouses &&
      this.store.wood >= 10
    ) {
      const spot = this.findSpot(game, 0.3, 0.9, 6.5);
      if (spot) {
        const h = new House(this, spot.x, spot.y, spot.z, Math.atan2(this.center.x - spot.x, this.center.z - spot.z), rng.int(0, 1e6), false);
        this.houses.push(h);
        game.add(h);
      }
    }
  }

  convert(game: Game) {
    this.owner = 'player';
    this.belief = 70;
    this.worshipFraction = VILLAGE.defaultWorship;
    game.onVillageConverted(this);
  }

  private abandon(game: Game) {
    const toRival = this.rivalPressure > 0 && !this.isHome;
    this.owner = toRival ? 'rival' : null;
    this.belief = 0;
    if (toRival) game.onVillageTurned(this);
    else game.onVillageLost(this);
  }
}
