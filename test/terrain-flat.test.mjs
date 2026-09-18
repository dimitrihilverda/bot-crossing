import test from 'node:test'
import assert from 'node:assert/strict'
import { terrainHeight, TOWN_RADIUS, PLANETS } from '../src/world/planet.js'

const planet = PLANETS.moon

/** Sample a ring of 48 points at `radius` and return its height range. */
function ring(radius) {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2
    const y = terrainHeight(Math.cos(a) * radius, Math.sin(a) * radius, planet)
    lo = Math.min(lo, y)
    hi = Math.max(hi, y)
  }
  return { lo, hi, range: hi - lo }
}

test('the ground the town stands on is flat', () => {
  assert.equal(TOWN_RADIUS, 104)
  const inner = ring(TOWN_RADIUS - 10)
  assert.ok(inner.range < 0.8, `the town's ground varies by ${inner.range.toFixed(2)}`)
})

test('the hills survive, further out', () => {
  const outer = ring(TOWN_RADIUS + 50)
  assert.ok(outer.range > 1.5, `the countryside is flat too (${outer.range.toFixed(2)}) — nothing is left`)
})
