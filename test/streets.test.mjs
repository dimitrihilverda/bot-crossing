import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { planStreets } from '../src/world/streets.js'
import { allocateCells, colonyAnchor, shipPosition, worldToCell, cellWorld } from '../src/world/plots.js'
import { distance, ring } from '../src/world/grid.js'

const SHIP = { x: -2, z: 1 }
const k = (c) => `${c.x},${c.z}`
const opts = (anchored = []) => ({ ship: SHIP, anchored: new Set(anchored) })

test('a one-cell colony gets a ring around it', () => {
  const layout = new Map([['a', [{ x: 0, z: 0 }]]])
  const { ring, all } = planStreets(layout, opts())
  assert.ok(ring.length > 0, 'no ring was planned')
  for (const cell of ring) {
    assert.ok(all.has(k(cell)), 'a ring cell is missing from `all`')
  }
})

test('no street cell is ever a plot cell', () => {
  const layout = new Map([
    ['a', [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 0, z: 1 }]],
    ['b', [{ x: 2, z: -1 }, { x: 2, z: 0 }]],
  ])
  const { all } = planStreets(layout, opts())
  for (const cells of layout.values()) {
    for (const cell of cells) {
      assert.ok(!all.has(k(cell)), `street cell ${k(cell)} is also a plot cell`)
    }
  }
})

test('no street cell is an anchored district cell', () => {
  const layout = new Map([['a', [{ x: 0, z: 0 }]]])
  // A ring-5 district, which is where `colonyAnchor` puts a visiting colony.
  const district = [{ x: 5, z: -5 }, { x: 5, z: -4 }]
  const { all } = planStreets(layout, opts(district.map(k)))
  for (const cell of district) {
    assert.ok(!all.has(k(cell)), `street cell ${k(cell)} belongs to a district`)
  }
})

test('the ring sits outside every home plot cell', () => {
  const layout = new Map([['a', [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]]])
  const { ring } = planStreets(layout, opts())
  // Chebyshev distance from the origin of the furthest plot cell is 2 — the same metric
  // `ring` itself is built from — so every ring cell must be further out than that.
  const chebyshev = (c) => Math.max(Math.abs(c.x), Math.abs(c.z))
  for (const cell of ring) {
    assert.ok(chebyshev(cell) > 2, `ring cell ${k(cell)} is not outside the colony`)
  }
})

test('every spur is a chain of adjacent cells reaching the ring', () => {
  const layout = new Map([['a', [{ x: 0, z: 0 }]]])
  const { ring, spurs } = planStreets(layout, opts())
  const onRing = new Set(ring.map(k))
  const spur = spurs.get('a')
  assert.ok(spur && spur.length > 0, 'the plot got no spur')
  for (let i = 1; i < spur.length; i++) {
    const a = spur[i - 1]
    const b = spur[i]
    const step = Math.abs(b.x - a.x) + Math.abs(b.z - a.z)
    assert.equal(step, 1, `spur step ${i} jumps ${step} cells`)
  }
  assert.ok(onRing.has(k(spur[spur.length - 1])), 'the spur does not end on the ring')
})

test('the depot always gets a spur', () => {
  const layout = new Map([['a', [{ x: 0, z: 0 }]]])
  const { spurs } = planStreets(layout, opts())
  const spur = spurs.get('__ship__')
  assert.ok(spur && spur.length > 0, 'the depot got no spur')
})

test('a plot with no unclaimed neighbour gets no spur', () => {
  // `b` sits at the origin, walled in on all four sides by `a`. There is no free cell
  // adjacent to it, so no road can reach it — which is expected, not an error: the
  // vehicle drives the last stretch over the deck, exactly as it did before stage 4.
  const DIRS = [[1, 0], [0, 1], [-1, 0], [0, -1]]
  const layout = new Map([
    ['b', [{ x: 0, z: 0 }]],
    ['a', DIRS.map(([dx, dz]) => ({ x: dx, z: dz }))],
  ])
  const { spurs } = planStreets(layout, opts())
  assert.ok(!spurs.has('b'), 'a walled-in plot was given a spur it cannot have')
})

test('planning is stable: the same layout gives the same streets', () => {
  const layout = new Map([
    ['a', [{ x: 0, z: 0 }, { x: 1, z: 0 }]],
    ['b', [{ x: -1, z: 0 }]],
  ])
  const first = planStreets(layout, opts())
  const second = planStreets(layout, opts())
  assert.deepEqual([...first.all].sort(), [...second.all].sort())
  assert.deepEqual(first.ring, second.ring)
})

