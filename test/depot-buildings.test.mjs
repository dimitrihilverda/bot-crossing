import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'
import {
  LOODS,
  LOODS_SPOT,
  OFFICE,
  OFFICE_SPOT,
  loodsBox,
  loodsPieces,
  officeBox,
  officePieces,
  signPlacement,
} from '../src/world/ship.js'
import { CELL_SIZE } from '../src/world/grid.js'

/**
 * The depot's two buildings: a brick office and the grey loods beside it. The owner's own
 * premises are that shape and no pack here sells either, so both are composed out of
 * Prototype Bits piece by piece.
 *
 * Which means the thing worth testing is the *composition*, not a constant. Every assertion
 * below is made against the pieces themselves — their real vertices, out of the built glb,
 * put through the same scale, yaw and offset `_buildFrom` gives them — so a piece moved,
 * dropped, stretched or turned the wrong way fails here rather than on screen.
 */
const doc = await new NodeIO().read('public/assets/prototype.glb')
const SCALE = 0.4 // PROTO_SCALE, which ship.js keeps to itself

/** Every part's authored vertices, straight out of the pack. The points rather than a box,
 *  because a wedge turned the wrong way has exactly the bounding box of one turned the right
 *  way and only its own points say which way it falls. */
const POINTS = new Map()
for (const node of doc.getRoot().listNodes()) {
  if (!node.getMesh()) continue
  const points = []
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    for (let i = 0; i < pos.getCount(); i++) points.push(pos.getElement(i, [0, 0, 0]))
  }
  POINTS.set(node.getName(), points)
}

/**
 * One piece's vertices in the depot's own frame: scale, then yaw, then offset —
 * `Composer.add`'s order — then the building's own scale and spot, the way `_buildFrom`
 * finishes.
 *
 * The yaw is applied to every point rather than assumed to be a right angle, so a piece
 * turned to some other angle is measured rather than mis-measured.
 */
function points(piece, spot) {
  const authored = POINTS.get(piece.part)
  assert.ok(authored, `${piece.part} is not in prototype.glb`)
  const s = [piece.sx ?? piece.s ?? 1, piece.sy ?? piece.s ?? 1, piece.sz ?? piece.s ?? 1]
  const ry = piece.ry ?? 0
  const cos = Math.cos(ry)
  const sin = Math.sin(ry)
  const off = [piece.x ?? 0, piece.y ?? 0, piece.z ?? 0]
  const at = [spot.x, spot.y, spot.z]
  return authored.map((a) => {
    const [x, y, z] = [a[0] * s[0], a[1] * s[1], a[2] * s[2]]
    // three's rotateY: x' = x cos + z sin, z' = -x sin + z cos.
    const p = [x * cos + z * sin, y, -x * sin + z * cos]
    return p.map((v, i) => (v + off[i]) * SCALE + at[i])
  })
}

/** The same piece as a box, which is what most of the checks below want. */
function placed(piece, spot) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const p of points(piece, spot)) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a])
      max[a] = Math.max(max[a], p[a])
    }
  }
  return { min, max }
}

/** The union of a building's pieces: what it actually occupies. */
function built(pieces, spot) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const piece of pieces) {
    const p = placed(piece, spot)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p.min[a])
      max[a] = Math.max(max[a], p.max[a])
    }
  }
  return { min, max }
}

const near = (a, b, tol = 0.01) => Math.abs(a - b) < tol

/** The two buildings, each with the box its own arithmetic claims. */
const BUILDINGS = [
  { name: 'office', pieces: officePieces(), spot: OFFICE_SPOT, box: officeBox(), shape: OFFICE },
  { name: 'loods', pieces: loodsPieces(), spot: LOODS_SPOT, box: loodsBox(), shape: LOODS },
]

/** Where the dock runs out from, and how wide its plate is — `_buildDock`'s own numbers. */
const DOCK = { frontZ: 1.6, width: 2.2, x: 0 }

