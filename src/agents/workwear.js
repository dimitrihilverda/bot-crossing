/**
 * Workwear. One flat colour for the whole figure, because the body is a single instanced
 * mesh with a single `instanceColor` per agent — so this is a boilersuit, not a two-tone
 * outfit. Real garments would need meshes sliced out of the body the way the hi-vis bands
 * are, and are deliberately not done.
 *
 * These five were picked against two measured constraints, both asserted in
 * `test/workwear.test.mjs` rather than eyeballed:
 *
 *  - **At least 0.15 away in sRGB from all eight trim colours**, so no overall can be
 *    mistaken for the trim that carries a thread's status. Measured worst case: 0.152.
 *  - **Every trim at least 1.15x the overall's luminance**, so the band is brighter than
 *    the cloth it sits on. Measured worst case: 1.18, `olive` against `sleeping`.
 *
 * The second constraint is the one that was broken. Trim colours measure 0.09 to 0.41 in
 * luminance; the five shades of white these replace measured 0.77 to 0.91. For the whole of
 * stages 1 to 3 the hi-vis band was therefore a *dark smudge on a white suit* — stage 1
 * re-themed the trim and left the body as spacesuit, and nothing asserted against it.
 *
 * Distances are taken in sRGB, not linear RGB. Linear RGB compresses dark colours so hard
 * that every plausible workwear tone sits within 0.10 of the `sleeping` trim, which is dark
 * itself; an early draft of the spec demanded 0.25 in linear RGB, which no colour could
 * have met.
 *
 * Its own module, importing nothing at all, for the same reason `skin.js` (`SKIN_TONES`),
 * `hair.js` (`HAIR_TONES`) and `band-pulse.js` already are: `node --test` can reach five
 * numbers and a comment without a GL context or a loaded glb, which is what importing
 * `astronauts.js` itself needs.
 */
export const SUIT_TONES = [0x30424e, 0x455142, 0x4e3c30, 0x304530, 0x3a3d42]
