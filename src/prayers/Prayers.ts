import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Villager } from '../entities/Villager';
import type { House } from '../entities/Buildings';
import { SEA_LEVEL, VILLAGE } from '../config';
import { rng } from '../util/rng';

// ------------------------------------------------------------- tuning knobs

/** Seconds of game time before the home village's onboarding prayer (easy timber). */
export const FIRST_PRAYER_AT = 8;
/** First prayer of the other villages is staggered inside this window (game seconds). */
const OTHER_FIRST = [50, 110] as const;
/** Gap between a village's prayers (game seconds). */
const PRAYER_GAP = [90, 180] as const;
/** At most this many active prayers per village, and across the whole island. */
const MAX_PER_VILLAGE = 2;
const MAX_TOTAL = 4;
/** Never two new prayers closer together than this, island-wide. */
const MIN_GAP_ALL = 20;
/** Unanswered prayers fade away after this long (game seconds). */
const EXPIRE = [300, 420] as const;
/** The first (onboarding) prayer lingers longer. */
const FIRST_EXPIRE = 720;
/** A lost villager finds their own way home after this long. */
const LOST_TIMEOUT = 330;
/** Where the lost villager waits, in metres from the village centre. */
const LOST_DIST = [60, 110] as const;
/** A burning house must burn this long before the village prays for help. */
const FIRE_DELAY = 4;
/** Rewards: faith in an owned village / belief in a neutral one, and prayer power. */
const BELIEF_OWNED = 8;
const BELIEF_NEUTRAL = 28;
const POWER = { timber: 20, food: 20, rain: 25, lost: 35, fire: 30, sign: 15, project: 60 } as const;
/** Miracles that count as "a sign". Fire is left out: nobody asks to be burned. */
const SIGN_MIRACLES = new Set(['water', 'food']);

// -------------------------------------------------------------------- types

/** 'project' is a village's long-term dream (well, temple, Wonder): it never expires and doesn't count against the caps. */
export type PrayerKind = 'timber' | 'food' | 'rain' | 'lost' | 'fire' | 'sign' | 'project';

export interface Prayer {
  readonly id: number;
  readonly kind: PrayerKind;
  readonly village: Village;
  readonly icon: string;
  readonly text: string;
  readonly thanks: string;
  readonly bornAt: number;
  expiresAt: number;
  /** Units of wood/food wanted (0 for the others). */
  need: number;
  progress: number;
  villager?: Villager;
  childName?: string;
  house?: House;
}

export interface PrayerListener {
  added(p: Prayer): void;
  /** Answered. */
  fulfilled(p: Prayer): void;
  /** Faded away unanswered (or no longer relevant). */
  gone(p: Prayer): void;
}

const ICON: Record<PrayerKind, string> = { timber: '🪵', food: '🍞', rain: '🌧️', lost: '🧒', fire: '🔥', sign: '✨', project: '🏗️' };

const TEXT: Record<PrayerKind, string[]> = {
  timber: [
    'We need wood for a new house.',
    'Our roof is leaky. Could we have some timber?',
    'A few good logs would mean the world to us.',
    'Wood, please! The carpenters are twiddling their thumbs.',
  ],
  food: [
    'Our bellies rumble. Some food, please?',
    'The pantry is looking very sad.',
    'Something to eat would be lovely.',
    'Bread, great one? Any bread at all?',
  ],
  rain: [
    'The fields are parched.',
    'Our crops are thirsty. Rain, please?',
    'Just a little rain? The soil is so dry.',
  ],
  lost: [
    '{name} wandered into the woods!',
    'Little {name} is lost! Please find them!',
    '{name} followed a butterfly and never came back.',
  ],
  fire: ['Fire! Help us!', 'Our house is burning!', 'Water! Quick, please!'],
  sign: [
    'Show us you are listening.',
    'Are you there? Give us a sign.',
    'A little wonder, great one?',
  ],
  project: [],
};

const THANKS = ['Thank you, great one!', 'You heard us!', 'Bless you!', 'Oh, thank you!', 'We knew you would come!'];

const CHILD_NAMES = ['Pip', 'Wren', 'Moss', 'Tilly', 'Bram', 'Nettle', 'Posy', 'Fennel', 'Dot', 'Barley'];

// ----------------------------------------------------------------- the logic

