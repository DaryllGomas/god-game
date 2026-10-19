// Three polish fixes from Caboose's v0.11 playtest review (2026-10-18), on loki (the TV box):
//   npm run build && loki-run dist scripts/test-polish-1018.mjs <out>
// 1. Lumi warns when a village of yours has people starving: once per village per bout, in her "peek" face, with a
//    cooldown, and never over the Nexus age or the good ending.
// 2. Village name labels stay fully inside the viewport (nudged in, or hidden when mostly out) at wide and close views.
// 3. The prayer line never says "no worshippers": it says why the dance is quiet (night, hungry, gathering...).
// Writes PNGs and report.json; prints the failures (the exit code stays 0 so loki-run still copies the shots back).
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--autoplay-policy=no-user-gesture-required'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { failures: [], notes: {} };
const check = (ok, what) => {
  if (!ok) report.failures.push(what);
  return ok;
};
const errors = [];

/** A fresh page on a fresh island, past the Begin button. `watchStart`: sample the prayer line from the first moment. */
async function boot(opts = {}) {
  const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
  await ctx.addInitScript(() => {
    try {
      for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k);
    } catch {
      /* ignore */
    }
  });
  const p = await ctx.newPage();
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
  await p.waitForFunction(() => window.game, null, { timeout: 120000 });
  await p.evaluate(() => {
    for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
  });
  if (opts.watchStart) {
    await p.evaluate(() => {
      window.startRates = [];
      const t0 = performance.now();
      window.__sampler = setInterval(() => {
        const text = document.querySelector('.power-val .rate')?.textContent;
        const last = window.startRates[window.startRates.length - 1];
        if (text && (!last || last.text !== text)) window.startRates.push({ at: Math.round(performance.now() - t0), text });
      }, 100);
    });
  }
  await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
  await p.waitForFunction(() => game.pace.confirmed, null, { timeout: 60000 });
  return p;
}

/** Everything Lumi and Fizz say from now on: who, words, face. */
const recordSpeech = (p) =>
  p.evaluate(() => {
    const a = game.prayerSystem.advisors;
    a.setMuted(false);
    window.said = [];
    const card = document.querySelector('.talk-card');
    const textEl = card.querySelector('.talk-text');
    new MutationObserver(() => {
      const text = textEl.textContent;
      if (!text) return;
      window.said.push({
        who: card.querySelector('.talk-name').textContent,
        text,
        face: card.dataset.face,
        src: card.querySelector('.talk-face img').getAttribute('src'),
      });
    }).observe(textEl, { childList: true, characterData: true, subtree: true });
    // Hunger helpers: keep `count` of a village's people starving (and the rest fed), its store empty.
    window.starve = (name, count = 99) => {
      window.stopStarve(name, false);
      const v = game.villages.find((x) => x.name === name);
      const tick = () => {
        v.store.food = 0;
        v.villagers.forEach((h, i) => {
          h.hunger = i < count ? 1 : 0;
          h.health = 1;
        });
      };
      tick();
      (window.__st ??= {})[name] = setInterval(tick, 100);
    };
    window.stopStarve = (name, feed = true) => {
      clearInterval((window.__st ??= {})[name]);
      if (!feed) return;
      const v = game.villages.find((x) => x.name === name);
      v.store.food = 300;
      for (const h of v.villagers) h.hunger = 0;
    };
    window.clockFrames = (n, dt = 1) => {
      for (let i = 0; i < n; i++) game.prayerSystem.advisors.frame(dt);
    };
  });
const warnings = (p) =>
  p.evaluate(() => window.said.filter((s) => s.who === 'Lumi' && /is going hungry|is starving/.test(s.text)).map((s) => ({ text: s.text, face: s.face, src: s.src })));
