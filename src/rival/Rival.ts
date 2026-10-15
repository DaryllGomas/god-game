import * as THREE from 'three';
import type { Game } from '../Game';
import type { Village } from '../village/Village';
import { Villager } from '../entities/Villager';
import type { Prayer, Prayers } from '../prayers/Prayers';
import type { PrayerBubbles } from '../prayers/PrayerBubbles';
import type { Advisors } from '../prayers/Advisors';
import type { Seasons } from '../seasons/Seasons';
import { SEA_LEVEL } from '../config';
import { clamp, lerp, smoothstep } from '../util/math';
import type { Balance } from '../balance/Balance';
import {
  ADVISOR_FOILED, ADVISOR_RETREAT, ADVISOR_START, ADVISOR_TURNED, ADVISOR_WON_BACK, ARRIVAL_LINES, ARRIVE_DELAY, ARRIVE_PATIENCE, CHILD_NAMES,
  DEPTHS, DIFFICULTY, EARLY, FIRST_SCHEME_DELAY, FOIL_GOAL, FOIL_POWER, HAND, IDLE_TAUNTS, MOOD_LINE_GAP, MOOD_TEXT, PEACE_SECONDS, QUIET, QUIET_LINES,
  RESUME_LINES, RETREAT_LINES, RIVAL_NAME, SCHEME_GAP, SCHEME_INFO, SCHEME_LINES, SCHEME_MIN_PRESSURE, STIR, STIR_LINES, TURNED_BELIEF, TURN_LINES,
  WONDER_LINES, WON_BACK_LINES, COURT, FAREWELL_LINES, NOTICE_LINES, ORA_NOTICE, RISE, BEAT_GLANCE, LEVEL_SECONDS, TEMPLE_LINES, ORA_TEMPLE,
  type Difficulty, type Line, type Mood, type SchemeKind,
} from './data';
import { stageIndex } from '../shrines/stages';
import { RivalIsle, TurnedMark } from './RivalVisuals';
import { GraspingHand, Blight, VioletStorm, Whispers, type Fading, type Outcome, type Scheme } from './Schemes';
import { RivalUI } from './RivalUI';

const STORE_KEY = 'godgame.rival.difficulty';
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const pick = <T>(a: readonly T[]): T => a[Math.floor(Math.random() * a.length)];
const fill = (l: Line, village: string): Line => ({ who: l.who, text: l.text.replace(/\{village\}/g, village) });
const fillAll = (ls: Line[], village: string) => ls.map((l) => fill(l, village));
/** How long the camera lingers on his isle at the arrival, in real seconds. */
const GLANCE = 9;

type PrayerSystem = Prayers & { bubbles: PrayerBubbles; advisors: Advisors };
interface Abducted {
  village: Village;
  /** Game time when they wash up on a beach. */
  at: number;
  name: string;
}

/**
 * The rival god: a jealous lord from across the sea who wants hearts, not war. His isle lies hidden under the sea
 * until your first pyramid stands; then it rises, and from then on his citadel grows a step with every age you raise
 * (Daryll, 2026-10-15: "they level up together"; see progress()). His temper follows the world's balance (see
 * src/balance): he stirs when it drops below STIR (which also raises him early, if the world falls first), his schemes
 * grow with how low it is, and above QUIET he goes quiet again. Once the Wonder is done he plays by the v0.4 rules: one
 * scheme at a time with breathing room between, until you foil four and keep him villageless for a
 * season. Every scheme is telegraphed and counterable; nothing is destroyed or killed; turned villages
 * can be won back.
 */
export class Rival {
  readonly name = RIVAL_NAME;
  /** 'dormant': under the sea, or risen but silent (free play, a calm world). 'present': he has shown himself (panel up). 'retreated': gone (after the Wonder). */
  stage: 'dormant' | 'present' | 'retreated' = 'dormant';
  /** The Wonder woke him fully: the v0.4 rules (schemes whatever the balance; he can be driven off). */
  wonder = false;
  /** Before the Wonder: the world is low enough that he schemes (between STIR and QUIET it keeps its last state). */
  stirring = false;
  mood: Mood = 'brooding';
  difficulty: Difficulty = 'steady';
  foiled = 0;
  succeeded = 0;
  wonBack = 0;
  turned = 0;
  scheme: Scheme | null = null;
  /** Seconds until the next scheme starts (game time). */
  nextIn = FIRST_SCHEME_DELAY;
  /** Seconds he has held no village (counts toward his retreat). */
  peaceT = 0;
  cursorOverHand = false;
  readonly ui: RivalUI;
  readonly isle: RivalIsle;
  readonly marks = new Map<Village, TurnedMark>();
  private readonly fading: Fading[] = [];
  private readonly abducted: Abducted[] = [];
  private readonly timers: { at: number; fn: () => void }[] = [];
  private clock = 0;
  private pending = false;
  private pendingWait = 0;
  private arrivedAt = 0;
  private lastKind: SchemeKind | null = null;
  private moodT = 0;
  private tauntT = 120;
  private snapshot: Prayer[] = [];
  private lastAnswered = 0;
  private lostId = 0;
  private moodLineAt = -1e9;
  /** Put the isle straight where the balance says on the first frame (a loaded island shouldn't drift in). */
  private snapIsle = true;
  /** The view to come back to while the camera is out at sea (x, z, distance, yaw, pitch). */
  private cam: { x: number; z: number; dist: number; dyaw: number; dpitch: number } | null = null;
  /** Story mode: he has noticed you (his rising at your first pyramid; see notice()). */
  noticed = false;
  /** His isle has risen from the sea (your first pyramid, or the world fell first). */
  risen = false;
  /** Steps his citadel has grown (one per age raised; see tierNow()). 0 before the rising. */
  tier = 0;
  /** The big beats already played: 'rise', 'temple' (the first temple), 'final' (every temple: his final form). */
  private readonly beats = new Set<string>();
  /** A big beat waiting for the camera (another glance was on). */
  private queuedBeat: 'temple' | 'final' | null = null;
  /** Settle his rising and growth from the world without a moment (a fresh island, or one just loaded). */
  private settle = true;
  /** Story mode: villages he has already made his one move on. */
  private readonly courted = new Set<string>();
  /** Story mode: game seconds each neighbour has believed in you a little (see COURT.after). */
  private readonly courtT = new Map<Village, number>();
  /** Game time his last scheme ended (spacing for the story moves). */
  private lastEnded = -1e9;
  /** Story mode, the tune step: his last word has been said; no more moves. */
  farewell = false;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();

