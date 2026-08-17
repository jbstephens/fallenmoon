#!/usr/bin/env node
// THE PAYOFF — carry the Gibbous Bell to the Moonwheel, and THE SUN MOVES.
// Plus the safety rail (shade never shrinks) and both TO BE CONTINUED cards.
import { serve, launchChrome, pageSession, mkApi, continueIn, ISLES, gate, summary, sleep } from './p6e.mjs';

const CARRY = {
  ...ISLES, q: 11, fGlyph1: true, fGlyph2: true, fGlyph3: true,
  tortoiseDone: true, lastShade: [4, -2], region: 'bay',
};
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(CARRY);
await api.nav(base + '/?turbo=10');
await continueIn(api);
gate(await api.eval('__fm.carryBell === true'), 'a q11 save wakes carrying the Gibbous Bell');
gate(await api.eval('__fm.skyStep3 === 0 && __fm.sunArc === false'), 'the sun is still pinned at noon');

/* ── the SAFETY RAIL, measured before anything moves ── */
const shadeBefore = await api.eval(`(function(){
  const pts = [];
  for (const sh of SHADE) pts.push([sh.x, sh.z, 'shade:' + sh.tag]);
  if (typeof FSPRINGS !== 'undefined') for (const sp of FSPRINGS) pts.push([sp.x, sp.z, 'spring']);
  if (typeof ISLE_SHADE !== 'undefined') for (const sh of ISLE_SHADE) pts.push([sh.x, sh.z, 'isle']);
  pts.push([GROTTO_A.x, GROTTO_A.z, 'grottoA'], [GROTTO_B.x, GROTTO_B.z, 'grottoB']);
  pts.push([F2.x, F2.z, 'foundry'], [F3.x, F3.z, 'pit']);
  if (typeof H2 !== 'undefined') pts.push([H2.x, H2.z, 'hollow']);
  return JSON.stringify(pts.map(p => [p[2], inShadeAt(p[0], p[1])]));
})()`);
const sb = JSON.parse(shadeBefore);
gate(sb.every(p => p[1]), 'every sanctuary is shade at noon', sb.filter(p => !p[1]).map(p => p[0]).join(','));

/* ── slot it ── */
await api.installBot('pad');
await api.eval(`__fmDebug.warp(WHEEL_POS.x + 7, WHEEL_POS.z + 7); P.hearts = P.maxHearts; 0`);
await api.waitTicks(20);
await api.eval(`__fmBot.tol = 1.2; __fmBot.target = [WHEEL_POS.x + 3, WHEEL_POS.z + 3]; 0`);
await api.waitFor(`__fm.prompt === 'wheel3'`, 60000, 'the wheel prompt');
await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
gate(true, 'the Moonwheel offers ✕ PLACE THE GIBBOUS BELL');
await api.shot('pay-0-carry');
await api.tap(0);
await api.waitFor(`__fm.cinId === 'bellWheel'`, 20000, 'the payoff begins');
gate(true, 'the payoff cinematic starts');

/* ── watch it: the notch, the star, and then THE SUN ── */
const track = [];
let shot16 = false, shot55 = false, shot110 = false;
for (let i = 0; i < 200; i++) {
  const st = JSON.parse(await api.eval(`JSON.stringify({t:+(__fm.cinT||0).toFixed(2), id:__fm.cinId, state:__fm.state,
    sky:+__fm.skyStep3.toFixed(2), star3:__fm.star3On, sunK:+__fm.sunK.toFixed(3),
    sunY:+(__fm.sunY||0).toFixed(1), dir:[+__fm.shadowDir[0].toFixed(2), +__fm.shadowDir[1].toFixed(2)],
    ph:__fm.phases, q:__fm.quest, calls:__fm.calls, tris:__fm.tris})`));
  track.push(st);
  if (!shot16 && st.t > 1.4 && st.id === 'bellWheel') { shot16 = true; await api.shot('pay-1-seat'); }
  if (!shot55 && st.t > 5.2 && st.id === 'bellWheel') { shot55 = true; await api.shot('pay-2-star'); }
  if (!shot110 && st.t > 10.4 && st.id === 'bellWheel') { shot110 = true; await api.shot('pay-3-sun'); }
  if (st.state === 'tbc') break;
  await sleep(220);
}
const last = track[track.length - 1];
const maxT = Math.max(...track.filter(t => t.id === 'bellWheel').map(t => t.t));
console.log('payoff:', JSON.stringify(last), 'longest cinT', maxT.toFixed(2));
gate(maxT <= 12.6, 'the payoff cinematic is under twelve seconds', maxT.toFixed(2) + 's');
gate(track.some(t => t.sky > 0.9), 'the sky takes its third eighth');
gate(track.some(t => t.star3), 'the THIRD star arrives');
const sunMoved = track.filter(t => t.sunK > 0.2);
gate(sunMoved.length > 0, 'THE SUN MOVES', 'peak sunK ' + Math.max(...track.map(t => t.sunK)).toFixed(2));
const sunYs = track.map(t => t.sunY).filter(y => y > 0);
gate(Math.max(...sunYs) - Math.min(...sunYs) > 60, 'the sun visibly DESCENDS the sky',
  Math.max(...sunYs).toFixed(0) + ' → ' + Math.min(...sunYs).toFixed(0));
