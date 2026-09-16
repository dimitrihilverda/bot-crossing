import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { CELL_SIZE } from './grid.js'
import { DECK_TOP } from './plots.js'

/**
 * The street surface: a carriageway down the middle of each street cell. `createRoads` places
 * no verge furniture today — the streetlight pass was removed here and nothing replaces it yet;
 * a later task rebuilds lighting (and other verge furniture) along the whole network instead of
 * per ring patch.
 *
 * A street cell is not a paved cell. A cell is 12 units across — far wider than the
 * 2.4-wide carriageway needs — so paving one edge to edge would read as a plaza. The
 * carriageway runs down the middle and the rest is verge.
 *
 * Every bend on this square lattice is a right angle (see `grid.js`), so a bend gets a real
 * `road_corner` tile, and a three- or four-way meeting gets `road_tsplit` or `road_junction`.
 * Which piece a cell needs, and which way it is turned, comes from `tileFor` — a function of
 * that cell's own street neighbours, not of any path walked through them.
 */

/** Every road piece in the kit is a 2 x 2 square tile, 0.1 thick, centred on the origin. */
export const ROAD_TILE_SIZE = 2

/**
 * How wide the driving surface is. 12 / 5 = 2.4 divides a cell exactly, which is what makes
 * neighbouring tiles meet with no overlap and no gap; 2.5 does not, and would force either
 * coincident slabs at every cell boundary or a break in the road. A car is 0.61 wide.
 */
export const CARRIAGEWAY_WIDTH = 2.4

/** What a kit road tile has to be scaled by to become one carriageway width. */
export const roadTileScale = () => CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE

/**
 * How far above the sampled ground a carriageway patch's tile sits. A tile's `y` places its
 * *base*, not its centre (`road_straight`'s own bounding box runs from local y=0 to y=0.1,
 * not -0.05 to 0.05), so laying the base at `groundY` exactly would make it touch the
 * terrain's height field with zero gap at the sampled point.
 *
 * Measured in the running colony rather than assumed: at lift 0, rendering the ring's
 * steepest local slope from close range (distance 2.5, polar 78 degrees — a grazing angle,
 * near this rig's 84 degree limit) and diffing two frames a 0.00001-unit camera nudge apart —
 * enough to move silhouette edges a fraction of a pixel but far below anything a person would
 * notice — found only a few dozen changed pixels out of ~650k, almost all contiguous with an
 * ordinary silhouette edge rather than the isolated, scattered pixels a genuine depth-fight
 * produces.
 * Lift 0.01 measured the same way was not measurably cleaner. In other words: this kit's
 * road tile is a solid box, about 0.125 units thick once scaled to carriageway width, and its
 * *rendered* top face is never actually coincident with the terrain — only its back-face-
 * culled underside is, and culling means that face is never rasterised against the terrain
 * from above. No dither was actually caught in this colony at lift 0.
 *
 * The lift is kept anyway, at this small a value, as a margin rather than as the fix for a
 * confirmed artifact: it costs nothing visible, it keeps the tile's touch point from ever
 * being exactly degenerate, and it gives some slack against a steeper local slope than this
 * colony's terrain happened to produce (the worst measured here, across all 90 ring patches,
 * was a 0.039 rise within one tile's footprint).
 */
export const ROAD_SURFACE_LIFT = 0.01

/**
 * Where a carriageway patch's tile sits, vertically — pure so the decision is testable
 * without a renderer. It must *track* `groundY` for any input, never clamp it: a clamp here
 * is exactly the bug this replaced (`Math.max(DECK_TOP, groundY)` clamped every ring patch
 * to `DECK_TOP`, because no street cell is ever decked — see the comment in `createRoads`).
 *
 * @param groundY the terrain height sampled under this patch
 * @param lift how far above that the tile's base sits; defaults to `ROAD_SURFACE_LIFT`
 */
export function carriagewayHeight(groundY, lift = ROAD_SURFACE_LIFT) {
  return groundY + lift
}

/** A cell is this many carriageway tiles across. */
export const SUBGRID = 5

const DIR_KEY = (d) => `${d.x},${d.z}`
/** One quarter turn about +Y, matching how three.js rotates (x, z). */
const rot = (d) => ({ x: d.z, z: -d.x })
const rotN = (d, k) => {
  let r = d
  for (let i = 0; i < k; i++) r = rot(r)
  return r
}
const sameSet = (a, b) =>
  a.length === b.length && a.map(DIR_KEY).sort().join(' ') === b.map(DIR_KEY).sort().join(' ')

const S = { x: 0, z: 1 }
const N = { x: 0, z: -1 }
const E = { x: 1, z: 0 }
const W = { x: -1, z: 0 }

/**
 * The directions each piece's road leaves through, in its unrotated form. Measured from
 * `city.glb` and pinned by `road-corner-glb.test.mjs`: `road_straight` runs along its own Z,
 * and `road_corner` joins its +Z edge to its +X edge.
 *
 * This is the fact the previous implementation guessed. It turned a corner by the *incoming*
 * heading alone, which cannot work — a bend is defined by two directions, and four headings
 * cannot name eight bends. Here the arms are the input, so the rotation is determined rather
 * than inferred.
 */
const STRAIGHT_ARMS = [N, S]
const CORNER_ARMS = [S, E]
const TSPLIT_ARMS = [N, S, E]

/**
 * Which piece a street cell needs, and how far to turn it, from the directions its street
 * neighbours lie in.
 *
 * @param arms the directions of this cell's street neighbours, as unit `{x, z}`
 * @returns `{ part, k }` — the kit part, and how many quarter turns about +Y to apply
 */
