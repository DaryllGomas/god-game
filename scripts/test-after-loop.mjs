// After the true end (2026-10-18): the gentle loop, on the render box:
//   npm run build && atlas-run dist scripts/test-after-loop.mjs <out> [quick]
// A fresh story-mode island is taken to the true end (debug) and stays. Then: the season's festival is asked by itself
// (Ora names it), granted the real way (the hand drops what it asked for in Telor) and celebrated to its end; the other
// three festivals are asked, granted and celebrated (screenshots of each at its height); a boat of newcomers comes in
// and the family walks up to where their house will stand; the city grows a lane, houses and a garden at its edge and
// the family goes in; neglect (no care for 10 game minutes) grows nothing and loses nobody; saves mid-season,
// mid-celebration and mid-growth reload where they were; a save from before this loop existed starts it fresh.
// Screenshots of every step; report.json.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const QUICK = process.argv.includes('quick');
const SIZE = { width: 1600, height: 900 };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { failures: [], steps: {}, said: [], perf: {} };
const check = (ok, what) => {
  if (!ok) report.failures.push(what);
  return ok;
};
const ctx = await browser.newContext({ viewport: SIZE });
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
      if (t) log.push({ who: 'Ora', text: t });
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
    for (const k of ['telorFestival', 'telorGrew', 'telorBoat', 'trueEnd']) game.events.on(k, (d) => ev.push({ k, d, t: Math.round(game.time) }));
  });
const start = async (cont = false) => {
  await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
  await p.waitForFunction(() => window.game, null, { timeout: 120000 });
  await unhide();
  await p.getByText(cont ? 'Continue' : 'Begin', { exact: false }).first().click({ timeout: 20000 });
  await p.waitForFunction(() => game.saves.armed, null, { timeout: 60000 });
  await listen();
};
const keepSaid = async () => report.said.push(...(await p.evaluate(() => window.__said ?? [])));
const reload = async () => {
  await keepSaid();
  await p.evaluate(() => {
    game.saves.save('quiet');
    sessionStorage.setItem('test.keep', '1');
  });
  await start(true);
  await p.evaluate(() => sessionStorage.removeItem('test.keep'));
};
const shot = async (name) => {
  // The hand is not in the pictures.
  await p.evaluate(() => (game.input.inside = false));
  await wait(120);
  await p.screenshot({ path: `${OUT}/${name}.png` });
};
const hud = (on) => p.evaluate((on) => (document.querySelector('.hud').style.opacity = on ? '' : '0'), on);
const hold = (on = true) => p.evaluate((on) => (game.paused = on), on);
const pose = (o, hour = null) =>
  p.evaluate(
    ([o, hour]) => {
      const s = game.nexus.site.pos;
      game.godCam.setPose({ x: (o.x ?? s.x) + (o.dx ?? 0), z: (o.z ?? s.z) + (o.dz ?? 0), distance: o.d, pitch: o.pitch ?? 0.8, yaw: o.yaw ?? 0.5 }, true, game.terrain);
      if (hour !== null) game.dayTime = hour;
    },
    [o, hour],
  );
