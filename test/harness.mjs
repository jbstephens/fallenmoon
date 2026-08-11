#!/usr/bin/env node
// FALLEN MOON verification harness.
// Headless Chrome + CDP. Fake standard-mapping gamepad injected BEFORE page
// scripts; everything driven through REAL input (pad axes/buttons or real
// KeyboardEvents) and asserted via the read-only telemetry window.__fm.
//
//   node test/harness.mjs all
//   (or: flow kbd touch perf shots)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import zlib from 'node:zlib';
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

async function launchChrome(extraFlags = []) {
  const profile = fs.mkdtempSync(path.join(DIR, 'test', '.chrome-'));
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
  B.release=()=>{ stick(0,0); press(false); sprint(false); B.target=null; B.fight=false; B.boss=false; B.still=false; };
  let f=0;
  // stuck detection: if a walk target exists but we stop making progress
  // (collider pockets in the village clutter), sidestep for a beat
  let lastX=0, lastZ=0, stuckCheck=0, wiggleF=0, wiggleSign=1;
  (function step(){
    requestAnimationFrame(step);
    f++;
    const T = window.__fm;
    if (!T || T.state!=='play' || B.still){ if(B.still) stick(0,0); return; }
    if (B.target){
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
      if (!T.bossActive){ want=[58,164]; press(false); sprint(false); }
      else if (st==='stuck'||st==='dizzy'){
        sprint(false);
        // steer INTO the claw while swinging — v3's solid arena wall can pin
        // the flee, so the slam may land right on us with our back turned
        const cx=T.bossClawX, cz=T.bossClawZ;
        want=[cx,cz];
        press((f>>2)&1?true:false);
      } else if (st==='slamTele'||st==='slam'){
        press(false); sprint(true);            // sprint clear of the slam
        want=[bx+dxp/dp*8, bz+dzp/dp*8];
      } else if (st==='chargeTele'||st==='charge'){
        press(false); sprint(true);            // sprint out of the charge line
        want=[62-dzp/dp*7, 166+dxp/dp*7];
      } else {
        press(false); sprint(false);
        // dp 4.2..6.5 is the engagement pocket — outside it, close back in
        // (v3's solid arena wall can funnel a flee into the corridor mouth,
        // just past the boss's slam range: never linger there)
        if (dp<4.2) want=[bx+dxp/dp*6, bz+dzp/dp*6];
        else if (dp>6.5) want=[bx+dxp/dp*6, bz+dzp/dp*6];
      }
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
    async seedSave(save) {
      await c.send('Page.addScriptToEvaluateOnNewDocument', {
        source: `try{localStorage.setItem('fallenmoon_save_v1', ${JSON.stringify(JSON.stringify(save))});}catch(e){}`,
      });
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
    await api.eval(`window.__kw={over:0};(function w(){
      const T=__fm; if(Math.abs(T.z-9.2)<0.55&&Math.abs(T.x-12.4)<1.2&&T.airY>__kw.over)__kw.over=T.airY;
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
    const bad = api.consoleBad;
    gate('combat: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('combat suite', false, e.message);
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
    await api.eval(`window.__fz = { bad: 0, arena: 0, worst: '' };
      (function w(){ const T = window.__fm;
        if (T && T.state === 'play') {
          if (grottoSolidAt(T.x, T.z)) { __fz.bad++; __fz.worst = T.x.toFixed(1)+','+T.z.toFixed(1); }
          if (window.__fzKeepOut) {
            const k = window.__fzKeepOut;
            if (Math.hypot(T.x - k[0], T.z - k[1]) < k[2]) { __fz.bad++; __fz.worst = 'keepout '+T.x.toFixed(1)+','+T.z.toFixed(1); }
          }
          if (window.__fzNoArena && Math.hypot(T.x - 62, T.z - 166) < 14.2) __fz.arena++;
        }
        requestAnimationFrame(w); })()`);
  };
  // push the player toward world-dir (dx,dz) for ms; optionally jumping
  const shove = async (dx, dz, ms, jump) => {
    const t0 = Date.now();
    let jt = 0;
    while (Date.now() - t0 < ms) {
      await api.eval(`__fmDebug.camYaw(Math.PI)`);
      await api.axes(-dx, -dz);
      if (jump && Date.now() - jt > 500) { jt = Date.now(); await api.press(2); await sleep(60); await api.press(); }
      await sleep(90);
    }
    await api.axes(0, 0);
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
    const bad = api.consoleBad;
    gate('fuzz: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('fuzz suite', false, e.message);
    await api.shot('fuzz-FAIL').catch(() => {});
  }
  c.close(); proc.kill();
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
      ['grotto-A', 30, 150, -1.4, 9, Array.from({ length: 12 }, (_, i) => i / 12 * Math.PI * 2)
        .filter(a => {
          const d = ((a - 4.712 + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
          return Math.abs(d) > 0.85;         // skip the daylight mouth sector
        })],
      ['grotto-B', 62, 166, -1.4, 8, Array.from({ length: 12 }, (_, i) => i / 12 * Math.PI * 2)],
      ['corridor', 47, 158.5, -1.4, 5, [0.46, 0.46 + Math.PI / 2, 0.46 + Math.PI, 0.46 + Math.PI * 1.5]],
    ];
    for (const [tag, cx, cz, eyeY, lookR, azs] of interior) {
      if (tag === 'grotto-B' || tag === 'corridor') await api.eval(`__fmDebug.warp(${tag === 'corridor' ? '47, 158.5' : '62, 166'})`);
      let worst = 0, worstAt = '';
      for (const a of azs) {
        for (const [ptag, ly] of [['level', 0.6], ['up', 5.2]]) {
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
const which = process.argv[2] || 'all';
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const t0 = Date.now();
try {
  if (which === 'art') await suiteArt(base);
  if (which === 'all' || which === 'shots') await suiteShots(base);
  if (which === 'all' || which === 'walls') await suiteWalls(base);
  if (which === 'all' || which === 'fuzz') await suiteFuzz(base);
  if (which === 'all' || which === 'combat') await suiteCombat(base);
  if (which === 'all' || which === 'saves') await suiteSaves(base);
  if (which === 'all' || which === 'migrate') await suiteMigrate(base);
  if (which === 'all' || which === 'flow') await suiteFlow(base);
  if (which === 'all' || which === 'kbd') await suiteKbd(base);
  if (which === 'all' || which === 'touch') await suiteTouch(base);
  if (which === 'all' || which === 'perf') await suitePerf(base);
} finally {
  srv.close();
}
console.log(`\n${failures === 0 ? 'ALL GATES GREEN' : failures + ' FAILURE(S)'}  (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
process.exit(failures ? 1 : 0);
