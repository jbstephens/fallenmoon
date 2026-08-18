#!/usr/bin/env node
/* STRUCTURE. Am I inside the geometry? Is the way visibly open? Is there
   sky over my head where a mountain should be? Is there a hole in the
   world at the edge of the garden? Every question asked of the real
   meshes and the real pixels, never of a flag. */
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_START, P4_STAIR, P4_CROWN,
         gate, summary, sleep } from './p6g.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave(P4_CROWN);
await api.nav(base + '/?turbo=6');
await continueIn(api);
const jget = async (e) => JSON.parse(await api.eval(`JSON.stringify(${e})`));

/* ── 1. RENDERED == PHYSICS, both sheets ── */
const stairGrid = await jget(`(function(){
  stairMode = true;
  const rc = new THREE.Raycaster(), down = new THREE.Vector3(0,-1,0);
  stairFloorMesh.visible = true; stairFloorMesh.updateMatrixWorld(true);
  let n=0, bad=0, miss=0, worst=0, at=null;
  for (let x = SBOX.x0; x < SBOX.x1; x += 1.5) {
    for (let z = SBOX.z0; z < SBOX.z1; z += 1.5) {
      if (!stairOpenCore(x,z)) continue;
      const g = groundH(x,z);
      rc.set(new THREE.Vector3(x, g+30, z), down); rc.far = 90;
      const h = rc.intersectObject(stairFloorMesh, false);
      n++;
      if (!h.length) { miss++; continue; }
      const d = Math.abs(h[0].point.y - g);
      if (d > worst) { worst = d; at = [+x.toFixed(1), +z.toFixed(1), +d.toFixed(3)]; }
      if (d > 0.05) bad++;
    }
  }
  return {n, bad, miss, worst:+worst.toFixed(4), at};
})()`);
console.log('stair floor grid:', JSON.stringify(stairGrid));
gate(stairGrid.n > 700, 'the stair grid actually sampled the stair', 'n=' + stairGrid.n);
gate(stairGrid.bad === 0, 'STAIR: |rendered − groundH| < 0.05 m on every walkable point',
  'bad=' + stairGrid.bad + ' worst=' + stairGrid.worst + ' at ' + JSON.stringify(stairGrid.at));
gate(stairGrid.miss === 0, 'STAIR: every walkable point has floor under it', 'miss=' + stairGrid.miss);

const crownGrid = await jget(`(function(){
  stairMode = false;
  const rc = new THREE.Raycaster(), down = new THREE.Vector3(0,-1,0);
  crownFloorMesh.visible = true; crownFloorMesh.updateMatrixWorld(true);
  let n=0, bad=0, miss=0, worst=0, at=null; const missAt = [];
  for (let x = KBOX.x0; x < KBOX.x1; x += 1.5) {
    for (let z = KBOX.z0; z < KBOX.z1; z += 1.5) {
      if (!inGardenWalkQ(x,z)) continue;
      const g = groundH(x,z);
      rc.set(new THREE.Vector3(x, g+40, z), down); rc.far = 120;
      const h = rc.intersectObject(crownFloorMesh, false);
      n++;
      if (!h.length) { miss++; if (missAt.length < 8) missAt.push([x, z]); continue; }
      const d = Math.abs(h[0].point.y - g);
      if (d > worst) { worst = d; at = [+x.toFixed(1), +z.toFixed(1), +d.toFixed(3)]; }
      if (d > 0.05) bad++;
    }
  }
  return {n, bad, miss, missAt, worst:+worst.toFixed(4), at};
})()`);
console.log('crown floor grid:', JSON.stringify(crownGrid));
gate(crownGrid.n > 3000, 'the Crown grid actually sampled the garden', 'n=' + crownGrid.n);
gate(crownGrid.bad === 0, 'CROWN: |rendered − groundH| < 0.05 m on every walkable point',
  'bad=' + crownGrid.bad + ' worst=' + crownGrid.worst + ' at ' + JSON.stringify(crownGrid.at));
gate(crownGrid.miss === 0, 'CROWN: every walkable point has ground under it', 'miss=' + crownGrid.miss + ' at ' + JSON.stringify(crownGrid.missAt));