const state = () => p.evaluate(() => game.after.state());
const advance = (s) => p.evaluate((s) => game.advance(s), s);
const debug = (k, a) => p.evaluate(([k, a]) => game.after.debug(k, a), [k, a]);
const perf = async (name) => {
  report.perf[name] = await p.evaluate(
    () =>
      new Promise((res) => {
        let n = 0;
        const t0 = performance.now();
        const info = game.renderer.info;
        const f = () => {
          if (++n < 60) {
            if (n === 59) {
              info.autoReset = false;
              info.reset();
            }
            requestAnimationFrame(f);
          } else {
            const out = { fps: Math.round((58000 / (performance.now() - t0)) * 10) / 10, calls: info.render.calls, tris: info.render.triangles };
            info.autoReset = true;
            res(out);
          }
        };
        requestAnimationFrame(f);
      }),
  );
};
/** The hand drops what the festival asked for onto Telor's plaza, the way a player would. */
const give = (what) =>
  p.evaluate((what) => {
    const c = game.nexus.site.pos;
    const at = { x: c.x + 21, y: game.terrain.heightAt(c.x + 21, c.z + 4), z: c.z + 4 };
    game.player.addPower(3000);
    if (game.hand.held) game.setDownHeld();
    if (what === 'timber') {
      const tree = game.entities.filter((e) => e.kind === 'tree' && e.alive && !e.held).sort((a, b) => Math.hypot(a.pos.x - c.x, a.pos.z - c.z) - Math.hypot(b.pos.x - c.x, b.pos.z - c.z))[0];
      if (!tree) return 'no tree';
      game.hand.grab(game, tree);
    } else game.selectMiracle(what === 'rain' ? 'water' : what);
    const held = game.hand.held?.kind ?? null;
    game.hand.place(game, at);
    return held;
  }, what);

// ---- a fresh island, taken to the true end, and staying
await start();
await p.waitForFunction(() => game.pace.confirmed && game.story.active, null, { timeout: 60000 });
report.steps.before = await state();
check(!report.steps.before.active && !report.steps.before.started, 'before the true end the loop is off');
await p.evaluate(() => game.nexus.debug('nexus'));
await wait(800);
await p.evaluate(() => game.nexus.debug('ring'));
await p.waitForFunction(() => game.nexus.phase === 'city', null, { timeout: 60000 }).catch(() => {});
await p.evaluate(() => game.nexus.debug('end'));
await p.waitForFunction(() => game.nexus.state().end?.card, null, { timeout: 180000 }).catch(() => {});
await wait(6500);
await p.keyboard.press('Escape');
await p.waitForFunction(() => game.nexus.phase === 'done', null, { timeout: 60000 }).catch(() => {});
await advance(1);
report.steps.stayed = await state();
check(report.steps.stayed.active && report.steps.stayed.started, `staying after the true end starts the loop (${JSON.stringify(report.steps.stayed).slice(0, 200)})`);
check(report.steps.stayed.growth?.planned >= 20, `Telor has room to grow (${report.steps.stayed.growth?.planned} steps planned)`);
check(!!report.steps.stayed.boat?.landing, 'a shore for the boats');
await hold();
await hud(false);
await pose({ d: 330, pitch: 0.95, yaw: 0.5 }, 0.42);
await wait(2500);
await shot('00-telor-after-the-true-end');
await perf('telor-quiet');

