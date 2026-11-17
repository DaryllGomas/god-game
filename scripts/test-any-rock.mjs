// EVERY rock you can see near the first village, real boulder or scattered rock alike (2026-11-17, Daryll: "When I'm
// looking over the first village ... almost any rock is unable to be picked up. I have to move the hand all over
// randomly and I get lucky if I pick up a rock"). The earlier rock tests only tried the 64 real boulders; the island
// also draws about 1,500 scattered rocks of the same shape, and those are what the eye lands on.
//   npm run build && atlas-run dist scripts/test-any-rock.mjs <out> [WxH]
// Story mode, a fresh island, three views over the home village. Every rock drawn inside your light that is on screen
// and not hidden is clicked at its middle; a rock must end up in the hand. Prints the rate for scattered rocks and for
// real boulders, and saves a picture of each view with a green dot on every rock taken and a red one on every miss.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const [W, H] = (process.argv[2] || '1920x1080').split('x').map(Number);
const OUT = process.env.OUT_DIR;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const ctx = await b.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k); } catch {} });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${process.env.SITE_URL}/index.html?shot=default`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove(); });
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 }).catch(() => {});
await p.waitForTimeout(4000);
await p.keyboard.press('Escape').catch(() => {});
await p.evaluate(() => game.pace?.choose('walk'));
await p.waitForTimeout(2500);
await p.evaluate(() => { const home = game.villages.find((v) => v.isHome); try { game.projectSystem.startNow(home); } catch {} });   // the village wants its well
await p.waitForTimeout(800);

// every rock drawn right now inside your light: the real boulders, and the scattered ones (read from what is drawn)
const targets = () => p.evaluate(() => {
  const cam = game.godCam.camera, rc = game.raycaster, out = [];
  cam.updateMatrixWorld(true);
  const m = cam.matrixWorld.clone(), pos = cam.position.clone(), scl = cam.position.clone(), q = cam.quaternion.clone();
  const hide = []; game.scene.traverse((o) => { if (o.isInstancedMesh && o.visible && /decor-tree|decor-shrub/.test(o.name)) hide.push(o); });
  const blockers = [...game.forest.meshes, ...hide, ...game.entities.filter((e) => e.alive && ['house', 'store', 'worship', 'site'].includes(e.kind)).map((e) => e.object)];
  const add = (x, y, z, r, real) => {
    if (!game.inInfluence(x, z)) return;
    const v = pos.clone().set(x, y + r * 0.15, z), d = cam.position.distanceTo(v); v.project(cam);
    if (v.z > 1) return;
    const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
    if (sx < 30 || sy < 30 || sx > innerWidth - 30 || sy > innerHeight - 30) return;
    const el = document.elementFromPoint(sx, sy); if (!el || el.tagName !== 'CANVAS') return;          // under the HUD
    rc.setFromCamera(scl.set(v.x, v.y, 0), cam);
    const hit = rc.intersectObjects(blockers, true)[0]; if (hit && hit.distance < d - r) return;        // behind a tree or a house
    const g = pos.clone(); if (game.terrain.raycast(rc.ray, g) && cam.position.distanceTo(g) < d - r * 1.5 - 1) return;   // behind a hill
    out.push({ x: +x.toFixed(1), z: +z.toFixed(1), r: +r.toFixed(2), real, sx, sy });
  };
  for (const e of game.entities) if (e.alive && e.kind === 'rock' && !e.held && !e.loose) add(e.pos.x, e.pos.y, e.pos.z, e.radius, true);
  for (const e of game.entities) if (e.alive && e.kind === 'rock' && !e.held && e.loose) add(e.pos.x, e.pos.y, e.pos.z, e.radius, false);
  game.scene.traverse((o) => {
    if (!o.isInstancedMesh || !o.visible || !o.name.startsWith('decor-rock')) return;
    for (let i = 0; i < o.count; i++) { o.getMatrixAt(i, m); m.decompose(pos, q, scl); add(pos.x, pos.y, pos.z, (scl.x + scl.z) / 2, false); pos.copy(cam.position); }
  });
  return out;
});
const total = { scattered: [0, 0], real: [0, 0] }; const views = [];
const home = await p.evaluate(() => { const v = game.villages.find((q) => q.isHome); return { x: v.center.x, z: v.center.z }; });
for (const [name, pose] of [['looking over the village', { x: home.x, z: home.z, distance: 150, pitch: 0.85, yaw: 0.5 }], ['closer', { x: home.x + 20, z: home.z + 25, distance: 90, pitch: 0.95, yaw: 2.2 }], ['wide', { x: home.x, z: home.z, distance: 240, pitch: 1.0, yaw: 3.6 }]]) {
  await p.evaluate((pose) => game.godCam.setPose(pose, true, game.terrain), pose);
  await p.mouse.move(40, H - 40); await p.waitForTimeout(900);
  const list = await targets();
  await p.screenshot({ path: `${OUT}/${name.replace(/ /g, '-')}-${W}x${H}.png` });
  const res = { name, scattered: [0, 0], real: [0, 0], marks: [] };
  for (const t of list) {
    await p.evaluate((pose) => game.godCam.setPose(pose, true, game.terrain), pose);
    await p.mouse.move(t.sx - 35, t.sy - 25); await p.mouse.move(t.sx, t.sy, { steps: 4 }); await p.waitForTimeout(220);
    const pre = await p.evaluate(() => ({ hover: game.hand.hover?.kind ?? null, valid: game.hand.valid }));
    await p.mouse.click(t.sx, t.sy); await p.waitForTimeout(350);
    const got = await p.evaluate(([x, z]) => { const h = game.hand.held; return { kind: h?.kind ?? null, near: h ? Math.hypot(game.hand.pickedFrom.x - x, game.hand.pickedFrom.z - z) : null }; }, [t.x, t.z]);
    const ok = got.kind === 'rock' && got.near < 3;
    const k = t.real ? 'real' : 'scattered'; res[k][1]++; total[k][1]++; if (ok) { res[k][0]++; total[k][0]++; }
    res.marks.push({ ...t, ok, hover: pre.hover, held: got.kind });
    await p.evaluate(() => { const h = game.hand; if (h.held) h.place(game, h.pickedFrom.clone()); game.controls.mode = 'none'; game.input.buttons.clear(); });
    await p.mouse.move(40, H - 40); await p.waitForTimeout(300);
  }
  console.log(`${W}x${H} ${name}: scattered rocks ${res.scattered[0]}/${res.scattered[1]}, real boulders ${res.real[0]}/${res.real[1]}` + `   misses: ${JSON.stringify(res.marks.filter((q) => !q.ok).slice(0, 4).map((q) => ({ r: q.r, real: q.real, hover: q.hover, held: q.held })))}`);
  views.push(res);
}
const pct = (a) => `${a[0]} of ${a[1]}` + (a[1] ? ` (${Math.round((100 * a[0]) / a[1])}%)` : '');
console.log(`TOTAL ${W}x${H}: every rock on screen in your light, clicked once: scattered rocks ${pct(total.scattered)}, real boulders ${pct(total.real)}, all ${pct([total.scattered[0] + total.real[0], total.scattered[1] + total.real[1]])}`);
console.log('page errors', errors.length, errors.slice(0, 2));
await fs.writeFile(`${OUT}/any-rock-${W}x${H}.json`, JSON.stringify({ total, views, errors }, null, 1));
await b.close();
