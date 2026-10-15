// Vexahl rises with you (2026-10-15), on the render box: `npm run build && atlas-run dist scripts/test-vexahl-rise.mjs <out>`.
// Story mode: the default view at the start (no spire), the rising at the first pyramid as a run of frames, his
// citadel at every step from a fixed view (raising ages with the shrines debug hook), the first-temple and last-temple
// glances, and the Ascension running through the final-battle hook. Free play: the same rising, no beat.
// Writes PNGs and report.json to the out dir.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const SIZE = { width: 1600, height: 900 };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--autoplay-policy=no-user-gesture-required'],
});
const report = { story: {}, free: {}, failures: [] };
const check = (ok, what) => {
  if (!ok) report.failures.push(what);
};
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

async function open(query) {
  const ctx = await browser.newContext({ viewport: SIZE });
  await ctx.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.') && !k.includes('freeplay')) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await p.goto(`${process.env.SITE_URL}/index.html?shot=default${query}`);
  await p.waitForFunction(() => window.game, null, { timeout: 120000 });
  await p.evaluate(() => {
    for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
  });
  await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
  await p.evaluate(() => game.audio.setMuted(true));
  // Record what he, Lumi/Fizz and Ora say.
  await p.evaluate(() => {
    const log = (window.__said = []);
    const t0 = performance.now();
    const at = () => Math.round((performance.now() - t0) / 100) / 10;
    const rv = game.rival;
    const rs = rv.ui.say.bind(rv.ui);
    rv.ui.say = (lines, o) => {
      for (const l of Array.isArray(lines) ? lines : [lines]) log.push({ at: at(), who: l.who, text: l.text, delay: o?.delay ?? 0 });
      return rs(lines, o);
    };
    const og = game.ora.guide.bind(game.ora);
    game.ora.guide = (t, o) => {
      log.push({ at: at(), who: 'ora', text: t });
      return og(t, o);
    };
    window.__mark = (what) => log.push({ at: at(), who: 'mark', text: what });
  });
  return { ctx, p, errors };
}

const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });
const state = (p) => p.evaluate(() => ({ ...game.rival.state(), cam: game.godCam.getPose() }));
/** The fixed view of his citadel for the side-by-side: from Ashford's side, low over the water, in late-morning light. */
const fixedView = (p, closer = 1) =>
  p.evaluate((closer) => {
    const r = game.rival;
    const pose = r.shotPose(r.maxTier);
    pose.distance *= closer;
    game.godCam.setPose(pose, true, game.terrain);
    game.dayTime = 0.42;
    game.input.inside = false;
  }, closer);
let startPose = null;
/** The view the game starts on. */
/** The overview the intro lands on (src/intro LANDING). */
const landing = (p) => p.evaluate(() => game.godCam.setPose({ x: 0, z: 0, distance: 420, pitch: 0.62, yaw: 0.5 }, true, game.terrain));
const startView = (p) => p.evaluate((pose) => game.godCam.setPose(pose, true, game.terrain), startPose);
const raise = (p, village, stage) =>
  p.evaluate(([v, s]) => {
    window.__mark(`raise ${v} ${s}`);
    game.shrines.setStage(v, s, true);
    return game.shrines.state();
  }, [village, stage]);

