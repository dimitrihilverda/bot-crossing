/**
 * The route a delivery takes, as pure arithmetic over plain numbers.
 *
 * Kept free of three.js and of colony state on purpose: this is the only part of the
 * delivery that can be tested under `node --test`, and it is the part where an off-by-one
 * would show up as a car cutting a corner through a house rather than as an error.
 *
 * Hex lines are drawn in cube coordinates. Axial (q, r) cannot be interpolated directly —
 * rounding a fractional axial coordinate can land two cells away from its neighbour — so
 * each sample converts to cube, rounds with the largest-error-component fix-up, and comes
 * back. That fix-up is what guarantees consecutive cells are adjacent, which the test
 * asserts step by step.
 */

/** Axial → cube. The third axis is implied: q + r + s = 0. */
function toCube(q, r) {
  return { x: q, y: r, z: -q - r }
}

/**
 * Round a fractional cube coordinate to the nearest whole cell, then repair the axis that
 * moved furthest so the three still sum to zero. Without the repair, rounding can produce a
 * cell that is not adjacent to its predecessor.
 */
function roundCube(x, y, z) {
  let rx = Math.round(x)
  let ry = Math.round(y)
  let rz = Math.round(z)
  const dx = Math.abs(rx - x)
  const dy = Math.abs(ry - y)
  const dz = Math.abs(rz - z)
  if (dx > dy && dx > dz) rx = -ry - rz
  else if (dy > dz) ry = -rx - rz
  else rz = -rx - ry
  return { q: rx, r: ry }
}

/** Cube distance, which is the number of steps between two cells. */
function cubeDistance(a, b) {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y), Math.abs(a.z - b.z))
}

/**
 * Every cell from (q0, r0) to (q1, r1) inclusive, each adjacent to the one before it.
 *
 * The nudge is the standard fix for a line that passes exactly through a cell corner: an
 * unnudged sample sits equidistant from two cells and the rounding picks arbitrarily,
 * which can break adjacency.
 */
export function hexLine(q0, r0, q1, r1) {
  const a = toCube(q0, r0)
  const b = toCube(q1, r1)
  const steps = cubeDistance(a, b)
  if (steps === 0) return [{ q: q0, r: r0 }]

  const out = []
  const nudge = 1e-6
  for (let i = 0; i <= steps; i++) {
    const t = i / steps
    out.push(
      roundCube(
        a.x + (b.x - a.x) * t + nudge,
        a.y + (b.y - a.y) * t + nudge,
        a.z + (b.z - a.z) * t - 2 * nudge
      )
    )
  }
  return out
}

/** Total 2D length of a polyline of `{x, z}` points. */
export function pathLength(points) {
  let total = 0
  for (let i = 1; i < points.length; i++) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].z - points[i - 1].z)
  }
  return total
}

/**
 * Where a vehicle is after travelling `distance` along the polyline, and which way it faces.
 *
 * Clamps rather than extrapolating: a car that has arrived sits at the kerb instead of
 * carrying on into the terrain, and a negative distance is the start rather than a reverse.
 */
export function pointAt(points, distance) {
  if (!points.length) return { x: 0, z: 0, heading: 0 }

  const first = points[0]
  // A route of one point is a standstill: nowhere to go and no direction to face.
  if (points.length === 1) return { x: first.x, z: first.z, heading: 0 }

  // Not yet moving: sit at the start already facing down the first segment, so a car does
  // not pivot on the spot the instant it pulls away.
  if (distance <= 0) {
    const next = points[1]
    return { x: first.x, z: first.z, heading: Math.atan2(next.z - first.z, next.x - first.x) }
  }

  let travelled = 0
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]
    const b = points[i]
    const seg = Math.hypot(b.x - a.x, b.z - a.z)
    if (seg === 0) continue
    if (travelled + seg >= distance) {
      const t = (distance - travelled) / seg
      return {
        x: a.x + (b.x - a.x) * t,
        z: a.z + (b.z - a.z) * t,
        heading: Math.atan2(b.z - a.z, b.x - a.x),
      }
    }
    travelled += seg
  }

  // Past the end: sit at the last point, still facing the way the last segment ran.
  const last = points[points.length - 1]
  const prev = points[points.length - 2]
  return { x: last.x, z: last.z, heading: Math.atan2(last.z - prev.z, last.x - prev.x) }
}
