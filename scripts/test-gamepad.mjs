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

// ------------------------------------------------------------------ part 1: first visit, intro and title
{
  const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
  p.on('pageerror', (e) => errors.push('p1 ' + e)); p.on('console', (m) => { if (m.type() === 'error') errors.push('p1 ' + m.text()); });
  await p.goto(process.env.SITE_URL + '/index.html?padtest');
  await p.waitForTimeout(2500);
  res.intro_flag = await p.evaluate(() => window.__nativeGamepad === true);
  await shot(p, '01-intro-light');
  await tap(p, 0); // A touches the light
  await p.waitForTimeout(2500);
  res.intro_playing = await p.evaluate(() => !!document.querySelector('.intro') && !document.querySelector('.intro.waiting'));
  await shot(p, '02-intro-playing');
  await tap(p, 1); await p.waitForTimeout(300); // B = Escape: skip
  await p.waitForTimeout(8000);
  res.intro_gone = await p.evaluate(() => !document.querySelector('.intro'));
  await shot(p, '03-title');
  res.title_focus = await p.evaluate(() => document.activeElement?.className ?? null);
  await tap(p, 0); // A on Begin
  await p.waitForTimeout(800);
  res.title_closed = await p.evaluate(() => game.hud.helpOpen === false);
  await p.close();
}

// ------------------------------------------------------------------ part 2: play
const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(() => { try { localStorage.setItem('godgame.intro.v1', '1'); } catch {} });
await p.goto(process.env.SITE_URL + '/index.html?padtest');
await p.waitForFunction(() => window.game);
await p.waitForTimeout(2000);
await set(p, { axes: [0.5, 0, 0, 0] }); await p.waitForTimeout(150); await set(p, { axes: [0, 0, 0, 0] }); // wakes the pad
await p.waitForTimeout(300);
res.flag = await p.evaluate(() => window.__nativeGamepad === true);
res.title_pad_help = await p.evaluate(() => getComputedStyle(document.querySelector('.pad-only')).display);
await shot(p, '04-title-with-pad');
await tap(p, 0); await p.waitForTimeout(1200); // Begin
res.began = await p.evaluate(() => !game.hud.helpOpen);
await p.evaluate(() => { game.audio.setMuted(true); game.player.addPower(5000); });
await p.waitForTimeout(1200);

