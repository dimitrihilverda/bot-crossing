# Streets, Traffic and Workwear Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the colony streets, route delivery vehicles along them, add ambient traffic that no coding-agent thread owns, and put the crew in workwear instead of the five shades of white left over from the spacesuit.

**Architecture:** Streets are a **derived layer**: `planStreets` reads the plot layout *after* `allocateCells` has produced it, so the sticky layout persisted in `data/colony.json` carries no risk. A road route is composed by swapping only the *cell sequence* inside `colony.js`'s `_routeFor`, leaving stage 2's verified kerb arithmetic untouched. Ambient traffic is a pure state machine with its own renderer, so nothing about it can reach the delivery path.

**Tech Stack:** three.js 0.185, Vite 7, `node --test`. KayKit CC0 kits `city.glb` and `forest.glb`, both already built and committed.

**Spec:** `docs/superpowers/specs/2026-09-10-moving-in-streets-and-traffic-design.md` (approved, commits `b21ac95` and `0c25255`)

## Global Constraints

- `server/` stays **byte-identical** to Dimitri's `shared-colonies` branch. `git diff -- server/` must be empty at the end of the stage, and must be checked at the end of every task.
- No new dependencies. `package.json` and `public/assets/*.glb` unchanged.
- All code, comments and documents in **English**.
- `STATUS_ORDER` and the eight `AGENT_LOOK` keys unchanged.
- Test baseline entering this stage: **157 passing, 0 failing**. `npm run build` must succeed after every task.
- Theme port is **5280**. Ports **5274, 5275 and 5276** belong to the always-on installation and must never be used by a dev server. Any agent that starts a dev server must prove with `netstat` that it freed the port again.
- A documentation claim must be true of the code. Across stages 1 to 3 **every** Important review finding — seven of them — was documentation asserting the opposite of the implementation, and one fix round introduced a fresh false claim while correcting another. Check that nothing *removed* was true either.
- **The Browser pane does not drive `requestAnimationFrame`** in this project (measured: 0 frames in 3 seconds with the document visible). Verify animated behaviour by driving frames by hand from the console: `for (let i = 0; i < 600; i++) colony.update(1/60, elapsed += 1/60)`.

## File Structure

| File | Responsibility |
| --- | --- |
| `src/agents/astronauts.js:31` | `SUIT_TONES` — the crew body colour list. Task 1. |
| `src/world/hex-cells.js` *(new)* | Nothing. This file is **not** created — see the note under Task 2. |
| `src/world/streets.js` *(new)* | Pure: which cells are street, where the ring is, which spur belongs to which plot. Task 2. |
| `src/world/plots.js` | Four `export` keywords added; `isConnected` gains street passability. Tasks 2 and 3. |
| `src/world/road-path.js` *(new)* | Pure: composing a route that follows street cells, with the hex-line fallback. Task 4. |
| `src/game/colony.js` | `_routeFor` swaps its cell sequence; street planning and traffic are wired into the update loop. Tasks 4, 5, 7. |
| `src/world/road-mesh.js` *(new)* | The street surface and its city-atlas furniture. Task 5. |
| `src/world/traffic.js` *(new)* | Pure: the ambient vehicle state machine and the density function. Task 6. |
| `src/world/traffic-cars.js` *(new)* | Renders ambient vehicles: bodies and wheels, no roof load. Task 7. |
| `README.md`, the spec | Task 8. |

Tests are one file per new pure module, matching the existing convention (`test/drive-path.test.mjs`, `test/growth.test.mjs`).

---

### Task 1: Workwear

The crew body is one `InstancedMesh` with one colour per agent, already written per thread from `SUIT_TONES`. The list is five shades of white left over from the spacesuit; stage 1 re-themed the trim and never touched the body. This task is a constant change plus the test that pins it.

**Files:**
- Modify: `src/agents/astronauts.js:31`
- Test: `test/workwear.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces: `SUIT_TONES` must be **exported** from `src/agents/astronauts.js` so the test can read it. It is currently a module-local `const`. Add the `export` keyword; change nothing else about it.

- [ ] **Step 1: Write the failing test**

Create `test/workwear.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUIT_TONES, AGENT_LOOK } from '../src/agents/astronauts.js'

/**
 * sRGB channel triple, 0..1. Distances are taken here rather than in linear RGB
 * deliberately: linear RGB compresses dark colours so severely that no plausible
 * workwear tone is more than 0.10 from the `sleeping` trim. See the spec.
 */
const srgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const luminance = (hex) => {
  const [r, g, b] = srgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const distance = (a, b) => {
  const [ar, ag, ab] = srgb(a)
  const [br, bg, bb] = srgb(b)
  return Math.hypot(ar - br, ag - bg, ab - bb)
}

const MIN_DISTANCE = 0.15
const MIN_LUMINANCE_RATIO = 1.15

test('there are five workwear tones', () => {
  assert.equal(SUIT_TONES.length, 5)
})

test('no workwear tone can be confused with a status trim colour', () => {
  for (const suit of SUIT_TONES) {
    for (const [status, look] of Object.entries(AGENT_LOOK)) {
      const d = distance(suit, look.trim)
      assert.ok(
        d >= MIN_DISTANCE,
        `suit 0x${suit.toString(16)} is ${d.toFixed(3)} from ${status}'s trim, under ${MIN_DISTANCE}`
      )
    }
  }
})

test('every trim colour is brighter than every workwear tone', () => {
  // This is the property that makes hi-vis read as hi-vis. It failed for the whole of
  // stages 1 to 3: trims measure 0.09 to 0.41 in luminance and the old white bodies
  // measured 0.77 to 0.91, so the band was a dark smudge on a white suit.
  for (const suit of SUIT_TONES) {
    for (const [status, look] of Object.entries(AGENT_LOOK)) {
      const ratio = luminance(look.trim) / luminance(suit)
      assert.ok(
        ratio >= MIN_LUMINANCE_RATIO,
        `${status}'s trim is only ${ratio.toFixed(2)}x suit 0x${suit.toString(16)}, under ${MIN_LUMINANCE_RATIO}`
      )
    }
  }
})

test('no workwear tone is white', () => {
  // The regression guard for the actual defect: five near-white tones that had survived
  // three stages of re-theming because nothing asserted against them.
  for (const suit of SUIT_TONES) {
    assert.ok(luminance(suit) < 0.2, `suit 0x${suit.toString(16)} is too light to be workwear`)
  }
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/workwear.test.mjs`
Expected: FAIL. `SUIT_TONES` and `AGENT_LOOK` are not exported, so the import throws.

- [ ] **Step 3: Export both constants**

In `src/agents/astronauts.js`, add the `export` keyword to `SUIT_TONES` (line 31) and to `AGENT_LOOK` (line 56). Change nothing else about either declaration. `AGENT_LOOK` is exported read-only for the test; **do not** change its keys or its values — the eight keys are a global constraint.

- [ ] **Step 4: Run it again**

Run: `node --test test/workwear.test.mjs`
Expected: FAIL on `no workwear tone can be confused...` and on `no workwear tone is white`, because the tones are still white. This is the point: the test now proves the defect.

- [ ] **Step 5: Replace the tones**

In `src/agents/astronauts.js`, replace the `SUIT_TONES` declaration and its comment with exactly this:

```javascript
/**
 * Workwear. One flat colour for the whole figure, because the body is a single instanced
 * mesh with a single `instanceColor` per agent — so this is a boilersuit, not a two-tone
 * outfit. Real garments would need meshes sliced out of the body the way the hi-vis bands
 * are, and are deliberately not done.
 *
 * These five were picked against two measured constraints, both asserted in
 * `test/workwear.test.mjs` rather than eyeballed:
 *
 *  - **At least 0.15 away in sRGB from all eight trim colours**, so no overall can be
 *    mistaken for the trim that carries a thread's status. Measured worst case: 0.152.
 *  - **Every trim at least 1.15x the overall's luminance**, so the band is brighter than
 *    the cloth it sits on. Measured worst case: 1.18, `olive` against `sleeping`.
 *
 * The second constraint is the one that was broken. Trim colours measure 0.09 to 0.41 in
 * luminance; the five shades of white these replace measured 0.77 to 0.91. For the whole of
 * stages 1 to 3 the hi-vis band was therefore a *dark smudge on a white suit* — stage 1
 * re-themed the trim and left the body as spacesuit, and nothing asserted against it.
 *
 * Distances are taken in sRGB, not linear RGB. Linear RGB compresses dark colours so hard
 * that every plausible workwear tone sits within 0.10 of the `sleeping` trim, which is dark
 * itself; an early draft of the spec demanded 0.25 in linear RGB, which no colour could
 * have met.
 */
export const SUIT_TONES = [0x30424e, 0x455142, 0x4e3c30, 0x304530, 0x3a3d42]
```

- [ ] **Step 6: Run the new test, then the whole suite**

Run: `node --test test/workwear.test.mjs`
Expected: PASS, 4 tests.

Run: `npm test`
Expected: **161 passing, 0 failing** (157 + 4).

- [ ] **Step 7: Build, and confirm the server is untouched**

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty output.

- [ ] **Step 8: Commit**

```bash
git add src/agents/astronauts.js test/workwear.test.mjs
git commit -m "feat: the crew wear workwear instead of five shades of white"
```

---

### Task 2: `planStreets` — where the streets go

Pure arithmetic over plain cell objects. No three.js, no colony state. This is the whole of the street *layout* decision, and it is a derived layer: it reads a layout that `allocateCells` has already produced and never influences it.

**Files:**
- Create: `src/world/streets.js`
- Modify: `src/world/plots.js` (add `export` to four existing declarations)
- Test: `test/streets.test.mjs` (create)

**Interfaces:**
- Consumes: `HEX_DIRS`, `hexRing`, `hexDistance`, `key` from `src/world/plots.js`. All four exist already as module-local declarations at lines 63, 117, 149 and 78; this task adds the `export` keyword and nothing else. `plots.js` imports three.js, which is fine under `node --test` — `test/shared-colonies.test.mjs` already imports `allocateCells` from it.
- Produces:

```javascript
planStreets(layout, options) -> {
  ring: Array<{q, r}>,             // the through-road, in ring order
  spurs: Map<string, Array<{q,r}>>, // plot id -> its spur cells, nearest-first. Absent key = no spur.
  all: Set<string>,                 // every street cell as `key(q, r)`
}
```

`layout` is the `Map<plotId, Array<{q, r}>>` that `allocateCells` returns. `options` is `{ ship, anchored }`: `ship` is the depot cell (`{ q: -2, r: 1 }`), `anchored` a `Set<string>` of cell keys belonging to visiting colonies' districts, which the ring must skip.

**Do not create `src/world/hex-cells.js`.** An earlier sketch of this plan extracted the hex helpers into a new three.js-free module so `streets.js` could stay testable. That extraction is unnecessary — `plots.js` is already importable under `node --test` — and it would have touched `plots.js` far more than the spec sanctions.

- [ ] **Step 1: Write the failing test**

Create `test/streets.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planStreets } from '../src/world/streets.js'

const SHIP = { q: -2, r: 1 }
const k = (c) => `${c.q},${c.r}`
const opts = (anchored = []) => ({ ship: SHIP, anchored: new Set(anchored) })

test('a one-cell colony gets a ring around it', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]]])
  const { ring, all } = planStreets(layout, opts())
  assert.ok(ring.length > 0, 'no ring was planned')
  for (const cell of ring) {
    assert.ok(all.has(k(cell)), 'a ring cell is missing from `all`')
  }
})

