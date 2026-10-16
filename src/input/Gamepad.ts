import * as THREE from 'three';
import type { Game } from '../Game';
import type { Input } from './Input';
import { Golem } from '../creature/Golem';
import './gamepad.css';

/**
 * Native gamepad support (Xbox layout, "standard" mapping). Polled once per frame from Controls.
 *
 * It does not have its own game logic: the hand is moved by feeding the same pointer the mouse uses (Input.moveTo)
 * and A/B press and release go through the same event queue (Input.padButton / padKey), so grabbing, setting down,
 * dragging the land, stroking the golem and every key shortcut run the exact code the mouse and keyboard run.
 *
 *   Left stick   the hand (deadzone 0.2, speeds up the longer it is held; pushing against a screen edge pans)
 *   A            grab what is under the hand / set it down (tap, tap)  ·  hold A, release to set down  ·  on bare land
 *                hold A and move to drag the land  ·  over a HUD button it presses it
 *   B            put back (miracle: refund)  ·  close the open card or panel
 *   X            tap: home (Space)  ·  on the golem with an empty hand: slap  ·  hold X + right stick: orbit / tilt
 *   Y            empty hand: tap finds the golem (C), hold calls it (L)  ·  holding something: hold to charge, release to throw
 *                (aim with the left stick)
 *   Right stick  pan the camera
 *   Stick clicks left = zoom in, right = zoom out (held)
 *   D-pad        up Water, left Food, right Fire, down pause
 *   View / Start  help (H) / pause (P)
 *   Menus        D-pad or left stick moves, A chooses, B closes
 *   Optional duplicates (never needed): RT = A, LT = right button (slap, flick-throw), LB/RB = zoom out/in
 *   Never used: the Xbox/Guide button (16).
 */

const DEAD = 0.2;
const NAV_DEAD = 0.55;
const HOLD_PLACE = 0.45; // hold A longer than this on a thing you just grabbed: releasing sets it down
const HOLD_CALL = 0.55; // hold Y with an empty hand: call the golem
const HOLD_X = 0.25;
const THROW_CHARGE = 0.9;

const B = { A: 0, B: 1, X: 2, Y: 3, LB: 4, RB: 5, LT: 6, RT: 7, VIEW: 8, START: 9, LS: 10, RS: 11, UP: 12, DOWN: 13, LEFT: 14, RIGHT: 15, GUIDE: 16 };

type PadState = { axes: number[]; buttons: boolean[] };

function radial(x: number, y: number): [number, number, number] {
  const m = Math.hypot(x, y);
  if (m < DEAD) return [0, 0, 0];
  const k = Math.min(1, (m - DEAD) / (1 - DEAD));
  return [(x / m) * k, (y / m) * k, k];
}

/** A scripted pad for tests: `?padtest` replaces navigator.getGamepads with window.__fakePad. */
export function installFakePad() {
  if (!new URLSearchParams(location.search).has('padtest') || (window as unknown as { __fakePad?: unknown }).__fakePad) return;
  const fake = {
    id: 'padtest (Xbox 360 Controller)',
    index: 0,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0, 0, 0, 0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    hapticActuators: [],
  };
  (window as unknown as { __fakePad: unknown }).__fakePad = fake;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => [fake as unknown as Gamepad] });
}

export class GamepadInput {
  /** True once a pad has been used (until the mouse moves). */
  active = false;
  private readonly reticle = document.createElement('div');
  private prev: boolean[] = [];
  private pressedAt: number[] = [];
  private px = 0;
  private py = 0;
  private placed = false;
  private ramp = 0;
  private lastDir = new THREE.Vector2(0, -1);
  private aMode: 'none' | 'tap' | 'hold-up' | 'grabbed' = 'none';
  private aSinceGrab = 0;
  private xMode = false;
  private yCharging = false;
  private ltDown = false;
  private navCool = 0;
  private navLast: string | null = null;
  private flagged = false;