export class Prayers {
  readonly active: Prayer[] = [];
  /** How many prayers the player has answered so far. */
  answered = 0;
  private nextId = 1;
  private readonly nextAt = new Map<Village, number>();
  private readonly lastKind = new Map<Village, PrayerKind>();
  private readonly burnSince = new Map<House, number>();
  private listener: PrayerListener | null = null;
  private lastSpawn = -999;
  private firstDone = false;
  private tick = 0;
  private readonly tmp = new THREE.Vector3();

  constructor(private readonly game: Game) {
    for (const v of game.villages) {
      this.nextAt.set(v, v.isHome ? FIRST_PRAYER_AT : rng.range(OTHER_FIRST[0], OTHER_FIRST[1]));
    }
    const ev = game.events;
    ev.on('gift', ({ village, kind, amount }) => {
      for (const p of [...this.active]) {
        if (p.village !== village || p.need <= 0) continue;
        if ((p.kind === 'timber' && kind === 'wood') || (p.kind === 'food' && kind === 'food')) {
          p.progress += amount;
          if (p.progress >= p.need) this.fulfil(p);
        }
      }
    });
    ev.on('rainedOn', ({ village }) => this.answerFirst('rain', village));
    ev.on('miracle', ({ id, x, z }) => {
      if (!SIGN_MIRACLES.has(id)) return;
      for (const p of [...this.active]) if (p.kind === 'sign' && p.village.contains(x, z, 1.3)) this.fulfil(p);
    });
    ev.on('place', ({ entity, x, z }) => {
      for (const p of [...this.active]) {
        if (p.kind === 'lost' && p.villager === entity && p.village.contains(x, z, 1.4)) this.fulfil(p);
      }
    });
    ev.on('villagerDied', ({ villager }) => this.dropLost(villager));
    ev.on('villagerJoined', ({ villager }) => this.dropLost(villager));
  }

  /**
   * Save/load: only the pacing survives. Active prayers are dropped (they come back as new ones soon),
   * which is why restored villagers are never left "lost" (see systems/Save.ts).
   */
  save() {
    return {
      answered: this.answered,
      firstDone: this.firstDone,
      nextAt: this.game.villages.map((v) => Math.round((this.nextAt.get(v) ?? 0) * 10) / 10),
    };
  }

  load(data: unknown) {
    const d = data as { answered?: number; firstDone?: boolean; nextAt?: number[] };
    if (typeof d.answered === 'number') this.answered = d.answered;
    if (typeof d.firstDone === 'boolean') this.firstDone = d.firstDone;
    this.game.villages.forEach((v, i) => {
      const t = d.nextAt?.[i];
      if (typeof t === 'number') this.nextAt.set(v, t);
    });
  }

  setListener(l: PrayerListener) {
    this.listener = l;
  }

  forVillage(v: Village): Prayer[] {
    return this.active.filter((p) => p.village === v);
  }

  /** Ordinary prayers (long-term project dreams don't count against the caps). */
  private regular(v?: Village): Prayer[] {
    return this.active.filter((p) => p.kind !== 'project' && (!v || p.village === v));
  }

  /**
   * A village's project dream, shown as a bubble with a progress bar. Never expires; the
   * projects plugin keeps `progress` (0..100) up to date and calls `fulfil` when it is built.
   */
  spawnProject(v: Village, icon: string, text: string, thanks: string): Prayer {
    const p: Prayer = {
      id: this.nextId++,
      kind: 'project',
      village: v,
      icon,
      text,
      thanks,
      bornAt: this.game.time,
      expiresAt: Infinity,
      need: 100,
      progress: 0,
    };
    this.active.push(p);
    this.game.audio.prayerArrive();
    this.listener?.added(p);
    return p;
  }

  /** Test/debug hook: create a prayer right now. */
  spawnNow(v: Village, kind: PrayerKind): Prayer | null {
    return this.spawn(v, kind, true);
  }

  // ------------------------------------------------------------- simulation

