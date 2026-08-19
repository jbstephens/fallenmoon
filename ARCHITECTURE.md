# FALLEN MOON — architecture map

Companion to `DESIGN.md`. That file is the decided *intent*; this one is
the *structure* — where things live and the conventions that keep the
single-file build coherent. Line numbers are `index.html` unless noted,
and drift on every rebuild: treat them as a starting point, re-grep to
confirm.

## Read this first: index.html is a build output

`index.html` (1.2 MB / ~13,062 lines) is **generated**. Never hand-edit
it. The real sources are `test/src/p*.html`, assembled by
`bash test/build.sh`, which also `node --check`s every inline script
block except the vendored `three.min.js`. Most of the 1.2 MB is one
line — line 413 is all of three.js r147. Real game code is ~12,650
readable lines.

| src part | index.html lines | contents |
|---|---|---|
| `p1-head.html` | 1–406 | `<head>`, all CSS, DOM skeleton |
| *(three.min.js)* | 407–415 | vendored r147, skipped by the syntax check |
| `p2-core.html` | 416–971 | config, math, DOM, input, audio, save |
| `p3-art.html` | 972–1776 | mesh kit, humanoid builder, cast, enemies |
| `p4-world.html` | 1777–4617 | Brightharbor terrain, props, grotto, interiors |
| `p5-ent.html` | 4618–5491 | particles, player, camera, combat feel |
| `p6-game.html` | 5492–7099 | quests, dialogue, enemies, boss, cinematics |
| `p6b-forest.html` | 7100–9566 | Phase 2 night one — the Parched Forest |
| `p6c-tide.html` | 9567–12333 | Phase 2 night two — Falls Hollow, Wyrm, tide, sailing |
| `p6d-sea.html` | (after p6c) | **Phase 3** — ocean swell, the keel + refit + double sail, combat afloat, the crossing and the DROWNED MOON, the Hourless Isles |
| `p6e-isles.html` | (after p6d) | **Phase 3** — the Foundry, the three-verb puzzle, the Hour Tortoise, the sun-moves payoff, both end cards |
| `p7-flow.html` | (last) | state flow, HUD, telemetry, main loop |

## THE WORLD RULES layer (8/18 — read DESIGN.md "THE WORLD RULES" first)

Registries (guard-init `window.X = window.X || []` so part order never
matters; each part registers in an appended script block at its END):
- `__WORLD_REG` — 9 declared ground owners in wrap order; the harness
  `rules` suite derives its zero-carve-out conformance sweep from this.
- `__PORTALS` — 11 registered thresholds {name, x, z, openNow()}; the
  suite walk-tests them, checks solid-vs-openNow agreement both states,
  and screenshots BOTH sides of every portal every run (shots-portals/).
- `__HULLS` — floating vessels (sailboat afloat-or-moored, skiff; never
  the sunken wreck); every dynamic water surface consults it — full clamp
  within r + one grid cell so LOWFX's 11.5m lattice is covered.
- `beamHitDist`/`beamHitDistIn` (p4 top block) — ALL beams get length
  from terrain/interior-air marches. No fixed-length beam geometry.
- `__invariantSweep` (p6h end block) — repair pass at applyWorldState
  tail + every ~300 sim ticks; report in `__invariantReport`.
- Cull anchor rule: `viewX/Y/Z` in p7 = camera when CAM.mode !== follow —
  cinematics film a rendered world. Play path byte-identical.
- Rule 6 pattern: door plugs read the RENDERED slab position (stair
  organ doors, hollow glyph doors) — passable when it looks passable.

## Phase 4 at a glance

`p6g-crown.html` (~3,300 lines): the gold-hour glint, the Falls Stair, THE
WIND ORGAN (tuned by ear — hold ✕, pitch bends toward true, latches inside
a semitone; L1 one vent, L2 chord, L3 three vents in gusts), the Crown
watch-garden, ember fawns, the ASH STAG. `p6h-green.html` (~2,300 lines):
the sliverWheel payoff, the LIVE RE-GREEN (896k vertices relerped by a
wave-front, 1.6ms/frame budgeted), the swelter's retirement (exposure
starved + FX wrapped, p6b untouched), the LIVING SILVERRUN (authored
2,212m navigable surface — the bed is a swale, not a canyon), the SKIFF,
sky step 4, the phase-4 end card. Quests 13-17.

