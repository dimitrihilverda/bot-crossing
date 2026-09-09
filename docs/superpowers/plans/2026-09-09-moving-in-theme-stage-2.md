# Moving-In Crossing Stage 2 Implementation Plan — the delivery drive

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A car loaded with furniture drives the whole way from the depot to a thread's plot when that thread appears, parks there while the thread is worked on, and drives back to the depot when the thread is archived.

**Architecture:** A new `src/world/deliveries.js` owns the vehicles: two `InstancedMesh`es (bodies and wheels) following the pattern `Scaffolds` already uses, plus a pure path module `src/world/drive-path.js` that turns a pair of hex cells into a polyline. Heights come from the existing `colony.groundAt(x, z)`. The parked car replaces `Scaffolds` as the "somebody is working here" marker, and a crew member whose car is in transit is simply not drawn — it rides along. **No new status and no new behaviour**: `STATUS_ORDER` is untouched.

**Tech Stack:** three.js 0.185, Vite 7, `node --test`. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-moving-in-theme-design.md` — the Stage 2 section, and "Explicitly not doing".

## Global Constraints

- Node >= 22.13. All code, comments and user-facing text in **English**.
- Baseline is **67 passing, 0 failing**. Every task must leave the suite green; counts below are relative to 67.
- Runs on **port 5280** (`PORT=5280 npm run dev`). 5274 is a live installation's owner UI, 5275 its guest API, 5276 its UDP discovery. Never use those three.
- No new dependencies. `package.json`'s dependency lists must not change.
- **`STATUS_ORDER` in `src/game/colony.js` stays the single strict precedence.** Do not add a status, a parallel flag, or a seventh behaviour. A thread does exactly one thing.
- **The badge stays on the crew figure and never moves to the car.** A moving target is hard to click and its status is hard to read; finding the one `?` is the whole point of the app. `idle` and `sleeping` still carry no badge.
- Art is CC0 by Kay Lousberg; raw packs are never committed. The car comes from the already-built `city` kit — no new asset pack, so `public/assets/*.glb` must not change.
- This is a worktree of `C:\PhpstormProjects\bot-crossing` on branch `moving-in-theme`, tracking `origin/moving-in-theme`. **Never switch branches in `C:\PhpstormProjects\bot-crossing`** — that checkout is a live installation whose autostart serves its `dist/`.
- Do not push. The branch owner pushes.

## What already exists, and must be reused rather than rebuilt

| Primitive | Where | What it gives you |
| --- | --- | --- |
| `cellWorld(q, r)` | `src/world/plots.js:87` | hex cell → world `{x, z}` |
| `worldToHex(x, z, size)` | `src/world/plots.js:96` | world → fractional-then-rounded hex cell |
| `HEX_DIRS` | `src/world/plots.js:63` | the six axial neighbour directions |
| `shipPosition()` | `src/world/plots.js:364` | where the depot stands |
| `DECK_TOP` | `src/world/plots.js:41` | `0.45`, a deck's top face above its ground |
| `colony.groundAt(x, z)` | `src/game/colony.js:537` | **the height to drive at** — decked cell height, else `terrainHeight` |
| `Plot.worldSlot(index, target)` | `src/world/plots.js` | the world position of one building slot on a plot |
| `colony._isActive(id)` | `src/game/colony.js` | the predicate `Scaffolds` uses for "running right now" |
| `part(name, kit, {solo})` | `src/world/kit.js` | `solo` returns a node's own mesh without children — this is how the wheels come off the body |
| `CELL_CITY.ACCENT` | `src/world/kit.js` | `5` — the atlas cell the shader repaints per repo |
| `decorate()`, `depthMaterial()` | `src/world/buildings.js` | the shared shader patch; exported, already used by `houses.js` and `ship.js` |

The car parts in the `city` kit, verified present: `car_stationwagon`, plus `car_stationwagon_wheel_front_left`, `_front_right`, `_rear_left`, `_rear_right`. Regenerate the full listing any time with `node tools/list-parts.mjs public/assets/city.glb`.

---

### Task 1: The drive path, as pure arithmetic

The only part of this stage that is testable without a browser, so it goes first and carries the tests.

**Files:**
- Create: `src/world/drive-path.js`
- Test: `test/drive-path.test.mjs`

**Interfaces:**
- Consumes: nothing. Deliberately takes plain numbers, not three.js objects or colony state, so it can be tested under `node --test`.
- Produces:
  - `hexLine(q0, r0, q1, r1)` → array of `{q, r}` cells from start to end inclusive, each adjacent to the last.
  - `pathLength(points)` → total 2D length of an array of `{x, z}`.
  - `pointAt(points, distance)` → `{x, z, heading}` at `distance` along that polyline, where `heading` is the direction of travel in radians (`Math.atan2(dz, dx)`), clamped at both ends.

- [ ] **Step 1: Write the failing test**

`test/drive-path.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hexLine, pathLength, pointAt } from '../src/world/drive-path.js'

test('a line to itself is one cell', () => {
  assert.deepEqual(hexLine(0, 0, 0, 0), [{ q: 0, r: 0 }])
})

test('a line to a neighbour is two adjacent cells', () => {
  const line = hexLine(0, 0, 1, 0)
  assert.equal(line.length, 2)
  assert.deepEqual(line[0], { q: 0, r: 0 })
  assert.deepEqual(line[1], { q: 1, r: 0 })
})

test('every step of a long line is adjacent to the last', () => {
  // Axial neighbours differ by one of the six HEX_DIRS; in cube terms the
  // cube distance between consecutive cells is exactly 1.
  const line = hexLine(-3, 2, 4, -5)
  assert.ok(line.length > 2)
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const dq = b.q - a.q
    const dr = b.r - a.r
    const ds = -dq - dr
    const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
    assert.equal(dist, 1, `step ${i} jumps ${dist} cells: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
  }
})

test('a line starts and ends where asked', () => {
  const line = hexLine(-3, 2, 4, -5)
  assert.deepEqual(line[0], { q: -3, r: 2 })
  assert.deepEqual(line[line.length - 1], { q: 4, r: -5 })
})

test('path length sums the segments', () => {
  const pts = [
    { x: 0, z: 0 },
    { x: 3, z: 4 },
    { x: 3, z: 4 },
    { x: 3, z: 9 },
  ]
  // 5 for the 3-4-5 triangle, 0 for the duplicate point, 5 for the straight run.
  assert.equal(pathLength(pts), 10)
})

test('an empty or single-point path has zero length', () => {
  assert.equal(pathLength([]), 0)
  assert.equal(pathLength([{ x: 2, z: 2 }]), 0)
})

test('pointAt walks along the path and faces the way it is going', () => {
  const pts = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
  ]
  const mid = pointAt(pts, 5)
  assert.equal(mid.x, 5)
  assert.equal(mid.z, 0)
  assert.equal(mid.heading, 0)
})

test('pointAt clamps at both ends rather than extrapolating', () => {
  const pts = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
  ]
  assert.equal(pointAt(pts, -5).x, 0)
  assert.equal(pointAt(pts, 999).x, 10)
})

test('pointAt turns the corner', () => {
  const pts = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
  ]
  const after = pointAt(pts, 15)
  assert.equal(after.x, 10)
  assert.equal(after.z, 5)
  // Heading is now along +z.
  assert.ok(Math.abs(after.heading - Math.PI / 2) < 1e-9, `heading ${after.heading}`)
})

test('a single-point path is a standstill, not a crash', () => {
  const at = pointAt([{ x: 4, z: 7 }], 3)
  assert.equal(at.x, 4)
  assert.equal(at.z, 7)
  assert.equal(at.heading, 0)
})

test('an empty path is a standstill at the origin', () => {
  const at = pointAt([], 3)
  assert.equal(at.x, 0)
  assert.equal(at.z, 0)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/drive-path.test.mjs`
Expected: FAIL — cannot find module `../src/world/drive-path.js`.

- [ ] **Step 3: Write the module**

Create `src/world/drive-path.js`:

```javascript
/**
 * The route a delivery takes, as pure arithmetic over plain numbers.
 *
 * Kept free of three.js and of colony state on purpose: this is the only part of the
 * delivery that can be tested under `node --test`, and it is the part where an off-by-one
 * would show up as a car cutting a corner through a house rather than as an error.
 *
 * Hex lines are drawn in cube coordinates. Axial (q, r) cannot be interpolated directly —
 * rounding a fractional axial coordinate can land two cells away from its neighbour — so
 * each sample converts to cube, rounds with the largest-error-component fix-up, and comes
 * back. That fix-up is what guarantees consecutive cells are adjacent, which the test
 * asserts step by step.
 */

