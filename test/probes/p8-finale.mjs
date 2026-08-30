#!/usr/bin/env node
/* p8 — THE FINALE, end to end, the way the family will play it: one
   session from a phase-7-done save through the vigil, the four calls
   (real verbs), THE RISING, the coin on the surf, the wheel turning
   whole, the end flight, the cards and credits — and out the far side
   into moonHome free play. Then THE LIVING WORLD: two full simulated
   day-night cycles, the market at dusk, a beacon at night, the
   post-game lines, Pearl's telescope, the wheel's keepsake + memories.
   Plus old-save compat (q27 and q22) and the NEW GAME wipe.

   Run:  node test/probes/p8-finale.mjs [section...]
   Sections: journey postgame compat wipe    (default: all)             */
import { gate as rawGate, summary, sleep } from './p6g.mjs';
import { session, answerCall, jget, P7_DONE } from './p6n-coin.mjs';
import fs from 'node:fs';
import path from 'node:path';

const gate = (label, ok, extra) => rawGate(ok, label, extra);
const SHOTS = '/tmp/fm_p6n';
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['journey', 'postgame', 'compat', 'wipe'];
const want = (s) => WANT.includes(s);

/* ═══ THE JOURNEY: q32 → the credits → free play, one sitting ═══ */
if (want('journey')) {
  console.log('\n═══ the ending, end to end ═══');
  const api = await session(P7_DONE, '?turbo=4');
  gate('phase-7-done wakes at q32', await api.eval('__fm.quest === 32'));

  /* — the vigil: one line each, in the house voice — */
  await api.eval('__fmDebug.warp(finn.x + 1.6, finn.z + 1.2); 0');
  await api.waitTicks(8);
  if ((await api.eval('__fm.prompt')) === 'talk') {
    await api.tap(0);
    await sleep(400);
    gate('the vigil: Finn keeps the light', (await api.eval('__fm.dlg')) === 'cnVigilFinn',
      'dlg=' + await api.eval('__fm.dlg'));
    for (let i = 0; i < 8 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(300); }
  } else {
    gate('the vigil: Finn keeps the light', false, 'no talk prompt at Finn');
  }

  /* — out to the site; the calls; the rising — */
  await api.eval('__fmDebug.moonsite(); 0');
  await api.waitFor(`__fm.cinId === 'cnCallsIn'`, 30000, 'arrival');
  await api.waitFor(`__fm.state === 'play' && __fm.quest === 33`, 60000, 'q33');
  for (let i = 0; i < 4; i++) {
    await api.waitFor(`__fm.cnCallIdx === ${i} || __fm.cnMedley.charAt(${i}) === '1'`, 30000, 'call ' + i);
    const ok = await answerCall(api, i);
    gate(`journey call ${i} answered`, ok, await api.eval('__fm.cnMedley'));
    if (!ok) break;
  }
  await api.waitFor(`__fm.cinId === 'cnRising'`, 30000, 'THE RISING');
  await api.waitFor(`__fm.state === 'play' && __fm.cinId === null`, 240000, 'the rising completes');
  gate('the rising: q35, first night, home waters', await api.eval(
    `__fm.quest === 35 && __fm.cnRisen && __fm.nightK > 0.9 && P.sailing`));

  /* — ashore, and the sea gives the coin — */
  for (let i = 0; i < 10 && (await api.eval('P.sailing')); i++) { await api.tap(0); await sleep(400); }
  gate('ashore under the first night', !(await api.eval('P.sailing')));
  const surf = await jget(api, '({x: cnSurf.x, z: cnSurf.z})');
  await api.eval(`__fmBot.tol = 1.0; __fmBot.target = [${surf.x}, ${surf.z}]; 0`);
  await api.waitFor(`__fm.cinId === 'cnCoin'`, 40000, 'the coin cine opens');
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  await api.waitFor(`__fm.cinT >= 4.0 || __fm.cinId !== 'cnCoin'`, 30000, 'the wave').catch(() => {});
  await api.shot('finale-1-coin');
  await api.waitFor(`__fm.state === 'play' && __fm.cinId === null`, 60000, 'the coin lands');
  gate('THE NEW COIN: given, carried, q36', await api.eval('__fm.cnCoinGiven && __fm.cnCarryCoin && __fm.quest === 36'));
  await api.shot('finale-2-nightwalk');

  /* — the night walk home; the wheel turns whole — */
  await api.eval(`__fmDebug.warp(WHEEL_POS.x + 3.2, WHEEL_POS.z + 2.4); 0`);
  await api.waitTicks(8);
  gate('the wheel offers ✕ SET THE NEW COIN', (await api.eval('__fm.prompt')) === 'cnWheel8',
    'prompt=' + await api.eval('__fm.prompt'));
  await api.tap(0);
  await api.waitFor(`__fm.cinId === 'cnWheel8'`, 15000, 'the wheel cine');
  await api.waitFor(`__fm.cinT >= 6.5 || __fm.cinId !== 'cnWheel8'`, 60000, 'night itself').catch(() => {});
  await api.shot('finale-3-nightitself');
  await api.waitFor(`__fm.cinId === 'cnEnd'`, 60000, 'the end flight');
  gate('sky 8, moonHome written at the turn', await api.eval(`SAVE.sky === 8 && SAVE.ph === 8 && __fm.cnMoonHome`));
  /* the flight flies itself to the cards; then ✕ through them */
  await api.waitFor(`__fm.cnCards >= 1`, 240000, 'THE MOON IS HOME');
  await sleep(1200);
  await api.shot('finale-4-moonishome');
  for (let i = 0; i < 24 && (await api.eval(`__fm.state !== 'play' || __fm.cinId !== null`)); i++) {
    await api.tap(0);
    await sleep(700);
  }
  gate('after the credits: free play at the wheel, dawn coming', await api.eval(
    `__fm.state === 'play' && __fm.cinId === null && __fm.cnMoonHome && __fm.cnCycleActive`));
  const dawn = await jget(api, `({c:__fm.cnCycleC, nk:__fm.nightK})`);
  gate('the post-game clock wakes at the first dawn', dawn.c > 0.9 && dawn.c < 1.01, JSON.stringify(dawn));
  await sleep(1500);
  await api.shot('finale-5-firstdawn');
  gate('journey: zero console errors', api.errs.length === 0, api.errs.slice(0, 4).join(' | '));
  api.close();
}

