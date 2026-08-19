#!/usr/bin/env node
// CRAB-BOSS GROTTO retrofit probe — proves the v9 rule: SOLID == RENDERED.
// The grotto's collision truth (massifAt / grottoOpenAt / grottoSolidAt) and
// its rendered rock (caps, marched wall rocks, mouth frame, kelp plug) must
// be one surface. Every exposed piece of solid boundary must wear real rock
// within half a body radius; every placed rock must be backed by solid.
// Also: the mouth + kelp-plug portal records, and the framed screenshots a
// human must LOOK at (mouth from the bay, funnel, corridor, arena, cove).
//
// Usage:
//   node test/probes/grotto.mjs            # full checks + screenshots + census
//   node test/probes/grotto.mjs census /path/to/index.html   # census only,
//     against an arbitrary build (for before/after draw-call deltas)
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { launchChrome, pageSession, mkApi, continueIn, sleep, SHOTS } from './p6g.mjs';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const GAME = path.resolve(DIR, '..', '..');

let pass = 0, fail = 0;
function check(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + label + (extra ? '  — ' + extra : '')); }
  return ok;
}

/* serve an arbitrary index build at '/', game dir for everything else */
function serveIndex(indexPath) {
  const srv = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    const f = p === '/' ? indexPath : path.join(GAME, p);
    if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

/* q2 mid-game save on the grotto quest, wall NOT burned (the fuzz fixture) */
const SAVE_Q2 = {
  v: 2, q: 2, ph: 0, mh: 8, sword: true, salt: 0,
  talked: { finn: 1, tock: 1, pearl: 1 },
  kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: false,
  bossDone: false, sky: 0, tidepool: false, lastShade: [8, 6],
};

const mode = process.argv[2] || 'full';
const indexPath = process.argv[3] ? path.resolve(process.argv[3]) : path.join(GAME, 'index.html');
const { srv, port: httpPort } = await serveIndex(indexPath);
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port);
const api = mkApi(c);
await api.init();
await api.seedSave(SAVE_Q2);
await api.nav(base + '/?turbo=6');
await continueIn(api);

/* the follow camera a player actually gets, aimed by heading */
async function shot(name, x, z, yaw, pitch) {
  await api.eval(`__fmDebug.warp(${x}, ${z})`);
  await api.waitTicks(20);
  await api.eval(`P.heading = ${yaw}; CAM.yaw = ${yaw} + Math.PI; CAM.pitch = ${pitch === undefined ? 0.3 : pitch}; CAM.ready = false; 0`);
  await api.waitTicks(12);
  await sleep(280);
  await api.shot('grotto-' + name);
}

/* draw-call census at fixed spots (same spots before/after) */
async function census() {
  const spots = [
    ['village', 0, -24, Math.PI * 0.25, 0.3],
    ['bay-mid', 8, 60, 0, 0.3],
    ['bay-mouth', 30, 114, 0, 0.3],
    ['arena', 62, 160, 0, 0.3],
  ];
  const out = {};
  for (const [tag, x, z, yaw, pitch] of spots) {
    await api.eval(`__fmDebug.warp(${x}, ${z})`);
    await api.waitTicks(20);
    await api.eval(`P.heading = ${yaw}; CAM.yaw = ${yaw} + Math.PI; CAM.pitch = ${pitch}; CAM.ready = false; 0`);
    await api.waitTicks(20);
    out[tag] = { calls: await api.eval('__fm.calls'), tris: await api.eval('__fm.tris') };
    console.log(`  census ${tag}: ${out[tag].calls} calls, ${out[tag].tris} tris`);
  }
  return out;
}

if (mode === 'census') {
  await census();
  c.close(); proc.kill(); srv.close();
  process.exit(0);
}

