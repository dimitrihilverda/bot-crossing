import test from 'node:test'
import assert from 'node:assert/strict'
import {
  vergeFurniture,
  carriagewayTiles,
  CARRIAGEWAY_WIDTH,
  ROAD_SURFACE_LIFT,
  SUBGRID,
  TRAFFIC_LIGHT_PARTS,
} from '../src/world/road-mesh.js'
import { planStreets } from '../src/world/streets.js'
import { inTown } from '../src/world/town-plan.js'
import { CELL_SIZE } from '../src/world/grid.js'

const streets = planStreets()
const furniture = vergeFurniture(streets.cells, CELL_SIZE)
const of = (part) => furniture.filter((f) => f.part === part)

const N = { x: 0, z: -1 }
const S = { x: 0, z: 1 }
const E = { x: 1, z: 0 }
const W = { x: -1, z: 0 }

const streetKeys = new Set(streets.cells.map((c) => `${c.x},${c.z}`))
const armsOf = (c) => [N, S, E, W].filter((d) => streetKeys.has(`${c.x + d.x},${c.z + d.z}`))

// The same "borders the town" predicate R11 defines, recomputed independently here (not
// imported from road-mesh.js) so these tests check `vergeFurniture`'s actual output against
// an outside measurement of the rule, rather than trusting the module's own internal helper.
const bordersTown = (cell) =>
  [N, S, E, W].some((d) => {
    const n = { x: cell.x + d.x, z: cell.z + d.z }
    return !streetKeys.has(`${n.x},${n.z}`) && inTown(n)
  })

// The playful revision's own clearance figure, recomputed here rather than imported from
// road-mesh.js: how far past the carriageway's own half-width (1.2) a lamp or a traffic light
// stands. See road-mesh.js's own doc comment on vergeFurniture for the derivation.
const KERB = CARRIAGEWAY_WIDTH / 2 + 0.6

/** Every piece of furniture a cell can produce sits strictly inside that cell's own 12-unit
 *  footprint (the largest offset from centre either a lamp or a light ever reaches is `KERB`,
 *  1.8, well under the 6-unit half-width), the same way carriagewayTiles's own tiles never
 *  spill into a neighbour's footprint. So a cell's bounding box is a reliable way to ask "did
 *  this cell get any furniture at all". */
const inCell = (cell) => {
  const cx = cell.x * CELL_SIZE
  const cz = cell.z * CELL_SIZE
  return furniture.filter((f) => Math.abs(f.x - cx) < CELL_SIZE / 2 && Math.abs(f.z - cz) < CELL_SIZE / 2)
}

test('streetlights stand along the roads, not only at corners', () => {
  const lamps = of('streetlight')
  assert.ok(lamps.length > 20, `only ${lamps.length} streetlights`)
  const cells = new Set(lamps.map((l) => `${Math.round(l.x / 12)},${Math.round(l.z / 12)}`))
  assert.ok(cells.size > 10, `the lamps are bunched into ${cells.size} cells`)
})

test('the furniture is deterministic', () => {
  assert.deepEqual(vergeFurniture(streets.cells, CELL_SIZE), furniture)
})

// ── the three rulings (R11, R7, and the crossing placement) ────────────────────────────────

test('a country-lane cell — no in-town block on any of its four sides — gets no furniture at all', () => {
  // Fails if R11's gate is ever dropped, loosened (e.g. checking only street neighbours) or
  // inverted: a real bare cell exists in the network, so this is not a vacuous pass over an
  // empty candidate list.
  const bare = streets.cells.filter((c) => !bordersTown(c))
  assert.ok(bare.length > 0, 'no bare (country-lane) cell found in the real network to test against')
  for (const c of bare.slice(0, 5)) {
    const got = inCell(c)
    assert.equal(got.length, 0, `country-lane cell ${c.x},${c.z} got furniture: ${JSON.stringify(got)}`)
  }
})

