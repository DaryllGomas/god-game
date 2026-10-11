/**
 * What a fallen world hands to the next one. Collapse writes it just before the page reloads into a new
 * island; the new island reads it once, keeps it in its own save (plugins.endings), and clears it.
 * No imports on purpose: src/cloud/Cloud.ts reads `rebirthPending()` before the game exists.
 */

export const REBIRTH_KEY = 'godgame.rebirth.v1';

/** A ruin left where the worst act of a fallen world happened. */
export interface Ruin {
  x: number;
  z: number;
  /** What happened there (Balance's deed label, e.g. "killed (thrown)", "home destroyed"). */
  what: string;
  /** Which world it fell in (1 = the first). */
  world: number;
}

export interface Rebirth {
  /** Worlds that have fallen so far (this new one is number worlds + 1). */
  worlds: number;
  ruins: Ruin[];
  /** When the old world fell (ms since epoch). */
  at: number;
}

/** A world just fell and the next has not been saved yet: the cloud copy (the fallen world) must not win. */
export function rebirthPending(): boolean {
  try {
    return !!localStorage.getItem(REBIRTH_KEY);
  } catch {
    return false;
  }
}

export function readRebirth(): Rebirth | null {
  try {
    const d = JSON.parse(localStorage.getItem(REBIRTH_KEY) ?? 'null') as Rebirth | null;
    if (!d || typeof d.worlds !== 'number' || !Array.isArray(d.ruins)) return null;
    return d;
  } catch {
    return null;
  }
}

export function writeRebirth(r: Rebirth) {
  try {
    localStorage.setItem(REBIRTH_KEY, JSON.stringify(r));
  } catch {
    /* storage unavailable: the next world simply won't remember */
  }
}

export function clearRebirth() {
  try {
    localStorage.removeItem(REBIRTH_KEY);
  } catch {
    /* ignore */
  }
}