test('no street cell is ever a plot cell', () => {
  const layout = new Map([
    ['a', [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }]],
    ['b', [{ q: 2, r: -1 }, { q: 2, r: 0 }]],
  ])
  const { all } = planStreets(layout, opts())
  for (const cells of layout.values()) {
    for (const cell of cells) {
      assert.ok(!all.has(k(cell)), `street cell ${k(cell)} is also a plot cell`)
    }
  }
})

test('no street cell is an anchored district cell', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]]])
  // A ring-5 district, which is where `colonyAnchor` puts a visiting colony.
  const district = [{ q: 5, r: -5 }, { q: 5, r: -4 }]
  const { all } = planStreets(layout, opts(district.map(k)))
  for (const cell of district) {
    assert.ok(!all.has(k(cell)), `street cell ${k(cell)} belongs to a district`)
  }
})

test('the ring sits outside every home plot cell', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]]])
  const { ring } = planStreets(layout, opts())
  // Cube distance from the origin of the furthest plot cell is 2, so every ring cell
  // must be further out than that.
  const cube = (c) => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(-c.q - c.r))
  for (const cell of ring) {
    assert.ok(cube(cell) > 2, `ring cell ${k(cell)} is not outside the colony`)
  }
})

test('every spur is a chain of adjacent cells reaching the ring', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]]])
  const { ring, spurs } = planStreets(layout, opts())
  const onRing = new Set(ring.map(k))
  const spur = spurs.get('a')
  assert.ok(spur && spur.length > 0, 'the plot got no spur')
  for (let i = 1; i < spur.length; i++) {
    const a = spur[i - 1]
    const b = spur[i]
    const dq = b.q - a.q
    const dr = b.r - a.r
    const ds = -dq - dr
    const step = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
    assert.equal(step, 1, `spur step ${i} jumps ${step} cells`)
  }
  assert.ok(onRing.has(k(spur[spur.length - 1])), 'the spur does not end on the ring')
})

test('the depot always gets a spur', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]]])
  const { spurs } = planStreets(layout, opts())
  const spur = spurs.get('__ship__')
  assert.ok(spur && spur.length > 0, 'the depot got no spur')
})

test('a plot with no unclaimed neighbour gets no spur', () => {
  // `b` sits at the origin, walled in on all six sides by `a`. There is no free cell
  // adjacent to it, so no road can reach it — which is expected, not an error: the
  // vehicle drives the last stretch over the deck, exactly as it did before stage 4.
  const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
  const layout = new Map([
    ['b', [{ q: 0, r: 0 }]],
    ['a', HEX_DIRS.map(([dq, dr]) => ({ q: dq, r: dr }))],
  ])
  const { spurs } = planStreets(layout, opts())
  assert.ok(!spurs.has('b'), 'a walled-in plot was given a spur it cannot have')
})

