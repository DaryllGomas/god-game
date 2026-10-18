// UX fixes (world), 2026-10-15: hand-full → miracle, deliberate fly-to, wheel cap, home button, Space on a focused
// HUD button, the first "golem ate a villager" line and the panel's "Eating villagers" row.
// Run: npm run build && atlas-run dist scripts/test-ux-world.mjs <out>
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.addInitScript(() => { try { localStorage.setItem('godgame.intro.v1', '1'); } catch {} });
await p.goto(process.env.SITE_URL + '/index.html');
await p.waitForFunction(() => window.game);
await p.waitForTimeout(1500);
await p.getByText('without a name', { exact: false }).first().click({ timeout: 4000 });
await p.mouse.move(800, 500);
await p.waitForTimeout(2500);
const OUT = process.env.OUT_DIR;
const res = {};
const pose = () => p.evaluate(() => { const c = game.godCam.getPose(); return { x: c.x, z: c.z, distance: c.distance, yaw: c.yaw, pitch: c.pitch }; });
const dpose = (a, b) => ({ move: +Math.hypot(a.x - b.x, a.z - b.z).toFixed(2), dDist: +(b.distance - a.distance).toFixed(2), dYaw: +(b.yaw - a.yaw).toFixed(3), dPitch: +(b.pitch - a.pitch).toFixed(3) });
const mv = (x, y, steps = 20) => p.mouse.move(x, y, { steps });
const click = async (x, y) => { await mv(x, y); await p.waitForTimeout(200); await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up(); await p.waitForTimeout(500); };
const onScreen = (kind) => p.evaluate((kind) => {
  const g = game; const cam = g.godCam.camera;
  for (const e of g.entities) {
    if (e.kind !== kind || !e.grabbable || e.held || e.airborne) continue;
    if (!g.inInfluence(e.pos.x, e.pos.z)) continue;
    const v = e.pos.clone().project(cam); const x = (v.x + 1) / 2 * innerWidth, y = (1 - v.y) / 2 * innerHeight;
    if (x > 350 && x < 1250 && y > 200 && y < 700) return { x, y };
  }
  return null;
}, kind);
// keep the rival's camera glance and prayers out of the way of the checks
await p.evaluate(() => { game.player.addPower(5000); });

