import type { Game } from '../Game';
import { Pile, Rock, Tree } from '../entities/Nature';
import { Villager } from '../entities/Villager';
import { Golem } from '../creature/Golem';
import { MIRACLE_INFO, Orb } from '../miracles/Miracles';
import { Village, bumpVillagerSeed, type VillageSave } from '../village/Village';
import { SEA_LEVEL, VILLAGE_SITES, WORLD_SEED } from '../config';
import './save.css';

/**
 * Save & load. One versioned JSON blob in localStorage holds the whole island: the world clock, every
 * village with its people, the loose trees, rocks and piles, the golem, and each plugin's own state
 * (via `GamePlugin.save` / `load`). Terrain is regenerated from the world seed, so it is not stored.
 *
 * Deliberately dropped (they restart cleanly): villagers' current tasks, active prayers, fires, anything
 * airborne or held (settled where it is), orbs and rain clouds, a rival scheme in flight.
 */

export const SAVE_KEY = 'godgame.save.v1';
export const BACKUP_KEY = 'godgame.save.v1.bad';
/** Set (in sessionStorage) by "New island" so the fresh island skips the title screen. */
const AUTOSTART_KEY = 'godgame.autostart';
export const SAVE_VERSION = 1;

const AUTOSAVE_MS = 60_000;
/** The "Saved" toast shows at most this often (ms). */
const TOAST_GAP = 45_000;

/** [villageIndex, seed, x, z, hunger, health, homeHouseIndex, role (1 = worship), carry (0 none, 1 food, 2 wood), carryAmount] */
type VillagerSave = [number, number, number, number, number, number, number, number, number, number];

export interface SaveData {
  version: number;
  savedAt: number;
  /** Shown on the title screen, e.g. "Day 7 · Autumn · 2 of 3 villages". */
  summary: string;
  world: {
    time: number;
    day: number;
    dayTime: number;
    speed: number;
    power: number;
    alignment: number;
    /** Camera: [x, z, yaw, pitch, distance] */
    cam?: [number, number, number, number, number];
  };
  villages: VillageSave[];
  villagers: VillagerSave[];
  /** [seed, x, z, growth, chopped, charred] */
  trees: [number, number, number, number, number, number][];
  /** [seed, x, z, radius] */
  rocks: [number, number, number, number][];
  /** [kind (0 food, 1 wood), x, z, amount] */
  piles: [number, number, number, number][];
  golem: ReturnType<Golem['saveState']>;
  plugins: Record<string, unknown>;
}

const r2 = (n: number): number => {
  const v = Math.round(n * 100) / 100;
  return Number.isFinite(v) ? v : 0;
};
const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);
const isArr = (a: unknown): a is unknown[] => Array.isArray(a);

// ----------------------------------------------------------------- storage

/** Read and validate the save. A corrupt or unknown-version save is moved to the backup key and ignored. */
export function readSave(): SaveData | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(SAVE_KEY);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const d = JSON.parse(raw) as SaveData;
    validate(d);
    return d;
  } catch (err) {
    console.warn('Save is corrupt or from an unknown version; starting a new island. The old save is kept under', BACKUP_KEY, err);
    quarantine(raw);
    return null;
  }
}

/** Keep a bad save under the backup key and clear the live one. */
export function quarantine(raw?: string | null) {
  try {
    const bad = raw ?? localStorage.getItem(SAVE_KEY);
    if (bad != null) localStorage.setItem(BACKUP_KEY, bad);
    localStorage.removeItem(SAVE_KEY);
  } catch {
    /* storage unavailable or full: nothing more to do */
  }
}

