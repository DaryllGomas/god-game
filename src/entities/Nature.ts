import * as THREE from 'three';
import type { Game } from '../Game';
import { Entity, ownedMesh, sharedMesh } from './Entity';
import { MAT, carriedGeometry, logStackGeometry, foodHeapGeometry, rockGeometry, treeGeometry } from '../art/Models';
import { clamp } from '../util/math';
import { assets } from '../assets';

// ---------------------------------------------------------------------- tree

const PROCEDURAL_VARIANTS = 16;
/** Number of instanced tree geometries (set by initTrees: the GLB's, or 16 procedural ones). */
export let TREE_VARIANTS = PROCEDURAL_VARIANTS;
/** How common each species is among planted trees (Blender set only). Blossom is a rare treat. */
const SPECIES_WEIGHT: Record<string, number> = { oak: 0.38, pine: 0.3, birch: 0.24, blossom: 0.08 };
const treeCache: { geo: THREE.BufferGeometry; height: number }[] = [];
const speciesTable: { cum: number; variants: number[] }[] = [];
let treesReady = false;

/** Pick the tree geometries: the Blender set if it loaded, else the procedural fallback. Idempotent. */
export function initTrees() {
  if (treesReady) return;
  treesReady = true;
  const set = assets.trees;
  if (!set) return;
  treeCache.length = 0;
  const groups = new Map<string, number[]>();
  set.forEach((t, i) => {
    treeCache.push({ geo: t.geo, height: t.height });
    if (!groups.has(t.species)) groups.set(t.species, []);
    groups.get(t.species)!.push(i);
  });
  TREE_VARIANTS = set.length;
  let total = 0;
  for (const sp of groups.keys()) total += SPECIES_WEIGHT[sp] ?? 0.2;
  let cum = 0;
  for (const [sp, variants] of groups) {
    cum += (SPECIES_WEIGHT[sp] ?? 0.2) / total;
    speciesTable.push({ cum, variants });
  }
}

export function treeVariant(i: number) {
  initTrees();
  if (!treeCache[i]) treeCache[i] = treeGeometry(1000 + i * 7919);
  return treeCache[i];
}

/** Choose a variant for a tree seed: weighted by species with the Blender set, uniform otherwise. */
function pickTreeVariant(seed: number): number {
  initTrees();
  const a = Math.abs(seed);
  if (!speciesTable.length) return a % TREE_VARIANTS;
  const r = ((a * 2654435761) % 1000) / 1000;
  const row = speciesTable.find((s) => r < s.cum) ?? speciesTable[speciesTable.length - 1];
  return row.variants[Math.floor(a / 7) % row.variants.length];
}

const TREE_GROW_TIME = 240;
const TREE_MAX_WOOD = 30;

export class Tree extends Entity {
  readonly kind = 'tree' as const;
  growth: number;
  chopped = 0;
  charred = false;
  readonly seed: number;
  private charTimer = 0;
  private felling = 0;
  private readonly fellAxis = new THREE.Vector3();
  private readonly baseHeight: number;
  /** Which instanced geometry draws this tree, and its fixed spin (see Forest). */
  readonly variant: number;
  readonly yaw: number;

  constructor(seed: number, x: number, z: number, growth: number) {
    super();
    this.seed = seed;
    this.variant = pickTreeVariant(seed);
    this.yaw = (seed % 628) / 100;
    this.baseHeight = treeVariant(this.variant).height;
    this.pos.set(x, 0, z);
    this.growth = growth;
    this.grabbable = true;
    this.flammable = true;
    this.fuel = 12;
    this.mass = 3;
    this.applyScale();
  }

  get wood(): number {
    return Math.max(0, TREE_MAX_WOOD * this.growth - this.chopped);
  }

  /** Falling over right now (about to be removed): not worth saving. */
  get isFelling(): boolean {
    return this.felling > 0;
  }

  /** Save/load: restore chopped wood and charred state. */
  restore(chopped: number, charred: boolean) {
    this.chopped = chopped;
    if (charred) {
      this.charred = true;
      this.flammable = false;
      this.grabbable = false;
    }
  }

