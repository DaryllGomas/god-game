export type InputEvent =
  | { type: 'down'; button: number; x: number; y: number }
  | { type: 'up'; button: number; x: number; y: number }
  | { type: 'wheel'; delta: number; x: number; y: number }
  | { type: 'dblclick'; x: number; y: number }
  | { type: 'key'; key: string; code: string };

/** e.buttons bit for each e.button (left 0, middle 1, right 2). */
const BIT: Record<number, number> = { 0: 1, 1: 4, 2: 2, 3: 8, 4: 16 };

/** The tags that float over the world and take clicks (a dream's tag, a prayer's bubble, a village's prayer mark). */
export const WORLD_TAGS = '.pj-chip, .pr-bubble, .pr-mark';
const onTag = (t: EventTarget | null): boolean => t instanceof Element && !!t.closest(WORLD_TAGS);

/** Raw pointer/keyboard state for the canvas, plus an event queue drained once per frame. */
export class Input {
  x = 0;
  y = 0;
  /** Normalised device coords (-1..1). */
  nx = 0;
  ny = 0;
  inside = false;
  readonly buttons = new Set<number>();
  readonly keys = new Set<string>();
  /** The mouse buttons held (the gamepad's presses are kept apart, in buttons only). */
  private readonly mouse = new Set<number>();
  private queue: InputEvent[] = [];
  /** Set by the game: is there a thing right under the pointer here that a press should take, though a tag is on top? */
  underTag: ((clientX: number, clientY: number) => boolean) | null = null;
  private overTag = false;
  private throughTag = false;
  private swallowClick = false;
  private movedX = 0;
  private movedY = 0;

