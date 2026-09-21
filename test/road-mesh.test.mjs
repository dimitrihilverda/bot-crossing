import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  CARRIAGEWAY_WIDTH,
  ROAD_SURFACE_LIFT,
  ROAD_TILE_SIZE,
  carriagewayHeight,
  roadTileScale,
} from '../src/world/road-mesh.js'

test('the carriageway is 2.4 wide', () => {
  // 12 / 5 = 2.4 divides a cell exactly — see road-tiles.test.mjs's "the carriageway divides
  // the cell exactly" — which is what lets neighbouring tiles meet edge to edge with no
  // overlap and no gap. A car is 0.61 wide.
  assert.equal(CARRIAGEWAY_WIDTH, 2.4)
})

test('the tile scale brings a 2 x 2 tile to the carriageway width', () => {
  assert.equal(ROAD_TILE_SIZE, 2)
  assert.equal(roadTileScale(), CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE)
  assert.equal(roadTileScale(), 1.2)
})

// ── the terrain-follow fix: the carriageway must track the ground, never clamp to the deck ──

test('ROAD_SURFACE_LIFT is a small positive number', () => {
  assert.equal(typeof ROAD_SURFACE_LIFT, 'number')
  assert.ok(ROAD_SURFACE_LIFT > 0, `ROAD_SURFACE_LIFT ${ROAD_SURFACE_LIFT} is not positive`)
  // "Small": nowhere near the deck's own height, or this would just recreate a floating slab.
  assert.ok(ROAD_SURFACE_LIFT < 0.45, `ROAD_SURFACE_LIFT ${ROAD_SURFACE_LIFT} is not small`)
})

test('carriagewayHeight tracks groundY — it must not clamp, the way the bug it replaced did', () => {
  // Spans the ring's measured terrain range (-0.177 to +0.138) and values above DECK_TOP
  // (0.45), so a reintroduced `Math.max(DECK_TOP, groundY)` clamp fails this test: every one
  // of these inputs, above and below DECK_TOP alike, must come back out shifted by exactly
  // the lift, never pinned to 0.45.
  const groundYs = [-0.177, -0.1, -0.01, 0, 0.01, 0.1, 0.138, 0.45, 0.6, 1.2]
  for (const groundY of groundYs) {
    const h = carriagewayHeight(groundY)
    assert.equal(h, groundY + ROAD_SURFACE_LIFT, `carriagewayHeight(${groundY}) = ${h}, expected ${groundY + ROAD_SURFACE_LIFT}`)
  }
})

test('carriagewayHeight is strictly increasing in groundY — confirms it tracks rather than saturates', () => {
  const groundYs = [-0.177, -0.05, 0, 0.138, 0.45, 1.2]
  let prev = -Infinity
  for (const groundY of groundYs) {
    const h = carriagewayHeight(groundY)
    assert.ok(h > prev, `carriagewayHeight(${groundY}) = ${h} did not increase from the previous input's ${prev}`)
    prev = h
  }
})

test('carriagewayHeight honours an explicit lift override', () => {
  assert.equal(carriagewayHeight(1, 0.25), 1.25)
  assert.equal(carriagewayHeight(-0.177, 0), -0.177)
})
