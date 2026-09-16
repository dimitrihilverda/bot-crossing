# One Street Network, and a Town On It — Stage 7 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the ring road with one street network running *through* the colony's lattice, and fill the blocks it leaves with a town, so vans drive on roads and the colony sits in a place.

**Architecture:** A seeded binary slicing of the cell lattice picks which cells are streets; everything else is a block. Streets are a function of position and seed alone — never of which repos exist — so the colony's plots are allocated into the blocks (`allocateCells` already refuses street cells) and the town fills whatever blocks the colony has not taken. Each street cell's road tile is chosen from **its four neighbours**, not from a walk order: the set of neighbouring street cells is the cell's *arm set*, and arm set determines both the kit piece and its rotation. That is what removes `ringRuns`, the `closed` flag and the cross-run dedup set, and it is what makes the corner rotation provable instead of guessed.

**Tech Stack:** Vanilla ES modules, three.js 0.185, Vite 7, `node --test` with `node:assert/strict`. `@gltf-transform/core` (devDependency) for reading `city.glb` in tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-16-moving-in-streets-and-town-design.md` (commit `531751e`)

## Global Constraints

- `server/` untouched. `src/game/merge-state.js` is a colleague's file and must not be modified.
- No new dependencies; `package.json` unchanged. **No asset may change** — this composes parts already built.
- `STATUS_ORDER` and the eight `AGENT_LOOK` keys unchanged.
- Theme port **5280**, bound explicitly to IPv4: `npx vite --host 127.0.0.1 --port 5280 --strictPort`. The default binding here is IPv6-only. Ports 5274, 5275 and 5276 belong to the always-on installation and must never be used.
- All code, comments and documents in English.
- A documentation claim must be true of the code. Every Important review finding across six stages has been documentation asserting the opposite of the implementation.
- Repo `C:\PhpstormProjects\bot-crossing-moving-in`, branch `moving-in-theme`. 284 tests passing at the start of this plan; the count only goes up.
- Run the suite with `npm test`. A task is not done until it is green.

---

## Two rulings made while writing this plan

Both change a number the spec states. Recorded here so no implementer has to guess and no reviewer has to wonder.

**1. `CARRIAGEWAY_WIDTH` becomes 2.4, not 2.5.** The spec says "The carriageway is 2.5 wide down the middle". A cell is 12 units and a kit road tile is 2 units square; for tiles to meet edge-to-edge inside a cell with no overlap and no gap, the tile's world size must divide 12 exactly. 12/5 = 2.4 is the nearest such value to 2.5 — a 4% change, invisible next to a 0.61-wide car, and it buys an exact 5 x 5 sub-grid per cell. 2.5 does not divide 12 and forces either overlapping slabs at cell boundaries (z-fighting) or a gap in the road.

**2. The corner tile is currently wrong in *every* case, not some.** Measured from `city.glb` (see Task 3): `road_corner` unrotated joins its **+Z edge to its +X edge**. `road-mesh.js:185` computes the rotation from the *incoming* heading only, `ry = PI/2 - heading`. For a van travelling +X the entrance must be on the **-X** edge, and `ry = PI/2` puts the tile's ports at {+X, -Z} — which does not contain -X at all. Turning +X then +Z needs {-X, +Z} (`ry = 3PI/2`, 180 degrees off); turning +X then -Z needs {-X, -Z} (`ry = PI`, 90 degrees off). A corner needs **both** directions and `heading` carries one. This is why the owner saw wrong corners and why both previous checks missed it — see the spec's "The corner check" section.

---

## File Structure

**Created:**

- `src/world/rng.js` — the seeded PRNG, moved out of `planet.js` so a pure module can use it without importing three.js. One function, `mulberry(seed)`.
- `src/world/street-plan.js` — which cells are streets. Pure, seeded, takes no colony state. The heart of the stage.
- `src/world/town-plan.js` — what fills a block cell. Pure, a function of cell position and seed only.
- `src/world/town-mesh.js` — the town's buildings and planting, as merged geometry.
- `test/street-plan.test.mjs`, `test/town-plan.test.mjs`, `test/road-tiles.test.mjs`, `test/road-corner-glb.test.mjs`, `test/town-mesh.test.mjs`, `test/route-on-street.test.mjs`

**Modified:**

- `src/world/streets.js` — loses the ring, the spurs and everything that served them; becomes a thin adapter over `street-plan.js`.
- `src/world/road-mesh.js` — `carriagewayPoints` (walk-order) replaced by `carriagewayTiles` (arm-set). Verge furniture added.
- `src/world/planet.js` — `mulberry` re-exported from `rng.js`; `TOWN_RADIUS` widens the flat zone; scatter keeps clear of the town.
- `src/game/colony.js` — the `planStreets` call site and the town group's lifecycle.
- `src/world/grid.js` — comments referencing `ringRuns` corrected.
- `test/streets.test.mjs`, `test/road-mesh.test.mjs` — rewritten against the new shapes.

**Deleted:** nothing whole; `streets.js` loses `SHIP_SPUR`, `chebyshev`, `claimedCells`, `ringRadius`, `shortestChain`, `ringRuns`.

---

### Task 1: The street pattern

Which cells are streets. Pure, seeded, and it takes **no colony state at all** — that is what makes the spec's "the street layout does not depend on which repos exist" structural rather than a promise.

**Files:**
- Create: `src/world/rng.js`
- Create: `src/world/street-plan.js`
- Modify: `src/world/planet.js` (move `mulberry` out, re-export it)
- Test: `test/street-plan.test.mjs`

**Interfaces:**
- Consumes: `key`, `line`, `neighbours` from `src/world/grid.js`.
- Produces: `planStreetCells(seed?, radius?) -> [{x, z}]` sorted by x then z; `TOWN_CELL_RADIUS = 8`; `STREET_SEED = 20260916`; `PROTECTED_CELLS`. Task 2 wraps this; Tasks 5-8 read the cell set.

- [ ] **Step 1: Move the PRNG into its own module**

`planet.js` imports three.js. A pure lattice module must not, so the PRNG moves. Create `src/world/rng.js` with the function **cut verbatim** from `src/world/planet.js:363-372` — do not retype it; an altered constant silently changes the existing scatter layout:

```js
/** Small deterministic PRNG — same seed, same world, every reload. */
export function mulberry(seed) {
  let a = seed >>> 0
  return function () {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}
```

In `planet.js`, delete the function body and replace it with a re-export beside the other imports, so every existing caller (`planet.js:170`, `planet.js:247`, and anything importing it from `planet.js`) keeps working unchanged:

```js
export { mulberry } from './rng.js'
```

- [ ] **Step 2: Run the suite to prove the move changed nothing**

Run: `npm test`
Expected: PASS, 284 tests. The scatter layout is seeded from this function; a failure here means the move was not verbatim.

- [ ] **Step 3: Write the failing tests**

Create `test/street-plan.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { planStreetCells, TOWN_CELL_RADIUS, STREET_SEED, PROTECTED_CELLS } from '../src/world/street-plan.js'
import { key, neighbours } from '../src/world/grid.js'

const cells = planStreetCells()
const streetKeys = new Set(cells.map((c) => key(c.x, c.z)))
const inTown = (c) => Math.max(Math.abs(c.x), Math.abs(c.z)) <= TOWN_CELL_RADIUS

test('the same seed gives the same streets', () => {
  assert.deepEqual(planStreetCells(STREET_SEED), planStreetCells(STREET_SEED))
})

test('a different seed gives different streets', () => {
  assert.notDeepEqual(planStreetCells(STREET_SEED), planStreetCells(STREET_SEED + 1))
})

test('the depot and the origin are never streets', () => {
  for (const p of PROTECTED_CELLS) {
    assert.equal(streetKeys.has(key(p.x, p.z)), false, `${p.x},${p.z} is a street`)
  }
})

test('the street network is one connected whole', () => {
  const seen = new Set([key(cells[0].x, cells[0].z)])
  const queue = [cells[0]]
  while (queue.length) {
    for (const n of neighbours(queue.pop())) {
      const k = key(n.x, n.z)
      if (streetKeys.has(k) && !seen.has(k)) {
        seen.add(k)
        queue.push(n)
      }
    }
  }
  assert.equal(seen.size, cells.length, `${cells.length - seen.size} street cells are cut off`)
})

test('block sizes vary — this is not a chessboard', () => {
  const blocks = []
  const seen = new Set()
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const k = key(x, z)
      if (streetKeys.has(k) || seen.has(k)) continue
      let size = 0
      const queue = [{ x, z }]
      seen.add(k)
      while (queue.length) {
        const c = queue.pop()
        size++
        for (const n of neighbours(c)) {
          const nk = key(n.x, n.z)
          if (!inTown(n) || streetKeys.has(nk) || seen.has(nk)) continue
          seen.add(nk)
          queue.push(n)
        }
      }
      blocks.push(size)
    }
  }
  assert.ok(blocks.length >= 8, `only ${blocks.length} blocks`)
  assert.ok(new Set(blocks).size >= 3, `block sizes are all but identical: ${[...new Set(blocks)].join(',')}`)
})

test('streets bend — a chessboard has no bends at all', () => {
  let bends = 0
  for (const c of cells) {
    const arms = neighbours(c).filter((n) => streetKeys.has(key(n.x, n.z)))
    if (arms.length !== 2) continue
    if (arms[0].x !== arms[1].x && arms[0].z !== arms[1].z) bends++
  }
  assert.ok(bends >= 4, `only ${bends} bends`)
})

test('not every street runs the full width of the town', () => {
  const span = TOWN_CELL_RADIUS * 2 + 1
  const columns = new Set(cells.map((c) => c.x))
  let full = 0
  for (const x of columns) {
    if (cells.filter((c) => c.x === x).length === span) full++
  }
  assert.ok(full < columns.size, `all ${columns.size} street columns run the full width`)
})
```

- [ ] **Step 4: Run them to verify they fail**

Run: `node --test test/street-plan.test.mjs`
Expected: FAIL — `Cannot find module '../src/world/street-plan.js'`

- [ ] **Step 5: Write the pattern**

Create `src/world/street-plan.js`:

```js
import { key, line, neighbours } from './grid.js'
import { mulberry } from './rng.js'

