import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { drivingLanes, offsetPath, pathLength, pointAt } from '../src/world/drive-path.js'

// The `hexLine` tests that used to live here moved to `test/grid.test.mjs`, which exercises
// `grid.js`'s `line` — the square lattice's four-neighbour Bresenham walk that replaced it.
// Deleted rather than duplicated: the property (every step adjacent, starts and ends where
// asked) is already asserted there, against the function that actually implements it now.

test('path length sums the segments', () => {
  const pts = [
    { x: 0, z: 0 },
    { x: 3, z: 4 },
    { x: 3, z: 4 },
    { x: 3, z: 9 },
  ]
  // 5 for the 3-4-5 triangle, 0 for the duplicate point, 5 for the straight run.
  assert.equal(pathLength(pts), 10)
})

test('an empty or single-point path has zero length', () => {
  assert.equal(pathLength([]), 0)
  assert.equal(pathLength([{ x: 2, z: 2 }]), 0)
})

test('pointAt walks along the path and faces the way it is going', () => {
  const pts = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
  ]
  const mid = pointAt(pts, 5)
  assert.equal(mid.x, 5)
  assert.equal(mid.z, 0)
  // Travelling +x. The yaw that points a +Z-fronted body that way is a quarter turn — see
  // the yaw contract asserted below.
  assert.ok(Math.abs(mid.heading - Math.PI / 2) < 1e-9, `heading ${mid.heading}`)
})

test('pointAt clamps at both ends rather than extrapolating', () => {
  const pts = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
  ]
  assert.equal(pointAt(pts, -5).x, 0)
  assert.equal(pointAt(pts, 999).x, 10)
})

test('pointAt turns the corner', () => {
  const pts = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
    { x: 10, z: 10 },
  ]
  const after = pointAt(pts, 15)
  assert.equal(after.x, 10)
  assert.equal(after.z, 5)
  // Heading is now along +z, which for a +Z-fronted body is no rotation at all.
  assert.ok(Math.abs(after.heading) < 1e-9, `heading ${after.heading}`)
})


test('pointAt returns the yaw that aims a car down the route, not a bare direction angle', () => {
  // The value is consumed as `setFromAxisAngle(Y_AXIS, heading)` on a kit body whose front
  // faces local +Z — every car in city.glb is modelled that way (front wheels at z=+0.245,
  // rear at -0.256). So the contract is not "some angle describing this direction" but "the
  // angle that makes the body point there", and that is what this asserts — against three's
  // own rotation rather than a rederived matrix, because the rederivation is exactly the step
  // that was got wrong.
  const aimed = (points, distance) => {
    const { heading } = pointAt(points, distance)
    return new THREE.Vector3(0, 0, 1).applyQuaternion(
      new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), heading)
    )
  }

  const east = aimed([{ x: 0, z: 0 }, { x: 10, z: 0 }], 5)
  assert.ok(Math.abs(east.x - 1) < 1e-9, `driving +x, the car points x=${east.x.toFixed(3)} z=${east.z.toFixed(3)}`)

  const south = aimed([{ x: 0, z: 0 }, { x: 0, z: 10 }], 5)
  assert.ok(Math.abs(south.z - 1) < 1e-9, `driving +z, the car points x=${south.x.toFixed(3)} z=${south.z.toFixed(3)}`)
})
test('a single-point path is a standstill, not a crash', () => {
  const at = pointAt([{ x: 4, z: 7 }], 3)
  assert.equal(at.x, 4)
  assert.equal(at.z, 7)
  assert.equal(at.heading, 0)
})

test('an empty path is a standstill at the origin', () => {
  const at = pointAt([], 3)
  assert.equal(at.x, 0)
  assert.equal(at.z, 0)
})

/** Points are compared with a tolerance: a miter runs through a square root. */
const assertPath = (actual, expected) => {
  assert.equal(actual.length, expected.length, `point count: ${JSON.stringify(actual)}`)
  actual.forEach((p, i) => {
    assert.ok(
      Math.abs(p.x - expected[i].x) < 1e-9 && Math.abs(p.z - expected[i].z) < 1e-9,
      `point ${i}: got (${p.x}, ${p.z}), want (${expected[i].x}, ${expected[i].z})`
    )
  })
}

test('offsetPath shifts a straight route to the right of the way it is driven', () => {
  // Right of travel, not "+z": a car's own left is local +X (its front_left wheel sits at
  // x=+0.176), so for a body driving +x, right is +z. Getting this sign wrong puts the whole
  // colony on the left-hand side of the road — invisible in a still frame of one car, and
  // instantly visible in two passing ones.
  assertPath(
    offsetPath(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
      ],
      1
    ),
    [
      { x: 0, z: 1 },
      { x: 10, z: 1 },
    ]
  )
})

test('offsetPath miters the corner so both legs keep their full offset', () => {
  // The naive shape — shift each sampled point along its own segment's normal — leaves the
  // corner vertex on one leg's offset line and off the other's, so a car crossing the bend
  // jogs sideways by the offset and back. The miter is what makes a bend hold its lane.
  //
  // Leg one runs +x, so its lane is the line z = 1. Leg two runs +z, so its lane is x = 9.
  // The corner belongs where those two lines meet.
  assertPath(
    offsetPath(
      [
        { x: 0, z: 0 },
        { x: 10, z: 0 },
        { x: 10, z: 10 },
      ],
      1
    ),
    [
      { x: 0, z: 1 },
      { x: 9, z: 1 },
      { x: 9, z: 10 },
    ]
  )
})

test('offsetPath leaves alone a route it cannot offset', () => {
  assertPath(offsetPath([{ x: 3, z: 4 }], 1), [{ x: 3, z: 4 }])
  assertPath(offsetPath([], 1), [])
  // Zero offset is the identity, which is what lets a caller turn lane-keeping off without
  // branching around it.
  const pts = [
    { x: 0, z: 0 },
    { x: 5, z: 0 },
  ]
  assertPath(offsetPath(pts, 0), pts)
})

test('driving there and driving back are two different lanes, each on its own right', () => {
  // A route is one line of cell centres, but a round trip is two journeys in opposite
  // directions, and "keep right" means something different for each. Sampling one polyline
  // for both is what had every car driving its whole return leg in reverse down the wrong
  // side of the road — invisible while cars were also 90 degrees sideways, obvious the moment
  // they were not.
  const centre = [
    { x: 0, z: 0 },
    { x: 10, z: 0 },
  ]
  const { out, back } = drivingLanes(centre, 1)

  // Driving +x, right is +z.
  assertPath(out, [
    { x: 0, z: 1 },
    { x: 10, z: 1 },
  ])
  // Coming back the other way, right is -z — and the line starts where the outbound one ended.
  assertPath(back, [
    { x: 10, z: -1 },
    { x: 0, z: -1 },
  ])
})

test('the two lanes of a round trip never share a point', () => {
  const centre = [
    { x: 0, z: 0 },
    { x: 12, z: 0 },
    { x: 12, z: 12 },
  ]
  const { out, back } = drivingLanes(centre, 0.4)
  for (const a of out) {
    for (const b of back) {
      assert.ok(Math.hypot(a.x - b.x, a.z - b.z) > 1e-6, `lanes meet at (${a.x}, ${a.z})`)
    }
  }
})
