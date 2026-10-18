// The confrontation and the last word (2026-10-18), on the render box:
// `npm run build && atlas-run dist scripts/test-confrontation.mjs <out> [taken]`.
// Story mode, the good ending from Ready to See: records every line the talk overlay shows (in order, with who says
// it and whether its voice played), the reveal, Ora's "There you are.", Lumi's and Fizz's last word, and that the
// card follows. With `taken`, the ring counts as taken once, so Vexahl's third line is the taken one.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const TAKEN = process.argv[2] === 'taken';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan', '--autoplay-policy=no-user-gesture-required'],
});
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const report = { taken: TAKEN, failures: [], said: [], voices: [] };
const check = (ok, what) => (ok ? null : report.failures.push(what));
const ctx = await browser.newContext({ viewport: { width: 1600, height: 900 } });
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
p.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => {
  for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
});
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
await p.waitForFunction(() => game.pace.confirmed && game.story.active, null, { timeout: 60000 });
await p.evaluate((taken) => {
  game.audio.unlock?.();
  game.audio.setMuted?.(false);
  window.__voices = [];
  const play = game.audio.playAdvisorClip.bind(game.audio);
  game.audio.playAdvisorClip = (clip) => {
    window.__voices.push(+clip.duration.toFixed(2));
    return play(clip);
  };
  if (taken) game.rival.ring.taken = 1;
}, TAKEN);
await wait(2000);
console.log('ending:', await p.evaluate(() => game.endings.debug('ready')));

let n = 0;
let last = '';
let sawReveal = false;
let sawThere = false;
let card = false;
const t0 = Date.now();
while (Date.now() - t0 < 240000) {
  const st = await p.evaluate(() => {
    const t = document.querySelector('.endings-talk.on');
    const ora = document.querySelector('.endings-ora-line');
    const oraOn = ora && getComputedStyle(ora.parentElement).opacity > 0.5 ? ora.textContent : null;
    return {
      who: t?.dataset.who ?? null,
      line: t?.querySelector('.et-line')?.textContent ?? (oraOn === 'Not away. Back.' ? oraOn : null),
      who2: t ? t.dataset.who : 'ora',
      reveal: !!document.querySelector('.endings-reveal.on'),
      ora: ora?.textContent ?? '',
      card: !!document.querySelector('.endings-card.show, .endcard.show, .end-card.show, [class*="card"].show .endings-title'),
      phase: game.endings.state?.().phase ?? null,
    };
  });
  if (st.line && st.line !== last) {
    last = st.line;
    report.said.push({ who: st.who ?? st.who2, text: st.line });
    await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-${st.who}.png` });
  }
  if (st.reveal && !sawReveal) {
    sawReveal = true;
    report.said.push({ who: 'reveal', text: '(the hood falls)' });
    await wait(4000);
    await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-reveal.png` });
  }
  if (st.ora === 'There you are.' && !sawThere) {
    sawThere = true;
    report.said.push({ who: 'ora', text: 'There you are.' });
  }
  if (st.phase === 'card') {
    card = true;
    await wait(2500);
    await p.screenshot({ path: `${OUT}/${String(++n).padStart(2, '0')}-card.png` });
    break;
  }
  await wait(250);
}
report.voices = await p.evaluate(() => window.__voices);
report.errors = errors;

const texts = report.said.map((x) => x.text);
const want = [
  'Look at what you made. Every village, every temple. And not one of them fears you.',
  'You wanted their hearts. I only wanted it done. Fear is quicker than love. I was trying to save you the time.',
  TAKEN ? "And you took it. Don't pretend you didn't want to." : 'Every time you were tired, I was there. You always said no.',
  "He isn't wrong about what you wanted. Only about how.",
  'For the record, I was the nice one.',
  'So turn me away again. You always do.',
  'Not away. Back.',
  '(the hood falls)',
  'There you are.',
  'Both of you, in one place at last.',
  'Wonderful. Now who do I blame for things?',
];
check(JSON.stringify(texts) === JSON.stringify(want), `lines in order (got ${JSON.stringify(texts)})`);
check(report.voices.length >= 9, `voiced lines played: ${report.voices.length} (want 9: 6 talk + reveal + 2 after)`);
check(card, 'the card followed');
check(!errors.length, `no page errors (${errors.slice(0, 2).join(' | ')})`);
await fs.writeFile(`${OUT}/report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ failures: report.failures, said: texts.length, voices: report.voices.length }));
await browser.close();