// ---- the season's festival asks by itself; Ora names it; the hand gives it; it is celebrated to its end
await hold(false);
await advance(80);
await wait(4500);
report.steps.asked = await state();
const first = report.steps.asked.festival;
check(first?.phase === 'asked', `the season's festival is asked a little after staying (${JSON.stringify(first)})`);
report.steps.oraAsk = await p.evaluate(() => game.ora.state().showing ?? game.ora.state().guide);
check(!!report.steps.oraAsk && report.steps.oraAsk.length > 10, `Ora names it (${report.steps.oraAsk})`);
await hud(true);
await pose({ d: 140, pitch: 0.75, yaw: 0.6 }, 0.45);
await wait(1800);
await shot(`01-${first?.kind}-asked-ora-names-it`);
report.steps.chip = (await state()).chip;
check(!!report.steps.chip, `a chip over the Nexus shows the festival (${report.steps.chip})`);
await hud(false);
const kindOf = { spring: 'rain', summer: 'food', autumn: 'timber', winter: 'fire' };
report.steps.gave = await give(kindOf[first.kind]);
await advance(4);
report.steps.granted = await state();
check(['ready', 'on'].includes(report.steps.granted.festival?.phase), `the hand gives it and Telor gets ready (${report.steps.granted.festival?.phase}, held ${report.steps.gave})`);
if (['autumn', 'winter'].includes(first.kind)) await p.evaluate(() => (game.dayTime = 0.8));
await advance(6);
report.steps.begun = await state();
check(report.steps.begun.festival?.phase === 'on', `the celebration begins (${report.steps.begun.festival?.phase})`);
await advance(30);
report.steps.party = await state();
check(report.steps.party.crowd >= 80, `the people gather round the Nexus (${report.steps.party.crowd})`);
await hold();
const HOUR = { spring: 0.7, summer: 0.765, autumn: 0.82, winter: 0.84 };
await pose({ d: 62, pitch: 0.42, yaw: 0.9 }, HOUR[first.kind]);
await hold(false);
await wait(3000);
await hold();
await shot(`02-${first.kind}-celebrated`);
await perf('festival-on');
await hold(false);
await advance(100);
report.steps.over = await state();
check(!report.steps.over.festival && report.steps.over.doneKey >= report.steps.asked.key, `the celebration ends and the season is done (${JSON.stringify(report.steps.over.festival)}, done ${report.steps.over.doneKey})`);
check(report.steps.over.crowd === 0, `everyone goes home (${report.steps.over.crowd})`);
await hold();
await pose({ d: 62, pitch: 0.42, yaw: 0.9 }, HOUR[first.kind]);
await wait(1500);
await perf('festival-off-same-view');
await hold(false);

// ---- each festival at its height (forced to the season, granted by hand)
const kinds = QUICK ? ['winter'] : ['spring', 'summer', 'autumn', 'winter'];
report.steps.festivals = {};
let n = 3;
for (const kind of kinds) {
  if (kind === first.kind && !QUICK) continue;
  const r = (report.steps.festivals[kind] = {});
  await hold(false);
  await p.evaluate((k) => game.seasons.jumpTo(k, 0.36), kind);
  await advance(2);
  r.ask = await debug('festival', kind);
  await wait(800);
  if (kind === 'summer' || kind === 'winter') {
    await hold();
    await hud(true);
    await pose({ d: 55, pitch: 0.55, yaw: 1.2 }, kind === 'winter' ? 0.62 : 0.4);
    await wait(2200);
    await shot(`${String(n++).padStart(2, '0')}-${kind}-asked`);
    await hud(false);
    await hold(false);
  }
  if (kind === 'autumn') await p.evaluate(() => (game.dayTime = 0.5));
  r.gave = await give(kindOf[kind]);
  await advance(4);
  r.granted = (await state()).festival?.phase;
  check(['ready', 'on'].includes(r.granted), `${kind}: given by hand, it is granted (${r.granted}, held ${r.gave})`);
  if (kind === 'autumn') {
    await advance(12);
    r.waitsForDark = (await state()).festival?.phase;
    check(r.waitsForDark === 'ready', `Lantern Night waits for dark (${r.waitsForDark})`);
    await p.evaluate(() => (game.dayTime = 0.8));
  }
  if (kind === 'winter') await p.evaluate(() => (game.dayTime = 0.82));
  await advance(5);
  r.phase = (await state()).festival?.phase;
  check(r.phase === 'on', `${kind}: the celebration begins (${r.phase})`);
  const at = { spring: 40, summer: 40, autumn: 66, winter: 34 }[kind];
  await debug('celebrate', at);
  await advance(1);
  await hold();
  const views = {
    spring: [{ d: 58, pitch: 0.4, yaw: 2.4 }, { d: 140, pitch: 0.85, yaw: 0.5 }],
    summer: [{ d: 52, pitch: 0.46, yaw: 0.4 }, { d: 120, pitch: 0.8, yaw: 2.0 }],
    autumn: [{ d: 78, pitch: 0.52, yaw: 1.7 }, { d: 190, pitch: 0.5, yaw: 0.8 }],
    winter: [{ d: 64, pitch: 0.34, yaw: 2.9 }, { d: 260, pitch: 0.22, yaw: 1.1 }],
  }[kind];
  for (const [vi, v] of views.entries()) {
    await pose(v, HOUR[kind]);
    await hold(false);
    await wait(kind === 'winter' ? 5200 : 2600);
    await hold();
    await shot(`${String(n++).padStart(2, '0')}-${kind}-${vi ? 'over-the-city' : 'at-its-height'}`);
  }
  r.state = await state();
  if (kind === 'winter') {
    await hold(false);
    for (let i = 0; i < 20 && !(await state()).lines.said.includes('after-party-winter'); i++) await wait(2000);
    await wait(1500);
    const said = await p.evaluate(() => window.__said.map((l) => l.text));
    r.fireworksLine = said.find((t) => t.startsWith('Fireworks!')) ?? null;
    check(!!r.fireworksLine, 'at Midwinter the fireworks go up and Fizz says he said so');
    check(said.some((t) => t.startsWith('In brackets.')), "Fizz: brackets don't count");
    // The finale.
    await debug('celebrate', 92);
    await pose({ d: 280, pitch: 0.22, yaw: 1.6 }, 0.86);
    await wait(5500);
    await hold();
    await shot(`${String(n++).padStart(2, '0')}-winter-finale`);
    await hold(false);
  }
  if (kind === 'autumn') {
    await perf('lantern-night');
  }
  await debug('celebrate', 117);
  await advance(3);
  r.over = !(await state()).festival;
  check(r.over, `${kind}: it ends`);
}

