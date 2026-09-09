import * as THREE from 'three'

/**
 * How a building's visible progress chases the progress its thread deserves.
 *
 * This lives in its own module for one reason: `colony.js` cannot be imported outside a
 * browser (its world modules read the built `.glb` atlases at module init), and this rule
 * is the one part of the growth loop that is worth asserting in a unit test. Everything
 * here is pure arithmetic.
 */

/** Damping rate of the approach, in reciprocal seconds. */
export const GROWTH_DAMPING = 1.8

/**
 * The smallest per-frame change worth pushing to the GPU. Its job is to stop a settled
 * building from rewriting its uniform every frame forever.
 */
export const GROWTH_EPSILON = 0.0005

/**
 * One frame of approach, from `progress` toward `target`.
 *
 * `THREE.MathUtils.damp` is an exponential approach: each step covers a fixed fraction of
 * whatever distance is left, so the step shrinks in proportion to the remaining gap and the
 * value never actually arrives. On its own that is fine. Combined with the epsilon gate it
 * is not: the update stops once the step drops under `GROWTH_EPSILON`, which happens a
 * strictly positive distance short of the target — `GROWTH_EPSILON / (1 - exp(-GROWTH_DAMPING * dt))`
 * short, about 0.017 at 60fps — and the value then sits there forever.
 *
 * That shortfall is a latent defect in the damping, not a new one. Under the old sink
 * mechanism, where progress slid a building up out of the ground, stopping 1.7% low was
 * imperceptible and nothing depended on arrival being exact. The furniture reveal in
 * `src/world/houses.js` changed that: it compares progress against discrete thresholds, and
 * `revealThresholds` puts its last boundary at exactly `1` and its first at exactly `0.05`
 * — the floor `transcriptProgress` clamps to. A value that stalls just short of either
 * boundary loses a whole piece of furniture: the last piece on every house, and every piece
 * at all on the smallest live thread.
 *
 * So the gate stays — it is what keeps settled buildings quiet — but the final step lands on
 * the target instead of stalling near it. The snap is never larger than the gap the old code
 * left behind permanently, and it lands on a reveal boundary, where a discrete step is the
 * intended effect anyway.
 *
 * `dt > 0` guards a paused or first frame: `damp` with `dt` of 0 returns `progress`
 * unchanged, and a zero-length frame must not be read as "close enough, arrive now".
 *
 * @returns the next progress. Equal to `progress` when there is nothing to do, so the caller
 *   can compare and skip the uniform write.
 */
export function stepProgress(progress, target, dt) {
  if (dt <= 0) return progress
  const next = THREE.MathUtils.damp(progress, target, GROWTH_DAMPING, dt)
  if (Math.abs(next - progress) > GROWTH_EPSILON) return next
  return target
}
