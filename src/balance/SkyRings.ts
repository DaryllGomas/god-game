import * as THREE from 'three';

// ------------------------------------------------------------------ tuning knobs

/**
 * Where the rings hang: a compass direction (x, z) from the island and a height above the horizon
 * (radians). They sit in the sky like the sun does (no parallax), just off the right shoulder of his
 * spire as you face it, so a low view across the sea can hold both halves of the story at once.
 */
const SKY_DIR = new THREE.Vector2(-0.5, -0.87).normalize();
const ELEVATION = 0.045;
/** How far away they are drawn (inside the sky dome, beyond everything else). */
const DIST = 3000;
/** Each ring: [angular radius, extra height, tilt toward you, roll] (radians). Two orbits, crossing. */
const RINGS: [number, number, number, number][] = [
  [0.17, 0, 0.19, 0.05],
  [0.215, 0.01, 0.15, -0.07],
];
/** Thickness of each ring's bright thread, and of the faint glow around it (metres at DIST). */
const TUBE = 5;
const HALO = 20;
/** Gold-white, in linear HDR. */
const GOLD = new THREE.Color(1.45, 1.18, 0.74);
const WHITE = new THREE.Color(1.5, 1.45, 1.32);

/**
 * Two thin rings of light in the sky (the TEND mark's orbit arcs), clear while the world is in tune
 * and fading away as it falls out of balance. A slow glint travels along each, like something in
 * orbit. Nothing flashes: everything here moves at a walking pace.
 */
export class SkyRings {
  readonly group = new THREE.Group();
  private readonly uniforms = {
    uTime: { value: 0 },
    uStrength: { value: 1 },
    uGold: { value: GOLD },
    uWhite: { value: WHITE },
  };

  constructor(scene: THREE.Scene) {
    const make = (halo: boolean) =>
      new THREE.ShaderMaterial({
        uniforms: this.uniforms,
        defines: { HALO: halo ? 1 : 0 },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
        fog: false,
        vertexShader: /* glsl */ `
          varying float vU;
          varying float vFace;
          void main() {
            vU = uv.x;
            vec4 wp = modelMatrix * vec4(position, 1.0);
            // Guarded: a zero-length normal (tube seams) would make NaN, which bloom smears into black specks.
            vec3 n = mat3(modelMatrix) * normal;
            vec3 v = cameraPosition - wp.xyz;
            vFace = abs(dot(n, v)) / max(length(n) * length(v), 1e-4);
            gl_Position = projectionMatrix * viewMatrix * wp;
          }
        `,
        fragmentShader: /* glsl */ `
          uniform float uTime;
          uniform float uStrength;
          uniform vec3 uGold;
          uniform vec3 uWhite;
          varying float vU;
          varying float vFace;
          void main() {
            // A soft core, brightest where the tube faces you and fading to nothing at its edges.
            float core = pow(clamp(vFace, 0.0, 1.0), HALO == 1 ? 2.5 : 1.4);
            // Gentle swells along the ring, and one slow glint travelling around it.
            float swell = 0.65 + 0.35 * sin(vU * 6.2831853 * 2.0 + uTime * 0.1);
            float d = fract(vU - uTime * 0.008 + 0.5) - 0.5;
            float glint = exp(-d * d / 0.0012);
            vec3 col = mix(uGold, uWhite, HALO == 1 ? 0.0 : core * 0.5 + glint * 0.5);
            float a = uStrength * core * (swell * 0.6 + glint * 0.9) * (HALO == 1 ? 0.16 : 0.85);
            gl_FragColor = vec4(col * a, 1.0);
          }
        `,
      });
    const thread = make(false);
    const glow = make(true);
    const up = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(SKY_DIR.x, 0, SKY_DIR.y);
    for (const [ang, lift, tilt, roll] of RINGS) {
      const el = ELEVATION + lift;
      const center = new THREE.Vector3(SKY_DIR.x * Math.cos(el), Math.sin(el), SKY_DIR.y * Math.cos(el)).multiplyScalar(DIST);
      const r = DIST * Math.tan(ang);
      // Lying flat, then tipped toward you (so it reads as an ellipse, not a line) and rolled a little.
      const n = up.clone().multiplyScalar(Math.cos(tilt)).addScaledVector(fwd, Math.sin(tilt)).normalize();
      n.applyAxisAngle(center.clone().normalize(), roll);
      const q = new THREE.Quaternion().setFromUnitVectors(up, n);
      for (const [tube, mat] of [[TUBE, thread], [HALO, glow]] as [number, THREE.ShaderMaterial][]) {
        const geo = new THREE.TorusGeometry(r, tube, 8, 512);
        geo.rotateX(Math.PI / 2); // lie flat
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(center);
        m.quaternion.copy(q);
        m.frustumCulled = false;
        m.renderOrder = -5; // after the sky dome, before everything else
        this.group.add(m);
      }
    }
    this.group.name = 'sky-rings';
    scene.add(this.group);
  }

  /** 0 = gone, 1 = clear. */
  setStrength(v: number) {
    this.uniforms.uStrength.value = v;
    this.group.visible = v > 0.004;
  }

  /** Per frame: they hang in the sky like the sun, so they travel with the camera. */
  frame(dt: number, camera: THREE.Camera) {
    this.uniforms.uTime.value += dt;
    this.group.position.copy(camera.position);
  }
}
