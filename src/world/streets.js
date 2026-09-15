import { key, neighbours, ring } from './grid.js'

/**
 * Where the streets run — pure arithmetic over plain `{x, z}` cells.
 *
 * Streets are a **derived layer**. This function reads a layout that `allocateCells` has
 * already produced and never influences it, so the sticky placement persisted in
 * `data/colony.json` carries no risk from anything here. That is deliberate and it is the
 * most important safety property of the whole street design: a bug in this file can make
 * the roads wrong, and cannot make the colony rearrange itself.
 *
 * Streets take whole cells rather than threading between plots, because they cannot thread
 * between plots. Re-measured against the code as it now stands, not carried over from the
 * old hex numbers: houses sit on a 3 x 3 grid at `SLOT_SPACING` = 4.0 from a cell's centre
 * (`plots.js`) and reach `HOUSE_HALF_WIDTH` = 1.45 past that, so the outermost one's edge
 * sits at 5.45; the kerb's own inner face (`KERB_INNER`) is at 5.582. That leaves a verge
 * only **0.132** wide between a plot's own buildings and its own boundary, against a car
 * 0.61 wide — under a quarter of one. The conclusion holds even more strongly than the old
 * hex-lattice numbers ever showed it, and it holds regardless of ground clutter: this verge
 * is not where `_buildClutter` places its props any more (`plots.js`'s own comment on that
 * method explains where they went and why), so the 0.132 is the verge's width outright, not
 * a width further narrowed by anything sitting in it. No vehicle fits that gap on any cell,
 * so a street has nowhere to thread through a plot and has to take a whole cell of its own.
 *
 * A street cell is **not** a cell paved over. A cell is 12 units across — about 19.7 car
 * widths — so a paved one would read as a plaza. The carriageway is 2.5 wide down the
 * middle and the rest is verge; that is `road-mesh.js`'s business, not this file's.
 */

/** The depot's spur is keyed under a name no repo can collide with. */
export const SHIP_SPUR = '__ship__'

const ORIGIN = { x: 0, z: 0 }

/**
 * A cell's distance from the origin, in the same Chebyshev metric `grid.js`'s `ring` uses.
 * Not `grid.js`'s exported `distance` — that one is Manhattan, the step count for routing —
 * this is the outline metric, so a ring radius derived from it actually encloses every cell
 * it is measured against.
 */
function chebyshev(cell) {
  return Math.max(Math.abs(cell.x), Math.abs(cell.z))
}

/**
 * Which cells nobody may build a street on: every plot cell, every anchored district cell,
 * and the depot's own cell.
 */
function claimedCells(layout, ship, anchored) {
  const claimed = new Set(anchored)
  for (const cells of layout.values()) {
    for (const cell of cells) claimed.add(key(cell.x, cell.z))
  }
  claimed.add(key(ship.x, ship.z))
  return claimed
}

/**
 * The radius the ring sits at: one past the furthest **home** plot cell.
 *
 * Anchored districts do not push it out. They sit at ring five by design, and the gap of
 * bare terrain between the colony and a neighbour's settlement is deliberate — a ring
 * dragged out to meet them would pave it. `anchored` is therefore excluded from this
 * measurement even though it is excluded from the ring's cells too.
 */
function ringRadius(layout, ship, anchored) {
  let furthest = chebyshev(ship)
  for (const cells of layout.values()) {
    for (const cell of cells) {
      if (anchored.has(key(cell.x, cell.z))) continue
      furthest = Math.max(furthest, chebyshev(cell))
    }
  }
  return furthest + 1
}

/**
 * The shortest chain of unclaimed cells from `from` to any cell in `targets`, `from`
 * excluded and the target included.
 *
 * Breadth-first, so the first chain found is a shortest one. Returns `null` when no chain
 * exists — which is a real and expected outcome, not a failure: a plot walled in by other
 * plots has no free neighbour to leave through.
 *
 * `limit` bounds the search so a pathological layout cannot walk the lattice forever. It is
 * generous: the ring is at most one cell beyond the furthest plot, so a spur never needs
 * more than a handful of steps.
 */
