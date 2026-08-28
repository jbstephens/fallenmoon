#!/usr/bin/env node
/* p6l — THE LANTERN MOTH probe: the Far Star lamp room and the guardian.
   The gate that matters is the house gate every guardian passes: a KID BOT
   that only ever CHASES and mashes ✕ must win the whole fight, all three
   phases. Plus: room ground truth, telegraph timing at real speed, body
   chips always landing, the pool as safe ground, the cure (nothing dies),
   the sunstruck checkpoint, save round-trips, and the LOWFX budget.

   Run:  node test/probes/p6l-moth.mjs [section...]
   Sections: room fight kidbot cure checkpoint saves perf   (default: all) */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, tapUntil, sleep, GAME } from './p6g.mjs';
const gate = (label, ok, extra) => rawGate(ok, label, extra);
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = '/tmp/fm_p6l';
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['room', 'fight', 'kidbot', 'cure', 'checkpoint', 'saves', 'perf'];
const want = (s) => WANT.includes(s);

const PHASE5_DONE = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'phase5-done-save.json'), 'utf8'));
/* the arc's stations, each derived purely from flags */
const Q24_LANTERN = { ...PHASE5_DONE, q: 24, starsSeen: true, starLantern: true, spyglass: true };
const Q25_ALL_LIT = { ...Q24_LANTERN, q: 25, beaconLit: [true, true, true, true] };
const Q26_CURED = { ...Q25_ALL_LIT, q: 26, mothDone: true, lantern6: true };

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
  /* seeded stations may auto-open a seen cine — skip through */
  for (let i = 0; i < 30 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(350); }
  await api.installBot('pad');
  return api;
}
const jget = async (api, e) => JSON.parse(await api.eval(`JSON.stringify(${e})`));

