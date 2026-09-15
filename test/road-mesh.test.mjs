import { test } from 'node:test'
import assert from 'node:assert/strict'
import { CELL_SIZE } from '../src/world/grid.js'
import {
  CARRIAGEWAY_WIDTH,
  ROAD_SURFACE_LIFT,
  ROAD_TILE_SIZE,
  carriagewayHeight,
  carriagewayPoints,
  roadTileScale,
} from '../src/world/road-mesh.js'

test('the carriageway is 2.5 wide', () => {
  // The spec's number, and the reason streets take whole cells: a cell is 12 across, far
  // wider than the carriageway needs, so paving the whole thing would read as a plaza.
  assert.equal(CARRIAGEWAY_WIDTH, 2.5)
})

test('the tile scale brings a 2 x 2 tile to the carriageway width', () => {
  assert.equal(ROAD_TILE_SIZE, 2)
  assert.equal(roadTileScale(), CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE)
  assert.equal(roadTileScale(), 1.25)
})

test('a single street cell lays one patch of carriageway', () => {
  const points = carriagewayPoints([{ x: 0, z: 0 }], CELL_SIZE)
  assert.ok(points.length >= 1)
  for (const p of points) {
    assert.equal(typeof p.x, 'number')
    assert.equal(typeof p.z, 'number')
    assert.equal(p.kind, 'junction', 'a lone cell with no hop should still fall back to junction')
  }
})

// ── the payoff: every bend is 90 degrees now, so a bend gets a real corner tile ────────────

test('a bend lays a corner piece, not a junction patch', () => {
  // The compromise this stage exists to remove: on the hex lattice a bend turned 120 degrees,
  // no corner piece in the kit turns anything but 90, and a four-armed junction tile was
  // dropped there with its extra arms reading as stubs. Every bend is 90 degrees now.
  const bend = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]
  const points = carriagewayPoints(bend, CELL_SIZE, { placed: new Set() })
  assert.ok(points.some((p) => p.kind === 'corner'), 'a bend laid no corner')
  assert.ok(!points.some((p) => p.kind === 'junction'), 'a bend still lays a junction patch')
})

test('a straight run lays neither corner nor junction', () => {
  const straight = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]
  const points = carriagewayPoints(straight, CELL_SIZE, { placed: new Set() })
  for (const p of points) assert.equal(p.kind, 'straight', `a straight run laid a ${p.kind}`)
})

test('every patch carries a heading a tile can be rotated to', () => {
  const run = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]
  for (const p of carriagewayPoints(run, CELL_SIZE, { placed: new Set() })) {
    assert.ok(Number.isFinite(p.heading), `${p.kind} patch has no heading`)
  }
})

test('a corner carries the incoming heading — the same one the straight patch before it carries', () => {
  // Cell (1, 0) turns from travelling +x (heading 0) to travelling +z (heading PI/2). The
  // corner sits where that bend happens and should carry the heading of the leg leading into
  // it, so its facing edge lines up with the straight tile immediately behind it.
  //
  // The expected value is derived from the bend's own cells (prev -> here), not a hand-picked
  // constant, so the assertion states the *convention* — "incoming direction" — rather than
  // merely restating whatever number the code happens to produce for this one bend.
  //
  // This convention was disputed (task-5-review.md flagged it PLAUSIBLE-wrong, reasoning from
  // the GLB's raw vertex data, without a live render) and settled by actually rendering the
  // real `road_corner` asset at ring cell {x:3,z:3} under both this heading and the
  // incoming-heading-plus-180-degrees alternative (see task-5-report.md's "Settling the
  // heading dispute" appendix): the incoming heading produced a continuous kerb and lane
  // markings at both seams, flipping it 180 degrees produced a visibly disconnected corner
  // tile. If this heading were rotated by 180 degrees, `expected` below would differ from
  // `corner.heading` by exactly PI, and the assertion would fail.
  const bend = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]
  const points = carriagewayPoints(bend, CELL_SIZE, { placed: new Set() })
  const corner = points.find((p) => p.kind === 'corner')
  assert.ok(corner, 'no corner patch found')

  const [prev, here] = bend
  const inDir = { x: here.x - prev.x, z: here.z - prev.z }
  const expected = Math.atan2(inDir.z, inDir.x)
  assert.ok(
    Math.abs(corner.heading - expected) < 1e-9,
    `corner heading ${corner.heading} is not the incoming heading ${expected} (atan2 of prev->here)`
  )
})

