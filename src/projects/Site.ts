import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { Entity, ownedMesh, sharedMesh } from '../entities/Entity';
import { MAT, foodHeapGeometry, logStackGeometry } from '../art/Models';
import { VILLAGE } from '../config';
import { clamp, damp } from '../util/math';
import {
  CARRY,
  DEFS,
  NEUTRAL_GIFT_BELIEF,
  RESERVE,
  STONE_PER_ROCK_AREA,
  type Needs,
  type ProjectDef,
  type Res,
} from './defs';
import { GLOW, festivalModel, scaffoldModel, stoneHeapGeometry, templeModel, wellModel, type LayeredModel } from './ProjectModels';
import { WonderVisual } from './Wonder';

const logsGeo = logStackGeometry();
const foodGeo = foodHeapGeometry();
const stonesGeo = stoneHeapGeometry();

const tmpA = new THREE.Vector3();

/** Pieces that depend on the kind of project. Both the village buildings and the Wonder fit this. */
interface Visual {
  group: THREE.Group;
  /** Called every frame with the eased progress (0..1). */
  update(game: Game, site: Site, dt: number, shown: number): void;
}

/** Scaffold, a rising building, lanterns that light at dusk, and heaps of the materials delivered. */
class BuildingVisual implements Visual {
  readonly group = new THREE.Group();
  private readonly scaffold: THREE.Mesh;
  private readonly base: THREE.Mesh;
  private readonly upper: THREE.Mesh;
  private readonly glow: THREE.Mesh | null;
  private readonly heaps: Record<Res, THREE.Mesh>;
  private flameT = 0;

  constructor(def: ProjectDef) {
    const model: LayeredModel = def.id === 'well' ? wellModel() : def.id === 'temple' ? templeModel() : festivalModel();
    this.scaffold = ownedMesh(scaffoldModel(def.radius, def.height * 0.75, def.radius > 6 ? 6 : 4), MAT.base);
    this.base = ownedMesh(model.base, MAT.base);
    this.upper = ownedMesh(model.upper, MAT.base);
    this.glow = model.glow ? ownedMesh(model.glow, GLOW, false) : null;
    this.group.add(this.scaffold, this.base, this.upper);
    if (this.glow) this.group.add(this.glow);

    const edge = def.radius * 0.95 + 2.2;
    const mk = (geo: THREE.BufferGeometry, angle: number, scale: number) => {
      const m = sharedMesh(geo, MAT.base);
      m.position.set(Math.cos(angle) * edge, 0, Math.sin(angle) * edge);
      m.rotation.y = angle * 2;
      m.userData.scale = scale;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    this.heaps = { wood: mk(logsGeo, 2.5, 1), stone: mk(stonesGeo, 3.5, 1), food: mk(foodGeo, 4.4, 1) };
  }

  update(game: Game, site: Site, dt: number, shown: number) {
    const done = site.complete;
    this.scaffold.visible = !done;
    this.base.visible = done || shown > 0.02;
    this.upper.visible = done || shown >= 0.1;
    const rise = done ? 1 : clamp((shown - 0.08) / 0.92, 0.04, 1);
    this.upper.scale.y = rise;
    if (this.glow) this.glow.visible = done;
    for (const res of ['wood', 'stone', 'food'] as Res[]) {
      const need = site.def.needs[res];
      const have = site.have[res];
      const h = this.heaps[res];
      h.visible = !done && need > 0 && have > 0.5;
      if (h.visible) h.scale.setScalar(0.5 + 0.9 * clamp(have / need, 0, 1));
    }
    // Braziers on a finished temple, lanterns at dusk on a festival green.
    if (done && this.glow && game.sky.daylight < 0.6) {
      this.flameT -= dt;
      if (this.flameT <= 0) {
        this.flameT = 0.12;
        if (site.def.id === 'temple') {
          for (const sx of [-1, 1]) {
            site.toWorld(sx * 5.2, 2.7, 4.0, tmpA);
            game.fx.fire(tmpA.x, tmpA.y, tmpA.z, 0.35);
          }
        }
      }
    }
  }
}

class WonderWrapper implements Visual {
  readonly group: THREE.Group;
  readonly wonder = new WonderVisual();
  private heaps: THREE.Mesh[] = [];
  constructor() {
    this.group = this.wonder.group;
    const mk = (geo: THREE.BufferGeometry, angle: number) => {
      const m = sharedMesh(geo, MAT.base);
      m.position.set(Math.cos(angle) * 26, 0, Math.sin(angle) * 26);
      m.rotation.y = angle * 2;
      m.visible = false;
      this.group.add(m);
      return m;
    };
    this.heaps = [mk(logsGeo, 2.5), mk(stonesGeo, 3.5), mk(foodGeo, 4.4)];
  }

