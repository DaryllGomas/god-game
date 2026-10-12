import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Villager } from './Villager';
import { Entity, ownedMesh, sharedMesh } from './Entity';
import {
  MAT,
  flagGeometry,
  foodHeapGeometry,
  logStackGeometry,
  ruinsGeometry,
  scaffoldGeometry,
  storeGeometry,
} from '../art/Models';
import { ShrineVisual } from '../shrines/ShrineVisual';
import type { ShrineStage } from '../shrines/stages';
import { cottageGeometry } from '../art/Cottage';
import { buildFieldMesh, setCropHeight, type FieldMesh } from '../art/FieldMesh';
import { VILLAGE } from '../config';
import { clamp } from '../util/math';

const WINDOW_LIT = MAT.window;
const WINDOW_DARK = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.8 });
const scaffoldGeo = scaffoldGeometry();

// --------------------------------------------------------------------- house

export class House extends Entity {
  readonly kind = 'house' as const;
  village: Village;
  readonly residents: Villager[] = [];
  progress: number;
  destroyed = false;
  private ruinTimer = 0;
  private readonly body: THREE.Mesh;
  private readonly windows: THREE.Mesh;
  private readonly scaffold: THREE.Mesh;
  private ruins: THREE.Mesh | null = null;
  readonly seed: number;
  /** Chimney top in the house's local frame (where the smoke starts) and footprint size. */
  readonly chimney: THREE.Vector3;
  readonly footW: number;
  readonly footD: number;

  constructor(village: Village, x: number, y: number, z: number, rotY: number, seed: number, built: boolean) {
    super();
    this.village = village;
    this.seed = seed;
    const g = cottageGeometry(seed);
    this.chimney = g.chimney;
    this.footW = g.w;
    this.footD = g.d;
    this.body = ownedMesh(g.body, MAT.base);
    this.windows = ownedMesh(g.windows, WINDOW_DARK, false);
    this.scaffold = sharedMesh(scaffoldGeo, MAT.base);
    this.object.add(this.body, this.windows, this.scaffold);
    this.object.rotation.y = rotY;
    this.pos.set(x, y, z);
    this.radius = 3.2;
    this.progress = built ? 1 : 0;
    this.fuel = 16;
    this.refreshVisual();
  }

  get complete(): boolean {
    return this.progress >= 1 && !this.destroyed;
  }

  get capacity(): number {
    return this.complete ? VILLAGE.houseCapacity : 0;
  }

  get vacancy(): number {
    return this.capacity - this.residents.length;
  }

  get topHeight() {
    return 6;
  }

  /** Point just outside the front door, in world space. */
  doorPoint(out: THREE.Vector3): THREE.Vector3 {
    const a = this.object.rotation.y;
    return out.set(this.pos.x + Math.sin(a) * 3.2, this.pos.y, this.pos.z + Math.cos(a) * 3.2);
  }

  private refreshVisual() {
    const built = this.progress >= 1;
    this.body.visible = !this.destroyed && (built || this.progress > 0.35);
    this.windows.visible = this.body.visible;
    this.scaffold.visible = !this.destroyed && !built;
    if (!built && this.body.visible) this.body.scale.set(1, clamp((this.progress - 0.35) / 0.65, 0.05, 1), 1);
    else this.body.scale.set(1, 1, 1);
    this.flammable = this.complete;
  }

  /** Save/load: set the build progress outright (no effects). */
  setProgress(p: number) {
    this.progress = p;
    this.refreshVisual();
  }

  addProgress(game: Game, amount: number) {
    if (this.destroyed || this.progress >= 1) return;
    this.progress = Math.min(1, this.progress + amount);
    game.fx.dust(this.pos.x, this.pos.y + 1, this.pos.z, 6, 0.6, 0xc9a070);
    if (this.progress >= 1) {
      game.fx.sparkle(this.pos.x, this.pos.y + 3, this.pos.z, 30, 0xfff0b0, 5);
      if (this.village.owner === 'player') game.message(`${this.village.name} finished building a new house.`, 'good');
      game.events.emit('houseBuilt', { house: this });
    }
    this.refreshVisual();
  }

