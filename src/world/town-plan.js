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
 * Half the carriageway's own width — the point past which a street cell stops being asphalt.
 * The same figure `road-mesh.js` exports as `CARRIAGEWAY_WIDTH / 2`, duplicated here rather
 * than imported for the same reason `BUILDING_SCALE` is: importing `road-mesh.js` would make
 * it and this module a load-order-dependent cycle for the sake of one constant, since
 * `road-mesh.js` already imports `inTown` from here.
 */
const CARRIAGEWAY_HALF = 1.2

/**
 * The clearance a building's own outer wall keeps past the carriageway's edge.
 *
 * The owner's next request, after the tighten revision landed, was to close this gap further
 * still: "laten we de gebouwen nu aan de weg maken zonder de gras ruimte ertussen" (put the
 * buildings against the road, with no strip of grass between). At the tighten revision's own
 * figure — `KERB_CLEARANCE` in `road-mesh.js`, 0.6, chosen only so a wall, a lamp post and a
 * signal pole would all read as standing at the same roadside distance — the wall's outer face
 * and a streetlight's own kerb line turn out to sit at *exactly* the same distance from the
 * street (both `CARRIAGEWAY_HALF + 0.6` = 1.8 from its centre line), a coincidence that was
 * never actually checked town-wide before now. `streetlight`'s mast is thin but not zero: its
 * local footprint (measured from `public/assets/city.glb`) is `-0.239..0.030` on X, and every
 * lamp's cantilever arm is rotated to overhang its own carriageway (see `vergeFurniture`'s own
 * doc comment in `road-mesh.js`), so the *small* side of that range — `0.030096590518951416` —
 * is always the one facing back toward the block, scaled by the lamp's own placement scale
 * (1.6): ≈ `0.0482`. A wall placed flush with the old 0.6 clearance shares that exact roadside
 * line with the lamp, so that thin sliver of mast lands inside the wall by the same margin —
 * confirmed by sweeping every built cell in the real town: 49 of 186 buildings actually
 * overlapped a streetlight at the old clearance, on both plain street frontages and junction
 * ones alike, not only at corners. `0.6` was never a safe figure; it was only ever *lucky* that
 * nothing checked it.
 *
 * So closing the gap here has to start from the lamp, not the carriageway: the wall's face has
 * to clear the lamp's own kerb line by that measured 0.0482, which needs `BUILDING_CLEARANCE`
 * of at least `0.6 + 0.0482` ≈ `0.6482` (confirmed against the real town: `0.648` still leaves
 * every one of those 49 overlaps, `0.649` clears all of them). `0.65` is used here instead of
 * that bare minimum — a clean number with a genuine sliver of margin past the threshold, the
 * same idiom `KERB_CLEARANCE` itself already uses. This is not the closing this brief asked
 * for — the grass strip moves from 0.6 to 0.65, wider than before, because the previous
 * revision's lamp placement was already standing exactly where a flush wall wants to be. See
 * `SET_BACK`'s own doc comment for where that leaves the wall, and `blockContent`'s "Corners,
 * at a governed junction arm" section for the traffic light — a *bulkier* fixture at the same
 * kerb line, which cannot be cleared by any `BUILDING_CLEARANCE` this small and is handled by
 * skipping the one slot it actually reaches instead.
 */
const BUILDING_CLEARANCE = 0.65

