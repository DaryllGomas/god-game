// THE FIRST WORLD: an automated story-mode playthrough, for judging the pacing of the whole road.
// Run: npm run build && atlas-run dist scripts/playbot/playbot.mjs "<out-dir>" [profile]   (or thor-run with PROFILE=...)
// Env: MAX_GAME_S (default 10800 = 3 game hours), BATCH (game seconds per page call, default 30).
//
// It plays a FRESH island in story mode the way a reasonable new player would: it answers prayers it can reach
// with the real hand (Hand.grab + Hand.place, the same calls the mouse makes, with the same influence checks as
// Controls), casts Water / Food with Game.selectMiracle + Hand.place (the orb lands and casts), carries lost
// children home, drops boulders on dream sites and trees on storehouses. It never calls giftToVillage, never
// sets belief, never touches game code. Game time is stepped with the game's own debug hook, game.advance().
// Output: timeline.csv (every game minute), events.md, events.json, timeline.json and milestone screenshots.
// The last age (2026-10-17): after Whole and its card the bot plays on through the Nexus (answering prayers, boulders
// and timber onto the ring) and watches Telor grow, to the true end and its card; then the run is over.
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';

const OUT = process.env.OUT_DIR;
const MAX_GAME_S = Number(process.env.MAX_GAME_S ?? 10800);
const BATCH = Number(process.env.BATCH ?? 30);
const SIZE = { width: 1600, height: 900 };
/**
 * How the bot plays. attentive: notices a prayer ~15 s after it appears, ~8 s per hand action plus panning, a gift to
 * the village it is winning every minute. relaxed: notices after ~45 s, slower hand, no extra gifts (answers prayers
 * and helps dreams only), the way a first-time player who looks around a lot might.
 */
const PROFILES = {
  attentive: { react: 15, siteReact: 20, base: 8, pan: 20, giftEvery: 60 },
  relaxed: { react: 45, siteReact: 60, base: 14, pan: 12, giftEvery: Infinity },
  // A first-timer who answers prayers (slowly) and doesn't work out that dreams want boulders until Ora has said so
  // twice (2026-10-14: neighbours no longer build alone, so a player who never carries stone can't raise them).
  newcomer: { react: 60, siteReact: Infinity, base: 15, pan: 10, giftEvery: Infinity, learnsStone: { afterLines: 2, siteReact: 90 } },
  // Stays at Ashford for the first 25 game minutes (answers home prayers, builds home dreams, ignores the neighbours),
  // then plays like the attentive player: what a player who takes their time at home finds next door.
  homebody: { react: 30, siteReact: 30, base: 10, pan: 15, giftEvery: 60, homeUntil: 1500 },
};
// The profile: PROFILE=... (thor-run), or the first argument after the out-dir (atlas-run: env vars don't cross ssh).
const PROFILE = process.argv[2] ?? process.env.PROFILE ?? 'attentive';
if (!PROFILES[PROFILE]) throw new Error(`unknown profile ${PROFILE}`);
const CFG = PROFILES[PROFILE];
// Vexahl's ring (2026-10-15): the bot turns it down (refuse, the default), or takes it the first time (take1). The
// second argument after the out-dir (atlas-run), or RING=... (thor-run).
const RING = process.argv[3] ?? process.env.RING ?? 'refuse';
if (!['refuse', 'take1'].includes(RING)) throw new Error(`unknown ring policy ${RING}`);
CFG.ring = RING;
const realStart = Date.now();
const realS = () => (Date.now() - realStart) / 1000;

const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM,
  args: ['--use-gl=angle', '--use-angle=vulkan', '--enable-gpu', '--ignore-gpu-blocklist', '--autoplay-policy=no-user-gesture-required'],
});
const ctx = await browser.newContext({ viewport: SIZE });
// A fresh island: forget every saved island, intro flag and unlock.
await ctx.addInitScript(() => {
  try {
    for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k);
  } catch {
    /* ignore */
  }
});
const p = await ctx.newPage();
const errors = [];
p.on('pageerror', (e) => errors.push(`${realS().toFixed(0)}s ${String(e)}`));
p.on('console', (m) => {
  if (m.type() === 'error') errors.push(`${realS().toFixed(0)}s ${m.text()}`);
});

await p.goto(`${process.env.SITE_URL}/index.html?shot=default&unlock=story`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => {
  for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove();
});
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 });
await p.evaluate(() => game.audio.setMuted(true));
await p.waitForFunction(() => game.pace.confirmed && game.story.active, null, { timeout: 60000 });
// The view the game starts on, untouched (his isle lies hidden under the sea until the first pyramid stands).
await p.waitForTimeout(4000);
await p.screenshot({ path: `${process.env.OUT_DIR}/00-default-view.png` });

