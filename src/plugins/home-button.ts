import type { Game } from '../Game';

/**
 * A small "home" control next to the speed buttons (2026-10-15 playtest: Space brings the camera home, but nothing
 * on screen said so). It does exactly what Space does. It lives here, not in src/ui, so the HUD itself stays as is.
 */
const ICON =
  '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">' +
  '<path d="M2.5 7.4 8 2.8l5.5 4.6"/><path d="M4 6.3V13h3V9.6h2V13h3V6.3"/></svg>';

export function install(game: Game) {
  const speeds = game.hud.root.querySelector('.speeds');
  if (!speeds) return;
  const b = document.createElement('button');
  b.className = 'speed-btn home-btn';
  b.innerHTML = ICON;
  b.title = 'Home (Space)';
  b.setAttribute('aria-label', 'Home (Space)');
  b.style.display = 'inline-flex';
  b.style.alignItems = 'center';
  b.style.justifyContent = 'center';
  b.onclick = () => {
    game.goHome();
    b.blur();
  };
  // Right after the speed buttons (❚❚ 1× 2× 4×), before sound and music.
  const after = speeds.querySelectorAll('.speed-btn')[3];
  if (after?.nextSibling) speeds.insertBefore(b, after.nextSibling);
  else speeds.appendChild(b);
}
