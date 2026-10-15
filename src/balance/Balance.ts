import type { Game } from '../Game';
import type { Prayer, Prayers } from '../prayers/Prayers';
import type { Tree } from '../entities/Nature';
import type { Field } from '../entities/Buildings';
import { clamp, damp, smoothstep } from '../util/math';

// ------------------------------------------------------------------ tuning knobs

/**
 * How much each part of the world counts toward the balance (they sum to 1). The first four are the
 * world as it stands right now; `deeds` is what you have been doing lately (see DEED).
 */
export const WEIGHT = {
  /** Standing forest, compared with the island's first day (stumps and charred trees don't count). */
  forest: 0.12,
  /** Villagers fed rather than hungry or starving, in every village. */
  fed: 0.1,
  /** Faith in your villages (a village turned to the rival counts as almost none). */
  faith: 0.1,
  /** People alive, compared with the first day. */
  people: 0.08,
  /** Tending versus ruin, remembered for a while (see DEED, DEED_HALF_LIFE). */
  deeds: 0.6,
};

/**
 * What each deed is worth, in deed points. The memory of deeds fades (DEED_HALF_LIFE) and its weight
 * saturates (DEED_SCALE), so one act never decides the world: a habit does.
 */
export const DEED = {
  // Tending lifts it.
  prayerAnswered: 2.5,
  fireOut: 1.2,
  rainOnVillage: 0.5,
  /** Per 30 units of food or wood dropped on a store. */
  gift: 0.6,
  schemeFoiled: 1.5,
  // Ruin and cruelty pull it down.
  /** A villager killed by your hand: thrown, crushed or burned. */
  killed: -6,
  /** Eaten by your golem. */
  eaten: -4,
  starved: -3,
  /** Any other death (a lightning fire, a fall). */
  died: -1,
  /** A villager hurled hard: cruel even when they live. */
  thrown: -1.5,
  /** A home destroyed by you, or lost some other way. */
  homeDestroyed: -4,
  homeLost: -1,
  /** Casting fire at all. */
  fireMiracle: -1,
  /** Each thing burning, per second: from a fire you set, or a natural one nobody puts out. */
  burningSet: -0.08,
  burningWild: -0.02,
  /** A prayer for something wanted (timber, a sign) left to fade. */
  ignored: -1,
  /** A prayer born of suffering (food, rain, a fire, a lost child) left to fade. */
  suffering: -2.5,
  villageTurned: -2,
  villageLost: -3,
};
/** Game seconds for the memory of deeds to halve (1.5 days). */
export const DEED_HALF_LIFE = 450;
/** Deed points at which the deeds term is about three-quarters of the way to its end (tanh(1) = 0.76). */
export const DEED_SCALE = 16;
/**
 * Ruin weighs more than tending: when your deeds lean toward ruin, up to this much more comes off the
 * whole world (so cruelty can bring a still-green island down, not just cancel your kindness).
 */
export const RUIN = 0.3;

/** Game seconds for the shown balance to close about 63% of the gap to where the world is heading. Harm shows faster than healing. */
export const TAU_FALL = 170;
export const TAU_RISE = 260;
/** Bands for the `balanceBand` event (and the endings): in tune at or above TUNE, falling below FALLING. */
export const TUNE = 0.62;
export const FALLING = 0.35;
const BAND_HYSTERESIS = 0.03;
/** "Sustained" for the endings: seconds spent continuously below LOW or above HIGH. */
export const LOW = 0.25;
export const HIGH = 0.75;
/**
 * Open question in BRIEF v0.5: does extreme good also strain the world? How much an extreme alignment
 * (either way, past 0.75) pulls the balance down. 0 = off; try 0.1.
 */
export const EXTREME_STRAIN = 0;
/** First-day counts, used when a save from before v0.5 has no record of its own. */
const FRESH = { trees: 440, people: 29 };
/** Seconds between looks at the whole world. */
const TICK = 1;

export type Band = 'tune' | 'tipping' | 'falling';
type PrayerSystem = Prayers;

/** The worst single thing you did: where it was (the endings lane leaves a ruin there). */
export interface WorstDeed {
  x: number;
  z: number;
  what: string;
  points: number;
  day: number;
}

/**
 * The balance of the world, 0 (ruined, out of tune) to 1 (in tune). Separate from the good/evil
 * alignment: you can be stern and still keep a world in balance. Nothing on screen shows it as a
 * number; the island does (see BalanceLook) and Vexahl answers it (see src/rival).
 *
 * lean   = tanh(deeds / DEED_SCALE)                          -1 (ruin) .. +1 (tending)
 * target = WEIGHT.forest * forest + WEIGHT.fed * fed + WEIGHT.faith * faith + WEIGHT.people * people
 *        + WEIGHT.deeds * (0.5 + 0.5 * lean) - RUIN * max(0, -lean) - scar - strain
 * `value` eases toward `target` over a few game hours (TAU_FALL / TAU_RISE).
 */
