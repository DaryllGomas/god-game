import { Game } from './Game';
import { loadAssets } from './assets';
import { preload as preloadCloud } from './cloud/Cloud';
import { filmCamera, isFirstVisit, playIntro } from './intro/Intro';

// A first visit opens on the intro (on black). The game is built behind it once the film is playing,
// renders underneath the film, which dissolves into the live island; the camera then glides to the title view.
let gameReady = () => {};
const ready = new Promise<void>((r) => (gameReady = r));
let introStarted = () => {};
const started = new Promise<void>((r) => (introStarted = r));
const cam = filmCamera(() => (window as unknown as { game?: Game }).game);
const first = isFirstVisit();
if (first) {
  void playIntro({
    ready,
    waitForTouch: true,
    unlockAudio: () => (window as unknown as { game?: Game }).game?.audio.unlock(),
    holdAudio: (on) => (window as unknown as { game?: Game }).game?.audio.holdForFilm(on),
    gameMuted: () => !!(window as unknown as { game?: Game }).game?.audio.muted,
    started: () => introStarted(),
    land: cam.land,
    glide: cam.glide,
  });
} else introStarted();

// Load models first (the golem), then start. Missing models fall back to code-built art.
// Models first (the golem), plus a quick look at the cloud copy of the island (skipped without an island code).
// On a first visit, also wait for the intro to get going so building the island doesn't stall its first frames.
Promise.all([loadAssets(), preloadCloud(), started]).then(() => {
  const container = document.getElementById('app')!;
  const game = new Game(container);
  // Handy for debugging from the console.
  (window as unknown as { game: Game }).game = game;
  if (first) cam.land(); // a first visit: the camera waits at the landing pose behind the film
  gameReady();
});
