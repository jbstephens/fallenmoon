#!/usr/bin/env node
/* THE ASH STAG. The gate that matters is the same one the crab, the wyrm
   and the tortoise had to pass: a KID BOT that only ever walks at it and
   mashes ✕ must win the whole fight, all three phases — and the bot has
   to CHASE, because a stationary masher whiffs every time the guardian
   moves and then the run blames the boss for the bot. */
import { serve, launchChrome, pageSession, mkApi, continueIn, P4_CROWN, gate, summary, sleep } from './p6g.mjs';

const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
const { proc, port } = await launchChrome();
const c = await pageSession(port); const api = mkApi(c);
await api.init(); await api.seedSave({ ...P4_CROWN, stagDone: false });
await api.seedSeen(['stagCure']);            // the skippable path
await api.nav(base + '/?turbo=4');
await continueIn(api);
await api.installBot('pad');
const jget = async (e) => JSON.parse(await api.eval(`JSON.stringify(${e})`));

/* ── proximity ALWAYS wakes it ── */
await api.eval('__fmDebug.warpCrown("t2"); P.hearts = P.maxHearts; 0');
await api.waitTicks(40);
gate(await api.eval('__fm.stagActive === true'), 'proximity ALWAYS wakes the guardian');
gate(await api.eval('__fm.stagHp === 78 && __fm.stagPhase === 1'), 'HP 78, phase one');
gate(await api.eval(`document.getElementById('bossBar').classList.contains('on')`), 'the boss bar is up');
gate(await api.eval(`document.querySelectorAll('.bossNotch').length === 2`), 'the bar carries its two phase notches');
gate(await api.eval(`document.getElementById('bossName').textContent === 'THE ASH STAG'`), 'named on the bar');
await api.shot('stag-0-wake');

/* ── P1: the telegraph, the charge, the wall, the window ──
   at real-time speed: a three second window is 300 ms of wall clock at
   turbo 10, and a gate that cannot see the window cannot judge it */
await api.eval('window.__fmTurbo = 1; 0');
let sawPaw = false, sawCharge = false, sawStagger = false, wallHits = 0;
for (let i = 0; i < 400; i++) {
  const st = await jget('({st:__fm.stagSt, wall:__fm.stagWall, hp:__fm.stagHp})');
  if (st.st === 'paw') { if (!sawPaw) await api.shot('stag-1-paw'); sawPaw = true; }
  if (st.st === 'charge') sawCharge = true;
  if (st.st === 'stagger' || st.wall > 0) {
    if (!sawStagger) await api.shot('stag-2-stagger');
    sawStagger = true; wallHits = Math.max(st.wall, 1);
    if (st.st === 'stagger') break;
  }
  await api.eval('P.hearts = P.maxHearts; 0');
  await sleep(120);
}
gate(sawPaw, 'P1: it plants and PAWS — the charge is announced before it happens');
gate(sawCharge, 'P1: and then it charges');
gate(sawStagger && wallHits > 0, 'P1: a charge into the order stonework STAGGERS it — that is the window',
  'wall hits ' + wallHits);

/* the window pays, and the body ALWAYS chips */
{
  /* wait for the NEXT stagger and hit it inside its own window */
  await api.eval('window.__fmTurbo = 1; 0');
  await api.waitFor(`__fm.stagSt === 'stagger'`, 90000, 'a stagger window').catch(() => {});
  const hp0 = await api.eval('__fm.stagHp');
  await api.eval(`P.x = STAG.x + Math.sin(STAG.ang + 2.4) * 2.6; P.z = STAG.z + Math.cos(STAG.ang + 2.4) * 2.6;
    P.fy = groundH(P.x,P.z); P.heading = Math.atan2(STAG.x-P.x, STAG.z-P.z); P.hearts = P.maxHearts; 0`);
  await api.waitTicks(3);
  for (let k = 0; k < 3; k++) { await api.tap(0); await api.waitTicks(8); }
  await api.waitTicks(12);
  const hp1 = await api.eval('__fm.stagHp');
  gate(hp0 - hp1 >= 12, 'the staggered Stag takes FOUR TIMES a body chip', `${hp0} → ${hp1}`);
}
{
  /* any state at all: a swing that reaches it takes HP off (the law) */
  await api.eval('STAG.st = "track"; STAG.t = 0; 0');
  await api.waitTicks(6);
  /* count HITS, not HP: a phase threshold refills the bar mid-test and an
     HP comparison then reads a landed hit as a miss */
  const body0 = await api.eval('__fm.stagBody');
  await api.eval(`P.x = STAG.x + 2.4; P.z = STAG.z; P.fy = groundH(P.x,P.z);
    P.heading = Math.atan2(STAG.x-P.x, STAG.z-P.z); P.hearts = P.maxHearts; 0`);
  await api.waitTicks(3);
  for (let k = 0; k < 3; k++) {
    await api.eval(`P.x = STAG.x + 2.4; P.z = STAG.z; P.fy = groundH(P.x,P.z);
      P.heading = Math.atan2(STAG.x-P.x, STAG.z-P.z); P.hearts = P.maxHearts; 0`);
    await api.tap(0);
    await api.waitTicks(8);
  }
  gate((await api.eval('__fm.stagBody')) > body0, 'BODY CHIPS ALWAYS LAND — no state gates the sword out',
    `body hits ${body0} → ${await api.eval('__fm.stagBody')}`);
}

