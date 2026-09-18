import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'
import { HALL_PART, HALL_SCALE, HALL_BOUNDS, HALL_SPOT } from '../src/world/ship.js'
import { CELL_SIZE } from '../src/world/grid.js'

/**
 * The hall beside the depot's office: the owner's own building has one, and the city kit does
 * not. It comes out of the base kit instead, and the thing worth pinning is not how it looks
 * but that it fits — the depot owns exactly one cell and the office already takes a third of it.
 */
const doc = await new NodeIO().read('public/assets/spacebase.glb')

test('the hall part is in the base kit, and is the shape the placement assumes', () => {
  // The offsets below are arithmetic on these numbers. If a re-exported pack moves the part,
  // the hall silently lands somewhere else — so the measurement is checked, not trusted.
  const node = doc.getRoot().listNodes().find((n) => n.getName() === HALL_PART)
  assert.ok(node, `${HALL_PART} is missing from spacebase.glb`)

  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const p = []
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p[a])
        max[a] = Math.max(max[a], p[a])
      }
    }
  }
  const near = (a, b) => Math.abs(a - b) < 0.01
  assert.ok(near(min[0], HALL_BOUNDS.minX) && near(max[0], HALL_BOUNDS.maxX), `x ${min[0]}..${max[0]}`)
  assert.ok(near(min[1], HALL_BOUNDS.minY) && near(max[1], HALL_BOUNDS.maxY), `y ${min[1]}..${max[1]}`)
  assert.ok(near(min[2], HALL_BOUNDS.minZ) && near(max[2], HALL_BOUNDS.maxZ), `z ${min[2]}..${max[2]}`)
})

test('the hall stands on the ground rather than floating or sinking', () => {
  assert.equal(HALL_BOUNDS.minY, 0)
})

test('the hall fits the depot cell, with the office beside it', () => {
  // The depot owns one 12-unit cell, so 6 either side of its anchor, and the office shell takes
  // 2 of that. The hall gets the rest and no more: a wall over the boundary is a wall in the
  // street cell's verge, among the lamps and the parked bicycles.
  const left = (HALL_SPOT.x + HALL_BOUNDS.minX) * HALL_SCALE
  const right = (HALL_SPOT.x + HALL_BOUNDS.maxX) * HALL_SCALE
  assert.ok(left >= -CELL_SIZE / 2 - 1e-6, `the hall reaches ${left.toFixed(2)}, past the cell edge at ${-CELL_SIZE / 2}`)
  assert.ok(right <= -2 + 1e-6, `the hall reaches ${right.toFixed(2)}, into the office at -2`)
})

test('the hall keeps clear of the loading dock', () => {
  // +Z is where the dock is and where every crew member walks in and out. The hall may stand
  // beside the office; it may not stand in front of it.
  const front = (HALL_SPOT.z + HALL_BOUNDS.maxZ) * HALL_SCALE
  const dockFront = 0.8 * 2.0 // SHELL_BOUNDS.maxZ * DEPOT_SCALE
  assert.ok(front <= dockFront + 1e-6, `the hall's front is at ${front.toFixed(2)}, ahead of the dock at ${dockFront}`)
})
