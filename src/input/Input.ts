export type InputEvent =
  | { type: 'down'; button: number; x: number; y: number }
  | { type: 'up'; button: number; x: number; y: number }
  | { type: 'wheel'; delta: number; x: number; y: number }
  | { type: 'dblclick'; x: number; y: number }
  | { type: 'key'; key: string; code: string };

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
  private queue: InputEvent[] = [];
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
      this.buttons.add(e.button);
      this.queue.push({ type: 'down', button: e.button, x: e.clientX, y: e.clientY });
      e.preventDefault();
    });
    el.addEventListener('pointerup', (e) => {
      this.onMove(e);
      this.buttons.delete(e.button);
      this.queue.push({ type: 'up', button: e.button, x: e.clientX, y: e.clientY });
    });
    el.addEventListener('pointerenter', () => (this.inside = true));
    el.addEventListener('pointerleave', () => (this.inside = false));
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
      this.buttons.clear();
    });
  }

  private onMove(e: PointerEvent) {
    this.moveTo(e.clientX, e.clientY);
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
