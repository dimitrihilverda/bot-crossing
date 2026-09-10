import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { DECK_TOP } from './plots.js'

/**
 * The street surface: a carriageway down the middle of each street cell, and the kit's own
 * furniture along the verge.
 *
 * A street cell is not a paved cell. A hex cell is 13.16 across — twenty-one car widths —
 * so paving one would read as a plaza. The carriageway is 2.5 wide and the rest is verge.
 *
 * **The 120 degree problem, stated plainly.** A path along the hex lattice turns in
 * multiples of 60 degrees. Every corner piece in the kit turns 90. There is no combination
 * of the six road pieces that makes a correct 120 degree bend, so at each bend this lays a
 * `road_junction` as a patch of carriageway and lets the two straights run into it. A
 * four-armed tile sits where two arms meet and the extra arms read as short stubs. That is
 * a visible compromise, it is not fixable with the parts in the pack, and no comment in
 * this file claims the markings line up. At the colony's resting camera distance of about
 * 36 units the stubs are a few pixels; that is the whole of the mitigation.
 */

/** Every road piece in the kit is a 2 x 2 square tile, 0.1 thick, centred on the origin. */
export const ROAD_TILE_SIZE = 2

/** How wide the driving surface is. The spec's number; a car is 0.61 wide. */
export const CARRIAGEWAY_WIDTH = 2.5

/** What a kit road tile has to be scaled by to become one carriageway width. */
export const roadTileScale = () => CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE

/** How many tiles are laid along one cell-to-cell hop. */
const TILES_PER_HOP = Math.ceil((7.6 * Math.sqrt(3)) / CARRIAGEWAY_WIDTH)

/**
 * Where each patch of carriageway goes, and what kind it is.
 *
 * Pure: plain numbers in, plain numbers out, so the geometry decisions are testable without
 * a renderer. `radius` is the hex size, passed in rather than imported so a test can use 1
 * and read the arithmetic directly.
 *
 * @param cells the street cells, in the order the road runs through them
 * @param radius hex size, centre to corner
 * @returns one entry per patch: `{ x, z, kind }`, `kind` being `'straight'` or `'junction'`
 */
