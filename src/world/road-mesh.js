import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { CELL_SIZE } from './grid.js'
import { DECK_TOP } from './plots.js'
import { inTown } from './town-plan.js'

/**
 * The street surface and its verge: a carriageway down the middle of each street cell, and —
 * for a cell that actually borders the town rather than open countryside — pavement,
 * streetlights, zebra crossings and traffic lights along it.
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

// ── verge furniture ──────────────────────────────────────────────────────────────────

/** The furniture pieces this module draws, all from the city atlas. */
const PAVEMENT_PART = 'base'
const LAMP_PART = 'streetlight'
const CROSSING_PART = 'road_straight_crossing'
/**
 * `trafficlight_C` — the gantry variant — is deliberately left out. See the "Traffic lights"
 * paragraph in `vergeFurniture`'s own doc comment below for the reach measurement that rules
 * it out. Pinned by a test: this pool must never grow `trafficlight_C` back in without that
 * reach problem being solved first.
 */
export const TRAFFIC_LIGHT_PARTS = Object.freeze(['trafficlight_A', 'trafficlight_B'])

/**
 * How far the pavement's kerb stands above the carriageway. `base` and the road surface UV
 * into the same atlas swatch (cell 2, `#818c91`) — the same grey — so a kerb cannot read as a
 * colour change, only as a height step and the shadow it casts. Streetlights and traffic
 * lights use the same figure for their own lift, even though — see the offsets below — they
 * do not stand on the pavement itself: they stand 1.2 units beyond its outer edge, on bare
 * terrain (pavement's own outer edge is at 1 sub-grid step out plus its own half-width; the
 * lamp/signal corner is 2 steps out — `2 * step - (step + roadTileScale())` = 1.2 at
 * `cellSize` 12). Pinned by a test: swapping this for `ROAD_SURFACE_LIFT` (kerb flush with
 * the carriageway) must fail it.
 */
export const VERGE_LIFT = ROAD_SURFACE_LIFT * 8

/** A JS `%` can come back negative; this never does. */
const mod = (n, m) => ((n % m) + m) % m

/**
 * A stable integer per cell, used below to choose deterministically — which arm gets the
 * crossing, which traffic light part, which corner it stands on — without any shared RNG
 * stream. The same cell always yields the same number, so two independent choices derived
 * from it (the crossing arm, the traffic light part) stay consistent with each other across
 * calls with no state passed between them.
 */
const cellHash = (cell) => cell.x * 31 + cell.z * 17

/**
 * R11: a street cell is worth furnishing only if it actually borders the town — otherwise it
 * is a country lane running through open fields, and paving, lighting and signalling it would
 * be wrong on its own terms. "Borders the town" means at least one of the cell's four
 * neighbours is itself *not* a street and lies inside `inTown`'s outline; a neighbour that is
 * another street cell, or open countryside outside the outline, does not count.
 *
 * @param cell the street cell, `{x, z}`
 * @param streetKeys the street membership set, `"x,z"` keys
 */
function isFurnished(cell, streetKeys) {
  return [N, S, E, W].some((d) => {
    const n = { x: cell.x + d.x, z: cell.z + d.z }
    return !streetKeys.has(`${n.x},${n.z}`) && inTown(n)
  })
}

