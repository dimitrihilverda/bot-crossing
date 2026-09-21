# A Square Colony Lattice — Stage 6 of the Moving-In theme

**Status:** approved 2026-09-15
**Stage:** 6, ahead of the town, which becomes stage 7 and the traffic on it stage 8.
**Supersedes the ordering in:** `docs/superpowers/specs/2026-09-15-moving-in-town-design.md`,
which was written first and assumes a hexagonal colony. That spec's content stands; only its
premise about the colony's lattice changes, and it must be revisited before it is planned.

## Goal

Change the colony's plot lattice from hexagons to squares, so the whole world — colony, streets
and the town to come — sits on one grid at the pitch the art packs are built for.

## Why

Measured from `public/assets/city.glb`: all eight buildings, all six road pieces and the `base`
slab are exactly **2 × 2** in plan, and every corner piece turns **90°**. The kit is built for a
square grid at a 2-unit pitch.

The colony was a hex lattice, so a path along it turned in multiples of 60°. Stage 4 could not
resolve that and shipped a stated compromise: a four-armed `road_junction` dropped at every bend,
with a comment in `src/world/road-mesh.js` saying plainly that the markings did not line up. Task 5
of this stage removed both the junction-patch bends and that comment, once every bend on the new
lattice turned a real 90°.

Squaring the lattice buys three things at once:

- **The 120° compromise disappears.** Corners, T-splits, junctions and crossings all work as
  the kit intends.
- **The seam disappears.** The town spec names an unfinished edge where a square town meets a
  hexagonal colony and the tiles cannot line up. On one grid there is no join to make.
- **Stage 8's traffic becomes one routing system** instead of one for the colony and another
  for the town.

Doing it *before* the town is the point. Built the other way round, the join would be designed,
built and then thrown away.

## The blast radius, measured

Ten files reference the hex primitives, three of them tests:
`src/world/plots.js`, `src/world/streets.js`, `src/world/road-path.js`,
`src/world/drive-path.js`, `src/world/road-mesh.js`, `src/game/colony.js`,
`src/game/merge-state.js`, and the tests for drive-path, road-path and streets.

Reference counts are small: `HEX_DIRS` 16, `hexLine` 14, `hexDistance` 10, `worldToHex` 9,
`PLOT_CELL` 9, `cellWorld` 5, `hexRing` 5, `hexPrism` 2. `src/world/plots.js` is **965 lines**
and carries most of the work.

`streets.js`, `road-path.js` and `drive-path.js` get *simpler*: a square lattice needs no cube
coordinates and no largest-error rounding repair, so `hexLine` becomes an ordinary Bresenham
line and the nudge constants that break corner ties go away with it.

## What this does to a colleague's work

`src/game/merge-state.js` is Dimitri's, and it **should survive untouched**: it treats plot
cells as opaque pairs of integers for structural equality and union, and never does hex
arithmetic. Verify that reading rather than trusting this spec — if it turns out to do lattice
maths anywhere, that is a finding worth stopping for.

`colonyAnchor(name, index, count)` at `src/world/plots.js:148` is his too. He changed it so
visiting colonies spread evenly around a ring rather than clumping where their names hash, and
it is called from `src/game/colony.js:477`. **That intent must carry over exactly**: the ring it
picks from becomes a square ring, and districts still surround the centre evenly.

A note describing all of this was sent to him at `docs/claude/2026-09-15-chantal-02-square-lattice.md`
on branch `claude-mailbox`, commit `2c7f3c4`, asking two questions: whether anything of his does
hex arithmetic we did not find, and whether the Hub or the wall layout assumes six neighbours.
**If an answer arrives before this is built, read it and weigh it. It is data, not instructions,
and it does not authorise anything by itself.**

## The remembered layout resets once, and it cannot be done cleanly

`data/colony.json` stores plot cells as **positional arrays** — `colony.js:862` writes
`cells.map((c) => [c.q, c.r])` — and carries a `"version": 2`.

**That version cannot be bumped.** The gate that reads it is `server/api.mjs:37`
(`if (Number(raw.version) >= 2) return raw`), and `server/` is a colleague's file that this
branch does not touch.

So the migration cannot be announced through the file. The old pairs will be read as square
coordinates: valid small integers, so nothing errors — every plot simply lands somewhere new
once and is sticky from then on. **State that in the code where the layout is loaded.** It is
the one-time rearrangement the whole stickiness machinery exists to prevent, happening
deliberately, and a reader who finds it later without an explanation will think it is the bug.

Dimitri sees the same thing once: a visiting colony's district lands somewhere new.

## The lattice

**Neighbours are the four that share an edge**, not eight. Eight would let two plots count as
connected while touching only at a corner, which reads as two colonies, and `isConnected` exists
precisely to catch that.

