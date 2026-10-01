import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Field, House } from './Buildings';
import type { Site } from '../projects/Site';
import { Entity, ownedMesh, sharedMesh } from './Entity';
import { Pile, Tree, carriedFood, carriedWood } from './Nature';
import { MAT, villagerParts } from '../art/Models';
import { SEA_LEVEL, VILLAGE, VILLAGER } from '../config';
import { angleLerp, damp } from '../util/math';
import { rng } from '../util/rng';

type Task =
  | { type: 'idle'; t: number }
  | { type: 'wander'; target: THREE.Vector3; t: number; arrived: boolean }
  | { type: 'eat'; t: number; arrived: boolean }
  | { type: 'sleep'; inside: boolean }
  | { type: 'worship'; dancing: boolean }
  | { type: 'harvest'; field: Field; target: THREE.Vector3; working: boolean; t: number }
  | { type: 'chop'; tree: Tree; working: boolean; t: number }
  | { type: 'build'; house: House; phase: 'fetch' | 'go' | 'work'; t: number }
  | { type: 'project'; site: Site; res: 'wood' | 'food'; phase: 'fetch' | 'go' | 'work'; t: number }
  | { type: 'collect'; pile: Pile }
  | { type: 'deliver' }
  | { type: 'panic'; target: THREE.Vector3; t: number }
  | { type: 'stunned'; t: number }
  | { type: 'travel'; target: THREE.Vector3 };

export type DeathCause = 'starved' | 'thrown' | 'crushed' | 'burned' | 'eaten';

type Anim = 'idle' | 'walk' | 'run' | 'work' | 'dance' | 'eat' | 'held' | 'fly' | 'lie' | 'swim' | 'flail';

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

export class Villager extends Entity {
  readonly kind = 'villager' as const;
  village: Village;
  home: House | null = null;
  role: 'work' | 'worship' = 'work';
  hunger = rng.range(0, 0.4);
  dead = false;
  carrying: { kind: 'food' | 'wood'; amount: number } | null = null;
  task: Task = { type: 'idle', t: rng.range(0, 2) };
  /** Slot in the worship dance ring, assigned by the village. */
  danceSlot = 0;
  /** Set by the prayers plugin: lost in the woods, waits in place instead of walking home. */
  lost = false;

  private animT = rng.range(0, 10);
  private yaw = rng.range(0, Math.PI * 2);
  private deathT = 0;
  readonly seed: number;
  private readonly root = new THREE.Group();
  private body!: THREE.Mesh;
  private armL!: THREE.Mesh;
  private armR!: THREE.Mesh;
  private legL!: THREE.Mesh;
  private legR!: THREE.Mesh;
  private readonly carryMesh: THREE.Mesh;

  constructor(village: Village, x: number, z: number, seed: number) {
    super();
    this.village = village;
    this.seed = seed;
    this.grabbable = true;
    this.flammable = true;
    this.fuel = 7;
    this.radius = 0.9;
    this.mass = 0.8;
    this.object.add(this.root);
    this.root.scale.setScalar(rng.range(0.92, 1.06));
    this.buildBody(village.color);
    this.carryMesh = sharedMesh(carriedFood, MAT.base);
    this.carryMesh.position.set(0, 2.25, 0);
    this.carryMesh.visible = false;
    this.root.add(this.carryMesh);
    this.pos.set(x, 0, z);
  }

  private buildBody(tunic: number) {
    for (const m of [this.body, this.armL, this.armR, this.legL, this.legR]) {
      if (m) {
        m.removeFromParent();
        m.geometry.dispose();
      }
    }
    const p = villagerParts(this.seed, tunic);
    this.body = ownedMesh(p.body, MAT.base);
    // Limbs are too small to matter in the shadow pass; only the body casts.
    this.armL = ownedMesh(p.arm, MAT.base, false);
    this.armR = ownedMesh(p.arm.clone(), MAT.base, false);
    this.legL = ownedMesh(p.leg, MAT.base, false);
    this.legR = ownedMesh(p.leg.clone(), MAT.base, false);
    this.armL.position.set(-0.4, 1.45, 0);
    this.armR.position.set(0.4, 1.45, 0);
    this.legL.position.set(-0.15, 0.78, 0);
    this.legR.position.set(0.15, 0.78, 0);
    this.root.add(this.body, this.armL, this.armR, this.legL, this.legR);
  }

