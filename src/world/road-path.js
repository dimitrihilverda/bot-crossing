import { distance, key, line, neighbours } from './grid.js'

/**
 * Composing a route that follows the streets — pure arithmetic, no three.js and no colony
 * state, for the same reason `drive-path.js` is: this is the part where an off-by-one shows
 * up as a car driving through a house rather than as an error.
 *
 * The search is a uniform-cost walk over the lattice where a street cell costs one step and
 * anything else costs `OFF_ROAD_COST`. That single number is the whole of the routing
 * policy: high enough that a route will take a long way round rather than cut across three
 * gardens, low enough that a plot with no road still gets driven to.
 *
 * Where the streets don't reach a plot at all, the search still returns a shortest lattice
 * path — the same length as `line(from, to)`, since both are shortest paths on the same
 * uniform-cost lattice — but not necessarily the same one of the several equally short paths,
 * so the car's route can differ in shape from what it drove before this stage. The two are
 * guaranteed identical only when the street set passed in is genuinely empty, which the fast
 * path below returns directly without searching. That is a real window, not a hypothetical:
 * `this.streets` is `undefined` until `planStreets` has run once, and every route built before
 * then takes this path; after that, `this.streets.all` is essentially never empty again, so
 * later routes normally go through the search instead. Either way "roads steer everything"
 * still holds: roads steer wherever roads exist, and a plot no road reaches is still driven to.
 */

/**
 * What one cell of driving off the road costs, in units of one cell of driving on it.
 *
 * Six was picked so that crossing a single cell of open ground is worse than going five
 * cells round on tarmac but better than going seven. Anything below about three and the
 * router shortcuts across gardens whenever the road bends; anything above about twenty and
 * a route to a plot with a short spur takes a comical tour of the ring first.
 */
export const OFF_ROAD_COST = 6

/**
 * How far the search may stray from the straight line between the endpoints, in cells.
 *
 * Re-checked against the square lattice's Manhattan `distance` rather than assumed to carry
 * over from the hex lattice's Chebyshev-like metric it was tuned against: measured by running
 * `roadCells` over every depot-to-plot and a sampled plot-to-plot pair on generated colonies
 * from 5 up to 288 plots (ring sizes up to 72 cells), the search never needed more than a
 * margin of 0 to reach the goal without falling back to `line`. That is not a fluke of the
 * cases tried — it follows from the shape of the search: the set of cells within `budget` of
 * `to` is a Manhattan ball, which is connected under four-neighbour adjacency and always
 * contains `from` once `budget >= distance(from, to)`, i.e. whenever the margin is at least
 * 0. Pushing the margin to -1 still passed every case above (0/169 fell back on a 60-plot
 * colony); only at -2 did it fail everywhere, exactly where `budget` first goes negative for
 * adjacent cells. So the margin was never load-bearing for reachability, on either lattice —
 * it is kept positive only as working room for the search to actually find the street cells a
 * good route should prefer, not because the goal would otherwise go unreached. 8 is unchanged
 * from the hex lattice's value; nothing in this stage's measurements calls for a different one.
 */
const DETOUR_MARGIN = 8

/**
 * Every cell from `from` to `to` inclusive, each adjacent to the one before it, preferring
 * street cells.
 *
 * **`strict` turns that preference into a requirement**, and the difference is visible from
 * across the colony. `OFF_ROAD_COST` makes tarmac six times dearer to leave than to follow, so
 * a shortcut across one cell of grass beats a detour of seven cells on the road — measured on
 * the shipping street plan, half of all ambient routes (20 of 40) cut a corner across the verge
 * that way. For a delivery that behaviour is the point: it has to leave the road to reach a
 * house, and `kerbBack` exists to end that last leg tidily. For through traffic it is simply a
 * car driving over somebody's lawn.
 *
 * In `strict` mode nothing but a street cell is ever entered, the destination included, and
 * there is no straight-line fallback: where no street-only route exists the answer is `null`,
 * so a caller can leave the car where it is rather than send it across a field. A route from a
 * cell to itself is still a route.
 *
 * @param from origin cell
 * @param to destination cell
 * @param streets the street cell keys, as `planStreets(...).all` returns them
 * @param options.strict refuse to leave the street network; `null` when that is impossible
 */