export class Balance {
  /** The balance (0..1), smoothed. What everything else reads. */
  value = 0.75;
  /** Where the world is heading right now (0..1). */
  target = 0.75;
  /** The memory of deeds, in deed points (+ tending, - ruin); fades with DEED_HALF_LIFE. */
  deeds = 0;
  band: Band = 'tune';
  /** Seconds the balance has stayed below LOW / above HIGH without a break. */
  lowFor = 0;
  highFor = 0;
  worst: WorstDeed | null = null;
  /** Recent cruelties by kind, fading like the deeds: Vexahl's schemes echo them. */
  readonly echo = { burn: 0, throw: 0, neglect: 0 };
  private readonly terms = { forest: 1, fed: 1, faith: 1, people: 1, deeds: 0.5, ruin: 0, scar: 0, strain: 0 };
  private base = { trees: 0, people: 0 };
  private started = false;
  /** A save with a balance record was loaded (so `begin()` doesn't re-derive it). */
  private loaded = false;
  private forced: number | null = null;
  private tickT = 0;
  private snapshot: Prayer[] = [];
  private lastAnswered = 0;

  constructor(private readonly game: Game) {
    const ev = game.events;
    ev.on('fireOut', ({ entity }) => this.deed(DEED.fireOut, 'fireOut', entity.pos.x, entity.pos.z));
    ev.on('rainedOn', ({ village }) => this.deed(DEED.rainOnVillage, 'rain', village.center.x, village.center.z));
    ev.on('gift', ({ village, amount }) => this.deed(DEED.gift * Math.min(2, amount / 30), 'gift', village.center.x, village.center.z));
    ev.on('schemeFoiled', ({ village }) => this.deed(DEED.schemeFoiled, 'foiled', village.center.x, village.center.z));
    ev.on('villagerDied', ({ villager, cause, byPlayer }) => {
      if (cause === 'old' && !byPlayer) return; // a long life, ending: neither tending nor ruin
      const pts = byPlayer ? DEED.killed : cause === 'eaten' ? DEED.eaten : cause === 'starved' ? DEED.starved : DEED.died;
      this.deed(pts, byPlayer ? `killed (${cause})` : cause, villager.pos.x, villager.pos.z);
      if (cause === 'starved') this.echo.neglect += 1;
    });
    ev.on('throw', ({ entity, speed }) => {
      if (entity.kind !== 'villager' || speed <= 25) return;
      this.deed(DEED.thrown, 'thrown', entity.pos.x, entity.pos.z);
      this.echo.throw += 1;
    });
    ev.on('houseDestroyed', ({ house, byPlayer }) => {
      this.deed(byPlayer ? DEED.homeDestroyed : DEED.homeLost, byPlayer ? 'home destroyed' : 'home lost', house.pos.x, house.pos.z);
      if (byPlayer) this.echo.burn += 1;
    });
    ev.on('miracle', ({ id, x, z }) => {
      if (id !== 'fire') return;
      this.deed(DEED.fireMiracle, 'fire', x, z);
      this.echo.burn += 0.5;
    });
    ev.on('villageTurned', ({ village }) => this.deed(DEED.villageTurned, 'turned', village.center.x, village.center.z));
    ev.on('villageLost', ({ village }) => this.deed(DEED.villageLost, 'lost', village.center.x, village.center.z));
  }

  private get prayers(): PrayerSystem | null {
    return (this.game as unknown as { prayerSystem?: PrayerSystem }).prayerSystem ?? null;
  }

  /** Remember a deed (positive tends, negative ruins). Also the hook for other systems: `game.balance.deed(-2, 'why', x, z)`. */
  deed(points: number, what: string, x = 0, z = 0) {
    this.deeds += points;
    if (points < 0 && (!this.worst || points <= this.worst.points)) this.worst = { x: Math.round(x), z: Math.round(z), what, points, day: this.game.day };
  }

  /** The pieces of the target, each 0..1 (scar and strain are subtracted). For tests and the endings lane. */
  breakdown() {
    const t = this.terms;
    return {
      value: +this.value.toFixed(3),
      target: +this.target.toFixed(3),
      band: this.band,
      forest: +t.forest.toFixed(2),
      fed: +t.fed.toFixed(2),
      faith: +t.faith.toFixed(2),
      people: +t.people.toFixed(2),
      deeds: +t.deeds.toFixed(2),
      deedPoints: +this.deeds.toFixed(1),
      ruin: +t.ruin.toFixed(3),
      scar: +t.scar.toFixed(3),
      strain: +t.strain.toFixed(3),
      lowFor: Math.round(this.lowFor),
      highFor: Math.round(this.highFor),
      worst: this.worst,
    };
  }

