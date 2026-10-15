import type { Game } from '../Game';
import type { Advisors } from '../prayers/Advisors';
import { DIFFICULTY, MOOD_TEXT, RIVAL_NAME, SCHEME_INFO, type Difficulty, type Line, type Mood, type SchemeKind } from './data';
import './rival.css';

const FACE = `<svg viewBox="0 0 58 58" aria-hidden="true">
  <path d="M10 58C10 36 17 16 29 12c12 4 19 24 19 46z" fill="#1a0d31"/>
  <path d="M17 24c2-9 6-14 12-16 6 2 10 7 12 16-3-3-7-5-12-5s-9 2-12 5z" fill="#2e1559"/>
  <path d="M17 36c1-7 5-11 12-11s11 4 12 11c-2 8-6 12-12 12s-10-4-12-12z" fill="#0c0617"/>
  <ellipse class="rv-eye" cx="23.5" cy="35" rx="3.2" ry="2" fill="#c8a8ff"/>
  <ellipse class="rv-eye" cx="34.5" cy="35" rx="3.2" ry="2" fill="#c8a8ff"/>
  <path d="M23.5 43q5.5 3 11 0" fill="none" stroke="#b48cff" stroke-width="1.4" stroke-linecap="round" opacity="0.7"/>
</svg>`;

/** Rough on-screen time for a card, mirroring the advisors' own timing so the conversation flows. */
const cardTime = (text: string) => Math.min(9.5, 3.8 + text.length * 0.05);

interface Queued {
  line: Line;
  /** Seconds to wait before this line. */
  delay: number;
  tries: number;
}

/** What the chip shows about the current scheme (null: between schemes). */
export interface ChipScheme {
  kind: SchemeKind;
  text: string;
  /** Seconds left, shown as m:ss. */
  time: number;
  /** 0..1 fill of the little bar. */
  progress: number;
  warning: boolean;
}

/**
 * The rival's UI: a small chip in the village list (mood, the current or upcoming scheme and its
 * countdown, schemes foiled), his speech card, and a conversation director that interleaves his
 * lines with Lumi's and Fizz's (their cards are the advisors' own).
 */
export class RivalUI {
  private readonly chip = document.createElement('div');
  private readonly moodEl = document.createElement('span');
  private readonly diffBtn = document.createElement('button');
  private readonly schemeEl = document.createElement('div');
  private readonly iconEl = document.createElement('span');
  private readonly txtEl = document.createElement('span');
  private readonly timeEl = document.createElement('span');
  private readonly bar = document.createElement('i');
  private readonly counter = document.createElement('div');
  private readonly peace = document.createElement('div');
  private readonly card = document.createElement('div');
  private readonly cardText: HTMLDivElement;
  private readonly queue: Queued[] = [];
  private readonly advisors: Advisors | null;
  private cardLife = 0;
  private wait = 0;
  private last = '';
  private loading = false;
  private stopVoice: (() => void) | null = null;
  onDifficulty: (() => void) | null = null;
  onScheme: (() => void) | null = null;

