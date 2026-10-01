import * as THREE from 'three';
import { clamp, damp, lerp, smoothstep } from '../util/math';
import type { HandRig } from './HandRig';

// ---- tuning knobs ---------------------------------------------------------------------------
/** Scales the Blender model (palm ~0.9 wide) to the footprint the old primitive hand had. */
const MODEL_SCALE = 1.0;
/** Resting tilt: positive raises the fingers, turning the back of the hand toward the elevated camera. */
const TILT_OPEN = 0.62;
const TILT_GRIP_DROP = 0.8;
const TILT_STROKE_DROP = 0.38;
/** Joint angles (radians) at grip = 1 for each finger joint (knuckle, middle, tip). */
const CURL = [1.35, 1.8, 1.2];
/** Thumb: [opposition about the palm's up axis, base curl, mid curl, tip curl] at grip = 1. */
/** <1 curls more eagerly, >1 keeps the hover pose open and reaching (readable from above). */
const CURL_EASE = 1.35;
const THUMB_CURL = [0.75, 0.3, 0.55, 0.7];

const NEUTRAL = new THREE.Color(0xffffff);
const GOOD_TINT = new THREE.Color(0xfff0d8);
const EVIL_TINT = new THREE.Color(0x70625e);
const GOOD_GLOW = new THREE.Color(0xffd98a);
const EVIL_GLOW = new THREE.Color(0xff2a10);
const MIST = new THREE.Color(0xffe9c4);
const EVIL_MIST = new THREE.Color(0xc8553c);
const NAIL = new THREE.Color(0xf2c9c0);
const CLAW = new THREE.Color(0x1d0d0b);

const FINGERS = ['index', 'middle', 'ring', 'pinky'] as const;
const TIP_LENGTH: Record<string, number> = { index: 0.22, middle: 0.23, ring: 0.22, pinky: 0.17, thumb: 0.26 };

const Y = new THREE.Vector3(0, 1, 0);

interface BoneInfo {
  bone: THREE.Bone;
  rest: THREE.Quaternion;
  /** Curl axis (hand space: perpendicular to the bone, horizontal) expressed in the parent's rest frame. */
  curlAxis: THREE.Vector3;
  /** The hand's up axis expressed in the parent's rest frame. */
  upAxis: THREE.Vector3;
}