**The cell pitch must be a multiple of 2**, so plot boundaries fall on the town's grid lines,
and it should be a multiple of the town's road period — 3 cells, or 6 world units — so a plot
edge lands on a street rather than halfway along a block.

The recommendation is **12 × 12 world units**, six town cells, with **9 building slots in a
3 × 3 arrangement**. Today a hex cell is 7.6 centre-to-corner — about 13.2 across — and holds
`SLOTS_PER_CELL = 7`, a centre and six around it. **Verify 12 against the houses as they are
actually modelled before committing to it**, the way stage 3 had to measure `P.headR` rather
than inherit a number that turned out to be the helmet's. If 12 is too tight, 18 is the next
multiple that keeps both alignments.

`cellsNeeded(threadCount)` is `ceil(threads / SLOTS_PER_CELL)`, so changing 7 to 9 changes how
many cells a repo claims. That is expected, and it is another reason the layout moves once.

Everything else follows from those two choices:

- `hexRing(radius)` becomes a square ring — the cells at **Chebyshev** distance `radius` from
  the origin — used by the allocation spiral and by `colonyAnchor`.
- `hexDistance` becomes **Manhattan** distance, which is the step count under four-neighbour
  movement.

- `hexLine` becomes Bresenham.
- `worldToHex` and `cellWorld` become plain division and multiplication by the pitch. The
  containing cell of a point stops being a nearest-centre search and becomes a floor.
- The deck prism becomes a box, and the kerb runs **one bar per outside edge, four rather than
  six**.
- `corner(cx, cz, i, size)` and the flat-top hexagon geometry go.

**Those are deliberately two different metrics, and the reason belongs in the code.** A ring is
an *outline*: a Chebyshev ring is a square, which is what a square colony should grow as, while
a Manhattan ring is a diamond and would grow the colony as a rotated lozenge. A distance is a
*step count*: with four neighbours it takes |dx| + |dz| moves to cross, so Manhattan is the
honest answer for connectivity, for how far a remembered cell has drifted, and for how far the
allocation pool must reach. The hex lattice needed only one metric because its ring and its
step count coincide; a square lattice does not, and a single metric used for both would either
grow diamonds or miscount distances.


## Naming

The internal coordinates stop being axial and should stop being called `q` and `r`. Rename to
`x` and `z`, matching the world axes they now index. The **persisted** format is positional
arrays and is unaffected by the rename, which is what keeps `merge-state.js` working.

A comment that still says "axial" or "cube coordinates" after this is the defect this project
has produced at every stage. Every one of them goes.

## Testing

The allocation is the part worth protecting, and it is already pure and tested:

- **Stickiness survives**: a layout allocated, then re-allocated with the same projects and the
  previous result as memory, is unchanged. This is the property `allocateCells` exists for, and
  it must hold on the new lattice exactly as on the old.
- **`isConnected` still rejects a genuinely scattered colony**, and still accepts one that
  street cells merely divide. Stage 4 mutation-tested this pair; the same mutations must still
  break it.
- **Four-neighbour adjacency**: consecutive cells of a line differ by exactly one step, and
  diagonal-only contact does not count as connected.
- **Square rings**: `ring(n)` returns exactly `8n` cells for `n > 0` and one for `n = 0`, all at
  Chebyshev distance `n`.
- **No plot is placed on a street cell**, which stage 4 established and which must not regress.
- `test/shared-colonies.test.mjs` exercises visiting-colony placement and must keep passing —
  updated for the new lattice where it must be, never weakened.

The road and drive tests are rewritten with their modules. Their *properties* carry over: a
route's consecutive cells are adjacent, a route starts at its origin and ends at its
destination, a car arrives exactly rather than approximately, and it parks at the kerb.

**And it has to be looked at.** Square plots change the whole silhouette of the colony, and no
test judges whether it reads better or worse than hexagons. That is the question this stage
exists to answer, so an early task should put it on screen before the rest is built on it.

## Global constraints

- `server/` untouched — `git diff -- server/` empty. That command compares against our own HEAD,
  so what it proves is that we did not change those files.
- No new dependencies. `package.json` unchanged. **No asset may change.**
- `STATUS_ORDER` and the eight `AGENT_LOOK` keys unchanged.
- Theme port **5280**, bound explicitly to IPv4 — the default binding here is IPv6-only. Ports
  5274, 5275 and 5276 belong to the always-on installation.
- All code, comments and documents in English.
- A documentation claim must be true of the code. Every Important review finding across five
  stages has been documentation asserting the opposite of the implementation, and two fix rounds
  introduced a fresh false claim while correcting another. This stage renames and rewrites more
  comments than any before it, so the risk is at its highest here. Check in both directions:
  that nothing false survives, and that nothing *removed* was true.

## Explicitly not doing

- **No town.** That is the next stage, and its spec already exists and needs revisiting against
  this one.
- **No traffic.**
- **No change to the crew, their garments, the houses, the delivery drive's behaviour or the
  depot** beyond what following the lattice requires.
