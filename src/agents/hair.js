import * as THREE from 'three'
import { hashString } from '../world/plots.js'

/**
 * Hairstyles for the crew, and the rule that picks one.
 *
 * A crew member's hair says *who it is*, never *what it is doing* — it is the second half of
 * the job skin tone started, which is making a crew of six read as six people rather than as
 * six copies of one. So a style is a pure function of the thread id and nothing else: this
 * module deliberately imports nothing that knows about status, and a test asserts it.
 *
 * Four styles, one of them bald. Nothing here is a work of art — at the height a crew member
 * occupies on screen a silhouette is all that reads, so each style is a couple of sphere
 * patches sized against the head, exactly the way the helmet used to be built.
 *
 * ## Everything is measured against the head, not against the helmet
 *
 * `geometry(R)` takes the *head* radius, and the caller passes `P.headR` (0.554). It must not
 * be handed `P.helmetR` (0.48): that is the radius of the helmet these figures no longer
 * wear, and the head under it is about 15% bigger. Task 2 found this the hard way with the
 * face cap — sized against the helmet it sat 0.02 to 0.08 *inside* the head at every one of
 * its vertices, and hair sized the same way would be a scalp buried in a skull.
 *
 * The numbers below come from ray-casting the 959 vertices of `Mannequin_Medium_Head` out of
 * the face origin, in the same local frame the head and the face are written in (origin at
 * the face centre, +Z the way the figure looks, +Y up):
 *
 * | direction | head surface |
 * | --- | --- |
 * | straight up (the crown) | 0.502 |
 * | worst case anywhere in the upper hemisphere | 0.575 (45–55° off vertical, at the brow) |
 * | back and sides at the hairline (63° off vertical) | 0.41 – 0.52 |
 * | widest horizontal radius near the ears | 0.544 |
 *
 * so `SHELL = 1.06` (0.587 at R = 0.554) is the smallest round number that clears the whole
 * upper hemisphere — 0.013 clear of the worst case, and standing 0.085 proud of the crown,
 * which is what gives the hair a thickness rather than a painted-on look.
 */

/** The name of the style that is no style. Exported so nobody has to retype the string. */
export const BALD = 'bald'

/**
 * The hair shell, as a multiple of the head radius. See the table above: this has to clear
 * 0.575/0.554 = 1.038 to stay outside the skull everywhere it is drawn.
 */
const SHELL = 1.06
/** Where the hair stops at the front — the hairline, in radians off vertical. */
const FRONT_END = 0.8 // 45.8°, which puts the front edge at y 0.415 and leaves a forehead
/** Where it stops at the temples. Lower than the front, the way hair actually sits. */
const SIDES_END = 1.1 // 63.0°, y 0.267, still above the ears at y ≈ 0
/** How much of the way round the temples reach that lower hairline. */
const SIDES_ARC = (Math.PI * 11) / 9 // 220°, leaving ±70° at the front at the higher line
/**
 * The nape: how far down the *back* of the skull the hair carries on past the temples.
 *
 * Not a refinement. Without it the short and bun styles stop at the temple line all the way
 * round, and from behind that is a beret — the whole lower back of the skull, from y 0.27 down
 * to the neck, is bare skin with a hard edge across it. Which is only obvious from behind, and
 * a crew member walking away from the camera is a shot the colony gives you constantly.
 */
const NAPE_END = 1.85 // 106.0°, y -0.162, which is the nape rather than the crown
const NAPE_ARC = Math.PI // 180°, the back half only — this is not a beard
/**
 * The long skirt: hair falling behind the head, hung off the bottom edge of the sides so the
 * two meet without a seam. Radius is pushed a little past that edge because the head is at
 * its widest by the ears (0.544) — a skirt on the shell's own radius would graze them.
 */
const SKIRT_DROP = 1.02 // how far down it hangs, in head radii — to y -0.54R, past the jaw
/**
 * How much wider the bottom of the skirt is than its top. Not decoration: the head is at its
 * widest *below* the skirt's top edge — 0.514 across the back at y -0.03 against a top ring
 * of 0.523 — so a straight skirt hung off that edge clears the skull by 0.009 and its flat
 * facets graze it. Flaring it out as it drops both fixes that and is what long hair does.
 */
const SKIRT_FLARE = 1.14
/** The bun: a knot of hair, above and behind the crown. */
const BUN_R = 0.27
const BUN_POLAR = 0.66 // 37.8° off vertical, so it sits on the back of the crown cap
const BUN_PROUD = 0.55 // fraction of its own radius that stands clear of the shell