  constructor(
    private readonly game: Game,
    private readonly input: Input,
  ) {
    this.reticle.className = 'pad-reticle';
    document.body.appendChild(this.reticle);
    installFakePad();
    window.addEventListener('gamepadconnected', () => this.flag());
    // A real mouse moving (anywhere on the page, HUD included) hands the screen back to the mouse.
    let mx = -1;
    let my = -1;
    window.addEventListener(
      'pointermove',
      (e) => {
        if (e.pointerType !== 'mouse') return;
        const moved = mx >= 0 && Math.abs(e.clientX - mx) + Math.abs(e.clientY - my) > 1;
        mx = e.clientX;
        my = e.clientY;
        if (moved) this.hide();
      },
      true,
    );
  }

  private flag() {
    if (this.flagged) return;
    this.flagged = true;
    (window as unknown as { __nativeGamepad?: boolean }).__nativeGamepad = true;
    document.documentElement.dataset.nativeGamepad = '1';
    window.dispatchEvent(new CustomEvent('nativegamepad'));
  }

  private hide() {
    if (!this.active) return;
    this.active = false;
    this.reticle.classList.remove('on');
    document.body.classList.remove('pad-on');
    this.clearFocus();
    // Let go of anything the pad was holding down, so the mouse starts clean.
    if (this.aMode === 'hold-up') this.input.padButton(0, false);
    this.aMode = 'none';
    this.placed = false;
  }

  private activate() {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('pad-on');
  }

  private read(): { pad: Gamepad | null } {
    let pad: Gamepad | null = null;
    try {
      for (const p of navigator.getGamepads?.() ?? []) {
        if (p && p.connected) {
          pad = p;
          break;
        }
      }
    } catch {
      pad = null;
    }
    return { pad };
  }

  update(dt: number, realTime: number) {
    const { pad } = this.read();
    if (!pad) {
      if (this.active && !this.flagged) this.hide();
      return;
    }
    this.flag();
    const st: PadState = { axes: Array.from(pad.axes), buttons: [] };
    for (let i = 0; i < 16; i++) st.buttons[i] = !!pad.buttons[i]?.pressed; // button 16 (Guide) is never read
    const edge = (i: number) => st.buttons[i] && !this.prev[i];
    const up = (i: number) => !st.buttons[i] && this.prev[i];
    const anyEdge = st.buttons.some((b, i) => b && !this.prev[i]);
    const lx = st.axes[0] ?? 0;
    const ly = st.axes[1] ?? 0;
    const rx = st.axes[2] ?? 0;
    const ry = st.axes[3] ?? 0;
    const stickUsed = Math.hypot(lx, ly) > DEAD || Math.hypot(rx, ry) > DEAD;
    if (anyEdge || stickUsed) this.activate();
    for (let i = 0; i < 16; i++) if (edge(i)) this.pressedAt[i] = realTime;

    if (this.active) {
      const modal = this.modal();
      if (modal) this.menuFrame(modal, st, edge, dt, lx, ly);
      else this.playFrame(st, edge, up, dt, realTime, lx, ly, rx, ry);
      if (modal) this.reticle.classList.remove('on');
    }
    this.prev = st.buttons;
  }

  // ------------------------------------------------------------------ play

