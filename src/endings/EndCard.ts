import { clamp } from '../util/math';

/** Seconds for the card to fade in from black, and out again when the player moves on. */
const CARD_IN = 2.6;
const CARD_OUT = 2.2;
/** The card holds at least this long before a click or key takes you back to the island. */
const CARD_HOLD = 5;

/** A four-pointed star (the mark's star axis and orb star), centred at (x, y). */
const star = (x: number, y: number, r: number, w = 0.2) =>
  `M${x},${y - r} Q${x},${y} ${x + r * w},${y} Q${x},${y} ${x},${y + r} Q${x},${y} ${x - r * w},${y} Q${x},${y} ${x},${y - r}Z ` +
  `M${x - r * 0.62},${y} Q${x},${y} ${x},${y - r * w * 0.9} Q${x},${y} ${x + r * 0.62},${y} Q${x},${y} ${x},${y + r * w * 0.9} Q${x},${y} ${x - r * 0.62},${y}Z`;

/**
 * The TEND mark (THE FIRST WORLD's mark board): cradle forms around the world orb, a sprout above it,
 * the star axis through all of it, and the two orbit arcs with their beads. Gold on star-black.
 */
export const TEND_MARK = `<svg class="tend-mark" viewBox="-200 -200 400 400" aria-hidden="true">
  <defs>
    <linearGradient id="tend-gold" x1="0" y1="-1" x2="0" y2="1" gradientUnits="objectBoundingBox">
      <stop offset="0" stop-color="#fff4cf"/><stop offset="0.45" stop-color="#f4cf73"/><stop offset="1" stop-color="#b9822e"/>
    </linearGradient>
    <linearGradient id="tend-leaf" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#fff0c2" stop-opacity="0.95"/><stop offset="0.6" stop-color="#e8b85a" stop-opacity="0.85"/><stop offset="1" stop-color="#a8742a" stop-opacity="0.7"/>
    </linearGradient>
    <radialGradient id="tend-orb" cx="0.42" cy="0.38" r="0.7">
      <stop offset="0" stop-color="#2a3b5e"/><stop offset="0.7" stop-color="#0d1630"/><stop offset="1" stop-color="#070b18"/>
    </radialGradient>
    <radialGradient id="tend-bloom" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="#ffd98a" stop-opacity="0.38"/><stop offset="0.5" stop-color="#ffb84a" stop-opacity="0.08"/><stop offset="1" stop-color="#ffb84a" stop-opacity="0"/>
    </radialGradient>
    <filter id="tend-glow" x="-30%" y="-30%" width="160%" height="160%">
      <feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>
  <circle r="200" fill="url(#tend-bloom)"/>
  <g filter="url(#tend-glow)" stroke="url(#tend-gold)" fill="none" stroke-linecap="round">
    <circle r="150" stroke-width="1" opacity="0.4"/>
    <line x1="-188" y1="2" x2="188" y2="2" stroke-width="0.7" opacity="0.28"/>
    <line x1="0" y1="-186" x2="0" y2="190" stroke-width="1.3" opacity="0.75"/>
    <g class="tend-arcs">
      <path d="M -104 -122 A 160 160 0 0 0 -104 126" stroke-width="2" opacity="0.85"/>
      <path d="M 104 -122 A 160 160 0 0 1 104 126" stroke-width="2" opacity="0.85"/>
      <g fill="#f8dc94" stroke="none">
        <circle cx="-104" cy="-122" r="4.5"/><circle cx="-160" cy="2" r="4.5"/><circle cx="-104" cy="126" r="4.5"/>
        <circle cx="104" cy="-122" r="4.5"/><circle cx="160" cy="2" r="4.5"/><circle cx="104" cy="126" r="4.5"/>
      </g>
    </g>
    <g class="tend-cradle" stroke-width="1.4">
      <path d="M0 158 C -52 128 -116 76 -114 2 C -113 -38 -100 -70 -82 -92 C -79 -78 -84 -60 -88 -40 C -94 -8 -90 30 -76 62 C -60 100 -28 132 0 158 Z" fill="url(#tend-leaf)"/>
      <path d="M0 158 C 52 128 116 76 114 2 C 113 -38 100 -70 82 -92 C 79 -78 84 -60 88 -40 C 94 -8 90 30 76 62 C 60 100 28 132 0 158 Z" fill="url(#tend-leaf)"/>
      <path d="M0 140 C -30 116 -62 84 -70 40" stroke-width="0.8" opacity="0.5"/>
      <path d="M0 140 C 30 116 62 84 70 40" stroke-width="0.8" opacity="0.5"/>
    </g>
    <circle cy="2" r="58" fill="url(#tend-orb)" stroke-width="2.6"/>
    <circle cy="2" r="45" stroke-width="0.9" opacity="0.35"/>
    <path d="M -30 -18 C -18 -26 -4 -20 2 -10 C 10 2 -6 8 -16 18 C -24 26 -36 18 -40 6" stroke-width="0.8" opacity="0.3"/>
    <path d="M 14 22 C 24 18 36 24 38 34" stroke-width="0.8" opacity="0.3"/>
    <path d="M0 -56 L0 -96" stroke-width="2.2"/>
    <path d="M0 -84 C -8 -104 -30 -116 -52 -110 C -40 -92 -20 -84 0 -84 Z" fill="url(#tend-leaf)" stroke-width="1.4"/>
    <path d="M0 -84 C 8 -104 30 -116 52 -110 C 40 -92 20 -84 0 -84 Z" fill="url(#tend-leaf)" stroke-width="1.4"/>
  </g>
  <g fill="#fff6dc" filter="url(#tend-glow)">
    <path class="tend-star" d="${star(0, -160, 30)}"/>
    <path d="${star(0, 2, 24)}"/>
    <path d="${star(0, 184, 12)}" opacity="0.8"/>
  </g>
</svg>`;

