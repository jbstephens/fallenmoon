#!/usr/bin/env node
/* THE LOOK PASS — walk the REAL climb (crack → L1 → L2 → L3 → top) with
   the in-page bot and screenshot every flight, landing, door (open and
   shut) and both thresholds, at 1280x720, through the REAL follow camera.
   No assertions beyond zero-errors: this probe exists to be LOOKED at.
   Usage: node p6g-look.mjs <prefix>   (shots land in shots-p6g/look-<prefix>-*) */
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_STAIR,
         gate, summary, sleep } from './p6g.mjs';

const PRE = 'look-' + (process.argv[2] || 'x') + '-';
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(P4_STAIR);
await api.seedSeen(['dawnCall']);
await api.nav(base + '/?turbo=4');
await continueIn(api);
await api.installBot('pad');
const jget = async (e) => JSON.parse(await api.eval(`JSON.stringify(${e})`));

async function look(name, yaw, pitch) {
  await api.eval(`P.heading = ${yaw}; CAM.yaw = ${yaw} + Math.PI; CAM.pitch = ${pitch === undefined ? 0.3 : pitch}; CAM.ready = false; 0`);
  await api.waitTicks(10); await sleep(280);
  await api.shot(PRE + name);
}
async function walk(pts, label) {
  await api.installBot('pad');
  for (const [x, z] of pts) {
    await api.eval(`__fmBot.tol = 1.5; __fmBot.target = [${x}, ${z}]; 0`);
    await api.waitFor(`Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < 2.8`, 40000, label + ' ' + x).catch(() => {});
    await api.eval('P.hearts = P.maxHearts; 0');
  }
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  await api.waitTicks(10);
}
/* is the camera inside rock? (the 2.4 m clip check, asked of the world) */
async function camClip(where) {
  const r = await jget(`(function(){
    const cx = camera.position.x, cy = camera.position.y, cz = camera.position.z;
    const solid = stairMode ? window.__forestSolid(cx, cz) : false;
    const under = cy < groundH(cx, cz) - 0.05;
    return { solid, under, cy: +cy.toFixed(1), g: +groundH(cx, cz).toFixed(1) };
  })()`);
  console.log('  camClip ' + where + ': ' + JSON.stringify(r));
  return r;
}

