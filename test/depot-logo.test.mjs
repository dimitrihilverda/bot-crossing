import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { inflateSync } from 'node:zlib'

/**
 * The company's logo, as it is served to the depot's sign.
 *
 * It was supplied as artwork on a white card, and what was asked for was the logo *without*
 * that card. A knocked-out logo and a logo still on its card look identical in a file
 * listing, in a thumbnail, and in every preview that composites onto white — the difference
 * only shows once it is on a terracotta wall. So it is checked here instead.
 *
 * Decoded by hand rather than with an image library: there is no decoder among this project's
 * dependencies, and a PNG that this project itself wrote is a narrow enough case — 8-bit
 * RGBA, not interlaced — to read with `zlib` and thirty lines.
 */
const FILE = 'public/assets/moving-in-logo.png'

/** Just enough PNG: header, IHDR, the concatenated IDAT, and the five scanline filters. */
function decode(path) {
  const buf = readFileSync(path)
  assert.deepEqual([...buf.subarray(0, 8)], [137, 80, 78, 71, 13, 10, 26, 10], `${path} is not a PNG`)

  let at = 8
  let ihdr = null
  const idat = []
  while (at < buf.length) {
    const length = buf.readUInt32BE(at)
    const type = buf.toString('ascii', at + 4, at + 8)
    const data = buf.subarray(at + 8, at + 8 + length)
    if (type === 'IHDR') {
      ihdr = {
        width: data.readUInt32BE(0),
        height: data.readUInt32BE(4),
        depth: data[8],
        colour: data[9],
        interlace: data[12],
      }
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    at += 12 + length
  }

  assert.ok(ihdr, 'no IHDR')
  assert.equal(ihdr.depth, 8, 'expected an 8-bit PNG')
  assert.equal(ihdr.colour, 6, 'expected RGBA (colour type 6) — a PNG with no alpha channel cannot have had its card knocked out')
  assert.equal(ihdr.interlace, 0, 'expected a non-interlaced PNG')

  const { width, height } = ihdr
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * 4
  const out = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1))
    for (let i = 0; i < stride; i++) {
      const a = i >= 4 ? out[y * stride + i - 4] : 0
      const b = y > 0 ? out[(y - 1) * stride + i] : 0
      const c = i >= 4 && y > 0 ? out[(y - 1) * stride + i - 4] : 0
      let v = line[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        // Paeth: whichever of left, above and above-left the prediction is nearest.
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      } else if (filter !== 0) assert.fail(`unknown PNG filter ${filter}`)
      out[y * stride + i] = v & 0xff
    }
  }
  return { width, height, pixels: out }
}

const logo = decode(FILE)
const at = (x, y) => {
  const p = (y * logo.width + x) * 4
  return { r: logo.pixels[p], g: logo.pixels[p + 1], b: logo.pixels[p + 2], a: logo.pixels[p + 3] }
}

test('the logo has no card behind it', () => {
  // Every corner, because a knockout that missed one edge still looks right in the middle.
  for (const [x, y] of [
    [0, 0],
    [logo.width - 1, 0],
    [0, logo.height - 1],
    [logo.width - 1, logo.height - 1],
  ]) {
    assert.equal(at(x, y).a, 0, `the pixel at ${x},${y} is opaque — the white card is still there`)
  }
})

test('most of the logo is background, and what is left is ink', () => {
  // The shape of a wordmark: mostly space. A file that came out nearly all opaque is a card
  // that was tinted rather than removed, which no single corner would catch.
  let opaque = 0
  let clear = 0
  for (let i = 3; i < logo.pixels.length; i += 4) {
    if (logo.pixels[i] > 250) opaque++
    else if (logo.pixels[i] < 5) clear++
  }
  const total = logo.width * logo.height
  assert.ok(clear / total > 0.4, `only ${Math.round((clear / total) * 100)}% of the logo is transparent`)
  assert.ok(opaque / total > 0.2, `only ${Math.round((opaque / total) * 100)}% of the logo is ink — is it all edge?`)
})

test('the logo is trimmed to its own artwork', () => {
  // The sign takes its proportions straight from the image, so a margin of empty pixels would
  // shrink the logo on the wall and sit it off-centre, with nothing on screen to explain why.
  const opaqueIn = (pick) => {
    for (let y = 0; y < logo.height; y++) {
      for (let x = 0; x < logo.width; x++) {
        if (pick(x, y) && at(x, y).a > 8) return true
      }
    }
    return false
  }
  const edge = 3
  assert.ok(opaqueIn((x) => x < edge), 'the logo has empty space down its left edge')
  assert.ok(opaqueIn((x) => x >= logo.width - edge), 'the logo has empty space down its right edge')
  assert.ok(opaqueIn((_, y) => y < edge), 'the logo has empty space across its top')
  assert.ok(opaqueIn((_, y) => y >= logo.height - edge), 'the logo has empty space across its bottom')
})

test('the logo still has its own two colours', () => {
  // The knockout un-premultiplies every partly-transparent pixel against the card it was on,
  // which is the step that stops dark edges keeping a white fringe — and the step that would
  // wash the artwork out if it were applied with the wrong card colour. Both of the brand's
  // colours have to survive it: the mark is a light green and the lettering a dark navy.
  let green = 0
  let navy = 0
  for (let i = 0; i < logo.pixels.length; i += 4) {
    const [r, g, b, a] = [logo.pixels[i], logo.pixels[i + 1], logo.pixels[i + 2], logo.pixels[i + 3]]
    if (a < 250) continue
    if (g > 180 && g > b + 60 && r > 150) green++
    if (r < 90 && g < 100 && b < 120) navy++
  }
  assert.ok(green > 100, `only ${green} green pixels — the mark has been washed out`)
  assert.ok(navy > 500, `only ${navy} navy pixels — the lettering has been washed out`)
})