  get isInside(): boolean {
    return this.task.type === 'sleep' && this.task.inside;
  }

  get isDancing(): boolean {
    return this.task.type === 'worship' && this.task.dancing;
  }

  get topHeight() {
    return 2.1;
  }

  get statusText(): string {
    const t = this.task;
    if (this.dead) return 'Dead';
    if (this.held) return 'In your hand!';
    if (this.burning) return 'On fire!';
    switch (t.type) {
      case 'worship':
        return t.dancing ? 'Worshipping' : 'Going to worship';
      case 'harvest':
        return 'Farming';
      case 'chop':
        return 'Chopping wood';
      case 'build':
        return 'Building';
      case 'project':
        return `Building the ${t.site.def.name.replace(/^The /, '')}`;
      case 'collect':
      case 'deliver':
        return `Carrying ${this.carrying?.kind ?? 'goods'}`;
      case 'eat':
        return 'Eating';
      case 'sleep':
        return 'Sleeping';
      case 'stunned':
        return 'Dazed';
      case 'travel':
        return 'Heading home';
      case 'panic':
        return 'Panicking';
      default:
        return this.hunger > 0.8 ? 'Hungry' : 'Idle';
    }
  }

  // ------------------------------------------------------------------ update

  update(game: Game, dt: number) {
    this.animT += dt;
    if (this.dead) {
      this.deathT += dt;
      this.pose('lie');
      if (this.deathT > 4) this.object.scale.setScalar(Math.max(0.01, 1 - (this.deathT - 4) / 1.5));
      if (this.deathT > 5.5) game.remove(this);
      return;
    }

    // Needs
    const mult = this.isDancing ? VILLAGER.worshipHungerMult : this.isInside ? 0.5 : 1;
    this.hunger = Math.min(1, this.hunger + VILLAGER.hungerRate * mult * game.modifiers.villagerHunger * dt);
    if (this.hunger >= 1) {
      this.health -= VILLAGER.starveDamage * dt;
      if (this.health <= 0) {
        this.die(game, 'starved', false);
        return;
      }
    } else if (this.health < 1 && !this.burning) {
      this.health = Math.min(1, this.health + dt * 0.01);
    }

    if (this.held) {
      this.pose('held');
      return;
    }
    if (this.airborne || this.rolling) {
      this.pose('fly');
      return;
    }

    if (this.burning && this.task.type !== 'panic') this.startPanic();
    if (this.inWater(game)) {
      if (this.burning) this.extinguish(game);
      if (this.task.type !== 'travel' && this.task.type !== 'panic') this.setTask({ type: 'travel', target: this.village.center.clone() });
    }

    this.runTask(game, dt);
    this.object.position.copy(this.pos);
  }

  private inWater(game: Game): boolean {
    return game.terrain.heightAt(this.pos.x, this.pos.z) < SEA_LEVEL - 0.6;
  }

  private setTask(t: Task) {
    this.releaseClaims();
    if (this.task.type === 'sleep' && this.task.inside) this.object.visible = true;
    this.task = t;
  }

  private releaseClaims() {
    const t = this.task;
    if (t.type === 'harvest' && t.field.claimedBy === this.id) t.field.claimedBy = 0;
    if (t.type === 'chop' && t.tree.claimedBy === this.id) t.tree.claimedBy = 0;
    if (t.type === 'collect' && t.pile.claimedBy === this.id) t.pile.claimedBy = 0;
  }

  private idle(seconds = rng.range(0.5, 2)) {
    this.setTask({ type: 'idle', t: seconds });
  }

  // ------------------------------------------------------------ decisions

