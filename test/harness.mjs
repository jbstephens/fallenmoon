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
  let pressed=false;
  function press(on){
    if (on===pressed) return; pressed=on;
    if (B.mode==='pad'){ if(on) __fakePad.press(0); else __fakePad.press(); }
    else key('KeyJ', on);
  }
  function roll(){
    if (B.mode==='pad'){ __fakePad.press(1); setTimeout(()=>{ if(!pressed) __fakePad.press(); },80); }
    else { key('KeyK',true); setTimeout(()=>key('KeyK',false),80); }
  }
  B.release=()=>{ stick(0,0); press(false); B.target=null; B.fight=false; B.boss=false; B.still=false; };
  let f=0;
  (function step(){
    requestAnimationFrame(step);
    f++;
    const T = window.__fm;
    if (!T || T.state!=='play' || B.still){ if(B.still) stick(0,0); return; }
    let want=null;
    if (B.boss){
      const st=T.bossState, bx=T.bossX, bz=T.bossZ;
      const dxp=T.x-bx, dzp=T.z-bz, dp=Math.hypot(dxp,dzp)||1;
      if (!T.bossActive){ want=[58,164]; press(false); }
      else if (st==='stuck'||st==='dizzy'){
        const cx=T.bossClawX, cz=T.bossClawZ;
        const d=Math.hypot(cx-T.x,cz-T.z);
        if (d>1.8) want=[cx,cz];
        else { want=null; stick(0,0); press((f>>2)&1?true:false); }
      } else if (st==='slamTele'||st==='slam'){
        press(false);
        want=[bx+dxp/dp*8, bz+dzp/dp*8];
      } else if (st==='chargeTele'||st==='charge'){
        press(false);
        if (st==='charge' && dp<6 && f%18===0) roll();
        want=[62-dzp/dp*7, 166+dxp/dp*7];
      } else {
        press(false);
        if (dp<4.2) want=[bx+dxp/dp*6, bz+dzp/dp*6];
        else if (dp>9) want=[bx+dxp/dp*6, bz+dzp/dp*6];
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
        const wx=dx/d, wz=dz/d, y=T.camYaw;
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
      await api.eval(`__fmBot.done=false; __fmBot.tol=${tol}; __fmBot.target=[${x},${z}]`);
      await api.waitFor(
        `__fmBot.done || Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < ${tol + 0.15} || __fm.state!=='play'`,
        timeout, `walk to ${x},${z}`);
      await api.eval('__fmBot.target=null');
    },
    async perfReset() {
      await api.eval(`window.__perfMax={calls:0,tris:0};
        if(!window.__perfHook){window.__perfHook=1;(function s(){requestAnimationFrame(s);
          const T=window.__fm; if(!T) return;
          if(T.state==='play'||T.state==='cine'||T.state==='dialog'){
            if(T.calls>__perfMax.calls)__perfMax.calls=T.calls;
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

/* ═══════════ the full slice, drivable by pad or keyboard ═══════════ */
async function playSlice(api, D, opts = {}) {
  const g = (n, ok, d) => gate(`${opts.tag}: ${n}`, ok, d);
  await api.waitFor(`__fm.state === 'title'`, 25000, 'title');
  if (opts.titleShot) { await sleep(1600); await api.shot('title-1280x720'); }
  await tapUntil(api, D.confirm, `__fm.state !== 'title'`, 12, 'leave title');   // NEW GAME
  await api.waitFor(`__fm.state === 'play'`, 30000, 'wake → play');
  g('wake cinematic → free control', true);
  g('wakes in shade', await api.eval('__fm.shade === true'));
  await api.installBot(D.mode);
  await api.perfReset();

  // step into the glare, then the village
  await api.walkTo(8, -8, 1.2);
  g('walked into the sun (glare beat)', await api.eval('__fm.everSun === true'));

  // ── Granny Tock ──
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

  // ── Keeper Finn → the sword ──
  await api.walkTo(24, -19, 1.2);
  await api.walkTo(40.9, -16, 0.45);
  await api.waitFor(`__fm.prompt === 'talk'`, 8000, 'finn prompt');
  await D.confirm();
  await advanceDialog(api, D, 'finn1');
  await api.waitFor('__fm.sword === true', 8000, 'sword given');
  g('Moonglass Sword obtained', true, 'quest=' + await api.eval('__fm.quest'));

  // ── cut the door kelp (real swings) ──
  await api.waitTicks(120);            // item-get beat
  await api.walkTo(41.55, -16, 0.5);
  for (let i = 0; i < 8 && !(await api.eval('__fm.kelpDoorCut')); i++) {
    await D.confirm();
    await sleep(300);
  }
  g('door kelp cut with real swings', await api.eval('__fm.kelpDoorCut'));
  await advanceDialog(api, D, 'finn2');
  g('Finn freed → quest to the bay', (await api.eval('__fm.quest')) === 2);

  // ── moonglass pulse ──
  if (D.mode === 'pad') await api.press(3); else await api.key('l', 'KeyL', true);
  let pulsed = false;
  try { await api.waitFor('__fm.pulseT > 0', 3000, 'pulse'); pulsed = true; } catch (e) {}
  if (D.mode === 'pad') await api.press(); else await api.key('l', 'KeyL', false);
  g('moonglass pulse (△) fires', pulsed);

  // ── out into the Dry Bay ──
  await api.walkTo(14, -18, 1.4);
  await api.walkTo(9, 2, 1.4);
  await api.walkTo(11, 22, 1.4);
  // pre-payoff shade probe: this exact spot must be SUN now, SHADE after dusk
  // (read-only world query — the real walk+heal check happens after the payoff)
  const shadeBefore = await api.eval('inShadeAt(15.0, 53.2)');
  g('stretch-spot is sunlit before the payoff', shadeBefore === false);

  // ── kill a Scorch Crab with real swings ──
  const crabs0 = await api.eval('__fm.crabsAlive');
  await api.bot({ fight: true });
  if (opts.combatShot) {
    await api.eval(`window.__fmShotFlag=false;(function w(){
      const T=__fm; if(T.pst==='atk'&&T.nearCrabDist<2.4){window.__fmShotFlag=true;return;}
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

  // ── kill a Glare Wisp (chase the nearest live one) ──
  const wisps0 = await api.eval('__fm.wispsAlive');
  await api.walkTo(2, 57, 1.2);
  await api.bot({ fight: true });
  await api.waitFor(`__fm.wispsAlive < ${wisps0}`, 120000, 'wisp popped');
  await api.bot({ fight: false });
  await api.botRelease();
  g('Glare Wisp popped by real swing', true);

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

  // ── shipwreck chest → heart container ──
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

  // ── Tidepool Grotto: the mirror puzzle ──
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

  // ── carry it home to the Moonwheel ──
  await api.walkTo(47, 158.5, 1.4);
  await api.walkTo(36, 152.5, 1.4);
  await api.walkTo(30, 131, 1.4);
  await api.walkTo(12, 60, 2.0);
  await api.walkTo(11, 22, 2.0);
  await api.walkTo(9, 0, 2.0);
  await api.walkTo(0, -24, 2.0);
  await api.walkTo(-14, -44, 2.0);
  await api.walkTo(-30, -62, 2.0);
  await api.walkTo(-36.4, -73.6, 1.2);

  // sky sample BEFORE
  await api.eval('__fmDebug.camYaw(Math.PI); __fmDebug.face(0);');
  await api.eval('window.__fmTurbo = 1');
  await sleep(900);
  const skyBefore = await api.shot(opts.tag === 'pad' ? 'sky-before' : 'sky-before-kbd');
  await api.eval('window.__fmTurbo = undefined');

  // ── THE PAYOFF ──
  await api.walkTo(-37.2, -74.6, 0.8);
  await api.waitFor(`__fm.prompt === 'wheel'`, 10000, 'wheel prompt');
  await D.confirm();
  await api.waitFor(`__fm.cinId === 'wheel'`, 10000, 'payoff begins');
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
    gate('save: heart containers intact', (await api.eval('__fm.maxHearts')) === 6);
    gate('save: chest stays opened', await api.eval('__fm.chestOpened === true'));
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
    q: 2, ph: 0, mh: 5, sword: true, salt: 0,
    talked: { finn: 2, tock: 1, pearl: 1 },
    kelpDoor: true, wreckChest: false, wallBurned: false,
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
    await tEnd(8);
    gate('touch: stick moves Wick', true);
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
    q: 2, ph: 0, mh: 6, sword: true, salt: 2,
    talked: { finn: 2, tock: 1, pearl: 1 },
    kelpDoor: true, wreckChest: true, wallBurned: false,
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
    // bay mid-fight
    await api.walkTo(9, 2, 2.0, 90000);
    await api.walkTo(12, 40, 2.0, 90000);
    await api.perfReset();
    await api.bot({ fight: true });
    await sleep(7000);
    const bay = await api.perfRead();
    await api.botRelease();
    const fps = await api.eval('__fm.fps');
    gate('perf: bay-fight draw calls ≤ 80', bay.calls <= 80, 'max ' + bay.calls);
    gate('perf: bay-fight triangles ≤ 120k', bay.tris <= 120000, 'max ' + bay.tris);
    gate('perf: headless fps not degenerate', fps > 30, 'fps ' + fps.toFixed(1));
    const bad = api.consoleBad;
    gate('perf: zero console errors', bad.length === 0, bad.slice(0, 3).join(' | '));
  } catch (e) {
    gate('perf suite', false, e.message);
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
    for (const name of ['wick', 'finn', 'tock', 'pearl', 'crab', 'wisp', 'king']) {
      await api.eval(`__fmDebug.portrait(${JSON.stringify(name)})`);
      await sleep(500);
      await api.shot('portrait-' + name);
      await api.eval('__fmDebug.portraitOff()');
      await sleep(150);
    }
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
  if (which === 'all' || which === 'flow') await suiteFlow(base);
  if (which === 'all' || which === 'kbd') await suiteKbd(base);
  if (which === 'all' || which === 'touch') await suiteTouch(base);
  if (which === 'all' || which === 'perf') await suitePerf(base);
} finally {
  srv.close();
}
console.log(`\n${failures === 0 ? 'ALL GATES GREEN' : failures + ' FAILURE(S)'}  (${((Date.now() - t0) / 60000).toFixed(1)} min)`);
process.exit(failures ? 1 : 0);