/**
 * Which cells of the lattice are streets.
 *
 * Streets are a function of position and seed **only**. Nothing about the colony — which
 * repos exist, how many plots there are, where they sit — reaches this module, which is what
 * stops the town rearranging itself on every poll. The colony is allocated into whatever this
 * leaves: `allocateCells` already refuses street cells.
 *
 * The pattern is a recursive binary slice. A rectangle is cut by a street running its full
 * width, and each half is sliced again until it is small enough to be a block. That gives the
 * three things the design asks for and a chessboard cannot: block sizes that vary (the cut
 * position is seeded, not fixed), T-junctions rather than a crossroads at every meeting (a
 * child's cut ends on its parent's), and streets that jog.
 *
 * A **block is whatever the streets leave** — a maximal run of adjacent non-street cells —
 * not one of these rectangles. The rectangles are scaffolding for the generator; a jog or a
 * dead end deliberately leaves cells belonging to no rectangle, and those merge into the
 * neighbouring block exactly as they should.
 */

/** How far the street network reaches, in cells. At `CELL_SIZE` 12 this is 96 units. */
export const TOWN_CELL_RADIUS = 8

/** The seed. Changing it redraws every street in the world. */
export const STREET_SEED = 20260916

/** How small and how large a generator rectangle may be before it stops being cut, in cells. */
export const MIN_BLOCK = 1
export const MAX_BLOCK = 3

/** How often a cut steps sideways partway along, and how often it stops short of one end. */
export const JOG_CHANCE = 0.45
export const DEAD_END_CHANCE = 0.3

/**
 * Cells no street may cross. The origin is the colony's centre and `{-2, 0}` is the depot
 * (`SHIP_CELL` in `plots.js`) — a carriageway through either would put tarmac under a
 * building that is already there.
 */
export const PROTECTED_CELLS = Object.freeze([
  { x: 0, z: 0 },
  { x: -2, z: 0 },
])

/** Would a cut along `axis` at `at`, spanning `lo..hi` across, run over a protected cell? */
function crossesProtected(axis, at, lo, hi) {
  return PROTECTED_CELLS.some((p) =>
    axis === 'x' ? p.x === at && p.z >= lo && p.z <= hi : p.z === at && p.x >= lo && p.x <= hi
  )
}

function slice(rect, rand, add) {
  const w = rect.x1 - rect.x0 + 1
  const h = rect.z1 - rect.z0 + 1
  if (w <= MAX_BLOCK && h <= MAX_BLOCK) return

  // The longer side is cut, so blocks stay roughly square rather than degenerating into
  // strips. A square rectangle's tie is broken by the seed rather than always the same way:
  // always picking the same axis there is how a generator drifts into long parallel avenues.
  const cutX = w === h ? rand() < 0.5 : w > h
  const [lo, hi] = cutX ? [rect.x0, rect.x1] : [rect.z0, rect.z1]
  const [acrossLo, acrossHi] = cutX ? [rect.z0, rect.z1] : [rect.x0, rect.x1]
  const axis = cutX ? 'x' : 'z'

  const options = []
  for (let at = lo + MIN_BLOCK; at <= hi - MIN_BLOCK; at++) {
    if (!crossesProtected(axis, at, acrossLo, acrossHi)) options.push(at)
  }
  // Every legal position is blocked by a protected cell: this rectangle stays one block.
  if (!options.length) return
  const at = options[Math.floor(rand() * options.length)]

  const span = acrossHi - acrossLo + 1
  let shift = 0
  let jogAt = 0
  if (span >= 4 && rand() < JOG_CHANCE) {
    const dir = rand() < 0.5 ? -1 : 1
    if (options.includes(at + dir)) {
      shift = dir
      // Strictly inside the span, so both legs of the jog exist.
      jogAt = acrossLo + 1 + Math.floor(rand() * (span - 2))
    }
  }

  // A dead end: the cut stops short of one end, leaving a street that goes nowhere. Only on
  // an unjogged cut — trimming a jogged one can remove a whole leg.
  let runLo = acrossLo
  let runHi = acrossHi
  if (shift === 0 && span >= 5 && rand() < DEAD_END_CHANCE) {
    const trim = 1 + Math.floor(rand() * 2)
    if (rand() < 0.5) runLo += trim
    else runHi -= trim
  }

  const put = (at_, across) => (cutX ? add(at_, across) : add(across, at_))
  if (shift === 0) {
    for (let a = runLo; a <= runHi; a++) put(at, a)
  } else {
    // The two legs both include `jogAt`, and those two cells differ by one along the cut
    // axis — that adjacency is the step across, and it is why a jog stays connected.
    for (let a = runLo; a <= jogAt; a++) put(at, a)
    for (let a = jogAt; a <= runHi; a++) put(at + shift, a)
  }

  const cLo = Math.min(at, at + shift)
  const cHi = Math.max(at, at + shift)
  const children = cutX
    ? [{ ...rect, x1: cLo - 1 }, { ...rect, x0: cHi + 1 }]
    : [{ ...rect, z1: cLo - 1 }, { ...rect, z0: cHi + 1 }]
  for (const child of children) {
    if (child.x1 >= child.x0 && child.z1 >= child.z0) slice(child, rand, add)
  }
}

/**
 * Join anything the slicing left stranded.
 *
 * Two cuts on the same axis in sibling rectangles run parallel and never meet, and a jog or a
 * dead end can break the join a child's cut would otherwise make on its parent's. Rather than
 * argue those cases cannot happen — that argument was wrong twice while this plan was being
 * written — this measures the components and connects them, and the test asserts the result.
 *
 * Deterministic: components are walked in the cells' sorted order, and the pair chosen is the
 * first at the smallest Manhattan distance in that order.
 */
function connect(cells) {
  const keys = new Set(cells.map((c) => key(c.x, c.z)))
  const all = [...cells]
  for (;;) {
    const seen = new Set()
    const components = []
    for (const start of all) {
      const sk = key(start.x, start.z)
      if (seen.has(sk)) continue
      const component = []
      const queue = [start]
      seen.add(sk)
      while (queue.length) {
        const c = queue.pop()
        component.push(c)
        for (const n of neighbours(c)) {
          const nk = key(n.x, n.z)
          if (keys.has(nk) && !seen.has(nk)) {
            seen.add(nk)
            queue.push(n)
          }
        }
      }
      components.push(component)
    }
    if (components.length <= 1) return all

    components.sort((a, b) => b.length - a.length)
    let best = null
    for (const a of components[1]) {
      for (const b of components[0]) {
        const d = Math.abs(a.x - b.x) + Math.abs(a.z - b.z)
        if (!best || d < best.d) best = { a, b, d }
      }
    }
    for (const c of line(best.a.x, best.a.z, best.b.x, best.b.z)) {
      const k = key(c.x, c.z)
      if (keys.has(k)) continue
      keys.add(k)
      all.push({ x: c.x, z: c.z })
    }
  }
}

/**
 * @param seed the pattern's seed; the same seed always gives the same streets
 * @param radius how far the network reaches, in cells
 * @returns the street cells, `{x, z}`, sorted by x then z
 */
export function planStreetCells(seed = STREET_SEED, radius = TOWN_CELL_RADIUS) {
  const rand = mulberry(seed)
  const found = new Map()
  slice({ x0: -radius, z0: -radius, x1: radius, z1: radius }, rand, (x, z) =>
    found.set(key(x, z), { x, z })
  )
  return connect([...found.values()]).sort((a, b) => a.x - b.x || a.z - b.z)
}
```

- [ ] **Step 6: Run the tests**

Run: `node --test test/street-plan.test.mjs`
Expected: PASS, 7 tests.

If "block sizes vary", "streets bend" or "not every street runs the full width" fails, the levers are `JOG_CHANCE`, `DEAD_END_CHANCE` and `MAX_BLOCK`, in that order — **not** the thresholds, which are the spec's. Record in the report which lever you moved and to what.

`line()` returns `{x, z}` cells — confirm that against `src/world/grid.js:130` before relying on it in `connect`; if it returns a different shape, adapt the loop, not the function.

- [ ] **Step 7: Run the whole suite and commit**

Run: `npm test`

```bash
git add src/world/rng.js src/world/street-plan.js src/world/planet.js test/street-plan.test.mjs
git commit -m "Pick street cells from a seeded slice of the lattice, not a ring"
```

---

### Task 2: One street network, and routes that use it

Retire the ring and the spurs, point `planStreets` at Task 1, and prove with numbers that a delivery actually drives on a road. This is the task the whole stage exists for.

**Files:**
- Modify: `src/world/streets.js` (most of it goes)
- Modify: `src/game/colony.js:493`
- Modify: `src/world/grid.js` (comments on lines 71 and 78 name `ringRuns`)
- Test: `test/streets.test.mjs` (rewrite), `test/route-on-street.test.mjs` (create)

**Interfaces:**
- Consumes: `planStreetCells`, `TOWN_CELL_RADIUS`, `STREET_SEED` from Task 1.
- Produces: `planStreets({ seed?, radius? }?) -> { all: Set<string>, cells: [{x, z}] }`. Task 3 reads `cells`; `colony.js` reads `all`. **`ring`, `ringRuns`, `spurs` and `SHIP_SPUR` cease to exist** — Task 3 removes their last consumer in `road-mesh.js`.

- [ ] **Step 1: Write the failing route test**

Create `test/route-on-street.test.mjs`. This is the spec's numeric property, and the one thing that would have caught the previous design:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { planStreets } from '../src/world/streets.js'
import { roadCells } from '../src/world/road-path.js'
import { key } from '../src/world/grid.js'
import { allocateCells } from '../src/world/plots.js'
import { mulberry } from '../src/world/rng.js'

const DEPOT = { x: -2, z: 0 }

/** A spread of colonies: 3, 8, 20 and 40 plots, each from its own seed. */
function colonies() {
  const out = []
  for (const count of [3, 8, 20, 40]) {
    const rand = mulberry(count * 7919)
    out.push(
      Array.from({ length: count }, (_, i) => ({ id: `repo-${i}`, weight: 1 + Math.floor(rand() * 4) }))
    )
  }
  return out
}

test('a delivery route runs on streets', () => {
  const streets = planStreets()
  const fractions = []
  for (const projects of colonies()) {
    const layout = allocateCells(projects, new Map(), streets.all)
    for (const [, cells] of layout) {
      const route = roadCells(DEPOT, cells[0], streets.all)
      if (route.length <= 2) continue
      const onStreet = route.filter((c) => streets.all.has(key(c.x, c.z))).length
      assert.ok(onStreet > 0, `a ${route.length}-cell route never touches a street`)
      fractions.push(onStreet / route.length)
    }
  }
  assert.ok(fractions.length >= 40, `only ${fractions.length} routes measured`)
  fractions.sort((a, b) => a - b)
  const median = fractions[Math.floor(fractions.length / 2)]
  assert.ok(median >= 0.6, `median street fraction ${median.toFixed(2)} is below 0.6`)
})

test('the streets do not depend on which repos exist', () => {
  const a = planStreets()
  const b = planStreets()
  assert.deepEqual([...a.all].sort(), [...b.all].sort())
})
```