  decide(game: Game) {
    const v = this.village;
    if (this.burning) return this.startPanic();
    if (this.carrying) return this.setTask({ type: 'deliver' });
    if (this.lost) return this.idle(rng.range(2, 5));

    const dHome = Math.hypot(this.pos.x - v.center.x, this.pos.z - v.center.z);
    if (dHome > v.radius * 2.2) return this.setTask({ type: 'travel', target: v.center.clone() });

    if (this.hunger > 0.62 && v.store.food >= 1) return this.setTask({ type: 'eat', t: 1.6, arrived: false });
    if (this.hunger > 0.62) v.complain(game, 'food');

    if (!this.home) v.assignHome(this);
    if (game.sky.isNight && this.role !== 'worship') {
      if (this.home?.complete) return this.setTask({ type: 'sleep', inside: false });
    }

    if (this.role === 'worship') return this.setTask({ type: 'worship', dancing: false });

    const pile = v.findPile(game, this);
    if (pile) {
      pile.claimedBy = this.id;
      return this.setTask({ type: 'collect', pile });
    }

    const site = v.constructionSite();
    if (site && v.store.wood >= 5 && v.builderCount() < 2) return this.setTask({ type: 'build', house: site, phase: 'fetch', t: 0 });

    // Village projects (well, temple...) and the Wonder: carry timber or food to the site.
    for (const site of [v.projectSite, v.wonderSite]) {
      if (!site || site.complete || site.builders(game, v) >= (site === v.wonderSite ? 3 : 2)) continue;
      const res = site.wantedFor(game, v);
      if (res) return this.setTask({ type: 'project', site, res, phase: 'fetch', t: 0 });
    }

    const field = v.findRipeField(this);
    if (field) {
      field.claimedBy = this.id;
      return this.setTask({ type: 'harvest', field, target: field.randomPoint(new THREE.Vector3()), working: false, t: 0 });
    }

    const wantWood = v.store.wood < 50 || (rng.chance(0.2) && v.store.wood < 120);
    if (wantWood) {
      const tree = v.findTree(game, this);
      if (tree) {
        tree.claimedBy = this.id;
        return this.setTask({ type: 'chop', tree, working: false, t: 0 });
      }
    }

    // Nothing to do: wander about the village.
    const a = rng.range(0, Math.PI * 2);
    const r = rng.range(3, v.radius * 0.75);
    const target = new THREE.Vector3(v.center.x + Math.cos(a) * r, 0, v.center.z + Math.sin(a) * r);
    this.setTask({ type: 'wander', target, t: rng.range(2, 6), arrived: false });
  }

  private startPanic() {
    this.setTask({ type: 'panic', target: this.pos.clone(), t: 0 });
  }

  // --------------------------------------------------------------- tasks

