// Publishes the game: builds it, force-pushes dist/ to the `gh-pages` branch (daryllgomas.github.io/god-game/),
// then copies dist/ into the studio site so it is also live at https://studio.bigpicsolutions.com/the-first-world/
// (the address the studio page links to).
// Run with `npm run deploy` while gh is logged in as DaryllGomas (`gh auth switch --user DaryllGomas`).
// The studio repo is found at ../../sites/bigpic-studio, or wherever STUDIO_DIR points.
import { execSync } from 'node:child_process';
import { writeFileSync, existsSync, rmSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';

const REMOTE = 'https://github.com/DaryllGomas/god-game.git';
const STUDIO = resolve(process.env.STUDIO_DIR || '../../sites/bigpic-studio');
const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });

run('npm run build');
writeFileSync('dist/.nojekyll', ''); // serve files as-is, no Jekyll processing
const rev = execSync('git rev-parse --short HEAD').toString().trim();
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run(`git commit -q -m "Deploy ${rev}"`, 'dist');
run(`git push -q -f ${REMOTE} gh-pages`, 'dist');
console.log(`Deployed ${rev} to https://daryllgomas.github.io/god-game/`);

if (!existsSync(`${STUDIO}/CNAME`)) {
  console.log(`Studio repo not found at ${STUDIO}; skipped studio.bigpicsolutions.com/the-first-world/ (set STUDIO_DIR).`);
} else {
  rmSync(`${STUDIO}/the-first-world`, { recursive: true, force: true });
  cpSync('dist', `${STUDIO}/the-first-world`, { recursive: true, filter: (src) => !/[\\/]\.git([\\/]|$)/.test(src) });
  run('git add -A the-first-world', STUDIO);
  const changed = execSync('git diff --cached --quiet -- the-first-world || echo yes', { cwd: STUDIO }).toString().trim();
  if (changed) {
    run(`git commit -q -m "THE FIRST WORLD: publish ${rev}" -- the-first-world`, STUDIO);
    run('git push -q origin main', STUDIO);
  }
  console.log(`Live in about a minute at https://studio.bigpicsolutions.com/the-first-world/`);
}