// ---- 1. Hand full → choose Water: rock set down where the hand is, Water in hand, camera unchanged
{
  const r = await onScreen('rock');
  await click(r.x, r.y);
  await mv(r.x + 60, r.y - 30); await p.waitForTimeout(400);
  const before = await pose();
  const held0 = await p.evaluate(() => game.hand.held?.kind ?? null);
  const water = await p.locator('.dock .miracle').first().boundingBox();
  await click(water.x + water.width / 2, water.y + water.height / 2);
  await mv(r.x + 60, r.y - 30);
  await p.waitForTimeout(900);
  const after = await pose();
  const st = await p.evaluate(() => {
    const rocks = game.entities.filter((e) => e.kind === 'rock' && !e.held);
    return { held: game.hand.held?.kind ?? null, miracle: game.hand.held?.miracle ?? null, rockHeld: game.entities.some((e) => e.kind === 'rock' && e.held), msgs: [...document.querySelectorAll('.messages *, .log *')].slice(-2).map((e) => e.textContent) };
  });
  await p.screenshot({ path: `${OUT}/01-rock-then-water.png` });
  res.handFull = { held0, ...st, camera: dpose(before, after) };
  res.handFull.ok = held0 === 'rock' && st.held === 'orb' && st.miracle === 'water' && !st.rockHeld && res.handFull.camera.move < 0.5 && Math.abs(res.handFull.camera.dDist) < 0.5;
  await p.keyboard.press('Escape'); // refund the orb
  await p.waitForTimeout(300);
}
// ---- 1b. Rock held over the sea (outside the gold), press 1: the rock goes back where it was lifted
{
  const r = await onScreen('rock');
  await click(r.x, r.y);
  const from = await p.evaluate(() => { window.__rock = game.hand.held; return { x: game.hand.pickedFrom.x, z: game.hand.pickedFrom.z }; });
  // move the hand out over the sea (left edge of the view)
  await mv(40, 450); await p.waitForTimeout(500);
  const blocked = await p.evaluate(() => game.hand.blocked || !game.hand.valid);
  await p.keyboard.press('Digit1');
  await p.waitForTimeout(150);
  const st = await p.evaluate((from) => {
    const r = window.__rock;
    return { held: game.hand.held?.kind ?? null, nearestRockToPickup: +Math.hypot(r.pos.x - from.x, r.pos.z - from.z).toFixed(2), anyRockHeld: game.entities.some((e) => e.kind === 'rock' && e.held) };
  }, from);
  res.overSea = { blocked, ...st, ok: st.held === 'orb' && !st.anyRockHeld && st.nearestRockToPickup < 3 };
  // 1c. Setting the orb down out there is still refused, and the hint shows by the hand, not only in the log
  await mv(60, 450); await p.waitForTimeout(300);
  await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up();
  await p.waitForTimeout(350);
  const hint = await p.evaluate(() => [...document.querySelectorAll('.float-text')].map((e) => ({ text: e.textContent, left: e.getBoundingClientRect().left, top: e.getBoundingClientRect().top })).filter((f) => f.text.includes('Throw it')));
  await p.screenshot({ path: `${OUT}/02-refused-hint-by-hand.png` });
  res.hintByHand = { hint, ok: hint.length > 0 && hint[0].left > 0 && hint[0].left < 700 };
  await p.keyboard.press('Escape');
  await mv(800, 500); await p.waitForTimeout(400);
}
// ---- 2. Quick double-click after setting something down: no fly. Deliberate double-click on bare land: flies.
{
  const r = await onScreen('rock');
  await click(r.x, r.y);
  await mv(820, 430); await p.waitForTimeout(300);
  const before = await pose();
  await p.mouse.dblclick(820, 430); // first click sets the rock down, second lands on the same spot
  await p.waitForTimeout(1000);
  const after = await pose();
  res.dblAfterPlace = { ...dpose(before, after), held: await p.evaluate(() => game.hand.held?.kind ?? null) };
  res.dblAfterPlace.ok = res.dblAfterPlace.move < 1 && Math.abs(res.dblAfterPlace.dDist) < 1;
  await p.waitForTimeout(900);
  // deliberate: empty hand, bare land, nothing hovered
  const spot = await p.evaluate(() => {
    for (let y = 300; y < 650; y += 25) for (let x = 500; x < 1100; x += 25) {
      const g = game; const ndc = { x: x / innerWidth * 2 - 1, y: -(y / innerHeight * 2 - 1) };
      return { x: 1000, y: 380 };
    }
  });
  await mv(spot.x, spot.y); await p.waitForTimeout(400);
  const hov = await p.evaluate(() => ({ hover: game.hand.hover?.kind ?? null, b: game.hoverBuilding?.kind ?? null }));
  const b2 = await pose();
  await p.mouse.dblclick(spot.x, spot.y);
  await p.waitForTimeout(1200);
  const a2 = await pose();
  res.dblDeliberate = { hov, ...dpose(b2, a2), ok: dpose(b2, a2).move > 3 && Math.abs(dpose(b2, a2).dDist) < 0.5 };
}
// ---- 2b. A hard wheel flick zooms at most one notch's cap
{
  const before = await pose();
  await p.mouse.wheel(0, 2000);
  await p.waitForTimeout(500);
  const after = await pose();
  res.wheelCap = { ratio: +(after.distance / before.distance).toFixed(3), ok: after.distance / before.distance < 1.4 };
  await p.mouse.wheel(0, -2000); await p.waitForTimeout(400);
}
// ---- 3. Home button = Space
{
  const btn = p.locator('.speeds .home-btn');
  const box = await btn.boundingBox();
  const order = await p.evaluate(() => [...document.querySelectorAll('.speeds button')].map((b) => b.classList.contains('home-btn') ? 'HOME' : b.textContent));
  await p.evaluate(() => game.godCam.setPose({ x: 0, z: 0, distance: 200, pitch: 0.8, yaw: 0.5 }, true, game.terrain));
  await p.waitForTimeout(300);
  await btn.hover(); await p.waitForTimeout(700);
  await p.screenshot({ path: `${OUT}/03-home-button-hover.png`, clip: { x: box.x - 330, y: 0, width: 420, height: 90 } });
  await btn.click();
  await p.waitForTimeout(1200);
  const viaButton = await pose();
  await p.evaluate(() => game.godCam.setPose({ x: 0, z: 0, distance: 200, pitch: 0.8, yaw: 0.5 }, true, game.terrain));
  await mv(800, 500);
  await p.keyboard.press('Space');
  await p.waitForTimeout(1200);
  const viaSpace = await pose();
  const home = await p.evaluate(() => { const h = game.villages.find((v) => v.isHome); return { x: h.center.x, z: h.center.z }; });
  res.home = { order, title: await btn.getAttribute('title'), viaButton: { x: viaButton.x, z: viaButton.z }, viaSpace: { x: viaSpace.x, z: viaSpace.z }, home };
  res.home.ok = Math.hypot(viaButton.x - home.x, viaButton.z - home.z) < 0.5 && Math.hypot(viaSpace.x - home.x, viaSpace.z - home.z) < 0.5 && order.indexOf('HOME') === 4;
  await p.screenshot({ path: `${OUT}/03-home.png` });
}
// ---- 3b. Space after clicking the Water button does not press it again
{
  const water = await p.locator('.dock .miracle').first().boundingBox();
  await click(water.x + water.width / 2, water.y + water.height / 2);
  const held1 = await p.evaluate(() => game.hand.held?.miracle ?? null);
  await p.keyboard.press('Space');
  await p.waitForTimeout(300);
  const held2 = await p.evaluate(() => game.hand.held?.miracle ?? null);
  res.spaceFocus = { afterClick: held1, afterSpace: held2, focused: await p.evaluate(() => document.activeElement?.tagName), ok: held1 === 'water' && held2 === 'water' };
  await p.keyboard.press('Escape');
}
// ---- 4. Golem eats a villager: the first time is always said, even right after other chatter; panel row lights
{
  await p.evaluate(() => {
    const a = game.prayerSystem.advisors;
    a.setMuted(false);
    a.say({ who: 'spirit', text: 'Lovely! A new roof means a happy family.' }, { pri: 'important', cooldown: 0 }); // busy
  });
  const st = await p.evaluate(() => {
    const g = game; const gol = g.creature;
    const v = g.entities.find((e) => e.kind === 'villager' && e.village.isHome && !e.dead);
    const before = gol.opinions['eat:villager'];
    gol.consume(g, { kind: 'eat', key: 'eat:villager', target: v, phase: 'chew', t: 0 });
    return { before, after: gol.opinions['eat:villager'] };
  });
  await p.evaluate(() => game.creature.idle(30));
  await p.waitForTimeout(400);
  let row = false;
  try { await p.waitForFunction(() => [...document.querySelectorAll('.cp-learn')].find((r) => r.textContent.trim() === 'Eating villagers')?.classList.contains('current'), null, { timeout: 3000 }); row = true; } catch {}
  await p.screenshot({ path: `${OUT}/04-golem-ate-panel.png` });
  let said = false;
  try { await p.waitForFunction(() => [...document.querySelectorAll('.talk-text')].some((e) => e.textContent.includes('Your golem just ate a villager')), null, { timeout: 25000 }); said = true; } catch {}
  await p.waitForTimeout(600);
  await p.screenshot({ path: `${OUT}/04-golem-ate-fizz.png` });
  res.eaten = { ...st, rowLit: row, said, cards: await p.evaluate(() => [...document.querySelectorAll('.talk-text, .rv-card.show')].map((e) => e.className + ':' + e.textContent.slice(0, 60))), ok: said && row && st.after > st.before };
}
res.errors = errors;
await fs.writeFile(`${OUT}/ux-world.json`, JSON.stringify(res, null, 2));
await browser.close();
const bad = Object.entries(res).filter(([k, v]) => v && typeof v === 'object' && 'ok' in v && !v.ok).map(([k]) => k);
console.log(JSON.stringify(res, null, 1));
if (bad.length || errors.length) { console.log('FAILED:', bad, errors); process.exit(1); }
console.log('ALL OK');
