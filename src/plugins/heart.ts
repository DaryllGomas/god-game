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

const ringMat = new THREE.ShaderMaterial({
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending,
  polygonOffset: true,
  polygonOffsetFactor: -2,
  polygonOffsetUnits: -2,
  uniforms: { uTime: { value: 0 }, uGlow: { value: 0.5 } },
  vertexShader: /* glsl */ `
    varying vec2 vP;
    void main() { vP = position.xy; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform float uTime, uGlow;
    varying vec2 vP;
    void main() {
      float r = length(vP);
      float ang = atan(vP.y, vP.x + 1e-4);
      float pulse = 0.82 + 0.18 * sin(uTime * 1.2); // ~5 s per breath
      float a = 0.0;
      for (int i = 0; i < 3; i++) {
        float rr = 7.2 + float(i) * 3.4;
        float line = exp(-pow((r - rr) / 0.2, 2.0));
        float dash = 0.6 + 0.4 * sin(ang * (30.0 + float(i) * 14.0) + uTime * 0.4 * (1.0 - float(i)));
        a += line * dash * (1.0 - 0.18 * float(i));
      }
      a += 0.12 * exp(-pow((r - 6.0) / 3.5, 2.0));
      a *= smoothstep(15.5, 12.0, r) * pulse * uGlow;
      if (!(a > 0.0)) discard;
      gl_FragColor = vec4(vec3(1.0, 0.72, 0.28) * a * 1.5, a);
    }
  `,
});

export function install(game: Game): GamePlugin {
  const scene = game.scene;
  const aoIgnore = ((game as unknown as { aoIgnore?: THREE.Object3D[] }).aoIgnore ??= []);
  const group = new THREE.Group();
  group.name = 'village-hearts';
  scene.add(group);
  aoIgnore.push(group);

  const stoneGeo = new THREE.CylinderGeometry(0.34, 0.5, 1.5, 5).translate(0, 0.75, 0);
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8c8678, roughness: 0.95, flatShading: true });
  const capGeo = new THREE.SphereGeometry(0.2, 8, 6);
  const capMat = new THREE.MeshBasicMaterial({ color: 0xffc766 });

  interface Heart { v: Game['villages'][number]; ring: THREE.Mesh; stones: THREE.InstancedMesh; caps: THREE.InstancedMesh; drapedAt: number }
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
      const ring = new THREE.Mesh(geo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(p);
      ring.renderOrder = 2;
      ring.frustumCulled = false;
      group.add(ring);

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
      const h: Heart = { v, ring, stones, caps, drapedAt: -99 };
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
      ringMat.uniforms.uTime.value = t;
      ringMat.uniforms.uGlow.value = 0.95 + 0.5 * (1 - day);
      const capOn = 0.35 + 0.65 * (1 - day);
      capMat.color.setRGB(1.0 * capOn, 0.78 * capOn, 0.4 * capOn);
      for (const h of hearts) {
        if (t - h.drapedAt > 8) drape(h); // the land moves (pads, rain-fed hills): keep the rings on it
        const totem = h.v.shrineStage === 'totem';
        h.stones.visible = h.caps.visible = totem;
      }
    },
  };
}
