# One Street Network, and a Town On It — Stage 7 of the Moving-In theme

**Status:** approved 2026-09-16
**Supersedes:** `docs/superpowers/specs/2026-09-15-moving-in-town-design.md`, which assumed a
hexagonal colony with a ring road around it and a separate square town outside. That premise is
gone. The measurements in it are still good and are carried forward here; its architecture is
not.
**Builds on:** `docs/superpowers/specs/2026-09-15-moving-in-square-lattice-design.md`, which put
the colony on a square lattice. That is what makes this possible.

## Why this spec replaces the previous one

The owner looked at the finished square lattice and reported three things. All three were real,
and two were mine:

1. **A square street runs around the colony and nothing uses it.** Measured: every delivery
   route is three points long and touches **zero street cells**. Cars drive straight across the
   plots, through the houses.
2. **The corners look wrong.**
3. **There are no buildings outside the colony** — correct, and the town was never built; but a
   day's work ending on an empty field is a failure of expectation-setting.

The first is the important one and it is a design error, not a bug. The ring road circles the
colony while **all the traffic is inside it** — depot to house, both in the middle. The router
is behaving correctly: at `OFF_ROAD_COST = 6` a two-cell hop across the deck is far cheaper
than a detour to a road that goes nowhere useful. A ring around the outside serves nothing.

Squaring the lattice was sound and is what this design needs. It did not and could not fix the
road layout.

## The shape

**One street network across the whole world.** No ring, no town grid, no join between them.

- Some cells of the colony's lattice are **street cells**. The rest are **blocks**.
- The colony's plots are allocated into blocks, exactly as now.
- The town's buildings fill the blocks the colony does not occupy — the derived-layer rule from
  the superseded spec, unchanged: a cell's content is a function of its own position, so when
  the colony grows those blocks go dark and when it shrinks they come back identical.
- Streets run **between** blocks, so a route from the depot to a house is *shorter along the
  street than across a block*. That is the whole point, and it is the thing the current design
  gets backwards.

**A block is a maximal run of adjacent non-street cells**, not a fixed size. That is what makes
"uneven block sizes" a property of where the streets are drawn rather than a second system: pick
the street cells and the blocks are whatever is left between them. A plot claims cells inside
blocks exactly as it does today, and `allocateCells` already refuses street cells — that
mechanism is unchanged and is the one piece of the ring design worth keeping.

**A street cell is a street block, not twelve units of tarmac.** The carriageway is 2.5 wide
down the middle; the rest is verge carrying pavement, streetlights, planting and the rest of the
kit's furniture. That was already the superseded spec's design and it survives intact — a
lattice cell is 12 across, which is twenty-one car widths, so paving one would read as a plaza.

## The street pattern: a grown village, not a chessboard

**The hard constraint first, because it cannot be designed away.** All six road pieces in
`city.glb` are 2 × 2 square tiles and every one of them turns in multiples of 90°, including
`road_corner_curved`, which makes a quarter turn inside its own footprint. **There are no
diagonal streets and no real curves.** Everything runs on an axis.

Within that, a chessboard is a choice and not the only one. The pattern must read as a place
that grew rather than one that was laid out, and three devices do that using the same six tiles:

- **Uneven block sizes.** Not a street every third cell. Blocks of varying extent, so streets do
  not line up into long avenues.
- **Streets that jog.** A run, a right-angle, a parallel run, another right-angle. This is what
  a Dutch neighbourhood looks like: right angles everywhere, a chessboard nowhere.
- **Dead ends and T-junctions**, not a crossroads at every meeting.

It must be **deterministic** — the same seed gives the same streets every reload — and it must
be **stable against the colony**: the street layout is a function of position and seed, never of
which repos exist, or the streets would rearrange on every poll.

## The requirement that makes this verifiable

The previous design failed silently: every test passed while no car ever touched a road. So this
spec states the property as a number.

**A route from the depot to a house must demonstrably run on streets.** Concretely, asserted in
a test over a spread of generated colonies:

- The **median** fraction of a delivery route's cells that are street cells is **at least 0.6**.
- **No** route of more than two cells has a street fraction of zero.

Those thresholds are this spec's to state and the plan's to verify against real generated
layouts; if the layout cannot meet them, the layout is wrong, not the threshold. What must not
happen is the current situation — routes of three points, zero street cells, and a green suite.

Off-road driving stays legal and stays the documented fallback: a block with no adjacent street
is reached across the ground, as stage 4 established.

## The corner check, with a method that can actually see the problem

The corners were verified twice during the lattice stage and passed both times, and the owner
still found them wrong. The reason is worth recording because it invalidated both checks:

**`road_corner` and `road_straight` are the same slab.** Measured from `city.glb`: both have a
full 2 × 2 top face spanning the tile in both axes. There is no open edge and no walled edge —
**the only difference between a corner and a straight is the paint in the texture.**

So a wrongly rotated corner produces **no seam, no gap and no z-fighting**. It shows up only as
markings that run the wrong way. Every check that looked for a discontinuity in the road surface
was incapable of detecting the defect, which is exactly what happened: a reviewer derived the
fault from vertex data and was told it was wrong by an experiment that looked for seams.

