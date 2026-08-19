#!/usr/bin/env node
/* THE WIND ORGAN — the rev's heart, tested the only way that proves it:
   by HOLDING ✕ on a real pad and watching the audible pitch distance
   shrink, then demanding that the door only ever opens because of that.
   A gate that asserts "SAVE.organ1 is true" proves nothing at all. */
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_STAIR, gate, summary, sleep } from './p6g.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(P4_STAIR);
await api.seedSeen(['dawnCall']);          // the skippable path, so the suite can move on
await api.nav(base + '/?turbo=4');
await continueIn(api);
await api.installBot('pad');

const jget = async (e) => JSON.parse(await api.eval(`JSON.stringify(${e})`));
const info = () => jget('__fmDebug.organInfo()');

/* ── the doors are SHUT, and shut means solid ── */
await api.eval('__fmDebug.warpStair(1); P.hearts = P.maxHearts; 0');
await api.waitTicks(20);
{
  const st = await jget(`(function(){ const d = S_DOORS[0];
    return { solid: worldSolidAt(d.x, d.z), open: organOpen[0], inStair: stairMode,
      area: areaAt(P.x,P.z), y: +P.fy.toFixed(2) }; })()`);
  console.log('at L1:', JSON.stringify(st));
  gate(st.inStair && st.area === 'stair', 'L1: the stair is its own world, fifty metres over the Hollow');
  gate(st.solid && !st.open, 'L1: the landing door is SHUT — and shut is solid stone');
}
gate((await jget('__fm.organ1')) === false, 'the organ starts untuned');

/* ── walk to the vent on real stick input, and read the prompt ── */
/* walk to a vent on real stick input, and wait on the distance to the VENT
   itself — a tolerance measured against the waypoint can be satisfied by
   standing still where you already were */
async function walkToVent(vx, vz, label) {
  await api.installBot('pad');
  const tx = (vx * 0.82 + 2160 * 0), tz = vz;
  await api.eval(`__fmBot.tol = 0.7; __fmBot.target = [${vx}, ${vz}]; 0`);
  await api.waitFor(`Math.hypot(__fm.x-(${vx}), __fm.z-(${vz})) < 2.3`, 45000, label).catch(() => {});
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  await api.waitTicks(10);
  const d = await api.eval(`+Math.hypot(__fm.x-(${vx}), __fm.z-(${vz})).toFixed(2)`);
  if (d > 2.4) console.log('   (could not reach ' + label + ', d=' + d + ')');
}
/* the flights are dog-legs: one long leg stalls on the turn (the p6e lesson) */
async function climb(pts, label) {
  await api.installBot('pad');
  for (const [x, z] of pts) {
    await api.eval(`__fmBot.tol = 1.6; __fmBot.target = [${x}, ${z}]; 0`);
    await api.waitFor(`Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < 3.0`, 40000, label + ' ' + x).catch(() => {});
    await api.eval('P.hearts = P.maxHearts; 0');
  }
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  await api.waitTicks(12);
}
const V = (await info()).landings;
await walkToVent(2005.4, 1271.2, 'the first vent');
gate((await api.eval('__fm.prompt')) === 'organVent', 'the vent offers the verb: HOLD ✕ — TURN THE VENT',
  'prompt=' + await api.eval('__fm.prompt'));

