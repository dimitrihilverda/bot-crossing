import { key, line, neighbours } from './grid.js'
import { mulberry } from './rng.js'

/**
 * Which cells of the lattice are streets.
 *
 * Streets are a function of position and seed **only**. Nothing about the colony — which
 * repos exist, how many plots there are, where they sit — reaches this module, which is what
 * stops the town rearranging itself on every poll. The colony is allocated into whatever this
 * leaves: `allocateCells` already refuses street cells.
 *
 * The pattern is a recursive binary slice. A rectangle is cut by a street running its full
 * width, and each half is sliced again until it is small enough to be a block. That gives the
 * three things the design asks for and a chessboard cannot: block sizes that vary (the cut
 * position is seeded, not fixed), T-junctions rather than a crossroads at every meeting (a
 * child's cut ends on its parent's), and streets that jog.
 *
 * A **block is whatever the streets leave** — a maximal run of adjacent non-street cells —
 * not one of these rectangles. The rectangles are scaffolding for the generator; a jog or a
 * dead end deliberately leaves cells belonging to no rectangle, and those merge into the
 * neighbouring block exactly as they should.
 */

/** How far the street network reaches, in cells. At `CELL_SIZE` 12 this is 96 units. */
export const TOWN_CELL_RADIUS = 8

/** The seed. Changing it redraws every street in the world. */
export const STREET_SEED = 20260916

/**
 * How small and how large a generator rectangle may be before it stops being cut, in cells.
 *
 * `MAX_BLOCK` was 3, which let a rectangle run three cells uncut — 36 units, or fifteen
 * building-widths (the kit's own module is 2.4, `BUILDING_SCALE` in `town-plan.js`) between
 * streets. That is what read, in the owner's overhead screenshot, as an enormous empty
 * expanse with a single row of houses lost in the middle of it: the lattice cell (`CELL_SIZE`
 * 12) is already five building-widths across, so three of them stacked is far wider than any
 * real block in the KayKit reference. Lowered to 2 (measured, see
 * `test/route-on-street.test.mjs` and `test/streets.test.mjs`): streets sit closer together,
 * at the cost of more, smaller blocks — checked against `allocateCells`' own need for runs of
 * contiguous non-street cells, since a large repo's plot has nowhere to grow into a block
 * that no longer exists once its runs get too short.
 */
export const MIN_BLOCK = 1
export const MAX_BLOCK = 2

/**
 * How often a cut steps sideways partway along, and how often it stops short of one end.
 *
 * Raised from 0.45 to 0.75 in the playful revision. At 0.45 the guard below only ever tried the
 * one randomly-chosen sideways direction and only ever jogged once per cut, so — even though
 * the chance itself looked generous — nearly every roll landed on a direction `options`
 * rejected (the far side of the span, or a step that would cross a protected cell) and the cut
 * just ran straight. Measured on the real network at the old chance and the old
 * single-direction, single-jog logic: 6 bends out of 172 street cells. Trying both directions
 * and allowing a cut to jog more than once (see `slice` below) fixes the mechanism; this raise
 * is what then makes it fire often enough that a long street visibly wanders instead of
 * stepping once — measured on the real network at 0.75 with the new mechanism: 31 bends out of
 * 150 street cells (fewer street cells overall than before, not more: a cut that jogs several
 * times excludes a wider band of its rectangle from further slicing — see the children
 * rectangle computed from `legAts`' own min/max below — so a heavily-jogged network trades some
 * of the *extra* streets a straight grid would have cut into that space for the turns
 * themselves). Checked against everything that depends on street density: the median route
 * still tiles at least 0.6 on-street (`test/route-on-street.test.mjs`) and every one of the
 * 40-project spread still gets its cells (same test, and `test/streets.test.mjs`'s own growth
 * test); see `test/street-plan.test.mjs`'s bend-count test for the pinned before/after.
 */
export const JOG_CHANCE = 0.75
export const DEAD_END_CHANCE = 0.3

/**
 * Cells no street may cross. The origin is the colony's centre and `{-2, 0}` is the depot
 * (`SHIP_CELL` in `plots.js`) — a carriageway through either would put tarmac under a
 * building that is already there.
 */