/* ── the ember rain's cover is REAL ── */
const cover = await jget(`(function(){
  const b = K_BOUGHS[6];
  return { under: underBough(b.x, b.z), open: underBough(K_PLINTH.x, K_PLINTH.z),
    boughs: K_BOUGHS.length, shadeUnder: inShadeAt(b.x, b.z) };
})()`);
gate(cover.under && !cover.open, 'the dead orchard is cover: under a bough is under a bough',
  JSON.stringify(cover));
gate(cover.shadeUnder, 'and the same bough is the shade that keeps the swelter off you');

/* ═══ THE GATE: the kid bot. Walks at it, mashes ✕, nothing else. ═══ */
await api.eval('SAVE.stagDone = false; storeSave(); applyWorldState(); 0');
await api.eval('__fmDebug.warpCrown("t2"); P.hearts = P.maxHearts; 0');
await api.waitTicks(40);
gate(await api.eval('__fm.stagDone === false && __fm.stagHp === 78'), 'kid-bot run starts from a fresh, full guardian');
const t0 = Date.now();
await api.eval('window.__fmTurbo = 14; 0');   // the grind, at speed
await api.installBot('pad');
await api.eval(`window.__kidBot = setInterval(function(){
  try {
    P.hearts = P.maxHearts;
    if (typeof STAG !== 'undefined' && STAG.c && window.__fmBot) {
      __fmBot.tol = 1.6;
      __fmBot.target = [STAG.x, STAG.z];
    }
    __fakePad.press(0);
    setTimeout(function(){ __fakePad.press(); }, 80);
  } catch (e) {}
}, 170); 0`);
const phases = new Set();
let won = false, sawLeap = false, sawEmber = false, sawStampede = false;
for (let i = 0; i < 3200 && !won; i++) {
  const st = await jget('({hp:__fm.stagHp, ph:__fm.stagPhase, st:__fm.stagSt, done:__fm.stagDone, cin:__fm.cinId})');
  phases.add(st.ph);
  if (st.st === 'leap' || st.st === 'leapTele') sawLeap = true;
  if (st.st === 'ember') sawEmber = true;
  if (st.st === 'stampede') sawStampede = true;
  if (st.done || st.cin === 'stagCure') { won = true; break; }
  await sleep(220);
}
await api.eval('clearInterval(window.__kidBot); __fakePad.press(); window.__fmTurbo = 4; 0');
const mins = ((Date.now() - t0) / 60000).toFixed(1);
const final = await jget('__fmDebug.stagInfo()');
console.log('kid-bot result:', JSON.stringify(final), 'phases', [...phases].join(','), mins + ' min');
gate(won, 'KID BOT: body-mashing alone WINS the whole fight', JSON.stringify(final));
gate(phases.has(2) && phases.has(3), 'KID BOT: through all three phases', [...phases].join(','));
gate(sawLeap, 'P2: it LEAPS the terraces');
gate(sawEmber, 'P2: and rains embers');
gate(sawStampede, 'P3: the fawn stampede runs the arena');
gate((await api.eval('__fm.stagBody')) > 0, 'body hits did the work', 'body=' + await api.eval('__fm.stagBody'));
await api.shot('stag-3-kidbot');

