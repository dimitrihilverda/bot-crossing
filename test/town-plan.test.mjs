import test from 'node:test'
import assert from 'node:assert/strict'
import { inTown, townRadiusAt, blockContent, BUILDING_PARTS } from '../src/world/town-plan.js'
import { planStreets } from '../src/world/streets.js'
import { TOWN_CELL_RADIUS } from '../src/world/street-plan.js'
import { CELL_SIZE, key } from '../src/world/grid.js'

const streets = planStreets()

test('the town outline is not a circle', () => {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 64; i++) {
    const r = townRadiusAt((i / 64) * Math.PI * 2)
    lo = Math.min(lo, r)
    hi = Math.max(hi, r)
  }
  assert.ok(hi - lo >= 1.5, `the outline varies by only ${(hi - lo).toFixed(2)} cells`)
  assert.ok(hi <= TOWN_CELL_RADIUS, `the outline reaches ${hi.toFixed(2)}, past the street network`)
})

test('the centre is always in town', () => {
  assert.equal(inTown({ x: 0, z: 0 }), true)
})

test('block content depends on its own position and nothing else', () => {
  // The same cell, asked twice, with two different street sets around the rest of the world:
  // the real network, and a copy that is identical at this cell's four neighbours but has
  // several far-away cells toggled. A block's content may only look at its own position and
  // its own neighbours, so the result must come back unchanged either way.
  const cell = { x: 3, z: 2 }
  const altered = new Set(streets.all)
  for (const [fx, fz] of [[100, 100], [-100, 100], [100, -100], [-100, -100], [250, 0]]) {
    // None of these is a neighbour of `cell` — they sit far outside the town entirely.
    if (altered.has(key(fx, fz))) altered.delete(key(fx, fz))
    else altered.add(key(fx, fz))
  }

  const a = blockContent(cell, streets.all)
  const b = blockContent(cell, altered)
  assert.deepEqual(a, b)
})

test('a built block puts buildings on the sides that face a street', () => {
  let checked = 0
  let buildingsChecked = 0
  for (const cell of [{ x: 1, z: 1 }, { x: 2, z: 3 }, { x: -3, z: 2 }, { x: 4, z: -1 }, { x: -2, z: -4 }]) {
    const content = blockContent(cell, streets.all)
    if (content.kind !== 'built') continue
    checked++
    for (const b of content.buildings) {
      assert.ok(BUILDING_PARTS.includes(b.part), `unknown part ${b.part}`)
      const offX = b.x - cell.x * CELL_SIZE
      const offZ = b.z - cell.z * CELL_SIZE
      // Every building lies inside its own cell.
      assert.ok(Math.abs(offX) <= 6, `building spills out of its cell in x`)
      assert.ok(Math.abs(offZ) <= 6, `building spills out of its cell in z`)
      // The offset from the cell centre is SET_BACK along exactly one axis and zero on the
      // other, so it pins which side of the cell the building sits on — derive that side and
      // assert the cell actually neighbouring on it is a street, i.e. the building fronts it.
      assert.ok(offX === 0 || offZ === 0, `building offset (${offX}, ${offZ}) is not axis-aligned`)
      assert.ok(offX !== 0 || offZ !== 0, 'building sits exactly on the cell centre')
      const dx = Math.sign(offX)
      const dz = Math.sign(offZ)
      assert.ok(
        streets.all.has(key(cell.x + dx, cell.z + dz)),
        `building at (${b.x}, ${b.z}) does not face a street cell`
      )
      buildingsChecked++
    }
  }
  assert.ok(checked >= 1, 'none of the sampled cells was a built block')
  assert.ok(buildingsChecked >= 1, 'none of the sampled built blocks placed a building')
})

test('some blocks are green', () => {
  let green = 0
  let built = 0
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const cell = { x, z }
      if (!inTown(cell) || streets.all.has(`${x},${z}`)) continue
      if (blockContent(cell, streets.all).kind === 'green') green++
      else built++
    }
  }
  assert.ok(green > 0 && built > 0, `green=${green} built=${built}`)
  assert.ok(green / (green + built) > 0.15, 'almost nothing is green')
  assert.ok(green / (green + built) < 0.6, 'almost nothing is built')
})
