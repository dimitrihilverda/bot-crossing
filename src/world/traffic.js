/**
 * Ambient traffic: vehicles that no thread owns, driving out to an address, waiting there,
 * and coming back to the depot.
 *
 * Pure arithmetic and a four-state machine, with no three.js and no colony state, for the
 * same reason `drive-path.js` is: the failure modes here are a car frozen a hair short of
 * its destination and a car that never leaves, and both are invisible in a screenshot and
 * obvious in an assertion.
 *
 * **These vehicles mean nothing individually, and that is deliberate.** A stationwagon in a
 * repo's accent colour with a load on its roof means "a thread is being worked on" — the
 * signal stage 2 exists to carry. Nothing here may borrow that body, that colour source or
 * that roof load, which is why `TRAFFIC_BODIES` excludes the stationwagon and is asserted
 * to.
 *
 * The one thing ambient traffic does say is *how much* of it there is — but what carries the
 * meaning is the **increase**, not the total. The rule used to be stricter: no active threads,
 * no cars. A built town with nothing running then had genuinely empty streets, which reads as
 * a dead town rather than a quiet colony. So the count is now a baseline scaled to how much
 * street the town actually has, plus a share for activity on top. A busy colony still visibly
 * has busier streets than the same colony idle; an idle one is quiet rather than abandoned.
 *
 * Parked cars (`parkedCars`) carry no signal whatsoever, not even in their number: they are
 * scenery, fixed to the street rather than to anything the colony is doing.
 */

/**
 * The most vehicles that will ever be on the road at once.
 *
 * A ceiling on cost, not a design statement: every car on the road holds a cached route and
 * an instance slot, and nothing about the colony is clearer at sixty cars than at forty.
 */
export const MAX_TRAFFIC = 40

/** How many active threads it takes to put one more vehicle on the road. */
const THREADS_PER_VEHICLE = 4

/**
 * How many street cells the town gets one ambient car for, before any activity is counted.
 *
 * A density rather than a number, so a five-plot colony does not get a rush hour and a large
 * town does not look deserted. Tuned by eye against the shipping layout: 6 was the first try
 * and read as too still next to the number of cars standing at the kerb, so the moving share
 * was doubled and the parked share cut (`PARK_PERCENT`) — the balance between the two is what
 * makes a street look driven rather than photographed.
 *
 * What makes this density affordable is `headwayFactor`: cars following one another ease off
 * rather than driving through each other. Crossing traffic still can — see that function for
 * why braking on it would be worse than the overlap it prevents.
 */
const CELLS_PER_AMBIENT_CAR = 3

/** Seconds a vehicle stands at an address before heading back. */
export const DWELL_MIN = 4
export const DWELL_MAX = 12

/** World units per second. Slower than a delivery: ambient traffic should not draw the eye. */
export const TRAFFIC_SPEED = 2.4

/**
 * Bodies ambient traffic may wear. The stationwagon is absent on purpose — see the module
 * comment. The police car is last so the weighting below makes it the rare one.
 */
export const TRAFFIC_BODIES = Object.freeze(['car_hatchback', 'car_sedan', 'car_taxi', 'car_police'])

/** Neutral paint: greys, whites and blacks, and never a repo's accent. */
export const TRAFFIC_TINTS = Object.freeze([0xb8bcc0, 0x8e9398, 0xe8e9ea, 0x5a5f66, 0x2f3338])

/**
 * How many vehicles belong on the road, given how busy the colony is and how much street it
 * has to drive on.
 *
 * No streets, no traffic — and that is not a tuning choice: with nowhere to drive there is
 * nowhere to put a car, and it is the state every colony is in for the first few frames,
 * before `planStreets` has run once. Otherwise a baseline from the size of the town, at least
 * one car so a street is never empty, plus one per `THREADS_PER_VEHICLE` active threads,
 * capped.
 *
 * Monotonic in both arguments by construction, which the test asserts across the whole range
 * rather than at three sample points.
 */
export function trafficCount(activeThreads, streetCells = 0) {
  if (!(streetCells > 0)) return 0
  const baseline = Math.max(1, Math.floor(streetCells / CELLS_PER_AMBIENT_CAR))
  const busy = activeThreads > 0 ? Math.ceil(activeThreads / THREADS_PER_VEHICLE) : 0
  return Math.min(MAX_TRAFFIC, baseline + busy)
}

/**
 * A hash with a proper avalanche, so two vehicles seeded one apart do not come out looking
 * alike. `lowbias32`, the same finalizer the crew's hairstyles use — a plain multiply-xor
 * hash leaves the low bits correlated, which showed up in stage 3 as a hairstyle that
 * tracked skin tone.
 */