Load-bearing facts unique to phase 4:
- TWO new ground authorities (the stair's analytic floor; the river's
  authored surface). Near the falls basin, BUILD AGAINST `forestHMesh` —
  `groundH` there is owned by p6c's hollow field and answers with the
  cavern floor, 50m below the mountain p6b still draws.
- `lastPos` is now THREE numbers — a stair crossing over a cave made two
  coordinates stop being an address. Old two-element saves still resolve.
- Top-level names collide silently across parts (a `keepInArena` redecl
  once dragged the King Crab 1.5km onto the Crown): audit every new
  top-level name against all earlier parts before shipping a region.
- p4's collider list has no HEIGHT: anything you addColl on an upper floor
  is also solid on whatever lies below it — gate colliders by region mode.
- p6b's `buildWaterwheel` places all twelve paddles on one axis
  (`Math.cos(a) * R * 0.0`); p6h PARKS those vertices by position and
  draws its own wheels — fixing p6b's builder without updating p6h's
  parking will double the wheels.
- The falls forecourt is a pre-existing 86-92 draw-call hotspot (33 far
  tiles); p6g culls the forest far tier when deep in the hollow.

Phase 3 line numbers are deliberately omitted: p6d and p6e are ~3,000 lines
each and shift every rebuild. Grep by symbol instead — the pinned constants
below are stable.

## Phase 3 at a glance

**Geography is pinned in `p6d-sea.html` and read by `p6e-isles.html`:**
`ISLES` (2.2km x 1.5km, west/southwest so the Parched Forest's far tier can
never intrude on the crossing), `CROSS_LANE`, `MOON_SITE`, `WATCHSTONE`,
`KILN_ISLE`, `DROWNED_SPIRE`, `NETMENDER`, `GANNET_STACK`, `LONG_STRAND`,
`CHIME_REEF`, `ISLE_LIST`, `FOUNDRY_DOOR`, `REFIT_BEACH`, `KEEL_SPOT`.

**The two parts do NOT edit p7.** They each push one hook to
`window.__worldStateHooks` (save → world, both directions) and one to
`window.__telemetryHooks`. Any future region part should do the same rather
than editing `applyWorldState`/`syncTelemetry` in place.

**Content tables:** `SWELL`/`SET` (ocean), `FBELLS`/`FORDER` (the strike
order), `FKILNS`, `TORT` (HP 84, phases 84/56/28), `SKY3`/`SKYGOLD`,
`REEF_BELLS`, `ISLE_ANCHORS`, `ISLE_SHADE`.

**Debug helpers:** `__fmDebug.warpSea(x,z,ang) · isleInfo() · swellAt(x,z) ·
bigSetNow() · seaGround(x,z) · warpFoundry(where) · foundryInfo() ·
sunInfo() · sunSet(k) · openFoundry()`.

**The sun arc safety rail (non-negotiable):** once `SAVE.sunArc` is live the
sun travels noon → low gold → back on a ~6 minute cycle and shadows swing
with it, but springs, canopy, authored shade circles, grottos and interiors
stay shade at EVERY angle. The `isles` suite asserts this across 21 sun
angles; total shade may grow, never shrink. The sun moving must never become
a new way to die.

Each part is its own top-level `<script>` block. `const`/`let`/`function`
share page scope across blocks, which is what makes the wrap pattern
below work — and why part ORDER in `build.sh` is load-bearing.

## The wrap pattern — the most important convention here

There is **no registry object for regions**. Each region part rebinds
top-level function bindings, keeping the previous one in a `_<prev>`
const. Every wrap has the same shape:

```js
const _bhAreaAt = areaAt;              // _bh = Brightharbor, _n1 = night one
areaAt = function (x, z) {
  if (/* in my region */) return /* my answer */;
  return _bhAreaAt(x, z);              // else delegate to the previous owner
};
```

Grep `^const _bh` / `^const _n1` to re-derive the current chain.

