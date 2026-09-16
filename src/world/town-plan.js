import { CELL_SIZE } from './grid.js'
import { mulberry } from './rng.js'
import { TOWN_CELL_RADIUS } from './street-plan.js'

/**
 * What stands in a block.
 *
 * Every function here is a function of **cell position only**. That is the rule the whole
 * town rests on: the colony is not consulted, nothing is stored, and no state carries between
 * calls. So when the colony grows into a block, the drawing code simply skips it; when the
 * colony shrinks again the same buildings come back, in the same places, because they were
 * never anywhere to be lost.
 */

export const TOWN_SEED = 77313

/** The eight buildings in `city.glb`, all 2 x 2 in plan and 1.65-3.05 tall. */
export const BUILDING_PARTS = Object.freeze([
  'building_A', 'building_B', 'building_C', 'building_D',
  'building_E', 'building_F', 'building_G', 'building_H',
])

/**
 * What a kit building is scaled by. A part is 2 units across; the kit's own module is the
 * road tiles' scale — `roadTileScale()` in `road-mesh.js` derives it as
 * `CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE = 2.4 / 2 = 1.2`, the same figure repeated here so this
 * file does not import `road-mesh.js` (which already imports this one — importing back would
 * make the two modules a load-order-dependent cycle for the sake of one constant). At 1.2 a
 * building is 2.4 wide and 1.98-3.66 (2.0-3.7) tall — a townhouse, not a warehouse — and five
 * stand edge to edge across one 12-unit frontage (`SLOTS_PER_SIDE`, `SLOT_PITCH` below),
 * exactly as five carriageway tiles tile a street cell (`SUBGRID` in `road-mesh.js`).
 */
export const BUILDING_SCALE = 1.2

/**
 * How much of the block frontage is left as green rather than built.
 *
 * Brought back down from 0.55 to 0.3 in this revision. 0.55 was never a design choice — it
 * was forced there in the previous revision purely to fit the town under `TOWN_VERTEX_BUDGET`
 * (`town-mesh.js`) as that constant stood then, and it meant more than half of every block was
 * empty, which was a large part of why the owner reported the town reading as "verspreid en
 * ver uit elkaar" (spread out and far apart) rather than a place with occasional parks. That
 * budget has since been re-measured to the colony's own *complete* draw rather than its houses
 * alone (see `TOWN_VERTEX_BUDGET`'s own doc comment for the derivation) — a legitimate
 * correction to what was being measured, not a raised ceiling — and the headroom it opened up
 * is spent here first, exactly as the spec's ruling on that re-measurement directs: a green
 * block should read as an occasional park, not the default.
 *
 * Measured against the real street network, after the tighten revision's own changes
 * (`MAX_BLOCK` 3 -> 2 in `street-plan.js`, more and smaller blocks): 0.3 gives a green
 * fraction of **0.254** (15 green of 59 built-or-green cells, up slightly from the previous
 * revision's 0.239 — the same share of more, smaller blocks lands a little differently) —
 * comfortably inside `test/town-plan.test.mjs`'s `> 0.15` / `< 0.6` bounds — and the town it
 * produces places 332 buildings for 760,343 vertices, still well under the budget (see
 * `TOWN_VERTEX_BUDGET`'s own doc comment in `town-mesh.js` for the exact figures and margin).
 * `GREEN_SHARE` itself was not touched by the tighten revision; the density it targets did not
 * need it.
 */
export const GREEN_SHARE = 0.3

/** How many buildings stand in a row along one street-facing side of a block cell — the same
 *  count the road tiles themselves tile a cell at (`SUBGRID` in `road-mesh.js`), so a
 *  building's row falls on the identical sub-grid pitch as the pavement and carriageway
 *  beside it: `SLOT_PITCH` below is exactly `CARRIAGEWAY_WIDTH` (2.4), and exactly a building's
 *  own width (`BUILDING_SCALE * 2`), so a full row of five spans one 12-unit cell edge with no
 *  gap and no overlap between neighbours. */
export const SLOTS_PER_SIDE = 5

/** World units between two neighbouring slots' centres. `CELL_SIZE / SLOTS_PER_SIDE` = 2.4 —
 *  see `SLOTS_PER_SIDE` above for why that number matters. */
