// Vexahl's faces and the ring (2026-10-15), on the render box: `npm run build && atlas-run dist scripts/test-vexahl-faces.mjs <out>`.
// Story mode: his rising, then his card with each portrait (D speaking, F foiled), the ring's temptation card (E),
// taking it (the village kneels, ruled by fear; his citadel grows a step), a second offer turned down (F, Lumi), and
// the reveal in Whole (the hood falls: D, then B, then C) as a strip of frames. Writes PNGs and report.json.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const SIZE = { width: 1600, height: 900 };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--autoplay-policy=no-user-gesture-required'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { failures: [], steps: {} };
const check = (ok, what) => {
  if (!ok) report.failures.push(what);
};
const ctx = await browser.newContext({ viewport: SIZE });
await ctx.addInitScript(() => {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(String(e)));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(m.text());
});
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => {
  for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
});
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
await p.waitForFunction(() => game.pace.confirmed && game.story.active, null, { timeout: 60000 });
await p.evaluate(() => {
  game.input.inside = false;
  // Record what is said, and which portraits the page ever loads (the Atlas faces must never load before the reveal).
  const log = (window.__said = []);
  const rv = game.rival;
  const rs = rv.ui.say.bind(rv.ui);
  rv.ui.say = (lines, o) => {
    for (const l of Array.isArray(lines) ? lines : [lines]) log.push({ who: l.who, text: l.text, face: l.face ?? '' });
    return rs(lines, o);
  };
  const og = game.ora.guide.bind(game.ora);
  game.ora.guide = (t, o) => {
    log.push({ who: 'ora', text: t });
    return og(t, o);
  };
});
const facesLoaded = () => p.evaluate(() => performance.getEntriesByType('resource').map((e) => e.name).filter((n) => n.includes('/rival/vexahl-')).map((n) => n.split('/').pop()));
const shot = (name, clip) => p.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) });
const TOP = { x: 420, y: 0, width: 760, height: 300 };
const state = () => p.evaluate(() => game.rival.state());
const raise = (v, s) => p.evaluate(([v, s]) => game.shrines.setStage(v, s, true), [v, s]);
const fixed = () =>
  p.evaluate(() => {
    const r = game.rival;
    game.godCam.setPose(r.shotPose(r.maxTier), true, game.terrain);
    game.dayTime = 0.42;
  });
const home = () => p.evaluate(() => {
  const h = game.villages.find((v) => v.isHome).center;
  game.godCam.setPose({ x: h.x + 40, z: h.z + 60, distance: 300, pitch: 0.85, yaw: 0.5 }, true, game.terrain);
  game.dayTime = 0.42;
});

// ---- the rising
await raise('Ashford', 'stone_circle');
await raise('Ashford', 'pyramid');
await p.waitForFunction(() => game.rival.state().risen, null, { timeout: 30000 });
await wait(19000);
await p.waitForFunction(() => !game.rival.state().glancing && !game.rival.ui.talking, null, { timeout: 60000 });
await wait(2500);

// ---- his card: D when he speaks, F when he is foiled
await home();
await p.evaluate(() => game.rival.ui.say({ who: 'rival', text: 'I am not watching. I am merely... looking, intently, at all of it.' }));
await wait(1600);
await shot('01-card-D-speaks');
await shot('01-card-D-speaks-top', TOP);
report.steps.cardD = await p.evaluate(() => ({ face: document.querySelector('.rv-card').dataset.face, src: document.querySelector('.rv-face img').src.split('/').pop() }));
check(report.steps.cardD.face === 'speak' && report.steps.cardD.src.includes('vexahl-d-'), 'card shows D when he speaks');
await p.evaluate(() => {
  game.rival.ui.clearQueue();
  document.querySelector('.rv-card').click();
});
await wait(1500);
await p.evaluate(() => game.rival.ui.say({ who: 'rival', text: 'Rain? RAIN?! That was a very expensive blight!', face: 'foiled' }));
await p.waitForFunction(() => document.querySelector('.rv-card.show')?.dataset.face === 'foiled', null, { timeout: 20000 });
await wait(1200);
await shot('02-card-F-foiled');
await shot('02-card-F-foiled-top', TOP);
report.steps.cardF = await p.evaluate(() => ({ face: document.querySelector('.rv-card').dataset.face, src: document.querySelector('.rv-face img').src.split('/').pop() }));
check(report.steps.cardF.face === 'foiled' && report.steps.cardF.src.includes('vexahl-f-'), 'card shows F when foiled');
await p.evaluate(() => document.querySelector('.rv-card').click());
await p.waitForFunction(() => !game.rival.ui.talking, null, { timeout: 30000 });
await wait(800);

