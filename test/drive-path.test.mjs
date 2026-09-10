import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hexLine, pathLength, pointAt } from '../src/world/drive-path.js'

test('a line to itself is one cell', () => {
  assert.deepEqual(hexLine(0, 0, 0, 0), [{ q: 0, r: 0 }])
})

test('a line to a neighbour is two adjacent cells', () => {
  const line = hexLine(0, 0, 1, 0)
  assert.equal(line.length, 2)
  assert.deepEqual(line[0], { q: 0, r: 0 })
  assert.deepEqual(line[1], { q: 1, r: 0 })
})

test('every step of a long line is adjacent to the last', () => {
  // Axial neighbours differ by one of the six HEX_DIRS; in cube terms the
  // cube distance between consecutive cells is exactly 1.
  const line = hexLine(-3, 2, 4, -5)
  assert.ok(line.length > 2)
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1]
    const b = line[i]
    const dq = b.q - a.q
    const dr = b.r - a.r
    const ds = -dq - dr
    const dist = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
    assert.equal(dist, 1, `step ${i} jumps ${dist} cells: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
  }
})

test('a line starts and ends where asked', () => {
  const line = hexLine(-3, 2, 4, -5)
  assert.deepEqual(line[0], { q: -3, r: 2 })
  assert.deepEqual(line[line.length - 1], { q: 4, r: -5 })
})

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
