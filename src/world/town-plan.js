import { CELL_SIZE } from './grid.js'
import { mulberry } from './rng.js'
import { TOWN_CELL_RADIUS } from './street-plan.js'
import { TOWN_SEED, townRadiusAt, inTown } from './town-outline.js'
import { cellFurniture, furnitureWorldBounds } from './road-mesh.js'

/**
 * What stands in a block.
 *
 * Every function here is a function of **cell position only**. That is the rule the whole
 * town rests on: the colony is not consulted, nothing is stored, and no state carries between
 * calls. So when the colony grows into a block, the drawing code simply skips it; when the
 * colony shrinks again the same buildings come back, in the same places, because they were
 * never anywhere to be lost.
 */

// `TOWN_SEED`, `townRadiusAt` and `inTown` now live in `town-outline.js` — see that module's
// own doc comment for why — and are re-exported here so every existing import site
// (`town-mesh.js`, the test files) keeps working unchanged.
export { TOWN_SEED, townRadiusAt, inTown }

/** The eight buildings in `city.glb`, all 2 x 2 in plan and 1.65-3.05 tall. */
export const BUILDING_PARTS = Object.freeze([
  'building_A', 'building_B', 'building_C', 'building_D',
  'building_E', 'building_F', 'building_G', 'building_H',
])

/**
 * What a kit building is scaled by. A part is 2 units across; the kit's own module is the
 * road tiles' scale — `roadTileScale()` in `road-mesh.js` derives it as
 * `CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE = 2.4 / 2 = 1.2`, the same figure repeated here rather
 * than imported. This file does now import `road-mesh.js` — for `cellFurniture` and
 * `furnitureWorldBounds` (see `reservedSlots` below), safe in that one direction since
 * `road-mesh.js` no longer needs anything from this file (see `town-outline.js`'s own doc
 * comment for why) — but a bare number like this one is not worth threading through that import
 * just to save one repeated line. At 1.2 a building is 2.4 wide and 1.98-3.66 (2.0-3.7) tall —
 * a townhouse, not a warehouse — and five stand edge to edge across one 12-unit frontage
 * (`SLOTS_PER_SIDE`, `SLOT_PITCH` below), exactly as five carriageway tiles tile a street cell
 * (`SUBGRID` in `road-mesh.js`).
 */
export const BUILDING_SCALE = 1.2

/**
 * How much of the block frontage is left as green rather than built.
 *
 * Lowered from 0.3 to 0.18 in this revision (the density-tuning revision, building on the
 * density-recovery revision, `0954f67`). 0.3 was itself already a correction of an earlier
 * 0.55, forced there purely to fit the town under an under-measured, since-corrected
 * `TOWN_VERTEX_BUDGET` (`town-mesh.js`) — but 0.3 was never re-examined against the budget's
 * honest, re-measured figure, and this revision's own measurements show it did not need to be
 * that high either: at `0954f67` (`GREEN_SHARE` 0.3, `GAP_SHARE` 0.25) the town placed 157
 * buildings for 352,369 vertices, 27% of the 1,310,000 budget, with 957,631 vertices unused —
 * the budget was never the constraint on density, `GREEN_SHARE` and `GAP_SHARE` were.
 *
 * Measured in steps against the real street network (78 in-town, non-street cells total):
 *
 * ```
 * GREEN_SHARE  green/built   measured green share
 * 0.30         20 / 58       0.256
 * 0.22         17 / 61       0.218
 * 0.20         13 / 65       0.167
 * 0.18         13 / 65       0.167   <- chosen
 * 0.16         11 / 67       0.141
 * 0.15         11 / 67       0.141
 * ```
 *
 * (`GREEN_SHARE` is a per-cell probability threshold checked against a fixed, deterministic
 * stream — see `cellRand` — so the *measured* share moves in discrete steps as individual
 * cells' own draws cross the threshold, not smoothly with it; 0.20 and 0.18 land on the same
 * side of every one of the 78 draws and so measure identically.) Even at the extreme of
 * `GREEN_SHARE` and `GAP_SHARE` both near zero — no parks, no gaps, every eligible slot filled
 * — the real network places only 285 buildings for 641,804 vertices, 49% of budget: the
 * *structural* ceiling on this town's density is the street network's own geometry (how many
 * cells front a street at all, and how many of each row's slots survive `CORNER_SKIP_COUNT` and
 * `reservedSlots`), not `TOWN_VERTEX_BUDGET`, at any point on this range. 0.18 was chosen over
 * pushing further down to 0.16/0.15 because the gain was marginal (65 -> 67 built cells, +2)
 * against a real cost: at 0.16 and below the measured share (0.141) falls under
 * `test/town-plan.test.mjs`'s existing `> 0.15` bound, which would need re-pointing for a
 * two-cell gain not worth it. 0.18 keeps a clearly visible, occasional park (13 of 78 candidate
 * cells, about one in six) comfortably inside the existing, unmodified bounds.
 */