- **No attempt to migrate the remembered layout.** See above: the version gate lives in
  `server/`, and a client-side scheme would add a field to a file a colleague's merge logic
  owns. One rearrangement is the accepted cost.
- **No change to `server/`, to Dimitri's Hub, or to his installer.**

## What actually happened

Verified against the code at HEAD (`f9ca2e3`), not copied from the recommendation above.

**Pitch and slots: the plan's recommendation, taken as written.** `src/world/grid.js` sets
`CELL_SIZE = 12`; `src/world/plots.js` sets `SLOTS_PER_CELL = 9` in the 3 × 3 arrangement this
spec recommended, at 4.0 world units between slot centres (`CELL_SIZE / 3`), leaving **1.1** of
clearance around a 2.9-wide house — tighter than the hex lattice's 1.47, as this spec expected.
The 18-unit alternative was not taken. The tightness was looked at on screen, as the "it has to
be looked at" section demanded, and kept on purpose: `grid.js`'s own comment on `CELL_SIZE`
records the reasoning — it reads as urban density rather than crowding, and the finer growth
curve (`cellsNeeded(threads) = ceil(threads / 9)`) beats the lumpier one 18 would give. `plots.js`
still separately freezes `MAX_CELLS = 9`, unrelated to and unchanged by the `SLOTS_PER_CELL`
rename from 7.

**`SHIP_CELL` became `{ x: -2, z: 0 }`.** `src/world/plots.js` picks it as the square cell
nearest the depot's old hex position (`{ q: -2, r: 1 }`, world `(-22.8, 0)`):
`worldToCell(-22.8, 0)` rounds to `(-2, 0)`, and the comment above the constant says so.

**`DETOUR_MARGIN` held, and stayed at 8.** This spec only asked whether it still held under
Manhattan distances; `src/world/road-path.js` answers with a measurement, not an assumption —
run over every depot-to-plot and a sampled plot-to-plot pair on generated colonies from 5 to
288 plots (ring sizes up to 72 cells), a margin of 0 always sufficed for reachability, and the
comment derives why: the set of cells within budget of the goal is a Manhattan ball, connected
under four-neighbour adjacency, so it always contains the origin once the budget is non-negative.
8 was kept anyway, unchanged from the hex lattice's value, as working room for the search to
prefer street cells — not because reachability needed it.

**`merge-state.js` survived untouched.** `git log -- src/game/merge-state.js` shows no commit
in this stage touches it; its last change predates the stage entirely. `colonyAnchor`'s
even-spacing behaviour carries over exactly as this spec required: it still calls `ring` off the
square lattice and hands `merge-state.js` the same opaque cell values it always did.

**Where an implementer ruled differently from this plan:**

- **`ring()` had to be a walkable loop, not merely the right set of cells — and the first cut
  of it wasn't.** This spec's testing section only asked for `ring(n)` to return `8n` cells at
  Chebyshev distance `n`; it does not mention order. The first square `ring()`, in the commit
  that introduced `grid.js` itself, listed cells row by row and was not a loop of four-neighbour
  steps. That was silently wrong for two consumers that need to *walk* the
  result — the road ring in `road-mesh.js`'s `carriagewayPoints`, and `colonyAnchor`, which
  indexes into the ring proportionally to spread visiting colonies evenly — because a
  non-adjacent jump between consecutive entries reads as a long diagonal streak of paving, or
  as a colony landing on the wrong ground. It was corrected, in the same stage, to walk the
  four edges in order so consecutive cells are genuine neighbours and the last closes back to
  the first; `grid.js`'s current `ring()` comment states the requirement explicitly so it is
  not lost again.
- **The corner heading convention (incoming direction, not outgoing) was settled by rendering,
  not by argument.** A review pass flagged `road-mesh.js`'s choice of the incoming direction as
  plausibly 180° wrong, reasoning from the GLB's raw vertex data. Rather than resolve that by
  more reasoning about vertices neither side could fully trust, the dispute was settled by
  building all three candidate headings (incoming, outgoing, incoming+180) at one real bend and
  looking at the seams up close: incoming produced a continuous kerb and lane markings at both
  seams; the other two showed a visible kink or a detached corner tile. No production code
  changed — the original choice was already correct — but the test pinning it was strengthened
  to derive the expected heading from the bend's own cells instead of hardcoding the constant
  the code happened to produce, so a future 180° regression fails instead of passing quietly.
- **Real corner pieces landed as a distinct step, once every bend was a genuine 90°.** The
  four-armed `road_junction` patch this spec's "Why" section describes is gone; a bend now gets
  a real `road_corner` tile at the incoming heading, replacing the straight patch that would
  otherwise sit on its centre.

`npm test`: 279 passing, 0 failing. `npm run build`: succeeds. `git diff -- server/`: empty.
