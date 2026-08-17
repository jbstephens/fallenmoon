#!/usr/bin/env node
// Field-bug diagnostic for John's two reports:
//   A) how Wick rides in the pilotable boat ("the boat seems to be sideways")
//   B) the rendering of the Falls Hollow opening ("weirdness we've seen before")
// Reuses the harness's Chrome plumbing. Diagnosis only — writes to shots-diag/.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const GAME = process.env.FMDIR || '/Users/johnstephens/Developer/stephensgames/fallenmoon';
const SHOTS = path.join(DIR, 'shots-sea');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CONTROLLER_JS = fs.readFileSync('/Users/johnstephens/Developer/stephensgames/gameconsole/lib/controller.js', 'utf8');
const HARNESS_SRC = fs.readFileSync('/Users/johnstephens/Developer/stephensgames/fallenmoon/test/harness.mjs', 'utf8');
const BOT_SRC = HARNESS_SRC.match(/const BOT_SRC = `([\s\S]*?)`;\n/)[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));
const PAGE_ERRS = [];

const FAMILY_Q4 = JSON.parse(fs.readFileSync('/Users/johnstephens/Developer/stephensgames/fallenmoon/test/fixtures/family-q4-save.json', 'utf8'));
const N2_FLOODED = {
  ...FAMILY_Q4, basinOpen: true, glyph1: true, glyph2: true, wyrmDone: true,
  q: 6, ph: 2, sky: 2, floodSeen: true, voyageDone: true, sailedOnce: true,
  region: 'bay', lastShade: [4, -2],
};
const N2_HOLLOW = { ...FAMILY_Q4, basinOpen: true, lastShade: [1908, 1170] };

function serve() {
  const srv = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    const f = path.join(GAME, p === '/' ? 'index.html' : p);
    if (!f.startsWith(GAME) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}
async function launchChrome() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-diag-'));
  process.on('exit', () => { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e) {} });
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
    let id = 0; const pending = new Map();
    ws.onopen = () => resolve({
      send(method, params = {}) {
        return new Promise((res2, rej2) => {
          const mid = ++id; pending.set(mid, { res2, rej2 });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      close() { ws.close(); },
    });
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.method === 'Runtime.exceptionThrown') {
        const d = m.params.exceptionDetails;
        PAGE_ERRS.push((d.exception && d.exception.description ? d.exception.description.split('\n')[0] : d.text));
      }
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

function mkApi(c) {
  const api = {
    async init() {
      await c.send('Page.enable'); await c.send('Runtime.enable');
      await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PAD_STUB });
      await c.send('Page.addScriptToEvaluateOnNewDocument', { source: CONTROLLER_JS });
    },
    async seedSave(save) {
      await c.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `try{localStorage.setItem('fallenmoon_save_v1', ${JSON.stringify(JSON.stringify(save))});}catch(e){}`,
      });
    },
    async nav(url) { await c.send('Page.navigate', { url }); await sleep(2500); },
    async eval(expr) {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(expr.slice(0, 80) + ' → ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, timeout = 20000, label = expr) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        try { if (await api.eval(expr)) return true; } catch (e) {}
        await sleep(120);
      }
      throw new Error('timeout waiting for ' + label);
    },
    async waitTicks(n) {
      const t = await api.eval('__fm.tick');
      await api.waitFor(`__fm.tick > ${t + n}`, 30000, `${n} ticks`);
    },
    async tap(...idx) {
      await api.eval(`__fakePad.press(${idx.join(',')})`); await sleep(90);
      await api.eval('__fakePad.press()'); await sleep(90);
    },
    async shot(name) {
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(SHOTS, name + '.png');
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      console.log('   shot → ' + f);
    },
    async installBot(mode) { await api.eval(BOT_SRC.replace(/\$\{mode\}/g, mode)); },
  };
  return api;
}
async function tapUntil(api, fn, cond, tries, label) {
  for (let i = 0; i < tries; i++) {
    try { if (await api.eval(cond)) return true; } catch (e) {}
    await fn(); await sleep(150);
  }
  if (await api.eval(cond)) return true;
  throw new Error('tapUntil failed: ' + label);
}
async function continueIn(api) {
  await api.waitFor(`__fm.state === 'title'`, 30000, 'title');
  await sleep(600);
  for (let i = 0; i < 20 && !(await api.eval('__fm.titleFocus === 1')); i++) { await api.tap(13); await sleep(320); }
  for (let i = 0; i < 20 && (await api.eval(`__fm.state === 'title'`)); i++) { await api.tap(0); await sleep(380); }
  await api.waitFor(`__fm.state === 'play'`, 30000, 'playing');
  await sleep(600);
}


