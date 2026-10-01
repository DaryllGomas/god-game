import type { Game } from '../Game';
import { LEARN_KEYS, LEARN_LABELS, type Golem, type LearnKey } from '../creature/Golem';

/**
 * The golem's panel: needs, current thought, nature (its own alignment) and what it has
 * learned from your strokes and slaps. Also calls/finds it and previews its looks.
 */
export class CreaturePanel {
  private readonly el: HTMLDivElement;
  private readonly lookButtons: HTMLButtonElement[] = [];
  private readonly rows = new Map<LearnKey, HTMLDivElement>();
  private timer = 0;

  constructor(
    private readonly game: Game,
    private readonly golem: Golem,
    parent: HTMLElement,
  ) {
    const panel = document.createElement('div');
    panel.className = 'panel creature-panel';
    panel.innerHTML = `
      <div class="cp-head"><span class="stat-label">Your golem</span><span class="cp-size"></span></div>
      <div class="cp-thought"></div>
      <div class="cp-needs">
        <span>Hunger</span><div class="cp-bar"><div class="cp-fill hunger"></div></div>
        <span>Energy</span><div class="cp-bar"><div class="cp-fill energy"></div></div>
        <span>Nature</span><div class="cp-nature"><div class="cp-marker"></div></div>
      </div>
      <div class="stat-label cp-learned-title">What it has learned</div>
      <div class="cp-learned"></div>
      <div class="cp-row cp-actions"></div>
      <div class="cp-hint">Stroke: left-click &amp; rub it · Slap: right-click it<br/>It learns from whatever it's doing, or just did.</div>
      <div class="cp-looks-title">Preview looks</div>
      <div class="cp-row cp-looks"></div>`;
    this.el = panel;

    const learned = panel.querySelector('.cp-learned')!;
    for (const key of LEARN_KEYS) {
      const row = document.createElement('div');
      row.className = 'cp-learn';
      row.innerHTML = `<span>${LEARN_LABELS[key]}</span><div class="cp-op"><div class="cp-op-fill"></div><div class="cp-op-mid"></div></div>`;
      learned.appendChild(row);
      this.rows.set(key, row);
    }

    const actions = panel.querySelector('.cp-actions')!;
    const call = this.button('Come here (L)', 'Call it to your hand', () => this.game.callCreature());
    const find = this.button('Find (C)', 'Fly the camera to it', () => this.game.focusCreature());
    actions.append(call, find);

    const looks = panel.querySelector('.cp-looks')!;
    const options: [string, number | null][] = [
      ['Good', 1],
      ['Neutral', 0],
      ['Evil', -1],
      ['Real', null],
    ];
    for (const [label, value] of options) {
      const b = this.button(label, value === null ? 'Show its real nature' : `Preview the ${label.toLowerCase()} look`, () => {
        this.golem.previewAlignment = value;
        this.refreshLooks();
      });
      looks.appendChild(b);
      this.lookButtons.push(b);
    }
    parent.appendChild(panel);
    this.refreshLooks();
    this.update(1);
  }

  private button(label: string, title: string, onClick: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.className = 'speed-btn';
    b.textContent = label;
    b.title = title;
    b.onclick = onClick;
    return b;
  }

  private refreshLooks() {
    const values = [1, 0, -1, null];
    this.lookButtons.forEach((b, i) => b.classList.toggle('active', values[i] === this.golem.previewAlignment));
  }

  update(dt: number) {
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = 0.2;
    const g = this.golem;
    const q = <T extends HTMLElement>(sel: string) => this.el.querySelector<T>(sel)!;
    q('.cp-size').textContent = `size ${g.size.toFixed(2)}×`;
    q('.cp-thought').textContent = `“${g.thought}”`;
    q<HTMLDivElement>('.cp-fill.hunger').style.width = `${g.hunger * 100}%`;
    q<HTMLDivElement>('.cp-fill.energy').style.width = `${g.energy * 100}%`;
    q<HTMLDivElement>('.cp-marker').style.left = `${(g.alignment * 0.5 + 0.5) * 100}%`;
    const lesson = g.currentLesson(this.game);
    for (const [key, row] of this.rows) {
      const op = g.opinions[key];
      const fill = row.querySelector<HTMLDivElement>('.cp-op-fill')!;
      fill.style.left = `${op < 0 ? 50 + op * 50 : 50}%`;
      fill.style.width = `${Math.abs(op) * 50}%`;
      fill.classList.toggle('neg', op < 0);
      row.classList.toggle('current', key === lesson);
    }
  }
}
