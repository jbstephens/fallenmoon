#!/usr/bin/env node
// LOOK AT IT. Framed stills of every beat, at 1280x720, taken with the free
// camera so the composition is the one a player actually gets.
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_CROWN, gate, summary, sleep } from './p6g.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(P4_CROWN);
await api.seedSeen(['dawnCall']);
await api.nav(base + '/?turbo=6');
await continueIn(api);
await api.eval('__fmDebug.glintNow(true); 0');

/* the REAL follow camera, from the REAL player position: the composition a
   player actually gets, not a flattering flycam */
async function shot(name, warp, yaw, pitch) {
  if (warp) { await api.eval(warp); await api.waitTicks(24); }
  if (yaw !== undefined) {
    await api.eval(`P.heading = ${yaw}; CAM.yaw = ${yaw} + Math.PI; CAM.pitch = ${pitch === undefined ? 0.34 : pitch}; CAM.ready = false; 0`);
    await api.waitTicks(10);
  }
  await api.waitTicks(6);
  await sleep(320);
  await api.shot(name);
}
const N = Math.PI, S = 0, E = Math.PI / 2, W = -Math.PI / 2;
/* 1. the parapet view — the whole healed world in one frame */
await shot('1-parapet-wnw', '__fmDebug.warpCrown("glint")', -2.2, 0.18);
await shot('2-parapet-n', null, N + 0.35, 0.12);
await shot('3-ledge-back', '__fmDebug.warpCrown("ledge")', 1.1, 0.4);
/* 2. the garden */
await shot('4-terraces', '__fmDebug.warpCrown("saddle")', 0.9, 0.5);
await shot('5-plinth', '__fmDebug.warpCrown("t2")', 0.15, 0.42);
await shot('6-beacon', '__fmDebug.warpCrown("beacon")', W - 0.4, 0.3);
await shot('7-shrine', '__fmDebug.warpCrown("shrine")', E + 0.3, 0.3);
await shot('8-gate', '__fmDebug.warpCrown("out")', -2.4, 0.3);
/* 3. the stair */
await shot('9-crack', '__fmDebug.warpCrown("crack")', 0.85, 0.3);
await shot('10-mouth', '__fmDebug.warpStair(0)', 0.85, 0.3);
await shot('11-l1', '__fmDebug.warpStair(1)', 0.85, 0.3);
await shot('12-l2', '__fmDebug.warpStair(2)', 0.85, 0.3);
await shot('13-l3', '__fmDebug.warpStair(3)', 0.85, 0.3);
await shot('14-l3-up', null, 0.85, -0.42);
await shot('15-exit', '__fmDebug.warpStair(4)', 2.2, 0.3);
/* 4. the guardian */
await api.eval('__fmDebug.warpCrown("t2"); 0');
await api.waitTicks(40);
await api.eval('SAVE.stagDone = false; storeSave(); applyWorldState(); __fmDebug.warpCrown("t2"); P.hearts = P.maxHearts; 0');
await api.waitFor('__fm.stagActive === true', 40000, 'the Stag wakes').catch(() => {});
await api.waitTicks(30);
const faceStag = async () => {
  await api.eval(`P.heading = Math.atan2(STAG.x - P.x, STAG.z - P.z); CAM.yaw = P.heading + Math.PI; CAM.pitch = 0.22; CAM.ready = false; 0`);
  await api.waitTicks(6);
};
await api.eval(`P.x = STAG.x - Math.sin(STAG.ang) * 9; P.z = STAG.z - Math.cos(STAG.ang) * 9; P.fy = groundH(P.x,P.z); 0`);
await faceStag();
await shot('16-stag-wake');
for (let i = 0; i < 60; i++) {
  const st = await api.eval('__fm.stagSt');
  if (st === 'paw') break;
  await sleep(200);
}
await faceStag();
await shot('17-stag-paw');
for (let i = 0; i < 90; i++) {
  const st = await api.eval('__fm.stagSt');
  if (st === 'stagger') break;
  await api.eval('P.hearts = P.maxHearts; 0');
  await sleep(200);
}
await api.eval(`P.x = STAG.x + Math.sin(STAG.ang + 2.2) * 5.5; P.z = STAG.z + Math.cos(STAG.ang + 2.2) * 5.5; P.fy = groundH(P.x,P.z); 0`);
await faceStag();
await shot('18-stag-stagger');
/* the fawns, and the cure's own frame */
await api.eval(`__fmDebug.warpCrown("t3"); P.hearts = P.maxHearts; 0`);
await api.waitTicks(40);
await api.eval(`(function(){ let best=null, bd=1e9; for (const f of FAWNS) { const d = Math.hypot(P.x-f.x,P.z-f.z); if (d<bd) {bd=d; best=f;} }
  if (best) { P.heading = Math.atan2(best.x-P.x, best.z-P.z); CAM.yaw = P.heading + Math.PI; CAM.pitch = 0.24; CAM.ready = false; } return 0; })()`);
await api.waitTicks(8);
await shot('19-fawns');
console.log('stag:', await api.eval('JSON.stringify(__fmDebug.stagInfo())'));

/* ── the authored beats, staged for LOOKING at ── */
await api.eval('SAVE.organ1 = SAVE.organ2 = SAVE.organ3 = false; storeSave(); applyWorldState(); 0');
await api.eval('__fmDebug.warpStair(3); 0');
await api.waitTicks(20);
await api.eval(`startCine('dawnCall'); 0`);
for (const [name, wait] of [['20-dawn-a', 40], ['21-dawn-b', 150], ['22-dawn-c', 200]]) {
  await api.waitTicks(wait);
  await sleep(200);
  await api.shot(name);
}
for (let i = 0; i < 40 && (await api.eval(`__fm.state === 'cine'`)); i++) { await api.waitTicks(40); }
/* the cure */
await api.eval('SAVE.stagDone = false; storeSave(); applyWorldState(); __fmDebug.warpCrown("t3"); P.hearts = P.maxHearts; 0');
await api.waitFor('__fm.stagActive === true', 40000, 'awake').catch(() => {});
await api.waitTicks(30);
await api.eval(`STAG.hp = 1; dealStagDamage(3); 0`);
for (const [name, wait] of [['23-cure-a', 60], ['24-cure-b', 220], ['25-cure-c', 200]]) {
  await api.waitTicks(wait);
  await sleep(200);
  await api.shot(name);
}
for (let i = 0; i < 40 && (await api.eval(`__fm.state === 'cine'`)); i++) { await api.waitTicks(40); }
await api.waitTicks(40);
await api.eval(`P.x = K_PLINTH.x + 3; P.z = K_PLINTH.z - 4; P.fy = groundH(P.x,P.z);
  P.heading = Math.atan2(K_PLINTH.x - P.x, K_PLINTH.z - P.z); CAM.yaw = P.heading + Math.PI; CAM.pitch = 0.2; CAM.ready = false; 0`);
await api.waitTicks(12);
await api.shot('26-the-sliver');
gate(api.errs.length === 0, 'zero console errors through the shot strip', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
