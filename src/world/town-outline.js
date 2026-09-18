import { mulberry } from './rng.js'
import { TOWN_CELL_RADIUS } from './street-plan.js'

/**
 * The town's outer edge, as a pure function of cell position.
 *
 * Pulled out of `town-plan.js` in the flush revision: `road-mesh.js` needs `inTown` to decide
 * which street cells border the town (R11), and `town-plan.js` needs to call into `road-mesh.js`
 * for verge furniture positions (see `road-mesh.js`'s own `cellFurniture`) — two modules that
 * each need something from the other. Importing either way would make the pair a load-order-
 * dependent cycle, so the one piece both actually need — the town's outline — lives here
 * instead, in a module neither `road-mesh.js` nor `town-plan.js` has any reason to import from
 * the other to reach. `town-plan.js` still re-exports `inTown` and `townRadiusAt` from here, so
 * every existing import site (`town-mesh.js`, the test files) keeps working unchanged.
 */

export const TOWN_SEED = 77313

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
