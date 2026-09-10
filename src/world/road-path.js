import { HEX_DIRS, key } from './plots.js'
import { hexLine } from './drive-path.js'

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
 * The fallback is documented behaviour, not a defect. "Roads steer everything" means roads
 * steer wherever roads exist; where they do not, the car drives over the deck exactly as it
 * did for every plot before this stage, which is behaviour that was verified by hand over
 * 600 frames and is deliberately left reachable.
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

function neighbours(cell) {
  return HEX_DIRS.map(([dq, dr]) => ({ q: cell.q + dq, r: cell.r + dr }))
}

/**
 * How far the search may stray from the straight line between the endpoints.
 *
 * Without a bound this walks the infinite lattice. The straight-line distance plus this
 * margin is always enough to reach the ring and come back, because the ring is at most one
 * cell beyond the furthest plot.
 */
const DETOUR_MARGIN = 8

function cubeDistance(a, b) {
  const as = -a.q - a.r
  const bs = -b.q - b.r
  return Math.max(Math.abs(a.q - b.q), Math.abs(a.r - b.r), Math.abs(as - bs))
}

/**
 * Every cell from `from` to `to` inclusive, each adjacent to the one before it, preferring
 * street cells.
 *
 * @param from origin cell
 * @param to destination cell
 * @param streets the street cell keys, as `planStreets(...).all` returns them
 */
export function roadCells(from, to, streets) {
  if (from.q === to.q && from.r === to.r) return [{ q: from.q, r: from.r }]
  if (!streets || streets.size === 0) return hexLine(from.q, from.r, to.q, to.r)

  const budget = cubeDistance(from, to) + DETOUR_MARGIN
  const startKey = key(from.q, from.r)
  const goalKey = key(to.q, to.r)

  // Dijkstra with a sorted frontier. The lattice reachable inside `budget` is small — a few
  // hundred cells at the colony sizes this runs at — so a plain array beats a heap in both
  // code and constant factor, and `_routeFor` caches the result per house anyway.
  const cost = new Map([[startKey, 0]])
  const cameFrom = new Map()
  const frontier = [{ cell: from, cost: 0 }]

  while (frontier.length) {
    frontier.sort((a, b) => a.cost - b.cost)
    const { cell, cost: spent } = frontier.shift()
    const here = key(cell.q, cell.r)
    if (here === goalKey) break
    if (spent > (cost.get(here) ?? Infinity)) continue

    for (const next of neighbours(cell)) {
      if (cubeDistance(next, to) > budget) continue
      const k = key(next.q, next.r)
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

  if (!cameFrom.has(goalKey)) return hexLine(from.q, from.r, to.q, to.r)

  const out = [{ q: to.q, r: to.r }]
  let cursor = to
  while (key(cursor.q, cursor.r) !== startKey) {
    cursor = cameFrom.get(key(cursor.q, cursor.r))
    if (!cursor) return hexLine(from.q, from.r, to.q, to.r)
    out.push({ q: cursor.q, r: cursor.r })
  }
  out.reverse()
  return out
}
