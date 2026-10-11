import type { Game } from '../Game';
import type { Villager } from '../entities/Villager';
import { villagerName } from '../people/names';
import { CHILD_DAYS, ELDER_AT, ageDays, lifespanDays } from '../people/age';
import { SHRINE_STAGES, isShrineStage, stageIndex, type ShrineStage } from '../shrines/stages';
import { storyOf, weightOf, type EraLookup } from './stories';

// ------------------------------------------------------------------ tuning knobs

/** Most entries kept. When full, the least memorable go first (see KIND_WEIGHT in stories.ts). */
export const MAX_ENTRIES = 200;
/** Seconds before the same kind of moment is recorded again for the same villager (no spam from one long carry). */
const REPEAT_GAP = 150;
/** Island moments at or above this weight are never dropped to make room for a villager's. */
const KEEP_ISLAND = 7;

/**
 * One remembered moment. Per villager (`villagerSeed`, `name`): lost_child_home, saved_from_fire,
 * fed_in_famine, carried_by_hand, thrown, killed, eaten_by_golem, born, died_old, died. For the island:
 * shrine_raised (note = the stage), village_joined, village_turned, scheme_foiled (note = the scheme),
 * worst_act (note = what it was; only the worst is kept).
 */
export interface ChronicleEntry {
  /** Game time, and the day it fell on. */
  t: number;
  day: number;
  kind: string;
  villagerSeed?: number;
  name?: string;
  /** The village's name (at the time). */
  village?: string;
  x?: number;
  z?: number;
  note?: string;
}

export type NewEntry = Omit<ChronicleEntry, 't' | 'day'> & Partial<Pick<ChronicleEntry, 't' | 'day'>>;

/** A villager worth remembering, for the legacy record (`people[]`). */
export interface Person {
  name: string;
  village: string;
  /** child, elder, builder, farmer, woodcutter, dancer, villager, or remembered (no longer living). */
  role: string;
  story: string;
  seed: number;
  alive: boolean;
}

/** [t, day, kind, seed or -1, village or '', x or null, z or null, note or ''] */
type Row = [number, number, string, number, string, number | null, number | null, string];

export interface ChronicleSave {
  v: 1;
  e: Row[];
}

/**
 * The chronicle: a small saved log of what happened on the island and to whom. Hooked up to the world's
 * events by plugins/chronicle.ts; anything else may `add` to it. Nothing here is ever shown on screen;
 * the endings and the legacy record read it (`people(n)`, `entries`).
 */
export class Chronicle {
  readonly entries: ChronicleEntry[] = [];

  constructor(private readonly game: Game) {}

  /** Remember a moment. Fills in the time and day. Returns null when it repeats one just recorded. */
  add(e: NewEntry): ChronicleEntry | null {
    const g = this.game;
    const t = e.t ?? Math.round(g.time * 10) / 10;
    if (e.villagerSeed !== undefined) {
      const dup = this.entries.some((o) => o.villagerSeed === e.villagerSeed && o.kind === e.kind && o.note === e.note && t - o.t < REPEAT_GAP);
      if (dup) return null;
    }
    const entry: ChronicleEntry = { ...e, t, day: e.day ?? g.day };
    if (entry.villagerSeed !== undefined && !entry.name) entry.name = villagerName(entry.villagerSeed);
    if (entry.x !== undefined) entry.x = Math.round(entry.x);
    if (entry.z !== undefined) entry.z = Math.round(entry.z);
    this.entries.push(entry);
    if (this.entries.length > MAX_ENTRIES) this.trim();
    return entry;
  }

  /** Everything remembered about one villager, oldest first. */
  of(seed: number): ChronicleEntry[] {
    return this.entries.filter((e) => e.villagerSeed === seed);
  }

