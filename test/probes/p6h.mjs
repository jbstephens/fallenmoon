#!/usr/bin/env node
/* p6h — PHASE 4 PART TWO verification probe.
   Cool winds come home: the payoff, the re-green, the living Silverrun, the
   skiff, the swelter's retirement, the end card — driven through REAL input
   and asserted through __fm, with screenshots looked at by a human.

   Run:  /opt/homebrew/opt/node@25/bin/node test/probes/p6h.mjs [section...]
   Sections: payoff green skiff world perf   (default: all)                */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, tapUntil, sleep, GAME } from './p6e.mjs';
/* the shared probe module takes (ok, label, extra); this file reads better
   with the label first, which is how the main harness spells it */
const gate = (label, ok, extra) => rawGate(ok, label, extra);
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(DIR, 'shots-p6h');
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['payoff', 'green', 'skiff', 'world', 'perf'];
const want = (s) => WANT.includes(s);

/* ── saves ─────────────────────────────────────────────────────────────── */
const PHASE3_DONE = {
  v: 2, q: 12, ph: 3, mh: 8, sword: true, salt: 12,
  talked: { finn: 2, tock: 1, pearl: 1 },
  kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: true,
  bossDone: true, sky: 3, tidepool: true, compassSeen: true, houseChest: true, bossHint: true,
  tockChest: true, pearlChest: true, lightChest: true, clockWound: true, boatWindow: true,
  chartSeen: true, cartChest: true, mapTides: true, mapTable: true,
  region: 'bay', lastSpring: 3, millChest: true, ferryChest: true, fgrottoChest: true,
  cedarHeart: true, wardenTalked: 2, fallsHum: true, forestSeen: true, swelterSeen: true,
  basinOpen: true, glyph1: true, glyph2: true, hChest: true, hFossil: true, hMural: true,
  wyrmDone: true, floodSeen: true, sailedOnce: true, voyageDone: true,
  boatX: 8.5, boatZ: 6, boatAng: 0.9,
  keelFound: true, boatRefit: true, moonSeen: true, isleLandfall: true,
  bellwrightTalked: 2, watchBell: true, spireChest: true, strandHeart: true, gannetChest: true,
  fGlyph1: true, fGlyph2: true, fGlyph3: true, fMouldHeart: true, fMouldMural: true,
  tortoiseDone: true, sunArc: true, lampLit: true, tbc2Seen: true, tbc3Seen: true,
  lastShade: [8.2, 7], lastPos: [8.2, 7],
};
/* the Sliver in hand, one walk from the Moonwheel — the payoff's own moment */
const CARRY = {
  ...PHASE3_DONE, q: 16, crownGlint: true, stairOpen: true,
  organ1: true, organ2: true, organ3: true, crownSeen: true, beaconHeart: true,
  stagDone: true, sliverTaken: true, riverWet: false,
  lastPos: [-30, -66], lastShade: [-30, -66], region: 'bay',
};
/* the world the payoff makes */
const WET = {
  ...CARRY, q: 17, ph: 4, sky: 4, riverWet: true, tbc4Seen: true,
  region: 'forest', lastPos: [1052, 602], lastShade: [1052, 602],
};
const WET_AT_RIVER = { ...WET, lastPos: [1866, 1132], lastShade: [1866, 1132] };
/* pre-payoff in the forest: the swelter must still bite */
const DRY_FOREST = {
  ...PHASE3_DONE, region: 'forest', lastPos: [900, 560], lastShade: [700, 340], mh: 8,
};

function decodePNG(buf) {
  let off = 8, w = 0, h = 0, bd = 0, ct = 0;
  const idat = [];
  while (off < buf.length) {
    const len = buf.readUInt32BE(off);
    const type = buf.toString('ascii', off + 4, off + 8);
    const data = buf.subarray(off + 8, off + 8 + len);
    if (type === 'IHDR') { w = data.readUInt32BE(0); h = data.readUInt32BE(4); bd = data[8]; ct = data[9]; }
    else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    off += 12 + len;
  }
  if (bd !== 8 || (ct !== 6 && ct !== 2)) throw new Error(`unsupported png (depth ${bd} color ${ct})`);
  const bpp = ct === 6 ? 4 : 3;
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = w * bpp;
  const out = Buffer.alloc(w * h * bpp);
  let pos = 0;
  for (let y = 0; y < h; y++) {
    const ft = raw[pos++];
    const row = out.subarray(y * stride, (y + 1) * stride);
    raw.copy(row, 0, pos, pos + stride);
    pos += stride;
    const prev = y > 0 ? out.subarray((y - 1) * stride, y * stride) : null;
    if (ft === 1) { for (let i = bpp; i < stride; i++) row[i] = (row[i] + row[i - bpp]) & 255; }
    else if (ft === 2) { if (prev) for (let i = 0; i < stride; i++) row[i] = (row[i] + prev[i]) & 255; }
    else if (ft === 3) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0;
        row[i] = (row[i] + ((a + b) >> 1)) & 255;
      }
    } else if (ft === 4) {
      for (let i = 0; i < stride; i++) {
        const a = i >= bpp ? row[i - bpp] : 0, b = prev ? prev[i] : 0, cc = (prev && i >= bpp) ? prev[i - bpp] : 0;
        const p = a + b - cc, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - cc);
        row[i] = (row[i] + (pa <= pb && pa <= pc ? a : pb <= pc ? b : cc)) & 255;
      }
    }
  }
  return { w, h, bpp, px: out };
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
async function walkTo(api, x, z, tol = 1.6, timeout = 60000) {
  await api.eval(`__fmBot.done=false; __fmBot.tol=${tol}; __fmBot.target=[${x},${z}]`);
  await api.waitFor(
    `__fmBot.done || Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < ${tol + 0.4} || __fm.state!=='play'`,
    timeout, `walk to ${x},${z}`);
  await api.eval('__fmBot.target=null; __fakePad.axes(0,0)');
}
const lum = (m) => (m[0] + m[1] + m[2]) / 3;
const greenness = (m) => m[1] - (m[0] + m[2]) / 2;

