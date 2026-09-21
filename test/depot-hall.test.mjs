import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'
import { HALL, HALL_SCALE, HALL_SPOT, hallBox, hallPieces } from '../src/world/ship.js'
import { CELL_SIZE } from '../src/world/grid.js'

/**
 * The hall beside the depot's office: the owner's own building has one, no pack here sells
 * one, so it is composed out of Prototype Bits piece by piece.
 *
 * Which means the thing worth testing is the *composition*, not a constant. Every assertion
 * below is made against the pieces themselves — their real bounding boxes, out of the built
 * glb, put through the same scale, yaw and offset `_buildHall` gives them — so a piece moved,
 * dropped, stretched or turned the wrong way fails here rather than on screen.
 */
const doc = await new NodeIO().read('public/assets/prototype.glb')

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
 * One piece's box in the depot's own frame: scale, then yaw, then offset — `Composer.add`'s
 * order — then the hall's own scale and spot, the way `_buildHall` finishes.
 *
 * The yaw is applied to all eight corners rather than assumed to be a right angle, so a piece
 * turned to some other angle is measured rather than mis-measured.
 */
function points(piece) {
  const authored = POINTS.get(piece.part)
  assert.ok(authored, `${piece.part} is not in prototype.glb`)
  const s = [piece.sx ?? piece.s ?? 1, piece.sy ?? piece.s ?? 1, piece.sz ?? piece.s ?? 1]
  const ry = piece.ry ?? 0
  const cos = Math.cos(ry)
  const sin = Math.sin(ry)
  const off = [piece.x ?? 0, piece.y ?? 0, piece.z ?? 0]
  const spot = [HALL_SPOT.x, HALL_SPOT.y, HALL_SPOT.z]
  return authored.map((a) => {
    const [x, y, z] = [a[0] * s[0], a[1] * s[1], a[2] * s[2]]
    // three's rotateY: x' = x cos + z sin, z' = -x sin + z cos.
    const p = [x * cos + z * sin, y, -x * sin + z * cos]
    return p.map((v, i) => (v + off[i]) * HALL_SCALE + spot[i])
  })
}

/** The same piece as a box, which is what most of the checks below want. */
function placed(piece) {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const p of points(piece)) {
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p[a])
      max[a] = Math.max(max[a], p[a])
    }
  }
  return { min, max }
}

/** The union of every piece: what the hall actually occupies. */
function built() {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const piece of hallPieces()) {
    const p = placed(piece)
    for (let a = 0; a < 3; a++) {
      min[a] = Math.min(min[a], p.min[a])
      max[a] = Math.max(max[a], p.max[a])
    }
  }
  return { min, max }
}

/** The office, from the same numbers `ship.js` places the hall against:
 *  `SHELL_BOUNDS` through `DEPOT_SCALE`. */
const OFFICE = { west: -2.0, back: -1.3, front: 1.6, width: 4.0, height: 4.5 }
const near = (a, b, tol = 0.01) => Math.abs(a - b) < tol

test('every piece the hall is made of is in the built kit', () => {
  // The curated list in `build-assets.mjs` is what decides this. Drop a piece from it and the
  // hall throws "no part named" at load, inside a promise, with the depot half built.
  for (const piece of hallPieces()) {
    assert.ok(POINTS.has(piece.part), `the hall asks for ${piece.part}, which is not in prototype.glb`)
  }
})

test('the hall occupies exactly what hallBox says it does', () => {
  // `hallBox` is what the crew's navigation routes around, and what the rest of this file
  // measures against. It is arithmetic on the constants; this is the real geometry. They have
  // to agree, or the crew walks around a building that is not where the maths put it.
  const b = built()
  const box = hallBox()
  assert.ok(near(b.min[0], box.minX), `hall reaches x ${b.min[0].toFixed(2)}, hallBox says ${box.minX.toFixed(2)}`)
  assert.ok(near(b.max[0], box.maxX), `hall reaches x ${b.max[0].toFixed(2)}, hallBox says ${box.maxX.toFixed(2)}`)
  assert.ok(near(b.min[2], box.minZ), `hall reaches z ${b.min[2].toFixed(2)}, hallBox says ${box.minZ.toFixed(2)}`)
  assert.ok(near(b.max[2], box.maxZ), `hall reaches z ${b.max[2].toFixed(2)}, hallBox says ${box.maxZ.toFixed(2)}`)
  assert.ok(near(b.max[1], box.ridgeY), `hall stands ${b.max[1].toFixed(2)} tall, hallBox says ${box.ridgeY.toFixed(2)}`)
})