// frame a tree and a rock that stand close together, so the move is easy to see
await p.evaluate(() => {
  const g = game; let best = null;
  for (const t of g.entities) { if (t.kind !== 'tree' || !t.grabbable || !g.inInfluence(t.pos.x, t.pos.z)) continue;
    for (const r of g.entities) { if (r.kind !== 'rock' || !r.grabbable || !g.inInfluence(r.pos.x, r.pos.z)) continue;
      const d = Math.hypot(t.pos.x - r.pos.x, t.pos.z - r.pos.z); if (d > 12 && (!best || d < best.d)) best = { d, x: (t.pos.x + r.pos.x) / 2, z: (t.pos.z + r.pos.z) / 2 }; } }
  if (best) g.godCam.setPose({ x: best.x, z: best.z, distance: 48, pitch: 0.75, yaw: 0.5 }, true, g.terrain);
});
await p.waitForTimeout(1500);
const rocks = await screenOf(p, 'rock'); const trees = await screenOf(p, 'tree');
res.counts = { rocks: rocks.length, trees: trees.length };
// choose the tree and rock that are farthest apart on screen but both visible
let pair = null;
for (const t of trees) for (const r of rocks) { const d = Math.hypot(t.x - r.x, t.y - r.y); if (d > 40 && (!pair || d > pair.d)) pair = { t, r, d }; }
if (!pair) { res.error = 'no tree/rock pair on screen'; }
else {
  const { t, r } = pair;
  const st = (id) => p.evaluate((id) => { const e = game.entities.find((x) => x.id === id); return { x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1), held: !!e.held, alive: e.alive }; }, id);
  res.tree_before = await st(t.id); res.rock = await st(r.id);
  const h0 = await moveHand(p, t.x, t.y);
  await shot(p, '10-hand-on-tree');
  res.hover_tree = await p.evaluate(() => game.hand.hover?.kind ?? null);
  await tap(p, 0); await p.waitForTimeout(300); // A: grab
  res.held_after_A = await p.evaluate(() => game.hand.held?.kind ?? null);
  await shot(p, '11-tree-in-hand');
  await moveHand(p, r.bx, r.by);
  await shot(p, '12-hand-over-rock');
  await tap(p, 0); await p.waitForTimeout(1800); // A: place
  res.held_after_place = await p.evaluate(() => game.hand.held?.kind ?? null);
  res.tree_after = await st(t.id);
  res.tree_to_rock = +Math.hypot(res.tree_after.x - res.rock.x, res.tree_after.z - res.rock.z).toFixed(1);
  res.tree_moved = +Math.hypot(res.tree_after.x - res.tree_before.x, res.tree_after.z - res.tree_before.z).toFixed(1);
  await shot(p, '13-tree-placed-on-rock');
  await moveHand(p, 800, 120); await p.waitForTimeout(600);
  await shot(p, '13b-hand-moved-away');

  // hold-and-release: grab a second tree holding A, move, release to set down
  const t2 = (await screenOf(p, 'tree')).find((q) => q.id !== t.id);
  if (t2) {
    await moveHand(p, t2.x, t2.y);
    await set(p, { btn: { 0: 1 } }); await p.waitForTimeout(150);
    const heldDuring = await p.evaluate(() => game.hand.held?.kind ?? null);
    await moveHand(p, t2.x + 150, t2.y + 40);
    await p.waitForTimeout(500);
    await set(p, { btn: { 0: 0 } }); await p.waitForTimeout(1200);
    res.hold_release = { heldDuring, heldAfter: await p.evaluate(() => game.hand.held?.kind ?? null), moved: (await st(t2.id)) };
  }
  // B puts back
  const t3 = (await screenOf(p, 'tree')).find((q) => q.id !== t.id);
  if (t3) {
    const before = await st(t3.id);
    await moveHand(p, t3.x, t3.y); await tap(p, 0); await moveHand(p, t3.x + 200, t3.y + 80);
    res.b_heldBefore = await p.evaluate(() => game.hand.held?.kind ?? null);
    await tap(p, 1); await p.waitForTimeout(1500);
    const after = await st(t3.id);
    res.b_putback = { heldAfter: await p.evaluate(() => game.hand.held?.kind ?? null), dist: +Math.hypot(after.x - before.x, after.z - before.z).toFixed(1) };
  }
}
// camera and keys
const pose = () => p.evaluate(() => { const c = game.godCam.getPose(); return { x: c.x, z: c.z, d: c.distance, yaw: c.yaw, pitch: c.pitch }; });
const c0 = await pose();
await set(p, { axes: [0, 0, 0.9, 0] }); await p.waitForTimeout(700); await set(p, { axes: [0, 0, 0, 0] }); await p.waitForTimeout(500);
const c1 = await pose();
await set(p, { btn: { 10: 1 } }); await p.waitForTimeout(700); await set(p, { btn: { 10: 0 } }); await p.waitForTimeout(500);
const c2 = await pose();
await set(p, { btn: { 2: 1 }, axes: [0, 0, 0.9, 0] }); await p.waitForTimeout(700); await set(p, { btn: { 2: 0 }, axes: [0, 0, 0, 0] }); await p.waitForTimeout(500);
const c3 = await pose();
res.camera = { pan: +Math.hypot(c1.x - c0.x, c1.z - c0.z).toFixed(1), zoomIn: +(c2.d - c1.d).toFixed(1), orbitYaw: +(c3.yaw - c2.yaw).toFixed(3) };
await tap(p, 14); await p.waitForTimeout(400);
res.food_orb = await p.evaluate(() => game.hand.held?.kind ?? null);
await shot(p, '20-food-miracle-in-hand');
await tap(p, 1); await p.waitForTimeout(300);
res.orb_cancelled = await p.evaluate(() => game.hand.held === null);
await tap(p, 13); await p.waitForTimeout(300);
res.paused = await p.evaluate(() => game.paused); await tap(p, 13);
// HUD press: put the hand over the village list / dock button and press A
await tap(p, 8); await p.waitForTimeout(600);
res.help_open_via_view = await p.evaluate(() => game.hud.helpOpen);
await shot(p, '21-help-pad');
await tap(p, 1); await p.waitForTimeout(500);
res.help_closed_via_B = await p.evaluate(() => !game.hud.helpOpen);
// HUD press: the hand over the Water button, A
{
  const bb = await p.locator('.dock .miracle').first().boundingBox();
  await moveHand(p, bb.x + bb.width / 2, bb.y + bb.height / 2);
  await tap(p, 0); await p.waitForTimeout(500);
  res.hud_press_water = await p.evaluate(() => game.hand.held?.kind ?? null);
  await tap(p, 1); await p.waitForTimeout(300);
}
// help screen: D-pad moves focus, A opens "controls"
await tap(p, 8); await p.waitForTimeout(500);
const f0 = await p.evaluate(() => document.activeElement?.className);
let f1 = '';
for (let i = 0; i < 8 && !/help-toggle/.test(f1); i++) { await tap(p, 13); await p.waitForTimeout(250); f1 = await p.evaluate(() => document.activeElement?.className); }
await tap(p, 0); await p.waitForTimeout(700);
res.help_nav = { f0, f1, controlsOpen: await p.evaluate(() => document.querySelector('.overlay.help').classList.contains('show-controls')) };
await shot(p, '22-help-controls-open');
await tap(p, 1); await p.waitForTimeout(300); await tap(p, 1); await p.waitForTimeout(500);
res.help_closed_after_two_B = await p.evaluate(() => !game.hud.helpOpen);
// the win card: A on "Keep playing"
await p.evaluate(() => game.hud.showWin({ time: '1h', alignment: 'Neutral', followers: 12 }));
await p.waitForTimeout(500); await shot(p, '23-win-card');
await tap(p, 0); await p.waitForTimeout(500);
res.win_closed = await p.evaluate(() => document.querySelector('.overlay.win').classList.contains('hidden'));
// the rival's ring: D-pad left to "Take the ring"? we choose to turn it down with B
let ringAnswer = null;
await p.evaluate(() => { window.__ring = null; game.rival.ui.offer({ text: 'Take it. You have earned it.' }, (took, timedOut) => { window.__ring = { took, timedOut }; }); });
await p.waitForTimeout(1500); await shot(p, '24-ring-card');
await tap(p, 14); await p.waitForTimeout(300);
const ringFocus = await p.evaluate(() => document.activeElement?.className);
await tap(p, 0); await p.waitForTimeout(500);
res.ring = { focusAfterLeft: ringFocus, answer: await p.evaluate(() => window.__ring) };
// guide button is ignored
await set(p, { btn: { 16: 1 } }); await p.waitForTimeout(200); await set(p, { btn: { 16: 0 } });
// mouse hides the hand
res.reticle_before_mouse = await p.evaluate(() => document.querySelector('.pad-reticle').classList.contains('on'));
await p.mouse.move(200, 200); await p.mouse.move(260, 240); await p.waitForTimeout(300);
res.reticle_after_mouse = await p.evaluate(() => document.querySelector('.pad-reticle').classList.contains('on'));
await set(p, { axes: [0.4, 0, 0, 0] }); await p.waitForTimeout(200); await set(p, { axes: [0, 0, 0, 0] });
res.reticle_back = await p.evaluate(() => document.querySelector('.pad-reticle').classList.contains('on'));
res.errors = errors;
await fs.writeFile(`${OUT}/gamepad-results.json`, JSON.stringify(res, null, 2));
console.log(JSON.stringify(res, null, 2));
await browser.close();