  update(game: Game, site: Site, dt: number, shown: number) {
    const night = 1 - clamp(game.sky.daylight * 1.4, 0, 1);
    const lit = this.wonder.update(dt, shown, site.complete, night);
    if (lit && !site.complete) {
      this.wonder.litPoint(tmpA);
      site.toWorld(tmpA.x, tmpA.y, tmpA.z, tmpA);
      game.fx.sparkle(tmpA.x, tmpA.y, tmpA.z, 24, 0xbff0ff, 3);
      game.audio.runeLit(site.pos);
    }
    (['wood', 'stone', 'food'] as Res[]).forEach((res, i) => {
      const need = site.def.needs[res];
      const h = this.heaps[i];
      h.visible = !site.complete && need > 0 && site.have[res] > 1;
      if (h.visible) h.scale.setScalar(1.2 + 2.2 * clamp(site.have[res] / need, 0, 1));
    });
  }
}

// ------------------------------------------------------------------- the site

export type GiftSource = 'gift' | 'builder' | 'quarry';

/**
 * A construction site for a village project (well, temple, festival green) or the Wonder.
 * It collects wood and food from builders and stone from you: boulders you drop or throw on it,
 * or that the golem throws there, are absorbed as stone. It grows from stakes and scaffold into
 * the finished building as the materials arrive.
 */
export class Site extends Entity {
  readonly kind = 'site' as const;
  readonly village: Village;
  readonly def: ProjectDef;
  readonly have: Needs = { wood: 0, stone: 0, food: 0 };
  /** Materials flying in from another village's builders. */
  readonly pending: Needs = { wood: 0, stone: 0, food: 0 };
  /** Set by the project system when it has finished and applied its effect. */
  complete = false;
  /** Fired when another village's builder offers something: the system flies it over the island. */
  onRemote: ((from: Village, res: Res, amount: number) => void) | null = null;
  /** Something was just given: for the UI to flash. */
  lastGiftAt = -99;
  /** How much the player has given by hand: a village only thanks you for a project you helped with. */
  given = 0;
  shown = 0;
  readonly ringRadius = 6;
  private readonly visual: Visual;
  private readonly seen = new WeakSet<Entity>();
  private readonly rotY: number;

  constructor(village: Village, def: ProjectDef, x: number, y: number, z: number, rotY = 0) {
    super();
    this.village = village;
    this.def = def;
    this.rotY = rotY;
    this.visual = def.id === 'wonder' ? new WonderWrapper() : new BuildingVisual(def);
    this.object.add(this.visual.group);
    this.object.rotation.y = rotY;
    this.pos.set(x, y, z);
    this.radius = def.radius;
    this.flammable = false;
  }

  get topHeight() {
    return this.def.height;
  }

  get wonderVisual(): WonderVisual | null {
    return this.visual instanceof WonderWrapper ? this.visual.wonder : null;
  }

  get fraction(): number {
    let got = 0;
    let all = 0;
    for (const r of ['wood', 'stone', 'food'] as Res[]) {
      const n = this.def.needs[r];
      all += n;
      got += Math.min(n, this.have[r]);
    }
    return all > 0 ? got / all : 1;
  }

  /** Every material is in. */
  get full(): boolean {
    return (['wood', 'stone', 'food'] as Res[]).every((r) => this.have[r] >= this.def.needs[r] - 0.01);
  }

  /** Room still open for `res` once what is already flying in is counted. */
  open(res: Res): number {
    return Math.max(0, this.def.needs[res] - this.have[res] - this.pending[res]);
  }

