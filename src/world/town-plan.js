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
 * What a kit building is scaled by. A part is 2 units across; 3.5 makes it 7 wide and
 * 5.8-10.7 tall, which reads as a house beside a 12-unit street cell. At the road tiles'
 * own scale (1.2) it would be a shed.
 */
export const BUILDING_SCALE = 3.5

/** How much of the block frontage is left as green rather than built. */
export const GREEN_SHARE = 0.32

/** How far a building's centre sits from its cell's centre, toward the street it faces.
 *  A kit building is 2 units across, so `BUILDING_SCALE * 2` is its world width. */
const SET_BACK = CELL_SIZE / 2 - (BUILDING_SCALE * 2) / 2 - 0.6

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
  for (const h of OUTLINE) f -= h.amp * (1 - Math.sin(h.n * angle + h.phase))
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

/**
 * What fills one block cell.
 *
 * Buildings go on the sides that face a street and nowhere else — a house fronts a road, and
 * a building in the middle of a block would be reachable by nothing. That also keeps the
 * geometry budget in reach: a cell has at most four street-facing sides and usually one or
 * two.
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
  for (const d of SIDES) {
    if (!streetKeys.has(`${cell.x + d.x},${cell.z + d.z}`)) continue
    // A gap in the frontage here and there, so a street is not an unbroken terrace.
    if (rand() < 0.2) continue
    buildings.push({
      part: BUILDING_PARTS[Math.floor(rand() * BUILDING_PARTS.length)],
      x: cx + d.x * SET_BACK,
      z: cz + d.z * SET_BACK,
      // Measured (Task 5 Step 1, on all eight parts building_A..H): one atlas cell — the
      // door/window band — sits only on the model's local +Z face, spanning most of its
      // width, never mirrored to -Z and never pinned to an X face. So a kit building does
      // have a front, and it faces local +Z. `atan2(d.x, d.z)` is the rotation that turns
      // that local +Z to point along `d`, the direction from this cell toward the street
      // cell it fronts — so the door ends up facing the street, not the block's interior.
      ry: Math.atan2(d.x, d.z),
      scale: BUILDING_SCALE,
    })
  }
  return { kind: 'built', buildings }
}