  /** A sudden drop the world feels at once (taking Vexahl's ring), on top of the deed it leaves in the memory. */
  jolt(amount: number) {
    if (this.forced !== null) return;
    this.value = clamp(this.value - amount, 0, 1);
  }

  /** Debug: pin the balance at `v` (0..1), or `null` to let the world decide again. */
  force(v: number | null) {
    this.forced = v === null ? null : clamp(v, 0, 1);
    if (this.forced !== null) this.value = this.target = this.forced;
  }

  get pinned(): boolean {
    return this.forced !== null;
  }

  // ------------------------------------------------------------- simulation

  update(dt: number) {
    if (!this.started) this.begin();
    this.tickT += dt;
    if (this.tickT >= TICK) {
      const step = this.tickT;
      this.tickT = 0;
      this.survey(step);
    }
    if (this.forced !== null) this.value = this.target = this.forced;
    else {
      const tau = this.target < this.value ? TAU_FALL : TAU_RISE;
      this.value += (this.target - this.value) * damp(1 / tau, dt);
    }
    this.lowFor = this.value < LOW ? this.lowFor + dt : 0;
    this.highFor = this.value > HIGH ? this.highFor + dt : 0;
    this.updateBand();
  }

  /** First step: a new island records its first-day counts; a save from before v0.5 starts where its world stands. */
  private begin() {
    this.started = true;
    const now = this.count();
    const fresh = !this.game.saves.loaded;
    if (!this.base.trees) this.base.trees = fresh ? now.trees : Math.max(now.trees, FRESH.trees);
    if (!this.base.people) this.base.people = fresh ? now.people : Math.max(now.people, FRESH.people);
    this.lastAnswered = this.prayers?.answered ?? 0;
    this.snapshot = [...(this.prayers?.active ?? [])];
    if (!this.loaded) {
      this.survey(0);
      this.value = this.target;
      this.band = this.bandOf(this.value);
    }
  }

  private count() {
    let trees = 0;
    for (const e of this.game.entities) {
      if (!e.alive || e.kind !== 'tree') continue;
      const t = e as Tree;
      if (t.charred || t.isFelling) continue;
      trees += Math.min(1, t.growth / 0.6);
    }
    let people = 0;
    for (const v of this.game.villages) people += v.population;
    return { trees, people };
  }

  /** Look at the whole world: the state terms, fires burning, prayers that faded. `dt` = seconds since the last look. */
  private survey(dt: number) {
    const g = this.game;
    const t = this.terms;

    // The memory of deeds fades.
    const fade = Math.pow(0.5, dt / DEED_HALF_LIFE);
    this.deeds *= fade;
    this.echo.burn *= fade;
    this.echo.throw *= fade;
    this.echo.neglect *= fade;

    // Forest and fire.
    let trees = 0;
    let charred = 0;
    let burningSet = 0;
    let burningWild = 0;
    let scorched = 0;
    let fx = 0;
    let fz = 0;
    for (const e of g.entities) {
      if (!e.alive) continue;
      if (e.burning) {
        if (e.ignitedByPlayer) {
          burningSet++;
          fx = e.pos.x;
          fz = e.pos.z;
        } else burningWild++;
      }
      if (e.kind === 'tree') {
        const tree = e as Tree;
        if (tree.charred) charred++;
        else if (!tree.isFelling) trees += Math.min(1, tree.growth / 0.6);
      } else if (e.kind === 'field' && (e as Field).scorched > 0) scorched++;
    }
    if (dt > 0 && burningSet) {
      this.deed(DEED.burningSet * burningSet * dt, 'fire', fx, fz);
      this.echo.burn += 0.02 * burningSet * dt;
    }
    if (dt > 0 && burningWild) this.deeds += DEED.burningWild * burningWild * dt;
    t.forest = smoothstep(0.35, 0.92, trees / Math.max(1, this.base.trees));
    t.scar = Math.min(0.12, charred * 0.003 + scorched * 0.02);

    // People: fed, faithful, alive.
    let people = 0;
    let starving = 0;
    let hungry = 0;
    let faith = 0;
    let faithN = 0;
    for (const v of g.villages) {
      people += v.population;
      for (const p of v.villagers) {
        if (p.dead) continue;
        if (p.hunger >= 1) starving++;
        else if (p.hunger > 0.8) hungry++;
      }
      if (v.owner === 'player') {
        faith += v.belief / 100;
        faithN++;
      } else if (v.owner === 'rival') {
        faith += 0.1;
        faithN++;
      }
    }
    t.fed = 1 - clamp(((starving + 0.35 * hungry) / Math.max(1, people)) * 2.5, 0, 1);
    t.faith = faithN ? smoothstep(0.1, 0.9, faith / faithN) : 0;
    t.people = smoothstep(0.4, 0.92, people / Math.max(1, this.base.people));

    if (dt > 0) this.watchPrayers();
    const lean = Math.tanh(this.deeds / DEED_SCALE);
    t.deeds = 0.5 + 0.5 * lean;
    t.ruin = RUIN * Math.max(0, -lean);
    t.strain = EXTREME_STRAIN * smoothstep(0.75, 1, Math.abs(g.player.alignment));

    const sum = WEIGHT.forest * t.forest + WEIGHT.fed * t.fed + WEIGHT.faith * t.faith + WEIGHT.people * t.people + WEIGHT.deeds * t.deeds;
    if (this.forced === null) this.target = clamp(sum - t.ruin - t.scar - t.strain, 0, 1);
  }

