import type { Game } from '../Game';
import './ora.css';

// ------------------------------------------------------------- tuning knobs

/** At most this many lines in one sitting, and never closer together than this (real seconds). */
const MAX_PER_SESSION = 5;
const MIN_GAP = 100;
/** A moment that can't be spoken within this long (advisors talking, help open...) is let go. */
const STALE_AFTER = 60;
/** Quiet time after a Lumi or Fizz card before Ora speaks, so the voices never overlap. */
const AFTER_ADVISORS = 3;
/** On screen: fade in, hold (grows with the line's length), fade out. Real seconds. */
const FADE_IN = 1.6;
const HOLD_BASE = 3.4;
const HOLD_PER_CHAR = 0.055;
const HOLD_MAX = 8.5;
const FADE_OUT = 2;

/** Balance 0..1. Below IMBALANCE for IMBALANCE_FOR game seconds is "the first sign of real imbalance". */
const IMBALANCE = 0.4;
const IMBALANCE_FOR = 8;
/** Back above RECOVERED for RECOVERED_FOR game seconds after an imbalance: it settles. */
const RECOVERED = 0.62;
const RECOVERED_FOR = 30;
/** Alignment (-1 cruel .. 1 kind) past these is a turn toward an extreme; it must come back past the inner value to count again. */
const KIND_EXTREME = 0.7;
const CRUEL_EXTREME = -0.6;
const EXTREME_RESET = 0.45;
/** A long quiet stretch of good tending: balance at least this, no cruelty, and a few prayers answered, for this long (game seconds). */
const TENDING_BALANCE = 0.66;
const TENDING_FOR = 480;
const TENDING_PRAYERS = 2;
/** Repeats of the same kind of moment (after the first on an island) wait at least this long (game seconds). */
const REPEAT_AFTER = 900;
/** Lumi and Fizz have spoken this many cards (both of them) and you've played this long (real seconds): Ora notices the two of them. */
const BINARY_CARDS = 6;
const BINARY_AFTER = 300;

// ------------------------------------------------------------------ the words

export type OraMoment = 'firstAnswer' | 'imbalance' | 'recovered' | 'cruel' | 'kind' | 'tending' | 'binary' | 'pace' | 'paceCheck' | 'mode';

/** Story mode's guide lines (src/story) wait at least this long after Ora's last line (real seconds), not MIN_GAP. */
const GUIDE_GAP = 6;

/**
 * Ora never instructs. It notices, asks, warns once, or offers a flash of insight, then leaves you to choose
 * ("your path is to walk your own path"). Calm, kind, a little mysterious. Ora is "it", never she or he.
 */
export const ORA_LINES: Record<OraMoment, readonly string[]> = {
  firstAnswer: ['They asked, and you answered. Something between you just began.', 'Did you feel that? That is what being heard feels like, from their side.'],
  imbalance: [
    'Something just went a little out of tune. Can you hear it?',
    'The colour is thinner over there. Was it always?',
    'A world can only hold so much. It never says when it is full.',
  ],
  recovered: ['There. Hear how it settles?'],
  cruel: ['Every throw lands somewhere. Have you looked where?', 'The sea looks darker on that side. Did you notice?', 'Who taught you that? ...Oh. I see.'],
  kind: [
    'So much kindness. Do they still get to choose anything for themselves?',
    'Goodness held too tightly starts looking for someone who is not good enough.',
    'Even light needs a little shadow to be seen.',
  ],
  tending: ['Listen. It is in tune.', 'Nothing happened just now. That is the hardest thing to make.', 'They look up at the sky a little less. I think that is a good sign.'],
  pace: ['Walk on, or stay a while?'],
  /** A new island once story mode is beaten (src/story): the road is the story again, the hearth is free play. */
  mode: ['You have walked this road before. Walk it again, or simply stay a while?'],
  paceCheck: ['Walk on, or stay a little longer?', 'Still the same pace for you? Walk on, or stay?', 'Would you walk on now, or stay a while more?'],
  binary: ['Hmm. Those two only ever see one side each, don\'t they?', 'One pulls up, one pulls down. Where would you stand, without either?'],
};

/** Which moment wins when two are waiting. */
const RANK: Record<OraMoment, number> = { imbalance: 6, cruel: 5, kind: 5, firstAnswer: 4, recovered: 3, tending: 2, binary: 1, pace: 4, paceCheck: 1, mode: 4 };