  private playFrame(
    st: PadState,
    edge: (i: number) => boolean,
    up: (i: number) => boolean,
    dt: number,
    now: number,
    lx: number,
    ly: number,
    rx: number,
    ry: number,
  ) {
    this.clearFocus();
    const g = this.game;
    const input = this.input;
    const cam = g.godCam;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (!this.placed) {
      this.placed = true;
      this.px = input.inside ? input.x : w / 2;
      this.py = input.inside ? input.y : h / 2;
    }

    // --- the hand
    const [sx, sy, mag] = radial(lx, ly);
    if (mag > 0) this.ramp = Math.min(1, this.ramp + dt / 0.45);
    else this.ramp = 0;
    const speed = (0.2 + 0.8 * mag * mag) * (0.4 + 0.6 * this.ramp) * 1500 * (h / 1080);
    this.px = Math.max(6, Math.min(w - 6, this.px + sx * speed * dt));
    this.py = Math.max(6, Math.min(h - 6, this.py + sy * speed * dt));
    if (mag > 0) this.lastDir.set(sx, sy).normalize();
    // Pushing the hand against the edge of the screen pans the camera that way.
    const edgeX = this.px < 14 && sx < -0.3 ? sx : this.px > w - 14 && sx > 0.3 ? sx : 0;
    const edgeY = this.py < 14 && sy < -0.3 ? sy : this.py > h - 14 && sy > 0.3 ? sy : 0;
    if (edgeX || edgeY) cam.panLocal(edgeX * cam.distance * 0.5 * dt, -edgeY * cam.distance * 0.5 * dt);
    input.moveTo(this.px, this.py);
    input.inside = true;
    this.reticle.style.transform = `translate(${this.px}px, ${this.py}px)`;
    this.reticle.classList.add('on');
    this.reticle.classList.toggle('hot', !!g.hand.hover || !!g.hoverBuilding);
    this.reticle.classList.toggle('holding', !!g.hand.held);

    // --- camera: right stick pans, X held orbits / tilts
    const [cx, cy] = radial(rx, ry);
    const xHeld = st.buttons[B.X] && now - (this.pressedAt[B.X] ?? 0) > HOLD_X;
    if (cx || cy) {
      if (xHeld) {
        this.xMode = true;
        cam.rotate(-cx * 1.8 * dt, cy * -1.0 * dt);
      } else {
        const pan = cam.distance * 0.9 * dt;
        cam.panLocal(cx * pan, -cy * pan);
      }
    }
    if (st.buttons[B.LS] || st.buttons[B.RB]) cam.zoom(1 - 1.5 * dt);
    if (st.buttons[B.RS] || st.buttons[B.LB]) cam.zoom(1 + 1.5 * dt);

    // --- A: grab / set down / drag the land / press a HUD button
    const aDown = st.buttons[B.A] || st.buttons[B.RT];
    const aWas = this.prev[B.A] || this.prev[B.RT];
    if (aDown && !aWas) this.aPress(now);
    if (!aDown && aWas) this.aRelease(now);

    // --- LT: the right button (slap the golem, flick-throw with something in hand); optional
    if (st.buttons[B.LT] && !this.ltDown) {
      this.ltDown = true;
      input.padButton(2, true);
    } else if (!st.buttons[B.LT] && this.ltDown) {
      this.ltDown = false;
      input.padButton(2, false);
    }

    // --- B: put back / refund / close
    if (edge(B.B)) this.cancel();

    // --- X: home, or slap the golem
    if (up(B.X)) {
      if (!this.xMode && now - (this.pressedAt[B.X] ?? 0) <= HOLD_X) {
        if (!g.hand.held && g.hoverBuilding && g.hoverBuilding instanceof Golem) input.padButton(2, true), input.padButton(2, false);
        else input.padKey('Space', ' ');
      }
      this.xMode = false;
    }

    // --- Y: golem, or throw
    if (g.hand.held) {
      if (edge(B.Y)) this.yCharging = true;
      if (up(B.Y) && this.yCharging) this.throwHeld(now);
    } else {
      this.yCharging = false;
      if (up(B.Y)) {
        const long = now - (this.pressedAt[B.Y] ?? 0) > HOLD_CALL;
        input.padKey(long ? 'KeyL' : 'KeyC', long ? 'l' : 'c');
      }
    }

    // --- keys the game already has
    if (edge(B.UP)) input.padKey('Digit1', '1');
    if (edge(B.LEFT)) input.padKey('Digit2', '2');
    if (edge(B.RIGHT)) input.padKey('Digit3', '3');
    if (edge(B.DOWN) || edge(B.START)) input.padKey('KeyP', 'p');
    if (edge(B.VIEW)) input.padKey('KeyH', 'h');
  }