  constructor(private readonly game: Game) {
    this.advisors = (game as unknown as { prayerSystem?: { advisors?: Advisors } }).prayerSystem?.advisors ?? null;

    const c = this.chip;
    c.className = 'rv-chip';
    const head = document.createElement('div');
    head.className = 'rv-head';
    head.innerHTML = `<span class="rv-sigil">☾</span><span class="rv-name">${RIVAL_NAME}</span>`;
    this.moodEl.className = 'rv-mood';
    this.diffBtn.className = 'rv-diff';
    this.diffBtn.title = 'How hard he schemes: Gentle, Steady or Cunning';
    this.diffBtn.onclick = () => this.onDifficulty?.();
    head.append(this.moodEl, this.diffBtn);
    this.schemeEl.className = 'rv-scheme';
    this.iconEl.className = 'rv-icon';
    this.txtEl.className = 'rv-txt';
    this.timeEl.className = 'rv-time';
    this.schemeEl.append(this.iconEl, this.txtEl, this.timeEl);
    this.schemeEl.title = 'Click to look';
    this.schemeEl.onclick = () => this.onScheme?.();
    const track = document.createElement('div');
    track.className = 'rv-bar';
    track.appendChild(this.bar);
    this.counter.className = 'rv-counter';
    this.peace.className = 'rv-peace';
    c.append(head, this.schemeEl, track, this.counter, this.peace);
    (game.hud.root.querySelector('.villages') ?? game.hud.root).appendChild(c);

    this.card.className = 'rv-card';
    this.card.innerHTML = `<div class="rv-face">${FACE}</div><div class="rv-body"><div class="rv-who">${RIVAL_NAME}</div><div class="rv-say"></div></div>`;
    this.cardText = this.card.querySelector('.rv-say')!;
    this.card.title = 'Click to dismiss';
    this.card.onclick = () => {
      this.cardLife = 0;
      this.silence();
    };
    game.hud.root.appendChild(this.card);
  }

  show(on: boolean) {
    this.chip.classList.toggle('on', on);
  }

  /** Update the chip. Cheap enough to call every frame (it only touches the DOM when something changed). */
  setChip(o: {
    mood: Mood;
    difficulty: Difficulty;
    scheme: ChipScheme | null;
    next: number | null;
    foiled: number;
    goal: number;
    held: number;
    peace: number | null;
    retreated: boolean;
    /** Before the Wonder: there is no foil count to reach yet. */
    early?: boolean;
    /** Before the Wonder, with the world in tune: he is only watching. */
    quiet?: boolean;
  }) {
    const s = o.scheme;
    const sig = `${o.mood}|${o.difficulty}|${s?.kind}|${s ? Math.ceil(s.time) : o.next === null ? '-' : Math.ceil(o.next)}|${s?.warning}|${o.foiled}|${o.held}|${o.peace === null ? '-' : Math.round(o.peace * 100)}|${o.retreated}|${o.early}|${o.quiet}`;
    if (sig !== this.last) {
      this.last = sig;
      this.moodEl.textContent = MOOD_TEXT[o.mood];
      this.diffBtn.textContent = DIFFICULTY[o.difficulty].label;
      const fmt = (t: number) => {
        const n = Math.max(0, Math.ceil(t));
        return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
      };
      if (o.retreated) {
        this.iconEl.textContent = '🌅';
        this.txtEl.textContent = 'He sulks away. "On the next island!"';
        this.timeEl.textContent = '';
      } else if (s) {
        this.iconEl.textContent = SCHEME_INFO[s.kind].icon;
        this.txtEl.textContent = s.text;
        this.timeEl.textContent = fmt(s.time);
      } else if (o.quiet) {
        this.iconEl.textContent = '🌫️';
        this.txtEl.textContent = 'Watching from afar';
        this.timeEl.textContent = '';
      } else {
        this.iconEl.textContent = '💭';
        this.txtEl.textContent = 'Plotting his next scheme';
        this.timeEl.textContent = o.next === null ? '' : fmt(o.next);
      }
      this.chip.classList.toggle('warn', !!s && s.warning);
      this.counter.innerHTML = o.early
        ? `<span>Foiled <b>${o.foiled}</b></span><span>His villages <b>${o.held}</b></span>`
        : `<span>Foiled <b>${o.foiled}</b> / ${o.goal}</span><span>His villages <b>${o.held}</b></span>`;
      if (o.peace !== null && !o.retreated) {
        this.peace.style.display = '';
        this.peace.textContent = o.held === 0 ? `A season without a village: ${Math.round(o.peace * 100)}%` : 'Win back his villages to end his hold';
      } else this.peace.style.display = 'none';
    }
    this.bar.style.width = `${Math.round(100 * (s ? s.progress : 0))}%`;
  }

