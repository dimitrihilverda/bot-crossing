# Streets and Traffic — Stage 4 of the Moving-In theme

**Status:** approved 2026-09-10
**Stage:** 4, following the world (stage 1), the delivery drive (stage 2) and the crew
(stage 3). Those three are complete and pushed through `ede725d`.
**Preceding spec:** `docs/superpowers/specs/2026-09-09-moving-in-theme-design.md`

## Goal

Give the colony streets, drive the delivery vehicles along them, and add ambient traffic
that is not tied to any coding-agent thread — vehicles that leave the depot, visit an
address, wait there, and come back. Along the way, put the crew in workwear instead of the
five shades of white left over from the spacesuit.

## What the asset packs actually contain

Every claim below was measured from the built kits, not assumed.

| Part | Size (x, y, z) | Notes |
| --- | --- | --- |
| `road_straight` | 2 × 0.1 × 2 | 104 verts |
| `road_corner` | 2 × 0.1 × 2 | turns 90° |
| `road_corner_curved` | 2 × 0.1 × 2 | turns 90° |
| `road_junction` | 2 × 0.1 × 2 | four arms |
| `road_tsplit` | 2 × 0.1 × 2 | three arms |
| `road_straight_crossing` | 2 × 0.1 × 2 | zebra |
| `streetlight` | 0.27 × 0.96 × 0.07 | |
| `car_stationwagon` | 0.42 × 0.34 × 0.94 | reserved for deliveries |

Every road piece is a **2 × 2 square tile, 0.1 thick, centred on the origin**. All six turn
in multiples of 90°.

Vehicle bodies in `city.glb`: `car_hatchback`, `car_sedan`, `car_taxi`, `car_police`,
`car_stationwagon` — each with four separately named wheel nodes. There is **no van, truck
or bus in the pack**, which stage 2 already established; the stationwagon remains the
closest thing and stays the delivery vehicle.

Street furniture in `city.glb`: `streetlight`, `bench`, `bush`, `trafficlight_A/B/C`. No
hedge, fence or tree. Trees, bushes, grasses and rocks live in `forest.glb`, which is a
**separate atlas** — see "One material per geometry" below.

## The geometry that constrains everything

The colony is a lattice of **flat-top hexagons**, `CELL = 7.6` centre-to-corner, and the
cells tile exactly (`TILE = CELL * 0.992 = 7.539`). Centre-to-centre between neighbours is
`CELL * √3 ≈ 13.16`. The edge-midpoint distance is `TILE * cos 30° ≈ 6.53`.

Measured in the running colony rather than derived:

- Building slots sit at radius **0** (the middle of a cell) and **4.37** (a ring of six).
- Existing ground clutter — crates, drums, floodlights — occupies **4.00 to 6.35**.
- A delivery car at `CAR_SCALE = 1.45` is **0.61 wide and 1.36 long**.

So the clear band between the outermost clutter and the kerb is **0.18 wide**, and even
with the clutter removed the band between a building's outer face and the kerb is about
**0.66**. A car fits in 0.66 with five hundredths to spare, and the road tile carries two
painted lanes that would become an unreadable smear at that width.

**A road cannot be threaded between the plots.** This is the finding the whole design rests
on, and it is why streets take whole cells.

**But a whole cell is not a street either.** A hex cell is 13.16 across — twenty-one car
widths. Paving one would read as a plaza. So a *street cell* is a **street block**: a
carriageway **2.5 wide** running through it, and verge either side carrying streetlights,
benches, bushes and planting.

## Architecture

Four new units, each with one responsibility, plus two touched files.

### 1. `src/world/streets.js` — where the streets go (pure)

Streets are a **derived layer**, computed from the plot layout after it is allocated. This
is deliberate and is the single most important safety property of this design:
`allocateCells` and `layOut` in `src/world/plots.js` are **not changed**, so the sticky
layout persisted in `data/colony.json` carries no risk at all.

```
planStreets(cellsByPlot, shipCell) -> { ring: Cell[], spurs: Map<plotId, Cell[]>, all: Set<key> }
```

- **The ring** is the hex ring one radius outside the outermost **home** plot cell.
  Anchored districts do not push it out — they sit at `ANCHOR_RING = 5` by design, and a
  ring dragged out to meet them would pave the deliberate gap of bare terrain between the
  colony and a neighbour's settlement. The ring skips any cell a plot or a district claims.
- **A spur** is the shortest chain of unclaimed cells from a plot to the ring, one per
  plot. The depot (`SHIP_CELL = { q: -2, r: 1 }`) gets a spur of its own.
- **A plot with no unclaimed neighbour gets no spur.** This is expected, not an error: a
  plot ringed by other plots cannot be reached by road, and the fallback below covers it.

`ANCHOR_RING = 5` is where a visiting colony pitches its district. The street ring must
never occupy an anchored district's cells, and `planStreets` takes the anchored cells so it
can skip them.