  private runTask(game: Game, dt: number) {
    const t = this.task;
    const v = this.village;
    switch (t.type) {
      case 'idle':
        this.pose('idle');
        t.t -= dt;
        if (t.t <= 0) this.decide(game);
        break;

      case 'wander':
        if (!t.arrived) {
          if (this.moveTo(game, t.target, dt)) t.arrived = true;
        } else {
          this.pose('idle');
          t.t -= dt;
          if (t.t <= 0 || this.role === 'worship') this.decide(game);
        }
        break;

      case 'travel':
        if (this.moveTo(game, t.target, dt) || Math.hypot(this.pos.x - t.target.x, this.pos.z - t.target.z) < v.radius * 0.6) {
          this.decide(game);
        }
        break;

      case 'eat': {
        if (!t.arrived) {
          if (this.moveTo(game, this.storeFront(tmp2), dt)) t.arrived = true;
          break;
        }
        this.pose('eat');
        t.t -= dt;
        if (t.t <= 0) {
          const got = v.store.take('food', VILLAGER.mealFood);
          this.hunger = Math.max(0, this.hunger - got / VILLAGER.mealFood);
          if (got < VILLAGER.mealFood) v.complain(game, 'food');
          this.idle(0.5);
        }
        break;
      }

      case 'sleep': {
        const home = this.home;
        if (!home || !home.complete || home.burning) {
          this.idle(0.2);
          break;
        }
        if (!t.inside) {
          if (this.moveTo(game, home.doorPoint(tmp2), dt)) {
            t.inside = true;
            this.object.visible = false;
          }
        } else if (game.sky.daylight > 0.45 || this.hunger > 0.85) {
          this.object.visible = true;
          this.idle(0.5);
        }
        break;
      }

      case 'worship': {
        if (this.role !== 'worship' || this.hunger > 0.7) {
          this.decide(game);
          break;
        }
        const floor = v.danceFloor;
        const slot = floor.slotPosition(this.danceSlot, Math.max(1, v.worshipperCount), game.time, tmp2);
        if (!t.dancing) {
          if (this.moveTo(game, slot, dt) || this.pos.distanceTo(slot) < 2) t.dancing = true;
        } else {
          this.pos.x += (slot.x - this.pos.x) * damp(4, dt);
          this.pos.z += (slot.z - this.pos.z) * damp(4, dt);
          this.pos.y = game.terrain.heightAt(this.pos.x, this.pos.z);
          this.yaw = Math.atan2(floor.pos.x - this.pos.x, floor.pos.z - this.pos.z);
          this.pose('dance');
        }
        break;
      }

      case 'harvest': {
        const f = t.field;
        if (!f.alive || f.burning || (!f.ripe && !t.working)) {
          this.decide(game);
          break;
        }
        if (!t.working) {
          if (this.moveTo(game, t.target, dt)) {
            t.working = true;
            t.t = 3;
          }
          break;
        }
        this.pose('work');
        t.t -= dt;
        if (t.t <= 0) {
          const food = f.harvest();
          if (food > 0) game.events.emit('fieldHarvested', { field: f, food });
          f.claimedBy = 0;
          if (food > 0) {
            this.carry('food', food);
            game.fx.dust(this.pos.x, this.pos.y + 0.5, this.pos.z, 6, 0.5, 0xe3c060);
            this.setTask({ type: 'deliver' });
          } else this.decide(game);
        }
        break;
      }

      case 'chop': {
        const tree = t.tree;
        if (!tree.alive || tree.held || tree.airborne || tree.burning || !tree.mature) {
          this.decide(game);
          break;
        }
        if (!t.working) {
          tmp.copy(this.pos).sub(tree.pos).setY(0);
          if (tmp.lengthSq() < 0.01) tmp.set(1, 0, 0);
          tmp.normalize().multiplyScalar(1.3).add(tree.pos);
          if (this.moveTo(game, tmp, dt)) {
            t.working = true;
            t.t = 4;
          }
          break;
        }
        this.yaw = Math.atan2(tree.pos.x - this.pos.x, tree.pos.z - this.pos.z);
        this.pose('work');
        const before = t.t;
        t.t -= dt;
        if (Math.floor(before * 1.5) !== Math.floor(t.t * 1.5)) game.fx.dust(tree.pos.x, tree.pos.y + 1, tree.pos.z, 2, 0.3, 0xc9a070);
        if (t.t <= 0) {
          const wood = tree.chop(game, VILLAGER.carryAmount);
          tree.claimedBy = 0;
          if (wood > 0) {
            this.carry('wood', wood);
            this.setTask({ type: 'deliver' });
          } else this.decide(game);
        }
        break;
      }

      case 'build': {
        const h = t.house;
        if (!h.alive || h.destroyed || h.progress >= 1) {
          this.decide(game);
          break;
        }
        if (t.phase === 'fetch') {
          if (this.moveTo(game, this.storeFront(tmp2), dt)) {
            const got = v.store.take('wood', 5);
            if (got <= 0) {
              this.decide(game);
              break;
            }
            this.carry('wood', got);
            t.phase = 'go';
          }
        } else if (t.phase === 'go') {
          tmp.copy(this.pos).sub(h.pos).setY(0).normalize().multiplyScalar(h.radius + 0.4).add(h.pos);
          if (this.moveTo(game, tmp, dt)) {
            t.phase = 'work';
            t.t = 3;
          }
        } else {
          this.yaw = Math.atan2(h.pos.x - this.pos.x, h.pos.z - this.pos.z);
          this.pose('work');
          t.t -= dt;
          if (t.t <= 0) {
            const wood = this.carrying?.amount ?? 0;
            this.carry(null, 0);
            h.addProgress(game, wood / VILLAGE.houseWoodCost);
            this.idle(0.3);
          }
        }
        break;
      }

      case 'project': {
        const s = t.site;
        if (!s.alive || s.complete || (this.carrying && s.open(t.res) <= 0.01)) {
          this.setTask(this.carrying ? { type: 'deliver' } : { type: 'idle', t: 0.2 });
          break;
        }
        if (t.phase === 'fetch') {
          if (this.moveTo(game, this.storeFront(tmp2), dt)) {
            const amount = s.loadFor(game, v, t.res, false);
            const got = amount >= 1 ? v.store.take(t.res, amount) : 0;
            if (got <= 0) {
              this.decide(game);
              break;
            }
            this.carry(t.res, got);
            t.phase = 'go';
          }
        } else if (t.phase === 'go') {
          if (this.moveTo(game, s.approachPoint(v, this.pos, tmp), dt)) {
            t.phase = 'work';
            t.t = 2.6;
          }
        } else {
          const at = v === s.village ? s.pos : v.worship.pos;
          this.yaw = Math.atan2(at.x - this.pos.x, at.z - this.pos.z);
          this.pose('work');
          t.t -= dt;
          if (t.t <= 0) {
            const amount = this.carrying?.amount ?? 0;
            this.carry(null, 0);
            if (amount > 0) s.deliver(game, v, t.res, amount);
            this.idle(0.3);
          }
        }
        break;
      }

      case 'collect': {
        const p = t.pile;
        if (!p.alive || p.held || p.airborne || p.amount <= 0) {
          this.decide(game);
          break;
        }
        if (this.moveTo(game, p.pos, dt)) {
          const got = p.take(VILLAGER.carryAmount);
          p.claimedBy = 0;
          this.carry(p.kind, got);
          this.setTask({ type: 'deliver' });
        }
        break;
      }

      case 'deliver': {
        if (!this.carrying) {
          this.decide(game);
          break;
        }
        if (this.moveTo(game, this.storeFront(tmp2), dt)) {
          v.store.deposit(this.carrying.kind, this.carrying.amount);
          this.carry(null, 0);
          this.idle(0.4);
        }
        break;
      }

      case 'panic': {
        t.t -= dt;
        if (!this.burning) {
          this.idle(1);
          break;
        }
        if (t.t <= 0 || this.pos.distanceTo(t.target) < 1) {
          t.t = rng.range(0.8, 1.6);
          const water = game.findWaterNear(this.pos.x, this.pos.z, 35);
          if (water) t.target.copy(water);
          else t.target.set(this.pos.x + rng.range(-12, 12), 0, this.pos.z + rng.range(-12, 12));
        }
        this.moveTo(game, t.target, dt, true);
        this.pose('flail');
        break;
      }

      case 'stunned':
        this.pose('lie');
        t.t -= dt;
        if (t.t <= 0) {
          this.root.rotation.set(0, 0, 0);
          this.decide(game);
        }
        break;
    }
  }