export const GREEN_SHARE = 0.18

/** How many buildings stand in a row along one street-facing side of a block cell — the same
 *  count the road tiles themselves tile a cell at (`SUBGRID` in `road-mesh.js`), so a
 *  building's row falls on the identical sub-grid pitch as the carriageway beside it:
 *  `SLOT_PITCH` below is exactly `CARRIAGEWAY_WIDTH` (2.4), and exactly a building's own width
 *  (`BUILDING_SCALE * 2`), so a full row of five spans one 12-unit cell edge with no gap and no
 *  overlap between neighbours. */
export const SLOTS_PER_SIDE = 5

/** World units between two neighbouring slots' centres. `CELL_SIZE / SLOTS_PER_SIDE` = 2.4 —
 *  see `SLOTS_PER_SIDE` above for why that number matters. */
export const SLOT_PITCH = CELL_SIZE / SLOTS_PER_SIDE

/**
 * The chance any one slot in a frontage row is left empty — a break in the terrace rather
 * than a missing tooth in an otherwise-full row, since it is rolled independently per slot and
 * most rows of five still come up mostly full.
 *
 * Lowered from 0.25 to 0.1 in this revision (the density-tuning revision, building on the
 * density-recovery revision, `0954f67`). 0.25 was itself raised from an earlier 0.18 purely to
 * fit the town under an under-measured, since-corrected `TOWN_VERTEX_BUDGET` (`town-mesh.js`);
 * this revision's own measurements (see `GREEN_SHARE`'s own doc comment for the full budget
 * arithmetic) show that ceiling was never actually binding — even the town's structural maximum
 * (`GREEN_SHARE` and `GAP_SHARE` both near zero) uses only 49% of the real, re-measured budget —
 * so the terrace can be denser without touching it.
 *
 * Measured in steps against the real street network, `GREEN_SHARE` held at this revision's own
 * 0.18 throughout so the two levers' effects don't get tangled together:
 *
 * ```
 * GAP_SHARE  buildings  vertices
 * 0.25       179        397,532
 * 0.12       207        459,658
 * 0.10       212        471,813   <- chosen
 * 0.08       220        491,701
 * 0.05       227        510,219
 * 0.03       231        516,594
 * ~0 (min)   237        532,514
 * ```
 *
 * Most of a row's own slots are already ruled out before `GAP_SHARE` is ever rolled — by
 * `CORNER_SKIP_COUNT` near a corner, or by `reservedSlots` at a street cell's own furniture — so
 * a large share of what used to read as "a gap" at the old 0.25 was really a corner or a lamp
 * post, not this constant, and the marginal gain of pushing `GAP_SHARE` toward zero is
 * correspondingly small and fast-diminishing (212 -> 220 -> 227 -> 231 -> 237, each halving of
 * the remaining probability buying fewer buildings than the last). 0.1 was chosen to sit past
 * that knee — most of the achievable density (212 of the theoretical 237-building maximum at
 * this `GREEN_SHARE`) — while still leaving a clearly visible, occasional gap in a row of five
 * (roughly one slot in ten left empty) rather than pushing all the way to a wall with no breaks
 * at all, which is the terrace-reads-as-continuous-but-not-monolithic look the reference asks
 * for. Vertex budget played no part in choosing this figure — every value in the table above,
 * including the near-zero one, stays under half of `TOWN_VERTEX_BUDGET`.
 */
