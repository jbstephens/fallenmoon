#!/usr/bin/env node
/* sweep-b — FLOW, UX and POST-GAME fixes, driven through real input.

   Each section drives the fixed behaviour the way a player meets it and
   asserts the outcome, never a test hook:
     shell    — a CONTINUOUS hold burns the grotto shell / lights the
                Foundry glyph (the prompt says HOLD, so holding must work)
     compass  — the 2/8 seam answers (q6 → Finn, down the village path);
                the Kiln-Hound trail routes via the boat from ANY shore;
                q35/q36 stage out of the mountain instead of through it
     kbd      — button glyphs render as key names in keyboard mode
     skiff    — ✕ aboard is the POLE, busy or not, brazier or not
     postgame — the keepsake replay leaves the clock alone; midnight has
                no sun; fireworks explain themselves by day; the skiff
                still noses home after the credits

   Run: /opt/homebrew/opt/node@25/bin/node test/probes/sweep-b.mjs [section...]
   Sections: shell compass kbd skiff postgame   (default: all)          */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, sleep, GAME } from './p6e.mjs';
const gate = (label, ok, extra) => rawGate(ok, label, extra);
import fs from 'node:fs';
import path from 'node:path';

const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['shell', 'compass', 'kbd', 'skiff', 'postgame'];
const want = (s) => WANT.includes(s);

/* ── saves ─────────────────────────────────────────────────────────────── */
const Q2 = {
  v: 2, q: 2, ph: 0, mh: 6, sword: true, salt: 4,
  talked: { finn: 1, tock: 0, pearl: 0 },
  kelpDoor: true, doorChest: false, finnHeart: true,
  region: 'bay', lastShade: [8.2, 7], lastPos: [8.2, 7],
};
const PHASE4 = {
  v: 2, q: 17, ph: 4, mh: 8, sword: true, salt: 60,
  talked: { finn: 2, tock: 1, pearl: 1 },
  kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: true,
  bossDone: true, sky: 4, tidepool: true, compassSeen: true,
  region: 'bay', lastSpring: 3, wardenTalked: 2, forestSeen: true, swelterSeen: true,
  basinOpen: true, glyph1: true, glyph2: true, wyrmDone: true, floodSeen: true,
  sailedOnce: true, voyageDone: true, boatX: 8.5, boatZ: 6, boatAng: 0.9,
  keelFound: true, boatRefit: true, moonSeen: true, isleLandfall: true,
  bellwrightTalked: 2, watchBell: true, tortoiseDone: true, sunArc: true, lampLit: true,
  fGlyph1: true, fGlyph2: true, fGlyph3: true,
  crownGlint: true, stairOpen: true, organ1: true, organ2: true, organ3: true,
  crownSeen: true, stagDone: true, riverWet: true,
  tbc2Seen: true, tbc3Seen: true, tbc4Seen: true,
  lastShade: [8.2, 7], lastPos: [8.2, 7],
};
/* mid-phase-5: the mouth is open, the skiff has the pole, the market runs */
const MARKET = {
  ...PHASE4, q: 21, sluiceG: 3, mouthOpen: true, swingKeel: true, paddleWheel: true,
  poleFound: true, marketOpen: true, braziers: [false, false, false, false, false],
  fireworks: 3, spyglass: true, region: 'forest', lastPos: [243, 57], lastShade: [250, 68],
};
/* the phase-3 Foundry, un-solved: the AIM verb is the first of three */
const FOUNDRY = { ...PHASE4, q: 10, sky: 3, ph: 3,
  fGlyph1: false, fGlyph2: false, fGlyph3: false,
  crownGlint: false, stairOpen: false, organ1: false, organ2: false, organ3: false,
  crownSeen: false, stagDone: false, riverWet: false, tbc4Seen: false };

