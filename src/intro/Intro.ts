import type { Game } from '../Game';
import { SAVE_KEY } from '../systems/Save';
import { getLink } from '../cloud/Cloud';
import './intro.css';

// ------------------------------------------------------------- tuning knobs

/** Set once the intro has played (or been skipped) in this browser. */
export const INTRO_SEEN_KEY = 'godgame.intro.v1';
/** The web copy of the intro (H.264, 1280×720, silent). Relative to the build, so it works under a sub-path. */
const SRC = `${import.meta.env.BASE_URL}intro/intro.mp4`;
/** If the video hasn't started this long after we asked it to, carry on to the title (slow network, autoplay refused). */
const START_TIMEOUT = 9000;
/** The "skip" pill stays this long after the last click or key (ms). */
const SKIP_SHOW = 3500;
/** On a skip, the picture fades to black first (ms). */
const TO_BLACK = 700;
/** A held beat of black before the world fades up (ms). */
const HOLD_BLACK = 500;
/** The point of light fades out over this long when touched (ms; matches .intro-light in intro.css). */
const LIGHT_OUT = 600;
/** The fade up from black into the title screen (ms; matches .intro's transition in intro.css). */
const REVEAL = 2400;

/** A first visit: no island saved here, no island code, and the intro not seen before. */
export function isFirstVisit(): boolean {
  try {
    return !localStorage.getItem(INTRO_SEEN_KEY) && !localStorage.getItem(SAVE_KEY) && !getLink();
  } catch {
    // Storage blocked: we couldn't remember having shown it, so don't show it on every visit.
    return false;
  }
}

