#!/usr/bin/env node
/* p6j — the LOOKED-AT screenshot strip, staged at turbo 1 so the beats
   are photographed mid-frame, not after they have finished. */
import { serve, launchChrome, pageSession, mkApi, tapUntil, sleep } from './p6g.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)));
const SHOTS = path.join(DIR, 'shots-p6j');
const BASE = {
  v: 2, q: 17, ph: 4, mh: 8, sword: true, salt: 60,
  talked: { finn: 2, tock: 1, pearl: 1 }, sky: 4, riverWet: true,
  bossDone: true, wallBurned: true, kelpDoor: true, basinOpen: true,
  glyph1: true, glyph2: true, wyrmDone: true, floodSeen: true,
  sailedOnce: true, voyageDone: true, boatX: 8.5, boatZ: 6, boatAng: 0.9,
  keelFound: true, boatRefit: true, moonSeen: true, isleLandfall: true,
  watchBell: true, tortoiseDone: true, sunArc: true, lampLit: true,
  fGlyph1: true, fGlyph2: true, fGlyph3: true,
  crownGlint: true, stairOpen: true, organ1: true, organ2: true, organ3: true,
  crownSeen: true, stagDone: true, tbc2Seen: true, tbc3Seen: true, tbc4Seen: true,
  region: 'bay', lastPos: [40, 10], lastShade: [8.2, 7],
};
async function session(save, seen) {
  const { srv, port: hport } = await serve();
  const { proc, port } = await launchChrome();
  const c = await pageSession(port);
  const api = mkApi(c);
  await api.init(); await api.seedSave(save);
  if (seen) await api.seedSeen(seen);
  api.shot = async (name) => {
    const r = await c.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64'));
    console.log('shot → ' + name);
  };
  api.close = () => { c.close(); proc.kill(); srv.close(); };
  await api.nav(`http://127.0.0.1:${hport}/?turbo=1`);
  await api.waitFor(`typeof __fm !== 'undefined' && __fm.state === 'title'`, 60000, 'title');
  await tapUntil(api, () => api.tap(13), '__fm.titleFocus === 1', 14, 'f');
  await tapUntil(api, () => api.tap(0), `__fm.state !== 'title'`, 16, 'g');
  await api.waitFor(`__fm.state === 'play'`, 30000, 'play');
  return api;
}
const Q21 = { ...BASE, q: 21, sluiceG: 3, mouthOpen: true, swingKeel: true, paddleWheel: true,
  poleFound: true, braziers: [true, true, true, true, true], marketOpen: true, salt: 60,
  region: 'forest', lastPos: [1345, 590], skiffX: 1340, skiffZ: 574, fireworks: 3, pennant: 2, spyglass: true };

/* 1 — dusk arrival, photographed mid-glide */
{
  const api = await session(BASE);
  await api.eval('__fmDebug.warp(nmBoardSpot.x, nmBoardSpot.z); 0');   // the footing is the only dry spot this close
  await api.waitFor(`__fm.state === 'cine' && __fm.cinId === 'nmDusk'`, 20000, 'dusk').catch(() => {});
  await sleep(5200);
  await api.shot('look-dusk-glide-1280x720');
  await sleep(1800);
  await api.shot('look-dusk-lanterns-1280x720');
  api.close();
}
/* 2 — the ceremony, photographed at the lantern */
{
  const api = await session(Q21, ['nmDusk']);
  await api.eval(`__fmDebug.warp(nmTrader.x + 1.5, nmTrader.z + 1.5); 0`);
  await sleep(600);
  await api.eval(`startDialog('nmTraderMarket', nmTrader); 0`);
  await sleep(400);        // telemetry snapshots lag the eval by a frame
  for (let i = 0; i < 8 && (await api.eval(`__fm.state === 'dialog'`)); i++) await api.tap(0);
  await api.waitFor(`__fm.cinId === 'nmCeremony'`, 9000, 'ceremony').catch(() => {});
  await sleep(3400);
  await api.shot('look-ceremony-lantern-1280x720');
  await sleep(2600);
  await api.shot('look-ceremony-given-1280x720');
  api.close();
}
/* 3 — the market by night: wide, plus a stall portrait + fireworks + spyglass */
{
  const api = await session(Q21, ['nmDusk', 'nmCeremony']);
  await api.eval(`__fmDebug.hud(false);
    __fmDebug.cam(NM_MARKET.at(14, -6).x, NM_MARKET.qy + 4.2, NM_MARKET.at(14, -6).z,
      NM_MARKET.at(-14, 4).x, NM_MARKET.qy + 1.4, NM_MARKET.at(-14, 4).z); 0`);
  await sleep(1200);
  await api.shot('look-market-wide-1280x720');
  await api.eval(`__fmDebug.cam(NM_MARKET.stalls[1].x - NM_MARKET.ox * 6, NM_MARKET.stalls[1].y + 2.4, NM_MARKET.stalls[1].z - NM_MARKET.oz * 6,
    NM_MARKET.stalls[1].x, NM_MARKET.stalls[1].y + 1.4, NM_MARKET.stalls[1].z); 0`);
  await sleep(900);
  await api.shot('look-market-stall-1280x720');
  await api.eval('__fmDebug.camOff(); __fmDebug.hud(true); 0');
  /* fireworks from the skiff */
  await api.eval(`boardSkiff(); 0`);
  await sleep(400);
  await api.eval('nmLaunchFirework(); 0');
  await sleep(1500);
  await api.eval('__fmDebug.hud(false); 0');
  await sleep(450);
  await api.shot('look-firework-1280x720');
  await api.eval('__fmDebug.hud(true); 0');
  api.close();
}
/* 4 — the night run + an eddy + the wheel beat mid-frame */
{
  const api = await session({ ...Q21, sliver5: true }, ['nmDusk', 'nmCeremony']);
  await api.eval(`__fmDebug.skiffTo(1200); skiffMoorToBank(); boardSkiff(); 0`);
  await sleep(700);
  await api.eval(`__fakePad.axes(0, 1); __fakePad.press(1); 0`);
  await sleep(2600);
  await api.shot('look-night-run-1280x720');
  await api.eval(`__fakePad.press(); __fakePad.axes(0,0); 0`);
  /* an eddy with its snapper, framed */
  await api.eval(`(function(){ const B = NBRAZ[2];
    __fmDebug.hud(false);
    __fmDebug.cam(B.ex - B.s.fx * 12, B.ey + 7, B.ez - B.s.fz * 12, B.ex, B.ey, B.ez); })(); 0`);
  await sleep(900);
  await api.shot('look-eddy-snapper-1280x720');
  await api.eval('__fmDebug.camOff(); __fmDebug.hud(true); 0');
  await api.eval(`(function(){ if (P.skiffing) { P.skiffing = false; skiffColl.off = false; } __fmDebug.warp(WHEEL_POS.x + 4, WHEEL_POS.z + 4); })(); 0`);
  await sleep(600);
  await api.eval(`startCine('nmWheel5'); 0`);
  await sleep(2400);
  await api.shot('look-wheel5-notch-1280x720');
  await sleep(2600);
  await api.shot('look-wheel5-night-1280x720');
  await api.waitFor(`__fm.state === 'tbc'`, 30000, 'card').catch(() => {});
  await sleep(1500);
  await api.shot('look-tbc5-1280x720');
  api.close();
}
console.log('done');