function validate(d: SaveData) {
  if (!d || typeof d !== 'object') throw new Error('not an object');
  if (d.version !== SAVE_VERSION) throw new Error(`unknown save version ${String(d.version)}`);
  const w = d.world;
  if (!w || ![w.time, w.day, w.dayTime, w.speed, w.power, w.alignment].every(isNum)) throw new Error('bad world block');
  if (!isArr(d.villages) || d.villages.length !== VILLAGE_SITES.length) throw new Error('village count mismatch');
  for (const v of d.villages) {
    if (!v || !isArr(v.houses) || !isArr(v.fields) || !isArr(v.totem) || ![v.belief, v.food, v.wood, v.worship].every(isNum)) throw new Error('bad village');
    if (v.owner !== null && v.owner !== 'player' && v.owner !== 'rival') throw new Error('bad owner');
  }
  if (!isArr(d.villagers) || !isArr(d.trees) || !isArr(d.rocks) || !isArr(d.piles)) throw new Error('bad entity lists');
  const rows: [unknown[], number][] = [
    [d.villagers, 10],
    [d.trees, 6],
    [d.rocks, 4],
    [d.piles, 4],
  ];
  for (const [list, n] of rows) for (const row of list) if (!isArr(row) || row.length !== n || !row.every(isNum)) throw new Error('bad entity row');
  for (const v of d.villages) {
    for (const h of v.houses) if (!isArr(h) || h.length !== 6 || !h.every(isNum)) throw new Error('bad house');
    for (const f of v.fields) if (!isArr(f) || f.length !== 5 || !f.every(isNum)) throw new Error('bad field');
  }
  if (!d.golem || !isNum(d.golem.x) || !isNum(d.golem.z)) throw new Error('bad golem');
  if (!d.plugins || typeof d.plugins !== 'object') throw new Error('bad plugin block');
}

// --------------------------------------------------------------- serialise

export function serialize(game: Game): SaveData {
  const t = game.terrain;
  const home = (v: Village) => v.houses.filter((h) => !h.destroyed);
  const dry = (x: number, z: number) => t.heightAt(x, z) >= SEA_LEVEL - 0.4;

  const villages: VillageSave[] = [];
  const villagers: VillagerSave[] = [];
  game.villages.forEach((v, vi) => {
    const houses = home(v);
    villages.push({
      owner: v.owner,
      belief: r2(v.belief),
      worship: r2(v.worshipFraction),
      food: r2(v.store.food),
      wood: r2(v.store.wood),
      totem: [r2(v.worship.pos.x), r2(v.worship.pos.z)],
      houses: houses.map((h) => [r2(h.pos.x), r2(h.pos.z), r2(h.object.rotation.y), h.seed, r2(h.progress), r2(h.health)]),
      fields: v.fields.filter((f) => f.alive).map((f) => [r2(f.pos.x), r2(f.pos.z), r2(f.object.rotation.y), r2(f.growth), r2(f.scorched)]),
    });
    for (const p of v.villagers) {
      if (p.dead || !p.alive) continue;
      const hi = p.home && !p.home.destroyed ? houses.indexOf(p.home) : -1;
      const c = p.carrying;
      villagers.push([vi, p.seed, r2(p.pos.x), r2(p.pos.z), r2(p.hunger), r2(p.health), hi, p.role === 'worship' ? 1 : 0, c ? (c.kind === 'food' ? 1 : 2) : 0, c ? r2(c.amount) : 0]);
    }
  });

  const trees: SaveData['trees'] = [];
  const rocks: SaveData['rocks'] = [];
  const piles: SaveData['piles'] = [];
  for (const e of game.entities) {
    if (!e.alive) continue;
    if (e instanceof Tree) {
      if (e.isFelling || !dry(e.pos.x, e.pos.z)) continue;
      trees.push([e.seed, r2(e.pos.x), r2(e.pos.z), r2(e.growth), r2(e.chopped), e.charred ? 1 : 0]);
    } else if (e instanceof Rock) {
      if (!dry(e.pos.x, e.pos.z)) continue;
      rocks.push([e.seed, r2(e.pos.x), r2(e.pos.z), r2(e.radius)]);
    } else if (e instanceof Pile) {
      if (e.amount < 0.5 || !dry(e.pos.x, e.pos.z)) continue;
      piles.push([e.kind === 'food' ? 0 : 1, r2(e.pos.x), r2(e.pos.z), r2(e.amount)]);
    }
  }

  // A miracle orb in the hand was already paid for: refund it rather than lose it.
  const heldOrb = game.hand.held instanceof Orb ? game.hand.held : null;
  const refund = heldOrb ? MIRACLE_INFO[heldOrb.miracle].cost : 0;
  const cam = game.godCam;

  const plugins: Record<string, unknown> = {};
  for (const p of game.plugins) {
    if (!p.save) continue;
    try {
      plugins[p.name] = p.save();
    } catch (err) {
      console.warn(`Plugin ${p.name} could not be saved`, err);
    }
  }

  const owned = game.villages.filter((v) => v.owner === 'player').length;
  const season = (game as unknown as { seasons?: { seasonName?: string } }).seasons?.seasonName;
  const summary = [`Day ${game.day}`, season, `${owned} of ${game.villages.length} villages`].filter(Boolean).join(' · ');

  return {
    version: SAVE_VERSION,
    savedAt: Date.now(),
    summary,
    world: {
      time: r2(game.time),
      day: game.day,
      dayTime: Math.round(game.dayTime * 10000) / 10000,
      speed: game.speed,
      power: r2(Math.min(game.player.maxPower, game.player.power + refund)),
      alignment: Math.round(game.player.alignment * 10000) / 10000,
      cam: [r2(cam.target.x), r2(cam.target.z), r2(cam.yaw), r2(cam.pitch), r2(cam.distance)],
    },
    villages,
    villagers,
    trees,
    rocks,
    piles,
    golem: roundGolem(game.creature.saveState()),
    plugins,
  };
}

