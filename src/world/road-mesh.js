import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { CELL_SIZE } from './grid.js'
import { DECK_TOP } from './plots.js'
import { inTown } from './town-outline.js'

/**
 * The street surface and its verge: a carriageway down the middle of each street cell, and —
 * for a cell that actually borders the town rather than open countryside — streetlights, zebra
 * crossings and traffic lights along it.
 *
 * There is no pavement. An earlier revision paved a footway alongside the carriageway, first
 * to the cell's own boundary, then narrowed to a single kerb-hugging strip — both reverted in
 * the playful revision: the owner asked for the pavement gone entirely, since a footway wider
 * than the carriageway itself was wrong on its own terms and every attempt to tune its width
 * only made the town read worse. A street cell is 12 units across — far wider than the
 * 2.4-wide carriageway needs — but the rest of it is now bare verge, not paved surface; the
 * town's buildings stand at its edge instead (see `SET_BACK` in `town-plan.js`).
 *
 * Every bend on this square lattice turns its two arms through a right angle (see `grid.js`),
 * but the piece that draws it is no longer the hard-edged `road_corner` — the reference render
 * KayKit's own promo art shows curved corners, so a bend now places `road_corner_curved`
 * instead, and a three- or four-way meeting gets `road_tsplit` or `road_junction`. Which piece
 * a cell needs, and which way it is turned, comes from `tileFor` — a function of that cell's
 * own street neighbours, not of any path walked through them.
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
 * How far a carriageway tile reaches into the one after it, along the run.
 *
 * Tiles used to be exactly as long as the grid step, so each pair met face to face. That is
 * fine on a level surface and this one is not level: every tile is placed at the height of
 * the ground under its own middle, and a flat slab cannot do anything with a slope except
 * jump at the join. Measured over one straight row of 56 tiles the median jump is 0.0196 and
 * the worst 0.0521, against the tile's own raised rim of 0.036 — so at every seam two
 * coincident vertical faces sat a hair apart, and the depth buffer picked between them per
 * pixel. On screen: a dark line across the road every 2.4, and edge paint that seems to step
 * sideways where it crosses one.
 *
 * 0.05 is chosen to be far larger than depth precision and far smaller than anything the eye
 * resolves — a fortieth of a tile, split between the two ends. It does *not* fix the height
 * step itself, which is still there and still a staircase; it hides the seam the staircase
 * opens, which is the part you can see.
 */
export const TILE_OVERLAP = 0.05

/**
 * How one carriageway tile is scaled, per axis.
 *
 * Across the run it is exactly one carriageway and never anything else: `CARRIAGEWAY_WIDTH`
 * is what `EDGE_LINE_OFFSET`, `DRIVING_LANE_OFFSET` and `PARKING_LANE_OFFSET` are all
 * derived from, so a tile a hair wider would move the paint, the driving line and every
 * parked car, with nothing on screen to say why. Along the run it carries `TILE_OVERLAP`.
 *
 * Only the straight pieces grow. They are the only ones whose run is a single axis — a
 * junction's is two, and growing it in both would widen the carriageway at exactly the place
 * the eye checks whether a road lines up. It costs nothing to leave them: a junction piece
 * only ever sits at a cell's middle, so every seam it has is with a straight laid along one
 * of its arms, and that straight reaches across the join from its own side.
 * `test/road-seams.test.mjs` checks that holds for every seam in the town rather than
 * trusting the argument.
 *
 * The kit authors a straight with its edge lines at x = +/-0.62 running the length of z, so
 * the run is the tile's own z. Scale is applied before yaw, so this is in the tile's frame.
 */
export function tileScale(part) {
  const across = roadTileScale()
  const grows = part === STRAIGHT_PART || part === CROSSING_PART
  return { across, along: grows ? across + TILE_OVERLAP / ROAD_TILE_SIZE : across }
}

/**
 * The atlas cell the kit paints the road's yellow edge lines with, and where those lines sit
 * across a tile in its own authored units (half-width 1).
 *
 * Measured off `road_straight` in `city.glb` rather than guessed: the white centre line is a
 * 0.04-wide band at x=0 (cell 1) and the yellow lines are two thin strips at x=+/-0.62
 * (cell 11), with the asphalt running the full +/-1. `test/road-corner-glb.test.mjs` reads
 * these back out of the glb, so a re-exported kit that moves its markings fails a test
 * instead of quietly putting the colony's traffic on top of its own paint.
 */
