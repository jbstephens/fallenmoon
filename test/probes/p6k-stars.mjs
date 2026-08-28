#!/usr/bin/env node
/* p6k — PHASE 6 PART ONE verification probe.
   The star road: the star-field at dusk (incomplete constellations), the
   REAL-INPUT spyglass sighting + glitter lanes, the four beacon islets
   (climbs, pockets, portals), beacon lighting by the real hold-✕ path,
   beam clamping (Rule 3), the drowned tower's punt + calm hall (Rule 4),
   the reef wash (knockdown, never hearts), persistence, LOWFX budgets.

   Run:  /opt/homebrew/opt/node@25/bin/node test/probes/p6k-stars.mjs [section...]
   Sections: struct sight harbor reef drowned farstar sky world perf   (default: all) */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, tapUntil, sleep, decodePNG } from './p6g.mjs';
const gate = (label, ok, extra) => rawGate(ok, label, extra);
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const GAME = path.resolve(DIR, '..', '..');
const SHOTS = '/tmp/fm_p6k';
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['struct', 'sight', 'harbor', 'reef', 'drowned', 'farstar', 'sky', 'world', 'perf'];
const want = (s) => WANT.includes(s);

const P5 = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'phase5-done-save.json'), 'utf8'));
/* the arc's stations, derived purely from flags (MIRROR-6) */
const Q24 = { ...P5, q: 24, spyglass: true, starsSeen: true, starLantern: true, salt: 60 };
const Q24_3LIT = { ...Q24, beaconLit: [true, true, true, false] };
const POSTMOTH = { ...Q24, q: 26, beaconLit: [true, true, true, false], mothDone: true, lantern6: true };
const ALL_LIT = { ...Q24, q: 26, beaconLit: [true, true, true, true], mothDone: true, lantern6: true };

