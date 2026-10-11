import * as THREE from 'three';
import type { Game } from '../Game';
import type { Rival } from '../rival/Rival';
import type { Balance } from '../balance/Balance';
import type { SkyWeather } from '../world/Sky';
import { ISLE_POS, glowTexture } from '../rival/RivalVisuals';
import { along, ease, span, type Cine, type Shot } from './Cine';
import { HandTint, VIOLET_LOOK } from './HandTint';
import { clamp, lerp } from '../util/math';
import { aoSkip } from './CityLights';

// ------------------------------------------------------------------ tuning knobs

/** The beats of the collapse, in real seconds. */
const T = {
  /** The world drains to grey over this long. */
  grey: 5,
  /** The wide shot of the grey island under the spire. */
  wide: 5.5,
  /** Down to the reveal: your hand rises into view... */
  reveal: 9.5,
  handIn: [9.2, 11.6] as const,
  /** ...and slowly turns violet. */
  violet: [11.8, 17.2] as const,
  ora: 15.4,
  oraHold: 4.2,
  black: [20.6, 23.8] as const,
  /** The old world is let go and the new one begins (page reload). */
  fall: 24.4,
};
/** The balance the world sinks to, and how near his spire comes (past 1: nearer than the balance ever brings it). */
const GREY = 0.03;
const SPIRE_NEAR = 1.26;
/** The hour the fall settles into (just before sunset, under his storm), reached over the first beats. */
const FALL_HOUR = 0.742;
/** Ora's line at the reveal. Ora is "it": it notices, it never accuses. */
export const REVEAL_LINE = 'It was always your hand.';

/** Ora's line on arriving at the new island, by how many worlds have fallen. */
export function arrivalLine(worlds: number): string {
  if (worlds <= 1) return 'The world remembers. Do you?';
  if (worlds === 2) return 'Again. The world keeps every mark.';
  return 'However many times it takes.';
}

const DIR = new THREE.Vector2(ISLE_POS.x, ISLE_POS.z).normalize();
const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
const tmp = new THREE.Vector3();
/** His storm over your sky: low, bruised violet-grey, dim (on top of the balance's own grey). */
const STORM: SkyWeather = {
  horizonTint: new THREE.Color(0x4a3f5e),
  horizonAmt: 0,
  zenithTint: new THREE.Color(0x1d1830),
  zenithAmt: 0,
  sunTint: new THREE.Color(0x9a86c8),
  sunAmt: 0,
  sunScale: 1,
  hemiScale: 1,
  fogScale: 1,
  nightLift: 0,
  gloom: 0,
  flash: 0,
};
/** The violet the hand turns: a little darker than his Grasping Hand, lit from within. */
const REVEAL_LOOK = { ...VIOLET_LOOK, skin: new THREE.Color(0x1a0f30), glowI: 0.32, sheen: new THREE.Color(0xb090ff) };
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const fwd = new THREE.Vector3();

export interface Stage {
  game: Game;
  cine: Cine;
  rival: Rival | null;
  balance: Balance | null;
}

/**
 * Collapse, the self-destructive loop. Calm and sad, never cruel, and no "game over": the music sinks
 * away, the island drains grey, his spire comes to stand over it. Then, close up, your own hand rises into
 * view and slowly turns violet: it was always you. One line from Ora; black. `onFallen` then begins the
 * world again (it never writes a legacy and never reaches the RPG).
 */
export class Collapse {
  t = 0;
  private readonly keys: Shot[];
  private readonly tint: HandTint;
  private readonly startBalance: number;
  private fell = false;
  private spoke = false;
  private readonly pose: { pitch: number; yaw: number; roll: number };
  private wispAcc = 0;
  private ashAcc = 0;
  private readonly hour0: number;
  private readonly aura: THREE.Sprite;

