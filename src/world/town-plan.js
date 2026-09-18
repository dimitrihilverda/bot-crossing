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
 * cells front a street at all, and how many of each row's slots survive `cornerSkips` and
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
 * **The table above predates the per-slot `cornerSkips`** (it was measured under the blanket
 * corner rule, which alone accounted for 188 of the 416 empty slots), so every total in it is
 * now low: at this `GAP_SHARE` the town places 299 buildings, not 212. The shape of the curve
 * is what it was chosen for and that has not changed — each halving of the remaining
 * probability buys fewer buildings than the last — but do not read the absolute numbers as
 * current.

 * Most of a row's own slots are already ruled out before `GAP_SHARE` is ever rolled — by
 * `cornerSkips` near a corner, or by `reservedSlots` at a street cell's own furniture — so
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
/** The world-space centre of every slot a row would fill, before anything is skipped. */
function rowSlotCentres(cell, d) {
  const perp = rotCW(d)
  const bx = cell.x * CELL_SIZE + d.x * SET_BACK
  const bz = cell.z * CELL_SIZE + d.z * SET_BACK
  return SLOT_OFFSETS.map((offset) => ({ x: bx + perp.x * offset, z: bz + perp.z * offset }))
}

/**
 * Whether the buildings on two slots would overlap.
 *
 * Half-extent is `BUILDING_SCALE`, so two slots clash when they are closer than a full
 * building on both axes. The epsilon matters: adjacent slots in one row sit exactly
 * `SLOT_PITCH` (2.4) apart, which is exactly two half-extents, and a terrace is meant to touch.
 */
const SLOT_EPS = 1e-9
const slotsClash = (a, b) =>
  Math.abs(a.x - b.x) < 2 * BUILDING_SCALE - SLOT_EPS && Math.abs(a.z - b.z) < 2 * BUILDING_SCALE - SLOT_EPS

/**
 * A total order over rows, so a clash is resolved the same way whichever side is asked.
 *
 * This is the whole of the tie-break, and it has to be a *total* order rather than a rule about
 * corners: if both rows yield, the terrace loses two buildings to prevent one overlap; if
 * neither does, they overlap. Lexicographic on the cell and then the facing direction — nothing
 * about it is meaningful, only that it is consistent.
 */
const rowRank = (cell, d) => `${cell.x},${cell.z},${d.x},${d.z}`

/**
 * Every row that could possibly reach the same ground as this one.
 *
 * Only four candidates exist, which is what makes a per-slot rule cheap. A row fronts one
 * street cell, and the rows that can reach into that same cell are the ones belonging to the
 * two blocks flanking it — `SET_BACK` reaches past the block's own boundary and into the street
 * cell's verge, so those two rows run perpendicular to this one and cross it near the corners.
 * Beyond that, this cell may front more than one street itself, and two of its own rows meet at
 * its own corner.
 *
 * The block directly opposite, across the carriageway, is deliberately not a candidate: its row
 * runs parallel to this one on the far side of the road and can never reach it.
 *
 * **The own-cell pair currently never clashes, and is kept anyway.** Measured on the shipping
 * plan: 51 of its 78 block cells front two or more streets, so this branch really does run —
 * and the town places exactly 299 buildings whether the branch is there or not. At `SET_BACK`
 * 9.55 a cell's own two rows are too far apart to meet; they last touched at the flush 4.8, and
 * by 9.0 they were already clear by 1.8 on each axis. It stays because `SET_BACK` is derived
 * rather than fixed — it moves whenever the carriageway width or the building scale does — and
 * a rule that silently stops covering a case it was written for is worse than four comparisons
 * a row. What it must not be given is credit for working: no test fails on its removal today,
 * and that is a fact about the geometry rather than a gap in the tests.
 */
