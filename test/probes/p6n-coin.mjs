#!/usr/bin/env node
/* p6n — THE ENDING's mechanics, gate by gate: the eighth-socket state,
   the four calls each answered by its REAL verb (strike / hold-and-tune /
   press-on-the-surge with the MIRROR-3 early buffer / raise-and-sight),
   20-trial reliability on the rhythm buffer, mid-medley save/reload, and
   the compass answering every ending state.

   Run:  node test/probes/p6n-coin.mjs [section...]
   Sections: smoke calls buffer reload compass   (default: all)          */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, tapUntil, sleep, GAME } from './p6g.mjs';
const gate = (label, ok, extra) => rawGate(ok, label, extra);
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = '/tmp/fm_p6n';
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['smoke', 'calls', 'buffer', 'reload', 'compass'];
const want = (s) => WANT.includes(s);

export const P7_DONE = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'phase7-done-save.json'), 'utf8'));

export async function session(save, query, seen, keepCine) {
  const { srv, port: hport } = await serve();
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = mkApi(c);
  await api.init();
  await api.seedSave(save);
  if (seen && seen.length) await api.seedSeen(seen);
  api.shot = async (name) => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(SHOTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('   shot → ' + f);
    return f;
  };
  api.close = () => { c.close(); proc.kill(); srv.close(); };
  await api.nav(`http://127.0.0.1:${hport}/${query || '?turbo=4'}`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title');
  await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 14, 'focus CONTINUE');
  await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 16, 'leave title');
  await api.waitFor(`__fm.state === 'play' || __fm.state === 'cine'`, 30000, 'play/cine');
  if (!keepCine) {
    for (let i = 0; i < 30 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(350); }
  }
  await api.installBot('pad');
  return api;
}
export const jget = async (api, e) => JSON.parse(await api.eval(`JSON.stringify(${e})`));

/* drive one call by its real verb; the boat is PLACED (setup), the verb
   itself is real input through the pad stub */
export async function answerCall(api, idx) {
  if (idx === 0) {
    /* TONE: park beside the ringing buoy, swing ✕ (the strike verb) */
    for (let round = 0; round < 3; round++) {
      await api.waitFor('__fm.cnCallIdx === 0', 20000, 'tone call live');
      const seq = await api.eval('__fm.cnToneSeq');
      const b = await jget(api, `cnBuoyPos(CN_TONE_ORDER[${seq}])`);
      await api.eval(`BOAT.x = ${b.x + 3}; BOAT.z = ${b.z}; BOAT.spd = 0; P.x = BOAT.x; P.z = BOAT.z; 0`);
      await api.waitTicks(30);            // hear it ring at least once
      for (let k = 0; k < 6; k++) {
        await api.tap(0);
        if ((await api.eval('__fm.cnToneSeq')) > seq || (await api.eval(`__fm.cnMedley[0] === '1'`))) break;
        await sleep(250);
      }
      const done = await api.eval(`__fm.cnMedley.charAt(0) === '1'`);
      if (done) return true;
      if ((await api.eval('__fm.cnToneSeq')) <= seq) return false;
    }
    return api.eval(`__fm.cnMedley.charAt(0) === '1'`);
  }
  if (idx === 1) {
    /* CHORD: hold ✕ and let the rigging walk its pitch through 3 latches */
    await api.eval('BOAT.spd = 0; 0');
    await api.eval('__fakePad.press(0)');
    const ok = await api.waitFor(`__fm.cnMedley.charAt(1) === '1'`, 90000, 'chord latched ×3')
      .then(() => true).catch(() => false);
    await api.eval('__fakePad.press()');
    return ok;
  }
  if (idx === 2) {
    /* RHYTHM: an in-page beat-keeper presses ✕ ON the surge (real input;
       in-page because turbo outruns CDP polls — a frame is not game time) */
    await api.eval(`window.__cnBeat = setInterval(function () {
      try {
        var t = CN_MED.surgeTick % ${'CN_SURGE_T'};
        if (t > 6 && t < 60 && !CN_MED.surgeUsed) {
          __fakePad.press(0);
          setTimeout(function () { __fakePad.press(); }, 50);
        }
      } catch (e) {}
    }, 40); 0`);
    const ok = await api.waitFor(`__fm.cnMedley.charAt(2) === '1'`, 90000, 'three on-beat hits')
      .then(() => true).catch(() => false);
    await api.eval('clearInterval(window.__cnBeat); __fakePad.press(); 0');
    return ok;
  }
  /* SIGHT: aim the follow cam so the raised glass finds the socket, hold △
     (park her first — the rhythm's surges may have walked the hull) */
  await api.eval('BOAT.x = CN_SITE.x + 60; BOAT.z = CN_SITE.z + 40; BOAT.spd = 0; P.x = BOAT.x; P.z = BOAT.z; 0');
  const aim = await jget(api, '({az: cnSockAz, el: cnSockEl})');
  await api.eval(`__fmDebug.camYaw(${aim.az} - Math.PI); __fmDebug.camPitch(-(${aim.el}) / 2.2); 0`);
  /* the raise is HELD in-page (re-asserted, the way a thumb holds it) */
  await api.eval(`window.__cnRaise = setInterval(function () { try { __fakePad.press(3); } catch (e) {} }, 180); 0`);
  const ok = await api.waitFor(`__fm.cnMedley.charAt(3) === '1'`, 60000, 'the socket sighted')
    .then(() => true).catch(() => false);
  await api.eval('clearInterval(window.__cnRaise); __fakePad.press(); 0');
  return ok;
}

