/**
 * The route a delivery takes, as pure arithmetic over plain numbers — plus the one rule
 * about who is aboard, which is not arithmetic but is here for the same reason.
 *
 * Kept free of three.js and of colony state on purpose: this is the only part of the
 * delivery that can be tested under `node --test`, and it is the part where an off-by-one
 * would show up as a car cutting a corner through a house rather than as an error.
 * `ridesAlong` sits here on that ground alone: `colony.js` cannot be imported outside a
 * browser, and a rule whose failure mode is an invisible, unclickable crew member is one
 * that has to be asserted rather than eyeballed.
 *
 * The cell-by-cell line itself now lives in `grid.js`'s `line`: a four-neighbour Bresenham
 * walk that needs no rounding or repair, because a square lattice's cells line up with the
 * axes it is interpolated on — the cube-coordinate rounding this module used to do for a hex
 * lattice has no equivalent here. What is left is everything downstream of that line: turning
 * a polyline into a length and a position (`pathLength`, `pointAt`), backing a car off the
 * house it is delivering to and onto the kerb (`kerbBack`), stepping it along its route one
 * frame at a time (`driveStep`), and deciding when its crew member rides along instead of
 * walking (`ridesAlong`).
 */

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

/**
 * Air between the kerb and the wall of the house, on top of the building's own radius.
 *
 * Half a unit is roughly a car's width, so the body reads as parked beside the house rather
 * than pressed against it.
 */
export const KERB_CLEARANCE = 0.5

/**
 * The thinnest clearance the kerb will ever settle for.
 *
 * Only reached when the final leg is too short to give the car its proper berth. It is a
 * floor rather than a target: what it guarantees is that the car is still *outside* the
 * building, which is all the parked car has to be in order to do its job.
 */
export const KERB_MIN_CLEARANCE = 0.1

/**
 * How far back along the final leg of a route the car should stop, given the length of that
 * leg and the radius of the house at the end of it.
 *
 * Two constraints, and on a short leg they disagree:
 *
 *  - **Clear the footprint.** A car driven to the house's own centre parks *inside* the
 *    building and cannot be seen at all, which defeats the entire point — the parked car is
 *    what replaced the scaffolding.
 *  - **Stay on the leg.** Back off further than the leg is long and the kerb lands behind
 *    the cell the car approaches from, so the car drives past its stop and reverses into it.
 *
 * Where they disagree, clearance wins. A car parked a little early looks odd; a car parked
 * inside its house is invisible, and invisible is the failure mode this whole route shaping
 * exists to avoid. So the leg guard is applied first and then *floored* at the footprint —
 * the clamp is two-sided.
 *
 * The earlier form was `Math.min(leg * 0.9, footprint + KERB_CLEARANCE)`: one-sided, so a
 * leg shorter than about `(footprint + 0.5) / 0.9` silently re-parked the car inside the
 * footprint. It does not fire at the shipping `CELL` of 7.6 — adjacent cell centres are far
 * enough apart that the leg guard never binds — which is exactly why the rule belongs in a
 * tested function instead of in a comment about the layout that happens to ship today.
 *
 * @param legLength length of the last segment, from the approach cell centre to the house
 * @param footprint the house's own radius
 * @returns how far back from the house to park, along that segment. 0 for a degenerate leg,
 *   where there is no direction to back off in and the caller must leave the point alone.
 */
export function kerbBack(legLength, footprint, clearance = KERB_CLEARANCE) {
  if (!(legLength > 1e-6)) return 0
  const want = footprint + clearance
  // Prefer to stay strictly between the approach cell centre and the house...
  const onLeg = Math.min(legLength * 0.9, want)
  // ...but never at the price of parking inside the building.
  return Math.max(onLeg, footprint + KERB_MIN_CLEARANCE)
}

/**
 * One frame of a car's progress along its route: `driven` moved toward `target` by `step`,
 * and never past it.
 *
 * Arriving and leaving are the same one number running in opposite directions, which is why
 * there is no "parked" flag and no direction to store — the target is the whole state. The
 * clamp at both ends is what makes that work: a car that has arrived sits at exactly
 * `route.length` rather than creeping past it, and one that has gone home sits at exactly 0
 * rather than reversing off the start of its own route.
 *
 * @returns the next `driven`. Exactly equal to `target` on the frame it lands.
 */
export function driveStep(driven, target, step) {
  if (!(step > 0)) return driven
  if (driven < target) return Math.min(target, driven + step)
  if (driven > target) return Math.max(target, driven - step)
  return driven
}

/**
 * The one crew-member state that means it is actually travelling with its car.
 *
 * `astronauts.js` runs five states — `spawning`, `walking`, `at-site`, `leaving` and `gone`.
 * `walking` is the only one where the figure is on its way from somewhere to somewhere else
 * under its own steam, which is the only case where "it is in the car instead" is a true
 * account of where it went. `spawning` is a figure rising out of the depot and `leaving` is
 * one walking back into it: both are travelling too, but both also carry their own badge
 * (`_statusBadgeFor` in colony.js), so `badged` refuses them anyway.
 */
export const RIDING_STATE = 'walking'

/**
 * Whether a crew member may be hidden this frame because it is riding in its car.
 *
 * Two rules, and the delivery has to satisfy both. The caller has already established that
 * the car itself is between the ends of its route; this is everything else.
 *
 *  - **Only a crew member that is actually travelling.** `riding` is a draw-time skip: hide
 *    the figure and the badge goes with it (`_badgeFor`) and so does the click target
 *    (`astronauts.pick`). That is an honest trade for a figure whose journey the car is
 *    standing in for, and a bad one for a figure that is not going anywhere. `_isActive` is
 *    `running || unread || hasError`, so the most ordinary event in the whole application —
 *    a thread stopping — sends a car home from a plot whose crew member is standing still on
 *    it at `at-site`. Suppressing that one blanks a crew member for the three to eight
 *    seconds of a drive it is not on, and then puts it back exactly where it never left.
 *  - **Never a crew member whose status carries a badge.** The badge is the one thing the
 *    whole application exists to make findable, so the figure that carries one is drawn
 *    wherever its car happens to be. This is the stricter of the two and it is deliberately
 *    kept as its own test rather than folded into the first: today every walking crew member
 *    has `BADGE.none` (badges wait until a figure reaches its post), so the check cannot
 *    fire — but the day badges start appearing over a walking figure, the rule that must not
 *    quietly lapse is this one.
 *
 * The cost of the pair is a car that sometimes drives with nobody visibly aboard, which is
 * what the spec already licenses: it reads as a delivery car running its own errand.
 *
 * @param state the crew member's own state, from the `astronauts.js` state machine
 * @param badged whether its status carries a badge, ignoring whether it is drawn right now
 */
export function ridesAlong(state, badged) {
  if (state !== RIDING_STATE) return false
  return !badged
}
