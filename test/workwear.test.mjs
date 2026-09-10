import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUIT_TONES, AGENT_LOOK } from '../src/agents/astronauts.js'

/**
 * sRGB channel triple, 0..1. Distances are taken here rather than in linear RGB
 * deliberately: linear RGB compresses dark colours so severely that no plausible
 * workwear tone is more than 0.10 from the `sleeping` trim. See the spec.
 */
const srgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const luminance = (hex) => {
  const [r, g, b] = srgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}
const distance = (a, b) => {
  const [ar, ag, ab] = srgb(a)
  const [br, bg, bb] = srgb(b)
  return Math.hypot(ar - br, ag - bg, ab - bb)
}

const MIN_DISTANCE = 0.15
const MIN_LUMINANCE_RATIO = 1.15

test('there are five workwear tones', () => {
  assert.equal(SUIT_TONES.length, 5)
})

test('no workwear tone can be confused with a status trim colour', () => {
  for (const suit of SUIT_TONES) {
    for (const [status, look] of Object.entries(AGENT_LOOK)) {
      const d = distance(suit, look.trim)
      assert.ok(
        d >= MIN_DISTANCE,
        `suit 0x${suit.toString(16)} is ${d.toFixed(3)} from ${status}'s trim, under ${MIN_DISTANCE}`
      )
    }
  }
})

test('every trim colour is brighter than every workwear tone', () => {
  // This is the property that makes hi-vis read as hi-vis. It failed for the whole of
  // stages 1 to 3: trims measure 0.09 to 0.41 in luminance and the old white bodies
  // measured 0.77 to 0.91, so the band was a dark smudge on a white suit.
  for (const suit of SUIT_TONES) {
    for (const [status, look] of Object.entries(AGENT_LOOK)) {
      const ratio = luminance(look.trim) / luminance(suit)
      assert.ok(
        ratio >= MIN_LUMINANCE_RATIO,
        `${status}'s trim is only ${ratio.toFixed(2)}x suit 0x${suit.toString(16)}, under ${MIN_LUMINANCE_RATIO}`
      )
    }
  }
})

test('no workwear tone is white', () => {
  // The regression guard for the actual defect: five near-white tones that had survived
  // three stages of re-theming because nothing asserted against them.
  for (const suit of SUIT_TONES) {
    assert.ok(luminance(suit) < 0.2, `suit 0x${suit.toString(16)} is too light to be workwear`)
  }
})
