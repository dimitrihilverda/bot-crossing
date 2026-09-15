import * as THREE from 'three'
import { ATLAS, CELL_CITY, atlasTexture, cellMask, loadKit, part } from './kit.js'
import { Composer, buildingUniforms, decorate } from './buildings.js'
import { TRAFFIC_BODIES } from './traffic.js'
import { CAR_SCALE, WHEEL_RADIUS, wheelSpin } from './deliveries.js'

/**
 * Ambient traffic, rendered: cars that no thread owns, driving the streets in neutral paint.
 *
 * This is `Deliveries` (`src/world/deliveries.js`) read closely and copied, not extended —
 * see that module's own doc for why a car is a kit body plus four separately-named wheels,
 * how `Composer` is called with `solo` to get a part's own local frame, how `readWheelOffsets`
 * finds where the wheels sit without ever naming which corner is which, how wheel spin is a
 * quaternion about the X axis, and why every instanced mesh here sets `frustumCulled = false`
 * — the same reason `astronauts.js` gives its own instanced parts: one bounding volume,
 * computed from a single instance's geometry, is useless for deciding whether a whole fleet
 * scattered across the colony is on screen.
 *
 * `Deliveries` is not touched to share any of this: it carries delivery behaviour that
 * three reviews and a 600-frame hand verification have signed off, and generalising it to
 * also cover ambient traffic risks that behaviour for a saving that is, at most, about sixty
 * lines. What *is* shared is everything already exported and pure from that module —
 * `CAR_SCALE`, `WHEEL_RADIUS`, `wheelSpin` — because sharing a constant or a pure function
 * cannot regress a signed-off class the way sharing its instancing code could.
 *
 * Two shapes this class does **not** share with `Deliveries`, both on purpose:
 *
 * - **Four bodies, not one.** `TRAFFIC_BODIES` (`traffic.js`) deliberately excludes the
 *   stationwagon, which is the delivery car's signature — see that module's doc. So this
 *   class geometry-builds all four ambient bodies once, keyed by name, rather than the one
 *   shared body `Deliveries` builds.
 * - **No roof load, ever.** The load is what makes a delivery car read as "a thread is being
 *   worked on"; ambient traffic must never carry one, so there is no load mesh, no load
 *   geometry and no load material anywhere in this file.
 *
 * Bucketing follows the same logic as `Deliveries`' per-accent pairs, for the same reason —
 * `decorate()`'s `uAccent` is one value per *material*, so two paints cannot share a mesh —
 * except the axis being bucketed is body-and-tint together rather than accent alone, because
 * here the geometry itself also varies (four different car shapes). `bucketKey()` names that
 * pair; the palette is `TRAFFIC_BODIES.length * TRAFFIC_TINTS.length` (4 x 5 = 20), so the
 * mesh-pair count is bounded by the palette and cannot grow with how long the app has run.
 */

/** One instanced-mesh pair per body-and-tint pair: a geometry carries one material. */
export const bucketKey = (vehicle) => `${vehicle.body}:${vehicle.tint}`

/**
 * Surface response for the fleet, one value for the whole atlas — the same call
 * `Deliveries` makes for its own car paint, since this is the same kit and the same rough
 * matte-panel-and-glass scale.
 */
const CELL_COUNT = ATLAS.cols * ATLAS.rows
const CAR_ROUGHNESS = new Float32Array(CELL_COUNT).fill(0.6)
const NO_METAL = new Float32Array(CELL_COUNT).fill(0)
const ACCENT_MASK = cellMask([CELL_CITY.ACCENT])

const Y_AXIS = new THREE.Vector3(0, 1, 0)
const X_AXIS = new THREE.Vector3(1, 0, 0)

/**
 * The four wheel-node names for one body, following the kit's own naming: every car in
 * `city.glb` names its wheels `<body>_wheel_front_left` and so on (verified for all four
 * `TRAFFIC_BODIES` with `tools/list-parts.mjs public/assets/city.glb car` while writing this
 * module — the same naming `CAR_PARTS` in `deliveries.js` hand-writes for the stationwagon).
 */