function rivalRows(cell, d, streetKeys) {
  const street = { x: cell.x + d.x, z: cell.z + d.z }
  const isBlock = (p) => inTown(p) && !streetKeys.has(`${p.x},${p.z}`)
  const fronts = (c, dir) => streetKeys.has(`${c.x + dir.x},${c.z + dir.z}`)
  const out = []

  for (const turn of [rotCW, rotCCW]) {
    const t = turn(d)
    const flank = { x: street.x + t.x, z: street.z + t.z }
    const facing = { x: -t.x, z: -t.z }
    if (isBlock(flank) && fronts(flank, facing)) out.push({ cell: flank, d: facing })
  }

  for (const other of SIDES) {
    if (other.x === d.x && other.z === d.z) continue
    if (fronts(cell, other)) out.push({ cell, d: other })
  }

  return out
}

/**
 * Which of a row's own slots it has to leave empty for a neighbouring row.
 *
 * This replaced a blanket rule, and the difference is most of the town. The old
 * `CORNER_SKIP_COUNT` was a *count* — computed from `SET_BACK`, which at the current, kerb-side
 * value works out to 2 — cut from either end of a row whenever anything at all stood across
 * that corner. A row has `SLOTS_PER_SIDE` (5) slots, so a row with a real block diagonally
 * across both of its corners kept exactly one.
 *
 * Measured on the shipping street plan before this change: 169 buildings out of 585 slots, and
 * the blanket rule alone accounted for 188 of the 416 empty ones — six times the next largest
 * cause. With it switched off, 357 buildings were placed and only 74 pairs actually overlapped,
 * which 41 buildings' worth of yielding resolves entirely. The rule was discarding 147
 * buildings to prevent 41.
 *
 * So it asks per slot instead: does this slot's own footprint clash with a slot of a row that
 * outranks it? That keeps every building a blanket cut was taking for no reason, and the
 * town-wide no-overlap test in `test/town-plan.test.mjs` is what holds the other half.
 *
 * @param cell the block cell this row belongs to
 * @param d the direction the row faces, toward the street it fronts
 * @param streetKeys the street membership set
 * @returns the indices into `SLOT_OFFSETS` this row must leave empty
 */
