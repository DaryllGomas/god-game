import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Villager } from '../entities/Villager';
import type { Field } from '../entities/Buildings';
import type { Seasons } from '../seasons/Seasons';
import type { Rival } from './Rival';
import { BLIGHT, EMBER, HAND, HOME_FAITH_FLOOR, REPEL, STORM, VIOLET_LIGHT, WHISPERS, type SchemeKind } from './data';
import { DarkHand, Mist } from './RivalVisuals';

export type Outcome = 'foiled' | 'succeeded' | 'faded';

const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const dist2 = (ax: number, az: number, bx: number, bz: number) => Math.hypot(ax - bx, az - bz);

/** Something that keeps animating after its scheme is over (a mist thinning, a hand rising away). */
export interface Fading {
  frame(dt: number): void;
  readonly finished: boolean;
  dispose(): void;
}

/**
 * Drain a village's faith for the rival. Never takes the home village below its floor; any other
 * village that is drained to nothing turns to him.
 */
export function drainFaith(rival: Rival, v: Village, amount: number) {
  v.rivalPressure = 1;
  const floor = v.isHome ? HOME_FAITH_FLOOR : 0;
  if (v.belief > floor) v.belief = Math.max(floor, v.belief - amount);
  if (!v.isHome && v.belief <= 0.3) rival.turn(v);
}

/**
 * One scheme at a time: warned about, counterable, never lethal. `update` returns an outcome
 * when it is over; `frame` is for visuals; `end` releases everything (called once, whatever the outcome).
 */
export abstract class Scheme {
  abstract readonly kind: SchemeKind;
  phase: 'warning' | 'active' = 'warning';
  t = 0;

  constructor(
    protected readonly rival: Rival,
    readonly village: Village,
  ) {}

  protected get game(): Game {
    return this.rival.game;
  }
  /** One-line description for the chip. */
  abstract chipText(): string;
  /** Seconds to show on the chip. */
  abstract countdown(): number;
  /** 0..1 for the chip's bar. */
  abstract progress(): number;
  /** Extra villages the scheme is about (the storm touches several). */
  get targets(): Village[] {
    return [this.village];
  }
  abstract update(dt: number): Outcome | null;
  frame(_dt: number): void {}
  /** You did something kind near a village. */
  onGift(_v: Village): void {}
  onMiracle(_id: string, _x: number, _z: number): void {}
  onPrayerAnswered(_v: Village): void {}
  onRainedOn(_v: Village): void {}
  /** Where to point the camera to see it. */
  focus(): { x: number; z: number } {
    return { x: this.village.center.x, z: this.village.center.z };
  }
  /** Release everything. Return objects that should keep animating a little longer. */
  abstract end(outcome: Outcome): Fading[];
  /** For tests/debug. */
  describe(): Record<string, unknown> {
    return { kind: this.kind, phase: this.phase, village: this.village.name, t: +this.t.toFixed(1) };
  }
}

// ------------------------------------------------------------------------ whispers

export class Whispers extends Scheme {
  readonly kind = 'whispers' as const;
  repel = 0;
  private readonly mist: Mist;
  private readonly warn: number;

  constructor(rival: Rival, village: Village) {
    super(rival, village);
    this.warn = WHISPERS.warn * rival.diff.warn;
    this.mist = new Mist(rival.game, village);
    this.mist.setGoal(0.3);
  }

  chipText() {
    return this.phase === 'warning' ? `Whispers gather over ${this.village.name}` : `Whispers over ${this.village.name}: resist ${Math.round(this.repel)}%`;
  }
  countdown() {
    return this.phase === 'warning' ? this.warn - this.t : WHISPERS.max - (this.t - this.warn);
  }
  progress() {
    return this.phase === 'warning' ? this.t / this.warn : this.repel / WHISPERS.repel;
  }

  /** How quickly your golem, standing in the village, turns the whispers (a well-raised one is quicker). */
  golemRate(): number {
    const c = this.game.creature;
    if (!c || dist2(c.pos.x, c.pos.z, this.village.center.x, this.village.center.z) > this.village.radius * 1.15) return 0;
    const good = Math.max(0, c.alignment + 0.3) / 1.3;
    const grown = Math.min(1, Math.max(0, (c.size - 1) * 0.5));
    return WHISPERS.golemBase + WHISPERS.golemGood * Math.min(1, good + grown * 0.3);
  }

  private add(n: number) {
    this.repel = Math.min(WHISPERS.repel, this.repel + n);
  }
  onGift(v: Village) {
    if (v === this.village) this.add(REPEL.gift);
  }
  onMiracle(_id: string, x: number, z: number) {
    if (this.village.contains(x, z, 1.5)) this.add(REPEL.miracle);
  }
  onPrayerAnswered(v: Village) {
    if (v === this.village) this.add(REPEL.prayer);
  }

