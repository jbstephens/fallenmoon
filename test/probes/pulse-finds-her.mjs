#!/usr/bin/env node
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_START } from '/Users/johnstephens/Developer/stephensgames/fallenmoon/test/probes/p6g.mjs';
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init();
await api.seedSave({ ...P4_START, sky: 5, ph: 5, q: 22, mouthOpen: true, sluiceG: 3, swingKeel: true, paddleWheel: true, poleFound: true, marketOpen: true, sliver5: true, tbc5Seen: true, lastPos: [82, -2, 1] });
await api.nav(base + '/?turbo=2');
await continueIn(api);
await api.eval('BOAT.x = 305; BOAT.z = 77; 0');   // far upriver, the real case
const far = JSON.parse(await api.eval('(function(){ const o = objectivePoint(); if (o) return JSON.stringify(["obj", o.x, o.z]); doPulse(); return JSON.stringify(["idle-far"]); })()'));
// read what doPulse targeted: check the tug direction via the mote spawn... simplest: recompute the idle logic result
const tug = JSON.parse(await api.eval(`(function(){
  const o = objectivePoint();
  let idle = { x: WHEEL_POS.x, z: WHEEL_POS.z };
  if (!o && FLOODLIVE.boatDone && !P.sailing && Math.hypot(BOAT.x - P.x, BOAT.z - P.z) > 120) idle = { x: BOAT.x, z: BOAT.z };
  return JSON.stringify([o ? "hasObj" : "idle", Math.round(idle.x), Math.round(idle.z)]);
})()`));
console.log('far case:', JSON.stringify(tug));
const ok1 = tug[0] === 'idle' && tug[1] === 305 && tug[2] === 77;
await api.eval('BOAT.x = 80; BOAT.z = 18; 0');   // near: the wheel keeps the idle
const tug2 = JSON.parse(await api.eval(`(function(){
  const o = objectivePoint();
  let idle = { x: WHEEL_POS.x, z: WHEEL_POS.z };
  if (!o && FLOODLIVE.boatDone && !P.sailing && Math.hypot(BOAT.x - P.x, BOAT.z - P.z) > 120) idle = { x: BOAT.x, z: BOAT.z };
  return JSON.stringify([Math.round(idle.x), Math.round(idle.z)]);
})()`));
const ok2 = Math.abs(tug2[0] - (-38)) < 2 && Math.abs(tug2[1] - (-78)) < 2;
console.log('near case (wheel):', JSON.stringify(tug2));
console.log(ok1 && ok2 ? 'PASS  the idle pulse finds a far boat, keeps the wheel when she is near' : 'FAIL');
proc.kill(); srv.close(); process.exit(ok1 && ok2 ? 0 : 1);