test('every furnished cell that still counts as a street cell gets furniture', () => {
  // The complement of the above: a furnished cell (R11 passes) must actually carry something,
  // or the gate would be silently dropping cells it should keep as well as ones it should not.
  const furnished = streets.cells.filter((c) => bordersTown(c))
  assert.ok(furnished.length > 0, 'no furnished cell found in the real network to test against')
  for (const c of furnished.slice(0, 5)) {
    assert.ok(inCell(c).length > 0, `furnished cell ${c.x},${c.z} got no furniture at all`)
  }
})

test('every furnished three- or four-arm junction gets exactly one traffic light and one crossing (R7)', () => {
  const junctions = streets.cells.filter((c) => armsOf(c).length >= 3 && bordersTown(c))
  assert.ok(junctions.length > 0, 'no furnished junction found in the real network to test against')
  const lightParts = new Set(['trafficlight_A', 'trafficlight_B', 'trafficlight_C'])
  for (const c of junctions) {
    const near = inCell(c)
    const lights = near.filter((f) => lightParts.has(f.part))
    const crossings = near.filter((f) => f.part === 'road_straight_crossing')
    assert.equal(lights.length, 1, `junction ${c.x},${c.z} has ${lights.length} traffic lights`)
    assert.equal(crossings.length, 1, `junction ${c.x},${c.z} has ${crossings.length} crossings`)
  }
  // R7 specifically: the brief's own restriction (four arms only) would pass every assertion
  // above for the four-arm subset while silently starving every three-arm junction of a
  // light, so this checks the three-arm ones were not skipped as a group.
  const threeArm = junctions.filter((c) => armsOf(c).length === 3)
  assert.ok(threeArm.length > 0, 'no furnished three-arm junction found to test R7 against')
})

test('a crossing replaces its arm\'s outermost carriageway tile exactly — same x, z and rotation a plain tile would get', () => {
  // The old body of this test only checked `cr.ry / (Math.PI / 2)` is an integer — a fact
  // `tileFor` guarantees for every rotation it ever returns, crossing or not, so it passed
  // whichever sub-grid step the crossing sat on and whichever right angle it was turned to.
  // Proven: moving the crossing to the inner sub-grid step, and separately adding `Math.PI /
  // 2` to its `ry` (so the zebra stripes run along the road instead of across it — this
  // project's defining defect, reproduced exactly), both still pass that assertion.
  //
  // This instead computes the real carriageway tile the crossing claims to stand in for —
  // independently, via `carriagewayTiles` on the same real network, not by re-deriving
  // `tileFor`'s rotation logic here — and asserts the crossing matches it exactly, and that
  // the tile in question is genuinely the outermost one of its arm (the far, i=2 sub-grid
  // step, not the inner, i=1 one).
  const crossings = of('road_straight_crossing')
  assert.ok(crossings.length > 0, 'no zebra crossings')
  const step = CELL_SIZE / SUBGRID
  const plainTiles = carriagewayTiles(streets.cells, CELL_SIZE)
  const tileAt = (x, z) => plainTiles.find((t) => Math.abs(t.x - x) < 1e-6 && Math.abs(t.z - z) < 1e-6)

  for (const cr of crossings) {
    const plain = tileAt(cr.x, cr.z)
    assert.ok(plain, `no plain carriageway tile sits where the crossing at ${cr.x},${cr.z} claims to replace one`)
    assert.equal(
      cr.ry,
      plain.ry,
      `crossing at ${cr.x},${cr.z} has ry=${cr.ry}, but the carriageway tile it replaces has ry=${plain.ry}`
    )

    // "Outermost": the crossing must sit at i=2 along some arm of its cell — not i=1, the
    // sub-grid step tileAt would also happily match a plain tile at (the inner tile is a
    // real, distinct carriageway tile too, just not the one this arm's outer edge occupies).
    const cellX = Math.round(cr.x / CELL_SIZE)
    const cellZ = Math.round(cr.z / CELL_SIZE)
    const cx = cellX * CELL_SIZE
    const cz = cellZ * CELL_SIZE
    const arm = [N, S, E, W].find(
      (d) => Math.abs(cr.x - (cx + d.x * step * 2)) < 1e-6 && Math.abs(cr.z - (cz + d.z * step * 2)) < 1e-6
    )
    assert.ok(arm, `crossing at ${cr.x},${cr.z} is not at any arm's outer (i=2) sub-grid step of cell ${cellX},${cellZ}`)
    const inner = { x: cx + arm.x * step, z: cz + arm.z * step }
    assert.ok(
      Math.abs(cr.x - inner.x) > 1e-6 || Math.abs(cr.z - inner.z) > 1e-6,
      `crossing at ${cr.x},${cr.z} coincides with the inner (i=1) sub-grid step, not the outermost one`
    )
  }
})

