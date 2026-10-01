import { defineConfig } from 'vite';

export default defineConfig({
  // Relative asset paths, so the same build works at a site root (a custom subdomain)
  // and under a sub-path such as daryllgomas.github.io/god-game/.
  base: './',
  build: {
    // Three.js plus the game is ~1.1 MB; one chunk is fine for a game.
    chunkSizeWarningLimit: 1500,
  },
});
