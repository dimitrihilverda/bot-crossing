import * as THREE from 'three'
import { Composer, decorate, depthMaterial, buildingUniforms } from './buildings.js'
import { ATLAS, CELL_CITY, CELL_FURNITURE, atlasTexture, cellMask } from './kit.js'
import { mulberry } from './planet.js'

/**
 * A thread's home — one per thread, assembled out of KayKit's *City Builder Bits* and
 * *Furniture Bits* (both CC0) and seeded from the thread's own id, so a session always gets
 * the same house on every reload.
 *
 * A house is a **group of two meshes**, not one:
 *
 * 1. The **shell**, from the city kit. Always whole. A house you can only see two thirds of
 *    is a building site, and the point of the theme is that the house is already yours.
 * 2. The **contents**, from the furniture kit, which arrive one piece at a time as the
 *    thread grows. This is where progress goes now: it stops sinking a structure into the
 *    ground and starts moving somebody in.
 *
 * Two meshes because the two packs have separate texture atlases, and a merged geometry can
 * only carry one material. Everything within a mesh still merges to a single draw call.
 *
 * **The furniture is out on the lot, not indoors.** Every shell in the city pack is a closed
 * solid — no cutaway, no window you can see through — so furniture placed inside it would
 * be furniture nobody ever sees, and the one thing this whole task is for is a house that
 * visibly fills up. So the pieces land around the house instead, in the order a real move
 * runs: rug down first, then the big things, then the lamp. It reads as moving-in day, and
 * it reads from the height the colony is actually viewed from.
 *
 * The two packs are also authored at wildly different scales — a city house is 2 units
 * across and a couch from the furniture pack is 3 — which is what `FURNITURE_SCALE` is for.
 */

/** Authored on the city pack's grid and scaled once, the way BUILDING_SCALE does for the base kit. */
const HOUSE_SCALE = 1.45

/**
 * Furniture, brought into the city pack's frame.
 *
 * The packs disagree by about six times: the furniture pack builds a room at roughly 1.5
 * units to the metre, the city pack builds a street at roughly a quarter of one. Without
 * this a single couch is wider than the house it belongs to.
 */
const FURNITURE_SCALE = 0.2

/**
 * Shell silhouettes, kept varied — a low bungalow, a narrow townhouse, a wide block — so a
 * plot of them reads as a street rather than a row of the same box.
 *
 * The `_withoutBase` variants, because the pack's base is a 2x2 pavement slab that would
 * cover the whole lot: these houses stand on the plot's own deck, like the space base
 * modules they replace, and the lot around them is where the furniture goes.
 */
const SHELLS = ['building_A_withoutBase', 'building_C_withoutBase', 'building_D_withoutBase']

/**
 * What arrives, in the order it arrives, placed in the shell's own frame.
 *
 * Big pieces first and the lamp last, so early progress is legible at colony altitude. The
 * coordinates were checked against the measured boxes of both packs: with the jitter below
 * at full swing every piece still clears the widest shell (x ±0.80, z ±0.65..0.80) and the
 * whole lot stays inside a footprint of 1.29, comfortably under the plot's slot spacing.
 *
 * Decorated variants are preferred wherever the pack has one: the pillows, rugs and inlays
 * are what UV into the furniture atlas's accent swatch, which is the cell the shader
 * repaints in the repo's colour.
 */
const CONTENTS = [
  { name: 'rug_rectangle_A', x: -0.22, z: 1.06 }, // the first thing anybody puts down
  { name: 'couch_pillows', x: -1.0, z: 0.05, ry: Math.PI / 2 },
  { name: 'bed_single_A', x: 1.04, z: 0.0 },
  { name: 'table_medium', x: 0.42, z: 1.06 },
  { name: 'chair_A', x: 0.42, z: 0.94, ry: Math.PI }, // tucked in at the table
  { name: 'cabinet_medium_decorated', x: -0.5, z: -0.95 },
  // Wall-mounted in the pack, so its box starts below its own origin; lifted back to the ground.
  { name: 'shelf_B_small_decorated', x: 0.5, z: -0.95, y: 0.02 },
  { name: 'lamp_standing', x: -1.0, z: 0.85 }, // last, and the tallest: the house is finished
]