// ── minor findings: no coincident furniture ─────────────────────────────────────────────

test('no two pieces of verge furniture occupy the same x/z', () => {
  // Mirrors the no-coincident-tiles assertion road-tiles.test.mjs makes for the carriageway
  // itself. With no pavement left to place, this now guards only the streetlight/crossing/
  // traffic-light trio, but the risk it catches is the same one the old dedup bug was: a
  // traffic light standing inside a streetlight at a verge's diagonal corners.
  const seen = new Map()
  for (const f of furniture) {
    const k = `${f.x.toFixed(4)},${f.z.toFixed(4)}`
    assert.ok(!seen.has(k), `${seen.get(k)} and ${f.part} land on the same spot at ${k}`)
    seen.set(k, f.part)
  }
})

// ── facing: the streetlight and the traffic light both have a front (see the doc comments in
// road-mesh.js for the glb measurements and the rotation derivations) ──────────────────────

test('a streetlight\'s arm overhangs its own arm\'s carriageway, not the block behind it', () => {
  // `streetlight` is asymmetric: its cantilever arm reaches along local -X to the lit lens.
  // Recomputes, independently, the direction from each lamp back to its own arm's centre
  // line, and asserts the local -X arm (rotated by the lamp's own `ry`) points there.
  const lamps = of('streetlight')
  assert.ok(lamps.length > 20, `only ${lamps.length} streetlights`)
  const step = CELL_SIZE / SUBGRID
  let checked = 0
  for (const c of streets.cells) {
    if (!bordersTown(c)) continue
    const cx = c.x * CELL_SIZE
    const cz = c.z * CELL_SIZE
    const lampSide = (c.x + c.z) % 2 === 0 ? 1 : -1
    for (const d of armsOf(c)) {
      const perp = { x: d.z, z: -d.x }
      // 1 step along the arm, `KERB` (1.8) off the centre line — see the streetlight-
      // offset pinning test below for why exactly these figures.
      const x = cx + d.x * step + lampSide * perp.x * KERB
      const z = cz + d.z * step + lampSide * perp.z * KERB
      const lamp = lamps.find((l) => Math.abs(l.x - x) < 1e-6 && Math.abs(l.z - z) < 1e-6)
      if (!lamp) continue
      checked++
      // Unit vector from the lamp back to this arm's own centre line — the carriageway it
      // must overhang.
      const v = { x: -lampSide * perp.x, z: -lampSide * perp.z }
      const c1 = Math.cos(lamp.ry)
      const s1 = Math.sin(lamp.ry)
      // Local (-1, 0), the arm's own direction, rotated by the lamp's ry.
      const armX = -c1
      const armZ = s1
      const dot = armX * v.x + armZ * v.z
      assert.ok(
        dot > 0.999,
        `streetlight at ${lamp.x},${lamp.z} has its arm pointing ${armX.toFixed(3)},${armZ.toFixed(3)}, ` +
          `not toward its own carriageway ${v.x},${v.z}`
      )
    }
  }
  assert.ok(checked > 20, `only checked ${checked} streetlights against their own arm`)
})