export const SLOT_PITCH = CELL_SIZE / SLOTS_PER_SIDE

/**
 * The chance any one slot in a frontage row is left empty — a break in the terrace rather
 * than a missing tooth in an otherwise-full row, since it is rolled independently per slot and
 * most rows of five still come up mostly full. Raising this is the first lever against
 * `TOWN_VERTEX_BUDGET` (see `town-mesh.js`): it shortens terrace runs without touching how
 * wide, tall or dense any single building is.
 *
 * Raised from 0.18 (Task 5 Step 2, measured): a kit building at its correct scale is a third
 * the width of the old one, so several stand where one did, and the old value left the town
 * far over budget on its own. It was not pushed further than this, though — past here the
 * measured isolated-building rate (a kept slot with an empty slot on both sides, no longer
 * read as part of a row) climbs faster than the vertex total falls, working against the very
 * terrace look this revision exists for — so the rest of the cut came from `GREEN_SHARE`
 * (fewer built blocks at all) instead of driving this past where a row still mostly reads as
 * a row.
 */
export const GAP_SHARE = 0.25

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
 * How far the footway's own outer edge sits from a street cell's centre line — the same
 * figure `vergeFurniture` in `road-mesh.js` produces for the single sub-grid pavement tile
 * immediately outside the kerb (one sub-grid step out, `CELL_SIZE / SUBGRID = 2.4`, plus that
 * tile's own half-width, `BUILDING_SCALE * 2 / 2` scaled by `roadTileScale()` — the same 1.2
 * a kit tile shares with a kit building — giving `2.4 + 1.2 = 3.6`). Duplicated here rather
 * than imported for the same reason `BUILDING_SCALE` is: importing `road-mesh.js` would make
 * it and this module a load-order-dependent cycle for the sake of one constant, since
 * `road-mesh.js` already imports `inTown` from here.
 */
const FOOTWAY_OUTER_REACH = 3.6

/**
 * How far a building row's centre line sits from its cell's own centre, toward the street it
 * faces.
 *
 * A street cell is `CELL_SIZE` (12) wide, and after the tighten revision (see
 * `vergeFurniture`'s own doc comment in `road-mesh.js`) its carriageway plus footway occupy
 * only the middle `2 * FOOTWAY_OUTER_REACH` = `7.2` of that — leaving a `CELL_HALF -
 * FOOTWAY_OUTER_REACH` = `2.4`-unit strip of bare verge on each side before the next block
 * begins. That strip used to sit empty, with the building flush against the *block's own*
 * boundary (`CELL_HALF`, short of the street by the whole 2.4-unit strip) — which is what the
 * owner's screenshot actually showed: houses standing well back from a road that, from the
 * kerb outward, was mostly grass. The fix is not to pave that strip (a plaza was tried and
 * reverted, see the same doc comment) but to let the terrace occupy it: a building's
 * street-facing wall now stands just outside the footway's own outer edge, at
 * `FOOTWAY_OUTER_REACH` from the street's centre line, rather than at the block cell's own
 * boundary.
 *
 * Measured against `public/assets/city.glb`: every one of `building_A..H`'s local footprint
 * spans `-1..1` on both its own X and Z, so at `BUILDING_SCALE` the half-depth facing the
 * street is exactly `BUILDING_SCALE` (a part is 2 units deep before scale, and scale halves
 * that to one factor: `BUILDING_SCALE * 2 / 2 = BUILDING_SCALE`). The street cell's own centre
 * line sits one full cell (`CELL_SIZE`) from this block cell's centre, so putting the wall's
 * outer face at `FOOTWAY_OUTER_REACH` from that centre line means its row's own centre line —
 * `SET_BACK` — sits at `CELL_SIZE - FOOTWAY_OUTER_REACH - BUILDING_SCALE` = `12 - 3.6 - 1.2` =
 * `7.2` from *this* cell's own centre: past the block's own boundary (`CELL_HALF`, 6) and into
 * the neighbouring street cell's own outer verge, exactly where the freed strip is.
 *
 * That deliberately breaks the old invariant that a building never crosses its own cell's
 * boundary — it was never a rule of the reference render, only an accident of the old, flush
 * placement, and holding onto it is what produced the gap the owner reported. The invariant
 * that actually matters — a building overlapping no pavement, no carriageway, and no other
 * building — still holds, checked directly against the real street and building data by
 * `test/town-plan.test.mjs`: the wall's outer face lands exactly on the footway's own outer
 * edge (`FOOTWAY_OUTER_REACH`), touching it rather than overlapping it, the same way it used
 * to touch the block's own boundary.
 *
 * No clearance margin is subtracted to pull the wall back off that edge, for the same reason
 * flush was chosen before: a wall meeting a pavement tile's edge at the same coordinate is not
 * the z-fighting configuration `VERGE_LIFT` exists to prevent — a wall is a vertical face and
 * the pavement's top is a horizontal one, so they meet at a seam, not a competing surface.
 */