// ------------------------------------------------------------------ the bot, in the page
await p.evaluate((CFG) => {
  const g = window.game;
  const ps = g.prayerSystem;
  const B = (window.__bot = {
    events: [],
    timeline: [],
    shots: [],
    busyUntil: 0,
    lastGiftAt: -999,
    lastRow: -60,
    notes: {},
    goalKey: '',
    goalSince: 0,
    goalStuckShots: {},
    seen: {},
    sources: {},
    born: {},
    died: {},
    actions: 0,
    lastShowing: null,
    siteSeen: new Map(),
    cfg: CFG,
  });
  const name = (v) => v?.name ?? '?';
  const ev = (type, text, extra = {}) => B.events.push({ t: Math.round(g.time * 10) / 10, type, text, ...extra });
  const note = (k) => (B.notes[k] = (B.notes[k] ?? 0) + 1);
  const src = (v, k, n) => {
    const s = (B.sources[v] ??= {});
    s[k] = Math.round(((s[k] ?? 0) + n) * 10) / 10;
  };

  // ---- the voices
  const ora = g.ora;
  const og = ora.guide.bind(ora);
  let stoneLines = 0;
  ora.guide = (t, o) => {
    ev('ora', t, { how: 'guide' });
    if (CFG.learnsStone && /stone/i.test(t) && ++stoneLines === CFG.learnsStone.afterLines) {
      CFG.siteReact = CFG.learnsStone.siteReact;
      ev('learn', `the newcomer takes Ora's word: dreams want stone (now helps dreams after ${CFG.siteReact} s)`);
    }
    return og(t, o);
  };
  const orr = ora.raise.bind(ora);
  ora.raise = (m, f) => {
    const r = orr(m, f);
    if (r) ev('ora', `(moment: ${m})`, { how: 'raise' });
    return r;
  };
  const adv = ps.advisors;
  const as = adv.say.bind(adv);
  const WHO = { spirit: 'Lumi', imp: 'Fizz' };
  adv.say = (lines, opts) => {
    const r = as(lines, opts);
    if (r) for (const l of Array.isArray(lines) ? lines : [lines]) ev('advisor', l.text, { who: WHO[l.who] ?? l.who, topic: opts?.topic ?? '' });
    return r;
  };
  const rv = g.rival;
  if (rv?.ui) {
    const rs = rv.ui.say.bind(rv.ui);
    rv.ui.say = (lines, o) => {
      for (const l of Array.isArray(lines) ? lines : [lines]) {
        if (l.who === 'rival') ev('vexahl', l.text, { who: l.who });
        else ev('advisor', `${l.text} (queued with Vexahl's beat)`, { who: WHO[l.who] ?? l.who });
      }
      return rs(lines, o);
    };
    const sr = rv.ui.showRival.bind(rv.ui);
    rv.ui.showRival = (text, ...rest) => {
      ev('vexahl-shown', `${text}${rest[1] && rest[1] !== 'speak' ? ` [${rest[1]} portrait]` : ''}`);
      return sr(text, ...rest);
    };
    const rb = rv.ui.banner.bind(rv.ui);
    rv.ui.banner = (t, s) => {
      ev('vexahl', `BANNER: ${t} ${s ?? ''}`);
      return rb(t, s);
    };
  }

  // ---- world events
  const E = g.events;
  E.on('villageConverted', ({ village: v }) =>
    ev('convert', `${v.name} converts: ${v.population} villagers become yours at once (${v.houses.length} houses, ${v.worshipperCount} were dancing at that moment), shrine stage ${v.shrineStage}`, {
      village: v.name,
      pop: v.population,
      stage: v.shrineStage,
    }),
  );
  E.on('villageLost', ({ village: v }) => ev('lost', `${v.name} lost faith`, { village: v.name }));
  E.on('villageTurned', ({ village: v }) => ev('turned', `${v.name} turned to Vexahl`, { village: v.name }));
  E.on('shrineRaised', ({ village: v, stage }) => ev('stage', `${v.name} raises its ${stage} (owner: ${v.owner ?? 'nobody'})`, { village: v.name, stage, owner: v.owner }));
  E.on('projectStarted', ({ village: v, project }) => ev('project', `${v.name} dreams of ${project} (owner: ${v.owner ?? 'nobody'})`, { village: v.name }));
  E.on('projectCompleted', ({ village: v, project }) => {
    const s = g.projectSystem.states.get(v);
    ev('project', `${v.name} finished ${project} (owner: ${v.owner ?? 'nobody'})`, { village: v.name });
    void s;
  });
  E.on('prayerAnswered', ({ kind, village: v }) => {
    ev('answered', `${kind} prayer answered in ${v.name} (${v.owner === 'player' ? 'yours' : `belief now ${Math.floor(v.belief)}%`})`, { village: v.name, kind });
    if (v.owner !== 'player') src(v.name, `prayer:${kind}`, 10);
  });
  E.on('gift', ({ village: v, kind, amount }) => {
    if (v.owner !== 'player') src(v.name, `storehouse ${kind}`, (kind === 'food' ? amount * 0.28 : amount * 0.15) * 0.4);
  });
  E.on('householdJoined', ({ village: v, families, of, joined }) =>
    ev('household', `${v.name}: a family ${joined ? 'comes to believe' : 'lets go'} (${families} of ${of} families with you, belief ${Math.floor(v.belief)})`, { village: v.name, families, of }),
  );
  E.on('rivalArrived', () => {
    const r = g.rival.state();
    ev('vexahl', `Vexahl ${r.noticed && !r.stirring ? 'rises and notices you (story beat)' : 'arrives / stirs'} (rivalArrived; balance ${r.balance})`);
  });
  // His isle rises at the first pyramid and grows a step with every age raised (2026-10-15): frames of the rising and
  // of each big beat's glance (the game's own camera), and every step from one fixed view for the side-by-side.
  B.rivalTier = 0;
  B.risen = false;
  B.watchRival = () => {
    const r = g.rival.state();
    if (r.risen && !B.risen) {
      B.risen = true;
      const st = g.villages.map((v) => `${v.name} ${v.shrineStage}`).join(', ');
      ev('vexahl', `RISING: his isle rises from the sea (tier ${r.tier}/${r.maxTier}, stage ${r.stage}, glancing ${r.glancing}; ${st})`);
      B.shots.push({ key: '20-rise', focus: null, seq: [300, 1500, 3000, 4500, 6000, 7500, 9000, 11000, 14000] });
    }
    if (r.tier > B.rivalTier) {
      const was = B.rivalTier;
      B.rivalTier = r.tier;
      if (was > 0) {
        const st = g.villages.map((v) => `${v.name} ${v.shrineStage}`).join(', ');
        ev('vexahl', `LEVEL ${r.tier}/${r.maxTier}: his citadel grows${r.glancing ? ' (camera glance: ' + (r.tier >= r.maxTier ? 'final form' : 'first temple') + ')' : ''} (${st})`);
        if (r.glancing) B.shots.push({ key: `21-level${r.tier}-glance`, focus: null, seq: [1500, 4000, 7000, 10000] });
      }
      B.shots.push({ key: `22-level${r.tier}`, focus: { ...g.rival.shotPose(r.maxTier), pose: true }, wait: 5200 });
    }
  };
  B.schemes = 0;
  E.on('schemeStarted', ({ kind, village: v }) => {
    const s = g.rival.scheme;
    B.schemes++;
    B.schemeN = B.schemes;
    ev('scheme', `Vexahl's ${kind} on ${v.name} begins (${s?.courting ? 'story move on a village you are winning' : 'balance scheme'}; ${v.name} belief ${Math.floor(v.belief)}%, owner ${v.owner ?? 'nobody'})`, { village: v.name, kind });
    B.shots.push({ key: `10-scheme${B.schemes}-${kind}-${v.name}-start`, focus: { x: v.center.x, z: v.center.z, distance: 200 } });
  });
  E.on('schemeEnded', ({ kind, village: v, outcome, courting }) => {
    ev('scheme', `Vexahl's ${kind} on ${v.name} ends: ${outcome.toUpperCase()}${courting ? ' (story move)' : ''} (${v.name} belief ${Math.floor(v.belief)}%, owner ${v.owner ?? 'nobody'})`, { village: v.name, kind, outcome });
    B.shots.push({ key: `10-scheme${B.schemeN}-${kind}-${v.name}-${outcome}`, focus: { x: v.center.x, z: v.center.z, distance: 200 } });
  });
  // His ring: a screenshot of the offer, an answer after a player's few seconds of thought, and the result.
  B.ring = null;
  E.on('ringOffered', ({ moment, village: v }) => {
    const take = CFG.ring === 'take1' && g.rival.ring.taken === 0;
    B.ring = { at: g.time + 6, take, n: g.rival.ring.offered };
    ev('ring', `Vexahl offers his ring (${moment}${v ? `, ${v.name}` : ''}; balance ${g.balance.value.toFixed(3)}, alignment ${g.player.alignment.toFixed(2)}): the bot will ${take ? 'TAKE it' : 'turn it down'}`, { moment, village: v?.name });
    B.shots.push({ key: `30-ring${B.ring.n}-offer-${moment}`, focus: null, wait: 1800 });
  });
  E.on('ringTaken', ({ moment, village: v }) => {
    const r = g.rival.state();
    ev('ring', `TOOK the ring (${moment}${v ? `; ${v.name} owner ${v.owner}, fear ${v.fear}, belief ${Math.floor(v.belief)}` : ''}); balance ${g.balance.value.toFixed(3)}, alignment ${g.player.alignment.toFixed(2)}, his tier ${r.tier}/${r.maxTier}, ring steps ${r.ring.steps}`);
    B.shots.push({ key: `31-ring${g.rival.ring.offered}-taken-card`, focus: null, wait: 3500 });
    if (v) B.shots.push({ key: `32-ring${g.rival.ring.offered}-taken-${v.name}-fear`, focus: { x: v.center.x, z: v.center.z, distance: 110, hour: 0.8 }, wait: 2200 });
    B.shots.push({ key: `33-ring${g.rival.ring.offered}-taken-citadel`, focus: { ...g.rival.shotPose(r.maxTier), pose: true }, wait: 5200 });
  });
  E.on('ringRefused', ({ moment, timedOut }) => {
    ev('ring', `turned the ring down (${moment}${timedOut ? ', by letting it time out' : ''}); balance ${g.balance.value.toFixed(3)}, alignment ${g.player.alignment.toFixed(2)}`);
    B.shots.push({ key: `31-ring${g.rival.ring.offered}-refused`, focus: null, wait: 2500 });
  });
  B.answerRing = () => {
    const o = B.ring;
    if (!o || g.time < o.at) return;
    B.ring = null;
    // The real buttons, as a player would click them.
    const btn = document.querySelector(o.take ? '.rv-tempt.show .rt-take' : '.rv-tempt.show .rt-refuse');
    if (btn) btn.click();
    else ev('ring', 'the ring card was gone before the bot answered (timed out)');
  };
  E.on('villagerBorn', ({ villager }) => (B.born[name(villager.village)] = (B.born[name(villager.village)] ?? 0) + 1));
  E.on('villagerDied', ({ villager, cause }) => {
    const k = `${name(villager.village)}:${cause}`;
    B.died[k] = (B.died[k] ?? 0) + 1;
  });
  E.on('balanceBand', (b) => ev('balance', `balance band: ${JSON.stringify(b)}`));
  const lst = ps.listener;
  if (lst) {
    const add = lst.added.bind(lst);
    lst.added = (pr) => {
      if (pr.kind !== 'project') ev('prayer', `${pr.village.name} prays: ${pr.kind}${pr.need ? ` (needs ${pr.need})` : ''}`, { village: pr.village.name, kind: pr.kind });
      return add(pr);
    };
    const gone = lst.gone.bind(lst);
    lst.gone = (pr) => {
      ev('faded', `${pr.village.name}'s ${pr.kind} prayer faded unanswered`, { village: pr.village.name, kind: pr.kind });
      return gone(pr);
    };
  }

  // ---- the hand (same checks as src/input/Controls.ts)
  const V = (x, z) => g.hand.ground.clone().set(x, g.terrain.heightAt(x, z), z);
  const canGrab = (e) => e.alive && e.grabbable && !e.held && !e.airborne && !e.rolling && g.inInfluence(e.pos.x, e.pos.z);
  const dist = (a, x, z) => Math.hypot(a.pos.x - x, a.pos.z - z);
  const busy = (d) => (B.busyUntil = g.time + CFG.base + d / CFG.pan); // a player's time: find it, lift it, pan, set it down
  function carry(e, x, z, why) {
    if (g.hand.held || !canGrab(e) || !g.inInfluence(x, z)) return false;
    const d = dist(e, x, z);
    g.hand.grab(g, e);
    g.hand.place(g, V(x, z));
    busy(d);
    B.actions++;
    ev('act', `${why} (carried ${Math.round(d)} m)`);
    return true;
  }
  function miracle(id, x, z, why) {
    const cost = { water: 250, food: 350, fire: 300 }[id];
    if (g.hand.held || g.player.power < cost || !g.inInfluence(x, z)) return false;
    g.selectMiracle(id);
    if (g.hand.held?.kind !== 'orb') return false;
    g.hand.place(g, V(x, z));
    busy(0);
    B.actions++;
    ev('act', `${why} (${id} miracle, power left ${Math.floor(g.player.power)})`);
    return true;
  }
  const nearestOf = (kind, x, z, ok) => {
    let best = null;
    let bd = Infinity;
    for (const e of g.entities) {
      if (e.kind !== kind || !canGrab(e) || (ok && !ok(e))) continue;
      const d = dist(e, x, z);
      if (d < bd) {
        bd = d;
        best = e;
      }
    }
    return best;
  };
  const tree = (x, z) => nearestOf('tree', x, z, (t) => t.mature && !t.burning && !t.charred && t.wood >= 10);
  const rock = (x, z) => nearestOf('rock', x, z, (r) => !g.villages.some((v) => v.projectSite && dist(r, v.projectSite.pos.x, v.projectSite.pos.z) < v.projectSite.radius + 1));
  const foodPile = (x, z) => nearestOf('food', x, z, (f) => f.amount >= 5 && !g.villages.some((v) => dist(f, v.store.pos.x, v.store.pos.z) < 14));

  const ORDER = { fire: 0, lost: 1, food: 2, rain: 3, sign: 4, timber: 5 };
  function answer(pr) {
    const v = pr.village;
    const s = v.store.pos;
    switch (pr.kind) {
      case 'fire':
        return pr.house ? miracle('water', pr.house.pos.x, pr.house.pos.z, `douse the fire in ${v.name}`) || (note('fire: no power'), false) : false;
      case 'lost': {
        const c = pr.villager;
        if (!c) return false;
        if (!g.inInfluence(c.pos.x, c.pos.z)) {
          note(`lost child of ${v.name} is outside your light`);
          return false;
        }
        return carry(c, v.worship.pos.x + 3, v.worship.pos.z + 3, `carry ${c.name} home to ${v.name}`);
      }
      case 'food': {
        const f = foodPile(s.x, s.z);
        if (f && carry(f, s.x, s.z, `food pile to ${v.name}'s storehouse`)) return true;
        if (miracle('food', s.x, s.z, `Food on ${v.name}'s storehouse`)) return true;
        note('food prayer: no food pile in reach and not enough power');
        return false;
      }
      case 'rain':
      case 'sign':
        if (miracle('water', v.center.x, v.center.z, `${pr.kind}: Water over ${v.name}`)) return true;
        note(`${pr.kind} prayer: not enough power for Water (250)`);
        return false;
      case 'timber': {
        const t = tree(s.x, s.z);
        if (t && carry(t, s.x, s.z, `tree to ${v.name}'s storehouse (timber prayer)`)) return true;
        note('timber prayer: no grown tree in your light');
        return false;
      }
    }
    return false;
  }

  /** Help a dream: boulders for stone; a tree or food if the village's own store can't feed it. */
  function helpSite(v) {
    const site = v.projectSite;
    if (!site || site.complete) return false;
    if (!B.siteSeen.has(site)) B.siteSeen.set(site, g.time);
    if (g.time - B.siteSeen.get(site) < CFG.siteReact) return false;
    if (site.open('stone') >= 0.5) {
      const r = rock(site.pos.x, site.pos.z);
      if (r && carry(r, site.pos.x, site.pos.z, `boulder onto ${v.name}'s ${site.def.name} site (${Math.floor(site.have.stone)}/${site.def.needs.stone} stone)`)) return true;
      note('no boulder in your light');
    }
    if (site.open('wood') >= 1 && v.store.wood < 18) {
      const t = tree(site.pos.x, site.pos.z);
      if (t && carry(t, site.pos.x, site.pos.z, `tree onto ${v.name}'s ${site.def.name} site (its store is out of wood)`)) return true;
    }
    if (site.open('food') >= 1 && v.store.food < 40) {
      if (miracle('food', v.store.pos.x, v.store.pos.z, `Food on ${v.name}'s store for its ${site.def.name}`)) return true;
    }
    return false;
  }

  /** The last age: prayers anywhere, then the Nexus (boulders for stone; a tree or food if the villages run short). */
  function nexusTick() {
    const prs = ps.active.filter((x) => x.kind !== 'project' && g.canReach(x.village) && g.time - x.bornAt >= CFG.react).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.bornAt - b.bornAt);
    for (const pr of prs) if (answer(pr)) return;
    const site = g.nexus.site;
    if (!site || site.complete) return;
    if (!B.siteSeen.has(site)) B.siteSeen.set(site, g.time);
    if (g.time - B.siteSeen.get(site) < CFG.siteReact) return;
    const name = `the Nexus (${g.nexus.stones} of 7 stones, ${Math.floor(site.have.stone)}/${site.def.needs.stone} stone)`;
    if (site.open('stone') >= 0.5) {
      const r = nearestOf('rock', site.pos.x, site.pos.z, (x) => dist(x, site.pos.x, site.pos.z) > site.radius + 1);
      if (r && carry(r, site.pos.x + (Math.random() - 0.5) * 8, site.pos.z + (Math.random() - 0.5) * 8, `boulder onto ${name}`)) return;
      note('nexus: no boulder in your light');
    }
    const low = g.villages.every((v) => v.store.wood < 20);
    if (site.open('wood') >= 1 && low) {
      const t = tree(site.pos.x, site.pos.z);
      if (t && carry(t, site.pos.x, site.pos.z, `tree onto ${name}`)) return;
    }
    if (site.open('food') >= 1 && g.villages.every((v) => v.store.food < 45)) {
      if (miracle('food', site.pos.x, site.pos.z, `Food onto ${name}`)) return;
    }
    note(`idle in the last age (${g.nexus.phase})`);
  }

  B.tick = () => {
    if (g.time < B.busyUntil || g.hand.held) return;
    if (g.nexus?.phase === 'ring') return nexusTick();
    const goal = g.story.goal;
    if (!goal) return;
    const home = g.time < (CFG.homeUntil ?? 0); // homebody: only your own villages for now
    // 1. Prayers anywhere the hand can act.
    const prs = ps.active.filter((x) => x.kind !== 'project' && g.canReach(x.village) && (!home || x.village.owner === 'player') && g.time - x.bornAt >= CFG.react).sort((a, b) => ORDER[a.kind] - ORDER[b.kind] || a.bornAt - b.bornAt);
    for (const pr of prs) if (answer(pr)) return;
    // 2. Dreams: Ora's goal village first, then your villages, then neighbours in reach.
    const focus = goal.id === 'carry' ? goal.via : goal.village;
    const order = [focus, ...g.villages.filter((v) => v !== focus && v.owner === 'player'), ...g.villages.filter((v) => v !== focus && v.owner !== 'player' && g.canReach(v))];
    for (const v of order) if (v && g.canReach(v) && (!home || v.owner === 'player') && helpSite(v)) return;
    // 3. Win: a gift on their storehouse now and then (Ora: "drop what they need on their storehouse").
    if (!home && goal.id === 'win' && g.canReach(goal.village) && g.time - B.lastGiftAt > CFG.giftEvery) {
      const s = goal.village.store.pos;
      const t = tree(s.x, s.z);
      if (t && carry(t, s.x, s.z, `gift: a tree on ${goal.village.name}'s storehouse`)) {
        B.lastGiftAt = g.time;
        return;
      }
    }
    // 4. Carry: Ora says every gift carries the light further; a gift to the village whose light is growing.
    if (!home && goal.id === 'carry' && goal.via && goal.via.influenceRadius < goal.via.ringCap - 1 && g.time - B.lastGiftAt > CFG.giftEvery) {
      const s = goal.via.store.pos;
      const t = tree(s.x, s.z);
      if (t && carry(t, s.x, s.z, `gift: a tree on ${goal.via.name}'s storehouse (to grow the light)`)) {
        B.lastGiftAt = g.time;
        return;
      }
    }
    note(`idle on goal ${goal.id}`);
  };

  // ---- the timeline row (every game minute)
  // Metres between the edge of your light and the edge of the village's lands (radius x 1.8): <= 0 means in reach.
  const light = (v) => {
    const mine = g.villages.filter((o) => o.owner === 'player' && o !== v);
    if (!mine.length) return null;
    return Math.round(Math.min(...mine.map((o) => Math.hypot(o.center.x - v.center.x, o.center.z - v.center.z) - g.lightEdgeToward(o, v.center.x, v.center.z) - v.radius * 1.8)));
  };
  B.row = () => {
    const st = g.story.state();
    const r = g.rival?.state?.() ?? {};
    const isle = g.rival?.isle?.group;
    const row = {
      game_min: Math.round(g.time / 6) / 10,
      real_s: 0,
      goal: st.goal?.id ?? '',
      goal_village: st.goal?.village ?? '',
      goal_key: st.goal?.key ?? '',
      goal_for_min: Math.round((g.time - B.goalSince) / 6) / 10,
      power: Math.floor(g.player.power),
      balance: +(g.balance?.value ?? 0).toFixed(3),
      answered: ps.answered,
      actions: B.actions,
      rival_stage: r.stage ?? '',
      rival_stirring: r.stirring ?? '',
      rival_mood: r.mood ?? '',
      rival_scheme: r.scheme?.kind ?? r.scheme?.name ?? (r.scheme ? 'yes' : ''),
      rival_isle_near: r.isleNear ?? '',
      rival_isle_visible: isle ? isle.visible : '',
      rival_isle_dist: isle ? Math.round(Math.hypot(isle.position.x, isle.position.z)) : '',
      rival_isle_scale: isle ? +isle.scale.x.toFixed(3) : '',
      rival_noticed: r.noticed ?? '',
      rival_risen: r.risen ?? '',
      rival_tier: r.tier ?? '',
      rival_courted: (r.courted ?? []).join('|'),
      rival_farewell: r.farewell ?? '',
      rival_foiled: r.foiled ?? '',
      rival_scheme_village: r.scheme?.village ?? '',
      rival_scheme_phase: r.scheme?.phase ?? '',
      rival_scheme_repel: r.scheme?.repel ?? '',
      ring_offered: r.ring?.offered ?? '',
      ring_taken: r.ring?.taken ?? '',
      ring_refused: r.ring?.refused ?? '',
      ring_fear: (r.ring?.fear ?? []).join('|'),
      alignment: +g.player.alignment.toFixed(3),
      temples_stand: g.allTemplesStand(),
      tune_days: +(g.endings.tuneDays ?? 0).toFixed(3),
      day_clock: +(g.day + g.dayTime).toFixed(3),
      nexus_phase: g.nexus?.phase ?? '',
      nexus_stones: g.nexus?.stones ?? '',
      nexus_fraction: g.nexus?.site ? +g.nexus.site.fraction.toFixed(3) : '',
      telor_t: g.nexus?.phase === 'city' ? Math.round(g.nexus.cityT) : '',
    };
    for (const v of g.villages) {
      const k = v.name;
      const site = v.projectSite;
      const prays = ps.active.filter((x) => x.village === v && x.kind !== 'project').map((x) => x.kind);
      Object.assign(row, {
        [`${k}_owner`]: v.owner ?? 'none',
        [`${k}_belief`]: Math.floor(v.belief),
        [`${k}_pop`]: v.population,
        [`${k}_houses`]: v.houses.length,
        [`${k}_worshippers`]: v.worshipperCount,
        [`${k}_stage`]: v.shrineStage,
        [`${k}_families`]: `${v.familiesWithYou()}/${v.households().length}`,
        [`${k}_ring_m`]: v.owner === 'player' ? Math.round(v.influenceRadius) : g.canReach(v) ? Math.round(g.neighbourGlow(v).ra) : 0,
        [`${k}_round_m`]: v.owner === 'player' ? Math.round(v.roundRadius) : '',
        [`${k}_cap_m`]: v.owner === 'player' ? v.ringCap : '',
        [`${k}_can_reach`]: g.canReach(v),
        [`${k}_gap_to_light_m`]: v.owner === 'player' ? 0 : light(v),
        [`${k}_project`]: site ? `${site.def.id} ${Math.round(site.fraction * 100)}%` : '',
        [`${k}_prayers`]: prays.join('|'),
        [`${k}_food`]: Math.floor(v.store.food),
        [`${k}_wood`]: Math.floor(v.store.wood),
        [`${k}_born`]: B.born[k] ?? 0,
      });
    }
    B.timeline.push(row);
    return row;
  };

  // ---- milestones (a screenshot each)
  const vil = (n) => g.villages.find((v) => v.name === n);
  const once = (key, test, focus) => {
    if (B.seen[key] || !test()) return;
    B.seen[key] = g.time;
    ev('milestone', key);
    B.shots.push({ key, focus });
  };
  const at = (v, d = 230) => ({ x: v.center.x, z: v.center.z, distance: d });
  const between = (a, b, d = 420) => ({ x: (a.center.x + b.center.x) / 2, z: (a.center.z + b.center.z) / 2, distance: d });
  B.milestones = () => {
    const A = vil('Ashford');
    const Br = vil('Brambleholt');
    const S = vil('Stonemere');
    once('01-start', () => true, at(A));
    once('02-first-prayer-answered', () => ps.answered >= 1, at(A));
    once('03-ashford-stones', () => A.shrineStage !== 'totem', at(A));
    // Ashford's light leaning toward Brambleholt (its tip well past its round part), before it touches.
    const tipFocus = (src, t, d = 300) => {
      const e = g.lightEdgeToward(src, t.center.x, t.center.z);
      const len = Math.hypot(t.center.x - src.center.x, t.center.z - src.center.z);
      const k = Math.min(1, e / len) * 0.8;
      return { x: src.center.x + (t.center.x - src.center.x) * k, z: src.center.z + (t.center.z - src.center.z) * k, distance: d };
    };
    once('03b-ring-leaning-toward-brambleholt', () => A.influenceRadius - A.roundRadius > 22 && !g.withinReach(Br) && Br.owner !== 'player', { ...tipFocus(A, Br, 340), hour: 0.79 });
    once('04-brambleholt-in-reach', () => g.withinReach(Br) || Br.owner === 'player', between(A, Br));
    // Half-joined: some of its families glow gold, not yet most.
    once('04b-brambleholt-half-joined', () => Br.owner === null && Br.familiesWithYou() >= Math.max(1, Br.familiesNeeded() - 1), { x: Br.center.x, z: Br.center.z, distance: 120 });
    once('05-brambleholt-converted', () => Br.owner === 'player', at(Br));
    once('06-stonemere-in-reach', () => g.withinReach(S) || S.owner === 'player', between(Br, S));
    // Stonemere's own glow, grown with its belief, meets your ring.
    once('06b-stonemere-glow-joins', () => S.owner === null && g.withinReach(S) && Math.min(...g.ownLight().map((l) => Math.hypot(l.shape.ax - S.center.x, l.shape.az - S.center.z) - g.lightEdgeToward(l.village, S.center.x, S.center.z))) <= g.neighbourGlow(S).ra, { ...between(Br, S, 380), hour: 0.79 });
    once('06c-stonemere-half-joined', () => S.owner === null && S.familiesWithYou() >= Math.max(1, S.familiesNeeded() - 1), { x: S.center.x, z: S.center.z, distance: 120 });
    once('07-stonemere-converted', () => S.owner === 'player', at(S));
    if (!B.seen.tune && g.allTemplesStand()) {
      B.seen.tune = g.time;
      ev('milestone', `tune step begins: every temple stands (day clock ${(g.day + g.dayTime).toFixed(2)}, balance ${g.balance.value.toFixed(3)})`);
    }
    for (const v of g.villages) once(`08-temple-${v.name}`, () => v.shrineStage === 'temple' && v.owner === 'player', at(v, 150));
    // Stuck: more than 10 game minutes on one goal.
    const key = g.story.goal?.key ?? '';
    if (key !== B.goalKey) {
      B.goalKey = key;
      B.goalSince = g.time;
    } else if (key && g.time - B.goalSince > 600) {
      const n = Math.floor((g.time - B.goalSince) / 600);
      if ((B.goalStuckShots[key] ?? 0) < n && n <= 3) {
        B.goalStuckShots[key] = n;
        const goal = g.story.goal;
        ev('stuck', `stuck on "${key}" for ${n * 10} game minutes`);
        const gv = goal.via ?? goal.village;
        B.shots.push({ key: `stuck-${key.replace(/[^a-z0-9]+/gi, '_')}-${n * 10}min`, focus: goal.id === 'carry' ? between(goal.via, goal.village) : at(gv, 260) });
      }
    }
  };

  /** Run `seconds` of game time, one game second at a time; stop early when a screenshot is due or the ending begins. */
  B.run = (seconds) => {
    g.render = () => {};
    for (let i = 0; i < seconds; i++) {
      g.advance(1);
      B.answerRing();
      B.tick();
      B.milestones();
      B.watchRival();
      const sh = ora.state().showing;
      if (sh && sh !== B.lastShowing) ev('ora-shown', sh);
      B.lastShowing = sh;
      if (g.time - B.lastRow >= 60) {
        B.lastRow = g.time;
        B.row();
      }
      if (g.endings.phase !== 'play' && g.endings.phase !== 'after') {
        ev('ending', `ending phase: ${g.endings.phase} (tune step lasted ${B.seen.tune === undefined ? '?' : Math.round(g.time - B.seen.tune)} game s, ${(g.endings.tuneDays ?? 0).toFixed(2)} game days in tune)`);
        B.shots.push({ key: `09-ending-${g.endings.phase}`, focus: at(g.villages[0], 300) });
        return { end: g.endings.phase };
      }
      B.watchNexus();
      if (g.nexus?.phase === 'lit') {
        ev('ending', `THE TRUE END begins: Telor stands (${JSON.stringify(g.nexus.state().city)})`);
        return { end: 'true-end' };
      }
      if (B.shots.length) break;
    }
    return { end: null };
  };
  // ---- the last age
  B.nexus = { stones: 0, step: null, phase: 'off' };
  B.watchNexus = () => {
    const n = g.nexus;
    if (!n) return;
    const st = n.state();
    const N = B.nexus;
    const focus = st.site ? { x: st.site.x, z: st.site.z, distance: 120 } : null;
    if (st.phase !== N.phase) {
      ev('nexus', `the last age: ${N.phase} -> ${st.phase}${st.site ? ` (site ${st.site.x}, ${st.site.z})` : ''}`);
      if (st.phase === 'ring') {
        N.ringAt = g.time;
        B.shots.push({ key: '40-nexus-begins', focus: { ...focus, distance: 240 } });
      }
      if (st.phase === 'city') {
        N.cityAt = g.time;
        ev('nexus', `THE RING STANDS after ${Math.round(g.time - (N.ringAt ?? g.time))} game s (${((g.time - (N.ringAt ?? g.time)) / 60).toFixed(1)} game min)`);
      }
      if (st.phase === 'lit') ev('nexus', `TELOR STANDS after ${Math.round(g.time - (N.cityAt ?? g.time))} game s of building`);
      N.phase = st.phase;
    }
    if (st.stones > N.stones) {
      N.stones = st.stones;
      ev('nexus', `stone ${st.stones} of 7 rises (${JSON.stringify(st.site.have)})`);
      if ([1, 4, 7].includes(st.stones)) B.shots.push({ key: `41-nexus-stone-${st.stones}`, focus: { ...focus, distance: 90 }, wait: 4500 });
    }
    if (st.step && st.step !== N.step) {
      N.step = st.step;
      ev('nexus', `Telor: ${st.step} (${JSON.stringify(st.city)})`);
      B.shots.push({ key: `42-telor-${st.step}`, focus: { ...focus, distance: 280 } });
    }
  };

  B.drain = () => {
    const out = { events: B.events, timeline: B.timeline, shots: B.shots };
    B.events = [];
    B.timeline = [];
    B.shots = [];
    return out;
  };
}, CFG);