  /** The last entry of a kind (e.g. 'worst_act'). */
  last(kind: string): ChronicleEntry | null {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].kind === kind) return this.entries[i];
    return null;
  }

  /** Drop every entry of a kind (the worst act is kept as one entry, replaced when something worse happens). */
  removeKind(kind: string) {
    for (let i = this.entries.length - 1; i >= 0; i--) if (this.entries[i].kind === kind) this.entries.splice(i, 1);
  }

  /**
   * The n most memorable named villagers, living or not, each with a one-line story written from
   * their entries (e.g. "Pip, who wandered into the woods as a child and was carried home by the hand").
   */
  people(n: number): Person[] {
    const living = new Map<number, Villager>();
    for (const v of this.game.villages) for (const p of v.villagers) if (!p.dead) living.set(p.seed, p);
    const bySeed = new Map<number, ChronicleEntry[]>();
    for (const e of this.entries) {
      if (e.villagerSeed === undefined) continue;
      let list = bySeed.get(e.villagerSeed);
      if (!list) bySeed.set(e.villagerSeed, (list = []));
      list.push(e);
    }
    const era = this.eraLookup();
    const scored: { score: number; person: Person }[] = [];
    for (const [seed, list] of bySeed) {
      const v = living.get(seed) ?? null;
      const kinds = new Set(list.map((e) => e.kind));
      let score = 0;
      for (const e of list) score += e.kind === 'born' ? 0.5 : weightOf(e.kind);
      score += (kinds.size - 1) * 0.8 + (v ? 2 : 0);
      const name = list[0].name ?? villagerName(seed);
      scored.push({
        score,
        person: {
          name,
          village: v?.village.name ?? list[list.length - 1].village ?? '',
          role: v ? this.roleOf(v) : 'remembered',
          story: storyOf(name, list, era),
          seed,
          alive: !!v,
        },
      });
    }
    scored.sort((a, b) => b.score - a.score || a.person.seed - b.person.seed);
    return scored.slice(0, Math.max(0, n)).map((s) => s.person);
  }

  /** What a living villager is to their village right now. */
  roleOf(v: Villager): string {
    const age = ageDays(v.bornAt, this.game.time);
    if (age < CHILD_DAYS) return 'child';
    if (age >= lifespanDays(v.seed) * ELDER_AT) return 'elder';
    switch (v.task.type) {
      case 'build':
      case 'project':
        return 'builder';
      case 'harvest':
        return 'farmer';
      case 'chop':
        return 'woodcutter';
    }
    return v.role === 'worship' ? 'dancer' : 'villager';
  }

  /** Which age a village's prayer place was in at a given time (from the shrine_raised entries). */
  private eraLookup(): EraLookup {
    const raised = this.entries.filter((e) => e.kind === 'shrine_raised' && isShrineStage(e.note));
    return (village, t) => {
      let best: ShrineStage = SHRINE_STAGES[0];
      for (const e of raised) {
        if (e.village !== village || e.t > t) continue;
        const s = e.note as ShrineStage;
        if (stageIndex(s) > stageIndex(best)) best = s;
      }
      return best;
    };
  }

  /** Full: let go of the least memorable entry (older ones first among equals). */
  private trim() {
    const counts = new Map<number, number>();
    for (const e of this.entries) if (e.villagerSeed !== undefined) counts.set(e.villagerSeed, (counts.get(e.villagerSeed) ?? 0) + 1);
    const now = this.game.time;
    while (this.entries.length > MAX_ENTRIES) {
      let worst = -1;
      let worstScore = Infinity;
      this.entries.forEach((e, i) => {
        const w = weightOf(e.kind);
        if (e.villagerSeed === undefined && w >= KEEP_ISLAND) return;
        // People with several moments make the best stories: keep theirs. Newer beats older, a little.
        const rich = e.villagerSeed !== undefined && (counts.get(e.villagerSeed) ?? 0) > 1 ? 1.5 : 0;
        const fresh = 1 / (1 + Math.max(0, now - e.t) / 3000);
        const score = w + rich + fresh;
        if (score < worstScore) {
          worstScore = score;
          worst = i;
        }
      });
      if (worst < 0) worst = 0;
      const [gone] = this.entries.splice(worst, 1);
      if (gone.villagerSeed !== undefined) counts.set(gone.villagerSeed, (counts.get(gone.villagerSeed) ?? 1) - 1);
    }
  }

  // ------------------------------------------------------------- save / load

  save(): ChronicleSave {
    return {
      v: 1,
      e: this.entries.map((e) => [e.t, e.day, e.kind, e.villagerSeed ?? -1, e.village ?? '', e.x ?? null, e.z ?? null, e.note ?? '']),
    };
  }

  load(data: unknown) {
    const d = data as Partial<ChronicleSave>;
    if (!Array.isArray(d?.e)) return;
    this.entries.length = 0;
    for (const r of d.e) {
      if (!Array.isArray(r) || typeof r[0] !== 'number' || typeof r[2] !== 'string') continue;
      const [t, day, kind, seed, village, x, z, note] = r;
      const e: ChronicleEntry = { t, day: typeof day === 'number' ? day : 1, kind };
      if (typeof seed === 'number' && seed >= 0) {
        e.villagerSeed = seed;
        e.name = villagerName(seed);
      }
      if (village) e.village = village;
      if (typeof x === 'number') e.x = x;
      if (typeof z === 'number') e.z = z;
      if (note) e.note = note;
      this.entries.push(e);
    }
    if (this.entries.length > MAX_ENTRIES) this.trim();
  }
}