const FLOODED = JSON.parse(fs.readFileSync(path.join(DIR, 'flooded.json'), 'utf8'));
const REFIT = JSON.parse(fs.readFileSync(path.join(DIR, 'refit.json'), 'utf8'));

async function boot(base, save, turbo = 6) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = mkApi(c);
  await api.init();
  await api.seedSave(save);
  await api.nav(base + '/?turbo=' + turbo);
  await continueIn(api);
  await api.installBot('pad');
  api.__close = () => { c.close(); proc.kill(); };
  return api;
}
/* a still: park the camera, look at a bearing, shoot */
async function still(api, name, x, z, yaw, pitch, opts) {
  const o = opts || {};
  if (o.sail) await api.eval(`__fmDebug.warpSea(${x}, ${z}${o.ang !== undefined ? ', ' + o.ang : ''}); 0`);
  else await api.eval(`P.sailing = false; sailboatColl.off = false; __fmDebug.warp(${x}, ${z}); P.fy = supportYAt(${x}, ${z}, 99); 0`);
  await api.eval(`P.hearts = P.maxHearts; CAM.yaw = ${yaw}; CAM.pitch = ${pitch === undefined ? 0.3 : pitch}; CAM.ready = false; 0`);
  await api.waitTicks(8);
  await sleep(500);
  const rep = await api.eval(`JSON.stringify({ x:+__fm.x.toFixed(0), z:+__fm.z.toFixed(0), calls:__fm.calls, tris:__fm.tris,
     gy:+groundH(__fm.x,__fm.z).toFixed(2), fy:+__fm.fy.toFixed(2), depth:+waterDepthAt(__fm.x,__fm.z).toFixed(2),
     seaChunks:__fm.seaChunksVis, region:__fm.seaRegion })`);
  console.log('   ' + name + ': ' + rep);
  await api.shot(name);
  return JSON.parse(rep);
}

/* ═══ A: THE HARBOUR GAP + THE CROSSING LANE (structural) ═══ */
async function diagGap(base) {
  console.log('\n=== A. THE HARBOUR GAP ===');
  const api = await boot(base, FLOODED);
  // from the bay, looking west at the gap
  await api.eval('__fmDebug.warpSea(-40, 34, -1.57); 0');
  for (const [nm, x, z, yaw] of [
    ['gap-1-from-bay', -40, 34, -1.57],
    ['gap-2-mouth', -85, 34, -1.57],
    ['gap-3-in-the-gap', -104, 34, -1.57],
    ['gap-4-outside-looking-back', -150, 30, 1.57],
    ['gap-5-open-sea', -320, 0, -1.9],
  ]) await still(api, nm, x, z, yaw, 0.18, { sail: true, ang: yaw + Math.PI });
  // the walked/sailed truth: depth along the lane, and the hull's clearance
  const rep = await api.eval(`(function(){
    const pts=[]; for (let t=0;t<=1.0001;t+=0.05) {
      const x = -70 + (-980 + 70)*t, z = 40 + (-210-40)*t;
      pts.push([Math.round(x), Math.round(z), +waterDepthAt(x,z).toFixed(2), worldSolidAt(x,z)]);
    }
    return JSON.stringify({ minDepth: Math.min(...pts.map(p=>p[2])), solids: pts.filter(p=>p[3]).length,
      shallow: pts.filter(p=>p[2] < 0.6).map(p=>[p[0],p[1],p[2]]) });
  })()`);
  console.log('   crossing lane: ' + rep);
  console.log('   page errors: ' + JSON.stringify(PAGE_ERRS.slice(0, 4)));
  api.__close();
}