  update(dt: number) {
    this.tick += dt;
    if (this.tick < 0.5) return;
    const step = this.tick;
    this.tick = 0;
    const g = this.game;
    const now = g.time;

    // Lost villagers stay put, but shouldn't starve while waiting to be found.
    for (const p of this.active) {
      if (p.kind === 'lost' && p.villager && !p.villager.dead) p.villager.hunger = Math.min(p.villager.hunger, 0.55);
    }

    // Fires: pray when a house has burned for a few seconds; answered once it's out.
    for (const v of g.villages) {
      for (const h of v.houses) {
        if (h.burning && !h.destroyed) {
          const since = this.burnSince.get(h) ?? now;
          this.burnSince.set(h, since);
          if (now - since >= FIRE_DELAY && !this.active.some((p) => p.house === h)) this.spawn(v, 'fire', true, h);
        } else this.burnSince.delete(h);
      }
    }
    for (const p of [...this.active]) {
      if (p.kind !== 'fire' || !p.house) continue;
      if (p.house.destroyed || !p.house.alive) this.drop(p);
      else if (!p.house.burning) this.fulfil(p);
    }

    // Expiry (gentle: no penalty, the bubble just fades).
    for (const p of [...this.active]) {
      if (now < p.expiresAt) continue;
      if (p.kind === 'lost' && p.villager?.held) continue;
      if (p.kind === 'lost') {
        g.floatText(p.village.center.x, p.village.center.y + 10, p.village.center.z, `${p.childName} found their own way home`, '#cfe6ff');
      }
      this.drop(p);
    }

    // New prayers.
    if (this.regular().length >= MAX_TOTAL || now - this.lastSpawn < MIN_GAP_ALL) return;
    for (const v of g.villages) {
      const due = this.nextAt.get(v) ?? 0;
      if (now < due) continue;
      if (this.regular(v).length >= MAX_PER_VILLAGE || v.population < 2) {
        this.nextAt.set(v, now + 10 + step);
        continue;
      }
      if (this.spawn(v, !this.firstDone && v.isHome ? 'timber' : this.choose(v), false)) break;
      this.nextAt.set(v, now + 10);
    }
  }

  private choose(v: Village): PrayerKind {
    const g = this.game;
    const have = new Set(this.forVillage(v).map((p) => p.kind));
    const w: [PrayerKind, number][] = [];
    const wood = v.store.wood;
    const site = v.constructionSite();
    w.push(['timber', 1 + (wood < 40 ? 2 : 0) + (site && wood < 30 ? 1.5 : 0)]);
    const avgHunger = v.villagers.reduce((s, x) => s + x.hunger, 0) / Math.max(1, v.population);
    w.push(['food', 0.8 + (v.store.food < 25 ? 2.5 : 0) + (v.starving > 0 || avgHunger > 0.55 ? 1 : 0)]);
    w.push(['rain', v.fields.some((f) => f.growth < 0.5) ? 1.6 : 0.6]);
    const anyLost = this.active.some((p) => p.kind === 'lost');
    if (!anyLost && v.population >= 5 && g.time > 240) w.push(['lost', 0.9]);
    w.push(['sign', 0.5]);
    const last = this.lastKind.get(v);
    const pool = w.filter(([k]) => !have.has(k) && k !== last);
    const list = pool.length ? pool : w.filter(([k]) => !have.has(k));
    const total = list.reduce((s, [, x]) => s + x, 0);
    let r = rng.range(0, total);
    for (const [k, x] of list) {
      r -= x;
      if (r <= 0) return k;
    }
    return 'timber';
  }

  private spawn(v: Village, kind: PrayerKind, force: boolean, house?: House): Prayer | null {
    const g = this.game;
    if (!force && this.regular(v).length >= MAX_PER_VILLAGE) return null;
    let villager: Villager | undefined;
    let childName: string | undefined;
    if (kind === 'lost') {
      const lost = this.loseSomeone(v);
      if (!lost) return this.spawn(v, 'sign', force);
      villager = lost.villager;
      childName = lost.name;
    }
    const first = !this.firstDone && v.isHome && kind === 'timber';
    const now = g.time;
    const need = kind === 'timber' ? (first ? 25 : rng.int(20, 40)) : kind === 'food' ? rng.int(20, 35) : 0;
    const text = rng.pick(TEXT[kind]).replace('{name}', childName ?? '');
    const p: Prayer = {
      id: this.nextId++,
      kind,
      village: v,
      icon: ICON[kind],
      text,
      thanks: rng.pick(THANKS),
      bornAt: now,
      expiresAt: now + (kind === 'lost' ? LOST_TIMEOUT : first ? FIRST_EXPIRE : rng.range(EXPIRE[0], EXPIRE[1])),
      need,
      progress: 0,
      villager,
      childName,
      house,
    };
    if (first) this.firstDone = true;
    this.active.push(p);
    this.lastSpawn = now;
    this.lastKind.set(v, kind);
    if (kind !== 'fire') this.nextAt.set(v, now + rng.range(PRAYER_GAP[0], PRAYER_GAP[1]));
    g.audio.prayerArrive();
    this.listener?.added(p);
    return p;
  }

  // --------------------------------------------------------------- lost child