const fizzWords = (p) => p.evaluate(() => window.said.filter((s) => s.who === 'Fizz' && /empty stomach|hungry crowd/.test(s.text)).map((s) => s.text));
const topShot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 360, y: 0, width: 880, height: 200 } });
const hudShot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png`, clip: { x: 0, y: 0, width: 440, height: 340 } });

// ===================================================================== 3. the prayer line
{
  const p = await boot({ watchStart: true });
  await wait(6000);
  const start = await p.evaluate(() => {
    clearInterval(window.__sampler);
    return window.startRates;
  });
  report.prayer = { start };
  check(!start.some((s) => /no worshippers/i.test(s.text)), `start of a game: never "no worshippers" (${JSON.stringify(start)})`);
  await hudShot(p, 'prayer-1-start');

  const read = () =>
    p.evaluate(() => {
      const val = document.querySelector('.power-val');
      const rate = val.querySelector('.rate');
      const panel = val.parentElement;
      const box = (e) => e.getBoundingClientRect().toJSON();
      return { text: rate.textContent, dancers: game.villages.reduce((s, v) => s + v.dancers, 0), height: Math.round(box(val).height), rateRight: Math.round(box(rate).right), valRight: Math.round(box(val).right), night: game.sky.isNight, season: game.seasons.season, panelRight: Math.round(box(panel).right) };
    });
  const states = {};
  // A temple stands (as in the playtest), people fed, midday: the ordinary line.
  await p.evaluate(() => {
    for (const v of game.villages) if (v.owner !== 'player') v.convert(game);
    for (const v of game.villages) game.shrines?.setStage(v, 'temple', true);
    game.dayTime = 0.5;
    game.advance(8);
  });
  states.day = await read();
  await hudShot(p, 'prayer-2-day-dancing');

  // Night, everyone fed: let the people do what they do, and watch the line for a while.
  await p.evaluate(() => {
    for (const v of game.villages) {
      v.store.food = 400;
      for (const h of v.villagers) h.hunger = 0.1;
    }
    game.dayTime = 0.02;
    game.advance(2);
  });
  const natural = [];
  for (let i = 0; i < 8; i++) {
    await p.evaluate(() => game.advance(8));
    natural.push((await read()).text);
  }
  states.nightNatural = [...new Set(natural)];
  await hudShot(p, 'prayer-3-night');

  // Night with nobody dancing (the worship slider at zero): the people are resting.
  await p.evaluate(() => {
    for (const v of game.villages) v.worshipFraction = 0;
    game.dayTime = 0.02;
    game.advance(6);
  });
  states.nightQuiet = await read();
  await hudShot(p, 'prayer-4-night-resting');

  // Winter, midday, snow, people hungry and the store empty: nobody is fit to dance.
  await p.evaluate(() => {
    for (const v of game.villages) {
      v.worshipFraction = 0.5;
      v.store.food = 0;
      for (const h of v.villagers) h.hunger = 0.9;
    }
    game.seasons.jumpTo('winter');
    game.dayTime = 0.5;
    // Newborns arrive fed and would be sent to pray: keep everybody hungry while the roles settle.
    for (let i = 0; i < 4; i++) {
      for (const v of game.villages) for (const h of v.villagers) h.hunger = Math.max(h.hunger, 0.9);
      game.advance(1.5);
    }
  });
  states.winterHungry = await read();
  await hudShot(p, 'prayer-5-winter-hungry');
  await p.screenshot({ path: `${OUT}/prayer-5-winter-hungry-full.png` });

  // Winter, midday, fed, but the slider at zero: simply nobody dancing just now.
  await p.evaluate(() => {
    for (const v of game.villages) {
      v.worshipFraction = 0;
      v.store.food = 400;
      for (const h of v.villagers) h.hunger = 0.1;
    }
    game.advance(6);
  });
  states.winterQuiet = await read();
  await hudShot(p, 'prayer-6-winter-quiet');

  report.prayer.states = states;
  check(/^\+\d/.test(states.day.text) && states.day.dancers > 0, `midday with a temple: the rate shows (${JSON.stringify(states.day)})`);
  check(states.nightNatural.every((t) => !/no worshippers/i.test(t)), `night, fed: no "no worshippers" (${JSON.stringify(states.nightNatural)})`);
  check(states.nightQuiet.night && states.nightQuiet.text === 'resting for the night', `night, nobody dancing: "resting for the night" (${JSON.stringify(states.nightQuiet)})`);
  check(states.winterHungry.text === 'the people are hungry', `winter, hungry: "the people are hungry" (${JSON.stringify(states.winterHungry)})`);
  check(states.winterQuiet.text === 'none dancing just now', `winter, fed, nobody dancing: "none dancing just now" (${JSON.stringify(states.winterQuiet)})`);
  for (const [k, s] of Object.entries(states)) {
    if (Array.isArray(s)) continue;
    check(!/no worshippers/i.test(s.text), `${k}: never "no worshippers"`);
    check(s.height <= 30, `${k}: the prayer line stays on one line (height ${s.height})`);
    check(s.rateRight <= s.valRight + 1, `${k}: the prayer line fits its panel (${s.rateRight} > ${s.valRight})`);
  }
  await p.context().close();
}

// ======================================================================= 2. the village labels
{
  const p = await boot();
  await wait(1500);
  await p.evaluate(() => {
    for (const v of game.villages) if (v.owner !== 'player') v.convert(game);
    for (const v of game.villages) game.shrines?.setStage(v, 'temple', true);
    game.hand.valid = false;
  });
  const W = 1600;
  const H = 900;
  const sweep = await p.evaluate(
    ({ W, H }) => {
      const out = { poses: 0, seen: 0, nudged: 0, hiddenMostlyOut: 0, outside: [], edge: [] };
      const vec = game.godCam.target.clone();
      for (const distance of [720, 450, 260, 120]) {
        const step = distance >= 720 ? 120 : 160;
        const span = distance >= 720 ? 480 : 320;
        for (let x = -span; x <= span; x += step) {
          for (let z = -span / 2; z <= span; z += step) {
            for (const yaw of [0.5, 2.4]) {
              game.godCam.setPose({ x, z, distance, pitch: 0.85, yaw }, true, game.terrain);
              game.advance(0.05);
              game.advance(0.05); // two steps: the label sizes are measured every half second or at the first look
              out.poses++;
              for (const v of game.villages) {
                const label = game.hud.labels.get(v);
                const raw = vec.set(v.center.x, v.center.y + 18, v.center.z).project(game.godCam.camera);
                const rawX = (raw.x * 0.5 + 0.5) * W;
                const hidden = label.style.display === 'none' || label.style.visibility === 'hidden';
                if (hidden) {
                  if (Math.abs(raw.x) < 1.1 && Math.abs(raw.y) < 1.1 && raw.z < 1) out.hiddenMostlyOut++;
                  continue;
                }
                const r = label.getBoundingClientRect();
                out.seen++;
                const nudged = Math.abs((r.left + r.right) / 2 - rawX) > 1.5;
                const outside = r.left < -0.5 || r.top < -0.5 || r.right > W + 0.5 || r.bottom > H + 0.5;
                if (nudged) out.nudged++;
                if (outside && out.outside.length < 8) out.outside.push({ village: v.name, distance, x, z, yaw, rect: [r.left, r.top, r.right, r.bottom].map(Math.round) });
                // Poses worth a picture: a label by the edge (nudged in, or sticking out in the old build).
                if ((nudged || outside) && distance >= 450 && !out.edge.some((e) => e.village === v.name)) out.edge.push({ village: v.name, pose: { x, z, distance, pitch: 0.85, yaw } });
              }
            }
          }
        }
      }
      return out;
    },
    { W, H },
  );
  report.labels = sweep;
  check(sweep.seen > 60, `the label sweep saw labels (${sweep.seen})`);
  check(sweep.outside.length === 0, `every visible village label lies inside the viewport (${sweep.outside.length}+ outside, first: ${JSON.stringify(sweep.outside.slice(0, 3))})`);
  check(sweep.nudged > 0, `the sweep made at least one label nudge in (${sweep.nudged})`);

  // The labels still follow their villages: a small move of the camera moves the label by about what the village moved.
  const follow = await p.evaluate(() => {
    const v = game.villages[0];
    const vec = game.godCam.target.clone();
    const at = (x) => {
      game.godCam.setPose({ x, z: v.center.z, distance: 260, pitch: 0.85, yaw: 0.5 }, true, game.terrain);
      game.advance(0.05);
      const raw = vec.set(v.center.x, v.center.y + 18, v.center.z).project(game.godCam.camera);
      const label = game.hud.labels.get(v);
      const r = label.getBoundingClientRect();
      return { raw: (raw.x * 0.5 + 0.5) * 1600, label: (r.left + r.right) / 2, shown: label.style.display !== 'none' && label.style.visibility !== 'hidden' };
    };
    return [at(v.center.x - 30), at(v.center.x - 20), at(v.center.x - 10)];
  });
  report.labels.follow = follow;
  check(follow.every((f) => f.shown && Math.abs(f.raw - f.label) < 1.5), `a village in the middle of the screen: its label sits right on it (${JSON.stringify(follow)})`);

  // Screenshots: a wide view with a village at each edge, and a close temple with its label over the glow.
  const shots = await p.evaluate(() => {
    const a = game.villages.find((v) => v.name === 'Ashford').center;
    const s = game.villages.find((v) => v.name === 'Stonemere').center;
    return { a: { x: a.x, z: a.z }, s: { x: s.x, z: s.z } };
  });
  // Wide views with a label by the edge (the poses the sweep found), then the middle of the island.
  for (const [i, pose] of [
    ...sweep.edge.slice(0, 3).map((e) => e.pose),
    { x: (shots.a.x + shots.s.x) / 2, z: (shots.a.z + shots.s.z) / 2, distance: 720, pitch: 0.85, yaw: 0.5 },
  ].entries()) {
    await p.evaluate((pose) => {
      game.godCam.setPose(pose, true, game.terrain);
      game.advance(0.05);
      game.advance(0.05);
    }, pose);
    await wait(400);
    await p.screenshot({ path: `${OUT}/labels-wide-${i + 1}.png` });
  }
  await p.evaluate((s) => {
    game.godCam.setPose({ x: s.x - 6, z: s.z + 30, distance: 130, pitch: 0.85, yaw: 0.5 }, true, game.terrain);
    game.advance(0.05);
    game.advance(0.05);
  }, shots.s);
  await wait(500);
  await p.screenshot({ path: `${OUT}/labels-temple-glow.png`, clip: { x: 500, y: 100, width: 600, height: 340 } });
  await p.context().close();
}

// ======================================================================= 1. Lumi's hunger warning
{
  const p = await boot();
  await recordSpeech(p);
  await wait(2500);
  const h = (report.hunger = {});

  // One person starving in Ashford: the gentle line, in her "peek" face. Fizz may follow (the dice are loaded to say yes).
  await p.evaluate(() => {
    window.said.length = 0;
    window.starve('Ashford', 1);
  });
  await p.waitForFunction(() => game.villages.find((v) => v.name === 'Ashford').starving === 1, null, { timeout: 30000 });
  await p.evaluate(() => {
    const o = Math.random;
    Math.random = () => 0.01;
    try {
      window.clockFrames(6);
    } finally {
      Math.random = o;
    }
  });
  await p.waitForFunction(() => window.said.some((s) => s.who === 'Lumi' && /Ashford/.test(s.text)), null, { timeout: 40000 }).catch(() => {});
  await wait(900);
  await topShot(p, 'hunger-1-lumi-peek');
  await p.waitForFunction(() => window.said.some((s) => s.who === 'Fizz'), null, { timeout: 20000 }).catch(() => {});
  await wait(900);
  await topShot(p, 'hunger-2-fizz-after');
  await wait(6000);
  h.first = { lumi: await warnings(p), fizz: await fizzWords(p), inSequence: await p.evaluate(() => game.prayerSystem.advisors.inSequence?.()) };
  check(h.first.inSequence === false, `ordinary play is not "in a sequence"`);
  check(h.first.lumi.length === 1, `one starving villager: Lumi warns once (${JSON.stringify(h.first.lumi)})`);
  check(h.first.lumi[0]?.text === 'Ashford is going hungry. They need bread, and soon.', `the gentle line names the village (${h.first.lumi[0]?.text})`);
  check(h.first.lumi[0]?.face === 'peek' && /lumi-peek-/.test(h.first.lumi[0]?.src ?? ''), `her face is "peek", not "cheer" (${JSON.stringify(h.first.lumi[0])})`);
  check(h.first.fizz.length === 1, `Fizz had a dry word after hers (${JSON.stringify(h.first.fizz)})`);
  check(!/\b(don't|can't|won't|isn't|aren't|doesn't|didn't|I'm|it's|that's|there's|let's)\b/i.test(h.first.lumi[0]?.text ?? ''), `no contractions in Lumi's line`);

  // Still starving for 150 more seconds of the clock: no second warning (once per bout).
  await p.evaluate(() => window.clockFrames(100));
  await wait(7000);
  h.stillStarving = (await warnings(p)).length;
  check(h.stillStarving === 1, `still starving 100 s later: no second warning (${h.stillStarving} in all)`);

  // The bout ends (fed, 25 s calm), a new one begins soon after: inside the cooldown, nothing.
  await p.evaluate(() => window.stopStarve('Ashford'));
  await p.waitForFunction(() => game.villages.find((v) => v.name === 'Ashford').starving === 0, null, { timeout: 30000 });
  await p.evaluate(() => window.clockFrames(25));
  await p.evaluate(() => window.starve('Ashford'));
  await p.waitForFunction(() => game.villages.find((v) => v.name === 'Ashford').starving > 1, null, { timeout: 30000 });
  await p.evaluate(() => window.clockFrames(20));
  await wait(5000);
  h.insideCooldown = (await warnings(p)).length;
  check(h.insideCooldown === 1, `a new bout inside the cooldown: still just the one warning (${h.insideCooldown})`);

  // Past the cooldown, the same bout (still starving) gets its word: more than one starving, so the other line.
  await p.evaluate(() => {
    const o = Math.random;
    Math.random = () => 0.99; // Fizz stays quiet this time
    try {
      window.clockFrames(230);
    } finally {
      Math.random = o;
    }
  });
  await p.waitForFunction(() => window.said.filter((s) => s.who === 'Lumi' && /starving/.test(s.text)).length > 0, null, { timeout: 40000 }).catch(() => {});
  await wait(900);
  await topShot(p, 'hunger-3-lumi-second-bout');
  await wait(5000);
  h.second = await warnings(p);
  check(h.second.length === 2, `after the cooldown, the second bout gets its warning (${h.second.length} in all)`);
  check(h.second[1]?.text === 'Ashford is starving. Please, can you help them?', `with many starving: the other line (${h.second[1]?.text})`);
  check(h.second[1]?.face === 'peek', `second line: "peek" face (${h.second[1]?.face})`);
  check(!/\b(don't|can't|won't|isn't|aren't|doesn't|didn't|I'm|it's|that's|there's|let's)\b/i.test(h.second[1]?.text ?? ''), `no contractions in the second line`);
  await p.evaluate(() => window.stopStarve('Ashford'));

  // A village of yours that is not Ashford gets its own warning by name.
  await p.evaluate(() => {
    game.villages.find((v) => v.name === 'Brambleholt').convert(game);
    window.starve('Brambleholt', 1);
  });
  await p.waitForFunction(() => game.villages.find((v) => v.name === 'Brambleholt').starving === 1, null, { timeout: 30000 });
  await p.evaluate(() => window.clockFrames(70));
  await p.waitForFunction(() => window.said.some((s) => /Brambleholt is going hungry/.test(s.text)), null, { timeout: 40000 }).catch(() => {});
  h.brambleholt = await p.evaluate(() => window.said.filter((s) => /Brambleholt/.test(s.text)).map((s) => s.text));
  check(h.brambleholt.some((t) => t === 'Brambleholt is going hungry. They need bread, and soon.'), `another village is named (${JSON.stringify(h.brambleholt)})`);
  await p.evaluate(() => window.stopStarve('Brambleholt'));

  // A village that is not yours, starving: Lumi has nothing to say (a neutral village is not her worry).
  await wait(8000); // let Brambleholt's cards finish first
  const before = (await warnings(p)).length;
  await p.evaluate(() => window.starve('Stonemere', 5));
  await p.waitForFunction(() => game.villages.find((v) => v.name === 'Stonemere').starving > 0, null, { timeout: 30000 });
  await p.evaluate(() => window.clockFrames(100));
  await wait(4000);
  h.neutral = { before, after: (await warnings(p)).length };
  check(h.neutral.after === before, `a village that is not yours: no warning (${JSON.stringify(h.neutral)})`);
  await p.evaluate(() => window.stopStarve('Stonemere'));
  await p.context().close();
}

