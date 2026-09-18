import { test } from 'node:test'
import assert from 'node:assert/strict'
import { SUIT_TONES } from '../src/agents/workwear.js'

/**
 * sRGB channel triple, 0..1, and REC709 luminance from it. Taken in sRGB rather than linear
 * RGB deliberately: linear RGB compresses dark colours so severely that the workwear tones
 * would end up indistinguishable from each other. See the spec.
 */
const srgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const luminance = (hex) => {
  const [r, g, b] = srgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

test('there are five workwear tones', () => {
  assert.equal(SUIT_TONES.length, 5)
})

test('no workwear tone is white', () => {
  // The regression guard for the actual defect: five near-white tones that had survived
  // three stages of re-theming because nothing asserted against them. This used to be paired
  // with a test that every status trim colour was brighter than every workwear tone — trim
  // colours and the hi-vis band they lit are gone now, at the owner's request, so there is
  // nothing left for a suit to be brighter or darker than, and that comparison went with it.
  for (const suit of SUIT_TONES) {
    assert.ok(luminance(suit) < 0.2, `suit 0x${suit.toString(16)} is too light to be workwear`)
  }
})
