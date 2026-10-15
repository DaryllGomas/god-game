import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { Pace } from '../pace/Pace';
import type { Advisors } from '../prayers/Advisors';
import { SHRINE_STAGES, stageIndex, type ShrineStage } from '../shrines/stages';
import { Beacon } from './Beacon';
import { ADVISORS_ON, ADVISOR_NUDGES, LEAD, NUDGE, type Ctx, type StepId } from './lines';

// ------------------------------------------------------------------ tuning knobs

/** Real seconds on one goal (playing, not paused) before Ora gently re-nudges, and between nudges after that. */
const NUDGE_AFTER = 150;
/** After this many nudges on one goal, they come half as often. */
const NUDGE_SLOW_AFTER = 3;
/** A new goal must hold this long (real seconds) before Ora speaks it (no flicker when two things change at once). */
const SETTLE = 1.5;
/** Chance a nudge also gets a word from Lumi or Fizz. */
const ADVISOR_NUDGE_CHANCE = 0.5;
/** Balance below this counts as out of tune for the last goal's words. */
const LOW_BALANCE = 0.75;

const NEXT_WORDS: Record<ShrineStage, string> = { totem: 'a totem', stone_circle: 'standing stones', pyramid: 'a pyramid', temple: 'a temple' };

export interface Goal {
  id: StepId;
  /** Stable while the goal is the same goal (it changes when anything the words depend on does). */
  key: string;
  village: Village;
  via?: Village;
  pos: THREE.Vector3;
}

interface StorySave {
  /** Goal kinds already led on this island (for "again" wording). */
  led?: string[];
}

/**
 * Story mode (Daryll, 2026-10-14): "the idea is to guide the player through the path of the entire game ...
 * Ora kind of guiding you through it." The road from the first prayer to the Ascension, one goal at a time:
 *
 *   1. answer   the first prayer in your home village;
 *   2. stones   your home raises its standing stones (its well waits for stone you carry);
 *   3. carry    your light grows as you tend (prayers, gifts, dreams) and leans toward the nearest village; at its
 *               prayer place's limit, only the next age carries it on (2026-10-14, progression);
 *      win      your light touches it: win its families one by one (prayers, gifts, help its dream);
 *   4. raise    every village of yours grows its prayer place, age by age, to a temple;
 *   5. tune     every temple stands: keep the island in tune until it is ready to see (the Ascension).
 *
 * The goal is read from the world every half second, so loading a save, losing a village or doing things out of
 * order just moves it. Ora speaks a goal when it begins (which also closes the last), re-nudges after a few
 * minutes stuck, and a soft light (Beacon) marks it. Free play (src/pace PlayMode) shows none of this.
 */
export class Story {
  readonly beacon: Beacon;
  goal: Goal | null = null;
  /** The goal Ora last spoke, and how long (real seconds) the player has been on it. */
  private spokenKey = '';
  private stuck = 0;
  private nudges = 0;
  private candidate = '';
  private settle = 0;
  private tick = 0;
  private readonly led = new Set<string>();
  private clock = 0;

  constructor(private readonly game: Game) {
    this.beacon = new Beacon(game);
    // A goal finished: Ora's next line comes from the goal change itself; the light lifts at once.
    game.events.on('shrineRaised', () => (this.tick = 1));
    game.events.on('villageConverted', () => (this.tick = 1));
  }

  private get pace(): Pace | null {
    return (this.game as unknown as { pace?: Pace }).pace ?? null;
  }

  private get advisors(): Advisors | null {
    return (this.game as unknown as { prayerSystem?: { advisors?: Advisors } }).prayerSystem?.advisors ?? null;
  }

  private get ora(): { guide(t: string, o?: { clear?: boolean }): void; guideBusy: boolean } | null {
    return (this.game as unknown as { ora?: { guide(t: string, o?: { clear?: boolean }): void; guideBusy: boolean } }).ora ?? null;
  }

  /** Story mode is on and the island is in play (not an ending, not the first question). */
  get active(): boolean {
    const p = this.pace;
    const en = (this.game as unknown as { endings?: { phase: string } }).endings;
    return !!p && p.story && p.confirmed && this.game.saves.armed && (!en || en.phase === 'play');
  }