  damage(game: Game, amount: number, byPlayer: boolean) {
    if (this.destroyed || amount <= 0) return;
    this.health -= amount;
    game.fx.dust(this.pos.x, this.pos.y + 2, this.pos.z, Math.min(20, amount * 30), 0.8, 0x9a8a7a);
    if (this.health <= 0) this.destroy(game, byPlayer);
  }

  destroy(game: Game, byPlayer: boolean) {
    if (this.destroyed) return;
    this.destroyed = true;
    this.burning = false;
    this.flammable = false;
    this.ruins = ownedMesh(ruinsGeometry(this.seed), MAT.charred);
    this.object.add(this.ruins);
    this.refreshVisual();
    game.fx.dust(this.pos.x, this.pos.y + 1, this.pos.z, 40, 1.4, 0x6a5a4a);
    for (let i = 0; i < 10; i++) game.fx.smoke(this.pos.x, this.pos.y + 2, this.pos.z, 3, 0.2);
    for (const r of [...this.residents]) r.leaveHome(game);
    game.onHouseDestroyed(this, byPlayer);
  }

  update(game: Game, dt: number) {
    if (this.destroyed) {
      this.ruinTimer += dt;
      if (this.ruinTimer > 30) this.village.removeHouse(game, this);
      return;
    }
    // A lived-in home keeps its windows warm from late afternoon on (even with everyone out at work).
    const lit = game.sky.daylight < 0.7 && this.complete && this.residents.length > 0;
    this.windows.material = lit ? WINDOW_LIT : WINDOW_DARK;
    if (this.complete && !this.burning && this.health < 1 && !game.sky.isNight) {
      this.health = Math.min(1, this.health + dt * 0.01);
    }
  }

  onBurntOut(game: Game) {
    this.destroy(game, this.ignitedByPlayer);
  }
}

// --------------------------------------------------------------------- store

const heapGeo = foodHeapGeometry();
const logsGeo = logStackGeometry();

export class Store extends Entity {
  readonly kind = 'store' as const;
  village: Village;
  food = 40;
  wood = 40;
  private readonly foodHeap: THREE.Mesh;
  private readonly woodHeap: THREE.Mesh;
  private readonly flag: THREE.Mesh;
  private readonly flagMat: THREE.MeshStandardMaterial;

  constructor(village: Village, x: number, y: number, z: number) {
    super();
    this.village = village;
    this.object.add(ownedMesh(storeGeometry(), MAT.base));
    this.foodHeap = sharedMesh(heapGeo, MAT.base);
    this.foodHeap.position.set(4.6, 0, 1.5);
    this.woodHeap = sharedMesh(logsGeo, MAT.base);
    this.woodHeap.position.set(-4.4, 0, 1.8);
    this.woodHeap.rotation.y = 0.5;
    this.flagMat = new THREE.MeshStandardMaterial({ color: village.color, roughness: 0.7, side: THREE.DoubleSide });
    this.flag = sharedMesh(flagGeometry(), this.flagMat, false);
    this.flag.position.set(0, 9, 0);
    this.object.add(this.foodHeap, this.woodHeap, this.flag);
    this.pos.set(x, y, z);
    this.radius = 4.2;
  }

  get topHeight() {
    return 9;
  }

  deposit(kind: 'food' | 'wood', amount: number) {
    if (kind === 'food') this.food += amount;
    else this.wood += amount;
  }

  take(kind: 'food' | 'wood', amount: number): number {
    const have = kind === 'food' ? this.food : this.wood;
    const t = Math.min(have, amount);
    if (kind === 'food') this.food -= t;
    else this.wood -= t;
    return t;
  }

  setColor(color: number) {
    this.flagMat.color.set(color);
  }

  update(game: Game) {
    this.foodHeap.visible = this.food >= 1;
    this.foodHeap.scale.setScalar(clamp(Math.sqrt(this.food) / 8, 0.3, 2.2));
    this.woodHeap.visible = this.wood >= 1;
    this.woodHeap.scale.setScalar(clamp(Math.sqrt(this.wood) / 7, 0.3, 1.8));
    this.flag.rotation.y = Math.sin(game.time * 1.3 + this.id) * 0.4;
  }
}