  constructor(
    private readonly s: Stage,
    private readonly onFallen: () => void,
  ) {
    const g = s.game;
    this.startBalance = s.balance?.value ?? 0.3;
    const home = g.villages.find((v) => v.isHome) ?? g.villages[0];
    const h = home.center;
    const c = v3(10, 0, 70);
    const gy = (x: number, z: number) => g.terrain.surfaceAt(x, z);
    const away = (p: THREE.Vector3, d: number, lift: number, side = 0) =>
      v3(p.x - DIR.x * d - DIR.y * side, 0, p.z - DIR.y * d + DIR.x * side).setY(gy(p.x - DIR.x * d - DIR.y * side, p.z - DIR.y * d + DIR.x * side) + lift);
    const toward = (p: THREE.Vector3, d: number, lift: number) => v3(p.x + DIR.x * d, gy(p.x, p.z) + lift, p.z + DIR.y * d);
    s.cine.takeCamera();
    this.keys = [
      s.cine.current(0),
      { t: T.wide, pos: away(c, 360, 230, 60), look: toward(c, 160, 30) },
      { t: T.reveal - 1.2, pos: away(h, 120, 70, 30), look: toward(h, 320, 92) },
      { t: T.reveal + 1, pos: away(h, 64, 34, 18), look: toward(h, 330, 104) },
      { t: T.black[1], pos: away(h, 46, 31, 14), look: toward(h, 340, 110) },
    ];
    this.tint = new HandTint(g.hand.model.root);
    this.pose = { ...g.hand.model.pose };
    this.hour0 = g.dayTime;
    this.aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color: new THREE.Color(0.5, 0.22, 1.1), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
    this.aura.visible = false;
    g.scene.add(this.aura);
    aoSkip(g, this.aura);
  }

  begin() {
    const g = this.s.game;
    this.s.cine.begin();
    aoSkip(g, g.hand.model.root); // close up, the AO pre-pass would draw it unposed (the page reloads after, so it is not undone)
    g.audio.endingHush(T.black[1]);
    const r = this.s.rival;
    if (r) {
      r.nextIn = 1e9; // no new schemes while the world falls
      r.isle.hold = SPIRE_NEAR;
    }
  }

  /** Per rendered frame. Returns true once the old world has been let go. */
  frame(dt: number): boolean {
    const s = this.s;
    const g = s.game;
    this.t += dt;
    const t = this.t;

    // The world drains: the balance sinks (the island's own look does the rest: grey land, sky, sea, music).
    const k = ease(t / T.grey);
    s.balance?.force(lerp(this.startBalance, GREY, k));
    if (s.rival) s.rival.isle.hold = SPIRE_NEAR;
    // The hour slides to the edge of evening (the short way round), and his storm closes over the sky.
    let d = FALL_HOUR - this.hour0;
    if (d > 0.5) d -= 1;
    if (d < -0.5) d += 1;
    g.dayTime = (this.hour0 + d * ease(t / (T.wide + 1)) + 1) % 1;
    STORM.horizonAmt = 0.55 * k;
    STORM.zenithAmt = 0.7 * k;
    STORM.sunAmt = 0.6 * k;
    STORM.sunScale = 1 - 0.35 * k;
    STORM.gloom = 0.35 * k;
    g.sky.applyWeather(STORM);
    // Close up, his storm-eye's dark puffs read as smudges: thin them so the spire stands clear.
    s.rival?.isle.group.traverse((o) => {
      const sp = o as THREE.Sprite;
      if (sp.isSprite && sp.material.blending === THREE.NormalBlending) sp.material.opacity *= 1 - 0.5 * k;
    });
    g.terrain.setInfluence([]);
    g.terrain.setRivalInfluence([]);

    along(this.keys, t, s.cine.pos, s.cine.look);
    // A slow breath in the camera so the stillness doesn't feel frozen.
    s.cine.pos.y += Math.sin(t * 0.4) * 0.6;

    // Ash drifting down through the view.
    this.ashAcc += dt * (t < T.reveal ? 10 : 16);
    const cam = g.godCam.camera;
    while (this.ashAcc >= 1) {
      this.ashAcc -= 1;
      cam.getWorldDirection(fwd);
      const d = t < T.reveal ? 40 + Math.random() * 160 : 8 + Math.random() * 60;
      tmp.copy(cam.position).addScaledVector(fwd, d);
      const spread = d * 0.7;
      g.fx.soft.spawn({
        x: tmp.x + (Math.random() - 0.5) * spread * 1.6,
        y: tmp.y + (Math.random() - 0.2) * spread * 0.7,
        z: tmp.z + (Math.random() - 0.5) * spread * 1.6,
        vx: 0.6 + Math.random() * 0.6,
        vy: -0.8 - Math.random() * 0.8,
        vz: (Math.random() - 0.5) * 0.6,
        life: 6 + Math.random() * 4,
        size: d * (0.004 + Math.random() * 0.005),
        color: 0x8f8a86,
        alpha: 0.55,
      });
    }

    this.revealHand(dt, t);

    if (!this.spoke && t >= T.ora) {
      this.spoke = true;
      s.cine.say(REVEAL_LINE, T.oraHold);
      s.rival?.isle.pulse(0.5);
    }
    s.cine.setVeil(span(t, T.black[0], T.black[1]));
    if (!this.fell && t >= T.fall) {
      this.fell = true;
      g.hand.model.pose.pitch = this.pose.pitch;
      g.hand.model.pose.yaw = this.pose.yaw;
      g.hand.model.pose.roll = this.pose.roll;
      this.onFallen();
      return true;
    }
    return false;
  }

