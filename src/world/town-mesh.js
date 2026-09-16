import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { TOWN_CELL_RADIUS } from './street-plan.js'
import { blockContent, inTown } from './town-plan.js'

/**
 * The town: the buildings that fill whatever blocks the colony has not taken.
 *
 * Nothing here means anything. The colony is the data; this is the place it sits in. A block
 * the colony claims is simply not drawn, and `town-plan.js` is a pure function of position,
 * so a block that comes free again comes back exactly as it was.
 */

/**
 * The most geometry the town may add, in vertices — the colony's own count, measured in
 * Task 6 Step 1. Measured: a 40-project colony (`test/route-on-street.test.mjs`'s spread,
 * seeded `mulberry(40 * 7919)`, each project 1-4 threads) places 100 houses in total. Each
 * house (`src/world/houses.js`) draws one shell, picked uniformly from three `_withoutBase`
 * city-kit parts (819 + 1236 + 1581, mean 1212 vertices), plus the same fixed set of eight
 * furniture-kit pieces every house gets regardless of progress (48 + 712 + 600 + 260 + 458 +
 * 1341 + 632 + 304 = 4355 vertices — `aReveal` only discards fragments, it does not remove
 * vertices). 100 * (1212 + 4355) = 556,700, rounded down to 550,000.
 *
 * The spec's rule is that the scenery must not outweigh the thing it surrounds. If a later
 * change pushes past this, the levers, in order of fewest side effects: the frontage-gap
 * probability in `blockContent` (`town-plan.js`), the kit's `_withoutBase` building variants,
 * `GREEN_SHARE`, and last `TOWN_CELL_RADIUS` — which redraws the street network too, since
 * `street-plan.js` shares it.
 */
export const TOWN_VERTEX_BUDGET = 550000

/**
 * Every building the town wants to place.
 *
 * Pure, so the budget is testable without a renderer.
 *
 * @param streets the street membership set (`planStreets().all`)
 * @param claimed the cells the colony occupies, as `"x,z"` keys — these blocks are skipped
 * @returns `[{part, x, z, ry, scale}]`
 */
export function townPlan({ streets, claimed = new Set() }) {
  const out = []
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const k = `${x},${z}`
      if (streets.has(k) || claimed.has(k)) continue
      const cell = { x, z }
      if (!inTown(cell)) continue
      out.push(...blockContent(cell, streets).buildings)
    }
  }
  return out
}

/**
 * @param streets the street membership set
 * @param claimed the colony's cells, as `"x,z"` keys
 * @param groundAt `(x, z) => y`, the colony's terrain sampler
 * @returns a `THREE.Group` publishing `userData.dispose()`
 */
export function createTown({ streets, claimed, groundAt }) {
  const group = new THREE.Group()
  group.userData.dispose = () => {}
  if (!streets) return group

  const composers = new Map()
  for (const b of townPlan({ streets, claimed })) {
    if (!hasPart(b.part, 'city')) continue
    let composer = composers.get(b.part)
    if (!composer) {
      composer = new Composer({ kit: 'city' })
      composers.set(b.part, composer)
    }
    // A town building stands on the flattened ground, never on a deck: `townPlan` skips every
    // cell the colony claims, and the deck is exactly those cells.
    composer.add(b.part, { s: b.scale, x: b.x, y: groundAt ? groundAt(b.x, b.z) : 0, z: b.z, ry: b.ry })
  }

  const meshes = [...composers.values()].map(
    (c) =>
      new THREE.Mesh(
        c.finish(),
        // Unowned scenery: no accent, no construction reveal, so this skips `decorate()`
        // exactly as `road-mesh.js` does. The atlas `map` is not optional — without it every
        // building renders as flat grey plastic.
        new THREE.MeshStandardMaterial({ map: atlasTexture('city'), roughness: 0.8, metalness: 0.02 })
      )
  )
  for (const mesh of meshes) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  group.userData.dispose = () => {
    for (const mesh of meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.customDepthMaterial?.dispose()
    }
  }
  return group
}
