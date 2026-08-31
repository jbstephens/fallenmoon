#!/usr/bin/env node
/* ═══ THE END-STATE PERF CENSUS — a committed probe ═══

   The frame budget the whole game is held to is 80 draw calls / 120k
   triangles, and the `perf` suite proves it for the EARLY save it seeds.
   Nothing proved it for the world at the far end of the arc: sky 8,
   moonHome, the grown village, both boats, the companion hound, the lit
   windows, the full moon and the eight relics on the wheel. This probe
   walks that world and REPORTS the whole table — every vista, every era of
   the day cycle, worst calls and worst triangles.

   IT IS DELIBERATELY A LOOSE GATE. The interim ceiling here is 140 calls
   and 125k triangles — generous enough to document reality without
   blocking a branch on it; anything between 80 and 140 prints as a WARN
   line, so the drift is visible on every run and the number can be walked
   down instead of argued about. The real 80-call work for the end state is
   known and deliberately BACKLOG, not oversight:
     · humanoid LOD (the cast is one draw call per body part at any range),
     · a merged star field (three parts each carry their own),
     · a general far-cull for props the finale cull only hides in cinema.
   When those land, lower CEIL_CALLS here and let the gate bite.

   Run:  node test/probes/postgame-perf.mjs [section...]
   Sections: village cycle world        (default: all)
   Adapted from the OPUS sweep's scratchpad census (report-only); the
   per-object rollup/tagger half of that tool stayed out — it needed a
   generated name list and this is a gate, not a diagnosis.                */

import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, tapUntil, sleep, GAME }
  from './p6g.mjs';
import fs from 'node:fs';
import path from 'node:path';

const gate = (label, ok, extra) => rawGate(ok, label, extra);

/* the interim ceiling this probe actually fails on, and the house budget
   it warns against (see the header) */
const CEIL_CALLS = 140, CEIL_TRIS = 125000;
const HOUSE_CALLS = 80, HOUSE_TRIS = 120000;

const SHOTS = '/tmp/fm_postgame_perf';
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['village', 'cycle', 'world'];
const want = (s) => WANT.includes(s);

const P7_DONE = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'phase7-done-save.json'), 'utf8'));
/* every authored beat marked seen, so nothing hijacks the walk */
const ALLSEEN = ['cnCallsIn', 'cnRising', 'cnCoin', 'cnWheel8', 'cnEnd', 'obCure', 'obHintTail',
  'obHintMote', 'obHintClod', 'obCrustHolds', 'obPetLine', 'mlReveal', 'mlHintGust',
  'mlHintPool', 'mlHintSpiral', 'nmDusk', 'mlCure'];

/* the two extremes of the twelve-hour cycle at every village vantage; the
   `cycle` section below walks the whole loop (dusk and dawn included) at
   the three that matter, which is where an era-by-era sweep would spend
   most of its minutes for the least new information */
const ERAS = { day: 0.05, night: 0.78 };
/* every one of these is DRY LAND in the returned-sea world. The sweep's
   first draft borrowed the early-game station list and three of its
   vantages (the old spawn, the lighthouse flat, the boatyard) are 1.2-2 m
   under water once the tide is home: the warp bounced the player back to
   his last dry footing and three vistas silently reported the previous
   one's numbers. A number about nowhere is not a number, so the warp is
   verified and the vantages are chosen wet-checked. */
const VILLAGE = [
  ['village-station', 0, -24], ['quay', 4, -2], ['wheel', 20, -46],
  ['harborrow', 6, -38], ['finn-row', 39, -14], ['tock-row', -7, -29],
  ['west-shore', -70, -40],
];
/* the rest of the world in the post-game era, at night — the worst light */
const WORLD = [
  ['market gate', `__fmDebug.warpMarket(); 0`, null],
  ['anchorage', `__fmDebug.warpAnchorage(); 0`, null],
  ['beacon harborstar', `__fmDebug.warpBeacon(0); 0`, [-197, 108]],
  ['beacon reefstar', `__fmDebug.warpBeacon(1); 0`, [-902, 318]],
  ['beacon drownedstar', `__fmDebug.warpBeacon(2); 0`, [-1252, 238]],
  ['beacon farstar', `__fmDebug.warpBeacon(3); 0`, [-2298, -1005]],
  ['ember landing', `__fmDebug.warp.ember(); 0`, [-1150, -985]],
  ['ember fields', `__fmDebug.warp(-1210, -1090); 0`, [-1210, -1090]],
  ['kiln arena', `__fmDebug.warp.kilnarena(); 0`, [-1240, -1191]],
  ['crown plinth', `__fmDebug.warpCrown('plinth'); 0`, [2160, 1462]],
  ['falls forecourt', `__fmDebug.warp(1826, 1076); 0`, [1826, 1076]],
  ['mouth pool', `__fmDebug.warpMouth('pool'); 0`, [118, 32]],
  ['forest camp', `__fmDebug.warp(243, 57); 0`, [243, 57]],
  ['isles watchstone', `__fmDebug.warp(-980, -210); 0`, [-980, -210]],
  ['isles long strand', `__fmDebug.warp(-2050, -700); 0`, [-2050, -700]],
  ['moonsite (afloat)', `__fmDebug.warp.moonsite(); 0`, null],
];