// -------------------------------------------------------------- worship site

/**
 * A village's prayer place: a totem at first, growing through the ages (see src/shrines). Its people
 * dance round it to pray; it faces its village, the way in toward the houses.
 */
export class WorshipSite extends Entity {
  readonly kind = 'worship' as const;
  village: Village;
  readonly shrine = new ShrineVisual();
  private readonly rotY: number;

  constructor(village: Village, x: number, y: number, z: number) {
    super();
    this.village = village;
    this.object.add(this.shrine.group);
    this.rotY = Math.atan2(village.center.x - x, village.center.z - z);
    this.object.rotation.y = this.rotY;
    this.pos.set(x, y, z);
    this.radius = this.shrine.pickRadius;
  }

  /** Dancers circle at this radius (wider once a pyramid stands in the middle). */
  get ringRadius(): number {
    return this.shrine.ringRadius;
  }

  /** The solid middle that walkers keep out of (the totem pole, later the pyramid). */
  get solidRadius(): number {
    return this.shrine.solidRadius;
  }

  get facing(): number {
    return this.rotY;
  }

  get topHeight() {
    return this.shrine.topHeight;
  }

  /** The prayer place grows into another age (`animate`: it is happening now, not a load). */
  setStage(stage: ShrineStage, animate: boolean) {
    this.shrine.setStage(stage, animate);
    this.radius = this.shrine.pickRadius;
  }

  /** Dancers circle the prayer place; slot i of n at the current time. */
  slotPosition(i: number, n: number, time: number, out: THREE.Vector3): THREE.Vector3 {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + time * 0.35;
    const r = this.ringRadius;
    return out.set(this.pos.x + Math.cos(a) * r, this.pos.y, this.pos.z + Math.sin(a) * r);
  }

  /** Local point of the shrine model to world space. */
  toWorld(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(this.rotY);
    const s = Math.sin(this.rotY);
    return out.set(this.pos.x + lx * c + lz * s, this.pos.y + ly, this.pos.z - lx * s + lz * c);
  }

  update(game: Game, dt: number) {
    const fires = this.shrine.firePoints();
    for (const [lx, ly, lz] of fires) {
      if (Math.random() < (dt * 20) / fires.length) {
        this.toWorld(lx, ly, lz, fireAt);
        game.fx.fire(fireAt.x, fireAt.y, fireAt.z, fires.length > 1 ? 0.55 : 0.8);
      }
    }
    if (this.village.owner === 'player' && this.village.dancers > 0 && Math.random() < dt * (2 + this.village.dancers)) {
      game.fx.prayer(this.pos.x, this.pos.y + this.shrine.motesHeight, this.pos.z);
    }
  }
}

const fireAt = new THREE.Vector3();

// --------------------------------------------------------------------- field

const CROP_YOUNG = new THREE.Color(0x5fae3a);
const CROP_RIPE = new THREE.Color(0xe3b53f);

export class Field extends Entity {
  readonly kind = 'field' as const;
  village: Village;
  growth: number;
  readonly width = 11;
  readonly depth = 8;
  private crops: THREE.Mesh;
  private soil: THREE.Mesh;
  private mesh: FieldMesh | null = null;
  private cropScale = 0.2;
  private conformSig = NaN;
  private conformTimer = 0;
  private readonly cropMat: THREE.MeshStandardMaterial;
  scorched = 0;

  constructor(village: Village, x: number, y: number, z: number, rotY: number, growth: number) {
    super();
    this.village = village;
    // Flat until the first update, which drapes the soil and rows over the real ground (conform).
    const g = buildFieldMesh(this.width, this.depth, () => 0);
    this.mesh = g;
    this.cropMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.crops = ownedMesh(g.crops, this.cropMat);
    this.soil = ownedMesh(g.soil, MAT.base, false);
    this.object.add(this.soil, this.crops);
    this.object.rotation.y = rotY;
    this.pos.set(x, y, z);
    this.growth = growth;
    this.radius = 6;
    this.flammable = true;
    this.fuel = 7;
    this.refresh();
  }