  save(): StorySave {
    return { led: [...this.led] };
  }

  load(d: unknown) {
    const s = (d ?? {}) as StorySave;
    // A returning player hears the current goal as the first line (worded as a reminder where it matters).
    for (const k of s.led ?? []) if (typeof k === 'string') this.led.add(k);
  }

  // ------------------------------------------------------------- the road

  /** The one next goal, read from the world. */
  derive(): Goal | null {
    const g = this.game;
    const vs = g.villages;
    const home = vs.find((v) => v.isHome) ?? vs[0];
    if (!home) return null;
    const mine = vs.filter((v) => v.owner === 'player');
    const answered = (g as unknown as { prayerSystem?: { answered?: number } }).prayerSystem?.answered ?? 0;
    const at = (v: Village) => (v.projectSite ? v.projectSite.pos : v.worship.pos);

    if (answered < 1) return { id: 'answer', key: 'answer', village: home, pos: home.center };
    if (home.owner === 'player' && stageIndex(home.shrineStage) < stageIndex('stone_circle')) {
      return { id: 'stones', key: `stones:${home.projectSite ? 'site' : 'wait'}`, village: home, pos: at(home) };
    }

    const others = vs.filter((v) => v.owner !== 'player');
    if (others.length && mine.length) {
      // The nearest village that isn't yours (measured from the nearest of yours).
      const near = (v: Village) => Math.min(...mine.map((m) => Math.hypot(m.center.x - v.center.x, m.center.z - v.center.z)));
      const t = [...others].sort((a, b) => near(a) - near(b))[0];
      if (g.withinReach(t)) return { id: 'win', key: `win:${t.name}:${t.owner ?? 'none'}`, village: t, pos: t.worship.pos };
      const via = g.lightSource(t) ?? [...mine].sort((a, b) => Math.hypot(a.center.x - t.center.x, a.center.z - t.center.z) - Math.hypot(b.center.x - t.center.x, b.center.z - t.center.z))[0];
      // The light grows as you tend; when it stands at its prayer place's limit, the next age carries it on.
      const capped = this.capped(via);
      return { id: 'carry', key: `carry:${t.name}:${via.name}:${capped ? 'cap' : 'grow'}:${capped && via.projectSite ? 'site' : 'wait'}`, village: t, via, pos: capped ? at(via) : this.lightTip(via, t) };
    }

    const climbing = mine.filter((v) => v.shrineStage !== 'temple');
    if (climbing.length) {
      // The one closest to its temple first (a dream under way breaks a tie, then home).
      const score = (v: Village) => stageIndex(v.shrineStage) * 10 + (v.projectSite ? 2 : 0) + (v.isHome ? 1 : 0);
      const v = [...climbing].sort((a, b) => score(b) - score(a))[0];
      return { id: 'raise', key: `raise:${v.name}:${v.shrineStage}:${v.projectSite ? 'site' : 'wait'}`, village: v, pos: at(v) };
    }
    return { id: 'tune', key: 'tune', village: home, pos: home.worship.pos };
  }

  /** `v`'s light has grown as far as its prayer place lets it (only a new age carries it further). */
  private capped(v: Village): boolean {
    return v.influenceRadius >= v.ringCap - 1;
  }

  /** The tip of `src`'s light on the way to `t`: where the gold is creeping. */
  private lightTip(src: Village, t: Village): THREE.Vector3 {
    const g = this.game;
    const d = Math.max(1, Math.hypot(t.center.x - src.center.x, t.center.z - src.center.z));
    const e = Math.min(d, g.lightEdgeToward(src, t.center.x, t.center.z));
    const x = src.center.x + ((t.center.x - src.center.x) / d) * e;
    const z = src.center.z + ((t.center.z - src.center.z) / d) * e;
    return new THREE.Vector3(x, g.terrain.heightAt(x, z), z);
  }