test('a colony whose plots are separated by street cells is still connected', () => {
  // Two plots two cells apart, with the cell between them a street. Without street
  // passability this layout is judged disconnected and re-seeded from the middle on
  // every poll — the exact upheaval `allocateCells` exists to prevent.
  // Plots deliberately avoid the depot's cell at { x: -2, z: 0 }.
  const previous = new Map([
    ['a', [{ x: -2, z: 2 }]],
    ['b', [{ x: 2, z: 2 }]],
  ])
  const projects = [
    { id: 'a', size: 1 },
    { id: 'b', size: 1 },
  ]
  const streets = new Set(['-1,2', '0,2', '1,2'])
  const out = allocateCells(projects, previous, streets)
  assert.deepEqual(out.get('a'), [{ x: -2, z: 2 }], 'plot a moved')
  assert.deepEqual(out.get('b'), [{ x: 2, z: 2 }], 'plot b moved')
})

test('a genuinely scattered colony is still re-seeded', () => {
  // No street connects these, so the memory really does describe a broken map and
  // starting over is correct. The guard must not become a rubber stamp.
  const previous = new Map([
    ['a', [{ x: -4, z: 0 }]],
    ['b', [{ x: 4, z: 0 }]],
  ])
  const projects = [
    { id: 'a', size: 1 },
    { id: 'b', size: 1 },
  ]
  const out = allocateCells(projects, previous, new Set())
  const moved =
    JSON.stringify(out.get('a')) !== JSON.stringify([{ x: -4, z: 0 }]) ||
    JSON.stringify(out.get('b')) !== JSON.stringify([{ x: 4, z: 0 }])
  assert.ok(moved, 'a scattered colony was allowed to keep its broken layout')
})

test('street cells are never handed out as plot cells', () => {
  const streets = new Set(['0,0', '1,0'])
  const out = allocateCells([{ id: 'a', size: 1 }], new Map(), streets)
  for (const cell of out.get('a')) {
    assert.ok(!streets.has(`${cell.x},${cell.z}`), `plot took street cell ${cell.x},${cell.z}`)
  }
})

test('a layout re-allocated from its own memory does not move', () => {
  // This is the property allocateCells exists for. It held on the hex lattice and must hold
  // here: a zone moves only when its own footprint changes, never because a neighbour did.
  const projects = [
    { id: 'a', size: 20 },
    { id: 'b', size: 5 },
    { id: 'c', size: 1 },
  ]
  const first = allocateCells(projects, new Map())
  const second = allocateCells(projects, first)
  for (const [id, cells] of first) {
    assert.deepEqual(second.get(id), cells, `${id} moved on a re-allocation`)
  }
})

test('a colony split only by street cells is still connected', () => {
  // Plots deliberately avoid the depot's cell at { x: -2, z: 0 }.
  const previous = new Map([
    ['a', [{ x: -2, z: 2 }]],
    ['b', [{ x: 2, z: 2 }]],
  ])
  const projects = [{ id: 'a', size: 1 }, { id: 'b', size: 1 }]
  const streets = new Set(['-1,2', '0,2', '1,2'])
  const out = allocateCells(projects, previous, streets)
  assert.deepEqual(out.get('a'), [{ x: -2, z: 2 }], 'plot a moved')
  assert.deepEqual(out.get('b'), [{ x: 2, z: 2 }], 'plot b moved')
})

test('a genuinely scattered colony is still re-seeded (wide split)', () => {
  const previous = new Map([
    ['a', [{ x: -6, z: 0 }]],
    ['b', [{ x: 6, z: 0 }]],
  ])
  const projects = [{ id: 'a', size: 1 }, { id: 'b', size: 1 }]
  const out = allocateCells(projects, previous, new Set())
  const moved =
    JSON.stringify(out.get('a')) !== JSON.stringify([{ x: -6, z: 0 }]) ||
    JSON.stringify(out.get('b')) !== JSON.stringify([{ x: 6, z: 0 }])
  assert.ok(moved, 'a scattered colony kept its broken layout')
})

test('corner contact does not count as connected', () => {
  // The four-neighbour rule, asserted where it matters: two plots meeting only at a corner
  // are two colonies, and the guard must re-seed them.
  const previous = new Map([
    ['a', [{ x: 0, z: 0 }]],
    ['b', [{ x: 1, z: 1 }]],
  ])
  const projects = [{ id: 'a', size: 1 }, { id: 'b', size: 1 }]
  const out = allocateCells(projects, previous, new Set())
  const kept =
    JSON.stringify(out.get('a')) === JSON.stringify([{ x: 0, z: 0 }]) &&
    JSON.stringify(out.get('b')) === JSON.stringify([{ x: 1, z: 1 }])
  assert.ok(!kept, 'two plots touching only at a corner were treated as one colony')
})

