import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { Entity } from '../entities/Entity';
import { Pile, Rock, Tree } from '../entities/Nature';
import type { Site } from '../projects/Site';
import { STONE_PER_ROCK_AREA, type Res } from '../projects/defs';
import { CHILD_DAYS, ageDays } from '../people/age';
import { SEA_LEVEL } from '../config';
import {
  BAD_KEYS,
  DEED_ALIGNMENT,
  FRUIT_EVERY,
  FRUIT_REGROW,
  GOOD_INFO,
  GOOD_KEYS,
  GOOD_REWARD_MULT,
  HARMLESS_START,
  WATCH_GAIN,
  WATCH_RANGE,
  isGoodKey,
  type BadKey,
  type GoodKey,
} from './Deeds';
import { Field, type WorshipSite } from '../entities/Buildings';
import { Villager } from '../entities/Villager';
import { GolemModel, REST_POSE, type GolemPose } from './GolemModel';
import { angleLerp, clamp, damp, smoothstep } from '../util/math';
import { rng } from '../util/rng';

/** Things the golem can learn to like or dislike. */
export type LearnKey = BadKey | GoodKey;

export const LEARN_LABELS: Record<LearnKey, string> = {
  'eat:food': 'Eating food piles',
  'eat:crops': "Eating villagers' crops",
  'eat:villager': 'Eating villagers',
  'eat:rock': 'Eating rocks',
  'throw:rock': 'Throwing rocks',
  ...(Object.fromEntries(GOOD_KEYS.map((k) => [k, GOOD_INFO[k].icon])) as Record<GoodKey, string>),
};

/** The old habits (the panel's first group). */
export const LEARN_KEYS: LearnKey[] = [...BAD_KEYS];
export { GOOD_KEYS };
const ALL_KEYS: LearnKey[] = [...BAD_KEYS, ...GOOD_KEYS];

// Tuning
const START_SIZE = 1.5;
const MAX_SIZE = 2.6;
const HUNGER_RATE = 1 / 380; // per second awake: slower, so it isn't pushed to steal food
const SLEEP_HUNGER_RATE = 1 / 900;
const TIRE_RATE = 1 / 330;
const REST_RATE = 1 / 35;
/** A stroke or slap within this many seconds still counts toward the last thing it did. */
const MEMORY_WINDOW = 10;
/** ...or within this many real seconds, so at 4x speed there is still time to react (2026-10-15 playtest). */
const MEMORY_REAL = 6;
/** Eating a villager gives it a taste for it (the panel's "Eating villagers" bar moves) until you teach it otherwise. */
const VILLAGER_TASTE = 0.05;
const WALK_SPEED = 2.6;
const LOOK_RANGE = 45;
/** Base desire for a good deed it has no opinion of yet, and how much each point of opinion adds. */
const DEED_BASE = 0.18;
const DEED_GAIN = 1.0;
/** Seconds after being led somewhere during which deeds there are favoured. */
const GUIDE_WINDOW = 8;
const GUIDE_RADIUS = 30;
const MAX_TREES = 470;

type Food = Pile | Field | Villager | Rock;
type Action =
  | { kind: 'idle'; t: number }
  | { kind: 'wander'; target: THREE.Vector3; t: number }
  | { kind: 'goto'; target: THREE.Vector3; t: number }
  | { kind: 'eat'; key: LearnKey; target: Food; phase: 'go' | 'grab' | 'lift' | 'chew'; t: number }
  | { kind: 'throw'; rock: Rock; phase: 'go' | 'grab' | 'windup' | 'fling' | 'recover'; t: number }
  | { kind: 'haul'; item: Rock | Pile; site: Site; res: Res; phase: 'go' | 'grab' | 'carry' | 'drop'; t: number }
  | { kind: 'plant'; tree: Tree | null; target: THREE.Vector3; phase: 'go' | 'work'; t: number }
  | { kind: 'fire'; target: Entity; phase: 'go' | 'stomp'; t: number }
  | { kind: 'rescue'; who: Villager; phase: 'go' | 'grab' | 'carry'; t: number }
  | { kind: 'play'; who: Villager; phase: 'go' | 'play'; t: number }
  | { kind: 'guard'; who: Villager; t: number }
  | { kind: 'fruit'; tree: Tree; phase: 'go' | 'shake' | 'eat'; t: number }
  | { kind: 'fish'; spot: THREE.Vector3; face: number; phase: 'go' | 'wait' | 'catch'; t: number }
  | { kind: 'leash'; t: number }
  | { kind: 'sleep'; t: number }
  | { kind: 'hurt'; t: number }
  | { kind: 'cheer'; t: number };

const tmp = new THREE.Vector3();

/**
 * The player's pet. It has needs (hunger, energy), decides for itself what to do,
 * and learns from strokes and slaps which of its habits you approve of.
 * Its looks follow its *own* alignment, earned by its deeds.
 */
export class Golem extends Entity {
  readonly kind = 'creature' as const;
  readonly model = new GolemModel();
  readonly home: Village;
  /** Overrides its alignment for previewing looks; null shows the real one. */
  previewAlignment: number | null = null;

  alignment = 0;
  hunger = 0.45;
  energy = 0.9;
  size = START_SIZE;
  meals = 0;
  /** -1 (hates doing it) .. +1 (loves doing it). */
  readonly opinions: Record<LearnKey, number> = {
    'eat:food': 0.35,
    'eat:crops': 0.25,
    'eat:villager': 0.15,
    'eat:rock': 0.2,
    'throw:rock': 0.25,
    'deed:haul': 0,
    'deed:plant': 0,
    'deed:fire': 0,
    'deed:rescue': 0,
    'deed:play': 0,
    'deed:guard': 0,
    'eat:fruit': HARMLESS_START,
    'eat:fish': HARMLESS_START,
  };
  /** 0..1: how much it trusts your hand. Grows when you feed it; makes it keener on good deeds. */
  bond = 0;
  thought = 'Waking up';
  action: Action = { kind: 'idle', t: 2 };

  private lastDeed: { key: LearnKey; t: number; rt: number } | null = null;
  private holding: Entity | null = null;
  private shownAlignment = 0;
  private yaw = rng.range(0, Math.PI * 2);
  private moving = 0;
  // Walking state: stuck detection and which way round a building we're going.
  private walkOwner: Action | null = null;
  private walkStuck = 0;
  private walkClock = 0;
  private walkX = 0;
  private walkZ = 0;
  private detourSide = 0;
  /** Targets it gave up reaching, until game.time passes the value. */
  private skip = new Map<Entity, number>();
  private happy = 0;
  private readonly pose: GolemPose = { ...REST_POSE };
  private readonly target: GolemPose = { ...REST_POSE };
  private readonly eye = new THREE.Vector3();
  private lastStep = 0;
  /** Something the hand just did that it is glancing at. */
  private curious: { pos: THREE.Vector3; t: number } | null = null;
  private readonly watchedAt = new Map<LearnKey, number>();
  /** The leash: where the held hand points, and how long it stays fresh. */
  private leashPt = new THREE.Vector3();
  private leashT = 0;
  private guided: { x: number; z: number; t: number } | null = null;
  private readonly fruitReady = new WeakMap<Tree, number>();
  /** Food the hand put down for it. */
  private readonly handFed = new WeakSet<Entity>();
  private guardCheck = 0;
  /** When each good deed was last finished: a deed it just did is less tempting (so it doesn't do one thing forever). */
  private readonly doneAt = new Map<GoodKey, number>();

  constructor(home: Village, x: number, z: number) {
    super();
    this.home = home;
    this.object.add(this.model.root);
    this.pos.set(x, 0, z);
    this.mass = 60;
    this.applySize();
  }

  private applySize() {
    this.model.root.scale.setScalar(this.size);
    this.radius = 3.4 * this.size;
  }

  /** Save/load: what makes this golem *this* golem. Its current action is dropped (it wakes up idle). */
  saveState() {
    return {
      x: this.pos.x,
      z: this.pos.z,
      yaw: this.yaw,
      hunger: this.hunger,
      energy: this.energy,
      alignment: this.alignment,
      size: this.size,
      meals: this.meals,
      opinions: { ...this.opinions },
      bond: this.bond,
    };
  }

