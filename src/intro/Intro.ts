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
/** The film dissolves into the live island over this long (ms; matches --dissolve in intro.css). */
const DISSOLVE = 1800;
/** On a skip, the dissolve is quick (ms). */
const DISSOLVE_SKIP = 600;
/** The dissolve starts this long before the film's end (s): its last frames are the held painting of the island. */
const DISSOLVE_LEAD = 2.0;
/** After the dissolve the camera glides down to the start view over this long (ms). */
const GLIDE = 4000;
/** The pose the painting at the end of the film was made from (measured from the live game). */
const LANDING = { x: 0, z: 0, distance: 420, pitch: 0.62, yaw: 0.5 };

/** The point of light fades out over this long when touched (ms; matches .intro-light in intro.css). */
const LIGHT_OUT = 600;

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
  /** Put the game camera at the landing pose (idempotent; may be called before the game exists, then does nothing). */
  land?: () => void;
  /** Glide the game camera from the landing pose to the start view over `ms`. */
  glide?: (ms: number) => void;
}

/**
 * Camera hooks for the film's landing: `land` remembers the camera's current (start) pose and puts it at the
 * landing pose; `glide` eases it back. `getGame` may return undefined until the game has been built.
 */
export function filmCamera(getGame: () => Game | undefined): Required<Pick<IntroOptions, 'land' | 'glide'>> {
  let start: ReturnType<Game['godCam']['getPose']> | null = null;
  return {
    land() {
      const game = getGame();
      if (!game || start) return;
      start = game.godCam.getPose();
      game.godCam.setPose(LANDING, true, game.terrain);
    },
    glide(ms) {
      const game = getGame();
      if (game && start) game.godCam.glideTo(start, ms / 1000);
    },
  };
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
  // A nudge for someone who just looks (Daryll, 2026-10-15: "it's just a little blinking dot ... some sort of cool,
  // subtle nudge in case somebody gets stuck just looking at it"). It wakes to the cursor at once; then, if nobody
  // touches it: ripples (4 s), motes of light drifting in to it (9 s), and only at last a whisper (16 s).
  const nudges: number[] = [];
  let onNear: ((e: PointerEvent) => void) | null = null;
  if (waiting) {
    const light = document.createElement('div');
    light.className = 'intro-light';
    root.classList.add('waiting');
    const motes = document.createElement('div');
    motes.className = 'intro-motes';
    for (let i = 0; i < 14; i++) {
      const m = document.createElement('i');
      const a = (i / 14) * Math.PI * 2 + Math.random() * 0.4;
      const d = 46 + Math.random() * 18; // vmax from the light
      m.style.setProperty('--x', `${Math.cos(a) * d}vmax`);
      m.style.setProperty('--y', `${Math.sin(a) * d}vmax`);
      m.style.setProperty('--t', `${5.5 + Math.random() * 3}s`);
      m.style.setProperty('--d', `${-Math.random() * 8}s`);
      motes.append(m);
    }
    const whisper = document.createElement('div');
    whisper.className = 'intro-whisper';
    whisper.textContent = 'touch the light';
    root.append(motes, light, whisper);
    nudges.push(
      window.setTimeout(() => root.classList.add('nudge-ripple'), 4000),
      window.setTimeout(() => root.classList.add('nudge-motes'), 9000),
      window.setTimeout(() => root.classList.add('nudge-whisper'), 16000),
    );
    // The light leans into the cursor: brighter and larger as it comes near (0 far .. 1 on it).
    onNear = (e: PointerEvent) => {
      const r = light.getBoundingClientRect();
      const dist = Math.hypot(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2));
      const near = Math.max(0, 1 - dist / Math.max(220, Math.min(innerWidth, innerHeight) * 0.35));
      light.style.setProperty('--near', near.toFixed(3));
    };
    root.addEventListener('pointermove', onNear);
  }
  document.body.appendChild(root);
  // The game behind the film is already at the landing pose; its title screen and HUD wait until the glide is done.
  document.body.classList.add('intro-film');
  opts.land?.();

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
      nudges.forEach((t) => window.clearTimeout(t));
      if (onNear) root.removeEventListener('pointermove', onNear);
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
      window.setTimeout(() => root.querySelectorAll('.intro-light, .intro-motes, .intro-whisper').forEach((el) => el.remove()), LIGHT_OUT + 100);
    };

    const finish = async (skipped: boolean) => {
      if (finishing) return;
      finishing = true;
      begin();
      markSeen();
      window.clearTimeout(skipTimer);
      window.clearTimeout(startTimer);
      root.classList.remove('skippable');
      // The game is built behind the film; wait for it, put it at the landing pose, then dissolve the film away.
      await (opts.ready ?? Promise.resolve()).catch(() => undefined);
      opts.land?.();
      const ms = skipped ? DISSOLVE_SKIP : DISSOLVE;
      root.style.setProperty('--dissolve', `${ms}ms`);
      root.classList.add('dissolving');
      opts.holdAudio?.(false);
      await wait(ms + 100);
      video.pause();
      // The overlay stays (clear, still catching keys and clicks) while the camera glides to the start view.
      opts.glide?.(GLIDE);
      await wait(opts.glide ? GLIDE + 150 : 0);
      window.removeEventListener('keydown', onKey, true);
      const help = document.querySelector('.overlay.help');
      help?.classList.add('intro-reveal');
      document.body.classList.remove('intro-film');
      document.body.classList.add('intro-hud-in');
      root.remove();
      window.setTimeout(() => {
        help?.classList.remove('intro-reveal');
        document.body.classList.remove('intro-hud-in');
      }, 1500);
      resolve();
    };

    // The dissolve starts a little before the end, while the film holds on the painting of the island.
    video.addEventListener('timeupdate', () => {
      if (Number.isFinite(video.duration) && video.duration > DISSOLVE_LEAD && video.currentTime >= video.duration - DISSOLVE_LEAD) {
        void finish(false);
      }
    });
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
