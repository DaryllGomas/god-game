import { BACKUP_KEY, SAVE_KEY, SAVE_VERSION } from '../systems/Save';
import { rebirthPending } from '../endings/memory';

/**
 * Cloud saves, kept light: the island code is the only way back in. The browser holds a random secret key
 * (never shown, never sent anywhere but BigPic Pulse); the server keeps a hash of it and hands out a
 * short code like AMBER-OTTER-4821. The name alone unlocks nothing. Every call fails silently: a dead
 * network must never touch local play, which always saves to localStorage first.
 */

/** Where BigPic Pulse lives. `VITE_PULSE_URL` overrides it (dev, tests). */
const API = ((import.meta.env.VITE_PULSE_URL as string | undefined) ?? 'https://pulse.bigpicsolutions.com').replace(/\/$/, '');
const LINK_KEY = 'godgame.cloud.v1';
/** At most one upload this often (ms), except when the page is going away. */
const PUSH_GAP = 55_000;
/** Page-hide saves fire several events at once; one upload is enough. */
const HIDE_GAP = 5_000;
/** Give up on the boot-time check quickly: the game must start. */
const PRELOAD_TIMEOUT = 2500;
/** `fetch` with `keepalive` is capped by the browser at 64 KB. */
const KEEPALIVE_MAX = 60_000;

export interface CloudLink {
  key: string;
  code: string;
  name: string;
}

interface IslandReply {
  code: string;
  name: string;
  save: { version?: number; savedAt?: number } | null;
  updated_at: number | null;
}

let lastPush = -Infinity;
let pushing = false;

export function getLink(): CloudLink | null {
  try {
    const d = JSON.parse(localStorage.getItem(LINK_KEY) ?? 'null') as CloudLink | null;
    return d && typeof d.key === 'string' && typeof d.code === 'string' ? d : null;
  } catch {
    return null;
  }
}

function setLink(link: CloudLink | null) {
  try {
    if (link) localStorage.setItem(LINK_KEY, JSON.stringify(link));
    else localStorage.removeItem(LINK_KEY);
  } catch {
    /* storage unavailable: the island still works, just not linked */
  }
}

/** Unlink this browser (a new island starts a new life). The old code still opens the old island. */
export function forget() {
  setLink(null);
  lastPush = -Infinity;
}

const newKey = (): string => crypto.randomUUID();

async function call(path: string, init: RequestInit, timeout = 8000): Promise<Response> {
  const ctl = new AbortController();
  const timer = window.setTimeout(() => ctl.abort(), timeout);
  try {
    return await fetch(API + path, { ...init, signal: ctl.signal });
  } finally {
    window.clearTimeout(timer);
  }
}

const json = (body: unknown): RequestInit => ({ method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

/** Pick a god name and get an island code. Resolves to the new link, or null if Pulse said no or was unreachable. */
export async function createIsland(name: string): Promise<CloudLink | null> {
  try {
    const key = newKey();
    const r = await call('/v1/island', json({ name, key }));
    if (!r.ok) return null;
    const d = (await r.json()) as { code: string; name: string };
    const link = { key, code: d.code, name: d.name };
    setLink(link);
    return link;
  } catch {
    return null;
  }
}

export type RestoreResult = 'ok' | 'notfound' | 'empty' | 'offline';

/** "Have an island code?": claim the island with a fresh key, put its save where the game reads it, and report. The caller reloads. */
export async function restoreIsland(rawCode: string): Promise<RestoreResult> {
  try {
    const key = newKey();
    const r = await call('/v1/island', json({ code: rawCode, key }));
    if (r.status === 404 || r.status === 400) return 'notfound';
    if (!r.ok) return 'offline';
    const d = (await r.json()) as IslandReply;
    if (!d.save || d.save.version !== SAVE_VERSION) return 'empty';
    localStorage.setItem(SAVE_KEY, JSON.stringify(d.save));
    setLink({ key, code: d.code, name: d.name });
    return 'ok';
  } catch {
    return 'offline';
  }
}

/**
 * Before the game starts: if this browser has an island code and the server copy is newer than the local one,
 * use it (e.g. you played on your phone). Waits at most PRELOAD_TIMEOUT; any trouble means "use what is local".
 */
export async function preload(): Promise<void> {
  const link = getLink();
  if (!link) return;
  // v0.5 endings: a world that just began again must not be replaced by the cloud copy of the one that fell.
  if (rebirthPending()) return;
  try {
    const r = await call(`/v1/island?code=${encodeURIComponent(link.code)}`, { method: 'GET' }, PRELOAD_TIMEOUT);
    if (!r.ok) return;
    const d = (await r.json()) as IslandReply;
    if (!d.save || d.save.version !== SAVE_VERSION || typeof d.save.savedAt !== 'number') return;
    let localAt = 0;
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      localAt = raw ? ((JSON.parse(raw) as { savedAt?: number }).savedAt ?? 0) : 0;
    } catch {
      /* unreadable local save: the server copy wins */
    }
    if (d.save.savedAt > localAt) {
      const old = localStorage.getItem(SAVE_KEY);
      if (old) localStorage.setItem(BACKUP_KEY, old); // keep what we replaced, just in case
      localStorage.setItem(SAVE_KEY, JSON.stringify(d.save));
    }
  } catch {
    /* offline or slow: carry on with the local island */
  }
}

/**
 * Called by the autosave right after it wrote `saveJson` locally. Uploads at most about once a minute;
 * when the page is hiding it goes out at once with `keepalive` so it survives the tab closing.
 */
export function push(saveJson: string, mode: 'auto' | 'quiet' | 'manual') {
  const link = getLink();
  if (!link || pushing) return;
  const now = performance.now();
  const gap = mode === 'quiet' ? HIDE_GAP : PUSH_GAP;
  if (now - lastPush < gap) return;
  lastPush = now;
  pushing = true;
  // The save is already JSON text, so splice it in rather than escaping it a second time.
  const body = `{"code":${JSON.stringify(link.code)},"key":${JSON.stringify(link.key)},"save":${saveJson}}`;
  fetch(`${API}/v1/island`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: mode === 'quiet' && body.length < KEEPALIVE_MAX,
    signal: mode === 'quiet' ? undefined : AbortSignal.timeout(20_000),
  })
    .catch(() => {
      lastPush = -Infinity; // try again on the next save
    })
    .finally(() => {
      pushing = false;
    });
}