/* ── the cure: nothing dies, and the Sliver is NOT handed to you ── */
await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
await api.waitFor('__fm.stagDone === true', 90000, 'the cure finishes').catch(() => {});
for (let i = 0; i < 60 && (await api.eval(`__fm.state === 'cine'`)); i++) { await api.tap(0); await sleep(300); }
await api.waitTicks(30);
const cured = await jget('({done:__fm.stagDone, taken:__fm.sliverTaken, carry:__fm.carrySliver, q:__fm.quest, vis:sliverItem.visible})');
console.log('after the cure:', JSON.stringify(cured));
gate(cured.done, 'THE CURE: the Stag is cured, not killed');
gate(!cured.carry && !cured.taken && cured.vis,
  'the Sliver is SET DOWN on the plinth — the pickup is still the player’s to make (the tortoise lesson)');
gate(cured.q === 15, 'the quest still says RECOVER THE WAXING SLIVER', 'q=' + cured.q);
await api.shot('stag-4-cured');

/* ── the pickup is a real ✕ beat ── */
await api.installBot('pad');
/* keep the walker alive: the swelter is live up here and this gate is
   about the pickup, not about surviving the walk back */
await api.eval(`window.__topUp = setInterval(function(){ try { P.hearts = P.maxHearts; } catch(e){} }, 200); 0`);
/* walk it like a player would: down the ramp, not through the wall */
for (const [x, z] of [[2160, 1432], [2160, 1448], [2160, 1458], [2160, 1467]]) {
  await api.eval(`__fmBot.tol = 1.2; __fmBot.target = [${x}, ${z}]; 0`);
  await api.waitFor(`Math.hypot(__fm.x-(${x}), __fm.z-(${z})) < 2.6 || __fm.prompt === 'sliver'`, 30000, 'to the plinth').catch(() => {});
}
await api.waitFor(`__fm.prompt === 'sliver'`, 20000, 'the take-the-Sliver prompt').catch(() => {});
await api.eval('clearInterval(window.__topUp); 0');
await api.eval('__fmBot.release(); __fakePad.axes(0,0); 0');
gate((await api.eval('__fm.prompt')) === 'sliver', 'the plinth offers ✕ TAKE THE WAXING SLIVER',
  'prompt=' + await api.eval('__fm.prompt') + ' at ' +
  await api.eval(`JSON.stringify([+__fm.x.toFixed(1), +__fm.z.toFixed(1), +Math.hypot(__fm.x-K_PLINTH.x, __fm.z-K_PLINTH.z).toFixed(1)])`));
await api.tap(0);
await api.waitTicks(20);
gate(await api.eval('__fm.carrySliver === true'), 'the Waxing Sliver is carried');
gate((await api.eval('__fm.quest')) === 16, 'and the thread turns for home', 'q=' + await api.eval('__fm.quest'));
await api.shot('stag-5-carry');

/* ── the sunstruck checkpoint re-arms it at the phase you left it on ── */
await api.eval('SAVE.stagDone = false; SAVE.q = 15; storeSave(); applyWorldState(); 0');
await api.eval('__fmDebug.warpCrown("t2"); P.hearts = P.maxHearts; 0');
await api.waitFor('__fm.stagActive === true', 40000, 'awake again').catch(() => {});
await api.eval('STAG.phase = 2; STAG.hp = 20; refreshStagBar(false); 0');
await api.eval(`startCine('sunstruck'); 0`);
await api.waitTicks(140);
const re = await jget('({active:__fm.stagActive, ph:__fm.stagPhase, hp:__fm.stagHp, x:+__fm.x.toFixed(0), z:+__fm.z.toFixed(0)})');
gate(re.ph === 2 && re.hp === 52,
  'SUNSTRUCK: the guardian re-arms at the phase you left it on, full for that phase', JSON.stringify(re));
gate(Math.hypot(re.x - 2160, re.z - 1428) > 46,
  'SUNSTRUCK: and you wake OUTSIDE the arena, not back inside the fight', JSON.stringify(re));
gate(api.errs.length === 0, 'zero console errors through the whole fight', api.errs.slice(0, 3).join(' | '));
c.close(); proc.kill(); srv.close();
process.exit(summary());
