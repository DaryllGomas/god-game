import * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';

/**
 * The village heart (v0.6 polish 3, storyboard panel 2): soft golden concentric rings glowing on the ground round
 * every prayer place (a slow, gentle pulse), and at the totem stage a ring of small standing stones with little lit
 * caps. The big stone circle (and later ages) replace the small stones; the rings stay at every stage.
 */
const RING_R = 16;
const STONES = 9;
const STONE_R = 7.7;

const SHAFT_H = 20;

const ringShader = {
  vertexShader: /* glsl */ `
    varying vec2 vP;
    void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime, uGlow;
    varying vec2 vP;
    float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    void main() {
      float r = length(vP);
      float ang = atan(vP.y, vP.x + 1e-4);
      float pulse = 0.8 + 0.2 * sin(uTime * 0.9); // ~7 s per breath
      float a = 0.0;
      float sparkle = 0.0;
      for (int i = 0; i < 4; i++) {
        float rr = 6.4 + float(i) * 2.9;
        float d = (r - rr);
        float line = exp(-pow(d / 0.26, 2.0)) + 0.35 * exp(-pow(d / 0.9, 2.0)); // bright core + soft halo
        float dash = 0.8 + 0.2 * sin(ang * (24.0 + float(i) * 12.0) + uTime * 0.35 * (1.0 - 0.5 * float(i)));
        a += line * dash * (1.0 - 0.12 * float(i));
        // motes: a few cells round each ring, each twinkling slowly
        float cells = 26.0 + float(i) * 12.0;
        float u = ang / 6.2831853 * cells + uTime * (0.25 + 0.1 * float(i)) * (mod(float(i), 2.0) * 2.0 - 1.0);
        float id = floor(u);
        float h = hash(vec2(id, float(i) + 3.0));
        vec2 f = vec2(fract(u) - 0.5, d / 0.45);
        float tw = 0.5 + 0.5 * sin(uTime * (0.8 + h * 1.4) + h * 40.0);
        sparkle += step(0.55, h) * exp(-dot(f, f) * 22.0) * tw;
      }
      // warm pool of light on the ground at the centre
      float pool = exp(-pow(r / 5.0, 2.0)) * 0.75 + 0.25 * exp(-pow(r / 9.0, 2.0));
      float v = (a * 1.1 + pool * 0.8) * pulse + sparkle * 1.3;
      v *= smoothstep(15.5, 11.0, r) * uGlow;
      if (!(v > 0.0)) discard;
      v = min(v, 1.6);
      vec3 col = mix(vec3(1.0, 0.68, 0.22), vec3(1.0, 0.92, 0.62), clamp(sparkle * 0.8 + pool * 0.3, 0.0, 1.0));
      gl_FragColor = vec4(col * v, min(v, 1.0));
    }
  `,
};

const shaftShader = {
  vertexShader: /* glsl */ `
    varying vec3 vL;
    void main() { vL = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime, uGlow;
    varying vec3 vL;
    void main() {
      float h = clamp(vL.y / ${SHAFT_H.toFixed(1)}, 0.0, 1.0);
      float r = length(vL.xz);
      float w = mix(1.5, 3.4, h);
      float core = exp(-pow(r / (w * 0.5), 2.0));
      float streak = 0.85 + 0.15 * sin(atan(vL.z, vL.x + 1e-4) * 5.0 + vL.y * 0.4 - uTime * 0.6);
      float fade = smoothstep(0.0, 0.06, h) * (1.0 - smoothstep(0.35, 1.0, h));
      float breath = 0.85 + 0.15 * sin(uTime * 0.8 + 1.0);
      float v = core * streak * fade * breath * uGlow * 1.3;
      if (!(v > 0.002)) discard;
      gl_FragColor = vec4(vec3(1.0, 0.8, 0.45) * v, v);
    }
  `,
};

function glowMat(shader: { vertexShader: string; fragmentShader: string }, side: THREE.Side = THREE.FrontSide) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
    uniforms: { uTime: { value: 0 }, uGlow: { value: 0.5 } },
    ...shader,
  });
}