const ORB = `<svg viewBox="0 0 40 40" aria-hidden="true">
  <defs><radialGradient id="ora-core" cx="50%" cy="50%" r="50%">
    <stop offset="0" stop-color="#ffffff"/><stop offset="0.28" stop-color="#eaf7ff"/><stop offset="0.62" stop-color="#9fdcff" stop-opacity="0.55"/><stop offset="1" stop-color="#5fb8ff" stop-opacity="0.12"/>
  </radialGradient></defs>
  <circle cx="20" cy="20" r="17" fill="url(#ora-core)"/>
  <g class="ora-rings" fill="none" stroke="#e4f6ff" stroke-width="0.8">
    <ellipse cx="20" cy="20" rx="17" ry="5.5"/>
    <ellipse cx="20" cy="20" rx="17" ry="5.5" transform="rotate(60 20 20)"/>
    <ellipse cx="20" cy="20" rx="17" ry="5.5" transform="rotate(120 20 20)"/>
  </g>
  <g class="ora-rings ora-rings-b" fill="none" stroke="#bfe6ff" stroke-width="0.6" opacity="0.7">
    <ellipse cx="20" cy="20" rx="17" ry="11"/>
    <ellipse cx="20" cy="20" rx="11" ry="17"/>
  </g>
  <circle cx="20" cy="20" r="17" fill="none" stroke="#cfeeff" stroke-width="0.9" opacity="0.8"/>
  <path d="M20 11.5l1.1 7.4 7.4 1.1-7.4 1.1-1.1 7.4-1.1-7.4-7.4-1.1 7.4-1.1z" fill="#fff"/>
</svg>`;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

interface Pending {
  moment: OraMoment;
  /** Real seconds since it was raised. */
  age: number;
}

interface OraSave {
  said?: string[];
  once?: string[];
}

// ---------------------------------------------------------------- the voice

/**
 * Ora, the voice of balance: a perfectly round sphere of light and one soft line of italic text, no box.
 * Rare by design (a handful of lines a session at most), at the big moments: the first answered prayer,
 * the first sign of imbalance, a turn toward either extreme, a long quiet stretch of good tending.
 */
export class Ora {
  private readonly el: HTMLDivElement;
  private readonly lineEl: HTMLDivElement;
  /** Lines already spoken on this island (saved), so it rarely repeats itself. */
  private readonly said = new Set<string>();
  /** Moments already marked on this island (saved): the first of each kind is special. */
  private readonly once = new Set<OraMoment>();
  private readonly lastOf = new Map<OraMoment, number>();
  private pending: Pending | null = null;
  /** Story mode (src/story): the next goal, in Ora's words. Spoken before any waiting moment; never goes stale. */
  /** Guide lines waiting their turn (story mode), oldest first; a repeat of one already waiting is dropped. */
  private readonly guideQueue: string[] = [];
  /** The line on screen is a guide line. */
  private guiding = false;
  private spoken = 0;
  private clock = 0;
  private lastSpoke = -1e9;
  private advisorQuietSince = 0;
  private advisorWasShowing = false;
  private advisorCards = { spirit: 0, imp: 0 };
  /** The line on screen: its phase timer and how long it holds. */
  private showing = false;
  private t = 0;
  private hold = 0;

  // What it watches.
  private answeredSeen = -1;
  private low = 0;
  private high = 0;
  private wasImbalanced = false;
  private kindArmed = true;
  private cruelArmed = true;
  private stretch = 0;
  private stretchAnswered = 0;
  private lastCruel = -1e9;
  private sample = 0;
  private balanceEst = 0.7;
  private treeHigh = 0;

  constructor(private readonly game: Game) {
    this.el = document.createElement('div');
    this.el.className = 'ora';
    this.el.setAttribute('role', 'status');
    this.el.setAttribute('aria-live', 'polite');
    this.el.innerHTML = `<div class="ora-orb">${ORB}</div><div class="ora-line"></div>`;
    this.lineEl = this.el.querySelector('.ora-line')!;
    game.hud.root.appendChild(this.el);

    const cruel = () => (this.lastCruel = game.time);
    game.events.on('villagerDied', ({ byPlayer }) => byPlayer && cruel());
    game.events.on('houseDestroyed', ({ byPlayer }) => byPlayer && cruel());
    game.events.on('miracle', ({ id }) => id === 'fire' && cruel());
  }

  save(): OraSave {
    return { said: [...this.said], once: [...this.once] };
  }

  load(data: unknown) {
    const d = (data ?? {}) as OraSave;
    for (const s of d.said ?? []) if (typeof s === 'string') this.said.add(s);
    for (const m of d.once ?? []) if (m in ORA_LINES) this.once.add(m as OraMoment);
  }