  update(dt: number): Outcome | null {
    this.t += dt;
    const v = this.village;
    if (v.owner !== 'player') return v.owner === 'rival' ? 'succeeded' : 'faded';
    this.mist.step(dt);
    this.add(this.golemRate() * dt);
    if (this.phase === 'warning' && this.t >= this.warn) {
      this.phase = 'active';
      this.game.message(`The whispers settle on ${v.name}. Their faith is slipping.`, 'warn', 'whisper-on');
    }
    if (this.phase === 'active') drainFaith(this.rival, v, WHISPERS.drain * this.rival.diff.bite * dt);
    this.mist.setGoal(this.phase === 'warning' ? 0.3 + 0.2 * (this.t / this.warn) : 1 - 0.8 * (this.repel / WHISPERS.repel));
    if (this.repel >= WHISPERS.repel) return 'foiled';
    if (this.phase === 'active' && this.t - this.warn >= WHISPERS.max) return 'succeeded';
    return null;
  }

  frame(dt: number) {
    this.mist.frame(dt);
  }

  end(): Fading[] {
    this.village.rivalPressure = 0;
    this.mist.setGoal(0);
    const m = this.mist;
    return [{ frame: (dt) => m.frame(dt), get finished() { return m.thick < 0.02; }, dispose: () => m.dispose() }];
  }

  describe() {
    return { ...super.describe(), repel: +this.repel.toFixed(1), faith: +this.village.belief.toFixed(1), golemRate: +this.golemRate().toFixed(2) };
  }
}

// ---------------------------------------------------------------------------- blight

const BLIGHT_TINT = new THREE.Color(0x6b3f96);

export class Blight extends Scheme {
  readonly kind = 'blight' as const;
  private readonly fields: { f: Field; hold: number }[] = [];
  private readonly warn: number;
  private motes = 0;
  private cleansed = false;

  constructor(rival: Rival, village: Village) {
    super(rival, village);
    this.warn = BLIGHT.warn * rival.diff.warn;
    const fields = village.fields.filter((f) => f.alive && !f.burning);
    fields.sort(() => Math.random() - 0.5);
    for (const f of fields.slice(0, BLIGHT.fields)) this.fields.push({ f, hold: Math.min(f.growth, 0.55) });
  }

  chipText() {
    return this.phase === 'warning' ? `Violet blight creeping toward ${this.village.name}` : `Blight in ${this.village.name}: needs a water miracle`;
  }
  countdown() {
    return this.phase === 'warning' ? this.warn - this.t : BLIGHT.max - (this.t - this.warn);
  }
  progress() {
    return this.phase === 'warning' ? this.t / this.warn : 1 - (this.t - this.warn) / BLIGHT.max;
  }
  focus() {
    const f = this.fields[0]?.f;
    return f ? { x: f.pos.x, z: f.pos.z } : super.focus();
  }

  private cleanse() {
    this.cleansed = true;
  }
  onMiracle(id: string, x: number, z: number) {
    if (id === 'water' && this.village.contains(x, z, 1.6)) this.cleanse();
  }
  onRainedOn(v: Village) {
    if (v === this.village) this.cleanse();
  }

  update(dt: number): Outcome | null {
    this.t += dt;
    if (this.village.owner !== 'player') return 'faded';
    if (this.cleansed) return 'foiled';
    this.motes -= dt;
    const g = this.game;
    if (this.phase === 'warning') {
      if (this.motes <= 0) {
        this.motes = 0.5;
        for (const { f } of this.fields) g.fx.sparkle(f.pos.x + rand(-4, 4), f.pos.y + rand(4, 9), f.pos.z + rand(-3, 3), 1, VIOLET_LIGHT, 1.5);
      }
      if (this.t >= this.warn) {
        this.phase = 'active';
        g.message(`${this.village.name}'s fields are withering. A water miracle will wash the blight away.`, 'warn', 'blight-on');
        // The village prays for rain, which doubles as a pointer to the cure.
        const ps = this.rival.prayers;
        if (ps && !ps.forVillage(this.village).some((p) => p.kind === 'rain')) ps.spawnNow(this.village, 'rain');
      }
    } else {
      // Fields stop growing and look withered violet.
      for (const b of this.fields) {
        if (!b.f.alive || b.f.burning) continue;
        b.f.growth = Math.min(b.f.growth, b.hold);
        (b.f as unknown as { cropMat: THREE.MeshStandardMaterial }).cropMat.color.copy(BLIGHT_TINT);
      }
      if (this.motes <= 0) {
        this.motes = 0.45;
        const b = pick(this.fields);
        if (b) g.fx.sparkle(b.f.pos.x + rand(-4, 4), b.f.pos.y + 1.5, b.f.pos.z + rand(-3, 3), 2, Math.random() < 0.25 ? EMBER : VIOLET_LIGHT, 1.5);
      }
      if (this.t - this.warn >= BLIGHT.max) return 'succeeded';
    }
    return null;
  }