  /** Prayers that left the list: answered (counted by the prayer system), or left to fade. */
  private watchPrayers() {
    const ps = this.prayers;
    if (!ps) return;
    const now = this.game.time;
    let answered = ps.answered - this.lastAnswered;
    this.lastAnswered = ps.answered;
    for (const p of this.snapshot) {
      if (ps.active.includes(p)) continue;
      const faded = now >= p.expiresAt - 0.6 || (p.kind === 'fire' && !!p.house && (p.house.destroyed || !p.house.alive));
      if (!faded && answered > 0) {
        answered--;
        this.deed(DEED.prayerAnswered, 'answered');
      } else if (faded) {
        const suffering = p.kind === 'food' || p.kind === 'rain' || p.kind === 'fire' || p.kind === 'lost';
        this.deed(suffering ? DEED.suffering : DEED.ignored, `unanswered ${p.kind}`, p.village.center.x, p.village.center.z);
        this.echo.neglect += suffering ? 1 : 0.4;
      }
    }
    // Answered within the same look they were born in (never seen in the list).
    if (answered > 0) this.deed(DEED.prayerAnswered * answered, 'answered');
    this.snapshot = [...ps.active];
  }

  private bandOf(v: number): Band {
    return v >= TUNE ? 'tune' : v < FALLING ? 'falling' : 'tipping';
  }

  private updateBand() {
    const v = this.value;
    const h = BAND_HYSTERESIS;
    let next: Band = this.band;
    if (this.band === 'tune' && v < TUNE - h) next = v < FALLING ? 'falling' : 'tipping';
    else if (this.band === 'falling' && v >= FALLING + h) next = v >= TUNE ? 'tune' : 'tipping';
    else if (this.band === 'tipping') {
      if (v >= TUNE + h) next = 'tune';
      else if (v < FALLING - h) next = 'falling';
    }
    if (next === this.band) return;
    const from = this.band;
    this.band = next;
    this.game.events.emit('balanceBand', { band: next, from, value: v });
  }

  // ------------------------------------------------------------- save / load

  /** Save/load. Version 1 (v0.5). A save from before v0.5 has no entry: `begin()` then starts from the world as it stands. */
  save() {
    const r = (n: number, k = 1000) => Math.round(n * k) / k;
    return {
      v: 1,
      value: r(this.value),
      deeds: r(this.deeds, 100),
      base: { trees: Math.round(this.base.trees), people: this.base.people },
      lowFor: Math.round(this.lowFor),
      highFor: Math.round(this.highFor),
      echo: { burn: r(this.echo.burn, 100), throw: r(this.echo.throw, 100), neglect: r(this.echo.neglect, 100) },
      worst: this.worst,
    };
  }

  load(data: unknown) {
    const d = data as Partial<ReturnType<Balance['save']>> | null;
    if (!d || typeof d !== 'object' || typeof d.value !== 'number' || !Number.isFinite(d.value)) return;
    this.loaded = true;
    this.value = this.target = clamp(d.value, 0, 1);
    this.band = this.bandOf(this.value);
    if (typeof d.deeds === 'number' && Number.isFinite(d.deeds)) this.deeds = d.deeds;
    if (d.base && d.base.trees > 0 && d.base.people > 0) this.base = { trees: d.base.trees, people: d.base.people };
    this.lowFor = d.lowFor ?? 0;
    this.highFor = d.highFor ?? 0;
    if (d.echo) Object.assign(this.echo, d.echo);
    this.worst = d.worst ?? null;
  }
}
