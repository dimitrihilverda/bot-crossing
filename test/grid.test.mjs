import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CELL_SIZE, DIRS, cellWorld, distance, key, line, neighbours, ring, worldToCell } from '../src/world/grid.js'

const step = (a, b) => Math.abs(b.x - a.x) + Math.abs(b.z - a.z)

test('there are exactly four neighbours, sharing an edge', () => {
  // Four rather than eight on purpose: with eight, two plots touching only at a corner would
  // count as connected, which reads as two colonies. `isConnected` exists to catch that.
  assert.equal(DIRS.length, 4)
  for (const [dx, dz] of DIRS) assert.equal(Math.abs(dx) + Math.abs(dz), 1)
})

test('neighbours are the four adjacent cells', () => {
  const got = neighbours({ x: 3, z: -2 }).map((c) => key(c.x, c.z)).sort()
  assert.deepEqual(got, ['2,-2', '3,-1', '3,-3', '4,-2'].sort())
})

test('a ring is a square outline of 8n cells', () => {
  // Chebyshev, not Manhattan. A ring is an OUTLINE and a square colony should grow as a
  // square; a Manhattan ring is a diamond and would grow it as a rotated lozenge.
  assert.equal(ring(0).length, 1)
  for (const n of [1, 2, 3, 7]) {
    const r = ring(n)
    assert.equal(r.length, 8 * n, `ring(${n}) has ${r.length} cells, expected ${8 * n}`)
    for (const c of r) {
      assert.equal(Math.max(Math.abs(c.x), Math.abs(c.z)), n, `${key(c.x, c.z)} is not at Chebyshev distance ${n}`)
    }
  }
})

test('a ring has no duplicates', () => {
  // The spiral hands out cells in ring order, so a duplicate would offer the same ground twice.
  for (const n of [1, 4, 9]) {
    const r = ring(n).map((c) => key(c.x, c.z))
    assert.equal(new Set(r).size, r.length, `ring(${n}) repeats a cell`)
  }
})

test('a ring is a walk: every consecutive pair is a four-neighbour, and it closes', () => {
  // This is the property the earlier membership/count/duplicate tests above never touched —
  // and the exact one that regressed once already this stage. `ring()` returning the right
  // *set* in a non-walkable order silently broke both `streets.js`'s road ring (a hop between
  // two cells that merely share the outline, not an edge, reads as a diagonal streak of
  // paving) and `colonyAnchor`'s even-spreading. `grid.js`'s own comment on `ring()` calls this
  // "load-bearing, not decorative" — this test is what actually pins it down, so a rewrite
  // that keeps the set but scrambles the order (e.g. a naive row-by-row emission) fails here
  // even though it still passes every test above.
  //
  // Verified by hand before trusting it: a row-by-row `ring()` (walk x low-to-high on each z
  // row, in Chebyshev-distance order) reproduces the exact set, count and no-duplicates
  // properties above, but breaks this one — a jump from the end of one row to the start of
  // the next is not a four-neighbour step for any radius above 0.
  for (const n of [1, 2, 3, 5, 8, 12]) {
    const r = ring(n)
    for (let i = 1; i < r.length; i++) {
      assert.equal(step(r[i - 1], r[i]), 1, `ring(${n}): step ${i} (${key(r[i - 1].x, r[i - 1].z)} -> ${key(r[i].x, r[i].z)}) is not a four-neighbour hop`)
    }
    // The loop closes: the last cell is a neighbour of the first, so a road built from this
    // array with `closed: true` actually rejoins itself instead of ending in a horseshoe.
    assert.equal(step(r[r.length - 1], r[0]), 1, `ring(${n}) does not close: the last cell is not adjacent to the first`)
  }
})

test('distance is the step count under four-neighbour movement', () => {
  // Manhattan, not Chebyshev. A distance is a STEP COUNT, and with four neighbours crossing
  // costs |dx| + |dz| moves.
  assert.equal(distance({ x: 0, z: 0 }, { x: 0, z: 0 }), 0)
  assert.equal(distance({ x: 0, z: 0 }, { x: 3, z: 0 }), 3)
  assert.equal(distance({ x: 0, z: 0 }, { x: 2, z: 3 }), 5)
  assert.equal(distance({ x: -2, z: 1 }, { x: 1, z: -1 }), 5)
})

