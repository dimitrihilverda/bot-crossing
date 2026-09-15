import { test } from 'node:test'
import assert from 'node:assert/strict'
import { pathLength, pointAt } from '../src/world/drive-path.js'

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
  assert.equal(mid.heading, 0)
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
  // Heading is now along +z.
  assert.ok(Math.abs(after.heading - Math.PI / 2) < 1e-9, `heading ${after.heading}`)
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
