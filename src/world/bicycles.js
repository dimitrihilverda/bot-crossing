import * as THREE from 'three'
import { ATLAS, CELL_CITY, atlasTexture, cellMask, hasPart } from './kit.js'
import { Composer, buildingUniforms, decorate } from './buildings.js'
import { roadSurfaceY } from './road-mesh.js'

/**
 * The bicycles standing at the kerb.
 *
 * One merged geometry and one draw call for the whole colony, the way the carriageway and the
 * town are built — not an instanced fleet like the cars. A bicycle never moves, never belongs
 * to a thread and never changes colour, so there is nothing per-frame to write and nothing to
 * gain from carrying a matrix per bicycle. `parkedBikes` in `traffic.js` decides where they
 * go and which way they face; this only puts them there.
 *
 * Where the model itself comes from — and why the one part of the city kit Kay did not make is
 * a bicycle — is in `tools/build-bike.mjs`.
 */

/** The kit part, grafted into the city kit by `tools/build-bike.mjs`. */
export const BIKE_PART = 'bicycle'

/**
 * What colour a bicycle's frame comes out.
 *
 * The frame samples the city atlas's accent cell, which is a warm terracotta unpainted — so
 * without this every bicycle in the colony would be rust-coloured. Dutch bicycles are black,
 * overwhelmingly and unglamorously, and a black frame is also what lets the saddle and the
 * grey bars read at all against it.
 */
export const BIKE_TINT = 0x1b1f24

const CELL_COUNT = ATLAS.cols * ATLAS.rows
const BIKE_ROUGHNESS = new Float32Array(CELL_COUNT).fill(0.7)
const BIKE_METAL = new Float32Array(CELL_COUNT).fill(0.1)
const ACCENT_MASK = cellMask([CELL_CITY.ACCENT])

/**
 * The same uniform block the cars use, for the same reason: `decorate` is what repaints the
 * accent cell, and without going through it a bicycle cannot be tinted at all. `uProgress` is
 * pinned at 1 and `uSink` at 0 — a bicycle is whole from its first frame and never rises out
 * of the ground the way a building under construction does.
 */
function bicycleUniforms(geo) {
  return {
    uProgress: { value: 1 },
    uMaxY: { value: geo.boundingBox.max.y },
    uMinY: { value: geo.boundingBox.min.y },
    uSink: { value: 0 },
    uAccent: { value: new THREE.Color(BIKE_TINT) },
    uNight: buildingUniforms.uNight,
    uTime: buildingUniforms.uTime,
    uCellAccent: { value: ACCENT_MASK },
    uCellRoughness: { value: BIKE_ROUGHNESS },
    uCellMetalness: { value: BIKE_METAL },
  }
}

/**
 * Every bicycle in the colony, as one mesh.
 *
 * Returns an empty group rather than throwing when the kit has no bicycle in it — the same
 * all-or-nothing gate `createRoads` uses for its own parts, so a colony built against an older
 * `city.glb` loses its bicycles and keeps its streets.
 *
 * @param bikes `[{x, z, heading}]` from `parkedBikes`
 * @param groundAt samples the terrain, the same function the road is laid against
 */
export function createBicycles({ bikes, groundAt }) {
  const group = new THREE.Group()
  group.userData.dispose = () => {}
  if (!bikes?.length || !hasPart(BIKE_PART, 'city')) return group

  const composer = new Composer({ kit: 'city' })
  for (const bike of bikes) {
    // On the road surface, not on the ground: a rack stands in the parking strip, which is
    // asphalt. The model's own origin is already its contact patch — unlike the cars', which
    // is why they need `CAR_GROUND_DROP` and this does not.
    composer.add(BIKE_PART, {
      x: bike.x,
      y: roadSurfaceY(groundAt(bike.x, bike.z)),
      z: bike.z,
      ry: bike.heading,
    })
  }

  const geo = composer.finish()
  geo.computeBoundingBox()
  const mesh = new THREE.Mesh(
    geo,
    decorate(
      new THREE.MeshStandardMaterial({ map: atlasTexture('city'), roughness: 0.7, metalness: 0.1 }),
      bicycleUniforms(geo)
    )
  )
  mesh.castShadow = true
  mesh.receiveShadow = true
  group.add(mesh)

  group.userData.dispose = () => {
    geo.dispose()
    mesh.material.dispose()
  }
  return group
}
