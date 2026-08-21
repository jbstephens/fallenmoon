#!/usr/bin/env node
// real-input test: dunk with the boat across deep water — she must come
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_START } from '/Users/johnstephens/Developer/stephensgames/fallenmoon/test/probes/p6g.mjs';
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init();
await api.seedSave({ ...P4_START, sky: 4, ph: 4, q: 19, mouthOpen: true, sluiceG: 3, swingKeel: true, paddleWheel: true, lastPos: [64, 0] });
await api.nav(base + '/?turbo=2');
await continueIn(api);
// park the boat across the deep strip, then walk the player into deep water
await api.eval('BOAT.x = 78; BOAT.z = 16; BOAT.spd = 0; lastDry[0] = 64; lastDry[1] = 0; 0');
// find a genuinely deep point between shore and boat, then warp into it
const spot = JSON.parse(await api.eval(`(function(){
  for (let s = 2; s < 14; s += 1) {
    const x = 64 + (78 - 64) / 14 * s, z = 0 + (16 - 0) / 14 * s;
    if (waterDepthAt(x, z) > 0.9) return JSON.stringify([x, z, +waterDepthAt(x,z).toFixed(2)]);
  }
  return JSON.stringify(null); })()`));
console.log('deep point:', JSON.stringify(spot));
await api.eval(`__fmDebug.warp(${spot[0]}, ${spot[1]}); 0`);
let dunked = false;
for (let i = 0; i < 20; i++) {
  await new Promise(r => setTimeout(r, 300));
  if (await api.eval('Math.hypot(__fm.x - 64, __fm.z - 0) < 4')) { dunked = true; break; }
}
const res = JSON.parse(await api.eval('JSON.stringify({px: Math.round(__fm.x), pz: Math.round(__fm.z), bx: Math.round(BOAT.x), bz: Math.round(BOAT.z), d: Math.round(Math.hypot(__fm.x - BOAT.x, __fm.z - BOAT.z)), depth: +waterDepthAt(BOAT.x, BOAT.z).toFixed(2)})'));
console.log('dunk-bounced:', dunked, JSON.stringify(res));
console.log(res.d <= 13 && res.depth >= 0.85 ? 'PASS  the dunk brought her to his shore' : 'FAIL');
proc.kill(); srv.close(); process.exit(0);