const DOWNLOAD_ICON = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v11m0 0l-4.2-4.2M12 14l4.2-4.2M4.5 15.5v3.2c0 .9.7 1.6 1.6 1.6h11.8c.9 0 1.6-.7 1.6-1.6v-3.2" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** A starfield painted once to a canvas (no image files). */
function starfield(w: number, h: number): string {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d')!;
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 520; i++) {
    const x = rnd() * w;
    const y = rnd() * h;
    const r = rnd() < 0.92 ? rnd() * 0.9 + 0.3 : rnd() * 1.4 + 1;
    g.fillStyle = `rgba(${rnd() < 0.3 ? '255,226,170' : '220,232,255'},${(0.25 + rnd() * 0.65).toFixed(2)})`;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
  return c.toDataURL();
}

/** Cards made so far: each one's mark gets its own gradient ids (two cards in the page must not share them). */
let cards = 0;

/**
 * The end card after Ready to See: on star-black, the TEND mark, THE FIRST WORLD, and one line that hands
 * off to the next chapter. A small icon saves the legacy as a .json file. No other words.
 */
export class EndCard {
  readonly el: HTMLDivElement;
  private t = 0;
  private out = -1;
  private shown = false;
  /** Called once the card has faded away (the player chose to go back to the island). */
  onClosed: (() => void) | null = null;

  constructor(
    parent: HTMLElement,
    line: string,
    onDownload: () => void,
    /**
     * `choice`: the card asks a question with two answers (Daryll, 2026-10-17: "at the end of each modular experience,
     * you could say, would you like to go on to the next game?"). `go` leaves for the next game (A, Enter); `stay`
     * closes the card back onto the island (B, Escape). With a choice, a click elsewhere on the card does nothing.
     */
    opts: { title?: string; kicker?: string; choice?: { ask: string; go: { label: string; note?: string; onGo: () => void }; stay: { label: string } } } = {},
  ) {
    this.el = document.createElement('div');
    this.el.className = 'endings-card';
    this.el.innerHTML = `
      <div class="ec-stars"></div>
      <div class="ec-horizon"></div>
      <div class="ec-body">
        <div class="ec-mark">${TEND_MARK.replace(/tend-(gold|leaf|orb|bloom|glow)\b/g, `tend${++cards}-$1`)}</div>
        <h1 class="ec-title">THE FIRST WORLD</h1>
        <div class="ec-rule"><span></span><i></i><span></span></div>
        <p class="ec-line"></p>
        <p class="ec-kicker"></p>
        ${
          opts.choice
            ? `<p class="ec-ask"></p>
        <div class="ec-choices">
          <button class="ec-go"><span class="ec-pad">A</span><span class="ec-go-label"></span><small class="ec-go-note"></small></button>
          <button class="ec-stay"><span class="ec-pad">B</span><span class="ec-stay-label"></span></button>
        </div>`
            : ''
        }
      </div>
      <button class="ec-save" aria-label="Save your legacy (.json)">${DOWNLOAD_ICON}</button>`;
    this.setText(opts.title ?? 'THE FIRST WORLD', line, opts.kicker ?? '');
    (this.el.querySelector('.ec-stars') as HTMLDivElement).style.backgroundImage = `url(${starfield(1600, 1000)})`;
    const save = this.el.querySelector<HTMLButtonElement>('.ec-save')!;
    save.onclick = (e) => {
      e.stopPropagation();
      onDownload();
    };
    const ch = opts.choice;
    this.choice = ch ?? null;
    if (ch) {
      this.el.querySelector('.ec-ask')!.textContent = ch.ask;
      this.el.querySelector('.ec-go-label')!.textContent = ch.go.label;
      this.el.querySelector('.ec-go-note')!.textContent = ch.go.note ?? '';
      this.el.querySelector('.ec-stay-label')!.textContent = ch.stay.label;
      this.el.querySelector<HTMLButtonElement>('.ec-go')!.onclick = (e) => {
        e.stopPropagation();
        this.choose(true);
      };
      this.el.querySelector<HTMLButtonElement>('.ec-stay')!.onclick = (e) => {
        e.stopPropagation();
        this.choose(false);
      };
    }
    this.el.addEventListener('pointerdown', (e) => {
      if ((e.target as HTMLElement).closest('.ec-save, .ec-choices')) return;
      if (!this.choice) this.close();
    });
    parent.appendChild(this.el);
  }

