import { Game } from './Game';
import { loadAssets } from './assets';
import { preload as preloadCloud } from './cloud/Cloud';

// Load models first (the golem), then start. Missing models fall back to code-built art.
// Models first (the golem), plus a quick look at the cloud copy of the island (skipped without an island code).
Promise.all([loadAssets(), preloadCloud()]).then(() => {
  const container = document.getElementById('app')!;
  const game = new Game(container);
  // Handy for debugging from the console.
  (window as unknown as { game: Game }).game = game;
});