test('distance agrees with a walk along neighbours', () => {
  // The property that makes it the right metric: you cannot cross in fewer moves than it says.
  const from = { x: -3, z: 2 }
  const to = { x: 4, z: -1 }
  const path = line(from.x, from.z, to.x, to.z)
  assert.equal(path.length - 1, distance(from, to))
})

test('a line to itself is one cell', () => {
  assert.deepEqual(line(2, 2, 2, 2), [{ x: 2, z: 2 }])
})

test('every step of a line is adjacent to the last', () => {
  const l = line(-4, 3, 5, -2)
  assert.ok(l.length > 2)
  for (let i = 1; i < l.length; i++) {
    assert.equal(step(l[i - 1], l[i]), 1, `step ${i} jumps ${step(l[i - 1], l[i])} cells`)
  }
})

test('a line starts at its origin and ends at its destination', () => {
  const l = line(-4, 3, 5, -2)
  assert.deepEqual(l[0], { x: -4, z: 3 })
  assert.deepEqual(l[l.length - 1], { x: 5, z: -2 })
})

test('a cell centre round-trips through world coordinates', () => {
  for (const c of [{ x: 0, z: 0 }, { x: 3, z: -2 }, { x: -5, z: 7 }]) {
    const w = cellWorld(c.x, c.z)
    assert.deepEqual(worldToCell(w.x, w.z), c, `${key(c.x, c.z)} did not round-trip`)
  }
})

test('any point inside a cell maps to that cell', () => {
  // The containing cell is a nearest-centre search, not a floor, so a point up to half the
  // cell width away on either side of the centre — corners included — still belongs to it.
  const c = { x: 2, z: -1 }
  const w = cellWorld(c.x, c.z)
  const almost = CELL_SIZE / 2 - 1e-6
  for (const [dx, dz] of [[0, 0], [almost, almost], [-almost, -almost], [almost, -almost], [-almost, almost]]) {
    assert.deepEqual(worldToCell(w.x + dx, w.z + dz), c, `offset ${dx},${dz} left the cell`)
  }
})

test('a cell corner still maps to its own cell, not a neighbour', () => {
  // This is exactly the shape of the plot-picking bug (colony.js's plotAt): a circular
  // threshold sized to the old hexagon's circumradius (7.6) is smaller than a square cell's
  // own corner distance (6 * sqrt(2) ~ 8.49), so a corner point would fall outside it and the
  // plot would refuse a click on its own corner. worldToCell has no such shortfall — it rounds
  // each axis independently, so even the point equidistant from four cells still resolves to
  // one of them, corner included.
  const c = { x: 1, z: -2 }
  const w = cellWorld(c.x, c.z)
  const almost = CELL_SIZE / 2 - 1e-6
  for (const [dx, dz] of [[almost, almost], [almost, -almost], [-almost, almost], [-almost, -almost]]) {
    assert.deepEqual(worldToCell(w.x + dx, w.z + dz), c, `corner offset ${dx},${dz} missed the cell`)
  }
})

test('a point past the cell edge belongs to the neighbour, not this cell', () => {
  // The other half of the same bug: PLOT_CELL = 7.6 reached past a square cell's own
  // half-width (6), so a point up to 7.6 units out on a single axis — well outside this
  // cell's actual footprint — used to still count as "on" it. This cell's true edge is at
  // exactly half CELL_SIZE; a point one unit further belongs to the next cell over.
  const c = { x: 1, z: -2 }
  const w = cellWorld(c.x, c.z)
  const edge = CELL_SIZE / 2 + 1
  assert.deepEqual(worldToCell(w.x + edge, w.z), { x: c.x + 1, z: c.z }, 'a point past the edge still mapped to the old cell')
})

test('the pitch is a multiple of the art packs\' two-unit module', () => {
  // Every building, road piece and base slab in city.glb is exactly 2 x 2 in plan. A pitch
  // that is not a multiple of 2 would put plot edges halfway along a tile.
  assert.equal(CELL_SIZE % 2, 0)
})