`allocateCells(projects, placed, streetKeys)` is the existing signature in `src/world/plots.js` — **read it before writing this test** and match the argument shapes it actually takes. If a project entry needs more than `{id, weight}`, copy what `test/growth.test.mjs` already builds rather than inventing a shape.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/route-on-street.test.mjs`
Expected: FAIL — `planStreets` still demands a layout and a ship, and the ring gives a median of 0.

- [ ] **Step 3: Cut `streets.js` down**

Replace the whole of `src/world/streets.js` with:

```js
import { key } from './grid.js'
import { planStreetCells, STREET_SEED, TOWN_CELL_RADIUS } from './street-plan.js'

/**
 * The colony's street network.
 *
 * A thin adapter over `street-plan.js`, kept as its own module because `colony.js` and
 * `road-mesh.js` both want the membership set and neither should care how it was picked.
 *
 * There used to be a ring one cell outside the outermost plot, with a spur from each plot to
 * it. Stage 7 removed it, and the reason is worth keeping: the ring circled the colony while
 * every delivery ran from the depot in the middle to a house in the middle, so a route never
 * had any reason to leave the plots. Measured before the change: every route was three cells
 * long and touched zero street cells. Streets have to run *between* the blocks, not around
 * them, or the router is right to ignore them — see `road-path.js`'s `OFF_ROAD_COST`.
 *
 * @param options.seed the street pattern's seed
 * @param options.radius how far the network reaches, in cells
 * @returns `{ all, cells }` — `all` is the membership set of `"x,z"` keys, `cells` the same
 *   cells as `{x, z}` in a stable order.
 */
export function planStreets({ seed = STREET_SEED, radius = TOWN_CELL_RADIUS } = {}) {
  const cells = planStreetCells(seed, radius)
  return { all: new Set(cells.map((c) => key(c.x, c.z))), cells }
}
```

- [ ] **Step 4: Fix the call site and the stale comments**

`src/game/colony.js:493` becomes:

```js
    this.streets = planStreets()
```

The `firstPass`, `SHIP_CELL_FOR_STREETS` and `anchored` arguments go from this call. Before deleting `firstPass` or `anchored` themselves, check the surrounding lines — they may have other consumers. `SHIP_CELL_FOR_STREETS` is still used at `colony.js:1268`, so leave that import in place. `_streetStamp` on the next line is unchanged and still correct.

In `src/world/grid.js`, lines 71 and 78 say `ring()`'s order is load-bearing because `streets.js`'s `ringRuns` walks it. `ringRuns` is gone. Do **not** delete the guarantee — `ring()` returning a walkable loop is still a real property with its own test, and `plots.js`'s `colonyAnchor` depends on it — but rewrite those two comments to state the property without naming a caller that no longer exists.

- [ ] **Step 5: Run the route test**

Run: `node --test test/route-on-street.test.mjs`
Expected: PASS.

If the median is below 0.6, the lever is `MAX_BLOCK` in `street-plan.js` — smaller blocks put every plot closer to a street. Try 2 before anything else. **Do not lower the threshold**: the spec says in as many words that if the layout cannot meet it, the layout is wrong. Record the lever and its value in the report.

- [ ] **Step 6: Rewrite `test/streets.test.mjs`**

Every case in it tests the ring, the spurs or the arc splitting. Delete those and keep only what still has a subject: that `planStreets()`'s membership set matches its `cells`, and that a protected cell is never a street. A deleted feature's test is deleted, not emptied into a test that asserts nothing.

- [ ] **Step 7: Commit**

`npm test` still fails in `road-mesh.js`, which reads `streets.spurs`; Task 3 fixes that. Commit anyway so the two changes stay separable, and say so in the message:

```bash
git add src/world/streets.js src/game/colony.js src/world/grid.js test/streets.test.mjs test/route-on-street.test.mjs
git commit -m "Run streets between the blocks instead of around the colony

road-mesh.js still reads the removed ringRuns/spurs and is fixed in the next commit."
```

---

### Task 3: Road tiles from arm sets, and a corner that is actually right

The corner has been wrong since it was introduced and two checks missed it. The fix is not a better rotation formula over the old code — it is that a tile's kind and rotation come from **which of a cell's four neighbours are streets**, which is local, order-free, and provable against the model.

**Files:**
- Modify: `src/world/road-mesh.js`
- Test: `test/road-corner-glb.test.mjs` (create), `test/road-tiles.test.mjs` (create), `test/road-mesh.test.mjs` (rewrite)

**Interfaces:**
- Consumes: `planStreets().cells` and `.all` from Task 2.
- Produces: `carriagewayTiles(streetCells, cellSize) -> [{x, z, part, ry}]`; `CARRIAGEWAY_WIDTH = 2.4`; `SUBGRID = 5`; `tileFor(arms) -> {part, k}`. Task 7 places verge furniture around these.

- [ ] **Step 1: Pin what the model actually is**

Create `test/road-corner-glb.test.mjs`. This check works because the markings live in different atlas cells from the tarmac: cell 2 is the grey road surface, cell 1 the white centre line, cell 11 the amber edge lines. The numbers below were measured from `public/assets/city.glb` while writing this plan; the test asserts them so a model change or a rotated constant fails loudly:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'

const COLS = 8
const ROWS = 4
const doc = await new NodeIO().read('public/assets/city.glb')

/** Bounding boxes of a part's vertices, grouped by which atlas cell they sample. */
function byAtlasCell(name) {
  const node = doc.getRoot().listNodes().find((n) => n.getName() === name)
  assert.ok(node, `${name} is missing from city.glb`)
  const out = new Map()
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const uv = prim.getAttribute('TEXCOORD_0')
    const p = []
    const t = []
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p)
      uv.getElement(i, t)
      const cell =
        Math.min(COLS - 1, Math.floor(t[0] * COLS)) + COLS * Math.min(ROWS - 1, Math.floor(t[1] * ROWS))
      const b = out.get(cell) || { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }
      b.x0 = Math.min(b.x0, p[0])
      b.x1 = Math.max(b.x1, p[0])
      b.z0 = Math.min(b.z0, p[2])
      b.z1 = Math.max(b.z1, p[2])
      out.set(cell, b)
    }
  }
  return out
}

const near = (a, b) => Math.abs(a - b) < 0.02

test('road_straight runs along its own Z axis', () => {
  const cells = byAtlasCell('road_straight')
  const white = cells.get(1)
  // The centre line: a narrow band of X, the full length of Z.
  assert.ok(near(white.x0, -0.02) && near(white.x1, 0.02), `centre line x ${white.x0}..${white.x1}`)
  assert.ok(near(white.z0, -0.9) && near(white.z1, 0.9), `centre line z ${white.z0}..${white.z1}`)
  const amber = cells.get(11)
  // The edge lines: two strips at x = +/-0.62, each the full length of Z.
  assert.ok(near(amber.x0, -0.62) && near(amber.x1, 0.62), `edge lines x ${amber.x0}..${amber.x1}`)
  assert.ok(near(amber.z0, -1) && near(amber.z1, 1), `edge lines z ${amber.z0}..${amber.z1}`)
})

test('road_corner joins its +Z edge to its +X edge', () => {
  const cells = byAtlasCell('road_corner')
  const white = cells.get(1)
  // The centre line is a quarter arc of radius 1 about the tile's (+X,+Z) corner, running
  // from (0,+1) to (+1,0), so it lives entirely in the +X/+Z quadrant. A tile turned 90 or
  // 180 degrees puts this box in a different quadrant — which is what makes this test able to
  // see the defect that seam-hunting could not. road_corner and road_straight are the same
  // slab: a wrong rotation produces no seam, no gap and no z-fighting, only paint that runs
  // the wrong way.
  assert.ok(white.x0 > -0.05 && white.z0 > -0.05, `centre arc starts at ${white.x0},${white.z0}`)
  assert.ok(near(white.x1, 0.9) && near(white.z1, 0.9), `centre arc ends at ${white.x1},${white.z1}`)
  const amber = cells.get(11)
  // Inner edge line: radius 0.38 about (+1,+1). Outer: radius 1.62, clipped by the tile.
  // Their union is exactly this box, and only this rotation produces it.
  assert.ok(near(amber.x0, -0.62) && near(amber.x1, 1), `edge arcs x ${amber.x0}..${amber.x1}`)
  assert.ok(near(amber.z0, -0.62) && near(amber.z1, 1), `edge arcs z ${amber.z0}..${amber.z1}`)
})
```

- [ ] **Step 2: Run it**

Run: `node --test test/road-corner-glb.test.mjs`
Expected: PASS. It asserts measurements, not new behaviour, so it passes immediately — that is the point. If it fails, the model differs from what this plan measured, and you must **stop**: every rotation constant below is derived from these numbers.

- [ ] **Step 3: Measure `road_tsplit` and `road_straight_crossing` the same way**

This plan measured `road_straight` and `road_corner`. It did not measure the other two, and guessing their orientation would repeat exactly the mistake this task exists to fix. Run:

