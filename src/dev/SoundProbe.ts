// Dev server only (loaded by src/plugins/playtest-note.ts): once a second, tell the dev server what the game's sound is
// doing, so "no sound" on someone's own browser can be read from here instead of guessed at (2026-11-17). It reports
// the audio context's state and clock, the master level, whether any signal is leaving the game, and page errors.
// Written to shots/sound-probe.log by the endpoint in vite.config.ts. Nothing of this is in a built game.
import type { Game } from '../Game';

type Inner = { ctx: AudioContext | null; master: GainNode | null; muted: boolean; heldForFilm: boolean; musicOn?: boolean };

export function startSoundProbe(game: Game) {
  const a = game.audio as unknown as Inner;
  let an: AnalyserNode | null = null;
  let seen: AudioContext | null = null;
  const events: string[] = [];
  let unlocks = 0;
  const note = (s: string) => events.push(`${new Date().toISOString().slice(11, 19)} ${s}`);
  window.addEventListener('error', (e) => note(`error: ${e.message}`));
  window.addEventListener('unhandledrejection', (e) => note(`rejection: ${String(e.reason).slice(0, 120)}`));
  for (const t of ['pointerdown', 'keydown'] as const) window.addEventListener(t, () => unlocks++, true);
  document.addEventListener('visibilitychange', () => note(`page ${document.visibilityState}`));
  navigator.mediaDevices?.addEventListener?.('devicechange', () => note('audio devices changed'));
  setInterval(() => {
    const ctx = a.ctx;
    if (ctx && ctx !== seen) {
      seen = ctx;
      an = ctx.createAnalyser();
      a.master?.connect(an);
      ctx.addEventListener('statechange', () => note(`context -> ${ctx.state}`));
      note(`context made (${ctx.state}, ${ctx.sampleRate} Hz)`);
    }
    let peak: number | string = 0;
    if (an) {
      const buf = new Float32Array(an.fftSize);
      an.getFloatTimeDomainData(buf);
      for (const v of buf) {
        if (Number.isNaN(v)) {
          peak = 'NaN';
          break;
        }
        peak = Math.max(peak as number, Math.abs(v));
      }
    }
    const body = {
      at: new Date().toISOString().slice(11, 19),
      ctx: ctx ? ctx.state : null,
      clock: ctx ? +ctx.currentTime.toFixed(1) : null,
      out: ctx ? +((ctx as AudioContext & { outputLatency?: number }).outputLatency ?? 0).toFixed(3) : null,
      sink: ctx ? String((ctx as AudioContext & { sinkId?: unknown }).sinkId ?? '') : null,
      master: a.master ? +a.master.gain.value.toFixed(2) : null,
      muted: a.muted,
      held: a.heldForFilm,
      music: a.musicOn ?? null,
      peak: typeof peak === 'number' ? +peak.toFixed(4) : peak,
      presses: unlocks,
      page: document.visibilityState,
      focus: document.hasFocus(),
      speed: game.speed,
      paused: game.paused,
      help: game.hud.helpOpen,
      events: events.splice(0),
    };
    void fetch('/__sound', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  }, 1000);
}