function glowTexture(): THREE.Texture {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.35, 'rgba(255,255,255,0.35)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The Blender-built, skinned god-hand (public/models/hand.glb). Palm down, fingers along -Z,
 * thumb toward -X. Finger bones are driven procedurally: joint rotations are expressed in hand
 * space and converted into each bone's own rest frame, so it doesn't matter how Blender oriented
 * the bones on export.
 */
export class SkinnedHand implements HandRig {
  readonly root = new THREE.Group();
  private readonly tilt = new THREE.Group();
  private readonly bones = new Map<string, BoneInfo>();
  private readonly meshes: THREE.SkinnedMesh[] = [];
  private readonly skinMat: THREE.MeshPhysicalMaterial;
  private readonly nailMat: THREE.MeshStandardMaterial;
  private readonly tipGlows: THREE.Sprite[] = [];
  private readonly mists: { s: THREE.Sprite; seed: number; y: number }[] = [];
  private readonly halo: THREE.Sprite;
  /** Glow sprites: keep them out of the AO depth pre-pass (they'd show up as dark squares). */
  readonly aoIgnore: THREE.Object3D[] = [];
  private grip = 0;
  private gripTarget = 0;
  private stroke = 0;
  private strokeTarget = 0;
  private swatT = 0;
  private t = 0;
  private readonly q = new THREE.Quaternion();
  private readonly q2 = new THREE.Quaternion();

  constructor(scene: THREE.Object3D) {
    this.skinMat = new THREE.MeshPhysicalMaterial({
      vertexColors: true,
      roughness: 0.52,
      metalness: 0,
      sheen: 0.6,
      sheenRoughness: 0.5,
      sheenColor: new THREE.Color(0xffc7a8),
      transparent: true,
    });
    this.nailMat = new THREE.MeshStandardMaterial({ color: NAIL, roughness: 0.3, transparent: true, side: THREE.DoubleSide });

    scene.scale.setScalar(MODEL_SCALE);
    this.tilt.add(scene);
    this.root.add(this.tilt);
    this.root.updateMatrixWorld(true);

    scene.traverse((o) => {
      const b = o as THREE.Bone;
      if (b.isBone) this.registerBone(b);
      const m = o as THREE.SkinnedMesh;
      if (m.isSkinnedMesh) {
        const isNail = (m.material as THREE.Material).name === 'Nail';
        m.material = isNail ? this.nailMat : this.skinMat;
        m.frustumCulled = false;
        m.castShadow = true;
        m.renderOrder = 10;
        this.meshes.push(m);
      }
    });

    const tex = glowTexture();
    const sprite = (opacity: number, order: number) => {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, opacity, fog: false }));
      s.renderOrder = order;
      return s;
    };
    for (const name of [...FINGERS, 'thumb']) {
      const info = this.bones.get(`${name}3`);
      if (!info) continue;
      const s = sprite(0, 12);
      s.position.set(0, TIP_LENGTH[name] * 0.95, 0);
      s.scale.setScalar(0.34);
      info.bone.add(s);
      this.tipGlows.push(s);
    }
    const wrist = this.bones.get('wrist');
    if (wrist) {
      for (let i = 0; i < 5; i++) {
        const s = sprite(0, 9);
        s.scale.setScalar(0.4 + i * 0.07);
        wrist.bone.add(s);
        this.mists.push({ s, seed: i * 1.7, y: 0.1 + i * 0.1 });
      }
    }
    this.halo = sprite(0, 8);
    this.halo.scale.setScalar(3.4);
    const palm = this.bones.get('palm');
    (palm ? palm.bone : this.tilt).add(this.halo);
    this.halo.position.set(0, 0.35, 0);
    this.aoIgnore.push(...this.tipGlows, ...this.mists.map((w) => w.s), this.halo);
    this.setAppearance(0, false);
  }

  private registerBone(bone: THREE.Bone) {
    const parentQ = new THREE.Quaternion();
    if (bone.parent) bone.parent.getWorldQuaternion(parentQ);
    const worldQ = new THREE.Quaternion();
    bone.getWorldQuaternion(worldQ);
    const dir = new THREE.Vector3(0, 1, 0).applyQuaternion(worldQ).normalize(); // bones run along local +Y
    const axis = dir.clone().cross(Y).normalize();
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    const inv = parentQ.clone().invert();
    this.bones.set(bone.name, {
      bone,
      rest: bone.quaternion.clone(),
      curlAxis: axis.applyQuaternion(inv),
      upAxis: Y.clone().applyQuaternion(inv),
    });
  }

  /** Pose a bone: `curl` bends it toward the palm, `spread` swings it about the hand's up axis. */
  private pose(name: string, curl: number, spread = 0) {
    const info = this.bones.get(name);
    if (!info) return;
    this.q.setFromAxisAngle(info.curlAxis, -curl);
    this.q2.setFromAxisAngle(info.upAxis, spread);
    info.bone.quaternion.copy(this.q2).multiply(this.q).multiply(info.rest);
  }

  swat() {
    this.swatT = 1;
  }

  /** 0 = open, 1 = closed fist. */
  setGrip(g: number) {
    this.gripTarget = g;
  }

  setStroking(on: boolean) {
    this.strokeTarget = on ? 1 : 0;
  }

  setAppearance(alignment: number, blocked: boolean) {
    const good = Math.max(0, alignment);
    const evil = Math.max(0, -alignment);
    const m = this.skinMat;
    m.color.copy(NEUTRAL).lerp(GOOD_TINT, good).lerp(EVIL_TINT, evil);
    m.emissive.copy(alignment >= 0 ? GOOD_GLOW : EVIL_GLOW);
    m.emissiveIntensity = good * 0.22 + evil * 0.05;
    this.nailMat.color.copy(NAIL).lerp(CLAW, smoothstep(0.1, 0.6, evil));
    this.nailMat.emissive.copy(GOOD_GLOW);
    this.nailMat.emissiveIntensity = good * 0.7;
    const evilMorph = smoothstep(0.05, 0.75, evil);
    const opacity = blocked ? 0.45 : 1;
    m.opacity = opacity;
    this.nailMat.opacity = opacity;
    m.depthWrite = !blocked;
    this.nailMat.depthWrite = !blocked;
    for (const mesh of this.meshes) {
      const i = mesh.morphTargetDictionary?.evil;
      if (i !== undefined && mesh.morphTargetInfluences) mesh.morphTargetInfluences[i] = evilMorph;
    }
    const k = blocked ? 0.35 : 1;
    const glowCol = alignment >= 0 ? GOOD_GLOW : EVIL_GLOW;
    for (const s of this.tipGlows) {
      const mat = s.material as THREE.SpriteMaterial;
      mat.color.copy(glowCol);
      mat.opacity = good * 0.85 * k;
    }
    const halo = this.halo.material as THREE.SpriteMaterial;
    halo.color.copy(glowCol);
    halo.opacity = (good * 0.22 + evil * 0.2) * k;
    const mist = alignment >= 0 ? MIST.clone().lerp(GOOD_GLOW, good * 0.6) : EVIL_MIST;
    for (const w of this.mists) {
      const mat = w.s.material as THREE.SpriteMaterial;
      mat.color.copy(mist);
      mat.opacity = (0.1 + good * 0.1) * k;
    }
  }

  /** Lean with motion so the hand feels weighty. `swayX/Z` are in camera-relative screen units. */
  update(dt: number, swayX: number, swayZ: number) {
    this.t += dt;
    const t = this.t;
    this.swatT = Math.max(0, this.swatT - dt * 3.5);
    const swat = Math.sin(this.swatT * Math.PI);
    this.grip += (this.gripTarget - this.grip) * damp(14, dt);
    this.stroke += (this.strokeTarget - this.stroke) * damp(9, dt);
    // A slap flings the fingers wide; stroking lays them flat and together.
    const g = clamp(this.grip * (1 - swat) * (1 - this.stroke * 0.9), 0, 1);
    const open = 1 - g;

    FINGERS.forEach((name, i) => {
      const wob = Math.sin(t * 2.1 + i * 0.9) * 0.05 * open + Math.sin(t * 1.3) * 0.03 * open;
      const c = Math.pow(g, CURL_EASE) * (1 + (i - 1.5) * 0.07);
      const spread = (-(i - 1.5) * lerp(0.05, -0.05, g) - swat * (i - 1.5) * -0.1) * (1 - this.stroke * 0.8);
      const lay = -this.stroke * 0.12; // slightly hyper-extended when stroking
      this.pose(`${name}1`, CURL[0] * c + wob + lay + swat * -0.15, spread);
      this.pose(`${name}2`, CURL[1] * c + wob * 0.8 + lay * 0.5);
      this.pose(`${name}3`, CURL[2] * c + wob * 0.6 + lay * 0.5);
    });
    const tw = Math.sin(t * 1.7) * 0.04 * open;
    this.pose('thumb1', THUMB_CURL[1] * g + tw, -THUMB_CURL[0] * g * (1 - this.stroke * 0.4) + swat * 0.3);
    this.pose('thumb2', THUMB_CURL[2] * g + tw);
    this.pose('thumb3', THUMB_CURL[3] * g + tw);

    // Palm: positive X tilt raises the fingers toward the camera; gripping lowers them so whatever
    // is held hangs beneath the palm. Stroking lays the hand flatter and rubs it gently.
    this.tilt.rotation.x = TILT_OPEN - this.grip * TILT_GRIP_DROP + swayZ * 0.5 - this.stroke * TILT_STROKE_DROP;
    this.tilt.rotation.z = -swayX * 0.6 - swat * 1.1 + this.stroke * Math.sin(t * 6.5) * 0.06;

    // Forearm mist drifts slowly.
    for (const w of this.mists) {
      w.s.position.set(Math.sin(t * 0.7 + w.seed) * 0.16, w.y + Math.sin(t * 0.5 + w.seed * 2) * 0.08, Math.cos(t * 0.6 + w.seed) * 0.12);
    }
  }
}
