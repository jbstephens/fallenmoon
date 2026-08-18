#!/usr/bin/env node
// draw-call census: what is actually being drawn, on the Crown and in the stair.
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_CROWN, gate, summary } from './p6g.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(P4_CROWN);
await api.nav(base + '/?turbo=6');
await continueIn(api);

const CENSUS = `(function(){
  const named = new Map();
  const tag = (o) => {
    for (const [k, v] of Object.entries(window.__names || {})) if (v === o) return k;
    return null;
  };
  const out = [];
  scene.traverse(o => {
    if (!o.isMesh) return;
    let vis = true, p = o;
    while (p) { if (!p.visible) { vis = false; break; } p = p.parent; }
    if (!vis) return;
    const g = o.geometry;
    const n = g && g.attributes.position ? g.attributes.position.count / 3 : 0;
    out.push([tag(o) || (o.material && o.material.type) || '?', Math.round(n)]);
  });
  const by = {};
  for (const [k, n] of out) { by[k] = by[k] || [0, 0]; by[k][0]++; by[k][1] += n; }
  return JSON.stringify({ meshes: out.length, tris: out.reduce((a, b) => a + b[1], 0), by });
})()`;

async function look(name, setup) {
  await api.eval(setup);
  await api.waitTicks(30);
  const r = await api.eval(CENSUS);
  const t = await api.eval('JSON.stringify({calls:__fm.calls, tris:__fm.tris, x:+__fm.x.toFixed(0), z:+__fm.z.toFixed(0), y:+P.fy.toFixed(1)})');
  console.log('\n== ' + name + ' ==', t);
  console.log(r);
}
await api.eval(`window.__names = { crownFloor: crownFloorMesh, crownProps: crownPropMesh, crownGlow: crownGlowMesh,
  vista: crownVista, stairFloor: stairFloorMesh, stairWall: stairWallMesh, stairCap: stairCapMesh,
  stairProps: stairPropMesh, stairDress: stairDressMesh, stairGlow: stairMouthGlow, glint: glintMount }; 0`);
await look('ledge', '__fmDebug.warpCrown("ledge")');
await look('terrace t2', '__fmDebug.warpCrown("t2")');
await look('plinth', '__fmDebug.warpCrown("plinth")');
await look('L1', '__fmDebug.warpStair(1)');
await look('L3', '__fmDebug.warpStair(3)');
c.close(); proc.kill(); srv.close();
process.exit(summary());
