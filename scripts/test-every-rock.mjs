// Every rock on the island (2026-11-17, Daryll: "the first world, you can't pick up all the rocks very well").
//   npm run build && atlas-run dist scripts/test-every-rock.mjs <out> [WxH] [query]
//   e.g. atlas-run dist scripts/test-every-rock.mjs out/rocks 1072x1920 "&unlock=free"
// Unlike test-grab-rocks (20 rocks, one aim point, the same point the game aims at), this takes EVERY rock and points
// at nine places on the rock you can actually see (its middle and eight places 70% of the way to its outline; each
// one checked with a ray against the rock's own mesh and against the ground, so a point hidden behind a hill is not
// counted), from four camera heights. Part 1 is the hover: is the rock under the pointer the one the hand would take?
// Part 2 is unhurried clicks on every rock inside your light, mouse and controller. Part 3 is quick clicks, the button
// going down as the hand arrives, at full speed and with the page slowed. Each miss says what took the pointer.
// A fourth argument picks the parts, e.g. "3".
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const [W, H] = (process.argv[2] || '1600x900').split('x').map(Number);
const QUERY = process.argv[3] ?? '&unlock=free';
const PARTS = process.argv[4] || '123';   // 1 the hover survey, 2 unhurried clicks (mouse and controller), 3 quick clicks (the hand still arriving)
const OUT = process.env.OUT_DIR;
const b = await chromium.launch({ executablePath: process.env.CHROMIUM, args: ['--use-gl=angle', '--enable-gpu', '--ignore-gpu-blocklist', '--use-angle=vulkan'] });
const ctx = await b.newContext({ viewport: { width: W, height: H } });
await ctx.addInitScript(() => { try { for (const k of Object.keys(localStorage)) if (k.startsWith('godgame.')) localStorage.removeItem(k); } catch {} });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(String(e)));
await p.goto(`${process.env.SITE_URL}/index.html?shot=default&padtest${QUERY}`);
await p.waitForFunction(() => window.game, null, { timeout: 120000 });
await p.evaluate(() => { for (const s of document.querySelectorAll('style')) if (s.textContent.includes('visibility: hidden !important')) s.remove(); });
await p.getByText('Begin', { exact: false }).first().click({ timeout: 20000 }).catch(() => {});
await p.waitForTimeout(4000);
await p.keyboard.press('Escape').catch(() => {});
await p.evaluate(() => game.pace?.choose('walk'));
await p.waitForTimeout(3000);
// Let the island settle a little (boulders tumble in, villagers spread out), then hold time still so nothing walks
// under the pointer between the aim and the reading.
await p.evaluate(() => game.advance(60));
await p.waitForTimeout(500);

const frames = (n = 2) => p.evaluate((n) => new Promise((ok) => { let i = 0; const f = () => (++i >= n ? ok() : requestAnimationFrame(f)); requestAnimationFrame(f); }), n);
const rocks = await p.evaluate(() => {
  window.__rocks = game.entities.filter((e) => e.alive && e.kind === 'rock');
  return window.__rocks.map((e, i) => ({ i, r: +e.radius.toFixed(2), x: +e.pos.x.toFixed(1), z: +e.pos.z.toFixed(1), y: +e.pos.y.toFixed(1), ground: +game.terrain.heightAt(e.pos.x, e.pos.z).toFixed(1), land: game.terrain.isLand(e.pos.x, e.pos.z, 0), grabbable: e.grabbable, lit: game.inInfluence(e.pos.x, e.pos.z), rolling: !!e.rolling, airborne: !!e.airborne }));
});
console.log(`${W}x${H} ${QUERY}: ${rocks.length} rocks, ${rocks.filter((r) => r.lit).length} inside your light, ${rocks.filter((r) => !r.grabbable).length} not grabbable, ${rocks.filter((r) => !r.land).length} off the land`);