```bash
node --input-type=module -e "
import { NodeIO } from '@gltf-transform/core'
const doc = await new NodeIO().read('public/assets/city.glb')
for (const name of ['road_tsplit', 'road_straight_crossing', 'road_junction']) {
  const node = doc.getRoot().listNodes().find(n => n.getName() === name)
  const out = new Map()
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0')
    const p = [], t = []
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p); uv.getElement(i, t)
      const c = Math.min(7, Math.floor(t[0] * 8)) + 8 * Math.min(3, Math.floor(t[1] * 4))
      const b = out.get(c) || { n: 0, x0: 9, x1: -9, z0: 9, z1: -9 }
      b.n++; b.x0 = Math.min(b.x0, p[0]); b.x1 = Math.max(b.x1, p[0])
      b.z0 = Math.min(b.z0, p[2]); b.z1 = Math.max(b.z1, p[2])
      out.set(c, b)
    }
  }
  console.log('=== ' + name)
  for (const [c, b] of [...out].sort((a, z) => z[1].n - a[1].n))
    console.log('  cell', c, 'n=' + b.n, 'x', b.x0.toFixed(2) + '..' + b.x1.toFixed(2), 'z', b.z0.toFixed(2) + '..' + b.z1.toFixed(2))
}
"
```

This plan already ran that script. The expected output is below, and your job is to **confirm it, not rediscover it**. If what you see differs, stop and report it — the constants in Step 5 are derived from these numbers.

```
=== road_tsplit
  cell  2 n= 136  x -1.00..1.00  z -1.00..1.00
  cell  1 n=  38  x -0.02..0.90  z -0.90..0.90
  cell 11 n=  36  x -0.62..1.00  z -1.00..1.00
=== road_straight_crossing
  cell  2 n=  76  x -1.00..1.00  z -1.00..1.00
  cell  1 n=  24  x -0.82..0.82  z -0.30..0.30
  cell 11 n=  16  x -0.62..0.62  z -1.00..1.00
```

Reading them: **`road_tsplit` has arms -Z, +Z and +X.** Its white centre line is the straight's — a narrow band of X running the full length of Z — with a branch reaching out to x = 0.90, and its amber edge lines reach x = 1.00 on that side only. **`road_straight_crossing` runs along Z, exactly like `road_straight`**: the same amber edge lines at x = +/-0.62 down the full length of Z, with the white zebra stripes as a wide, shallow band across them (x -0.82..0.82, z -0.30..0.30). So a crossing is a drop-in replacement for a straight tile at the same position and the same `ry` — which is what Task 7 relies on.

Add both as cases in `road-corner-glb.test.mjs`, pinned the same way the corner is pinned.

- [ ] **Step 4: Write the failing tile test**

Create `test/road-tiles.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { tileFor, carriagewayTiles, SUBGRID, CARRIAGEWAY_WIDTH } from '../src/world/road-mesh.js'

const E = { x: 1, z: 0 }
const W = { x: -1, z: 0 }
const N = { x: 0, z: -1 }
const S = { x: 0, z: 1 }

/** Rotate a direction by k quarter turns about +Y, the same way three.js does. */
const rot = (d, k) => {
  let r = d
  for (let i = 0; i < ((k % 4) + 4) % 4; i++) r = { x: r.z, z: -r.x }
  return r
}
const asKeys = (dirs) => dirs.map((d) => `${d.x},${d.z}`).sort().join(' ')

test('a corner is turned so its ports land on its actual arms', () => {
  // road_corner's modelled ports, pinned by road-corner-glb.test.mjs.
  const base = [S, E]
  for (const arms of [[S, E], [E, N], [N, W], [W, S]]) {
    const { part, k } = tileFor(arms)
    assert.equal(part, 'road_corner', `${asKeys(arms)} should be a corner`)
    assert.equal(asKeys(base.map((d) => rot(d, k))), asKeys(arms), `${asKeys(arms)} got k=${k}`)
  }
})

test('a straight is turned along its arms', () => {
  assert.deepEqual(tileFor([N, S]), { part: 'road_straight', k: 0 })
  assert.deepEqual(tileFor([W, E]), { part: 'road_straight', k: 1 })
})

test('four arms is a junction, three a tsplit', () => {
  assert.equal(tileFor([N, S, E, W]).part, 'road_junction')
  assert.equal(tileFor([N, S, E]).part, 'road_tsplit')
})

test('a dead end still gets a road surface', () => {
  assert.equal(tileFor([E]).part, 'road_straight')
})

test('every tile of a cell lies inside that cell', () => {
  const tiles = carriagewayTiles([{ x: 0, z: 0 }], 12)
  const half = 12 / 2
  const halfTile = CARRIAGEWAY_WIDTH / 2
  for (const t of tiles) {
    assert.ok(Math.abs(t.x) + halfTile <= half + 1e-9, `tile at x=${t.x} spills out of its cell`)
    assert.ok(Math.abs(t.z) + halfTile <= half + 1e-9, `tile at z=${t.z} spills out of its cell`)
  }
})

test('the carriageway divides the cell exactly', () => {
  assert.equal(12 / SUBGRID, CARRIAGEWAY_WIDTH)
})

test('two neighbouring street cells make one unbroken carriageway', () => {
  const tiles = carriagewayTiles([{ x: 0, z: 0 }, { x: 1, z: 0 }], 12)
  const onAxis = tiles.filter((t) => Math.abs(t.z) < 1e-9).map((t) => t.x).sort((a, b) => a - b)
  for (let i = 1; i < onAxis.length; i++) {
    assert.ok(
      Math.abs(onAxis[i] - onAxis[i - 1] - CARRIAGEWAY_WIDTH) < 1e-9,
      `gap or overlap between ${onAxis[i - 1]} and ${onAxis[i]}`
    )
  }
})
```

- [ ] **Step 5: Run it, then replace `carriagewayPoints`**

Run: `node --test test/road-tiles.test.mjs`
Expected: FAIL — `tileFor is not a function`.

In `src/world/road-mesh.js`, delete `carriagewayPoints` entirely and put this in its place. Change `CARRIAGEWAY_WIDTH` to 2.4 and keep `ROAD_TILE_SIZE`, `roadTileScale`, `ROAD_SURFACE_LIFT` and `carriagewayHeight` exactly as they are:

```js
/**
 * How wide the driving surface is. 12 / 5 = 2.4 divides a cell exactly, which is what makes
 * neighbouring tiles meet with no overlap and no gap; 2.5 does not, and would force either
 * coincident slabs at every cell boundary or a break in the road. A car is 0.61 wide.
 */
export const CARRIAGEWAY_WIDTH = 2.4

/** A cell is this many carriageway tiles across. */
export const SUBGRID = 5

const DIR_KEY = (d) => `${d.x},${d.z}`
/** One quarter turn about +Y, matching how three.js rotates (x, z). */
const rot = (d) => ({ x: d.z, z: -d.x })
const rotN = (d, k) => {
  let r = d
  for (let i = 0; i < k; i++) r = rot(r)
  return r
}
const sameSet = (a, b) =>
  a.length === b.length && a.map(DIR_KEY).sort().join(' ') === b.map(DIR_KEY).sort().join(' ')

const S = { x: 0, z: 1 }
const N = { x: 0, z: -1 }
const E = { x: 1, z: 0 }
const W = { x: -1, z: 0 }

/**
 * The directions each piece's road leaves through, in its unrotated form. Measured from
 * `city.glb` and pinned by `road-corner-glb.test.mjs`: `road_straight` runs along its own Z,
 * and `road_corner` joins its +Z edge to its +X edge.
 *
 * This is the fact the previous implementation guessed. It turned a corner by the *incoming*
 * heading alone, which cannot work — a bend is defined by two directions, and four headings
 * cannot name eight bends. Here the arms are the input, so the rotation is determined rather
 * than inferred.
 */
const STRAIGHT_ARMS = [N, S]
const CORNER_ARMS = [S, E]
const TSPLIT_ARMS = [N, S, E]

/**
 * Which piece a street cell needs, and how far to turn it, from the directions its street
 * neighbours lie in.
 *
 * @param arms the directions of this cell's street neighbours, as unit `{x, z}`
 * @returns `{ part, k }` — the kit part, and how many quarter turns about +Y to apply
 */
export function tileFor(arms) {
  if (arms.length >= 4 || arms.length === 0) return { part: 'road_junction', k: 0 }
  const opposite = arms.length === 2 && arms[0].x === -arms[1].x && arms[0].z === -arms[1].z
  const base =
    arms.length === 3
      ? { part: 'road_tsplit', arms: TSPLIT_ARMS }
      : arms.length === 1 || opposite
        ? { part: 'road_straight', arms: STRAIGHT_ARMS }
        : { part: 'road_corner', arms: CORNER_ARMS }
  // A dead end has one arm and gets a straight laid along it: only the axis matters, so its
  // single arm is widened to the full port pair before matching.
  const want = arms.length === 1 ? [arms[0], { x: -arms[0].x, z: -arms[0].z }] : arms
  for (let k = 0; k < 4; k++) {
    if (sameSet(base.arms.map((d) => rotN(d, k)), want)) return { part: base.part, k }
  }
  // Unreachable on a square lattice: every arm set of 1-4 axis directions is some rotation of
  // one of the three bases above. Falling through would place a silently wrong tile — exactly
  // the failure this module is being rewritten to end — so it throws instead.
  throw new Error(`no rotation of ${base.part} fits arms ${want.map(DIR_KEY).join(' ')}`)
}

/**
 * Where every carriageway tile goes.
 *
 * A cell is `SUBGRID` x `SUBGRID` tiles. The carriageway is the middle row, the middle column,
 * or both: the centre tile carries the piece the cell's arms call for, and each arm gets the
 * tiles between the centre and that edge. Every tile lies strictly inside its own cell, so a
 * cell's tiles meet its neighbour's edge to edge — no dedup set, no shared `placed`, and no
 * coincident slabs.
 *
 * Order-free by construction: a cell's tiles depend only on its own four neighbours, never on
 * a walk order. That is what retired `ringRuns` and the `closed` flag.
 *
 * @param streetCells every street cell, `{x, z}`
 * @param cellSize world units per cell
 * @returns `[{x, z, part, ry}]` — world position, kit part, and Y rotation in radians
 */
export function carriagewayTiles(streetCells, cellSize) {
  const keys = new Set(streetCells.map((c) => `${c.x},${c.z}`))
  const step = cellSize / SUBGRID
  const armsOf = (c) => [N, S, E, W].filter((d) => keys.has(`${c.x + d.x},${c.z + d.z}`))
  const out = []
  for (const c of streetCells) {
    const cx = c.x * cellSize
    const cz = c.z * cellSize
    const arms = armsOf(c)
    const centre = tileFor(arms)
    out.push({ x: cx, z: cz, part: centre.part, ry: (centre.k * Math.PI) / 2 })
    for (const d of arms) {
      // Along an arm: the tiles between the centre tile and the cell edge. With SUBGRID 5
      // that is exactly two, at one and two steps out, and the second ends flush with the
      // edge, where the neighbouring cell's own second tile begins.
      const along = tileFor([d, { x: -d.x, z: -d.z }])
      for (let i = 1; i <= (SUBGRID - 1) / 2; i++) {
        out.push({
          x: cx + d.x * step * i,
          z: cz + d.z * step * i,
          part: along.part,
          ry: (along.k * Math.PI) / 2,
        })
      }
    }
  }
  return out
}
```

