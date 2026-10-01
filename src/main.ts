import { Game } from './Game';
import { loadAssets } from './assets';

// Load models first (the golem), then start. Missing models fall back to code-built art.
loadAssets().then(() => {
  const container = document.getElementById('app')!;
  const game = new Game(container);
  // Handy for debugging from the console.
  (window as unknown as { game: Game }).game = game;
});
