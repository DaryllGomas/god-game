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
/** A lived-in home's windows glow softly even by day (v0.6 polish 3). */
const WINDOW_WARM = new THREE.MeshStandardMaterial({ color: 0x4a3418, emissive: 0xffa640, emissiveIntensity: 0.55, roughness: 0.6 });
const WINDOW_DARK = new THREE.MeshStandardMaterial({ color: 0x2a2218, roughness: 0.8 });
/** A family that has come to believe in you (a village not yet yours): its windows take the gold of your light. */
const WINDOW_GOLD = new THREE.MeshStandardMaterial({ color: 0x5a4418, emissive: 0xffd37a, emissiveIntensity: 0.75, roughness: 0.6 });
/** A family ruled by fear (they knelt when you took Vexahl's ring): cold ember windows, not gold. */
const WINDOW_FEAR = new THREE.MeshStandardMaterial({ color: 0x2a1018, emissive: 0xff4a3a, emissiveIntensity: 0.6, roughness: 0.6 });
const scaffoldGeo = scaffoldGeometry();

// ------------------------------------------------------------- believing home

/** The soft gold ring of light on the ground round a believing home (the game's gold-ring language): size (m), peak opacity. */
const HALO_SIZE = 13;
const HALO_PEAK = 0.85;
/** Seconds to fade in or out, and the swell when the whole village joins you. */
const HALO_FADE = 1.6;
const HALO_FLARE = 3.5;
const haloTexs = new Map<string, THREE.Texture>();
const haloGeo = new THREE.PlaneGeometry(HALO_SIZE, HALO_SIZE).rotateX(-Math.PI / 2);
/** Gold (believing), or a cold violet ring for a family ruled by fear. */
const HALO_RGB = { gold: [255, 214, 128], fear: [150, 80, 230] } as const;
type HaloLook = keyof typeof HALO_RGB;
/** A faint wash inside, a thin bright ring near the edge, soft on both sides of it (gold, or violet for fear). */
function haloTexture(look: HaloLook = 'gold'): THREE.Texture {
  const have = haloTexs.get(look);
  if (have) return have;
  const [cr, cg, cb] = HALO_RGB[look];
  const N = 256;
  const c = document.createElement('canvas');
  c.width = c.height = N;
  const x = c.getContext('2d')!;
  const img = x.createImageData(N, N);
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const r = Math.hypot(i + 0.5 - N / 2, j + 0.5 - N / 2) / (N / 2);
      const ring = Math.exp(-(((r - 0.8) / 0.06) ** 2));
      const glow = Math.exp(-(((r - 0.8) / 0.16) ** 2)) * 0.35;
      const wash = 0.3 * (1 - smooth(0.5, 0.85, r));
      const a = Math.min(1, ring + glow + wash) * (1 - smooth(0.9, 1, r));
      const k = (j * N + i) * 4;
      img.data[k] = cr;
      img.data[k + 1] = cg;
      img.data[k + 2] = cb;
      img.data[k + 3] = Math.round(a * 255);
    }
  x.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  haloTexs.set(look, tex);
  return tex;
}
/** A small soft light that hangs over a believing home's roof, so it reads from afar (gold, gently breathing; an ember for fear). */
const moteTexs = new Map<string, THREE.Texture>();
const MOTE_STOPS: Record<HaloLook, string[]> = {
  gold: ['rgba(255,246,220,1)', 'rgba(255,224,150,0.85)', 'rgba(255,205,110,0.22)', 'rgba(255,200,110,0)'],
  fear: ['rgba(255,220,200,1)', 'rgba(255,96,58,0.85)', 'rgba(170,60,150,0.25)', 'rgba(120,40,160,0)'],
};
function moteTexture(look: HaloLook = 'gold'): THREE.Texture {
  const have = moteTexs.get(look);
  if (have) return have;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const x = c.getContext('2d')!;
  const g = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  const st = MOTE_STOPS[look];
  g.addColorStop(0, st[0]);
  g.addColorStop(0.18, st[1]);
  g.addColorStop(0.5, st[2]);
  g.addColorStop(1, st[3]);
  x.fillStyle = g;
  x.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  moteTexs.set(look, tex);
  return tex;
}
const MOTE_SIZE = 5;
const MOTE_PEAK = 1;

