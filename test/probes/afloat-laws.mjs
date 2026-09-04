#!/usr/bin/env node
/* ═══ AFLOAT LAWS — the two things that stop being true when something
   else is driving the body ═══

   THREE region parts replace `tickPlayer` wholesale: `tickSailing` (p6c,
   P.sailing), `tickSkiff` (p6h, P.skiffing) and `skTickPunt` (p6k,
   P.skPunting). Everything the on-foot tick owned silently stopped inside
   them. Two live-play bugs came out of exactly that hole:

   1. THE MOON COMPASS (MIRROR-4: "the compass answers EVERY state").
      △/L is consumed in tickPlayer's free-movement block, which the three
      drivers replace — so the moonglass was dead at the helm for the whole
      life of sailing. John hit it mid-q33, on the boat at the night
      anchorage, with no way to ask where the next call was.

   2. WICK FLICKERS AT NIGHT (three reports, blamed twice on display
      half-rate). `P.iframes` was decremented inside tickPlayer, so one hit
      taken aboard froze it at 85 forever: animateWick's i-frame blink
      strobed Wick at ~8 Hz for the rest of the voyage, and hurtPlayer's
      `iframes > 0` guard made the helm permanently INVULNERABLE besides.
      Now `tickPlayerClocks()` (p5) is the one owner and the SIM calls it.

   Run:  node test/probes/afloat-laws.mjs [section...]
   Sections: compass wick        (default: both)                       */
import { serve, launchChrome, pageSession, mkApi, gate as rawGate, summary, sleep, GAME, P4_START }
  from './p6g.mjs';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

const gate = (label, ok, extra) => rawGate(ok, label, extra);
const SHOTS = '/tmp/fm_afloat';
fs.mkdirSync(SHOTS, { recursive: true });
const WANT = process.argv.slice(2).length ? process.argv.slice(2) : ['compass', 'wick'];
const want = s => WANT.includes(s);

const P7_DONE = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'phase7-done-save.json'), 'utf8'));
/* genuinely MID phase three: the keel is in and the sea is open, but the
   Foundry, the Tortoise and the sun arc are all still ahead */
const P3_MID = {
  ...P4_START, q: 9, ph: 2, sky: 2,
  tortoiseDone: false, sunArc: false, fGlyph1: false, fGlyph2: false, fGlyph3: false,
  tbc3Seen: false, fMouldHeart: false, fMouldMural: false,
};

/* ── a session, always through the title on real input ── */
async function session(save, query, seen) {
  const { srv, port: hport } = await serve();
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = mkApi(c);
  await api.init();
  await api.seedSave(save);
  if (seen && seen.length) await api.seedSeen(seen);
  api.close = () => { c.close(); proc.kill(); srv.close(); };
  api.png = async (name) => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    const f = path.join(SHOTS, name + '.png');
    fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
    console.log('   shot → ' + f);
    return f;
  };
  await api.nav(`http://127.0.0.1:${hport}/${query || '?fx=low'}`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title');
  for (let i = 0; i < 14 && !(await api.eval('__fm.titleFocus === 1')); i++) await api.tap(13);
  for (let i = 0; i < 16 && (await api.eval(`__fm.state === 'title'`)); i++) await api.tap(0);
  for (let i = 0; i < 30 && (await api.eval(`__fm.state !== 'play'`)); i++) { await api.tap(0); await sleep(320); }
  await api.waitFor(`__fm.state === 'play'`, 30000, 'play');
  await api.waitTicks(20);
  return api;
}

/* a △ TAP through the fake pad — short enough that the spyglass (a 0.32 s
   hold on the same button) never raises. This is the real press stream. */
async function tapTri(api) {
  await api.eval('__fakePad.press(3)');
  await sleep(110);
  await api.eval('__fakePad.press()');
  await sleep(120);
}
/* press △ and report what the compass did */
async function pulseTest(api) {
  const m0 = await api.eval('compassMotes');
  await tapTri(api);
  await api.waitTicks(4);
  return JSON.parse(await api.eval(`JSON.stringify({
    motes: compassMotes - ${m0}, pulseT: +P.pulseT.toFixed(3),
    obj: objectivePoint() ? 1 : 0,
    sail: !!P.sailing, skiff: !!P.skiffing, punt: !!P.skPunting,
    state: state, cine: CINE.id || '', voyage: !!VOYAGE.active })`));
}

