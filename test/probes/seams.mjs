#!/usr/bin/env node
// World-seam defect walk-tests (census #6 #8 #9 #11 #25) — real input, real
// player path, screenshots. Uses the p6e probe library for chrome/session.
import { serve, launchChrome, pageSession, mkApi, continueIn, ISLES, gate, summary, sleep, GAME } from '/Users/johnstephens/Developer/stephensgames/fallenmoon/test/probes/p6e.mjs';
import fs from 'node:fs';
import path from 'node:path';

const SCRATCH = '/private/tmp/claude-501/-Users-johnstephens-Developer-stephensgames-gameconsole/1397bfbf-aa89-4d7c-b6db-cb653512ee4c/scratchpad/shots';
fs.mkdirSync(SCRATCH, { recursive: true });

const FAMILY_Q4 = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'family-q4-save.json'), 'utf8'));
const N2_OPEN = { ...FAMILY_Q4, basinOpen: true, lastShade: [1921, 1176] };
const N2_SEALED = { ...FAMILY_Q4, lastShade: [1868, 1122] };
const N2_GLYPH = { ...FAMILY_Q4, basinOpen: true, lastShade: [1958, 1216] };

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port);
const api = mkApi(c);
// screenshots to the scratchpad, not the repo
api.shot = async (name) => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  fs.writeFileSync(path.join(SCRATCH, name + '.png'), Buffer.from(r.data, 'base64'));
  console.log('   shot → ' + path.join(SCRATCH, name + '.png'));
};
api.walkTo = async (x, z, tol = 0.9, timeout = 30000) => {
  await api.eval(`__fmBot.done=false; __fmBot.tol=${tol}; __fmBot.target=[${x},${z}]`);
  await api.waitFor(
    `__fmBot.done || Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < ${tol + 0.15} || __fm.state!=='play'`,
    timeout, `walk to ${x},${z}`).catch(() => {});
  await api.eval('__fmBot.target=null');
  return api.eval(`Math.hypot(__fm.x-(${x}), __fm.z-(${z}))`);
};
const P = async () => JSON.parse(await api.eval('JSON.stringify({x:__fm.x, z:__fm.z, st:__fm.state})'));
const errsAt = () => api.errs.length;

await api.init();
await api.seedSave(N2_OPEN);

/* ═══ leg 1 — the OPEN rockfall (census #9) ═══ */
await api.nav(base + '/?turbo=3');
await continueIn(api);
await api.installBot('pad');
// traversal legs test collision, not the swelter: keep hearts topped up so a
// long sunlit walk can't respawn the player mid-assert
await api.eval('window.__telemetryHooks.push(function(){ if (typeof P === "object" && P.maxHearts) P.hearts = P.maxHearts; }); 0');
let e0 = errsAt();

const stones = JSON.parse(await api.eval('JSON.stringify(window.__rockfallStones)'));
const arc = JSON.parse(await api.eval('JSON.stringify(window.__rockfallArc)'));
gate(stones && stones.parted.length === 15 && stones.sealed.length === 18,
  'rockfall: stone march recorded (sealed 11+7 rubble; parted 11+4, mouth rubble cleared)',
  `parted=${stones.parted.length} sealed=${stones.sealed.length} arc=${arc.half.toFixed(2)}`);

// walk the opened gap: outside → basin center (real input, corridor side)
await api.eval('__fmDebug.warp(1917, 1172); __fmDebug.face(Math.atan2(21, 20)); 0');
await api.waitTicks(5);
let d = await api.walkTo(1938, 1192, 1.6, 40000);
gate(d < 1.8, 'rockfall OPEN: walked the gap outside → basin center', 'final d=' + d.toFixed(2));
await api.shot('rockfall-open-inside');

