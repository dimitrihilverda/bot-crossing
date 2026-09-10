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

test('closed:true bridges the last cell back to the first; an open run leaves that seam unpaved', () => {
  // A real hex ring (radius 1): six cells, each adjacent to the next, wrapping from the
  // last back to the first.
  const ring = [
    { q: 1, r: 0 }, { q: 1, r: -1 }, { q: 0, r: -1 },
    { q: -1, r: 0 }, { q: -1, r: 1 }, { q: 0, r: 1 },
  ]
  const closedPoints = carriagewayPoints(ring, 1, { closed: true })
  const openPoints = carriagewayPoints(ring, 1, { closed: false })

  // The midpoint of the closing hop, from the last cell (0, 1) back to the first (1, 0).
  // TILES_PER_HOP is 6 regardless of radius (it is derived from PLOT_CELL, not the radius
  // argument), so t=3 lands exactly halfway — a coordinate only that closing hop can produce.
  const seamX = 0.75
  const seamZ = 1.2990381056766579
  const hasSeam = (points) =>
    points.some((p) => Math.abs(p.x - seamX) < 1e-6 && Math.abs(p.z - seamZ) < 1e-6)

  assert.ok(hasSeam(closedPoints), 'closed:true left the seam between the last and first cell unpaved')
  assert.ok(!hasSeam(openPoints), 'an open run (closed:false) paved a seam it has no business paving')
})

test('two runs sharing a placed set never lay two patches on the same spot, even where the second starts on a cell the first already covers', () => {
  const placed = new Set()
  // A spur-like open run, then a second run that starts on the first run's last cell —
  // exactly how a spur's chain lands on the ring cell it joins.
  const first = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]
  const second = [{ q: 2, r: 0 }, { q: 2, r: 1 }]

  const firstPoints = carriagewayPoints(first, 1, { placed })
  const secondPoints = carriagewayPoints(second, 1, { placed })

  const key = (p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`
  const firstKeys = new Set(firstPoints.map(key))
  const overlap = secondPoints.filter((p) => firstKeys.has(key(p)))
  assert.equal(overlap.length, 0, 'the second run re-laid a patch the first run had already placed')

  // The shared cell (2, 0) really was covered — by the first run, as its last cell — so the
  // absence of overlap above is dedup working, not the shared cell simply going unpaved.
  const sharedCellCovered = firstPoints.some((p) => Math.abs(p.x - 3) < 1e-6 && Math.abs(p.z - Math.sqrt(3)) < 1e-6)
  assert.ok(sharedCellCovered, 'the cell the two runs share was never paved by either run')
})

test('an open run behaves the same with no options passed as with the defaults spelled out', () => {
  const cells = [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }, { q: 2, r: 1 }]
  const implicit = carriagewayPoints(cells, 1)
  const explicit = carriagewayPoints(cells, 1, { closed: false, placed: new Set() })
  assert.deepEqual(implicit, explicit, 'omitting options changed behaviour from spelling out the defaults')
  // Same shape the original six tests already pin: no junctions on cell (0,0)-(1,0)-(2,0)'s
  // straight lead-in, and no coordinate laid twice.
  const seen = new Set(implicit.map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`))
  assert.equal(seen.size, implicit.length, 'the default (single-call) placed set did not dedup within its own run')
})
