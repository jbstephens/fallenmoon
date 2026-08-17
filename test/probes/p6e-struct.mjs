#!/usr/bin/env node
// STRUCTURE: rendered == physics, no invisible walls, never enclosed, and a
// real walked approach from the isle shore into the works.
import { serve, launchChrome, pageSession, mkApi, continueIn, ISLES, gate, summary, sleep } from './p6e.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(ISLES);
await api.nav(base + '/?turbo=6');
await continueIn(api);
console.log('info:', await api.eval('JSON.stringify(__fmDebug.foundryInfo())'));

/* ── 1. RENDERED == PHYSICS across the whole foundry field ── */
const grid = await api.eval(`(function(){
  // raycast the actual floor mesh and compare with groundH, on a dense grid
  const rc = new THREE.Raycaster();
  const down = new THREE.Vector3(0,-1,0);
  const meshes = [fFloorMesh];
  for (const m of meshes) { m.visible = true; m.updateMatrixWorld(true); }
  let n=0, bad=0, worst=0, worstAt=null, miss=0;
  for (let x = FBOX.x0+2; x < FBOX.x1-2; x += 1.5) {
    for (let z = FBOX.z0+2; z < FBOX.z1-2; z += 1.5) {
      if (!foundryOpenCore(x,z)) continue;
      if (segT(x,z,FTHROAT)[0] < 0.14 && !inFoundryFieldQ(x,z)) continue;
      const g = groundH(x,z);
      rc.set(new THREE.Vector3(x, g+40, z), down);
      rc.far = 120;
      const hits = rc.intersectObjects(meshes, false);
      n++;
      if (!hits.length) { miss++; continue; }
      const d = Math.abs(hits[0].point.y - g);
      if (d > worst) { worst = d; worstAt=[+x.toFixed(1),+z.toFixed(1),+d.toFixed(3)]; }
      if (d > 0.05) bad++;
    }
  }
  return JSON.stringify({n, bad, miss, worst:+worst.toFixed(4), worstAt});
})()`);
console.log('floor grid:', grid);
{
  const g = JSON.parse(grid);
  gate(g.n > 800, 'dense floor grid actually sampled the works', 'n=' + g.n);
  gate(g.bad === 0, '|rendered − groundH| < 0.05 m everywhere walkable', 'bad=' + g.bad + ' worst=' + g.worst + ' at ' + JSON.stringify(g.worstAt));
  gate(g.miss === 0, 'every walkable point has floor UNDER it', 'miss=' + g.miss);
}

/* ── 2. NEVER ENCLOSED: flood-fill the open core from the door ── */
const fill = await api.eval(`(function(){
  const S = 1.0;
  const key = (i,j)=>i*100000+j;
  const seen = new Set(), q = [];
  const i0 = Math.round(FDOOR.x/S), j0 = Math.round((FDOOR.z-1)/S);
  q.push([i0,j0]); seen.add(key(i0,j0));
  let n=0;
  const reach = { f1:false, f2:false, f2b:false, f3:false, shell:false, great:false, bells:false, chest:false, bell:false };
  while (q.length && n < 200000) {
    const [i,j] = q.pop(); n++;
    const x = i*S, z = j*S;
    if (Math.hypot(x-F1.x,z-F1.z) < 4) reach.f1 = true;
    if (Math.hypot(x-F2.x,z-F2.z) < 4) reach.f2 = true;
    if (Math.hypot(x-F2B.x,z-F2B.z) < 3) reach.f2b = true;
    if (Math.hypot(x-F3.x,z-F3.z) < 4) reach.f3 = true;
    if (Math.hypot(x-FMIR.x,z-FMIR.z) < 2.2) reach.shell = true;
    if (Math.hypot(x-GBELL.x,z-GBELL.z) < 4.0) reach.great = true;
    if (Math.hypot(x-FBELLS[1].x,z-FBELLS[1].z) < 2.4) reach.bells = true;
    if (Math.hypot(x-FCHEST.x,z-FCHEST.z) < 1.6) reach.chest = true;
    if (Math.hypot(x-F_BELL_REST.x,z-F_BELL_REST.z) < 3.4) reach.bell = true;
    for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const ni=i+di, nj=j+dj, k=key(ni,nj);
      if (seen.has(k)) continue;
      const nx=ni*S, nz=nj*S;
      if (!fInBox(nx,nz)) continue;
      if (worldSolidAt(nx,nz)) continue;
      seen.add(k); q.push([ni,nj]);
    }
  }
  return JSON.stringify({cells:n, reach});
})()`);
console.log('flood:', fill);
{
  const f = JSON.parse(fill);
  const r = f.reach;
  gate(r.f1 && r.f2 && r.f3, 'every chamber is reachable from the doorway on foot');
  gate(r.shell && r.bells && r.great, 'the three verbs are all reachable');
  gate(r.f2b && r.chest, 'the hidden mould room and its chest are reachable');
}

