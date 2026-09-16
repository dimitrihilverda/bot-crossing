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

/** How small and how large a generator rectangle may be before it stops being cut, in cells. */
export const MIN_BLOCK = 1
export const MAX_BLOCK = 3

/** How often a cut steps sideways partway along, and how often it stops short of one end. */
export const JOG_CHANCE = 0.45
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
  let shift = 0
  let jogAt = 0
  if (span >= 4 && rand() < JOG_CHANCE) {
    const dir = rand() < 0.5 ? -1 : 1
    if (options.includes(at + dir)) {
      shift = dir
      // Strictly inside the span, so both legs of the jog exist.
      jogAt = acrossLo + 1 + Math.floor(rand() * (span - 2))
    }
  }

  // A dead end: the cut stops short of one end, leaving a street that goes nowhere. Only on
  // an unjogged cut — trimming a jogged one can remove a whole leg.
  let runLo = acrossLo
  let runHi = acrossHi
  if (shift === 0 && span >= 5 && rand() < DEAD_END_CHANCE) {
    const trim = 1 + Math.floor(rand() * 2)
    if (rand() < 0.5) runLo += trim
    else runHi -= trim
  }

  const put = (at_, across) => (cutX ? add(at_, across) : add(across, at_))
  if (shift === 0) {
    for (let a = runLo; a <= runHi; a++) put(at, a)
  } else {
    // The two legs both include `jogAt`, and those two cells differ by one along the cut
    // axis — that adjacency is the step across, and it is why a jog stays connected.
    for (let a = runLo; a <= jogAt; a++) put(at, a)
    for (let a = jogAt; a <= runHi; a++) put(at + shift, a)
  }

  const cLo = Math.min(at, at + shift)
  const cHi = Math.max(at, at + shift)
  const children = cutX
    ? [{ ...rect, x1: cLo - 1 }, { ...rect, x0: cHi + 1 }]
    : [{ ...rect, z1: cLo - 1 }, { ...rect, z0: cHi + 1 }]
  for (const child of children) {
    if (child.x1 >= child.x0 && child.z1 >= child.z0) slice(child, rand, add)
  }
}

/**
 * Join anything the slicing left stranded.
 *
 * Two cuts on the same axis in sibling rectangles run parallel and never meet, and a jog or a
 * dead end can break the join a child's cut would otherwise make on its parent's. Rather than
 * argue those cases cannot happen — that argument was wrong twice while this plan was being
 * written — this measures the components and connects them, and the test asserts the result.
 *
 * Deterministic: components are walked in the cells' sorted order, and the pair chosen is the
 * first at the smallest Manhattan distance in that order.
 */
function connect(cells) {
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
    for (const a of components[1]) {
      for (const b of components[0]) {
        const d = Math.abs(a.x - b.x) + Math.abs(a.z - b.z)
        if (!best || d < best.d) best = { a, b, d }
      }
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
  return connect([...found.values()]).sort((a, b) => a.x - b.x || a.z - b.z)
}