// ------------------------------------------------------------------ story mode
{
  const { ctx, p, errors } = await open('&unlock=story');
  const S = report.story;
  await p.waitForFunction(() => game.pace.confirmed && game.story.active, null, { timeout: 60000 });
  await p.evaluate(() => (game.input.inside = false));
  await wait(4000);
  startPose = await p.evaluate(() => game.godCam.getPose());
  await shot(p, '00-default-view-start');
  await landing(p);
  await wait(1500);
  await shot(p, '00a-overview-start');
  await startView(p);
  S.start = await state(p);
  check(!S.start.risen && S.start.tier === 0, 'story: hidden at the start');
  check((await p.evaluate(() => game.rival.isle.group.visible)) === false, 'story: isle group not visible at the start');
  // Looking straight out to where he lies: nothing there yet.
  await fixedView(p);
  await wait(1500);
  await shot(p, '00b-where-he-lies-start');
  await p.evaluate(() => game.godCam.setPose({ x: -60, z: 60, distance: 330, pitch: 0.85, yaw: 0.5 }, true, game.terrain));

  // Ashford's stones: nothing from him (the old trigger).
  await raise(p, 'Ashford', 'stone_circle');
  await wait(3000);
  S.afterStones = await state(p);
  check(!S.afterStones.risen && S.afterStones.stage === 'dormant', 'story: no rising at the standing stones');
  // Back to the default view, then the first pyramid: the rising.
  await p.evaluate(() => {
    const h = game.villages.find((v) => v.isHome).center;
    game.godCam.setPose({ x: h.x + 40, z: h.z + 60, distance: 300, pitch: 0.85, yaw: 0.5 }, true, game.terrain);
  });
  await wait(1500);
  await raise(p, 'Ashford', 'pyramid');
  const frames = [600, 1800, 3000, 4200, 5400, 6600, 7800, 9000, 10500, 12500, 15000, 20000];
  const t0 = Date.now();
  S.rising = [];
  for (const [i, ms] of frames.entries()) {
    const dt = ms - (Date.now() - t0);
    if (dt > 0) await wait(dt);
    await shot(p, `01-rise-${String(i + 1).padStart(2, '0')}-${(ms / 1000).toFixed(1)}s`);
    S.rising.push({ ms, ...(await p.evaluate(() => ({ r: game.rival.state(), ora: game.ora.state().showing }))) });
  }
  const r1 = S.rising[S.rising.length - 1].r;
  check(r1.risen && r1.stage === 'present' && r1.noticed && r1.tier === 1, `story: risen at the first pyramid (tier ${r1.tier}, stage ${r1.stage})`);
  check(!r1.glancing, 'story: the camera came back after the rising');

  await startView(p);
  await wait(1500);
  await shot(p, '00c-default-view-after-rising');
  await landing(p);
  await wait(1500);
  await shot(p, '00c2-overview-after-rising');
  // Every step after: raise an age, let it grow, shoot the fixed view.
  await fixedView(p);
  await wait(1500);
  await shot(p, 'L1');
  const steps = [
    ['Brambleholt', 'stone_circle'],
    ['Stonemere', 'stone_circle'],
    ['Brambleholt', 'pyramid'],
    ['Ashford', 'temple'], // the first temple: a glance
    ['Stonemere', 'pyramid'],
    ['Brambleholt', 'temple'],
    ['Stonemere', 'temple'], // the last temple: his final form, a glance
  ];
  S.levels = [];
  for (const [v, st] of steps) {
    // From the default-ish view (as a player would be), then the rise.
    await p.evaluate(() => game.godCam.setPose({ x: -60, z: 60, distance: 330, pitch: 0.85, yaw: 0.5 }, true, game.terrain));
    await wait(400);
    await raise(p, v, st);
    await wait(700);
    const s0 = await state(p);
    let tag = `L${s0.tier}`;
    if (s0.glancing) {
      // A big beat: frames of the glance as it plays.
      for (const ms of [1500, 3500, 5500, 8000]) {
        await wait(ms === 1500 ? 800 : ms === 3500 ? 2000 : ms === 5500 ? 2000 : 2500);
        await shot(p, `02-${s0.tier >= s0.maxTier ? 'final' : 'temple'}-glance-${(ms / 1000).toFixed(1)}s`);
      }
      await p.waitForFunction(() => !game.rival.state().glancing, null, { timeout: 30000 });
      await wait(2600);
    } else await wait(5200);
    const s1 = await state(p);
    S.levels.push({ raised: `${v} ${st}`, tier: s1.tier, growth: s1.isleGrowth, glanced: s0.glancing, beats: s1.beats });
    await fixedView(p);
    await wait(1200);
    await shot(p, tag);
  }
  await startView(p);
  await wait(1500);
  await shot(p, '00d-default-view-final-form');
  await landing(p);
  await wait(1500);
  await shot(p, '00d2-overview-final-form');
  const fin = await state(p);
  check(fin.tier === fin.maxTier && fin.beats.includes('final') && fin.beats.includes('temple'), `story: final form (tier ${fin.tier}/${fin.maxTier})`);
  check(S.levels.filter((l) => l.glanced).length === 2, `story: exactly two glances after the rising (${S.levels.filter((l) => l.glanced).length})`);
  // His final form, closer and at dusk.
  await fixedView(p, 0.8);
  await p.evaluate(() => (game.dayTime = 0.74));
  await wait(1500);
  await shot(p, 'L-final-dusk');
  await p.evaluate(() => (game.dayTime = 0.42));
  // The Ascension still plays (through the final-battle hook).
  await p.evaluate(() => game.endings.debug('ready'));
  S.ending = [];
  const e0 = Date.now();
  for (const ms of [3000, 10000, 16000, 22000, 27000]) {
    const d = ms - (Date.now() - e0);
    if (d > 0) await wait(d);
    await shot(p, `03-ascension-${(ms / 1000).toFixed(0)}s`);
    S.ending.push(await p.evaluate(() => ({ phase: game.endings.phase, t: game.endings.ascension?.t })));
  }
  check(S.ending.some((e) => e.phase === 'whole' || (e.t ?? 0) > 15), `story: the Ascension went on into Whole (${JSON.stringify(S.ending)})`);
  S.said = await p.evaluate(() => window.__said);
  S.errors = errors;
  check(errors.length === 0, `story: no console errors (${errors.slice(0, 5).join(' | ')})`);
  await ctx.close();
}

// ------------------------------------------------------------------ free play
{
  const { ctx, p, errors } = await open('&unlock=free');
  const F = report.free;
  await p.waitForFunction(() => game.pace.group.visible || game.pace.confirmed, null, { timeout: 60000 });
  await p.evaluate(() => game.pace.choose('stay'));
  await wait(3000);
  await p.evaluate(() => (game.input.inside = false));
  F.start = await state(p);
  check(!F.start.risen, 'free: hidden at the start');
  await raise(p, 'Ashford', 'stone_circle');
  await raise(p, 'Ashford', 'pyramid');
  await wait(1500);
  const mid = await state(p);
  F.glancedAtRise = mid.glancing;
  check(!mid.glancing, 'free: no glance at the rising');
  await wait(9000);
  F.after = await state(p);
  check(F.after.risen && F.after.tier === 1 && F.after.stage === 'dormant', `free: risen, no beat (stage ${F.after.stage})`);
  await fixedView(p);
  await wait(1200);
  await shot(p, 'free-risen');
  await p.evaluate(() => game.godCam.setPose({ x: -60, z: 60, distance: 330, pitch: 0.85, yaw: 0.5 }, true, game.terrain));
  await raise(p, 'Ashford', 'temple');
  await wait(1200);
  const t = await state(p);
  check(!t.glancing && t.tier === 2, `free: grows without a glance (tier ${t.tier})`);
  F.said = await p.evaluate(() => window.__said);
  F.errors = errors;
  check(errors.length === 0, `free: no console errors (${errors.slice(0, 5).join(' | ')})`);
  await ctx.close();
}

await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ failures: report.failures, levels: report.story.levels, said: report.story.said?.filter((x) => x.who !== 'mark') }, null, 1));
await browser.close();