export function roadCells(from, to, streets, { strict = false } = {}) {
  if (from.x === to.x && from.z === to.z) return [{ x: from.x, z: from.z }]
  if (!streets || streets.size === 0) return strict ? null : line(from.x, from.z, to.x, to.z)

  const budget = distance(from, to) + DETOUR_MARGIN
  const startKey = key(from.x, from.z)
  const goalKey = key(to.x, to.z)
  // In strict mode the destination has to be on the network too — otherwise the walk below
  // would be searching for somewhere it is not allowed to arrive.
  if (strict && !streets.has(goalKey)) return null

  // Dijkstra with a sorted frontier. The lattice reachable inside `budget` is small — a few
  // hundred cells at the colony sizes this runs at — so a plain array beats a heap in both
  // code and constant factor, and `_routeFor` caches the result per house anyway.
  const cost = new Map([[startKey, 0]])
  const cameFrom = new Map()
  const frontier = [{ cell: from, cost: 0 }]

  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost)
    const { cell, cost: spent } = frontier.shift()
    const here = key(cell.x, cell.z)
    if (here === goalKey) break
    if (spent > (cost.get(here) ?? Infinity)) continue

    for (const next of neighbours(cell)) {
      // `budget` prunes the search to a Manhattan ball around the goal, which is sound when
      // every cell is enterable and the route is near-straight. In strict mode it is neither:
      // the whole point is going the long way round, and a route that has to loop out and back
      // genuinely leaves that ball — seed 28 of the shipping plan's own traffic was reported
      // unreachable for exactly that reason, on a network it is plainly connected across. The
      // prune is not needed there either: only street cells are enterable, so the search is
      // already bounded by the network itself (150 cells on this plan).
      if (!strict && distance(next, to) > budget) continue
      const k = key(next.x, next.z)
      // In strict mode a non-street cell is not dear, it is closed — the goal is checked
      // against the network above, so it is on it too. That is what makes the walk unable to
      // find a shortcut across the verge rather than merely disinclined to take one.
      if (strict && !streets.has(k)) continue
      // The destination is always enterable whatever it is standing on, and the origin is
      // where we started; everything else pays road or off-road.
      const stepCost = k === goalKey || streets.has(k) ? 1 : OFF_ROAD_COST
      const total = spent + stepCost
      if (total >= (cost.get(k) ?? Infinity)) continue
      cost.set(k, total)
      cameFrom.set(k, cell)
      frontier.push({ cell: next, cost: total })
    }
  }

  // Neither of the two `line` returns below — this one and the one inside the walk-back
  // loop — can fire under the current bound. `budget` always contains both `from` and `to`
  // (it's their distance apart plus a fixed positive margin), and every edge costs 1 or
  // `OFF_ROAD_COST`, never infinite or blocked, so the searched region is always a connected
  // disk containing both endpoints and Dijkstra always reaches the goal. This is not the "no
  // road connection" fallback — that one is the empty-street fast path above, which is the
  // only fallback the test suite and fuzzing against this function have ever observed to fire.
  // These two lines are kept anyway as a guard: if `DETOUR_MARGIN` or `OFF_ROAD_COST` is ever
  // retuned in a way that breaks the guarantee above, the alternative is an empty or partial
  // route — a car that never moves and a house that never disappears — and that is worse than
  // carrying two lines of currently-unreachable code.
  // In strict mode there is no straight-line fallback: a closed network really can have no
  // route, and saying so is the whole point (see the doc comment).
  if (!cameFrom.has(goalKey)) return strict ? null : line(from.x, from.z, to.x, to.z)

  const out = [{ x: to.x, z: to.z }]
  let cursor = to
  while (key(cursor.x, cursor.z) !== startKey) {
    cursor = cameFrom.get(key(cursor.x, cursor.z))
    if (!cursor) return strict ? null : line(from.x, from.z, to.x, to.z) // same guard, same reasoning
    out.push({ x: cursor.x, z: cursor.z })
  }
  out.reverse()
  return out
}