  constructor(private readonly el: HTMLElement) {
    el.addEventListener('pointermove', (e) => this.onMove(e));
    el.addEventListener('pointerdown', (e) => {
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // Synthetic events (tests, automation) have no capturable pointer.
      }
      this.onMove(e);
      this.syncButtons(e, e.button, true);
      e.preventDefault();
    });
    el.addEventListener('pointerup', (e) => {
      this.onMove(e);
      this.syncButtons(e, e.button, false);
    });
    // The pointer was taken away mid-press (the window lost it, a system gesture): every held button is let go.
    el.addEventListener('pointercancel', () => this.releaseMouse());
    el.addEventListener('lostpointercapture', (e) => {
      if (!e.buttons) this.releaseMouse();
    });
    el.addEventListener('pointerenter', () => (this.inside = true));
    el.addEventListener('pointerleave', () => (this.inside = false));
    // Under a floating tag the hand keeps following the pointer (the tag is small and the land is right under it), and
    // a press with the pointer right on a rock there takes it instead of pressing the tag (2026-11-17).
    window.addEventListener(
      'pointermove',
      (e) => {
        if (onTag(e.target)) {
          this.overTag = true;
          this.moveTo(e.clientX, e.clientY);
        } else if (this.overTag) {
          this.overTag = false;
          if (e.target !== el) this.inside = false;
        }
      },
      true,
    );
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0 || !onTag(e.target) || !this.underTag?.(e.clientX, e.clientY)) return;
        e.preventDefault();
        e.stopPropagation();
        this.throughTag = this.swallowClick = true;
        this.moveTo(e.clientX, e.clientY);
        this.mouse.add(0); // held, as far as the canvas is concerned: a move onto the canvas must not press it again
        this.buttons.add(0);
        this.queue.push({ type: 'down', button: 0, x: e.clientX, y: e.clientY });
      },
      true,
    );
    window.addEventListener(
      'pointerup',
      (e) => {
        if (!this.throughTag || e.button !== 0) return;
        this.throughTag = false;
        if (!this.mouse.has(0)) return; // the canvas already saw it let go
        this.mouse.delete(0);
        this.buttons.delete(0);
        this.queue.push({ type: 'up', button: 0, x: e.clientX, y: e.clientY });
      },
      true,
    );
    window.addEventListener(
      'click',
      (e) => {
        if (!this.swallowClick) return;
        this.swallowClick = false;
        if (onTag(e.target)) {
          e.preventDefault();
          e.stopPropagation(); // the press took the thing under the tag: the tag itself is not clicked
        }
      },
      true,
    );
    el.addEventListener(
      'wheel',
      (e) => {
        this.queue.push({ type: 'wheel', delta: e.deltaY * (e.deltaMode === 1 ? 33 : 1), x: e.clientX, y: e.clientY });
        e.preventDefault();
      },
      { passive: false },
    );
    el.addEventListener('dblclick', (e) => this.queue.push({ type: 'dblclick', x: e.clientX, y: e.clientY }));
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    // Space is "home". A HUD button keeps focus after it is clicked, and Space would press it again (re-picking a
    // miracle, toggling the sound): blur it and keep the key for the game.
    const spaceOnButton = (e: KeyboardEvent) => {
      if (e.code !== 'Space' || !(e.target instanceof HTMLButtonElement)) return;
      e.preventDefault();
      e.target.blur();
    };
    window.addEventListener('keyup', spaceOnButton, true);
    window.addEventListener('keydown', (e) => {
      spaceOnButton(e);
      if (e.target instanceof HTMLInputElement) return;
      if (!e.repeat) this.queue.push({ type: 'key', key: e.key, code: e.code });
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.releaseMouse();
      this.buttons.clear();
    });
  }

  private onMove(e: PointerEvent) {
    this.moveTo(e.clientX, e.clientY);
    if (e.type === 'pointermove') this.syncButtons(e);
  }

  /**
   * Mouse buttons from the pointer's own record of what is held (e.buttons). A second button pressed while another is
   * down arrives only as a pointermove, and so does a release that leaves one held (pointer events are "chorded"), so
   * each change is turned into its own down/up here. 2026-10-18 (Daryll): a middle-drag with another button pressed
   * left the controls stuck turning or throwing, and nothing could be grabbed or set down after it.
   */
  private syncButtons(e: PointerEvent, button = -1, down = false) {
    let mask = e.buttons;
    // Synthetic events (tests, automation) may not fill in e.buttons: trust the button they name.
    if (button >= 0) mask = down ? mask | (BIT[button] ?? 0) : mask & ~(BIT[button] ?? 0);
    for (const b of [0, 1, 2]) {
      const now = (mask & BIT[b]) !== 0;
      if (now === this.mouse.has(b)) continue;
      if (now) this.mouse.add(b);
      else this.mouse.delete(b);
      if (now) this.buttons.add(b);
      else this.buttons.delete(b);
      this.queue.push({ type: now ? 'down' : 'up', button: b, x: e.clientX, y: e.clientY });
    }
  }

  /** Let go of every held mouse button (each one sends its 'up', so a drag or a throw ends properly). */
  private releaseMouse() {
    for (const b of [...this.mouse]) {
      this.mouse.delete(b);
      this.buttons.delete(b);
      this.queue.push({ type: 'up', button: b, x: this.x, y: this.y });
    }
  }

  /** Put the pointer at a client position (the mouse, or the gamepad's hand). */
  moveTo(cx: number, cy: number) {
    const r = this.el.getBoundingClientRect();
    this.movedX += cx - this.x;
    this.movedY += cy - this.y;
    this.x = cx;
    this.y = cy;
    this.nx = ((cx - r.left) / r.width) * 2 - 1;
    this.ny = -((cy - r.top) / r.height) * 2 + 1;
    this.inside = true;
  }

  /** The gamepad presses or releases a pointer button at the pointer (same events as the mouse). */
  padButton(button: number, down: boolean) {
    if (down) this.buttons.add(button);
    else this.buttons.delete(button);
    this.queue.push({ type: down ? 'down' : 'up', button, x: this.x, y: this.y });
  }

  /** The gamepad "types" a key the game already knows. */
  padKey(code: string, key = code) {
    this.queue.push({ type: 'key', key, code });
  }

  consume(): InputEvent[] {
    const q = this.queue;
    this.queue = [];
    return q;
  }

  /** Pointer movement in pixels since the last call. */
  consumeDelta(): { dx: number; dy: number } {
    const d = { dx: this.movedX, dy: this.movedY };
    this.movedX = 0;
    this.movedY = 0;
    return d;
  }
}