| function | Brightharbor | forest (p6b) | hollow/tide (p6c) |
|---|---|---|---|
| `groundH` | 1928 → mesh-field 2035 | 7295 | 9724 |
| `inShadeAt` | 2068 | 7406 | 9741 |
| `nearestShadeSpot` | 2077 | 7412 | 9746 |
| `groundColor` | 2215 | 7489 | — |
| `areaAt` | 6110 | 8786 | 9757 |
| `respawnLeftBehind` | 6114 | 8791 | — |
| `currentInteract` | 5623 | 8814 | 12007 |
| `doInteract` | 5682 | 8829 | 12034 |
| `tickPlayer` | 4996 | 9044 | 11911 |
| `swingHits` | 6531 | 9051 | 11943 |
| `cullChunks` | 4433 | 9106 | 12077 |
| `tickCrab` / `tickWisp` | 6132 / 6218 | — | 11929 / 11935 |
| `objectivePoint` | 4937 | — | 11949 |
| `updateCamera` | 4787 | — | 11964 |
| `animateWick` | 5298 | — | 12238 |
| `startCine` / `tickCine` | 6562 / 6607 | — | 11585 / 11604 |
| solid authority | `worldSolidAt` 2180 | `window.__forestSolid` 7360 | `_n1ForestSolid` 9645 |
| `__fmDebug` | born 12819 | `extendDebugOnce` 9450 | `extendTideDebugOnce` 12316 |

A new region's part must be concatenated AFTER everything it delegates
to, and its wraps defined after the functions they capture.

## Table of contents

### p2 — core (416–971)
`VW/VH` 1280×720 and `DT` 1/60 at 427 · `LOWFX` (`?fx=low`) / `TURBO`
(`?turbo=N`) 431 · **`SAVE_KEY='fallenmoon_save_v1'`** 441 ·
**`BUILD_TAG`** 442 → `window.__fmBuild` (the deploy marker) · math
utils 445 (`clamp`, `lerp`, `smoothstep`, `angLerp`, `mulberry32`,
`hash2`, `vnoise`, `noise2`, `col`, `mix3`) · DOM 490, `showCaption`
500, `fitStage` 508 · **input** 516: `keys` 519, `kEdge` 529, **`IN`**
531, `gatherInput` 543, `clearEdges` 601, `CAMIN` 615, touchpad
633–663, `rumble` 664 · **audio** 673, **`SFX`** 744 (34 synth sounds,
lazy ctx) · **save** 888: `defaultSave` 889, `loadSave` 951,
`storeSave` 968 · `state` 970 (`boot|title|play|dialog|pause|cine|tbc`)

### p3 — art (972–1776)
mesh kit 973 · **`buildHumanoid(spec)`** 1117 (spec documented in place)
· **cast** 1418: `buildWick` 1419, `buildFinn` 1453, `buildTock` 1464,
`buildPearl` 1489 · **enemies** 1495: `buildScorchCrab` 1496, sun imp,
ember critter ~1562, `buildHeartItem` 1755, `buildMoonfish` 1765

### p4 — Brightharbor & the Dry Bay (1777–4617)
fog / `SUNDIR` / `SHADOW_DIR` / `bakeCol` 1792–1808 · baked primitives
`pushTriW`/`boxW`/`latheW` 1828–1908 · **landmark coordinate table**
1909–1922 (`WHEEL_POS`, `GROTTO_A/B`, `GROTTO_ENT`, `MIRROR_POS`,
`KELPWALL`, `WRECK`, `REFILL_POOL`, `FINN_POS`, `TOCK_POS`,
`PEARL_BOAT`, `WAKE_BOAT`) · **`groundH`** 1928 · **`makeMeshField`**
1985 (the one-ground-authority pattern: rendered == physics) ·
**`SHADE`** 2050, `inShadeAt` 2068, `nearestShadeSpot` 2077 ·
**`COLL`** 2091, `collide` 2093, `supportYAt` 2116 · **`MASSIF`** 2159
(grotto rock footprints), `worldSolidAt` 2180, `resolveSolid` 2186 ·
`PATHS` 2199, `groundColor` 2215 · `WORLD_MAT` / `CHUNK=80` 2268–2320 ·
**props** 2322 (`propHouse` 2328, `propLighthouse` 2380, `propBoat`
2393, `dynBoat` 2410, `propWakeBoat` 2454, `propWell` 2518, `propRock`
2527, `propKelpClump` 2539, `propWreck` 2601, `propMoonwheel` 2627,
`propFence` 2701) · `SPAWN_POS = {x:8.2, z:7.0}` 2446 · `buildGrotto`
2718, lore mural 2917 · kelp 2939–3027 · shade pools / `buildTidewater`
3033–3092 · **`SKY`** 3094, `buildSky` 3104, `setSkyBlend` 3178 ·
`PSTAGE` 3204 (off-world portrait/interior strip at x≈330) · decor
3245–3345 · **INTERIORS** 3360: **`ROOMS[]`** 3366, `roomAt` 3367,
`interiorResolve` 3376, `houseDoorOf` 3398; harbor 3407, Tock 3621,
Pearl 3872, lighthouse 4092, cartographer 4269 · **`cullChunks`** 4433
· chest/salt meshes 4544–4616

