// The playtest note key (2026-11-17, Daryll: "add into both games the same tool that lets us make in-game feedback
// that the grapple game has ... B, where you can leave a note"). The same tool as Signal Arena's (src/ui/mark.ts):
//
//   B (keyboard), or both sticks pressed in together (controller)
//     -> saves at once where the camera and the hand are, what the game was doing and the frame on screen, to
//        shots/marks/<date>/<n>.json and <n>.png, through the dev server's own /__mark endpoint (vite.config.ts);
//     -> a toast "Marked #n", then a one-line note box: type (or dictate) and press Enter to save the note; Enter on
//        an empty box skips it; Esc skips too. On a controller, A, B or Start closes the box (the mark is already saved).
//   Read them: node scripts/marks.mjs [date]   (lists every mark and makes a contact sheet per day)
//
// Dev server only (`npm run dev`): the plugin that loads this (src/plugins/playtest-note.ts) does nothing in a built
// game, so none of it is in the public build. It never talks to anything but the dev server on this machine. The
// Xbox (Guide) button is never read. The picture is the 3D view only: the HUD is page elements, not part of the frame.
import type { Game } from '../Game';

const BTN = { A: 0, B: 1, START: 9, L3: 10, R3: 11 };
type Saved = { n: number; date: string };

export class PlaytestNote {
  open = false;
  ready = false;
  last: Saved | null = null;
  private pending = false;
  private box: HTMLInputElement | null = null;
  private toastEl: HTMLDivElement | null = null;
  private toastT = 0;
  private chord = false;
  private padPrev: boolean[] = [];
  private padWait = false;
  private saved: Saved | null = null;

