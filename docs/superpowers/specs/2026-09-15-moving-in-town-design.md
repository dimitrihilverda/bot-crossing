# A Town Around the Colony — Stage 6 of the Moving-In theme

**Status:** approved 2026-09-15. **Renumbered and pending revision** — see below.
**Stage:** 7, following the world (1), the delivery drive (2), the crew (3), streets and
traffic (4), crew garments (5) and the square lattice (6).

> **This spec was written before the colony's lattice was squared, and assumes a hexagonal
> colony.** Its content stands — the 2 × 2 module, the derived-layer rule, the flattened
> ground, the budget — but three things in it are now wrong and must be revisited before it is
> planned: the town no longer needs its own grid separate from the colony's; the "join
> between the two road networks" it names as a known unfinished edge does not exist, because
> there is only one network; and the two passages saying the colony's own streets "keep their
> 120° compromise" and that "the markings do not line up" (under "What the packs actually
> contain" and again under "Explicitly not doing") are no longer true — that compromise was
> removed in the square-lattice stage, and every bend on the colony's streets is now a real
> right angle, laid with the kit's own corner piece. See
> `docs/superpowers/specs/2026-09-15-moving-in-square-lattice-design.md`.
**Preceding specs:** `docs/superpowers/specs/2026-09-10-moving-in-streets-and-traffic-design.md`,
`docs/superpowers/specs/2026-09-11-moving-in-crew-garments-design.md`

## Goal

Put a town around the colony, so the hexagonal deck of plots sits in a place rather than on an
empty plain: streets, buildings, pavements, planting and street furniture, all from the packs
already in the repo.

**Traffic on those streets is deliberately not in this stage.** It is a second subsystem with
its own routing — a square grid rather than the hex lattice the existing traffic drives — and
the town is worth having and looking at on its own. It follows as stage 7.

## What the packs actually contain

Measured from the built assets on 2026-09-15, not assumed.

`public/assets/city.glb` holds **61 nodes**, and **everything in it is built on a 2 × 2
module**:

| Part | Size (w × h × d) | Notes |
| --- | --- | --- |
| `building_A` … `building_H` | all **2 × 2** in plan, 1.65–3.05 tall | eight of them, each with a `_withoutBase` variant |
| `road_straight`, `road_corner`, `road_corner_curved`, `road_junction`, `road_tsplit`, `road_straight_crossing` | 2 × 0.1 × 2 | all turn in multiples of 90° |
| `base` | 2 × 0.1 × 2 | the pavement slab |
| `streetlight` | 0.27 × 0.96 × 0.07 | |
| `trafficlight_A` / `_B` / `_C` | 0.17 × 0.73 × 0.15 | |
| `bench`, `bush`, `dumpster`, `firehydrant`, `trash_A`, `trash_B`, `watertower`, `box_A`, `box_B` | 0.13–0.57 wide | street furniture |

**That 2 × 2 module is the single most important fact in this spec.** The colony is a
hexagonal lattice and the kit's corners turn 90°, which is why stage 4 had to drop a
four-armed junction tile at every 120° bend and say plainly that the markings do not line up.
The town has no such problem: it lives **outside** the colony on its own square grid at a
2-unit pitch, where every piece works as designed — corners, T-splits, junctions, crossings,
and buildings sitting flush against pavement.

Atlas cells, measured from each part's UVs (the atlas is 8 columns by 4 rows):

- `base` uses **only** cell 2, `#818c91` — a flat mid grey.
- `road_straight` uses cell 2 for the tarmac, cell 1 `#d4dbde` for the white lines and cell 11
  `#d09745` for the amber ones.

**So pavement and road are the same grey.** A kerb cannot be drawn by colour; it has to come
from the pavement sitting proud of the carriageway, and from the shadow that casts.

`public/assets/forest.glb` holds 16 nodes: `Tree_1_A`, `Tree_1_C`, `Tree_3_A`, `Tree_3_C`,
`Tree_4_A`, `Tree_4_C`, `Bush_1_E`, `Bush_3_B`, `Grass_2_D` and six rocks. It is a **separate
atlas**, so its content cannot merge into the same mesh as the city kit's.

## The ground has to be flattened, and the mechanism already exists

Measured in the running colony: the terrain runs **−0.3 to +0.24** inside the colony but
**−2.05 to +3.31** between radius 40 and 80, which is where the town goes. Buildings are
1.65–3.05 tall, so five units of height variation would sink some and float others, and flat
square road tiles would step visibly against the slope.

The flattening is already there. `src/world/planet.js` has, at two places:

```js
const outside = THREE.MathUtils.smoothstep(dist, COLONY_RADIUS - 6, COLONY_RADIUS + 40)
```

