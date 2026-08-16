#!/usr/bin/env node
// Standalone live-repro probe for the Parched Forest field failures.
// NOT a gate suite — a diagnosis tool. Reuses the harness's Chrome plumbing.
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

const FOREST_SAVE = {
  v: 2, q: 0, ph: 0, mh: 6, sword: true, salt: 0,
  talked: { finn: 0, tock: 0, pearl: 0 },
  kelpDoor: false, doorChest: false, finnHeart: true, wreckChest: false,
  wallBurned: false, bossDone: false, sky: 0, tidepool: false,
  compassSeen: true, forestSeen: true, swelterSeen: false,
  region: 'forest', lastSpring: -1, lastShade: [243, 57],
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

const { srv, port: httpPort } = await serve();
const { proc, port } = await launchChrome();
const c = await pageSession(port);
await c.send('Page.enable'); await c.send('Runtime.enable');
c.ws.onmessage_orig = c.ws.onmessage;
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

try {
  await c.send('Page.navigate', { url: `http://127.0.0.1:${httpPort}/?turbo=2` });
  await waitFor('!!window.__fm', 30000, 'telemetry');
  await waitFor(`__fm.state === 'title'`, 25000, 'title');
  // title → CONTINUE
  await evl('__fakePad.press(13)'); await sleep(250); await evl('__fakePad.press()'); await sleep(250);
  await evl('__fakePad.press(0)'); await sleep(250); await evl('__fakePad.press()');
  await waitFor(`__fm.state === 'play'`, 30000, 'play');

  // in-page probe helpers: far-tier analytic height + renderer-state census
  await evl(`window.__probe = {
    // exact replica of buildFarTier's forest quad geometry → surface height at (x,z)
    farH(x, z) {
      const quads = [[170,1175,-38,680],[1175,2180,-38,680],[170,1175,680,1398],[1175,2180,680,1398]];
      const S = 40;
      for (const [qx0,qx1,qz0,qz1] of quads) {
        if (x < qx0 || x >= Math.floor((qx1-1-qx0)/S)*S+qx0+S || z < qz0 || x >= qx1) continue;
        if (x >= qx0 && x < qx1-1 && z >= qz0 && z < qz1-1) {
          const cx = qx0 + Math.floor((x-qx0)/S)*S, cz = qz0 + Math.floor((z-qz0)/S)*S;
          const y00 = forestH(cx,cz)-0.6, y01 = forestH(cx,cz+S)-0.6,
                y11 = forestH(cx+S,cz+S)-0.6, y10 = forestH(cx+S,cz)-0.6;
          // tris: [p0,p1,p2] and [p0,p2,p3] with p0=(cx,cz) p1=(cx,cz+S) p2=(cx+S,cz+S) p3=(cx+S,cz)
          const u = (x-cx)/S, v = (z-cz)/S;
          if (v >= u) return y00 + (y01-y00)*v + (y11-y01)*u;   // tri p0,p1,p2
          return y00 + (y11-y10)*v + (y10-y00)*u;               // tri p0,p2,p3
        }
      }
      return null;
    },
    census() {
      const cc = camera.position;
      let nearUnder = null, minD = 1e9;
      for (const ch of fchunkMap.values()) {
        const d = Math.hypot(ch.cx - __fm.x, ch.cz - __fm.z);
        if (d < minD) { minD = d; nearUnder = ch; }
      }
      const farVis = farTier.filter(m => m.visible).length;
      return {
        px: P.x, pz: P.z, py: P.fy, gH: groundH(P.x, P.z),
        camx: cc.x, camz: cc.z,
        nearVis: nearUnder ? nearUnder.mesh.visible : null,
        nearDist: minD,
        farVisCount: farVis, farTotal: farTier.length,
        farH: __probe.farH(P.x, P.z),
      };
    },
    // raycast straight down at (x,z) against visible far-tier meshes and the near chunk
    ray(x, z) {
      const rc = new THREE.Raycaster(new THREE.Vector3(x, 500, z), new THREE.Vector3(0, -1, 0));
      const farHits = rc.intersectObjects(farTier.filter(m => m.visible), false).map(h => 500 - h.distance);
      const nearMeshes = [...fchunkMap.values()].filter(ch => ch.mesh && ch.mesh.visible).map(ch => ch.mesh);
      const nearHits = rc.intersectObjects(nearMeshes, false).map(h => 500 - h.distance);
      return { farHits: farHits.slice(0, 4), nearTop: nearHits.length ? Math.max(...nearHits) : null, g: groundH(x, z) };
    },
  }; 'ok'`);

  const spots = [
    ['pass-mouth', 200, 44], ['pass-exit-river', 240, 58], ['midforest-A', 1580, 980],
    ['spring-3', 1050, 600], ['riverbed-mid', 1080, 556], ['john-spring', 1100, 700],
  ];
  for (const [tag, x, z] of spots) {
    await evl(`__fmDebug.warp(${x}, ${z}); P.hearts = P.maxHearts; swelterT = 0; 0`);
    await sleep(700);
    const cen = await evl('__probe.census()');
    const ray = await evl(`__probe.ray(${x}, ${z})`);
    console.log(tag, JSON.stringify(cen), 'ray:', JSON.stringify(ray));
    for (const yaw of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
      await evl(`__fmDebug.camYaw(${yaw}); __fmDebug.camPitch(0.38); 0`);
      await sleep(350);
      const r2 = await evl(`(function(){
        const cc = camera.position;
        // any visible far-tier face within 300m of camera? raycast a fan around the camera
        let closeFar = 0;
        const vis = farTier.filter(m => m.visible);
        for (let a = 0; a < 12; a++) {
          const dx = Math.cos(a/12*Math.PI*2), dz = Math.sin(a/12*Math.PI*2);
          const rc = new THREE.Raycaster(new THREE.Vector3(cc.x, cc.y, cc.z), new THREE.Vector3(dx, -0.12, dz).normalize(), 0, 300);
          if (rc.intersectObjects(vis, false).length) closeFar++;
        }
        return { closeFarRays: closeFar };
      })()`);
      if (yaw === 0) await shot(`probe-${tag}`);
      console.log('  yaw', yaw.toFixed(2), JSON.stringify(r2));
    }
  }

  // trunk color audit: find a pine near midforest-A and read its chunk colors near base
  const trunk = await evl(`(function(){
    let out = null;
    for (let ix = Math.floor(1540/9); ix <= Math.floor(1620/9) && !out; ix++)
      for (let iz = Math.floor(950/9); iz <= Math.floor(1010/9) && !out; iz++) {
        const t = treeInfo(ix, iz); if (t) out = t;
      }
    return out; })()`);
  console.log('sample tree:', JSON.stringify(trunk));
  if (trunk) {
    const cols = await evl(`(function(){
      const t = ${JSON.stringify(trunk)};
      const key = Math.floor(t.x/200) + 'f' + Math.floor(t.z/200);
      const ch = fchunkMap.get(key);
      const g = ch.mesh.geometry;
      const p = g.getAttribute('position'), col = g.getAttribute('color');
      const out = [];
      const gy = forestH(t.x, t.z) - 0.25;
      for (let i = 0; i < p.count; i++) {
        const dx = p.getX(i) - t.x, dz = p.getZ(i) - t.z, y = p.getY(i);
        if (dx*dx + dz*dz < 0.6 && y > gy + 0.3 && y < gy + t.h * 0.5) {
          out.push([col.getX(i), col.getY(i), col.getZ(i)]);
        }
      }
      return out.slice(0, 40); })()`);
    let blue = 0;
    for (const [r, g2, b] of cols) if (b > r) blue++;
    console.log(`trunk verts sampled=${cols.length} blue-dominant=${blue}`);
    console.log('sample colors:', JSON.stringify(cols.slice(0, 8)));
  }

  // close-up shot of trunks
  await evl(`__fmDebug.warp(${trunk ? trunk.x + 4 : 1584}, ${trunk ? trunk.z + 4 : 984}); 0`);
  await sleep(400);
  await evl(`__fmDebug.cam(${trunk.x + 5}, groundH(${trunk.x}, ${trunk.z}) + 1.6, ${trunk.z + 5}, ${trunk.x}, groundH(${trunk.x}, ${trunk.z}) + 2.2, ${trunk.z})`);
  await sleep(400);
  await shot('probe-trunk-closeup');
  await evl('__fmDebug.camOff(); 0');

  // jump apex reference shot (current pose)
  await evl(`__fmDebug.warp(900, 500); 0`);
  await sleep(300);
  await evl('__fakePad.axes(0, -1)');
  await sleep(500);
  await evl('__fakePad.press(0)');   // jump is south? check binding — just capture pose via P.air
  await sleep(120);
  const air = await evl('P.air');
  console.log('air after press(0):', air);
  await evl('__fakePad.press()'); await evl('__fakePad.axes(0,0)');
} catch (e) {
  console.error('PROBE FAIL:', e.message);
  await shot('probe-FAIL').catch(() => {});
} finally {
  c.close(); proc.kill(); srv.close();
}
