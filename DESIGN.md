# FALLEN MOON — decided design (Phase 0, first playable slice)

Spiritual sequel to Shattered Sun. Real 3D (three.js r147, Powder Peak
recipe), close third-person Zelda-style adventure. Kid-playable: short
dialogue, story told through what you SEE and DO. Design decided
2026-08-08 under John's brief ("auto mode, playable by morning");
creative liberties below are locked — implement as written, tune
numbers for fun.

## The mythology (invented, locked)

The moon didn't just fall — it CAME APART. One year ago it cracked
like a struck bell and its EIGHT PHASES fell to earth as real,
differently-shaped relics: the New Coin, the Waxing Sliver, the
CRESCENT HORN, the Half Shield, the Gibbous Bell, the Full Mirror,
the Waning Lantern, the Old Bone. Since then the sun has nowhere to
go: it hangs pinned at noon, forever. Nobody knows yet what struck
the moon (series mystery — the slice drops ONE hint, see Grotto).

Above the village stands the **MOONWHEEL** — an ancient stone ring
with eight empty sockets. **THE SPINE OF THE GAME (locked, John's
directive 8/8): every phase restored CHANGES THE WORLD — visibly,
mechanically, permanently. Never just a counter.** The progression
IS the spectacle: you are watching yourself fix the world, one
phase at a time, and the finale — the eighth phase — brings the
first NIGHT of the entire game.