export const PROTECTED_CELLS = Object.freeze([
  { x: 0, z: 0 },
  { x: -2, z: 0 },
])

/** Would a cut along `axis` at `at`, spanning `lo..hi` across, run over a protected cell? */
function crossesProtected(axis, at, lo, hi) {
  return PROTECTED_CELLS.some((p) =>
    axis === 'x' ? p.x === at && p.z >= lo && p.z <= hi : p.z === at && p.x >= lo && p.x <= hi
  )
}

function slice(rect, rand, add) {
  const w = rect.x1 - rect.x0 + 1
  const h = rect.z1 - rect.z0 + 1
  if (w <= MAX_BLOCK && h <= MAX_BLOCK) return

  // The longer side is cut, so blocks stay roughly square rather than degenerating into
  // strips. A square rectangle's tie is broken by the seed rather than always the same way:
  // always picking the same axis there is how a generator drifts into long parallel avenues.
  const cutX = w === h ? rand() < 0.5 : w > h
  const [lo, hi] = cutX ? [rect.x0, rect.x1] : [rect.z0, rect.z1]
  const [acrossLo, acrossHi] = cutX ? [rect.z0, rect.z1] : [rect.x0, rect.x1]
  const axis = cutX ? 'x' : 'z'

  const options = []
  for (let at = lo + MIN_BLOCK; at <= hi - MIN_BLOCK; at++) {
    if (!crossesProtected(axis, at, acrossLo, acrossHi)) options.push(at)
  }
  // Every legal position is blocked by a protected cell: this rectangle stays one block.
  if (!options.length) return
  const at = options[Math.floor(rand() * options.length)]

  const span = acrossHi - acrossLo + 1
  const put = (at_, across) => (cutX ? add(at_, across) : add(across, at_))

  // `legs` is the cut's own path across the span, as `{ at, across }` pairs — usually one
  // entry per across-index, but two at every jog point (see below). Kept separate from the
  // `put` calls themselves so the children rectangles can be measured from the same list that
  // was actually drawn, whichever branch below built it.
  const legs = []

  if (span >= 4 && rand() < JOG_CHANCE) {
    // A jogging cut: walk the whole span, trying a sideways step at every interior index
    // rather than once partway along — so a long street can wander several times, not just
    // bend once. Both sideways directions are tried before giving up on a step: a jog is
    // skipped only when neither `at + dir` nor `at - dir` is a legal position for the *whole*
    // span (the same conservative, whole-span check `options` already encodes for the base
    // cut) — trying only the randomly-chosen direction, as the previous revision did, rejected
    // a jog whenever chance alone picked the side that happened to be blocked, which is why
    // the old mechanism produced almost no bends despite its own chance looking generous.
    let cur = at
    for (let a = acrossLo; a <= acrossHi; a++) {
      legs.push({ at: cur, across: a })
      // No jog at the first or last index: a step there would leave one leg with nothing in
      // it. `a === acrossHi` is checked as a `continue` rather than folded into the loop
      // bound, because the current position still has to be recorded for that final index.
      if (a === acrossLo || a === acrossHi) continue
      if (rand() < JOG_CHANCE) {
        const dir = rand() < 0.5 ? -1 : 1
        let next = null
        if (options.includes(cur + dir)) next = cur + dir
        else if (options.includes(cur - dir)) next = cur - dir
        if (next !== null) {
          // The elbow: both the old and the new position are drawn at this same across-index,
          // exactly as the single-jog version drew both legs at `jogAt`. That shared index is
          // what keeps the cut one connected run rather than two cells diagonally adjacent
          // (and therefore, on this square lattice, not adjacent at all).
          legs.push({ at: next, across: a })
          cur = next
        }
      }
    }
  } else {
    // A dead end: the cut stops short of one end, leaving a street that goes nowhere. Only on
    // an unjogged cut — trimming a jogged one can remove a whole leg.
    let runLo = acrossLo
    let runHi = acrossHi
    if (span >= 5 && rand() < DEAD_END_CHANCE) {
      const trim = 1 + Math.floor(rand() * 2)
      if (rand() < 0.5) runLo += trim
      else runHi -= trim
    }
    for (let a = runLo; a <= runHi; a++) legs.push({ at, across: a })
  }

  for (const leg of legs) put(leg.at, leg.across)

  const legAts = legs.map((l) => l.at)
  const cLo = Math.min(...legAts)
  const cHi = Math.max(...legAts)
  const children = cutX
    ? [{ ...rect, x1: cLo - 1 }, { ...rect, x0: cHi + 1 }]
    : [{ ...rect, z1: cLo - 1 }, { ...rect, z0: cHi + 1 }]
  for (const child of children) {
    if (child.x1 >= child.x0 && child.z1 >= child.z0) slice(child, rand, add)
  }
}

