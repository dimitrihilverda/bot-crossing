import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { Composer, decorate, buildingUniforms } from './buildings.js'
import { ATLAS, CELL_CITY, atlasTexture, cellMask, loadKit } from './kit.js'

/**
 * The depot. Every astronaut walks out of its loading dock when a thread appears and back in
 * when one is archived, so it is the colony's one fixed piece of narrative furniture — what
 * used to be the lander is now the yard the whole colony's crew works out of.
 *
 * **Fallback used, and why.** `city-parts.txt` has no warehouse, depot, shop, industrial,
 * garage or hangar shape — checked with
 * `grep -iE "warehouse|depot|shop|industrial|garage|hangar" city-parts.txt` before writing any
 * of this. Forcing one of the eight house shells to read as an industrial yard would be a
 * worse fit than admitting the pack does not have one, so this follows the brief's own honest
 * fallback: a large city shell — `building_G_withoutBase`, sized identically to `building_E`
 * and taller/deeper than every shell `houses.js` uses for an actual house — dressed with the
 * base kit's `containers_A` stacked in the yard behind it. The shell and the containers come
 * from different atlases (city vs. base), so — exactly as `houses.js` does for a house's shell
 * and its furniture — they are two meshes, not one merged geometry with a part's colours
 * sampled off the wrong texture.
 *
 * The loading dock, the rooftop beacon, the yard floodlights and the apron stay procedural,
 * as they were on the lander: they are operational dressing, not the building itself, and
 * none of them existed as a nameable part in either pack to begin with.
 */

/** Authored on the city pack's grid and scaled once, the way `HOUSE_SCALE` does for houses.js —
 *  bigger than `HOUSE_SCALE` (1.45) on purpose: this is the one structure meant to read as
 *  larger than any house, the yard the whole colony works out of. Picked so the shell's own
 *  corner-to-centre reach (~2.56) stays comfortably inside the fixed 3.4-unit circle
 *  `game/colony.js` already keeps crew clear of at this position. */
const DEPOT_SCALE = 2.0

/** The shell itself. `_withoutBase` because the plain variant's base is a 2x2 pavement slab
 *  that would double up with the apron this module already paints under it. */
const SHELL = 'building_G_withoutBase'

/**
 * `building_G_withoutBase`'s own bounding box, in the city pack's grid units — measured once
 * against `public/assets/city.glb` with a throwaway script built the same way `kit.js`'s own
 * `harvest()` bakes a part (a node's mesh, in that node's own local frame). Kept as data
 * because the dock, the beacon and the ring of yard lights all have to agree with where the
 * shell will actually sit *before* the shell has necessarily loaded — see the note on
 * `_buildFromKit()` below for why.
 */
const SHELL_BOUNDS = { minX: -1.0, maxX: 1.0, minY: 0.1, maxY: 2.35, minZ: -0.65, maxZ: 0.8 }

/** Crates stacked in the yard, in the base kit's own grid units — scaled by `CONTAINER_SCALE`
 *  after `finish()`, same order of operations `buildings.js` uses for its own recipes: offsets
 *  baked in before the merge, one uniform scale after it. Kept behind the shell (negative z)
 *  and inside its own footprint, so nothing pokes out past the loading dock at the front. */
const CONTAINER_SCALE = 1.4
const CONTAINER_SPOTS = [
  { x: -1.21, z: -0.64, ry: 0.32 },
  { x: -0.93, z: -0.93, ry: -0.41 },
  { x: 0.93, z: -0.93, ry: 0.18 },
  { x: 1.21, z: -0.64, ry: -0.27 },
  { x: 0.0, z: -1.14, ry: 0.5, y: 0.2 }, // one crate up on the pile
]

const CELL_COUNT = ATLAS.cols * ATLAS.rows

/**
 * Surface response for the shell, one flat value for the whole atlas — the same call
 * `houses.js` makes for the city and furniture packs: brick, render and glass here are all
 * matte, and a per-cell table would be guessing dressed up as data.
 */
const SHELL_ROUGHNESS = new Float32Array(CELL_COUNT).fill(0.7)
const NO_METAL = new Float32Array(CELL_COUNT).fill(0)
const SHELL_ACCENT_MASK = cellMask([CELL_CITY.ACCENT])

/** The colony's brand colour — the same default `houses.js`/`buildings.js` fall back to for an
 *  unowned structure. Nothing about the depot belongs to one thread, so unlike a house or a
 *  colony building it never takes a per-repo accent as an argument. */
const DEPOT_ACCENT = 0xc96442