/**
 * How far a piece the recipe does not deliberately aim may turn, in radians.
 *
 * Small on purpose. A lot laid out on exact axes reads as a showroom, but the clearances
 * above are only a few hundredths of a unit — a big swing walks a table into a wall.
 */
const JITTER = 0.18

const CELL_COUNT = ATLAS.cols * ATLAS.rows

/**
 * Surface response for the two new packs, one value for the whole atlas each.
 *
 * The base kit's per-cell table earns its keep because that pack mixes painted hull, bare
 * frame and photovoltaic glass. A house does not: brick, render, wood and fabric are all
 * matte and none of them is metal, and inventing a per-cell table for two atlases nobody
 * has surveyed would be guessing dressed up as data.
 */
const CITY_ROUGHNESS = new Float32Array(CELL_COUNT).fill(0.72)
const FURNITURE_ROUGHNESS = new Float32Array(CELL_COUNT).fill(0.82)
const NO_METAL = new Float32Array(CELL_COUNT).fill(0)

const CITY_ACCENT_MASK = cellMask([CELL_CITY.ACCENT])
const FURNITURE_ACCENT_MASK = cellMask([CELL_FURNITURE.ACCENT])

/**
 * When each furniture piece appears, as a fraction of thread progress.
 *
 * Evenly spaced rather than weighted: progress is already a log scale over transcript size,
 * and a second curve on top of it would compress the early pieces into invisibility — which
 * is exactly the range most real threads live in.
 *
 * The first threshold is pulled down to 0.05 because that is where a building's progress
 * floors while it is still visible: a thread that exists at all should have something in
 * the house.
 */
export function revealThresholds(count) {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = (i + 1) / count
  if (count > 0) out[0] = Math.min(out[0], 0.05)
  return out
}

/**
 * One uniform block per mesh, shared between its surface pass and its shadow pass.
 *
 * `uSink` is 0 for everything here. A house is whole from its first frame: progress means
 * "how much of this has arrived", not "how far out of the ground is it", and the same
 * uniform switches off the accent construction band that goes with rising.
 */
function houseUniforms(geo, accent, { accentMask, roughness }) {
  return {
    uProgress: { value: 1 },
    uMaxY: { value: geo.boundingBox.max.y },
    uMinY: { value: geo.boundingBox.min.y },
    uSink: { value: 0 },
    uAccent: { value: new THREE.Color(accent) },
    uNight: buildingUniforms.uNight,
    uTime: buildingUniforms.uTime,
    uCellAccent: { value: accentMask },
    uCellRoughness: { value: roughness },
    uCellMetalness: { value: NO_METAL },
  }
}

function materialise(geo, kit, uniforms) {
  const mesh = new THREE.Mesh(
    geo,
    decorate(
      new THREE.MeshStandardMaterial({
        map: atlasTexture(kit),
        // Roughness and metalness arrive per atlas cell; these are only the fallbacks.
        roughness: 0.7,
        metalness: 0,
        emissive: 0x000000, // additions in the shader are the only emission
        // Closed solids, and drawn single-sided for the same reason the base kit is: a floor
        // and the ceiling under it share a plane all over these packs, and drawing both
        // halves at identical depth is a colony of flickering surfaces.
        side: THREE.FrontSide,
      }),
      uniforms
    )
  )
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.userData.uniforms = uniforms
  return mesh
}