  end(outcome: Outcome): Fading[] {
    // Let the crops recover: the next growth tick repaints them.
    for (const { f } of this.fields) {
      if (f.alive && outcome === 'foiled') {
        f.growth = Math.min(1, Math.max(f.growth, 0.3));
        this.game.fx.sparkle(f.pos.x, f.pos.y + 2, f.pos.z, 12, 0x9fe8a0, 4);
      }
    }
    return [];
  }

  describe() {
    return { ...super.describe(), fields: this.fields.length, blightedGrowth: this.fields.map((b) => +b.f.growth.toFixed(2)) };
  }
}

// ----------------------------------------------------------------------------- hand

const TUNICS = [0x3f6fc4, 0xc4803f, 0x7a4fb0];

export class GraspingHand extends Scheme {
  readonly kind = 'hand' as const;
  readonly hand: DarkHand;
  readonly target: Villager;
  private readonly total: number;
  private stage: 'shadow' | 'strike' | 'done' = 'shadow';
  private stageT = 0;
  private locked = false;
  private slapped = false;
  private caught = false;
  private result: Outcome | null = null;
  private readonly aim = new THREE.Vector3();

  constructor(rival: Rival, village: Village, target: Villager) {
    super(rival, village);
    this.target = target;
    this.total = rand(HAND.shadow[0], HAND.shadow[1]);
    this.hand = new DarkHand(rival.game);
    this.aim.set(target.pos.x, target.pos.y, target.pos.z);
    this.hand.aim.copy(this.aim);
    this.phase = 'warning';
  }

  chipText() {
    return this.stage === 'shadow' ? `A dark hand reaches for a villager of ${this.village.name}` : 'The hand closes...';
  }
  countdown() {
    return Math.max(0, this.total - this.t);
  }
  progress() {
    return Math.min(1, this.t / this.total);
  }
  focus() {
    return { x: this.aim.x, z: this.aim.z };
  }

  /** The slap: click the hand. */
  slap() {
    if (this.stage !== 'shadow' || this.slapped) return;
    this.slapped = true;
    this.hand.recoil();
    this.result = 'foiled';
    this.game.fx.sparkle(this.hand.group.position.x, this.hand.group.position.y, this.hand.group.position.z, 60, 0xffe28a, 6);
    this.game.fx.sparkle(this.hand.group.position.x, this.hand.group.position.y, this.hand.group.position.z, 30, EMBER, 5);
    this.game.shake(0.35);
    this.game.audio.slap(this.hand.group.position);
  }

  private tracking(): boolean {
    const t = this.target;
    return t.alive && !t.dead && !t.held && !t.airborne;
  }

  update(dt: number): Outcome | null {
    this.t += dt;
    this.stageT += dt;
    const t = this.target;
    if (this.slapped) return this.result;

    if (this.stage === 'shadow') {
      const left = this.total - this.t;
      // The shadow follows the villager lazily, then locks on for the last moments.
      if (left > HAND.lock && this.tracking()) {
        const k = 1 - Math.exp(-2.6 * dt);
        this.aim.x += (t.pos.x - this.aim.x) * k;
        this.aim.z += (t.pos.z - this.aim.z) * k;
      } else this.locked = true;
      this.hand.aim.copy(this.aim);
      this.hand.approach(this.t / this.total, HAND.reach + 1);
      if (this.t >= this.total) {
        this.stage = 'strike';
        this.stageT = 0;
        this.caught = this.tracking() && dist2(t.pos.x, t.pos.z, this.aim.x, this.aim.z) < HAND.reach;
        this.hand.strike(this.caught ? TUNICS[Math.abs(Math.floor(this.village.center.x)) % 3] : null);
        this.game.audio.schemeStrikes(this.aim);
      }
    } else if (this.stage === 'strike' && this.stageT >= 0.4) {
      this.stage = 'done';
      const g = this.game;
      g.fx.dust(this.aim.x, this.aim.y + 0.5, this.aim.z, 22, 1.2, 0x5a3a8a);
      g.fx.sparkle(this.aim.x, this.aim.y + 2, this.aim.z, 30, VIOLET_LIGHT, 4);
      g.shake(0.4);
      if (this.caught) {
        this.rival.abduct(t, this.village);
        this.hand.lift(TUNICS[Math.abs(Math.floor(this.village.center.x)) % 3]);
        this.result = 'succeeded';
      } else {
        this.hand.lift(null);
        this.result = 'foiled';
      }
    }
    if (this.stage === 'done') return this.result;
    if (this.village.owner !== 'player' && this.stage === 'shadow') return 'faded';
    return null;
  }

