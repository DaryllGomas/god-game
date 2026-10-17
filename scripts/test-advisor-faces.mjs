// Lumi's and Fizz's painted faces (2026-10-16), on the render box: `npm run build && atlas-run dist scripts/test-advisor-faces.mjs <out>`.
// Says one line per face (Lumi talking, cheering, peeking and hurt; Fizz smirking, cackling, scheming and peeking), shoots the top of the screen, and checks each
// card shows the right portrait, loaded. Writes PNGs and report.json.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--autoplay-policy=no-user-gesture-required'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { failures: [], faces: {} };
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
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => {
  for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
});
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
await p.waitForFunction(() => game.pace.confirmed, null, { timeout: 60000 });
await wait(3000);
const LINES = [
  ['lumi-speak', 'spirit', 'Full tummies make full hearts.', 'lumi-speak'],
  ['lumi-cheer', 'spirit', 'Look at them dance!', 'lumi-cheer'],
  ['lumi-peek', 'spirit', 'Something stirs out there. But that is a story for another day.', 'lumi-peek'],
  ['lumi-hurt', 'spirit', 'Oh no. Please be gentler with them.', 'lumi-hurt'],
  ['fizz-speak', 'imp', 'Pointy. I approve.', 'fizz-smirk'],
  ['fizz-cackle', 'imp', 'Ha! Splat. ...I mean, how dreadful.', 'fizz-cackle'],
  ['fizz-scheme', 'imp', 'You know, from up here they look very... throwable.', 'fizz-scheme'],
  ['fizz-peek', 'imp', '...Hold on. Is anyone else feeling a draught from the east? Across the sea?', 'fizz-peek'],
];
for (const [name, who, text, want] of LINES) {
  await p.evaluate(() => game.rival.ui.advisors.finish?.());
  await wait(800);
  await p.evaluate(([who, text]) => game.rival.ui.advisors.say({ who, text }, { pri: 'important', cooldown: 0 }), [who, text]);
  await p.waitForFunction(() => document.querySelector('.adv-card.show .adv-face img')?.complete, null, { timeout: 20000 }).catch(() => {});
  await wait(1200);
  const got = await p.evaluate(() => {
    const img = document.querySelector('.adv-card.show .adv-face img');
    return img && { src: img.currentSrc || img.src, w: img.naturalWidth, face: img.closest('.adv-card').dataset.face, text: document.querySelector('.adv-card.show .adv-text')?.textContent };
  });
  report.faces[name] = got;
  if (!got || !got.src.includes(`/advisors/${want}-`) || !got.w) report.failures.push(`${name}: wanted ${want}, got ${JSON.stringify(got)}`);
  await p.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 420, y: 0, width: 760, height: 200 } });
}
report.errors = errors;
await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ failures: report.failures, errors: errors.length }, null, 1));
await browser.close();