test('no two patches land on the same spot', () => {
  const cells = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1 }]
  const points = carriagewayPoints(cells, CELL_SIZE)
  const seen = new Set(points.map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`))
  assert.equal(seen.size, points.length, 'two road patches were laid on the same spot')
})

test('closed:true bridges the last cell back to the first; an open run leaves that seam unpaved', () => {
  // A unit square loop: four cells, each edge-adjacent to the next, wrapping from the last
  // back to the first.
  const loop = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }, { x: 0, z: 1 }]
  const closedPoints = carriagewayPoints(loop, CELL_SIZE, { closed: true })
  const openPoints = carriagewayPoints(loop, CELL_SIZE, { closed: false })

  const keyOf = (p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`
  const openKeys = new Set(openPoints.map(keyOf))
  const seamOnly = closedPoints.filter((p) => !openKeys.has(keyOf(p)))
  assert.ok(seamOnly.length > 0, 'closed:true added no patches beyond what an open run already lays')
  // Every seam-only patch sits on the hop back from the last cell (0, 1) to the first (0, 0):
  // world x stays at 0, the x both of those cells share.
  for (const p of seamOnly) {
    assert.ok(Math.abs(p.x) < 1e-6, `seam patch at (${p.x}, ${p.z}) is not on the closing hop`)
  }
})

test('two runs sharing a placed set never lay two patches on the same spot, even where the second starts on a cell the first already covers', () => {
  const placed = new Set()
  // A spur-like open run, then a second run that starts on the first run's last cell —
  // exactly how a spur's chain lands on the ring cell it joins.
  const first = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]
  const second = [{ x: 2, z: 0 }, { x: 2, z: 1 }]

  const firstPoints = carriagewayPoints(first, CELL_SIZE, { placed })
  const secondPoints = carriagewayPoints(second, CELL_SIZE, { placed })

  const key = (p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`
  const firstKeys = new Set(firstPoints.map(key))
  const overlap = secondPoints.filter((p) => firstKeys.has(key(p)))
  assert.equal(overlap.length, 0, 'the second run re-laid a patch the first run had already placed')

  // The shared cell (2, 0) really was covered — by the first run, as its last cell — so the
  // absence of overlap above is dedup working, not the shared cell simply going unpaved.
  const sharedCellCovered = firstPoints.some((p) => Math.abs(p.x - 2 * CELL_SIZE) < 1e-6 && Math.abs(p.z) < 1e-6)
  assert.ok(sharedCellCovered, 'the cell the two runs share was never paved by either run')
})

test('an open run behaves the same with no options passed as with the defaults spelled out', () => {
  const cells = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }, { x: 2, z: 1 }]
  const implicit = carriagewayPoints(cells, CELL_SIZE)
  const explicit = carriagewayPoints(cells, CELL_SIZE, { closed: false, placed: new Set() })
  assert.deepEqual(implicit, explicit, 'omitting options changed behaviour from spelling out the defaults')
  // Same shape the original tests already pin: no coordinate laid twice.
  const seen = new Set(implicit.map((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}`))
  assert.equal(seen.size, implicit.length, 'the default (single-call) placed set did not dedup within its own run')
})

// ── D1: every patch carries a heading, so the tile drawn on it can be rotated to face it ──

