#!/usr/bin/env node
/* FM-SWEEP-A — COMBAT & BOSS LAW back-ports.
   Every gate here is a fix from the sweep audit, driven through the REAL
   player path (fake pad + the in-page bot) and asserted in SIM TICKS —
   a frame is not game time, so the timing-critical dodges are armed by
   in-page monitors that press the pad, never by CDP polling.

   — TELEGRAPHS: every reworked hostile's windup ≥ 54 ticks (0.9 s), read
     out of window.__fmTele, which the entities themselves stamp;
   — the ROAR never refunds HP (crab / wyrm / tortoise / stag);
   — the king-crab slam COMMITS at 60%, marks the ground, and is both
     walkable-out-of and jumpable;
   — the tortoise shockwave ring is clearable with one standing jump;
   — swinging at the buried Wyrm's wake CHIPS (1) instead of doing nothing,
     and wyrmStrikeable tells the truth about the exposed set;
   — the moth's wing-gust physically SHOVES (> 1.5 m) and costs no hearts;
   — the Kiln Hound's caldera has a real gateway (walk out → re-armed at
     phase) and its OWN faint anchor at the mouth;
   — no phantom beacon orb inside the Wyrm / Tortoise arenas.

   Run:  node test/probes/sweep-a-combat.mjs [section...]
   Sections: crab wyrm tort stag moth hound hornet                        */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, sleep, GAME, P4_CROWN }
  from './p6g.mjs';
import fs from 'node:fs';
import path from 'node:path';

const gate = (label, ok, extra) => rawGate(ok, label, extra);
const SHOTS = '/tmp/fm_sweepA';
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2)
  : ['crab', 'wyrm', 'tort', 'stag', 'moth', 'hound', 'hornet'];
const want = (s) => WANT.includes(s);

const fx = (n) => JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', n), 'utf8'));
const FAMILY_Q4 = fx('family-q4-save.json');
const PHASE5_DONE = fx('phase5-done-save.json');
const PHASE6_DONE = fx('phase6-done-save.json');

const BOSS_READY = {
  v: 2, q: 2, ph: 0, mh: 8, sword: true, salt: 0,
  talked: { finn: 1, tock: 1, pearl: 1 },
  kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: true,
  bossDone: false, sky: 0, tidepool: false, lastShade: [8, 6],
};
const WYRM_READY = { ...FAMILY_Q4, basinOpen: true, glyph1: true, glyph2: true, lastShade: [1958, 1216] };
const FLOODED = {
  ...FAMILY_Q4, basinOpen: true, glyph1: true, glyph2: true, wyrmDone: true,
  q: 6, ph: 2, sky: 2, floodSeen: true, voyageDone: true, sailedOnce: true,
  region: 'bay', lastShade: [4, -2],
};
const ISLES_SOLVED = {
  ...FLOODED, q: 10, keelFound: true, keelCarried: false, boatRefit: true,
  moonSeen: true, isleLandfall: true, watchBell: true, tbc2Seen: true,
  fGlyph1: true, fGlyph2: true, fGlyph3: true,
};
const HOUND_READY = { ...PHASE6_DONE, q: 29, emberSeen: true,
  lastPos: [-1150, -985], lastShade: [-1157, -992], boatX: -1146, boatZ: -970, boatAng: 0.2 };

/* ── one session, one Chrome ── */
async function session(save, query, seen) {
  const { srv, port: hport } = await serve();
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = mkApi(c);
  await api.init();
  await api.seedSave(save);
  if (seen && seen.length) await api.seedSeen(seen);
  api.shot = async (name) => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('   shot → ' + path.join(SHOTS, name + '.png'));
  };
  api.close = () => { c.close(); proc.kill(); srv.close(); };
  await api.nav(`http://127.0.0.1:${hport}/${query || '?turbo=6'}`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title');
  for (let i = 0; i < 30; i++) {
    const st = await api.eval('__fm.state');
    if (st === 'play') break;
    if (st === 'title' && !(await api.eval('__fm.titleFocus === 1'))) { await api.tap(13); continue; }
    await api.tap(0);
    await sleep(380);
  }
  await api.waitFor(`__fm.state === 'play'`, 60000, 'playing');
  await api.installBot('pad');
  await api.eval(`window.__topUp = setInterval(function(){
    try { if (__fm.state === 'play') P.hearts = P.maxHearts; } catch (e) {} }, 80); 0`);
  return api;
}
const jget = (api, expr) => api.eval(`JSON.stringify(${expr})`).then(JSON.parse);
/* every recorded windup for `who`, in SIM TICKS */
const tele = (api, who) =>
  jget(api, `window.__fmTele.filter(e => e.who === ${JSON.stringify(who)}).map(e => e.ticks)`);
const teleGate = async (api, who, label, minSamples = 1) => {
  const t = await tele(api, who);
  gate(`${label}: every windup ≥ 54 ticks (0.9 s), sim-tick exact`,
    t.length >= minSamples && t.every(v => v >= 54),
    `${t.length} samples, min=${t.length ? Math.min(...t) : '—'} ticks`);
  return t;
};