export const YELLOW_CELL = 11
export const EDGE_LINE_AUTHORED = 0.62

/** The same edge line in world units, once the tile is scaled to a carriageway. */
export const EDGE_LINE_OFFSET = EDGE_LINE_AUTHORED * roadTileScale()

/**
 * How far right of the road's centre line a moving car drives: the middle of the band between
 * the white centre line and the yellow edge line.
 *
 * Cars used to drive at 0 — astride the centre line, straddling the paint — because a route
 * is built from cell centres and the carriageway is drawn centred on those same cells. See
 * `offsetPath` in `drive-path.js`, which is what actually shifts a route here.
 */
export const DRIVING_LANE_OFFSET = EDGE_LINE_OFFSET / 2

/**
 * How far right of the centre line a parked car stands: the middle of the asphalt outside the
 * yellow line.
 *
 * That band is `CARRIAGEWAY_WIDTH / 2 - EDGE_LINE_OFFSET` = 0.456 wide, which is the
 * constraint that actually sets `CAR_SCALE` (`deliveries.js`) — a car wider than the strip
 * cannot be parked in it without standing on the paint or hanging off the kerb, and the glb
 * test asserts it does not.
 */
export const PARKING_LANE_OFFSET = (EDGE_LINE_OFFSET + CARRIAGEWAY_WIDTH / 2) / 2

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

/**
 * Where the driving surface sits on a road tile, in the tile's own authored units.
 *
 * A road tile is not a flat plate. Measured off `road_straight` in city.glb, its asphalt has
 * vertices at exactly three heights — 0 for the base it stands on, 0.07 for the surface a car
 * drives on, and 0.1 for the raised rim down each side — with the lane paint floating at
 * 0.073, three thousandths above the surface it marks so it does not fight it. The test reads
 * all of that back out of the glb rather than trusting this comment.
 */
export const ROAD_SURFACE_AUTHORED = 0.07

/**
 * The height a car's wheels stand at, on a carriageway laid over ground at `groundY`.
 *
 * Cars used to be placed at `groundY` itself — which is where the tile's *base* goes, not its
 * surface. Every car in the colony therefore sat 0.084 down inside the asphalt, comfortably
 * more than a wheel radius (0.076 at the shipping `CAR_SCALE`), and the fleet read as
 * half-melted into the road.
 */
