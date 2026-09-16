import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { greenBlocks, keepClearCells, inTown, blockContent } from '../src/world/town-plan.js'
import { planStreets } from '../src/world/streets.js'
import { createScatter, PLANETS } from '../src/world/planet.js'
import { CELL_SIZE } from '../src/world/grid.js'

/**
 * The owner's own words, about the running app: trees and rocks were landing on the
 * carriageway. `greenBlocks` is the planting sites the fix offers; `keepClearCells` is the
 * fence that keeps everything else — streets and built blocks alike — off limits to the wild
 * scatter `createScatter` draws for the countryside. See `src/world/planet.js` and
 * `src/game/colony.js`'s `_buildScatter`.
 */

const streets = planStreets()
const cellOf = (x, z) => `${Math.round(x / CELL_SIZE)},${Math.round(z / CELL_SIZE)}`

test('green blocks are offered as planting sites', () => {
  const green = greenBlocks({ streets: streets.all, claimed: new Set() })
  assert.ok(green.length > 5, `only ${green.length} green blocks`)
  for (const g of green) {
    assert.ok(!streets.all.has(cellOf(g.x, g.z)), 'a green block is a street')
  }
})

test('a claimed cell is no longer a planting site', () => {
  const free = greenBlocks({ streets: streets.all, claimed: new Set() })
  const taken = new Set(free.slice(0, 3).map((g) => cellOf(g.x, g.z)))
  const after = greenBlocks({ streets: streets.all, claimed: taken })
  assert.equal(after.length, free.length - 3)
})

// ── keepClearCells: the per-cell fence R8 asks for ──────────────────────────────────────

test('keepClearCells fences off every one of the 156 street cells', () => {
  const clear = keepClearCells({ streets: streets.all, claimed: new Set() })
  const clearKeys = new Set(clear.map((p) => cellOf(p.x, p.z)))
  assert.equal(streets.cells.length, 156, `expected 156 street cells, found ${streets.cells.length}`)
  for (const s of streets.cells) {
    assert.ok(clearKeys.has(`${s.x},${s.z}`), `street cell ${s.x},${s.z} is not fenced off`)
  }
})

test('keepClearCells never fences off a green block — that would leave nothing to plant', () => {
  const clear = keepClearCells({ streets: streets.all, claimed: new Set() })
  const clearKeys = new Set(clear.map((p) => cellOf(p.x, p.z)))
  const green = greenBlocks({ streets: streets.all, claimed: new Set() })
  for (const g of green) {
    assert.ok(!clearKeys.has(cellOf(g.x, g.z)), `green block ${cellOf(g.x, g.z)} is fenced off from its own planting`)
  }
})

// ── createScatter, with the real fence: the owner's complaint, measured ────────────────────
//
// Kit assets are not loaded under `node --test` (`loadKit` fetches over the network, which a
// unit test never does), so `createScatter` falls back to its primitive shapes here rather
// than the forest kit's models. That is fine: this exercises the placement algorithm and the
// `keepClear` gate, not the geometry, and both are identical either way.

function instancePositions(group) {
  const out = []
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  for (const mesh of group.children) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m)
      m.decompose(pos, quat, scale)
      out.push({ x: pos.x, z: pos.z })
    }
  }
  return out
}

test('before the fix (no town-aware keepClear), scatter lands on street cells', () => {
  const before = instancePositions(createScatter(PLANETS.terra, 1, [], 4242))
  const onStreet = before.filter((p) => streets.all.has(cellOf(p.x, p.z))).length
  assert.ok(onStreet > 0, `expected props on a street cell with no town fence, got ${onStreet}`)
})

test('after the fix, keepClearCells keeps every scatter prop off every street cell', () => {
  const clear = keepClearCells({ streets: streets.all, claimed: new Set() })
  const after = instancePositions(createScatter(PLANETS.terra, 1, clear, 4242))
  const onStreet = after.filter((p) => streets.all.has(cellOf(p.x, p.z)))
  assert.equal(onStreet.length, 0, `${onStreet.length} props still land on a street cell: ${JSON.stringify(onStreet.slice(0, 3))}`)
})

test('after the fix, keepClearCells keeps every scatter prop off every built town block', () => {
  const clear = keepClearCells({ streets: streets.all, claimed: new Set() })
  const after = instancePositions(createScatter(PLANETS.terra, 1, clear, 4242))
  let checked = 0
  for (const p of after) {
    const cx = Math.round(p.x / CELL_SIZE)
    const cz = Math.round(p.z / CELL_SIZE)
    const cell = { x: cx, z: cz }
    const k = `${cx},${cz}`
    if (!inTown(cell) || streets.all.has(k)) continue
    checked++
    assert.equal(blockContent(cell, streets.all).kind, 'green', `a prop landed on a built cell ${k}`)
  }
  assert.ok(checked > 0, 'no in-town, non-street prop was placed — the check above never ran')
})