with `COLONY_RADIUS = 46`. So the terrain is flat inside radius **40** and reaches full
roughness at **86**; the measurements above are that ramp. Widening the flat zone to a new
`TOWN_RADIUS` is therefore a change to those two expressions, and the existing `smoothstep`
gives the blend at the town's edge for free.

`groundAt(x, z)` in `colony.js` checks `deckedCells` and otherwise falls through to
`terrainHeight`, so **everything that reads the ground follows automatically** — the crew
walking, the delivery cars driving, the road surface, the scatter.

**This changes the look of the whole world, not only the town**: the hills move outward.
That is accepted, and it is the reason `TOWN_RADIUS` is its own constant rather than a bigger
`COLONY_RADIUS` — `COLONY_RADIUS` is also read by `sky.js` and by the scatter's distance
falloff, and those should keep meaning what they mean.

## Architecture

### 1. `src/world/town.js` — what is where (pure)

No three.js, no colony state, so it can be tested under `node --test`, following
`src/world/streets.js`, `drive-path.js` and `growth.js`.

The town is a **derived layer**, exactly as the streets are: it reads the colony's current
footprint and never influences it.

```
townCells(options) -> Array<{ gx, gz, kind, seed }>
```

where `kind` is `'road'`, `'pavement'`, `'building'`, `'green'` or `'empty'`, and `gx`/`gz`
are integer grid coordinates at a pitch of **2**.

Four rules decide a cell, in this order:

1. **The outline is playful, not square.** A cell is inside the town when its distance from
   the origin is under a boundary that **varies with direction** — a smooth periodic function
   of the angle, so the town frays into the countryside instead of ending on a straight edge.
   It must be deterministic: same seed, same outline, every reload.
2. **Roads run on every third row and column** — `gx % 3 === 0 || gz % 3 === 0` — so the
   blocks between them are 2 × 2 cells, which is 4 × 4 world units and exactly the 2 × 2
   arrangement of buildings the kit's module is built for.
3. **A block is green rather than built** when a stable hash of its block coordinates says so.
   Green blocks carry trees, bushes and grass from `forest.glb`.
4. **The colony always wins.** A cell whose centre falls inside a hex the colony claims — a
   plot cell, a street cell or the depot — is `'empty'` and nothing is drawn there.
   `worldToHex(x, z)` from `plots.js` already gives the containing hex for a point, so this is
   one call per cell.

**The content of a cell is a function of its own grid position, never of the colony.** That is
what makes rule 4 safe: the same cell always shows the same building, the same rotation, the
same tree. When the colony grows, those cells go dark; when it shrinks, they come back
identical. Nothing ever jumps, which is the failure the colony's own sticky layout exists to
prevent and which a position-dependent town would have reintroduced.

### 2. `src/world/town-mesh.js` — drawing it

Every city-kit part shares one atlas and therefore one material, so **all of the town's roads,
pavements, buildings and furniture merge into a single geometry**. Planting from `forest.glb`
is a second one, because a merged geometry carries one material and that is a different atlas.
Two draw calls for the whole town.

`createTown({ cells, groundAt })` returns a `THREE.Group` publishing `userData.dispose()`.
**That disposal is not bookkeeping**: stage 1 of this project shipped a group handed to
`colony.js` without one and leaked its meshes at 144 Hz.

Placement rules:

- **Pavement** (`base`) on the block-edge cells facing a road, laid proud of the carriageway
  so the kerb reads as a height step and a shadow. Colour cannot do it: `base` and the road
  surface are the same grey, cell 2.
- **Streetlights along the roads**, not only at corners — spaced along each road run, on the
  pavement side. The spacing is the implementer's to choose by eye and to record with the
  number it settled on; too dense reads as a fence and too sparse as an accident.
- **`road_straight_crossing`** as a zebra, on the road cells adjacent to a junction.
- **`trafficlight_A` / `_B` / `_C`** at junctions. They are scenery in this stage; nothing
  obeys them, because there is no traffic yet.
- **The other furniture** — benches, dumpsters, hydrants, bins, a water tower — scattered on
  pavement cells from the same per-cell hash, sparsely.

### 3. `src/world/planet.js` — the flat zone

Add `TOWN_RADIUS` and widen the two `smoothstep` expressions to flatten out to it.

**Its value is the first task's to choose and record**, not this spec's to guess: it has to
exceed the outline's own maximum radius, or the town's far edge would sit on hills again, and
it has to leave enough ramp before the terrain reaches full roughness that the join does not
read as a cliff. Those are two measurements, and they are taken against the outline the same
task settles. Do **not**
change `COLONY_RADIUS`: `sky.js` imports it, and the scatter's distance falloff and the
crater placement read it, and those mean something else.

`createScatter(planet, density, keepClear, seed)` already takes a `keepClear` list of
`{ x, z, r }`, so the natural planting can be kept out of the streets without new machinery.

### 4. `src/game/colony.js` — wiring