/* ── THE MECHANIC: hold ✕, and the note walks toward true ── */
async function tune(idx, label, maxHold = 26) {
  const da0 = (await jget('__fm.ventDa'))[idx];
  const cents0 = (await jget('__fm.ventCents'))[idx];
  const trace = [];
  let locked = false;
  for (let i = 0; i < maxHold && !locked; i++) {
    await api.eval('__fakePad.press(0)');
    await sleep(420);
    await api.eval('__fakePad.press()');
    await sleep(60);
    const da = (await jget('__fm.ventDa'))[idx];
    const lk = (await jget('__fm.ventLocked'))[idx];
    trace.push(+da.toFixed(3));
    locked = lk;
  }
  console.log(`   ${label}: |da| ${da0.toFixed(2)} → ${trace.join(' ')}  (${cents0.toFixed(0)} cents off at the start)`);
  /* the very first hold must already have closed the gap — the claim is
     that HOLDING ✕ moves the note toward true, not that a door opened */
  const shrank = trace.length > 0 && trace[0] < da0 - 0.15;
  return { da0, trace, locked, shrank, cents0 };
}
{
  const r = await tune(0, 'vent 1');
  gate(r.shrank, 'HOLDING ✕ bends the note TOWARD the hum — the pitch distance shrinks', JSON.stringify(r.trace.slice(0, 4)));
  gate(r.locked, 'held long enough, the note comes TRUE and latches', 'trace=' + r.trace.length);
  gate(Math.abs(r.cents0) > 200, 'and it started a long way off — this was really tuned', r.cents0.toFixed(0) + ' cents');
}
await api.waitTicks(30);
{
  /* RULE 6 (evolved 8/18): the plug follows the RENDERED slab, so the
     stone is gone when the slab has visibly ground down — wait for the
     grind (a real-time animation, ~1.2 s), then ask the collider */
  const mid = await jget(`(function(){ const d = S_DOORS[0];
    return { solid: worldSolidAt(d.x, d.z), open: organOpen[0], save: !!SAVE.organ1 }; })()`);
  gate(mid.save && mid.open, 'THE LANDING SINGS: the door is answered the moment the chord is true');
  await api.waitFor('S_DOORS[0].group.position.y < S_DOORS[0].baseY - 4.4', 20000, 'the slab grinds down');
  const st = await jget(`(function(){ const d = S_DOORS[0];
    return { solid: worldSolidAt(d.x, d.z), y: +d.group.position.y.toFixed(2) }; })()`);
  console.log('after the grind:', JSON.stringify(st));
  gate(!st.solid, 'and once the slab has visibly sunk, the stone is really gone (Rule 6)');
}
/* the vent is done and stays done */
gate((await jget('__fm.ventLocked'))[0] === true, 'a true note stays true — it does not have to be held');

/* ── the organ has a VOICE: a chord from above, and a whistle per vent ── */
{
  const aud = await jget(`(function(){
    if (!ORG_AUD.built) return { built: false };
    return { built: true, master: +ORG_AUD.master.gain.value.toFixed(4),
      drone: +ORG_AUD.droneG.gain.value.toFixed(4),
      voices: ORG_AUD.voices.map(v => +v.o.frequency.value.toFixed(1)),
      chord: ORG_CHORD };
  })()`);
  console.log('the organ audio:', JSON.stringify(aud));
  gate(aud.built === true, 'the wind organ has a live voice while you are inside the mountain');
  gate(aud.built && aud.master > 0.05, 'and it is audible', 'master=' + aud.master);
  gate(aud.built && Math.abs(aud.voices[0] - 330) < 1,
    'a locked vent sits exactly on its note', 'vent1 = ' + (aud.built ? aud.voices[0] : '?') + ' Hz');
}

/* ── L2: two notes, and the door waits for both ── */
await climb([[2007, 1274], [2013, 1281], [2019, 1288], [2024, 1294]], 'to L2');
gate(Math.abs(await api.eval('P.fy') - 58) < 3, 'the flight climbed eighteen metres of real stair',
  'y=' + (await api.eval('P.fy')).toFixed(1));
await walkToVent(2020.6, 1297.6, 'L2 vent A');
const r2a = await tune(1, 'vent 2');
gate(r2a.locked && r2a.shrank, 'L2: the first of two comes true');
gate((await jget('__fm.organ2')) === false, 'L2: ONE note is not a chord — the door stays shut');
await walkToVent(2027.8, 1296.6, 'L2 vent B');
const r2b = await tune(2, 'vent 3');
gate(r2b.locked, 'L2: the second note comes true');
await api.waitTicks(30);
gate((await jget('__fm.organ2')) === true && (await jget('__fm.organDoors'))[1] === true,
  'L2: the two-note chord opens the door');