// ---- a boat of newcomers
await hold(false);
for (let i = 0; i < 14 && (await state()).boat.phase !== 'off'; i++) await advance(10);
await p.evaluate(() => game.seasons.jumpTo('spring', 0.6));
await advance(2);
await p.evaluate(() => (game.dayTime = 0.6));
report.steps.boat = { send: await debug('boat') };
check(report.steps.boat.send === 'sailing', `a boat sets out (${report.steps.boat.send})`);
await advance(26);
const L = (await state()).boat.landing;
await hold();
await p.evaluate(() => {
  // Over the boat, looking in toward the shore.
  const b = game.after.boat;
  const m = b.mesh.matrix.elements;
  game.godCam.setPose({ x: m[12], z: m[14], distance: 70, pitch: 0.42, yaw: game.godCam.getPose().yaw }, true, game.terrain);
});
await hold(false);
await wait(2500);
await hold();
await shot(`${String(n++).padStart(2, '0')}-a-boat-comes-in`);
await hold(false);
await advance(22);
report.steps.boat.moored = await state();
check(report.steps.boat.moored.boat.phase === 'moored' || report.steps.boat.moored.families.some((f) => f.phase === 'walk'), `the boat lies in at the shore (${report.steps.boat.moored.boat.phase})`);
await advance(8);
report.steps.boat.walking = (await state()).families;
check(report.steps.boat.walking.some((f) => f.phase === 'walk' || f.phase === 'wait'), `the family walks up (${JSON.stringify(report.steps.boat.walking)})`);
await p.evaluate((L) => game.godCam.setPose({ x: L.shore[0], z: L.shore[1], distance: 60, pitch: 0.5, yaw: Math.atan2(L.water[0] - L.shore[0], L.water[1] - L.shore[1]) }, true, game.terrain), L);
await hold(false);
await wait(2200);
await hold();
await shot(`${String(n++).padStart(2, '0')}-the-family-comes-ashore`);
await hold(false);
await advance(120);
report.steps.boat.waiting = (await state()).families;

