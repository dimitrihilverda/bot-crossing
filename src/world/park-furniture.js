import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { carriagewayHeight } from './road-mesh.js'

/**
 * A park's hard furniture: the slabs of its path, the benches beside it, and the bin.
 *
 * The city-kit half of what `parkItems` (`town-plan.js`) lays out. Its other half — the trees,
 * bushes and grass — is forest-kit and goes to `createStreetTrees` instead, because the two
 * packs have their own atlases and so cannot share a mesh or a material. Each renderer takes
 * the items marked with its own kit and ignores the rest.
 *
 * One merged geometry for every park in the town, the way the carriageway and the bicycles are
 * built. None of it ever moves.
 *
 * No `decorate()`: a park bench carries no repo's accent and no construction reveal, so it
 * wants the same plain atlas-mapped material the road surface gets rather than the accent
 * shader the houses and cars are wrapped in.
 */
export function createParkFurniture({ items, groundAt }) {
  const group = new THREE.Group()
  group.userData.dispose = () => {}

  const own = (items ?? []).filter((f) => f.kit === 'city' && hasPart(f.part, 'city'))
  if (!own.length) return group

  const composer = new Composer({ kit: 'city' })
  for (const f of own) {
    composer.add(f.part, {
      x: f.x,
      y: carriagewayHeight(groundAt(f.x, f.z), f.lift),
      z: f.z,
      ry: f.ry,
      s: f.scale,
    })
  }

  const geo = composer.finish()
  const mesh = new THREE.Mesh(
    geo,
    new THREE.MeshStandardMaterial({ map: atlasTexture('city'), roughness: 0.86, metalness: 0.02 })
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
