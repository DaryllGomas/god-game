import type * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import type { ProjectId } from '../projects/defs';
import { clamp } from '../util/math';
import { SkyStreaks } from './SkyStreak';
import { shrineGlow } from './ShrineVisual';
import {
  SHRINE_STAGES,
  STAGE_OF_PROJECT,
  isShrineStage,
  stageFromProjects,
  stageIndex,
  stagesUpTo,
  type ShrineStage,
} from './stages';

// ------------------------------------------------------------------ tuning knobs

/** Chance an answered prayer sends the visitor across a village's sky (stone circle and later). */
const STREAK_CHANCE = 0.55;
/** At least this long between two streaks anywhere (game seconds). */
const STREAK_GAP = 50;
/** Seconds after an age is raised before the visitor passes over it. */
const STREAK_AFTER_RAISE = 2.6;

/** The part of the projects system the shrines need (see src/projects). */
interface ProjectsLike {
  states: Map<Village, { done: Set<ProjectId>; index: number; site: unknown }>;
  syncToStage?(v: Village, stage: ShrineStage): void;
}

export interface ShrinesSave {
  /** Per village, in VILLAGE_SITES order: [stage, stages reached]. */
  v: [ShrineStage, ShrineStage[]][];
}

/**
 * The shrine track (see stages.ts): every village's prayer place grows from a totem to a stone circle,
 * a pyramid and a temple as its projects are finished (the Well raises the stones; the pyramid and the
 * temple are built at the prayer place itself). Owns `village.shrineStage` / `shrineStagesReached`,
 * emits `shrineRaised`, and sends the visitor (a streak of light) across a village's sky now and then
 * when you answer its prayers, once its people have raised stones to watch the sky from.
 *
 * Every village's temple standing is the island's end goal now (it replaced the Wonder): see
 * `game.allTemplesStand()`; the endings build on it.
 */
export class Shrines {
  readonly streaks: SkyStreaks;
  private lastStreak = -Infinity;
  /** Visitors waiting to cross (after a raise), in game time. */
  private readonly queued: { at: number; village: Village }[] = [];
  /** A save from before the shrine track: derive the stages from finished projects once everything has loaded. */
  private deriveFromProjects = false;
  private sparkleT = 0;
  private t = 0;

  constructor(private readonly game: Game) {
    this.streaks = new SkyStreaks(game.scene);
    // Keep the streaks out of the ambient-occlusion pre-pass (see plugins/postfx.ts).
    const g = game as unknown as { aoIgnore?: THREE.Object3D[] };
    (g.aoIgnore ??= []).push(this.streaks.group);
    const ev = game.events;
    ev.on('projectCompleted', ({ village, project }) => {
      const stage = STAGE_OF_PROJECT[project];
      if (stage) this.raise(village, stage);
    });
    ev.on('prayerAnswered', ({ village, kind }) => {
      if (kind === 'project') return; // a finished project raises an age, which sends its own
      if (stageIndex(village.shrineStage) < stageIndex('stone_circle')) return;
      if (game.time - this.lastStreak < STREAK_GAP || Math.random() > STREAK_CHANCE) return;
      this.queue(village, 0.8);
    });
    const loaded = game.saves.loaded;
    if (loaded && loaded.plugins.shrines === undefined) this.deriveFromProjects = true;
  }

  private get projects(): ProjectsLike | null {
    return (this.game as unknown as { projectSystem?: ProjectsLike }).projectSystem ?? null;
  }

  // ----------------------------------------------------------------- stages