test('every piece either building is made of is in the built kit', () => {
  // The curated list in `build-assets.mjs` is what decides this. Drop a piece from it and the
  // depot throws "no part named" at load, inside a promise, half built.
  for (const { name, pieces } of BUILDINGS) {
    for (const piece of pieces) {
      assert.ok(POINTS.has(piece.part), `the ${name} asks for ${piece.part}, which is not in prototype.glb`)
    }
  }
})

test('each building occupies exactly what its box says it does', () => {
  // `officeBox` and `loodsBox` are what the crew's navigation routes around, what the beacon
  // and the floodlights are placed from, and what the rest of this file measures against.
  // They are arithmetic on the constants; this is the real geometry. They have to agree.
  for (const { name, pieces, spot, box } of BUILDINGS) {
    const b = built(pieces, spot)
    assert.ok(near(b.min[0], box.minX), `${name} reaches x ${b.min[0].toFixed(2)}, its box says ${box.minX.toFixed(2)}`)
    assert.ok(near(b.max[0], box.maxX), `${name} reaches x ${b.max[0].toFixed(2)}, its box says ${box.maxX.toFixed(2)}`)
    assert.ok(near(b.min[2], box.minZ), `${name} reaches z ${b.min[2].toFixed(2)}, its box says ${box.minZ.toFixed(2)}`)
    assert.ok(near(b.max[2], box.maxZ), `${name} reaches z ${b.max[2].toFixed(2)}, its box says ${box.maxZ.toFixed(2)}`)
    assert.ok(near(b.max[1], box.ridgeY), `${name} stands ${b.max[1].toFixed(2)} tall, its box says ${box.ridgeY.toFixed(2)}`)
  }
})

test('the depot fits its own cell', () => {
  // It owns one 12-unit cell, so 6 either side of its anchor. A wall over that boundary is a
  // wall in the street cell's verge, among the lamps and the parked bicycles.
  for (const { name, pieces, spot } of BUILDINGS) {
    const b = built(pieces, spot)
    for (const [axis, label] of [
      [0, 'x'],
      [2, 'z'],
    ]) {
      assert.ok(
        b.min[axis] >= -CELL_SIZE / 2 - 1e-6 && b.max[axis] <= CELL_SIZE / 2 + 1e-6,
        `${name} spans ${label} ${b.min[axis].toFixed(2)}..${b.max[axis].toFixed(2)}, past the cell edge at ${CELL_SIZE / 2}`
      )
    }
  }
})

test('the two stand against each other, with no slot of daylight between them', () => {
  // They are meant to read as one premises, so their walls overlap rather than merely coming
  // close: the office's east wall and the loods' west wall share a centre line. A gap here is
  // a stripe of grass visible straight through the middle of the building.
  const office = built(officePieces(), OFFICE_SPOT)
  const loods = built(loodsPieces(), LOODS_SPOT)
  assert.ok(
    loods.min[0] < office.max[0] + 1e-6,
    `the loods starts at x ${loods.min[0].toFixed(2)} and the office ends at ${office.max[0].toFixed(2)} — that is a gap`
  )
  // ...and they overlap only where a roof tucks into a wall, not by a whole piece.
  const overlap = office.max[0] - loods.min[0]
  assert.ok(overlap <= OFFICE.eaveOut * SCALE + 1e-6, `they overlap by ${overlap.toFixed(2)}, more than one eave`)
})

test('the loods is the bigger building and the office the smaller one', () => {
  // The whole reason for the rebuild: the owner's loods dwarfs their office, and a city shell
  // in the middle of the cell read as the other way round.
  const office = built(officePieces(), OFFICE_SPOT)
  const loods = built(loodsPieces(), LOODS_SPOT)
  const area = (b) => (b.max[0] - b.min[0]) * (b.max[2] - b.min[2])
  assert.ok(area(loods) > area(office), `the loods covers ${area(loods).toFixed(1)}, the office ${area(office).toFixed(1)}`)
  assert.ok(loods.max[1] > office.max[1], `the loods is ${loods.max[1].toFixed(2)} tall, the office ${office.max[1].toFixed(2)}`)
})

