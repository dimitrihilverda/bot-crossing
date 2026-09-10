/**
 * How bright a crew member's hi-vis bands are, as a multiplier.
 *
 * The bands inherited the "orange beacon stutters" the behaviour table promises for an
 * errored thread — that beacon was the antenna tip and the chest lamp, which Stage 3
 * removed. A pulse is what carries across a colony; an `!` badge cannot, at the height a
 * crew member occupies on screen.
 *
 * Never reaches zero. A band that switches fully off reads as a rendering fault or as a
 * figure that vanished, which is the opposite of drawing attention to it.
 */
const CALM = 0.72
const PULSE_HZ = 1.6
const PULSE_LOW = 0.34
const PULSE_HIGH = 1

export function bandPulse(elapsed, errored) {
  if (!errored) return CALM
  // A cosine rather than a square wave: the stutter should read as a beacon turning, not as
  // a strobe, and a hard edge at this size just looks like dropped frames.
  const wave = 0.5 - 0.5 * Math.cos(elapsed * PULSE_HZ * Math.PI * 2)
  return PULSE_LOW + (PULSE_HIGH - PULSE_LOW) * wave
}