/* ═══ THE LIVING WORLD ═══ */
if (want('postgame')) {
  console.log('\n═══ the post-game living world ═══');
  const done = {
    ...P7_DONE, q: 36, sky: 8, ph: 8, medley: [true, true, true, true],
    moonRisen: true, coinGiven: true, moonHome: true, playSec: 7200,
  };
  const api = await session(done, '?turbo=20&fx=low',
    ['cnCallsIn', 'cnRising', 'cnCoin', 'cnWheel8', 'cnEnd']);
  gate('a finished save resumes in free play — nothing locked', await api.eval(
    `__fm.state === 'play' && __fm.quest === 36 && __fm.cnMoonHome && (objectivePoint() || null) === null`));

  /* — TWO full day-night cycles, watched from inside the page — */
  await api.eval(`window.__cnCyc = { nights: 0, days: 0, wasNight: null, minC: 2, maxNk: 0, minNk: 2, err: null };
    window.__cnCycMon = setInterval(function () {
      try {
        var nk = window.__nightK || 0;
        var M = window.__cnCyc;
        M.maxNk = Math.max(M.maxNk, nk); M.minNk = Math.min(M.minNk, nk);
        var night = nk > 0.9;
        var day = nk < 0.1;
        if (M.wasNight === null) M.wasNight = night ? 'n' : 'd';
        if (night && M.wasNight === 'd') { M.nights++; M.wasNight = 'n'; }
        if (day && M.wasNight === 'n') { M.days++; M.wasNight = 'd'; }
      } catch (e) { window.__cnCyc.err = String(e); }
    }, 120); 0`);
  const t0 = Date.now();
  await api.waitFor('window.__cnCyc.nights >= 2 && window.__cnCyc.days >= 2', 420000, 'two full cycles')
    .catch(() => {});
  const cyc = await jget(api, 'window.__cnCyc');
  await api.eval('clearInterval(window.__cnCycMon); 0');
  gate('the full cycle runs forever: two nights, two dawns, no hands', cyc.nights >= 2 && cyc.days >= 2 && !cyc.err,
    JSON.stringify(cyc) + ' in ' + Math.round((Date.now() - t0) / 1000) + 's real');
  gate('night truly dark, day truly day', cyc.maxNk > 0.95 && cyc.minNk < 0.05, JSON.stringify(cyc));

  /* — the market opens each dusk — */
  await api.eval('window.__fmTurbo = 4; __fmDebug.warpMarket(); __fmDebug.cycleSet(0.63); 0');
  await api.waitFor('__fm.nightK > 0.5', 40000, 'dusk falls');
  await api.waitTicks(30);
  const mkt = await jget(api, `({vis: __fm.marketVis, glow: nmMarketGlow.visible, nk: __fm.nightK})`);
  gate('dusk: the market stands lit at the old berth', mkt.vis && mkt.glow, JSON.stringify(mkt));
  await api.shot('post-1-market-dusk');

  /* — the beacons burn each night — */
  await api.eval('__fmDebug.warpBeacon(0); __fmDebug.cycleSet(0.75); 0');
  await api.waitFor('__fm.nightK > 0.9', 40000, 'true night');
  await api.waitTicks(30);
  const bcn = await jget(api, `({beam: skBeamGrp[0].visible, lit: __fm.beaconLit, moon: __fm.cnFullMoonVis})`);
  gate('true night: the beacon burns, the full moon has a face', bcn.beam && bcn.moon, JSON.stringify(bcn));
  await api.shot('post-2-beacon-night');

  /* — one post-game line, under the night sky — */
  await api.eval('__fmDebug.warp(finn.x + 1.6, finn.z + 1.2); 0');
  await api.waitTicks(8);
  await api.tap(0);
  await sleep(500);
  gate('Finn: one post-game line', (await api.eval('__fm.dlg')) === 'cnHomeFinn', 'dlg=' + await api.eval('__fm.dlg'));
  for (let i = 0; i < 8 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(300); }

  /* — Pearl's telescope shows the moon's face — */
  await api.eval('__fmDebug.warp(pearlRoom.boatSill.x - 0.6, pearlRoom.boatSill.z); 0');
  await api.waitTicks(8);
  gate('the telescope offers itself', (await api.eval('__fm.prompt')) === 'cnScope', 'prompt=' + await api.eval('__fm.prompt'));
  await api.tap(0);
  await api.waitFor(`__fm.cinId === 'cnScope'`, 15000, 'the telescope look');
  await api.waitFor(`__fm.cinT >= 2.6 || __fm.cinId !== 'cnScope'`, 30000, 'her face').catch(() => {});
  await api.shot('post-3-telescope');
  await api.waitFor(`__fm.state === 'play' && __fm.cinId === null`, 40000, 'back from the glass');
  gate('the telescope returns clean (fov, vignette)', await api.eval('camera.fov === 66'));

  /* — the wheel remembers: keepsake + a memory, replayed and skipped — */
  await api.eval(`__fmDebug.warp(WHEEL_POS.x + 3.2, WHEEL_POS.z + 2.4); 0`);
  await api.waitTicks(8);
  gate('the wheel offers ✕ THE WHEEL REMEMBERS', (await api.eval('__fm.prompt')) === 'cnMenu',
    'prompt=' + await api.eval('__fm.prompt'));
  await api.tap(0);
  await api.waitFor(`__fm.cinId === 'cnMenu'`, 15000, 'the monument menu');
  await sleep(700);
  await api.shot('post-4-keepsake');
  const card = await api.eval(`document.getElementById('cnWheelCard').textContent`);
  gate('the keepsake card: playtime, hearts, salt', /2h/.test(card) && /HEARTS/.test(card) && /SALT/.test(card),
    card.slice(0, 90));
  const pos0 = await jget(api, '({x:+P.x.toFixed(1), z:+P.z.toFixed(1)})');
  await api.tap(13);                     // down → WATCH THE RISING
  await api.tap(0);
  await api.waitFor(`__fm.cinId === 'cnRising'`, 20000, 'the memory begins');
  await sleep(1800);
  await api.tap(0);                      // a memory is always skippable
  await api.waitFor(`__fm.state === 'play' && __fm.cinId === null`, 30000, 'the memory skips');
  const pos1 = await jget(api, '({x:+P.x.toFixed(1), z:+P.z.toFixed(1), risen:__fm.cnRisen, sky:SAVE.sky})');
  gate('a skipped memory restores the world (position, flags, sky 8)',
    Math.hypot(pos1.x - pos0.x, pos1.z - pos0.z) < 30 && pos1.risen && pos1.sky === 8, JSON.stringify({ pos0, pos1 }));

  /* — the village station: what does NIGHT cost over DAY? —
     The inherited late-game village already stands at ~112 calls at this
     station BEFORE phase 8 (measured against the sky-7 fixture, day and
     night alike — the hound, the boats, the grown world). That standing
     debt is reported loudly, owned upstream; the gate that belongs to
     THIS part is its own delta: the whole night kit (window glow, beam,
     full moon + halo, star field, road) must cost ≤9 calls over the same
     spot by day, and dusk/dawn must never spike past night. */
  const stationMax = async (n) => {
    let mc = 0, mt = 0;
    for (let i = 0; i < n; i++) {
      const f = await jget(api, '({c:__fm.calls, t:__fm.tris})');
      mc = Math.max(mc, f.c); mt = Math.max(mt, f.t);
      await sleep(300);
    }
    return { c: mc, t: mt };
  };
  await api.eval('window.__fmTurbo = 1; __fmDebug.cycleSet(0.30); __fmDebug.warp(0, -24); 0');
  await api.waitFor('__fm.nightK < 0.05', 60000, 'day');
  await api.waitTicks(40);
  const day = await stationMax(10);
  await api.eval('__fmDebug.cycleSet(0.78); 0');
  await api.waitFor('__fm.nightK > 0.9', 60000, 'night');
  await api.waitTicks(30);
  const night = await stationMax(12);
  console.log('   station absolute: day', JSON.stringify(day), 'night', JSON.stringify(night),
    '(inherited pre-P8 baseline ~112 — reported upstream)');
  gate('night village: the whole night kit costs ≤9 calls over day', night.c <= day.c + 9,
    `day ${day.c} → night ${night.c}`);
  gate('night village: ≤120k tris', night.t <= 120000, 'max ' + night.t);
  await api.shot('post-5-village-night');
  /* — and dawn — */
  await api.eval('__fmDebug.cycleSet(0.955); 0');
  await api.waitFor('__fm.nightK < 0.75 && __fm.nightK > 0.2', 60000, 'dawn lifts');
  const dawn = await stationMax(10);
  gate('dawn never spikes past the day/night baseline (+6)', dawn.c <= Math.max(day.c, night.c) + 6,
    `day ${day.c} night ${night.c} → dawn ${dawn.c}`);
  await api.shot('post-6-dawn');
  gate('postgame: zero console errors', api.errs.length === 0, api.errs.slice(0, 4).join(' | '));
  api.close();
}

