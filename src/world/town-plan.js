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
 * Measured against the real street network: 0.3 gives a green fraction of **0.239** (17 green
 * of 71 blocks) — comfortably inside `test/town-plan.test.mjs`'s `> 0.15` / `< 0.6` bounds —
 * and the town it produces places 327 buildings for 750,285 vertices, well under the
 * re-measured budget (see `TOWN_VERTEX_BUDGET`'s own doc comment for the exact figure and the
 * margin). No other lever — the frontage-gap probability, the kit's `_withoutBase` variants,
 * `TOWN_CELL_RADIUS` — needed pulling to reach this; the budget's own headroom already covers
 * it.
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
 * How far a building row's centre line sits from its cell's own centre, toward the street it
 * faces.
 *
 * The pavement band and the carriageway both belong to the *neighbouring* street cell, not to
 * this one — `vergeFurniture` in `road-mesh.js` lays every kerb, lamp and crossing inside the
 * street cell's own footprint, never past it into a block cell. So a block cell has nothing of
 * its own to set back *from* except its own edge: a building may stand right up to it, the way
 * the reference render's terraces stand right against the pavement with no front yard.
 *
 * Measured (this revision), against `public/assets/city.glb`: every one of `building_A..H`'s
 * local footprint spans `-1..1` on both its own X and Z, so at `BUILDING_SCALE` the half-depth
 * facing the street is exactly `BUILDING_SCALE` (a part is 2 units deep before scale, and
 * scale halves that to one factor: `BUILDING_SCALE * 2 / 2 = BUILDING_SCALE`).
 *
 * `CELL_HALF - BUILDING_SCALE` = `6 - 1.2` = `4.8` puts the street-facing wall's own outer
 * face exactly on the cell edge — flush, not short of it. That is deliberate and unchanged by
 * the verge revision that widened `road-mesh.js`'s pavement to reach the same edge (see
 * `vergeFurniture`'s doc comment there): now that the pavement also reaches this coordinate,
 * "flush" is what makes the façade stand *against* the pavement rather than short of it with a
 * strip of grass between, which was the owner's actual complaint (traced to the pavement's own
 * width, not this formula — see the same doc comment).
 *
 * No clearance margin is subtracted to pull the wall back off that edge. A margin was tried
 * and measured to be the wrong fix: pulling every row's centre line in by even a small amount
 * shifts *every* building on every side by the same amount toward the cell's centre, and two
 * perpendicular rows' near-corner slots — one row's second-to-outermost slot and the other's
 * second slot, the pair immediately inside the corner two rows' own skip logic already leaves
 * empty (see `blockContent`'s own doc comment) — are exactly tangent at this formula's value
 * (both `SET_BACK` and `SLOT_OFFSETS`' own extreme both equal `4.8`, which is what makes every
 * terrace tile edge-to-edge with no overlap). Shrinking `SET_BACK` by any amount breaks that
 * exact tangency and reintroduces a genuine corner clip between those two slots — measured
 * directly: at `SET_BACK = 4.78` (a 0.02 clearance), `blockContent({x:-5,z:4}, ...)` on the
 * real street set places `building_G` at `(-64.78, 50.4)` and `building_H` at
 * `(-62.4, 52.78)`, whose 2.4-unit-square footprints overlap by `0.02 x 0.02` at their shared
 * corner — caught immediately by `test/town-plan.test.mjs`'s own no-overlap assertion.
 *
 * A wall meeting a pavement tile's edge at the same coordinate is not the z-fighting
 * configuration the "avoid z-fighting" guidance in the brief for this change was written
 * against, either: a wall is a vertical face and the pavement's top is a horizontal one, so
 * even landing on the identical world X or Z they do not share a plane the way two coincident
 * horizontal slabs (the bug `VERGE_LIFT` exists to prevent, see its own doc comment) would —
 * they meet at a seam, not a competing surface. So flush is the correct, and the safe, answer.
 */
export const SET_BACK = CELL_HALF - BUILDING_SCALE

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
 * **Corners.** A row's outermost slot reaches exactly to the cell's own edge on both axes at
 * once (see `SLOT_OFFSETS`), which is fine on its own — but a cell that faces a street on two
 * *adjacent* sides (an actual street corner, not two opposite sides of a through-block) has
 * two rows meeting at the same corner, and each row's outermost slot would claim that same
 * square of ground: the row facing `d`'s slot at one end sits exactly where the row facing the
 * perpendicular street's own outermost slot sits, a real overlap, not just a tight fit. Rather
 * than pick a winner, both are left empty at a shared corner — a small gap at the corner of an
 * intersection is true to the reference render too, not just a fix for two buildings trying to
 * stand in the same place.
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
  const last = SLOT_OFFSETS.length - 1
  for (const d of SIDES) {
    if (!faces(d)) continue
    // The axis a row of buildings runs along, across the frontage — a quarter turn from `d`,
    // the direction the row faces.
    const perp = rotCW(d)
    // The two corners this row's outermost slots would reach: skip either one whose
    // perpendicular street is also faced here, so the two rows never both claim it.
    const skipFirst = faces(rotCCW(d))
    const skipLast = faces(rotCW(d))
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
