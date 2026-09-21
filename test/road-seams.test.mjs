import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CARRIAGEWAY_WIDTH,
  CROSSING_PART,
  ROAD_TILE_SIZE,
  SUBGRID,
  TILE_OVERLAP,
  carriagewayTiles,
  roadTileScale,
  tileScale,
  vergeFurniture,
} from '../src/world/road-mesh.js'
import { CELL_SIZE } from '../src/world/grid.js'
import { planStreets } from '../src/world/streets.js'

/**
 * Why the carriageway's tiles overlap along the run.
 *
 * A road tile is a flat slab, and every one of them is placed at the height of the ground
 * under its own middle. On terrain that slopes at all — and the town's does, gently — that
 * makes a continuous road a staircase: measured over one straight row of 56 tiles, the median
 * step from tile to tile is 0.0196 and the worst 0.0521, against a tile's own raised rim of
 * 0.036. The slabs are the same size as the grid they sit on, so each pair meets face to
 * face, and two coincident faces at slightly different heights leave the depth buffer to pick
 * between them per pixel. That is the dark line across the road, and the reason the edge
 * paint appears to jump at a seam.
 *
 * The fix is for a tile to reach a little way into its neighbour rather than stop dead
 * against it — **along the run only**. Across the run it must stay exactly one carriageway
 * wide, because that width is what the lane offsets, the parking spaces and the verge
 * margins are all derived from, and widening the road by a hair here would move every one of
 * them.
 */

const step = CELL_SIZE / SUBGRID

test('a tile is exactly one carriageway wide, across the run', () => {
  // The load-bearing half. `CARRIAGEWAY_WIDTH` drives `EDGE_LINE_OFFSET`,
  // `DRIVING_LANE_OFFSET` and `PARKING_LANE_OFFSET`; a tile wider than it would put the paint
  // and the parked cars in the wrong place, and nothing on screen would say why.
  for (const part of ['road_straight', 'road_straight_crossing', 'road_corner_curved', 'road_tsplit', 'road_junction']) {
    const { across } = tileScale(part)
    assert.equal(across * ROAD_TILE_SIZE, CARRIAGEWAY_WIDTH, `${part} is ${across * ROAD_TILE_SIZE} wide, not one carriageway`)
    assert.equal(across, roadTileScale(), `${part} does not use the plain carriageway scale across the run`)
  }
})

test('a straight tile reaches into its neighbours along the run', () => {
  // Long enough that the two faces cannot be coincident, short enough that the overhang is
  // nothing you could see: the grid step is 2.4 and the overlap is measured in hundredths.
  const { along } = tileScale('road_straight')
  const length = along * ROAD_TILE_SIZE
  assert.ok(length > step, `a straight tile is ${length} long on a ${step} step — it still meets its neighbour face to face`)
  assert.equal(Math.round((length - step) * 1e6) / 1e6, TILE_OVERLAP, 'the overlap is not the one the constant claims')
  assert.ok(TILE_OVERLAP < step * 0.05, `an overlap of ${TILE_OVERLAP} on a ${step} tile is a visible lip, not a seam fix`)
})

test('every seam in the town has a tile that reaches across it', () => {
  // The straights are the only pieces that grow, so the fix only works if every join has one
  // on at least one side. It does, and not by luck: a junction piece only ever sits at a
  // cell's middle, and the tiles either side of it are the ones laid along its arms.
  //
  // Built from the surface `createRoads` actually lays, not from `carriagewayTiles` alone.
  // Those two differ in exactly one way and it is the way that matters here: a zebra crossing
  // replaces the plain tile at its spot, so asking the unfiltered list leaves 33 seams
  // answered by a tile that is not there. A first draft of this test did that, and a mutant
  // that stopped the crossing growing walked straight through it.
  const streets = planStreets()
  const crossings = vergeFurniture(streets.cells, CELL_SIZE).filter((f) => f.part === CROSSING_PART)
  const key = (x, z) => `${x.toFixed(4)},${z.toFixed(4)}`
  const replaced = new Set(crossings.map((f) => key(f.x, f.z)))
  const tiles = [
    ...carriagewayTiles(streets.cells, CELL_SIZE).filter((t) => !replaced.has(key(t.x, t.z))),
    ...crossings,
  ]
  assert.ok(crossings.length > 10, `only ${crossings.length} crossings — this test would not be exercising them`)
  const at = new Map(tiles.map((t) => [key(t.x, t.z), t]))
  const grows = (t) => tileScale(t.part).along > tileScale(t.part).across

  let seams = 0
  let uncovered = 0
  for (const t of tiles) {
    for (const [dx, dz] of [
      [step, 0],
      [0, step],
    ]) {
      const other = at.get(key(t.x + dx, t.z + dz))
      if (!other) continue
      seams++
      if (!grows(t) && !grows(other)) {
        uncovered++
        if (uncovered <= 3) console.error(`  seam between ${t.part} and ${other.part} at ${t.x},${t.z}`)
      }
    }
  }
  assert.ok(seams > 500, `only ${seams} seams found — the town is not laid out as expected`)
  assert.equal(uncovered, 0, `${uncovered} of ${seams} seams have a plain tile on both sides`)
})

test('the overlap runs the way the road does, not across it', () => {
  // The kit authors a straight tile with its edge lines at x = +/-0.62 running the length of
  // z, so the run is the tile's own z and the carriageway's width is its x. Growing the wrong
  // one widens the road and leaves every seam exactly where it was.
  const { along, across } = tileScale('road_straight')
  assert.ok(along > across, 'the straight tile grows across the run rather than along it')
})
