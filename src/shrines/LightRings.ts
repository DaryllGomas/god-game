import * as THREE from 'three';
import type { Game } from '../Game';

/**
 * Rings of gold light on the ground round a prayer place of yours (village art pass 2026-10-16, after storyboard
 * panel 2, where the stone circle and pyramid sit inside bright concentric rings with beads of light running round
 * them). Purely visual: thin strips that follow the terrain just outside the paved court: a white-hot line in a gold glow (bloom picks it up). One ring
 * at the totem, two at the stones, three at the pyramid and temple. Brighter at night.
 */

/** Ring radii (m from the prayer place's centre): just outside the court (12 m), clear of the stones. */
const RADII = [13.4, 16.2, 19.4];
/** Width of each strip (the soft glow; the bright line is a fraction of it). */
const WIDTH = 2.6;
const SEGMENTS = 200;
/** Height above the ground (the grass is kept off the rings: see plugins/grass.ts). */
const LIFT = 0.3;
/** Beads of light per ring, and how fast they run (alternate rings run opposite ways). */
const BEADS = [14, 18, 22];
const BEAD_SPEED = 0.9;

const vert = /* glsl */ `
  attribute float aSide;
  attribute float aU;
  varying float vSide;
  varying float vU;
  #include <fog_pars_vertex>
  void main() {
    vSide = aSide;
    vU = aU;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;
const frag = /* glsl */ `
  uniform vec3 uGold;
  uniform float uAlpha;
  uniform float uTime;
  uniform float uBeads;
  uniform float uDir;
  varying float vSide;
  varying float vU;
  void main() {
    float x = abs(vSide);
    float core = exp(-pow(x / 0.17, 2.0));
    float glow = exp(-pow(x / 0.5, 2.0)) * 0.38;
    float phase = vU * uBeads - uTime * uDir;
    float bead = pow(0.5 + 0.5 * cos(6.2831853 * phase), 18.0) * exp(-pow(x / 0.32, 2.0));
    float shimmer = 0.85 + 0.15 * sin(vU * 90.0 + uTime * 2.3);
    float hot = clamp(core * shimmer + bead * 1.2, 0.0, 1.0);
    float a = clamp(hot + glow, 0.0, 1.0) * uAlpha;
    // A white-hot line in a gold glow, past 1.0 so the bloom catches it (not tone-mapped).
    vec3 col = mix(uGold * 1.1, vec3(1.0, 0.97, 0.85) * 1.8, hot * 0.7);
    gl_FragColor = vec4(col, a);
  }
`;

function ringMaterial(i: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uGold: { value: new THREE.Color(0xffd37a) },
      uAlpha: { value: 0 },
      uTime: { value: 0 },
      uBeads: { value: BEADS[i] },
      uDir: { value: (i % 2 ? -1 : 1) * BEAD_SPEED },
    },
    vertexShader: vert,
    fragmentShader: frag,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
    polygonOffsetUnits: -4,
  });
}

export class LightRings {
  readonly group = new THREE.Group();
  private readonly meshes: THREE.Mesh[] = [];
  private built = false;
  private shown = 0;

  constructor() {
    this.group.name = 'shrine-light-rings';
    for (let i = 0; i < RADII.length; i++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), ringMaterial(i));
      m.frustumCulled = false;
      m.renderOrder = 4;
      m.castShadow = m.receiveShadow = false;
      m.visible = false;
      this.meshes.push(m);
      this.group.add(m);
    }
  }

  /**
   * Build the strips over the ground. `toWorld` maps a local point (the prayer place's frame) to the world;
   * `baseY` is the prayer place's own height.
   */
  build(game: Game, toWorld: (lx: number, lz: number, out: THREE.Vector3) => THREE.Vector3, baseY: number) {
    const w = new THREE.Vector3();
    RADII.forEach((r, i) => {
      const pos: number[] = [];
      const side: number[] = [];
      const u: number[] = [];
      const idx: number[] = [];
      for (let k = 0; k <= SEGMENTS; k++) {
        const f = k / SEGMENTS;
        const a = f * Math.PI * 2;
        const ca = Math.cos(a);
        const sa = Math.sin(a);
        toWorld(ca * r, sa * r, w);
        const y = game.terrain.heightAt(w.x, w.z) - baseY + LIFT;
        for (const s of [-1, 1]) {
          const rr = r + (s * WIDTH) / 2;
          pos.push(ca * rr, y, sa * rr);
          side.push(s);
          u.push(f);
        }
        if (k < SEGMENTS) {
          const b = k * 2;
          // Wound so the strip faces up.
          idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3);
        }
      }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setAttribute('aSide', new THREE.Float32BufferAttribute(side, 1));
      g.setAttribute('aU', new THREE.Float32BufferAttribute(u, 1));
      g.setIndex(idx);
      this.meshes[i].geometry.dispose();
      this.meshes[i].geometry = g;
    });
    this.built = true;
  }

  get isBuilt(): boolean {
    return this.built;
  }

  /** `count`: rings to show (0..3), `night`: 0 by day .. 1 at night, `dt`: real seconds. */
  frame(count: number, night: number, dt: number) {
    const want = count > 0 ? 1 : 0;
    this.shown += Math.sign(want - this.shown) * Math.min(Math.abs(want - this.shown), dt / 2.5);
    const t = performance.now() * 0.001;
    this.meshes.forEach((m, i) => {
      m.visible = this.built && this.shown > 0.001 && i < count;
      if (!m.visible) return;
      const mat = m.material as THREE.ShaderMaterial;
      // The inner ring brightest; each further one a little softer.
      mat.uniforms.uAlpha.value = this.shown * (0.95 + night * 0.4) * (1 - i * 0.16) * (0.9 + 0.1 * Math.sin(t * 1.3 + i));
      mat.uniforms.uTime.value = t;
    });
  }
}
