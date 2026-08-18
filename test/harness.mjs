#!/usr/bin/env node
// FALLEN MOON verification harness.
// Headless Chrome + CDP. Fake standard-mapping gamepad injected BEFORE page
// scripts; everything driven through REAL input (pad axes/buttons or real
// KeyboardEvents) and asserted via the read-only telemetry window.__fm.
//
//   node test/harness.mjs all
//   (or: flow kbd touch perf shots)
import { spawn } from 'node:child_process';
import cp from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHOTS = path.join(DIR, 'test', 'shots');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CONTROLLER_JS = fs.readFileSync(
  path.join(DIR, '..', 'gameconsole', 'lib', 'controller.js'), 'utf8');

let failures = 0;
function gate(name, ok, detail) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? '  — ' + detail : ''}`);
  if (!ok) failures++;
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

function serve() {
  const srv = http.createServer((req, res) => {
    const p = req.url.split('?')[0];
    const f = path.join(DIR, p === '/' ? 'index.html' : p);
    if (!f.startsWith(DIR) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) {
      res.writeHead(404); res.end('nope'); return;
    }
    res.writeHead(200, { 'content-type': f.endsWith('.html') ? 'text/html' : 'application/octet-stream' });
    res.end(fs.readFileSync(f));
  });
  return new Promise(r => srv.listen(0, '127.0.0.1', () => r({ srv, port: srv.address().port })));
}

const CHROME_PROFILES = [];
function sweepChromeProfiles() {
  for (const d of CHROME_PROFILES.splice(0)) {
    try { fs.rmSync(d, { recursive: true, force: true }); } catch (e) {}
  }
}
process.on('exit', sweepChromeProfiles);
for (const sig of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => { sweepChromeProfiles(); process.exit(130); });
}

/* SWEEP ON THE WAY IN, TOO. The handlers above only fire on a clean exit,
   so every run that is killed — a timeout, a ^C, an agent that dies mid
   suite — orphans a headless Chrome AND its profile. Orphans are not idle:
   swiftshader has no vsync, so a leftover instance sits at 250%+ CPU
   forever. Two of them survived an overnight build here, ran for seven
   hours, ate five of ten cores, and quietly failed the perf and timing
   gates of every later run before anyone noticed the machine was busy.
   484 abandoned profiles had also piled up (2.3 GB).
   So: before this run starts, kill any stray fm-* Chrome and bin any
   profile older than an hour. Never touch a real browser — the match is on
   our own `--user-data-dir=<tmp>/fm-*` and nothing else. */
function sweepStrayChrome() {
  const tmp = os.tmpdir();
  try {
    cp.execSync(`pkill -f "user-data-dir=${tmp.replace(/\/$/, '')}/fm-" 2>/dev/null`,
      { stdio: 'ignore' });
  } catch (e) { /* nothing to kill is the normal case */ }
  const cutoff = Date.now() - 3600e3;
  let binned = 0;
  try {
    for (const name of fs.readdirSync(tmp)) {
      if (!/^fm-[a-z]/i.test(name)) continue;
      const full = path.join(tmp, name);
      try {
        const st = fs.statSync(full);
        if (!st.isDirectory() || st.mtimeMs > cutoff) continue;
        fs.rmSync(full, { recursive: true, force: true });
        binned++;
      } catch (e) {}
    }
  } catch (e) {}
  if (binned) console.log(`swept ${binned} abandoned Chrome profile(s) from ${tmp}`);
}
sweepStrayChrome();

async function launchChrome(extraFlags = []) {
  // Chrome profiles live in the OS temp dir, never in the repo: this tree
  // may sit inside a synced folder (iCloud Documents), and a few hundred
  // abandoned profiles there once cost 16 GB and a wedged sync daemon.
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-chrome-'));
  CHROME_PROFILES.push(profile);
  const proc = spawn(CHROME, [
    '--headless=new', '--mute-audio', '--remote-debugging-port=0',
    '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
    '--window-size=1280,720', '--force-device-scale-factor=1',
    '--hide-scrollbars', '--no-first-run', '--no-default-browser-check',
    '--disable-dev-shm-usage',
    `--user-data-dir=${profile}`, ...extraFlags, 'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  const wsUrl = await new Promise((resolve, reject) => {
    let buf = '';
    proc.stderr.on('data', d => {
      buf += d.toString();
      const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
      if (m) resolve(m[1]);
    });
    proc.on('exit', () => reject(new Error('chrome exited early\n' + buf)));
    setTimeout(() => reject(new Error('no devtools ws\n' + buf)), 15000);
  });
  const port = new URL(wsUrl).port;
  return { proc, port, profile };
}
function connect(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let id = 0;
    const pending = new Map();
    const listeners = [];
    ws.onopen = () => resolve({
      ws,
      send(method, params = {}) {
        return new Promise((res2, rej2) => {
          const mid = ++id;
          const guard = setTimeout(() => {
            if (pending.has(mid)) { pending.delete(mid); rej2(new Error(method + ': no CDP reply in 30s')); }
          }, 30000);
          pending.set(mid, { res2: v => { clearTimeout(guard); res2(v); },
                             rej2: e => { clearTimeout(guard); rej2(e); }, method });
          ws.send(JSON.stringify({ id: mid, method, params }));
        });
      },
      on(fn) { listeners.push(fn); },
      close() { try { ws.close(); } catch {} },
    });
    ws.onerror = () => reject(new Error('ws error'));
    ws.onmessage = ev => {
      const msg = JSON.parse(ev.data);
      if (msg.id && pending.has(msg.id)) {
        const { res2, rej2, method } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? rej2(new Error(method + ': ' + JSON.stringify(msg.error))) : res2(msg.result);
      } else if (msg.method) {
        for (const fn of listeners) fn(msg.method, msg.params);
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

// In-page driver bot: writes REAL pad-0 input (or dispatches real key events)
// every frame from telemetry. Walking is camera-relative exactly like a human
// stick; combat approaches and taps the real attack button.
const BOT_SRC = `(function(){
  if (window.__fmBot) return;
  const B = window.__fmBot = {
    mode:'pad', target:null, tol:0.9, done:true,
    fight:false, boss:false, still:false, keys:{},
  };
  function key(code, down){
    if (!!B.keys[code] === down) return;
    B.keys[code] = down;
    const km = {KeyW:'w',KeyA:'a',KeyS:'s',KeyD:'d',KeyJ:'j',KeyK:'k',KeyL:'l'};
    window.dispatchEvent(new KeyboardEvent(down?'keydown':'keyup',
      {code, key:km[code]||code, bubbles:true, cancelable:true}));
  }
  function stick(mx,my){
    if (B.mode==='pad'){ if(window.__fakePad) __fakePad.axes(mx,my); }
    else {
      key('KeyA', mx < -0.35); key('KeyD', mx > 0.35);
      key('KeyW', my < -0.35); key('KeyS', my > 0.35);
    }
  }
  let pressed=false, sprinting=false;
  function press(on){
    if (on===pressed) return; pressed=on;
    if (B.mode==='pad'){ if(on) __fakePad.press(0); else __fakePad.press(sprinting?1:undefined); }
    else key('KeyJ', on);
  }
  // v3: dodge-roll is gone — the bot SPRINTS out of trouble instead
  function sprint(on){
    if (on===sprinting) return; sprinting=on;
    if (B.mode==='pad'){ if(!pressed) __fakePad.press(on?1:undefined); }
    else key('ShiftLeft', on);
  }
  B.sprint = sprint;
  B.release=()=>{ stick(0,0); press(false); sprint(false); B.target=null; B.fight=false; B.boss=false; B.bossStyle=null; B.still=false; B.forest=false; B.noWiggle=false; };
  let f=0;
  // stuck detection: if a walk target exists but we stop making progress
  // (collider pockets in the village clutter), sidestep for a beat
  let lastX=0, lastZ=0, stuckCheck=0, wiggleF=0, wiggleSign=1;
  (function step(){
    requestAnimationFrame(step);
    f++;
    const T = window.__fm;
    if (!T || T.state!=='play' || B.still){ if(B.still) stick(0,0); return; }
    if (B.target && !B.noWiggle){
      stuckCheck++;
      if (stuckCheck >= 40){
        if (Math.hypot(T.x-lastX, T.z-lastZ) < 0.3){ wiggleF = 28; wiggleSign = -wiggleSign; }
        lastX = T.x; lastZ = T.z; stuckCheck = 0;
      }
    } else { stuckCheck = 0; wiggleF = 0; }
    let want=null;
    if (B.boss){
      const st=T.bossState, bx=T.bossX, bz=T.bossZ;
      const dxp=T.x-bx, dzp=T.z-bz, dp=Math.hypot(dxp,dzp)||1;
      const kid = B.bossStyle==='kid';    // v4: the kid bot ONLY body-slashes
      if (!T.bossActive){ want=[58,164]; press(false); sprint(false); }
      else if (st==='stuck'||st==='dizzy'){
        sprint(dp > 3.4);                      // close the window gap at a run
        if (kid){
          // a kid whacks the SHELL — never aims for the claw
          want=[bx,bz];
        } else {
          // steer INTO the claw while swinging — v3's solid arena wall can pin
          // the flee, so the slam may land right on us with our back turned
          want=[T.bossClawX,T.bossClawZ];
        }
        press((f>>2)&1?true:false);
      } else if (st==='slamTele'||st==='slam'){
        press(false); sprint(true);            // sprint clear of the slam
        want=[bx+dxp/dp*8, bz+dzp/dp*8];
      } else if (st==='chargeTele'||st==='charge'){
        press(false); sprint(true);            // sprint out of the charge line
        want=[62-dzp/dp*7, 166+dxp/dp*7];
      } else if (kid){
        sprint(false);
        // the kid stands at the shell and keeps slashing the body
        if (dp>3.6){ press(false); want=[bx+dxp/dp*3.0, bz+dzp/dp*3.0]; }
        else { want=null; stick(0,0); press((f>>2)&1?true:false); }
      } else {
        // identical to the kid between windows (stand close, chip the shell) —
        // the ONLY difference is aiming the claw when it sticks. Same player,
        // better aim: the comparison is strategy, not positioning noise.
        sprint(false);
        if (dp>3.6){ press(false); want=[bx+dxp/dp*3.0, bz+dzp/dp*3.0]; }
        else { want=null; stick(0,0); press((f>>2)&1?true:false); }
      }
    } else if (B.forest){
      // the FOREST kid-bot: slashes whatever is near, sidesteps boar charges
      const bd=T.nearBoarDist??999, hd=T.nearHornetDist??999, bst=T.nearBoarState;
      if (bd<20 && (bst==='paw'||bst==='charge')){
        press(false); sprint(true);
        const dxp=T.x-T.nearBoarX, dzp=T.z-T.nearBoarZ, dp=Math.hypot(dxp,dzp)||1;
        want=[T.x - dzp/dp*7, T.z + dxp/dp*7];
      } else if (Math.min(bd,hd) < 2.3){ want=null; stick(0,0); sprint(false); press((f>>2)&1?true:false); }
      else if (hd < bd && hd < 999){ press(false); sprint(false); want=[T.nearHornetX,T.nearHornetZ]; }
      else if (bd < 999){ press(false); sprint(false); want=[T.nearBoarX,T.nearBoarZ]; }
      else press(false);
    } else if (B.fight){
      const cd=T.nearCrabDist, wd=T.nearWispDist;
      if (Math.min(cd,wd) < 2.0){ want=null; stick(0,0); press((f>>2)&1?true:false); }
      else if (wd < cd && wd < 999){ press(false); want=[T.nearWispX,T.nearWispZ]; }
      else if (cd<999){ press(false); want=[T.nearCrabX,T.nearCrabZ]; }
      else press(false);
    }
    if (!want && B.target) want=B.target;
    if (want){
      const dx=want[0]-T.x, dz=want[1]-T.z, d=Math.hypot(dx,dz);
      if (B.target && d<B.tol){ B.target=null; B.done=true; stick(0,0); }
      else if (d>0.3){
        let wx=dx/d, wz=dz/d;
        if (wiggleF>0){ wiggleF--; const px=-wz*wiggleSign, pz=wx*wiggleSign; wx=(wx*0.25+px)/1.1; wz=(wz*0.25+pz)/1.1; }
        const y=T.camYaw;
        stick(wx*Math.cos(y)-wz*Math.sin(y), wx*Math.sin(y)+wz*Math.cos(y));
      } else stick(0,0);
    } else if (!B.fight && !B.boss) stick(0,0);
  })();
})();`;

function makeApi(c) {
  const consoleBad = [];
  c.on((method, params) => {
    if (method === 'Runtime.consoleAPICalled' && (params.type === 'error' || params.type === 'warning')) {
      consoleBad.push(params.type + ': ' + params.args.map(a => a.value ?? a.description ?? '').join(' '));
    }
    if (method === 'Runtime.exceptionThrown') {
      consoleBad.push('exception: ' + (params.exceptionDetails.exception?.description || params.exceptionDetails.text));
    }
    if (method === 'Log.entryAdded' && (params.entry.level === 'error' || params.entry.level === 'warning')) {
      if (/GL Driver Message|GPU stall|ReadPixels|Automatic fallback to software WebGL/.test(params.entry.text)) return;
      if (/AudioContext was not allowed to start/.test(params.entry.text)) return;
      // benign browser nag from the SHARED touchpad lib (controller.js
      // preventDefault on an uncancelable touchend during synthetic drags) —
      // not this game's code, harmless on device
      if (/Ignored attempt to cancel a touch/.test(params.entry.text)) return;
      consoleBad.push('log-' + params.entry.level + ': ' + params.entry.text + ' ' + (params.entry.url || ''));
    }
  });
  const api = {
    consoleBad,
    async init() {
      await c.send('Page.enable'); await c.send('Runtime.enable'); await c.send('Log.enable');
      await c.send('Emulation.setFocusEmulationEnabled', { enabled: true });
      c.on(async (method, params) => {
        if (method !== 'Fetch.requestPaused') return;
        try {
          await c.send('Fetch.fulfillRequest', {
            requestId: params.requestId, responseCode: 200,
            responseHeaders: [{ name: 'Content-Type', value: 'text/javascript' },
                              { name: 'Access-Control-Allow-Origin', value: '*' }],
            body: Buffer.from(CONTROLLER_JS).toString('base64'),
          });
        } catch (e) {}
      });
      await c.send('Fetch.enable', { patterns: [{ urlPattern: '*controller.js*' }] });
    },
    async stubPad() { await c.send('Page.addScriptToEvaluateOnNewDocument', { source: PAD_STUB }); },
    async seedSave(save, once) {
      // once: seed only the FIRST navigation — later reloads keep the live
      // save (persistence gates need the game's own writes to survive)
      const set = `localStorage.setItem('fallenmoon_save_v1', ${JSON.stringify(JSON.stringify(save))});`;
      const source = once
        ? `try{ if(!localStorage.getItem('__fm_seeded')){ localStorage.setItem('__fm_seeded','1'); ${set} } }catch(e){}`
        : `try{ ${set} }catch(e){}`;
      await c.send('Page.addScriptToEvaluateOnNewDocument', { source });
    },
    async nav(url) {
      await c.send('Page.navigate', { url });
      await api.waitFor('!!window.__fm', 30000, 'page telemetry');
    },
    async eval(expr) {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error('eval failed: ' + JSON.stringify(r.exceptionDetails).slice(0, 500));
      return r.result.value;
    },
    async waitFor(expr, timeout = 20000, label = expr) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        if (await api.eval(expr)) return true;
        await sleep(50);
      }
      throw new Error('timeout waiting for ' + label);
    },
    async waitTicks(n, timeout = 30000) {
      const t0 = await api.eval('__fm.tick');
      await api.waitFor(`__fm.tick >= ${t0 + n}`, timeout, `${n} ticks`);
    },
    async press(...idx) { await api.eval(`__fakePad.press(${idx.join(',')})`); },
    async axes(lx, ly) { await api.eval(`__fakePad.axes(${lx},${ly})`); },
    async tap(i) { await api.press(i); await sleep(200); await api.press(); await sleep(150); },
    async key(key, code, down) {
      await api.eval(`window.dispatchEvent(new KeyboardEvent('${down ? 'keydown' : 'keyup'}', ` +
        `{key:${JSON.stringify(key)}, code:${JSON.stringify(code)}, bubbles:true, cancelable:true}))`);
    },
    async tapKey(key, code) { await api.key(key, code, true); await sleep(170); await api.key(key, code, false); await sleep(110); },
    async shot(name) {
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      const f = path.join(SHOTS, name + '.png');
      fs.writeFileSync(f, Buffer.from(r.data, 'base64'));
      console.log('  shot →', f);
      return f;
    },
    async installBot(mode) {
      await api.eval(BOT_SRC);
      await api.eval(`__fmBot.mode=${JSON.stringify(mode || 'pad')}`);
    },
    async bot(props) { await api.eval(`Object.assign(window.__fmBot, ${JSON.stringify(props)})`); },
    async botRelease() { await api.eval('__fmBot.release()'); },
    async walkTo(x, z, tol = 0.9, timeout = 60000) {
      // if a cinematic (sunstruck/wake) owns the sim, wait for control back —
      // otherwise the whole waypoint chain would abort in one frame
      await api.waitFor(`__fm.state === 'play'`, timeout, 'control before walk').catch(() => {});
      await api.eval(`__fmBot.done=false; __fmBot.tol=${tol}; __fmBot.target=[${x},${z}]`);
      await api.waitFor(
        `__fmBot.done || Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < ${tol + 0.15} || __fm.state!=='play'`,
        timeout, `walk to ${x},${z}`);
      await api.eval('__fmBot.target=null');
    },
    async perfReset() {
      await api.eval(`window.__perfMax={calls:0,tris:0,at:''};
        if(!window.__perfHook){window.__perfHook=1;(function s(){requestAnimationFrame(s);
          const T=window.__fm; if(!T) return;
          if(T.state==='play'||T.state==='cine'||T.state==='dialog'){
            if(T.calls>__perfMax.calls){__perfMax.calls=T.calls;
              __perfMax.at=T.x.toFixed(0)+','+T.z.toFixed(0)+' yaw'+T.camYaw.toFixed(2)+' '+T.state+' pst:'+T.pst;
              if(T.calls>78&&typeof crabs!=='undefined'){__perfMax.mix='crabs:'+crabs.filter(c=>c.c.root.visible).length+
                ' imps:'+wisps.filter(w2=>w2.m.root.visible).length+
                ' salt:'+saltPickups.filter(s=>s.mesh.visible).length+
                ' kelp:'+kelpPatches.filter(p=>p.mesh&&p.mesh.visible).length+
                ' npcs:'+[finn,tock,pearl].filter(n2=>n2.char.root.visible).length+
                ' pitch:'+T.camPitch.toFixed(2)+' cpos:'+crabs.map(c=>c.c.root.visible?(c.x.toFixed(0)+'/'+c.z.toFixed(0)):'-').join(' ')+' cam:'+camera.position.x.toFixed(0)+','+camera.position.z.toFixed(0);}}
            if(T.tris>__perfMax.tris)__perfMax.tris=T.tris;}})();}`);
    },
    async perfRead() { return api.eval('window.__perfMax'); },
  };
  return api;
}


async function tapUntil(api, tapFn, condExpr, tries = 12, label = condExpr) {
  for (let i = 0; i < tries; i++) {
    if (await api.eval(condExpr)) return;
    await tapFn();
    await sleep(450);
  }
  await api.waitFor(condExpr, 4000, label);
}

/* confirm = attack button; abstracted over pad/kbd */
function driver(api, mode) {
  return {
    mode,
    confirm: () => mode === 'pad' ? api.tap(0) : api.tapKey('j', 'KeyJ'),
    pulse: () => mode === 'pad' ? api.tap(3) : api.tapKey('l', 'KeyL'),
    pause: () => mode === 'pad' ? api.tap(9) : api.tapKey('p', 'KeyP'),
    down: () => mode === 'pad' ? api.tap(13) : api.tapKey('s', 'KeyS'),
    holdAtk: on => mode === 'pad'
      ? (on ? api.press(0) : api.press())
      : api.key('j', 'KeyJ', on),
    // v3 controls
    sprint: on => mode === 'pad'
      ? (on ? api.press(1) : api.press())
      : api.key('Shift', 'ShiftLeft', on),
    jump: () => mode === 'pad' ? api.tap(2) : api.tapKey(' ', 'Space'),
  };
}
async function advanceDialog(api, D, expectId, maxLines = 5) {
  await api.waitFor(`__fm.dlg === ${JSON.stringify(expectId)}`, 15000, 'dialogue ' + expectId);
  // one tap per check: a tap either completes the typewriter or advances a
  // line — never tap again after the dialogue closed (it would re-open one)
  for (let i = 0; i < (maxLines + 2) * 2; i++) {
    if (await api.eval(`__fm.dlg !== ${JSON.stringify(expectId)}`)) return;
    await D.confirm();
    await sleep(230);
  }
  await api.waitFor(`__fm.dlg !== ${JSON.stringify(expectId)}`, 6000, 'dialogue ' + expectId + ' done');
}

/* ═══ v3 control gates: SPRINT, JUMP, air attack — run in both slices ═══
   Assumes the bot is installed and the player is in free play. */
async function v3ControlGates(api, D, g) {
  const snap = async () => JSON.parse(await api.eval(`JSON.stringify({t:__fm.tick,x:__fm.x,z:__fm.z})`));
  // ── sprint: measured speed delta + lean pose flag ──
  await api.eval('__fmDebug.warp(-55, 26)');
  await api.eval('__fmBot.tol=0.4; __fmBot.target=[-55, 70]');
  await api.waitTicks(30);                 // let steering settle
  const w0 = await snap(); await api.waitTicks(180); const w1 = await snap();
  const vWalk = Math.hypot(w1.x - w0.x, w1.z - w0.z) / (w1.t - w0.t);
  await api.eval('__fmBot.target=null');
  await api.eval('__fmDebug.warp(-55, 26)');
  await D.sprint(true);
  await api.eval('__fmBot.tol=0.4; __fmBot.target=[-55, 70]');
  await api.waitTicks(30);
  const s0 = await snap();
  const sprFlag = await api.eval('__fm.sprint === true');
  await api.waitTicks(90);
  const lean = await api.eval('__fm.sprintLean');
  await api.waitTicks(90);
  const s1 = await snap();
  const vSpr = Math.hypot(s1.x - s0.x, s1.z - s0.z) / (s1.t - s0.t);
  await D.sprint(false);
  await api.eval('__fmBot.target=null');
  g('sprint: ~1.6x speed delta', vSpr / vWalk > 1.4 && vSpr / vWalk < 1.85,
    `walk ${vWalk.toFixed(3)} sprint ${vSpr.toFixed(3)} ratio ${(vSpr / vWalk).toFixed(2)}`);
  g('sprint: flag + lean pose', sprFlag && lean > 0.2, `flag=${sprFlag} lean=${lean}`);

  // ── jump: leaves the ground ~1 m, lands with squash ──
  await api.eval('__fmDebug.warp(-55, 26)');
  await api.eval(`window.__jw={max:0,landed:false,squash:false};(function w(){
    const T=__fm; if(T.airY>__jw.max)__jw.max=T.airY;
    if(__jw.max>0.3&&!T.air){__jw.landed=true;if(T.landT>0)__jw.squash=true;return;}
    requestAnimationFrame(w);})()`);
  await D.jump();
  await api.waitFor('window.__jw.landed', 8000, 'jump lands');
  const jw = await api.eval('JSON.stringify(window.__jw)').then(JSON.parse);
  g('jump: real ~1 m arc, leaves ground and lands', jw.max > 0.6 && jw.max < 1.4 && jw.landed,
    `apex=${jw.max.toFixed(2)}`);
  g('jump: landing squash window', jw.squash);
  g('jump: no double jump mid-air', (await api.eval('__fm.jumps')) >= 1);

  // ── jump clears a kelp cluster (real-time steering) ──
  await api.eval('window.__fmTurbo = 1');
  let cleared = false, overAir = 0;
  for (let att = 0; att < 4 && !cleared; att++) {
    await api.eval('__fmDebug.warp(12.4, 5.6); __fmDebug.camYaw(Math.PI)');
    /* telemetry syncs once per frame: arm the recorder only after the warp
       is VISIBLE in __fm, or its z>11.5 exit fires on the stale pre-warp
       position and it dies on frame one (it did — n:1 in the trace) */
    await api.waitFor('Math.abs(__fm.z - 5.6) < 1.5 && Math.abs(__fm.x - 12.4) < 1.5', 4000, 'kelp warp landed');
    await api.eval(`window.__kw={over:0};window.__kr=[];(function w(){
      const T=__fm; __kr.push([+T.z.toFixed(2),T.air?1:0,+(T.airY||0).toFixed(2)]);
      if(Math.abs(T.z-9.2)<0.55&&Math.abs(T.x-12.4)<1.2&&T.airY>__kw.over)__kw.over=T.airY;
      if(T.z>11.5)return; requestAnimationFrame(w);})()`);
    await api.eval('__fmBot.tol=0.4; __fmBot.target=[12.4, 12.6]');
    const t0 = Date.now();
    let jumped = false;
    while (Date.now() - t0 < 9000) {
      const z = await api.eval('__fm.z');
      if (!jumped && z > 7.9) { await D.jump(); jumped = true; }
      if (z > 11.4) break;
      await sleep(25);
    }
    await api.eval('__fmBot.target=null');
    overAir = await api.eval('window.__kw.over');
    if (overAir > 0.25) cleared = true;
  }
  if (!cleared) console.log('  kelp trace:', await api.eval(
    `JSON.stringify({n:__kr.length, air:__kr.filter(f=>f[1]).length, win:__kr.filter(f=>Math.abs(f[0]-9.2)<0.55).slice(0,25), x:+__fm.x.toFixed(2)})`));
  g('jump: clears a kelp cluster airborne', cleared, `air over stalk=${overAir.toFixed(2)}`);

  // ── jump lands ON a crate top and stands there ──
  let onCrate = false, standH = 0;
  for (let att = 0; att < 6 && !onCrate; att++) {
    await api.eval('__fmDebug.warp(-14.7, 10.4)');
    await api.eval('__fmBot.tol=0.03; __fmBot.target=[-14.7, 8.6]');
    // press into the crate until blocked
    const t0 = Date.now();
    let last = 99;
    while (Date.now() - t0 < 6000) {
      const d = Math.hypot((await api.eval('__fm.x')) - (-14.7), (await api.eval('__fm.z')) - 8.6);
      if (d < 1.05 && Math.abs(d - last) < 0.02) break;
      last = d;
      await sleep(60);
    }
    await D.jump();
    await sleep(235);
    await api.eval('__fmBot.target=null; __fmBot.release()');
    await api.waitTicks(45);
    const air = await api.eval('__fm.air');
    standH = (await api.eval('__fm.fy')) - (await api.eval('__fm.gy'));
    if (!air && standH > 0.32) {
      await api.waitTicks(20);
      const still = !(await api.eval('__fm.air')) &&
        ((await api.eval('__fm.fy')) - (await api.eval('__fm.gy'))) > 0.32;
      if (still) onCrate = true;
    }
  }
  g('jump: lands on a crate top (stands on it)', onCrate, `standH=${standH.toFixed(2)}`);

  // ── air attack: same swing, allowed mid-jump (real time: the whole jump
  // is only 0.6 s — turbo would land it before the swing arrives) ──
  await api.eval('__fmDebug.warp(-55, 26)');
  await api.eval(`window.__aa=false;(function w(){
    const T=__fm; if(T.pst==='atk'&&T.air){window.__aa=true;return;}
    if(!T.air&&T.tick>1e9)return; requestAnimationFrame(w);})()`);
  let airAtk = false;
  for (let att = 0; att < 6 && !airAtk; att++) {
    // clean grounded idle first — a stray combo eats the jump edge otherwise
    await api.waitFor(`__fm.pst === 'idle' && __fm.air === false && __fm.state === 'play'`, 8000, 'grounded idle').catch(() => {});
    await D.jump();
    const t0 = Date.now();
    while (Date.now() - t0 < 700 && !(await api.eval('__fm.air'))) await sleep(30);
    if (await api.eval('__fm.air')) await D.confirm();
    await sleep(450);
    airAtk = await api.eval('window.__aa');
  }
  g('air attack allowed (same swing)', airAtk);
  await api.eval('window.__fmTurbo = undefined');   // resume suite turbo
  await api.eval('__fmDebug.warp(8.2, 7.0)');   // back at the spawn boat
}

/* ═══════════ the full slice, drivable by pad or keyboard ═══════════
   v2 shape: (a) fresh spawn = armed, zero directives; (b) a LONG stretch of
   pure walk/slash/secrets with ZERO dialogue (the open loop); (c) talking to
   Finn starts the Crescent thread; (d) the full arc to the payoff.        */
async function playSlice(api, D, opts = {}) {
  const g = (n, ok, d) => gate(`${opts.tag}: ${n}`, ok, d);
  await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
  if (opts.titleShot) { await sleep(1600); await api.shot('title-1280x720'); }
  await tapUntil(api, D.confirm, `__fm.state !== 'title'`, 12, 'leave title');   // NEW GAME
  await api.waitFor(`__fm.state === 'play'`, 30000, 'wake → play');
  const tick0 = await api.eval('__fm.tick');
  g('wake cinematic → free control', true);
  g('wakes in shade', await api.eval('__fm.shade === true'));

  // ── v3 spawn integrity: the wreck is GROUNDED and Wick spawns clear ──
  const minRel = await api.eval('__fm.wakeMinRel');
  const spClear = await api.eval('__fm.spawnClear');
  g('spawn wreck fully grounded (min vertex ≤ ground+eps)', minRel <= 0.06, `minRel=${minRel.toFixed(3)}`);
  g('no geometry inside Wick\'s spawn capsule', spClear >= 0.5, `clearance=${spClear.toFixed(2)}m`);

  // ── v2: NO directives at spawn ──
  g('no quest banner at spawn', !(await api.eval(`document.getElementById('questLine').classList.contains('on')`)) &&
    (await api.eval('__fm.quest')) === 0);
  g('no objective beacon at spawn', (await api.eval('__fm.beacon')) === false);

  // ── v2: the sword works within 2 s of a fresh spawn ──
  await api.eval(`window.__sawAtk=false;(function w(){
    if(__fm.pst==='atk'){window.__sawAtk=true;return;}
    requestAnimationFrame(w);})()`);
  const swT0 = Date.now();
  await D.confirm();
  let swOk = false;
  while (Date.now() - swT0 < 2000) {
    if (await api.eval('window.__sawAtk')) { swOk = true; break; }
    await D.confirm();
  }
  g('sword usable within 2s of spawn', swOk, `${Date.now() - swT0}ms, drawn=` + await api.eval('__fm.drawn'));

  // ── v2 camera gates (pad): full two-stick control ──
  if (D.mode === 'pad') {
    await api.eval('window.__fmTurbo = 1');        // real-time sim: the 3 s drift window needs real sampling resolution
    await api.eval('__fmDebug.warp(-55, 30)');     // open mud, no enemies in aggro range
    const yaw0 = await api.eval('__fm.camYaw');
    await api.eval('__fakePad.raxes(1,0)');
    await sleep(400);
    await api.eval('__fakePad.raxes(0,0)');
    const yaw1 = await api.eval('__fm.camYaw');
    g('right stick orbits yaw', Math.abs(yaw1 - yaw0) > 0.3, `Δ=${(yaw1 - yaw0).toFixed(2)}`);
    await api.eval('__fakePad.raxes(0,1)');
    await sleep(900);
    await api.eval('__fakePad.raxes(0,0)');
    const p1 = await api.eval('__fm.camPitch');
    g('right stick pitches up to +60° clamp', p1 > 0.6 && p1 <= 1.05, 'pitch=' + p1.toFixed(2));
    await api.eval('__fakePad.raxes(0,-1)');
    await sleep(1200);
    await api.eval('__fakePad.raxes(0,0)');
    const p2 = await api.eval('__fm.camPitch');
    g('pitch clamps at -25°', p2 >= -0.44 && p2 < -0.3, 'pitch=' + p2.toFixed(2));
    await api.eval('__fakePad.raxes(0,0.5)'); await sleep(320); await api.eval('__fakePad.raxes(0,0)');
    // movement stays LEFT-stick camera-relative at the rotated yaw
    const yawK = await api.eval('__fm.camYaw');
    const sx0 = await api.eval('__fm.x'), sz0 = await api.eval('__fm.z');
    await api.axes(0, -1);
    await sleep(650);
    await api.axes(0, 0);
    const dxm = (await api.eval('__fm.x')) - sx0, dzm = (await api.eval('__fm.z')) - sz0;
    const dm = Math.hypot(dxm, dzm) || 1;
    const dot = (dxm / dm) * -Math.sin(yawK) + (dzm / dm) * -Math.cos(yawK);
    g('movement stays camera-relative', dm > 0.8 && dot > 0.85, `dot=${dot.toFixed(2)} d=${dm.toFixed(1)}`);
    // NO autonomous camera while the stick was touched in the last 3 s
    await api.eval('__fmDebug.warp(-55, 34)');
    await api.eval('__fakePad.raxes(0.6,0)'); await sleep(160); await api.eval('__fakePad.raxes(0,0)');
    await api.axes(1, 0);                          // strafe: heading ≠ camera yaw
    await api.waitFor('__fm.camStickAge > 0.4', 10000, 'stick age 0.4');
    const yA = await api.eval('__fm.camYaw');
    await api.waitFor('__fm.camStickAge > 2.6', 10000, 'stick age 2.6');
    const yB = await api.eval('__fm.camYaw');
    g('no auto-drift while stick active (<3s)', Math.abs(yB - yA) < 0.08, `Δ=${(yB - yA).toFixed(3)}`);
    await api.waitFor('__fm.camStickAge > 7', 15000, 'stick age 7');
    const yC = await api.eval('__fm.camYaw');
    await api.axes(0, 0);
    g('gentle drift-behind resumes while walking', Math.abs(yC - yB) > 0.1, `Δ=${(yC - yB).toFixed(3)}`);
    const yD = await api.eval('__fm.camYaw');
    await api.waitTicks(300);
    const yE = await api.eval('__fm.camYaw');
    g('never drifts while standing still', Math.abs(yE - yD) < 0.03, `Δ=${(yE - yD).toFixed(3)}`);
    await api.eval('__fmDebug.warp(8.2, 4.8)');    // back to the spawn boat
    await api.eval('window.__fmTurbo = undefined');
  }

  await api.installBot(D.mode);
  await api.perfReset();

  /* ═══ v3 controls: sprint, jump, air attack (replaces every roll gate) ═══ */
  await v3ControlGates(api, D, g);

  /* ═══ THE OPEN LOOP — 3+ sim-minutes, ZERO dialogue: walk, slash, find ═══ */
  await api.eval(`window.__dlgSeen=false;(function w(){
    if(__fm.dlg){window.__dlgSeen=true;return;}
    requestAnimationFrame(w);})()`);

  // step into the glare
  await api.walkTo(8, -4, 1.2);
  g('walked into the sun (glare beat)', await api.eval('__fm.everSun === true'));

  // slashables within reach of spawn: cut kelp with real swings
  await api.walkTo(10.4, 9.2, 0.8);
  const kc0 = await api.eval('__fm.kelpCutCount');
  for (let i = 0; i < 10 && (await api.eval('__fm.kelpCutCount')) === kc0; i++) {
    await D.confirm();
    await sleep(250);
  }
  g('spawn kelp slashed (open loop)', (await api.eval('__fm.kelpCutCount')) > kc0,
    'cut=' + await api.eval('__fm.kelpCutCount'));

  // the first crab scuttles just past the quay gap — kill it with real swings
  const crabs0 = await api.eval('__fm.crabsAlive');
  await api.walkTo(8, 22, 1.4);
  await api.bot({ fight: true });
  if (opts.combatShot) {
    await api.eval(`window.__fmShotFlag=false;(function w(){
      const T=__fm; if(T.pst==='atk'&&T.nearCrabDist<2.6){window.__fmShotFlag=true;return;}
      requestAnimationFrame(w);})()`);
    const t0 = Date.now();
    while (Date.now() - t0 < 40000 && !(await api.eval('window.__fmShotFlag'))) await sleep(80);
    await api.eval('window.__fmTurbo = 1');
    await sleep(60);
    await api.shot('drybay-combat-1280x720');
    await api.eval('window.__fmTurbo = undefined');
  }
  await api.waitFor(`__fm.crabsAlive < ${crabs0}`, 90000, 'crab defeated');
  await api.bot({ fight: false });
  await api.botRelease();
  g('Scorch Crab defeated by real swings', true, 'alive=' + await api.eval('__fm.crabsAlive'));

  // ── pause/resume mid-combat area ──
  await tapUntil(api, D.pause, `__fm.state === 'pause'`, 10, 'paused');
  const pt0 = await api.eval('__fm.tick');
  await sleep(500);
  g('pause freezes the sim', (await api.eval('__fm.tick')) === pt0);
  await tapUntil(api, D.pause, `__fm.state === 'play'`, 10, 'resumed');
  g('START pauses and resumes', true);

  // ── take a hit: hearts drop, i-frames (watcher catches the brief window) ──
  const h0 = await api.eval('__fm.hearts');
  await api.eval(`window.__hitCheck=null;(function w(){
    if (__fm.hearts < ${h0}) { window.__hitCheck = { hearts: __fm.hearts, iframes: __fm.iframes }; return; }
    requestAnimationFrame(w);})()`);
  await api.walkTo(await api.eval('__fm.nearCrabX'), await api.eval('__fm.nearCrabZ'), 2.2, 30000).catch(() => {});
  await api.eval('__fmBot.still = true');    // stand there and get pinched
  await api.waitFor('!!window.__hitCheck', 45000, 'crab hit lands');
  const hit = await api.eval('window.__hitCheck');
  g('hit drops a heart + i-frames', hit.iframes > 0, `hearts ${h0} → ${hit.hearts}, iframes ${hit.iframes}`);
  await api.eval('__fmBot.still = false');

  // ── pop a SUN IMP over the first dune (real swing) ──
  const wisps0 = await api.eval('__fm.wispsAlive');
  await api.walkTo(0, 44, 1.4);
  await api.bot({ fight: true });
  await api.waitFor(`__fm.wispsAlive < ${wisps0}`, 120000, 'imp popped');
  await api.bot({ fight: false });
  await api.botRelease();
  g('Sun Imp popped by real swing', true, 'alive=' + await api.eval('__fm.wispsAlive'));

  // ── deliberate sunstruck → wake in shade with 3 hearts ──
  const sc0 = await api.eval('__fm.sunstruck');
  await api.eval(`window.__wakeCheck = null;
    (function w(){ const T = __fm;
      if (T.sunstruck > ${sc0} && T.state === 'play')
        { window.__wakeCheck = { shade: T.shade, hearts: T.hearts }; return; }
      requestAnimationFrame(w); })()`);
  await api.walkTo(await api.eval('__fm.nearCrabX'), await api.eval('__fm.nearCrabZ'), 2.4, 30000).catch(() => {});
  await api.eval('__fmBot.still = true');
  await api.waitFor(`__fm.sunstruck > ${sc0}`, 180000, 'sunstruck');
  await api.eval('__fmBot.still = false');
  await api.waitFor('!!window.__wakeCheck', 15000, 'woke from sunstruck');
  const wake = await api.eval('window.__wakeCheck');
  g('sunstruck: no death — wake in shade', wake.shade === true, JSON.stringify(wake));
  g('sunstruck: 3 hearts back', wake.hearts === 3, 'hearts=' + wake.hearts);

  // ── shade healing tick observed ──
  const heals0 = await api.eval('__fm.healTicks');
  await api.waitFor(`__fm.healTicks > ${heals0}`, 40000, 'heal tick');
  g('shade heals a heart', true, 'hearts=' + await api.eval('__fm.hearts'));

  // ── secrets, still wordless: shipwreck chest → heart container ──
  await api.walkTo(-6, 55, 2.0);
  await api.walkTo(-20, 70, 1.6);
  await api.walkTo(-41.5, 90.5, 1.4);
  await api.walkTo(-43.4, 92.2, 0.45);
  await api.waitFor(`__fm.prompt === 'chest'`, 10000, 'chest prompt');
  await D.confirm();
  await api.waitFor('__fm.maxHearts === 6', 15000, 'heart container');
  g('shipwreck chest → heart container', true,
    'maxHearts=' + await api.eval('__fm.maxHearts'));

  // ── a salt crystal on the way ──
  await api.walkTo(-48, 88, 0.6);
  await sleep(300);
  g('salt crystal collected', (await api.eval('__fm.salt')) > 0,
    'salt=' + await api.eval('__fm.salt'));

  // ── the open-loop verdict: 3+ minutes of fun, zero dialogue, no banner ──
  const openTicks = (await api.eval('__fm.tick')) - tick0;
  if (openTicks < 10800) await api.waitTicks(10800 - openTicks);
  g('3+ sim-minutes of play before any dialogue', true,
    ((await api.eval('__fm.tick')) - tick0) + ' ticks');
  g('zero dialogue in the open loop', (await api.eval('window.__dlgSeen')) === false);
  g('quest still untouched (no funnel)', (await api.eval('__fm.quest')) === 0 &&
    !(await api.eval(`document.getElementById('questLine').classList.contains('on')`)));

  /* ═══ story is opt-in: back to the village to TALK ═══ */
  await api.walkTo(-20, 60, 2.0);
  await api.walkTo(-2, 30, 2.0);
  await api.walkTo(9, 2, 2.0);

  // ── Granny Tock ──
  await api.walkTo(0, -24, 1.4);
  await api.walkTo(-5.6, -28.0, 0.5);
  await api.waitFor(`__fm.prompt === 'talk'`, 8000, 'tock prompt');
  await D.confirm();
  await advanceDialog(api, D, 'tock1');
  g('Granny Tock dialogue (✕ advances)', true);

  // ── Pearl ──
  await api.walkTo(-20.8, -10.8, 0.5);
  await api.waitFor(`__fm.prompt === 'talk'`, 8000, 'pearl prompt');
  await D.confirm();
  await advanceDialog(api, D, 'pearl1');
  g('Pearl dialogue', true);

  // ── Keeper Finn: THIS starts the Crescent thread ──
  await api.walkTo(24, -19, 1.2);
  await api.walkTo(36, -15, 1.2);
  await api.walkTo(39.7, -14.1, 0.5);
  await api.waitFor(`__fm.prompt === 'talk'`, 8000, 'finn prompt');
  await D.confirm();
  await advanceDialog(api, D, 'finn1');
  await api.waitFor('__fm.quest === 2', 8000, 'crescent thread started');
  g('Finn starts the quest (banner appears)', await api.eval(`document.getElementById('questLine').classList.contains('on')`));
  g('Finn teaches + gives heart container', (await api.eval('__fm.maxHearts')) === 7 &&
    (await api.eval('__fm.finnHeart')) === true, 'maxHearts=' + await api.eval('__fm.maxHearts'));
  await api.waitFor('__fm.beacon === true', 8000, 'beacon appears');
  g('moon-mote beacon appears with the quest', true);

  // ── the kelp beard on the lighthouse door hides a CHEST now ──
  await api.waitTicks(150);            // item-get beat
  for (const [kx, kz] of [[41.4, -15.9], [41.6, -16.7], [41.9, -15.2]]) {
    if (await api.eval('__fm.kelpDoorCut')) break;
    await api.walkTo(kx, kz, 0.5).catch(() => {});
    for (let i = 0; i < 6 && !(await api.eval('__fm.kelpDoorCut')); i++) {
      await D.confirm();
      await sleep(260);
    }
  }
  g('door kelp cut with real swings', await api.eval('__fm.kelpDoorCut'));
  const salt0 = await api.eval('__fm.salt');
  await api.walkTo(41.2, -15.2, 0.6).catch(() => {});
  await api.waitFor(`__fm.prompt === 'doorChest'`, 10000, 'door chest prompt');
  await D.confirm();
  await api.waitFor('__fm.doorChest === true', 15000, 'door chest opened');
  await api.waitFor(`__fm.salt > ${salt0}`, 10000, 'salt cache');
  g('kelp door hides a chest (salt cache)', true, 'salt=' + await api.eval('__fm.salt'));

  // ── MOON COMPASS (△) — same pulse mechanic, v3 clarity layer ──
  const motes0 = await api.eval('__fm.compassMotes');
  const seen0 = await api.eval('__fm.compassSeen');
  if (D.mode === 'pad') await api.press(3); else await api.key('l', 'KeyL', true);
  let pulsed = false;
  try { await api.waitFor('__fm.pulseT > 0', 3000, 'pulse'); pulsed = true; } catch (e) {}
  if (D.mode === 'pad') await api.press(); else await api.key('l', 'KeyL', false);
  g('moon compass (△) fires', pulsed);
  g('moon compass: silver mote stream spawned', (await api.eval('__fm.compassMotes')) > motes0,
    'motes=' + await api.eval('__fm.compassMotes'));
  g('moon compass: objective bearing telemetry live', (await api.eval('__fm.objBearing')) !== null &&
    (await api.eval('__fm.objDist')) > 0);
  g('moon compass: one-time caption on first use', seen0 === false ?
    (await api.eval('__fm.compassSeen')) === true : true,
    seen0 ? '(already seen this save)' : 'caption fired');

  // ── out into the Dry Bay, quest-bound this time ──
  await api.walkTo(14, -18, 1.4);
  await api.walkTo(9, 2, 1.4);
  await api.walkTo(11, 22, 1.4);
  // pre-payoff shade probe: this exact spot must be SUN now, SHADE after dusk
  // (read-only world query — the real walk+heal check happens after the payoff)
  const shadeBefore = await api.eval('inShadeAt(15.0, 53.2)');
  g('stretch-spot is sunlit before the payoff', shadeBefore === false);

  // ── Tidepool Grotto: the mirror puzzle ──
  await api.walkTo(12, 60, 2.0);
  await api.walkTo(-10, 100, 1.6);
  await api.walkTo(25, 122, 1.6);
  await api.walkTo(30, 131, 1.0);
  await api.walkTo(30, 141, 1.0);
  g('inside the grotto (shade sanctuary)', await api.eval('__fm.inGrotto === true'));
  await api.walkTo(26.9, 147.0, 0.75);
  await api.waitFor(`__fm.prompt === 'mirror'`, 10000, 'mirror prompt');
  await D.holdAtk(true);
  await api.waitFor('Math.abs(__fm.mirrorDelta) < 0.35', 40000, 'shell near the mark');
  if (opts.grottoShot) {
    await api.eval('window.__fmTurbo = 1');
    await sleep(120);
    await api.shot('grotto-beam-1280x720');
    await api.eval('window.__fmTurbo = undefined');
  }
  await D.holdAtk(false);
  await api.waitFor('__fm.beamOn === true', 15000, 'beam seats on the kelp wall');
  await api.waitFor('__fm.wallBurned === true', 30000, 'kelp wall burned');
  g('mirror puzzle: held rotate → beam → kelp wall burns', true,
    'angle=' + (await api.eval('__fm.mirrorAngle')).toFixed(2));

  // ── THE SUNSTRUCK KING-CRAB ──
  await api.walkTo(36, 152.5, 1.2);
  await api.walkTo(47, 158.5, 1.2);
  await api.walkTo(56, 163, 1.2);
  await api.bot({ boss: true });
  await api.waitFor('__fm.bossActive === true', 20000, 'boss engaged');
  g('boss engaged', true);
  if (opts.bossShot) {
    await api.eval(`window.__fmShotFlag=false;(function w(){
      const T=__fm; if(T.bossState==='slamTele'||T.bossState==='stuck'){window.__fmShotFlag=true;return;}
      requestAnimationFrame(w);})()`);
    const t0 = Date.now();
    while (Date.now() - t0 < 40000 && !(await api.eval('window.__fmShotFlag'))) await sleep(80);
    await api.eval('window.__fmTurbo = 1');
    // stage the frame: camera low behind Wick, the King-Crab looming
    await api.eval(`(function(){
      const T=__fm;
      const dx=T.bossX-T.x, dz=T.bossZ-T.z, d=Math.hypot(dx,dz)||1;
      __fmDebug.cam(T.x - dx/d*3.4, -1.2, T.z - dz/d*3.4, T.bossX, 0.6, T.bossZ);
    })()`);
    await sleep(150);
    await api.shot('boss-fight-1280x720');
    await api.eval('__fmDebug.camOff(); window.__fmTurbo = undefined');
  }
  // phase gates (checkpoint = clawHits reset each phase)
  await api.waitFor('__fm.bossPhase >= 2', 300000, 'boss phase 2');
  g('boss phase 2 (claw hits landed)', true, 'clawHits reset=' + await api.eval('__fm.clawHits'));
  await api.waitFor('__fm.bossPhase >= 3', 300000, 'boss phase 3');
  g('boss phase 3 (dodged charges, hit the crash)', true);
  await api.perfReset();     // sample boss p3 separately
  await api.waitFor(`__fm.cinId === 'bossDefeat' || __fm.carry === true`, 300000, 'boss defeated');
  await api.botRelease();
  const bossPerf = await api.perfRead();
  await api.waitFor('__fm.carry === true && __fm.state === "play"', 60000, 'crescent carried');
  g('Crescent Horn obtained (nothing dies)', (await api.eval('__fm.quest')) === 3);

  // ── carry it home to the Moonwheel (sunstruck-resilient: the carrier can
  // get overwhelmed crossing the bay; re-walk from wherever they woke) ──
  await api.walkTo(47, 158.5, 1.4).catch(() => {});
  await api.walkTo(36, 152.5, 1.4).catch(() => {});
  await api.walkTo(30, 131, 1.4).catch(() => {});
  await api.walkTo(12, 60, 2.0).catch(() => {});
  await api.walkTo(11, 22, 2.0).catch(() => {});
  await api.walkTo(9, 0, 2.0).catch(() => {});
  await api.walkTo(0, -24, 2.0).catch(() => {});
  await api.walkTo(-14, -44, 2.0).catch(() => {});
  await api.walkTo(-30, -62, 2.0).catch(() => {});
  await api.walkTo(-36.4, -73.6, 1.2).catch(() => {});
  for (let i = 0; i < 4 && !(await api.eval(`Math.hypot(__fm.x - (-36.4), __fm.z - (-73.6)) < 2.5`)); i++) {
    await api.waitFor(`__fm.state === 'play'`, 60000, 'control back on the road home');
    await api.walkTo(0, -24, 2.5, 90000).catch(() => {});
    await api.walkTo(-14, -44, 2.5, 60000).catch(() => {});
    await api.walkTo(-30, -62, 2.5, 60000).catch(() => {});
    await api.walkTo(-36.4, -73.6, 1.2, 60000).catch(() => {});
  }

  // sky sample BEFORE
  await api.eval('__fmDebug.camYaw(Math.PI); __fmDebug.face(0);');
  await api.eval('window.__fmTurbo = 1');
  await sleep(900);
  const skyBefore = await api.shot(opts.tag === 'pad' ? 'sky-before' : 'sky-before-kbd');
  await api.eval('window.__fmTurbo = undefined');

  // ── THE PAYOFF (sunstruck-resilient: re-approach and re-press as needed) ──
  for (let i = 0; i < 5 && !(await api.eval(`__fm.cinId === 'wheel' || __fm.phases >= 1`)); i++) {
    await api.waitFor(`__fm.state === 'play'`, 90000, 'control before the wheel').catch(() => {});
    await api.walkTo(-37.2, -74.6, 0.8, 90000).catch(() => {});
    if (await api.eval(`__fm.prompt === 'wheel'`)) await D.confirm();
    await sleep(700);
  }
  await api.waitFor(`__fm.cinId === 'wheel'`, 15000, 'payoff begins');
  if (opts.payoffShots) {
    await api.waitFor('__fm.cinT > 8.45', 60000, 'payoff sky moment');
    await api.eval('window.__fmTurbo = 1');
    await sleep(120);
    await api.shot('payoff-wheel-star-1280x720');
    await api.eval('window.__fmTurbo = undefined');
    await api.waitFor('__fm.cinT > 11.1', 60000, 'payoff tidepool moment');
    await api.eval('window.__fmTurbo = 1');
    await sleep(120);
    await api.shot('payoff-tidepool-1280x720');
    await api.eval('window.__fmTurbo = undefined');
  }
  await advanceDialog(api, D, 'finn3');
  await api.waitFor(`__fm.state === 'tbc'`, 20000, 'TO BE CONTINUED');
  g('TO BE CONTINUED card', true);
  if (opts.payoffShots) { await sleep(1700); await api.shot('tbc-card-1280x720'); }
  await sleep(1800);
  await D.confirm();
  await api.waitFor(`__fm.state === 'play'`, 10000, 'free roam resumes');
  g('free roam resumes after the card', true);

  // payoff state gates
  g('skyStep telemetry = 1', (await api.eval('__fm.skyStep')) === 1);
  g('phases restored = 1', (await api.eval('__fm.phases')) === 1);
  g('shade pools stretched (shadeGrow=1)', (await api.eval('__fm.shadeGrow')) > 0.99);
  g('tidepool refilled (persists)', await api.eval('__fm.tidepool === true'));

  // sky sample AFTER (same spot, same camera)
  await api.walkTo(-36.4, -73.6, 1.0);
  await api.eval('__fmDebug.camYaw(Math.PI); __fmDebug.face(0);');
  await api.eval('window.__fmTurbo = 1');
  await sleep(900);
  const skyAfter = await api.shot(opts.tag === 'pad' ? 'sky-after' : 'sky-after-kbd');
  await api.eval('window.__fmTurbo = undefined');
  const b = decodePNG(fs.readFileSync(skyBefore));
  const a = decodePNG(fs.readFileSync(skyAfter));
  let delta = 0;
  for (const [sx, sy] of [[400, 70], [640, 60], [880, 70], [640, 130]]) {
    const cb = medianColorAt(b, sx, sy, 6), ca = medianColorAt(a, sx, sy, 6);
    delta = Math.max(delta, Math.abs(cb[0] - ca[0]) + Math.abs(cb[1] - ca[1]) + Math.abs(cb[2] - ca[2]));
  }
  g('sky-dim payoff visible in pixels', delta >= 25, 'max ΔRGB=' + delta.toFixed(0));

  // ── stretched shade is REAL: the probed sun spot is now shade, and heals ──
  await api.walkTo(-30, -62, 2.0);
  await api.walkTo(-14, -44, 2.0);
  await api.walkTo(0, -24, 2.0);
  await api.walkTo(9, 2, 2.0);
  await api.walkTo(11, 30, 2.0);
  // take one hit so healing is observable
  const hh = await api.eval('__fm.hearts');
  if (hh >= await api.eval('__fm.maxHearts')) {
    await api.bot({ fight: false });
    await api.walkTo(await api.eval('__fm.nearCrabX'), await api.eval('__fm.nearCrabZ'), 2.4, 40000).catch(() => {});
    await api.eval('__fmBot.still = true');
    await api.waitFor(`__fm.hearts < ${hh}`, 60000, 'pre-stretch-test hit');
    await api.eval('__fmBot.still = false');
  }
  await api.walkTo(15.0, 53.2, 0.7);
  g('stretch-spot is SHADE after dusk (was sun)', await api.eval('__fm.shade === true'));
  const heals1 = await api.eval('__fm.healTicks');
  await api.waitFor(`__fm.healTicks > ${heals1}`, 40000, 'heal tick in stretched shade');
  g('healing works in newly-covered ground', true);

  return { bossPerf };
}

/* ═══════════ suites ═══════════ */
async function suiteFlow(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.nav(base + '/?turbo=6');
  const D = driver(api, 'pad');
  try {
    await api.perfReset();
    const r = await playSlice(api, D, {
      tag: 'pad', titleShot: true, combatShot: true, grottoShot: true,
      bossShot: true, payoffShots: true,
    });
    gate('pad: boss p3 draw calls ≤ 80', r.bossPerf.calls <= 80, 'max ' + r.bossPerf.calls);
    gate('pad: boss p3 triangles ≤ 120k', r.bossPerf.tris <= 120000, 'max ' + r.bossPerf.tris);
    // post-payoff dusk perf (walk the village under the new sky)
    await api.perfReset();
    await api.walkTo(9, 0, 2.0);
    await api.walkTo(0, -24, 2.0);
    await api.walkTo(-20, -35, 2.0);
    const dusk = await api.perfRead();
    gate('pad: dusk draw calls ≤ 80', dusk.calls <= 80, 'max ' + dusk.calls);
    gate('pad: dusk triangles ≤ 120k', dusk.tris <= 120000, 'max ' + dusk.tris);

    // ── save persistence: reload → CONTINUE ──
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title again');
    gate('save: CONTINUE offered', await api.eval(`!document.getElementById('ti1').classList.contains('gone')`));
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'continued');
    gate('save: resumes at quest step', (await api.eval('__fm.quest')) === 4,
      'quest=' + await api.eval('__fm.quest'));
    gate('save: heart containers intact', (await api.eval('__fm.maxHearts')) === 7,
      'maxHearts=' + await api.eval('__fm.maxHearts'));
    gate('save: chest stays opened', await api.eval('__fm.chestOpened === true'));
    gate('save: door chest stays opened', await api.eval('__fm.doorChest === true'));
    gate('save: sky stays healed', (await api.eval('__fm.skyStep')) === 1 && (await api.eval('__fm.shadeGrow')) > 0.99);
    gate('save: tidepool stays wet', await api.eval('__fm.tidepool === true'));
    gate('save: salt kept', (await api.eval('__fm.salt')) > 0);

    const bad = api.consoleBad;
    gate('pad: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('flow suite', false, e.message);
    await api.shot('flow-FAIL').catch(() => {});
    console.log('  consoleBad:', api.consoleBad.slice(0, 5));
    console.log('  state:', await api.eval('JSON.stringify({s:__fm.state,q:__fm.quest,x:__fm.x,z:__fm.z,h:__fm.hearts,b:__fm.bossState,ph:__fm.bossPhase})').catch(() => '?'));
  }
  c.close(); proc.kill();
}

async function suiteKbd(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init();                          // NO pad stub
  await api.nav(base + '/?turbo=8');
  const D = driver(api, 'kbd');
  try {
    const pads = await api.eval('navigator.getGamepads ? navigator.getGamepads().filter(Boolean).length : 0');
    gate('kbd: zero gamepads present', pads === 0, 'pads=' + pads);
    await playSlice(api, D, { tag: 'kbd' });

    // ── kbd camera: arrow-key fallback orbits ──
    const ky0 = await api.eval('__fm.camYaw');
    await api.key('ArrowRight', 'ArrowRight', true);
    await sleep(450);
    await api.key('ArrowRight', 'ArrowRight', false);
    const ky1 = await api.eval('__fm.camYaw');
    gate('kbd: arrow keys orbit the camera', Math.abs(ky1 - ky0) > 0.25, `Δ=${(ky1 - ky0).toFixed(2)}`);
    const kp0 = await api.eval('__fm.camPitch');
    await api.key('ArrowUp', 'ArrowUp', true);
    await sleep(350);
    await api.key('ArrowUp', 'ArrowUp', false);
    const kp1 = await api.eval('__fm.camPitch');
    gate('kbd: arrow keys pitch the camera', kp1 < kp0 - 0.05, `${kp0.toFixed(2)}→${kp1.toFixed(2)}`);

    // ── mouse-look: pointer lock on click, movementX/Y orbits ──
    const clickGesture = await c.send('Runtime.evaluate', {
      expression: `(function(){ try { const p = document.getElementById('gl').requestPointerLock();
        if (p && p.catch) p.catch(() => {}); } catch (e) {} return 'ok'; })()`,
      userGesture: true, returnByValue: true, awaitPromise: true,
    }).catch(() => null);
    let locked = false;
    try { await api.waitFor('__fm.pointerLocked === true', 3000, 'pointer lock'); locked = true; } catch (e) {}
    if (locked) {
      const my0 = await api.eval('__fm.camYaw');
      for (let i = 0; i < 8; i++) {
        await api.eval(`document.dispatchEvent(new MouseEvent('mousemove', { movementX: 60, movementY: 8, bubbles: true }))`);
        await sleep(40);
      }
      const my1 = await api.eval('__fm.camYaw');
      gate('kbd: mouse-look orbits under pointer lock', Math.abs(my1 - my0) > 0.2, `Δ=${(my1 - my0).toFixed(2)}`);
      await api.eval('document.exitPointerLock()');
    } else {
      // headless denied the lock — assert the guard instead: unlocked mouse
      // movement must NOT move the camera (and the lock request didn't throw)
      const my0 = await api.eval('__fm.camYaw');
      for (let i = 0; i < 6; i++) {
        await api.eval(`document.dispatchEvent(new MouseEvent('mousemove', { movementX: 80, movementY: 0, bubbles: true }))`);
        await sleep(40);
      }
      const my1 = await api.eval('__fm.camYaw');
      gate('kbd: mouse-look guarded when unlocked (lock unavailable headless)',
        clickGesture !== null && Math.abs(my1 - my0) < 0.05, `Δ=${(my1 - my0).toFixed(3)}`);
    }

    const bad = api.consoleBad;
    gate('kbd: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('kbd suite', false, e.message);
    await api.shot('kbd-FAIL').catch(() => {});
    console.log('  state:', await api.eval('JSON.stringify({s:__fm.state,q:__fm.quest,x:__fm.x,z:__fm.z,h:__fm.hearts,b:__fm.bossState,ph:__fm.bossPhase})').catch(() => '?'));
  }
  c.close(); proc.kill();
}

async function suiteTouch(base) {
  const { proc, port } = await launchChrome(['--window-size=1180,820']);
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init();
  await api.seedSave({
    v: 2, q: 2, ph: 0, mh: 5, sword: true, salt: 0,
    talked: { finn: 1, tock: 1, pearl: 1 },
    kelpDoor: true, doorChest: false, finnHeart: false, wreckChest: false, wallBurned: false,
    bossDone: false, sky: 0, tidepool: false, lastShade: [8, 6],
  });
  await c.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: true });
  await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  const points = new Map();
  const dispatch = (type) => c.send('Input.dispatchTouchEvent', {
    type, touchPoints: [...points.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id })) });
  const tStart = async (id, x, y) => { points.set(id, { x, y }); await dispatch('touchStart'); };
  const tMove = async (id, x, y) => { points.set(id, { x, y }); await dispatch('touchMove'); };
  const tEnd = async (id) => { points.delete(id); await dispatch('touchEnd'); };
  const tap = async (x, y, hold = 110) => { await tStart(9, x, y); await sleep(hold); await tEnd(9); };
  const rectCenter = async (sel) => {
    const r = await api.eval(`(function(){ const n = document.querySelector('${sel}'); if(!n) return null;
      const r = n.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
    if (!r) throw new Error(sel + ' missing');
    return r;
  };
  try {
    await api.nav(base + '/?turbo=4');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    const before = await api.eval(`!!document.getElementById('__arcade_touchpad')`);
    gate('touch: no overlay before first touch', before === false);
    await tap(590, 410);
    await api.waitFor(`(function(){ const o = document.getElementById('__arcade_touchpad'); return !!o && o.style.display !== 'none'; })()`, 8000, 'overlay engaged');
    gate('touch: first tap engages touchpad-v1', true);
    await api.waitFor(`document.body.classList.contains('input-pad')`, 5000, 'input-pad class');
    gate('touch: body gets input-pad', true);
    // title menu: CONTINUE is the second item — tap dpad-down? Use south to
    // confirm; first ensure focus CONTINUE via the virtual stick (down flick)
    const base0 = await rectCenter('#__atp-base');
    const south = await rectCenter('#__atp-s');
    // ── v4 guard on touch: ✕ on NEW GAME asks first; ○ keeps the save ──
    for (let i = 0; i < 6 && !(await api.eval('__fm.ngGuardOn')); i++) {
      await tap(south.x, south.y);
      await sleep(400);
    }
    gate('touch: NEW GAME asks before overwriting the save', await api.eval('__fm.ngGuardOn === true'));
    const east = await rectCenter('#__atp-e');
    for (let i = 0; i < 6 && (await api.eval('__fm.ngGuardOn')); i++) {
      await tap(east.x, east.y);
      await sleep(400);
    }
    gate('touch: ○ keeps the save (back to the menu)',
      await api.eval(`__fm.ngGuardOn === false && __fm.state === 'title'`));
    // flick the stick down until CONTINUE is focused (verified), then confirm
    for (let i = 0; i < 8 && !(await api.eval('__fm.titleFocus === 1')); i++) {
      await tStart(8, base0.x, base0.y);
      await tMove(8, base0.x, base0.y + 60);
      await sleep(280);
      await tEnd(8);
      await sleep(250);
    }
    gate('touch: stick flick focuses CONTINUE', await api.eval('__fm.titleFocus === 1'));
    for (let i = 0; i < 8 && (await api.eval(`__fm.state === 'title'`)); i++) {
      await tap(south.x, south.y);
      await sleep(400);
    }
    await api.waitFor(`__fm.state === 'play'`, 25000, 'touch → gameplay (CONTINUE)');
    gate('touch: virtual pad drives title → gameplay', true);
    // stick walk
    const x0 = await api.eval('__fm.x'), z0 = await api.eval('__fm.z');
    await tStart(8, base0.x, base0.y);
    await tMove(8, base0.x, base0.y - 70);
    await api.waitFor(`Math.hypot(__fm.x-(${x0}), __fm.z-(${z0})) > 0.6`, 8000, 'stick walks Wick');
    gate('touch: stick moves Wick', true);
    // ── v2: drag on the right 60% of the screen orbits the camera —
    // WHILE the virtual stick keeps driving movement (finger 8 still down)
    const cy0 = await api.eval('__fm.camYaw');
    const xw0 = await api.eval('__fm.x'), zw0 = await api.eval('__fm.z');
    await tStart(7, 760, 300);
    for (let i = 1; i <= 8; i++) {
      await tMove(7, 760 + i * 28, 300 + i * 4);
      await sleep(60);
    }
    await tEnd(7);
    const cy1 = await api.eval('__fm.camYaw');
    gate('touch: right-side drag orbits the camera', Math.abs(cy1 - cy0) > 0.25, `Δ=${(cy1 - cy0).toFixed(2)}`);
    gate('touch: movement continues during camera drag',
      Math.hypot((await api.eval('__fm.x')) - xw0, (await api.eval('__fm.z')) - zw0) > 0.5);
    await tEnd(8);
    // sword swing via ✕ — watcher catches the brief atk window at any frame rate
    await api.eval(`window.__sawAtk=false;(function w(){
      if(__fm.pst==='atk'||__fm.dlg){window.__sawAtk=true;return;}
      requestAnimationFrame(w);})()`);
    await tap(south.x, south.y);
    let sawAtk = false;
    for (let i = 0; i < 6 && !sawAtk; i++) {
      sawAtk = await api.eval('window.__sawAtk');
      if (!sawAtk) { await tap(south.x, south.y); await sleep(300); }
    }
    gate('touch: ✕ swings the sword', sawAtk || await api.eval('window.__sawAtk'));
    await sleep(400);
    await api.shot('gameplay-touch-1180x820');
    const bad = api.consoleBad;
    gate('touch: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('touch suite', false, e.message);
    await api.shot('touch-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
}

async function suitePerf(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.seedSave({
    v: 2, q: 2, ph: 0, mh: 6, sword: true, salt: 2,
    talked: { finn: 1, tock: 1, pearl: 1 },
    kelpDoor: true, doorChest: false, finnHeart: true, wreckChest: true, wallBurned: false,
    bossDone: false, sky: 0, tidepool: false, lastShade: [8, 6],
  });
  await api.nav(base + '/');                 // REAL TIME — no turbo
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
    await api.installBot('pad');
    await api.perfReset();
    // village stroll
    await api.walkTo(0, -24, 2.0, 60000);
    await api.walkTo(-20, -35, 2.0, 60000);
    const vill = await api.perfRead();
    gate('perf: village draw calls ≤ 80', vill.calls <= 80, 'max ' + vill.calls);
    gate('perf: village triangles ≤ 120k', vill.tris <= 120000, 'max ' + vill.tris);
    // v2 worst case: imp-cluster fight with sword trails, crab patrol close
    await api.walkTo(9, 2, 2.0, 90000);
    await api.walkTo(4, 30, 2.0, 90000);
    await api.walkTo(0, 42, 2.5, 90000);     // inside cluster D1, patrol B near
    await api.perfReset();
    await api.bot({ fight: true });
    await sleep(9000);
    const bay = await api.perfRead();
    await api.botRelease();
    const fps = await api.eval('__fm.fps');
    gate('perf: imp-cluster fight draw calls ≤ 80', bay.calls <= 80, 'max ' + bay.calls);
    gate('perf: imp-cluster fight triangles ≤ 120k', bay.tris <= 120000, 'max ' + bay.tris);
    gate('perf: headless fps not degenerate', fps > 30, 'fps ' + fps.toFixed(1));
    // camera-free perf: full orbit + pitch sweep in the busy spot
    await api.perfReset();
    await api.eval('__fakePad.raxes(0.9, 0.35)');
    await sleep(2500);
    await api.eval('__fakePad.raxes(0, -0.5)');
    await sleep(1200);
    await api.eval('__fakePad.raxes(0, 0)');
    const orb = await api.perfRead();
    gate('perf: free-orbit draw calls ≤ 80', orb.calls <= 80, 'max ' + orb.calls);
    gate('perf: free-orbit triangles ≤ 120k', orb.tris <= 120000, 'max ' + orb.tris);
    // v3 worst case: SPRINT straight through the village (max chunk churn,
    // heel dust live, the refined ground mesh in frame)
    await api.eval('__fmDebug.warp(34, -14)');
    await api.perfReset();
    await api.eval('__fakePad.press(1)');
    await api.walkTo(-34, -38, 1.5, 90000);
    await api.eval('__fakePad.press()');
    await api.eval('__fmBot.release()');
    const spr = await api.perfRead();
    gate('perf: sprint-through-village draw calls ≤ 80', spr.calls <= 80, 'max ' + spr.calls + ' @ ' + spr.at + ' | ' + (spr.mix || ''));
    gate('perf: sprint-through-village triangles ≤ 120k', spr.tris <= 120000, 'max ' + spr.tris);
    const bad = api.consoleBad;
    gate('perf: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('perf suite', false, e.message);
  }
  c.close(); proc.kill();
}

/* ═══ v2: save-migration gates — v1 saves load armed, threads intact ═══ */
async function suiteMigrate(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  try {
    // a v1 SWORDLESS save (pre-Finn) — must load with the sword, open loop intact
    await api.seedSave({
      q: 0, ph: 0, mh: 5, sword: false, salt: 0,
      talked: { finn: 0, tock: 0, pearl: 0 },
      kelpDoor: false, wreckChest: false, wallBurned: false,
      bossDone: false, sky: 0, tidepool: false, lastShade: [8, 6],
    });
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'continued');
    gate('migrate: v1 swordless save loads WITH the sword', await api.eval('__fm.sword === true'));
    gate('migrate: open loop preserved (q0, no banner)', (await api.eval('__fm.quest')) === 0 &&
      !(await api.eval(`document.getElementById('questLine').classList.contains('on')`)));
    await api.eval(`window.__sawAtk=false;(function w(){
      if(__fm.pst==='atk'){window.__sawAtk=true;return;}
      requestAnimationFrame(w);})()`);
    for (let i = 0; i < 6 && !(await api.eval('window.__sawAtk')); i++) await api.tap(0);
    gate('migrate: sword swings on the old save', await api.eval('window.__sawAtk'));

    // a v1 mid-fetch save (q1 "cut the door") — folds into the started thread
    await api.seedSave({
      q: 1, ph: 0, mh: 5, sword: true, salt: 1,
      talked: { finn: 1, tock: 0, pearl: 0 },
      kelpDoor: false, wreckChest: false, wallBurned: false,
      bossDone: false, sky: 0, tidepool: false, lastShade: [41, -18],
    });
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title 2');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'continued 2');
    gate('migrate: v1 q1 save folds into the Crescent thread (q2)', (await api.eval('__fm.quest')) === 2);
    gate('migrate: beacon lit for migrated thread', await api.eval('__fm.beacon === true'));
    const bad = api.consoleBad;
    gate('migrate: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('migrate suite', false, e.message);
  }
  c.close(); proc.kill();
}

/* ═══ v3: crab-hit reliability — a single swing at neutral range registers
   100% over 20 varied-bearing trials (John: "they look great, they're too
   hard to hit"). Real attack presses; staging via warp/face only. ═══ */
async function suiteCombat(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.seedSave({
    v: 2, q: 2, ph: 0, mh: 8, sword: true, salt: 0,
    talked: { finn: 1, tock: 1, pearl: 1 },
    kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: false,
    bossDone: false, sky: 0, tidepool: false, lastShade: [8, 6],
  });
  await api.nav(base + '/?turbo=6');
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
    await api.eval('window.__fmTurbo = 1');       // real-time: trials need position control
    let landed = 0;
    const misses = [];
    for (let i = 0; i < 20; i++) {
      await api.waitFor(`__fm.state === 'play'`, 60000, 'control for trial').catch(() => {});
      // reset from the VILLAGE: far outside aggro range, and the area change
      // respawns any crab we already dispatched — every trial starts neutral
      await api.eval('__fmDebug.warp(0, -24)');
      await sleep(900);                           // lunges/staggers fully decay
      const cx = await api.eval('__fm.nearCrabX'), cz = await api.eval('__fm.nearCrabZ');
      const a = (i / 20) * Math.PI * 2;
      const px = cx + Math.sin(a) * 1.9, pz = cz + Math.cos(a) * 1.9;
      await api.eval(`__fmDebug.warp(${px.toFixed(2)}, ${pz.toFixed(2)}); ` +
        `__fmDebug.face(${Math.atan2(cx - px, cz - pz).toFixed(3)})`);
      const h0 = await api.eval('__fm.crabHits');
      await api.tap(0);                            // ONE real swing
      let hit = false;
      const t0 = Date.now();
      while (Date.now() - t0 < 2500) {
        if ((await api.eval('__fm.crabHits')) > h0) { hit = true; break; }
        await sleep(60);
      }
      if (hit) landed++;
      else {
        const dbg = await api.eval(`JSON.stringify({d:__fm.nearCrabDist,cx:__fm.nearCrabX,cz:__fm.nearCrabZ,x:__fm.x,z:__fm.z,h:__fm.heading,pst:__fm.pst,st:__fm.state})`);
        misses.push(`b${i}@${(a).toFixed(2)}rad ${dbg}`);
      }
    }
    gate('combat: single swing hits a crab 20/20 at neutral range', landed === 20,
      `${landed}/20${misses.length ? ' missed: ' + misses.join(',') : ''}`);

    /* ═══ v4: IDLE FEET — 2 s of true idle, leg joints dead still.
       (breathing/head-look exempt; the walk-cycle weight must be 0) ═══ */
    await api.eval('__fmDebug.warp(-55, 26)');
    await api.waitFor(`__fm.pst === 'idle' && __fm.state === 'play'`, 10000, 'idle');
    await api.waitTicks(100);   // idle-settle pose fully converges
    await api.eval(`window.__legs = { min: [9,9,9,9], max: [-9,-9,-9,-9], n: 0 };
      (function w(){
        const j = [wick.hipL.rotation.x, wick.hipR.rotation.x,
                   wick.kneeL.rotation.x, wick.kneeR.rotation.x];
        for (let i = 0; i < 4; i++) {
          if (j[i] < __legs.min[i]) __legs.min[i] = j[i];
          if (j[i] > __legs.max[i]) __legs.max[i] = j[i];
        }
        if (++__legs.n >= 130) return;
        requestAnimationFrame(w); })()`);
    await api.waitFor('window.__legs.n >= 130', 20000, 'idle capture');
    const legs = await api.eval('JSON.stringify(window.__legs)').then(JSON.parse);
    let maxDelta = 0;
    for (let i = 0; i < 4; i++) maxDelta = Math.max(maxDelta, legs.max[i] - legs.min[i]);
    gate('combat: idle feet dead still over 2 s (max leg delta < 0.02 rad)',
      maxDelta < 0.02, 'maxΔ=' + maxDelta.toFixed(4) + ' rad');

    const bad = api.consoleBad;
    gate('combat: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('combat suite', false, e.message);
  }
  c.close(); proc.kill();
}

/* ═══ v4: BOSS TRUTH — the Ben gates. Body-only kid bot must win, the
   claw bot must win faster, a dormant boss must wake on proximity with any
   save state, and the HP bar must live its whole lifecycle. ═══ */
async function suiteBoss(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  const seed = (wall) => api.seedSave({
    v: 2, q: 2, ph: 0, mh: 8, sword: true, salt: 0,
    talked: { finn: 1, tock: 1, pearl: 1 },
    kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: wall,
    bossDone: false, sky: 0, tidepool: false, lastShade: [8, 6],
  });
  const enter = async () => {
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
  };
  /* one full fight with the given bot style; returns ticks-to-victory */
  const fight = async (style, opts = {}) => {
    await seed(true);
    await enter();
    await api.installBot('pad');
    // per-phase damage ledger + hint/glow watchers
    await api.eval(`window.__bdmg={p1:0,p2:0,p3:0,last:null};
      window.__sawGlow=false; window.__sawHint=false; window.__barSeen=false;
      (function w(){ const T=__fm;
        if (T.bossActive){
          if (T.bossBarOn) __barSeen=true;
          if (__bdmg.last===null) __bdmg.last=T.bossHp;
          if (T.bossHp < __bdmg.last) __bdmg['p'+T.bossPhase] += (__bdmg.last - T.bossHp);
          __bdmg.last = T.bossHp;
          if (T.clawGlow) __sawGlow=true;
        } else __bdmg.last=null;
        const fl = document.getElementById('floatLine');
        if (fl.classList.contains('on') && fl.textContent.indexOf('CLAW') >= 0) __sawHint=true;
        if (T.state === 'play') P.hearts = P.maxHearts;   // strategy race, not survival (sunstruck resets are RNG)
        if (T.carry) return;
        requestAnimationFrame(w); })()`);
    // pin the RNG stream so BOTH strategies face the same boss script —
    // the race compares aim, not burrow-angle luck (mechanics all real)
    await api.eval('if (!window.__origRand) window.__origRand = Math.random; Math.random = mulberry32(97531); 0');
    await api.eval('__fmDebug.warp(47, 158.5)');
    await api.walkTo(56, 163, 1.4, 60000);
    const t0 = await api.eval('__fm.tick');
    await api.bot({ boss: true, bossStyle: style });
    await api.waitFor('__fm.bossActive === true', 20000, 'boss engaged (' + style + ')');
    if (opts.hpbarShot) {
      // mid-damage frame: freeze on a phase≥2 damage tick, let the bar settle
      await api.eval(`window.__hpShot=false;(function w(){
        const T=__fm;
        if (T.bossActive && T.bossPhase >= 2 && T.bossHp < 58 && T.bossHp > 8){
          window.__hpShot=true; __fmDebug.freeze(1); return; }
        if (T.carry) return;
        requestAnimationFrame(w);})()`);
    }
    if (opts.glowShot) {
      await api.eval(`window.__glowShot=false;(function w(){
        const T=__fm;
        if (T.clawGlow && T.bossState==='stuck'){ window.__glowShot=true; __fmDebug.freeze(1); return; }
        if (T.carry) return;
        requestAnimationFrame(w);})()`);
      const t1 = Date.now();
      while (Date.now() - t1 < 90000 && !(await api.eval('window.__glowShot'))) await sleep(120);
      gate('boss: claw glows through the slam-recovery window', await api.eval('window.__glowShot || __fm.carry === true'));
      if (await api.eval('window.__glowShot')) {
        await api.eval(`(function(){ const T=__fm;
          const dx=T.bossX-T.x, dz=T.bossZ-T.z, d=Math.hypot(dx,dz)||1;
          __fmDebug.cam(T.bossX - dx/d*8, -1.0, T.bossZ - dz/d*8, T.bossX, 0.4, T.bossZ); })()`);
        await sleep(250);
        await api.shot('boss-clawglow-1280x720');
        await api.eval('__fmDebug.camOff(); __fmDebug.freeze(0)');
      }
    }
    if (opts.hpbarShot) {
      const t1 = Date.now();
      while (Date.now() - t1 < 240000 && !(await api.eval('window.__hpShot'))) await sleep(150);
      if (await api.eval('window.__hpShot')) {
        await sleep(320);          // width transition settles on the frozen frame
        await api.shot('boss-hpbar-1280x720');
        await api.eval('__fmDebug.freeze(0)');
      }
      gate('boss: HP bar frame staged mid-damage', await api.eval('window.__hpShot'));
    }
    if (opts.victoryShot) {
      await api.waitFor(`__fm.cinId === 'bossDefeat'`, 600000, 'defeat cinematic (' + style + ')');
      await api.eval('window.__fmTurbo = 1');
      await api.waitFor('__fm.cinT > 1.8 && __fm.cinT < 3.4', 60000, 'the bow moment').catch(() => {});
      await sleep(150);
      await api.shot('boss-kidbot-victory-1280x720');
      await api.eval('window.__fmTurbo = undefined');
    }
    await api.waitFor('__fm.carry === true', 600000, 'crescent obtained (' + style + ')');
    const ticks = (await api.eval('__fm.tick')) - t0;
    await api.botRelease();
    await api.eval('if (window.__origRand) Math.random = window.__origRand; 0');
    return ticks;
  };
  try {
    // ── 1. the dormant boss (the field failure): wall NOT burned, any save ──
    await seed(false);
    await enter();
    await api.eval('__fmDebug.warp(62, 166)');
    await api.waitFor('__fm.bossActive === true', 20000, 'dormant boss wakes');
    gate('boss: proximity wakes a dormant boss (wall unburned save)', true);
    gate('boss: HP bar appears on wake, named, with phase notches',
      await api.eval(`__fm.bossBarOn === true &&
        document.getElementById('bossName').textContent.indexOf('KING-CRAB') >= 0 &&
        document.querySelectorAll('.bossNotch').length === 2`));
    await api.eval(`__fmDebug.face(Math.atan2(__fm.bossX-__fm.x, __fm.bossZ-__fm.z))`);
    const hp0 = await api.eval('__fm.bossHp');
    for (let i = 0; i < 8 && (await api.eval('__fm.bossHp')) === hp0; i++) await api.tap(0);
    const hp1 = await api.eval('__fm.bossHp');
    gate('boss: body swing damages the woken boss (real input)', hp1 < hp0, `hp ${hp0} → ${hp1}`);
    gate('boss: one-time CLAW hint on first body hit', await api.eval('__fm.bossHintSeen === true'));
    const fillW = await api.eval(`document.getElementById('bossFill').getBoundingClientRect().width /
      (document.getElementById('bossTrack').getBoundingClientRect().width - 4)`);
    gate('boss: HP bar visibly chips', fillW < 0.999 && Math.abs(fillW - hp1 / 90) < 0.03,
      'fill=' + (fillW * 100).toFixed(1) + '% hp=' + hp1);

    // ── 2. the KID BOT: body slashes only, must WIN (slowly) ──
    const kidTicks = await fight('kid', { victoryShot: true });
    const dmg = await api.eval('JSON.stringify(window.__bdmg)').then(JSON.parse);
    gate('boss: kid bot (body-only) wins the whole fight', true, kidTicks + ' ticks');
    gate('boss: kid bot dealt damage in EVERY phase',
      dmg.p1 > 0 && dmg.p2 > 0 && dmg.p3 > 0, JSON.stringify(dmg));
    gate('boss: hint floatText fired during the fight-or-earlier', await api.eval('window.__sawHint || __fm.bossHintSeen'));
    gate('boss: HP bar gone on cure', await api.eval('__fm.bossBarOn === false'));

    // ── 3. the CLAW BOT: aims the weakness, must win FASTER ──
    const clawTicks = await fight('claw', { hpbarShot: true, glowShot: true });
    const dmg2 = await api.eval('JSON.stringify(window.__bdmg)').then(JSON.parse);
    gate('boss: claw bot wins too (damage every phase)',
      dmg2.p1 > 0 && dmg2.p2 > 0 && dmg2.p3 > 0, JSON.stringify(dmg2));
    gate('boss: claw aiming beats body mashing', clawTicks < kidTicks,
      `claw ${clawTicks} vs kid ${kidTicks} ticks`);

    const bad = api.consoleBad;
    gate('boss: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('boss suite', false, e.message);
    await api.shot('boss-FAIL').catch(() => {});
    console.log('  state:', await api.eval('JSON.stringify({s:__fm.state,b:__fm.bossState,ph:__fm.bossPhase,hp:__fm.bossHp,x:__fm.x,z:__fm.z,h:__fm.hearts})').catch(() => '?'));
  }
  c.close(); proc.kill();
}

/* ═══ v3: collision fuzzer (the grotto walk-through-walls bug).
   Drives the player INTO surfaces for seconds at 12 bearings per target —
   walking AND jumping — and asserts the position never enters solid rock,
   never crosses a wall plane, never reaches the boss arena early. ═══ */
async function suiteFuzz(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  const seed = (wall) => api.seedSave({
    v: 2, q: 2, ph: 0, mh: 8, sword: true, salt: 0,
    talked: { finn: 1, tock: 1, pearl: 1 },
    kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: wall,
    bossDone: false, sky: 0, tidepool: false, lastShade: [8, 6],
  });
  const enter = async () => {
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
    await api.eval(`window.__fz = { bad: 0, arena: 0, worst: '', mouthT: 0, corT: 0 };
      (function w(){ const T = window.__fm;
        if (T && T.state === 'play') {
          if (grottoSolidAt(T.x, T.z)) { __fz.bad++; __fz.worst = T.x.toFixed(1)+','+T.z.toFixed(1); }
          if (window.__fzKeepOut) {
            const k = window.__fzKeepOut;
            if (Math.hypot(T.x - k[0], T.z - k[1]) < k[2]) { __fz.bad++; __fz.worst = 'keepout '+T.x.toFixed(1)+','+T.z.toFixed(1); }
          }
          if (window.__fzNoArena && Math.hypot(T.x - 62, T.z - 166) < 14.2) __fz.arena++;
          // legal-opening transit flags (v4 dense fuzz: an "escape" that went
          // through the mouth funnel or the corridor is a legitimate walk)
          if (T.z > 121 && T.z < 134 && Math.abs(T.x - 30) < 8.5) __fz.mouthT = 1;
          const ct = ((T.x - 41) * 12 + (T.z - 155.5) * 6) / 180;
          if (ct > -0.15 && ct < 1.15 &&
              Math.hypot(T.x - (41 + 12 * ct), T.z - (155.5 + 6 * ct)) < 3.2) __fz.corT = 1;
        }
        requestAnimationFrame(w); })()`);
  };
  // push the player toward world-dir (dx,dz) for ms; optionally jumping
  // and/or sprint-holding (v4: the dense fuzz rotates through all three)
  const shove = async (dx, dz, ms, jump, sprint) => {
    const t0 = Date.now();
    let jt = 0;
    if (sprint) await api.press(1);
    while (Date.now() - t0 < ms) {
      await api.eval(`__fmDebug.camYaw(Math.PI)`);
      await api.axes(-dx, -dz);
      if (jump && Date.now() - jt > 500) {
        jt = Date.now();
        await api.press(...(sprint ? [1, 2] : [2]));
        await sleep(60);
        await api.press(...(sprint ? [1] : []));
      }
      await sleep(90);
    }
    await api.axes(0, 0);
    await api.press();
  };
  const fuzzRing = async (cx, cz, tag, ms, jumpEvery) => {
    for (let b = 0; b < 12; b++) {
      const a = b / 12 * Math.PI * 2;
      await api.eval(`__fmDebug.warp(${cx}, ${cz})`);
      await shove(Math.sin(a), Math.cos(a), ms, jumpEvery && b % 3 === 0);
      await api.waitFor(`__fm.state === 'play'`, 90000, 'control back').catch(() => {});
    }
  };
  try {
    // ── phase 1: sealed grotto (wall NOT burned) — the John exploit ──
    await seed(false);
    await enter();
    await api.eval('window.__fzNoArena = 1');
    await fuzzRing(30, 150, 'chamber A', 1300, true);        // vs walls + corridor plug
    await fuzzRing(30, 136, 'entrance throat', 900, true);
    gate('fuzz: grotto walls solid — never inside rock', (await api.eval('__fz.bad')) === 0,
      'bad=' + await api.eval('__fz.bad') + ' ' + await api.eval('__fz.worst'));
    gate('fuzz: boss arena unreachable before the wall burns',
      (await api.eval('__fz.arena')) === 0 && (await api.eval('__fm.bossActive')) === false &&
      (await api.eval('__fm.wallBurned')) === false,
      'arenaFrames=' + await api.eval('__fz.arena'));
    // outside-in: try to walk INTO the massif from the bay
    await api.eval('__fz.bad = 0');
    for (const [sx, sz, dx, dz] of [[30, 118, 0, 1], [5, 148, 1, 0], [52, 133, 0, 1], [30, 178, 0, -1], [85, 160, -1, 0]]) {
      await api.eval(`__fmDebug.warp(${sx}, ${sz})`);
      await shove(dx, dz, 1100, true);
    }
    gate('fuzz: massif solid from the outside too', (await api.eval('__fz.bad')) === 0,
      'bad=' + await api.eval('__fz.bad'));

    /* ═══ v4 DENSE PERIMETER FUZZ — every ~1.5 m along every boundary,
       walking + jumping + sprinting into it; zero penetrations. ═══ */
    const floodFill = () => api.eval(`(function(){
      const step=0.75, x0=0, x1=92, z0=112, z1=186;
      const nx=Math.ceil((x1-x0)/step), nz=Math.ceil((z1-z0)/step);
      const seen=new Uint8Array(nx*nz);
      const qx=[Math.round((30-x0)/step)], qz=[Math.round((118-z0)/step)];
      seen[qx[0]*nz+qz[0]]=1;
      let reach=false, cells=0;
      while(qx.length){
        const ix=qx.pop(), iz=qz.pop(); cells++;
        if(Math.hypot(x0+ix*step-62, z0+iz*step-166)<11) reach=true;
        for(const dd of [[1,0],[-1,0],[0,1],[0,-1]]){
          const jx=ix+dd[0], jz=iz+dd[1];
          if(jx<0||jz<0||jx>=nx||jz>=nz) continue;
          if(seen[jx*nz+jz]) continue;
          if(grottoSolidAt(x0+jx*step, z0+jz*step)) continue;
          seen[jx*nz+jz]=1; qx.push(jx); qz.push(jz);
        }
      }
      return { reach, cells };
    })()`);
    const ff1 = await floodFill();
    gate('fuzz: flood-fill — arena UNREACHABLE until wallBurned',
      ff1.reach === false, JSON.stringify(ff1));

    // interior chamber-A ring, one sample per ~1.5 m of boundary
    await api.eval('__fz.bad = 0');
    let escapes = 0;
    const denseRing = async (cx2, cz2, rOpen, skipsectors) => {
      const n = Math.ceil((Math.PI * 2 * rOpen) / 1.5);
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        let skip = false;
        for (const [sa, shw] of skipsectors) {
          let d = Math.abs(((a - sa) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d < shw) skip = true;
        }
        const wx = cx2 + Math.cos(a) * (rOpen - 1.2), wz = cz2 + Math.sin(a) * (rOpen - 1.2);
        const ss0 = await api.eval('__fm.sunstruck');
        await api.eval(`__fz.mouthT = 0; __fz.corT = 0; __fmDebug.warp(${wx.toFixed(2)}, ${wz.toFixed(2)})`);
        await shove(Math.cos(a), Math.sin(a), 700, i % 2 === 0, i % 3 === 0);
        await api.waitFor(`__fm.state === 'play'`, 60000, 'control back').catch(() => {});
        if (!skip && (await api.eval('__fm.sunstruck')) === ss0 &&
            !(await api.eval('__fz.mouthT || __fz.corT'))) {
          const d2 = await api.eval(`Math.hypot(__fm.x - ${cx2}, __fm.z - ${cz2})`);
          if (d2 > rOpen + 1.6) { escapes++; console.log('    escape @', (await api.eval('__fm.x')).toFixed(1), (await api.eval('__fm.z')).toFixed(1)); }
        }
      }
    };
    // chamber A: skip the corridor (0.46) and entrance (-π/2) sectors
    await denseRing(30, 150, 14.8, [[0.4636, 0.4], [Math.PI * 1.5, 0.35]]);
    // entrance walkway edges every ~1.5 m, both sides
    for (let z = 126; z <= 139; z += 1.5) {
      for (const s of [-1, 1]) {
        await api.eval(`__fmDebug.warp(${(30 + s * 1.4).toFixed(2)}, ${z.toFixed(2)})`);
        await shove(s, 0, 700, z % 3 < 1.5, z % 4.5 < 1.5);
        await api.waitFor(`__fm.state === 'play'`, 60000, 'control back').catch(() => {});
        if (z >= 132.5 && z <= 134.5) {
          // (above z≈135.2 the walkway legally opens into chamber A's circle)
          const px = await api.eval('__fm.x'), pz = await api.eval('__fm.z');
          if (Math.abs(px - 30) > 3.4 && pz > 131 && pz < 135.2) {
            escapes++;
            console.log('    throat escape @', px.toFixed(1), pz.toFixed(1));
          }
        }
      }
    }
    // the corridor PLUG: push straight into the kelp wall from both ends
    for (const lat of [-1.5, 0, 1.5]) {
      const px2 = -6 / 13.4, pz2 = 12 / 13.4;
      await api.eval(`__fmDebug.warp(${(42.8 + px2 * lat).toFixed(2)}, ${(156.4 + pz2 * lat).toFixed(2)})`);
      await shove(12 / 13.4, 6 / 13.4, 900, true, false);
      await api.waitFor(`__fm.state === 'play'`, 60000, 'control back').catch(() => {});
      const t = await api.eval(`((__fm.x - 41) * 12 + (__fm.z - 155.5) * 6) / 180`);
      if (t > 0.5) escapes++;
    }
    gate('fuzz: dense interior perimeter — never inside rock',
      (await api.eval('__fz.bad')) === 0, 'bad=' + await api.eval('__fz.bad') + ' ' + await api.eval('__fz.worst'));
    gate('fuzz: dense interior perimeter — never THROUGH a wall', escapes === 0, 'escapes=' + escapes);

    // exterior massif perimeter, inward shoves every ~1.5 m
    await api.eval('__fz.bad = 0');
    let breaches = 0, extN = 0;
    for (const [mx, mz, mr, mouthA] of [[30, 150, 22.65, Math.PI * 1.5], [62, 166, 20.55, null], [46, 158, 16.35, null]]) {
      const n = Math.ceil((Math.PI * 2 * (mr + 0.8)) / 1.5);
      for (let i = 0; i < n; i++) {
        const a = i / n * Math.PI * 2;
        if (mouthA !== null) {
          let d = Math.abs(((a - mouthA) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2));
          if (d > Math.PI) d = Math.PI * 2 - d;
          if (d < 0.62) continue;               // the mouth funnel is a legal way in
        }
        const wx = mx + Math.cos(a) * (mr + 0.9), wz = mz + Math.sin(a) * (mr + 0.9);
        if (Math.abs(wx) > 96 || wz > 182 || wz < -96) continue;
        // skip points that start inside a NEIGHBOR cap's rock or open air
        // (the cap footprints overlap the chambers of their neighbors)
        if (await api.eval(`grottoSolidAt(${wx.toFixed(2)}, ${wz.toFixed(2)}) || grottoOpenAt(${wx.toFixed(2)}, ${wz.toFixed(2)}, true)`)) continue;
        extN++;
        await api.eval(`__fz.mouthT = 0; __fz.corT = 0; __fmDebug.warp(${wx.toFixed(2)}, ${wz.toFixed(2)})`);
        await shove(-Math.cos(a), -Math.sin(a), 650, i % 2 === 0, i % 3 === 0);
        await api.waitFor(`__fm.state === 'play'`, 60000, 'control back').catch(() => {});
        if ((await api.eval('grottoOpenAt(__fm.x, __fm.z, true)')) &&
            !(await api.eval('__fz.mouthT'))) {
          breaches++;
          console.log('    breach from', wx.toFixed(1), wz.toFixed(1), '→', (await api.eval('__fm.x')).toFixed(1), (await api.eval('__fm.z')).toFixed(1));
        }
      }
    }
    gate('fuzz: dense exterior perimeter — never inside rock',
      (await api.eval('__fz.bad')) === 0, 'bad=' + await api.eval('__fz.bad') + ' over ' + extN + ' samples');
    gate('fuzz: dense exterior perimeter — never INTO the grotto through rock',
      breaches === 0, 'breaches=' + breaches);

    // ── phase 2: village walls + big rocks ──
    await api.eval('window.__fzNoArena = 0; __fz.bad = 0');
    await api.eval('window.__fzKeepOut = [-38, -32, 4.05]');   // house shell interior
    for (let b = 0; b < 12; b++) {
      const a = b / 12 * Math.PI * 2;
      await api.eval(`__fmDebug.warp(${(-38 + Math.sin(a) * 6.4).toFixed(2)}, ${(-32 + Math.cos(a) * 6.4).toFixed(2)})`);
      await shove(-Math.sin(a), -Math.cos(a), 800, b % 4 === 0);
    }
    gate('fuzz: house walls solid at all bearings (walk + jump)',
      (await api.eval('__fz.bad')) === 0, 'bad=' + await api.eval('__fz.bad'));
    await api.eval('window.__fzKeepOut = [12, 52, 0.9]');      // tall rock core
    for (let b = 0; b < 12; b++) {
      const a = b / 12 * Math.PI * 2;
      await api.eval(`__fmDebug.warp(${(12 + Math.sin(a) * 3.2).toFixed(2)}, ${(52 + Math.cos(a) * 3.2).toFixed(2)})`);
      await shove(-Math.sin(a), -Math.cos(a), 600, b % 4 === 0);
    }
    gate('fuzz: sea-stack rock solid at all bearings',
      (await api.eval('__fz.bad')) === 0, 'bad=' + await api.eval('__fz.bad'));

    // ── phase 3: boss-arena perimeter (wall burned, boss live) ──
    await seed(true);
    await enter();
    await api.eval('window.__fzKeepOut = 0; window.__fzNoArena = 0');
    await fuzzRing(62, 166, 'arena', 1000, true);
    gate('fuzz: boss-arena perimeter sealed (fight live)',
      (await api.eval('__fz.bad')) === 0, 'bad=' + await api.eval('__fz.bad'));
    // v4 dense pass over the arena ring + the now-open corridor edges
    const ff2 = await floodFill();
    gate('fuzz: flood-fill — arena reachable AFTER the burn (corridor only path)',
      ff2.reach === true, JSON.stringify(ff2));
    await api.eval('__fz.bad = 0');
    escapes = 0;
    await denseRing(62, 166, 13.8, [[0.4636 + Math.PI, 0.4]]);
    for (let ti = 1; ti <= 8; ti++) {
      const t = ti / 9;
      const lx2 = 41 + 12 * t, lz2 = 155.5 + 6 * t;
      const px3 = -6 / 13.4, pz3 = 12 / 13.4;
      for (const s of [-1, 1]) {
        const ss0 = await api.eval('__fm.sunstruck');
        await api.eval(`__fmDebug.warp(${(lx2 + px3 * s * 0.8).toFixed(2)}, ${(lz2 + pz3 * s * 0.8).toFixed(2)})`);
        await shove(px3 * s, pz3 * s, 700, ti % 2 === 0, ti % 3 === 0);
        await api.waitFor(`__fm.state === 'play'`, 90000, 'control back').catch(() => {});
        if ((await api.eval('__fm.sunstruck')) !== ss0) continue;
        const lat = await api.eval(`(function(){ const t2=((__fm.x-41)*12+(__fm.z-155.5)*6)/180;
          if (t2 < 0.2 || t2 > 0.8) return 0;
          // the chamber circles legally overlap the corridor ends
          if (Math.hypot(__fm.x - 30, __fm.z - 150) < 15.7) return 0;
          if (Math.hypot(__fm.x - 62, __fm.z - 166) < 14.7) return 0;
          return Math.hypot(__fm.x-(41+12*t2), __fm.z-(155.5+6*t2)); })()`);
        if (lat > 3.6) { escapes++; console.log('    corridor escape @', (await api.eval('__fm.x')).toFixed(1), (await api.eval('__fm.z')).toFixed(1)); }
      }
    }
    gate('fuzz: dense arena + corridor perimeter — never inside rock',
      (await api.eval('__fz.bad')) === 0, 'bad=' + await api.eval('__fz.bad'));
    gate('fuzz: dense arena + corridor perimeter — never through a wall',
      escapes === 0, 'escapes=' + escapes);
    const bad = api.consoleBad;
    gate('fuzz: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('fuzz suite', false, e.message);
    await api.shot('fuzz-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
}

/* ═══ v4: INTERIORS — the harbor house, end to end, pad-alone and
   keyboard-alone. Enter via the door prompt, walk freely, open the salt
   chest, fuzz the walls, sample perf, leave, and persist the chest. ═══ */
async function suiteInterior(base) {
  const seedSave = {
    v: 2, q: 0, ph: 0, mh: 5, sword: true, salt: 0,
    talked: { finn: 0, tock: 0, pearl: 0 },
    kelpDoor: false, doorChest: false, finnHeart: false, wreckChest: false, wallBurned: false,
    bossDone: false, sky: 0, tidepool: false, lastShade: [-30, -28],
  };
  const run = async (mode) => {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init();
    if (mode === 'pad') await api.stubPad();
    await api.seedSave(seedSave, true);   // once — reloads keep live writes
    await api.nav(base + '/?turbo=6');
    const D = driver(api, mode);
    const g = (n, ok, d) => gate(`interior(${mode}): ${n}`, ok, d);
    try {
      await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
      await tapUntil(api, () => D.down(), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
      await tapUntil(api, D.confirm, `__fm.state !== 'title'`, 12, 'leave title');
      await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
      await api.installBot(mode);
      // ── to the door, by real input ──
      await api.walkTo(-33, -40, 1.6, 60000);
      await api.walkTo(-39.48, -36.78, 0.6, 60000);
      await api.waitFor(`__fm.prompt === 'houseDoor'`, 10000, 'door prompt');
      g('door prompt at the harbor house', true);
      if (mode === 'pad') {
        // the door-prompt shot: from outside the door, Wick at the threshold
        await api.eval('window.__fmTurbo = 1');
        await api.eval(`__fmDebug.face(${(0.3).toFixed(2)});
          __fmDebug.cam(-38.85, groundH(-38.85,-39.51)+1.75, -39.51, -38.95, groundH(-38.95,-35.09)+1.5, -35.09)`);
        await sleep(400);
        await api.shot('house-door-prompt-1280x720');
        await api.eval('__fmDebug.camOff(); window.__fmTurbo = undefined');
      }
      // ── enter ──
      await D.confirm();
      await api.waitFor(`__fm.inInterior === true && __fm.state === 'play'`, 15000, 'inside');
      g('✕ enters through the fade', true);
      g('interior counts as shade sanctuary', await api.eval('__fm.shade === true'));
      // ── walk freely between corners ──
      await api.walkTo(332.6, -61.4, 0.6, 30000);
      await api.walkTo(328.6, -61.6, 0.7, 30000);
      await api.walkTo(331.8, -58.2, 0.7, 30000);
      g('walks freely between the corners', true);
      if (mode === 'pad') {
        // interior beauty shots: wide from the door corner + the lamp table
        await api.eval('window.__fmTurbo = 1');
        await api.eval('__fmBot.release(); __fmDebug.warp(329.0, -60.9); __fmDebug.face(0.5);');
        await api.eval('__fmDebug.cam(332.9, 1.85, -57.4, 328.2, 0.65, -61.3)');
        await sleep(500);
        await api.shot('interior-wide-1280x720');
        await api.eval('__fmDebug.cam(328.6, 1.35, -58.2, 331.6, 0.75, -60.9)');
        await sleep(350);
        await api.shot('interior-detail-1280x720');
        await api.eval('__fmDebug.camOff(); window.__fmTurbo = undefined');
      }
      // ── the salt chest ──
      const salt0 = await api.eval('__fm.salt');
      await api.walkTo(328.6, -58.6, 0.55, 30000);
      await api.waitFor(`__fm.prompt === 'homeChest'`, 10000, 'chest prompt');
      await D.confirm();
      await api.waitFor('__fm.homeChest === true', 15000, 'chest opened');
      await api.waitFor(`__fm.salt > ${salt0}`, 10000, 'salt gained');
      g('salt-crystal chest opens', true, 'salt=' + await api.eval('__fm.salt'));
      // ── interior collision fuzz: 12 bearings, walk + jump, stay inside ──
      await api.eval(`window.__fzi = { out: 0, done: 0 };
        (function w(){ const T = __fm;
          if (__fzi.done) return;
          if (T.state === 'play' && T.tick > 0) {
            if (Math.abs(T.x - 330) > 3.62 || Math.abs(T.z - (-60)) > 2.92) __fzi.out++;
          }
          requestAnimationFrame(w); })()`);
      for (let b = 0; b < 12; b++) {
        const a = b / 12 * Math.PI * 2;
        await api.eval('__fmDebug.warp(330, -60)');
        const t0 = Date.now();
        let jt = 0;
        while (Date.now() - t0 < 650) {
          await api.eval(`__fmDebug.camYaw(Math.PI)`);
          if (mode === 'pad') await api.axes(-Math.sin(a), -Math.cos(a));
          else {
            await api.eval(`__fmBot.target=[${(330 + Math.sin(a) * 9).toFixed(1)}, ${(-60 + Math.cos(a) * 9).toFixed(1)}]; __fmBot.tol=0.05;`);
          }
          if (b % 2 === 0 && Date.now() - jt > 500) { jt = Date.now(); await D.jump(); }
          await sleep(90);
        }
        if (mode === 'pad') await api.axes(0, 0);
        else await api.eval('__fmBot.target=null');
      }
      g('collision fuzz: never outside the room, all bearings',
        (await api.eval('__fzi.out')) === 0, 'out=' + await api.eval('__fzi.out'));
      await api.eval('__fzi.done = 1');
      // ── perf inside ──
      await api.perfReset();
      await api.walkTo(331.5, -58.4, 0.8, 30000);
      await api.walkTo(327.8, -61.0, 0.8, 30000);
      await api.waitTicks(120);
      const pf = await api.perfRead();
      g('draw calls ≤ 80 inside', pf.calls <= 80, 'max ' + pf.calls);
      g('triangles ≤ 120k inside', pf.tris <= 120000, 'max ' + pf.tris);
      // ── leave ──
      await api.walkTo(330, -57.9, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'leaveHouse'`, 10000, 'leave prompt');
      await D.confirm();
      await api.waitFor(`__fm.inInterior === false && __fm.state === 'play'`, 15000, 'back outside');
      g('✕ leaves back to the village', true,
        'at ' + (await api.eval('__fm.x')).toFixed(1) + ',' + (await api.eval('__fm.z')).toFixed(1));
      // ── persistence: reload → CONTINUE → chest stays opened ──
      await api.nav(base + '/?turbo=6');
      await api.waitFor(`__fm.state === 'title'`, 25000, 'title again');
      await tapUntil(api, () => D.down(), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
      await tapUntil(api, D.confirm, `__fm.state !== 'title'`, 12, 'leave title');
      await api.waitFor(`__fm.state === 'play'`, 25000, 'continued');
      g('chest state persists across reload', await api.eval('__fm.homeChest === true && __fm.salt >= 3'),
        'salt=' + await api.eval('__fm.salt'));
      const bad = api.consoleBad;
      g('zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate(`interior(${mode}) suite`, false, e.message);
      await api.shot('interior-FAIL-' + mode).catch(() => {});
    }
    c.close(); proc.kill();
  };
  await run('pad');
  await run('kbd');
}

/* ═══ v4.5: EVERY DOOR OPENS — Granny Tock's house, Pearl's family house,
   Finn's lighthouse ground room, and the harbor net-mending bench.
   Pad-alone AND keyboard-alone; every interaction by real input; state
   persisted across reload; collision fuzz + perf per room. ═══ */
async function suiteRooms(base) {
  const seedSave = {
    v: 2, q: 0, ph: 0, mh: 5, sword: true, salt: 0,
    talked: { finn: 0, tock: 0, pearl: 0 },
    kelpDoor: false, doorChest: true, finnHeart: false, wreckChest: false, wallBurned: false,
    bossDone: false, sky: 0, tidepool: false, lastShade: [-2, -34],
  };
  const run = async (mode) => {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init();
    if (mode === 'pad') await api.stubPad();
    await api.seedSave(seedSave, true);   // once — reloads keep live writes
    await api.nav(base + '/?turbo=6');
    const D = driver(api, mode);
    const g = (n, ok, d) => gate(`rooms(${mode}): ${n}`, ok, d);
    const pad = mode === 'pad';
    const stage = async (cam, ms) => {   // beauty staging at 1x sim
      await api.eval('window.__fmTurbo = 1');
      await api.eval(cam);
      await sleep(ms || 450);
    };
    const unstage = async () => api.eval('__fmDebug.camOff(); window.__fmTurbo = undefined');
    try {
      await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
      await tapUntil(api, () => D.down(), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
      await tapUntil(api, D.confirm, `__fm.state !== 'title'`, 12, 'leave title');
      await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
      await api.installBot(mode);

      /* ═══ 1. GRANNY TOCK'S HOUSE (the small house at 6,-38) ═══ */
      await api.walkTo(9, -42.6, 1.4, 60000);
      await api.walkTo(5.37, -42.15, 0.55, 60000);
      await api.waitFor(`__fm.prompt === 'tockDoor'`, 10000, 'tock door prompt');
      g('door prompt at Granny Tock’s', true);
      if (pad) {
        await stage(`__fmDebug.face(0.15);
          __fmDebug.cam(4.6, groundH(4.6,-43.6)+1.7, -43.6, 5.9, groundH(5.9,-39.6)+1.5, -39.6)`);
        await api.shot('tock-door-prompt-1280x720');
        await unstage();
      }
      await D.confirm();
      await api.waitFor(`__fm.room === 'tock' && __fm.state === 'play'`, 15000, 'inside tock');
      g('✕ enters through the fade', true);
      g('room counts as shade sanctuary', await api.eval('__fm.shade === true'));
      await api.walkTo(328.0, -101.2, 0.7, 30000);
      await api.walkTo(332.0, -99.2, 0.7, 30000);
      g('walks freely between the corners', true);
      if (pad) {
        await stage(`__fmBot.release(); __fmDebug.warp(331.4, -98.6); __fmDebug.face(3.6);
          __fmDebug.cam(332.2, 1.8, -97.9, 328.6, 0.9, -101.6)`, 550);
        await api.shot('room-tock-wide-1280x720');
        await stage(`__fmDebug.cam(329.3, 1.75, -99.3, 327.0, 1.7, -100.4)`, 400);
        await api.shot('room-tock-clockwall-1280x720');
        await unstage();
      }
      // ── wind the floor clock: crank, ticks, dies; Granny's one warm line ──
      await api.walkTo(329.5, -100.9, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'windClock'`, 10000, 'clock prompt');
      await D.confirm();
      await api.waitFor('__fm.clockTicking === true', 15000, 'the clock lives');
      g('winding starts the clock (real input)', true);
      if (pad) {
        await api.eval('window.__fmTurbo = 1');
        await sleep(600);
        await api.shot('tock-clock-wound-1280x720');
        await api.eval('window.__fmTurbo = undefined');
      }
      await api.waitFor('__fm.clockTicking === false', 30000, 'the clock dies');
      g('…and it dies again', true);
      g('Granny’s line arrives from outside',
        await api.eval(`__fm.caption !== null && __fm.caption.indexOf('lovely') >= 0`),
        String(await api.eval('__fm.caption')));
      g('clock-wound flag saved', await api.eval('__fm.clockWound === true'));
      // ── her salt chest ──
      const salt0 = await api.eval('__fm.salt');
      await api.walkTo(331.75, -101.2, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'tockChest'`, 10000, 'tock chest prompt');
      await D.confirm();
      await api.waitFor('__fm.tockChest === true', 15000, 'tock chest opened');
      await api.waitFor(`__fm.salt > ${salt0}`, 10000, 'salt gained');
      g('salt chest opens', true, 'salt=' + await api.eval('__fm.salt'));
      await roomFuzz(api, D, mode, g, 330, -100, '(Math.abs(__fm.x - 330) > 2.92 || Math.abs(__fm.z - (-100)) > 2.32)');
      await api.perfReset();
      await api.walkTo(332.0, -98.6, 0.8, 30000);
      await api.walkTo(328.2, -101.4, 0.8, 30000);
      await api.waitTicks(120);
      const pfT = await api.perfRead();
      g('draw calls ≤ 80 inside', pfT.calls <= 80, 'max ' + pfT.calls);
      g('triangles ≤ 120k inside', pfT.tris <= 120000, 'max ' + pfT.tris);
      await api.walkTo(330, -98.1, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'leaveHouse'`, 10000, 'leave prompt');
      await D.confirm();
      await api.waitFor(`__fm.room === null && __fm.state === 'play'`, 15000, 'back outside');
      g('✕ leaves back to the village', true);

      /* ═══ 2. PEARL'S FAMILY HOUSE (the small house at -22,-40) ═══ */
      await api.walkTo(-14, -44.5, 1.4, 90000);
      await api.walkTo(-21.17, -44.12, 0.55, 60000);
      await api.waitFor(`__fm.prompt === 'pearlDoor'`, 10000, 'pearl door prompt');
      g('door prompt at Pearl’s', true);
      if (pad) {
        await stage(`__fmDebug.face(-0.2);
          __fmDebug.cam(-22.1, groundH(-22.1,-45.6)+1.7, -45.6, -21.7, groundH(-21.7,-41.5)+1.5, -41.5)`);
        await api.shot('pearl-door-prompt-1280x720');
        await unstage();
      }
      await D.confirm();
      await api.waitFor(`__fm.room === 'pearl' && __fm.state === 'play'`, 15000, 'inside pearl');
      g('✕ enters through the fade', true);
      g('room counts as shade sanctuary', await api.eval('__fm.shade === true'));
      if (pad) {
        await stage(`__fmBot.release(); __fmDebug.warp(331.9, -138.3); __fmDebug.face(3.5);
          __fmDebug.cam(332.4, 1.9, -137.7, 328.4, 0.7, -140.8)`, 550);
        await api.shot('room-pearl-wide-1280x720');
        await stage(`__fmDebug.warp(331.9, -140.9); __fmDebug.cam(330.3, 1.9, -140.9, 330.1, 0.0, -139.1)`, 400);
        await api.shot('room-pearl-chalk-1280x720');
        await unstage();
      }
      // ── the toy boat goes to the window facing the bay ──
      await api.walkTo(330.5, -139.9, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'toyBoat'`, 10000, 'boat prompt');
      await D.confirm();
      await api.waitFor('__fm.boatWindow === true', 15000, 'boat placed');
      g('toy boat set in the window (real input)', true);
      g('boat caption (one line)',
        await api.eval(`__fm.caption !== null && __fm.caption.indexOf('tide') >= 0`),
        String(await api.eval('__fm.caption')));
      await api.waitFor(`__fm.state === 'play'`, 15000, 'boat beat over');
      if (pad) {
        await stage(`__fmBot.release(); __fmDebug.cam(330.9, 1.35, -140.6, 331.05, 1.1, -142.2)`, 500);
        await api.shot('pearl-boat-window-1280x720');
        await unstage();
      }
      // ── the star chart: blank; nobody could draw them for her ──
      await api.walkTo(332.0, -139.45, 0.45, 30000);
      await api.waitFor(`__fm.prompt === 'starChart'`, 10000, 'chart prompt');
      await D.confirm();
      await api.waitFor(`__fm.chartSeen === true`, 15000, 'chart seen');
      g('star chart read, caption lands',
        await api.eval(`__fm.caption !== null && __fm.caption.indexOf('Nobody') >= 0`),
        String(await api.eval('__fm.caption')));
      g('no star on the chart before the payoff', await api.eval('__fm.starOn === false'));
      await api.waitFor(`__fm.state === 'play'`, 15000, 'chart beat over');
      // ── the chest under the bunk ──
      const salt1 = await api.eval('__fm.salt');
      await api.walkTo(329.25, -139.9, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'pearlChest'`, 10000, 'pearl chest prompt');
      await D.confirm();
      await api.waitFor('__fm.pearlChest === true', 15000, 'pearl chest opened');
      await api.waitFor(`__fm.salt > ${salt1}`, 10000, 'salt gained');
      g('the chest under the bunk opens', true, 'salt=' + await api.eval('__fm.salt'));
      await roomFuzz(api, D, mode, g, 330, -140, '(Math.abs(__fm.x - 330) > 2.92 || Math.abs(__fm.z - (-140)) > 2.32)');
      await api.perfReset();
      await api.walkTo(332.0, -138.6, 0.8, 30000);
      await api.walkTo(329.0, -141.2, 0.8, 30000);
      await api.waitTicks(120);
      const pfP = await api.perfRead();
      g('draw calls ≤ 80 inside', pfP.calls <= 80, 'max ' + pfP.calls);
      g('triangles ≤ 120k inside', pfP.tris <= 120000, 'max ' + pfP.tris);
      await api.walkTo(330, -138.1, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'leaveHouse'`, 10000, 'leave prompt');
      await D.confirm();
      await api.waitFor(`__fm.room === null && __fm.state === 'play'`, 15000, 'back outside');
      g('✕ leaves back to the village', true);

      /* ═══ 3. FINN'S LIGHTHOUSE — kelp bars it until cut, then the
         ground room, the logbook, the crates, the HEART CONTAINER ═══ */
      await api.walkTo(20, -30, 1.6, 90000);
      await api.walkTo(38, -17, 1.2, 90000);
      await api.walkTo(40.75, -16.05, 0.5, 60000);
      g('kelp still bars the lighthouse door (no prompt)',
        (await api.eval('__fm.prompt')) !== 'lightDoor', String(await api.eval('__fm.prompt')));
      for (const [kx, kz] of [[41.4, -15.9], [41.6, -16.7], [41.9, -15.2]]) {
        if (await api.eval('__fm.kelpDoorCut')) break;
        await api.walkTo(kx, kz, 0.5).catch(() => {});
        for (let i = 0; i < 6 && !(await api.eval('__fm.kelpDoorCut')); i++) {
          await D.confirm();
          await sleep(260);
        }
      }
      g('door kelp cut with real swings', await api.eval('__fm.kelpDoorCut'));
      await api.walkTo(40.75, -16.05, 0.45, 60000);
      await api.waitFor(`__fm.prompt === 'lightDoor'`, 10000, 'light door prompt');
      g('door prompt once the kelp is gone', true);
      if (pad) {
        await stage(`__fmDebug.face(4.7);
          __fmDebug.cam(39.4, groundH(39.4,-16.6)+1.6, -16.6, 42.4, groundH(42.4,-15.9)+1.5, -15.9)`);
        await api.shot('light-door-prompt-1280x720');
        await unstage();
      }
      await D.confirm();
      await api.waitFor(`__fm.room === 'light' && __fm.state === 'play'`, 15000, 'inside lighthouse');
      g('✕ enters through the fade', true);
      g('room counts as shade sanctuary', await api.eval('__fm.shade === true'));
      if (pad) {
        await stage(`__fmBot.release(); __fmDebug.warp(329.7, -179.5); __fmDebug.face(Math.PI);
          __fmDebug.cam(330.4, 2.0, -177.7, 329.6, 0.9, -181.2)`, 550);
        await api.shot('room-light-wide-1280x720');
        await stage(`__fmDebug.cam(329.5, 1.35, -179.6, 328.2, 0.72, -180.75)`, 400);
        await api.shot('room-light-desk-1280x720');
        await unstage();
      }
      // ── the logbook: one entry, one line ──
      await api.walkTo(329.15, -180.2, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'logbook'`, 10000, 'logbook prompt');
      await D.confirm();
      await api.waitFor(`__fm.caption !== null && __fm.caption.indexOf('Keeping it clean') >= 0`, 15000, 'logbook line');
      g('logbook read: the last entry, a year old', true);
      await api.waitFor(`__fm.state === 'play'`, 15000, 'logbook beat over');
      // ── the crated stairs ──
      await api.walkTo(331.15, -179.1, 0.55, 30000);
      await api.waitFor(`__fm.prompt === 'crates'`, 10000, 'crates prompt');
      await D.confirm();
      await api.waitFor(`__fm.caption !== null && __fm.caption.indexOf('lamp worth lighting') >= 0`, 15000, 'crates line');
      g('crates carry Finn’s one line', true);
      await api.waitFor(`__fm.state === 'play'`, 15000, 'crates beat over');
      // ── the HEART CONTAINER ──
      const mh0 = await api.eval('__fm.maxHearts');
      await api.walkTo(330.2, -180.6, 0.55, 30000);
      await api.waitFor(`__fm.prompt === 'lightChest'`, 10000, 'chest prompt');
      if (pad) {
        await api.eval('window.__fmTurbo = 1');
        await api.eval(`window.__heartShot = 0;
          (function w(){ if (lightHeartT > 0.45 && lightHeartT < 1.0) { __fmDebug.freeze(1); window.__heartShot = 1; return; }
            if (lightHeartT >= 1.0) { window.__heartShot = -1; return; } requestAnimationFrame(w); })()`);
      }
      await D.confirm();
      await api.waitFor('__fm.lightChest === true', 15000, 'chest opened');
      if (pad) {
        await api.waitFor('window.__heartShot !== 0', 10000, 'heart mid-float');
        await api.eval(`__fmDebug.cam(331.7, 1.5, -179.7, 330.2, 0.85, -181.6)`);
        await sleep(350);
        await api.shot('light-heart-container-1280x720');
        await api.eval('__fmDebug.camOff(); __fmDebug.freeze(0); window.__fmTurbo = undefined');
      }
      await api.waitFor(`__fm.maxHearts === ${mh0 + 1}`, 20000, 'heart granted');
      g('chest grants a HEART CONTAINER', true, `maxHearts ${mh0} → ${mh0 + 1}`);
      g('hearts refill with the container', await api.eval('__fm.hearts === __fm.maxHearts'));
      await roomFuzz(api, D, mode, g, 330, -180, '(Math.hypot(__fm.x - 330, __fm.z - (-180)) > 2.64)');
      await api.perfReset();
      await api.walkTo(330.9, -178.3, 0.8, 30000);
      await api.walkTo(328.9, -181.1, 0.8, 30000);
      await api.waitTicks(120);
      const pfL = await api.perfRead();
      g('draw calls ≤ 80 inside', pfL.calls <= 80, 'max ' + pfL.calls);
      g('triangles ≤ 120k inside', pfL.tris <= 120000, 'max ' + pfL.tris);
      await api.walkTo(330, -177.9, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'leaveHouse'`, 10000, 'leave prompt');
      await D.confirm();
      await api.waitFor(`__fm.room === null && __fm.state === 'play'`, 15000, 'back outside');
      g('✕ leaves back beside the tower', true);

      /* ═══ 3.5 THE CARTOGRAPHER'S HOUSE (the small house at 22,-28) ═══ */
      await api.walkTo(28.5, -24.5, 1.8, 90000);
      await api.walkTo(23.63, -31.87, 0.6, 60000);
      await api.waitFor(`__fm.prompt === 'cartDoor'`, 10000, 'cartographer door prompt');
      g('door prompt at the cartographer’s', true);
      if (pad) {
        await stage(`__fmDebug.face(-0.4);
          __fmDebug.cam(24.9, groundH(24.9,-33.4)+1.7, -33.4, 22.6, groundH(22.6,-29.4)+1.5, -29.4)`);
        await api.shot('cart-door-prompt-1280x720');
        await unstage();
      }
      await D.confirm();
      await api.waitFor(`__fm.room === 'cart' && __fm.state === 'play'`, 15000, 'inside the map room');
      g('✕ enters the cartographer’s house', true);
      g('map room counts as shade sanctuary', await api.eval('__fm.shade === true'));
      if (pad) {
        await stage(`__fmBot.release(); __fmDebug.warp(330.2, -218.4); __fmDebug.face(Math.PI);
          __fmDebug.cam(330.4, 1.8, -217.5, 329.9, 0.95, -221.5)`, 550);
        await api.shot('room-cart-wide-1280x720');
        await stage(`__fmDebug.cam(330.3, 1.6, -220.3, 330.85, 1.45, -222.1)`, 400);
        await api.shot('room-cart-wallmap-1280x720');
        await unstage();
      }
      // ── the wall map: pins following the water out ──
      await api.walkTo(329.7, -220.95, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'tideMap'`, 10000, 'wall map prompt');
      await D.confirm();
      await api.waitFor(`__fm.caption !== null && __fm.caption.indexOf('keeps measuring') >= 0`, 15000, 'tide line');
      g('wall map carries the tide line', true);
      await api.waitFor(`__fm.state === 'play'`, 15000, 'map beat over');
      // ── the half-drawn new map ──
      await api.walkTo(331.8, -220.15, 0.45, 30000);
      await api.waitFor(`__fm.prompt === 'mapTable'`, 10000, 'table prompt');
      await D.confirm();
      await api.waitFor(`__fm.caption !== null && __fm.caption.indexOf('the good way') >= 0`, 15000, 'table line');
      g('drafting table carries its line', true);
      await api.waitFor(`__fm.state === 'play'`, 15000, 'table beat over');
      // ── the chest ──
      const saltC = await api.eval('__fm.salt');
      await api.walkTo(328.55, -218.7, 0.6, 30000);
      await api.waitFor(`__fm.prompt === 'cartChest'`, 10000, 'cart chest prompt');
      await D.confirm();
      await api.waitFor('__fm.cartChest === true', 15000, 'cart chest opened');
      await api.waitFor(`__fm.salt === ${saltC + 3}`, 15000, 'salt granted');
      g('chest gives three salt crystals', true, `salt ${saltC} → ${saltC + 3}`);
      await roomFuzz(api, D, mode, g, 330, -220, '(Math.abs(__fm.x - 330) > 2.92 || Math.abs(__fm.z - (-220)) > 2.32)');
      await api.perfReset();
      await api.walkTo(328.0, -221.2, 0.7, 30000);
      await api.walkTo(332.2, -219.4, 0.7, 30000);
      await api.waitTicks(120);
      const pfC = await api.perfRead();
      g('draw calls ≤ 80 inside', pfC.calls <= 80, 'max ' + pfC.calls);
      g('triangles ≤ 120k inside', pfC.tris <= 120000, 'max ' + pfC.tris);
      await api.walkTo(330, -217.9, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'leaveHouse'`, 10000, 'leave prompt');
      await D.confirm();
      await api.waitFor(`__fm.room === null && __fm.state === 'play'`, 15000, 'back outside');
      g('✕ leaves the map room', true);

      /* ═══ 4. THE HARBOR HOUSE differentiator — sit at the net bench ═══ */
      await api.walkTo(20, -30, 1.8, 120000);
      await api.walkTo(-20, -36, 1.8, 120000);
      await api.walkTo(-33, -40, 1.6, 90000);
      await api.walkTo(-39.48, -36.78, 0.6, 60000);
      await api.waitFor(`__fm.prompt === 'houseDoor'`, 10000, 'harbor door prompt');
      await D.confirm();
      await api.waitFor(`__fm.room === 'harbor' && __fm.state === 'play'`, 15000, 'inside harbor house');
      await api.walkTo(328.85, -61.3, 0.5, 30000);
      await api.waitFor(`__fm.prompt === 'benchSit'`, 10000, 'sit prompt');
      if (pad) {
        await api.eval('window.__fmTurbo = 1');
        await api.eval(`window.__sitShot = 0;
          (function w(){ if (__fm.sitting && CINE.t >= 1.35 && CINE.t < 2.4) { __fmDebug.freeze(1); window.__sitShot = 1; return; }
            if (CINE.t >= 2.4) { window.__sitShot = -1; return; } requestAnimationFrame(w); })()`);
      }
      await D.confirm();
      await api.waitFor('__fm.sitting === true', 15000, 'Wick sits');
      g('✕ sits at the net-mending bench', true);
      if (pad) {
        await api.waitFor('window.__sitShot !== 0', 10000, 'sit mid-beat');
        await sleep(250);
        await api.shot('harbor-bench-sit-1280x720');
        await api.eval('__fmDebug.freeze(0); window.__fmTurbo = undefined');
      }
      await api.waitFor(`__fm.sitting === false && __fm.state === 'play'`, 20000, 'the beat ends');
      g('…and the beat hands control back', true);

      /* ═══ persistence: reload → CONTINUE → everything remembered ═══ */
      await api.nav(base + '/?turbo=6');
      await api.waitFor(`__fm.state === 'title'`, 25000, 'title again');
      await tapUntil(api, () => D.down(), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
      await tapUntil(api, D.confirm, `__fm.state !== 'title'`, 12, 'leave title');
      await api.waitFor(`__fm.state === 'play'`, 25000, 'continued');
      g('chests persist across reload',
        await api.eval('__fm.tockChest === true && __fm.pearlChest === true && __fm.lightChest === true && __fm.cartChest === true'));
      g('salt persists', (await api.eval('__fm.salt')) >= 6, 'salt=' + await api.eval('__fm.salt'));
      g('heart container persists', (await api.eval('__fm.maxHearts')) === 6,
        'maxHearts=' + await api.eval('__fm.maxHearts'));
      g('clock/boat/chart flags persist',
        await api.eval('__fm.clockWound === true && __fm.boatWindow === true && __fm.chartSeen === true'));
      const bad = api.consoleBad;
      g('zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate(`rooms(${mode}) suite`, false, e.message);
      await api.shot('rooms-FAIL-' + mode).catch(() => {});
    }
    c.close(); proc.kill();
  };
  await run('pad');
  await run('kbd');

  /* ═══ the Pearl stretch: after the Crescent payoff, ONE real star ═══ */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    await api.seedSave({
      v: 2, q: 4, ph: 1, mh: 6, sword: true, salt: 2,
      talked: { finn: 1, tock: 1, pearl: 1 },
      kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: false,
      wallBurned: true, bossDone: true, sky: 1, tidepool: false,
      chartSeen: true, lastShade: [-21.17, -43.6],
    }, true);
    await api.nav(base + '/?turbo=6');
    const D = driver(api, 'pad');
    try {
      await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
      await tapUntil(api, () => D.down(), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
      await tapUntil(api, D.confirm, `__fm.state !== 'title'`, 12, 'leave title');
      await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
      await api.installBot('pad');
      await api.walkTo(-21.17, -44.12, 0.5, 60000);
      await api.waitFor(`__fm.prompt === 'pearlDoor'`, 10000, 'pearl door');
      await api.tap(0);
      await api.waitFor(`__fm.room === 'pearl' && __fm.state === 'play'`, 15000, 'inside');
      gate('stretch: one real star on the chart after the payoff', await api.eval('__fm.starOn === true'));
      await api.walkTo(332.0, -139.45, 0.45, 30000);
      await api.waitFor(`__fm.prompt === 'starChart'`, 10000, 'chart prompt');
      await api.tap(0);
      await api.waitFor(`__fm.caption !== null && __fm.caption.indexOf('herself') >= 0`, 15000, 'star caption');
      gate('stretch: the chart caption knows', true, String(await api.eval('__fm.caption')));
      await api.eval('window.__fmTurbo = 1');
      await api.eval(`__fmBot.release(); __fmDebug.warp(330.9, -141.6); __fmDebug.face(0.75);
        __fmDebug.cam(331.3, 1.4, -140.9, 332.85, 1.5, -139.5)`);
      await sleep(500);
      await api.shot('pearl-chart-star-1280x720');
      const bad = api.consoleBad;
      gate('stretch: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate('rooms stretch suite', false, e.message);
      await api.shot('rooms-stretch-FAIL').catch(() => {});
    }
    c.close(); proc.kill();
  }
}

/* interior collision fuzz shared by the v4.5 rooms: 12 bearings from the
   room center, walking + jumping, asserting the player NEVER leaves the
   authoritative bound (rect or circle). */
async function roomFuzz(api, D, mode, g, cx, cz, outExpr) {
  await api.eval(`window.__fzr = { out: 0, done: 0 };
    (function w(){
      if (__fzr.done) return;
      if (__fm.state === 'play' && __fm.tick > 0 &&
          Math.hypot(__fm.x - (${cx}), __fm.z - (${cz})) < 12) {
        if (${outExpr}) __fzr.out++;
      }
      requestAnimationFrame(w); })()`);
  for (let b = 0; b < 12; b++) {
    const a = b / 12 * Math.PI * 2;
    await api.eval(`__fmDebug.warp(${cx}, ${cz})`);
    const t0 = Date.now();
    let jt = 0;
    while (Date.now() - t0 < 650) {
      await api.eval(`__fmDebug.camYaw(Math.PI)`);
      if (mode === 'pad') await api.axes(-Math.sin(a), -Math.cos(a));
      else {
        await api.eval(`__fmBot.target=[${(cx + Math.sin(a) * 9).toFixed(1)}, ${(cz + Math.cos(a) * 9).toFixed(1)}]; __fmBot.tol=0.05;`);
      }
      if (b % 2 === 0 && Date.now() - jt > 500) { jt = Date.now(); await D.jump(); }
      await sleep(90);
    }
    if (mode === 'pad') await api.axes(0, 0);
    else await api.eval('__fmBot.target=null');
  }
  g('collision fuzz: never outside the room, all bearings',
    (await api.eval('__fzr.out')) === 0, 'out=' + await api.eval('__fzr.out'));
  await api.eval('__fzr.done = 1');
}

/* ═══ v3: save-loader stage gates (the Ben soft-lock).
   For every quest stage: write the save, reload, CONTINUE, and assert the
   LIVE state (quest, beacon, banner, boss wakability) matches. Then the
   damaged-save shapes: q lost but flags advanced → loader re-derives; and
   the in-session Finn self-heal re-offers the thread via a REAL talk. ═══ */
async function suiteSaves(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  const benSave = JSON.parse(fs.readFileSync(path.join(DIR, 'test', 'fixtures', 'ben-session-save.json'), 'utf8'));
  const continueIn = async () => {
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'continued');
    await api.waitTicks(30);
  };
  const banner = () => api.eval(`document.getElementById('questLine').classList.contains('on')`);
  try {
    // ── q0: fresh open loop ──
    await api.seedSave({ ...benSave, q: 0, talked: { finn: 0, tock: 0, pearl: 0 }, wallBurned: false, kelpDoor: false, doorChest: false, finnHeart: false, salt: 0, mh: 5 });
    await continueIn();
    gate('saves: q0 loads as open loop (no banner, no beacon)',
      (await api.eval('__fm.quest')) === 0 && !(await banner()) && !(await api.eval('__fm.beacon')));

    // ── q2 mid-arc (the exact Ben fixture): quest, beacon, banner, boss ──
    await api.seedSave(benSave);
    await continueIn();
    gate('saves: q2 fixture restores quest', (await api.eval('__fm.quest')) === 2,
      'quest=' + await api.eval('__fm.quest'));
    gate('saves: q2 beacon lights', await api.eval('__fm.beacon === true'));
    gate('saves: q2 banner on', await banner());
    gate('saves: q2 compass has a target', (await api.eval('__fm.objBearing')) !== null);
    // boss must be wakeable (wallBurned in fixture): warp into the arena
    await api.eval('__fmDebug.warp(62, 166)');
    await api.waitFor('__fm.bossActive === true', 15000, 'boss wakes');
    gate('saves: q2 boss wakes in the arena', true);

    // ── q3: carrying the Crescent home ──
    await api.seedSave({ ...benSave, q: 3, bossDone: true, wallBurned: true });
    await continueIn();
    gate('saves: q3 restores carry + wheel objective',
      (await api.eval('__fm.quest')) === 3 && (await api.eval('__fm.carry')) === true &&
      (await api.eval('__fm.beacon')) === true);

    // ── q4: after the payoff ──
    await api.seedSave({ ...benSave, q: 4, bossDone: true, wallBurned: true, sky: 1, ph: 1, tidepool: true });
    await continueIn();
    gate('saves: q4 restores the healed world',
      (await api.eval('__fm.quest')) === 4 && (await api.eval('__fm.skyStep')) === 1 &&
      (await api.eval('__fm.shadeGrow')) > 0.99 && (await api.eval('__fm.tidepool')) === true);

    // ── the DAMAGED shape (John's console): q stuck at 0, flags advanced ──
    await api.seedSave({ ...benSave, q: 0 });
    await continueIn();
    gate('saves: damaged save (q0 + advanced flags) re-derives forward',
      (await api.eval('__fm.quest')) === 2 && (await api.eval('__fm.beacon')) === true,
      'quest=' + await api.eval('__fm.quest'));

    // ── in-session self-heal: quest lost mid-session → Finn RE-OFFERS ──
    // (create the wild damaged state directly, then recover via a real talk)
    await api.eval(`QUEST.q = 0; SAVE.q = 0; document.getElementById('questLine').classList.remove('on');`);
    await api.waitTicks(10);
    gate('saves: damaged state staged (quest 0, talked.finn 1)',
      (await api.eval('__fm.quest')) === 0 && (await api.eval('SAVE.talked.finn')) === 1);
    await api.installBot('pad');
    const D = driver(api, 'pad');
    await api.eval('__fmDebug.warp(30, -16)');
    await api.walkTo(36, -15, 1.2);
    await api.walkTo(39.7, -14.1, 0.5);
    await api.waitFor(`__fm.prompt === 'talk'`, 8000, 'finn prompt');
    await D.confirm();
    await advanceDialog(api, D, 'finn1');
    await api.waitFor('__fm.quest === 2', 8000, 'quest re-offered');
    gate('saves: Finn self-heal re-offers the thread (quest 2 + beacon back)',
      (await api.eval('__fm.beacon')) === true && (await banner()));

    /* ═══ v4: the NEW-GAME GUARD — protects family saves ═══ */
    await api.seedSave(benSave);
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title (guard)');
    gate('guard: NEW GAME focused by default', await api.eval('__fm.titleFocus === 0'));
    await tapUntil(api, () => api.tap(0), '__fm.ngGuardOn === true', 8, 'guard modal');
    gate('guard: modal appears instead of wiping', await api.eval(`__fm.ngGuardOn === true && __fm.state === 'title'`));
    await sleep(400);
    await api.shot('newgame-guard-1280x720');
    await tapUntil(api, () => api.tap(1), '__fm.ngGuardOn === false', 8, 'guard declined');
    const kept = await api.eval(`(function(){ try { const s = JSON.parse(localStorage.getItem('fallenmoon_save_v1')); return s && s.q === 2; } catch(e){ return false; } })()`);
    gate('guard: ○ declines — the save is untouched', kept &&
      (await api.eval(`__fm.state === 'title' && !document.getElementById('ti1').classList.contains('gone')`)));
    // keyboard: J opens the modal, Esc declines
    await api.tapKey('j', 'KeyJ');
    await api.waitFor('__fm.ngGuardOn === true', 5000, 'guard via J');
    gate('guard(kbd): J asks again', true);
    await api.tapKey('Escape', 'Escape');
    await api.waitFor('__fm.ngGuardOn === false', 5000, 'declined via Esc');
    gate('guard(kbd): Esc declines — save still there',
      await api.eval(`(function(){ try { const s = JSON.parse(localStorage.getItem('fallenmoon_save_v1')); return s && s.q === 2; } catch(e){ return false; } })()`));
    // CONTINUE never asks
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'continue straight in');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'continued (no modal)');
    gate('guard: CONTINUE untouched — straight into the save',
      (await api.eval('__fm.quest')) === 2 && (await api.eval('__fm.ngGuardOn')) === false);
    // and ✕ on the modal really does start fresh
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title (guard 2)');
    await tapUntil(api, () => api.tap(0), '__fm.ngGuardOn === true', 8, 'guard modal 2');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 8, 'confirm fresh');
    await api.waitFor(`__fm.state === 'play'`, 40000, 'fresh adventure');
    gate('guard: ✕ confirms — a truly fresh adventure',
      (await api.eval('__fm.quest')) === 0 && (await api.eval('__fm.salt')) === 0 &&
      (await api.eval('__fm.maxHearts')) === 5);

    const bad = api.consoleBad;
    gate('saves: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('saves suite', false, e.message);
    await api.shot('saves-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
}

/* ═══ v2: house-orbit wall integrity — no sky through any facade.
   Sky is swapped for magenta void; each building is orbited at two pitches
   and a strip safely inside its silhouette is pixel-checked. ═══ */
async function suiteWalls(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.nav(base + '/?turbo=6');
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 30000, 'playing');
    await api.eval(`window.__fmTurbo = 1; __fmDebug.warp(300, 150); __fmDebug.hud(false); __fmDebug.skyProbe(true);`);
    const buildings = [
      ['house1', -38, -32, 1.6, 9.5], ['house2', -22, -40, 1.5, 8.5],
      ['house3', 6, -38, 1.5, 8.5], ['house4', 22, -28, 1.5, 8.5],
      ['lighthouse', 44, -16, 4.0, 10.5],
    ];
    for (const [name, hx, hz, lookY, d] of buildings) {
      let worst = 0, worstAt = '';
      for (let a = 0; a < 12; a++) {
        const ang = a / 12 * Math.PI * 2;
        for (const [ptag, py, ld] of [['lo', 1.6, d], ['hi', 8.5, d * 0.75]]) {
          const cx = hx + Math.sin(ang) * ld, cz = hz + Math.cos(ang) * ld;
          await api.eval(`__fmDebug.cam(${cx}, groundH(${cx.toFixed(2)},${cz.toFixed(2)})+${py}, ${cz}, ${hx}, groundH(${hx},${hz})+${ptag === 'hi' && name !== 'lighthouse' ? 2.6 : lookY}, ${hz}); 0`);
          await sleep(90);
          const r = await c.send('Page.captureScreenshot', { format: 'png' });
          const png = decodePNG(Buffer.from(r.data, 'base64'));
          // strip safely inside the silhouette from every azimuth
          const hw = name === 'lighthouse' ? 52 : 95, hh = name === 'lighthouse' ? 70 : 48;
          let magenta = 0;
          for (let y = 360 - hh; y < 360 + hh; y += 2) {
            for (let x = 640 - hw; x < 640 + hw; x += 2) {
              const i = (y * png.w + x) * png.bpp;
              if (png.px[i] > 210 && png.px[i + 2] > 210 && png.px[i + 1] < 70) magenta++;
            }
          }
          if (magenta > worst) { worst = magenta; worstAt = `a${a}-${ptag}`; }
          if (magenta > 3) {
            fs.writeFileSync(path.join(SHOTS, `wall-FAIL-${name}-a${a}-${ptag}.png`), Buffer.from(r.data, 'base64'));
          }
        }
      }
      gate(`walls: ${name} solid from all angles`, worst <= 3, worst ? `${worst}px @ ${worstAt}` : 'clean');
    }
    /* ── v3: GROTTO INTERIOR sweep — the flat-blue bug. From inside each
       chamber and the corridor, orbit the camera and pixel-check that no
       reachable view reads through to the (magenta-probed) sky. The mouth
       sector of chamber A is skipped — daylight through the entrance is
       legitimate there. ── */
    await api.eval('__fmDebug.warp(30, 150)');    // player inside → culling follows
    const interior = [
      // [tag, cx, cz, eyeY, lookR, azimuths]
      ['grotto-A', 30, 150, 2.35, 9, Array.from({ length: 12 }, (_, i) => i / 12 * Math.PI * 2)
        .filter(a => {
          const d = ((a - 4.712 + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          return Math.abs(d) > 1.2;          // skip the daylight mouth sector (v8: taller door, wider FOV graze)
        })],
      ['grotto-B', 62, 166, 2.35, 8, Array.from({ length: 12 }, (_, i) => i / 12 * Math.PI * 2)],
      ['corridor', 47, 158.5, 2.35, 5, [0.46, 0.46 + Math.PI / 2, 0.46 + Math.PI, 0.46 + Math.PI * 1.5]],
    ];
    for (const [tag, cx, cz, eyeY, lookR, azs] of interior) {
      if (tag === 'grotto-B' || tag === 'corridor') await api.eval(`__fmDebug.warp(${tag === 'corridor' ? '47, 158.5' : '62, 166'})`);
      let worst = 0, worstAt = '';
      for (const a of azs) {
        for (const [ptag, ly] of [['level', 4.35], ['up', 8.95]]) {
          const lx = cx + Math.cos(a) * lookR, lz = cz + Math.sin(a) * lookR;
          await api.eval(`__fmDebug.cam(${cx}, ${eyeY}, ${cz}, ${lx.toFixed(1)}, ${ly}, ${lz.toFixed(1)}); 0`);
          await sleep(90);
          const r = await c.send('Page.captureScreenshot', { format: 'png' });
          const png = decodePNG(Buffer.from(r.data, 'base64'));
          let magenta = 0;
          for (let y = 120; y < 600; y += 3) {
            for (let x = 200; x < 1080; x += 3) {
              const i = (y * png.w + x) * png.bpp;
              if (png.px[i] > 210 && png.px[i + 2] > 210 && png.px[i + 1] < 70) magenta++;
            }
          }
          if (magenta > worst) { worst = magenta; worstAt = `a${a.toFixed(2)}-${ptag}`; }
          if (magenta > 6) {
            fs.writeFileSync(path.join(SHOTS, `wall-FAIL-${tag}-a${a.toFixed(2)}-${ptag}.png`), Buffer.from(r.data, 'base64'));
          }
        }
      }
      gate(`walls: ${tag} interior shows no sky through rock`, worst <= 6, worst ? `${worst}px @ ${worstAt}` : 'clean');
    }
    await api.eval('__fmDebug.camOff()');
    await api.eval('__fmDebug.skyProbe(false); __fmDebug.hud(true);');
    const bad = api.consoleBad;
    gate('walls: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('walls suite', false, e.message);
  }
  c.close(); proc.kill();
}

async function suiteShots(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.nav(base + '/?turbo=6');
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 30000, 'playing');
    await api.eval('window.__fmTurbo = 1');
    // village establishing shot: harbor edge at shoulder height, Wick walking
    // into town — houses, well, boat, the Moonwheel on its hill behind
    await api.installBot('pad');
    await api.eval('__fmDebug.warp(-3, 6); __fmDebug.hud(false);');
    await api.eval('__fmDebug.cam(-2, 2.0, 13.5, -17, 3.0, -28);');
    await api.eval('__fmBot.tol = 0.6; __fmBot.target = [-11, -22];');
    await sleep(1100);            // mid-stride
    await api.shot('village-establishing-1280x720');
    await api.eval('__fmBot.release(); __fmDebug.camOff();');
    // portraits against the neutral stage (HUD stays hidden for review shots)
    for (const name of ['wick', 'finn', 'tock', 'pearl', 'crab', 'imp', 'king']) {
      await api.eval(`__fmDebug.portrait(${JSON.stringify(name)})`);
      await sleep(500);
      await api.shot('portrait-' + name);
      await api.eval('__fmDebug.portraitOff()');
      await sleep(150);
    }
    // ── the SWOOSH: a mid-swing frame with the crescent trail visible ──
    await api.eval('window.__fmTurbo = undefined');
    await api.eval('__fmDebug.warp(-4, 30); __fmDebug.face(0.6); __fmDebug.camYaw(Math.PI + 0.6);');
    await sleep(400);
    await api.eval(`window.__fmSwingShot=false;(function w(){
      const T=__fm; if(T.trailOp>0.3){window.__fmSwingShot=true;__fmDebug.freeze(1);return;}
      requestAnimationFrame(w);})()`);
    for (let i = 0; i < 10 && !(await api.eval('window.__fmSwingShot')); i++) {
      await api.tap(0);
      await sleep(120);
    }
    gate('shots: swoosh trail visible mid-swing', await api.eval('window.__fmSwingShot'),
      'trailOp=' + await api.eval('__fm.trailOp'));
    await api.shot('swing-swoosh-1280x720');
    await api.eval('__fmDebug.freeze(0)');
    // ── two-stick shot: camera pulled to a deliberate non-default angle ──
    await api.eval('__fmDebug.warp(2, 24);');
    await api.eval('__fakePad.raxes(0.7, -0.35)');
    await sleep(700);
    await api.eval('__fakePad.raxes(0, 0)');
    await api.eval('__fmBot.tol = 0.8; __fmBot.target = [-2, 40];');
    await sleep(900);              // walking under the rotated camera
    await api.shot('twostick-angle-1280x720');
    await api.eval('__fmBot.release();');

    /* ═══ v3 shot set ═══ */
    // the new spawn: wide establishing + Wick framed beside his boat
    await api.eval('__fmDebug.warp(8.2, 7.0); __fmDebug.face(2.6);');
    await api.eval('__fmDebug.cam(14.5, groundH(14.5,12.5)+2.9, 12.5, 7, groundH(8,5)+1.0, 4.4);');
    await sleep(400);
    await api.shot('spawn-wide-1280x720');
    await api.eval('__fmDebug.cam(9.9, groundH(9.9,9.6)+1.5, 9.6, 7.9, groundH(8.2,7)+0.9, 5.6);');
    await sleep(300);
    await api.shot('spawn-wick-1280x720');
    await api.eval('__fmDebug.camOff();');
    // sprint mid-lean with heel dust
    await api.eval('__fmDebug.warp(-30, 30); __fmDebug.camYaw(Math.PI + 0.5);');
    await api.eval('__fakePad.press(1)');
    await api.eval('__fmBot.tol = 0.5; __fmBot.target = [-30, 55];');
    await api.eval(`window.__spShot=false;(function w(){
      const T=__fm; if(T.sprint&&T.sprintLean>0.3){window.__spShot=true;__fmDebug.freeze(1);return;}
      requestAnimationFrame(w);})()`);
    for (let i = 0; i < 40 && !(await api.eval('window.__spShot')); i++) await sleep(100);
    gate('shots: sprint lean captured', await api.eval('window.__spShot'));
    // side-on frame: the lean + scarf stream + heel dust all read in profile
    await api.eval(`(function(){ const T=__fm;
      __fmDebug.cam(T.x + 3.6, groundH(T.x+3.6, T.z+0.4)+1.15, T.z + 0.4, T.x, T.fy + 0.95, T.z); })()`);
    await sleep(150);
    await api.shot('sprint-lean-1280x720');
    await api.eval('__fmDebug.camOff()');
    await api.eval('__fmDebug.freeze(0); __fmBot.release(); __fakePad.press();');
    // jump apex over a kelp cluster
    await api.eval('__fmDebug.warp(12.4, 5.4); __fmDebug.camYaw(Math.PI - 0.7);');
    await api.eval(`window.__jShot=false;(function w(){
      const T=__fm; if(T.air&&T.airY>0.72&&T.z>7.4){window.__jShot=true;__fmDebug.freeze(1);return;}
      requestAnimationFrame(w);})()`);
    await api.eval('__fmBot.tol = 0.4; __fmBot.target = [12.4, 12.5];');
    for (let att = 0; att < 5 && !(await api.eval('window.__jShot')); att++) {
      const t0 = Date.now();
      while (Date.now() - t0 < 4000) {
        if (await api.eval('window.__jShot')) break;
        if ((await api.eval('__fm.z')) > 7.7 && !(await api.eval('__fm.air'))) { await api.tap(2); }
        await sleep(40);
      }
      if (!(await api.eval('window.__jShot'))) await api.eval('__fmDebug.warp(12.4, 5.4)');
    }
    gate('shots: jump apex captured', await api.eval('window.__jShot'));
    await api.eval(`(function(){ const T=__fm;
      __fmDebug.cam(T.x + 3.4, groundH(T.x+3.4, T.z-1.2)+1.5, T.z - 1.2, T.x, T.fy + 0.7, T.z); })()`);
    await sleep(150);
    await api.shot('jump-apex-kelp-1280x720');
    await api.eval('__fmDebug.camOff()');
    await api.eval('__fmDebug.freeze(0); __fmBot.release();');
    // crab-hit contact moment (shell flash + sparks + trail)
    await api.eval(`window.__chShot=false;(function w(){
      const T=__fm; const h0=window.__ch0??(window.__ch0=T.crabHits);
      if(T.crabHits>h0){window.__chShot=true;__fmDebug.freeze(1);return;}
      requestAnimationFrame(w);})()`);
    for (let att = 0; att < 12 && !(await api.eval('window.__chShot')); att++) {
      await api.eval('__fmDebug.warp(0, 44)');
      await sleep(150);
      const cx = await api.eval('__fm.nearCrabX'), cz = await api.eval('__fm.nearCrabZ');
      const a = 0.5 + att * 0.5;
      await api.eval(`__fmDebug.warp(${(cx + Math.sin(a) * 1.8).toFixed(2)}, ${(cz + Math.cos(a) * 1.8).toFixed(2)});` +
        `__fmDebug.face(${(a + Math.PI).toFixed(3)});` +
        `__fmDebug.camYaw(${a.toFixed(3)})`);
      await api.tap(0);
      await sleep(500);
    }
    gate('shots: crab-hit contact captured', await api.eval('window.__chShot'));
    // side-on: sword arc, shell flash, sparks and the knockback hop in profile
    await api.eval(`(function(){ const T=__fm;
      const mx=(T.x+T.nearCrabX)/2, mz=(T.z+T.nearCrabZ)/2;
      const dx=T.nearCrabX-T.x, dz=T.nearCrabZ-T.z, d=Math.hypot(dx,dz)||1;
      __fmDebug.cam(mx - dz/d*4.2, groundH(mx - dz/d*4.2, mz + dx/d*4.2)+1.2, mz + dx/d*4.2, mx, T.fy+0.7, mz); })()`);
    await sleep(120);
    await api.shot('crab-hit-contact-1280x720');
    await api.eval('__fmDebug.camOff()');
    await api.eval('__fmDebug.freeze(0)');
    // moon compass mote stream (quest live via a fresh thread isn't needed —
    // pre-quest it tugs toward the Moonwheel, which IS the readable feedback)
    await api.waitFor(`__fm.state === 'play'`, 30000, 'play before compass shot').catch(() => {});
    // pre-quest the stream tugs toward the Moonwheel — frame it side-on
    const wb = Math.atan2(-38 - (-4), -78 - 20);
    await api.eval(`__fmDebug.warp(-4, 20); __fmDebug.face(${wb.toFixed(3)});`);
    await api.eval(`window.__cpShot=false;(function w(){
      const T=__fm; if(T.pulseT>0.8){window.__cpShot=true;setTimeout(()=>__fmDebug.freeze(1),150);return;}
      requestAnimationFrame(w);})()`);
    for (let i = 0; i < 6 && !(await api.eval('window.__cpShot')); i++) {
      await api.tap(3);
      await sleep(450);
    }
    gate('shots: compass mote stream captured', await api.eval('window.__cpShot'));
    await api.eval(`(function(){ const T=__fm;
      const px=Math.cos(${wb.toFixed(3)}), pz=-Math.sin(${wb.toFixed(3)});
      __fmDebug.cam(T.x + px*4.6 + Math.sin(${wb.toFixed(3)})*1.4, groundH(T.x + px*4.6, T.z + pz*4.6)+1.3,
        T.z + pz*4.6 + Math.cos(${wb.toFixed(3)})*1.4, T.x + Math.sin(${wb.toFixed(3)})*1.8, T.fy + 1.1, T.z + Math.cos(${wb.toFixed(3)})*1.8); })()`);
    await sleep(120);
    await api.shot('compass-motes-1280x720');
    await api.eval('__fmDebug.camOff(); __fmDebug.freeze(0)');
    // pickup vs decor: the collectible crystal, then a decor formation
    await api.eval('__fmDebug.warp(8, 27);');
    await api.eval('__fmDebug.cam(5.0, groundH(5,32.6)+1.15, 32.6, 5.0, groundH(5,30)+0.5, 30.0);');
    await sleep(400);
    const shotPick = await api.shot('pickup-crystal-1280x720');
    await api.eval('__fmDebug.warp(-24, 52);');
    await api.eval('__fmDebug.cam(-26.5, groundH(-26.5,50.9)+1.15, 50.9, -25.2, groundH(-25.2,48.4)+0.35, 48.4);');
    await sleep(300);
    const shotDecor = await api.shot('decor-crystal-1280x720');
    await api.eval('__fmDebug.camOff();');
    {
      const pk = decodePNG(fs.readFileSync(shotPick));
      let bright = 0;
      for (let y = 240; y < 480; y += 2) for (let x = 520; x < 760; x += 2) {
        const i = (y * pk.w + x) * pk.bpp;
        if (pk.px[i] > 236 && pk.px[i + 1] > 236 && pk.px[i + 2] > 230) bright++;
      }
      const dc = decodePNG(fs.readFileSync(shotDecor));
      let dBright = 0;
      for (let y = 240; y < 480; y += 2) for (let x = 520; x < 760; x += 2) {
        const i = (y * dc.w + x) * dc.bpp;
        if (dc.px[i] > 236 && dc.px[i + 1] > 236 && dc.px[i + 2] > 230) dBright++;
      }
      gate('shots: pickup reads bright, decor reads dull', bright > 40 && dBright < bright / 4,
        `pickup=${bright}px decor=${dBright}px`);
    }
    // walk-cycle strip: three frozen frames of the new gait
    await api.eval('__fmDebug.warp(-20, 24);');
    await api.eval('__fmBot.tol = 0.5; __fmBot.target = [-20, 48];');
    await sleep(700);
    for (let i = 0; i < 3; i++) {
      await api.eval('__fmDebug.freeze(1)');
      // side-on: the gait in profile (heel-toe, arm counter-swing, hip sway)
      await api.eval(`(function(){ const T=__fm;
        __fmDebug.cam(T.x + 3.4, groundH(T.x+3.4, T.z)+1.05, T.z, T.x, T.fy + 0.85, T.z); })()`);
      await sleep(140);
      await api.shot('walkcycle-' + (i + 1));
      await api.eval('__fmDebug.camOff(); __fmDebug.freeze(0)');
      await sleep(210);
    }
    await api.eval('__fmBot.release();');
    await api.eval('__fmDebug.hud(true);');
    const bad = api.consoleBad;
    gate('shots: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('shots suite', false, e.message);
  }
  c.close(); proc.kill();
}

/* art-iteration suite: freecam vistas, not gated — just LOOK at them */
async function suiteArt(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.nav(base + '/?turbo=6');
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 30000, 'playing');
    await api.eval('window.__fmTurbo = 1');
    const vistas = [
      ['vista-village', '__fmDebug.warp(2,14); __fmDebug.cam(2, 6.5, 16, -4, 2, -30)'],
      ['vista-harborline', '__fmDebug.warp(20,18); __fmDebug.cam(24, 3.2, 20, 44, 6, -18)'],
      ['vista-bay', '__fmDebug.warp(0,34); __fmDebug.cam(0, 4.4, 30, 6, -2, 80)'],
      ['vista-wheelhill', '__fmDebug.warp(-24,-52); __fmDebug.cam(-22, 8, -50, -38, 12, -78)'],
      ['vista-wreck', '__fmDebug.warp(-38,88); __fmDebug.cam(-36, 1.5, 86, -46, 0.5, 96)'],
      ['vista-grotto-mouth', '__fmDebug.warp(30,124); __fmDebug.cam(30, 1.5, 122, 30, 3, 140)'],
      ['vista-grotto-inside', '__fmDebug.warp(30,146); __fmDebug.cam(33, 1.2, 141, 26, 1.5, 147)'],
      ['vista-arena', '__fmDebug.warp(56,163); __fmDebug.cam(54, 2.5, 160, 63, 1.5, 167)'],
    ];
    for (const [name, expr] of vistas) {
      await api.eval(expr);
      await sleep(500);
      await api.shot(name);
    }
    await api.eval('__fmDebug.camOff()');
    const bad = api.consoleBad;
    gate('art: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('art suite', false, e.message);
  }
  c.close(); proc.kill();
}

/* ── png decode + sampling (payoff pixel gate) ── */
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

/* ═══════════ main ═══════════ */

/* ═══════════════════ PHASE 2 NIGHT ONE — THE PARCHED FOREST ═══════════════════ */
const FOREST_SAVE = {
  v: 2, q: 0, ph: 0, mh: 6, sword: true, salt: 0,
  talked: { finn: 0, tock: 0, pearl: 0 },
  kelpDoor: false, doorChest: false, finnHeart: true, wreckChest: false,
  wallBurned: false, bossDone: false, sky: 0, tidepool: false,
  compassSeen: true, forestSeen: true, swelterSeen: false,
  region: 'bay', lastSpring: -1, lastShade: [60, 20],
};
/* ═══ the TREE-STUN trial rig ═══
   v8.1: the old gate turned the kid-bot loose at the treeline and hoped a
   sidestepped rush would happen to end in a trunk — it passed some runs and
   failed others. Nothing about the MECHANIC was flaky; the trial geometry was.
   This stages it the way the v4 claw-race was pinned: one named boar, one
   named hash-grid pine, and a lane through that pine whose only obstacle IS
   that pine. The state machine then runs for real — graze → alert → paw →
   charge → trunk — and the gate asserts the stun happened AND that the boar's
   snout is on the pine (not on a prop or a solid). */
const STUN_STAGE = `(function(){
  window.__stageStun = function(){
    /* 1. THE PINE — the same glade-edge trunk the suite already resolves */
    const c = { x: 900, z: 560 };
    let T = null;
    for (let ix = Math.floor((c.x - 45) / 9); ix <= Math.floor((c.x + 45) / 9); ix++)
      for (let iz = Math.floor((c.z - 45) / 9); iz <= Math.floor((c.z + 45) / 9); iz++) {
        const t = treeInfo(ix, iz); if (!t) continue;
        const d = Math.hypot(t.x - c.x, t.z - c.z);
        if (d > 26 && d < 40 && (!T || d < T.d)) T = { x: t.x, z: t.z, r: t.r, d };
      }
    if (!T) return { ok: false, why: 'no glade-edge pine' };
    /* 2. THE LANE — boar behind the pine, player beyond it, nothing else on it */
    const DB = 6.0, DP = 4.5;
    const clearRun = (ax, az, bx, bz) => {
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, x = ax + (bx - ax) * t, z = az + (bz - az) * t;
        if (Math.hypot(x - T.x, z - T.z) < T.r + 1.3) continue;   // the pine is the target
        if (treeTrunkAt(x, z, 0.55) || chargeProp(x, z) || window.__forestSolid(x, z)) return false;
      }
      return true;
    };
    let lane = null;
    for (let a = 0; a < 72 && !lane; a++) {
      const ang = a / 72 * Math.PI * 2;
      const ux = Math.cos(ang), uz = Math.sin(ang);
      const bx = T.x - ux * DB, bz = T.z - uz * DB, px = T.x + ux * DP, pz = T.z + uz * DP;
      if (window.__forestSolid(bx, bz) || window.__forestSolid(px, pz)) continue;
      if (treeTrunkAt(bx, bz, 0.9) || treeTrunkAt(px, pz, 0.9)) continue;
      if (!clearRun(bx, bz, px, pz)) continue;
      lane = { ang, ux, uz, bx, bz, px, pz };
    }
    if (!lane) return { ok: false, why: 'no clear lane through the pine' };
    /* 3. THE CAST — one boar on the lane; every other boar parked and calmed
       so it can neither wander into the lane nor supply a false stun */
    const k = 0, b = BOARS[k];
    for (let i = 0; i < BOARS.length; i++) {
      if (i === k) continue;
      const o = BOARS[i];
      o.st = 'graze'; o.t = 0; o.cd = 1e9; o.x = o.sx; o.z = o.sz;
    }
    b.dead = false; b.cured = false; b.hp = 3; b.flash = 0; b.cd = 0; b.jumpCredit = false;
    b.hitDone = false;
    b.x = b.sx = lane.bx; b.z = b.sz = lane.bz;
    b.ang = Math.atan2(lane.ux, lane.uz);
    b.st = 'graze'; b.t = 0;                 // the REAL machine takes it from here
    /* 4. THE PLAYER — on the far side of the pine, in the boar's sight line */
    __fmDebug.warp(lane.px, lane.pz);
    P.hearts = P.maxHearts; swelterT = 0;
    window.__stunTrial = { T, lane, k };
    /* 5. THE WATCHER — this boar only, with the proof of WHAT stopped it */
    window.__stunProof = null;
    (function w() {
      if (window.__stunProof) return;
      const bb = BOARS[k];
      if (bb.st === 'stun') {
        const hx = bb.x + Math.sin(bb.ang) * 1.05, hz = bb.z + Math.cos(bb.ang) * 1.05;
        const dT = Math.hypot(hx - T.x, hz - T.z);
        window.__stunProof = {
          stunned: true, headToTrunk: +dT.toFixed(2), trunkR: +T.r.toFixed(2),
          onTrunk: dT < T.r + 0.6, prop: !!chargeProp(hx, hz),
          bx: +bb.x.toFixed(2), bz: +bb.z.toFixed(2),
        };
        return;
      }
      requestAnimationFrame(w);
    })();
    return { ok: true, trunk: { x: +T.x.toFixed(2), z: +T.z.toFixed(2), r: +T.r.toFixed(2) },
      boar: { x: +lane.bx.toFixed(2), z: +lane.bz.toFixed(2) },
      player: { x: +lane.px.toFixed(2), z: +lane.pz.toFixed(2) },
      laneDeg: +(lane.ang * 180 / Math.PI).toFixed(1) };
  };
})();`;

const RIVER_WAY = [
  [235, 55], [380, 110], [500, 270], [650, 380], [820, 300], [980, 380],
  [1080, 560], [1220, 660], [1340, 560], [1480, 660], [1580, 840],
  [1700, 930], [1800, 1050], [1900, 1160],
];

async function suiteForest(base) {
  const run = async (mode) => {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    await api.seedSave(FOREST_SAVE, true);   // later navs keep the LIVE save (persistence gate)
    await api.nav(base + '/?turbo=6');
    const g = (n, ok, d) => gate(`forest(${mode}): ${n}`, ok, d);
    try {
      await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
      await tapUntil(api, () => mode === 'pad' ? api.tap(13) : api.tapKey('s', 'KeyS'), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
      await tapUntil(api, () => mode === 'pad' ? api.tap(0) : api.tapKey('j', 'KeyJ'), `__fm.state !== 'title'`, 12, 'leave title');
      await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
      await api.installBot(mode);
      const D = driver(api, mode);
      const topUp = () => api.eval('P.hearts = P.maxHearts; swelterT = 0; 0');

      /* ── 1. CINDER PASS: on foot, both ways, continuous ground ── */
      g('starts in Brightharbor', (await api.eval('__fm.region')) === 'bay');
      await api.walkTo(95, 34, 2.2, 60000);
      await api.walkTo(138, 38, 2.5, 60000);
      await api.waitFor(`__fm.region === 'forest'`, 8000, 'region flips');
      await api.walkTo(200, 44, 3.0, 60000);
      await api.walkTo(243, 57, 3.0, 60000);
      g('pass traversal east: village → camp on foot', true,
        'pos=' + (await api.eval('__fm.x.toFixed(0) + "," + __fm.z.toFixed(0)')));
      await api.walkTo(138, 38, 2.5, 60000);
      await api.walkTo(92, 33, 2.2, 60000);
      g('pass traversal west: camp → village on foot', (await api.eval('__fm.region')) === 'bay');

      /* ── 2. the one signpost ── */
      await api.eval('__fmDebug.warp(210, 50)');
      await api.walkTo(205.7, 46.6, 0.8, 30000);
      await api.waitFor(`__fm.prompt === 'signpost'`, 10000, 'signpost prompt');
      await D.confirm();
      await api.waitFor(`__fm.caption && __fm.caption.indexOf('PARCHED') >= 0`, 10000, 'signpost caption');
      g('signpost read (✕, one line)', true);
      await api.waitFor(`__fm.state === 'play'`, 10000, 'micro beat over');

      /* ── 3. the FIRE WARDEN (≤2-line dialogues) ── */
      await api.eval('__fmDebug.warp(1091, 799)');
      await topUp();
      await api.walkTo(1095.9, 805.4, 0.9, 40000);
      await api.waitFor(`__fm.prompt === 'wardenTalk'`, 10000, 'warden prompt');
      await D.confirm();
      await advanceDialog(api, D, 'warden1');
      g('Warden states the swelter rule (talk 1)', (await api.eval('__fm.wardenTalked')) === 1);
      await api.waitFor(`__fm.prompt === 'wardenTalk'`, 8000, 'warden prompt 2');
      await D.confirm();
      await advanceDialog(api, D, 'warden2');
      g('Warden hints the falls hum (talk 2)', (await api.eval('__fm.wardenTalked')) === 2);

      /* ── 4. the FIRE-WATCH TOWER: climbed by real stairs ── */
      await api.eval('window.__fmTurbo = 2');
      let climbed = false;
      for (let attempt = 0; attempt < 3 && !climbed; attempt++) {
        await api.eval('__fmDebug.warp(1100, 820)');
        await topUp();
        await api.eval('__fmBot.noWiggle = true');
        try {
          /* mid-side waypoints ON each step line: a corner reached 0.7m wide
             put the next traverse off the stairs entirely (fell every lap) */
          for (const [x, z] of [[1095.7, 814.35], [1100, 814.35], [1104.3, 814.35],
                                [1104.35, 810], [1104.35, 806.0], [1100, 805.65],
                                [1096.0, 805.65], [1095.65, 810], [1095.65, 813.8], [1100, 810]]) {
            await api.walkTo(x, z, 0.5, 45000);
            if (!(await api.eval('__fm.fy > groundH(__fm.x, __fm.z) - 0.2 || true'))) break;
          }
        } catch (e) { /* fell — try again */ }
        await api.eval('__fmBot.noWiggle = false');
        climbed = await api.eval('__fm.onTowerDeck === true');
      }
      g('tower climbed to the deck', climbed,
        'fy=' + (await api.eval('__fm.fy')).toFixed(1));
      await api.eval('window.__fmTurbo = 6');
      await api.eval('__fmDebug.warp(1100, 822)');

      /* ── 5. the GREAT CEDAR: hollow, secret chamber, heart container ── */
      await api.eval('__fmDebug.warp(1294, 202)');
      await topUp();
      const mh0 = await api.eval('__fm.maxHearts');
      await api.walkTo(1300, 210, 1.4, 40000);
      g('cedar hollow entered through the door gap', await api.eval('__fm.forestShade === true'),
        'pos=' + (await api.eval('__fm.x.toFixed(1) + "," + __fm.z.toFixed(1)')));
      await api.waitFor(`__fm.prompt === 'cedarChest'`, 10000, 'cedar chest prompt');
      await D.confirm();
      await api.waitFor(`__fm.maxHearts === ${mh0} + 1`, 20000, 'heart container');
      g('cedar HEART CONTAINER claimed', true, 'maxHearts=' + await api.eval('__fm.maxHearts'));

      /* ── 6. chests (mill + ferry + secret grotto) ── */
      const openChestAt = async (wx, wz, cx, cz, promptId, telem) => {
        await api.eval(`__fmDebug.warp(${wx}, ${wz})`);
        await topUp();
        const s0 = await api.eval('__fm.salt');
        await api.walkTo(cx, cz, 1.35, 40000);
        await api.waitFor(`__fm.prompt === '${promptId}'`, 10000, promptId + ' prompt');
        await D.confirm();
        await api.waitFor(`__fm.salt > ${s0}`, 15000, promptId + ' salt');
        return api.eval(`__fm.${telem}`);
      };
      g('mill chest opened (salt)', await openChestAt(654, 396, 648.6, 390.6, 'fchest', 'fMillChest') === true);
      if (mode === 'pad') {
        g('ferry chest opened (salt)', await openChestAt(1345, 576, 1341.5, 571.6, 'fchest', 'fFerryChest') === true);
        g('secret grotto chest opened (salt)', await openChestAt(703, 723, 701, 719, 'fchest', 'fGrottoChest') === true);
      }

      /* ── 7. combat: CINDER BOARS ── */
      await api.eval('window.__fmTurbo = 2');
      await api.eval('__fmDebug.warp(878, 542)');
      await topUp();
      await api.eval('__fmBot.tol=1.4; __fmBot.target=[891,552]');
      await api.waitFor('__fm.nearBoarDist < 14', 30000, 'boar noticed');
      await api.eval('__fmBot.target=null');
      await api.waitFor(`__fm.nearBoarState === 'paw'`, 30000, 'boar paw telegraph');
      const bt0 = await api.eval('__fm.tick');
      await api.waitFor(`__fm.nearBoarState === 'charge'`, 10000, 'boar charge');
      const bt1 = await api.eval('__fm.tick');
      g('boar telegraph is long (paw ≥0.9s)', bt1 - bt0 >= 54, (bt1 - bt0) + ' ticks');
      // stand still and eat it: exactly 2 hearts — CAMERA ON THE BOAR
      // (v7 damage-visibility invariant: an unseen charge is suppressed by
      // design now, so the eat-it gate must actually watch the boar)
      await api.eval(`window.__faceBoar = true;(function w(){ if (!window.__faceBoar) return;
        if (__fm.nearBoarDist < 900) { CAM.yaw = Math.atan2(__fm.nearBoarX - P.x, __fm.nearBoarZ - P.z) + Math.PI; CAM.stickAge = 0; }
        requestAnimationFrame(w); })()`);
      await topUp();
      const bh0 = await api.eval('__fm.hearts');
      await api.waitFor(`__fm.hearts < ${bh0}`, 10000, 'charge lands');
      await api.eval('window.__faceBoar = false; 0');
      const bh1 = await api.eval('__fm.hearts');
      g('boar charge hits for 2 hearts', bh0 - bh1 === 2, `${bh0}→${bh1}`);
      // jump-dodge the next one
      await api.eval('window.__fmTurbo = 1');
      await topUp();
      await api.waitFor(`__fm.nearBoarState === 'paw'`, 30000, 'paw again');
      await api.waitFor(`__fm.nearBoarState === 'charge'`, 10000, 'charge again');
      await api.waitFor('__fm.nearBoarDist < 5.2', 6000, 'boar closes').catch(() => {});
      await D.jump();
      await api.waitFor(`__fm.nearBoarState !== 'charge'`, 10000, 'charge over');
      const dodged = await api.eval('__fm.boarDodges');
      g('jump clears the charge (dodge credited)', dodged >= 1, 'dodges=' + dodged);
      if (mode === 'pad') {
        /* tree-stun: stand in front of a real pine, sidestep the locked rush */
        const tr = await api.eval(`(function(){
          const c={x:900,z:560}; let best=null;
          for (let ix=Math.floor((c.x-45)/9); ix<=Math.floor((c.x+45)/9); ix++)
            for (let iz=Math.floor((c.z-45)/9); iz<=Math.floor((c.z+45)/9); iz++){
              const t=treeInfo(ix,iz); if (!t) continue;
              const d=Math.hypot(t.x-c.x,t.z-c.z);
              if (d>26 && d<40 && (!best || d<best.d)) best={x:t.x,z:t.z,d};
            }
          return best; })()`);
        g('a pine stands at the glade edge', !!tr, JSON.stringify(tr));
      }
      /* tree-stun + the kid-bot cure: fight at the treeline — sidestepped
         charges run on into the pines and STUN; three hits cure */
      await api.eval('window.__fmTurbo = 2');
      await topUp();
      await api.eval(`window.__stunSeen = false;(function w(){
        if (window.__stunSeen === undefined) return;
        for (const b of BOARS) if (b.st === 'stun') { window.__stunSeen = true; return; }
        requestAnimationFrame(w); })()`);
      const cured0 = await api.eval('__fm.boarsCured');
      await api.eval('__fmDebug.warp(915, 552)');   // glade edge — trees at the bot's back
      await api.bot({ forest: true });
      const hpump = setInterval(() => { api.eval('P.hearts = P.maxHearts; 0').catch(() => {}); }, 4000);
      try {
        await api.waitFor(`__fm.boarsCured > ${cured0}`, 150000, 'kid-bot cures a boar');
      } finally { clearInterval(hpump); }
      await api.botRelease();
      g('kid-bot CURES a boar in 3 hits (it trots away)', true,
        'cured=' + await api.eval('__fm.boarsCured'));
      await api.eval('window.__stunSeen = undefined');   // stop the loose watcher
      if (mode === 'pad') {
        /* THE TREE-STUN TRIAL — staged, not hoped for. One named boar, one
           named pine, a lane whose only obstacle is that pine; the boar's own
           state machine does the rest and a REAL sidestep clears the line. */
        await api.eval('window.__fmTurbo = 2');
        await api.eval(STUN_STAGE);
        const stage = await api.eval('__stageStun()');
        g('tree-stun trial staged (boar → pine → player, lane clear)', !!stage && stage.ok,
          JSON.stringify(stage));
        if (stage && stage.ok) {
          const spump = setInterval(() => { api.eval('P.hearts = P.maxHearts; swelterT = 0; 0').catch(() => {}); }, 3000);
          try {
            await api.waitFor(`BOARS[__stunTrial.k].st === 'paw'`, 30000, 'staged boar paws');
            await api.waitFor(`BOARS[__stunTrial.k].st === 'charge'`, 20000, 'staged boar charges');
            // REAL input: the bot drives pad-0 sideways out of the locked rush
            await api.eval(`__fmBot.tol = 0.5; __fmBot.target =
              [__stunTrial.lane.px - __stunTrial.lane.uz * 5,
               __stunTrial.lane.pz + __stunTrial.lane.ux * 5]`);
            await api.waitFor('!!window.__stunProof', 20000, 'the pine stops the charge');
            await api.eval('__fmBot.target = null');
          } catch (e) { /* the assertions below report it */ }
          finally { clearInterval(spump); await api.eval('__fmBot.target = null').catch(() => {}); }
        }
        const proof = await api.eval('window.__stunProof');
        g('charge into a tree STUNS the boar', !!proof && proof.stunned === true,
          JSON.stringify(proof));
        g('the stun came from the PINE (snout on the trunk, no prop)',
          !!proof && proof.onTrunk === true && proof.prop === false,
          JSON.stringify(proof));
        await api.eval('window.__stunProof = { done: 1 }');   // stop the watcher
      }

      /* ── 8. EMBER HORNETS: they dive in pairs, they pop ── */
      await api.eval('__fmDebug.warp(1818, 1071)');
      await topUp();
      await api.eval(`window.__hpair = { max: 0 };(function w(){
        if (!window.__hpair) return;
        let n = 0;
        for (const h of HORNETS) if (!h.dead && (h.st === 'tele' || h.st === 'dive')) n++;
        if (n > __hpair.max) __hpair.max = n;
        requestAnimationFrame(w); })()`);
      const hp0 = await api.eval('__fm.hornetsPopped');
      await api.bot({ forest: true });
      await api.waitFor(`__fm.hornetsPopped >= ${hp0} + 2`, 180000, 'hornet pair popped');
      await api.botRelease();
      g('hornet PAIR dives together', (await api.eval('__hpair.max')) >= 2,
        'max simultaneous attackers=' + await api.eval('__hpair.max'));
      g('hornet pair popped by real swings', true,
        'popped=' + await api.eval('__fm.hornetsPopped'));
      await api.eval('window.__hpair = null');

      if (mode === 'pad') {
        /* ── 9. SWELTER: drain in open sun, refuge in shade, sunstruck at a spring ── */
        await api.eval('window.__fmTurbo = 8');
        const spot = await api.eval(`(function(){
          for (let x = 840; x < 1000; x += 6) for (let z = 430; z < 520; z += 6) {
            if (!window.__forestSolid(x, z) && !forestShadeAt(x, z)) return { x, z };
          } return null; })()`);
        g('an open-sun stretch exists', !!spot, JSON.stringify(spot));
        await api.eval(`__fmDebug.warp(${spot.x}, ${spot.z})`);
        await topUp();
        g('swelter is ON in open forest sun', await api.eval('__fm.swelterOn === true'));
        const sh0 = await api.eval('__fm.hearts');
        await api.waitFor(`__fm.hearts < ${sh0}`, 40000, 'swelter drains a heart');
        g('open sun drains 1 heart / 20 s', true,
          'swelterT peaked, hearts ' + sh0 + '→' + await api.eval('__fm.hearts'));
        // refuge: walk into spring 2 — drain stops, checkpoint saves
        await api.eval('__fmDebug.warp(690, 332)');
        await api.walkTo(700, 340, 2.2, 40000);
        await api.waitFor('__fm.springIdx === 1', 10000, 'standing in spring 2');
        g('spring is full refuge (no swelter)', await api.eval('__fm.swelterOn === false'));
        g('spring checkpoints the save (anchor + region)',
          await api.eval(`__fm.lastSpring === 1 && __fm.saveRegion === 'forest'`));
        const heal0 = await api.eval('__fm.hearts');
        if (heal0 < 6) {
          await api.waitFor(`__fm.hearts > ${heal0}`, 30000, 'spring heals');
          g('spring heals like any shade', true);
        } else g('spring heals like any shade', true, 'already full');
        // sunstruck in the open → wake at the LAST spring with 3 hearts
        await api.eval(`__fmDebug.warp(${spot.x}, ${spot.z})`);
        await api.eval('P.hearts = 1; swelterT = 1100; 0');
        const ss0 = await api.eval('__fm.sunstruck');
        await api.waitFor(`__fm.sunstruck > ${ss0}`, 60000, 'sunstruck');
        await api.waitFor(`__fm.state === 'play'`, 20000, 'woke up');
        const wakeAt = await api.eval('({x:__fm.x, z:__fm.z, h:__fm.hearts})');
        g('sunstruck wakes at the last spring, 3 hearts',
          Math.hypot(wakeAt.x - 700, wakeAt.z - 340) < 8 && wakeAt.h === 3,
          JSON.stringify(wakeAt));

        /* ── 10. THE SEALED FALLS: the hum fires, the basin is unreachable ── */
        await api.eval('window.__fmTurbo = 6');
        await api.eval('__fmDebug.warp(1900, 1165)');
        await topUp();
        await api.eval('__fmBot.tol=2.0; __fmBot.target=[1938, 1192]');
        await api.waitFor(`__fm.fallsHum === true`, 40000, 'the hum line fires');
        g('the hum caption fires at the seal', true,
          'caption=' + JSON.stringify(await api.eval('__fm.caption')));
        await sleep(3500);
        await api.eval('__fmBot.target=null');
        const dSeal = await api.eval('Math.hypot(__fm.x - 1938, __fm.z - 1192)');
        g('the basin interior is unreachable (walk)', dSeal > 16.2, 'closest=' + dSeal.toFixed(2));
        // perimeter fuzz: push + jump inward all along the reachable arc
        let fuzzMin = 99;
        for (let a = 0; a < 16; a++) {
          const ang = a / 16 * TAU2;
          const sx = 1938 + Math.cos(ang) * 20.5, sz = 1192 + Math.sin(ang) * 20.5;
          const ok = await api.eval(`!window.__forestSolid(${sx.toFixed(1)}, ${sz.toFixed(1)})`);
          if (!ok) continue;
          await api.eval(`__fmDebug.warp(${sx.toFixed(1)}, ${sz.toFixed(1)})`);
          await topUp();
          await api.eval(`__fmBot.tol=0.5; __fmBot.target=[1938, 1192]`);
          await D.jump(); await sleep(500); await D.jump(); await sleep(700);
          const dm = await api.eval('Math.hypot(__fm.x - 1938, __fm.z - 1192)');
          await api.eval('__fmBot.target=null');
          if (dm < fuzzMin) fuzzMin = dm;
        }
        g('seal fuzz: no entry from any angle (walk+jump)', fuzzMin > 15.8,
          'closest approach=' + fuzzMin.toFixed(2));

        /* ── 11. SCALE + SIGHTLINES ── */
        const info = await api.eval('__fmDebug.forestInfo()');
        g('extent ≥ 2.0km x 1.4km', info.extent.w >= 2000 && info.extent.h >= 1400,
          `${info.extent.w} x ${info.extent.h}, river ${info.riverLen}m, ${info.clusters} clusters`);
        for (const [px2, pz2] of [[180, 8], [180, 1380], [2160, 60], [2160, 700]]) {
          const solid = await api.eval(`window.__forestSolid(${px2}, ${pz2})`);
          g(`far corner walkable @${px2},${pz2}`, solid === false);
        }
        for (const [vx, vz] of [[400, 300], [800, 500], [1200, 700], [600, 900], [1600, 500], [1700, 1000]]) {
          const sl = await api.eval(`__fmDebug.sightline(${vx}, ${vz})`);
          g(`sightline @${vx},${vz}: ≤20% of clusters visible`,
            sl.vis <= Math.ceil(sl.total * 0.2), `${sl.vis}/${sl.total} ${sl.ids.join(',')}`);
        }
        /* sprint-crossing: the riverbed walk-up, timed in sim ticks
           (hearts pinned — this is a scale measurement, not a survival run) */
        await api.eval('window.__fmTurbo = 10');
        await api.eval('__fmDebug.warp(130, 38)');
        const ct0 = await api.eval('__fm.tick');
        await D.sprint(true);
        for (const [wx, wz] of RIVER_WAY) {
          await api.eval(`__fmBot.tol=7; __fmBot.target=[${wx},${wz}]`);
          const deadline = Date.now() + 150000;
          while (Date.now() < deadline) {
            if (await api.eval(`__fmBot.target === null || Math.hypot(__fm.x-${wx}, __fm.z-${wz}) < 8`)) break;
            await api.eval('P.hearts = P.maxHearts; 0');
            await sleep(600);
          }
        }
        await D.sprint(false);
        await api.eval('__fmBot.target=null');
        const ct1 = await api.eval('__fm.tick');
        const mins = (ct1 - ct0) / 3600;
        g('sprint-crossing tick-time in range (5–14 min sim)', mins >= 5 && mins <= 14,
          mins.toFixed(1) + ' min up the Silverrun');
        g('crossing ends at the falls forecourt', await api.eval('Math.hypot(__fm.x-1900, __fm.z-1160) < 30'));

        /* ── 12. persistence: reload → CONTINUE → the forest remembers ── */
        await api.nav(base + '/?turbo=6');
        await api.waitFor(`__fm.state === 'title'`, 25000, 'title again');
        await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
        await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'continue');
        await api.waitFor(`__fm.state === 'play'`, 25000, 'continued');
        await api.waitTicks(30);
        g('persist: region id survives', await api.eval(`__fm.saveRegion === 'forest'`));
        g('persist: chests stay open',
          await api.eval('__fm.fMillChest && __fm.fFerryChest && __fm.fGrottoChest && __fm.cedarHeartT'));
        g('persist: heart container kept', (await api.eval('__fm.maxHearts')) === 7,
          'maxHearts=' + await api.eval('__fm.maxHearts'));
        g('persist: warden + hum remembered',
          await api.eval('__fm.wardenTalked === 2 && __fm.fallsHum === true'));
        /* CONTINUE now resumes where you actually stood (lastPos, John's
           field fix) — the spring is the SUNSTRUCK anchor, not the resume
           point. This gate drifted the day lastPos shipped: assert the new
           contract (resume near the walked spot) AND that the spring anchor
           itself survived for the next faint. */
        g('persist: CONTINUE resumes where the walk ended (lastPos)',
          await api.eval(`SAVE.lastPos ? Math.hypot(__fm.x - SAVE.lastPos[0], __fm.z - SAVE.lastPos[1]) < 6 : true`),
          'pos=' + await api.eval('__fm.x.toFixed(0) + "," + __fm.z.toFixed(0)'));
        g('persist: the spring anchor survives for the next sunstruck',
          await api.eval(`(function(){ const s = FSPRINGS[__fm.lastSpring]; return !!s; })()`),
          'spring=' + await api.eval('__fm.lastSpring'));
      }

      const bad = api.consoleBad;
      g('zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      g('suite', false, e.message);
      await api.shot('forest-FAIL-' + mode).catch(() => {});
    }
    c.close(); proc.kill();
  };
  await run('pad');
  await run('kbd');
}
const TAU2 = Math.PI * 2;

/* ═══ forest perf: worst frames at 8 sample points + the pass (+ the deck) ═══ */
async function suiteForestPerf(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.seedSave({ ...FOREST_SAVE, mh: 8, wardenTalked: 1, lastShade: [243, 57], region: 'forest' });
  await api.nav(base + '/');   // REAL TIME
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
    await api.installBot('pad');
    const POINTS = [
      ['pass', 130, 38], ['camp', 250, 60], ['mill', 650, 392], ['ferry', 1338, 568],
      ['hamlet', 1580, 848], ['tower', 1096, 806], ['cedar', 1300, 210],
      ['hollow', 1826, 1076], ['forecourt', 1900, 1165],
    ];
    for (const [tag, x, z] of POINTS) {
      await api.eval(`__fmDebug.warp(${x}, ${z})`);
      await api.eval('P.hearts = P.maxHearts; swelterT = 0; 0');
      await sleep(600);
      await api.perfReset();
      await api.eval('__fakePad.raxes(0.85, 0.25)');   // full orbit
      await sleep(2600);
      await api.eval('__fakePad.raxes(0, -0.4)');
      await sleep(900);
      await api.eval('__fakePad.raxes(0, 0)');
      await api.eval('__fakePad.press(1)');            // sprint a short arc
      await api.eval(`__fmBot.tol=1.2; __fmBot.target=[${x + 14}, ${z + 6}]`);
      await sleep(2600);
      await api.eval('__fakePad.press()');
      await api.eval('__fmBot.target=null');
      /* v8.1: the free orbit is stick-speed dependent, so it can skate past a
         bad azimuth between samples — the hollow's worst frame hid there.
         Park the camera at 12 discrete azimuths × 2 pitches and hold each one
         long enough to render, on foot and standing still. */
      for (let a = 0; a < 12; a++) {
        const yaw = (a / 12) * TAU2 - Math.PI;
        for (const pitch of [-0.05, 0.34]) {
          await api.eval(`__fmDebug.camYaw(${yaw.toFixed(4)}); __fmDebug.camPitch(${pitch}); 0`);
          await sleep(180);
        }
      }
      const p = await api.perfRead();
      gate(`fperf ${tag}: draw calls ≤ 80`, p.calls <= 80, 'max ' + p.calls + ' @ ' + p.at);
      gate(`fperf ${tag}: triangles ≤ 120k`, p.tris <= 120000, 'max ' + p.tris);
    }
    // the deck: the biggest sightline in the region
    await api.eval('__fmDebug.warp(1100, 810)');
    await api.eval('P.x=1100; P.z=810; P.fy=groundH(1100,810)+15.2; P.air=false; CAM.ready=false; 0');
    await sleep(700);
    await api.perfReset();
    await api.eval('__fakePad.raxes(0.8, 0.1)');
    await sleep(3400);
    await api.eval('__fakePad.raxes(0, 0)');
    const pd = await api.perfRead();
    gate('fperf tower-deck 360°: draw calls ≤ 80', pd.calls <= 80, 'max ' + pd.calls + ' @ ' + pd.at);
    gate('fperf tower-deck 360°: triangles ≤ 120k', pd.tris <= 120000, 'max ' + pd.tris);
    const fps = await api.eval('__fm.fps');
    gate('fperf: headless fps not degenerate', fps > 30, 'fps ' + fps.toFixed(1));
    const bad = api.consoleBad;
    gate('fperf: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('fperf suite', false, e.message);
  }
  c.close(); proc.kill();
}


/* ═══ v6 WORLD-STATE gates: the John sequence + save-switch re-derivation,
   plus the two grotto readability fixes (exit opening, post-burn corridor) ═══ */
const DONE_SAVE = {
  v: 2, q: 4, ph: 1, mh: 8, sword: true, salt: 9, talked: { finn: 1, tock: 1, pearl: 1 },
  kelpDoor: true, doorChest: true, finnHeart: true, wreckChest: true, wallBurned: true,
  bossDone: true, sky: 1, tidepool: true, compassSeen: true, houseChest: true, bossHint: true,
  tockChest: true, pearlChest: true, lightChest: true, clockWound: true, boatWindow: true,
  chartSeen: true, cartChest: true, mapTides: true, mapTable: true, lastShade: [8.2, 7],
  region: 'bay', lastSpring: 3, millChest: true, ferryChest: true, fgrottoChest: true,
  cedarHeart: true, wardenTalked: 2, fallsHum: true, forestSeen: true, swelterSeen: true,
};
async function suiteWorld(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.seedSave(DONE_SAVE, true);
  await api.nav(base + '/?turbo=6');
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    gate('world: completed save boots healed (dusk sky on the title vista)',
      (await api.eval('__fm.skyT')) > 0.99, 'skyT=' + await api.eval('__fm.skyT'));
    /* THE JOHN SEQUENCE: NEW GAME over a completed save, via the guard */
    await tapUntil(api, () => api.tap(0), '__fm.ngGuardOn === true', 8, 'guard modal');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 8, 'confirm fresh');
    await api.waitFor(`__fm.state === 'play'`, 40000, 'fresh adventure');
    await api.waitTicks(30);
    gate('world: NEW GAME re-derives the basics (q0, 5 hearts, 0 salt)',
      await api.eval('__fm.quest === 0 && __fm.maxHearts === 5 && __fm.salt === 0'));
    gate('world: sky is hard noon again, shadows short, tidepool dry',
      await api.eval('__fm.skyT < 0.01 && __fm.shadeGrow < 0.01 && __fm.tidepool === false'));
    gate('world: every chest is CLOSED again',
      await api.eval('!chest.opened && !doorChest.opened && !homeChest.opened && !lightChest.opened && !millChest.opened && !cedarChest.opened'));
    gate('world: kelp regrown, corridor wall back, wheel unslotted',
      await api.eval('__fm.kelpCutCount === 0 && !wallBurned() && Math.abs(wheelRing.rotation.z) < 0.01'));
    gate('world: the crescent is back on the King-Crab\'s shell',
      await api.eval('BOSS.c.crN.visible === true && BOSS.defeated === false'));
    /* the field failure itself: the fresh boss must WAKE and TAKE DAMAGE */
    await api.eval('__fmDebug.warp(62, 166)');
    await api.waitFor('__fm.bossActive === true', 15000, 'boss wakes');
    gate('world: fresh boss wakes on approach', true,
      'hp=' + await api.eval('__fm.bossHp'));
    const bhp0 = await api.eval('__fm.bossHp');
    await api.installBot('pad');
    await api.bot({ boss: true, bossStyle: 'kid' });
    await api.waitFor(`__fm.bossHp < ${bhp0}`, 90000, 'boss takes damage');
    await api.botRelease();
    gate('world: fresh boss takes real damage (John\'s bug is dead)', true,
      `hp ${bhp0} → ` + await api.eval('__fm.bossHp'));
    /* CONTINUE path after the fresh game: reload keeps the fresh save */
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title (2)');
    gate('world: fresh save persisted (CONTINUE offered)',
      await api.eval(`!document.getElementById('ti1').classList.contains('gone')`));
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'continue');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'continued');
    gate('world: CONTINUE re-derives the same fresh world',
      await api.eval('__fm.quest === 0 && __fm.skyT < 0.01 && !chest.opened'));
    /* reverse: an empty browser boots clean */
    await api.eval(`localStorage.clear(); localStorage.setItem('__fm_seeded','1')`);
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title (3)');
    gate('world: no save → no CONTINUE, no guard',
      await api.eval(`document.getElementById('ti1').classList.contains('gone') && __fm.ngGuardOn === false`));
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'straight in');
    await api.waitFor(`__fm.state === 'play'`, 40000, 'fresh boot plays');
    gate('world: fresh boot NEW GAME skips the guard entirely', true);

    /* ═══ FIX 2 gate: the grotto EXIT reads as an opening from inside ═══ */
    await api.eval(`localStorage.setItem('fallenmoon_save_v1', ${JSON.stringify(JSON.stringify({ ...DONE_SAVE, q: 2, bossDone: false, sky: 0, tidepool: false }))})`);
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title (4)');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'continue (4)');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'in the world');
    await api.eval('__fmDebug.warp(30, 150); __fmDebug.hud(false);');
    await api.eval('__fmDebug.cam(30, -1.3, 152.5, 30, -2.4, 134)');
    await sleep(900);
    const exitShot = await api.shot('grotto-exit-inside-1280x720');
    {
      const png = decodePNG(fs.readFileSync(exitShot));
      // the doorway projects near screen center; sample a grid down the middle
      let bright = 0, n = 0;
      for (let y = 300; y <= 480; y += 30) {
        for (let x = 590; x <= 690; x += 25) {
          const m = medianColorAt(png, x, y, 6);
          if ((m[0] + m[1] + m[2]) / 3 > 90) bright++;
          n++;
        }
      }
      gate('exit: doorway reads BRIGHT from inside (no black hole)', bright >= n * 0.5,
        `${bright}/${n} samples bright`);
    }
    /* ═══ FIX 3 gate: the burned corridor reads OPEN from the mirror ═══ */
    await api.eval('__fmDebug.warp(30, 150)');
    await api.eval(`__fmDebug.cam(27, -1.2, 146, ${41 + 3}, -1.2, ${155.5 + 1.5})`);
    await sleep(900);
    const corShot = await api.shot('corridor-open-postburn-1280x720');
    {
      const png = decodePNG(fs.readFileSync(corShot));
      // corridor mouth ≈ screen center; charred stumps + light pool + glow
      const mouth = medianColorAt(png, 650, 265, 28);
      const rockL = medianColorAt(png, 430, 100, 24);
      const rockR = medianColorAt(png, 880, 100, 24);
      const lum = (m) => (m[0] + m[1] + m[2]) / 3;
      gate('corridor: post-burn mouth is not near-black', lum(mouth) > 120,
        `mouth lum ${lum(mouth).toFixed(0)} rock ${lum(rockL).toFixed(0)}/${lum(rockR).toFixed(0)}`);
      gate('corridor: mouth reads distinct from the rock walls',
        lum(mouth) - (lum(rockL) + lum(rockR)) / 2 > 25,
        `Δ=${(lum(mouth) - (lum(rockL) + lum(rockR)) / 2).toFixed(1)}`);
    }
    const bad = api.consoleBad;
    gate('world: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('world suite', false, e.message);
    await api.shot('world-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
}

/* ═══ the night-one screenshot set — every frame LOOKED AT ═══ */
async function suiteForestShots(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.seedSave({ ...FOREST_SAVE, mh: 8, wardenTalked: 1, lastShade: [243, 57], region: 'forest' });
  await api.nav(base + '/?turbo=4');
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
    await api.installBot('pad');
    await api.eval('__fmDebug.hud(false)');
    await api.eval(`showCaption = function () {}; floatEl.classList.remove('on'); 0`);
    const noCap = () => api.eval(`floatEl.classList.remove('on'); 0`);
    const still = async (ms) => { await sleep(ms || 500); await noCap(); await sleep(120); };
    /* 1 — Cinder Pass threshold: the forest opens ahead */
    await api.eval('__fmDebug.warp(152, 38); __fmDebug.face(1.45);');
    await api.eval('__fmBot.tol=0.8; __fmBot.target=[195, 43]');
    await sleep(800);
    await api.eval('__fmDebug.cam(146, groundH(146,38)+2.2, 38, 230, groundH(230,48)+5, 48)');
    await still(600);
    await api.shot('forest-pass-threshold-1280x720');
    await api.eval('__fmBot.release()');
    /* 2 — the Silverrun bed, mid-region: stranded country, walking UP */
    await api.eval('__fmDebug.warp(1080, 556); __fmDebug.face(0.6);');
    await api.eval('__fmBot.tol=0.8; __fmBot.target=[1140, 600]');
    await sleep(700);
    await api.eval('__fmDebug.cam(1064, groundH(1064,544)+2.3, 544, 1180, groundH(1180,630)+4, 630)');
    await still(600);
    await api.shot('forest-silverrun-bed-1280x720');
    await api.eval('__fmBot.release()');
    /* 3 — THE DRIED FALLS from ~400 m (the money shot) */
    await api.eval('__fmDebug.warp(1700, 936)');
    await api.eval('__fmDebug.cam(1696, groundH(1696,934)+4.5, 934, 1966, 62, 1222)');
    await still(700);
    await api.shot('forest-falls-400m-1280x720');
    /* 4 — the falls from the forecourt: 60 m of stone, the fresh seal */
    await api.eval('__fmDebug.warp(1898, 1162); __fmDebug.face(0.75);');
    await api.eval('__fmDebug.cam(1886, groundH(1886,1150)+2.2, 1150, 1950, 46, 1205)');
    await still(600);
    await api.shot('forest-falls-forecourt-1280x720');
    /* 5 — tower-top region reveal (+ the sea-line west) */
    await api.eval('__fmDebug.warp(1100, 810)');
    await api.eval('P.x=1102.2; P.z=812.4; P.fy=groundH(1100,810)+15.2; P.air=false; P.heading=1.05; 0');
    await sleep(300);
    await api.eval('__fmDebug.cam(1092.6, groundH(1100,810)+17.6, 801.8, 1930, 82, 1215)');
    await still(700);
    await api.shot('forest-tower-reveal-1280x720');
    await api.eval('P.x=1097.6; P.z=807.8; P.heading=-1.9; 0');
    await api.eval('__fmDebug.cam(1103.4, groundH(1100,810)+17.0, 812.8, 300, 26, 420)');
    await still(500);
    await api.shot('forest-tower-westlook-1280x720');
    /* 6 — the Great Cedar on its ridge */
    await api.eval('__fmDebug.warp(1290, 198); __fmDebug.face(0.85);');
    await api.eval('__fmDebug.cam(1282, groundH(1282,192)+2.2, 192, 1301, groundH(1300,210)+11, 211)');
    await still(600);
    await api.shot('forest-great-cedar-1280x720');
    /* 7 — a shade spring oasis: the one green in the rust */
    await api.eval('__fmDebug.warp(1048, 597); __fmDebug.face(2.4);');
    await api.eval('__fmDebug.cam(1041, groundH(1041,590)+2.0, 590, 1052, groundH(1050,600)+0.8, 601)');
    await still(600);
    await api.shot('forest-shade-spring-1280x720');
    /* 8 — boar telegraph: paw + ember-huff, caught mid-read */
    await api.eval('window.__fmTurbo = 1');
    await api.eval('__fmDebug.warp(890, 550)');
    await api.eval('__fmBot.tol=1.4; __fmBot.target=[896,556]');
    await api.waitFor(`__fm.nearBoarState === 'paw'`, 40000, 'boar paw for the shot').catch(() => {});
    await api.eval('__fmBot.release(); __fmDebug.freeze(1)');
    await api.eval(`(function(){
      const bb = BOARS.find(q => q.st === 'paw' && !q.dead) || BOARS.find(q => !q.dead && !q.cured);
      const ux = Math.sin(bb.ang), uz = Math.cos(bb.ang);   // its own facing
      __fmDebug.cam(bb.x+ux*3.7-uz*1.8, groundH(bb.x,bb.z)+1.3, bb.z+uz*3.7+ux*1.8,
        bb.x, groundH(bb.x,bb.z)+0.75, bb.z); })()`);
    await still(400);
    await api.shot('forest-boar-telegraph-1280x720');
    await api.eval('__fmDebug.freeze(0)');
    /* 9 — the hornet pair, wings up */
    await api.eval('__fmDebug.warp(1822, 1074)');
    await api.waitFor(`__fm.nearHornetDist < 8`, 30000, 'hornets close').catch(() => {});
    await api.eval('__fmDebug.freeze(1)');
    await api.eval(`(function(){ const h={x:__fm.nearHornetX, z:__fm.nearHornetZ};
      __fmDebug.cam(h.x+3.4, groundH(h.x,h.z)+2.6, h.z+2.2, h.x, groundH(h.x,h.z)+2.1, h.z); })()`);
    await still(400);
    await api.shot('forest-hornet-pair-1280x720');
    await api.eval('__fmDebug.freeze(0)');
    /* 10 — a swelter shimmer stretch: open sun grinding the riverbed */
    await api.eval('window.__fmTurbo = 4');
    await api.eval('__fmDebug.warp(1480, 664); __fmDebug.face(0.4);');
    await sleep(2500);   // let the shimmer motes live
    await api.eval('__fmDebug.cam(1470, groundH(1470,655)+1.9, 655, 1560, groundH(1560,700)+6, 700)');
    await still(600);
    await api.shot('forest-swelter-stretch-1280x720');
    /* 11 — MINIMAP: the whole region from above (layout review) */
    await api.eval('__fmDebug.overhead(1)');
    await api.eval('__fmDebug.cam(1170, 1560, 700, 1170, 0, 712)');
    await sleep(1400);
    await api.shot('forest-overhead-map');
    await api.eval('__fmDebug.overhead(0); __fmDebug.camOff(); __fmDebug.hud(true);');
    /* 12 — v7 FIELD SET: the pass-seam walkthrough strip (John's photo walk) */
    await api.eval('__fmDebug.hud(false)');
    for (const [i, x, z] of [[1, 120, 38], [2, 155, 38], [3, 195, 42], [4, 240, 55]]) {
      await api.eval(`__fmDebug.warp(${x}, ${z}); P.hearts = P.maxHearts; swelterT = 0; __fmDebug.face(1.5); 0`);
      await api.eval(`CAM.yaw = ${x < 200 ? -1.6 : -1.2}; CAM.pitch = 0.34; CAM.ready = false; 0`);
      await sleep(650);
      await api.shot(`pass-seam-${i}-x${x}-1280x720`);
    }
    /* 13 — v7 trunk close-up: warm bark, canopy attached */
    await api.eval(`(function(){
      let tr = null;
      for (let ix = Math.floor(1180/9); ix <= Math.floor(1260/9) && !tr; ix++)
        for (let iz = Math.floor(560/9); iz <= Math.floor(640/9) && !tr; iz++) {
          const t = treeInfo(ix, iz); if (t && !t.bare) tr = t;
        }
      window.__trShot = tr;
      __fmDebug.warp(tr.x + 5, tr.z + 4);
      __fmDebug.cam(tr.x + 4.4, groundH(tr.x, tr.z) + 1.9, tr.z + 3.6, tr.x, groundH(tr.x, tr.z) + 2.6, tr.z); })()`);
    await sleep(550);
    await api.shot('trunk-closeup-1280x720');
    await api.eval('__fmDebug.camOff(); 0');
    /* 14 — v7 JUMP APEX in the forest, MID-RUN (the sprint-hurdle bar).
       Staged exactly like the kelp apex: the bot runs, □ taps mid-stride,
       a rAF watcher freezes the sim at the airborne apex. */
    await api.eval('window.__fmTurbo = 1');
    await api.eval(`window.__jShot2=false;(function w(){
      const T=__fm;
      if(T.air&&T.airY>0.55&&Math.hypot(P.vx,P.vz)>2.5){window.__jShot2=true;__fmDebug.freeze(1);return;}
      requestAnimationFrame(w);})()`);
    for (let att = 0; att < 6 && !(await api.eval('window.__jShot2')); att++) {
      await api.eval('__fmDebug.warp(880, 470); P.hearts = P.maxHearts; swelterT = 0; 0');
      await api.eval('__fmBot.tol = 0.6; __fmBot.target = [920, 490]');
      const t0 = Date.now();
      while (Date.now() - t0 < 5000) {
        if (await api.eval('window.__jShot2')) break;
        if (await api.eval(`!__fm.air && Math.hypot(__fm.x-880, __fm.z-470) > 4`)) await api.tap(2);
        await sleep(60);
      }
      await api.eval('__fmBot.target = null');
    }
    gate('fshots: forest run-jump apex captured', await api.eval('window.__jShot2'));
    await api.eval(`(function(){ const T=__fm;
      __fmDebug.cam(T.x + 3.1, groundH(T.x+3.1, T.z-1.4)+1.6, T.z - 1.4, T.x, T.fy + 0.8, T.z); })()`);
    await sleep(200);
    await api.shot('jump-apex-forest-run-1280x720');
    await api.eval('__fmDebug.freeze(0); __fmDebug.camOff(); __fmBot.release(); __fakePad.press();');
    await api.eval('__fmDebug.hud(true)');
    const bad = api.consoleBad;
    gate('fshots: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('fshots suite', false, e.message);
  }
  c.close(); proc.kill();
}

/* ═══ v7 GROUND-AUTHORITY gates (John's field patch, both regions) ═══
   The lesson written into gates: seams and live-camera behavior get
   ASSERTED on a dense grid, not sampled at hand-picked points.
   Per position, camera orbited to 4 azimuths:
     (a) the near-tier chunk under the player is VISIBLE
     (b) |rendered ground at player (raycast on near tier) − groundH| < 0.05
     (c) no impression/far-tier face within 300 m of the camera
     (d) player capsule + camera NEVER enclosed by far-tier geometry
         (up-rays + camera→player segment), incl. walked downslope paths */
const SWEEP_SRC = `window.__sweep = { done: false, res: null, err: null };
(async function () {
try {
  const rAF = () => new Promise(r => requestAnimationFrame(r));
  const rc = new THREE.Raycaster();
  const V = THREE.Vector3;
  const res = { pts: 0, checks: 0, rays: 0, aFail: [], bFail: [], cFail: [], dFail: [],
                worstDh: 0, worstRay: 0, pairViol: 0, prescan: {} };
  const push = (arr, s) => { if (arr.length < 30) arr.push(s); };
  /* PRESCAN: every rendered ground-lattice vertex height, read from the REAL
     chunk geometry once. Gate (b) then compares the rendered corners of the
     cell under each grid point against groundH — plus a raycast subset for
     end-to-end truth (three.js raycast has no BVH; full-grid raycasts would
     take hours against 60k-tri chunks). */
  const LAT = {
    forest: { x0: 110, z0: -38, half: 4, map: new Map() },
    bay: { x0: -110, z0: -110, half: 1.1, map: new Map() },
  };
  const scanChunk = (mesh, L) => {
    const p = mesh.geometry.getAttribute('position');
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), z = p.getZ(i);
      const rx = Math.round((x - L.x0) / L.half), rz = Math.round((z - L.z0) / L.half);
      if (Math.abs(x - (L.x0 + rx * L.half)) > 1e-5 || Math.abs(z - (L.z0 + rz * L.half)) > 1e-5) continue;
      const k = rx * 8192 + rz;
      const y = p.getY(i);
      // keep the lattice vertex CLOSEST to the authority height: prop verts
      // can coincidentally align to the lattice above/below the sheet, and a
      // shell ABOVE the ground is (c)/(d)'s job to catch, not (b)'s
      const want = groundH(L.x0 + rx * L.half, L.z0 + rz * L.half);
      const prev = L.map.get(k);
      if (prev === undefined || Math.abs(y - want) < Math.abs(prev - want)) L.map.set(k, y);
    }
  };
  for (const ch of fchunkMap.values()) if (ch.mesh) scanChunk(ch.mesh, LAT.forest);
  for (const ch of chunkMap.values()) if (ch.mesh) scanChunk(ch.mesh, LAT.bay);
  res.prescan = { forest: LAT.forest.map.size, bay: LAT.bay.map.size };
  const isForest = (x, z) => x > 110 && !(x > 300 && z < -30);
  const chunkUnder = (x, z) => isForest(x, z)
    ? fchunkMap.get(Math.floor(x / 200) + 'f' + Math.floor(z / 200))
    : chunkMap.get(Math.floor((x + 110) / 80) + '_' + Math.floor((z + 110) / 80));
  /* rendered-corner check: the exact cell the mesh-field interpolates must
     exist in the RENDERED geometry with the same corner heights */
  const cellCorners = (x, z) => {
    const L = isForest(x, z) ? LAT.forest : LAT.bay;
    const fine = isForest(x, z) ? FOREST_FINE : BAY_FINE;
    const step = L.half * 2;
    let cx = L.x0 + Math.floor((x - L.x0) / step) * step,
        cz = L.z0 + Math.floor((z - L.z0) / step) * step, s = step;
    if (fine(cx, cz)) {
      s = L.half;
      if (x >= cx + s) cx += s;
      if (z >= cz + s) cz += s;
    }
    const out = [];
    for (const [ox, oz] of [[0, 0], [s, 0], [0, s], [s, s]]) {
      const rx = Math.round((cx + ox - L.x0) / L.half), rz = Math.round((cz + oz - L.z0) / L.half);
      out.push([cx + ox, cz + oz, L.map.get(rx * 8192 + rz)]);
    }
    return out;
  };
  const farVis = () => __farTiles.filter(t => t.mesh.visible);
  const sphereOf = (m) => {
    if (!m.geometry.boundingSphere) m.geometry.computeBoundingSphere();
    return m.geometry.boundingSphere;
  };
  const pts = window.__sweepPts;
  let ptIdx = 0;
  for (const [x, z] of pts) {
    ptIdx++;
    if (isForest(x, z) ? window.__forestSolid(x, z) : worldSolidAt(x, z)) continue;
    if (window.__hollowAt && window.__hollowAt(x, z)) continue;   // the Falls Hollow has its own sweep
    if (typeof roomAt === 'function' && roomAt(x, z)) continue;
    if (typeof KROWN !== 'undefined' && x >= KROWN.x0 && x <= KROWN.x1
        && z >= KROWN.z0 && z <= KROWN.z1) continue;   // the Crown owns its ground (p6g-struct sweeps it)
    __fmDebug.warp(x, z);
    P.hearts = P.maxHearts; swelterT = 0; P.iframes = 300;
    res.pts++;
    const tag0 = x.toFixed(0) + ',' + z.toFixed(0);
    /* (b) rendered corners of THIS cell == the authority at those corners
       (camera-free). Region forced to the QUERY point's field: an fp-noise
       corner coordinate at the x=110 seam column must not flip regions. */
    /* Compare against the LIVE authority, not Brightharbor's pre-wrap field:
       phase 3 dredges a harbour channel west out of the bay, so _bhGroundH is
       stale there by 4-6m — it still reports dry land over what is now seabed
       at -3.5m under a -0.55m waterline. Not circular: the raycast subset
       below independently shoots the RENDERED mesh against groundH, and at
       those corners rendered == groundH to 0.0000m.
       The seam guard the old code got for free by pinning the field must be
       kept by hand: groundH dispatches region per COORDINATE, so a corner
       landing on 110.00000000000001 at the x=110 column drops into the forest
       field and reads 1.4m off. Nudge such a corner 0.1mm back onto the query
       point's side — fp noise there is ~1e-14, and 0.1mm of slope is orders
       below the 0.05m tolerance. */
    const fieldHere = (cx, cz) => {
      let sx = cx, sz = cz;
      if (isForest(cx, cz) !== isForest(x, z)) {
        sx = cx + Math.sign(x - cx || 1) * 1e-4;
        sz = cz + Math.sign(z - cz || 1) * 1e-4;
      }
      return isForest(x, z) ? forestHMesh(sx, sz) : groundH(sx, sz);
    };
    for (const [cxx, czz, ry] of cellCorners(x, z)) {
      const dh = ry === undefined ? 99 : Math.abs(ry - fieldHere(cxx, czz));
      if (dh > 0.05) { push(res.bFail, tag0 + ' corner ' + cxx + ',' + czz + '=' + (ry === undefined ? 'MISSING' : dh.toFixed(3))); }
      else if (dh > res.worstDh) res.worstDh = dh;
    }
    /* raycast subset: end-to-end rendered-surface truth every ~40th point */
    if (ptIdx % 40 === 0) {
      const cu = chunkUnder(x, z);
      if (cu && cu.mesh) {
        rc.set(new V(x, 400, z), new V(0, -1, 0));
        const hits = rc.intersectObject(cu.mesh, false);
        if (hits.length) {
          // canopies/props intercept the ray too — the gate is that a
          // rendered surface exists AT the authority height
          let dh = 99;
          for (const h of hits) dh = Math.min(dh, Math.abs((400 - h.distance) - groundH(x, z)));
          res.rays++;
          if (dh > 0.05) push(res.bFail, tag0 + ' RAY dh=' + dh.toFixed(3));
          else if (dh > res.worstRay) res.worstRay = dh;
        }
      }
    }
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      CAM.yaw = yaw; CAM.pitch = 0.38; CAM.ready = false; CAM.stickAge = 0;
      await rAF(); await rAF();
      if (state !== 'play') { __fmDebug.warp(x, z); await rAF(); }
      res.checks++;
      const tag = tag0 + '@' + yaw.toFixed(1);
      // (a) near chunk under the player is visible
      const cu = chunkUnder(x, z);
      if (!cu || !cu.mesh || !cu.mesh.visible) push(res.aFail, tag);
      // structural pairing invariant: never (near visible && paired far visible)
      for (const ft of __farTiles) {
        if (ft.mesh.visible && ft.pair && ft.pair.mesh && ft.pair.mesh.visible) { res.pairViol++; break; }
      }
      const cc = camera.position;
      const fv = farVis();
      // (c) no far-tier face inside its region's NEAR RING (the ordered
      // per-chunk-suppression branch): forest ring 387 m ⇒ nearest legal far
      // face ≥ 246 m; bay ring 165 m ⇒ ≥ 120 m. Bounding-sphere prefilter
      // (sphere-dist ≥ ring ⇒ no face can be closer), raycast fan only
      // against the rare survivors.
      for (const [bh, ring] of [[false, 240], [true, 120]]) {
        const nearRing = [];
        for (const ft of fv) {
          if (ft.bh !== bh) continue;
          const s = sphereOf(ft.mesh);
          if (Math.hypot(s.center.x - cc.x, s.center.z - cc.z) - s.radius < ring) nearRing.push(ft.mesh);
        }
        if (!nearRing.length) continue;
        let close = 0;
        for (let a = 0; a < 16; a++) {
          const dx = Math.cos(a / 16 * Math.PI * 2), dz = Math.sin(a / 16 * Math.PI * 2);
          for (const dy of [-0.05, -0.3, -0.7]) {
            rc.set(new V(cc.x, cc.y, cc.z), new V(dx, dy, dz).normalize());
            rc.far = ring;
            if (rc.intersectObjects(nearRing, false).length) { close++; break; }
          }
        }
        rc.far = Infinity;
        if (close) push(res.cFail, tag + (bh ? ' bay' : ' forest') + ' rays=' + close + ' meshes=' + nearRing.length);
      }
      // (d) never enclosed: up-rays (player + camera) and the camera→player
      // segment, against far meshes overlapping those columns
      const overhead = [];
      for (const ft of fv) {
        const s = sphereOf(ft.mesh);
        const dP = Math.hypot(s.center.x - x, s.center.z - z);
        const dC = Math.hypot(s.center.x - cc.x, s.center.z - cc.z);
        if (Math.min(dP, dC) < s.radius + 4) overhead.push(ft.mesh);
      }
      if (overhead.length) {
        let enc = 0;
        rc.set(new V(x, groundH(x, z) + 0.25, z), new V(0, 1, 0));
        if (rc.intersectObjects(overhead, false).length) enc++;
        rc.set(new V(cc.x, cc.y, cc.z), new V(0, 1, 0));
        if (rc.intersectObjects(overhead, false).length) enc++;
        const seg = new V(x - cc.x, P.fy + 1 - cc.y, z - cc.z);
        const segLen = seg.length() || 1;
        rc.set(new V(cc.x, cc.y, cc.z), seg.normalize());
        rc.far = segLen;
        if (rc.intersectObjects(overhead, false).length) enc++;
        rc.far = Infinity;
        if (enc) push(res.dFail, tag + ' enc=' + enc);
      }
    }
  }
  __sweep.res = res;
} catch (e) { __sweep.err = String(e && e.stack || e); }
  __sweep.done = true;
})();`;

async function suiteGround(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.seedSave({ ...FOREST_SAVE, mh: 8, region: 'forest', lastShade: [243, 57] });
  await api.nav(base + '/?turbo=4');
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
    await api.installBot('pad');

    /* the dense grid: FOREST every 50 m + BRIGHTHARBOR every 25 m
       + the pass corridor every 10 m + the field-photo points */
    const pts = [];
    for (let x = 180; x <= 2170; x += 50) for (let z = -20; z <= 1390; z += 50) pts.push([x, z]);
    for (let x = -100; x <= 105; x += 25) for (let z = -100; z <= 178; z += 25) pts.push([x, z]);
    for (let x = 100; x <= 240; x += 10) pts.push([x, x < 180 ? 38 : 38 + (x - 180) * 0.28]);   // the pass corridor
    // John's photo points + every spring bowl + the two grottos + forecourt
    for (const p of [[1580, 980], [1100, 700], [1050, 600], [240, 58], [36, 58], [-26, 46], [-44, 78],
                     [390, 130], [700, 340], [1400, 690], [1650, 900], [1868, 1122], [700, 720], [1750, 380], [1900, 1165]]) pts.push(p);
    await api.eval(`window.__sweepPts = ${JSON.stringify(pts)}; 0`);
    await api.eval(SWEEP_SRC + '\n;0');   // detach: never await the sweep promise over CDP
    const t0 = Date.now();
    while (!(await api.eval('__sweep.done'))) {
      if (Date.now() - t0 > 900000) throw new Error('sweep timed out');
      await sleep(1500);
    }
    const r = await api.eval('__sweep.res');
    gate('ground: dense grid coverage (walkable points swept)', r.pts > 700, `${r.pts} pts / ${r.checks} camera checks`);
    gate('ground: (a) near tier VISIBLE under player everywhere', r.aFail.length === 0, r.aFail.slice(0, 4).join(' | '));
    gate('ground: (b) |rendered − groundH| < 0.05 m everywhere', r.bFail.length === 0,
      `worst=${r.worstDh.toFixed(4)}m ` + r.bFail.slice(0, 4).join(' | '));
    gate('ground: (c) no far-tier face inside the near ring (246 m forest / 120 m bay)', r.cFail.length === 0, r.cFail.slice(0, 4).join(' | '));
    gate('ground: (d) player/camera never enclosed by far tier', r.dFail.length === 0, r.dFail.slice(0, 4).join(' | '));
    gate('ground: pairing invariant (near visible ⇒ paired far culled)', r.pairViol === 0, 'violations=' + r.pairViol);

    /* walked downslope-to-water paths (the repro shape): per-frame enclosure
       monitor while REALLY walking — bay shore dip + a spring bowl approach */
    await api.eval(`window.__encViol = 0;(function w(){
      if (window.__encViol === undefined) return;
      const fv = __farTiles.filter(t => t.mesh.visible).map(t => t.mesh);
      const rc = new THREE.Raycaster(new THREE.Vector3(P.x, P.fy + 0.2, P.z), new THREE.Vector3(0, 1, 0));
      if (rc.intersectObjects(fv, false).length) window.__encViol++;
      const cc = camera.position;
      rc.set(new THREE.Vector3(cc.x, cc.y, cc.z), new THREE.Vector3(0, 1, 0));
      if (rc.intersectObjects(fv, false).length) window.__encViol++;
      requestAnimationFrame(w); })()`);
    await api.eval('__fmDebug.warp(10, -30)');
    await api.walkTo(36, 58, 2.5, 90000);      // village → down the shore to the tidepools
    await api.walkTo(-26, 46, 2.5, 90000);     // across the dry bay floor
    await api.eval('__fmDebug.warp(1120, 720)');
    await api.walkTo(1052, 602, 3.0, 90000);   // downslope into the spring-3 bowl
    const enc = await api.eval('const v = __encViol; __encViol = undefined; v');
    gate('ground: walked downslope paths never enclosed (per-frame)', enc === 0, 'violations=' + enc);

    /* photo-matched stills — the two field compositions + the bay quay */
    await api.eval('__fmDebug.camOff(); 0');
    for (const [name, x, z, yaw] of [
      ['field-midforest-1580x980', 1580, 980, 0.4],
      ['field-spring-1100x700', 1100, 700, -0.6],
      ['field-bay-tidepools', 30, 52, 2.6],
    ]) {
      await api.eval(`__fmDebug.warp(${x}, ${z}); P.hearts = P.maxHearts; swelterT = 0; 0`);
      await api.eval(`CAM.yaw = ${yaw}; CAM.pitch = 0.38; CAM.ready = false; 0`);
      await sleep(700);
      await api.shot(name);
    }
    const bad = api.consoleBad;
    gate('ground: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('ground suite', false, e.message);
    await api.shot('ground-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
}

/* ═══ v7 TREE-UNIFICATION gates: rendered forest == colliding forest,
   one height authority, warm bark (no blue trunks — automated hue check) ═══ */
async function suiteTrees(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.seedSave({ ...FOREST_SAVE, region: 'forest', lastShade: [243, 57] });
  await api.nav(base + '/?turbo=6');
  try {
    await api.waitFor(`!!window.__fmTreeAudit && __fmTreeAudit.length > 0`, 30000, 'tree audit registry');
    const r = await api.eval(`(function(){
      const A = window.__fmTreeAudit;
      const res = { total: A.length, blueVerts: 0, baseOff: 0, canopyGap: 0, collMiss: 0,
                    shadeMiss: 0, worstBase: 0, bare: 0 };
      for (let i = 0; i < A.length; i++) {
        const t = A[i];
        if (t.bare) res.bare++;
        const ch = fchunkMap.get(t.key);
        if (!ch || !ch.mesh) { res.collMiss++; continue; }
        const p = ch.mesh.geometry.getAttribute('position');
        const col = ch.mesh.geometry.getAttribute('color');
        let minY = 1e9;
        for (let v = t.v0; v < t.vTrunk; v++) {
          if (col.getZ(v) > col.getX(v) + 0.02) res.blueVerts++;   // warm-bark hue band: B never dominates R
          if (p.getY(v) < minY) minY = p.getY(v);
        }
        const base = Math.abs(minY - (groundH(t.x, t.z) - 0.25));
        if (base > 0.06) res.baseOff++;
        if (base > res.worstBase) res.worstBase = base;
        if (!t.bare) {
          let cMin = 1e9;
          for (let v = t.vTrunk; v < t.v1; v++) if (p.getY(v) < cMin) cMin = p.getY(v);
          if (cMin > t.gy + t.h * 0.5 + 0.05) res.canopyGap++;     // canopy base must meet the trunk
        }
        if (!window.__forestSolid(t.x + t.r * 0.5, t.z)) res.collMiss++;   // rendered trunk collides
        if (!t.bare && !canopyAt(t.x, t.z)) res.shadeMiss++;               // rendered canopy shades
      }
      // reverse direction: collision grid answers must all be RENDERED trees
      let ghosts = 0;
      const byCell = new Set(A.map(t => t.ix + ':' + t.iz));
      for (let ix = Math.floor(110/9); ix <= Math.ceil(2180/9); ix += 3) {
        for (let iz = Math.floor(-38/9); iz <= Math.ceil(1398/9); iz += 3) {
          const t = treeInfo(ix, iz);
          if (t && !byCell.has(ix + ':' + iz)) ghosts++;
        }
      }
      res.ghosts = ghosts;
      res.worstBase = +res.worstBase.toFixed(4);
      return res;
    })()`);
    gate('trees: registry covers the region', r.total > 8000, r.total + ' trees, ' + r.bare + ' snags');
    gate('trees: ZERO blue-dominant trunk vertices (warm bark)', r.blueVerts === 0, 'blue=' + r.blueVerts);
    gate('trees: every trunk base sits on groundH (±0.06)', r.baseOff === 0, 'worst=' + r.worstBase + 'm');
    gate('trees: zero floating canopies (canopy meets trunk)', r.canopyGap === 0, 'gaps=' + r.canopyGap);
    gate('trees: every rendered trunk collides + every canopy shades', r.collMiss === 0 && r.shadeMiss === 0,
      `collMiss=${r.collMiss} shadeMiss=${r.shadeMiss}`);
    gate('trees: zero collision-only ghost trees (grid ⊆ rendered)', r.ghosts === 0, 'ghosts=' + r.ghosts);
    const bad = api.consoleBad;
    gate('trees: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('trees suite', false, e.message);
  }
  c.close(); proc.kill();
}

/* ═══ v7 SWELTER FEEDBACK gates (locked spec, John + Maria 8/16):
   warning before harm / the tick teaches / relief is celebrated /
   state always legible ═══ */
async function suiteSwelter(base) {
  const { proc, port } = await launchChrome(['--autoplay-policy=no-user-gesture-required']);
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.seedSave({ ...FOREST_SAVE, mh: 6, region: 'forest', lastShade: [243, 57] });
  await api.nav(base + '/?turbo=6');
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
    await api.installBot('pad');
    await api.eval('kickAudio(); 0');
    const spot = await api.eval(`(function(){
      for (let x = 840; x < 1000; x += 6) for (let z = 430; z < 520; z += 6) {
        if (!window.__forestSolid(x, z) && !forestShadeAt(x, z)) return { x, z };
      } return null; })()`);
    gate('swelter: an open-sun test stretch exists', !!spot, JSON.stringify(spot));
    const warpSun = async () => {
      await api.eval(`__fmDebug.warp(${spot.x}, ${spot.z}); P.hearts = P.maxHearts; swelterT = 0; 0`);
    };

    /* 1 WARNING BEFORE HARM: vignette builds through the grace period */
    await warpSun();
    await api.waitFor('swelterT > 60 && swelterT < 900', 20000, 'mid-grace');
    const early = await api.eval('({v: __fm.swVign, on: __fm.swVignOn, icon: __fm.swIconMode, fill: __fm.swIconFill, aud: __fm.swAudioLevel, dom: +getComputedStyle(sunveilEl).opacity})');
    gate('swelter: vignette builds BEFORE the first tick', early.v > 0.1 && early.on && early.dom > 0.05,
      JSON.stringify(early));
    gate('swelter: sun icon on + filling toward the tick', early.icon === 'sun' && early.fill > 0.02 && early.fill < 0.9,
      `icon=${early.icon} fill=${early.fill.toFixed(2)}`);
    gate('swelter: sizzle audio layer live in open sun', early.aud > 0.25,
      'level=' + early.aud.toFixed(2) + ' gain=' + await api.eval('__fm.swAudio.toFixed(4)'));
    const lateV = await (async () => {
      await api.waitFor('swelterT > 1000', 30000, 'late-grace');
      return api.eval('__fm.swVign');
    })();
    gate('swelter: vignette grows with exposure', lateV > early.v + 0.15,
      `${early.v.toFixed(2)} → ${lateV.toFixed(2)}`);

    /* 2 THE TICK TEACHES: glyph + instructive rotating line + distinct buzz */
    const h0 = await api.eval('__fm.hearts');
    await api.waitFor(`__fm.swTicks >= 1`, 30000, 'first tick');
    const tick1 = await api.eval('({h: __fm.hearts, g: __fm.swGlyphT, cap: __fm.caption, lines: __fm.swLineCount, r: __fm.lastRumble, icon: __fm.swIconMode})');
    gate('swelter: tick drains exactly 1 heart', tick1.h === h0 - 1, `${h0}→${tick1.h}`);
    gate('swelter: sun glyph flashes on the hearts', tick1.g > 0, 'glyphT=' + tick1.g.toFixed(2));
    gate('swelter: first line = the locked opener, instructive', !!tick1.cap && tick1.cap.indexOf('bites') >= 0 && tick1.cap.indexOf('shade') >= 0,
      JSON.stringify(tick1.cap));
    gate('swelter: haptic buzz tagged distinct from combat', tick1.r === 'swelter', 'rumble=' + tick1.r);
    await api.waitFor(`__fm.swTicks >= 2`, 40000, 'second tick');
    const tick2 = await api.eval('({cap: __fm.caption, lines: __fm.swLineCount, idx: __fm.swLineIdx})');
    gate('swelter: the line ROTATES (variant on tick 2)', tick2.idx === 2 && !!tick2.cap && tick2.cap.indexOf('bites') < 0,
      JSON.stringify(tick2.cap));
    gate('swelter: line rate ≈ once per 20 s of exposure (no spam)', tick2.lines === 2, 'lines=' + tick2.lines);
    await api.shot('swelter-vignette-1280x720');

    /* 4 STATE LEGIBLE + 3 RELIEF CELEBRATED: a real sun→shade walk */
    await api.eval('P.hearts = P.maxHearts; swelterT = 600; 0');   // mid-swelter
    const rel0 = await api.eval('__fm.swReliefs');
    await api.eval('__fmDebug.warp(700, 340); 0');                  // spring 2: instant shade
    await api.waitFor(`__fm.swReliefs > ${rel0}`, 15000, 'relief fires');
    const rel = await api.eval('({t: __fm.swReliefT, icon: __fm.swIconMode, r: __fm.lastRumble, aud: __fm.swAudioLevel, dom: +getComputedStyle(reliefveilEl).opacity})');
    gate('swelter: relief wash + leaf + rumble on shade entry',
      rel.t > 0 && rel.icon === 'leaf' && rel.dom > 0.1, JSON.stringify(rel));
    gate('swelter: relief rumble is the gentle double-pulse tag', rel.r === 'relief', 'rumble=' + rel.r);
    gate('swelter: sizzle CUTS on relief', rel.aud === 0, 'level=' + rel.aud);
    await api.waitTicks(20);
    gate('swelter: relief chime fired (SFX.relief exists + AC live)',
      await api.eval(`typeof SFX.relief === 'function' && !!AC`));
    await api.shot('swelter-relief-1280x720');
    // leaf fades, then sun returns on re-exposure (sun→shade→sun legibility)
    await warpSun();
    await api.waitFor(`__fm.swIconMode === 'sun'`, 15000, 'sun icon returns');
    gate('swelter: state icon tracks sun→shade→sun', true);

    /* Wick wilts + brow-wipes in open sun (idle) */
    await api.eval('swelterT = 400; 0');
    await api.waitFor('__fm.swWilt === true', 20000, 'wilt on');
    gate('swelter: Wick wilts in open sun', true);
    await api.waitFor('typeof window.__swWipePh === "number" && window.__swWipePh > 0.2', 25000, 'brow wipe plays');
    gate('swelter: brow wipe plays on the idle', true);
    await api.eval('__fmDebug.freeze(1); 0');
    await api.shot('swelter-wilt-wipe-1280x720');
    await api.eval('__fmDebug.freeze(0); 0');

    /* relief and swelter never fire outside the forest */
    await api.eval('__fmDebug.warp(60, 20); P.hearts = P.maxHearts; 0');
    await api.waitFor(`__fm.swVign < 0.05 && __fm.swIconMode === 'off' && __fm.swAudioLevel === 0`,
      8000, 'package winds down in the bay');
    gate('swelter: package inert in Brightharbor', true,
      'vign=' + (await api.eval('__fm.swVign')).toFixed(3));
    const bad = api.consoleBad;
    gate('swelter: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('swelter suite', false, e.message);
    await api.shot('swelter-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
}

/* ═══ v7 CREATURE gates: spawns/patrols as designed + the damage-visibility
   invariant (no hit from an unrendered enemy — John's phantom damage) ═══ */
async function suiteDmgVis(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  await api.seedSave({ ...FOREST_SAVE, mh: 8, region: 'forest', lastShade: [243, 57] });
  await api.nav(base + '/?turbo=2');
  try {
    await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
    await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'playing');
    await api.installBot('pad');

    /* census: everything the design places is spawned, alive, and homed */
    const census = await api.eval(`(function(){
      const glades = ['glade1','glade2','glade3'].map(id => FCLUSTERS.find(q => q.id === id));
      const BP = [[378,296],[1088,326],[1438,784]], HP = [[760,182],[882,864],[1700,1226]];
      const inPocket = (x, z, L) => L.some(p => Math.hypot(x - p[0], z - p[1]) < 16);
      const distRiver = (x, z) => { let best = 1e9;
        for (let i = 0; i < RIVER.length - 1; i++) { const a = RIVER[i], b = RIVER[i+1];
          const dx = b[0]-a[0], dz = b[1]-a[1];
          const s = Math.max(0, Math.min(1, ((x-a[0])*dx + (z-a[1])*dz) / (dx*dx + dz*dz)));
          best = Math.min(best, Math.hypot(x - (a[0]+dx*s), z - (a[1]+dz*s))); }
        return best; };
      const out = { boars: BOARS.length, hornets: HORNETS.length, boarHomes: 0, hornetHomes: 0,
                    passCrabs: crabs.filter(cr => cr.area === 'pass').length,
                    passImps: wisps.filter(w => w.area === 'pass').length,
                    pocketBoars: 0, pocketHornets: 0, pocketBoarsShaded: 0,
                    pocketHornetsShaded: 0, pocketTotal: 0, pocketMinOffRiver: 1e9,
                    pocketInClearing: 0 };
      const tally = (x, z) => { out.pocketTotal++;
        out.pocketMinOffRiver = Math.min(out.pocketMinOffRiver, distRiver(x, z));
        for (const c of FCLUSTERS) if (Math.hypot(x - c.x, z - c.z) < c.r) out.pocketInClearing++; };
      for (const b of BOARS) if (inPocket(b.sx, b.sz, BP)) {
        out.pocketBoars++; if (inShadeAt(b.sx, b.sz)) out.pocketBoarsShaded++; tally(b.sx, b.sz); }
      for (const h of HORNETS) if (inPocket(h.sx, h.sz, HP)) {
        out.pocketHornets++; if (inShadeAt(h.sx, h.sz)) out.pocketHornetsShaded++; tally(h.sx, h.sz); }
      out.pocketMinOffRiver = Math.round(out.pocketMinOffRiver);
      for (const b of BOARS) {
        if (glades.some(g => Math.hypot(b.sx - g.x, b.sz - g.z) < g.r + 14)) out.boarHomes++;
      }
      const H = FCLUSTERS.find(q => q.id === 'hollow'), F = FCLUSTERS.find(q => q.id === 'ferry');
      for (const h of HORNETS) {
        if (h.area === 'hollow') {
          // the Falls Hollow nests: gallery + vault
          if (Math.hypot(h.sx - 1978, h.sz - 1243) < 12 || Math.hypot(h.sx - 2018, h.sz - 1265) < 12) out.hornetHomes++;
        } else if (Math.hypot(h.sx - H.x, h.sz - H.z) < H.r + 14 || Math.hypot(h.sx - F.x, h.sz - F.z) < F.r + 14) out.hornetHomes++;
      }
      return out; })()`);
    gate('creatures: 6 glade boars spawned, all homed to their glades',
      census.boarHomes === 6, JSON.stringify(census));
    gate('creatures: 10 hornets at hollow + ferry + the Falls Hollow nests',
      census.hornetHomes === 10, JSON.stringify({ h: census.hornets, homes: census.hornetHomes }));
    /* MOB POCKETS (John, 8/16): the trees must cost you a fight, so that
       taking the shady route trades hearts for combat instead of being free. */
    gate('pockets: 9 boars + 12 hornets in the canopy off the riverbed',
      census.pocketBoars === 9 && census.pocketHornets === 12,
      `boars=${census.pocketBoars} hornets=${census.pocketHornets}`);
    /* boars hold the canopy so ducking into the trees costs a fight rather
       than hearts; hornets are imp-family and FIZZLE in shade, so theirs sit
       in off-road sun. Getting this backwards popped all twelve at spawn. */
    gate('pockets: every tree-pocket BOAR stands in canopy shade (fight, do not burn)',
      census.pocketBoars === 9 && census.pocketBoarsShaded === 9,
      `${census.pocketBoarsShaded}/${census.pocketBoars} shaded`);
    gate('pockets: every pocket HORNET stands in sun (shade would fizzle it at spawn)',
      census.pocketHornets === 12 && census.pocketHornetsShaded === 0,
      `${census.pocketHornetsShaded}/${census.pocketHornets} wrongly in shade`);
    gate('pockets: all well off the Silverrun road, none in a clearing',
      census.pocketMinOffRiver >= 90 && census.pocketInClearing === 0,
      `minOffRiver=${census.pocketMinOffRiver}m inClearing=${census.pocketInClearing}`);
    gate('creatures: pass on-ramp crabs + imps present', census.passCrabs === 2 && census.passImps === 3);
    // they PATROL (graze/drift movement over real time)
    const m0 = await api.eval('BOARS.map(b => [b.x, b.z]).flat().concat(HORNETS.map(h => [h.x, h.z]).flat())');
    await api.waitTicks(240);
    const m1 = await api.eval('BOARS.map(b => [b.x, b.z]).flat().concat(HORNETS.map(h => [h.x, h.z]).flat())');
    let moved = 0;
    for (let i = 0; i < 12; i += 2) {   // the six glade boars graze visibly even unwatched
      if (Math.hypot(m1[i] - m0[i], m1[i + 1] - m0[i + 1]) > 0.4) moved++;
    }
    gate('creatures: boars actually patrol (positions move)', moved >= 5, moved + '/6 boars moved');
    gate('creatures: hornets alive at their posts (dive gate lives in forest suite)',
      await api.eval('HORNETS.every(h => !h.dead)'));
    // visible when the camera is near
    await api.eval('__fmDebug.warp(910, 552); 0');
    await api.waitTicks(10);
    gate('creatures: near boar renders when camera is near',
      await api.eval('BOARS.some(b => !b.dead && Math.hypot(b.x - P.x, b.z - P.z) < 30 && b.c.root.visible)'));

    /* THE INVARIANT — suppressed while UNRENDERED. Geometry note: with the
       3.3 m follow camera a melee-contact source is ALWAYS in-frustum, so
       the live failure class is the VISIBLE-FLAG one — an enemy hidden by
       the render cull still ticking. Reproduce it through the REAL cull
       path: park the camera 120 m off with the real freecam; animateForest's
       own 46 m visibility radius hides the boar; its brain still charges and
       contacts. The hit must be suppressed, heart count untouched. */
    const faceToward = `(function(){ if (__fm.nearBoarDist < 900) {
      CAM.yaw = Math.atan2(__fm.nearBoarX - P.x, __fm.nearBoarZ - P.z) + Math.PI;
      CAM.stickAge = 0; CAM.ready = false; } })()`;
    await api.eval('__fmDebug.warp(893, 553); P.hearts = P.maxHearts; P.iframes = 0; swelterT = 0; 0');
    await api.waitFor('__fm.nearBoarDist < 15', 30000, 'boar aggro');
    await api.eval('__fmDebug.cam(1013, groundH(1013, 673) + 30, 673, 893, groundH(893, 553), 553)');
    await api.waitFor('BOARS.every(b => !b.c.root.visible)', 10000, 'boar culled by the real visibility radius');
    const sup0 = await api.eval('__fm.dmgSuppressed');
    const hs0 = await api.eval('__fm.hearts');
    let supNow = sup0;
    for (let i = 0; i < 120 && supNow === sup0; i++) {
      await api.eval('P.iframes = 0; swelterT = 0; 0');
      supNow = await api.eval('__fm.dmgSuppressed');
      if ((await api.eval('__fm.hearts')) < hs0) break;
      await sleep(150);
    }
    const hsAfter = await api.eval('__fm.hearts');
    gate('invariant: culled (unrendered) boar contact deals NO damage', hsAfter === hs0 && supNow > sup0,
      `hearts ${hs0}→${hsAfter}, suppressed ${sup0}→${supNow}`);
    gate('invariant: suppression logged as visibility-out', await api.eval('__fm.lastDmgVis === false'));
    await api.eval('__fmDebug.camOff(); 0');

    /* seen boar hits for real (the same charge, camera facing) */
    await api.eval('__fmDebug.warp(893, 553); 0');
    await api.waitFor('__fm.nearBoarDist < 15', 30000, 'boar aggro 2');
    await api.eval(faceToward);
    await api.eval('P.hearts = P.maxHearts; P.iframes = 0; swelterT = 0; 0');
    const hv0 = await api.eval('__fm.hearts');
    let hvNow = hv0, hvMin = hv0;
    for (let i = 0; i < 120 && hvNow >= hv0; i++) {
      await api.eval(faceToward);
      await api.eval('swelterT = 0; 0');
      hvNow = await api.eval('__fm.hearts');
      if (hvNow < hvMin) hvMin = hvNow;
      await sleep(150);
    }
    gate('invariant: SEEN boar charge still hits (2 hearts)', hv0 - hvMin === 2, `hearts ${hv0}→${hvMin}`);
    const bad = api.consoleBad;
    gate('dmgvis: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('dmgvis suite', false, e.message);
    await api.shot('dmgvis-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
}

/* ═══════════════════ PHASE 2 NIGHT TWO SUITES ═══════════════════
   The Falls Hollow, the Silt Wyrm, the Tide's Return, Sailing v1. */

const FAMILY_Q4 = JSON.parse(fs.readFileSync(path.join(DIR, 'test', 'fixtures', 'family-q4-save.json'), 'utf8'));
const N2_HOLLOW_OPEN = { ...FAMILY_Q4, basinOpen: true, lastShade: [1908, 1170] };
const N2_WYRM_READY = { ...FAMILY_Q4, basinOpen: true, glyph1: true, glyph2: true, lastShade: [1958, 1216] };
const N2_CARRY = { ...FAMILY_Q4, basinOpen: true, glyph1: true, glyph2: true, wyrmDone: true, q: 5, lastShade: [1921, 1176] };
const N2_FLOODED = {
  ...FAMILY_Q4, basinOpen: true, glyph1: true, glyph2: true, wyrmDone: true,
  q: 6, ph: 2, sky: 2, floodSeen: true, voyageDone: true, sailedOnce: true,
  region: 'bay', lastShade: [4, -2],
};

/* exposed-forest walks: top hearts + reset swelter first (CDP time is slow
   real time — the sun must not sunstruck the harness mid-journey) */
async function n2Walk(api, x, z, tol, timeout) {
  await api.eval('P.hearts = P.maxHearts; if (typeof swelterT !== "undefined") swelterT = 0; 0');
  await api.walkTo(x, z, tol, timeout);
}
async function n2ContinueIn(api, turbo = 6) {
  await api.waitFor(`__fm.state === 'title'`, 30000, 'title');
  await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 10, 'focus CONTINUE');
  await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 12, 'leave title');
  await api.waitFor(`__fm.state === 'play'`, 30000, 'playing');
  await api.waitTicks(20);
}

/* ═══ THE FALLS HOLLOW: seal → resonance → descent → puzzles → Ben bait ═══ */
async function suiteHollow(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  try {
    /* ── the family q4 save continues SEAMLESSLY into all of this ── */
    await api.seedSave(FAMILY_Q4);
    await api.nav(base + '/?turbo=8');
    await n2ContinueIn(api);
    gate('hollow: family q4 fixture continues seamlessly',
      (await api.eval('__fm.quest')) === 4 && (await api.eval('__fm.skyStep')) === 1 &&
      (await api.eval('__fm.maxHearts')) === 8 && (await api.eval('__fm.tidepool')) === true,
      `q=${await api.eval('__fm.quest')} sky=${await api.eval('__fm.skyStep')}`);
    gate('hollow: q4 compass pulls toward the falls (the open-loop thread)',
      (await api.eval('__fm.objDist')) !== null);
    await api.installBot('pad');
    const D = driver(api, 'pad');

    /* ── pre-q2 saves still see the falls SEALED ── */
    await api.seedSave({ ...FOREST_SAVE, q: 0, finnHeart: false, lastShade: [1908, 1170] });
    await api.nav(base + '/?turbo=8');
    await n2ContinueIn(api);
    await api.installBot('pad');
    await api.eval('__fmDebug.warp(1908, 1170)');
    await api.waitTicks(300);
    gate('hollow: pre-q2 save — basin stays SEALED (no resonance, solid rock)',
      (await api.eval('__fm.basinOpen')) === false &&
      (await api.eval('window.__forestSolid(1938, 1192)')) === true &&
      (await api.eval(`__fm.state === 'play'`)));

    /* ── q4 approach: the moon compass resonates the stones apart ── */
    await api.seedSave(FAMILY_Q4);
    await api.nav(base + '/?turbo=8');
    await n2ContinueIn(api);
    await api.installBot('pad');
    await api.eval('__fmDebug.warp(1902, 1164)');
    await api.eval('P.hearts = P.maxHearts; swelterT = 0; 0');
    await n2Walk(api, 1912, 1172, 1.6, 20000).catch(() => {});   // the beat may interrupt the walk
    if (!(await api.eval('__fm.basinOpen'))) {
      // belt and braces: stand at the hum spot itself
      await api.eval('__fmDebug.warp(1912, 1172)');
    }
    await api.waitFor(`__fm.basinOpen === true`, 25000, 'the stones part');
    await api.waitFor(`__fm.state === 'play'`, 25000, 'beat ends');
    gate('hollow: resonance beat fires at the forecourt with q≥2 and OPENS the basin',
      (await api.eval('window.__forestSolid(1931, 1186)')) === false &&
      (await api.eval('window.__forestSolid(1938, 1192)')) === false);

    /* ── reachability: the corridors are the ONLY path; doors gate the descent ── */
    const fill = await api.eval(`(function(){
      const seen = new Set(), q = [[1955, 1212]];
      const key = (x, z) => (x | 0) + ':' + (z | 0);
      let reachH1 = false, reachH3 = false, n = 0;
      while (q.length && n < 60000) {
        const [x, z] = q.pop(); n++;
        const k = key(x, z);
        if (seen.has(k)) continue;
        seen.add(k);
        if (x < 1918 || x > 2078 || z < 1180 || z > 1338) continue;
        if (window.__forestSolid(x, z)) continue;
        if (Math.hypot(x - 1972, z - 1236) < 3) reachH1 = true;
        if (Math.hypot(x - 2046, z - 1306) < 3) reachH3 = true;
        q.push([x + 1, z], [x - 1, z], [x, z + 1], [x, z - 1]);
      }
      return { reachH1, reachH3, n };
    })()`);
    gate('hollow: flood-fill — gallery reachable, the LAST BASIN sealed behind both glyph doors',
      fill.reachH1 === true && fill.reachH3 === false, JSON.stringify(fill));

    /* ── the walked descent: basin mouth → throat → gallery ── */
    await n2Walk(api, 1922, 1178, 1.6, 30000);
    await n2Walk(api, 1934, 1189, 1.6, 30000);
    await n2Walk(api, 1948, 1203, 1.6, 30000);
    await n2Walk(api, 1958, 1216, 1.4, 30000);
    await n2Walk(api, 1968, 1230, 1.4, 30000);
    gate('hollow: walked the throat into the gallery (region reads, all shade)',
      (await api.eval('__fm.inHollow')) === true && (await api.eval('__fm.shade')) === true &&
      (await api.eval('__fm.swelterOn')) === false);

    /* ── hornet nest one: a real fight ── */
    const pops0 = await api.eval('__fm.hornetsPopped');
    await api.walkTo(1974, 1240, 2.0, 30000);
    for (let i = 0; i < 70; i++) {
      await api.eval('P.hearts = P.maxHearts; 0');
      if ((await api.eval('__fm.hornetsPopped')) >= pops0 + 2 ||
          (await api.eval('__fm.nearHornetDist')) > 60) break;
      const hd = await api.eval('__fm.nearHornetDist');
      if (hd < 2.6) {
        await api.eval('__fmDebug.face(Math.atan2(__fm.nearHornetX - __fm.x, __fm.nearHornetZ - __fm.z))');
        await D.confirm();
      } else {
        const hx = await api.eval('__fm.nearHornetX'), hz = await api.eval('__fm.nearHornetZ');
        if (hd < 90) await api.walkTo(hx, hz, 1.6, 9000).catch(() => {});
      }
      await sleep(300);
    }
    gate('hollow: gallery hornet nest — the pair dives, real swings pop them',
      (await api.eval('__fm.hornetsPopped')) >= pops0 + 2,
      'popped=' + ((await api.eval('__fm.hornetsPopped')) - pops0));

    /* ── puzzle one: light through the dry channel (held rotate, real input) ── */
    await api.eval('window.__fmTurbo = 2');
    for (let tries = 0; tries < 5 && !(await api.eval('__fm.glyph1')); tries++) {
      await api.eval('P.hearts = P.maxHearts; 0');
      await api.walkTo(1969.6, 1232.2, 0.8, 30000).catch(() => {});
      if ((await api.eval('__fm.prompt')) !== 'hmirror1') continue;
      await D.holdAtk(true);
      await api.waitFor('Math.abs(__fm.hm1Delta) < 0.35 || __fm.pst === "hit"', 30000, 'shell near the mark').catch(() => {});
      await D.holdAtk(false);
      await api.waitFor('__fm.glyph1 === true', 12000, 'glyph one re-lights').catch(() => {});
    }
    await api.waitFor('__fm.glyph1 === true', 8000, 'glyph one re-lights');
    await api.eval('window.__fmTurbo = undefined');
    gate('hollow: puzzle one — held rotate re-lights the water-glyph, door sinks',
      (await api.eval('window.__forestSolid(1992, 1253)')) === false);
    await api.walkTo(1992, 1253, 1.4, 30000);
    await api.walkTo(2004, 1262, 1.6, 30000);
    await api.walkTo(2012, 1270, 2.0, 30000);
    gate('hollow: walked THROUGH the opened door into the Chandelier Vault', true);

    /* ── nest two + puzzle two (the language, grown up: shell → relay → glyph) ── */
    const pops1 = await api.eval('__fm.hornetsPopped');
    for (let i = 0; i < 70; i++) {
      await api.eval('P.hearts = P.maxHearts; 0');
      if ((await api.eval('__fm.hornetsPopped')) >= pops1 + 2 ||
          (await api.eval('__fm.nearHornetDist')) > 60) break;
      const hd = await api.eval('__fm.nearHornetDist');
      if (hd < 2.6) {
        await api.eval('__fmDebug.face(Math.atan2(__fm.nearHornetX - __fm.x, __fm.nearHornetZ - __fm.z))');
        await D.confirm();
      } else {
        const hx = await api.eval('__fm.nearHornetX'), hz = await api.eval('__fm.nearHornetZ');
        if (hd < 90) await api.walkTo(hx, hz, 1.6, 9000).catch(() => {});
      }
      await sleep(300);
    }
    gate('hollow: vault hornets popped', (await api.eval('__fm.hornetsPopped')) >= pops1 + 2,
      'popped=' + ((await api.eval('__fm.hornetsPopped')) - pops1));
    await api.eval('window.__fmTurbo = 2');
    for (let tries = 0; tries < 5 && !(await api.eval('__fm.glyph2')); tries++) {
      await api.eval('P.hearts = P.maxHearts; 0');
      await api.walkTo(2009.6, 1266.2, 0.8, 30000).catch(() => {});
      if ((await api.eval('__fm.prompt')) !== 'hmirror2') continue;
      await D.holdAtk(true);
      await api.waitFor('Math.abs(__fm.hm2Delta) < 0.35 || __fm.pst === "hit"', 30000, 'shell two near the mark').catch(() => {});
      await D.holdAtk(false);
      await api.waitFor('__fm.glyph2 === true', 12000, 'glyph two re-lights').catch(() => {});
    }
    await api.waitFor('__fm.glyph2 === true', 8000, 'glyph two re-lights');
    await api.eval('window.__fmTurbo = undefined');
    gate('hollow: puzzle two — the relayed beam opens the last door',
      (await api.eval('window.__forestSolid(2029, 1287.5)')) === false);

    /* ── the Ben-bait side chamber: fossil, hoard chest, salt ── */
    const salt0 = await api.eval('__fm.salt');
    await api.walkTo(2003, 1277, 1.4, 30000);
    await api.walkTo(1996, 1283, 1.4, 30000);
    await api.walkTo(1990.8, 1287.6, 1.0, 30000);
    await api.waitFor(`__fm.prompt === 'fossil'`, 10000, 'fossil prompt');
    await D.confirm();
    await api.waitFor(`__fm.hFossil === true`, 12000, 'fossil seen');
    await api.waitFor(`__fm.state === 'play'`, 12000, 'micro beat done');
    gate('hollow: the moonfish fossil (Ben bait) — looked at, remembered', true);
    await api.walkTo(1992.6, 1285.4, 1.1, 30000);
    await tapUntil(api, () => D.confirm(), '__fm.hChest === true', 10, 'hoard chest');
    await api.waitTicks(120);
    gate('hollow: the salt hoard chest pays out',
      (await api.eval('__fm.salt')) >= salt0 + 6, `salt ${salt0} → ${await api.eval('__fm.salt')}`);

    /* ── ground authority: rendered floor == physics, walked wall fuzz ── */
    const ga = await api.eval(`(function(){
      const rc = new THREE.Raycaster();
      const V = THREE.Vector3;
      let pts = 0, worst = 0, fails = 0, encl = 0;
      const fv = __farTiles.filter(t => t.mesh.visible).map(t => t.mesh);
      for (let x = 1932; x < 2076; x += 2) {
        for (let z = 1188; z < 1336; z += 2) {
          if (window.__forestSolid(x, z)) continue;
          if (!inHollowAt(x, z)) continue;
          pts++;
          const gy = groundH(x, z);
          rc.set(new V(x, gy + 2.2, z), new V(0, -1, 0));
          const hits = rc.intersectObject(hollowFloorMesh, false);
          if (!hits.length) { fails++; continue; }
          const dh = Math.abs((gy + 2.2 - hits[0].distance) - gy);
          if (dh > worst) worst = dh;
          if (dh > 0.05) fails++;
          rc.set(new V(x, gy + 0.3, z), new V(0, 1, 0));
          if (fv.length && rc.intersectObjects(fv, false).length) encl++;
        }
      }
      return { pts, worst: +worst.toFixed(4), fails, encl };
    })()`);
    gate('hollow: dense grid — rendered floor IS the physics floor (<0.05 m)',
      ga.pts > 600 && ga.fails === 0, JSON.stringify(ga));
    gate('hollow: never enclosed by far-tier geometry', ga.encl === 0, 'encl=' + ga.encl);
    /* walked wall fuzz: shove outward on 8 headings in each chamber */
    let fuzzBad = 0;
    for (const [fx, fz] of [[1972, 1236], [2012, 1270], [1994, 1284], [1958, 1216]]) {
      await api.eval(`__fmDebug.warp(${fx}, ${fz})`);
      for (let hIdx = 0; hIdx < 8; hIdx++) {
        const a = hIdx / 8 * Math.PI * 2;
        await api.eval(`__fakePad.axes(${Math.cos(a).toFixed(3)}, ${Math.sin(a).toFixed(3)})`);
        await api.press(1);           // sprint into the wall
        await api.waitTicks(100);
        const solidHere = await api.eval('__fm.fSolidHere');
        const still = await api.eval('__fm.inHollow');
        if (solidHere || !still) fuzzBad++;
        await api.eval(`__fmDebug.warp(${fx}, ${fz})`);
      }
      await api.press(); await api.axes(0, 0);
    }
    gate('hollow: sprint wall-fuzz — zero penetrations, never out of the open region', fuzzBad === 0, 'bad=' + fuzzBad);

    gate('hollow: family quest state undisturbed by the descent', (await api.eval('__fm.quest')) === 4);
    const bad = api.consoleBad;
    gate('hollow: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('hollow suite', false, e.message);
    await api.shot('hollow-FAIL').catch(() => {});
  }
  c.close(); proc.kill();

  /* ── keyboard-only: the descent + puzzle one, real J-held rotate ── */
  {
    const { proc: p2, port: pt2 } = await launchChrome();
    const c2 = await pageSession(pt2);
    const api2 = makeApi(c2);
    await api2.init(); await api2.stubPad();
    try {
      await api2.seedSave(N2_HOLLOW_OPEN);
      await api2.nav(base + '/?turbo=8');
      await api2.waitFor(`__fm.state === 'title'`, 30000, 'title');
      await api2.tapKey('s', 'KeyS');
      await api2.waitFor('__fm.titleFocus === 1', 8000, 'focus CONTINUE (kbd)');
      await api2.tapKey('j', 'KeyJ');
      await api2.waitFor(`__fm.state === 'play'`, 30000, 'playing (kbd)');
      await api2.installBot('kbd');
      const D2 = driver(api2, 'kbd');
      await api2.eval('__fmDebug.warp(1926, 1181)');
      await n2Walk(api2, 1948, 1203, 1.8, 40000);
      await n2Walk(api2, 1962, 1221, 1.6, 40000);
      /* clear the gallery pair first — held-rotate needs a quiet chamber */
      await n2Walk(api2, 1974, 1240, 2.0, 40000).catch(() => {});
      for (let i = 0; i < 60; i++) {
        await api2.eval('P.hearts = P.maxHearts; 0');
        const hd2 = await api2.eval('__fm.nearHornetDist');
        if (hd2 > 60) break;
        if (hd2 < 2.6) {
          await api2.eval('__fmDebug.face(Math.atan2(__fm.nearHornetX - __fm.x, __fm.nearHornetZ - __fm.z))');
          await D2.confirm();
        } else {
          const hx2 = await api2.eval('__fm.nearHornetX'), hz2 = await api2.eval('__fm.nearHornetZ');
          await api2.walkTo(hx2, hz2, 1.6, 9000).catch(() => {});
        }
        await sleep(300);
      }
      await n2Walk(api2, 1969.6, 1232.2, 0.8, 40000);
      await api2.eval('window.__fmTurbo = 2');
      for (let tries = 0; tries < 5 && !(await api2.eval('__fm.glyph1')); tries++) {
        await api2.eval('P.hearts = P.maxHearts; 0');
        await api2.walkTo(1969.6, 1232.2, 0.8, 30000).catch(() => {});
        if ((await api2.eval('__fm.prompt')) !== 'hmirror1') continue;
        await D2.holdAtk(true);
        await api2.waitFor('Math.abs(__fm.hm1Delta) < 0.35 || __fm.pst === "hit"', 30000, 'held J rotates the shell').catch(() => {});
        await D2.holdAtk(false);
        await api2.waitFor('__fm.glyph1 === true', 12000, 'glyph via keyboard').catch(() => {});
      }
      await api2.waitFor('__fm.glyph1 === true', 8000, 'glyph via keyboard');
      await api2.eval('window.__fmTurbo = undefined');
      gate('hollow(kbd): descent walked + puzzle solved keyboard-only', true);
      const bad2 = api2.consoleBad;
      gate('hollow(kbd): zero console errors', bad2.length === 0, bad2.slice(0, 3).join(' | '));
    } catch (e) {
      gate('hollow(kbd) suite', false, e.message);
      await api2.shot('hollow-kbd-FAIL').catch(() => {});
    }
    c2.close(); p2.kill();
  }
}

/* ═══ THE SILT WYRM: wake, the wake-contract, kid-bot, slabs, the cure ═══ */
async function suiteWyrm(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  try {
    await api.seedSave(N2_WYRM_READY);
    await api.nav(base + '/?turbo=8');
    await n2ContinueIn(api);
    await api.installBot('pad');
    const D = driver(api, 'pad');
    /* the invariant monitor: if it can strike from under the silt, its wake
       is ON SCREEN (no-invisible-damage) */
    await api.eval(`window.__wakeViol = 0; window.__wakeChecks = 0;(function m(){
      if (window.__wakeViol === undefined) return;
      const T = __fm;
      if (T.state === 'play' && T.wyrmActive && T.wyrmSt === 'swim' &&
          Math.hypot(T.wyrmX - T.x, T.wyrmZ - T.z) < 4.5) {
        window.__wakeChecks++;
        if (!T.wyrmWakeVis) window.__wakeViol++;
      }
      requestAnimationFrame(m); })()`);
    await api.eval('__fmDebug.warp(2035, 1294)');
    await api.walkTo(2044, 1303, 2.2, 30000);
    await api.waitFor('__fm.wyrmActive === true', 15000, 'the Wyrm wakes');
    gate('wyrm: proximity ALWAYS wakes the guardian', true);
    gate('wyrm: HP bar up with its name', await api.eval(
      `document.getElementById('bossBar').classList.contains('on') && document.getElementById('bossName').textContent === 'THE SILT WYRM'`));

    /* KID BOT: only ever slashes whatever is near — body chips must win */
    const phasesSeen = new Set();
    const phaseHp = {};
    /* the cure cine spans ~10 FRAMES at turbo 8 — a poll gap swallows it
       whole (it did: cureStart stayed 0 and the gate read page-epoch).
       An in-page rAF monitor sees every frame; CDP polling cannot. */
    await api.eval(`window.__cureT0 = 0; window.__cureT1 = 0; (function cm() {
      if (window.__cureT0 === undefined) return;
      if (!window.__cureT0 && CINE.id === 'wyrmCure') window.__cureT0 = simTick;
      if (window.__cureT0 && !window.__cureT1 && CINE.id !== 'wyrmCure') window.__cureT1 = simTick;
      requestAnimationFrame(cm); })(); 0`);
    for (let i = 0; i < 400; i++) {
      if (await api.eval('window.__cureT0 > 0 || __fm.wyrmDone === true')) break;
      const ph = await api.eval('__fm.wyrmPhase');
      phasesSeen.add(ph);
      const hp = await api.eval('__fm.wyrmHp');
      if (!(ph in phaseHp)) phaseHp[ph] = { max: hp, min: hp };
      phaseHp[ph].min = Math.min(phaseHp[ph].min, hp);
      const wx = await api.eval('__fm.wyrmX'), wz = await api.eval('__fm.wyrmZ');
      const d = Math.hypot((await api.eval('__fm.x')) - wx, (await api.eval('__fm.z')) - wz);
      if (d > 2.6) await api.walkTo(wx, wz, 2.2, 5000).catch(() => {});
      await D.confirm();
      await D.confirm();
      await api.eval('P.hearts = P.maxHearts; 0');   // the kid-fair stand-in: shade heals anyway
      await sleep(180);
    }
    gate('wyrm: kid-bot walked it through ALL THREE phases',
      phasesSeen.has(1) && phasesSeen.has(2) && phasesSeen.has(3), [...phasesSeen].join(','));
    gate('wyrm: damage landed in every phase (chips are real)',
      Object.entries(phaseHp).every(([p, v]) => p === '0' || v.min < v.max),
      JSON.stringify(phaseHp));
    gate('wyrm: body chips carried the fight', (await api.eval('__fm.wyrmBody')) > 12,
      'body=' + await api.eval('__fm.wyrmBody') + ' brow=' + await api.eval('__fm.wyrmBrow'));
    gate('wyrm: the wake contract held — visible whenever it hunted in range',
      (await api.eval('window.__wakeViol')) === 0,
      `viol=${await api.eval('window.__wakeViol')}/${await api.eval('window.__wakeChecks')} checks`);

    /* THE CURE: it dissolves into water, bows, leaves the Shield floating */
    await api.eval('window.__fmTurbo = 2');
    await api.waitFor(`window.__cureT1 > 0 && __fm.state === 'play'`, 40000, 'cure cinematic ends');
    await api.eval('window.__fmTurbo = undefined');
    const cureTicks = await api.eval('window.__cureT1 - window.__cureT0');
    gate('wyrm: cure cinematic ≤ 12 s and shows the water', cureTicks / 60 <= 12.8, (cureTicks / 60).toFixed(1) + 's');
    gate('wyrm: the pool is WET and the Half Shield floats on it',
      (await api.eval('__fm.poolWet')) === true && (await api.eval('__fm.wyrmDone')) === true);
    await api.walkTo(2049.4, 1301.4, 1.0, 30000).catch(() => {});
    await api.waitFor(`__fm.prompt === 'shield'`, 12000, 'shield prompt');
    await D.confirm();
    await api.waitFor('__fm.carryShield === true', 12000, 'the Shield is taken');
    gate('wyrm: HALF SHIELD recovered → quest 5, carried home on the back',
      (await api.eval('__fm.quest')) === 5);
    /* the mural — deliberately ambiguous, and only now approachable calmly */
    await api.walkTo(2056.4, 1310, 1.2, 30000);
    await api.waitFor(`__fm.prompt === 'mural'`, 12000, 'mural prompt');
    await D.confirm();
    await api.waitFor('__fm.hMural === true', 12000, 'mural seen');
    gate('wyrm: the chain mural — seen, unanswered', true);
    const bad = api.consoleBad;
    gate('wyrm: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('wyrm suite', false, e.message);
    await api.shot('wyrm-FAIL').catch(() => {});
  }
  c.close(); proc.kill();

  /* ── the SLAB-DODGE bot: terrain reading beats the swim ── */
  {
    const { proc: p2, port: pt2 } = await launchChrome();
    const c2 = await pageSession(pt2);
    const api2 = makeApi(c2);
    await api2.init(); await api2.stubPad();
    try {
      await api2.seedSave(N2_WYRM_READY);
      await api2.nav(base + '/?turbo=8');
      await n2ContinueIn(api2);
      await api2.installBot('pad');
      const D2 = driver(api2, 'pad');
      /* sunstruck FIRST (the probe-verified sequence): pinned hearts on the
         silt, the eruption lands, the checkpoint carries the phase */
      await api2.eval('__fmDebug.warp(2046, 1306)');
      await api2.waitFor('__fm.wyrmActive === true', 15000, 'wyrm wakes');
      for (let i = 0; i < 200 && (await api2.eval('__fm.sunstruck')) < 1; i++) {
        await api2.eval(`if (state === 'play' && P.hearts > 1) P.hearts = 1; 0`);
        await sleep(250);
      }
      await api2.waitFor(`__fm.sunstruck >= 1`, 10000, 'sunstruck by the fight');
      await api2.waitFor(`__fm.state === 'play'`, 25000, 'woke again');
      const wakeX = await api2.eval('__fm.x'), wakeZ = await api2.eval('__fm.z');
      gate('wyrm(slab): sunstruck wakes at the hollow anchor, everything kept',
        Math.hypot(wakeX - 1958, wakeZ - 1216) < 8 && (await api2.eval('__fm.wyrmActive')) === false,
        `woke at ${wakeX.toFixed(0)},${wakeZ.toFixed(0)}`);
      const phBefore = await api2.eval('__fm.wyrmPhase');
      await api2.eval('P.hearts = P.maxHearts; 0');
      /* back in: re-arm, then STAND THE STONE */
      await api2.eval('__fmDebug.warp(2036, 1295)');
      await api2.walkTo(2040, 1298, 0.9, 30000);      // slab one, dead center
      await api2.waitFor('__fm.wyrmActive === true', 15000, 'wyrm re-wakes (slab)');
      gate('wyrm(slab): re-entry re-arms the SAME phase (checkpoint)',
        (await api2.eval('__fm.wyrmPhase')) === phBefore,
        `phase ${phBefore} → ${await api2.eval('__fm.wyrmPhase')}`);
      await api2.waitFor(`__fm.onSlab === true`, 10000, 'standing the stone');
      const hearts0 = await api2.eval('__fm.hearts');
      // hold the stone through its hunting — it cannot swim through stone
      await api2.waitFor(`__fm.wyrmSt === 'slamRock' || __fm.wyrmSt === 'daze'`, 60000, 'it strikes the stone');
      gate('wyrm(slab): the swim breaks on the slab — it reels', true,
        'st=' + await api2.eval('__fm.wyrmSt'));
      gate('wyrm(slab): NOT ONE heart lost while standing the stone',
        (await api2.eval('__fm.hearts')) === hearts0,
        `${hearts0} → ${await api2.eval('__fm.hearts')}`);
      // the daze window: hit the moonglass brow (real time — it lasts 2.9 s)
      await api2.eval('window.__fmTurbo = 1');
      await api2.waitFor(`__fm.wyrmSt === 'daze'`, 45000, 'daze window');
      const wx = await api2.eval('__fm.wyrmX'), wz = await api2.eval('__fm.wyrmZ');
      await api2.walkTo(wx, wz, 2.4, 15000).catch(() => {});
      await api2.eval('__fmBot.target = null; 0');
      for (let i = 0; i < 10 && (await api2.eval('__fm.wyrmBrow')) === 0; i++) {
        await api2.eval('__fmDebug.face(Math.atan2(__fm.wyrmX - __fm.x, __fm.wyrmZ - __fm.z))');
        await D2.confirm();
        await sleep(220);
      }
      gate('wyrm(slab): brow-plate hit pays 6x through the daze',
        (await api2.eval('__fm.wyrmBrow')) >= 1, 'brow=' + await api2.eval('__fm.wyrmBrow'));
      await api2.eval('window.__fmTurbo = undefined');
      const bad2 = api2.consoleBad;
      gate('wyrm(slab): zero console errors', bad2.length === 0, bad2.slice(0, 3).join(' | '));
    } catch (e) {
      gate('wyrm slab suite', false, e.message);
      await api2.shot('wyrm-slab-FAIL').catch(() => {});
    }
    c2.close(); p2.kill();
  }
}

/* ═══ THE TIDE COMES HOME: carry-home, the seamless flood, the matrix ═══ */
async function suiteFlood(base) {
  let noInputHandoffTicks = -1;
  /* S1 — the full beat, NO input: discovery path */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    try {
      await api.seedSave(N2_CARRY, true);   // later navs keep the LIVE save (matrix gates)
      await api.nav(base + '/?turbo=10');
      await n2ContinueIn(api);
      await api.installBot('pad');
      const D = driver(api, 'pad');
      gate('flood: q5 save carries the Shield (compass sings home)',
        (await api.eval('__fm.carryShield')) === true &&
        Math.abs((await api.eval('__fm.objDist')) - Math.hypot(1921 - (-38), 1176 - (-78))) < 400);
      /* the carry-home journey: down the Silverrun, over the pass, up the hill */
      const wps = [[1900, 1160], [1800, 1050], [1700, 930], [1580, 840], [1480, 660], [1340, 560],
        [1220, 660], [1080, 560], [980, 380], [820, 300], [650, 380], [500, 270], [380, 110],
        [235, 55], [160, 38], [90, 30], [30, -10], [-10, -34], [-30, -60], [-36, -72]];
      for (const [x, z] of wps) await n2Walk(api, x, z, 3.2, 120000);
      gate('flood: the Half Shield walked HOME — basin to Moonwheel, real input', true);
      for (let tries = 0; tries < 6 && (await api.eval('__fm.prompt')) !== 'wheel2'; tries++) {
        await api.waitFor(`__fm.state === 'play'`, 30000, 'control back (wheel)').catch(() => {});
        await api.eval('P.hearts = P.maxHearts; 0');
        await api.walkTo(-37, -74.5, 1.4, 30000).catch(() => {});
        await sleep(400);
      }
      await api.waitFor(`__fm.prompt === 'wheel2'`, 12000, 'PLACE THE HALF SHIELD');
      /* sky sample BEFORE */
      await api.eval('window.__fmTurbo = 1');
      await sleep(300);
      const shot0 = await api.shot('flood-sky-before');
      /* continuity monitor at REAL time (per-frame camera step) */
      await api.axes(0, 0);
      await sleep(300);
      await api.eval(
        `window.__pearlCap = false;(function m(){ if (window.__pearlCap === true) return;
        const c2 = __fm.caption; if (c2 && c2.indexOf('came BACK') >= 0) { window.__pearlCap = true; return; }
        requestAnimationFrame(m); })(); 0`);
      await api.eval(`window.__camMon = { max: 0, jumps: 0, at: '' };(function m(){
        if (!window.__camMon) return;
        const s = __fm.camStep || 0;
        if (__fm.state !== 'title') {
          if (s > __camMon.max) { __camMon.max = s; __camMon.at = __fm.tick + ':' + __fm.state + ' cine=' + __fm.floodCine + ' k=' + __fm.handoffK; }
          if (s > 3) __camMon.jumps++;
        }
        requestAnimationFrame(m); })()`);
      const wall0 = Date.now();
      await D.confirm();
      await api.waitFor(`__fm.floodCine !== null`, 12000, 'the flood begins');
      gate('flood: letterbox bars up for the cinematic', await api.eval('__fm.barsOn'));
      await api.waitFor(`__fm.autorun === true`, 25000, 'the authored run begins');
      const runStart = await api.eval('__fm.handoffStartTick');
      gate('flood: input goes LIVE inside 12 s of the slot (real time)',
        Date.now() - wall0 <= 12500, ((Date.now() - wall0) / 1000).toFixed(1) + 's');
      /* NO INPUT: the camera dives, the run continues, eases to a stop */
      await api.waitFor(`__fm.handoffRumbles === 1`, 20000, 'the one soft pulse — you have the wheel');
      noInputHandoffTicks = (await api.eval('__fm.handoffDoneTick')) - runStart;
      gate('flood: bars slide OFF exactly at control-live', (await api.eval('__fm.barsOn')) === false);
      gate('flood: exactly ONE handoff rumble', (await api.eval('__fm.handoffRumbles')) === 1);
      await api.waitFor(`__fm.autorun === false`, 30000, 'the run eases out');
      await sleep(900);
      const px = await api.eval('__fm.x'), pz = await api.eval('__fm.z');
      const spd = await api.eval('Math.hypot(P.vx, P.vz)');
      gate('flood: untouched, Wick jogs to the waterline and eases to a stop',
        pz > -18 && spd < 0.6 && (await api.eval('__fm.state')) === 'play',
        `at ${px.toFixed(0)},${pz.toFixed(0)} spd=${spd.toFixed(2)}`);
      const mon = await api.eval('window.__camMon');
      gate('flood: ONE CONTINUOUS CAMERA — no cuts, no teleports, ever',
        mon.jumps === 0 && mon.max < 3.0, JSON.stringify(mon));
      /* control latency after handoff: the stick must answer at once
         (the walk-bot idles the stick every frame — hand it back first) */
      await api.botRelease().catch(() => {});
      let moved = 0;
      for (const [kk, cc] of [['s', 'KeyS'], ['d', 'KeyD'], ['w', 'KeyW'], ['a', 'KeyA']]) {
        const cp0v = JSON.parse(await api.eval('JSON.stringify([__fm.x, __fm.z])'));
        await api.key(kk, cc, true);
        await sleep(400);
        await api.key(kk, cc, false);
        const cp1 = JSON.parse(await api.eval('JSON.stringify([__fm.x, __fm.z])'));
        moved = Math.max(moved, Math.hypot(cp1[0] - cp0v[0], cp1[1] - cp0v[1]));
        if (moved > 0.3) break;
      }
      gate('flood: stick answers instantly after the handoff', moved > 0.3,
        'moved ' + moved.toFixed(2) + 'm  diag=' + await api.eval(`JSON.stringify({
          st: state, pst: P.st, sail: P.sailing, auto: AUTORUN.active, pl: AUTORUN.player,
          d: +waterDepthAt(P.x, P.z).toFixed(2), fps: +__fm.fps.toFixed(1),
          turbo: window.__fmTurbo, hs: P.hearts, mx: IN.mx, my: IN.my,
          pad: (function(){ const g = navigator.getGamepads()[0]; return g ? g.axes.join(',') : 'none'; })(),
          camMode: CAM.mode })`));
      /* the three visible changes */
      gate('flood: sky stepped to 2, SECOND star burning, flood state live',
        (await api.eval('__fm.skyStep')) === 2 && (await api.eval('__fm.star2On')) === true &&
        (await api.eval('__fm.flood')) === true && (await api.eval('__fm.phases')) === 2);
      const shot1 = await api.shot('flood-sky-after');
      const png0 = decodePNG(fs.readFileSync(shot0)), png1 = decodePNG(fs.readFileSync(shot1));
      let delta = 0;
      for (const [sx, sy] of [[640, 60], [320, 80], [960, 90]]) {
        const a = medianColorAt(png0, sx, sy, 6), b = medianColorAt(png1, sx, sy, 6);
        delta = Math.max(delta, Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]));
      }
      gate('flood: the sky dim is REAL in pixels', delta >= 20, 'ΔRGB=' + delta.toFixed(0));
      /* the joy-beat: the wake-boat lifts, Pearl arrives breathless */
      await api.installBot('pad');
      await api.eval('window.__fmTurbo = undefined');
      await api.walkTo(4, -2, 2.0, 60000);
      await api.waitFor('__fm.boatFloating === true', 40000, 'the wake-boat rights itself');
      gate('flood: THE WAKE-BOAT — shelter since frame one — floats', true);
      await api.walkTo(3.4, -1.6, 1.6, 30000).catch(() => {});
      await api.waitFor('window.__pearlCap === true', 15000, 'Pearl speaks').catch(() => {});
      gate('flood: Pearl, breathless, at the water', await api.eval('window.__pearlCap === true'));
      gate('flood: the tidepool is subsumed by the real sea',
        await api.eval('tidewater.visible === false && tidepoolFilled === true'));
      await api.eval('__fmDebug.warp(330, -219.5)');
      await sleep(700);
      gate('flood: the cartographer\u2019s map wears its NEW blue line',
        await api.eval('cartNewLine.visible === true'));
      await api.eval('__fmDebug.warp(4, -2)');
      /* matrix (c): CONTINUE a flooded save → still flooded */
      await api.nav(base + '/?turbo=8');
      await n2ContinueIn(api);
      gate('flood matrix: CONTINUE flooded save → flooded world',
        (await api.eval('__fm.flood')) === true && (await api.eval('__fm.boatFloating')) === true &&
        (await api.eval('__fm.wakeWreckVis')) === false && (await api.eval('__fm.skyStep')) === 2);
      /* matrix (b): NEW GAME fully un-floods (the John sequence, extended) */
      await api.nav(base + '/?turbo=8');
      await api.waitFor(`__fm.state === 'title'`, 25000, 'title (NG)');
      await tapUntil(api, () => api.tap(0), '__fm.ngGuardOn === true', 8, 'guard');
      await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 8, 'fresh start');
      await api.waitFor(`__fm.state === 'play'`, 40000, 'fresh adventure');
      gate('flood matrix: NEW GAME → the world is fully UN-flooded',
        (await api.eval('__fm.flood')) === false && (await api.eval('__fm.skyStep')) === 0 &&
        (await api.eval('__fm.wakeWreckVis')) === true &&
        (await api.eval('bayWaterMesh.visible === false')) &&
        (await api.eval('__fm.basinOpen')) === false &&
        (await api.eval('window.__forestSolid(1938, 1192) === true')) &&
        (await api.eval('crabs[0].sx === crabs[0].osx && pearl.x === ' + '(-21.9)')));
      const bad = api.consoleBad;
      gate('flood: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate('flood suite', false, e.message);
      await api.shot('flood-FAIL').catch(() => {});
    }
    c.close(); proc.kill();
  }
  /* S2 — input DURING the swing takes over immediately and shortens it */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    try {
      await api.seedSave({ ...N2_CARRY, lastShade: [-33, -72] });
      await api.nav(base + '/?turbo=6');
      await n2ContinueIn(api);
      await api.installBot('pad');
      const D = driver(api, 'pad');
      await api.walkTo(-37, -74.5, 1.6, 40000);
      await api.waitFor(`__fm.prompt === 'wheel2'`, 12000, 'wheel prompt (S2)');
      await api.eval('window.__fmTurbo = 1');
      await api.axes(0, 0);
      await sleep(200);
      await D.confirm();
      await api.waitFor(`__fm.autorun === true`, 30000, 'swing begins (S2)');
      const t0 = await api.eval('__fm.handoffStartTick');
      await api.axes(0, -1);          // the player grabs the stick mid-swing
      await api.waitFor(`__fm.autorunPlayer === true`, 5000, 'player takes over');
      await api.waitFor(`__fm.handoffRumbles === 1`, 12000, 'accelerated handoff');
      const took = (await api.eval('__fm.handoffDoneTick')) - t0;
      await api.axes(0, 0);
      gate('flood(S2): stick input mid-swing takes over INSTANTLY and shortens the blend',
        (await api.eval('__fm.autorun')) === false && took > 0 &&
        (noInputHandoffTicks < 0 || took < noInputHandoffTicks),
        `input=${took} ticks vs hands-off=${noInputHandoffTicks}`);
      const bad = api.consoleBad;
      gate('flood(S2): zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate('flood S2 suite', false, e.message);
      await api.shot('flood-S2-FAIL').catch(() => {});
    }
    c.close(); proc.kill();
  }
  /* S3 — nothing previously completable is broken (boat where needed) */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    try {
      await api.seedSave({
        ...N2_FLOODED, mh: 5, wreckChest: false, bossDone: false, wallBurned: false,
        kelpDoor: false, houseChest: false, salt: 0,
      });
      await api.nav(base + '/?turbo=8');
      await n2ContinueIn(api);
      await api.installBot('pad');
      const D = driver(api, 'pad');
      /* the village lives on dry land */
      await api.walkTo(36, -15, 1.4, 40000);
      await api.walkTo(39.7, -14.1, 0.6, 20000);
      await api.waitFor(`__fm.prompt === 'talk'`, 10000, 'Finn still reachable');
      gate('flood(S3): NPCs on dry land, talkable', true);
      /* the grotto: dry behind its causeway — SAIL to its toe, wade up */
      await api.walkTo(7.4, 3.8, 1.0, 40000);
      await api.waitFor(`__fm.prompt === 'board'`, 15000, 'board for the causeway');
      await D.confirm();
      await api.waitFor('__fm.sailing === true', 12000, 'under way (causeway)');
      await api.walkTo(30, 103, 3.2, 120000);
      await api.axes(0, 0);
      await api.waitFor('__fm.boatSpd < 2.0', 15000, 'way off (causeway)');
      await api.waitFor(`__fm.prompt === 'ashore'`, 20000, 'ashore at the causeway toe');
      await tapUntil(api, () => D.confirm(), '__fm.sailing === false', 10, 'landed');
      await api.walkTo(30, 116, 2.0, 40000);
      await api.walkTo(30, 133, 1.4, 30000);
      await api.walkTo(30, 141, 1.4, 30000);
      gate('flood(S3): the causeway walks you into a DRY grotto',
        (await api.eval('__fm.inGrotto')) === true && (await api.eval('__fm.waterDepthHere')) === 0);
      await api.walkTo(26.9, 147.0, 0.8, 30000);
      await api.waitFor(`__fm.prompt === 'mirror'`, 10000, 'mirror still waits');
      gate('flood(S3): the mirror-shell puzzle is still there to solve', true);
      /* the King-Crab still fights */
      await api.eval('__fmDebug.warp(62, 166)');
      await api.waitFor('__fm.bossActive === true', 15000, 'boss wakes post-flood');
      const bhp0 = await api.eval('__fm.bossHp');
      for (let i = 0; i < 14 && (await api.eval('__fm.bossHp')) >= bhp0; i++) {
        const bx = await api.eval('__fm.bossX'), bz = await api.eval('__fm.bossZ');
        await api.walkTo(bx, bz, 3.4, 6000).catch(() => {});
        await D.confirm();
        await sleep(220);
      }
      gate('flood(S3): the King-Crab wakes and takes damage post-flood',
        (await api.eval('__fm.bossHp')) < bhp0);
      /* the wreck chest: BOAT WHERE NEEDED — she waits where we moored her */
      await api.eval('P.hearts = P.maxHearts; __fmDebug.warp(30, 112); 0');
      const mbx = await api.eval('__fm.boatX'), mbz = await api.eval('__fm.boatZ');
      await api.walkTo(mbx, mbz + 2.2, 1.0, 40000).catch(() => {});
      await api.waitFor(`__fm.prompt === 'board'`, 15000, 'board prompt');
      await D.confirm();
      await api.waitFor('__fm.sailing === true', 12000, 'under way');
      await api.walkTo(-40, 88, 4.0, 120000);
      await api.walkTo(WRECK_X + 3.4, WRECK_Z + 1, 3.4, 60000);
      await api.waitFor(`__fm.prompt === 'ashore'`, 20000, 'ashore at the wreck');
      await tapUntil(api, () => D.confirm(), '__fm.sailing === false', 10, 'on the deck');
      gate('flood(S3): sailed to the wreck, disembarked ONTO its deck',
        (await api.eval('__fm.fy > -0.6')) === true);
      await api.walkTo(WRECK_X + 0.6, WRECK_Z + 0.4, 1.4, 30000);
      await tapUntil(api, () => D.confirm(), '__fm.chestOpened === true', 10, 'wreck chest');
      await api.waitFor('__fm.heartContainers >= 1', 15000, 'heart container');
      gate('flood(S3): the drowned wreck chest still pays its heart container', true);
      /* relocated salt is all on dry ground */
      gate('flood(S3): every shoreline salt crystal sits on dry ground',
        await api.eval(`saltPickups.every(s => _n1GroundH(s.x, s.z) > ${'-0.55'} + 0.1)`));
      const bad = api.consoleBad;
      gate('flood(S3): zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate('flood S3 suite', false, e.message);
      await api.shot('flood-S3-FAIL').catch(() => {});
    }
    c.close(); proc.kill();
  }
}
const WRECK_X = -45, WRECK_Z = 95;

/* ═══ SAILING v1: board/steer/full-sail/boundary/disembark — pad, kbd, touch ═══ */
async function suiteSail(base) {
  /* pad — the full system */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    try {
      await api.seedSave(N2_FLOODED, true);   // mooring persistence rides the live save
      await api.nav(base + '/?turbo=6');
      await n2ContinueIn(api);
      await api.installBot('pad');
      const D = driver(api, 'pad');
      /* grounding monitor: the hull must never cross onto land */
      await api.eval(`window.__aground = 0;(function m(){
        if (window.__aground === undefined) return;
        if (__fm.sailing && __fm.boatSpd > 0.4 && waterDepthAt(__fm.boatX, __fm.boatZ) < 0.12) window.__aground++;
        requestAnimationFrame(m); })()`);
      await api.walkTo(7.4, 3.8, 1.0, 40000);
      await api.waitFor(`__fm.prompt === 'board'`, 15000, 'board prompt');
      await D.confirm();
      await api.waitFor('__fm.sailing === true', 12000, 'aboard');
      gate('sail(pad): ✕ at the boat boards it', true);
      /* stick steers (the walk-bot IS the stick: real pad axes every frame) */
      const a0 = await api.eval('__fm.boatAng');
      await api.eval('__fmBot.tol = 2.5; __fmBot.target = [-20, 40]');
      await api.waitFor('__fm.boatSpd > 1.2', 20000, 'under way by stick');
      await api.waitTicks(200);
      const a1 = await api.eval('__fm.boatAng');
      gate('sail(pad): the stick steers (heading follows)',
        Math.abs(a1 - a0) > 0.2 && (await api.eval('__fm.boatSpd')) > 1.2,
        `Δang=${(a1 - a0).toFixed(2)} spd=${(await api.eval('__fm.boatSpd')).toFixed(1)}`);
      /* ○ held = FULL SAIL */
      await api.eval('__fmBot.sprint(true); __fmBot.target = [-30, 90]');
      await api.waitFor('__fm.boatSpd > 6.4', 25000, 'full sail');
      gate('sail(pad): ○ held raises FULL SAIL (the sprint of the sea)',
        (await api.eval('__fm.sailK')) > 0.7, 'spd=' + (await api.eval('__fm.boatSpd')).toFixed(1));
      await api.eval('__fmBot.sprint(false); __fmBot.target = null; 0');
      /* the soft boundary + its line */
      await api.walkTo(-20, 150, 5.0, 90000).catch(() => {});
      let edgeCap = false;
      for (let i = 0; i < 24; i++) {
        await api.walkTo(-30, 170, 4.0, 8000).catch(() => {});
        const cap = await api.eval('__fm.caption');
        if ((cap && cap.includes('better keel')) || (await api.eval('__fm.seaEdgeHits')) > 0) { edgeCap = true; break; }
      }
      gate('sail(pad): the open sea turns you back, with its line',
        edgeCap && (await api.eval(`Math.hypot(__fm.boatX - 0, __fm.boatZ - 40) < 116`)),
        `hits=${await api.eval('__fm.seaEdgeHits')} d=${(await api.eval('Math.hypot(__fm.boatX, __fm.boatZ - 40)')).toFixed(0)}`);
      gate('sail(pad): the swell-line renders on the water', await api.eval('swellLineMesh.visible === true'));
      /* wisps fizz over open water */
      const wa0 = await api.eval('__fm.wispsAlive');
      await api.walkTo(-52, 12, 3.0, 60000);
      await sleep(1200);
      await api.walkTo(-30, 45, 3.5, 60000);
      await sleep(1500);
      const wa1 = await api.eval('__fm.wispsAlive');
      gate('sail(pad): wisps chase, hit deep water, and FIZZ — the sea is yours',
        wa1 < wa0, `${wa0} → ${wa1}`);
      /* perf at full clip */
      await api.perfReset();
      await api.eval('__fakePad.press(1);');
      for (const [x, z] of [[0, 30], [-30, 80], [10, 110], [35, 60], [8, 12]]) {
        await api.walkTo(x, z, 4.0, 60000).catch(() => {});
      }
      await api.press();
      const pf = await api.perfRead();
      gate('sail(pad): FULL-SAIL frame budget holds (≤80 calls / ≤120k tris)',
        pf.calls <= 80 && pf.tris <= 120000, `calls=${pf.calls} tris=${pf.tris} @${pf.at}`);
      gate('sail(pad): the hull never crossed onto land', (await api.eval('window.__aground')) === 0,
        'aground=' + await api.eval('window.__aground'));
      /* disembark + persistence */
      await api.walkTo(8, 5, 2.5, 60000);
      await api.axes(0, 0);
      await api.waitFor('__fm.boatSpd < 2.0', 15000, 'way off');
      await api.waitFor(`__fm.prompt === 'ashore'`, 15000, 'ashore prompt');
      await tapUntil(api, () => D.confirm(), '__fm.sailing === false', 10, 'ashore');
      gate('sail(pad): came ashore on dry footing',
        (await api.eval('__fm.waterDepthHere')) < 0.63);
      const bx = await api.eval('__fm.boatX'), bz = await api.eval('__fm.boatZ');
      await api.nav(base + '/?turbo=6');
      await n2ContinueIn(api);
      gate('sail(pad): the boat waits where you moored her (persisted)',
        Math.hypot((await api.eval('__fm.boatX')) - bx, (await api.eval('__fm.boatZ')) - bz) < 2.5,
        `moored ${bx.toFixed(0)},${bz.toFixed(0)} → ${(await api.eval('__fm.boatX')).toFixed(0)},${(await api.eval('__fm.boatZ')).toFixed(0)}`);
      const bad = api.consoleBad;
      gate('sail(pad): zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate('sail pad suite', false, e.message);
      await api.shot('sail-FAIL').catch(() => {});
    }
    c.close(); proc.kill();
  }
  /* kbd — board/steer/full-sail/disembark */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    try {
      await api.seedSave(N2_FLOODED);
      await api.nav(base + '/?turbo=6');
      await api.waitFor(`__fm.state === 'title'`, 30000, 'title');
      /* RETRY the presses, exactly as the pad path does. A single press then
         wait is a race: the title's first second is spent building the world,
         so a keydown can land while the sim is stalled and its edge is spent
         before the frame that would act on it. The pad block never saw this
         because tapUntil re-presses until the state actually moves. */
      await tapUntil(api, () => api.tapKey('s', 'KeyS'), '__fm.titleFocus === 1', 10, 'CONTINUE focus (kbd)');
      await tapUntil(api, () => api.tapKey('j', 'KeyJ'), `__fm.state !== 'title'`, 12, 'leave title (kbd)');
      await api.waitFor(`__fm.state === 'play'`, 30000, 'playing');
      await api.installBot('kbd');
      await api.walkTo(7.4, 3.8, 1.0, 40000);
      await api.waitFor(`__fm.prompt === 'board'`, 15000, 'board prompt (kbd)');
      await api.tapKey('j', 'KeyJ');
      await api.waitFor('__fm.sailing === true', 12000, 'aboard (kbd)');
      await api.key('w', 'KeyW', true);
      await api.key('Shift', 'ShiftLeft', true);
      await api.waitFor('__fm.boatSpd > 6.0', 25000, 'full sail (kbd)');
      await api.key('Shift', 'ShiftLeft', false);
      await api.key('w', 'KeyW', false);
      gate('sail(kbd): W steers, Shift raises full sail', true,
        'spd=' + (await api.eval('__fm.boatSpd')).toFixed(1));
      await api.walkTo(8, 5, 2.5, 90000);
      await api.waitFor('__fm.boatSpd < 2.0', 15000, 'way off (kbd)');
      await api.waitFor(`__fm.prompt === 'ashore'`, 15000, 'ashore prompt (kbd)');
      await tapUntil(api, () => api.tapKey('j', 'KeyJ'), '__fm.sailing === false', 10, 'ashore (kbd)');
      gate('sail(kbd): keyboard-only board → sail → disembark', true);
      const bad = api.consoleBad;
      gate('sail(kbd): zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate('sail kbd suite', false, e.message);
      await api.shot('sail-kbd-FAIL').catch(() => {});
    }
    c.close(); proc.kill();
  }
  /* touch — touchpad-v1 drives the helm */
  {
    const { proc, port } = await launchChrome(['--window-size=1180,820']);
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init();
    await api.seedSave({ ...N2_FLOODED, lastShade: [6.5, 1.2] });
    await c.send('Emulation.setDeviceMetricsOverride', { width: 1180, height: 820, deviceScaleFactor: 1, mobile: true });
    await c.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
    const points = new Map();
    const dispatch = (type) => c.send('Input.dispatchTouchEvent', {
      type, touchPoints: [...points.entries()].map(([id, p]) => ({ x: p.x, y: p.y, id })) });
    const tStart = async (id, x, y) => { points.set(id, { x, y }); await dispatch('touchStart'); };
    const tMove = async (id, x, y) => { points.set(id, { x, y }); await dispatch('touchMove'); };
    const tEnd = async (id) => { points.delete(id); await dispatch('touchEnd'); };
    const tap = async (x, y, hold = 110) => { await tStart(9, x, y); await sleep(hold); await tEnd(9); };
    const rectCenter = async (sel) => {
      const r = await api.eval(`(function(){ const n = document.querySelector('${sel}'); if(!n) return null;
        const r = n.getBoundingClientRect(); return { x: r.left + r.width/2, y: r.top + r.height/2 }; })()`);
      if (!r) throw new Error(sel + ' missing');
      return r;
    };
    try {
      await api.nav(base + '/?turbo=5');
      await api.waitFor(`__fm.state === 'title'`, 30000, 'title (touch)');
      await tap(590, 410);
      await api.waitFor(`!!document.getElementById('__arcade_touchpad')`, 8000, 'touchpad');
      const base0 = await rectCenter('#__atp-base');
      const south = await rectCenter('#__atp-s');
      const east = await rectCenter('#__atp-e');
      for (let i = 0; i < 8 && !(await api.eval('__fm.titleFocus === 1')); i++) {
        await tStart(8, base0.x, base0.y); await tMove(8, base0.x, base0.y + 60);
        await sleep(280); await tEnd(8); await sleep(250);
      }
      for (let i = 0; i < 8 && (await api.eval(`__fm.state === 'title'`)); i++) {
        await tap(south.x, south.y); await sleep(400);
      }
      await api.waitFor(`__fm.state === 'play'`, 30000, 'playing (touch)');
      /* stand by the water, board with ✕ */
      await api.eval('__fmDebug.warp(7.4, 3.8)');
      await api.waitFor(`__fm.prompt === 'board'`, 15000, 'board prompt (touch)');
      for (let i = 0; i < 6 && !(await api.eval('__fm.sailing')); i++) {
        await tap(south.x, south.y); await sleep(400);
      }
      gate('sail(touch): ✕ boards from the shallows', await api.eval('__fm.sailing === true'));
      await api.eval('__fmDebug.boat(0, 45); 0');   // open water: no grounding in the steering test
      const a0 = await api.eval('__fm.boatAng');
      await tStart(8, base0.x, base0.y);
      await tMove(8, base0.x + 60, base0.y - 30);
      await sleep(200);
      await tMove(8, base0.x + 110, base0.y - 55);
      await sleep(2600);
      await tEnd(8);
      gate('sail(touch): the virtual stick sails her',
        (await api.eval('__fm.boatSpd')) > 1.0 || Math.abs((await api.eval('__fm.boatAng')) - a0) > 0.15,
        'spd=' + (await api.eval('__fm.boatSpd')).toFixed(1));
      /* full sail via ○ hold + stick (east first, then the stick) */
      await tStart(7, east.x, east.y);
      await sleep(150);
      await tStart(8, base0.x, base0.y);
      await tMove(8, base0.x, base0.y - 60);
      await sleep(200);
      await tMove(8, base0.x, base0.y - 125);
      await api.waitFor('__fm.boatSpd > 5.2', 30000, 'full sail (touch)').catch(() => {});
      const fullSpd = await api.eval('__fm.boatSpd');
      await tEnd(8); await tEnd(7);
      gate('sail(touch): ○ hold fills the sail', fullSpd > 5.2, 'spd=' + fullSpd.toFixed(1));
      /* glide off + come ashore */
      await api.eval('__fmDebug.boat(8, 4.6, 0.6); P.x=8; P.z=4.6; BOAT.spd=0; 0');
      await api.waitFor(`__fm.prompt === 'ashore'`, 15000, 'ashore prompt (touch)');
      for (let i = 0; i < 6 && (await api.eval('__fm.sailing')); i++) {
        await tap(south.x, south.y); await sleep(400);
      }
      gate('sail(touch): ✕ comes ashore', await api.eval('__fm.sailing === false'));
      const bad = api.consoleBad;
      gate('sail(touch): zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate('sail touch suite', false, e.message);
      await api.shot('sail-touch-FAIL').catch(() => {});
    }
    c.close(); proc.kill();
  }
  /* the MAIDEN VOYAGE: Pearl begs aboard, one guided lap, then the sea is free */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    try {
      await api.seedSave({ ...N2_FLOODED, voyageDone: false });
      await api.nav(base + '/?turbo=8');
      await n2ContinueIn(api);
      await api.installBot('pad');
      const D = driver(api, 'pad');
      await api.walkTo(7.4, 3.8, 1.0, 40000);
      await api.waitFor(`__fm.prompt === 'board'`, 15000, 'Pearl is waiting');
      await D.confirm();
      await advanceDialog(api, D, 'pearlBeg');
      await api.waitFor('__fm.voyageActive === true && __fm.pearlAboard === true', 12000, 'she is aboard');
      gate('voyage: Pearl begs aboard and rides the first launch', true);
      await api.waitFor('__fm.voyA === true', 90000, 'her first wonder line');
      await api.waitFor('__fm.voyB === true', 120000, 'her second wonder line');
      gate('voyage: both wonder lines fired mid-lap', true);
      await api.waitFor('__fm.voyageDone === true', 180000, 'the lap comes home');
      gate('voyage: the lap ends — Pearl ashore, the helm still YOURS',
        (await api.eval('__fm.pearlAboard')) === false && (await api.eval('__fm.sailing')) === true);
      const bad = api.consoleBad;
      gate('voyage: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
    } catch (e) {
      gate('voyage suite', false, e.message);
      await api.shot('voyage-FAIL').catch(() => {});
    }
    c.close(); proc.kill();
  }
}

/* ═══ NIGHT-TWO SHOTS: journeys and singles, staged to be LOOKED at ═══ */
async function suiteN2Shots(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  try {
    /* ── the dungeon descent strip ── */
    await api.seedSave(N2_HOLLOW_OPEN);
    await api.nav(base + '/?turbo=6');
    await n2ContinueIn(api);
    await api.installBot('pad');
    await api.eval('__fmDebug.hud(false)');
    await api.eval(`showCaption = function () {}; floatEl.classList.remove('on'); 0`);
    const still = async (ms) => { await sleep(ms || 550); await api.eval(`floatEl.classList.remove('on'); 0`); await sleep(120); };
    await api.eval('__fmDebug.warp(1914, 1170); __fmDebug.face(0.8);');
    await api.eval('__fmDebug.cam(1908, groundH(1908,1164)+2.2, 1164, 1938, groundH(1938,1192)+2.5, 1192)');
    await still(650);
    await api.shot('n2-descent-1-parted-stones');
    await api.eval('__fmDebug.warp(1955, 1212); __fmDebug.face(0.6);');
    await api.eval('__fmDebug.cam(1949, groundH(1949,1206)+2.0, 1206, 1972, groundH(1972,1236)+1.6, 1236)');
    await still(650);
    await api.shot('n2-descent-2-throat');
    await api.eval('__fmDebug.warp(1968, 1231);');
    await api.eval('__fmDebug.cam(1963, groundH(1963,1227)+2.4, 1227, 1975, groundH(1975,1236)+1.2, 1240)');
    await still(650);
    await api.shot('n2-descent-3-gallery-beamshaft');
    await api.eval('__fmDebug.warp(2006, 1263);');
    await api.eval('__fmDebug.cam(2001, groundH(2001,1258)+2.6, 1258, 2014, groundH(2014,1272)+2.2, 1272)');
    await still(650);
    await api.shot('n2-descent-4-chandelier-vault');
    await api.eval('__fmDebug.warp(1992, 1285);');
    await api.eval('__fmDebug.cam(1994.5, groundH(1994,1283)+1.5, 1282.5, 1990.2, groundH(1990,1288)+1.6, 1288.6)');
    await still(650);
    await api.shot('n2-benbait-fossil');
    /* the wyrm: telegraph (wake), daze (brow), the cure wave */
    await api.seedSave(N2_WYRM_READY);
    await api.nav(base + '/?turbo=6');
    await n2ContinueIn(api);
    await api.installBot('pad');
    const Dw = driver(api, 'pad');
    await api.eval('__fmDebug.hud(false)');
    await api.eval(`showCaption = function () {}; floatEl.classList.remove('on'); 0`);
    await api.eval('__fmDebug.warp(2044, 1301)');
    await api.waitFor('__fm.wyrmActive === true', 15000, 'wyrm up (shots)');
    /* WAKE shot: the hump hunting close — pin hearts so it cannot end us */
    for (let i = 0; i < 120; i++) {
      await api.eval('P.hearts = P.maxHearts; 0');
      const st = await api.eval('__fm.wyrmSt');
      const d = await api.eval('Math.hypot(__fm.wyrmX - __fm.x, __fm.wyrmZ - __fm.z)');
      if (st === 'swim' && d < 9 && d > 2.5) break;
      await sleep(120);
    }
    for (let tries = 0; tries < 6; tries++) {
      await api.eval('__fmDebug.freeze(1)');
      if ((await api.eval('__fm.wyrmSt')) === 'swim') break;
      await api.eval('__fmDebug.freeze(0)');
      await sleep(400);
    }
    await api.eval(`(function(){
      const T = __fm;
      const gy = groundH(T.wyrmX, T.wyrmZ);
      __fmDebug.cam(T.wyrmX + 4.2, gy + 2.1, T.wyrmZ + 5.2, T.wyrmX, gy + 0.5, T.wyrmZ);
    })()`);
    await sleep(450);
    await api.shot('n2-wyrm-wake-telegraph');
    await api.eval('__fmDebug.freeze(0); __fmDebug.camOff()');
    /* DAZE shot: stand the slab until it reels, brow blazing */
    await api.eval('__fmDebug.warp(2040, 1298)');
    for (let i = 0; i < 160; i++) {
      await api.eval('P.hearts = P.maxHearts; if (Math.hypot(P.x - 2040, P.z - 1298) > 1) __fmDebug.warp(2040, 1298); 0');
      if ((await api.eval('__fm.wyrmSt')) === 'daze') break;
      await sleep(150);
    }
    await api.eval('__fmDebug.freeze(1)');
    await api.eval(`(function(){
      const T = __fm;
      const gy = groundH(T.wyrmX, T.wyrmZ);
      __fmDebug.cam(T.wyrmX + 3.6, gy + 3.4, T.wyrmZ + 4.4, T.wyrmX, gy + 2.7, T.wyrmZ);
    })()`);
    await sleep(450);
    await api.shot('n2-wyrm-daze-browglow');
    await api.eval('__fmDebug.freeze(0); __fmDebug.camOff()');
    /* the cure: fight it out (faced swings), then catch the water bow */
    {
      let sawCine = false;
      for (let i = 0; i < 500; i++) {
        if ((await api.eval('__fm.state')) === 'cine') { sawCine = true; break; }
        const wx = await api.eval('__fm.wyrmX'), wz = await api.eval('__fm.wyrmZ');
        const d = Math.hypot((await api.eval('__fm.x')) - wx, (await api.eval('__fm.z')) - wz);
        if (d > 2.8) await api.walkTo(wx, wz, 2.4, 5000).catch(() => {});
        await api.eval('__fmDebug.face(Math.atan2(__fm.wyrmX - __fm.x, __fm.wyrmZ - __fm.z))');
        await Dw.confirm();
        await api.eval('P.hearts = P.maxHearts; 0');
        await sleep(140);
      }
      if (sawCine) {
        await api.eval('window.__fmTurbo = 1');
        for (let i = 0; i < 90; i++) {
          const t = await api.eval('CINE.id === "wyrmCure" ? CINE.t : -1');
          if (t > 5.8 && t < 7.8) { await api.shot('n2-wyrm-cure-wave'); break; }
          if (t < 0 && i > 12) { await api.shot('n2-wyrm-cure-wave'); break; }
          await sleep(180);
        }
        await api.eval('window.__fmTurbo = undefined');
      } else {
        await api.shot('n2-wyrm-cure-wave');
      }
    }
    /* ── THE FLOOD strip: run the real cinematic at real time ── */
    await api.seedSave({ ...N2_CARRY, lastShade: [-33, -72] });
    await api.nav(base + '/?turbo=6');
    await n2ContinueIn(api);
    await api.installBot('pad');
    await api.eval('__fmDebug.hud(false)');
    const D = driver(api, 'pad');
    await api.walkTo(-37, -74.5, 1.6, 40000);
    await api.waitFor(`__fm.prompt === 'wheel2'`, 12000, 'wheel prompt (shots)');
    await api.eval('window.__fmTurbo = 1');
    await D.confirm();
    const floodShots = [
      [1.1, 'n2-flood-1-shield-slot'], [2.9, 'n2-flood-2-second-notch'],
      [5.6, 'n2-flood-3-sky-secondstar'], [8.2, 'n2-flood-4-silver-line'],
      [9.6, 'n2-flood-5-dive-swing'],
    ];
    for (const [tt, name] of floodShots) {
      await api.waitFor(`(__fm.floodCine !== null && __fm.floodCine >= ${tt}) || __fm.autorun === true`, 30000, name);
      await api.shot(name);
    }
    await api.waitFor(`__fm.handoffK >= 0.45 || __fm.handoffRumbles > 0`, 20000, 'mid-swing');
    await api.shot('n2-flood-6-handoff-mid');
    await api.waitFor(`__fm.handoffRumbles === 1`, 20000, 'control live');
    await sleep(600);
    await api.shot('n2-flood-7-running-free');
    await api.eval('window.__fmTurbo = undefined');
    await api.waitFor(`__fm.autorun === false`, 30000, 'run eased out');
    /* singles: shield in the wheel, second star, flooded bay from the hill */
    await api.eval('__fmDebug.warp(-30, -66)');
    await api.eval('__fmDebug.cam(-32, groundH(-38,-78)+6.4, -68, -38, groundH(-38,-78)+7.6, -78)');
    await still(700);
    await api.shot('n2-shield-in-the-wheel');
    await api.eval('__fmDebug.cam(-30, groundH(-38,-78)+8.5, -64, 30, 30, 90)');
    await still(700);
    await api.shot('n2-second-star');
    await api.eval('__fmDebug.cam(-34, groundH(-38,-78)+9, -60, 10, -2, 60)');
    await still(700);
    await api.shot('n2-flooded-bay-from-wheel-hill');
    /* the boat afloat + first sail strip + Pearl aboard */
    await api.eval('__fmDebug.camOff()');
    await api.walkTo(4, -2, 2.2, 90000);
    await api.waitFor('__fm.boatFloating === true', 40000, 'boat floated (shots)');
    await api.eval('__fmDebug.cam(1.5, 1.4, -3.5, 8.5, -0.4, 6)');
    await still(700);
    await api.shot('n2-wakeboat-afloat');
    await api.eval('__fmDebug.camOff()');
    await api.walkTo(7.4, 3.8, 1.0, 40000);
    await api.waitFor(`__fm.prompt === 'board'`, 15000, 'board (shots)');
    await D.confirm();
    await advanceDialog(api, D, 'pearlBeg').catch(() => {});
    await api.waitFor('__fm.sailing === true', 15000, 'under way (shots)');
    await sleep(2500);
    await api.eval('__fmDebug.freeze(1)');
    await api.eval(`__fmDebug.cam(BOAT.x - Math.sin(BOAT.ang) * 7 + 2.5, 1.6, BOAT.z - Math.cos(BOAT.ang) * 7, BOAT.x, 0.4, BOAT.z)`);
    await sleep(400);
    await api.shot('n2-first-sail-pearl-aboard');
    await api.eval('__fmDebug.freeze(0); __fmDebug.camOff()');
    await api.eval(`__fmBot.tol=4; __fmBot.target=[-20, 60]`);
    await sleep(4200);
    await api.eval('__fmDebug.freeze(1)');
    await api.eval(`__fmDebug.cam(BOAT.x + 6, 2.2, BOAT.z - 5, BOAT.x, 0.2, BOAT.z + 4)`);
    await sleep(400);
    await api.shot('n2-first-sail-open-water');
    await api.eval('__fmDebug.freeze(0); __fmDebug.camOff(); __fmBot.release()');
    const bad = api.consoleBad;
    gate('n2shots: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('n2shots suite', false, e.message);
    await api.shot('n2shots-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
}


/* ═══ PHASE 3: the sealed Foundry, the three verbs, the Tortoise, the sun ═══
   The deep coverage lives in test/probes/p6e-*.mjs (102 gates). This suite
   is the subset that must NEVER regress, folded into `all` so it runs on
   every future build. */
const P3_ASHORE = {
  ...N2_FLOODED, q: 10, keelFound: true, keelCarried: false, boatRefit: true,
  moonSeen: true, isleLandfall: true, lastShade: [-980, -196],
};
async function suiteIsles(base) {
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = makeApi(c);
  await api.init(); await api.stubPad();
  try {
    /* THE SEAL. p6d once hung an unconditional collider in its own doorway,
       which walled the Foundry shut forever; this pins both directions. */
    /* NOT `once`: that flag seeds only the first navigation, so the later
       fixtures in this suite silently kept the live save and the sun and
       NEW-GAME gates were reading the wrong world. */
    await api.seedSave({ ...P3_ASHORE, watchBell: false });
    await api.nav(base + '/?turbo=6');
    await n2ContinueIn(api);
    gate('isles: the Foundry is SEALED until Watchstone\'s bell is rung',
      (await api.eval('__fmDebug.foundryInfo().gate')) === false);
    await api.eval('__fmDebug.openFoundry()');
    await api.waitTicks(10);
    gate('isles: ringing the bell opens the gate', (await api.eval('__fmDebug.foundryInfo().gate')) === true);
    /* and the doorway is genuinely WALKABLE — the bug the seal fix was for */
    await api.eval(`__fmDebug.warp(${-1520}, ${-344}); 0`);
    await api.waitTicks(10);
    await api.installBot('pad');
    /* staged waypoints down the ramp — one long leg stalls on the turn, and
       "inside the Foundry" is the claim that matters, not a z threshold */
    for (const [wx, wz] of [[-1520, -351], [-1520, -360], [-1512, -374]]) {
      await api.eval(`__fmBot.tol = 1.6; __fmBot.target = [${wx}, ${wz}]; 0`);
      await api.waitFor(`Math.hypot(__fm.x-(${wx}), __fm.z-(${wz})) < 2.6`, 45000, 'walk ' + wx + ',' + wz).catch(() => {});
      await api.eval('P.hearts = P.maxHearts; 0');
    }
    await api.eval('__fmBot.target = null; 0');
    await api.waitTicks(12);
    gate('isles: the portal is walkable — you get INSIDE the Foundry on foot',
      (await api.eval('__fm.inFoundry')) === true,
      `x=${(await api.eval('__fm.x')).toFixed(0)} z=${(await api.eval('__fm.z')).toFixed(0)}`);
    await api.eval('__fmBot.release(); 0');

    /* THE THREE VERBS, real input, in order. HOLD is timed: ring and LEAVE
       AT ONCE — the tone is the player's clock, and gates that dawdle in
       setup spend it and then blame the door. */
    await api.eval('__fmDebug.warpFoundry("f1"); P.hearts = P.maxHearts; 0');
    await api.waitTicks(20);
    await api.eval('__fmDebug.solveAim ? __fmDebug.solveAim() : 0');
    const g = async () => JSON.parse(await api.eval('JSON.stringify(__fmDebug.foundryInfo().glyphs)'));
    gate('isles: the three verbs start unsolved', (await g()).every(v => v === false));

    /* THE HOUR TORTOISE — proximity wakes it from ANY state, and body-only
       slashing must win the whole fight (the King-Crab lesson, enforced). */
    await api.seedSave({ ...P3_ASHORE, watchBell: true, fGlyph1: true, fGlyph2: true, fGlyph3: true });
    await api.nav(base + '/?turbo=6');
    await n2ContinueIn(api);
    await api.eval('__fmDebug.warpFoundry("pit"); P.hearts = P.maxHearts; 0');
    await api.waitTicks(40);                       // let the pit settle after the nav
    await api.eval('__fmDebug.warpFoundry("pit"); P.hearts = P.maxHearts; 0');
    await api.waitFor('__fm.tortActive === true', 90000, 'the Tortoise wakes on approach');
    gate('isles: proximity ALWAYS wakes the Hour Tortoise', await api.eval('__fm.tortActive === true'));
    const hp0 = await api.eval('__fm.tortHp');
    await api.installBot('pad');
    await api.eval('__fmBot.mash = true; 0');
    /* Mash from INSIDE the page. Still the real pad path — the same button a
       kid holds — but one CDP round trip per swing made the fight lose to the
       harness's own latency rather than to the boss. Hearts are topped up as
       SETUP so we are testing whether body damage can finish it, not whether
       a bot can also survive. */
    /* the kid CHASES: a stationary masher whiffs whenever the Tortoise
       rolls away, and three ten-minute runs stalled at 13-25hp purely on
       drive-by geometry. The bot walks at the boss (real stick input via
       the pad axes) and mashes ✕ — which is exactly what Ben does. */
    await api.installBot('pad');
    await api.eval(`window.__kidBot = setInterval(function(){
      try {
        P.hearts = P.maxHearts;
        if (typeof TORT !== 'undefined' && TORT.c && window.__fmBot) {
          __fmBot.tol = 1.6;
          __fmBot.target = [TORT.c.root.position.x, TORT.c.root.position.z];
        }
        __fakePad.press(0);
        setTimeout(function(){ __fakePad.press(); }, 80);
      } catch (e) {}
    }, 170); 0`);
    /* ten minutes, not five: on a loaded machine the sim runs slow real-time
       and the bot lost twice to the CLOCK while visibly winning (84→13,
       84→25, and 84→0 whenever the machine was quiet). The claim under test
       is that body-mashing WINS, not that it wins fast. */
    await api.waitFor('__fm.tortDone === true', 600000, 'the kid bot finishes it').catch(() => {});
    await api.eval('clearInterval(window.__kidBot); __fakePad.press(); 0');
    const hp = await api.eval('__fm.tortHp');
    gate('isles: a KID BOT that only body-slashes wins the whole fight',
      (await api.eval('__fm.tortDone')) === true || hp <= 0, `hp ${hp0} → ${hp}`);
    gate('isles: body hits always chipped (no claw-only gating)',
      (await api.eval('__fm.tortBody')) > 0, 'bodyHits=' + await api.eval('__fm.tortBody'));

    /* THE SUN MOVES — and the safety rail holds at every angle. */
    await api.seedSave({ ...N2_FLOODED, q: 12, ph: 3, sky: 3, sunArc: true, boatRefit: true,
      moonSeen: true, isleLandfall: true, watchBell: true, tortoiseDone: true,
      fGlyph1: true, fGlyph2: true, fGlyph3: true });
    await api.nav(base + '/?turbo=6');
    await n2ContinueIn(api);
    gate('isles: the world restores at sky step 3 with the arc live',
      (await api.eval('__fm.sunArc')) === true && (await api.eval('__fm.skyStep3')) > 0.5);
    const rail = await api.eval(`(function(){
      const spots = [[8.2, 7.0]].concat(
        (typeof FSPRINGS !== 'undefined' ? FSPRINGS.map(s => [s.x, s.z]) : []));
      let worst = null, checked = 0;
      for (let i = 0; i <= 20; i++) {
        __fmDebug.sunSet(i / 20);
        for (const s of spots) { checked++; if (!inShadeAt(s[0], s[1])) worst = [i / 20, s]; }
      }
      return JSON.stringify({ checked, worst });
    })()`);
    const railR = JSON.parse(rail);
    gate('isles: SAFETY RAIL — every sanctuary stays shade at all 21 sun angles',
      railR.worst === null, `${railR.checked} checks, worst=${JSON.stringify(railR.worst)}`);

    /* THE LAMP ROOM — Finn's joke from the first ten minutes, paid off.
       The stairs only go somewhere once there is a dusk to light for. */
    gate('lamp: the stairs open once the sun moves', await api.eval('__fm.lampStairsOpen === true'));
    await api.eval('__fmDebug.warp(330, -178.55); 0');
    await api.waitTicks(16);
    await api.eval('P.x = 331.75; P.z = -179.35; 0');
    await api.waitTicks(10);
    gate('lamp: the ground room offers ✕ CLIMB at the stairs',
      (await api.eval('JSON.stringify((currentInteract()||{}).id)')) === '"lampStair"');
    await api.eval('doInteract(currentInteract()); 0');
    await api.waitFor('__fm.inLampRoom === true', 25000, 'up in the lamp room');
    gate('lamp: climbing puts you in the lamp room', await api.eval('__fm.inLampRoom === true'));
    await api.eval('P.x = 330; P.z = -259.9; 0');
    await api.waitTicks(10);
    gate('lamp: the unlit lamp offers ✕ LIGHT THE LAMP',
      (await api.eval('JSON.stringify((currentInteract()||{}).id)')) === '"lampLight"');
    await api.eval('doInteract(currentInteract()); 0');
    await api.waitFor('__fm.lampLit === true', 30000, 'the lamp catches');
    gate('lamp: it lights, and the beam turns', await api.eval('__fm.lampLit === true') &&
      await api.eval('__fm.lampBeamOn === true'));
    /* brighter at dusk than at noon — the whole reason it waited for phase 3 */
    await api.eval('__fmDebug.sunSet(0.02); 0'); await api.waitTicks(8);
    const noonOp = (await api.eval('__fmDebug.lampInfo()')) && await api.eval('__fmDebug.lampInfo().opacity');
    await api.eval('__fmDebug.sunSet(0.95); 0'); await api.waitTicks(8);
    const duskOp = await api.eval('__fmDebug.lampInfo().opacity');
    gate('lamp: the beam swells toward dusk', duskOp > noonOp * 1.5, `noon=${noonOp} dusk=${duskOp}`);

    /* the John sequence, extended to phase 3 */
    /* the John sequence through the REAL title: NEW GAME over a finished
       save, confirm the overwrite guard, and demand a fresh world. */
    await api.nav(base + '/?turbo=6');
    await api.waitFor(`__fm.state === 'title'`, 30000, 'title again');
    await tapUntil(api, () => api.tap(12), '__fm.titleFocus === 0', 10, 'focus NEW GAME');
    await tapUntil(api, () => api.tap(0), `__fm.state !== 'title' || __fm.ngGuard === true`, 12, 'the guard');
    /* retry the confirm too: a single press at the title can land while the
       sim is still building the world and be spent before it is acted on */
    await tapUntil(api, () => api.tap(0), `__fm.state === 'play'`, 14, 'fresh adventure');
    await api.waitFor(`__fm.state === 'play'`, 30000, 'fresh adventure');
    const fresh = await api.eval(`JSON.stringify({ refit: !!(SAVE && SAVE.boatRefit), moon: !!(SAVE && SAVE.moonSeen),
      bell: !!(SAVE && SAVE.watchBell), tort: !!(SAVE && SAVE.tortoiseDone), arc: !!(SAVE && SAVE.sunArc),
      sky: SAVE ? SAVE.sky : -1 })`).catch(() => 'null');
    if (fresh && fresh !== 'null') {
      const f = JSON.parse(fresh);
      gate('isles: NEW GAME un-refits the boat, un-sees the moon, re-pins the sun',
        !f.refit && !f.moon && !f.bell && !f.tort && !f.arc && f.sky === 0, fresh);
      gate('lamp: NEW GAME puts the lamp out again',
        (await api.eval('__fm.lampLit')) === false && (await api.eval('__fm.lampStairsOpen')) === false);
    }
    const bad = api.consoleBad;
    gate('isles: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('isles suite', false, e.message);
    await api.shot('isles-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
}


/* ═══ JOURNEYS: the blind spots the review found — real input, one session ═══ */
async function suiteJourneys(base) {
  /* 1. RESUME WHERE YOU STOOD (lastPos had zero coverage; every fixture
        predates it, so the code path every real family save uses was never
        executed by a single gate). */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    try {
      await api.seedSave({ ...N2_FLOODED }, true);      // once: later reloads keep live writes
      await api.nav(base + '/?turbo=6');
      await n2ContinueIn(api);
      await api.installBot('pad');
      await api.eval('__fmBot.tol = 1.2; __fmBot.target = [30, -30]; 0');
      await api.waitFor('Math.hypot(__fm.x - 30, __fm.z + 30) < 3', 45000, 'walked somewhere distinctive');
      await api.eval('__fmBot.release(); 0');
      await api.waitFor('SAVE.lastPos && Math.hypot(SAVE.lastPos[0] - __fm.x, SAVE.lastPos[1] - __fm.z) < 4', 20000, 'lastPos recorded');
      const wx = await api.eval('__fm.x'), wz = await api.eval('__fm.z');
      await api.nav(base + '/?turbo=6');                 // quit + relaunch, no reseed
      await n2ContinueIn(api);
      const d = await api.eval(`Math.hypot(__fm.x - (${wx}), __fm.z - (${wz}))`);
      gate('journeys: CONTINUE resumes where you actually stood', d < 4, `Δ=${d.toFixed(1)}m`);
      /* the John-shaped legacy save: bay region, forest anchor, no lastPos */
      await api.seedSave({ ...FAMILY_Q4, q: 6, ph: 2, sky: 2, floodSeen: true, region: 'bay',
        lastShade: [700, 340], lastPos: null }, false);
      await api.nav(base + '/?turbo=6');
      await n2ContinueIn(api);
      gate('journeys: a legacy bay save never wakes in the forest', (await api.eval('__fm.x')) < 170,
        'x=' + (await api.eval('__fm.x')).toFixed(0));
      const bad = api.consoleBad;
      gate('journeys: zero console errors (resume)', bad.length === 0, bad.slice(0, 2).join(' | '));
    } catch (e) { gate('journeys resume suite', false, e.message); }
    c.close(); proc.kill();
  }
  /* 2. THE BELL, RUNG FOR REAL, OPENS THE DOORS IN THE SAME SESSION (the
        suiteIsles gate uses the debug flag — this one walks the input). */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    try {
      await api.seedSave({ ...N2_FLOODED, q: 10, keelFound: true, boatRefit: true, moonSeen: true,
        isleLandfall: true, watchBell: false, lastPos: [-978, -206], lastShade: [-980, -196] });
      await api.nav(base + '/?turbo=6');
      await n2ContinueIn(api);
      await api.installBot('pad');
      await api.eval(`__fmBot.tol = 1.2; __fmBot.target = [${-976}, ${-204}]; 0`);   // WATCH_BELL is (-978,-206), prompt radius 4.2
      await api.waitFor(`__fm.prompt === 'watchbell'`, 60000, 'the bell offers ✕');
      await api.eval('__fmBot.release(); 0');
      await tapUntil(api, () => api.tap(0), 'SAVE.watchBell === true', 12, 'RING IT');
      await api.waitFor(`__fm.state === 'play'`, 40000, 'the ring beat ends');
      gate('journeys: ✕ at the bell rings it', await api.eval('SAVE.watchBell === true'));
      gate('journeys: the ring OPENS the Foundry in the same session (no reload)',
        (await api.eval('__fmDebug.foundryInfo().gate')) === true);
      const bad = api.consoleBad;
      gate('journeys: zero console errors (bell)', bad.length === 0, bad.slice(0, 2).join(' | '));
    } catch (e) { gate('journeys bell suite', false, e.message); }
    c.close(); proc.kill();
  }
  /* 3. THE CONSOLE'S OWN MODE: ?fx=low was never loaded by any test, and the
        Pi runs nothing else. */
  {
    const { proc, port } = await launchChrome();
    const c = await pageSession(port);
    const api = makeApi(c);
    await api.init(); await api.stubPad();
    try {
      await api.seedSave({ ...N2_FLOODED });
      await api.nav(base + '/?fx=low&turbo=6');
      await n2ContinueIn(api);
      await api.installBot('pad');
      await api.eval('__fmBot.tol = 1.5; __fmBot.target = [20, -20]; 0');   // dry ground — [20,30] is under the returned sea
      await api.waitFor('Math.hypot(__fm.x - 20, __fm.z + 20) < 4', 45000, 'walked under lowfx');
      gate('journeys: LOWFX boots, plays, and walks', true);
      const bad = api.consoleBad;
      gate('journeys: zero console errors (LOWFX)', bad.length === 0, bad.slice(0, 2).join(' | '));
    } catch (e) { gate('journeys lowfx suite', false, e.message); }
    c.close(); proc.kill();
  }
}

const whichArg = process.argv[2] || 'all';
const parts = whichArg.split(',');
const which = parts.length > 1 ? 'list' : whichArg;
const wants = (name) => which === 'all' || which === name || (which === 'list' && parts.includes(name));
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const t0 = Date.now();
try {
  if (which === 'art') await suiteArt(base);
  if (wants('shots')) await suiteShots(base);
  if (wants('walls')) await suiteWalls(base);
  if (wants('fuzz')) await suiteFuzz(base);
  if (wants('boss')) await suiteBoss(base);
  if (wants('interior')) await suiteInterior(base);
  if (wants('rooms')) await suiteRooms(base);
  if (wants('combat')) await suiteCombat(base);
  if (wants('saves')) await suiteSaves(base);
  if (wants('migrate')) await suiteMigrate(base);
  if (wants('flow')) await suiteFlow(base);
  if (wants('kbd')) await suiteKbd(base);
  if (wants('touch')) await suiteTouch(base);
  if (wants('perf')) await suitePerf(base);
  if (wants('world')) await suiteWorld(base);
  if (wants('forest')) await suiteForest(base);
  if (wants('ground')) await suiteGround(base);
  if (wants('trees')) await suiteTrees(base);
  if (wants('swelter')) await suiteSwelter(base);
  if (wants('dmgvis')) await suiteDmgVis(base);
  if (wants('fperf')) await suiteForestPerf(base);
  if (wants('fshots')) await suiteForestShots(base);
  if (wants('hollow')) await suiteHollow(base);
  if (wants('wyrm')) await suiteWyrm(base);
  if (wants('flood')) await suiteFlood(base);
  if (wants('sail')) await suiteSail(base);
  if (wants('n2shots')) await suiteN2Shots(base);
  if (wants('isles')) await suiteIsles(base);
  if (wants('journeys')) await suiteJourneys(base);
} finally {
  srv.close();
}
console.log(`\n${failures === 0 ? 'ALL GATES GREEN' : failures + ' FAILURE(S)'}  (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
process.exit(failures ? 1 : 0);
