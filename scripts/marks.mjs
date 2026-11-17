// The playtest marks (B in the game on the dev server, or both sticks pressed in; src/dev/PlaytestNote.ts): lists every
// mark under shots/marks/<date>/ and makes a contact sheet per day, shots/marks/<date>/contact.png: each frame as a
// thumbnail with its number, note, where the camera was and what the hand was on. The same reader as Signal Arena's.
//   node scripts/marks.mjs [date]          all days when no date is given
//   node scripts/marks.mjs --dir <folder>  read another folder (tests)
import { readdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2);
const ROOT = args.includes('--dir') ? args[args.indexOf('--dir') + 1] : join(dirname(fileURLToPath(import.meta.url)), '..', 'shots', 'marks');
const day0 = args.find((a) => /^\d{4}-\d\d-\d\d$/.test(a));
if (!existsSync(ROOT)) { console.log('no marks yet (press B in the game on the dev server: npm run dev)'); process.exit(0); }
const days = (day0 ? [day0] : readdirSync(ROOT)).filter((d) => /^\d{4}-\d\d-\d\d$/.test(d) && existsSync(join(ROOT, d))).sort();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const clock = (w) => { const d = new Date(w); return isNaN(d) ? '' : d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }); };   // local, 12-hour
const what = (m) => [m.held ? `holding a ${m.held}` : m.hover ? `hand on a ${m.hover.kind}${m.hover.inLight ? '' : ' (outside your light)'}` : m.over ? `hand on a ${m.over}` : m.hand ? (m.hand.inLight ? null : 'hand outside your light') : 'hand off the land',
  m.paused ? 'paused' : null, m.help ? 'help open' : null, m.pad ? 'controller' : null].filter(Boolean).join(' · ');
const cam = (m) => (m.cam ? `camera over (${m.cam.x}, ${m.cam.z}) from ${Math.round(m.cam.distance)} m` : '');
let any = false;
for (const day of days) {
  const dir = join(ROOT, day);
  const marks = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8'))).sort((a, b) => a.n - b.n);
  if (!marks.length) continue;
  any = true;
  console.log(`\n${day}: ${marks.length} mark(s)`);
  for (const m of marks) console.log(`  #${m.n}  day ${m.day ?? '?'}  ${cam(m)}${what(m) ? '  ' + what(m) : ''}${m.note ? `  "${m.note}"` : ''}  ${clock(m.when)}`);
  const COLS = 3, TW = 480, TH = 270, PAD = 16, CH = TH + 64;
  const rows = Math.ceil(marks.length / COLS), W = COLS * (TW + PAD) + PAD, H = 70 + rows * (CH + PAD);
  const svg = [`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="#f4f1ea"/>`,
    `<text x="${PAD}" y="40" font-family="Liberation Sans, Arial" font-size="24" font-weight="bold">THE FIRST WORLD playtest marks, ${day} (${marks.length})</text>`];
  marks.forEach((m, i) => {
    const x = PAD + (i % COLS) * (TW + PAD), y = 60 + Math.floor(i / COLS) * (CH + PAD);
    const png = join(dir, `${m.n}.png`);
    if (existsSync(png)) svg.push(`<image x="${x}" y="${y}" width="${TW}" height="${TH}" preserveAspectRatio="xMidYMid slice" href="data:image/png;base64,${readFileSync(png).toString('base64')}"/>`);
    else svg.push(`<rect x="${x}" y="${y}" width="${TW}" height="${TH}" fill="#ccc"/>`);
    svg.push(`<rect x="${x}" y="${y}" width="44" height="28" fill="#111" opacity="0.75"/><text x="${x + 8}" y="${y + 20}" font-family="Liberation Sans, Arial" font-size="17" font-weight="bold" fill="#fff27a">#${m.n}</text>`);
    const note = String(m.note || '(no note)');
    svg.push(`<text x="${x}" y="${y + TH + 22}" font-family="Liberation Sans, Arial" font-size="16" font-weight="bold">${esc(note.length > 58 ? note.slice(0, 57) + '…' : note)}</text>`);
    svg.push(`<text x="${x}" y="${y + TH + 44}" font-family="Liberation Sans, Arial" font-size="13" fill="#444">${esc([cam(m), what(m), clock(m.when)].filter(Boolean).join(' · ').slice(0, 86))}</text>`);
  });
  svg.push('</svg>');
  writeFileSync(join(dir, 'contact.svg'), svg.join('\n'));
  try { execFileSync('rsvg-convert', ['-o', join(dir, 'contact.png'), join(dir, 'contact.svg')]); console.log(`  contact sheet: ${join(dir, 'contact.png')}`); }
  catch { console.log(`  contact sheet (svg only; rsvg-convert is not installed): ${join(dir, 'contact.svg')}`); }
}
if (!any) console.log('no marks yet (press B in the game on the dev server: npm run dev)');
