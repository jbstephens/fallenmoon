#!/usr/bin/env node
import { serve, launchChrome, pageSession, mkApi, continueIn, ISLES, gate, summary, sleep } from './p6e.mjs';
const { srv, port: httpPort } = await serve();
const base = `http://127.0.0.1:${httpPort}`;
/* ═══ THE PHASE TWO CARD — the one the Half Shield arc never had ═══ */
const { proc: p2, port: pt2 } = await launchChrome();
const c2 = await pageSession(pt2); const a2 = mkApi(c2);
const PHASE2_END = {
  ...ISLES, q: 7, ph: 2, sky: 2, tbc2Seen: false, tbc3Seen: false,
  watchBell: false, moonSeen: false, isleLandfall: false, boatRefit: false,
  keelFound: true, keelCarried: false, tortoiseDone: false,
  fGlyph1: false, fGlyph2: false, fGlyph3: false, lastShade: [4, -2], region: 'bay',
};
await a2.init(); await a2.seedSave(PHASE2_END);
await a2.nav(base + '/?turbo=10');
await continueIn(a2);
await a2.waitFor(`__fm.state === 'tbc'`, 40000, 'the phase-two card').catch(() => {});
const on2 = await a2.eval(`__fm.state === 'tbc'`);
gate(on2, 'PHASE TWO now gets its card — the Half Shield arc no longer just stops');
if (on2) {
  const sub2 = await a2.eval(`document.getElementById('tbcSub').textContent`);
  console.log('card 2 subtitle:', sub2);
  gate(/keel/i.test(sub2) && /sea/i.test(sub2), 'and it teases the open sea and a keel worth it', sub2);
  gate(await a2.eval(`document.getElementById('tbcTitle').textContent === 'TO BE CONTINUED'`),
    'the card style is unchanged');
  await sleep(2200);
  await a2.shot('world-3-card2');
  await a2.tap(0);
  await a2.waitFor(`__fm.state === 'play'`, 20000, 'back to play');
  gate(await a2.eval('__fm.tbc2Seen === true'), 'and it is shown once, then remembered');
  gate(await a2.eval(`__fm.state === 'play'`), '✕ returns you to the world');
}
/* phase ONE's card must still be phase one's */
const sub1 = await a2.eval(`(function(){ showTBC(); const s = document.getElementById('tbcSub').textContent;
  el('tbc').classList.remove('on'); endCine(); return s; })()`);
console.log('card 1 subtitle after all this:', sub1);
gate(/Half Shield/.test(sub1), 'PHASE ONE’s card is untouched by any of it', sub1);
gate(c2.errs.length === 0, 'zero console errors on the card path', c2.errs.slice(0, 3).join(' | '));
c2.close(); p2.kill(); srv.close();
process.exit(summary());
