import type { Game } from '../Game';
import type { Prayer } from './Prayers';
import './prayers.css';

/** How long a fulfilled card lingers (with its check mark) before fading, in real seconds. */
export const DONE_LINGER = 2.4;
export const FADE = 0.6;
/** Cards shown before the list scrolls. */
const MAX_VISIBLE = 5;
/** Space kept between the list and the panels above and below it. */
const GAP = 8;

export interface Card {
  prayer: Prayer;
  el: HTMLDivElement;
  bar: HTMLDivElement;
  time: HTMLSpanElement;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/**
 * The Prayers list docked on the right: under the time bar (and the village detail / project
 * panels when open) and above the golem panel. Prayers fly in here after their moment over the village.
 */
export class PrayerPanel {
  readonly root: HTMLDivElement;
  private readonly title: HTMLSpanElement;
  private readonly list: HTMLDivElement;
  private readonly cards: Card[] = [];
  private collapsed = false;

  constructor(
    private readonly game: Game,
    private readonly onPick: (p: Prayer, child: boolean) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'panel pr-panel hidden';
    this.root.innerHTML = `<button class="pr-head" title="Show / hide the prayers"><span class="stat-label"></span><span class="pr-chev">▾</span></button><div class="pr-list"></div>`;
    this.title = this.root.querySelector('.stat-label')!;
    this.list = this.root.querySelector('.pr-list')!;
    this.root.querySelector<HTMLButtonElement>('.pr-head')!.onclick = () => {
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
    };
    game.hud.root.appendChild(this.root);
  }

  /** Adds a card (hidden until its bubble lands) and returns it; newest goes on top. */
  add(p: Prayer): Card {
    const el = document.createElement('div');
    el.className = 'pr-card';
    el.innerHTML = `<div class="pc-top"><span class="pc-dot"></span><span class="pc-vil"></span><span class="pc-time"></span></div>
      <div class="pc-body"><span class="pc-icon">${p.icon}</span><span class="pc-text"></span></div>
      <div class="pr-bar"><div></div></div>`;
    el.querySelector<HTMLElement>('.pc-dot')!.style.background = hex(p.village.color);
    el.querySelector('.pc-vil')!.textContent = p.village.name;
    el.querySelector('.pc-text')!.textContent = p.text;
    if (p.kind === 'lost' && p.villager) {
      const help = document.createElement('div');
      help.className = 'pc-help';
      help.innerHTML = '<b>!</b> ';
      help.append(`${p.childName} needs help`);
      help.onclick = (ev) => {
        ev.stopPropagation();
        this.onPick(p, true);
      };
      el.appendChild(help);
    }
    el.onclick = () => this.onPick(p, false);
    const card = {
      prayer: p,
      el,
      bar: el.querySelector<HTMLDivElement>('.pr-bar > div')!,
      time: el.querySelector<HTMLSpanElement>('.pc-time')!,
    };
    this.cards.unshift(card);
    this.list.prepend(el);
    this.list.scrollTop = 0;
    this.layout();
    return card;
  }

  remove(c: Card) {
    const i = this.cards.indexOf(c);
    if (i >= 0) this.cards.splice(i, 1);
    c.el.remove();
  }

  fulfilled(c: Card) {
    c.el.classList.add('done');
    c.el.querySelector('.pc-icon')!.textContent = '✓';
    c.el.querySelector('.pc-text')!.textContent = c.prayer.thanks;
    c.el.querySelector('.pc-help')?.remove();
    c.time.textContent = '';
  }

  /** Where a flying bubble should land. */
  target(c: Card): DOMRect {
    const box = this.collapsed ? this.root.getBoundingClientRect() : this.list.getBoundingClientRect();
    const r = c.el.getBoundingClientRect();
    if (this.collapsed || r.top < box.top || r.bottom > box.bottom) {
      return new DOMRect(box.left + 10, box.top + 4, box.width - 20, 40);
    }
    return r;
  }

  /** Every rendered frame: fill the bars and keep the panel clear of its neighbours. */
  frame(visible: boolean, count: number) {
    const g = this.game;
    this.root.classList.toggle('hidden', !visible || this.cards.length === 0);
    this.title.textContent = `Prayers (${count})`;
    for (const c of this.cards) {
      const p = c.prayer;
      if (c.el.classList.contains('done') || c.el.classList.contains('fading')) continue;
      let frac: number;
      if (p.need > 0) frac = p.progress / p.need;
      else frac = Number.isFinite(p.expiresAt) ? Math.max(0, (p.expiresAt - g.time) / (p.expiresAt - p.bornAt)) : 1;
      c.bar.style.width = `${Math.min(100, Math.max(0, frac * 100))}%`;
      const left = p.expiresAt - g.time;
      c.time.textContent = Number.isFinite(left) ? `${Math.floor(Math.max(0, left) / 60)}:${String(Math.floor(Math.max(0, left) % 60)).padStart(2, '0')}` : '';
    }
    this.layout();
  }

  /** Sit below the lowest right-hand panel above us, above the golem panel; scroll past MAX_VISIBLE or when short on room. */
  private layout() {
    const root = this.game.hud.root;
    let top = 64;
    for (const sel of ['.top-right', '.detail', '.pj-panel']) {
      const e = root.querySelector<HTMLElement>(sel);
      if (e && !e.classList.contains('hidden')) top = Math.max(top, e.getBoundingClientRect().bottom + GAP);
    }
    const golem = root.querySelector<HTMLElement>('.creature-panel');
    const floor = golem ? golem.getBoundingClientRect().top - GAP : window.innerHeight - 18;
    this.root.style.top = `${top}px`;
    const head = this.root.querySelector<HTMLElement>('.pr-head')!.offsetHeight + 26;
    const first = this.cards[0]?.el;
    const cardH = first ? first.offsetHeight + 6 : 70;
    const room = Math.max(0, floor - top - head);
    this.list.style.maxHeight = `${Math.max(cardH, Math.min(room, cardH * MAX_VISIBLE))}px`;
    // Too cramped for even one card: show only the header.
    this.root.classList.toggle('cramped', room < cardH * 0.9);
  }
}
