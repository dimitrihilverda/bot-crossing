import * as THREE from 'three'
import { hashString } from '../world/plots.js'

/**
 * Skin tones for the crew, and the rule that picks one.
 *
 * A crew member's tone says *who it is*, never *what it is doing* — it is how you tell one
 * figure from another on a plot, in the same way a plot's accent colour tells you which repo
 * you are looking at. So it is a pure function of the thread id and nothing else. This
 * module deliberately imports nothing that knows about status, and a test asserts it.
 *
 * Six tones, spread rather than shaded from one, because at the height a crew member
 * occupies on screen a subtle gradient reads as one colour.
 */
export const SKIN_TONES = Object.freeze([
  0xf3d0b6, 0xe4b191, 0xc98e64, 0xa26b44, 0x76492d, 0x4a2e1d,
])

/** Which tone a thread wears. Stable for a given id, and never anything else's business. */
export function skinToneIndexFor(id) {
  return hashString(String(id)) % SKIN_TONES.length
}

const cache = new Map()

/** The tone itself, as a THREE.Color. Cached, because this is read per agent per frame. */
export function skinToneFor(id) {
  const key = skinToneIndexFor(id)
  let colour = cache.get(key)
  if (!colour) {
    colour = new THREE.Color(SKIN_TONES[key])
    cache.set(key, colour)
  }
  return colour
}
