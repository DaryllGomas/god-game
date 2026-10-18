import { spotOk } from '../world/Pads';
import * as THREE from 'three';
import type { Game } from '../Game';
import { Field, House, Store, WorshipSite } from '../entities/Buildings';
import { Villager } from '../entities/Villager';
import type { Pile, Tree } from '../entities/Nature';
import { INFLUENCE, PLAYER, VILLAGE, type Owner, type VillageSite } from '../config';
import { Rng, rng } from '../util/rng';
import type { Site } from '../projects/Site';
import { circle, type LightShape } from '../reach/Light';
import { SHRINE_CLEARANCE, SHRINE_STAGES, type ShrineStage } from '../shrines/stages';
import { RING } from '../rival/data';

/** Half-size of the pad a house gets (a cottage is up to 5.4 x 4.6, plus its margin). */
const HOUSE_PAD = { hx: 3.4, hz: 3.1 };


/** Anywhere a village dances: its prayer place, or a festival floor. */
export interface DanceFloor {
  pos: THREE.Vector3;
  slotPosition(i: number, n: number, time: number, out: THREE.Vector3): THREE.Vector3;
}

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
  /** Your light's growth: [grown, still to flow out] in metres (2026-10-14; missing in older saves). */
  light?: [number, number];
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
  /** A festival: while set, everyone dances there (the new temple's opening night) instead of only the worshippers. */
  festival: DanceFloor | null = null;
  /** The age its prayer place has reached, and every age it has stood at (see src/shrines; the legacy record lists them). */
  shrineStage: ShrineStage = 'totem';
  readonly shrineStagesReached: ShrineStage[] = ['totem'];
  /** Places the project plugin has built on (so houses and fields keep clear). */
  readonly obstacles: { pos: THREE.Vector3; radius: number }[] = [];

  dancers = 0;
  worshipperCount = 0;
  starving = 0;
  prayerRate = 0;
  /** > 0 while the rival god is pressing on this village (set by src/rival): if its faith hits 0 it turns to him instead of drifting away. */
  rivalPressure = 0;
  /**
   * Ruled by fear (src/rival Ring, 2026-10-15): it knelt when you took Vexahl's ring. Its homes glow cold violet and
   * ember instead of gold, fewer of its people dance and their prayer is weaker (RING.fear); it lifts in a world in tune.
   */
  fear = false;
  /** Not yours: belief holds (no fading) until this game time, set whenever a deed raises it (VILLAGE.beliefHold). */
  beliefHeldUntil = 0;
  /** Belief after the last update, to notice rises from any source (impress, prayers, projects). */
  private lastBelief = Infinity;
  /** Your light: metres it has grown by tending (see `grow`), and metres earned but not yet flowed out. */
  ringGrowth = 0;
  ringPending = 0;
  /** Families that came to believe at the last check (for the moment a household joins or leaves). */
  private joinedLast = -1;

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
    if (Array.isArray(d.light)) {
      this.ringGrowth = Number(d.light[0]) || 0;
      this.ringPending = Number(d.light[1]) || 0;
    } else this.ringGrowth = -1; // an older save: grown to its stage's cap (see fillLightFromOldSave)
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
      const spot = this.findSpot(game, 0.4, 0.9, 6.5, HOUSE_PAD);
      if (!spot) break;
      const h = new House(this, spot.x, spot.y, spot.z, Math.atan2(c.x - spot.x, c.z - spot.z), r.int(0, 1e6), true);
      this.houses.push(h);
      game.add(h);
    }

    for (let i = 0; i < site.fields; i++) {
      const spot = this.findSpot(game, 0.95, 1.3, 9);
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
  findSpot(game: Game, minR: number, maxR: number, clearance: number, pad?: { hx: number; hz: number }): THREE.Vector3 | null {
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
      // Things that stand on a levelled pad (houses) need ground a pad can be made on (see world/Pads.ts).
      if (pad && !spotOk(game, { x, z, rot: Math.atan2(this.center.x - x, this.center.z - z), hx: pad.hx, hz: pad.hz })) continue;
      return new THREE.Vector3(x, game.terrain.heightAt(x, z), z);
    }
    return null;
  }

  private clearOf(x: number, z: number, clearance: number): boolean {
    const near = (px: number, pz: number, r: number) => Math.hypot(px - x, pz - z) < r + clearance;
    if (near(this.store.pos.x, this.store.pos.z, 5)) return false;
    if (near(this.worship.pos.x, this.worship.pos.z, SHRINE_CLEARANCE)) return false;
    for (const h of this.houses) if (near(h.pos.x, h.pos.z, 2.5)) return false;
    for (const f of this.fields) if (near(f.pos.x, f.pos.z, 5)) return false;
    for (const o of this.obstacles) if (near(o.pos.x, o.pos.z, o.radius)) return false;
    return true;
  }

  /** Where dancers gather: the festival green during a festival, else the totem. */
  get danceFloor(): DanceFloor {
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

  // ------------------------------------------------------------ your light

  private get stageIndex(): number {
    return Math.max(0, SHRINE_STAGES.indexOf(this.shrineStage));
  }

  /** The most this village's light can reach at its prayer place's age (INFLUENCE.stageCap). */
  get ringCap(): number {
    const caps = INFLUENCE.stageCap;
    return caps[Math.min(caps.length - 1, this.stageIndex)];
  }

  /** The light a village has without any tending: its homes and its prayer place. */
  get ringBase(): number {
    return Math.min(this.ringCap, INFLUENCE.base + INFLUENCE.perHouse * this.completedHouses + INFLUENCE.perStage * this.stageIndex);
  }

  /** How far this village's light reaches (along the road toward the next village; see `lightShape`). */
  get influenceRadius(): number {
    return Math.min(this.ringCap, this.ringBase + Math.max(0, this.ringGrowth));
  }

  /** The round part of the light: it grows only a share of what the leaning tip grows. */
  get roundRadius(): number {
    return Math.min(this.influenceRadius, this.ringBase + Math.max(0, this.ringGrowth) * INFLUENCE.roundShare);
  }

  /** A deed in or for this village: its light will grow by `m` metres (flowing out over a few seconds). */
  grow(m: number) {
    if (m > 0) this.ringPending += m;
  }

  /** An older save had no growth: a village of yours keeps the reach it had (its stage's full light). */
  fillLightFromOldSave() {
    if (this.ringGrowth >= 0) return;
    this.ringGrowth = this.owner === 'player' ? Math.max(0, this.ringCap - this.ringBase) : 0;
  }

  private flowLight(dt: number) {
    if (this.ringPending <= 0) return;
    const room = this.ringCap - (this.ringBase + this.ringGrowth);
    const d = Math.min(this.ringPending, INFLUENCE.flow * dt, Math.max(0, room));
    if (d > 0) {
      this.ringGrowth += d;
      this.ringPending -= d;
    }
    // Only what is earned beyond the cap is banked (and the bank is limited); below the cap it all flows out.
    if (room - d <= 0) this.ringPending = Math.min(this.ringPending, INFLUENCE.bank);
  }

  /**
   * This village's light on the ground: a circle, or an egg leaning toward `toward` (the nearest village that
   * isn't yours) with its tip at the full reach.
   */
  lightShape(toward: Village | null): LightShape {
    const c = this.center;
    const reach = this.influenceRadius;
    const round = this.roundRadius;
    if (!toward || reach - round < 3) return circle(c.x, c.z, toward ? reach : round);
    const rb = Math.max(14, round * INFLUENCE.tipShare);
    const dx = toward.center.x - c.x;
    const dz = toward.center.z - c.z;
    const d = Math.max(1, Math.hypot(dx, dz));
    const h = reach - rb;
    return { ax: c.x, az: c.z, ra: round, bx: c.x + (dx / d) * h, bz: c.z + (dz / d) * h, rb };
  }

  // --------------------------------------------------------- households

  /** Homes whose families can come to believe: finished, standing houses, nearest the prayer place first. */
  households(): House[] {
    const w = this.worship.pos;
    return this.houses
      .filter((h) => h.complete)
      .sort((a, b) => Math.hypot(a.pos.x - w.x, a.pos.z - w.z) - Math.hypot(b.pos.x - w.x, b.pos.z - w.z));
  }

  /** Families that must believe before the village is yours ("most of them": VILLAGE.joinShare). */
  familiesNeeded(n = this.households().length): number {
    return Math.max(1, Math.ceil(n * VILLAGE.joinShare));
  }

  /** Families with you: every one in a village of yours; in another, belief fills them one by one. */
  familiesWithYou(): number {
    const n = this.households().length;
    if (this.owner === 'player') return n;
    if (this.owner === 'rival') return 0;
    return Math.min(n, Math.floor((Math.max(0, this.belief) / VILLAGE.convertAt) * this.familiesNeeded(n) + 1e-6));
  }

  /** How far the next family is toward believing (0..1), for the segmented bar. */
  nextFamilyProgress(): number {
    if (this.owner !== null) return 0;
    const f = (Math.max(0, this.belief) / VILLAGE.convertAt) * this.familiesNeeded();
    return f - Math.floor(f);
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

  findTree(game: Game, v: Villager, wide = false): Tree | null {
    return game.nearest<Tree>('tree', v.pos.x, v.pos.z, wide ? 60 : this.radius * 2.4, (t) => {
      const tree = t as Tree;
      return tree.mature && !tree.claimedBy && !tree.burning && !tree.held && !tree.airborne && (wide ? Math.hypot(t.pos.x - this.center.x, t.pos.z - this.center.z) <= 60 : this.contains(t.pos.x, t.pos.z, 2.6));
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
      this.assignRoles(game);
    }

    this.dancers = 0;
    this.starving = 0;
    for (const v of this.villagers) {
      if (v.isDancing) this.dancers++;
      if (v.hunger >= 1) this.starving++;
    }

    if (this.owner === 'player') {
      const faithMult = (0.5 + this.belief / 200) * (this.fear ? RING.fear.prayer : 1);
      this.prayerRate = this.dancers * PLAYER.powerPerWorshipper * faithMult;
      game.player.addPower(this.prayerRate * dt);
      // Faith: slips while people starve, slowly recovers otherwise.
      if (this.starving > 0) this.belief -= dt * 0.35 * this.starving;
      else this.belief += dt * 0.4;
      this.belief = Math.min(100, this.belief);
      // The last age (src/nexus), up to the true end: the villages understand you and are becoming one, so none can
      // lose faith (Daryll, 2026-10-18: "until the end it'll lock them all in"). Neglect only slows them. After the
      // true end, staying on the island brings the old rules back: tending them is the game.
      // Also through the good ending itself (Ready to See, Whole, its card): the island keeps living behind it, and a
      // village slipping away there broke the moment (Caboose's playtest review, 4 of 5 runs).
      const phase = (game as unknown as { nexus?: { phase: string } }).nexus?.phase;
      const ending = (game as unknown as { endings?: { phase: string } }).endings?.phase;
      const locked = phase === 'ring' || phase === 'city' || phase === 'lit' || ending === 'ready' || ending === 'whole' || ending === 'card';
      if (this.belief <= 0 && !this.isHome && !locked) this.abandon(game);
      this.belief = Math.max(this.isHome ? 5 : locked ? 25 : 0, this.belief);
    } else {
      // Families that have come to believe dance for you at the totem, and their prayer reaches you (half strength).
      this.prayerRate = this.owner === null ? this.dancers * PLAYER.powerPerWorshipper * 0.5 : 0;
      if (this.prayerRate > 0) game.player.addPower(this.prayerRate * dt);
      // A deed that raised belief holds it for a while; only a long silence lets it fade, and slowly.
      if (this.belief > this.lastBelief) this.beliefHeldUntil = game.time + VILLAGE.beliefHold;
      if (game.time >= this.beliefHeldUntil) this.belief = Math.max(0, this.belief - VILLAGE.beliefDecay * dt);
      this.lastBelief = this.belief;
    }

    if (this.owner === 'player') this.flowLight(dt);
    this.updateGrowth(game, dt);
  }

  /** Each household that comes to believe glows gold; the moment one joins (or leaves) is marked. */
  private updateHouseholds(game: Game) {
    const homes = this.households();
    const neutral = this.owner === null;
    const joined = neutral ? this.familiesWithYou() : 0;
    homes.forEach((h, i) => h.setBelieving(neutral && i < joined));
    for (const h of this.houses) {
      if (!h.complete) h.setBelieving(false);
      if (h.fear !== (this.fear && this.owner === 'player')) h.setFear(this.fear && this.owner === 'player');
    }
    if (this.joinedLast >= 0 && neutral && joined !== this.joinedLast) {
      const h = homes[Math.min(joined, this.joinedLast)];
      if (h) {
        if (joined > this.joinedLast) {
          game.fx.sparkle(h.pos.x, h.pos.y + 4, h.pos.z, 26, 0xfff0b0, 3);
          game.audio.chime(h.pos, 1.4);
        }
        game.events.emit('householdJoined', { village: this, house: h, families: joined, of: homes.length, joined: joined > this.joinedLast });
      }
    }
    this.joinedLast = neutral ? joined : -1;
  }

  private assignRoles(game: Game) {
    this.updateHouseholds(game);
    const adults = this.villagers.filter((v) => !v.dead && !v.disciple);
    let slot = 0;
    if (this.owner !== null || this.festival) {
      // Yours, or his (the rival's people dance for him as they always did).
      const frac = this.festival ? 1 : this.owner === 'player' ? this.worshipFraction * (this.fear ? RING.fear.dance : 1) : VILLAGE.neutralWorship;
      const want = Math.round(adults.length * frac);
      // The best-fed go to worship; everyone else works.
      const sorted = [...adults].sort((a, b) => a.hunger - b.hunger);
      for (let i = 0; i < sorted.length; i++) {
        const v = sorted[i];
        const worship = i < want && v.hunger < 0.6;
        v.role = worship ? 'worship' : 'work';
        if (worship) v.danceSlot = slot++;
      }
    } else {
      // Not yours yet: the families that have come to believe dance for you (a few of each, so the work goes on).
      const believing = new Set(this.households().slice(0, this.familiesWithYou()));
      const perHome = new Map<House, number>();
      for (const v of adults) {
        const h = v.home;
        const n = h ? perHome.get(h) ?? 0 : 0;
        const worship = !!h && believing.has(h) && n < 2 && v.hunger < 0.6;
        if (h && worship) perHome.set(h, n + 1);
        v.role = worship ? 'worship' : 'work';
        if (worship) v.danceSlot = slot++;
      }
    }
    for (const v of this.villagers) {
      if (!v.disciple || v.dead) continue;
      v.role = v.disciple === 'worshipper' ? 'worship' : 'work';
      if (v.role === 'worship') v.danceSlot = slot++;
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
      this.houses.length < (this.owner === 'player' ? VILLAGE.maxHouses : VILLAGE.neutralMaxHouses) &&
      this.store.wood >= 10
    ) {
      const spot = this.findSpot(game, 0.4, 1.0, 6.5, HOUSE_PAD);
      if (spot) {
        const h = new House(this, spot.x, spot.y, spot.z, Math.atan2(this.center.x - spot.x, this.center.z - spot.z), rng.int(0, 1e6), false);
        this.houses.push(h);
        game.add(h);
      }
    }
  }

  convert(game: Game) {
    this.owner = 'player';
    this.joinedLast = -1;
    for (const h of this.houses) h.setBelieving(false, true);
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
