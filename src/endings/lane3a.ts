import type { Game } from '../Game';
import type { Village } from '../village/Village';

/**
 * The endings read lane 3a's shrine track, villager names and chronicle through these accessors only.
 * They use lane 3a's names (`village.shrineStage`, `village.shrineStagesReached`, `game.allTemplesStand()`,
 * `villager.name`, `game.chronicle.entries` / `people(n)`) when they exist, and fall back to what v0.4
 * already has when they don't, so this lane builds and plays on its own and the merge needs no edits here.
 */

export type ShrineStage = 'totem' | 'stone_circle' | 'pyramid' | 'temple';
export const SHRINE_STAGES: readonly ShrineStage[] = ['totem', 'stone_circle', 'pyramid', 'temple'];

export interface ChroniclePerson {
  name: string;
  role: string;
  story: string;
  /** Lane 3a may say which village they belong to (a name or the village itself). */
  village?: string | Village | null;
}

interface Lane3aGame {
  allTemplesStand?: () => boolean;
  chronicle?: { entries?: unknown[]; people?: (n: number) => ChroniclePerson[] };
  projectSystem?: { has?: (v: Village, id: string) => boolean };
}

interface Lane3aVillage {
  shrineStage?: ShrineStage;
  shrineStagesReached?: string[];
}

const g3 = (game: Game) => game as unknown as Lane3aGame;
const v3 = (v: Village) => v as unknown as Lane3aVillage;

/** Lane 3a is in: at least one village carries a shrine stage. */
export function hasShrines(game: Game): boolean {
  return game.villages.some((v) => typeof v3(v).shrineStage === 'string');
}

/** Every village's prayer place has reached the temple (lane 3a), or before lane 3a: every village is yours and has built its v0.4 Temple. */
export function allTemplesStand(game: Game): boolean {
  const f = g3(game).allTemplesStand;
  if (typeof f === 'function') return !!f.call(game);
  if (hasShrines(game)) return game.villages.every((v) => v3(v).shrineStage === 'temple');
  const ps = g3(game).projectSystem;
  return game.villages.every((v) => v.owner === 'player' && !!ps?.has?.(v, 'temple'));
}

/** The prayer-place stages this village reached, in order. Before lane 3a: the totem, plus the v0.4 Temple if built. */
export function stagesReached(game: Game, v: Village): string[] {
  const reached = v3(v).shrineStagesReached;
  if (Array.isArray(reached)) return reached.filter((s) => typeof s === 'string');
  const stage = v3(v).shrineStage;
  if (typeof stage === 'string') return SHRINE_STAGES.slice(0, SHRINE_STAGES.indexOf(stage) + 1);
  return g3(game).projectSystem?.has?.(v, 'temple') ? ['totem', 'temple'] : ['totem'];
}

/** The stage a village's prayer place stands at now (the last one reached). */
export function shrineStage(game: Game, v: Village): string {
  const s = stagesReached(game, v);
  return s[s.length - 1] ?? 'totem';
}

/** Up to `n` remembered people from lane 3a's chronicle; none until it exists (the RPG falls back gracefully). */
export function chroniclePeople(game: Game, n: number): ChroniclePerson[] {
  const c = g3(game).chronicle;
  if (!c || typeof c.people !== 'function') return [];
  try {
    const list = c.people(n);
    return Array.isArray(list) ? list.slice(0, n) : [];
  } catch (err) {
    console.warn('endings: chronicle.people() failed', err);
    return [];
  }
}

/** Lane 3a's chronicle entries (any shape), or an empty list. */
export function chronicleEntries(game: Game): unknown[] {
  const e = g3(game).chronicle?.entries;
  return Array.isArray(e) ? e : [];
}

/** A villager's name (lane 3a), or null. */
export function villagerName(v: unknown): string | null {
  const n = (v as { name?: unknown } | null)?.name;
  return typeof n === 'string' && n ? n : null;
}