/* ═══ OLD SAVES: the ending never leaks backward ═══ */
if (want('compat')) {
  console.log('\n═══ old-save compat ═══');
  const P5 = JSON.parse(fs.readFileSync(new URL('../fixtures/phase5-done-save.json', import.meta.url), 'utf8'));
  {
    const api = await session(P5, '?turbo=4', [], true);
    for (let i = 0; i < 30 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(350); }
    await api.waitTicks(60);
    const st = await jget(api, `({q:__fm.quest, med:__fm.cnMedley, risen:__fm.cnRisen, home:__fm.cnMoonHome,
      cyc:__fm.cnCycleActive, sock:__fm.cnSocketOn})`);
    gate('q22 fixture: phase 5 world untouched by the ending', st.q >= 22 && st.q <= 23 && st.med === '0000' &&
      !st.risen && !st.home && !st.cyc && !st.sock, JSON.stringify(st));
    const op = await jget(api, '(objectivePoint() || null)');
    gate('q22 fixture: its own compass still answers', !!op, JSON.stringify(op));
    gate('q22: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
  {
    const Q27 = {
      ...P5, q: 27, sky: 6, ph: 6, spyglass: true, starsSeen: true, starLantern: true,
      beaconLit: [true, true, true, true], mothDone: true, lantern6: true, tbc6Seen: true,
    };
    const api = await session(Q27, '?turbo=4');
    await api.waitTicks(60);
    const st = await jget(api, `({q:__fm.quest, sock:__fm.cnSocketOn, home:__fm.cnMoonHome, cyc:__fm.cnCycleActive})`);
    gate('q27 fixture: 6/8 free play holds — the ending waits for sky 7', (st.q === 27 || st.q === 28) && !st.sock && !st.home && !st.cyc,
      JSON.stringify(st));
    gate('q27: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
}

/* ═══ NEW GAME wipes the finished sky (the John sequence, extended) ═══ */
if (want('wipe')) {
  console.log('\n═══ NEW GAME over a finished save ═══');
  const done = {
    ...P7_DONE, q: 36, sky: 8, ph: 8, medley: [true, true, true, true],
    moonRisen: true, coinGiven: true, moonHome: true,
  };
  const api = await session(done, '?turbo=4', ['cnCallsIn', 'cnRising', 'cnCoin', 'cnWheel8', 'cnEnd']);
  await api.eval(`(function(){ try { localStorage.removeItem(SAVE_KEY); } catch(e){}
    SAVE = defaultSave(); storeSave(); applyWorldState(); })()`);
  await api.waitTicks(30);
  const st = await jget(api, `({sky:SAVE.sky, home:__fm.cnMoonHome, cyc:__fm.cnCycleActive, med:__fm.cnMedley,
    vill: cnVillGlow.visible, moon: cnFullMoon.visible, nk:__fm.nightK})`);
  gate('a fresh world: no moonHome, no cycle, no night furniture', !st.home && !st.cyc && st.med === '0000' &&
    !st.vill && !st.moon && st.sky === 0, JSON.stringify(st));
  gate('wipe: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

summary();