export const GAP_SHARE = 0.1

/** The centre offset of each slot in a frontage row, from the cell's own centre along the
 *  row's own axis — `SLOTS_PER_SIDE` values centred on 0 and spaced `SLOT_PITCH` apart, e.g.
 *  `[-4.8, -2.4, 0, 2.4, 4.8]`. The outermost slot's own half-width (`BUILDING_SCALE`) reaches
 *  exactly `CELL_HALF` (6), so the row fills the frontage corner to corner without spilling
 *  past either side of the cell. */
const SLOT_OFFSETS = Array.from(
  { length: SLOTS_PER_SIDE },
  (_, i) => (i - (SLOTS_PER_SIDE - 1) / 2) * SLOT_PITCH
)

/** Half a block cell's extent, in world units — the fence `keepClearCells` puts around a
 *  street or built cell so scatter cannot reach across the kerb into it. */
const CELL_HALF = CELL_SIZE / 2

/** How far a green block's own planting radius reaches — a little under half a cell (`5`
 *  against a `CELL_HALF` of `6`), so planted props stay off the kerb even when the block is
 *  otherwise empty. */
const GREEN_PLANT_RADIUS = 5

/**
 * Half the carriageway's own width — the point past which a street cell stops being asphalt.
 * The same figure `road-mesh.js` exports as `CARRIAGEWAY_WIDTH / 2`, duplicated here rather
 * than imported for the same reason `BUILDING_SCALE` is: importing `road-mesh.js` — which this
 * file now does, for `cellFurniture`/`furnitureWorldBounds` (see `reservedSlots` below) — is
 * safe in that one direction, but `road-mesh.js` still cannot import back (it needs `inTown`,
 * which now lives in `town-outline.js` precisely so this stays one-directional — see that
 * module's own doc comment). A constant this small is not worth threading through an import
 * for on top of that.
 */
const CARRIAGEWAY_HALF = 1.2

/**
 * The clearance a building's own outer wall keeps past the carriageway's edge — now that the
 * furniture that used to force a wide margin here (see below) is instead handled by
 * `reservedSlots`, leaving a real gap in the terrace for whichever slot a lamp, crossing or
 * signal actually occupies.
 *
 * The owner's request: "laten we de gebouwen nu aan de weg maken zonder de gras ruimte
 * ertussen" (put the buildings against the road, with no strip of grass between). The facade
 * revision tried to close this by widening `BUILDING_CLEARANCE` itself (0.6 -> 0.65), because a
 * streetlight standing at the kerb line — `CARRIAGEWAY_HALF + 0.6` = 1.8 from the street's own
 * centre line, the same distance a flush wall wants to stand at — left 49 of 186 buildings
 * overlapping a streetlight at the old, tighter figure. That revision's own report named the
 * real fix directly: "on a real street a lamp post stands *in front of* the buildings, not
 * instead of them — the conflict only exists because our frontage tries to put a building in
 * every slot along the street edge, including the slot a lamp occupies." This revision does
 * that instead: `reservedSlots` (below) finds, for each row, which of its own slots a piece of
 * real verge furniture on the street cell it fronts would actually reach, and `blockContent`
 * leaves that one slot empty rather than pushing the *whole row* back to clear it. With the
 * lamp no longer sharing a slot with a building, the wall can come back to the carriageway's own
 * edge: a small margin past `CARRIAGEWAY_HALF` (1.2) so the wall's face does not sit exactly
 * coincident with (and, given any floating-point slack, occasionally inside) the outermost
 * carriageway tile — the same reasoning `ROAD_SURFACE_LIFT` already uses for the vertical gap
 * between a road tile and the terrain under it, applied here to the horizontal one between a
 * wall and the carriageway beside it.
 */