export function carriagewayPoints(cells, radius) {
  const world = cells.map((c) => {
    const w = { x: radius * 1.5 * c.q, z: radius * Math.sqrt(3) * (c.r + c.q / 2) }
    return w
  })
  if (world.length === 1) return [{ x: world[0].x, z: world[0].z, kind: 'junction' }]

  const out = []
  const placed = new Set()
  const push = (x, z, kind) => {
    const k = `${x.toFixed(4)},${z.toFixed(4)}`
    if (placed.has(k)) return
    placed.add(k)
    out.push({ x, z, kind })
  }

  for (let i = 1; i < world.length; i++) {
    const a = world[i - 1]
    const b = world[i]
    for (let t = 0; t < TILES_PER_HOP; t++) {
      const f = t / TILES_PER_HOP
      push(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, 'straight')
    }
  }
  // The last cell centre, which no hop's loop reaches because each stops short of its end.
  const last = world[world.length - 1]
  push(last.x, last.z, 'straight')

  // Bends. A cell whose incoming and outgoing directions differ is a bend, and a bend gets
  // a junction patch on its centre, replacing whatever straight was laid there.
  for (let i = 1; i < world.length - 1; i++) {
    const prev = cells[i - 1]
    const here = cells[i]
    const next = cells[i + 1]
    const inDir = { q: here.q - prev.q, r: here.r - prev.r }
    const outDir = { q: next.q - here.q, r: next.r - here.r }
    if (inDir.q === outDir.q && inDir.r === outDir.r) continue
    const w = world[i]
    const k = `${w.x.toFixed(4)},${w.z.toFixed(4)}`
    const existing = out.find((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}` === k)
    if (existing) existing.kind = 'junction'
    else push(w.x, w.z, 'junction')
  }

  return out
}

// ── the scene half ───────────────────────────────────────────────────────────────────

/** The pieces this module draws, all from the city atlas. */
const STRAIGHT_PART = 'road_straight'
const JUNCTION_PART = 'road_junction'
const LAMP_PART = 'streetlight'

/**
 * Build the street surface for one street plan.
 *
 * One merged geometry for the carriageway and one for the lamps, so the whole street
 * network is two draw calls however large the colony grows. Merging is what the city
 * atlas is for: every piece in the kit UVs into a single 1024px gradient atlas, which is
 * the only reason a whole street can collapse into one mesh.
 *
 * Verge planting is **not** here. Trees, bushes and grasses live in `forest.glb`, a
 * different atlas, and a merged geometry carries one material — so they cannot join these
 * meshes. The verge reuses the existing scatter system instead.
 *
 * @param streets the `planStreets` result
 * @param groundAt `(x, z) => y`, the colony's own terrain sampler
 * @returns a `THREE.Group` publishing `userData.dispose()`
 */
export function createRoads({ streets, groundAt }) {
  const group = new THREE.Group()
  group.userData.dispose = () => {}
  if (!streets || !hasPart(STRAIGHT_PART, 'city') || !hasPart(JUNCTION_PART, 'city')) return group

  const runs = [streets.ring, ...streets.spurs.values()].filter((run) => run && run.length)
  if (!runs.length) return group

  const scale = roadTileScale()
  const straights = new Composer({ kit: 'city' })
  const junctions = new Composer({ kit: 'city' })
  let straightCount = 0
  let junctionCount = 0

  for (const run of runs) {
    for (const patch of carriagewayPoints(run, 7.6)) {
      const composer = patch.kind === 'junction' ? junctions : straights
      const name = patch.kind === 'junction' ? JUNCTION_PART : STRAIGHT_PART
      composer.add(name, { s: scale, x: patch.x, y: DECK_TOP, z: patch.z })
      if (patch.kind === 'junction') junctionCount++
      else straightCount++
    }
  }

  const meshes = []
  if (straightCount) meshes.push(new THREE.Mesh(straights.finish(), roadMaterial()))
  if (junctionCount) meshes.push(new THREE.Mesh(junctions.finish(), roadMaterial()))

  if (hasPart(LAMP_PART, 'city')) {
    const lamps = new Composer({ kit: 'city' })
    let lampCount = 0
    // One lamp every fourth patch along the ring, on the verge rather than the carriageway:
    // half a carriageway plus a little, out from the centre line.
    const offset = CARRIAGEWAY_WIDTH * 0.5 + 0.6
    const ringPatches = carriagewayPoints(streets.ring, 7.6)
    for (let i = 0; i < ringPatches.length; i += 4) {
      const p = ringPatches[i]
      const y = groundAt ? Math.max(DECK_TOP, groundAt(p.x + offset, p.z)) : DECK_TOP
      lamps.add(LAMP_PART, { s: 1.6, x: p.x + offset, y, z: p.z })
      lampCount++
    }
    if (lampCount) meshes.push(new THREE.Mesh(lamps.finish(), roadMaterial()))
  }

  for (const mesh of meshes) {
    mesh.receiveShadow = true
    mesh.castShadow = false
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

/**
 * The city kit's flat material, unowned by any repo: streets carry no accent and no
 * construction-progress reveal, so this skips `decorate()` (the reveal/accent shader
 * `houses.js` and `deliveries.js` wrap every *owned* city-kit mesh in) entirely — the same
 * plain, atlas-mapped `MeshStandardMaterial` `plots.js` gives its own unowned kit clutter.
 * Without the atlas `map` here every tile would render as flat grey plastic instead of the
 * kit's painted asphalt and markings; that omission was caught by reading `houses.js` as
 * this module's Step 5 requires, where every city-kit material carries `map: atlasTexture(kit)`.
 */
function roadMaterial() {
  return new THREE.MeshStandardMaterial({ map: atlasTexture('city'), roughness: 0.86, metalness: 0.02 })
}
