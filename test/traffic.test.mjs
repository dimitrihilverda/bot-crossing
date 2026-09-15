import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DWELL_MAX,
  DWELL_MIN,
  MAX_TRAFFIC,
  TRAFFIC_BODIES,
  newVehicle,
  stepVehicle,
  trafficCount,
} from '../src/world/traffic.js'

test('an idle colony has no traffic at all', () => {
  assert.equal(trafficCount(0), 0)
})

test('traffic never exceeds the cap', () => {
  for (const n of [1, 5, 20, 90, 500]) {
    assert.ok(trafficCount(n) <= MAX_TRAFFIC, `${n} active threads gave ${trafficCount(n)} vehicles`)
  }
  assert.equal(MAX_TRAFFIC, 8)
})

test('traffic is monotonic in the active-thread count', () => {
  let last = -1
  for (let n = 0; n <= 200; n++) {
    const count = trafficCount(n)
    assert.ok(count >= last, `${n} active threads gave ${count}, fewer than ${n - 1} gave ${last}`)
    last = count
  }
})

test('a vehicle walks its four phases in order', () => {
  const seen = []
  let v = newVehicle(1)
  const random = () => 0.5
  for (let i = 0; i < 4000; i++) {
    if (seen[seen.length - 1] !== v.phase) seen.push(v.phase)
    v = stepVehicle(v, 1 / 60, 20, random)
  }
  // It cycles, so trim to the first four transitions and check the order.
  const order = seen.slice(0, 5)
  assert.deepEqual(order.slice(0, 4), ['parked', 'out', 'waiting', 'back'])
})

test('a vehicle waits between DWELL_MIN and DWELL_MAX at its address', () => {
  assert.equal(DWELL_MIN, 4)
  assert.equal(DWELL_MAX, 12)
  // Drive it to the address, then count the seconds it stays put.
  let v = newVehicle(2)
  const random = () => 0
  while (v.phase !== 'waiting') v = stepVehicle(v, 1 / 60, 10, random)
  let waited = 0
  while (v.phase === 'waiting') {
    v = stepVehicle(v, 1 / 60, 10, random)
    waited += 1 / 60
  }
  assert.ok(waited >= DWELL_MIN - 0.05, `waited only ${waited.toFixed(2)}s`)
  assert.ok(waited <= DWELL_MAX + 0.05, `waited ${waited.toFixed(2)}s, over the maximum`)
})

test('a vehicle arrives exactly, not approximately', () => {
  // The stage 1 defect, in a new place: damping behind a threshold froze progress a
  // strictly positive distance short of its target, forever.
  let v = newVehicle(3)
  const random = () => 0.5
  const length = 17.5
  while (v.phase === 'parked' || v.phase === 'out') v = stepVehicle(v, 1 / 60, length, random)
  assert.equal(v.driven, length)
})

test('ambient bodies never include the delivery vehicle', () => {
  // The delivery signature is a stationwagon in a repo's accent colour with a load on its
  // roof, and it means "a thread is being worked on". Nothing ambient may borrow it.
  assert.ok(TRAFFIC_BODIES.length >= 3)
  assert.ok(!TRAFFIC_BODIES.includes('car_stationwagon'))
})

test('a vehicle is fully determined by its seed', () => {
  assert.deepEqual(newVehicle(7), newVehicle(7))
  assert.notDeepEqual(newVehicle(7), newVehicle(8))
})

test('a non-positive dt changes nothing at all', () => {
  // `growth.js` guards its own input this way, and without it a negative dt drives `driven`
  // unboundedly away from both ends of the route and grows `dwell` without limit.
  const random = () => 0.5
  for (const dt of [0, -1 / 60, -100, Number.NaN]) {
    let v = newVehicle(11)
    // Advance into each phase in turn and confirm the guard holds in all four.
    for (const phase of ['parked', 'out', 'waiting', 'back']) {
      while (v.phase !== phase) v = stepVehicle(v, 1 / 60, 12, random)
      const before = { ...v }
      assert.deepEqual(stepVehicle(v, dt, 12, random), before, `dt ${dt} changed a ${phase} vehicle`)
    }
  }
})
