import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { CELL_SIZE } from '../src/world/grid.js'

// plots.js builds three.js geometry and needs a GL context to construct a Plot, so this
// asserts against the source, the way test/crew-look.test.mjs reads astronauts.js.
const SRC = readFileSync('src/world/plots.js', 'utf8')

test('no hexagon geometry survives', () => {
  for (const gone of ['hexPrism', 'HEX_PHASE', 'CylinderGeometry', 'Math.PI / 3', 'flat-top']) {
    assert.ok(!SRC.includes(gone), `plots.js still has ${gone}`)
  }
})

test('the deck is a box', () => {
  assert.match(SRC, /BoxGeometry/, 'the deck prism is not a box')
})

test('a cell has four outside edges, not six', () => {
  // The kerb draws one bar per edge that faces something else. Six was the hexagon's count.
  assert.ok(!/for \(let i = 0; i < 6; i\+\+\)/.test(SRC), 'a six-edge loop survives')
})

test('the slot count and the grid agree', () => {
  // SLOTS_PER_CELL drives cellsNeeded(); the slot builder must produce exactly that many per
  // cell, or a repo claims ground it cannot fill or overflows the ground it claimed.
  const m = SRC.match(/SLOTS_PER_CELL\s*=\s*(\d+)/)
  assert.ok(m, 'SLOTS_PER_CELL is gone')
  const n = Number(m[1])
  const side = Math.round(Math.sqrt(n))
  assert.equal(side * side, n, `${n} slots is not a square arrangement`)
  // And the spacing has to leave room for a house, which is 2 units at HOUSE_SCALE 1.45.
  const spacing = CELL_SIZE / side
  assert.ok(spacing > 2 * 1.45, `slot spacing ${spacing} does not clear a 2.9-wide house`)
})