// Where the rock shows on screen: nine points on its visible outline box, kept only where a ray really meets its mesh
// before it meets the ground.
const aim = (i, distance, pitch) => p.evaluate(({ i, distance, pitch }) => {
  const e = window.__rocks[i]; if (!e.alive || e.held) return null;
  // the rock a little off the middle of the screen, as it would be in play
  const yaw = 0.4 + i * 0.7;
  game.godCam.setPose({ x: e.pos.x + Math.cos(i) * distance * 0.12, z: e.pos.z + Math.sin(i) * distance * 0.12, distance, pitch, yaw }, true, game.terrain);
  return true;
}, { i, distance, pitch });
const outline = (i) => p.evaluate((i) => {
  const e = window.__rocks[i], cam = game.godCam.camera, rc = game.raycaster;
  cam.updateMatrixWorld(true); e.object.updateWorldMatrix(true, true);
  let mesh = null; e.object.traverse((o) => { if (o.isMesh && !mesh) mesh = o; });
  const pos = mesh.geometry.attributes.position, v = e.pos.clone();
  let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9;
  for (let k = 0; k < pos.count; k++) {
    v.fromBufferAttribute(pos, k).applyMatrix4(mesh.matrixWorld).project(cam);
    const sx = (v.x * 0.5 + 0.5) * innerWidth, sy = (-v.y * 0.5 + 0.5) * innerHeight;
    x0 = Math.min(x0, sx); x1 = Math.max(x1, sx); y0 = Math.min(y0, sy); y1 = Math.max(y1, sy);
  }
  const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = (x1 - x0) / 2, ry = (y1 - y0) / 2, pts = [];
  const ndc = rc.ray.origin.clone(), ground = e.pos.clone(); let hidden = 0;
  const near = game.entities.filter((o) => o !== e && o.alive && o.kind !== 'tree' && o.object && Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < 25).map((o) => o.object);
  for (let k = -1; k < 8; k++) {
    const a = k * Math.PI / 4, f = k < 0 ? 0 : 0.7, sx = cx + Math.cos(a) * rx * f, sy = cy + Math.sin(a) * ry * f;
    if (sx < 4 || sy < 4 || sx > innerWidth - 4 || sy > innerHeight - 4) continue;
    ndc.set((sx / innerWidth) * 2 - 1, -(sy / innerHeight) * 2 + 1, 0);
    rc.setFromCamera(ndc, cam);
    const hit = rc.intersectObject(mesh, false)[0]; if (!hit) continue;
    const g = game.terrain.raycast(rc.ray, ground) ? rc.ray.origin.distanceTo(ground) : 1e9;
    if (g < hit.distance - 0.05) continue;                    // the ground is in front here: this part of the rock is buried or behind a hill
    // something drawn in front of the rock here (a tree's crown or trunk, a house, a person): you are not looking at the rock
    const front = rc.intersectObjects([...game.forest.meshes, ...near], true)[0];
    if (front && front.distance < hit.distance - 0.05) { hidden++; continue; }
    const el = document.elementFromPoint(sx, sy);
    pts.push({ k, sx, sy, dom: el && el.tagName !== 'CANVAS' ? `${el.tagName}.${String(el.className).slice(0, 30)}` : null });
  }
  return { w: Math.round(x1 - x0), h: Math.round(y1 - y0), pts, hidden };
}, i);
const read = (i) => p.evaluate((i) => {
  const e = window.__rocks[i], h = game.hand, o = h.hover;
  return { same: o === e, valid: h.valid, mode: game.controls.mode, help: !!game.hud.helpOpen, inside: game.input.inside,
    other: o && o !== e ? { kind: o.kind, d: +Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z).toFixed(1), r: +o.radius.toFixed(1) } : null,
    bld: game.hoverBuilding ? game.hoverBuilding.kind : null };
}, i);