  loadState(s: Omit<ReturnType<Golem['saveState']>, 'bond'> & { bond?: number }) {
    this.yaw = s.yaw;
    this.hunger = s.hunger;
    this.energy = s.energy;
    this.alignment = s.alignment;
    this.shownAlignment = s.alignment;
    this.size = s.size;
    this.meals = s.meals;
    for (const k of ALL_KEYS) if (typeof s.opinions?.[k] === 'number') this.opinions[k] = s.opinions[k];
    this.bond = typeof s.bond === 'number' ? clamp(s.bond, 0, 1) : 0;
    this.applySize();
    this.action = { kind: 'idle', t: 1.5 };
    this.thought = 'Waking up';
  }

  get topHeight() {
    return 7.5 * this.size;
  }

  get statusText(): string {
    return this.thought;
  }

  // ------------------------------------------------------------ player input

  /**
   * What a stroke or slap right now would teach it about. Only the deed itself counts (or one it just
   * did): while it's still walking over to a rock or a snack, a pat is just affection.
   */
  currentLesson(game: Game): LearnKey | null {
    const a = this.action;
    if (a.kind === 'eat' && a.phase !== 'go') return a.key;
    if (a.kind === 'throw' && a.phase !== 'go') return 'throw:rock';
    const good = this.deedKeyOf(a);
    if (good) return good;
    const d = this.lastDeed;
    if (d && (game.time - d.t < MEMORY_WINDOW || game.realTime - d.rt < MEMORY_REAL)) return d.key;
    return null;
  }

  private teach(game: Game, delta: number) {
    const key = this.currentLesson(game);
    const top = this.pos.y + this.topHeight + 2;
    game.events.emit('creatureTaught', { key, delta });
    if (!key) {
      game.floatText(this.pos.x, top, this.pos.z, delta > 0 ? '♥' : '✖', delta > 0 ? '#ffb3c8' : '#ff8a7a');
      return;
    }
    const before = this.opinions[key];
    // A kind word right after a good deed sinks in deeper (and a slap after one stings less).
    const d = isGoodKey(key) ? (delta > 0 ? delta * GOOD_REWARD_MULT : delta * 0.5) : delta;
    this.opinions[key] = clamp(before + d * (1 - Math.abs(before) * 0.35), -1, 1);
    if (delta > 0 && isGoodKey(key)) this.bond = clamp(this.bond + 0.01, 0, 1);
    const arrow = delta > 0 ? '▲' : '▼';
    game.floatText(this.pos.x, top, this.pos.z, `${arrow} ${LEARN_LABELS[key]}`, delta > 0 ? '#9fe8a8' : '#ff8a7a');
  }

  /**
   * One "rub" of a stroke: a reward for whatever it is doing or just did.
   * `learn` is false once a single stroking session has taught all it can,
   * so long rubs make it happy without overwriting a lesson.
   */
  stroke(game: Game, learn = true) {
    if (learn) this.teach(game, 0.07);
    this.happy = 1;
    game.audio.purr(this.pos);
    this.alignment = clamp(this.alignment + 0.002, -1, 1);
    game.fx.sparkle(this.pos.x, this.pos.y + this.topHeight * 0.8, this.pos.z, 6, 0xffb3c8, 2 * this.size);
  }

  /** A quick click: a small reward and a happy hop. */
  pat(game: Game) {
    this.teach(game, 0.06);
    this.happy = 1;
    game.audio.happyHum(this.pos);
    if (this.action.kind === 'idle' || this.action.kind === 'wander') this.action = { kind: 'cheer', t: 0 };
    game.fx.sparkle(this.pos.x, this.pos.y + this.topHeight, this.pos.z, 40, 0xffe28a, 5 * this.size);
  }

  /** A slap: punish whatever it is doing or just did, and interrupt it. */
  slap(game: Game) {
    this.teach(game, -0.35);
    this.happy = 0;
    game.audio.slap(this.pos);
    this.alignment = clamp(this.alignment - 0.004, -1, 1);
    this.dropHeld();
    this.action = { kind: 'hurt', t: 1.2 };
    this.thought = 'Ow!';
    game.fx.dust(this.pos.x, this.pos.y + this.topHeight * 0.7, this.pos.z, 12, this.size);
    game.shake(0.4);
  }

  /** Walk over to a spot (the Hand's "come here"). */
  callTo(game: Game, point: THREE.Vector3) {
    if (!game.terrain.isLand(point.x, point.z, 0.5)) {
      game.message("Your golem can't swim. Call it somewhere on land.", 'warn', 'golem-swim');
      return;
    }
    this.dropHeld();
    this.action = { kind: 'goto', target: point.clone(), t: 60 };
    this.thought = 'Coming to you';
  }

  /** The key of the good deed an action is in the middle of (not just walking toward), if any. */
  private deedKeyOf(a: Action): GoodKey | null {
    switch (a.kind) {
      case 'haul': return a.phase !== 'go' ? 'deed:haul' : null;
      case 'plant': return a.phase !== 'go' ? 'deed:plant' : null;
      case 'fire': return a.phase !== 'go' ? 'deed:fire' : null;
      case 'rescue': return a.phase !== 'go' ? 'deed:rescue' : null;
      case 'play': return a.phase !== 'go' ? 'deed:play' : null;
      case 'guard': return 'deed:guard';
      case 'fruit': return a.phase !== 'go' ? 'eat:fruit' : null;
      case 'fish': return a.phase !== 'go' ? 'eat:fish' : null;
      default: return null;
    }
  }

  /**
   * Learning by watching: your hand just did a good deed at (x, z). If it is near enough it glances over,
   * its desire for that deed rises, and a stroke straight afterwards reinforces it.
   */
  observe(game: Game, key: GoodKey, x: number, z: number) {
    if (Math.hypot(x - this.pos.x, z - this.pos.z) > WATCH_RANGE) return;
    const k = this.action.kind;
    if (k === 'sleep' || k === 'hurt') return;
    if (game.time - (this.watchedAt.get(key) ?? -99) < 4) return;
    this.watchedAt.set(key, game.time);
    const before = this.opinions[key];
    this.opinions[key] = clamp(before + WATCH_GAIN * (1 - Math.abs(before) * 0.35), -1, 1);
    this.curious = { pos: new THREE.Vector3(x, game.terrain.heightAt(x, z) + 1, z), t: 2.4 };
    this.lastDeed = { key, t: game.time, rt: game.realTime };
    if (k === 'idle' || k === 'wander') this.idle(2.4);
    game.floatText(this.pos.x, this.pos.y + this.topHeight + 3, this.pos.z, `👀 ${GOOD_INFO[key].icon}`, '#bfeee8');
    game.events.emit('creatureTaught', { key, delta: WATCH_GAIN });
  }

  /** The hand put food right next to it: it takes it from the hand, and trusts the hand a little more. */
  feedFromHand(_game: Game, pile: Pile) {
    if (Math.hypot(pile.pos.x - this.pos.x, pile.pos.z - this.pos.z) > this.radius + 14) return;
    const k = this.action.kind;
    if (k === 'sleep' || k === 'hurt') return;
    this.handFed.add(pile);
    this.dropHeld();
    this.action = { kind: 'eat', key: 'eat:food', target: pile, phase: 'go', t: 0 };
    this.thought = 'Taking food from your hand';
  }

  /** The leash: the held hand points here; it follows (call every frame while held). */
  leash(game: Game, point: THREE.Vector3) {
    if (!game.terrain.isLand(point.x, point.z, 0.5)) return;
    this.leashPt.copy(point);
    this.leashT = 0.35;
    if (this.action.kind !== 'leash') {
      this.dropHeld();
      this.action = { kind: 'leash', t: 0 };
    }
  }

  endLeash() {
    this.leashT = 0;
  }

  /** Is it standing guard close enough to shield (x, z) from the dark hand? */
  guards(x: number, z: number): boolean {
    return this.action.kind === 'guard' && Math.hypot(x - this.pos.x, z - this.pos.z) < 10 * this.size;
  }