  /** Place in the festival dance ring (same contract as WorshipSite). */
  slotPosition(i: number, n: number, time: number, out: THREE.Vector3): THREE.Vector3 {
    const a = (i / Math.max(1, n)) * Math.PI * 2 + time * 0.35;
    return out.set(this.pos.x + Math.cos(a) * this.ringRadius, this.pos.y, this.pos.z + Math.sin(a) * this.ringRadius);
  }

  /** Local point (x, y, z) of the site's model to world space. */
  toWorld(lx: number, ly: number, lz: number, out: THREE.Vector3): THREE.Vector3 {
    const c = Math.cos(this.rotY);
    const s = Math.sin(this.rotY);
    return out.set(this.pos.x + lx * c + lz * s, this.pos.y + ly, this.pos.z - lx * s + lz * c);
  }

  // -------------------------------------------------------- builders' side

  /** Builders (project tasks) currently working for `village` on this site. */
  builders(game: Game, village: Village): number {
    let n = 0;
    for (const v of village.villagers) if (v.task.type === 'project' && v.task.site === this) n++;
    void game;
    return n;
  }

  /** Amount of `res` already on its way in villagers' arms (any village). */
  inTransit(game: Game, res: Res): number {
    let n = 0;
    for (const v of game.villages) {
      for (const vl of v.villagers) {
        const t = vl.task;
        if (t.type === 'project' && t.site === this && t.res === res) n += vl.carrying?.amount ?? CARRY;
      }
    }
    return n;
  }

  /** How much `v`'s builder should fetch of `res` (0 if the store can't spare any, or none is needed). */
  loadFor(game: Game, v: Village, res: Res, includeTransit = true): number {
    const need = this.def.needs[res];
    if (need <= 0 || res === 'stone') return 0;
    const rem = this.open(res) - (includeTransit ? this.inTransit(game, res) : 0);
    const spare = (res === 'wood' ? v.store.wood : v.store.food) - RESERVE[res];
    return Math.floor(Math.min(CARRY, rem, spare));
  }

  /** The material this village's next builder should carry, or null when nothing useful can be fetched. */
  wantedFor(game: Game, v: Village): 'wood' | 'food' | null {
    let best: 'wood' | 'food' | null = null;
    let bestScore = 0;
    for (const res of ['wood', 'food'] as const) {
      const need = this.def.needs[res];
      if (need <= 0) continue;
      if (this.loadFor(game, v, res) < 3) continue;
      const score = this.open(res) / need + Math.random() * 0.1;
      if (score > bestScore) {
        bestScore = score;
        best = res;
      }
    }
    return best;
  }

  /** Where `v`'s builder stands to work: the site itself, or (for another village) its own totem. */
  approachPoint(v: Village, from: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
    const target = v === this.village ? this.pos : v.worship.pos;
    const r = v === this.village ? Math.min(this.def.radius * 0.8, this.def.radius - 1.5) + 0.6 : 3;
    out.copy(from).sub(target).setY(0);
    if (out.lengthSq() < 0.01) out.set(1, 0, 0);
    return out.normalize().multiplyScalar(r).add(target);
  }

  /** A builder hands over what they carry. */
  deliver(game: Game, from: Village, res: Res, amount: number) {
    if (from === this.village || !this.onRemote) {
      this.add(game, res, amount, 'builder');
      return;
    }
    this.pending[res] += amount;
    this.onRemote(from, res, amount);
  }

  /** A remote delivery arrived. */
  land(game: Game, res: Res, amount: number) {
    this.pending[res] = Math.max(0, this.pending[res] - amount);
    this.add(game, res, amount, 'builder');
  }

  /** Add material. Returns how much was taken (the rest overflows). */
  add(game: Game, res: Res, amount: number, source: GiftSource): number {
    if (this.complete) return 0;
    const room = Math.max(0, this.def.needs[res] - this.have[res]);
    const a = Math.min(amount, room);
    if (a <= 0) return 0;
    this.have[res] += a;
    this.lastGiftAt = game.time;
    const top = this.def.height * 0.45;
    if (source === 'builder') game.fx.dust(this.pos.x, this.pos.y + 1, this.pos.z, 5, 0.6, res === 'food' ? 0xe3c060 : 0xc9a070);
    if (source === 'gift') {
      this.given += a;
      game.fx.sparkle(this.pos.x, this.pos.y + top, this.pos.z, 20, 0xfff0b0, Math.min(6, this.def.radius));
      this.rewardGift(game, a);
    }
    return a;
  }