test('neither building stands in front of the loading dock', () => {
  // +Z is where the dock is and where every crew member walks in and out. A wall across it
  // strands the crew inside the building they are meant to be walking out of. A roof over it
  // is allowed, and only a roof — an eave above a loading bay is a canopy.
  for (const { name, pieces, spot, shape } of BUILDINGS) {
    const walls = pieces.filter((p) => p.part !== 'Primitive_Slope')
    const front = Math.max(...walls.map((p) => placed(p, spot).max[2]))
    assert.ok(near(front, DOCK.frontZ), `the ${name}'s front wall is at ${front.toFixed(2)}, not on the dock line at ${DOCK.frontZ}`)

    const roof = built(pieces, spot).max[2]
    assert.ok(
      roof <= DOCK.frontZ + shape.eaveOut * SCALE + 1e-6,
      `the ${name}'s roof reaches ${roof.toFixed(2)}, further over the dock than its own eave`
    )
  }
})

test("the loods' big door lands on the dock plate", () => {
  // The dock, the point crew appear at and the cars' arrival are all fixed on the depot's
  // anchor; the door is the one thing that moved to meet them. Off by a module and the crew
  // walk out through a wall.
  const door = loodsPieces().find((p) => p.part === 'Primitive_Wall' && p.sy !== undefined)
  assert.ok(door, 'the loods has no door leaf')
  const b = placed(door, LOODS_SPOT)
  const centre = (b.min[0] + b.max[0]) / 2
  assert.ok(near(centre, DOCK.x), `the door is centred at x ${centre.toFixed(2)}, the dock at ${DOCK.x}`)
  assert.ok(
    b.min[0] <= DOCK.x - DOCK.width / 2 + 1e-6 && b.max[0] >= DOCK.x + DOCK.width / 2 - 1e-6,
    `the door spans ${b.min[0].toFixed(2)}..${b.max[0].toFixed(2)}, narrower than the ${DOCK.width}-wide dock plate`
  )
  assert.ok(near(b.min[1], LOODS_SPOT.y), 'the door does not reach the ground')
})

test('every wall is closed, at every height, all the way to both corners', () => {
  // This is what the pack is for: each side's length is a whole number of modules, so the
  // pieces filling it add up to it exactly. But *spanning* a side is not covering it — drop
  // the middle piece of a wall and the two ends still reach both corners — so the coverage is
  // walked at a set of heights instead. Anything missed is a hole straight into the building.
  for (const { name, pieces, spot, shape } of BUILDINGS) {
    const eaves = (shape.wall + (shape.clad ?? 0)) * SCALE + spot.y

    for (const [label, pick, axis, half] of [
      ['front', (p) => p.z === shape.halfZ, 0, shape.halfX],
      ['back', (p) => p.z === -shape.halfZ, 0, shape.halfX],
      ['east side', (p) => p.x === shape.halfX, 2, shape.halfZ],
      ['west side', (p) => p.x === -shape.halfX, 2, shape.halfZ],
    ]) {
      const face = pieces.filter(pick).map((p) => placed(p, spot))
      assert.ok(face.length, `the ${name} has no ${label} at all`)
      const from = spot[axis === 0 ? 'x' : 'z'] - half * SCALE
      const to = spot[axis === 0 ? 'x' : 'z'] + half * SCALE

      // Every course this face is built in, sampled between the ground and the eaves.
      for (let h = spot.y + 0.2; h < eaves; h += 0.4) {
        const spans = face
          .filter((b) => b.min[1] <= h && b.max[1] >= h)
          .map((b) => [b.min[axis], b.max[axis]])
          .sort((a, b) => a[0] - b[0])
        assert.ok(spans.length, `the ${name}'s ${label} has nothing at all at height ${h.toFixed(1)}`)

        let reached = spans[0][0]
        assert.ok(reached <= from + 1e-6, `the ${name}'s ${label} starts at ${reached.toFixed(2)}, short of the corner at ${from.toFixed(2)}`)
        for (const [a, b] of spans) {
          assert.ok(a <= reached + 1e-6, `the ${name}'s ${label} has a hole at ${reached.toFixed(2)}..${a.toFixed(2)}, height ${h.toFixed(1)}`)
          reached = Math.max(reached, b)
        }
        assert.ok(reached >= to - 1e-6, `the ${name}'s ${label} stops at ${reached.toFixed(2)}, short of the corner at ${to.toFixed(2)}`)
      }
    }

    // And the windows are whole modules rather than one stretched stand-in.
    const windows = pieces.filter((p) => p.part === 'Primitive_Window')
    assert.equal(windows.length, 3, `the ${name} should carry three window modules`)
    for (const w of windows) assert.equal(w.sx ?? 1, 1, `a ${name} window is stretched`)
  }
})

