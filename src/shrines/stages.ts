import type { ProjectId } from '../projects/defs';

/**
 * The shrine track: each village's prayer place grows through the ages, from a carved totem to a
 * ring of standing stones, a pyramid and finally a temple (BRIEF v0.5, and frames 3 to 5 of the RPG's
 * approved storyboard "Through the Nexus"). The legacy record the RPG reads lists the stages each
 * village reached, so the names here are part of that contract: don't rename them.
 */
export type ShrineStage = 'totem' | 'stone_circle' | 'pyramid' | 'temple';

export const SHRINE_STAGES: readonly ShrineStage[] = ['totem', 'stone_circle', 'pyramid', 'temple'];

export const stageIndex = (s: ShrineStage): number => SHRINE_STAGES.indexOf(s);

export const isShrineStage = (s: unknown): s is ShrineStage => SHRINE_STAGES.includes(s as ShrineStage);

/**
 * Which village project raises which stage. The project ids are kept from v0.4 so old saves still
 * load: the Well also raises the stone circle, the old "Temple" project is now the pyramid, and the
 * old "Harvest Festival" is now the temple (opened with the festival's night of dancing).
 */
export const STAGE_OF_PROJECT: Partial<Record<ProjectId, ShrineStage>> = {
  well: 'stone_circle',
  temple: 'pyramid',
  festival: 'temple',
};

/** Projects built at the prayer place itself (the well still gets its own plot). */
export const BUILT_AT_SHRINE: ReadonlySet<ProjectId> = new Set<ProjectId>(['temple', 'festival']);

/** The stage a village's finished projects add up to (for saves from before the shrine track). */
export function stageFromProjects(done: ReadonlySet<ProjectId> | readonly ProjectId[]): ShrineStage {
  const has = (id: ProjectId) => (Array.isArray(done) ? done.includes(id) : (done as ReadonlySet<ProjectId>).has(id));
  if (has('festival')) return 'temple';
  if (has('temple')) return 'pyramid';
  if (has('well')) return 'stone_circle';
  return 'totem';
}

/** Every stage up to and including `s` (a village that reached the pyramid also had the totem and stones). */
export function stagesUpTo(s: ShrineStage): ShrineStage[] {
  return SHRINE_STAGES.slice(0, stageIndex(s) + 1);
}

// ------------------------------------------------------------------ tuning knobs

export interface StageLayout {
  /** Radius of the worship dance ring (metres). */
  ring: number;
  /** Keep-out radius of the solid middle (villagers and the golem walk around it). */
  solid: number;
  /** Rough height of the tallest part (for labels and sparkles). */
  top: number;
  /** Picking radius for the Hand's hover. */
  pick: number;
  /** Height prayers rise from (the totem's top, the pyramid's tip, the temple's crown). */
  motes: number;
}

export const LAYOUT: Record<ShrineStage, StageLayout> = {
  totem: { ring: 6.2, solid: 1.2, top: 9, pick: 8, motes: 2 },
  stone_circle: { ring: 6.2, solid: 1.2, top: 9, pick: 11, motes: 2 },
  pyramid: { ring: 8.6, solid: 6.8, top: 11, pick: 11, motes: 10 },
  temple: { ring: 8.6, solid: 6.8, top: 15, pick: 12, motes: 13 },
};

/** Houses, fields and project plots keep this far from the prayer place's centre (it grows to ~12 m). */
export const SHRINE_CLEARANCE = 13;