// ------------------------------------------------------------------ part 1: the hover, everywhere on every rock
const POSES = [[40, 0.95], [80, 0.95], [150, 0.95], [260, 0.95], [420, 0.95], [80, 0.55], [150, 1.25]];
const report = {};
async function survey(label, list) {
const hover = {}; const why = {}; const perRock = rocks.map((r) => ({ ...r, tries: 0, ok: 0 }));
console.log(`\n== ${label}: ${list.length} rocks`);
for (const [distance, pitch] of POSES) {
  const key = `d${distance} p${pitch}`; hover[key] = { tries: 0, ok: 0, centre: [0, 0], edge: [0, 0], unseen: 0, hidden: 0 };
  for (const r of list) {
    if (!(await aim(r.i, distance, pitch))) continue;
    await frames(3);
    const o = await outline(r.i);
    hover[key].hidden += o.hidden;
    if (!o.pts.length) { hover[key].unseen++; continue; }
    for (const pt of o.pts) {
      await p.mouse.move(pt.sx, pt.sy); await frames(2);
      // a second reading after the hover has had a frame to stick is what a player gets
      const s = await read(r.i);
      const bucket = pt.k < 0 ? 'centre' : 'edge';
      hover[key].tries++; hover[key][bucket][1]++; perRock[r.i].tries++;
      if (s.same) { hover[key].ok++; hover[key][bucket][0]++; perRock[r.i].ok++; }
      else {
        const reason = pt.dom ? `a page element on top (${pt.dom})` : !s.valid ? 'the pointer is not over land (hand.valid false)' : s.mode !== 'none' ? `controls busy (${s.mode})` : s.help ? 'help open' :
          s.other ? `another thing took it: ${s.other.kind}` : s.bld ? `nothing grabbable in reach (a ${s.bld} is hovered)` : 'nothing in reach';
        why[reason] = (why[reason] || 0) + 1;
        (perRock[r.i].misses ||= []).push({ key, k: pt.k, w: o.w, h: o.h, reason, other: s.other });
      }
      await p.mouse.move(pt.sx + 300 > W ? pt.sx - 300 : pt.sx + 300, pt.sy > 300 ? pt.sy - 260 : pt.sy + 260); await frames(1);   // leave, so stickiness never helps the next point
    }
  }
  const hk = hover[key];
  console.log(`hover ${key}: ${hk.ok}/${hk.tries} (${(100 * hk.ok / Math.max(1, hk.tries)).toFixed(1)}%)  centre ${hk.centre[0]}/${hk.centre[1]}  edge ${hk.edge[0]}/${hk.edge[1]}  rocks with nothing showing ${hk.unseen}, points hidden behind something ${hk.hidden}`);
}
console.log('hover misses, by cause:', JSON.stringify(why, null, 1));
const worst = perRock.filter((r) => r.tries && r.ok / r.tries < 0.9).sort((a, b) => a.ok / a.tries - b.ok / b.tries);
console.log(`rocks under 90% hover: ${worst.length} of ${perRock.filter((r) => r.tries).length}`);
for (const r of worst.slice(0, 25)) console.log(`  rock ${r.i} r=${r.r} at (${r.x}, ${r.z}) lit=${r.lit}: ${r.ok}/${r.tries}  ` + JSON.stringify(Object.entries((r.misses || []).reduce((a, m) => ((a[m.reason] = (a[m.reason] || 0) + 1), a), {}))));
const tot = Object.values(hover).reduce((a, h) => [a[0] + h.ok, a[1] + h.tries], [0, 0]);
console.log(`${label} TOTAL: ${tot[0]}/${tot[1]} (${(100 * tot[0] / Math.max(1, tot[1])).toFixed(2)}%)`);
report[label] = { hover, why, total: tot, rocks: perRock.filter((r) => r.tries) };
}
await p.evaluate(() => { if (!game.paused) game.togglePause(); });
if (PARTS.includes('1')) await survey('where they lie', rocks);

