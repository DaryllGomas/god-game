import * as THREE from 'three';
import type { Game } from '../Game';
import { emblem } from '../pace/Pace';
import { clamp } from '../util/math';

// ------------------------------------------------------------------ tuning knobs

/** Ora's small orb hangs this high over the goal (m), plus a little more the farther the camera is. */
const ORB_HEIGHT = 22;
const ORB_SIZE = 5.5;
const ORB_SIZE_PER_DIST = 0.018;
/** The thread of light from the orb to the ground: radius (m) and strength. Kept soft (Daryll: "a little too luminous"). */
const THREAD_RADIUS = 0.55;
const THREAD_STRENGTH = 0.32;
/** Slow ripples on the ground round the goal: start and end radius (m), seconds each, and their opacity. */
const RIPPLE_FROM = 5;
const RIPPLE_TO = 15;
const RIPPLE_TIME = 3.6;
const RIPPLE_ALPHA = 0.26;
/** Pale blue-white: Ora's colour, so it never reads as a gold prayer, mark or ring. */
const COLOUR = new THREE.Color(0xcfe8ff);
/** Seconds to fade in, and out (when the goal moves, the light fades, moves, and comes back). */
const FADE_IN = 1.8;
const FADE_OUT = 0.9;
/** A nudge lifts the light this much, easing back over this many seconds. */
const FLARE = 0.45;
const FLARE_TIME = 5;

/**
 * Story mode's quiet cue in the world: Ora's own small round light hanging over the current goal, a fine
 * thread of light down to it, and slow ripples on the ground. No words, no arrows. Free play never shows it.
 */
export class Beacon {
  readonly group = new THREE.Group();
  private readonly orb: THREE.Sprite;
  private readonly orbMat: THREE.SpriteMaterial;
  private readonly thread: THREE.Mesh;
  private readonly threadUni = { uStrength: { value: 0 }, uTime: { value: 0 }, uColour: { value: COLOUR.clone() } };
  private readonly ripples: { mesh: THREE.Mesh; mat: THREE.MeshBasicMaterial; phase: number }[] = [];
  private readonly pos = new THREE.Vector3();
  private readonly want = new THREE.Vector3();
  private placed = false;
  private hasTarget = false;
  level = 0;
  private flare = 0;
  private t = 0;

  constructor(private readonly game: Game) {
    this.orbMat = new THREE.SpriteMaterial({ map: emblem('ora'), transparent: true, depthWrite: false, fog: false, blending: THREE.AdditiveBlending });
    this.orb = new THREE.Sprite(this.orbMat);
    this.orb.renderOrder = 9;

    const cg = new THREE.CylinderGeometry(1, 1, 1, 24, 1, true);
    cg.translate(0, 0.5, 0);
    this.thread = new THREE.Mesh(
      cg,
      new THREE.ShaderMaterial({
        uniforms: this.threadUni,
        vertexShader: /* glsl */ `
          varying float vY; varying float vFace;
          void main() {
            vY = position.y;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            vec3 n = normalize(mat3(modelMatrix) * normal);
            vec3 v = cameraPosition - wp.xyz;
            vFace = abs(dot(n, v)) / max(length(v), 1e-4);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }`,
        fragmentShader: /* glsl */ `
          uniform float uStrength; uniform float uTime; uniform vec3 uColour;
          varying float vY; varying float vFace;
          void main() {
            float core = pow(clamp(vFace, 0.0, 1.0), 2.0);
            float ends = smoothstep(0.0, 0.08, vY) * smoothstep(1.0, 0.82, vY);
            float drift = 0.75 + 0.25 * sin(vY * 14.0 + uTime * 1.3);
            gl_FragColor = vec4(uColour * core * ends * drift * clamp(uStrength, 0.0, 1.0), 1.0);
          }`,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
      }),
    );
    this.thread.frustumCulled = false;
    this.thread.renderOrder = 8;

    for (let i = 0; i < 2; i++) {
      const mat = new THREE.MeshBasicMaterial({ color: COLOUR, transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.RingGeometry(0.93, 1, 72), mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 8;
      mesh.frustumCulled = false;
      this.ripples.push({ mesh, mat, phase: i * 0.5 });
      this.group.add(mesh);
    }
    this.group.add(this.thread, this.orb);
    this.group.visible = false;
    this.group.name = 'story-beacon';
    game.scene.add(this.group);
  }

  /** Where the goal is (null: no goal, the light fades). */
  target(p: THREE.Vector3 | null) {
    this.hasTarget = !!p && Number.isFinite(p.x) && Number.isFinite(p.z);
    if (this.hasTarget) this.want.set(p!.x, 0, p!.z);
  }

  /** A nudge: the light lifts for a moment. */
  pulse() {
    this.flare = 1;
  }

  /** Where the light is now (for tests). */
  get at() {
    return { x: Math.round(this.pos.x), z: Math.round(this.pos.z), level: Math.round(this.level * 100) / 100 };
  }

  frame(dt: number, show: boolean) {
    const g = this.game;
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const far = this.placed && Math.hypot(this.want.x - this.pos.x, this.want.z - this.pos.z) > 2;
    const goal = show && this.hasTarget && !far ? 1 : 0;
    this.level = clamp(this.level + (goal > this.level ? dt / FADE_IN : -dt / FADE_OUT), 0, 1);
    // Faded out (or never placed): move to the new goal, then come back.
    if (this.hasTarget && (!this.placed || (far && this.level <= 0.01))) {
      this.pos.copy(this.want);
      this.placed = true;
    }
    this.flare = Math.max(0, this.flare - dt / FLARE_TIME);
    this.group.visible = this.level > 0.005;
    if (!this.group.visible) return;

    const k = this.level * (1 + FLARE * Math.sin(Math.min(1, this.flare) * Math.PI * 0.5));
    const ground = g.terrain.surfaceAt(this.pos.x, this.pos.z);
    const y0 = Number.isFinite(ground) ? ground : 0;
    const cam = g.godCam.distance;
    const top = ORB_HEIGHT + cam * 0.04 + Math.sin(this.t * 0.9) * 0.6;
    const size = ORB_SIZE + cam * ORB_SIZE_PER_DIST;
    this.orb.position.set(this.pos.x, y0 + top, this.pos.z);
    this.orb.scale.setScalar(size * (1 + 0.04 * Math.sin(this.t * 1.7)));
    this.orbMat.opacity = clamp(0.72 * k, 0, 1);

    this.thread.position.set(this.pos.x, y0, this.pos.z);
    this.thread.scale.set(THREAD_RADIUS, Math.max(1, top - size * 0.25), THREAD_RADIUS);
    this.threadUni.uStrength.value = THREAD_STRENGTH * k;
    this.threadUni.uTime.value = this.t;

    for (const r of this.ripples) {
      const u = (this.t / RIPPLE_TIME + r.phase) % 1;
      const rad = RIPPLE_FROM + (RIPPLE_TO - RIPPLE_FROM) * u;
      r.mesh.position.set(this.pos.x, y0 + 0.35, this.pos.z);
      r.mesh.scale.setScalar(rad);
      r.mat.opacity = RIPPLE_ALPHA * k * Math.sin(u * Math.PI) * (1 - u * 0.4);
    }
  }
}