  private aPress(now: number) {
    const g = this.game;
    const input = this.input;
    this.aSinceGrab = now;
    // Over a HUD control (a button, a village row, the worship slider): press it.
    const ui = this.uiUnderHand();
    if (ui) {
      this.pressElement(ui);
      this.aMode = 'tap';
      return;
    }
    if (g.hand.held) {
      // Set it down: the same click the mouse makes on the ground.
      input.padButton(0, true);
      input.padButton(0, false);
      this.aMode = 'tap';
    } else if (g.hand.hover && g.controls.mode === 'none') {
      // Grab. A quick tap keeps it in the hand (tap A again to set it down); holding A and letting go sets it down.
      input.padButton(0, true);
      input.padButton(0, false);
      this.aMode = 'grabbed';
    } else {
      // Bare land, a building, the golem: hold A, like holding the left button (drag the land, stroke the golem).
      input.padButton(0, true);
      this.aMode = 'hold-up';
    }
  }

  private aRelease(now: number) {
    const input = this.input;
    if (this.aMode === 'hold-up') input.padButton(0, false);
    else if (this.aMode === 'grabbed' && this.game.hand.held && now - this.aSinceGrab > HOLD_PLACE) {
      input.padButton(0, true);
      input.padButton(0, false);
    }
    this.aMode = 'none';
  }

  /** B: a miracle is refunded, a held thing goes back where it was, otherwise the open panel closes. */
  private cancel() {
    const g = this.game;
    const held = g.hand.held;
    if (held) {
      if (held.kind === 'orb') g.cancelMiracle();
      else if (g.hand.hasPickedFrom) {
        const p = g.hand.pickedFrom;
        const ok = g.terrain.isLand(p.x, p.z, 0.8);
        if (ok) g.hand.place(g, new THREE.Vector3(p.x, g.terrain.surfaceAt(p.x, p.z), p.z));
        else g.setDownHeld();
      } else g.setDownHeld();
      return;
    }
    this.input.padKey('Escape', 'Escape');
  }

  private throwHeld(now: number) {
    const g = this.game;
    this.yCharging = false;
    const held = g.hand.held;
    if (!held) return;
    const charge = Math.min(1, (now - (this.pressedAt[B.Y] ?? now)) / THROW_CHARGE);
    const S = 60 + 130 * charge;
    // Stick direction on screen -> world direction on the ground (up = away from the camera).
    const yaw = g.godCam.yaw;
    const fwd = -this.lastDir.y;
    const right = this.lastDir.x;
    const dx = -Math.sin(yaw) * fwd + Math.cos(yaw) * right;
    const dz = -Math.cos(yaw) * fwd - Math.sin(yaw) * right;
    const gain = 0.65;
    const vel = new THREE.Vector3(dx * S * gain, S * 0.42 * gain + 3, dz * S * gain);
    vel.clampLength(0, 125);
    g.hand.throw(g, vel);
  }

  // ----------------------------------------------------------- HUD under the hand

  private uiUnderHand(): HTMLElement | null {
    const t = document.elementFromPoint(this.px, this.py);
    if (!t || !(t instanceof HTMLElement)) return null;
    if (t instanceof HTMLCanvasElement || t.id === 'app' || t === document.body || t === document.documentElement) return null;
    if (t.classList.contains('hud') || t.classList.contains('pad-reticle')) return null;
    return t;
  }

  private pressElement(el: HTMLElement) {
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const r = el.getBoundingClientRect();
      const min = Number(el.min || 0);
      const max = Number(el.max || 100);
      const step = Number(el.step || 1);
      const f = Math.max(0, Math.min(1, (this.px - r.left) / Math.max(1, r.width)));
      el.value = String(Math.round((min + f * (max - min)) / step) * step);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    const opts = { bubbles: true, cancelable: true, clientX: this.px, clientY: this.py, button: 0, pointerType: 'mouse', isPrimary: true };
    el.dispatchEvent(new PointerEvent('pointerdown', opts));
    el.dispatchEvent(new PointerEvent('pointerup', opts));
    el.click();
  }