// ---- the ring, taken: Brambleholt kneels; his citadel grows a step
await fixed();
await wait(1500);
await shot('10-citadel-before-take');
const before = await state();
await home();
await wait(600);
const offered = await p.evaluate(() => game.rival.ring.offerNow('stall', 'Brambleholt'));
check(offered, 'offerNow stall');
await wait(2200);
await shot('11-ring-offer-E');
await shot('11-ring-offer-E-top', { x: 380, y: 0, width: 840, height: 330 });
report.steps.offer = await p.evaluate(() => ({ open: game.rival.ring.state().open, focused: document.activeElement?.className, card: document.querySelector('.rv-tempt').classList.contains('show') }));
check(report.steps.offer.card && report.steps.offer.focused === 'rt-refuse', 'temptation card up, "Turn it down" focused');
// The first offer: Ora names the stakes.
await shot('11b-ring-offer-ora', null);
await p.evaluate(() => document.querySelector('.rv-tempt .rt-take').click());
await wait(1600);
await shot('12-ring-taken-card');
const brState = await p.evaluate(() => {
  const v = game.villages.find((x) => x.name === 'Brambleholt');
  return { owner: v.owner, fear: v.fear, belief: Math.round(v.belief), houses: v.houses.filter((h) => h.fear).length, align: +game.player.alignment.toFixed(3), balance: +game.balance.value.toFixed(3) };
});
report.steps.taken = brState;
check(brState.owner === 'player' && brState.fear && brState.houses > 0, `Brambleholt knelt in fear (${JSON.stringify(brState)})`);
await wait(4000);
await shot('12b-ring-taken-lines');
// The village ruled by fear, at dusk (its homes' glow) and by day.
await p.evaluate(() => {
  const v = game.villages.find((x) => x.name === 'Brambleholt').center;
  game.godCam.setPose({ x: v.x, z: v.z, distance: 105, pitch: 0.82, yaw: 0.5 }, true, game.terrain);
  game.dayTime = 0.8;
});
await wait(2500);
await shot('13-brambleholt-ruled-by-fear-dusk');
await p.evaluate(() => (game.dayTime = 0.42));
await wait(1500);
await shot('13b-brambleholt-ruled-by-fear-day');
await fixed();
await wait(6000);
await shot('14-citadel-after-take');
const after = await state();
report.steps.citadel = { before: before.tier, after: after.tier, steps: after.ring.steps };
check(after.tier === before.tier + 1 && after.ring.steps === 1, `citadel grew a step (${before.tier} -> ${after.tier})`);
await p.waitForFunction(() => !game.rival.ui.talking, null, { timeout: 60000 });

// ---- the ring, turned down
await home();
await wait(800);
await p.evaluate(() => game.rival.ring.offerNow('cruel'));
await wait(2200);
await shot('20-ring-offer-cruel');
await p.evaluate(() => document.querySelector('.rv-tempt .rt-refuse').click());
for (const ms of [1500, 4500, 9000, 14000]) {
  await wait(ms === 1500 ? 1500 : ms - [1500, 4500, 9000, 14000][[1500, 4500, 9000, 14000].indexOf(ms) - 1]);
  await shot(`21-ring-refused-${(ms / 1000).toFixed(1)}s`);
  await shot(`21-ring-refused-${(ms / 1000).toFixed(1)}s-top`, TOP);
}
report.steps.refused = await state();
check(report.steps.refused.ring.refused === 1, 'refused counted');
await p.waitForFunction(() => !game.rival.ui.talking, null, { timeout: 60000 });
report.facesBeforeEnding = await facesLoaded();
check(!report.facesBeforeEnding.some((n) => /vexahl-(a2|b|c)-/.test(n)), `no Atlas face loaded before the ending (${report.facesBeforeEnding.join(', ')})`);

// ---- the ending: every temple, then Ready to See, Whole, and the reveal
for (const [v, s] of [['Ashford', 'temple'], ['Brambleholt', 'stone_circle'], ['Brambleholt', 'pyramid'], ['Brambleholt', 'temple'], ['Stonemere', 'stone_circle'], ['Stonemere', 'pyramid'], ['Stonemere', 'temple']]) {
  await raise(v, s);
  await wait(200);
}
await p.evaluate(() => {
  for (const v of game.villages) if (v.owner !== 'player') v.convert(game);
});
await wait(3000);
await p.evaluate(() => game.endings.debug('ready'));
// 2026-10-18: the confrontation (src/endings/Confrontation.ts) plays first; the reveal follows it.
await p.waitForFunction(() => game.endings.ascension?.reveal, null, { timeout: 180000 });
const e0 = Date.now() - 13000;
report.reveal = [];
for (let ms = 13000; ms <= 34000; ms += 1000) {
  const d = ms - (Date.now() - e0);
  if (d > 0) await wait(d);
  const r = await p.evaluate(() => {
    const a = game.endings.ascension;
    return { phase: game.endings.phase, t: +(a?.t ?? 0).toFixed(1), face: a?.reveal?.face ?? null, done: a?.reveal?.done ?? null };
  });
  report.reveal.push({ ms, ...r });
  await shot(`30-reveal-${String(ms / 1000).padStart(2, '0')}s`);
}
// The ending carries on: the hands meet and the end card comes.
await wait(20000);
await shot('31-after-reveal');
report.end = await p.evaluate(() => ({ phase: game.endings.phase, t: game.endings.ascension?.t ?? null }));
check(report.reveal.some((r) => r.face === 'd') && report.reveal.some((r) => r.face === 'b') && report.reveal.some((r) => r.face === 'c'), 'reveal showed D, B and C');
report.said = await p.evaluate(() => window.__said);
report.errors = errors;
check(errors.length === 0, `no console errors (${errors.slice(0, 5).join(' | ')})`);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ failures: report.failures, steps: report.steps, reveal: report.reveal, end: report.end }, null, 1));
await browser.close();