// ------------------------------------------------------------------ the loop, in node
const events = [];
const timeline = [];
const shotsTaken = [];
const fmt = (t) => `${String(Math.floor(t / 60)).padStart(3, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

// Milestone shots are taken in daylight (DAYLIGHT_SHOTS=0 keeps the game's own hour): the clock is set to late
// morning for the shot and put back after, so judging a look never depends on whether it happened at night.
// A shot with no focus (the rival's glance) keeps the game's own camera and hour.
const DAYLIGHT = process.env.DAYLIGHT_SHOTS !== '0';
async function shoot(key, focus, wait = 1600, seq = null) {
  if (seq) {
    // A run of frames as the game plays in real time (the rising, a glance): its own camera and hour.
    await p.evaluate(() => {
      delete game.render;
      game.input.inside = false;
    });
    const t0 = Date.now();
    for (const ms of seq) {
      const d = ms - (Date.now() - t0);
      if (d > 0) await p.waitForTimeout(d);
      const file = `${key}-${(ms / 1000).toFixed(1)}s.png`;
      await p.screenshot({ path: `${OUT}/${file}` });
      shotsTaken.push(file);
    }
    await p.evaluate(() => (game.input.inside = true));
    return;
  }
  const keep = await p.evaluate(
    ({ f, day }) => {
      delete game.render;
      const was = game.dayTime;
      if (f) {
        if (f.pose) game.godCam.setPose({ x: f.x, z: f.z, distance: f.distance, pitch: f.pitch, yaw: f.yaw }, true, game.terrain);
        else game.godCam.setPose({ x: f.x, z: f.z, distance: f.distance, pitch: 0.82, yaw: 0.5 }, true);
        // Late morning, or the hour a shot asks for (the light's gold edge reads best at dusk).
        if (day) game.dayTime = f.hour ?? 0.42;
        game.input.inside = false; // no hand in the picture
      }
      return was;
    },
    { f: focus, day: DAYLIGHT && !!focus },
  );
  await p.waitForTimeout(wait);
  const file = `${key}.png`;
  await p.screenshot({ path: `${OUT}/${file}` });
  shotsTaken.push(file);
  await p.evaluate(({ was, day }) => {
    if (day) game.dayTime = was;
    game.input.inside = true;
  }, { was: keep, day: DAYLIGHT && !!focus });
}

async function flush() {
  const d = await p.evaluate(() => __bot.drain());
  const now = realS();
  for (const e of d.events) events.push({ ...e, real: Math.round(now) });
  for (const r of d.timeline) timeline.push({ ...r, real_s: Math.round(now) });
  // Frames of the game's own camera (the rising, a glance) first: a posed shot calls setPose, which would cancel the glide.
  for (const s of [...d.shots.filter((x) => x.seq), ...d.shots.filter((x) => !x.seq)]) await shoot(s.key, s.focus, s.wait, s.seq);
  return d;
}

async function writeOut(final = false) {
  if (!timeline.length) return;
  const cols = Object.keys(timeline[timeline.length - 1]);
  const csv = [cols.join(','), ...timeline.map((r) => cols.map((c) => JSON.stringify(r[c] ?? '')).join(','))].join('\n');
  await fs.writeFile(`${OUT}/timeline.csv`, csv);
  await fs.writeFile(`${OUT}/timeline.json`, JSON.stringify(timeline));
  await fs.writeFile(`${OUT}/events.json`, JSON.stringify(events));
  const label = { ora: 'Ora', 'ora-shown': 'Ora (on screen)', advisor: '', vexahl: 'Vexahl', 'vexahl-shown': 'Vexahl (card on screen)', scheme: 'SCHEME', ring: 'THE RING' };
  const lines = events
    .filter((e) => e.type !== 'act' || final)
    .map((e) => {
      const who = e.type === 'advisor' ? e.who : label[e.type] ?? e.type.toUpperCase();
      return `- \`${fmt(e.t)}\` (real ${e.real}s) **${who}**: ${e.text}`;
    });
  const st = await p.evaluate(() => ({ notes: __bot.notes, sources: __bot.sources, born: __bot.born, died: __bot.died, actions: __bot.actions, time: game.time }));
  const md = [
    '# THE FIRST WORLD: bot run, events',
    '',
    `Profile: **${PROFILE}** ${JSON.stringify(CFG)} · ring: **${RING}**`,
    '',
    `Game time is mm:ss of game time (\`advance()\` steps), real is seconds since the bot started. Bot hand actions (\`ACT\`) are listed too.`,
    '',
    `Game time reached: ${fmt(st.time)} · real ${Math.round(realS())} s · hand actions ${st.actions}`,
    '',
    '## Belief sources (neutral villages, approximate points)',
    '',
    '```json',
    JSON.stringify(st.sources, null, 1),
    '```',
    '',
    '## Why the bot could not act (counts, one per game second it was free)',
    '',
    '```json',
    JSON.stringify(st.notes, null, 1),
    '```',
    '',
    `Births per village: \`${JSON.stringify(st.born)}\` · deaths: \`${JSON.stringify(st.died)}\``,
    '',
    '## Timeline',
    '',
    ...lines,
    '',
    errors.length ? `## Console errors\n\n${errors.slice(0, 40).map((e) => `- ${e}`).join('\n')}` : '',
  ].join('\n');
  await fs.writeFile(`${OUT}/events.md`, md);
}