The town is rebuilt whenever the street plan is, and by the same rule: dispose the old group,
remove it from the scene graph, build the new one, add it. That order is the one the existing
`roadGroup` and `scatterGroup` already follow.

## The budget, which is the real risk

**The town has no inner edge.** It fills everything inside its outline that the colony does
not claim, right up against the colony's own kerb — that is what makes the space come back
when a repo disappears. The colony currently reaches radius 39.5, but that is today's
footprint, not a boundary.

So the area to budget for is the whole outline minus whatever the colony happens to occupy.
At an outline averaging radius ~75 that is roughly 17,000 square units, which at a 2-unit
pitch is about **4,300 cells** before the colony is subtracted. With buildings at 1,392–3,336 vertices each, naively filling that
would add millions of vertices and is not shippable.

**So the first task's job is to measure and choose**, not to assume. Establish:

- the vertex count of the colony as it stands today, as the yardstick;
- how many cells the outline actually produces at a candidate `TOWN_RADIUS`;
- how many of those are buildings after the road, green-block and colony-occupancy rules.

**The town must not add more geometry than the colony itself draws.** If the first honest
count exceeds that, the levers, in the order they should be pulled: a narrower band, a larger
green-block share, and the `_withoutBase` building variants where a base is never seen. Record
which lever was used and the number it produced.

## Testing

Everything that decides *what goes where* is pure and tested under `node --test`:

- The outline is deterministic — the same seed gives the same cell set — and is **not** a
  circle: assert that its radius genuinely varies with direction by more than a margin the
  implementer states and records. Without that assertion the "playful" requirement can quietly
  become a disc and no test would notice.
- Roads land on every third row and column, and blocks are exactly 2 × 2 cells.
- A cell whose centre lies inside a claimed hex is `'empty'`; one outside is not. Test this
  against a hand-built layout rather than the live colony.
- **A cell's content does not depend on the colony.** Compute the town for two different
  colony footprints and assert every cell present in both has identical content. This is the
  test that protects the property the whole design rests on.
- The budget: the building count for a stated outline and seed is at or under the recorded
  ceiling, so a later change cannot quietly triple it.

Animated behaviour is verified by driving frames by hand, never through the Browser pane,
which does not tick `requestAnimationFrame` in this project — measured at 0 frames in 3
seconds. The engine's updaters are objects with an `update(dt, elapsed)` method, so the call
is `u.update(1/60, t)`.

**And the town must be looked at.** Its whole point is how it reads, and no test can judge
that. Whether the kerb reads as a kerb, whether the outline looks deliberate rather than
ragged, and whether the flattened ground meets the hills convincingly are all questions for
eyes.

## Global constraints

- `server/` must stay untouched — `git diff -- server/` empty. A colleague's LAN
  colony-sharing server lives there. Note what that command actually proves: that *we* did not
  change it. It compares against our own HEAD, not against his branch.
- No new dependencies. `package.json` unchanged.
- **No asset may change.** `city.glb`, `forest.glb`, `furniture.glb`, `crew.glb` and
  `spacebase.glb` all stay as they are; this stage composes what is already built.
- `STATUS_ORDER` and the eight `AGENT_LOOK` keys unchanged.
- Theme port is **5280**, bound explicitly to IPv4 — the default binding here is IPv6-only, so
  `127.0.0.1:5280` otherwise refuses. Ports 5274, 5275 and 5276 belong to the always-on
  installation.
- All code, comments and documents in English.
- A documentation claim must be true of the code. Every Important review finding across five
  stages has been documentation asserting the opposite of the implementation, and two fix
  rounds introduced a fresh false claim while correcting another. Reviewers are to be pointed
  at this by name, and must check that nothing *removed* was true either.

## Explicitly not doing

- **No traffic.** Stage 7.
- **Nothing obeys the traffic lights**, because nothing drives yet. They are scenery.
- **No interiors, no windows that light up, no night-time street lighting as an actual light
  source.** The streetlights are geometry; adding real lights is a performance decision of its
  own.
- **The town does not grow or shrink of its own accord.** Its outline is fixed; only the
  colony's footprint changes what is drawn inside it.
- **Buildings mean nothing.** They are not repos, not threads, not anything. The colony is the
  data; the town is the place it sits in.
- **No pedestrians.**
- **No change to the colony's own hex streets**, which keep their 120° compromise and their
  junction patches.
- **The join between the two road networks is not solved in this stage.** The colony's ring
  road runs on the hex lattice and the town's runs on a square grid, and where they meet the
  tiles will not line up — one network simply stops near the other. That is tolerable while
  nothing drives between them, and it becomes a real problem the moment something does, so it
  belongs to stage 7 along with the routing that needs it. Naming it here is the point: it is
  a known unfinished edge, not an oversight to be discovered later.
