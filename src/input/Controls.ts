import * as THREE from 'three';
import type { Game } from '../Game';
import type { Input, InputEvent } from './Input';
import type { MiracleId } from '../miracles/Miracles';
import { Golem } from '../creature/Golem';

const CLICK_SLOP = 6; // px of movement before a press becomes a drag
const THROW_MIN_SPEED = 9;
const THROW_MAX_SPEED = 125;
/** Pixels of rubbing per stroke "tick" on the creature. */
const RUB_PER_STROKE = 140;
/** Only the first few rubs of one stroking session teach anything (a slap is one sharp lesson). */
const LEARNING_RUBS = 4;
/** Hand speed → throw speed. Below 1 so ordinary flicks land on the island. */
const THROW_GAIN = 0.65;

/**
 * Mouse scheme (B&W-flavoured):
 *   LMB on a thing      grab it (it stays in your hand)
 *   LMB drag on land    drag the world around
 *   LMB click on land   put the held thing down there
 *   RMB flick+release   throw what you're holding (a still click just drops it)
 *   RMB / MMB drag      rotate & tilt (with an empty hand)
 *   Wheel               zoom to cursor, double-click to fly there
 */
export class Controls {
  mode: 'none' | 'pan' | 'rotate' | 'throw' | 'stroke' = 'none';
  private dragDist = 0;
  private rub = 0;
  private rubs = 0;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly v = new THREE.Vector3();

  constructor(
    private readonly game: Game,
    private readonly input: Input,
  ) {}

  update(dt: number, realTime: number) {
    const g = this.game;
    const cam = g.godCam;
    const { dx, dy } = this.input.consumeDelta();
    if (this.mode !== 'none') this.dragDist += Math.abs(dx) + Math.abs(dy);

    for (const ev of this.input.consume()) this.handle(ev, realTime);

    if (this.mode === 'pan' && cam.isGrabbing && this.dragDist > CLICK_SLOP) {
      this.ndc.set(this.input.nx, this.input.ny);
      this.ray.setFromCamera(this.ndc, cam.camera);
      cam.dragGrab(this.ray.ray);
    }
    if (this.mode === 'rotate') cam.rotate(-dx * 0.006, dy * 0.004);
    if (this.mode === 'stroke') {
      this.rub += Math.abs(dx) + Math.abs(dy);
      while (this.rub >= RUB_PER_STROKE) {
        this.rub -= RUB_PER_STROKE;
        g.creature.stroke(g, ++this.rubs <= LEARNING_RUBS);
      }
    }

    // Keyboard camera
    const k = this.input.keys;
    const pan = cam.distance * 0.9 * dt;
    let r = 0;
    let f = 0;
    if (k.has('KeyW') || k.has('ArrowUp')) f += pan;
    if (k.has('KeyS') || k.has('ArrowDown')) f -= pan;
    if (k.has('KeyD') || k.has('ArrowRight')) r += pan;
    if (k.has('KeyA') || k.has('ArrowLeft')) r -= pan;
    if (r || f) cam.panLocal(r, f);
    if (k.has('KeyQ')) cam.rotate(1.6 * dt, 0);
    if (k.has('KeyE')) cam.rotate(-1.6 * dt, 0);
    if (k.has('KeyR')) cam.zoom(1 - 1.5 * dt);
    if (k.has('KeyF')) cam.zoom(1 + 1.5 * dt);
    if (k.has('KeyT')) cam.rotate(0, 1.0 * dt);
    if (k.has('KeyG')) cam.rotate(0, -1.0 * dt);
  }

