/**
 * Where a numbered cell sits in a KayKit character atlas.
 *
 * Every character texture in the Adventurers pack is one 1024 x 1024 PNG laid out as eight
 * columns by four rows, each cell a vertical gradient and the bottom row filler. That is the
 * same shape `tools/atlas-cells.mjs` reads for the kit atlases.
 *
 * Three of those cells are what this project repaints per crew member, measured from the UVs
 * of `Ranger_Head` and `Rogue_Head` rather than guessed:
 *
 *  - cell 0, `#f6c09c`, skin — 322 vertices on the Ranger's head, 309 on the Rogue's
 *  - cell 1, `#9b5a45`, hair — 770 and 1640
 *  - cell 2, `#13191b`, eyes and brows — 80 and 98
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
export const CELL_EYES = 2

/** The cell's own mid colour, for the ratio substitution the shader does. */
export const CELL_BASE = Object.freeze({
  [CELL_SKIN]: 0xf6c09c,
  [CELL_HAIR]: 0x9b5a45,
  [CELL_EYES]: 0x13191b,
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