test('each roof lands on the walls it stands on, and falls away from its own ridge', () => {
  // A roof that starts above the wall top leaves a strip of daylight all the way round; one
  // that stops short of the gable leaves a hole into the building. Both are invisible in a
  // still and obvious the moment the camera moves.
  //
  // The office's ridge runs along z and the loods' along x, which is the difference between a
  // gable facing the street and an eaves side facing it. A wedge turned the wrong way has
  // exactly the bounding box of one turned the right way, so the fall is measured off the
  // pieces' own points.
  for (const { name, pieces, spot, box } of BUILDINGS) {
    const roof = pieces.filter((p) => p.part === 'Primitive_Slope')
    assert.equal(roof.length, 2, `the ${name}'s roof is two wedges meeting over the middle`)

    // Which way this roof falls: the axis the two wedges are separated along.
    const boxes = roof.map((p) => placed(p, spot))
    const axis = Math.abs(boxes[0].min[0] - boxes[1].min[0]) > Math.abs(boxes[0].min[2] - boxes[1].min[2]) ? 0 : 2
    assert.equal(axis, name === 'office' ? 0 : 2, `the ${name}'s roof falls along the wrong axis`)

    // The axis the ridge itself runs along — the one the wedges are *not* separated on.
    const along = 2 - axis
    const ends = along === 0 ? [box.minX, box.maxX] : [box.minZ, box.maxZ]
    for (const wedge of roof) {
      const b = placed(wedge, spot)
      assert.ok(near(b.min[1], box.eaveY), `a ${name} wedge sits at ${b.min[1].toFixed(2)}, not on the eaves at ${box.eaveY.toFixed(2)}`)
      assert.ok(near(b.max[1], box.ridgeY), `a ${name} wedge reaches ${b.max[1].toFixed(2)}, not the ridge at ${box.ridgeY.toFixed(2)}`)
      // ...and runs the full length of the ridge. A wedge that stops short of a gable leaves
      // a triangle of daylight into the roof space, at the one end nobody photographs.
      assert.ok(
        near(b.min[along], ends[0]) && near(b.max[along], ends[1]),
        `a ${name} wedge runs ${b.min[along].toFixed(2)}..${b.max[along].toFixed(2)} of ${ends[0].toFixed(2)}..${ends[1].toFixed(2)}`
      )
    }

    // The two meet over the middle rather than overlapping into a thicker ridge or leaving a
    // slot along the top of the building.
    const [a, b] = boxes
    const gap = Math.max(a.min[axis], b.min[axis]) - Math.min(a.max[axis], b.max[axis])
    assert.ok(near(gap, 0), `the ${name}'s wedges meet with a gap of ${gap.toFixed(3)}`)

    // And each falls away from that meeting point. A wedge is solid, so its underside runs the
    // whole way at eaves height either way round — it is the top at each end that says which
    // way it falls.
    const middle = (Math.max(a.min[axis], b.min[axis]) + Math.min(a.max[axis], b.max[axis])) / 2
    for (const wedge of roof) {
      const ps = points(wedge, spot)
      const topAt = (v) => Math.max(...ps.filter((p) => near(p[axis], v, 0.05)).map((p) => p[1]))
      const own = placed(wedge, spot)
      const outer = Math.abs(own.min[axis] - middle) > Math.abs(own.max[axis] - middle) ? own.min[axis] : own.max[axis]
      assert.ok(
        near(topAt(middle), box.ridgeY),
        `a ${name} wedge is ${topAt(middle).toFixed(2)} tall at the ridge, not ${box.ridgeY.toFixed(2)} — it falls the wrong way`
      )
      assert.ok(
        near(topAt(outer), box.eaveY),
        `a ${name} wedge is ${topAt(outer).toFixed(2)} tall at its eave, not ${box.eaveY.toFixed(2)} — it falls the wrong way`
      )
    }
  }
})