The eight phases and their world-changes (series roadmap; slice
implements the Crescent only, but the TO BE CONTINUED card teases
the Half Shield's):

1. **CRESCENT HORN** (this slice) — shadows return: every shade
   pool visibly stretches and grows (more healing ground), the
   first star appears, and one tidepool at the bay's edge refills —
   a single moonfish jumps. Proof of concept for everything.
2. **HALF SHIELD** — THE TIDE COMES HOME: the Dry Bay floods back
   to real ocean. Boats float, the ferry runs, new coasts open —
   and the walkable seabed (including the Grotto path) submerges.
   The first dungeon area transforms into sea.
3. **GIBBOUS BELL** — the sun finally MOVES: a partial day arc
   returns, bringing the first sunset anyone has seen in years
   (long golden-hour light, evening ambience).
4. **WAXING SLIVER** — cool winds return: the Parched Forest
   re-greens, burnt thickets soften into new walkable paths.
5. **FULL MIRROR** — nocturnal life wakes: moths, owls, fireflies;
   night-market NPCs appear with new shops and quests.
6. **WANING LANTERN** — the stars all return: constellations
   unlock star-map navigation puzzles and light distant beacons.
7. **OLD BONE** — the deep places cool: badland lava crusts into
   walkable obsidian; the final region opens.
8. **NEW COIN** — the moon rises. **NIGHT.** The whole world you
   fixed, seen at last in the dark: firefly fields, lit windows,
   the tide silver under moonlight. The end.

The slice recovers exactly one phase (the Crescent Horn) and its
payoff must already demonstrate the spine: sky step + shadows
stretching + the refilled tidepool, all at once.

## ART DIRECTION (locked, overriding all house-style precedent)

**This is NOT the Phaser Wars look. No chibi, no big heads, no googly
eyes, no toddler proportions — nothing "cute-arcade."** The bar is
stylized-realism in the vein of Zelda: Breath of the Wild / Ghibli:
- Characters at **6.5–7 head-heights**, slim believable builds,
  real necks, real hands (mitten-simple is fine, but proportioned).
- Faces minimal and matte like BotW: small dark eyes (no white
  sclera balls, no giant pupils), simple brow line, understated
  mouth. Expression comes from posture and animation, not face gags.
- Hair as sculpted low-poly chunks (Link-like), cloth as real
  geometry: Wick's scarf and Finn's coat hem move with a cheap
  vertex sway. Hooded/robed silhouettes welcome for NPCs.
- **Cel/toon shading**: characters use MeshToonMaterial (r147) with
  a 3-step gradient ramp — clean two-tone cel look, one directional
  + hemisphere, constant across areas. World light is BAKED as
  painterly toon ramps in vertex colors (hard-edged light/shade
  boundaries, colored shadows), not smooth gradients.
- Muted, natural palette under blown-out noon: bleached grass-gold,
  sea-salt white, terracotta roofs, teal shade pools. No neon, no
  arcade saturation. Bloom-feel faked with pale sky + fog, never
  postprocessing.
- Animation carries the charm: weight in the walk, anticipation on
  the sword swing, idle breathing, head-look at nearby NPCs.
The screenshot test: a stranger should read a still as "a small
serious 3D adventure game," never "a kids' browser game."

## The hero & the sword

**WICK** — a young adventurer (gender-neutral, Link-like proportions
per the art direction above: 6.5 heads tall, sculpted hair, red
scarf with vertex sway, toon-shaded, small matte eyes).
**The Moonglass Sword** — a pale glass blade, the village heirloom.
Moonglass GLOWS when a moon phase is near: the sword is also your
compass (△ pulses it — a soft chime + glow swell scaled by
proximity to the current objective).

## The world slice: BRIGHTHARBOR & THE DRY BAY

A fishing village where the tide went out a year ago and never came
back. Consequence-as-level-design everywhere:

- Boats beached and tilted on a cracked-mud seabed; nets full of salt
  crystals; a lighthouse with nothing to light (it's always noon).
- The DRY BAY is walkable seafloor — dried kelp forests (cuttable),
  salt-crystal tidepools, a shipwreck with a chest — places you can
  only reach BECAUSE the sea is gone.
- **Shade is sanctuary**: standing in shadow slowly refills hearts
  (visible sparkle + soft hum). Sun-glare zones on open seabed pulse
  heat shimmer. The theme is a mechanic: without night, shade is the
  only rest anyone gets.
- Palette: over-bright warm noon (bleached sand, white-gold sky, hard
  colored shadows: deep teal/purple shade pools). Fog matched to a
  pale hot horizon. It should look BEAUTIFUL and slightly wrong.

## Slice beats (launch → ~12 min, all playable)

1. **Wake under a beached boat** (in shade). Zero text. Walk out into
   the glare — screen blooms bright for a beat. You already understand.
2. **Village, 3 NPCs, dialogue ≤3 short lines each, ✕ advances:**
   - **Keeper Finn** (lighthouse keeper, dry humor): "A lighthouse in
     endless day is just... stairs." Gives you the Moonglass Sword
     after beat 3. Quest-giver.
   - **Granny Tock**: hasn't slept in a year; knits by the well;
     counts seconds out loud to remember what time was.
   - **Pearl** (kid on a boat prow): has never seen stars; thinks
     they're a bedtime story adults made up.
3. **Sword in ~90 seconds**: Finn's door is blocked by dried kelp →
   he tosses you the sword through the window: "Mind the glass. Cut
   me loose." Cut kelp (tutorial), he steps out, points at the
   Moonwheel on the hill: "Eight sockets. Eight phases. The Crescent
   fell into the bay — and the bay's gone dry. Walk out and get it."
4. **Objective ping**: sword glows toward the bay. HUD quest line:
   "RECOVER THE CRESCENT HORN — 0/8 PHASES RESTORED".
5. **The Dry Bay**: fight 2 enemy types — **Scorch Crabs** (skitter,
   telegraphed pinch lunge) and **Glare Wisps** (drifting sun-motes
   that dive; they pop into harmless sparkles in shade). Secrets: a
   shipwreck chest (+1 heart container), salt crystals (sparkle
   pickup, count toward nothing yet — future currency, save them).
6. **Tidepool Grotto** (mini-dungeon, SHADED interior — relief is
   audible: heat hum stops): one environmental puzzle — a fallen
   **mirror-shell** you rotate (✕ hold) to bounce the one hard
   sunbeam from the ceiling crack onto a dried kelp wall, burning it
   away. Teaches: the sun is a tool here, not just an enemy.
7. **Boss: the SUNSTRUCK KING-CRAB** — hermit-crab the size of a
   boat wearing the CRESCENT HORN as its shell. Sun-maddened, not
   evil. Three-phase kid-fair fight (telegraphed claw slam → hit the
   claw; it burrows/charges → dodge-roll; wisps join in phase 3).
   Beaten, the madness lifts — it blinks, bows, hands over the
   Crescent, and scuttles into a shady pool. (Nothing dies in
   Brightharbor.) ONE lore hint on the grotto wall behind it: a
   huge old carving of the moon with a CHAIN wrapped around it,
   leading down. No explanation. (That's the series hook.)
8. **THE PAYOFF** (the slice's whole reason to exist — spend polish
   here): carry the Crescent to the Moonwheel, slot it (✕):
   cinematic beat — the wheel turns one notch, a low bell tolls,
   and the world CHANGES in three visible ways at once:
   a. The sky dims one-eighth toward dusk; horizon warms; ONE star
      appears (the first in a year).
   b. **Every shadow in the world stretches** — shade pools visibly
      grow (~30% larger healing zones, asserted in harness). The
      camera should catch shadows lengthening across the village.
   c. **One tidepool at the bay's edge refills with real water** —
      and a moonfish jumps once, catching the new starlight.
   Granny Tock, from the village below: audible yawn. Pearl:
   "...is that a star?" Save point. HUD: "1/8 PHASES RESTORED".
   Finn: "The Half Shield fell past the Parched Forest. They say
   the tide follows it home. Rest first. Or don't — it's not like
   it gets dark." → TO BE CONTINUED card (silhouette of the flooded
   bay-to-come) → back to playing (free roam, secrets remain; the
   refilled tidepool stays, shadows stay long).

## Controls (locked)

Pad: left stick = move (camera-relative). ✕ = sword swing (3-hit
combo) AND context interact/talk when prompted. ○ = dodge-roll
(i-frames, kid-generous). △ = moonglass pulse (objective compass).
START = pause. Never SELECT+START / home (shell owns them).
Keyboard: WASD move, J or Space = attack/interact, K or Shift =
roll, L = pulse, Esc/P = pause. Touch: injected touchpad-v1 only —
no custom touch UI.

## Camera (locked)

Close third-person follow: ~3.2m behind, ~1.9m up, looks at chest
height; lerped; swings gently behind movement direction with slight
look-ahead; pulls closer indoors (Grotto). No manual camera control,
no lock-on in v1 — sword arcs are generous instead. Never clips
through walls (simple sphere-cast pullback).

## Combat & kid-proofing (locked)

3-hit combo, visible glass-blade arc trail, hitstop 3 ticks, sparks,
knockback, PW2-style rumble table (guarded). 5 hearts; hit = 1 heart
+ i-frames + knockback. 0 hearts = "sunstruck" — screen whites out,
wake in nearest shade with 3 hearts. No death word, no game over.
Shade heals 1 heart / 4s. Enemies respawn only after leaving the
area. Boss checkpoints at each phase.

## Persistence

localStorage `fallenmoon_save_v1` (try/catch): quest step, phases
restored, heart containers, chests opened, salt crystals, sword
obtained, last shade spot. Continue seamlessly on relaunch; title
shows CONTINUE when a save exists.

## 1P only (decided)

The slice is single-player; drop-in 2P doesn't fit a Zelda-like yet.
(Future: Pearl as P2 with a slingshot. Not in v1.)

## Tech (Powder Peak/PW2 recipe, verbatim — non-negotiable)

three.js r147 inlined (three.min.js vendored in repo) in its own
<script> before game code. Fixed 1280x720 backbuffer, pixelRatio 1,
antialias false, stencil false, CSS-transform letterbox (#stage).
World = merged BufferGeometry chunks, MeshBasicMaterial + baked
vertex colors (bake the hard-noon light + colored shade INTO the
verts), no normals/UVs. Only Wick + NPCs + enemies Lambert-lit (1
directional + 1 hemisphere, CONSTANT — arena/mood via baked colors
and fog only, per PW2 skin-tone lesson). NO shadow maps — blob
shadows. Sky dome low-seg, vertex gradient; the 8-step sky dimming =
re-lerp the dome/fog/hemisphere colors (cheap, dramatic). Fog is
load-bearing. Fixed 60Hz accumulator sim (≤5 catch-up), decoupled
render. Pooled Float32Array particles (sparks, shimmer, sparkles,
star). No per-frame allocs; scratch vectors. matrixAutoUpdate=false
statics. Budgets: ≤80 draw calls, ≤120k tris, asserted via
renderer.info in harness. Telemetry on window.__fm (tick, state,
pos, hearts, quest step, phases, calls, tris, fps, dialogue id,
boss phase, skyStep). LOWFX halves particles, kills shimmer.
Chunked world visibility by distance (Powder Peak tile culling).

Audio: all WebAudio synth (lazy ctx): heat hum (open sun), cool hush
(shade), sword whoosh/glass chime, crab clicks, boss thumps, the
BELL TOLL for the wheel, one gentle 5-note "night theme" fragment
when the star appears. Sparse music: ambient pads day-side, tiny
music box motif in shade. SpeechSynthesis NOT used (NPC dialogue is
text bubbles — short).

## Verification additions (beyond house standard)

Real-input CDP gates: full slice walkthrough start→Crescent→wheel
(pad alone, then keyboard alone); shade healing tick observed; hit →
sunstruck → shade respawn; kelp cut; chest + heart container; mirror
puzzle solved by held rotate; boss all 3 phases via real dodges/hits;
**sky-dim payoff asserted by sampling sky pixels before/after
slotting** (delta must be visible); save persists across reload
(CONTINUE resumes at quest step); pause; touch pass; perf sampling
in village, bay fight, and boss. Screenshots: title, village, dry
bay combat, grotto puzzle, boss, THE PAYOFF (wheel + dimmed sky +
star), each LOOKED AT against the bar: "beautiful and slightly
wrong; a real place, not a tech demo."

---

# v2 — PLAYABILITY OVERINDEX (decided 2026-08-09 from the family's
first playtest; John's directives, locked)

Verdict from play: graphics impressed, playability failed. v2 rule:
**every minute of work goes to how it FEELS to walk, look, and fight.
Story depth is explicitly deprioritized.**

## 1. You START with the sword (the #1 failure)
The Moonglass Sword begins on Wick's back, visibly sheathed; first ✕
draws it with a flourish. No fetch, no mystery. Finn's beat becomes
pure flavor + tutorial: he teaches the △ pulse and gives a heart
container. The kelp door now just hides a chest. Nothing gates combat.

## 2. Full two-stick camera control (Minecraft/modern-Zelda standard)
- Right stick = camera orbit: rx yaws freely 360°, ry pitches
  (clamped ~ -25°..+60°), smooth, invertible-none (default off).
- Movement stays LEFT-stick, camera-relative.
- NO autonomous camera movement while the right stick has been
  touched in the last 3s. After that, only a very gentle drift back
  behind the walk direction while moving — never while standing.
- Keyboard: mouse-look (pointer lock on first click, Esc exits to
  pause as usual) + arrow keys as no-mouse fallback.
- Touch: drag anywhere on the right 60% of the screen = camera
  (direct-manipulation gesture; coexists with touchpad-v1 left
  stick). Pinch ignored.
- Camera collision (sphere-cast pullback) kept from v1.
- Ghost Patrol is prior art on the console for right-stick use.

## 3. Enemies must READ as creatures (the "fireflies" were Glare
Wisps rendering as bare glow sprites)
- Glare Wisps → **SUN IMPS**: small-dog-sized critters with real
  bodies — round ember torso, stubby horns, two dark eyes, buzzing
  dragonfly wings, little grabby hands. Clear dive telegraph
  (rear-up + brighten + chirp), pop into a satisfying sparkle-burst
  with a squash frame when hit. Still fizzle harmless in shade.
- Scorch Crabs: 25% bigger, oversized left claw, louder telegraph
  (claw raise + click-click), shell-flash on hit.
- MORE encounters: 3-4 imp clusters and 3 crab patrols across the
  bay; they respawn on area re-entry. Fighting should be the default
  activity of a play session.
- Every hit: generous hitbox, arc-trail swoosh (see 4), hitstop,
  knockback, sparks, rumble. Kill feedback is the product.

## 4. The swoosh
Layered sword feel: crescent arc-trail mesh (additive, fades in
~120ms), whoosh = filtered noise sweep + a faint glass chime (it's
moonglass), impact adds a low thunk + spark burst. Third combo hit
gets a bigger trail + deeper whoosh. This is the thing John asked
for by name — make swinging feel great in the FIRST second.

## 5. Fix the missing-wall rendering bug
Some house walls vanish from certain angles (backface winding).
Audit every building shell; fix windings so all structures read
solid from all camera angles (now critical since the camera is
free). Add a harness gate: orbit the camera 360° around each house
at two pitches and pixel-sample wall presence (no sky reading
through a facade).

## 6. Wick v2 (John: "look at Zelda, make him cooler")
Reference BotW Link proportions (~6.2 heads, slightly broader
shoulders): layered tunic with belt + buckle, scabbard visible on
the back (sword rests in it out of combat), sturdier boots, fuller
sculpted hair with a swept fringe, scarf kept. Idle relaxed; draw
animation on first attack. He should read HERO in silhouette.

## 7. Playability polish
- Floating objective marker (small moon-mote beacon) above the
  current goal, always visible; quest banner stays.
- Dialogue even shorter (≤2 lines); all NPC beats skippable.
- Roll cancels attack recovery; attack buffers during roll.
- Camera FOV nudged for action (~66°).
- Everything else from v1 (payoff, grotto, boss, save) unchanged
  except where the above touches it. Boss arena benefits from the
  same enemy-readability pass (wisp adds in phase 3 become imps).

## v2 verification additions
Right-stick orbit gates (yaw/pitch move, movement stays camera-
relative, no auto-drift while stick active); mouse-look gate;
touch-drag camera gate alongside touchpad movement; sword-from-
start gate (attack works within 2s of spawn on a fresh save);
house-orbit wall-integrity gates; imp/crab readability screenshot
set reviewed against "reads as a creature at gameplay distance";
swoosh trail visible in a mid-swing screenshot; all existing gates
stay green (Finn beat updated). Old saves migrate (swordless save
state grants sword on load).

## v2 addendum — THE OPEN LOOP (John, 8/9 late: locked, overrides
any conflicting beat structure above)

The core loop, in priority order: **walk around → slash stuff →
(eventually, at the player's own initiative) talk to somebody.**
Story progression is a thing the player WALKS UP TO, never a funnel.

- NO quest banner, objective marker, or directive text at spawn.
  Spawn = sword on back + interesting world + something slashable
  within 20 seconds (kelp clusters everywhere, a crab scuttling
  nearby, imps over the first dune).
- NPCs never stop you, gate you, or call out. They exist; a small
  "✕" prompt appears only when YOU approach. All story is player-
  initiated. Talking to Finn is what STARTS the Crescent thread
  (that's when the quest line + moon-mote beacon appear — a reward
  for curiosity, not homework).
- The world itself carries the premise wordlessly: pinned sun,
  beached boats, shade pools, the empty Moonwheel visible on its
  hill from spawn. Kids who never talk to anyone still have a great
  time slashing; kids who get curious find the adventure.
- Success metric for the slice: a kid who ignores every NPC has fun
  for 10 minutes. A kid who talks to Finn finds the whole Crescent
  arc unchanged (grotto, boss, payoff all intact).

---

# v3 — FEEL & CLARITY REV (decided 2026-08-10 from John's second
playtest; locked. His frame: "keep nailing core gameplay, story
comes later." Priority order below is the build order.)

## 1. Fix the spawn wreck (photo evidence: reads as a floating
broken husk with a detached plank; Wick's head clips into it)
Rebuild as a proper beached rowboat lying on its side, hull ON the
ground, visible ribs and keel, sand drifted against it — an obvious
lean-to shelter. Spawn Wick BESIDE it, framed clear of any geometry.
No part of the wreck may float; no spawn-camera clipping.

## 2. Controls rev (locked mapping)
- ✕ south — sword / talk (unchanged)
- ○ east — **SPRINT** (hold-to-run), replacing dodge-roll entirely.
  ~1.6x speed, Wick leans into it (slight crouch, scarf streaming,
  dust kicks at his heels). Attack from sprint = small lunge.
- □ west — **JUMP** (new; was unassigned). Real jump ~1m with
  landing squash; clears kelp and low rocks; can hop onto crates,
  low walls, and prop tops where sensible (simple height targets).
  Double-jump: NO. Air attack: allowed, same swing.
- △ north — **MOON COMPASS** (renamed EVERYWHERE from "moonglass
  pulse" — John: "no idea what that means"). Press: a stream of
  silver motes arcs from the sword toward the current objective +
  soft chime. Pre-quest it swirls and drifts toward the Moonwheel.
  First use shows one caption: "The moonglass tugs toward
  moon-stuff." Comprehensible from its OWN feedback.
- Keyboard: Shift sprint, Space jump, J/click attack, L compass.
- Roll is gone; remove its gates; sprint inherits escape duty
  (generous hearts + shade healing keep combat kid-fair).

## 3. Crabs must be satisfying to kill (they look great, they're
too hard to hit)
Root causes to fix together: (a) sword hit volume gets a VERTICAL
band from ground to overhead — Wick can no longer swing over a
low crab; (b) crab hurtbox +40%; (c) swing arc slightly wider.
Contact must be unmistakable: white shell-flash, big spark burst,
crunch layer, knockback hop, brief hit-pause. New gate: at neutral
range, a single swing at a crab registers a hit 100% of attempts
(20 trials, varied bearings). Imps stay as-is (John: tuned right).

## 4. Pickups must be unmistakable
Salt crystals (collectible) vs decorative crystals/rocks currently
confuse. Collectibles: moon-pale glow, gentle bob + spin, sparkle
motes, soft chime within 2m, pop-and-count on collect. Decor
crystals: duller, static, earth-toned. A kid should never walk up
to decor expecting a pickup.

## 5. Smooth + detail the world (same rev, opposing pulls, both real)
- Terrain: kill the hard polygon seam between desert and village
  grass — blended transition band with scattered tufts; higher
  mesh resolution near the village.
- Kelp sprigs (read as "cactuses"): smoother, curved blades, more
  segments.
- Buildings: smoother silhouettes AND more detail — door frames,
  shuttered windows, roof-tile hint lines, chimneys, eaves.
- Watch the budgets (≤80 calls / ≤120k tris); spend tris where the
  camera lives (village, spawn, bay path).

## 6. Walk animation rev
Heel-toe weight, counter-rotating arm swing, subtle hip sway and
head bob. Sprint lean per item 2. Idle stays.

## 7. STRETCH (only after 1-6 green): first interiors
Finn's lighthouse ground room + one village house enterable: door
prompt ✕, quick fade, small furnished room (table, lamp, cot, one
chest with salt crystals), fade back out. Interior = separate
culled chunk; camera pulls close. If budget or time objects, ship
1-6 without this and note it.

## v3 addendum — 1.5: GROTTO COLLISION + FACE BAKE (John's photos,
8/10, locked): grotto walls had no player collision — walkable
straight through rock into the void and out to the boss arena,
skipping the puzzle gate; clipped-into faces render flat saturated
blue (unbaked). Fix: solid-means-solid collision everywhere (incl.
under the new jump — no jumping through ceilings/over walls into
void), proper cave bake on all interior faces, collision-fuzzer +
interior-orbit gates. The mirror-shell puzzle and its haptics are
untouchable — John called them out as a favorite.

## Standing principle — CINEMATIC BEATS (John, 8/10, after first
completing the Crescent: "really good... when things substantial
happen like that, we should have a little animated sequence")
CONFIRMED APPROACH: every substantial moment gets a short authored
camera sequence in the style of the Moonwheel payoff (continuous
drift, world-change visible in frame, no text). Future substantial
moments that qualify: each new phase slotted (each with its OWN
world-change spectacle per the phase table), first entry to a major
new region, boss intros/cures, the finale night. Keep them short
(≤12s), skippable after first viewing, and always SHOW the change.
The TO BE CONTINUED card style is also confirmed ("fantastic").
The payoff itself: "could be a little better" — fair game to polish
in a future rev, never regress.