### 2. `isConnected` must treat street cells as passable

`isConnected` in `plots.js` already treats the ship's cell as a stepping stone that need
not be reached but may be crossed. Street cells need exactly the same treatment. Without
it, a colony that a ring road runs through is judged disconnected, `allocateCells` throws
away the remembered layout, and every plot re-seeds from the middle **on every poll** —
the precise upheaval that function exists to prevent, arriving by the back door.

This is the only change to `plots.js`, and it is additive: one more set of passable keys.

### 3. `src/world/road-mesh.js` — drawing the street surface

One merged mesh per street cell family, built from the six city-atlas road tiles scaled
from their native 2 × 2 to the 2.5 carriageway width (a factor of 1.25), laid at
`DECK_TOP` where the street cell adjoins the deck and at the terrain height elsewhere.

**The 120° problem, stated plainly.** A path along the hex lattice turns in multiples of
60°. Every corner piece in the pack turns 90°. There is no combination of the six pieces
that makes a correct 120° bend. At each bend the design places a `road_junction` as a patch
of carriageway and lets the two straights run into it. **This is a visible compromise: a
four-armed junction tile sits where two arms meet, and the extra arms read as short stubs.**
No comment, README line or spec sentence may claim the markings line up. At the colony's
resting camera distance (~36 units) the stubs are a few pixels; that is the whole of the
mitigation.

### 4. `src/world/traffic.js` — ambient traffic (pure state machine)

A pool of vehicles that mean nothing individually. Per vehicle:

```
depot -> driving out -> waiting at the address -> driving back -> depot
```

- Bodies are `car_hatchback`, `car_sedan`, `car_taxi` and, rarely, `car_police`, in
  neutral greys, whites and blacks.
- **The delivery signature stays exclusive.** A stationwagon in a repo's accent colour
  with a load on its roof means "a thread is being worked on". Nothing ambient may use
  that body, that colour source, or a roof load. Different shape *and* different palette,
  so the distinction survives every zoom level.
- **Density scales with colony activity.** The count is a pure function of the active-thread
  count: **zero** vehicles when nothing is active, rising to a cap of **8**. Monotonic, so
  more activity never means less traffic. Tested directly. Individual vehicles still carry
  no information — only the volume does, as atmosphere. That resolution is deliberate and is recorded here because it is the one
  place this design lets traffic mean anything at all.
- Addresses are drawn at random from the houses that exist. A vehicle waits a randomised dwell of
  **4 to 12 seconds**, then returns.

The state machine, the density function, and the route arithmetic are pure and tested
under `node --test`. Nothing in this module imports three.js beyond what it needs for
vectors.

### 5. Routing: `src/world/drive-path.js` gains a road variant

`hexLine`, `pathLength`, `pointAt`, `kerbBack` and `driveStep` all stay. A road route is
composed: **depot spur → ring → plot spur → kerb**, over street cells.

Two behaviours from stage 2 are **binding requirements**, not nice-to-haves, because this
is the code that opens up and it is where regression is most likely:

- A vehicle parks at the **kerb** (`kerbBack`) so it stays visible, and a house disappears
  only after its vehicle has arrived home.
- **A crew member whose status carries a badge is never suppressed, and neither is one
  standing still.** Stage 2's ruling went through two revisions before landing on this, and
  the second revision silently dropped what the first protected. It is restated here so a
  reviewer can check it directly.

**The fallback is documented behaviour, not a defect.** Where a plot has no spur, the
vehicle drives the last stretch over the deck exactly as it does today. "Roads steer
everything" means roads steer wherever roads exist.

### 6. Workwear: `SUIT_TONES`

The crew body is one `InstancedMesh` with **one colour per agent**, already written per
thread from `SUIT_TONES` at `src/agents/astronauts.js:709`. The list is five shades of
white — `0xf3f1ec, 0xe8e4dc, 0xf7f4ee, 0xdfe4e8, 0xf1e9df` — left over from the spacesuit.
Stage 1 re-themed the *trim* to hi-vis, denim and canvas and never touched the body.

Replace them with low-chroma workwear: graphite, khaki-grey, olive-grey, taupe and
blue-grey. Two constraints:

- **No workwear tone may be confusable with a trim colour.** Trim carries status through
  all eight `AGENT_LOOK` keys, and two of those (`waiting` 0x46689e, `sleeping` 0x4c5468)
  are blue. Body tones stay clearly darker and greyer than any trim.
- The bloom arithmetic stage 3 established depends on band colour alone, so no band figure
  changes. Contrast against the band *improves*, which is a welcome side effect rather
  than the point: at present 76 of 90 threads sleep, and a dark navy band on a white body
  is nearly invisible.

