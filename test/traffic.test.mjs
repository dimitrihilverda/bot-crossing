import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  DWELL_MAX,
  DWELL_MIN,
  MAX_TRAFFIC,
  THREADS_PER_VEHICLE,
  TRAFFIC_BODIES,
  newVehicle,
  stepVehicle,
  trafficCount,
  parkedCars,
  headwayFactor,
  parkedBikes,
  routeEndpoints,
} from '../src/world/traffic.js'
import { planStreets } from '../src/world/streets.js'
import { roadCells } from '../src/world/road-path.js'

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

test('the cap is a ceiling, not the setting', () => {
  // It was the setting, for every colony anyone has looked at. This town lays 150 street
  // cells; at one car per three that is 50 wanted before a single thread is counted, against
  // a cap of 40 — so the cap decided the number, and both knobs under it were dead. Doubling
  // the density changed nothing. Running fifty threads changed nothing.
  //
  // That is invisible from the outside: the streets had cars on them and the number was
  // stable, which is what a working density looks like. Only the arithmetic says otherwise.
  const cells = planStreets().all.size
  assert.ok(cells > 0, 'the town lays no streets at all')

  const idle = trafficCount(0, cells)
  assert.ok(idle < MAX_TRAFFIC, `an idle town of ${cells} cells already wants ${idle} cars, at the cap of ${MAX_TRAFFIC} — the density below it is doing nothing`)

  // And the activity term has somewhere to go on top of it. Two things have to hold, and
  // neither one is enough alone.
  //
  // The rate has to be one a real machine reaches: "more than idle" passes for a term that
  // rounds up, which adds exactly one car however broken its rate is, and one car is more
  // than none. Forty threads is a busy afternoon here and it has to show on the road.
  assert.ok(
    trafficCount(40, cells) - idle >= 5,
    `forty threads adds only ${trafficCount(40, cells) - idle} cars to the town's own ${idle}`
  )
  // And the rate has to be the one the constant says it is.
  for (const cars of [1, 4, 10]) {
    assert.equal(
      trafficCount(cars * THREADS_PER_VEHICLE, cells) - idle,
      cars,
      `${cars * THREADS_PER_VEHICLE} threads should add ${cars} cars on top of the town's own ${idle}`
    )
  }
})

test('a bigger town gets proportionally more traffic, not a fixed handful', () => {
  // The baseline is a density, and the way to tell a density from a constant is to change the
  // input: a town of eighty street cells has to put out meaningfully more cars than one of
  // forty. Both are well under the cap, so nothing here is clamped.
  const small = trafficCount(0, 40)
  const large = trafficCount(0, 80)
  assert.ok(large > small, `40 cells gave ${small} cars and 80 gave ${large} — the baseline is not a density`)
  assert.ok(large >= small * 2 - 1, `doubling the town went from ${small} cars to ${large}`)
})

