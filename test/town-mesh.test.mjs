import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'
import { townPlan, townStamp, TOWN_VERTEX_BUDGET } from '../src/world/town-mesh.js'
import { planStreets } from '../src/world/streets.js'
import { CELL_SIZE } from '../src/world/grid.js'

const doc = await new NodeIO().read('public/assets/city.glb')
const vertsOf = new Map()
for (const node of doc.getRoot().listNodes()) {
  const mesh = node.getMesh()
  if (!mesh) continue
  let n = 0
  for (const prim of mesh.listPrimitives()) n += prim.getAttribute('POSITION').getCount()
  vertsOf.set(node.getName(), n)
}

const streets = planStreets()

test('the town stays under its geometry ceiling', () => {
  const placed = townPlan({ streets: streets.all, claimed: new Set() })
  const total = placed.reduce((sum, b) => sum + (vertsOf.get(b.part) || 0), 0)
  assert.ok(
    total <= TOWN_VERTEX_BUDGET,
    `the town draws ${total} vertices, over the ${TOWN_VERTEX_BUDGET} ceiling`
  )
  assert.ok(placed.length > 30, `only ${placed.length} buildings — the town is empty`)
})

// Cells that actually carry a town building, derived from `townPlan`'s own output rather than
// picked by hand — a hand-picked cell can turn out to be a street cell, which the
// `streets.has(k)` branch in `townPlan` skips before `claimed` is ever consulted, making a
// "the colony wins" assertion pass for the wrong reason (or on too few real cells).
const all = townPlan({ streets: streets.all, claimed: new Set() })
const cellOf = (b) => `${Math.round(b.x / CELL_SIZE)},${Math.round(b.z / CELL_SIZE)}`
const buildingsByCell = new Map()
for (const b of all) {
  const k = cellOf(b)
  if (!buildingsByCell.has(k)) buildingsByCell.set(k, [])
  buildingsByCell.get(k).push(b)
}
// The first four distinct cells that carry a building, excluding the `x < -30` region the
// "identical either way" test below uses as its untouched control. Every key here is, by
// construction, a non-street, in-town block: `townPlan` only emits buildings for cells that
// pass both.
const claimedCells = [...buildingsByCell.entries()]
  .filter(([, buildings]) => buildings.every((b) => b.x >= -30))
  .slice(0, 4)
  .map(([k]) => k)

test('the colony takes precedence over the town', () => {
  const taken = new Set(claimedCells)
  const removed = claimedCells.reduce((sum, k) => sum + buildingsByCell.get(k).length, 0)
  const fewer = townPlan({ streets: streets.all, claimed: taken })
  assert.ok(removed > 0, 'the claimed cells carry no buildings to remove')
  assert.equal(
    fewer.length,
    all.length - removed,
    `claiming ${claimedCells.join(' ')} should remove exactly ${removed} buildings`
  )
})

test('a block the colony does not touch is identical either way', () => {
  const taken = new Set(claimedCells)
  const fewer = townPlan({ streets: streets.all, claimed: taken })
  const far = (list) => list.filter((b) => b.x < -30).sort((a, b) => a.x - b.x || a.z - b.z)
  assert.deepEqual(far(fewer), far(all))
})

// ── townStamp: the rebuild guard `Colony` compares (fix-round-2, task-6-report.md) ─────────
//
// Regression covered here: `createTown`'s buildings sit at `groundAt(x, z)`, which for every
// cell the town queries resolves to `terrainHeight(x, z, planet)` — a function of `planet.id`.
// A stamp built only from the street plan and the claimed cells is bitwise identical across a
// planet switch with no layout change, so `Colony._syncPlots` would skip the rebuild and leave
// the town floating at the old planet's heights. `townStamp` exists so that can't happen again:
// it must change whenever any of its three arguments does, planet included.

test('townStamp changes when the planet does, streets and claimed held fixed', () => {
  const claimed = 'a,b|c,d'
  const onMoon = townStamp('street-plan-x', claimed, 'moon')
  const onMars = townStamp('street-plan-x', claimed, 'mars')
  assert.notEqual(onMoon, onMars, 'a planet switch must not leave the town stamp unchanged')
})

test('townStamp changes when the street plan or the claimed set does, planet held fixed', () => {
  const base = townStamp('street-plan-x', 'a,b|c,d', 'moon')
  assert.notEqual(townStamp('street-plan-y', 'a,b|c,d', 'moon'), base)
  assert.notEqual(townStamp('street-plan-x', 'a,b|c,e', 'moon'), base)
})

test('townStamp is identical when none of the three inputs change', () => {
  assert.equal(townStamp('street-plan-x', 'a,b|c,d', 'moon'), townStamp('street-plan-x', 'a,b|c,d', 'moon'))
})