function roundGolem(g: ReturnType<Golem['saveState']>): ReturnType<Golem['saveState']> {
  const o = { ...g.opinions };
  for (const k of Object.keys(o) as (keyof typeof o)[]) o[k] = Math.round(o[k] * 1000) / 1000;
  return { ...g, x: r2(g.x), z: r2(g.z), yaw: r2(g.yaw), hunger: r2(g.hunger), energy: r2(g.energy), alignment: Math.round(g.alignment * 1000) / 1000, size: r2(g.size), opinions: o };
}

// ----------------------------------------------------------------- restore

/** Rebuild the world from a save, in place of `buildWorld()`. Plugins load their own state afterwards. */
export function restoreWorld(game: Game, d: SaveData) {
  const t = game.terrain;
  const w = d.world;
  game.time = w.time;
  game.day = w.day;
  game.dayTime = w.dayTime;
  game.speed = [1, 2, 4].includes(w.speed) ? w.speed : 1;
  game.player.power = Math.min(game.player.maxPower, Math.max(0, w.power));
  game.player.alignment = Math.max(-1, Math.min(1, w.alignment));

  VILLAGE_SITES.forEach((site, i) => {
    // A different layout seed from the original so new houses and fields do not retrace the old random picks.
    const v = new Village(game, site, WORLD_SEED + 100 + i + Math.floor(w.time), true);
    v.restore(game, d.villages[i]);
    game.villages.push(v);
  });

  let maxSeed = 0;
  for (const [vi, seed, x, z, hunger, health, hi, role, carry, amount] of d.villagers) {
    const village = game.villages[vi];
    if (!village) continue;
    const p = new Villager(village, x, z, seed);
    p.pos.y = t.heightAt(x, z);
    p.hunger = hunger;
    p.health = health;
    p.role = role === 1 ? 'worship' : 'work';
    if (carry) p.carry(carry === 1 ? 'food' : 'wood', amount);
    village.addVillager(p);
    const house = village.houses[hi];
    if (house) {
      house.residents.push(p);
      p.home = house;
    }
    game.add(p);
    if (seed < 90000) maxSeed = Math.max(maxSeed, seed);
  }
  bumpVillagerSeed(maxSeed + 1);

  for (const [seed, x, z, growth, chopped, charred] of d.trees) {
    const tree = new Tree(seed, x, z, growth);
    tree.pos.y = t.heightAt(x, z);
    tree.restore(chopped, charred === 1);
    game.add(tree);
  }
  for (const [seed, x, z, radius] of d.rocks) {
    const rock = new Rock(seed, x, z, radius);
    rock.pos.y = t.heightAt(x, z) + rock.groundOffset;
    game.add(rock);
  }
  for (const [kind, x, z, amount] of d.piles) {
    const pile = new Pile(kind === 0 ? 'food' : 'wood', x, z, amount);
    pile.pos.y = t.heightAt(x, z);
    game.add(pile);
  }

  const home = game.villages.find((v) => v.isHome)!;
  const g = new Golem(home, d.golem.x, d.golem.z);
  g.pos.y = t.heightAt(d.golem.x, d.golem.z);
  g.loadState(d.golem);
  game.creature = g;
  game.add(g);
}

