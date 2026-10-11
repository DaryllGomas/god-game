import type { PrayerKind } from './Prayers';

/**
 * The prayer icons: what a village wants, said in pictures (the no-hints rule: a kid should get it
 * without reading). Hand-drawn SVG rather than emoji, so they look the same on every machine and sit
 * in the parchment style of the cards. All share a 32×32 box and use flat fills (no gradient ids,
 * so any number of copies can be on screen at once).
 */
export const PRAYER_ICON: Record<PrayerKind, string> = {
  // A stack of three log ends.
  timber: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <g stroke="#6e441d" stroke-width="1.5">
      <circle cx="10" cy="21.5" r="6" fill="#e8c088"/><circle cx="22" cy="21.5" r="6" fill="#e3b979"/><circle cx="16" cy="11" r="6" fill="#efcb93"/>
    </g>
    <g fill="none" stroke="#b07a3e" stroke-width="1.1">
      <circle cx="10" cy="21.5" r="3.2"/><circle cx="22" cy="21.5" r="3.2"/><circle cx="16" cy="11" r="3.2"/>
    </g>
    <g fill="#8a5a2b"><circle cx="10" cy="21.5" r="1"/><circle cx="22" cy="21.5" r="1"/><circle cx="16" cy="11" r="1"/></g>
  </svg>`,
  // A round loaf with its scored top.
  food: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M3.5 20.5c0-6.4 5.6-10.5 12.5-10.5s12.5 4.1 12.5 10.5v2.2a3.3 3.3 0 0 1-3.3 3.3H6.8a3.3 3.3 0 0 1-3.3-3.3z" fill="#d99a45" stroke="#7d4f1c" stroke-width="1.5"/>
    <path d="M7.5 16c2.2-2.9 5.2-4.1 8.5-4.1s6.3 1.2 8.5 4.1" fill="none" stroke="#f6d496" stroke-width="1.7" stroke-linecap="round" opacity="0.85"/>
    <path d="M10.5 14.2l2 4.2M16 13.2l1.2 4.7M21.6 14.2l-1.3 4.3" stroke="#7d4f1c" stroke-width="1.6" stroke-linecap="round"/>
  </svg>`,
  // A cloud with three drops.
  rain: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M9.2 18.6a4.9 4.9 0 0 1 .5-9.8 7 7 0 0 1 13.3 1.7 4.1 4.1 0 0 1 .1 8.1z" fill="#f4f8fc" stroke="#5f7d9c" stroke-width="1.5" stroke-linejoin="round"/>
    <g fill="#3f9ad8">
      <path d="M10.5 21.4s-1.9 2.6-1.9 3.8a1.9 1.9 0 0 0 3.8 0c0-1.2-1.9-3.8-1.9-3.8z"/>
      <path d="M16.5 22.6s-1.9 2.6-1.9 3.8a1.9 1.9 0 0 0 3.8 0c0-1.2-1.9-3.8-1.9-3.8z"/>
      <path d="M22.5 21.4s-1.9 2.6-1.9 3.8a1.9 1.9 0 0 0 3.8 0c0-1.2-1.9-3.8-1.9-3.8z"/>
    </g>
  </svg>`,
  // A small child and a question mark: someone is missing.
  lost: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <circle cx="12" cy="10.2" r="3.8" fill="#4b3820"/>
    <path d="M6.6 27v-6.6a5.4 5.4 0 0 1 10.8 0V27z" fill="#4b3820"/>
    <path d="M20.6 9.4a3.4 3.4 0 1 1 4.6 3.2c-1.1.5-1.5 1.3-1.5 2.5v.9" fill="none" stroke="#d27d22" stroke-width="2.4" stroke-linecap="round"/>
    <circle cx="23.7" cy="20.3" r="1.5" fill="#d27d22"/>
  </svg>`,
  // A flame.
  fire: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M16 3.5c1.2 4.6 7.4 7.6 7.4 14.3a7.4 7.4 0 0 1-14.8 0c0-3.7 2.1-5.8 3.7-7.3.2 2.3 1.2 3.5 2.5 4.1-.4-3.6-.1-7.8 1.2-11.1z" fill="#f08a2c" stroke="#a9481a" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M16.2 14.8c.6 2.6 3.7 3.7 3.7 6.8a3.8 3.8 0 0 1-7.6 0c0-2.1 1.4-3.2 2.1-3.8.2 1 .6 1.6 1.2 1.8-.2-1.7.1-3.4.6-4.8z" fill="#ffd35a"/>
  </svg>`,
  // A sparkle: show us a little wonder.
  sign: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <path d="M14 3.5c.9 6.1 2.8 8 8.9 8.9-6.1.9-8 2.8-8.9 8.9-.9-6.1-2.8-8-8.9-8.9 6.1-.9 8-2.8 8.9-8.9z" fill="#ffd96b" stroke="#c4892a" stroke-width="1.3" stroke-linejoin="round"/>
    <path d="M24 17.5c.5 3.3 1.5 4.3 4.8 4.8-3.3.5-4.3 1.5-4.8 4.8-.5-3.3-1.5-4.3-4.8-4.8 3.3-.5 4.3-1.5 4.8-4.8z" fill="#fff1b8" stroke="#c4892a" stroke-width="1.1" stroke-linejoin="round"/>
    <circle cx="14" cy="12.4" r="1.6" fill="#fffbe8"/>
  </svg>`,
  // Building materials: a cut stone and a log.
  project: `<svg viewBox="0 0 32 32" aria-hidden="true">
    <g stroke="#5f5a51" stroke-width="1.3" stroke-linejoin="round">
      <path d="M3.5 13.5l8.5-4.2 8.5 4.2-8.5 4.2z" fill="#d3cdc0"/>
      <path d="M3.5 13.5v8.3l8.5 4.2v-8.3z" fill="#aaa396"/>
      <path d="M20.5 13.5v8.3L12 26v-8.3z" fill="#8f897d"/>
    </g>
    <rect x="15.5" y="19" width="13" height="7" rx="3.5" fill="#9a6633" stroke="#6e441d" stroke-width="1.3"/>
    <ellipse cx="26.2" cy="22.5" rx="2.6" ry="3.3" fill="#e8c088" stroke="#6e441d" stroke-width="1.2"/>
  </svg>`,
};

/** Answered. */
export const DONE_ICON = `<svg viewBox="0 0 32 32" aria-hidden="true"><path d="M8.5 16.8l5 5 10-10.6" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/**
 * An icon in a round medallion with a progress ring around it (pathLength 100, so the dash is a percentage).
 * `--vc` on the element tints the medallion's halo with the village colour.
 */
export function medallion(kind: PrayerKind, cls: string): string {
  return `<div class="${cls} pr-medal">
    <svg class="pr-ring" viewBox="0 0 48 48" aria-hidden="true">
      <circle class="pr-ring-track" cx="24" cy="24" r="21.5"/>
      <circle class="pr-ring-fill" cx="24" cy="24" r="21.5" pathLength="100" stroke-dasharray="0 100" transform="rotate(-90 24 24)"/>
    </svg>
    <div class="pr-glyph">${PRAYER_ICON[kind]}</div>
  </div>`;
}