/* ═══════════════════ THE KING-CRAB ═══════════════════ */
if (want('crab')) {
  console.log('\n═══ the King-Crab: telegraph, commitment, dodge ═══');
  const api = await session(BOSS_READY, '?turbo=6');
  try {
    /* ── scorch crabs + sun imps on the way to the arena ── */
    await api.eval(`__fmDebug.warp(38, 108); P.hearts = P.maxHearts; 0`);
    for (let i = 0; i < 70; i++) {
      const nc = (await tele(api, 'scorchCrab')).length, nw = (await tele(api, 'sunImp')).length;
      if (nc >= 3 && nw >= 3) break;
      const pick = nc <= nw ? 'c || w' : 'w || c';
      await api.eval(`(function(){
        const c = crabs.find(c => !c.dead);
        const w = wisps.find(w => !w.dead && w.area !== 'boss');
        const o = ${pick};
        if (o) { P.x = o.x + 2.4; P.z = o.z; P.fy = groundH(P.x, P.z);
                 if (o.lungeCD !== undefined) o.lungeCD = 0; }
        return 0; })()`);
      await sleep(420);
    }
    await teleGate(api, 'scorchCrab', 'scorch crab lunge', 3);
    await teleGate(api, 'sunImp', 'sun imp dive', 3);

    /* ── the arena ── */
    await api.eval(`__fmDebug.warp(56, 163); P.hearts = P.maxHearts; 0`);
    await api.waitFor('__fm.bossActive === true', 30000, 'boss wakes');
    gate('king-crab: proximity wakes it, phase one, HP 90',
      await api.eval('__fm.bossPhase === 1 && __fm.bossHp === 90'));

    /* THE SLAM. One in-page monitor at sim resolution: the moment the claws
       go up it walks her away with the bot (what a player actually does),
       measures the post-commit drift of the mark, and scores the impact.
       `mode` picks the behaviour under test — WALK (must escape) or STAND
       (must still be punished, or the slam is toothless). */
    const slamRun = async (mode, n) => {
      await api.eval(`window.__slam = { tries: 0, clean: 0, hit: 0, markSeen: false,
          drift: -1, frozen: null, armed: false, h0: 0, prev: '', mode: ${JSON.stringify(mode)} };
        (function w(){
          if (window.__slam === undefined) return;
          requestAnimationFrame(w);
          const S = window.__slam, st = BOSS.st;
          if (st === 'slamTele') {
            if (BOSS.mark && BOSS.mark.visible) S.markSeen = true;
            if (BOSS.t >= BOSS_SLAM_TELE * 0.6) {
              if (!S.frozen) S.frozen = [BOSS.slamPos[0], BOSS.slamPos[1]];
              else S.drift = Math.max(S.drift, Math.hypot(BOSS.slamPos[0] - S.frozen[0],
                                                          BOSS.slamPos[1] - S.frozen[1]));
            }
            if (!S.armed) {
              S.armed = true; S.h0 = P.hearts;
              if (S.mode === 'walk') {
                const dx = P.x - BOSS.x, dz = P.z - BOSS.z, d = Math.hypot(dx, dz) || 1;
                window.__fmBot.tol = 0.2; window.__fmBot.noWiggle = true;
                window.__fmBot.target = [P.x + dx / d * 9, P.z + dz / d * 9];
              } else { window.__fmBot.target = null; window.__fakePad.axes(0, 0); }
            }
          } else if (S.prev === 'slamTele') {
            if (S.armed) {
              S.tries++;
              if (P.hearts >= S.h0) S.clean++; else S.hit++;
            }
            S.armed = false; S.frozen = null;
            window.__fmBot.target = null; window.__fakePad.axes(0, 0);
          }
          S.prev = st;
        })(); 0`);
      for (let i = 0; i < 120; i++) {
        const s = await jget(api, 'window.__slam');
        if (s.tries >= n) break;
        if (!s.armed) {
          /* face the crab and point the camera at it: a source the camera
             cannot see may never deal damage (the dmg-vis law), and a probe
             that forgets it is testing culling, not the slam */
          await api.eval(`if (BOSS.st === 'track') { P.x = BOSS.x + 4.4; P.z = BOSS.z;
            P.fy = groundH(P.x, P.z); P.hearts = P.maxHearts; P.iframes = 0;
            const a = Math.atan2(BOSS.x - P.x, BOSS.z - P.z);
            __fmDebug.face(a); __fmDebug.camYaw(a + Math.PI); } 0`);
        }
        await sleep(300);
      }
      const s = await jget(api, 'window.__slam');
      await api.eval('window.__slam = undefined; window.__fmBot.release(); 0');
      return s;
    };
    /* the top-up would mask the STAND case, so hearts are managed per attempt */
    await api.eval('clearInterval(window.__topUp); 0');
    const walked = await slamRun('walk', 6);
    await teleGate(api, 'kingCrabSlam', 'king-crab slam', 2);
    gate('king-crab: the slam point FREEZES after 60% of the windup — it commits',
      walked.drift >= 0 && walked.drift < 0.01, 'max drift after commit = ' + walked.drift.toFixed(4) + ' m');
    gate('king-crab: a baked ground RING marks the committed strike point', walked.markSeen === true);
    gate('king-crab: walking away when the claws go up ESCAPES the slam (≥5 clean)',
      walked.clean >= 5, `${walked.clean} clean / ${walked.hit} caught of ${walked.tries}`);
    const stood = await slamRun('stand', 4);
    gate('king-crab: and standing still under it still costs a heart — not toothless',
      stood.hit >= 3, `${stood.hit} caught of ${stood.tries}`);

    /* THE JUMP: standing ON the mark, a timed □ still clears it */
    await api.eval(`window.__slam = undefined;
      window.__jmp = { tries: 0, clean: 0, armed: false, prev: '', h0: 0 };
      (function w(){
        if (window.__jmp === undefined) return;
        requestAnimationFrame(w);
        const J = window.__jmp, st = BOSS.st;
        if (st === 'slamTele') {
          /* stand her ON the mark, then jump on the last third of the windup */
          if (!J.armed) { P.x = BOSS.slamPos[0]; P.z = BOSS.slamPos[1]; P.fy = groundH(P.x, P.z); }
          if (!J.armed && BOSS.t >= BOSS_SLAM_TELE * 0.72) {
            J.armed = true; J.h0 = P.hearts;
            window.__fakePad.press(2);                     /* □ = JUMP, real input */
            setTimeout(function(){ try { window.__fakePad.press(); } catch (e) {} }, 60);
          }
        } else if (J.prev === 'slamTele' && J.armed) {
          J.tries++;
          if (P.hearts >= J.h0) J.clean++;
          J.armed = false;
        }
        J.prev = st;
      })(); 0`);
    for (let i = 0; i < 120; i++) {
      const j = await jget(api, 'window.__jmp');
      if (j.tries >= 5) break;
      await api.eval(`if (BOSS.st === 'track') { P.x = BOSS.x + 4.4; P.z = BOSS.z;
        P.fy = groundH(P.x, P.z); P.hearts = P.maxHearts; P.iframes = 0;
        const a = Math.atan2(BOSS.x - P.x, BOSS.z - P.z);
        __fmDebug.face(a); __fmDebug.camYaw(a + Math.PI); } 0`);
      await sleep(300);
    }
    const jmp = await jget(api, 'window.__jmp');
    gate('king-crab: a timed jump clears the slam even standing ON the mark',
      jmp.clean >= 4, `${jmp.clean}/${jmp.tries} clean jumps`);
    await api.eval('window.__jmp = undefined; window.__fmBot.release(); 0');

    /* THE ROAR never refunds */
    await api.eval(`window.__topUp = setInterval(function(){
      try { if (__fm.state === 'play') P.hearts = P.maxHearts; } catch (e) {} }, 80); 0`);
    await api.eval(`BOSS.st = 'roar'; BOSS.t = 0; BOSS.phase = 1; BOSS.hp = 48; refreshBossBar(false); 0`);
    await api.waitFor(`__fm.bossPhase === 2`, 10000, 'roar resolves');
    gate('king-crab: the roar never REFUNDS the hits landed during it',
      (await api.eval('__fm.bossHp')) <= 48, 'hp=' + await api.eval('__fm.bossHp'));

    /* the charge windup */
    await api.eval(`BOSS.st = 'emerge'; BOSS.t = 0; 0`);
    await api.waitFor(`window.__fmTele.some(e => e.who === 'kingCrabCharge')`, 20000, 'a charge fires');
    await teleGate(api, 'kingCrabCharge', 'king-crab charge');
    /* LOOK at the mark from the PLAYER's own camera. The arena is a roofed
       rock grotto — every staged vantage sits inside a wall — so the honest
       shot is the settled follow camera, frozen mid-windup. */
    await api.eval(`BOSS.phase = 1; BOSS.st = 'track'; BOSS.t = 0;
      __fmDebug.camOff(); __fmDebug.warp(56, 163); P.hearts = P.maxHearts; 0`);
    await sleep(2500);                       /* let the follow camera settle */
    await api.eval(`window.__mkShot = false;
      __fmBot.tol = 6.2; __fmBot.noWiggle = true; __fmBot.target = [BOSS.x, BOSS.z];
      (function w(){
        if (window.__mkShot === undefined) return;
        if (BOSS.st === 'slamTele' && BOSS.t > BOSS_SLAM_TELE * 0.75) {
          window.__mkShot = true;
          window.__fmBot.release(); window.__fakePad.axes(0, 0);
          __fmDebug.freeze(1); return;
        }
        requestAnimationFrame(w); })(); 0`);
    for (let i = 0; i < 80 && !(await api.eval('window.__mkShot')); i++) {
      await api.eval(`if (BOSS.st === 'track' && Math.hypot(P.x-BOSS.x,P.z-BOSS.z) > 7.2) {
        window.__fmBot.target = [BOSS.x, BOSS.z]; } P.hearts = P.maxHearts; 0`);
      await sleep(260);
    }
    if (await api.eval('window.__mkShot')) {
      await sleep(300);
      await api.shot('crab-slam-mark');
      await api.eval('__fmDebug.freeze(0); window.__mkShot = undefined; 0');
    }
    gate('king-crab: the slam mark staged for the eye', await api.eval('window.__mkShot') !== false);
    gate('crab: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('crab section', false, e.message);
    await api.shot('crab-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════════════ THE SILT WYRM ═══════════════════ */
if (want('wyrm')) {
  console.log('\n═══ the Silt Wyrm: the wake-chip, honest telemetry, telegraphs ═══');
  const api = await session(WYRM_READY, '?turbo=6');
  try {
    await api.eval(`__fmDebug.warp(2044, 1303); P.hearts = P.maxHearts; 0`);
    await api.waitFor('__fm.wyrmActive === true', 30000, 'the Wyrm wakes');
    gate('wyrm: proximity wakes it, phase one, HP 72',
      await api.eval('__fm.wyrmPhase === 1 && __fm.wyrmHp === 72'));

    /* ── HONEST TELEMETRY: wyrmStrikeable must equal the sword's own set ── */
    const honest = await jget(api, `(function(){
      const EX = ['surface','daze','sweep','sweepTele','wakeup','roar','slamRock'];
      const NO = ['sleep','dive','swim','erupt','gone','cure'];
      const st0 = WYRM.st, out = { bad: [], n: 0 };
      for (const s of EX.concat(NO)) {
        WYRM.st = s; syncTideTelemetry(); out.n++;
        if (__fm.wyrmStrikeable !== (EX.indexOf(s) >= 0)) out.bad.push(s + ':' + __fm.wyrmStrikeable);
      }
      WYRM.st = st0; syncTideTelemetry();
      return out; })()`);
    gate('wyrm: wyrmStrikeable IS the exposed set — no lie about swim/erupt',
      honest.bad.length === 0 && honest.n === 13, JSON.stringify(honest.bad));

    /* ── THE WAKE-CHIP: a swing at the buried wake pays 1, and FEELS like it ── */
    const chip = await jget(api, `(function(){
      WYRM.st = 'swim'; WYRM.t = 0.4; WYRM.active = true;
      WYRM.x = P.x + 1.6; WYRM.z = P.z;
      P.heading = Math.atan2(WYRM.x - P.x, WYRM.z - P.z);
      const hp0 = WYRM.hp, chips0 = WYRM.wakeChips || 0;
      let dust = 0;
      const sp = psDust.spawn; psDust.spawn = function(){ dust++; return sp.apply(psDust, arguments); };
      P.st = 'atk'; P.atkT = 0.2; P.atkN = 1;
      const hit = wyrmSwingHits();
      psDust.spawn = sp;
      return { hit, dmg: hp0 - WYRM.hp, chips: (WYRM.wakeChips || 0) - chips0,
               dust, hitstop: P.hitstop }; })()`);
    gate('wyrm: a swing at the SWIMMING wake registers (no silent nothing)', chip.hit === true);
    gate('wyrm: the wake-chip pays exactly 1', chip.dmg === 1, 'dmg=' + chip.dmg);
    gate('wyrm: and it FEELS like something — silt puff + thunk + hitstop',
      chip.chips === 1 && chip.dust > 0 && chip.hitstop > 0,
      `chips=${chip.chips} puffs=${chip.dust} hitstop=${chip.hitstop}`);
    /* and the exposed states still pay their full price */
    const body = await jget(api, `(function(){
      WYRM.st = 'surface'; WYRM.t = 0.2;
      WYRM.x = P.x + 1.6; WYRM.z = P.z;
      P.heading = Math.atan2(WYRM.x - P.x, WYRM.z - P.z);
      const hp0 = WYRM.hp;
      P.st = 'atk'; P.atkT = 0.2; P.atkN = 1;
      const hit = wyrmSwingHits();
      return { hit, dmg: hp0 - WYRM.hp }; })()`);
    gate('wyrm: an exposed body hit still pays 2 — the chip did not replace it',
      body.hit === true && body.dmg === 2, 'dmg=' + body.dmg);

    /* ── THE ROAR never refunds ── */
    await api.eval(`WYRM.phase = 1; WYRM.st = 'roar'; WYRM.t = 0; WYRM.hp = 41; refreshWyrmBar(false); 0`);
    await api.waitFor('__fm.wyrmPhase === 2', 10000, 'roar resolves');
    gate('wyrm: the roar never REFUNDS the hits landed during it',
      (await api.eval('__fm.wyrmHp')) <= 41, 'hp=' + await api.eval('__fm.wyrmHp'));

    /* ── TELEGRAPHS: erupt and the tail sweep ── */
    await api.eval(`WYRM.hp = 40; WYRM.st = 'dive'; WYRM.t = 0; 0`);
    for (let i = 0; i < 90; i++) {
      const e = (await tele(api, 'wyrmErupt')).length, s = (await tele(api, 'wyrmSweep')).length;
      if (e >= 2 && s >= 1) break;
      await api.eval(`if (WYRM.st === 'swim') { P.x = WYRM.x + 1.1; P.z = WYRM.z; P.fy = groundH(P.x, P.z); } 0`);
      await sleep(320);
    }
    await teleGate(api, 'wyrmErupt', 'wyrm erupt', 2);
    await teleGate(api, 'wyrmSweep', 'wyrm tail sweep');

    /* ── phase-3 dust devils: born on the rim, armed before they can touch ── */
    const devil = await jget(api, `(function(){
      WYRM.phase = 3; WYRM.hp = 20; WYRM.st = 'dive'; WYRM.t = 0;
      for (const dv of WYRM.devils) dv.on = false;
      P.x = H3.x; P.z = H3.z; P.fy = groundH(P.x, P.z); P.hearts = P.maxHearts;
      tickWyrm();
      return { r: WYRM.devils.map(dv => +Math.hypot(dv.x - H3.x, dv.z - H3.z).toFixed(2)),
               rim: H3.r, on: WYRM.devils.filter(dv => dv.on).length,
               contact: WYRM.devils.some(dv => Math.hypot(P.x - dv.x, P.z - dv.z) < 1.15) }; })()`);
    gate('wyrm: phase-3 dust devils are BORN ON THE RIM, never on top of you',
      devil.on === 2 && devil.r.every(r => r > devil.rim - 3), JSON.stringify(devil.r));
    gate('wyrm: and none of them is touching her on the frame it spawns', devil.contact === false);
    await api.waitFor(`window.__fmTele.some(e => e.who === 'wyrmDevil')`, 30000, 'a devil arms');
    await teleGate(api, 'wyrmDevil', 'wyrm dust devil arm');

    /* ── no phantom orb inside the arena ── */
    const orb = await jget(api, `(function(){
      const px = P.x, pz = P.z;
      P.x = H3.x + 2; P.z = H3.z + 2; updateBeacon(performance.now());
      const insideVis = beacon.visible, insideObj = !!objectivePoint();
      P.x = H3.x; P.z = H3.z - 40; updateBeacon(performance.now());
      const outVis = beacon.visible;
      P.x = px; P.z = pz;
      return { insideVis, insideObj, outVis }; })()`);
    gate('wyrm: the quest ORB hides inside the arena (no phantom will-o’-wisp)',
      orb.insideVis === false, JSON.stringify(orb));
    gate('wyrm: but the COMPASS keeps its answer in there', orb.insideObj === true);
    gate('wyrm: and the orb is back outside the arena', orb.outVis === true);
    gate('wyrm: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('wyrm section', false, e.message);
    await api.shot('wyrm-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════════════ THE HOUR TORTOISE ═══════════════════ */
if (want('tort')) {
  console.log('\n═══ the Hour Tortoise: the ring is jumpable ═══');
  const api = await session(ISLES_SOLVED, '?turbo=6', ['tortCure']);
  try {
    await api.eval(`__fmDebug.warpFoundry('pit'); P.hearts = P.maxHearts; 0`);
    await api.waitFor('__fm.tortActive === true', 30000, 'the Tortoise wakes');
    gate('tortoise: proximity wakes it, phase one, HP 84',
      await api.eval('__fm.tortPhase === 1 && __fm.tortHp === 84'));

    /* THE RING. In-page again: plant her, fire the ring, and jump it when the
       front is 2.2 m out. Ten runs; the last five have to be clean. */
    await api.eval(`window.__ring = { tries: 0, clean: 0, hit: 0, armed: false, jumped: false, h0: 0 };
      (function w(){
        if (window.__ring === undefined) return;
        requestAnimationFrame(w);
        const R = window.__ring;
        if (!TORT.ringOn) {
          if (R.armed) {
            R.tries++;
            if (P.hearts >= R.h0 && !TORT.ringHit) R.clean++; else R.hit++;
            R.armed = false;
          }
          return;
        }
        if (!R.armed) {
          R.armed = true; R.jumped = false; R.h0 = P.hearts;
        }
        const dr = Math.hypot(P.x - TORT.x, P.z - TORT.z) - TORT.ringR;
        if (!R.jumped && dr < 3.0 && dr > 1.8) {
          R.jumped = true;
          window.__fakePad.press(2);
          setTimeout(function(){ try { window.__fakePad.press(); } catch (e) {} }, 60);
        }
      })(); 0`);
    for (let i = 0; i < 60; i++) {
      const r = await jget(api, 'window.__ring');
      if (r.tries >= 8) break;
      if (!r.armed) {
        await api.eval(`P.x = TORT.x + 6; P.z = TORT.z; P.fy = groundH(P.x, P.z);
          P.st = 'idle'; P.vx = 0; P.vz = 0; P.air = false; P.jvy = 0;
          P.hearts = P.maxHearts; P.iframes = 0;
          TORT.st = 'slam'; TORT.t = 0;
          TORT.ringOn = true; TORT.ringR = 1.6; TORT.ringHit = false; 0`);
      }
      await sleep(300);
    }
    const ring = await jget(api, 'window.__ring');
    gate('tortoise: ONE timed standing jump clears the shockwave ring (≥5 clean)',
      ring.clean >= 5, `${ring.clean} clean / ${ring.hit} caught of ${ring.tries}`);
    await api.eval('window.__ring = undefined; 0');
    /* and flat-footed it still bites — the ring is thinner, not toothless */
    await api.eval('clearInterval(window.__topUp); 0');
    await api.eval(`P.x = TORT.x + 6; P.z = TORT.z; P.fy = groundH(P.x, P.z);
      P.st = 'idle'; P.vx = 0; P.vz = 0; P.air = false; P.jvy = 0;
      P.hearts = P.maxHearts; P.iframes = 0;
      TORT.st = 'slam'; TORT.t = 0; TORT.ringOn = true; TORT.ringR = 1.6; TORT.ringHit = false; 0`);
    await api.waitFor('TORT.ringHit === true || TORT.ringOn === false', 12000, 'the ring passes').catch(() => {});
    gate('tortoise: standing flat-footed in the ring still costs a heart',
      (await api.eval('TORT.ringHit')) === true, 'hearts=' + await api.eval('P.hearts'));
    await api.eval(`window.__topUp = setInterval(function(){
      try { if (__fm.state === 'play') P.hearts = P.maxHearts; } catch (e) {} }, 80); 0`);

    /* ── THE ROAR never refunds ── */
    await api.eval(`TORT.phase = 1; TORT.st = 'roar'; TORT.t = 0; TORT.hp = 49; refreshTortBar(false); 0`);
    await api.waitFor('__fm.tortPhase === 2', 10000, 'roar resolves');
    gate('tortoise: the roar never REFUNDS the hits landed during it',
      (await api.eval('__fm.tortHp')) <= 49, 'hp=' + await api.eval('__fm.tortHp'));

    /* ── TELEGRAPHS: slam, roll, and the summoned gulls ── */
    for (let i = 0; i < 90; i++) {
      const s = (await tele(api, 'tortSlam')).length, r = (await tele(api, 'tortRoll')).length;
      if (s >= 2 && r >= 2) break;
      await api.eval(`if (TORT.st === 'track') { P.x = TORT.x + 5; P.z = TORT.z; P.fy = groundH(P.x, P.z); } 0`);
      await sleep(320);
    }
    await teleGate(api, 'tortSlam', 'tortoise shell slam', 2);
    await teleGate(api, 'tortRoll', 'tortoise roll', 2);
    for (let i = 0; i < 60; i++) {
      if ((await tele(api, 'islesGull')).length >= 2) break;
      await api.eval(`fCallGull();
        for (const g of FGULLS) if (!g.dead && g.st === 'drift') { g.x = P.x + 3.4; g.z = P.z; }
        0`);
      await sleep(300);
    }
    await teleGate(api, 'islesGull', 'foundry gull dive', 2);

    /* ── no phantom orb inside the pit ── */
    const orb = await jget(api, `(function(){
      const px = P.x, pz = P.z;
      P.x = F3.x + 2; P.z = F3.z + 2; updateBeacon(performance.now());
      const insideVis = beacon.visible, insideObj = !!objectivePoint();
      P.x = px; P.z = pz;
      return { insideVis, insideObj }; })()`);
    gate('tortoise: the quest ORB hides inside the casting pit', orb.insideVis === false);
    gate('tortoise: but the COMPASS keeps its answer in there', orb.insideObj === true);
    gate('tort: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('tort section', false, e.message);
    await api.shot('tort-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════════════ THE ASH STAG ═══════════════════ */
if (want('stag')) {
  console.log('\n═══ the Ash Stag: fawns, ember rain, the roar ═══');
  const api = await session({ ...P4_CROWN, stagDone: false }, '?turbo=6', ['stagCure']);
  try {
    await api.eval('__fmDebug.warpCrown("t2"); P.hearts = P.maxHearts; 0');
    await api.waitFor('__fm.stagActive === true', 30000, 'the Stag wakes');

    /* ── THE ROAR never refunds ── */
    await api.eval(`STAG.phase = 1; STAG.st = 'roar'; STAG.t = 0; STAG.hp = 45; refreshStagBar(false); 0`);
    await api.waitFor('__fm.stagPhase === 2', 10000, 'roar resolves');
    gate('stag: the roar never REFUNDS the hits landed during it',
      (await api.eval('__fm.stagHp')) <= 45, 'hp=' + await api.eval('__fm.stagHp'));

    /* ── EMBER RAIN telegraph ── */
    for (let i = 0; i < 60; i++) {
      if ((await tele(api, 'stagEmber')).length >= 3) break;
      await api.eval('stagEmberDrop(); 0');
      await sleep(300);
    }
    await teleGate(api, 'stagEmber', 'stag ember rain', 3);

    /* ── EMBER FAWN pounce telegraph ── */
    for (let i = 0; i < 80; i++) {
      if ((await tele(api, 'emberFawn')).length >= 2) break;
      await api.eval(`(function(){ const f = FAWNS.find(f => !f.dead);
        if (f) { f.cd = 0; P.x = f.x + 4; P.z = f.z; P.fy = groundH(P.x, P.z); }
        return 0; })()`);
      await sleep(320);
    }
    await teleGate(api, 'emberFawn', 'ember fawn pounce', 2);
    gate('stag: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('stag section', false, e.message);
    await api.shot('stag-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════════════ THE LANTERN MOTH ═══════════════════ */
if (want('moth')) {
  console.log('\n═══ the Lantern Moth: the wing-gust actually shoves ═══');
  const api = await session(PHASE5_DONE, '?turbo=4');
  try {
    await api.eval('clearInterval(window.__topUp); 0');
    await api.eval(`SAVE.q = 25; QUEST.q = 25; SAVE.starLantern = true; storeSave();
      __fmDebug.warpMothroom(); P.hearts = P.maxHearts; 0`);
    await api.eval(`P.x = ML_C.x + 4; P.z = ML_C.z; P.fy = ML_FLOOR_Y; 0`);
    await api.waitFor('__fm.mothActive === true', 30000, 'the Moth wakes');

    /* in-page: plant her, fire the gust, measure the ground she gives up */
    await api.eval(`window.__gust = { tries: 0, shoved: 0, best: 0, worst: 99, hurt: 0,
        armed: false, from: null, h0: 0, wait: 0 };
      (function w(){
        if (window.__gust === undefined) return;
        requestAnimationFrame(w);
        const G = window.__gust;
        if (!G.armed) return;
        G.wait++;
        if (MOTH.gustHit && !G.from) { G.from = [P.x, P.z]; G.h0 = P.hearts; G.wait = 0; }
        if (G.from && G.wait > 40) {
          const d = Math.hypot(P.x - G.from[0], P.z - G.from[1]);
          G.tries++;
          G.best = Math.max(G.best, d); G.worst = Math.min(G.worst, d);
          if (d > 1.5) G.shoved++;
          if (P.hearts < G.h0) G.hurt++;
          G.armed = false; G.from = null;
        }
        if (!G.from && G.wait > 240) { G.armed = false; }
      })(); 0`);
    for (let i = 0; i < 70; i++) {
      const g = await jget(api, 'window.__gust');
      if (g.tries >= 6) break;
      if (!g.armed) {
        await api.eval(`P.x = ML_C.x + 4.2; P.z = ML_C.z; P.fy = ML_FLOOR_Y;
          P.st = 'idle'; P.vx = 0; P.vz = 0; P.air = false; P.jvy = 0;
          P.hearts = P.maxHearts; P.iframes = 0;
          MOTH.x = ML_C.x; MOTH.z = ML_C.z;
          mlSetSt('gust'); MOTH.gustR = 0.8; MOTH.gustHit = false;
          window.__gust.armed = true; window.__gust.wait = 0; window.__gust.from = null; 0`);
      }
      await sleep(320);
    }
    const g = await jget(api, 'window.__gust');
    gate('moth: the wing-gust physically SHOVES her — every catch moves her > 1.5 m',
      g.tries >= 5 && g.shoved === g.tries,
      `${g.shoved}/${g.tries} shoves, worst ${g.worst.toFixed(2)} m, best ${g.best.toFixed(2)} m`);
    gate('moth: and it never costs a heart — shove only, as the caption promises',
      g.hurt === 0, 'hurt=' + g.hurt);
    gate('moth: the shove counter ticks on the real path',
      (await api.eval('__fm.mothGustShoves')) >= 5, 'shoves=' + await api.eval('__fm.mothGustShoves'));
    await api.eval('window.__gust = undefined; 0');
    gate('moth: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('moth section', false, e.message);
    await api.shot('moth-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════════════ THE KILN HOUND ═══════════════════ */
if (want('hound')) {
  console.log('\n═══ the Kiln Hound: the gateway is a door, and the faint is local ═══');
  const api = await session(HOUND_READY, '?turbo=4',
    ['obHintTail', 'obHintMote', 'obHintClod', 'obCrustHolds', 'obPetLine']);
  try {
    await api.eval('__fmDebug.warp.kilnarena(); P.hearts = P.maxHearts; 0');
    await api.eval('__fmBot.tol = 1.4; __fmBot.target = [-1240, -1187]; 0');
    await api.waitFor('__fm.kilnActive === true', 30000, 'the Hound wakes');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');

    /* the geometry: the north arc must be a doorway, and walkable */
    const geo = await jget(api, `(function(){
      const gate = [], wall = [];
      for (let d = 12; d <= 26; d += 0.5) {
        gate.push(+obGroundAt(OB_KILN.x, OB_KILN.z + d).toFixed(2));
        wall.push(+obGroundAt(OB_KILN.x, OB_KILN.z - d).toFixed(2));
      }
      let gateSolid = false, wallSolid = false;
      for (let d = 13; d <= 21; d += 0.5) {
        if (worldSolidAt(OB_KILN.x, OB_KILN.z + d)) gateSolid = true;
        if (worldSolidAt(OB_KILN.x, OB_KILN.z - d)) wallSolid = true;
      }
      return { gate, wall, gateSolid, wallSolid, gateArc: obInGateArc(OB_KILN.x, OB_KILN.z + 18) };
    })()`);
    const drops = geo.gate.slice(1).map((h, i) => geo.gate[i] - h);
    gate('hound: the north arc IS the gateway (open, and it knows it)',
      geo.gateSolid === false && geo.gateArc === true);
    gate('hound: the rest of the rim is still solid wall', geo.wallSolid === true);
    gate('hound: the gateway saddle is walkable — nothing to fall down',
      Math.max(...drops) < 1.2, 'worst step down = ' + Math.max(...drops).toFixed(2) + ' m');

    /* WALK OUT through the gate on full health: the fight must re-arm */
    await api.eval(`HOUND.phase = 2; HOUND.hp = 40; obRefreshBar(false); P.hearts = P.maxHearts; 0`);
    await api.eval('__fmBot.tol = 1.0; __fmBot.noWiggle = true; __fmBot.target = [OB_KILN.x, OB_KILN.z + 22]; __fmBot.sprint(true); 0');
    await api.waitFor('__fm.kilnActive === false', 40000, 'walking out re-arms her');
    await api.eval('__fmBot.sprint(false); __fmBot.release(); __fakePad.axes(0,0); 0');
    const out = await jget(api, `({ r: +Math.hypot(P.x - OB_KILN.x, P.z - OB_KILN.z).toFixed(1),
      inK: obInKiln(P.x, P.z), phase: HOUND.phase, hp: HOUND.hp,
      hearts: P.hearts, maxH: P.maxHearts })`);
    gate('hound: a kid can WALK OUT of the caldera through its own gateway',
      out.inK === false && out.r > 17, JSON.stringify(out));
    gate('hound: stepping out re-arms her at the phase you left (the stag rule)',
      out.phase === 2 && out.hp === 60, `phase ${out.phase} hp ${out.hp}`);
    gate('hound: and she survives the walk out', out.hearts > 0, `hearts ${out.hearts}/${out.maxH}`);

    /* THE SOLID rim still knocks inward — sprint at the south wall */
    await api.eval('__fmDebug.warp.kilnarena(); P.hearts = P.maxHearts; 0');
    await api.waitFor('__fm.kilnActive === true', 30000, 're-wake');
    await api.eval('__fmBot.tol = 0.5; __fmBot.noWiggle = true; __fmBot.target = [-1240, -1212]; __fmBot.sprint(true); 0');
    await sleep(3500);
    await api.eval('__fmBot.sprint(false); __fmBot.release(); __fakePad.axes(0,0); 0');
    const rr = await api.eval('Math.hypot(P.x - OB_KILN.x, P.z - OB_KILN.z)');
    gate('hound: the SOLID rim still knocks inward — no fall fail out the back',
      rr < 17.5, 'r=' + rr.toFixed(1));

    /* THE FAINT must wake her at the caldera MOUTH, not 219 m away */
    await api.eval('clearInterval(window.__topUp); 0');
    await api.eval('__fmDebug.warp.kilnarena(); P.hearts = P.maxHearts; 0');
    await api.waitFor('__fm.kilnActive === true', 30000, 're-wake for the faint');
    await api.eval(`HOUND.phase = 3; HOUND.hp = 20; obRefreshBar(false); 0`);
    const anchor = await jget(api, `(function(){
      const s = nearestShadeSpot(OB_KILN.x, OB_KILN.z);
      return { x: +s.x.toFixed(1), z: +s.z.toFixed(1),
               d: +Math.hypot(s.x - OB_KILN.x, s.z - OB_KILN.z).toFixed(1),
               shade: inShadeAt(s.x, s.z) }; })()`);
    gate('hound: the Emberwaste answers the caldera with its OWN anchor at the mouth',
      anchor.d < 16 && anchor.shade === true, JSON.stringify(anchor));
    await api.eval('P.iframes = 0; hurtPlayer(P.hearts, P.x + 2, P.z, null); 0');
    await api.waitFor(`__fm.state === 'play' && P.hearts > 0`, 60000, 'she wakes up');
    const wake = await jget(api, `({ x: +P.x.toFixed(1), z: +P.z.toFixed(1),
      d: +Math.hypot(P.x - OB_KILN.x, P.z - OB_KILN.z).toFixed(1),
      shade: inShadeAt(P.x, P.z), hearts: P.hearts,
      phase: HOUND.phase, hp: HOUND.hp })`);
    gate('hound: fainting in the caldera wakes her AT THE MOUTH, not on the landing',
      wake.d < 20, JSON.stringify(wake));
    gate('hound: the wake spot is real shade', wake.shade === true);
    gate('hound: and the fight is re-armed at the phase she left (checkpoint law)',
      wake.phase === 3 && wake.hp === 30, `phase ${wake.phase} hp ${wake.hp}`);
    await api.shot('hound-wake-at-mouth');
    gate('hound: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('hound section', false, e.message);
    await api.shot('hound-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════════════ EMBER HORNETS ═══════════════════ */
if (want('hornet')) {
  console.log('\n═══ ember hornets: a readable windup and a STAGGERED pair ═══');
  const api = await session(FAMILY_Q4, '?turbo=6');
  try {
    /* record every dive in SIM TICKS with its pair id */
    await api.eval(`window.__hd = [];
      (function w(){ if (window.__hd === undefined) return;
        requestAnimationFrame(w);
        for (const h of HORNETS) {
          if (h.dead) continue;
          const diving = h.st === 'dive';
          if (diving && !h.__wasDive) window.__hd.push({ pair: h.pair, tick: simTick });
          h.__wasDive = diving;
        }
      })(); 0`);
    for (let i = 0; i < 90; i++) {
      if ((await tele(api, 'emberHornet')).length >= 6) break;
      await api.eval(`(function(){ const h = HORNETS.find(h => !h.dead && h.st === 'drift');
        if (h) { P.x = h.x + 3.4; P.z = h.z; P.fy = groundH(P.x, P.z); }
        return 0; })()`);
      await sleep(320);
    }
    await teleGate(api, 'emberHornet', 'ember hornet dive', 4);
    const dives = await jget(api, 'window.__hd');
    const gaps = [];
    for (let i = 1; i < dives.length; i++) {
      if (dives[i].pair === dives[i - 1].pair) {
        const g = dives[i].tick - dives[i - 1].tick;
        if (g >= 0 && g < 90) gaps.push(g);
      }
    }
    gate('hornets: a PAIR never lands together — the second dives a beat later',
      gaps.length > 0 && gaps.every(g => g >= 15),
      gaps.length ? `same-pair gaps(ticks)=${JSON.stringify(gaps)}` : 'no same-pair pair observed');
    await api.eval('window.__hd = undefined; 0');
    gate('hornet: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('hornet section', false, e.message);
    await api.shot('hornet-FAIL').catch(() => {});
  }
  api.close();
}

summary();
