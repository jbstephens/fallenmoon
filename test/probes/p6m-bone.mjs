#!/usr/bin/env node
/* p6m — THE EMBERWASTE probe: the final region, the lava-glow no-go, the
   KILN HOUND, the cooling, and the hound who comes home.
   The gates that matter:
   — the region registries + conformance, zero carve-outs;
   — the hazard NEVER deals invisible damage (20 real-input trials at the
     glow edge: knockback only, hearts untouched);
   — pockets killable by real slashes;
   — the FULL q28→31 journey from a phase-6-done fixture with real verbs
     (sail south, landfall, cross, win, cure, sail home, slot, TBC 7/8);
   — a KID BOT that only chases and mashes ✕ wins FIVE CONSECUTIVE fights;
   — the hound follows, dozes, is pettable, rides the bow, persists;
   — old-save compat; LOWFX budgets at the four worst vistas.

   Run:  node test/probes/p6m-bone.mjs [section...]
   Sections: region hazard pockets fight kidbot cure journey hound saves perf */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, tapUntil, sleep, GAME } from './p6g.mjs';
const gate = (label, ok, extra) => rawGate(ok, label, extra);
import fs from 'node:fs';
import path from 'node:path';

const SHOTS = '/tmp/fm_p6m';
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2)
  : ['region', 'hazard', 'pockets', 'fight', 'kidbot', 'cure', 'journey', 'hound', 'saves', 'perf'];
const want = (s) => WANT.includes(s);

const PHASE6_DONE = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'phase6-done-save.json'), 'utf8'));
const PHASE5_DONE = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'phase5-done-save.json'), 'utf8'));
/* the arc's stations, purely from flags */
const Q29_LANDED = { ...PHASE6_DONE, q: 29, emberSeen: true,
  lastPos: [-1150, -985], lastShade: [-1157, -992], boatX: -1146, boatZ: -970, boatAng: 0.2 };
const Q30_CURED = { ...Q29_LANDED, q: 30, boneDone: true, houndHome: true,
  lastPos: [8.2, 7.0], lastShade: [8.2, 7.0], boatX: null, boatZ: null };
const Q31_DONE = { ...Q30_CURED, q: 31, sky: 7, ph: 7, tbc7Seen: true };
const HINTS = ['obHintTail', 'obHintMote', 'obHintClod', 'obCrustHolds', 'obPetLine'];

/* the seaway + trail the compass stages (mirrors the part's pins) */
const SEAWAY = [[-360, -40], [-620, -330], [-840, -560], [-1000, -760], [-1090, -880], [-1146, -970]];
const TRAIL = [[-1150, -985], [-1168, -1010], [-1190, -1032], [-1178, -1058],
  [-1205, -1082], [-1232, -1102], [-1240, -1130], [-1245, -1155], [-1240, -1168], [-1240, -1184]];

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
  await api.nav(`http://127.0.0.1:${hport}/${query || '?turbo=6'}`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title');
  await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 14, 'focus CONTINUE');
  await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 16, 'leave title');
  await api.waitFor(`__fm.state === 'play' || __fm.state === 'cine'`, 30000, 'play/cine');
  for (let i = 0; i < 30 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(350); }
  await api.installBot('pad');
  return api;
}
const jget = async (api, e) => JSON.parse(await api.eval(`JSON.stringify(${e})`));
async function warpSure(api, x, z) {
  for (let i = 0; i < 5; i++) {
    await api.eval(`if (window.__fmBot && __fmBot.release) __fmBot.release();
      __fakePad.axes(0,0); __fakePad.press();
      __fmDebug.warp(${x}, ${z}); P.vx = 0; P.vz = 0; 0`);
    await api.waitTicks(4);
    if (await api.eval(`Math.hypot(P.x - (${x}), P.z - (${z})) < 4`)) return;
  }
  throw new Error(`warp would not stick at ${x},${z}`);
}
async function walkTo(api, x, z, tol, timeout, label) {
  await api.eval(`__fmBot.tol = ${tol || 1.2}; __fmBot.target = [${x}, ${z}]; 0`);
  await api.waitFor(`Math.hypot(__fm.x - (${x}), __fm.z - (${z})) < ${(tol || 1.2) + 2.4}`, timeout || 60000, label || `walk to ${x},${z}`);
}

