#!/usr/bin/env node
// Standalone live-repro probe — draw-call CENSUS at the fperf hollow vista.
// NOT a gate suite — a diagnosis tool. Reuses the harness's Chrome plumbing,
// seeds the SAME fixture as suiteForestPerf and replicates its walk pattern,
// then enumerates every object that draws at the worst frame.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(DIR, 'test', 'shots-probe');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CONTROLLER_JS = fs.readFileSync(path.join(DIR, '..', 'gameconsole', 'lib', 'controller.js'), 'utf8');
const HARNESS_SRC = fs.readFileSync(path.join(DIR, 'test', 'harness.mjs'), 'utf8');
const BOT_SRC = HARNESS_SRC.match(/const BOT_SRC = `([\s\S]*?)`;\n/)[1];
const STUN_STAGE = HARNESS_SRC.match(/const STUN_STAGE = `([\s\S]*?)`;\n/)[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  const srv = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    const f = path.join(DIR, p === '/' ? 'index.html' : p);
    if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(DIR, 'test', '.chrome-probe-'));
  const proc = spawn(CHROME, [
    '--headless=new', '--mute-audio', '--remote-debugging-port=0',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--force-device-scale-factor=1',
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage', `--user-data-dir=${profile}`, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', d => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) resolve(m[1]);
    });
    proc.on('exit', () => reject(new Error('chrome exited early\n' + buf)));
    setTimeout(() => reject(new Error('no devtools ws')), 15000);
  });
  return { proc, port: new URL(wsUrl).port };
}
function connect(wsUrl) {
  return new Promise((resolve) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    ws.onopen = () => resolve({
      ws,
      send(method, params = {}) {
        return new Promise((res2, rej2) => {
          const mid = ++id;
          pending.set(mid, { res2, rej2 });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { ws.close(); },
    });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) {
        const p = pending.get(m.id); pending.delete(m.id);
        if (m.error) p.rej2(new Error(m.error.message)); else p.res2(m.result);
      }
    };
  });
}
async function pageSession(port) {
  for (let i = 0; i < 40; i++) {
    const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = list.find(t => t.type === 'page');
    if (page) return connect(page.webSocketDebuggerUrl);
    await sleep(250);
  }
  throw new Error('no page target');
}

// SAME fixture as suiteForestPerf: { ...FOREST_SAVE, mh: 8, wardenTalked: 1,
// lastShade: [243, 57], region: 'forest' }
const FOREST_SAVE = {
  v: 2, q: 0, ph: 0, mh: 8, sword: true, salt: 0,
  talked: { finn: 0, tock: 0, pearl: 0 },
  kelpDoor: false, doorChest: false, finnHeart: true, wreckChest: false,
  wallBurned: false, bossDone: false, sky: 0, tidepool: false,
  compassSeen: true, forestSeen: true, swelterSeen: false,
  region: 'forest', lastSpring: -1, lastShade: [243, 57], wardenTalked: 1,
};
const PAD_STUB = `(function(){
  const mk=()=>({pressed:false,touched:false,value:0});
  const pad={id:'Fake DualShock 4 (STANDARD GAMEPAD Vendor: 054c Product: 09cc)',
    index:0,connected:true,mapping:'standard',timestamp:0,
    axes:[0,0,0,0],buttons:Array.from({length:17},mk),
    vibrationActuator:{playEffect:()=>Promise.resolve('complete')}};
  window.__fakePad={
    axes(lx,ly){pad.axes[0]=lx||0;pad.axes[1]=ly||0;pad.timestamp=performance.now();},
    raxes(rx,ry){pad.axes[2]=rx||0;pad.axes[3]=ry||0;pad.timestamp=performance.now();},
    press(){const idx=Array.prototype.slice.call(arguments);
      for(let i=0;i<17;i++){const on=idx.indexOf(i)>=0;pad.buttons[i].pressed=on;pad.buttons[i].value=on?1:0;}
      pad.timestamp=performance.now();},
  };
  Object.defineProperty(navigator,'getGamepads',{value:function(){return [pad,null,null,null];},configurable:true});
})();`;

