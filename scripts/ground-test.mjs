// Headless ground-contact test: node scripts/ground-test.mjs <url> <cdpPort> [shotDir]
// Needs a running `vite preview` and chromium on the GPU. Prints game.debug.groundCheck() on a fresh island and
// after building more; exits 1 when there are offenders.
import { spawn } from 'node:child_process';
import { mkdtempSync, writeFileSync, mkdirSync } from 'node:fs';
const [url = 'http://127.0.0.1:5208/', port = '9608', shotDir] = process.argv.slice(2);
const ch = spawn('chromium', ['--headless=new', '--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--mute-audio', '--no-first-run', `--user-data-dir=${mkdtempSync('/tmp/gt-')}`, `--remote-debugging-port=${port}`, '--window-size=1920,1080', 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let ws;
for (let i = 0; i < 60; i++) { try { const l = await (await fetch(`http://127.0.0.1:${port}/json`)).json(); const p = l.find((x) => x.type === 'page'); if (p) { ws = new WebSocket(p.webSocketDebuggerUrl); break; } } catch {} await sleep(200); }
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id); } };
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const ev = async (x) => { const r = await send('Runtime.evaluate', { expression: x, awaitPromise: true, returnByValue: true }); if (r.result?.exceptionDetails) return 'ERR ' + JSON.stringify(r.result.exceptionDetails.exception?.description); return r.result?.result?.value; };
await send('Page.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false });
await send('Page.addScriptToEvaluateOnNewDocument', { source: "try{localStorage.setItem('godgame.intro.v1','1')}catch(e){}" });
await send('Page.navigate', { url });
await sleep(8000);
await ev('game.hud.toggleHelp(false)');
await sleep(3000);
let fail = false;
const run = async (label) => {
  const out = await ev(`(() => { const r = game.debug.groundCheck(); return JSON.stringify({ text: r.text, off: (() => { const seen = {}; return r.offenders.filter((o) => (seen[o.what + o.id] = (seen[o.what + o.id] || 0) + 1) <= 2); })().slice(0, 30), n: r.offenders.length }); })()`);
  if (typeof out !== 'string' || out.startsWith('ERR')) { console.log(label, out); fail = true; return; }
  const r = JSON.parse(out);
  console.log(`== ${label}\n${r.text}`);
  for (const o of r.off) console.log('   ', JSON.stringify(o));
  if (r.n > 0) fail = true;
};
await run('fresh island');
console.log('built', await ev('game.debug.buildMore(4, 3)'));
await sleep(1500);
await run('after building (4 houses + 3 fields per village)');
console.log('felled/sites', JSON.stringify(await ev('game.debug.fellAndStart(7)')));
await sleep(2500);
await run('after felling trees (stumps) and starting wells');
console.log('built', await ev("game.debug.buildMore(2, 2, 'pyramid')"));
await sleep(1500);
await run('after more building + pyramids');
console.log('stress-placed (slopes findSpot allows)', await ev('game.debug.stressSlopes(14, 0.9, 0.97)'));
await sleep(1500);
await run('after dropping 14 houses and fields on slopes up to what findSpot allows (normal.y 0.9..0.97)');
console.log('pads', await ev('JSON.stringify(game.debug.padLog.reduce((a,x)=>{const k=x.kind+(x.applied?" padded":" skipped");a[k]=(a[k]||0)+1;return a},{}))'));
// Informational: far steeper than the game ever places on (normal.y 0.75..0.9, i.e. 25-40 degree slopes).
console.log('stress-placed (extreme, informational)', await ev('game.debug.stressSlopes(14, 0.75, 0.9)'));
await sleep(1500);
const keep = fail;
await run('INFO ONLY: extreme slopes (normal.y 0.75..0.9)');
fail = keep;
if (shotDir) mkdirSync(shotDir, { recursive: true });
ws.close(); ch.kill();
process.exit(fail ? 1 : 0);