/** Axial → cube. The third axis is implied: q + r + s = 0. */
function toCube(q, r) {
  return { x: q, y: r, z: -q - r }
}

/**
 * Round a fractional cube coordinate to the nearest whole cell, then repair the axis that
 * moved furthest so the three still sum to zero. Without the repair, rounding can produce a
 * cell that is not adjacent to its predecessor.
 */
function roundCube(x, y, z) {
  let rx = Math.round(x)
  let ry = Math.round(y)
  let rz = Math.round(z)
  const dx = Math.abs(rx - x)
  const dy = Math.abs(ry - y)
  const dz = Math.abs(rz - z)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  return { q: rx, r: ry }
}

/** Cube distance, which is the number of steps between two cells. */
function cubeDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
}

/**
 * Every cell from (q0, r0) to (q1, r1) inclusive, each adjacent to the one before it.
 *
 * The nudge is the standard fix for a line that passes exactly through a cell corner: an
 * unnudged sample sits equidistant from two cells and the rounding picks arbitrarily,
 * which can break adjacency.
 */
export function hexLine(q0, r0, q1, r1) {
  const a = toCube(q0, r0)
  const b = toCube(q1, r1)
  const steps = cubeDistance(a, b)
  if (steps === 0) return [{ q: q0, r: r0 }]

  const out = []
  const nudge = 1e-6
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    out.push(
      roundCube(
        a.x + (b.x - a.x) * t + nudge,
        a.y + (b.y - a.y) * t + nudge,
        a.z + (b.z - a.z) * t - 2 * nudge
      )
    )
  }
  return out
}