const TAG_SRC = `(function(){
  const errs = [];
  const tag = (o, n) => { try { if (o && o.traverse) o.traverse(x => { if (!x.name) x.name = n; }); } catch(e){} };
  const T = (fn) => { try { fn(); } catch(e){ errs.push(e.message); } };
  T(() => { for (const ch of fchunkMap.values()) tag(ch.mesh, 'fchunk'); });
  T(() => { for (const t of farTiles) tag(t.mesh, 'farTile'); });
  T(() => { for (const m of farTier) tag(m, 'farTier'); });
  T(() => { for (const p of kelpPatches) tag(p.mesh, 'kelp'); });
  T(() => { for (const s of saltPickups) tag(s.mesh, 'salt'); });
  T(() => { for (const s of fSalt) tag(s.mesh, 'fsalt'); });
  T(() => { for (const cr of crabs) tag(cr.c.root, 'crab'); });
  T(() => { for (const w of wisps) tag(w.m.root, 'wisp'); });
  T(() => { for (const b of BOARS) tag(b.c.root, 'boar'); });
  T(() => { for (const h of HORNETS) tag(h.m.root, 'hornet'); });
  T(() => { tag(finn.char.root, 'finn'); tag(tock.char.root, 'tock'); tag(pearl.char.root, 'pearl'); });
  T(() => { tag(wick.root, 'wick'); tag(wickShadow, 'wickShadow'); tag(wick.trail.mesh, 'wickTrail'); });
  T(() => { tag(warden.char.root, 'warden'); });
  T(() => { tag(fallsMesh, 'fallsMesh'); });
  T(() => { tag(rockfallMesh, 'rockfall'); tag(rockfallOpenMesh, 'rockfallOpen'); });
  T(() => { tag(towerMesh, 'towerMesh'); tag(cedarMesh, 'cedarMesh'); tag(cedarGlow, 'cedarGlow'); });
  T(() => { tag(hollowFloorMesh, 'hollowFloor'); tag(hollowWallMesh, 'hollowWall');
            tag(hollowDomeMesh, 'hollowDome'); tag(hollowPropMesh, 'hollowProp');
            tag(hollowGlowMesh, 'hollowGlow'); tag(hollowPoolMesh, 'hollowPool'); });
  T(() => { tag(waveBowMesh, 'waveBow'); });
  T(() => { tag(bayWaterMesh, 'bayWater'); tag(seaGlintMesh, 'seaGlint');
            tag(swellLineMesh, 'swellLine'); tag(seaFarMesh, 'seaFar'); tag(foamFrontMesh, 'foamFront'); });
  T(() => { tag(skyGrp, 'sky'); });
  T(() => { tag(psSpark.pts, 'psSpark'); tag(psDust.pts, 'psDust'); tag(psSparkle.pts, 'psSparkle');
            if (psShimmer) tag(psShimmer.pts, 'psShimmer'); });
  T(() => { tag(domeMesh, 'grottoDome'); tag(grottoCapMesh, 'grottoCap'); tag(pstageMesh, 'pstage'); });
  T(() => { tag(interiorMesh, 'interior'); tag(interiorGlow, 'interiorGlow'); });
  T(() => { for (const R of ROOMS) { tag(R.mesh, 'room'); tag(R.glow, 'roomGlow'); for (const v of R.vis) tag(v, 'roomVis'); } });
  T(() => { tag(mirror.group, 'mirror'); tag(beamDown, 'beamDown'); tag(beamOut, 'beamOut');
            tag(entGlow, 'entGlow'); tag(corridorGlow, 'corridorGlow'); });
  T(() => { tag(chest.group, 'chest'); tag(doorChest.group, 'doorChest'); tag(wheelRing, 'wheelRing'); tag(tidewater, 'tidewater'); });
  T(() => { tag(millChest.group, 'millChest'); tag(ferryChest.group, 'ferryChest');
            tag(fgrottoChest.group, 'fgrottoChest'); tag(cedarChest.group, 'cedarChest'); });
  T(() => { tag(BOSS.c.root, 'boss'); });
  T(() => { tag(moonfish, 'moonfish'); tag(crescentItem, 'crescent'); tag(shieldItem, 'shield'); });
  T(() => { tag(pearlBoat, 'pearlBoat'); tag(pearlStar, 'pearlStar'); tag(tockPend, 'tockPend'); });
  T(() => { tag(wakeWreckMesh, 'wakeWreck'); tag(poolMesh, 'pool'); });
  T(() => { tag(cartNewLine, 'cartNewLine'); });
  T(() => { tag(sunLight, 'sunLight'); tag(hemiLight, 'hemiLight'); });
  T(() => { tag(window.__springsMesh, 'springsMesh'); });
  T(() => { tag(seaLine, 'seaLine'); });
  T(() => { for (const b of bayBoats) tag(b.mesh, 'bayBoat'); });
  T(() => { tag(sailboat.group, 'sailboat'); });
  T(() => { tag(psSpray.pts, 'psSpray'); });
  T(() => { tag(glyphDoor1.group, 'glyphDoor1'); tag(glyphDoor2.group, 'glyphDoor2'); });
  T(() => { tag(hm1.group, 'hm1'); tag(hm2.group, 'hm2'); tag(hmRelay.group, 'hmRelay'); tag(hBeamR, 'hBeamR'); });
  T(() => { tag(hollowChest.group, 'hollowChest'); });
  T(() => { for (const HM of HMIRRORS) tag(HM.beam, 'hmBeam'); });
  T(() => { tag(WYRM.c.root, 'wyrm'); tag(WYRM.c.wakeRoot, 'wyrmWake'); });
  T(() => { for (const d of WYRM.devils) tag(d.m.root, 'dustDevil'); });
  T(() => { tag(fallsMesh, 'fallsMesh2'); });
  // whatever is left: name it by its owner chain / index so the dump is legible
  let n = 0;
  scene.traverse(o => { if ((o.isMesh || o.isPoints) && !o.name) o.name = 'UNNAMED#' + (n++); });
  return 'tagged; residual unnamed=' + n + (errs.length ? '; ERRS: ' + errs.join(' | ') : '');
})();`;