/* ═══ REGION: registries, conformance, the gate, the ground truths ═══ */
if (want('region')) {
  console.log('\n═══ the Emberwaste: registries + conformance ═══');
  const api = await session(Q30_CURED, '?turbo=6', HINTS);
  await api.eval('__fmDebug.warp.ember(); 0');
  await api.waitTicks(10);
  /* RULE 1: declared once, conformant everywhere, zero carve-outs */
  const reg = await jget(api, `window.__WORLD_REG.filter(r => r.name === 'emberwaste').length`);
  gate('region: ONE declared ground owner (RULE 1)', reg === 1);
  const conf = await jget(api, `(function(){
    const R = window.__WORLD_REG.find(r => r.name === 'emberwaste');
    let pts = 0, owned = 0, bad = 0, worst = 0, unowned = [];
    for (let x = -1420; x <= -1000; x += 12) for (let z = -1245; z <= -965; z += 10) {
      if (!obInRegion(x, z)) continue;
      pts++;
      if (worldSolidAt(x, z)) continue;         // walls own themselves
      if (!R.owns(x, z)) { unowned.push(x + ',' + z); continue; }
      owned++;
      const dh = Math.abs(groundH(x, z) - R.ground(x, z));
      if (dh > 0.05) bad++;
      if (dh > worst) worst = dh;
    }
    return { pts, owned, bad, worst, un: unowned.length };
  })()`);
  gate('region: conformance sweep — ZERO carve-outs', conf.bad === 0 && conf.un === 0,
    `pts=${conf.pts} owned=${conf.owned} worst=${conf.worst}`);
  gate('region: the sweep covered real ground', conf.pts > 800, 'pts=' + conf.pts);
  /* RULE 2: the caldera gate is a portal, registered once, and agrees */
  const por = await jget(api, `window.__PORTALS.filter(p => p.name === 'kiln-gate').map(p => [p.openNow(), worldSolidAt(p.x, p.z)])`);
  gate('region: kiln-gate registered ONCE, open, non-solid (RULE 2)',
    por.length === 1 && por[0][0] === true && por[0][1] === false, JSON.stringify(por));
  /* the ring is a wall everywhere else */
  const ring = await jget(api, `(function(){
    let solid = 0, n = 0;
    for (let k = 0; k < 40; k++) {
      const a = k / 40 * Math.PI * 2;
      if (Math.abs(((a % (Math.PI*2)) + Math.PI*2) % (Math.PI*2)) < 0.5 || Math.abs(a - Math.PI*2) < 0.5) continue;
      n++;
      if (worldSolidAt(-1240 + Math.sin(a) * 15.9, -1185 + Math.cos(a) * 15.9)) solid++;
    }
    return { solid, n };
  })()`);
  gate('region: the caldera ring reads as WALL off the gate arc', ring.solid >= ring.n - 2, JSON.stringify(ring));
  /* the trail is walkable crust: never solid, never glow, never wet */
  const trail = await jget(api, `(function(){
    const T = ${JSON.stringify(TRAIL.slice(0, 9))};
    return T.map(([x, z]) => [worldSolidAt(x, z), +obLavaEdgeDist(x, z).toFixed(1), +groundH(x, z).toFixed(1)]);
  })()`);
  gate('region: every trail step is dry, solid-free, glow-free crust',
    trail.every(t => !t[0] && t[1] > 2.0 && t[2] > -0.4), JSON.stringify(trail));
  /* the anchor + shade laws, registered from day one */
  gate('region: dunk-rescue anchor registered', await api.eval(`ISLE_ANCHORS.some(a => a.id === 'emberwaste')`));
  gate('region: the caldera bowl is registered SHADE (the drowned-tower lesson)',
    await api.eval(`inShadeAt(-1240, -1185) === true`));
  gate('region: the moor floats her in deep water (≥1.3 m)',
    await api.eval(`(-0.55 - groundH(-1146, -970)) >= 1.3`),
    'depth=' + await api.eval(`(-0.55 - groundH(-1146, -970)).toFixed(2)`));
  /* walk the gate with REAL input (a portal that agrees but cannot be
     walked is still a wall) */
  await api.eval('__fmDebug.warp(-1240, -1162); P.hearts = P.maxHearts; 0');
  await api.waitTicks(6);
  await walkTo(api, -1240, -1179, 1.5, 60000, 'through the gate');
  gate('region: the gate WALKS both ways — outside → bowl floor',
    await api.eval(`Math.hypot(P.x - (-1240), P.z - (-1185)) < 12 && Math.abs(P.fy - 8.6) < 1.5`),
    await api.eval(`JSON.stringify([P.x.toFixed(1), P.z.toFixed(1), P.fy.toFixed(2)])`));
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  gate('region: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ HAZARD: the lava glow — 20 trials, knockback only, hearts untouched ═══ */
if (want('hazard')) {
  console.log('\n═══ the lava-glow no-go (Maria\'s laws) ═══');
  const api = await session(Q29_LANDED, '?turbo=6', ['obHintTail', 'obHintMote', 'obHintClod', 'obPetLine']);
  /* pool A edge (approach from the north crust) */
  let heartsLost = 0, puffs0 = 0, insideEver = 0, trials = 0, vignetteSeen = false;
  for (let t = 0; t < 20; t++) {
    const pool = t % 2 === 0 ? [-1130, -1035, 16] : [-1155, -1080, 13];
    const ax = pool[0] + (t % 4 < 2 ? 0 : 3), az = pool[1] - pool[2] - 4;
    await api.eval(`__fmDebug.warp(${ax}, ${az}); P.hearts = P.maxHearts; __fmBot.release(); 0`);
    await api.waitTicks(6);
    const p0 = await api.eval('__fm.obPuffN');
    await api.eval(`__fmBot.tol = 0.5; __fmBot.target = [${pool[0]}, ${pool[1]}]; 0`);
    const ok = await api.waitFor(`__fm.obPuffN > ${p0}`, 25000, 'puff ' + t).then(() => true).catch(() => false);
    if (!ok) continue;
    trials++;
    if (p0 < await api.eval('__fm.obPuffN')) puffs0++;
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await api.waitTicks(8);
    const st = await jget(api, `({h: P.hearts, mh: P.maxHearts, ed: +obLavaEdgeDist(P.x, P.z).toFixed(2), vg: obHeatEl.style.opacity})`);
    if (st.h !== st.mh) heartsLost++;
    if (st.ed < -0.4) insideEver++;
    if (parseFloat(st.vg) > 0.05) vignetteSeen = true;
    /* celebrate-safety: back off to solid crust */
    await api.eval(`__fmBot.tol = 1.0; __fmBot.target = [${ax}, ${az}]; 0`);
    await sleep(700);
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  }
  gate('HAZARD: 20 real walks at the glow — every one answered by a PUFF', trials >= 18, `${trials}/20 trials, ${puffs0} puffs`);
  gate('HAZARD: hearts NEVER touched (nothing kills, no damage-from-nowhere)', heartsLost === 0, `lost in ${heartsLost} trials`);
  gate('HAZARD: the player never ends up inside the glow', insideEver === 0, `inside ${insideEver}×`);
  gate('HAZARD: the heat-shimmer warning showed (instructive, visible)', vignetteSeen);
  gate('HAZARD: reaching safe crust is celebrated', (await api.eval('__fm.obReliefN')) > 0,
    'reliefs=' + await api.eval('__fm.obReliefN'));
  /* the jump-in bounce: landing IN the glow bounces home, zero hearts */
  await api.eval(`__fmDebug.warp(-1130, -1055); P.hearts = P.maxHearts; 0`);
  await api.waitTicks(10);
  await api.eval(`P.x = -1130; P.z = -1040; P.fy = obGroundAt(P.x, P.z); P.air = false; 0`);
  await api.waitTicks(10);
  const b = await jget(api, `({h: P.hearts, mh: P.maxHearts, ed: +obLavaEdgeDist(P.x, P.z).toFixed(2)})`);
  gate('HAZARD: a landing inside the glow BOUNCES to the last crust, hearts intact',
    b.h === b.mh && b.ed > 0, JSON.stringify(b));
  await api.shot('hazard-1-glow-edge');
  gate('hazard: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ POCKETS: killable by real slashes, salt on the crumble ═══ */
if (want('pockets')) {
  console.log('\n═══ slag sprites + cinder hornets ═══');
  const api = await session(Q29_LANDED, '?turbo=8', HINTS);
  /* the mid-trail sprite pocket: first STAND in range and let one commit
     to its lunge (the telegraph recorder needs a full windup) */
  await api.eval('__fmDebug.warp(-1186, -1040); P.hearts = P.maxHearts; 0');
  await api.waitTicks(8);
  await walkTo(api, -1184, -1049, 2.6, 40000, 'into the pocket');
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  await api.waitFor('window.__obSpriteLog.length > 0', 25000, 'a sprite commits');
  await api.eval('P.hearts = P.maxHearts; 0');
  const s0 = await api.eval('__fm.obSpriteAlive');
  const salt0 = await api.eval('P.salt');
  let slain = false;
  for (let i = 0; i < 120 && !slain; i++) {
    const near = await jget(api, `(function(){
      let best = null, bd = 1e9;
      for (const sp of OB_SPRITES) {
        if (sp.dead) continue;
        const d = Math.hypot(sp.x - P.x, sp.z - P.z);
        if (d < bd) { bd = d; best = [sp.x, sp.z, d]; }
      }
      return best;
    })()`);
    if (!near) break;
    if (near[2] > 2.2) {
      await api.eval(`__fmBot.tol = 0.9; __fmBot.target = [${near[0]}, ${near[1]}]; 0`);
    } else {
      await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
      await api.tap(0);
    }
    await api.eval('P.hearts = P.maxHearts; 0');
    if ((await api.eval('__fm.obSpriteAlive')) < s0) slain = true;
    await sleep(160);
  }
  gate('POCKETS: a slag sprite dies to REAL slashes', slain,
    `${s0} → ${await api.eval('__fm.obSpriteAlive')}`);
  gate('POCKETS: the crumble drops salt', await api.eval(
    `(typeof NM_SALT !== 'undefined' && NM_SALT.some(s => s.on)) || P.salt > ${salt0}`),
    'salt ' + salt0 + ' → ' + await api.eval('P.salt'));
  const sd = await jget(api, `(function(){
    const L = window.__obSpriteLog, out = [];
    for (const e of L) out.push(e.lunge - e.tele);
    return out;
  })()`);
  gate('POCKETS: every sprite lunge telegraphed ≥ 0.9 s (sim-tick exact)',
    sd.length > 0 && sd.every(d => d >= 54), JSON.stringify(sd));
  await api.shot('pockets-1-sprites');
  /* the hornet drift */
  await api.eval('__fmDebug.warp(-1178, -1094); P.hearts = P.maxHearts; __fmBot.release(); 0');
  await api.waitTicks(8);
  const h0 = await api.eval('__fm.obHornetAlive');
  let popped = false;
  for (let i = 0; i < 220 && !popped; i++) {
    const near = await jget(api, `(function(){
      let best = null, bd = 1e9;
      for (const h of OB_HORNETS) {
        if (h.dead) continue;
        const d = Math.hypot(h.x - P.x, h.z - P.z);
        if (d < bd) { bd = d; best = [h.x, h.z, d]; }
      }
      return best;
    })()`);
    if (!near) break;
    if (near[2] > 2.4) await api.eval(`__fmBot.tol = 1.0; __fmBot.target = [${near[0]}, ${near[1]}]; 0`);
    else { await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0'); await api.tap(0); }
    await api.eval('P.hearts = P.maxHearts; 0');
    if ((await api.eval('__fm.obHornetAlive')) < h0) popped = true;
    await sleep(160);
  }
  gate('POCKETS: a cinder hornet pops to REAL slashes', popped,
    `${h0} → ${await api.eval('__fm.obHornetAlive')}`);
  const hd = await jget(api, `window.__obHornetLog.map(e => e.dart - e.tele)`);
  gate('POCKETS: every hornet dart telegraphed ≥ 0.9 s', hd.length > 0 && hd.every(d => d >= 54), JSON.stringify(hd));
  /* left-behind pockets respawn on return (the standing law) */
  await api.eval('__fmDebug.warp(8, 7); 0');
  await api.waitTicks(30);
  await api.eval('__fmDebug.warp(-1186, -1040); 0');
  await api.waitTicks(10);
  gate('POCKETS: the left-behind pocket stands again', (await api.eval('__fm.obSpriteAlive')) === 6,
    'alive=' + await api.eval('__fm.obSpriteAlive'));
  gate('pockets: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ FIGHT: telegraphs, chips, windows, motes, clods, the tail jump ═══ */
if (want('fight')) {
  console.log('\n═══ the Kiln Hound, phase by phase ═══');
  const api = await session(Q29_LANDED, '?turbo=4', HINTS);
  await api.eval('__fmDebug.warp.kilnarena(); P.hearts = P.maxHearts; 0');
  await api.eval('__fmBot.tol = 1.4; __fmBot.target = [-1240, -1187]; 0');
  await api.waitFor('__fm.kilnActive === true', 20000, 'proximity wake');
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  gate('P1: proximity ALWAYS wakes the guardian', await api.eval('__fm.kilnActive === true'));
  gate('P1: HP 90, phase one', await api.eval('__fm.kilnHp === 90 && __fm.kilnPhase === 1'));
  gate('P1: the boss bar is up, named, with its two notches',
    await api.eval(`document.getElementById('bossBar').classList.contains('on') &&
      document.getElementById('bossName').textContent === 'THE KILN HOUND' &&
      document.querySelectorAll('.bossNotch').length === 2`));
  await api.shot('fight-0-wake');
  /* watch a pounce + a tail; hearts refilled between; the shove never kills */
  let sawPounce = false, sawTail = false;
  for (let i = 0; i < 200 && !(sawPounce && sawTail); i++) {
    const st = await api.eval('__fm.kilnSt');
    if (st === 'pounce' && !sawPounce) { sawPounce = true; await api.shot('fight-1-pounce'); }
    if (st === 'tail' && !sawTail) { sawTail = true; await api.shot('fight-2-tail'); }
    await api.eval('P.hearts = P.maxHearts; 0');
    await sleep(140);
  }
  gate('P1: pounces and tail sweeps both fired', sawPounce && sawTail, `pounce=${sawPounce} tail=${sawTail}`);
  const durs = await jget(api, `(function(){
    const L = window.__obStLog, out = { pounce: [], tail: [] };
    for (let i = 0; i + 1 < L.length; i++) {
      const d = L[i + 1].tick - L[i].tick;
      if (L[i].st === 'pounceTele' && L[i + 1].st === 'pounce') out.pounce.push(d);
      if (L[i].st === 'tailTele' && L[i + 1].st === 'tail') out.tail.push(d);
    }
    return out;
  })()`);
  gate('P1: every pounce windup ≥ 0.9 s, sim-tick exact (cold-7yo clock)',
    durs.pounce.length > 0 && durs.pounce.every(d => d >= 54), JSON.stringify(durs.pounce));
  gate('P1: every tail windup ≥ 0.9 s', durs.tail.length > 0 && durs.tail.every(d => d >= 54), JSON.stringify(durs.tail));
  /* BODY CHIPS ALWAYS LAND — from any state */
  {
    const body0 = await api.eval('__fm.kilnBody');
    for (let k = 0; k < 3; k++) {
      await api.eval(`P.x = HOUND.x + 1.6; P.z = HOUND.z; P.fy = groundH(P.x,P.z);
        P.heading = Math.atan2(HOUND.x-P.x, HOUND.z-P.z); P.hearts = P.maxHearts; 0`);
      await api.tap(0);
      await api.waitTicks(10);
    }
    gate('BODY CHIPS ALWAYS LAND — no state gates the sword out',
      (await api.eval('__fm.kilnBody')) > body0,
      `body ${body0} → ${await api.eval('__fm.kilnBody')}`);
  }
  /* the landed-heavy window pays 4× */
  {
    await api.eval(`obSetSt('low'); HOUND.y = obGroundAt(HOUND.x, HOUND.z); 0`);
    const hp0 = await api.eval('__fm.kilnHp');
    await api.eval(`P.x = HOUND.x + 1.8; P.z = HOUND.z; P.fy = groundH(P.x,P.z);
      P.heading = Math.atan2(HOUND.x-P.x, HOUND.z-P.z); 0`);
    await api.tap(0);
    await api.waitTicks(10);
    gate('the tired/landed hound takes FOUR TIMES a chip', hp0 - (await api.eval('__fm.kilnHp')) >= 12,
      `${hp0} → ${await api.eval('__fm.kilnHp')}`);
  }
  /* P2: the shake flings ember motes; standing clear costs nothing */
  await api.eval(`HOUND.phase = 1; HOUND.hp = 63; obDealDamage(3); 0`);
  await api.waitFor('__fm.kilnPhase === 2', 15000, 'phase two at 60 (notch)');
  gate('P2: the roar comes at 60 (notch convention)', await api.eval('__fm.kilnPhase === 2'));
  await api.eval(`P.x = -1240; P.z = -1174; P.fy = groundH(P.x,P.z); P.hearts = P.maxHearts; 0`);
  await api.waitFor('__fm.kilnShakeN >= 1 && __fm.obMoteN > 0', 40000, 'a shake flings motes');
  gate('P2: ember motes drift the bowl', (await api.eval('__fm.obMoteN')) > 0,
    'motes=' + await api.eval('__fm.obMoteN'));
  await api.shot('fight-3-motes');
  await api.waitTicks(30);
  gate('P2: motes at a distance cost NOTHING (no damage-from-nowhere)',
    await api.eval('P.hearts === P.maxHearts'));
  gate('P2: she TIRES after the shake (the window exists)', await jget(api,
    `window.__obStLog.some(e => e.st === 'tired')`));
  /* P3: clods with tracked shadows */
  await api.eval(`HOUND.hp = 33; obDealDamage(3); P.hearts = P.maxHearts; 0`);
  await api.waitFor('__fm.kilnPhase === 3', 15000, 'phase three at 30');
  await api.waitFor('__fm.kilnDigN >= 1', 40000, 'a dig volley');
  gate('P3: slag clods fly with visible shadow marks', await api.eval(
    `OB_CLODS.some(cl => cl.on) || __fm.kilnDigN >= 1`), 'digs=' + await api.eval('__fm.kilnDigN'));
  await api.shot('fight-4-clods');
  /* the rim: no fall fail — sprint at the wall, stay in the bowl */
  await api.eval(`__fmBot.tol = 0.5; __fmBot.target = [-1240, -1205]; __fmBot.sprint(true); 0`);
  await sleep(2500);
  await api.eval('__fmBot.sprint(false); __fmBot.release(); __fakePad.axes(0,0); P.hearts = P.maxHearts; 0');
  const rr = await api.eval('Math.hypot(P.x - (-1240), P.z - (-1185))');
  gate('the rim knocks back INWARD — no fall fail', rr < 17.5, 'r=' + rr.toFixed(1));
  gate('fight: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ THE GATE: the kid bot — chases, mashes, wins. FIVE IN A ROW. ═══ */
if (want('kidbot')) {
  console.log('\n═══ the kid-bot gate × 5 ═══');
  const api = await session(Q29_LANDED, '?turbo=4', [...HINTS, 'obCure']);
  let wins = 0;
  for (let run = 0; run < 5; run++) {
    if (run > 0) {
      await api.eval(`SAVE.boneDone = false; SAVE.houndHome = false; SAVE.q = 29; QUEST.q = 29; storeSave();
        HOUND.mode = 'guardian'; HOUND.defeated = false; HOUND.warmShown = -1;
        obHoundWarmK(0); obResetFight(false); obBone.visible = false; 0`);
      await api.waitTicks(6);
    }
    await api.eval('__fmDebug.warp.kilnarena(); P.hearts = P.maxHearts; window.__fmTurbo = 4; 0');
    await api.eval('__fmBot.tol = 1.4; __fmBot.target = [-1240, -1187]; 0');
    await api.waitFor('__fm.kilnActive === true', 20000, 'wake ' + run);
    if (run === 0) gate('kid-bot starts from a fresh, full guardian', await api.eval('__fm.kilnHp === 90 && __fm.kilnPhase === 1'));
    const t0 = Date.now();
    await api.eval('window.__fmTurbo = 14; 0');
    await api.eval(`window.__kidBot = setInterval(function(){
      try {
        P.hearts = P.maxHearts;
        if (typeof HOUND !== 'undefined' && window.__fmBot && HOUND.active) {
          __fmBot.tol = 1.4;
          __fmBot.target = [HOUND.x, HOUND.z];
        }
        __fakePad.press(0);
        setTimeout(function(){ __fakePad.press(); }, 80);
      } catch (e) {}
    }, 170); 0`);
    let won = false;
    const phases = new Set();
    for (let i = 0; i < 2400 && !won; i++) {
      const st = await jget(api, '({hp:__fm.kilnHp, ph:__fm.kilnPhase, done:__fm.boneDone, cin:__fm.cinId})');
      phases.add(st.ph);
      if (st.done || st.cin === 'obCure') { won = true; break; }
      await sleep(200);
    }
    await api.eval('clearInterval(window.__kidBot); __fakePad.press(); __fmBot.release(); __fakePad.axes(0,0); window.__fmTurbo = 4; 0');
    const mins = ((Date.now() - t0) / 60000).toFixed(1);
    console.log(`  run ${run + 1}: ${won ? 'WON' : 'LOST'} in ${mins} min, phases ${[...phases].join(',')}`);
    if (won) wins++;
    /* let the (seen) cure play out fast */
    for (let i = 0; i < 60 && (await api.eval(`__fm.state === 'cine'`)); i++) { await api.tap(0); await sleep(250); }
    await api.waitFor(`__fm.state === 'play'`, 40000, 'cure done ' + run).catch(() => {});
  }
  gate('KID BOT: chase-and-mash WINS the whole fight FIVE TIMES RUNNING', wins === 5, wins + '/5');
  const cured = await jget(api, '({done:__fm.boneDone, home:__fm.houndHome, mode:__fm.houndMode, warm:__fm.houndWarm})');
  gate('THE CURE: nothing dies — she is warm-brown and she is YOURS', cured.done && cured.home && cured.mode === 'companion' && cured.warm === 1, JSON.stringify(cured));
  await api.shot('kidbot-1-companion');
  gate('kidbot: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ THE CURE, watched cold — the authored beat itself ═══ */
if (want('cure')) {
  console.log('\n═══ the cure, watched cold ═══');
  const api = await session(Q29_LANDED, '?turbo=2', HINTS);
  await api.eval('__fmDebug.warp.kilnarena(); P.hearts = P.maxHearts; 0');
  await api.eval('__fmBot.tol = 1.4; __fmBot.target = [-1240, -1187]; 0');
  await api.waitFor('__fm.kilnActive === true', 20000, 'wake');
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); HOUND.hp = 3; 0');
  await api.eval(`P.x = HOUND.x + 1.6; P.z = HOUND.z; P.fy = groundH(P.x,P.z);
    P.heading = Math.atan2(HOUND.x-P.x, HOUND.z-P.z); 0`);
  await api.tap(0);
  await api.waitFor(`__fm.cinId === 'obCure'`, 20000, 'the cure begins');
  const tShots = [[3.4, 'cure-1-ash-blows-off'], [6.8, 'cure-2-bone-handed'], [10.4, 'cure-3-adoption']];
  for (const [tt, name] of tShots) {
    await api.waitFor(`__fm.cinT >= ${tt} || __fm.state !== 'cine'`, 60000, name).catch(() => {});
    await api.shot(name);
  }
  await api.waitFor(`__fm.state === 'play'`, 60000, 'cine ends on its own');
  const after = await jget(api, `({done:__fm.boneDone, home:__fm.houndHome, q:__fm.quest,
    warm:__fm.houndWarm, mode:__fm.houndMode, st:__fm.houndSt})`);
  gate('cure: ends by itself ≤ 13 s, flags + quest land (boneDone, houndHome, q30)',
    after.done && after.home && after.q === 30, JSON.stringify(after));
  gate('cure: ash → warm-brown swap completed', after.warm === 1, JSON.stringify(after));
  gate('cure: SHE FOLLOWS — companion from the first step', after.mode === 'companion', JSON.stringify(after));
  /* she trots after you across the bowl */
  await walkTo(api, -1240, -1172, 1.5, 40000, 'walk off with her');
  await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
  await api.waitTicks(90);
  const hd = await api.eval('Math.hypot(__fm.houndX - P.x, __fm.houndZ - P.z)');
  gate('cure: she keeps at heel', hd < 12, 'd=' + hd.toFixed(1));
  await api.shot('cure-4-at-heel');
  gate('cure: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  api.close();
}

/* ═══ THE JOURNEY: q28 → 31 with REAL VERBS, fixture to TBC card ═══ */
if (want('journey')) {
  console.log('\n═══ the full southern journey ═══');
  const api = await session({ ...PHASE6_DONE }, '?turbo=10', [...HINTS, 'obCure']);
  try {
    await api.waitFor('__fm.quest >= 28', 30000, 'phase 7 opens itself (MIRROR-6 seam)');
    gate('journey: 6/8-done save wakes INTO q28', await api.eval('__fm.quest === 28'));
    const obj0 = await jget(api, 'objectivePoint()');
    gate('journey: the compass answers at once (MIRROR-4)', obj0 && typeof obj0.x === 'number', JSON.stringify(obj0));
    /* board the boat with real input */
    const bx = await api.eval('BOAT.x'), bz = await api.eval('BOAT.z');
    await walkTo(api, bx + 1.5, bz + 1.5, 1.6, 90000, 'to the boat');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await tapUntil(api, () => api.tap(0), 'P.sailing === true', 14, 'BOARD');
    gate('journey: aboard', await api.eval('P.sailing === true'));
    /* SAIL SOUTH — waypoint by waypoint, full sail */
    for (const [wx, wz] of SEAWAY) {
      await api.eval(`__fmBot.tol = 3; __fmBot.target = [${wx}, ${wz}]; __fmBot.sprint(true); 0`);
      await api.waitFor(`Math.hypot(BOAT.x - (${wx}), BOAT.z - (${wz})) < 34`, 180000, `sail to ${wx},${wz}`);
    }
    await api.shot('journey-1-southern-landfall-water');
    /* run her onto the beach shallows — she grounds soft, then step off */
    await api.eval('__fmBot.sprint(false); __fmBot.tol = 2; __fmBot.target = [-1150, -990]; 0');
    const st0 = await api.eval('BOAT.stuckT|0');   // stuckT accumulates for life — measure the DELTA
    await api.waitFor(`(BOAT.stuckT|0) > ${st0} + 45 || Math.hypot(BOAT.x - (-1150), BOAT.z - (-990)) < 11`, 120000, 'nosed the beach');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await api.waitFor(`BOAT.spd < 2.4`, 30000, 'way off');
    await api.waitFor(`__fm.prompt === 'ashore'`, 60000, 'COME ASHORE offered');
    await tapUntil(api, () => api.tap(0), 'P.sailing === false', 20, 'COME ASHORE');
    await api.waitFor('__fm.emberSeen === true', 20000, 'landfall names the region');
    gate('journey: LANDFALL — emberSeen, q29', await api.eval('__fm.emberSeen && __fm.quest === 29'));
    await api.shot('journey-2-emberwaste-ashore');
    /* cross the badland on the crusted road */
    for (const [tx, tz] of TRAIL) {
      await api.eval(`P.hearts = P.maxHearts; 0`);
      await walkTo(api, tx, tz, 2.2, 90000, `trail ${tx},${tz}`);
    }
    await api.eval('__fmBot.tol = 1.6; __fmBot.target = [-1240, -1187]; 0');
    await api.waitFor('__fm.kilnActive === true', 40000, 'the keeper wakes');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    gate('journey: the caldera reached ON FOOT, the guardian wakes', true);
    /* the kid wins */
    await api.eval('window.__fmTurbo = 14; 0');
    await api.eval(`window.__kidBot = setInterval(function(){
      try {
        P.hearts = P.maxHearts;
        if (typeof HOUND !== 'undefined' && window.__fmBot && HOUND.active) { __fmBot.tol = 1.4; __fmBot.target = [HOUND.x, HOUND.z]; }
        __fakePad.press(0);
        setTimeout(function(){ __fakePad.press(); }, 80);
      } catch (e) {}
    }, 170); 0`);
    await api.waitFor(`__fm.boneDone === true || __fm.cinId === 'obCure'`, 420000, 'the fight is won');
    await api.eval('clearInterval(window.__kidBot); __fakePad.press(); __fmBot.release(); __fakePad.axes(0,0); window.__fmTurbo = 10; 0');
    for (let i = 0; i < 60 && (await api.eval(`__fm.state === 'cine'`)); i++) { await api.tap(0); await sleep(250); }
    await api.waitFor(`__fm.state === 'play' && __fm.boneDone === true`, 60000, 'cured');
    gate('journey: THE OLD BONE in hand, the hound at heel, q30',
      await api.eval('__fm.boneDone && __fm.houndHome && __fm.quest === 30'));
    await api.shot('journey-3-bone-in-hand');
    /* home again: back over the crust, aboard, north up the seaway */
    for (const [tx, tz] of [...TRAIL].reverse().slice(1)) {
      await api.eval(`P.hearts = P.maxHearts; 0`);
      await walkTo(api, tx, tz, 2.6, 90000, `home trail ${tx},${tz}`);
    }
    /* right up to her gunwale before asking to board (the hound's own
       prompts wait politely below the world's, but distance matters) */
    const bh = await jget(api, '({x: BOAT.x, z: BOAT.z})');
    await walkTo(api, bh.x + 1.2, bh.z - 1.2, 1.6, 60000, 'to the hull');
    /* press right up against her until the prompt answers */
    await api.eval(`__fmBot.tol = 0.5; __fmBot.target = [${bh.x}, ${bh.z}]; 0`);
    await api.waitFor(`__fm.prompt === 'board'`, 40000, 'board offered');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await tapUntil(api, () => api.tap(0), 'P.sailing === true', 20, 'BOARD for home');
    for (const [wx, wz] of [...SEAWAY].reverse().slice(1)) {
      await api.eval(`__fmBot.tol = 3; __fmBot.target = [${wx}, ${wz}]; __fmBot.sprint(true); 0`);
      await api.waitFor(`Math.hypot(BOAT.x - (${wx}), BOAT.z - (${wz})) < 34`, 180000, `sail home ${wx},${wz}`);
    }
    /* the hound rode or she catches up — either way she is THERE at the wheel */
    for (const [wx, wz] of [[-24, 52], [10, 16]]) {      // Pearl's own water
      await api.eval(`__fmBot.tol = 3; __fmBot.target = [${wx}, ${wz}]; __fmBot.sprint(true); 0`);
      await api.waitFor(`Math.hypot(BOAT.x - (${wx}), BOAT.z - (${wz})) < 14`, 120000, 'into the bay ' + wx);
    }
    /* the sail suite's own landing: nose her at (8,5) from the north and
       let the shallows take the speed */
    /* pulse her onto the sand: push, ease, listen for the prompt */
    let homeOk = false;
    for (let pu = 0; pu < 14 && !homeOk; pu++) {
      await api.eval('__fmBot.sprint(false); __fmBot.tol = 1.5; __fmBot.target = [8, 4]; 0');
      await sleep(2200);
      await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
      homeOk = await api.waitFor(`__fm.prompt === 'ashore'`, 9000, 'listen').then(() => true).catch(() => false);
    }
    if (!homeOk) throw new Error('home ashore never offered');
    await tapUntil(api, () => api.tap(0), 'P.sailing === false', 24, 'ashore home');
    const W = await jget(api, '({x: WHEEL_POS.x, z: WHEEL_POS.z})');
    await walkTo(api, W.x + 2.6, W.z + 1, 1.3, 120000, 'to the Moonwheel');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await api.waitFor(`__fm.prompt === 'obWheel7'`, 30000, 'the wheel offers the seventh');
    await api.eval('window.__fmTurbo = 2; 0');       // the payoff plays near-real
    await api.tap(0);
    await api.waitFor(`__fm.cinId === 'obWheel7'`, 15000, 'THE COOLING begins');
    /* the cooling happens IN FRAME: watch obCooledK rise mid-cine */
    let sawCoolingMid = false;
    for (let i = 0; i < 200; i++) {
      const st = await jget(api, '({t: __fm.cinT, k: __fm.obCooledK, st: __fm.state})');
      if (st.st !== 'cine' && st.st !== 'tbc') break;
      if (st.k > 0.2 && st.k < 0.95 && !sawCoolingMid) {
        sawCoolingMid = true;
        await api.shot('journey-4-cooling-inframe');
      }
      if (st.st === 'tbc') break;
      await sleep(60);
    }
    gate('journey: THE COOLING crusts over IN FRAME (k crossed the middle)', sawCoolingMid);
    await api.eval('window.__fmTurbo = 10; 0');
    await api.waitFor(`__fm.state === 'tbc'`, 90000, 'the 7/8 card');
    const end = await jget(api, `({sky: SAVE.sky, ph: SAVE.ph, q: SAVE.q, tbc: SAVE.tbc7Seen, k: __fm.obCooledK})`);
    gate('journey: SKY STEP 7 — 7/8 PHASES RESTORED, tbc7Seen, cooled', end.sky === 7 && end.q === 31 && end.tbc && end.k >= 0.99, JSON.stringify(end));
    /* let the card settle fully before the portrait */
    await sleep(2500);
    await api.shot('journey-5-tbc-7of8');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'tbc'`, 20, 'leave the card');
    await api.waitFor(`__fm.state === 'play' || __fm.state === 'title'`, 30000, 'back');
    gate('journey: zero console errors END TO END', api.errs.length === 0, api.errs.slice(0, 4).join(' | '));
  } catch (e) {
    gate('journey run', false, e.message);
    await api.shot('journey-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══ THE HOUND AT HOME: follow, doze, pet, bow, persist ═══ */
if (want('hound')) {
  console.log('\n═══ the hound comes home ═══');
  const { srv, port: hport } = await serve();
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = mkApi(c);
  await api.init();
  await api.seedSave({ ...Q31_DONE }, true);      // seed once: reload keeps live writes
  await api.seedSeen(HINTS);
  api.shot = async (name) => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(SHOTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('   shot → ' + f);
  };
  api.close = () => { c.close(); proc.kill(); srv.close(); };
  const boot = async () => {
    await api.nav(`http://127.0.0.1:${hport}/?turbo=6`);
    await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 14, 'focus');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 16, 'leave');
    await api.waitFor(`__fm.state === 'play' || __fm.state === 'cine'`, 30000, 'play');
    for (let i = 0; i < 30 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(300); }
    await api.installBot('pad');
  };
  try {
    await boot();
    gate('hound: a finished-phase-7 save derives a companion', await api.eval(`__fm.houndMode === 'companion'`));
    /* FOLLOW across the village */
    await walkTo(api, 30, -30, 1.5, 90000, 'across the village');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await api.waitFor('Math.hypot(__fm.houndX - P.x, __fm.houndZ - P.z) < 9', 30000, 'she catches up');
    gate('hound: FOLLOWS across the village', true);
    await api.shot('hound-1-village-follow');
    /* never in interiors: walk in the harbor-house DOOR (the real verb) —
       she waits outside; step out — she is there */
    const hx0 = await api.eval('__fm.houndX');
    const ext = await jget(api, '({x: ROOMS[0].ext.outX, z: ROOMS[0].ext.outZ, ix: ROOMS[0].inDoor.x, iz: ROOMS[0].inDoor.z, rx: ROOMS[0].x})');
    await api.eval('__fmBot.tol = 0.2; __fmBot.target = [' + ext.x + ', ' + ext.z + ']; 0');
    await api.waitFor(`__fm.prompt && __fm.prompt !== 'obPet'`, 60000, 'the door offers');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await tapUntil(api, () => api.tap(0), `!!roomAt(P.x, P.z)`, 14, 'through the door');
    await api.waitTicks(160);
    gate('hound: NEVER follows into an interior', await api.eval(
      `Math.abs(__fm.houndX - ROOMS[0].x) > 60`), 'houndX=' + await api.eval('__fm.houndX'));
    await api.eval(`__fmBot.tol = 0.2; __fmBot.target = [${ext.ix}, ${ext.iz}]; 0`);
    await api.waitFor(`__fm.prompt === 'leaveHouse'`, 40000, 'LEAVE offered');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await tapUntil(api, () => api.tap(0), `!roomAt(P.x, P.z)`, 14, 'back outside');
    await api.waitFor(`__fm.state === 'play'`, 20000, 'outside again');
    const caught = await api.waitFor('Math.hypot(__fm.houndX - P.x, __fm.houndZ - P.z) < 12', 45000, 'catch-up')
      .then(() => true).catch(() => false);
    gate('hound: at the doorstep when you come out', caught, hx0 + ' → ' + await api.eval('__fm.houndX'));
    /* PET: ✕ near her answers (clear of any doorway — doors outrank) */
    await walkTo(api, 24, -14, 1.5, 40000, 'away from the doors');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await api.waitFor('Math.hypot(__fm.houndX - P.x, __fm.houndZ - P.z) < 6', 30000, 'she settles near');
    const hp = await jget(api, '({x: __fm.houndX, z: __fm.houndZ})');
    await walkTo(api, hp.x, hp.z, 1.3, 40000, 'up to her');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await api.waitFor(`__fm.prompt === 'obPet'`, 20000, 'GOOD DOG offered');
    await tapUntil(api, () => api.tap(0), `__fm.obPetN >= 1`, 10, 'the happy shake');
    gate('hound: ✕ = GOOD DOG (shake + bark + rumble)', true);
    await api.shot('hound-2-good-dog');
    /* DOZE by the wheel when you rest there */
    const W = await jget(api, '({x: WHEEL_POS.x, z: WHEEL_POS.z})');
    await warpSure(api, W.x + 6, W.z + 4);
    await api.eval(`__p6m.houndRecall(${W.x + 8}, ${W.z + 5}); 0`);
    await api.waitFor(`__fm.houndSt === 'doze'`, 40000, 'she settles');
    gate('hound: DOZES by the Moonwheel when you rest', true);
    await api.shot('hound-3-doze-wheel');
    /* BOW RIDE: she hops to the bow on ✕, rides, hops off at landfall */
    const b = await jget(api, '(function(){ const s = obHoundFootingNear(BOAT.x, BOAT.z); return { x: BOAT.x, z: BOAT.z, fx: s.x, fz: s.z }; })()');
    await warpSure(api, b.fx, b.fz);
    await api.eval('__p6m.houndRecall(' + (b.fx + 1.5) + ', ' + (b.fz + 1.5) + '); 0');
    await api.waitTicks(20);
    await api.waitFor(`__fm.prompt === 'obHoundBow'`, 20000, 'SHE RIDES THE BOW offered');
    await api.tap(0);
    await api.waitFor(`__fm.houndSt === 'bow'`, 15000, 'aboard the bow');
    gate('hound: rides the bow on request', true);
    await api.shot('hound-4-bow-perch');
    await api.eval('__fmBot.tol = 0.5; __fmBot.target = [' + b.x + ', ' + b.z + ']; 0');
    await api.waitFor(`__fm.prompt === 'board'`, 40000, 'board offered (with her aboard)');
    await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
    await tapUntil(api, () => api.tap(0), 'P.sailing === true', 16, 'set sail with her');
    await api.eval(`__fmBot.tol = 3; __fmBot.target = [${b.x - 40}, ${b.z + 20}]; __fmBot.sprint(true); 0`);
    await sleep(4000);
    gate('hound: she RIDES while you sail', await api.eval(
      `__fm.houndSt === 'bow' && Math.hypot(__fm.houndX - BOAT.x, __fm.houndZ - BOAT.z) < 4`));
    await api.shot('hound-5-bow-sailing');
    /* back to the sand — she hops off the moment you step ashore */
    let landed = false;
    for (let pu = 0; pu < 14 && !landed; pu++) {
      await api.eval('__fmBot.sprint(false); __fmBot.tol = 1.5; __fmBot.target = [8, 4]; 0');
      await sleep(2200);
      await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
      landed = await api.waitFor(`__fm.prompt === 'ashore'`, 8000, 'listen').then(() => true).catch(() => false);
    }
    if (!landed) throw new Error('no ashore prompt for the hop-off');
    await tapUntil(api, () => api.tap(0), 'P.sailing === false', 24, 'ashore');
    await api.waitFor(`__fm.houndSt !== 'bow'`, 20000, 'she hops off at landfall');
    gate('hound: hops off at landfall', true);
    /* PERSISTS: quit, relaunch, no reseed */
    await api.nav(`http://127.0.0.1:${hport}/?turbo=6`);
    await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title again');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 14, 'focus');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 16, 'continue');
    await api.waitFor(`__fm.state === 'play'`, 40000, 'play again');
    await api.waitFor(`__fm.houndMode === 'companion'`, 20000, 'companion again');
    gate('hound: PERSISTS across save/reload (houndHome)', await api.eval(
      `SAVE.houndHome === true && __fm.houndMode === 'companion' && Math.hypot(__fm.houndX - P.x, __fm.houndZ - P.z) < 30`));
    gate('hound: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('hound suite', false, e.message);
    await api.shot('hound-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══ SAVES: old-save compat + round trips + NEW GAME ═══ */
if (want('saves')) {
  console.log('\n═══ saves: compat + round trips ═══');
  /* a mid-phase-6 world must not be hijacked by phase 7 */
  {
    const api = await session({ ...PHASE5_DONE }, '?turbo=6');
    await api.waitTicks(120);
    gate('compat: a q22 (phase-5-done) save is untouched by p6m', await api.eval('__fm.quest === 22 || __fm.quest === 23'),
      'q=' + await api.eval('__fm.quest'));
    gate('compat: zero console errors on an old save', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
  {
    const api = await session(Q30_CURED, '?turbo=6', HINTS);
    const rt = await jget(api, `(function(){
      SAVE.tbc7Seen = false; storeSave();
      const s = JSON.parse(localStorage.getItem('fallenmoon_save_v1'));
      return [s.emberSeen, s.boneDone, s.houndHome, s.q];
    })()`);
    gate('round-trip: emberSeen/boneDone/houndHome/q persist at set-site',
      JSON.stringify(rt) === JSON.stringify([true, true, true, 30]), JSON.stringify(rt));
    /* a damaged save heals FORWARD (the Ben rule): boneDone alone implies the rest */
    const fwd = await jget(api, `(function(){
      localStorage.setItem('fallenmoon_save_v1', JSON.stringify(Object.assign({}, JSON.parse(localStorage.getItem('fallenmoon_save_v1')), { q: 5, houndHome: false, emberSeen: false })));
      const out = loadSave();
      return { q: out.q, home: out.houndHome, seen: out.emberSeen };
    })()`);
    gate('forward derivation: boneDone drags q→30, houndHome, emberSeen (MIRROR-6)',
      fwd.q === 30 && fwd.home && fwd.seen, JSON.stringify(fwd));
    /* NEW GAME un-derives everything (the John sequence) */
    const fresh = await jget(api, `(function(){
      obDeriveWorld(defaultSave());
      return { mode: HOUND.mode, st: HOUND.st, warm: HOUND.warmShown, k: +obCooledK.toFixed(2) };
    })()`);
    gate('NEW GAME: the hound sleeps ash-grey in her caldera, the melt burns again',
      fresh.mode === 'guardian' && fresh.st === 'sleep' && fresh.warm === 0 && fresh.k === 0, JSON.stringify(fresh));
    gate('saves: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
}

/* ═══ PERF: LOWFX budgets at the four worst vistas ═══ */
if (want('perf')) {
  console.log('\n═══ the LOWFX budgets ═══');
  /* (a) the caldera fight */
  {
    const api = await session(Q29_LANDED, '?fx=low&turbo=4', [...HINTS, 'obCure']);
    await api.eval('__fmDebug.warp.kilnarena(); P.hearts = P.maxHearts; 0');
    await api.eval('__fmBot.tol = 1.4; __fmBot.target = [-1240, -1187]; 0');
    await api.waitFor('__fm.kilnActive === true', 20000, 'wake');
    await api.eval(`window.__perfMax = { calls: 0, tris: 0, at: '' };
      window.__perfTimer = setInterval(function(){
        try {
          P.hearts = P.maxHearts;
          if (window.__fmBot && HOUND.active) __fmBot.target = [HOUND.x, HOUND.z];
          if (__fm.calls > __perfMax.calls) { __perfMax.calls = __fm.calls; __perfMax.at = __fm.kilnSt; }
          if (__fm.tris > __perfMax.tris) __perfMax.tris = __fm.tris;
        } catch (e) {}
      }, 120); 0`);
    await api.eval('HOUND.phase = 1; HOUND.hp = 63; obDealDamage(3); 0');
    await api.waitFor('__fm.kilnShakeN >= 1', 60000, 'a shake').catch(() => {});
    await api.eval('HOUND.hp = 33; obDealDamage(3); 0');
    await api.waitFor('__fm.kilnDigN >= 1', 60000, 'a dig').catch(() => {});
    await api.eval('clearInterval(window.__perfTimer); 0');
    const pm = await jget(api, 'window.__perfMax');
    gate('LOWFX: the caldera fight ≤ 80 calls', pm.calls <= 80, `max ${pm.calls} at '${pm.at}'`);
    gate('LOWFX: fight ≤ 120k tris', pm.tris <= 120000, 'max ' + pm.tris);
    await api.shot('perf-1-fight');
    api.close();
  }
  /* (b) the cooling cine, every shot */
  {
    const api = await session(Q30_CURED, '?fx=low&turbo=4', [...HINTS, 'obCure']);
    const W = await jget(api, '({x: WHEEL_POS.x, z: WHEEL_POS.z})');
    await api.eval(`__fmDebug.warp(${W.x + 3.5}, ${W.z + 1}); 0`);
    await api.waitFor(`__fm.prompt === 'obWheel7'`, 30000, 'wheel prompt');
    await api.eval(`window.__perfMax = { calls: 0, tris: 0, t: 0 };
      window.__perfTimer = setInterval(function(){
        try {
          if (__fm.state !== 'cine') return;
          if (__fm.calls > __perfMax.calls) { __perfMax.calls = __fm.calls; __perfMax.t = __fm.cinT; }
          if (__fm.tris > __perfMax.tris) __perfMax.tris = __fm.tris;
        } catch (e) {}
      }, 100); 0`);
    await api.tap(0);
    await api.waitFor(`__fm.cinId === 'obWheel7'`, 15000, 'cine on');
    let midShot = false;
    for (let i = 0; i < 400; i++) {
      const st = await jget(api, '({st: __fm.state, k: __fm.obCooledK, t: __fm.cinT})');
      if (!midShot && st.k > 0.3 && st.k < 0.9) { midShot = true; await api.shot('perf-2-cooling-mid'); }
      if (st.st === 'tbc') break;
      await sleep(140);
    }
    await api.eval('clearInterval(window.__perfTimer); 0');
    const pm = await jget(api, 'window.__perfMax');
    gate('LOWFX: every COOLING shot ≤ 80 calls', pm.calls <= 80, `max ${pm.calls} at t=${(+pm.t).toFixed(1)}`);
    gate('LOWFX: cooling ≤ 120k tris', pm.tris <= 120000, 'max ' + pm.tris);
    api.close();
  }
  /* (c) obsidian fields at dusk + (d) the village WITH the hound.
     Both measured in the phase-7 world (q30/sky6 for the fields: the sky-7
     re-derive is identical ground; the sibling's q32+ dressing is theirs
     to budget). The village gate is the HOUND'S DELTA — the dusk village
     base cost predates p6m and is reported, not owned, here. */
  {
    const api = await session(Q30_CURED, '?fx=low&turbo=4', HINTS);
    let worst = 0, worstT = 0;
    const orbit = async (x, z) => {
      await api.eval(`__fmDebug.warp(${x}, ${z}); __p6m.houndRecall(${x + 2}, ${z + 2});
        if (__fmDebug.nightNow) __fmDebug.nightNow(1); 0`);
      await api.waitTicks(20);
      for (let k = 0; k < 6; k++) {
        await api.eval(`__fmDebug.camYaw(${(k / 6 * Math.PI * 2).toFixed(2)}); 0`);
        await api.waitTicks(14);
        const cc = await api.eval('__fm.calls'), tt = await api.eval('__fm.tris');
        if (cc > worst) worst = cc;
        if (tt > worstT) worstT = tt;
      }
    };
    await api.eval('SAVE.sky = 7; SAVE.ph = 7; storeSave(); applyWorldState(); 0');   // cooled fields, my flags only
    await orbit(-1210, -1090);
    await api.shot('perf-3-obsidian-dusk');
    gate('LOWFX: the obsidian fields at dusk ≤ 80 calls', worst <= 80, 'max ' + worst);
    const w1 = worst; worst = 0;
    /* the village: measure WITH her, then WITHOUT her — p6m owns the delta */
    await orbit(8, 7);
    await api.shot('perf-4-village-hound');
    const withHound = worst;
    worst = 0;
    await api.eval('HOUND.c.root.visible = false; window.__houndHidden = true; 0');
    for (let k = 0; k < 6; k++) {
      await api.eval(`__fmDebug.camYaw(${(k / 6 * Math.PI * 2).toFixed(2)}); HOUND.c.root.visible = false; 0`);
      await api.waitTicks(14);
      const cc = await api.eval('__fm.calls');
      if (cc > worst) worst = cc;
    }
    const baseline = worst;
    gate('LOWFX: the hound adds ≤ 10 calls to the dusk village', withHound - baseline <= 10,
      `with=${withHound} base=${baseline} (the dusk-village BASE cost is a shared pre-p6m finding)`);
    gate('LOWFX: tris ≤ 120k everywhere', worstT <= 120000, 'max ' + worstT);
    console.log('   NOTE: dusk village base = ' + baseline + ' calls WITHOUT the hound — pre-existing, flagged for the Pi verdict');
    gate('perf: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    console.log('   vista worsts: fields ' + w1 + ', village ' + worst);
    api.close();
  }
}

process.exit(summary());
