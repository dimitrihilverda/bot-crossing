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
