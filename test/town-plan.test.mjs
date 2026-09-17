import test from 'node:test'
import assert from 'node:assert/strict'
import {
  inTown,
  townRadiusAt,
  blockContent,
  BUILDING_PARTS,
  SET_BACK,
  SLOT_PITCH,
  BUILDING_SCALE,
} from '../src/world/town-plan.js'
import { planStreets } from '../src/world/streets.js'
import { TOWN_CELL_RADIUS } from '../src/world/street-plan.js'
import { CELL_SIZE, key } from '../src/world/grid.js'
import {
  carriagewayTiles,
  ROAD_TILE_SIZE,
  roadTileScale,
  vergeFurniture,
  CARRIAGEWAY_WIDTH,
  furnitureWorldBounds,
} from '../src/world/road-mesh.js'

const EPS = 1e-6

const streets = planStreets()

test('the town outline is not a circle', () => {
  let lo = Infinity
  let hi = -Infinity
  for (let i = 0; i < 64; i++) {
    const r = townRadiusAt((i / 64) * Math.PI * 2)
    lo = Math.min(lo, r)
    hi = Math.max(hi, r)
  }
  assert.ok(hi - lo >= 1.5, `the outline varies by only ${(hi - lo).toFixed(2)} cells`)
  assert.ok(hi <= TOWN_CELL_RADIUS, `the outline reaches ${hi.toFixed(2)}, past the street network`)
})

test('the centre is always in town', () => {
  assert.equal(inTown({ x: 0, z: 0 }), true)
})

test('block content depends on its own position and nothing else', () => {
  // The same cell, asked twice, with two different street sets around the rest of the world:
  // the real network, and a copy that is identical at this cell's four neighbours but has
  // several far-away cells toggled. A block's content may only look at its own position and
  // its own neighbours, so the result must come back unchanged either way.
  const cell = { x: 3, z: 2 }
  const altered = new Set(streets.all)
  for (const [fx, fz] of [[100, 100], [-100, 100], [100, -100], [-100, -100], [250, 0]]) {
    // None of these is a neighbour of `cell` — they sit far outside the town entirely.
    if (altered.has(key(fx, fz))) altered.delete(key(fx, fz))
    else altered.add(key(fx, fz))
  }

  const a = blockContent(cell, streets.all)
  const b = blockContent(cell, altered)
  assert.deepEqual(a, b)
})

test('a built block puts buildings on the sides that face a street', () => {
  // Every built cell in the town, not a handful of hand-picked ones: a row's outermost slot
  // sits exactly on the cell's own corner (its lateral offset happens to equal `SET_BACK` too
  // — see `SLOT_OFFSETS`), so for that one slot the set-back axis is genuinely ambiguous
  // between its own side and the adjacent one. Sweeping every built cell means the (many)
  // unambiguous buildings — every slot but the outermost — still pin the check tight, so an
  // across-the-board defect ("every side", "the opposite side") cannot hide behind the
  // corner's ambiguity.
  let checked = 0
  let buildingsChecked = 0
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const cell = { x, z }
      if (!inTown(cell) || streets.all.has(`${x},${z}`)) continue
      const content = blockContent(cell, streets.all)
      if (content.kind !== 'built') continue
      checked++
      for (const b of content.buildings) {
        assert.ok(BUILDING_PARTS.includes(b.part), `unknown part ${b.part}`)
        const offX = b.x - cell.x * CELL_SIZE
        const offZ = b.z - cell.z * CELL_SIZE
        // A building no longer has to lie inside its own cell — see `SET_BACK`'s own doc
        // comment in town-plan.js: it now reaches into the neighbouring street cell's own
        // outer verge, on purpose, to stand at the kerb rather than at the block's own
        // boundary. The invariant that actually matters (no overlap with the footway, the
        // carriageway, or another building) is checked directly, against the real street and
        // pavement data, by the next test below.
        // The axis (or, only at an outermost slot, both axes) carrying `SET_BACK` pins which
        // side (or sides) of the cell the building could front; the other axis is the row's
        // lateral position along the frontage and is not itself diagnostic.
        const isSetBack = (v) => Math.abs(Math.abs(v) - SET_BACK) < EPS
        const xIsSetBack = isSetBack(offX)
        const zIsSetBack = isSetBack(offZ)
        assert.ok(
          xIsSetBack || zIsSetBack,
          `building offset (${offX}, ${offZ}) carries the row's set-back on neither axis`
        )
        const candidates = []
        if (xIsSetBack) candidates.push({ x: Math.sign(offX), z: 0 })
        if (zIsSetBack) candidates.push({ x: 0, z: Math.sign(offZ) })
        assert.ok(
          candidates.some((d) => streets.all.has(key(cell.x + d.x, cell.z + d.z))),
          `building at (${b.x}, ${b.z}) does not face a street cell`
        )
        buildingsChecked++
      }
    }
  }
  assert.ok(checked >= 1, 'no built block found in the whole town')
  assert.ok(buildingsChecked >= 30, `only ${buildingsChecked} buildings checked — too few to trust`)
})