/** The house itself: one city part, dropped onto the deck and scaled to the plot. */
function buildShell(rand, accent) {
  const c = new Composer({ kit: 'city' })
  c.add(SHELLS[Math.floor(rand() * SHELLS.length)])
  const geo = c.finish()
  // The `_withoutBase` variants keep the base's thickness in their origin, so they float
  // a tenth of a unit above whatever they are put on. Sit it on the ground.
  geo.translate(0, -geo.boundingBox.min.y, 0)
  geo.scale(HOUSE_SCALE, HOUSE_SCALE, HOUSE_SCALE)
  geo.computeBoundingBox()

  const uniforms = houseUniforms(geo, accent, {
    accentMask: CITY_ACCENT_MASK,
    roughness: CITY_ROUGHNESS,
  })
  // No custom depth material here, unlike the space base: with uSink 0 and uProgress pinned
  // at 1 this mesh's vertices are exactly where three's own depth pass already puts them.
  return materialise(geo, 'city', uniforms)
}

/** Everything that moves in, tagged per piece with the progress it waits for. */
function buildContents(rand, accent) {
  const thresholds = revealThresholds(CONTENTS.length)
  const c = new Composer({ kit: 'furniture' })

  CONTENTS.forEach((piece, i) => {
    c.add(piece.name, {
      x: piece.x,
      y: piece.y ?? 0,
      z: piece.z,
      ry: piece.ry ?? (rand() - 0.5) * JITTER,
      s: FURNITURE_SCALE,
      reveal: thresholds[i],
    })
  })

  const geo = c.finish()
  geo.scale(HOUSE_SCALE, HOUSE_SCALE, HOUSE_SCALE)
  geo.computeBoundingBox()

  const uniforms = houseUniforms(geo, accent, {
    accentMask: FURNITURE_ACCENT_MASK,
    roughness: FURNITURE_ROUGHNESS,
  })
  const mesh = materialise(geo, 'furniture', uniforms)
  // Shadows need the reveal too, or the furniture that has not arrived still shades the lot.
  const depth = depthMaterial(uniforms)
  depth.side = THREE.BackSide
  mesh.customDepthMaterial = depth
  return mesh
}

/** How far a mesh reaches from its own centre, on the ground plane. */
function reach(box) {
  return Math.max(Math.abs(box.max.x), Math.abs(box.min.x), Math.abs(box.max.z), Math.abs(box.min.z))
}

/**
 * Build one house. `seed` is derived from the thread id, so the same session always gets the
 * same house and the same layout on its lot.
 *
 * The returned Group answers exactly what `createBuilding`'s Mesh answered, plus a
 * `dispose()` — see the note on it below.
 *
 * Requires `loadKit()` to have resolved — boot awaits it before the first roster arrives.
 */
export function createHouse({ seed = 1, accent = 0xc96442 } = {}) {
  const rand = mulberry(seed)
  const group = new THREE.Group()

  const shell = buildShell(rand, accent)
  const contents = buildContents(rand, accent)
  group.add(shell, contents)

  group.userData.label = 'House'
  group.userData.height = shell.geometry.boundingBox.max.y
  // Both meshes, because the furniture is out on the lot: the shell alone understates the
  // house by a third, and this number is what keeps the crew from walking through the couch.
  group.userData.footprint = Math.max(reach(shell.geometry.boundingBox), reach(contents.geometry.boundingBox))
  group.userData.progress = 1
  group.userData.setProgress = (p) => {
    const v = THREE.MathUtils.clamp(p, 0, 1)
    group.userData.progress = v
    // The shell is a house: it does not fade in. Only its contents track progress.
    contents.userData.uniforms.uProgress.value = v
    // A retiring thread still has to disappear, which is what colony.js waits on.
    group.visible = v > 0.02
  }

  // A Group owns two meshes, so it owns freeing them. colony.js used to reach in and dispose
  // a Mesh's geometry and material by hand; it cannot know what is in here — and a Group has
  // none of those three properties, so reaching in would throw on every retired thread.
  group.userData.dispose = () => {
    for (const mesh of [shell, contents]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.customDepthMaterial?.dispose()
    }
  }

  return group
}
