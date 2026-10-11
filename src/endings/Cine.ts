import * as THREE from 'three';
import type { Game } from '../Game';
import { Orb } from '../miracles/Miracles';
import { clamp } from '../util/math';

// ------------------------------------------------------------------ tuning knobs

/** Ora's line: fade in, fade out (real seconds); it holds for as long as the sequence asks. */
const ORA_IN = 1.8;
const ORA_OUT = 2.2;
/** The HUD fades away under a sequence and back after it (CSS, real seconds). */
export const HUD_FADE = 1.4;

export const ease = (t: number) => {
  const x = clamp(t, 0, 1);
  return x * x * (3 - 2 * x);
};
export const easeOut = (t: number) => 1 - Math.pow(1 - clamp(t, 0, 1), 3);
export const easeIn = (t: number) => Math.pow(clamp(t, 0, 1), 2.2);
/** 0 before `a`, 1 after `b`, eased between. */
export const span = (t: number, a: number, b: number) => ease((t - a) / (b - a));

/** A camera key: where it is and what it looks at, at time `t`. */
export interface Shot {
  t: number;
  pos: THREE.Vector3;
  look: THREE.Vector3;
}

const tmpA = new THREE.Vector3();
const tmpB = new THREE.Vector3();

/** Catmull-Rom through the keys (eased in and out at each end), so the camera glides instead of turning corners. */
export function along(keys: Shot[], t: number, outPos: THREE.Vector3, outLook: THREE.Vector3) {
  if (t <= keys[0].t) {
    outPos.copy(keys[0].pos);
    outLook.copy(keys[0].look);
    return;
  }
  const last = keys[keys.length - 1];
  if (t >= last.t) {
    outPos.copy(last.pos);
    outLook.copy(last.look);
    return;
  }
  let i = 0;
  while (i < keys.length - 2 && t > keys[i + 1].t) i++;
  const k0 = keys[Math.max(0, i - 1)];
  const k1 = keys[i];
  const k2 = keys[i + 1];
  const k3 = keys[Math.min(keys.length - 1, i + 2)];
  const u = ease((t - k1.t) / (k2.t - k1.t));
  catmull(k0.pos, k1.pos, k2.pos, k3.pos, u, outPos);
  catmull(k0.look, k1.look, k2.look, k3.look, u, outLook);
}

function catmull(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3) {
  const t2 = t * t;
  const t3 = t2 * t;
  tmpA.copy(p2).sub(p0).multiplyScalar(0.5);
  tmpB.copy(p3).sub(p1).multiplyScalar(0.5);
  out.copy(p1).multiplyScalar(2 * t3 - 3 * t2 + 1)
    .addScaledVector(tmpA, t3 - 2 * t2 + t)
    .addScaledVector(p2, -2 * t3 + 3 * t2)
    .addScaledVector(tmpB, t3 - t2);
}

/**
 * The stage for the endings: takes the camera, hides the HUD (it fades), keeps the player's input off the
 * world, and draws a black veil and Ora's one line above everything. Everything here is driven per frame
 * from code (no CSS timing), so a sequence plays the same at any frame rate and in headless captures.
 */
export class Cine {
  readonly layer: HTMLDivElement;
  readonly pos = new THREE.Vector3();
  readonly look = new THREE.Vector3();
  /** The sequence is driving the camera. */
  camOn = false;
  /** Keys pressed during a sequence come here instead of the game (the end card listens). */
  onKey: ((e: KeyboardEvent) => void) | null = null;
  private active = false;
  private readonly veilEl: HTMLDivElement;
  private readonly oraEl: HTMLDivElement;
  private readonly oraLine: HTMLDivElement;
  private veil = 0;
  private ora: { t: number; hold: number } | null = null;

  constructor(private readonly game: Game) {
    this.layer = document.createElement('div');
    this.layer.className = 'endings-layer';
    this.veilEl = document.createElement('div');
    this.veilEl.className = 'endings-veil';
    this.oraEl = document.createElement('div');
    this.oraEl.className = 'endings-ora';
    // Ora looks the same as in play: the same orb, borrowed from Ora's own element.
    const orb = game.hud.root.querySelector('.ora-orb')?.innerHTML ?? '';
    this.oraEl.innerHTML = `<div class="endings-ora-orb">${orb}</div><div class="endings-ora-line"></div>`;
    this.oraLine = this.oraEl.querySelector('.endings-ora-line')!;
    this.layer.append(this.veilEl, this.oraEl);
    game.hud.root.appendChild(this.layer);

    // The camera: while a sequence runs, the god camera shows the sequence's shot instead of following the player.
    const cam = game.godCam;
    const follow = cam.update.bind(cam);
    cam.update = (dt: number, terrain) => {
      if (this.camOn) this.applyCamera();
      else follow(dt, terrain);
    };

    // Keys never reach the game during a sequence (pointer input is stopped by the layer itself).
    window.addEventListener(
      'keydown',
      (e) => {
        if (!this.active || e.target instanceof HTMLInputElement) return;
        e.stopImmediatePropagation();
        if (!e.repeat) this.onKey?.(e);
      },
      true,
    );
  }

