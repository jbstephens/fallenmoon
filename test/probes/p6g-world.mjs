#!/usr/bin/env node
/* THE THREAD, END TO END, IN ONE SESSION: the gold light seen from the
   tower, the crack answered, the compass leading, the Warden's one line,
   the resume, and the John sequence — a finished save taken to NEW GAME
   must put the ash back on the Stag and the stone back in the crack. */
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_START, P4_CROWN,
         gate, summary, sleep, tapUntil } from './p6g.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(P4_START);
await api.nav(base + '/?turbo=4');
await continueIn(api);
const jget = async (e) => JSON.parse(await api.eval(`JSON.stringify(${e})`));

/* ── before anything: the crack is not even a prompt ── */
await api.eval('__fmDebug.warpCrown("crack"); 0');
await api.waitTicks(20);
gate((await api.eval('__fm.prompt')) !== 'stairCrack',
  'the crack in the gallery is nothing at all until the gold light is seen',
  'prompt=' + await api.eval('__fm.prompt'));
gate((await api.eval('__fm.crownGlint')) === false, 'and the thread has not started');

/* ── THE COMPASS knows where to send you: up the tower, at gold hour ── */
await api.eval('__fmDebug.glintNow(true); 0');       // setup: park the sun in the gold band
await api.waitTicks(10);
gate(await api.eval('__fm.glintLive === true'), 'the gold band is live');
{
  const ob = await jget('({b:__fm.objBearing, d:__fm.objDist})');
  const tw = await jget('({x:TOWER.x, z:TOWER.z})');
  const want = Math.atan2(tw.x - (await api.eval('__fm.x')), tw.z - (await api.eval('__fm.z')));
  gate(ob.b !== null && Math.abs(((ob.b - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.15,
    'the moon compass leans toward the fire-watch tower — a nudge, never a caption', JSON.stringify(ob));
}

/* ── THE GLINT: it is really there, in pixels, from the tower deck ── */
await api.eval('__fmDebug.warp(1100, 806); 0');
await api.waitTicks(20);
/* climb the tower for real: the stairs are collider tops */
await api.installBot('pad');
for (const [x, z] of [[1096, 815], [1104, 815], [1108, 806], [1100, 802], [1100, 810]]) {
  await api.eval(`__fmBot.tol = 1.2; __fmBot.target = [${x}, ${z}]; 0`);
  await api.waitFor(`Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < 2.2`, 30000, 'tower ' + x).catch(() => {});
  await api.eval('P.hearts = P.maxHearts; 0');
}
await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
/* the deck is fifteen metres up a switchback: put the player on it and let
   the GAME decide whether the light counts */
/* stand at the deck's EAST rail, where a watcher looking at the Crown
   would stand: in the middle of the deck the lookout roof is in the way */
await api.eval(`P.x = TOWER.x + 3.6; P.z = TOWER.z + 2.0; P.fy = groundH(TOWER.x, TOWER.z) + TOWER.deckY; P.air = false; 0`);
await api.waitTicks(20);
gate(await api.eval('__fm.onTowerDeck === true'), 'standing on the fire-watch tower deck');
await api.eval(`__fmDebug.camYaw(Math.atan2(K_GLINT.x - P.x, K_GLINT.z - P.z) + Math.PI); __fmDebug.camPitch(0.06); CAM.ready = false; 0`);
/* the arc keeps moving while the probe climbs: park it back in the band
   right before looking (setup, not the mechanic — the mechanic is that
   standing here during a glint starts the thread, tested below) */
await api.eval('__fmDebug.glintNow(true); 0');
await api.waitTicks(8); await sleep(300);
await api.shot('world-1-tower-glint');
{
  /* the glint has to be VISIBLE from here: a pulsing point a kilometre off */
  const seen = await jget(`(function(){
    const v = new THREE.Vector3();
    v.setFromMatrixPosition(glintMesh.matrixWorld).project(camera);
    return { on: glintMesh.visible, op: +glintCoreMat.opacity.toFixed(2),
      sx: +v.x.toFixed(2), sy: +v.y.toFixed(2), d: +Math.hypot(camera.position.x - K_GLINT.x, camera.position.z - K_GLINT.z).toFixed(0),
      scale: +glintMesh.scale.x.toFixed(2) };
  })()`);
  console.log('the glint from the tower:', JSON.stringify(seen));
  gate(seen.on && seen.op > 0.15, 'THE GLINT is lit during the gold band', JSON.stringify(seen));
  gate(Math.abs(seen.sx) < 1 && Math.abs(seen.sy) < 1, 'and it is ON SCREEN from the tower deck', JSON.stringify(seen));
  /* on screen is not the same as VISIBLE: a kilometre of forest, the
     tower's own roof and the Crown's rim all stand between */
  const clear = await jget(`(function(){
    const objs = [];
    scene.traverse(o => { if (o.isMesh && o !== skyDome && o !== glintMesh && !glintMesh.children.includes(o) && o.visible) objs.push(o); });
    const from = camera.position.clone();
    const to = new THREE.Vector3().setFromMatrixPosition(glintMesh.matrixWorld);
    const dir = to.clone().sub(from);
    const len = dir.length();
    const rc = new THREE.Raycaster(from, dir.normalize(), 0.5, len - 6);
    const h = rc.intersectObjects(objs, false);
    const hit = h.length ? h[0] : null;
    let what = null;
    if (hit) {
      const o = hit.object;
      const NAMED = { crownFloor: crownFloorMesh, crownProps: crownPropMesh, crownGlow: crownGlowMesh,
        vista: crownVista, stairFloor: stairFloorMesh, stairWall: stairWallMesh, stairCap: stairCapMesh,
        stairProps: stairPropMesh, stairDress: stairDressMesh, stairGlow: stairMouthGlow,
        hollowFloor: hollowFloorMesh, hollowWall: hollowWallMesh, hollowDome: hollowDomeMesh,
        hollowProp: hollowPropMesh, hollowGlow: hollowGlowMesh, falls: fallsMesh, rockfall: rockfallMesh,
        rockfallOpen: rockfallOpenMesh, tower: towerMesh, cedar: cedarMesh, springs: window.__springsMesh,
        seaLine: (typeof seaLine !== 'undefined' ? seaLine : null) };
      let nm = null;
      for (const k in NAMED) { if (NAMED[k] === o) nm = k; }
      if (!nm) { for (const ch of chunks) if (ch.mesh === o) nm = 'chunk'; }
      if (!nm) { const i = farTier.indexOf(o); if (i >= 0) nm = 'farTier'; }
      const bb = o.geometry.boundingBox || (o.geometry.computeBoundingBox(), o.geometry.boundingBox);
      what = { name: nm, bb: [[+bb.min.x.toFixed(0), +bb.min.y.toFixed(0), +bb.min.z.toFixed(0)],
                              [+bb.max.x.toFixed(0), +bb.max.y.toFixed(0), +bb.max.z.toFixed(0)]],
        type: o.material && o.material.type, tris: o.geometry && o.geometry.attributes.position ? o.geometry.attributes.position.count / 3 : 0,
        p: [+hit.point.x.toFixed(0), +hit.point.y.toFixed(0), +hit.point.z.toFixed(0)],
        isCrown: o === crownFloorMesh || o === crownPropMesh, isFar: farTier.indexOf(o) >= 0,
        isChunk: chunks.some(cc => cc.mesh === o) };
    }
    return { blocked: h.length, first: h.length ? +h[0].distance.toFixed(0) : null, len: +len.toFixed(0), what };
  })()`);
  console.log('sightline:', JSON.stringify(clear));
  gate(clear.blocked === 0, 'and NOTHING stands in the way: a clear kilometre of sightline', JSON.stringify(clear));
  gate(seen.d > 900, 'a kilometre away, on the Crown', seen.d + ' m');
}
/* standing there is what sets the thread — not looking at a flag */
await api.waitFor('__fm.crownGlint === true', 30000, 'the thread starts').catch(() => {});
gate(await api.eval('__fm.crownGlint === true'), 'STANDING on the tower during a glint starts the thread');
for (let i = 0; i < 40 && (await api.eval(`__fm.state === 'cine'`)); i++) { await api.tap(0); await sleep(250); }
gate((await api.eval('__fm.quest')) === 13, 'quest 13: FOLLOW THE GOLD LIGHT', 'q=' + await api.eval('__fm.quest'));
gate((await api.eval(`document.getElementById('questLine').textContent`)) === 'FOLLOW THE GOLD LIGHT',
  'and the banner says so');

/* ── the compass now points at the crack, not the tower ── */
{
  const ob = await jget('({b:__fm.objBearing, d:__fm.objDist})');
  const want = Math.atan2(1978 - (await api.eval('__fm.x')), 1243 - (await api.eval('__fm.z')));
  gate(Math.abs(((ob.b - want + Math.PI * 3) % (Math.PI * 2)) - Math.PI) < 0.15,
    'the compass hands you on to the Hollow’s upper gallery', JSON.stringify(ob));
}

/* ── THE WARDEN gains her line ── */
await api.eval('__fmDebug.warp(1095.5, 806); 0');
await api.waitTicks(20);
await api.eval('P.x = warden.x + 1.4; P.z = warden.z + 1.4; P.heading = Math.atan2(warden.x-P.x, warden.z-P.z); 0');
await api.waitTicks(10);
gate((await api.eval('__fm.prompt')) === 'wardenTalk', 'the Warden is there to be asked',
  'prompt=' + await api.eval('__fm.prompt'));
await api.tap(0);
await api.waitTicks(10);
const dlg = await jget('({id:__fm.dlg, line:document.getElementById("dlgText").textContent})');
console.log('warden:', JSON.stringify(dlg));
gate(dlg.id === 'warden4', 'she has something new to say about the light', JSON.stringify(dlg));
for (let i = 0; i < 8 && (await api.eval(`__fm.state === 'dialog'`)); i++) { await api.tap(0); await sleep(250); }

/* ── the crack answers now ── */
await api.eval('__fmDebug.warpCrown("crack"); 0');
await api.waitTicks(20);
gate((await api.eval('__fm.prompt')) === 'stairCrack', 'NOW the crack offers ✕ LOOK',
  'prompt=' + await api.eval('__fm.prompt'));
/* the gallery's hornet nest is right here: a press taken while stunned
   buffers a SWING (p5's rule), so keep pressing — which is exactly what a
   player does, and the swings pop the hornets on the way */
for (let i = 0; i < 12; i++) {
  await api.eval('P.hearts = P.maxHearts; 0');
  await api.tap(0);
  if (await api.eval('__fm.stairOpen === true')) break;
  await sleep(250);
}
await api.waitFor('__fm.stairOpen === true', 20000, 'the crack opens').catch(() => {});
gate(await api.eval('__fm.stairOpen === true'), 'and looking through it opens the way');
gate((await api.eval('__fm.quest')) === 14, 'quest 14: CLIMB THE FALLS STAIR');
await api.waitFor(`__fm.state === 'play'`, 20000, 'back in play').catch(() => {});
await api.shot('world-2-crack');

/* ── the compass leads UP the stair, landing by landing ── */
{
  const p1 = await jget('({b:__fm.objBearing})');
  await api.eval('SAVE.organ1 = true; SAVE.organ2 = true; storeSave(); applyWorldState(); 0');
  await api.waitTicks(10);
  const p3 = await jget('({b:__fm.objBearing})');
  gate(p1.b !== null && p3.b !== null && Math.abs(p1.b - p3.b) > 0.05,
    'the compass follows the climb: it moves on as each landing sings');
  await api.eval('SAVE.organ1 = false; SAVE.organ2 = false; storeSave(); applyWorldState(); 0');
}

/* ── RESUME: quit on the Crown, come back to the Crown ──
   the seeded save is re-injected on EVERY navigation (that is what
   addScriptToEvaluateOnNewDocument does), so a resume gate has to re-seed
   the save it means to resume from — the p6e lesson, in the other
   direction */
const P4_ON_CROWN = { ...P4_CROWN, q: 15, lastPos: [2160, 1428], region: 'forest' };
await api.seedSave(P4_ON_CROWN);
await api.nav(base + '/?turbo=4');
await continueIn(api);
await api.waitTicks(30);
const resume = await jget('({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), y:+P.fy.toFixed(1), crown:__fm.inCrown, area:__fm.crownArea})');
console.log('resumed:', JSON.stringify(resume));
gate(resume.crown === true && Math.abs(resume.y - 117) < 2,
  'CONTINUE puts you back on the Crown, on the terrace, at the right height', JSON.stringify(resume));
/* and resuming INSIDE the stair lands on the stair's floor, not the cave roof */
/* a real save carries the height too — that is what tells the world
   which of the two floors at this address you were standing on */
await api.seedSave({ ...P4_ON_CROWN, lastPos: [2024, 1294, 58] });
await api.nav(base + '/?turbo=4');
await continueIn(api);
await api.waitTicks(30);
const resume2 = await jget('({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), y:+P.fy.toFixed(1), stair:__fm.inStair, area:__fm.crownArea})');
console.log('resumed in the stair:', JSON.stringify(resume2));
gate(resume2.stair === true && Math.abs(resume2.y - 58) < 2,
  'CONTINUE on a landing wakes you ON the landing, not in the Hollow’s roof', JSON.stringify(resume2));

/* ── THE JOHN SEQUENCE: a finished save, then NEW GAME ── */
await api.seedSave({ ...P4_ON_CROWN, stagDone: true, beaconHeart: true,
  crownChest1: true, crownChest2: true, q: 16 });
await api.nav(base + '/?turbo=4');
await api.waitFor(`__fm.state === 'title'`, 30000, 'title');
await tapUntil(api, () => api.tap(12), '__fm.titleFocus === 0', 10, 'focus NEW GAME');
await tapUntil(api, () => api.tap(0), `__fm.state !== 'title' || __fm.ngGuardOn === true`, 12, 'the guard');
await tapUntil(api, () => api.tap(0), `__fm.state === 'play'`, 14, 'a fresh adventure');
await api.waitTicks(40);
const fresh = await jget(`({ glint: !!SAVE.crownGlint, stair: !!SAVE.stairOpen,
  organ: [!!SAVE.organ1, !!SAVE.organ2, !!SAVE.organ3], seen: !!SAVE.crownSeen,
  stag: !!SAVE.stagDone, heart: !!SAVE.beaconHeart, chests: [!!SAVE.crownChest1, !!SAVE.crownChest2],
  q: SAVE.q, doors: organOpen.slice(), inCrack: (function(){ const m = S_NODE.mouth; return worldSolidAt(m.x, m.z); })(),
  stagHp: STAG.hp, stagPhase: STAG.phase, sliverOnStag: STAG.c.phase.visible, sliverLoose: sliverItem.visible,
  ventsLocked: ORG_VENTS.map(v => v.locked) })`);
console.log('after NEW GAME:', JSON.stringify(fresh));
gate(!fresh.glint && !fresh.stair && !fresh.seen && !fresh.stag && !fresh.heart &&
     fresh.organ.every(v => !v) && fresh.chests.every(v => !v),
  'NEW GAME: every phase-four flag is back to nothing', JSON.stringify(fresh));
gate(fresh.inCrack === true && fresh.doors.every(v => !v) && fresh.ventsLocked.every(v => !v),
  'NEW GAME: the crack is stone again and the organ is untuned', JSON.stringify(fresh));
gate(fresh.stagHp === 78 && fresh.stagPhase === 0 && fresh.sliverOnStag && !fresh.sliverLoose,
  'NEW GAME: the Stag wears its ash and its Sliver again', JSON.stringify(fresh));
gate(api.errs.length === 0, 'zero console errors across the whole thread', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