  get ripe(): boolean {
    return this.growth >= 1 && this.scorched <= 0;
  }

  get topHeight() {
    return 1;
  }

  contains(x: number, z: number): boolean {
    const a = -this.object.rotation.y;
    const dx = x - this.pos.x;
    const dz = z - this.pos.z;
    const lx = dx * Math.cos(a) - dz * Math.sin(a);
    const lz = dx * Math.sin(a) + dz * Math.cos(a);
    return Math.abs(lx) < this.width / 2 && Math.abs(lz) < this.depth / 2;
  }

  randomPoint(out: THREE.Vector3): THREE.Vector3 {
    const a = this.object.rotation.y;
    const lx = (Math.random() - 0.5) * (this.width - 2);
    const lz = (Math.random() - 0.5) * (this.depth - 2);
    return out.set(this.pos.x + lx * Math.cos(a) + lz * Math.sin(a), this.pos.y, this.pos.z - lx * Math.sin(a) + lz * Math.cos(a));
  }

  water(amount: number) {
    if (this.scorched > 0) this.scorched = Math.max(0, this.scorched - amount * 60);
    else this.growth = Math.min(1, this.growth + amount);
    this.refresh();
  }

  harvest(): number {
    if (!this.ripe) return 0;
    this.growth = 0;
    this.refresh();
    return VILLAGE.fieldYield;
  }

  private refresh() {
    const g = this.scorched > 0 ? 0.15 : this.growth;
    this.cropScale = 0.15 + g * 0.95;
    if (this.mesh) setCropHeight(this.mesh, this.cropScale);
    this.cropMat.color.copy(CROP_YOUNG).lerp(CROP_RIPE, this.growth);
    if (this.scorched > 0) this.cropMat.color.setRGB(0.12, 0.1, 0.08);
  }

  /** Terrain height at a local (lx, lz) point of the field, relative to the field origin. */
  private groundAt(game: Game, lx: number, lz: number): number {
    const a = this.object.rotation.y;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return game.terrain.heightAt(this.pos.x + lx * c + lz * s, this.pos.z - lx * s + lz * c) - this.pos.y;
  }

  /** Re-drape the soil and crops over the terrain (when first seen, and if the land changes). */
  private conform(game: Game) {
    const hw = this.width / 2;
    const hd = this.depth / 2;
    const sig = this.groundAt(game, 0, 0) + this.groundAt(game, hw, hd) * 2 + this.groundAt(game, -hw, hd) * 3 + this.groundAt(game, hw, -hd) * 5 + this.groundAt(game, -hw, -hd) * 7;
    if (Math.abs(sig - this.conformSig) < 0.02) return;
    this.conformSig = sig;
    const g = buildFieldMesh(this.width, this.depth, (lx, lz) => this.groundAt(game, lx, lz));
    this.crops.geometry.dispose();
    this.soil.geometry.dispose();
    this.crops.geometry = g.crops;
    this.soil.geometry = g.soil;
    this.mesh = g;
    setCropHeight(g, this.cropScale);
  }

  update(game: Game, dt: number) {
    this.conformTimer -= dt;
    if (this.conformTimer <= 0) {
      this.conformTimer = Number.isNaN(this.conformSig) ? 0.5 : 4;
      this.conform(game);
    }
    if (this.burning) return;
    if (this.scorched > 0) {
      this.scorched -= dt;
      if (this.scorched <= 0) {
        this.flammable = true;
        this.fuel = 7;
      }
      this.refresh();
      return;
    }
    if (this.growth < 1) {
      this.growth = Math.min(1, this.growth + (dt / VILLAGE.fieldGrowTime) * game.modifiers.cropGrowth);
      this.refresh();
    }
  }

  /** Save/load: set growth and scorch outright. */
  restore(growth: number, scorched: number) {
    this.growth = growth;
    this.scorched = scorched;
    this.flammable = scorched <= 0;
    this.refresh();
  }

  onBurntOut() {
    this.growth = 0;
    this.scorched = 25;
    this.flammable = false;
    this.refresh();
  }
}
