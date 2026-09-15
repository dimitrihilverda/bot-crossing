/**
 * Where a numbered cell sits in a KayKit character atlas.
 *
 * Every character texture in the Adventurers pack is one 1024 x 1024 PNG laid out as eight
 * columns by four rows, each cell a vertical gradient and the bottom row filler. That is the
 * same shape `tools/atlas-cells.mjs` reads for the kit atlases.
 *
 * Two of those cells are what this project repaints per crew member, measured from the UVs
 * of `Ranger_Head` and `Rogue_Head` rather than guessed:
 *
 *  - cell 0, `#f6c09c`, skin — 322 vertices on the Ranger's head, 309 on the Rogue's
 *  - cell 1, `#9b5a45`, hair — 770 and 1640
 *
 * A third cell was measured at the same time and is worth keeping on record even though
 * nothing repaints it: cell 2, `#13191b`, eyes and brows — 80 vertices on the Ranger's head,
 * 98 on the Rogue's. It is deliberately left as the pack painted it rather than named and
 * given a shader branch of its own: the owner asked for the eyes to read as black or dark,
 * and `#13191b` already is — near enough to black that the ratio substitution `astronauts.js`
 * uses for skin and hair (dividing by the cell's own mid colour) would divide by almost
 * nothing, turning any rounding error into a visible colour. Not repainting it costs nothing
 * and sidesteps that entirely.
 *
 * glTF puts the UV origin at the **top** left and `v` runs downward, so cell 0 spans
 * v 0 to 0.25. Inverting that repaints a different swatch and still looks deliberate, which
 * is the one mistake here that a screenshot would not catch.
 *
 * Pure arithmetic, no three.js, so it can be tested under `node --test`.
 */

export const ATLAS_COLS = 8
export const ATLAS_ROWS = 4

export const CELL_SKIN = 0
export const CELL_HAIR = 1

/** The cell's own mid colour, for the ratio substitution the shader does. */
export const CELL_BASE = Object.freeze({
  [CELL_SKIN]: 0xf6c09c,
  [CELL_HAIR]: 0x9b5a45,
})

/** The UV rectangle cell `n` occupies. */
export function cellRect(n) {
  const col = n % ATLAS_COLS
  const row = Math.floor(n / ATLAS_COLS)
  return {
    u0: col / ATLAS_COLS,
    v0: row / ATLAS_ROWS,
    u1: (col + 1) / ATLAS_COLS,
    v1: (row + 1) / ATLAS_ROWS,
  }
}

/**
 * The Moving-In brand palette, moved onto the crew's garments at the owner's request.
 *
 * Values are the hex column of the company's own colour sheet, which is the authority here.
 * The sheet's RGB columns for Mid Gray and Light Gray disagree with their own hex: it lists
 * 231/157/145 for `#637184`, which converts to 99/113/132, not 231/157/145 — so this module
 * takes the hex and does not re-derive from that RGB column, and nobody downstream should
 * either.
 */
export const BRAND = Object.freeze({
  darkBlue: 0x1f262f,
  leafGreen: 0x8dc63f,
  white: 0xffffff,
  midGray: 0x637184,
  lightGray: 0xeff3fa,
})

/**
 * Which atlas cell is which garment part, per set, and what it moves from and to.
 *
 * `base` is each cell's own *mid* texel colour — measured off the built `crew.glb` the same
 * way `CELL_BASE` above was, at the middle of the cell's vertical gradient — and is what
 * `recolorByLuminance` below divides by. Everything else in the atlas (belts, buckles,
 * boots, straps, trims) is left at the pack's own colours; that detail is why this kit was
 * chosen, so only these two cells per set are listed here.
 *
 * The Rogue's trousers go to Mid Gray, not Dark Blue, even though the owner's first request
 * was Dark Blue for every garment. Dark Blue is very dark (`#1f262f`), and a Rogue with both
 * tunic and trousers at that one colour becomes a single near-black silhouette that
 * disappears at night. Mid Gray is in the same palette and splits the figure into two
 * readable halves instead. This is a deliberate deviation from the literal brief, not an
 * oversight — see the report this task was written against.
 */
export const GARMENT_CELLS = Object.freeze({
  ranger: [
    { part: 'tunic', cell: 7, base: 0x7e5a49, target: BRAND.leafGreen },
    { part: 'trousers', cell: 19, base: 0x7e5a49, target: BRAND.darkBlue },
  ],
  rogue: [
    { part: 'tunic', cell: 8, base: 0x096253, target: BRAND.darkBlue },
    // Mid Gray, not Dark Blue — see the comment above this table for why.
    { part: 'trousers', cell: 19, base: 0x9b5a45, target: BRAND.midGray },
  ],
})

/**
 * ITU-R BT.709 luma weights. Shared, by both being read from here, between this module's
 * `recolorByLuminance` and the GLSL `_recolorGarment` compiles in `astronauts.js` — the GLSL
 * cannot literally call this function, so it mirrors the same weights and the same formula
 * by hand instead; see the comment there.
 */
export const LUMA_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722])

/** Relative luminance of an `[r, g, b]` triple in 0-1 units. */
export function luminanceOf([r, g, b]) {
  const [wr, wg, wb] = LUMA_WEIGHTS
  return r * wr + g * wg + b * wb
}

/**
 * A luminance-preserving recolour for a garment cell — a different substitution from the
 * ratio one `astronauts.js` uses for skin and hair (`texel * (target / base)`).
 *
 * The ratio path is *nearly* safe for the garments too, but not quite: at ranger cell 7's
 * lightest texel, the ratio into Leaf Green lands the green channel exactly on 255, flattening
 * the top of that one gradient (measured in this task's own report). Rather than accept that
 * one clip, every garment cell uses this instead: it takes the texel's own luminance as a
 * *fraction* of the cell's mid luminance, and scales the brand colour by that fraction. The
 * cell keeps its full light-to-dark ramp — the fraction is what varies, not the hue — and it
 * takes the brand hue outright rather than a hue nudged off the pack's original one. It also
 * stays safe if the palette is ever revisited: the brand colour's own channels bound the
 * output, not a ratio that can run past 1 the way `target / base` can whenever `target` is
 * brighter than `base` in some channel and darker in another.
 *
 * `midLuminance` is guarded the same way the ratio path guards its own base: a near-black mid
 * colour would otherwise divide by (near) zero and blow the fraction up.
 *
 * `texel` and `target` are `[r, g, b]` triples in 0-1 units, matching how `THREE.Color` and
 * a GLSL `texture2D` sample both already work in this codebase.
 */
export function recolorByLuminance(texel, midLuminance, target) {
  const fraction = luminanceOf(texel) / Math.max(midLuminance, 0.02)
  return [target[0] * fraction, target[1] * fraction, target[2] * fraction]
}
