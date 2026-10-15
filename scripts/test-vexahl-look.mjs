// His citadel's look and where it sits (2026-10-15), on the render box:
// `npm run build && atlas-run dist scripts/test-vexahl-look.mjs <out>`.
// Free play (no glances): the rising, then his citadel from the fixed view at day and dusk, at the rising and in his
// final form, plus the overview the intro lands on and the view the game starts on. Same shots before and after a
// restyle, for side-by-sides. Writes PNGs and report.json to the out dir.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const SIZE = { width: 1600, height: 900 };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--autoplay-policy=no-user-gesture-required'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const ctx = await browser.newContext({ viewport: SIZE });
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
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=free`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => {
  for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
});
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
await p.evaluate(() => game.audio.setMuted(true));
await p.waitForFunction(() => game.pace.group.visible || game.pace.confirmed, null, { timeout: 60000 });
await p.evaluate(() => game.pace.choose('stay'));
await wait(3000);
const startPose = await p.evaluate(() => {
  game.input.inside = false;
  return game.godCam.getPose();
});
const shot = (name) => p.screenshot({ path: `${OUT}/${name}.png` });
const at = (hour) => p.evaluate((h) => (game.dayTime = h), hour);
const fixed = () =>
  p.evaluate(() => {
    const r = game.rival;
    game.godCam.setPose(r.shotPose(r.maxTier), true, game.terrain);
  });
const overview = () => p.evaluate(() => game.godCam.setPose({ x: 0, z: 0, distance: 420, pitch: 0.62, yaw: 0.5 }, true, game.terrain));
const start = () => p.evaluate((pose) => game.godCam.setPose(pose, true, game.terrain), startPose);
const raise = (v, s) => p.evaluate(([v, s]) => game.shrines.setStage(v, s, true), [v, s]);
const report = {};
const isle = () => p.evaluate(() => {
  const g = game.rival.isle.group;
  const v = g.position.clone().project(game.godCam.camera);
  return { x: Math.round(g.position.x), z: Math.round(g.position.z), dist: Math.round(Math.hypot(g.position.x, g.position.z)), scale: +g.scale.x.toFixed(3), screen: { x: +v.x.toFixed(2), y: +v.y.toFixed(2) }, tier: game.rival.state().tier };
});

async function set(label) {
  for (const [h, tag] of [[0.42, 'day'], [0.74, 'dusk']]) {
    await at(h);
    await fixed();
    await wait(1600);
    await shot(`${label}-fixed-${tag}`);
  }
  await at(0.42);
  await overview();
  await wait(1600);
  await shot(`${label}-overview`);
  report[`${label}-overview`] = await isle();
  await at(0.74);
  await wait(1200);
  await shot(`${label}-overview-dusk`);
  await at(0.42);
  await start();
  await wait(1600);
  await shot(`${label}-start-view`);
  report[`${label}-start`] = await isle();
}

await raise('Ashford', 'stone_circle');
await raise('Ashford', 'pyramid');
await wait(16000);
await set('A-risen');
for (const [v, s] of [['Brambleholt', 'stone_circle'], ['Stonemere', 'stone_circle'], ['Brambleholt', 'pyramid'], ['Ashford', 'temple'], ['Stonemere', 'pyramid'], ['Brambleholt', 'temple'], ['Stonemere', 'temple']]) {
  await raise(v, s);
  await wait(300);
}
await wait(40000);
await set('B-final');
report.errors = errors;
await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify(report, null, 1));
await browser.close();