  /** A rock it threw killed someone. */
  onThrowKilled() {
    this.alignment = clamp(this.alignment - 0.08, -1, 1);
  }

  // ------------------------------------------------------------------ update

  update(game: Game, dt: number) {
    const asleep = this.action.kind === 'sleep';
    this.hunger = Math.min(1, this.hunger + (asleep ? SLEEP_HUNGER_RATE : HUNGER_RATE) * dt);
    this.energy = clamp(this.energy + (asleep ? REST_RATE : -TIRE_RATE) * dt, 0, 1);
    this.happy = Math.max(0, this.happy - dt * 0.4);
    if (this.curious && (this.curious.t -= dt) <= 0) this.curious = null;
    if (this.leashT > 0) {
      this.leashT -= dt;
      if (this.leashT <= 0 && this.action.kind === 'leash') {
        this.guided = { x: this.pos.x, z: this.pos.z, t: game.time };
        this.idle(0.4);
      }
    }
    this.watchForDarkHand(game, dt);

    const want = this.previewAlignment ?? this.alignment;
    this.shownAlignment += (want - this.shownAlignment) * damp(2.5, dt);
    this.model.setAlignment(this.shownAlignment);

    // Reset pose targets; the running action raises the ones it needs.
    Object.assign(this.target, REST_POSE);
    this.target.happy = this.happy;
    const walking = this.run(game, dt);
    this.moving += ((walking ? 1 : 0) - this.moving) * damp(3, dt);
    this.target.moving = this.moving;
    this.pos.y = game.terrain.heightAt(this.pos.x, this.pos.z);

    this.look(game, dt);
    for (const k of Object.keys(this.target) as (keyof GolemPose)[]) {
      if (k === 'lookYaw' || k === 'lookPitch' || k === 'moving') this.pose[k] = this.target[k];
      else this.pose[k] += (this.target[k] - this.pose[k]) * damp(7, dt);
    }
    this.model.update(dt, this.pose);
    const step = Math.floor(this.model.stepPhase / Math.PI);
    if (step !== this.lastStep) {
      this.lastStep = step;
      if (this.moving > 0.5) game.audio.golemStep(this.pos, this.size);
    }
    this.object.position.copy(this.pos);
    this.object.rotation.set(0, this.yaw, 0);

    if (this.holding) {
      this.object.updateMatrixWorld(true);
      const h = this.holding;
      this.model.handPoint(h.pos);
      if (h.kind === 'villager') h.pos.y -= 1;
      h.object.position.copy(h.pos);
    }
  }

  private look(game: Game, dt: number) {
    let lookYaw = Math.sin(game.time * 0.23 + this.id) * 0.6;
    let lookPitch = -0.05;
    let interest = 0;
    const focus = this.focusPoint();
    if (this.curious && focus === this.curious.pos && (this.action.kind === 'idle' || this.action.kind === 'wander')) {
      this.yaw = angleLerp(this.yaw, Math.atan2(focus.x - this.pos.x, focus.z - this.pos.z), damp(1.6, dt));
    }
    if (focus) {
      this.model.eyePoint(this.eye);
      const fx = focus.x - this.pos.x;
      const fz = focus.z - this.pos.z;
      lookYaw = normalizeAngle(Math.atan2(fx, fz) - this.yaw);
      lookPitch = Math.atan2(focus.y - this.eye.y, Math.max(1, Math.hypot(fx, fz)));
      interest = 0.5;
    } else {
      const hand = game.hand;
      const range = LOOK_RANGE * this.size;
      const hx = hand.pos.x - this.pos.x;
      const hz = hand.pos.z - this.pos.z;
      const hd = Math.hypot(hx, hz);
      if (hand.valid && hd < range) {
        this.model.eyePoint(this.eye);
        lookYaw = normalizeAngle(Math.atan2(hx, hz) - this.yaw);
        lookPitch = Math.atan2(hand.pos.y - this.eye.y, Math.max(1, hd));
        interest = 1 - hd / range;
        if (this.action.kind === 'idle' && Math.abs(lookYaw) > 0.9) this.yaw = angleLerp(this.yaw, this.yaw + lookYaw, damp(1.2, dt));
      }
    }
    this.target.lookYaw = lookYaw;
    this.target.lookPitch = lookPitch;
    this.target.interest = interest;
  }

  /** Whatever the current action is attending to, if anything. */
  private focusPoint(): THREE.Vector3 | null {
    const a = this.action;
    if (a.kind === 'eat' && a.phase === 'go') return a.target.pos;
    if (a.kind === 'throw' && a.phase === 'go') return a.rock.pos;
    if (a.kind === 'haul' && a.phase === 'go') return a.item.pos;
    if (a.kind === 'fire') return a.target.pos;
    if (a.kind === 'rescue' || a.kind === 'play' || a.kind === 'guard') return a.who.pos;
    if (a.kind === 'fruit') return a.tree.pos;
    if (this.curious) return this.curious.pos;
    return null;
  }

  // ------------------------------------------------------------------ acting

  /** Runs the current action. Returns true while walking. */
  private run(game: Game, dt: number): boolean {
    const a = this.action;
    const T = this.target;
    switch (a.kind) {
      case 'idle':
        a.t -= dt;
        if (a.t <= 0) this.decide(game);
        return false;

      case 'wander':
      case 'goto': {
        a.t -= dt;
        const arrived = this.walkTo(game, a.target, dt, 2 * this.size);
        if (arrived || a.t <= 0) {
          if (a.kind === 'goto' && arrived) {
            this.action = { kind: 'cheer', t: 0 };
            game.audio.happyHum(this.pos);
          }
          else this.idle(rng.range(2, 5));
        }
        return !arrived;
      }

      case 'sleep':
        T.sit = 1;
        this.thought = 'Sleeping';
        a.t += dt;
        if (a.t > 1.6) {
          a.t = 0;
          game.floatText(this.pos.x + 2, this.pos.y + this.topHeight * 0.7, this.pos.z, 'z z z', '#cfe6ff');
          game.audio.snore(this.pos);
        }
        if (this.energy >= 0.99 && !(game.sky.isNight && this.hunger < 0.7)) this.idle(1);
        return false;

      case 'hurt':
        T.flinch = 1;
        a.t -= dt;
        if (a.t <= 0) this.idle(rng.range(1, 2));
        return false;

      case 'cheer':
        a.t += dt;
        T.cheer = Math.min(1, a.t / 1.3);
        this.thought = 'Delighted!';
        if (a.t > 1.3) this.idle(rng.range(1, 3));
        return false;

      case 'eat':
        return this.runEat(game, a, dt);

      case 'leash': {
        this.thought = 'Following your hand';
        if (this.leashT <= 0) return false;
        return !this.walkTo(game, this.leashPt, dt, 3 * this.size) && this.action === a;
      }
      case 'haul':
        return this.runHaul(game, a, dt);
      case 'plant':
        return this.runPlant(game, a, dt);
      case 'fire':
        return this.runFire(game, a, dt);
      case 'rescue':
        return this.runRescue(game, a, dt);
      case 'play':
        return this.runPlay(game, a, dt);
      case 'guard':
        return this.runGuard(game, a, dt);
      case 'fruit':
        return this.runFruit(game, a, dt);
      case 'fish':
        return this.runFish(game, a, dt);

      case 'throw':
        return this.runThrow(game, a, dt);
    }
  }

  private idle(t: number) {
    this.action = { kind: 'idle', t };
    this.thought = this.hunger > 0.7 ? 'Hungry' : this.energy < 0.3 ? 'Sleepy' : 'Watching the world';
  }