  /** The world's balance 0..1: the balance system's own value when it is there, else a rough local estimate. */
  balance(): number {
    const b = (this.game as unknown as { balance?: unknown }).balance;
    if (typeof b === 'number' && Number.isFinite(b)) return clamp01(b);
    if (b && typeof b === 'object') {
      for (const k of ['value', 'level', 'current', 'smoothed']) {
        const v = (b as Record<string, unknown>)[k];
        if (typeof v === 'number' && Number.isFinite(v)) return clamp01(v);
      }
    }
    return this.balanceEst;
  }

  /** Raise a moment; it is spoken when the stage is quiet (or let go if it never is). Returns false if Ora holds its tongue. */
  raise(moment: OraMoment, force = false): boolean {
    if (!force) {
      if (this.spoken >= MAX_PER_SESSION) return false;
      const last = this.lastOf.get(moment);
      if (last !== undefined && this.game.time - last < REPEAT_AFTER) return false;
    }
    if (this.pending && RANK[this.pending.moment] > RANK[moment] && !force) return false;
    this.pending = { moment, age: 0 };
    if (force) this.lastSpoke = -1e9;
    return true;
  }

  /**
   * Story mode only (Daryll, 2026-10-14: "Ora kind of guiding you through it"): name the next goal. A guide line
   * replaces any guide line still waiting, is spoken when the stage is quiet, and doesn't count toward the
   * rare-insight limit. Free play never calls this.
   */
  guide(text: string) {
    if (text.trim() && !this.guideQueue.includes(text)) this.guideQueue.push(text);
    if (this.guideQueue.length > 3) this.guideQueue.shift();
  }

  /** A guide line is waiting or on screen. */
  get guideBusy(): boolean {
    return this.guideQueue.length > 0 || (this.showing && this.guiding);
  }

  /** Debug/test: the state of the watchers. */
  state() {
    return {
      balance: Math.round(this.balance() * 100) / 100,
      fromBalanceSystem: typeof (this.game as unknown as { balance?: unknown }).balance !== 'undefined',
      spoken: this.spoken,
      pending: this.pending?.moment ?? null,
      guide: this.guideQueue[0] ?? null,
      showing: this.showing ? this.lineEl.textContent : null,
      once: [...this.once],
    };
  }

  // ------------------------------------------------------------- per frame

  /** Simulation step (game seconds): watch the world for the moments. */
  update(dt: number) {
    const g = this.game;
    this.sample += dt;
    if (this.sample >= 1) {
      this.sample = 0;
      this.estimate();
    }

    // The first answered prayer.
    const answered = (g as unknown as { prayerSystem?: { answered?: number } }).prayerSystem?.answered ?? 0;
    if (this.answeredSeen < 0) this.answeredSeen = answered;
    if (answered > this.answeredSeen) {
      this.stretchAnswered += answered - this.answeredSeen;
      if (this.answeredSeen === 0 && !this.once.has('firstAnswer')) this.raise('firstAnswer');
      this.answeredSeen = answered;
    }

    // Balance: the first real sign of imbalance, and the settling after it.
    const bal = this.balance();
    this.low = bal < IMBALANCE ? this.low + dt : 0;
    this.high = bal > RECOVERED ? this.high + dt : 0;
    if (this.low >= IMBALANCE_FOR && !this.wasImbalanced && g.time > 90) {
      this.wasImbalanced = true;
      this.raise('imbalance');
    }
    if (this.wasImbalanced && this.high >= RECOVERED_FOR) {
      this.wasImbalanced = false;
      if (this.once.has('imbalance') && !this.once.has('recovered')) this.raise('recovered');
    }

    // A turn toward either extreme of alignment (kind or cruel: the path is not going to an extreme).
    const a = g.player.alignment;
    if (a > KIND_EXTREME && this.kindArmed) {
      this.kindArmed = false;
      this.raise('kind');
    } else if (a < EXTREME_RESET) this.kindArmed = true;
    if (a < CRUEL_EXTREME && this.cruelArmed) {
      this.cruelArmed = false;
      this.raise('cruel');
    } else if (a > -EXTREME_RESET) this.cruelArmed = true;

    // A long quiet stretch of good tending.
    if (bal >= TENDING_BALANCE && g.time - this.lastCruel > TENDING_FOR) this.stretch += dt;
    else {
      this.stretch = 0;
      this.stretchAnswered = 0;
    }
    if (this.stretch >= TENDING_FOR && this.stretchAnswered >= TENDING_PRAYERS) {
      this.stretch = 0;
      this.stretchAnswered = 0;
      this.raise('tending');
    }
  }

