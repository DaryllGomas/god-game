import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/addons/utils/SkeletonUtils.js';
import { assets } from '../assets';
import type { HandRig } from '../hand/HandRig';
import { SkinnedHand } from '../hand/SkinnedHand';
import { ProceduralHand } from '../hand/ProceduralHand';

/** A hand's whole look: skin, its sheen and inner glow, nails, and the glow sprites (fingertips, wrist mist, halo). */
export interface HandLook {
  skin: THREE.Color;
  sheen: THREE.Color;
  glow: THREE.Color;
  glowI: number;
  nail: THREE.Color;
  nailGlow: THREE.Color;
  nailGlowI: number;
  tip: THREE.Color;
  tipA: number;
  mist: THREE.Color;
  mistA: number;
  halo: THREE.Color;
  haloA: number;
}

/** Vexahl's hand (the same violet as his Grasping Hand in src/rival): midnight skin, violet sheen, lilac nails. Never red. */
export const VIOLET_LOOK: HandLook = {
  skin: new THREE.Color(0x24143f),
  sheen: new THREE.Color(0xa47eff),
  glow: new THREE.Color(0x3a1878),
  glowI: 0.5,
  nail: new THREE.Color(0x6a48b0),
  nailGlow: new THREE.Color(0xb48cff),
  nailGlowI: 1.1,
  tip: new THREE.Color(0xc8a8ff),
  tipA: 0.75,
  mist: new THREE.Color(0x7a46d8),
  mistA: 0.35,
  halo: new THREE.Color(0x6a3ad0),
  haloA: 0.3,
};

/** Atlas's hand of light: warm gold skin glowing from inside, bright fingertips. */
export const GOLD_LOOK: HandLook = {
  skin: new THREE.Color(0xffe8b4),
  sheen: new THREE.Color(0xfff0c8),
  glow: new THREE.Color(0xffb44a),
  glowI: 0.14,
  nail: new THREE.Color(0xfff0c8),
  nailGlow: new THREE.Color(0xffd98a),
  nailGlowI: 1.2,
  tip: new THREE.Color(0xffe2a0),
  tipA: 0.9,
  mist: new THREE.Color(0xffd98a),
  mistA: 0.3,
  halo: new THREE.Color(0xffc860),
  haloA: 0.32,
};

type Lit = THREE.MeshStandardMaterial | THREE.MeshPhysicalMaterial;

/**
 * Recolours a hand model toward a look, on top of whatever its own `setAppearance` set this frame.
 * Works on the player's hand (re-applied every frame after Hand.update) and on our own copies.
 */
export class HandTint {
  private readonly skins: Lit[] = [];
  private readonly nails: Lit[] = [];
  private readonly sprites: { m: THREE.SpriteMaterial; kind: 'tip' | 'mist' | 'halo' }[] = [];
  /** Sheen is set once by the hand itself, never per frame: remember it to blend from. */
  private readonly sheen0 = new Map<THREE.MeshPhysicalMaterial, THREE.Color>();

  constructor(root: THREE.Object3D) {
    const uses = new Map<Lit, number>();
    root.traverse((o) => {
      const sp = o as THREE.Sprite;
      if (sp.isSprite) {
        // The hand rigs tell their glows apart by render order (see SkinnedHand): tips 12, wrist mist 9, halo 8.
        const kind = sp.renderOrder === 12 ? 'tip' : sp.renderOrder === 9 ? 'mist' : 'halo';
        this.sprites.push({ m: sp.material as THREE.SpriteMaterial, kind });
        return;
      }
      const m = o as THREE.Mesh;
      if (!m.isMesh || Array.isArray(m.material)) return;
      const mat = m.material as Lit;
      if (!('emissive' in mat)) return;
      uses.set(mat, (uses.get(mat) ?? 0) + 1);
    });
    // The material on the most meshes is the skin; the rest are nails.
    let skin: Lit | null = null;
    for (const [mat, n] of uses) if (!skin || n > (uses.get(skin) ?? 0)) skin = mat;
    for (const mat of uses.keys()) (mat === skin ? this.skins : this.nails).push(mat);
    for (const s of this.skins) {
      const p = s as THREE.MeshPhysicalMaterial;
      if (p.isMeshPhysicalMaterial) this.sheen0.set(p, p.sheenColor.clone());
    }
  }

  /** Blend toward `look` by `k` (0..1); `opacity` fades the whole hand (1 = solid). */
  apply(look: HandLook, k: number, opacity = 1) {
    for (const s of this.skins) {
      s.color.lerp(look.skin, k);
      s.emissive.lerp(look.glow, k);
      s.emissiveIntensity += (look.glowI - s.emissiveIntensity) * k;
      const p = s as THREE.MeshPhysicalMaterial;
      const base = this.sheen0.get(p);
      if (base) p.sheenColor.copy(base).lerp(look.sheen, k);
      this.fade(s, opacity);
    }
    for (const n of this.nails) {
      n.color.lerp(look.nail, k);
      n.emissive.lerp(look.nailGlow, k);
      n.emissiveIntensity += (look.nailGlowI - n.emissiveIntensity) * k;
      this.fade(n, opacity);
    }
    for (const { m, kind } of this.sprites) {
      const [c, a] = kind === 'tip' ? [look.tip, look.tipA] : kind === 'mist' ? [look.mist, look.mistA] : [look.halo, look.haloA];
      m.color.lerp(c, k);
      m.opacity = (m.opacity + (a - m.opacity) * k) * opacity;
    }
  }

  private fade(m: Lit, opacity: number) {
    if (opacity >= 0.999) return;
    m.transparent = true;
    m.opacity *= opacity;
    m.depthWrite = opacity > 0.6;
  }
}

/** A copy of the player's hand model (the skinned Blender hand, or the primitive fallback) for the endings to pose. */
export function makeHand(): HandRig {
  return assets.hand ? new SkinnedHand(cloneSkinned(assets.hand)) : new ProceduralHand();
}