const BUILDING_CLEARANCE = 0.05

/**
 * How far a building row's centre line sits from its cell's own centre, toward the street it
 * faces.
 *
 * The playful revision removes the pavement entirely (see `road-mesh.js`'s own doc comment on
 * `cellFurniture`) — there is no footway edge left to stand a wall against, so the wall stands
 * directly at the carriageway's own edge instead, with only `BUILDING_CLEARANCE` (0.05) past it:
 * `CARRIAGEWAY_HALF + BUILDING_CLEARANCE` = `1.2 + 0.05` = `1.25` from the street cell's centre
 * line — the reach a building's own outer wall keeps from the street it fronts, now that the
 * furniture that used to force a wider gap here is handled by reserving its own slot instead
 * (see `BUILDING_CLEARANCE`'s own doc comment, and `reservedSlots` below).
 *
 * Measured against `public/assets/city.glb`: every one of `building_A..H`'s local footprint
 * spans `-1..1` on both its own X and Z, so at `BUILDING_SCALE` the half-depth facing the
 * street is exactly `BUILDING_SCALE` (a part is 2 units deep before scale, and scale halves
 * that to one factor: `BUILDING_SCALE * 2 / 2 = BUILDING_SCALE`). The street cell's own centre
 * line sits one full cell (`CELL_SIZE`) from this block cell's centre, so putting the wall's
 * outer face at that 1.25-unit reach from that centre line means its row's own centre line —
 * `SET_BACK` — sits at `CELL_SIZE - (CARRIAGEWAY_HALF + BUILDING_CLEARANCE) - BUILDING_SCALE` =
 * `12 - 1.25 - 1.2` = `9.55` from *this* cell's own centre: past the block's own boundary
 * (`CELL_HALF`, 6) and into the neighbouring street cell's own verge, right up against the
 * carriageway itself now that nothing paved stands between them.
 *
 * That deliberately breaks the old invariant that a building never crosses its own cell's
 * boundary — it was never a rule of the reference render, only an accident of the old, flush
 * placement. The invariant that actually matters — a building overlapping no carriageway, no
 * streetlight, no traffic light, no crossing and no other building — still holds, checked
 * directly against the real street, building and verge furniture data by
 * `test/town-plan.test.mjs`: the wall's outer face sits `BUILDING_CLEARANCE` (0.05) past the
 * carriageway's own edge, clear of it rather than merely touching it, and every slot a real
 * piece of furniture would actually reach is left empty by `reservedSlots` rather than swept
 * under a wider margin.
 */
export const SET_BACK = CELL_SIZE - (CARRIAGEWAY_HALF + BUILDING_CLEARANCE) - BUILDING_SCALE

/**
 * How many slots from each corner `blockContent` has to skip when the diagonal block across
 * that corner is real — not always exactly one, now that `SET_BACK` reaches all the way to the
 * kerb line.
 *
 * Two cells diagonal across a street-cell corner (one facing the street via `d`, the other via
 * a perpendicular direction — see the "Corners, across two cells" doc comment below) each place
 * a row of slots at world-space perpendicular offsets `SLOT_PITCH/2, ..., (SLOTS_PER_SIDE-1)/2 *
 * SLOT_PITCH` from their own row's own centre. Working through the two rows' actual world
 * positions (both anchored `SET_BACK` from their own cell's centre, one cell apart on each
 * axis), the slot `k` cells in from a given corner (`k = 0` outermost) sits close enough to
 * collide with the diagonal block's own `k`-th slot whenever `SET_BACK` falls in the open
 * interval `(4.8 + 2.4k, 9.6 + 2.4k)` — the two figures being, respectively, the point where
 * the two slots are exactly `2 * BUILDING_SCALE` apart on both axes (a bare touch, not yet an
 * overlap) and the point where they coincide exactly on one axis. At the tighten revision's
 * `SET_BACK` (7.2) that interval's own left edge for `k=0` is exactly 7.2 — a tangency, not an
 * overlap, which is why skipping only the single outermost slot (`k=0`) was ever enough. At the
 * playful and facade revisions' 9.0/8.95, and still at this revision's 9.55 (closer to the kerb
 * line than either — see `BUILDING_CLEARANCE`'s own doc comment for why) — `k=0` *and* `k=1`
 * both fall inside their own risk interval, so both still have to be skipped. `k=2`, this row's
 * centre slot, stays outside every interval up to `SET_BACK` 9.6, so it is never at risk here —
 * and 9.55 stays (just) under that ceiling too, so this revision's own closer setback does not
 * add a third skipped slot.
 *
 * Computed from `SET_BACK` itself rather than hand-set to `2`, so a future change to either
 * constant keeps this correct instead of silently under- or over-skipping.
 */
