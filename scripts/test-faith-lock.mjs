// The last age locks faith (2026-10-18), on the render box: `npm run build && atlas-run dist scripts/test-faith-lock.mjs <out>`.
// In the last age a neglected village can't be lost (its faith floors at 25); after the true end, staying on the island
// brings the old rules back (a village at zero faith turns away).
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const report = { failures: [] };
const check = (ok, what) => (ok ? null : report.failures.push(what));
const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
await ctx.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k); } catch {} });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove(); });
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
await p.waitForFunction(() => game.pace.confirmed, null, { timeout: 60000 });
report.start = await p.evaluate(() => game.nexus.debug('nexus'));
await p.waitForTimeout(1500);
const starve = () => p.evaluate(() => {
  const v = game.villages.find((x) => !x.isHome && x.owner === 'player');
  v.belief = 0.5;
  for (const h of v.villagers) h.hunger = 1;
  game.advance(20);
  return { name: v.name, owner: v.owner, belief: Math.round(v.belief), phase: game.nexus.phase };
});
report.during = await starve();
check(report.during.owner === 'player' && report.during.belief >= 25, `last age: a starving village stays yours (${JSON.stringify(report.during)})`);
await p.evaluate(() => game.nexus.debug('ring'));
await p.waitForFunction(() => game.nexus.phase === 'city', null, { timeout: 60000 }).catch(() => {});
await p.evaluate(() => game.nexus.debug('end'));
await p.waitForFunction(() => game.nexus.state().end?.card, null, { timeout: 180000 }).catch(() => {});
await p.waitForTimeout(7000);
await p.mouse.click(160, 580);
await p.keyboard.press('Escape');
await p.waitForFunction(() => game.nexus.phase === 'done', null, { timeout: 60000 }).catch(() => {});
report.after = await starve();
check(report.after.phase === 'done' && report.after.owner !== 'player', `after the true end, the old rules: a village at zero faith turns away (${JSON.stringify(report.after)})`);

// A fresh island for the gap Caboose's review found: a village starving during the good ending itself.
await p.reload();
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove(); });
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 }).catch(() => {});
await p.waitForFunction(() => game.pace.confirmed, null, { timeout: 60000 }).catch(() => {});
// The gap Caboose's review found: during the good ending itself (Ready to See), a starving village must stay too.
report.ending = await p.evaluate(() => {
  for (const v of game.villages) if (v.owner !== 'player') v.convert(game);
  game.endings.debug('ready');
  const v = game.villages.find((x) => !x.isHome);
  v.belief = 0.5;
  for (const h of v.villagers) h.hunger = 1;
  game.advance(20);
  return { name: v.name, owner: v.owner, belief: Math.round(v.belief), ending: game.endings.phase };
});
check(report.ending.owner === 'player', `during the ending a starving village stays yours (${JSON.stringify(report.ending)})`);
report.errors = errors; check(!errors.length, `no page errors ${errors.slice(0, 2)}`);
await fs.writeFile(`${process.env.OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
await browser.close();