  constructor(readonly game: Game) {
    try {
      const d = localStorage.getItem(STORE_KEY);
      if (d === 'gentle' || d === 'steady' || d === 'cunning') this.difficulty = d;
    } catch {
      /* storage unavailable: carry on */
    }
    this.ui = new RivalUI(game);
    this.ui.onDifficulty = () => this.setDifficulty(this.difficulty === 'gentle' ? 'steady' : this.difficulty === 'steady' ? 'cunning' : 'gentle');
    this.ui.onScheme = () => this.lookAtScheme();
    this.isle = new RivalIsle(game);
    // There from the first day: far out at sea, small and still while the world is in tune.
    this.isle.setPresent(true, true);
    this.isle.setBalance(this.balance, true);

    const ev = game.events;
    ev.on('wonderCompleted', () => {
      if (this.stage === 'retreated') return;
      this.wonder = true;
      if (this.stage === 'present') this.wonderWhilePresent();
      else if (!this.pending) {
        this.pending = true;
        this.pendingWait = 0;
      }
    });
    ev.on('gift', ({ village }) => this.scheme?.onGift(village));
    ev.on('miracle', ({ id, x, z }) => this.scheme?.onMiracle(id, x, z));
    ev.on('rainedOn', ({ village }) => this.scheme?.onRainedOn(village));
    ev.on('villageTurned', ({ village }) => this.onTurned(village));
    ev.on('villageConverted', ({ village }) => this.onWonBack(village));

    // Slapping his hand: a click on it, before the controls ever see the click.
    window.addEventListener('pointerdown', (e) => this.onPointer(e), true);
  }

  get diff() {
    return DIFFICULTY[this.difficulty];
  }

  private get balanceSystem(): Balance | null {
    return (this.game as unknown as { balance?: Balance }).balance ?? null;
  }

  /** The world's balance, 0..1 (see src/balance). */
  get balance(): number {
    return this.balanceSystem?.value ?? 0.75;
  }

  /** How hard the world's imbalance drives him: 0 at or above STIR, 1 at DEPTHS. */
  get pressure(): number {
    return smoothstep(STIR, DEPTHS, this.balance);
  }

  /** How hard his schemes bite: the difficulty, and before the Wonder how low the world has fallen. */
  get bite(): number {
    return this.diff.bite * (this.wonder ? 1 : lerp(EARLY.bite[0], EARLY.bite[1], this.pressure));
  }

  get prayers(): PrayerSystem | null {
    return (this.game as unknown as { prayerSystem?: PrayerSystem }).prayerSystem ?? null;
  }

  private get seasons(): Seasons | null {
    return (this.game as unknown as { seasons?: Seasons }).seasons ?? null;
  }

  get held(): Village[] {
    return this.game.villages.filter((v) => v.owner === 'rival');
  }

  private playerVillages(): Village[] {
    return this.game.villages.filter((v) => v.owner === 'player' && v.population > 0);
  }

  setDifficulty(d: Difficulty) {
    this.difficulty = d;
    try {
      localStorage.setItem(STORE_KEY, d);
    } catch {
      /* ignore */
    }
  }

  private setMood(m: Mood, seconds = 45) {
    this.mood = m;
    this.moodT = seconds;
  }

  private later(seconds: number, fn: () => void) {
    this.timers.push({ at: this.clock + seconds, fn });
  }

  // ---------------------------------------------------------------- arrival

  /** He arrives after the Wonder (the debug hook and the real thing). `quick` skips the camera glance and the long speeches. */
  arriveNow(quick = false) {
    if (this.stage !== 'dormant') return;
    const g = this.game;
    this.stage = 'present';
    this.wonder = true;
    this.pending = false;
    this.arrivedAt = g.time;
    this.nextIn = FIRST_SCHEME_DELAY * this.diff.gap;
    this.tauntT = rand(100, 160);
    this.setMood('scheming', 60);
    this.ui.show(true);
    this.isle.setPresent(true, quick);
    const rising = this.raise(quick);
    g.events.emit('rivalArrived', {});
    if (quick) return;
    this.isle.pulse(1.5);
    g.audio.rivalArrives();
    this.ui.banner('A shadow rises on the horizon', `Something across the sea has noticed your Wonder. ${RIVAL_NAME}, ${'Lord of the Far Shore'}, is watching.`);
    g.message(`${RIVAL_NAME} has arrived on a spire-isle across the sea.`, 'warn', 'rival-arrive');
    this.glance(true, rising ? this.shotPose() : undefined);
    this.later(rising ? RISE.back : GLANCE, () => this.glance(false));
    this.later(rising ? RISE.speak : 4, () => this.ui.say(ARRIVAL_LINES));
  }

  /**
   * Before the Wonder: the world has tipped far enough that he turns his attention to it. His panel
   * comes up and, a little later, his first small scheme. If his isle has not risen yet (no pyramid stands), the
   * world falling raises it now. `quick` skips the camera glance and the lines.
   */
  stir(quick = false) {
    if (this.stage !== 'dormant') return;
    const g = this.game;
    this.stage = 'present';
    this.noticed = true; // story mode: his rising has happened (here, or before), so no second one at the pyramid
    const rising = this.raise(quick);
    this.stirring = true;
    this.pending = false;
    this.arrivedAt = g.time;
    this.nextIn = FIRST_SCHEME_DELAY * this.diff.gap;
    this.tauntT = rand(100, 160);
    this.moodLineAt = g.time;
    this.setMood('scheming', 60);
    this.ui.show(true);
    g.events.emit('rivalArrived', {});
    if (quick) return;
    this.isle.pulse(1.2);
    g.audio.rivalArrives();
    this.ui.banner(rising ? 'Something rises across the sea' : 'Something stirs across the sea', '');
    g.message(`${RIVAL_NAME} is watching your island from his spire across the sea.`, 'warn', 'rival-stir');
    this.glance(true, rising ? this.shotPose() : undefined);
    this.later(rising ? RISE.back : 7, () => this.glance(false));
    this.later(rising ? RISE.speak : 3, () => this.ui.say(STIR_LINES));
  }

  // ------------------------------------------------------------ story mode