  frame(dt: number) {
    this.hand.frame(dt);
    // Hover glow when the cursor is over the hand: it is slappable.
    const g = this.game;
    this.hand.setHover(this.rival.cursorOverHand);
    void g;
  }

  end(): Fading[] {
    const h = this.hand;
    if (h.mode === 'hover') h.recoil();
    return [{ frame: (dt) => h.frame(dt), get finished() { return h.done; }, dispose: () => h.dispose() }];
  }

  describe() {
    return { ...super.describe(), stage: this.stage, targetAlive: this.target.alive, targetHeld: this.target.held, locked: this.locked, caught: this.caught };
  }
}

// ----------------------------------------------------------------------------- storm

export class VioletStorm extends Scheme {
  readonly kind = 'storm' as const;
  private readonly villages: Village[];
  private readonly reassured = new Set<Village>();
  private seen = false;
  private started = 0;
  private done = false;

  constructor(rival: Rival, village: Village, others: Village[]) {
    super(rival, village);
    this.villages = [village, ...others];
    const g = rival.game;
    const seasons = (g as unknown as { seasons?: Seasons }).seasons;
    if (seasons) {
      seasons.trigger('storm', { warn: STORM.warn * rival.diff.warn });
      tintStorm(seasons);
    }
    // Each frightened village prays for a sign; any miracle over it is the answer.
    const ps = rival.prayers;
    if (ps) for (const v of this.villages) if (!ps.forVillage(v).some((p) => p.kind === 'sign')) ps.spawnNow(v, 'sign');
  }

  get targets() {
    return this.villages;
  }

  private storm() {
    return (this.game as unknown as { seasons?: Seasons }).seasons?.storm ?? null;
  }

  chipText() {
    const names = this.villages.map((v) => v.name).join(' & ');
    const left = this.villages.filter((v) => !this.reassured.has(v)).length;
    return this.phase === 'warning' ? `Violet storm gathering: ${names}` : `Violet storm: give a sign to ${left} village${left === 1 ? '' : 's'}`;
  }
  countdown() {
    const s = this.storm();
    if (!s) return 0;
    if (this.phase === 'warning') return Math.max(0, STORM.warn * this.rival.diff.warn - s.t);
    return Math.max(0, STORM.active - (this.t - this.started));
  }
  progress() {
    return this.reassured.size / this.villages.length;
  }
  focus() {
    const v = this.villages.find((x) => !this.reassured.has(x)) ?? this.village;
    return { x: v.center.x, z: v.center.z };
  }

  onMiracle(id: string, x: number, z: number) {
    if (id !== 'water' && id !== 'food') return;
    for (const v of this.villages) if (v.contains(x, z, 1.5)) this.reassured.add(v);
  }

  update(dt: number): Outcome | null {
    this.t += dt;
    const s = this.storm();
    if (s) this.seen = true;
    if (s && this.phase === 'warning' && s.phase !== 'warning') {
      this.phase = 'active';
      this.started = this.t;
      this.game.message('His storm is over the island. A sign from you (a miracle over the village) will settle the villagers.', 'warn', 'vstorm-on');
    }
    if (this.phase === 'active') {
      for (const v of this.villages) if (v.owner === 'player' && !this.reassured.has(v)) drainFaith(this.rival, v, STORM.drain * this.rival.diff.bite * dt);
    }
    const live = this.villages.filter((v) => v.owner === 'player');
    if (!live.length) return this.villages.some((v) => v.owner === 'rival') ? 'succeeded' : 'faded';
    if (live.every((v) => this.reassured.has(v))) {
      this.done = true;
      return 'foiled';
    }
    if (this.seen && !s) return 'succeeded'; // the storm blew itself out while someone was still frightened
    if (!this.seen && this.t > 8) return 'faded'; // the storm never started (something cancelled it)
    return null;
  }

  end(): Fading[] {
    for (const v of this.villages) v.rivalPressure = 0;
    void this.done;
    return [];
  }

  describe() {
    return { ...super.describe(), villages: this.villages.map((v) => v.name), reassured: [...this.reassured].map((v) => v.name), storm: this.storm()?.phase ?? null };
  }
}

/** Give a storm his colours: violet-black clouds, violet lightning. (Reaches into the storm's own materials.) */
export function tintStorm(seasons: Seasons) {
  const s = seasons.storm as unknown as {
    cloudMat?: THREE.MeshStandardMaterial;
    boltMat?: THREE.MeshBasicMaterial;
  } | null;
  if (!s) return;
  s.cloudMat?.color.setRGB(0.78, 0.5, 1.15);
  s.cloudMat?.emissive.setHex(0x3a1470);
  if (s.cloudMat) s.cloudMat.emissiveIntensity = 0.9;
  s.boltMat?.color.setRGB(1.4, 0.6, 5);
}
