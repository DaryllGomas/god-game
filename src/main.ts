import { Game } from './Game';
import { loadAssets } from './assets';
import { preload as preloadCloud } from './cloud/Cloud';
import { isFirstVisit, playIntro, restBehind } from './intro/Intro';

// A first visit opens on the intro (on black). The game is built behind it once the film is playing,
// rests while covered, and fades up from black into the title screen when it ends.
let gameReady = () => {};
const ready = new Promise<void>((r) => (gameReady = r));
let introStarted = () => {};
const started = new Promise<void>((r) => (introStarted = r));
let covered = false;
let resume: (() => void) | null = null;
if (isFirstVisit()) {
  covered = true;
  void playIntro({
    ready,
    unlockAudio: () => (window as unknown as { game?: Game }).game?.audio.unlock(),
    started: () => introStarted(),
    uncover: () => {
      covered = false;
      resume?.();
    },
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
  if (covered) resume = restBehind(game);
  gameReady();
});