const CORNER_SKIP_COUNT = (() => {
  let k = 0
  while (k < SLOTS_PER_SIDE && SET_BACK > 4.8 + 2.4 * k && SET_BACK < 9.6 + 2.4 * k) k++
  return k
})()

/**
 * Which of a row's own slots a street cell's own verge furniture actually reaches — reserved so
 * `blockContent` leaves that one slot empty rather than pushing the whole row back to clear it
 * (see `BUILDING_CLEARANCE`'s own doc comment for why that is the better fix).
 *
 * `road-mesh.js`'s `cellFurniture` is the one source of truth for where a street cell's lamps,
 * crossing and traffic light actually stand — this calls it directly rather than re-deriving
 * R7/R11's own arm selection, cell hash and arm order the way an earlier revision did (that
 * duplication is exactly what this replaces). For each piece it returns, this projects the
 * piece's real, rotated world footprint (`furnitureWorldBounds`) onto the row's own two axes —
 * `d`, the depth toward the street, and `perp`, the lateral axis every slot sits along — and
 * checks it against a candidate building's own square footprint at each slot, the same
 * axis-aligned overlap test `test/town-plan.test.mjs`'s own sweep uses. A slot is reserved only
 * if a real piece of furniture would actually reach it at this revision's own `SET_BACK`, not by
 * any fixed offset hand-derived for one `SET_BACK` and liable to drift when it changes.
 *
 * @param streetCell the street cell this row fronts, `{x, z}`
 * @param d the direction from the block cell to `streetCell`
 * @param perp the row's own lateral axis, `rotCW(d)`
 * @param blockCenter the block cell's own world centre, `{x, z}`
 * @param streetKeys the street membership set
 * @returns a `Set` of slot indices (into `SLOT_OFFSETS`) a real piece of furniture occupies
 */
function reservedSlots(streetCell, d, perp, blockCenter, streetKeys) {
  const reserved = new Set()
  for (const f of cellFurniture(streetCell, streetKeys, CELL_SIZE)) {
    const bounds = furnitureWorldBounds(f)
    if (!bounds) continue
    SLOT_OFFSETS.forEach((offset, k) => {
      if (reserved.has(k)) return
      const bx = blockCenter.x + d.x * SET_BACK + perp.x * offset
      const bz = blockCenter.z + d.z * SET_BACK + perp.z * offset
      const overlaps =
        bx - BUILDING_SCALE < bounds.xmax &&
        bx + BUILDING_SCALE > bounds.xmin &&
        bz - BUILDING_SCALE < bounds.zmax &&
        bz + BUILDING_SCALE > bounds.zmin
      if (overlaps) reserved.add(k)
    })
  }
  return reserved
}

/** A stable per-cell random stream. Same cell, same numbers, always. */
function cellRand(cell, salt) {
  return mulberry(TOWN_SEED ^ ((cell.x + 512) * 1021) ^ ((cell.z + 512) * 3571) ^ salt)
}

const SIDES = [
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
]

/** A quarter turn about +Y (matching how three.js rotates x, z): the direction a row's own
 *  axis runs in, given the direction `d` its buildings face. */
const rotCW = (d) => ({ x: d.z, z: -d.x })
/** The other quarter turn. */
const rotCCW = (d) => ({ x: -d.z, z: d.x })

