#!/usr/bin/env node
// Carry home, parts B + C: the descent pointer node by node, then the
// compass-followed walk from the crack out the falls door.
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_START } from '/Users/johnstephens/Developer/stephensgames/fallenmoon/test/probes/p6g.mjs';
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init();
await api.seedSave({ ...P4_START, q: 16, crownGlint: true, stairOpen: true, organ1: true, organ2: true, organ3: true, crownSeen: true, stagDone: true, beaconHeart: true, mh: 8, lastPos: [2060, 1490, 112] });
await api.nav(base + '/?turbo=8');
await continueIn(api);
let ok = 0, fail = 0;
// B: at each stair node, the pointer answers the NEXT node down
const pairs = [['top', 'a'], ['l3', 'l2'], ['l2', 'l1'], ['l1', 'mouth']];
for (const [at, want] of pairs) {
  const r = JSON.parse(await api.eval(`(function(){
    __fmDebug.warpStair(${JSON.stringify(at) === '"top"' ? 4 : at === 'l3' ? 3 : at === 'l2' ? 2 : 1});
    const names = { a: S_NODE.a, l2: S_NODE.l2, l1: S_NODE.l1, mouth: S_NODE.mouth };
    const o = objectivePoint(), w = names[${JSON.stringify('WANT')}.toLowerCase()] || null;
    return JSON.stringify({ o, sm: stairMode });
  })()`.replace('WANT', want)));
  const wantPt = JSON.parse(await api.eval(`JSON.stringify({x: S_NODE.${want}.x, z: S_NODE.${want}.z})`));
  const hit = r.sm && Math.hypot(r.o.x - wantPt.x, r.o.z - wantPt.z) < 8;
  console.log(`${hit ? 'PASS' : 'FAIL'}  descent at ${at}: pointer -> ${want}  ${JSON.stringify(r.o)} sm=${r.sm}`);
  hit ? ok++ : fail++;
}
// C: from the mouth, FOLLOW the compass out the falls door
await api.eval('__fmDebug.warpCrown("crack"); 0');
await api.installBot('pad');
await api.eval('P.iframes = 1e9; 0');
const t0 = Date.now(); let done = false, legs = 0;
while (Date.now() - t0 < 420000 && legs < 40) {
  const o = JSON.parse(await api.eval('JSON.stringify(objectivePoint() || null)'));
  if (!o) break;
  await api.eval(`__fmBot.tol = 2.2; __fmBot.target = [${o.x}, ${o.z}]`);
  const l0 = Date.now();
  while (Date.now() - l0 < 40000) {
    if (await api.eval(`Math.hypot(__fm.x - ${o.x}, __fm.z - ${o.z}) < 3.5`)) break;
    const mv = JSON.parse(await api.eval('JSON.stringify(objectivePoint() || null)'));
    if (!mv || Math.hypot(mv.x - o.x, mv.z - o.z) > 2) break;
    await new Promise(r => setTimeout(r, 500));
  }
  legs++;
  console.log(`leg ${legs}: -> ${Math.round(o.x)},${Math.round(o.z)}  at ${await api.eval('Math.round(__fm.x)')},${await api.eval('Math.round(__fm.z)')} sm=${await api.eval('typeof stairMode !== "undefined" ? stairMode : "?"')} hol=${await api.eval('_preCrownInHollowAt(__fm.x, __fm.z)')}`);
  const b = await api.eval('Math.hypot(__fm.x - (-38), __fm.z - (-78))');
  if (b < 6) { done = true; break; }
}
console.log(done ? `PASS  compass walked crack -> Hollow -> falls door -> forest -> THE MOONWHEEL (${legs} legs)` : `FAIL  stalled after ${legs} legs`);
done ? ok++ : fail++;
console.log(`${ok} passed, ${fail} failed`);
proc.kill(); srv.close(); process.exit(fail ? 1 : 0);