/**
 * How far a building row's centre line sits from its cell's own centre, toward the street it
 * faces.
 *
 * The playful revision removes the pavement entirely (see `road-mesh.js`'s own doc comment on
 * `vergeFurniture`) — there is no footway edge left to stand a wall against, so the wall stands
 * directly at the carriageway's own edge instead, with the same small clearance `road-mesh.js`
 * gives its own kerbside furniture: `CARRIAGEWAY_HALF + BUILDING_CLEARANCE` = `1.2 + 0.65` =
 * `1.85` from the street cell's centre line — the reach a building's own outer wall keeps from
 * the street it fronts.
 *
 * Measured against `public/assets/city.glb`: every one of `building_A..H`'s local footprint
 * spans `-1..1` on both its own X and Z, so at `BUILDING_SCALE` the half-depth facing the
 * street is exactly `BUILDING_SCALE` (a part is 2 units deep before scale, and scale halves
 * that to one factor: `BUILDING_SCALE * 2 / 2 = BUILDING_SCALE`). The street cell's own centre
 * line sits one full cell (`CELL_SIZE`) from this block cell's centre, so putting the wall's
 * outer face at that 1.85-unit reach from that centre line means its row's own centre line —
 * `SET_BACK` — sits at `CELL_SIZE - (CARRIAGEWAY_HALF + BUILDING_CLEARANCE) - BUILDING_SCALE` =
 * `12 - 1.85 - 1.2` = `8.95` from *this* cell's own centre: past the block's own boundary
 * (`CELL_HALF`, 6) and into the neighbouring street cell's own verge, right up against the
 * carriageway itself now that nothing paved stands between them.
 *
 * That deliberately breaks the old invariant that a building never crosses its own cell's
 * boundary — it was never a rule of the reference render, only an accident of the old, flush
 * placement. The invariant that actually matters — a building overlapping no carriageway and
 * no other building (or, new to this revision, no streetlight or traffic light — see
 * `BUILDING_CLEARANCE`'s own doc comment and `blockContent`'s "Corners, at a governed junction
 * arm" section) — still holds, checked directly against the real street, building and verge
 * furniture data by `test/town-plan.test.mjs`: the wall's outer face sits `BUILDING_CLEARANCE`
 * (0.65) past the carriageway's own edge, clear of it rather than merely touching it — a
 * genuine gap, not a seam, since (with the pavement gone) a wall and the road surface it now
 * stands beside are both real geometry a camera can pass between. That 0.65 is *wider* than
 * the 0.6 this revision set out to close — see `BUILDING_CLEARANCE`'s own doc comment for why
 * the streetlight, not the carriageway, ends up setting the real limit.
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
 * overlap, which is why skipping only the single outermost slot (`k=0`) was ever enough. At
 * the playful revision's 9.0, and still at this revision's 8.95 (closer to the kerb line than
 * the tighten revision, if slightly further back than the playful revision's own figure — see
 * `BUILDING_CLEARANCE`'s own doc comment for why) — `k=0` *and* `k=1` both fall inside their
 * own risk interval (measured directly, before this constant existed: two real buildings in the
 * actual street network overlapped by exactly 0.6 units on both axes), so both now have to be
 * skipped. `k=2`, this row's centre slot, stays outside every interval up to `SET_BACK` 9.6, so
 * it is never at risk here — and 8.95 stays under that ceiling too, so this revision's own
 * closer setback does not add a third skipped slot.
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
 * Which slot, counted in from a corner (`k = 0` outermost, matching `CORNER_SKIP_COUNT`'s own
 * indexing), a *governed junction arm*'s own traffic light reaches — see `blockContent`'s
 * "Corners, at a governed junction arm" section for what that means and why it is a separate
 * case from `CORNER_SKIP_COUNT`'s own (that one is about two buildings; this one is about a
 * building and the junction's own signal).
 *
 * Unlike the streetlight (see `BUILDING_CLEARANCE`'s own doc comment), a traffic light's own
 * footprint is too bulky to clear with any reasonable `BUILDING_CLEARANCE` — measured directly
 * against the real town, clearing it town-wide needs `BUILDING_CLEARANCE` past 0.83, most of a
 * whole extra `SLOT_PITCH` step back from the kerb, which would give back nearly everything
 * this revision closes. But a governed arm's own light sits at a *fixed* spot regardless of
 * `SET_BACK`: `KERB` (`CARRIAGEWAY_HALF + 0.6`, the same figure `road-mesh.js`'s own
 * `vergeFurniture` places it at) off the row's own centre-line, on the side its arm points to —
 * a fixed lateral offset from the row's own centre, never an along-street one, so which slot it
 * threatens does not move with `SET_BACK` either. Slot `k`'s own lateral span is
 * `CELL_HALF - BUILDING_SCALE - k * SLOT_PITCH ± BUILDING_SCALE`, i.e. `[3.6 - 2.4k, 6.0 -
 * 2.4k]`; solving for which `k` contains `KERB` (1.8) gives `k = 1` — never `k = 0` (too far
 * out, its own near edge starts past 1.8) or `k = 2` (too far in, its own far edge stops short
 * of 1.8) — confirmed directly against the real town: every one of the five real collisions
 * this revision found between a building and a traffic light sits at exactly this slot, and
 * none at any other.
 *
 * Computed the same way `CORNER_SKIP_COUNT` is — from the real constants, not hand-set — so a
 * future change to `CARRIAGEWAY_WIDTH`, `KERB_CLEARANCE`, `BUILDING_SCALE` or `SLOT_PITCH`
 * keeps this correct instead of silently drifting off the light's own real position. `-1` (no
 * slot) if none of them actually contains it, so a future constant change that moves the light
 * out of reach entirely disables this skip instead of silently skipping the wrong slot.
 */
const JUNCTION_LIGHT_SKIP_INDEX = (() => {
  const kerb = CARRIAGEWAY_HALF + 0.6 // KERB_CLEARANCE, duplicated from road-mesh.js — see BUILDING_CLEARANCE's own doc comment for why this file does not import that one
  for (let k = 0; k < SLOTS_PER_SIDE; k++) {
    const slotNear = CELL_HALF - BUILDING_SCALE - k * SLOT_PITCH - BUILDING_SCALE
    const slotFar = CELL_HALF - BUILDING_SCALE - k * SLOT_PITCH + BUILDING_SCALE
    if (kerb > slotNear && kerb < slotFar) return k
  }
  return -1
})()

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

/** Are two unit directions the same one? */
const sameDir = (a, b) => a.x === b.x && a.z === b.z

/** A JS `%` can come back negative; this never does. Duplicated from `road-mesh.js`'s own
 *  identical helper — see `BUILDING_CLEARANCE`'s own doc comment for why this file does not
 *  import that one. */