// and back out, through the mouth arc OFF the corridor (the old disc rim)
const rim = JSON.parse(await api.eval(`(function(){
  const out = [];
  for (let da = -0.34; da <= 0.34; da += 0.04) {
    const a = window.__rockfallArc.a + da;
    const x = BASIN.x + Math.cos(a) * 16.3, z = BASIN.z + Math.sin(a) * 16.3;
    out.push([+x.toFixed(2), +z.toFixed(2), window.__forestSolid(x, z) ? 1 : 0, +da.toFixed(2)]);
  }
  return JSON.stringify(out);
})()`));
const openRim = rim.filter(r => !r[2]);
gate(openRim.length >= 5, 'rockfall OPEN: the cleared mouth arc is walkable at the old disc rim',
  openRim.length + '/' + rim.length + ' rim samples open');
if (openRim.length) {
  const target = openRim[Math.floor(openRim.length / 2)];
  d = await api.walkTo(target[0], target[1], 0.9, 25000);
  gate(d < 1.1, 'rockfall OPEN: walked basin → old rim line (rubble visually cleared here)', 'd=' + d.toFixed(2));
  // keep going straight out beyond the ring
  const a = arc.a + target[3];
  d = await api.walkTo(1938 + Math.cos(a) * 26, 1192 + Math.sin(a) * 26, 2.0, 25000);
  gate(d < 2.3, 'rockfall OPEN: continued through the mouth to open forest', 'd=' + d.toFixed(2));
}

// push INTO a parted boulder (i=0, shoved outward) — must stop at its face
const s0 = stones.parted[5];
await api.eval('__fmDebug.warp(1921, 1176); 0');
await api.waitTicks(5);
d = await api.walkTo(s0.x, s0.z, 0.4, 9000);
const inEll = await api.eval(`(function(){
  const s = window.__rockfallStones.parted[5];
  const dx = __fm.x - s.x, dz = __fm.z - s.z;
  const u = dx*s.c - dz*s.sn, v = dx*s.sn + dz*s.c;
  return (u*u)/(s.a*s.a) + (v*v)/(s.b*s.b);
})()`);
gate(inEll > 0.9, 'rockfall OPEN: pushing into a parted boulder stops at its face (not inside it)',
  `ellipse k=${inEll.toFixed(2)} d=${d.toFixed(2)} (a=${s0.a.toFixed(2)})`);
await api.shot('rockfall-open-at-boulder');
gate(errsAt() === e0, 'rockfall OPEN leg: zero console errors', api.errs.slice(e0).join(' | ').slice(0, 200));

/* ═══ leg 2 — the SEALED rockfall still seals, stones included ═══ */
await api.seedSave(N2_SEALED);
await api.nav(base + '/?turbo=3');
await continueIn(api);
await api.installBot('pad');
await api.eval('window.__telemetryHooks.push(function(){ if (typeof P === "object" && P.maxHearts) P.hearts = P.maxHearts; }); 0');
e0 = errsAt();
gate(!(await api.eval('window.__basinOpenNow')), 'rockfall SEALED: basin closed in this leg');
// approach from the SE (outside the HUM trigger ring), push at the ring
await api.eval('__fmDebug.warp(1948, 1164); 0');
await api.waitTicks(5);
d = await api.walkTo(1938, 1192, 0.6, 12000);
const dBasin = await api.eval('Math.hypot(__fm.x - BASIN.x, __fm.z - BASIN.z)');
const stSealed = await api.eval('__fm.state');
gate(dBasin > 14.5 && stSealed === 'play',
  'rockfall SEALED: basin center unreachable, no cine tripped', `d=${dBasin.toFixed(1)} state=${stSealed}`);