  private runEat(game: Game, a: Extract<Action, { kind: 'eat' }>, dt: number): boolean {
    const f = a.target;
    if ((a.phase === 'go' || a.phase === 'grab') && !this.stillEdible(f)) {
      this.idle(0.5);
      return false;
    }
    const T = this.target;
    switch (a.phase) {
      case 'go': {
        this.thought = `Going to eat ${describeFood(f)}`;
        const reach = f instanceof Field ? 4.5 * this.size : 3.4 * this.size;
        if (this.walkTo(game, f.pos, dt, reach)) {
          a.phase = 'grab';
          a.t = 0;
        }
        return a.phase === 'go';
      }
      case 'grab':
        a.t += dt;
        this.face(f.pos, dt);
        T.reach = 1;
        if (a.t > 0.55) {
          if (f instanceof Field) {
            this.consume(game, a);
            a.phase = 'chew';
          } else {
            this.holding = f;
            f.held = true;
            f.airborne = false;
            f.rolling = false;
            f.claimedBy = 0;
            a.phase = 'lift';
          }
          a.t = 0;
        }
        return false;
      case 'lift':
        a.t += dt;
        T.eat = 1;
        this.thought = `Eating ${describeFood(f)}!`;
        if (a.t > 0.9) {
          this.consume(game, a);
          a.phase = 'chew';
          a.t = 0;
        }
        return false;
      case 'chew':
        a.t += dt;
        T.chew = 1;
        T.eat = a.t < 0.4 ? 1 : 0;
        this.thought = 'Munching';
        if (Math.random() < dt * 8) game.fx.dust(this.pos.x, this.pos.y + this.topHeight * 0.75, this.pos.z, 2, 0.4 * this.size, 0x9a8a70);
        if (a.t > 1.5) this.idle(rng.range(1, 3));
        return false;
    }
  }

  private stillEdible(f: Food): boolean {
    if (!f.alive) return false;
    if (f.held && this.holding !== f) return false;
    if (f instanceof Field) return f.ripe && !f.burning;
    if (f instanceof Villager) return !f.dead && f.object.visible;
    if (f instanceof Pile) return f.amount > 0;
    return !f.airborne;
  }

  private consume(game: Game, a: Extract<Action, { kind: 'eat' }>) {
    const f = a.target;
    let nourish = 0.3;
    if (f instanceof Villager) {
      nourish = 0.5;
      this.alignment = clamp(this.alignment - 0.15, -1, 1);
      this.holding = null;
      f.held = false;
      game.audio.yelp(f.pos, 1.4);
      f.die(game, 'eaten', false);
      game.remove(f);
      this.opinions['eat:villager'] = clamp(this.opinions['eat:villager'] + VILLAGER_TASTE, -1, 1);
    } else if (f instanceof Field) {
      f.harvest();
      nourish = 0.45;
      this.alignment = clamp(this.alignment - 0.02, -1, 1);
      game.message(`Your golem ate ${f.village.name}'s crops.`, 'warn', 'golem-crops');
    } else if (f instanceof Pile) {
      nourish = Math.min(0.6, f.amount * 0.015);
      this.alignment = clamp(this.alignment + 0.01, -1, 1);
      if (this.handFed.has(f)) {
        this.bond = clamp(this.bond + 0.08, 0, 1);
        this.alignment = clamp(this.alignment + 0.01, -1, 1);
        game.floatText(this.pos.x, this.pos.y + this.topHeight + 3, this.pos.z, '♥', '#ffb3c8');
        game.fx.sparkle(this.pos.x, this.pos.y + this.topHeight * 0.8, this.pos.z, 10, 0xffb3c8, 2 * this.size);
      }
      this.holding = null;
      game.remove(f);
    } else {
      this.holding = null;
      game.remove(f);
    }
    this.hunger = Math.max(0, this.hunger - nourish);
    this.meals++;
    this.size = Math.min(MAX_SIZE, this.size + 0.025);
    this.applySize();
    this.lastDeed = { key: a.key, t: game.time, rt: game.realTime };
    game.floatText(this.pos.x, this.pos.y + this.topHeight + 1, this.pos.z, 'Nom!', '#ffe9a8');
    game.audio.crunch(this.pos);
    game.events.emit('creatureAte', { key: a.key });
  }

  private runThrow(game: Game, a: Extract<Action, { kind: 'throw' }>, dt: number): boolean {
    const r = a.rock;
    const T = this.target;
    if ((a.phase === 'go' || a.phase === 'grab') && (!r.alive || r.airborne || (r.held && this.holding !== r))) {
      this.idle(0.5);
      return false;
    }
    switch (a.phase) {
      case 'go':
        this.thought = 'Wants to play';
        if (this.walkTo(game, r.pos, dt, 3.4 * this.size)) {
          a.phase = 'grab';
          a.t = 0;
        }
        return a.phase === 'go';
      case 'grab':
        a.t += dt;
        this.face(r.pos, dt);
        T.reach = 1;
        if (a.t > 0.55) {
          this.holding = r;
          r.held = true;
          r.rolling = false;
          a.phase = 'windup';
          a.t = 0;
          // Turn to face a random direction to throw in.
          this.yaw += rng.range(-1.2, 1.2);
        }
        return false;
      case 'windup':
        a.t += dt;
        T.windup = 1;
        this.thought = 'Winding up...';
        if (a.t > 0.7) {
          a.phase = 'fling';
          a.t = 0;
        }
        return false;
      case 'fling':
        a.t += dt;
        T.fling = 1;
        if (a.t > 0.12 && this.holding === r) {
          const speed = (26 + rng.range(0, 14)) * Math.sqrt(this.size / START_SIZE);
          this.holding = null;
          r.held = false;
          r.airborne = true;
          r.vel.set(Math.sin(this.yaw) * speed, 14 + rng.range(0, 6), Math.cos(this.yaw) * speed);
          r.spin.set(rng.range(-3, 3), rng.range(-3, 3), rng.range(-3, 3));
          r.thrownByPlayer = false;
          r.thrownByCreature = true;
          r.impressPending = true;
          r.launchPoint.copy(r.pos);
          this.lastDeed = { key: 'throw:rock', t: game.time, rt: game.realTime };
          this.thought = 'Wheee!';
          game.audio.whoosh(r.pos, speed);
        }
        if (a.t > 0.5) {
          a.phase = 'recover';
          a.t = 0;
        }
        return false;
      case 'recover':
        a.t += dt;
        if (a.t > 0.6) this.idle(rng.range(1, 3));
        return false;
    }
  }


  // ------------------------------------------------------------- good deeds

  /** Deeds finished, by key (for tests and the legacy record; not saved). */
  readonly deedCount: Partial<Record<LearnKey, number>> = {};

  private finishDeed(game: Game, key: GoodKey) {
    this.doneAt.set(key, game.time);
    this.lastDeed = { key, t: game.time, rt: game.realTime };
    this.alignment = clamp(this.alignment + DEED_ALIGNMENT[key], -1, 1);
    this.happy = Math.max(this.happy, 0.7);
    this.deedCount[key] = (this.deedCount[key] ?? 0) + 1;
    game.floatText(this.pos.x, this.pos.y + this.topHeight + 2, this.pos.z, GOOD_INFO[key].icon, '#9fe8a8');
    game.fx.sparkle(this.pos.x, this.pos.y + this.topHeight * 0.85, this.pos.z, 16, 0x8ff2e0, 2.5 * this.size);
    game.audio.happyHum(this.pos);
  }

  /** The thing it was carrying is no use any more: put it down where it stands. */
  private abandon(a: Action) {
    if (this.action === a) this.idle(rng.range(0.5, 1.5));
  }