  /** Giving to a neutral village's dream wins their hearts; your own villages feel a little warmer. */
  private rewardGift(game: Game, amount: number) {
    const v = this.village;
    game.player.shiftAlignment(0.004);
    if (v.owner === 'player') {
      v.belief = Math.min(100, v.belief + amount * 0.05);
      return;
    }
    const gain = amount * NEUTRAL_GIFT_BELIEF;
    v.belief += gain;
    game.floatText(this.pos.x, this.pos.y + this.def.height + 4, this.pos.z, `+${gain.toFixed(1)} belief`, '#f4cf73');
    if (v.belief >= VILLAGE.convertAt) v.convert(game);
  }

  // ------------------------------------------------------------- per frame

  update(game: Game, dt: number) {
    if (!this.complete) this.absorb(game);
    const target = this.complete ? 1 : this.fraction;
    this.shown += (target - this.shown) * damp(1.6, dt);
    if (Math.abs(target - this.shown) < 0.002) this.shown = target;
    this.visual.update(game, this, dt, this.shown);
  }

  /**
   * Boulders (and trees, wood, food) the Hand drops or throws onto the site are taken in as
   * material. Anything that has been airborne, rolling or held inside the footprint counts;
   * things that were already lying there are left alone.
   */
  private absorb(game: Game) {
    const r = this.def.radius + 0.5;
    game.forEachNear(this.pos.x, this.pos.z, r, (e) => {
      if (!e.alive) return;
      let res: Res;
      switch (e.kind) {
        case 'rock':
          res = 'stone';
          break;
        case 'tree':
          res = 'wood';
          break;
        case 'wood':
          res = 'wood';
          break;
        case 'food':
          res = 'food';
          break;
        default:
          return;
      }
      if (this.open(res) < 0.5) return;
      if (e.held || e.airborne || e.rolling) {
        this.seen.add(e);
        return;
      }
      if (!this.seen.has(e)) return;
      let amount: number;
      if (e.kind === 'rock') amount = Math.max(4, Math.round(e.radius * e.radius * STONE_PER_ROCK_AREA));
      else if (e.kind === 'tree') {
        const t = e as unknown as { wood: number; charred: boolean };
        if (t.charred || t.wood < 3) return;
        amount = Math.round(t.wood);
      } else amount = Math.round((e as unknown as { amount: number }).amount);
      if (amount <= 0) return;
      const taken = this.add(game, res, amount, 'gift');
      if (taken <= 0) return;
      this.seen.delete(e);
      game.fx.dust(e.pos.x, e.pos.y, e.pos.z, 14, 0.9, res === 'stone' ? 0xb8b1a4 : 0xc9a070);
      game.floatText(this.pos.x, this.pos.y + 6, this.pos.z, `+${Math.round(taken)} ${res}`, res === 'stone' ? '#e4dccb' : res === 'wood' ? '#e8c79a' : '#ffe9a8');
      if (res === 'stone') game.audio.stoneSet(this.pos, e.radius);
      else game.audio.chime(this.pos);
      game.remove(e);
    });
  }

  // --------------------------------------------------------------- tooltip

  progressText(): string {
    const parts: string[] = [];
    for (const [res, label] of [
      ['wood', 'wood'],
      ['stone', 'stone'],
      ['food', 'food'],
    ] as [Res, string][]) {
      const n = this.def.needs[res];
      if (n > 0) parts.push(`${Math.floor(this.have[res])}/${n} ${label}`);
    }
    return parts.join(' · ');
  }

  tooltip(): string {
    const d = this.def;
    if (this.complete) {
      return `<div class="tip-title">${d.name}${d.id === 'wonder' ? '' : `, ${this.village.name}`}</div><div class="tip-body">${d.effect}</div>`;
    }
    const hint = d.needs.stone > 0 ? `<div class="tip-hint">Drop boulders here for stone</div>` : '';
    return `<div class="tip-title">${d.name} (building)</div><div class="tip-body">${this.progressText()}</div>${hint}`;
  }
}

export function defOf(id: keyof typeof DEFS): ProjectDef {
  return DEFS[id];
}