  private loseSomeone(v: Village): { villager: Villager; name: string } | null {
    const g = this.game;
    const pool = v.villagers.filter((x) => !x.dead && !x.held && !x.airborne && !x.rolling && !x.burning && !x.isInside && !x.lost);
    if (!pool.length) return null;
    const villager = rng.pick(pool);
    const spot = this.findLostSpot(v);
    if (!spot) return null;
    g.fx.sparkle(villager.pos.x, villager.pos.y + 1.2, villager.pos.z, 10, 0xfff0b0, 1.5);
    villager.onPickup(g); // drops anything carried and resets the task
    villager.lost = true;
    villager.pos.set(spot.x, g.terrain.heightAt(spot.x, spot.z), spot.z);
    villager.object.position.copy(villager.pos);
    villager.object.scale.setScalar(0.82); // a small one
    return { villager, name: rng.pick(CHILD_NAMES) };
  }

  private findLostSpot(v: Village): { x: number; z: number } | null {
    const g = this.game;
    const ok = (x: number, z: number) =>
      g.terrain.isLand(x, z, 2) &&
      g.terrain.heightAt(x, z) > SEA_LEVEL + 1.5 &&
      g.terrain.normalAt(x, z, this.tmp).y > 0.82 &&
      !g.villages.some((o) => o.contains(x, z, 1.3));
    const trees = g.entities.filter((e) => e.kind === 'tree' && e.alive && ((e as unknown as { growth?: number }).growth ?? 1) > 0.5);
    for (let i = 0; i < 160 && trees.length; i++) {
      const t = trees[Math.floor(Math.random() * trees.length)];
      const dx = v.center.x - t.pos.x;
      const dz = v.center.z - t.pos.z;
      const d = Math.hypot(dx, dz);
      if (d < LOST_DIST[0] || d > LOST_DIST[1]) continue;
      const x = t.pos.x + (dx / d) * 2.8;
      const z = t.pos.z + (dz / d) * 2.8;
      if (ok(x, z)) return { x, z };
    }
    for (let i = 0; i < 80; i++) {
      const a = rng.range(0, Math.PI * 2);
      const d = rng.range(LOST_DIST[0], LOST_DIST[1]);
      const x = v.center.x + Math.cos(a) * d;
      const z = v.center.z + Math.sin(a) * d;
      if (ok(x, z)) return { x, z };
    }
    return null;
  }

  private release(p: Prayer) {
    const c = p.villager;
    if (p.kind === 'lost' && c) {
      c.lost = false;
      if (!c.dead) c.object.scale.setScalar(1);
    }
  }

  /** A lost villager died or was adopted elsewhere: end that prayer quietly. */
  private dropLost(villager: Villager) {
    for (const p of [...this.active]) if (p.kind === 'lost' && p.villager === villager) this.drop(p);
  }

  // ------------------------------------------------------------ resolutions

  private answerFirst(kind: PrayerKind, village: Village) {
    const p = this.active.find((x) => x.kind === kind && x.village === village);
    if (p) this.fulfil(p);
  }

  private remove(p: Prayer) {
    const i = this.active.indexOf(p);
    if (i >= 0) this.active.splice(i, 1);
    this.release(p);
  }

  /** Fade away with no reward and no penalty. */
  drop(p: Prayer) {
    if (!this.active.includes(p)) return;
    this.remove(p);
    this.listener?.gone(p);
  }

  fulfil(p: Prayer) {
    if (!this.active.includes(p)) return;
    this.remove(p);
    this.answered++;
    const g = this.game;
    const v = p.village;
    const s = v.store.pos;
    const power = POWER[p.kind];
    g.player.addPower(power);
    g.player.shiftAlignment(0.012);
    let line: string;
    if (v.owner === 'player') {
      v.belief = Math.min(100, v.belief + BELIEF_OWNED);
      line = `+${BELIEF_OWNED} faith · +${power} power`;
    } else {
      v.belief += BELIEF_NEUTRAL;
      line = `+${BELIEF_NEUTRAL} belief · +${power} power`;
    }
    g.fx.sparkle(s.x, s.y + 6, s.z, 70, 0xfff0b0, 6);
    g.floatText(s.x, s.y + 14, s.z, p.thanks, '#ffe9a8');
    g.floatText(s.x, s.y + 10, s.z, line, '#bff0c0');
    g.audio.prayerFulfilled();
    this.listener?.fulfilled(p);
    if (v.owner !== 'player' && v.belief >= VILLAGE.convertAt) v.convert(g);
  }
}
