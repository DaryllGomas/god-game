import type * as THREE from 'three';

/** What Hand.ts / Controls.ts need from a hand model (skinned or primitive fallback). */
export interface HandRig {
  readonly root: THREE.Group;
  /** 0 = open, 1 = closed fist. */
  setGrip(g: number): void;
  /** `alignment` -1 (cruel) .. 1 (kind); `blocked` = outside the player's influence. */
  setAppearance(alignment: number, blocked: boolean): void;
  /** A quick sideways swat (slapping the creature). */
  swat(): void;
  /** Flat, gentle palm while stroking the creature. */
  setStroking(on: boolean): void;
  /** Objects the post-processing AO pre-pass must skip (glow sprites). */
  readonly aoIgnore?: THREE.Object3D[];
  update(dt: number, swayX: number, swayZ: number): void;
}
