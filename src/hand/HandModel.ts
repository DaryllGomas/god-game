import * as THREE from 'three';
import { assets } from '../assets';
import type { HandRig } from './HandRig';
import { ProceduralHand } from './ProceduralHand';
import { SkinnedHand } from './SkinnedHand';

/**
 * Resting angle (radians), Black & White style: rather than showing its whole back to the camera,
 * the hand reaches into the world a little side-on, so it covers less of the view.
 * `pitch` < 0 dips the fingers away from the camera, `yaw` > 0 points them left (wrist toward the
 * lower right of the screen), `roll` < 0 lifts the thumb side.
 */
const POSE = { pitch: -0.5, yaw: 0.45, roll: -0.5 };

/**
 * The god's right hand. Uses the Blender-built skinned model (`hand.glb`) when it loaded, else the
 * primitive-built fallback. Palm down, fingers along -Z. Public API is what Hand.ts / Controls.ts use:
 * `grip` curls the fingers (0 open, 1 fist), `swat()` slaps, `setStroking()` lays the palm flat.
 */
export class HandModel implements HandRig {
  readonly root = new THREE.Group();
  readonly aoIgnore: THREE.Object3D[];
  /** The resting angle; live-tunable from the console (`game.hand.model.pose`). */
  readonly pose = { ...POSE };
  private readonly rig: HandRig;
  private readonly angle = new THREE.Group();

  constructor() {
    this.rig = assets.hand ? new SkinnedHand(assets.hand) : new ProceduralHand();
    this.angle.rotation.order = 'YXZ'; // roll about the fingers, then pitch, then turn
    this.angle.add(this.rig.root);
    this.root.add(this.angle);
    this.aoIgnore = this.rig.aoIgnore ?? [];
  }

  /** A quick sideways swat (slapping the creature). */
  swat() {
    this.rig.swat();
  }

  /** 0 = open, 1 = closed fist. */
  setGrip(g: number) {
    this.rig.setGrip(g);
  }

  /** Flat-palm stroking pose (call every frame; Hand.ts feeds it from the control mode). */
  setStroking(on: boolean) {
    this.rig.setStroking(on);
  }

  /** `alignment` -1 (cruel) .. 1 (kind); `blocked` draws the ghost look outside the player's influence. */
  setAppearance(alignment: number, blocked: boolean) {
    this.rig.setAppearance(alignment, blocked);
  }

  /** Lean with motion so the hand feels weighty. `swayX/Z` are in camera-relative screen units. */
  update(dt: number, swayX: number, swayZ: number) {
    this.angle.rotation.set(this.pose.pitch, this.pose.yaw, this.pose.roll);
    this.rig.update(dt, swayX, swayZ);
  }
}
