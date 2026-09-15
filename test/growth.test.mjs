import { test } from 'node:test'
import assert from 'node:assert/strict'
import { stepProgress, GROWTH_EPSILON } from '../src/game/growth.js'
import { revealThresholds } from '../src/world/houses.js'

/**
 * Runs `_growBuildings`' own update rule to a standstill and reports where it landed.
 *
 * This is the value the shader receives — `entry.progress`, not `entry.target`. The whole
 * class of bug these tests exist for hid in that distinction: `test/houses.test.mjs` asserts
 * what `revealThresholds` returns, and nothing asserted that the number it is compared
 * against can actually get there.
 */
function settle(target, dt, { from = 0, maxFrames = 100000 } = {}) {
  let progress = from
  for (let i = 0; i < maxFrames; i++) {
    const next = stepProgress(progress, target, dt)
    if (next === progress) return { progress, uProgress: Math.fround(progress), frames: i }
    progress = next
  }
  assert.fail(`progress never settled: ${progress} after ${maxFrames} frames toward ${target}`)
}

const FRAME_RATES = [
  ['144fps', 1 / 144],
  ['60fps', 1 / 60],
  ['30fps', 1 / 30],
  ['10fps', 1 / 10],
]

for (const [label, dt] of FRAME_RATES) {
  test(`growth arrives exactly on its target at ${label}`, () => {
    // Every boundary the furniture reveal cares about, plus the retire target.
    for (const target of [0, 0.05, 0.278, 0.5, 1]) {
      const { progress } = settle(target, dt)
      assert.equal(
        progress,
        target,
        `settled at ${progress} instead of ${target} at ${label} — a shortfall of ${target - progress}`
      )
    }
  })
}

test('a settled building stops writing', () => {
  // The epsilon gate has a job: no per-frame uniform write once nothing is moving. Snapping
  // to the target must not turn every frame into a write.
  const dt = 1 / 60
  assert.equal(stepProgress(1, 1, dt), 1)
  assert.equal(stepProgress(0.05, 0.05, dt), 0.05)
  const { frames } = settle(1, dt)
  assert.ok(frames < 600, `took ${frames} frames to settle, which is over ten seconds`)
})

test('a zero-length frame does not count as arrival', () => {
  // `damp` with dt 0 returns the input, so the step is 0, which is under the gate. That must
  // not be read as "close enough" — it would teleport a brand-new building to full size.
  assert.equal(stepProgress(0, 1, 0), 0)
})

/**
 * `uProgress` is a GLSL `float`, so whatever double `setProgress` is handed arrives in the
 * shader rounded to Float32 — which is also the precision `revealThresholds` stores its
 * thresholds at. `Math.fround` is that round trip, and comparing without it makes the
 * threshold at `Math.fround(0.05)` look unreachable from a progress of exactly `0.05` when
 * on the GPU the two are the same number.
 */
test('the last furniture piece is reachable', () => {
  // The failure this test exists for: `revealThresholds` ends at exactly 1, the shader
  // discards where `aReveal > uProgress`, and the old damp-plus-gate rule settled at
  // 0.98309 at 60fps — so `lamp_standing` was discarded on every house, forever.
  const thresholds = revealThresholds(8)
  for (const [label, dt] of FRAME_RATES) {
    const { uProgress } = settle(1, dt)
    for (let i = 0; i < thresholds.length; i++) {
      assert.ok(
        thresholds[i] <= uProgress,
        `at ${label} piece ${i} (threshold ${thresholds[i]}) is never drawn: progress settles at ${uProgress}`
      )
    }
  }
})

test('the smallest live thread still gets its first piece', () => {
  // `transcriptProgress` floors at 0.05 and the first threshold is `Math.fround(0.05)`. The
  // old rule settled at 0.03352 at 60fps, below the floor, so the whole lot came out empty.
  const first = revealThresholds(8)[0]
  for (const [label, dt] of FRAME_RATES) {
    const { uProgress } = settle(0.05, dt)
    assert.ok(first <= uProgress, `at ${label} an empty lot: ${first} > ${uProgress}`)
    // And nothing beyond the first piece, or the reveal would not be tracking size at all.
    assert.ok(revealThresholds(8)[1] > uProgress, `at ${label} too much furniture arrived`)
  }
})

test('a retiring building reaches the removal threshold', () => {
  // `_removeBuilding` fires at `progress <= 0.02`, and `createHouse` hides the group at
  // `v > 0.02`. Both need the descent to actually get there from a full house.
  for (const [label, dt] of FRAME_RATES) {
    const { progress } = settle(0, dt, { from: 1 })
    assert.equal(progress, 0, `at ${label} a retired house settled at ${progress}`)
    assert.ok(progress <= 0.02, `at ${label} the house would never be removed`)
  }
})

test('the shortfall the old rule left is real, and is what the snap covers', () => {
  // Pins the arithmetic the fix rests on, so that a future change to GROWTH_EPSILON or the
  // damping rate cannot quietly make the snap a visible jump. The gap the bare gate froze at
  // is GROWTH_EPSILON / (1 - exp(-1.8 * dt)); the snap is never larger than that.
  const dt = 1 / 60
  const gap = GROWTH_EPSILON / (1 - Math.exp(-1.8 * dt))
  assert.ok(gap > 0, 'an exponential approach always stops short; that is the defect')
  assert.ok(gap < 0.05, `the snap would jump ${gap}, which is a visible pop`)
})
