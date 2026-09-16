import test from 'node:test'
import assert from 'node:assert/strict'
import { planStreets } from '../src/world/streets.js'
import { roadCells } from '../src/world/road-path.js'
import { key } from '../src/world/grid.js'
import { allocateCells } from '../src/world/plots.js'
import { mulberry } from '../src/world/rng.js'

const DEPOT = { x: -2, z: 0 }

/** A spread of colonies: 3, 8, 20 and 40 plots, each from its own seed. */
function colonies() {
  const out = []
  for (const count of [3, 8, 20, 40]) {
    const rand = mulberry(count * 7919)
    out.push(
      Array.from({ length: count }, (_, i) => ({ id: `repo-${i}`, size: 1 + Math.floor(rand() * 4) }))
    )
  }
  return out
}

test('a delivery route runs on streets', () => {
  const streets = planStreets()
  const fractions = []
  for (const projects of colonies()) {
    const layout = allocateCells(projects, new Map(), streets.all)
    for (const [, cells] of layout) {
      const route = roadCells(DEPOT, cells[0], streets.all)
      if (route.length <= 2) continue
      const onStreet = route.filter((c) => streets.all.has(key(c.x, c.z))).length
      assert.ok(onStreet > 0, `a ${route.length}-cell route never touches a street`)
      fractions.push(onStreet / route.length)
    }
  }
  assert.ok(fractions.length >= 40, `only ${fractions.length} routes measured`)
  fractions.sort((a, b) => a - b)
  const median = fractions[Math.floor(fractions.length / 2)]
  assert.ok(median >= 0.6, `median street fraction ${median.toFixed(2)} is below 0.6`)
})

test('the streets do not depend on which repos exist', () => {
  const a = planStreets()
  const b = planStreets()
  assert.deepEqual([...a.all].sort(), [...b.all].sort())
})
