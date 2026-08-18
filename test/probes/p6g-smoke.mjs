#!/usr/bin/env node
// quick smoke: does the page boot clean, and do the Crown and the stair exist?
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_START, gate, summary } from './p6g.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(P4_START);
await api.nav(base + '/?turbo=6');
console.log('build:', await api.eval('window.__fmBuild'));
console.log('boot errors:', JSON.stringify(api.errs.slice(0, 8)));
await continueIn(api);
console.log('crownInfo:', await api.eval('JSON.stringify(__fmDebug.crownInfo())'));
console.log('organInfo:', await api.eval('JSON.stringify(__fmDebug.organInfo())'));
console.log('stagInfo:', await api.eval('JSON.stringify(__fmDebug.stagInfo())'));
const probe = await api.eval(`(function(){
  const at = (x,z)=>({g:+groundH(x,z).toFixed(2), solid:worldSolidAt(x,z), area:areaAt(x,z), shade:inShadeAt(x,z)});
  return JSON.stringify({
    ledge: at(K_PAD.ledge.x, K_PAD.ledge.z),
    t1: at(K_PAD.t1.x, K_PAD.t1.z), t2: at(K_PAD.t2.x, K_PAD.t2.z), t3: at(K_PAD.t3.x, K_PAD.t3.z),
    beacon: at(K_BEACON.x, K_BEACON.z), shrine: at(K_SHRINE.x, K_SHRINE.z),
    plinth: at(K_PLINTH.x, K_PLINTH.z), gate: at(K_GATE.x, K_GATE.z),
    crag: at(K_PAD.t1.x, K_PAD.t1.z - 34),
    crack: at(STAIR_IN.x, STAIR_IN.z),
  });
})()`);
console.log('probe:', probe);
gate(api.errs.length === 0, 'zero console errors at boot + continue', api.errs.slice(0, 3).join(' | '));
await api.eval('__fmDebug.warpCrown("ledge")');
await api.waitTicks(40);
console.log('on the ledge:', await api.eval('JSON.stringify({x:+__fm.x.toFixed(1),z:+__fm.z.toFixed(1),y:+P.fy.toFixed(2),area:__fm.crownArea,calls:__fm.calls,tris:__fm.tris})'));
await api.shot('smoke-ledge');
await api.eval('__fmDebug.warpStair(1)');
await api.waitTicks(40);
console.log('on L1:', await api.eval('JSON.stringify({x:+__fm.x.toFixed(1),z:+__fm.z.toFixed(1),y:+P.fy.toFixed(2),area:__fm.crownArea,inStair:__fm.inStair,calls:__fm.calls,tris:__fm.tris})'));
await api.shot('smoke-l1');
gate(api.errs.length === 0, 'zero console errors after warps', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