// push into a sealed boulder's outward bulge (i=+4 stone, beyond the disc)
const s9 = stones.sealed[9];
await api.eval(`__fmDebug.warp(${(s9.x + 7).toFixed(1)}, ${(s9.z - 7).toFixed(1)}); 0`);
await api.waitTicks(5);
await api.walkTo(s9.x, s9.z, 0.4, 8000);
const inEll2 = await api.eval(`(function(){
  const s = window.__rockfallStones.sealed[9];
  const dx = __fm.x - s.x, dz = __fm.z - s.z;
  const u = dx*s.c - dz*s.sn, v = dx*s.sn + dz*s.c;
  return (u*u)/(s.a*s.a) + (v*v)/(s.b*s.b);
})()`);
gate(inEll2 > 0.9, 'rockfall SEALED: a boulder bulging past the old disc now stops you at its face',
  'ellipse k=' + inEll2.toFixed(2));
await api.shot('rockfall-sealed-face');
gate(errsAt() === e0, 'rockfall SEALED leg: zero console errors', api.errs.slice(e0).join(' | ').slice(0, 200));

/* ═══ leg 3 — mill / ferry / hamlet / seam walls + cedar jamb (census #8, #6) ═══ */
// same page state (sealed q4 forest save is fine for all of these)
const mill = { x: 650, z: 392 };
await api.eval('__fmDebug.warp(643, 385); 0');   // outside the SW corner
await api.waitTicks(5);
await api.walkTo(mill.x, mill.z, 0.4, 8000);     // aim through the corner at the room center
let pos = await P();
const inShell = Math.abs(pos.x - mill.x) < 2.6 && Math.abs(pos.z - mill.z) < 2.0;
gate(!inShell, 'mill: SW corner no longer lets you through the walls',
  `stopped at ${pos.x.toFixed(1)},${pos.z.toFixed(1)}`);
// the door still admits you (front wall gap, east side)
await api.eval('__fmDebug.warp(651.7, 398.5); 0');
await api.waitTicks(5);
d = await api.walkTo(648.4, 390.2, 1.1, 12000);   // the mill chest, inside
gate(d < 1.3, 'mill: door gap still admits you — walked to the chest inside', 'd=' + d.toFixed(2));
await api.shot('mill-inside');

const ferry = { x: 1338, z: 568 };
await api.eval('__fmDebug.warp(1345, 573.5); 0'); // off the bow corner
await api.waitTicks(5);
await api.walkTo(ferry.x, ferry.z, 0.4, 8000);    // aim at the hull center
const hullK = await api.eval(`(function(){
  const c = Math.cos(0.55), s = Math.sin(0.55);
  const dx = __fm.x - 1338, dz = __fm.z - 568;
  const u = dx*c - dz*s, v = dx*s + dz*c;
  return JSON.stringify({u:+u.toFixed(2), v:+v.toFixed(2)});
})()`);
const hk = JSON.parse(hullK);
gate(!(Math.abs(hk.u) < 4.3 && Math.abs(hk.v) < 2.0),
  'ferry: the hull corner stops you at the planks', `local u=${hk.u} v=${hk.v}`);
await api.shot('ferry-corner');

// hamlet lean-to back wall, at its END (past the old r=1.0 circle)
await api.eval('__fmDebug.warp(1572, 841.5); 0');
await api.waitTicks(5);
await api.walkTo(1572, 847, 0.4, 6000);           // straight through the back wall end
pos = await P();
const lt = await api.eval(`(function(){
  const ry = 0.4, x0 = 1580 - 8 + Math.sin(ry)*1.2, z0 = 848 - 4 + Math.cos(ry)*1.2;
  const dxx = __fm.x - x0, dzz = __fm.z - z0;
  const u = dxx*Math.cos(ry) - dzz*Math.sin(ry), v = dxx*Math.sin(ry) + dzz*Math.cos(ry);
  return JSON.stringify({u:+u.toFixed(2), v:+v.toFixed(2)});
})()`);
const lk = JSON.parse(lt);
gate(!(Math.abs(lk.u) < 1.65 && Math.abs(lk.v) < 0.25),
  'hamlet: lean-to back wall blocks along its whole width', `local u=${lk.u} v=${lk.v}`);

