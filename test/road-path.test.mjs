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