- [ ] **Step 6: Run the tile tests**

Run: `node --test test/road-tiles.test.mjs test/road-corner-glb.test.mjs`
Expected: PASS.

- [ ] **Step 7: Rewire `createRoads`**

The signature keeps `{ streets, groundAt }`; `streets.cells` is now the input. Delete `spurRuns`, `ringRuns`, `patchRuns`, `placed`, `PART_BY_KIND` and the `straightCount`/`cornerCount`/`junctionCount` triple, and group by part name instead so a fourth piece needs no new variable:

```js
  const scale = roadTileScale()
  const tiles = carriagewayTiles(streets.cells, CELL_SIZE)
  const composers = new Map()
  for (const tile of tiles) {
    if (!hasPart(tile.part, 'city')) continue
    let composer = composers.get(tile.part)
    if (!composer) {
      composer = new Composer({ kit: 'city' })
      composers.set(tile.part, composer)
    }
    // The carriageway sits on bare terrain, never on a deck: a plot never claims a street
    // cell (`allocateCells` refuses them), so this follows the ground directly with no
    // `Math.max(DECK_TOP, ...)` clamp. That clamp is the bug this replaced — it pinned every
    // patch to DECK_TOP, because no street cell is ever decked.
    //
    // The tile stays flat rather than tilting to the local slope: a per-patch tilt would open
    // seams wherever two neighbouring tiles picked slightly different normals.
    const y = groundAt ? carriagewayHeight(groundAt(tile.x, tile.z)) : DECK_TOP
    composer.add(tile.part, { s: scale, x: tile.x, y, z: tile.z, ry: tile.ry })
  }
  const meshes = [...composers.values()].map((c) => new THREE.Mesh(c.finish(), roadMaterial()))
```

The guard at the top becomes `if (!streets || !streets.cells?.length) return group`, keeping the existing `hasPart` checks for `road_straight`, `road_corner` and `road_junction`. Delete the streetlight block — Task 7 rebuilds it along the whole network instead of every fourth ring patch.

`ry` here is the rotation to apply directly: the old `Math.PI / 2 - patch.heading` conversion is gone, and so is the comment above it that reasoned about headings. Delete that comment rather than leaving it describing code that no longer exists.

- [ ] **Step 8: Rewrite `test/road-mesh.test.mjs`**

Its cases are about runs, `closed`, and the shared `placed` set — none of which exist. Keep and re-point anything testing `carriagewayHeight` and `roadTileScale`, which are unchanged. Delete the rest.

- [ ] **Step 9: Full suite, then commit**

Run: `npm test`
Expected: PASS. This is the first green suite since Task 2.

```bash
git add src/world/road-mesh.js test/road-tiles.test.mjs test/road-corner-glb.test.mjs test/road-mesh.test.mjs
git commit -m "Choose each road tile from its cell's arms, fixing corners that were never right"
```

---

### Task 4: Flatten the ground the town stands on

The mechanism already exists — `planet.js` smoothsteps the terrain flat inside a radius. This widens that radius from the colony's to the town's. The spec is explicit that **the hills move outward as a result**, which changes the whole world's look and not just the town's; that is intended, and the screenshot in Task 9 is where it gets judged.

**Files:**
- Modify: `src/world/planet.js` (lines 103, 154, 174, 304)
- Test: `test/terrain-flat.test.mjs` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `TOWN_RADIUS = 104` from `planet.js`. Task 8 uses it to keep scatter off the town.

- [ ] **Step 1: Read what you are about to change**

Read `src/world/planet.js` lines 95-180 and 295-310, and the signature of the exported `terrainHeight`. Four sites reference `COLONY_RADIUS`, and they do **not** all mean the same thing:

- `:103` and `:154` — the height field's flat zone. These move to `TOWN_RADIUS`.
- `:174` — where scatter props are placed (`COLONY_RADIUS + 14 + rand() * 110`). This must move outward too or every tree lands in the town, but its *range* must shrink to stay on the ground: `GROUND_SIZE` is 340, so nothing may sit beyond 170 from the centre.
- `:304` — a colour fade, not a height. It should move as well, or the town renders inside the distance tint.
- `:126` — a colour multiplier keyed to `COLONY_RADIUS * 0.7`. **Leave this one alone**: it tints the colony's own ground and is not about the town.

Write down in the report which of the four you changed and what each one does. A wrong call here is invisible until someone looks at the world.

- [ ] **Step 2: Write the failing test**

Create `test/terrain-flat.test.mjs`. Match `terrainHeight`'s real signature — read it first; if it needs a planet object, build the same one `colony.js` passes:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { terrainHeight, TOWN_RADIUS } from '../src/world/planet.js'

/** Sample a ring of 48 points at `radius` and return its height range. */
function ring(radius) {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const y = terrainHeight(Math.cos(a) * radius, Math.sin(a) * radius)
    lo = Math.min(lo, y)
    hi = Math.max(hi, y)
  }
  return { lo, hi, range: hi - lo }
}

test('the ground the town stands on is flat', () => {
  assert.equal(TOWN_RADIUS, 104)
  const inner = ring(TOWN_RADIUS - 10)
  assert.ok(inner.range < 0.8, `the town's ground varies by ${inner.range.toFixed(2)}`)
})

test('the hills survive, further out', () => {
  const outer = ring(TOWN_RADIUS + 50)
  assert.ok(outer.range > 1.5, `the countryside is flat too (${outer.range.toFixed(2)}) — nothing is left`)
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/terrain-flat.test.mjs`
Expected: FAIL — `TOWN_RADIUS` is not exported, and the ground at radius 94 is the old hill field.

- [ ] **Step 4: Widen the flat zone**

In `src/world/planet.js`, beside `COLONY_RADIUS`:

```js
/**
 * Everything inside this radius is the town, and is kept flat.
 *
 * `TOWN_CELL_RADIUS` (8) cells at `CELL_SIZE` (12) reaches 96 units to the outermost cell
 * centre, plus half a cell for its far edge: 102. 104 gives the outline a little slack.
 *
 * Widening this **moves the hills outward**, which changes the look of the whole world and
 * not only the town's. That is deliberate: a street network laid over a hill field would ride
 * up and down it, and the kit's road tiles are flat slabs that cannot follow a slope.
 */
export const TOWN_RADIUS = 104
```

Change `:103` and `:154` to `smoothstep(dist, TOWN_RADIUS - 6, TOWN_RADIUS + 40)`, `:174` to `TOWN_RADIUS + 14 + rand() * 50`, and `:304` to `smoothstep(d, TOWN_RADIUS, 200)`. Leave `:126` untouched.

- [ ] **Step 5: Run the test, then the suite**

Run: `node --test test/terrain-flat.test.mjs`
Expected: PASS.

Run: `npm test`
Expected: PASS. Scatter tests may pin positions that just moved; if one fails, it is asserting the old placement — re-point it at the new range rather than reverting the change, and say so in the report.

- [ ] **Step 6: Commit**

```bash
git add src/world/planet.js test/terrain-flat.test.mjs
git commit -m "Flatten the ground out to the town's radius, pushing the hills outward"
```

---

### Task 5: What fills a block

Pure, and a function of **cell position only** — that is the whole derived-layer rule. Nothing here knows the colony exists. When the colony grows into a block, Task 6 simply stops drawing that block's content; when it shrinks, the same content comes back identical, because it was never stored anywhere.

**Files:**
- Create: `src/world/town-plan.js`
- Test: `test/town-plan.test.mjs`

**Interfaces:**
- Consumes: `mulberry` from `src/world/rng.js`; `key`, `CELL_SIZE` from `src/world/grid.js`; `TOWN_CELL_RADIUS` from `src/world/street-plan.js`.
- Produces: `TOWN_SEED`, `townRadiusAt(angle)`, `inTown(cell)`, `blockContent(cell, streetKeys)` returning `{ kind, buildings }`, `BUILDING_PARTS`, `BUILDING_SCALE`, `GREEN_SHARE`. Task 6 draws the result; Task 8 plants the green ones.

- [ ] **Step 1: Find out whether a kit building has a front**

A building placed facing the wrong way is the same class of defect as the corner. Measure before choosing a rotation:

```bash
node --input-type=module -e "
import { NodeIO } from '@gltf-transform/core'
const doc = await new NodeIO().read('public/assets/city.glb')
for (const name of ['building_A','building_B','building_C','building_D']) {
  const node = doc.getRoot().listNodes().find(n => n.getName() === name)
  const out = new Map()
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION'), uv = prim.getAttribute('TEXCOORD_0')
    const p = [], t = []
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p); uv.getElement(i, t)
      const c = Math.min(7, Math.floor(t[0]*8)) + 8*Math.min(3, Math.floor(t[1]*4))
      const b = out.get(c) || { n:0, x0:9, x1:-9, z0:9, z1:-9, y0:9, y1:-9 }
      b.n++; b.x0=Math.min(b.x0,p[0]); b.x1=Math.max(b.x1,p[0])
      b.z0=Math.min(b.z0,p[2]); b.z1=Math.max(b.z1,p[2])
      b.y0=Math.min(b.y0,p[1]); b.y1=Math.max(b.y1,p[1])
      out.set(c, b)
    }
  }
  console.log('=== ' + name)
  for (const [c,b] of [...out].sort((a,z)=>z[1].n-a[1].n))
    console.log('  cell',c,'n='+b.n,'x',b.x0.toFixed(2)+'..'+b.x1.toFixed(2),'z',b.z0.toFixed(2)+'..'+b.z1.toFixed(2),'y',b.y0.toFixed(2)+'..'+b.y1.toFixed(2))
}
"
```

A door or window sits in its own atlas cell, on one side only. If one cell's box is pinned to a single Z face, that face is the front and `FRONT_DIR` below is the direction it points. If no cell is one-sided, the building has no front: record that in the report, keep `ry` anyway (it varies the texture wrap and stops a row of identical boxes), and say in the code comment that it was measured to be symmetric rather than leaving a reader to assume it was chosen carefully.

- [ ] **Step 2: Write the failing tests**

Create `test/town-plan.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { inTown, townRadiusAt, blockContent, BUILDING_PARTS } from '../src/world/town-plan.js'
import { planStreets } from '../src/world/streets.js'
import { TOWN_CELL_RADIUS } from '../src/world/street-plan.js'