// salt seam: the scallop waist between the old circles
await api.eval('__fmDebug.warp(1178, 644); 0');
await api.waitTicks(5);
await api.walkTo(1178, 652, 0.4, 6000);           // through the wall at x = s.x-2 (old gap)
pos = await P();
gate(pos.z > 645.0 && pos.z < 647.45 && Math.abs(pos.x - 1180) < 6.6,
  'salt seam: pressed against the wall face at the old circle-gap — no walk-through',
  `stopped at ${pos.x.toFixed(1)},${pos.z.toFixed(1)}`);

/* cedar (census #6): rendered gap == collision gap, and the door still works */
const gapChk = JSON.parse(await api.eval(`(function(){
  const w = (a) => { let da = ((a - CEDAR.doorA) % TAU + TAU) % TAU; if (da > Math.PI) da -= TAU; return da; };
  const solidAt = (a, r) => window.__forestSolid(CEDAR.x + Math.cos(a) * r, CEDAR.z + Math.sin(a) * r);
  return JSON.stringify({
    lo: +CEDAR.gapLo.toFixed(3), hi: +CEDAR.gapHi.toFixed(3),
    sliver: solidAt(-1.61, 3.5),        // rendered-open, was collision-solid
    jamb: solidAt(-2.75, 3.5),          // rendered-wall, was collision-open
    doorMid: solidAt(-2.094, 3.5),      // the door itself
  });
})()`));
gate(gapChk.sliver === false && gapChk.jamb === true && gapChk.doorMid === false,
  'cedar: collision gap re-derived from the lathe segments (sliver open, jamb solid)',
  JSON.stringify(gapChk));
await api.eval('__fmDebug.warp(1296.0, 203.1); 0');   // straight out the door mouth
await api.waitTicks(5);
d = await api.walkTo(1300, 210, 0.7, 12000);
gate(d < 0.9, 'cedar: walked in through the door', 'd=' + d.toFixed(2));
d = await api.walkTo(1296.0, 203.1, 1.0, 12000);
gate(d < 1.2, 'cedar: and back out', 'd=' + d.toFixed(2));
await api.shot('cedar-door');
gate(errsAt() === e0, 'walls leg: zero console errors', api.errs.slice(e0).join(' | ').slice(0, 200));

/* ═══ leg 4 — the glyph door follows its sink (census #11) ═══ */
await api.seedSave(N2_GLYPH);
await api.nav(base + '/?turbo=2');
await continueIn(api);
await api.installBot('pad');
e0 = errsAt();
gate(!(await api.eval('__fm.glyph1')), 'glyph leg: door one starts sealed');
// recorder: one sample per rendered frame, straight off the live objects
await api.eval(`window.__doorLog = [];
window.__telemetryHooks.push(function () {
  const D = glyphDoor1;
  if (D.sinkT < 0 && (!SAVE || !SAVE.glyph1)) return;
  if (window.__doorLog.length > 2000) return;
  window.__doorLog.push([
    +D.sinkT.toFixed(3),
    (SAVE && SAVE.glyph1) ? 1 : 0,
    +(D.group.position.y + 5.4 - (D.baseY + 0.2)).toFixed(2),
    window.__forestSolid(1992, 1253) ? 1 : 0,
    +Math.hypot(P.x - 1992, P.z - 1253).toFixed(2),
  ]);
}); 0`);
// the real mechanic: stand at the shell, HOLD attack until the beam is true
let lit = false;
for (let tries = 0; tries < 5 && !lit; tries++) {
  await api.eval('P.hearts = P.maxHearts; 0');
  await api.walkTo(1969.6, 1232.2, 0.8, 30000);
  if ((await api.eval('__fm.prompt')) !== 'hmirror1') continue;
  await api.eval('__fakePad.press(0)');                     // hold ✕ — turn the shell
  await api.waitFor('Math.abs(__fm.hm1Delta) < 0.35', 30000, 'shell near the mark').catch(() => {});
  await api.eval('__fakePad.press()');
  lit = true;
}
gate(lit, 'glyph: shell turned with real held input');
// the burn takes ~1s; move to the door mouth NOW and push at it while it sinks
await api.eval('__fmDebug.warp(1988.6, 1250.1); 0');        // 4m before the door, in the corridor
await api.eval('__fmBot.done=false; __fmBot.tol=0.8; __fmBot.target=[1996.5, 1256.8]');
await api.waitFor('__fm.glyph1 === true', 25000, 'glyph one re-lights');
await api.waitFor('Math.hypot(__fm.x-1996.5, __fm.z-1256.8) < 1.0', 15000, 'through the door').catch(() => {});
await api.eval('__fmBot.target=null');
const log = JSON.parse(await api.eval('JSON.stringify(window.__doorLog)'));
const sink = log.filter(r => r[0] >= 0);
const badSolid = sink.filter(r => (r[3] === 1) !== (r[2] > 0.55));
const crossedEarly = log.some(r => r[1] === 0 && r[4] < 2.0);
const blockedHigh = sink.filter(r => r[2] > 0.9).every(r => r[4] > 2.1);
gate(sink.length > 20, 'glyph: sink observed frame by frame', sink.length + ' samples');
gate(badSolid.length === 0, 'glyph: plug === (rendered top above knee) on EVERY sink frame',
  badSolid.length + ' mismatches of ' + sink.length);