function markSeen() {
  try {
    localStorage.setItem(INTRO_SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

const wait = (ms: number) => new Promise<void>((r) => window.setTimeout(r, ms));

export interface IntroOptions {
  /** Holds the black until the game behind it has been built (the first visit builds it while the video plays). */
  ready?: Promise<unknown>;
  /** Called on the first click or key (the overlay keeps keys from the game, and its own unlock with them). */
  unlockAudio?: () => void;
  /** Wait on a point of light for a click or key (the gesture browsers need before they allow sound), then play with sound. */
  waitForTouch?: boolean;
  /** True silences the game's own sound while the film plays (called with each unlock, and false at the reveal). */
  holdAudio?: (on: boolean) => void;
  /** Whether the player has muted the game: then the film plays muted too. */
  gameMuted?: () => boolean;
  /** The film is under way (or has given up): heavy work can start without stalling its first frames. */
  started?: () => void;
  /** Just before the world fades up from black. */
  uncover?: () => void;
}

/**
 * While the intro covers the screen the game behind it needn't draw: two frames to warm up its shaders, then
 * the loop rests until the reveal (so a slow machine spends itself on the film). Returns the resume function.
 */
export function restBehind(game: Game): () => void {
  const r = game.renderer;
  const frame = () => (game as unknown as { frame(): void }).frame();
  let n = 0;
  r.setAnimationLoop(() => {
    frame();
    if (++n >= 2) r.setAnimationLoop(null);
  });
  return () => r.setAnimationLoop(frame);
}

/**
 * The intro, full screen, before the title: it starts on black, plays, ends on black, and then the game
 * fades up from black into the title screen. A click or key shows a small "skip"; a second one skips.
 * Resolves once the overlay is gone.
 */
export function playIntro(opts: IntroOptions = {}): Promise<void> {
  const root = document.createElement('div');
  root.className = 'intro';
  const video = document.createElement('video');
  video.className = 'intro-video';
  video.muted = true; // until the gesture; see start()
  video.playsInline = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.setAttribute('aria-label', 'THE FIRST WORLD: the intro');
  video.src = SRC;
  const skip = document.createElement('button');
  skip.className = 'intro-skip';
  skip.textContent = 'skip';
  const waiting = !!opts.waitForTouch;
  root.append(video, skip);
  if (waiting) {
    const light = document.createElement('div');
    light.className = 'intro-light';
    root.classList.add('waiting');
    root.append(light);
  }
  document.body.appendChild(root);

  return new Promise<void>((resolve) => {
    let finishing = false;
    let skipTimer = 0;
    let startTimer = 0;
    let begun = false;
    const begin = () => {
      if (begun) return;
      begun = true;
      opts.started?.();
    };
    video.addEventListener('playing', begin);

    const hushAndUnlock = () => {
      opts.holdAudio?.(true);
      opts.unlockAudio?.();
    };
    const onKey = (e: KeyboardEvent) => {
      // The game must not see keys while the intro plays (H, Space and the number keys all do things).
      e.stopImmediatePropagation();
      e.preventDefault();
      if (e.repeat) return;
      if (root.classList.contains('waiting')) {
        // Modifiers and Escape aren't gestures to the browser; the light keeps waiting. Any other key touches it.
        if (!/^(Shift|Control|Alt|Meta|AltGraph|CapsLock|Escape|Tab)$/.test(e.key)) start();
        return;
      }
      hushAndUnlock();
      if (e.key === 'Escape' || root.classList.contains('skippable')) void finish(true);
      else showSkip();
    };
    const onPointer = (e: PointerEvent) => {
      e.stopPropagation();
      // The touch that wakes the light is not also the first press toward a skip.
      if (root.classList.contains('waiting')) {
        start();
        return;
      }
      hushAndUnlock();
      if (e.target === skip || root.classList.contains('skippable')) void finish(true);
      else showSkip();
    };
    const showSkip = () => {
      root.classList.add('skippable');
      window.clearTimeout(skipTimer);
      skipTimer = window.setTimeout(() => root.classList.remove('skippable'), SKIP_SHOW);
    };
    window.addEventListener('keydown', onKey, true);
    root.addEventListener('pointerdown', onPointer);

    /** The gesture: the light fades, and the film starts with its sound. */
    let go = false;
    const start = () => {
      if (go) return;
      go = true;
      root.classList.remove('waiting');
      root.classList.add('touched');
      hushAndUnlock();
      const muted = !!opts.gameMuted?.();
      video.volume = 1;
      video.muted = muted;
      startTimer = window.setTimeout(() => {
        if (video.currentTime < 0.05) void finish(false);
      }, START_TIMEOUT);
      const fail = (err: unknown) => {
        // Interrupted (the page is unloading, say): not a reason to call it seen. The start timeout covers a stall.
        if ((err as { name?: string })?.name === 'AbortError') return;
        console.warn('The intro could not play; going straight to the title.', err);
        void finish(false);
      };
      video.play().catch((err: unknown) => {
        if (muted || (err as { name?: string })?.name === 'AbortError') return fail(err);
        console.warn('The intro could not play with sound; playing it muted.', err);
        video.muted = true;
        video.play().catch(fail);
      });
      window.setTimeout(() => root.querySelector('.intro-light')?.remove(), LIGHT_OUT + 100);
    };

    const finish = async (skipped: boolean) => {
      if (finishing) return;
      finishing = true;
      begin();
      markSeen();
      window.clearTimeout(skipTimer);
      window.clearTimeout(startTimer);
      root.classList.remove('skippable');
      root.classList.add('ending');
      if (skipped) await wait(TO_BLACK);
      video.pause();
      await wait(HOLD_BLACK);
      await (opts.ready ?? Promise.resolve()).catch(() => undefined);
      window.removeEventListener('keydown', onKey, true);
      opts.uncover?.();
      opts.holdAudio?.(false);
      // The world fades up from black, and the title card rises a beat later (see intro.css).
      const help = document.querySelector('.overlay.help');
      help?.classList.add('intro-reveal');
      root.classList.add('reveal');
      await wait(REVEAL);
      root.remove();
      window.setTimeout(() => help?.classList.remove('intro-reveal'), 1500);
      resolve();
    };

    video.addEventListener('ended', () => void finish(false));
    video.addEventListener('error', () => {
      console.warn('The intro could not load; going straight to the title.', video.error);
      void finish(false);
    });
    if (waiting) return; // the light waits for a touch; start() does the rest
    // "Watch again" comes from a click, so sound is allowed straight away.
    start();
  });
}