### p5 — entities, player, camera, combat (4618–5491)
particles 4622–4717 (`makePS`, `burst`) · `updateBeacon` 4718 ·
**`placeNPC`** 4738 · `playerPos` 4772 (the **`P`** player object sits
just above) · **`CAM`** 4780, `updateCamera` 4787 · combat 4857–4936:
`inSwingArc`, `trySwingKelp`, **`damageSourceRendered`** 4909,
`hurtPlayer` 4921 · `objectivePoint` 4937 · `doPulse` 4953 (△ compass)
· `moveWithCollision` 4983 · **`tickPlayer`** 4996 · `startAttack` 5119
· poses 5137–5297 · `animateWick` 5298, `swordToHand` 5398,
`updateTrail` 5411 · `animateNPCs` 5451

### p6 — quests, dialogue, boss, cinematics (5492–7099)
**`QUEST`** 5499 · **`QUEST_TEXT`** 5500 · `setQuest` 5508 · **`DLG`**
5522 · dialogue runtime 5559–5590 · **`currentInteract()`** 5623 (the
✕-prompt resolver) · **`doInteract(ctx)`** 5682 · **`MICRO`** /
`startMicro` 5749 (reusable micro-cinematic) · interior interactions
5760–5857 · chests 5858–6004 · `tickSalt` 6005, `tickMirror` 6024 ·
**enemy spawn tables** 6072: `crabs` 6075, `mkImp` 6089, `wisps` 6096 ·
`areaAt` 6110 / `respawnLeftBehind` 6114 (respawn districts) · crab &
wisp ticks 6132–6277 · **KING-CRAB** 6278: `BOSS_HP=90`, `initBoss`
6291, `refreshBossBar` 6303, `tickBoss` 6336, `dealBossDamage` 6480,
`hitBossClaw` 6495, `hitBossBody` 6510, `swingHits` 6531 ·
**CINEMATICS** 6560: `startCine` 6562, `cineCam` 6602, `tickCine` 6607,
`tickBossDefeat` 6706, `tickWheelPayoff` 6765 · `showTBC` 6871–6944 ·
`animateBoss` 6953, `animateEnemies` 7004

### p6b — THE PARCHED FOREST (7100–9566)
**geography, all locked at 7115**: `FW` 7116 (2008×1436 m), `RIVER`
7120 (the Silverrun polyline), `CROWN`/`BASIN`/`HUM_SPOT` 7135,
`RIDGES` 7140, `KNOLLS` 7147, **`FCLUSTERS`** 7154 (17 clusters),
**`FSPRINGS`** 7174 (6 sanctuaries/checkpoints), `CEDAR`/`TOWER`/
`WARDEN_POS` 7180, `FSHADE` 7184 · heightfield 7195–7281 · tree grid
7300 (`TCELL=9`, `treeInfo` 7316, `eachTreeNear` 7343) ·
**`window.__forestSolid`** 7360 · region build 7495 (`FCH=200`) ·
landmarks 7803 (mill, ferry, hamlet, tower, cedar) · **`FCHESTS`** 8347
· creatures 8370: `buildCinderBoar` 8391, `buildEmberHornet` 8462,
**`BOARS`** 8509, **`HORNETS`** 8525, `buildWarden` 8566, warden
dialogue 8578–8590 · boar/hornet ticks 8592–8781 · **region wiring by
wraps** 8782 · **`SW_LINES`** 8944 + `triggerSwelterRelief` 8957 ·
**`tickForest`** 8969 · `updateSwelterFX` / `drawSunStat` 9206–9285 ·
`animateForest` 9286 · telemetry 9386, `extendDebugOnce` 9450

