import type { Stage } from './Collapse';
import { REVEAL_LINE, RIVAL_NAME } from '../rival/data';
import { portraitUrl } from '../rival/RivalUI';

/**
 * The reveal (Daryll, 2026-10-15: "at the end it is revealed to be the counter image to Atlas ... it's just the dark
 * version that you have to reject ... at the end you have to battle and reintegrate into yourself to become whole and
 * balanced again"). In Whole, after the final battle (src/endings/FinalBattle.ts) and before the hands meet: his
 * portrait comes up large, the hooded shadow (D) he has been all game; the hood falls and the face under it is yours,
 * Atlas's (B, straight on); he says the one line of recognition (recorded); then the closing look back over the
 * shoulder (C), and the reintegration plays as before. The Atlas-face portraits (A2, B, C) are loaded and shown here
 * and nowhere else (CANON ruling 8: till the reveal he is a shadow).
 *
 * Real seconds from its start. The Ascension holds its own clock while it plays (like the battle).
 */
const T = { in: 1.1, fall: 3.2, fallFor: 2.4, line: 5.8, lineMin: 4.6, back: 1.8, backHold: 2.4, out: 1.3 };

export class Reveal {
  done = false;
  private t = 0;
  private readonly el = document.createElement('div');
  private readonly lineEl: HTMLDivElement;
  private spoke = false;
  private lineEnd = Infinity;
  private backAt = Infinity;
  private stage: 'hood' | 'fall' | 'face' | 'back' | 'out' = 'hood';

  constructor(private readonly s: Stage) {
    const el = this.el;
    el.className = 'endings-reveal';
    el.innerHTML = `
      <div class="er-frame">
        <img class="er-d" alt="" draggable="false" src="${portraitUrl('d', 640)}">
        <img class="er-b" alt="" draggable="false" src="${portraitUrl('b', 640)}">
        <img class="er-c" alt="" draggable="false" src="${portraitUrl('c', 640)}">
        <div class="er-smoke"></div>
      </div>
      <div class="er-name">${RIVAL_NAME}</div>
      <div class="er-line"></div>`;
    this.lineEl = el.querySelector('.er-line')!;
    s.cine.layer.appendChild(el);
    void el.offsetWidth;
    el.classList.add('on');
  }

  /** Which face shows now (for tests): 'd' (the hood), 'b' (the hood fallen: his face, yours), 'c' (the look back). */
  get face(): 'd' | 'b' | 'c' {
    return this.stage === 'hood' || this.stage === 'fall' ? (this.t < T.fall + T.fallFor / 2 ? 'd' : 'b') : this.stage === 'back' || this.stage === 'out' ? 'c' : 'b';
  }

  frame(dt: number) {
    if (this.done) return;
    this.t += dt;
    const t = this.t;
    if (this.stage === 'hood' && t >= T.fall) {
      // The hood falls: the shadow lifts away in smoke and the face beneath comes up out of the dark.
      this.stage = 'fall';
      this.el.classList.add('fall');
    }
    if (this.stage === 'fall' && t >= T.fall + T.fallFor) this.stage = 'face';
    if (!this.spoke && t >= T.line) {
      this.spoke = true;
      this.lineEl.textContent = REVEAL_LINE;
      this.el.classList.add('speak');
      this.lineEnd = t + T.lineMin;
      void this.voice();
    }
    if (this.stage === 'face' && this.spoke && t >= this.lineEnd) {
      // The closing look back over the shoulder.
      this.stage = 'back';
      this.backAt = t;
      this.el.classList.add('back');
    }
    if (this.stage === 'back' && t >= this.backAt + T.back + T.backHold) {
      this.stage = 'out';
      this.el.classList.add('out');
      this.backAt = t;
    }
    if (this.stage === 'out' && t >= this.backAt + T.out) {
      this.done = true;
      this.el.remove();
    }
  }

  /** His line in his voice; the line stays up for the clip and a breath after. */
  private async voice() {
    const audio = this.s.game.audio;
    let clip: AudioBuffer | null = null;
    try {
      clip = await audio.advisorClip(REVEAL_LINE);
    } catch {
      clip = null;
    }
    if (!clip || this.done) return;
    audio.playAdvisorClip(clip);
    this.lineEnd = Math.max(this.lineEnd, this.t + clip.duration + 0.8);
  }

  dispose() {
    this.el.remove();
  }
}
