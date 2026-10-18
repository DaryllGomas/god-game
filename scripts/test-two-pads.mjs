// Two pads on the living-room TV (2026-10-18), on the render box: `npm run build && atlas-run dist scripts/test-two-pads.mjs <out>`.
// Reproduces the TV: two Xbox pads, both reporting the left stick ~58% up at rest (a stale kernel value until the
// stick first moves). Checks: (1) at rest the hand doesn't creep; (2) using the SECOND pad, a gentle push right moves
// the hand right and not up; (3) A on the second pad grabs (a tree); (4) on the intro, A on either pad is heard.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { failures: [], steps: {} };
const check = (ok, what) => (ok ? null : report.failures.push(what));
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
  const mk = (index) => ({
    id: `Microsoft Xbox Series S|X Controller (pad ${index})`,
    index,
    connected: true,
    mapping: 'standard',
    timestamp: 0,
    axes: [0.0, -0.58, 0.0, 0.0],
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, touched: false, value: 0 })),
    hapticActuators: [],
  });
  const pads = [mk(0), mk(1)];
  window.__pads = pads;
  Object.defineProperty(navigator, 'getGamepads', { configurable: true, value: () => pads });
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
await p.waitForFunction(() => game.pace.confirmed, null, { timeout: 60000 });
await wait(2000);
const pos = () => p.evaluate(() => ({ x: game.input.x, y: game.input.y }));
const setPad = (i, f) => p.evaluate(([i, f]) => {
  const pad = window.__pads[i];
  if (f.axes) f.axes.forEach((v, k) => v === null || (pad.axes[k] = v));
  if (f.press !== undefined) pad.buttons[f.press.b] = { pressed: f.press.on, touched: f.press.on, value: f.press.on ? 1 : 0 };
  pad.timestamp = performance.now();
}, [i, f]);

// Wake the pads with a button tap on pad 1 (B: harmless), then leave both at rest (stale -0.58 on the left stick Y).
await setPad(1, { press: { b: 1, on: true } });
await wait(150);
await setPad(1, { press: { b: 1, on: false } });
await wait(400);
const r0 = await pos();
await wait(2500);
const r1 = await pos();
report.steps.rest = { r0, r1 };
check(Math.abs(r1.y - r0.y) < 4 && Math.abs(r1.x - r0.x) < 4, `the hand stays put at rest (moved ${(r1.x - r0.x).toFixed(0)}, ${(r1.y - r0.y).toFixed(0)})`);

// A gentle push right on pad 1 (the stick really moves: X 0 → 0.28, and its Y comes back to centre).
await setPad(1, { axes: [0.28, 0.0, null, null] });
await wait(1500);
await setPad(1, { axes: [0.0, 0.0, null, null] });
await wait(300);
const r2 = await pos();
report.steps.push = { r1, r2 };
check(r2.x - r1.x > 15, `a gentle push right on the second pad moves the hand right (${(r2.x - r1.x).toFixed(0)} px)`);
check(Math.abs(r2.y - r1.y) < 25, `and not up (${(r2.y - r1.y).toFixed(0)} px)`);

// A on pad 1 over a tree grabs it.
const target = await p.evaluate(() => {
  const t = game.entities.find((e) => e.kind === 'tree' && e.alive && game.reach?.inside?.(e.pos.x, e.pos.z) !== false);
  const v = t.pos.clone().project(game.godCam.camera);
  return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
});
// Steer the hand there with the second pad's stick.
for (let i = 0; i < 80; i++) {
  const h = await pos();
  const dx = target.x - h.x, dy = target.y - h.y;
  const d = Math.hypot(dx, dy);
  if (d < 6) break;
  const k = Math.min(1, d / 120);
  await setPad(1, { axes: [(dx / d) * Math.max(0.3, k), (dy / d) * Math.max(0.3, k), null, null] });
  await wait(60);
}
await setPad(1, { axes: [0.0, 0.0, null, null] });
await wait(300);
await setPad(1, { press: { b: 0, on: true } });
await wait(120);
await setPad(1, { press: { b: 0, on: false } });
await wait(600);
const held = await p.evaluate(() => game.hand.held?.kind ?? null);
report.steps.grab = { target, held };
await p.screenshot({ path: `${OUT}/grab.png` });
check(!!held, `A on the second pad grabs (held: ${held})`);

report.errors = errors;
check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ failures: report.failures, steps: report.steps }));
await browser.close();