export class Ship {
  constructor(scene, position) {
    this.group = new THREE.Group()
    this.group.position.copy(position)
    // Turned so the loading dock points back toward the middle of the colony.
    this.group.rotation.y = Math.atan2(-position.x, -position.z)
    this.group.name = 'depot'
    scene.add(this.group)
    this.scene = scene

    // Every dimension the dock, the beacon and the yard lights need, solved from the shell's
    // own measured bounds rather than from the shell itself — see `_buildFromKit()`.
    this.frontZ = SHELL_BOUNDS.maxZ * DEPOT_SCALE // the bulge that reads as the entrance
    this.shellHeight = (SHELL_BOUNDS.maxY - SHELL_BOUNDS.minY) * DEPOT_SCALE
    this.footRadius =
      Math.max(Math.abs(SHELL_BOUNDS.minX), SHELL_BOUNDS.maxX, Math.abs(SHELL_BOUNDS.minZ), SHELL_BOUNDS.maxZ) * DEPOT_SCALE

    this._buildDock() // sets doorLocal from where the dock actually ends
    this._buildLights()

    this.traffic = 0 // the dock glows brighter while crew or a car are using it

    /**
     * The shell and the yard are both built from the model kits, and the kits are not
     * necessarily loaded yet: `game/colony.js` constructs the depot synchronously in its own
     * constructor, and `main.js` only awaits `loadKit()` afterwards, once `boot()` runs — so
     * calling `part()` here directly throws ("no part named ... in the city kit") on every
     * single load. `loadKit()` is written to be idempotent and safe to call from anywhere —
     * "the first call owns the requests and everybody else awaits the same promise" — so this
     * just joins whichever fetch is already in flight rather than starting a second one, and
     * fills in the shell and the yard the moment it resolves.
     */
    loadKit().then(() => {
      if (this._disposed) return // archived/rebuilt before the kit ever arrived
      this._buildShell()
      this._buildYard()
    })
  }

  /** The building itself, assembled from one city-kit shell. Requires `loadKit()` to have
   *  resolved — see the constructor. */
  _buildShell() {
    const c = new Composer({ kit: 'city' })
    c.add(SHELL)
    const geo = c.finish()
    // The `_withoutBase` variant keeps the base's thickness in its origin, so it floats a
    // tenth of a unit above whatever it is put on — sit it flush on the ground.
    geo.translate(0, -geo.boundingBox.min.y, 0)
    geo.scale(DEPOT_SCALE, DEPOT_SCALE, DEPOT_SCALE)
    geo.computeBoundingBox()
    const box = geo.boundingBox

    const uniforms = {
      uProgress: { value: 1 },
      uMaxY: { value: box.max.y },
      uMinY: { value: box.min.y },
      // The depot is whole from its first frame — nothing sinks it out of the ground the way
      // a growing colony building does, and nothing about it reveals piece by piece.
      uSink: { value: 0 },
      uAccent: { value: new THREE.Color(DEPOT_ACCENT) },
      uNight: buildingUniforms.uNight,
      uTime: buildingUniforms.uTime,
      uCellAccent: { value: SHELL_ACCENT_MASK },
      uCellRoughness: { value: SHELL_ROUGHNESS },
      uCellMetalness: { value: NO_METAL },
    }

    this.shell = new THREE.Mesh(
      geo,
      decorate(
        new THREE.MeshStandardMaterial({
          map: atlasTexture('city'),
          roughness: 0.7,
          metalness: 0,
          emissive: 0x000000,
          // A closed solid, like every shell in the pack — nothing to see through.
          side: THREE.FrontSide,
        }),
        uniforms
      )
    )
    this.shell.castShadow = true
    this.shell.receiveShadow = true
    // No custom depth material: uSink is 0 and uProgress is pinned at 1, so three's own depth
    // pass already puts every vertex exactly where this mesh does.
    this.group.add(this.shell)
  }