  /** Your own hand, close in front of you at the lower left, reaching toward his spire; it turns violet. */
  private revealHand(dt: number, t: number) {
    const g = this.s.game;
    const model = g.hand.model;
    const root = model.root;
    const inK = easeOutBack(clamp((t - T.handIn[0]) / (T.handIn[1] - T.handIn[0]), 0, 1));
    if (t < T.handIn[0] - 0.01) return;
    const cam = g.godCam.camera;
    cam.updateMatrixWorld();
    right.setFromMatrixColumn(cam.matrixWorld, 0);
    up.setFromMatrixColumn(cam.matrixWorld, 1);
    fwd.setFromMatrixColumn(cam.matrixWorld, 2).negate();
    const depth = 7.2;
    const halfH = depth * Math.tan(THREE.MathUtils.degToRad(cam.fov / 2));
    const halfW = halfH * cam.aspect;
    // It rises from below the frame, then hangs there with a slow, small sway.
    const sx = -0.36 + Math.sin(t * 0.5) * 0.008;
    const sy = lerp(-1.25, -0.36, inK) + Math.sin(t * 0.7) * 0.01;
    root.position.copy(cam.position).addScaledVector(fwd, depth).addScaledVector(right, sx * halfW).addScaledVector(up, sy * halfH);
    root.quaternion.copy(cam.quaternion);
    root.rotateX(0.32);
    root.rotateY(-0.18);
    root.scale.setScalar(halfH * 0.8);
    root.visible = true;
    this.aura.visible = true;
    this.aura.position.set(0, 0.3, -0.3);
    root.localToWorld(this.aura.position);
    this.aura.scale.setScalar(halfH * 2.6);
    model.pose.pitch = -0.08;
    model.pose.yaw = 0.12;
    model.pose.roll = -0.42;
    model.setGrip(0.12);

    // Gold or grey as your deeds left it, then violet: midnight skin, lilac nails, violet glow.
    const k = span(t, T.violet[0], T.violet[1]);
    this.tint.apply(REVEAL_LOOK, k);
    this.aura.material.opacity = 0.42 * k;

    // Violet wisps lift off it as it turns.
    if (k > 0.05) {
      this.wispAcc += dt * 70 * Math.min(1, k * 1.6);
      while (this.wispAcc >= 1) {
        this.wispAcc -= 1;
        // Motes like stars on and just off the skin (the hand's own box: palm, fingers, wrist).
        tmp.set(-0.62 + Math.random() * 1.1, -0.05 + Math.random() * 0.55, -1.25 + Math.random() * 2.2);
        root.localToWorld(tmp);
        g.fx.glow.spawn({
          x: tmp.x,
          y: tmp.y,
          z: tmp.z,
          vx: (Math.random() - 0.5) * 0.15,
          vy: 0.18 + Math.random() * 0.35,
          vz: (Math.random() - 0.5) * 0.15,
          life: 1.6 + Math.random() * 1.8,
          size: halfH * (0.012 + Math.random() * 0.022),
          sizeEnd: halfH * 0.004,
          color: Math.random() < 0.3 ? 0xf0e4ff : 0xb48cff,
          colorEnd: 0x5a2aa8,
          alpha: 0.9,
        });
      }
    }
  }
}