gate(crossedEarly, 'glyph: player passed the door line BEFORE the save flag landed (Rule 6)',
  'min d pre-flag=' + Math.min(...log.filter(r => r[1] === 0).map(r => r[4])).toFixed(2));
gate(blockedHigh, 'glyph: while the slab stood above knee height it still blocked the push');
d = await api.eval('Math.hypot(__fm.x-1996.5, __fm.z-1256.8)');
gate(d < 1.2, 'glyph: walked through into the vault side', 'd=' + d.toFixed(2));
await api.shot('glyph-door-passed');
gate(errsAt() === e0, 'glyph leg: zero console errors', api.errs.slice(e0).join(' | ').slice(0, 200));

/* ═══ leg 5 — the foundry doorway residue (census #25) ═══ */
await api.seedSave(ISLES);
await api.nav(base + '/?turbo=3');
await continueIn(api);
await api.installBot('pad');
e0 = errsAt();
let park = JSON.parse(await api.eval('JSON.stringify(window.__sootSlabParked || null)'));
gate(park && park.found === 36 && park.parked === true,
  'foundry: soot slab located (36 verts) and parked while the gate stands open', JSON.stringify(park));
await api.eval('__fmDebug.warp(-1520, -342); __fmDebug.face(Math.PI); 0');
await api.waitTicks(30);
await api.shot('foundry-open-daylight');
d = await api.walkTo(-1520, -358, 1.2, 20000);
gate(d < 1.4, 'foundry: walked in through the open doorway', 'd=' + d.toFixed(2));
await api.eval('__fmDebug.warp(-1520, -342); __fmDebug.face(Math.PI); 0');
// reseal (the NEW GAME direction) — slab must come back
await api.eval('SAVE.watchBell = false; storeSave(); applyWorldState(); 0');
await api.waitTicks(20);
park = JSON.parse(await api.eval('JSON.stringify(window.__sootSlabParked)'));
gate(park.parked === false, 'foundry: resealing restores the slab (NEW GAME direction)', JSON.stringify(park));
await api.shot('foundry-resealed');
await api.eval('__fmDebug.openFoundry(); 0');
await api.waitTicks(20);
park = JSON.parse(await api.eval('JSON.stringify(window.__sootSlabParked)'));
gate(park.parked === true, 'foundry: reopening parks it again', JSON.stringify(park));
await api.shot('foundry-reopened');
gate(errsAt() === e0, 'foundry leg: zero console errors', api.errs.slice(e0).join(' | ').slice(0, 200));

c.close(); proc.kill(); srv.close();
process.exit(summary());
