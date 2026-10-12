/** A tiny $1-style unistroke recogniser for the few casting marks. Pure functions, no DOM. */
export type MarkId = 'water' | 'food' | 'fire' | 'tend';
export interface Pt {
  x: number;
  y: number;
}

const N = 48;

function pathLength(p: Pt[]): number {
  let d = 0;
  for (let i = 1; i < p.length; i++) d += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
  return d;
}

function resample(p: Pt[]): Pt[] {
  const total = pathLength(p);
  if (!(total > 1e-6)) return [];
  const step = total / (N - 1);
  const out: Pt[] = [{ ...p[0] }];
  let acc = 0;
  const pts = p.map((q) => ({ ...q }));
  for (let i = 1; i < pts.length; i++) {
    const d = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (d > 0 && acc + d >= step) {
      const t = (step - acc) / d;
      const q = { x: pts[i - 1].x + t * (pts[i].x - pts[i - 1].x), y: pts[i - 1].y + t * (pts[i].y - pts[i - 1].y) };
      out.push(q);
      pts.splice(i, 0, q);
      acc = 0;
    } else acc += d;
  }
  while (out.length < N) out.push({ ...pts[pts.length - 1] });
  return out.slice(0, N);
}

/** Fit to the unit square (no rotation: a wave is a wave drawn across the screen). */
function normalise(p: Pt[]): Pt[] {
  let x0 = Infinity,
    y0 = Infinity,
    x1 = -Infinity,
    y1 = -Infinity;
  for (const q of p) {
    x0 = Math.min(x0, q.x);
    y0 = Math.min(y0, q.y);
    x1 = Math.max(x1, q.x);
    y1 = Math.max(y1, q.y);
  }
  const w = Math.max(x1 - x0, 1e-3);
  const h = Math.max(y1 - y0, 1e-3);
  return p.map((q) => ({ x: (q.x - x0) / w, y: (q.y - y0) / h }));
}

const gen = (f: (t: number) => Pt, steps = 90): Pt[] => Array.from({ length: steps + 1 }, (_, i) => f(i / steps));
const poly = (v: [number, number][]): Pt[] => {
  const out: Pt[] = [];
  for (let i = 1; i < v.length; i++)
    for (let k = 0; k < 20; k++) out.push({ x: v[i - 1][0] + ((v[i][0] - v[i - 1][0]) * k) / 20, y: v[i - 1][1] + ((v[i][1] - v[i - 1][1]) * k) / 20 });
  out.push({ x: v[v.length - 1][0], y: v[v.length - 1][1] });
  return out;
};

interface Template {
  id: MarkId;
  pts: Pt[];
}

const BASE: { id: MarkId; pts: Pt[] }[] = [
  // WATER: a wave, two crests (screen y grows downward).
  { id: 'water', pts: gen((t) => ({ x: t, y: Math.sin(t * Math.PI * 4) })) },
  // FOOD: a spiral winding in (a cornucopia's curl).
  { id: 'food', pts: gen((t) => ({ x: Math.cos(t * Math.PI * 4.2) * (1 - t * 0.85), y: Math.sin(t * Math.PI * 4.2) * (1 - t * 0.85) }), 120) },
  // FIRE: a sharp zigzag, three teeth.
  { id: 'fire', pts: poly([[0, 1], [0.17, 0], [0.34, 1], [0.5, 0], [0.67, 1], [0.83, 0], [1, 1]]) },
  // TEND: a cradle (cup) with a sprout rising from it, one stroke: the bowl, then up to the bud.
  { id: 'tend', pts: [...gen((t) => ({ x: t, y: 0.5 + Math.sin(t * Math.PI) * 0.5 }), 40).map((p) => ({ x: p.x, y: p.y })), ...poly([[1, 0.5], [0.5, -0.25]]).slice(1)] },
];

// Looser variants: a wave of 3 crests, a zigzag of 4 teeth.
BASE.push({ id: 'water', pts: gen((t) => ({ x: t, y: Math.sin(t * Math.PI * 6) })) });
BASE.push({ id: 'fire', pts: poly([[0, 1], [0.125, 0], [0.25, 1], [0.375, 0], [0.5, 1], [0.625, 0], [0.75, 1], [0.875, 0], [1, 1]]) });

const TEMPLATES: Template[] = [];
for (const b of BASE) {
  const fwd = normalise(resample(b.pts));
  TEMPLATES.push({ id: b.id, pts: fwd });
  TEMPLATES.push({ id: b.id, pts: [...fwd].reverse()});
  const mir = normalise(resample(b.pts.map((p) => ({ x: 1 - p.x, y: p.y }))));
  TEMPLATES.push({ id: b.id, pts: mir});
  TEMPLATES.push({ id: b.id, pts: [...mir].reverse()});
  // Waves and spirals read the same upside down.
  const flip = normalise(resample(b.pts.map((p) => ({ x: p.x, y: 1 - p.y }))));
  if (b.id !== 'tend') {
    TEMPLATES.push({ id: b.id, pts: flip});
    TEMPLATES.push({ id: b.id, pts: [...flip].reverse()});
  }
}

/** Best match for a drawn stroke (pixel points), or null when nothing fits well enough. */
export function recognise(stroke: Pt[]): { id: MarkId; score: number } | null {
  const clean = stroke.filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y));
  if (clean.length < 8 || pathLength(clean) < 90) return null;
  const rs = resample(clean);
  if (rs.length < N) return null;
  const cand = normalise(rs);
  let best: { id: MarkId; score: number } | null = null;
  for (const t of TEMPLATES) {
    let d = 0;
    for (let i = 0; i < N; i++) d += Math.hypot(cand[i].x - t.pts[i].x, cand[i].y - t.pts[i].y);
    const score = 1 - d / N / (0.5 * Math.SQRT2);
    if (!best || score > best.score) best = { id: t.id, score };
  }
  return best && best.score >= 0.72 ? best : null;
}
