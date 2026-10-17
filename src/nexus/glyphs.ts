import * as THREE from 'three';

/**
 * The seven marks, one carved into each stone of the Nexus (after "Stage 8 - The Nexus", panel 1: "Seven worlds.
 * Seven marks. Different paths. One destination."). Every mark shares the star axis (a vertical line with a
 * four-pointed star) and adds its own figure: the arch of the path, the open circle, the chevron, the river, the
 * orbit, the crescent and the rings. Drawn once per mark to a canvas; white on clear, tinted by the material.
 */
export const MARK_COUNT = 7;

type Draw = (g: CanvasRenderingContext2D, S: number) => void;

const star = (g: CanvasRenderingContext2D, x: number, y: number, r: number) => {
  const w = r * 0.22;
  g.beginPath();
  g.moveTo(x, y - r);
  g.quadraticCurveTo(x, y, x + w, y);
  g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - w, y);
  g.quadraticCurveTo(x, y, x, y - r);
  g.moveTo(x - r * 0.7, y);
  g.quadraticCurveTo(x, y, x, y - w);
  g.quadraticCurveTo(x, y, x + r * 0.7, y);
  g.quadraticCurveTo(x, y, x, y + w);
  g.quadraticCurveTo(x, y, x - r * 0.7, y);
  g.fill();
};

const axis = (g: CanvasRenderingContext2D, S: number, top = 0.08, bottom = 0.92) => {
  g.beginPath();
  g.moveTo(S / 2, S * top);
  g.lineTo(S / 2, S * bottom);
  g.stroke();
};

const dots = (g: CanvasRenderingContext2D, pts: [number, number][], r: number) => {
  for (const [x, y] of pts) {
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
  }
};

const MARKS: Draw[] = [
  // 1. The path: an arch with steps of light up the axis.
  (g, S) => {
    axis(g, S, 0.1, 0.62);
    g.beginPath();
    g.arc(S / 2, S * 0.72, S * 0.3, Math.PI * 1.05, Math.PI * 1.95);
    g.stroke();
    g.beginPath();
    g.moveTo(S * 0.28, S * 0.9);
    g.lineTo(S / 2, S * 0.6);
    g.lineTo(S * 0.72, S * 0.9);
    g.stroke();
    dots(g, [[S / 2, S * 0.2], [S / 2, S * 0.3], [S / 2, S * 0.4]], S * 0.025);
    star(g, S / 2, S * 0.52, S * 0.09);
  },
  // 2. The open circle: a ring broken at its foot, the axis through it.
  (g, S) => {
    axis(g, S);
    g.beginPath();
    g.arc(S / 2, S * 0.46, S * 0.3, Math.PI * 0.62, Math.PI * 2.38);
    g.stroke();
    g.beginPath();
    g.arc(S / 2, S * 0.46, S * 0.2, Math.PI * 1.2, Math.PI * 1.8);
    g.stroke();
    star(g, S / 2, S * 0.46, S * 0.12);
  },
  // 3. The chevron: two wings rising to a point, an inner arc like a bow.
  (g, S) => {
    axis(g, S, 0.06, 0.94);
    g.beginPath();
    g.moveTo(S * 0.18, S * 0.86);
    g.lineTo(S / 2, S * 0.3);
    g.lineTo(S * 0.82, S * 0.86);
    g.stroke();
    g.beginPath();
    g.arc(S / 2, S * 0.92, S * 0.22, Math.PI * 1.15, Math.PI * 1.85);
    g.stroke();
    dots(g, [[S * 0.18, S * 0.86], [S * 0.82, S * 0.86]], S * 0.03);
    star(g, S / 2, S * 0.3, S * 0.1);
  },
  // 4. The river: three waves flowing beneath the star.
  (g, S) => {
    axis(g, S, 0.08, 0.46);
    for (const [y, w] of [[0.56, 0.36], [0.69, 0.3], [0.82, 0.22]] as [number, number][]) {
      g.beginPath();
      g.moveTo(S * (0.5 - w), S * y);
      g.bezierCurveTo(S * (0.5 - w / 2), S * (y - 0.07), S * 0.5, S * (y + 0.07), S * 0.5, S * y);
      g.bezierCurveTo(S * 0.5, S * (y - 0.07), S * (0.5 + w / 2), S * (y + 0.07), S * (0.5 + w), S * y);
      g.stroke();
    }
    star(g, S / 2, S * 0.32, S * 0.11);
  },
  // 5. The orbit: an ellipse round a world, the axis through both.
  (g, S) => {
    axis(g, S);
    g.beginPath();
    g.ellipse(S / 2, S / 2, S * 0.36, S * 0.14, -0.12, 0, Math.PI * 2);
    g.stroke();
    g.beginPath();
    g.arc(S / 2, S / 2, S * 0.12, 0, Math.PI * 2);
    g.stroke();
    dots(g, [[S * 0.16, S * 0.53]], S * 0.035);
    star(g, S / 2, S / 2, S * 0.08);
  },
  // 6. The crescent: a moon cut by two crossing lines.
  (g, S) => {
    axis(g, S, 0.08, 0.6);
    g.beginPath();
    g.arc(S / 2, S * 0.66, S * 0.26, Math.PI * 0.95, Math.PI * 2.05);
    g.stroke();
    g.beginPath();
    g.moveTo(S * 0.28, S * 0.92);
    g.lineTo(S * 0.66, S * 0.42);
    g.moveTo(S * 0.72, S * 0.92);
    g.lineTo(S * 0.34, S * 0.42);
    g.stroke();
    star(g, S / 2, S * 0.2, S * 0.1);
  },
  // 7. The rings: three circles, one inside the other.
  (g, S) => {
    axis(g, S);
    for (const r of [0.33, 0.23, 0.13]) {
      g.beginPath();
      g.arc(S / 2, S / 2, S * r, 0, Math.PI * 2);
      g.stroke();
    }
    star(g, S / 2, S / 2, S * 0.07);
  },
];

const cache = new Map<string, THREE.CanvasTexture>();

/** Mark `i` (0..6) as a texture: white strokes on clear. `soft` adds a blur for the glow layer. */
export function markTexture(i: number, soft = false): THREE.CanvasTexture {
  const key = `${i}:${soft}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d')!;
  g.strokeStyle = '#fff';
  g.fillStyle = '#fff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = soft ? 14 : 9;
  if (soft) g.filter = 'blur(6px)';
  MARKS[i % MARKS.length](g, S);
  if (soft) {
    // A second, crisp pass on top so the glow has a bright core.
    g.filter = 'none';
    g.lineWidth = 6;
    MARKS[i % MARKS.length](g, S);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  cache.set(key, tex);
  return tex;
}
