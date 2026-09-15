import { test } from 'node:test'
import assert from 'node:assert/strict'
import { TRAFFIC_BODIES, TRAFFIC_TINTS } from '../src/world/traffic.js'
import { bucketKey } from '../src/world/traffic-cars.js'

test('vehicles bucket by body and tint together', () => {
  // One instanced mesh per (body, tint) pair, the same way deliveries bucket per accent:
  // a geometry carries one material, so two paints cannot share one mesh.
  const a = bucketKey({ body: 'car_sedan', tint: 0xb8bcc0 })
  const b = bucketKey({ body: 'car_sedan', tint: 0x2f3338 })
  const c = bucketKey({ body: 'car_taxi', tint: 0xb8bcc0 })
  assert.notEqual(a, b, 'two tints shared a bucket')
  assert.notEqual(a, c, 'two bodies shared a bucket')
  assert.equal(a, bucketKey({ body: 'car_sedan', tint: 0xb8bcc0 }), 'bucketing is not stable')
})

test('the bucket count is bounded by the palette, not by the traffic', () => {
  // Every possible vehicle falls into one of these, so the mesh count cannot grow with
  // how long the app has been running.
  const keys = new Set()
  for (const body of TRAFFIC_BODIES) {
    for (const tint of TRAFFIC_TINTS) keys.add(bucketKey({ body, tint }))
  }
  assert.equal(keys.size, TRAFFIC_BODIES.length * TRAFFIC_TINTS.length)
})