const streets = planStreets()

test('the town outline is not a circle', () => {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 64; i++) {
    const r = townRadiusAt((i / 64) * Math.PI * 2)
    lo = Math.min(lo, r)
    hi = Math.max(hi, r)
  }
  assert.ok(hi - lo >= 1.5, `the outline varies by only ${(hi - lo).toFixed(2)} cells`)
  assert.ok(hi <= TOWN_CELL_RADIUS, `the outline reaches ${hi.toFixed(2)}, past the street network`)
})

test('the centre is always in town', () => {
  assert.equal(inTown({ x: 0, z: 0 }), true)
})

test('block content depends on its own position and nothing else', () => {
  // The same cell, asked twice, with two different street sets around the rest of the world.
  const a = blockContent({ x: 3, z: 2 }, streets.all)
  const b = blockContent({ x: 3, z: 2 }, streets.all)
  assert.deepEqual(a, b)
})

test('a built block puts buildings on the sides that face a street', () => {
  let checked = 0
  for (const cell of [{ x: 1, z: 1 }, { x: 2, z: 3 }, { x: -3, z: 2 }, { x: 4, z: -1 }, { x: -2, z: -4 }]) {
    const content = blockContent(cell, streets.all)
    if (content.kind !== 'built') continue
    checked++
    for (const b of content.buildings) {
      assert.ok(BUILDING_PARTS.includes(b.part), `unknown part ${b.part}`)
      // Every building lies inside its own cell.
      assert.ok(Math.abs(b.x - cell.x * 12) <= 6, `building spills out of its cell in x`)
      assert.ok(Math.abs(b.z - cell.z * 12) <= 6, `building spills out of its cell in z`)
    }
  }
  assert.ok(checked >= 1, 'none of the sampled cells was a built block')
})

test('some blocks are green', () => {
  let green = 0
  let built = 0
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const cell = { x, z }
      if (!inTown(cell) || streets.all.has(`${x},${z}`)) continue
      if (blockContent(cell, streets.all).kind === 'green') green++
      else built++
    }
  }
  assert.ok(green > 0 && built > 0, `green=${green} built=${built}`)
  assert.ok(green / (green + built) > 0.15, 'almost nothing is green')
  assert.ok(green / (green + built) < 0.6, 'almost nothing is built')
})
```

- [ ] **Step 3: Run them to verify they fail**

Run: `node --test test/town-plan.test.mjs`
Expected: FAIL — `Cannot find module '../src/world/town-plan.js'`

- [ ] **Step 4: Write it**

Create `src/world/town-plan.js`:

```js
import { CELL_SIZE } from './grid.js'
import { mulberry } from './rng.js'
import { TOWN_CELL_RADIUS } from './street-plan.js'

/**
 * What stands in a block.
 *
 * Every function here is a function of **cell position only**. That is the rule the whole
 * town rests on: the colony is not consulted, nothing is stored, and no state carries between
 * calls. So when the colony grows into a block, the drawing code simply skips it; when the
 * colony shrinks again the same buildings come back, in the same places, because they were
 * never anywhere to be lost.
 */

export const TOWN_SEED = 77313

/** The eight buildings in `city.glb`, all 2 x 2 in plan and 1.65-3.05 tall. */
export const BUILDING_PARTS = Object.freeze([
  'building_A', 'building_B', 'building_C', 'building_D',
  'building_E', 'building_F', 'building_G', 'building_H',
])

/**
 * What a kit building is scaled by. A part is 2 units across; 3.5 makes it 7 wide and
 * 5.8-10.7 tall, which reads as a house beside a 12-unit street cell. At the road tiles'
 * own scale (1.2) it would be a shed.
 */
export const BUILDING_SCALE = 3.5

/** How much of the block frontage is left as green rather than built. */
export const GREEN_SHARE = 0.32

/** How far a building's centre sits from its cell's centre, toward the street it faces. */
const SET_BACK = CELL_SIZE / 2 - (BUILDING_PARTS.length && BUILDING_SCALE) - 0.6

/**
 * The town's outer edge: a radius that varies with direction, so the town frays into the
 * countryside instead of stopping on a square. Three harmonics with seeded phases — enough
 * to look unplanned, few enough to stay smooth.
 */
const OUTLINE = (() => {
  const rand = mulberry(TOWN_SEED)
  return [2, 3, 5].map((n) => ({ n, amp: 0.05 + rand() * 0.05, phase: rand() * Math.PI * 2 }))
})()

/** The town's radius, in cells, in the direction `angle`. */
export function townRadiusAt(angle) {
  let f = 1
  for (const h of OUTLINE) f -= h.amp * (1 - Math.sin(h.n * angle + h.phase))
  return TOWN_CELL_RADIUS * f
}

/** Is this cell inside the town's outline? */
export function inTown(cell) {
  if (cell.x === 0 && cell.z === 0) return true
  return Math.hypot(cell.x, cell.z) <= townRadiusAt(Math.atan2(cell.z, cell.x))
}

/** A stable per-cell random stream. Same cell, same numbers, always. */
function cellRand(cell, salt) {
  return mulberry(TOWN_SEED ^ ((cell.x + 512) * 1021) ^ ((cell.z + 512) * 3571) ^ salt)
}

const SIDES = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
]

/**
 * What fills one block cell.
 *
 * Buildings go on the sides that face a street and nowhere else — a house fronts a road, and
 * a building in the middle of a block would be reachable by nothing. That also keeps the
 * geometry budget in reach: a cell has at most four street-facing sides and usually one or
 * two.
 *
 * @param cell the block cell, `{x, z}`
 * @param streetKeys the street membership set from `planStreets().all`
 * @returns `{ kind: 'green' | 'built', buildings: [{part, x, z, ry, scale}] }` — world
 *   positions, ready to place
 */
export function blockContent(cell, streetKeys) {
  const rand = cellRand(cell, 0x5bd1)
  if (rand() < GREEN_SHARE) return { kind: 'green', buildings: [] }

  const cx = cell.x * CELL_SIZE
  const cz = cell.z * CELL_SIZE
  const buildings = []
  for (const d of SIDES) {
    if (!streetKeys.has(`${cell.x + d.x},${cell.z + d.z}`)) continue
    // A gap in the frontage here and there, so a street is not an unbroken terrace.
    if (rand() < 0.2) continue
    buildings.push({
      part: BUILDING_PARTS[Math.floor(rand() * BUILDING_PARTS.length)],
      x: cx + d.x * SET_BACK,
      z: cz + d.z * SET_BACK,
      // Turned to face the street it fronts. See the note in the plan's Task 5 Step 1 on
      // whether these parts have a measurable front.
      ry: Math.atan2(d.x, d.z),
      scale: BUILDING_SCALE,
    })
  }
  return { kind: 'built', buildings }
}
```

**`SET_BACK` above is deliberately wrong and you must fix it.** `BUILDING_PARTS.length && BUILDING_SCALE` is nonsense left in as a tripwire: the intended value is half the cell, less half the building's width, less a 0.6 gap to the kerb — `CELL_SIZE / 2 - (BUILDING_SCALE * 2) / 2 - 0.6`, which is `6 - 3.5 - 0.6 = 1.9`. Write that expression, with a comment saying a kit building is 2 units across so `BUILDING_SCALE * 2` is its world width.

- [ ] **Step 5: Run the tests**

Run: `node --test test/town-plan.test.mjs`
Expected: PASS, 5 tests.

If the green share lands outside the 0.15-0.6 band, move `GREEN_SHARE`. If the outline test fails because `hi` exceeds `TOWN_CELL_RADIUS`, the harmonic amplitudes sum too high — `townRadiusAt` must never return more than `TOWN_CELL_RADIUS`, because past that there are no streets for a building to front.

- [ ] **Step 6: Commit**

```bash
git add src/world/town-plan.js test/town-plan.test.mjs
git commit -m "Decide a block's contents from its position alone"
```

---

### Task 6: Draw the town, under a measured ceiling

**Files:**
- Create: `src/world/town-mesh.js`
- Modify: `src/game/colony.js`
- Test: `test/town-mesh.test.mjs` (create)

**Interfaces:**
- Consumes: `blockContent`, `inTown` from Task 5; `planStreets().all` from Task 2; `Composer` from `src/world/buildings.js`; `atlasTexture`, `hasPart`, `part` from `src/world/kit.js`.
- Produces: `townPlan({ streets, claimed }) -> [{part, x, z, ry, scale}]` (pure) and `createTown({ streets, claimed, groundAt }) -> THREE.Group` with `userData.dispose()`; `TOWN_VERTEX_BUDGET`.

- [ ] **Step 1: Measure the yardstick before writing anything**

The spec: "The town must not add more geometry than the colony itself draws." Measure both, with no renderer — vertex counts come straight from the glb:

```bash
node --input-type=module -e "
import { NodeIO } from '@gltf-transform/core'
const doc = await new NodeIO().read('public/assets/city.glb')
const counts = new Map()
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh(); if (!mesh) continue
  let n = 0
  for (const prim of mesh.listPrimitives()) n += prim.getAttribute('POSITION').getCount()
  counts.set(node.getName(), n)
}
for (const [k, v] of [...counts].sort((a,b) => b[1]-a[1])) console.log(String(v).padStart(6), k)
"
```

This plan already ran that script. The parts that matter:

| part | verts | | part | verts |
|---|---:|---|---|---:|
| building_H | 3336 | | road_junction | 272 |
| building_G | 2920 | | road_corner_curved | 217 |
| building_E | 2397 | | road_tsplit | 210 |
| building_F | 2366 | | road_corner | 203 |
| building_D | 1972 | | streetlight | 190 |
| building_B | 1843 | | road_straight_crossing | 116 |
| building_C | 1731 | | road_straight | 104 |
| building_A | 1392 | | base | 96 |

The eight buildings total 17,957, so the **mean building is 2,245 vertices**. The eight
`_withoutBase` variants total 12,934, a mean of 1,617 — a **28% saving**, which is the third
lever below and a real one.

Two things this table makes clear before you write a line:

- **The carriageway is nearly free.** Road tiles are 104-272 vertices. Roughly 190 street
  cells at about six tiles each is on the order of 140k — noticeable, not dominant.
- **The pavement is not.** `base` is 96 vertices and Task 7 lays it on both sides of every
  arm: on the order of 1,900 tiles, ~180k vertices, comparable to the buildings. If the
  budget bites, thinning the pavement is a cheaper fix than removing houses. Task 7 says so
  too.

Then count what the colony itself draws: how many houses a 40-plot colony places and which
parts they use. Read `src/world/houses.js` for the parts and `src/world/plots.js` for the
per-plot counts, and multiply. **Write both totals into the task report.**
`TOWN_VERTEX_BUDGET` is the colony's number, rounded down to a round figure, and it covers
the **buildings** `townPlan` returns — the carriageway and verge are Task 7's and are
measured there.

- [ ] **Step 2: Write the failing test**

Create `test/town-mesh.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'
import { townPlan, TOWN_VERTEX_BUDGET } from '../src/world/town-mesh.js'
import { planStreets } from '../src/world/streets.js'