/* ═══════════════════ 1. THE COMPASS ANSWERS AFLOAT ═══════════════════ */
if (want('compass')) {
  /* ── state A: mid-phase-3, the open sea ── */
  console.log('\n═══ compass afloat: mid-phase-3 open sea ═══');
  {
    const api = await session(P3_MID, '?fx=low');
    const setup = await api.eval(`(function(){
      __fmDebug.warpSea((CROSS_LANE.fromX + CROSS_LANE.toX) / 2, (CROSS_LANE.fromZ + CROSS_LANE.toZ) / 2, 2.2);
      return JSON.stringify({ sail: P.sailing, sword: P.sword, q: QUEST.q, x: +P.x.toFixed(0), z: +P.z.toFixed(0) });
    })()`);
    await api.waitTicks(10);
    const r = await pulseTest(api);
    gate('open sea: △ at the helm fires the moon compass', r.motes > 0 && r.sail && r.pulseT > 0,
      setup + ' → ' + JSON.stringify(r));
    gate('open sea: the pulse spends the full objective stream (13 motes)', r.motes === 13,
      JSON.stringify(r));
    /* the same press ashore, same save, same objective — identical answer */
    await api.eval(`P.sailing = false; __fmDebug.warp(REFIT_BEACH.x + 3, REFIT_BEACH.z + 3); 0`);
    await api.waitTicks(10);
    const foot = await pulseTest(api);
    gate('parity: afloat spends exactly what on foot spends', foot.motes === r.motes && !foot.sail,
      'afloat ' + r.motes + ' vs foot ' + foot.motes);

    /* ── the negative: PEARL'S VOYAGE is on rails and answers nothing ── */
    await api.eval(`__fmDebug.warpSea(BOAT.x, BOAT.z, 1.2); startVoyage(); 0`);
    await api.waitTicks(6);
    const v = await pulseTest(api);
    gate('VOYAGE: △ on Pearl’s authored lap does NOT fire', v.motes === 0 && v.voyage,
      JSON.stringify(v));
    await api.eval(`endVoyage(); 0`);
    gate('open sea: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }

  /* ── state B: the q33 night anchorage (the one John hit) + a cine ── */
  console.log('\n═══ compass afloat: the q33 night anchorage ═══');
  {
    const api = await session(P7_DONE, '?fx=low', ['cnCallsIn']);
    const setup = await api.eval(`(function(){
      __fmDebug.endgame();
      SAVE.q = 33; SAVE.medley = [true, false, false, false]; storeSave(); applyWorldState();
      BOAT.x = CN_SITE.x + 20; BOAT.z = CN_SITE.z + 14; BOAT.spd = 0;
      P.x = BOAT.x; P.z = BOAT.z;
      if (!P.sailing) boardBoat();
      __fmDebug.nightNow(1);
      return JSON.stringify({ q: SAVE.q, sail: P.sailing, call: cnCallIdx(), nightK: nmNightK });
    })()`);
    await api.waitTicks(10);
    const r = await pulseTest(api);
    gate('q33 medley, at night, at the helm: △ fires the compass', r.motes > 0 && r.sail && r.pulseT > 0,
      setup + ' → ' + JSON.stringify(r));
    gate('q33: the stream points at a live objective (the next call)', r.obj === 1 && r.motes === 13,
      JSON.stringify(r));
    /* THE ARC LEAVES HIS HANDS. Aboard, P.fy is pinned just above the
       waterline while the rendered body heaves with the swell, so wait for
       a real heave and then check where the silver actually starts. */
    await api.waitFor('Math.abs(wick.root.position.y - P.fy) > 0.6', 40000, 'a real swell heave');
    await api.eval(`(function(){
      var a = psSparkle.pts.geometry.attributes.position.array;
      for (var i = 1; i < a.length; i += 3) a[i] = -999;
      window.__arcRef = { wickY: wick.root.position.y, footY: P.fy };
    })(); 0`);
    await tapTri(api);
    const arc = JSON.parse(await api.eval(`JSON.stringify((function(){
      var a = psSparkle.pts.geometry.attributes.position.array, lo = 1e9, n = 0;
      for (var i = 1; i < a.length; i += 3) if (a[i] > -900) { lo = Math.min(lo, a[i]); n++; }
      return { n: n, lo: +lo.toFixed(2),
        wantBody: +(__arcRef.wickY + 1.2).toFixed(2), wantFoot: +(__arcRef.footY + 1.2).toFixed(2),
        heave: +(__arcRef.wickY - __arcRef.footY).toFixed(2) };
    })())`));
    gate('the arc starts at the rendered body, not at the frozen waterline',
      arc.n > 0 && Math.abs(arc.lo - arc.wantBody) < Math.abs(arc.lo - arc.wantFoot),
      JSON.stringify(arc));

    /* ── the negative: a CINE afloat answers nothing (real trigger) ── */
    await api.eval(`(function(){
      SAVE.q = 32; SAVE.medley = [false,false,false,false]; SAVE.moonSeen = true; storeSave(); applyWorldState();
      __fmDebug.moonsite();
    })(); 0`);
    await api.waitFor(`__fm.cinId === 'cnCallsIn'`, 40000, 'the arrival cine');
    const cn = await pulseTest(api);
    gate('CINE afloat: △ during cnCallsIn does NOT fire', cn.motes === 0 && cn.state === 'cine',
      JSON.stringify(cn));
    gate('q33: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }

  /* ── state C: post-game free play, aboard — objective null, MIRROR-7 ── */
  console.log('\n═══ compass afloat: post-game free play (objective rests) ═══');
  {
    const api = await session(P7_DONE, '?fx=low', ['cnCallsIn', 'cnRising', 'cnCoin', 'cnWheel8', 'cnEnd']);
    const setup = await api.eval(`(function(){
      __fmDebug.postgame();
      BOAT.x = 8.5; BOAT.z = 6.0; BOAT.spd = 0; P.x = BOAT.x; P.z = BOAT.z;
      if (!P.sailing) boardBoat();
      __fmDebug.nightNow(1);
      return JSON.stringify({ q: SAVE.q, sail: P.sailing, obj: objectivePoint() });
    })()`);
    await api.waitTicks(10);
    const r = await pulseTest(api);
    gate('post-game afloat: objective rests, the moonglass still answers',
      r.motes === 10 && r.obj === 0 && r.sail, setup + ' → ' + JSON.stringify(r));

    /* ── state D: THE SKIFF (p6h replaces tickPlayer too) ── */
    const sk = await api.eval(`(function(){
      P.sailing = false;
      __fmDebug.warpRiver('ferry');
      SKF.x = P.x; SKF.z = P.z;
      boardSkiff();
      return JSON.stringify({ skiff: P.skiffing });
    })()`).catch(e => JSON.stringify({ err: String(e) }));
    await api.waitTicks(10);
    const rs = await pulseTest(api);
    gate('THE SKIFF: △ on the Silverrun fires the compass', rs.motes > 0 && rs.skiff,
      sk + ' → ' + JSON.stringify(rs));

    /* ── state E: THE PUNT (p6k replaces tickPlayer too) ── */
    const pu = await api.eval(`(function(){
      P.skiffing = false;
      skBoardPunt();
      return JSON.stringify({ punt: P.skPunting, x: +P.x.toFixed(1), z: +P.z.toFixed(1) });
    })()`).catch(e => JSON.stringify({ err: String(e) }));
    await api.waitTicks(10);
    const rp = await pulseTest(api);
    gate('THE PUNT: △ at the islets fires the compass', rp.motes > 0 && rp.punt,
      pu + ' → ' + JSON.stringify(rp));
    gate('post-game: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
}

/* ═══════════════════ 2. WICK NEVER OSCILLATES ═══════════════════ */

/* per render frame: how many of Wick's 13 meshes were actually submitted */
const WATCH = `(function () {
  window.__ww = { rows: [], caps: [] };
  var W = window.__ww, drawn = 0;
  for (var i = 0; i < wick.parts.length; i++) wick.parts[i].onBeforeRender = function () { drawn++; };
  var gl = renderer.getContext();
  var _r = renderer.render.bind(renderer);
  renderer.render = function (s, c) {
    drawn = 0;
    _r(s, c);
    W.rows.push([drawn, P.iframes | 0, wick.root.visible ? 1 : 0,
      (typeof simTick !== 'undefined' ? simTick : -1)]);
    if (W.rows.length > 5000) W.rows.shift();
    /* two CONSECUTIVE frames of Wick's own screen box, on request */
    if (W.grab > 0) {
      var v = new THREE.Vector3(wick.root.position.x, wick.root.position.y + 0.9, wick.root.position.z);
      v.project(c);
      if (W.box === undefined) {
        var sx = Math.round((v.x * 0.5 + 0.5) * 1280), sy = Math.round((1 - (v.y * 0.5 + 0.5)) * 720);
        W.box = [Math.max(0, Math.min(1280 - 260, sx - 130)), Math.max(0, Math.min(720 - 300, sy - 170))];
      }
      var buf = new Uint8Array(260 * 300 * 4);
      gl.readPixels(W.box[0], 720 - W.box[1] - 300, 260, 300, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      var bin = '';
      for (var k = 0; k < buf.length; k += 8192) bin += String.fromCharCode.apply(null, buf.subarray(k, Math.min(buf.length, k + 8192)));
      W.caps.push(btoa(bin));
      W.grab--;
    }
  };
  W.reset = function () { W.rows.length = 0; };
  return 'watching';
})()`;

/* minimal PNG writer, so the two consecutive frames land on disk as images */
const CRC = (() => { const t = new Int32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c; } return t; })();
function crc32(b) { let c = -1; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngChunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0); head.write(type, 4, 'ascii');
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'ascii'), data])), 0);
  return Buffer.concat([head, data, tail]);
}
function writePNG(file, w, h, rgbaBottomUp) {
  const stride = w * 4, raw = Buffer.alloc((stride + 1) * h);
  for (let y = 0; y < h; y++) {                       // gl rows are bottom-up
    raw[y * (stride + 1)] = 0;
    rgbaBottomUp.copy(raw, y * (stride + 1) + 1, (h - 1 - y) * stride, (h - y) * stride);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  fs.writeFileSync(file, Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr), pngChunk('IDAT', zlib.deflateSync(raw)), pngChunk('IEND', Buffer.alloc(0)),
  ]));
}

