import { defineConfig, type Plugin } from 'vite';
import { mkdirSync, readdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// The playtest note key (B, or both sticks pressed in; src/dev/PlaytestNote.ts): a dev-server-only endpoint that writes
// each mark to shots/marks/<date>/<n>.json and <n>.png in this folder, the same as Signal Arena's. configureServer runs
// in `vite` (dev) only: nothing of it is in a production build, and it never talks to anything outside this machine.
// MARKS_DIR moves the folder (tests keep their marks out of the real one). Read them with `node scripts/marks.mjs`.
function marks(): Plugin {
  const root = process.env.MARKS_DIR || join(process.cwd(), 'shots', 'marks');
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  const body = (req: import('node:http').IncomingMessage) =>
    new Promise<string>((ok, bad) => {
      let s = '';
      req.on('data', (c) => {
        s += c;
        if (s.length > 60e6) bad(new Error('too big'));
      });
      req.on('end', () => ok(s));
      req.on('error', bad);
    });
  return {
    name: 'first-world-playtest-marks',
    configureServer(server) {
      server.middlewares.use('/__mark', async (req, res) => {
        res.setHeader('content-type', 'application/json');
        if (req.method === 'GET') return void res.end('{"marks":true}'); // "the tool is here"
        if (req.method !== 'POST') {
          res.statusCode = 405;
          return void res.end('{}');
        }
        try {
          const m = JSON.parse(await body(req)) as { png?: string; note?: string; n?: number; date?: string; [k: string]: unknown };
          if (req.url?.startsWith('/note')) {
            // POST /__mark/note {date, n, note}: the note, typed after the mark was saved
            const f = join(root, String(m.date).replace(/[^0-9-]/g, ''), `${Number(m.n)}.json`);
            if (!existsSync(f)) {
              res.statusCode = 404;
              return void res.end('{}');
            }
            const j = JSON.parse(readFileSync(f, 'utf8'));
            j.note = String(m.note ?? '').slice(0, 5000);
            writeFileSync(f, JSON.stringify(j, null, 1) + '\n');
            return void res.end('{}');
          }
          const date = today();
          const dir = join(root, date);
          mkdirSync(dir, { recursive: true });
          const n = readdirSync(dir).filter((f) => /^\d+\.json$/.test(f)).reduce((a, f) => Math.max(a, parseInt(f, 10)), 0) + 1;
          const { png, ...meta } = m;
          if (png?.startsWith('data:image/png;base64,')) writeFileSync(join(dir, `${n}.png`), Buffer.from(png.slice(22), 'base64'));
          writeFileSync(join(dir, `${n}.json`), JSON.stringify({ n, date, ...meta }, null, 1) + '\n');
          res.end(JSON.stringify({ n, date }));
        } catch (e) {
          res.statusCode = 500;
          res.end(JSON.stringify({ error: String(e) }));
        }
      });
    },
  };
}

export default defineConfig({
  // Relative asset paths, so the same build works at a site root (a custom subdomain)
  // and under a sub-path such as daryllgomas.github.io/god-game/.
  base: './',
  build: {
    // Three.js plus the game is ~1.1 MB; one chunk is fine for a game.
    chunkSizeWarningLimit: 1500,
  },
  plugins: [marks()],
});