const dirs = track.map(t => t.dir);
const swing = Math.abs(Math.atan2(dirs[0][1], dirs[0][0]) - Math.atan2(dirs[dirs.length - 1][1], dirs[dirs.length - 1][0]));
gate(swing > 0.6, 'EVERY SHADOW swings with it', 'shadow direction swung ' + (swing * 57.3).toFixed(0) + '°');
gate(Math.max(...track.map(t => t.calls)) <= 80, 'the payoff holds the draw-call budget',
  'peak ' + Math.max(...track.map(t => t.calls)));
gate(Math.max(...track.map(t => t.tris)) <= 120000, 'and the triangle budget',
  'peak ' + Math.max(...track.map(t => t.tris)));

/* ── PHASE THREE'S CARD ── */
gate(await api.eval(`__fm.state === 'tbc'`), 'the phase ends on its own TO BE CONTINUED card');
const sub = await api.eval(`document.getElementById('tbcSub').textContent`);
console.log('card 3 subtitle:', sub);
gate(/WAXING SLIVER/.test(sub), 'and it teases the WAXING SLIVER', sub);
gate(await api.eval('__fm.tbc3Seen === true'), 'the card is remembered');
await sleep(2200);
await api.shot('pay-4-card3');
await api.tap(0);
await api.waitFor(`__fm.state === 'play'`, 20000, 'back to play');

/* ── the world after: sky 3, the arc live, and the SAFETY RAIL holding ── */
const after = JSON.parse(await api.eval(`JSON.stringify({sky:SAVE.sky, ph:SAVE.ph, arc:SAVE.sunArc, q:__fm.quest})`));
console.log('world after:', JSON.stringify(after));
gate(after.sky === 3 && after.ph === 3 && after.arc === true, 'sky 3, three phases restored, the arc is live');
gate(after.q === 12, 'the quest reads 3/8 PHASES RESTORED');

/* drive the sun right round its arc and check EVERY sanctuary at every angle */
const rail = await api.eval(`(function(){
  const pts = [];
  for (const sh of SHADE) pts.push([sh.x, sh.z, 'shade:' + sh.tag]);
  if (typeof FSPRINGS !== 'undefined') for (const sp of FSPRINGS) pts.push([sp.x, sp.z, 'spring']);
  if (typeof ISLE_SHADE !== 'undefined') for (const sh of ISLE_SHADE) pts.push([sh.x, sh.z, 'isle']);
  pts.push([GROTTO_A.x, GROTTO_A.z, 'grottoA'], [GROTTO_B.x, GROTTO_B.z, 'grottoB']);
  pts.push([F2.x, F2.z, 'foundry'], [F3.x, F3.z, 'pit']);
  if (typeof H2 !== 'undefined') pts.push([H2.x, H2.z, 'hollow']);
  if (typeof ROOMS !== 'undefined') for (const R of ROOMS) pts.push([R.x, R.z, 'room:' + R.id]);
  const bad = [];
  let area0 = 0, area1 = 0;
  for (let k = 0; k <= 20; k++) {
    __fmDebug.sunSet(k / 20);
    for (const p of pts) if (!inShadeAt(p[0], p[1])) bad.push(p[2] + '@k=' + (k / 20).toFixed(2));
    /* and shade must never SHRINK: sample the bay on a grid */
    let n = 0;
    for (let x = -90; x < 90; x += 3) for (let z = -60; z < 30; z += 3) if (inShadeAt(x, z)) n++;
    if (k === 0) area0 = n;
    area1 = Math.max(area1, n);
    if (n < area0) bad.push('SHRANK@k=' + (k / 20).toFixed(2) + ' ' + n + '<' + area0);
  }
  __fmDebug.sunSet(0);
  return JSON.stringify({bad: bad.slice(0, 8), area0, areaMax: area1});
})()`);
const r = JSON.parse(rail);
console.log('safety rail:', JSON.stringify(r));
gate(r.bad.length === 0, 'SAFETY RAIL: every sanctuary stays shade at EVERY sun angle', r.bad.join(', '));
gate(r.areaMax >= r.area0, 'SAFETY RAIL: the sun moving only ever ADDS shade',
  r.area0 + ' → ' + r.areaMax + ' cells');

/* gold hour, in pixels */
await api.eval('__fmDebug.sunSet(1); 0');
await api.waitTicks(10);
await api.eval(`__fmDebug.warp(-20, 20); 0`);
await api.waitTicks(20);
await api.shot('pay-5-goldhour');
await api.eval('__fmDebug.sunSet(0); 0');
await api.waitTicks(10);
await api.shot('pay-6-noon');
gate(api.errs.length === 0, 'zero console errors through the payoff', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