Body colour is one flat colour for the whole figure, so this produces a boilersuit, not a
two-tone outfit. Real garments — a vest over a shirt, trousers in another colour — need
meshes sliced from the body the way the hi-vis bands were, and are **explicitly out of
scope here**.

## One material per geometry

A merged geometry carries one material, so two atlases can never become one mesh. This
already forces a house to be two meshes (city-atlas shell, furniture-atlas contents). It
constrains this stage the same way:

- Road surface and city-atlas street furniture (`streetlight`, `bench`, `bush`,
  `trafficlight_*`) can merge with each other.
- Verge planting from `forest.glb` **cannot** merge with them. The verge therefore reuses
  the **existing scatter system**, which already draws `forest.glb` content, rather than
  introducing a new mesh.

## Testing

Everything that is arithmetic is pure and tested under `node --test`, following the
precedent of `drive-path.js` and `growth.js`:

- `planStreets`: the ring sits outside every occupied cell; no street cell is ever a plot
  cell or an anchored district cell; a plot with a free neighbour gets a spur; a plot
  without one gets none; the depot always gets a spur.
- `isConnected`: a colony whose plots are separated by street cells is still connected; a
  genuinely scattered colony still is not.
- Road route composition: total length equals the sum of its legs; a route ends at the
  kerb, not in the house.
- Traffic: the state machine visits its four states in order; a vehicle leaves its address no
  earlier than 4 s and no later than 12 s after arriving; the
  density function returns exactly 0 for an all-sleeping colony, never exceeds 8, and is
  monotonic in the active-thread count.
- Workwear: for every `SUIT_TONES` entry against every one of the eight `AGENT_LOOK`
  trim colours, **sRGB distance ≥ 0.15** and **trim luminance ÷ body luminance ≥ 1.15**.
  Both asserted, not eyeballed, and both thresholds are stated here so a reviewer checks
  the constants against this line rather than inferring them.

  An earlier draft of this spec demanded a distance of 0.25 **in linear RGB**, which is
  unachievable and was corrected before any code was written. Linear RGB compresses dark
  colours severely, and two trim colours are themselves dark (`sleeping` 0x4c5468,
  `waiting` 0x46689e), so every plausible workwear tone measured between 0.02 and 0.10
  from `sleeping` — an order of magnitude short. The luminance-ratio rule replaces it
  because it is the property that actually matters: the band has to be *brighter* than the
  cloth it sits on.

  This is also what was wrong before. Every trim colour measures between 0.09 and 0.41 in
  luminance while the five white bodies measure 0.77 to 0.91, so today the hi-vis band is a
  **dark smudge on a white suit**. Under the new tones the darkest trim is still 1.18× the
  brightest body, so trim reads as trim for all eight statuses.

**Animated behaviour is verified by driving frames by hand**, not through the browser pane.
That pane does not tick `requestAnimationFrame` in this project — measured at 0 frames in
3 seconds with the document visible — so any evidence gathered by sampling animated state
through it is worthless. Drive the real per-frame path from the console
(`for (let i = 0; i < 600; i++) colony.update(1/60, elapsed += 1/60)`) and then sample.
Two separate agents have mis-attributed this pane behaviour to stale caching.

## Global constraints

- `server/` stays **byte-identical** to Dimitri's `shared-colonies` branch.
  `git diff -- server/` must be empty at the end of the stage; it has been verified empty
  at the end of stages 1, 2 and 3.
- No new dependencies. `package.json` unchanged.
- Theme port is **5280**. Ports 5274, 5275 and 5276 belong to the always-on installation
  and must never be used by a dev server.
- All code, comments and documents in English.
- `STATUS_ORDER` and the eight `AGENT_LOOK` keys unchanged.
- Test baseline entering this stage: **157 passing, 0 failing**; `npm run build` succeeds.
- A documentation claim must be true of the code. Across stages 1 to 3 **every** Important
  review finding — seven of them — was documentation asserting the opposite of the
  implementation, and one fix round introduced a fresh false claim while correcting
  another. Reviewers are to be pointed at this by name, and must also check that nothing
  *removed* was true.

## Explicitly not doing

- **No van.** The pack has none, and no CC0 library in a matching style turned one up when
  stage 2 looked. The stationwagon stays.
- **No traffic rules.** Vehicles do not queue, yield, or obey the traffic lights, which are
  scenery. Collision avoidance between ambient vehicles is out of scope.
- **No pedestrian crossings for the crew.** Crew navigation is unchanged; they do not use
  the roads.
- **No two-tone garments.** See "Workwear" above.
- **No change to `allocateCells` or `layOut`.** Streets are derived. The one change to
  `plots.js` is making street cells passable in `isConnected`.
- **No theme id in `/guest/info`.** Dimitri asked for `moving-in` defaulting to
  `bot-crossing`, was explicit that it is not urgent, and it lives in `server/`, which this
  stage may not touch.
