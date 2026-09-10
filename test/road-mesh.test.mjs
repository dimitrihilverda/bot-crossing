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