/* ═══ B: THE ISLES (a still at each landfall + the campanile from afar) ═══ */
async function diagIsles(base) {
  console.log('\n=== B. THE ISLES ===');
  const api = await boot(base, REFIT);
  const spots = [
    ['isle-1-watchstone-approach', -880, -150, -2.2, 0.12, true],
    ['isle-2-jetty', -930, -175, -2.2, 0.16, true],
    ['isle-3-watchstone-bell', -974, -216, 0.9, 0.22, false],
    ['isle-4-watch-tower', -950, -200, -0.6, 0.34, false],
    ['isle-5-campanile-far', -1150, -260, -2.35, 0.30, true],
    ['isle-6-kiln-shore', -1450, -300, -2.6, 0.16, true],
    ['isle-7-foundry-door', -1520, -338, 3.14, 0.20, false],
    ['isle-8-drowned-spire', -1150, -620, -2.0, 0.14, true],
    ['isle-9-netmender', -800, -500, 2.4, 0.20, false],
    ['isle-10-gannet', -1700, -110, -1.7, 0.20, true],
    ['isle-11-strand', -2000, -690, -2.2, 0.16, true],
    ['isle-12-chime-reef', -1330, -40, -2.0, 0.12, true],
  ];
  for (const [nm, x, z, yaw, pitch, sail] of spots) {
    try { await still(api, nm, x, z, yaw, pitch, { sail, ang: yaw + Math.PI }); }
    catch (e) { console.log('   ' + nm + ' FAILED: ' + e.message); }
  }
  console.log('   page errors: ' + JSON.stringify(PAGE_ERRS.slice(0, 4)));
  api.__close();
}

/* ═══ C: THE DROWNED MOON (the reveal, frame by frame) ═══ */
async function diagMoon(base) {
  console.log('\n=== C. THE DROWNED MOON ===');
  const api = await boot(base, REFIT);
  await api.eval('__fmDebug.warpSea(-380, -20, -1.95); BOAT.ang = Math.atan2(-560+380, -60+20); 0');
  await api.eval('__fmBot.sprint(true); __fmBot.target = [-620, -110]; 0');
  await api.waitFor(`__fm.seaCine === 'crossing'`, 60000, 'the crossing fires').catch(e => console.log('   ' + e.message));
  const t0 = Date.now();
  let shots = 0;
  while (Date.now() - t0 < 26000) {
    const st = await api.eval(`JSON.stringify({ cin: __fm.cinId, t: +(__fm.cinT||0).toFixed(1), clar: __fm.waterClarity,
      moonVis: __fm.moonVis, calls: __fm.calls, tris: __fm.tris, mode: __fm.handoffMode, state: __fm.state })`);
    if (shots % 2 === 0) console.log('   ' + st);
    await api.shot('moon-' + String(shots).padStart(2, '0') + '-t' + JSON.parse(st).t);
    shots++;
    if (JSON.parse(st).state === 'play' && shots > 6) break;
    await sleep(250);
  }
  await api.eval('__fmBot.target = null; __fmBot.sprint(false); 0');
  console.log('   after: ' + await api.eval(`JSON.stringify({ moonSeen: __fm.moonSeen, sailing: __fm.sailing, mode: __fm.handoffMode, autorun: __fm.autorun, rumbles: __fm.handoffRumbles })`));
  await api.shot('moon-99-after-handoff');
  console.log('   page errors: ' + JSON.stringify(PAGE_ERRS.slice(0, 4)));
  api.__close();
}

/* ═══ D: THE BIG SETS + PERF UNDER FULL SAIL ═══ */
async function diagSets(base) {
  console.log('\n=== D. BIG SETS & PERF ===');
  const api = await boot(base, { ...REFIT, moonSeen: true });
  await api.eval('__fmDebug.warpSea(-600, -200, -1.6); 0');
  await api.eval('__fmBot.sprint(true); __fmBot.target = [-900, -320]; 0');
  await api.waitFor('__fm.boatSpd > 8.5', 40000, 'full double sail').catch(e => console.log('   ' + e.message));
  console.log('   top speed: ' + await api.eval('+__fm.boatSpd.toFixed(2)') + ' sails=' + await api.eval('__fm.sailCount'));
  // force a set and ride it bow-on
  await api.eval('__fmDebug.bigSetNow(); 0');
  let worst = { calls: 0, tris: 0 };
  for (let i = 0; i < 26; i++) {
    const st = await api.eval(`JSON.stringify({ on:__fm.setOn, u:__fm.setU, warned:__fm.setWarned, stalls:__fm.setStalls,
      keeps:__fm.setKeeps, spd:+__fm.boatSpd.toFixed(1), heave:__fm.boatHeave, pitch:__fm.boatPitch, roll:__fm.boatRoll,
      hearts:__fm.hearts, calls:__fm.calls, tris:__fm.tris })`);
    const j = JSON.parse(st);
    if (j.calls > worst.calls) worst = { calls: j.calls, tris: j.tris };
    if (i % 3 === 0) console.log('   ' + st);
    if (i >= 2 && i <= 8) await api.shot('set-1-crest-' + i);
    if (j.stalls + j.keeps > 0 && i < 24) { await api.shot('set-2-resolved'); break; }
    await sleep(700);
  }
  console.log('   worst frame while sailing: ' + JSON.stringify(worst));
  console.log('   hearts after the set: ' + await api.eval('__fm.hearts') + '/' + await api.eval('__fm.maxHearts'));
  await api.eval('__fmBot.target = null; __fmBot.sprint(false); 0');
  console.log('   page errors: ' + JSON.stringify(PAGE_ERRS.slice(0, 4)));
  api.__close();
}


