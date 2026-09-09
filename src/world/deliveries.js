import * as THREE from 'three'
import { ATLAS, CELL_CITY, atlasTexture, cellMask, loadKit, part } from './kit.js'
import { Composer, buildingUniforms, decorate } from './buildings.js'

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

// ── the scene half ───────────────────────────────────────────────────────────────────

/**
 * Surface response for the car, one value for the whole atlas — the same call `houses.js`
 * makes for the city pack: painted panels and glass here are both roughly matte at this
 * scale, and a per-cell table would be guessing dressed up as data.
 */
const CELL_COUNT = ATLAS.cols * ATLAS.rows
const CAR_ROUGHNESS = new Float32Array(CELL_COUNT).fill(0.6)
const NO_METAL = new Float32Array(CELL_COUNT).fill(0)
const ACCENT_MASK = cellMask([CELL_CITY.ACCENT])

/**
 * Fallback brand colour for a vehicle with no accent of its own — the same default
 * `houses.js`/`ship.js` fall back to for an unowned structure. Vehicles with no accent all
 * share the one mesh pair built for this colour (see `update()`), rather than each getting
 * a pair of their own.
 */
const DEFAULT_ACCENT = 0xc96442

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)

/**
 * The four wheels' positions relative to the body, read from the kit rather than
 * hand-typed.
 *
 * `part(CAR_PARTS.body, 'city')` *without* `solo` merges the body with all four wheel
 * children still attached, each already sitting at its correct offset. That offset only
 * survives in this merged copy: `solo` mode (used below for the render geometry, precisely
 * to drop the wheels) bakes a part into its *own* local frame, which is exactly what erases
 * the position we need here. So the body's own vertex count marks where the wheels' vertices
 * start in the merged buffer, and every wheel model in the kit has the same vertex count,
 * which is what makes each wheel's stretch of the buffer easy to find without ever naming
 * which corner it is — a mis-assigned corner is still a wheel in the right place, since all
 * four are visually identical.
 */
function readWheelOffsets() {
  const assembled = part(CAR_PARTS.body, 'city') // body + all 4 wheels, each already placed
  const bodyOnly = part(CAR_PARTS.body, 'city', { solo: true })
  const wheelShape = part(CAR_PARTS.wheelFrontLeft, 'city', { solo: true })

  const nBody = bodyOnly.attributes.position.count
  const nWheel = wheelShape.attributes.position.count
  const pos = assembled.attributes.position

  const offsets = []
  for (let w = 0; w < 4; w++) {
    const start = nBody + w * nWheel
    const min = new THREE.Vector3(Infinity, Infinity, Infinity)
    const max = new THREE.Vector3(-Infinity, -Infinity, -Infinity)
    for (let i = start; i < start + nWheel; i++) {
      min.min({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) })
      max.max({ x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) })
    }
    offsets.push(min.add(max).multiplyScalar(0.5))
  }

  assembled.dispose()
  bodyOnly.dispose()
  wheelShape.dispose()
  return offsets
}

/**
 * One uniform block per mesh — `uSink` is 0 and `uProgress` pinned at 1: a car is whole
 * from its first frame and never rises out of the ground the way a growing building does.
 *
 * `uAccent` is fixed for the lifetime of the material it's built for (see the module doc):
 * `decorate()` only has one `uAccent` per material, so the per-car colour comes from *which*
 * material — and therefore which `InstancedMesh` — a car is drawn with, not from a value
 * written here per instance.
 */
function carUniforms(geo, accent) {
  return {
    uProgress: { value: 1 },
    uMaxY: { value: geo.boundingBox.max.y },
    uMinY: { value: geo.boundingBox.min.y },
    uSink: { value: 0 },
    uAccent: { value: new THREE.Color(accent) },
    uNight: buildingUniforms.uNight,
    uTime: buildingUniforms.uTime,
    uCellAccent: { value: ACCENT_MASK },
    uCellRoughness: { value: CAR_ROUGHNESS },
    uCellMetalness: { value: NO_METAL },
  }
}

function carMaterial(geo, accent) {
  return decorate(
    new THREE.MeshStandardMaterial({
      map: atlasTexture('city'),
      roughness: 0.6,
      metalness: 0,
      emissive: 0x000000,
      // A closed solid, like every shell in the pack — nothing to see through.
      side: THREE.FrontSide,
    }),
    carUniforms(geo, accent)
  )
  // No custom depth material: with uSink 0 and uProgress pinned at 1, three's own depth pass
  // already puts every vertex exactly where this material does — the same reasoning
  // houses.js gives for its own shell.
}