  private runHaul(game: Game, a: Extract<Action, { kind: 'haul' }>, dt: number): boolean {
    const T = this.target;
    const it = a.item;
    if (!a.site.alive || a.site.complete) {
      this.dropHeld();
      this.idle(1);
      return false;
    }
    if ((a.phase === 'go' || a.phase === 'grab') && (!it.alive || it.airborne || (it.held && this.holding !== it))) {
      this.idle(0.5);
      return false;
    }
    switch (a.phase) {
      case 'go':
        this.thought = a.res === 'stone' ? 'Fetching stone for the build' : 'Fetching wood for the build';
        if (this.walkTo(game, it.pos, dt, 3.4 * this.size)) {
          a.phase = 'grab';
          a.t = 0;
        }
        return a.phase === 'go' && this.action === a;
      case 'grab':
        a.t += dt;
        this.face(it.pos, dt);
        T.reach = 1;
        if (a.t > 0.55) {
          this.holding = it;
          it.held = true;
          it.airborne = false;
          it.rolling = false;
          it.claimedBy = 0;
          a.phase = 'carry';
          a.t = 0;
        }
        return false;
      case 'carry': {
        this.thought = 'Carrying it to the build';
        if (this.holding !== it) return this.abandon(a), false;
        const stop = a.site.def.radius + 3.5 * this.size;
        if (this.walkTo(game, a.site.pos, dt, stop)) {
          a.phase = 'drop';
          a.t = 0;
        }
        return a.phase === 'carry' && this.action === a;
      }
      case 'drop':
        a.t += dt;
        this.face(a.site.pos, dt);
        if (a.t < 0.5) T.windup = 1;
        else T.fling = 1;
        if (a.t > 0.6) {
          if (this.holding === it) {
            this.holding = null;
            it.held = false;
            const amount = it instanceof Rock ? Math.max(4, Math.round(it.radius * it.radius * STONE_PER_ROCK_AREA)) : Math.round((it as Pile).amount);
            const taken = a.site.add(game, a.res, amount, 'gift');
            if (taken > 0) {
              game.fx.dust(a.site.pos.x, a.site.pos.y + 1, a.site.pos.z, 14, 0.9, a.res === 'stone' ? 0xb8b1a4 : 0xc9a070);
              game.floatText(a.site.pos.x, a.site.pos.y + 6, a.site.pos.z, `+${Math.round(taken)} ${a.res}`, '#e4dccb');
              game.audio.chime(a.site.pos);
              game.remove(it);
            } else {
              it.airborne = true;
              it.vel.set(0, -1, 0);
            }
          }
          this.finishDeed(game, 'deed:haul');
          this.idle(rng.range(1, 2.5));
        }
        return false;
    }
  }

  private runPlant(game: Game, a: Extract<Action, { kind: 'plant' }>, dt: number): boolean {
    const T = this.target;
    if (a.tree && (!a.tree.alive || a.tree.charred || a.tree.held)) {
      this.idle(0.5);
      return false;
    }
    if (a.phase === 'go') {
      this.thought = a.tree ? 'Going to water a sapling' : 'Going to plant a sapling';
      if (this.walkTo(game, a.tree ? a.tree.pos : a.target, dt, a.tree ? a.tree.radius + 3 * this.size : 2.5 * this.size)) {
        a.phase = 'work';
        a.t = 0;
      }
      return a.phase === 'go' && this.action === a;
    }
    a.t += dt;
    this.face(a.tree ? a.tree.pos : a.target, dt);
    T.reach = 1;
    T.sit = 0.35;
    this.thought = a.tree ? 'Watering' : 'Planting';
    if (Math.random() < dt * 6) game.fx.dust(a.target.x, a.target.y + 0.5, a.target.z, 2, 0.5, a.tree ? 0x9fd8ff : 0x7a5a3a);
    if (a.t > 1.7) {
      let ok = false;
      if (a.tree) {
        a.tree.water(0.35);
        game.fx.sparkle(a.tree.pos.x, a.tree.pos.y + 2, a.tree.pos.z, 18, 0x9fe8ff, 2.5);
        ok = true;
      } else if (game.canPlantTree(a.target.x, a.target.z)) {
        const t = new Tree(Math.floor(Math.random() * 1e6), a.target.x, a.target.z, 0.1);
        t.pos.y = game.terrain.heightAt(a.target.x, a.target.z);
        game.add(t);
        game.fx.sparkle(t.pos.x, t.pos.y + 1, t.pos.z, 20, 0xb8f08a, 2.5);
        ok = true;
      }
      if (ok) this.finishDeed(game, 'deed:plant');
      this.idle(rng.range(1, 2.5));
    }
    return false;
  }

  private runFire(game: Game, a: Extract<Action, { kind: 'fire' }>, dt: number): boolean {
    const T = this.target;
    const f = a.target;
    if (!f.alive || !f.burning) {
      if (a.phase === 'stomp') this.finishDeed(game, 'deed:fire');
      this.idle(rng.range(1, 2));
      return false;
    }
    this.thought = 'Putting out the fire';
    if (a.phase === 'go') {
      if (this.walkTo(game, f.pos, dt, f.radius + 3.5 * this.size)) {
        a.phase = 'stomp';
        a.t = 0;
      }
      return a.phase === 'go' && this.action === a;
    }
    a.t += dt;
    this.face(f.pos, dt);
    const beat = a.t % 0.7;
    if (beat < 0.4) T.windup = 1;
    else T.fling = 1;
    if (beat < dt) {
      game.shake(0.12);
      game.fx.dust(f.pos.x, f.pos.y + 0.5, f.pos.z, 8, 0.8, 0x9a8a70);
    }
    if (a.t > 2.1) {
      f.extinguish(game);
      game.events.emit('fireOut', { entity: f });
    }
    return false;
  }

  private runRescue(game: Game, a: Extract<Action, { kind: 'rescue' }>, dt: number): boolean {
    const T = this.target;
    const v = a.who;
    if (v.dead || !v.alive || (a.phase !== 'carry' && (v.held || v.airborne || !v.lost))) {
      this.dropHeld();
      this.idle(1);
      return false;
    }
    switch (a.phase) {
      case 'go':
        this.thought = 'Going to a lost villager';
        if (this.walkTo(game, v.pos, dt, 3.4 * this.size)) {
          a.phase = 'grab';
          a.t = 0;
        }
        return a.phase === 'go' && this.action === a;
      case 'grab':
        a.t += dt;
        this.face(v.pos, dt);
        T.reach = 1;
        if (a.t > 0.6) {
          this.holding = v;
          v.held = true;
          v.airborne = false;
          v.claimedBy = 0;
          v.onPickup(game);
          a.phase = 'carry';
          a.t = 0;
        }
        return false;
      case 'carry': {
        this.thought = 'Carrying a lost villager home';
        if (this.holding !== v) return this.abandon(a), false;
        const home = v.village;
        if (this.walkTo(game, home.center, dt, Math.max(7, home.radius * 0.45))) {
          this.holding = null;
          v.held = false;
          const x = this.pos.x + Math.sin(this.yaw) * 3.5 * this.size;
          const z = this.pos.z + Math.cos(this.yaw) * 3.5 * this.size;
          v.pos.set(x, game.terrain.heightAt(x, z) + 0.8, z);
          v.vel.set(0, -2, 0);
          v.airborne = true;
          v.onDrop(game);
          game.events.emit('place', { entity: v, x, z });
          if (v.lost) v.lost = false;
          this.finishDeed(game, 'deed:rescue');
          this.idle(rng.range(1, 2.5));
        }
        return this.action === a;
      }
    }
  }

  private runPlay(game: Game, a: Extract<Action, { kind: 'play' }>, dt: number): boolean {
    const T = this.target;
    const v = a.who;
    if (v.dead || !v.alive || v.held || v.airborne) {
      this.idle(1);
      return false;
    }
    if (a.phase === 'go') {
      this.thought = 'Going to play';
      if (this.walkTo(game, v.pos, dt, 6.5 * this.size)) {
        a.phase = 'play';
        a.t = 0;
      }
      return a.phase === 'go' && this.action === a;
    }
    a.t += dt;
    this.face(v.pos, dt);
    this.thought = 'Playing gently';
    T.cheer = 0.35 + 0.35 * Math.sin(a.t * 4);
    T.happy = 1;
    if (Math.floor(a.t * 1.4) !== Math.floor((a.t - dt) * 1.4)) {
      game.floatText(v.pos.x, v.pos.y + 4, v.pos.z, '♥', '#ffb3c8');
      game.fx.sparkle(v.pos.x, v.pos.y + 2, v.pos.z, 8, 0xffe28a, 2);
    }
    if (a.t > 3.4) {
      const child = ageDays(v.bornAt, game.time) < CHILD_DAYS;
      const village = v.village;
      village.belief = Math.min(100, village.belief + (child ? 3 : 1.5));
      game.floatText(village.center.x, this.pos.y + 8, village.center.z, '+faith', '#f4cf73');
      this.finishDeed(game, 'deed:play');
      this.idle(rng.range(1, 2.5));
    }
    return false;
  }

