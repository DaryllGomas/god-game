import * as THREE from 'three';
import { jitterVerts, paint } from '../art/Models';
import { Rng } from '../util/rng';
import { clamp, damp, lerp, smoothstep } from '../util/math';
import { assets } from '../assets';

/**
 * Tunable proportions. The concept is "cute": a big round head, huge shoulders,
 * long gorilla arms that nearly reach the ground, and short stubby legs.
 */
export const GOLEM = {
  hipHeight: 1.55,
  hipWidth: 0.85,
  shoulderWidth: 2.25,
  shoulderHeight: 2.5,
  headScale: 1.12,
  armScale: 1.0,
  fistScale: 1.0,
};

const NEUTRAL_STONE = new THREE.Color(0xc4b9a4); // warmer than the island's boulders so it never reads as scenery
const GOOD_STONE = new THREE.Color(0xb3b09c);
const EVIL_STONE = new THREE.Color(0x3d3634);
/** Stone tints. The Blender model bakes its colour and shading into vertex colours,
 * so its tints are multipliers around white; the code-built fallback tints plain rock. */
const ASSET_TINTS = { neutral: new THREE.Color(0xffffff), good: new THREE.Color(0xe4e8d8), evil: new THREE.Color(0x5a5350) };
const PROC_TINTS = { neutral: NEUTRAL_STONE, good: GOOD_STONE, evil: EVIL_STONE };
const NEUTRAL_EYE = new THREE.Color(0xfff1c4);
const GOOD_EYE = new THREE.Color(0x5ff2e2);
const EVIL_EYE = new THREE.Color(0xff3510);

/** A spiral glyph, like the swirl runes on the concept sheet. */
class Spiral extends THREE.Curve<THREE.Vector3> {
  constructor() {
    super();
  }

  getPoint(t: number, target = new THREE.Vector3()) {
    const a = t * Math.PI * 4.2;
    const r = 0.05 + t * 0.3;
    return target.set(Math.cos(a) * r, Math.sin(a) * r, 0);
  }
}

type V3 = [number, number, number];