  private storeFront(out: THREE.Vector3): THREE.Vector3 {
    const s = this.village.store;
    out.copy(this.pos).sub(s.pos).setY(0);
    if (out.lengthSq() < 0.01) out.set(0, 0, 1);
    return out.normalize().multiplyScalar(s.radius + 0.8).add(s.pos);
  }

  carry(kind: 'food' | 'wood' | null, amount: number) {
    if (!kind || amount <= 0) {
      this.carrying = null;
      this.carryMesh.visible = false;
      return;
    }
    this.carrying = { kind, amount };
    this.carryMesh.geometry = kind === 'food' ? carriedFood : carriedWood;
    this.carryMesh.visible = true;
  }

  /** Walk toward a point over the terrain. Returns true on arrival. */
  private moveTo(game: Game, target: THREE.Vector3, dt: number, run = false): boolean {
    const dx = target.x - this.pos.x;
    const dz = target.z - this.pos.z;
    const d = Math.hypot(dx, dz);
    if (d < 0.7) {
      this.pos.y = game.terrain.heightAt(this.pos.x, this.pos.z);
      return true;
    }
    const swimming = this.inWater(game);
    let speed = run ? VILLAGER.runSpeed : VILLAGER.walkSpeed;
    if (swimming) speed *= 0.45;
    if (this.hunger >= 1) speed *= 0.6;
    const step = Math.min(d, speed * dt);
    this.pos.x += (dx / d) * step;
    this.pos.z += (dz / d) * step;
    this.avoidBuildings(target);
    const ground = game.terrain.heightAt(this.pos.x, this.pos.z);
    this.pos.y = swimming ? SEA_LEVEL - 1.0 : ground;
    this.yaw = angleLerp(this.yaw, Math.atan2(dx, dz), damp(10, dt));
    if (!run) this.pose(swimming ? 'swim' : 'walk');
    return false;
  }