/* ── L3: three notes, and the WIND ── */
await climb([[2029, 1300], [2035, 1307], [2041, 1314], [2046, 1320]], 'to L3');
gate((await jget('__fm.organLanding')) === 2, 'L3: standing on the third landing');
/* the gusts are real, and the calm is GENEROUS (the 15-second-tone law) */
const gustLog = [];
for (let i = 0; i < 60; i++) {
  gustLog.push(await jget('({g:__fm.organGust, t:__fm.tick, w:__fm.ventDa[3]})'));
  await sleep(300);
}
const gustOn = gustLog.filter(g => g.g).length;
const firstGust = gustLog.findIndex(g => g.g);
gate(gustOn > 0, 'L3: THE WIND GUSTS — the pitches wander and no note can be caught',
  gustOn + '/' + gustLog.length + ' samples');
gate(firstGust < 0 || (gustLog[firstGust].t - gustLog[0].t) / 60 > 8,
  'L3: and it holds off while you arrive (the grace window)',
  firstGust < 0 ? 'no gust' : ((gustLog[firstGust].t - gustLog[0].t) / 60).toFixed(1) + 's in');
{
  /* the calm has to be long enough for a seven-year-old to fumble a
     shutter round — measured in SIM seconds, which is what the child
     experiences whatever the harness's turbo is doing */
  let best = 0, run = 0, t0 = 0;
  for (const g of gustLog) {
    if (!g.g) { if (run === 0) t0 = g.t; run++; best = Math.max(best, (g.t - t0) / 60); }
    else run = 0;
  }
  gate(best > 12, 'L3: THE CALM WINDOWS ARE GENEROUS (the 15-second-tone law)', best.toFixed(1) + 's of calm');
  /* and the wobble during a gust really does put the note out of reach */
  const w = gustLog.filter(g => g.g).map(g => g.w);
  gate(w.length === 0 || Math.max(...w) > 0.3,
    'L3: a gust really moves the note (past the window, not a near miss)', 'max |da| ' + Math.max(...w).toFixed(2));
}
for (const [i, x, z] of [[3, 2041.6, 1324.8], [4, 2047.6, 1326.4], [5, 2051.6, 1321.0]]) {
  await walkToVent(x, z, 'L3 vent ' + i);
  const r = await tune(i, 'vent ' + (i + 1), 40);
  gate(r.locked, 'L3: vent ' + (i - 2) + ' of three comes true', JSON.stringify(r.trace.slice(-3)));
}
await api.waitTicks(20);
gate((await jget('__fm.organ3')) === true, 'L3: the third landing SINGS');
/* the whole stair plays, and the top door opens */
for (let i = 0; i < 80; i++) {
  if ((await api.eval('__fm.state')) !== 'cine') break;
  await api.tap(0);
  await sleep(300);
}
await api.waitTicks(30);
gate((await jget('__fm.organDoors'))[2] === true, 'THE DAWN CALL: the top door is open');
gate((await api.eval(`worldSolidAt(S_DOORS[2].x, S_DOORS[2].z)`)) === false, 'and the stone is really gone');

/* ── out of the mountain, on foot ── */
await climb([[2039, 1324], [2028, 1330], [2010, 1339], [1996, 1345], [1988, 1348],
             [1997, 1360], [2005, 1372], [2012, 1382],
             [2028, 1377], [2045, 1370], [2062, 1364], [2076, 1362], [2072, 1352], [2066, 1342]], 'out');
const end = await jget(`({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), y:+P.fy.toFixed(1), area:__fm.crownArea, crown:__fm.inCrown, quest:__fm.quest})`);
console.log('out on the Crown:', JSON.stringify(end));
gate(end.crown === true, 'THE STAIR IS WALKABLE END TO END: out of the crack and onto the Crown', JSON.stringify(end));
gate(end.quest >= 15, 'and the Crown sets the thread on', 'q=' + end.quest);
await api.shot('organ-out');
gate(api.errs.length === 0, 'zero console errors through the whole climb', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