  get running(): boolean {
    return this.active;
  }

  /** Take the stage: HUD away, input off, the player's hand emptied, normal speed. */
  begin() {
    const g = this.game;
    this.active = true;
    g.hud.root.classList.add('endings-cine');
    this.layer.classList.add('on');
    g.input.buttons.clear();
    g.input.keys.clear();
    g.input.inside = false;
    const held = g.hand.held;
    if (held instanceof Orb) g.cancelMiracle();
    else if (held) g.hand.place(g, new THREE.Vector3(held.pos.x, g.terrain.surfaceAt(held.pos.x, held.pos.z), held.pos.z));
    g.selectVillage(null);
    g.paused = false;
    g.speed = 1;
  }

  /** Give the stage back. `keepVeil` leaves the screen as it is (e.g. black, for a reload). */
  end(keepVeil = false) {
    const g = this.game;
    this.active = false;
    if (this.camOn) this.releaseCamera();
    g.hud.root.classList.remove('endings-cine');
    this.layer.classList.remove('on');
    if (!keepVeil) this.setVeil(0);
    this.ora = null;
    this.oraEl.style.opacity = '0';
  }

  // ------------------------------------------------------------- camera

  /** Start driving the camera from where it is now (so the first shot can glide from the player's view). */
  takeCamera() {
    const cam = this.game.godCam.camera;
    this.pos.copy(cam.position);
    cam.getWorldDirection(tmpA);
    this.look.copy(cam.position).addScaledVector(tmpA, this.game.godCam.distance);
    this.camOn = true;
  }

  /** Where the player's view is right now: a starting key for a sequence's first shot. */
  current(t = 0): Shot {
    const cam = this.game.godCam.camera;
    cam.getWorldDirection(tmpA);
    return { t, pos: cam.position.clone(), look: cam.position.clone().addScaledVector(tmpA, this.game.godCam.distance) };
  }

  private applyCamera() {
    const g = this.game;
    const c = g.godCam;
    const cam = c.camera;
    cam.position.copy(this.pos);
    const floor = g.terrain.surfaceAt(this.pos.x, this.pos.z) + 2;
    if (cam.position.y < floor) cam.position.y = floor;
    cam.lookAt(this.look);
    cam.updateMatrixWorld();
    // What the rest of the game reads from the god camera (fog reach, shadows, sound, hand size) follows the shot.
    c.target.set(this.look.x, g.terrain.surfaceAt(this.look.x, this.look.z), this.look.z);
    c.distance = cam.position.distanceTo(this.look);
  }

  /** Hand the camera back to the player, looking where the sequence left it (eased into a playable view). */
  releaseCamera() {
    const g = this.game;
    const c = g.godCam;
    // GodCamera eases toward a private goal; set it too, so the view stays where the sequence left it.
    const goal = (c as unknown as { goal: { target: THREE.Vector3; yaw: number; pitch: number; distance: number } }).goal;
    const cam = c.camera;
    const tx = this.look.x;
    const tz = this.look.z;
    c.target.set(tx, g.terrain.surfaceAt(tx, tz), tz);
    const dx = cam.position.x - c.target.x;
    const dy = cam.position.y - c.target.y;
    const dz = cam.position.z - c.target.z;
    const d = Math.hypot(dx, dy, dz) || 1;
    c.yaw = Math.atan2(dx, dz);
    c.pitch = Math.asin(clamp(dy / d, -1, 1));
    c.distance = d;
    goal.target.copy(c.target);
    goal.yaw = c.yaw;
    goal.pitch = clamp(c.pitch, 0.5, 1.2);
    goal.distance = clamp(d, 90, 260);
    this.camOn = false;
  }

  // -------------------------------------------------------------- veil & Ora

  /** 0 = clear .. 1 = black. */
  setVeil(v: number) {
    this.veil = clamp(v, 0, 1);
    this.veilEl.style.opacity = this.veil.toFixed(3);
  }

  get veilLevel(): number {
    return this.veil;
  }

  /** Ora's one line: fades in, holds `hold` seconds, fades out. */
  say(text: string, hold: number) {
    this.oraLine.textContent = text;
    this.ora = { t: 0, hold };
  }

  get speaking(): boolean {
    return this.ora !== null;
  }

  /** Per rendered frame (real seconds). */
  frame(dt: number) {
    const o = this.ora;
    if (!o) return;
    o.t += dt;
    const k = o.t < ORA_IN ? o.t / ORA_IN : o.t < ORA_IN + o.hold ? 1 : 1 - (o.t - ORA_IN - o.hold) / ORA_OUT;
    const v = clamp(k, 0, 1);
    const e = v * v * (3 - 2 * v);
    this.oraEl.style.opacity = e.toFixed(3);
    this.oraEl.style.setProperty('--blur', `${((1 - e) * 6).toFixed(2)}px`);
    this.oraEl.style.setProperty('--rise', `${((1 - e) * 8).toFixed(1)}px`);
    if (o.t >= ORA_IN + o.hold + ORA_OUT) {
      this.ora = null;
      this.oraEl.style.opacity = '0';
    }
  }
}