/**
 * Tessellation, as a fixed angular step rather than a fixed segment count per patch — and
 * that is load-bearing, not tidiness.
 *
 * Every arc above is a whole number of `PHI_STEP`s (360, 220 and 180 degrees are 18, 11 and 9
 * twenty-degree steps) and every arc *starts* on one (the temples at 160°, the nape at 180°).
 * So where two patches meet, both rings put their vertices at the same angles and the shell is
 * watertight. A fixed 20-segment count per patch does not do that: the crown would divide 360°
 * into 18° steps and the temples 220° into 11°, their shared edge would be two differently
 * faceted curves, and the chord mismatch is a real hole — about 0.009 wide, 1.6% of the head
 * radius, which shows up in a close-up as a dotted seam of skin across the crown.
 */
const PHI_STEP = Math.PI / 9 // 20° round the axis
const THETA_STEP = Math.PI / 18 // 10° down from the crown; nothing needs to line up here
const segs = (arc) => Math.max(3, Math.round(arc / PHI_STEP))
const rings = (span) => Math.max(1, Math.round(span / THETA_STEP))

/**
 * The four styles. `geometry(R)` returns a fresh `THREE.BufferGeometry` in the head's own
 * local frame — the caller owns it and disposes it — or `null` for bald, which builds
 * nothing at all rather than an empty mesh nobody would draw.
 */
export const HAIR_STYLES = Object.freeze([
  { name: BALD, geometry: () => null },
  { name: 'short', geometry: (R) => merge([...cropped(R), nape(R)]) },
  // Long carries the skirt instead of the nape band: the skirt already covers the back of the
  // skull on its way past the jaw, and stacking both would put two surfaces in the same place.
  { name: 'long', geometry: (R) => merge([...cropped(R), skirt(R)]) },
  { name: 'bun', geometry: (R) => merge([...cropped(R), nape(R), knot(R)]) },
])

/**
 * Which style a thread wears. Stable for a given id, and never anything else's business.
 *
 * Salting alone is not enough here, which is worth spelling out because salting alone is the
 * obvious thing to do. `skinToneIndexFor` is `hashString(id) % 6` and this is a `% 4` of the
 * same FNV-1a over a prefixed copy of the same string — and in FNV-1a the *lowest* bit is not
 * mixed at all. Each round is `h = (h ^ c) * 16777619`; the multiplier is odd, so mod 2 that
 * whole step collapses to `h ^= c` and the final low bit is just the parity of the low bits of
 * every character, seeded by the low bit of the offset basis. A prefix contributes a constant
 * to that parity and nothing else. Both moduli are even, so both indices inherit that same
 * low bit as their own parity — measured over 2000 ids, `hashString('hair:' + id) % 4` had the
 * *same parity* as the tone index 100.0% of the time, and 200 ids reached only 12 of the 24
 * possible (tone, style) combinations. Every dark-skinned figure would be bald or long-haired
 * and never short-haired or bunned.
 *
 * So the hash is avalanched before the modulus, with the `lowbias32` finalizer — three
 * xor-shift/multiply rounds that spread every input bit across all 32 output bits, which is
 * exactly the step FNV-1a lacks. With it, the same measurement reaches all 24 combinations and
 * the parities agree 50.5% of the time, i.e. chance. The salt stays as well: it costs nothing
 * and it keeps the two hashes different even if the finalizer is ever revisited.
 */
export function hairStyleIndexFor(id) {
  return avalanche(hashString(`hair:${String(id)}`)) % HAIR_STYLES.length
}

/**
 * `lowbias32` (Chris Wellons). A pure bit-mixer: no state, no allocation, same in and out.
 * Exported so `garment-sets.js` can salt-and-avalanche its own choice the same way, rather
 * than reimplementing the finalizer — see the comment above `garmentSetIndexFor` there for
 * why a second, independent hash needs it too.
 */
export function avalanche(h) {
  h ^= h >>> 16
  h = Math.imul(h, 0x7feb352d)
  h ^= h >>> 15
  h = Math.imul(h, 0x846ca68b)
  h ^= h >>> 16
  return h >>> 0
}

/**
 * The base every non-bald style is built on: a cap over the crown plus a band that carries
 * the temples further down.
 *
 * Two pieces rather than one full cap because a single cap has one hairline all the way
 * round, which is a bowl on a head. The cap covers every azimuth down to the front hairline;
 * the band picks up from there and only covers the back 220°, so the front stops high and
 * the temples come down towards the ears. `nape` or `skirt` then takes the back lower still.
 *
 * Every patch is struck on the same sphere of radius `R * SHELL`, which is what lets them be
 * concatenated with no seam: adjoining edges are not merely close, they are the same points.
 */