/* ── session ───────────────────────────────────────────────────────────── */
async function session(save, query, seen) {
  const { srv, port: hport } = await serve();
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = mkApi(c);
  await api.init();
  await api.seedSave(save);
  if (seen) await api.seedSeen(seen);
  api.close = () => { c.close(); proc.kill(); srv.close(); };
  api.errs = c.errs;
  api.raw = c;
  await api.nav(`http://127.0.0.1:${hport}/${query || '?turbo=1'}`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 45000, 'title');
  for (let i = 0; i < 40; i++) {
    const st = await api.eval('__fm.state');
    if (st === 'play') break;
    if (st === 'title') { await api.tap(13); await api.tap(0); } else await api.tap(0);
    await sleep(320);
  }
  await api.waitFor(`__fm.state === 'play'`, 30000, 'play');
  await api.installBot('pad');
  return api;
}
const J = async (api, expr) => JSON.parse(await api.eval(`JSON.stringify(${expr})`));
async function holdAtk(api, on) { await api.eval(on ? '__fakePad.press(0)' : '__fakePad.press()'); }

/* ═══════════════ 1 — THE SHELL LATCH: a HOLD must be enough ═══════════════ */
async function suiteShell() {
  console.log('\n── the mirror shells: "HOLD ✕ — TURN THE SHELL" is now true ──');
  const api = await session(Q2, '?turbo=2', ['wake']);
  try {
    /* stand at the grotto shell — the same spot the flow suite walks to */
    await api.eval(`(function(){ __fmDebug.warp(26.9, 147.0); P.heading = Math.atan2(MIRROR_POS.x - P.x, MIRROR_POS.z - P.z); return 0; })()`);
    await api.waitFor(`__fm.prompt === 'mirror'`, 12000, 'the shell prompt');
    gate('shell: the prompt says HOLD', /HOLD/.test(await api.eval(`(currentInteract()||{}).label`)),
      await api.eval(`(currentInteract()||{}).label`));
    const burned0 = await api.eval('__fm.wallBurned');
    /* THE TEST: press and NEVER release. Before the latch this swept
       through the 0.34 rad window in 0.45 s and the 1 s burn never
       finished — a held ✕ could turn the shell forever and do nothing. */
    await holdAtk(api, true);
    let ok = true;
    try { await api.waitFor('__fm.wallBurned === true', 40000, 'the wall burns under ONE unbroken hold'); }
    catch (e) { ok = false; }
    await holdAtk(api, false);
    gate('shell: ONE unbroken hold seats the shell and burns the wall',
      ok && !burned0 && (await api.eval('__fm.wallBurned')) === true,
      'delta=' + (await api.eval('__fm.mirrorDelta')).toFixed(3));
    await api.shot('sweepb-shell-burned-1280x720').catch(() => {});
    gate('shell: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('shell suite', false, e.message);
  }
  api.close();

  /* the Foundry's shell — the same verb, the same law */
  const api2 = await session(FOUNDRY, '?turbo=2');
  try {
    await api2.eval(`(function(){
      SAVE.watchBell = true; storeSave(); applyWorldState();
      __fmDebug.warpFoundry('shell');
      P.heading = Math.atan2(FMIR.x - P.x, FMIR.z - P.z);
      return 0; })()`);
    await api2.waitTicks(10);
    await api2.waitFor(`__fm.prompt === 'foundryShell'`, 15000, 'the Foundry shell prompt');
    await holdAtk(api2, true);
    let ok2 = true;
    try { await api2.waitFor('__fm.fGlyph1 === true', 40000, 'the first glyph comes true under one hold'); }
    catch (e) { ok2 = false; }
    await holdAtk(api2, false);
    gate('shell: the Foundry AIM verb also answers ONE unbroken hold', ok2,
      'delta=' + (await api2.eval('__fm.fShellDelta')));
    gate('shell: zero console errors (Foundry)', api2.errs.length === 0, api2.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('shell suite (Foundry)', false, e.message);
  }
  api2.close();
}

/* ═══════════════ 2 — THE COMPASS: every seam answers, sanely ═══════════════ */
async function suiteCompass() {
  console.log('\n── the compass: the 2/8 seam, the south shore, the mountain ──');
  const api = await session(PHASE4, '?turbo=4');
  try {
    /* ── q6: 2/8 restored, and only Finn moves it on ── */
    const atWheel = await J(api, `(function(){
      SAVE.q = 6; SAVE.sky = 2; SAVE.ph = 2; storeSave(); applyWorldState();
      __fmDebug.warp(WHEEL_POS.x, WHEEL_POS.z + 5);
      const o = objectivePoint();
      return o ? { x: +o.x.toFixed(1), z: +o.z.toFixed(1) } : null;
    })()`);
    gate('q6: the 2/8 seam ANSWERS (it used to go dead in the village)',
      !!atWheel, JSON.stringify(atWheel));
    const finn = await J(api, '({ x: FINN_POS.x, z: FINN_POS.z })');
    const dWheel = Math.hypot(atWheel.x - finn.x, atWheel.z - finn.z);
    gate('q6: from the wheel it stages down the village path, not over the bay',
      atWheel.z > -70 && dWheel > 8, JSON.stringify(atWheel) + ' finn=' + JSON.stringify(finn));
    /* walk the chain: each node handed over must move us closer to Finn */
    let last = 1e9, moved = 0;
    for (const [x, z] of [[-30, -62], [-14, -44], [0, -24], [20, -20], [36, -17]]) {
      const o = await J(api, `(function(){ __fmDebug.warp(${x}, ${z}); const o = objectivePoint();
        return o ? { x: +o.x.toFixed(1), z: +o.z.toFixed(1) } : null; })()`);
      if (!o) { moved = -1; break; }
      const d = Math.hypot(o.x - finn.x, o.z - finn.z);
      if (d < last) moved++;
      last = d;
    }
    gate('q6: the answer marches forward node by node toward Finn', moved >= 4, 'advances=' + moved);
    const atFinn = await J(api, `(function(){ __fmDebug.warp(FINN_POS.x - 4, FINN_POS.z - 4);
      const o = objectivePoint(); return o ? { x: +o.x.toFixed(1), z: +o.z.toFixed(1) } : null; })()`);
    gate('q6: in his own yard it aims at Finn himself',
      Math.hypot(atFinn.x - finn.x, atFinn.z - finn.z) < 0.6, JSON.stringify(atFinn));

    /* ── q29: the Kiln-Hound trail, ashore anywhere → the boat first ── */
    const boat = await J(api, `(function(){
      SAVE.q = 29; SAVE.sky = 6; SAVE.ph = 6; SAVE.emberSeen = false;
      SAVE.tbc5Seen = true; SAVE.tbc6Seen = true; SAVE.mothDone = true; SAVE.lantern6 = true;
      SAVE.starsSeen = true; SAVE.beaconLit = [true,true,true,true];
      SAVE.boatX = -900; SAVE.boatZ = -160; storeSave(); applyWorldState();
      return { x: SAVE.boatX, z: SAVE.boatZ };
    })()`);
    const ashore = await J(api, `(function(){
      P.sailing = false; P.x = -980; P.z = -210; P.fy = groundH(P.x,P.z);
      const o = objectivePoint(); return o ? { x: +o.x.toFixed(1), z: +o.z.toFixed(1) } : null;
    })()`);
    gate('q29: ashore at an isle the compass hands you the BOAT, not the open seaway',
      ashore && Math.hypot(ashore.x - boat.x, ashore.z - boat.z) < 1.0,
      JSON.stringify(ashore) + ' boat=' + JSON.stringify(boat));
    const afloat = await J(api, `(function(){
      P.sailing = true; BOAT.x = -1000; BOAT.z = -400; P.x = BOAT.x; P.z = BOAT.z;
      const o = objectivePoint(); P.sailing = false;
      return o ? { x: +o.x.toFixed(1), z: +o.z.toFixed(1) } : null;
    })()`);
    gate('q29: afloat it goes back to staging down the seaway',
      afloat && Math.hypot(afloat.x - boat.x, afloat.z - boat.z) > 5, JSON.stringify(afloat));

    /* ── q35/q36: the mountain comes first ── */
    const crown = await J(api, `(function(){
      SAVE.q = 36; SAVE.sky = 7; SAVE.ph = 7; SAVE.moonRisen = true; SAVE.coinGiven = true;
      SAVE.boneDone = true; SAVE.houndHome = true; SAVE.tbc7Seen = true;
      SAVE.medley = [true,true,true,true]; storeSave(); applyWorldState();
      __fmDebug.warpCrown ? __fmDebug.warpCrown('plinth') : __fmDebug.warp(K_PLINTH.x, K_PLINTH.z);
      const o = objectivePoint();
      return { o: o ? { x: +o.x.toFixed(1), z: +o.z.toFixed(1) } : null,
               wheel: { x: WHEEL_POS.x, z: WHEEL_POS.z },
               me: { x: +P.x.toFixed(1), z: +P.z.toFixed(1) } };
    })()`);
    gate('q36: on the Crown the answer is the way OUT, not the wheel through the rock',
      crown.o && Math.hypot(crown.o.x - crown.wheel.x, crown.o.z - crown.wheel.z) > 200 &&
      Math.hypot(crown.o.x - crown.me.x, crown.o.z - crown.me.z) < 300,
      JSON.stringify(crown));
    const home = await J(api, `(function(){
      __fmDebug.warp(WHEEL_POS.x + 30, WHEEL_POS.z + 30);
      const o = objectivePoint(); return o ? { x: +o.x.toFixed(1), z: +o.z.toFixed(1) } : null;
    })()`);
    const wp = crown.wheel;
    gate('q36: out in the open it is the wheel again',
      home && Math.hypot(home.x - wp.x, home.z - wp.z) < 0.6, JSON.stringify(home));
    gate('compass: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('compass suite', false, e.message);
  }
  api.close();
}

/* ═══════════════ 3 — KEYBOARD BUTTON NAMES ═══════════════ */
async function suiteKbd() {
  console.log('\n── the button names tell a keyboard player the truth ──');
  const api = await session(Q2, '?turbo=2', ['wake']);
  try {
    /* a real key event is what flips the source — the same thing that
       happens the instant a desktop player touches WASD */
    const toKbd = `(function(){
      window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyW', key: 'w', bubbles: true }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: 'KeyW', key: 'w', bubbles: true }));
      return ArcadeController.currentInputSource();
    })()`;
    gate('kbd: the page reports keyboard after a key press',
      (await api.eval(toKbd)) === 'keyboard');
    gate('kbd: the whole glyph map answers, not just ✕',
      (await api.eval(`padGlyphs('✕ ○ □ △')`)) === 'J K SPACE L',
      await api.eval(`padGlyphs('✕ ○ □ △')`));
    /* the ✕-prompt itself, rendered */
    await api.eval(`(function(){ __fmDebug.warp(26.9, 147.0); return 0; })()`);
    await api.waitFor(`__fm.prompt === 'mirror'`, 12000, 'the shell prompt');
    await api.eval(toKbd);
    await api.waitTicks(4);
    const shown = await api.eval(`el('prompt').textContent`);
    gate('kbd: the HOLD prompt renders a key name', /HOLD J/.test(shown), shown);
    /* a teaching caption with a NON-✕ glyph in it */
    const cap = await api.eval(`(function(){
      showCaption('HOLD △ to raise it. The far side of anywhere.', 3000);
      return el('floatLine').textContent;
    })()`);
    gate('kbd: teaching captions name the key, not the glyph', /HOLD L to raise it/.test(cap), cap);
    const toast = await api.eval(`(function(){
      itemToast('FIREWORK ROCKET', '3 aboard. From the skiff, at night: ✕ LAUNCH.');
      return document.querySelector('#itemToast .it2').textContent;
    })()`);
    gate('kbd: item toasts do too', /J LAUNCH/.test(toast), toast);
    const dlg = await api.eval(`(function(){
      startDialog('finn1', finn);
      for (let i = 0; i < 400; i++) tickDialog();
      const t = el('dlgText').textContent;
      DS.id = null; setState('play');
      return t;
    })()`);
    gate('kbd: spoken lines do too (no glyph survives a dialogue line)',
      !/[✕○□△]/.test(dlg), dlg.slice(0, 70));
    /* the overwrite guard: BACK is Escape, and it must SAY Escape */
    const guard = await api.eval(`(function(){ refreshTitleMenu(); return el('ngRow').textContent; })()`);
    gate('kbd: the overwrite guard names J and ESC (BACK is Escape, never K)',
      /J/.test(guard) && /ESC/.test(guard) && !/[✕○]/.test(guard), guard);
    /* and back on a pad it is glyphs again */
    await api.tap(0);
    await api.waitTicks(2);
    const padGuard = await api.eval(`(function(){ refreshTitleMenu(); return el('ngRow').textContent; })()`);
    gate('kbd: on a pad the glyphs come back', /✕/.test(padGuard) && /○/.test(padGuard), padGuard);
    gate('kbd: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('kbd suite', false, e.message);
  }
  api.close();
}

/* ═══════════════ 4 — THE SKIFF: ✕ IS THE POLE ═══════════════ */
async function suiteSkiff() {
  console.log('\n── aboard the skiff, ✕ is the pole — busy, brazier, or neither ──');
  const api = await session(MARKET, '?turbo=1');
  try {
    await api.eval(`(function(){
      __fmDebug.warp(SAVE.skiffX != null ? SAVE.skiffX : SKF.x, SAVE.skiffZ != null ? SAVE.skiffZ : SKF.z);
      return 0; })()`);
    await api.waitTicks(10);
    /* board her */
    for (let i = 0; i < 40 && !(await api.eval('P.skiffing')); i++) {
      const c = await api.eval(`(currentInteract()||{}).id`);
      if (c === 'skiffOn' || c === 'skiffBoard' || /skiff/i.test(String(c))) await api.tap(0);
      else {
        const s = await J(api, '({x: SKF.x, z: SKF.z})');
        await api.eval(`__fmBot.done=false; __fmBot.tol=1.4; __fmBot.target=[${s.x},${s.z}]`);
        await sleep(600);
      }
      await sleep(320);
    }
    await api.eval('__fmBot.target=null; __fakePad.axes(0,0)');
    gate('skiff: aboard with real input', (await api.eval('P.skiffing')) === true);

    /* MASH ✕ through a whole swing+cooldown window: she must never hop out */
    const n0 = await api.eval('NPOLE.n');
    for (let i = 0; i < 24; i++) {
      await api.eval('__fakePad.press(0)'); await sleep(60);
      await api.eval('__fakePad.press()'); await sleep(60);
      if (!(await api.eval('P.skiffing'))) break;
    }
    const still = await api.eval('P.skiffing');
    gate('skiff: mashing ✕ never hops out (the busy pole swallows the press)',
      still === true && (await api.eval('NPOLE.n')) > n0,
      'swings=' + ((await api.eval('NPOLE.n')) - n0));

    /* park her beside an UNLIT brazier: the pole must still answer */
    const braz = await J(api, `(function(){
      const B = NBRAZ.find(b => !b.lit) || NBRAZ[0];
      SKF.x = B.x + 3.4; SKF.z = B.z + 3.4;
      P.x = SKF.x; P.z = SKF.z;
      return { x: B.x, z: B.z, id: B.i };
    })()`);
    await api.waitTicks(6);
    const ctx = await api.eval(`(currentInteract()||{}).id`);
    gate('skiff: the brazier context is up beside an unlit brazier',
      String(ctx).indexOf('nmBraz') === 0, String(ctx) + ' @ ' + JSON.stringify(braz));
    await api.waitFor('NPOLE.t <= 0 && NPOLE.cd <= 0', 8000, 'the pole comes to rest');
    const n1 = await api.eval('NPOLE.n');
    for (let i = 0; i < 4 && (await api.eval('NPOLE.n')) === n1; i++) {
      await api.eval('__fakePad.press(0)'); await sleep(140); await api.eval('__fakePad.press()');
      await api.waitTicks(8);
    }
    gate('skiff: a TAP still swings the pole beside an unlit brazier',
      (await api.eval('NPOLE.n')) > n1 && (await api.eval('P.skiffing')) === true,
      'swings=' + ((await api.eval('NPOLE.n')) - n1));
    /* and the HOLD still lights it */
    const lit0 = await api.eval(`NBRAZ.filter(b => b.lit).length`);
    await api.eval('__fakePad.press(0)');
    let litOk = true;
    try { await api.waitFor(`NBRAZ.filter(b => b.lit).length > ${lit0}`, 12000, 'the brazier lights'); }
    catch (e) { litOk = false; }
    await api.eval('__fakePad.press()');
    gate('skiff: a HOLD still lights the brazier (tap = pole, hold = fire)', litOk);
    gate('skiff: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('skiff suite', false, e.message);
  }
  api.close();
}

/* ═══════════════ 5 — THE POST-GAME ═══════════════ */
async function suitePostgame() {
  console.log('\n── the post-game: a memory is not an ending ──');
  const DONE = { ...MARKET, q: 36, sky: 8, ph: 8, moonHome: true, moonRisen: true,
    coinGiven: true, medley: [true, true, true, true],
    boneDone: true, houndHome: true, mothDone: true, lantern6: true, starsSeen: true,
    beaconLit: [true, true, true, true], sliver5: true, emberSeen: true,
    tbc5Seen: true, tbc6Seen: true, tbc7Seen: true, playSec: 7200,
    region: 'bay', lastPos: [-30, -58] };
  const api = await session(DONE, '?turbo=6', ['cnRising', 'cnEnd', 'cnWheel8']);
  try {
    /* (b) THE NIGHT HAS NO SUN */
    const arc = await J(api, `(function(){
      const out = [];
      for (const c of [0.0, 0.3, 0.54, 0.575, 0.62, 0.75, 0.94, 0.97, 0.999]) {
        __fmDebug.cycleSet(c);
        out.push([c, +cnSunWant().toFixed(3), +cnNightWant().toFixed(3)]);
      }
      return out;
    })()`);
    const at = (c) => (arc.find(r => Math.abs(r[0] - c) < 1e-6) || [])[1];
    gate('sun: TRUE NIGHT has no sun at all (fSunK = 0 from 0.60 to 0.95)',
      at(0.62) === 0 && at(0.75) === 0 && at(0.94) === 0, JSON.stringify(arc));
    gate('sun: dusk ramps the gold DOWN, dawn brings it back (no jumps)',
      at(0.54) > 0.8 && at(0.575) > 0.05 && at(0.575) < 0.95 && at(0.999) > 0.8,
      JSON.stringify(arc));
    /* the LIVE sun, not just the want-curve: the wrap writes fSunK after
       the chain's own sun tick, so let the world run to midnight first */
    await api.eval(`(function(){ __fmDebug.cycleSet(0.78); return 0; })()`);
    await api.waitTicks(240);
    const glint = await J(api, `({ sunK: +fSunK.toFixed(3), night: +window.__nightK.toFixed(2),
      goldBand: (typeof fSunK === 'number') && fSunK > 0.55,
      shadowStretch: (typeof fSunK === 'number') && fSunK > 0.01 })`);
    gate('sun: at midnight the gold band is SHUT (the Crown glint cannot fire)',
      glint.goldBand === false && glint.night > 0.85, JSON.stringify(glint));
    gate('sun: and Wick throws no long gold evening shadow under the moon',
      glint.shadowStretch === false, JSON.stringify(glint));
    await api.shot('sweepb-midnight-1280x720').catch(() => {});

    /* (a) THE KEEPSAKE REPLAY LEAVES THE WORLD ALONE */
    const before = await J(api, `(function(){
      __fmDebug.cycleSet(0.25);                       // high noon
      SAVE.lastPos = [11, 22, 0]; storeSave();
      return { c: +cnCycleC().toFixed(3), pos: SAVE.lastPos.slice() };
    })()`);
    await api.eval(`(function(){ CN_RISING.replay = true; cnFinishEnd(); return 0; })()`);
    await api.waitTicks(6);
    const after = await J(api, `({ c: +cnCycleC().toFixed(3), pos: SAVE.lastPos.slice(), st: __fm.state })`);
    gate('keepsake: WATCH THE END FLIGHT at noon exits at noon (the clock is not yanked)',
      Math.abs(after.c - before.c) < 0.06, JSON.stringify({ before: before.c, after: after.c }));
    gate('keepsake: a replay does not rewrite lastPos',
      JSON.stringify(after.pos) === JSON.stringify(before.pos), JSON.stringify(after.pos));
    /* and the REAL ending still does both */
    await api.eval(`(function(){ __fmDebug.cycleSet(0.25); CN_RISING.replay = false; cnFinishEnd(); return 0; })()`);
    await api.waitTicks(6);
    const real = await J(api, `({ c: +cnCycleC().toFixed(3), pos: SAVE.lastPos.slice() })`);
    gate('keepsake: the REAL ending still wakes the world just before sunrise',
      real.c > 0.9, JSON.stringify(real));
    gate('keepsake: …and still writes lastPos',
      JSON.stringify(real.pos) !== JSON.stringify(before.pos), JSON.stringify(real.pos));

    /* (d) the skiff still noses home after the credits */
    const follow = await J(api, `(function(){
      SKF.x = 1400; SKF.z = 640;
      P.skiffing = false;
      __fmDebug.warp(760, 300);
      nmSkiffFollowT = 99;
      const q = nmArcQ();
      nmTickSkiffFollows();
      return { q, moved: Math.hypot(SKF.x - 1400, SKF.z - 640) > 20,
               d: +Math.hypot(SKF.x - P.x, SKF.z - P.z).toFixed(1) };
    })()`);
    gate('skiff: post-game (q ' + follow.q + ') she still noses home to you',
      follow.moved === true, JSON.stringify(follow));

    /* (c) fireworks explain themselves by day */
    const fire = await J(api, `(function(){
      SAVE.fireworks = 2; SAVE.poleFound = true; storeSave();
      P.skiffing = true; SKF.spd = 0;
      nmNightK = 0.05; window.__nightK = 0.05;
      const day = currentInteract();
      nmNightK = 0.9; window.__nightK = 0.9;
      const night = currentInteract();
      nmNightK = 0.05; window.__nightK = 0.05;
      return { day: day && day.id, dayLabel: day && day.label, night: night && night.id };
    })()`);
    gate('fireworks: by day the prompt still ANSWERS instead of vanishing',
      fire.day === 'nmFireDay' && fire.night === 'nmFirework', JSON.stringify(fire));
    const cap = await api.eval(`(function(){
      doInteract({ id: 'nmFireDay', label: 'x' });
      return el('floatLine').textContent;
    })()`);
    gate('fireworks: and it says why — "a dark sky"', /dark sky/.test(cap), cap);
    await api.eval('P.skiffing = false; 0');
    gate('postgame: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('postgame suite', false, e.message);
  }
  api.close();
}

/* ── run ── */
if (want('shell')) await suiteShell();
if (want('compass')) await suiteCompass();
if (want('kbd')) await suiteKbd();
if (want('skiff')) await suiteSkiff();
if (want('postgame')) await suitePostgame();
process.exit(summary() ? 1 : 0);