/**
 * Where every piece of verge furniture goes, laid out the same way `carriagewayTiles` lays
 * the road surface itself: one street cell at a time, from that cell's own arms.
 *
 * Gated by `isFurnished` (R11) — a cell that fails it contributes nothing here, so the
 * network's country-lane stretches stay bare carriageway with no kerb, lamp or light.
 *
 * - **Pavement.** For each arm, two `base` tiles per side, at the same two sub-grid steps
 *   `carriagewayTiles` lays along that arm, offset one sub-grid step perpendicular so no tile
 *   lands on the carriageway itself. A cell with two perpendicular arms (a corner or a
 *   junction) has both arms claim the same inner-diagonal tile — deduplicated below, or the
 *   count would overstate the vertex cost and this module's own "no coincident slabs" claim
 *   would be false.
 * - **Streetlights.** One per arm, at the outer sub-grid step, two steps off the centre line
 *   — on the verge, behind the pavement. Which side alternates with the parity of
 *   `cell.x + cell.z`, so a street does not grow lamps down one side only.
 *
 *   `streetlight` has a front: measured from `city.glb`, its cantilever arm reaches along
 *   local −X (to x −0.239) and the lit lens sits at that tip, while the mast itself is only
 *   ±0.035 thick in Z — so an unrotated lamp always overhangs whatever is in world −X, which
 *   is correct for only a quarter of placements. Three.js's `makeRotationY(θ)` sends local
 *   `(x, z)` to `(x cosθ + z sinθ, −x sinθ + z cosθ)`, so local `(−1, 0)` (the arm's own
 *   direction) lands on `(−cosθ, sinθ)`. Let `v` be the unit direction from the lamp toward
 *   the carriageway it should overhang — here, back across the pavement toward this arm's own
 *   centre line, i.e. `-lampSide * perp`. Setting `(−cosθ, sinθ) = v` gives
 *   `cosθ = −v.x, sinθ = v.z`, so `θ = atan2(v.z, −v.x)`.
 * - **Zebra crossings.** On a furnished cell with three or four arms (R7), one arm is chosen
 *   deterministically by `cellHash` and its outermost carriageway tile is replaced by
 *   `road_straight_crossing` at that tile's own position, scale and rotation — the same
 *   `tileFor` rotation logic `carriagewayTiles` itself uses, not re-derived. `createRoads`
 *   is what actually drops the plain tile there; this only names where the crossing goes.
 * - **Traffic lights.** One on every furnished cell with three or four arms (R7), facing the
 *   same arm the crossing on that cell governs — the sign for the crossing it stands beside.
 *   It sits two sub-grid steps out along that arm (flush with the crossing) and 1.5 steps to
 *   one side, perpendicular — a half sub-grid step *closer* to the centre line than a
 *   streetlight stands (2 steps), not beyond it.
 *   Every other piece here sits at a whole number of sub-grid steps on both axes; landing on
 *   a half step is what keeps a traffic light off every streetlight, pavement tile and
 *   crossing this module can ever place, on this cell or any other, without having to track
 *   what has already been placed — a coincident post and signal (see the 15-collision defect
 *   this replaced) cannot arise from two axis-aligned integer offsets and one half-integer.
 *
 *   `trafficlight_A` and `_B` both carry their three lens groups (red/amber/green) pinned to
 *   the model's own +Z face. Local +Z maps to `(sinθ, cosθ)` under the same rotation, so
 *   facing the lenses along a direction `v` takes `θ = atan2(v.x, v.z)` — the formula
 *   `town-plan.js` already uses for building fronts. Here `v` is the governed arm's own
 *   outward direction: the sign faces the traffic driving in along that arm, the way it
 *   approaches the junction.
 *
 *   `trafficlight_C` — the same head on a gantry arm reaching to local x = −0.764 (measured
 *   from `city.glb`) — is **not** in `TRAFFIC_LIGHT_PARTS`, and is never placed. Under the
 *   rotation above, local −X maps to `(−cosθ, sinθ) = (−v.z, v.x)`, which is this arm's own
 *   `−perp` — the *same* side the pole itself is already offset toward, not the opposite one.
 *   So a `_C` gantry swings further out over open verge, away from the road, never back across
 *   it; an earlier version of this comment had that sign backwards. Even corrected, the arm
 *   still could not reach: the pole stands 1.5 steps (3.6 units) off the centre line, the
 *   carriageway's own half-width is 1.2, and the pavement tile at this arm's outer step
 *   occupies every offset from 1.2 to 3.6 with no gap — so the only pole offset a 0.764-unit
 *   arm could reach the carriageway from also stands the pole inside that pavement tile. A
 *   gantry arm hanging over open verge instead of the carriageway would read as broken, so
 *   `_C` is left out of the pool rather than placed wrong; `_A`/`_B`, plain pole signals, are
 *   correct as they stand.
 *
 * @param streetCells every street cell, `{x, z}`
 * @param cellSize world units per cell
 * @returns `[{part, x, z, ry, scale, lift}]`
 */
