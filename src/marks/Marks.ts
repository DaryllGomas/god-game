import * as THREE from 'three';
import type { Game } from '../Game';
import { castMiracle, MIRACLE_INFO } from '../miracles/Miracles';
import { Tree } from '../entities/Nature';
import { recognise, type MarkId, type Pt } from './recognise';

/**
 * Drawing marks: hold Ctrl and drag the left button over the land. A line of light follows the
 * hand; let go and the stroke is read. A wave is Water, a spiral Food, a zigzag Fire, and the cradle
 * with a sprout (TEND) raises a small grove where it was drawn. Anything else just fades.
 */
const COLORS: Record<MarkId | 'none', number> = { water: 0x5ab8ff, food: 0xffcf4a, fire: 0xffa040, tend: 0xffd777, none: 0xdfe9ff };
const MAX_PTS = 400;
const MIN_STEP_PX = 5;
const LIFT = 0.45;

interface Line {
  mesh: THREE.Mesh;
  mat: THREE.ShaderMaterial;
  age: number;
  life: number;
  color: THREE.Color;
  rise: number;
  mark: MarkId | 'none';
  gold: number;
  cx: number;
  cz: number;
  planted: number;
  nextPlant: number;
  trees: Tree[];
}

const VERT = /* glsl */ `
varying vec2 vUv;
void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`;
const FRAG = /* glsl */ `
varying vec2 vUv;
uniform vec3 uColor; uniform float uOpacity; uniform float uTime; uniform float uHead;
void main(){
  float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
  float core = pow(clamp(across, 0.0, 1.0), 2.2);
  float soft = smoothstep(0.0, 1.0, across);
  float along = clamp(vUv.x, 0.0, 1.0);
  float tail = mix(0.35, 1.0, smoothstep(0.0, uHead, along));
  float shimmer = 0.88 + 0.12 * sin(along * 40.0 - uTime * 2.0);
  vec3 c = mix(uColor, vec3(1.0), core * 0.7) * (0.5 + core * 1.3) * shimmer;
  float a = clamp((soft * 0.45 + core * 0.65) * tail * uOpacity, 0.0, 1.0);
  if (!(a > 0.002)) discard;
  gl_FragColor = vec4(c, a);
}`;

export class Marks {
  readonly group = new THREE.Group();
  readonly aoIgnore: THREE.Object3D[] = [];
  /** For tests: the last mark read, and a count per mark. */
  last: { id: MarkId | 'none'; score: number } | null = null;
  readonly cast: Record<MarkId, number> = { water: 0, food: 0, fire: 0, tend: 0 };
  private drawing = false;
  private px: Pt[] = [];
  private gp: THREE.Vector3[] = [];
  private live: Line | null = null;
  private lines: Line[] = [];
  private lastVelPos = new THREE.Vector3();
  private moteT = 0;
  private armed = false;

  constructor(private readonly game: Game) {
    game.scene.add(this.group);
    const el = game.renderer.domElement;
    // Capture phase, before Input sees it: Ctrl+left is ours, never a grab or a pan.
    window.addEventListener(
      'pointerdown',
      (e) => {
        if (e.button !== 0 || !e.ctrlKey || e.target !== el || game.hand.held || game.controls.mode !== 'none') return;
        e.stopImmediatePropagation();
        e.preventDefault();
        this.begin();
      },
      true,
    );
    window.addEventListener(
      'pointerup',
      (e) => {
        if (!this.drawing || e.button !== 0) return;
        e.stopImmediatePropagation();
        this.end();
      },
      true,
    );
    window.addEventListener('blur', () => this.drawing && this.end());
  }

  private begin() {
    this.drawing = true;
    this.px = [];
    this.gp = [];
    this.live = this.makeLine(COLORS.none);
    this.sample(true);
  }

  private sample(force = false) {
    const g = this.game;
    if (!g.hand.valid) return;
    const x = g.input.x;
    const y = g.input.y;
    const last = this.px[this.px.length - 1];
    if (!force && last && Math.hypot(x - last.x, y - last.y) < MIN_STEP_PX) return;
    if (this.px.length >= MAX_PTS) return;
    this.px.push({ x, y });
    const gr = g.hand.ground;
    if (![gr.x, gr.z].every(Number.isFinite)) return this.px.pop();
    this.gp.push(new THREE.Vector3(gr.x, g.terrain.surfaceAt(gr.x, gr.z), gr.z));
    if (this.live) this.rebuild(this.live, this.gp);
  }