/* ── in-page coverage helpers, injected once ── */
await api.eval(`window.__gk = (function(){
  const RXA = CAP_RA, RXB = CAP_RB, EX = CAP_EX;
  const rocks = window.__grottoRocks || [];
  function rockCover(x, z) {
    for (let i = 0; i < rocks.length; i++) {
      const r = rocks[i];
      if (Math.hypot(x - r.x, z - r.z) <= r.R0 * 1.1 + 0.4) return true;
    }
    return false;
  }
  function inMouthArc(x, z) {   // cap A's skipped (unrendered) arc
    let a = Math.atan2((z - GROTTO_A.z) / (RXA * EX), (x - GROTTO_A.x) / RXA);
    if (a < 0) a += Math.PI * 2;
    return a > Math.PI * 1.32 && a < Math.PI * 1.68;
  }
  function capCover(x, z) {
    // near either cap's rendered skirt surface (the solid ellipse itself),
    // outside the mouth bite where the lathe is skipped
    const caps = [[GROTTO_A.x, GROTTO_A.z, RXA, true], [GROTTO_B.x, GROTTO_B.z, RXB, false]];
    for (const [cx, cz, R, hasMouth] of caps) {
      const m = Math.hypot((x - cx) / R, (z - cz) / (R * EX));
      if (Math.abs(m - 1) * R <= 0.55) {
        if (hasMouth && inMouthArc(x, z)) continue;
        if (groundH(x, z) < 2.35) return true;   // face is vertical to y 2.4
      }
    }
    return false;
  }
  function stoneCover(x, z) {   // jambs + portal stones + threshold frame
    return Math.abs(z - 135.2) < 3.6 && Math.abs(Math.abs(x - GROTTO_ENT.x) - 4.0) < 2.5;
  }
  function kelpCover(x, z) {    // the corridor plug is faced by the kelp wall
    const t = ((x - COR_WALK.ax) * 12 + (z - COR_WALK.az) * 6) / 180;
    if (t < 0.12 || t > 0.88) return false;
    return Math.hypot(x - (COR_WALK.ax + 12 * t), z - (COR_WALK.az + 6 * t)) < 3.1;
  }
  return { rocks, rockCover, capCover, stoneCover, kelpCover, inMouthArc,
    cover: (x, z) => rockCover(x, z) || capCover(x, z) || stoneCover(x, z) || kelpCover(x, z) };
})(); 0`);

/* ── 1. every exposed solid boundary point wears rendered rock ── */
{
  const r = await api.eval(`(function(){
    const bad = []; let n = 0; const step = 0.45;
    for (let x = 5; x <= 87; x += step) {
      for (let z = 123; z <= 187; z += step) {
        if (!grottoSolidAt(x, z)) continue;
        let edge = false;
        for (const d of [[step, 0], [-step, 0], [0, step], [0, -step]]) {
          if (!grottoSolidAt(x + d[0], z + d[1])) { edge = true; break; }
        }
        if (!edge) continue;
        n++;
        if (!__gk.cover(x, z)) bad.push([+x.toFixed(1), +z.toFixed(1)]);
      }
    }
    return { n, bad: bad.length, worst: bad.slice(0, 25) };
  })()`);
  check(r.bad === 0, 'solid boundary fully faced with rendered rock',
    `${r.n} edge samples, uncovered=${r.bad} ${JSON.stringify(r.worst)}`);
}

/* ── 2. the funnel: collision half-width == walled half-width, fine sweep ── */
{
  const r = await api.eval(`(function(){
    const bad = [];
    for (let z = 123.5; z <= 139.2; z += 0.3) {
      const hw = ENT_WALK.hw + Math.max(0, 131.5 - z) * 0.55;
      for (const s of [-1, 1]) {
        const bx = GROTTO_ENT.x + s * hw;
        if (!grottoSolidAt(bx + s * 0.3, z)) continue;   // no wall here — open bay or
                                                         // chamber air, no rock owed
        if (!(__gk.rockCover(bx, z) || __gk.stoneCover(bx, z) || __gk.capCover(bx, z)))
          bad.push([+bx.toFixed(1), +z.toFixed(1)]);
      }
    }
    return bad;
  })()`);
  check(r.length === 0, 'funnel walls rocked wherever the funnel is solid', JSON.stringify(r.slice(0, 12)));
}

/* ── 2b. no rendered face stands in walkable air (the walk-through-rock
   defect: cap B's skirt used to cross the corridor as a gray wall). Eye-
   height sightlines down the walkway and the corridor: the first opaque hit
   must never sit inside the open region. ── */
