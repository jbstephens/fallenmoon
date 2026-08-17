#!/usr/bin/env node
// THE HOUR TORTOISE. The gate that matters: a KID BOT that only ever walks
// at it and mashes the sword must win the whole fight, all three phases.
import { serve, launchChrome, pageSession, mkApi, continueIn, ISLES, gate, summary, sleep } from './p6e.mjs';

const SOLVED = { ...ISLES, fGlyph1: true, fGlyph2: true, fGlyph3: true };
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(SOLVED);
await api.seedSeen(['tortCure']);          // skippable-after-first-view path
await api.nav(base + '/?turbo=12');
await continueIn(api);
await api.installBot('pad');

/* ── proximity ALWAYS wakes it, whatever the quest thinks ── */
await api.eval(`__fmDebug.warpFoundry('pit'); P.hearts = P.maxHearts; 0`);
await api.waitTicks(40);
gate(await api.eval('__fm.tortActive === true'), 'proximity ALWAYS wakes the guardian');
gate(await api.eval('__fm.tortPhase === 1 && __fm.tortHp === 84'), 'HP 84, phase one');
gate(await api.eval(`document.getElementById('bossBar').classList.contains('on')`), 'the boss bar is up');
gate(await api.eval(`document.querySelectorAll('.bossNotch').length === 2`), 'the bar carries its two phase notches');
gate(await api.eval(`document.getElementById('bossName').textContent === 'THE HOUR TORTOISE'`), 'named on the bar');
await api.shot('boss-0-wake');

/* ── the learnable: it withdraws, it ROLLS, it ends DIZZY with the mouth at you ── */
let sawRoll = false, sawDizzy = false, sawTele = false, mouthGlow = false;
for (let i = 0; i < 200; i++) {
  const st = await api.eval('JSON.stringify({st:__fm.tortSt, tip:+__fm.tortTip.toFixed(2), hp:__fm.tortHp})');
  const j = JSON.parse(st);
  if (j.st === 'rollTele') sawTele = true;
  if (j.st === 'roll') sawRoll = true;
  if (j.st === 'dizzy') {
    sawDizzy = true;
    mouthGlow = await api.eval('TORT.c.mouthGlow.visible === true');
    await api.shot('boss-1-dizzy');
    break;
  }
  await api.eval('P.hearts = P.maxHearts; 0');
  await sleep(220);
}
gate(sawTele, 'P1: it withdraws into the bell — a loud, long telegraph');
gate(sawRoll, 'P1: and ROLLS at you, ringing');
gate(sawDizzy, 'P1: it wobbles to a DIZZY stop');
gate(mouthGlow, 'P1: the bell’s open MOUTH glows — the weak point tells you where it is');

/* ── the weak point pays 5x ── */
const hp0 = await api.eval('__fm.tortHp');
await api.eval(`P.x = TORT.x - Math.cos(TORT.ang) * 3.0; P.z = TORT.z + Math.sin(TORT.ang) * 3.0;
  P.fy = groundH(P.x, P.z); P.heading = Math.atan2(TORT.x - P.x, TORT.z - P.z); P.hearts = P.maxHearts; 0`);
await api.waitTicks(3);
await api.tap(0);
await api.waitTicks(20);
const hp1 = await api.eval('__fm.tortHp');
const mouthHits = await api.eval('__fm.tortMouth');
gate(mouthHits > 0 && hp0 - hp1 >= 15, 'the MOUTH pays 5× a body hit', `${hp0}→${hp1}, mouth hits ${mouthHits}`);

/* ═══ THE GATE: the kid bot. Body-slashing alone, no aiming, no timing. ═══ */
await api.eval(`__fmDebug.warpFoundry('pit'); applyWorldState(); 0`);
await api.eval(`SAVE.fGlyph1 = true; SAVE.fGlyph2 = true; SAVE.fGlyph3 = true; storeSave(); 0`);
await api.eval(`__fmDebug.warpFoundry('pit'); P.hearts = P.maxHearts; 0`);
await api.waitTicks(30);
gate(await api.eval('__fm.tortDone === false && __fm.tortHp === 84'), 'kid-bot run starts from a fresh, full guardian');

