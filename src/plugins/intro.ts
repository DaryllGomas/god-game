import type { Game, GamePlugin } from '../Game';
import { playIntro } from '../intro/Intro';

/** "Watch the intro" on the ? screen: plays it full screen over the game, then fades back to the screen. */
export function install(game: Game): GamePlugin {
  const card = game.hud.root.querySelector('.overlay.help .overlay-card');
  if (card) {
    const link = document.createElement('button');
    link.className = 'intro-link';
    link.textContent = '▶ Watch the intro';
    let playing = false;
    link.onclick = () => {
      if (playing) return;
      playing = true;
      void playIntro({ unlockAudio: () => game.audio.unlock() }).then(() => (playing = false));
    };
    card.appendChild(link);
  }
  return { name: 'intro' };
}
