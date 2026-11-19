// Controller follow-ups from the 2026-11-18 couch playtest. A fake pad (?padtest) only; no mouse.
//   1. A on the middle of a prayer card (an SVG glyph) presses the card, as the edge of the card does.
//   2. Holding A on the golem and rubbing strokes it; X on it slaps it. (The game is paused so it stands still.)
//   3. Unplugging the pad with A held on the land, or LT held, lets go: no button left down, no drag left on.
// Run: npm run build && atlas-run dist scripts/test-pad-couch.mjs <out>
import { chromium } from 'playwright-core';
const OUT = process.env.OUT_DIR;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const errors = [];
const res = {};
const shot = (p, n) => p.screenshot({ path: `${OUT}/${n}.png` });
const set = (p, o) => p.evaluate((o) => { const f = window.__fakePad; if (o.axes) o.axes.forEach((v, i) => (f.axes[i] = v)); if (o.btn) for (const [k, v] of Object.entries(o.btn)) { f.buttons[k].pressed = !!v; f.buttons[k].value = v ? 1 : 0; } }, o);
const tap = async (p, b, ms = 120) => { await set(p, { btn: { [b]: 1 } }); await p.waitForTimeout(ms); await set(p, { btn: { [b]: 0 } }); await p.waitForTimeout(150); };
const hand = (p) => p.evaluate(() => ({ x: game.input.x, y: game.input.y }));
async function moveHand(p, tx, ty) {
  for (let i = 0; i < 200; i++) {
    const h = await hand(p);
    const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
    if (d < 5) break;
    const k = Math.min(1, d / 140);
    await set(p, { axes: [(dx / d) * Math.max(0.26, k), (dy / d) * Math.max(0.26, k), 0, 0] });
    await p.waitForTimeout(d < 30 ? 25 : 40);
    if (d < 30) { await set(p, { axes: [0, 0, 0, 0] }); await p.waitForTimeout(30); }
  }
  await set(p, { axes: [0, 0, 0, 0] });
  await p.waitForTimeout(300);
  return hand(p);
}
const pose = (p) => p.evaluate(() => { const q = game.godCam.getPose(); return { x: Math.round(q.x), z: Math.round(q.z) }; });

const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
p.on('pageerror', (e) => errors.push(String(e))); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(() => { try { localStorage.setItem('godgame.intro.v1', '1'); } catch {} });
await p.goto(process.env.SITE_URL + '/index.html?padtest');
await p.waitForFunction(() => window.game);
await p.waitForTimeout(2500);
await set(p, { axes: [0.5, 0, 0, 0] }); await p.waitForTimeout(150); await set(p, { axes: [0, 0, 0, 0] });
await p.waitForTimeout(300);
if (await p.evaluate(() => game.hud.helpOpen)) { await tap(p, 0); await p.waitForTimeout(1200); }
await p.evaluate(() => {
  game.audio.setMuted(true); game.player.addPower(5000);
  window.__c = { stroke: 0, slap: 0 };
  const c = game.creature; const s = c.stroke.bind(c), l = c.slap.bind(c);
  c.stroke = (...a) => { window.__c.stroke++; return s(...a); };
  c.slap = (...a) => { window.__c.slap++; return l(...a); };
});

// ---------------------------------------------------------------- 1. prayer card, middle and edge
{
  await p.evaluate(() => { const v = game.villages.find((v) => v.isHome); game.prayerSystem.spawnNow(v, 'food'); game.prayerSystem.spawnNow(v, 'rain'); });
  await p.waitForTimeout(3000);
  const out = [];
  for (const where of ['middle', 'edge']) {
    await p.evaluate(() => game.godCam.setPose({ x: 0, z: 0, distance: 130, pitch: 0.85, yaw: 0.5 }, true, game.terrain));
    await p.waitForTimeout(700);
    const pt = await p.evaluate((where) => {
      const card = document.querySelector('.pr-card:not(.far)'); if (!card) return null;
      const r = card.getBoundingClientRect();
      const x = r.left + r.width / 2, y = where === 'middle' ? r.top + r.height / 2 : r.top + 6;
      const t = document.elementFromPoint(x, y);
      return { x, y, under: `${t?.tagName}${t instanceof HTMLElement ? '' : ' (not HTML)'}` };
    }, where);
    if (!pt) { out.push({ where, error: 'no card' }); continue; }
    await moveHand(p, pt.x, pt.y);
    const p0 = await pose(p);
    await tap(p, 0); await p.waitForTimeout(1800);
    const p1 = await pose(p);
    out.push({ where, under: pt.under, cameraFlew: Math.hypot(p1.x - p0.x, p1.z - p0.z) > 10, p0, p1 });
  }
  await shot(p, '01-prayer-card');
  res.prayer_card = out;
  res.prayer_card_pass = out.length === 2 && out.every((o) => o.cameraFlew);
}

