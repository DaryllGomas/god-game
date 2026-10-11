import * as THREE from 'three';
import type { HandRig } from '../hand/HandRig';
import type { Villager } from '../entities/Villager';
import { ISLE_POS, glowTexture } from '../rival/RivalVisuals';
import { along, ease, easeOut, span, type Shot } from './Cine';
import { GOLD_LOOK, HandTint, VIOLET_LOOK, makeHand, type HandLook } from './HandTint';
import { aoSkip, type CityLights } from './CityLights';
import type { Stage } from './Collapse';
import { clamp, lerp, smoothstep } from '../util/math';

// ------------------------------------------------------------------ tuning knobs

/** The beats, in real seconds from the start of Whole. Ready to See begins at READY. */
const W = {
  toBlack: 0.9,
  fromBlack: [1.2, 3.4] as const,
  handsIn: [2.6, 6.8] as const,
  approach: [6.8, 9.8] as const,
  touch: 9.8,
  sound: 6.4,
  dissolveHands: [10.2, 12.4] as const,
  dissolveSpire: [11.2, 15] as const,
  ora: 12.6,
  oraHold: 3,
  descend: [13.6, 17] as const,
};
export const READY = 17;
const R = {
  cityIn: [0, 3.2] as const,
  lookUp: 1.4,
  black: [18.6, 21.6] as const,
  card: 21.6,
};
/** Time of day (0..1, 0.75 = sunset): golden hour for Whole, dusk into a starry night for Ready to See. */
const DAY = { whole: [0.735, 0.749] as const, ready: [0.749, 0.777] as const };
/** Distance in front of the camera where the two hands meet, and how near his spire comes (calm, not a threat). */
const DEPTH = 75;
/** Size of each hand, as a share of the half-height of the view at DEPTH. */
const HAND_SCALE = 0.42;
const SPIRE_NEAR = 0.95;
/** Ora's one line in Whole. */
export const WHOLE_LINE = 'There you are.';

const DIR = new THREE.Vector2(ISLE_POS.x, ISLE_POS.z).normalize();
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const fwd = new THREE.Vector3();
const tmp = new THREE.Vector3();
const basis = new THREE.Matrix4();
const rot = new THREE.Matrix4();