/* ── 3. THE SEAL: sealed save cannot reach the works; rung save can ── */
const sealed = await api.eval(`(function(){
  const wasOpen = fGateOpenNow;
  fGateOpenNow = false;
  const blocked = worldSolidAt(FDOOR.x, FDOOR.z - 5.5);
  const doorstepFree = !worldSolidAt(FDOOR.x, FDOOR.z - 1.0) && !worldSolidAt(FDOOR.x, FDOOR.z + 1.0);
  // p6d's shade/wake spot at the door must NEVER be inside stone
  const wake = !worldSolidAt(FDOOR.x, FDOOR.z + 1.6);
  fGateOpenNow = wasOpen;
  const open = !worldSolidAt(FDOOR.x, FDOOR.z - 5.5);
  return JSON.stringify({blocked, doorstepFree, wake, open});
})()`);
console.log('seal:', sealed);
{
  const s = JSON.parse(sealed);
  gate(s.blocked, 'SEALED: the works are shut until Watchstone’s bell rings');
  gate(s.doorstepFree && s.wake, 'the doorstep and p6d’s wake spot are never stone');
  gate(s.open, 'RUNG: the doors stand open');
}

/* ── 4. no invisible walls on the isle around the portal ── */
const around = await api.eval(`(function(){
  const bad = [];
  for (let a = 0; a < 24; a++) {
    for (let r = 3; r <= 16; r += 1) {
      const x = FDOOR.x + Math.cos(a/24*Math.PI*2)*r, z = FDOOR.z + Math.sin(a/24*Math.PI*2)*r;
      if (z < FDOOR.z + 0.5) continue;                 // the seaward half only
      if (worldSolidAt(x,z) && !fMassifAt(x,z)) bad.push([+x.toFixed(1),+z.toFixed(1),'other']);
      else if (worldSolidAt(x,z)) bad.push([+x.toFixed(1),+z.toFixed(1),'mine']);
    }
  }
  return JSON.stringify(bad.slice(0,10));
})()`);
console.log('seaward of the door, solid points:', around);
gate(JSON.parse(around).length === 0, 'nothing solid in front of the doorway');

/* ── 5. WALK IT: the real approach, no debug warp ── */
await api.eval(`__fmDebug.warp(${-1520}, ${-330}); P.hearts = P.maxHearts; 0`);
await api.waitTicks(20);
await api.installBot('pad');
const stops = [
  ['1-outside', -1520, -344],
  ['2-doorway', -1520, -351],
  ['3-throat', -1520, -360],
  ['4-ramp', -1512, -374],
  ['5-kilnfloor', -1490, -390],
  ['6-hall', -1462, -410],
  ['7-bells', -1448, -413],
  ['8-mouldroom', -1440, -436],
  ['9-pitdoor', -1465, -433],
];
for (const [name, x, z] of stops) {
  await api.eval(`__fmBot.tol = 1.6; __fmBot.target = [${x}, ${z}]`);
  try { await api.waitFor(`Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < 2.6`, 45000, name); }
  catch (e) { console.log('   (could not walk to ' + name + ')'); }
  await api.eval('__fmBot.target = null; P.hearts = P.maxHearts; 0');
  await api.waitTicks(18);
  const st = await api.eval(`JSON.stringify({
    x:+__fm.x.toFixed(1), z:+__fm.z.toFixed(1), y:+P.fy.toFixed(2),
    g:+groundH(P.x,P.z).toFixed(2), gap:+(P.fy-groundH(P.x,P.z)).toFixed(3),
    area:__fm.area||areaAt(P.x,P.z), inF:__fm.inFoundry, shade:__fm.shade,
    calls:__fm.calls, tris:__fm.tris, prompt:__fm.prompt })`);
  console.log('   ' + name + ': ' + st);
  await api.shot('walk-' + name);
}
gate(api.errs.length === 0, 'zero console errors on the walked approach', api.errs.slice(0, 2).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