function cropped(R) {
  const r = R * SHELL
  const crown = new THREE.SphereGeometry(
    r,
    segs(Math.PI * 2),
    rings(FRONT_END),
    0,
    Math.PI * 2,
    0,
    FRONT_END
  )
  // Centred on the back: three's phi runs from -X, so +Z (the face) is at phi = PI/2 and the
  // back of the head is at phi = 3 * PI / 2.
  const start = (Math.PI * 3) / 2 - SIDES_ARC / 2
  const sides = new THREE.SphereGeometry(
    r,
    segs(SIDES_ARC),
    rings(SIDES_END - FRONT_END),
    start,
    SIDES_ARC,
    FRONT_END,
    SIDES_END - FRONT_END
  )
  return [crown, sides]
}

/**
 * The back of the skull, from the temple line down to the nape. Same sphere, narrower arc —
 * the back half only, so it stops beside the ears and never comes round onto a cheek.
 */
function nape(R) {
  return new THREE.SphereGeometry(
    R * SHELL,
    segs(NAPE_ARC),
    rings(NAPE_END - SIDES_END),
    (Math.PI * 3) / 2 - NAPE_ARC / 2,
    NAPE_ARC,
    SIDES_END,
    NAPE_END - SIDES_END
  )
}

/**
 * Long hair: an open, flared cone hanging off the bottom edge of the sides band.
 *
 * Its top ring is exactly that edge — same radius, same height, same 220° of azimuth, same
 * tessellation — so the two read as one surface, and `openEnded` keeps the inside of it from
 * drawing a lid across the neck.
 *
 * `THREE.CylinderGeometry` measures theta from +Z, where `SphereGeometry` measures phi from
 * -X, so the back of the head is at `PI` here and at `3 * PI / 2` above. Getting that wrong
 * is not a subtle error: the skirt wraps round the wrong way and hangs down over the face.
 */
function skirt(R) {
  const r = R * SHELL
  const top = r * Math.sin(SIDES_END)
  const topY = r * Math.cos(SIDES_END)
  const height = R * SKIRT_DROP
  const geo = new THREE.CylinderGeometry(
    top,
    top * SKIRT_FLARE,
    height,
    segs(SIDES_ARC),
    2,
    true,
    Math.PI - SIDES_ARC / 2,
    SIDES_ARC
  )
  geo.translate(0, topY - height / 2, 0)
  return geo
}

/** A bun: one small sphere, sitting proud of the shell on the back of the crown. */
function knot(R) {
  const radius = R * BUN_R
  const geo = new THREE.SphereGeometry(radius, 12, 8)
  const centre = R * SHELL + radius * BUN_PROUD
  geo.translate(0, centre * Math.cos(BUN_POLAR), -centre * Math.sin(BUN_POLAR))
  return geo
}

/**
 * Concatenate a few geometries into one, so a style is one draw call.
 *
 * Written out rather than reached for from `three/addons/utils/BufferGeometryUtils.js`: the
 * import allowlist that keeps this module away from anything status-shaped is two entries
 * long, and a merge is twenty lines. Only position, normal and index come along — the hair
 * material has no map, so the UVs would be dead weight.
 */
function merge(geometries) {
  const parts = geometries.filter(Boolean)
  if (!parts.length) return null
  if (parts.length === 1) return parts[0]

  let vertices = 0
  let indices = 0
  for (const geo of parts) {
    vertices += geo.attributes.position.count
    indices += geo.index ? geo.index.count : geo.attributes.position.count
  }

  const position = new Float32Array(vertices * 3)
  const normal = new Float32Array(vertices * 3)
  const index = new Uint32Array(indices)
  let v = 0
  let i = 0
  for (const geo of parts) {
    const p = geo.attributes.position
    const n = geo.attributes.normal
    position.set(p.array.subarray(0, p.count * 3), v * 3)
    normal.set(n.array.subarray(0, n.count * 3), v * 3)
    const src = geo.index
    for (let k = 0; k < (src ? src.count : p.count); k++) {
      index[i++] = (src ? src.getX(k) : k) + v
    }
    v += p.count
    geo.dispose()
  }

  const merged = new THREE.BufferGeometry()
  merged.setAttribute('position', new THREE.BufferAttribute(position, 3))
  merged.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  merged.setIndex(new THREE.BufferAttribute(index, 1))
  return merged
}