  /**
   * The yard: base-kit cargo containers stacked behind the shell. A second mesh, not folded
   * into the shell's own geometry — the city and base kits have separate atlases, and a merged
   * geometry can only carry one material, so a container merged into the shell's buffer would
   * sample its colour off the wrong texture entirely. Requires `loadKit()` to have resolved.
   */
  _buildYard() {
    const c = new Composer({ kit: 'base' })
    for (const spot of CONTAINER_SPOTS) c.add('containers_A', spot)
    const geo = c.finish()
    geo.scale(CONTAINER_SCALE, CONTAINER_SCALE, CONTAINER_SCALE)

    // Plain material, no accent or night glow: yard clutter, not a building — the same
    // treatment `world/plots.js` gives base-kit props scattered on a plot.
    this.yard = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: atlasTexture('base'), roughness: 0.6, metalness: 0.05 }))
    this.yard.castShadow = true
    this.yard.receiveShadow = true
    this.group.add(this.yard)
  }

  /**
   * The loading dock: a flat plate at the shell's front face, since the shell sits flush on
   * the ground and there is no hatch to climb down from any more. Its length and the door
   * point are solved from where the shell's own front wall actually is, the way the lander's
   * ramp used to solve its length from the hatch and the ground.
   */
  _buildDock() {
    const width = 2.2
    const length = 2.0
    const nearZ = this.frontZ
    const farZ = nearZ + length

    const geo = new THREE.BoxGeometry(width, 0.12, length)
    geo.translate(0, 0.06, nearZ + length / 2)
    this.dock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.85, metalness: 0.05 }))
    this.dock.castShadow = true
    this.dock.receiveShadow = true
    this.group.add(this.dock)

    // Lane markings across the plate, the way a real loading bay paints its floor.
    const laneParts = []
    const steps = 5
    for (let i = 1; i < steps; i++) {
      const t = new THREE.BoxGeometry(width - 0.3, 0.03, 0.09)
      t.translate(0, 0.13, nearZ + (length * i) / steps)
      laneParts.push(t)
    }
    const laneGeo = merge(laneParts)
    const laneMesh = new THREE.Mesh(laneGeo, new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.6 }))
    this.group.add(laneMesh)

    // Lit edge strips down each side — brighten while the dock is busy, same technique as the
    // lander's ramp strips.
    const edgeParts = []
    for (const dx of [-width / 2 + 0.08, width / 2 - 0.08]) {
      const s = new THREE.BoxGeometry(0.1, 0.05, length - 0.2)
      s.translate(dx, 0.1, nearZ + length / 2)
      edgeParts.push(s)
    }
    this.stripMaterial = new THREE.MeshBasicMaterial({ color: 0xff9a3c, toneMapped: true })
    this.strips = new THREE.Mesh(merge(edgeParts), this.stripMaterial)
    this.group.add(this.strips)

    // Crew and cars appear and vanish a step beyond the dock plate, at ground level.
    this.doorLocal = new THREE.Vector3(0, 0, farZ + 0.6)
  }

  _buildLights() {
    // A rooftop hazard beacon — the industrial-yard equivalent of an aircraft strobe, and
    // just as much a fixture on a real depot as it was on a lander.
    this.beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: true })
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), this.beaconMaterial)
    this.beacon.position.set(0, this.shellHeight + 0.16, -0.3)
    this.group.add(this.beacon)

    // Floodlights ringing the yard.
    const pads = []
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const r = this.footRadius + 1.5
      const l = new THREE.SphereGeometry(0.11, 8, 6)
      l.translate(Math.cos(a) * r, 0.11, Math.sin(a) * r)
      pads.push(l)
    }
    this.padMaterial = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, toneMapped: true })
    this.padLights = new THREE.Mesh(merge(pads), this.padMaterial)
    this.group.add(this.padLights)

    // Plain asphalt under the depot — nothing about a delivery yard launches, so unlike the
    // lander's pad this is not scorched.
    const apron = new THREE.Mesh(
      new THREE.CircleGeometry(this.footRadius + 2.3, 32),
      new THREE.MeshStandardMaterial({ color: 0x3c3c42, roughness: 0.95 })
    )
    apron.rotation.x = -Math.PI / 2
    apron.position.y = 0.02
    apron.receiveShadow = true
    this.group.add(apron)
  }

  /** World position of the foot of the dock — where crew and cars appear and vanish. */
  shipDoor(out = new THREE.Vector3()) {
    return out.copy(this.doorLocal).applyMatrix4(this.group.matrixWorld)
  }

  update(dt, elapsed, night) {
    // Beacon: a double-blink, like a real hazard light.
    const t = elapsed % 2
    const strobe = t < 0.08 || (t > 0.2 && t < 0.28) ? 1 : 0.08
    this.beaconMaterial.color.setRGB(3.0 * strobe, 1.8 * strobe, 0.15 * strobe)

    const gain = 0.35 + night * 2.2
    this.padMaterial.color.setRGB(0.55 * gain, 0.82 * gain, 1.1 * gain)

    // Dock edge lights brighten while anyone is using the dock.
    this.traffic = Math.max(0, this.traffic - dt * 1.5)
    const busy = Math.min(1, this.traffic)
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * 4)
    const s = (0.5 + night * 1.2) * (1 + busy * pulse * 1.6)
    this.stripMaterial.color.setRGB(1.0 * s, 0.55 * s, 0.18 * s)
  }

  /** Called when the dock is used, so the lights react. */
  ping() {
    this.traffic = Math.min(2.5, this.traffic + 1)
  }

  dispose() {
    this._disposed = true // in case the kit resolves after this call
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
    this.scene.remove(this.group)
  }
}

/** Merge a set of same-material geometries into one draw call, disposing the originals. */
function merge(parts) {
  const geo = BufferGeometryUtils.mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return geo
}