// ------------------------------------------------------------------ part 1b: rocks set down inside the home village
// What happens once you carry one in: beside the storehouse, the prayer place, a house, a field, and among the people.
const moved = await p.evaluate(() => {
  const home = game.villages.find((v) => v.isHome) ?? game.villages[0];
  // a dream under way (its building site and tag) and prayers up (their bubbles), as in the middle of a game
  try { game.projectSystem.startNow(home); } catch {}
  for (const k of ['food', 'timber', 'rain']) { try { game.prayerSystem.spawnNow(home, k); } catch {} }
  game.advance(3);
  const spots = [];
  const kinds = ['store', 'worship', 'house', 'field', 'site'];
  for (const k of kinds) for (const e of game.entities) if (e.alive && e.kind === k && Math.hypot(e.pos.x - home.center.x, e.pos.z - home.center.z) < home.radius * 1.2) { spots.push({ k, x: e.pos.x, z: e.pos.z, r: e.radius }); if (spots.filter((s) => s.k === k).length >= (k === 'site' ? 4 : 2)) break; }
  const site = game.entities.find((e) => e.alive && e.kind === 'site');
  if (site) for (let n = 0; n < 3; n++) spots.push({ k: 'site', x: site.pos.x, z: site.pos.z, r: site.radius + 2 + n * 3 });
  const people = game.entities.filter((e) => e.alive && e.kind === 'villager' && e.object.visible && Math.hypot(e.pos.x - home.center.x, e.pos.z - home.center.z) < home.radius).slice(0, 4);
  for (const v of people) spots.push({ k: 'villager', x: v.pos.x, z: v.pos.z, r: 0 });
  const piles = game.entities.filter((e) => e.alive && (e.kind === 'food' || e.kind === 'wood') && game.inInfluence(e.pos.x, e.pos.z)).slice(0, 2);
  for (const v of piles) spots.push({ k: v.kind, x: v.pos.x, z: v.pos.z, r: v.radius });
  const out = [];
  spots.forEach((s, n) => {
    const e = window.__rocks[n]; if (!e) return;
    const a = n * 2.4, d = s.r + e.radius + 0.6;
    e.pos.x = s.x + Math.cos(a) * d; e.pos.z = s.z + Math.sin(a) * d; e.pos.y = game.terrain.heightAt(e.pos.x, e.pos.z) + e.groundOffset;
    e.airborne = false; e.rolling = false; e.vel.set(0, 0, 0); e.object.position.copy(e.pos);
    out.push({ i: n, beside: s.k, lit: game.inInfluence(e.pos.x, e.pos.z) });
  });
  return out;
});
console.log('set down beside:', moved.map((m) => `${m.i}:${m.beside}${m.lit ? '' : '(unlit)'}`).join(' '));
await frames(3);
if (PARTS.includes('1')) await survey('set down in the village', moved.map((m) => rocks[m.i]));

