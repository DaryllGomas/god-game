// Two mouse buttons at once (2026-10-18, Daryll: after a middle-drag of the camera "I can't even pick up anything",
// can't set down trees, rain or food). Pointer events send one pointerdown for the first button and one pointerup for
// the last; the buttons in between arrive only as pointermove. Each sequence below must leave the controls idle,
// and a grab + set-down must still work after it. `npm run build && atlas-run dist scripts/test-chorded-mouse.mjs <out>`.
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

// Put a rock (or a tree) at the screen centre and return its screen point.
const aim = () => p.evaluate(() => {
  const home = game.villages.find((v) => v.isHome).center;
  const list = game.entities.filter((e) => e.alive && e.grabbable && !e.held && ['rock', 'tree'].includes(e.kind) && Math.hypot(e.pos.x - home.x, e.pos.z - home.z) < 70 && game.inInfluence(e.pos.x, e.pos.z));
  const e = list.find((e) => e.kind === 'rock') ?? list[0];
  game.godCam.setPose({ x: e.pos.x, z: e.pos.z, distance: 90, pitch: 0.9, yaw: 0.5 }, true, game.terrain);
  return e.kind;
});
const center = async () => p.evaluate(() => {
  const list = game.entities.filter((e) => e.alive && e.grabbable && !e.held);
  let best = null, bd = 1e9;
  for (const e of list) {
    const v = e.pos.clone(); v.y += Math.min(e.topHeight * 0.5, 3); v.project(game.godCam.camera);
    const x = (v.x * 0.5 + 0.5) * innerWidth, y = (-v.y * 0.5 + 0.5) * innerHeight;
    const d = Math.hypot(x - innerWidth / 2, y - innerHeight / 2);
    if (d < bd) { bd = d; best = { x, y }; }
  }
  return best;
});
const state = () => p.evaluate(() => ({ mode: game.controls.mode, held: game.hand.held?.kind ?? null, hover: game.hand.hover?.kind ?? null }));

const M = p.mouse;
const SEQ = {
  'middle drag': async () => { await M.down({ button: 'middle' }); await M.move(900, 500, { steps: 8 }); await M.up({ button: 'middle' }); },
  'middle, then left, middle up first': async () => { await M.down({ button: 'middle' }); await M.move(820, 470, { steps: 4 }); await M.down({ button: 'left' }); await M.up({ button: 'middle' }); await M.up({ button: 'left' }); },
  'left, then middle, left up first': async () => { await M.down({ button: 'left' }); await M.move(820, 470, { steps: 4 }); await M.down({ button: 'middle' }); await M.up({ button: 'left' }); await M.up({ button: 'middle' }); },
  'right, then middle, right up first': async () => { await M.down({ button: 'right' }); await M.move(820, 470, { steps: 4 }); await M.down({ button: 'middle' }); await M.up({ button: 'right' }); await M.up({ button: 'middle' }); },
  'holding: right, then middle, right up first': async () => { await M.down({ button: 'right' }); await M.move(820, 470, { steps: 2 }); await M.down({ button: 'middle' }); await M.up({ button: 'right' }); await M.up({ button: 'middle' }); },
  'middle up off the window': async () => { await M.down({ button: 'middle' }); await M.move(1599, 899, { steps: 4 }); await p.evaluate(() => window.dispatchEvent(new Event('blur'))); await M.up({ button: 'middle' }).catch(() => {}); },
};
const results = [];
for (const [name, run] of Object.entries(SEQ)) {
  const kind = await aim();
  await p.waitForTimeout(400);
  let pt = await center();
  await M.move(pt.x, pt.y, { steps: 4 });
  if (name.startsWith('holding')) { await M.click(pt.x, pt.y); await p.waitForTimeout(300); }
  await run();
  await p.waitForTimeout(300);
  const after = await state();
  await p.waitForTimeout(2000); // a throw lands first
  // Then the plain thing: set down what's held, or grab and set down.
  await aim(); await p.waitForTimeout(400);
  pt = await center();
  await M.move(pt.x - 20, pt.y - 10); await M.move(pt.x, pt.y, { steps: 4 }); await p.waitForTimeout(250);
  if (!(await state()).held) { await M.click(pt.x, pt.y); await p.waitForTimeout(300); }
  const grabbed = (await state()).held;
  await M.move(pt.x + 40, pt.y + 30, { steps: 4 }); await M.click(pt.x + 40, pt.y + 30); await p.waitForTimeout(400);
  const placed = !(await state()).held;
  const ok = after.mode === 'none' && !!grabbed && placed;
  results.push({ name, kind, after, grabbed, placed, ok });
  await p.evaluate(() => { const h = game.hand; if (h.held) h.place(game, h.held.pos.clone()); game.controls.mode = 'none'; });
}
const failures = results.filter((r) => !r.ok).map((r) => r.name);
await fs.writeFile(`${process.env.OUT_DIR}/report.json`, JSON.stringify({ results, errors }, null, 2));
console.log(JSON.stringify({ failures, errors: errors.length }));
for (const r of results) console.log(r.ok ? 'ok  ' : 'FAIL', r.name, JSON.stringify(r.after), 'grabbed', r.grabbed, 'placed', r.placed);
await b.close();
