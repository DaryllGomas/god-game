// Probe where his isle could stand (2026-10-15): for candidate directions and distances, where it lands on screen in
// the overview and in the view the game starts on, and whether the sea around it is open water.
// `atlas-run dist scripts/probe-isle-spot.mjs <out>`
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
await ctx.addInitScript(() => {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
});
const p = await ctx.newPage();
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => {
  for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
});
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
await p.waitForFunction(() => game.pace.confirmed && game.story.active, null, { timeout: 60000 });
await new Promise((r) => setTimeout(r, 4000));
const res = await p.evaluate(() => {
  const g = game;
  const start = g.godCam.getPose();
  const poses = { overview: { x: 0, z: 0, distance: 420, pitch: 0.62, yaw: 0.5 }, start };
  const cams = {};
  for (const [k, pose] of Object.entries(poses)) {
    g.godCam.setPose(pose, true, g.terrain);
    g.godCam.update(0.016, g.terrain);
    const c = g.godCam.camera.clone();
    c.updateMatrixWorld();
    c.updateProjectionMatrix();
    cams[k] = c;
  }
  const V = g.rival.isle.group.position.clone();
  const out = [];
  for (let deg = 100; deg <= 260; deg += 5) {
    for (const d of [372, 400, 430, 460, 500]) {
      const a = (deg * Math.PI) / 180;
      const x = Math.cos(a) * d;
      const z = Math.sin(a) * d;
      // Open water: the deepest land within 90 m.
      let land = -99;
      for (let r = 0; r <= 90; r += 15) for (let i = 0; i < 12; i++) land = Math.max(land, g.terrain.heightAt(x + Math.cos(i / 2) * r, z + Math.sin(i / 2) * r));
      const row = { deg, d, x: Math.round(x), z: Math.round(z), land: +land.toFixed(1) };
      for (const [k, c] of Object.entries(cams)) {
        const foot = V.set(x, 0, z).clone().project(c);
        const top = V.set(x, 330 * 0.17, z).clone().project(c);
        row[k] = { x: +foot.x.toFixed(2), y: +foot.y.toFixed(2), topY: +top.y.toFixed(2), front: foot.z < 1 };
      }
      out.push(row);
    }
  }
  return { start, now: g.rival.isle.group.position, out };
});
await fs.writeFile(`${OUT}/probe.json`, JSON.stringify(res, null, 1));
await p.screenshot({ path: `${OUT}/start.png` });
await browser.close();