/** Rises a touch past its rest and settles (the hand lifting into view). */
function easeOutBack(t: number): number {
  const c = 1.2;
  const x = t - 1;
  return 1 + (c + 1) * x * x * x + c * x * x;
}

/**
 * The world begins again, remembering: from black, the new island fades up on the ruin left where the
 * worst act of the fallen world happened; Ora says one line; then the view settles on home and play resumes.
 */
export class Arrival {
  t = 0;
  private spoke = false;
  private readonly keys: Shot[];

  constructor(
    private readonly s: Stage,
    ruin: { x: number; z: number },
    private readonly line: string,
  ) {
    const g = s.game;
    const gy = (x: number, z: number) => g.terrain.surfaceAt(x, z);
    const home = g.villages.find((v) => v.isHome) ?? g.villages[0];
    // From the side away from home, so the ruin sits in front of the village it was taken from.
    const ax = ruin.x - home.center.x;
    const az = ruin.z - home.center.z;
    const a0 = Math.atan2(az, ax);
    const orbit = (a: number, d: number, lift: number) => v3(ruin.x + Math.cos(a) * d, 0, ruin.z + Math.sin(a) * d).setY(gy(ruin.x + Math.cos(a) * d, ruin.z + Math.sin(a) * d) + lift);
    const look = v3(ruin.x, gy(ruin.x, ruin.z) + 3, ruin.z);
    const lookHome = v3((ruin.x * 2 + home.center.x) / 3, gy(ruin.x, ruin.z) + 4, (ruin.z * 2 + home.center.z) / 3);
    // The view a new island normally opens on (GodCamera's start: home, yaw 0.5, pitch 0.85, 130 out).
    const tx = home.center.x;
    const tz = home.center.z + 20;
    const target = v3(tx, gy(tx, tz), tz);
    const play = target.clone().add(v3(Math.sin(0.5) * Math.cos(0.85), Math.sin(0.85), Math.cos(0.5) * Math.cos(0.85)).multiplyScalar(130));
    this.keys = [
      { t: 0, pos: orbit(a0 + 0.55, 24, 5.5), look },
      { t: 6, pos: orbit(a0 + 0.3, 28, 7.5), look },
      { t: 10.5, pos: orbit(a0 + 0.05, 52, 24), look: lookHome },
      { t: 15, pos: play, look: target },
    ];
  }

  begin() {
    const c = this.s.cine;
    c.begin();
    c.setVeil(1);
    along(this.keys, 0, c.pos, c.look);
    c.camOn = true;
  }

  /** Per rendered frame. Returns true when play resumes. */
  frame(dt: number): boolean {
    const s = this.s;
    const g = s.game;
    this.t += dt;
    const t = this.t;
    along(this.keys, t, s.cine.pos, s.cine.look);
    g.terrain.setInfluence([]);
    g.terrain.setRivalInfluence([]);
    s.cine.setVeil(1 - span(t, 1.2, 5.6));
    if (!this.spoke && t >= 5.2) {
      this.spoke = true;
      s.cine.say(this.line, 4.4);
    }
    if (t >= 15.2) {
      s.cine.end();
      return true;
    }
    return false;
  }
}
