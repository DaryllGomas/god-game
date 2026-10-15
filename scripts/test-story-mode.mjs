// Story mode and free play, on the render box: `npm run build && atlas-run dist scripts/test-story-mode.mjs <out>`.
// Screens: Ora's first goal, the light on a goal, a goal completing into the next, a stuck re-nudge, the reach
// to Brambleholt, and the Story / Free play choice once unlocked; at 1920x1080 and 1280x800.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--autoplay-policy=no-user-gesture-required'],
});
const OUT = process.env.OUT_DIR;
const evidence = {};
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};

async function open(size, query) {
  const ctx = await browser.newContext({ viewport: size });
  const p = await ctx.newPage();
  const errors = [];
  p.on('pageerror', (e) => errors.push(String(e)));
  p.on('console', (m) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  await p.goto(`${process.env.SITE_URL}/index.html?shot=default${query}`);
  await p.waitForFunction(() => window.game, null, { timeout: 120000 });
  await p.evaluate(() => {
    for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
  });
  await p.getByText('Begin', { exact: false }).first().click({ timeout: 10000 });
  await p.evaluate(() => {
    game.audio.setMuted(true);
  });
  await p.mouse.move(size.width / 2, size.height * 0.62);
  return { ctx, p, errors };
}

/** Wait for Ora to show a line containing `text` (or any line), then let it fade in. */
async function oraSays(p, text, timeout = 60000) {
  await p.waitForFunction(
    (t) => {
      const s = game.ora.state().showing;
      return !!s && (!t || s.includes(t)) && document.querySelector('.ora.show') && !document.querySelector('.ora.away');
    },
    text,
    { timeout },
  );
  await p.waitForTimeout(2000);
  return p.evaluate(() => game.ora.state().showing);
}

const look = (p, x, z, distance = 150) =>
  p.evaluate(([x, z, distance]) => game.godCam.setPose({ x, z, distance, pitch: 0.8, yaw: 0.5 }, true), [x, z, distance]);

for (const size of [
  { width: 1920, height: 1080 },
  { width: 1280, height: 800 },
]) {
  const tag = `${size.width}x${size.height}`;
  const e = (evidence[tag] = {});

  // ---- Story mode on a first island (free play locked).
  {
    const { ctx, p, errors } = await open(size, '&unlock=story');
    await p.waitForFunction(() => game.pace.confirmed, null, { timeout: 60000 });
    e.pace = await p.evaluate(() => ({ mode: game.pace.mode, choice: game.pace.choice, marksUp: game.pace.group.visible }));
    check(e.pace.mode === 'story' && e.pace.choice === 'walk', `${tag}: story mode by default`);
    e.first = await oraSays(p, 'Ashford');
    await p.screenshot({ path: `${OUT}/${tag}-1-ora-first-goal.png` });
    e.firstState = await p.evaluate(() => game.story.state());
    check(e.firstState.goal?.id === 'answer', `${tag}: first goal is answer`);
    await p.waitForTimeout(6000);
    await p.screenshot({ path: `${OUT}/${tag}-2-beacon-home.png` });

    // A step completes: the first prayer is answered -> Ashford's standing stones.
    await p.evaluate(() => {
      game.prayerSystem.answered = Math.max(1, game.prayerSystem.answered);
    });
    e.stones = await oraSays(p, 'Ashford', 30000).catch(() => null);
    await p.waitForFunction(() => game.story.state().goal?.id === 'stones', null, { timeout: 10000 });
    await p.screenshot({ path: `${OUT}/${tag}-3-step-stones.png` });

    // Before the stones: Brambleholt is beyond reach and doesn't pray.
    e.reachBefore = await p.evaluate(() => {
      const b = game.villages.find((v) => v.name === 'Brambleholt');
      return { reach: game.canReach(b), hand: game.inInfluence(b.center.x, b.center.z) };
    });
    check(!e.reachBefore.reach && !e.reachBefore.hand, `${tag}: Brambleholt out of reach before the stones`);

    // Ashford raises its stones -> its light grows toward Brambleholt (carry) as you tend -> win Brambleholt.
    await p.evaluate(() => game.shrines.setStage('Ashford', 'stone_circle', true));
    await p.waitForFunction(() => game.story.state().goal?.id === 'carry', null, { timeout: 20000 });
    e.carryState = await p.evaluate(() => game.story.state());
    check(e.carryState.goal?.via === 'Ashford', `${tag}: after the stones, Ashford's light grows toward Brambleholt`);
    await p.evaluate(() => {
      game.villages.find((v) => v.name === 'Ashford').grow(80);
      game.advance(30);
    });
    e.win = await oraSays(p, 'Brambleholt', 60000);
    await p.screenshot({ path: `${OUT}/${tag}-4-next-goal-brambleholt.png` });
    e.winState = await p.evaluate(() => game.story.state());
    check(e.winState.goal?.id === 'win' && e.winState.goal.village === 'Brambleholt', `${tag}: next goal is Brambleholt`);
    e.reachAfter = await p.evaluate(() => {
      const b = game.villages.find((v) => v.name === 'Brambleholt');
      const s = game.villages.find((v) => v.name === 'Stonemere');
      return { reach: game.canReach(b), hand: game.inInfluence(b.center.x, b.center.z), stonemere: game.canReach(s) };
    });
    check(e.reachAfter.reach && e.reachAfter.hand && !e.reachAfter.stonemere, `${tag}: Brambleholt reachable after the stones, Stonemere not`);

    // The light over Brambleholt, seen from above its village.
    const b = e.winState.goal;
    await look(p, (b.x + -175) / 2 + 40, (b.z + 125) / 2 + 20, 260);
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `${OUT}/${tag}-5-beacon-brambleholt-and-ring.png` });
    await look(p, b.x, b.z, 120);
    await p.waitForTimeout(3500);
    await p.screenshot({ path: `${OUT}/${tag}-6-beacon-brambleholt-close.png` });

    // Stuck: the re-nudge.
    await p.waitForFunction(() => !game.ora.guideBusy, null, { timeout: 30000 });
    await p.waitForTimeout(7000);
    await p.evaluate(() => game.story.nudge());
    e.nudge = await oraSays(p, '', 30000);
    await p.screenshot({ path: `${OUT}/${tag}-7-stuck-nudge.png` });

    // The rest of the road: win both, temples everywhere -> tune.
    await p.evaluate(() => game.villages.find((v) => v.name === 'Brambleholt').convert(game));
    await p.waitForFunction(() => game.story.state().goal?.village === 'Stonemere', null, { timeout: 10000 });
    e.stonemere = await p.evaluate(() => game.story.state().goal);
    await p.evaluate(() => {
      for (const v of game.villages) if (v.owner !== 'player') v.convert(game);
      for (const v of game.villages) game.shrines.setStage(v, 'temple');
    });
    await p.waitForFunction(() => game.story.state().goal?.id === 'tune', null, { timeout: 10000 });
    e.tune = await oraSays(p, 'temple', 60000).catch(() => null);
    await p.screenshot({ path: `${OUT}/${tag}-8-tune.png` });
    e.legacyStages = await p.evaluate(() => game.villages.map((v) => [v.name, [...v.shrineStagesReached]]));
    e.errors = errors;
    check(errors.length === 0, `${tag}: no console errors in story run (${errors.join(' | ')})`);
    await ctx.close();
  }

  // ---- After the story is beaten: Story or Free play.
  {
    const { ctx, p, errors } = await open(size, '&unlock=free');
    await oraSays(p, 'walked this road', 60000);
    await p.waitForTimeout(1500);
    await p.screenshot({ path: `${OUT}/${tag}-9-story-or-free-choice.png` });
    e.choice = await p.evaluate(() => ({ marks: game.pace.group.visible, confirmed: game.pace.confirmed, mode: game.pace.mode }));
    check(e.choice.marks && !e.choice.confirmed && e.choice.mode === null, `${tag}: the choice is offered`);
    await p.evaluate(() => game.pace.choose('stay'));
    await p.waitForTimeout(4000);
    e.free = await p.evaluate(() => ({ mode: game.pace.mode, choice: game.pace.choice, story: game.story.state() }));
    check(e.free.mode === 'free' && !e.free.story.active && e.free.story.beacon.level === 0, `${tag}: free play has no guidance`);
    await p.screenshot({ path: `${OUT}/${tag}-10-free-play.png` });
    e.freeErrors = errors;
    check(errors.length === 0, `${tag}: no console errors in free run (${errors.join(' | ')})`);
    await ctx.close();
  }
}

await fs.writeFile(`${OUT}/evidence.json`, JSON.stringify({ evidence, failures }, null, 2));
await browser.close();
if (failures.length) throw Error(`Failed: ${failures.join('; ')}`);