test('planning is stable: the same layout gives the same streets', () => {
  const layout = new Map([
    ['a', [{ q: 0, r: 0 }, { q: 1, r: 0 }]],
    ['b', [{ q: -1, r: 0 }]],
  ])
  const first = planStreets(layout, opts())
  const second = planStreets(layout, opts())
  assert.deepEqual([...first.all].sort(), [...second.all].sort())
  assert.deepEqual(first.ring, second.ring)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/streets.test.mjs`
Expected: FAIL. `src/world/streets.js` does not exist.

- [ ] **Step 3: Export the four helpers from `plots.js`**

In `src/world/plots.js`, add the `export` keyword to these four existing declarations. Do not move them, rename them, or change a character of their bodies:

- line 63: `const HEX_DIRS = [` → `export const HEX_DIRS = [`
- line 78: `const key = (q, r) => ...` → `export const key = (q, r) => ...`
- line 117: `function hexRing(radius) {` → `export function hexRing(radius) {`
- line 149: `function hexDistance(a, b) {` → `export function hexDistance(a, b) {`

- [ ] **Step 4: Write `src/world/streets.js`**

```javascript
import { HEX_DIRS, hexDistance, hexRing, key } from './plots.js'

/**
 * Where the streets run — pure arithmetic over plain `{q, r}` cells.
 *
 * Streets are a **derived layer**. This function reads a layout that `allocateCells` has
 * already produced and never influences it, so the sticky placement persisted in
 * `data/colony.json` carries no risk from anything here. That is deliberate and it is the
 * most important safety property of the whole street design: a bug in this file can make
 * the roads wrong, and cannot make the colony rearrange itself.
 *
 * Streets take whole cells rather than threading between plots, because they cannot thread
 * between plots. Measured in the running colony: buildings sit on a slot ring at 4.37 from
 * a cell's centre and reach about 1.5 past it, the kerb is at 6.53, and existing ground
 * clutter occupies 4.00 to 6.35. So the clear band is 0.66 at its widest and 0.18 with the
 * clutter, against a car 0.61 wide and a road tile carrying two painted lanes.
 *
 * A street cell is **not** a cell paved over. A cell is 13.16 across — twenty-one car
 * widths — so a paved one would read as a plaza. The carriageway is 2.5 wide down the
 * middle and the rest is verge; that is `road-mesh.js`'s business, not this file's.
 */

/** The depot's spur is keyed under a name no repo can collide with. */
export const SHIP_SPUR = '__ship__'

const ORIGIN = { q: 0, r: 0 }

/** Cells adjacent to `cell`, in `HEX_DIRS` order. */
function neighbours(cell) {
  return HEX_DIRS.map(([dq, dr]) => ({ q: cell.q + dq, r: cell.r + dr }))
}

/**
 * Which cells nobody may build a street on: every plot cell, every anchored district cell,
 * and the depot's own cell.
 */
function claimedCells(layout, ship, anchored) {
  const claimed = new Set(anchored)
  for (const cells of layout.values()) {
    for (const cell of cells) claimed.add(key(cell.q, cell.r))
  }
  claimed.add(key(ship.q, ship.r))
  return claimed
}

/**
 * The radius the ring sits at: one past the furthest **home** plot cell.
 *
 * Anchored districts do not push it out. They sit at ring five by design, and the gap of
 * bare terrain between the colony and a neighbour's settlement is deliberate — a ring
 * dragged out to meet them would pave it. `anchored` is therefore excluded from this
 * measurement even though it is excluded from the ring's cells too.
 */
function ringRadius(layout, ship, anchored) {
  let furthest = hexDistance(ship, ORIGIN)
  for (const cells of layout.values()) {
    for (const cell of cells) {
      if (anchored.has(key(cell.q, cell.r))) continue
      furthest = Math.max(furthest, hexDistance(cell, ORIGIN))
    }
  }
  return furthest + 1
}

/**
 * The shortest chain of unclaimed cells from `from` to any cell in `targets`, `from`
 * excluded and the target included.
 *
 * Breadth-first, so the first chain found is a shortest one. Returns `null` when no chain
 * exists — which is a real and expected outcome, not a failure: a plot walled in by other
 * plots has no free neighbour to leave through.
 *
 * `limit` bounds the search so a pathological layout cannot walk the lattice forever. It is
 * generous: the ring is at most one cell beyond the furthest plot, so a spur never needs
 * more than a handful of steps.
 */
function shortestChain(from, targets, blocked, limit) {
  if (targets.has(key(from.q, from.r))) return []
  const seen = new Set([key(from.q, from.r)])
  const queue = [{ cell: from, path: [] }]
  while (queue.length) {
    const { cell, path } = queue.shift()
    if (path.length >= limit) continue
    for (const next of neighbours(cell)) {
      const k = key(next.q, next.r)
      if (seen.has(k)) continue
      seen.add(k)
      const chain = [...path, next]
      if (targets.has(k)) return chain
      // Only unclaimed ground may be walked through. A target is reachable *onto* but
      // never *through*, which is why the target check comes first.
      if (blocked.has(k)) continue
      queue.push({ cell: next, path: chain })
    }
  }
  return null
}

/**
 * Plan the streets for one colony layout.
 *
 * @param layout the `Map<plotId, Array<{q, r}>>` that `allocateCells` returned
 * @param options `{ ship, anchored }` — the depot cell, and the cell keys of every visiting
 *   colony's district
 * @returns `{ ring, spurs, all }`. `spurs` has no entry for a plot that cannot be reached
 *   by road; the caller falls back to driving over the deck for those, exactly as stage 2
 *   did for every plot.
 */
export function planStreets(layout, { ship, anchored = new Set() }) {
  const claimed = claimedCells(layout, ship, anchored)
  const radius = ringRadius(layout, ship, anchored)

  const ring = hexRing(radius).filter((cell) => !claimed.has(key(cell.q, cell.r)))
  const all = new Set(ring.map((cell) => key(cell.q, cell.r)))
  const onRing = new Set(all)

  const spurs = new Map()
  // A spur may not run through another plot, another district, or the depot — but it may
  // run through a cell an earlier spur already claimed, which is how two neighbouring
  // plots come to share an approach instead of laying two roads side by side.
  const SPUR_LIMIT = radius * 2 + 2

  const roots = [
    ...[...layout.entries()].map(([id, cells]) => ({ id, from: cells[0] })),
    { id: SHIP_SPUR, from: ship },
  ]
  for (const { id, from } of roots) {
    if (!from) continue
    const chain = shortestChain(from, onRing, claimed, SPUR_LIMIT)
    if (!chain || !chain.length) continue
    spurs.set(id, chain)
    for (const cell of chain) all.add(key(cell.q, cell.r))
  }

  return { ring, spurs, all }
}
```

- [ ] **Step 5: Run the test**

Run: `node --test test/streets.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 6: Run the whole suite and build**

Run: `npm test`
Expected: **169 passing, 0 failing** (161 + 8).

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty output.

- [ ] **Step 7: Commit**

```bash
git add src/world/streets.js src/world/plots.js test/streets.test.mjs
git commit -m "feat: plan a ring road and a spur per plot, as a derived layer"
```

---

### Task 3: street cells must be passable in `isConnected`

`isConnected` decides whether the remembered layout is still usable. It already treats the depot's cell as a stepping stone that need not be reached but may be crossed. Street cells need exactly the same treatment: without it, a colony that a ring road runs through is judged disconnected, `allocateCells` throws away the remembered layout, and every plot re-seeds from the middle **on every poll**.

**Files:**
- Modify: `src/world/plots.js` — `isConnected` (line 194) and `allocateCells` (line 224)
- Test: `test/streets.test.mjs` (extend)

**Interfaces:**
- Consumes: `planStreets` from Task 2 (used only by the test here).
- Produces: `allocateCells(projects, previous, streets)` — a third parameter, a `Set<string>` of street cell keys, defaulting to an empty set. Existing two-argument callers keep working unchanged; `test/shared-colonies.test.mjs` calls it with two and must stay green.

- [ ] **Step 1: Write the failing test**

Append to `test/streets.test.mjs`:

```javascript
import { allocateCells } from '../src/world/plots.js'

test('a colony whose plots are separated by street cells is still connected', () => {
  // Two plots two cells apart, with the cell between them a street. Without street
  // passability this layout is judged disconnected and re-seeded from the middle on
  // every poll — the exact upheaval `allocateCells` exists to prevent.
  const previous = new Map([
    ['a', [{ q: -2, r: 0 }]],
    ['b', [{ q: 2, r: 0 }]],
  ])
  const projects = [
    { id: 'a', size: 1 },
    { id: 'b', size: 1 },
  ]
  const streets = new Set(['-1,0', '0,0', '1,0'])
  const out = allocateCells(projects, previous, streets)
  assert.deepEqual(out.get('a'), [{ q: -2, r: 0 }], 'plot a moved')
  assert.deepEqual(out.get('b'), [{ q: 2, r: 0 }], 'plot b moved')
})

test('a genuinely scattered colony is still re-seeded', () => {
  // No street connects these, so the memory really does describe a broken map and
  // starting over is correct. The guard must not become a rubber stamp.
  const previous = new Map([
    ['a', [{ q: -4, r: 0 }]],
    ['b', [{ q: 4, r: 0 }]],
  ])
  const projects = [
    { id: 'a', size: 1 },
    { id: 'b', size: 1 },
  ]
  const out = allocateCells(projects, previous, new Set())
  const moved =
    JSON.stringify(out.get('a')) !== JSON.stringify([{ q: -4, r: 0 }]) ||
    JSON.stringify(out.get('b')) !== JSON.stringify([{ q: 4, r: 0 }])
  assert.ok(moved, 'a scattered colony was allowed to keep its broken layout')
})

test('street cells are never handed out as plot cells', () => {
  const streets = new Set(['0,0', '1,0'])
  const out = allocateCells([{ id: 'a', size: 1 }], new Map(), streets)
  for (const cell of out.get('a')) {
    assert.ok(!streets.has(`${cell.q},${cell.r}`), `plot took street cell ${cell.q},${cell.r}`)
  }
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/streets.test.mjs`
Expected: FAIL on the first and third new tests. `allocateCells` ignores its third argument, so the separated plots re-seed and a plot may claim a street cell.

- [ ] **Step 3: Make street cells passable and unclaimable**

In `src/world/plots.js`, change `isConnected`'s signature and its passable set. The existing signature is `function isConnected(out, anchored = new Set())`; make it:

```javascript
function isConnected(out, anchored = new Set(), streets = new Set()) {
```

and change the line that builds `passable`:

```javascript
  const ship = key(SHIP_CELL.q, SHIP_CELL.r)
  // Street cells are stepping stones on exactly the same footing as the ship's cell: they
  // may be crossed and need not be reached. A ring road runs *through* the colony, so
  // without this a colony the road divides is judged broken and every plot re-seeds from
  // the middle on every poll — which is the upheaval `allocateCells` exists to prevent,
  // arriving by the back door.
  const passable = new Set([...cells.keys(), ship, ...streets])
```

and, immediately before the existing `seen.delete(ship)`:

```javascript
  // Same reasoning as the ship: a stepping stone is not a member.
  for (const street of streets) seen.delete(street)
```

Then thread the parameter through `allocateCells`:

```javascript
export function allocateCells(projects, previous = new Map(), streets = new Set()) {
  const anchored = new Set(projects.filter((p) => p.anchor).map((p) => p.id))
  const laid = layOut(projects, previous, streets)
  // ... unchanged comment ...
  return isConnected(laid, anchored, streets) ? laid : layOut(projects, new Map(), streets)
}
```

and have `layOut` refuse to hand out a street cell. Its signature becomes
`function layOut(projects, previous, streets = new Set())`, and inside the pool loop the
existing skip gains one clause:

```javascript
      const k = key(cell.q, cell.r)
      // The ship's cell and every street cell are off the market. A street cell in `free`
      // would be handed to a plot, and the road would then run through a zone.
      if (k === reserved || streets.has(k)) continue
```

- [ ] **Step 4: Run the test**

Run: `node --test test/streets.test.mjs`
Expected: PASS, 11 tests.

- [ ] **Step 5: Run the whole suite and build**

Run: `npm test`
Expected: **172 passing, 0 failing** (169 + 3). `test/shared-colonies.test.mjs` must still pass unchanged — it calls `allocateCells` with two arguments and the third defaults to an empty set, which is exactly the old behaviour.

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty output.

- [ ] **Step 6: Commit**

```bash
git add src/world/plots.js test/streets.test.mjs
git commit -m "fix: a colony a ring road divides is still one colony"
```

---

### Task 4: routing over the streets

Compose a route that follows street cells, and swap it into `colony.js`'s `_routeFor` **without touching the kerb arithmetic**. Stage 2's kerb behaviour was verified by hand over 600 frames and is a binding requirement of the spec; the safest way to honour that is to replace only the cell sequence and leave every line after it alone.

**Files:**
- Create: `src/world/road-path.js`
- Modify: `src/game/colony.js` — `_routeFor` (line 1110), and the layout call at line 441
- Test: `test/road-path.test.mjs` (create)

**Interfaces:**
- Consumes: `hexLine` from `src/world/drive-path.js`; `HEX_DIRS`, `key` from `src/world/plots.js`; `planStreets`, `SHIP_SPUR` from `src/world/streets.js`.
- Produces:

```javascript
roadCells(from, to, streets) -> Array<{q, r}>
```

`from` and `to` are cells, `streets` the `Set<string>` of street cell keys from `planStreets(...).all`. Returns a chain of adjacent cells from `from` to `to` inclusive, preferring street cells. Falls back to `hexLine(from, to)` when no road connection exists.

- [ ] **Step 1: Write the failing test**

Create `test/road-path.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roadCells } from '../src/world/road-path.js'

const k = (c) => `${c.q},${c.r}`

/** Cube step between two axial cells. 1 means adjacent. */
function step(a, b) {
  const dq = b.q - a.q
  const dr = b.r - a.r
  const ds = -dq - dr
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
}

function assertAdjacent(cells) {
  for (let i = 1; i < cells.length; i++) {
    assert.equal(step(cells[i - 1], cells[i]), 1, `step ${i} jumps ${step(cells[i - 1], cells[i])} cells`)
  }
}

test('a route to the same cell is one cell', () => {
  assert.deepEqual(roadCells({ q: 0, r: 0 }, { q: 0, r: 0 }, new Set()), [{ q: 0, r: 0 }])
})

test('with no streets at all it is exactly the old hex line', () => {
  // The fallback is documented behaviour, not a defect: this is stage 2's route.
  const road = roadCells({ q: -2, r: 1 }, { q: 3, r: -1 }, new Set())
  assertAdjacent(road)
  assert.deepEqual(road[0], { q: -2, r: 1 })
  assert.deepEqual(road[road.length - 1], { q: 3, r: -1 })
})

test('every step of a road route is adjacent to the last', () => {
  const streets = new Set(['0,0', '1,0', '2,0', '3,0'])
  const road = roadCells({ q: -1, r: 0 }, { q: 4, r: 0 }, streets)
  assertAdjacent(road)
})

test('a route starts at its origin and ends at its destination', () => {
  const streets = new Set(['0,0', '1,0', '2,0'])
  const road = roadCells({ q: -1, r: 0 }, { q: 3, r: 0 }, streets)
  assert.deepEqual(road[0], { q: -1, r: 0 })
  assert.deepEqual(road[road.length - 1], { q: 3, r: 0 })
})

test('the route uses the road rather than cutting across', () => {
  // The straight line from (0,-2) to (0,2) runs through (0,-1), (0,0), (0,1). Those are
  // not street cells; the dog-leg through q=1 is. A road route must prefer the road even
  // though it is longer, which is the entire point of the stage.
  const streets = new Set(['1,-2', '1,-1', '1,0', '1,1', '1,2'])
  const road = roadCells({ q: 0, r: -2 }, { q: 0, r: 2 }, streets)
  assertAdjacent(road)
  const used = road.filter((c) => streets.has(k(c))).length
  assert.ok(used >= 3, `only ${used} street cells used out of a ${road.length}-cell route`)
})

test('an unreachable destination falls back to a straight line rather than failing', () => {
  const streets = new Set(['9,0', '9,1'])
  const road = roadCells({ q: 0, r: 0 }, { q: 2, r: 0 }, streets)
  assertAdjacent(road)
  assert.deepEqual(road[road.length - 1], { q: 2, r: 0 })
})

test('routing is deterministic', () => {
  const streets = new Set(['0,0', '1,0', '1,-1'])
  const a = roadCells({ q: -1, r: 0 }, { q: 2, r: -1 }, streets)
  const b = roadCells({ q: -1, r: 0 }, { q: 2, r: -1 }, streets)
  assert.deepEqual(a, b)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/road-path.test.mjs`
Expected: FAIL. `src/world/road-path.js` does not exist.

- [ ] **Step 3: Write `src/world/road-path.js`**

```javascript
import { HEX_DIRS, key } from './plots.js'
import { hexLine } from './drive-path.js'

/**
 * Composing a route that follows the streets — pure arithmetic, no three.js and no colony
 * state, for the same reason `drive-path.js` is: this is the part where an off-by-one shows
 * up as a car driving through a house rather than as an error.
 *
 * The search is a uniform-cost walk over the lattice where a street cell costs one step and
 * anything else costs `OFF_ROAD_COST`. That single number is the whole of the routing
 * policy: high enough that a route will take a long way round rather than cut across three
 * gardens, low enough that a plot with no road still gets driven to.
 *
 * The fallback is documented behaviour, not a defect. "Roads steer everything" means roads
 * steer wherever roads exist; where they do not, the car drives over the deck exactly as it
 * did for every plot before this stage, which is behaviour that was verified by hand over
 * 600 frames and is deliberately left reachable.
 */

/**
 * What one cell of driving off the road costs, in units of one cell of driving on it.
 *
 * Six was picked so that crossing a single cell of open ground is worse than going five
 * cells round on tarmac but better than going seven. Anything below about three and the
 * router shortcuts across gardens whenever the road bends; anything above about twenty and
 * a route to a plot with a short spur takes a comical tour of the ring first.
 */
export const OFF_ROAD_COST = 6

function neighbours(cell) {
  return HEX_DIRS.map(([dq, dr]) => ({ q: cell.q + dq, r: cell.r + dr }))
}

/**
 * How far the search may stray from the straight line between the endpoints.
 *
 * Without a bound this walks the infinite lattice. The straight-line distance plus this
 * margin is always enough to reach the ring and come back, because the ring is at most one
 * cell beyond the furthest plot.
 */
const DETOUR_MARGIN = 8

function cubeDistance(a, b) {
  const as = -a.q - a.r
  const bs = -b.q - b.r
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(as - bs))
}

/**
 * Every cell from `from` to `to` inclusive, each adjacent to the one before it, preferring
 * street cells.
 *
 * @param from origin cell
 * @param to destination cell
 * @param streets the street cell keys, as `planStreets(...).all` returns them
 */
export function roadCells(from, to, streets) {
  if (from.q === to.q && from.r === to.r) return [{ q: from.q, r: from.r }]
  if (!streets || streets.size === 0) return hexLine(from.q, from.r, to.q, to.r)

  const budget = cubeDistance(from, to) + DETOUR_MARGIN
  const startKey = key(from.q, from.r)
  const goalKey = key(to.q, to.r)

  // Dijkstra with a sorted frontier. The lattice reachable inside `budget` is small — a few
  // hundred cells at the colony sizes this runs at — so a plain array beats a heap in both
  // code and constant factor, and `_routeFor` caches the result per house anyway.
  const cost = new Map([[startKey, 0]])
  const cameFrom = new Map()
  const frontier = [{ cell: from, cost: 0 }]

  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost)
    const { cell, cost: spent } = frontier.shift()
    const here = key(cell.q, cell.r)
    if (here === goalKey) break
    if (spent > (cost.get(here) ?? Infinity)) continue

    for (const next of neighbours(cell)) {
      if (cubeDistance(next, to) > budget) continue
      const k = key(next.q, next.r)
      // The destination is always enterable whatever it is standing on, and the origin is
      // where we started; everything else pays road or off-road.
      const stepCost = k === goalKey || streets.has(k) ? 1 : OFF_ROAD_COST
      const total = spent + stepCost
      if (total >= (cost.get(k) ?? Infinity)) continue
      cost.set(k, total)
      cameFrom.set(k, cell)
      frontier.push({ cell: next, cost: total })
    }
  }

  if (!cameFrom.has(goalKey)) return hexLine(from.q, from.r, to.q, to.r)

  const out = [{ q: to.q, r: to.r }]
  let cursor = to
  while (key(cursor.q, cursor.r) !== startKey) {
    cursor = cameFrom.get(key(cursor.q, cursor.r))
    if (!cursor) return hexLine(from.q, from.r, to.q, to.r)
    out.push({ q: cursor.q, r: cursor.r })
  }
  out.reverse()
  return out
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/road-path.test.mjs`
Expected: PASS, 7 tests.

- [ ] **Step 5: Plan the streets in `colony.js` and use them for routing**

Two edits in `src/game/colony.js`.

First, at line 441, where the layout is allocated. The existing call is
`const layout = allocateCells(` — plan the streets from the layout and hold them on the
colony, then re-allocate with them so no plot sits on a street:

```javascript
    // Streets are planned from the layout, then fed back in so no plot sits on one. Two
    // passes rather than one because the ring's radius depends on where the plots ended up:
    // the first pass says how far the colony reaches, the second keeps the plots off the
    // road it implies. A third pass would be chasing its own tail — the ring can only move
    // outward between the two, never inward, so the second pass is stable.
    const firstPass = allocateCells(projects, previous)
    this.streets = planStreets(firstPass, { ship: SHIP_CELL_FOR_STREETS, anchored })
    const layout = allocateCells(projects, previous, this.streets.all)
```

`SHIP_CELL_FOR_STREETS` is `worldToHex(shipPosition().x, shipPosition().z)`, computed once
at module scope: `SHIP_CELL` itself is module-local to `plots.js` and is not exported, and
converting the depot's world position back to a cell gives the same answer without opening
another export. `anchored` is the set of cell keys of every project carrying an `anchor`,
which this method already has to hand.

Add to the imports at the top of `colony.js`:

```javascript
import { planStreets } from '../world/streets.js'
import { roadCells } from '../world/road-path.js'
```

Second, in `_routeFor` (line 1110), replace **only** the line that builds `points`:

```javascript
    const points = hexLine(start.q, start.r, end.q, end.r).map((c) => cellWorld(c.q, c.r))
```

with:

```javascript
    // The cell sequence is the only thing the streets change. Everything below — the kerb
    // pull-back, the cache key, the route object — is stage 2's, verified by hand over 600
    // frames, and is deliberately left alone.
    const points = roadCells(start, end, this.streets?.all).map((c) => cellWorld(c.q, c.r))
```

Leave the `hexLine` import in place: `road-path.js` uses it for the fallback, and removing
it from `colony.js` is a separate change with no benefit.

The route cache is keyed on the plot, the slot and the house's position. A street plan can
change without any of those changing, so add the street plan's identity to the cache key.
In `_routeFor`, extend the cached-route guard with one more clause:

```javascript
      cached.streets === this._streetStamp &&
```

and set `this._streetStamp` immediately after `this.streets` is assigned in the layout
method:

```javascript
    // A route cached before the ring moved would drive the old road. Stamping the plan and
    // comparing it is cheaper than diffing two cell sets on every house on every frame.
    this._streetStamp = [...this.streets.all].sort().join('|')
```

and record it on the route object where it is built:

```javascript
    const route = { plot: entry.plot, slot: entry.slot, x: p.x, z: p.z, streets: this._streetStamp, points, length: pathLength(points) }
```

- [ ] **Step 6: Run the whole suite and build**

Run: `npm test`
Expected: **179 passing, 0 failing** (172 + 7).

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty output.

- [ ] **Step 7: Verify the drive by hand, not through the browser pane**

Start the dev server on port 5280 and open `http://127.0.0.1:5280/` in a real browser.
**Bind to IPv4 explicitly** — the default binding is IPv6-only in this environment, so
`127.0.0.1:5280` refuses the connection and only `[::1]:5280` answers:

```bash
npx vite --host 127.0.0.1 --port 5280 --strictPort
```

In the browser console, drive the real per-frame path by hand and then sample. The Browser
pane does not tick `requestAnimationFrame`, so nothing animated can be sampled by waiting:

```javascript
const c = window.botCrossing.colony, e = window.botCrossing.engine
let t = e.elapsed
for (let i = 0; i < 600; i++) { t += 1/60; for (const u of e.updaters) u(1/60, t) }
;[...c.buildings.values()].map(b => ({ driven: +b.driven.toFixed(2), len: +b.route.length.toFixed(2) }))
```

Expected: every active thread's car has `driven` equal to its `route.length` — it arrived
exactly, not approximately — and no car sits at a value between 0 and its length forever.
Record the numbers in the task report.

Then stop the server and prove the port is free:

```bash
netstat -ano | grep ":5280 "
```

Expected: no `LISTENING` line.

- [ ] **Step 8: Commit**

```bash
git add src/world/road-path.js src/game/colony.js test/road-path.test.mjs
git commit -m "feat: delivery vehicles follow the streets, and drive over the deck where there are none"
```

---

### Task 5: the street surface

Draw the streets. One merged mesh from the city atlas, plus its city-atlas furniture.

**Files:**
- Create: `src/world/road-mesh.js`
- Modify: `src/game/colony.js` — build and dispose the road mesh alongside the plots
- Test: `test/road-mesh.test.mjs` (create)

**Interfaces:**
- Consumes: `planStreets(...)` output from Task 2, held on the colony as `this.streets`. `Composer`, `part`, `hasPart` from `src/world/kit.js`; `cellWorld`, `DECK_TOP` from `src/world/plots.js`.
- Produces:

```javascript
carriagewayPoints(cells, radius) -> Array<{x, z, kind}>   // pure, testable
createRoads({ streets, groundAt }) -> THREE.Group          // publishes userData.dispose()
```

`kind` is `'straight'` or `'junction'`. `createRoads` must publish `userData.dispose()`: a
`THREE.Group` returned to `colony.js` with no `dispose` is exactly the defect stage 1
shipped, where every archived thread leaked its meshes at 144Hz.

- [ ] **Step 1: Write the failing test**

Create `test/road-mesh.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CARRIAGEWAY_WIDTH, ROAD_TILE_SIZE, carriagewayPoints, roadTileScale } from '../src/world/road-mesh.js'

test('the carriageway is 2.5 wide', () => {
  // The spec's number, and the reason streets take whole cells: a cell is 13.16 across,
  // so a paved one would read as a plaza rather than a street.
  assert.equal(CARRIAGEWAY_WIDTH, 2.5)
})

test('the tile scale brings a 2 x 2 tile to the carriageway width', () => {
  assert.equal(ROAD_TILE_SIZE, 2)
  assert.equal(roadTileScale(), CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE)
  assert.equal(roadTileScale(), 1.25)
})

test('a single street cell lays one patch of carriageway', () => {
  const points = carriagewayPoints([{ q: 0, r: 0 }], 1)
  assert.ok(points.length >= 1)
  for (const p of points) {
    assert.equal(typeof p.x, 'number')
    assert.equal(typeof p.z, 'number')
    assert.ok(p.kind === 'straight' || p.kind === 'junction')
  }
})

test('a bend gets a junction patch, because no piece in the pack turns 120 degrees', () => {
  // A path along the hex lattice turns in multiples of 60 degrees and every corner piece
  // in the kit turns 90. There is no combination that makes a correct 120 degree bend, so
  // a four-armed junction tile is dropped at the bend and the two straights run into it.
  // This is a visible compromise and the test exists to keep it deliberate.
  const bend = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 1, r: 1 }]
  const points = carriagewayPoints(bend, 1)
  assert.ok(points.some((p) => p.kind === 'junction'), 'a bend laid no junction patch')
})

test('a straight run lays no junction patches', () => {
  const straight = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]
  const points = carriagewayPoints(straight, 1)
  assert.ok(!points.some((p) => p.kind === 'junction'), 'a straight run laid a junction')
})

test('no two patches land on the same spot', () => {
  const cells = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: 1 }]
  const points = carriagewayPoints(cells, 1)
  const seen = new Set(points.map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`))
  assert.equal(seen.size, points.length, 'two road patches were laid on the same spot')
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/road-mesh.test.mjs`
Expected: FAIL. `src/world/road-mesh.js` does not exist.

- [ ] **Step 3: Write the pure half of `src/world/road-mesh.js`**

The module has two halves. The pure half — the constants and `carriagewayPoints` — must
come first in the file and must not touch three.js, so `node --test` can import it. The
three.js half (`createRoads`) sits below it.

```javascript
import * as THREE from 'three'
import { Composer, hasPart, part } from './kit.js'
import { DECK_TOP, cellWorld } from './plots.js'

/**
 * The street surface: a carriageway down the middle of each street cell, and the kit's own
 * furniture along the verge.
 *
 * A street cell is not a paved cell. A hex cell is 13.16 across — twenty-one car widths —
 * so paving one would read as a plaza. The carriageway is 2.5 wide and the rest is verge.
 *
 * **The 120 degree problem, stated plainly.** A path along the hex lattice turns in
 * multiples of 60 degrees. Every corner piece in the kit turns 90. There is no combination
 * of the six road pieces that makes a correct 120 degree bend, so at each bend this lays a
 * `road_junction` as a patch of carriageway and lets the two straights run into it. A
 * four-armed tile sits where two arms meet and the extra arms read as short stubs. That is
 * a visible compromise, it is not fixable with the parts in the pack, and no comment in
 * this file claims the markings line up. At the colony's resting camera distance of about
 * 36 units the stubs are a few pixels; that is the whole of the mitigation.
 */

/** Every road piece in the kit is a 2 x 2 square tile, 0.1 thick, centred on the origin. */
export const ROAD_TILE_SIZE = 2

/** How wide the driving surface is. The spec's number; a car is 0.61 wide. */
export const CARRIAGEWAY_WIDTH = 2.5

/** What a kit road tile has to be scaled by to become one carriageway width. */
export const roadTileScale = () => CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE

/** How many tiles are laid along one cell-to-cell hop. */
const TILES_PER_HOP = Math.ceil((7.6 * Math.sqrt(3)) / CARRIAGEWAY_WIDTH)

/**
 * Where each patch of carriageway goes, and what kind it is.
 *
 * Pure: plain numbers in, plain numbers out, so the geometry decisions are testable without
 * a renderer. `radius` is the hex size, passed in rather than imported so a test can use 1
 * and read the arithmetic directly.
 *
 * @param cells the street cells, in the order the road runs through them
 * @param radius hex size, centre to corner
 * @returns one entry per patch: `{ x, z, kind }`, `kind` being `'straight'` or `'junction'`
 */
export function carriagewayPoints(cells, radius) {
  const world = cells.map((c) => {
    const w = { x: radius * 1.5 * c.q, z: radius * Math.sqrt(3) * (c.r + c.q / 2) }
    return w
  })
  if (world.length === 1) return [{ x: world[0].x, z: world[0].z, kind: 'junction' }]

  const out = []
  const placed = new Set()
  const push = (x, z, kind) => {
    const k = `${x.toFixed(4)},${z.toFixed(4)}`
    if (placed.has(k)) return
    placed.add(k)
    out.push({ x, z, kind })
  }

  for (let i = 1; i < world.length; i++) {
    const a = world[i - 1]
    const b = world[i]
    for (let t = 0; t < TILES_PER_HOP; t++) {
      const f = t / TILES_PER_HOP
      push(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, 'straight')
    }
  }
  // The last cell centre, which no hop's loop reaches because each stops short of its end.
  const last = world[world.length - 1]
  push(last.x, last.z, 'straight')

  // Bends. A cell whose incoming and outgoing directions differ is a bend, and a bend gets
  // a junction patch on its centre, replacing whatever straight was laid there.
  for (let i = 1; i < world.length - 1; i++) {
    const prev = cells[i - 1]
    const here = cells[i]
    const next = cells[i + 1]
    const inDir = { q: here.q - prev.q, r: here.r - prev.r }
    const outDir = { q: next.q - here.q, r: next.r - here.r }
    if (inDir.q === outDir.q && inDir.r === outDir.r) continue
    const w = world[i]
    const k = `${w.x.toFixed(4)},${w.z.toFixed(4)}`
    const existing = out.find((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}` === k)
    if (existing) existing.kind = 'junction'
    else push(w.x, w.z, 'junction')
  }

  return out
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/road-mesh.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the rendering half**

Append to `src/world/road-mesh.js`:

```javascript
/** The pieces this module draws, all from the city atlas. */
const STRAIGHT_PART = 'road_straight'
const JUNCTION_PART = 'road_junction'
const LAMP_PART = 'streetlight'

/**
 * Build the street surface for one street plan.
 *
 * One merged geometry for the carriageway and one for the lamps, so the whole street
 * network is two draw calls however large the colony grows. Merging is what the city
 * atlas is for: every piece in the kit UVs into a single 1024px gradient atlas, which is
 * the only reason a whole street can collapse into one mesh.
 *
 * Verge planting is **not** here. Trees, bushes and grasses live in `forest.glb`, a
 * different atlas, and a merged geometry carries one material — so they cannot join these
 * meshes. The verge reuses the existing scatter system instead.
 *
 * @param streets the `planStreets` result
 * @param groundAt `(x, z) => y`, the colony's own terrain sampler
 * @returns a `THREE.Group` publishing `userData.dispose()`
 */
export function createRoads({ streets, groundAt }) {
  const group = new THREE.Group()
  group.userData.dispose = () => {}
  if (!streets || !hasPart(STRAIGHT_PART) || !hasPart(JUNCTION_PART)) return group

  const runs = [streets.ring, ...streets.spurs.values()].filter((run) => run && run.length)
  if (!runs.length) return group

  const scale = roadTileScale()
  const straights = new Composer({ kit: 'city' })
  const junctions = new Composer({ kit: 'city' })
  let straightCount = 0
  let junctionCount = 0

  for (const run of runs) {
    for (const patch of carriagewayPoints(run, 7.6)) {
      const composer = patch.kind === 'junction' ? junctions : straights
      const name = patch.kind === 'junction' ? JUNCTION_PART : STRAIGHT_PART
      composer.add(name, { s: scale, x: patch.x, y: DECK_TOP, z: patch.z })
      if (patch.kind === 'junction') junctionCount++
      else straightCount++
    }
  }

  const meshes = []
  if (straightCount) meshes.push(new THREE.Mesh(straights.finish(), roadMaterial()))
  if (junctionCount) meshes.push(new THREE.Mesh(junctions.finish(), roadMaterial()))

  if (hasPart(LAMP_PART)) {
    const lamps = new Composer({ kit: 'city' })
    let lampCount = 0
    // One lamp every fourth patch along the ring, on the verge rather than the carriageway:
    // half a carriageway plus a little, out from the centre line.
    const offset = CARRIAGEWAY_WIDTH * 0.5 + 0.6
    const ringPatches = carriagewayPoints(streets.ring, 7.6)
    for (let i = 0; i < ringPatches.length; i += 4) {
      const p = ringPatches[i]
      const y = groundAt ? Math.max(DECK_TOP, groundAt(p.x + offset, p.z)) : DECK_TOP
      lamps.add(LAMP_PART, { s: 1.6, x: p.x + offset, y, z: p.z })
      lampCount++
    }
    if (lampCount) meshes.push(new THREE.Mesh(lamps.finish(), roadMaterial()))
  }

  for (const mesh of meshes) {
    mesh.receiveShadow = true
    mesh.castShadow = false
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

function roadMaterial() {
  return new THREE.MeshStandardMaterial({ roughness: 0.86, metalness: 0.02 })
}
```

**Before writing this step, read `src/world/houses.js`.** `createHouse` is the working
precedent for a kit-composed group with a `userData.dispose()`, and it is where the exact
`Composer` option names (`s`, `x`, `y`, `z`, `solo`) and the atlas material setup can be
copied from rather than guessed. If the option names in `houses.js` differ from those used
above, **`houses.js` is right and this plan is wrong** — follow the code.

- [ ] **Step 6: Wire it into `colony.js`**

Wherever the plots' group is built, build the roads beside it and dispose the old one first.
Follow the pattern already used for `this.scatterGroup`. Add the import:

```javascript
import { createRoads } from '../world/road-mesh.js'
```

and, immediately after `this._streetStamp` is set:

```javascript
    // Streets are rebuilt whole rather than diffed. The plan only changes when the layout
    // does, which is a poll-rate event, and a whole street network is two draw calls.
    this.roadGroup?.userData.dispose?.()
    if (this.roadGroup) this.worldGroup.remove(this.roadGroup)
    this.roadGroup = createRoads({ streets: this.streets, groundAt: (x, z) => this.groundAt(x, z) })
    this.worldGroup.add(this.roadGroup)
```

and in `dispose()`, beside the other group teardowns:

```javascript
    this.roadGroup?.userData.dispose?.()
```

- [ ] **Step 7: Run the whole suite and build**

Run: `npm test`
Expected: **185 passing, 0 failing** (179 + 6).

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty output.

- [ ] **Step 8: Look at it, and prove the port is free afterwards**

Start the dev server bound to IPv4 (`npx vite --host 127.0.0.1 --port 5280 --strictPort`)
and open `http://127.0.0.1:5280/`. Confirm by eye: a road runs around the colony, the
carriageway is on the ground and not floating or buried, and the junction patches sit at the
bends. Take one screenshot for the report.

Then stop the server and run `netstat -ano | grep ":5280 "`, expecting no `LISTENING` line.

- [ ] **Step 9: Commit**

```bash
git add src/world/road-mesh.js src/game/colony.js test/road-mesh.test.mjs
git commit -m "feat: draw the streets, with a junction patch at every 120 degree bend"
```

---

### Task 6: the ambient traffic state machine

Pure. No three.js, no colony state, no rendering. This is the whole of the traffic
*behaviour*, and it is testable in isolation for exactly that reason.

**Files:**
- Create: `src/world/traffic.js`
- Test: `test/traffic.test.mjs` (create)

**Interfaces:**
- Consumes: nothing.
- Produces:

```javascript
trafficCount(activeThreads) -> number                    // 0..MAX_TRAFFIC
stepVehicle(vehicle, dt, routeLength, random) -> vehicle  // returns a new object
newVehicle(seed) -> vehicle
MAX_TRAFFIC, DWELL_MIN, DWELL_MAX, TRAFFIC_SPEED
```

A vehicle is `{ phase, driven, dwell, body, tint, addressSeed }`. `phase` is one of
`'out'`, `'waiting'`, `'back'`, `'parked'`.

- [ ] **Step 1: Write the failing test**

Create `test/traffic.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DWELL_MAX,
  DWELL_MIN,
  MAX_TRAFFIC,
  TRAFFIC_BODIES,
  newVehicle,
  stepVehicle,
  trafficCount,
} from '../src/world/traffic.js'

test('an idle colony has no traffic at all', () => {
  assert.equal(trafficCount(0), 0)
})

test('traffic never exceeds the cap', () => {
  for (const n of [1, 5, 20, 90, 500]) {
    assert.ok(trafficCount(n) <= MAX_TRAFFIC, `${n} active threads gave ${trafficCount(n)} vehicles`)
  }
  assert.equal(MAX_TRAFFIC, 8)
})

test('traffic is monotonic in the active-thread count', () => {
  let last = -1
  for (let n = 0; n <= 200; n++) {
    const count = trafficCount(n)
    assert.ok(count >= last, `${n} active threads gave ${count}, fewer than ${n - 1} gave ${last}`)
    last = count
  }
})

test('a vehicle walks its four phases in order', () => {
  const seen = []
  let v = newVehicle(1)
  const random = () => 0.5
  for (let i = 0; i < 4000; i++) {
    if (seen[seen.length - 1] !== v.phase) seen.push(v.phase)
    v = stepVehicle(v, 1 / 60, 20, random)
  }
  // It cycles, so trim to the first four transitions and check the order.
  const order = seen.slice(0, 5)
  assert.deepEqual(order.slice(0, 4), ['parked', 'out', 'waiting', 'back'])
})

test('a vehicle waits between DWELL_MIN and DWELL_MAX at its address', () => {
  assert.equal(DWELL_MIN, 4)
  assert.equal(DWELL_MAX, 12)
  // Drive it to the address, then count the seconds it stays put.
  let v = newVehicle(2)
  const random = () => 0
  while (v.phase !== 'waiting') v = stepVehicle(v, 1 / 60, 10, random)
  let waited = 0
  while (v.phase === 'waiting') {
    v = stepVehicle(v, 1 / 60, 10, random)
    waited += 1 / 60
  }
  assert.ok(waited >= DWELL_MIN - 0.05, `waited only ${waited.toFixed(2)}s`)
  assert.ok(waited <= DWELL_MAX + 0.05, `waited ${waited.toFixed(2)}s, over the maximum`)
})

test('a vehicle arrives exactly, not approximately', () => {
  // The stage 1 defect, in a new place: damping behind a threshold froze progress a
  // strictly positive distance short of its target, forever.
  let v = newVehicle(3)
  const random = () => 0.5
  const length = 17.5
  while (v.phase === 'parked' || v.phase === 'out') v = stepVehicle(v, 1 / 60, length, random)
  assert.equal(v.driven, length)
})

test('ambient bodies never include the delivery vehicle', () => {
  // The delivery signature is a stationwagon in a repo's accent colour with a load on its
  // roof, and it means "a thread is being worked on". Nothing ambient may borrow it.
  assert.ok(TRAFFIC_BODIES.length >= 3)
  assert.ok(!TRAFFIC_BODIES.includes('car_stationwagon'))
})

test('a vehicle is fully determined by its seed', () => {
  assert.deepEqual(newVehicle(7), newVehicle(7))
  assert.notDeepEqual(newVehicle(7), newVehicle(8))
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/traffic.test.mjs`
Expected: FAIL. `src/world/traffic.js` does not exist.

- [ ] **Step 3: Write `src/world/traffic.js`**

```javascript
/**
 * Ambient traffic: vehicles that no thread owns, driving out to an address, waiting there,
 * and coming back to the depot.
 *
 * Pure arithmetic and a four-state machine, with no three.js and no colony state, for the
 * same reason `drive-path.js` is: the failure modes here are a car frozen a hair short of
 * its destination and a car that never leaves, and both are invisible in a screenshot and
 * obvious in an assertion.
 *
 * **These vehicles mean nothing individually, and that is deliberate.** A stationwagon in a
 * repo's accent colour with a load on its roof means "a thread is being worked on" — the
 * signal stage 2 exists to carry. Nothing here may borrow that body, that colour source or
 * that roof load, which is why `TRAFFIC_BODIES` excludes the stationwagon and is asserted
 * to.
 *
 * The one thing ambient traffic does say is *how much* of it there is: the count scales with
 * how many threads are active, so a busy colony has busy streets. That is atmosphere carried
 * by the volume, never by a particular car, and it is the only place this design lets
 * traffic mean anything at all.
 */

/** The most vehicles that will ever be on the road at once. */
export const MAX_TRAFFIC = 8

/** How many active threads it takes to put one more vehicle on the road. */
const THREADS_PER_VEHICLE = 4

/** Seconds a vehicle stands at an address before heading back. */
export const DWELL_MIN = 4
export const DWELL_MAX = 12

/** World units per second. Slower than a delivery: ambient traffic should not draw the eye. */
export const TRAFFIC_SPEED = 2.4

/**
 * Bodies ambient traffic may wear. The stationwagon is absent on purpose — see the module
 * comment. The police car is last so the weighting below makes it the rare one.
 */
export const TRAFFIC_BODIES = Object.freeze(['car_hatchback', 'car_sedan', 'car_taxi', 'car_police'])

/** Neutral paint: greys, whites and blacks, and never a repo's accent. */
export const TRAFFIC_TINTS = Object.freeze([0xb8bcc0, 0x8e9398, 0xe8e9ea, 0x5a5f66, 0x2f3338])

/**
 * How many vehicles belong on the road for a given number of active threads.
 *
 * Zero when nothing is active, one per `THREADS_PER_VEHICLE` after that, capped. Monotonic
 * by construction, which the test asserts across the whole range rather than at three
 * sample points.
 */
export function trafficCount(activeThreads) {
  if (!(activeThreads > 0)) return 0
  return Math.min(MAX_TRAFFIC, Math.ceil(activeThreads / THREADS_PER_VEHICLE))
}

/**
 * A hash with a proper avalanche, so two vehicles seeded one apart do not come out looking
 * alike. `lowbias32`, the same finalizer the crew's hairstyles use — a plain multiply-xor
 * hash leaves the low bits correlated, which showed up in stage 3 as a hairstyle that
 * tracked skin tone.
 */
function lowbias32(x) {
  x |= 0
  x = (x ^ (x >>> 16)) >>> 0
  x = Math.imul(x, 0x7feb352d) >>> 0
  x = (x ^ (x >>> 15)) >>> 0
  x = Math.imul(x, 0x846ca68b) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

/**
 * A vehicle, fully determined by its seed so a reload puts the same cars on the road.
 *
 * Starts `parked`: a vehicle that began mid-journey would pop into being halfway down a
 * street the first frame the colony got busy.
 */
export function newVehicle(seed) {
  const h = lowbias32(seed)
  // The police car is the last body and gets a sixteenth of the draws rather than a
  // quarter, so it reads as a surprise rather than as a quarter of the traffic.
  const rare = (h >>> 28) === 0
  const body = rare
    ? TRAFFIC_BODIES[TRAFFIC_BODIES.length - 1]
    : TRAFFIC_BODIES[h % (TRAFFIC_BODIES.length - 1)]
  return {
    phase: 'parked',
    driven: 0,
    dwell: 0,
    body,
    tint: TRAFFIC_TINTS[lowbias32(seed + 1) % TRAFFIC_TINTS.length],
    addressSeed: lowbias32(seed + 2),
  }
}

/**
 * One frame of one vehicle. Returns a new object rather than mutating, so a caller cannot
 * accidentally share state between two vehicles.
 *
 * `routeLength` is the length of this vehicle's current route, and `random` a
 * zero-argument function returning [0, 1) — passed in rather than reaching for `Math.random`
 * so the dwell can be pinned in a test.
 *
 * Arrival is exact. `driven` lands on `routeLength` and on 0 rather than approaching them:
 * stage 1 shipped a defect where damping behind a threshold froze progress a strictly
 * positive distance short of its target forever, and the last piece of furniture in every
 * house was never drawn.
 */
export function stepVehicle(vehicle, dt, routeLength, random) {
  const step = TRAFFIC_SPEED * dt
  const next = { ...vehicle }

  if (next.phase === 'parked') {
    next.phase = 'out'
    next.driven = 0
    return next
  }

  if (next.phase === 'out') {
    next.driven = Math.min(routeLength, next.driven + step)
    if (next.driven >= routeLength) {
      next.driven = routeLength
      next.phase = 'waiting'
      next.dwell = DWELL_MIN + random() * (DWELL_MAX - DWELL_MIN)
    }
    return next
  }

  if (next.phase === 'waiting') {
    next.dwell -= dt
    if (next.dwell <= 0) {
      next.dwell = 0
      next.phase = 'back'
    }
    return next
  }

  // 'back'
  next.driven = Math.max(0, next.driven - step)
  if (next.driven <= 0) {
    next.driven = 0
    next.phase = 'parked'
    // A new address for the next run, so a vehicle does not shuttle to one house forever.
    next.addressSeed = lowbias32(next.addressSeed + 1)
  }
  return next
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/traffic.test.mjs`
Expected: PASS, 8 tests.

- [ ] **Step 5: Run the whole suite and build**

Run: `npm test`
Expected: **193 passing, 0 failing** (185 + 8).

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty output.

- [ ] **Step 6: Commit**

```bash
git add src/world/traffic.js test/traffic.test.mjs
git commit -m "feat: an ambient traffic state machine that no thread owns"
```

---

### Task 7: rendering the ambient traffic

**Files:**
- Create: `src/world/traffic-cars.js`
- Modify: `src/game/colony.js` — build, update and dispose the traffic
- Test: `test/traffic-cars.test.mjs` (create)

**Interfaces:**
- Consumes: `TRAFFIC_BODIES`, `TRAFFIC_TINTS`, `newVehicle`, `stepVehicle`, `trafficCount` from Task 6; `CAR_SCALE`, `WHEEL_RADIUS`, `wheelSpin` from `src/world/deliveries.js`; `roadCells` from Task 4; `pointAt`, `pathLength` from `src/world/drive-path.js`.
- Produces: `class TrafficCars { constructor(scene, capacity); update(vehicles); dispose() }`, where `vehicles` are `{ x, y, z, heading, distance, body, tint }`.

**`Deliveries` is not extended and not refactored.** `TrafficCars` duplicates roughly sixty
lines of its instancing. That is a deliberate trade: `Deliveries` carries the delivery
behaviour that three reviews and a 600-frame hand verification have signed off, and the cost
of a wrong generalisation there is higher than the cost of the duplication here. What *is*
shared is everything already exported and pure — `CAR_SCALE`, `WHEEL_RADIUS`, `wheelSpin`.
Note this choice in the task report so a reviewer weighs it rather than reporting it.

- [ ] **Step 1: Write the failing test**

Create `test/traffic-cars.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRAFFIC_BODIES, TRAFFIC_TINTS } from '../src/world/traffic.js'
import { bucketKey } from '../src/world/traffic-cars.js'

test('vehicles bucket by body and tint together', () => {
  // One instanced mesh per (body, tint) pair, the same way deliveries bucket per accent:
  // a geometry carries one material, so two paints cannot share one mesh.
  const a = bucketKey({ body: 'car_sedan', tint: 0xb8bcc0 })
  const b = bucketKey({ body: 'car_sedan', tint: 0x2f3338 })
  const c = bucketKey({ body: 'car_taxi', tint: 0xb8bcc0 })
  assert.notEqual(a, b, 'two tints shared a bucket')
  assert.notEqual(a, c, 'two bodies shared a bucket')
  assert.equal(a, bucketKey({ body: 'car_sedan', tint: 0xb8bcc0 }), 'bucketing is not stable')
})

test('the bucket count is bounded by the palette, not by the traffic', () => {
  // Every possible vehicle falls into one of these, so the mesh count cannot grow with
  // how long the app has been running.
  const keys = new Set()
  for (const body of TRAFFIC_BODIES) {
    for (const tint of TRAFFIC_TINTS) keys.add(bucketKey({ body, tint }))
  }
  assert.equal(keys.size, TRAFFIC_BODIES.length * TRAFFIC_TINTS.length)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/traffic-cars.test.mjs`
Expected: FAIL. `src/world/traffic-cars.js` does not exist.

- [ ] **Step 3: Write `src/world/traffic-cars.js`**

**Read `src/world/deliveries.js` first, in full.** It is the working precedent for
instancing a kit body with four separate wheels, and every detail this task needs — how
`Composer` is called with `solo`, how `readWheelOffsets` is used, how wheel spin is applied
as a quaternion about the X axis, why `frustumCulled` is false, and the lazy `loadKit()`
guard that lets the module be imported under `node --test` without a bundler — is already
solved there. Copy the shape; do not invent a second one.

The class must:

- Lazily create one `{ bodies, wheels }` instanced-mesh pair per `bucketKey(vehicle)`, capped
  at `TRAFFIC_BODIES.length * TRAFFIC_TINTS.length` pairs, which is 20.
- Carry **no load mesh**. The roof load is the delivery signature.
- Empty any pair that held vehicles on an earlier frame and none this frame, exactly as
  `Deliveries.update` does — a stale `count` leaves last frame's cars parked in the street.
- Export `bucketKey(vehicle)` as a pure function so the test above can reach it.
- Dispose every geometry and material it made in `dispose()`.

```javascript
/** One instanced-mesh pair per body-and-tint pair: a geometry carries one material. */
export const bucketKey = (vehicle) => `${vehicle.body}:${vehicle.tint}`
```

- [ ] **Step 4: Wire it into `colony.js`**

Construct it beside `this.deliveries`:

```javascript
    this.traffic = new TrafficCars(scene, MAX_TRAFFIC * 2)
    this._trafficVehicles = []
    this._trafficRoutes = new Map()
```

and add a `_updateTraffic(dt)` called from `update()` immediately after
`this._updateDeliveries(dt)`. It must:

1. Ask `trafficCount(this._activeThreadCount())` how many vehicles belong on the road, and
   grow or shrink `this._trafficVehicles` toward it with `newVehicle(seed)`. Use an
   ever-increasing seed counter so a vehicle removed and re-added is a different car.
2. For each vehicle, resolve its address: pick a house from `this.buildings` using
   `vehicle.addressSeed % size`, and build a route with
   `roadCells(shipCell, houseCell, this.streets?.all)` mapped through `cellWorld`. Cache
   these in `this._trafficRoutes` keyed on `addressSeed` plus `this._streetStamp`, for the
   same reason `_routeFor` caches: a route only changes when its destination or the streets
   do.
3. Step each vehicle with `stepVehicle(vehicle, dt, route.length, Math.random)`.
4. Map to `{ x, y, z, heading, distance, body, tint }` via `pointAt(route.points, driven)`
   and `this.groundAt(x, z)`, and hand the array to `this.traffic.update(...)`.

Shrinking the pool must drop vehicles from the end and delete their cached routes, or the
cache grows without bound over a long session.

In `dispose()`, beside `this.deliveries.dispose()`:

```javascript
    this.traffic.dispose()
```

- [ ] **Step 5: Run the whole suite and build**

Run: `npm test`
Expected: **195 passing, 0 failing** (193 + 2).

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty output.

- [ ] **Step 6: Verify the traffic by hand**

Start the dev server bound to IPv4 (`npx vite --host 127.0.0.1 --port 5280 --strictPort`),
open `http://127.0.0.1:5280/`, and in the console drive frames by hand — the Browser pane
does not tick `requestAnimationFrame`, so nothing animated can be sampled by waiting:

```javascript
const c = window.botCrossing.colony, e = window.botCrossing.engine
let t = e.elapsed
const phases = []
for (let i = 0; i < 3600; i++) {
  t += 1/60
  for (const u of e.updaters) u(1/60, t)
  if (i % 300 === 0) phases.push(c._trafficVehicles.map(v => v.phase).join(','))
}
phases
```

Expected: the phase strings change over time rather than being frozen, every vehicle reaches
`waiting` at least once inside the sixty seconds, and no vehicle stays in `out` for the whole
run. Record the output in the task report.

Also confirm no ambient vehicle carries a roof load and none is a stationwagon:

```javascript
new Set(window.botCrossing.colony._trafficVehicles.map(v => v.body))
```

Expected: a subset of `car_hatchback`, `car_sedan`, `car_taxi`, `car_police`.

Then stop the server and run `netstat -ano | grep ":5280 "`, expecting no `LISTENING` line.

- [ ] **Step 7: Commit**

```bash
git add src/world/traffic-cars.js src/game/colony.js test/traffic-cars.test.mjs
git commit -m "feat: ambient traffic on the streets, in neutral paint and never a stationwagon"
```

---

### Task 8: the documents

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-10-moving-in-streets-and-traffic-design.md`

**Interfaces:**
- Consumes: everything the previous seven tasks built.
- Produces: nothing code depends on.

**This is the task this repository fails.** Across stages 1 to 3, **every** Important review
finding — seven of them — was documentation asserting the opposite of the implementation, and
one fix round introduced a fresh false claim while correcting another. Treat every sentence
as a claim to be checked against the code, and check that nothing you *remove* was true.

- [ ] **Step 1: Grep for every claim this stage falsified**

```bash
grep -rn "scaffold\|Scaffolds\|astronaut\|spacesuit\|helmet\|visor\|five shades\|white" README.md docs/superpowers/specs/2026-09-09-moving-in-theme-design.md
grep -rn "hexLine\|straight line\|drives straight\|over the deck" README.md
```

For each hit, decide and record: still true, historical (past tense, describing a removal),
or false and to be fixed. A hit that describes what *used* to be there is fine; a hit in the
present tense that is no longer true is the defect.

- [ ] **Step 2: Add a "Streets and traffic" section to `README.md`**

Cover, in the README's own voice and level of detail:

- Streets take whole cells, and **why** — the measured 0.66 clear band against a 0.61-wide
  car and a two-lane tile.
- A street cell is a street *block*: a 2.5-wide carriageway and verge, not a paved cell.
- The ring-and-spur shape, and that a plot with no free neighbour gets no spur and is driven
  to over the deck.
- That ambient traffic means nothing individually, and that only its *volume* tracks the
  colony's activity.
- The 120° compromise, stated as a compromise. **Do not write that the markings line up.**

- [ ] **Step 3: Correct the workwear claims**

`README.md` and the stage 1-3 spec describe the crew's body. The five shades of white are
gone. Any present-tense sentence calling the body white, pale or a suit is now false. Fix
each, and add the reason the change mattered: every trim colour measures 0.09 to 0.41 in
luminance against white bodies at 0.77 to 0.91, so the hi-vis band was a dark smudge on a
white suit for three stages.

- [ ] **Step 4: Record the outcomes in this stage's spec**

Append a short "What actually happened" section to
`docs/superpowers/specs/2026-09-10-moving-in-streets-and-traffic-design.md`, covering:

- The final `SUIT_TONES` values and the two measured margins (worst sRGB distance 0.152,
  worst luminance ratio 1.18).
- `OFF_ROAD_COST` and why that number: crossing one cell of open ground is worse than going
  five cells round on tarmac and better than going seven.
- Anything a task's implementer ruled differently from this plan, and why.

- [ ] **Step 5: Run the whole suite and build**

Run: `npm test`
Expected: **195 passing, 0 failing**.

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty output.

- [ ] **Step 6: Confirm no document claims something the code does not do**

```bash
grep -rn "markings\|line up\|aligns\|correct 120\|two-lane" README.md docs/superpowers/specs/
```

Expected: no sentence claiming the road markings are correct at a bend.

- [ ] **Step 7: Commit**

```bash
git add README.md docs/superpowers/specs/
git commit -m "docs: describe the streets, the traffic and the workwear"
```

---

## Self-Review

Run against the spec, section by section.

**1. Spec coverage.**

| Spec section | Task |
| --- | --- |
| What the asset packs actually contain | Tasks 5, 6, 7 consume it; Task 8 records it |
| The geometry that constrains everything | Task 2's module comment; Task 8's README section |
| 1. `streets.js` — where the streets go | Task 2 |
| 2. `isConnected` must treat street cells as passable | Task 3 |
| 3. `road-mesh.js` — drawing the street surface, and the 120° problem | Task 5 |
| 4. `traffic.js` — ambient traffic | Tasks 6 and 7 |
| 5. Routing, and the two binding stage 2 behaviours | Task 4 |
| 6. Workwear | Task 1 |
| One material per geometry | Task 5 (verge stays on the scatter system) |
| Testing | Every task's own steps |
| Global constraints | The plan's Global Constraints section |
| Explicitly not doing | Nothing in any task contradicts it |

One gap found and accepted: the spec says the verge carries "streetlights, benches, bushes
and planting". Task 5 places **streetlights only**. Benches and bushes are city-atlas parts
that could merge into the same mesh, and planting needs the scatter system. Adding them is a
few lines in the same `Composer` loop and is left to the implementer's judgement rather than
made a required step, because none of them is load-bearing for anything the stage promises.

**2. Placeholder scan.** No "TBD", no "handle edge cases", no "write tests for the above".
Task 7 Step 3 describes the class in prose plus a required contract rather than giving its
full body — deliberate, and marked: `deliveries.js` is the precedent to copy, and
transcribing sixty lines of it into this plan would produce a second source of truth that
drifts. Every other code step carries the actual code.

**3. Type consistency.** Checked: `planStreets(layout, {ship, anchored})` returns
`{ring, spurs, all}` and Tasks 4, 5 and 7 all consume exactly those three names.
`roadCells(from, to, streets)` takes `streets` as the `Set` from `planStreets(...).all` in
both Task 4's implementation and Task 7's use. `stepVehicle(vehicle, dt, routeLength, random)`
has the same four parameters in Task 6's definition and Task 7's call. `bucketKey(vehicle)`
is defined and consumed under one name. Cumulative test counts run 157 → 161 → 169 → 172 →
179 → 185 → 193 → 195 with no gaps.

**One correction to the spec, made before any code exists.** The spec's workwear test
originally demanded 0.25 Euclidean distance in **linear** RGB, which no colour can meet:
linear RGB compresses dark colours severely and two trim colours are themselves dark, so
every plausible workwear tone measured 0.02 to 0.10 from `sleeping`. It was replaced with
sRGB distance ≥ 0.15 plus a trim-over-body luminance ratio ≥ 1.15, and the spec now records
why. Commit `0c25255`.
