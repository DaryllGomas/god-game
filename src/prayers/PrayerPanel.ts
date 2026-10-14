import type { Game } from '../Game';
import type { Prayer } from './Prayers';
import { DONE_ICON, medallion } from './icons';
import './prayers.css';

/** How long a fulfilled card lingers (with its check mark) before fading, in real seconds. */
export const DONE_LINGER = 2.4;
export const FADE = 0.6;
/** Rows of tiles shown before the list scrolls (three tiles to a row). */
const MAX_ROWS = 2;
/** Space kept between the list and the panels above and below it. */
const GAP = 8;

export interface Card {
  prayer: Prayer;
  el: HTMLDivElement;
  /** The progress ring around the icon. */
  ring: SVGCircleElement;
  /** Thin time-left bar under the icon (wood and food prayers, which also have a delivery ring). */
  bar: HTMLDivElement;
}

const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`;

/** How full a prayer's ring is (delivered, or time left when there's nothing to deliver) and how much time is left, both 0..1. */
export function ringOf(p: Prayer, now: number): { ring: number; time: number } {
  const time = Number.isFinite(p.expiresAt) ? Math.min(1, Math.max(0, (p.expiresAt - now) / (p.expiresAt - p.bornAt))) : 1;
  return { ring: p.need > 0 ? Math.min(1, Math.max(0, p.progress / p.need)) : time, time };
}

/** Sets a medallion's ring; an empty ring draws nothing (no stray end-cap dot). */
export function setRing(ring: SVGCircleElement, frac: number) {
  ring.setAttribute('stroke-dasharray', `${(frac * 100).toFixed(1)} 100`);
  ring.style.opacity = frac > 0.005 ? '' : '0';
}

/**
 * The Prayers list docked on the right: under the time bar (and the village detail / project
 * panels when open) and above the golem panel. Prayers fly in here after their moment over the village.
 *
 * No words (the no-hints rule): each prayer is a tile with its icon, the village colour, and a ring.
 * For wood and food the ring fills as you deliver and a thin bar drains with the time left; for the
 * others the ring itself is the time left. Projects never expire, so their ring is the building's progress.
 */
export class PrayerPanel {
  readonly root: HTMLDivElement;
  private readonly count: HTMLSpanElement;
  private readonly list: HTMLDivElement;
  private readonly cards: Card[] = [];
  private collapsed = false;

  constructor(
    private readonly game: Game,
    private readonly onPick: (p: Prayer, child: boolean) => void,
  ) {
    this.root = document.createElement('div');
    this.root.className = 'panel pr-panel hidden';
    this.root.innerHTML = `<button class="pr-head" aria-label="Prayers"><span class="pr-head-icon">🙏</span><span class="pr-count"></span><span class="pr-chev">▾</span></button><div class="pr-list"></div>`;
    this.count = this.root.querySelector('.pr-count')!;
    this.list = this.root.querySelector('.pr-list')!;
    this.root.querySelector<HTMLButtonElement>('.pr-head')!.onclick = () => {
      this.collapsed = !this.collapsed;
      this.root.classList.toggle('collapsed', this.collapsed);
    };
    game.hud.root.appendChild(this.root);
  }

  /** Adds a card (hidden until its bubble lands) and returns it; newest goes first. */
  add(p: Prayer): Card {
    const el = document.createElement('div');
    el.className = `pr-card k-${p.kind}`;
    el.style.setProperty('--vc', hex(p.village.color));
    // The words stay for screen readers only.
    el.setAttribute('role', 'button');
    el.setAttribute('aria-label', `${p.village.name}: ${p.text}`);
    el.innerHTML = `<div class="pc-band"></div>${medallion(p.kind, 'pc-medal')}<div class="pr-bar"><div></div></div>`;
    el.classList.toggle('timed', p.need > 0 && Number.isFinite(p.expiresAt));
    // Never fly the camera somewhere the hand can't act (Daryll, 2026-10-14): a far village's card waits, hidden, until your light reaches it.
    el.onclick = () => this.game.canReach(p.village) && this.onPick(p, false);
    const card = {
      prayer: p,
      el,
      ring: el.querySelector<SVGCircleElement>('.pr-ring-fill')!,
      bar: el.querySelector<HTMLDivElement>('.pr-bar > div')!,
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
    c.el.querySelector('.pr-glyph')!.innerHTML = DONE_ICON;
    setRing(c.ring, 1);
    c.el.setAttribute('aria-label', `${c.prayer.village.name}: ${c.prayer.thanks}`);
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

  /** Every rendered frame: turn the rings and bars, and keep the panel clear of its neighbours. */
  frame(visible: boolean, count: number) {
    const g = this.game;
    let far = 0;
    for (const c of this.cards) {
      const out = !g.canReach(c.prayer.village) && !c.el.classList.contains('done');
      c.el.classList.toggle('far', out);
      if (out) far++;
    }
    this.root.classList.toggle('hidden', !visible || this.cards.length - far <= 0);
    this.count.textContent = String(Math.max(0, count - far));
    for (const c of this.cards) {
      const p = c.prayer;
      if (c.el.classList.contains('done') || c.el.classList.contains('fading')) continue;
      const { ring, time } = ringOf(p, g.time);
      setRing(c.ring, ring);
      c.bar.style.width = `${(time * 100).toFixed(1)}%`;
    }
    this.layout();
  }

  /** Sit below the lowest right-hand panel above us, above the golem panel; scroll past MAX_ROWS or when short on room. */
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
    const rowH = first ? first.offsetHeight + 7 : 90;
    const room = Math.max(0, floor - top - head);
    this.list.style.maxHeight = `${Math.max(rowH, Math.min(room, rowH * MAX_ROWS))}px`;
    // Too cramped for even one row: show only the header.
    this.root.classList.toggle('cramped', room < rowH * 0.9);
  }
}