/** Total 2D length of a polyline of `{x, z}` points. */
export function pathLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)
  }
  return total
}

/**
 * Where a vehicle is after travelling `distance` along the polyline, and which way it faces.
 *
 * Clamps rather than extrapolating: a car that has arrived sits at the kerb instead of
 * carrying on into the terrain, and a negative distance is the start rather than a reverse.
 */
export function pointAt(points, distance) {
  if (!points.length) return { x: 0, z: 0, heading: 0 }

  const first = points[0]
  // A route of one point is a standstill: nowhere to go and no direction to face.
  if (points.length === 1) return { x: first.x, z: first.z, heading: 0 }

  // Not yet moving: sit at the start already facing down the first segment, so a car does
  // not pivot on the spot the instant it pulls away.
  if (distance <= 0) {
    const next = points[1]
    return { x: first.x, z: first.z, heading: Math.atan2(next.z - first.z, next.x - first.x) }
  }

  let travelled = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const seg = Math.hypot(b.x - a.x, b.z - a.z)
    if (seg === 0) continue
    if (travelled + seg >= distance) {
      const t = (distance - travelled) / seg
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        heading: Math.atan2(b.z - a.z, b.x - a.x),
      }
    }
    travelled += seg
  }

  // Past the end: sit at the last point, still facing the way the last segment ran.
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  return { x: last.x, z: last.z, heading: Math.atan2(last.z - prev.z, last.x - prev.x) }
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/drive-path.test.mjs`
Expected: PASS — 10 tests.

If the "every step is adjacent" test fails, the nudge is the thing to look at, not the rounding: that test exists precisely to catch a line that passes through a corner.

- [ ] **Step 5: Run the whole suite**

Run: `npm test`
Expected: PASS — 77 tests (67 baseline + 10 new).

- [ ] **Step 6: Commit**

```bash
git add src/world/drive-path.js test/drive-path.test.mjs
git commit -m "feat: the delivery drive's path, as pure arithmetic"
```

---

### Task 2: The car, with wheels that turn

**Files:**
- Create: `src/world/deliveries.js`
- Test: `test/deliveries.test.mjs`

**Interfaces:**
- Consumes: `part()`, `CELL_CITY`, `atlasTexture()`, `cellMask()` from `src/world/kit.js`; `decorate()` and `depthMaterial()` from `src/world/buildings.js` (both already exported and used by `houses.js` and `ship.js`).
- Produces:
  - `CAR_PARTS` — a frozen object naming the five kit parts, exported so a test can assert they exist without a browser.
  - `CAR_SCALE` — the uniform scale the car geometry is drawn at, the same shape `HOUSE_SCALE` has in `houses.js`.
  - `WHEEL_RADIUS` — the number used to convert distance travelled into wheel spin. Already measured from `city.glb` (0.1048); step 3a is the script to re-verify it with.
  - `CAR_SPEED` — world units per second a car travels. Lives here with the other two so all three vehicle constants sit together, which is what makes "re-measure if the scale changes" actionable. Task 3 imports it.
  - `wheelSpin(distance, radius)` → radians a wheel of that radius has turned after rolling `distance`. Pure, and tested.
  - `class Deliveries` — constructed as `new Deliveries(scene, capacity = 64)`, with `update(vehicles)`, `dispose()`, and an `onSettingsChanged(changed)` matching how `Scaffolds` and the crew props are driven. `vehicles` is an array of `{ x, y, z, heading, distance, accent }`.

- [ ] **Step 1: Write the failing test**

`test/deliveries.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { CAR_PARTS, WHEEL_RADIUS, wheelSpin } from '../src/world/deliveries.js'