  /** Story mode is on and the island is in play (src/story). Free play keeps the balance-only rules. */
  private get storyMode(): boolean {
    const st = (this.game as unknown as { story?: { active: boolean } }).story;
    return !!st?.active;
  }

  // --------------------------------------------- he rises with you (2026-10-15)

  /** Ages raised across the island: every village's prayer place past its totem (stones 1, pyramid 2, temple 3). */
  private ages(): number {
    return this.game.villages.reduce((n, v) => n + stageIndex(v.shrineStage), 0);
  }

  /** The step his citadel stands at when every temple stands (his final form). */
  get maxTier(): number {
    return Math.max(2, this.game.villages.length * stageIndex('temple') - 1);
  }

  /**
   * The step his citadel has reached: one per age raised anywhere on the island (your first pyramid usually makes it
   * step 1: the home village's stones and pyramid), up to maxTier when every temple stands. 0 before the rising.
   */
  tierNow(): number {
    if (!this.risen) return 0;
    return clamp(this.ages() - 1, 1, this.maxTier);
  }

  private pyramidStands(): boolean {
    return this.game.villages.some((v) => stageIndex(v.shrineStage) >= stageIndex('pyramid'));
  }

  /** His isle rises (visuals and sound: the RISE timeline in RivalIsle). Returns true if it rises now, animated. */
  private raise(quick = false): boolean {
    if (this.risen) return false;
    this.risen = true;
    this.beats.add('rise');
    this.tier = this.tierNow();
    this.isle.setTier(this.tier, this.maxTier, quick);
    this.isle.rise(quick);
    if (quick) return false;
    const g = this.game;
    // A far, low rumble as the sea darkens, then his dark swell and bells as he surfaces; the ground trembles a little.
    g.audio.thunder(0.75);
    this.later(1.2, () => g.audio.rivalArrives());
    this.later(RISE.surface[0] + 0.6, () => g.shake(0.12));
    this.later(RISE.surface[0] + 3, () => g.shake(0.1));
    this.later(RISE.flare, () => this.isle.pulse(1.1));
    return true;
  }

  /**
   * Every game step: his rising at your first pyramid (anywhere), then a step of growth for every age you raise. A
   * loaded island (or one past these points) settles without the moments. Story mode plays the big beats (the
   * rising, the first temple, the last temple) with a glance out to sea; free play shows the same isle, no beats.
   */
  private progress() {
    const g = this.game;
    if (this.settle) {
      // Settle once everything has loaded: a fresh island has nothing yet; a loaded one is put where it stands.
      this.settle = false;
      if (!this.risen && this.pyramidStands()) this.risen = true;
      if (this.risen) {
        this.noticed = true;
        this.beats.add('rise');
        this.tier = this.tierNow();
        if (g.villages.some((v) => v.shrineStage === 'temple')) this.beats.add('temple');
        if (this.tier >= this.maxTier) this.beats.add('final');
        this.isle.setTier(this.tier, this.maxTier, true);
        this.isle.rise(true);
      }
      return;
    }
    if (!this.risen) {
      if (!this.pyramidStands()) return;
      if (this.storyMode && this.stage === 'dormant') this.notice();
      else {
        this.raise();
        if (!this.storyMode) g.message('Far out at sea, something rises from the water.', 'warn', 'rival-rise');
      }
      return;
    }
    const t = this.tierNow();
    if (t <= this.tier) return;
    this.tier = t;
    this.isle.setTier(t, this.maxTier);
    let big: 'temple' | 'final' | null = null;
    if (t >= this.maxTier && !this.beats.has('final')) big = 'final';
    else if (g.villages.some((v) => v.shrineStage === 'temple') && !this.beats.has('temple')) big = 'temple';
    if (big) {
      this.beats.add(big);
      if (big === 'final') this.beats.add('temple');
    }
    // Every step: a far rumble, and as the new spires climb out of the rock a flare and a ring on the water (if in view).
    g.audio.thunder(0.9);
    this.later(LEVEL_SECONDS * 0.85, () => {
      this.isle.pulse(big ? 1.1 : 0.7);
      this.isle.ring([10, big ? 200 : 120], 2.8, big ? 0.38 : 0.26);
    });
    if (big && this.storyMode && this.stage === 'present') {
      if (this.cam) this.queuedBeat = big;
      else this.beat(big);
    }
  }

  /** Story mode, a big step of his growth: the camera glances out to sea while it grows. */
  private beat(kind: 'temple' | 'final') {
    const g = this.game;
    this.queuedBeat = null;
    this.glance(true, this.shotPose(this.maxTier));
    this.later(BEAT_GLANCE[kind], () => this.glance(false));
    if (kind === 'temple') {
      g.message(`Out at sea, ${RIVAL_NAME}'s citadel has grown with your temple.`, 'warn', 'rival-grows');
      this.ora?.guide(ORA_TEMPLE, { first: true });
      this.later(LEVEL_SECONDS + 0.6, () => this.ui.say(TEMPLE_LINES));
    } else g.message(`Every temple stands, and out at sea ${RIVAL_NAME}'s citadel stands in its final form.`, 'warn', 'rival-final');
    // 'final': his last word comes from court() (the tune step), while the camera is out there.
  }

  private get ora(): { guide(t: string, o?: { first?: boolean }): void } | null {
    return (this.game as unknown as { ora?: { guide(t: string, o?: { first?: boolean }): void } }).ora ?? null;
  }

  /**
   * Story mode, the rising: your first pyramid stands and, out at the sea's edge, his isle rises. The camera glides out
   * to sea, the water darkens, the isle surfaces and his spire climbs out of the sea (RISE); Ora names it (text), then
   * he says his first line and Fizz answers. From here he is present (his chip in the village list) but quiet: he moves
   * only on the villages you are winning (court), or if the world tips (STIR).
   * `quick` (a loaded island, or he had already stirred) marks it without the moment.
   */
  notice(quick = false) {
    if (this.noticed) return;
    this.noticed = true;
    const g = this.game;
    if (this.stage !== 'dormant') return; // he already stirred (the world tipped first): nothing new to notice
    this.stage = 'present';
    this.arrivedAt = g.time;
    this.tauntT = rand(100, 160);
    this.setMood('brooding', 90);
    const rising = this.raise(quick);
    g.events.emit('rivalArrived', {});
    if (quick || !rising) {
      this.ui.show(true);
      return;
    }
    g.message(`Out at the sea's edge, something rises from the water.`, 'warn', 'rival-notice');
    this.glance(true, this.shotPose());
    // Ora names it at once, so its line goes ahead of the next goal's (src/story speaks that 1.5 s after the pyramid).
    this.ora?.guide(ORA_NOTICE, { first: true });
    this.later(RISE.speak - 0.4, () => this.ui.show(true));
    this.later(RISE.speak, () => this.ui.say(NOTICE_LINES));
    this.later(RISE.back, () => this.glance(false));
  }