test('a plot never lands on a street cell', () => {
  const streets = new Set(['0,0', '1,0'])
  const out = allocateCells([{ id: 'a', size: 1 }], new Map(), streets)
  for (const cell of out.get('a')) {
    assert.ok(!streets.has(`${cell.x},${cell.z}`), `plot took street cell ${cell.x},${cell.z}`)
  }
})

test('a plot grows into cells that share an edge', () => {
  const out = allocateCells([{ id: 'a', size: 40 }], new Map())
  const cells = out.get('a')
  assert.ok(cells.length > 1, 'a large project claimed only one cell')
  // Every cell after the first touches at least one already-claimed cell by an edge.
  const claimed = [cells[0]]
  for (let i = 1; i < cells.length; i++) {
    assert.ok(
      claimed.some((c) => distance(c, cells[i]) === 1),
      `cell ${i} is not edge-adjacent to the blob so far`
    )
    claimed.push(cells[i])
  }
})

test('visiting colonies are spread evenly around a ring', () => {
  // Dimitri's change, which must carry over exactly: districts surround the centre rather
  // than clumping wherever their names hash.
  const total = 4
  const anchors = [0, 1, 2, 3].map((i) => colonyAnchor(`colony-${i}`, i, total))
  const keys = anchors.map((a) => `${a.x},${a.z}`)
  assert.equal(new Set(keys).size, total, 'two colonies were given the same anchor')
  for (const a of anchors) {
    assert.ok(Math.max(Math.abs(a.x), Math.abs(a.z)) > 0, 'an anchor landed at the origin')
  }
})

test('colonyAnchor still falls back to a hash without an index', () => {
  const a = colonyAnchor('somebody')
  const b = colonyAnchor('somebody')
  assert.deepEqual(a, b, 'the nameless fallback is not stable')
})

// ── colony.js speaks square cells (Task 6) ─────────────────────────────────────────────────
//
// colony.js cannot be imported outside a browser, so — as the rest of the suite does for that
// file — these assert against its source. The bug Task 6 exists to fix was colony.js reading
// `.q`/`.r` off cells the allocator hands back as `{ x, z }`: the reads came back `undefined`,
// the arithmetic came back `NaN`, and the street search downstream never terminated. Every
// call site listed here is one that fed that hang.