/**
 * The delivery fleet: one `InstancedMesh` pair (car bodies + wheels) **per distinct accent
 * colour**, rather than one pair for the whole colony.
 *
 * `decorate()`'s `uAccent` is one uniform for the whole material (see `buildings.js`), and
 * three.js's own per-instance `instanceColor` cannot stand in for it: `instanceColor`
 * multiplies `diffuseColor` at `#include <color_fragment>`, which three concatenates
 * *before* `decorate()`'s accent-mix code runs, and on the accent swatch itself the mix is
 * `mix(diffuseColor, uAccent * …, accentAmount)` with `accentAmount == 1.0` — so
 * `diffuseColor` (and with it `instanceColor`) is discarded exactly where the per-car colour
 * was supposed to land, and multiplies in everywhere else instead (body paint, glass,
 * chrome). A prior version of this module tried that and had it backwards; see
 * `task-2-review.md` for the traced shader composition.
 *
 * So instead: group cars by accent and give each group its own mesh pair, each with its own
 * material cloned from the same `decorate()` recipe and its own fixed `uAccent`. The pair
 * count is bounded — `PLOT_PALETTE` (`src/world/plots.js`) holds 12 colours, and only
 * threads that are running, unread or errored get a car at all — so in practice this is a
 * handful of meshes, built lazily as an accent first appears (an accent that never shows up
 * costs nothing). This also closes the "stale colour in a reused slot" problem for free: a
 * slot's colour comes from which mesh it sits in, not from a per-instance buffer that might
 * not get rewritten.
 *
 * Each pair follows the colony's usual instancing shape: geometry built once (and shared
 * across every pair — only the material differs), `DynamicDrawUsage`, `count` and
 * `instanceMatrix.needsUpdate` written per frame.
 *
 * A car never carries the crew's own status marker — see the Stage 2 spec's rule on that —
 * so nothing here reaches toward that system at all.
 */
export class Deliveries {
  constructor(scene, capacity = 64) {
    this.scene = scene
    this.capacity = capacity
    // Lazily created, one entry per distinct accent value: accent -> { bodies, wheels }.
    this._pairs = new Map()
    this._wheelOffsets = []
    this._disposed = false
    this._built = false

    // Reused every frame, to keep `update()` allocation-free.
    this._dummy = new THREE.Object3D()
    this._yaw = new THREE.Quaternion()
    this._spin = new THREE.Quaternion()
    this._offset = new THREE.Vector3()

    // The kit may still be loading when the colony constructs its scenery — see the same
    // note on `Ship`'s constructor in ship.js. `loadKit()` is idempotent, so this just joins
    // whichever fetch is already in flight. Guarded: `loadKit()` reads
    // `import.meta.env.BASE_URL`, which only a bundler defines, so it throws synchronously
    // outside one (a plain `node --test` run, for instance) — construction should not fail
    // just because nothing is there to fetch a kit; `_built` simply stays false, same as
    // "still loading".
    try {
      loadKit().then(() => {
        if (this._disposed) return
        this._build()
      })
    } catch {
      // No bundler in this process.
    }
  }

  /**
   * Requires `loadKit()` to have resolved — see the constructor. Builds the geometry shared
   * by every accent's mesh pair; each pair's own material (and its own fixed `uAccent`) is
   * what actually varies per accent, made lazily in `_pairFor()`.
   */
  _build() {
    this._bodyGeo = new Composer({ kit: 'city' }).add(CAR_PARTS.body, { solo: true, s: CAR_SCALE }).finish()
    this._wheelGeo = new Composer({ kit: 'city' })
      .add(CAR_PARTS.wheelFrontLeft, { solo: true, s: CAR_SCALE })
      .finish()

    // Measured once, in the kit's own units, then brought into the same scaled frame the
    // rendered geometry is drawn at.
    this._wheelOffsets = readWheelOffsets().map((v) => v.multiplyScalar(CAR_SCALE))
    this._built = true
  }