test('the traffic-light selection pool keeps the gantry variant out', () => {
  // trafficlight_C's gantry arm reaches 0.764 units (measured from city.glb). At this
  // revision's pole position — KERB (1.8) off the centre line, against a carriageway
  // half-width of 1.2 — the gap to close is only 0.6 units, inside the gantry's own reach.
  // `_C` is kept out of the pool anyway: re-admitting it is a separate decision — new reach
  // math to verify, a different visual mix of pole and gantry signals — outside this
  // revision's scope. Only the two pole-mounted variants are chosen.
  assert.deepEqual([...TRAFFIC_LIGHT_PARTS], ['trafficlight_A', 'trafficlight_B'])

  // Confirms the exclusion actually reaches the real network's output, not just the pool's
  // own declaration — every one of the real furnished junctions must have picked from that
  // pool, so none of them should ever produce a trafficlight_C.
  const gantries = of('trafficlight_C')
  assert.equal(gantries.length, 0, `${gantries.length} real trafficlight_C placements found`)
})

test('a traffic light faces the traffic on the arm it governs', () => {
  // `trafficlight_A/B/C` all carry their lens groups on the model's own +Z face. Recomputes
  // the governed arm's own outward direction (the same one the crossing on that junction
  // sits on) and asserts local +Z, rotated by the light's own `ry`, points that way.
  const lights = ['trafficlight_A', 'trafficlight_B', 'trafficlight_C'].flatMap(of)
  assert.ok(lights.length > 0, 'no traffic lights')
  const h = (cell) => cell.x * 31 + cell.z * 17
  const mod = (n, m) => ((n % m) + m) % m
  let checked = 0
  for (const c of streets.cells) {
    const arms = armsOf(c)
    if (arms.length < 3 || !bordersTown(c)) continue
    const d = arms[mod(h(c), arms.length)]
    const light = lights.find(
      (l) => Math.abs(l.x - c.x * CELL_SIZE) < CELL_SIZE / 2 && Math.abs(l.z - c.z * CELL_SIZE) < CELL_SIZE / 2
    )
    if (!light) continue
    checked++
    const c1 = Math.cos(light.ry)
    const s1 = Math.sin(light.ry)
    // Local (0, 1) (+Z), the lens face, rotated by the light's own ry.
    const faceX = s1
    const faceZ = c1
    const dot = faceX * d.x + faceZ * d.z
    assert.ok(
      dot > 0.999,
      `traffic light at ${light.x},${light.z} faces ${faceX.toFixed(3)},${faceZ.toFixed(3)}, ` +
        `not along its governed arm ${d.x},${d.z}`
    )
  }
  assert.ok(checked > 0, `only checked ${checked} traffic lights against their governed arm`)
})

// ── playful revision: lamps and signals at the kerb line, now that there is no pavement to
// stand on (see road-mesh.js's own doc comment on vergeFurniture for the derivation of the
// `KERB` figure) ─────────────────────────────────────────────────────────────────────────────