/** Soft round glow for the eyes. */
function glowTexture(): THREE.Texture {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.25, 'rgba(255,255,255,0.55)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The golem as a rigid-part rig: every rock is parented to one pivot ("bone"),
 * exactly how the Blender version will be skinned. No soft deformation anywhere.
 */
export class GolemModel {
  readonly root = new THREE.Group();
  private readonly rng = new Rng(4242);

  // Pivots (the skeleton). Built in code, or taken from the Blender model by name.
  private hips: THREE.Object3D = new THREE.Group();
  private torso: THREE.Object3D = new THREE.Group();
  private head: THREE.Object3D = new THREE.Group();
  private readonly legs: { hip: THREE.Object3D; knee: THREE.Object3D }[] = [];
  private readonly arms: { shoulder: THREE.Object3D; elbow: THREE.Object3D; wrist: THREE.Object3D; side: number }[] = [];
  /** True when using the Blender model (public/models/golem.glb). */
  readonly fromAsset: boolean;
  private tints = PROC_TINTS;
  private readonly eyes: THREE.Mesh[] = [];
  private readonly halos: THREE.Sprite[] = [];
  private readonly socketMat = new THREE.MeshStandardMaterial({ color: 0x2a2724, roughness: 1 });
  private readonly haloMat = new THREE.SpriteMaterial({
    map: glowTexture(),
    color: NEUTRAL_EYE,
    blending: THREE.AdditiveBlending,
    transparent: true,
    depthWrite: false,
    opacity: 0.55,
  });

  // Alignment dressing
  private readonly stone: THREE.MeshStandardMaterial;
  private readonly moss: THREE.MeshStandardMaterial;
  private readonly runeMat: THREE.MeshStandardMaterial;
  private readonly lavaMat: THREE.MeshStandardMaterial;
  private readonly spikeMat: THREE.MeshStandardMaterial;
  private readonly eyeMat: THREE.MeshStandardMaterial;
  private readonly goodBits: THREE.Object3D[] = [];
  private readonly evilBits: THREE.Object3D[] = [];
  /** Lava that switches on when evil (merged per joint, so it fades rather than grows). */
  private readonly evilGlow: THREE.Object3D[] = [];
  private readonly runeGeo = new THREE.TubeGeometry(new Spiral(), 48, 0.05, 4, false);

  // Animation state
  private t = 0;
  private phase = 0;
  private blink = 0;
  private nextBlink = 2;
  private headYaw = 0;
  private headPitch = 0;
  private tilt = 0;

  constructor() {
    this.stone = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, color: NEUTRAL_STONE, roughness: 0.92 });
    this.moss = new THREE.MeshStandardMaterial({ vertexColors: true, flatShading: true, roughness: 1 });
    this.runeMat = new THREE.MeshStandardMaterial({ color: 0x4a4a46, emissive: 0x3fe8d8, emissiveIntensity: 0, roughness: 0.6 });
    this.lavaMat = new THREE.MeshStandardMaterial({ color: 0x2a0a00, emissive: 0xff3d0a, emissiveIntensity: 2.4, roughness: 0.8 });
    this.spikeMat = new THREE.MeshStandardMaterial({ color: 0x1b1817, flatShading: true, roughness: 0.3, metalness: 0.1 });
    this.eyeMat = new THREE.MeshStandardMaterial({ color: 0x1a1a1a, emissive: NEUTRAL_EYE, emissiveIntensity: 2.2, roughness: 0.3 });
    this.fromAsset = !!assets.golem;
    if (assets.golem) this.buildFromAsset(assets.golem);
    else this.build();
    this.root.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.isMesh) {
        m.castShadow = m.material !== this.lavaMat && m.material !== this.runeMat;
        m.receiveShadow = true;
      }
    });
  }

  // ------------------------------------------------------------ Blender model

  /**
   * Use the Blender-built golem. Its pivots (empties) carry the same names and rest
   * positions as the code-built rig, so all the animation below drives it unchanged.
   */
  private buildFromAsset(src: THREE.Object3D) {
    const model = src.clone(true);
    const node = (name: string) => {
      const o = model.getObjectByName(name);
      if (!o) throw new Error(`golem.glb is missing "${name}"`);
      return o;
    };
    this.root.add(model);
    this.hips = node('hips');
    this.torso = node('torso');
    this.head = node('head');
    for (const tag of ['R', 'L']) {
      this.legs.push({ hip: node(`leg_${tag}`), knee: node(`knee_${tag}`) });
      this.arms.push({ shoulder: node(`shoulder_${tag}`), elbow: node(`elbow_${tag}`), wrist: node(`wrist_${tag}`), side: tag === 'R' ? -1 : 1 });
    }

    // Swap the file's materials for ours, which the game recolours by alignment.
    const byName: Record<string, THREE.Material> = {
      Stone: this.stone,
      Moss: this.moss,
      Flower: this.moss,
      Rune: this.runeMat,
      Lava: this.lavaMat,
      Spike: this.spikeMat,
      Eye: this.eyeMat,
      Socket: this.socketMat,
    };
    model.traverse((o) => {
      const m = o as THREE.Mesh;
      if (!m.isMesh) return;
      const mat = byName[(m.material as THREE.Material).name];
      if (mat) m.material = mat;
    });

    for (const tag of ['R', 'L']) {
      const eye = node(`eye_${tag}`) as THREE.Mesh;
      this.eyes.push(eye);
      const halo = new THREE.Sprite(this.haloMat);
      halo.position.copy(eye.position).add(new THREE.Vector3(0, 0, 0.22));
      halo.scale.setScalar(1.5);
      this.head.add(halo);
      this.halos.push(halo);
    }

    // Moss caps and spikes grow in and out; lava switches on and off.
    model.traverse((o) => {
      const tagged = (prefix: string) => o.name.startsWith(prefix) && !o.parent?.name.startsWith(prefix);
      if (tagged('moss_')) this.goodBits.push(o);
      else if (tagged('spike_')) this.evilBits.push(o);
      else if (tagged('lava_')) this.evilGlow.push(o);
    });
    this.tints = ASSET_TINTS;
  }

  // ------------------------------------------------------------------ build

  private rock(parent: THREE.Object3D, size: V3, pos: V3, rot: V3 = [0, 0, 0], round = false): THREE.Mesh {
    const base = round ? new THREE.IcosahedronGeometry(1, 1) : new THREE.DodecahedronGeometry(1, 0);
    const g = jitterVerts(base, round ? 0.07 : 0.12, this.rng);
    const geo = paint(g, 0xffffff, 0.14, this.rng);
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.stone);
    m.scale.set(...size);
    m.position.set(...pos);
    m.rotation.set(...rot);
    parent.add(m);
    return m;
  }

  /** Moss that drapes over the top of a rock, with a few flowers growing in it. */
  private mossCap(rock: THREE.Mesh, coverage: number, flowers = 0) {
    const g = new THREE.Group();
    g.position.copy(rock.position);
    g.rotation.copy(rock.rotation);
    const cap = jitterVerts(new THREE.SphereGeometry(1, 12, 6, 0, Math.PI * 2, 0, Math.PI * coverage), 0.07, this.rng);
    const mesh = new THREE.Mesh(paint(cap, 0x5f9a35, 0.3, this.rng), this.moss);
    mesh.scale.copy(rock.scale).multiplyScalar(1.12);
    g.add(mesh);
    const petals = [0xffb3c8, 0xfff4f0, 0xffd84a, 0xc9a8ff];
    for (let i = 0; i < flowers; i++) {
      const th = this.rng.range(0, Math.PI * coverage * 0.8);
      const ph = this.rng.range(0, Math.PI * 2);
      const f = new THREE.Mesh(paint(new THREE.IcosahedronGeometry(0.12, 0), this.rng.pick(petals)), this.moss);
      f.position.set(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)).multiply(rock.scale).multiplyScalar(1.17);
      f.scale.set(1.3, 0.7, 1.3);
      g.add(f);
    }
    rock.parent!.add(g);
    this.goodBits.push(g);
  }

  /** Glowing lava seams that wander down across a rock's front and sides. */
  private veins(rock: THREE.Mesh, count: number) {
    for (let c = 0; c < count; c++) {
      let th = this.rng.range(0.45, 1.6);
      let ph = this.rng.range(-1.4, 1.4);
      const pts: V3[] = [];
      for (let i = 0; i < 6; i++) {
        const d = new THREE.Vector3(Math.sin(th) * Math.sin(ph), Math.cos(th), Math.sin(th) * Math.cos(ph)).multiply(rock.scale).multiplyScalar(1.04);
        pts.push([rock.position.x + d.x, rock.position.y + d.y, rock.position.z + d.z]);
        th += this.rng.range(0.14, 0.28);
        ph += this.rng.range(-0.4, 0.4);
      }
      this.crack(rock.parent!, pts);
    }
  }

  /** `facing` is the direction the rune's face points in its parent space. */
  private rune(parent: THREE.Object3D, pos: V3, facing: 'front' | 'left' | 'right', scale = 1) {
    const m = new THREE.Mesh(this.runeGeo, this.runeMat);
    m.position.set(...pos);
    m.rotation.y = facing === 'front' ? 0 : facing === 'left' ? -Math.PI / 2 : Math.PI / 2;
    m.scale.setScalar(scale);
    parent.add(m);
  }

  private lavaCore(parent: THREE.Object3D, r: number, pos: V3) {
    const m = new THREE.Mesh(new THREE.IcosahedronGeometry(r, 1), this.lavaMat);
    m.position.set(...pos);
    parent.add(m);
    this.evilBits.push(m);
  }

  private crack(parent: THREE.Object3D, points: V3[]) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), false, 'catmullrom', 0.1);
    const m = new THREE.Mesh(new THREE.TubeGeometry(curve, 24, 0.028, 4, false), this.lavaMat);
    parent.add(m);
    this.evilBits.push(m);
  }

  private spike(parent: THREE.Object3D, pos: V3, rot: V3, len = 0.9) {
    const geo = new THREE.ConeGeometry(0.22 * (len / 0.9), len, 5).translate(0, len / 2, 0);
    const m = new THREE.Mesh(geo, this.spikeMat);
    m.position.set(...pos);
    m.rotation.set(...rot);
    parent.add(m);
    this.evilBits.push(m);
  }

  private build() {
    const P = GOLEM;
    this.root.add(this.hips);
    this.hips.position.y = P.hipHeight;

    // Pelvis
    this.rock(this.hips, [0.95, 0.55, 0.75], [0, 0.2, 0]);
    this.lavaCore(this.hips, 0.62, [0, 0.05, 0]);

    // Legs: short and stubby.
    for (const side of [-1, 1]) {
      const hip = new THREE.Group();
      hip.position.set(side * P.hipWidth, 0, 0);
      this.hips.add(hip);
      const thigh = this.rock(hip, [0.72, 0.55, 0.72], [0, -0.4, 0]);
      this.mossCap(thigh, 0.28);
      const knee = new THREE.Group();
      knee.position.set(0, -0.8, 0);
      hip.add(knee);
      const foot = this.rock(knee, [0.82, 0.42, 0.98], [0, -0.33, 0.16]);
      this.veins(foot, 1);
      this.lavaCore(knee, 0.36, [0, 0.05, 0]);
      this.legs.push({ hip, knee });
    }

    // Torso
    this.torso.position.y = 0.55;
    this.hips.add(this.torso);
    const belly = this.rock(this.torso, [1.2, 0.8, 0.95], [0, 0.45, 0.15]);
    const chest = this.rock(this.torso, [1.75, 1.3, 1.22], [0, 1.72, 0]);
    const back = this.rock(this.torso, [1.25, 0.95, 0.75], [0, 1.9, -0.8]);
    this.rune(this.torso, [0, 1.62, 1.3], 'front', 1.25);
    this.mossCap(chest, 0.26, 3);
    this.mossCap(back, 0.34, 3);
    this.veins(belly, 1);
    this.veins(chest, 2);
    this.veins(back, 1);
    this.lavaCore(this.torso, 0.95, [0, 1.5, 0]);
    // Back spikes along the spine
    this.spike(this.torso, [0, 2.4, -1.15], [-1.0, 0, 0], 1.1);
    this.spike(this.torso, [0, 1.7, -1.3], [-1.3, 0, 0], 1.0);
    this.spike(this.torso, [0, 1.0, -1.1], [-1.5, 0, 0], 0.8);

    // Head: big, round, set low and forward between the shoulders.
    this.head.position.set(0, 2.5, 0.5);
    this.head.scale.setScalar(P.headScale);
    this.torso.add(this.head);
    const skull = this.rock(this.head, [1.3, 1.12, 1.15], [0, 0.75, 0.12], [0, 0, 0], true);
    this.lavaCore(this.torso, 0.55, [0, 2.75, 0.3]);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.34, 16, 12), this.eyeMat);
      eye.position.set(side * 0.5, 0.8, 1.13);
      eye.scale.set(1, 1.1, 0.5);
      this.head.add(eye);
      this.eyes.push(eye);
      const socket = new THREE.Mesh(new THREE.SphereGeometry(0.44, 12, 8), this.socketMat);
      socket.position.set(side * 0.5, 0.8, 1.02);
      socket.scale.set(1, 1.1, 0.35);
      this.head.add(socket);
      const halo = new THREE.Sprite(this.haloMat);
      halo.position.set(side * 0.5, 0.8, 1.35);
      halo.scale.setScalar(1.5);
      this.head.add(halo);
      this.halos.push(halo);
    }
    this.mossCap(skull, 0.3, 7);
    this.crack(this.head, [[0.25, 1.8, 0.8], [0.1, 1.5, 1.1], [0.2, 1.25, 1.2]]);
    this.crack(this.head, [[-0.9, 1.3, 0.6], [-1.05, 0.9, 0.7], [-1.0, 0.5, 0.75]]);
    this.spike(this.head, [-0.6, 1.6, 0.1], [0.2, 0, 0.6], 0.6);
    this.spike(this.head, [0.6, 1.6, 0.1], [0.2, 0, -0.6], 0.6);
    this.spike(this.head, [0, 1.85, -0.25], [-0.5, 0, 0], 0.55);

    // Arms: long, gorilla-like, ending in boulder fists.
    for (const side of [-1, 1]) {
      const shoulder = new THREE.Group();
      shoulder.position.set(side * P.shoulderWidth, P.shoulderHeight, 0);
      this.torso.add(shoulder);
      const pauldron = this.rock(shoulder, [1.1, 1.0, 1.02], [side * 0.12, 0.05, 0]);
      this.lavaCore(shoulder, 0.55, [0, -0.35, 0]);
      this.rune(shoulder, [side * 1.28, 0, 0], side < 0 ? 'left' : 'right', 0.9);
      this.mossCap(pauldron, 0.34, 4);
      this.veins(pauldron, 1);
      for (let i = 0; i < 3; i++) {
        this.spike(shoulder, [side * (0.25 + i * 0.3), 0.8, -0.2 + i * 0.15], [-0.2, 0, -side * (0.35 + i * 0.25)], 0.85 - i * 0.12);
      }

      const upper = new THREE.Group();
      upper.position.set(side * 0.15, -0.5, 0);
      upper.scale.setScalar(P.armScale);
      shoulder.add(upper);
      this.veins(this.rock(upper, [0.66, 0.88, 0.66], [0, -0.8, 0]), 1);
      const elbow = new THREE.Group();
      elbow.position.set(0, -1.6, 0);
      upper.add(elbow);
      this.lavaCore(elbow, 0.42, [0, 0, 0]);
      const forearm = this.rock(elbow, [0.86, 0.9, 0.86], [0, -0.78, 0.05]);
      this.mossCap(forearm, 0.26, 2);
      this.veins(forearm, 1);
      this.spike(elbow, [side * 0.78, -0.6, 0], [0, 0, -side * 1.3], 0.65);

      const wrist = new THREE.Group();
      wrist.position.set(0, -1.5, 0);
      wrist.scale.setScalar(P.fistScale);
      elbow.add(wrist);
      this.lavaCore(wrist, 0.42, [0, 0, 0]);
      // Big boulder fists: the gorilla silhouette depends on these.
      const fist = this.rock(wrist, [1.15, 1.0, 1.15], [0, -0.65, 0.12]);
      for (let k = 0; k < 3; k++) this.rock(wrist, [0.36, 0.34, 0.38], [(k - 1) * 0.5, -1.3, 0.78]);
      this.rune(wrist, [0, -0.6, 1.3], 'front', 0.85);
      this.mossCap(fist, 0.28, 2);
      this.veins(fist, 1);

      this.arms.push({ shoulder, elbow, wrist, side });
    }
  }

  // -------------------------------------------------------------- alignment

  /** -1 evil .. 0 neutral .. +1 good. Blends continuously. */
  setAlignment(a: number) {
    const good = smoothstep(0.1, 0.75, a);
    const evil = smoothstep(-0.1, -0.75, a);
    this.stone.color.copy(this.tints.neutral).lerp(this.tints.good, good).lerp(this.tints.evil, evil);
    for (const b of this.evilGlow) b.visible = evil > 0.05;
    // Obsidian is glassy: low roughness so it catches bright highlights.
    this.stone.roughness = lerp(0.92, this.fromAsset ? 0.45 : 0.26, evil);
    this.stone.metalness = lerp(0, 0.2, evil);

    for (const b of this.goodBits) {
      b.visible = good > 0.02;
      b.scale.setScalar(Math.max(0.001, good));
    }
    for (const b of this.evilBits) {
      b.visible = evil > 0.02;
      if (b.userData.baseScale === undefined) b.userData.baseScale = b.scale.x;
      b.scale.setScalar(Math.max(0.001, evil * (b.userData.baseScale as number)));
    }
    // Runes: faintly carved when neutral, glowing teal when good, gone dark when evil.
    this.runeMat.emissiveIntensity = good * 2.4;
    this.runeMat.color.set(0x8a857c).lerp(new THREE.Color(0x1d4a47), good).lerp(new THREE.Color(0x151212), evil);
    this.socketMat.color.set(0x5e5952).lerp(new THREE.Color(0x3c4a40), good).lerp(new THREE.Color(0x0e0b0a), evil);
    this.lavaMat.emissiveIntensity = 0.8 + evil * 1.6;

    const eye = this.eyeMat.emissive;
    eye.copy(NEUTRAL_EYE).lerp(GOOD_EYE, good).lerp(EVIL_EYE, evil);
    this.eyeMat.emissiveIntensity = 2 + evil * 1.2;
    this.haloMat.color.copy(eye);
    this.haloMat.opacity = 0.45 + 0.35 * Math.max(good, evil);
  }

  // -------------------------------------------------------------- animation

  /**
   * Layered procedural animation. Every field is a 0..1 weight except the look angles,
   * so behaviour code can blend poses freely (walk + reach, sit + chew, ...).
   * The "main" arm (the one that grabs, eats and throws) is the golem's right arm.
   */
  update(dt: number, pose: GolemPose) {
    this.t += dt;
    const t = this.t;
    const { moving, cheer, sit, reach, eat, windup, fling, flinch, happy, chew } = pose;
    this.phase += dt * (0.4 + moving * 3.2);
    const ph = this.phase;
    const P = GOLEM;
    const standing = 1 - sit;

    // Body: breathing when idle, heavy side-to-side lumber when walking, slumped when sitting.
    const bob = Math.abs(Math.cos(ph)) * 0.16 * moving;
    this.hips.position.y = lerp(P.hipHeight, P.hipHeight * 0.42, sit) - 0.08 * moving + bob + Math.sin(cheer * Math.PI) * 1.4;
    this.hips.position.z = -flinch * 0.5;
    this.hips.rotation.z = Math.sin(t * 0.7) * 0.025 * (1 - moving) + Math.sin(ph) * 0.05 * moving + Math.sin(t * 3) * 0.05 * happy;
    this.torso.rotation.x =
      0.1 * moving + Math.sin(t * 1.6) * 0.012 * (1 - moving) - cheer * 0.15 + sit * 0.38 - flinch * 0.4 + reach * 0.25 - fling * 0.2 + windup * 0.1;
    this.torso.rotation.z = Math.sin(ph) * 0.08 * moving;
    this.torso.rotation.y = Math.sin(ph) * 0.1 * moving + windup * 0.35 - fling * 0.45;
    this.torso.scale.y = 1 + Math.sin(t * (sit > 0.5 ? 0.9 : 1.7)) * (sit > 0.5 ? 0.025 : 0.012);

    this.legs.forEach(({ hip, knee }, i) => {
      const s = i === 0 ? 1 : -1;
      // Sitting: legs stick out in front like a toddler's.
      hip.rotation.x = Math.sin(ph) * 0.55 * moving * s * standing - sit * 1.35;
      knee.rotation.x = Math.max(0, Math.sin(ph + (s > 0 ? -1.2 : 1.94))) * 0.7 * moving * standing + sit * 0.25;
      hip.rotation.z = s * (0.04 * (1 - moving) + sit * 0.25);
    });

    for (let a = 0; a < this.arms.length; a++) {
      const { shoulder, elbow, wrist, side } = this.arms[a];
      const main = a === 0;
      const s = side < 0 ? 1 : -1;
      const swing = -Math.sin(ph) * 0.42 * moving * s;
      const idle = Math.sin(t * 1.1 + side) * 0.04 * (1 - moving);
      // Z tilts the arm outward (side * positive = away from the body).
      let sx = swing + idle - 0.12 - cheer * 2.3;
      let sz = side * (0.08 + cheer * 0.85);
      let ex = -0.25 - Math.max(0, -swing) * 0.5 - cheer * 0.35;
      // Sitting: forearms rest on the ground beside the legs.
      sx = lerp(sx, -0.25, sit);
      ex = lerp(ex, -0.55, sit);
      sz = lerp(sz, side * 0.35, sit);
      // Flinch: both fists come up to shield the face.
      sx = lerp(sx, -1.5, flinch);
      ex = lerp(ex, -1.6, flinch);
      sz = lerp(sz, -side * 0.25, flinch);
      if (main) {
        sx = lerp(sx, -1.25, reach);
        ex = lerp(ex, -0.2, reach);
        // Eat: fist brought up and in to the mouth.
        sx = lerp(sx, -2.05, eat);
        ex = lerp(ex, -1.75, eat);
        sz = lerp(sz, -side * 0.45, eat);
        sx = lerp(sx, 1.0, windup);
        ex = lerp(ex, -0.5, windup);
        sx = lerp(sx, -1.9, fling);
        ex = lerp(ex, -0.1, fling);
      }
      shoulder.rotation.x = sx;
      shoulder.rotation.z = sz;
      elbow.rotation.x = ex;
      wrist.rotation.x = 0.1 + Math.sin(t * 0.9 + side) * 0.03;
    }

    // Head: look at things, counter the torso sway, tilt when curious; droop when asleep.
    const yaw = clamp(pose.lookYaw, -1.1, 1.1) * standing;
    const pitch = lerp(clamp(pose.lookPitch, -0.5, 0.35), -0.45, sit) + eat * 0.25 - flinch * 0.1;
    this.headYaw += (yaw - this.headYaw) * damp(4, dt);
    this.headPitch += (pitch - this.headPitch) * damp(4, dt);
    this.tilt += ((pose.interest + happy) * 0.22 - this.tilt) * damp(3, dt);
    const chewBob = Math.sin(t * 13) * 0.07 * chew;
    this.head.rotation.set(
      -this.headPitch - this.torso.rotation.x * 0.5 + chewBob,
      this.headYaw - this.torso.rotation.y,
      this.tilt - this.torso.rotation.z,
    );

    // Eyes: blink, squint when content or hurt, closed when asleep.
    this.nextBlink -= dt;
    if (this.nextBlink <= 0) {
      this.blink = 0.16;
      this.nextBlink = 2.5 + Math.random() * 4;
    }
    this.blink = Math.max(0, this.blink - dt);
    const asleep = sit > 0.8;
    let lid = this.blink > 0 || asleep ? 0.12 : 1.1;
    lid = Math.min(lid, lerp(1.1, 0.45, Math.max(happy, flinch)));
    for (const e of this.eyes) e.scale.y += (lid - e.scale.y) * damp(30, dt);
    for (const h of this.halos) h.visible = this.blink <= 0 && !asleep;
  }

  /** Walk-cycle phase; a foot lands every PI. */
  get stepPhase(): number {
    return this.phase;
  }

  /** World-space position of the point between the eyes. */
  eyePoint(out: THREE.Vector3): THREE.Vector3 {
    return this.head.localToWorld(out.set(0, 0.86, 1.1));
  }

  /** World-space centre of the main (grabbing) fist, where held things sit. */
  handPoint(out: THREE.Vector3): THREE.Vector3 {
    return this.arms[0].wrist.localToWorld(out.set(0, -0.9, 0.6));
  }
}

export interface GolemPose {
  moving: number;
  lookYaw: number;
  lookPitch: number;
  interest: number;
  cheer: number;
  sit: number;
  reach: number;
  eat: number;
  windup: number;
  fling: number;
  flinch: number;
  happy: number;
  chew: number;
}

export const REST_POSE: GolemPose = {
  moving: 0,
  lookYaw: 0,
  lookPitch: 0,
  interest: 0,
  cheer: 0,
  sit: 0,
  reach: 0,
  eat: 0,
  windup: 0,
  fling: 0,
  flinch: 0,
  happy: 0,
  chew: 0,
};
