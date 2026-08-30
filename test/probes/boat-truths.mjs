#!/usr/bin/env node
// BOAT TRUTHS — the four boat laws John hit live (8/30), as permanent gates.
//   A. THE STRAND RULE: wading with the boat across unwadeable water and NO
//      dunk event → she comes to your shore anyway (a rule, not a gate).
//   B. SAVE ROUND-TRIP: the boat is saved where she floats; a reload puts
//      her (and you, at the helm) back exactly there.
//   C. MOVING HULL (full fx): zero water-through-deck frames at full paddle
//      speed over open swell. (The LOWFX twin lives in the rules suite.)
//   D. RIVER TRUTHS: a hull floats on the LOCAL water surface — moored-in-
//      reach resume floats her, the upstream sail never submarines, the
//      first-ford limit holds with its caption, and the descent through the
//      mouth never pops.
import { serve, launchChrome, pageSession, mkApi, continueIn, gate, summary, sleep, P4_START, GAME } from '/Users/johnstephens/Developer/stephensgames/fallenmoon/test/probes/p6g.mjs';
import fs from 'node:fs';

const P5 = JSON.parse(fs.readFileSync(GAME + '/test/fixtures/phase5-done-save.json', 'utf8'));
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;

/* ═══ A + B — the strand rule, and the save that follows her ═══ */
{
  const { proc, port } = await launchChrome();
  const c = await pageSession(port); const api = mkApi(c);
  await api.init();
  await api.seedSave({ ...P4_START, sky: 4, ph: 4, q: 19, mouthOpen: true, sluiceG: 3,
    swingKeel: true, paddleWheel: true, lastPos: [64, 0] });
  await api.nav(base + '/?turbo=2');
  await continueIn(api);
  // boat across the deep strip; player WADING on a shoal — and NO dunk ever fires
  await api.eval('BOAT.x = 78; BOAT.z = 16; BOAT.spd = 0; sailboat.group.position.set(BOAT.x, WL - 0.18, BOAT.z); 0');
  const spot = JSON.parse(await api.eval(`(function(){
    for (let a = 0; a < 64; a++) {
      for (let r = 8; r < 40; r += 1.2) {
        const x = 78 + Math.sin(a * 0.0982) * r, z = 16 + Math.cos(a * 0.0982) * r;
        const d = waterDepthAt(x, z);
        if (d < 0.08 || d > 0.24 || worldSolidAt(x, z)) continue;
        const bd = Math.hypot(x - 78, z - 16);
        if (bd < 8 || bd > 40) continue;
        let deep = false;
        for (let s = 2; s < bd - 2; s += 1.2) {
          if (waterDepthAt(x + (78 - x) / bd * s, z + (16 - z) / bd * s) > 0.7) { deep = true; break; }
        }
        if (deep) return JSON.stringify([+x.toFixed(1), +z.toFixed(1), +d.toFixed(2), +bd.toFixed(1)]);
      }
    }
    return JSON.stringify(null); })()`));
  gate(!!spot, 'A: found a wading shoal with unwadeable water to the boat', JSON.stringify(spot));
  await api.eval(`__fmDebug.warp(${spot[0]}, ${spot[1]}); lastDry[0] = ${spot[0]}; lastDry[1] = ${spot[1]}; 0`);
  let came = false;
  for (let i = 0; i < 30; i++) {                         // ≤ ~13.5 s wall, turbo 2
    await sleep(450);
    if (await api.eval('Math.hypot(__fm.x - BOAT.x, __fm.z - BOAT.z) < 13')) { came = true; break; }
  }
  const A = JSON.parse(await api.eval(`JSON.stringify({
    px: +__fm.x.toFixed(1), pz: +__fm.z.toFixed(1),
    bx: +BOAT.x.toFixed(1), bz: +BOAT.z.toFixed(1),
    d: +Math.hypot(__fm.x - BOAT.x, __fm.z - BOAT.z).toFixed(1),
    depth: +waterDepthAt(BOAT.x, BOAT.z).toFixed(2),
    cap: (typeof floatEl !== 'undefined') ? floatEl.textContent : '' })`));
  gate(came && A.depth >= 0.85, 'A: the strand RULE brought her to the shoal (no dunk fired)', JSON.stringify(A));
  gate(Math.abs(A.px - spot[0]) < 1 && Math.abs(A.pz - spot[1]) < 1,
    'A: the player never moved — this was the rule, not the dunk bounce', `at (${A.px},${A.pz})`);
  gate(/noses over/.test(A.cap), 'A: the rescue speaks once', JSON.stringify(A.cap));
  const persisted = JSON.parse(await api.eval(`localStorage.getItem('fallenmoon_save_v1')`));
  gate(Math.abs(persisted.boatX - A.bx) < 0.6 && Math.abs(persisted.boatZ - A.bz) < 0.6,
    'B: the rescue position is already in the save', `save (${persisted.boatX},${persisted.boatZ})`);
  await api.shot('bt-A-strand-rescue');

  /* B: quit at the helm mid-sea → resume at the helm, boat exactly there */
  await api.eval('__fmDebug.warpSea(-420, -100, -2.1); 0');
  await api.eval('__fakePad.axes(0,-1); __fakePad.press(1); 0');
  await sleep(2600);
  await api.eval('__fakePad.press(); __fakePad.axes(0,0); 0');
  await api.waitFor('BOAT.spd < 0.5', 20000, 'boat coasts to a stop');
  // the save CONVERGES to the resting boat within a cadence cycle or two
  await api.waitFor(`(function(){ try {
    const s = JSON.parse(localStorage.getItem('fallenmoon_save_v1'));
    return Math.hypot(s.boatX - BOAT.x, s.boatZ - BOAT.z) < 2;
  } catch (e) { return false; } })()`, 12000, 'save converges to the resting boat');
  const atQuit = JSON.parse(await api.eval('JSON.stringify([+BOAT.x.toFixed(1), +BOAT.z.toFixed(1)])'));
  const blob = JSON.parse(await api.eval(`localStorage.getItem('fallenmoon_save_v1')`));
  gate(Math.hypot(blob.boatX - atQuit[0], blob.boatZ - atQuit[1]) < 2,
    'B: the resting boat is in the save', `save (${blob.boatX.toFixed(1)},${blob.boatZ.toFixed(1)}) vs live (${atQuit})`);
  await api.seedSave(blob);                              // last seed wins on reload
  await api.nav(base + '/?turbo=2');
  await continueIn(api);
  const B = JSON.parse(await api.eval('JSON.stringify({ sail: !!P.sailing, bx: +BOAT.x.toFixed(1), bz: +BOAT.z.toFixed(1) })'));
  gate(B.sail && Math.hypot(B.bx - blob.boatX, B.bz - blob.boatZ) < 2,
    'B: reload resumes at the helm, boat where she was', JSON.stringify(B));
  gate(api.errs.length === 0, 'A/B: zero console errors', api.errs.slice(0, 3).join(' | '));
  c.close(); proc.kill();
}

