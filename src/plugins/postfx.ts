import type * as THREE from 'three';
import type { Game, GamePlugin } from '../Game';
import { PostFX, type FxQuality } from '../world/PostFX';

const TIERS: FxQuality[] = ['high', 'medium', 'low'];
const SLOW_MS = 22; // sustained average frame time (~45 fps) that triggers a quality drop
const SLOW_FRAMES = 120;

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

  let on = true;
  let last = performance.now();
  let slowTime = 0;
  let slowCount = 0;

  const apply = () => {
    game.renderOverride = on ? () => fx.render(0.016) : null;
  };
  apply();

  window.addEventListener('keydown', (e) => {
    if (e.code !== 'KeyK' || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (e.shiftKey) {
      fx.setQuality(TIERS[(TIERS.indexOf(fx.quality) + 1) % TIERS.length]);
      on = true;
      game.message(`Visual effects quality: ${fx.quality}`, 'info', 'postfx');
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

      // Auto fallback: if frames are consistently slow, drop a tier (never climbs back by itself).
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
          console.info(`postfx: average frame ${avg.toFixed(1)} ms, quality lowered to ${fx.quality}`);
        }
      }
    },
    resize(w, h) {
      fx.resize(w, h);
    },
  };
}
