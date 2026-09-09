/**
 * When each furniture piece appears, as a fraction of thread progress.
 *
 * Evenly spaced rather than weighted: progress is already a log scale over transcript size,
 * and a second curve on top of it would compress the early pieces into invisibility — which
 * is exactly the range most real threads live in.
 *
 * The first threshold is pulled down to 0.05 because that is where a building's progress
 * floors while it is still visible: a thread that exists at all should have something in
 * the house.
 */
export function revealThresholds(count) {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = (i + 1) / count
  if (count > 0) out[0] = Math.min(out[0], 0.05)
  return out
}
