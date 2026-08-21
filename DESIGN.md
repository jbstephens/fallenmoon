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

---

# v4 — BOSS TRUTH & INTERIORS (decided 2026-08-14 from third family
playtest; locked; auto mode "go go go")

Confirmed keepers from this playtest: houses, vegetation, small-crab
combat ("I can kill the smaller crabs now, which is great").

## 1. THE KING-CRAB MUST TAKE DAMAGE (Ben slashed for 10 minutes,
zero damage — worst possible playtest outcome)
Root truth to fix: if boss damage is gated (claw-only windows, or a
dormant/inactive state that ignores hits), that gating must become
LEGIBLE or die. Locked design:
- Body hits ALWAYS do chip damage (small but real, with full hit
  feedback). Claw hits during slam-recovery windows do 4-6x. The
  claw weakness is telegraphed (claw glows after a slam; first
  body-hit shows a one-time floatText "Hit the CLAW when it
  slams!").
- If the boss can be reached while dormant/inactive, proximity
  ALWAYS wakes it (no quest-state excuses — anyone standing in the
  arena gets a boss fight).
- Gate: a "kid bot" that ONLY body-slashes must be able to win the
  whole fight (slowly); the claw-aiming bot wins faster. Both via
  real input, damage asserted every phase. Plus a dormant-approach
  gate: walk in with ANY save state → boss wakes and takes damage.

## 2. BOSS HP BAR — new standing convention for ALL bosses
Top-center boss health bar during boss fights: boss name ("THE
SUNSTRUCK KING-CRAB"), chunky segmented bar, visible damage ticks,
phase notches at the phase thresholds, brief flash on hit. Appears
on wake, drops away on cure. Every future boss uses this.

## 3. GROTTO WALLS: finish the job (mixed solidity is worse than
none — "some walls work, others you can still walk through,
disorienting")
The v3 fuzzer sampled spots; the leak means coverage has holes.
Fix: make the ENTIRE grotto massif + boss arena perimeter one
authoritative solid region (single source of truth for both
collision and geometry — no hand-kept second copy), with the only
openings being: the entrance walkway and the post-burn corridor.
New gate: dense perimeter fuzz — sample every ~1.5m along ALL
interior AND exterior boundaries (walking + jumping + sprint), zero
penetrations; plus a "corridor is the only path" reachability
assert (flood-fill from entrance must not reach the arena until
wallBurned).

## 4. IDLE FEET BUG — feet visibly walk while standing still
Fix the gate: locomotion pose weights must be exactly zero at rest
(walkPhase/pose blend decays fully; no residual leg oscillation).
Gate: capture leg joint rotations over 2s of true idle — max delta
below a visible-motion epsilon (breathing/head-look exempt).

## 5. INTERIORS — REQUIRED this rev (John: "include walking into at
least one of the houses")
At least ONE village house enterable end-to-end: door prompt (✕),
short fade, furnished room (table, cot, lamp, rug, shelf, a chest
with salt crystals), walk freely, fade back out. Interior is its
own culled chunk; camera pulls close; budgets hold. Finn's
lighthouse ground room too IF it fits cleanly; one house is the
requirement. Same collision authority as item 3 (no walking
through interior walls, obviously).

## 6. Small guard from last session's lesson
NEW GAME with an existing save asks "Overwrite the saved
adventure?" (✕ confirm / ○ back). One modal, pad+keyboard+touch
navigable. Protects family saves from blind confirms (I proved the
failure mode personally).

---

# v4.5 — EVERY DOOR OPENS (decided 2026-08-15, John: "make the rest
of the houses interiors. Differentiate them. Put things to do in
them.")

All remaining village buildings become enterable via the proven v4
door/fade/chunk pattern. Each room is SOMEBODY'S — differentiated by
its resident's story, told through objects, not text. Every room has
at least one thing to DO. All interactions are ✕-prompted, ≤1 line
of caption, saved where it matters.

1. **GRANNY TOCK'S HOUSE** — the house of stopped time. Walls of
   stopped clocks (all reading different times — none has moved in
   a year), knitting basket with an absurdly long scarf spilling
   across the floor, kettle at the cold hearth, rocking chair.
   DO: wind the big floor clock (✕, crank sfx) — it ticks for a few
   seconds then dies; Granny's voice from outside: "You hear that?
   ...lovely." (one line, warm). A small chest: salt crystals.
   Secret: her knitting scarf pattern is moon phases.
2. **PEARL'S FAMILY HOUSE** — a kid's world. Bunk with a boat-sail
   blanket, floor of chalk drawings — stars the way she imagines
   them (wrong: five-pointed, smiling), a toy boat on a rug "sea,"
   a jar of fireflies long empty. DO: pick up the toy boat (✕) —
   Wick sets it in the window facing the dry bay; open the star
   chart on the wall (✕): it's blank parchment, caption "Nobody
   could draw them for her." Chest under the bunk: salt crystals.
   (After the Crescent payoff this house changes: one real star
   drawn on the chart — tiny world-fixing echo, if cheap to do.)
3. **FINN'S LIGHTHOUSE — ground room** — the keeper's kit: coiled
   rope, oil cans, a logbook desk, spare lamp lenses, stairs up
   (blocked by crates + one line: "The lamp room can wait for a
   lamp worth lighting."). DO: read the logbook (✕): last entry a
   year old — "Day 1 without night. Light not needed. Keeping it
   clean anyway." Chest: a HEART CONTAINER (the village's one big
   find — earned by curiosity, John's open-loop philosophy).
4. Harbor house (v4) stays as-is; add ONE differentiator so it's
   somebody's too: fisherman's oilskins + a net-mending bench, DO:
   sit on the bench stool (✕, Wick sits, camera rests a beat).

Rules: every door gets the ✕ ENTER prompt + doormat; interiors are
culled chunks with solid-by-construction collision (v4 authority
pattern), shade-sanctuary inside, budgets hold (≤80/≤120k measured
in every room); chest/interaction state persists in the save; all
interactions reachable pad-alone, keyboard-alone, touch. Cinematic
beats principle applies at its smallest scale: interactions get a
tiny camera acknowledgment, never a text dump.

---

# THE SAILING SPINE (decided with John, 2026-08-15 — his words:
"this is the thing that makes this game amazing")

CONFIRMED: restoring the Half Shield brings the tide home, and the
returned sea becomes the game's traversal system. We bring the water
back, then we USE it — regions beyond Brightharbor are reached by
BOAT, as landfalls along a coastline that becomes the world map.

- THE boat: the beached rowboat Wick wakes under at spawn — dead on
  the mud since the game's first second — floats when the tide
  returns. The shelter becomes the ship. (Non-negotiable beat.)
- Sailing compounds with later phases: Gibbous Bell = sunset sails;
  Full Mirror = nocturnal sea-life surfacing alongside; finale =
  sailing home under the first moonlit sea.
- Access model: barriers ARE the broken world; healing dissolves
  them (tide = coastal regions; re-greened forest = inland paths;
  cooled badlands = final region). Open question for John, parked:
  hard-gated regions vs reachable-but-hostile early entry.
- Pacing: ~one region per rev. Phase-2 rev = the Half Shield
  (region + guardian + the flood transformation + first sailing).

## REGION SCALE MANDATE (John, 8/15: sightlines AND square footage)
Locked for the Parched Forest and every region after: playable area
≥ 1.2km x 0.9km (roughly 25-30x Brightharbor's slice). A straight
sprint across it should take 3+ minutes; a real exploration of it,
an hour+. Sightline discipline on top: ridgelines/gorges/canopy
block vision so no vantage shows more than ~a fifth of the region;
2-3 far landmarks pull the player; deliberate quiet stretches
between content clusters (emptiness with a visible destination is
what "big" feels like). Density stays Zelda-sparse, not jam-packed:
the region should hold ~a dozen content clusters (camps, shrines,
secrets, the riverbed spine, the guardian's dungeon), not a prop
every ten meters. Chunked terrain + distance culling per the
Powder Peak recipe; budgets unchanged (≤80 calls / ≤120k tris per
frame — the world is big, the FRAME never is).

## SCALE MANDATE v2 (John pushed on the square law, 8/15 — he's
right: 3-minute crossings read "crossable," and crossable kills big)
Parched Forest target raised: **≥ 2.0km x 1.4km** (≈60-75x
Brightharbor's slice). Straight-line sprint crossing ~7-8 minutes —
but no crossing is straight: the winding riverbed spine, ridges,
gorges and hostiles make the first real traverse 20-30+ minutes.
Landmark spacing scales up with it (you should sometimes walk 2
minutes toward a thing you can see). Content clusters ~15-18 for
the bigger canvas, still Zelda-sparse. Frame budgets UNCHANGED —
area is nearly free under chunked culling; only authoring and
journey time grow, and journey time is the point.

---

# PHASE 2 — THE PARCHED FOREST & THE HALF SHIELD (locked 2026-08-15,
John: "build it. LFG!") — TWO-NIGHT BUILD

## Night one: THE REGION (this build)

**THE PARCHED FOREST** — region east of Brightharbor, over Cinder
Pass (a walkable saddle in the hills at the current map's east edge;
one signpost, no gate: reachable-but-hostile from minute one).
Scale per mandate v2: ≥2.0km x 1.4km, ~15-18 content clusters,
sightline discipline (ridges, gorges, canopy), 3 far landmarks.

**The land**: a great pine forest heat-stressed for a year — bleached
trunks, rust needle-carpet, cracked clay clearings, no birdsong.
**The spine: the SILVERRUN** — a dead river you walk UP: a winding
dry bed ~2.5km from the pass to the region's crown, past stranded
waterwheels, a beached ferry barge, fish-drying racks with nothing
to dry. It ends at **THE DRIED FALLS** — a 60m stone lip with no
water, the region's great landmark, visible from half the forest.
Behind/under it: the plunge-pool basin where the Half Shield fell —
**sealed by rockfall in night one** (one line: "The stones here
fell recently. Something under there hums.") — night two opens it.

**Landmarks**: the Dried Falls (crown), the FIRE-WATCH TOWER
(climbable via stairs; from the top, the region reveals itself —
and you can just see the sea-line beyond Brightharbor), the GREAT
CEDAR (a colossal dead tree on the south ridge, hollow inside,
secret chamber with a heart container).

**Hostile tier (the survivable-brutal contract)**:
- **SWELTER**: in this region's open-sun stretches hearts drain
  slowly (1 heart / 20s, region-only). Canopy shade, rock shadow,
  and SHADE SPRINGS (six tiny oases: a seep, ferns, one live green
  tree each) are fully safe, heal, and act as respawn anchors +
  save checkpoints. Sunstruck = wake at last spring, keep
  everything. Shade-hopping IS the traversal puzzle.
- **CINDER BOARS**: new enemy — big, charging, long telegraph
  (paws the ground, huffs ember-smoke, then a straight rush).
  3 hits to cure (they shake off the madness and trot away, per
  the nothing-dies rule). Hit hard (2 hearts). Jump or sidestep
  the charge; a charge into a tree stuns them (kid-discoverable).
- **EMBER HORNETS**: fast imp-family fliers, dive in pairs, pop
  satisfyingly. Cluster near the falls.
  (Regular imps + a few crabs range the pass as the on-ramp.)

**One NPC**: **the FIRE WARDEN** — a weathered woman who never left
her tower ("Somebody has to watch for a fire. Everything is one.").
≤2-line dialogues; sells nothing yet; hints the falls hum. She logs
the swelter rule for the player in one line: "Walk shade to shade,
kid. The sun doesn't blink out here."

**Content clusters (~15)**: Cinder Pass camp (abandoned), waterwheel
mill (chest), ferry barge (chest + hornets), drying-rack hamlet
(salt seams), tower, Great Cedar (heart container), 3 boar glades,
hornet hollow, 2 secret shade grottos, salt-crystal seams, the
falls forecourt (sealed basin + the hum), scattered vista knolls.

**Tech (extends, never replaces)**: second terrain zone in world
space east of Brightharbor with continuous ground at the pass;
chunked at Powder Peak scale; the region's chunks + creatures cull
hard; budgets unchanged. Region id in save; shade-spring anchors in
save; __fm gains region/swelter/springs telemetry; __fmDebug.warp
works across zones for the harness.

**Night-one gates (added to harness)**: pass traversal on foot both
ways; scale asserts (bounding extent ≥ 2.0x1.4km, sprint-crossing
tick-time in range); sightline gate (from 6 sampled vantages, ≤20%
of cluster landmarks visible); swelter drain/refuge/sunstruck-at-
spring; boar charge telegraph + jump-dodge + tree-stun + 3-hit cure
via kid-bot; hornet pair fight; tower climb to top (jump/stairs);
cedar heart container; all chests/persistence; falls-basin seal
(unreachable interior, the hum line fires); Warden dialogues; perf
worst-frames across 8 forest sample points + the pass; full
Brightharbor regression (everything v4.5 stays green); zero console
errors. Ships with the falls sealed — kids explore night one's
region while night two builds.

## Night two (next build): THE HALF SHIELD
Falls-basin dungeon (behind the rockfall: a water-carved hollow,
puzzle language = light through dry water-channels), the guardian
(design TBD next session with John's kids' verdicts fresh), the
Half Shield relic, carrying it home, the FLOOD (the tide returns:
bay transforms — water, floating boats, submerged grotto path,
cartographer's maps wrong), the wake-boat floats, FIRST SAIL
tutorial, sailing system v1. Gets its own locked design before it
runs.

## SWELTER FEEDBACK — refined with John + Maria, 8/16 (locked)
Principles (Maria's): instructive not descriptive; never a single
missable prompt; safety gets its own positive signal.
1. WARNING BEFORE HARM: in open forest sun the heat vignette builds
   over the grace period BEFORE the first tick — you see it coming.
2. THE TICK TEACHES: swelter damage flashes the sun glyph on the
   hearts AND an instructive line — "TAKE SHELTER — TREES, ROCKS,
   SPRINGS" — rotating with variants, repeating (rate-limited, ~once
   per 20s of continued exposure), so missing one costs nothing.
   Distinct sharp haptic buzz, different from combat.
3. RELIEF IS CELEBRATED: stepping into canopy/rock shade/spring
   while sweltering fires an immediate cool blue-green vignette
   wash, a soft relief chime, a leaf glyph by the hearts, sizzle
   audio cuts to the shade hush, and a gentle double-pulse rumble —
   you FEEL the safety change hands, visually and haptically.
4. STATE ALWAYS LEGIBLE: while in open sun a small sun icon by the
   hearts fills toward the next tick; in shade it flips to a leaf
   and fades. No memory required, no reading required — a
   six-year-old tracks it by color and buzz.

---

# PHASE 2 NIGHT TWO — THE FALLS HOLLOW & THE TIDE'S RETURN
(locked 2026-08-16; John delegated the open questions — "apply all
the things we learned and go build")

## The dungeon: THE FALLS HOLLOW
Behind the rockfall: a water-carved cathedral that hasn't heard
water in a year. Vibe: eerie quiet wonder, puzzle-forward, two fight
beats (hornet nests). Curved flowstone galleries, dry plunge pools
strung like beads, petrified waterwheels of an older civilization,
salt-crystal chandeliers. Puzzle language: LIGHT THROUGH DRY
CHANNELS — sun shafts from cracks redirected by mirror-shells
(grotto's language, grown up) along channels the water used to take,
re-lighting carved water-glyphs to open the way down. One hidden
side-chamber (Ben-bait): a moonfish fossil in the wall + salt hoard.
ONE new mural clue, deliberately ambiguous: the moon being LOWERED
into the sea on chains — "to rest"? — no answer given (the chain
mystery stays open until John joins that decision, ~region 4).

## The guardian: THE SILT WYRM
The spirit of the Silverrun itself, gone rigid and sun-mad — a great
river-serpent of dried silt and tumbled stones, coiled in the last
basin, wearing the HALF SHIELD as a brow-plate (the crab precedent).
- Signature move (the learnable): it SWIMS through dry silt like
  water — visible dorsal wake of rising dust + rumble — and erupts
  beneath you. Counter: stand on the stone slabs (it cannot swim
  through stone). Teaches terrain-reading. The wake IS the
  visibility contract: if it can strike, its wake is on screen
  (no-invisible-damage invariant applies).
- Phase 2 adds a tail sweep (jump it); phase 3 calls dust-devils.
- Boss conventions in full: HP bar, phase notches, chip damage on
  any hit + big damage on the brow-plate during post-erupt daze
  (glowing telegraph), kid-bot-wins gate, proximity wake, sunstruck
  checkpoints per phase.
- The cure is the payoff: cured, the Wyrm DISSOLVES INTO WATER —
  the first free water anyone has seen — bows as a wave-form, and
  leaves the Half Shield floating in a suddenly-wet pool.
  (Foreshadows the flood by minutes.)

## The homecoming: THE TIDE COMES HOME
Carry the Half Shield down the Silverrun (it hums; moon compass
sings) → Moonwheel → slot (✕):
1. Authored cinematic (≤12s, skippable after first view): wheel
   turns second notch, bell, sky dims another eighth, SECOND star —
   then the horizon: a silver line, rushing in. Boats lift on the
   bay as the sea pours home. Grotto mouth drinks the tide.
2. Playable joy-beat, no fail state: run down to the bay as the
   last stretch fills around your ankles; the WAKE-BOAT — the one
   you slept under on frame one — lifts, rights itself, and bobs.
   Pearl arrives breathless. The bay is OCEAN now.
World-state (all through applyWorldState, bidirectional, save-
derived, sky=2): bay water plane at design waterline; boats float;
old seabed content relocated (salt to shorelines, kelp gone under,
crabs to beaches, wisps hover water); grotto interior stays dry
(waterline below its floor — everything v1 remains completable);
cartographer's wall map gains a hand-drawn NEW blue line (he was
wrong, the good way); tidepool subsumed by the real sea; Pearl's
chart untouched (her star remains). New Game must fully un-flood.

## SAILING v1
The wake-boat is pilotable on the bay: ✕ at the boat to board/
disembark at shores, stick steers, ○ holds for full sail (the
sprint of the sea), gentle drift physics, camera pulls back behind
the boat, wisps fizz over open water and can't follow. The open sea
edge is a soft boundary: swells turn you back + one line ("The open
sea wants a better keel. Someday.") — the hook for phase 3
landfalls. Maiden voyage: Pearl begs aboard and rides the first
launch — one gentle guided lap of the bay with her two-line
wonder-dialogue, then sailing is free forever, with or without her.
Water rendering: flat animated color bands + sparse highlight
quads, zero transparency tricks beyond one alpha plane, budgets
unchanged (≤80/≤120k) — measured while sailing at full clip.

## Process law for this build (the week's lessons, non-negotiable)
- ONE ground authority: every new walkable surface (dungeon floors,
  shores, boat deck) via the makeMeshField pattern or explicit
  solid regions; rendered==physics to 0.0000m, gated.
- No impression geometry inside playable space, ever; flooded-bay
  water obeys the same pairing rules.
- Walked-journey verification with structural-experience questions
  (dense grids + real walked/sailed paths + 4 azimuths + never-
  enclosed + frame-sequence review), both regions + dungeon + bay
  under sail.
- Maria's hazard rules for ANY new hazard.
- applyWorldState carries every new flag; the John-sequence gate
  (completed save → NEW GAME → world fully fresh) extended to flood
  state both directions.
- Cinematics ≤12s, skippable, show-don't-tell.
- Deploy marker: build-unique string, verified ABSENT from the
  previous bundle before polling.
- Family q4 save must continue seamlessly into all of this.

## FLOOD HANDOFF AMENDMENT (John, 8/16: "like the start of
Uncharted 4... and I will love you forever" — locked)
The flood cinematic and the joy-beat are ONE continuous shot with an
invisible control handoff: authored camera sweeps the returning sea,
dives downhill past Wick (already running, in his own run animation,
at his own speed, on a player-plausible path), settles into the
follow-cam — and input is live before the player knows it. Stick
input during the swing accelerates the blend and takes over
instantly. No cuts, no fades, no prompts; the only tells are one
soft haptic pulse at control-live and letterbox bars (if any)
sliding away at that exact instant. No-input path: Wick eases to a
stop, so the "wait, is this me?" discovery works both ways.
Principle for all future cinematic-to-play moments: handoff is a
DISCOVERY, not a transition.

---

# PHASE 3 — THE CROSSING & THE HOURLESS ISLES (locked 2026-08-16 with
John, built in one night at his direction: "build all of this tonight,
high fidelity, you have the reins")

John's notes drove every choice here. The through-line: the sailing
region has to EARN its size — a visible upgrade, a sea that behaves
like a sea, things to fight on the water, and one reveal that resets
what the player thinks this game is about.

## THE REVEAL (the reason this rev exists) — THE DROWNED MOON
Partway across the open ocean the water goes clear and deep, and you
sail over a colossal pale sphere resting on the seabed, WRAPPED IN
CHAINS, half-buried in silt — too big to fit in frame. You cannot
reach it, fight it, or touch it. As you pass, the bell towers ahead
begin ringing BY THEMSELVES, one after another across the water,
because the moon is close.

What it means (locked, and it spends the chain mystery John reserved —
he approved this on 8/16): the moon did not only break. A piece of it
was LOWERED and left there, deliberately, and the islanders built bell
towers above it to keep vigil. Their hours were never for people. The
eighth phase — the NEW COIN, the one that brings the night — is down
there, and the player knows it from region three onward and cannot
have it for five more phases. WHO chained it and WHY stays unanswered.

Cost is near-zero: one dark sphere + chain rings under the existing
alpha water plane, seen once, inside an authored camera move.

## THE KEEL (John: the upgrade must be VISIBLE — a keel is under the boat)
Chicken-and-egg solved: the keel is salvaged INSIDE the bay, with the
boat you already have.
- The DROWNED SHIPWRECK in Brightharbor bay — the one you looted on
  foot when the bay was dry — is the only ocean-going hull anyone has.
  Sailing to it and disembarking onto its deck is already built + gated.
- ✕ on its keel timber → Wick pries it free (micro-cinematic ~4s) →
  carry it (Half-Shield carry rules) to the beach by the wake-boat.
- THE REFIT (authored cinematic ≤12s, skippable after first view):
  FINN steps a second mast with you, bends on a second sail, fits the
  keel. Ends on the boat rocking, two sails furled. Warm, wordless.
- Save: keelFound → keelCarried → boatRefit.

## THE DOUBLE SAIL (John's own idea; ○-hold full sail is his favourite
thing in the game, so the upgrade lands ON that button)
Second mast + second sail, deeper hull, visible at rest as two furled
sails. ○ held now raises BOTH: top speed 6.8 → 9.6, louder whoosh,
heavier spray, stronger rumble. The upgrade is felt through the
control he already loves, not read in a menu.

## THE OCEAN MUST FEEL LIKE OCEAN (John: not monotonous; sometimes a
big wave, sometimes not; a little challenge threading them)
- Bay stays calm. Outside SEA_EDGE the SWELL turns on.
- SWELL = sum of 3 sine components (different amplitude, period and
  heading) so it never reads metronomic, on a coarse displaced grid
  (≤48x48 verts) written in place into a pooled Float32Array — zero
  per-frame allocation, budgets unchanged.
- The boat HEAVES, PITCHES and ROLLS off the swell gradient at the
  hull. Spray scales with speed into the face of a wave.
- BIG SETS every 18-34s: telegraphed as a dark crest line on the water
  with a rising rumble. Bow-on at full sail = you stall, the sail
  spills, spray, hard rumble. Angled, or timed into the trough = you
  keep way. NEVER costs hearts — it costs SPEED. That is the challenge
  and it is kid-fair.

## THINGS TO FIGHT ON THE WATER (John: "I have no way to attack and
nothing to attack")
- ATTACK AFLOAT: ✕ while sailing swings from a braced boat stance over
  the gunwale — same swing, new pose, generous arc. Attack buffers and
  never capsizes you.
- SUN GULLS — sun-mad seabirds, dive in PAIRS from above with a clear
  rear-up + cry telegraph, pop into a feather-and-sparkle burst. The
  imp/hornet flier lineage, at sea.
- REEF GAR — runs at the hull showing ONLY A WAKE (the Silt Wyrm's
  visibility contract: if it can hit you, its wake is on screen), then
  breaches alongside into a swing window. Miss it and it rams: speed
  loss, knocked off heading, 1 heart. Nothing dies — cured gar dive
  away.
- Sunstruck at sea = wake at the last island or shore WITH the boat.
  No drowning, no loss, no death word. Ever.

## THE ISLES (region scale mandate applies: sea counts as playable)
THE HOURLESS ISLES — an archipelago WEST/SOUTHWEST of Brightharbor
(deliberately opposite the Parched Forest so no far-tier land ever
intrudes on the crossing). Playable extent ≥2.2km x 1.5km including
open water. Crossing from the bay mouth to first landfall ~900m.
Sightline discipline comes free: islands and haze block vision, and
the GREAT CAMPANILE is the far landmark that pulls you the whole way.

An old bell-keeping culture rang the hours from tower to tower, the
hour passing across the water like a wave. Silent for a year, because
there are no hours any more. Bleached timber, verdigris bronze,
salt-white stone, gull-streaked.

Islands (7 + the reef):
1. WATCHSTONE — first landfall, a jetty, one silent tower, the
   region's save/shade anchor.
2. KILN ISLE — the GREAT CAMPANILE and, beneath it, THE FOUNDRY
   (the dungeon). Sealed until you have rung Watchstone's bell.
3. THE DROWNED SPIRE — a tower standing up to its bell-lip in water;
   you sail INTO its belfry through a broken arch. Chest.
4. NETMENDER'S ROCK — tiny; the region's one NPC.
5. GANNET STACK — sea stack, the gull combat pocket.
6. THE LONG STRAND — beach, salt seams, a heart container.
7. CHIME REEF — half-drowned bells that ring in the swell as you pass.
   Pure atmosphere, no combat. The sound of the place.

ONE NPC: THE BELLWRIGHT — an old bell-founder who never left. She
oils towers that will never be rung. ≤2 lines per beat. She teaches
the tone-holding verb in one line and nothing else.

Island hostiles: CLAPPER CRABS (Scorch Crab family, wearing a small
bronze bell as a shell — they CLANG as they move, an audible
telegraph a six-year-old reads instantly, and the bell RINGS when you
hit it) and SUN GULLS ashore as well as at sea.

## THE FOUNDRY (dungeon) — the puzzle ESCALATES BY KIND, not by count
John: one shell, then two or three, so this one must combine
DIFFERENT verbs, not more of the same. Three kinds, one solution:
1. AIM — swing a mirror-shell to put a sun shaft down a casting
   channel (the grotto's language, third generation).
2. STRIKE — the lit channel reveals an ORDER; strike the hanging
   bells in it. Each bell flashes its own colour and tone when struck.
   Wrong order = a dull clank and it resets, no punishment.
3. HOLD — hold ✕ on the great bell to SUSTAIN a tone while the
   resonance door stands open, and walk through before it dies.
Colour + sound + a door visibly opening: solvable without reading.
Two hornet-class fight beats (gull nests). One hidden side chamber
(Ben bait): a bell-founder's mould room with a heart container and a
carving of the chained moon being lowered — the mural from the Falls
Hollow, from the OTHER side.

## THE GUARDIAN — THE HOUR TORTOISE
An ancient tortoise whose shell IS the GIBBOUS BELL (crab and wyrm
precedent: the guardian WEARS the phase). Sun-mad, in the casting pit.
- HP 84, phases 84 / 56 / 28. Boss HP bar + phase notches per the
  standing convention. Body hits ALWAYS chip. Proximity ALWAYS wakes.
- P1 signature (the learnable): it withdraws into the bell and ROLLS
  at you — a rolling, ringing bell, loud and telegraphed. Sidestep;
  it wobbles to a stop DIZZY with the bell's open mouth facing you =
  the weak point, 5x damage, glowing telegraph.
- P2 adds: slams the bell down → a shockwave RING across the floor →
  JUMP it (reuses the jump verb, as the wyrm's tail sweep did).
- P3: rings a TONE that calls gulls.
- Kid-bot gate: body-slashing alone must win the whole fight.
- THE CURE: it stops, withdraws, sets the bell down gently, and the
  bell TOLLS BY ITSELF — the first hour struck in a year — then the
  tortoise trundles into the sea. Nothing dies.

## THE PAYOFF — THE SUN MOVES (authored cinematic, the phase's crown)
Sail the Gibbous Bell home; slot it at the Moonwheel (✕):
1. Wheel turns the third notch, the bell tolls, sky dims a third
   eighth, THIRD star.
2. Then the sun — pinned at noon for the entire game — MOVES. It
   slides down the sky over ~8s and every shadow in the world swings
   and lengthens with it. The light goes gold. The first sunset
   anyone has seen in a year.
3. Granny Tock, from below: her clocks might finally mean something.

PERMANENT WORLD CHANGE (sky=3): a slow PARTIAL DAY ARC — the sun
travels noon → low gold → back on a long cycle (~6 real minutes).
Never full dark; that is phase 8's alone.

SAFETY RAIL (non-negotiable, protects every shipped gate): springs,
canopy shade, authored shade circles, grottos and interiors stay
PERMANENTLY safe regardless of sun angle. Only directional prop/rock
shadows swing. Swelter rules, shade healing and every existing shade
gate are unchanged. The sun moving must be spectacle plus flavour,
never a new way to die.
Sailing at gold hour is the compounding reward the sailing spine
promised.

## THE END CARD (John, explicitly, twice)
TO BE CONTINUED returns, and the missing one is retrofitted:
- PHASE 2 gets the card it never had — the Half Shield arc currently
  just stops. Teases the open sea and a keel worth it.
- PHASE 3 ends on its own card teasing the WAXING SLIVER: cool winds,
  the Parched Forest re-greening.
Card style is unchanged — John called it "fantastic"; never regress.

## FOREST MOB POCKETS (John: the boys want more to slash)
The Parched Forest's two safety systems become a real trade: the
Silverrun road is SUN, the trees are SHADE — and the trees now hold
~6 hostile pockets (2-3 boars or 3-4 hornets each) in the canopy
shade off the riverbed. Zelda-sparse, never a wall of enemies:
safety costs you a fight, exposure costs you hearts. Respawn on area
re-entry like everything else.

## PROCESS LAW (unchanged, all of it applies)
ONE ground authority via makeMeshField for every new walkable surface
(island shores, foundry floors, the spire belfry, boat decks);
rendered == physics, gated. No impression geometry in playable space.
Wrap-and-delegate for the new region parts, in build.sh order. Every
new save flag carried by applyWorldState BOTH ways, with the John
sequence (completed save → NEW GAME → world fully fresh) extended to
keel, refit, moon, isles and sun-arc state. Maria's hazard rules for
the big sets. Cinematics skippable after first view; handoff is a
DISCOVERY. Budgets ≤80 draw calls / ≤120k tris measured under full
sail in the big sets and in the foundry. Build-unique deploy marker
verified absent from the previous bundle. The family save must
continue seamlessly into all of it.

---

# PHASE 4 — THE WAXING SLIVER: THE CROWN & THE WIND'S RETURN
(locked 2026-08-17 overnight; John ratified the pitch — "go ahead and build
the next phase... make this great" — and gave one directive that outranks
everything else in this section: THE PUZZLE. His words on phase 3's bells:
"you didn't tell you outright, but you kinda figured out that you had to
match the sound. It was honestly a magical moment. The whole family was
playing." Phase 4's puzzle must be that moment's descendant.)

## THE REVEAL — the sun you freed shows you the way
At GOLD HOUR (the phase-3 sun arc, low in the west), from the top of the
fire-watch tower, the sun GLINTS off something on the CROWN — the sealed
plateau above the Dried Falls, "solid, unclimbable" since night one. A
visible pulsing star-glint on the summit, only during the gold band.
Standing at the tower top during a glint sets the thread (crownGlint,
quest 13); the Warden, if talked to after: "That light's off the old
watch-garden. Nothing's caught the sun up there since the wind died."
Phase 3's payoff literally reveals phase 4's goal — the spine working.

## THE WAY UP — THE FALLS STAIR
Behind the dry falls: the fire-watch order's carved stair, climbing INSIDE
the rock the water once poured over. Entered from the Falls Hollow's upper
gallery — a crack that, after crownGlint, gains a prompt and a one-line
hint ("Gold light falls through here, evenings."). The stair is a new
dungeon segment extending the Hollow UPWARD: three tall landings, dry
plunge-shafts, the bones of the order's rope-lifts.

## THE WIND ORGAN — the puzzle (the whole rev bends to this)
The order carved AEOLIAN PIPES up the stair — the mountain itself is an
instrument, and it has been silent for a year. As you enter, a faint CHORD
hums from somewhere above: the target, always audible, never explained.
Each landing has stone VENTS with rotatable shutters (hold ✕ to turn —
the mirror-shell verb, third generation). An open vent WHISTLES; turning
the shutter bends its pitch, continuously, like tuning a radio. Match the
landing's vents to the chord you hear:
  L1 — ONE vent. Learn the verb by ear: turn until your note sits inside
       the hum. Pipes warm-glow when true, door grinds open.
  L2 — TWO vents, a two-note chord. Tune them against each other AND the
       hum. (The chord is consonant when right — kids hear "it stopped
       being sour" without knowing why.)
  L3 — THREE vents, and the WIND GUSTS: pitches drift slowly, so you tune
       all three inside a gust's calm. Generous windows (the 15s tone
       lesson: tuned for a 7-year-old's fumbling, not a bot).
No text explains any of it. Colour + sound + doors opening. When all three
landings sing, THE WHOLE STAIR PLAYS — the order's old dawn call rolls
down the cliff (authored ≤12s beat, the organ's own cinematic) and the
top door opens onto the Crown.

## THE CROWN — the summit region
Compact and precious (~0.4 x 0.3km): the fire-watch order's WATCH-GARDEN —
dead orchard terraces, a beacon ruin, a wind shrine of carved pinwheels
(all frozen), the Sliver's plinth arena at the summit. THE VIEW is the
reward for arriving: from up there the whole healed world is visible at
once — the flooded bay, the isles, the sea, the forest below (far tiers
already exist; frame it). Hostiles: EMBER FAWNS — small, quick, leaping;
2 hits; cured they turn warm brown and bound away. Hornets drift the
terraces. Chests: salt seams, one HEART CONTAINER in the beacon ruin.

## THE GUARDIAN — THE ASH STAG
A great deer of ash and ember, the WAXING SLIVER caught in its antlers
(the guardians WEAR the phases: crab, wyrm, tortoise, stag). Fought on the
orchard terraces — a VERTICAL arena for the jump verb.
  P1: telegraphed charges (paw, huff ember-smoke, rush); sidestep or jump;
      a charge into a terrace wall staggers it = the window. Body chips
      always land (law).
  P2: it LEAPS between terrace levels and rains ember motes — move under
      the dead orchard boughs (cover play).
  P3: it calls a FAWN STAMPEDE across the arena — jump the line (taught by
      the boars' tree-stun cousin logic; visible, fair).
HP ~78, notches, kid-bot-wins gate WITH the chasing bot. The cure: the ash
blows off grey-to-warm-brown, the fawns gather to it, it bows, and dips
its antlers to hand you the Sliver. Nothing dies.

## THE PAYOFF — COOL WINDS COME HOME (the biggest world-change yet)
Slot the Sliver at the Moonwheel: fourth notch, fourth star, sky step 4 —
then THE WIND: a visible grass-wave front sweeps across the Parched Forest
as it re-greens IN FRAME — burnt rust to living green, needle carpet to
meadow. THE SWELTER RETIRES, permanently: the region's hazard simply ends
(the sun icon by the hearts takes a final leaf chime and never returns).
Burnt thickets soften and open the three blocked shortcut paths. And THE
SILVERRUN RUNS AGAIN: water sweeps down the riverbed from the falls (the
flood beat's inland echo, ≤12s), waterwheels turn, the ferry floats, the
Dried Falls POUR.

## THE SKIFF — the river becomes the ride
A pilotable SKIFF on the living Silverrun (boat physics constrained to the
river spine, current-assisted downstream): board at the falls pool or the
ferry landing, ride the whole 2.5km spine down to the bay mouth, hop out
at any landing. The road you trudged all of phase 2 becomes the joyride
home, and it connects the forest to your sailing water. Wisps fizz over
the wet river. (Upstream is slow but possible — no one-way traps.)

## Save/quest scaffolding (pinned)
Flags: crownGlint, stairOpen, organ1/2/3, crownSeen, beaconHeart,
crownChests..., stagDone, sunArc unchanged, riverWet (the big one —
derived world both ways), skiffX/skiffZ, tbc4Seen. Quest: 13 FOLLOW THE
GOLD LIGHT, 14 CLIMB THE FALLS STAIR, 15 RECOVER THE WAXING SLIVER,
16 CARRY THE SLIVER TO THE MOONWHEEL, 17 4/8 PHASES RESTORED. Forward
derivation: stagDone→15(pickup preserved, tortoise lesson), sky>=4→17.

## Process law — everything already standing, PLUS tonight's lessons as law
- Every flag applies LIVE at its set-site (storeSave + applyWorldState);
  doors are solid when shut; thresholds get portals + light gradients
  (the door law); interiors are capped — NO SKY from inside; any water
  craft obeys the 1.3m mooring depth + runway rule; the water yields to
  any hull it renders around; boxW takes HALF-extents; small craft hulls
  are double-sided.
- Puzzle timing tuned for cold 7-year-olds (the 15s tone lesson).
- Harness: real-input organ suite (tune by ear = assert via telemetry pitch
  distance shrinking under held ✕, doors opened by REAL tuning); the
  one-session glint→stair→crown journey gate; kid-bot CHASES; lastPos
  resume gate; crown perf on 8 sample points; full regression.

## THE WORLD RULES (decided 8/18 after the Island Forge study — LAW for every part, present and future)

John's diagnosis, verbatim law: "Games should have rules. Not gates. Rules."
A gate protects a place; a rule owns space. Island Forge cannot have
render-vs-physics bugs because its mesh and its collider are both compiled
outputs of one dataset — a wall exists once and is projected twice. Fallen
Moon is fourteen wrapped authorities; every seam between two of them is a
place the truth can fork. These rules make the truth enumerable and every
rule machine-checkable. No part ships that violates them.

RULE 1 — ONE TRUTH, DECLARED. Every part that owns ground/solid anywhere
registers it: `__WORLD_REG.push({name, owns(x,z), note})`. The registry does
not dispatch (the wrap chain still answers); it DESCRIBES ownership so the
harness can prove there are no unowned gaps and no undeclared overlaps, and
sweep rendered-vs-authority conformance per owner with ZERO carve-outs.

RULE 2 — EVERY THRESHOLD IS A PORTAL OBJECT. A player never crosses between
two authorities except through a registered portal:
`__PORTALS.push({name, x, z, yaw, sides, openNow()})`. Every portal renders
a frame, a light gradient, and a floor cue — passable openings must READ as
openings from BOTH sides; walls must read as walls. The harness enumerates
__PORTALS and screenshots every one, both sides, open and shut, every run.
Nobody screenshots doors by hand again.

RULE 3 — LIGHT IS OCCLUDED BY THE WORLD. All beams get their length from
`beamHitDist(origin, dir, maxLen)` marching the live groundH. No
fixed-length beam geometry, ever.

RULE 4 — WATER NEVER ENTERS A HULL. Every floating vessel registers in
`__HULLS` (sailing, moored, drifting — all of them); every dynamic water
surface consults the registry with full clamp inside r + one grid cell (so
LOWFX's coarse lattice is covered). Static sheets enforce the rule from the
vessel side: hulls ride the interpolated local surface, never a quantized
station.

RULE 5 — A CINEMATIC FILMS THE RENDERED WORLD. Visibility culling derives
from the CAMERA's position whenever the camera is not the follow cam. A
cine departs from the player's own shot and lerps back to it before endCine
— never a one-frame snap, never a teleport, always skippable.

RULE 6 — THE REPAIR PASS. applyWorldState ends with invariantSweep(): the
player stands on non-solid ground; every moored vessel floats in ≥1.3m;
every portal's collider agrees with openNow(); every door's plug follows
its VISIBLE position (a sinking slab is passable when it looks passable).
When world state changes, downstream truth is re-derived, not trusted.

Backlog acknowledged, deliberately deferred (do NOT hand-fix these; they
await their rule): unifying the three boat stacks; collapsing the Cinder
Pass staggered handoff band (x=98/100/110) and the harbour-gap band
(−110/−104/−96); re-carving the river bed under the authored surface.

## PHASE 5 — THE FULL MIRROR (decided 8/20, John: "All as one arc. Build it tonight!")

ONE ARC: the night market + the river ascent. Salt becomes currency (the
standing decision — resolved YES; a market needs something to spend).
Upstream is SKIFF SKILL plus one VISIBLE upgrade (the keel→double-sail
law): THE FERRY POLE, carried on the skiff in plain sight.

THE ARC (quests 18→22):
1. q18 LIGHTS ON THE WATER — at dusk, lanterns appear off the bay's east
   shallows: the night market flotilla has come back (it only sails when
   there is moon enough to steer by — four phases is enough). The LANTERN
   TRADER cannot come in: "the river took our berth when it died; the
   mouth is stone now." Their berth is the old ferry landing, upriver.
2. q19 OPEN THE RIVER'S MOUTH — at the pass camp the Silverrun dies 5.3m
   above the sea, 170m short. The old sluice stands there: THREE GATES
   opened IN TIME with the river's surge pulses — the water itself
   teaches the rhythm (listen: the surge swells, hits the gate, the gate
   gives ON the surge). Puzzle escalation BY KIND: bell = match a tone;
   organ = tune a chord; sluice = keep time with the river. No text.
   Kid-fair: surge windows ≥1.2s, audible + visible (white swell line),
   a missed beat just waits for the next surge.
3. THE RIVER FALLS (cinematic): the mouth opens and the Silverrun
   thunders down new rapids into the bay. The water CONNECTS — terrain
   carved, the bay's east shallows now hold the rapids' mouth pool.
3b. THE SWING-KEEL REFIT (John: "also boat refit"): in thanks for the
   opened mouth, the trader's shipwright refits the sailboat — the
   phase-3 keel gains a PIVOT. In shallows it visibly swings up along
   the hull, she rides higher, and her draft halves: the east bay
   shallows and the river's LOWER REACH (mouth pool up to the first
   ford) become sailable. Refit cine at the trader's boat (the family
   loved the keel cine — same beat, same visible-upgrade law: you SEE
   the keel fold on every shallow crossing). Save flag: swingKeel.
   The old "Shallows" caption keeps firing only where even she can't go.
4. q20 LIGHT THE WAY UP THE SILVERRUN — the trader gives THE FERRY POLE
   (found item beat at their boat; visible on the skiff; ✕ swings it
   aboard). THE ASCENT: current pushes down; EDDIES (behind boulders,
   inside bends) are glassy-calm — read the water; ride eddy to eddy;
   on the surge-slack (the same rhythm the sluice taught) pole up the
   white chutes. Light the BRAZIER at each eddy pool; the flotilla
   follows your lights (escort by lantern, not by babysitting — they
   advance when the next brazier is lit, staged, never stuck).
   Hostiles: RIVER SNAPPERS on eddy boulders — 2-hit, lunge at the
   skiff, pole-whack answers; telegraph ≥0.9s; they drop salt.
5. q21 THE NIGHT MARKET — nightfall as the flotilla berths at the ferry
   landing. The market opens: lantern strings, 4 stalls, nocturnal life
   wakes (fireflies, moths at the braziers, night-birds — spectacle,
   not combat; the market is a safe haven). SALT SPENDS: a heart
   container (~60), the SPYGLASS (~25, aim-and-gaze anywhere), skiff
   pennant colors (5), fireworks (3/launch, fired from the skiff).
   The LANTERN CEREMONY: the flotilla's ancient stern-lantern is opened
   — it has carried THE FIFTH SLIVER for generations, waiting for the
   wheel to turn again. It is given, not won.
6. q22 carry home: the NIGHT RUN — downriver by lantern-light, fast and
   joyful (the reward lap), to the Moonwheel; sky step 5; 5/8 PHASES
   RESTORED; TBC card. After the arc, dusk brings the market lights at
   the landing every night — the world stays alive.

CINEMATIC BEATS (the loved list grows): lanterns-at-dusk arrival; the
river falls; the lantern ceremony; the wheel. All obey Rule 5 (film the
rendered world, depart/return from the player's shot, always skippable).

WORLD RULES obligations: new rapids water consults __HULLS; the sluice
gates and the market entrance register in __PORTALS; new terrain owners
register in __WORLD_REG; door plugs follow visible positions; the
compass follows paths (extend the spine: bay mouth ↔ rapids ↔ pass camp
↔ fords ↔ ferry landing). 2P: P2 rides the skiff and pole-whacks;
drop-in preserved. Budgets: the river run and the lit market must hold
≤80 calls on the Pi in LOWFX — lanterns are baked emissives, never
lights. The pre-existing skiff hotspot (92 calls at station 355) must be
FIXED as part of the ascent work, not inherited.

Save: mouthOpen, swingKeel, poleFound, braziers[], marketOpen, sliver5, sky 5,
tbc5Seen, pennant, spyglass, fireworks, marketHeart; forward-derivation
per p2-core pattern; flags apply LIVE at set-site.