  constructor(private readonly game: Game) {
    fetch('/__mark')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { marks?: boolean } | null) => (this.ready = !!j?.marks))
      .catch(() => {});
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.ready || this.open || e.repeat || e.code !== 'KeyB' || e.ctrlKey || e.metaKey || e.altKey || !e.isTrusted) return;
        const t = e.target;
        if (t instanceof HTMLInputElement || t instanceof HTMLTextAreaElement || (t instanceof HTMLElement && t.isContentEditable)) return;
        this.pending = true;
      },
      true,
    );
  }

  private couch(): boolean {
    return this.game.controls.pad.active;
  }

  private toast(text: string) {
    if (!this.toastEl) {
      this.toastEl = document.createElement('div');
      Object.assign(this.toastEl.style, {
        position: 'fixed', top: '18%', left: '50%', transform: 'translateX(-50%)', padding: '6px 16px', background: 'rgba(20,20,30,0.78)',
        color: '#fff27a', font: 'bold 16px sans-serif', borderRadius: '8px', zIndex: '100000', pointerEvents: 'none', transition: 'opacity 0.4s',
      });
      document.body.append(this.toastEl);
    }
    const el = this.toastEl;
    el.style.fontSize = this.couch() ? '26px' : '16px';
    el.textContent = text;
    el.style.opacity = '1';
    clearTimeout(this.toastT);
    this.toastT = window.setTimeout(() => (el.style.opacity = '0'), 1600);
  }

  private post(url: string, body: unknown): Promise<Response> {
    return fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  }

  private close() {
    if (!this.box) return;
    const b = this.box;
    this.box = null;
    this.open = false;
    this.game.controls.pad.quiet = false;
    b.remove();
  }

  private saveNote() {
    const saved = this.saved;
    const note = this.box?.value.trim() ?? '';
    if (note && saved)
      this.post('/__mark/note', { date: saved.date, n: saved.n, note })
        .then((r) => this.toast(r.ok ? `Note saved on #${saved.n}` : 'Note failed'))
        .catch(() => this.toast('Note failed'));
    this.close();
  }

  /** What the game was doing: enough to go back to the same place and see the same thing. */
  private meta(): Record<string, unknown> {
    const g = this.game;
    const r = (v: number, d = 1) => +v.toFixed(d);
    const cam = g.godCam;
    const hand = g.hand;
    const safe = <T>(f: () => T): T | null => {
      try {
        return f();
      } catch {
        return null;
      }
    };
    return {
      game: 'the-first-world',
      when: new Date().toISOString(),
      cam: { x: r(cam.target.x), z: r(cam.target.z), distance: r(cam.distance), yaw: r(cam.yaw, 3), pitch: r(cam.pitch, 3) },
      hand: hand.valid ? { x: r(hand.ground.x), z: r(hand.ground.z), inLight: !hand.blocked } : null,
      hover: hand.hover ? { kind: hand.hover.kind, x: r(hand.hover.pos.x), z: r(hand.hover.pos.z), inLight: g.inInfluence(hand.hover.pos.x, hand.hover.pos.z) } : null,
      over: g.hoverBuilding?.kind ?? null,
      held: hand.held?.kind ?? null,
      controls: g.controls.mode,
      day: g.day,
      dayTime: r(g.dayTime, 2),
      time: r(g.time, 0),
      speed: g.speed,
      paused: g.paused,
      help: g.hud.helpOpen,
      power: r(g.player.power, 0),
      alignment: r(g.player.alignment, 2),
      balance: safe(() => r((g as unknown as { balance: { value: number } }).balance.value, 2)),
      season: safe(() => (g as unknown as { seasons: { season: string } }).seasons.season),
      villages: g.villages.map((v) => ({ name: v.name, owner: v.owner, people: v.population, belief: r(v.belief, 0) })),
      pad: g.controls.pad.active,
      view: [window.innerWidth, window.innerHeight],
      url: location.pathname + location.search + location.hash,
    };
  }

  private async send(png: string | null) {
    let saved: Saved;
    try {
      const res = await this.post('/__mark', { ...this.meta(), png });
      if (!res.ok) throw new Error(String(res.status));
      saved = (await res.json()) as Saved;
    } catch (e) {
      this.toast(`Mark failed (${e instanceof Error ? e.message : String(e)})`);
      return;
    }
    this.last = this.saved = saved;
    this.toast(`Marked #${saved.n}`);
    if (this.box) this.close();
    const couch = this.couch();
    const box = (this.box = document.createElement('input'));
    box.id = 'playtestNote';
    box.autocomplete = 'off';
    box.spellcheck = false;
    box.placeholder = couch ? `Mark #${saved.n} saved. A note? (A closes; Enter saves a typed note)` : `Mark #${saved.n}: a note? (Enter saves, empty Enter skips)`;
    Object.assign(box.style, {
      position: 'fixed', top: '23%', left: '50%', transform: 'translateX(-50%)', width: couch ? 'min(900px, 86vw)' : 'min(440px, 86vw)', padding: '8px 12px',
      font: `${couch ? 24 : 15}px sans-serif`, borderRadius: '8px', border: '2px solid #fff27a', background: 'rgba(20,20,30,0.88)', color: '#fff',
      zIndex: '100001', outline: 'none', boxSizing: 'border-box',
    });
    document.body.append(box);
    this.open = true;
    this.padWait = true;
    this.game.controls.pad.quiet = true; // the controller is the note's while the box is up
    this.game.input.keys.clear();
    box.addEventListener('keydown', (e) => {
      e.stopPropagation(); // the game never sees what is typed here
      if (e.key === 'Enter') {
        e.preventDefault();
        this.saveNote();
      } else if (e.key === 'Escape') this.close();
    });
    for (const t of ['keyup', 'keypress'] as const) box.addEventListener(t, (e) => e.stopPropagation());
    box.addEventListener('blur', () => setTimeout(() => this.box === box && this.close(), 0));
    box.focus();
  }

  /** Every frame: the controller's chord, and A / B / Start on the note box. */
  tick() {
    if (!this.ready) return;
    let pads: Gamepad[] = [];
    try {
      pads = [...(navigator.getGamepads?.() ?? [])].filter((p): p is Gamepad => !!p && p.connected);
    } catch {
      pads = [];
    }
    const down = (i: number) => pads.some((p) => p.buttons[i]?.pressed);
    const both = down(BTN.L3) && down(BTN.R3);
    if (both && !this.chord && !this.open) this.pending = true;
    this.chord = both;
    const now = [BTN.A, BTN.B, BTN.START].map(down);
    if (this.open) {
      if (this.padWait) {
        if (!now.some(Boolean)) this.padWait = false; // a button held when the box opened must be let go first
      } else if (now.some((d, i) => d && !this.padPrev[i])) this.saveNote();
    }
    this.padPrev = now;
  }

  /** Straight after the frame is drawn: the picture is read now (no preserved buffer needed). */
  rendered() {
    if (!this.pending) return;
    this.pending = false;
    let png: string | null = null;
    try {
      png = this.game.renderer.domElement.toDataURL('image/png');
    } catch {
      png = null;
    }
    void this.send(png);
  }
}