### p6c — THE FALLS HOLLOW & THE TIDE'S RETURN (9567–12333)
**geography locked at 9580**: `SEA_EDGE` 9583, `H_THROAT` 9586, `HGAP`
9596, `HMURAL`/`HFOSSIL`/`HPOOL` 9601, **`SLABS`** 9604, floor heights
9610 · hollow queries 9613–9771 · wraps 9645/9723/9740/9746/9757 ·
hollow build 9772 (chambers, skylight shafts 10070, `buildGlyphDoor`
10110, `buildHollowMirror` 10145, `buildHollowBeam` 10173) ·
`buildHalfShieldItem` 10245 · **SILT WYRM** 10229: `buildSiltWyrm`
10280, `buildDustDevil` 10350, `WYRM_HP=72` 10369, **`WYRM`** 10370,
`wyrmSwimStep` 10419, `hitWyrmBody` 10445, `hitWyrmBrow` 10460,
`tickWyrm` 10474, `animateWyrm` 10652 · **THE TIDE COMES HOME** 10744:
`setSkyBlend2` 10749, `setStarOp2` 10799, sea mesh, sail 10946 ·
**`BOAT`** 10923 · `CRAB_BEACH`/`WISP_SHALLOWS` 10979 (post-flood
relocation) · **cinematics** 11164: `cineSeen`/`markCineSeen` 11165,
`AUTORUN`/`RUN_PATH` 11207, **`HANDOFF`** 11241 + `beginHandoff` 11244
/ `handoffCamera` 11260 (the invisible control handoff), `tickFloodCine`
11340, `tickBasinCine` 11443, `tickWyrmCure` 11489 · **SAILING v1**
11612: `VOYAGE` 11626, `boardBoat` 11630, `startVoyage` 11640,
`disembark` 11669, `tickSailing` 11682, `sailCamera` 11969 ·
`tickFloodLive` 11781 · **`HMIRRORS`** 11809 (the two water-glyph
puzzles), `tickGlyphDoors` 11847, `tickTide` 11868 · night-two wraps
11910–12237 · telemetry 12259, `extendTideDebugOnce` 12316

### p7 — flow, HUD, telemetry, main loop (12334–13062)
`setState` 12338 · `refreshTitleMenu` 12348 · `beginNewGame` 12356 ·
**`applyWorldState()`** 12377 — derives the whole world from `SAVE`,
**both directions**; every new save flag must be handled here ·
`tickTitle` 12490, `applySave` 12538 · `drawHearts` 12573 ·
`updatePrompt` 12624 · `PORTRAIT`/`fmPortrait` 12638 (art-review rig) ·
**`syncTelemetry()`** 12726 → **`window.__fm`** 12725 (the read-only
harness contract) · **`window.__fmDebug`** 12819 (`freeze`, `portrait`,
`cam`, `warp`, `hud`, `face`, `camYaw`, `camPitch`, `skyProbe`; plus
lazily `overhead`, `sightline`, `forestInfo`, `warpSpring`, `boat`,
`hollowInfo`) · **`tickSim()`** 12847 · **`updateVisuals()`** 12886 ·
**`frame(now)`** 13016 (fixed 60 Hz sim, decoupled render, ≤5 catch-up)
· boot 13045: `initBoss` → `applyWorldState` → `refreshTitleMenu` →
`refreshPause` → `setState('title')` → `requestAnimationFrame(frame)`

## Authored content tables

| table | line | shape |
|---|---|---|
| `QUEST_TEXT` | 5500 | `{ [q]: 'HUD BANNER' }` — only 0,2,3,4,5,6 exist |
| `DLG` | 5522 | `{ id: { name, lines: ['≤2 short lines'], onDone? } }`. Extended by assignment in later parts: `DLG.warden1` 8578, `DLG.pearlBeg` 11621 |
| `crabs` | 6075 | `{c, sx,sz, x,z, hp:3, st:'patrol', t, ang, dir, dead, area, lungeCD, flash}` |
| `wisps` (sun imps) | 6096 | `{m, sx,sz, x,z,y, face, st:'drift', t, dir, dead, area}` |
| `BOARS` / `HORNETS` | 8509 / 8525 | built from `FCLUSTERS`; boars add `cured` |
| `BOSS` / `WYRM` | 6283 / 10370 | HP 90 (phases 90/60/30) and 72 (72/48/24) |
| `ROOMS[]` | 3366 | `{id, x,z,w,d,wallH, ext:{outX,outZ,…}, inDoor, promptId, mesh, glow, vis[]}` — interiors live off-world at x≈330, 40 m apart |
| `FCLUSTERS` / `FSPRINGS` | 7154 / 7174 | `{id,x,z,r,flat?}` / `{x,z,r}` |
| `FCHESTS` | 8347 | `{ch, key, salt, big, small}` — `key` is the SAVE flag name |
| `SLABS` / `HMIRRORS` | 9604 / 11809 | `[x,z,r]` / `{m,id,door,doorPos,key,beam,burnT,delta}` |
| `VOYAGE_PATH` | 11627 | Pearl's maiden-voyage lap |
| `SFX` | 744 | 34 named synth sounds |

