// Publishes the game: builds it and copies dist/ into the studio site's the-first-world/play/, live at
// https://studio.bigpicsolutions.com/the-first-world/play/. The landing page one level up (the-first-world/index.html,
// devlog.json, media/) belongs to the studio repo and is never touched here; it forwards old game links
// (?from=thepath, ?unlock=, ?shot=) to play/. Update its devlog.json by hand, then run the studio's privacy gate.
// The old address, daryllgomas.github.io/god-game/, is kept as a redirect: the `gh-pages` branch holds only
// scripts/redirect/ (index.html + 404.html), so every old link lands on the studio.
// Run with `npm run deploy` while gh is logged in as DaryllGomas (`gh auth switch --user DaryllGomas`).
// The studio repo is found at ../../sites/bigpic-studio, or wherever STUDIO_DIR points.
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';

const REMOTE = 'https://github.com/DaryllGomas/god-game.git';
const STUDIO = resolve(process.env.STUDIO_DIR || '../../sites/bigpic-studio');
const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });

run('npm run build');
const rev = execSync('git rev-parse --short HEAD').toString().trim();
rmSync('.redirect-pages', { recursive: true, force: true });
cpSync('scripts/redirect', '.redirect-pages', { recursive: true });
writeFileSync('.redirect-pages/.nojekyll', '');
run('git init -q -b gh-pages', '.redirect-pages');
run('git add -A', '.redirect-pages');
run('git commit -q -m "Redirect to studio.bigpicsolutions.com/the-first-world/"', '.redirect-pages');
run(`git push -q -f ${REMOTE} gh-pages`, '.redirect-pages');
rmSync('.redirect-pages', { recursive: true, force: true });

if (!existsSync(`${STUDIO}/CNAME`)) {
  console.log(`Studio repo not found at ${STUDIO}; skipped studio.bigpicsolutions.com/the-first-world/ (set STUDIO_DIR).`);
} else {
  // Other sessions work in the studio repo too: never publish onto someone else's branch.
  const studioBranch = execSync('git rev-parse --abbrev-ref HEAD', { cwd: STUDIO }).toString().trim();
  if (studioBranch !== 'main') throw new Error(`studio repo is on '${studioBranch}', not main: publish from a main worktree instead`);
  // The landing page must be there (and the old game-at-the-root layout gone) before the game goes to play/.
  if (!existsSync(`${STUDIO}/the-first-world/devlog.json`)) {
    throw new Error('the studio repo has no the-first-world/devlog.json: merge its game-hub branch (the landing page) first');
  }
  // The public devlog passes the privacy gate, or nothing is published.
  run('node tools/hub/check-devlog.mjs the-first-world/devlog.json', STUDIO);
  const PLAY = `${STUDIO}/the-first-world/play`;
  rmSync(PLAY, { recursive: true, force: true });
  cpSync('dist', PLAY, { recursive: true, filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) });
  run('git add -A the-first-world/play', STUDIO);
  const changed = execSync('git diff --cached --quiet -- the-first-world/play || echo yes', { cwd: STUDIO }).toString().trim();
  if (changed) {
    run(`git commit -q -m "THE FIRST WORLD: publish ${rev}" -- the-first-world/play`, STUDIO);
    run('git push -q origin main', STUDIO);
  }
  console.log(`Live in about a minute at https://studio.bigpicsolutions.com/the-first-world/play/ (landing page: /the-first-world/)`);
}