  /** Queue lines (his, Lumi's, Fizz's) to be said in order. */
  say(lines: Line | Line[], opts: { delay?: number } = {}) {
    const arr = Array.isArray(lines) ? lines : [lines];
    arr.forEach((line, i) => this.queue.push({ line, delay: i === 0 ? (opts.delay ?? 0) : 0.8, tries: 0 }));
  }

  /** Drop everything queued (not what is showing). */
  clearQueue() {
    this.queue.length = 0;
  }

  /** True while the conversation is still going. */
  get talking(): boolean {
    return this.queue.length > 0 || this.cardLife > 0 || this.wait > 0 || this.loading;
  }

  frame(dt: number) {
    if (this.game.hud.helpOpen) {
      this.card.classList.remove('show');
      this.silence();
      return;
    }
    if (this.cardLife > 0) {
      this.cardLife -= dt;
      if (this.cardLife <= 0) {
        this.card.classList.remove('show');
        this.silence();
      }
    }
    if (this.loading) return;
    if (this.wait > 0) {
      this.wait -= dt;
      return;
    }
    const q = this.queue[0];
    if (!q) return;
    if (q.line.who === 'rival') {
      // Lumi's and Fizz's cards share the top centre with his: let a card of theirs that is up finish first.
      if (this.game.hud.root.querySelector('.adv-card.show') && ++q.tries < 600) return;
      this.queue.shift();
      void this.showRival(q.line.text);
    } else {
      if (!this.advisors || this.advisors.muted) {
        this.queue.shift();
        return;
      }
      // Let a rival card finish before an advisor answers him.
      if (this.cardLife > 0) return;
      const ok = this.advisors.say({ who: q.line.who, text: q.line.text }, { pri: 'important', cooldown: 0 });
      if (ok) {
        this.queue.shift();
        this.wait = cardTime(q.line.text) + 2.4;
      } else if (++q.tries > 600) this.queue.shift();
    }
  }

  private silence() {
    this.stopVoice?.();
    this.stopVoice = null;
  }

  /** His card, with his recorded voice when there is one (the synth motif otherwise). The card stays up for the clip plus 0.6s. */
  private async showRival(text: string) {
    this.loading = true;
    this.silence();
    let clip: AudioBuffer | null = null;
    try {
      clip = this.advisors?.muted ? null : await this.game.audio.advisorClip(text);
    } catch {
      clip = null;
    }
    this.loading = false;
    this.cardText.textContent = text;
    void this.card.offsetWidth;
    this.card.classList.add('show');
    this.cardLife = Math.max(cardTime(text), (clip?.duration ?? 0) + 0.6);
    this.wait = this.cardLife + 0.6;
    const stop = clip ? this.game.audio.playAdvisorClip(clip) : null;
    if (stop) this.stopVoice = stop;
    else if (!clip) this.game.audio.rivalVoice();
  }

  /** A grander moment: the victory card when he retreats. */
  showVictory(stats: { foiled: number; wonBack: number; minutes: number }) {
    const el = document.createElement('div');
    el.className = 'overlay rv-win';
    el.innerHTML = `
      <div class="overlay-card">
        <h1>${RIVAL_NAME} Retreats</h1>
        <p class="tagline">The violet storm-eye over the far sea folds in on itself, and the spire sinks into the waves.</p>
        <div class="help-goal">Schemes foiled: <b>${stats.foiled}</b> · Hearts won back: <b>${stats.wonBack}</b> · Time since the Wonder: <b>${stats.minutes} min</b></div>
        <p class="tagline"><i>"I'll be back... on the next island!"</i></p>
        <button class="begin">Keep playing</button>
      </div>`;
    el.querySelector<HTMLButtonElement>('.begin')!.onclick = () => el.remove();
    this.game.hud.root.appendChild(el);
  }

  /** Tint the HUD banner violet for a moment (the banner is the HUD's; we only borrow its look). */
  banner(text: string, sub = '') {
    const g = this.game;
    const el = g.hud.root.querySelector('.banner');
    el?.classList.add('rv');
    g.hud.showBanner(text, sub);
    setTimeout(() => el?.classList.remove('rv'), 5400);
  }
}