const t0 = Date.now();
let deaths = 0, lastHp = 84, phases = new Set();
await api.eval(`__fmBot.tol = 1.4; 0`);
let won = false;
for (let i = 0; i < 900 && !won; i++) {
  const st = JSON.parse(await api.eval(`JSON.stringify({
    hp: __fm.tortHp, ph: __fm.tortPhase, st: __fm.tortSt, done: __fm.tortDone,
    cin: __fm.cinId, hearts: __fm.hearts, sun: __fm.sunstruck,
    tx: __fm.tortX, tz: __fm.tortZ, px: __fm.x, pz: __fm.z, state: __fm.state })`));
  phases.add(st.ph);
  if (st.sun > deaths) { deaths = st.sun; }
  if (st.done || st.cin === 'tortCure') { won = true; break; }
  if (st.state !== 'play') { await sleep(200); continue; }
  /* the kid: walk AT it and mash. Nothing else. No dodging, no jumping,
     no aiming for the mouth, no reading the telegraph. */
  await api.eval(`__fmBot.target = [${st.tx.toFixed(2)}, ${st.tz.toFixed(2)}]; 0`);
  await api.eval('__fakePad.press(0)'); await sleep(150);
  await api.eval('__fakePad.press()'); await sleep(110);
  lastHp = st.hp;
}
const mins = ((Date.now() - t0) / 60000).toFixed(1);
const final = JSON.parse(await api.eval(`JSON.stringify({hp:__fm.tortHp, ph:__fm.tortPhase, done:__fm.tortDone, cin:__fm.cinId, body:__fm.tortBody, mouth:__fm.tortMouth, sun:__fm.sunstruck})`));
console.log('kid-bot result:', JSON.stringify(final), 'phases seen', [...phases].join(','), mins + ' min');
gate(won, 'KID BOT: body-slashing alone WINS the whole fight', JSON.stringify(final));
gate(phases.has(2) && phases.has(3), 'KID BOT: it went through all three phases', [...phases].join(','));
await api.shot('boss-2-kidbot');

/* ── the cure: nothing dies ── */
await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
await api.waitFor(`__fm.tortDone === true`, 60000, 'cure finishes').catch(() => {});
for (let i = 0; i < 60 && (await api.eval(`__fm.state === 'cine'`)); i++) { await api.tap(0); await sleep(300); }
const cured = JSON.parse(await api.eval(`JSON.stringify({done:__fm.tortDone, taken:__fm.bellTaken, st:__fm.tortSt, q:__fm.quest})`));
console.log('after the cure:', JSON.stringify(cured));
gate(cured.done, 'THE CURE: the guardian is cured, not killed');
gate(await api.eval('TORT.c.rollN.parent === scene && TORT.c.rollN.visible'), 'the bell is SET DOWN and stands in the pit');
await api.shot('boss-3-cured');

/* ── take the bell ── */
await api.eval(`__fmBot.tol = 1.2; __fmBot.target = [F_BELL_REST.x + 2.4, F_BELL_REST.z + 2.4]; 0`);
await api.waitFor(`__fm.prompt === 'foundryBell'`, 60000, 'take-the-bell prompt').catch(() => {});
await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
gate(await api.eval(`__fm.prompt === 'foundryBell'`), 'the GIBBOUS BELL offers ✕ TAKE');
await api.tap(0);
await api.waitTicks(20);
gate(await api.eval('__fm.carryBell === true'), 'the Gibbous Bell is carried');
gate(await api.eval('__fm.quest === 11'), 'the quest turns for home', 'q=' + await api.eval('__fm.quest'));
await api.shot('boss-4-carry');
gate(api.errs.length === 0, 'zero console errors through the whole fight', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
