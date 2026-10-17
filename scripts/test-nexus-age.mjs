// The last age (2026-10-17): the Nexus and Telor, on the render box:
//   npm run build && atlas-run dist scripts/test-nexus-age.mjs <out>
// A fresh story-mode island; an old-style save (no last age) reloads unchanged; the age starts (debug, every temple
// standing, Vexahl whole); Ora names the goal; the seven stones rise one by one; an island saved mid-ring reloads where
// it stood; the ring wakes; Telor grows step by step (roads, plaza, district, avenues, walls); a save mid-city reloads
// where it stood; the true end plays (the Nexus lights, the people of Telor gather and look up: they understand you now)
// to its card, which cuts to the RPG ("Some years later, the Nexus opens.") with a button to continue the story; a
// click anywhere else closes it and the island goes on. Screenshots of every step; report.json.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const SIZE = { width: 1600, height: 900 };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { failures: [], steps: {}, said: [] };
const check = (ok, what) => {
  if (!ok) report.failures.push(what);
  return ok;
};
const ctx = await browser.newContext({ viewport: SIZE });
// A fresh island, unless the test is reloading on purpose (sessionStorage 'test.keep').
await ctx.addInitScript(() => {
  try {
    if (sessionStorage.getItem('test.keep') === '1') return;
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

const unhide = () =>
  p.evaluate(() => {
    for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
  });
const listen = () =>
  p.evaluate(() => {
    game.input.inside = false;
    game.audio.setMuted(true);
    const log = (window.__said = window.__said ?? []);
    const og = game.ora.guide.bind(game.ora);
    game.ora.guide = (t, o) => {
      log.push({ who: 'ora', text: t });
      return og(t, o);
    };
    const adv = game.prayerSystem.advisors;
    const as = adv.say.bind(adv);
    adv.say = (lines, o) => {
      const r = as(lines, o);
      if (r) for (const l of Array.isArray(lines) ? lines : [lines]) log.push({ who: l.who === 'spirit' ? 'Lumi' : 'Fizz', text: l.text });
      return r;
    };
    const ev = (window.__ev = window.__ev ?? []);
    for (const k of ['nexusBegun', 'nexusStone', 'nexusRaised', 'telorStep', 'trueEnd']) game.events.on(k, (d) => ev.push({ k, d, t: Math.round(game.time) }));
  });
const start = async (cont = false) => {
  await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
  await p.waitForFunction(() => window.game, null, { timeout: 120000 });
  await unhide();
  await p.getByText(cont ? 'Continue' : 'Begin', { exact: false }).first().click({ timeout: 20000 });
  await p.waitForFunction(() => game.saves.armed, null, { timeout: 60000 });
  await listen();
};
const reload = async () => {
  await p.evaluate(() => {
    game.saves.save('quiet');
    sessionStorage.setItem('test.keep', '1');
  });
  await start(true);
  await p.evaluate(() => sessionStorage.removeItem('test.keep'));
};
const shot = (name, clip) => p.screenshot({ path: `${OUT}/${name}.png`, ...(clip ? { clip } : {}) });
const hud = (on) => p.evaluate((on) => (document.querySelector('.hud').style.opacity = on ? '' : '0'), on);
const pose = (o, hour = 0.42) =>
  p.evaluate(
    ([o, hour]) => {
      const s = game.nexus.site.pos;
      game.godCam.setPose({ x: s.x + (o.dx ?? 0), z: s.z + (o.dz ?? 0), distance: o.d, pitch: o.pitch ?? 0.8, yaw: o.yaw ?? 0.5 }, true, game.terrain);
      if (hour !== null) game.dayTime = hour;
    },
    [o, hour],
  );
const state = () => p.evaluate(() => game.nexus.state());
const advance = (s) => p.evaluate((s) => game.advance(s), s);

// ---- a fresh island; an old-style save (no last age) reloads unchanged
await start();
await p.waitForFunction(() => game.pace.confirmed && game.story.active, null, { timeout: 60000 });
await wait(1500);
await reload();
report.steps.oldSave = await state();
check(report.steps.oldSave.phase === 'off', 'an island with no last age reloads with the age off');

// ---- the age begins (debug: every temple standing, Vexahl whole, as after Whole's card)
const began = await p.evaluate(() => game.nexus.debug('nexus'));
check(began === 'ring', `the age begins (got ${began})`);
await wait(1000);
report.steps.begin = await p.evaluate(() => {
  const s = game.nexus.site.pos;
  return {
    state: game.nexus.state(),
    fromVillages: game.villages.map((v) => [v.name, Math.round(Math.hypot(v.center.x - s.x, v.center.z - s.z))]),
    inLight: game.inInfluence(s.x, s.z),
    builders: game.villages.map((v) => !!v.wonderSite),
    endings: game.endings.phase,
  };
});
check(report.steps.begin.inLight, 'the hand works at the Nexus');
check(report.steps.begin.builders.every(Boolean), 'all three villages build the Nexus');
await hud(false);
await p.evaluate(() => {
  const s = game.nexus.site.pos;
  game.godCam.setPose({ x: s.x - 20, z: s.z + 40, distance: 620, pitch: 1.2, yaw: 0 }, true, game.terrain);
  game.dayTime = 0.42;
});
await wait(2500);
await shot('01-the-heart-of-the-island');
await pose({ d: 75, pitch: 0.62 });
await wait(2200);
await shot('02-the-dais-before-the-stones');
await hud(true);
// Ora names the goal.
await p.waitForFunction(() => (game.ora.state().showing ?? '').includes('Nexus'), null, { timeout: 40000 }).catch(() => {});
await wait(1500);
report.steps.oraGoal = await p.evaluate(() => game.ora.state().showing);
check((report.steps.oraGoal ?? '').includes('Nexus'), 'Ora names the goal');
await pose({ d: 140, pitch: 0.8 });
await wait(800);
await shot('03-ora-names-the-goal');
// From here the game holds still between steps (game.advance moves it on), so no shot is taken late.
const hold = () => p.evaluate(() => (game.paused = true));
await hold();
// Saved mid-ring: it reloads where it stood.
{
  const before = await state();
  await reload();
  await hold();
  const after = await state();
  report.steps.reloadRing = { before: before.stones, after: after.stones, phase: after.phase, fraction: [before.site?.fraction, after.site?.fraction] };
  check(before.phase === 'ring' && after.phase === 'ring' && after.stones === before.stones, `mid-ring save reloads where it stood (${before.phase} ${before.stones} -> ${after.phase} ${after.stones})`);
}

// ---- the stones rise one by one
const stones = [];
for (let i = 1; i <= 7; i++) {
  await p.evaluate(() => game.nexus.debug('stone'));
  await advance(5);
  const st = await state();
  stones.push(st.stones);
  if ([1, 4, 6].includes(i)) {
    await hud(false);
    await pose({ d: 62, pitch: 0.5, yaw: 0.9 });
    await wait(1800);
    await shot(`04-stone-${i}`);
    await hud(true);
  }
}
report.steps.stones = stones;
check(stones[stones.length - 1] === 7 && stones.every((n, i) => i === 0 || n >= stones[i - 1]) && new Set(stones).size >= 3, `stones rise one by one (${stones.join(',')})`);
await advance(3);
report.steps.ring = await state();
check(report.steps.ring.phase === 'city', 'the ring stands: the city begins');
await hud(false);
await pose({ d: 58, pitch: 0.42, yaw: 1.4 }, 0.8);
await wait(3500);
await shot('05-the-ring-wakes-dusk');
await pose({ d: 34, pitch: 0.25, yaw: 2.2 }, 0.8);
await wait(1500);
await shot('05b-the-ring-low');

// ---- Telor grows, step by step (game seconds into the build for each picture)
const steps = [];
const AT = { roads: 14, plaza: 32, district: 72, avenues: 142, walls: 172, built: 186.5 };
for (const name of Object.keys(AT)) {
  await p.evaluate((t) => game.nexus.debug('city', t), AT[name]);
  await advance(3);
  const st = await state();
  steps.push({ name, step: st.step, cityT: st.cityT, city: st.city });
  if (name === 'district') {
    await reload();
    await hold();
    await hud(false);
    const after = await state();
    report.steps.reloadCity = { before: st.cityT, after: after.cityT, standing: [st.city.standing, after.city.standing], phase: after.phase };
    check(after.phase === 'city' && Math.abs(after.cityT - st.cityT) < 2, `mid-city save reloads where it stood (${st.cityT} -> ${after.cityT})`);
    check(after.city.buildings === st.city.buildings && Math.abs(after.city.standing - st.city.standing) <= 2, `the same city after a reload (${st.city.buildings}/${st.city.standing} -> ${after.city.buildings}/${after.city.standing})`);
  }
  await pose({ d: 260, pitch: 0.95, yaw: 0.5 });
  await wait(2600);
  await shot(`06-telor-${steps.length}-${name}`);
}
report.steps.city = steps;
const built = steps[steps.length - 1].city;
check(built.standing === built.buildings && built.buildings >= 60, `Telor stands: ${built.standing}/${built.buildings} buildings`);
check(built.lamps >= 60 && built.walkers >= 60, `lamps ${built.lamps}, walkers ${built.walkers}`);

// ---- a place you'd want to walk in
await pose({ d: 330, pitch: 0.72, yaw: 0.9 }, 0.79);
await wait(3000);
await shot('07-telor-dusk-wide');
await pose({ d: 120, pitch: 0.45, yaw: 2.6 }, 0.81);
await wait(2500);
await shot('08-telor-dusk-streets');
await pose({ d: 46, pitch: 0.22, yaw: 0.2 }, 0.79);
await wait(2500);
await shot('09-plaza-dancers');
// A street of the first ring, by day, from among the houses (a camera spot clear of every building).
await p.evaluate(() => {
  const c = game.nexus.site.pos;
  const t = game.nexus.telor;
  for (let k = 0; k < 60; k++) {
    const a = k * 0.21;
    const x = c.x + Math.cos(a) * 49;
    const z = c.z + Math.sin(a) * 49;
    const tx = x - Math.sin(a) * 18;
    const tz = z + Math.cos(a) * 18;
    if (game.terrain.heightAt(x, z) < 2 || !t.isClear(x, z, 4) || !t.isClear(tx, tz, 3)) continue;
    // Camera on the ring street, looking along it.
    game.godCam.setPose({ x: tx, z: tz, distance: 18, pitch: 0.3, yaw: Math.atan2(x - tx, z - tz) }, true, game.terrain);
    break;
  }
  game.dayTime = 0.4;
});
await wait(2500);
await shot('10-a-street-by-day');
await p.evaluate(() => {
  const c = game.nexus.site.pos;
  game.godCam.setPose({ x: c.x, z: c.z, distance: 150, pitch: 1.0, yaw: 0.3 }, true, game.terrain);
  game.dayTime = 0.45;
});
await wait(2500);
await shot('10b-telor-from-above-by-day');
await hud(true);

// ---- the true end
await p.evaluate(() => (game.paused = false));
await advance(12);
await p.waitForFunction(() => game.nexus.phase === 'lit', null, { timeout: 30000 }).catch(() => {});
check((await state()).phase === 'lit', 'the true end begins once Telor stands');
const frames = [3, 8, 12, 15, 18, 21, 23.5];
for (const at of frames) {
  await p.waitForFunction((at) => (game.nexus.state().end?.t ?? 0) >= at, at, { timeout: 60000 }).catch(() => {});
  await shot(`11-true-end-${String(at).padStart(4, '0')}s`);
}
report.steps.trueEnd = await state();
check(report.steps.trueEnd.column > 0.9, 'the Nexus lights');
check(report.steps.trueEnd.gather > 0.9, 'the people of Telor gather and look up');
await p.waitForFunction(() => game.nexus.state().end?.card, null, { timeout: 30000 }).catch(() => {});
await wait(6500);
await shot('12-end-card');
report.steps.card = await p.evaluate(() => [...document.querySelectorAll('.endings-card')].map((c) => ({ on: c.classList.contains('on'), title: c.querySelector('.ec-title').textContent, line: c.querySelector('.ec-line').textContent, kicker: c.querySelector('.ec-kicker').textContent, ask: c.querySelector('.ec-ask')?.textContent ?? null, go: c.querySelector('.ec-go-label')?.textContent ?? null, stay: c.querySelector('.ec-stay-label')?.textContent ?? null })));
check(report.steps.card.some((c) => c.on && c.line === 'Some years later, the Nexus opens.' && c.kicker === 'TELOR' && c.ask === 'Would you like to go on to the next game?' && c.go === 'Beyond the Nexus' && c.stay === 'Stay on this island'), 'the end card cuts to the RPG and asks: go on to the next game, or stay');
report.steps.oraLast = await p.evaluate(() => document.querySelector('.endings-ora-line')?.textContent ?? null);
check(report.steps.oraLast === 'They understand you now.', `Ora's last line: they understand you now (got ${report.steps.oraLast})`);
// A click on the card's background decides nothing; the controller's B (Escape) stays on the island.
await p.mouse.click(160, 760);
await wait(1500);
report.steps.cardAfterBackgroundClick = await p.evaluate(() => game.nexus.phase);
check(report.steps.cardAfterBackgroundClick === 'lit', 'a click beside the choices does not close the card');
await p.keyboard.press('Escape');
await p.waitForFunction(() => game.nexus.phase === 'done', null, { timeout: 30000 }).catch(() => {});
await wait(3000);
report.steps.after = { state: await state(), free: await p.evaluate(() => localStorage.getItem('godgame.freeplay') ?? Object.keys(localStorage).filter((k) => k.includes('free') || k.includes('unlock'))) };
check(report.steps.after.state.phase === 'done', 'the island goes on after the card');
await hud(false);
await p.evaluate(() => {
  // Staying on the island: Telor at night.
  const c = game.nexus.site.pos;
  game.godCam.setPose({ x: c.x, z: c.z, distance: 150, pitch: 0.6, yaw: 1.1 }, true, game.terrain);
  game.dayTime = 0.85;
});
await wait(3000);
await shot('13-after-telor-at-night');
await reload();
report.steps.reloadDone = await state();
check(report.steps.reloadDone.phase === 'done' && report.steps.reloadDone.city?.standing === built.buildings, 'after the true end, the island reloads with Telor standing and the age done');

report.said = await p.evaluate(() => window.__said);
report.events = await p.evaluate(() => window.__ev);

// Go on to the next game: the true end again (debug), and Enter (the controller's A) on its card leaves for the RPG.
await p.evaluate(() => game.nexus.debug('end'));
await p.waitForFunction(() => game.nexus.state().end?.card, null, { timeout: 90000 }).catch(() => {});
await wait(6000);
const errorsBefore = errors.length;
const going = p.waitForRequest((r) => r.isNavigationRequest() && /\/rpg\/?$/.test(r.url()), { timeout: 20000 }).then((r) => r.url()).catch(() => null);
await p.keyboard.press('Enter');
report.steps.goOn = await going;
check(!!report.steps.goOn, `A / Enter goes on to the next game (${report.steps.goOn})`);
// The RPG's page lives on the studio site, not in this test's server: its 404 is expected here.
errors.length = errorsBefore;
report.errors = errors;
check(errors.length === 0, `no console errors (${errors.length})`);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ failures: report.failures, errors: errors.slice(0, 5) }, null, 1));
await browser.close();
