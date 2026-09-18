import { test } from 'node:test'
import assert from 'node:assert/strict'
import { revealThresholds } from '../src/world/houses.js'

test('thresholds ascend and stay inside (0, 1]', () => {
  const t = revealThresholds(6)
  assert.equal(t.length, 6)
  for (let i = 0; i < t.length; i++) {
    assert.ok(t[i] > 0, `threshold ${i} is ${t[i]}`)
    assert.ok(t[i] <= 1, `threshold ${i} is ${t[i]}`)
    if (i > 0) assert.ok(t[i] > t[i - 1], `threshold ${i} does not exceed ${i - 1}`)
  }
})

test('the first piece is there for the smallest live thread', () => {
  // A building's progress floors at 0.05 while it is visible, so anything above that leaves
  // a real thread's house empty.
  // Compared in Float32, because that is the precision the array stores: a Float32Array
  // holds 0.05 as 0.05000000074505806, so `<= 0.05` against the double is false.
  const t = revealThresholds(4)
  assert.ok(t[0] <= Math.fround(0.05), `first threshold ${t[0]} would leave a live thread empty`)
})

test('the last piece needs full progress', () => {
  const t = revealThresholds(4)
  assert.equal(t[3], 1)
})

test('one piece is first, not last', () => {
  // The single piece of a one-piece house is both the first and the last, and those two
  // rules disagree. First wins: an empty house for a live thread is the failure that
  // matters, and a one-piece house furnished from the start is harmless.
  assert.deepEqual(Array.from(revealThresholds(1)), [Math.fround(0.05)])
})

test('no pieces is not a crash', () => {
  assert.equal(revealThresholds(0).length, 0)
})