const AZ = 12, PITCHES = [-0.05, 0.30];

async function open() {
  const { srv, port: hport } = await serve();
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = mkApi(c);
  await api.init();
  await api.seedSave(P7_DONE);
  await api.seedSeen(ALLSEEN);
  api.close = () => { try { c.close(); } catch (e) {} proc.kill(); srv.close(); };
  api.shot = async (name) => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(SHOTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('   shot → ' + f);
    return f;
  };
  /* LOWFX is the console's world — the only one the budget is about */
  await api.nav(`http://127.0.0.1:${hport}/?fx=low&turbo=2`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title');
  await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 14, 'focus CONTINUE');
  await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 16, 'leave title');
  for (let i = 0; i < 40 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(350); }
  await api.waitFor(`__fm.state === 'play'`, 40000, 'play');
  await api.installBot('pad');
  if (!(await api.eval('LOWFX'))) throw new Error('LOWFX did not take — the budget means nothing at full fx');
  /* the end state itself */
  await api.eval('__fmDebug.postgame(); 0');
  await api.waitTicks(30);
  return api;
}

/* a warp that STICKS: unboard, release the bot, verify, retry. A vista
   measured at the wrong coordinates is a number about nowhere. */
async function warpSure(api, expr, want2) {
  let last = null;
  for (let i = 0; i < 4; i++) {
    await api.eval(`(function () {
      try { if (typeof P !== 'undefined' && P.sailing && typeof disembark === 'function') disembark(); } catch (e) {}
      try { if (typeof P !== 'undefined') { P.sailing = false; P.aboard = false; } } catch (e) {}
      try { if (window.__fmBot && __fmBot.release) __fmBot.release(); } catch (e) {}
      try { __fmBot.target = null; } catch (e) {}
      __fakePad.axes(0, 0); __fakePad.press();
    })(); 0`);
    await api.eval(expr);
    await api.eval(`try { P.vx = 0; P.vz = 0; } catch (e) {} 0`);
    await api.waitTicks(8);
    last = JSON.parse(await api.eval(`JSON.stringify([+__fm.x.toFixed(1), +__fm.z.toFixed(1)])`));
    if (!want2) return { at: last, ok: true };
    if (Math.hypot(last[0] - want2[0], last[1] - want2[1]) < 30) return { at: last, ok: true };
  }
  return { at: last, ok: false };
}

const TABLE = [];
/* sweep one vista: AZ azimuths x two pitches, keep the worst */
async function vista(api, label, setup, opts = {}) {
  const az = opts.az || AZ, pitches = opts.pitches || PITCHES;
  let stuck = true;
  if (opts.warpExpr !== undefined) {
    const r = await warpSure(api, opts.warpExpr, opts.want);
    stuck = r.ok;
    if (setup) await api.eval(setup);
  } else if (setup) await api.eval(setup);
  await api.waitTicks(opts.settle || 24);
  let worst = { calls: 0, tris: 0, yaw: 0, pitch: 0 }, maxTris = 0;
  for (let a = 0; a < az; a++) {
    const yaw = (a / az) * Math.PI * 2 - Math.PI;
    try { await api.eval(`__fmDebug.camYaw(${yaw.toFixed(4)}); __fmDebug.camPitch(${pitches[0]}); 0`); } catch (e) {}
    for (const p of pitches) {
      try { await api.eval(`__fmDebug.camYaw(${yaw.toFixed(4)}); __fmDebug.camPitch(${p}); 0`); } catch (e) {}
      await api.waitTicks(6);
      const { c, t } = JSON.parse(await api.eval(`JSON.stringify({c: __fm.calls, t: __fm.tris})`));
      if (t > maxTris) maxTris = t;
      if (c > worst.calls) worst = { calls: c, tris: t, yaw: +yaw.toFixed(2), pitch: p };
    }
  }
  const at = JSON.parse(await api.eval(`JSON.stringify({x: +__fm.x.toFixed(0), z: +__fm.z.toFixed(0)})`));
  const row = { label, calls: worst.calls, tris: maxTris, at, yaw: worst.yaw, pitch: worst.pitch, stuck };
  TABLE.push(row);
  const flag = row.calls > CEIL_CALLS || row.tris > CEIL_TRIS ? '!!'
    : (row.calls > HOUSE_CALLS || row.tris > HOUSE_TRIS ? 'WARN' : '  ');
  console.log(`${flag.padEnd(5)}${label.padEnd(34)} calls=${String(row.calls).padStart(3)}  tris=${String(row.tris).padStart(6)}` +
    `  @${at.x},${at.z}${stuck ? '' : '   [WARP DID NOT STICK]'}`);
  return row;
}