/* the Crown's surface may never sit BELOW the forest's own — that is the
   invariant that keeps p6b's mountain from erupting through the garden */
const overForest = await jget(`(function(){
  let bad = 0, worst = 9, at = null;
  for (let x = KBOX.x0; x < KBOX.x1; x += 2) for (let z = KBOX.z0; z < KBOX.z1; z += 2) {
    if (!inGardenWalkQ(x,z)) continue;
    const d = crownHMesh(x,z) - forestHMesh(x,z);
    if (d < worst) { worst = d; at = [x, z, +d.toFixed(2)]; }
    if (d < 0) bad++;
  }
  return { bad, worst:+worst.toFixed(2), at };
})()`);
gate(overForest.bad === 0, 'the garden floor is never under the mountain that carries it',
  'worst clearance ' + overForest.worst + 'm at ' + JSON.stringify(overForest.at));

/* the stair's cap must stay UNDER the mountain's skin, or it shows as a
   black slab on the mountainside */
const capUnder = await jget(`(function(){
  let bad = 0, worst = 99, at = null;
  for (const l of S_LEGS) {
    for (let t = 0.02; t < 0.99; t += 0.02) {
      const x = lerp(l.ax, l.bx, t), z = lerp(l.az, l.bz, t);
      if (stairThroatQ(x, z)) continue;
      const cap = stairCeilY(x, z) + 0.5;
      const skin = stairSkinY(x, z);
      const cl = skin - cap;
      if (cl < worst) { worst = cl; at = [+x.toFixed(0), +z.toFixed(0), +cl.toFixed(1)]; }
      if (cl < 0) bad++;
    }
  }
  return { bad, worst:+worst.toFixed(2), at };
})()`);
console.log('cap under the skin:', JSON.stringify(capUnder));
gate(capUnder.bad === 0, 'the stair never surfaces: its cap stays under the mountain', JSON.stringify(capUnder));

/* ── 2. NO SKY FROM INSIDE (the foundry law), in PIXELS ── */
await api.eval('__fmDebug.skyProbe(true); 0');
for (const [name, warp, yaw, pitch] of [
  ['mouth', '__fmDebug.warpStair(0)', 0.85, -0.4],
  ['l1-up', '__fmDebug.warpStair(1)', 0.85, -0.43],
  ['l2-up', '__fmDebug.warpStair(2)', 2.4, -0.43],
  ['l3-up', '__fmDebug.warpStair(3)', 4.1, -0.43],
  ['top-up', '__fmDebug.warpStair(4)', 5.6, -0.43],
]) {
  await api.eval(warp); await api.waitTicks(20);
  let worst = 0;
  for (let a = 0; a < 8; a++) {
    await api.eval(`__fmDebug.camYaw(${(yaw + a * 0.785).toFixed(3)}); __fmDebug.camPitch(${pitch}); CAM.ready = false; 0`);
    await api.waitTicks(6); await sleep(120);
    const m = await api.magenta([120, 20, 1160, 400], 'struct-FAIL-sky-' + name + '-' + a);
    worst = Math.max(worst, m);
  }
  gate(worst <= 4, 'NO SKY overhead inside the stair at ' + name, worst + ' void px');
}
await api.eval('__fmDebug.skyProbe(false); 0');

/* ── 3. no hole in the world at the garden's edge ──
   cast from each pad WITH THE PLAYER STANDING ON IT: what the world draws
   depends on where the player is, so a ray cast from somewhere the player
   is not proves nothing about what they would see. ── */
