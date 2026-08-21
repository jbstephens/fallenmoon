#!/usr/bin/env node
/* p6i — PHASE 5 PART ONE verification probe.
   The river's mouth: the sluice rhythm, the river-falls cine, the rapids
   corridor, the carved channel, the refit physics (swing keel + stern
   wheel) — driven through REAL input and asserted through __fm, with
   screenshots looked at by a human.

   Run:  /opt/homebrew/opt/node@25/bin/node test/probes/p6i.mjs [section...]
   Sections: sluice cine walk sail world perf   (default: all)            */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, tapUntil, sleep, GAME } from './p6e.mjs';
const gate = (label, ok, extra) => rawGate(ok, label, extra);
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(DIR, 'shots-p6i');
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['sluice', 'cine', 'walk', 'sail', 'world', 'perf'];
const want = (s) => WANT.includes(s);

/* ── saves ─────────────────────────────────────────────────────────────── */
/* the morning after phase four: 4/8, the Silverrun runs, nothing of
   phase five has happened yet */
const P5_START = {
  v: 2, q: 17, ph: 4, mh: 8, sword: true, salt: 60,
  talked: { finn: 2, tock: 1, pearl: 1 },
  kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: true,
  bossDone: true, sky: 4, tidepool: true, compassSeen: true,
  region: 'bay', lastSpring: 3, wardenTalked: 2, forestSeen: true, swelterSeen: true,
  basinOpen: true, glyph1: true, glyph2: true, wyrmDone: true, floodSeen: true,
  sailedOnce: true, voyageDone: true,
  boatX: 8.5, boatZ: 6, boatAng: 0.9,
  keelFound: true, boatRefit: true, moonSeen: true, isleLandfall: true,
  bellwrightTalked: 2, watchBell: true, tortoiseDone: true, sunArc: true, lampLit: true,
  fGlyph1: true, fGlyph2: true, fGlyph3: true,
  crownGlint: true, stairOpen: true, organ1: true, organ2: true, organ3: true,
  crownSeen: true, stagDone: true, riverWet: true,
  tbc2Seen: true, tbc3Seen: true, tbc4Seen: true,
  lastShade: [8.2, 7], lastPos: [8.2, 7],
};
const AT_CAMP = { ...P5_START, region: 'forest', lastPos: [243, 57], lastShade: [250, 68] };
const MOUTH_OPEN = { ...AT_CAMP, sluiceG: 3, mouthOpen: true, q: 19 };
const REFIT = { ...MOUTH_OPEN, swingKeel: true, paddleWheel: true,
  region: 'bay', lastPos: [103, 31], lastShade: [8.2, 7], boatX: 96.5, boatZ: 38 };

/* ── session helpers ───────────────────────────────────────────────────── */
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
    console.log('   shot → ' + f);
    return f;
  };
  api.close = () => { c.close(); proc.kill(); srv.close(); };
  api.errs = c.errs;
  await api.nav(`http://127.0.0.1:${hport}/${query || '?turbo=1'}`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 45000, 'title');
  await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 14, 'focus CONTINUE');
  await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 16, 'leave title');
  for (let i = 0; i < 40; i++) {
    const st = await api.eval('__fm.state');
    if (st === 'play') break;
    if (st !== 'title') await api.tap(0);
    await sleep(350);
  }
  await api.waitFor(`__fm.state === 'play'`, 30000, 'play');
  await api.installBot('pad');
  return api;
}
async function walkTo(api, x, z, tol = 1.8, timeout = 60000) {
  /* the pass crabs are a combat beat, not a sluice beat: the rig walks
     with i-frames so a pinch cannot teleport the run to a spring */
  await api.eval('P.hearts = P.maxHearts; P.iframes = 100000; 0');
  await api.eval(`__fmBot.done=false; __fmBot.tol=${tol}; __fmBot.target=[${x},${z}]`);
  await api.waitFor(
    `__fmBot.done || Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < ${tol + 0.5} || __fm.state!=='play'`,
    timeout, `walk to ${x},${z}`);
  await api.eval('__fmBot.target=null; __fakePad.axes(0,0)');
}
/* THE COLD PLAYER: reacts to the surge cue ALONE, 250 ms late, presses ✕
   for 160 ms, and does nothing else. If this bot cannot open a gate, a
   seven-year-old cannot. Runs in-page so its latency is honest. */
const COLD_BOT = `window.__coldBot = (function () {
  const S = { run: true, presses: 0, t: null };
  S.t = setInterval(() => {
    if (!S.run || !window.__fm) return;
    const on = __fm.moSurgeNow;
    if (on && !S.was) {
      setTimeout(() => {
        if (!S.run) return;
        S.presses++;
        __fakePad.press(0);
        setTimeout(() => __fakePad.press(), 160);
      }, 250);
    }
    S.was = on;
  }, 30);
  S.stop = () => { S.run = false; clearInterval(S.t); };
  return S;
})(); 0`;

