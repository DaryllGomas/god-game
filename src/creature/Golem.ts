import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { Entity } from '../entities/Entity';
import { Pile, Rock } from '../entities/Nature';
import { Field } from '../entities/Buildings';
import { Villager } from '../entities/Villager';
import { GolemModel, REST_POSE, type GolemPose } from './GolemModel';
import { angleLerp, clamp, damp, smoothstep } from '../util/math';
import { rng } from '../util/rng';

/** Things the golem can learn to like or dislike. */
export type LearnKey = 'eat:food' | 'eat:crops' | 'eat:villager' | 'eat:rock' | 'throw:rock';

export const LEARN_LABELS: Record<LearnKey, string> = {
  'eat:food': 'Eating food piles',
  'eat:crops': "Eating villagers' crops",
  'eat:villager': 'Eating villagers',
  'eat:rock': 'Eating rocks',
  'throw:rock': 'Throwing rocks',
};

export const LEARN_KEYS = Object.keys(LEARN_LABELS) as LearnKey[];

// Tuning
const START_SIZE = 1.5;
const MAX_SIZE = 2.6;
const HUNGER_RATE = 1 / 220; // per second awake
const SLEEP_HUNGER_RATE = 1 / 600;
const TIRE_RATE = 1 / 330;
const REST_RATE = 1 / 35;
/** A stroke or slap within this many seconds still counts toward the last thing it did. */
const MEMORY_WINDOW = 10;
const WALK_SPEED = 2.6;
const LOOK_RANGE = 45;

type Food = Pile | Field | Villager | Rock;
type Action =
  | { kind: 'idle'; t: number }
  | { kind: 'wander'; target: THREE.Vector3; t: number }
  | { kind: 'goto'; target: THREE.Vector3; t: number }
  | { kind: 'eat'; key: LearnKey; target: Food; phase: 'go' | 'grab' | 'lift' | 'chew'; t: number }
  | { kind: 'throw'; rock: Rock; phase: 'go' | 'grab' | 'windup' | 'fling' | 'recover'; t: number }
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
  };
  thought = 'Waking up';
  action: Action = { kind: 'idle', t: 2 };

  private lastDeed: { key: LearnKey; t: number } | null = null;
  private holding: Entity | null = null;
  private shownAlignment = 0;
  private yaw = rng.range(0, Math.PI * 2);
  private moving = 0;
  private happy = 0;
  private readonly pose: GolemPose = { ...REST_POSE };
  private readonly target: GolemPose = { ...REST_POSE };
  private readonly eye = new THREE.Vector3();
  private lastStep = 0;

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
    };
  }

  loadState(s: ReturnType<Golem['saveState']>) {
    this.yaw = s.yaw;
    this.hunger = s.hunger;
    this.energy = s.energy;
    this.alignment = s.alignment;
    this.shownAlignment = s.alignment;
    this.size = s.size;
    this.meals = s.meals;
    for (const k of LEARN_KEYS) if (typeof s.opinions?.[k] === 'number') this.opinions[k] = s.opinions[k];
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
    if (this.lastDeed && game.time - this.lastDeed.t < MEMORY_WINDOW) return this.lastDeed.key;
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
    this.opinions[key] = clamp(before + delta * (1 - Math.abs(before) * 0.35), -1, 1);
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
    } else if (f instanceof Field) {
      f.harvest();
      nourish = 0.45;
      this.alignment = clamp(this.alignment - 0.02, -1, 1);
      game.message(`Your golem ate ${f.village.name}'s crops.`, 'warn', 'golem-crops');
    } else if (f instanceof Pile) {
      nourish = Math.min(0.6, f.amount * 0.015);
      this.alignment = clamp(this.alignment + 0.01, -1, 1);
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
    this.lastDeed = { key: a.key, t: game.time };
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
          this.lastDeed = { key: 'throw:rock', t: game.time };
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
    const free = (e: Entity) => !e.held && !e.airborne;
    switch (key) {
      case 'eat:food':
        return game.nearest<Pile>('food', x, z, 150, free);
      case 'eat:crops':
        return game.nearest<Field>('field', x, z, 150, (e) => (e as Field).ripe && !e.burning);
      case 'eat:villager':
        return game.nearest<Villager>('villager', x, z, 90, (e) => free(e) && !(e as Villager).dead && e.object.visible);
      case 'eat:rock':
      case 'throw:rock':
        return game.nearest<Rock>('rock', x, z, 90, (e) => free(e) && !e.rolling);
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

  /** Lumber toward a point; true on arrival within `stop`. */
  private walkTo(game: Game, target: THREE.Vector3, dt: number, stop: number): boolean {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < stop) return true;
    const want = Math.atan2(dx, dz);
    this.yaw = angleLerp(this.yaw, want, damp(2.2, dt));
    const facing = Math.cos(want - this.yaw);
    const step = WALK_SPEED * this.size * Math.max(0, facing) * Math.max(0.15, this.moving) * dt;
    this.pos.x += Math.sin(this.yaw) * step;
    this.pos.z += Math.cos(this.yaw) * step;
    this.avoidBuildings(game);
    return false;
  }

  private avoidBuildings(game: Game) {
    game.forEachNear(this.pos.x, this.pos.z, this.radius + 8, (e) => {
      if (e.kind !== 'house' && e.kind !== 'store' && e.kind !== 'worship') return;
      // The worship site is walkable; only keep clear of the totem pole in its middle.
      const r = e.kind === 'worship' ? 1.5 + this.radius * 0.5 : e.radius + this.radius * 0.75;
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
