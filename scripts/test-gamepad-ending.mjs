// Native gamepad test (2026-10-16). A fake pad (?padtest) is driven from the page; nothing here uses the mouse
// except the last check (mouse movement hides the pad hand).
// Run: npm run build && atlas-run dist scripts/test-gamepad.mjs <out>
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const OUT = process.env.OUT_DIR;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const errors = [];
const res = {};
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const set = (p, o) => p.evaluate((o) => { const f = window.__fakePad; if (o.axes) o.axes.forEach((v, i) => (f.axes[i] = v)); if (o.btn) for (const [k, v] of Object.entries(o.btn)) { f.buttons[k].pressed = !!v; f.buttons[k].value = v ? 1 : 0; } }, o);
const tap = async (p, b, ms = 120) => { await set(p, { btn: { [b]: 1 } }); await p.waitForTimeout(ms); await set(p, { btn: { [b]: 0 } }); await p.waitForTimeout(150); };
const hand = (p) => p.evaluate(() => ({ x: game.input.x, y: game.input.y }));
async function moveHand(p, tx, ty) {
  for (let i = 0; i < 160; i++) {
    const h = await hand(p);
    const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
    if (d < 9) break;
    const k = Math.min(1, d / 140) ;
    await set(p, { axes: [(dx / d) * Math.max(0.3, k), (dy / d) * Math.max(0.3, k), 0, 0] });
    await p.waitForTimeout(40);
  }
  await set(p, { axes: [0, 0, 0, 0] });
  await p.waitForTimeout(350);
  return hand(p);
}
const screenOf = (p, kind, minGap) => p.evaluate(({ kind }) => {
  const g = game, cam = g.godCam.camera, out = [];
  for (const e of g.entities) {
    if (e.kind !== kind || !e.grabbable || e.held || e.airborne || !g.inInfluence(e.pos.x, e.pos.z)) continue;
    const v = e.pos.clone().project(cam); const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    const b = e.pos.clone(); b.y = g.terrain.surfaceAt(e.pos.x, e.pos.z); b.project(cam);
    const bx = (b.x + 1) / 2 * innerWidth, by = (1 - b.y) / 2 * innerHeight;
    if (x > 300 && x < 1300 && y > 160 && y < 720) out.push({ id: e.id, x, y, bx, by });
  }
  return out;
}, { kind });

const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(() => { try { localStorage.setItem('godgame.intro.v1', '1'); } catch {} });
await p.goto(process.env.SITE_URL + '/index.html?padtest');
await p.waitForFunction(() => window.game);
await p.waitForTimeout(2000);
await tap(p, 0); await p.waitForTimeout(1000); // Begin
await p.evaluate(() => { game.audio.setMuted(true); game.endings.debug('whole'); });
let card = false;
for (let i = 0; i < 170 && !card; i++) { await p.waitForTimeout(1000); card = await p.evaluate(() => !!document.querySelector('.endings-card.on')); if (i === 8) await shot(p, '25-ending-running'); }
res.ending_card_shown = card;
res.ending_modal_reticle_hidden = await p.evaluate(() => !document.querySelector('.pad-reticle').classList.contains('on'));
if (card) { await shot(p, '26-end-card'); await p.waitForTimeout(6000); await tap(p, 0); await p.waitForTimeout(4000); res.end_card_closed = await p.evaluate(() => { const c = document.querySelector('.endings-card'); return !c || !c.classList.contains('on') || getComputedStyle(c).opacity === '0'; }); await shot(p, '27-after-end-card'); }
res.errors = errors;
await fs.writeFile(`${OUT}/gamepad-ending-results.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
await browser.close();