const CENSUS_SRC = `(function(){
  const frustum = new THREE.Frustum();
  const m4 = new THREE.Matrix4();
  const wp = new THREE.Vector3();
  window.__censusNow = function(){
    camera.updateMatrixWorld();
    m4.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustum.setFromProjectionMatrix(m4);
    const out = [];
    (function walk(o){
      if (!o.visible) return;
      if (o.isMesh || o.isPoints || o.isLine || o.isSprite){
        let inF = true;
        if (o.frustumCulled !== false){
          try { inF = frustum.intersectsObject(o); } catch(e){ inF = true; }
        }
        if (inF){
          const g = o.geometry;
          let tris = 0, verts = 0;
          if (g){
            const idx = g.index, pos = g.getAttribute('position');
            verts = pos ? pos.count : 0;
            tris = Math.floor((idx ? idx.count : verts) / 3);
          }
          o.getWorldPosition(wp);
          const calls = (Array.isArray(o.material) && g && g.groups.length) ? g.groups.length : 1;
          out.push({ n: o.name || '', ty: o.type, tris, verts, calls,
            fc: o.frustumCulled ? 1 : 0,
            x: +wp.x.toFixed(0), y: +wp.y.toFixed(1), z: +wp.z.toFixed(0),
            mat: Array.isArray(o.material) ? 'multi' : (o.material && o.material.type || '') });
        }
      }
      for (const ch of o.children) walk(ch);
    })(scene);
    return out;
  };
  window.__worst = { calls: 0, at: '', snap: null };
  window.__worstArm = false;
  (function w(){
    requestAnimationFrame(w);
    const T = window.__fm; if (!T || !window.__worstArm) return;
    if (T.state === 'play' && T.calls > __worst.calls){
      __worst.calls = T.calls;
      __worst.at = T.x.toFixed(1) + ',' + T.z.toFixed(1) + ' yaw' + T.camYaw.toFixed(2) +
        ' (' + (T.camYaw * 180 / Math.PI).toFixed(0) + 'deg) pst:' + T.pst;
      __worst.snap = __censusNow();
    }
  })();
})();`;

