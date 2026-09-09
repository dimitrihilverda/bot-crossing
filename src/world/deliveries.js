/**
 * The delivery vehicles: a loaded car per thread, driving between the depot and a plot.
 *
 * There is no van in the city kit — it ships five cars and no cargo vehicle, and the paid
 * tier adds park assets rather than vehicles (see the spec's Stage 2 section). So the
 * vehicle is the estate car with a load on its roof. Staying inside the city kit is worth
 * more than a closer-shaped model from elsewhere: it shares the houses' atlas, so it merges
 * and takes the repo's accent from the same repainted cell, and its wheels are separate
 * nodes, which is what `kit.js`'s `solo` mode exists for.
 */

/** The kit nodes a car is assembled from. Verified against city.glb by the test. */
export const CAR_PARTS = Object.freeze({
  body: 'car_stationwagon',
  wheelFrontLeft: 'car_stationwagon_wheel_front_left',
  wheelFrontRight: 'car_stationwagon_wheel_front_right',
  wheelRearLeft: 'car_stationwagon_wheel_rear_left',
  wheelRearRight: 'car_stationwagon_wheel_rear_right',
})

/** Authored on the city pack's grid and scaled once, the way HOUSE_SCALE does in houses.js. */
export const CAR_SCALE = 1.45

/**
 * Wheel radius in world units: half `car_stationwagon_wheel_front_left`'s own bounding-box
 * height (0.1446 / 2 = 0.0723) times CAR_SCALE. Measured from city.glb, not guessed —
 * re-measure with step 3a's script if CAR_SCALE changes, or the wheels will visibly skid
 * instead of roll.
 */
export const WHEEL_RADIUS = 0.1048

/** World units per second. Tuned by eye in step 7; a colony crossing should take a few seconds. */
export const CAR_SPEED = 3.2

/**
 * How far a wheel of `radius` has rotated after rolling `distance`.
 *
 * Guards a zero radius rather than returning Infinity: a mis-measured constant should make
 * the wheels stop, which is obvious, instead of producing NaN transforms that silently
 * remove the whole instanced mesh from the scene.
 */
export function wheelSpin(distance, radius) {
  if (!radius) return 0
  return distance / radius
}
