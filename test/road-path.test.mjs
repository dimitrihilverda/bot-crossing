import { test } from 'node:test'
import assert from 'node:assert/strict'
import { roadCells } from '../src/world/road-path.js'

const k = (c) => `${c.x},${c.z}`

function assertAdjacent(cells) {
  for (let i = 1; i < cells.length; i++) {
    const dx = Math.abs(cells[i].x - cells[i - 1].x)
    const dz = Math.abs(cells[i].z - cells[i - 1].z)
    assert.equal(dx + dz, 1, `step ${i} jumps ${dx + dz} cells`)
  }
}

test('a route to the same cell is one cell', () => {
  assert.deepEqual(roadCells({ x: 0, z: 0 }, { x: 0, z: 0 }, new Set()), [{ x: 0, z: 0 }])
})

test('with no streets at all it is exactly the old grid line', () => {
  // The fallback is documented behaviour, not a defect: this is stage 2's route.
  const road = roadCells({ x: -2, z: 1 }, { x: 3, z: -1 }, new Set())
  assertAdjacent(road)
  assert.deepEqual(road[0], { x: -2, z: 1 })
  assert.deepEqual(road[road.length - 1], { x: 3, z: -1 })
})

test('every step of a road route is adjacent to the last', () => {
  const streets = new Set(['0,0', '1,0', '2,0', '3,0'])
  const road = roadCells({ x: -1, z: 0 }, { x: 4, z: 0 }, streets)
  assertAdjacent(road)
})

test('a route starts at its origin and ends at its destination', () => {
  const streets = new Set(['0,0', '1,0', '2,0'])
  const road = roadCells({ x: -1, z: 0 }, { x: 3, z: 0 }, streets)
  assert.deepEqual(road[0], { x: -1, z: 0 })
  assert.deepEqual(road[road.length - 1], { x: 3, z: 0 })
})

test('the route uses the road rather than cutting across', () => {
  // The straight line from (0,-2) to (0,2) runs through (0,-1), (0,0), (0,1). Those are
  // not street cells; the dog-leg through x=1 is. A road route must prefer the road even
  // though it is longer, which is the entire point of the stage.
  const streets = new Set(['1,-2', '1,-1', '1,0', '1,1', '1,2'])
  const road = roadCells({ x: 0, z: -2 }, { x: 0, z: 2 }, streets)
  assertAdjacent(road)
  const used = road.filter((c) => streets.has(k(c))).length
  assert.ok(used >= 3, `only ${used} street cells used out of a ${road.length}-cell route`)
})

test('a destination with no useful street nearby is still routed to', () => {
  // Not a test of the `line` fallback branches — those are unreachable by construction (the
  // search budget always contains both endpoints, so Dijkstra always finds a path). This proves
  // the search itself, not the fallback, gets the car there when the streets don't help.
  const streets = new Set(['9,0', '9,1'])
  const road = roadCells({ x: 0, z: 0 }, { x: 2, z: 0 }, streets)
  assertAdjacent(road)
  assert.deepEqual(road[road.length - 1], { x: 2, z: 0 })
})

test('an unreachable destination still falls back rather than failing', () => {
  // No streets at all: the fast path returns the plain lattice line directly, which is a
  // real and permanent fallback (see road-path.js's module comment), not a search failure.
  const road = roadCells({ x: -5, z: 3 }, { x: 6, z: -4 }, new Set())
  assertAdjacent(road)
  assert.deepEqual(road[0], { x: -5, z: 3 })
  assert.deepEqual(road[road.length - 1], { x: 6, z: -4 })
})

test('routing is deterministic', () => {
  const streets = new Set(['0,0', '1,0', '1,-1'])
  const a = roadCells({ x: -1, z: 0 }, { x: 2, z: -1 }, streets)
  const b = roadCells({ x: -1, z: 0 }, { x: 2, z: -1 }, streets)
  assert.deepEqual(a, b)
})

test('a strict route never leaves the street, however far round it has to go', () => {
  // `OFF_ROAD_COST` makes tarmac a preference, not a requirement: a shortcut across one cell of
  // grass beats a detour of seven cells on the road. That is right for a delivery, which has to
  // leave the road to reach a house — and wrong for through traffic, which was cutting corners
  // across the verge in half of all its routes.
  //
  // A U of street with a long way round and a one-cell grass shortcut across the mouth.
  // Deep enough that the detour genuinely costs more than the shortcut: eight steps on tarmac
  // against one cell of grass at OFF_ROAD_COST 6 plus the goal.
  const streets = new Set(['0,0', '1,0', '2,0', '3,0', '3,1', '3,2', '2,2', '1,2', '0,2'])
  const from = { x: 0, z: 0 }
  const to = { x: 0, z: 2 }

  const loose = roadCells(from, to, streets)
  assert.ok(
    loose.some((c) => !streets.has(`${c.x},${c.z}`)),
    'the ordinary route was expected to take the shortcut — this test is not checking anything'
  )

  const strict = roadCells(from, to, streets, { strict: true })
  assert.ok(strict, 'no street-only route was found where one plainly exists')
  for (const c of strict) {
    assert.ok(streets.has(`${c.x},${c.z}`), `a strict route stepped onto (${c.x}, ${c.z}), which is not a street`)
  }
  assert.ok(strict.length > loose.length, 'the strict route should be the longer way round')
})

test('a strict route answers nothing rather than driving over the grass', () => {
  // Two islands of street with no tarmac between them. The loose router bridges the gap, which
  // is what a delivery needs; the strict one has to say there is no route, so the caller can
  // leave the car where it is instead of sending it across a field.
  const streets = new Set(['0,0', '0,1', '5,0', '5,1'])
  const from = { x: 0, z: 0 }
  const to = { x: 5, z: 0 }
  assert.ok(roadCells(from, to, streets).length > 0, 'the loose router should still bridge the gap')
  assert.equal(roadCells(from, to, streets, { strict: true }), null)
})

test('a strict route to where you already are is still a route', () => {
  const streets = new Set(['0,0'])
  assert.deepEqual(roadCells({ x: 0, z: 0 }, { x: 0, z: 0 }, streets, { strict: true }), [{ x: 0, z: 0 }])
})