/* ═══ E: THE WHOLE PATH, on real input ═══ */
async function diagJourney(base) {
  console.log('\n=== E. THE JOURNEY (real input) ===');
  const api = await boot(base, FLOODED, 8);
  const D = { confirm: () => api.tap(0) };
  const say = async (label, expr) => console.log('   ' + label + ': ' + await api.eval(expr));
  try {
    /* 1 — Finn starts the keel thread */
    await api.eval(`window.__topup = setInterval(() => { try { P.hearts = P.maxHearts; } catch (e) {} }, 900); 0`);
    await api.eval('__fmBot.tol = 1.6; __fmBot.target = [38.5, -11.5]');
    await api.waitFor('Math.hypot(__fm.x - 38.5, __fm.z + 11.5) < 2.6', 120000, 'walk to Finn');
    await api.waitFor(`__fm.prompt === 'talk'`, 20000, 'Finn prompt');
    await api.eval('__fmBot.target = null; 0');
    for (let i = 0; i < 10 && (await api.eval('__fm.quest')) < 7; i++) {
      await D.confirm(); await sleep(450);
      if (i % 3 === 0) console.log('     talk: ' + await api.eval(`JSON.stringify({state:__fm.state, dlg:__fm.dlg, line:__fm.dlgLine, q:__fm.quest, prompt:__fm.prompt, x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1)})`));
    }
    await say('after Finn, quest', '__fm.quest');
    /* 2 — board and sail to the drowned wreck */
    await api.eval('__fmBot.tol = 1.0; __fmBot.target = [7.4, 3.8]');
    for (let i = 0; i < 10 && !(await api.eval(`__fm.prompt === 'board'`)); i++) {
      await sleep(3000);
      await api.eval('P.hearts = P.maxHearts; 0');
      console.log('     walking home: ' + await api.eval(`JSON.stringify({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), prompt:__fm.prompt, hearts:__fm.hearts})`));
    }
    await api.waitFor(`__fm.prompt === 'board'`, 60000, 'board prompt');
    await api.eval('__fmBot.target = null; 0');
    await tapUntil(api, () => D.confirm(), '__fm.sailing === true', 8, 'aboard');
    await api.eval('__fmBot.tol = 2.0; __fmBot.target = [-46, 94]');
    for (let i = 0; i < 12 && !(await api.eval(`__fm.prompt === 'keel'`)); i++) {
      await sleep(4000);
      await api.eval('P.hearts = P.maxHearts; 0');
      console.log('     sailing to the wreck: ' + await api.eval(`JSON.stringify({bx:+__fm.boatX.toFixed(1), bz:+__fm.boatZ.toFixed(1), spd:+__fm.boatSpd.toFixed(1), ang:+__fm.boatAng.toFixed(2), prompt:__fm.prompt})`));
    }
    await api.waitFor(`__fm.prompt === 'keel'`, 30000, 'the keel prompt alongside');
    await api.eval('__fmBot.target = null; 0');
    await sleep(600);
    await api.shot('j-1-keel-prompt');
    /* 3 — step onto her deck and pry it free, on foot */
    await api.waitFor(`__fm.prompt === 'ashore' || __fm.prompt === 'keel'`, 20000, 'a prompt');
    if (await api.eval(`__fm.prompt === 'ashore'`)) {
      await tapUntil(api, () => D.confirm(), '__fm.sailing === false', 10, 'onto the deck');
      await api.eval(`__fmBot.tol = 0.8; __fmBot.target = [${-46.6}, ${96.2}]`);
      await api.waitFor(`__fm.prompt === 'keel'`, 60000, 'the keel prompt on deck');
      await api.eval('__fmBot.target = null; 0');
    }
    console.log('   at the keel: ' + await api.eval(`JSON.stringify({ x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), fy:+__fm.fy.toFixed(2), sailing:__fm.sailing })`));
    await D.confirm();
    await api.waitFor(`__fm.seaCine === 'keel'`, 10000, 'the keel beat');
    await sleep(1200);
    await api.shot('j-2-keel-pry');
    await api.waitFor('__fm.keelCarried === true', 20000, 'the keel is his');
    await say('quest after the keel', '__fm.quest');
    /* 4 — carry it home and fit it */
    if (!(await api.eval('__fm.sailing'))) {
      await api.eval('__fmBot.tol = 1.6; __fmBot.target = [-45, 92.7]');
      await api.waitFor(`__fm.prompt === 'board'`, 90000, 'board with the keel');
      await api.eval('__fmBot.target = null; 0');
      await tapUntil(api, () => D.confirm(), '__fm.sailing === true', 8, 'aboard with the keel');
    }
    await api.eval('__fmBot.tol = 2.4; __fmBot.target = [8.5, 6]');
    for (let i = 0; i < 12 && !(await api.eval(`__fm.prompt === 'ashore'`)); i++) {
      await sleep(4000);
      console.log('     sailing home: ' + await api.eval(`JSON.stringify({bx:+__fm.boatX.toFixed(1), bz:+__fm.boatZ.toFixed(1), spd:+__fm.boatSpd.toFixed(1), prompt:__fm.prompt, carry:__fm.keelCarried})`));
    }
    await api.waitFor(`__fm.prompt === 'ashore'`, 30000, 'ashore at home');
    await api.eval('__fmBot.target = null; 0');
    await tapUntil(api, () => D.confirm(), '__fm.sailing === false', 10, 'ashore at home');
    await api.eval('__fmBot.tol = 1.2; __fmBot.target = [9.0, -2.6]');
    for (let i = 0; i < 10 && !(await api.eval(`__fm.prompt === 'refitBoat'`)); i++) {
      await sleep(3000);
      console.log('     to the refit beach: ' + await api.eval(`JSON.stringify({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), carry:__fm.keelCarried, sailing:__fm.sailing, prompt:__fm.prompt, fy:+__fm.fy.toFixed(2)})`));
    }
    await api.waitFor(`__fm.prompt === 'refitBoat'`, 30000, 'the refit prompt');
    await api.eval('__fmBot.target = null; 0');
    await api.shot('j-3-refit-prompt');
    await D.confirm();
    await api.waitFor(`__fm.seaCine === 'refit'`, 10000, 'the refit');
    for (const t of [2500, 3000, 3000, 3000]) { await sleep(t); await api.shot('j-4-refit-' + t); }
    await api.waitFor('__fm.boatRefit === true', 25000, 'she is refit');
    await say('sails / quest', '__fm.sailCount + " / " + __fm.quest');
    await api.shot('j-5-refit-done');
    const bad0 = api.consoleBad;
    console.log('   console errors so far: ' + JSON.stringify(bad0.slice(0, 3)));
  } catch (e) {
    console.log('   JOURNEY FAILED: ' + e.message);
    await api.shot('j-FAIL').catch(() => {});
  }
  console.log('   page errors: ' + JSON.stringify(PAGE_ERRS.slice(0, 4)));
  api.__close();
}

