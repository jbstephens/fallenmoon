#!/usr/bin/env node
/* p6j — PHASE 5 PART TWO verification probe.
   The night: dusk arrival, the flotilla and the Lantern Trader, the ferry
   pole, the brazier ascent (surges, eddies, snappers, the escort), the
   night market (salt spends, the lantern ceremony), the night run, sky
   step 5, the end card — real input, sim-tick timing, screenshots LOOKED at.

   Run:  /opt/homebrew/opt/node@25/bin/node test/probes/p6j.mjs [section...]
   Sections: dusk pole ascent market home world perf   (default: all)     */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, tapUntil, sleep, GAME, decodePNG } from './p6g.mjs';
const gate = (label, ok, extra) => rawGate(ok, label, extra);
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(DIR, 'shots-p6j');
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['dusk', 'pole', 'ascent', 'market', 'home', 'world', 'perf'];
const want = (s) => WANT.includes(s);

/* ── saves ── */
const PHASE4_DONE = {
  v: 2, q: 17, ph: 4, mh: 8, sword: true, salt: 10,
  talked: { finn: 2, tock: 1, pearl: 1 },
  kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: true,
  bossDone: true, sky: 4, tidepool: true, compassSeen: true, houseChest: true, bossHint: true,
  region: 'bay', lastSpring: 3, millChest: true, ferryChest: true, fgrottoChest: true,
  cedarHeart: true, wardenTalked: 2, fallsHum: true, forestSeen: true, swelterSeen: true,
  basinOpen: true, glyph1: true, glyph2: true, wyrmDone: true, floodSeen: true,
  sailedOnce: true, voyageDone: true, boatX: 8.5, boatZ: 6, boatAng: 0.9,
  keelFound: true, boatRefit: true, moonSeen: true, isleLandfall: true,
  watchBell: true, tortoiseDone: true, sunArc: true, lampLit: true,
  fGlyph1: true, fGlyph2: true, fGlyph3: true,
  crownGlint: true, stairOpen: true, organ1: true, organ2: true, organ3: true,
  crownSeen: true, stagDone: true, riverWet: true,
  tbc2Seen: true, tbc3Seen: true, tbc4Seen: true,
  lastPos: [8.2, 7], lastShade: [8.2, 7],
};
/* the arc's stations, each derived purely from flags */
const DUSK_NEAR = { ...PHASE4_DONE, lastPos: [40, 10] };
const Q19_MOUTH_OPEN = { ...PHASE4_DONE, q: 19, sluiceG: 3, mouthOpen: true, lastPos: [40, 10] };
const Q19_REFIT = { ...Q19_MOUTH_OPEN, swingKeel: true, paddleWheel: true,
  region: 'forest', lastPos: [1330, 560], skiffX: 1336, skiffZ: 566 };
const Q20_POLE = { ...Q19_REFIT, q: 20, poleFound: true, salt: 4 };
const Q21_MARKET = { ...Q20_POLE, q: 21, braziers: [true, true, true, true, true],
  marketOpen: true, salt: 120, lastPos: [1330, 560] };
const Q21_SLIVER = { ...Q21_MARKET, sliver5: true, salt: 20 };
const Q22_DONE = { ...Q21_SLIVER, q: 22, ph: 5, sky: 5, tbc5Seen: true, lastPos: [8.2, 7] };

/* ── session ── */
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
  await api.nav(`http://127.0.0.1:${hport}/${query || '?turbo=2'}`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title');
  await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 14, 'focus CONTINUE');
  await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 16, 'leave title');
  await api.waitFor(`__fm.state === 'play'`, 30000, 'play');
  await api.installBot('pad');
  return api;
}
async function walkTo(api, x, z, tol = 1.6, timeout = 60000) {
  await api.eval(`__fmBot.done=false; __fmBot.tol=${tol}; __fmBot.target=[${x},${z}]`);
  await api.waitFor(
    `__fmBot.done || Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < ${tol + 0.5} || __fm.state!=='play'`,
    timeout, `walk to ${x},${z}`);
  await api.eval('__fmBot.target=null; __fakePad.axes(0,0)');
}
function medianColorAt(png, cx, cy, r) {
  const rs = [], gs = [], bs = [];
  cx = Math.round(cx); cy = Math.round(cy); r = Math.max(2, Math.round(r));
  for (let y = Math.max(0, cy - r); y <= Math.min(png.h - 1, cy + r); y++) {
    for (let x = Math.max(0, cx - r); x <= Math.min(png.w - 1, cx + r); x++) {
      const i = (y * png.w + x) * png.bpp;
      rs.push(png.px[i]); gs.push(png.px[i + 1]); bs.push(png.px[i + 2]);
    }
  }
  const med = a => { a.sort((p, q) => p - q); return a[a.length >> 1]; };
  return [med(rs), med(gs), med(bs)];
}
const lum = m => (m[0] + m[1] + m[2]) / 3;