function wheelPartNames(body) {
  return [`${body}_wheel_front_left`, `${body}_wheel_front_right`, `${body}_wheel_rear_left`, `${body}_wheel_rear_right`]
}

/**
 * The four wheels' positions relative to one body, read from the kit rather than hand-typed.
 * See `readWheelOffsets` in `deliveries.js` for the full reasoning — this is that function,
 * parameterised on the body name because this class builds four bodies, not one.
 */
function readWheelOffsets(body) {
  const [frontLeft] = wheelPartNames(body)
  const assembled = part(body, 'city') // body + all 4 wheels, each already placed
  const bodyOnly = part(body, 'city', { solo: true })
  const wheelShape = part(frontLeft, 'city', { solo: true })

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
 * One uniform block per mesh — `uSink` is 0 and `uProgress` pinned at 1, the same as
 * `Deliveries`: a car is whole from its first frame and never rises out of the ground.
 */
function vehicleUniforms(geo, tint) {
  return {
    uProgress: { value: 1 },
    uMaxY: { value: geo.boundingBox.max.y },
    uMinY: { value: geo.boundingBox.min.y },
    uSink: { value: 0 },
    uAccent: { value: new THREE.Color(tint) },
    uNight: buildingUniforms.uNight,
    uTime: buildingUniforms.uTime,
    uCellAccent: { value: ACCENT_MASK },
    uCellRoughness: { value: CAR_ROUGHNESS },
    uCellMetalness: { value: NO_METAL },
  }
}

function carMaterial(geo, tint) {
  return decorate(
    new THREE.MeshStandardMaterial({
      map: atlasTexture('city'),
      roughness: 0.6,
      metalness: 0,
      emissive: 0x000000,
      side: THREE.FrontSide,
    }),
    vehicleUniforms(geo, tint)
  )
}

/**
 * Ambient traffic on the streets: cars nobody owns, in neutral paint, carrying nothing.
 *
 * See the module doc for why this duplicates `Deliveries`' instancing shape instead of
 * sharing it, and for the two things ("four bodies", "no load") that make this class not a
 * drop-in reuse of that one.
 */
export class TrafficCars {
  constructor(scene, capacity = 16) {
    this.scene = scene
    this.capacity = capacity
    // Built once per body name in `_build()`: body -> { bodyGeo, wheelGeo, wheelOffsets }.
    this._bodyGeom = new Map()
    // Lazily created, one entry per `bucketKey()` value: key -> { bodies, wheels, wheelOffsets }.
    this._pairs = new Map()
    this._disposed = false
    this._built = false

    // Reused every frame, to keep `update()` allocation-free.
    this._dummy = new THREE.Object3D()
    this._yaw = new THREE.Quaternion()
    this._spin = new THREE.Quaternion()
    this._offset = new THREE.Vector3()

    // Guarded exactly as `Deliveries` guards its own construction — `loadKit()` throws
    // synchronously outside a bundler (a plain `node --test` run has none), and construction
    // should not fail just because nothing is there to fetch a kit. `_built` simply stays
    // false, same as "still loading".
    try {
      loadKit().then(() => {
        if (this._disposed) return
        this._build()
      })
    } catch {
      // No bundler in this process.
    }
  }

  /** Requires `loadKit()` to have resolved — see the constructor. Builds the geometry shared
   *  by every tint's mesh pair for each body; each pair's own material (and its own fixed
   *  `uAccent`) is what actually varies, made lazily in `_pairFor()`. */
  _build() {
    for (const body of TRAFFIC_BODIES) {
      const [frontLeft] = wheelPartNames(body)
      const bodyGeo = new Composer({ kit: 'city' }).add(body, { solo: true, s: CAR_SCALE }).finish()
      const wheelGeo = new Composer({ kit: 'city' }).add(frontLeft, { solo: true, s: CAR_SCALE }).finish()
      const wheelOffsets = readWheelOffsets(body).map((v) => v.multiplyScalar(CAR_SCALE))
      this._bodyGeom.set(body, { bodyGeo, wheelGeo, wheelOffsets })
    }
    this._built = true
  }

  /** Every mesh the fleet owns. `dispose()` and the settings sweep both walk this, so a pair
   *  added later cannot be missed by either. */
  *_meshes() {
    for (const pair of this._pairs.values()) {
      yield pair.bodies
      yield pair.wheels
    }
  }

  /**
   * The mesh pair for one (body, tint) bucket, creating it the first time that pair is
   * needed. Returns `null` for a body outside `TRAFFIC_BODIES` (or before `_build()` has
   * run) rather than throwing — a caller that hands back a bad body should drop that
   * vehicle for the frame, not take the whole fleet down.
   */
  _pairFor(key, body, tint) {
    let pair = this._pairs.get(key)
    if (pair) return pair

    const geom = this._bodyGeom.get(body)
    if (!geom) return null

    const bodies = new THREE.InstancedMesh(geom.bodyGeo, carMaterial(geom.bodyGeo, tint), this.capacity)
    const wheels = new THREE.InstancedMesh(geom.wheelGeo, carMaterial(geom.wheelGeo, tint), this.capacity * 4)
    for (const mesh of [bodies, wheels]) {
      mesh.castShadow = true
      mesh.receiveShadow = true
      mesh.count = 0
      mesh.frustumCulled = false
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    }

    pair = { bodies, wheels, wheelOffsets: geom.wheelOffsets }
    this._pairs.set(key, pair)
    this.scene.add(bodies, wheels)
    return pair
  }

  /** `vehicles` are `{ x, y, z, heading, distance, body, tint }` for every ambient car
   *  currently on the road. A no-op until the kit has resolved and the shared geometry
   *  exists. */
  update(vehicles) {
    if (!this._built) return

    const buckets = new Map()
    for (const v of vehicles) {
      const key = bucketKey(v)
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = { body: v.body, tint: v.tint, list: [] }
        buckets.set(key, bucket)
      }
      bucket.list.push(v)
    }

    for (const [key, bucket] of buckets) {
      const pair = this._pairFor(key, bucket.body, bucket.tint)
      if (pair) this._writeBucket(pair, bucket.list)
    }

    // A pair that held cars on some earlier frame but none this frame must be emptied —
    // a stale `count` would leave last frame's cars parked in the street, exactly the
    // failure `Deliveries.update` avoids the same way.
    for (const [key, pair] of this._pairs) {
      if (buckets.has(key)) continue
      pair.bodies.count = 0
      pair.wheels.count = 0
      pair.bodies.instanceMatrix.needsUpdate = true
      pair.wheels.instanceMatrix.needsUpdate = true
    }
  }

  /** Writes one bucket's cars into its own mesh pair, capped at `this.capacity` bodies (and
   *  therefore `this.capacity * 4` wheels). */
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

      for (const offset of pair.wheelOffsets) {
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

  /** Frees every mesh and every geometry the fleet owns. Geometry is disposed once per body
   *  (it is shared across that body's up-to-five tint pairs) rather than once per mesh, so a
   *  body that got several tint pairs does not get its geometry's `dispose()` called several
   *  times over — unlike materials, which are already one-per-pair and unique. */
  dispose() {
    this._disposed = true // in case the kit resolves after this call
    for (const mesh of this._meshes()) {
      mesh.material.dispose()
      this.scene.remove(mesh)
    }
    for (const geom of this._bodyGeom.values()) {
      geom.bodyGeo.dispose()
      geom.wheelGeo.dispose()
    }
    this._pairs.clear()
    this._bodyGeom.clear()
  }

  /** Walks every mesh generically, the way `Deliveries` does, so a pair added later is
   *  covered here for free instead of going unshadowed because someone forgot to list it by
   *  name. */
  onSettingsChanged(changed) {
    if (!changed.has('shadows')) return
    for (const mesh of this._meshes()) {
      mesh.castShadow = true
      mesh.receiveShadow = true
    }
  }
}
