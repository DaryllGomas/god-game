// The playtest note key (src/dev/PlaytestNote.ts, vite.config.ts /__mark), end to end on the dev server in a hidden
// Chrome: B marks and the note is saved; what is typed never reaches the game; an empty Enter skips; the controller's
// chord (both sticks in) marks, A closes the box and is not passed on; the Guide button does nothing.
// It starts its own `vite` on a free port with MARKS_DIR pointed at the output folder (so the real shots/marks is untouched).
//   CHROMIUM=/usr/bin/google-chrome-stable PLAYWRIGHT=<path to playwright-core/index.mjs> node scripts/test-playtest-note.mjs <out-dir>
// (needs the dev server, so it runs where node_modules is: this machine, headless, on the NVIDIA card; not atlas-run.)
import { spawn } from 'node:child_process';
import fs from 'node:fs'; import path from 'node:path'; import net from 'node:net';
const { chromium } = await import(process.env.PLAYWRIGHT || 'playwright-core');
const OUT = path.resolve(process.argv[2] || 'shots/test-playtest-note'), MARKS = path.join(OUT, 'marks');
fs.mkdirSync(MARKS, { recursive: true });
let fails = 0; const log = [];
const check = (ok, msg) => { if (!ok) fails++; const s = (ok ? '  ok   ' : '  FAIL ') + msg; log.push(s); console.log(s); return ok; };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const port = await new Promise((ok) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => ok(p)); }); });
const srv = spawn('node', ['node_modules/vite/bin/vite.js', '--port', String(port), '--strictPort', '--host', '127.0.0.1'], { env: { ...process.env, MARKS_DIR: MARKS }, stdio: 'ignore' });
const BASE = `http://127.0.0.1:${port}`;
for (let i = 0; i < 100; i++) { try { const r = await fetch(`${BASE}/__mark`); if (r.ok) break; } catch {} await sleep(150); }
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM, headless: true, args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--enable-features=Vulkan'] });
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
  await ctx.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k); } catch {} });
  const p = await ctx.newPage();
  const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
  await p.goto(`${BASE}/index.html?shot=default&unlock=free&padtest`);
  await p.waitForFunction(() => window.game && window.game.playtestNote && window.game.playtestNote.ready, null, { timeout: 180000 });
  await p.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove(); });
  await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 }).catch(() => {});
  await sleep(3000);
  await p.keyboard.press('Escape').catch(() => {});
  await p.evaluate(() => game.pace?.choose('walk'));
  await sleep(1500);
  const day = () => fs.readdirSync(MARKS)[0];
  const files = () => (day() ? fs.readdirSync(path.join(MARKS, day())).sort() : []);
  const read = (n) => JSON.parse(fs.readFileSync(path.join(MARKS, day(), `${n}.json`), 'utf8'));
  const boxUp = () => p.evaluate(() => !!document.getElementById('playtestNote'));
  const gs = () => p.evaluate(() => ({ paused: game.paused, held: game.hand.held?.kind ?? null, help: game.hud.helpOpen, quiet: game.controls.pad.quiet, speed: game.speed, cam: [game.godCam.target.x, game.godCam.target.z, game.godCam.distance].map((v) => +v.toFixed(1)) }));
  const waitBox = () => p.waitForFunction(() => !!document.getElementById('playtestNote'), null, { timeout: 15000 }).catch(() => {});

  await p.mouse.move(640, 400); await sleep(400);
  const s0 = await gs();
  await p.keyboard.press('KeyB'); await waitBox();
  check(await boxUp(), 'B: the note box opens');
  check(files().includes('1.json') && files().includes('1.png'), 'mark 1 is on disk at once (json and png): ' + files().join(' '));
  await p.screenshot({ path: path.join(OUT, '1_note_box.png') });
  await p.keyboard.type('p 1 2 h wasd rocks by the well will not come [ ]'); await sleep(500);
  const s1 = await gs();
  check(!s1.paused && s1.held === null && !s1.help && s1.speed === s0.speed && JSON.stringify(s1.cam) === JSON.stringify(s0.cam), `typing P, 1, 2, H, W A S D, [ ] in the box does not pause, cast, open help, pan or change speed (${JSON.stringify(s1)})`);
  await p.keyboard.press('Enter'); await sleep(900);
  check(!(await boxUp()), 'Enter closes the box');
  const m1 = read(1);
  check(m1.note === 'p 1 2 h wasd rocks by the well will not come [ ]', `the note is saved on mark 1: "${m1.note}"`);
  check(m1.game === 'the-first-world' && m1.cam && typeof m1.cam.distance === 'number' && Array.isArray(m1.villages) && m1.villages.length === 3 && !!m1.when, `mark 1 says where: camera ${JSON.stringify(m1.cam)}, hand ${JSON.stringify(m1.hand)}, day ${m1.day}`);
  const png = fs.statSync(path.join(MARKS, day(), '1.png')).size;
  check(png > 30000, `mark 1's picture is a real frame (${Math.round(png / 1024)} KB)`);
  await p.keyboard.press('KeyP'); await sleep(300);
  check((await gs()).paused, 'with the box closed, P pauses again (so the check above means something)');
  await p.keyboard.press('KeyP'); await sleep(300);

  await p.keyboard.press('KeyB'); await waitBox();
  await p.keyboard.press('Enter'); await sleep(500);
  check(files().includes('2.json') && read(2).note === undefined && !(await boxUp()), 'B then an empty Enter: mark 2 saved with no note');
  await p.keyboard.press('KeyB'); await waitBox();
  await p.keyboard.type('never mind'); await p.keyboard.press('Escape'); await sleep(500);
  check(files().includes('3.json') && read(3).note === undefined && !(await boxUp()), 'Esc closes the box and drops the typed note (mark 3 stays)');

  // ---- the controller
  const set = (o) => p.evaluate((o) => { const f = window.__fakePad; for (const [k, v] of Object.entries(o)) { f.buttons[k].pressed = !!v; f.buttons[k].value = v ? 1 : 0; } }, o);
  await set({ 0: 1 }); await sleep(120); await set({ 0: 0 }); await sleep(500);                  // wake the pad
  await p.evaluate(() => { const h = game.hand; if (h.held) h.place(game, h.pickedFrom.clone()); });
  const c0 = await gs();
  await set({ 10: 1, 11: 1 }); await sleep(200); await set({ 10: 0, 11: 0 }); await waitBox();
  check((await boxUp()) && files().includes('4.json'), 'controller: both sticks pressed in -> mark 4 and the box');
  check(read(4).pad === true && (await gs()).quiet, 'mark 4 records the controller; the pad is quiet while the box is up');
  await p.screenshot({ path: path.join(OUT, '2_note_box_couch.png') });
  await set({ 3: 1 }); await sleep(150); await set({ 3: 0 }); await sleep(300);                  // Y would find the golem: nothing may happen
  check(await boxUp(), 'controller: Y does nothing while the box is up');
  await set({ 0: 1 }); await sleep(150); await set({ 0: 0 }); await sleep(600);
  const c1 = await gs();
  check(!(await boxUp()) && !c1.quiet, 'controller: A closes the box and the pad is the game\'s again');
  check(c1.held === c0.held && !c1.paused, `controller: that A was not passed on as a grab (held ${c0.held} -> ${c1.held})`);
  const n0 = files().filter((f) => f.endsWith('.json')).length;
  await set({ 16: 1 }); await sleep(300); await set({ 16: 0 }); await sleep(300);
  check(files().filter((f) => f.endsWith('.json')).length === n0 && !(await boxUp()), 'the Xbox (Guide) button does nothing here');
  check(errors.length === 0, 'no page errors (' + errors.slice(0, 3).join(' | ') + ')');
} finally {
  await browser.close(); srv.kill();
}
log.push(fails ? `${fails} FAILED` : 'ALL PASSED'); console.log(log[log.length - 1]);
fs.writeFileSync(path.join(OUT, 'report.txt'), log.join('\n') + '\n');
process.exit(fails ? 1 : 0);
