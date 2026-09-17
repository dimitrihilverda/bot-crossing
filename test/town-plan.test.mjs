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
import { carriagewayTiles, ROAD_TILE_SIZE, roadTileScale, vergeFurniture, CARRIAGEWAY_WIDTH } from '../src/world/road-mesh.js'

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
  // BUILDING_CLEARANCE constant, so a regression back to the old, coincident-with-the-lamp
  // figure (1.8, i.e. BUILDING_CLEARANCE 0.6) is caught by an actual measurement rather than by
  // re-reading the same constant this test is meant to pin.
  const wallDistanceFromStreetCentre = CELL_SIZE - SET_BACK - BUILDING_SCALE
  assert.ok(
    Math.abs(wallDistanceFromStreetCentre - 1.85) < EPS,
    `the wall sits ${wallDistanceFromStreetCentre} from the street centre-line, expected 1.85`
  )
  const gapToAsphalt = wallDistanceFromStreetCentre - CARRIAGEWAY_WIDTH / 2
  assert.ok(
    Math.abs(gapToAsphalt - 0.65) < EPS,
    `the facade-to-asphalt gap is ${gapToAsphalt}, expected 0.65 — the streetlight standing at ` +
      `the kerb (see BUILDING_CLEARANCE's own doc comment), not the carriageway, is what stops ` +
      `this from closing all the way to the old 1.2-unit carriageway half-width`
  )
})

test('no building overlaps a streetlight or a traffic light, anywhere in the town', () => {
  // Measured from public/assets/city.glb, the same way town-mesh.test.mjs reads real vertex
  // counts off the same file (@gltf-transform/core's NodeIO): each part's own local footprint,
  // before its own placement scale — the streetlight's thin, off-centre mast (see
  // BUILDING_CLEARANCE's own doc comment) and the two pole-mounted traffic-light variants
  // (trafficlight_C, the gantry, is never placed — see road-mesh.js's own doc comment).
  const LOCAL_BBOX = {
    streetlight: {
      xmin: -0.2392103672027588,
      xmax: 0.030096590518951416,
      zmin: -0.034511469304561615,
      zmax: 0.0345110222697258,
    },
    trafficlight_A: {
      xmin: -0.13457560539245605,
      xmax: 0.0398561954498291,
      zmin: -0.03985767439007759,
      zmax: 0.11071021109819412,
    },
    trafficlight_B: {
      xmin: -0.2392103672027588,
      xmax: 0.0398561954498291,
      zmin: -0.03985767439007759,
      zmax: 0.11071021109819412,
    },
  }

  // The world-space axis-aligned box a piece of furniture actually occupies: its local bbox,
  // rotated by its own placement `ry` — always a multiple of pi/2 here, so the box stays
  // axis-aligned, the same rotation three.js's own `makeRotationY` applies (see road-mesh.js's
  // own doc comment on `vergeFurniture`, and the facing tests in road-verge.test.mjs, for the
  // same `(x, z) -> (x cosθ + z sinθ, -x sinθ + z cosθ)` mapping) — and scaled, then placed at
  // the furniture's own (x, z).
  function furnitureBounds(f) {
    const b = LOCAL_BBOX[f.part]
    const c = Math.cos(f.ry)
    const s = Math.sin(f.ry)
    const corners = [
      [b.xmin, b.zmin],
      [b.xmin, b.zmax],
      [b.xmax, b.zmin],
      [b.xmax, b.zmax],
    ]
    let xmin = Infinity
    let xmax = -Infinity
    let zmin = Infinity
    let zmax = -Infinity
    for (const [lx, lz] of corners) {
      const wx = (lx * c + lz * s) * f.scale
      const wz = (-lx * s + lz * c) * f.scale
      xmin = Math.min(xmin, wx)
      xmax = Math.max(xmax, wx)
      zmin = Math.min(zmin, wz)
      zmax = Math.max(zmax, wz)
    }
    return { xmin: f.x + xmin, xmax: f.x + xmax, zmin: f.z + zmin, zmax: f.z + zmax }
  }

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

  const furniture = vergeFurniture(streets.cells, CELL_SIZE).filter((f) => LOCAL_BBOX[f.part])
  assert.ok(furniture.length > 20, `only ${furniture.length} streetlights/traffic lights — too few to trust`)

  let checked = 0
  for (const b of buildings) {
    for (const f of furniture) {
      checked++
      const box = furnitureBounds(f)
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