/* run N sim ticks with the watcher live, then describe what Wick did */
async function watchTicks(api, n) {
  await api.eval('__ww.reset(); 0');
  const t0 = await api.eval('__fm.tick');
  await api.waitFor(`__fm.tick > ${t0 + n}`, 300000, n + ' ticks');
  const rows = JSON.parse(await api.eval('JSON.stringify(__ww.rows)'));
  /* THE LAW: Wick's pixels may change only on a real state edge. The only
     edge that exists here is the i-frame blink, and it is bounded by the
     clock. So: every frame with the clock at zero must draw all 13 of him,
     and nothing may change while the clock is at zero. (Written this way
     the gate survives a stray gull taking a bite mid-window — which is a
     real hit, a real edge, and must NOT read as a regression.) */
  let hidden = 0, flips = 0, partial = 0;
  let blindWhenSafe = 0, flipsWhileSafe = 0, reachedZero = false, maxIfr = 0;
  for (let i = 0; i < rows.length; i++) {
    const [drawn, ifr] = rows[i];
    if (drawn === 0) hidden++; else if (drawn !== 13) partial++;
    if (ifr === 0) reachedZero = true;
    if (ifr > maxIfr) maxIfr = ifr;
    if (ifr === 0) {
      if (drawn !== 13) blindWhenSafe++;
      if (i && rows[i - 1][1] === 0 && drawn !== rows[i - 1][0]) flipsWhileSafe++;
    }
    if (i && drawn !== rows[i - 1][0]) flips++;
  }
  return { frames: rows.length, hidden, partial, flips, blindWhenSafe, flipsWhileSafe,
    reachedZero, maxIfr, first: rows[0], last: rows[rows.length - 1] };
}

