// Village art pass shots (2026-10-16). Run on Atlas: atlas-run dist scripts/village-shots.mjs <out> [tag]
// Poses the camera on village close-ups at each prayer-place age, a dusk shot, and a mid shot of the island,
// and writes fps.json (frames per second over a few seconds with all three villages loaded).
import { chromium } from 'playwright-core';
import { writeFile } from 'node:fs/promises';
const tag = process.argv[2] ?? 'shot';
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const p = await browser.newPage({ viewport: { width: 1600, height: 900 } });
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await p.goto(process.env.SITE_URL + '/index.html?shot=close');
await p.waitForFunction(() => window.game && window.game.villages.length > 0, null, { timeout: 60000 });
await p.waitForTimeout(4000);
await p.evaluate(() => { try { game.audio.setMuted(true); } catch {} game.dayTime = 0.36; });
const sleep = (ms) => p.waitForTimeout(ms);
async function pose(v, d, pitch, yaw, dayTime, dx = 0, dz = 0) {
  await p.evaluate(([v, d, pitch, yaw, dayTime, dx, dz]) => {
    const c = game.villages[v].worship?.pos ?? game.villages[v].center;
    if (dayTime != null) game.dayTime = dayTime;
    game.godCam.setPose({ x: c.x + dx, z: c.z + dz, distance: d, pitch, yaw }, true);
  }, [v, d, pitch, yaw, dayTime, dx, dz]);
}
async function shot(name) {
  await sleep(2600);
  await p.screenshot({ path: `${process.env.OUT_DIR}/${tag}-${name}.png` });
}
// Let the villagers spread out a little.
await p.evaluate(() => game.advance?.(20));
const stages = ['totem', 'stone_circle', 'pyramid', 'temple'];
for (const s of stages) {
  await p.evaluate((s) => game.shrines.setStage(0, s, false), s);
  await pose(0, 78, 0.68, 0.5, 0.36);
  await shot(`v0-${s}`);
}
// The storyboard's panel 2 framing: pyramid in a stone ring, a bit closer and steeper.
await p.evaluate(() => game.shrines.setStage(0, 'pyramid', false));
await pose(0, 62, 0.75, 0.9, 0.36);
await shot('v0-panel2');
await pose(0, 26, 0.5, 0.9, 0.36, 8, 12);
await shot('v0-street');
await pose(0, 78, 0.68, 0.5, 0.72);
await shot('v0-dusk');
const only = process.argv.includes('houses');
for (let i = 0; i < 3; i++) {
  await p.evaluate((i) => { const h = game.villages[0].houses[i] ?? game.villages[2].houses[i]; game.dayTime = 0.36; game.godCam.setPose({ x: h.pos.x, z: h.pos.z, distance: 30, pitch: 0.5, yaw: h.object.rotation.y + 0.5 }, true); }, i);
  await shot(`house${i}`);
}
if (only) { await browser.close(); process.exit(0); }
await p.evaluate(() => { game.dayTime = 0.36; game.shrines.setStage(1, 'stone_circle', false); });
await pose(1, 78, 0.68, 0.5, 0.36);
await shot('v1');
await p.evaluate(() => game.shrines.setStage(2, 'temple', false));
await pose(2, 78, 0.68, 0.5, 0.36);
await shot('v2');
await pose(0, 240, 0.7, 0.5, 0.36);
await shot('mid');
// fps over 4 s at the default view of the home village.
await pose(0, 130, 0.85, 0.5, 0.36);
await sleep(1500);
const fps = await p.evaluate(() => new Promise((res) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 < 4000) requestAnimationFrame(f); else res(n / ((performance.now() - t0) / 1000)); }; requestAnimationFrame(f); }));
const info = await p.evaluate(() => { const r = game.renderer?.info?.render; return r ? { calls: r.calls, triangles: r.triangles } : null; });
await writeFile(`${process.env.OUT_DIR}/${tag}-fps.json`, JSON.stringify({ fps, info, errors: errors.slice(0, 20) }, null, 2));
console.log('fps', fps, info, 'errors', errors.length, errors.slice(0, 5));
await browser.close();