  private runGuard(game: Game, a: Extract<Action, { kind: 'guard' }>, dt: number): boolean {
    const T = this.target;
    a.t += dt;
    const scheme = this.darkHand(game);
    if (!scheme || a.who !== scheme.target || a.t > 60) {
      if (a.t > 4) this.finishDeed(game, 'deed:guard');
      this.idle(rng.range(1, 2));
      return false;
    }
    this.thought = 'Standing guard';
    const d = Math.hypot(a.who.pos.x - this.pos.x, a.who.pos.z - this.pos.z);
    if (d > 4.5 * this.size) return !this.walkTo(game, a.who.pos, dt, 4 * this.size) && this.action === a;
    this.face(a.who.pos, dt);
    T.windup = 0.7;
    T.interest = 1;
    return false;
  }

  private runFruit(game: Game, a: Extract<Action, { kind: 'fruit' }>, dt: number): boolean {
    const T = this.target;
    const tr = a.tree;
    if (!tr.alive || tr.charred || tr.held) {
      this.idle(0.5);
      return false;
    }
    switch (a.phase) {
      case 'go':
        this.thought = 'Going to a fruit tree';
        if (this.walkTo(game, tr.pos, dt, tr.radius + 2.5 * this.size)) {
          a.phase = 'shake';
          a.t = 0;
        }
        return a.phase === 'go' && this.action === a;
      case 'shake':
        a.t += dt;
        this.face(tr.pos, dt);
        T.reach = 1;
        this.thought = 'Shaking down fruit';
        if (Math.random() < dt * 10) game.fx.sparkle(tr.pos.x + rng.range(-1.5, 1.5), tr.pos.y + 3 + rng.range(0, 3), tr.pos.z + rng.range(-1.5, 1.5), 3, 0xffd36b, 1.2);
        if (a.t > 1.3) {
          a.phase = 'eat';
          a.t = 0;
        }
        return false;
      case 'eat':
        a.t += dt;
        T.eat = 1;
        T.chew = a.t > 0.5 ? 1 : 0;
        this.thought = 'Munching fruit';
        if (a.t > 1.4) {
          this.hunger = Math.max(0, this.hunger - 0.32);
          this.meals++;
          this.fruitReady.set(tr, game.time + FRUIT_REGROW);
          this.size = Math.min(MAX_SIZE, this.size + 0.01);
          this.applySize();
          game.audio.crunch(this.pos);
          game.events.emit('creatureAte', { key: 'eat:fruit' });
          this.finishDeed(game, 'eat:fruit');
          this.idle(rng.range(1, 3));
        }
        return false;
    }
  }

  private runFish(game: Game, a: Extract<Action, { kind: 'fish' }>, dt: number): boolean {
    const T = this.target;
    if (a.phase === 'go') {
      this.thought = 'Going fishing';
      if (this.walkTo(game, a.spot, dt, 2.5)) {
        a.phase = 'wait';
        a.t = 0;
      }
      return a.phase === 'go' && this.action === a;
    }
    this.yaw = angleLerp(this.yaw, a.face, damp(3, dt));
    const wx = this.pos.x + Math.sin(a.face) * 6;
    const wz = this.pos.z + Math.cos(a.face) * 6;
    a.t += dt;
    if (a.phase === 'wait') {
      this.thought = 'Fishing';
      T.reach = 1;
      T.sit = 0.3;
      if (Math.random() < dt * 1.2) game.fx.splash(wx, wz, 3, 0.4);
      if (a.t > 4) {
        a.phase = 'catch';
        a.t = 0;
        game.fx.splash(wx, wz, 14, 1);
      }
      return false;
    }
    T.eat = 1;
    T.chew = a.t > 0.5 ? 1 : 0;
    this.thought = 'Munching a fish';
    if (a.t > 1.4) {
      this.hunger = Math.max(0, this.hunger - 0.38);
      this.meals++;
      game.audio.crunch(this.pos);
      game.events.emit('creatureAte', { key: 'eat:fish' });
      this.finishDeed(game, 'eat:fish');
      this.idle(rng.range(1, 3));
    }
    return false;
  }

  /** Dark hand reaching for a villager: it moves to stand between (see GraspingHand: a guarded villager is spared). */
  private darkHand(game: Game): { kind: string; target: Villager } | null {
    const s = (game as unknown as { rival?: { scheme: { kind: string; target?: Villager } | null } }).rival?.scheme;
    return s && s.kind === 'hand' && s.target && s.target.alive && !s.target.dead ? (s as { kind: string; target: Villager }) : null;
  }

  private watchForDarkHand(game: Game, dt: number) {
    this.guardCheck -= dt;
    if (this.guardCheck > 0) return;
    this.guardCheck = 0.6;
    const k = this.action.kind;
    if (k !== 'idle' && k !== 'wander' && k !== 'goto' && k !== 'cheer') return;
    const s = this.darkHand(game);
    if (!s || this.opinions['deed:guard'] < 0.1) return;
    this.dropHeld();
    this.action = { kind: 'guard', who: s.target, t: 0 };
  }

  /** Good-deed targets, nearest first. */
  private findHaul(game: Game): { item: Rock | Pile; site: Site; res: Res; d: number } | null {
    let best: { item: Rock | Pile; site: Site; res: Res; d: number } | null = null;
    const free = (e: Entity) => !e.held && !e.airborne && !e.rolling && !((this.skip.get(e) ?? 0) > game.time);
    for (const e of game.entities) {
      if (e.kind !== 'site' || !e.alive) continue;
      const site = e as Site;
      if (site.complete) continue;
      // Only your own villages' dreams: a neighbour rises with your hand, and is won by it (2026-10-14, progression).
      if (site.village.owner !== 'player') continue;
      for (const res of ['stone', 'wood'] as Res[]) {
        if (site.open(res) < 3) continue;
        const item = res === 'stone' ? game.nearest<Rock>('rock', this.pos.x, this.pos.z, 130, free) : game.nearest<Pile>('wood', this.pos.x, this.pos.z, 130, free);
        if (!item) continue;
        const d = Math.hypot(item.pos.x - this.pos.x, item.pos.z - this.pos.z) + Math.hypot(item.pos.x - site.pos.x, item.pos.z - site.pos.z);
        if (!best || d < best.d) best = { item, site, res, d };
      }
    }
    return best;
  }

  private findPlant(game: Game): { tree: Tree | null; target: THREE.Vector3; d: number } | null {
    let young: Tree | null = null;
    let yd = 110;
    let mature: Tree | null = null;
    let md = 110;
    let trees = 0;
    for (const e of game.entities) {
      if (!(e instanceof Tree) || !e.alive || e.charred || e.held) continue;
      trees++;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (e.growth < 0.6) {
        if (d < yd && !((this.skip.get(e) ?? 0) > game.time)) {
          yd = d;
          young = e;
        }
      } else if (d < md && Math.random() < 0.3) {
        md = d;
        mature = e;
      }
    }
    const canPlant = trees < MAX_TREES;
    if (young && (!canPlant || Math.random() < 0.5)) return { tree: young, target: young.pos.clone(), d: yd };
    if (canPlant && mature) {
      for (let i = 0; i < 14; i++) {
        const ang = rng.range(0, Math.PI * 2);
        const r = rng.range(6, 15);
        const x = mature.pos.x + Math.cos(ang) * r;
        const z = mature.pos.z + Math.sin(ang) * r;
        if (!game.canPlantTree(x, z)) continue;
        return { tree: null, target: new THREE.Vector3(x, game.terrain.heightAt(x, z), z), d: md };
      }
    }
    return young ? { tree: young, target: young.pos.clone(), d: yd } : null;
  }