export function vergeFurniture(streetCells, cellSize) {
  const keys = new Set(streetCells.map((c) => `${c.x},${c.z}`))
  const step = cellSize / SUBGRID
  const scale = roadTileScale()
  const armsOf = (c) => [N, S, E, W].filter((d) => keys.has(`${c.x + d.x},${c.z + d.z}`))
  const out = []
  // Two perpendicular arms of the same cell claim the same inner-diagonal pavement tile (see
  // the doc comment above); keyed on the rounded position so the second arm to reach it is
  // skipped rather than laid a second time.
  const pavementSeen = new Set()
  const posKey = (x, z) => `${x.toFixed(6)},${z.toFixed(6)}`

  for (const c of streetCells) {
    if (!isFurnished(c, keys)) continue
    const cx = c.x * cellSize
    const cz = c.z * cellSize
    const arms = armsOf(c)
    const h = cellHash(c)
    const lampSide = (c.x + c.z) % 2 === 0 ? 1 : -1

    for (const d of arms) {
      const perp = rot(d)
      for (let i = 1; i <= (SUBGRID - 1) / 2; i++) {
        for (const side of [1, -1]) {
          const x = cx + d.x * step * i + side * perp.x * step
          const z = cz + d.z * step * i + side * perp.z * step
          const key = posKey(x, z)
          if (pavementSeen.has(key)) continue
          pavementSeen.add(key)
          out.push({ part: PAVEMENT_PART, x, z, ry: 0, scale, lift: VERGE_LIFT })
        }
      }
      // v: unit direction from the lamp back to this arm's own centre line, i.e. the
      // carriageway it should overhang. θ = atan2(v.z, -v.x) — derived above.
      const v = { x: -lampSide * perp.x, z: -lampSide * perp.z }
      out.push({
        part: LAMP_PART,
        x: cx + d.x * step * 2 + lampSide * perp.x * step * 2,
        z: cz + d.z * step * 2 + lampSide * perp.z * step * 2,
        ry: Math.atan2(v.z, -v.x),
        scale: 1.6,
        lift: VERGE_LIFT,
      })
    }

    if (arms.length >= 3) {
      const d = arms[mod(h, arms.length)]
      const perp = rot(d)
      const along = tileFor([d, { x: -d.x, z: -d.z }])
      out.push({
        part: CROSSING_PART,
        x: cx + d.x * step * 2,
        z: cz + d.z * step * 2,
        ry: (along.k * Math.PI) / 2,
        scale,
        lift: ROAD_SURFACE_LIFT,
      })

      // Faces along `d`, the governed arm's own outward direction — toward the traffic
      // driving in along it. Offset to the far (`-perp`) side by a half sub-grid step, which
      // keeps it off the whole-step grid every other piece here uses (see the doc comment).
      // `TRAFFIC_LIGHT_PARTS` excludes `trafficlight_C` — its gantry can't reach the
      // carriageway from this position; see the doc comment above for the measurement.
      out.push({
        part: TRAFFIC_LIGHT_PARTS[mod(h, TRAFFIC_LIGHT_PARTS.length)],
        x: cx + d.x * step * 2 - perp.x * step * 1.5,
        z: cz + d.z * step * 2 - perp.z * step * 1.5,
        ry: Math.atan2(d.x, d.z),
        scale: 1,
        lift: VERGE_LIFT,
      })
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

/**
 * Build the street surface — and, where `vergeFurniture` puts one, its verge — for one
 * street plan.
 *
 * One merged geometry per kit part (`road_straight`, `road_corner`, `road_tsplit`,
 * `road_junction`, plus whichever verge parts a real network actually uses), so the whole
 * street network is a handful of draw calls however large the colony grows — a new part
 * costs no new code, only one more entry in `composers`. Merging is what the city atlas is
 * for: every piece in the kit UVs into a single 1024px gradient atlas, which is the only
 * reason a whole street can collapse into one mesh per part.
 *
 * Tree, bush and grass planting is **not** here. Those live in `forest.glb`, a different
 * atlas, and a merged geometry carries one material — so they cannot join these meshes. That
 * part of the verge reuses the existing scatter system instead; only the city-kit furniture
 * `vergeFurniture` places — pavement, streetlights, zebra crossings, traffic lights — is
 * built here, exactly as the carriageway tiles already are.
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
    !hasPart(JUNCTION_PART, 'city') ||
    // A crossing replaces one of the tiles `roadTiles` below drops (see the comment there) —
    // if the kit lacks the crossing part, that drop would leave a hole in the carriageway
    // rather than the plain tile it removed, so it belongs in the same all-or-nothing gate as
    // the other road parts, not in the per-piece `hasPart` check `place` already does.
    !hasPart(CROSSING_PART, 'city')
  )
    return group

  const scale = roadTileScale()
  const tiles = carriagewayTiles(streets.cells, CELL_SIZE)
  const furniture = vergeFurniture(streets.cells, CELL_SIZE)

  // A zebra crossing replaces the carriageway tile it stands on: `vergeFurniture` gives it
  // the exact position, scale and rotation that tile itself would have (see its own doc), so
  // the plain tile at that spot has to be dropped here or the two would render as one
  // coincident, z-fighting slab. Both positions come from the identical `cx + d.x * step * i`
  // arithmetic, on the same cell, arm and step — so they match exactly; the rounding below
  // only guards against that ever drifting, not against a real difference today.
  const posKey = (x, z) => `${x.toFixed(6)},${z.toFixed(6)}`
  const crossingKeys = new Set(furniture.filter((f) => f.part === CROSSING_PART).map((f) => posKey(f.x, f.z)))
  const roadTiles = tiles.filter((t) => !crossingKeys.has(posKey(t.x, t.z)))

  const composers = new Map()
  const place = (part, x, z, ry, s, lift) => {
    if (!hasPart(part, 'city')) return
    let composer = composers.get(part)
    if (!composer) {
      composer = new Composer({ kit: 'city' })
      composers.set(part, composer)
    }
    // Everything here sits on bare terrain, never on a deck: a plot never claims a street
    // cell (`allocateCells` refuses them), so this follows the ground directly with no
    // `Math.max(DECK_TOP, ...)` clamp. That clamp is the bug this replaced — it pinned every
    // patch to DECK_TOP, because no street cell is ever decked.
    //
    // Every piece stays flat rather than tilting to the local slope: a per-piece tilt would
    // open seams wherever two neighbouring pieces picked slightly different normals.
    const y = groundAt ? carriagewayHeight(groundAt(x, z), lift) : DECK_TOP
    composer.add(part, { s, x, y, z, ry })
  }
  for (const tile of roadTiles) place(tile.part, tile.x, tile.z, tile.ry, scale, ROAD_SURFACE_LIFT)
  for (const f of furniture) place(f.part, f.x, f.z, f.ry, f.scale, f.lift)

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