/* two CONSECUTIVE rendered frames of Wick's box, written out and compared */
async function twoFrames(api, name) {
  await api.eval('__ww.caps.length = 0; __ww.box = undefined; __ww.grab = 2; 0');
  await api.waitFor('__ww.grab === 0 && __ww.caps.length === 2', 30000, 'two frames');
  const caps = JSON.parse(await api.eval('JSON.stringify(__ww.caps)'));
  const a = Buffer.from(caps[0], 'base64'), b = Buffer.from(caps[1], 'base64');
  const fa = path.join(SHOTS, name + '-frameA.png'), fb = path.join(SHOTS, name + '-frameB.png');
  writePNG(fa, 260, 300, a); writePNG(fb, 260, 300, b);
  let diff = 0, lum = 0;
  for (let i = 0; i < a.length; i += 4) {
    if (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2]) > 60) diff++;
    lum += a[i] + a[i + 1] + a[i + 2];
  }
  const px = a.length / 4;
  console.log(`   two consecutive frames → ${fa}\n                            ${fb}`);
  return { pct: +(100 * diff / px).toFixed(2), meanLum: +(lum / px / 3).toFixed(1), px };
}

if (want('wick')) {
  /* ── the q33 night anchorage, on the boat: the exact reported scene ── */
  console.log('\n═══ Wick at the q33 night anchorage ═══');
  {
    const api = await session(P7_DONE, '?fx=low', ['cnCallsIn']);
    console.log('  setup →', await api.eval(`(function(){
      __fmDebug.endgame();
      SAVE.q = 33; SAVE.medley = [true, false, false, false]; storeSave(); applyWorldState();
      BOAT.x = CN_SITE.x + 20; BOAT.z = CN_SITE.z + 14; BOAT.spd = 0;
      P.x = BOAT.x; P.z = BOAT.z;
      if (!P.sailing) boardBoat();
      __fmDebug.nightNow(1);
      return JSON.stringify({ q: SAVE.q, sail: P.sailing, nightK: nmNightK, hearts: P.hearts });
    })()`));
    await api.eval(WATCH);
    await api.waitTicks(20);

    const idle = await watchTicks(api, 620);
    gate('q33 night anchorage, 620 ticks idle: Wick never blinks',
      idle.blindWhenSafe === 0 && idle.flipsWhileSafe === 0 && idle.partial === 0,
      JSON.stringify(idle));
    const two = await twoFrames(api, 'q33-night-steady');
    gate('two consecutive frames at the site differ only by the sea (<3 %)',
      two.pct < 3, JSON.stringify(two));
    await api.png('q33-night-anchorage');

    /* THE BUG ITSELF: a hit taken aboard used to freeze P.iframes at 85 */
    await api.eval(`hurtPlayer(1, P.x + 3, P.z, null); 0`);
    const hit = await watchTicks(api, 620);
    gate('a hit taken AFLOAT: the i-frame blink ENDS (it used to strobe forever)',
      hit.last[1] === 0 && hit.reachedZero && hit.hidden > 0 && hit.hidden < 120, JSON.stringify(hit));
    const settle = await watchTicks(api, 400);
    gate('after the blink: 400 more ticks, Wick changes ONLY inside an i-frame window',
      settle.blindWhenSafe === 0 && settle.flipsWhileSafe === 0 && settle.partial === 0,
      JSON.stringify(settle));
    /* the same freeze also made the helm permanently invulnerable */
    const inv = JSON.parse(await api.eval(`JSON.stringify((function(){
      var h0 = P.hearts; hurtPlayer(1, P.x + 3, P.z, null);
      return { before: h0, after: P.hearts, iframes: P.iframes, sail: !!P.sailing };
    })())`));
    gate('and the helm is mortal again — a second hit lands',
      inv.after === inv.before - 1 && inv.sail, JSON.stringify(inv));
    gate('q33 night: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }

  /* ── the night market, in the skiff: the second driver ── */
  console.log('\n═══ Wick at the night market (in the skiff) ═══');
  {
    const api = await session(P7_DONE, '?fx=low', ['cnCallsIn', 'cnRising', 'cnCoin', 'cnWheel8', 'cnEnd']);
    console.log('  setup →', await api.eval(`(function(){
      __fmDebug.postgame();
      __fmDebug.nightNow(1);
      __fmDebug.warpMarket();
      return JSON.stringify({ q: SAVE.q, nightK: nmNightK, x: +P.x.toFixed(1), z: +P.z.toFixed(1) });
    })()`));
    await api.eval(WATCH);
    await api.waitTicks(20);
    const idle = await watchTicks(api, 620);
    gate('night market, 620 ticks: Wick never blinks',
      idle.blindWhenSafe === 0 && idle.flipsWhileSafe === 0 && idle.partial === 0,
      JSON.stringify(idle));
    const two = await twoFrames(api, 'night-market-steady');
    gate('two consecutive frames at the market differ only by the lanterns (<3 %)',
      two.pct < 3, JSON.stringify(two));
    await api.png('night-market');

    console.log('  skiff →', await api.eval(`(function(){
      __fmDebug.warpRiver('ferry');
      SKF.x = P.x; SKF.z = P.z;
      boardSkiff();
      return JSON.stringify({ skiff: P.skiffing });
    })()`));
    await api.waitTicks(20);
    await api.eval(`hurtPlayer(1, P.x + 3, P.z, null); 0`);
    const hit = await watchTicks(api, 620);
    gate('a hit taken IN THE SKIFF: the i-frame blink ENDS too',
      hit.last[1] === 0 && hit.reachedZero && hit.hidden > 0 && hit.hidden < 120, JSON.stringify(hit));
    /* and the punt, the third driver */
    console.log('  punt →', await api.eval(`(function(){
      P.skiffing = false; skBoardPunt(); P.iframes = 0;
      return JSON.stringify({ punt: P.skPunting });
    })()`));
    await api.waitTicks(20);
    await api.eval(`hurtPlayer(1, P.x + 3, P.z, null); 0`);
    const puntHit = await watchTicks(api, 620);
    gate('a hit taken IN THE PUNT: the i-frame blink ENDS too',
      puntHit.last[1] === 0 && puntHit.reachedZero && puntHit.hidden > 0 && puntHit.hidden < 120,
      JSON.stringify(puntHit));
    gate('night market: zero console errors', api.errs.length === 0, api.errs.slice(0, 3).join(' | '));
    api.close();
  }
}

process.exit(summary() ? 1 : 0);