  private ctx(goal: Goal, reminder: boolean): Ctx {
    const g = this.game;
    const home = g.villages.find((v) => v.isHome) ?? g.villages[0];
    const v = goal.village;
    const dreamer = goal.id === 'carry' ? goal.via! : v;
    const next = SHRINE_STAGES[Math.min(SHRINE_STAGES.length - 1, stageIndex(dreamer.shrineStage) + 1)];
    const bal = (g as unknown as { balance?: { value: number } }).balance?.value ?? 1;
    return {
      home: home.name,
      v: v.name,
      via: goal.via?.name,
      dreaming: !!dreamer.projectSite,
      next: NEXT_WORDS[next],
      turned: v.owner === 'rival',
      low: bal < LOW_BALANCE,
      again: this.led.has(goal.id),
      reminder,
      capped: goal.id === 'carry' && !!goal.via && this.capped(goal.via),
      families: v.familiesWithYou(),
      homes: v.households().length,
    };
  }

  // ------------------------------------------------------------- per frame

  frame(dt: number) {
    const g = this.game;
    const on = this.active;
    const quiet = !g.paused && !g.hud.helpOpen;
    if (on) {
      this.tick += dt;
      if (this.tick >= 0.5) {
        this.tick = 0;
        this.goal = this.derive();
      }
    } else this.goal = null;
    this.beacon.target(this.goal?.pos ?? null);
    this.beacon.frame(dt, on && !g.hud.helpOpen);
    if (!on || !this.goal || !quiet) return;
    this.clock += dt;

    // A new goal: let it settle, then Ora speaks it (and Lumi and Fizz react to some).
    const goal = this.goal;
    if (goal.key !== this.spokenKey) {
      if (goal.key !== this.candidate) {
        this.candidate = goal.key;
        this.settle = 0;
      }
      this.settle += dt;
      if (this.settle < SETTLE) return;
      const prev = this.spokenKey.split(':');
      const first = this.spokenKey === '';
      // A new kind of goal, or the same kind at another village (not just a dream announced where we already were).
      const fresh = first || prev[0] !== goal.id || prev[1] !== goal.key.split(':')[1];
      this.spokenKey = goal.key;
      this.stuck = 0;
      this.nudges = 0;
      const c = this.ctx(goal, first && this.led.has(goal.id));
      // The tune step: every temple stands, so any goal line still waiting is stale; Ora's closing line goes now.
      this.ora?.guide(LEAD[goal.id](c), { clear: goal.id === 'tune' });
      const say = ADVISORS_ON[goal.id];
      if (say && fresh && !first) this.advisors?.say(say(c), { pri: 'important', topic: `story-${goal.id}`, cooldown: 120, argument: true });
      this.led.add(goal.id);
      return;
    }

    // Stuck: a gentle re-nudge, no more than once every couple of minutes.
    if (this.ora?.guideBusy) return;
    this.stuck += dt;
    const after = this.nudges >= NUDGE_SLOW_AFTER ? NUDGE_AFTER * 2 : NUDGE_AFTER;
    if (this.stuck >= after) this.nudge();
  }

  /** Ora re-nudges the current goal (also the debug handle). */
  nudge() {
    const goal = this.goal;
    if (!goal) return;
    this.stuck = 0;
    this.ora?.guide(NUDGE[goal.id](this.ctx(goal, false), this.nudges));
    this.nudges++;
    this.beacon.pulse();
    if (Math.random() < ADVISOR_NUDGE_CHANCE) {
      const line = ADVISOR_NUDGES[Math.floor(Math.random() * ADVISOR_NUDGES.length)];
      this.advisors?.say(line, { pri: 'chat', topic: 'story-nudge', cooldown: 400 });
    }
  }

  /** Debug/test: where the story stands. */
  state() {
    const g = this.goal;
    return {
      active: this.active,
      goal: g ? { id: g.id, key: g.key, village: g.village.name, via: g.via?.name ?? null, x: Math.round(g.pos.x), z: Math.round(g.pos.z) } : null,
      spoken: this.spokenKey,
      stuck: Math.round(this.stuck),
      nudges: this.nudges,
      beacon: this.beacon.at,
    };
  }
}