  get mature(): boolean {
    return this.growth > 0.65 && !this.charred && this.felling === 0;
  }

  get topHeight(): number {
    return this.baseHeight * this.scale * 0.7;
  }

  get scale(): number {
    return 0.25 + 0.75 * this.growth;
  }

  private applyScale() {
    this.radius = 1.2 + 1.3 * this.scale;
  }

  water(amount: number) {
    if (this.charred) return;
    this.growth = Math.min(1, this.growth + amount);
    this.applyScale();
  }

  /** Remove up to `amount` wood; the tree falls when exhausted. */
  chop(game: Game, amount: number): number {
    const taken = Math.min(amount, this.wood);
    this.chopped += taken;
    game.fx.dust(this.pos.x, this.pos.y + 1, this.pos.z, 4, 0.4, 0xc9a070);
    if (this.wood < 1) this.fell();
    return taken;
  }

  fell() {
    if (this.felling > 0) return;
    this.felling = 0.0001;
    this.grabbable = false;
    const a = Math.random() * Math.PI * 2;
    this.fellAxis.set(Math.cos(a), 0, Math.sin(a));
  }

  update(game: Game, dt: number) {
    if (this.held || this.airborne) return;
    if (this.felling > 0) {
      this.felling += dt;
      const t = Math.min(1, this.felling / 1.2);
      this.object.quaternion.setFromAxisAngle(this.fellAxis, t * t * Math.PI * 0.48);
      if (this.felling > 1.2 && this.felling - dt <= 1.2) game.fx.dust(this.pos.x, this.pos.y, this.pos.z, 12, 1);
      if (this.felling > 3) {
        this.object.scale.setScalar(Math.max(0.01, 1 - (this.felling - 3)));
        if (this.felling > 4) game.remove(this);
      }
      return;
    }
    if (this.charred) {
      this.charTimer += dt;
      if (this.charTimer > 40) {
        this.object.scale.multiplyScalar(1 - dt);
        if (this.object.scale.x < 0.05) game.remove(this);
      }
      return;
    }
    if (this.growth < 1 && !this.burning) {
      this.growth = Math.min(1, this.growth + (dt / TREE_GROW_TIME) * game.modifiers.treeGrowth);
      this.applyScale();
    }
  }

  onPickup() {
    this.claimedBy = 0;
  }

  onImpact(game: Game, speed: number) {
    // Delivered to a village store, a tree becomes timber for the villagers.
    const store = this.charred ? null : game.storeNear(this.pos.x, this.pos.z, 10);
    if (store) {
      const wood = Math.max(10, Math.round(this.wood));
      store.deposit('wood', wood);
      game.fx.dust(this.pos.x, this.pos.y, this.pos.z, 14, 0.9, 0xc9a070);
      game.fx.sparkle(store.pos.x, store.pos.y + 4, store.pos.z, 25, 0xd9a86a, 4);
      game.floatText(store.pos.x, store.pos.y + 7, store.pos.z, `+${wood} wood`, '#e8c79a');
      game.giftToVillage(store.village, wood, 'wood');
      game.remove(this);
      return;
    }
    // Anywhere else, trees root wherever they land.
    this.airborne = false;
    this.rolling = false;
    this.vel.set(0, 0, 0);
    this.object.quaternion.identity();
    this.pos.y = game.terrain.heightAt(this.pos.x, this.pos.z);
    game.fx.dust(this.pos.x, this.pos.y, this.pos.z, Math.min(30, 4 + speed), 0.8);
    if (speed > 12) game.crush(this, this.pos, 2.5, speed * this.mass * 0.01);
  }

  protected onIgnite() {
    this.grabbable = true;
  }

  onBurntOut(game: Game) {
    this.charred = true;
    this.flammable = false;
    this.grabbable = false;
    game.fx.smoke(this.pos.x, this.pos.y + this.topHeight, this.pos.z, 2, 0.15);
  }
}

// ---------------------------------------------------------------------- rock