/* ═══ F: LANDFALL, THE BELL, THE CHESTS, COMBAT, SUNSTRUCK ═══ */
async function diagIsleLife(base) {
  console.log('\n=== F. ISLE LIFE ===');
  const api = await boot(base, { ...REFIT, moonSeen: true }, 8);
  const D = { confirm: () => api.tap(0) };
  try {
    /* landfall by real sailing: from the gap to the jetty */
    await api.eval('__fmDebug.warpSea(-880, -150, -2.2); 0');
    await api.eval('__fmBot.tol = 3.0; __fmBot.target = [-931, -178]');
    await api.waitFor(`__fm.prompt === 'ashore'`, 120000, 'ashore at Watchstone');
    await api.eval('__fmBot.target = null; 0');
    await tapUntil(api, () => D.confirm(), '__fm.sailing === false', 10, 'onto the jetty');
    console.log('   landfall: ' + await api.eval(`JSON.stringify({ landfall: __fm.isleLandfall, quest: __fm.quest, fy: +__fm.fy.toFixed(2), isle: __fm.isleHere, caption: __fm.caption })`));
    await api.shot('f-1-landfall-jetty');
    /* the bell */
    await api.eval('__fmBot.tol = 1.3; __fmBot.target = [-976, -204]');
    for (let i = 0; i < 22 && !(await api.eval(`__fm.prompt === 'watchbell'`)); i++) {
      await sleep(3000);
      await api.eval('P.hearts = P.maxHearts; 0');
      console.log('     to the bell: ' + await api.eval(`JSON.stringify({x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), fy:+__fm.fy.toFixed(1), prompt:__fm.prompt})`));
    }
    await api.waitFor(`__fm.prompt === 'watchbell'`, 20000, 'the bell prompt');
    await api.eval('__fmBot.target = null; 0');
    await D.confirm();
    await api.waitFor(`__fm.seaCine === 'watchbell'`, 10000, 'the bell beat');
    await sleep(1800); await api.shot('f-2-bell');
    await api.waitFor('__fm.watchBell === true', 20000, 'the hour is struck');
    console.log('   bell: watchBell=' + await api.eval('__fm.watchBell') + ' foundrySealed=' + await api.eval('__fm.foundrySealed'));
    /* combat ashore: find a clapper crab and a gull */
    await api.eval('P.hearts = P.maxHearts; __fmBot.tol = 2.5; __fmBot.target = [__fm.nearCrabX, __fm.nearCrabZ]');
    await sleep(6000);
    for (let i = 0; i < 40; i++) {
      await api.eval('__fakePad.press(0)'); await sleep(90); await api.eval('__fakePad.press()'); await sleep(160);
      const st = await api.eval(`JSON.stringify({ crabs: __fm.crabsAlive, gulls: __fm.gullsAlive, popped: __fm.gullsPopped, d: +__fm.nearCrabDist.toFixed(1), hearts: __fm.hearts })`);
      if (i % 8 === 0) console.log('   swinging: ' + st);
      const j = JSON.parse(st);
      if (j.popped > 0 && j.crabs < 10) break;
      if (j.d > 4) await api.eval('__fmBot.target = [__fm.nearCrabX, __fm.nearCrabZ]');
    }
    await api.shot('f-3-combat-ashore');
    console.log('   after fighting: ' + await api.eval(`JSON.stringify({ crabs: __fm.crabsAlive, gullsPopped: __fm.gullsPopped, hearts: __fm.hearts })`));
    /* SUNSTRUCK AT SEA: wake at the last island, WITH the boat */
    await api.eval('__fmBot.target = null; 0');
    await api.eval('__fmDebug.warpSea(-700, -120, -2.0); 0');
    await sleep(700);
    await api.eval('P.hearts = 1; hurtPlayer(1, P.x + 2, P.z, null); 0');
    await sleep(3000);
    console.log('   sunstruck at sea → ' + await api.eval(`JSON.stringify({ state: __fm.state, x: +__fm.x.toFixed(0), z: +__fm.z.toFixed(0), sailing: __fm.sailing, boat: [+__fm.boatX.toFixed(0), +__fm.boatZ.toFixed(0)], hearts: __fm.hearts })`));
    await api.shot('f-4-sunstruck-wake');
    /* the spire chest, opened from the helm */
    await api.eval('__fmDebug.warpSea(-1163, -611, 3.6); 0');   // outside her broken arch
    await api.eval('__fmBot.tol = 2.0; __fmBot.target = [-1176, -631]');
    await sleep(9000);
    console.log('   at the arch: ' + await api.eval(`JSON.stringify({x:+__fm.boatX.toFixed(0), z:+__fm.boatZ.toFixed(0), prompt:__fm.prompt})`));
    await api.eval('__fmBot.tol = 1.6; __fmBot.target = [-1183, -643]');
    await api.waitFor(`__fm.prompt === 'ichest'`, 120000, 'the spire chest').catch(e => console.log('   ' + e.message));
    await api.eval('__fmBot.target = null; 0');
    await D.confirm();
    await sleep(1500);
    console.log('   spire chest: ' + await api.eval('__fm.spireChest'));
    await api.shot('f-5-spire-chest');
  } catch (e) {
    console.log('   ISLE LIFE FAILED: ' + e.message);
    await api.shot('f-FAIL').catch(() => {});
  }
  console.log('   page errors: ' + JSON.stringify(PAGE_ERRS.slice(0, 4)));
  api.__close();
}


