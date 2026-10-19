// Rocks by the coast (2026-10-18, Daryll: "I can't seem to pick up any rocks ... really hard to pick up ... over by the
// coast"). Every rock inside your light, at three camera heights: the mouse goes to the rock's middle on screen, a
// little off (0-20 px), and clicks. Prints the rate per height and why misses missed (what was hovered instead).
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
await p.evaluate(() => game.pace?.choose('walk')); // a real player has chosen: the pace marks are gone
await p.waitForTimeout(3000);
const ids = await p.evaluate(() => {
  // Rocks, plus trees by the shore: inside your light, with water or the light's edge within 8 m.
  const shore = (e) => [0, 1, 2, 3, 4, 5, 6, 7].some((k) => { const x = e.pos.x + Math.cos(k * 0.785) * 8, z = e.pos.z + Math.sin(k * 0.785) * 8; return !game.terrain.isLand(x, z, 0.8) || !game.inInfluence(x, z); });
  const inside = game.entities.filter((e) => e.alive && e.grabbable && game.inInfluence(e.pos.x, e.pos.z));
  window.__rocks = [...inside.filter((e) => e.kind === 'rock'), ...inside.filter((e) => e.kind === 'tree' && shore(e)).slice(0, 12)];
  return window.__rocks.length;
});
const out = {};
let seed = 3; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const distance of [70, 130, 220]) {
  let ok = 0, tries = 0; const misses = [];
  for (let i = 0; i < Math.min(ids, 20); i++) {
    const pt = await p.evaluate(({ i, distance }) => {
      const e = window.__rocks[i];
      if (!e.alive || e.held) return null;
      game.godCam.setPose({ x: e.pos.x, z: e.pos.z, distance, pitch: 0.95, yaw: 0.4 + i }, true, game.terrain);
      return { i, kind: e.kind, r: +e.radius.toFixed(2) };
    }, { i, distance });
    if (!pt) continue;
    await p.waitForTimeout(450);
    const sp = await p.evaluate((i) => {
      const e = window.__rocks[i];
      const v = e.pos.clone(); v.y += e.kind === 'tree' ? Math.min(e.topHeight * 0.65, 7) : e.radius * 0.5; v.project(game.godCam.camera);
      return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight, wy: +e.pos.y.toFixed(1) };
    }, i);
    const a = rnd() * Math.PI * 2, r = rnd() * 20;
    const cx = sp.x + Math.cos(a) * r, cy = sp.y + Math.sin(a) * r;
    await p.mouse.move(cx - 25, cy - 15); await p.mouse.move(cx, cy, { steps: 5 }); await p.waitForTimeout(250);
    const pre = await p.evaluate((i) => ({ same: game.hand.hover === window.__rocks[i], hpos: game.hand.hover && [Math.round(game.hand.hover.pos.x), Math.round(game.hand.hover.pos.z)], tpos: [Math.round(window.__rocks[i].pos.x), Math.round(window.__rocks[i].pos.z)], tin: game.inInfluence(window.__rocks[i].pos.x, window.__rocks[i].pos.z), hover: game.hand.hover?.kind ?? null, valid: game.hand.valid, blocked: game.hand.blocked, mode: game.controls.mode, bld: game.hoverBuilding?.kind ?? null }), i);
    const top = await p.evaluate(([x, y]) => { const el = document.elementFromPoint(x, y); return el ? `${el.tagName}.${el.className}` : null; }, [cx, cy]);
    await p.evaluate(() => { window.__ev = []; for (const t of ['pointerdown', 'pointerup']) window.addEventListener(t, (e) => window.__ev.push(`${t}:${e.target.tagName}.${e.target.className}:${e.button}`), { capture: true, once: true }); });
    await p.evaluate(() => { window.__log = []; const h = game.hand; if (!h.__wrapped) { h.__wrapped = true; const g0 = h.grab.bind(h), p0 = h.place.bind(h), t0 = h.throw.bind(h); h.grab = (g, e) => { window.__log.push('grab ' + e.kind + ' ' + Math.round(e.pos.x) + ',' + Math.round(e.pos.z) + ' alive ' + e.alive); return g0(g, e); }; h.place = (g, a) => { window.__log.push('place'); return p0(g, a); }; h.throw = (g, v) => { window.__log.push('throw'); return t0(g, v); }; const c = game.controls, hd = c.handle.bind(c); c.handle = (ev, rt) => { window.__log.push(ev.type + ev.button + ' mode=' + c.mode + ' hover=' + (h.hover?.kind ?? null) + ' valid=' + h.valid + ' bld=' + (game.hoverBuilding?.kind ?? null)); return hd(ev, rt); }; } });
    await p.mouse.click(cx, cy); await p.waitForTimeout(350);
    const log = await p.evaluate(() => [...window.__log, 'held=' + (game.hand.held?.kind ?? null), 'mode=' + game.controls.mode]);
    const evs = await p.evaluate(() => window.__ev);
    const kind = pt.kind;
    const held = await p.evaluate(() => game.hand.held?.kind ?? null);
    const msg = await p.evaluate(() => [...document.querySelectorAll('.msg, .message, [class*=toast]')].map((m) => m.textContent).slice(-2));
    tries++;
    if (held === kind) ok++; else misses.push({ log, top, evs, msg, ...pt, off: Math.round(r), held, pre, wy: sp.wy });
    await p.evaluate(() => { const h = game.hand; if (h.held) h.place(game, h.held.pos.clone()); game.controls.mode = 'none'; });
    await p.waitForTimeout(250);
  }
  out[distance] = { tries, ok, misses };
  console.log(`distance ${distance}: ${ok}/${tries}`, JSON.stringify(misses));
}
await fs.writeFile(`${process.env.OUT_DIR}/report.json`, JSON.stringify({ rocks: ids, out, errors }, null, 2));
console.log('rocks in light', ids, 'errors', errors.length);
await b.close();