  private findFire(game: Game): Entity | null {
    let best: Entity | null = null;
    let bd = 150;
    for (const e of game.entities) {
      if (!e.alive || !e.burning || e === this || e.kind === 'villager' || e.held) continue;
      if ((this.skip.get(e) ?? 0) > game.time) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  private findLost(game: Game): Villager | null {
    let best: Villager | null = null;
    let bd = 200;
    for (const vg of game.villages) {
      for (const v of vg.villagers) {
        if (!v.lost || v.dead || !v.alive || v.held || v.airborne || (this.skip.get(v) ?? 0) > game.time) continue;
        const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z);
        if (d < bd) {
          bd = d;
          best = v;
        }
      }
    }
    return best;
  }

  /** A child (or, failing that, anyone) to play with, and whether they are a child. */
  private findPlaymate(game: Game): { who: Villager; d: number; child: boolean } | null {
    let best: { who: Villager; d: number; child: boolean } | null = null;
    for (const vg of game.villages) {
      for (const v of vg.villagers) {
        if (v.dead || !v.alive || v.held || v.airborne || v.lost || v.isInside || v.burning || !v.object.visible) continue;
        if ((this.skip.get(v) ?? 0) > game.time) continue;
        const child = ageDays(v.bornAt, game.time) < CHILD_DAYS;
        const d = Math.hypot(v.pos.x - this.pos.x, v.pos.z - this.pos.z) * (child ? 1 : 2.2);
        if (d < 150 && (!best || d < best.d)) best = { who: v, d, child };
      }
    }
    return best;
  }

  private findFruit(game: Game): Tree | null {
    let best: Tree | null = null;
    let bd = 130;
    for (const e of game.entities) {
      if (!(e instanceof Tree) || !e.alive || !e.mature || e.held || e.seed % FRUIT_EVERY !== 0) continue;
      if ((this.fruitReady.get(e) ?? 0) > game.time || (this.skip.get(e) ?? 0) > game.time) continue;
      const d = Math.hypot(e.pos.x - this.pos.x, e.pos.z - this.pos.z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  }

  /** A spot on the shore with deep-enough water to cast into, and the way to face. */
  private findShore(game: Game): { spot: THREE.Vector3; face: number; d: number } | null {
    let best: { spot: THREE.Vector3; face: number; d: number } | null = null;
    const t = game.terrain;
    for (let i = 0; i < 90; i++) {
      const ang = rng.range(0, Math.PI * 2);
      const r = rng.range(10, 110);
      const x = this.pos.x + Math.cos(ang) * r;
      const z = this.pos.z + Math.sin(ang) * r;
      const h = t.heightAt(x, z);
      if (h < SEA_LEVEL + 0.3 || h > SEA_LEVEL + 2.4 || !t.isLand(x, z, 1.2)) continue;
      if (game.villageAt(x, z)) continue;
      for (let k = 0; k < 8; k++) {
        const f = (k / 8) * Math.PI * 2;
        if (t.heightAt(x + Math.sin(f) * 6, z + Math.cos(f) * 6) < SEA_LEVEL - 0.4) {
          if (!best || r < best.d) best = { spot: new THREE.Vector3(x, h, z), face: f, d: r };
          break;
        }
      }
      if (best && best.d < 40) break;
    }
    return best;
  }

  /** Favoured if your hand led it near here a moment ago. */
  private guideBoost(game: Game, x: number, z: number): number {
    const g = this.guided;
    if (!g || game.time - g.t > GUIDE_WINDOW) return 1;
    return Math.hypot(x - g.x, z - g.z) < GUIDE_RADIUS ? 3 : 1;
  }

  private desire(key: GoodKey, avail: number, dist: number, game: Game, x: number, z: number): number {
    const op = Math.max(0, this.opinions[key]);
    const fresh = game.time - (this.doneAt.get(key) ?? -999) < 45 ? 0.35 : 1;
    return fresh * avail * (DEED_BASE + op * DEED_GAIN) * (1 + this.bond * 0.5) * (1 / (1 + dist / 90)) * this.guideBoost(game, x, z);
  }

  private pushDeedOptions(game: Game, options: { score: number; start: () => void }[]) {
    const haul = this.hunger < 0.85 ? this.findHaul(game) : null;
    if (haul) {
      options.push({
        score: this.desire('deed:haul', 0.6, haul.d, game, haul.site.pos.x, haul.site.pos.z),
        start: () => (this.action = { kind: 'haul', item: haul.item, site: haul.site, res: haul.res, phase: 'go', t: 0 }),
      });
    }
    const fire = this.findFire(game);
    if (fire) {
      options.push({
        score: this.desire('deed:fire', 1.4, 0, game, fire.pos.x, fire.pos.z),
        start: () => (this.action = { kind: 'fire', target: fire, phase: 'go', t: 0 }),
      });
    }
    const lost = this.findLost(game);
    if (lost) {
      options.push({
        score: this.desire('deed:rescue', 1.3, 0, game, lost.pos.x, lost.pos.z),
        start: () => (this.action = { kind: 'rescue', who: lost, phase: 'go', t: 0 }),
      });
    }
    if (this.hunger < 0.85) {
      const plant = this.findPlant(game);
      if (plant) {
        options.push({
          score: this.desire('deed:plant', 0.5, plant.d, game, plant.target.x, plant.target.z),
          start: () => (this.action = { kind: 'plant', tree: plant.tree, target: plant.target, phase: 'go', t: 0 }),
        });
      }
      const mate = this.findPlaymate(game);
      if (mate) {
        options.push({
          score: this.desire('deed:play', 0.5, mate.d, game, mate.who.pos.x, mate.who.pos.z),
          start: () => (this.action = { kind: 'play', who: mate.who, phase: 'go', t: 0 }),
        });
      }
    }
  }

  private pushHarmlessFood(game: Game, options: { score: number; start: () => void }[], hungerDrive: number) {
    const fruit = this.findFruit(game);
    if (fruit) {
      const d = Math.hypot(fruit.pos.x - this.pos.x, fruit.pos.z - this.pos.z);
      options.push({
        score: hungerDrive * 1.4 * Math.max(0, 0.55 + this.opinions['eat:fruit']) * (1 / (1 + d / 70)),
        start: () => (this.action = { kind: 'fruit', tree: fruit, phase: 'go', t: 0 }),
      });
    }
    const shore = this.findShore(game);
    if (shore) {
      options.push({
        score: hungerDrive * 1.2 * Math.max(0, 0.55 + this.opinions['eat:fish']) * (1 / (1 + shore.d / 70)),
        start: () => (this.action = { kind: 'fish', spot: shore.spot, face: shore.face, phase: 'go', t: 0 }),
      });
    }
  }

  private dropHeld() {
    const h = this.holding;
    if (!h) return;
    this.holding = null;
    h.held = false;
    h.airborne = true;
    h.vel.set(0, -1, 0);
  }

  // ---------------------------------------------------------------- deciding

  /** Pick the next thing to do, weighted by needs and by what it has learned. */
  private decide(game: Game) {
    if (this.energy < 0.18 || (game.sky.isNight && this.energy < 0.55)) {
      this.action = { kind: 'sleep', t: 0 };
      return;
    }
    const options: { score: number; start: () => void }[] = [];
    const hungerDrive = smoothstep(0.3, 0.9, this.hunger);
    if (hungerDrive > 0) {
      for (const key of ['eat:food', 'eat:crops', 'eat:villager', 'eat:rock'] as LearnKey[]) {
        const food = this.findFood(game, key);
        if (!food) continue;
        const d = Math.hypot(food.pos.x - this.pos.x, food.pos.z - this.pos.z);
        const liking = Math.max(0, 0.55 + this.opinions[key]);
        options.push({
          score: hungerDrive * liking * (1 / (1 + d / 70)),
          start: () => {
            this.action = { kind: 'eat', key, target: food, phase: 'go', t: 0 };
          },
        });
      }
    }
    if (this.hunger < 0.75) {
      const rock = this.findFood(game, 'throw:rock');
      if (rock instanceof Rock) {
        options.push({
          score: 0.3 * Math.max(0, 0.55 + this.opinions['throw:rock']),
          start: () => {
            this.action = { kind: 'throw', rock, phase: 'go', t: 0 };
          },
        });
      }
    }
    if (hungerDrive > 0) this.pushHarmlessFood(game, options, hungerDrive);
    this.pushDeedOptions(game, options);
    options.push({ score: 0.22, start: () => this.startWander(game) });

    // Weighted random, sharpened so strong preferences dominate.
    const total = options.reduce((s, o) => s + o.score * o.score, 0);
    let r = Math.random() * total;
    for (const o of options) {
      r -= o.score * o.score;
      if (r <= 0) return o.start();
    }
    options[options.length - 1].start();
  }

  private findFood(game: Game, key: LearnKey): Food | null {
    const x = this.pos.x;
    const z = this.pos.z;
    const free = (e: Entity) => !e.held && !e.airborne && !((this.skip.get(e) ?? 0) > game.time);
    switch (key) {
      case 'eat:food':
        return game.nearest<Pile>('food', x, z, 150, free);
      case 'eat:crops':
        return game.nearest<Field>('field', x, z, 150, (e) => free(e) && (e as Field).ripe && !e.burning);
      case 'eat:villager':
        return game.nearest<Villager>('villager', x, z, 90, (e) => free(e) && !(e as Villager).dead && e.object.visible);
      case 'eat:rock':
      case 'throw:rock':
        return game.nearest<Rock>('rock', x, z, 90, (e) => free(e) && !e.rolling);
      default:
        return null;
    }
  }

  private startWander(game: Game) {
    const v = this.home;
    for (let i = 0; i < 20; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(v.radius * 0.6, v.radius * 2);
      const x = v.center.x + Math.cos(a) * d;
      const z = v.center.z + Math.sin(a) * d;
      if (!game.terrain.isLand(x, z, 1.2)) continue;
      if (game.terrain.normalAt(x, z, tmp).y < 0.86) continue;
      if (v.houses.some((h) => Math.hypot(h.pos.x - x, h.pos.z - z) < 4 + this.radius)) continue;
      if (v.fields.some((f) => Math.hypot(f.pos.x - x, f.pos.z - z) < 7 + this.radius)) continue;
      this.action = { kind: 'wander', target: new THREE.Vector3(x, 0, z), t: 40 };
      this.thought = 'Wandering';
      return;
    }
    this.idle(3);
  }

  // ---------------------------------------------------------------- movement

  private face(p: THREE.Vector3, dt: number) {
    this.yaw = angleLerp(this.yaw, Math.atan2(p.x - this.pos.x, p.z - this.pos.z), damp(4, dt));
  }

  /** Lumber toward a point, steering around buildings; true on arrival within `stop`. */
  private walkTo(game: Game, target: THREE.Vector3, dt: number, stop: number): boolean {
    if (this.walkOwner !== this.action) {
      this.walkOwner = this.action;
      this.walkStuck = 0;
      this.walkClock = 0;
      this.walkX = this.pos.x;
      this.walkZ = this.pos.z;
      this.detourSide = 0;
    }
    const blockers = this.blockers(game);
    // A target inside a footprint (food on a store, a villager by a door) means its nearest edge.
    let tx = target.x;
    let tz = target.z;
    for (const b of blockers) {
      const ox = tx - b.x;
      const oz = tz - b.z;
      const od = Math.hypot(ox, oz);
      if (od < b.r + 0.3) {
        const k = (b.r + 0.3) / Math.max(od, 0.001);
        tx = od < 0.001 ? b.x + b.r + 0.3 : b.x + ox * k;
        tz = od < 0.001 ? b.z : b.z + oz * k;
      }
    }
    const dx = tx - this.pos.x;
    const dz = tz - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (Math.hypot(target.x - this.pos.x, target.z - this.pos.z) < stop || d < 2.5) return true;
    let want = Math.atan2(dx, dz);

    // Stuck check every 2 s: barely moved means we're jammed on a wall. First try the other way
    // round, then give up on this action.
    this.walkClock += dt;
    if (this.walkClock >= 2) {
      const moved = Math.hypot(this.pos.x - this.walkX, this.pos.z - this.walkZ);
      this.walkClock = 0;
      this.walkX = this.pos.x;
      this.walkZ = this.pos.z;
      if (moved < 2) {
        if (++this.walkStuck >= 2) return this.giveUp(game);
        this.detourSide = this.detourSide === 0 ? 1 : -this.detourSide;
      } else this.walkStuck = 0;
    }

    // Steer along the tangent of the nearest building in the way, on the side nearer the target.
    let nearest: { x: number; z: number; r: number } | null = null;
    let nd = Infinity;
    for (const b of blockers) {
      const R = b.r + 1.5;
      // Don't steer around the building we're heading for.
      if (Math.hypot(tx - b.x, tz - b.z) < R + 1) continue;
      const bd = Math.hypot(b.x - this.pos.x, b.z - this.pos.z);
      if (bd > R + 8 || bd >= nd || d < bd - R) continue;
      const toB = Math.atan2(b.x - this.pos.x, b.z - this.pos.z);
      if (Math.abs(normalizeAngle(toB - want)) < Math.asin(Math.min(1, R / Math.max(bd, 0.001)))) {
        nearest = b;
        nd = bd;
      }
    }
    if (nearest) {
      const R = nearest.r + 1.5;
      const toB = Math.atan2(nearest.x - this.pos.x, nearest.z - this.pos.z);
      const off = Math.asin(Math.min(1, R / Math.max(nd, 0.001))) + 0.15;
      if (this.detourSide === 0) {
        this.detourSide = Math.abs(normalizeAngle(toB + off - want)) <= Math.abs(normalizeAngle(toB - off - want)) ? 1 : -1;
      }
      want = toB + this.detourSide * off;
    } else this.detourSide = 0;

    this.yaw = angleLerp(this.yaw, want, damp(2.2, dt));
    const facing = Math.cos(want - this.yaw);
    const step = WALK_SPEED * this.size * Math.max(0, facing) * Math.max(0.15, this.moving) * dt;
    this.pos.x += Math.sin(this.yaw) * step;
    this.pos.z += Math.cos(this.yaw) * step;
    this.avoidBuildings(game);
    return false;
  }

  /** Stuck for good: drop the action and don't pick that target again for a while. */
  private giveUp(game: Game): boolean {
    const a = this.action;
    if (a.kind === 'eat') this.skip.set(a.target, game.time + 30);
    else if (a.kind === 'throw') this.skip.set(a.rock, game.time + 30);
    else if (a.kind === 'haul') this.skip.set(a.item, game.time + 30);
    else if (a.kind === 'fire') this.skip.set(a.target, game.time + 30);
    else if (a.kind === 'rescue' || a.kind === 'play') this.skip.set(a.who, game.time + 30);
    else if (a.kind === 'fruit') this.skip.set(a.tree, game.time + 30);
    if (a.kind === 'haul' || a.kind === 'rescue') this.dropHeld();
    this.idle(1);
    return false;
  }

  /** Buildings the golem has to walk around, with their keep-out radius. */
  private blockers(game: Game): { x: number; z: number; r: number }[] {
    const out: { x: number; z: number; r: number }[] = [];
    game.forEachNear(this.pos.x, this.pos.z, this.radius + 40, (e) => {
      if (e.kind !== 'house' && e.kind !== 'store' && e.kind !== 'worship') return;
      out.push({ x: e.pos.x, z: e.pos.z, r: this.blockRadius(e) });
    });
    return out;
  }

  private blockRadius(e: Entity): number {
    // The worship site is walkable; only keep clear of its solid middle (the totem pole, later the pyramid).
    return e.kind === 'worship' ? (e as WorshipSite).solidRadius + 0.3 + this.radius * 0.5 : e.radius + this.radius * 0.75;
  }

  private avoidBuildings(game: Game) {
    game.forEachNear(this.pos.x, this.pos.z, this.radius + 8, (e) => {
      if (e.kind !== 'house' && e.kind !== 'store' && e.kind !== 'worship') return;
      const r = this.blockRadius(e);
      const ox = this.pos.x - e.pos.x;
      const oz = this.pos.z - e.pos.z;
      const d = Math.hypot(ox, oz);
      if (d < r && d > 0.001) {
        this.pos.x = e.pos.x + (ox / d) * r;
        this.pos.z = e.pos.z + (oz / d) * r;
      }
    });
  }
}

function describeFood(f: Food): string {
  if (f instanceof Villager) return 'a villager';
  if (f instanceof Field) return 'some crops';
  if (f instanceof Pile) return 'some food';
  return 'a rock';
}

function normalizeAngle(a: number): number {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
