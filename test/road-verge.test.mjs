import test from 'node:test'
import assert from 'node:assert/strict'
import {
  vergeFurniture,
  carriagewayTiles,
  CARRIAGEWAY_WIDTH,
  ROAD_SURFACE_LIFT,
  VERGE_LIFT,
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

/** Every piece of furniture a cell can produce sits strictly inside that cell's own 12-unit
 *  footprint (max offset from centre is 2 sub-grid steps = 4.8, under the 6-unit half-width),
 *  the same way carriagewayTiles's own tiles never spill into a neighbour's footprint. So a
 *  cell's bounding box is a reliable way to ask "did this cell get any furniture at all". */
const inCell = (cell) => {
  const cx = cell.x * CELL_SIZE
  const cz = cell.z * CELL_SIZE
  return furniture.filter((f) => Math.abs(f.x - cx) < CELL_SIZE / 2 && Math.abs(f.z - cz) < CELL_SIZE / 2)
}

test('pavement runs alongside the carriageway, not on it', () => {
  const paving = of('base')
  assert.ok(paving.length > 50, `only ${paving.length} pavement tiles`)

  // A pavement tile's offset from the carriageway has to be measured on the axis
  // *perpendicular* to the arm it belongs to, not on whichever of the two axes happens to be
  // larger: for an arm's inner sub-grid step, the along-arm offset (one step) equals the
  // perpendicular offset, so `max(dx, dz)` cannot tell the two apart there — and for a
  // pavement tile with no perpendicular offset at all, the along-arm coordinate alone is
  // still large enough to make `max` pass regardless. Proven: deleting the perpendicular
  // offset from `vergeFurniture` (so every `base` tile lands on its arm's own centre line)
  // still passes the old `max(dx, dz) >= CARRIAGEWAY_WIDTH / 2` assertion for every one of
  // the 800 tiles it produces, because the along-arm coordinate carries that assertion alone.
  //
  // So this recomputes, independently of road-mesh.js, which axis is perpendicular for every
  // (cell, arm) pair a furnished cell can produce — d.x === 0 means the arm runs along z, so
  // the perpendicular axis is x, and vice versa — and checks only that axis's offset from the
  // cell's own centre against half a carriageway width.
  let checked = 0
  for (const c of streets.cells) {
    if (!bordersTown(c)) continue
    const cx = c.x * CELL_SIZE
    const cz = c.z * CELL_SIZE
    for (const d of armsOf(c)) {
      const perpAxis = d.x === 0 ? 'x' : 'z'
      const centre = perpAxis === 'x' ? cx : cz
      // Every pavement tile this arm can produce sits at one of two sub-grid steps along the
      // arm; a tile search by exact along-position would re-derive the "perpendicular offset
      // exists" fact from the module under test, so instead every actual pavement tile within
      // this cell's own footprint is checked directly against the arm it must belong to.
      for (const p of paving) {
        if (Math.abs(p.x - cx) >= CELL_SIZE / 2 || Math.abs(p.z - cz) >= CELL_SIZE / 2) continue
        // Only a tile actually laid along this arm's own axis (its non-perpendicular
        // coordinate at one or two sub-grid steps from centre, signed to match `d`) is this
        // arm's to check — a tile belonging to a different arm of the same cell is skipped
        // here and picked up when that arm is its turn.
        const alongAxis = perpAxis === 'x' ? 'z' : 'x'
        const alongCentre = alongAxis === 'x' ? cx : cz
        const alongOffset = (p[alongAxis] - alongCentre) * (d[alongAxis] > 0 ? 1 : -1)
        const step = CELL_SIZE / SUBGRID
        const isThisArm =
          d[alongAxis] !== 0 && (Math.abs(alongOffset - step) < 1e-6 || Math.abs(alongOffset - 2 * step) < 1e-6)
        if (!isThisArm) continue
        checked++
        const perpOffset = Math.abs(p[perpAxis] - centre)
        assert.ok(
          perpOffset >= CARRIAGEWAY_WIDTH / 2,
          `pavement tile at ${p.x},${p.z} (arm ${JSON.stringify(d)} of cell ${c.x},${c.z}) is only ` +
            `${perpOffset} off the carriageway's own centre line, on the ${perpAxis} axis`
        )
      }
    }
  }
  assert.ok(checked > 50, `only checked ${checked} pavement tiles against their own arm`)
})

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
  // inverted: a real bare cell exists in the network (the same fact Task 6's report measured
  // — 64 of 156), so this is not a vacuous pass over an empty candidate list.
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

// ── minor findings: dedup, VERGE_LIFT, and no coincident furniture ─────────────────────────

test('no two pieces of verge furniture occupy the same x/z', () => {
  // Mirrors the no-coincident-tiles assertion road-tiles.test.mjs makes for the carriageway
  // itself. Catches both the 45 duplicate inner-diagonal pavement tiles two perpendicular
  // arms of the same cell used to both emit, and a traffic light standing inside a
  // streetlight at the verge's diagonal corners.
  const seen = new Map()
  for (const f of furniture) {
    const k = `${f.x.toFixed(4)},${f.z.toFixed(4)}`
    assert.ok(!seen.has(k), `${seen.get(k)} and ${f.part} land on the same spot at ${k}`)
    seen.set(k, f.part)
  }
})

test('the kerb is a height step, not a colour change: pavement lifts clear of the carriageway', () => {
  // `base` and the road surface UV into the same atlas swatch (cell 2), so the only thing
  // that can make a kerb read as a kerb is a real vertical gap. Pinned directly: setting
  // VERGE_LIFT equal to ROAD_SURFACE_LIFT (kerb flush with the carriageway, an invisible
  // same-grey apron) used to pass every other test in this suite.
  assert.ok(VERGE_LIFT > ROAD_SURFACE_LIFT, 'VERGE_LIFT does not clear ROAD_SURFACE_LIFT at all')
  assert.ok(
    VERGE_LIFT - ROAD_SURFACE_LIFT > ROAD_SURFACE_LIFT,
    `VERGE_LIFT (${VERGE_LIFT}) is barely above ROAD_SURFACE_LIFT (${ROAD_SURFACE_LIFT}) — too small a step to read as a kerb`
  )
  const paving = of('base')
  assert.ok(paving.length > 0, 'no pavement tiles to check the lift of')
  for (const p of paving) assert.equal(p.lift, VERGE_LIFT, `pavement tile at ${p.x},${p.z} uses lift ${p.lift}`)
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
      const x = cx + d.x * step * 2 + lampSide * perp.x * step * 2
      const z = cz + d.z * step * 2 + lampSide * perp.z * step * 2
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

test('the traffic-light selection pool excludes the unreachable gantry variant', () => {
  // trafficlight_C's gantry arm reaches only 0.764 units (measured from city.glb) from a pole
  // that stands 3.6 units off the centre line, while the carriageway's own half-width is 1.2
  // and the pavement tile at the arm's outer step fills every offset from 1.2 to 3.6 with no
  // gap — so no pole placement can both keep the arm's tip over the carriageway and keep the
  // pole itself off the carriageway and clear of that pavement tile. A gantry hanging over
  // open verge would read as broken, so trafficlight_C is left out of the pool: only the two
  // pole-mounted variants are ever chosen.
  assert.deepEqual([...TRAFFIC_LIGHT_PARTS], ['trafficlight_A', 'trafficlight_B'])

  // Confirms the exclusion actually reaches the real network's output, not just the pool's
  // own declaration — every one of the 20 real furnished junctions must have picked from that
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