/**
 * What fills one block cell.
 *
 * Buildings go on the sides that face a street and nowhere else — a house fronts a road, and
 * a building in the middle of a block would be reachable by nothing. On each street-facing
 * side, a whole row of them (`SLOTS_PER_SIDE`) stands adjacent along the sub-grid pitch the
 * road tiles themselves use (`SLOT_PITCH`), so a frontage reads as a terrace rather than one
 * building in a field — with the odd slot left empty (`GAP_SHARE`) so a terrace is not always
 * one unbroken wall the full width of the cell.
 *
 * **Corners, within one cell.** A cell that faces a street on two *adjacent* sides (an actual
 * street corner, not two opposite sides of a through-block) has two rows meeting near the same
 * corner. At the old, flush `SET_BACK` (equal to `SLOT_OFFSETS`' own extreme, 4.8) the two
 * rows' outermost slots landed on the exact same spot — a real overlap. `SET_BACK` now reaches
 * further out, into the neighbouring street cell's own verge (see `SET_BACK`'s own doc
 * comment): at the tighten revision's 7.2 that pushed the two rows' outermost (`k=0`) slots
 * apart to an exact tangency (a bare touch, fragile against floating-point error); at the
 * playful revision's 9.0 it pushes them clear of each other by a real 1.8-unit gap on each axis
 * (working through the same geometry `CORNER_SKIP_COUNT`'s own doc comment does for the
 * across-two-cells case below: `SET_BACK - 4.8` = 4.2, against the `2 * BUILDING_SCALE` = 2.4
 * needed to touch) — no longer even a near miss. Both slots are still left empty at a shared
 * corner regardless, rather than leaning on either figure: a small gap at the corner of an
 * intersection is true to the reference render too, not just a safety margin against two
 * buildings that would otherwise graze or overlap.
 *
 * **Corners, across two cells.** Reaching into the neighbouring street cell's own verge opens
 * a second, genuinely new collision `SET_BACK`'s old, flush value never could: two *different*
 * block cells, diagonal across a shared street-cell corner, can each reach a slot close enough
 * to that same corner to overlap — measured directly on the real street set
 * (`test/town-plan.test.mjs`), e.g. a block west of a street cell and a block north of the
 * same street cell each placing a building near that street cell's own corner. This is not
 * the within-cell case above — the two rows belong to two different cells, so neither cell's
 * own `faces` check ever sees the other — so it needs its own test:
 * for a row facing street cell `S` via `d`, the `CORNER_SKIP_COUNT` slots nearest a given
 * perpendicular corner (not always just the one outermost slot — see that constant's own doc
 * comment for the geometry) are skipped whenever the block on the *other* side of that same
 * corner — `S` itself shifted one step further along that corner's own perpendicular direction
 * — is a real, in-town, non-street cell, since that cell would place its own colliding building
 * there regardless of what this cell decides. Both of the two diagonal cells see each other
 * this way, so both skip — the corner goes empty from both sides rather than picking a winner,
 * the same resolution the within-cell case already uses, and still a pure function of position
 * and the street set alone: no colony state, and no need to call `blockContent` recursively on
 * the diagonal cell to know it would collide.
 *
 * **Reserved slots, at the street cell's own furniture.** With `SET_BACK` now reaching all the
 * way to the carriageway's own edge (see `BUILDING_CLEARANCE`'s own doc comment), a row can
 * reach not only another building but the street cell `S` it fronts' own verge furniture — a
 * streetlight on one of `S`'s arms, or, if `S` is a furnished three- or four-arm junction (R7),
 * its own crossing or traffic light. Rather than pushing the *whole row* back to clear whichever
 * fixture stands nearest (the facade revision's own fix, and the wider grass strip it left
 * behind), `reservedSlots` finds exactly which of this row's own slots a real piece of `S`'s
 * furniture actually reaches and only that slot is left empty — a lamp or a signal standing in
 * a gap in the terrace, at the kerb, with buildings tight on either side of it, the way a real
 * street works: the furniture stands *in front of* the terrace, not instead of one of its
 * houses. Unlike the within-cell and across-two-cells cases above, this is not symmetric — `S`
 * places its furniture regardless of what this cell decides, so only this row's own reached
 * slots give way, not two rows at once — and it is not a `faces`/`isBlock` question either: `S`
 * is already a street cell (the one this row fronts), never a diagonal block, so neither
 * existing check ever sees it.
 *
 * @param cell the block cell, `{x, z}`
 * @param streetKeys the street membership set from `planStreets().all`
 * @returns `{ kind: 'green' | 'built', buildings: [{part, x, z, ry, scale}] }` — world
 *   positions, ready to place
 */
