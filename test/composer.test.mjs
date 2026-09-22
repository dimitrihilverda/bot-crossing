import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { placePart } from '../src/world/buildings.js'
import { ATLAS } from '../src/world/kit.js'

/**
 * Composer needs three.js and a loaded glb, so it cannot be constructed under node --test.
 * What is worth locking down is the thing that breaks quietly: a recipe asking for a city
 * part and being handed the base kit's registry, which throws "no part named" only once a
 * scene is built.
 */
test('Composer resolves parts against its own kit, not a hardcoded one', () => {
  const src = readFileSync('src/world/buildings.js', 'utf8')
  assert.doesNotMatch(src, /part\(\s*name\s*,\s*'base'/, "Composer still hardcodes the 'base' kit")
  assert.match(src, /this\.kit/, 'Composer does not carry a kit')
})

/**
 * `placePart` is the half of `Composer.add` that does not need a kit: everything from a raw
 * geometry to where it ends up. It is the half that is worth testing, because the *order* is
 * the whole of it — scale, repaint, yaw, offset — and every way of getting the order wrong
 * looks like a bug at the call site rather than here.
 */
function box(w, h, d) {
  const geo = new THREE.BoxGeometry(w, h, d)
  // BoxGeometry arrives with UVs spanning the whole 0..1 square; put them in one swatch, the
  // way every part in a kit is authored, so a repaint has something to move.
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) / ATLAS.cols, uv.getY(i) / ATLAS.rows)
  return geo
}

function bounds(geo) {
  geo.computeBoundingBox()
  const { min, max } = geo.boundingBox
  return { min: [min.x, min.y, min.z], max: [max.x, max.y, max.z] }
}

test('placePart scales each axis on its own when asked to', () => {
  // Per-axis scale is what a greybox pack is composed with: one wall piece stretched to a
  // side's full length. Falling back to the uniform scale gives a wall the right length and
  // the wrong height, which reads as a hole in the building rather than as a wrong number.
  const b = bounds(placePart(box(4, 4, 1), { sx: 3, sz: 0.3 }))
  assert.equal(b.max[0] - b.min[0], 12, 'sx did not stretch the piece')
  assert.equal(b.max[1] - b.min[1], 4, 'sy should have been left alone')
  assert.ok(Math.abs(b.max[2] - b.min[2] - 0.3) < 1e-6, 'sz did not thin the piece')
})

test('placePart scales before it turns, and turns before it moves', () => {
  // Turn first and the stretch lands on the wrong axis; move first and the piece swings round
  // the building's origin instead of turning on the spot. Both are placement bugs that point
  // at the recipe rather than at this.
  const b = bounds(placePart(box(4, 4, 1), { sx: 3, ry: Math.PI / 2, x: 10 }))
  assert.ok(Math.abs(b.max[2] - b.min[2] - 12) < 1e-6, 'the 12-unit length did not end up along z')
  assert.ok(Math.abs(b.max[0] - b.min[0] - 1) < 1e-6, 'the 1-unit thickness did not end up along x')
  assert.ok(Math.abs((b.min[0] + b.max[0]) / 2 - 10) < 1e-6, 'the piece did not end up at x = 10')
})

test('placePart repaints a part into the cell the recipe named', () => {
  // The greybox pack arrives entirely on one swatch, so this is the step between a pile of
  // yellow blocks and a brick wall. Skipping it is invisible in geometry and unmissable on
  // screen.
  const geo = placePart(box(4, 4, 1), { cell: 6 })
  const uv = geo.getAttribute('uv')
  for (let i = 0; i < uv.count; i++) {
    const col = Math.min(ATLAS.cols - 1, Math.floor(uv.getX(i) * ATLAS.cols))
    const row = Math.min(ATLAS.rows - 1, Math.floor(uv.getY(i) * ATLAS.rows))
    assert.equal(row * ATLAS.cols + col, 6, `vertex ${i} is in cell ${row * ATLAS.cols + col}, not 6`)
  }
})

test('placePart leaves a part alone when the recipe asks for nothing', () => {
  const b = bounds(placePart(box(4, 4, 1), {}))
  assert.deepEqual(b.min, [-2, -2, -0.5])
  assert.deepEqual(b.max, [2, 2, 0.5])
})
