// A rock lying right under a floating tag (a dream's tag over a village), 2026-11-17: the press takes the rock, by
// mouse and by controller; and with no rock there the tag still flies the camera to the site.
//   npm run build && atlas-run dist scripts/test-rock-under-tag.mjs <out>
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const OUT = process.env.OUT_DIR; const log = []; let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; const s = (ok ? '  ok   ' : '  FAIL ') + msg; log.push(s); console.log(s); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const ctx = await b.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k); } catch {} });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&padtest&unlock=free`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove(); });
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 }).catch(() => {});
await p.waitForTimeout(4000);
await p.keyboard.press('Escape').catch(() => {});
await p.evaluate(() => game.pace?.choose('walk'));
await p.waitForTimeout(2500);
const setPad = (o) => p.evaluate((o) => { const f = window.__fakePad; if (o.axes) o.axes.forEach((v, i) => (f.axes[i] = v)); if (o.btn) for (const [k, v] of Object.entries(o.btn)) { f.buttons[k].pressed = !!v; f.buttons[k].value = v ? 1 : 0; } }, o);
const handAt = () => p.evaluate(() => ({ x: game.input.x, y: game.input.y }));
async function padMove(tx, ty) {
  for (let n = 0; n < 400; n++) {
    const h = await handAt(); const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
    if (d < 4) break;
    const k = d > 30 ? Math.max(0.3, Math.min(1, d / 140)) : 0.26;
    await setPad({ axes: [(dx / d) * k, (dy / d) * k, 0, 0] }); await p.waitForTimeout(d > 30 ? 40 : 16);
    if (d <= 30) { await setPad({ axes: [0, 0, 0, 0] }); await p.waitForTimeout(24); }
  }
  await setPad({ axes: [0, 0, 0, 0] }); await p.waitForTimeout(300);
}
// a dream under way at home (its tag shows), the camera a little way off, then a rock set on the ground right under the tag
const setup = (distance) => p.evaluate((distance) => new Promise((ok) => {
  const home = game.villages.find((v) => v.isHome);
  try { game.projectSystem.startNow(home); } catch {}
  game.godCam.setPose({ x: home.center.x, z: home.center.z, distance, pitch: 0.95, yaw: 0.5 }, true, game.terrain);
  setTimeout(() => {
    const chip = [...document.querySelectorAll('.pj-chip')].find((c) => c.getBoundingClientRect().width && c.style.display !== 'none');
    if (!chip) return ok(null);
    const r = chip.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
    const rc = game.raycaster, ndc = rc.ray.origin.clone().set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1, 0);
    rc.setFromCamera(ndc, game.godCam.camera);
    const g = game.godCam.target.clone(); if (!game.terrain.raycast(rc.ray, g)) return ok(null);
    const e = game.entities.find((q) => q.alive && q.kind === 'rock' && !q.held);
    e.pos.set(g.x, game.terrain.heightAt(g.x, g.z) + e.groundOffset, g.z); e.airborne = false; e.rolling = false; e.vel.set(0, 0, 0); e.object.position.copy(e.pos);
    window.__rock = e;
    setTimeout(() => {
      const v = e.pos.clone().project(game.godCam.camera), sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
      const el = document.elementFromPoint(sx, sy);
      ok({ sx, sy, under: !!el?.closest('.pj-chip'), lit: game.inInfluence(e.pos.x, e.pos.z), d0: game.godCam.distance });
    }, 400);
  }, 700);
}), distance);
const held = () => p.evaluate(() => game.hand.held === window.__rock);
const putBack = () => p.evaluate(() => { const h = game.hand; if (h.held) h.place(game, h.pickedFrom.clone()); game.controls.mode = 'none'; game.input.buttons.clear(); });
for (const distance of [90, 160, 260]) {
  let s = await setup(distance);
  if (!s || !s.under || !s.lit) { check(false, `distance ${distance}: could not put a rock under the tag (${JSON.stringify(s)})`); continue; }
  await p.mouse.move(s.sx - 40, s.sy + 30); await p.mouse.move(s.sx, s.sy, { steps: 4 }); await p.waitForTimeout(250);
  check(await p.evaluate(() => game.hand.hover === window.__rock), `distance ${distance}: with the pointer on the tag, the hand still follows and the rock under it is the one hovered`);
  await p.mouse.click(s.sx, s.sy); await p.waitForTimeout(500);
  check(await held(), `distance ${distance}: mouse press on the rock under the tag takes the rock`);
  check(Math.abs((await p.evaluate(() => game.godCam.distance)) - s.d0) < 5, `distance ${distance}: and the tag was not clicked (the camera stayed)`);
  await putBack(); await p.waitForTimeout(700);
  // press on the rock under the tag, slide 15 px off the tag onto the land with the button still down, let go
  s = await setup(distance);
  const cam0 = await p.evaluate(() => [game.godCam.target.x, game.godCam.target.z]);
  await p.mouse.move(s.sx - 40, s.sy + 30); await p.mouse.move(s.sx, s.sy, { steps: 4 }); await p.waitForTimeout(250);
  await p.mouse.down(); await p.waitForTimeout(60);
  const off = await p.evaluate(([x, y]) => { for (const [dx, dy] of [[0, 26], [0, -26], [0, 40], [0, -40]]) if (!document.elementFromPoint(x + dx, y + dy)?.closest('.pj-chip')) return [dx, dy]; return [0, 60]; }, [s.sx, s.sy]);
  await p.mouse.move(s.sx + off[0] / 2, s.sy + off[1] / 2); await p.mouse.move(s.sx + off[0], s.sy + off[1], { steps: 3 }); await p.waitForTimeout(120);
  await p.mouse.up(); await p.waitForTimeout(500);
  const cam1 = await p.evaluate(() => [game.godCam.target.x, game.godCam.target.z]);
  check(await held(), `distance ${distance}: press on the rock under the tag, slide off the tag, let go: the rock is still in the hand`);
  check(Math.hypot(cam1[0] - cam0[0], cam1[1] - cam0[1]) < 0.5 && (await p.evaluate(() => game.controls.mode)) === 'none', `distance ${distance}: and the land was not dragged`);
  await putBack(); await p.waitForTimeout(700);
  s = await setup(distance);
  await padMove(s.sx, s.sy);
  await setPad({ btn: { 0: 1 } }); await p.waitForTimeout(120); await setPad({ btn: { 0: 0 } }); await p.waitForTimeout(500);
  check(await held(), `distance ${distance}: controller A on the rock under the tag takes the rock`);
  await putBack(); await p.waitForTimeout(500); await p.mouse.move(60, 840); await p.waitForTimeout(300);
}
// no rock there: the tag still works, by mouse and by controller
await p.evaluate(() => { const e = window.__rock; e.pos.x += 60; e.pos.y = game.terrain.heightAt(e.pos.x, e.pos.z) + e.groundOffset; e.object.position.copy(e.pos); });
for (const how of ['mouse', 'controller']) {
  const t = await p.evaluate(() => new Promise((ok) => {
    const home = game.villages.find((v) => v.isHome);
    game.godCam.setPose({ x: home.center.x + 40, z: home.center.z + 30, distance: 300, pitch: 0.95, yaw: 0.5 }, true, game.terrain);
    setTimeout(() => { const chip = [...document.querySelectorAll('.pj-chip')].find((c) => c.getBoundingClientRect().width && c.style.display !== 'none'); const r = chip.getBoundingClientRect();
      for (const f of [0.5, 0.25, 0.75, 0.1, 0.9]) { const x = r.left + r.width * f, y = r.top + r.height / 2; if (!game.thingUnderTag(x, y)) return ok({ x, y }); } ok(null); }, 700);
  }));
  if (!t) { check(false, `${how}: no clear place on the tag to press`); continue; }
  if (how === 'mouse') { await p.mouse.move(t.x - 30, t.y - 20); await p.mouse.move(t.x, t.y, { steps: 3 }); await p.waitForTimeout(200); await p.mouse.click(t.x, t.y); }
  else { await padMove(t.x, t.y); await setPad({ btn: { 0: 1 } }); await p.waitForTimeout(120); await setPad({ btn: { 0: 0 } }); }
  await p.waitForTimeout(1800);
  const d = await p.evaluate(() => game.godCam.distance);
  check(Math.abs(d - 70) < 25, `${how}: a press on the tag with no rock under it still flies to the site (camera 300 -> ${Math.round(d)})`);
  await putBack(); await p.mouse.move(60, 840); await p.waitForTimeout(300);
}
// how long a save holds the frame (a press made during it is handled when it ends)
const saveMs = await p.evaluate(() => { const t = []; for (let i = 0; i < 5; i++) { const t0 = performance.now(); game.saves.save(); t.push(Math.round(performance.now() - t0)); } return t; });
console.log('game.saves.save() took, ms:', saveMs.join(', ')); log.push('save ms: ' + saveMs.join(', '));
check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
log.push(fails ? `${fails} FAILED` : 'ALL PASSED'); console.log(log[log.length - 1]);
await fs.writeFile(`${OUT}/report.txt`, log.join('\n') + '\n');
await b.close();