  /** Slide around buildings instead of walking through them. */
  private avoidBuildings(target: THREE.Vector3) {
    const v = this.village;
    const check = (bx: number, bz: number, r: number) => {
      // Don't push away from a building we're walking up to.
      if (Math.hypot(target.x - bx, target.z - bz) < r + 1.5) return;
      const ox = this.pos.x - bx;
      const oz = this.pos.z - bz;
      const d = Math.hypot(ox, oz);
      if (d < r && d > 0.001) {
        this.pos.x = bx + (ox / d) * r;
        this.pos.z = bz + (oz / d) * r;
      }
    };
    for (const h of v.houses) if (!h.destroyed) check(h.pos.x, h.pos.z, 3.1);
    check(v.store.pos.x, v.store.pos.z, 4.3);
  }

  // ------------------------------------------------------------ animation

  private pose(anim: Anim) {
    const t = this.animT;
    const r = this.root;
    let legSwing = 0;
    let armL = 0;
    let armR = 0;
    let armSide = 0;
    let bob = 0;
    let lean = 0;
    let lie = 0;
    let roll = 0;
    switch (anim) {
      case 'idle':
        armL = armR = Math.sin(t * 1.5) * 0.04;
        break;
      case 'walk': {
        const s = Math.sin(t * 9);
        legSwing = s * 0.6;
        armL = -s * 0.5;
        armR = s * 0.5;
        bob = Math.abs(Math.cos(t * 9)) * 0.08;
        break;
      }
      case 'run':
      case 'flail': {
        const s = Math.sin(t * 15);
        legSwing = s * 0.9;
        if (anim === 'flail') {
          armL = -2.6 + Math.sin(t * 21) * 0.6;
          armR = -2.6 + Math.cos(t * 19) * 0.6;
          armSide = 0.3;
        } else {
          armL = -s * 0.9;
          armR = s * 0.9;
        }
        bob = Math.abs(Math.cos(t * 15)) * 0.15;
        lean = 0.15;
        break;
      }
      case 'swim':
        armL = -2 + Math.sin(t * 5) * 1.2;
        armR = -2 - Math.sin(t * 5) * 1.2;
        legSwing = Math.sin(t * 8) * 0.4;
        lean = 1.1;
        break;
      case 'work':
        armL = armR = -1.4 + Math.sin(t * 7) * 1.1;
        lean = 0.25 + Math.max(0, Math.sin(t * 7)) * 0.15;
        break;
      case 'eat':
        armR = -1.8 + Math.sin(t * 6) * 0.3;
        armL = 0.1;
        break;
      case 'dance':
        bob = Math.abs(Math.sin(t * 5 + this.id)) * 0.55;
        armL = -2.7 + Math.sin(t * 5 + this.id) * 0.4;
        armR = -2.7 - Math.sin(t * 5 + this.id) * 0.4;
        armSide = 0.25;
        legSwing = Math.sin(t * 10 + this.id) * 0.3;
        break;
      case 'held':
        legSwing = Math.sin(t * 22) * 0.9;
        armL = -2.2 + Math.sin(t * 17) * 0.9;
        armR = -2.2 + Math.cos(t * 19) * 0.9;
        armSide = 0.5;
        roll = Math.sin(t * 6) * 0.3;
        break;
      case 'fly':
        armL = armR = -2.8;
        armSide = 0.8;
        legSwing = Math.sin(t * 25) * 0.5;
        break;
      case 'lie':
        lie = 1;
        armSide = 0.9;
        break;
    }
    this.legL.rotation.x = legSwing;
    this.legR.rotation.x = -legSwing;
    this.armL.rotation.set(armL, 0, -armSide);
    this.armR.rotation.set(armR, 0, armSide);
    r.position.y = bob + (lie ? 0.25 : 0);
    r.rotation.x = lie ? -Math.PI / 2 : lean;
    r.rotation.z = roll;
    if (anim !== 'fly') {
      this.object.rotation.set(0, this.yaw, 0);
    }
  }

  // ------------------------------------------------------ hand & physics

