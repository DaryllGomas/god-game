// Vexahl's glances come back (Daryll, 2026-10-17: "when he's done ... we should go back"), on the render box:
// `npm run build && atlas-run dist scripts/test-glance-return.mjs <out>`.
// 1. The rising, with a scripted view (setPose, as a bot's photo does) in the middle: the camera still comes back.
// 2. A glance where the player zooms with the wheel: the view stays with the player.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { failures: [] };
const check = (ok, what) => (ok ? null : report.failures.push(what));
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => {
  for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
});
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
await p.waitForFunction(() => game.pace.confirmed && game.story.active, null, { timeout: 60000 });
await p.evaluate(() => (game.input.inside = false));
await wait(3000);
const home = await p.evaluate(() => {
  const h = game.villages.find((v) => v.isHome).center;
  const pose = { x: h.x + 40, z: h.z + 60, distance: 300, pitch: 0.85, yaw: 0.5 };
  game.godCam.setPose(pose, true, game.terrain);
  return pose;
});
await wait(1000);
const near = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) < 3 && Math.abs(a.distance - b.distance) < 3;

// 1. The rising, with a bot-style photo in the middle of it.
await p.evaluate(() => game.shrines.setStage('Ashford', 'pyramid', true));
await wait(4000);
const out1 = await p.evaluate(() => ({ glancing: game.rival.state().glancing, pose: game.godCam.getPose() }));
check(out1.glancing, 'the rising glanced out to sea');
await p.screenshot({ path: `${OUT}/1a-out-at-sea.png` });
await p.evaluate(() => {
  const pose = game.rival.shotPose(game.rival.maxTier);
  game.godCam.setPose(pose, true, game.terrain);
});
await wait(22000);
const back1 = await p.evaluate(() => ({ glancing: game.rival.state().glancing, pose: game.godCam.getPose() }));
await p.screenshot({ path: `${OUT}/1b-back.png` });
check(!back1.glancing && near(back1.pose, home), `after the rising the camera came back (at ${JSON.stringify(back1.pose)})`);

// 2. A glance (clicking his card's look), and the player zooms meanwhile: the view stays with the player.
await wait(1500);
await p.evaluate(() => game.rival.lookAtScheme());
await wait(1500);
await p.mouse.move(800, 450);
await p.mouse.wheel(0, -300);
await wait(8000);
const out2 = await p.evaluate(() => ({ glancing: game.rival.state().glancing, pose: game.godCam.getPose() }));
await p.screenshot({ path: `${OUT}/2-player-kept.png` });
check(!out2.glancing && !near(out2.pose, home), 'a player who zooms during a glance keeps the view');

report.errors = errors;
await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ failures: report.failures, errors: errors.length }));
await browser.close();