export function tileFor(arms) {
  if (arms.length >= 4 || arms.length === 0) return { part: 'road_junction', k: 0 }
  const opposite = arms.length === 2 && arms[0].x === -arms[1].x && arms[0].z === -arms[1].z
  const base =
    arms.length === 3
      ? { part: 'road_tsplit', arms: TSPLIT_ARMS }
      : arms.length === 1 || opposite
        ? { part: 'road_straight', arms: STRAIGHT_ARMS }
        : { part: 'road_corner', arms: CORNER_ARMS }
  // A dead end has one arm and gets a straight laid along it: only the axis matters, so its
  // single arm is widened to the full port pair before matching.
  const want = arms.length === 1 ? [arms[0], { x: -arms[0].x, z: -arms[0].z }] : arms
  for (let k = 0; k < 4; k++) {
    if (sameSet(base.arms.map((d) => rotN(d, k)), want)) return { part: base.part, k }
  }
  // Unreachable on a square lattice: every arm set of 1-4 axis directions is some rotation of
  // one of the three bases above. Falling through would place a silently wrong tile — exactly
  // the failure this module is being rewritten to end — so it throws instead.
  throw new Error(`no rotation of ${base.part} fits arms ${want.map(DIR_KEY).join(' ')}`)
}

/**
 * Where every carriageway tile goes.
 *
 * A cell is `SUBGRID` x `SUBGRID` tiles. The carriageway is the middle row, the middle column,
 * or both: the centre tile carries the piece the cell's arms call for, and each arm gets the
 * tiles between the centre and that edge. Every tile lies strictly inside its own cell, so a
 * cell's tiles meet its neighbour's edge to edge — no dedup set, no shared `placed`, and no
 * coincident slabs.
 *
 * Order-free by construction: a cell's tiles depend only on its own four neighbours, never on
 * a walk order. That is what retired `ringRuns` and the `closed` flag.
 *
 * @param streetCells every street cell, `{x, z}`
 * @param cellSize world units per cell
 * @returns `[{x, z, part, ry}]` — world position, kit part, and Y rotation in radians
 */
export function carriagewayTiles(streetCells, cellSize) {
  const keys = new Set(streetCells.map((c) => `${c.x},${c.z}`))
  const step = cellSize / SUBGRID
  const armsOf = (c) => [N, S, E, W].filter((d) => keys.has(`${c.x + d.x},${c.z + d.z}`))
  const out = []
  for (const c of streetCells) {
    const cx = c.x * cellSize
    const cz = c.z * cellSize
    const arms = armsOf(c)
    const centre = tileFor(arms)
    out.push({ x: cx, z: cz, part: centre.part, ry: (centre.k * Math.PI) / 2 })
    for (const d of arms) {
      // Along an arm: the tiles between the centre tile and the cell edge. With SUBGRID 5
      // that is exactly two, at one and two steps out, and the second ends flush with the
      // edge, where the neighbouring cell's own second tile begins.
      const along = tileFor([d, { x: -d.x, z: -d.z }])
      for (let i = 1; i <= (SUBGRID - 1) / 2; i++) {
        out.push({
          x: cx + d.x * step * i,
          z: cz + d.z * step * i,
          part: along.part,
          ry: (along.k * Math.PI) / 2,
        })
      }
    }
  }
  return out
}

// ── the scene half ───────────────────────────────────────────────────────────────────

/** The pieces this module draws, all from the city atlas. */
const STRAIGHT_PART = 'road_straight'
const CORNER_PART = 'road_corner'
const TSPLIT_PART = 'road_tsplit'
const JUNCTION_PART = 'road_junction'
// Unused until a later task rebuilds verge lighting along the whole network; kept rather than
// deleted so that task has a name to reach for instead of re-discovering the kit part.
const LAMP_PART = 'streetlight'

/**
 * Build the street surface for one street plan.
 *
 * One merged geometry per kit part (`road_straight`, `road_corner`, `road_tsplit`,
 * `road_junction`), so the whole street network is at most four draw calls however large
 * the colony grows — a fourth part costs no new code, only one more entry in `composers`.
 * Merging is what the city atlas is for: every piece in the kit UVs into a single 1024px
 * gradient atlas, which is the only reason a whole street can collapse into one mesh per part.
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
  if (
    !streets ||
    !streets.cells?.length ||
    !hasPart(STRAIGHT_PART, 'city') ||
    !hasPart(CORNER_PART, 'city') ||
    !hasPart(TSPLIT_PART, 'city') ||
    !hasPart(JUNCTION_PART, 'city')
  )
    return group

  const scale = roadTileScale()
  const tiles = carriagewayTiles(streets.cells, CELL_SIZE)
  const composers = new Map()
  for (const tile of tiles) {
    if (!hasPart(tile.part, 'city')) continue
    let composer = composers.get(tile.part)
    if (!composer) {
      composer = new Composer({ kit: 'city' })
      composers.set(tile.part, composer)
    }
    // The carriageway sits on bare terrain, never on a deck: a plot never claims a street
    // cell (`allocateCells` refuses them), so this follows the ground directly with no
    // `Math.max(DECK_TOP, ...)` clamp. That clamp is the bug this replaced — it pinned every
    // patch to DECK_TOP, because no street cell is ever decked.
    //
    // The tile stays flat rather than tilting to the local slope: a per-patch tilt would open
    // seams wherever two neighbouring tiles picked slightly different normals.
    const y = groundAt ? carriagewayHeight(groundAt(tile.x, tile.z)) : DECK_TOP
    composer.add(tile.part, { s: scale, x: tile.x, y, z: tile.z, ry: tile.ry })
  }
  const meshes = [...composers.values()].map((c) => new THREE.Mesh(c.finish(), roadMaterial()))

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