// A building's `ry` is exact and unambiguous — `Math.atan2(d.x, d.z)` for one of the four
// canonical `d`s — even at an outermost slot, where the set-back axis alone cannot say which
// of two sides a building belongs to (see the previous test's own comment). Used below to
// group a cell's buildings by the side they front, and to recover each one's lateral position
// along that row.
function sideOfRy(ry) {
  if (Math.abs(ry - Math.PI / 2) < EPS) return { x: 1, z: 0 }
  if (Math.abs(ry + Math.PI / 2) < EPS) return { x: -1, z: 0 }
  if (Math.abs(ry) < EPS) return { x: 0, z: 1 }
  if (Math.abs(Math.abs(ry) - Math.PI) < EPS) return { x: 0, z: -1 }
  throw new Error(`ry ${ry} is not one of the four canonical rotations`)
}

// The lateral offset (along the row's own axis, `perp` in `town-plan.js`) a building sits at,
// recovered from its world offset and the side `d` it fronts.
function lateralOffset(d, offX, offZ) {
  return d.x !== 0 ? -offZ * d.x : offX * d.z
}

test('a built frontage is a terrace: several adjacent buildings, and a real terrace shape', () => {
  let cellsChecked = 0
  let buildingsChecked = 0
  let longestRun = 1

  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const cell = { x, z }
      if (!inTown(cell) || streets.all.has(`${x},${z}`)) continue
      const content = blockContent(cell, streets.all)
      if (content.kind !== 'built' || content.buildings.length === 0) continue
      cellsChecked++
      buildingsChecked += content.buildings.length

      // Group by side, then look for a run of slots exactly `SLOT_PITCH` apart — adjacent,
      // touching buildings, the signature of a terrace rather than the old one-per-side
      // layout or a row of buildings merely scattered along the same frontage.
      const bySide = new Map()
      for (const b of content.buildings) {
        const d = sideOfRy(b.ry)
        const k = `${d.x},${d.z}`
        const offX = b.x - cell.x * CELL_SIZE
        const offZ = b.z - cell.z * CELL_SIZE
        if (!bySide.has(k)) bySide.set(k, [])
        bySide.get(k).push(lateralOffset(d, offX, offZ))
      }
      for (const positions of bySide.values()) {
        positions.sort((a, b) => a - b)
        let run = 1
        for (let i = 1; i < positions.length; i++) {
          run = Math.abs(positions[i] - positions[i - 1] - SLOT_PITCH) < EPS ? run + 1 : 1
          longestRun = Math.max(longestRun, run)
        }
      }
    }
  }

  assert.ok(cellsChecked >= 1, 'no built block found in the whole town')
  assert.ok(buildingsChecked >= 30, `only ${buildingsChecked} buildings checked — too few to trust`)
  assert.ok(
    longestRun >= 3,
    `no frontage anywhere in the town has 3 adjacent buildings (longest run found: ${longestRun})`
  )
})

// ── the withdrawn invariant's replacement: SET_BACK now deliberately reaches past a
// building's own cell boundary (see SET_BACK's own doc comment), so "inside its own cell" is
// no longer a real rule. What must still hold — checked here against the real street network
// and the real carriageway data road-mesh.js produces for it, town-wide, not just within a
// single cell — is that no building overlaps the carriageway or another building. There is no
// footway any more to check against (the playful revision removes it entirely). ──────────────

test('no building overlaps the carriageway or another building, anywhere in the town', () => {
  const half = BUILDING_SCALE
  const tileHalf = (ROAD_TILE_SIZE * roadTileScale()) / 2
  const overlap1D = (c1, h1, c2, h2) => Math.abs(c1 - c2) < h1 + h2 - EPS
  const overlapSquare = (x1, z1, h1, x2, z2, h2) =>
    overlap1D(x1, h1, x2, h2) && overlap1D(z1, h1, z2, h2)

  const buildings = []
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const cell = { x, z }
      if (!inTown(cell) || streets.all.has(`${x},${z}`)) continue
      const content = blockContent(cell, streets.all)
      if (content.kind !== 'built') continue
      buildings.push(...content.buildings)
    }
  }
  assert.ok(buildings.length >= 30, `only ${buildings.length} buildings — too few to trust`)

  const carriageway = carriagewayTiles(streets.cells, CELL_SIZE)

  for (const b of buildings) {
    for (const t of carriageway) {
      assert.ok(
        !overlapSquare(b.x, b.z, half, t.x, t.z, tileHalf),
        `building at (${b.x},${b.z}) overlaps a carriageway tile at (${t.x},${t.z})`
      )
    }
  }

  // Every building against every other, town-wide — not just within one cell, since the
  // collision `blockContent`'s "Corners, across two cells" doc comment describes is between
  // two different cells' rows, both reaching into the same street cell's outer verge. This is
  // the invariant `CORNER_SKIP_COUNT` exists to protect: with `SET_BACK` brought all the way to
  // the kerb line, skipping only the single outermost slot at each risky corner (the old rule)
  // is no longer enough — two real buildings in this exact network once overlapped by 0.6
  // units on both axes before that constant existed. Proven below by reverting it.
  for (let i = 0; i < buildings.length; i++) {
    for (let j = i + 1; j < buildings.length; j++) {
      const a = buildings[i]
      const c = buildings[j]
      assert.ok(
        !overlapSquare(a.x, a.z, half, c.x, c.z, half),
        `buildings overlap: (${a.x},${a.z}) and (${c.x},${c.z})`
      )
    }
  }
})