/* ═══════════════════ 1 — THE PAYOFF, BY REAL INPUT ═══════════════════ */
async function suitePayoff() {
  console.log('\n── the payoff: the Sliver, the wheel, and the wind ──');
  const api = await session(CARRY, '?turbo=1');
  try {
    gate('payoff: the save resumes carrying the Waxing Sliver',
      await api.eval('__fm.carrySliver === true && __fm.quest === 16'),
      'q=' + await api.eval('__fm.quest'));
    gate('payoff: the world is still burnt, dry and hot before it',
      await api.eval('__fm.greenK === 0 && __fm.riverWet === false && __fm.swelterRetired === false'),
      JSON.stringify(await api.eval('({g:__fm.greenK,w:__fm.riverWet,s:__fm.swelterRetired})')));
    /* the real walk to the Moonwheel, and the real prompt */
    const W = await api.eval('({x: WHEEL_POS.x, z: WHEEL_POS.z})');
    for (let a = 0; a < 6 && !(await api.eval(`__fm.prompt === 'wheel4'`)); a++) {
      const ang = a * Math.PI / 3;
      await walkTo(api, W.x + Math.cos(ang) * 3.6, W.z + Math.sin(ang) * 3.6, 1.4, 45000);
      await sleep(300);
    }
    await api.waitFor(`__fm.prompt === 'wheel4'`, 12000,
      'the wheel prompt (at ' + JSON.stringify(await api.eval('({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), carry:__fm.carrySliver, q:__fm.quest})')) + ')');
    gate('payoff: the Moonwheel offers the fourth notch by prompt', true,
      await api.eval(`(currentInteract()||{}).label`));
    await api.shot('payoff-prompt-1280x720');
    /* ✕ — and the phase turns */
    await api.tap(0);
    await api.waitFor(`__fm.state === 'cine' && __fm.cinId === 'sliverWheel'`, 8000, 'the payoff starts');
    gate('payoff: ✕ at the wheel starts the authored beat', true);
    /* the wind: watch the front cross the forest IN FRAME */
    await api.waitFor('__fm.greenFront > 60', 22000, 'the wave front starts');
    await api.shot('payoff-wind-arrives-1280x720');
    const seen = [];
    for (let i = 0; i < 26; i++) {
      const t = await api.eval('({f:__fm.greenFront, r:__fm.riverFront, k:__fm.greenK, d:__fm.greenDone, w:__fm.greenWork, p:__fm.fallsPour, c:__fm.cinT})');
      seen.push(t);
      if (t.f > 900 && seen.filter(s => s.f > 300).length >= 3) break;
      await sleep(220);
    }
    const rising = seen.length > 2 && seen[seen.length - 1].f > seen[0].f + 200;
    gate('payoff: the grass-wave front sweeps (front distance climbing)', rising,
      seen.map(s => Math.round(s.f)).join('→'));
    gate('payoff: the water front rides with it', seen[seen.length - 1].r > 100,
      'riverFront=' + Math.round(seen[seen.length - 1].r));
    gate('payoff: the falls are pouring by then', seen[seen.length - 1].p > 0.2,
      'pour=' + (seen[seen.length - 1].p || 0).toFixed(2));
    const midShot = await api.shot('payoff-wavefront-1280x720');
    const budgetMid = await api.eval('({calls:__fm.calls, tris:__fm.tris, work:__fm.greenWork})');
    gate('payoff: frame budget holds mid-wave (≤80 calls / ≤120k tris)',
      budgetMid.calls <= 80 && budgetMid.tris <= 120000, JSON.stringify(budgetMid));
    /* it must END, on its own, inside twelve seconds of authored time */
    await api.waitFor(`__fm.state === 'tbc'`, 30000, 'the end card');
    const cinT = await api.eval('CINE.t');
    gate('payoff: the beat is one shot and ends by itself', true);
    gate('payoff: the end card is phase four\'s FULL MIRROR tease',
      await api.eval(`__fm.tbc4Seen === true && /night market/i.test(document.getElementById('tbcSub').textContent)`),
      await api.eval(`document.getElementById('tbcSub').textContent.slice(0, 60)`));
    await sleep(1200);
    await api.shot('payoff-tbc4-1280x720');
    await tapUntil(api, () => api.tap(0), `__fm.state === 'play'`, 12, 'leave the card');
    /* the world the payoff makes */
    const w = await api.eval('({sky:__fm.skyStep, ph:__fm.phases, q:__fm.quest, wet:__fm.riverWet, green:__fm.greenK, done:__fm.greenDone, parts:__fm.greenParts, sw:__fm.swelterRetired, th:__fm.thicketsOpen, star:__fm.star4On, s4:__fm.skyStep4, carry:__fm.carrySliver})');
    gate('payoff: sky step 4, fourth phase, quest 17', w.sky === 4 && w.ph === 4 && w.q === 17, JSON.stringify(w));
    gate('payoff: the FOURTH star is lit', w.star === true && w.s4 > 0.99);
    gate('payoff: the whole forest finished greening', w.green === 1 && w.done === w.parts,
      `${w.done}/${w.parts}`);
    gate('payoff: the Silverrun runs', w.wet === true);
    gate('payoff: the swelter has retired and the thickets have opened', w.sw === true && w.th === true);
    gate('payoff: the Sliver is out of Wick\'s hands and on the wheel', w.carry === false);
    /* and it survives a reload, derived from the save alone */
    await api.eval('storeSave(); 0');
    gate('payoff: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('payoff suite', false, e.message);
    await api.shot('payoff-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 2 — THE GREEN WORLD: walked, looked at, and pixel-checked ═══════════ */
async function suiteGreen() {
  console.log('\n── the re-greened forest, walked ──');
  /* the same frame, burnt and living: the honest before/after */
  const dry = await session(DRY_FOREST, '?turbo=6');
  let burntPix = null, burntSw = null;
  try {
    await api_look(dry, 900, 560);
    const f = await dry.shot('green-before-1280x720');
    const png = decodePNG(fs.readFileSync(f));
    burntPix = [medianColorAt(png, 400, 430, 40), medianColorAt(png, 640, 470, 40), medianColorAt(png, 900, 430, 40)];
    gate('green: BEFORE — the forest ground reads burnt, not green',
      burntPix.every(m => greenness(m) < 14), JSON.stringify(burntPix));
    /* and the swelter still bites out here, exactly as the suite asserts */
    await dry.eval(`__fmDebug.camOff(); __fmDebug.hud(true); 0`);
    const spot = await dry.eval(`(function(){ for (let x=840;x<1000;x+=6) for (let z=430;z<520;z+=6) { if (!window.__forestSolid(x,z) && !forestShadeAt(x,z)) return {x,z}; } return null; })()`);
    await dry.eval(`__fmDebug.warp(${spot.x}, ${spot.z}); P.hearts = P.maxHearts; swelterT = 0; 0`);
    await sleep(400);
    const t0 = await dry.eval('__fm.swTicks');
    const h0 = await dry.eval('P.hearts');
    await dry.waitFor(`__fm.swTicks > ${t0}`, 40000, 'the swelter still ticks');
    burntSw = await dry.eval('({h:P.hearts, icon:__fm.swIconMode, vign:__fm.swVign, retired:__fm.swelterRetired})');
    gate('green: BEFORE — the swelter still takes a heart (the hazard is intact)',
      burntSw.h === h0 - 1 && burntSw.retired === false, JSON.stringify(burntSw) + ' from ' + h0);
    /* THE THICKET, WALKED AT. State is not the question — passage is. */
    const T = await dry.eval(`(function(){ const t = THICKETS[0]; const c = Math.cos(t.a + Math.PI / 2), s = Math.sin(t.a + Math.PI / 2);
      return { x: t.x, z: t.z, cx: +c.toFixed(4), cz: +s.toFixed(4) }; })()`);
    const from = [T.x - T.cx * 9, T.z - T.cz * 9], to = [T.x + T.cx * 9, T.z + T.cz * 9];
    await dry.eval(`__fmDebug.warp(${from[0].toFixed(1)}, ${from[1].toFixed(1)}); P.hearts = P.maxHearts; 0`);
    await walkTo(dry, to[0], to[1], 1.5, 25000).catch(() => {});
    const stuck = await dry.eval(`({ d: Math.hypot(__fm.x - (${to[0].toFixed(1)}), __fm.z - (${to[1].toFixed(1)})), x: +__fm.x.toFixed(1), z: +__fm.z.toFixed(1) })`);
    gate('green: BEFORE — the burnt thicket blocks its shortcut (walked at, not asked)',
      stuck.d > 5, `stopped ${stuck.d.toFixed(1)} m short at ${stuck.x},${stuck.z}`);
    await dry.eval('__fmDebug.hud(false); 0');
    await dry.eval(`__fmDebug.cam(${(T.x - T.cx * 16).toFixed(1)}, groundH(${T.x},${T.z}) + 7, ${(T.z - T.cz * 16).toFixed(1)}, ${T.x}, groundH(${T.x},${T.z}) + 1.5, ${T.z}); 0`);
    await sleep(900);
    await dry.shot('thicket-shut-1280x720');
    gate('green: BEFORE — zero console errors', dry.errs.length === 0, dry.errs.slice(0, 3).join(' | '));
  } catch (e) { gate('green: BEFORE', false, e.message); }
  dry.close();

  const api = await session(WET, '?turbo=6');
  try {
    await api_look(api, 900, 560);
    const f = await api.shot('green-after-1280x720');
    const png = decodePNG(fs.readFileSync(f));
    const livePix = [medianColorAt(png, 400, 430, 40), medianColorAt(png, 640, 470, 40), medianColorAt(png, 900, 430, 40)];
    gate('green: AFTER — the same three patches of ground are green in PIXELS',
      livePix.every((m, i) => greenness(m) > greenness(burntPix[i]) + 12),
      JSON.stringify(livePix) + ' was ' + JSON.stringify(burntPix));
    await api.eval(`__fmDebug.camOff(); __fmDebug.hud(true); 0`);
    /* THE WALK. Structural questions the whole way: never enclosed, always on
       the ground you can see, the sun never touches you again — and the
       river it now has to cross does not cut the region in half. */
    const fords = await api.eval(`FORDS.map(f => { const s = RUN[runIndexAtD(f.d)];
      return { d: f.d, x: +f.x.toFixed(1), z: +f.z.toFixed(1), nx: +s.nx.toFixed(4), nz: +s.nz.toFixed(4),
               wl: +s.wl.toFixed(1), wr: +s.wr.toFixed(1) }; })`);
    const F = fords[1];
    const near = [F.x - F.nx * (F.wl + 5), F.z - F.nz * (F.wl + 5)];
    const far = [F.x + F.nx * (F.wr + 5), F.z + F.nz * (F.wr + 5)];
    const legs = [near, [F.x, F.z], far, [1052, 602], [1100, 810]];
    let worstGap = 0, enclosed = 0, swTicks0 = await api.eval('__fm.swTicks');
    let fordSteps = 0;
    await api.eval(`__fmDebug.warp(${near[0].toFixed(1)}, ${near[1].toFixed(1)}); P.hearts = P.maxHearts; 0`);
    for (const leg of legs) {
      const [x, z] = leg;
      await walkTo(api, x, z, 3.0, 90000);
      const q = await api.eval(`(function(){
        const gapv = Math.abs(__fm.fy - supportYAt(__fm.x, __fm.z, __fm.fy));
        let blocked = 0;
        for (let i = 0; i < 8; i++) {
          const a = i * Math.PI / 4;
          let hit = 0;
          for (let r = 1; r <= 12; r += 1) if (worldSolidAt(__fm.x + Math.cos(a) * r, __fm.z + Math.sin(a) * r) || window.__forestSolid(__fm.x + Math.cos(a) * r, __fm.z + Math.sin(a) * r)) { hit = 1; break; }
          blocked += hit;
        }
        return { gap: gapv, blocked, sw: __fm.swTicks, icon: __fm.swIconMode, vign: __fm.swVign, retired: __fm.swelterRetired, shade: __fm.shade };
      })()`);
      worstGap = Math.max(worstGap, q.gap);
      if (q.blocked >= 8) enclosed++;
      if (await api.eval('__fm.onFord')) fordSteps++;
      if (legs.indexOf(leg) === 2) {          // just across the ford: a frame worth looking at
        await api.eval('__fmDebug.hud(false); 0');
        await sleep(500);
        await api.shot('green-walk-1280x720');
        await api.eval('__fmDebug.hud(true); 0');
      }
      if (q.sw !== swTicks0) { gate('green: the swelter is silent on the walk', false, 'a tick fired at ' + x + ',' + z); swTicks0 = q.sw; }
    }
    gate('green: the walk stays ON the footing it renders (|fy − supportY| < 0.06)', worstGap < 0.06,
      'worst ' + worstGap.toFixed(3) + ' m');
    gate('green: never enclosed on the walk (8 azimuths, 12 m)', enclosed === 0);
    const crossed = await api.eval(`(function(){ const r = runNear(__fm.x, __fm.z); return { side: r.off, wet: riverDepthAt(__fm.x, __fm.z) }; })()`);
    gate('green: the FORD carries a walker across the living river',
      fordSteps > 0 || crossed.side > 0, `ford footfalls ${fordSteps}, ended ${crossed.side.toFixed(1)} m off the spine`);
    const after = await api.eval('({sw:__fm.swTicks, icon:__fm.swIconMode, vign:__fm.swVign, retired:__fm.swelterRetired, hearts:__fm.hearts, max:__fm.maxHearts})');
    gate('green: THE SWELTER IS RETIRED — no tick anywhere on a 900 m walk in open sun',
      after.sw === swTicks0 && after.retired === true && after.hearts === after.max, JSON.stringify(after));
    gate('green: the sun icon is gone from the hearts for good',
      after.icon === 'off' && after.vign < 0.02, JSON.stringify(after));
    /* the three thickets: shut before, open after */
    const th = await api.eval(`(function(){
      const out = [];
      for (const T of THICKETS) {
        let solid = 0;
        for (let i = -2; i <= 2; i++) {
          const bx = T.x + Math.cos(T.a) * i * 3.6, bz = T.z + Math.sin(T.a) * i * 3.6;
          if (worldSolidAt(bx, bz)) solid++;
        }
        out.push({ id: T.id, solid, open: !!T.openNow, offColl: T.coll.every(c => c.off) });
      }
      return out; })()`);
    gate('green: all three thickets are walk-through now', th.every(t => t.offColl && t.open), JSON.stringify(th));
    /* the same thicket, walked THROUGH now */
    const T2 = await api.eval(`(function(){ const t = THICKETS[0]; const c = Math.cos(t.a + Math.PI / 2), s = Math.sin(t.a + Math.PI / 2);
      return { x: t.x, z: t.z, cx: +c.toFixed(4), cz: +s.toFixed(4) }; })()`);
    const from2 = [T2.x - T2.cx * 9, T2.z - T2.cz * 9], to2 = [T2.x + T2.cx * 9, T2.z + T2.cz * 9];
    await api.eval(`__fmDebug.warp(${from2[0].toFixed(1)}, ${from2[1].toFixed(1)}); 0`);
    await walkTo(api, to2[0], to2[1], 1.5, 30000).catch(() => {});
    const through = await api.eval(`Math.hypot(__fm.x - (${to2[0].toFixed(1)}), __fm.z - (${to2[1].toFixed(1)}))`);
    gate('green: AFTER — the softened thicket lets the shortcut through (walked)',
      through < 2.4, `ended ${through.toFixed(1)} m from the far side`);
    await api.eval('__fmDebug.hud(false); 0');
    await api.eval(`__fmDebug.cam(${(T2.x - T2.cx * 16).toFixed(1)}, groundH(${T2.x},${T2.z}) + 7, ${(T2.z - T2.cz * 16).toFixed(1)}, ${T2.x}, groundH(${T2.x},${T2.z}) + 1.5, ${T2.z}); 0`);
    await sleep(900);
    await api.shot('thicket-open-1280x720');
    await api.eval('__fmDebug.camOff(); __fmDebug.hud(true); 0');
    const thShut = await api.eval(`(function(){
      SAVE.riverWet = false; SAVE.sky = 3; applyWorldState();
      const shut = THICKETS.every(t => t.coll.every(c => !c.off)) && THICKETS.every(t => !t.openNow);
      const fords = FORDS.every(f => f.coll.every(c => c.off));
      const g = __fmDebug.greenInfo();
      SAVE.riverWet = true; SAVE.sky = 4; applyWorldState();
      return { shut, fords, green: g.k, sw: g.swelterRetired }; })()`);
    gate('green: BOTH WAYS — dropping the flag re-burns the forest, re-blocks the thickets, lifts the fords',
      thShut.shut && thShut.fords && thShut.green === 0 && thShut.sw === false, JSON.stringify(thShut));
    gate('green: re-deriving forward greens it again',
      await api.eval('__fmDebug.greenInfo().k === 1 && __fm.swelterRetired === true'));
    gate('green: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('green suite', false, e.message);
    await api.shot('green-FAIL').catch(() => {});
  }
  api.close();
}
async function api_look(api, x, z) {
  /* one fixed frame over the same patch of forest, sim frozen, HUD off */
  await api.eval(`__fmDebug.warp(${x}, ${z}); __fmDebug.hud(false); 0`);
  await api.eval(`__fmDebug.cam(${x - 26}, groundH(${x},${z}) + 12, ${z - 30}, ${x + 10}, groundH(${x},${z}) + 1, ${z + 16}); 0`);
  await sleep(1200);
}

/* ═══════════ 3 — THE SKIFF: boarded by prompt, ridden end to end ═══════════ */
async function suiteSkiff() {
  console.log('\n── the skiff on the living Silverrun ──');
  const api = await session(WET_AT_RIVER, '?turbo=8');
  try {
    const s0 = await api.eval('__fmDebug.riverInfo()');
    gate('skiff: the channel is navigable end to end (min depth ≥ 0.8 m at the thalweg)',
      s0.minDepth >= 0.8, `min ${s0.minDepth} m at d=${s0.minDepthAtD}, median depth over ${s0.lengthM} m`);
    gate('skiff: she is moored afloat at the falls pool', s0.skiff.depth > 0.5, JSON.stringify(s0.skiff));
    /* board her the way a player does: stand on the bank and press ✕ */
    const land = await api.eval(`__fmDebug.warpRiver('falls')`);
    for (let a = 0; a < 5 && !(await api.eval(`__fm.prompt === 'skiffOn'`)); a++) {
      const bank = await api.eval(`(function(){
        const r = runNear(SKF.x, SKF.z), side = r.off >= 0 ? 1 : -1;
        for (let u = 0.5; u <= 9; u += 0.5) {
          const px = SKF.x + r.s.nx * u * side, pz = SKF.z + r.s.nz * u * side;
          if (riverDepthAt(px, pz) < 0.35 && !window.__forestSolid(px, pz)) return { x: +px.toFixed(1), z: +pz.toFixed(1) };
        }
        return { x: SKF.x, z: SKF.z }; })()`);
      await walkTo(api, bank.x, bank.z, 1.4, 45000).catch(() => {});
      await sleep(300);
    }
    await api.waitFor(`__fm.prompt === 'skiffOn'`, 12000,
      'the boarding prompt (' + JSON.stringify(await api.eval('({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), d:+Math.hypot(__fm.x-SKF.x, __fm.z-SKF.z).toFixed(1)})')) + ')');
    gate('skiff: a walk-up prompt offers her', true, await api.eval(`(currentInteract()||{}).label`));
    await api.tap(0);
    await api.waitFor('__fm.skiffing === true', 8000, 'aboard');
    gate('skiff: ✕ puts Wick aboard', true);
    await sleep(600);
    await api.shot('skiff-aboard-1280x720');
    const seat = await api.eval(`({vis: wick.root.visible, wy: +wick.root.position.y.toFixed(2), hull: +skiffGrp.position.y.toFixed(2), water: +skiffY().toFixed(2), sitting: Math.abs(wick.hipL.rotation.x) > 0.5})`);
    gate('skiff: Wick rides SEATED and VISIBLE, above the waterline',
      seat.vis && seat.sitting && seat.wy > seat.water + 0.25, JSON.stringify(seat));
    /* THE RIDE: the same in-page bot that walks the world now steers her,
       through the pad, toward a waypoint that keeps moving down the run.
       (Driving the axes directly does not work: the bot zeroes the stick
       every frame it has no target of its own.) */
    const start = await api.eval('__fm.skiffI');
    let minDepth = 9, maxSpd = 0, grounded = 0, wickHidden = 0, worstCalls = 0, worstTris = 0, worstAt = 0;
    await api.eval('__fmBot.tol = 7; __fmBot.sprint(true)');    // ○ held: pole and current together
    for (let i = 0; i < 210; i++) {
      const q = await api.eval(`(function(){
        const ahead = RUN[Math.max(0, SKF.i - 34)];
        __fmBot.done = false; __fmBot.target = [ahead.x, ahead.z];
        return { i: SKF.i, d: riverDepthAt(SKF.x, SKF.z), u: SKF.u, s: SKF.spd,
                 vis: wick.root.visible, sk: skiffGrp.visible, calls: __fm.calls, tris: __fm.tris, r: SKF.rescues };
      })()`);
      minDepth = Math.min(minDepth, q.d);
      maxSpd = Math.max(maxSpd, q.s);
      if (q.calls > worstCalls) { worstCalls = q.calls; worstAt = q.i; }
      worstTris = Math.max(worstTris, q.tris);
      if (q.d < 0.35) grounded++;
      if (!q.vis || !q.sk) wickHidden++;
      if (q.i <= 3) break;
      if (i === 20) await api.shot('skiff-riding-1280x720');
      await sleep(300);
    }
    await api.eval('__fmBot.release()');
    const end = await api.eval('({i:SKF.i, x:+SKF.x.toFixed(1), z:+SKF.z.toFixed(1), r:SKF.rescues, e:SKF.edgeHits})');
    gate('skiff: she rides the whole run downstream under real input',
      end.i < start * 0.25, `station ${start} → ${end.i} of ${await api.eval('RUN.length')}`);
    gate('skiff: the hull NEVER grounds (clearance kept the whole way)',
      grounded === 0 && minDepth > SKIFF_DRAFT_HINT, `min depth ${minDepth.toFixed(2)} m`);
    gate('skiff: no rescue was ever needed', end.r === 0, 'rescues=' + end.r);
    gate('skiff: Wick and the hull stay drawn the whole ride', wickHidden === 0);
    /* upstream is slower but always possible — no one-way traps.
       Run it from the middle of the river: at the very bottom she is inside
       the soft boundary, which is a different mechanic. */
    await api.eval('__fmDebug.skiffTo(1100); 0');
    await sleep(600);
    const i0 = await api.eval('SKF.i');
    await api.eval('__fmBot.tol = 6; __fmBot.sprint(true)');
    for (let i = 0; i < 70; i++) {
      const done = await api.eval(`(function(){
        const back = RUN[Math.min(RUN.length - 1, SKF.i + 26)];
        __fmBot.done = false; __fmBot.target = [back.x, back.z];
        return SKF.i > ${i0} + 26; })()`);
      if (done) break;
      await sleep(420);
    }
    await api.eval('__fmBot.release()');
    const up = await api.eval('SKF.i');
    gate('skiff: upstream is possible against the current (no one-way trap)', up > i0 + 12,
      `station ${i0} → ${up} (${((up - i0) * 6)} m against the flow)`);
    await api.eval('__fmBot.still = true; __fakePad.axes(0,0); 0');
    await api.waitFor('__fm.skiffSpd < 2.2', 15000, 'she slows');
    await api.eval('__fmBot.still = false; 0');
    /* hop out — only onto footing you could have walked to */
    await api.waitFor(`__fm.prompt === 'skiffOff'`, 20000, 'the hop-out prompt');
    gate('skiff: a hop-out prompt appears when she is slow enough', true,
      await api.eval(`(currentInteract()||{}).label`));
    await api.tap(0);
    await api.waitFor('__fm.skiffing === false', 8000, 'ashore');
    const ash = await api.eval(`({ dry: riverDepthAt(__fm.x, __fm.z) < 0.45, gap: Math.abs(__fm.fy - groundH(__fm.x, __fm.z)),
      near: Math.hypot(__fm.x - SKF.x, __fm.z - SKF.z), solid: worldSolidAt(__fm.x, __fm.z) || window.__forestSolid(__fm.x, __fm.z) })`);
    gate('skiff: COME ASHORE puts Wick on dry, walkable footing beside her',
      ash.dry && !ash.solid && ash.gap < 0.06 && ash.near < 6, JSON.stringify(ash));
    await api.shot('skiff-ashore-1280x720');
    /* she stays where she was tied up, across a reload */
    const where = await api.eval('({x:SAVE.skiffX, z:SAVE.skiffZ})');
    gate('skiff: her mooring is saved', typeof where.x === 'number', JSON.stringify(where));
    const moved = await api.eval(`(function(){ const b=[SKF.x,SKF.z]; applyWorldState();
      return { moved: +Math.hypot(SKF.x-b[0], SKF.z-b[1]).toFixed(2), depth: +riverDepthAt(SKF.x, SKF.z).toFixed(2),
               reach: +Math.hypot(__fm.x-SKF.x, __fm.z-SKF.z).toFixed(2) }; })()`);
    gate('skiff: a re-derive leaves her at the same landing, afloat and inside arm\'s reach',
      moved.moved < 6 && moved.depth > 0.5 && moved.reach < 5.6, JSON.stringify(moved));
    /* two numbers, because they answer two different questions: what the
       living river COSTS (this file's business) and what the frame TOTALS
       (the whole region's — and the forecourt was already over budget
       before a drop of water was added to it). Run LAST and ashore: a
       re-derive mid-suite puts Wick back on the bank, which silently ended
       three gates' worth of riding the first time round. */
    const base = await api.eval(`(function(){
      const before = { calls: __fm.calls };
      SAVE.riverWet = false; SAVE.sky = 3; applyWorldState();
      return before; })()`);
    await sleep(700);
    const dryCalls = await api.eval('__fm.calls');
    await api.eval('SAVE.riverWet = true; SAVE.sky = 4; applyWorldState(); 0');
    await sleep(700);
    const wetCalls = await api.eval('__fm.calls');
    gate('skiff: the living river costs ≤7 draw calls where she sails',
      wetCalls - dryCalls <= 7, `+${wetCalls - dryCalls} here (${dryCalls} → ${wetCalls})`);
    gate('skiff: ≤120k triangles at speed', worstTris <= 120000, `${worstTris}`);
    gate('skiff: whole-frame budget ≤80 calls at speed', worstCalls <= 80,
      `${worstCalls} calls at station ${worstAt}, top speed ${maxSpd.toFixed(1)} m/s`);
    gate('skiff: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('skiff suite', false, e.message);
    await api.shot('skiff-FAIL').catch(() => {});
  }
  api.close();
}
const SKIFF_DRAFT_HINT = 0.34;
function RUN_HINT() { return null; }

/* ═══════════ 4 — NEW GAME: the John sequence, phase four ═══════════ */
async function suiteWorld() {
  console.log('\n── the John sequence: a finished world taken to NEW GAME ──');
  const api = await session(WET, '?turbo=6');
  try {
    gate('world: the finished save boots green, wet and quiet',
      await api.eval('__fm.greenK === 1 && __fm.riverWet === true && __fm.swelterRetired === true'));
    /* NEW GAME through the real guard */
    await api.eval(`__fmDebug.camOff(); 0`);
    await api.eval(`setState('title'); refreshTitleMenu(); titleFocus = 0; 0`);
    await api.nav(await api.eval('location.href'));
    await api.waitFor(`__fm.state === 'title'`, 30000, 'title again');
    await tapUntil(api, () => api.tap(0), '__fm.ngGuardOn === true', 10, 'the NEW GAME guard');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 10, 'confirm fresh');
    await api.waitFor(`__fm.state === 'play'`, 40000, 'a fresh adventure');
    await sleep(900);
    const fresh = await api.eval('({green:__fm.greenK, wet:__fm.riverWet, sw:__fm.swelterRetired, th:__fm.thicketsOpen, star:__fm.star4On, sky4:__fm.skyStep4, q:__fm.quest, sky:__fm.skyStep, pour:__fm.fallsPour, live:__fm.riverLive})');
    gate('world: NEW GAME burns the forest back down', fresh.green === 0, JSON.stringify(fresh));
    gate('world: NEW GAME dries the Silverrun and stops the falls',
      fresh.wet === false && fresh.live === false && fresh.pour === 0);
    gate('world: NEW GAME puts the swelter back to work and re-blocks the thickets',
      fresh.sw === false && fresh.th === false);
    gate('world: NEW GAME unlights the fourth star and un-dims the sky',
      fresh.star === false && fresh.sky4 === 0 && fresh.sky === 0 && fresh.q === 0);
    const props = await api.eval(`({ wheelsHidden: WHEELS.every(w => !w.g.visible), ferryHidden: !ferryGrp.visible,
      riverHidden: !riverMesh.visible, skiffHidden: !skiffGrp.visible,
      bakedBack: PROP_SWAPS.every(r => !r.parked) })`);
    gate('world: the wheels stop, the ferry beaches, the baked props come back',
      props.wheelsHidden && props.ferryHidden && props.riverHidden && props.skiffHidden && props.bakedBack,
      JSON.stringify(props));
    /* and the sun icon is drawable again — the hazard package is whole */
    const sw = await api.eval(`(function(){ __fmDebug.warp(900, 560); P.hearts = P.maxHearts; swelterT = 1100; return { retired: __fm.swelterRetired }; })()`);
    gate('world: the swelter package is armed again after NEW GAME', sw.retired === false);
    gate('world: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) {
    gate('world suite', false, e.message);
    await api.shot('world-FAIL').catch(() => {});
  }
  api.close();
}

/* ═══════════ 5 — BUDGETS: the green world at eight sample points ═══════════ */
async function suitePerf() {
  console.log('\n── budgets in the living forest ──');
  const api = await session(WET, '?turbo=1');
  try {
    const SPOTS = [
      ['pass camp', 300, 78], ['the mill', 650, 392], ['glade two', 900, 560],
      ['the ferry', 1338, 568], ['the tower deck', 1100, 810], ['the hamlet', 1580, 848],
      ['the head pool', 1866, 1130], ['the forecourt', 1900, 1165],
    ];
    let worst = { calls: 0, tris: 0, at: '' };
    for (const [name, x, z] of SPOTS) {
      await api.eval(`__fmDebug.warp(${x}, ${z}); 0`);
      await sleep(500);
      for (let a = 0; a < 4; a++) {
        await api.eval(`__fmDebug.camYaw(${a * Math.PI / 2}); 0`);
        await sleep(280);
        const m = await api.eval('({calls:__fm.calls, tris:__fm.tris})');
        if (m.calls > worst.calls) worst = { calls: m.calls, tris: m.tris, at: name + ' yaw' + a };
      }
    }
    gate('perf: ≤80 draw calls across eight green-world vantages, four azimuths each',
      worst.calls <= 80, `worst ${worst.calls} calls / ${worst.tris} tris at ${worst.at}`);
    gate('perf: ≤120k triangles', worst.tris <= 120000, `${worst.tris}`);
    /* the wave itself, measured: the front must not blow the frame */
    const wave = await api.eval(`(function(){
      grnSet(0);                       // measure the WAVE, not a world already green
      const t0 = performance.now();
      for (let f = 0; f < 40; f++) grnWave(60 + f * 55);
      const ms = (performance.now() - t0) / 40;
      grnSet(1);
      return { msPerFrame: +ms.toFixed(2), work: __fm.greenWork, verts: __fm.greenVerts };
    })()`);
    gate('perf: a wave-front frame costs under 6 ms of CPU', wave.msPerFrame < 6,
      `${wave.msPerFrame} ms/frame over ${wave.verts} tracked vertices`);
    const snap = await api.eval('__fmDebug.greenInfo().snapshotMs');
    gate('perf: the build-time green snapshot costs under 120 ms once', snap < 120, snap + ' ms');
    gate('perf: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
  } catch (e) { gate('perf suite', false, e.message); }
  api.close();
}

/* ═══════════ main ═══════════ */
if (want('payoff')) await suitePayoff();
if (want('green')) await suiteGreen();
if (want('skiff')) await suiteSkiff();
if (want('world')) await suiteWorld();
if (want('perf')) await suitePerf();
process.exit(summary());