// ------------------------------------------------------------------ part 2: real clicks on every rock in your light
await p.evaluate(() => { if (game.paused) game.togglePause(); });
const setPad = (o) => p.evaluate((o) => { const f = window.__fakePad; if (!f) return; if (o.axes) o.axes.forEach((v, i) => (f.axes[i] = v)); if (o.btn) for (const [k, v] of Object.entries(o.btn)) { f.buttons[k].pressed = !!v; f.buttons[k].value = v ? 1 : 0; } }, o);
const handAt = () => p.evaluate(() => ({ x: game.input.x, y: game.input.y }));
async function padMove(tx, ty) {
  for (let n = 0; n < 400; n++) {
    const h = await handAt(); const dx = tx - h.x, dy = ty - h.y, d = Math.hypot(dx, dy);
    if (d < 4) break;
    // far: hold the stick; near: short nudges just past the stick's dead zone (0.2), as a thumb does to settle on something
    const k = d > 30 ? Math.max(0.3, Math.min(1, d / 140)) : 0.26;
    await setPad({ axes: [(dx / d) * k, (dy / d) * k, 0, 0] }); await p.waitForTimeout(d > 30 ? 40 : 16);
    if (d <= 30) { await setPad({ axes: [0, 0, 0, 0] }); await p.waitForTimeout(24); }
  }
  await setPad({ axes: [0, 0, 0, 0] }); await p.waitForTimeout(300);
}
const clicks = {};
let seed = 5; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
for (const how of PARTS.includes('2') ? ['mouse', 'pad'] : []) {
  for (const [distance, pitch] of [[60, 0.95], [130, 0.95], [220, 0.95]]) {
    const key = `${how} d${distance}`; clicks[key] = { tries: 0, ok: 0, misses: [] };
    for (const r of rocks) {
      const live = await p.evaluate((i) => { const e = window.__rocks[i]; return e.alive && !e.held && e.grabbable && !e.airborne && game.inInfluence(e.pos.x, e.pos.z); }, r.i);
      if (!live) continue;
      await aim(r.i, distance, pitch); await p.waitForTimeout(350);
      const o = await outline(r.i);
      // a point under one of the floating tags (a dream's tag, a prayer's bubble) is tried first when there is one
      const tagged = o.pts.filter((q) => q.dom && /pj-|pr-bubble|pr-mark|pm-/.test(q.dom));
      const pts = tagged.length ? tagged : o.pts.filter((q) => !q.dom); if (!pts.length) continue;
      const pt = pts[Math.floor(rnd() * pts.length)];
      if (tagged.length) clicks[key].underTag = (clicks[key].underTag || 0) + 1;
      if (how === 'mouse') { await p.mouse.move(pt.sx - 30, pt.sy - 20); await p.mouse.move(pt.sx, pt.sy, { steps: 4 }); await p.waitForTimeout(200); await p.mouse.click(pt.sx, pt.sy); }
      else { await padMove(pt.sx, pt.sy); await setPad({ btn: { 0: 1 } }); await p.waitForTimeout(120); await setPad({ btn: { 0: 0 } }); }
      await p.waitForTimeout(350);
      const got = await p.evaluate((i) => ({ same: game.hand.held === window.__rocks[i], held: game.hand.held?.kind ?? null, mode: game.controls.mode, hover: game.hand.hover?.kind ?? null }), r.i);
      clicks[key].tries++;
      if (got.same) { clicks[key].ok++; if (tagged.length) clicks[key].underTagOk = (clicks[key].underTagOk || 0) + 1; } else clicks[key].misses.push({ rock: r.i, r: r.r, k: pt.k, w: o.w, h: o.h, tag: pt.dom, ...got });
      await p.evaluate(() => { const h = game.hand; if (h.held) h.place(game, h.pickedFrom.clone()); game.controls.mode = 'none'; game.input.buttons.clear(); });
      if (how === 'mouse') await p.mouse.move(40, H - 40);
      await p.waitForTimeout(450);
    }
    console.log(`click ${key}: ${clicks[key].ok}/${clicks[key].tries}  (under a floating tag: ${clicks[key].underTagOk || 0}/${clicks[key].underTag || 0})`, JSON.stringify(clicks[key].misses));
  }
}

// ------------------------------------------------------------------ part 2b: a tag with nothing under it still works
// Clicking a dream's tag flies the camera to its building site. That must stay so when no rock, tree or pile is under it.
if (PARTS.includes('2')) {
  const tag = await p.evaluate(() => {
    const home = game.villages.find((v) => v.isHome) ?? game.villages[0];
    game.godCam.setPose({ x: home.center.x + 60, z: home.center.z + 40, distance: 300, pitch: 0.95, yaw: 0.4 }, true, game.terrain);
    return new Promise((ok) => setTimeout(() => {
      for (const c of document.querySelectorAll('.pj-chip')) {
        const r = c.getBoundingClientRect(); if (!r.width || c.style.display === 'none') continue;
        for (const fx of [0.5, 0.2, 0.8]) { const x = r.left + r.width * fx, y = r.top + r.height / 2; if (document.elementFromPoint(x, y)?.closest('.pj-chip') === c && !game.thingUnderTag?.(x, y)) return ok({ x, y, d0: game.godCam.distance }); }
      }
      ok(null);
    }, 600));
  });
  if (!tag) console.log('tag click: no free tag on screen to try');
  else {
    await p.mouse.move(tag.x - 20, tag.y - 10); await p.mouse.move(tag.x, tag.y, { steps: 3 }); await p.waitForTimeout(150);
    await p.mouse.click(tag.x, tag.y); await p.waitForTimeout(1800);
    const after = await p.evaluate(() => ({ d: game.godCam.distance, held: game.hand.held?.kind ?? null }));
    clicks.tag = { flew: Math.abs(after.d - 70) < 25 && tag.d0 > 200, ...after };
    console.log(`tag click with nothing under it: the camera ${clicks.tag.flew ? 'flew to the site (still works)' : 'did NOT fly'} (distance ${Math.round(tag.d0)} -> ${Math.round(after.d)}, held ${after.held})`);
    await p.evaluate(() => { const h = game.hand; if (h.held) h.place(game, h.pickedFrom.clone()); });
  }
}

