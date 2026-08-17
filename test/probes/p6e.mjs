#!/usr/bin/env node
// p6e — Phase 3 part two verification probe (Foundry / Hour Tortoise / the sun).
// Standalone CDP harness: real input, real player path, screenshots.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const GAME = '/Users/johnstephens/Developer/stephensgames/fallenmoon';
const SHOTS = path.join(DIR, 'shots-p6e');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CONTROLLER_JS = fs.readFileSync('/Users/johnstephens/Developer/stephensgames/gameconsole/lib/controller.js', 'utf8');
const HARNESS_SRC = fs.readFileSync(path.join(GAME, 'test', 'harness.mjs'), 'utf8');
const BOT_SRC = HARNESS_SRC.match(/const BOT_SRC = `([\s\S]*?)`;\n/)[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FAMILY_Q4 = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'family-q4-save.json'), 'utf8'));
export const FLOODED = {
  ...FAMILY_Q4, basinOpen: true, glyph1: true, glyph2: true, wyrmDone: true,
  q: 6, ph: 2, sky: 2, floodSeen: true, voyageDone: true, sailedOnce: true,
  region: 'bay', lastShade: [4, -2],
};
// a phase-3 save at the isles, watch bell rung, foundry open
export const ISLES = {
  ...FLOODED, q: 10, keelFound: true, keelCarried: false, boatRefit: true,
  moonSeen: true, isleLandfall: true, watchBell: true, tbc2Seen: true,
};

let pass = 0, fail = 0;
export function gate(ok, label, extra) {
  if (ok) { pass++; console.log('PASS  ' + label + (extra ? '  — ' + extra : '')); }
  else { fail++; console.log('FAIL  ' + label + (extra ? '  — ' + extra : '')); }
  return ok;
}
export function summary() {
  console.log(`\n${pass} passed, ${fail} failed`);
  return fail;
}

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-p6e-'));
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
    const errs = [];
    ws.onopen = () => resolve({
      errs,
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
        errs.push(m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text || '?');
      }
      if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
        errs.push(m.params.args.map(a => a.value || a.description || '').join(' '));
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

export function mkApi(c) {
  const api = {
    errs: c.errs,
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
    async seedSeen(ids) {
      await c.send('Page.addScriptToEvaluateOnNewDocument', {
        source: ids.map(i => `try{localStorage.setItem('fm_seen_${i}','1');}catch(e){}`).join(''),
      });
    },
    async nav(url) { await c.send('Page.navigate', { url }); await sleep(6500); },
    async eval(expr) {
      const r = await c.send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
      if (r.exceptionDetails) throw new Error(expr.slice(0, 100) + ' → ' + JSON.stringify(r.exceptionDetails.exception?.description || r.exceptionDetails.text));
      return r.result.value;
    },
    async waitFor(expr, timeout = 25000, label = expr) {
      const t0 = Date.now();
      while (Date.now() - t0 < timeout) {
        try { if (await api.eval(expr)) return true; } catch (e) {}
        await sleep(110);
      }
      throw new Error('timeout waiting for ' + label);
    },
    async waitTicks(n) {
      const t = await api.eval('__fm.tick');
      await api.waitFor(`__fm.tick > ${t + n}`, 40000, `${n} ticks`);
    },
    async tap(...idx) {
      await api.eval(`__fakePad.press(${idx.join(',')})`); await sleep(300);
      await api.eval('__fakePad.press()'); await sleep(220);
    },
    async hold(ms, ...idx) {
      await api.eval(`__fakePad.press(${idx.join(',')})`);
      await sleep(ms);
      await api.eval('__fakePad.press()');
    },
    async shot(name) {
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
      console.log('   shot → ' + path.join(SHOTS, name + '.png'));
    },
    async installBot(mode) { await api.eval(BOT_SRC.replace(/\$\{mode\}/g, mode)); },
  };
  return api;
}
export async function tapUntil(api, fn, cond, tries, label) {
  for (let i = 0; i < tries; i++) {
    try { if (await api.eval(cond)) return true; } catch (e) {}
    await fn(); await sleep(150);
  }
  if (await api.eval(cond)) return true;
  throw new Error('tapUntil failed: ' + label);
}
export async function continueIn(api) {
  await api.waitFor(`typeof __fm !== "undefined" && __fm.state === "title"`, 60000, "title");
  await tapUntil(api, () => api.tap(13), "__fm.titleFocus === 1", 14, "focus CONTINUE");
  await tapUntil(api, () => api.tap(0), `__fm.state !== "title"`, 16, "leave title");
  for (let i = 0; i < 40; i++) {
    const st = await api.eval("__fm.state");
    if (st === "play") { await api.waitTicks(20); return; }
    if (st === "cine" || st === "dialog" || st === "tbc") { await api.tap(0); }
    if (st === "title") { await api.tap(0); }
    await sleep(400);
  }
  throw new Error("never reached play; state=" + await api.eval("__fm.state"));
}
export { serve, launchChrome, pageSession, sleep, SHOTS, GAME };