// ---- the city grows at its edge; the family goes in when their house stands
const growView = (from, to, top = false) =>
  p.evaluate(
    ([from, to, top]) => {
      // The steps about to grow (or just grown): from above the city, looking out over them.
      const items = game.after.growth.items.slice(from, to).filter((i) => i.kind !== 'lane');
      const c = game.nexus.site.pos;
      const x = items.reduce((a, i) => a + i.x, 0) / Math.max(1, items.length);
      const z = items.reduce((a, i) => a + i.z, 0) / Math.max(1, items.length);
      game.godCam.setPose({ x, z, distance: top ? 190 : 120, pitch: top ? 1.15 : 0.66, yaw: Math.atan2(c.x - x, c.z - z) }, true, game.terrain);
      game.dayTime = 0.6;
    },
    [from, to, top],
  );
const g0 = (await state()).growth;
await hold();
await growView(g0.done, g0.done + 12, true);
await wait(2200);
await shot(`${String(n++).padStart(2, '0')}-the-edge-of-telor-before`);
await hold(false);
const grew = [];
for (let i = 0; i < (QUICK ? 6 : 10); i++) {
  const k = await debug('grow');
  await advance(6);
  grew.push(k);
  if (i === 1) {
    // A house rising.
    await debug('grow');
    await advance(1.2);
    grew.push('house?');
    await hold();
    await growView(g0.done, g0.done + 8);
    await wait(1600);
    await shot(`${String(n++).padStart(2, '0')}-a-house-rises`);
    await hold(false);
    await advance(5);
  }
}
report.steps.grew = { steps: grew, growth: (await state()).growth };
check(grew.includes('lane') && grew.includes('house') && grew.includes('garden'), `the city grows a lane, a house and a garden (${grew.join(', ')})`);
check(report.steps.grew.growth.done >= g0.done + 8, `each step stands (${g0.done} -> ${report.steps.grew.growth.done})`);
await advance(40);
report.steps.home = await state();
const evs = await p.evaluate(() => window.__ev);
check(evs.some((e) => e.k === 'telorBoat' && e.d.phase === 'home'), 'the family goes into their new house');
await hold();
await growView(g0.done, g0.done + 12, true);
await wait(2200);
await shot(`${String(n++).padStart(2, '0')}-the-edge-of-telor-after`);
await growView(g0.done, g0.done + 12);
await wait(2200);
await shot(`${String(n++).padStart(2, '0')}-the-edge-of-telor-close`);
await p.evaluate(() => {
  const s = game.nexus.site.pos;
  game.godCam.setPose({ x: s.x, z: s.z, distance: 420, pitch: 0.95, yaw: 0.5 }, true, game.terrain);
  game.dayTime = 0.8;
});
await wait(2500);
await shot(`${String(n++).padStart(2, '0')}-telor-has-grown-dusk`);
await hold(false);

// ---- neglect: no care for ten game minutes: nothing grows, nobody leaves, nothing is lost
await debug('care', 0);
// Nobody tends: the golem dozes too (it carries timber to the stores, which counts as tending).
await p.evaluate(() => {
  window.__golemUpdate = game.creature.update;
  game.creature.update = () => {};
});
const before = await p.evaluate(() => ({ after: game.after.state(), telor: game.nexus.telor.counts() }));
await advance(QUICK ? 200 : 600);
const after = await p.evaluate(() => ({ after: game.after.state(), telor: game.nexus.telor.counts() }));
await p.evaluate(() => (game.creature.update = window.__golemUpdate));
report.steps.careFrom = { before: before.after.careFrom, after: after.after.careFrom };
report.steps.neglect = { before: { growth: before.after.growth, families: before.after.families, telor: before.telor }, after: { growth: after.after.growth, families: after.after.families, telor: after.telor, care: after.after.care } };
check(after.after.growth.done === before.after.growth.done, `neglected, Telor stops growing (${before.after.growth.done} -> ${after.after.growth.done})`);
check(after.telor.standing === before.telor.standing && after.telor.walkers === before.telor.walkers, 'neglected, nothing in Telor is lost');
check(after.after.families.length >= before.after.families.length, `neglected, no family leaves (${before.after.families.length} -> ${after.after.families.length})`);
await hold();
await growView(g0.done, g0.done + 8);
await wait(2200);
await shot(`${String(n++).padStart(2, '0')}-neglected-nothing-lost`);
await hold(false);