// ------------------------------------------------------------------ part 3: quick clicks, as a hand really makes them
// The pointer travels 260 px to the rock in about a fifth of a second (fast, then slowing) and the button goes down
// 0, 35 or 70 ms after it arrives. Run at the machine's own frame rate and with the page slowed 4x and 8x (a slower
// computer, a busy island). A miss here with a hit in part 2 means the game acted on where the pointer WAS.
const quick = {};
if (PARTS.includes('3')) {
  const cdp = await ctx.newCDPSession(p);
  const fps = () => p.evaluate(() => new Promise((ok) => { let n = 0; const t0 = performance.now(); const f = () => { n++; if (performance.now() - t0 > 1000) ok(Math.round(n * 1000 / (performance.now() - t0))); else requestAnimationFrame(f); }; requestAnimationFrame(f); }));
  for (const slow of [1, 4, 8]) {
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: slow });
    await p.waitForTimeout(600);
    const rate = await fps();
    for (const delay of [0, 35, 70]) {
      const key = `slow x${slow} (${rate} fps), button ${delay} ms after arriving`; quick[key] = { tries: 0, ok: 0, dragged: 0, other: 0, misses: [] };
      for (const distance of [60, 130, 220]) {
        for (const r of rocks) {
          const live = await p.evaluate((i) => { const e = window.__rocks[i]; return e.alive && !e.held && e.grabbable && !e.airborne && game.inInfluence(e.pos.x, e.pos.z); }, r.i);
          if (!live) continue;
          await aim(r.i, distance, 0.95); await p.waitForTimeout(250 + slow * 60);
          const o = await outline(r.i);
          const pts = o.pts.filter((q) => !q.dom && q.k < 0);       // the rock's middle: the aim is not in question here, only the timing
          if (!pts.length) continue;
          const pt = pts[0], a0 = rnd() * Math.PI * 2;
          let fx = pt.sx + Math.cos(a0) * 260, fy = pt.sy + Math.sin(a0) * 260;
          if (fx < 20 || fx > W - 20) fx = pt.sx - Math.cos(a0) * 260; if (fy < 20 || fy > H - 20) fy = pt.sy - Math.sin(a0) * 260;
          await p.mouse.move(fx, fy); await p.waitForTimeout(140 + slow * 40);
          const t0 = Date.now();
          for (let n = 1; n <= 14; n++) { const u = n / 14, k = u * u * u * (10 - 15 * u + 6 * u * u); await p.mouse.move(fx + (pt.sx - fx) * k, fy + (pt.sy - fy) * k); const wait = t0 + n * 14 - Date.now(); if (wait > 0) await p.waitForTimeout(wait); }
          if (delay) await p.waitForTimeout(delay);
          await p.mouse.down(); await p.waitForTimeout(70); await p.mouse.up();
          await p.waitForTimeout(250 + slow * 50);
          const got = await p.evaluate((i) => ({ same: game.hand.held === window.__rocks[i], held: game.hand.held?.kind ?? null }), r.i);
          const q = quick[key]; q.tries++;
          if (got.same) q.ok++; else { if (got.held) q.other++; else q.dragged++; q.misses.push({ rock: r.i, distance, w: o.w, held: got.held }); }
          await p.evaluate(() => { const h = game.hand; if (h.held) h.place(game, h.pickedFrom.clone()); game.controls.mode = 'none'; game.input.buttons.clear(); });
          await p.mouse.move(40, H - 40); await p.waitForTimeout(350 + slow * 60);
        }
      }
      const q = quick[key];
      console.log(`quick click, ${key}: ${q.ok}/${q.tries}  (nothing taken: ${q.dragged}, something else taken: ${q.other})`);
    }
  }
  await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
}
await p.screenshot({ path: `${OUT}/last.png` });
await fs.writeFile(`${OUT}/report-${W}x${H}.json`, JSON.stringify({ size: [W, H], query: QUERY, rocks, report, clicks, quick, errors }, null, 1));
console.log('page errors', errors.length, errors.slice(0, 3));
await b.close();