const holes = [];
for (const pad of ['ledge', 'saddle', 't1', 't2', 't3', 'beacon', 'east', 'shrine']) {
  await api.eval(`__fmDebug.warpCrown(${JSON.stringify(pad)}); 0`);
  await api.waitTicks(24);
  const r = await jget(`(function(){
    const rc = new THREE.Raycaster();
    const objs = [];
    scene.traverse(o => { if (o.isMesh && o !== skyDome && o !== crownVista && o.visible) objs.push(o); });
    const eye = new THREE.Vector3(P.x, P.fy + 1.7, P.z);
    const miss = [];
    for (let a = 0; a < 24; a++) {
      const ang = a / 24 * Math.PI * 2;
      const dirx = Math.cos(ang), dirz = Math.sin(ang);
      /* the ledge's window arc is SUPPOSED to see a thousand metres of world */
      if (crownRimK(P.x + dirx * 24, P.z + dirz * 24) < 0.4) continue;
      const d = new THREE.Vector3(dirx, -0.14, dirz).normalize();
      rc.set(eye, d); rc.far = 1000;
      if (!rc.intersectObjects(objs, false).length) miss.push((ang * 57.3).toFixed(0));
    }
    return { objs: objs.length, miss };
  })()`);
  console.log('  ' + pad + ': ' + (r.miss.length ? 'SKY at ' + r.miss.join(',') : 'closed') + ' (' + r.objs + ' meshes)');
  holes.push([pad, r.miss.length]);
}
gate(holes.every(h => h[1] === 0), 'the rim closes the garden: no downward view into the void',
  JSON.stringify(holes.filter(h => h[1] > 0)));

/* ── 4. the ways in and out, both directions ── */
const doors = await jget(`(function(){
  const m = S_NODE.mouth;
  const was = stairInOpen, wasOrgan = organOpen.slice();
  stairInOpen = false;
  const shut = worldSolidAt(m.x, m.z);
  stairInOpen = true;
  const open = worldSolidAt(m.x, m.z);
  stairInOpen = was;
  /* the landing doors, shut */
  organOpen[0] = organOpen[1] = organOpen[2] = false;
  stairMode = true;
  const dShut = S_DOORS.map(d => worldSolidAt(d.x, d.z));
  organOpen[0] = organOpen[1] = organOpen[2] = true;
  const dOpen = S_DOORS.map(d => worldSolidAt(d.x, d.z));
  organOpen[0] = wasOrgan[0]; organOpen[1] = wasOrgan[1]; organOpen[2] = wasOrgan[2];
  return { shut, open, dShut, dOpen };
})()`);
gate(doors.shut === true && doors.open === false, 'THE CRACK: solid stone until the gold light is followed');
gate(doors.dShut.every(v => v) && doors.dOpen.every(v => !v), 'the three landing doors are solid when shut');

/* the stair is the ONLY way up: flood-fill from the forest below */
const fill = await jget(`(function(){
  stairMode = false;
  const S = 2.5, key = (i,j) => i * 100000 + j;
  const seen = new Set(), q = [];
  const start = [2160, 1290];       // the mountain flank, well outside the Crown
  const i0 = Math.round(start[0]/S), j0 = Math.round(start[1]/S);
  q.push([i0,j0]); seen.add(key(i0,j0));
  let n = 0, reachedGarden = false;
  while (q.length && n < 120000) {
    const [i,j] = q.pop(); n++;
    const x = i*S, z = j*S;
    if (inGardenWalkQ(x,z)) reachedGarden = true;
    for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const ni=i+di, nj=j+dj, k=key(ni,nj);
      if (seen.has(k)) continue;
      const nx=ni*S, nz=nj*S;
      if (nx < 1700 || nx > KROWN.x1 || nz < 900 || nz > KROWN.z1) continue;
      if (worldSolidAt(nx,nz)) continue;
      seen.add(k); q.push([ni,nj]);
    }
  }
  return { cells: n, reachedGarden };
})()`);
console.log('flood from below:', JSON.stringify(fill));
gate(fill.reachedGarden === false, 'THE CROWN IS SEALED: no way onto the garden from the mountain', JSON.stringify(fill));

