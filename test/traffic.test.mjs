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
  parkedCars,
} from '../src/world/traffic.js'

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

// ── how much traffic ─────────────────────────────────────────────────────────────────

test('a colony with no streets has no traffic, however busy it gets', () => {
  // Not a tuning choice: with nowhere to drive there is nowhere to put a car. This is the
  // state every colony is in for the first few frames, before `planStreets` has run once.
  assert.equal(trafficCount(0, 0), 0)
  assert.equal(trafficCount(50, 0), 0)
})

test('a town with streets has traffic on them even when nothing is running', () => {
  // The rule this module used to carry was "the amount of traffic is what it means": no
  // active threads, no cars, empty streets. That read as a dead town rather than a quiet
  // colony, so the baseline now comes from how much street there is and activity is added
  // on top — the *increase* is what still means something.
  assert.ok(trafficCount(0, 60) > 0, 'a built town with nothing running has empty streets')
})

test('a busy colony puts more cars out than an idle town of the same size', () => {
  assert.ok(trafficCount(40, 60) > trafficCount(0, 60))
})

test('traffic never exceeds the cap', () => {
  for (const threads of [1, 5, 20, 90, 500]) {
    for (const cells of [1, 40, 400, 5000]) {
      assert.ok(
        trafficCount(threads, cells) <= MAX_TRAFFIC,
        `${threads} threads on ${cells} street cells gave ${trafficCount(threads, cells)}`
      )
    }
  }
})

test('traffic is monotonic in both the thread count and the size of the town', () => {
  let last = -1
  for (let n = 0; n <= 200; n++) {
    const count = trafficCount(n, 60)
    assert.ok(count >= last, `${n} threads gave ${count}, fewer than ${n - 1} gave ${last}`)
    last = count
  }
  last = -1
  for (let cells = 0; cells <= 400; cells++) {
    const count = trafficCount(6, cells)
    assert.ok(count >= last, `${cells} street cells gave ${count}, fewer than ${cells - 1} gave ${last}`)
    last = count
  }
})

// ── parked cars ──────────────────────────────────────────────────────────────────────

/** A straight tile running along +z (ry 0), and one running along +x (ry a quarter turn). */
const straightZ = (x, z) => ({ x, z, part: 'road_straight', ry: 0 })
const straightX = (x, z) => ({ x, z, part: 'road_straight', ry: Math.PI / 2 })

/** A long street of straight tiles, enough that the hash gets a fair spread. */
const street = (n) => Array.from({ length: n }, (_, i) => straightZ(0, i * 2.4))

test('nothing parks on a junction, a bend or a T-split', () => {
  const junctions = [
    { x: 0, z: 0, part: 'road_junction', ry: 0 },
    { x: 12, z: 0, part: 'road_corner_curved', ry: 0 },
    { x: 24, z: 0, part: 'road_tsplit', ry: 0 },
    { x: 36, z: 0, part: 'road_straight_crossing', ry: 0 },
  ]
  assert.deepEqual(parkedCars(junctions, 1, 0), [])
})

test('a parked car stands beside the carriageway, facing along it', () => {
  const cars = parkedCars(street(400), 0.9, 7)
  assert.ok(cars.length > 0, 'a 400-tile street parked nothing at all')
  for (const car of cars) {
    // The tile runs along +z, so the car belongs at +/-0.9 across it and nowhere else —
    // parking it at any other distance puts it on the paint, in the running lane, or out on
    // the verge.
    assert.ok(Math.abs(Math.abs(car.x) - 0.9) < 1e-9, `parked at x=${car.x}, expected +/-0.9`)
    // Facing along the street, one way or the other: a car parked across the road is the
    // fault this asserts against.
    const facing = Math.abs(((car.heading % Math.PI) + Math.PI) % Math.PI)
    assert.ok(facing < 1e-9 || Math.abs(facing - Math.PI) < 1e-9, `heading ${car.heading} is across the street`)
  }
})

test('a parked car parks on its own right, so both kerbs face the same way as the traffic', () => {
  // Right of travel is `(-d.z, d.x)`. On a street running +z that puts the car at x = -0.9
  // facing +z, and the other kerb's cars at x = +0.9 facing -z. A car at +0.9 facing +z is
  // parked against the traffic, which is what this catches.
  for (const car of parkedCars(street(400), 0.9, 3)) {
    const facingPlusZ = Math.abs(car.heading) < 1e-9
    assert.equal(car.x < 0, facingPlusZ, `car at x=${car.x} with heading ${car.heading} faces the wrong kerb`)
  }
})

test('parking is deterministic, so a reload does not reshuffle the street', () => {
  assert.deepEqual(parkedCars(street(40), 0.9, 11), parkedCars(street(40), 0.9, 11))
  // ...and a different street is not the same street: the hash has to actually see the tile.
  assert.notDeepEqual(
    parkedCars(street(40), 0.9, 11),
    parkedCars(Array.from({ length: 40 }, (_, i) => straightX(i * 2.4, 0)), 0.9, 11)
  )
})

test('no parked car wears the delivery stationwagon', () => {
  // The stationwagon in a repo's colour with a load on its roof is the one car in this world
  // that means something. A parked one would be a delivery that never arrives.
  for (const car of parkedCars(street(400), 0.9, 5)) {
    assert.ok(TRAFFIC_BODIES.includes(car.body), `parked car wearing ${car.body}`)
    assert.notEqual(car.body, 'car_stationwagon')
  }
})

test('a street does not park more cars than it has room for', () => {
  // One car per side per tile. A tile is 2.4 long and a car is about 1.0, so one fits with
  // room to spare and two would overlap.
  const tiles = street(100)
  assert.ok(parkedCars(tiles, 0.9, 1).length <= tiles.length * 2)
})

test("parked cars do not roll: their wheels have no distance to turn on", () => {
  for (const car of parkedCars(street(100), 0.9, 2)) assert.equal(car.distance, 0)
})