/* ── the crack, from the gallery (threshold 1, outside) ── */
await api.eval('__fmDebug.warpCrown("crack"); 0'); await api.waitTicks(24);
await look('01-crack-outside', 0.85, 0.24);
/* walk IN through the mouth */
await walk([[1982.5, 1248.5]], 'mouth');
await look('02-mouth-inside-up', 0.85, 0.2);
await look('03-mouth-back-out', 0.85 + Math.PI, 0.2);
await camClip('mouth');
/* flight 1, midway */
await walk([[1992, 1258]], 'flight1');
await look('04-flight1-mid', 0.85, 0.12);
/* L1 */
await walk([[2002, 1268]], 'l1');
await look('05-l1-landing', 0.85, 0.3);
await look('06-l1-vent', 2.2, 0.3);
await camClip('l1');
/* door 1 SHUT — walk right up to it */
await walk([[2005.2, 1271.8]], 'door1');
await look('07-door1-shut', 0.7, 0.12);
const shut1 = await jget('({solid: worldSolidAt(S_DOORS[0].x, S_DOORS[0].z), k: +S_DOORS[0].k.toFixed(2)})');
console.log('door1 shut:', JSON.stringify(shut1));
/* open it (the save path — the organ probe owns proving the tuning) */
await api.eval('SAVE.organ1 = true; storeSave(); applyWorldState(); 0');
await api.waitTicks(12);
await look('08-door1-open', 0.7, 0.12);
/* flight 2 + L2 */
await walk([[2013, 1281], [2019, 1288]], 'flight2');
await look('09-flight2-mid', 0.7, 0.1);
await walk([[2024, 1294]], 'l2');
await look('10-l2-landing', 0.5, 0.3);
await look('11-l2-vents', 2.6, 0.26);
await camClip('l2');
await walk([[2027.6, 1298.4]], 'door2');
await look('12-door2-shut', 0.6, 0.12);
await api.eval('SAVE.organ2 = true; storeSave(); applyWorldState(); 0');
await api.waitTicks(12);
await look('13-door2-open', 0.6, 0.12);
/* flight 3 + L3 */
await walk([[2035, 1307], [2041, 1314]], 'flight3');
await look('14-flight3-mid', 0.6, 0.1);
await walk([[2046, 1320]], 'l3');
await look('15-l3-landing', 0.6, 0.3);
await look('16-l3-vents', 3.6, 0.26);
await look('17-l3-up', 0.85, -0.42);
await camClip('l3');
await walk([[2039, 1325]], 'door3');
await look('18-door3-shut', -1.2, 0.12);
await api.eval('SAVE.organ3 = true; storeSave(); applyWorldState(); 0');
await api.waitTicks(12);
await look('19-door3-open', -1.2, 0.12);
/* the rope-lift turns */
await walk([[2028, 1330], [2010, 1339], [1996, 1345]], 'to-a');
await look('20-node-a', -0.6, 0.2);
await camClip('node-a');
await walk([[1997, 1360], [2005, 1372], [2012, 1382]], 'to-b');
await look('21-node-b', 1.2, 0.2);
/* the top threshold, inside looking out, then outside looking back */
await walk([[2028, 1377], [2045, 1370], [2062, 1364]], 'to-out');
await look('22-out-inside', 1.35, 0.1);
await camClip('out');
await walk([[2076, 1362], [2072, 1352]], 'threshold');
await look('23-out-onto-crown', 1.35, 0.2);
await walk([[2066, 1342]], 'ledge');
await look('24-ledge-back-at-door', -1.9, 0.24);
/* the Crown boundary: stand near the walk limit and look across it */
await api.eval('__fmDebug.warpCrown("t3"); 0'); await api.waitTicks(20);
await look('25-boundary-south', 0, 0.28);
await api.eval('__fmDebug.warpCrown("east"); 0'); await api.waitTicks(20);
await look('26-boundary-east', Math.PI / 2, 0.28);
await api.eval('__fmDebug.warpCrown("beacon"); 0'); await api.waitTicks(20);
await look('27-boundary-west', -Math.PI / 2, 0.28);

/* ── THE DAWN CALL, traced frame by frame from the REAL trigger spot ── */
await api.eval('SAVE.organ3 = false; storeSave(); applyWorldState(); 0');
await api.eval('__fmDebug.warpStair(3); 0'); await api.waitTicks(20);
/* stand where the third vent is — where a player really is when it fires */
await walk([[2051.6, 1321.0]], 'vent3');
await api.eval(`SAVE.organ3 = true; storeSave(); organOpen[2] = true; startCine('dawnCall'); 0`);
const t0 = await api.eval('__fm.tick');
for (const dt of [20, 60, 110, 160, 210, 260, 310, 360, 410, 460, 510, 560, 610, 660]) {
  await api.waitFor(`__fm.tick > ${t0 + dt} || CINE.id !== 'dawnCall'`, 30000, 'dawn t+' + dt);
  if (!(await api.eval(`CINE.id === 'dawnCall'`))) break;
  const cam = await jget('({x:+camera.position.x.toFixed(1),y:+camera.position.y.toFixed(1),z:+camera.position.z.toFixed(1),t:+CINE.t.toFixed(2),calls:__fm.calls,tris:__fm.tris})');
  console.log('  dawn ' + dt + ': ' + JSON.stringify(cam));
  await api.shot(PRE + 'dawn-' + String(dt).padStart(3, '0'));
}
await api.waitFor(`__fm.state === 'play'`, 30000, 'dawn over').catch(() => {});
await sleep(300);
await api.shot(PRE + 'dawn-after');

gate(api.errs.length === 0, 'zero console errors through the look pass', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
