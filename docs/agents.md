# Guide for agents working on God Game

Read this first, then `docs/vision.md` (what we're building and why) and `README.md` (controls and code map).

## The project

A Black & White–style god game in the browser: Three.js 0.186 + TypeScript 7 + Vite 8.
- The project lives at `C:\Users\Daryll\Documents\projects\God-Game`.
- The dev server is **already running** at http://localhost:5173 and hot-reloads on save. Don't start another one. If it's down, start it in the background with `npx vite --port 5173 --strictPort`.
- The owner plays it, so keep it working.

**Design pillars** (from the vision):
- Calm and beautiful first.
- Every act leaves a visible mark.
- Stakes without stress: things are telegraphed and losses can be recovered.

Sound must stay harmonious: one key and chord progression, soft envelopes (see `src/audio/Audio.ts`).

## How to add a feature: plugins

Put your feature in **its own file(s)** and load it as a plugin. Any `src/plugins/<name>.ts` that exports `install(game)` is loaded automatically at startup:

```ts
import type { Game, GamePlugin } from '../Game';   // `import type` only: avoid circular imports

export function install(game: Game): GamePlugin {
  game.events.on('gift', ({ village, kind, amount }) => { /* react */ });
  return {
    name: 'my-feature',
    update(dt) { /* simulation step: scaled by game speed, skipped while paused */ },
    frame(realDt) { /* every rendered frame: UI, visuals */ },
    resize(w, h) {},
  };
}
```

Put supporting modules in your own folder, e.g. `src/prayers/`.

### Hooks you can use without editing shared files

- **`game.events`**: typed world events, all listed in `src/systems/Events.ts`:
  - `gift`, `miracle`, `rainedOn`, `fireOut`
  - `grab`, `place`, `throw`, `landed`
  - `villagerBorn`, `villagerDied`, `villagerJoined`
  - `houseBuilt`, `houseDestroyed`, `fieldHarvested`
  - `villageConverted`, `villageLost`
  - `creatureAte`, `creatureTaught`
  - `newDay`
  - `seasonChanged`, `weather`
  - `projectStarted`, `projectCompleted`, `wonderUnlocked`, `wonderCompleted`
  - `rivalArrived`, `schemeStarted`, `schemeFoiled`, `villageTurned`, `rivalRetreated`
  - If you need a new event, add it to `GameEvents` and emit it at the source with a one-line edit.
- **`game.modifiers`**: `{ cropGrowth, treeGrowth, villagerHunger, fireSpread }` multipliers (1 = normal), already applied by fields, trees, villagers and fire.
  - **The seasons plugin rewrites all four every simulation step.** Multiply into them after it runs, or apply your effect per village; never just assign them.
- **Feature systems:**
  - `game.prayerSystem`: `spawnNow`, `active`, `advisors.say`.
  - `game.projectSystem`: `startNow`, `cheatFill`.
  - `game.seasons`: `jumpTo`, `trigger`, `state`.
  - `game.rival`: `arriveNow`, `trigger`, `state`.
  - `game.saves`: `save()`.
- **Save and load:** a plugin with state that must survive a reload returns `save(): unknown` and `load(data)` from `install()`. The data goes into the versioned save (`src/systems/Save.ts`). Keep it small and JSON-safe.
- **`game.renderOverride = (scene, camera) => ...`**: take over the final render (post-processing).
- **UI:**
  - Append DOM to `game.hud.root`. Style it with your own CSS file imported from your plugin, reusing the variables in `src/ui/hud.css` (`--panel`, `--gold`, `--serif`...).
  - `game.message(text, tone, key?)` posts to the message feed; `game.floatText(x, y, z, text, color)` puts floating text in the world.
- **World access:**
  - Collections: `game.villages`, `game.entities`.
  - Lookups: `game.nearest(kind, x, z, maxDist, filter)`, `game.forEachNear`, `game.villageAt(x, z)`, `game.storeNear`.
  - Adding and removing: `game.add(entity)`, `game.remove(entity)`.
  - Terrain: `game.terrain.heightAt(x, z)`.
  - Lookups by kind: `game.terrain`, `game.sky` (`daylight`, `isNight`), `game.dayTime` (0..1), `game.day`, `game.time`, `game.player` (`power`, `alignment`), `game.creature` (the golem), `game.hand`, `game.godCam`, `game.fx` (particles), `game.audio`.
- **Sound:** prefer the existing `game.audio` methods (`chime`, `grab`, `thud`, `fanfare`, ...). New sounds go in **new methods at the end of the `Audio` class**, built from the current chord and pentatonic helpers so they stay in key.

## Working alongside other agents

Several agents work in this repo at the same time. It is **not** under git, so a clobbered file is lost.
- **Edit only the files your brief says you own**, plus new files you create.
- If you truly must touch a shared file (`Game.ts`, `HUD.ts`, `Controls.ts`, `config.ts`, `Village.ts`, `Villager.ts`, `Buildings.ts`, `Nature.ts`, `Audio.ts`, ...):
  - Make the **smallest possible edit** with the Edit tool. Never rewrite the whole file, never reformat, never revert anything you didn't write.
  - List the edit in your final report.
- Don't run code formatters across the repo, and don't add npm dependencies unless your brief allows it. **Free tools only**; no paid services or API keys.

## Code style

Match the surrounding code: 2-space indent, single quotes, semicolons, `readonly` where sensible, short doc comments explaining *why*. Keep tuning numbers as named constants at the top of your module.

## Verify your work

1. **Typecheck** (must pass): `npx tsc --noEmit -p .`. Also run `npx vite build` and then delete `dist/`.
2. **In the browser** (claude-in-chrome tools).
   - **The owner's rule: ONE tab only.** Never call `tabs_create_mcp` and never close the game tab. Call `tabs_context_mcp`, find the existing tab at `http://localhost:5173/`, and navigate or reload *that* tab. Other agents share it, so reload before each test sequence. If no such tab exists, report it instead of opening one.
   - The tab runs **hidden** in a background window, so:
   - Wait about 3 seconds after navigating for models to load (`window.game` appears).
   - `game.hud.toggleHelp(false)` closes the title screen.
   - `game.advance(seconds)` runs the simulation synchronously. `requestAnimationFrame` does **not** fire in hidden tabs.
   - To render or simulate input, pump frames synchronously:
     `const pump = n => { for (let i = 0; i < n; i++) { const t = performance.now(); while (performance.now() - t < 16) {} game.frame(); } };`
     Don't `await` rAF or long timeouts; they time out.
   - Synthetic `PointerEvent`s dispatched on `game.renderer.domElement` drive the controls.
   - Screenshots capture the last rendered frame. The page is about 2550 px wide but screenshots are scaled to about 1568 px, so convert coordinates.
   - Real clicks only reach the hidden tab if you take a screenshot first.
   - Audio plays through the owner's speakers. Call `game.audio.setMuted(true)` before any sound-triggering tests.
   - Check the console for errors. Leave the shared tab open, and never open another.
3. **Blender** (only if your brief says so): the Blender MCP add-on is connected, and only one agent may use Blender at a time.
   - Viewport screenshots come back black; render with Eevee to a PNG and view that.
   - Generate models from a script saved in `blender/` (see `blender/build_golem.py` for the pattern: build, render previews, export GLB to `public/models/`, save the `.blend`).

## Changelog

Add a line for your change under `## [Unreleased]` in `CHANGELOG.md`, in plain words a player would understand. Use the sections Added, Changed or Fixed.

## Your final report

Keep it short:
- What you built.
- Files created and edited, with **shared-file edits called out**.
- How to try it in-game.
- Test results.
- Known issues or tuning knobs.
