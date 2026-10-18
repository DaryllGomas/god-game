// UX fixes of 2026-10-15 (first-time-player playtest), on the render box:
//   npm run build && atlas-run dist scripts/test-ux-screen.mjs <out>
// Screens at 1600x900: welcome (essentials, then controls open), Ora's first goal, village rows (yours: shrine age;
// being won: families), a row hovered, the goal reminder (fresh, then hovered), the storehouse label, and the
// intro's faint skip. Checks: Ora's guide lines hold in real seconds at 4x, the hidden advisor card keeps no name.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const SIZE = { width: 1600, height: 900 };
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--autoplay-policy=no-user-gesture-required'],
});
const evidence = {};
const failures = [];
const check = (ok, what) => {
  if (!ok) failures.push(what);
};
const shot = (p, name) => p.screenshot({ path: `${OUT}/${name}.png` });

async function fresh(query) {
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
  await p.goto(`${process.env.SITE_URL}/index.html${query}`);
  return { ctx, p, errors };
}

// ---------------------------------------------------------------- the game
{
  const { ctx, p, errors } = await fresh('?shot=default&unlock=story');
  await p.waitForFunction(() => window.game, null, { timeout: 120000 });
  await p.evaluate(() => {
    for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
    game.audio.setMuted(true);
  });
  await p.waitForTimeout(1500);
  // 7. Welcome: the essentials.
  evidence.welcome = await p.evaluate(() => {
    const h = document.querySelector('.overlay.help');
    const vis = (sel) => {
      const e = h.querySelector(sel);
      return !!e && getComputedStyle(e).display !== 'none' && e.getBoundingClientRect().height > 0;
    };
    return {
      title: h.classList.contains('title'),
      gridVisible: vis('.help-grid'),
      toggleVisible: vis('.help-toggle'),
      playWithoutName: [...h.querySelectorAll('button')].some((b) => /without a name/i.test(b.textContent)),
      buttons: [...h.querySelectorAll('button, a')].filter((b) => b.getBoundingClientRect().height > 0).map((b) => b.textContent.trim()),
    };
  });
  check(evidence.welcome.title && !evidence.welcome.gridVisible && evidence.welcome.toggleVisible, 'welcome: controls collapsed behind a link');
  check(!evidence.welcome.playWithoutName, 'welcome: no "Play without a name"');
  await shot(p, '07-welcome-essentials');
  await p.click('.help-toggle');
  await p.waitForTimeout(500);
  await shot(p, '07-welcome-controls-open');
  await p.click('.help-toggle');
  await p.getByText('Begin', { exact: true }).click();
  await p.waitForFunction(() => game.pace.confirmed && game.story.active, null, { timeout: 60000 });
  check(await p.evaluate(() => !document.querySelector('.overlay.help').classList.contains('title')), 'the ? screen is no longer the title');

  // 4. Ora's first goal: concrete.
  await p.mouse.move(SIZE.width / 2, SIZE.height * 0.62);
  await p.waitForFunction(() => !!game.ora.state().showing && document.querySelector('.ora.show') && !document.querySelector('.ora.away'), null, { timeout: 60000 });
  await p.waitForTimeout(2000);
  evidence.firstLine = await p.evaluate(() => game.ora.state().showing);
  check(/Ashford/.test(evidence.firstLine) && !/Can you hear it/.test(evidence.firstLine), `first line concrete: ${evidence.firstLine}`);
  await shot(p, '04-ora-first-goal');

  // 3. Hold time in real seconds at 4x.
  const t0 = Date.now();
  await p.evaluate(() => game.setSpeed(4));
  await p.waitForFunction(() => !document.querySelector('.ora.show'), null, { timeout: 30000 });
  evidence.firstLineHeldS = Math.round((Date.now() - t0) / 100) / 10 + 2; // + the 2 s already waited
  check(evidence.firstLineHeldS >= 7, `goal line held ${evidence.firstLineHeldS}s at 4x`);
  await p.evaluate(() => game.setSpeed(1));

  // 3. The reminder: glows once the goal line has faded; hover says it again.
  await p.waitForFunction(() => game.ora.state().remind === 'fresh', null, { timeout: 20000 }).catch(() => failures.push('reminder never glowed'));
  await p.waitForTimeout(1600);
  evidence.remindFresh = await p.evaluate(() => game.ora.state().remind);
  await shot(p, '03-goal-reminder-fresh');
  const rb = await p.evaluate(() => {
    const r = document.querySelector('.ora-remind').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await p.mouse.move(rb.x, rb.y + 60);
  await p.mouse.move(rb.x, rb.y, { steps: 6 });
  await p.waitForTimeout(2400);
  evidence.recalled = await p.evaluate(() => game.ora.state().showing);
  check(!!evidence.recalled, 'hovering the reminder says the goal again');
  await shot(p, '03-goal-reminder-hovered');
  await p.mouse.move(SIZE.width / 2, SIZE.height * 0.62);

  // 5. The advisor card: shown, then hidden, it keeps no name in the page.
  await p.evaluate(() => game.prayerSystem.advisors.say({ who: 'spirit', text: 'Lovely! A new roof means a happy family.' }, { pri: 'important', cooldown: 0 }));
  await p.waitForFunction(() => document.querySelector('.talk-card.show'), null, { timeout: 30000 });
  evidence.cardWhileShowing = await p.evaluate(() => document.querySelector('.talk-card').innerText.replace(/\s+/g, ' '));
  await p.waitForFunction(() => !document.querySelector('.talk-card.show'), null, { timeout: 30000 });
  await p.waitForTimeout(800);
  evidence.cardAfter = await p.evaluate(() => {
    const c = document.querySelector('.talk-card');
    return { text: c.textContent.trim(), visibility: getComputedStyle(c).visibility, pointer: getComputedStyle(c).pointerEvents, bodyHasLumi: /lumi/i.test(document.body.innerText) };
  });
  check(!evidence.cardAfter.text && evidence.cardAfter.visibility === 'hidden' && !evidence.cardAfter.bodyHasLumi, `hidden card keeps no name: ${JSON.stringify(evidence.cardAfter)}`);

  // 1. Village rows: yours (shrine age, the next age's dream half built), being won (families).
  await p.evaluate(() => {
    const home = game.villages[0];
    game.shrines.setStage(home, 'stone_circle');
    const site = game.projectSystem.startNow(home);
    if (site) site.have.stone = Math.round(site.def.needs.stone * 0.55);
    game.godCam.setPose({ x: home.center.x, z: home.center.z, distance: 150, pitch: 0.8, yaw: 0.5 }, true);
  });
  // Vexahl's arrival takes the camera for a beat: let it pass, then look at Ashford again.
  await p.waitForTimeout(9000);
  await p.evaluate(() => {
    const home = game.villages[0];
    game.godCam.setPose({ x: home.center.x, z: home.center.z, distance: 150, pitch: 0.8, yaw: 0.5 }, true);
  });
  await p.waitForTimeout(1500);
  evidence.rows = await p.evaluate(() => [...document.querySelectorAll('.v-row')].map((r) => `${r.querySelector('.v-name').textContent}: ${r.querySelector('.v-status').textContent} [${[...r.querySelectorAll('.v-seg')].map((s) => (s.classList.contains('on') ? '#' : s.firstChild.style.width === '0%' ? '.' : '~')).join('')}]`));
  evidence.homeLabel = await p.evaluate(() => document.querySelector('.v-label.owned')?.innerText.replace(/\s+/g, ' '));
  check(/Stones · 2\/4/.test(evidence.rows[0]), `owned row shows the age: ${evidence.rows[0]}`);
  check(/\d\/\d ✦/.test(evidence.rows[1]), `neutral row shows families: ${evidence.rows[1]}`);
  await shot(p, '01-village-rows-owned-and-neutral');
  await p.evaluate(() => {
    const home = game.villages[0];
    game.shrines.setStage(home, 'pyramid');
  });
  await p.waitForTimeout(800);
  evidence.rowsPyramid = await p.evaluate(() => document.querySelector('.v-row .v-status').textContent);
  await shot(p, '01-village-rows-pyramid');

  // 2. A row hovered.
  const row = await p.$$('.v-row');
  await row[1].hover();
  await p.waitForTimeout(500);
  evidence.rowHover = await p.evaluate(() => {
    const r = document.querySelectorAll('.v-row')[1];
    return { cursor: getComputedStyle(r).cursor, bg: getComputedStyle(r).backgroundColor, chevron: getComputedStyle(r.querySelector('.v-go')).opacity };
  });
  check(evidence.rowHover.cursor === 'pointer' && Number(evidence.rowHover.chevron) > 0.9, `row hover: ${JSON.stringify(evidence.rowHover)}`);
  await p.screenshot({ path: `${OUT}/02-village-row-hover.png` });
  await p.screenshot({ path: `${OUT}/02-village-row-hover-crop.png`, clip: { x: 0, y: 140, width: 340, height: 160 } });

  // 8. The storehouse label: the hand over Ashford's storehouse.
  await p.evaluate(() => {
    const home = game.villages[0];
    game.selectVillage(null);
    game.godCam.setPose({ x: home.store.pos.x, z: home.store.pos.z, distance: 90, pitch: 0.85, yaw: 0.5 }, true);
  });
  await p.waitForTimeout(800);
  const sp = await p.evaluate(() => {
    const s = game.villages[0].store;
    const v = s.pos.clone();
    v.y += Math.min(s.topHeight * 0.5, 3);
    v.project(game.godCam.camera);
    return { x: (v.x * 0.5 + 0.5) * innerWidth, y: (-v.y * 0.5 + 0.5) * innerHeight };
  });
  await p.mouse.move(sp.x + 30, sp.y + 30);
  await p.mouse.move(sp.x, sp.y, { steps: 8 });
  await p.waitForTimeout(900);
  evidence.storeTip = await p.evaluate(() => ({ show: document.querySelector('.store-tip').classList.contains('show'), hover: game.hoverBuilding?.kind ?? null }));
  check(evidence.storeTip.show, `storehouse label shows on hover: ${JSON.stringify(evidence.storeTip)}`);
  await shot(p, '08-storehouse-label');

  evidence.gameErrors = errors;
  check(errors.length === 0, `game errors: ${errors.join(' | ')}`);
  await ctx.close();
}

// ---------------------------------------------------------------- the intro
{
  const { ctx, p, errors } = await fresh('');
  await p.waitForSelector('.intro-light', { timeout: 60000 });
  await p.waitForTimeout(1500);
  await p.mouse.click(SIZE.width / 2, SIZE.height / 2);
  const playing = await p.waitForFunction(() => document.querySelector('.intro-video')?.currentTime > 0.2, null, { timeout: 30000 }).then(() => true, () => false);
  evidence.introPlays = playing;
  await p.waitForTimeout(3500);
  evidence.skip = await p.evaluate(() => {
    const s = document.querySelector('.intro-skip');
    if (!s) return null;
    const cs = getComputedStyle(s);
    return { text: s.textContent, opacity: cs.opacity, pointer: cs.pointerEvents, faint: document.querySelector('.intro').classList.contains('skip-faint') };
  });
  check(!!evidence.skip?.faint && Number(evidence.skip.opacity) > 0.2, `faint skip shows: ${JSON.stringify(evidence.skip)} (film playing: ${playing})`);
  await shot(p, '06-intro-skip-faint');
  await p.screenshot({ path: `${OUT}/06-intro-skip-faint-crop.png`, clip: { x: SIZE.width - 300, y: SIZE.height - 140, width: 300, height: 140 } });
  await p.hover('.intro-skip');
  await p.waitForTimeout(500);
  await p.screenshot({ path: `${OUT}/06-intro-skip-hover-crop.png`, clip: { x: SIZE.width - 300, y: SIZE.height - 140, width: 300, height: 140 } });
  await p.click('.intro-skip');
  const gone = await p.waitForFunction(() => !document.querySelector('.intro'), null, { timeout: 30000 }).then(() => true, () => false);
  check(gone, 'clicking skip ends the intro');
  await p.waitForTimeout(1500);
  await shot(p, '06-after-skip-welcome');
  evidence.introErrors = errors;
  await ctx.close();
}

await browser.close();
await fs.writeFile(`${OUT}/evidence.json`, JSON.stringify({ evidence, failures }, null, 2));
console.log(JSON.stringify({ evidence, failures }, null, 2));
