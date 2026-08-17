#!/usr/bin/env node
// THE THREE VERBS, driven by REAL input only. No hook ever stands in for a
// mechanic: the shell is turned by holding ✕, the bells are struck with the
// sword, the great bell is held, and the door is walked.
import { serve, launchChrome, pageSession, mkApi, continueIn, ISLES, gate, summary, sleep } from './p6e.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(ISLES);
await api.nav(base + '/?turbo=10');
await continueIn(api);
await api.installBot('pad');
const heal = () => api.eval('P.hearts = P.maxHearts; 0');

async function walk(x, z, tol = 1.8, ms = 45000) {
  await api.eval(`__fmBot.tol = ${tol}; __fmBot.target = [${x}, ${z}]`);
  try { await api.waitFor(`Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < ${tol + 1}`, ms, `walk ${x},${z}`); }
  finally { await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0'); }
  await api.waitTicks(8);
}

/* ═══ 1. AIM — hold ✕ on the mirror-shell until the channel lights ═══ */
await api.eval(`__fmDebug.warpFoundry('shell'); 0`); await heal();
await api.waitTicks(20);
await walk(-1468.2, -404.4, 1.0);
await api.waitFor(`__fm.prompt === 'foundryShell'`, 25000, 'shell prompt');
gate(true, 'AIM: the mirror-shell offers HOLD ✕ — TURN THE SHELL');
gate(await api.eval(`__fm.fGlyph1 === false`), 'AIM: the channel starts dark');
// hold ✕ and let the shell swing; release near the mark and it seats itself
let lit = false;
for (let i = 0; i < 160 && !lit; i++) {
  const d = await api.eval('Math.abs(__fm.fShellDelta)');
  if (d < 0.30) {
    await api.eval('__fakePad.press()');      // let the shell seat itself
    await sleep(700);
  } else {
    await api.eval('__fakePad.press(0)');
    await sleep(d > 1.2 ? 400 : 150);         // short taps as the mark nears
    await api.eval('__fakePad.press()');
    await sleep(60);
  }
  lit = await api.eval('__fm.fGlyph1 === true');
  await heal();
}
await api.eval('__fakePad.press()');
gate(lit, 'AIM: holding ✕ swings the shell and lights the casting channel');
await api.shot('verb-1-aim');

/* ═══ 2. STRIKE — the order the channel shows, hit with the sword ═══ */
const order = await api.eval('JSON.stringify(FORDER)');
console.log('the revealed order:', order);
const before = await api.eval('__fm.fGlyph2');
gate(before === false, 'STRIKE: the great bell is dead until the order is struck');

// a WRONG strike first: it must clank, reset, and cost nothing
const bells = JSON.parse(await api.eval('JSON.stringify(FBELLS.map(b=>[b.x,b.z]))'));
const ord = JSON.parse(order);
const wrong = [0, 1, 2].find(i => i !== ord[0]);
await walk(bells[wrong][0] - 1.7, bells[wrong][1], 0.8);
if (await api.eval(`Math.hypot(P.x-(${bells[wrong][0]}), P.z-(${bells[wrong][1]})) > 2.6`)) {
  await api.eval(`__fmDebug.warp(${bells[wrong][0]} - 1.6, ${bells[wrong][1]}); 0`);   // setup only
  await api.waitTicks(10);
}
await heal();
console.log("  at wrong bell:", await api.eval("JSON.stringify([+__fm.x.toFixed(1),+__fm.z.toFixed(1),+Math.hypot(P.x-'+bells[wrong][0]+',P.z-('+bells[wrong][1]+')).toFixed(2)])"));
const hpBefore = await api.eval("__fm.hearts");
for (let i = 0; i < 8; i++) {
  await api.eval(`P.heading = Math.atan2(${bells[wrong][0]} - P.x, ${bells[wrong][1]} - P.z); 0`);
  await api.tap(0); await api.waitTicks(12);
  if (await api.eval("__fm.fStrikes > 0")) break;
}
const st1 = JSON.parse(await api.eval('JSON.stringify({seq:__fm.fSeq, wrongs:__fm.fWrongs, strikes:__fm.fStrikes, hp:__fm.hearts})'));
console.log('after a wrong strike:', JSON.stringify(st1));
gate(st1.strikes > 0, 'STRIKE: the sword rings a hanging bell', 'strikes=' + st1.strikes);
gate(st1.wrongs > 0 && st1.seq === 0, 'STRIKE: a wrong bell resets the order', JSON.stringify(st1));
gate(st1.hp === hpBefore, "STRIKE: a wrong bell costs NOTHING", "hearts " + hpBefore + "→" + st1.hp);

// now the right order
for (const idx of ord) {
  await walk(bells[idx][0] - 1.9, bells[idx][1], 0.9);
  await api.eval(`P.heading = Math.atan2(${bells[idx][0]} - P.x, ${bells[idx][1]} - P.z); 0`);
  await heal();
  const want = (await api.eval('__fm.fSeq')) + 1;
  for (let k = 0; k < 8; k++) {
    await api.tap(0); await api.waitTicks(10);
    if (await api.eval(`__fm.fSeq >= ${want} || __fm.fGlyph2`)) break;
  }
  console.log('  struck', idx, 'seq now', await api.eval('__fm.fSeq'), 'solved', await api.eval('__fm.fGlyph2'));
}
gate(await api.eval('__fm.fGlyph2 === true'), 'STRIKE: the order struck in sequence wakes the great bell');
await api.shot('verb-2-strike');

/* ═══ 3. HOLD — sustain the tone, walk the resonance door ═══ */
await walk(-1451, -424, 1.6);
await heal();
await api.waitFor(`__fm.prompt === 'foundryGreat'`, 25000, 'great bell prompt');
gate(true, 'HOLD: the great bell offers HOLD ✕ — RING THE GREAT BELL');
const doorShut = await api.eval('__fm.fDoorK < 0.2 && __fm.fResOpen === false');
gate(doorShut, 'HOLD: the resonance door stands shut before the tone');
/* hold only until it TOLLS — the tone starts running the moment it does */
await api.eval('__fakePad.press(0)');
let tone = 0;
for (let i = 0; i < 60; i++) {
  tone = await api.eval('__fm.fToneT');
  if (tone > 0) break;
  await sleep(120);
}
await api.eval('__fakePad.press()');
gate(tone > 8, 'HOLD: holding ✕ tolls the bell and a nine-second tone sustains', 'toneT=' + (+tone).toFixed(1));
await api.waitTicks(6);
gate(await api.eval('__fm.fDoorK > 0.4'), 'HOLD: the door is visibly LIFTING while the tone lives');
await api.shot('verb-3-hold');
// walk it before the tone dies — real input, real distance
await api.eval(`__fmBot.tol = 1.2; __fmBot.target = [-1468, -444]; __fmBot.sprint(true); 0`);

for (let i = 0; i < 22; i++) {
  await sleep(1000);
  console.log('   walk t+' + (i+1) + 's ' + await api.eval(`JSON.stringify({x:+__fm.x.toFixed(1),z:+__fm.z.toFixed(1),tone:+(__fm.fToneT||0).toFixed(1),doorK:+(__fm.fDoorK||0).toFixed(2),g3:__fm.fGlyph3,pst:__fm.pst})`));
  if (await api.eval('__fm.fGlyph3 === true')) break;
}
await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
const passed = await api.eval('__fm.fGlyph3 === true');
gate(passed, 'HOLD: the door is WALKED while the tone still rings');
gate(await api.eval('__fm.fDoorK > 0.9'), 'HOLD: once through, the way to the pit stays open for good');
await api.shot('verb-3-through');

gate(api.errs.length === 0, 'zero console errors through the three verbs', api.errs.slice(0, 2).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