/** A soft star of light: a bright core with long thin rays (for the meeting of the hands). */
function raysTexture(): THREE.CanvasTexture {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  const core = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  core.addColorStop(0, 'rgba(255,255,255,1)');
  core.addColorStop(0.08, 'rgba(255,240,205,0.8)');
  core.addColorStop(0.3, 'rgba(255,200,120,0.12)');
  core.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = core;
  g.fillRect(0, 0, S, S);
  g.translate(S / 2, S / 2);
  const ray = (angle: number, len: number, width: number, alpha: number) => {
    g.save();
    g.rotate(angle);
    const grad = g.createLinearGradient(0, 0, len, 0);
    grad.addColorStop(0, `rgba(255,246,220,${alpha})`);
    grad.addColorStop(1, 'rgba(255,220,160,0)');
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(0, -width);
    g.lineTo(len, 0);
    g.lineTo(0, width);
    g.closePath();
    g.fill();
    g.restore();
  };
  for (let i = 0; i < 4; i++) ray((i * Math.PI) / 2, S * 0.49, 7, 0.9);
  for (let i = 0; i < 4; i++) ray(Math.PI / 4 + (i * Math.PI) / 2, S * 0.3, 4, 0.55);
  for (let i = 0; i < 16; i++) ray((i * Math.PI) / 8 + 0.2, S * (0.14 + 0.08 * ((i * 7) % 3)), 2, 0.35);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Hand {
  specks: number;
  aura: THREE.Sprite;
  rig: HandRig;
  holder: THREE.Group;
  tint: HandTint;
  look: HandLook;
  mirror: boolean;
}

/**
 * The good ending, as one continuous sequence. Whole: his spire comes close one last time, calm; your gold
 * hand and his violet hand rise over the island and meet, and become one warm light; the spire dissolves
 * into light (no fight: a reconciliation). Ready to See: the light comes down into the home temple and the
 * villages become a city of light; the people look up and understand. The camera rises, fade to black, and
 * `onCard` shows the end card. `onReady` fires as Ready to See begins (the legacy is written there).
 */
export class Ascension {
  t: number;
  private readonly keys: Shot[];
  private readonly hands: Hand[] = [];
  private readonly light = new THREE.Group();
  private readonly core: THREE.Sprite;
  private readonly rays: THREE.Sprite;
  private readonly rings: THREE.Mesh[] = [];
  private readonly meet = new THREE.Vector3();
  private readonly landing: THREE.Vector3;
  private readonly isleMats: { m: THREE.Material; opacity: number }[] = [];
  private readonly looking = new Set<Villager>();
  private cut = false;
  private sounded = false;
  private spoke = false;
  private readied = false;
  private carded = false;
  private readonly fromReady: boolean;
  private moteAcc = 0;
  private burst = false;
  private readonly look2: HandLook = { ...GOLD_LOOK };

  constructor(
    private readonly s: Stage,
    private readonly city: () => CityLights,
    private readonly onReady: () => void,
    private readonly onCard: () => void,
    /** Start at Ready to See (debug, or a reload in the middle of it). */
    fromReady = false,
  ) {
    const g = s.game;
    this.fromReady = fromReady;
    this.t = fromReady ? READY : 0;
    const gy = (x: number, z: number) => g.terrain.surfaceAt(x, z);
    const home = g.villages.find((v) => v.isHome) ?? g.villages[0];
    const temple = home.worship.pos;
    this.landing = v3(temple.x, gy(temple.x, temple.z) + Math.max(10, home.worship.topHeight + 4), temple.z);
    const c = v3(10, 0, 60);
    const away = (p: THREE.Vector3, d: number, lift: number, side = 0) => {
      const x = p.x - DIR.x * d - DIR.y * side;
      const z = p.z - DIR.y * d + DIR.x * side;
      return v3(x, gy(x, z) + lift, z);
    };
    const toward = (p: THREE.Vector3, d: number, lift: number, side = 0) => {
      const x = p.x + DIR.x * d - DIR.y * side;
      const z = p.z + DIR.y * d + DIR.x * side;
      return v3(x, gy(p.x, p.z) + lift, z);
    };
    s.cine.takeCamera();
    // Whole: across the island toward his spire, low over the sea; then down over home.
    const wholePos = away(c, 400, 118, -40);
    const wholeLook = toward(c, 90, 42, 60);
    // Ready: down among the people at the temple, looking up its light; then up and back over the whole island.
    const t0 = READY;
    const low = this.clearView(temple, 36, 6.5);
    const low2 = this.clearView(temple, 44, 10, low.a + 0.3);
    this.keys = [
      s.cine.current(0),
      { t: W.toBlack, pos: s.cine.current().pos, look: s.cine.current().look },
      { t: W.toBlack + 0.001, pos: wholePos, look: wholeLook },
      { t: W.descend[0], pos: wholePos.clone().add(v3(-DIR.x * 10, 4, -DIR.y * 10)), look: wholeLook.clone().add(v3(0, 6, 0)) },
      { t: t0, pos: away(this.landing, 105, 64, -30), look: this.landing.clone().setY(this.landing.y - 6) },
      { t: t0 + 5.8, pos: low.pos, look: v3(temple.x, gy(temple.x, temple.z) + 7, temple.z) },
      { t: t0 + 8.6, pos: low2.pos, look: v3(temple.x, gy(temple.x, temple.z) + 13, temple.z) },
      { t: t0 + 12, pos: away(home.center, 125, 72, -46), look: toward(home.center, 70, 18) },
      { t: t0 + 17.5, pos: away(c, 400, 190, -40), look: toward(c, 60, -8) },
      { t: t0 + 23, pos: away(c, 432, 208, -52), look: toward(c, 60, -8) },
    ];

    // The meeting light: a core, a star of rays, and three thin rings of light.
    const glow = glowTexture();
    this.core = new THREE.Sprite(new THREE.SpriteMaterial({ map: glow, color: new THREE.Color(1.8, 1.45, 0.95), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.rays = new THREE.Sprite(new THREE.SpriteMaterial({ map: raysTexture(), color: new THREE.Color(1.6, 1.35, 1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.light.add(this.core, this.rays);
    const ringMat = () => new THREE.MeshBasicMaterial({ color: new THREE.Color(1.7, 1.3, 0.75), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.TorusGeometry(1, 0.006 + i * 0.002, 6, 160), ringMat());
      this.rings.push(m);
      this.light.add(m);
    }
    this.light.visible = false;
    this.light.renderOrder = 20;
    g.scene.add(this.light);
    aoSkip(g, this.light);

    // The two hands: yours in gold, his in violet, a mirror image of yours.
    for (const mirror of [false, true]) {
      const rig = makeHand();
      const holder = new THREE.Group();
      holder.matrixAutoUpdate = false;
      holder.add(rig.root);
      holder.visible = false;
      g.scene.add(holder);
      // Out of the AO pre-pass entirely: it draws skinned meshes unposed and sprites as boxes.
      aoSkip(g, holder);
      const aura = new THREE.Sprite(
        new THREE.SpriteMaterial({ map: glow, color: mirror ? new THREE.Color(0.55, 0.3, 1.2) : new THREE.Color(1.5, 1.05, 0.45), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
      );
      aura.visible = false;
      g.scene.add(aura);
      aoSkip(g, aura);
      this.hands.push({ specks: 0, aura, rig, holder, tint: new HandTint(rig.root), look: mirror ? { ...VIOLET_LOOK } : this.look2, mirror });
    }
  }

  /**
   * A low camera spot `dist` from `p` with a clear line to it (no house, tree or boulder in the way), as close
   * as possible to the side away from his spire (or to angle `prefer`).
   */
  private clearView(p: THREE.Vector3, dist: number, lift: number, prefer?: number): { pos: THREE.Vector3; a: number } {
    const g = this.s.game;
    const base = prefer ?? Math.atan2(-DIR.y, -DIR.x);
    const solid = g.entities.filter((e) => e.alive && (e.kind === 'house' || e.kind === 'store' || e.kind === 'site' || e.kind === 'tree' || e.kind === 'rock' || e.kind === 'creature'));
    let best = { pos: new THREE.Vector3(), a: base, score: -Infinity };
    for (let k = 0; k < 25; k++) {
      const a = base + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 0.22;
      const x = p.x + Math.cos(a) * dist;
      const z = p.z + Math.sin(a) * dist;
      if (g.terrain.heightAt(x, z) < 0.8) continue;
      // Clearance along the first 70% of the line of sight.
      let clear = Infinity;
      for (let f = 0; f <= 0.7; f += 0.1) {
        const sx = x + (p.x - x) * f;
        const sz = z + (p.z - z) * f;
        for (const e of solid) clear = Math.min(clear, Math.hypot(e.pos.x - sx, e.pos.z - sz) - e.radius - (e.kind === 'tree' ? 2 : 3.5));
      }
      const score = Math.min(clear, 6) - Math.abs(a - base) * 0.6;
      if (score > best.score) best = { pos: new THREE.Vector3(x, g.terrain.surfaceAt(x, z) + lift, z), a, score };
      if (clear >= 6 && k < 3) break;
    }
    return { pos: best.pos, a: best.a };
  }

  begin() {
    const s = this.s;
    s.cine.begin();
    if (this.t >= READY) {
      // Straight to Ready to See: he is already whole.
      this.cut = true;
      this.sounded = this.spoke = true;
      s.cine.setVeil(1);
      this.endVexahl();
      along(this.keys, this.t, s.cine.pos, s.cine.look);
      s.game.dayTime = DAY.ready[0];
    }
  }

  get phase(): 'whole' | 'ready' {
    return this.t < READY ? 'whole' : 'ready';
  }

  /** Per rendered frame. Returns true once the screen is black and the end card is up. */
  frame(dt: number): boolean {
    const s = this.s;
    const g = s.game;
    this.t += dt;
    const t = this.t;
    g.terrain.setInfluence([]);
    g.terrain.setRivalInfluence([]);
    along(this.keys, t, s.cine.pos, s.cine.look);

    // Time of day: golden hour for Whole, sunset through dusk to a starry night for Ready to See.
    if (t >= W.toBlack) g.dayTime = t < READY ? lerp(DAY.whole[0], DAY.whole[1], (t - W.toBlack) / (READY - W.toBlack)) : lerp(DAY.ready[0], DAY.ready[1], clamp((t - READY) / 18, 0, 1));

    if (t < READY) this.whole(dt, t);
    else {
      if (!this.readied) {
        this.readied = true;
        this.endVexahl();
        this.onReady();
        g.audio.endingReady();
      }
      this.ready(dt, t - READY);
    }
    return this.carded;
  }

  // ------------------------------------------------------------------- Whole

  private whole(dt: number, t: number) {
    const s = this.s;
    const g = s.game;
    const isle = s.rival?.isle ?? null;
    // Through black into golden hour, with his spire already standing near.
    if (t < W.toBlack) s.cine.setVeil(ease(t / W.toBlack));
    else {
      if (!this.cut) {
        this.cut = true;
        if (isle) {
          isle.hold = 0.55;
          isle.setBalance(s.balance?.value ?? 0.8, true);
        }
      }
      s.cine.setVeil(1 - span(t, W.fromBlack[0], W.fromBlack[1]));
      if (isle && t > W.fromBlack[0] + 0.5) isle.hold = SPIRE_NEAR;
    }
    if (!this.sounded && t >= W.sound) {
      this.sounded = true;
      g.audio.endingWhole();
    }

    // Where they meet: in the sky above the island, a little above the middle of the view.
    const cam = g.godCam.camera;
    cam.updateMatrixWorld();
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    fwd.setFromMatrixColumn(cam.matrixWorld, 2).negate();
    const halfH = DEPTH * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const halfW = halfH * cam.aspect;
    if (t < W.descend[0]) this.meet.copy(cam.position).addScaledVector(fwd, DEPTH).addScaledVector(up, halfH * 0.2);

    // The hands rise from below the frame, reach toward each other, touch, and melt into the light.
    const rise = easeOut(clamp((t - W.handsIn[0]) / (W.handsIn[1] - W.handsIn[0]), 0, 1));
    const close = ease((t - W.approach[0]) / (W.approach[1] - W.approach[0]));
    const melt = span(t, W.dissolveHands[0], W.dissolveHands[1]);
    const gap = lerp(0.66, 0.34, close) * (1 - 0.25 * melt);
    const scale = halfH * HAND_SCALE;
    for (const h of this.hands) {
      h.holder.visible = t > W.handsIn[0] && melt < 0.999;
      h.aura.visible = h.holder.visible;
      if (!h.holder.visible) continue;
      const side = h.mirror ? 1 : -1;
      const bob = Math.sin(t * 0.8 + (h.mirror ? 1.3 : 0)) * 0.012;
      // Fingers toward the middle, thumb up, the back of the hand toward you; his is your hand in a mirror.
      const xAxis = up.clone().negate();
      const yAxis = fwd.clone().negate();
      const zAxis = right.clone().multiplyScalar(h.mirror ? 1 : -1);
      basis.makeBasis(xAxis, yAxis, zAxis);
      rot.makeRotationX(-0.5 + 0.18 * (1 - rise));
      basis.multiply(rot);
      rot.makeRotationY(side * 0.12);
      basis.multiply(rot);
      basis.scale(tmp.setScalar(scale));
      basis.setPosition(tmp.copy(this.meet).addScaledVector(right, side * gap * halfW).addScaledVector(up, (lerp(-1.35, -0.06, rise) + bob) * halfH));
      h.holder.matrix.copy(basis);
      h.holder.matrixWorldNeedsUpdate = true;
      h.holder.updateMatrixWorld(true);
      h.rig.setGrip(0.24 + 0.08 * close);
      h.rig.update(dt, 0, 0);
      // Yours starts from the game's own kind-god hand (glowing fingertips), warmed toward gold; his is all violet.
      h.rig.setAppearance(h.mirror ? 0 : 1, false);
      h.look.glowI = (h.mirror ? VIOLET_LOOK.glowI : GOLD_LOOK.glowI) + 2.2 * melt + 0.25 * close;
      h.tint.apply(h.look, h.mirror ? 1 : 0.6 + 0.4 * melt, 0.9 * (1 - melt));
      // A soft aura of its own light around each hand.
      h.aura.position.set(0, 0.25, -0.2);
      h.holder.localToWorld(h.aura.position);
      h.aura.scale.setScalar(scale * (2.3 + 0.4 * close + 1.2 * melt));
      h.aura.material.opacity = rise * (0.4 + 0.22 * close) * (1 - melt * 0.6);
      // Made of light: motes like stars drift through each hand, thicker as they meet and melt.
      h.specks += dt * (90 + 120 * close + 200 * melt) * (1 - melt * melt);
      while (h.specks >= 1) {
        h.specks -= 1;
        tmp.set(-0.62 + Math.random() * 1.1, -0.05 + Math.random() * 0.6, -1.25 + Math.random() * 2.4);
        h.holder.localToWorld(tmp);
        g.fx.glow.spawn({
          x: tmp.x,
          y: tmp.y,
          z: tmp.z,
          vx: (Math.random() - 0.5) * halfH * 0.01,
          vy: halfH * (0.004 + Math.random() * 0.01),
          vz: (Math.random() - 0.5) * halfH * 0.01,
          life: 0.9 + Math.random() * 1.4,
          size: halfH * (0.01 + Math.random() * 0.016),
          sizeEnd: halfH * 0.003,
          color: h.mirror ? 0xc8a8ff : 0xffe6a8,
          colorEnd: h.mirror ? 0x7a46d8 : 0xffc860,
          alpha: 0.95,
        });
      }
    }

    // The light between them: a spark as they near, a swell as they touch, then one warm light.
    const near = ease((t - (W.approach[0] + 1)) / (W.touch - W.approach[0] - 1));
    const swell = Math.exp(-Math.pow((t - W.touch - 0.7) / 1.1, 2));
    const settle = span(t, W.touch, W.touch + 3);
    this.light.visible = t > W.approach[0];
    this.light.position.copy(this.meet);
    const coreSize = halfH * (0.08 * near + 0.75 * swell + 0.32 * settle);
    this.core.scale.setScalar(Math.max(0.01, coreSize));
    this.core.material.opacity = clamp(near * 0.9 + swell + settle * 0.9, 0, 1);
    this.rays.scale.setScalar(Math.max(0.01, halfH * (0.25 * near + 1.4 * swell + 0.7 * settle)));
    this.rays.material.opacity = clamp(0.6 * near + swell + 0.7 * settle, 0, 1);
    this.rays.material.rotation = t * 0.05;
    const ringK = span(t, W.touch - 0.4, W.touch + 3.2);
    this.rings.forEach((m, i) => {
      m.scale.setScalar(halfH * (0.12 + 0.3 * ringK + i * 0.07 * ringK));
      m.quaternion.copy(cam.quaternion);
      m.rotateX(i === 0 ? 0 : i === 1 ? 1.25 : -1.1);
      m.rotateZ(t * (0.08 + i * 0.04));
      (m.material as THREE.MeshBasicMaterial).opacity = ringK * (0.5 - i * 0.1) * (1 - 0.4 * span(t, W.descend[0], W.descend[1]));
    });
    if (!this.burst && t >= W.touch) {
      this.burst = true;
      for (let i = 0; i < 260; i++) {
        const a = Math.random() * Math.PI * 2;
        const e = (Math.random() - 0.5) * 1.2;
        const sp = halfH * (0.05 + Math.random() * 0.35);
        tmp.copy(right).multiplyScalar(Math.cos(a) * sp).addScaledVector(up, Math.sin(a) * sp).addScaledVector(fwd, e * sp * 0.4);
        g.fx.glow.spawn({
          x: this.meet.x,
          y: this.meet.y,
          z: this.meet.z,
          vx: tmp.x,
          vy: tmp.y,
          vz: tmp.z,
          life: 1.8 + Math.random() * 2.2,
          size: halfH * (0.012 + Math.random() * 0.02),
          sizeEnd: halfH * 0.003,
          color: Math.random() < 0.25 ? 0xd8c2ff : 0xffe2a0,
          colorEnd: 0xfff6dc,
          alpha: 1,
          drag: 0.9,
        });
      }
    }

    // His spire dissolves into light and rises away as motes.
    this.dissolveSpire(dt, span(t, W.dissolveSpire[0], W.dissolveSpire[1]));
    if (!this.spoke && t >= W.ora) {
      this.spoke = true;
      s.cine.say(WHOLE_LINE, W.oraHold);
    }
    if (t >= W.dissolveSpire[1]) this.endVexahl();

    // The one light comes down to the home temple.
    if (t >= W.descend[0]) {
      const k = ease((t - W.descend[0]) / (W.descend[1] - W.descend[0]));
      this.light.position.lerpVectors(this.meet, this.landing, k);
      const shrink = 1 - 0.72 * k;
      this.core.scale.multiplyScalar(shrink);
      this.rays.scale.multiplyScalar(shrink);
      for (const m of this.rings) m.scale.multiplyScalar(shrink);
    }
  }

  /** Vexahl's isle: its stone turns to light and fades, gold motes rising off it. */
  private dissolveSpire(dt: number, k: number) {
    const isle = this.s.rival?.isle;
    if (!isle || k <= 0 || !isle.group.visible) return;
    if (!this.isleMats.length) {
      isle.group.traverse((o) => {
        const m = (o as THREE.Mesh).material as THREE.Material | undefined;
        if (m && !this.isleMats.some((x) => x.m === m)) this.isleMats.push({ m, opacity: m.opacity });
      });
    }
    for (const { m, opacity } of this.isleMats) {
      m.transparent = true;
      const std = m as THREE.MeshStandardMaterial;
      if (std.isMeshStandardMaterial) {
        std.emissive.lerp(new THREE.Color(0xffc870), Math.min(1, k * 1.6));
        std.emissiveIntensity = Math.max(std.emissiveIntensity, 2.2 * Math.sin(Math.min(1, k * 1.3) * Math.PI));
        std.opacity = opacity * (1 - smoothstep(0.35, 1, k));
        std.depthWrite = k < 0.4;
      } else m.opacity = m.opacity * (1 - k);
    }
    const g = this.s.game;
    this.moteAcc += dt * 70 * Math.sin(k * Math.PI);
    const s = isle.group.scale.x;
    while (this.moteAcc >= 1) {
      this.moteAcc -= 1;
      const y = 20 + Math.random() * 250;
      const r = lerp(17, 3, y / 276) * Math.sqrt(Math.random());
      const a = Math.random() * Math.PI * 2;
      tmp.set(Math.cos(a) * r, y, Math.sin(a) * r);
      isle.group.localToWorld(tmp);
      g.fx.glow.spawn({
        x: tmp.x,
        y: tmp.y,
        z: tmp.z,
        vx: (Math.random() - 0.5) * 4,
        vy: 8 + Math.random() * 14,
        vz: (Math.random() - 0.5) * 4,
        life: 3 + Math.random() * 2.5,
        size: (8 + Math.random() * 9) * s,
        sizeEnd: 1.5 * s,
        color: 0xffd98a,
        colorEnd: 0xfff2d0,
        alpha: 0.95,
      });
    }
  }

  /** He is whole now: no more spire, no more schemes. */
  private endVexahl() {
    const r = this.s.rival;
    if (!r) return;
    if (r.stage !== 'retreated') r.reintegrate();
    r.isle.hold = null;
    r.isle.setPresent(false, true);
  }

  // --------------------------------------------------------------- Ready to See

  private ready(_dt: number, t: number) {
    const s = this.s;
    // The light settles into the temple and the city begins to glow from there.
    const land = span(t, 0, 1.6);
    this.light.position.copy(this.landing);
    this.core.material.opacity = (1 - land) * 0.9;
    this.rays.material.opacity = (1 - land) * 0.7;
    for (const m of this.rings) (m.material as THREE.MeshBasicMaterial).opacity *= 1 - land;
    this.light.visible = land < 1;
    for (const h of this.hands) h.holder.visible = h.aura.visible = false;

    const city = this.city();
    if (t < 0.05) city.t = 0;
    city.level = span(t, R.cityIn[0], R.cityIn[1]);
    if (t >= R.lookUp) this.lookUp(span(t, R.lookUp, R.lookUp + 2.5));

    // Straight here (debug, or a reload mid-sequence): up from black first. Then, at the end, down to black.
    s.cine.setVeil(Math.max(this.fromReady ? 1 - span(t, 0.3, 2.6) : 0, span(t, R.black[0], R.black[1])));
    if (!this.carded && t >= R.card) {
      this.carded = true;
      this.onCard();
    }
  }

  /** The people stop where they are and look up at the light: no kneeling, no fear. */
  private lookUp(k: number) {
    const g = this.s.game;
    for (const v of g.villages) {
      const w = v.worship.pos;
      for (const p of v.villagers) {
        if (p.dead || !p.alive || p.held || p.airborne) continue;
        if (!this.looking.has(p)) {
          this.looking.add(p);
          (p as unknown as { setTask(t: unknown): void }).setTask({ type: 'idle', t: 1e6 });
          p.object.visible = true;
        }
        p.object.rotation.y = Math.atan2(w.x - p.pos.x, w.z - p.pos.z) + Math.sin(p.id * 1.7) * 0.4;
        const root = p.object.children[0];
        if (!root) continue;
        root.rotation.x = -0.34 * k;
        const [, armL, armR] = root.children;
        if (armL && armR) {
          armL.rotation.set(-0.55 * k, 0, -0.38 * k);
          armR.rotation.set(-0.55 * k, 0, 0.38 * k);
        }
      }
    }
  }

  /** After the end card: everyone goes back to their lives. */
  release() {
    for (const p of this.looking) {
      if (p.dead || !p.alive) continue;
      (p as unknown as { setTask(t: unknown): void }).setTask({ type: 'idle', t: 0.5 + Math.random() * 2 });
    }
    this.looking.clear();
  }

  dispose() {
    const g = this.s.game;
    g.scene.remove(this.light);
    for (const h of this.hands) g.scene.remove(h.holder, h.aura);
  }
}
