import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { carriagewayHeight } from './road-mesh.js'

/**
 * The trees lining the streets.
 *
 * These are the one thing on the verge that does not come from the city kit — City Builder
 * Bits has no tree — so they cannot share a mesh, a material or an atlas with the lamps and
 * signals standing beside them. `cellFurniture` still decides where they go, marking each with
 * `kit: 'forest'`, which is what lets a tree take part in `reservedSlots` like any other
 * obstacle while being drawn by something else entirely. This is that something else.
 *
 * One merged geometry for the whole colony, the way the carriageway and the bicycles are
 * built: a tree never moves and never changes, so there is nothing per-frame to write.
 *
 * No `decorate()` here, unlike the buildings and the cars: a tree carries no repo's accent and
 * no construction reveal, so it wants the same plain atlas-mapped material the planet's own
 * scatter gives its trees.
 */

/** The kit these come out of, and the key `cellFurniture` marks them with. */
export const TREE_KIT = 'forest'

/**
 * Every street tree in the colony, as one mesh.
 *
 * Returns an empty group when the forest kit has not loaded or the verge has no trees on it —
 * the same all-or-nothing gate `createRoads` uses, so a colony missing the pack keeps its
 * streets and loses only its planting.
 *
 * @param furniture the whole verge list from `vergeFurniture`; the trees are picked out here
 * @param groundAt samples the terrain, the same function the road is laid against
 */
export function createStreetTrees({ furniture, groundAt }) {
  const group = new THREE.Group()
  group.userData.dispose = () => {}

  const trees = (furniture ?? []).filter((f) => f.kit === TREE_KIT && hasPart(f.part, TREE_KIT))
  if (!trees.length) return group

  const composer = new Composer({ kit: TREE_KIT })
  for (const tree of trees) {
    // The same height the carriageway beside it is laid at. A tree's own model reaches below
    // its origin — its roots run to -0.34 — so it beds into the ground rather than standing on
    // it, which is what keeps one from floating on a slope.
    composer.add(tree.part, {
      x: tree.x,
      y: carriagewayHeight(groundAt(tree.x, tree.z), tree.lift),
      z: tree.z,
      ry: tree.ry,
      s: tree.scale,
    })
  }

  const geo = composer.finish()
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: atlasTexture(TREE_KIT), roughness: 0.82, metalness: 0 })
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
