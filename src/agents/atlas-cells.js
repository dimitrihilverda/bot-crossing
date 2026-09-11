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
