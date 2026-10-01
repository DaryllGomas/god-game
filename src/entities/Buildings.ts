import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Villager } from './Villager';
import { Entity, ownedMesh, sharedMesh } from './Entity';
import {
  MAT,
  fieldGeometry,
  flagGeometry,
  foodHeapGeometry,
  houseGeometry,
  logStackGeometry,
  ruinsGeometry,
  scaffoldGeometry,
  storeGeometry,
  worshipGeometry,
} from '../art/Models';
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

  constructor(village: Village, x: number, y: number, z: number, rotY: number, seed: number, built: boolean) {
    super();
    this.village = village;
    this.seed = seed;
    const g = houseGeometry(seed);
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
    const lit = game.sky.daylight < 0.55 && this.residents.some((r) => r.isInside);
    this.windows.material = lit ? WINDOW_LIT : WINDOW_DARK;
    if (this.complete && !this.burning && this.health < 1 && !game.sky.isNight) {
      this.health = Math.min(1, this.health + dt * 0.01);
    }
    if (this.complete && game.sky.daylight < 0.55 && this.residents.length > 0 && Math.random() < dt * 0.6) {
      // Chimney smoke in the evening.
      const a = this.object.rotation.y;
      game.fx.smoke(this.pos.x + Math.cos(a) * 1.3, this.pos.y + 7.2, this.pos.z - Math.sin(a) * 1.3, 0.5, 0.55);
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

const worshipGeo = worshipGeometry();

export class WorshipSite extends Entity {
  readonly kind = 'worship' as const;
  village: Village;
  readonly ringRadius = 6.2;

  constructor(village: Village, x: number, y: number, z: number) {
    super();
    this.village = village;
    this.object.add(sharedMesh(worshipGeo.site, MAT.base), sharedMesh(worshipGeo.fire, MAT.base));
    this.object.children[1].position.set(0, 0, 4.2);
    this.pos.set(x, y, z);
    this.radius = 8;
  }

  get topHeight() {
    return 9;
  }

  /** Dancers circle the totem; slot i of n at the current time. */
  slotPosition(i: number, n: number, time: number, out: THREE.Vector3): THREE.Vector3 {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + time * 0.35;
    return out.set(this.pos.x + Math.cos(a) * this.ringRadius, this.pos.y, this.pos.z + Math.sin(a) * this.ringRadius);
  }

  update(game: Game, dt: number) {
    const fx = this.pos.x;
    const fz = this.pos.z + 4.2;
    if (Math.random() < dt * 20) game.fx.fire(fx, this.pos.y + 0.8, fz, 0.8);
    if (this.village.owner === 'player' && this.village.dancers > 0 && Math.random() < dt * (2 + this.village.dancers)) {
      game.fx.prayer(this.pos.x, this.pos.y + 2, this.pos.z);
    }
  }
}

// --------------------------------------------------------------------- field

const CROP_YOUNG = new THREE.Color(0x5fae3a);
const CROP_RIPE = new THREE.Color(0xe3b53f);

export class Field extends Entity {
  readonly kind = 'field' as const;
  village: Village;
  growth: number;
  readonly width = 11;
  readonly depth = 8;
  private readonly crops: THREE.Mesh;
  private readonly cropMat: THREE.MeshStandardMaterial;
  scorched = 0;

  constructor(village: Village, x: number, y: number, z: number, rotY: number, growth: number) {
    super();
    this.village = village;
    const g = fieldGeometry(this.width, this.depth);
    this.cropMat = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 0.9 });
    this.crops = ownedMesh(g.crops, this.cropMat);
    this.object.add(ownedMesh(g.soil, MAT.base, false), this.crops);
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
    this.crops.scale.set(1, 0.15 + g * 0.95, 1);
    this.cropMat.color.copy(CROP_YOUNG).lerp(CROP_RIPE, this.growth);
    if (this.scorched > 0) this.cropMat.color.setRGB(0.12, 0.1, 0.08);
  }

  update(game: Game, dt: number) {
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