/* ═══════════ 1 — DUSK: the lights arrive, the trader speaks, the refit ═══════════ */
async function suiteDusk() {
  console.log('\n── dusk: lights on the water ──');
  const api = await session(DUSK_NEAR, '?turbo=3');
  try {
    /* q17 lead-in: the compass leans at the anchorage */
    const ob = await api.eval('({b: __fm.objBearing !== null, d: __fm.objDist, q: __fm.quest})');
    gate('dusk: q17 compass leads to the east shallows', ob.b && ob.q === 17, JSON.stringify(ob));
    /* walk at the lights — the trigger is proximity, the beat is authored */
    const bs = await api.eval('({x: __fm.boardX, z: __fm.boardZ})');
    await walkTo(api, bs.x, bs.z, 3.5, 60000).catch(() => {});
    await api.waitFor(`__fm.state === 'cine' && __fm.cinId === 'nmDusk'`, 15000, 'the dusk beat');
    gate('dusk: walking to the shallows starts the arrival beat', true);
    /* the night falls DURING the beat — recorded in-page, sim ticks */
    await api.eval(`window.__duskRec = []; window.__duskRecT = setInterval(() => {
      if (__fm.state === 'cine') __duskRec.push({ t: __fm.tick, k: __fm.nightK }); }, 120); 0`);
    await sleep(1400);
    await api.shot('dusk-arrival-1280x720');
    await api.waitFor(`__fm.state === 'play'`, 40000, 'the beat ends by itself');
    await api.eval('clearInterval(window.__duskRecT); 0');
    const rec = await api.eval('JSON.stringify(__duskRec.slice(0, 40))').then(JSON.parse);
    const rose = rec.length > 2 && rec[rec.length - 1].k > rec[0].k + 0.3;
    gate('dusk: nightK climbs through the beat (in-page recorder)', rose,
      rec.map(r => r.k.toFixed(2)).join('→').slice(0, 90));
    const w = await api.eval('({q: __fm.quest, k: __fm.nightK, lead: [__fm.flotLeadX, __fm.flotLeadZ]})');
    gate('dusk: quest 18, full night, the flotilla at anchor', w.q === 18 && w.k === 1, JSON.stringify(w));
    gate('dusk: the lead boat anchors off the pinned shallows',
      Math.hypot(w.lead[0] - 70, w.lead[1] - 30) < 34, JSON.stringify(w.lead));
    await sleep(700);
    await api.shot('dusk-night-on-1280x720');
    gate('dusk: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('dusk suite', false, e.message);
    await api.shot('dusk-FAIL').catch(() => {});
  }
  api.close();

  /* boarding + the trader, from the derived q18 world — its own session,
     so the plank footwork runs real-time from the footing */
  console.log('\n── the trader deck ──');
  const apiB = await session({ ...PHASE4_DONE, q: 18, lastPos: [40, 10] }, '?turbo=2', ['nmDusk']);
  try {
    const bsB = await apiB.eval('({x: __fm.boardX, z: __fm.boardZ})');
    await apiB.eval(`__fmDebug.warp(${bsB.x}, ${bsB.z}); 0`);
    await sleep(400);
    await apiB.eval('window.__fmTurbo = 1; 0');   // precision footwork: real-time sim
    const treads = await apiB.eval('nmPlankColl.slice(0, 5).map(c => [c.x, c.z])');
    for (const [tx, tz] of treads) await walkTo(apiB, tx, tz, 0.55, 15000).catch(() => {});
    const dk = await apiB.eval('({x: nmBoardSpot.x + (NM_FLOT[0].x - nmBoardSpot.x) * 0.85, z: nmBoardSpot.z + (NM_FLOT[0].z - nmBoardSpot.z) * 0.85})');
    await walkTo(apiB, dk.x, dk.z, 0.8, 20000).catch(() => {});
    const aboard = await apiB.eval(`({ fy: __fm.fy, gy: groundH(__fm.x, __fm.z),
      d: Math.hypot(__fm.x - __fm.flotLeadX, __fm.z - __fm.flotLeadZ) })`);
    gate('deck: Wick can WALK aboard (plank + plat colliders, real input)',
      aboard.d < 3.0 && aboard.fy > aboard.gy + 0.35, JSON.stringify(aboard));
    await apiB.shot('dusk-trader-boat-1280x720');
    await apiB.eval('window.__fmTurbo = 2; 0');
    await apiB.waitFor(`__fm.prompt === 'nmTrader'`, 12000, 'the trader prompt');
    await apiB.tap(0);
    await apiB.waitFor(`__fm.state === 'dialog'`, 8000, 'talking');
    for (let i = 0; i < 8 && (await apiB.eval(`__fm.state === 'dialog'`)); i++) await apiB.tap(0);
    gate('deck: the trader sets the mouth quest', await apiB.eval('__fm.quest === 19'),
      'q=' + await apiB.eval('__fm.quest'));
    gate('deck: zero console errors', apiB.errs.length === 0, apiB.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('deck suite', false, e.message);
    await apiB.shot('deck-FAIL').catch(() => {});
  }
  apiB.close();

  /* the thanks + THE REFIT TRIGGER (p6i's cine, fired from the trader) */
  console.log('\n── the refit trigger ──');
  const api2 = await session(Q19_MOUTH_OPEN, '?turbo=3', ['nmDusk']);
  try {
    const lead = await api2.eval('({x: __fm.flotLeadX, z: __fm.flotLeadZ, q: __fm.quest})');
    const bs2 = await api2.eval('({x: __fm.boardX, z: __fm.boardZ})');
    await walkTo(api2, bs2.x, bs2.z, 1.2, 60000).catch(() => {});
    await walkTo(api2, lead.x, lead.z, 1.6, 45000).catch(() => {});
    await api2.waitFor(`__fm.prompt === 'nmTrader'`, 12000, 'trader prompt (thanks)');
    await api2.tap(0);
    for (let i = 0; i < 8 && (await api2.eval(`__fm.state === 'dialog'`)); i++) await api2.tap(0);
    await api2.waitFor(`__fm.state === 'cine'`, 10000, 'the refit beat starts');
    const cid = await api2.eval('__fm.cinId');
    gate('refit: the thanks dialog TRIGGERS the refit beat', cid === 'refit5', 'cine=' + cid);
    await sleep(900);
    await api2.shot('refit-cine-1280x720');
    await api2.waitFor(`__fm.state === 'play'`, 40000, 'refit ends');
    const flags = await api2.eval('({sk: SAVE.swingKeel, pw: SAVE.paddleWheel})');
    gate('refit: swing keel + paddle wheel granted together', flags.sk === true && flags.pw === true, JSON.stringify(flags));
    /* the compass now leads up the river to the pole */
    const ob2 = await api2.eval('({b: __fm.objBearing !== null, d: Math.round(__fm.objDist || -1)})');
    gate('refit: the compass stages toward the old ferry', ob2.b, JSON.stringify(ob2));
    gate('refit: zero console errors', api2.errs.length === 0, api2.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('refit suite', false, e.message);
    await api2.shot('refit-FAIL').catch(() => {});
  }
  api2.close();
}

/* ═══════════ 2 — THE FERRY POLE ═══════════ */
async function suitePole() {
  console.log('\n── the ferry pole ──');
  const api = await session(Q19_REFIT, '?turbo=3', ['nmDusk']);
  try {
    const F = await api.eval('({x: NM_POLE_SPOT.x, z: NM_POLE_SPOT.z})');
    for (let a = 0; a < 5 && !(await api.eval(`__fm.prompt === 'nmPole'`)); a++) {
      const ang = a * Math.PI * 2 / 5;
      await walkTo(api, F.x + Math.cos(ang) * 2.2, F.z + Math.sin(ang) * 2.2, 1.4, 40000).catch(() => {});
      await sleep(250);
    }
    await api.waitFor(`__fm.prompt === 'nmPole'`, 10000, 'the pole prompt');
    gate('pole: a walk-up prompt at the old barge', true, await api.eval(`(currentInteract()||{}).label`));
    await api.tap(0);
    await api.waitFor('__fm.poleFound === true', 8000, 'taken');
    gate('pole: found-item beat fires, quest 20', await api.eval('__fm.quest === 20'));
    await api.waitFor(`__fm.state === 'play'`, 20000, 'micro beat done');
    const sk = await api.eval(`({ vis: nmPoleRest.visible, d: Math.hypot(SKF.x - ${F.x}, SKF.z - ${F.z}) })`);
    gate('pole: it rides VISIBLE on the skiff, and she waits nearby', sk.vis && sk.d < 90, JSON.stringify(sk));
    /* aboard: ✕ swings it — heavier than the sword, and REAL input */
    const bank = await api.eval(`(function(){
      const r = runNear(SKF.x, SKF.z), side = r.off >= 0 ? 1 : -1;
      for (let u = 0.5; u <= 16; u += 0.5) {
        const px = SKF.x + r.s.nx * u * side, pz = SKF.z + r.s.nz * u * side;
        if (riverDepthAt(px, pz) < 0.35 && !window.__forestSolid(px, pz)) return { x: +px.toFixed(1), z: +pz.toFixed(1) };
      }
      return { x: SKF.x, z: SKF.z }; })()`);
    await walkTo(api, bank.x, bank.z, 1.4, 45000).catch(() => {});
    const skp = await api.eval('({x: SKF.x, z: SKF.z})');
    await walkTo(api, skp.x, skp.z, 4.0, 20000).catch(() => {});
    await api.waitFor(`__fm.prompt === 'skiffOn'`, 12000, 'boarding prompt');
    await api.tap(0);
    await api.waitFor('__fm.skiffing === true', 8000, 'aboard');
    /* out to open water first — beside the bank ✕ is the hop-out context,
       and context beats swing (the on-foot law, kept afloat) */
    const midp = await api.eval('(function(){ const s = RUN[SKF.i]; return { x: s.x, z: s.z }; })()');
    await walkTo(api, midp.x, midp.z, 2.0, 20000).catch(() => {});
    await api.waitFor(`__fm.prompt === null || (__fm.prompt || '').indexOf('skiffOff') < 0`, 8000, 'clear of the bank').catch(() => {});
    await api.eval('__fakePad.press(0)');
    await sleep(250);
    await api.eval('__fakePad.press()');
    await api.waitFor('NPOLE.n > 0', 6000, 'the swing ran');
    gate('pole: ✕ aboard swings the pole', true);
    await sleep(400);
    await api.shot('pole-on-skiff-1280x720');
    gate('pole: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('pole suite', false, e.message);
    await api.shot('pole-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 3 — THE ASCENT: eddies, surges, snappers, the escort ═══════════ */
const P2_STUB = `(function(){
  if (window.__fakePad2) return 'have';
  const mk=()=>({pressed:false,touched:false,value:0});
  const pads0 = navigator.getGamepads();
  const pad0 = pads0[0];
  const pad1 = {id:'Fake DualShock 4 P2 (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
    index:1,connected:true,mapping:'standard',timestamp:performance.now(),
    axes:[0,0,0,0],buttons:Array.from({length:17},mk),
    vibrationActuator:{playEffect:()=>Promise.resolve('complete')}};
  window.__fakePad2={press(){const idx=Array.prototype.slice.call(arguments);
    for(let i=0;i<17;i++){const on=idx.indexOf(i)>=0;pad1.buttons[i].pressed=on;pad1.buttons[i].value=on?1:0;}
    pad1.timestamp=performance.now();}};
  Object.defineProperty(navigator,'getGamepads',{value:function(){return [pad0,pad1,null,null];},configurable:true});
  return 'ok';
})()`;
async function boardNearBrazier(api, i) {
  /* setup: moor her at the brazier's pool; boarding is still by prompt */
  await api.eval(`__fmDebug.skiffTo(NBRAZ[${i}].d - 6); skiffMoorToBank(); SAVE.skiffX = SKF.x; SAVE.skiffZ = SKF.z; 0`);
  const bank = await api.eval(`(function(){
    const r = runNear(SKF.x, SKF.z), side = r.off >= 0 ? 1 : -1;
    for (let u = 0.5; u <= 16; u += 0.5) {
      const px = SKF.x + r.s.nx * u * side, pz = SKF.z + r.s.nz * u * side;
      if (riverDepthAt(px, pz) < 0.35 && !window.__forestSolid(px, pz)) return { x: +px.toFixed(1), z: +pz.toFixed(1) };
    }
    return { x: SKF.x, z: SKF.z }; })()`);
  await api.eval(`__fmDebug.warp(${bank.x}, ${bank.z}); 0`);
  await sleep(300);
  const skp = await api.eval('({x: SKF.x, z: SKF.z})');
  for (let a = 0; a < 4 && !(await api.eval(`__fm.prompt === 'skiffOn'`)); a++) {
    await walkTo(api, skp.x, skp.z, 4.0, 20000).catch(() => {});
    await sleep(250);
  }
  await api.waitFor(`__fm.prompt === 'skiffOn'`, 12000, 'board at brazier ' + i);
  await api.tap(0);
  await api.waitFor('__fm.skiffing === true', 8000, 'aboard');
}
async function suiteAscent() {
  console.log('\n── the ascent ──');
  const api = await session(Q20_POLE, '?turbo=5', ['nmDusk']);
  try {
    gate('ascent: braziers staged, none lit, the flotilla waits below',
      await api.eval(`__fm.brazLit === 0 && NBRAZ.length === 5`), await api.eval('__fm.brazList'));
    const flot0 = await api.eval('({x: __fm.flotLeadX, z: __fm.flotLeadZ})');
    gate('ascent: the fleet stands at the camp pool (pool −1)',
      await api.eval(`Math.hypot(__fm.flotLeadX - nmPoolSlot(-1, 0).x, __fm.flotLeadZ - nmPoolSlot(-1, 0).z) < 26`),
      JSON.stringify(flot0));
    /* THE EDDY READS: glassy circle vs white chute — a pixel question */
    await boardNearBrazier(api, 1);
    const B1 = await api.eval('({ex: NBRAZ[1].ex, ez: NBRAZ[1].ez, x: NBRAZ[1].x, z: NBRAZ[1].z, y: NBRAZ[1].ey})');
    await api.eval(`__fmDebug.hud(false); __fmDebug.cam(${B1.ex - 10}, ${B1.y} + 9, ${B1.ez - 8}, ${B1.ex}, ${B1.y}, ${B1.ez}); 0`);
    await sleep(900);
    await api.shot('eddy-read-1280x720');
    await api.eval('__fmDebug.camOff(); __fmDebug.hud(true); 0');
    /* eddy calm vs surge push — measured on the hull, sim ticks apart */
    await api.eval(`__fmBot.release(); __fakePad.axes(0,0); 0`);
    const drift = await api.eval(`(async function(){
      const rec = { eddy: null, chute: null };
      /* park her IN the eddy, hands off, one second of sim */
      SKF.x = NBRAZ[1].ex; SKF.z = NBRAZ[1].ez; SKF.spd = 0; skiffRescueIfNeeded();
      const a0 = [SKF.x, SKF.z, simTick];
      await new Promise(r => { const t0 = simTick; const iv = setInterval(() => { if (simTick - t0 >= 60) { clearInterval(iv); r(); } }, 30); });
      rec.eddy = { m: +Math.hypot(SKF.x - a0[0], SKF.z - a0[1]).toFixed(2), ticks: simTick - a0[2] };
      /* now mid-chute, waiting for a surge to stand ON */
      const s = RUN[runIndexAtD(NBRAZ[1].d + 40)];
      SKF.x = s.x; SKF.z = s.z; SKF.spd = 0;
      await new Promise(r => { const iv = setInterval(() => { if (nmSurgeK() > 0.8) { clearInterval(iv); r(); } }, 30); });
      const b0 = [SKF.x, SKF.z, simTick];
      await new Promise(r => { const t0 = simTick; const iv = setInterval(() => { if (simTick - t0 >= 60) { clearInterval(iv); r(); } }, 30); });
      rec.chute = { m: +Math.hypot(SKF.x - b0[0], SKF.z - b0[1]).toFixed(2), ticks: simTick - b0[2] };
      return rec;
    })()`);
    gate('ascent: the eddy is GLASS — a hands-off hull barely moves in it',
      drift.eddy.m < 1.2, JSON.stringify(drift.eddy));
    gate('ascent: the surge SHOVES — the same hull, mid-chute, is swept downstream',
      drift.chute.m > drift.eddy.m + 2.0, JSON.stringify(drift));
    /* light brazier 1 the real way: hold ✕ from the eddy */
    await api.eval(`SKF.x = NBRAZ[1].ex; SKF.z = NBRAZ[1].ez; SKF.spd = 0; 0`);
    await sleep(200);
    await api.waitFor(`(__fm.prompt || '').indexOf('nmBraz') === 0`, 8000, 'the brazier prompt');
    await api.shot('brazier-unlit-1280x720');
    await api.eval('__fakePad.press(0)');
    await api.waitFor('__fm.brazLit >= 1', 12000, 'the flame catches');
    await api.eval('__fakePad.press()');
    gate('ascent: HOLD ✕ strikes flint and lights the brazier', true, await api.eval('__fm.brazList'));
    await sleep(500);
    await api.shot('brazier-lit-1280x720');
    /* THE SNAPPER: provoked in the eddy, telegraph measured in sim ticks,
       answered by a kid-bot that only CHASES AND MASHES */
    await api.eval(P2_STUB);
    const snapBefore = await api.eval('__fm.snapAlive');
    await api.eval(`window.__nmSnapLog.length = 0; 0`);
    let cured = false, p2hit = false;
    for (let round = 0; round < 3 && !cured; round++) {
      await api.waitFor(`NM_SNAPPERS.some(s => s.bi === 1 && !s.gone && (s.st === 'coil' || s.st === 'lunge'))`,
        20000, 'a snapper wakes').catch(() => {});
      /* chase-and-mash: steer at the nearest snapper, hammer ✕ (P1) and ✕ (P2) */
      for (let i = 0; i < 26; i++) {
        const st2 = await api.eval(`(function(){
          const sn = NM_SNAPPERS.filter(s => s.bi === 1 && !s.gone && s.st !== 'leave')
            .sort((a, b) => Math.hypot(a.x - SKF.x, a.z - SKF.z) - Math.hypot(b.x - SKF.x, b.z - SKF.z))[0];
          if (!sn) return null;
          __fmBot.done = false; __fmBot.tol = 1.4; __fmBot.target = [sn.x, sn.z];
          return { d: +Math.hypot(sn.x - SKF.x, sn.z - SKF.z).toFixed(1), st: sn.st, hp: sn.hp };
        })()`);
        if (!st2) { cured = true; break; }
        await api.eval('__fakePad.press(0)'); await sleep(120);
        await api.eval('__fakePad.press()');
        await api.eval('__fakePad2.press(0)'); await sleep(90);
        await api.eval('__fakePad2.press()');
        if (!p2hit) p2hit = await api.eval('NM_P2.on === true');
      }
      await api.eval('__fmBot.target = null; __fakePad.axes(0,0); 0');
    }
    gate('ascent: the kid-bot (chase + mash, nothing else) cures a snapper', cured,
      'alive ' + snapBefore + ' → ' + await api.eval('__fm.snapAlive'));
    gate('ascent: P2 dropped in on the skiff and swung', p2hit === true);
    const log = await api.eval('JSON.stringify(window.__nmSnapLog)').then(JSON.parse);
    const teles = log.map(l => l.lunge - l.coil);
    gate('ascent: EVERY telegraph ≥ 54 sim ticks (kid-fair law, in-page recorder)',
      teles.length > 0 && teles.every(t => t >= 54), JSON.stringify(teles));
    /* the salt they hoard, collected from the hull */
    await api.eval(`(function(){ const s = NM_SALT.find(s => s.on); if (s) { SKF.x = s.x; SKF.z = s.z; } return !!s; })()`);
    await sleep(600);
    const salt = await api.eval('__fm.salt');
    gate('ascent: cured snappers DROP salt and the hull collects it', salt > 4, 'salt=' + salt);
    await sleep(300);
    await api.shot('snapper-eddy-1280x720');
    /* light the rest by the same real hold; the escort climbs pool by pool */
    for (const bi of [0, 2, 3, 4]) {
      await api.eval(`(function(){ if (P.skiffing) { P.skiffing = false; skiffColl.off = false; } return 1; })()`);
      await boardNearBrazier(api, bi);
      await api.eval(`SKF.x = NBRAZ[${bi}].ex; SKF.z = NBRAZ[${bi}].ez; SKF.spd = 0; 0`);
      await sleep(250);
      await api.waitFor(`(__fm.prompt || '').indexOf('nmBraz') === 0`, 9000, 'prompt at brazier ' + bi);
      await api.eval('__fakePad.press(0)');
      await api.waitFor(`NBRAZ[${bi}].lit === true`, 14000, 'brazier ' + bi + ' lit');
      await api.eval('__fakePad.press()');
      const lit = await api.eval('__fm.brazLit');
      const expect = await api.eval(`(function(){
        const t = nmFlotTargets();
        const lit2 = nmBrazLitCount();
        const want = SAVE.marketOpen ? 'berth' : ('pool ' + (lit2 - 1));
        return { lit: lit2, want, dx: +Math.hypot(NM_FLOT[0].tx - t[0].x, NM_FLOT[0].tz - t[0].z).toFixed(1) };
      })()`);
      gate('ascent: brazier ' + bi + ' lit — the escort retargets (' + expect.want + ')',
        expect.dx < 0.5, JSON.stringify(expect));
      if (lit === 3) await api.shot('brazier-three-flotilla-1280x720');
    }
    gate('ascent: all five burn, the market opens, quest 21',
      await api.eval(`__fm.brazLit === 5 && __fm.marketOpen === true && __fm.quest === 21`),
      await api.eval(`JSON.stringify({b: __fm.brazList, q: __fm.quest, m: __fm.marketOpen})`));
    gate('ascent: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('ascent suite', false, e.message);
    await api.shot('ascent-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 4 — THE NIGHT MARKET: spends, spectacle, the ceremony ═══════════ */
async function suiteMarket() {
  console.log('\n── the night market ──');
  const api = await session(Q21_MARKET, '?turbo=3', ['nmDusk']);
  try {
    const m0 = await api.eval('({open: __fm.marketOpen, night: __fm.nightK, q: __fm.quest})');
    gate('market: berthed, open, and it is NIGHT', m0.open && m0.night === 1 && m0.q === 21, JSON.stringify(m0));
    /* walk in through the registered gate */
    const gpos = await api.eval('({x: NM_MARKET.gate.x, z: NM_MARKET.gate.z})');
    await walkTo(api, gpos.x, gpos.z, 1.8, 60000).catch(() => {});
    const gd = await api.eval(`Math.hypot(__fm.x - NM_MARKET.gate.x, __fm.z - NM_MARKET.gate.z)`);
    gate('market: the gate is walkable ground (portal law)', gd < 3.2, gd.toFixed(1) + ' m');
    await api.eval(`__fmDebug.hud(false); __fmDebug.cam(NM_MARKET.gate.x + NM_MARKET.ax * 10, NM_MARKET.qy + 5.5, NM_MARKET.gate.z + NM_MARKET.az * 10, NM_MARKET.qx, NM_MARKET.qy + 1, NM_MARKET.qz); 0`);
    await sleep(1100);
    const wideF = await api.shot('market-wide-1280x720');
    /* the lit market must READ lit: warm pixels around the stalls */
    const png = decodePNG(fs.readFileSync(wideF));
    let warmN = 0;
    for (let y = 100; y < 560; y += 2) {
      for (let x = 100; x < 1180; x += 2) {
        const i = (y * png.w + x) * png.bpp;
        if (png.px[i] > 70 && png.px[i] > png.px[i + 2] + 22) warmN++;
      }
    }
    gate('market: the lanterns read WARM in pixels (lit-warm count across the frame)',
      warmN > 300, warmN + ' warm samples');
    await api.eval('__fmDebug.camOff(); __fmDebug.hud(true); 0');
    /* THE FOUR SPENDS — salt math asserted at every counter */
    const buys = [
      ['nmHeart', 60, 'heart'], ['nmGlass', 25, 'spyglass'],
      ['nmPennant', 5, 'pennant'], ['nmFire', 3, 'rocket'],
    ];
    for (const [id, price, name] of buys) {
      const spot = await api.eval(`(function(){ const st = NM_MARKET.stalls.find(s => s.id === '${id}');
        return { x: +(st.x - NM_MARKET.ox * 2.7).toFixed(1), z: +(st.z - NM_MARKET.oz * 2.7).toFixed(1) }; })()`);
      for (let a = 0; a < 4 && !(await api.eval(`__fm.prompt === '${id}'`)); a++) {
        await walkTo(api, spot.x, spot.z, 1.2, 30000).catch(() => {});
        await sleep(250);
      }
      await api.waitFor(`__fm.prompt === '${id}'`, 9000, name + ' prompt');
      const s0 = await api.eval('__fm.salt');
      const label = await api.eval(`(currentInteract()||{}).label`);
      gate('market: the ' + name + ' prompt names its price', /BUY/.test(label), label);
      await api.tap(0);
      for (let i = 0; i < 6 && (await api.eval(`__fm.state === 'dialog'`)); i++) await api.tap(0);
      await api.waitFor(`__fm.salt < ${'${s0}'} && __fm.state === 'play'`, 8000, name + ' paid').catch(() => {});
      const s1 = await api.eval('__fm.salt');
      gate('market: the ' + name + ' costs exactly ' + price + ' salt', s0 - s1 === price, s0 + ' → ' + s1);
      await api.shot('market-stall-' + name + '-1280x720');
    }
    const owned = await api.eval('({mh: __fm.maxHearts, heart: __fm.marketHeart, glass: SAVE.spyglass, pen: __fm.pennant, fw: SAVE.fireworks})');
    gate('market: heart container +1 max heart', owned.heart === true && owned.mh === 9, JSON.stringify(owned));
    gate('market: spyglass owned, pennant dyed, a rocket aboard',
      owned.glass === true && owned.pen >= 1 && owned.fw >= 1, JSON.stringify(owned));
    /* THE SPYGLASS — hold △ (kbd hold works for pad law too: same IN path) */
    await api.eval(`window.dispatchEvent(new KeyboardEvent('keydown', {code:'KeyL', key:'l', bubbles:true})); 0`);
    await api.waitFor('__fm.spyglassK > 0.9', 8000, 'the glass raises');
    const fov = await api.eval('camera.fov');
    gate('market: HOLD △ raises the spyglass (~2.5× reach)', fov < 30, 'fov=' + fov.toFixed(1));
    await api.shot('market-spyglass-1280x720');
    await api.eval(`window.dispatchEvent(new KeyboardEvent('keyup', {code:'KeyL', key:'l', bubbles:true})); 0`);
    await api.waitFor('__fm.spyglassK < 0.05 && camera.fov > 60', 8000, 'the glass lowers');
    gate('market: releasing △ restores the lens', true);
    /* fireworks, from the skiff, at night */
    const bank = await api.eval(`(function(){
      const r = runNear(SKF.x, SKF.z), side = r.off >= 0 ? 1 : -1;
      for (let u = 0.5; u <= 16; u += 0.5) {
        const px = SKF.x + r.s.nx * u * side, pz = SKF.z + r.s.nz * u * side;
        if (riverDepthAt(px, pz) < 0.35 && !window.__forestSolid(px, pz)) return { x: +px.toFixed(1), z: +pz.toFixed(1) };
      }
      return { x: SKF.x, z: SKF.z }; })()`);
    await walkTo(api, bank.x, bank.z, 1.3, 40000).catch(() => {});
    {
      const skp2 = await api.eval('({x: SKF.x, z: SKF.z})');
      await walkTo(api, skp2.x, skp2.z, 4.0, 20000).catch(() => {});
    }
    await api.waitFor(`__fm.prompt === 'skiffOn'`, 12000, 'boarding');
    await api.tap(0);
    await api.waitFor('__fm.skiffing === true', 8000, 'aboard');
    await api.waitFor(`__fm.prompt === 'nmFirework'`, 12000, 'the launch prompt');
    await api.tap(0);
    await api.waitFor('__fm.fwLaunched >= 1', 8000, 'launched');
    gate('market: ✕ launches the rocket from the skiff (charge consumed)',
      await api.eval('(SAVE.fireworks | 0) === 0'));
    await sleep(700);
    await api.shot('market-firework-1280x720');
    /* THE CEREMONY — given, not won; skippable; the quest holds at 21 */
    await api.eval(`(function(){ if (P.skiffing) { P.skiffing = false; skiffColl.off = false; P.x = ${bank.x}; P.z = ${bank.z}; P.fy = groundH(P.x, P.z); } return 1; })()`);
    const tpos = await api.eval('({x: __fm.traderX, z: __fm.traderZ})');
    await walkTo(api, tpos.x, tpos.z, 2.0, 40000).catch(() => {});
    await api.waitFor(`__fm.prompt === 'nmTrader'`, 10000, 'the trader at the quay');
    await api.tap(0);
    for (let i = 0; i < 8 && (await api.eval(`__fm.state === 'dialog'`)); i++) await api.tap(0);
    await api.waitFor(`__fm.state === 'cine' && __fm.cinId === 'nmCeremony'`, 10000, 'the ceremony');
    gate('market: the stern lantern opens (the ceremony beat)', true);
    await sleep(2600);
    await api.shot('ceremony-lantern-1280x720');
    await api.waitFor(`__fm.state === 'play'`, 40000, 'it ends by itself');
    const cw = await api.eval('({s5: __fm.sliver5, carry: __fm.carry5, q: __fm.quest})');
    gate('market: THE FIFTH SLIVER is given — carried, quest still the market\'s',
      cw.s5 === true && cw.carry === true && cw.q === 21, JSON.stringify(cw));
    await sleep(400);
    await api.shot('ceremony-carried-1280x720');
    gate('market: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('market suite', false, e.message);
    await api.shot('market-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 5 — THE NIGHT RUN HOME + THE WHEEL + THE CARD ═══════════ */
async function suiteHome() {
  console.log('\n── the night run home ──');
  const api = await session(Q21_SLIVER, '?turbo=5', ['nmDusk', 'nmCeremony']);
  try {
    gate('home: the compass stages DOWN the spine', await api.eval(`(function(){
      const o = objectivePoint();
      if (!o) return false;
      const r = runNear(__fm.x, __fm.z);
      const ro = runNear(o.x, o.z);
      return ro.s.d < r.s.d + 5; })()`));
    /* ride her down by lantern light — the surge runs WITH you now */
    const bank = await api.eval(`(function(){
      const r = runNear(SKF.x, SKF.z), side = r.off >= 0 ? 1 : -1;
      for (let u = 0.5; u <= 16; u += 0.5) {
        const px = SKF.x + r.s.nx * u * side, pz = SKF.z + r.s.nz * u * side;
        if (riverDepthAt(px, pz) < 0.35 && !window.__forestSolid(px, pz)) return { x: +px.toFixed(1), z: +pz.toFixed(1) };
      }
      return { x: SKF.x, z: SKF.z }; })()`);
    await walkTo(api, bank.x, bank.z, 1.3, 40000).catch(() => {});
    {
      const skp2 = await api.eval('({x: SKF.x, z: SKF.z})');
      await walkTo(api, skp2.x, skp2.z, 4.0, 20000).catch(() => {});
    }
    await api.waitFor(`__fm.prompt === 'skiffOn'`, 12000, 'boarding');
    await api.tap(0);
    await api.waitFor('__fm.skiffing === true', 8000, 'aboard');
    const d0 = await api.eval('runNear(SKF.x, SKF.z).s.d');
    await api.eval('__fmBot.tol = 7; __fmBot.sprint(true)');
    let best = d0;
    for (let i = 0; i < 60; i++) {
      const q = await api.eval(`(function(){
        const ahead = RUN[Math.max(0, SKF.i - 30)];
        __fmBot.done = false; __fmBot.target = [ahead.x, ahead.z];
        return { d: runNear(SKF.x, SKF.z).s.d, vis: skiffGrp.visible };
      })()`);
      best = Math.min(best, q.d);
      if (i === 10) await api.shot('night-run-1280x720');
      if (best < d0 - 320) break;
      await sleep(300);
    }
    await api.eval('__fmBot.release()');
    gate('home: the night run rides 300 m downstream by lantern light', best < d0 - 300,
      Math.round(d0) + ' → ' + Math.round(best));
    /* the carry home is long; the wheel beat is the assertion that matters —
       stage the last leg (setup), then walk the prompt for real */
    await api.eval(`(function(){ if (P.skiffing) leaveSkiff(); return 1; })()`);
    await api.eval(`__fmDebug.warp(WHEEL_POS.x + 6, WHEEL_POS.z + 6); 0`);
    await sleep(400);
    for (let a = 0; a < 6 && !(await api.eval(`__fm.prompt === 'nmWheel5'`)); a++) {
      const ang = a * Math.PI / 3;
      await walkTo(api, await api.eval('WHEEL_POS.x') + Math.cos(ang) * 3.8,
        await api.eval('WHEEL_POS.z') + Math.sin(ang) * 3.8, 1.3, 30000).catch(() => {});
      await sleep(250);
    }
    await api.waitFor(`__fm.prompt === 'nmWheel5'`, 10000, 'the wheel prompt');
    gate('home: the Moonwheel offers the fifth notch', true, await api.eval(`(currentInteract()||{}).label`));
    await api.tap(0);
    await api.waitFor(`__fm.state === 'cine' && __fm.cinId === 'nmWheel5'`, 8000, 'the beat');
    await sleep(2200);
    await api.shot('wheel5-beat-1280x720');
    await api.waitFor(`__fm.state === 'tbc'`, 45000, 'the end card');
    gate('home: the beat ends in the 5/8 card by itself', true);
    const w = await api.eval('({sky: __fm.skyStep, ph: __fm.phases, q: __fm.quest, tbc: __fm.tbc5Seen, sub: document.getElementById("tbcSub").textContent.slice(0, 50)})');
    gate('home: sky 5, phase 5, quest 22, the card marked seen',
      w.sky === 5 && w.ph === 5 && w.q === 22 && w.tbc === true, JSON.stringify(w));
    gate('home: the card teases the FULL MIRROR',
      await api.eval(`/full/i.test(document.getElementById('tbcSub').textContent)`), w.sub);
    await sleep(1400);
    await api.shot('tbc5-card-1280x720');
    await tapUntil(api, () => api.tap(0), `__fm.state === 'play'`, 12, 'leave the card');
    const after = await api.eval('({moon: nmMoonLitPh, night: __fm.nightK, seat: wheelRing.rotation.z})');
    gate('home: the wheel holds five notches (ring at −5π/4)',
      Math.abs(after.seat + Math.PI * 1.25) < 0.02, JSON.stringify(after));
    await sleep(600);
    await api.shot('wheel5-after-1280x720');
    gate('home: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('home suite', false, e.message);
    await api.shot('home-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 6 — WORLD: continue-resumes-right + the John sequence ═══════════ */
async function suiteWorld() {
  console.log('\n── continue + the John sequence ──');
  /* CONTINUE mid-ascent: lastPos + the night state both come back */
  const api = await session({ ...Q20_POLE, braziers: [true, true, false, false, false], lastPos: [900, 470] }, '?turbo=3', ['nmDusk']);
  try {
    const r = await api.eval('({x: __fm.x, z: __fm.z, night: __fm.nightK, lit: __fm.brazLit, q: __fm.quest})');
    gate('world: CONTINUE resumes at lastPos, at NIGHT, braziers remembered',
      Math.hypot(r.x - 900, r.z - 470) < 4 && r.night === 1 && r.lit === 2 && r.q === 20, JSON.stringify(r));
    const flames = await api.eval('nmFlames.map(f => NBRAZ[nmFlames.indexOf(f)].lit)');
    gate('world: lit braziers derive lit', flames[0] === true && flames[1] === true && flames[2] === false,
      JSON.stringify(flames));
    gate('world: zero console errors (continue)', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) { gate('world continue', false, e.message); }
  api.close();

  const api2 = await session(Q22_DONE, '?turbo=4', ['nmDusk', 'nmCeremony', 'nmWheel5']);
  try {
    const done = await api2.eval('({sky: __fm.skyStep, ph: __fm.phases, pen: __fm.pennant, mh: __fm.maxHearts})');
    gate('world: the finished save boots at 5/8 with its buys', done.sky === 5 && done.ph === 5, JSON.stringify(done));
    /* NEW GAME through the real guard */
    await api2.nav(await api2.eval('location.href'));
    await api2.waitFor(`__fm.state === 'title'`, 30000, 'title again');
    await tapUntil(api2, () => api2.tap(0), '__fm.ngGuardOn === true', 10, 'the guard');
    await tapUntil(api2, () => api2.tap(0), `__fm.state !== 'title'`, 10, 'confirm fresh');
    await api2.waitFor(`__fm.state === 'play'`, 40000, 'a fresh adventure');
    await sleep(900);
    const fresh = await api2.eval(`({
      night: __fm.nightK, q: __fm.quest, braz: __fm.brazLit, market: __fm.marketOpen,
      pole: __fm.poleFound, s5: __fm.sliver5, pen: __fm.pennant,
      stars: nmStarMesh.visible, moon: nmMoonMesh.visible, sun: sunDisc.visible,
      flot: NM_FLOT.every(b => !b.g.visible), marketMesh: !nmMarketMesh.visible,
      poleMesh: !nmPoleRest.visible, pennantMesh: !nmPennantSkiff.visible,
      fov: +camera.fov.toFixed(0), collOff: NBRAZ.every(b => b.coll.every(c => c.off)),
      stallsOff: nmMarketColl.slice(0, 4).every(c => c.off),
    })`);
    gate('world: NEW GAME — the night lifts, the sun comes back',
      fresh.night === 0 && fresh.stars === false && fresh.moon === false && fresh.sun === true, JSON.stringify(fresh));
    gate('world: NEW GAME — fleet, market, braziers, pole, pennant all un-derive',
      fresh.q === 0 && fresh.braz === 0 && !fresh.market && !fresh.pole && !fresh.s5 &&
      fresh.flot && fresh.marketMesh && fresh.poleMesh && fresh.pennantMesh &&
      fresh.collOff && fresh.stallsOff && fresh.fov === 66, JSON.stringify(fresh));
    gate('world: zero console errors (new game)', api2.errs.length === 0, api2.errs.slice(0, 3).join(' | '));
  } catch (e) { gate('world suite', false, e.message); }
  api2.close();
}

/* ═══════════ 7 — BUDGETS, in LOWFX, and the station-355 fix ═══════════ */
async function suitePerf() {
  console.log('\n── budgets (LOWFX — the console\'s mode) ──');
  const api = await session(Q21_MARKET, '?fx=low&turbo=2', ['nmDusk']);
  try {
    /* the LIT MARKET, four azimuths at the gate — measured in real time */
    await api.eval('window.__fmTurbo = 1; 0');
    await api.eval(`__fmDebug.warp(NM_MARKET.gate.x, NM_MARKET.gate.z); 0`);
    await sleep(700);
    let worst = { calls: 0, tris: 0, at: '' };
    for (let a = 0; a < 4; a++) {
      await api.eval(`__fmDebug.camYaw(${(a * Math.PI / 2).toFixed(3)}); 0`);
      await sleep(320);
      const m = await api.eval('({calls: __fm.calls, tris: __fm.tris})');
      if (m.calls > worst.calls) worst = { calls: m.calls, tris: m.tris, at: 'market yaw' + a };
    }
    gate('perf: the LIT MARKET holds ≤80 calls (LOWFX)', worst.calls <= 80, JSON.stringify(worst));
    gate('perf: ≤120k tris at the market', worst.tris <= 120000, worst.tris + '');
    /* mid-ascent, aboard, flames burning */
    await api.eval('window.__fmTurbo = 2; 0');
    const bank = await api.eval(`(function(){ __fmDebug.skiffTo(NBRAZ[2].d); skiffMoorToBank(); const r = runNear(SKF.x, SKF.z), side = r.off >= 0 ? 1 : -1;
      for (let u = 0.5; u <= 16; u += 0.5) {
        const px = SKF.x + r.s.nx * u * side, pz = SKF.z + r.s.nz * u * side;
        if (riverDepthAt(px, pz) < 0.35 && !window.__forestSolid(px, pz)) return { x: +px.toFixed(1), z: +pz.toFixed(1) };
      }
      return { x: SKF.x, z: SKF.z }; })()`);
    await api.eval(`__fmDebug.warp(${bank.x}, ${bank.z}); 0`);
    await walkTo(api, bank.x, bank.z, 1.3, 30000).catch(() => {});
    {
      const skp2 = await api.eval('({x: SKF.x, z: SKF.z})');
      await walkTo(api, skp2.x, skp2.z, 4.0, 20000).catch(() => {});
    }
    await api.waitFor(`__fm.prompt === 'skiffOn'`, 12000, 'board mid-ascent');
    await api.tap(0);
    await api.waitFor('__fm.skiffing === true', 8000, 'aboard');
    await api.eval('window.__fmTurbo = 1; 0');
    await sleep(500);
    let worst2 = { calls: 0, tris: 0 };
    for (let a = 0; a < 4; a++) {
      await api.eval(`__fmDebug.camYaw(${(a * Math.PI / 2).toFixed(3)}); 0`);
      await sleep(320);
      const m = await api.eval('({calls: __fm.calls, tris: __fm.tris})');
      if (m.calls > worst2.calls) worst2 = { calls: m.calls, tris: m.tris };
    }
    gate('perf: mid-ascent aboard holds ≤80 calls (LOWFX)', worst2.calls <= 80, JSON.stringify(worst2));
    gate('perf: ≤120k tris mid-ascent', worst2.tris <= 120000, worst2.tris + '');
    gate('perf: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) { gate('perf market suite', false, e.message); }
  api.close();

  /* STATION 355 — the pre-existing 92-call hotspot, now fixed. Measured
     DAYLIGHT, pre-arc (the save that showed it), aboard at the head pool. */
  console.log('\n── station 355 (the old hotspot, by day) ──');
  const api2 = await session({ ...PHASE4_DONE, region: 'forest', lastPos: [1866, 1132], skiffX: 1870, skiffZ: 1128 }, '?fx=low&turbo=2');
  try {
    await api2.eval('__fmDebug.skiffTo(2164); skiffMoorToBank(); SAVE.skiffX = SKF.x; SAVE.skiffZ = SKF.z; 0');
    const bank = await api2.eval(`(function(){ const r = runNear(SKF.x, SKF.z), side = r.off >= 0 ? 1 : -1;
      for (let u = 0.5; u <= 16; u += 0.5) {
        const px = SKF.x + r.s.nx * u * side, pz = SKF.z + r.s.nz * u * side;
        if (riverDepthAt(px, pz) < 0.35 && !window.__forestSolid(px, pz)) return { x: +px.toFixed(1), z: +pz.toFixed(1) };
      }
      return { x: SKF.x, z: SKF.z }; })()`);
    await api2.eval(`__fmDebug.warp(${bank.x}, ${bank.z}); 0`);
    await walkTo(api2, bank.x, bank.z, 1.3, 30000).catch(() => {});
    {
      const skp2 = await api2.eval('({x: SKF.x, z: SKF.z})');
      await walkTo(api2, skp2.x, skp2.z, 4.0, 20000).catch(() => {});
    }
    await api2.waitFor(`__fm.prompt === 'skiffOn'`, 12000, 'board at the head pool');
    await api2.tap(0);
    await api2.waitFor('__fm.skiffing === true', 8000, 'aboard');
    await api2.eval('window.__fmTurbo = 1; 0');
    await sleep(600);
    let worst3 = { calls: 0, tris: 0, at: 0 };
    for (let a = 0; a < 4; a++) {
      await api2.eval(`__fmDebug.camYaw(${(a * Math.PI / 2).toFixed(3)}); 0`);
      await sleep(340);
      const m = await api2.eval('({calls: __fm.calls, tris: __fm.tris})');
      if (m.calls > worst3.calls) worst3 = { calls: m.calls, tris: m.tris, at: a };
    }
    gate('perf: STATION 355 FIXED — ≤80 calls aboard at the head pool (was 92)',
      worst3.calls <= 80, JSON.stringify(worst3));
    /* and the fix must not punch a horizon hole: look downstream, on the water */
    await api2.shot('station355-look-1280x720');
    gate('perf: zero console errors (355)', api2.errs.length === 0, api2.errs.slice(0, 3).join(' | '));
  } catch (e) { gate('perf 355 suite', false, e.message); }
  api2.close();
}

/* ═══════════ main ═══════════ */
if (want('dusk')) await suiteDusk();
if (want('pole')) await suitePole();
if (want('ascent')) await suiteAscent();
if (want('market')) await suiteMarket();
if (want('home')) await suiteHome();
if (want('world')) await suiteWorld();
if (want('perf')) await suitePerf();
process.exit(summary());
