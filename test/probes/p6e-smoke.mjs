#!/usr/bin/env node
// quick smoke: does the page boot clean, and does the foundry exist?
import { serve, launchChrome, pageSession, mkApi, continueIn, ISLES, gate, summary, sleep } from './p6e.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(ISLES);
await api.nav(base + '/?turbo=6');
console.log('build:', await api.eval('window.__fmBuild'));
await continueIn(api);
const info = await api.eval(`JSON.stringify(__fmDebug.foundryInfo ? __fmDebug.foundryInfo() : 'no foundryInfo')`);
console.log('foundryInfo:', info);
const probe = await api.eval(`(function(){
  const at = (x,z)=>({g:+groundH(x,z).toFixed(2), solid:worldSolidAt(x,z), inF:inFoundryAt(x,z), area:areaAt(x,z), shade:inShadeAt(x,z)});
  return JSON.stringify({
    doorY: +F_DOOR_Y.toFixed(2), F1Y:+F1Y.toFixed(2), F2Y:+F2Y.toFixed(2), F3Y:+F3Y.toFixed(2), cap:+F_CAP_Y.toFixed(2),
    door: at(FDOOR.x, FDOOR.z),
    inThroat: at(FDOOR.x, FDOOR.z-14),
    f1: at(F1.x,F1.z), f2: at(F2.x,F2.z), f2b: at(F2B.x,F2B.z), f3: at(F3.x,F3.z),
    gate: at(FGATE.x,FGATE.z), res: at(FGLYPH3.x,FGLYPH3.z),
    outside: at(F1.x, F1.z-30),
  });
})()`);
console.log('probe:', probe);
console.log('errors:', JSON.stringify(api.errs.slice(0, 6)));
gate(api.errs.length === 0, 'zero console errors at boot', api.errs.slice(0, 2).join(' | '));
await api.eval('__fmDebug.warpFoundry ? __fmDebug.warpFoundry("f2") : 0').catch(e => console.log('warpFoundry missing'));
await api.waitTicks(30);
await api.shot('smoke-f2');
c.close(); proc.kill(); srv.close();
process.exit(summary());
