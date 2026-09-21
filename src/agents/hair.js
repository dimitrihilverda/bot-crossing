import * as THREE from 'three'
import { hashString } from '../world/plots.js'

/**
 * Hair tones for the crew, and the rule that picks one.
 *
 * A crew member's hair says *who it is*, never *what it is doing* — the second half of the
 * job skin tone started, which is making a crew read as individuals rather than as copies of
 * one figure. So a tone is a pure function of the thread id and nothing else: this module
 * deliberately imports nothing that knows about status, and a test asserts it.
 *
 * The old four procedural hairstyles (sphere caps and a cylinder skirt, sized against the
 * head) are gone. Every adventurer head now has its hair modelled and painted in as part of
 * the garment mesh (see `mergeSet` in `crew.js`); what varies per crew member now is the
 * *colour* of cell 1 of that mesh's atlas, repainted by `astronauts.js`'s shader — this module
 * only has to say which colour.
 *
 * ## Five tones, not six, and the rule is not darkness
 *
 * Every hair tone must read as hair against *every* one of the six skin tones (`skin.js`'s
 * `SKIN_TONES`), because hair and skin are chosen independently and any of the thirty
 * pairings can occur. The rule that decides that is **sRGB distance >= 0.15 from every skin
 * tone**, not "hair is darker than skin": the six skin tones span 0.035 to 0.675 in relative
 * luminance, which is the whole brown-and-tan range hair also lives in, so a mid-brown or
 * ginger hair sits within 0.05 of one of them — effectively the same colour. Requiring hair to
 * clear the *darkest* skin tone (0.035) the way "darker than skin" would ask for would force
 * five shades of near-black instead of a spread.
 *
 * A second rule, sRGB distance >= 0.08 between hair tones themselves, keeps the five readable
 * from each other.
 *
 * Fourteen thousand and twenty-five colours clear the skin-distance threshold, and a search
 * that *maximises* the distance returns bright cyans — plausible costume colours were picked
 * first and then checked, not chosen by that search. Measured (sRGB distance, worst case
 * against the six skin tones):
 *
 * | tone | hex | worst-case distance |
 * | --- | --- | --- |
 * | black | `0x17161a` | 0.221 |
 * | blue-black | `0x1a2030` | 0.210 |
 * | slate | `0x3d4650` | 0.227 |
 * | ash grey | `0x6e6a66` | 0.244 |
 * | steel grey | `0x8b9095` | 0.310 |
 *
 * so the worst margin over the whole palette is **0.210** (blue-black against the darkest skin
 * tone, `0x4a2e1d`), clearing the 0.15 floor by 0.06. The tightest gap between two hair tones
 * is **0.095** (black against blue-black), clearing the 0.08 floor. Colours that look plausible
 * but were measured to fail: platinum `0xd8d2c4` (0.120), deep olive `0x2f3a24` (0.119) and
 * dark auburn `0x4a1f1f` (0.059) — all short of 0.15.
 *
 * The honest consequence: this threshold makes the palette greyscale-to-blue-black, because
 * browns, gingers and blondes are exactly the colours human skin comes in and none of them can
 * clear 0.15 against all six skin tones at once. Read as dark, greying and grey hair it suits
 * a crew of mixed ages — but that is a consequence of the legibility rule, not a style choice.
 */
export const HAIR_TONES = Object.freeze([0x17161a, 0x1a2030, 0x3d4650, 0x6e6a66, 0x8b9095])

/**
 * Which tone a thread wears. Stable for a given id, and never anything else's business.
 *
 * Salted and avalanched for the same reason `garmentSetIndexFor` in `garment-sets.js` is:
 * plain FNV-1a (`hashString`) never mixes its own lowest bit, so an unmixed hash taken with an
 * even modulus alongside `skinToneIndexFor`'s `% 6` would inherit the same parity and the two
 * would move in lockstep. `avalanche` (the `lowbias32` finalizer, below) fixes that, and the
 * salt is this module's own — distinct from `skin.js`'s (no salt) and `garment-sets.js`'s
 * (`garment:`) — purely so the three hashes would still differ even if the finalizer were ever
 * revisited.
 */
export function hairToneIndexFor(id) {
  return avalanche(hashString(`hair:${String(id)}`)) % HAIR_TONES.length
}

const cache = new Map()

/** The tone itself, as a THREE.Color. Cached, because this is read per agent per frame. */
export function hairToneFor(id) {
  const key = hairToneIndexFor(id)
  let colour = cache.get(key)
  if (!colour) {
    colour = new THREE.Color(HAIR_TONES[key])
    cache.set(key, colour)
  }
  return colour
}

/**
 * `lowbias32` (Chris Wellons). A pure bit-mixer: no state, no allocation, same in and out.
 * Exported so `garment-sets.js` can salt-and-avalanche its own choice the same way, rather
 * than reimplementing the finalizer.
 */
export function avalanche(h) {
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}