// Where Vexahl is at the start: the camera turned toward his isle from Ashford, as his own arrival glance does.
await p.evaluate(() => {
  delete game.render;
  const a = game.villages[0].center;
  const i = game.rival.isle.group.position;
  const px = a.x + (i.x - a.x) * 0.3;
  const pz = a.z + (i.z - a.z) * 0.3;
  game.godCam.setPose({ x: px, z: pz, distance: 600, pitch: 0.3, yaw: Math.atan2(-(i.x - px), -(i.z - pz)) }, true);
});
await p.waitForTimeout(2000);
await p.screenshot({ path: `${OUT}/00-where-is-vexahl.png` });

let ended = null;
let lastWrite = 0;
const closeCard = async (label) => {
  // The card holds a few seconds before a click takes you back to the island.
  await p.waitForTimeout(6500);
  await p.screenshot({ path: `${OUT}/${label}.png` });
  // Whole's card closes on a click; the true end's asks, and the bot stays on this island (Escape, the controller's B).
  await p.mouse.click(160, SIZE.height - 140);
  await p.keyboard.press('Escape');
};
for (;;) {
  const r = await p.evaluate((n) => __bot.run(n), BATCH);
  await flush();
  const t = await p.evaluate(() => game.time);
  if (r.end === 'true-end') {
    ended = 'true-end';
    await p.evaluate(() => delete game.render);
    for (const at of [4, 10, 14, 18, 22]) {
      await p.waitForFunction((at) => (game.nexus.state().end?.t ?? 0) >= at, at, { timeout: 90000 }).catch(() => {});
      await p.screenshot({ path: `${OUT}/50-true-end-${String(at).padStart(2, '0')}s.png` });
    }
    await p.waitForFunction(() => game.nexus.state().end?.card, null, { timeout: 90000 }).catch(() => {});
    await closeCard('51-true-end-card');
    await p.waitForFunction(() => game.nexus.phase === 'done', null, { timeout: 60000 }).catch(() => {});
    await p.waitForTimeout(4000);
    await p.screenshot({ path: `${OUT}/52-after-the-true-end.png` });
    const fin = await p.evaluate(() => ({ phase: game.nexus.phase, time: game.time, card: [...document.querySelectorAll('.endings-card .ec-line')].map((e) => e.textContent) }));
    events.push({ t: Math.round(fin.time), type: 'ending', text: `the true end is over: the island goes on (${fin.phase})`, real: Math.round(realS()) });
    break;
  }
  if (r.end) {
    // The first ending (Ready to See, Whole): it plays in real time to its card, which in story mode is a turn.
    await p.evaluate(() => delete game.render);
    await p.waitForTimeout(6000);
    await p.screenshot({ path: `${OUT}/09-ending-later.png` });
    await p.waitForFunction(() => game.endings.phase === 'card', null, { timeout: 180000 }).catch(() => {});
    const card = await p.evaluate(() => [...document.querySelectorAll('.endings-card.on')].map((c) => `${c.querySelector('.ec-title').textContent} / ${c.querySelector('.ec-line').textContent}`));
    events.push({ t: Math.round(t), type: 'ending', text: `Whole's card: ${card.join(' | ')}`, real: Math.round(realS()) });
    await closeCard('09-whole-card');
    const ok = await p.waitForFunction(() => game.endings.phase === 'after' && game.nexus.phase === 'ring', null, { timeout: 60000 }).then(() => true).catch(() => false);
    if (!ok) {
      ended = `stuck after Whole (${await p.evaluate(() => `${game.endings.phase} / ${game.nexus.phase}`)})`;
      break;
    }
    events.push({ t: Math.round(t), type: 'ending', text: 'the card closes: the last age begins', real: Math.round(realS()) });
    continue;
  }
  if (t >= MAX_GAME_S) break;
  if (realS() - lastWrite > 60) {
    lastWrite = realS();
    await writeOut();
    console.log(`game ${fmt(t)} real ${Math.round(realS())}s`);
  }
}
await writeOut(true);
console.log(JSON.stringify({ ended, gameTime: await p.evaluate(() => game.time), real: realS(), shots: shotsTaken, errors: errors.length }));
await browser.close();