  /**
   * Story mode: each village your light reaches (the one Ora asks you to win) draws ONE small move from him, soon
   * after it comes within reach (once the glance is over), one at a time, with room between. Whispers first (they
   * slow its belief), blight on a later village (its fields wither until a water miracle). Both are telegraphed on his card and counterable; neither can turn a
   * neutral village. When every temple stands he says his last word and stops (the tune step).
   */
  private court(dt: number) {
    const g = this.game;
    if (this.farewell) return;
    if (g.allTemplesStand()) {
      this.farewell = true;
      if (this.scheme?.courting) this.finish('faded');
      this.setMood('sulking', 1e9);
      this.ui.say(FAREWELL_LINES, { delay: 9 });
      return;
    }
    for (const v of g.villages) {
      const wooed = v.owner === null && v.population > 0 && g.withinReach(v) && !this.courted.has(v.name);
      if (wooed) this.courtT.set(v, (this.courtT.get(v) ?? 0) + dt);
      else this.courtT.delete(v);
    }
    // His lines queue behind whatever he is saying, so only the camera glance and another scheme hold him back.
    if (this.scheme || this.stirring || this.cam || g.time - this.lastEnded < COURT.gap) return;
    const v = [...this.courtT.keys()].find((x) => (this.courtT.get(x) ?? 0) >= COURT.after);
    if (!v) return;
    this.courted.add(v.name);
    this.courtT.delete(v);
    const fields = v.fields.filter((f) => f.alive && !f.burning).length;
    const s: Scheme = this.courted.size >= 2 && fields >= 2 ? new Blight(this, v) : new Whispers(this, v);
    s.courting = true;
    this.start(s);
  }

  /** The Wonder is finished while he is already here: from now on, the v0.4 rules. */
  private wonderWhilePresent() {
    this.stirring = true;
    this.nextIn = Math.min(this.nextIn, FIRST_SCHEME_DELAY * this.diff.gap);
    this.setMood('scheming', 90);
    this.isle.pulse(1.2);
    this.ui.say(WONDER_LINES, { delay: 8 });
  }

  /** Before the Wonder: go quiet when the world recovers past QUIET, and wake again below STIR. */
  private followBalance() {
    const g = this.game;
    const b = this.balance;
    const talk = g.time - this.moodLineAt > MOOD_LINE_GAP && !this.ui.talking;
    if (this.stirring && b > QUIET) {
      this.stirring = false;
      this.setMood('sulking', 120);
      if (talk) {
        this.moodLineAt = g.time;
        this.ui.say(pick(QUIET_LINES));
      }
    } else if (!this.stirring && b < STIR) {
      this.stirring = true;
      this.nextIn = Math.max(this.nextIn, 60 * this.diff.gap);
      this.setMood('scheming', 60);
      this.isle.pulse(0.8);
      if (talk) {
        this.moodLineAt = g.time;
        this.ui.say(pick(RESUME_LINES));
      }
    }
  }

  /**
   * The camera framing for a look at his citadel as it will stand at step `tier`: from the home village's side, low
   * over the water, his isle's foot a little below the middle of the view (the focus sits out past him) and his spires
   * and cloud crown rising into the sky above. Also the debug/test handle for a fixed view of him.
   */
  shotPose(tier = this.tier): { x: number; z: number; distance: number; pitch: number; yaw: number } {
    const k = clamp((Math.max(1, tier) - 1) / Math.max(1, this.maxTier - 1), 0, 1);
    const isle = this.isle.group.position;
    const home = this.game.villages.find((v) => v.isHome) ?? this.game.villages[0];
    const fx = home ? home.center.x : 0;
    const fz = home ? home.center.z : 0;
    const d = Math.max(1, Math.hypot(isle.x - fx, isle.z - fz));
    const beyond = lerp(25, 95, k);
    const x = isle.x + ((isle.x - fx) / d) * beyond;
    const z = isle.z + ((isle.z - fz) / d) * beyond;
    return { x, z, distance: lerp(195, 400, k), pitch: 0.23, yaw: Math.atan2(fx - x, fz - z) };
  }

  /**
   * Swing the camera out to sea so you see his isle, then bring it back. `shot` (the story beats): a framing from
   * shotPose(); otherwise a wide look from where you are, at least 360 m out.
   */
  private glance(on: boolean, shot?: { x: number; z: number; distance: number; pitch: number; yaw: number }) {
    const cam = this.game.godCam;
    const isle = this.isle.group.position;
    if (on) {
      if (this.cam) return; // already out at sea
      const was = cam.getPose();
      this.cam = { x: was.x, z: was.z, dist: was.distance, dyaw: was.yaw, dpitch: was.pitch };
      let pose;
      if (shot) pose = { ...shot };
      else {
        const px = was.x + (isle.x - was.x) * 0.3;
        const pz = was.z + (isle.z - was.z) * 0.3;
        pose = { x: px, z: pz, distance: Math.max(was.distance, 360), pitch: 0.3, yaw: Math.atan2(-(isle.x - px), -(isle.z - pz)) };
      }
      // The short way round.
      let dy = (pose.yaw - was.yaw) % (Math.PI * 2);
      if (dy > Math.PI) dy -= Math.PI * 2;
      if (dy < -Math.PI) dy += Math.PI * 2;
      pose.yaw = was.yaw + dy;
      cam.glideTo(pose, shot ? 2.6 : 1.8);
    } else if (this.cam) {
      const c = this.cam;
      this.cam = null;
      cam.glideTo({ x: c.x, z: c.z, distance: c.dist, yaw: c.dyaw, pitch: c.dpitch }, 2.4);
    }
  }

  lookAtScheme() {
    const f = this.scheme?.focus();
    const cam = this.game.godCam;
    if (f) cam.flyTo(f.x, f.z);
    else if (this.stage === 'present') {
      this.glance(true);
      this.later(6, () => this.glance(false));
    }
  }

  // ---------------------------------------------------------------- schemes

