#!/usr/bin/env node
// the carry-home compass: assert each garden pad hands you the NEXT PAD,
// then FOLLOW the compass with the bot from the beacon to the stair door.
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_START } from '/Users/johnstephens/Developer/stephensgames/fallenmoon/test/probes/p6g.mjs';
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init();
await api.seedSave({ ...P4_START, q: 16, crownGlint: true, stairOpen: true, organ1: true, organ2: true, organ3: true, crownSeen: true, stagDone: true, beaconHeart: true, mh: 8, lastPos: [2060, 1490, 112] });
await api.nav(base + '/?turbo=4');
await continueIn(api);
let ok = 0, fail = 0;
const expect = async (spot, wantPad) => {
  const o = JSON.parse(await api.eval(`(function(){ __fmDebug.warpCrown("${spot}"); const o = objectivePoint(); return JSON.stringify({o, pad: [K_PAD["${wantPad}"].x, K_PAD["${wantPad}"].z]}); })()`));
  const hit = Math.hypot(o.o.x - o.pad[0], o.o.z - o.pad[1]) < 1;
  console.log(`${hit ? 'PASS' : 'FAIL'}  from ${spot}: compass -> ${wantPad} ${JSON.stringify(o.o)}`);
  hit ? ok++ : fail++;
};
await expect('beacon', 't3');     // up the ramp, not over the cliff
await expect('t3', 't2');
await expect('t2', 't1');
await expect('t1', 'saddle');
await expect('shrine', 'east');
// from the ledge pad the compass aims at the DOOR itself
const oL = JSON.parse(await api.eval(`(function(){ __fmDebug.warpCrown("ledge"); return JSON.stringify(objectivePoint()); })()`));
const dHit = Math.hypot(oL.x - 2066, oL.z - 1342) < 3;
console.log(`${dHit ? 'PASS' : 'FAIL'}  from ledge: compass -> the stair door ${JSON.stringify(oL)}`);
dHit ? ok++ : fail++;
// FOLLOW THE COMPASS for real: bot walks to each objective until the door
await api.eval('__fmDebug.warpCrown("beacon"); 0');
await api.installBot('pad');
let reached = false;
for (let leg = 0; leg < 12; leg++) {
  const o = JSON.parse(await api.eval('JSON.stringify(objectivePoint())'));
  await api.eval(`__fmBot.tol = 2.5; __fmBot.target = [${o.x}, ${o.z}]`);
  const t0 = Date.now();
  while (Date.now() - t0 < 30000) {
    if (await api.eval(`Math.hypot(__fm.x - ${o.x}, __fm.z - ${o.z}) < 3.5`)) break;
    await new Promise(r => setTimeout(r, 400));
  }
  const d = await api.eval('Math.hypot(__fm.x - 2066, __fm.z - 1342)');
  if (d < 5) { reached = true; break; }
}
console.log(`${reached ? 'PASS' : 'FAIL'}  followed the compass beacon -> stair door, no cliff`);
reached ? ok++ : fail++;
console.log(`${ok} passed, ${fail} failed`);
proc.kill(); srv.close(); process.exit(fail ? 1 : 0);
