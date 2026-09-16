import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'
import { townPlan, TOWN_VERTEX_BUDGET } from '../src/world/town-mesh.js'
import { planStreets } from '../src/world/streets.js'

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

test('the colony takes precedence over the town', () => {
  const all = townPlan({ streets: streets.all, claimed: new Set() })
  const taken = new Set(['1,1', '1,2', '2,1', '2,2'])
  const fewer = townPlan({ streets: streets.all, claimed: taken })
  assert.ok(fewer.length < all.length, 'claiming four cells removed no buildings')
})

test('a block the colony does not touch is identical either way', () => {
  const all = townPlan({ streets: streets.all, claimed: new Set() })
  const taken = new Set(['1,1', '1,2', '2,1', '2,2'])
  const fewer = townPlan({ streets: streets.all, claimed: taken })
  const far = (list) => list.filter((b) => b.x < -30).sort((a, b) => a.x - b.x || a.z - b.z)
  assert.deepEqual(far(fewer), far(all))
})
