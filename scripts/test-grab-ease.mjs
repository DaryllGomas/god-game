// How easy it is to grab (2026-10-18), on the render box: `npm run build && atlas-run dist scripts/test-grab-ease.mjs <out>`.
// Clicks near 40 grabbable things (trees, rocks, villagers) inside your light, a little off target (6-34 px, as a real
// hand would be), and counts how many end up in the hand. Prints the rate.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k); } catch {} });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=free`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove(); });
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 }).catch(() => {});
await p.waitForTimeout(4000);
await p.keyboard.press('Escape').catch(() => {});
let ok = 0, tries = 0; const misses = [];
let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (let i = 0; i < 40; i++) {
  const t = await p.evaluate((i) => {
    const home = game.villages.find((v) => v.isHome).center;
    const list = game.entities.filter((e) => e.alive && e.grabbable && !e.held && ['tree', 'rock', 'villager'].includes(e.kind) && Math.hypot(e.pos.x - home.x, e.pos.z - home.z) < 70 && game.inInfluence(e.pos.x, e.pos.z));
    const e = list[(i * 7919) % list.length];
    if (!e) return null;
    game.godCam.setPose({ x: e.pos.x + 10, z: e.pos.z + 30, distance: 120, pitch: 0.85, yaw: 0.5 }, true, game.terrain);
    return { id: e.id ?? i, kind: e.kind };
  }, i);
  if (!t) break;
  await p.waitForTimeout(500);
  const pt = await p.evaluate(() => {
    const list = game.entities.filter((e) => e.alive && e.grabbable && !e.held);
    // The thing nearest the screen centre (where the camera put it).
    let best = null, bd = 1e9;
    for (const e of list) {
      const v = e.pos.clone(); v.y += e.kind === 'tree' ? Math.min(e.topHeight * 0.6, 6) : Math.min(e.topHeight * 0.5, 1.5);
      v.project(game.godCam.camera);
      const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
      const d = Math.hypot(x - innerWidth / 2, y - innerHeight / 2 - 60);
      if (d < bd) { bd = d; best = { x, y, kind: e.kind }; }
    }
    return best;
  });
  if (!pt) continue;
  const a = rnd() * Math.PI * 2, r = 6 + rnd() * 28;
  const cx = pt.x + Math.cos(a) * r, cy = pt.y + Math.sin(a) * r;
  await p.mouse.move(cx - 30, cy - 20);
  await p.mouse.move(cx, cy, { steps: 6 });
  await p.waitForTimeout(250);
  const pre = await p.evaluate(() => ({ hover: game.hand.hover?.kind ?? null, valid: game.hand.valid, blocked: game.hand.blocked, mode: game.controls.mode, held: game.hand.held?.kind ?? null, bld: game.hoverBuilding?.kind ?? null }));
  await p.mouse.click(cx, cy);
  await p.waitForTimeout(400);
  const held = await p.evaluate(() => game.hand.held?.kind ?? null);
  tries++;
  if (held) ok++; else misses.push({ kind: pt.kind, off: Math.round(r), pre });
  await p.evaluate(() => { const h = game.hand; if (h.held) h.place(game, h.held.pos.clone()); });
  await p.waitForTimeout(300);
  await p.keyboard.press('Escape');
  await p.waitForTimeout(200);
}
const report = { tries, ok, rate: tries ? +(ok / tries).toFixed(2) : 0, misses, errors };
await fs.writeFile(`${process.env.OUT_DIR}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ tries, ok, rate: report.rate, misses: misses.length, errors: errors.length }));
await b.close();