  // ----------------------------------------------------------------- menus

  /** The full-screen thing in the way, if any: an ending, the title / help, a win or ring card. */
  private modal(): { kind: 'cine' | 'ring' | 'overlay'; el: HTMLElement } | null {
    const vis = (e: Element | null): e is HTMLElement => !!e && e.getClientRects().length > 0 && getComputedStyle(e).visibility !== 'hidden';
    const cine = document.querySelector<HTMLElement>('.endings-layer.on');
    if (vis(cine)) return { kind: 'cine', el: cine };
    const ring = document.querySelector<HTMLElement>('.rv-tempt.show');
    if (vis(ring)) return { kind: 'ring', el: ring };
    const overlays = Array.from(document.querySelectorAll<HTMLElement>('.overlay:not(.hidden)')).filter(vis);
    const top = overlays[overlays.length - 1];
    if (top) return { kind: 'overlay', el: top };
    return null;
  }

  private menuFrame(
    m: { kind: 'cine' | 'ring' | 'overlay'; el: HTMLElement },
    st: PadState,
    edge: (i: number) => boolean,
    dt: number,
    lx: number,
    ly: number,
  ) {
    const input = this.input;
    this.placed = false;
    if (this.aMode === 'hold-up') input.padButton(0, false);
    this.aMode = 'none';
    const a = edge(B.A) || edge(B.RT);
    const b = edge(B.B);
    const start = edge(B.START);
    if (m.kind === 'cine') {
      // The endings listen for a key: any key moves them along, Escape skips.
      if (a || start) this.fakeKey('Enter', 'Enter');
      if (b) this.fakeKey('Escape', 'Escape');
      return;
    }
    // Pointer-style menus: move focus between the buttons, A presses, B backs out.
    this.navCool = Math.max(0, this.navCool - dt);
    let dir: 'up' | 'down' | 'left' | 'right' | null = null;
    if (st.buttons[B.UP] || ly < -NAV_DEAD) dir = 'up';
    else if (st.buttons[B.DOWN] || ly > NAV_DEAD) dir = 'down';
    else if (st.buttons[B.LEFT] || lx < -NAV_DEAD) dir = 'left';
    else if (st.buttons[B.RIGHT] || lx > NAV_DEAD) dir = 'right';
    const items = this.focusables(m.el);
    let cur = items.find((e) => e === document.activeElement) ?? null;
    if (!cur || !items.includes(cur)) {
      cur = items.find((e) => e.matches('.begin, .rt-refuse')) ?? items[0] ?? null;
      this.setFocus(cur);
    }
    if (dir && (this.navLast !== dir || this.navCool === 0) && cur) {
      this.navCool = this.navLast === dir ? 0.14 : 0.32;
      if (cur instanceof HTMLInputElement && cur.type === 'range' && (dir === 'left' || dir === 'right')) {
        const step = Number(cur.step || 1) * (dir === 'left' ? -1 : 1);
        cur.value = String(Math.max(Number(cur.min || 0), Math.min(Number(cur.max || 100), Number(cur.value) + step)));
        cur.dispatchEvent(new Event('input', { bubbles: true }));
        cur.dispatchEvent(new Event('change', { bubbles: true }));
      } else {
        const next = this.neighbour(cur, items, dir);
        if (next) this.setFocus(next);
      }
    }
    this.navLast = dir;
    if (a && cur) {
      if (cur instanceof HTMLInputElement && cur.type === 'range') return;
      cur.click();
      this.navLast = null;
    }
    if (b || start) {
      const g = this.game;
      if (m.kind === 'ring') m.el.querySelector<HTMLButtonElement>('.rt-refuse')?.click();
      else if (m.el.classList.contains('help')) {
        if (m.el.classList.contains('show-controls')) m.el.querySelector<HTMLButtonElement>('.help-toggle')?.click();
        else g.hud.closeOverlays();
      } else m.el.querySelector<HTMLButtonElement>('.begin, .d-close')?.click();
    }
  }