  /** The card's words: its title, its one line, and an optional word under the line (a place's name). */
  setText(title: string, line: string, kicker = '') {
    this.el.querySelector('.ec-title')!.textContent = title;
    this.el.querySelector('.ec-line')!.textContent = line;
    const k = this.el.querySelector<HTMLElement>('.ec-kicker')!;
    k.textContent = kicker;
    k.style.display = kicker ? '' : 'none';
  }

  show() {
    this.shown = true;
    this.t = 0;
    this.out = -1;
    this.el.classList.add('on');
    this.el.style.opacity = '0';
  }

  private readonly choice: { go: { onGo: () => void } } | null;

  /** Answer the card's question: go on to the next game, or stay on the island. */
  choose(go: boolean) {
    if (!this.shown || this.out >= 0 || this.t < CARD_HOLD) return;
    if (go && this.choice) this.choice.go.onGo();
    else this.close();
  }

  /** A key (or the controller's A / B, which arrive as Enter / Escape) on the card. */
  key(e: KeyboardEvent) {
    if (!this.choice) return this.close();
    if (e.key === 'Enter' || e.key === ' ') this.choose(true);
    else if (e.key === 'Escape' || e.key === 'Backspace') this.choose(false);
  }

  /** Back to the island (after the card has held a moment). */
  close() {
    if (!this.shown || this.out >= 0 || this.t < CARD_HOLD) return;
    this.out = 0;
  }

  get visible(): boolean {
    return this.shown;
  }

  /** Fading away, back to the island. */
  get closing(): boolean {
    return this.shown && this.out >= 0;
  }

  /** How far in it is (0..1), for the scene behind it. */
  get level(): number {
    return this.shown ? clamp(this.t / CARD_IN, 0, 1) * (this.out >= 0 ? 1 - clamp(this.out / CARD_OUT, 0, 1) : 1) : 0;
  }

  frame(dt: number) {
    if (!this.shown) return;
    this.t += dt;
    if (this.out >= 0) this.out += dt;
    const k = this.level;
    this.el.style.opacity = (k * k * (3 - 2 * k)).toFixed(3);
    // The mark arrives a beat after the black, then the title, then the line.
    this.el.style.setProperty('--ec-mark', clamp((this.t - 0.6) / 2.4, 0, 1).toFixed(3));
    this.el.style.setProperty('--ec-title', clamp((this.t - 1.8) / 2, 0, 1).toFixed(3));
    this.el.style.setProperty('--ec-line', clamp((this.t - 3.2) / 2.2, 0, 1).toFixed(3));
    this.el.style.setProperty('--ec-save', clamp((this.t - 4.4) / 1.5, 0, 1).toFixed(3));
    this.el.style.setProperty('--ec-kicker', clamp((this.t - 4.6) / 2.4, 0, 1).toFixed(3));
    this.el.style.setProperty('--ec-time', this.t.toFixed(2));
    if (this.out >= CARD_OUT) {
      this.shown = false;
      this.el.classList.remove('on');
      this.onClosed?.();
    }
  }
}
