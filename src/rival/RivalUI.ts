import type { Game } from '../Game';
import type { Advisors } from '../prayers/Advisors';
import { DIFFICULTY, MOOD_TEXT, RING, RIVAL_NAME, SCHEME_INFO, type Difficulty, type Line, type Mood, type RivalFace, type SchemeKind } from './data';
import './rival.css';

/**
 * His portraits (public/rival, cropped from the NAS board "2026-10-15 Vexahl portrait"): D, the hooded shadow with
 * ember eyes, when he speaks; E, the hand offering the smoking ring, when he tempts; F, turning away and dissolving,
 * when he is foiled or refused. 192 px for the round slot, 640 px for the temptation card. The Atlas-face portraits
 * (A2, B, C) are never loaded here: only the reveal in Whole shows them (src/endings/Reveal.ts).
 */
const PORTRAIT: Record<RivalFace, string> = { speak: 'd', tempt: 'e', foiled: 'f' };
export const portraitUrl = (id: string, size: 192 | 640) => `${import.meta.env.BASE_URL}rival/vexahl-${id}-${size}.webp`;

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
  private readonly faceImg: HTMLImageElement;
  private readonly tempt = document.createElement('div');
  private readonly temptText: HTMLDivElement;
  private readonly temptBar: HTMLElement;
  private readonly takeBtn: HTMLButtonElement;
  private readonly refuseBtn: HTMLButtonElement;
  /** The open offer: real seconds left to answer, and what to call with the answer (true = took it). */
  private offerLeft = 0;
  private onAnswer: ((took: boolean, timedOut: boolean) => void) | null = null;
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
    this.card.innerHTML = `<div class="rv-face"><img alt="" draggable="false"></div><div class="rv-body"><div class="rv-who">${RIVAL_NAME}</div><div class="rv-say"></div></div>`;
    this.cardText = this.card.querySelector('.rv-say')!;
    this.faceImg = this.card.querySelector('.rv-face img')!;
    this.setFace('speak');
    // Warm the other two (and the temptation card's large one), so a change of face never shows an empty circle.
    for (const id of ['e', 'f']) new Image().src = portraitUrl(id, 192);
    new Image().src = portraitUrl('e', 640);
    this.card.title = 'Click to dismiss';
    this.card.onclick = () => {
      this.cardLife = 0;
      this.silence();
    };
    game.hud.root.appendChild(this.card);

    // The ring: a larger, darker card in the same top-centre spot, E large, his offer and two choices.
    const t = this.tempt;
    t.className = 'rv-tempt';
    t.setAttribute('role', 'dialog');
    t.setAttribute('aria-label', `${RIVAL_NAME} offers you a ring`);
    t.innerHTML = `
      <div class="rt-art"><img alt="" draggable="false" src="${portraitUrl('e', 640)}"></div>
      <div class="rt-body">
        <div class="rv-who">${RIVAL_NAME} <span class="rt-sub">offers you a ring</span></div>
        <div class="rt-say"></div>
        <div class="rt-choices">
          <button class="rt-take" type="button">Take the ring</button>
          <button class="rt-refuse" type="button">Turn it down</button>
        </div>
        <div class="rt-bar"><i></i></div>
      </div>`;
    this.temptText = t.querySelector('.rt-say')!;
    this.temptBar = t.querySelector('.rt-bar i')!;
    this.takeBtn = t.querySelector('.rt-take')!;
    this.refuseBtn = t.querySelector('.rt-refuse')!;
    this.takeBtn.onclick = () => this.answer(true);
    this.refuseBtn.onclick = () => this.answer(false);
    // Clicks on the card never reach the world below it.
    t.addEventListener('pointerdown', (e) => e.stopPropagation());
    game.hud.root.appendChild(t);
  }

  private setFace(face: RivalFace) {
    const url = portraitUrl(PORTRAIT[face], 192);
    if (!this.faceImg.src.endsWith(url)) this.faceImg.src = url;
    this.card.dataset.face = face;
  }

  /** Is the ring's card up (waiting for an answer)? */
  get offering(): boolean {
    return this.onAnswer !== null;
  }

  /**
   * He offers the ring: his card gives way to the temptation card (E large, his line in his voice, "Take the ring" /
   * "Turn it down"). The world keeps going; the card waits RING.wait real seconds, then it counts as turned down.
   */
  async offer(line: Line, onAnswer: (took: boolean, timedOut: boolean) => void) {
    this.card.classList.remove('show');
    this.cardLife = 0;
    this.silence();
    this.onAnswer = onAnswer;
    this.offerLeft = RING.wait;
    this.temptText.textContent = line.text;
    this.temptBar.style.width = '100%';
    void this.tempt.offsetWidth;
    this.tempt.classList.add('show');
    // Keyboard: Tab between the two, Enter to choose. "Turn it down" has the focus (Space stays the game's).
    this.refuseBtn.focus({ preventScroll: true });
    let clip: AudioBuffer | null = null;
    try {
      clip = this.advisors?.muted ? null : await this.game.audio.advisorClip(line.text);
    } catch {
      clip = null;
    }
    if (!this.onAnswer) return;
    // The card holds at least as long as his voice, and a little more to choose.
    this.offerLeft = Math.max(this.offerLeft, (clip?.duration ?? 0) + 6);
    const stop = clip ? this.game.audio.playAdvisorClip(clip) : null;
    if (stop) this.stopVoice = stop;
    else if (!clip) this.game.audio.rivalVoice();
  }

  /** The player's answer (or the time running out: turned down). */
  answer(took: boolean, timedOut = false) {
    const fn = this.onAnswer;
    if (!fn) return;
    this.onAnswer = null;
    this.offerLeft = 0;
    this.tempt.classList.remove('show');
    this.tempt.classList.toggle('took', took);
    (document.activeElement as HTMLElement | null)?.blur?.();
    this.silence();
    // A beat before whatever he says next.
    this.wait = Math.max(this.wait, 0.8);
    fn(took, timedOut);
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
    return this.queue.length > 0 || this.cardLife > 0 || this.wait > 0 || this.loading || this.offering;
  }

  frame(dt: number) {
    if (this.game.hud.helpOpen) {
      this.card.classList.remove('show');
      if (!this.offering) this.silence();
      return;
    }
    if (this.offering) {
      // His offer holds the top centre: nothing else of his is said until it is answered.
      this.offerLeft -= dt;
      this.temptBar.style.width = `${Math.max(0, Math.min(100, (this.offerLeft / RING.wait) * 100)).toFixed(1)}%`;
      if (this.offerLeft <= 0) this.answer(false, true);
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
      if (this.game.hud.root.querySelector('.adv-card.show') && ++q.tries < 1800) return;
      this.queue.shift();
      void this.showRival(q.line.text, q, q.line.face);
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
  private async showRival(text: string, q?: (typeof this.queue)[number], face: RivalFace = 'speak') {
    this.loading = true;
    this.silence();
    let clip: AudioBuffer | null = null;
    try {
      clip = this.advisors?.muted ? null : await this.game.audio.advisorClip(text);
    } catch {
      clip = null;
    }
    this.loading = false;
    // A Lumi or Fizz card came up while his voice loaded: never stack on it; wait and try again.
    if (q && this.game.hud.root.querySelector('.adv-card.show') && q.tries < 1800) {
      this.queue.unshift(q);
      return;
    }
    this.cardText.textContent = text;
    this.setFace(face);
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
