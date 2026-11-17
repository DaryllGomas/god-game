// The HUD and first-session fixes of 2026-11-17 (from the objective playtest), checked with real input:
//   npm run build && atlas-run dist scripts/test-hud-fixes.mjs <out>
// 1 the worship slider no longer swallows the game's keys; 2 the right-hand panels never sit on each other (the golem
// panel folds when there is no room) at 1280x720, 1366x768, 1600x900 and 1920x1080; 3 an advisor's card stays clear of
// the clock bar at 1920; 4 the title screen sits over the golem panel; 5 the sound and music switches are remembered;
// 6 the very first prayer is answered by one tree; 7 the controls list names the keys it left out; 8 K and Shift+K
// each show their message; 9 a banner hides a village name under it; 10 "Saved" does not sit on a message.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const OUT = process.env.OUT_DIR; const log = []; let fails = 0;
const check = (ok, msg) => { if (!ok) fails++; const s = (ok ? '  ok   ' : '  FAIL ') + msg; log.push(s); console.log(s); };
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const errors = [];
async function open(size, query, fresh = true, ctxIn = null) {
  const ctx = ctxIn ?? (await b.newContext({ viewport: size }));
  const p = await ctx.newPage(); p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${process.env.SITE_URL}/index.html?shot=default${query}`);
  if (fresh) { await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k); }); await p.reload(); }
  await p.waitForFunction(() => window.game, null, { timeout: 120000 });
  await p.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove(); });
  return { ctx, p };
}
const begin = async (p) => { await p.getByText(/Begin|Continue/).first().click({ timeout: 20000 }).catch(() => {}); await p.waitForTimeout(3500); await p.keyboard.press('Escape').catch(() => {}); await p.evaluate(() => game.pace?.choose('walk')); await p.waitForTimeout(1200); };
const overlap = (p, a, c) => p.evaluate(([a, c]) => { const A = document.querySelector(a), C = document.querySelector(c); if (!A || !C || !A.offsetParent || !C.offsetParent) return 0; const r = A.getBoundingClientRect(), s = C.getBoundingClientRect(); const w = Math.min(r.right, s.right) - Math.max(r.left, s.left), h = Math.min(r.bottom, s.bottom) - Math.max(r.top, s.top); return w > 0 && h > 0 ? Math.round(w) + 'x' + Math.round(h) : 0; }, [a, c]);

// ---- 4 and 7: the title screen (before Begin)
{
  const { ctx, p } = await open({ width: 1280, height: 720 }, '&unlock=free');
  const top = await p.evaluate(() => { const g = document.querySelector('.creature-panel').getBoundingClientRect(); const e = document.elementFromPoint(g.left + g.width / 2, g.top + 30); return e ? (e.closest('.overlay') ? 'overlay' : e.className) : null; });
  check(top === 'overlay', `title screen: the overlay is on top where the golem panel is (${top})`);
  const help = await p.evaluate(() => document.querySelector('.overlay.help').textContent);
  check(/W A S D/.test(help) && /\[ and \]/.test(help) && /Shift\+K/.test(help), 'the controls list names W A S D / arrows, [ and ], K and Shift+K');
  await p.screenshot({ path: `${OUT}/title-1280.png` });
  await ctx.close();
}

// ---- 2: the right-hand column, four screen shapes
for (const size of [{ width: 1280, height: 720 }, { width: 1366, height: 768 }, { width: 1600, height: 900 }, { width: 1920, height: 1080 }]) {
  const { ctx, p } = await open(size, '&unlock=free');
  await begin(p);
  await p.evaluate(() => { const v = game.villages.find((q) => q.isHome); try { game.projectSystem.startNow(v); } catch {} for (const k of ['food', 'timber', 'rain']) { try { game.prayerSystem.spawnNow(v, k); } catch {} } game.advance(20); game.selectVillage(v); });
  await p.waitForTimeout(1500);
  const o = { detail: await overlap(p, '.detail', '.creature-panel'), project: await overlap(p, '.pj-panel', '.creature-panel'), prayers: await overlap(p, '.pr-panel', '.creature-panel'), detailPrayers: await overlap(p, '.detail', '.pr-panel') };
  const folded = await p.evaluate(() => document.querySelector('.creature-panel').classList.contains('folded'));
  check(!o.detail && !o.project && !o.prayers && !o.detailPrayers, `${size.width}x${size.height}: village panel, dream panel, prayers panel and golem panel do not overlap (${JSON.stringify(o)}; golem panel ${folded ? 'folded' : 'open'})`);
  const slider = await p.evaluate(() => { const s = document.querySelector('.detail input[type=range]'); if (!s) return null; const r = s.getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return { x: r.left + r.width * 0.75, y: r.top + r.height / 2, onTop: e === s }; });
  check(slider && slider.onTop, `${size.width}x${size.height}: the worship slider is on top and can be reached`);
  await p.screenshot({ path: `${OUT}/right-column-${size.width}x${size.height}.png` });
  if (size.width === 1366 && slider) {
    // ---- 1: the slider and the keys
    await p.mouse.click(slider.x, slider.y); await p.waitForTimeout(300);
    await p.keyboard.press('KeyP'); await p.waitForTimeout(300);
    check(await p.evaluate(() => game.paused), 'after touching the worship slider, P still pauses');
    await p.keyboard.press('KeyP'); await p.waitForTimeout(200);
    const power0 = await p.evaluate(() => game.player.power);
    await p.keyboard.press('Digit1'); await p.waitForTimeout(400);
    check(await p.evaluate(() => game.hand.held?.kind === 'orb'), 'after touching the slider, 1 still takes the Water miracle');
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    check(await p.evaluate((p0) => game.hand.held === null && game.player.power >= p0 - 5, power0), 'Esc refunds it');
    await p.keyboard.press('Escape'); await p.waitForTimeout(400);
    check(await p.evaluate(() => document.querySelector('.detail').classList.contains('hidden')), 'Esc then closes the village panel');
    const unfolded = await p.evaluate(() => !document.querySelector('.creature-panel').classList.contains('folded'));
    await p.waitForTimeout(600);
    // by hand: a click on the header folds / opens
    const head = await p.evaluate(() => { const r = document.querySelector('.cp-head').getBoundingClientRect(); return { x: r.left + 40, y: r.top + r.height / 2, folded: document.querySelector('.creature-panel').classList.contains('folded') }; });
    await p.mouse.click(head.x, head.y); await p.waitForTimeout(400);
    check((await p.evaluate(() => document.querySelector('.creature-panel').classList.contains('folded'))) !== head.folded, `a click on the golem panel's header folds or opens it by hand (was ${head.folded ? 'folded' : 'open'}; open again after the village panel closed: ${unfolded})`);
  }
  if (size.width === 1920) {
    // ---- 3: an advisor's card and the clock bar
    await p.evaluate(() => { game.selectVillage(null); game.seasons.trigger?.('bloom'); });
    const card = await p.evaluate(() => new Promise((ok) => { const t0 = performance.now(); const f = () => { const c = document.querySelector('.talk-card.show'); if (c) { const r = c.getBoundingClientRect(), k = document.querySelector('.top-right').getBoundingClientRect(); const w = Math.min(r.right, k.right) - Math.max(r.left, k.left), h = Math.min(r.bottom, k.bottom) - Math.max(r.top, k.top); return ok({ shown: true, overlap: w > 0 && h > 0 ? `${Math.round(w)}x${Math.round(h)}` : 0, cardTop: Math.round(r.top), barBottom: Math.round(k.bottom) }); } if (performance.now() - t0 > 60000) return ok({ shown: false }); game.advance(2); setTimeout(f, 300); }; f(); }));
    check(card.shown ? !card.overlap : true, card.shown ? `1920: an advisor's card is clear of the clock bar (${JSON.stringify(card)})` : '1920: no advisor card came up within a minute (not checked)');
    if (card.shown) await p.screenshot({ path: `${OUT}/card-1920.png`, clip: { x: 500, y: 0, width: 1420, height: 220 } });
    // ---- 8: K and Shift+K
    const msgs = async () => p.evaluate(() => [...document.querySelectorAll('.msg')].map((m) => m.textContent));
    await p.keyboard.press('KeyK'); await p.waitForTimeout(300); const m1 = await msgs();
    await p.keyboard.press('Shift+KeyK'); await p.waitForTimeout(300); const m2 = await msgs();
    check(m1.some((t) => /Visual effects (on|off)/.test(t)) && m2.some((t) => /quality/.test(t)), `K and then Shift+K each show their message (${JSON.stringify(m2.slice(0, 3))})`);
    await p.keyboard.press('KeyK'); await p.waitForTimeout(200);
    // ---- 9: a banner and a village's name
    const hid = await p.evaluate(() => new Promise((ok) => { const v = game.villages.find((q) => q.isHome); let best = null;
      for (let dz = -80; dz <= 120; dz += 8) { game.godCam.setPose({ x: v.center.x, z: v.center.z + dz, distance: 150, pitch: 0.85, yaw: 0.5 }, true, game.terrain); game.godCam.camera.updateMatrixWorld(true); const q = v.center.clone(); q.y += 18; q.project(game.godCam.camera); const sy = (-q.y * 0.5 + 0.5) * innerHeight, sx = (q.x * 0.5 + 0.5) * innerWidth; const d = Math.abs(sy - innerHeight * 0.26) + Math.abs(sx - innerWidth / 2); if (!best || d < best.d) best = { d, dz }; }
      game.godCam.setPose({ x: v.center.x, z: v.center.z + best.dz, distance: 150, pitch: 0.85, yaw: 0.5 }, true, game.terrain);
      setTimeout(() => { const l = [...document.querySelectorAll('.v-label')].find((e) => e.textContent.includes(v.name)); const before = l.style.visibility !== 'hidden' && l.style.display !== 'none'; game.hud.showBanner(`${v.name}: Well complete!`, 'The village raises its stones.'); setTimeout(() => ok({ before, during: l.style.visibility !== 'hidden' }), 900); }, 700); }));
    await p.screenshot({ path: `${OUT}/banner-1920.png`, clip: { x: 460, y: 120, width: 1000, height: 330 } });
    check(hid.before && !hid.during, `a banner over a village's name hides the name while it shows (${JSON.stringify(hid)})`);
    // ---- 10: "Saved" and the messages
    const sv = await p.evaluate(() => new Promise((ok) => { game.message('A new villager is born in Ashford.', 'info', 'k1'); game.message('Ashford finished building a new house.', 'info', 'k2'); game.saves.save('manual'); setTimeout(() => { const t = document.querySelector('.save-toast'); const m = document.querySelector('.messages'); if (!t) return ok({ toast: false }); const r = t.getBoundingClientRect(); let hit = 0; for (const e of m.children) { const s = e.getBoundingClientRect(); if (Math.min(r.right, s.right) > Math.max(r.left, s.left) && Math.min(r.bottom, s.bottom) > Math.max(r.top, s.top)) hit++; } ok({ toast: true, shown: t.classList.contains('show'), messages: m.children.length, hit }); }, 500); }));
    await p.screenshot({ path: `${OUT}/saved-1920.png`, clip: { x: 0, y: 900, width: 520, height: 180 } });
    check(sv.toast && sv.messages >= 2 && sv.hit === 0, `"Saved" does not sit on a message (${JSON.stringify(sv)})`);
  }
  await ctx.close();
}