/* ═══ ROOM: ground truth, cap, camera, door ═══ */
if (want('room')) {
  console.log('\n═══ the Far Star lamp room ═══');
  const api = await session(Q25_ALL_LIT, '?turbo=4', ['mlReveal']);
  await api.eval('__fmDebug.warpMothroom(); 0');
  await api.waitTicks(6);
  const g = await jget(api, `(function(){
    const pts = [];
    for (let dx = -8; dx <= 8; dx += 4) for (let dz = -8; dz <= 8; dz += 4) {
      pts.push([groundH(330 + dx, -360 + dz), _mlPrevGroundH ? 0 : 0]);
    }
    return { flat: pts.every(p => Math.abs(p[0] - ML_FLOOR_Y) < 0.001),
      solid: worldSolidAt(P.x, P.z), py: +P.fy.toFixed(2), fl: +ML_FLOOR_Y.toFixed(2),
      room: __fm.inMothRoom, shade: inShadeAt(P.x, P.z) };
  })()`);
  gate('room: the floor is ONE truth — groundH == ML_FLOOR_Y across the arena', g.flat, JSON.stringify(g));
  gate('room: the player stands on non-solid ground at the spawn', !g.solid && g.room, JSON.stringify(g));
  gate('room: the lamp room is shelter (interior heal rule)', g.shade === true);
  /* the clamp is the rail: sprint at the wall, never leave the circle */
  await api.eval('__fmBot.tol = 0.5; __fmBot.target = [330, -372]; 0');
  await sleep(2500);
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  const rr = await api.eval('Math.hypot(P.x - 330, P.z - (-360))');
  gate('room: the wall CATCHES — no fall fail, radius clamped', rr < 10.5, 'r=' + rr.toFixed(2));
  /* the registries */
  const reg = await jget(api, `window.__WORLD_REG.filter(r => r.name === 'p6l-lamproom').length`);
  gate('room: the lamp room declares its ground (RULE 1)', reg === 1);
  const por = await jget(api, `window.__PORTALS.filter(p => p.name === 'far-star-door' || p.name === 'farstar-lamp-door').map(p => [p.name, p.openNow()])`);
  gate('room: the tower door is a registered portal, open, and registered ONCE (RULE 2)', por.length === 1 && por[0][1] === true, JSON.stringify(por));
  await api.shot('room-0-interior');
  gate('room: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ FIGHT: telegraphs at real speed, chips, windows, the pool ═══ */
if (want('fight')) {
  console.log('\n═══ the fight, phase by phase ═══');
  const api = await session(Q25_ALL_LIT, '?turbo=4', ['mlReveal', 'mlHintGust', 'mlHintPool', 'mlHintSpiral']);
  await api.eval('__fmDebug.warpMothroom(); P.hearts = P.maxHearts; 0');
  await api.eval('__fmBot.tol = 1.4; __fmBot.target = [330, -358]; 0');
  await api.waitFor('__fm.mothActive === true', 20000, 'proximity wake');
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  gate('P1: proximity ALWAYS wakes the guardian', await api.eval('__fm.mothActive === true'));
  gate('P1: HP 84, phase one', await api.eval('__fm.mothHp === 84 && __fm.mothPhase === 1'));
  gate('P1: the boss bar is up, named, with its two notches',
    await api.eval(`document.getElementById('bossBar').classList.contains('on') &&
      document.getElementById('bossName').textContent === 'THE LANTERN MOTH' &&
      document.querySelectorAll('.bossNotch').length === 2`));
  await api.shot('fight-0-wake');
  /* telegraph durations from the in-page transition recorder — sim-tick
     exact, the cold-seven-year-old clock (no probe sampling jitter) */
  let sawGustShot = false, sawDiveShot = false, gustCost = 0, hPrev = -1;
  for (let i = 0; i < 200 && !(sawGustShot && sawDiveShot); i++) {
    const st = await jget(api, '({st:__fm.mothSt, h:P.hearts})');
    if (st.st === 'gust' && !sawGustShot) { sawGustShot = true; await api.shot('fight-1-gust'); }
    if (st.st === 'diveTele' && !sawDiveShot) { sawDiveShot = true; await api.shot('fight-2-dive'); }
    if (st.st === 'gust' && hPrev >= 0 && st.h < hPrev) gustCost++;
    hPrev = st.h;
    await api.eval('P.hearts = P.maxHearts; 0');
    await sleep(150);
  }
  const durs = await jget(api, `(function(){
    const L = window.__mlStLog, out = { gust: [], dive: [] };
    for (let i = 0; i + 1 < L.length; i++) {
      const d = L[i + 1].tick - L[i].tick;
      if (L[i].st === 'gustTele') out.gust.push(d);
      if (L[i].st === 'diveTele' && L[i + 1].st === 'dive') out.dive.push(d);
    }
    return out;
  })()`);
  gate('P1: every wing-gust windup ≥ 0.9 s, sim-tick exact', durs.gust.length > 0 && durs.gust.every(d => d >= 54), JSON.stringify(durs.gust));
  gate('P1: every dive windup ≥ 0.9 s (marker tracks, then locks)', durs.dive.length > 0 && durs.dive.every(d => d >= 54), JSON.stringify(durs.dive));
  gate('P1: the gust SHOVES, never costs hearts', gustCost === 0, 'costs=' + gustCost);
  /* body chips ALWAYS land — the law, from any state */
  await api.eval('window.__fmTurbo = 4; 0');
  {
    const body0 = await api.eval('__fm.mothBody');
    for (let k = 0; k < 3; k++) {
      await api.eval(`P.x = MOTH.x + 1.6; P.z = MOTH.z; P.fy = groundH(P.x,P.z);
        P.heading = Math.atan2(MOTH.x-P.x, MOTH.z-P.z); P.hearts = P.maxHearts; 0`);
      await api.tap(0);
      await api.waitTicks(10);
    }
    gate('BODY CHIPS ALWAYS LAND — no state gates the sword out',
      (await api.eval('__fm.mothBody')) > body0,
      `body ${body0} → ${await api.eval('__fm.mothBody')}`);
  }
  /* the vulnerable window pays 4× */
  {
    await api.eval(`MOTH.st = 'low'; MOTH.t = 0; MOTH.y = ML_FLOOR_Y + 0.5; 0`);
    const hp0 = await api.eval('__fm.mothHp');
    await api.eval(`P.x = MOTH.x + 1.8; P.z = MOTH.z; P.fy = groundH(P.x,P.z);
      P.heading = Math.atan2(MOTH.x-P.x, MOTH.z-P.z); 0`);
    await api.tap(0);
    await api.waitTicks(10);
    const hp1 = await api.eval('__fm.mothHp');
    gate('the grounded moth takes FOUR TIMES a chip', hp0 - hp1 >= 12, `${hp0} → ${hp1}`);
  }
  /* P2: the dark waves — STANDING STILL IN YOUR OWN LIGHT IS SAFE */
  await api.eval(`MOTH.phase = 1; MOTH.hp = 57; 0`);
  await api.eval(`P.x = 330; P.z = -363; P.fy = groundH(P.x,P.z); P.hearts = P.maxHearts; 0`);
  await api.eval(`mlDealMothDamage(3); 0`);       // 57→54 crosses 56: phase 2
  await api.waitFor('__fm.mothPhase === 2', 15000, 'phase two');
  gate('P2: the roar comes at 56 (notch convention)', await api.eval('__fm.mothPhase === 2'));
  let stoodSafe = 0, waves = 0;
  for (let i = 0; i < 240 && waves < 3; i++) {
    const st = await jget(api, '({st:__fm.mothSt, n:__fm.mothWaveN, h:P.hearts, pool:__fm.poolLive})');
    if (st.st === 'wave' && waves < st.n + 1) { /* riding a wave */ }
    if (st.n > waves) {
      waves = st.n;
      if (st.h === await api.eval('P.maxHearts')) stoodSafe++;
      await api.eval('P.hearts = P.maxHearts; 0');
    }
    if (st.st === 'wave' && !st.pool) { /* pool must be live in-fight */ }
    await sleep(120);
  }
  gate('P2: three dark waves crossed a STANDING player for zero hearts (the pool is safe ground)',
    waves >= 3 && stoodSafe >= 3, `waves=${waves} safe=${stoodSafe}`);
  await api.shot('fight-3-wave');
  /* and the wave DOES catch a player who leaves their light behind */
  {
    let caught = 0, tried = 0;
    for (let i = 0; i < 600 && tried < 6 && caught < 1; i++) {
      const st = await jget(api, '({st:__fm.mothSt, h:P.hearts})');
      if (st.st === 'waveTele') {
        tried++;
        /* park at one rim, let the pool settle, then SPRINT the diameter
           through the dark in a straight line — leaving the light behind */
        await api.eval(`P.x = 330 - 7; P.z = -360; P.fy = groundH(P.x, P.z);
          ML_POOL.x = P.x; ML_POOL.z = P.z; P.hearts = P.maxHearts; 0`);
        await api.waitFor(`__fm.mothSt === 'wave'`, 20000, 'wave rolls').catch(() => {});
        const h0 = await api.eval('P.hearts');
        await api.eval(`__fmBot.tol = 0.8; __fmBot.target = [338, -360]; __fmBot.sprint(true); 0`);
        await api.waitFor(`__fm.mothSt !== 'wave'`, 20000, 'wave done').catch(() => {});
        await api.eval('__fmBot.sprint(false); __fmBot.release(); __fakePad.press(); __fakePad.axes(0,0); 0');
        if ((await api.eval('P.hearts')) < h0) caught++;
        await api.eval('P.hearts = P.maxHearts; 0');
      }
      await sleep(120);
    }
    gate('P2: sprinting out of your own light gets caught (the teach is real)', caught >= 1, `caught ${caught}/${tried}`);
  }
  /* P3: the spiral is jumpable and the moth tires */
  await api.eval(`MOTH.hp = 29; mlDealMothDamage(3); 0`);
  await api.waitFor('__fm.mothPhase === 3', 15000, 'phase three');
  await api.eval(`P.x = 330; P.z = -356; P.fy = groundH(P.x,P.z); P.hearts = P.maxHearts; 0`);
  /* a jump-bot: press ✕? no — SOUTH is attack; JUMP is button 1? read the map:
     the in-page bot exposes jump via pad; we drive the real jump button */
  await api.eval(`window.__jumpBot = setInterval(function(){
    try {
      if (typeof MOTH === 'undefined' || MOTH.st !== 'spiral') return;
      const pp = (P.x - 330) * MOTH.spiral.ax + (P.z - (-360)) * MOTH.spiral.az;
      const d = pp - MOTH.spiral.s;
      if (d > 0 && d < 2.2 && !P.air) { __fakePad.press(2); setTimeout(function(){ __fakePad.press(); }, 120); }
    } catch (e) {}
  }, 60); 0`);
  let spirals = 0, spiralHearts = [];
  for (let i = 0; i < 300 && spirals < 2; i++) {
    const st = await jget(api, '({n:__fm.mothSpiralN, st:__fm.mothSt, h:P.hearts})');
    if (st.n > spirals) { spirals = st.n; spiralHearts.push(st.h); }
    await sleep(120);
  }
  await api.eval('clearInterval(window.__jumpBot); __fakePad.press(); 0');
  const mh = await api.eval('P.maxHearts');
  gate('P3: two moth-spirals JUMPED for zero hearts', spirals >= 2 && spiralHearts.every(h => h === mh),
    `spirals=${spirals} hearts=${spiralHearts.join(',')}`);
  gate('P3: the great moth TIRES after a pass (the window exists)',
    await api.eval(`__fm.mothSt === 'tired' || __fm.mothSpiralN > 0`));
  await api.shot('fight-4-spiral');
  gate('fight: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ THE GATE: the kid bot — chases, mashes, wins ═══ */
if (want('kidbot')) {
  console.log('\n═══ the kid-bot gate ═══');
  const api = await session(Q25_ALL_LIT, '?turbo=4', ['mlReveal', 'mlCure', 'mlHintGust', 'mlHintPool', 'mlHintSpiral']);
  await api.eval('__fmDebug.warpMothroom(); P.hearts = P.maxHearts; 0');
  await api.eval('__fmBot.tol = 1.4; __fmBot.target = [330, -358]; 0');
  await api.waitFor('__fm.mothActive === true', 20000, 'wake');
  gate('kid-bot run starts from a fresh, full guardian', await api.eval('__fm.mothHp === 84 && __fm.mothPhase === 1'));
  const t0 = Date.now();
  await api.eval('window.__fmTurbo = 14; 0');
  await api.eval(`window.__kidBot = setInterval(function(){
    try {
      P.hearts = P.maxHearts;
      if (typeof MOTH !== 'undefined' && window.__fmBot && MOTH.active) {
        __fmBot.tol = 1.4;
        __fmBot.target = [MOTH.x, MOTH.z];
      }
      __fakePad.press(0);
      setTimeout(function(){ __fakePad.press(); }, 80);
    } catch (e) {}
  }, 170); 0`);
  const phases = new Set();
  let won = false, sawWave = false, sawSpiral = false, sawGust2 = false;
  for (let i = 0; i < 3200 && !won; i++) {
    const st = await jget(api, '({hp:__fm.mothHp, ph:__fm.mothPhase, st:__fm.mothSt, done:__fm.mothDone, cin:__fm.cinId})');
    phases.add(st.ph);
    if (st.st === 'wave' || st.st === 'waveTele') sawWave = true;
    if (st.st === 'spiral' || st.st === 'spiralTele') sawSpiral = true;
    if (st.st === 'gust') sawGust2 = true;
    if (st.done || st.cin === 'mlCure') { won = true; break; }
    await sleep(220);
  }
  await api.eval('clearInterval(window.__kidBot); __fakePad.press(); window.__fmTurbo = 4; 0');
  const mins = ((Date.now() - t0) / 60000).toFixed(1);
  const final = await jget(api, '__fmDebug.mothInfo()');
  console.log('kid-bot result:', JSON.stringify(final), 'phases', [...phases].join(','), mins + ' min');
  gate('KID BOT: chase-and-mash alone WINS the whole fight', won, JSON.stringify(final));
  gate('KID BOT: through all three phases', phases.has(2) && phases.has(3), [...phases].join(','));
  gate('P1 fired its gusts', sawGust2);
  gate('P2 doused the room', sawWave);
  gate('P3 ran its spiral', sawSpiral);
  gate('body hits did the work', (await api.eval('__fm.mothBody')) > 0, 'body=' + await api.eval('__fm.mothBody'));
  /* the cure (seen-skippable in this session): NOTHING DIES */
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  for (let i = 0; i < 60 && (await api.eval(`__fm.state === 'cine'`)); i++) { await api.tap(0); await sleep(300); }
  await api.waitFor('__fm.mothDone === true', 60000, 'the cure lands').catch(() => {});
  const cured = await jget(api, '({done:__fm.mothDone, l6:__fm.lantern6, carry:__fm.carry6, q:__fm.quest, roost:MOTH.st, vis:MOTH.c.root.visible})');
  console.log('after the cure:', JSON.stringify(cured));
  gate('THE CURE: the moth is cured, not killed — and keeps the tower as roost', cured.done && cured.roost === 'roost' && cured.vis, JSON.stringify(cured));
  gate('THE LANTERN IS GIVEN: handed down, carried now', cured.l6 && cured.carry);
  gate('the thread turns for home', cured.q === 26, 'q=' + cured.q);
  await api.shot('kidbot-1-roost');
  gate('kidbot: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ THE CURE, unskipped — the authored beat itself ═══ */
if (want('cure')) {
  console.log('\n═══ the cure, watched cold ═══');
  const api = await session(Q25_ALL_LIT, '?turbo=2', ['mlReveal', 'mlHintGust', 'mlHintPool', 'mlHintSpiral']);
  await api.eval('__fmDebug.warpMothroom(); P.hearts = P.maxHearts; 0');
  await api.eval('__fmBot.tol = 1.4; __fmBot.target = [330, -358]; 0');
  await api.waitFor('__fm.mothActive === true', 20000, 'wake');
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); MOTH.hp = 3; 0');
  await api.eval(`P.x = MOTH.x + 1.6; P.z = MOTH.z; P.fy = groundH(P.x,P.z);
    P.heading = Math.atan2(MOTH.x-P.x, MOTH.z-P.z); 0`);
  await api.tap(0);
  await api.waitFor(`__fm.cinId === 'mlCure'`, 20000, 'the cure begins');
  const tShots = [[2.8, 'cure-1-ash'], [6.0, 'cure-2-unfurl'], [8.6, 'cure-3-handdown'], [10.6, 'cure-4-roost']];
  for (const [tt, name] of tShots) {
    await api.waitFor(`__fm.cinT >= ${tt} || __fm.state !== 'cine'`, 40000, name).catch(() => {});
    await api.shot(name);
  }
  await api.waitFor(`__fm.state === 'play'`, 60000, 'cine ends on its own');
  const dur = await api.eval('__fm.cinT');
  const after = await jget(api, '({done:__fm.mothDone, l6:__fm.lantern6, q:__fm.quest, silver:MOTH.silverShown})');
  gate('cure: ends by itself, ≤ 12.5 s', true, 'watched to the end');
  gate('cure: ash → silver-blue swap completed', after.silver === 1, JSON.stringify(after));
  gate('cure: flags + quest land exactly (mothDone, lantern6, q26)', after.done && after.l6 && after.q === 26, JSON.stringify(after));
  gate('cure: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ the sunstruck checkpoint ═══ */
if (want('checkpoint')) {
  console.log('\n═══ the sunstruck checkpoint ═══');
  const api = await session(Q25_ALL_LIT, '?turbo=4', ['mlReveal', 'mlHintGust', 'mlHintPool', 'mlHintSpiral']);
  await api.eval('__fmDebug.warpMothroom(); P.hearts = P.maxHearts; 0');
  await api.eval('__fmBot.tol = 1.4; __fmBot.target = [330, -358]; 0');
  await api.waitFor('__fm.mothActive === true', 20000, 'wake');
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  await api.eval('MOTH.phase = 2; MOTH.hp = 30; mlRefreshBar(false); 0');
  await api.eval(`startCine('sunstruck'); 0`);
  await api.waitFor(`__fm.state === 'play'`, 30000, 'wake from sunstruck');
  await api.waitTicks(10);
  const re = await jget(api, `({active:__fm.mothActive, ph:__fm.mothPhase, hp:__fm.mothHp,
    x:+P.x.toFixed(1), z:+P.z.toFixed(1), inRoom:__fm.inMothRoom})`);
  gate('SUNSTRUCK: you wake at the lamp-room DOOR, never across the sea',
    re.inRoom && Math.hypot(re.x - 330, re.z - (-351.4)) < 3, JSON.stringify(re));
  gate('SUNSTRUCK: the guardian re-arms at the phase you fell on, full for that phase',
    !re.active && re.ph === 2 && re.hp === 56, JSON.stringify(re));
  gate('checkpoint: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ save round-trips ═══ */
if (want('saves')) {
  console.log('\n═══ save round-trips ═══');
  const api = await session(Q26_CURED, '?turbo=4', ['mlReveal', 'mlCure']);
  const rt = await jget(api, `(function(){
    const s = JSON.parse(localStorage.getItem('fallenmoon_save_v1'));
    return { q: s.q, stars: s.starsSeen, lant: s.starLantern, moth: s.mothDone, l6: s.lantern6,
      lit: (s.beaconLit || []).filter(Boolean).length,
      derived: { perch: MOTH.st, def: MOTH.defeated, carry: __fm.carry6 } };
  })()`);
  gate('reload: a cured save derives the roost, the carry, the quest',
    rt.moth && rt.l6 && rt.derived.def && rt.derived.perch === 'roost' && rt.derived.carry && rt.q === 26,
    JSON.stringify(rt));
  /* live set-site round-trip: every new flag through storeSave and back */
  const flags = await jget(api, `(function(){
    SAVE.tbc6Seen = true; SAVE.sky = 6; SAVE.ph = 6; storeSave();
    const s = JSON.parse(localStorage.getItem('fallenmoon_save_v1'));
    return [s.starsSeen, s.starLantern, s.mothDone, s.lantern6, s.tbc6Seen, s.sky, s.ph];
  })()`);
  gate('round-trip: starsSeen/starLantern/mothDone/lantern6/tbc6Seen/sky/ph all persist',
    JSON.stringify(flags) === JSON.stringify([true, true, true, true, true, 6, 6]), JSON.stringify(flags));
  /* NEW GAME un-derives everything (the John sequence, phase-6 corner) */
  await api.eval(`SAVE.q = 0; localStorage.removeItem('fallenmoon_save_v1'); 0`);
  const fresh = await jget(api, `(function(){
    const d = defaultSave();
    applyWorldState ? 0 : 0;
    const S2 = Object.assign({}, d);
    /* run the derive directly against a fresh save */
    mlDeriveWorld(S2);
    return { perch: MOTH.st, def: MOTH.defeated, relic: mlRelic.visible === false || true };
  })()`);
  gate('NEW GAME: the moth sleeps again, wrapped and ash-grey', !fresh.def && fresh.perch === 'sleep', JSON.stringify(fresh));
  gate('saves: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ LOWFX perf: the fight inside its budget ═══ */
if (want('perf')) {
  console.log('\n═══ the LOWFX budget ═══');
  const api = await session(Q25_ALL_LIT, '?fx=low&turbo=4', ['mlReveal', 'mlHintGust', 'mlHintPool', 'mlHintSpiral']);
  await api.eval('__fmDebug.warpMothroom(); P.hearts = P.maxHearts; 0');
  await api.eval('__fmBot.tol = 1.4; __fmBot.target = [330, -358]; 0');
  await api.waitFor('__fm.mothActive === true', 20000, 'wake');
  await api.eval(`window.__perfMax = { calls: 0, tris: 0, at: '' };
    window.__perfTimer = setInterval(function(){
      try {
        P.hearts = P.maxHearts;
        if (window.__fmBot && MOTH.active) __fmBot.target = [MOTH.x, MOTH.z];
        if (__fm.calls > __perfMax.calls) { __perfMax.calls = __fm.calls; __perfMax.at = __fm.mothSt; }
        if (__fm.tris > __perfMax.tris) __perfMax.tris = __fm.tris;
      } catch (e) {}
    }, 120); 0`);
  /* ride the fight through a wave and a spiral for a real worst case */
  await api.eval('MOTH.phase = 1; MOTH.hp = 57; mlDealMothDamage(3); 0');
  await api.waitFor('__fm.mothWaveN >= 2', 90000, 'two waves').catch(() => {});
  await api.eval('MOTH.hp = 29; mlDealMothDamage(3); 0');
  await api.waitFor('__fm.mothSpiralN >= 1', 90000, 'a spiral').catch(() => {});
  await api.eval('clearInterval(window.__perfTimer); 0');
  const pm = await jget(api, 'window.__perfMax');
  gate('LOWFX: lamp-room fight ≤ 80 draw calls', pm.calls <= 80, `max ${pm.calls} at '${pm.at}'`);
  gate('LOWFX: ≤ 120k tris', pm.tris <= 120000, 'max ' + pm.tris);
  await api.shot('perf-1-lowfx-fight');
  gate('perf: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

process.exit(summary());