test('every patch carries a finite numeric heading, and a bend carries two different ones', () => {
  const bend = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 1, z: 1 }]
  const points = carriagewayPoints(bend, CELL_SIZE)
  for (const p of points) {
    assert.equal(typeof p.heading, 'number', `patch at (${p.x}, ${p.z}) has no numeric heading`)
    assert.ok(Number.isFinite(p.heading), `heading ${p.heading} is not finite`)
  }
  // The bend turns from one hop's direction to a different one, so at least two distinct
  // headings must appear among the patches (the two straight lead-ins plus the corner).
  const headings = new Set(points.map((p) => p.heading.toFixed(6)))
  assert.ok(headings.size >= 2, `a bend produced only ${headings.size} distinct heading(s)`)
})

test("a straight run's patches all share one heading", () => {
  const straight = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]
  const points = carriagewayPoints(straight, CELL_SIZE)
  assert.ok(points.length > 1, 'not enough patches to compare')
  const headings = new Set(points.map((p) => p.heading.toFixed(6)))
  assert.equal(headings.size, 1, `a straight run produced ${headings.size} distinct headings`)
})

test('a patch\'s heading is exactly atan2(dz, dx) over the hop it belongs to', () => {
  // Cell (0,0) to cell (1,0) at CELL_SIZE spacing: world (0, 0) to (CELL_SIZE, 0) — a hop
  // this whole run repeats, so every patch (straight lead-in and the final cell-centre patch
  // alike) should carry precisely this heading.
  const cells = [{ x: 0, z: 0 }, { x: 1, z: 0 }, { x: 2, z: 0 }]
  const points = carriagewayPoints(cells, CELL_SIZE)
  const expected = Math.atan2(0, CELL_SIZE)
  assert.ok(points.length > 1, 'not enough patches to compare')
  for (const p of points) {
    assert.ok(Math.abs(p.heading - expected) < 1e-9, `heading ${p.heading} !== atan2 value ${expected}`)
  }
})

// ── the terrain-follow fix: the carriageway must track the ground, never clamp to the deck ──

test('ROAD_SURFACE_LIFT is a small positive number', () => {
  assert.equal(typeof ROAD_SURFACE_LIFT, 'number')
  assert.ok(ROAD_SURFACE_LIFT > 0, `ROAD_SURFACE_LIFT ${ROAD_SURFACE_LIFT} is not positive`)
  // "Small": nowhere near the deck's own height, or this would just recreate a floating slab.
  assert.ok(ROAD_SURFACE_LIFT < 0.45, `ROAD_SURFACE_LIFT ${ROAD_SURFACE_LIFT} is not small`)
})

test('carriagewayHeight tracks groundY — it must not clamp, the way the bug it replaced did', () => {
  // Spans the ring's measured terrain range (-0.177 to +0.138) and values above DECK_TOP
  // (0.45), so a reintroduced `Math.max(DECK_TOP, groundY)` clamp fails this test: every one
  // of these inputs, above and below DECK_TOP alike, must come back out shifted by exactly
  // the lift, never pinned to 0.45.
  const groundYs = [-0.177, -0.1, -0.01, 0, 0.01, 0.1, 0.138, 0.45, 0.6, 1.2]
  for (const groundY of groundYs) {
    const h = carriagewayHeight(groundY)
    assert.equal(h, groundY + ROAD_SURFACE_LIFT, `carriagewayHeight(${groundY}) = ${h}, expected ${groundY + ROAD_SURFACE_LIFT}`)
  }
})

test('carriagewayHeight is strictly increasing in groundY — confirms it tracks rather than saturates', () => {
  const groundYs = [-0.177, -0.05, 0, 0.138, 0.45, 1.2]
  let prev = -Infinity
  for (const groundY of groundYs) {
    const h = carriagewayHeight(groundY)
    assert.ok(h > prev, `carriagewayHeight(${groundY}) = ${h} did not increase from the previous input's ${prev}`)
    prev = h
  }
})

test('carriagewayHeight honours an explicit lift override', () => {
  assert.equal(carriagewayHeight(1, 0.25), 1.25)
  assert.equal(carriagewayHeight(-0.177, 0), -0.177)
})
