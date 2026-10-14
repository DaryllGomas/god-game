/**
 * Free play is unlocked by beating story mode (Daryll, 2026-10-14): the flag is set when the good ending
 * completes (the end card shows), and from then on a new island offers Story or Free play.
 * Debug: `?unlock=free` sets it, `?unlock=story` clears it.
 */
export const FREE_UNLOCK_KEY = 'godgame.freeplay.v1';

const q = new URLSearchParams(location.search).get('unlock');
try {
  if (q === 'free') localStorage.setItem(FREE_UNLOCK_KEY, '1');
  else if (q === 'story') localStorage.removeItem(FREE_UNLOCK_KEY);
} catch {
  /* storage unavailable */
}

export function freePlayUnlocked(): boolean {
  try {
    return localStorage.getItem(FREE_UNLOCK_KEY) === '1';
  } catch {
    return false;
  }
}

export function unlockFreePlay() {
  try {
    localStorage.setItem(FREE_UNLOCK_KEY, '1');
  } catch {
    /* storage unavailable: it unlocks again next time */
  }
}