const LOS_EXPR = `(function(){
  const rc = new THREE.Raycaster();
  const bad = [];
  const cast = (ox, oy, oz, tx, tz, len, tag) => {
    const dir = new THREE.Vector3(tx - ox, 0, tz - oz).normalize();
    rc.set(new THREE.Vector3(ox, oy, oz), dir);
    rc.far = len;
    const hits = rc.intersectObjects(scene.children, true);
    for (const h of hits) {
      if (h.object.visible === false) continue;
      const m = h.object.material;
      if (m && (m.transparent || m.opacity < 1)) continue;
      if (grottoOpenAt(h.point.x, h.point.z, false) && h.point.y < 4.2)
        bad.push([tag, +h.point.x.toFixed(1), +h.point.y.toFixed(1), +h.point.z.toFixed(1)]);
      break;
    }
  };
  for (const y of [1.55, 2.3, 3.2]) {
    cast(30, y, 124.5, 30, 139, 15, 'walkway@' + y);
    cast(41.6, y, 155.8, 53, 161.5, 13.5, 'corridor@' + y);
    cast(53, y, 161.5, 41.6, 155.8, 13.5, 'corridor-back@' + y);
  }
  return bad;
})()`;
{
  await api.eval('__fmDebug.warp(30, 116)');
  await api.waitTicks(10);
  const r = await api.eval(LOS_EXPR);
  check(r.length === 0, 'no opaque face inside walkable air (sealed state)', JSON.stringify(r));
}

/* ── 3. no fog-of-rock: every placed rock backed by solid, out of walkable air ── */
{
  const r = await api.eval(`(function(){
    let unbacked = 0, intruding = 0;
    for (const r of __gk.rocks) {
      if (!massifAt(r.x, r.z)) unbacked++;
      for (let p = 0; p < 8; p++) {
        const a = p / 8 * Math.PI * 2;
        if (grottoOpenAt(r.x + Math.cos(a) * r.R0 * 0.62, r.z + Math.sin(a) * r.R0 * 0.62, true)) { intruding++; break; }
      }
    }
    return { total: __gk.rocks.length, unbacked, intruding };
  })()`);
  check(r.unbacked === 0 && r.intruding === 0,
    'every wall rock solid-backed and out of walkable air', JSON.stringify(r));
}

/* ── 4. the third massif disc is gone; its cove is honest open ground ── */
{
  const r = await api.eval(`JSON.stringify([massifAt(56, 146), massifAt(55, 144.5), massifAt(53, 143),
    grottoSolidAt(56, 146), groundH(56, 146)])`);
  const [m1, m2, m3, s1] = JSON.parse(r);
  check(!m1 && !m2 && !m3 && !s1, 'old invisible disc at (46,158): south cove now open', r);
}

/* ── 5. corridor still sealed pre-burn (flood fill, bay → arena) ── */
{
  const r = await api.eval(`(function(){
    const step = 0.75, x0 = 0, x1 = 92, z0 = 112, z1 = 186;
    const nx = Math.ceil((x1 - x0) / step), nz = Math.ceil((z1 - z0) / step);
    const seen = new Uint8Array(nx * nz);
    const qx = [Math.round((30 - x0) / step)], qz = [Math.round((118 - z0) / step)];
    seen[qx[0] * nz + qz[0]] = 1;
    let reach = false, cells = 0;
    while (qx.length) {
      const ix = qx.pop(), iz = qz.pop(); cells++;
      if (Math.hypot(x0 + ix * step - 62, z0 + iz * step - 166) < 11) reach = true;
      for (const dd of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const jx = ix + dd[0], jz = iz + dd[1];
        if (jx < 0 || jz < 0 || jx >= nx || jz >= nz) continue;
        if (seen[jx * nz + jz]) continue;
        if (grottoSolidAt(x0 + jx * step, z0 + jz * step)) continue;
        seen[jx * nz + jz] = 1; qx.push(jx); qz.push(jz);
      }
    }
    return { reach, cells };
  })()`);
  check(r.reach === false, 'arena unreachable before the wall burns (flood fill)', JSON.stringify(r));
}

/* ── 6. the walkway itself is open and its edges sit where declared ── */
{
  const r = await api.eval(`(function(){
    const bad = [];
    for (let z = 119; z <= 149; z += 1) if (grottoSolidAt(30, z)) bad.push(z);
    for (const z of [125, 128, 131, 134, 137]) {
      const hw = ENT_WALK.hw + Math.max(0, 131.5 - z) * 0.55;
      if (z > 123 && !grottoOpenAt(30 + hw - 0.2, z, true)) bad.push(['in', z]);
      if (grottoOpenAt(30 + hw + 0.25, z, true) && z < 135) bad.push(['out', z]);
    }
    return bad;
  })()`);
  check(r.length === 0, 'walkway open end to end, edges at the declared half-width', JSON.stringify(r));
}