export class Rock extends Entity {
  readonly kind = 'rock' as const;
  readonly seed: number;
  private readonly mesh: THREE.Mesh;

  constructor(seed: number, x: number, z: number, radius: number) {
    super();
    this.seed = seed;
    this.radius = radius;
    this.mass = radius * radius * radius;
    this.groundOffset = radius * 0.55;
    this.grabbable = true;
    this.canRoll = true;
    this.mesh = ownedMesh(rockGeometry(seed, radius), MAT.base);
    this.mesh.rotation.y = seed;
    this.object.add(this.mesh);
    this.pos.set(x, 0, z);
  }

  get topHeight() {
    return this.radius;
  }

  update(game: Game, dt: number) {
    if (this.rolling) {
      const speed = Math.hypot(this.vel.x, this.vel.z);
      // Roll visually around the axis perpendicular to motion.
      this.object.rotateOnWorldAxis(new THREE.Vector3(this.vel.z, 0, -this.vel.x).normalize(), (speed / this.radius) * dt);
      if (speed > 5) game.crush(this, this.pos, this.radius + 0.6, speed * this.mass * 0.0015 * dt * 10);
    }
  }

  onImpact(game: Game, speed: number) {
    const n = Math.min(60, 6 + speed * this.radius * 0.8);
    game.fx.dust(this.pos.x, this.pos.y - this.groundOffset, this.pos.z, n, 0.6 + this.radius * 0.35);
    if (speed > 9) {
      game.crush(this, this.pos, this.radius + 1.5, speed * this.mass * 0.012);
      game.shake(Math.min(1.5, speed * this.mass * 0.0008));
    }
  }
}

// --------------------------------------------------------------------- piles

const foodGeo = foodHeapGeometry();
const woodGeo = logStackGeometry();
export const carriedFood = carriedGeometry('food');
export const carriedWood = carriedGeometry('wood');

/** A heap of food or a stack of logs lying in the world, waiting to be carried to a store. */
export class Pile extends Entity {
  readonly kind: 'food' | 'wood';
  amount: number;
  private readonly mesh: THREE.Mesh;

  constructor(kind: 'food' | 'wood', x: number, z: number, amount: number) {
    super();
    this.kind = kind;
    this.amount = amount;
    this.grabbable = true;
    this.mesh = sharedMesh(kind === 'food' ? foodGeo : woodGeo, MAT.base);
    this.object.add(this.mesh);
    this.pos.set(x, 0, z);
    this.flammable = kind === 'wood';
    this.fuel = 8;
    this.refresh();
  }

  refresh() {
    const s = clamp(Math.sqrt(this.amount / 20), 0.5, 1.8);
    this.mesh.scale.setScalar(s);
    this.radius = 1.2 * s;
  }

  take(amount: number): number {
    const t = Math.min(amount, this.amount);
    this.amount -= t;
    this.refresh();
    return t;
  }

  update(game: Game) {
    if (this.amount <= 0.01 && !this.held) game.remove(this);
  }

  onImpact(game: Game, speed: number) {
    const store = game.storeNear(this.pos.x, this.pos.z, 9);
    if (store) {
      store.deposit(this.kind, this.amount);
      game.fx.sparkle(store.pos.x, store.pos.y + 4, store.pos.z, 25, this.kind === 'food' ? 0xffe28a : 0xd9a86a, 4);
      game.floatText(store.pos.x, store.pos.y + 7, store.pos.z, `+${Math.round(this.amount)} ${this.kind}`, '#ffe9a8');
      if (this.thrownByPlayer || this.droppedByPlayer) {
        game.giftToVillage(store.village, this.amount, this.kind);
      }
      this.amount = 0;
      game.remove(this);
      return;
    }
    if (speed > 6) game.fx.dust(this.pos.x, this.pos.y, this.pos.z, 8, 0.6, this.kind === 'food' ? 0xe0c070 : 0xb59a6c);
  }

  droppedByPlayer = false;

  onDrop() {
    this.droppedByPlayer = true;
  }

  onBurntOut(game: Game) {
    game.remove(this);
  }
}
