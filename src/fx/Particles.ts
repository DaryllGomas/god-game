import * as THREE from 'three';

export interface ParticleSpec {
  x: number;
  y: number;
  z: number;
  vx?: number;
  vy?: number;
  vz?: number;
  life: number;
  size: number;
  sizeEnd?: number;
  color: THREE.ColorRepresentation;
  colorEnd?: THREE.ColorRepresentation;
  alpha?: number;
  gravity?: number;
  drag?: number;
}

/**
 * Pooled GPU point sprites. One instance per blend mode (additive for fire and
 * magic, normal for smoke, dust and rain).
 */
export class ParticlePool {
  readonly points: THREE.Points;
  private readonly max: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly size: Float32Array;
  private readonly vel: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly s0: Float32Array;
  private readonly s1: Float32Array;
  private readonly c0: Float32Array;
  private readonly c1: Float32Array;
  private readonly a0: Float32Array;
  private readonly grav: Float32Array;
  private readonly drag: Float32Array;
  private cursor = 0;
  private live = 0;
  private readonly tmpA = new THREE.Color();
  private readonly tmpB = new THREE.Color();

  constructor(max: number, additive: boolean) {
    this.max = max;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.s0 = new Float32Array(max);
    this.s1 = new Float32Array(max);
    this.c0 = new Float32Array(max * 3);
    this.c1 = new Float32Array(max * 3);
    this.a0 = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    geo.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));

    const mat = new THREE.ShaderMaterial({
      transparent: true,
      depthWrite: false,
      fog: true,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uScale: { value: 600 } }]),
      vertexShader: /* glsl */ `
        #include <fog_pars_vertex>
        attribute float size;
        attribute vec4 color;
        uniform float uScale;
        varying vec4 vColor;
        void main() {
          vColor = color;
          vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
          gl_PointSize = size * uScale / max(-mvPosition.z, 0.1);
          gl_Position = projectionMatrix * mvPosition;
          #include <fog_vertex>
        }
      `,
      fragmentShader: /* glsl */ `
        #include <common>
        #include <fog_pars_fragment>
        varying vec4 vColor;
        void main() {
          vec2 d = gl_PointCoord - 0.5;
          float r = dot(d, d) * 4.0;
          if (r > 1.0) discard;
          float a = (1.0 - r);
          a *= a;
          gl_FragColor = vec4(vColor.rgb, vColor.a * a);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
          #include <fog_fragment>
        }
      `,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
  }

  setViewportHeight(px: number, fovDeg: number) {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale.value =
      px / (2 * Math.tan(THREE.MathUtils.degToRad(fovDeg) / 2));
  }

  spawn(p: ParticleSpec) {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.max;
    this.pos[i * 3] = p.x;
    this.pos[i * 3 + 1] = p.y;
    this.pos[i * 3 + 2] = p.z;
    this.vel[i * 3] = p.vx ?? 0;
    this.vel[i * 3 + 1] = p.vy ?? 0;
    this.vel[i * 3 + 2] = p.vz ?? 0;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.s0[i] = p.size;
    this.s1[i] = p.sizeEnd ?? p.size;
    this.tmpA.set(p.color);
    this.tmpB.set(p.colorEnd ?? p.color);
    this.c0[i * 3] = this.tmpA.r;
    this.c0[i * 3 + 1] = this.tmpA.g;
    this.c0[i * 3 + 2] = this.tmpA.b;
    this.c1[i * 3] = this.tmpB.r;
    this.c1[i * 3 + 1] = this.tmpB.g;
    this.c1[i * 3 + 2] = this.tmpB.b;
    this.a0[i] = p.alpha ?? 1;
    this.grav[i] = p.gravity ?? 0;
    this.drag[i] = p.drag ?? 0;
    this.live = Math.min(this.max, this.live + 1);
  }

  update(dt: number) {
    const { pos, vel, life, maxLife, col, size } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) {
        if (size[i] !== 0) {
          size[i] = 0;
          col[i * 4 + 3] = 0;
        }
        continue;
      }
      life[i] -= dt;
      const t = 1 - Math.max(life[i], 0) / maxLife[i];
      const dr = Math.exp(-this.drag[i] * dt);
      vel[i * 3] *= dr;
      vel[i * 3 + 1] = vel[i * 3 + 1] * dr - this.grav[i] * dt;
      vel[i * 3 + 2] *= dr;
      pos[i * 3] += vel[i * 3] * dt;
      pos[i * 3 + 1] += vel[i * 3 + 1] * dt;
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt;
      size[i] = this.s0[i] + (this.s1[i] - this.s0[i]) * t;
      col[i * 4] = this.c0[i * 3] + (this.c1[i * 3] - this.c0[i * 3]) * t;
      col[i * 4 + 1] = this.c0[i * 3 + 1] + (this.c1[i * 3 + 1] - this.c0[i * 3 + 1]) * t;
      col[i * 4 + 2] = this.c0[i * 3 + 2] + (this.c1[i * 3 + 2] - this.c0[i * 3 + 2]) * t;
      // Fade in quickly, fade out over the last 40%.
      col[i * 4 + 3] = this.a0[i] * Math.min(1, t * 8) * Math.min(1, (1 - t) / 0.4);
    }
    const g = this.points.geometry;
    g.attributes.position.needsUpdate = true;
    g.attributes.color.needsUpdate = true;
    g.attributes.size.needsUpdate = true;
  }
}

/** Convenience effects on top of the two pools. */
export class Effects {
  readonly glow = new ParticlePool(5000, true);
  readonly soft = new ParticlePool(5000, false);
  /** Scene brightness (0.15 at night .. 1 by day) applied to unlit smoke, dust and rain. */
  light = 1;
  private readonly lit = new THREE.Color();