// ---------------------------------------------------------------- 2. golem: stroke and slap with the game paused
{
  await p.evaluate(() => { const c = game.creature; game.godCam.setPose({ x: c.pos.x, z: c.pos.z, distance: 45, pitch: 0.85, yaw: 0.5 }, true, game.terrain); });
  await p.waitForTimeout(1500);
  await tap(p, 13); await p.waitForTimeout(400); // D-pad down = pause
  res.paused = await p.evaluate(() => game.paused ?? game.speed === 0);
  // find a spot on screen where the hand is over the golem
  const spots = await p.evaluate(() => {
    const c = game.creature, cam = game.godCam.camera, out = [];
    for (const up of [1.5, 1, 2.2, 0.6, 3]) { const v = c.pos.clone(); v.y += up; v.project(cam); out.push({ x: (v.x + 1) / 2 * innerWidth, y: (1 - v.y) / 2 * innerHeight }); }
    return out;
  });
  let on = null;
  for (const s of spots) {
    await moveHand(p, s.x, s.y);
    if (await p.evaluate(() => game.hoverBuilding?.constructor === game.creature.constructor && !game.hand.hover)) { on = s; break; }
  }
  res.golem_found = !!on;
  if (on) {
    await shot(p, '02-hand-on-golem');
    await set(p, { btn: { 0: 1 } }); await p.waitForTimeout(200);
    res.golem_mode_while_A = await p.evaluate(() => game.controls.mode);
    for (let i = 0; i < 12; i++) { await set(p, { axes: [i % 2 ? 0.7 : -0.7, 0, 0, 0] }); await p.waitForTimeout(160); }
    await set(p, { axes: [0, 0, 0, 0], btn: { 0: 0 } }); await p.waitForTimeout(300);
    res.strokes = await p.evaluate(() => window.__c.stroke);
    await moveHand(p, on.x, on.y);
    const stillOn = await p.evaluate(() => game.hoverBuilding?.constructor === game.creature.constructor);
    await tap(p, 2, 80); await p.waitForTimeout(400);
    res.slap_X = { handOnGolem: stillOn, slaps: await p.evaluate(() => window.__c.slap) };
  }
  res.golem_pass = !!on && res.strokes >= 1 && res.slap_X?.slaps >= 1;
  await tap(p, 13); await p.waitForTimeout(400); // unpause
}

// ---------------------------------------------------------------- 3. unplug with A held on the land, and with LT held
{
  await p.evaluate(() => { const h = game.villages.find((v) => v.isHome); game.godCam.setPose({ x: h.center.x + 40, z: h.center.z + 40, distance: 90, pitch: 0.85, yaw: 0.5 }, true, game.terrain); });
  await p.waitForTimeout(1200);
  // bare land: nothing under the hand, so holding A drags the land
  for (const [x, y] of [[800, 600], [700, 500], [900, 450], [600, 650], [1000, 650], [500, 400], [1100, 400]]) {
    await moveHand(p, x, y);
    if (await p.evaluate(() => !game.hand.hover && !game.hoverBuilding)) break;
  }
  await set(p, { btn: { 0: 1 } }); await p.waitForTimeout(300);
  const holding = await p.evaluate(() => ({ mode: game.controls.mode, buttons: [...game.input.buttons] }));
  await p.evaluate(() => { window.__fakePad.connected = false; window.__fakePad.buttons[0].pressed = false; });
  await p.waitForTimeout(600);
  const unplugged = await p.evaluate(() => ({ mode: game.controls.mode, buttons: [...game.input.buttons] }));
  const p0 = await pose(p);
  await p.evaluate(() => { window.__fakePad.connected = true; });
  await p.waitForTimeout(800);
  const back = await p.evaluate(() => ({ mode: game.controls.mode, buttons: [...game.input.buttons], held: game.hand.held?.kind ?? null }));
  const p1 = await pose(p);
  res.unplug_A = { holding, unplugged, back, cameraMovedOnReplug: Math.hypot(p1.x - p0.x, p1.z - p0.z) > 2 };

  await set(p, { btn: { 6: 1 } }); await p.waitForTimeout(300);
  const lt = await p.evaluate(() => ({ mode: game.controls.mode, buttons: [...game.input.buttons] }));
  await p.evaluate(() => { window.__fakePad.connected = false; window.__fakePad.buttons[6].pressed = false; });
  await p.waitForTimeout(600);
  const ltGone = await p.evaluate(() => ({ mode: game.controls.mode, buttons: [...game.input.buttons] }));
  await p.evaluate(() => { window.__fakePad.connected = true; });
  await p.waitForTimeout(500);
  res.unplug_LT = { lt, ltGone };
  // and the pad still works afterwards: move the hand
  const h0 = await hand(p); await set(p, { axes: [0.6, 0, 0, 0] }); await p.waitForTimeout(300); await set(p, { axes: [0, 0, 0, 0] }); await p.waitForTimeout(200);
  const h1 = await hand(p);
  res.pad_works_after = h1.x - h0.x > 20;
  res.unplug_pass = holding.buttons.includes(0) && unplugged.buttons.length === 0 && unplugged.mode === 'none' && back.buttons.length === 0
    && !res.unplug_A.cameraMovedOnReplug && lt.buttons.includes(2) && ltGone.buttons.length === 0 && ltGone.mode === 'none' && res.pad_works_after;
}

res.errors = errors;
res.ALL = res.prayer_card_pass && res.golem_pass && res.unplug_pass && errors.length === 0 ? 'ALL PASSED' : 'FAILED';
console.log(JSON.stringify(res, null, 2));
await browser.close();