  /** Debug/test hook: start a scheme right now (stirring first if needed). Returns whether it started. */
  trigger(kind: SchemeKind, villageName?: string): boolean {
    if (this.stage === 'retreated') return false;
    if (this.stage === 'dormant') this.stir(true);
    if (this.scheme) this.finish('faded');
    const v = villageName ? this.game.villages.find((x) => x.name === villageName) : undefined;
    const s = this.makeScheme(kind, v);
    if (!s) return false;
    this.start(s);
    return true;
  }

  private makeScheme(kind: SchemeKind, forced?: Village): Scheme | null {
    const vs = this.playerVillages();
    if (!vs.length) return null;
    const weighted = (list: Village[]) => {
      const w = list.map((v) => (v.isHome ? 0.35 : 1));
      let r = Math.random() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < list.length; i++) if ((r -= w[i]) <= 0) return list[i];
      return list[0];
    };
    switch (kind) {
      case 'whispers': {
        const v = forced ?? weighted(vs);
        return v.owner === 'player' ? new Whispers(this, v) : null;
      }
      case 'blight': {
        const ok = vs.filter((v) => v.fields.filter((f) => f.alive && !f.burning).length >= 2);
        const v = forced ?? (ok.length ? weighted(ok) : null);
        return v ? new Blight(this, v) : null;
      }
      case 'hand': {
        const ok = vs.filter((v) => this.handTargets(v).length >= 3);
        const v = forced ?? (ok.length ? weighted(ok) : null);
        if (!v) return null;
        const targets = this.handTargets(v);
        return targets.length ? new GraspingHand(this, v, pick(targets)) : null;
      }
      case 'storm': {
        const s = this.seasons;
        if (!s || (!forced && s.storm)) return null;
        const first = forced ?? weighted(vs);
        const others = vs.filter((v) => v !== first).sort(() => Math.random() - 0.5).slice(0, 1);
        return new VioletStorm(this, first, others);
      }
    }
  }

  private handTargets(v: Village): Villager[] {
    return v.villagers.filter((x) => x.alive && !x.dead && !x.held && !x.airborne && !x.lost && !x.isInside && !x.burning);
  }

  private pickKind(): SchemeKind | null {
    // His schemes echo your cruelties: where you burned, he blights; where you threw villagers, he
    // snatches them; where you let them suffer, he whispers.
    const echo = this.balanceSystem?.echo ?? { burn: 0, throw: 0, neglect: 0 };
    const kinds: [SchemeKind, number][] = [
      ['whispers', 1.3 * (1 + Math.min(2, echo.neglect * 0.3))],
      ['blight', 1 + Math.min(2, echo.burn * 0.5)],
      ['hand', 1 + Math.min(2, echo.throw * 0.5)],
      ['storm', 0.8],
    ];
    // No second natural storm on top of his; and not the same trick twice running. Before the Wonder he starts small.
    const p = this.pressure;
    const options = kinds.filter(([k]) => k !== this.lastKind && (this.wonder || p >= SCHEME_MIN_PRESSURE[k]) && (k !== 'storm' || (!this.seasons?.storm && !this.seasons?.state().event?.startsWith('storm'))));
    while (options.length) {
      const total = options.reduce((a, [, w]) => a + w, 0);
      let r = Math.random() * total;
      let i = 0;
      for (; i < options.length - 1; i++) if ((r -= options[i][1]) <= 0) break;
      const [kind] = options.splice(i, 1)[0];
      if (this.makeProbe(kind)) return kind;
    }
    return null;
  }

  /** Could this kind start right now? */
  private makeProbe(kind: SchemeKind): boolean {
    const vs = this.playerVillages();
    if (!vs.length) return false;
    if (kind === 'blight') return vs.some((v) => v.fields.filter((f) => f.alive && !f.burning).length >= 2);
    if (kind === 'hand') return vs.some((v) => this.handTargets(v).length >= 3);
    if (kind === 'storm') return !!this.seasons && !this.seasons.storm;
    return true;
  }

  private start(s: Scheme) {
    const g = this.game;
    this.scheme = s;
    this.lastKind = s.kind;
    this.setMood('scheming', 90);
    const info = SCHEME_INFO[s.kind];
    const where = s.targets.map((v) => v.name).join(' and ');
    g.message(`${RIVAL_NAME}'s scheme: ${info.name} over ${where}. ${info.blurb}`, 'warn', 'scheme-start');
    this.ui.banner(`${info.name}: ${where}`, info.blurb);
    g.audio.schemeWarning();
    this.isle.pulse(1.2);
    const f = s.focus();
    const y = g.terrain.heightAt(f.x, f.z);
    g.floatText(f.x, y + 30, f.z, `${info.icon} ${info.name}!`, '#cfb2ff'); // starts above the village name label, not through it
    const lines = SCHEME_LINES[s.kind];
    this.ui.say(fill(pick(lines.start), s.village.name));
    if (s.kind !== 'hand' && s.kind !== 'storm') this.ui.say(fillAll(pick(ADVISOR_START[s.kind]), s.village.name));
    g.events.emit('schemeStarted', { kind: s.kind, village: s.village });
  }

  private finish(outcome: Outcome) {
    const s = this.scheme;
    if (!s) return;
    this.scheme = null;
    this.fading.push(...s.end(outcome));
    for (const v of s.targets) v.rivalPressure = 0;
    this.lastEnded = this.game.time;
    this.game.events.emit('schemeEnded', { kind: s.kind, village: s.village, outcome, courting: s.courting });
    this.nextIn = rand(SCHEME_GAP[0], SCHEME_GAP[1]) * this.diff.gap;
    const g = this.game;
    const lines = SCHEME_LINES[s.kind];
    const f = s.focus();
    const y = g.terrain.heightAt(f.x, f.z);
    if (outcome === 'foiled') {
      this.foiled++;
      this.setMood('sulking', 70);
      g.player.addPower(FOIL_POWER);
      g.player.shiftAlignment(0.01);
      g.audio.schemeFoiled();
      g.fx.sparkle(f.x, y + 6, f.z, 90, 0xfff0b0, 7);
      g.floatText(f.x, y + 30, f.z, 'Foiled!', '#bff0c0');
      g.message(`You foiled ${RIVAL_NAME}'s ${SCHEME_INFO[s.kind].name.toLowerCase()}! (+${FOIL_POWER} power) · ${this.foiled}/${FOIL_GOAL}`, 'good', 'scheme-foiled');
      this.ui.say(fill(pick(lines.foiled), s.village.name), { delay: 0.8 });
      if (Math.random() < 0.7) this.ui.say(fillAll(pick(ADVISOR_FOILED), s.village.name));
      g.events.emit('schemeFoiled', { kind: s.kind, village: s.village });
    } else if (outcome === 'succeeded') {
      this.succeeded++;
      this.setMood('smug', 60);
      g.audio.schemeStrikes(new THREE.Vector3(f.x, y, f.z));
      this.ui.say(fill(pick(lines.success), s.village.name), { delay: 0.8 });
    }
  }

  /** His drain brought a village to nothing: it turns. The home village never does. */
  turn(v: Village) {
    if (v.isHome || v.owner !== 'player') return;
    v.owner = 'rival';
    v.rivalPressure = 0;
    this.game.onVillageTurned(v);
  }

  private onTurned(v: Village) {
    const g = this.game;
    this.turned++;
    v.belief = TURNED_BELIEF;
    v.rivalPressure = 0;
    v.worshipFraction = 0.5;
    this.marks.get(v)?.dispose();
    this.marks.set(v, new TurnedMark(g, v));
    this.setMood('gloating', 90);
    this.peaceT = 0;
    this.ui.banner(`${v.name} turns to ${RIVAL_NAME}`, 'Their hearts are only borrowed. Impress them and answer their prayers to win them back.');
    g.message(`${v.name} has turned to ${RIVAL_NAME}. Win their hearts back!`, 'bad', 'village-turned');
    g.audio.villageTurns();
    g.fx.sparkle(v.center.x, v.center.y + 8, v.center.z, 140, 0xb48cff, 26);
    g.fx.sparkle(v.center.x, v.center.y + 6, v.center.z, 60, 0xff7a2a, 20);
    this.isle.pulse(1.5);
    this.ui.say(fill(pick(TURN_LINES), v.name), { delay: 1 });
    this.ui.say(fillAll(pick(ADVISOR_TURNED), v.name));
    if (this.scheme && this.scheme.targets.includes(v)) this.finish('succeeded');
  }

  private onWonBack(v: Village) {
    const mark = this.marks.get(v);
    if (!mark) return;
    mark.release();
    this.wonBack++;
    v.rivalPressure = 0;
    this.setMood('fuming', 70);
    this.ui.say(fill(pick(WON_BACK_LINES), v.name), { delay: 2 });
    this.ui.say(fillAll(pick(ADVISOR_WON_BACK), v.name));
  }

  // ---------------------------------------------------------- the hand's prey

  /** The hand closed on this villager: carried off across the sea (they will turn up on a beach). */
  abduct(v: Villager, village: Village) {
    const g = this.game;
    v.onPickup(g);
    village.removeVillager(v);
    v.leaveHome(g);
    g.remove(v);
    this.abducted.push({ village, at: g.time + rand(HAND.absence[0], HAND.absence[1]), name: pick(CHILD_NAMES) });
    g.message(`A villager of ${village.name} was carried off across the sea! They will be found again.`, 'bad', 'abducted');
    g.floatText(v.pos.x, v.pos.y + 6, v.pos.z, 'Carried off!', '#e0c8ff');
  }

  /** A carried-off villager washes up on a beach, wanting to be brought home. */
  private returnVillager(a: Abducted): boolean {
    const g = this.game;
    const spot = this.findBeach(a.village);
    const ps = this.prayers;
    if (!spot || !ps) return false;
    const v = new Villager(a.village, spot.x, spot.z, 91000 + Math.floor(Math.random() * 90000));
    v.pos.set(spot.x, g.terrain.heightAt(spot.x, spot.z), spot.z);
    v.hunger = 0.3;
    v.lost = true;
    v.object.scale.setScalar(0.82);
    a.village.addVillager(v);
    a.village.assignHome(v);
    g.add(v);
    v.object.position.copy(v.pos);
    g.fx.sparkle(v.pos.x, v.pos.y + 1.4, v.pos.z, 24, 0xcfe6ff, 2);
    const prayer: Prayer = {
      id: 800000 + ++this.lostId,
      kind: 'lost',
      village: a.village,
      icon: '🐚',
      text: `${a.name} washed up on a far beach! Please bring them home.`,
      thanks: 'Home at last!',
      bornAt: g.time,
      expiresAt: g.time + 360,
      need: 0,
      progress: 0,
      villager: v,
      childName: a.name,
    };
    ps.active.push(prayer);
    ps.bubbles.added(prayer);
    g.audio.prayerArrive();
    g.message(`${a.name} has turned up on a beach, far from ${a.village.name}. Carry them home!`, 'info', 'abducted-back');
    return true;
  }

  private findBeach(village: Village): { x: number; z: number } | null {
    const g = this.game;
    const n = new THREE.Vector3();
    let best: { x: number; z: number; d: number } | null = null;
    for (let i = 0; i < 500; i++) {
      const a = rand(0, Math.PI * 2);
      const d = rand(70, 340);
      const x = village.center.x + Math.cos(a) * d;
      const z = village.center.z + Math.sin(a) * d;
      const h = g.terrain.heightAt(x, z);
      if (h < 1.0 || h > 2.6 || g.terrain.normalAt(x, z, n).y < 0.8) continue;
      if (g.villages.some((o) => o.contains(x, z, 1.3))) continue;
      let wet = false;
      for (let k = 0; k < 6 && !wet; k++) wet = g.terrain.heightAt(x + Math.cos(k) * 8, z + Math.sin(k) * 8) < SEA_LEVEL - 0.3;
      if (!wet) continue;
      if (!best || d < best.d) best = { x, z, d };
      if (best.d < 140) break;
    }
    return best;
  }

  // ------------------------------------------------------------------ retreat

  /** Debug/test hook as well as the real ending. */
  retreatNow() {
    if (this.stage !== 'present') return;
    this.finish('faded');
    this.stage = 'retreated';
    const g = this.game;
    this.setMood('defeated', 1e9);
    this.ui.clearQueue();
    this.ui.say(RETREAT_LINES);
    this.ui.say(ADVISOR_RETREAT);
    this.ui.banner(`${RIVAL_NAME} retreats!`, '"I\'ll be back... on the next island!"');
    g.audio.rivalRetreats();
    g.message(`${RIVAL_NAME} has fled across the sea. "I'll be back... on the next island!"`, 'good', 'rival-retreat');
    this.isle.pulse(1.5);
    this.later(7, () => this.isle.setPresent(false));
    this.later(9, () => this.ui.showVictory({ foiled: this.foiled, wonBack: this.wonBack, minutes: Math.round((g.time - this.arrivedAt) / 60) }));
    g.events.emit('rivalRetreated', {});
  }

  // ---------------------------------------------------------------- the loop

  /** Simulation step (game seconds). */
  update(dt: number) {
    const g = this.game;
    // He rises with your first pyramid and grows with every age you raise.
    this.progress();
    // Before the Wonder, the world tipping far enough wakes him (and raises his isle, if no pyramid has yet).
    if (this.stage === 'dormant' && !this.pending && this.balance < STIR) this.stir();
    // Waiting for the Wonder's moment to pass.
    if (this.pending) {
      this.pendingWait += dt;
      const win = g.hud.root.querySelector('.overlay.win');
      const dismissed = !win || win.classList.contains('hidden');
      if (this.pendingWait >= ARRIVE_DELAY && (dismissed || this.pendingWait >= ARRIVE_PATIENCE)) this.arriveNow();
    }
    for (const m of this.marks.values()) m.step(dt);
    if (this.stage !== 'present') return;

    this.watchPrayers();
    this.updateMood(dt);

    // His carried-off villagers wash up.
    for (let i = this.abducted.length - 1; i >= 0; i--) {
      const a = this.abducted[i];
      if (g.time < a.at) continue;
      if (this.returnVillager(a)) this.abducted.splice(i, 1);
      else a.at = g.time + 10;
    }

    // Peace: how long he has held no village.
    if (this.held.length === 0) this.peaceT += dt;
    else this.peaceT = 0;

    if (!this.wonder) this.followBalance();
    if (this.storyMode && !this.wonder) this.court(dt);
    if (this.scheme) {
      const out = this.scheme.update(dt);
      if (out) this.finish(out);
    } else if (this.wonder || this.stirring) {
      // Before the Wonder the wait runs down faster the lower the world has fallen.
      this.nextIn -= dt * (this.wonder ? 1 : lerp(EARLY.pace[0], EARLY.pace[1], this.pressure));
      if (this.wonder && this.foiled >= FOIL_GOAL && this.peaceT >= PEACE_SECONDS) {
        this.retreatNow();
        return;
      }
      if (this.nextIn <= 0 && !this.ui.talking) {
        const kind = this.pickKind();
        const s = kind ? this.makeScheme(kind) : null;
        if (s) this.start(s);
        else this.nextIn = 20;
      }
    }
  }

  private updateMood(dt: number) {
    this.moodT -= dt;
    if (this.moodT <= 0) this.mood = this.held.length ? 'gloating' : this.scheme ? 'scheming' : this.wonder || this.stirring ? 'brooding' : 'sulking';
    // A little idle pettiness now and then.
    this.tauntT -= dt;
    if (this.tauntT <= 0 && !this.scheme && !this.ui.talking) {
      this.tauntT = rand(140, 240);
      // Story mode: he speaks at his moves (paced, see COURT), not in between, unless the world has stirred him.
      if (this.storyMode && !this.stirring && !this.wonder) return;
      this.ui.say(pick(this.wonder ? IDLE_TAUNTS : IDLE_TAUNTS.filter((l) => !l.text.includes('Wonder'))));
    }
  }

  /** Notice when a prayer was answered (not merely expired), so answering prayers can break the whispers. */
  private watchPrayers() {
    const ps = this.prayers;
    if (!ps) return;
    if (ps.answered !== this.lastAnswered) {
      for (const p of this.snapshot) {
        if (!ps.active.includes(p) && this.game.time < p.expiresAt - 0.6 && p.kind !== 'fire') this.scheme?.onPrayerAnswered(p.village);
      }
      this.lastAnswered = ps.answered;
    }
    this.snapshot = [...ps.active];
  }

  /** Per rendered frame (real seconds): visuals, speech and the chip. */
  frame(dt: number) {
    this.clock += dt;
    for (let i = this.timers.length - 1; i >= 0; i--) {
      if (this.clock >= this.timers[i].at) {
        const t = this.timers.splice(i, 1)[0];
        t.fn();
      }
    }
    if (this.queuedBeat && !this.cam) this.beat(this.queuedBeat);
    this.isle.setBalance(this.balance, this.snapIsle);
    this.snapIsle = false;
    this.isle.setAwake(this.stage === 'present');
    this.isle.frame(dt);
    this.ui.frame(dt);
    for (const [v, m] of this.marks) {
      m.frame(dt);
      if (m.gone) {
        m.dispose();
        this.marks.delete(v);
      }
    }
    this.scheme?.frame(dt);
    for (let i = this.fading.length - 1; i >= 0; i--) {
      const f = this.fading[i];
      f.frame(dt);
      if (f.finished) {
        f.dispose();
        this.fading.splice(i, 1);
      }
    }
    this.hoverHand();

    const s = this.scheme;
    const pace = this.wonder ? 1 : lerp(EARLY.pace[0], EARLY.pace[1], this.pressure);
    this.ui.setChip({
      mood: this.mood,
      difficulty: this.difficulty,
      scheme: s ? { kind: s.kind, text: s.chipText(), time: s.countdown(), progress: s.progress(), warning: s.phase === 'warning' } : null,
      next: this.stage === 'present' && (this.wonder || this.stirring) ? Math.max(0, this.nextIn / pace) : null,
      foiled: this.foiled,
      goal: FOIL_GOAL,
      held: this.held.length,
      peace: this.wonder && this.foiled >= FOIL_GOAL ? Math.min(1, this.peaceT / PEACE_SECONDS) : null,
      retreated: this.stage === 'retreated',
      early: !this.wonder,
      quiet: !this.wonder && !this.stirring && !s,
    });
    if (this.stage === 'dormant') this.ui.show(false);
  }

  /**
   * v0.5 endings (src/endings), Whole: he is drawn back into you. No lines, no retreat, no panel; he never
   * schemes or stirs again. His isle is left standing for the endings to dissolve into light.
   */
  reintegrate() {
    if (this.scheme) this.finish('faded');
    this.stage = 'retreated';
    this.pending = false;
    this.stirring = false;
    this.setMood('defeated', 1e9);
    this.ui.clearQueue();
    this.ui.show(false);
  }

  // --------------------------------------------------------------- the slap

  private hoverHand() {
    const s = this.scheme;
    const canvas = this.game.renderer.domElement;
    if (s instanceof GraspingHand && this.game.input.inside && !this.game.hud.helpOpen) {
      this.ndc.set(this.game.input.nx, this.game.input.ny);
      this.ray.setFromCamera(this.ndc, this.game.godCam.camera);
      this.cursorOverHand = s.hand.hitTest(this.ray);
    } else this.cursorOverHand = false;
    canvas.style.cursor = this.cursorOverHand ? 'pointer' : '';
  }

  private onPointer(e: PointerEvent) {
    const s = this.scheme;
    if (!(s instanceof GraspingHand) || e.target !== this.game.renderer.domElement || this.game.hud.helpOpen) return;
    const r = this.game.renderer.domElement.getBoundingClientRect();
    this.ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    this.ray.setFromCamera(this.ndc, this.game.godCam.camera);
    if (!s.hand.hitTest(this.ray)) return;
    e.stopPropagation();
    e.preventDefault();
    this.slapHand();
  }

  /** Slap the dark hand (a click on it does the same). */
  slapHand() {
    const s = this.scheme;
    if (!(s instanceof GraspingHand)) return false;
    (this.game.hand as unknown as { model?: { swat?: () => void } }).model?.swat?.();
    s.slap();
    return true;
  }

  // ------------------------------------------------------------ save / load

  /** Save/load: has he come, what has he done, who holds what. A scheme in flight is dropped (the next one is a little way off). */
  save() {
    const g = this.game;
    return {
      stage: this.stage,
      difficulty: this.difficulty,
      foiled: this.foiled,
      succeeded: this.succeeded,
      wonBack: this.wonBack,
      turned: this.turned,
      nextIn: Math.round((this.scheme ? rand(SCHEME_GAP[0], SCHEME_GAP[1]) * this.diff.gap : this.nextIn) * 10) / 10,
      peaceT: Math.round(this.peaceT * 10) / 10,
      pending: this.pending,
      wonder: this.wonder,
      stirring: this.stirring,
      arrivedAt: Math.round(this.arrivedAt * 10) / 10,
      noticed: this.noticed,
      courted: [...this.courted],
      farewell: this.farewell,
      risen: this.risen,
      // Villagers he carried off still wash up on a beach (time left, in game seconds).
      abducted: this.abducted.map((a) => ({ v: g.villages.indexOf(a.village), in: Math.round(Math.max(0, a.at - g.time)), name: a.name })),
    };
  }

  load(data: unknown) {
    const g = this.game;
    const d = data as ReturnType<Rival['save']>;
    if (d.difficulty === 'gentle' || d.difficulty === 'steady' || d.difficulty === 'cunning') this.difficulty = d.difficulty;
    this.foiled = d.foiled;
    this.succeeded = d.succeeded;
    this.wonBack = d.wonBack;
    this.turned = d.turned;
    this.peaceT = d.peaceT;
    this.arrivedAt = d.arrivedAt;
    this.nextIn = d.nextIn;
    // Before v0.5 he only ever came after the Wonder.
    this.wonder = typeof d.wonder === 'boolean' ? d.wonder : d.stage !== 'dormant' || !!d.pending;
    this.stirring = typeof d.stirring === 'boolean' ? d.stirring : d.stage === 'present';
    this.noticed = !!d.noticed;
    this.farewell = !!d.farewell;
    // Before 2026-10-15 his isle stood from the first day: an island where he had shown himself keeps him risen.
    this.risen = typeof d.risen === 'boolean' ? d.risen : d.stage !== 'dormant';
    this.settle = true;
    this.courted.clear();
    for (const n of d.courted ?? []) if (typeof n === 'string') this.courted.add(n);
    this.abducted.length = 0;
    for (const a of d.abducted ?? []) {
      const village = g.villages[a.v];
      if (village) this.abducted.push({ village, at: g.time + a.in, name: a.name });
    }
    // The Wonder was finished but he had not yet arrived: he is still on his way.
    if (d.stage === 'dormant') {
      this.pending = d.pending;
      this.pendingWait = 0;
      return;
    }
    this.stage = d.stage;
    this.pending = false;
    this.ui.show(true);
    this.lastAnswered = this.prayers?.answered ?? 0;
    if (d.stage === 'present') {
      this.tauntT = rand(100, 160);
      this.setMood(this.held.length ? 'gloating' : 'brooding', 60);
      this.isle.setPresent(true, true);
      this.isle.setBalance(this.balance, true);
      for (const v of this.held) this.marks.set(v, new TurnedMark(g, v));
    } else {
      this.setMood('defeated', 1e9);
      this.isle.setPresent(false, true);
    }
  }

  // --------------------------------------------------------------- for tests

  state() {
    const s = this.scheme;
    return {
      stage: this.stage,
      name: this.name,
      mood: MOOD_TEXT[this.mood],
      difficulty: this.difficulty,
      foiled: this.foiled,
      succeeded: this.succeeded,
      turned: this.turned,
      wonBack: this.wonBack,
      held: this.held.map((v) => v.name),
      wonder: this.wonder,
      stirring: this.stirring,
      balance: +this.balance.toFixed(3),
      pressure: +this.pressure.toFixed(2),
      bite: +this.bite.toFixed(2),
      isleNear: +this.isle.nearness.toFixed(2),
      nextIn: +this.nextIn.toFixed(1),
      peace: +this.peaceT.toFixed(1),
      peaceNeeded: PEACE_SECONDS,
      scheme: s ? { ...s.describe(), countdown: +s.countdown().toFixed(1), progress: +s.progress().toFixed(2) } : null,
      carriedOff: this.abducted.length,
      talking: this.ui.talking,
      noticed: this.noticed,
      courted: [...this.courted],
      farewell: this.farewell,
      risen: this.risen,
      tier: this.tier,
      maxTier: this.maxTier,
      isleGrowth: +this.isle.growth.toFixed(2),
      rising: +this.isle.risingFor.toFixed(1),
      beats: [...this.beats],
      glancing: !!this.cam,
    };
  }

  /** Debug: make a village turn (as if a scheme drained it). */
  forceTurn(villageName: string) {
    const v = this.game.villages.find((x) => x.name === villageName);
    if (v) this.turn(v);
    return v?.owner;
  }
}