// Never over the Nexus age: the last age begins and Ashford starves.
{
  const p = await boot();
  await recordSpeech(p);
  await wait(1500);
  const h = (report.hungerNexus = {});
  h.begin = await p.evaluate(() => game.nexus.debug('nexus'));
  await wait(1500);
  await p.evaluate(() => {
    window.said.length = 0;
    window.starve('Ashford', 99);
  });
  await p.waitForFunction(() => game.villages.find((v) => v.name === 'Ashford').starving > 0, null, { timeout: 30000 });
  h.phase = await p.evaluate(() => game.nexus.phase);
  h.guard = await p.evaluate(() => ({ inSequence: game.prayerSystem.advisors.inSequence?.(), muted: game.prayerSystem.advisors.muted }));
  await p.evaluate(() => window.clockFrames(200));
  await wait(6000);
  h.nexusWarnings = await warnings(p);
  check(h.phase === 'ring', `the last age is under way (phase ${h.phase})`);
  check(h.guard.inSequence && !h.guard.muted, `the guard is what holds them back, not the mute (${JSON.stringify(h.guard)})`);
  check(h.nexusWarnings.length === 0, `no hunger warning over the Nexus age (${JSON.stringify(h.nexusWarnings)})`);
  await p.context().close();
}

// ...nor over the good ending.
{
  const p = await boot();
  await recordSpeech(p);
  await wait(1500);
  const h = (report.hungerEnding = {});
  await p.evaluate(() => {
    for (const v of game.villages) if (v.owner !== 'player') v.convert(game);
    game.endings.debug('ready');
    game.prayerSystem.advisors.muted = false; // an ending mutes them (and restores it later): let them speak, to test the guard itself
    window.said.length = 0;
    window.starve('Ashford', 99);
  });
  await p.waitForFunction(() => game.villages.find((v) => v.name === 'Ashford').starving > 0, null, { timeout: 30000 });
  h.phase = await p.evaluate(() => game.endings.phase);
  h.guard = await p.evaluate(() => ({ inSequence: game.prayerSystem.advisors.inSequence?.(), muted: game.prayerSystem.advisors.muted }));
  await p.evaluate(() => window.clockFrames(200));
  await wait(6000);
  h.warnings = await warnings(p);
  check(['ready', 'whole', 'card'].includes(h.phase), `the good ending is under way (phase ${h.phase})`);
  check(h.guard.inSequence && !h.guard.muted, `the guard is what holds them back, not the mute (${JSON.stringify(h.guard)})`);
  check(h.warnings.length === 0, `no hunger warning over the good ending (${JSON.stringify(h.warnings)})`);
  await p.context().close();
}

report.errors = errors.slice(0, 10);
check(errors.length === 0, `no page errors (${errors.slice(0, 3).join(' | ')})`);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ failures: report.failures, errors: errors.length }, null, 1));
await browser.close();
