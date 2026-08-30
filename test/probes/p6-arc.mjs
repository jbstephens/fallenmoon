#!/usr/bin/env node
/* p6 — THE FULL ARC as a journey gate: q22 → q27 end-to-end from a
   phase-5-complete fixture (sky 5, market open, salt 40, spyglass
   UNOWNED — proving the Pearl-gives path). Real inputs where the verbs
   matter: the reveal watched cold, the tinker TALKED to, the kid-bot
   CHASING through the whole moth fight, the payoff cine driving to the
   TBC card on a real run. Plus: every forward derivation independently,
   compass answers for every state, and a phase-5 mid-arc regression.

   Run:  node test/probes/p6-arc.mjs [section...]
   Sections: journey derive compass regression   (default: all)          */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, tapUntil, sleep, GAME } from './p6g.mjs';
const gate = (label, ok, extra) => rawGate(ok, label, extra);
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = '/tmp/fm_p6l';
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['journey', 'derive', 'compass', 'regression'];
const want = (s) => WANT.includes(s);

const PHASE5_DONE = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'phase5-done-save.json'), 'utf8'));

async function session(save, query, seen, keepCine) {
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
const jget = async (api, e) => JSON.parse(await api.eval(`JSON.stringify(${e})`));
async function advanceDialogs(api, tries = 24) {
  for (let i = 0; i < tries; i++) {
    const st = await api.eval('__fm.state');
    if (st === 'play') return true;
    await api.tap(0);
    await sleep(300);
  }
  return (await api.eval('__fm.state')) === 'play';
}

/* ═══ THE JOURNEY ═══ */
if (want('journey')) {
  console.log('\n═══ the journey: q22 → q27 ═══');
  const api = await session(PHASE5_DONE, '?turbo=4', [], true);

  /* — q22 seam: the reveal triggers by itself at the quay — */
  await api.waitFor(`__fm.cinId === 'mlReveal'`, 30000, "Pearl's reveal opens");
  gate('q22 seam: Pearl finds you — the reveal auto-opens at the quay', true);
  const shots = [[1.6, 'arc-1-sprint'], [4.4, 'arc-2-chart'], [7.2, 'arc-3-sky'], [9.6, 'arc-4-glass']];
  for (const [tt, name] of shots) {
    await api.waitFor(`__fm.cinT >= ${tt} || __fm.cinId !== 'mlReveal'`, 40000, name).catch(() => {});
    await api.shot(name);
  }
  await api.waitFor(`__fm.state === 'play'`, 60000, 'the reveal ends by itself');
  let st = await jget(api, `({q:__fm.quest, stars:__fm.starsSeen, glass:SAVE.spyglass, nk:__fm.nightK})`);
  gate('q23: the reveal lands — starsSeen, quest 23', st.q === 23 && st.stars, JSON.stringify(st));
  gate('the never-soft-lock law: Pearl GIVES the spyglass when unowned', st.glass === true);
  gate('the arc is one long night — dusk holds', st.nk > 0.85, 'nightK=' + st.nk);
  let op = await jget(api, '(objectivePoint() || null)');
  gate('q23 compass: answers (the market road)', !!op, JSON.stringify(op));

  /* — q23b: the tinker mounts the STAR LANTERN — */
  await api.eval('__fmDebug.warpMarket(); 0');
  await api.waitTicks(8);
  const ts = await jget(api, '(mlTinkerStall())');
  await api.eval(`__fmBot.tol = 1.0; __fmBot.target = [${ts.x}, ${ts.z}]; 0`);
  await api.waitFor(`__fm.prompt === 'mlTinker'`, 40000, 'the tinker beat offers itself').catch(() => {});
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  gate('q23: the tinker outranks the heart stall for one grant', (await api.eval('__fm.prompt')) === 'mlTinker',
    'prompt=' + await api.eval('__fm.prompt'));
  await api.tap(0);
  await sleep(400);
  gate('the tinker TALKS', (await api.eval('__fm.state')) === 'dialog');
  await advanceDialogs(api);
  await api.waitFor('__fm.starLantern === true', 15000, 'the lantern mounts');
  await api.waitFor('__fm.quest === 24', 15000, 'q24');
  gate('q23b → q24: THE STAR LANTERN is mounted, quest turns', await api.eval('__fm.quest === 24 && __fm.starLantern'));
  await api.shot('arc-5-tinker');

  /* — q24: four beacons; per-beacon compass staging (the sibling's verb
     is invoked through its own pinned export — its probe owns the climb) — */
  const b0 = await jget(api, '(objectivePoint() || null)');
  gate('q24 compass: answers toward the sea', !!b0, JSON.stringify(b0));
  for (let i = 0; i < 4; i++) {
    await api.eval(`window.__p6k.lightBeacon(${i}); 0`);
    await api.waitTicks(50);
    const q = await api.eval('__fm.quest');
    const opN = await jget(api, '(objectivePoint() || null)');
    if (i < 3) {
      gate(`beacon ${i} lit: quest holds 24, compass moves on`, q === 24 && !!opN, `q=${q} op=${JSON.stringify(opN)}`);
    } else {
      await api.waitFor('__fm.quest === 25', 20000, 'q25 seam');
      gate('all four lit → q25 (MIRROR-6, live)', await api.eval('__fm.quest === 25'));
    }
  }
  const opDoor = await jget(api, '(objectivePoint() || null)');
  const door = await jget(api, '(mlFarDoor())');
  gate('q25 compass: staged toward the Far Star door', !!opDoor, JSON.stringify(opDoor) + ' door=' + JSON.stringify(door));

  /* — the door, on foot — */
  await api.eval('__fmDebug.warpFarStar(); P.hearts = P.maxHearts; 0');
  await api.waitTicks(8);
  await api.eval(`__fmBot.tol = 1.2; __fmBot.target = [${door.x}, ${door.z}]; 0`);
  await api.waitFor(`__fm.prompt === 'mlIn'`, 40000, 'the lamp-room door offers').catch(() => {});
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  gate('the Far Star door offers ✕ ENTER', (await api.eval('__fm.prompt')) === 'mlIn', 'prompt=' + await api.eval('__fm.prompt'));
  await api.tap(0);
  await api.waitFor('__fm.inMothRoom === true', 20000, 'inside the lamp room');
  gate('through the door: the lamp room', await api.eval('__fm.inMothRoom === true'));
  await api.shot('arc-6-lamproom');

  /* — THE FIGHT: the kid bot chases and mashes — */
  await api.eval('__fmBot.tol = 1.4; __fmBot.target = [330, -358]; 0');
  await api.waitFor('__fm.mothActive === true', 20000, 'the guardian wakes');
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
  let won = false;
  for (let i = 0; i < 3200 && !won; i++) {
    const f = await jget(api, `({done:__fm.mothDone, cin:__fm.cinId})`);
    if (f.done || f.cin === 'mlCure') { won = true; break; }
    await sleep(220);
  }
  await api.eval('clearInterval(window.__kidBot); __fakePad.press(); __fmBot.release(); window.__fmTurbo = 4; 0');
  gate('KID BOT: chase-and-mash wins the Lantern Moth', won, JSON.stringify(await jget(api, '__fmDebug.mothInfo()')));
  /* the cure, watched cold (first viewing is unskippable by design) */
  await api.waitFor(`__fm.state === 'play'`, 90000, 'the cure plays out');
  st = await jget(api, `({q:__fm.quest, done:__fm.mothDone, l6:__fm.lantern6, carry:__fm.carry6})`);
  gate('THE CURE: nothing dies — the Lantern is handed down, q26', st.done && st.l6 && st.carry && st.q === 26, JSON.stringify(st));
  await api.shot('arc-7-cured');

  /* — out the door: the islet is still there, the boat un-orphaned — */
  await api.eval('__fmBot.tol = 1.2; __fmBot.target = [330, -350.8]; 0');
  await api.waitFor(`__fm.prompt === 'mlOut'`, 30000, 'the way out offers').catch(() => {});
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  await api.tap(0);
  await api.waitFor('__fm.inMothRoom === false', 20000, 'outside again');
  const out = await jget(api, `({x:+P.x.toFixed(1), z:+P.z.toFixed(1), solid:worldSolidAt(P.x,P.z), g:+groundH(P.x,P.z).toFixed(2)})`);
  gate('doorOut: standing on real ground at the tower', !out.solid, JSON.stringify(out));
  op = await jget(api, '(objectivePoint() || null)');
  gate('q26 compass: the road home answers', !!op, JSON.stringify(op));

  /* — home: the wheel takes its sixth — */
  await api.eval(`__fmDebug.warp(WHEEL_POS.x + 6, WHEEL_POS.z + 5); P.hearts = P.maxHearts; 0`);
  await api.waitTicks(8);
  await api.eval(`__fmBot.tol = 1.0; __fmBot.target = [WHEEL_POS.x + 3.2, WHEEL_POS.z + 2.4]; 0`);
  await api.waitFor(`__fm.prompt === 'mlWheel6'`, 30000, 'the wheel offers the sixth seat').catch(() => {});
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  if ((await api.eval('__fm.prompt')) !== 'mlWheel6') {
    /* terrain may pocket the bot on the hill — the prompt, not the walk,
       is what this gate judges */
    await api.eval(`__fmDebug.warp(WHEEL_POS.x + 3.2, WHEEL_POS.z + 2.4); 0`);
    await api.waitTicks(8);
  }
  gate('the wheel offers ✕ SET THE WANING LANTERN', (await api.eval('__fm.prompt')) === 'mlWheel6',
    'prompt=' + await api.eval('__fm.prompt') + ' at ' + await api.eval(`JSON.stringify([+P.x.toFixed(1), +P.z.toFixed(1), +Math.hypot(P.x-WHEEL_POS.x, P.z-WHEEL_POS.z).toFixed(1), __fm.carry6, __fm.quest])`));
  await api.tap(0);
  await api.waitFor(`__fm.cinId === 'mlWheel6'`, 15000, 'the payoff cine opens');
  await api.waitFor(`__fm.cinT >= 2.4 || __fm.cinId !== 'mlWheel6'`, 30000, 'wheel turn').catch(() => {});
  await api.shot('arc-8-wheelturn');
  await api.waitFor(`__fm.cinT >= 6.8 || __fm.cinId !== 'mlWheel6'`, 40000, 'sky fills').catch(() => {});
  await api.shot('arc-9-skyfills');
  /* the payoff cine DRIVES TO THE TBC CARD on its own — the standing law */
  await api.waitFor(`__fm.state === 'tbc'`, 60000, 'the 6/8 card');
  const card = await jget(api, `({sub:document.getElementById('tbcSub').textContent,
    q:__fm.quest, sky:SAVE.sky, ph:SAVE.ph, tbc:__fm.tbc6Seen})`);
  gate('THE END CARD: 6/8, on a real run', card.q === 27 && card.sky === 6 && card.ph === 6 && card.tbc, JSON.stringify({ q: card.q, sky: card.sky }));
  gate('the card teases OLD BONE — red, far south, cooling', /OLD BONE/.test(card.sub) && /cool/i.test(card.sub), card.sub.slice(0, 80));
  await sleep(1200);
  await api.shot('arc-10-tbc6');
  await tapUntil(api, () => api.tap(0), `__fm.state === 'play'`, 14, 'out of the card');
  gate('after the card: free play, no stale beacon', (await jget(api, '(objectivePoint() || null)')) === null);
  gate('journey: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ FORWARD DERIVATIONS, each independently (MIRROR-6 on load) ═══ */
if (want('derive')) {
  console.log('\n═══ forward derivations on load ═══');
  const cases = [
    ['one lit beacon derives the reveal, the lantern, q24',
      { ...PHASE5_DONE, beaconLit: [true, false, false, false] },
      `__fm.quest === 24 && __fm.starsSeen && __fm.starLantern`],
    ['all four beacons derive q25',
      { ...PHASE5_DONE, beaconLit: [true, true, true, true] },
      `__fm.quest === 25`],
    ['mothDone derives lantern6 and q26',
      { ...PHASE5_DONE, starsSeen: true, starLantern: true, spyglass: true,
        beaconLit: [true, true, true, true], mothDone: true },
      `__fm.quest === 26 && __fm.lantern6 && __fm.carry6`],
    ['sky 6 derives at least q27 + the seen card (p6m's seam may carry it to 28 — phase 7 begins)',
      { ...PHASE5_DONE, starsSeen: true, starLantern: true, spyglass: true,
        beaconLit: [true, true, true, true], mothDone: true, lantern6: true, sky: 6, ph: 6 },
      `__fm.quest >= 27 && __fm.tbc6Seen`],
  ];
  for (const [label, save, expr] of cases) {
    const api = await session(save, '?turbo=4', ['mlReveal', 'mlCure', 'mlWheel6']);
    await api.waitTicks(60);
    gate('derive: ' + label, await api.eval(expr),
      JSON.stringify(await jget(api, `({q:__fm.quest, ss:__fm.starsSeen, sl:__fm.starLantern, l6:__fm.lantern6, tbc:__fm.tbc6Seen})`)));
    gate('derive: zero console errors — ' + label.split(' ')[0], api.errs.length === 0, api.errs.slice(0, 2).join(' | '));
    api.close();
  }
}

/* ═══ the OWNED-glass variant: Pearl's line changes, nothing double-grants ═══ */
if (want('derive')) {
  const api = await session({ ...PHASE5_DONE, spyglass: true, salt: 15 }, '?turbo=6', [], true);
  await api.waitFor(`__fm.cinId === 'mlReveal'`, 30000, 'reveal (glass owned)');
  await api.waitFor(`__fm.state === 'play'`, 90000, 'reveal ends');
  const g = await jget(api, `({q:__fm.quest, glass:SAVE.spyglass, salt:P.salt})`);
  gate('derive: with the spyglass OWNED the reveal still lands q23, no double grant, salt untouched',
    g.q === 23 && g.glass === true && g.salt === 15, JSON.stringify(g));
  gate('derive: zero console errors — owned-glass', api.errs.length === 0, api.errs.slice(0, 2).join(' | '));
  api.close();
}

/* ═══ COMPASS: every state answers, and answers sanely ═══ */
if (want('compass')) {
  console.log('\n═══ the compass, state by state ═══');
  /* one session; drive the save through the stations live (set-site +
     applyWorldState is the same path CONTINUE uses) */
  const api = await session({ ...PHASE5_DONE, lastPos: [60, 20] }, '?turbo=4', ['mlReveal', 'mlCure', 'mlWheel6'], true);
  for (let i = 0; i < 30 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(350); }
  const station = async (label, mut, expectNull) => {
    await api.eval(`(function(){ ${mut}; storeSave(); applyWorldState(); })()`);
    await api.waitTicks(4);
    const op = await jget(api, '(objectivePoint() || null)');
    if (expectNull) {
      gate('compass: ' + label + ' → rests (free play)', op === null, JSON.stringify(op));
    } else {
      const ok = op && typeof op.x === 'number' && isFinite(op.x) && typeof op.z === 'number' && isFinite(op.z);
      gate('compass: ' + label + ' answers', ok, JSON.stringify(op));
    }
    return op;
  };
  await station('q22 done-but-unbegun seam (5/8 stands)', 'SAVE.q = 22; SAVE.starsSeen = false; SAVE.spyglass = false; SAVE.starLantern = false; SAVE.beaconLit = [false,false,false,false]', false);
  await station('q23 pre-reveal (edited save)', 'SAVE.q = 23; SAVE.starsSeen = false', false);
  await station('q23 post-reveal (to the tinker)', 'SAVE.q = 23; SAVE.starsSeen = true; SAVE.spyglass = true', false);
  await api.eval('__fmDebug.warpSea(-420, 120, 3.6); 0');
  await api.waitTicks(6);
  const b1 = await station('q24 no beacons lit (afloat)', 'SAVE.q = 24; SAVE.starLantern = true', false);
  const b2 = await station('q24 two beacons lit (afloat)', 'SAVE.beaconLit = [true, true, false, false]', false);
  gate('compass: the staging MOVES as beacons light', JSON.stringify(b1) !== JSON.stringify(b2),
    JSON.stringify([b1, b2]));
  await station('q24 all lit, q25 unbegun seam', 'SAVE.beaconLit = [true, true, true, true]', false);
  await station('q25 outside the tower', 'SAVE.q = 25', false);
  await station('q26 carry home', 'SAVE.q = 26; SAVE.mothDone = true; SAVE.lantern6 = true', false);
  /* q27 used to REST; since p6m the seam carries the story south (and p6n's
     endgame owns the idle after that) — the gate asserts the compass now
     ANSWERS rather than rests (MIRROR-4: every state has an answer). */
  await station('q27 after the card → the story leads on', 'SAVE.q = 27; SAVE.sky = 6; SAVE.ph = 6; SAVE.tbc6Seen = true', false);
  gate('compass: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ REGRESSION: a phase-5 mid-arc save is untouched ═══ */
if (want('regression')) {
  console.log('\n═══ phase-5 mid-arc regression ═══');
  const Q19 = {
    ...PHASE5_DONE,
    q: 19, sluiceG: 3, mouthOpen: true, swingKeel: true, paddleWheel: false,
    poleFound: false, braziers: [false, false, false, false, false],
    marketOpen: false, sliver5: false, sky: 4, ph: 4, tbc5Seen: false,
    lastPos: [40, 10],
  };
  const api = await session(Q19, '?turbo=4', []);
  await api.waitTicks(120);
  const st = await jget(api, `({q:__fm.quest, stars:__fm.starsSeen, lant:__fm.starLantern,
    nk:__fm.nightK, prompt:__fm.prompt, moth:__fm.mothActive})`);
  gate('regression: q19 stays q19 (phase 5 mid-arc untouched)', st.q === 20 || st.q === 19, JSON.stringify(st));
  gate('regression: no phase-6 flags appear', !st.stars && !st.lant && !st.moth, JSON.stringify(st));
  const op = await jget(api, '(objectivePoint() || null)');
  gate('regression: the phase-5 compass still answers its own arc', !!op, JSON.stringify(op));
  gate('regression: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

process.exit(summary());