/* ═══ SMOKE: the fixture wakes at the eighth socket ═══ */
if (want('smoke')) {
  console.log('\n═══ smoke: phase-7-done wakes into q32 ═══');
  const api = await session(P7_DONE, '?turbo=4');
  const st = await jget(api, `({q:__fm.quest, sky:SAVE.sky, sock:__fm.cnSocketOn, med:__fm.cnMedley,
    call:__fm.cnCallIdx, home:__fm.cnMoonHome, hookErr:__fm.cnHookErr, runs:__fm.cnHookRuns})`);
  gate('load reconcile: sky 7 wakes q32 (MIRROR-6 at load)', st.q === 32, JSON.stringify(st));
  gate('the eighth socket glows; nothing later has fired', st.sock && st.med === '0000' && !st.home, JSON.stringify(st));
  gate('the derive hook ran clean', st.runs > 0 && !st.hookErr, JSON.stringify(st));
  const op = await jget(api, '(objectivePoint() || null)');
  gate('q32 compass: answers (the boat, then the sea road)', !!op && isFinite(op.x), JSON.stringify(op));
  await api.eval(`__fmDebug.warp(WHEEL_POS.x + 5, WHEEL_POS.z + 4); 0`);
  await api.waitTicks(10);
  await api.shot('smoke-1-socket');
  gate('smoke: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ THE CALLS, each by its real verb ═══ */
if (want('calls')) {
  console.log('\n═══ the four calls, real verbs ═══');
  const api = await session(P7_DONE, '?turbo=4');
  await api.eval('__fmDebug.moonsite(); 0');
  await api.waitFor(`__fm.cinId === 'cnCallsIn'`, 30000, 'the arrival cine opens');
  gate('q32 → the sea sings: cnCallsIn auto-opens over the site', true);
  await api.shot('calls-0-arrival');
  await api.waitFor(`__fm.state === 'play' && __fm.quest === 33`, 60000, 'q33 begins');
  gate('q33 set by the arrival', await api.eval('__fm.quest === 33'));
  const names = ['TONE', 'CHORD', 'RHYTHM', 'SIGHT'];
  for (let i = 0; i < 4; i++) {
    await api.waitFor(`__fm.cnCallIdx === ${i} || __fm.cnMedley.charAt(${i}) === '1'`, 30000, names[i] + ' call opens');
    const ok = await answerCall(api, i);
    gate(`call ${i} (${names[i]}) answered by its real verb — the link bursts`, ok,
      JSON.stringify(await jget(api, `({med:__fm.cnMedley, seq:__fm.cnToneSeq, rig:__fm.cnRigNote, hits:__fm.cnSurgeHits, sight:__fm.cnSightT})`)));
    if (i === 1) await api.shot('calls-2-chord');
    if (!ok) break;
  }
  /* the silence, then SHE RISES — the trigger is the medley itself */
  await api.waitFor(`__fm.cinId === 'cnRising'`, 30000, 'THE RISING auto-opens');
  gate('all four answered → the silence → THE RISING', true);
  await api.waitFor(`__fm.cnShot >= 2 || __fm.cinId !== 'cnRising'`, 60000, 'the breach shot');
  await api.shot('calls-3-breach');
  await api.waitFor(`__fm.state === 'play' && __fm.cinId === null`, 180000, 'the rising completes');
  const post = await jget(api, `({q:__fm.quest, risen:__fm.cnRisen, nk:__fm.nightK, bx:+BOAT.x.toFixed(1), bz:+BOAT.z.toFixed(1), sail:P.sailing})`);
  gate('THE RISING lands: moonRisen, q35, THE FIRST NIGHT holds', post.risen && post.q === 35 && post.nk > 0.9, JSON.stringify(post));
  gate('the ride ends at the family moor, still at the helm', post.sail && Math.hypot(post.bx - 8.5, post.bz - 6) < 2, JSON.stringify(post));
  await api.shot('calls-4-firstnight');
  gate('calls: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ THE BUFFER LAW, 20 trials (MIRROR-3, kept honest at the ending) ═══ */
if (want('buffer')) {
  console.log('\n═══ the anticipating player, 20 trials ═══');
  const mid = { ...P7_DONE, q: 33, medley: [true, true, false, false] };
  const api = await session(mid, '?turbo=4', ['cnCallsIn']);
  await api.eval('__fmDebug.moonsite(); 0');
  await api.waitFor('__fm.cnCallIdx === 2', 30000, 'rhythm call live');
  /* 20 EARLY presses, each 10–20 ticks before the surge: every one must
     be buffered and land WITH the water (in-page, sim-tick exact) */
  const r = await api.eval(`(function () {
    return new Promise(function (res) {
      var trials = 0, landed = 0, waiting = false;
      var iv = setInterval(function () {
        try {
          if (trials >= 20) { clearInterval(iv); res({ trials: trials, landed: landed }); return; }
          var t = CN_MED.surgeTick % ${'CN_SURGE_T'};
          if (!waiting && t >= ${'CN_SURGE_T'} - 16 && t < ${'CN_SURGE_T'} - 6) {
            waiting = true;
            var before = CN_MED.surgeHits;
            CN_MED.surgeHits = 0;             /* count each trial alone */
            __fakePad.press(0);
            setTimeout(function () { __fakePad.press(); }, 40);
            var chk = setInterval(function () {
              var t2 = CN_MED.surgeTick % ${'CN_SURGE_T'};
              if (t2 > 50 && t2 < ${'CN_SURGE_W'} + 40) {
                clearInterval(chk);
                trials++;
                if (CN_MED.surgeHits > 0) landed++;
                CN_MED.surgeHits = 0;
                waiting = false;
              }
            }, 25);
          }
        } catch (e) { clearInterval(iv); res({ err: String(e) }); }
      }, 20);
    });
  })()`);
  gate('20/20 early presses buffered into on-beat grips', r && r.trials === 20 && r.landed === 20, JSON.stringify(r));
  gate('buffer: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ MID-MEDLEY RELOAD: the save round-trips every new flag ═══ */
if (want('reload')) {
  console.log('\n═══ mid-medley save / reload ═══');
  const mid = { ...P7_DONE, q: 33, medley: [true, false, false, false] };
  const api = await session(mid, '?turbo=4', ['cnCallsIn']);
  const st = await jget(api, `({q:__fm.quest, med:__fm.cnMedley, call:__fm.cnCallIdx})`);
  gate('a mid-medley save derives its call (link 1 kept, call 1 next)', st.q === 33 && st.med === '1000' && st.call === 1, JSON.stringify(st));
  /* round-trip every phase-8 flag through the REAL storeSave path */
  const rt = await jget(api, `(function () {
    SAVE.medley = [true, true, false, false];
    SAVE.moonRisen = false; SAVE.coinGiven = false; SAVE.moonHome = false;
    SAVE.playSec = 4321;
    storeSave();
    var back = JSON.parse(localStorage.getItem('fallenmoon_save_v1'));
    return { med: back.medley, risen: back.moonRisen, coin: back.coinGiven, home: back.moonHome, sec: back.playSec };
  })()`);
  gate('medley/moonRisen/coinGiven/moonHome/playSec all round-trip', rt.med.join(',') === 'true,true,false,false' && rt.risen === false && rt.coin === false && rt.home === false && rt.sec === 4321, JSON.stringify(rt));
  /* and a full post-game save reloads whole */
  const rt2 = await jget(api, `(function () {
    SAVE.medley = [true, true, true, true];
    SAVE.moonRisen = true; SAVE.coinGiven = true; SAVE.moonHome = true; SAVE.sky = 8; SAVE.ph = 8; SAVE.q = 36;
    storeSave(); applyWorldState();
    return { q: SAVE.q, home: __fm.cnMoonHome, cyc: __fm.cnCycleActive };
  })()`);
  gate('a finished save derives moonHome free play + the live cycle', rt2.q === 36 && rt2.home && rt2.cyc, JSON.stringify(rt2));
  gate('reload: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ COMPASS: every ending state answers, sanely ═══ */
if (want('compass')) {
  console.log('\n═══ the compass, state by state ═══');
  const api = await session(P7_DONE, '?turbo=4', ['cnCallsIn', 'cnRising', 'cnCoin', 'cnWheel8', 'cnEnd']);
  const station = async (label, mut, expectNull) => {
    await api.eval(`(function(){ ${mut}; storeSave(); applyWorldState(); })()`);
    await api.waitTicks(4);
    const op = await jget(api, '(objectivePoint() || null)');
    if (expectNull) gate('compass: ' + label + ' → rests (free play)', op === null, JSON.stringify(op));
    else gate('compass: ' + label + ' answers', !!op && isFinite(op.x) && isFinite(op.z), JSON.stringify(op));
    return op;
  };
  await station('q32 the socket points to sea', 'SAVE.q = 32; SAVE.medley = [false,false,false,false]; SAVE.moonRisen = false; SAVE.coinGiven = false; SAVE.moonHome = false; SAVE.sky = 7; SAVE.ph = 7', false);
  await station('q33 mid-medley ashore (back to the boat)', 'SAVE.q = 33; SAVE.medley = [true,true,false,false]', false);
  await station('q34 answered-but-unrisen (back to the site)', 'SAVE.q = 34; SAVE.medley = [true,true,true,true]', false);
  await station('q35 the coin waits on the surf', 'SAVE.q = 35; SAVE.moonRisen = true', false);
  await station('q36 the wheel wants its coin', 'SAVE.q = 36; SAVE.coinGiven = true', false);
  await station('post-game idle (the pulse still finds a far boat)', 'SAVE.q = 36; SAVE.sky = 8; SAVE.ph = 8; SAVE.moonHome = true', true);
  /* MIRROR-7: null objective + far boat → the pulse aims at her */
  await api.eval(`BOAT.x = -400; BOAT.z = 100; SAVE.boatX = -400; SAVE.boatZ = 100; __fmDebug.warp(8, 7); 0`);
  await api.waitTicks(6);
  const pulse = await jget(api, `(function(){ var o = objectivePoint(); var far = Math.hypot(BOAT.x - P.x, BOAT.z - P.z) > 120; return { o: o, far: far }; })()`);
  gate('MIRROR-7: free play, boat far — objective null, pulse target live', pulse.o === null && pulse.far, JSON.stringify(pulse));
  gate('compass: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

summary();