  /**
   * The mesh pair for one accent colour, creating it the first time that colour is needed.
   * `accent` is used both as the `Map` key and, via `carMaterial()`, as the pair's fixed
   * `uAccent` — so two vehicles that share an accent value always land in the same pair, and
   * two different accents always land in different ones.
   */
  _pairFor(accent) {
    let pair = this._pairs.get(accent)
    if (pair) return pair

    const bodies = new THREE.InstancedMesh(this._bodyGeo, carMaterial(this._bodyGeo, accent), this.capacity)
    const wheels = new THREE.InstancedMesh(this._wheelGeo, carMaterial(this._wheelGeo, accent), this.capacity * 4)
    for (const mesh of [bodies, wheels]) {
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    }

    pair = { bodies, wheels }
    this._pairs.set(accent, pair)
    this.scene.add(bodies, wheels)
    return pair
  }

  /** `vehicles` are `{ x, y, z, heading, distance, accent }` for every car currently on the
   *  road. A no-op until the kit has resolved and the shared geometry exists. */
  update(vehicles) {
    if (!this._built) return

    // Bucket by accent first. A vehicle with no accent falls back to the same default
    // colour houses.js/ship.js use for an unowned structure — one shared pair, not a fresh
    // one every frame.
    const buckets = new Map()
    for (const v of vehicles) {
      const key = v.accent == null ? DEFAULT_ACCENT : v.accent
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = []
        buckets.set(key, bucket)
      }
      bucket.push(v)
    }

    for (const [accent, bucket] of buckets) {
      this._writeBucket(this._pairFor(accent), bucket)
    }

    // A pair that held cars on some earlier frame but none this frame must be emptied —
    // a stale `count` would leave last frame's cars parked where a thread used to run.
    for (const [accent, pair] of this._pairs) {
      if (buckets.has(accent)) continue
      pair.bodies.count = 0
      pair.wheels.count = 0
      pair.bodies.instanceMatrix.needsUpdate = true
      pair.wheels.instanceMatrix.needsUpdate = true
    }
  }

  /** Writes one accent's cars into its own mesh pair, capped at `this.capacity` bodies (and
   *  therefore `this.capacity * 4` wheels), the same cap the single shared mesh used to have. */
  _writeBucket(pair, vehicles) {
    const d = this._dummy
    let nBodies = 0
    let nWheels = 0

    for (const v of vehicles) {
      if (nBodies >= this.capacity) break

      d.position.set(v.x, v.y, v.z)
      d.quaternion.setFromAxisAngle(Y_AXIS, v.heading)
      d.scale.set(1, 1, 1)
      d.updateMatrix()
      pair.bodies.setMatrixAt(nBodies, d.matrix)
      nBodies++

      const spin = wheelSpin(v.distance, WHEEL_RADIUS)
      this._yaw.setFromAxisAngle(Y_AXIS, v.heading)
      this._spin.setFromAxisAngle(X_AXIS, spin)

      for (const offset of this._wheelOffsets) {
        // The offset is in the car's own frame; turn it the same way the body is turned
        // before adding it to the car's world position.
        this._offset.copy(offset).applyQuaternion(this._yaw)
        d.position.set(v.x + this._offset.x, v.y + this._offset.y, v.z + this._offset.z)
        // Yaw first, then roll about the wheel's own (now-turned) axle, so a wheel spins on
        // the right axis however the car is currently facing.
        d.quaternion.copy(this._yaw).multiply(this._spin)
        d.scale.set(1, 1, 1)
        d.updateMatrix()
        pair.wheels.setMatrixAt(nWheels, d.matrix)
        nWheels++
      }
    }

    pair.bodies.count = nBodies
    pair.wheels.count = nWheels
    pair.bodies.instanceMatrix.needsUpdate = true
    pair.wheels.instanceMatrix.needsUpdate = true
  }

  /** Frees every accent's mesh pair — iterated generically rather than by name, so a pair
   *  added later (a new accent showing up) cannot leak. */
  dispose() {
    this._disposed = true // in case the kit resolves after this call
    for (const pair of this._pairs.values()) {
      for (const mesh of [pair.bodies, pair.wheels]) {
        mesh.geometry.dispose()
        mesh.material.dispose()
        this.scene.remove(mesh)
      }
    }
    this._pairs.clear()
  }

  /** Iterates every accent's mesh pair generically, the way the crew props do, so a pair
   *  added later is covered here for free instead of leaking because someone forgot to list
   *  it by name. */
  onSettingsChanged(changed) {
    if (!changed.has('shadows')) return
    for (const pair of this._pairs.values()) {
      for (const mesh of [pair.bodies, pair.wheels]) {
        mesh.castShadow = true
        mesh.receiveShadow = true
      }
    }
  }
}
