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
    window.addEventListener('keydown', (e) => {
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
    const r = this.el.getBoundingClientRect();
    this.movedX += e.clientX - this.x;
    this.movedY += e.clientY - this.y;
    this.x = e.clientX;
    this.y = e.clientY;
    this.nx = ((e.clientX - r.left) / r.width) * 2 - 1;
    this.ny = -((e.clientY - r.top) / r.height) * 2 + 1;
    this.inside = true;
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