// ── the facade revision: closing the gap between the wall and the asphalt as far as the
// streetlights standing at the kerb actually allow (see BUILDING_CLEARANCE's and SET_BACK's
// own doc comments in town-plan.js for the full arithmetic) ────────────────────────────────

test('the wall sits the new, closer distance from the street centre-line, with a real gap to the asphalt', () => {
  // Recomputed here from SET_BACK and BUILDING_SCALE, independent of town-plan.js's own
  // BUILDING_CLEARANCE constant, so a regression back to an old, wider figure (1.8/0.6 from the
  // tighten and facade revisions, or 1.85/0.65 from the facade revision) is caught by an actual
  // measurement rather than by re-reading the same constant this test is meant to pin.
  //
  // The flush revision closes this all the way to the carriageway's own edge: the furniture
  // that used to force a wide margin here (a streetlight standing at the kerb, or a junction's
  // own crossing and traffic light) is now handled by reserving its own slot in the terrace
  // instead (see reservedSlots in town-plan.js), so the wall itself only needs a small,
  // z-fighting-avoiding margin past the carriageway, not a whole lamp-post's worth of clearance.
  const wallDistanceFromStreetCentre = CELL_SIZE - SET_BACK - BUILDING_SCALE
  assert.ok(
    Math.abs(wallDistanceFromStreetCentre - 1.25) < EPS,
    `the wall sits ${wallDistanceFromStreetCentre} from the street centre-line, expected 1.25`
  )
  const gapToAsphalt = wallDistanceFromStreetCentre - CARRIAGEWAY_WIDTH / 2
  assert.ok(
    Math.abs(gapToAsphalt - 0.05) < EPS,
    `the facade-to-asphalt gap is ${gapToAsphalt}, expected 0.05 — a small margin against ` +
      `z-fighting, not a strip of grass; furniture along the frontage now gets its own slot ` +
      `reserved instead of pushing the whole row back (see reservedSlots in town-plan.js)`
  )
})

test('no building overlaps a streetlight, a traffic light or a crossing, anywhere in the town', () => {
  // `furnitureWorldBounds` (road-mesh.js) is the one source of truth for a piece of verge
  // furniture's real, rotated, scaled world footprint — the same function `reservedSlots`
  // (town-plan.js) uses to decide which slot to leave empty in the first place, so this test
  // checks the production reservation logic against an independent sweep of the real output
  // rather than a copy of its own bbox table. It covers every part `cellFurniture` can place
  // that carries a footprint (streetlight, trafficlight_A/B, road_straight_crossing —
  // trafficlight_C is never placed, see road-mesh.js's own doc comment), not only the two this
  // test used to cover: the flush revision brings the wall close enough to the carriageway that
  // a crossing, sitting right at a junction's own kerb, is now a genuine risk too.
  const half = BUILDING_SCALE
  const buildings = []
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const cell = { x, z }
      if (!inTown(cell) || streets.all.has(`${x},${z}`)) continue
      const content = blockContent(cell, streets.all)
      if (content.kind !== 'built') continue
      buildings.push(...content.buildings)
    }
  }
  assert.ok(buildings.length >= 30, `only ${buildings.length} buildings — too few to trust`)

  const furniture = vergeFurniture(streets.cells, CELL_SIZE).filter((f) => furnitureWorldBounds(f))
  assert.ok(furniture.length > 20, `only ${furniture.length} lamps/lights/crossings — too few to trust`)

  let checked = 0
  for (const b of buildings) {
    for (const f of furniture) {
      checked++
      const box = furnitureWorldBounds(f)
      const overlaps =
        b.x - half < box.xmax - EPS &&
        b.x + half > box.xmin + EPS &&
        b.z - half < box.zmax - EPS &&
        b.z + half > box.zmin + EPS
      assert.ok(!overlaps, `building at (${b.x},${b.z}) overlaps ${f.part} at (${f.x},${f.z})`)
    }
  }
  assert.ok(checked > 1000, `only checked ${checked} building/furniture pairs — too few to trust`)
})

test('some blocks are green', () => {
  let green = 0
  let built = 0
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const cell = { x, z }
      if (!inTown(cell) || streets.all.has(`${x},${z}`)) continue
      if (blockContent(cell, streets.all).kind === 'green') green++
      else built++
    }
  }
  assert.ok(green > 0 && built > 0, `green=${green} built=${built}`)
  assert.ok(green / (green + built) > 0.15, 'almost nothing is green')
  assert.ok(green / (green + built) < 0.6, 'almost nothing is built')
})