  private handle(ev: InputEvent, realTime: number) {
    const g = this.game;
    const hand = g.hand;
    const cam = g.godCam;
    switch (ev.type) {
      case 'down': {
        if (this.mode !== 'none') return;
        this.dragDist = 0;
        const onCreature = !hand.held && g.hoverBuilding instanceof Golem;
        if (ev.button === 0 && onCreature) {
          this.mode = 'stroke';
          this.rub = 0;
          this.rubs = 0;
          return;
        }
        if (ev.button === 2 && onCreature) {
          g.creature.slap(g);
          hand.model.swat();
          return;
        }
        if (ev.button === 0) {
          const target = hand.hover;
          if (target && !hand.held) {
            if (hand.blocked) g.message('That is outside your area of influence.', 'warn', 'influence');
            else {
              hand.grab(g, target);
              return;
            }
          }
          this.mode = 'pan';
          if (hand.valid) cam.beginGrab(hand.ground);
        } else if (ev.button === 2) {
          this.mode = hand.held ? 'throw' : 'rotate';
        } else if (ev.button === 1) {
          this.mode = 'rotate';
        }
        break;
      }
      case 'up': {
        const click = this.dragDist < CLICK_SLOP;
        if (ev.button === 0 && this.mode === 'stroke') {
          this.mode = 'none';
          if (click) g.creature.pat(g);
          return;
        }
        if (ev.button === 0 && this.mode === 'pan') {
          cam.endGrab();
          this.mode = 'none';
          if (!click) return;
          if (hand.held) this.placeHeld();
          else g.clickEntity(g.hoverBuilding);
        } else if (ev.button === 2 && this.mode === 'throw') {
          this.mode = 'none';
          this.release(realTime);
        } else if ((ev.button === 2 || ev.button === 1) && this.mode === 'rotate') {
          this.mode = 'none';
        }
        break;
      }
      case 'wheel':
        cam.zoom(Math.pow(1.0013, ev.delta), hand.valid ? hand.ground : undefined);
        break;
      case 'dblclick':
        if (hand.valid && !hand.held) cam.flyTo(hand.ground.x, hand.ground.z);
        break;
      case 'key':
        this.onKey(ev.code);
        break;
    }
  }

  private placeHeld() {
    const g = this.game;
    const hand = g.hand;
    if (!hand.valid) return;
    if (hand.blocked) {
      g.message('You can only set things down inside your influence. Try throwing it!', 'warn', 'influence');
      return;
    }
    // A miracle orb set down is simply cast on the spot.
    hand.place(g, hand.ground);
  }

  private release(realTime: number) {
    const g = this.game;
    const hand = g.hand;
    const v = hand.velocity(realTime, this.v);
    const hs = Math.hypot(v.x, v.z);
    if (hs < THROW_MIN_SPEED) {
      this.placeHeld();
      return;
    }
    const vel = new THREE.Vector3(v.x * THROW_GAIN, (Math.max(0, v.y) * 0.4 + hs * 0.42) * THROW_GAIN + 3, v.z * THROW_GAIN);
    vel.clampLength(0, THROW_MAX_SPEED);
    hand.throw(g, vel);
  }

  private onKey(code: string) {
    const g = this.game;
    const miracleKeys: Record<string, MiracleId> = { Digit1: 'water', Digit2: 'food', Digit3: 'fire' };
    if (miracleKeys[code]) return g.selectMiracle(miracleKeys[code]);
    switch (code) {
      case 'Escape':
        if (g.hand.held?.kind === 'orb') g.cancelMiracle();
        else g.hud.closeOverlays();
        break;
      case 'KeyH':
      case 'F1':
        g.hud.toggleHelp();
        break;
      case 'KeyP':
        g.togglePause();
        break;
      case 'Space':
        g.goHome();
        break;
      case 'KeyC':
        g.focusCreature();
        break;
      case 'KeyL':
        g.callCreature();
        break;
      case 'KeyM':
        g.hud.toggleSound();
        break;
      case 'KeyN':
        g.hud.toggleMusic();
        break;
      case 'BracketRight':
        g.setSpeed(Math.min(4, g.speed * 2));
        break;
      case 'BracketLeft':
        g.setSpeed(Math.max(1, g.speed / 2));
        break;
    }
  }
}