**Map layout is code, not data.** No tilemap. World shape = analytic
height functions (`groundH` 1928, `forestH` 7246, `hollowFloorRaw`
9671) run through `makeMeshField` (1985) so rendered geometry and
physics come from one function. Solidity = `worldSolidAt` /
`__forestSolid`.

## Save schema

- **Key** `fallenmoon_save_v1` (441). The *string* still says v1; real
  versioning is the **`v` field inside the JSON**, currently `2`.
- **Shape** `defaultSave()` 889 — flat, ~55 keys, grouped by rev with
  comments.
- **Load** `loadSave()` 951 — `Object.assign(defaultSave(), parsed)` so
  missing keys get defaults, then the v1→v2 migration if `!v.v`.
- **Forward re-derivation** 971–984 — `qMin` is computed from world
  flags (`talked.finn≥1 → 2`, `wallBurned → 2`, `bossDone → 3`,
  `sky≥1||ph≥1 → 4`, `sky≥2||ph≥2 → 6`) and `q` bumped forward if they
  disagree. Comment calls this "the Ben soft-lock": flags and quest may
  never disagree in a way that dead-ends the arc.
- **Write** `storeSave()` 968 — every mutation does `SAVE.x = …;
  storeSave();` inline. No debounce.
- **Read back** `applyWorldState()` 12377, bidirectional (chests open
  *or* closed, kelp cut *or* regrown). Gated by `suiteWorld`'s John
  sequence: completed save → NEW GAME → world fully fresh.
- **Phase 3 flags:** `keelFound keelCarried boatRefit moonSeen isleLandfall
  bellwrightTalked watchBell spireChest strandHeart gannetChest fGlyph1/2/3
  fMouldHeart fMouldMural tortoiseDone sunArc bossHint3 bigSetSeen garSeen
  tbc2Seen tbc3Seen`. Quest steps run 7–12.
- **Second namespace** `fm_seen_<cineId>` (11165) — per-cinematic seen
  flags kept *outside* the save blob so they survive NEW GAME. Also
  `arcade_lowfx`, shared arcade-wide.

## Other standing conventions

- **Frame budget: ≤80 draw calls, ≤120k triangles**, asserted by
  `perf`, `fperf`, `flow`, `sail`. Held by squared-distance culling in
  `updateVisuals` and per-chunk visibility.
- **No assets.** All geometry built in code, light baked per-vertex
  (`bakeCol` 1808), one shared `WORLD_MAT`.
- **Cinematics ≤12 s, skippable, show-don't-tell.** `startMicro` 5750
  is the reusable short-beat helper.
- **Never read `keys` directly in gameplay** — read the `IN` struct
  (531), filled once per frame by `gatherInput`. Edges latch until a
  sim tick consumes them.
- **Fixed 60 Hz sim, decoupled render** (13016). `?turbo=N` multiplies
  sim ticks per rAF for tests — same sim, same inputs.
- **`BUILD_TAG`** (442) must be build-unique and verified ABSENT from
  the previous bundle before polling a deploy.
- **`damageSourceRendered`** (4909): a culled enemy may never deal
  damage. Gated by `suiteDmgVis`.

## Adding things

**A new enemy.** Build `buildX()` returning `{root, parts, …}`
(`frustumCulled = false`; flashable meshes into `parts`). Add a spawn
array whose records carry `sx, sz, x, z, hp, st, t, dead, area`. Write
`tickX`/`moveX`/`hitX` mirroring `tickCrab` 6132 or `tickBoarF` 8592.
Wire into the region's `tickPlayer`/`swingHits`/`respawnLeftBehind`
wraps. Register in `animateEnemies` 7004 or the region's `animateX`.
Respect `damageSourceRendered`. Add telemetry counts so the harness can
assert.