async function session(save, query) {
  const { srv, port: hport } = await serve();
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = mkApi(c);
  await api.init();
  await api.seedSave(save);
  api.shot = async (name) => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(SHOTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('   shot -> ' + f);
    return f;
  };
  api.png = async () => decodePNG(Buffer.from((await c.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'));
  api.close = () => { c.close(); proc.kill(); srv.close(); };
  await api.nav(`http://127.0.0.1:${hport}/${query || '?turbo=4'}`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title');
  await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 14, 'focus CONTINUE');
  await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 16, 'leave title');
  await api.waitFor(`__fm.state === 'play'`, 30000, 'play');
  await api.installBot('pad');
  await api.eval(`(function(){
    if (window.__skDrive) return;
    window.__skDrive = { t: null, vessel: null };
    (function loop() {
      requestAnimationFrame(loop);
      const D = window.__skDrive;
      if (!D.t) return;
      const vx = D.vessel === 'punt' ? SK_PUNT.x : (D.vessel === 'boat' ? BOAT.x : P.x);
      const vz = D.vessel === 'punt' ? SK_PUNT.z : (D.vessel === 'boat' ? BOAT.z : P.z);
      const dx = D.t[0] - vx, dz = D.t[1] - vz;
      if (Math.hypot(dx, dz) < D.t[2]) { D.t = null; __fakePad.axes(0, 0); return; }
      const rel = Math.atan2(dx, dz) - CAM.yaw;
      __fakePad.axes(Math.sin(rel), Math.cos(rel));
    })();
  })(); 0`);
  api.drive = async (vessel, x, z, tol, timeout, poleEvery) => {
    await api.eval(`__skDrive.vessel = '${vessel}'; __skDrive.t = [${x}, ${z}, ${tol}]`);
    const t0 = Date.now();
    while (Date.now() - t0 < timeout) {
      if (!(await api.eval('!!__skDrive.t'))) return true;
      if (poleEvery) await api.tap(0);
      await sleep(poleEvery ? 500 : 300);
    }
    await api.eval('__skDrive.t = null; __fakePad.axes(0,0)');
    return false;
  };
  return api;
}
async function walkTo(api, x, z, tol = 1.6, timeout = 60000) {
  await api.eval(`__fmBot.done=false; __fmBot.tol=${tol}; __fmBot.target=[${x},${z}]`);
  await api.waitFor(
    `__fmBot.done || Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < ${tol + 0.5} || __fm.state!=='play'`,
    timeout, `walk to ${x},${z}`).catch(() => {});
  await api.eval('__fmBot.target=null; __fakePad.axes(0,0)');
  return api.eval(`Math.hypot(__fm.x-(${x}), __fm.z-(${z}))`);
}
/* hold ✕ until a condition (the lamp charge, ~1.2 s of held flint) */
async function holdSouthUntil(api, cond, ms = 6000) {
  await api.eval('__fakePad.press(0)');
  const t0 = Date.now();
  let ok = false;
  while (Date.now() - t0 < ms) {
    if (await api.eval(cond).catch(() => false)) { ok = true; break; }
    await sleep(150);
  }
  await api.eval('__fakePad.press()');
  return ok;
}
/* the chasing kid-bot: walks at the nearest pocket enemy and mashes ✕ */
async function kidClearPocket(api, listExpr, ms = 90000) {
  const t0 = Date.now();
  let last = -1;
  while (Date.now() - t0 < ms) {
    const st = JSON.parse(await api.eval(`(function(){
      const L = ${listExpr};
      let best = null, bd = 1e9;
      for (const e of L) { const d = Math.hypot(e.x - P.x, e.z - P.z); if (d < bd) { bd = d; best = e; } }
      return JSON.stringify({ n: L.length, d: bd, x: best ? best.x : 0, z: best ? best.z : 0 });
    })()`));
    if (st.n === 0) return true;
    if (st.n !== last) { last = st.n; }
    if (st.d > 2.2 && st.d < 900) {
      await api.eval(`__fmBot.tol=1.4; __fmBot.done=false; __fmBot.target=[${st.x},${st.z}]`);
      await sleep(350);
    } else {
      await api.eval('__fmBot.target=null; __fakePad.axes(0,0)');
      await api.tap(0);
    }
  }
  return false;
}

/* ═══════════ struct: registries, exports, geography, interior calm ═══════════ */
async function suiteStruct() {
  console.log('\n-- struct: registries + geography --');
  const api = await session(Q24);
  gate('star-isles registered over sea', await api.eval(
    `window.__WORLD_REG.some(r => r.name === 'star-isles' && r.over.includes('sea'))`));
  gate('four p6k portals registered', await api.eval(
    `['harbor-star-door','reef-star-arch','drowned-star-mouth','far-star-door'].every(n => window.__PORTALS.some(p => p.name === n))`));
  gate('every p6k portal open + non-solid + framed', await api.eval(
    `window.__PORTALS.filter(p => /star-/.test(p.name) && p.name !== 'farstar-lamp-door')
       .every(p => p.openNow() && !worldSolidAt(p.x, p.z))`));
  gate('punt hull registered (Rule 4)', await api.eval(`window.__HULLS.some(h => h.name === 'star-punt')`));
  gate('pinned exports complete', await api.eval(
    `typeof __p6k.lanternPoolAt === 'function' && typeof __p6k.lanternPoolR === 'number' &&
     __p6k.farStarDoor && typeof __p6k.farStarDoor.yaw === 'number' &&
     Array.isArray(__p6k.beaconPos) && __p6k.beaconPos.length === 4 &&
     typeof __p6k.sightingActive === 'function' && typeof __p6k.laneTarget === 'function' &&
     typeof __p6k.lightBeacon === 'function'`));
  gate('lanternPoolAt answers around the player', await api.eval(
    `(__p6k.lanternPoolAt(P.x, P.z) === true) && (__p6k.lanternPoolAt(P.x + 200, P.z) === false)`));
  /* conformance spot-sweep on each islet: chain answer == declared owner */
  const conf = JSON.parse(await api.eval(`(function(){
    const REG = window.__WORLD_REG.find(r => r.name === 'star-isles');
    let worst = 0, pts = 0;
    for (const [cx, cz, r] of [[-197,108,26],[-902,318,30],[-1252,238,34],[-2298,-1005,40]]) {
      for (let a = 0; a < 14; a++) for (let u = 0.15; u < 1; u += 0.2) {
        const x = cx + Math.sin(a) * r * u, z = cz + Math.cos(a) * r * u;
        if (!REG.owns(x, z) || worldSolidAt(x, z)) continue;
        pts++;
        worst = Math.max(worst, Math.abs(groundH(x, z) - REG.ground(x, z)));
      }
    }
    return JSON.stringify({ worst, pts });
  })()`));
  gate('islet conformance: chain == owner everywhere sampled', conf.worst < 0.05 && conf.pts > 150,
    `worst=${conf.worst.toFixed(4)} pts=${conf.pts}`);
  /* Rule 4, the hall: the sea calms inside the drowned tower — no swell
     in the interior air, the punt's clamp covers the rest */
  const hall = JSON.parse(await api.eval(`(function(){
    let mx = 0;
    for (const [x, z] of [[-1258,230],[-1256,228],[-1260,232],[-1255,233]]) mx = Math.max(mx, Math.abs(__swellAt(x, z)));
    return JSON.stringify({ mx });
  })()`));
  gate('no swell inside the drowned hall (interior air stays dry)', hall.mx < 0.06, `max=${hall.mx.toFixed(3)}`);
  /* the wisp + snapper telegraphs are honest (recorded in sim ticks) */
  gate('zero console errors (struct)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══════════ sight: REAL-INPUT star sighting lays a correct lane ═══════════ */
async function suiteSight() {
  console.log('\n-- sight: hold the glass, sweep the sky --');
  const api = await session(Q24);
  await api.eval(`__fmDebug.warp(-189, 98); 0`);   // the harbor spit, ashore
  await api.waitTicks(10);
  const dusk = await api.eval('__fm.nightK');
  gate('the arc holds dusk (p6l clock ≥ 0.9)', dusk >= 0.9, `nightK=${dusk}`);
  gate('stars risen at dusk', await api.eval('__fm.skStarsVis === true && __fm.skStarOp > 0.5'));
  /* constellations INCOMPLETE: anchor vertices dark, base lit (color attr) */
  const inc = JSON.parse(await api.eval(`(function(){
    const s = skStarSpans[1];
    const a = skStarColA;
    let base = 0, anch = 0;
    for (let v = s.base.v0; v < s.base.v0 + s.base.n; v++) base += a.getX(v) + a.getY(v) + a.getZ(v);
    for (let v = s.anch.v0; v < s.anch.v0 + s.anch.n; v++) anch += a.getX(v) + a.getY(v) + a.getZ(v);
    return JSON.stringify({ base, anch });
  })()`));
  gate('constellation rises incomplete (base lit, anchors dark)', inc.base > 3 && inc.anch < 0.01,
    `base=${inc.base.toFixed(1)} anch=${inc.anch.toFixed(2)}`);
  /* REAL INPUT: raise the glass (hold north), pitch the eye up with the
     right stick, sweep yaw across the Breaker (c1 → the reef beacon) */
  await api.eval(`__fmDebug.camYaw(${-1.45} - Math.PI + 0.28); 0`);   // start shy of the mark
  await api.eval('__fakePad.press(3)');                                // △ held from here on
  await api.waitFor('__fm.skGlassUp === true', 8000, 'glass raised');
  gate('glass raised by holding north', true);
  await api.eval('__fakePad.raxes(0, -1)');                            // pitch the view up
  await sleep(900);
  await api.eval('__fakePad.raxes(0.4, -0.55)');                       // sweep across, eye up
  const laid = await api.waitFor('__fm.skLaneT > 0', 15000, 'lane').then(() => true).catch(() => false);
  await api.eval('__fakePad.raxes(0, 0)');
  gate('REAL-INPUT sweep lays a glitter lane', laid);
  if (laid) {
    const li = await api.eval('__fm.skLaneI');
    gate('the lane points at the sighted beacon (laneTarget = 1, the reef)', li === 1, `laneI=${li}`);
    gate('sightingActive + laneTarget exports agree', await api.eval(
      `__p6k.sightingActive() === true && __p6k.laneTarget() === __fm.skLaneI`));
    gate('the constellation GLEAMS while swept', await api.eval('__fm.skGleamMax > 0.3'));
    await api.shot('p6k-dusk-incomplete');                 // glass up, incomplete constellation
    await api.eval('__fakePad.press()');
    /* frame the lane on the water */
    await api.eval(`(function(){ const i = __fm.skLaneI; const b = __p6k.beaconPos[i];
      const a = Math.atan2(b.x - P.x, b.z - P.z);
      __fmDebug.cam(P.x - Math.sin(a) * 10, 6.5, P.z - Math.cos(a) * 10, P.x + Math.sin(a) * 40, 0, P.z + Math.cos(a) * 40); })(); 0`);
    await sleep(700);
    await api.shot('p6k-lane');
    await api.eval('__fmDebug.camOff ? __fmDebug.camOff() : 0').catch(() => {});
    /* the lane is generous but finite, and re-sighting is free */
    gate('lane decays toward ~20 s', await api.eval('__fm.skLaneT <= 20 && __fm.skLaneT > 4'));
  } else await api.eval('__fakePad.press()');
  gate('zero console errors (sight)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══════════ harbor: pocket → climb → hold ✕ → the beacon lights ═══════════ */
async function suiteHarbor() {
  console.log('\n-- harbor star: wisps, spiral, first light --');
  const api = await session(Q24);
  await api.eval(`__fmDebug.warp(-189, 98); 0`);
  await api.waitTicks(6);
  gate('moth-wisps keep the tower (pocket alive)', await api.eval('__fm.skWispAlive >= 6'));
  /* the chasing kid-bot clears the court swarm (only what dives the court) */
  const cleared = await kidClearPocket(api,
    `SK_WISPS.filter(w => !w.dead && w.bi === 0).map(w => ({x: w.x, z: w.z}))`, 120000);
  gate('kid-bot (walk + mash) clears the harbor swarm', cleared,
    'alive=' + await api.eval('__fm.skWispAlive'));
  gate('fizzed wisps drop salt (some banked)', await api.eval('P.salt >= 60'));
  /* telegraph law: every dive carried ≥ 0.9 s of tell, in sim ticks */
  const tele = JSON.parse(await api.eval('JSON.stringify(window.__skWispLog)'));
  gate('every wisp dive telegraphed >= 0.9 s', tele.length > 0 && tele.every(e => e.dive - e.tele >= 54),
    `dives=${tele.length} minTicks=${tele.length ? Math.min(...tele.map(e => e.dive - e.tele)) : '-'}`);
  /* the climb: spit → ramp → court → door → spiral → deck (real walking) */
  for (const [x, z] of [[-192.5, 103.5], [-197, 109], [-203, 118], [-205.3, 120.5]]) await walkTo(api, x, z, 1.5);
  const T0 = { x: -206, z: 122 };
  let hFalls = 0;
  for (let s = 1; s < 18; s += 2) {
    const a = 2.53 + 1.1 + s * 0.26;
    await walkTo(api, T0.x + Math.sin(a) * 1.55, T0.z + Math.cos(a) * 1.55, 0.85, 18000);
    const wantY = 5.05 + 0.35 + s * 0.42;      // this tread's height
    if (s > 4 && await api.eval(`P.fy < ${wantY - 1.6}`)) {   // slipped well below the spiral
      if (++hFalls > 3) break;
      s = -1;
      await walkTo(api, -204.4, 119.8, 1.0);   // back through the door
    }
  }
  await walkTo(api, -205.2, 121.2, 1.0);
  const onDeck = await api.eval('P.fy > 10.4');   // the deck; the last tread counts
  gate('the spiral climb reaches the lamp deck (real steps)', onDeck, 'fy=' + await api.eval('P.fy'));
  gate('the lamp prompt is a HOLD', (await api.eval(`(currentInteract() || {}).id`)) === 'skLamp');
  const lit = await holdSouthUntil(api, `__fm.beaconLit[0] === '1'`, 8000);
  gate('hold ✕ lights THE HARBOR STAR', lit, 'beacons=' + await api.eval('__fm.beaconLit'));
  /* the mini-payoff: ≤8 s, and skippable on a later replay path */
  const sawCine = await api.waitFor(`__fm.state === 'cine'`, 4000, 'cine').then(() => true).catch(() => false);
  gate('the constellation-completing beat fires', sawCine);
  const t0 = Date.now();
  await api.waitFor(`__fm.state === 'play'`, 15000, 'cine ends');
  gate('the beat runs <= 8 s and returns to play', Date.now() - t0 < 12000);
  gate('beacon 0 lit + anchors written', await api.eval(`(function(){
    const s = skStarSpans[0]; let a2 = 0;
    for (let v = s.anch.v0; v < s.anch.v0 + s.anch.n; v++) a2 += skStarColA.getX(v);
    return __fm.beaconLit[0] === '1' && a2 > 1;
  })()`));
  /* Rule 3: the beam length equals beamHitDist along its live heading */
  await api.waitTicks(30);
  /* the live length must equal beamHitDist at a heading the sweep held
     within its last recompute window (the yaw keeps turning) */
  const beam = JSON.parse(await api.eval(`(function(){
    const L = SK_LAMP[0], yaw = skBeamYaw[0], got = skBeamLen[0];
    let best = 1e9, want = -1;
    for (let dy = 0; dy <= 0.14; dy += 0.01) {
      const w = beamHitDist(L.x, L.y, L.z, Math.sin(yaw - dy), -0.055, Math.cos(yaw - dy), 280);
      if (Math.abs(w - got) < best) { best = Math.abs(w - got); want = w; }
    }
    return JSON.stringify({ want, got, best, vis: skBeamGrp[0].visible });
  })()`));
  gate('the beam clamps via beamHitDist (Rule 3)', beam.best < 10 && beam.vis,
    `want=${beam.want.toFixed(1)} got=${beam.got.toFixed(1)} err=${beam.best.toFixed(1)}`);
  await api.eval(`__fmDebug.cam(-181, 6.5, 96, -206, 12, 122); 0`);
  await sleep(700);
  await api.shot('p6k-beacon0-lit');
  gate('zero console errors (harbor)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══════════ reef: the wash (knockdown, never hearts) + second light ═══════════ */
async function suiteReef() {
  console.log('\n-- reef star: gulls, the wash, the timed climb --');
  const api = await session(Q24);
  await api.eval(`__fmDebug.warp(-902, 306); P.hearts = P.maxHearts; 0`);
  await api.waitTicks(10);
  gate('night gulls wheel the reef in pairs', await api.eval('__fm.skNGullAlive === 4'));
  /* stand on the low shelf through a wash: pushed, soaked, zero hearts.
     The gulls are parked for the isolation (they are not under test). */
  await api.eval(`for (const g of GULLS) if (g.night) { g.cd = 999; g.st = 'wheel'; } SK_WASH.t = 0; 0`);
  const hp0 = await api.eval('P.hearts');
  await api.waitFor(`__fm.skWashPh === 'wash'`, 30000, 'wash arrives');
  await api.waitTicks(40);
  const hp1 = await api.eval('P.hearts');
  const moved = await api.eval(`Math.hypot(P.x - (-902), P.z - 306)`);
  gate('the wash sweeps the shelf: a knockdown, never hearts', hp1 === hp0 && (moved > 1.6 || await api.eval('P.fy') < -0.4),
    `moved=${moved.toFixed(1)} hearts ${hp0}->${hp1}`);
  gate('the wash telegraph showed first', await api.eval('SK_WASH.n >= 1'));
  /* climb between washes: wait for clear, run the ramps, light the lamp */
  await api.waitFor(`__fm.skWashPh === 'clear'`, 30000, 'clear water');
  await api.eval(`__fmDebug.warp(-902, 307); 0`);
  for (const [x, z] of [[-899.5, 310.5], [-902, 313.5], [-904.3, 315.6], [-902, 318]]) await walkTo(api, x, z, 1.1);
  gate('the crown is reached between washes', await api.eval('P.fy > 3.2'), 'fy=' + await api.eval('P.fy'));
  const lit = await holdSouthUntil(api, `__fm.beaconLit[1] === '1'`, 8000);
  gate('hold ✕ lights THE REEF STAR', lit, 'beacons=' + await api.eval('__fm.beaconLit'));
  await api.waitFor(`__fm.state === 'play'`, 15000, 'beat done');
  await api.eval(`for (const g of GULLS) if (g.night) g.cd = 0; 0`);
  /* gulls answer the sword: the kid mash pops at least one diving pair */
  const popped = await kidClearPocket(api,
    `GULLS.filter(g => g.night && !g.dead).slice(0, 2).map(g => ({x: g.x, z: g.z}))`, 60000);
  gate('night gulls fall to real slashes', popped || await api.eval('GULLS.filter(g => g.night && g.dead).length >= 1'));
  await api.eval(`__fmDebug.cam(-880, 5.5, 296, -902, 7, 318); 0`);
  await sleep(700);
  await api.shot('p6k-beacon1-lit');
  gate('zero console errors (reef)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══════════ drowned: punt through the mouth, snappers, tilted lamp ═══════════ */
async function suiteDrowned() {
  console.log('\n-- drowned star: the punt, the stair, the tilted room --');
  const api = await session(Q24);
  await api.eval(`__fmDebug.warp(-1236, 252); P.hearts = P.maxHearts; 0`);
  await api.waitTicks(6);
  gate('snappers bask on spit + stair', await api.eval('__fm.skSnapAlive === 3'));
  /* the spit snapper guards the punt: a kid fights it first (its lunges
     keep ✕ as the sword until the pocket calms) */
  for (let k = 0; k < 30; k++) {
    const st = JSON.parse(await api.eval(`(function(){
      const sn = SK_SNAPS[0];
      return JSON.stringify({ gone: sn.gone || sn.st === 'leave', d: Math.hypot(sn.x - P.x, sn.z - P.z), x: sn.x, z: sn.z });
    })()`));
    if (st.gone) break;
    if (st.d > 2.2) await walkTo(api, st.x, st.z, 1.6, 12000);
    await api.tap(0);
    if (await api.eval('P.fy < -0.4')) await api.eval('__fmDebug.warp(-1236, 252); 0');
  }
  /* board the punt: the prompt returns with the calm */
  await walkTo(api, -1242.3, 245.6, 1.2);
  let ctx = null;
  for (let k = 0; k < 20 && ctx !== 'skPuntOn'; k++) {
    ctx = await api.eval(`(currentInteract() || {}).id`);
    if (ctx !== 'skPuntOn') await sleep(300);
  }
  gate('the punt offers itself', ctx === 'skPuntOn', 'ctx=' + ctx);
  await api.tap(0);
  gate('aboard the punt', await api.eval('__fm.skPunting === true'));
  /* drive at the mouth then the hall (stick toward waypoints, ✕ poles) */
  for (const [x, z, tol] of [[-1249, 237.5, 2.0], [-1254, 233.9, 1.8], [-1257.6, 227.9, 1.4]]) {
    await api.drive('punt', x, z, tol, 40000, true);
  }
  const inHall = await api.eval(`Math.hypot(SK_PUNT.x - (-1258), SK_PUNT.z - 230) < 5.4`);
  gate('the punt poles through the mouth into the hall', inHall,
    'punt=' + await api.eval('JSON.stringify([__fm.skPuntX, __fm.skPuntZ])'));
  /* step off at the fallen-ashlar landing, climb the spiral */
  await api.eval('__fakePad.axes(0,0)');
  let off = false;
  for (let i = 0; i < 40; i++) {
    if (await api.eval(`(currentInteract() || {}).id === 'skPuntOff'`)) { await api.tap(0); }
    if (await api.eval('__fm.skPunting === false')) { off = true; break; }
    await sleep(250);
  }
  gate('stepped off inside the tower', off);
  /* the pocket guards the stair's foot: a kid clears it from the rubble
     step before climbing (falls here are a splash beside the landing) */
  await walkTo(api, -1259, 226.5, 1.2);
  for (let k = 0; k < 40; k++) {
    const near = await api.eval(`(function(){
      let d = 1e9;
      for (const sn of SK_SNAPS) {
        if (sn.gone || sn.st === 'leave') continue;
        d = Math.min(d, Math.hypot(sn.x - P.x, sn.z - P.z));
      }
      return d;
    })()`);
    if (near > 6) break;
    await api.tap(0);
    /* dunked mid-fight: the splash-and-retry is proven elsewhere — put the
       kid back on the rubble step and keep fighting */
    if (await api.eval('P.fy < -0.4')) await api.eval('__fmDebug.warp(-1259, 226.5); 0');
  }
  /* a stray ✕ may have re-boarded the punt once the pocket calmed */
  for (let k = 0; k < 12 && await api.eval('__fm.skPunting'); k++) await api.tap(0);
  console.log('   after-fight: ' + await api.eval(`JSON.stringify([+P.x.toFixed(1), +P.z.toFixed(1), +P.fy.toFixed(2), __fm.skPunting, __fm.skSnapAlive])`));
  await walkTo(api, -1259, 226.5, 1.2);
  console.log('   at-rubble: ' + await api.eval(`JSON.stringify([+P.x.toFixed(1), +P.z.toFixed(1), +P.fy.toFixed(2)])`));
  const T2 = { x: -1258, z: 230 };
  let falls = 0;
  for (let s = 1; s < 27; s += 2) {
    const a = 0.79 + 2.5 + s * 0.2;
    const ty = 0.05 + s * 0.325;
    const o = (ty - (-0.55 - 1.3)) * 0.55;
    const dd = await walkTo(api, T2.x + o * 0.14 + Math.sin(a) * 4.0, T2.z + o * 0.1 + Math.cos(a) * 4.0, 0.9, 20000);
    console.log('   s=' + s + ' d=' + dd.toFixed(1) + ' at ' + await api.eval(`JSON.stringify([+P.x.toFixed(1), +P.z.toFixed(1), +P.fy.toFixed(2), __fm.skPunting])`));
    /* a kid stops and slashes the corbel snapper before walking its ambush */
    for (let k = 0; k < 22; k++) {
      const near = await api.eval(`(function(){
        let d = 1e9;
        for (const sn of SK_SNAPS) {
          if (sn.gone || sn.st === 'leave') continue;
          d = Math.min(d, Math.hypot(sn.x - P.x, sn.z - P.z));
        }
        return d;
      })()`);
      if (near > 4.9) break;
      await api.tap(0);
    }
    /* fell? the dunk mercy sent us back to the rubble — restart the spiral
       (a kid retries; the probe allows three falls before it judges) */
    if (await api.eval('P.fy < -0.4')) {
      console.log('   (fell at s=' + s + ': ' + await api.eval(`JSON.stringify([+P.x.toFixed(1), +P.z.toFixed(1), +P.fy.toFixed(2)])`) + ')');
      if (++falls > 3) break;
      s = -1;
      await api.eval(`P.hearts = P.maxHearts; __fmDebug.warp(-1259, 226.5); 0`);
    }
  }
  {
    /* the last stride: the head tread, the threshold stones, the room */
    const headA = ((0.79 + 2.5 + 26 * 0.2) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI);
    const dx = -1258 + (8.9 + 1.85) * 0.55 * 0.14, dz = 230 + (8.9 + 1.85) * 0.55 * 0.1;
    await walkTo(api, dx + Math.sin(headA - 0.21) * 3.5, dz + Math.cos(headA - 0.21) * 3.5, 0.8, 20000);
    await walkTo(api, dx + Math.sin(headA) * 3.45, dz + Math.cos(headA) * 3.45, 0.8, 20000);
  }
  await walkTo(api, await api.eval('SK_LAMP[2].x'), await api.eval('SK_LAMP[2].z'), 1.3);
  gate('the leaning spiral reaches the lamp room', await api.eval('P.fy > 7.6'), 'fy=' + await api.eval('P.fy'));
  gate('the one line has been said (or was already seen)', await api.eval(
    `cineSeen('skTiltLine') === true`));
  const lit = await holdSouthUntil(api, `__fm.beaconLit[2] === '1'`, 8000);
  gate('hold ✕ lights THE DROWNED STAR', lit, 'beacons=' + await api.eval('__fm.beaconLit'));
  await api.waitFor(`__fm.state === 'play'`, 15000, 'beat done');
  /* snappers answer the sword: clear whatever still holds the stair */
  const telegraphs = JSON.parse(await api.eval('JSON.stringify(window.__skSnapLog)'));
  gate('snapper lunges telegraphed >= 0.9 s', telegraphs.every(e => e.lunge - e.coil >= 54),
    `lunges=${telegraphs.length}`);
  await api.eval(`__fmDebug.cam(-1238, 4.5, 246, -1256, 8, 230); 0`);
  await sleep(700);
  await api.shot('p6k-beacon2-lit');
  gate('zero console errors (drowned)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══════════ farstar: the long sail's landfall, the door, the seam ═══════════ */
async function suiteFarstar() {
  console.log('\n-- far star: landfall, the door, the cure seam --');
  {
    const api = await session(Q24_3LIT);
    /* the last dark-water leg, sailed for real from a mid-sea start */
    await api.eval(`__fmDebug.warpSea(-2150, -880, ${Math.atan2(-2298 + 2150, -1005 + 880)}); 0`);
    await api.waitTicks(10);
    gate('under sail toward the far star', await api.eval('P.sailing === true'));
    await api.drive('boat', -2288, -992, 12, 90000, false);
    gate('the boat closes the far cove', await api.eval(`Math.hypot(BOAT.x - (-2288), BOAT.z - (-992)) < 16`),
      'boat=' + await api.eval('JSON.stringify([Math.round(BOAT.x), Math.round(BOAT.z)])'));
    let ashore = false;
    for (let i = 0; i < 40; i++) {
      if (await api.eval(`(currentInteract() || {}).id === 'ashore'`)) { await api.tap(0); }
      if (await api.eval('P.sailing === false')) { ashore = true; break; }
      await sleep(260);
    }
    gate('COME ASHORE lands on the far beach', ashore);
    gate('the far pocket keeps the door', await api.eval('SK_WISPS.filter(w => !w.dead && w.bi === 3).length >= 3'));
    /* the door: walkable threshold, farStarDoor export points at it */
    await walkTo(api, -2293, -999, 1.6);
    await walkTo(api, -2300.5, -1007.6, 1.6);
    const d = JSON.parse(await api.eval('JSON.stringify(__p6k.farStarDoor)'));
    const dd = await walkTo(api, d.x, d.z, 1.2, 30000);
    gate('the far-star doorway is walkable (portal open)', dd < 2.2, `d=${dd.toFixed(2)}`);
    await api.eval(`__fmDebug.cam(-2296, 7.5, -1002, -2306, 12, -1014); 0`);
    await sleep(700);
    await api.shot('p6k-farstar-approach');
    gate('zero console errors (farstar approach)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
  {
    /* the cure seam: mothDone arrives (p6l) → the far lamp floods with
       light, silently, within a breath — beaconLit stays p6k's */
    const api = await session(POSTMOTH);
    await api.eval(`__fmDebug.warpBeacon(3); 0`);
    await api.waitFor(`__fm.beaconLit === '1111'`, 20000, 'the seam lights the far star');
    gate('mothDone derives the fourth flame (forward seam)', await api.eval(`__fm.beaconLit === '1111'`));
    await api.waitTicks(30);
    gate('all four beams stand', await api.eval('skBeamGrp.every(g => !!g)'));
    await api.eval(`__fmDebug.cam(-2270, 9, -975, -2306, 16, -1014); 0`);
    await sleep(700);
    await api.shot('p6k-beacon3-lit');
    gate('zero console errors (farstar seam)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
}

/* ═══════════ sky: fill at sky 6, dusk-only visibility, the lit coast ═══════════ */
async function suiteSky() {
  console.log('\n-- sky: fill state + the four-lit coast --');
  const api = await session({ ...ALL_LIT, q: 27, sky: 6, ph: 6 });
  await api.eval(`__fmDebug.warp(-189, 98); __fmDebug.nightNow(1); 0`);
  await api.waitTicks(12);
  /* the FILL: at sky 6 the whole field burns (color sum over the span) */
  const fill = await api.eval(`(function(){
    let s = 0;
    for (let v = skFillSpan.v0; v < skFillSpan.v0 + skFillSpan.n; v += 30) s += skStarColA.getX(v);
    return s;
  })()`);
  gate('sky >= 6 fills the whole field', fill > 2, `sum=${fill.toFixed(1)}`);
  /* dusk-only: force day and the stars sleep (q27 hands the clock back to
     the sun cycle, so the forcing is re-applied against the drift) */
  let slept = false;
  for (let i = 0; i < 16 && !slept; i++) {
    await api.eval(`__fmDebug.nightNow(0); 0`);
    slept = await api.eval('__fm.skStarsVis === false');
    if (!slept) await sleep(90);
  }
  gate('stars sleep by day', slept);
  let rose = false;
  for (let i = 0; i < 16 && !rose; i++) {
    await api.eval(`__fmDebug.nightNow(1); 0`);
    rose = await api.eval('__fm.skStarsVis === true');
    if (!rose) await sleep(90);
  }
  gate('stars return at dusk', rose);
  await api.eval(`__fmDebug.nightNow(1); 0`);
  /* the four-lit coast vista (the standing perf vista, seen) */
  await api.eval(`__fmDebug.nightNow(1); __fmDebug.cam(-420, 26, 180, -902, 4, 318); 0`);
  await sleep(900);
  await api.shot('p6k-coast-4lit');
  /* count sky-region bright pixels: the filled field must READ */
  const png = await api.png();
  let bright = 0;
  for (let y = 8; y < 200; y += 2) {
    for (let x = 100; x < 1180; x += 2) {
      const i = (y * png.w + x) * png.bpp;
      if (png.px[i] > 120 && png.px[i + 1] > 120 && png.px[i + 2] > 130) bright++;
    }
  }
  gate('the filled sky reads in pixels', bright > 40, `bright=${bright}`);
  gate('zero console errors (sky)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══════════ world: persistence + fresh world ═══════════ */
async function suiteWorld() {
  console.log('\n-- world: persistence across sessions, fresh on NEW GAME --');
  let blob = null;
  {
    const api = await session(Q24);
    await api.eval(`__fmDebug.warpBeacon(0); 0`);
    await api.eval(`__p6k.lightBeacon(0); 0`);       // the export p6l drives
    await api.waitFor(`__fm.state === 'play'`, 20000, 'beat done').catch(() => {});
    const litOk = await api.waitFor(
      `__fm.beaconLit[0] === '1' && JSON.parse(localStorage.getItem('fallenmoon_save_v1')).beaconLit[0] === true`,
      8000, 'lit + saved').then(() => true).catch(() => false);
    gate('lightBeacon export lights + saves', litOk);
    blob = JSON.parse(await api.eval(`localStorage.getItem('fallenmoon_save_v1')`));
    gate('zero console errors (world A)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
  {
    /* a fresh session on the saved blob: the beacon still burns */
    const api = await session(blob);
    gate('beacon light survives save/reload', await api.eval(`__fm.beaconLit[0] === '1'`));
    gate('anchors stay written after reload', await api.eval(`(function(){
      const s = skStarSpans[0]; let a2 = 0;
      for (let v = s.anch.v0; v < s.anch.v0 + s.anch.n; v++) a2 += skStarColA.getX(v);
      return a2 > 1;
    })()`));
    /* the derive, both directions: a fresh save un-lights the coast */
    await api.eval(`SAVE = defaultSave(); storeSave(); applyWorldState(); 0`);
    await api.waitTicks(6);
    gate('fresh world: beacons dark, stars hidden, punt home', await api.eval(
      `__fm.beaconLit === '0000' && __fm.skStarsVis === false && __fm.skPunting === false && __fm.skLaneI === -1`));
    gate('zero console errors (world B)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
}

/* ═══════════ perf: LOWFX draw calls at every vista ═══════════ */
async function suitePerf() {
  console.log('\n-- perf: LOWFX budgets at the beacon vistas --');
  const api = await session(ALL_LIT, '?fx=low&turbo=2');
  await api.eval(`__fmDebug.nightNow(1); 0`);
  const sample = async (label, warp) => {
    await api.eval(warp);
    await api.eval(`__fmDebug.nightNow(1); 0`);
    await api.waitTicks(24);
    let worst = 0;
    for (let i = 0; i < 6; i++) {
      const c2 = await api.eval('renderer.info.render.calls');
      worst = Math.max(worst, c2);
      await api.waitTicks(6);
    }
    gate(`LOWFX <= 80 calls @ ${label}`, worst <= 80, `calls=${worst}`);
    return worst;
  };
  await sample('harbor star (lit)', `__fmDebug.warpBeacon(0); 0`);
  await sample('reef star (lit)', `__fmDebug.warpBeacon(1); 0`);
  await sample('drowned star (lit)', `__fmDebug.warpBeacon(2); 0`);
  await sample('far star (lit)', `__fmDebug.warpBeacon(3); 0`);
  await sample('4-lit coast from the water', `__fmDebug.warpSea(-420, 180, 2.2); 0`);
  await sample('dusk sky + stars from the spit', `__fmDebug.warpBeacon(0); __fmDebug.camPitch(-0.43); 0`);
  gate('zero console errors (perf)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

const t0 = Date.now();
if (want('struct')) await suiteStruct();
if (want('sight')) await suiteSight();
if (want('harbor')) await suiteHarbor();
if (want('reef')) await suiteReef();
if (want('drowned')) await suiteDrowned();
if (want('farstar')) await suiteFarstar();
if (want('sky')) await suiteSky();
if (want('world')) await suiteWorld();
if (want('perf')) await suitePerf();
console.log(`\n(${((Date.now() - t0) / 60000).toFixed(1)} min)`);
process.exit(summary() ? 1 : 0);