test('the sign sits on the band over the big door', () => {
  // The wordmark is drawn to a canvas, which node has no way to run — but everything about
  // *where* it goes is arithmetic on the door, and that is the part that can be wrong in a
  // way nobody notices: a sign a module off centre still looks like a sign.
  const at = signPlacement()
  const door = loodsPieces().find((p) => p.part === 'Primitive_Wall' && p.sy !== undefined)
  const leaf = placed(door, LOODS_SPOT)

  assert.ok(near(at.x, (leaf.min[0] + leaf.max[0]) / 2), `the sign is at x ${at.x}, the door at ${((leaf.min[0] + leaf.max[0]) / 2).toFixed(2)}`)
  assert.ok(at.maxWidth <= leaf.max[0] - leaf.min[0] + 1e-6, `the sign may run ${at.maxWidth.toFixed(2)} wide on a ${(leaf.max[0] - leaf.min[0]).toFixed(2)} door`)

  // Between the head of the door and the eaves — which is exactly the lintel band, the one
  // piece of the building already painted in the depot's colour.
  const head = leaf.max[1]
  const eaves = loodsBox().eaveY
  assert.ok(
    at.y - at.maxHeight / 2 >= head - 1e-6 && at.y + at.maxHeight / 2 <= eaves + 1e-6,
    `the sign spans y ${(at.y - at.maxHeight / 2).toFixed(2)}..${(at.y + at.maxHeight / 2).toFixed(2)}, off the band at ${head.toFixed(2)}..${eaves.toFixed(2)}`
  )
})

test('the sign stands off the wall, and stays under the roof that shelters it', () => {
  // Flat against the wall it z-fights the band; past the eaves it is a sign in the rain with
  // its own shadow on the building. It belongs in the gap between the two.
  const at = signPlacement()
  const wall = Math.max(
    ...loodsPieces()
      .filter((p) => p.part !== 'Primitive_Slope')
      .map((p) => placed(p, LOODS_SPOT).max[2])
  )
  assert.ok(at.z > wall + 1e-6, `the sign is at z ${at.z}, flat against the wall at ${wall.toFixed(2)}`)
  assert.ok(at.z < loodsBox().maxZ, `the sign is at z ${at.z}, out past the roof's overhang at ${loodsBox().maxZ.toFixed(2)}`)
})

test('nothing is left buried in the ground or hanging over it', () => {
  // Both buildings are set into the ground by a fixed amount, which is a deliberate 0.1 and
  // not a piece that happens to have been placed low.
  for (const { name, pieces, spot } of BUILDINGS) {
    for (const piece of pieces) {
      const b = placed(piece, spot)
      assert.ok(b.min[1] >= spot.y - 1e-6, `${name}: ${piece.part} starts at ${b.min[1].toFixed(2)}, below its own floor`)
    }
    assert.ok(spot.y < 0, `the ${name} is meant to sit into the ground, not on it`)
    assert.ok(spot.y > -0.3, `the ${name} is sunk by ${-spot.y}, which is a building with a step down into it`)
  }
})
