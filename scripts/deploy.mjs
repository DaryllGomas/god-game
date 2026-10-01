// Publishes the game to GitHub Pages: builds it, then force-pushes dist/ to the `gh-pages` branch,
// which Pages serves at https://daryllgomas.github.io/god-game/.
// Run with `npm run deploy` while gh is logged in as DaryllGomas (`gh auth switch --user DaryllGomas`).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const REMOTE = 'https://github.com/DaryllGomas/god-game.git';
const run = (cmd, cwd) => execSync(cmd, { stdio: 'inherit', cwd });

run('npm run build');
writeFileSync('dist/.nojekyll', ''); // serve files as-is, no Jekyll processing
const rev = execSync('git rev-parse --short HEAD').toString().trim();
run('git init -q -b gh-pages', 'dist');
run('git add -A', 'dist');
run(`git commit -q -m "Deploy ${rev}"`, 'dist');
run(`git push -q -f ${REMOTE} gh-pages`, 'dist');
console.log(`Deployed ${rev}. Live in about a minute at https://daryllgomas.github.io/god-game/`);