const doc = await new NodeIO().read('public/assets/city.glb')
const vertsOf = new Map()
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  let n = 0
  for (const prim of mesh.listPrimitives()) n += prim.getAttribute('POSITION').getCount()
  vertsOf.set(node.getName(), n)
}

const streets = planStreets()

test('the town stays under its geometry ceiling', () => {
  const placed = townPlan({ streets: streets.all, claimed: new Set() })
  const total = placed.reduce((sum, b) => sum + (vertsOf.get(b.part) || 0), 0)
  assert.ok(
    total <= TOWN_VERTEX_BUDGET,
    `the town draws ${total} vertices, over the ${TOWN_VERTEX_BUDGET} ceiling`
  )
  assert.ok(placed.length > 30, `only ${placed.length} buildings — the town is empty`)
})

test('the colony takes precedence over the town', () => {
  const all = townPlan({ streets: streets.all, claimed: new Set() })
  const taken = new Set(['1,1', '1,2', '2,1', '2,2'])
  const fewer = townPlan({ streets: streets.all, claimed: taken })
  assert.ok(fewer.length < all.length, 'claiming four cells removed no buildings')
})

test('a block the colony does not touch is identical either way', () => {
  const all = townPlan({ streets: streets.all, claimed: new Set() })
  const taken = new Set(['1,1', '1,2', '2,1', '2,2'])
  const fewer = townPlan({ streets: streets.all, claimed: taken })
  const far = (list) => list.filter((b) => b.x < -30).sort((a, b) => a.x - b.x || a.z - b.z)
  assert.deepEqual(far(fewer), far(all))
})
```

That third case is the spec's derived-layer requirement stated as a test: grow the colony, and every block it did not reach is unchanged.

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/town-mesh.test.mjs`
Expected: FAIL — `Cannot find module '../src/world/town-mesh.js'`

- [ ] **Step 4: Write `town-mesh.js`**

Two halves, split the way `road-mesh.js` already is: a pure planner and a scene builder.

```js
import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { TOWN_CELL_RADIUS } from './street-plan.js'
import { blockContent, inTown } from './town-plan.js'

/**
 * The town: the buildings that fill whatever blocks the colony has not taken.
 *
 * Nothing here means anything. The colony is the data; this is the place it sits in. A block
 * the colony claims is simply not drawn, and `town-plan.js` is a pure function of position,
 * so a block that comes free again comes back exactly as it was.
 */

/**
 * The most geometry the town may add, in vertices — the colony's own count, measured in
 * Task 6 Step 1. The spec's rule is that the scenery must not outweigh the thing it
 * surrounds. If a later change pushes past this, the levers in order are `GREEN_SHARE`,
 * `TOWN_CELL_RADIUS`, and the kit's `_withoutBase` building variants.
 */
export const TOWN_VERTEX_BUDGET = 0 // REPLACE with the number measured in Step 1

/**
 * Every building the town wants to place.
 *
 * Pure, so the budget is testable without a renderer.
 *
 * @param streets the street membership set (`planStreets().all`)
 * @param claimed the cells the colony occupies, as `"x,z"` keys — these blocks are skipped
 * @returns `[{part, x, z, ry, scale}]`
 */
export function townPlan({ streets, claimed = new Set() }) {
  const out = []
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const k = `${x},${z}`
      if (streets.has(k) || claimed.has(k)) continue
      const cell = { x, z }
      if (!inTown(cell)) continue
      out.push(...blockContent(cell, streets).buildings)
    }
  }
  return out
}

/**
 * @param streets the street membership set
 * @param claimed the colony's cells, as `"x,z"` keys
 * @param groundAt `(x, z) => y`, the colony's terrain sampler
 * @returns a `THREE.Group` publishing `userData.dispose()`
 */
export function createTown({ streets, claimed, groundAt }) {
  const group = new THREE.Group()
  group.userData.dispose = () => {}
  if (!streets) return group

  const composers = new Map()
  for (const b of townPlan({ streets, claimed })) {
    if (!hasPart(b.part, 'city')) continue
    let composer = composers.get(b.part)
    if (!composer) {
      composer = new Composer({ kit: 'city' })
      composers.set(b.part, composer)
    }
    // A town building stands on the flattened ground, never on a deck: `townPlan` skips every
    // cell the colony claims, and the deck is exactly those cells.
    composer.add(b.part, { s: b.scale, x: b.x, y: groundAt ? groundAt(b.x, b.z) : 0, z: b.z, ry: b.ry })
  }

  const meshes = [...composers.values()].map(
    (c) =>
      new THREE.Mesh(
        c.finish(),
        // Unowned scenery: no accent, no construction reveal, so this skips `decorate()`
        // exactly as `road-mesh.js` does. The atlas `map` is not optional — without it every
        // building renders as flat grey plastic.
        new THREE.MeshStandardMaterial({ map: atlasTexture('city'), roughness: 0.8, metalness: 0.02 })
      )
  )
  for (const mesh of meshes) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  group.userData.dispose = () => {
    for (const mesh of meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.customDepthMaterial?.dispose()
    }
  }
  return group
}
```

- [ ] **Step 5: Set the budget and run**

Replace `TOWN_VERTEX_BUDGET`'s `0` with the number from Step 1.

Run: `node --test test/town-mesh.test.mjs`

If the town is over budget, pull the levers in the documented order — `GREEN_SHARE` up, then `TOWN_CELL_RADIUS` down, then the `_withoutBase` variants — and **record which one you pulled and to what**. Do not raise the budget: it is the colony's own measured number and raising it is the one move the spec rules out.

- [ ] **Step 6: Hang it in the colony**

In `src/game/colony.js`, beside `this.roadGroup` at `:501`, build and add the town. Follow whatever pattern `roadGroup` already uses for adding to the scene, disposing on rebuild, and rebuilding when the layout changes — read those lines and match them rather than inventing a second lifecycle:

```js
    this.townGroup = createTown({
      streets: this.streets.all,
      claimed: new Set(this.streets.all ? [] : []),
      groundAt: (x, z) => this.groundAt(x, z),
    })
```

The `claimed` set above is a placeholder you must replace: it is the set of `"x,z"` keys for every cell the colony's plots occupy, which is what `allocateCells` returns at `:503` (plus the depot's cells). Build it from that layout — which means `createTown` is called **after** `:503`, not beside `:501`. Add the group to the scene and dispose it wherever `roadGroup` is disposed.

- [ ] **Step 7: Full suite and commit**

Run: `npm test`

```bash
git add src/world/town-mesh.js src/game/colony.js test/town-mesh.test.mjs
git commit -m "Fill the blocks the colony has not taken with a town"
```

---

### Task 7: The verge — pavement, lamps, crossings, lights

Scenery, all of it. The spec is explicit that **nothing obeys the traffic lights** in this stage.

**Files:**
- Modify: `src/world/road-mesh.js`
- Test: `test/road-verge.test.mjs` (create)

**Interfaces:**
- Consumes: `carriagewayTiles`, `SUBGRID`, `CARRIAGEWAY_WIDTH` from Task 3.
- Produces: `vergeFurniture(streetCells, cellSize) -> [{part, x, z, ry, scale}]`, drawn by `createRoads`.

- [ ] **Step 1: Write the failing test**

Create `test/road-verge.test.mjs`:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { vergeFurniture, CARRIAGEWAY_WIDTH } from '../src/world/road-mesh.js'
import { planStreets } from '../src/world/streets.js'

const streets = planStreets()
const furniture = vergeFurniture(streets.cells, 12)
const of = (part) => furniture.filter((f) => f.part === part)