test('the cap still holds for a town far larger than this one', () => {
  // The ceiling's actual job. Ten times the streets and ten times the threads must not put
  // ten times the cars on the road: every one of them holds a cached route, an instance slot
  // and a place in a headway check that grows with the square of the count.
  assert.equal(trafficCount(2000, 20000), MAX_TRAFFIC)
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

// ── keeping a gap ────────────────────────────────────────────────────────────────────

/** A car at the origin, facing +z (heading 0 under `pointAt`'s convention). */
const northbound = (x, z) => ({ x, z, heading: 0 })
const southbound = (x, z) => ({ x, z, heading: Math.PI })

test('a car with the road to itself drives at full speed', () => {
  assert.equal(headwayFactor(northbound(0, 0), [], 1.6), 1)
  assert.equal(headwayFactor(northbound(0, 0), [northbound(0, 40)], 1.6), 1)
})

test('a car closing on the one in front slows in proportion to the gap', () => {
  // Half the gap left, half the speed. Tapering rather than switching is what makes a queue
  // settle instead of stuttering: a car that only ever ran or stopped would judder behind
  // anything that waits, and ambient traffic must not draw the eye.
  assert.equal(headwayFactor(northbound(0, 0), [northbound(0, 0.8)], 1.6), 0.5)
  assert.equal(headwayFactor(northbound(0, 0), [northbound(0, 0.4)], 1.6), 0.25)
})

test('a car does not brake for one behind it', () => {
  assert.equal(headwayFactor(northbound(0, 0), [northbound(0, -0.8)], 1.6), 1)
})

test('a car does not brake for oncoming traffic', () => {
  // The two directions drive on opposite sides of the centre line, so a car coming the other
  // way passes close and must be ignored. Braking for it would stop every car in the colony
  // dead every time it met one — the single most likely way for this rule to ruin the street.
  assert.equal(headwayFactor(northbound(0, 0), [southbound(0.7, 0.8)], 1.6), 1)
})

test('a car does not brake for one crossing at a junction', () => {
  // Crossing traffic is deliberately out of scope: cars have no right of way and no junction
  // to negotiate, so two may still pass through each other at a crossroads. Braking on a
  // perpendicular neighbour would instead deadlock every junction in the town.
  assert.equal(headwayFactor(northbound(0, 0), [{ x: 0.2, z: 0.8, heading: Math.PI / 2 }], 1.6), 1)
})

test('a car brakes for the nearest thing in front, not the first one it looks at', () => {
  const others = [northbound(0, 1.2), northbound(0, 0.4), northbound(0, 0.8)]
  assert.equal(headwayFactor(northbound(0, 0), others, 1.6), 0.25)
})

test('a throttled vehicle stops moving but still counts down its wait', () => {
  // The scale belongs on the step, not on `dt`: a car held at a standstill behind another
  // must not also have its dwell frozen, or a queue at an address would never clear.
  const moving = { phase: 'out', driven: 5, dwell: 0 }
  assert.equal(stepVehicle(moving, 1 / 60, 100, () => 0.5, 0).driven, 5)
  assert.ok(stepVehicle(moving, 1 / 60, 100, () => 0.5, 1).driven > 5)

  const waiting = { phase: 'waiting', driven: 100, dwell: 4 }
  assert.ok(stepVehicle(waiting, 1, 100, () => 0.5, 0).dwell < 4, 'a blocked car never finishes waiting')
})

// ── where a car starts ───────────────────────────────────────────────────────────────

test('a vehicle keeps the same origin across round trips, and only its destination moves', () => {
  // The origin has to be stable or a car teleports across town the instant it finishes a
  // trip: it is standing at the start of its route when the route is replaced. The
  // destination may move freely, because the car is at the *other* end when that happens.
  let v = newVehicle(4)
  const origin = v.originSeed
  const first = v.addressSeed
  const random = () => 0.5
  for (let i = 0; i < 4000; i++) v = stepVehicle(v, 1 / 60, 20, random)
  assert.equal(v.originSeed, origin, 'a vehicle moved house between trips')
  assert.notEqual(v.addressSeed, first, 'a vehicle shuttled to the same address forever')
})

test('a vehicle drives between two different street cells, never from one to itself', () => {
  // A route whose ends are the same cell has zero length, and a car on it never moves — it
  // would read as a car abandoned in the road.
  for (let seed = 0; seed < 200; seed++) {
    const ends = routeEndpoints(newVehicle(seed), 17)
    assert.ok(ends, `seed ${seed} got no route at all`)
    assert.notEqual(ends.from, ends.to, `seed ${seed} drives from cell ${ends.from} to itself`)
    for (const i of [ends.from, ends.to]) {
      assert.ok(Number.isInteger(i) && i >= 0 && i < 17, `seed ${seed} picked cell ${i} of 17`)
    }
  }
})

test('a town with nowhere to drive between gets no route', () => {
  // One street cell is not a journey, and no streets at all is the state every colony starts
  // in. Both have to answer "nothing", not a route of length zero that a car sits on.
  assert.equal(routeEndpoints(newVehicle(1), 1), null)
  assert.equal(routeEndpoints(newVehicle(1), 0), null)
})

test('cars do not all start from the same place', () => {
  // The whole point. Every ambient car used to set off from the depot cell, which nothing
  // revealed until they kept their distance from each other and formed one long queue out of
  // it, across the grass, for the entire colony to see.
  const origins = new Set()
  for (let seed = 0; seed < 40; seed++) origins.add(routeEndpoints(newVehicle(seed), 150).from)
  assert.ok(origins.size > 20, `40 cars started from only ${origins.size} places`)
})

// ── bicycles ─────────────────────────────────────────────────────────────────────────

test('bicycles stand across the kerb, not along it', () => {
  // Nose-in, the way a bike stands in a rack: a bicycle is 0.394 long and the parking strip
  // outside the yellow line is 0.456 wide, so across is the one orientation that fits. Along
  // the kerb it would either stick out into the running lane or have to be scaled down.
  const bikes = parkedBikes(street(400), 0.9, 4)
  assert.ok(bikes.length > 0, 'a 400-tile street parked no bicycles at all')
  for (const bike of bikes) {
    // The street runs +z, so a bicycle across it faces +/-x — a quarter turn from the street's
    // own heading.
    const across = Math.abs(((bike.heading % Math.PI) + Math.PI) % Math.PI)
    assert.ok(
      Math.abs(across - Math.PI / 2) < 1e-9,
      `heading ${bike.heading} is along the street, not across it`
    )
  }
})

test('bicycles face away from the traffic they are parked beside', () => {
  // Nose to the kerb, tail to the road — a bike pointing into the carriageway reads as one
  // that fell over into it.
  for (const bike of parkedBikes(street(400), 0.9, 4)) {
    // On the -x kerb a bicycle faces -x; on the +x kerb, +x.
    const facingMinusX = Math.abs(bike.heading - Math.PI / 2) > Math.PI / 2
    assert.equal(bike.x < 0, facingMinusX, `bicycle at x=${bike.x} faces the road`)
  }
})

test('a bicycle never stands where a car is parked', () => {
  // The two draw from the same hash on the same space, so a space holds either a car or a rack
  // of bicycles and never both. This is the assertion that keeps them from being laid out
  // independently and quietly overlapping.
  const tiles = street(400)
  const cars = parkedCars(tiles, 0.9, 4)
  const bikes = parkedBikes(tiles, 0.9, 4)
  assert.ok(cars.length > 0 && bikes.length > 0, 'nothing to compare')
  for (const car of cars) {
    for (const bike of bikes) {
      const gap = Math.hypot(car.x - bike.x, car.z - bike.z)
      assert.ok(gap > 0.5, `a bicycle stands ${gap.toFixed(2)} from a parked car`)
    }
  }
})

test('bicycles come in groups, not one to a space', () => {
  // One bicycle on its own reads as litter; a rack of them reads as a street. Every space that
  // gets bicycles gets more than one, side by side along the kerb.
  const bikes = parkedBikes(street(40), 0.9, 4)
  const spaces = new Map()
  for (const bike of bikes) {
    const k = `${bike.x.toFixed(2)}`
    spaces.set(k, (spaces.get(k) ?? 0) + 1)
  }
  for (const [, n] of spaces) assert.ok(n > 1, 'a space held a single bicycle')
})

test('bicycle racks are deterministic, like everything else at the kerb', () => {
  assert.deepEqual(parkedBikes(street(40), 0.9, 8), parkedBikes(street(40), 0.9, 8))
})

test('no ambient route ever leaves the street network', () => {
  // The regression this exists for, in the owner's own words about the running app: cars driving
  // over the grass. `OFF_ROAD_COST` makes tarmac a preference rather than a requirement, so
  // even with both ends on the network 20 of these 40 routes cut a corner across the verge —
  // 23 cells of grass in total. A delivery is allowed to leave the road; through traffic is not.
  const streets = planStreets()
  let offRoad = 0
  for (let seed = 0; seed < 60; seed++) {
    const ends = routeEndpoints(newVehicle(seed), streets.cells.length)
    const path = roadCells(streets.cells[ends.from], streets.cells[ends.to], streets.all, { strict: true })
    assert.ok(path, `seed ${seed} got no street-only route on a connected network`)
    offRoad += path.filter((c) => !streets.all.has(`${c.x},${c.z}`)).length
  }
  assert.equal(offRoad, 0, `${offRoad} cells of an ambient route are not street`)
})
