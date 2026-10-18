import type { Stage } from './Collapse';
import type { FinalBattle } from './FinalBattle';
import { portraitUrl } from '../rival/RivalUI';
import { RIVAL_NAME } from '../rival/data';
import { advisorPortraitUrl } from '../prayers/Advisors';

/**
 * The confrontation (Daryll, 2026-10-17/18). There is no battle at the end: "the battle is building the island out,
 * he is trying to stop you, can cause chaos and doom", and the game is "about healing more than beating and
 * dominating". So the end is words: as Whole begins, with his spire come in close, Vexahl makes his case (Clu to
 * Flynn: he only did what you wanted, the fast way, by fear), Lumi and Fizz answer, and Ora says it is not "away"
 * but "back". Then his hood falls (Reveal.ts) and the hands meet. After Ora's "There you are.", Lumi and Fizz have
 * the last word (AFTER_LINES, played by the Ascension).
 *
 * Every line is voiced from public/voice (Vexahl as The Predator, Lumi, Fizz); Ora has no voice, only its line and
 * its tone. Real seconds; the Ascension holds its own clock while a talk plays.
 */
export type Speaker = 'rival' | 'spirit' | 'imp' | 'ora';
export interface TalkLine {
  who: Speaker;
  text: string;
}

export const OPENING: TalkLine = { who: 'rival', text: 'Look at what you made. Every village, every temple. And not one of them fears you.' };
export const ARGUMENT: TalkLine = {
  who: 'rival',
  text: 'You wanted their hearts. I only wanted it done. Fear is quicker than love. I was trying to save you the time.',
};
export const RING_TAKEN: TalkLine = { who: 'rival', text: "And you took it. Don't pretend you didn't want to." };
export const RING_REFUSED: TalkLine = { who: 'rival', text: 'Every time you were tired, I was there. You always said no.' };

/** The confrontation, in order; the ring line depends on whether you ever took his ring. */
export function confrontationLines(ringTaken: boolean): TalkLine[] {
  return [
    OPENING,
    ARGUMENT,
    ringTaken ? RING_TAKEN : RING_REFUSED,
    { who: 'spirit', text: "He isn't wrong about what you wanted. Only about how." },
    { who: 'imp', text: 'For the record, I was the nice one.' },
    { who: 'rival', text: 'So turn me away again. You always do.' },
    { who: 'ora', text: 'Not away. Back.' },
  ];
}

/** After the hands meet and Ora says "There you are.". */
export const AFTER_LINES: TalkLine[] = [
  { who: 'spirit', text: 'Both of you, in one place at last.' },
  { who: 'imp', text: 'Wonderful. Now who do I blame for things?' },
];

const NAME: Record<Speaker, string> = { rival: RIVAL_NAME, spirit: 'Lumi', imp: 'Fizz', ora: 'Ora' };
const face = (l: TalkLine): string | null =>
  l.who === 'rival'
    ? portraitUrl('d', 640)
    : l.who === 'spirit'
      ? advisorPortraitUrl(/^He isn't/.test(l.text) ? 'lumi-speak' : 'lumi-cheer', 384)
      : l.who === 'imp'
        ? advisorPortraitUrl(/^Wonderful/.test(l.text) ? 'fizz-cackle' : 'fizz-smirk', 384)
        : null;

const IN = 0.7;
const GAP = 0.5;
const OUT = 1.1;

/** A run of spoken lines over the ending, one at a time, each held for its voice (or its length) and a breath. */
export class Talk implements FinalBattle {
  done = false;
  outcome = 'reconciled' as const;
  private i = -1;
  private t = 0;
  private until = 0;
  private gen = 0;
  private closing = false;
  private readonly el = document.createElement('div');
  private readonly img: HTMLImageElement;
  private readonly nameEl: HTMLDivElement;
  private readonly lineEl: HTMLDivElement;

  constructor(
    private readonly s: Stage,
    private readonly lines: TalkLine[],
  ) {
    this.el.className = 'endings-talk';
    this.el.innerHTML = `<div class="et-face"><img alt="" draggable="false"></div><div class="et-name"></div><div class="et-line"></div>`;
    this.img = this.el.querySelector('img')!;
    this.nameEl = this.el.querySelector('.et-name')!;
    this.lineEl = this.el.querySelector('.et-line')!;
    for (const l of lines) {
      const u = face(l);
      if (u) new Image().src = u;
    }
    s.cine.layer.appendChild(this.el);
    this.until = IN;
  }

  /** The line on screen now (for tests). */
  get current(): TalkLine | null {
    return this.i >= 0 && this.i < this.lines.length ? this.lines[this.i] : null;
  }

  frame(dt: number) {
    if (this.done) return;
    this.t += dt;
    if (this.t < this.until) return;
    if (this.closing) {
      this.done = true;
      this.el.remove();
      return;
    }
    this.i++;
    if (this.i >= this.lines.length) {
      this.el.classList.remove('on');
      this.closing = true;
      this.until = this.t + OUT;
      return;
    }
    this.show(this.lines[this.i]);
  }

  private show(l: TalkLine) {
    const token = ++this.gen;
    const u = face(l);
    this.el.dataset.who = l.who;
    this.el.classList.toggle('ora', l.who === 'ora');
    if (u) this.img.src = u;
    this.nameEl.textContent = NAME[l.who];
    this.lineEl.textContent = l.text;
    this.el.classList.remove('on');
    void this.el.offsetWidth;
    this.el.classList.add('on');
    // Held for its length at first; the voice, once loaded, stretches it to the clip and a breath.
    this.until = this.t + Math.max(3.2, 1.2 + l.text.length * 0.055);
    const audio = this.s.game.audio;
    if (l.who === 'ora') {
      // Ora speaks the way it does in Whole ("There you are."): its orb and one line, not a portrait.
      this.el.classList.remove('on');
      this.s.cine.say(l.text, Math.max(2.4, this.until - this.t - 1));
      void audio.oraTone();
      return;
    }
    const start = this.t;
    void audio
      .advisorClip(l.text)
      .then((clip) => {
        if (!clip || token !== this.gen || this.done) return;
        audio.playAdvisorClip(clip);
        this.until = Math.max(this.until, start + clip.duration + GAP + 0.4);
      })
      .catch(() => {});
  }

  dispose() {
    this.done = true;
    this.el.remove();
  }
}
