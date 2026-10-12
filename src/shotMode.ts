import type { Game } from './Game';

/**
 * Screenshot mode for the render box (`atlas-shot`), debug only: `?shot=default|close|mid|far[&stage=0..3]`.
 * Skips the intro, hides every overlay, puts the camera on a fixed pose over the home village and lets the
 * world settle, so a plain URL renders a repeatable frame. Has no effect without the `shot` parameter.
 */
const q = new URLSearchParams(location.search);
export const SHOT = q.get('shot');
const POSES: Record<string, { distance: number; pitch: number }> = {
  default: { distance: 130, pitch: 0.85 },
  close: { distance: 70, pitch: 0.62 },
  mid: { distance: 240, pitch: 0.7 },
  far: { distance: 420, pitch: 0.62 },
};

if (SHOT) {
  try {
    localStorage.setItem('godgame.intro.v1', '1');
  } catch {
    /* ignore */
  }
}

export function applyShot(game: Game) {
  if (!SHOT) return;
  const pose = POSES[SHOT] ?? POSES.default;
  const style = document.createElement('style');
  style.textContent = 'body > *:not(#app), #app > *:not(canvas) { visibility: hidden !important; }';
  document.head.appendChild(style);
  const stage = q.get('stage');
  const g = game as unknown as { shrines?: { setStage?: (which: number, n: number) => void }; godCam: { target: { x: number; z: number }; setPose?: (p: object, instant: boolean) => void } };
  if (stage != null) g.shrines?.setStage?.(0, Number(stage)); // village 0 = home
  const t = g.godCam.target;
  g.godCam.setPose?.({ x: t.x, z: t.z, distance: pose.distance, pitch: pose.pitch, yaw: 0.5 }, true);
}