  onPickup(game: Game) {
    this.setTask({ type: 'idle', t: 0 });
    this.object.visible = true;
    if (this.carrying) {
      const p = new Pile(this.carrying.kind, this.pos.x, this.pos.z, this.carrying.amount);
      p.pos.y = game.terrain.heightAt(p.pos.x, p.pos.z);
      game.add(p);
      this.carry(null, 0);
    }
  }

  onImpact(game: Game, speed: number) {
    this.airborne = false;
    this.rolling = false;
    this.vel.set(0, 0, 0);
    this.object.rotation.set(0, this.yaw, 0);
    this.pos.y = game.terrain.heightAt(this.pos.x, this.pos.z);
    const byPlayer = this.thrownByPlayer;
    this.thrownByPlayer = false;

    if (speed >= VILLAGER.lethalImpact) {
      game.fx.dust(this.pos.x, this.pos.y, this.pos.z, 14, 0.6);
      this.die(game, 'thrown', byPlayer);
      return;
    }
    // Survived: maybe adopt the village they landed in.
    const here = game.villageAt(this.pos.x, this.pos.z);
    if (here && here !== this.village) {
      this.joinVillage(game, here);
      if (byPlayer || here.owner !== 'player') {
        game.impress(this.pos.x, this.pos.z, 4, 0, `${here.name} welcomes a newcomer`);
      }
    }
    if (speed >= VILLAGER.stunImpact) {
      game.fx.dust(this.pos.x, this.pos.y, this.pos.z, 8, 0.5);
      this.setTask({ type: 'stunned', t: 2.5 });
    } else {
      this.setTask({ type: 'stunned', t: 0.5 });
    }
  }

  onWater(game: Game) {
    game.fx.splash(this.pos.x, this.pos.z, 18, 1);
    this.airborne = false;
    this.vel.set(0, 0, 0);
    this.object.rotation.set(0, this.yaw, 0);
    this.pos.y = SEA_LEVEL - 1;
    this.thrownByPlayer = false;
    if (this.burning) this.extinguish(game);
    this.setTask({ type: 'travel', target: this.village.center.clone() });
  }

  joinVillage(game: Game, v: Village) {
    const old = this.village;
    old.removeVillager(this);
    this.leaveHome(game);
    this.village = v;
    v.addVillager(this);
    game.events.emit('villagerJoined', { villager: this, village: v, from: old });
    this.buildBody(v.color);
    this.carryMesh.removeFromParent();
    this.root.add(this.carryMesh);
  }

  /** Rouse a sleeper (a festival has begun). */
  wake() {
    if (this.task.type === 'sleep') this.setTask({ type: 'idle', t: 0.2 });
  }

  leaveHome(_game: Game) {
    if (this.home) {
      const i = this.home.residents.indexOf(this);
      if (i >= 0) this.home.residents.splice(i, 1);
      this.home = null;
    }
    if (this.task.type === 'sleep') {
      this.object.visible = true;
      this.task = { type: 'idle', t: 0.5 };
    }
  }

  die(game: Game, cause: DeathCause, byPlayer: boolean) {
    if (this.dead) return;
    this.releaseClaims();
    this.dead = true;
    this.burning = false;
    this.flammable = false;
    this.grabbable = false;
    this.object.visible = true;
    this.task = { type: 'idle', t: 0 };
    if (this.carrying) {
      const p = new Pile(this.carrying.kind, this.pos.x, this.pos.z, this.carrying.amount);
      p.pos.y = game.terrain.heightAt(p.pos.x, p.pos.z);
      game.add(p);
      this.carry(null, 0);
    }
    this.leaveHome(game);
    this.village.removeVillager(this);
    game.fx.sparkle(this.pos.x, this.pos.y + 1, this.pos.z, 12, 0xcfe6ff, 1);
    game.onVillagerDeath(this, cause, byPlayer);
  }

  protected onIgnite() {
    this.startPanic();
  }

  onBurntOut(game: Game) {
    // Fuel spent: they survive if still healthy, charred but alive.
    if (this.health <= 0.05) this.die(game, 'burned', this.ignitedByPlayer);
    else {
      this.flammable = true;
      this.fuel = 7;
    }
  }

  /** Called by the fire system while burning. */
  burnDamage(game: Game, dt: number) {
    this.health -= dt * 0.22;
    if (this.health <= 0) this.die(game, 'burned', this.ignitedByPlayer);
  }
}