/* ═══ C — the moving hull at full fx ═══ */
{
  const { proc, port } = await launchChrome();
  const c = await pageSession(port); const api = mkApi(c);
  await api.init();
  await api.seedSave(P5);
  await api.nav(base + '/');
  await continueIn(api);
  await api.eval('__fmDebug.warpSea(-1150, -120, -Math.PI / 2 + 0.3); 0');
  await sleep(700);
  await api.eval('__fakePad.axes(0,-1); __fakePad.press(1); 0');
  await api.eval(`window.__mv = { n: 0, frames: 0, casts: 0, teeth: 0, worst: -99, spdMax: 0 };
    (function m() {
      const W = window.__mv; if (!W) return;
      W.frames++; W.spdMax = Math.max(W.spdMax, BOAT.spd);
      const q = sailboat.group.quaternion, gp = sailboat.group.position;
      const rc = new THREE.Raycaster(); const v = new THREE.Vector3();
      const tiers = [];
      if (waveMesh.visible) tiers.push(waveMesh);
      if (farSeaMesh.visible) tiers.push(farSeaMesh);
      for (const [bx, fw] of [[0,3.0],[0,1.6],[0,0],[0,-1.6],[0,-2.6],[0.9,1.2],[-0.9,1.2],[0.9,-1.2],[-0.9,-1.2]]) {
        v.set(bx, 0.48, fw).applyQuaternion(q).add(gp);
        const ly = v.y;
        for (const t of tiers) {
          rc.set(new THREE.Vector3(v.x, WL + 30, v.z), new THREE.Vector3(0, -1, 0));
          const hits = rc.intersectObject(t, false);
          if (!hits.length) continue;
          W.casts++;
          const y = WL + 30 - hits[0].distance;
          if (y > ly + 0.02) { W.n++; if (y - ly > W.worst) W.worst = y - ly; }
        }
      }
      if (WL - 0.55 > gp.y + 0.04) W.teeth++;
      requestAnimationFrame(m);
    })(); 0`);
  await sleep(9000);
  await api.shot('bt-C-full-paddle');
  await api.eval('__fakePad.press(); __fakePad.axes(0,0); 0');
  const Cv = JSON.parse(await api.eval('JSON.stringify(__mv)'));
  gate(Cv.n === 0 && Cv.casts > 2000 && Cv.spdMax > 12,
    'C: zero breaches at full paddle speed (full fx)',
    `viol=${Cv.n} worst=+${Cv.worst.toFixed(2)} casts=${Cv.casts} spdMax=${Cv.spdMax.toFixed(1)}`);
  gate(Cv.teeth > 12, 'C: she rode troughs the old far sheet cut through', `teeth=${Cv.teeth}/${Cv.frames}`);
  gate(api.errs.length === 0, 'C: zero console errors', api.errs.slice(0, 3).join(' | '));
  c.close(); proc.kill();
}