/* ── 7. portal records: registered, truthful, driven by world state ── */
{
  const names = await api.eval(`(window.__PORTALS || []).map(p => p.name).join(',')`);
  check(names.includes('grotto-mouth') && names.includes('grotto-kelp-plug'),
    'portal records registered (guard-init)', names);
  const mouthOpen = await api.eval(`window.__PORTALS.find(p => p.name === 'grotto-mouth').openNow()`);
  check(mouthOpen === true, 'mouth portal reports open');
  const plugShut = await api.eval(`window.__PORTALS.find(p => p.name === 'grotto-kelp-plug').openNow()`);
  check(plugShut === false, 'kelp plug reports shut pre-burn');
  // world-state path: burn the wall via SAVE → applyWorldState, then re-ask
  const plugOpen = await api.eval(`(function(){
    SAVE.wallBurned = true; applyWorldState();
    const v = window.__PORTALS.find(p => p.name === 'grotto-kelp-plug').openNow();
    SAVE.wallBurned = false; applyWorldState();
    return v;
  })()`);
  check(plugOpen === true, 'kelp plug reports open after wallBurned world state');
  const plugAgree = await api.eval(`(function(){
    const p = window.__PORTALS.find(p => p.name === 'grotto-kelp-plug');
    return p.openNow() === grottoOpenAt(47, 158.5, false);
  })()`);
  check(plugAgree === true, 'plug portal agrees with the collision answer');
}

/* ── 8. sanctuary/ambience regression: the walkway is still grotto ── */
{
  const r = await api.eval(`JSON.stringify([inGrottoAt(30, 137), inGrottoAt(30, 150), inShadeAt(30, 145)])`);
  check(JSON.parse(r).every(Boolean), 'grotto ambience/shade authority unchanged inside', r);
}

/* ── 9. the screenshots a human LOOKS at ── */
await shot('mouth-bay-far', 30, 112, 0, 0.24);
await shot('mouth-bay-mid', 26, 120, 0.3, 0.26);
await shot('mouth-bay-east', 40, 119, -0.6, 0.26);
await shot('mouth-bay-west', 18, 122, 0.85, 0.26);
await shot('funnel-approach', 30, 126, 0, 0.26);
await shot('funnel-inside-east-wall', 28.6, 131, 1.2, 0.3);
await shot('throat-in', 30, 133, 0, 0.3);
await shot('funnel-looking-out', 30, 139, Math.PI, 0.22);
await shot('chamberA-to-mouth', 30, 147, Math.PI, 0.24);
await shot('corridor-a2b-sealed', 42.5, 156.2, 1.107, 0.3);
await shot('cove-south', 54, 140, 0.1, 0.24);
await shot('cove-inside', 53.5, 146.5, 0.4, 0.28);
/* burn the wall through world state for the open-corridor + arena frames */
await api.eval('SAVE.wallBurned = true; applyWorldState(); 0');
await api.waitTicks(12);
{
  await api.eval('__fmDebug.warp(30, 116)');
  await api.waitTicks(10);
  const r = await api.eval(LOS_EXPR);
  check(r.length === 0, 'no opaque face inside walkable air (corridor open)', JSON.stringify(r));
}
await shot('corridor-a2b-open', 42.5, 156.2, 1.107, 0.3);
/* the corridor is roofed — with the sky magenta, not one pixel may leak */
await api.eval('__fmDebug.hud(false); __fmDebug.skyProbe(true); 0');
await sleep(350);
const leakA = await api.magenta(null, 'grotto-skyleak-a2b');
check(leakA === 0, 'corridor view a2b: zero sky pixels', 'magenta=' + leakA);
await api.eval('__fmDebug.skyProbe(false); __fmDebug.hud(true); 0');
await shot('corridor-b2a-open', 52.5, 161, 1.107 + Math.PI, 0.3);
await api.eval('__fmDebug.hud(false); __fmDebug.skyProbe(true); 0');
await sleep(350);
const leakB = await api.magenta(null, 'grotto-skyleak-b2a');
check(leakB === 0, 'corridor view b2a: zero sky pixels', 'magenta=' + leakB);
await api.eval('__fmDebug.skyProbe(false); __fmDebug.hud(true); 0');
await shot('arena', 58, 160, 0.55, 0.28);

/* ── 10. census + zero console errors ── */
await api.eval('SAVE.wallBurned = false; applyWorldState(); 0');
await census();
check(c.errs.length === 0, 'zero console errors', c.errs.slice(0, 3).join(' | '));

console.log(`\n${pass} passed, ${fail} failed`);
c.close(); proc.kill(); srv.close();
process.exit(fail ? 1 : 0);