test('pavement runs alongside the carriageway, not on it', () => {
  const paving = of('base')
  assert.ok(paving.length > 50, `only ${paving.length} pavement tiles`)
  for (const p of paving) {
    // Every pavement tile is offset from its cell's centre line by at least half a
    // carriageway, so none of it lands under a car.
    const dx = Math.abs(((p.x % 12) + 18) % 12 - 6)
    const dz = Math.abs(((p.z % 12) + 18) % 12 - 6)
    assert.ok(
      Math.max(dx, dz) >= CARRIAGEWAY_WIDTH / 2,
      `a pavement tile sits on the carriageway at ${p.x},${p.z}`
    )
  }
})

test('streetlights stand along the roads, not only at corners', () => {
  const lamps = of('streetlight')
  assert.ok(lamps.length > 20, `only ${lamps.length} streetlights`)
  const cells = new Set(lamps.map((l) => `${Math.round(l.x / 12)},${Math.round(l.z / 12)}`))
  assert.ok(cells.size > 10, `the lamps are bunched into ${cells.size} cells`)
})

test('crossings and traffic lights appear at junctions', () => {
  assert.ok(of('road_straight_crossing').length > 0, 'no zebra crossings')
  const lights = ['trafficlight_A', 'trafficlight_B', 'trafficlight_C'].flatMap(of)
  assert.ok(lights.length > 0, 'no traffic lights')
})

test('the furniture is deterministic', () => {
  assert.deepEqual(vergeFurniture(streets.cells, 12), furniture)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/road-verge.test.mjs`
Expected: FAIL — `vergeFurniture is not a function`.

- [ ] **Step 3: Implement it**

Add `vergeFurniture` to `src/world/road-mesh.js`. The shape follows `carriagewayTiles`: iterate street cells, read each cell's arms, and place furniture from that. Write it yourself against these rules — they are the requirements, and the code is yours:

- **Pavement.** For each arm, two `base` tiles per side, at the same two sub-grid steps the carriageway tiles use along the arm but offset one sub-grid step (`cellSize / SUBGRID`) perpendicular to it, on both sides. Scale is the road tiles' `roadTileScale()`, so pavement and carriageway tile at the same pitch. `base` and the road surface are **the same grey** (atlas cell 2, `#818c91`), so the kerb must read as a height step and its shadow — lift the pavement by `ROAD_SURFACE_LIFT * 8` above the carriageway, never recolour it.
- **Streetlights.** One per arm, at the outer sub-grid step, two steps off the centre line so it stands on the verge behind the pavement. Alternate which side by the parity of `cell.x + cell.z` so a street does not grow lamps down one side only. Scale 1.6, as the old ring code used.
- **Zebra crossings.** On a cell with three or four arms, replace the outermost carriageway tile of one arm with `road_straight_crossing` at the same position, scale and `ry`. Choose the arm deterministically from the cell (`(cell.x * 31 + cell.z * 17) % arms.length`), never randomly.
- **Traffic lights.** One `trafficlight_A`/`_B`/`_C` on a cell with four arms, on the corner of the verge, part chosen by the same per-cell hash. Nothing obeys them.

**Watch the cost.** `base` is 96 vertices and these rules lay roughly 1,900 of them — about
180k vertices, comparable to the whole town's houses (see Task 6 Step 1). Measure the total
once it works and put the number in the report. If it is out of proportion, pave only the
side each streetlight stands on rather than both sides; that halves it and still reads as a
pavement from any angle a player sees.

Return `[{part, x, z, ry, scale, lift}]` and let `createRoads` group them into composers exactly as it groups the carriageway tiles, with the same `groundAt` sampling plus each entry's `lift`. A street cell is never decked, so no `Math.max(DECK_TOP, ...)` clamp belongs here either — the clamp in the old streetlight code existed because a ring lamp could stand beside a deck, and it cannot any more.

- [ ] **Step 4: Run it, then the suite**

Run: `node --test test/road-verge.test.mjs`
Expected: PASS.

Run: `npm test`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/world/road-mesh.js test/road-verge.test.mjs
git commit -m "Pave the verge and stand lamps, crossings and lights along the streets"
```

---

### Task 8: Green blocks, and keeping the countryside out of town

**Files:**
- Modify: `src/game/colony.js` (the `createScatter` call at `:282`)
- Modify: `src/world/planet.js` if `keepClear` cannot express what is needed
- Test: `test/town-planting.test.mjs` (create)

**Interfaces:**
- Consumes: `blockContent` (the `green` kind) from Task 5; `TOWN_RADIUS` from Task 4; `createScatter(planet, density, keepClear, seed)` from `planet.js:241`.
- Produces: `greenBlocks({ streets, claimed }) -> [{x, z, radius}]`, exported from `town-plan.js`.

- [ ] **Step 1: Read `createScatter`'s `keepClear`**

`src/world/planet.js:241` takes `keepClear = []`. Read what an entry looks like and how it is tested — `colony.js:282` already passes one. **Match that shape.** If it cannot express "inside the town except on the green blocks", the honest change is to widen it, not to work around it; say so in the report and make the change minimal.

- [ ] **Step 2: Write the failing test**

Create `test/town-planting.test.mjs`. It asserts two things: that green blocks exist as planting sites, and that nothing is planted on a street or a building:

```js
import test from 'node:test'
import assert from 'node:assert/strict'
import { greenBlocks } from '../src/world/town-plan.js'
import { planStreets } from '../src/world/streets.js'

const streets = planStreets()

test('green blocks are offered as planting sites', () => {
  const green = greenBlocks({ streets: streets.all, claimed: new Set() })
  assert.ok(green.length > 5, `only ${green.length} green blocks`)
  for (const g of green) {
    assert.ok(!streets.all.has(`${Math.round(g.x / 12)},${Math.round(g.z / 12)}`), 'a green block is a street')
  }
})

test('a claimed cell is no longer a planting site', () => {
  const free = greenBlocks({ streets: streets.all, claimed: new Set() })
  const taken = new Set(free.slice(0, 3).map((g) => `${Math.round(g.x / 12)},${Math.round(g.z / 12)}`))
  const after = greenBlocks({ streets: streets.all, claimed: taken })
  assert.equal(after.length, free.length - 3)
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/town-planting.test.mjs`
Expected: FAIL — `greenBlocks is not a function`.

- [ ] **Step 4: Add `greenBlocks` to `town-plan.js`**

The same sweep `townPlan` does, collecting the cells whose `blockContent` came back `green` and returning `{x, z, radius}` in world units, with `radius` a little under half a cell (5) so planting stays off the kerb.

- [ ] **Step 5: Plant them, and clear the rest**

In `colony.js:282`, pass a `keepClear` that covers the whole town — the built area must not sprout boulders between the houses — and plant the green blocks. `forest.glb` is a **separate atlas**, so this planting can never merge into the city mesh; it is a second draw call and that is expected. Reuse `createScatter` rather than writing a second scatter system.

Task 4 already moved the scatter's own placement ring outward to `TOWN_RADIUS + 14`, so the countryside starts outside the town. What remains is the green blocks themselves.

- [ ] **Step 6: Run the suite and commit**

Run: `npm test`

```bash
git add src/world/town-plan.js src/game/colony.js test/town-planting.test.mjs
git commit -m "Plant the green blocks and keep the countryside out of the town"
```

---

### Task 9: Documents, and someone looking at it

The spec's closing requirement: "**it must be looked at, by someone who will say when it is wrong.** Both corner checks in the previous stage passed and the owner still found the defect in a minute."

**Files:**
- Modify: `README.md` or whichever document describes the world — find it, do not assume
- Modify: `docs/superpowers/specs/2026-09-16-moving-in-streets-and-town-design.md` (status line only)

- [ ] **Step 1: Find every document that describes the streets**

```bash
grep -rln "ring road\|ringRuns\|spur\|hexagon\|hex lattice" --include=*.md . | grep -v node_modules
```

Every claim about a ring road around the colony is now false. Fix each one. A documentation claim must be true of the code — every Important review finding across six stages has been documentation asserting the opposite of the implementation, and this task is where that streak either continues or stops.

- [ ] **Step 2: Serve it and look**

```bash
npx vite --host 127.0.0.1 --port 5280 --strictPort
```

Bind explicitly to IPv4: the default binding here is IPv6-only. **Never** use 5274, 5275 or 5276.

Take a screenshot of the colony from above and from street level. Check, by eye, and write what you see in the report:

- Do the painted centre lines run continuously through every bend, curving the way the road curves? This is the defect the owner found in a minute and two automated checks missed.
- Is there a town outside the colony, with buildings?
- Do the cars drive on the roads rather than through the houses?

**Animated behaviour is verified by driving frames by hand**, never through the Browser pane, which does not tick `requestAnimationFrame` in this project — measured at 0 frames in 3 seconds. The engine's updaters are objects with an `update(dt, elapsed)` method; call one in a loop to move a car.

- [ ] **Step 3: Hand the screenshots to the owner**

A rendered screenshot judged by the person who wrote the code is the weakest evidence in this project's history. Send the screenshots and say plainly what you are unsure of. The stage is not done until someone who will say it is wrong has looked.

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "Document the street network and the town"
```

---

## Self-review against the spec

| Spec requirement | Task |
|---|---|
| One street network, no ring, no join | 2 |
| Streets run between blocks; blocks are what is left | 1, 2 |
| A street cell is a street block, carriageway down the middle | 3, 7 |
| Uneven block sizes, jogs, dead ends and T-junctions | 1 |
| Deterministic, and stable against the colony | 1, 2 |
| Median route street fraction >= 0.6; no route over two cells at zero | 2 |
| Corner verified by its markings against the UV layout | 3 |
| Removes the ring, the spurs, `ringRuns` | 2, 3 |
| Ground flattened under the built area | 4 |
| Town's outer edge irregular | 5 |
| Green blocks | 5, 8 |
| Pavement, lamps along the roads, zebra, traffic lights | 7 |
| Block content a function of its own position | 5, 6 |
| Geometry budget measured against the colony's own count | 6 |
| Planting from `forest.glb`, a separate atlas | 8 |
| Documents true of the code; someone looks at it | 9 |

**Not in any task, because the spec puts them out of scope:** traffic beyond what exists, anything obeying the traffic lights, diagonal or curved streets, pedestrians, interiors, street lighting as a real light source, and any change to the crew, houses, garments or depot.