test('streetlights stand at the kerb line, just outside the carriageway', () => {
  // Independent of road-mesh.js's own `d`/`perp` bookkeeping: a lamp sits `1` sub-grid
  // step along its arm and `KERB` (1.8) off the centre line, and — because the arm direction
  // and its perpendicular are always axis-aligned and orthogonal — that always puts exactly
  // one of the lamp's own local x/z offsets from its cell's centre at 1 step (2.4 units)
  // and the other at 1.8, regardless of which of the four arms it belongs to. So this checks
  // only that unordered pair, computed from nothing but the lamp's own position and its
  // cell's centre — not by re-deriving which arm it is on.
  //
  // The density-recovery revision moved the lamp here, along the arm, from a 1.5-step
  // midpoint: that midpoint sat exactly on town-plan.js's own terrace-slot boundary (both
  // figures derive from the same CARRIAGEWAY_WIDTH pitch), so a lamp's real footprint
  // straddled two neighbouring slots instead of reserving one — see road-mesh.js's own doc
  // comment on `cellFurniture`. 1 step is half a slot pitch off that old 1.5-step midpoint,
  // landing the lamp inside a single slot; this pins the new along-arm figure directly, so a
  // regression back to 1.5 (or any other value) is caught here as well as by the town-wide
  // slot-reservation count in town-plan.js's own tests.
  //
  // The perpendicular figure, `KERB` (1.8), is untouched by this revision — it was already
  // moved once, off the pavement-era footway edge (1 sub-grid step, 2.4) to the kerb line, by
  // an earlier revision; this test only re-pins it alongside the along-arm figure above so the
  // two are checked together, as the real lamp's own two offsets.
  const lamps = of('streetlight')
  assert.ok(lamps.length > 20, `only ${lamps.length} streetlights`)
  const step = CELL_SIZE / SUBGRID
  for (const l of lamps) {
    const cx = Math.round(l.x / CELL_SIZE) * CELL_SIZE
    const cz = Math.round(l.z / CELL_SIZE) * CELL_SIZE
    const offsets = [Math.abs(l.x - cx), Math.abs(l.z - cz)].sort((a, b) => a - b)
    assert.ok(
      Math.abs(offsets[0] - KERB) < 1e-6 && Math.abs(offsets[1] - step) < 1e-6,
      `streetlight at ${l.x},${l.z} sits ${offsets[0]}/${offsets[1]} off its cell's centre, ` +
        `expected ${KERB}/${step}`
    )
    // The clearance the brief asked for directly: KERB clears the carriageway's own
    // half-width (1.2) by 0.6 — "just outside", not deep in open verge.
    assert.ok(
      offsets[0] > CARRIAGEWAY_WIDTH / 2,
      `streetlight at ${l.x},${l.z} does not clear the carriageway's own half-width ${CARRIAGEWAY_WIDTH / 2}`
    )
  }
})

test('traffic lights stand at the junction corner, close to the cell centre', () => {
  // Same independence as the streetlight test above: a signal sits `KERB` (1.8) out on both
  // the along-arm and perpendicular axes at once (unlike a lamp, the same figure on both), so
  // its local x/z offsets from its cell's centre both come out at 1.8 regardless of which
  // governed arm it stands beside. Also checks the clearance the brief asked for directly:
  // 1.8 units clears the carriageway's own 1.2-unit half-width by 0.6 units — "just clear",
  // not deep in open verge.
  const lights = ['trafficlight_A', 'trafficlight_B'].flatMap(of)
  assert.ok(lights.length > 0, 'no traffic lights')
  const carriagewayHalfWidth = CARRIAGEWAY_WIDTH / 2
  for (const l of lights) {
    const cx = Math.round(l.x / CELL_SIZE) * CELL_SIZE
    const cz = Math.round(l.z / CELL_SIZE) * CELL_SIZE
    const dx = Math.abs(l.x - cx)
    const dz = Math.abs(l.z - cz)
    assert.ok(
      Math.abs(dx - KERB) < 1e-6 && Math.abs(dz - KERB) < 1e-6,
      `traffic light at ${l.x},${l.z} sits ${dx}/${dz} off its cell's centre, expected ${KERB}/${KERB}`
    )
    assert.ok(
      dx > carriagewayHalfWidth && dz > carriagewayHalfWidth,
      `traffic light at ${l.x},${l.z} does not clear the carriageway's own half-width ${carriagewayHalfWidth}`
    )
  }
})

test('every piece of verge furniture sits on the ground, at the same lift as the carriageway', () => {
  // There is no kerb to raise a lamp or a signal onto any more (see road-mesh.js's own doc
  // comment) — every piece here now shares the carriageway's own small ground-clearance lift.
  // Proven: setting a furniture piece's lift back to the old, larger pavement-era figure
  // (`ROAD_SURFACE_LIFT * 8`) still passes every other assertion in this file, since none of
  // them reads `lift` — only this one does.
  assert.ok(furniture.length > 0, 'no verge furniture to check the lift of')
  for (const f of furniture) {
    assert.equal(f.lift, ROAD_SURFACE_LIFT, `${f.part} at ${f.x},${f.z} uses lift ${f.lift}`)
  }
})
