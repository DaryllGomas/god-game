import * as THREE from 'three';
import type { Game } from '../Game';
import type { Input, InputEvent } from './Input';
import type { MiracleId } from '../miracles/Miracles';
import { Golem } from '../creature/Golem';
import { GamepadInput } from './Gamepad';

const CLICK_SLOP = 6; // px of movement before a press becomes a drag
const THROW_MIN_SPEED = 9;
const THROW_MAX_SPEED = 125;
/** Pixels of rubbing per stroke "tick" on the creature. */
const RUB_PER_STROKE = 140;
/** Only the first few rubs of one stroking session teach anything (a slap is one sharp lesson). */
const LEARNING_RUBS = 4;
/** Hand speed → throw speed. Below 1 so ordinary flicks land on the island. */
const THROW_GAIN = 0.65;
/** One wheel event zooms at most this much (a hard flick or a line-mode wheel used to jump the view far in or out). */
const WHEEL_MAX = 240;
/** A double-click flies the camera only when neither of its clicks did anything else for this long (seconds). */
const FLY_QUIET = 0.7;

/**
 * Mouse scheme (B&W-flavoured):
 *   LMB on a thing      grab it (it stays in your hand)
 *   LMB drag on land    drag the world around
 *   LMB click on land   put the held thing down there
 *   RMB flick+release   throw what you're holding (a still click just drops it)
 *   RMB / MMB drag      rotate & tilt (with an empty hand)
 *   Wheel               zoom to cursor (capped per notch)
 *   Double-click bare land with an empty hand   fly there (not when either click grabbed, placed or picked something)
 *   MMB / Shift+LMB on the golem, hold   leash: it follows where the hand points
 */
export class Controls {
  mode: 'none' | 'pan' | 'rotate' | 'throw' | 'stroke' | 'leash' = 'none';
  private dragDist = 0;
  private rub = 0;
  private rubs = 0;
  /** realTime of the last click that did something (grab, set down, throw, pick a building, pat). */
  private actedAt = -1e9;
  private readonly ray = new THREE.Raycaster();
  private readonly ndc = new THREE.Vector2();
  private readonly v = new THREE.Vector3();

  readonly pad: GamepadInput;

  constructor(
    private readonly game: Game,
    private readonly input: Input,
  ) {
    this.pad = new GamepadInput(game, input);
  }

  update(dt: number, realTime: number) {
    const g = this.game;
    const cam = g.godCam;
    this.pad.update(dt, realTime); // a gamepad feeds the same pointer and key queue as the mouse and keyboard
    const { dx, dy } = this.input.consumeDelta();
    if (this.mode !== 'none') this.dragDist += Math.abs(dx) + Math.abs(dy);

    for (const ev of this.input.consume()) this.handle(ev, realTime);
    // A drag whose button is no longer held (its release was lost) ends as if it had been let go, so the hand is never
    // left stuck turning, panning or mid-throw with nothing able to grab or set down (2026-10-18).
    if (this.mode !== 'none' && this.input.buttons.size === 0) {
      const button = this.mode === 'throw' || this.mode === 'rotate' ? 2 : 0;
      this.handle({ type: 'up', button, x: this.input.x, y: this.input.y }, realTime);
      this.mode = 'none';
    }

    if (this.mode === 'pan' && cam.isGrabbing && this.dragDist > CLICK_SLOP) {
      this.ndc.set(this.input.nx, this.input.ny);
      this.ray.setFromCamera(this.ndc, cam.camera);
      cam.dragGrab(this.ray.ray);
    }
    if (this.mode === 'rotate') cam.rotate(-dx * 0.006, dy * 0.004);
    if (this.mode === 'leash' && g.hand.valid) g.creature.leash(g, g.hand.ground);
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
        if (onCreature && (ev.button === 1 || (ev.button === 0 && (this.input.keys.has('ShiftLeft') || this.input.keys.has('ShiftRight'))))) {
          this.mode = 'leash';
          return;
        }
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
            // What counts is where the thing stands, not the ground under the pointer: by the shore or at the edge of
            // your light the pointer often lands just outside it (on the water), and a tree or rock well inside your
            // light refused to come (2026-10-18, Daryll: "the trees over by the shore are hard as well").
            if (!g.inInfluence(target.pos.x, target.pos.z)) g.message('That is outside your area of influence.', 'warn', 'influence');
            else {
              hand.grab(g, target);
              this.actedAt = realTime;
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
        if (this.mode === 'leash' && (ev.button === 0 || ev.button === 1)) {
          this.mode = 'none';
          g.creature.endLeash();
          return;
        }
        if (ev.button === 0 && this.mode === 'stroke') {
          this.mode = 'none';
          if (click) g.creature.pat(g);
          this.actedAt = realTime;
          return;
        }
        if (ev.button === 0 && this.mode === 'pan') {
          cam.endGrab();
          this.mode = 'none';
          if (!click) return;
          if (hand.held) {
            this.placeHeld();
            this.actedAt = realTime;
          } else {
            if (g.hoverBuilding) this.actedAt = realTime;
            g.clickEntity(g.hoverBuilding);
          }
        } else if (ev.button === 2 && this.mode === 'throw') {
          this.mode = 'none';
          this.release(realTime);
          this.actedAt = realTime;
        } else if ((ev.button === 2 || ev.button === 1) && this.mode === 'rotate') {
          this.mode = 'none';
        }
        break;
      }
      case 'wheel':
        cam.zoom(Math.pow(1.0013, Math.max(-WHEEL_MAX, Math.min(WHEEL_MAX, ev.delta))), hand.valid ? hand.ground : undefined);
        break;
      case 'dblclick':
        // Fly-to is a deliberate gesture: two clicks on bare land with an empty hand. Two quick clicks that set
        // something down, grabbed, or picked a building (2026-10-15 playtest) leave the camera where it is.
        if (hand.valid && !hand.held && !hand.hover && !g.hoverBuilding && realTime - this.actedAt > FLY_QUIET)
          cam.flyTo(hand.ground.x, hand.ground.z);
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
      g.handHint('Only inside your light. Throw it!', 'You can only set things down inside your influence. Try throwing it!', 'influence');
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