// ---- saves: mid-season (a festival asked), mid-celebration, mid-growth; and a save from before the loop
await debug('care', 3);
const ask = await debug('festival');
await wait(4000);
const s1 = await state();
await reload();
await wait(4500);
const s2 = await state();
const fam = (st) => st.families.filter((f) => f.phase !== 'in').length;
report.steps.reloadAsked = { before: s1.festival, after: s2.festival, growth: [s1.growth.done, s2.growth.done], families: [fam(s1), fam(s2)] };
check(s2.festival?.kind === s1.festival?.kind && s2.festival?.phase === 'asked', `a save mid-season reloads with the festival still asked (${ask}: ${s1.festival?.phase} -> ${s2.festival?.phase})`);
check(s2.growth.done === s1.growth.done + (s1.growth.rising ? 1 : 0) && fam(s2) === fam(s1), `the same city and the same families after a reload (${s1.growth.done}/${fam(s1)} -> ${s2.growth.done}/${fam(s2)})`);
await hud(true);
await pose({ d: 150, pitch: 0.75, yaw: 0.6 }, 0.5);
await wait(2000);
await shot(`${String(n++).padStart(2, '0')}-reloaded-mid-season`);
await hud(false);
await debug('celebrate', 50);
await advance(1);
const s3 = await state();
const grow = await debug('grow');
await advance(0.5);
const s4 = await state();
await reload();
await advance(0.2);
const s5 = await state();
await wait(4500);
report.steps.reloadParty = { before: s3.festival, after: s5.festival, grow, growth: [s4.growth, s5.growth] };
check(s5.festival?.phase === 'on' && Math.abs(s5.festival.t - s4.festival.t) < 3, `a save mid-celebration reloads mid-celebration (${s4.festival?.t} -> ${s5.festival?.t})`);
check(s5.growth.done === s4.growth.done + (s4.growth.rising ? 1 : 0), `a save mid-growth reloads with that step standing (${s4.growth.done}${s4.growth.rising ? '+1' : ''} -> ${s5.growth.done})`);
await hold();
await pose({ d: 70, pitch: 0.4, yaw: 2.0 }, 0.8);
await hold(false);
await wait(2500);
await hold();
await shot(`${String(n++).padStart(2, '0')}-reloaded-mid-celebration`);
await hold(false);

// A save from before this loop existed (the true end done, no 'after' in it): it starts fresh, nothing else changes.
await keepSaid();
await p.evaluate(() => {
  game.saves.save('quiet');
  game.saves.freeze();
  const k = 'godgame.save.v1';
  const d = JSON.parse(localStorage.getItem(k));
  delete d.plugins.after;
  localStorage.setItem(k, JSON.stringify(d));
  sessionStorage.setItem('test.keep', '1');
});
await start(true);
await p.evaluate(() => sessionStorage.removeItem('test.keep'));
await advance(1);
report.steps.oldSave = { state: await state(), nexus: await p.evaluate(() => game.nexus.state().phase), telor: await p.evaluate(() => game.nexus.telor?.counts()) };
check(report.steps.oldSave.nexus === 'done' && report.steps.oldSave.state.started && !report.steps.oldSave.state.festival && report.steps.oldSave.state.growth.done === 0, `an older save after the true end loads as it was and starts the loop fresh (${JSON.stringify(report.steps.oldSave.state.growth)})`);

await keepSaid();
report.events = await p.evaluate(() => window.__ev);
report.errors = errors;
check(errors.length === 0, `no console errors (${errors.length}: ${errors.slice(0, 3).join(' | ')})`);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 1));
console.log(JSON.stringify({ failures: report.failures, errors: errors.slice(0, 5), perf: report.perf }, null, 1));
await browser.close();
