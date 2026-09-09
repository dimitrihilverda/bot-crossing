import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { CAR_PARTS, WHEEL_RADIUS, wheelSpin } from '../src/world/deliveries.js'

test('every car part the module names exists in the city kit', async () => {
  const doc = await new NodeIO().read('public/assets/city.glb')
  const names = new Set(
    doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName())
      .filter(Boolean)
  )
  for (const name of Object.values(CAR_PARTS)) {
    assert.ok(names.has(name), `city.glb has no node named "${name}"`)
  }
})

test('the car names a body and exactly four wheels', () => {
  assert.ok(CAR_PARTS.body)
  const wheels = Object.keys(CAR_PARTS).filter((k) => k !== 'body')
  assert.equal(wheels.length, 4, `expected 4 wheels, got ${wheels.join(', ')}`)
})

test('a wheel turns once per circumference rolled', () => {
  // Rolling exactly one circumference is one full turn.
  const oneTurn = wheelSpin(2 * Math.PI * WHEEL_RADIUS, WHEEL_RADIUS)
  assert.ok(Math.abs(oneTurn - 2 * Math.PI) < 1e-9, `got ${oneTurn}`)
})

test('a stationary wheel does not turn, and a zero radius does not divide by zero', () => {
  assert.equal(wheelSpin(0, WHEEL_RADIUS), 0)
  assert.equal(wheelSpin(5, 0), 0)
})

test('the badge never moves to the car', () => {
  // The indicators module is the only thing allowed to draw badges, and it is driven from
  // the crew roster. A reference to it from the vehicle module would be the first step
  // toward a badge over a moving target, which the spec forbids.
  const src = readFileSync('src/world/deliveries.js', 'utf8')
  assert.doesNotMatch(src, /indicators|BADGE|badgeFor/i, 'deliveries.js reaches into badges')
})