test('the hall fits the depot cell', () => {
  // The depot owns one 12-unit cell, so 6 either side of its anchor. A wall over that boundary
  // is a wall in the street cell's verge, among the lamps and the parked bicycles.
  const west = built().min[0]
  assert.ok(west >= -CELL_SIZE / 2 - 1e-6, `the hall reaches ${west.toFixed(2)}, past the cell edge at ${-CELL_SIZE / 2}`)
})

test('the hall stands against the office, with only its eaves over the line', () => {
  // Flush, not merely near: the hall's east wall face lands on the office's west face, which
  // is what stops a slot of daylight opening between two buildings meant to read as one. Only
  // the roof crosses, by its overhang, and it crosses into a solid wall.
  const walls = hallPieces().filter((p) => p.part !== 'Primitive_Slope')
  const wallFace = Math.max(...walls.map((p) => placed(p).max[0]))
  assert.ok(near(wallFace, OFFICE.west), `the hall's wall stops at ${wallFace.toFixed(2)}, not on the office at ${OFFICE.west}`)

  const overhang = HALL.eaveOut * HALL_SCALE
  const roof = built().max[0]
  assert.ok(
    roof <= OFFICE.west + overhang + 1e-6,
    `the roof reaches ${roof.toFixed(2)}, further into the office than its ${overhang.toFixed(2)} overhang`
  )
})

test('the hall keeps clear of the loading dock', () => {
  // +Z is where the dock is and where every crew member walks in and out. The hall may stand
  // beside the office; it may not stand in front of it — roof included, which is the part that
  // reaches furthest and the part nobody remembers to check.
  const front = built().max[2]
  assert.ok(front <= OFFICE.front + 1e-6, `the hall's front is at ${front.toFixed(2)}, ahead of the dock at ${OFFICE.front}`)
})

test('the hall reads as the larger building, and the office as the taller one', () => {
  // The whole reason for building it: the owner's hall dwarfs their office in plan and sits
  // well under it in height. A hall that outgrows the office vertically is a second office.
  const b = built()
  const footprint = (b.max[0] - b.min[0]) * (b.max[2] - b.min[2])
  const office = (OFFICE.front - OFFICE.back) * OFFICE.width
  assert.ok(footprint > office, `the hall covers ${footprint.toFixed(1)}, the office ${office.toFixed(1)}`)
  assert.ok(b.max[1] < OFFICE.height, `the hall stands ${b.max[1].toFixed(2)} against the office's ${OFFICE.height}`)
})

test('each side is covered by whole pieces, with no gap and none hanging off the end', () => {
  // This is what the pack is for. Every side's length is a whole number of modules, so the
  // pieces filling it add up to it exactly — three window modules down the street side, a wall
  // and a door across the front. A piece the wrong width shows as a hole in the wall.
  const brick = hallPieces().filter((p) => (p.y ?? 0) === 0)
  const span = (pick, axis) => {
    const boxes = brick.filter(pick).map(placed)
    assert.ok(boxes.length, 'no pieces matched')
    return Math.max(...boxes.map((b) => b.max[axis])) - Math.min(...boxes.map((b) => b.min[axis]))
  }
  const long = HALL.halfZ * 2 * HALL_SCALE
  const short = HALL.halfX * 2 * HALL_SCALE

  const windows = span((p) => p.part === 'Primitive_Window', 2)
  assert.ok(near(windows, long), `the windows span ${windows.toFixed(2)} of a ${long.toFixed(2)} side`)

  const front = span((p) => p.z === HALL.halfZ, 0)
  assert.ok(near(front, short), `the front spans ${front.toFixed(2)} of a ${short.toFixed(2)} wall`)

  // And the long walls reach both corners rather than stopping one module short.
  const office = span((p) => p.x === HALL.halfX, 2)
  assert.ok(near(office, long), `the office-side wall is ${office.toFixed(2)} deep, not ${long.toFixed(2)}`)
})

