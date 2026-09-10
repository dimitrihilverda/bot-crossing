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
 * The one thing ambient traffic does say is *how much* of it there is: the count scales with
 * how many threads are active, so a busy colony has busy streets. That is atmosphere carried
 * by the volume, never by a particular car, and it is the only place this design lets
 * traffic mean anything at all.
 */

/** The most vehicles that will ever be on the road at once. */
export const MAX_TRAFFIC = 8

/** How many active threads it takes to put one more vehicle on the road. */
const THREADS_PER_VEHICLE = 4

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
 * How many vehicles belong on the road for a given number of active threads.
 *
 * Zero when nothing is active, one per `THREADS_PER_VEHICLE` after that, capped. Monotonic
 * by construction, which the test asserts across the whole range rather than at three
 * sample points.
 */
export function trafficCount(activeThreads) {
  if (!(activeThreads > 0)) return 0
  return Math.min(MAX_TRAFFIC, Math.ceil(activeThreads / THREADS_PER_VEHICLE))
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
  }
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
export function stepVehicle(vehicle, dt, routeLength, random) {
  const step = TRAFFIC_SPEED * dt
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