const { srv, port: httpPort } = await serve();
const { proc, port } = await launchChrome();
const c = await pageSession(port);
await c.send('Page.enable'); await c.send('Runtime.enable');
// controller.js fetch intercept
await c.send('Fetch.enable', { patterns: [{ urlPattern: '*controller.js*' }] });
const wsHandler = c.ws.onmessage;
c.ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.method === 'Fetch.requestPaused') {
    c.send('Fetch.fulfillRequest', {
      requestId: m.params.requestId, responseCode: 200,
      responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' }],
      body: Buffer.from(CONTROLLER_JS).toString('base64'),
    }).catch(() => {});
    return;
  }
  wsHandler(ev);
};
await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PAD_STUB });
await c.send('Page.addScriptToEvaluateOnNewDocument', {
  source: `try{ localStorage.setItem('fallenmoon_save_v1', ${JSON.stringify(JSON.stringify(FOREST_SAVE))}); }catch(e){}` });
const evl = async (expr) => {
  const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 600));
  return r.result.value;
};
const waitFor = async (expr, timeout = 25000, label = expr) => {
  const t0 = Date.now();
  while (Date.now() - t0 < timeout) {
    if (await evl(expr)) return true;
    await sleep(60);
  }
  throw new Error('timeout: ' + label);
};
const shot = async (name) => {
  const r = await c.send('Page.captureScreenshot', { format: 'png' });
  const f = path.join(SHOTS, name + '.png');
  fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
  console.log('shot →', f);
  return f;
};
const dumpSnap = (snap, label) => {
  console.log(`\n── census @ ${label}: ${snap.length} objects, ` +
    snap.reduce((a, o) => a + o.calls, 0) + ' est calls, ' +
    snap.reduce((a, o) => a + o.tris, 0) + ' tris ──');
  const hist = new Map();
  for (const o of snap) {
    const k = o.n.replace(/#\d+$/, '#N');
    const e = hist.get(k) || { n: 0, tris: 0 };
    e.n++; e.tris += o.tris; hist.set(k, e);
  }
  console.log('  ── by name ──');
  for (const [k, e] of [...hist].sort((a, b) => b[1].n - a[1].n)) {
    console.log(`    ${k.padEnd(24)} calls=${String(e.n).padEnd(4)} tris=${e.tris}`);
  }
  const sorted = [...snap].sort((a, b) => b.tris - a.tris);
  console.log('  ── detail ──');
  for (const o of sorted) {
    console.log(`  ${(o.n || '(unnamed)').padEnd(28)} ${o.ty.padEnd(6)} tris=${String(o.tris).padEnd(6)} ` +
      `calls=${o.calls} fc=${o.fc} @${o.x},${o.y},${o.z} ${o.mat}`);
  }
};

const POINT = process.argv[2] ? process.argv[2].split(',').map(Number) : [1826, 1076];
const [PX, PZ] = POINT;

try {
  await c.send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/` });   // REAL TIME like fperf
  await waitFor('!!window.__fm', 30000, 'telemetry');
  await waitFor(`__fm.state === 'title'`, 25000, 'title');
  for (let i = 0; i < 10 && !(await evl('__fm.titleFocus === 1')); i++) {
    await evl('__fakePad.press(13)'); await sleep(200); await evl('__fakePad.press()'); await sleep(150);
  }
  for (let i = 0; i < 12 && (await evl(`__fm.state === 'title'`)); i++) {
    await evl('__fakePad.press(0)'); await sleep(200); await evl('__fakePad.press()'); await sleep(150);
  }
  await waitFor(`__fm.state === 'play'`, 25000, 'play');
  await evl(BOT_SRC);
  await evl(`__fmBot.mode='pad'`);
  /* ── STUN mode: prove the boar tree-stun deterministically, N trials ── */
  if (process.env.STUN) {
    const N = +process.env.STUN || 5;
    await evl(`window.__fmTurbo = 2`);
    await evl(STUN_STAGE);
    const pump = setInterval(() => { evl('P.hearts = P.maxHearts; swelterT = 0; 0').catch(() => {}); }, 3000);
    let pass = 0;
    for (let i = 0; i < N; i++) {
      const stage = await evl('__stageStun()');
      if (!stage.ok) { console.log(`trial ${i + 1}: STAGE FAILED ${JSON.stringify(stage)}`); continue; }
      try {
        await waitFor(`BOARS[__stunTrial.k].st === 'paw'`, 30000, 'paw');
        await waitFor(`BOARS[__stunTrial.k].st === 'charge'`, 20000, 'charge');
        await evl(`__fmBot.tol = 0.5; __fmBot.target =
          [__stunTrial.lane.px - __stunTrial.lane.uz * 5, __stunTrial.lane.pz + __stunTrial.lane.ux * 5]`);
        await waitFor('!!window.__stunProof', 20000, 'stun');
      } catch (e) { /* reported below */ }
      await evl('__fmBot.target = null; 0');
      const proof = await evl('window.__stunProof');
      const ok = !!proof && proof.stunned && proof.onTrunk && !proof.prop;
      if (ok) pass++;
      console.log(`trial ${i + 1}: lane ${stage.laneDeg}° pine(${stage.trunk.x},${stage.trunk.z}) ` +
        `${ok ? 'STUN ON THE PINE' : 'FAILED'} ${JSON.stringify(proof)}`);
      await evl('window.__stunProof = { done: 1 }; 0');
      await sleep(400);
    }
    clearInterval(pump);
    console.log(`STUN PROBE: ${pass}/${N} trials stunned on the named pine`);
    c.close(); proc.kill(); srv.close();
    process.exit(pass === N ? 0 : 1);
  }

  console.log('tagger:', await evl(TAG_SRC));
  console.log('residual unnamed meshes:', JSON.stringify(await evl(`(function(){
    const out = [];
    scene.traverse(o => {
      if (!(o.isMesh || o.isPoints) || !/^UNNAMED#/.test(o.name)) return;
      const g = o.geometry; if (!g.boundingBox) g.computeBoundingBox();
      const bb = g.boundingBox, p = g.getAttribute('position');
      out.push({ n: o.name, tris: Math.floor((g.index ? g.index.count : p.count) / 3),
        min: [bb.min.x, bb.min.y, bb.min.z].map(v => +v.toFixed(1)),
        max: [bb.max.x, bb.max.y, bb.max.z].map(v => +v.toFixed(1)),
        vis: o.visible, fc: o.frustumCulled, mat: o.material.type });
    });
    return out; })()`), null, 1));
  await evl(CENSUS_SRC);

  // ── replicate the fperf sweep at the point ──
  await evl(`__fmDebug.warp(${PX}, ${PZ})`);
  await evl('P.hearts = P.maxHearts; swelterT = 0; 0');
  await sleep(600);
  await evl(`__worst.calls = 0; __worst.snap = null; __worstArm = true; 0`);
  await evl('__fakePad.raxes(0.85, 0.25)');
  await sleep(2600);
  await evl('__fakePad.raxes(0, -0.4)');
  await sleep(900);
  await evl('__fakePad.raxes(0, 0)');
  await evl('__fakePad.press(1)');
  await evl(`__fmBot.tol=1.2; __fmBot.target=[${PX + 14}, ${PZ + 6}]`);
  await sleep(2600);
  await evl('__fakePad.press()');
  await evl('__fmBot.target=null; 0');

  /* ── the DISCRETE sweep the fperf suite now runs: 12 azimuths × 2 pitches,
     STANDING at the walk's end point. This is where the hollow's true worst
     frame lives — the free orbit skated past it. Census EVERY view. ── */
  const views = [];
  for (let a = 0; a < 12; a++) {
    const yaw = (a / 12) * Math.PI * 2 - Math.PI;
    for (const pitch of [-0.05, 0.34]) {
      await evl(`__fmDebug.camYaw(${yaw.toFixed(4)}); __fmDebug.camPitch(${pitch}); 0`);
      await sleep(220);
      const calls = await evl('__fm.calls');
      const snap = await evl('__censusNow()');
      views.push({ yaw: +yaw.toFixed(2), pitch, calls, snap,
        at: await evl('__fm.x.toFixed(0) + "," + __fm.z.toFixed(0)') });
    }
  }
  await evl('__worstArm = false; 0');
  console.log('bay-cull live check:', JSON.stringify(await evl(`({
    camx: +camera.position.x.toFixed(0), camz: +camera.position.z.toFixed(0),
    boats: bayBoats.map(b => b.mesh.visible), pool: poolMesh && poolMesh.visible,
    wreck: wakeWreckMesh.visible, dome: grottoDomeMesh && grottoDomeMesh.visible,
    hornetShadows: HORNETS.map(h => h.m.shadow.visible),
  })`)));
  views.sort((a, b) => b.calls - a.calls);
  console.log('\n══ DISCRETE SWEEP at the walk end point — calls per view ══');
  for (const v of views) console.log(`  yaw ${String(v.yaw).padStart(6)} pitch ${String(v.pitch).padStart(5)}  calls=${v.calls}  @${v.at}`);
  for (const v of views.slice(0, 3)) dumpSnap(v.snap, `view yaw ${v.yaw} pitch ${v.pitch} @${v.at} (renderer ${v.calls})`);
  // the lead's failing pose and its neighbours, explicitly
  for (const y of [0.52, 1.05, 1.57]) {
    for (const v of views.filter(v2 => Math.abs(v2.yaw - y) < 0.01)) {
      const hist = new Map();
      for (const o of v.snap) {
        const k = o.n.replace(/#\d+$/, '#N');
        hist.set(k, (hist.get(k) || 0) + o.calls);
      }
      console.log(`\n  yaw ${v.yaw} pitch ${v.pitch} → ${v.calls} calls :: ` +
        [...hist].sort((a, b) => b[1] - a[1]).map(([k, n]) => `${k}=${n}`).join(' '));
    }
  }

  /* ── A/B: does the fog-wall far-tile cull change a single pixel? ──
     Toggling is done by inflating each tile's cached bounding radius, which
     disables ONLY the pastFog term and leaves fog/geometry/anim identical. */
  if (process.env.FOGAB) {
    /* EXACT diff: render the 3-D scene to an offscreen target and read the
       pixels back. No DOM, no HUD, no compositor — two renders of identical
       state are bit-identical, so any difference IS the cull. */
    await evl(`(function(){
      const W = 640, H = 360;
      const rt = new THREE.WebGLRenderTarget(W, H);
      const buf = new Uint8Array(W * H * 4);
      window.__abShot = function(){
        const prev = renderer.getRenderTarget();
        renderer.setRenderTarget(rt);
        renderer.render(scene, camera);
        renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
        renderer.setRenderTarget(prev);
        return Array.from(buf);
      };
      window.__abDiff = function(a, b){
        let maxd = 0, over0 = 0, over2 = 0, sum = 0;
        for (let i = 0; i < a.length; i += 4){
          const d = Math.max(Math.abs(a[i]-b[i]), Math.abs(a[i+1]-b[i+1]), Math.abs(a[i+2]-b[i+2]));
          if (d > maxd) maxd = d;
          if (d > 0) over0++;
          if (d > 2) over2++;
          sum += d;
        }
        return { maxDiff: maxd, pixelsChanged: over0, pixelsOver2: over2, meanDiff: +(sum/(a.length/4)).toFixed(4) };
      };
    })(); 'ok'`);
    const grab = async () => evl('window.__abLast = __abShot(), 1');
    await evl(`__fmDebug.warp(${PX}, ${PZ}); 0`);
    // quiet the scene: a frozen sim + no player/creature/particle motion, so
    // the only thing that can move a pixel is the far tier itself
    await evl(`__fmDebug.freeze(1); wick.root.visible = false; wickShadow.visible = false;
      for (const h of HORNETS) h.m.root.visible = false;
      for (const b of BOARS) b.c.root.visible = false;
      psSpark.pts.visible = false; psDust.pts.visible = false; psSparkle.pts.visible = false;
      if (psShimmer) psShimmer.pts.visible = false; 0`);
    await sleep(900);
    let worstPix = 0;
    for (let a = 0; a < 32; a++) {
      const yaw = ((a >> 1) / 16) * Math.PI * 2 - Math.PI;
      const pitch = (a & 1) ? 0.34 : -0.05;
      await evl(`__fmDebug.camYaw(${yaw.toFixed(4)}); __fmDebug.camPitch(${pitch}); 0`);
      await sleep(400);
      // cull ACTIVE — two back-to-back renders establish the (zero) noise floor
      const dNoise = await evl('(function(){ const a = __abShot(), b = __abShot(); return __abDiff(a,b); })()');
      // cull DISABLED — inflating the cached radius kills ONLY the pastFog
      // term. Split tiles vs megas: unculling a MEGA also re-hides the ring
      // tiles it covers, so a combined toggle measures that swap too.
      const ab = async (sel) => evl(`(function(){
        // pin the clock: cullChunks re-poses hornets/glows from performance.now(),
        // which would otherwise swamp the far-tier signal with wing flap
        const _now = performance.now.bind(performance), _t = _now();
        performance.now = () => _t;
        try {
        cullChunks(camera.position.x, camera.position.z);
        const a = __abShot();
        const pick = farTiles.filter(${sel});
        const save = pick.map(f => f.br);
        for (const f of pick) f.br = 1e9;
        cullChunks(camera.position.x, camera.position.z);
        const b = __abShot();
        pick.forEach((f,i) => { f.br = save[i]; });
        cullChunks(camera.position.x, camera.position.z);
        return __abDiff(a,b);
        } finally { performance.now = _now; }
      })()`);
      const dTiles = await ab('f => !f.actR');
      const dMegas = await ab('f => !!f.actR');
      const dCull = await ab('f => true');
      const vis = await evl('farTiles.filter(f=>f.mesh.visible).length');
      if (dTiles.pixelsChanged > worstPix) worstPix = dTiles.pixelsChanged;
      console.log(`  yaw ${(yaw * 180 / Math.PI).toFixed(0).padStart(5)}° pitch ${pitch} vis=${vis}` +
        ` noise=${dNoise.pixelsChanged} TILES=${dTiles.pixelsChanged}/${dTiles.maxDiff}` +
        ` MEGAS=${dMegas.pixelsChanged}/${dMegas.maxDiff} BOTH=${dCull.pixelsChanged}/${dCull.maxDiff}`);
    }
    console.log(`FOG-WALL CULL A/B: worst pixelsChanged over 32 views = ${worstPix} / 230400`);
    // paint the worst view's difference so it can actually be LOOKED at
    await evl(`__fmDebug.camYaw(${(67 / 180 * Math.PI).toFixed(4)}); __fmDebug.camPitch(0.34); 0`);
    await sleep(500);
    const png = await evl(`(function(){
      const W = 640, H = 360;
      const _now = performance.now.bind(performance), _t = _now();
      performance.now = () => _t;
      cullChunks(camera.position.x, camera.position.z);
      const a = __abShot();
      const save = farTiles.map(f => f.br);
      for (const f of farTiles) f.br = 1e9;
      cullChunks(camera.position.x, camera.position.z);
      const b = __abShot();
      farTiles.forEach((f,i) => { f.br = save[i]; });
      cullChunks(camera.position.x, camera.position.z);
      const cv = document.createElement('canvas'); cv.width = W; cv.height = H * 3 + 8;
      const cx = cv.getContext('2d');
      cx.fillStyle = '#f0f'; cx.fillRect(0, 0, cv.width, cv.height);
      const put = (arr, oy) => {
        const im = cx.createImageData(W, H);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
          const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4;
          im.data[d] = arr[s]; im.data[d+1] = arr[s+1]; im.data[d+2] = arr[s+2]; im.data[d+3] = 255;
        }
        cx.putImageData(im, 0, oy);
      };
      put(a, 0); put(b, H + 4);
      const im = cx.createImageData(W, H);
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const s = ((H - 1 - y) * W + x) * 4, d = (y * W + x) * 4;
        const df = Math.max(Math.abs(a[s]-b[s]), Math.abs(a[s+1]-b[s+1]), Math.abs(a[s+2]-b[s+2]));
        im.data[d] = df ? 255 : 0; im.data[d+1] = df ? 255 - Math.min(255, df) : 0;
        im.data[d+2] = 0; im.data[d+3] = 255;
      }
      cx.putImageData(im, 0, H * 2 + 8);
      performance.now = _now;
      return cv.toDataURL('image/png').slice('data:image/png;base64,'.length);
    })()`);
    fs.writeFileSync(path.join(SHOTS, 'fogcull-ab.png'), Buffer.from(png, 'base64'));
    console.log('A/B image (cull / no-cull / diff) →', path.join(SHOTS, 'fogcull-ab.png'));
    await evl(`__fmDebug.freeze(0); wick.root.visible = true; wickShadow.visible = true; 0`);
    await evl('__fmDebug.camOff && __fmDebug.camOff(); 0').catch(() => {});
  }

  // far-tier fog audit: which visible far tiles sit entirely past the fog wall?
  const fogAudit = await evl(`(function(){
    const cc = camera.position; let past = 0, near = 0, minPast = 1e9;
    for (const ft of farTiles){
      if (!ft.mesh.visible) continue;
      const g = ft.mesh.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const bs = g.boundingSphere;
      const d = Math.hypot(bs.center.x - cc.x, bs.center.z - cc.z) - bs.radius;
      if (d > scene.fog.far) { past++; if (d < minPast) minPast = d; } else near++;
    }
    const noCache = farTiles.filter(f => !f.actR && f.br === undefined).length;
    return { visible: past + near, pastFog: past, nearest_past: past ? +minPast.toFixed(0) : null,
             fogFar: +scene.fog.far.toFixed(0), tilesMissingBR: noCache,
             camX: +cc.x.toFixed(0), camZ: +cc.z.toFixed(0), FOGFfar: FOGF.far };
  })()`);
  console.log('far-tier fog audit:', JSON.stringify(fogAudit));

  const worst = await evl('({calls: __worst.calls, at: __worst.at})');
  console.log(`WORST WALKED FRAME: ${worst.calls} calls @ ${worst.at}`);
  const snap = await evl('__worst.snap');
  if (snap) dumpSnap(snap, 'worst walked frame ' + worst.at);
  await shot(`census-${PX}-${PZ}`);

  // ── static standing census at the same spot for the diff ──
  await evl(`__fmDebug.warp(${PX}, ${PZ}); 0`);
  await sleep(800);
  const stat = await evl('__censusNow()');
  const statCalls = await evl('__fm.calls');
  dumpSnap(stat, `static stand @${PX},${PZ} (renderer says ${statCalls})`);
} catch (e) {
  console.error('PROBE FAIL:', e.message);
  await shot('probe-FAIL').catch(() => {});
} finally {
  c.close(); proc.kill(); srv.close();
}