export const SET_BACK = CELL_SIZE - FOOTWAY_OUTER_REACH - BUILDING_SCALE

/**
 * The town's outer edge: a radius that varies with direction, so the town frays into the
 * countryside instead of stopping on a square. Three harmonics with seeded phases — enough
 * to look unplanned, few enough to stay smooth.
 */
const OUTLINE = (() => {
  const rand = mulberry(TOWN_SEED)
  return [2, 3, 5].map((n) => ({ n, amp: 0.05 + rand() * 0.05, phase: rand() * Math.PI * 2 }))
})()

/** The town's radius, in cells, in the direction `angle`. */
export function townRadiusAt(angle) {
  let f = 1
  for (const h of OUTLINE) f -= (h.amp * (1 - Math.sin(h.n * angle + h.phase))) / 2
  return TOWN_CELL_RADIUS * f
}

/** Is this cell inside the town's outline? */
export function inTown(cell) {
  if (cell.x === 0 && cell.z === 0) return true
  return Math.hypot(cell.x, cell.z) <= townRadiusAt(Math.atan2(cell.z, cell.x))
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
 * corner. At the old, flush `SET_BACK` (equal to `SLOT_OFFSETS`' own extreme) the two rows'
 * outermost slots landed on the exact same spot — a real overlap. `SET_BACK` now reaches
 * further out, into the neighbouring street cell's own outer verge (see `SET_BACK`'s own doc
 * comment), which pushes the two rows' outermost slots apart to an exact tangency instead of a
 * coincidence — but still a bare touch, not a real gap, and fragile against floating-point
 * error besides. Both are still left empty at a shared corner rather than relying on that
 * tangency: a small gap at the corner of an intersection is true to the reference render too,
 * not just a safety margin for two buildings that would otherwise just graze each other.
 *
 * **Corners, across two cells.** Reaching into the neighbouring street cell's own verge opens
 * a second, genuinely new collision `SET_BACK`'s old, flush value never could: two *different*
 * block cells, diagonal across a shared street-cell corner, can each reach an outermost slot
 * into that same corner and land on the identical point — measured directly on the real
 * street set (`test/town-plan.test.mjs`), e.g. a block west of a street cell and a block north
 * of the same street cell both placing a building at that street cell's own (-4.8, -4.8)
 * corner. This is not the within-cell case above — the two rows belong to two different
 * cells, so neither cell's own `faces` check ever sees the other — so it needs its own test:
 * for a row facing street cell `S` via `d`, the slot nearest a given perpendicular corner is
 * skipped whenever the block on the *other* side of that same corner — `S` itself shifted one
 * step further along that corner's own perpendicular direction — is a real, in-town, non-
 * street cell, since that cell would place its own colliding building there regardless of
 * what this cell decides. Both of the two diagonal cells see each other this way, so both
 * skip — the corner goes empty from both sides rather than picking a winner, the same
 * resolution the within-cell case already uses, and still a pure function of position and the
 * street set alone: no colony state, and no need to call `blockContent` recursively on the
 * diagonal cell to know it would collide.
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
    // The two corners this row's outermost slots would reach: skip either one whose
    // perpendicular street is also faced here (this cell's own corner), or whose diagonal
    // block across the street would claim the identical spot (the neighbouring cell's
    // corner) — so no two rows, in this cell or across the street, ever both claim it.
    const skipFirst = faces(rotCCW(d)) || isBlock(diagFirst)
    const skipLast = faces(rotCW(d)) || isBlock(diagLast)
    SLOT_OFFSETS.forEach((offset, i) => {
      if ((i === 0 && skipFirst) || (i === last && skipLast)) return
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