/** Hand each plugin its saved state (after all plugins are installed). */
export function loadPlugins(game: Game, d: SaveData) {
  for (const p of game.plugins) {
    const data = d.plugins[p.name];
    if (!p.load || data === undefined) continue;
    try {
      p.load(data);
    } catch (err) {
      console.warn(`Plugin ${p.name} could not load its saved state`, err);
    }
  }
}

// ------------------------------------------------------------------ system

/** Autosave, the "Saved" toast, and the hooks the title screen uses. */
export class SaveSystem {
  /** The save this session started from (null for a new island). */
  readonly loaded: SaveData | null;
  /** True once the player has begun (or continued). Nothing is autosaved before that on a brand-new island. */
  armed: boolean;
  private suppress = false;
  private lastToast = -Infinity;
  private toast: HTMLDivElement | null = null;
  private toastTimer = 0;

  constructor(
    private readonly game: Game,
    loaded: SaveData | null,
  ) {
    this.loaded = loaded;
    this.armed = loaded !== null;
    window.setInterval(() => this.save('auto'), AUTOSAVE_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') this.save('quiet');
    });
    window.addEventListener('beforeunload', () => this.save('quiet'));
    window.addEventListener('pagehide', () => this.save('quiet'));
  }

  get summary(): string {
    return this.loaded?.summary ?? '';
  }

  /** The title screen asks: skip it (the player just chose "New island")? */
  consumeAutostart(): boolean {
    try {
      const yes = sessionStorage.getItem(AUTOSTART_KEY) === '1';
      sessionStorage.removeItem(AUTOSTART_KEY);
      return yes;
    } catch {
      return false;
    }
  }

  /** The player pressed Begin / Continue: from now on the island is worth keeping. */
  arm() {
    this.armed = true;
  }

  /** Write the save. `auto` shows a quiet toast (rate-limited); `quiet` (page hiding) never does. Returns the size in characters. */
  save(mode: 'auto' | 'quiet' | 'manual' = 'manual'): number {
    if (!this.armed || this.suppress || !this.game.creature) return 0;
    try {
      const json = JSON.stringify(serialize(this.game));
      localStorage.setItem(SAVE_KEY, json);
      if (mode !== 'quiet') this.showToast(mode === 'manual');
      return json.length;
    } catch (err) {
      console.warn('Could not save the island', err);
      return 0;
    }
  }

  /** Wipe the save and start over on a fresh island. */
  newIsland() {
    this.suppress = true; // the page unload below must not write the old island back
    try {
      localStorage.removeItem(SAVE_KEY);
      // A new island means meeting Lumi and Fizz again from the start.
      localStorage.removeItem('godgame.advisors.v1');
      sessionStorage.setItem(AUTOSTART_KEY, '1');
    } catch {
      /* ignore */
    }
    location.reload();
  }

  private showToast(force: boolean) {
    const now = performance.now();
    if (!force && now - this.lastToast < TOAST_GAP) return;
    this.lastToast = now;
    if (!this.toast) {
      this.toast = document.createElement('div');
      this.toast.className = 'save-toast';
      this.toast.textContent = 'Saved';
      this.game.hud.root.appendChild(this.toast);
    }
    const el = this.toast;
    el.classList.add('show');
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => el.classList.remove('show'), 1800);
  }
}
