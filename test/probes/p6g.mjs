#!/usr/bin/env node
// p6e — Phase 3 part two verification probe (Foundry / Hour Tortoise / the sun).
// Standalone CDP harness: real input, real player path, screenshots.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const GAME = '/Users/johnstephens/Developer/stephensgames/fallenmoon';
const SHOTS = path.join(DIR, 'shots-p6g');
fs.mkdirSync(SHOTS, { recursive: true });
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const CONTROLLER_JS = fs.readFileSync('/Users/johnstephens/Developer/stephensgames/gameconsole/lib/controller.js', 'utf8');
const HARNESS_SRC = fs.readFileSync(path.join(GAME, 'test', 'harness.mjs'), 'utf8');
const BOT_SRC = HARNESS_SRC.match(/const BOT_SRC = `([\s\S]*?)`;\n/)[1];
const sleep = ms => new Promise(r => setTimeout(r, ms));

const FAMILY_Q4 = JSON.parse(fs.readFileSync(path.join(GAME, 'test', 'fixtures', 'family-q4-save.json'), 'utf8'));
/* a save the morning after phase three: the sun moves, the Crown is
   sealed, and nothing of phase four has happened yet */
export const P4_START = {
  ...FAMILY_Q4,
  q: 12, ph: 3, sky: 3, mh: 7,
  basinOpen: true, glyph1: true, glyph2: true, wyrmDone: true, floodSeen: true,
  voyageDone: true, sailedOnce: true, keelFound: true, boatRefit: true,
  moonSeen: true, isleLandfall: true, watchBell: true, tortoiseDone: true,
  fGlyph1: true, fGlyph2: true, fGlyph3: true, sunArc: true,
  tbc2Seen: true, tbc3Seen: true, wardenTalked: 2,
  region: 'forest', lastPos: [1100, 806], lastShade: [1868, 1122], lastSpring: 5,
  crownGlint: false, stairOpen: false, organ1: false, organ2: false, organ3: false,
  crownSeen: false, beaconHeart: false, crownChest1: false, crownChest2: false,
  stagDone: false,
};
/* the crack answered, the organ untouched */
export const P4_STAIR = { ...P4_START, q: 14, crownGlint: true, stairOpen: true };
/* the stair sung, standing on the Crown */
export const P4_CROWN = { ...P4_STAIR, q: 15, organ1: true, organ2: true, organ3: true, crownSeen: true,
  lastPos: [2066, 1342] };

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
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'fm-p6g-'));
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

/* minimal PNG decode, so a gate can look at PIXELS and not at a flag
   (lifted from harness.mjs, which is not a module) */
export function decodePNG(buf) {
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
    /* count magenta (void) pixels in a box — the skyProbe gate's eye */
    async magenta(box, saveAs) {
      const r = await c.send('Page.captureScreenshot', { format: 'png' });
      const png = decodePNG(Buffer.from(r.data, 'base64'));
      const [x0, y0, x1, y1] = box || [90, 10, 1190, 700];
      let n = 0;
      for (let y = y0; y < y1; y += 2) {
        for (let x = x0; x < x1; x += 2) {
          const i = (y * png.w + x) * png.bpp;
          if (png.px[i] > 210 && png.px[i + 2] > 210 && png.px[i + 1] < 70) n++;
        }
      }
      if (saveAs && n > 0) fs.writeFileSync(path.join(SHOTS, saveAs + '.png'), Buffer.from(r.data, 'base64'));
      return n;
    },
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