test('the roof lands on the walls it stands on, and covers both of them', () => {
  // A roof that starts above the wall top leaves a strip of daylight all the way round; one
  // that stops short of the gable leaves a hole into the building. Both are invisible in a
  // still and obvious the moment the camera moves.
  const roof = hallPieces().filter((p) => p.part === 'Primitive_Slope')
  assert.equal(roof.length, 2, 'the roof is two wedges meeting over the middle')
  const box = hallBox()
  for (const wedge of roof) {
    const b = placed(wedge)
    assert.ok(near(b.min[1], box.eaveY), `a wedge sits at ${b.min[1].toFixed(2)}, not on the eaves at ${box.eaveY.toFixed(2)}`)
    assert.ok(near(b.max[1], box.ridgeY), `a wedge reaches ${b.max[1].toFixed(2)}, not the ridge at ${box.ridgeY.toFixed(2)}`)
    assert.ok(
      near(b.min[2], box.minZ) && near(b.max[2], box.maxZ),
      `a wedge covers z ${b.min[2].toFixed(2)}..${b.max[2].toFixed(2)} of ${box.minZ.toFixed(2)}..${box.maxZ.toFixed(2)}`
    )
  }
  // The two of them meet over the middle, rather than overlapping into a thicker ridge or
  // leaving a slot along the top of the building.
  const [a, b] = roof.map(placed)
  const gap = Math.max(a.min[0], b.min[0]) - Math.min(a.max[0], b.max[0])
  assert.ok(near(gap, 0), `the wedges meet with a gap of ${gap.toFixed(3)}`)

  // And each one falls away from that meeting point. Turning one of them the wrong way leaves
  // the bounding box untouched and the roof as a step with a valley down the middle, which no
  // measurement of extents can see.
  const middle = (Math.min(a.max[0], b.max[0]) + Math.max(a.min[0], b.min[0])) / 2
  for (const wedge of roof) {
    const ps = points(wedge)
    // How high the wedge reaches at each of its two ends. A wedge is a solid, so its underside
    // runs the whole way at eaves height either way round — it is the *top* at each end that
    // says which way it falls.
    const topAt = (x) => Math.max(...ps.filter((p) => near(p[0], x, 0.05)).map((p) => p[1]))
    const span = placed(wedge)
    const outer = Math.abs(span.min[0] - middle) > Math.abs(span.max[0] - middle) ? span.min[0] : span.max[0]
    assert.ok(near(topAt(middle), box.ridgeY), `a wedge is ${topAt(middle).toFixed(2)} tall at the ridge, not ${box.ridgeY.toFixed(2)} — it falls the wrong way`)
    assert.ok(near(topAt(outer), box.eaveY), `a wedge is ${topAt(outer).toFixed(2)} tall at its eave, not ${box.eaveY.toFixed(2)} — it falls the wrong way`)
  }
})

test('nothing is left buried in the ground or hanging over it', () => {
  // The hall is set into the ground by a fixed amount, which is a deliberate 0.1 and not a
  // piece that happens to have been placed low.
  for (const piece of hallPieces()) {
    const b = placed(piece)
    assert.ok(b.min[1] >= HALL_SPOT.y - 1e-6, `${piece.part} starts at ${b.min[1].toFixed(2)}, below the hall's floor`)
  }
  assert.ok(HALL_SPOT.y < 0, 'the hall is meant to sit into the ground, not on it')
  assert.ok(HALL_SPOT.y > -0.3, `the hall is sunk by ${-HALL_SPOT.y}, which is a hall with a step down into it`)
})