export function blockContent(cell, streetKeys) {
  const rand = cellRand(cell, 0x5bd1)
  if (rand() < GREEN_SHARE) return { kind: 'green', buildings: [] }

  const cx = cell.x * CELL_SIZE
  const cz = cell.z * CELL_SIZE
  const buildings = []
  const faces = (d) => streetKeys.has(`${cell.x + d.x},${cell.z + d.z}`)
  // A real, in-town, non-street cell — the structural test for "would place a building here",
  // independent of colony state, randomness or this cell's own row (see the "Corners, across
  // two cells" doc comment above).
  const isBlock = (p) => inTown(p) && !streetKeys.has(`${p.x},${p.z}`)
  const last = SLOT_OFFSETS.length - 1
  for (const d of SIDES) {
    if (!faces(d)) continue
    // The axis a row of buildings runs along, across the frontage — a quarter turn from `d`,
    // the direction the row faces.
    const perp = rotCW(d)
    const street = { x: cell.x + d.x, z: cell.z + d.z }
    // The corner diagonally opposite this cell, across the street cell `d` fronts: the block
    // that would claim the same outermost slot from the other side (see the "Corners, across
    // two cells" doc comment above).
    const diagFirst = { x: street.x + rotCCW(d).x, z: street.z + rotCCW(d).z }
    const diagLast = { x: street.x + rotCW(d).x, z: street.z + rotCW(d).z }
    // The two corners this row's outermost slots would reach: skip whichever ones — see
    // `CORNER_SKIP_COUNT`'s own doc comment, not always just the single outermost slot — sit
    // near a corner whose perpendicular street is also faced here (this cell's own corner), or
    // whose diagonal block across the street would claim the identical spot (the neighbouring
    // cell's corner) — so no two rows, in this cell or across the street, ever both claim it.
    const skipFirst = faces(rotCCW(d)) || isBlock(diagFirst)
    const skipLast = faces(rotCW(d)) || isBlock(diagLast)
    // The slots the street cell `S` this row fronts' own furniture — a streetlight, a crossing
    // or a traffic light — actually reaches, computed against the real, measured positions
    // `road-mesh.js`'s `cellFurniture` places rather than re-derived here (see "Reserved slots,
    // at the street cell's own furniture" above, and `reservedSlots`'s own doc comment).
    const furnitureSlots = reservedSlots(street, d, perp, { x: cx, z: cz }, streetKeys)
    SLOT_OFFSETS.forEach((offset, i) => {
      if ((i < CORNER_SKIP_COUNT && skipFirst) || (i > last - CORNER_SKIP_COUNT && skipLast)) return
      if (furnitureSlots.has(i)) return
      // A gap in the terrace here and there, so a frontage is not always one unbroken wall.
      if (rand() < GAP_SHARE) return
      buildings.push({
        part: BUILDING_PARTS[Math.floor(rand() * BUILDING_PARTS.length)],
        x: cx + d.x * SET_BACK + perp.x * offset,
        z: cz + d.z * SET_BACK + perp.z * offset,
        // Measured (Task 5 Step 1, on all eight parts building_A..H): one atlas cell — the
        // door/window band — sits only on the model's local +Z face, spanning most of its
        // width, never mirrored to -Z and never pinned to an X face. So a kit building does
        // have a front, and it faces local +Z. `atan2(d.x, d.z)` is the rotation that turns
        // that local +Z to point along `d`, the direction from this cell toward the street
        // cell it fronts — so the door ends up facing the street, not the block's interior.
        // The row runs along `perp`, so this rotation is the same for every slot in it.
        ry: Math.atan2(d.x, d.z),
        scale: BUILDING_SCALE,
      })
    })
  }
  return { kind: 'built', buildings }
}