const mod = (n, m) => ((n % m) + m) % m

// road-mesh.js's own N, S, E, W, in its own N/S/E/W order — duplicated (not `SIDES` above,
// which is the same four directions in a different order) because `governingArm` below has to
// reproduce `vergeFurniture`'s `arms[mod(h, arms.length)]` selection exactly: which *index*
// `mod` picks depends on the order the arms were filtered in, not just which directions are
// present, so the order itself is part of the fact being duplicated.
const NSEW = [{ x: 0, z: -1 }, { x: 0, z: 1 }, { x: 1, z: 0 }, { x: -1, z: 0 }]

/**
 * R11 (`road-mesh.js`'s own `isFurnished`), duplicated here: a street cell only carries verge
 * furniture — lamps, a crossing, a traffic light — if at least one of its four neighbours is
 * itself *not* a street and lies inside `inTown`'s outline. A country-lane street cell places
 * no traffic light at all, so `governingArm` below must agree with this before it looks for one.
 */
function bordersTown(cell, streetKeys) {
  return NSEW.some((d) => {
    const n = { x: cell.x + d.x, z: cell.z + d.z }
    return !streetKeys.has(`${n.x},${n.z}`) && inTown(n)
  })
}

/**
 * Which arm (if any) of a street cell carries *that cell's own* traffic light — the same
 * selection `vergeFurniture` makes in `road-mesh.js` (R7: a furnished cell with three or four
 * arms gets one light, on the arm `cellHash(cell) mod arms.length` picks), replicated here so
 * `blockContent` can tell, without importing that module (see `BUILDING_CLEARANCE`'s own doc
 * comment), whether *its own* row would be reached by it. `null` if the cell carries no light
 * at all — too few arms, or (R11) it does not border the town.
 *
 * @param streetCell the street cell to check, `{x, z}`
 * @param streetKeys the street membership set
 * @returns the governed arm, `{x, z}`, or `null`
 */
function governingArm(streetCell, streetKeys) {
  if (!bordersTown(streetCell, streetKeys)) return null
  const arms = NSEW.filter((d) => streetKeys.has(`${streetCell.x + d.x},${streetCell.z + d.z}`))
  if (arms.length < 3) return null
  const h = streetCell.x * 31 + streetCell.z * 17 // cellHash, duplicated from road-mesh.js
  return arms[mod(h, arms.length)]
}

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
 * **Corners, at a governed junction arm.** This revision's closer `SET_BACK` (see
 * `BUILDING_CLEARANCE`'s own doc comment) opens a third collision, this time not with another
 * building at all: the street cell `S` this row fronts can itself be a furnished three- or
 * four-arm junction (R7, `road-mesh.js`), and R7 puts exactly one traffic light on `S` — on
 * whichever of *its own* arms `governingArm` picks. When that arm is perpendicular to this
 * row (`rotCCW(d)` or `rotCW(d)`, the same two directions the within-cell case above checks),
 * the light stands at a *fixed* lateral offset from this row's own centre-line (`KERB`, off
 * `S`'s own centre, which shares this row's own lateral axis exactly — see
 * `JUNCTION_LIGHT_SKIP_INDEX`'s own doc comment for the arithmetic), landing inside slot
 * `JUNCTION_LIGHT_SKIP_INDEX` regardless of `SET_BACK`. Unlike the within-cell and
 * across-two-cells cases above, this is not symmetric — `S` places one light regardless of
 * what this cell does, so only this row's own matching slot has to give way, not two rows at
 * once — and it is not a `faces`/`isBlock` question either: `S` is already a street cell (the
 * one this row fronts), never a diagonal block, so neither existing check ever sees it. Found
 * by sweeping every built cell against the real `vergeFurniture` output for the real street
 * set (`test/town-plan.test.mjs`): five real collisions in this exact network, every one at
 * exactly this slot.
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
    // The street cell `S` this row fronts can carry its own traffic light, on one of its own
    // arms — see the "Corners, at a governed junction arm" doc comment above. Only relevant
    // when that governed arm is perpendicular to this row: an arm running along `d` itself (or
    // its opposite) puts the light out ahead of or behind the row, never to either side of it.
    const litArm = governingArm(street, streetKeys)
    const lightSkipFirst = JUNCTION_LIGHT_SKIP_INDEX >= 0 && !!litArm && sameDir(litArm, rotCCW(d))
    const lightSkipLast = JUNCTION_LIGHT_SKIP_INDEX >= 0 && !!litArm && sameDir(litArm, rotCW(d))
    SLOT_OFFSETS.forEach((offset, i) => {
      if ((i < CORNER_SKIP_COUNT && skipFirst) || (i > last - CORNER_SKIP_COUNT && skipLast)) return
      if ((i === JUNCTION_LIGHT_SKIP_INDEX && lightSkipFirst) || (i === last - JUNCTION_LIGHT_SKIP_INDEX && lightSkipLast))
        return
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