**A new NPC.** `buildX()` via `buildHumanoid`; place with `placeNPC`
4738; add a `*_POS` const to the region's geography block; add
`DLG.<id>` (template: `DLG.warden1` 8578); add a proximity branch to
the region's `currentInteract` wrap returning `{id, label:'✕ TALK'}`;
add the `doInteract` dispatch branch keyed off `SAVE.talked.*`; add
distance-culling in `updateVisuals`.

**A new region.** New `test/src/pN-*.html`, appended to the `cat` list
in `build.sh`. Open with a "geography, all locked here" const block
(template: 7115 or 9580). Analytic heightfield → `makeMeshField` so
rendered == physics. Wrap `groundH`, `groundColor`, `inShadeAt`,
`nearestShadeSpot`, `areaAt` and the solid authority; then
`currentInteract`/`doInteract`/`tickPlayer`/`swingHits`/`cullChunks`/
`respawnLeftBehind`. Own chunk grid. `extendDebugOnce()` to bolt region
helpers onto `__fmDebug`. Extend `syncTelemetry`. Add a harness suite.

## Test harness

No README, no `package.json`, no CI — the harness is the documentation.

```bash
./test/build.sh                     # rebuild index.html from src + syntax check
node test/harness.mjs               # 'all'
node test/harness.mjs <suite>
node test/harness.mjs flow,kbd,perf # comma-separated
node test/harness.mjs art           # art-review rig — NOT part of 'all'
node test/probe.mjs                 # draw-call census (diagnosis, not a gate)
```

Exit code 1 on any failure; final line is `ALL GATES GREEN` or
`N FAILURE(S)` plus elapsed minutes. Headless Chrome + CDP, fake
standard-mapping gamepad injected before page scripts, everything
driven through **real input** and asserted via `window.__fm`.

**Dependencies:** hardcoded `/Applications/Google Chrome.app/…`
(macOS-only) and it reads `../gameconsole/lib/controller.js` — the
sibling `gameconsole` checkout is a hard requirement. Chrome profiles
go to `os.tmpdir()`, deliberately not the repo (abandoned profiles once
cost 16 GB in a synced folder), swept on exit and on SIGINT/TERM/HUP.