  private makeLine(color: number): Line {
    const mat = new THREE.ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      fog: false,
      uniforms: { uColor: { value: new THREE.Color(color) }, uOpacity: { value: 1 }, uTime: { value: 0 }, uHead: { value: 0.5 } },
    });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), mat);
    mesh.frustumCulled = false;
    mesh.renderOrder = 14;
    this.group.add(mesh);
    this.aoIgnore.push(mesh);
    const line: Line = { mesh, mat, age: 0, life: 1, color: new THREE.Color(color), rise: 0, mark: 'none', gold: 0, cx: 0, cz: 0, planted: 0, nextPlant: 0, trees: [] };
    this.lines.push(line);
    return line;
  }

  /** Rebuild the ribbon along the ground points (world width follows the hand's size). */
  private rebuild(line: Line, pts: THREE.Vector3[], lift = 0) {
    const n = pts.length;
    if (n < 2) return;
    const w = Math.max(0.35, this.game.hand.scale * (line.mark === 'tend' ? 0.26 : 0.16));
    const pos = new Float32Array(n * 2 * 3);
    const uv = new Float32Array(n * 2 * 2);
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)];
      const b = pts[Math.min(n - 1, i + 1)];
      let dx = b.x - a.x;
      let dz = b.z - a.z;
      const l = Math.hypot(dx, dz);
      if (l > 1e-5) (dx /= l, (dz /= l));
      else (dx = 1, dz = 0);
      const nx = -dz;
      const nz = dx;
      const y = pts[i].y + LIFT + lift;
      pos.set([pts[i].x + nx * w, y, pts[i].z + nz * w, pts[i].x - nx * w, y, pts[i].z - nz * w], i * 6);
      const u = i / (n - 1);
      uv.set([u, 0, u, 1], i * 4);
      if (i < n - 1) idx.push(i * 2, i * 2 + 1, i * 2 + 2, i * 2 + 1, i * 2 + 3, i * 2 + 2);
    }
    const geo = line.mesh.geometry;
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    geo.computeBoundingSphere();
  }

  private end() {
    this.drawing = false;
    const g = this.game;
    const line = this.live;
    this.live = null;
    if (!line) return;
    const res = recognise(this.px);
    const id: MarkId | 'none' = res ? res.id : 'none';
    this.last = { id, score: res ? res.score : 0 };
    line.mark = id;
    line.color.setHex(COLORS[id]);
    (line.mat.uniforms.uColor.value as THREE.Color).copy(line.color);
    line.age = 0;
    if (id === 'none' || this.gp.length < 3) {
      line.life = 0.9;
      return;
    }
    let cx = 0;
    let cz = 0;
    for (const p of this.gp) (cx += p.x, (cz += p.z));
    cx /= this.gp.length;
    cz /= this.gp.length;
    line.cx = cx;
    line.cz = cz;
    const cost = id === 'tend' ? MIRACLE_INFO.water.cost : MIRACLE_INFO[id].cost;
    if (!g.player.spend(cost)) {
      g.message(`Not enough prayer power (${cost}). More worshippers will help.`, 'warn', 'no-power');
      line.mark = 'none';
      line.life = 0.9;
      return;
    }
    this.cast[id]++;
    line.life = id === 'tend' ? 4.2 : 1.6;
    line.nextPlant = 1.1;
    if (id !== 'tend') castMiracle(g, id, cx, cz, new THREE.Vector3());
    else {
      g.audio.miracle('water', new THREE.Vector3(cx, g.terrain.surfaceAt(cx, cz), cz));
      g.fx.sparkle(cx, g.terrain.surfaceAt(cx, cz) + 3, cz, 30, 0xffd777, 5);
    }
  }

  private plantOne(line: Line) {
    const g = this.game;
    for (let k = 0; k < 16; k++) {
      const a = line.planted * 2.39996 + k * 1.1;
      const d = 2.5 + (7 + k * 0.5) * Math.sqrt((line.planted + 0.5) / 8);
      const x = line.cx + Math.cos(a) * d;
      const z = line.cz + Math.sin(a) * d;
      if (!g.terrain.isLand(x, z, 1) || !g.canPlantTree(x, z)) continue;
      const t = new Tree(Math.floor(Math.random() * 1e6), x, z, 0.05);
      t.pos.y = g.terrain.heightAt(x, z);
      g.add(t);
      line.trees.push(t);
      g.fx.sparkle(x, t.pos.y + 0.6, z, 8, 0xffe28a, 1.4);
      break;
    }
    line.planted++;
  }

  frame(dt: number, realTime: number) {
    if (this.drawing) {
      this.sample();
    }
    for (let i = this.lines.length - 1; i >= 0; i--) {
      const l = this.lines[i];
      const live = l === this.live;
      l.mat.uniforms.uTime.value = realTime;
      if (live) {
        l.mat.uniforms.uOpacity.value = 0.9;
        continue;
      }
      l.age += dt;
      const k = Math.min(1, l.age / l.life);
      if (l.mark === 'tend') {
        // Glows gold above the land, then the trees rise.
        l.gold = Math.min(1, l.gold + dt * 1.6);
        l.rise = Math.min(1.8, l.rise + dt * 1.2);
        this.rebuild(l, this.gp, l.rise);
        (l.mat.uniforms.uColor.value as THREE.Color).setHex(0xffd777).multiplyScalar(1 + l.gold * 0.5);
        while (l.planted < 9 && l.age > l.nextPlant) {
          this.plantOne(l);
          l.nextPlant += 0.22;
        }
        for (const t of l.trees) if (!t.mature && Math.random() < dt * 2.2) t.water(0.12);
        l.mat.uniforms.uOpacity.value = k < 0.2 ? 0.6 + k * 2 : Math.max(0, 1 - (k - 0.2) / 0.8);
      } else {
        l.mat.uniforms.uOpacity.value = Math.max(0, 1 - k * k) * (l.mark === 'none' ? 0.6 : 1);
      }
      if (k >= 1) {
        this.group.remove(l.mesh);
        l.mesh.geometry.dispose();
        l.mat.dispose();
        const j = this.aoIgnore.indexOf(l.mesh);
        if (j >= 0) this.aoIgnore.splice(j, 1);
        this.lines.splice(i, 1);
      }
    }
    this.motes(dt);
  }

  /** A faint trail of motes behind a fast-moving hand (rate-limited, no strobing). */
  private motes(dt: number) {
    const g = this.game;
    const p = g.hand.pos;
    if (!this.armed) {
      this.lastVelPos.copy(p);
      this.armed = true;
      return;
    }
    const sp = p.distanceTo(this.lastVelPos) / Math.max(dt, 1e-3);
    this.lastVelPos.copy(p);
    this.moteT -= dt;
    if (!g.hand.valid || !Number.isFinite(sp) || sp < g.hand.scale * 6 || this.moteT > 0) return;
    this.moteT = 0.12;
    g.fx.sparkle(p.x, p.y - g.hand.scale * 0.2, p.z, 1, 0xb8d8ff, g.hand.scale * 0.35);
  }
}