/** Does the cell list `segment` pass through any `PROTECTED_CELLS` entry? */
function crossesProtectedCell(segment) {
  return segment.find((c) => PROTECTED_CELLS.some((p) => p.x === c.x && p.z === c.z))
}

/**
 * Join anything the slicing left stranded — without paving over a protected cell.
 *
 * Two cuts on the same axis in sibling rectangles run parallel and never meet, and a jog or a
 * dead end can break the join a child's cut would otherwise make on its parent's. Rather than
 * argue those cases cannot happen — that argument was wrong twice while this plan was being
 * written — this measures the components and connects them, and the test asserts the result.
 *
 * Deterministic: components are walked in the cells' sorted order, and among the candidate
 * pairs whose joining `line()` crosses no `PROTECTED_CELLS` entry, the pair chosen is the
 * first at the smallest Manhattan distance in that order — exactly the old selection rule,
 * just applied only to pairs that qualify. If every pair between the two largest components
 * would cross a protected cell, this throws instead of paving over one: a loud failure at
 * generation time beats a street silently landing on the depot or the origin.
 */
function connect(cells, seed) {
  const keys = new Set(cells.map((c) => key(c.x, c.z)))
  const all = [...cells]
  for (;;) {
    const seen = new Set()
    const components = []
    for (const start of all) {
      const sk = key(start.x, start.z)
      if (seen.has(sk)) continue
      const component = []
      const queue = [start]
      seen.add(sk)
      while (queue.length) {
        const c = queue.pop()
        component.push(c)
        for (const n of neighbours(c)) {
          const nk = key(n.x, n.z)
          if (keys.has(nk) && !seen.has(nk)) {
            seen.add(nk)
            queue.push(n)
          }
        }
      }
      components.push(component)
    }
    if (components.length <= 1) return all

    components.sort((a, b) => b.length - a.length)
    let best = null
    // The smallest-distance pair rejected for crossing a protected cell, kept only to name the
    // blocked cell in the error if no pair ever qualifies.
    let nearestBlocked = null
    for (const a of components[1]) {
      for (const b of components[0]) {
        const d = Math.abs(a.x - b.x) + Math.abs(a.z - b.z)
        if (best && d >= best.d) continue
        const segment = line(a.x, a.z, b.x, b.z)
        const blocker = crossesProtectedCell(segment)
        if (blocker) {
          if (!nearestBlocked || d < nearestBlocked.d) nearestBlocked = { d, cell: blocker }
          continue
        }
        best = { a, b, d }
      }
    }
    if (!best) {
      const at = nearestBlocked ? `{${nearestBlocked.cell.x}, ${nearestBlocked.cell.z}}` : 'a protected cell'
      throw new Error(
        `planStreetCells(${seed}): every way to connect the street network crosses protected cell ${at}`
      )
    }
    for (const c of line(best.a.x, best.a.z, best.b.x, best.b.z)) {
      const k = key(c.x, c.z)
      if (keys.has(k)) continue
      keys.add(k)
      all.push({ x: c.x, z: c.z })
    }
  }
}

/**
 * @param seed the pattern's seed; the same seed always gives the same streets
 * @param radius how far the network reaches, in cells
 * @returns the street cells, `{x, z}`, sorted by x then z
 */
export function planStreetCells(seed = STREET_SEED, radius = TOWN_CELL_RADIUS) {
  const rand = mulberry(seed)
  const found = new Map()
  slice({ x0: -radius, z0: -radius, x1: radius, z1: radius }, rand, (x, z) =>
    found.set(key(x, z), { x, z })
  )
  return connect([...found.values()], seed).sort((a, b) => a.x - b.x || a.z - b.z)
}
