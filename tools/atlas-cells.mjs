/**
 * Prints the colour of each cell in a kit's 8x4 gradient atlas.
 *
 * The accent trick needs one cell that reads as "this building's colour" — a saturated
 * trim swatch rather than a structural one. Eyeballing a 1024px texture does not tell you
 * a cell *index*, and the index is what the shader mask wants.
 *
 * Usage: node tools/atlas-cells.mjs public/assets/city.glb
 */
import { NodeIO } from '@gltf-transform/core'
import sharp from 'sharp'

const [file] = process.argv.slice(2)
if (!file) {
  console.error('usage: atlas-cells.mjs <glb>')
  process.exit(1)
}

const doc = await new NodeIO().read(file)
const texture = doc.getRoot().listTextures()[0]
if (!texture) throw new Error(`${file}: no texture`)

const COLS = 8
const ROWS = 4
const img = sharp(Buffer.from(texture.getImage()))
const { width, height } = await img.metadata()
const raw = await img.ensureAlpha().raw().toBuffer()

const cellW = Math.floor(width / COLS)
const cellH = Math.floor(height / ROWS)

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    // The middle of the cell: every swatch is a gradient, and the edges are exactly
    // where one swatch bleeds into the next.
    const x = col * cellW + Math.floor(cellW / 2)
    const y = row * cellH + Math.floor(cellH / 2)
    const i = (y * width + x) * 4
    const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? '0.00' : ((max - min) / max).toFixed(2)
    const hex = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
    console.log(`cell ${String(row * COLS + col).padStart(2)}  #${hex}  sat ${sat}`)
  }
}