// ---- 5: the sound switches are remembered; 6: one tree answers the first prayer (story mode, fresh island)
{
  const { ctx, p } = await open({ width: 1600, height: 900 }, '');
  await begin(p);
  await p.keyboard.press('KeyN'); await p.waitForTimeout(200);
  check(await p.evaluate(() => game.audio.musicOn === false), 'N turns the music off');
  // the first prayer
  await p.evaluate(() => game.advance(15)); await p.waitForTimeout(400);
  const first = await p.evaluate(() => { const pr = game.prayerSystem.active.find((q) => q.kind === 'timber') ?? null; return pr ? { need: pr.need, have: pr.progress } : null; });
  const tree = await p.evaluate(() => { const v = game.villages.find((q) => q.isHome); const store = game.entities.find((e) => e.alive && e.kind === 'store' && Math.hypot(e.pos.x - v.center.x, e.pos.z - v.center.z) < v.radius); const trees = game.entities.filter((e) => e.alive && e.kind === 'tree' && e.grabbable && game.inInfluence(e.pos.x, e.pos.z)).sort((a, b) => a.wood - b.wood); const t = trees[0]; game.hand.grab(game, t); game.hand.place(game, store.pos.clone()); return { wood: Math.round(t.wood), trees: trees.length }; });
  await p.waitForTimeout(2500); await p.evaluate(() => game.advance(3)); await p.waitForTimeout(500);
  const done = await p.evaluate(() => ({ firstDone: !!game.prayerSystem.firstDone, answered: game.prayerSystem.answered ?? null }));
  check(first && first.need === 10, `the first prayer asks for 10 wood (${JSON.stringify(first)})`);
  check(done.firstDone === true, `the smallest tree in your light (${tree.wood} wood) answers it on its own (${JSON.stringify(done)})`);
  await p.evaluate(() => game.saves.save('manual'));
  const p2 = (await open({ width: 1600, height: 900 }, '', false, ctx)).p;
  check(await p2.evaluate(() => game.audio.musicOn === false && /line-through/.test(game.hud.musicBtn.style.textDecoration) ), 'after a reload the music is still off and its button shows it');
  await ctx.close();
}
check(errors.length === 0, `no page errors (${errors.slice(0, 2).join(' | ')})`);
log.push(fails ? `${fails} FAILED` : 'ALL PASSED'); console.log(log[log.length - 1]);
await fs.writeFile(`${OUT}/report.txt`, log.join('\n') + '\n');
await b.close();