test('colony.js no longer calls worldToHex, and converts every former call site to worldToCell', () => {
  const src = readFileSync('src/game/colony.js', 'utf8')
  assert.doesNotMatch(src, /worldToHex/, 'a worldToHex call site (or its import) survives')
  // The six sites Task 6 converted (SHIP_CELL_FOR_STREETS, groundAt, the onPlot check in
  // _workSite, _trafficRouteFor's houseCell, and _routeFor's start and end), plus a seventh:
  // plotAt, which moved off the stale PLOT_CELL hex radius onto the same cell lookup.
  const calls = src.match(/worldToCell\(/g) || []
  assert.equal(calls.length, 7, `expected 7 worldToCell call sites, found ${calls.length}`)
})

test('plotAt no longer thresholds picking against the old hex radius', () => {
  // PLOT_CELL = 7.6 was the old hexagon's circumradius: too small to reach a square cell's
  // own corners (6 * sqrt(2) ~ 8.49) and too large for its edges (half-width 6). Restoring
  // either the constant or its value as a literal picking radius reintroduces the bug this
  // test exists to catch. Comment lines are excluded so the fix's own explanation of the old
  // value, kept for context, does not trip this.
  const src = readFileSync('src/game/colony.js', 'utf8')
  assert.doesNotMatch(src, /PLOT_CELL/, 'colony.js still references the old hex-radius picking threshold')
  const codeLines = src.split('\n').filter((l) => !/^\s*(\*|\/\/)/.test(l))
  assert.ok(!codeLines.some((l) => /7\.6/.test(l)), 'a literal 7.6 hex radius survives in colony.js code')
})

test('the dead hex shim is gone from plots.js', () => {
  const src = readFileSync('src/world/plots.js', 'utf8')
  for (const gone of ['PLOT_CELL', 'worldToHex', 'cubeRound']) {
    assert.doesNotMatch(src, new RegExp(gone), `plots.js still has ${gone}`)
  }
})

test('the cells the allocator hands back are read as x/z, not q/r', () => {
  const src = readFileSync('src/game/colony.js', 'utf8')
  // The three spots that read straight off allocateCells' output (firstPass / layout), which
  // is where the hang actually lived: valid {x, z} cells misread as {q, r} turn into NaN the
  // moment streets.js or road-path.js does arithmetic on them.
  assert.match(src, /anchored\.add\(`\$\{cell\.x\},\$\{cell\.z\}`\)/, 'the anchored-district set still keys on q/r')
  assert.match(src, /cells\.map\(\(c\) => `\$\{c\.x\},\$\{c\.z\}`\)/, 'the plot signature still keys on q/r')
  assert.match(src, /cellWorld\(cells\[0\]\.x, cells\[0\]\.z\)/, "a plot's root cell is still read as q/r")
  // deckedCells and its lookup in groundAt.
  assert.match(src, /deckedCells\.set\(`\$\{cell\.x\},\$\{cell\.z\}`/, 'deckedCells is still built keyed on q/r')
  assert.match(src, /deckedCells\?\.get\(`\$\{cell\.x\},\$\{cell\.z\}`\)/, 'groundAt still looks deckedCells up by q/r')
})

test('roadCells output is now {x, z}, and colony.js reads it correctly', () => {
  // The other side of the same boundary: roadCells (src/world/road-path.js) returns {x, z}
  // cells like everything else on this lattice, and colony.js now reads them correctly as
  // .x/.z instead of the old hexagonal .q/.r fields.
  const src = readFileSync('src/game/colony.js', 'utf8')
  const reads = src.match(/cellWorld\(c\.q, c\.r\)/g) || []
  assert.equal(reads.length, 0, `expected 0 old-style roadCells reads, found ${reads.length}`)
})

test('the persisted layout shape is still an array of two integers', () => {
  // merge-state.js (not this task's to touch) merges plot cells structurally, as arrays. The
  // fields renamed, the shape must not: an object would break that merge silently.
  const src = readFileSync('src/game/colony.js', 'utf8')
  assert.match(src, /list\.push\(\{ x, z \}\)/, 'restoreLayout no longer builds { x, z } cells')
  assert.match(
    src,
    /cells\.map\(\(c\) => \[c\.x, c\.z\]\)/,
    'layoutForSave no longer writes [x, z] pairs'
  )
})

test('the layout-reset note sits where plotCells is populated from the loaded state', () => {
  const src = readFileSync('src/game/colony.js', 'utf8')
  const region = src.slice(src.indexOf('restoreLayout(saved)') - 1500, src.indexOf('restoreLayout(saved)'))
  assert.match(region, /read as square coordinates/, 'the migration note is missing')
  assert.match(region, /server\/api\.mjs:37/, 'the note does not explain why no version gate could be used')
  assert.match(region, /this branch does not\s*\n?\s*\*?\s*touch/, 'the note does not say server/ is off-limits')
})

// ── the sharp edge: worldToCell can return -0 ──────────────────────────────────────────────

test("the depot's world position round-trips to the ship's reserved cell", () => {
  // Mirrors colony.js's module-level `SHIP_CELL_FOR_STREETS = worldToCell(shipPosition())`.
  const ship = shipPosition()
  const cell = worldToCell(ship.x, ship.z)
  // Normalised with +0 rather than compared with a weaker assertion: deepEqual is
  // deepStrictEqual under node:assert/strict, and deepStrictEqual({ x: -0 }, { x: 0 }) fails.
  assert.deepEqual({ x: cell.x + 0, z: cell.z + 0 }, { x: -2, z: 0 })
})

test('worldToCell . cellWorld round-trips every cell, -0 included', () => {
  for (let x = -3; x <= 3; x++) {
    for (let z = -3; z <= 3; z++) {
      const world = cellWorld(x, z)
      const back = worldToCell(world.x, world.z)
      // Harmless for ===, arithmetic and the string keys colony.js builds with it (`${-0}`
      // stringifies to "0"), but deepStrictEqual tells -0 and 0 apart -- normalise before
      // comparing rather than weakening the assertion.
      assert.deepEqual({ x: back.x + 0, z: back.z + 0 }, { x, z })
      assert.equal(`${back.x},${back.z}`, `${x},${z}`, 'the string key differs even where deepEqual would not')
    }
  }
})

test('colony.js reads square cells, never the old axial fields', () => {
  // The lattice went from hexagonal to square, so cells are { x, z }. A surviving `.q`/`.r`
  // read yields undefined, cellWorld returns NaN, and every route becomes a NaN polyline --
  // which no unit test catches, because the routing underneath is perfectly correct.
  const src = readFileSync('src/game/colony.js', 'utf8')
  assert.doesNotMatch(src, /cellWorld\([^)]*\.q\b/, 'a cellWorld call still reads .q')
  assert.doesNotMatch(src, /\bc\.q\b|\bc\.r\b|\bcell\.q\b|\bcell\.r\b/, 'a cell field is still read as .q/.r')
})
