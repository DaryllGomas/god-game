import * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';
import { PostFX, type FxQuality } from '../world/PostFX';
import { LOOK, dofStrength } from '../world/lookKit';

const TIERS: FxQuality[] = ['high', 'medium', 'low'];
const SLOW_MS = 22; // sustained average frame time (~45 fps) that triggers a quality drop
const SLOW_FRAMES = 120;
const SMOOTH_MS = 18.5; // a window this quick (a steady 60 a second or better) counts as smooth
const SMOOTH_WINDOWS = 10; // ...and this many smooth windows in a row (about 20 s) let a lowered tier climb back

/**
 * Post-processing: soft AO, gentle bloom, warm grade + vignette, tone mapping.
 * K toggles it on/off; Shift+K cycles quality (high, medium, low). If the game runs slowly it
 * steps the quality down by itself.
 *
 * Other plugins can keep their meshes out of the AO pre-pass by pushing them onto
 * `game.aoIgnore` (see plugins/grass.ts; plugins load alphabetically, so this one loads after
 * grass and picks them up in `frame`).
 */
export function install(game: Game): GamePlugin {
  const ignore: THREE.Object3D[] = [game.water.mesh, game.sky.group];
  const fx = new PostFX(game.renderer, game.scene, game.godCam.camera, ignore);
  (game as unknown as { postfx: PostFX }).postfx = fx;

  game.renderer.toneMappingExposure = LOOK.exposure;
  const ndc = new THREE.Vector3();
  let on = true;
  let last = performance.now();
  let slowTime = 0;
  let slowCount = 0;
  let lowered = 0; // tiers the game lowered by itself (not the player's Shift+K)
  let smooth = 0; // smooth windows in a row
  let raisedAt = -1e9;
  let holdUntil = 0;

  const apply = () => {
    game.renderOverride = on ? () => {
      // Tilt-shift focus follows the camera's focus point; strength follows its distance.
      const cam = game.godCam;
      ndc.copy(cam.target).project(cam.camera);
      fx.setFocus(ndc.y * 0.5 + 0.5, dofStrength(cam.distance));
      fx.render(0.016);
    } : null;
  };
  apply();

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyK' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.shiftKey) {
      fx.setQuality(TIERS[(TIERS.indexOf(fx.quality) + 1) % TIERS.length]);
      lowered = 0; // the player's own choice stands: nothing to climb back to
      on = true;
      game.message(`Visual effects quality: ${fx.quality}`, 'info', 'postfx-quality');
    } else {
      on = !on;
      game.message(`Visual effects ${on ? 'on' : 'off'} (K)`, 'info', 'postfx');
    }
    apply();
  });

  return {
    name: 'postfx',
    frame() {
      // Pick up meshes other plugins registered for the AO ignore list.
      const extra = (game as unknown as { aoIgnore?: THREE.Object3D[] }).aoIgnore;
      if (extra) for (const o of extra) if (!ignore.includes(o)) ignore.push(o);

      // Auto fallback: if frames are consistently slow, drop a tier. It climbs back, one tier at a time, once the game
      // has run smoothly for a while (it used to stay low for the rest of the session: one heavy minute early on and the
      // picture stayed flat for good, 2026-11-17 soak). A tier that had to be lowered again soon after a climb is left
      // alone for ten minutes, so it never flickers between two looks.
      const now = performance.now();
      const dt = now - last;
      last = now;
      if (!on || document.hidden || dt > 250) return; // hidden tab or long pause: not a real measurement
      slowTime += dt;
      slowCount++;
      if (slowCount >= SLOW_FRAMES) {
        const avg = slowTime / slowCount;
        slowTime = 0;
        slowCount = 0;
        const i = TIERS.indexOf(fx.quality);
        if (avg > SLOW_MS && i < TIERS.length - 1) {
          fx.setQuality(TIERS[i + 1]);
          lowered++;
          smooth = 0;
          if (now - raisedAt < 60000) holdUntil = now + 600000;
          console.info(`postfx: average frame ${avg.toFixed(1)} ms, quality lowered to ${fx.quality}`);
        } else if (avg < SMOOTH_MS) {
          if (++smooth >= SMOOTH_WINDOWS && lowered > 0 && i > 0 && now > holdUntil) {
            fx.setQuality(TIERS[i - 1]);
            lowered--;
            smooth = 0;
            raisedAt = now;
            console.info(`postfx: running smoothly (${avg.toFixed(1)} ms), quality raised to ${fx.quality}`);
          }
        } else smooth = 0;
      }
    },
    resize(w, h) {
      fx.resize(w, h);
    },
  };
}
