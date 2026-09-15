/**
 * The colony's lattice: a square grid at a pitch the art packs are built for.
 *
 * Every building, road piece and `base` slab in `city.glb` is exactly 2 x 2 in plan and every
 * corner piece turns 90 degrees, so the kit is made for a square grid. The colony used to be
 * hexagonal, which is why `road-mesh.js` had to drop a four-armed junction tile at every bend
 * and say plainly that the markings did not line up. On this lattice they do.
 *
 * Pure arithmetic, no three.js, so it can be tested under `node --test` — the same discipline
 * `drive-path.js`, `growth.js` and `streets.js` already follow.
 *
 * **Two metrics, deliberately.** A hex lattice needed only one because its ring and its step
 * count coincide; a square lattice does not.
 *
 *  - `ring` is **Chebyshev**, because a ring is an *outline* and a square colony should grow
 *    as a square. A Manhattan ring is a diamond, and the colony would grow as a rotated
 *    lozenge.
 *  - `distance` is **Manhattan**, because a distance is a *step count* and with four
 *    neighbours it takes |dx| + |dz| moves to cross. It is what connectivity, drift and the
 *    reach of the allocation pool are measured in.
 *
 * Using one metric for both would either grow diamonds or miscount distances.
 */

/**
 * The pitch of one plot cell, in world units.
 *
 * A house (`building_*` at `HOUSE_SCALE = 1.45`, see `houses.js`) is 2.9 units across. The
 * pitch has to be a multiple of 2 — the art packs' module — and should be a multiple of 6,
 * the town's road period, so a plot edge lands on a street instead of halfway along a block.
 * Two values satisfy both:
 *
 *  - **12**, arranging `SLOTS_PER_CELL = 9` slots in a 3 x 3 grid at 4.0 spacing, which leaves
 *    1.1 of clearance around a house.
 *  - 18, arranging 16 slots in a 4 x 4 grid at 4.5 spacing — 1.6 of clearance, matching the
 *    old hex lattice's 1.47 more closely — but it makes cells large and rare: with
 *    `cellsNeeded(threads) = ceil(threads / SLOTS_PER_CELL)`, a 40-thread repo claims 5 cells
 *    at 9 slots against 3 at 16, so growth is much lumpier.
 *
 * Chosen: **12**. 1.1 of clearance is tighter than the hex lattice's 1.47 but still a real gap
 * between houses, and the finer-grained growth curve reads better as the colony fills in one
 * thread at a time. `plots.js` builds the 3 x 3 slot arrangement to match.
 */
export const CELL_SIZE = 12

/**
 * The four neighbours that share an edge — not the eight that include corners.
 *
 * With eight, two plots touching only at a corner would count as connected, which reads on
 * screen as two colonies. `isConnected` in `plots.js` exists to catch exactly that.
 */
export const DIRS = Object.freeze([
  [1, 0],
  [0, 1],
  [-1, 0],
  [0, -1],
])

export const key = (x, z) => `${x},${z}`

export const neighbours = (cell) => DIRS.map(([dx, dz]) => ({ x: cell.x + dx, z: cell.z + dz }))

/** Manhattan distance: the number of four-neighbour steps between two cells. */
export const distance = (a, b) => Math.abs(a.x - b.x) + Math.abs(a.z - b.z)

/** The square outline of cells at Chebyshev distance `radius`. `8 * radius` cells, or one at 0. */
export function ring(radius) {
  if (radius <= 0) return [{ x: 0, z: 0 }]
  const out = []
  for (let x = -radius; x <= radius; x++) {
    out.push({ x, z: -radius })
    out.push({ x, z: radius })
  }
  for (let z = -radius + 1; z <= radius - 1; z++) {
    out.push({ x: -radius, z })
    out.push({ x: radius, z })
  }
  return out
}

/** A cell's centre, in world coordinates. */
export const cellWorld = (x, z) => ({ x: x * CELL_SIZE, z: z * CELL_SIZE })

/**
 * The cell containing a world point.
 *
 * A floor, not a nearest-centre search: on a square lattice the containing cell is decided by
 * one division per axis, where the hex version had to round in cube coordinates and repair the
 * axis that drifted furthest.
 */
export const worldToCell = (wx, wz) => ({
  x: Math.round(wx / CELL_SIZE),
  z: Math.round(wz / CELL_SIZE),
})

/**
 * Every cell from (x0, z0) to (x1, z1) inclusive, each adjacent to the one before it.
 *
 * Four-neighbour Bresenham: the diagonal step a classic Bresenham takes is split into two,
 * because a diagonal is not an adjacency here. That is what makes the path's length equal the
 * Manhattan distance, which the test asserts.
 */
export function line(x0, z0, x1, z1) {
  const out = [{ x: x0, z: z0 }]
  let x = x0
  let z = z0
  const sx = Math.sign(x1 - x0)
  const sz = Math.sign(z1 - z0)
  let dx = Math.abs(x1 - x0)
  let dz = Math.abs(z1 - z0)
  let err = dx - dz
  while (x !== x1 || z !== z1) {
    // One axis per step, never both: a diagonal move would break adjacency. The `x !== x1`
    // guard is what stops the error term walking x past its target once the x moves are
    // spent -- without it a line with far more z than x can overshoot and never terminate.
    if (x !== x1 && (err > 0 || z === z1)) {
      x += sx
      err -= dz
    } else {
      z += sz
      err += dx
    }
    out.push({ x, z })
  }
  return out
}