**So the corner must be verified by its markings**: the painted centre line and edge lines must
be continuous through the turn and must curve the way the road turns. Verify it against the
texture's UV layout rather than by eye on a rendered slab, and pin whatever is found with a test
that would fail on a 90° or 180° rotation.

## What this removes

- **The ring road and its spurs.** `planStreets` builds a ring one radius outside the outermost
  plot and a shortest spur from each plot to it. That whole shape goes.
- **`ringRuns()`** and the arc-splitting added in the lattice stage's final fix wave, which
  existed only to cope with a ring broken by claimed cells.
- Whatever in `road-mesh.js` is specific to a closed ring.

The lattice itself, the road tiling, the carriageway width, the corner and junction placement
and the height-following all stay.

## Carried forward from the superseded spec, unchanged

- **The kit inventory**, measured: eight buildings `building_A`–`building_H`, all exactly 2 × 2
  in plan and 1.65–3.05 tall; six road pieces at 2 × 0.1 × 2; `base` at 2 × 0.1 × 2, which is
  the pavement; `streetlight`, `bench`, `bush`, `dumpster`, `firehydrant`, `trash_A`, `trash_B`,
  `watertower`, `trafficlight_A`/`_B`/`_C`, `box_A`, `box_B`.
- **`base` and the road surface are the same grey** — atlas cell 2, `#818c91` — so a kerb must
  read as a height step and its shadow, never as a colour change.
- **`forest.glb` is a separate atlas**, so planting cannot merge into the city mesh. It is a
  second draw call, and `createScatter`'s existing `keepClear` list keeps trees out of streets.
- **The ground must be flattened** under the built area. The mechanism exists:
  `src/world/planet.js` smoothsteps the terrain flat inside radius 40 and to full roughness by
  86, which is why the colony measures −0.3 to +0.24 and the ground further out measures −2.05
  to +3.31. A `TOWN_RADIUS` widens the flat zone and the existing smoothstep gives the blend for
  free. **The hills move outward as a result**, which changes the whole world's look, not just
  the town's.
- **The budget is the real risk.** Roughly 4,300 cells of the 2-unit grid before the colony is
  subtracted, at 1,392–3,336 vertices per building. **The town must not add more geometry than
  the colony itself draws.** The first task measures the colony's own vertex count as the
  yardstick and records which lever it pulled if the first honest count exceeds it: a tighter
  outline, a larger green-block share, or the `_withoutBase` building variants.
- **The town's outer edge is irregular**, not a square — a boundary that varies with direction,
  deterministic from a seed, so the town frays into the countryside.
- **Green blocks**: some blocks carry trees, bushes and grass instead of buildings.
- **Pavement, streetlights along the roads rather than only at corners, `road_straight_crossing`
  as a zebra, and `trafficlight_A`/`_B`/`_C` at junctions** — scenery in this stage, because
  nothing obeys them until traffic arrives.

## Testing

Everything that decides what goes where is pure and tested under `node --test`, following
`src/world/streets.js`, `grid.js` and `drive-path.js`:

- The street pattern is deterministic, and **is not a chessboard**: assert that block extents
  vary, that not every street runs the full width, and that at least some streets jog. A test
  that only checks "streets exist" would pass on the chessboard this spec exists to avoid.
- The street layout does not depend on which repos exist: compute it for two different colony
  footprints and assert the street cells are identical.
- **The route-on-street property above, as numbers**, over a spread of generated colonies.
- A block's content is a function of its own position: two different colony footprints give
  identical content for every block present in both.
- The corner markings, pinned so a 90° or 180° rotation fails.
- The budget ceiling, so a later change cannot quietly triple the geometry.

**Animated behaviour is verified by driving frames by hand**, never through the Browser pane,
which does not tick `requestAnimationFrame` in this project — measured at 0 frames in 3 seconds.
The engine's updaters are objects with an `update(dt, elapsed)` method.

**And it must be looked at, by someone who will say when it is wrong.** Both corner checks in
the previous stage passed and the owner still found the defect in a minute. A rendered
screenshot judged by the person who wrote the code is the weakest evidence in this project's
history; a measurement and a second pair of eyes are the strong ones.

## Global constraints

- `server/` untouched. `src/game/merge-state.js` is a colleague's file and must not be modified.
- No new dependencies; `package.json` unchanged. **No asset may change** — this composes parts
  already built.
- `STATUS_ORDER` and the eight `AGENT_LOOK` keys unchanged.
- Theme port **5280**, bound explicitly to IPv4 — the default binding here is IPv6-only. Ports
  5274, 5275 and 5276 belong to the always-on installation.
- All code, comments and documents in English.
- A documentation claim must be true of the code. Every Important review finding across six
  stages has been documentation asserting the opposite of the implementation.

## Explicitly not doing

- **No traffic beyond what exists.** Ambient traffic and the delivery drive keep their current
  behaviour; they simply have roads worth using. Anything more is a later stage.
- **Nothing obeys the traffic lights.**
- **No diagonal or curved streets.** The kit cannot make them.
- **No pedestrians**, no interiors, no street lighting as a real light source.
- **Buildings mean nothing.** The colony is the data; the town is the place it sits in.
- **No change to the crew, the houses, the garments or the depot.**