export function roadSurfaceY(groundY, lift = ROAD_SURFACE_LIFT) {
  return carriagewayHeight(groundY, lift) + ROAD_SURFACE_AUTHORED * roadTileScale()
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
 * and `road_corner_curved` joins its +Z edge to its +X edge.
 *
 * This is the fact the previous implementation guessed. It turned a corner by the *incoming*
 * heading alone, which cannot work — a bend is defined by two directions, and four headings
 * cannot name eight bends. Here the arms are the input, so the rotation is determined rather
 * than inferred.
 *
 * `CORNER_ARMS` names `road_corner_curved`'s own ports, not `road_corner`'s copied over on the
 * assumption the two share a rotation table. They were measured separately (same atlas-cell
 * method, see `road-corner-glb.test.mjs`'s own test for the curved part) precisely because nothing
 * guarantees a rounded variant of a piece keeps the straight-edged one's port layout — and they
 * came back identical: white centre arc x -0.02..0.90, z -0.02..0.90, amber arcs x -0.62..1.00,
 * z -0.62..1.00, the same +Z-to-+X join `road_corner` has. So `CORNER_ARMS` carries over
 * unchanged, but as a measured fact about the curved part in its own right, not an inherited one.
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
        : { part: 'road_corner_curved', arms: CORNER_ARMS }
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
 * A cell in `connected` counts as a neighbour worth reaching but lays no carriageway of its
 * own: the street beside it grows an arm out to their shared edge, and the cell itself stays
 * bare. That is how the depot gets an apron. Its cell is a `PROTECTED_CELL` and may never
 * carry a street — a carriageway there would be tarmac under a building — but without some
 * tarmac reaching it, every delivery pulls out of the yard on to grass.
 *
 * @param streetCells every street cell, `{x, z}`
 * @param cellSize world units per cell
 * @param connected keys of cells to reach but not to pave, as `"x,z"`
 * @returns `[{x, z, part, ry}]` — world position, kit part, and Y rotation in radians
 */
export function carriagewayTiles(streetCells, cellSize, connected = new Set()) {
  const keys = new Set(streetCells.map((c) => `${c.x},${c.z}`))
  const armsOf = (c) =>
    [N, S, E, W].filter((d) => {
      const k = `${c.x + d.x},${c.z + d.z}`
      return keys.has(k) || connected.has(k)
    })
  const step = cellSize / SUBGRID
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
const LAMP_PART = 'streetlight'
export const CROSSING_PART = 'road_straight_crossing'
/**
 * `trafficlight_C` — the gantry variant — is deliberately left out. See the "Traffic lights"
 * paragraph in `vergeFurniture`'s own doc comment below for the reach measurement that rules
 * it out. Pinned by a test: this pool must never grow `trafficlight_C` back in without that
 * reach problem being solved first.
 */
export const TRAFFIC_LIGHT_PARTS = Object.freeze(['trafficlight_A', 'trafficlight_B'])

/**
 * How far past the carriageway's own edge a piece of kerbside furniture stands — a lamp or a
 * traffic light, now that there is no pavement to place either "on". Half the carriageway
 * width (`CARRIAGEWAY_WIDTH / 2` = 1.2) is where the asphalt itself ends; this adds a small
 * margin so a lamp post or a signal pole's own base does not sit flush with (and, given any
 * floating-point slack, occasionally inside) the outermost carriageway tile. 0.6 is that
 * margin — half the sub-grid step (`CELL_SIZE / SUBGRID` = 2.4) — chosen only to be
 * comfortably larger than either fixture's own footprint (a `streetlight` mast measures
 * ±0.035 unscaled, a few hundredths of a unit even at this module's largest furniture scale)
 * while still reading as "at the roadside" rather than out in open verge.
 */
const KERB_CLEARANCE = 0.6

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

/** A street cell's own street-connected neighbours, in `[N, S, E, W]` order — the order
 *  matters, not just the set of directions, because `cellFurniture` below picks a governed arm
 *  by `arms[mod(cellHash(cell), arms.length)]`, and which *index* that lands on depends on it. */
function armsOf(cell, streetKeys) {
  return [N, S, E, W].filter((d) => streetKeys.has(`${cell.x + d.x},${cell.z + d.z}`))
}

/**
 * Where every piece of verge furniture on *one* street cell goes — the per-cell body
 * `vergeFurniture` below loops over the whole network, and the same thing `town-plan.js` calls
 * directly (rather than re-deriving R7/R11's own arm selection, cell hash and arm order — see
 * that module's own doc comment on why the duplication it used to carry was worth removing) to
 * learn which of a street cell's own lamps, crossing and traffic light a building row fronting
 * it needs to leave a gap for.
 *
 * Gated by `isFurnished` (R11) — a cell that fails it gets nothing, so the network's
 * country-lane stretches stay bare carriageway with no lamp or light. There is no pavement to
 * gate here any more either; R11 now governs only the three things left in this list.
 *
 * - **Streetlights.** One per arm, standing at the kerb line — just outside the carriageway's
 *   own edge, not out in the open verge beyond it. `KERB_CLEARANCE` is the margin past
 *   `CARRIAGEWAY_WIDTH / 2` (1.2, the carriageway's own half-width); the lamp's perpendicular
 *   offset from the arm's centre line is `CARRIAGEWAY_WIDTH / 2 + KERB_CLEARANCE` = 1.8, close
 *   enough to read as standing at the roadside and, since the carriageway tile it stands beside
 *   is itself only 1.2 wide from that centre line, far enough (0.6 clear) that the two never
 *   overlap. Along the arm it stands **1 sub-grid step out — the centre tile's own outer edge,
 *   the same point the arm's inner carriageway tile is centred on** — not the 1.5-step midpoint
 *   an earlier revision used. That midpoint sat exactly on `town-plan.js`'s own terrace-slot
 *   boundary (`SLOT_OFFSETS`' pitch and this module's sub-grid step are both derived from the
 *   same `CARRIAGEWAY_WIDTH`), so a lamp's own footprint straddled two neighbouring slots
 *   instead of one — see `reservedSlots` in `town-plan.js` for how that slot reservation reads
 *   this position. 1 step (2.4 units), half a slot pitch (`SLOT_PITCH / 2` = 1.2) off that old
 *   midpoint, lands the lamp inside a single slot instead. No other placement in this module
 *   ever lands on this along-arm value either, so a lamp still never coincides with a crossing
 *   (2 steps out) or the traffic light below (0.75 steps out on each axis).
 *   Which side alternates with the parity of `cell.x + cell.z`, so a street does not grow lamps
 *   down one side only.
 *
 *   `streetlight` has a front: measured from `city.glb`, its cantilever arm reaches along
 *   local −X (to x −0.239) and the lit lens sits at that tip, while the mast itself is only
 *   ±0.035 thick in Z — so an unrotated lamp always overhangs whatever is in world −X, which
 *   is correct for only a quarter of placements. Three.js's `makeRotationY(θ)` sends local
 *   `(x, z)` to `(x cosθ + z sinθ, −x sinθ + z cosθ)`, so local `(−1, 0)` (the arm's own
 *   direction) lands on `(−cosθ, sinθ)`. Let `v` be the unit direction from the lamp toward
 *   the carriageway it should overhang — here, back across the verge toward this arm's own
 *   centre line, i.e. `-lampSide * perp`. Setting `(−cosθ, sinθ) = v` gives
 *   `cosθ = −v.x, sinθ = v.z`, so `θ = atan2(v.z, −v.x)`. This derivation does not depend on
 *   the lamp's exact distance from the centre line, only on which side it stands, so moving
 *   the lamp to the kerb line leaves the facing formula itself unchanged.
 * - **Zebra crossings.** On a furnished cell with three or four arms (R7), one arm is chosen
 *   deterministically by `cellHash` and its outermost carriageway tile is replaced by
 *   `road_straight_crossing` at that tile's own position, scale and rotation — the same
 *   `tileFor` rotation logic `carriagewayTiles` itself uses, not re-derived. `createRoads`
 *   is what actually drops the plain tile there; this only names where the crossing goes.
 * - **Traffic lights.** One on every furnished cell with three or four arms (R7), facing the
 *   same arm the crossing on that cell governs — the sign for the crossing it stands beside.
 *   It stands at the corner of the junction rather than out by the crossing: `KERB_CLEARANCE`
 *   past the carriageway's own half-width on *both* axes at once — `CARRIAGEWAY_WIDTH / 2 +
 *   KERB_CLEARANCE` = 1.8 out along the governed arm and the same 1.8 to one side,
 *   perpendicular (0.75 sub-grid steps each way, since the sub-grid step is 2.4) — just clear
 *   of the carriageway on both the approach and the cross street, the way a real signal stands
 *   at the corner of a junction rather than out on the open verge. No other placement in this
 *   module ever lands at 0.75 sub-grid steps on an axis — a streetlight and a crossing both sit
 *   at 1 or 2 steps — so a traffic light can never coincide with either, on this cell or
 *   any other, without having to track what has already been placed (a coincident post and
 *   signal — see the 15-collision defect an earlier round of this module shipped — cannot arise
 *   from one feature's positions never sharing a step value with any other's).
 *
 *   `trafficlight_A` and `_B` both carry their three lens groups (red/amber/green) pinned to
 *   the model's own +Z face. Local +Z maps to `(sinθ, cosθ)` under the same rotation, so
 *   facing the lenses along a direction `v` takes `θ = atan2(v.x, v.z)` — the formula
 *   `town-plan.js` already uses for building fronts. Here `v` is the governed arm's own
 *   outward direction: the sign faces the traffic driving in along that arm, the way it
 *   approaches the junction.
 *
 *   `trafficlight_C` — the same head on a gantry arm reaching to local x = −0.764 (measured
 *   from `city.glb`) — stays out of `TRAFFIC_LIGHT_PARTS`. At this pole position (1.8 units off
 *   the centre line, carriageway edge at 1.2) the gap the gantry would need to close is only
 *   0.6 units, *inside* the gantry's own 0.764-unit reach — geometrically the arm could swing
 *   back across the carriageway edge. `_C` is kept out anyway: re-admitting it is a separate
 *   decision (new reach math to verify, a different visual mix of pole and gantry signals along
 *   the network) outside this revision's scope. `_A`/`_B`, plain pole signals whose facing was
 *   already verified correct, are unaffected by any of this and remain the only parts this pool
 *   ever draws from.
 *
 * @param cell the street cell, `{x, z}`
 * @param streetKeys the street membership set, `"x,z"` keys
 * @param cellSize world units per cell
 * @returns `[{part, x, z, ry, scale, lift}]` — empty if `cell` fails R11
 */
export function cellFurniture(cell, streetKeys, cellSize) {
  if (!isFurnished(cell, streetKeys)) return []
  const step = cellSize / SUBGRID
  const kerb = CARRIAGEWAY_WIDTH / 2 + KERB_CLEARANCE
  const cx = cell.x * cellSize
  const cz = cell.z * cellSize
  const arms = armsOf(cell, streetKeys)
  const h = cellHash(cell)
  const lampSide = (cell.x + cell.z) % 2 === 0 ? 1 : -1
  const out = []

  arms.forEach((d, i) => {
    const perp = rot(d)
    // A prop on the kerb opposite this arm's lamp: the lamp owns `lampSide`, so everything
    // here goes on the other side of the carriageway and cannot collide with it however the
    // two are scaled. Its own stream, salted by which arm it is, so the four arms of a
    // crossroads do not all get the same thing.
    const ph = cellHash({ x: cell.x * 31 + i, z: cell.z * 17 - i })
    if (mod(ph, 100) < PROP_PERCENT) {
      const part = VERGE_PROPS[mod(ph >> 7, VERGE_PROPS.length)]
      // One step out or two: both sit inside the cell (2.4 and 4.8 against a half-cell of 6),
      // so a prop never lands on the boundary where the neighbouring cell places its own.
      const along = step * (1 + mod(ph >> 3, 2))
      const side = -lampSide
      // Facing the road it stands beside — the direction from the prop back to this arm's
      // centre line, which is `lampSide * perp` since the prop is on the other side. The rest
      // of the pool has no front worth aiming, and gets a quarter turn from its own hash
      // instead so a row of them is not all squared up the same way.
      const toRoad = { x: lampSide * perp.x, z: lampSide * perp.z }
      out.push({
        part,
        x: cx + d.x * along + side * perp.x * kerb,
        z: cz + d.z * along + side * perp.z * kerb,
        ry: PROPS_THAT_FACE.has(part)
          ? Math.atan2(toRoad.x, toRoad.z)
          : (mod(ph >> 11, 4) * Math.PI) / 2,
        scale: PROP_SCALE,
        lift: ROAD_SURFACE_LIFT,
      })
    }
    // v: unit direction from the lamp back to this arm's own centre line, i.e. the
    // carriageway it should overhang. θ = atan2(v.z, -v.x) — derived above. Stands at the
    // kerb line: 1 sub-grid step along the arm, `kerb` (1.8) off the centre line — half a
    // terrace-slot pitch off the old 1.5-step midpoint, so the lamp's own footprint lands
    // inside one of town-plan.js's slots instead of straddling the seam between two (see the
    // doc comment above).
    const v = { x: -lampSide * perp.x, z: -lampSide * perp.z }
    out.push({
      part: LAMP_PART,
      x: cx + d.x * step + lampSide * perp.x * kerb,
      z: cz + d.z * step + lampSide * perp.z * kerb,
      ry: Math.atan2(v.z, -v.x),
      scale: 1.6,
      lift: ROAD_SURFACE_LIFT,
    })

    // A tree on the lamp's own side, two steps out where the lamp is one, so the two alternate
    // down a street rather than standing together. Its own hash stream again, so a planted arm
    // is not the same arm that got a bench.
    const th = cellHash({ x: cell.x * 7 - i, z: cell.z * 43 + i })
    if (mod(th, 100) < TREE_PERCENT) {
      const tree = STREET_TREES[mod(th >> 5, STREET_TREES.length)]
      out.push({
        part: tree.part,
        kit: 'forest',
        x: cx + d.x * step * 2 + lampSide * perp.x * kerb,
        z: cz + d.z * step * 2 + lampSide * perp.z * kerb,
        // A canopy has no front. A quarter turn from its own hash is what keeps a row of the
        // same part from reading as one model repeated.
        ry: (mod(th >> 13, 4) * Math.PI) / 2,
        scale: tree.scale,
        lift: ROAD_SURFACE_LIFT,
      })
    }
  })

  if (arms.length >= 3) {
    const d = arms[mod(h, arms.length)]
    const perp = rot(d)
    const along = tileFor([d, { x: -d.x, z: -d.z }])
    out.push({
      part: CROSSING_PART,
      x: cx + d.x * step * 2,
      z: cz + d.z * step * 2,
      ry: (along.k * Math.PI) / 2,
      scale: roadTileScale(),
      lift: ROAD_SURFACE_LIFT,
    })

    // Faces along `d`, the governed arm's own outward direction — toward the traffic
    // driving in along it. Stands at the junction corner, `kerb` (1.8) out along the arm and
    // `kerb` to the far (`-perp`) side — clear of the carriageway on both axes (see the doc
    // comment for the clearance figure), and off the whole- and half-step grid every other
    // piece here uses, so it can never coincide with a streetlight or a crossing.
    // `TRAFFIC_LIGHT_PARTS` excludes `trafficlight_C`; see the doc comment above.
    out.push({
      part: TRAFFIC_LIGHT_PARTS[mod(h, TRAFFIC_LIGHT_PARTS.length)],
      x: cx + d.x * kerb - perp.x * kerb,
      z: cz + d.z * kerb - perp.z * kerb,
      ry: Math.atan2(d.x, d.z),
      scale: 1,
      lift: ROAD_SURFACE_LIFT,
    })
  }
  return out
}

/**
 * Where every piece of verge furniture in the whole network goes — `cellFurniture` above,
 * concatenated over every street cell, laid out the same way `carriagewayTiles` lays the road
 * surface itself: one street cell at a time, from that cell's own arms.
 *
 * @param streetCells every street cell, `{x, z}`
 * @param cellSize world units per cell
 * @returns `[{part, x, z, ry, scale, lift}]`
 */
export function vergeFurniture(streetCells, cellSize) {
  const keys = new Set(streetCells.map((c) => `${c.x},${c.z}`))
  const out = []
  for (const c of streetCells) out.push(...cellFurniture(c, keys, cellSize))
  return out
}

/**
 * The local footprint (before its own placement `scale`) of every part `cellFurniture` can
 * place, keyed by `part` — the one fact `town-plan.js` needs, alongside a piece's own `x, z,
 * ry, scale`, to know whether a building at some candidate slot would actually reach it.
 *
 * `streetlight`, `trafficlight_A` and `trafficlight_B`'s boxes are measured from
 * `public/assets/city.glb` (`@gltf-transform/core`'s `NodeIO`, summing `POSITION` attribute
 * entries — the same method this module's other doc comments already use): the streetlight's
 * thin, off-centre mast (see `BUILDING_CLEARANCE`'s own doc comment in `town-plan.js`) and the
 * two pole-mounted traffic-light variants (`trafficlight_C`, the gantry, is never placed — see
 * `cellFurniture`'s own doc comment above). `road_straight_crossing` is not measured the same
 * way: every road piece in this kit is a plain `ROAD_TILE_SIZE`-square tile (see this module's
 * own doc comment at the top), the crossing included, so its local box is just that square,
 * the same fact `ROAD_TILE_SIZE` already states.
 */
export const FURNITURE_LOCAL_BBOX = Object.freeze({
  streetlight: {
    xmin: -0.2392103672027588,
    xmax: 0.030096590518951416,
    zmin: -0.034511469304561615,
    zmax: 0.0345110222697258,
  },
  trafficlight_A: {
    xmin: -0.13457560539245605,
    xmax: 0.0398561954498291,
    zmin: -0.03985767439007759,
    zmax: 0.11071021109819412,
  },
  trafficlight_B: {
    xmin: -0.2392103672027588,
    xmax: 0.0398561954498291,
    zmin: -0.03985767439007759,
    zmax: 0.11071021109819412,
  },
  [CROSSING_PART]: { xmin: -ROAD_TILE_SIZE / 2, xmax: ROAD_TILE_SIZE / 2, zmin: -ROAD_TILE_SIZE / 2, zmax: ROAD_TILE_SIZE / 2 },
  // The props below. Measured from city.glb the same way as the pieces above, and needed for
  // the same reason: `reservedSlots` in `town-plan.js` reads these to decide which terrace
  // slot a building may not have, so a piece with no entry here is a piece a wall is free to
  // be built straight through.
  bench: { xmin: -0.20000001788139343, xmax: 0.20000001788139343, zmin: -0.07500002533197403, zmax: 0.07500002533197403 },
  bush: { xmin: -0.08946483582258224, xmax: 0.09989581257104874, zmin: -0.09955329447984695, zmax: 0.09954001754522324 },
  dumpster: { xmin: -0.2829735279083252, xmax: 0.2829735279083252, zmin: -0.17639896273612976, zmax: 0.17639896273612976 },
  firehydrant: { xmin: -0.06774556636810303, xmax: 0.06774961948394775, zmin: -0.06509828567504883, zmax: 0.0662224292755127 },
  trash_A: { xmin: -0.060088641941547394, xmax: 0.06668513268232346, zmin: -0.0666484460234642, zmax: 0.0666484460234642 },
  trash_B: { xmin: -0.026508506387472153, xmax: 0.041553303599357605, zmin: -0.032371584326028824, zmax: 0.038469985127449036 },
  // The street trees, measured from forest.glb. Their canopies are wide enough that the slot
  // they reserve is most of a terrace bay — which is the point: a tree is not something a
  // building may be built through, and a row that ignored them would put a wall in a canopy.
  Tree_4_A_Color1: { xmin: -0.9600079655647278, xmax: 1.0473434925079346, zmin: -1.0196812152862549, zmax: 0.9846721291542053 },
  Tree_1_A_Color1: { xmin: -1.9345909357070923, xmax: 1.2464021444320679, zmin: -1.6255630254745483, zmax: 1.6255637407302856 },
})

/**
 * The kit's own street props, none of which were ever placed until now.
 *
 * City Builder Bits ships all six and the colony used none of them: the verge carried a
 * streetlight, a signal and a crossing and otherwise nothing at all, which is a large part of
 * why the streets read as a model of a town rather than a town.
 *
 * Ordered so the two pieces of litter come last, where the weighting below makes them the
 * common ones — a kerb has more rubbish on it than it has benches.
 */
export const VERGE_PROPS = Object.freeze(['bench', 'dumpster', 'bush', 'firehydrant', 'trash_A', 'trash_B'])

/**
 * What a prop is scaled by.
 *
 * 1, against the streetlight's 1.6, and judged against the cars rather than against metres:
 * the kit's buildings and its cars are not drawn to one scale (a building is 2.4 across and a
 * car 0.985 long, which would make a terraced house two car-lengths wide), so "how big is this
 * really" has no answer here. What does have an answer is how a bench looks beside a parked
 * car, and at 1 a bench is 0.4 — about four tenths of a car, which is a bench.
 */
const PROP_SCALE = 1

/** How many of a furnished cell's arms get a prop, in hundredths. */
const PROP_PERCENT = 55

/** The props that have a front worth pointing at the road; the rest read the same either way. */
const PROPS_THAT_FACE = new Set(['bench', 'dumpster'])

/**
 * The trees that line a street, and what each is scaled by.
 *
 * From the **forest** kit, not the city one — City Builder Bits has no tree — which is why
 * these entries carry a `kit` and everything else on the verge does not. The two packs have
 * their own atlases and so cannot share a material or a mesh: `createRoads` builds the city
 * parts, `createStreetTrees` builds these, and `cellFurniture` is what both read so a tree
 * takes part in `reservedSlots` like any other obstacle.
 *
 * Both scales bring their part to about 2.2 units tall, which is a little over a streetlight
 * (0.96 authored at 1.6 = 1.54) — a street tree that a lamp out-tops is not a street tree.
 * `Tree_4_A` is the narrow one and does most of the work; `Tree_1_A` is broader and rounder,
 * so a row of them is not a colonnade of the same shape repeated.
 */
export const STREET_TREES = Object.freeze([
  { part: 'Tree_4_A_Color1', scale: 0.42 },
  { part: 'Tree_1_A_Color1', scale: 0.53 },
])

/** How many of a furnished cell's arms are planted, in hundredths. */
const TREE_PERCENT = 60

/**
 * The world-space, axis-aligned box one piece of verge furniture actually occupies: its local
 * box (`FURNITURE_LOCAL_BBOX`), rotated by its own placement `ry` — always a multiple of pi/2
 * for everything this module places, so the box stays axis-aligned, the same rotation three.js's
 * own `makeRotationY` applies — and scaled, then placed at the furniture's own `(x, z)`.
 *
 * @param f one entry from `cellFurniture`/`vergeFurniture`, `{part, x, z, ry, scale}`
 * @returns `{xmin, xmax, zmin, zmax}`, or `null` if `f.part` has no known footprint
 */
export function furnitureWorldBounds(f) {
  const b = FURNITURE_LOCAL_BBOX[f.part]
  if (!b) return null
  const c = Math.cos(f.ry)
  const s = Math.sin(f.ry)
  const corners = [
    [b.xmin, b.zmin],
    [b.xmin, b.zmax],
    [b.xmax, b.zmin],
    [b.xmax, b.zmax],
  ]
  let xmin = Infinity
  let xmax = -Infinity
  let zmin = Infinity
  let zmax = -Infinity
  for (const [lx, lz] of corners) {
    const wx = (lx * c + lz * s) * f.scale
    const wz = (-lx * s + lz * c) * f.scale
    xmin = Math.min(xmin, wx)
    xmax = Math.max(xmax, wx)
    zmin = Math.min(zmin, wz)
    zmax = Math.max(zmax, wz)
  }
  return { xmin: f.x + xmin, xmax: f.x + xmax, zmin: f.z + zmin, zmax: f.z + zmax }
}

// ── the scene half ───────────────────────────────────────────────────────────────────

/** The pieces this module draws, all from the city atlas. */
const STRAIGHT_PART = 'road_straight'
/**
 * The playful revision's own change: every bend used the hard 90-degree `road_corner` before
 * this; the reference render's corners read as rounded, so bends now place this curved piece
 * instead. Its ports were measured separately, not assumed identical to `road_corner`'s — see
 * `CORNER_ARMS`'s own doc comment above.
 */
const CORNER_PART = 'road_corner_curved'
const TSPLIT_PART = 'road_tsplit'
const JUNCTION_PART = 'road_junction'

/**
 * Build the street surface — and, where `vergeFurniture` puts one, its verge — for one
 * street plan.
 *
 * One merged geometry per kit part (`road_straight`, `road_corner_curved`, `road_tsplit`,
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
export function createRoads({ streets, groundAt, apron = new Set() }) {
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

  // `apron` is the depot: reached by a street arm, never paved itself. See `carriagewayTiles`.
  const tiles = carriagewayTiles(streets.cells, CELL_SIZE, apron)
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
  /** `s` is either one number — the furniture, which is scaled the same way on every axis —
   *  or a `{ across, along }` pair from `tileScale`, for the carriageway. */
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
    // Across the run is the tile's x, along it its z — and scale lands before yaw, so this
    // is in the tile's own frame whichever way it has been turned.
    if (typeof s === 'number') composer.add(part, { s, x, y, z, ry })
    else composer.add(part, { sx: s.across, sy: s.across, sz: s.along, x, y, z, ry })
  }
  for (const tile of roadTiles) place(tile.part, tile.x, tile.z, tile.ry, tileScale(tile.part), ROAD_SURFACE_LIFT)
  // A crossing stands in for a carriageway tile, so it is scaled like one — its own seams are
  // with the straights either side of it and it has to reach across them the same way.
  for (const f of furniture) place(f.part, f.x, f.z, f.ry, f.part === CROSSING_PART ? tileScale(f.part) : f.scale, f.lift)

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

  // The carriageway the town actually laid, crossings already removed, so a caller can put
  // something on the road without recomputing where the road is. `parkedCars`
  // (`traffic.js`) is the one consumer: it needs to know which tiles are plain straight
  // runs, and a zebra is not one.
  // And the verge beside it. `createStreetTrees` is the consumer: the trees among this list
  // are forest-kit parts, which `place` above skips because they are not in the city kit.
  group.userData.verge = furniture
  group.userData.carriageway = roadTiles

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