/* ═══ the run ═══ */
const api = await open();
console.log('\n  coinInfo:', await api.eval('JSON.stringify(__fmDebug.coinInfo())'));

if (want('village')) {
  console.log('\n════ THE POST-GAME VILLAGE, every era of the cycle ════');
  for (const [era, c] of Object.entries(ERAS)) {
    for (const [vn, vx, vz] of VILLAGE) {
      await vista(api, `village ${vn} ${era}`, `__fmDebug.cycleSet(${c}); 0`,
        { warpExpr: `__fmDebug.warp(${vx}, ${vz}); 0`, want: [vx, vz] });
    }
  }
}

if (want('cycle')) {
  console.log('\n════ THE FULL CYCLE at three vantages ════');
  for (const [vn, vx, vz] of [['village-station', 0, -24], ['quay', 4, -2], ['wheel', 20, -46]]) {
    for (let i = 0; i < 8; i++) {
      const c = i / 8 + 0.01;
      await vista(api, `cycle ${vn} c=${c.toFixed(3)}`, `__fmDebug.cycleSet(${c}); 0`,
        { az: 8, pitches: [0.05], settle: 14, warpExpr: `__fmDebug.warp(${vx}, ${vz}); 0`, want: [vx, vz] });
    }
  }
}

if (want('world')) {
  console.log('\n════ THE REST OF THE WORLD, post-game, at night ════');
  const NIGHT = `__fmDebug.cycleSet(0.78); 0`;
  for (const [lbl, warpExpr, want2] of WORLD) {
    await vista(api, lbl, NIGHT, { warpExpr, want: want2 });
  }
}

/* ═══ the report, then the gates ═══ */
TABLE.sort((a, b) => b.calls - a.calls);
console.log('\n════ WORST TEN BY DRAW CALLS ════');
for (const r of TABLE.slice(0, 10)) {
  console.log(`  ${String(r.calls).padStart(3)} calls  ${String(r.tris).padStart(6)} tris   ${r.label}  @${r.at.x},${r.at.z}`);
}
const worstCalls = TABLE[0] || { calls: 0, label: '(none)' };
const worstTris = TABLE.slice().sort((a, b) => b.tris - a.tris)[0] || { tris: 0, label: '(none)' };
const overHouse = TABLE.filter(r => r.calls > HOUSE_CALLS || r.tris > HOUSE_TRIS);
const overCeil = TABLE.filter(r => r.calls > CEIL_CALLS || r.tris > CEIL_TRIS);
const notStuck = TABLE.filter(r => !r.stuck);

console.log(`\n  vistas=${TABLE.length}  over the house budget (${HOUSE_CALLS}/${HOUSE_TRIS})=${overHouse.length}` +
  `  over the interim ceiling (${CEIL_CALLS}/${CEIL_TRIS})=${overCeil.length}`);
if (overHouse.length) {
  console.log('  WARN — known backlog (humanoid LOD, star merge, general far-cull):');
  for (const r of overHouse.slice(0, 12)) console.log(`         ${r.label}  ${r.calls} calls / ${r.tris} tris`);
}

gate('postgame-perf: the sweep actually visited its vistas', TABLE.length >= 10, `vistas=${TABLE.length}`);
gate('postgame-perf: every warp stuck (a number about nowhere is not a number)',
  notStuck.length === 0, notStuck.map(r => r.label).join(' | '));
gate(`postgame-perf: worst draw calls within the interim ceiling (<= ${CEIL_CALLS})`,
  worstCalls.calls <= CEIL_CALLS, `worst=${worstCalls.calls} at ${worstCalls.label}`);
gate(`postgame-perf: worst triangles within the interim ceiling (<= ${CEIL_TRIS})`,
  worstTris.tris <= CEIL_TRIS, `worst=${worstTris.tris} at ${worstTris.label}`);
gate('postgame-perf: zero console errors across the whole sweep',
  api.errs.length === 0, api.errs.slice(0, 3).join(' | '));

api.close();
process.exit(summary() ? 1 : 0);