function smooth(a: number, b: number, v: number) {
  const t = Math.min(1, Math.max(0, (v - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

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
  /** Its family believes in you (a village not yet yours): glows gold (see setBelieving). */
  believing = false;
  /** Its family is ruled by fear (the village knelt when you took Vexahl's ring): a cold violet-ember glow (see setFear). */
  fear = false;
  private look: HaloLook = 'gold';
  private glow = 0;
  private flare = 0;
  private halo: THREE.Mesh | null = null;
  private mote: THREE.Sprite | null = null;

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

  /**
   * Households join one by one (2026-10-14): a home whose family has come to believe glows a soft gold, its windows
   * and a pool of light round it. `flare`: the whole village just became yours, so the light swells and fades.
   */
  setBelieving(on: boolean, flare = false) {
    this.believing = on;
    if (flare && this.complete) this.flare = HALO_FLARE;
  }

  /**
   * The ring (2026-10-15): a family that knelt out of fear glows cold violet and ember instead of gold. `flare`: the
   * moment the village kneels.
   */
  setFear(on: boolean, flare = false) {
    this.fear = on;
    if (flare && this.complete) this.flare = HALO_FLARE;
  }

  private updateGlow(dt: number) {
    // Fear wins over the gold (a village of yours is never "believing"; the two never both hold).
    const look: HaloLook = this.fear ? 'fear' : 'gold';
    if (look !== this.look) {
      this.look = look;
      if (this.halo) (this.halo.material as THREE.MeshBasicMaterial).map = haloTexture(look);
      if (this.mote) (this.mote.material as THREE.SpriteMaterial).map = moteTexture(look);
    }
    const want = (this.believing || this.fear) && this.complete ? 1 : 0;
    this.glow += Math.sign(want - this.glow) * Math.min(Math.abs(want - this.glow), dt / HALO_FADE);
    if (this.flare > 0) this.flare = Math.max(0, this.flare - dt);
    const f = this.flare > 0 ? Math.sin((this.flare / HALO_FLARE) * Math.PI) * 1.6 : 0;
    const k = Math.max(this.glow, f);
    if (k <= 0.001) {
      if (this.halo) this.halo.visible = false;
      if (this.mote) this.mote.visible = false;
      return;
    }
    if (!this.halo) {
      const mat = new THREE.MeshBasicMaterial({
        map: haloTexture(this.look),
        transparent: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -3,
        polygonOffsetUnits: -3,
        fog: false,
      });
      this.halo = new THREE.Mesh(haloGeo, mat);
      this.halo.position.y = 0.25;
      this.halo.renderOrder = 4;
      this.halo.castShadow = this.halo.receiveShadow = false;
      this.object.add(this.halo);
    }
    if (!this.mote) {
      this.mote = new THREE.Sprite(new THREE.SpriteMaterial({ map: moteTexture(this.look), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
      this.mote.scale.setScalar(MOTE_SIZE);
      this.mote.renderOrder = 5;
      this.object.add(this.mote);
    }
    this.halo.visible = this.mote.visible = true;
    const t = performance.now() * 0.001;
    const breathe = 0.88 + 0.12 * Math.sin(t * 1.2 + this.seed);
    (this.halo.material as THREE.MeshBasicMaterial).opacity = Math.min(1, k * HALO_PEAK * breathe);
    (this.mote.material as THREE.SpriteMaterial).opacity = Math.min(1, k * MOTE_PEAK * breathe);
    this.mote.position.set(0, 9 + Math.sin(t * 0.9 + this.seed * 0.7) * 0.35, 0);
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
    this.windows.material = this.fear && this.complete ? WINDOW_FEAR : this.believing && this.complete ? WINDOW_GOLD : lit ? WINDOW_LIT : this.complete && this.residents.length > 0 ? WINDOW_WARM : WINDOW_DARK;
    this.updateGlow(dt);
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
  private landVersion = -1;
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

  /** The draped soil geometry (for the ground-contact check). */
  soilGeometry(): THREE.BufferGeometry {
    return this.soil.geometry;
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

  /** Re-fit to the land now (the terrain under it changed). */
  refit(game: Game) {
    this.conform(game);
  }

  onAdded(game: Game) {
    this.conform(game);
  }

  /** Re-drape if the ground under the field was edited since it last fitted (a pad was levelled nearby). */
  syncLand(game: Game) {
    const t = game.terrain;
    if (this.landVersion === t.version) return;
    if (t.changedNear(this.landVersion, this.pos.x, this.pos.z, Math.hypot(this.width, this.depth) / 2 + 1)) this.conform(game);
    else this.landVersion = t.version;
  }

  /** Re-drape the soil and crops over the terrain. */
  private conform(game: Game) {
    this.landVersion = game.terrain.version;
    // The soil is a grid of straight facets over a land of creases: take the highest ground within a few
    // centimetres of each vertex, so a facet never dips under the surface at a ridge (it floats a hair in a hollow).
    const H = 0.14;
    const g = buildFieldMesh(this.width, this.depth, (lx, lz) =>
      Math.max(this.groundAt(game, lx, lz), this.groundAt(game, lx + H, lz), this.groundAt(game, lx - H, lz), this.groundAt(game, lx, lz + H), this.groundAt(game, lx, lz - H)),
    );
    this.crops.geometry.dispose();
    this.soil.geometry.dispose();
    this.crops.geometry = g.crops;
    this.soil.geometry = g.soil;
    this.mesh = g;
    setCropHeight(g, this.cropScale);
  }

  update(game: Game, dt: number) {
    this.syncLand(game);
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