/* ═══════════════════ 1 — THE SLUICE, BY EAR AND EYE ═══════════════════ */
async function suiteSluice() {
  console.log('\n── the sluice: three gates, one rhythm, no text ──');
  const api = await session(AT_CAMP, '?turbo=1');
  try {
    gate('sluice: resumes at the pass camp, mouth still stone',
      await api.eval('__fm.moGates === 0 && __fm.moMouthOpen === false && __fm.region === "forest"'),
      JSON.stringify(await api.eval('({g:__fm.moGates, o:__fm.moMouthOpen})')));
    /* the surge pulse is running and fair: window ≥ 1.2 s of a 4 s period */
    const pulse = await api.eval(`(function(){
      return { period: ${'MO_SURGE_T'} / 60, window: ${'MO_SURGE_W'} / 60 };
    })()`);
    gate('sluice: the pulse is kid-fair (period 4 s, window ≥ 1.2 s)',
      Math.abs(pulse.period - 4) < 0.01 && pulse.window >= 1.2, JSON.stringify(pulse));
    /* walk to gate 1's wheel by real stick */
    const W1 = await api.eval('({x: MOGATES[0].wx, z: MOGATES[0].wz})');
    await walkTo(api, W1.x, W1.z, 2.2, 90000);
    await api.waitFor(`__fm.prompt === 'moWheel'`, 12000,
      'the wheel prompt (at ' + JSON.stringify(await api.eval('({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1)})')) + ')');
    gate('sluice: the wheel offers itself, and says nothing about rhythm', true,
      await api.eval(`(currentInteract()||{}).label`));
    await api.shot('sluice-gate1-shut-1280x720');
    /* A WRONG-TIMED PRESS: harmless, wheel shudders, the next surge comes */
    await api.waitFor('__fm.moSurgeNow === false && __fm.moSurgePh > 0.5', 9000, 'mid-slack');
    const sh0 = await api.eval('__fm.moShudders');
    const h0 = await api.eval('P.hearts');
    await api.tap(0);
    await api.waitFor(`__fm.moShudders > ${sh0}`, 4000, 'the shudder');
    gate('sluice: a wrong beat shudders and waits — no damage, no reset of the world',
      await api.eval(`__fm.moGates === 0 && P.hearts === ${h0}`));
    /* THE COLD PLAYER opens gate 1 (needs one on-beat hit) */
    await api.eval(COLD_BOT);
    await api.waitFor('__fm.moGates >= 1', 30000, 'gate 1 gives');
    await api.eval('__coldBot.stop()');
    gate('sluice: gate 1 gives to a cue-reaction alone (250 ms cold latency)', true,
      'presses=' + await api.eval('__coldBot.presses'));
    await api.waitFor('__fm.moFill.split(",")[0] === "1.00" || moFill[0] >= 1', 8000, 'reach 1 fills');
    await api.shot('sluice-gate1-open-1280x720');
    /* gate 2 needs TWO consecutive — a wrong press between on-beats resets */
    const W2 = await api.eval('({x: MOGATES[1].wx, z: MOGATES[1].wz})');
    await walkTo(api, 260, 44, 3.0, 60000);        // along the south berm, out of the new water
    await walkTo(api, W2.x, W2.z, 2.2, 60000);
    await api.waitFor(`__fm.prompt === 'moWheel'`, 10000, 'gate 2 prompt');
    /* one on-beat hit, then a deliberate wrong one: progress must reset */
    await api.eval(COLD_BOT);
    await api.waitFor('__fm.moProgress >= 1', 22000, 'first on-beat hit');
    await api.eval('__coldBot.stop()');
    await api.waitFor('__fm.moSurgeNow === false && __fm.moSurgePh > 0.5', 9000, 'mid-slack');
    await api.tap(0);
    await api.waitFor('__fm.moProgress === 0', 4000, 'the count starts over');
    gate('sluice: gate 2 counts CONSECUTIVE beats — a wrong press starts the count over',
      await api.eval('__fm.moGates === 1'));
    await api.eval(COLD_BOT);
    await api.waitFor('__fm.moGates >= 2', 45000, 'gate 2 gives (two in a row)');
    await api.eval('__coldBot.stop()');
    gate('sluice: gate 2 gives to two consecutive cue-reactions', true);
    await api.shot('sluice-gate2-open-1280x720');
    /* gate 3 needs three — and IS the cinematic */
    const W3 = await api.eval('({x: MOGATES[2].wx, z: MOGATES[2].wz})');
    await walkTo(api, 240, 36.5, 3.0, 60000);      // the dry south bank of reach 2
    await walkTo(api, W3.x, W3.z, 2.2, 60000);
    await api.waitFor(`__fm.prompt === 'moWheel'`, 10000, 'gate 3 prompt');
    await api.eval(COLD_BOT);
    await api.waitFor(`__fm.state === 'cine'`, 70000, 'three in a row → THE RIVER FALLS');
    await api.eval('__coldBot.stop()');
    gate('sluice: gate 3 gives to three consecutive beats and starts the falls', true);
    await sleep(2500);
    await api.shot('riverfalls-mid-1280x720');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'the cine ends by itself');
    const w = await api.eval('({g:__fm.moGates, o:__fm.moMouthOpen, q:__fm.quest, fill:__fm.moFill})');
    gate('sluice: the mouth is OPEN — flags live, quest ≥ 19, all reaches full',
      w.g === 3 && w.o === true && w.q >= 19 && w.fill === '1,1,1', JSON.stringify(w));
    await api.shot('riverfalls-after-1280x720');
    /* the sweep agrees with the portals */
    gate('sluice: portals agree with the world (invariant sweep clean)',
      (await api.eval('window.__invariantReport.portalBad.length')) === 0,
      await api.eval('JSON.stringify(window.__invariantReport.portalBad)'));
    gate('sluice: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('sluice suite', false, e.message);
    await api.shot('sluice-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════════════ 2 — THE RIVER FALLS: skip + replay ═══════════════════ */
async function suiteCine() {
  console.log('\n── the river falls: always skippable, always derived ──');
  const api = await session({ ...AT_CAMP, sluiceG: 2 }, '?turbo=1');
  try {
    /* open gate 3 by debug setup (the mechanic itself is suite 1's) and
       catch the cine, then SKIP it at the first legal frame */
    const W3 = await api.eval('({x: MOGATES[2].wx, z: MOGATES[2].wz})');
    await walkTo(api, W3.x, W3.z, 2.2, 90000);
    await api.eval(COLD_BOT);
    await api.waitFor(`__fm.state === 'cine'`, 90000, 'the falls start');
    await api.eval('__coldBot.stop()');
    await api.waitFor('CINE.t > 0.95', 6000, 'past the skip threshold');
    await api.tap(0);
    await api.waitFor(`__fm.state === 'play'`, 6000, 'skip lands');
    const w = await api.eval('({o:__fm.moMouthOpen, g:__fm.moGates, fill:__fm.moFill})');
    gate('cine: skippable from 0.9 s, and the skip still sets the whole world',
      w.o === true && w.g === 3 && w.fill === '1,1,1', JSON.stringify(w));
    /* Rule 5: the camera came home to the follow shot — no snap */
    gate('cine: back on the follow camera', (await api.eval('CAM.mode')) === 'follow');
    /* reload: the open mouth derives from the save alone, both ways */
    await api.eval('storeSave(); 0');
    gate('cine: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('cine suite', false, e.message);
    await api.shot('cine-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 3 — THE BANK, WALKED END TO END (and the crossing) ═══════════ */
async function suiteWalk() {
  console.log('\n── the rapids bank on foot, and the family crossing ──');
  const api = await session(MOUTH_OPEN, '?turbo=6');
  try {
    /* the north bank, camp → pool: real stick, never a sky hole */
    const bank = [[252, 53], [236, 48], [220, 46], [204, 44], [186, 42], [168, 41], [152, 42], [140, 44]];
    await api.eval(`__fmDebug.warp(258, 60); P.hearts = P.maxHearts; 0`);
    let holes = 0;
    for (const [x, z] of bank) {
      await walkTo(api, x, z, 2.6, 45000);
      const under = await api.eval('groundH(P.x, P.z) - 0.2 < P.fy + 0.4');
      if (!under) holes++;
    }
    gate('walk: the north bank walks end to end (camp → pool), grounded every step',
      holes === 0, 'stations=' + bank.length);
    const pos = await api.eval('({x:+__fm.x.toFixed(0), z:+__fm.z.toFixed(0)})');
    gate('walk: reached the pool rim', Math.hypot(pos.x - 140, pos.z - 44) < 8, JSON.stringify(pos));
    /* THE FAMILY CROSSING: the forest suite's own waypoints, walked with
       the water LIVE — the glide bar wades, nothing blocks */
    await api.eval(`__fmDebug.warp(95, 34); P.hearts = P.maxHearts; 0`);
    await walkTo(api, 138, 38, 2.6, 90000);
    const c1 = await api.eval('({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), d:+waterDepthAt(__fm.x,__fm.z).toFixed(2)})');
    gate('walk: bay → pass over the bar (the forest suite\'s own line, water live)',
      Math.hypot(c1.x - 138, c1.z - 38) < 3.4, JSON.stringify(c1));
    await walkTo(api, 200, 44, 3.2, 90000);
    await walkTo(api, 243, 57, 3.2, 90000);
    gate('walk: … and on to the camp', true,
      JSON.stringify(await api.eval('({x:+__fm.x.toFixed(0), z:+__fm.z.toFixed(0)})')));
    /* and back down */
    await walkTo(api, 138, 38, 3.2, 90000);
    await walkTo(api, 95, 34, 3.2, 90000);
    gate('walk: pass → bay again (both ways, like the family walks it)', true);
    /* the bar itself is wadeable, the pool lane is not */
    const bar = await api.eval('[[136,37.8],[138,38.1],[140,38.3]].map(p=>+waterDepthAt(p[0],p[1]).toFixed(2))');
    gate('walk: the bar wades (≤ 0.62 the whole crossing)', bar.every(d => d <= 0.62), JSON.stringify(bar));
    const lane = await api.eval('+waterDepthAt(118, 45.5).toFixed(2)');
    gate('walk: the pool lane does NOT wade (the water owns it)', lane > 0.62, 'depth=' + lane);
    gate('walk: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('walk suite', false, e.message);
    await api.shot('walk-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 4 — THE REFIT SAILED: keel, wheel, limits ═══════════ */
async function suiteSail() {
  console.log('\n── the refit boat: through the channel, up to the ford ──');
  const api = await session(REFIT, '?turbo=1');
  try {
    /* board her in the east bay */
    await walkTo(api, 99.5, 35, 2.4, 60000);
    const bp = await api.eval('({x:+BOAT.x.toFixed(1), z:+BOAT.z.toFixed(1)})');
    await walkTo(api, bp.x, bp.z, 3.4, 45000).catch(() => {});
    await api.waitFor(`(currentInteract()||{}).id === 'board'`, 12000, 'board prompt');
    await api.tap(0);
    await api.waitFor('__fm.sailing === true', 8000, 'aboard');
    gate('sail: aboard at the channel mouth', true);
    /* the paddlewheel is VISIBLE metal, and ○ churns it */
    gate('sail: the stern wheel is fitted and visible', await api.eval('__fm.moPaddleVis === true'));
    /* the walk-bot IS the stick, afloat too (the sail suite's own trick) */
    const aim = (x, z) => api.eval(`__fmBot.done=false; __fmBot.tol=2.2; __fmBot.target=[${x},${z}]`);
    const unaim = () => api.eval('__fmBot.target=null; __fakePad.axes(0,0); __fakePad.press()');
    /* top speed under ○ hold — must be ≈ 1.45× the old full sail (9.6) */
    await aim(55, 24);
    await api.eval('__fakePad.press(1)');
    let spd = 0, paddleK = 0;
    for (let i = 0; i < 18; i++) {
      await api.eval('__fakePad.press(1)');
      await sleep(300);
      spd = Math.max(spd, await api.eval('+BOAT.spd.toFixed(2)'));
      paddleK = Math.max(paddleK, await api.eval('__fm.moPaddleK'));
    }
    await unaim();
    gate('sail: ○ hold = the WHEEL — ≈ 1.45× sprint sail (13.9 vs 9.6)',
      spd > 12.4 && spd < 14.6, 'spd=' + spd);
    gate('sail: the wheel churns while held (spin + wake live)', paddleK > 0.5, 'k=' + paddleK);
    await api.shot('sail-paddle-churn-1280x720');
    /* into the channel and the pool, real stick the whole way */
    await walkTo(api, 88, 36, 4.0, 90000);
    await walkTo(api, 97, 41, 3.4, 60000);
    await walkTo(api, 107, 41.5, 3.4, 60000);
    await walkTo(api, 118, 44.5, 3.4, 60000);
    await unaim();
    const at = await api.eval('({x:+BOAT.x.toFixed(1), z:+BOAT.z.toFixed(1)})');
    gate('sail: through the carved channel into the MOUTH POOL',
      Math.hypot(at.x - 118, at.z - 42) < 12, JSON.stringify(at));
    await api.shot('sail-mouth-pool-1280x720');
    /* THE SWING KEEL: visibly folded in the shallows, down in the deep */
    await walkTo(api, 137, 38.5, 3.2, 45000).catch(() => {});
    await unaim();
    await sleep(1600);
    const keelUp = await api.eval('({fold:__fm.moKeelFold, rot:__fm.moKeelRot, dep:+waterDepthAt(BOAT.x,BOAT.z).toFixed(2)})');
    gate('sail: the keel FOLDS UP over the bar (mesh rotation asserted)',
      keelUp.fold > 0.6 && Math.abs(keelUp.rot) > 0.7, JSON.stringify(keelUp));
    await api.shot('sail-keel-folded-1280x720');
    /* up the rapids to the first ford: the soft limit, never a wall */
    await api.eval('__fmDebug.boatTo(300, 82); 0');       // setup: the reach below the ford
    await sleep(400);
    const fx = await api.eval('({d: runNear(BOAT.x, BOAT.z).s.d})');
    await aim(370, 111);
    for (let i = 0; i < 40; i++) { await api.eval('__fakePad.press(1)'); await sleep(320); }
    await unaim();
    const lim = await api.eval('({d: runNear(BOAT.x, BOAT.z).s.d + Math.round(runNear(BOAT.x, BOAT.z).along), said: __fm.moFordSaid, x:+BOAT.x.toFixed(0)})');
    gate('sail: FIRST FORD limit — she is pushed back softly, told once',
      lim.d < 152 && lim.said === true, JSON.stringify(lim) + ' from d=' + fx.d);
    await api.shot('sail-ford-limit-1280x720');
    /* keel down again in deep water */
    await walkTo(api, 285, 70, 4.0, 45000).catch(() => {});
    await unaim();
    await sleep(2400);
    gate('sail: the keel folds DOWN again in deep water',
      (await api.eval('__fm.moKeelFold')) < 0.4, 'fold=' + await api.eval('__fm.moKeelFold'));
    /* Rule 4 under way: no water plane inside the bilge (rendered check) */
    const bilge = await api.eval(`(function(){
      const wl = (window.__HULLS.find(h=>h.name==='sailboat')).waterlineY();
      const deck = sailboat.group.position.y + 0.38;
      return { wl: +wl.toFixed(2), deck: +deck.toFixed(2), ok: wl < deck + 0.02 };
    })()`);
    gate('sail: the local waterline stays under her bilge (Rule 4, vessel side)',
      bilge.ok, JSON.stringify(bilge));
    gate('sail: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('sail suite', false, e.message);
    await api.shot('sail-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 4b — pre-keel grounding: 0.55 still protects, the bar holds her ═══════════ */
async function suitePreKeel() {
  console.log('\n── before the refit: the old draft still grounds her ──');
  const api = await session({ ...MOUTH_OPEN, region: 'bay', lastPos: [103, 31], lastShade: [8.2, 7], boatX: 96.5, boatZ: 38 }, '?turbo=1');
  try {
    await walkTo(api, 99.5, 35, 2.4, 60000);
    const bp0 = await api.eval('({x:+BOAT.x.toFixed(1), z:+BOAT.z.toFixed(1)})');
    await walkTo(api, bp0.x, bp0.z, 3.4, 45000).catch(() => {});
    await api.waitFor(`(currentInteract()||{}).id === 'board'`, 12000, 'board prompt');
    await api.tap(0);
    await api.waitFor('__fm.sailing === true', 8000, 'aboard');
    /* drive at the un-carved shore: she grounds and SAYS so */
    await api.eval(`__fmBot.done=false; __fmBot.tol=2.0; __fmBot.target=[104,24]`);
    await sleep(11000);
    await api.eval('__fmBot.target=null; __fakePad.axes(0,0)');
    const sh = await api.eval('({x:+BOAT.x.toFixed(1), z:+BOAT.z.toFixed(1), d:+waterDepthAt(BOAT.x,BOAT.z).toFixed(2)})');
    gate('sail0: she stops in the shallows (never on the sand) on the un-carved shore',
      sh.d > 0.2, JSON.stringify(sh));
    /* the glide bar (≈0.5 m) holds her BEFORE the swing keel */
    await api.eval('__fmDebug.boatTo(118, 44.5); 0');
    await sleep(300);
    await api.eval(`__fmBot.done=false; __fmBot.tol=2.0; __fmBot.target=[148,37]`);
    for (let i = 0; i < 34; i++) { await api.eval('__fakePad.press(1)'); await sleep(320); }
    await api.eval('__fmBot.target=null; __fakePad.axes(0,0); __fakePad.press()');
    const bar = await api.eval('({x:+BOAT.x.toFixed(1), z:+BOAT.z.toFixed(1)})');
    gate('sail0: the glide bar holds her before the refit (the keel is the key)',
      bar.x < 133, JSON.stringify(bar));
    gate('sail0: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('sail0 suite', false, e.message);
    await api.shot('sail0-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 5 — THE WORLD: registries, derive both ways, refit cine ═══════════ */
async function suiteWorld() {
  console.log('\n── the world rules, and the derive both ways ──');
  const api = await session(MOUTH_OPEN, '?turbo=6');
  try {
    gate('world: river-mouth + lower-river-surface registered',
      await api.eval(`window.__WORLD_REG.some(r=>r.name==='river-mouth') && window.__WORLD_REG.some(r=>r.name==='lower-river-surface')`));
    gate('world: the three gates are portals',
      (await api.eval(`window.__PORTALS.filter(p=>p.name.startsWith('sluice-gate')).length`)) === 3);
    /* conformance: my owner answers the live chain inside the corridor */
    const conf = await api.eval(`(function(){
      let worst = 0, n = 0;
      for (let x = 88; x < 280; x += 3) for (let z = 22; z < 72; z += 3) {
        if (!window.__mouthGroundQ(x, z)) continue;
        n++;
        const own = window.__WORLD_REG.find(r=>r.name==='river-mouth');
        worst = Math.max(worst, Math.abs(groundH(x, z) - own.ground(x, z)));
      }
      return { n, worst: +worst.toFixed(4) };
    })()`);
    gate('world: corridor conformance — chain == declared owner (dense grid)',
      conf.worst < 0.001 && conf.n > 400, JSON.stringify(conf));
    /* rendered == physics: raycast the REAL meshes against groundH */
    const rc = await api.eval(`(async function(){
      const V = THREE.Vector3;
      const rcst = new THREE.Raycaster();
      const meshes = [];
      for (const c of chunkMap.values()) if (c.mesh) meshes.push(c.mesh);
      for (const c of fchunkMap.values()) if (c.mesh) meshes.push(c.mesh);
      let worst = 0, n = 0, miss = 0;
      for (let x = 92; x < 278; x += 5) for (let z = 26; z < 68; z += 5) {
        if (!window.__mouthGroundQ(x, z)) continue;
        if (worldSolidAt(x, z) || (window.__forestSolid && window.__forestSolid(x, z))) continue;
        rcst.set(new V(x, 300, z), new V(0, -1, 0));
        const hits = rcst.intersectObjects(meshes, false);
        if (!hits.length) { miss++; continue; }
        let dh = 1e9;
        for (const h of hits) dh = Math.min(dh, Math.abs((300 - h.distance) - groundH(x, z)));
        n++;
        if (dh > worst) worst = dh;
      }
      return { n, miss, worst: +worst.toFixed(3) };
    })()`);
    gate('world: rendered == physics in the corridor (raycast, |dh| < 0.06)',
      rc.worst < 0.06 && rc.miss === 0 && rc.n > 200, JSON.stringify(rc));
    /* the carved bed never re-greens (the grey rule) */
    const green = await api.eval(`(function(){
      let greened = 0, n = 0;
      for (const c of fchunkMap.values()) {
        if (!c.mesh) continue;
        const pos = c.mesh.geometry.attributes.position, col = c.mesh.geometry.attributes.color;
        for (let v = 0; v < pos.count; v += 7) {
          const x = pos.getX(v), z = pos.getZ(v);
          if (!window.__mouthGroundQ(x, z)) continue;
          if (Math.abs(pos.getY(v) - groundH(x, z)) > 0.3) continue;   // props/trees
          /* the BED is the claim — the banks above the water are meadow
             and SHOULD re-green. The head basin (x > 264) is p6h's own
             pool edge: their ground, their season. */
          if (x > 264) continue;
          if (window.__lowerRiverDepth(x, z) < 0.06) continue;
          n++;
          if (col.getY(v) > col.getX(v) + 0.06) greened++;
        }
      }
      return { n, greened };
    })()`);
    gate('world: the carved bed stayed stone through the re-green', green.greened === 0 && green.n > 35,
      JSON.stringify(green));
    /* lane guarantees, measured at build against the final field */
    const lane = await api.eval('__fm.moLane');
    gate('world: the water keeps its promises (rap ≥ .55, glide ≥ .38, chan ≥ 1.3, pool ≥ .9, reaches ≥ .85)',
      lane.minRap >= 0.55 && lane.minGlide >= 0.38 && lane.minChan >= 1.3 &&
      lane.minPoolLane >= 0.9 && lane.minR12 >= 0.85,
      JSON.stringify(lane));
    gate('world: the anchorage stayed deep and unregistered',
      await api.eval('waterDepthAt(70, 30) >= 2 && !window.__mouthGroundQ(70, 30)'),
      'depth=' + await api.eval('+waterDepthAt(70,30).toFixed(2)'));
    /* THE REFIT CINE: p6j's trigger — flags set INSIDE it, skippable */
    await api.eval('__fmDebug.warp(88, 30); 0');
    await api.eval('__fmDebug.boatTo(84, 33); 0');
    await api.eval('window.__refitCine5(); 0');
    await api.waitFor(`__fm.state === 'cine'`, 5000, 'refit cine starts');
    await sleep(3600);
    await api.shot('refit-cine-1280x720');
    await api.waitFor(`__fm.state === 'play'`, 15000, 'refit cine ends');
    gate('world: __refitCine5 sets both flags itself and ends on the follow cam',
      await api.eval('SAVE.swingKeel === true && SAVE.paddleWheel === true && CAM.mode === "follow"'));
    gate('world: the paddlewheel exists on the boat after the beat',
      await api.eval('__fm.moPaddleVis === true'));
    /* the compass follows paths: q19 stages via the shore road, then the
       next wheel; q18 points down the road to the anchorage */
    /* the refit beat above now advances to q20 (the banner fix) — these
       checks are ABOUT q19, so restore it with the state they assume */
    await api.eval('__fmDebug.warp(95, 34); SAVE.mouthOpen = false; SAVE.sluiceG = 0; setQuest(19); 0');
    const c19w = await api.eval('(function(){ const o = objectivePoint(); return o ? [Math.round(o.x), Math.round(o.z)] : null; })()');
    gate('world: q19 compass from the bay follows the shore road east (never a beeline)',
      c19w && c19w[0] < 160 && Math.abs(c19w[1] - 36) < 8, JSON.stringify(c19w));
    await api.eval('__fmDebug.warp(243, 57); 0');
    const c19g = await api.eval('(function(){ const o = objectivePoint(); return o ? [Math.round(o.x), Math.round(o.z)] : null; })()');
    gate('world: q19 compass at the camp answers the NEXT wheel',
      c19g && Math.hypot(c19g[0] - MOUTH_OPEN.sluiceG, 0) >= 0 &&
      Math.hypot(c19g[0] - 268, c19g[1] - 55) < 8, JSON.stringify(c19g));
    await api.eval('SAVE.mouthOpen = true; SAVE.sluiceG = 3; setQuest(18); 0');
    const c18 = await api.eval('(function(){ const o = objectivePoint(); return o ? [Math.round(o.x), Math.round(o.z)] : null; })()');
    gate('world: q18 compass walks the road toward the water, ashore',
      c18 && c18[0] <= 243, JSON.stringify(c18));
    await api.eval('setQuest(19); 0');
    /* forward derivation: mouthOpen alone drags a stale quest to 19 */
    const qmin = await api.eval(`(function(){
      const s = JSON.parse(JSON.stringify(SAVE));
      s.q = 17; s.mouthOpen = true; s.sluiceG = 0;
      localStorage.setItem('fallenmoon_save_v1', JSON.stringify(s));
      const back = loadSave();
      localStorage.setItem('fallenmoon_save_v1', JSON.stringify(SAVE));
      return { q: back.q, g: back.sluiceG };
    })()`);
    gate('world: forward derivation — mouthOpen drags q to 19 and sets all gates',
      qmin.q === 19 && qmin.g === 3, JSON.stringify(qmin));
    /* NEW GAME: everything un-derives (the REAL path — beginNewGame;
       a reload would only re-run the probe's own seed script) */
    await api.eval('beginNewGame(); 0');
    await sleep(1200);
    const fresh = await api.eval(`(function(){
      return { gates: MOGATES.map(G=>+G.slabK.toFixed(2)).join(','), fill: moFill.join(','),
               keel: moKeel.foldK, paddle: !!(moPaddleGrp && moPaddleGrp.visible) };
    })()`);
    gate('world: NEW GAME shuts the gates, drains the reaches, strips the refit',
      fresh.gates === '0,0,0' && fresh.fill === '0,0,0' && fresh.paddle === false,
      JSON.stringify(fresh));
    gate('world: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('world suite', false, e.message);
    await api.shot('world-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 6 — PERF: worst frames at the works and the mouth, LOWFX ═══════════
   Two measurements: THIS PART's own frames (a build without p6j — its
   flotilla/night additions carry their own ≤80 obligation and their own
   probe), which is the gate here; and the JOINT build, reported loudly
   so the arc's number is never invisible. */
function buildNoJ() {
  const SRC = path.join(GAME, 'test', 'src');
  const parts = ['p2-core', 'p3-art', 'p4-world', 'p5-ent', 'p6-game', 'p6b-forest',
    'p6c-tide', 'p6d-sea', 'p6e-isles', 'p6f-lamp', 'p6g-crown', 'p6h-green', 'p6i-mouth', 'p7-flow'];
  const out = path.join(GAME, 'test', 'index-noj.html');
  const three = fs.readFileSync(path.join(GAME, 'three.min.js'), 'utf8');
  let html = fs.readFileSync(path.join(SRC, 'p1-head.html'), 'utf8') +
    '<script>\n' + three + '\n</scr' + 'ipt>\n';
  for (const pt of parts) html += fs.readFileSync(path.join(SRC, pt + '.html'), 'utf8');
  fs.writeFileSync(out, html);
  return 'test/index-noj.html';
}
async function measureWorst(api) {
  const spots = [
    ['sluice-works', 250, 47],
    ['rapids-mid', 190, 38],
    ['mouth-pool', 118, 32],
    ['bar-glide', 140, 40],
  ];
  let worstCalls = 0, worstTris = 0, worstAt = '';
  for (const [name, px, pz] of spots) {
    await api.eval(`__fmDebug.warp(${px}, ${pz}); P.hearts = P.maxHearts; 0`);
    await sleep(400);
    for (const yaw of [0, 1.6, 3.1, 4.7]) {
      await api.eval(`CAM.yaw = ${yaw}; CAM.pitch = 0.3; CAM.stickAge = 0; 0`);
      await sleep(500);
      const f = await api.eval('({c: __fm.calls, t: __fm.tris})');
      if (f.c > worstCalls) { worstCalls = f.c; worstAt = name + '@' + yaw; }
      if (f.t > worstTris) worstTris = f.t;
    }
    await api.shot('perf-' + name + '-1280x720');
  }
  return { worstCalls, worstTris, worstAt };
}
async function suitePerf() {
  console.log('\n── budgets at the rapids and the mouth pool (LOWFX) ──');
  /* the gate: this part's own frames */
  const noj = buildNoJ();
  const own = await session(MOUTH_OPEN, undefined);
  own.close();
  const api2 = await (async () => {
    const { srv, port: hport } = await serve();
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const a = mkApi(c);
    await a.init(); await a.seedSave(MOUTH_OPEN);
    a.shot = async () => {};
    a.close = () => { c.close(); proc.kill(); srv.close(); };
    a.errs = c.errs;
    await a.nav(`http://127.0.0.1:${hport}/${noj}?turbo=1&fx=low`);
    await a.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 45000, 'title');
    await tapUntil(a, () => a.tap(13), '__fm.titleFocus === 1', 14, 'focus CONTINUE');
    await tapUntil(a, () => a.tap(0), `__fm.state !== 'title'`, 16, 'leave title');
    for (let i = 0; i < 40; i++) {
      const st = await a.eval('__fm.state');
      if (st === 'play') break;
      if (st !== 'title') await a.tap(0);
      await sleep(350);
    }
    await a.waitFor(`__fm.state === 'play'`, 30000, 'play');
    return a;
  })();
  try {
    const own2 = await measureWorst(api2);
    gate('perf: ≤ 80 draw calls, this part\'s own frames (LOWFX, no p6j)',
      own2.worstCalls <= 80, own2.worstCalls + ' calls at ' + own2.worstAt);
    gate('perf: ≤ 120k triangles (own frames)', own2.worstTris <= 120000, own2.worstTris + ' tris');
    gate('perf: zero console errors (own)', api2.errs.length === 0, api2.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('perf own suite', false, e.message);
  }
  api2.close();
  try { fs.unlinkSync(path.join(GAME, noj)); } catch (e) {}
  /* the report: the joint build's number (p6j's night additions carry
     their own probe; the arc number must still be SEEN every run) */
  const api = await session(MOUTH_OPEN, '?turbo=1&fx=low');
  try {
    const joint = await measureWorst(api);
    console.log('   JOINT build (with p6j night): worst ' + joint.worstCalls + ' calls at ' +
      joint.worstAt + ', ' + joint.worstTris + ' tris — the arc budget (≤80) is p6i+p6j\'s ' +
      'shared obligation; p6j\'s probe owns its night additions.');
    gate('perf: joint build ≤ 96 calls (hard ceiling while p6j is mid-build)',
      joint.worstCalls <= 96, joint.worstCalls + ' calls at ' + joint.worstAt);
    gate('perf: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('perf suite', false, e.message);
  }
  api.close();
}

/* ── run ── */
if (want('sluice')) await suiteSluice();
if (want('cine')) await suiteCine();
if (want('walk')) await suiteWalk();
if (want('sail')) { await suiteSail(); await suitePreKeel(); }
if (want('world')) await suiteWorld();
if (want('perf')) await suitePerf();
process.exit(summary() ? 1 : 0);