test('every car part the module names exists in the city kit', async () => {
  const doc = await new NodeIO().read('public/assets/city.glb')
  const names = new Set(
    doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName())
      .filter(Boolean)
  )
  for (const name of Object.values(CAR_PARTS)) {
    assert.ok(names.has(name), `city.glb has no node named "${name}"`)
  }
})

test('the car names a body and exactly four wheels', () => {
  assert.ok(CAR_PARTS.body)
  const wheels = Object.keys(CAR_PARTS).filter((k) => k !== 'body')
  assert.equal(wheels.length, 4, `expected 4 wheels, got ${wheels.join(', ')}`)
})

test('a wheel turns once per circumference rolled', () => {
  // Rolling exactly one circumference is one full turn.
  const oneTurn = wheelSpin(2 * Math.PI * WHEEL_RADIUS, WHEEL_RADIUS)
  assert.ok(Math.abs(oneTurn - 2 * Math.PI) < 1e-9, `got ${oneTurn}`)
})

test('a stationary wheel does not turn, and a zero radius does not divide by zero', () => {
  assert.equal(wheelSpin(0, WHEEL_RADIUS), 0)
  assert.equal(wheelSpin(5, 0), 0)
})

test('the badge never moves to the car', () => {
  // The indicators module is the only thing allowed to draw badges, and it is driven from
  // the crew roster. A reference to it from the vehicle module would be the first step
  // toward a badge over a moving target, which the spec forbids.
  const src = readFileSync('src/world/deliveries.js', 'utf8')
  assert.doesNotMatch(src, /indicators|BADGE|badgeFor/i, 'deliveries.js reaches into badges')
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/deliveries.test.mjs`
Expected: FAIL — cannot find module `../src/world/deliveries.js`.

- [ ] **Step 3: Write the module's tested core first**

Create `src/world/deliveries.js` starting with only the parts the test needs, so the test can go green before any three.js is involved:

```javascript
/**
 * The delivery vehicles: a loaded car per thread, driving between the depot and a plot.
 *
 * There is no van in the city kit — it ships five cars and no cargo vehicle, and the paid
 * tier adds park assets rather than vehicles (see the spec's Stage 2 section). So the
 * vehicle is the estate car with a load on its roof. Staying inside the city kit is worth
 * more than a closer-shaped model from elsewhere: it shares the houses' atlas, so it merges
 * and takes the repo's accent from the same repainted cell, and its wheels are separate
 * nodes, which is what `kit.js`'s `solo` mode exists for.
 */

/** The kit nodes a car is assembled from. Verified against city.glb by the test. */
export const CAR_PARTS = Object.freeze({
  body: 'car_stationwagon',
  wheelFrontLeft: 'car_stationwagon_wheel_front_left',
  wheelFrontRight: 'car_stationwagon_wheel_front_right',
  wheelRearLeft: 'car_stationwagon_wheel_rear_left',
  wheelRearRight: 'car_stationwagon_wheel_rear_right',
})

/** Authored on the city pack's grid and scaled once, the way HOUSE_SCALE does in houses.js. */
export const CAR_SCALE = 1.45

/**
 * Wheel radius in world units: half `car_stationwagon_wheel_front_left`'s own bounding-box
 * height (0.1446 / 2 = 0.0723) times CAR_SCALE. Measured from city.glb, not guessed —
 * re-measure with step 3a's script if CAR_SCALE changes, or the wheels will visibly skid
 * instead of roll.
 */
export const WHEEL_RADIUS = 0.1048

/** World units per second. Tuned by eye in step 7; a colony crossing should take a few seconds. */
export const CAR_SPEED = 3.2

/**
 * How far a wheel of `radius` has rotated after rolling `distance`.
 *
 * Guards a zero radius rather than returning Infinity: a mis-measured constant should make
 * the wheels stop, which is obvious, instead of producing NaN transforms that silently
 * remove the whole instanced mesh from the scene.
 */
export function wheelSpin(distance, radius) {
  if (!radius) return 0
  return distance / radius
}
```

- [ ] **Step 3a: Re-verify `WHEEL_RADIUS` against the kit**

The value in the code above was measured from the built kit. Re-run the measurement to confirm it and state in your report what you got — if it disagrees, trust the measurement and correct the constant:

```bash
node --input-type=module -e "
import { NodeIO } from '@gltf-transform/core'
const doc = await new NodeIO().read('public/assets/city.glb')
for (const node of doc.getRoot().listNodes()) {
  if (node.getName() !== 'car_stationwagon_wheel_front_left') continue
  const mesh = node.getMesh()
  if (!mesh) continue
  for (const prim of mesh.listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    let minY = Infinity, maxY = -Infinity
    for (let i = 0; i < pos.getCount(); i++) {
      const y = pos.getElement(i, [0, 0, 0])[1]
      if (y < minY) minY = y
      if (y > maxY) maxY = y
    }
    console.log('wheel height', (maxY - minY).toFixed(4), '-> radius', ((maxY - minY) / 2).toFixed(4))
  }
}
"
```

`WHEEL_RADIUS` is that radius multiplied by `CAR_SCALE`, because the geometry is scaled
before it is drawn. If the wheel is not a circle in cross-section, use the Y extent — that is
the axis it rolls about.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/deliveries.test.mjs`
Expected: PASS — 5 tests. The first test reads the real `city.glb`, so a wrong part name fails here rather than at runtime. The wheel-roll test is scale-independent — it asserts the relationship between distance and turns, so it passes for any radius you measured.

- [ ] **Step 5: Commit the tested core**

```bash
git add src/world/deliveries.js test/deliveries.test.mjs
git commit -m "feat: name the car's kit parts and its wheel roll"
```

- [ ] **Step 6: Add the scene half**

Append the `Deliveries` class to the same file. Follow `Scaffolds` in `src/world/buildings.js` closely — it is the pattern this project already uses for "many small dynamic things": build the geometry once, hold one `InstancedMesh` with `DynamicDrawUsage`, set `count` per frame, and set `instanceMatrix.needsUpdate`.

Two instanced meshes, not one, because the body and the wheels are different geometry:

- **bodies:** `part(CAR_PARTS.body, 'city', { solo: true })` — `solo` leaves the wheels behind, which is exactly why it exists.
- **wheels:** `part(CAR_PARTS.wheelFrontLeft, 'city', { solo: true })` as the shared wheel geometry, four instances per car.

The wheel offsets are the four wheel parts' own local positions, read from their bounding-box centres at load and cached — do not hand-type four offsets, because the kit's own positions are already correct and a typo shows as a wheel inside the door.

Material: `atlasTexture('city')` with `cellMask([CELL_CITY.ACCENT])`, wrapped in `decorate()` exactly as `houses.js` does for its shell, so a car carries its repo's accent colour like everything else on that plot. Pin `uProgress` to `1` and `uSink` to `0` — a car does not rise out of the ground.

`update(vehicles)` writes, per vehicle: the body at `(x, y, z)` rotated `heading` about Y, and its four wheels at their cached offsets rotated by `wheelSpin(distance, WHEEL_RADIUS)` about their own axle. Set both meshes' `count` and both `instanceMatrix.needsUpdate` at the end of the pass.

`dispose()` frees both geometries, both materials, and removes both meshes from the scene — mirror `Scaffolds.dispose()`. `onSettingsChanged(changed)` should iterate its meshes generically rather than naming them one by one, which is what the crew props do and what stops a leak when a new mesh is added later.

- [ ] **Step 7: Run the suite**

Run: `npm test`
Expected: PASS — 82 tests (77 + 5 new).

- [ ] **Step 8: Commit**

```bash
git add src/world/deliveries.js
git commit -m "feat: draw the delivery cars and their wheels"
```

---

### Task 3: Drive the cars, and retire the scaffolding

**Files:**
- Modify: `src/game/colony.js` — the `Scaffolds` import and construction, `_updateScaffolds` (around `:932-950`), the `update` call site (around `:827`), and `dispose` (around `:978`)
- Modify: `src/world/buildings.js` — delete `Scaffolds`
- Test: `test/deliveries.test.mjs` (extend)

**Interfaces:**
- Consumes: `hexLine`, `pathLength`, `pointAt` (Task 1); `Deliveries` (Task 2); the existing `cellWorld`, `worldToHex`, `shipPosition`, `DECK_TOP` from `src/world/plots.js`; `colony.groundAt(x, z)` at `src/game/colony.js:537`; `colony._isActive(id)`.
- Produces: nothing new for later tasks. `colony.deliveries` replaces `colony.scaffolds`.

- [ ] **Step 1: Read what you are replacing**

```bash
sed -n '925,955p' src/game/colony.js
grep -n "Scaffolds\|scaffolds" src/game/colony.js src/world/buildings.js
```

`_updateScaffolds` gathers a site per building that is both past `progress > 0.03` and `_isActive(id)`. That predicate — "a thread is running here right now" — is what the parked car inherits. The height and radius it computes come from `entry.mesh.userData`, which a car does not need.

- [ ] **Step 2: Write the failing test**

Append to `test/deliveries.test.mjs`:

```javascript
test('the colony drives deliveries and no longer builds scaffolding', () => {
  const colony = readFileSync('src/game/colony.js', 'utf8')
  assert.match(colony, /Deliveries/, 'colony.js does not use Deliveries')
  assert.doesNotMatch(colony, /Scaffolds|scaffolds/, 'colony.js still references Scaffolds')

  const buildings = readFileSync('src/world/buildings.js', 'utf8')
  assert.doesNotMatch(buildings, /class Scaffolds/, 'Scaffolds was not removed')
})

test('a car drives at the height of the ground under it', () => {
  // groundAt is the decked-cell-then-terrain lookup; a delivery that ignored it would
  // drive through a plot's deck rather than up onto it.
  const colony = readFileSync('src/game/colony.js', 'utf8')
  assert.match(colony, /groundAt\(/, 'the delivery does not consult groundAt')
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `node --test test/deliveries.test.mjs`
Expected: FAIL — `colony.js does not use Deliveries`.

- [ ] **Step 4: Build the route for one thread**

In `src/game/colony.js`, replace `_updateScaffolds` with a `_updateDeliveries(dt)` that, per building entry:

1. Skips entries with `progress <= 0.03`, as before.
2. Computes the route once per entry and caches it on the entry — a route only changes if the plot's cells change, and recomputing a hex line every frame for 75 threads is waste. Cache key: the plot id and slot.
   - Start cell: `worldToHex(shipPosition().x, shipPosition().z)`
   - End cell: `worldToHex(slot.x, slot.z)` where `slot` is the building's own position
   - `const cells = hexLine(start.q, start.r, end.q, end.r)`
   - `const points = cells.map((c) => cellWorld(c.q, c.r))`, then replace the final point with the building's own position so the car parks at the house rather than at the cell centre
   - `const length = pathLength(points)`
3. Advances `entry.driven` by `dt * CAR_SPEED` (imported from `deliveries.js` — Task 2 defines it) while the thread is arriving, and back down while it is leaving.
4. Produces one vehicle per entry: `pointAt(points, entry.driven)` for `x`, `z` and `heading`; `y` from `this.groundAt(x, z)`; `distance` = `entry.driven`; `accent` = `plot.accent`.
5. Hands the array to `this.deliveries.update(vehicles)`.

A thread that is neither arriving nor leaving has `entry.driven` at the end of its route, so its car simply sits parked at the house — which is the state that replaces the scaffolding, and it is why no extra "parked" flag is needed.

- [ ] **Step 5: Hide a crew member that is riding**

The spec asks the crew to load and unload. Do **not** add a behaviour for it: `astronauts.js` derives behaviour from the roster under a strict precedence, and a seventh state would compete with the six and could steal the badge.

Instead, a crew member whose car is in transit is simply not drawn — it is riding in it. Find where the crew roster is handed over (`this.astronauts.setRoster(roster, this._world())` around `:388`) and where per-agent visibility is already decided, and suppress the figure for a thread whose `entry.driven` is neither `0` nor the full route length. Its badge goes with it, which is correct: a thread in transit has just appeared and wants nothing yet.

**Do not touch `STATUS_ORDER`, `AGENT_LOOK`, or the badge mapping.**

- [ ] **Step 6: Delete `Scaffolds`**

Remove the class from `src/world/buildings.js` and its import, construction and disposal from `src/game/colony.js`. Confirm nothing else references it:

```bash
grep -rn "Scaffolds" src/ test/ tools/
```

Expected: only the assertion in `test/deliveries.test.mjs` that it is gone.

- [ ] **Step 7: Run the suite and watch it drive**

```bash
npm test
PORT=5280 npm run dev
```

Expected: 84 tests passing, 0 failing. On screen: no timber poles anywhere; a car parked at each house whose thread is running; and when a thread appears, a car leaving the depot and driving to it. Watch one full arrival and confirm the car follows the hex surface rather than cutting across a gap or sinking through a deck.

**Stop the dev server when done** and verify with `netstat -ano | grep 5280` that nothing is listening.

- [ ] **Step 8: Commit**

```bash
git add src/game/colony.js src/world/buildings.js src/world/deliveries.js test/deliveries.test.mjs
git commit -m "feat: cars drive the delivery, and the scaffolding retires"
```

---

### Task 4: The return trip, and the roof load

**Files:**
- Modify: `src/game/colony.js` — the retire path (`_removeBuilding`, and the `progress <= 0.02` check around `:825`)
- Modify: `src/world/deliveries.js` — the roof load

**Interfaces:**
- Consumes: everything from Tasks 1-3.
- Produces: nothing new.

- [ ] **Step 1: Understand what retiring does today**

```bash
grep -n "retiring\|_removeBuilding" src/game/colony.js | head
```

A retiring entry damps `progress` toward `0` and is removed once `progress <= 0.02`. The car has to finish its drive back to the depot **before** the entry is disposed, or it vanishes mid-street.

- [ ] **Step 2: Hold the entry until its car is home**

Extend the retire condition so an entry is removed only when its `progress <= 0.02` **and** `entry.driven <= 0`. Drive `entry.driven` back down toward zero over the same route while retiring.

This is the one place a bug will not show up in tests: a car that never reaches `driven <= 0` leaks the entry forever. Guard it the way `growth.js` guards its own arrival — land exactly on zero rather than approaching it — and add a test for the arithmetic if you extract it.

- [ ] **Step 3: Put a load on the roof**

In `src/world/deliveries.js`, add a third instanced mesh for the load: one furniture part from the `furniture` kit, one instance per vehicle, positioned above the body's roof.

It needs its own mesh because it comes from the **furniture atlas**, and a merged geometry carries one material — the same reason a house is a shell plus contents. Use `atlasTexture('furniture')` and `cellMask([CELL_FURNITURE.ACCENT])` for it.

Pick the part from the listing rather than from memory:

```bash
node tools/list-parts.mjs public/assets/furniture.glb | grep -iE "box|crate|cabinet|table"
```

Scale it against the car with the same care Stage 1 used for `FURNITURE_SCALE` — the two packs disagree by roughly 6x, and a sofa the size of the car is worse than no load at all.

- [ ] **Step 4: Run the suite and watch a full round trip**

```bash
npm test
PORT=5280 npm run dev
```

Expected: all tests passing. On screen: archive a thread and watch its car load up, drive back to the depot, and only then have the house disappear. Confirm no car is left standing in the street afterwards, and that the entry is actually gone (the colony's counts should drop).

**Stop the dev server and verify port 5280 is free.**

- [ ] **Step 5: Commit**

```bash
git add src/game/colony.js src/world/deliveries.js
git commit -m "feat: the car drives home before the house goes, and carries a load"
```

---

### Task 5: Documentation, and the two stale strings

**Files:**
- Modify: `README.md`
- Modify: `server/serve.mjs:62`, `tools/build-assets.mjs` (the docblock)
- Modify: `docs/superpowers/specs/2026-09-09-moving-in-theme-design.md`

**Interfaces:** none. Text only.

- [ ] **Step 1: Describe the drive in the README**

The README's opening describes Stage 1. Add the delivery: a car leaves the depot when a thread appears, parks at the house while it is worked on, and drives back when you archive it. Say that the crew rides in it, and that the badge stays on the crew member.

- [ ] **Step 2: Clear the two deferred brand strings**

Stage 1's final review deliberately deferred these for one coordinated sweep rather than picking them off singly. This is that sweep:

- `server/serve.mjs:62` logs `Bot Crossing → ...` on startup.
- `tools/build-assets.mjs`'s docblock says "the three glbs it loads"; it builds five.

Check for others while you are here:

```bash
grep -rn "Bot Crossing" server/ tools/ src/ index.html | grep -v node_modules
```

**Do not change anything else under `server/`.** A colleague's LAN colony-sharing work lives there and Stage 1 kept it byte-identical on purpose; a log string is safe, a behaviour change is not.

- [ ] **Step 3: Mark Stage 2 done in the spec**

Update the spec's Stage 2 section to say it is implemented, and note what it actually became: the crew rides rather than loading in a separate animation, and why (no seventh behaviour, the strict precedence stays intact).

- [ ] **Step 4: Full verification**

```bash
npm test
npm run build
PORT=5280 npm run serve
```

Expected: all tests passing, build succeeds, and the production server serves the themed colony with driving cars on 5280 while the live installation still answers on 5274.

**Stop the server and verify port 5280 is free.**

- [ ] **Step 5: Commit**

```bash
git add README.md server/serve.mjs tools/build-assets.mjs docs/superpowers/specs
git commit -m "docs: describe the delivery drive, and sweep the last brand strings"
```

---

## Done when

- `npm test` passes, at the 67-test baseline plus the tests added here.
- A car leaves the depot when a thread appears, drives the whole way over the hex surface at the height of the ground under it, and parks at the house.
- Archiving a thread sends its car back to the depot, and the house disappears only **after** the car is home.
- **No timber scaffolding anywhere** — the parked car is the "somebody is working here" marker.
- **The badge is still on the crew figure**, never on a car, and `idle` and `sleeping` still carry none.
- `STATUS_ORDER` is unchanged and there is no seventh behaviour.
- `git diff --stat -- server/` shows only the one log string in `serve.mjs`.
- The live installation still answers on 5274 with its autostart untouched.