  /**
   * The village's prayer place grows to `stage` (never back). Plays the arrival unless `instant`.
   * Returns true if it changed.
   */
  raise(v: Village, stage: ShrineStage, instant = false): boolean {
    if (stageIndex(stage) <= stageIndex(v.shrineStage)) return false;
    v.shrineStage = stage;
    for (const s of stagesUpTo(stage)) if (!v.shrineStagesReached.includes(s)) v.shrineStagesReached.push(s);
    v.worship.setStage(stage, !instant);
    if (instant) return true;

    const g = this.game;
    const p = v.worship.pos;
    const top = v.worship.topHeight;
    g.fx.sparkle(p.x, p.y + top * 0.6, p.z, 90, 0xfff0b0, 9);
    g.fx.sparkle(p.x, p.y + top + 3, p.z, 30, 0xfff6dc, 3);
    if (stage === 'stone_circle') {
      // The stones come up out of the earth (ShrineVisual): dust round the ring as they rise.
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        g.fx.dust(p.x + Math.cos(a) * 10.6, p.y + 0.5, p.z + Math.sin(a) * 10.6, 10, 1.1, 0xb8ab94);
      }
      g.audio.stoneSet(p, 2.6);
      g.shake(0.25);
    } else if (stage === 'temple') g.audio.wonderCalls();
    if (v.owner === 'player') g.message(`${v.name} raised a ${stageName(stage)}.`, 'divine', `shrine-${v.name}`);
    g.events.emit('shrineRaised', { village: v, stage });
    this.queue(v, STREAK_AFTER_RAISE);
    return true;
  }

  /**
   * Debug: put a village's prayer place at `stage` right now (forwards or back), and line its project
   * chain up with it. `animate` plays the arrival.
   */
  setStage(which: Village | number | string, stage: ShrineStage, animate = false): Village | null {
    const v = this.village(which);
    if (!v || !isShrineStage(stage)) return null;
    this.projects?.syncToStage?.(v, stage);
    if (animate && stageIndex(stage) > stageIndex(v.shrineStage)) {
      // Arrive from the age before, so the moment plays as it would in the game.
      const before = SHRINE_STAGES[stageIndex(stage) - 1];
      v.shrineStage = before;
      v.worship.setStage(before, false);
      this.raise(v, stage);
    } else {
      v.shrineStage = stage;
      v.shrineStagesReached.length = 0;
      v.shrineStagesReached.push(...stagesUpTo(stage));
      v.worship.setStage(stage, animate);
    }
    return v;
  }

  /** Every village is yours and its temple stands: the island's end goal. */
  allTemplesStand(): boolean {
    const vs = this.game.villages;
    return vs.length > 0 && vs.every((v) => v.owner === 'player' && v.shrineStage === 'temple');
  }

  state() {
    return this.game.villages.map((v) => ({ village: v.name, stage: v.shrineStage, reached: [...v.shrineStagesReached] }));
  }

  private village(which: Village | number | string): Village | null {
    const vs = this.game.villages;
    if (typeof which === 'number') return vs[which] ?? null;
    if (typeof which === 'string') return vs.find((v) => v.name.toLowerCase() === which.toLowerCase()) ?? null;
    return which;
  }

  // ---------------------------------------------------------------- the visitor

  private queue(v: Village, delay: number) {
    this.lastStreak = this.game.time;
    this.queued.push({ at: this.game.time + delay, village: v });
  }

  /** Debug: send the visitor across a village's sky now. */
  streak(which: Village | number | string = 0) {
    const v = this.village(which);
    if (!v) return;
    this.launch(v, true);
  }

  /** The visitor crosses the view only when the village is in it (no light for nobody to see). */
  private launch(v: Village, force = false) {
    const g = this.game;
    const p = v.center.clone().project(g.godCam.camera);
    if (!force && (p.z > 1 || Math.abs(p.x) > 1.4 || Math.abs(p.y) > 1.4)) return;
    const mid = this.streaks.launch(v.center, g.godCam.camera, (x, z) => g.terrain.heightAt(x, z));
    g.audio.runeLit(mid);
  }

  // ---------------------------------------------------------------- simulation

  update(_dt: number) {
    if (this.deriveFromProjects) this.derive();
    const now = this.game.time;
    for (let i = this.queued.length - 1; i >= 0; i--) {
      if (now < this.queued[i].at) continue;
      const { village } = this.queued[i];
      this.queued.splice(i, 1);
      this.launch(village);
    }
  }

  frame(dt: number) {
    if (this.deriveFromProjects) this.derive();
    this.t += dt;
    const g = this.game;
    const night = 1 - clamp(g.sky.daylight * 1.5, 0, 1);
    shrineGlow(night, this.t);
    for (const v of g.villages) v.worship.shrine.frame(dt, night);
    const heads = this.streaks.frame(dt);
    this.sparkleT -= dt;
    if (heads.length && this.sparkleT <= 0) {
      this.sparkleT = 0.06;
      for (const h of heads) g.fx.sparkle(h.x, h.y, h.z, 2, 0xffe6a8, 1.2);
    }
  }

  // ------------------------------------------------------------- save / load

  save(): ShrinesSave {
    return { v: this.game.villages.map((v) => [v.shrineStage, [...v.shrineStagesReached]]) };
  }

  load(data: unknown) {
    const d = data as Partial<ShrinesSave>;
    if (!Array.isArray(d?.v)) {
      this.deriveFromProjects = true;
      return;
    }
    this.deriveFromProjects = false;
    this.game.villages.forEach((v, i) => {
      const row = d.v![i];
      if (!row || !isShrineStage(row[0])) return;
      const reached = Array.isArray(row[1]) ? row[1].filter(isShrineStage) : [];
      v.shrineStage = row[0];
      v.shrineStagesReached.length = 0;
      for (const s of [...stagesUpTo(row[0]), ...reached]) if (!v.shrineStagesReached.includes(s)) v.shrineStagesReached.push(s);
      v.worship.setStage(row[0], false);
    });
  }

  /** A save from v0.4 (or early v0.5): the finished Well / Temple / Harvest Festival become the stages. */
  private derive() {
    this.deriveFromProjects = false;
    const ps = this.projects;
    if (!ps) return;
    for (const v of this.game.villages) {
      const vs = ps.states.get(v);
      if (!vs) continue;
      const stage = stageFromProjects(vs.done);
      v.shrineStage = stage;
      v.shrineStagesReached.length = 0;
      v.shrineStagesReached.push(...stagesUpTo(stage));
      v.worship.setStage(stage, false);
    }
  }
}

/** Plain words for the message feed. */
export function stageName(s: ShrineStage): string {
  return s === 'stone_circle' ? 'stone circle' : s;
}

