/**
 * Workwear. One flat colour for the whole figure, because the body is a single instanced
 * mesh with a single `instanceColor` per agent — so this is a boilersuit, not a two-tone
 * outfit. Real garments would need meshes cut out of the body, and are deliberately not done.
 *
 * These five were picked against a measured constraint, asserted in `test/workwear.test.mjs`
 * rather than eyeballed: **every tone reads as dark work clothing, luminance under 0.2**,
 * not as a white spacesuit. Measured worst case: `0x455142` at 0.075.
 *
 * That constraint used to be paired with a second one — every tone far enough from the eight
 * status trim colours that an overall could never be mistaken for the hi-vis band a crew
 * member wore over it. Both the trim colours and the band are gone now, at the owner's
 * request (see `astronauts.js`'s `AGENT_LOOK` comment), so there is nothing left to be
 * mistaken for and the constraint went with it.
 *
 * The luminance constraint is the one that was broken once. Trim colours used to measure 0.09
 * to 0.41; the five shades of white these replace measured 0.77 to 0.91 — a dark band on a
 * bright suit reads as a smudge rather than hi-vis, which was the whole of stages 1 to 3's
 * defect. sRGB, not linear RGB: linear RGB compresses dark colours so hard that the
 * distinction barely survives the conversion.
 *
 * Its own module, importing nothing at all, for the same reason `skin.js` (`SKIN_TONES`) and
 * `hair.js` (`HAIR_TONES`) already are: `node --test` can reach five numbers and a comment
 * without a GL context or a loaded glb, which is what importing `astronauts.js` itself needs.
 */
export const SUIT_TONES = [0x30424e, 0x455142, 0x4e3c30, 0x304530, 0x3a3d42]