/* ═══ G: THE REFIT, at real speed, looked at frame by frame ═══ */
async function diagRefit(base) {
  console.log('\n=== G. THE REFIT (turbo 1) ===');
  const api = await boot(base, { ...FLOODED, q: 8, keelFound: true, keelCarried: true }, 3);
  try {
    await api.eval('__fmDebug.warp(9.6, -3.4); P.hearts = P.maxHearts; 0');
    await api.waitFor(`__fm.prompt === 'refitBoat'`, 20000, 'the refit prompt');
    await api.eval('CAM.yaw = 0.4; CAM.pitch = 0.2; CAM.ready = false; 0');
    await sleep(600);
    await api.shot('g-0-prompt');
    for (let i = 0; i < 6 && !(await api.eval(`__fm.seaCine === 'refit'`)); i++) { await api.tap(0); await sleep(450); }
    await api.waitFor(`__fm.seaCine === 'refit'`, 8000, 'the refit');
    for (let i = 0; i < 10; i++) {
      const t = await api.eval('+(__fm.cinT||0).toFixed(1)');
      await api.shot('g-' + String(i + 1).padStart(2, '0') + '-t' + t);
      if (!(await api.eval(`__fm.seaCine === 'refit'`))) break;
      await sleep(1300);
    }
    console.log('   after: ' + await api.eval(`JSON.stringify({ refit: __fm.boatRefit, sails: __fm.sailCount, quest: __fm.quest })`));
    await api.eval('__fmDebug.warp(11, 1.5); CAM.yaw = 2.6; CAM.pitch = 0.16; CAM.ready = false; 0');
    await sleep(900);
    await api.shot('g-99-two-masts');
  } catch (e) { console.log('   REFIT FAILED: ' + e.message); await api.shot('g-FAIL').catch(() => {}); }
  console.log('   page errors: ' + JSON.stringify(PAGE_ERRS.slice(0, 4)));
  api.__close();
}