export function cornerSkips(cell, d, streetKeys) {
  const mine = rowSlotCentres(cell, d)
  const myRank = rowRank(cell, d)
  const skips = new Set()

  for (const rival of rivalRows(cell, d, streetKeys)) {
    // Strictly lower wins, so exactly one side of any clash yields.
    if (rowRank(rival.cell, rival.d) >= myRank) continue
    const theirs = rowSlotCentres(rival.cell, rival.d)
    mine.forEach((slot, i) => {
      if (theirs.some((other) => slotsClash(slot, other))) skips.add(i)
    })
  }

  return skips
}

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
 * **Corners.** `SET_BACK` reaches past this cell's own boundary and into the verge of the
 * street cell a row fronts, which means two rows can reach the same ground: this cell's own two
 * rows where it fronts two adjacent streets, and the row of a block diagonally across a shared
 * street-cell corner. Neither case can be settled by looking at one cell alone.
 *
 * This used to be a blanket rule — a count of slots, derived from `SET_BACK`, cut from either
 * end of a row whenever anything at all stood across that corner. At the current kerb-side
 * `SET_BACK` that count is two, a row has five slots, and a row with a real block across both
 * corners kept exactly one. Measured on the shipping street plan it cost 188 of the town's 416
 * empty slots, six times the next largest cause, and switching it off showed that 316 of the
 * resulting buildings collided with nothing whatsoever. It was discarding 147 buildings to
 * prevent 41.
 *
 * `cornerSkips` replaces it with a per-slot question — does this slot's own footprint clash
 * with a slot of a row that outranks it — and a total order over rows so that exactly one side
 * of any clash yields rather than both or neither. See that function for the rivals it has to
 * consider and why there are only ever four of them.
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
  for (const d of SIDES) {
    if (!faces(d)) continue
    // The axis a row of buildings runs along, across the frontage — a quarter turn from `d`,
    // the direction the row faces.
    const perp = rotCW(d)
    const street = { x: cell.x + d.x, z: cell.z + d.z }
    // Which of this row's slots a neighbouring row has the better claim to — asked per slot,
    // against the real footprints, rather than cut as a count from either end. See
    // `cornerSkips`: the blanket rule this replaced was discarding 147 buildings across the
    // town to prevent 41 overlaps.
    const cornerSlots = cornerSkips(cell, d, streetKeys)
    // The slots the street cell `S` this row fronts' own furniture — a streetlight, a crossing
    // or a traffic light — actually reaches, computed against the real, measured positions
    // `road-mesh.js`'s `cellFurniture` places rather than re-derived here (see "Reserved slots,
    // at the street cell's own furniture" above, and `reservedSlots`'s own doc comment).
    const furnitureSlots = reservedSlots(street, d, perp, { x: cx, z: cz }, streetKeys)
    SLOT_OFFSETS.forEach((offset, i) => {
      if (cornerSlots.has(i)) return
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
 * What a park is planted with, and how far each plant's own spread reaches once scaled.
 *
 * All from the **forest** kit — the city pack has no plant in it at all — which is why each
 * entry is marked with its kit downstream. `spread` is the measured half-reach of the part's
 * own footprint times its scale, carried alongside rather than recomputed, because it is what
 * keeps a canopy inside the block: a plant placed by its centre alone hangs over the kerb.
 *
 * The trees are scaled to the same ~2.2 units the street trees are, so a park and the street
 * beside it are planted with the same size of tree. The bushes come out around 0.45, the
 * height they need to read as undergrowth beneath them rather than as small trees of their own.
 */
export const PARK_PLANTS = Object.freeze([
  { part: 'Tree_4_A_Color1', scale: 0.42, spread: 1.0473434925079346 * 0.42 },
  { part: 'Tree_1_A_Color1', scale: 0.53, spread: 1.9345909357070923 * 0.53 },
  { part: 'Tree_3_A_Color1', scale: 0.63, spread: 1.552119255065918 * 0.63 },
  { part: 'Bush_1_E_Color1', scale: 0.55, spread: 0.8318 * 0.55 },
  { part: 'Bush_3_B_Color1', scale: 0.56, spread: 0.8417 * 0.56 },
  // Ground cover. One entry among six rather than a pass of its own: a park wants the odd tuft
  // of long grass at the foot of a tree, not a meadow. 0.32 brings it to about 0.3 tall, which
  // is under a bush and well under the bench beside it.
  { part: 'Grass_2_D_Color1', scale: 0.32, spread: 0.7121 * 0.32 },
])

/** How many plants a park gets. */
const PARK_PLANTS_MIN = 5
const PARK_PLANTS_MAX = 11

/** Its own salt, so a block's planting is not drawn from the same stream as its buildings. */
const PARK_SALT = 0x70a1

/**
 * What fills the town's green blocks.
 *
 * `greenBlocks` has named these sites — and been tested — since the planting fix, and nothing
 * in production ever called it: the town set aside almost a fifth of its blocks as green and
 * then left every one of them as bare grass.
 *
 * Positions are spread over *area* rather than over radius — the square root of a uniform
 * draw, the same trick `createScatter` uses — because a linear draw piles a park's planting
 * into its middle and leaves a ring of empty grass round the edge, which reads as a flowerbed
 * rather than as a park. Each plant's own `spread` comes out of the radius before it is
 * placed, so a canopy stays inside the block however large the part is.
 *
 * @param blocks the planting sites from `greenBlocks`
 * @param seed a run seed, folded in alongside each block's own position
 * @returns `[{part, kit, x, z, ry, scale, spread, lift}]` — the shape `createStreetTrees` draws
 */
export function parkPlanting(blocks, seed = 0, arms = []) {
  const out = []
  for (const block of blocks) {
    const cell = { x: Math.round(block.x / CELL_SIZE), z: Math.round(block.z / CELL_SIZE) }
    const rand = cellRand(cell, PARK_SALT ^ seed)
    const count = PARK_PLANTS_MIN + Math.floor(rand() * (PARK_PLANTS_MAX - PARK_PLANTS_MIN + 1))
    for (let i = 0; i < count; i++) {
      const plant = PARK_PLANTS[Math.floor(rand() * PARK_PLANTS.length)]
      const room = Math.max(0, block.radius - plant.spread)
      let x = 0
      let z = 0
      // Drawn until it lands off the path rather than drawn once and then discarded. Filtering
      // afterwards cost about a third of every park's planting — measured across the thirteen
      // green blocks — and a park that loses a third of its trees to its own footpath is a
      // footpath with trees beside it.
      let tries = 0
      do {
        const r = Math.sqrt(rand()) * room
        const a = rand() * Math.PI * 2
        x = Math.cos(a) * r
        z = Math.sin(a) * r
      } while (onParkPath(x, z, plant.spread, arms) && ++tries < 40)

      if (onParkPath(x, z, plant.spread, arms)) {
        // A loop that can fail needs an answer for when it does: stand the plant just clear of
        // the first arm rather than leave it on the paving.
        //
        // **This has never fired.** Measured across the eleven green blocks that have a path: 89
        // plants, none placed here. Forty draws against a strip covering a fraction of the
        // circle is generous, and it stays only because a park whose radius shrank or whose path
        // widened could exhaust them. It also cannot be pinned on its own — the draw above and
        // this line cover each other, so switching either off still keeps every plant off the
        // paving. What the test pins is that the draw *spreads* them, which one fixed position
        // cannot do.
        const d = arms[0]
        const across = PARK_PATH_WIDTH / 2 + plant.spread + 0.05
        x = -d.z * across
        z = d.x * across
      }

      out.push({
        part: plant.part,
        kit: 'forest',
        x: block.x + x,
        z: block.z + z,
        ry: rand() * Math.PI * 2,
        scale: plant.scale,
        spread: plant.spread,
        lift: 0,
      })
    }
  }
  return out
}

/**
 * How wide a park's footpath is.
 *
 * 1.5, which is two things at once. It is comfortably narrower than the 2.4 carriageway — the
 * first attempt made the path exactly as wide as a road, which turned a park into a street
 * through a lawn — and it divides the 6 units from the middle of a cell to its edge exactly
 * four times, so an arm is four square slabs that finish flush with the boundary. A slab over
 * that boundary would land in the street cell's verge, among the lamps and the parked bicycles.
 */
export const PARK_PATH_WIDTH = 1.5

/** The kit's own pavement slab: 2 x 2 authored, the same shape as a road tile. */
const PAVING_PART = 'base'
const PAVING_SCALE = PARK_PATH_WIDTH / 2

/** Slabs per arm — `(CELL_SIZE / 2) / PARK_PATH_WIDTH`, which is why the width is what it is. */
const PARK_PATH_SLABS = CELL_SIZE / 2 / PARK_PATH_WIDTH

/** Whether a thing of radius `spread` at a block-relative position stands on the path. */
function onParkPath(x, z, spread, arms) {
  return arms.some((d) => {
    const along = x * d.x + z * d.z
    const across = Math.abs(x * d.z - z * d.x)
    return along >= -PARK_PATH_WIDTH / 2 && along <= CELL_SIZE / 2 && across < PARK_PATH_WIDTH / 2 + spread
  })
}

/**
 * Which way a park's path runs.
 *
 * **One route through, not a spur to every street it touches.** The first design gave a block
 * an arm per street-facing side; drawn against the real plan that was plainly wrong, because
 * five of the thirteen green blocks front three streets and one fronts four, and a three-armed
 * cross swallowed two thirds of the block. A park is somewhere you walk through, so a pair of
 * *opposite* sides is what makes a route rather than a bend — and where no such pair exists,
 * one way in is better than a corner cut across the middle.
 *
 * A block nothing reaches gets nothing. Two of the thirteen front no street at all, and a path
 * from the middle to nowhere is worse than none: they stay a copse.
 */
export function parkArms(cell, streetKeys) {
  const faces = SIDES.filter((d) => streetKeys.has(`${cell.x + d.x},${cell.z + d.z}`))
  if (!faces.length) return []
  for (const d of faces) {
    const opposite = faces.find((o) => o.x === -d.x && o.z === -d.z)
    if (opposite) return [d, opposite]
  }
  return [faces[0]]
}

/**
 * The slabs that make a park's path.
 *
 * Laid from the middle outward along each arm, centres at `(i + 0.5) * PARK_PATH_WIDTH`, so the
 * first slab's inner edge is the middle of the cell and the last one's outer edge is the cell
 * boundary. Two opposite arms therefore meet at the centre with no seam and no overlap; a
 * single arm is a path in from the street that ends in the middle, where the benches are.
 */
export function parkPaving(block, arms) {
  const out = []
  for (const d of arms) {
    for (let i = 0; i < PARK_PATH_SLABS; i++) {
      const along = (i + 0.5) * PARK_PATH_WIDTH
      out.push({
        part: PAVING_PART,
        kit: 'city',
        x: block.x + d.x * along,
        z: block.z + d.z * along,
        ry: 0,
        scale: PAVING_SCALE,
        // The same hair of clearance the carriageway keeps off the terrain, for the same
        // reason: a slab laid exactly on the height field touches it with zero gap.
        lift: 0.01,
      })
    }
  }
  return out
}

/** How far from the path's own centre line a bench stands, and where along it. */
const BENCH_ACROSS = PARK_PATH_WIDTH / 2 + 0.35
const BENCH_ALONG = PARK_PATH_WIDTH * 1.5

/**
 * The benches and the bin.
 *
 * A bench per arm, alternating sides so a through-route does not get both of them on the same
 * edge, each set back from the paving and turned to face it — a bench with its back to the path
 * is the one arrangement that reads as a mistake. One bin, beside the first bench.
 *
 * Nothing here is placed on a block with no path: a bench in the middle of a copse is furniture
 * nobody can reach.
 */
export function parkFurniture(block, arms, seed = 0) {
  if (!arms.length) return []
  const out = []
  arms.forEach((d, i) => {
    const side = i % 2 === 0 ? 1 : -1
    // Across the path, on `side`, and facing back toward its centre line.
    const across = { x: -d.z * side, z: d.x * side }
    out.push({
      part: 'bench',
      kit: 'city',
      x: block.x + d.x * BENCH_ALONG + across.x * BENCH_ACROSS,
      z: block.z + d.z * BENCH_ALONG + across.z * BENCH_ACROSS,
      ry: Math.atan2(-across.x, -across.z),
      scale: 1,
      lift: 0,
    })
  })

  const d = arms[0]
  const across = { x: -d.z, z: d.x }
  out.push({
    part: seed % 2 === 0 ? 'trash_A' : 'trash_B',
    kit: 'city',
    x: block.x + d.x * (BENCH_ALONG + 0.8) + across.x * BENCH_ACROSS,
    z: block.z + d.z * (BENCH_ALONG + 0.8) + across.z * BENCH_ACROSS,
    ry: 0,
    scale: 1,
    lift: 0,
  })
  return out
}

/**
 * Everything that stands in the town's parks: the path, the benches and bin beside it, and the
 * planting arranged around all of it.
 *
 * Every item carries the kit it comes from. The paving, benches and bin are city-kit parts and
 * the planting is forest-kit, and the two packs have their own atlases — they cannot share a
 * mesh or a material, so each renderer takes its own half and an unmarked item would be handed
 * to the wrong one and silently never drawn.
 */
export function parkItems(blocks, streetKeys, seed = 0) {
  const out = []
  for (const block of blocks) {
    const cell = { x: Math.round(block.x / CELL_SIZE), z: Math.round(block.z / CELL_SIZE) }
    const arms = parkArms(cell, streetKeys)
    out.push(...parkPaving(block, arms))
    out.push(...parkFurniture(block, arms, seed))
    out.push(...parkPlanting([block], seed, arms))
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