/* and the whole stair IS connected, door to door, once it sings */
const climb = await jget(`(function(){
  stairMode = true;
  const S = 1.0, key = (i,j) => i * 100000 + j;
  const seen = new Set(), q = [];
  const m = S_NODE.mouth;
  const i0 = Math.round(m.x/S), j0 = Math.round(m.z/S);
  q.push([i0,j0]); seen.add(key(i0,j0));
  let n = 0;
  const reach = { l1:false, l2:false, l3:false, out:false };
  while (q.length && n < 200000) {
    const [i,j] = q.pop(); n++;
    const x = i*S, z = j*S;
    for (const id of ['l1','l2','l3','out']) {
      const nd = S_NODE[id];
      if (Math.hypot(x-nd.x, z-nd.z) < 2.5) reach[id] = true;
    }
    for (const [di,dj] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const ni=i+di, nj=j+dj, k=key(ni,nj);
      if (seen.has(k)) continue;
      const nx=ni*S, nz=nj*S;
      if (nx < SBOX.x0 || nx > SBOX.x1 || nz < SBOX.z0 || nz > SBOX.z1) continue;
      if (worldSolidAt(nx,nz)) continue;
      seen.add(k); q.push([ni,nj]);
    }
  }
  stairMode = false;
  return { cells: n, reach };
})()`);
console.log('climb reachability (organ sung):', JSON.stringify(climb));
gate(climb.reach.l1 && climb.reach.l2 && climb.reach.l3 && climb.reach.out,
  'with the organ sung, every landing and the exit are reachable from the crack', JSON.stringify(climb.reach));

/* ── 5. the fawns are SUN creatures ── */
const fawnSun = await jget(`FAWN_SPOTS.map(p => [p[0], p[1], inShadeAt(p[0], p[1]), inGardenWalkQ(p[0],p[1])])`);
console.log('fawn spawns:', JSON.stringify(fawnSun));
gate(fawnSun.every(f => f[2] === false), 'every ember fawn spawns in OPEN SUN (the shade-fizzle law)',
  JSON.stringify(fawnSun.filter(f => f[2])));
gate(fawnSun.every(f => f[3] === true), 'and every one of them stands on walkable ground');

/* the arena is survivable: real shade under the orchard, and enough of it */
const shadeFrac = await jget(`(function(){
  let n = 0, sh = 0;
  for (let x = K_ARENA.x - K_ARENA.r; x < K_ARENA.x + K_ARENA.r; x += 1.5) {
    for (let z = K_ARENA.z - K_ARENA.r; z < K_ARENA.z + K_ARENA.r; z += 1.5) {
      if (!inGardenWalkQ(x,z)) continue;
      n++; if (inShadeAt(x,z)) sh++;
    }
  }
  return { n, sh, frac: +(sh / n).toFixed(3) };
})()`);
console.log('arena shade:', JSON.stringify(shadeFrac));
gate(shadeFrac.frac > 0.2 && shadeFrac.frac < 0.75,
  'the Stag arena is a third shade: the swelter bites, and it never traps you', 'frac=' + shadeFrac.frac);

/* ── 6. the sun-arc safety rail holds over the Crown too ── */
const rail = await jget(`(function(){
  const spots = K_SHADE.map(s => [s.x, s.z]).concat(K_BOUGHS.map(b => [b.x, b.z]));
  let worst = null, checked = 0;
  for (let i = 0; i <= 20; i++) {
    __fmDebug.sunSet(i / 20);
    for (const s of spots) { checked++; if (!inShadeAt(s[0], s[1])) worst = [i/20, s]; }
  }
  return { checked, worst };
})()`);
gate(rail.worst === null, 'SAFETY RAIL: every Crown sanctuary stays shade at all 21 sun angles',
  rail.checked + ' checks');

/* ── 7. the world below is untouched where it should be ── */
const forestSame = await jget(`(function(){
  let bad = 0, worst = 0, at = null;
  for (let x = 1200; x < 2170; x += 37) for (let z = 200; z < 1390; z += 37) {
    if (inCrownFieldQ(x,z) || inStairFieldQ(x,z) || inHollowFieldQ(x,z)) continue;
    const d = Math.abs(groundH(x,z) - forestHMesh(x,z));
    if (d > worst) { worst = d; at = [x,z,+d.toFixed(3)]; }
    if (d > 0.001) bad++;
  }
  return { bad, worst, at };
})()`);
gate(forestSame.bad === 0, 'the Parched Forest answers exactly as it always did outside the Crown',
  JSON.stringify(forestSame));
gate(api.errs.length === 0, 'zero console errors through the structure sweep', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