  private fakeKey(key: string, code: string) {
    window.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key, code, bubbles: true, cancelable: true }));
  }

  private focusables(root: HTMLElement): HTMLElement[] {
    const out: HTMLElement[] = [];
    root.querySelectorAll<HTMLElement>('button, a[href], input, select, [tabindex]').forEach((e) => {
      if (e instanceof HTMLInputElement && !/^(range|checkbox|radio|button|submit)$/.test(e.type)) return; // no typing on a pad
      if ((e as HTMLButtonElement).disabled || e.getAttribute('tabindex') === '-1') return;
      const r = e.getBoundingClientRect();
      if (r.width < 2 || r.height < 2 || getComputedStyle(e).visibility === 'hidden') return;
      let p: HTMLElement | null = e;
      while (p && p !== root) {
        const cs = getComputedStyle(p);
        if (cs.display === 'none' || Number(cs.opacity) < 0.05) return;
        p = p.parentElement;
      }
      out.push(e);
    });
    return out;
  }

  private neighbour(cur: HTMLElement, items: HTMLElement[], dir: 'up' | 'down' | 'left' | 'right'): HTMLElement | null {
    const c = cur.getBoundingClientRect();
    const cx = c.left + c.width / 2;
    const cy = c.top + c.height / 2;
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const e of items) {
      if (e === cur) continue;
      const r = e.getBoundingClientRect();
      const dx = r.left + r.width / 2 - cx;
      const dy = r.top + r.height / 2 - cy;
      const along = dir === 'up' ? -dy : dir === 'down' ? dy : dir === 'left' ? -dx : dx;
      const across = dir === 'up' || dir === 'down' ? Math.abs(dx) : Math.abs(dy);
      if (along <= 2) continue;
      const score = along + across * 2.2;
      if (score < bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  private setFocus(e: HTMLElement | null) {
    this.clearFocus();
    if (!e) return;
    e.classList.add('pad-focus');
    e.focus({ preventScroll: true });
  }

  private clearFocus() {
    document.querySelectorAll('.pad-focus').forEach((e) => e.classList.remove('pad-focus'));
  }
}

/**
 * The intro film plays before the game exists (a first visit builds the game behind it), so a pad needs its own
 * small listener until then: A moves the film along (touches the light), B or Start skips it. Once the game is
 * up its GamepadInput takes over.
 */
export function startEarlyPad() {
  installFakePad();
  let prev: boolean[] = [];
  const key = (k: string) => {
    window.dispatchEvent(new KeyboardEvent('keydown', { key: k, code: k, bubbles: true, cancelable: true }));
    window.dispatchEvent(new KeyboardEvent('keyup', { key: k, code: k, bubbles: true, cancelable: true }));
  };
  const loop = () => {
    if ((window as unknown as { game?: unknown }).game && !document.querySelector('.intro')) return;
    let pad: Gamepad | null = null;
    try {
      for (const p of navigator.getGamepads?.() ?? []) if (p && p.connected) pad = p;
    } catch {
      pad = null;
    }
    if (pad) {
      (window as unknown as { __nativeGamepad?: boolean }).__nativeGamepad = true;
      const cur = Array.from({ length: 16 }, (_, i) => !!pad!.buttons[i]?.pressed);
      const edge = (i: number) => cur[i] && !prev[i];
      if (document.querySelector('.intro')) {
        if (edge(B.A) || edge(B.START) || edge(B.RT)) key('Enter');
        if (edge(B.B)) key('Escape');
      }
      prev = cur;
    }
    requestAnimationFrame(loop);
  };
  requestAnimationFrame(loop);
}