function lowbias32(x) {
  x |= 0
  x = (x ^ (x >>> 16)) >>> 0
  x = Math.imul(x, 0x7feb352d) >>> 0
  x = (x ^ (x >>> 15)) >>> 0
  x = Math.imul(x, 0x846ca68b) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

/**
 * A vehicle, fully determined by its seed so a reload puts the same cars on the road.
 *
 * Starts `parked`: a vehicle that began mid-journey would pop into being halfway down a
 * street the first frame the colony got busy.
 */
export function newVehicle(seed) {
  const h = lowbias32(seed)
  // The police car is the last body and gets a sixteenth of the draws rather than a
  // quarter, so it reads as a surprise rather than as a quarter of the traffic.
  const rare = (h >>> 28) === 0
  const body = rare
    ? TRAFFIC_BODIES[TRAFFIC_BODIES.length - 1]
    : TRAFFIC_BODIES[h % (TRAFFIC_BODIES.length - 1)]
  return {
    phase: 'parked',
    driven: 0,
    dwell: 0,
    body,
    tint: TRAFFIC_TINTS[lowbias32(seed + 1) % TRAFFIC_TINTS.length],
    addressSeed: lowbias32(seed + 2),
    // Where this car lives, and unlike `addressSeed` it never changes. A car is standing at
    // the start of its route whenever that route is replaced, so an origin that moved between
    // trips would teleport it across town in front of you. The destination may move freely,
    // because the car is at the other end when it does.
    originSeed: lowbias32(seed + 3),
  }
}

/**
 * The two street cells a vehicle shuttles between, as indices into the town's street list.
 *
 * Ambient traffic used to run from the depot to a house, every car from the same cell — which
 * nothing revealed until they started keeping their distance and formed a single queue out of
 * the depot and across the grass. It was never right: these cars own no thread and carry
 * nothing, so they have no business at the warehouse. They are through traffic, and through
 * traffic starts somewhere on the street.
 *
 * @param vehicle a vehicle from `newVehicle`
 * @param count how many street cells the town has
 * @returns `{from, to}` indices, never equal — or `null` when there is no journey to make,
 *   which is a town with fewer than two street cells and the state every colony starts in.
 */
export function routeEndpoints(vehicle, count) {
  if (!(count > 1)) return null
  const from = vehicle.originSeed % count
  const to = vehicle.addressSeed % count
  // A route from a cell to itself has zero length and a car that never moves, which reads as
  // one abandoned in the road. Nudging to the neighbouring index is enough: it cannot collide
  // with `from` again, because `count` is at least two.
  return { from, to: to === from ? (to + 1) % count : to }
}

/**
 * One frame of one vehicle. Returns a new object rather than mutating, so a caller cannot
 * accidentally share state between two vehicles.
 *
 * `routeLength` is the length of this vehicle's current route, and `random` a
 * zero-argument function returning [0, 1) — passed in rather than reaching for `Math.random`
 * so the dwell can be pinned in a test.
 *
 * Arrival is exact. `driven` lands on `routeLength` and on 0 rather than approaching them:
 * stage 1 shipped a defect where damping behind a threshold froze progress a strictly
 * positive distance short of its target forever, and the last piece of furniture in every
 * house was never drawn.
 */
export function stepVehicle(vehicle, dt, routeLength, random, speedScale = 1) {
  // No time has passed, so nothing happens — including the pull-away from `parked`. A
  // transition that fires on a zero-length frame is the same class of bug as one that fires
  // a frame late, and a negative `dt` would otherwise drive `driven` unboundedly away from
  // both ends of the route and grow `dwell` without limit. `growth.js`'s `stepProgress`
  // guards its own input the same way.
  if (!(dt > 0)) return vehicle

  const step = TRAFFIC_SPEED * dt * speedScale
  const next = { ...vehicle }

  if (next.phase === 'parked') {
    next.phase = 'out'
    next.driven = 0
    return next
  }

  if (next.phase === 'out') {
    next.driven = Math.min(routeLength, next.driven + step)
    if (next.driven >= routeLength) {
      next.driven = routeLength
      next.phase = 'waiting'
      next.dwell = DWELL_MIN + random() * (DWELL_MAX - DWELL_MIN)
    }
    return next
  }

  if (next.phase === 'waiting') {
    next.dwell -= dt
    if (next.dwell <= 0) {
      next.dwell = 0
      next.phase = 'back'
    }
    return next
  }

  // 'back'
  next.driven = Math.max(0, next.driven - step)
  if (next.driven <= 0) {
    next.driven = 0
    next.phase = 'parked'
    // A new address for the next run, so a vehicle does not shuttle to one house forever.
    next.addressSeed = lowbias32(next.addressSeed + 1)
  }
  return next
}

/**
 * The one road piece a car may park beside: a plain straight run.
 *
 * Never a junction, a bend, a T-split or a zebra crossing. Not a rule about realism so much
 * as about geometry — those pieces carry the carriageway through a turn or across another
 * street, and a car standing in one is a car standing in the middle of a junction.
 */
const PARKABLE_PART = 'road_straight'

/**
 * How many of the available kerbside spaces hold a car, in hundredths.
 *
 * 22, down from the 38 first tried. Both sides of every straight tile are a space, so 38 put a
 * car at nearly every second one and the street read as a car park with a road through it. The
 * point of these is to break up an empty kerb, not to line it — and they should be outnumbered
 * by the cars that are actually going somewhere (`CELLS_PER_AMBIENT_CAR`).
 */
const PARK_PERCENT = 22

/**
 * A hash of a tile, a side and a run seed, stable across reloads.
 *
 * The coordinates are world positions and so are floats; they are quantised to sixteenths
 * before hashing, which is far finer than the 2.4-unit tile pitch and coarse enough that the
 * last bits of a float cannot move a car from one frame to the next.
 */
function tileHash(tile, side, seed) {
  const x = Math.round(tile.x * 16) | 0
  const z = Math.round(tile.z * 16) | 0
  return lowbias32(lowbias32(lowbias32(x) ^ z) ^ ((side * 31 + seed) | 0))
}

/**
 * Cars standing at the kerb, given the carriageway tiles the town actually laid.
 *
 * These are scenery: they never move, they own no thread, and unlike the moving fleet their
 * number says nothing at all about the colony. What they do is make a street read as a street
 * — an empty carriageway with buildings along it looks like a model, not a town.
 *
 * Deterministic in the tile's own position rather than in an index or a draw order, so a
 * street parks the same cars whatever order the tiles arrive in and however many times the
 * town is rebuilt around them. A car that moved every time a plot was claimed elsewhere would
 * pull the eye exactly the way this is supposed not to.
 *
 * Sides are decided independently, and each car parks **on its own right** — the near kerb's
 * cars face one way and the far kerb's the other, the way a real street does. Parking every
 * car the same way round is the visible fault this avoids, and the test asserts against it.
 *
 * @param tiles carriageway tiles, `[{x, z, part, ry}]` as `carriagewayTiles` returns them
 * @param offset how far from the road's centre line a parked car stands
 * @param seed a run seed, so two colonies do not park identically
 * @returns `[{x, z, heading, distance, body, tint}]` — the shape `TrafficCars` renders, with
 *   `distance` fixed at 0 so a standing car's wheels do not turn
 */
export function parkedCars(tiles, offset, seed = 0) {
  const out = []
  for (const tile of tiles) {
    if (tile.part !== PARKABLE_PART) continue
    // A straight tile runs along its own +Z, turned by `ry` — the same convention `tileFor`
    // rotates it by and the one `test/road-corner-glb.test.mjs` pins against the glb.
    const d = { x: Math.sin(tile.ry), z: Math.cos(tile.ry) }
    for (const side of [1, -1]) {
      const h = tileHash(tile, side, seed)
      if (h % 100 >= PARK_PERCENT) continue
      // Body and tint come from `newVehicle` rather than being drawn here, so a parked car
      // cannot end up wearing the delivery stationwagon or a repo's accent by some later
      // edit to one pool and not the other.
      const paint = newVehicle(h)
      out.push({
        // Right of the direction this car faces: `(-d.z, d.x)` for the near kerb, and the
        // mirror of it for the far one.
        x: tile.x + side * -d.z * offset,
        z: tile.z + side * d.x * offset,
        heading: side > 0 ? tile.ry : tile.ry + Math.PI,
        distance: 0,
        body: paint.body,
        tint: paint.tint,
      })
    }
  }
  return out
}

/**
 * How close, centre to centre, a car will let itself get to the one in front.
 *
 * A little over one car length (0.938 authored times `CAR_SCALE`), so a queue settles nose to
 * tail with a gap rather than with bodies overlapping.
 */
export const HEADWAY = 1.6

/**
 * Whether two cars are going the same way closely enough for one to be following the other.
 *
 * Half a right angle either side. Anything blunter and a car brakes for one crossing a
 * junction; anything sharper and it stops seeing the car it is actually behind as it rounds
 * a bend.
 */
const SAME_WAY = Math.cos(Math.PI / 4)

/**
 * What fraction of its step a car may take this frame, given the other cars on the road.
 *
 * 1 with a clear road, tapering to 0 as the gap to the car in front closes. Tapering rather
 * than switching between go and stop: a car that only ever ran or stopped would judder behind
 * anything that waits, and ambient traffic exists precisely not to draw the eye.
 *
 * Three things are deliberately *not* braked for, and each is a way this rule could ruin the
 * street rather than improve it:
 *
 *  - **A car behind.** Obvious, but it is the difference between a queue and a deadlock.
 *  - **Oncoming traffic.** The two directions drive either side of the centre line and pass
 *    within a car's width of each other. Braking there would stop every car in the colony
 *    dead every time it met one.
 *  - **Anything crossing.** Cars have no right of way and no junction logic, so two may still
 *    pass through each other at a crossroads. That is a visible flaw at close range; braking
 *    on a perpendicular neighbour instead deadlocks every junction in the town, which is
 *    worse, and giving them real priority rules is a different piece of work.
 *
 * Parked cars are not passed in and must not be: they stand in the kerbside strip, well clear
 * of the running lane, and a moving car that braked for them would crawl the whole street.
 *
 * @param car `{x, z, heading}` — the car deciding how fast to go
 * @param others the other *moving* cars, in the same shape; `car` itself may be among them
 * @param gap the distance at which it starts to ease off, normally `HEADWAY`
 */
export function headwayFactor(car, others, gap) {
  const fx = Math.sin(car.heading)
  const fz = Math.cos(car.heading)
  let factor = 1

  for (const other of others) {
    if (other === car) continue
    const dx = other.x - car.x
    const dz = other.z - car.z
    const distance = Math.hypot(dx, dz)
    if (!(distance > 0) || distance >= gap) continue
    // In front, not behind or alongside.
    if (dx * fx + dz * fz <= 0) continue
    // Going the same way, so this is a car to follow rather than one to meet or to cross.
    if (Math.sin(other.heading) * fx + Math.cos(other.heading) * fz < SAME_WAY) continue
    factor = Math.min(factor, distance / gap)
  }

  return factor
}

/**
 * How many of the kerbside spaces a car did not take hold a rack of bicycles instead.
 *
 * Drawn from the same hash as `PARK_PERCENT`, immediately after it, so a space holds either a
 * car or bicycles and never both — and so the two can never be laid out independently and
 * quietly overlap.
 */
const BIKE_PERCENT = 26

/** How many bicycles stand in one space, and how far apart along the kerb. */
const BIKES_PER_RACK = 3
const BIKE_PITCH = 0.62

/**
 * Bicycles at the kerb, standing across it the way they stand in a rack.
 *
 * **Across, not along, and not against a wall.** A bicycle leaning on a facade is the Dutch
 * street's own image, and there is nowhere to lean one: `SET_BACK` in `town-plan.js` puts a
 * building's outer wall 0.05 from the carriageway's edge — the pavement was removed on purpose
 * — and a bicycle is 0.101 wide. What there *is* room for is the parking strip outside the
 * yellow line, 0.456 wide against a bicycle's 0.394 length, so nose-in is the one orientation
 * that fits there without either sticking into the running lane or being shrunk to fit.
 *
 * Nose to the kerb and tail to the road, because a bicycle pointing into the carriageway reads
 * as one that has fallen into it. Three to a space rather than one: a single bicycle at a kerb
 * reads as litter, a rack of them reads as a street.
 *
 * @param tiles carriageway tiles, as `carriagewayTiles` returns them
 * @param offset how far from the road's centre line the rack stands — `PARKING_LANE_OFFSET`
 * @param seed the run seed, shared with `parkedCars` so the two agree about who has which space
 * @returns `[{x, z, heading}]`
 */
export function parkedBikes(tiles, offset, seed = 0) {
  const out = []
  for (const tile of tiles) {
    if (tile.part !== PARKABLE_PART) continue
    const d = { x: Math.sin(tile.ry), z: Math.cos(tile.ry) }
    for (const side of [1, -1]) {
      const h = tileHash(tile, side, seed)
      const draw = h % 100
      // The band immediately above the cars', so the two partition the same spaces.
      if (draw < PARK_PERCENT || draw >= PARK_PERCENT + BIKE_PERCENT) continue

      const x = tile.x + side * -d.z * offset
      const z = tile.z + side * d.x * offset
      // A quarter turn off the street's own heading, pointing away from the carriageway: the
      // rack faces the kerb it stands against, not the traffic passing it.
      const heading = tile.ry - side * (Math.PI / 2)

      for (let i = 0; i < BIKES_PER_RACK; i++) {
        // Spread along the kerb, centred on the space, so a rack reads as a row rather than as
        // a heap on the tile's own centre.
        const along = (i - (BIKES_PER_RACK - 1) / 2) * BIKE_PITCH
        out.push({ x: x + d.x * along, z: z + d.z * along, heading })
      }
    }
  }
  return out
}