**Fixtures:** `test/fixtures/ben-session-save.json` (q2 mid-game) and
`family-q4-save.json` (q4 post-boss, region `forest` — the "must
continue seamlessly" fixture).

**Screenshots:** `test/shots/` (committed, ~121 PNGs, `<beat>-1280x720.png`;
failures as `<suite>-FAIL.png`). `test/shots-probe/` is gitignored.

| suite | asserts |
|---|---|
| `shots` | swoosh trail, sprint lean, jump apex, crab-hit contact, compass motes, pickup-vs-decor brightness |
| `walls` | `skyProbe` magenta-void orbit — no winding holes in facades |
| `fuzz` | grotto solid, arena unreachable pre-burn, flood-fill reachability, dense perimeter sweeps |
| `boss` | claw glow, HP bar, proximity wake, real-input damage, **kid-bot (body-only mashing) wins the whole fight** |
| `interior` / `rooms` | harbor house pad+kbd; all five interiors; Pearl's chart gains a star post-payoff |
| `combat` | single swing hits a crab 20/20; idle feet dead still (<0.02 rad) |
| `saves` | fixture restore q0/q2/q3/q4, damaged-save forward re-derivation, Finn self-heal, NEW GAME overwrite guard |
| `migrate` | v1 swordless save loads with sword; v1 q1 folds to q2 |
| `flow` | boss-p3 and dusk frame budgets; save round-trip of every flag |
| `kbd` / `touch` | arrow orbit, pointer-lock mouse-look; virtual pad title→play, right-side drag orbits while moving |
| `perf` | ≤80 calls / ≤120k tris at village, imp fight, free orbit, sprint-through |
| `world` | **the John sequence** — completed save → NEW GAME → world fully fresh |
| `forest` | Cinder Pass both ways on foot, signpost, region traversal |
| `ground` | dense grid: \|rendered − groundH\| < 0.05 m, no far-tier face inside the near ring, never enclosed |
| `trees` | zero blue-dominant trunk verts, bases on `groundH` ±0.06, zero floating canopies, zero collision-only ghost trees |
| `swelter` | vignette build, exactly-1-heart tick, line rotation ≈1/20 s, relief wash + double-pulse rumble + chime, inert in Brightharbor |
| `dmgvis` | **culled enemy contact deals NO damage**; a seen charge still hits for 2 hearts |
| `fperf` / `fshots` | tower-deck 360° budget; forest run-jump apex |
| `hollow` | family-q4 continues seamlessly, basin sealed pre-q2, both glyph puzzles, fossil, dense floor grid, kbd-only descent |
| `wyrm` | proximity always wakes it, kid-bot clears all 3 phases, cure ≤12 s; slabs: zero hearts lost on stone, brow hit pays 6× |
| `flood` | Shield walked home, **input live inside 12 s**, bars off exactly at control-live, exactly one handoff rumble, **one continuous camera — no cuts ever**, sky step 2 real in pixels, matrix both directions |
| `sail` | pad/kbd/touch board→steer→full sail→ashore, sea boundary, wisps fizz, hull never crosses land, boat persists where moored, Pearl's voyage |
| `n2shots` | the night-two screenshot strip |
| `isles` | **phase 3's must-never-regress subset**: the Foundry seal both ways, the portal actually walkable on foot, proximity waking the Hour Tortoise, a **kid bot that only body-slashes winning the whole fight**, sky step 3 with the arc live, the sun-arc **safety rail across 21 angles**, and NEW GAME un-refitting the boat / un-seeing the moon / re-pinning the sun |

Nearly every suite ends with a `zero console errors` gate and a
catch-all that fails on any thrown exception.

Deeper phase-3 coverage (102 gates) lives in `test/probes/p6e-*.mjs` and
`test/probes/seadiag.mjs`, run directly with node. Two hard-won rules for
those probes: `seedSave(save, true)` seeds only the FIRST navigation, so a
suite that reloads with a second fixture is silently testing the old world;
and any timed mechanic (the resonance tone) must be started and then walked
IMMEDIATELY — polling, gating and screenshotting first spends the player's
clock in setup and then blames the door.

**Harness API** (`makeApi`, ~300): `seedSave`, `nav`, `eval`, `waitFor`,
`press`, `shot`, `installBot`, `walkTo`, `bot`, `botRelease`, plus
`driver(api, mode)` for pad/kbd/touch-agnostic input, `tapUntil`,
`advanceDialog`, `still`. The in-page bot is `BOT_SRC`, exposing
`window.__fmBot`.

## Known gaps and sharp edges

1. **Phase 2 has no TO BE CONTINUED card.** `showTBC` (6871) is wired
   only as `DLG.finn3.onDone`, which fires at the end of the *Crescent*
   payoff. Its subtitle ("The Half Shield lies beyond the Parched
   Forest…") is correct where it fires — but the Half Shield arc now
   ends with no closing card and no tease of the Gibbous Bell. The
   banner just sits at `2/8 PHASES RESTORED`. John called the TBC card
   "fantastic", so this is the most visible missing beat.
2. **6 of 8 moon phases unwritten.** `QUEST_TEXT` stops at 6. `SKY.step`
   handles 0→1→2; each further step needs a new palette pair.
3. **`buildDustDevil()` (10350)** is built and unused — comment marks it
   as "phase 3's wandering hazards". Ready-made content.
4. **Finn's lighthouse upper floors** are unbuilt; crates block the
   fifth step (4161, 5849) as a polite "not yet".
5. **The chain mural** (2917, `HMURAL` 9601) is a deliberately
   unanswered hook. Gate name: "the chain mural — seen, unanswered."
   Per DESIGN.md the mystery stays open until John joins that decision.
6. **`suiteArt` is unreachable from `all`** — line 5442 is
   `if (which === 'art')`, not `wants('art')`. Probably deliberate (it's
   a human art-review rig), but it means `all` is not literally all.
7. **`probe.mjs` regex-extracts `BOT_SRC` and `STUN_STAGE` out of
   `harness.mjs` source text** (probe.mjs 20–21). Renaming or
   reformatting those template literals silently breaks the probe.
8. **`suiteInterior` and `suiteForest` report through a local `g()`
   wrapper**, so they don't show up in a `grep "gate('"` census.
9. **`SAVE_KEY` says `v1` while the schema is at `v: 2`.** Harmless, but
   the naming is already misleading if a future migration ever needs a
   genuinely fresh key namespace.
10. **There are zero `TODO`/`FIXME` comments in the codebase.** Deferral
    is expressed through DESIGN.md and in-world fiction instead — so
    grepping for TODO will always come up empty and tell you nothing.
