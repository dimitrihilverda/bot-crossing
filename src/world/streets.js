import { key } from './grid.js'
import { planStreetCells, STREET_SEED, TOWN_CELL_RADIUS } from './street-plan.js'

/**
 * The colony's street network.
 *
 * A thin adapter over `street-plan.js`, kept as its own module because `colony.js` and
 * `road-mesh.js` both want the membership set and neither should care how it was picked.
 *
 * There used to be a ring one cell outside the outermost plot, with a spur from each plot to
 * it. Stage 7 removed it, and the reason is worth keeping: the ring circled the colony while
 * every delivery ran from the depot in the middle to a house in the middle, so a route never
 * had any reason to leave the plots. Measured before the change: every route was three cells
 * long and touched zero street cells. Streets have to run *between* the blocks, not around
 * them, or the router is right to ignore them — see `road-path.js`'s `OFF_ROAD_COST`.
 *
 * @param options.seed the street pattern's seed
 * @param options.radius how far the network reaches, in cells
 * @returns `{ all, cells }` — `all` is the membership set of `"x,z"` keys, `cells` the same
 *   cells as `{x, z}` in a stable order.
 */
export function planStreets({ seed = STREET_SEED, radius = TOWN_CELL_RADIUS } = {}) {
  const cells = planStreetCells(seed, radius)
  return { all: new Set(cells.map((c) => key(c.x, c.z))), cells }
}

/** The four cells a cell touches, in a fixed order so the answer never depends on iteration. */
const APPROACHES = Object.freeze([
  { x: 1, z: 0 },
  { x: -1, z: 0 },
  { x: 0, z: 1 },
  { x: 0, z: -1 },
])

/**
 * Which way the depot faces the road: a unit direction toward a street cell beside it.
 *
 * No street may run through the depot's own cell — it is a `PROTECTED_CELL`, because a
 * carriageway there would be tarmac under a building — so the closest the depot can get to the
 * road is to lean toward it across its own cell and let an apron cover the rest. This decides
 * which way it leans, and which neighbour lays that apron.
 *
 * East first, then west, south, north: a fixed order rather than whichever the set happens to
 * yield, so the depot does not turn to face a different street because the plan was built in a
 * different order.
 *
 * @returns a unit direction, or `null` when no street touches the cell at all — in which case
 *   the depot stays where it is rather than leaning at a guess.
 */
export function depotApproach(cell, streets) {
  for (const d of APPROACHES) {
    if (streets.has(key(cell.x + d.x, cell.z + d.z))) return d
  }
  return null
}
