import * as THREE from 'three';
import { damp, lerp } from '../util/math';
import type { HandRig } from './HandRig';

const GOOD_SKIN = new THREE.Color(0xf3d0ad);
const NEUTRAL_SKIN = new THREE.Color(0xe0b08a);
const EVIL_SKIN = new THREE.Color(0x5b3a36);
const GOOD_GLOW = new THREE.Color(0xffd98a);
const EVIL_GLOW = new THREE.Color(0xff2a10);

interface Finger {
  base: THREE.Group;
  mid: THREE.Group;
  tip: THREE.Group;
  curlScale: number;
}

/**
 * Fallback: the god's right hand built from primitives (used if hand.glb fails to load). Palm down, fingers pointing along -Z.
 * `grip` curls the fingers (0 open, 1 fist); `point` extends the index finger.
 */
export class ProceduralHand implements HandRig {
  readonly root = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly mat: THREE.MeshStandardMaterial;
  private readonly nailMat: THREE.MeshStandardMaterial;
  private readonly fingers: Finger[] = [];
  private readonly thumb: Finger;
  private grip = 0;
  private gripTarget = 0;
  private spread = 0;
  private t = 0;
  private swatT = 0;
  private stroking = false;

  constructor() {
    this.mat = new THREE.MeshStandardMaterial({ color: NEUTRAL_SKIN, roughness: 0.55, metalness: 0.0, transparent: true });
    this.nailMat = new THREE.MeshStandardMaterial({ color: 0xf6e6da, roughness: 0.3, transparent: true });
    this.root.add(this.tilt);

    const palm = new THREE.Mesh(new THREE.SphereGeometry(0.5, 18, 12), this.mat);
    palm.scale.set(1.0, 0.36, 1.08);
    this.tilt.add(palm);
    const knuckles = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.72, 4, 10).rotateZ(Math.PI / 2), this.mat);
    knuckles.position.set(0, 0.02, -0.42);
    knuckles.scale.set(1, 0.9, 1);
    this.tilt.add(knuckles);

    // Wrist and a short, level forearm trailing toward the viewer (off the bottom of the screen).
    const forearm = new THREE.Mesh(new THREE.CapsuleGeometry(0.23, 0.8, 4, 12).rotateX(Math.PI / 2), this.mat);
    forearm.position.set(0.02, 0.02, 1.05);
    forearm.scale.set(1.05, 0.85, 1);
    this.tilt.add(forearm);

    const layout = [
      { x: -0.33, len: 0.64 },
      { x: -0.11, len: 0.72 },
      { x: 0.11, len: 0.67 },
      { x: 0.31, len: 0.52 },
    ];
    for (const f of layout) this.fingers.push(this.makeFinger(f.x, -0.48, f.len, 0.092, 1));

    this.thumb = this.makeFinger(-0.46, -0.05, 0.46, 0.11, 0.8);
    this.thumb.base.rotation.set(0, 0.85, 0.35);

    this.root.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) {
        o.castShadow = true;
        o.renderOrder = 10;
      }
    });
  }

  private makeFinger(x: number, z: number, len: number, r: number, curlScale: number): Finger {
    const seg = (l: number) => {
      const g = new THREE.Group();
      const m = new THREE.Mesh(new THREE.CapsuleGeometry(r, l, 4, 8).rotateX(Math.PI / 2).translate(0, 0, -l / 2), this.mat);
      g.add(m);
      return g;
    };
    const base = seg(len * 0.5);
    base.position.set(x, 0.0, z);
    const mid = seg(len * 0.35);
    mid.position.set(0, 0, -len * 0.5);
    const tip = seg(len * 0.28);
    tip.position.set(0, 0, -len * 0.35);
    const nail = new THREE.Mesh(new THREE.SphereGeometry(r * 0.75, 8, 6), this.nailMat);
    nail.scale.set(1, 0.4, 1.2);
    nail.position.set(0, r * 0.7, -len * 0.28);
    tip.add(nail);
    base.add(mid);
    mid.add(tip);
    this.tilt.add(base);
    return { base, mid, tip, curlScale };
  }

  /** A quick sideways swat (slapping the creature). */
  swat() {
    this.swatT = 1;
  }

  /** Flat-palm stroking pose: the primitive hand just lowers its fingers a little. */
  setStroking(on: boolean) {
    this.stroking = on;
  }

  /** 0 = open, 1 = closed fist. */
  setGrip(g: number) {
    this.gripTarget = g;
  }

  setAppearance(alignment: number, blocked: boolean) {
    const c = this.mat.color;
    if (alignment >= 0) c.copy(NEUTRAL_SKIN).lerp(GOOD_SKIN, alignment);
    else c.copy(NEUTRAL_SKIN).lerp(EVIL_SKIN, -alignment);
    const glow = alignment >= 0 ? GOOD_GLOW : EVIL_GLOW;
    this.mat.emissive.copy(glow);
    this.mat.emissiveIntensity = Math.abs(alignment) * 0.25;
    this.nailMat.color.set(alignment < -0.4 ? 0x1a0a08 : 0xf6e6da);
    const opacity = blocked ? 0.45 : 1;
    this.mat.opacity = opacity;
    this.nailMat.opacity = opacity;
    this.mat.depthWrite = !blocked;
  }

  /** Lean with motion so the hand feels weighty. `vel` is in camera-relative screen units. */
  update(dt: number, swayX: number, swayZ: number) {
    this.t += dt;
    this.grip += (this.gripTarget - this.grip) * damp(14, dt);
    this.spread = lerp(0.12, -0.05, this.grip);
    const idle = Math.sin(this.t * 1.7) * 0.05;
    this.fingers.forEach((f, i) => {
      const wobble = Math.sin(this.t * 2.3 + i * 0.9) * 0.05 * (1 - this.grip);
      const curl = lerp(0.18 + idle + wobble, 1.35, this.grip) * f.curlScale;
      f.base.rotation.set(-curl * 0.9, (i - 1.5) * this.spread, 0);
      f.mid.rotation.x = -curl * 1.05;
      f.tip.rotation.x = -curl * 0.8;
    });
    const tc = lerp(0.1, 0.9, this.grip);
    this.thumb.mid.rotation.x = -tc * 0.6;
    this.thumb.tip.rotation.x = -tc * 0.5;
    this.thumb.base.rotation.y = lerp(0.85, 0.35, this.grip);

    // Positive X raises the fingers, turning the back of the hand toward the (elevated) camera.
    // Gripping lowers them again so whatever is held hangs beneath the palm.
    this.tilt.rotation.x = 0.62 - this.grip * 0.4 + swayZ * 0.5 - (this.stroking ? 0.35 : 0);
    this.swatT = Math.max(0, this.swatT - dt * 3.5);
    this.tilt.rotation.z = -swayX * 0.6 - Math.sin(this.swatT * Math.PI) * 1.1;
  }
}
