import * as THREE from 'three';
import type { Terrain } from '../world/Terrain';
import { clamp, damp } from '../util/math';

const GRID = 28; // decal grid cells per side; each vertex is lifted onto the terrain
const GOLD = new THREE.Color(0xffd37a);
const BAD = new THREE.Color(0xb04a3c);

/** Draws the TEND mark (first-world-mark-board): cradle leaves, world orb, sprout and star as line-art. `arcs` = the two orbit arcs. */
function drawSigil(arcs: boolean): HTMLCanvasElement {
  const S = 512;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.translate(S / 2, S / 2);
  g.lineCap = 'round';
  g.strokeStyle = g.fillStyle = '#fff';
  const glow = (w: number, a = 1) => {
    g.shadowColor = '#fff';
    g.shadowBlur = 10;
    g.lineWidth = w * 1.8; // thick enough to read from the default camera distance
    g.globalAlpha = a;
  };
  const star = (x: number, y: number, r: number) => {
    g.beginPath();
    g.moveTo(x, y - r);
    g.quadraticCurveTo(x, y, x + r * 0.28, y);
    g.quadraticCurveTo(x, y, x, y + r);
    g.quadraticCurveTo(x, y, x - r * 0.28, y);
    g.quadraticCurveTo(x, y, x, y - r);
    g.fill();
  };
  if (arcs) {
    // Two thin orbit arcs, left and right, with small bead nodes.
    glow(2.2, 0.9);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.arc(0, 0, 222, s < 0 ? Math.PI * 0.62 : -Math.PI * 0.38, s < 0 ? Math.PI * 1.38 : Math.PI * 0.38 + (s < 0 ? 0 : 0), false);
      g.stroke();
    }
    for (const a of [0.12, 0.5, 0.88, 1.12, 1.5, 1.88]) {
      g.beginPath();
      g.arc(Math.cos(a * Math.PI) * 222, Math.sin(a * Math.PI) * 222, 4.5, 0, 6.3);
      g.fill();
    }
    g.globalAlpha = 0.35;
    g.lineWidth = 1.2;
    g.beginPath();
    g.arc(0, 0, 238, 0, 6.3);
    g.stroke();
  } else {
    // World orb with a faint continent hint and its star.
    glow(3.2);
    g.beginPath();
    g.arc(0, 0, 92, 0, 6.3);
    g.stroke();
    g.globalAlpha = 0.4;
    g.lineWidth = 1.6;
    g.beginPath();
    g.arc(0, 0, 70, 0, 6.3);
    g.stroke();
    g.globalAlpha = 0.9;
    star(0, 0, 40);
    // Sprout above the orb: stem and two leaves.
    glow(3);
    g.beginPath();
    g.moveTo(0, -92);
    g.lineTo(0, -122);
    g.stroke();
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, -122);
      g.quadraticCurveTo(s * 40, -150, s * 52, -122);
      g.quadraticCurveTo(s * 20, -112, 0, -122);
      g.stroke();
    }
    // Cradle forms: two sweeping leaves hugging the orb, meeting at the stem below.
    glow(3.4);
    for (const s of [-1, 1]) {
      g.beginPath();
      g.moveTo(0, 150);
      g.bezierCurveTo(s * 40, 140, s * 128, 100, s * 132, 4);
      g.bezierCurveTo(s * 138, -50, s * 150, -78, s * 156, -96);
      g.bezierCurveTo(s * 170, -40, s * 160, 92, s * 18, 158);
      g.closePath();
      g.stroke();
      g.globalAlpha = 0.5;
      g.lineWidth = 1.5;
      g.beginPath();
      g.moveTo(s * 10, 146);
      g.bezierCurveTo(s * 80, 120, s * 140, 40, s * 150, -70);
      g.stroke();
      glow(3.4);
    }
    // Star axis: vertical line with stars at the foot and head.
    glow(2);
    g.globalAlpha = 0.7;
    g.beginPath();
    g.moveTo(0, 150);
    g.lineTo(0, 215);
    g.stroke();
    g.globalAlpha = 1;
    star(0, 222, 22);
    star(0, -182, 18);
  }
  return c;
}