export function install(game: Game): GamePlugin {
  const scene = game.scene;
  const aoIgnore = ((game as unknown as { aoIgnore?: THREE.Object3D[] }).aoIgnore ??= []);
  const group = new THREE.Group();
  group.name = 'village-hearts';
  scene.add(group);
  aoIgnore.push(group);

  const moteMat = new THREE.PointsMaterial({ color: 0xffd98a, size: 0.55, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, blending: THREE.AdditiveBlending });
  const stoneGeo = new THREE.CylinderGeometry(0.34, 0.5, 1.5, 5).translate(0, 0.75, 0);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8c8678, roughness: 0.95, flatShading: true });
  const capGeo = new THREE.SphereGeometry(0.2, 8, 6);
  const capMat = new THREE.MeshBasicMaterial({ color: 0xffc766 });

  interface Heart { v: Game['villages'][number]; ring: THREE.Mesh; ringMat: THREE.ShaderMaterial; shaftMat: THREE.ShaderMaterial; motes: THREE.Points; moteSeed: Float32Array; stones: THREE.InstancedMesh; caps: THREE.InstancedMesh; drapedAt: number }
  const hearts: Heart[] = [];
  let t = 0;
  let built = false;

  const drape = (h: Heart) => {
    const p = h.v.worship.pos;
    const pos = h.ring.geometry.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = game.terrain.heightAt(p.x + pos.getX(i), p.z - pos.getY(i));
      pos.setZ(i, Number.isFinite(y) ? y - p.y + 0.12 : 0.12);
    }
    pos.needsUpdate = true;
    h.drapedAt = t;
  };

  const build = () => {
    built = true;
    for (const v of game.villages) {
      const p = v.worship.pos;
      // Ring mesh: built flat in XY (shader reads xy), then draped in z and rotated flat so z is up.
      const geo = new THREE.RingGeometry(0.5, RING_R, 72, 20);
      const rMat = glowMat(ringShader);
      const ring = new THREE.Mesh(geo, rMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(p);
      ring.renderOrder = 2;
      ring.frustumCulled = false;
      group.add(ring);

      const sMat = glowMat(shaftShader, THREE.DoubleSide);
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(3.4, 1.5, SHAFT_H, 20, 1, true).translate(0, SHAFT_H / 2, 0), sMat);
      shaft.position.copy(p);
      shaft.renderOrder = 3;
      shaft.frustumCulled = false;
      group.add(shaft);
      const NM = 28;
      const moteSeed = new Float32Array(NM * 3);
      for (let i = 0; i < NM * 3; i++) moteSeed[i] = Math.random();
      const mGeo = new THREE.BufferGeometry();
      mGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(NM * 3), 3));
      const motes = new THREE.Points(mGeo, moteMat);
      motes.frustumCulled = false;
      motes.renderOrder = 4;
      group.add(motes);

      const stones = new THREE.InstancedMesh(stoneGeo, stoneMat, STONES);
      const caps = new THREE.InstancedMesh(capGeo, capMat, STONES);
      stones.castShadow = true;
      const m = new THREE.Matrix4();
      const q = new THREE.Quaternion();
      for (let i = 0; i < STONES; i++) {
        const a = (i / STONES) * Math.PI * 2 + 0.3;
        const x = p.x + Math.cos(a) * STONE_R;
        const z = p.z + Math.sin(a) * STONE_R;
        const y = game.terrain.heightAt(x, z);
        const s = 0.85 + ((i * 37) % 7) * 0.07;
        q.setFromEuler(new THREE.Euler(0, a * 3, 0));
        m.compose(new THREE.Vector3(x, y - 0.1, z), q, new THREE.Vector3(s, s, s));
        stones.setMatrixAt(i, m);
        m.compose(new THREE.Vector3(x, y - 0.1 + 1.62 * s, z), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1));
        caps.setMatrixAt(i, m);
      }
      group.add(stones, caps);
      const h: Heart = { v, ring, ringMat: rMat, shaftMat: sMat, motes, moteSeed, stones, caps, drapedAt: -99 };
      drape(h);
      hearts.push(h);
    }
  };

  return {
    name: 'heart',
    frame(dt) {
      if (!built) {
        if (!game.villages.length) return;
        build();
      }
      t += Math.min(dt, 0.1);
      const day = Math.min(1, Math.max(0, game.sky.daylight));
      moteMat.opacity = 0.55 + 0.4 * (1 - day);
      const capOn = 0.35 + 0.65 * (1 - day);
      capMat.color.setRGB(1.0 * capOn, 0.78 * capOn, 0.4 * capOn);
      for (const h of hearts) {
        if (t - h.drapedAt > 8) drape(h); // the land moves (pads, rain-fed hills): keep the rings on it
        const faith = Number.isFinite(h.v.belief) ? Math.min(1, Math.max(0, h.v.belief / 100)) : 0.5;
        const glow = (0.5 + 0.9 * faith) * (0.9 + 0.5 * (1 - day));
        for (const m of [h.ringMat, h.shaftMat]) {
          m.uniforms.uTime.value = t;
          m.uniforms.uGlow.value = glow;
        }
        const pp = h.v.worship.pos;
        const arr = h.motes.geometry.getAttribute('position') as THREE.BufferAttribute;
        for (let i = 0; i < arr.count; i++) {
          const k = (t * (0.05 + h.moteSeed[i * 3] * 0.05) + h.moteSeed[i * 3 + 1]) % 1; // rise 0..1, slow
          const ang = h.moteSeed[i * 3 + 2] * 6.283 + t * 0.2;
          const rad = 1.2 + k * 2.4 + h.moteSeed[i * 3] * 1.5;
          arr.setXYZ(i, pp.x + Math.cos(ang) * rad, pp.y + 0.5 + k * SHAFT_H * 0.8, pp.z + Math.sin(ang) * rad);
        }
        arr.needsUpdate = true;
        h.motes.visible = glow > 0.3;
        const totem = h.v.shrineStage === 'totem';
        h.stones.visible = h.caps.visible = totem;
      }
    },
  };
}