  private shade(c: THREE.ColorRepresentation): THREE.Color {
    return this.lit.set(c).multiplyScalar(this.light);
  }

  constructor(scene: THREE.Scene) {
    scene.add(this.glow.points, this.soft.points);
  }

  resize(heightPx: number, fov: number) {
    this.glow.setViewportHeight(heightPx, fov);
    this.soft.setViewportHeight(heightPx, fov);
  }

  update(dt: number) {
    this.glow.update(dt);
    this.soft.update(dt);
  }

  fire(x: number, y: number, z: number, scale = 1) {
    const r = () => (Math.random() - 0.5) * scale;
    this.glow.spawn({
      x: x + r() * 1.5,
      y: y + Math.random() * scale,
      z: z + r() * 1.5,
      vx: r() * 1.5,
      vy: 3 + Math.random() * 4 * scale,
      vz: r() * 1.5,
      life: 0.6 + Math.random() * 0.5,
      size: 1.6 * scale,
      sizeEnd: 0.3 * scale,
      color: 0xff9a2a,
      colorEnd: 0xb81800,
      alpha: 0.42,
      drag: 1,
    });
  }

  smoke(x: number, y: number, z: number, scale = 1, dark = 0.25) {
    const c = new THREE.Color().setScalar(dark * this.light);
    this.soft.spawn({
      x: x + (Math.random() - 0.5) * scale,
      y,
      z: z + (Math.random() - 0.5) * scale,
      vx: (Math.random() - 0.5) * 1.5 + 1.2,
      vy: 2.5 + Math.random() * 2,
      vz: (Math.random() - 0.5) * 1.5,
      life: 2.5 + Math.random() * 1.5,
      size: 1.5 * scale,
      sizeEnd: 5 * scale,
      color: c,
      colorEnd: c.clone().multiplyScalar(1.6),
      alpha: 0.45,
      drag: 0.6,
    });
  }

  dust(x: number, y: number, z: number, count: number, scale = 1, color: THREE.ColorRepresentation = 0xb59a6c) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = (3 + Math.random() * 6) * scale;
      this.soft.spawn({
        x,
        y: y + 0.3,
        z,
        vx: Math.cos(a) * s,
        vy: 1 + Math.random() * 3 * scale,
        vz: Math.sin(a) * s,
        life: 0.8 + Math.random() * 0.8,
        size: 1.2 * scale,
        sizeEnd: 3.5 * scale,
        color: this.shade(color),
        alpha: 0.6,
        drag: 3,
      });
    }
  }

  splash(x: number, z: number, count: number, scale = 1) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = Math.random() * 4 * scale;
      this.soft.spawn({
        x,
        y: 0.2,
        z,
        vx: Math.cos(a) * s,
        vy: 6 + Math.random() * 8 * scale,
        vz: Math.sin(a) * s,
        life: 0.9,
        size: 0.6 * scale,
        sizeEnd: 0.3,
        color: this.shade(0xe6f6ff),
        alpha: 0.9,
        gravity: 22,
      });
    }
  }

  sparkle(x: number, y: number, z: number, count: number, color: THREE.ColorRepresentation = 0xffe28a, spread = 2) {
    for (let i = 0; i < count; i++) {
      this.glow.spawn({
        x: x + (Math.random() - 0.5) * spread,
        y: y + Math.random() * spread * 0.5,
        z: z + (Math.random() - 0.5) * spread,
        vx: (Math.random() - 0.5) * 3,
        vy: 2 + Math.random() * 5,
        vz: (Math.random() - 0.5) * 3,
        life: 0.8 + Math.random() * 0.8,
        size: 0.7,
        sizeEnd: 0.1,
        color,
        alpha: 1,
        drag: 1.5,
      });
    }
  }

  explosion(x: number, y: number, z: number, scale = 1) {
    for (let i = 0; i < 70 * scale; i++) {
      const a = Math.random() * Math.PI * 2;
      const e = Math.random() * 0.9 + 0.1;
      const s = (6 + Math.random() * 14) * scale;
      this.glow.spawn({
        x,
        y: y + 0.5,
        z,
        vx: Math.cos(a) * s * (1 - e * 0.5),
        vy: e * s,
        vz: Math.sin(a) * s * (1 - e * 0.5),
        life: 0.5 + Math.random() * 0.7,
        size: 3 * scale,
        sizeEnd: 0.5,
        color: 0xffb040,
        colorEnd: 0xd02000,
        alpha: 0.6,
        drag: 2.5,
        gravity: 4,
      });
    }
    for (let i = 0; i < 20 * scale; i++) this.smoke(x, y + 1, z, 2.5 * scale, 0.15);
  }

  rain(x: number, y: number, z: number, radius: number, count: number) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * radius;
      this.soft.spawn({
        x: x + Math.cos(a) * r,
        y: y - Math.random() * 2,
        z: z + Math.sin(a) * r,
        vy: -30,
        vx: 2,
        life: y / 30,
        size: 0.35,
        color: this.shade(0xbfe4ff),
        alpha: 0.75,
      });
    }
  }

  prayer(x: number, y: number, z: number, color: THREE.ColorRepresentation = 0x9fd8ff) {
    this.glow.spawn({
      x: x + (Math.random() - 0.5) * 6,
      y,
      z: z + (Math.random() - 0.5) * 6,
      vx: (Math.random() - 0.5) * 0.8,
      vy: 5 + Math.random() * 4,
      vz: (Math.random() - 0.5) * 0.8,
      life: 2.5,
      size: 0.9,
      sizeEnd: 0.2,
      color,
      alpha: 0.8,
    });
  }
}