/**
 * Every in-town, non-street, non-claimed cell, classified by `blockContent`. The same sweep
 * `townPlan` runs — same bounds, same order, same `inTown`/street/claimed tests — kept in one
 * place so `greenBlocks` and `keepClearCells` can never disagree with each other, or with the
 * buildings `townPlan` actually draws, about which cell is which.
 */
function* sweepBlocks({ streets, claimed = new Set() }) {
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const k = `${x},${z}`
      const cell = { x, z }
      if (!inTown(cell)) continue
      if (streets.has(k)) {
        yield { cell, kind: 'street' }
        continue
      }
      if (claimed.has(k)) {
        yield { cell, kind: 'claimed' }
        continue
      }
      yield { cell, kind: blockContent(cell, streets).kind }
    }
  }
}

/**
 * The town's green blocks, as planting sites for `createScatter`: world-space centres with a
 * radius a little under half a cell, so nothing planted there reaches the kerb.
 *
 * @param streets the street membership set (`planStreets().all`)
 * @param claimed the cells the colony occupies, as `"x,z"` keys — a claimed cell is the
 *   colony's own ground, never the town's, so it is never offered as a planting site even if
 *   `blockContent` would have called it green
 * @returns `[{x, z, radius}]`
 */
export function greenBlocks({ streets, claimed = new Set() }) {
  const out = []
  for (const { cell, kind } of sweepBlocks({ streets, claimed })) {
    if (kind !== 'green') continue
    out.push({ x: cell.x * CELL_SIZE, z: cell.z * CELL_SIZE, radius: GREEN_PLANT_RADIUS })
  }
  return out
}

/**
 * Every town cell the wild scatter (`createScatter`'s countryside rocks and flora) must stay
 * off: every street cell — the owner's report was trees and rocks landing on the carriageway
 * — every built block, so a boulder never sprouts between two houses, and every cell the
 * colony has claimed for itself. Green blocks are the one kind of town cell left out, because
 * they are exactly where this planting is meant to land: the same call that dresses the
 * countryside seeds them too, since nothing there is fenced off.
 *
 * A per-cell fence, not a radius: the town's outline is not a circle (see `townRadiusAt`), so
 * a single circular `keepClear` entry either misses the corners of the true outline or eats
 * into the countryside well past it — and either way a circle drawn at cell granularity from a
 * random radial sample can still let a prop land inside the true wavy edge, on a street cell,
 * which is the defect this exists to close.
 *
 * Streets are fenced off wherever `streets` actually says one is, not wherever `inTown` agrees
 * — `road-mesh.js` draws a carriageway tile on every cell in `streets`, regardless of whether
 * that cell falls inside the town's own (wavy) outline, so gating the fence on `inTown` would
 * leave the street network's own fringe cells undefended. Built and claimed cells, by
 * contrast, only ever exist where `inTown` is true — `blockContent` is never asked about a
 * cell outside it — so `sweepBlocks` is the right source for those two.
 *
 * @returns `[{x, z, half}]` — world-space cell centres and half-extents, in `createScatter`'s
 *   `keepClear` shape (see `planet.js`)
 */
export function keepClearCells({ streets, claimed = new Set() }) {
  const out = []
  for (const k of streets) {
    const [x, z] = k.split(',').map(Number)
    out.push({ x: x * CELL_SIZE, z: z * CELL_SIZE, half: CELL_HALF })
  }
  for (const { cell, kind } of sweepBlocks({ streets, claimed })) {
    if (kind === 'street' || kind === 'green') continue
    out.push({ x: cell.x * CELL_SIZE, z: cell.z * CELL_SIZE, half: CELL_HALF })
  }
  return out
}
