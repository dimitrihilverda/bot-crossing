import { HEX_DIRS, hexDistance, hexRing, key } from './plots.js'

/**
 * Where the streets run — pure arithmetic over plain `{q, r}` cells.
 *
 * Streets are a **derived layer**. This function reads a layout that `allocateCells` has
 * already produced and never influences it, so the sticky placement persisted in
 * `data/colony.json` carries no risk from anything here. That is deliberate and it is the
 * most important safety property of the whole street design: a bug in this file can make
 * the roads wrong, and cannot make the colony rearrange itself.
 *
 * Streets take whole cells rather than threading between plots, because they cannot thread
 * between plots. Measured in the running colony: buildings sit on a slot ring at 4.37 from
 * a cell's centre and reach about 1.5 past it, the kerb is at 6.53, and existing ground
 * clutter occupies 4.00 to 6.35. So the clear band is 0.66 at its widest and 0.18 with the
 * clutter, against a car 0.61 wide and a road tile carrying two painted lanes.
 *
 * A street cell is **not** a cell paved over. A cell is 13.16 across — twenty-one car
 * widths — so a paved one would read as a plaza. The carriageway is 2.5 wide down the
 * middle and the rest is verge; that is `road-mesh.js`'s business, not this file's.
 */

/** The depot's spur is keyed under a name no repo can collide with. */
export const SHIP_SPUR = '__ship__'

const ORIGIN = { q: 0, r: 0 }

/** Cells adjacent to `cell`, in `HEX_DIRS` order. */
function neighbours(cell) {
  return HEX_DIRS.map(([dq, dr]) => ({ q: cell.q + dq, r: cell.r + dr }))
}

/**
 * Which cells nobody may build a street on: every plot cell, every anchored district cell,
 * and the depot's own cell.
 */
function claimedCells(layout, ship, anchored) {
  const claimed = new Set(anchored)
  for (const cells of layout.values()) {
    for (const cell of cells) claimed.add(key(cell.q, cell.r))
  }
  claimed.add(key(ship.q, ship.r))
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
  let furthest = hexDistance(ship, ORIGIN)
  for (const cells of layout.values()) {
    for (const cell of cells) {
      if (anchored.has(key(cell.q, cell.r))) continue
      furthest = Math.max(furthest, hexDistance(cell, ORIGIN))
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
  if (targets.has(key(from.q, from.r))) return []
  const seen = new Set([key(from.q, from.r)])
  const queue = [{ cell: from, path: [] }]
  while (queue.length) {
    const { cell, path } = queue.shift()
    if (path.length >= limit) continue
    for (const next of neighbours(cell)) {
      const k = key(next.q, next.r)
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
 * Plan the streets for one colony layout.
 *
 * @param layout the `Map<plotId, Array<{q, r}>>` that `allocateCells` returned
 * @param options `{ ship, anchored }` — the depot cell, and the cell keys of every visiting
 *   colony's district
 * @returns `{ ring, spurs, all }`. `spurs` has no entry for a plot that cannot be reached
 *   by road; the caller falls back to driving over the deck for those, exactly as stage 2
 *   did for every plot.
 */
export function planStreets(layout, { ship, anchored = new Set() }) {
  const claimed = claimedCells(layout, ship, anchored)
  const radius = ringRadius(layout, ship, anchored)

  const ring = hexRing(radius).filter((cell) => !claimed.has(key(cell.q, cell.r)))
  const all = new Set(ring.map((cell) => key(cell.q, cell.r)))
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
    for (const cell of chain) all.add(key(cell.q, cell.r))
  }

  return { ring, spurs, all }
}