function shortestChain(from, targets, blocked, limit) {
  if (targets.has(key(from.x, from.z))) return []
  const seen = new Set([key(from.x, from.z)])
  const queue = [{ cell: from, path: [] }]
  while (queue.length) {
    const { cell, path } = queue.shift()
    if (path.length >= limit) continue
    for (const next of neighbours(cell)) {
      const k = key(next.x, next.z)
      if (seen.has(k)) continue
      seen.add(k)
      const chain = [...path, next]
      if (targets.has(k)) return chain
      // Only unclaimed ground may be walked through. A target is reachable *onto* but
      // never *through*, which is why the target check comes first.
      if (blocked.has(k)) continue
      queue.push({ cell: next, path: chain })
    }
  }
  return null
}

/**
 * Split `ring()`'s output into the arcs a claimed cell leaves behind.
 *
 * `ring(radius)` is a closed walk: every consecutive pair is a genuine four-neighbour, and
 * the last cell closes back to the first (see `grid.js`). Simply filtering claimed cells out
 * of that array — what this used to do — keeps the set but throws the walk away: two
 * surviving cells that were not adjacent in the ring end up adjacent in the filtered array,
 * and handing that to `carriagewayPoints({ closed: true })` turns the gap into a long
 * diagonal streak of paving with a corner tile bent to a heading no piece in the kit fits.
 *
 * A ring with cells removed is not one loop; it is one or more open arcs. So: walk the full
 * ring once, and cut a new arc wherever a claimed cell is met. If nothing on the ring is
 * claimed, the whole thing survives as a single arc that is *still* a closed loop — the
 * common case, and the one the old code got right by accident. Every other case comes back
 * as open runs, each one still a genuine walk, just no longer required to close.
 *
 * @returns an array of `{ cells, closed }` — `closed` is true only for the one case where
 *   `cells` is the entire, unbroken ring.
 */
function ringRuns(radius, claimed) {
  const cells = ring(radius)
  const free = cells.map((cell) => !claimed.has(key(cell.x, cell.z)))
  if (free.every(Boolean)) return cells.length ? [{ cells, closed: true }] : []
  if (free.every((f) => !f)) return []

  // Start the scan at a claimed cell so a run that would otherwise wrap across the array's
  // own start/end boundary — the last few cells of `ring()`'s walk and the first few, both
  // free — comes back as the one arc it actually is, not two.
  const start = free.indexOf(false)
  const runs = []
  let current = []
  for (let i = 0; i < cells.length; i++) {
    const idx = (start + i) % cells.length
    if (free[idx]) {
      current.push(cells[idx])
    } else if (current.length) {
      runs.push({ cells: current, closed: false })
      current = []
    }
  }
  if (current.length) runs.push({ cells: current, closed: false })
  return runs
}

/**
 * Plan the streets for one colony layout.
 *
 * @param layout the `Map<plotId, Array<{x, z}>>` that `allocateCells` returned
 * @param options `{ ship, anchored }` — the depot cell, and the cell keys of every visiting
 *   colony's district
 * @returns `{ ring, ringRuns, spurs, all }`. `ring` is every unclaimed ring cell, flat, in
 *   ring order — handy for a caller that only wants membership. `ringRuns` is what actually
 *   drives the mesh: `carriagewayPoints` must be called once per run, with that run's own
 *   `closed` flag, never once across the concatenation of all of them (see `ringRuns` above
 *   for why). `spurs` has no entry for a plot that cannot be reached by road; the caller
 *   falls back to driving over the deck for those, exactly as stage 2 did for every plot.
 */
export function planStreets(layout, { ship, anchored = new Set() }) {
  const claimed = claimedCells(layout, ship, anchored)
  const radius = ringRadius(layout, ship, anchored)

  const runs = ringRuns(radius, claimed)
  const ringCells = runs.flatMap((run) => run.cells)
  const all = new Set(ringCells.map((cell) => key(cell.x, cell.z)))
  const onRing = new Set(all)

  const spurs = new Map()
  // A spur may not run through another plot, another district, or the depot — but it may
  // run through a cell an earlier spur already claimed, which is how two neighbouring
  // plots come to share an approach instead of laying two roads side by side.
  const SPUR_LIMIT = radius * 2 + 2

  const roots = [
    ...[...layout.entries()].map(([id, cells]) => ({ id, from: cells[0] })),
    { id: SHIP_SPUR, from: ship },
  ]
  for (const { id, from } of roots) {
    if (!from) continue
    const chain = shortestChain(from, onRing, claimed, SPUR_LIMIT)
    if (!chain || !chain.length) continue
    spurs.set(id, chain)
    for (const cell of chain) all.add(key(cell.x, cell.z))
  }

  return { ring: ringCells, ringRuns: runs, spurs, all }
}
