import test from 'node:test'
import assert from 'node:assert/strict'
import { tileFor, carriagewayTiles, SUBGRID, CARRIAGEWAY_WIDTH } from '../src/world/road-mesh.js'
import { planStreets } from '../src/world/streets.js'
import { CELL_SIZE } from '../src/world/grid.js'

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
  // road_corner_curved's modelled ports, pinned by road-corner-glb.test.mjs — measured
  // separately from road_corner's, not assumed to match, and they came back identical: [S, E].
  const base = [S, E]
  for (const arms of [[S, E], [E, N], [N, W], [W, S]]) {
    const { part, k } = tileFor(arms)
    assert.equal(part, 'road_corner_curved', `${asKeys(arms)} should be a curved corner`)
    assert.equal(asKeys(base.map((d) => rot(d, k))), asKeys(arms), `${asKeys(arms)} got k=${k}`)
  }
})

test('a tsplit is turned so its ports land on its actual arms', () => {
  // road_tsplit's modelled ports, pinned by road-corner-glb.test.mjs: arms -Z, +Z and +X.
  const base = [N, S, E]
  for (const arms of [[N, S, E], [N, E, W], [N, S, W], [S, E, W]]) {
    const { part, k } = tileFor(arms)
    assert.equal(part, 'road_tsplit', `${asKeys(arms)} should be a tsplit`)
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

// ── end-to-end: the real generated network, not just synthetic cell lists ───────────────────
//
// Nothing else in this suite ever drives the road layer with `planStreets`'s actual output.
// That gap is exactly how a runtime-throwing `createRoads` (it read `streets.spurs` and
// `streets.ringRuns`, both retired in Task 2) stayed hidden behind a green suite: every test
// here and in road-mesh.test.mjs used a small synthetic cell list, and `tileFor`'s fallback
// throw was never exercised by a real, generator-produced arm set either.
test('the real street network tiles cleanly: every cell gets tiles, and no two tiles coincide', () => {
  const { cells } = planStreets()
  assert.ok(cells.length > 0, 'planStreets() produced no street cells to test against')

  // Must not throw: `tileFor`'s fallback throw exists for an arm set no rotation of the three
  // base kinds can match, which should be unreachable on this square lattice. A real network
  // is the strongest input this can be checked against.
  const tiles = carriagewayTiles(cells, CELL_SIZE)

  // Every street cell gets at least its own centre tile.
  const cellKeys = new Set(cells.map((c) => `${c.x},${c.z}`))
  const tileCellKeys = new Set()
  for (const t of tiles) {
    const cx = Math.round(t.x / CELL_SIZE)
    const cz = Math.round(t.z / CELL_SIZE)
    tileCellKeys.add(`${cx},${cz}`)
  }
  for (const k of cellKeys) assert.ok(tileCellKeys.has(k), `street cell ${k} got no carriageway tile`)

  // No two tiles share a position: coincident slabs would z-fight.
  const seen = new Set()
  for (const t of tiles) {
    const k = `${t.x.toFixed(4)},${t.z.toFixed(4)}`
    assert.ok(!seen.has(k), `two tiles land on the same spot at ${k}`)
    seen.add(k)
  }
})
