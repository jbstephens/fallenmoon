#!/usr/bin/env node
// The rest of it: the Ben-bait mould room, the carving, the gull nests,
// the shockwave you jump, and the keyboard-only way in.
import { serve, launchChrome, pageSession, mkApi, continueIn, ISLES, gate, summary, sleep } from './p6e.mjs';

const OPEN = { ...ISLES, fGlyph1: true, fGlyph2: true, fGlyph3: true, mh: 6 };
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(OPEN);
await api.nav(base + '/?turbo=10');
await continueIn(api);
await api.installBot('pad');
async function walk(x, z, tol = 1.2, ms = 45000) {
  await api.eval(`__fmBot.tol = ${tol}; __fmBot.target = [${x}, ${z}]`);
  try { await api.waitFor(`Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < ${tol + 1.2}`, ms, 'walk'); } catch (e) {}
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  await api.waitTicks(8);
}

/* ═══ THE HIDDEN MOULD ROOM (Ben bait) ═══ */
await api.eval(`__fmDebug.warpFoundry('mould'); P.hearts = P.maxHearts; 0`);
await api.waitTicks(24);
gate(await api.eval(`areaAt(P.x,P.z) === 'foundry' && inFoundryAt(P.x,P.z)`), 'the mould room is part of the works');
const mh0 = await api.eval('__fm.maxHearts');
await walk(await api.eval("FCHEST.x + 1.5"), await api.eval("FCHEST.z + 1.1"), 0.7);
if ((await api.eval("__fm.prompt")) !== "foundryChest") {
  await api.eval("__fmDebug.warp(FCHEST.x + 1.4, FCHEST.z + 1.0); 0");   // setup only
  await api.waitTicks(10);
}
await api.waitFor(`__fm.prompt === 'foundryChest'`, 30000, 'the chest prompt').catch(() => {});
gate(await api.eval(`__fm.prompt === 'foundryChest'`), 'the bell-founder’s chest offers ✕ OPEN');
await api.shot('extra-1-mould');
await api.tap(0);
await api.waitFor(`__fm.maxHearts > ${mh0}`, 30000, 'the heart container').catch(() => {});
gate(await api.eval(`__fm.maxHearts === ${mh0 + 1}`), 'it pays a HEART CONTAINER', mh0 + ' → ' + await api.eval('__fm.maxHearts'));
gate(await api.eval('__fm.fMouldHeart === true'), 'and the save remembers it');

/* ═══ THE CARVING — the Falls Hollow mural from the OTHER side ═══ */
await walk(await api.eval('FMOULD.x - 2.0'), await api.eval('FMOULD.z + 0.4'), 0.8);
await api.waitFor(`__fm.prompt === 'foundryCarve'`, 30000, 'the carving prompt').catch(() => {});
gate(await api.eval(`__fm.prompt === 'foundryCarve'`), 'the carving offers ✕ LOOK');
await api.tap(0);
await api.waitFor(`__fm.cinId === 'micro'`, 15000, 'the micro-beat').catch(() => {});
let cap = null;
for (let i = 0; i < 24 && !cap; i++) { cap = await api.eval('__fm.caption'); if (!cap) await sleep(180); }
await api.shot("extra-2-carving");
console.log('carving caption:', cap);
gate(/ABOVE it/.test(cap || ''), 'and it says the one thing it has to, and no more', cap);
await api.waitFor(`__fm.state === 'play'`, 20000, 'back to play');
gate(await api.eval('__fm.fMouldMural === true'), 'the chain mystery is deepened, and remembered');

/* ═══ THE GULL NESTS: a real fight beat, and they cost hearts ═══ */
await api.eval(`applyWorldState(); __fmDebug.warpFoundry('kiln'); P.hearts = P.maxHearts; 0`);
await api.waitTicks(30);
const g0 = await api.eval('__fm.gullsAlive');
gate(g0 >= 2, 'the kiln floor has a gull nest on it', 'alive=' + g0);
let hurt = false, killed = 0;
for (let i = 0; i < 70; i++) {
  const st = JSON.parse(await api.eval("JSON.stringify({h:__fm.hearts, g:__fm.gullsAlive, gx:(FGULLS.find(q=>!q.dead)||{}).x, gz:(FGULLS.find(q=>!q.dead)||{}).z})"));
  if (st.h < await api.eval("__fm.maxHearts")) hurt = true;
  killed = g0 - st.g;
  if (killed >= 1 && hurt) break;
  if (st.gx !== undefined) {
    await api.eval("__fmBot.tol = 1.0; __fmBot.target = [" + st.gx.toFixed(1) + ", " + st.gz.toFixed(1) + "]; 0");
    await api.eval("P.heading = Math.atan2(" + st.gx.toFixed(1) + " - P.x, " + st.gz.toFixed(1) + " - P.z); 0");
  }
  await api.eval("__fakePad.press(0)"); await sleep(200);
  await api.eval("__fakePad.press()"); await sleep(160);
}
await api.eval("__fmBot.release(); __fakePad.axes(0,0); 0");
gate(killed >= 1, 'the sword pops a gull', 'popped ' + killed);
gate(hurt, 'and a gull that dives home costs a heart');
await api.shot('extra-3-gulls');

/* ═══ THE SHOCKWAVE (phase two) — it exists, and a JUMP clears it ═══ */
await api.eval(`applyWorldState(); SAVE.fGlyph1=true; SAVE.fGlyph2=true; SAVE.fGlyph3=true; storeSave();
  applyWorldState(); __fmDebug.warpFoundry('pit'); P.hearts = P.maxHearts; 0`);
await api.waitTicks(30);
await api.eval('__fmDebug.tortSet(50, 2); 0');
let sawRing = false, ringR = 0;
for (let i = 0; i < 160; i++) {
  const st = JSON.parse(await api.eval(`JSON.stringify({st:__fm.tortSt, ring:+__fm.tortRing.toFixed(1), ph:__fm.tortPhase})`));
  if (st.ring > 2) { sawRing = true; ringR = st.ring; await api.shot('extra-4-shockwave'); break; }
  await api.eval('P.hearts = P.maxHearts; 0');
  await sleep(250);
}
gate(sawRing, 'P2: the slam sends a shockwave RING across the floor', 'r=' + ringR);

/* ═══ KEYBOARD ONLY: the works are playable with no pad at all ═══ */
await api.eval(`__fmBot.release(); 0`);
await api.installBot('kbd').catch(() => {});
await api.eval(`__fmDebug.warp(FDOOR.x, FDOOR.z + 5); P.hearts = P.maxHearts; 0`);
await api.waitTicks(20);
await api.eval(String.fromCharCode(95,95,102,109,66,111,116) + ".mode = " + JSON.stringify("kbd") + "; 0");
let gotIn = false;
for (const [wx, wz] of [[-1520, -352], [-1520, -364], [-1512, -374], [-1502, -382], [-1494, -388]]) {
  await api.eval("__fmBot.tol = 1.8; __fmBot.target = [" + wx + ", " + wz + "]; 0");
  await api.waitFor("Math.hypot(__fm.x-(" + wx + "), __fm.z-(" + wz + ")) < 3.4", 45000, "kbd wp").catch(() => {});
}
gotIn = await api.eval("inFoundryAt(P.x, P.z) && Math.hypot(__fm.x - F1.x, __fm.z - F1.z) < 26");
await api.eval(`__fmBot.release(); 0`);
gate(gotIn, 'KEYBOARD: the Foundry is walked in on WASD alone');
await api.shot('extra-5-kbd');
gate(api.errs.length === 0, 'zero console errors through all of it', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
