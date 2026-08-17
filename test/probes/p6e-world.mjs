#!/usr/bin/env node
// THE JOHN SEQUENCE, extended to phase three: a completed save taken to NEW
// GAME must put the bell back on the tortoise, relock every door, shut the
// chest, pin the sun back at noon and take the sky back to step two.
// Plus: the PHASE TWO card that the Half Shield arc never had.
import { serve, launchChrome, pageSession, mkApi, continueIn, ISLES, gate, summary, sleep, tapUntil } from './p6e.mjs';

const DONE = {
  ...ISLES, q: 12, ph: 3, sky: 3, sunArc: true, tbc2Seen: true, tbc3Seen: true,
  fGlyph1: true, fGlyph2: true, fGlyph3: true, tortoiseDone: true,
  fMouldHeart: true, fMouldMural: true, mh: 8, lastShade: [4, -2], region: 'bay',
};
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(DONE);
await api.nav(base + '/?turbo=10');
await continueIn(api);

/* ── a completed save restores a completed world ── */
const done = JSON.parse(await api.eval(`JSON.stringify({
  sky: __fm.skyStep3, arc: __fm.sunArc, star3: __fm.star3On,
  tort: __fm.tortDone, taken: __fm.bellTaken, carry: __fm.carryBell,
  g: [__fm.fGlyph1, __fm.fGlyph2, __fm.fGlyph3], door: +__fm.fDoorK.toFixed(2),
  chest: fMouldChest.opened, gate: __fm.foundryOpen, q: __fm.quest,
  wheelZ: +wheelRing.rotation.z.toFixed(3), bellVis: gibbousItem.visible,
  bellDetached: TORT.c.rollN.parent === scene })`));
console.log('CONTINUE (finished):', JSON.stringify(done));
gate(done.sky === 1 && done.arc && done.star3, 'CONTINUE: sky three, third star, the arc live');
gate(done.tort && done.taken && !done.carry, 'CONTINUE: the guardian is gone and the bell is slotted');
gate(done.g.every(Boolean) && done.door > 0.9, 'CONTINUE: all three glyphs done, the door open');
gate(Math.abs(done.wheelZ + 3 * Math.PI / 4) < 0.02, 'CONTINUE: the Moonwheel stands on its third notch');
gate(done.bellVis, 'CONTINUE: the Gibbous Bell rides its socket');
await api.shot('world-1-finished');

/* ── NEW GAME ── */
await api.eval(`storeSave(); 0`);
await api.eval(`__fmDebug.freeze(false); 0`);
await api.eval(`setState('title'); refreshTitleMenu(); titleFocus = 0; titleMode = 'menu'; 0`);
await api.waitTicks(6);
await tapUntil(api, () => api.tap(0), `__fm.ngGuardOn === true`, 12, 'the NEW GAME guard');
await api.tap(0);                                     // confirm
await api.waitFor(`__fm.state === 'play' || __fm.state === 'cine'`, 40000, 'a fresh adventure');
for (let i = 0; i < 30 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(300); }
await api.waitTicks(20);

const fresh = JSON.parse(await api.eval(`JSON.stringify({
  sky: SAVE.sky, arc: SAVE.sunArc, sunK: +__fm.sunK.toFixed(3), skyStep3: __fm.skyStep3,
  star3: __fm.star3On, tort: __fm.tortDone, tortHp: __fm.tortHp, tortPh: __fm.tortPhase,
  taken: __fm.bellTaken, carry: __fm.carryBell, phaseOn: TORT.c.phase.visible,
  bellOnBack: TORT.c.rollN.parent === TORT.c.root,
  g: [__fm.fGlyph1, __fm.fGlyph2, __fm.fGlyph3], door: +__fm.fDoorK.toFixed(2),
  resOpen: __fm.fResOpen, chest: fMouldChest.opened, chestLid: +fMouldChest.lid.rotation.x.toFixed(2),
  gate: __fm.foundryOpen, gateAngle: +fGateL.rotation.y.toFixed(2),
  wheelZ: +wheelRing.rotation.z.toFixed(3), bellVis: gibbousItem.visible,
  shadowDir: [+__fm.shadowDir[0].toFixed(2), +__fm.shadowDir[1].toFixed(2)],
  sunY: +__fm.sunY.toFixed(0), mh: __fm.maxHearts, q: __fm.quest, tbc2: __fm.tbc2Seen, tbc3: __fm.tbc3Seen })`));
console.log('NEW GAME:', JSON.stringify(fresh));
gate(fresh.sky === 0 && !fresh.arc && fresh.sunK === 0, 'NEW GAME: the sun is pinned back at noon');
gate(fresh.skyStep3 === 0 && !fresh.star3, 'NEW GAME: no third star, no third eighth');
gate(!fresh.tort && fresh.tortHp === 84 && fresh.tortPh === 0, 'NEW GAME: the Hour Tortoise is whole again');
gate(fresh.bellOnBack && fresh.phaseOn && !fresh.taken && !fresh.carry,
  'NEW GAME: the bell is back ON the tortoise', JSON.stringify([fresh.bellOnBack, fresh.phaseOn]));
gate(!fresh.g[0] && !fresh.g[1] && !fresh.g[2] && fresh.door === 0 && !fresh.resOpen,
  'NEW GAME: the three verbs are unsolved and the resonance door is shut');
gate(!fresh.gate && fresh.gateAngle === 0, 'NEW GAME: the bronze doors are shut again');
gate(!fresh.chest && fresh.chestLid === 0, 'NEW GAME: the mould-room chest is closed');
gate(fresh.wheelZ === 0 && !fresh.bellVis, 'NEW GAME: the Moonwheel is back at zero, no relics slotted');
gate(Math.abs(fresh.shadowDir[0] - 0.94) < 0.02 && Math.abs(fresh.shadowDir[1] - 0.34) < 0.02,
  'NEW GAME: shadows point back where they always did', JSON.stringify(fresh.shadowDir));
gate(fresh.mh === 5 && fresh.q === 0, 'NEW GAME: five hearts, no quest');
await api.shot('world-2-newgame');
gate(api.errs.length === 0, 'zero console errors across the matrix', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