function tex(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

/**
 * Where a held thing will land: a flat gold TEND sigil draped on the terrain at the landing point,
 * with the star axis as a thin beam of light from the held object down to it. Blocked or outside
 * the golden ring of influence it dims to a reddish sigil with no beam. Also draws the soft gold
 * ring under the hovered grab target (or clickable building), reddish when it is out of reach.
 */
export class DropMarker {
  private readonly decal: THREE.Mesh;
  private readonly pos: THREE.BufferAttribute;
  private readonly baseMat: THREE.MeshBasicMaterial;
  private readonly arcMat: THREE.MeshBasicMaterial;
  private readonly glowMat: THREE.MeshBasicMaterial;
  private readonly arcGlowMat: THREE.MeshBasicMaterial;
  private readonly glow: THREE.Mesh;
  private readonly arcGlow: THREE.Mesh;
  private readonly arcs: THREE.Mesh;
  private readonly beam: THREE.Group;
  private readonly beamMat: THREE.MeshBasicMaterial;
  private readonly ring: THREE.Mesh;
  private readonly ringMat: THREE.MeshBasicMaterial;
  private readonly col = new THREE.Color();
  private arcTurn = 0;
  private fade = 0;
  private bad = 0;
  private ringFade = 0;
  private ringAt = new THREE.Vector3();
  private ringR = 1;

  constructor(scene: THREE.Scene) {
    const mk = (map: THREE.Texture, additive = true) => {
      const m = new THREE.MeshBasicMaterial({
        map,
        transparent: true,
        blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4,
        toneMapped: false,
      });
      return m;
    };
    const baseTex = tex(drawSigil(false));
    const arcTex = tex(drawSigil(true));
    // Line-art in normal blending so it reads on bright grass, plus an additive copy that makes it glow (and bloom).
    this.baseMat = mk(baseTex, false);
    this.glowMat = mk(baseTex);
    this.arcMat = mk(arcTex, false);
    this.arcGlowMat = mk(arcTex);
    this.arcGlowMat.map = arcTex;

    const geo = new THREE.PlaneGeometry(1, 1, GRID, GRID);
    geo.rotateX(-Math.PI / 2);
    this.pos = geo.getAttribute('position') as THREE.BufferAttribute;
    this.pos.setUsage(THREE.DynamicDrawUsage);
    this.decal = new THREE.Mesh(geo, this.baseMat);
    this.decal.frustumCulled = false;
    this.decal.renderOrder = 6;
    this.decal.visible = false;
    // The orbit arcs share the geometry but turn slowly: a second, rotated-UV copy.
    this.arcMat.map!.center.set(0.5, 0.5);
    this.arcs = new THREE.Mesh(geo, this.arcMat);
    this.arcs.frustumCulled = false;
    this.arcs.renderOrder = 7;
    this.arcs.visible = false;
    this.glow = new THREE.Mesh(geo, this.glowMat);
    this.arcGlow = new THREE.Mesh(geo, this.arcGlowMat);
    for (const m of [this.glow, this.arcGlow]) {
      m.frustumCulled = false;
      m.renderOrder = 8;
      m.visible = false;
    }
    scene.add(this.decal, this.arcs, this.glow, this.arcGlow);

    // Beam: two crossed vertical quads with a soft horizontal falloff and a bright base.
    const bc = document.createElement('canvas');
    bc.width = 64;
    bc.height = 256;
    const bg = bc.getContext('2d')!;
    const gx = bg.createLinearGradient(0, 0, 64, 0);
    gx.addColorStop(0, 'rgba(255,255,255,0)');
    gx.addColorStop(0.5, 'rgba(255,255,255,1)');
    gx.addColorStop(1, 'rgba(255,255,255,0)');
    bg.fillStyle = gx;
    bg.fillRect(0, 0, 64, 256);
    bg.globalCompositeOperation = 'destination-in';
    const gy = bg.createLinearGradient(0, 0, 0, 256);
    gy.addColorStop(0, 'rgba(0,0,0,0.25)');
    gy.addColorStop(0.8, 'rgba(0,0,0,0.7)');
    gy.addColorStop(1, 'rgba(0,0,0,1)');
    bg.fillStyle = gy;
    bg.fillRect(0, 0, 64, 256);
    this.beamMat = new THREE.MeshBasicMaterial({
      map: tex(bc),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
    });
    const qg = new THREE.PlaneGeometry(1, 1);
    qg.translate(0, 0.5, 0); // origin at the foot, grows upward
    this.beam = new THREE.Group();
    const q1 = new THREE.Mesh(qg, this.beamMat);
    const q2 = new THREE.Mesh(qg, this.beamMat);
    q2.rotation.y = Math.PI / 2;
    this.beam.add(q1, q2);
    this.beam.renderOrder = 8;
    this.beam.visible = false;
    scene.add(this.beam);

    // Hover ring: a gold circle on the ground under the grab target.
    const rc = document.createElement('canvas');
    rc.width = rc.height = 128;
    const rg = rc.getContext('2d')!;
    const grad = rg.createRadialGradient(64, 64, 34, 64, 64, 62);
    grad.addColorStop(0, 'rgba(255,255,255,0)');
    grad.addColorStop(0.55, "rgba(255,255,255,1)");
    grad.addColorStop(0.7, 'rgba(255,255,255,0.35)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    rg.fillStyle = grad;
    rg.fillRect(0, 0, 128, 128);
    this.ringMat = mk(tex(rc), false); // normal blending so the gold reads on bright grass
    this.ringMat.color.copy(GOLD);
    const rgeo = new THREE.PlaneGeometry(1, 1, 14, 14); // draped on the terrain each frame, so it never sinks into a slope
    rgeo.rotateX(-Math.PI / 2);
    this.ring = new THREE.Mesh(rgeo, this.ringMat);
    this.ring.renderOrder = 6;
    this.ring.visible = false;
    scene.add(this.ring);
  }

  /** Meshes that must stay out of the AO pre-pass. */
  get aoIgnore(): THREE.Object3D[] {
    return [this.decal, this.arcs, this.glow, this.arcGlow, this.beam, this.ring];
  }

  update(
    terrain: Terrain,
    dt: number,
    time: number,
    camDist: number,
    ground: THREE.Vector3 | null,
    held: { x: number; y: number; z: number } | null,
    blocked: boolean,
    hover: { x: number; z: number; radius: number } | null,
  ) {
    // Sigil + beam
    const on = !!held && !!ground;
    this.fade += ((on ? 1 : 0) - this.fade) * damp(14, dt);
    this.bad += ((blocked ? 1 : 0) - this.bad) * damp(12, dt);
    const show = this.fade > 0.01 && !!ground;
    this.decal.visible = this.arcs.visible = this.glow.visible = this.arcGlow.visible = show;
    this.beam.visible = show && this.bad < 0.9;
    if (show && ground) {
      const size = clamp(camDist * 0.34, 8, 48);
      const gx = ground.x;
      const gz = ground.z;
      for (let i = 0; i < this.pos.count; i++) {
        const ux = (i % (GRID + 1)) / GRID - 0.5;
        const uz = Math.floor(i / (GRID + 1)) / GRID - 0.5;
        const x = gx + ux * size;
        const z = gz + uz * size;
        this.pos.setXYZ(i, x, terrain.surfaceAt(x, z) + 0.12 + camDist * 0.0012, z);
      }
      this.pos.needsUpdate = true;
      const pulse = 0.82 + 0.18 * Math.sin(time * 3);
      this.col.copy(GOLD).lerp(BAD, this.bad);
      const k = this.fade * (1 - 0.5 * this.bad) * pulse;
      this.baseMat.color.copy(this.col);
      this.baseMat.opacity = this.arcMat.opacity = this.fade * (0.95 - 0.25 * this.bad);
      this.arcMat.color.copy(this.col);
      this.glowMat.color.copy(this.col).multiplyScalar(k * 0.55);
      this.arcGlowMat.color.copy(this.col).multiplyScalar(k * 0.55);
      this.arcTurn = time * 0.35; // arcs turn slowly
      this.arcMat.map!.rotation = this.arcGlowMat.map!.rotation = this.arcTurn;
      if (this.beam.visible && held) {
        const h = Math.max(1, held.y - this.pos.getY(Math.floor(this.pos.count / 2)));
        const w = clamp(camDist * 0.012, 0.35, 1.6);
        this.beam.position.set(gx, this.pos.getY(Math.floor(this.pos.count / 2)), gz);
        this.beam.scale.set(w * 3, h, w * 3);
        this.beamMat.color.copy(GOLD).multiplyScalar(this.fade * (0.8 + 0.2 * Math.sin(time * 5)) * (1 - this.bad));
      }
    }

    // Hover ring
    this.ringFade += ((hover ? 1 : 0) - this.ringFade) * damp(16, dt);
    if (hover) {
      this.ringAt.set(hover.x, 0, hover.z);
      this.ringR = hover.radius;
    }
    const rs = this.ringFade > 0.02;
    this.ring.visible = rs;
    if (rs) {
      const d = Math.max(this.ringR * 2.8, 4 + camDist * 0.1) * (1 + 0.06 * Math.sin(time * 4.5));
      const rp = this.ring.geometry.getAttribute('position') as THREE.BufferAttribute;
      const lift = 0.15 + camDist * 0.0012;
      for (let i = 0; i < rp.count; i++) {
        const x = this.ringAt.x + (i % 15) / 14 * d - d / 2;
        const z = this.ringAt.z + Math.floor(i / 15) / 14 * d - d / 2;
        rp.setXYZ(i, x, terrain.surfaceAt(x, z) + lift, z);
      }
      rp.needsUpdate = true;
      this.ring.frustumCulled = false;
      // Outside your influence the ring dims toward red, like the sigil (this replaces the old "Outside your influence" tooltip).
      this.ringMat.color.copy(GOLD).lerp(BAD, this.bad * 0.8);
      this.ringMat.opacity = this.ringFade * (0.8 + 0.2 * Math.sin(time * 4.5));
    }
  }
}