/* ═══ H: the ones I framed wrong the first time ═══ */
async function diagLook(base) {
  console.log('\n=== H. SECOND LOOK ===');
  const api = await boot(base, { ...REFIT, moonSeen: true, isleLandfall: true, watchBell: true }, 6);
  const at = (x, z, tx, tz) => Math.atan2(x - tx, z - tz);   // yaw that LOOKS at (tx,tz)
  const spots = [
    ['h-1-chime-reef', -1300, -10, -1350, -60, true],
    ['h-2-gannet-stack', -1660, -60, -1750, -120, true],
    ['h-3-bellwright', -812, -512, -815.4, -513.8, false],
    ['h-4-kiln-approach', -1400, -280, -1520, -404, true],
    ['h-5-watchstone-jetty', -900, -156, -960, -196, true],
    ['h-6-long-strand', -1980, -640, -2050, -700, true],
    ['h-7-spire', -1150, -600, -1180, -640, true],
  ];
  for (const [nm, x, z, tx, tz, sail] of spots) {
    try { await still(api, nm, x, z, at(x, z, tx, tz), 0.14, { sail, ang: at(x, z, tx, tz) + Math.PI }); }
    catch (e) { console.log('   ' + nm + ' FAILED: ' + e.message); }
  }
  console.log('   page errors: ' + JSON.stringify(PAGE_ERRS.slice(0, 4)));
  api.__close();
}

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
try {
  const which = process.argv[2] || 'gap';
  if (which === 'gap' || which === 'all') await diagGap(base);
  if (which === 'isles' || which === 'all') await diagIsles(base);
  if (which === 'moon' || which === 'all') await diagMoon(base);
  if (which === 'sets' || which === 'all') await diagSets(base);
  if (which === 'journey' || which === 'all') await diagJourney(base);
  if (which === 'life' || which === 'all') await diagIsleLife(base);
  if (which === 'refit' || which === 'all') await diagRefit(base);
  if (which === 'look' || which === 'all') await diagLook(base);
} catch (e) {
  console.error('DIAG ERROR: ' + e.message + '\n' + e.stack);
} finally { srv.close(); }
console.log('\ndone → ' + SHOTS);
process.exit(0);