  /** Every rendered frame (real seconds): wait for a quiet stage, then fade the line in and out. */
  frame(dt: number) {
    const g = this.game;
    const hidden = g.hud.helpOpen;
    // Ora shares the top centre with the speaking characters: it steps aside while one of them talks.
    const card = !!g.hud.root.querySelector('.adv-card.show, .rv-card.show');
    this.el.classList.toggle('away', hidden || card);
    if (hidden) return;
    this.clock += dt;
    this.watchAdvisors();

    if (this.showing) {
      // Stepping aside for a speaking character pauses the line; it comes back when they're done.
      if (!card) this.t += dt;
      const end = FADE_IN + this.hold + FADE_OUT;
      if (this.t >= FADE_IN + this.hold) this.el.classList.remove('show');
      if (this.t >= end) this.showing = false;
      return;
    }

    const quiet = !card && !this.advisorWasShowing && this.clock - this.advisorQuietSince >= AFTER_ADVISORS;
    if (this.guideQueue.length) {
      if (!quiet || this.clock - this.lastSpoke < GUIDE_GAP || g.paused) return;
      const text = this.guideQueue.shift()!;
      this.show(text, true);
      return;
    }
    const p = this.pending;
    if (!p) return;
    p.age += dt;
    if (p.age > STALE_AFTER) {
      this.pending = null;
      return;
    }
    if (!quiet || this.clock - this.lastSpoke < MIN_GAP || g.paused) return;
    this.pending = null;
    this.speak(p.moment);
  }

  private speak(moment: OraMoment) {
    const pool = ORA_LINES[moment];
    const fresh = pool.filter((l) => !this.said.has(l));
    const line = (fresh.length ? fresh : pool)[Math.floor(Math.random() * (fresh.length || pool.length))];
    this.said.add(line);
    this.once.add(moment);
    this.lastOf.set(moment, this.game.time);
    this.spoken++;
    this.show(line, false);
  }

  private show(line: string, guide: boolean) {
    this.guiding = guide;
    this.lastSpoke = this.clock;
    this.lineEl.textContent = line;
    this.hold = Math.min(HOLD_MAX, HOLD_BASE + line.length * HOLD_PER_CHAR);
    this.t = 0;
    this.showing = true;
    this.el.style.setProperty('--ora-in', `${FADE_IN}s`);
    this.el.style.setProperty('--ora-out', `${FADE_OUT}s`);
    this.el.classList.remove('show');
    void this.el.offsetWidth; // restart the entrance
    this.el.classList.add('show');
  }

  /** Keep out of Lumi's and Fizz's way, and count their cards (for the "two sides" insight). */
  private watchAdvisors() {
    const card = this.game.hud.root.querySelector<HTMLElement>('.adv-card');
    const showing = !!card?.classList.contains('show');
    if (showing && !this.advisorWasShowing && card) {
      if (card.classList.contains('spirit')) this.advisorCards.spirit++;
      if (card.classList.contains('imp')) this.advisorCards.imp++;
      const { spirit, imp } = this.advisorCards;
      if (spirit > 0 && imp > 0 && spirit + imp >= BINARY_CARDS && this.clock > BINARY_AFTER && !this.once.has('binary')) this.raise('binary');
    }
    if (!showing && this.advisorWasShowing) this.advisorQuietSince = this.clock;
    this.advisorWasShowing = showing;
  }

  /**
   * A rough stand-in for the world's balance, used only until the balance system (game.balance) is in:
   * forests standing, people fed, faith held, no fires, no recent cruelty.
   */
  private estimate() {
    const g = this.game;
    let trees = 0;
    let burning = 0;
    for (const e of g.entities) {
      if (!e.alive) continue;
      if (e.kind === 'tree' && !(e as unknown as { charred?: boolean }).charred) trees++;
      if (e.burning) burning++;
    }
    this.treeHigh = Math.max(this.treeHigh, trees);
    const forest = this.treeHigh ? clamp01(trees / (this.treeHigh * 0.85)) : 1;
    let people = 0;
    let hungry = 0;
    let faith = 0;
    let owned = 0;
    for (const v of g.villages) {
      for (const p of v.villagers) {
        people++;
        if (p.hunger > 0.8) hungry++;
      }
      if (v.owner === 'player') {
        owned++;
        faith += v.belief / 100;
      }
    }
    const fed = people ? 1 - hungry / people : 1;
    const held = owned ? faith / owned : 0.5;
    const cruelty = g.time - this.lastCruel < 120 ? 0.15 : 0;
    const target = clamp01(0.3 * forest + 0.3 * fed + 0.25 * held + 0.15 - Math.min(0.3, burning * 0.02) - cruelty);
    this.balanceEst += (target - this.balanceEst) * 0.2;
  }
}