/* ═══ D — river truths ═══ */
{
  const { proc, port } = await launchChrome();
  const c = await pageSession(port); const api = mkApi(c);
  await api.init();
  // John's exact live spot: moored in the upper reach, resumed nearby
  await api.seedSave({ ...P5, boatX: 382.8, boatZ: 124.4, boatAng: 1.2, lastPos: [376, 120], region: 'forest' });
  await api.nav(base + '/?fx=low');
  await continueIn(api);
  await sleep(900);
  const D1 = JSON.parse(await api.eval(`JSON.stringify({
    groupY: +sailboat.group.position.y.toFixed(2),
    surf: +riverSurfaceAt(BOAT.x, BOAT.z).toFixed(2),
    dy: +moBoatDy.toFixed(2) })`));
  gate(D1.groupY + 0.04 > D1.surf - 0.3 && D1.dy > 1.2,
    'D1: moored-in-reach resume floats her on the RIVER surface', JSON.stringify(D1));
  await api.shot('bt-D1-river-moored');
  // upstream at full paddle: no submarine frames, and the ford limit holds
  await api.eval('__fmDebug.warpSea(360, 100, 0.5); 0');
  await sleep(600);
  await api.eval('__fakePad.axes(0,-1); __fakePad.press(1); 0');
  await api.eval(`window.__rv = { frames: 0, sub: 0, minMargin: 99, maxDy: 0 };
    (function m() {
      const D = window.__rv; if (!D) return; D.frames++;
      const s = moBoatWaterY();
      const mg = (sailboat.group.position.y + 0.04) - s;
      if (mg < D.minMargin) D.minMargin = mg;
      if (mg < -0.30) D.sub++;
      requestAnimationFrame(m);
    })(); 0`);
  await sleep(12000);
  const D2 = JSON.parse(await api.eval(`JSON.stringify({ rv: __rv, said: !!moFordSaid,
    runD: (function(){ const r = runNear(BOAT.x, BOAT.z); return +(r.s.d + r.along).toFixed(0); })(),
    cap: (typeof floatEl !== 'undefined') ? floatEl.textContent : '' })`));
  gate(D2.rv.sub === 0, 'D2: she never submarines sailing the reach', `minMargin=${D2.rv.minMargin.toFixed(2)} over ${D2.rv.frames}f`);
  gate(D2.runD <= 145, 'D2: the first-ford limit holds at full paddle', `runD=${D2.runD} (limit 142)`);
  gate(D2.said, 'D2: the too-broad-for-white-water caption spoke', JSON.stringify(D2.cap));
  await api.shot('bt-D2-ford-limit');
  // the descent: turn around at the ford and ride the whole run home —
  // upper river → the sluice head → reaches → rapids → glide → mouth pool
  // → the bay. The throttle is real held input; waypoints along the
  // river's own spines steer her (steering is not the mechanic under
  // test — the surface hand-off is). Assert: never submarines, never
  // pops, ends riding sea level in the bay.
  await api.eval(`__rv = null;
    __fmDebug.warpSea(BOAT.x, BOAT.z, Math.atan2(340 - BOAT.x, 102 - BOAT.z));
    window.__wps = (function(){
      /* down the upper river, through the HEAD SPILL's surveyed deep lane
         into the head pool, THROUGH the three sluice-gate notches, then
         the run's own spine to the pool and out to the bay */
      const w = [[340, 102], [320, 92], [300, 80], [290, 72], [285, 69.5],
                 [281.5, 67.3], [278, 65.3], [274, 63.4]];
      for (const g of S_GATES) {
        w.push([g.x + g.fx * -4, g.z + g.fz * -4]);   // line up on the notch
        w.push([g.x + g.fx * 4, g.z + g.fz * 4]);     // and through it
      }
      for (let s = 44; s <= LR_LEN; s += 16) { const p = lrPointAt(s); w.push([p.x, p.z]); }
      w.push([86, 36], [46, 24]);
      return w;
    })(); 0`);
  await sleep(600);
  await api.eval('__fakePad.axes(0,-1); 0');          // plain sail down — read the water, not the wheel
  await api.eval(`window.__dv = { frames: 0, sub: 0, maxStep: 0, lastY: null, minX: 999, y0: +sailboat.group.position.y.toFixed(2), stall: 0, sx: 0, sz: 0, skips: 0 };
    (function m() {
      const D = window.__dv; if (!D) return; D.frames++;
      const W = window.__wps;
      while (W.length && Math.hypot(BOAT.x - W[0][0], BOAT.z - W[0][1]) < 4.5) W.shift();
      /* a stalled pilot picks a new line (exactly what a player does when
         the set lifts her off a bar) — skip the waypoint she cannot make */
      if (Math.hypot(BOAT.x - D.sx, BOAT.z - D.sz) < 1.5) { D.stall++; } else { D.stall = 0; D.sx = BOAT.x; D.sz = BOAT.z; }
      if (D.stall > 240 && W.length > 1) { W.shift(); D.stall = 0; D.skips++; }
      if (W.length) BOAT.ang = Math.atan2(W[0][0] - BOAT.x, W[0][1] - BOAT.z);
      const gy = sailboat.group.position.y;
      if (D.lastY !== null) D.maxStep = Math.max(D.maxStep, Math.abs(gy - D.lastY));
      D.lastY = gy;
      D.minX = Math.min(D.minX, BOAT.x);
      const mg = (gy + 0.04) - moBoatWaterY();
      if (mg < -0.30) D.sub++;
      requestAnimationFrame(m);
    })(); 0`);
  await api.waitFor('BOAT.x < 100 || __dv.frames > 5200', 95000, 'descent run').catch(() => {});
  await api.eval('__fakePad.press(); __fakePad.axes(0,0); 0');
  const D3 = JSON.parse(await api.eval('JSON.stringify({ dv: __dv, gy: +sailboat.group.position.y.toFixed(2), bx: +BOAT.x.toFixed(0), bz: +BOAT.z.toFixed(0), wpsLeft: __wps.length })'));
  gate(D3.dv.sub === 0 && D3.dv.maxStep < 0.35,
    'D3: the descent never pops or submarines',
    `maxStep=${D3.dv.maxStep.toFixed(2)} sub=${D3.dv.sub} from y=${D3.dv.y0} to y=${D3.gy}`);
  gate(D3.bx < 100 && D3.gy < -0.5,
    'D3: she rode the whole run down and sits at sea level in the bay',
    `at (${D3.bx},${D3.bz}) y=${D3.gy} wpsLeft=${D3.wpsLeft}`);
  await api.shot('bt-D3-descent');
  gate(api.errs.length === 0, 'D: zero console errors', api.errs.slice(0, 3).join(' | '));
  c.close(); proc.kill();
}

srv.close();
process.exit(summary() ? 1 : 0);
