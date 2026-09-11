import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ATLAS_COLS, ATLAS_ROWS, CELL_EYES, CELL_HAIR, CELL_SKIN, cellRect } from '../src/agents/atlas-cells.js'

test('the atlas is eight columns by four rows', () => {
  assert.equal(ATLAS_COLS, 8)
  assert.equal(ATLAS_ROWS, 4)
})

test('cell 0 is the top-left cell', () => {
  // glTF puts the UV origin at the TOP left and `v` runs downward, so cell 0 spans
  // v 0 to 0.25 and not 0.75 to 1. Inverting this repaints a different swatch while still
  // looking deliberate, which is why it is asserted rather than assumed.
  assert.deepEqual(cellRect(0), { u0: 0, v0: 0, u1: 0.125, v1: 0.25 })
})

test('cell 8 is the first cell of the second row', () => {
  assert.deepEqual(cellRect(8), { u0: 0, v0: 0.25, u1: 0.125, v1: 0.5 })
})

test('cell 7 is the last cell of the first row', () => {
  assert.deepEqual(cellRect(7), { u0: 0.875, v0: 0, u1: 1, v1: 0.25 })
})

test('the three named cells are the ones the head meshes use', () => {
  // Measured from the UVs of Ranger_Head and Rogue_Head: cell 1 is hair (770 and 1640
  // vertices), cell 0 is skin (322 and 309), cell 2 is eyes and brows (80 and 98).
  assert.equal(CELL_SKIN, 0)
  assert.equal(CELL_HAIR, 1)
  assert.equal(CELL_EYES, 2)
})

test('every cell index has a rectangle inside the unit square', () => {
  for (let n = 0; n < ATLAS_COLS * ATLAS_ROWS; n++) {
    const r = cellRect(n)
    assert.ok(r.u0 >= 0 && r.u1 <= 1 && r.v0 >= 0 && r.v1 <= 1, `cell ${n} escapes the atlas`)
    assert.ok(r.u1 > r.u0 && r.v1 > r.v0, `cell ${n} is empty`)
  }
})
