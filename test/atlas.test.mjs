import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import * as THREE from 'three'
import { NodeIO } from '@gltf-transform/core'
import { ATLAS, CELL_PROTOTYPE, recell } from '../src/world/kit.js'

/**
 * The accent cell indices are hand-picked from the atlases and easy to break by accident.
 * A cell outside 0..31 silently masks nothing, which shows up as "no repo has a colour"
 * rather than as an error — so assert the range rather than trusting the eye.
 */
test('accent cells are inside the 8x4 atlas', () => {
  const src = readFileSync('src/world/kit.js', 'utf8')
  for (const name of ['CELL_CITY', 'CELL_FURNITURE']) {
    const match = src.match(new RegExp(`${name}\\s*=\\s*\\{[^}]*ACCENT:\\s*(\\d+)`))
    assert.ok(match, `${name}.ACCENT is not defined in src/world/kit.js`)
    const cell = Number(match[1])
    assert.ok(cell >= 0 && cell < 32, `${name}.ACCENT = ${cell} is outside 0..31`)
  }
})

test('the city and furniture kits are registered', () => {
  const src = readFileSync('src/world/kit.js', 'utf8')
  assert.match(src, /city:\s*\{\s*file:\s*'city\.glb'/, 'city kit is not in KITS')
  assert.match(src, /furniture:\s*\{\s*file:\s*'furniture\.glb'/, 'furniture kit is not in KITS')
})

/** Which swatch a UV lands in — the same arithmetic the building shader's `atlasCell()` does. */
function cellOf(u, v) {
  const col = Math.min(ATLAS.cols - 1, Math.floor(u * ATLAS.cols))
  const row = Math.min(ATLAS.rows - 1, Math.floor(v * ATLAS.rows))
  return row * ATLAS.cols + col
}

test('accent cells are inside the 8x4 atlas, prototype included', () => {
  for (const cell of Object.values(CELL_PROTOTYPE)) {
    assert.ok(Number.isInteger(cell) && cell >= 0 && cell < ATLAS.cols * ATLAS.rows, `CELL_PROTOTYPE has ${cell}, outside 0..31`)
  }
})

test('recell moves a real prototype part onto the swatch it is asked for', async () => {
  // Against the pack itself, not a made-up UV set. Every structural piece in Prototype Bits is
  // authored on one swatch — a yellow — so a hall composed straight out of it comes out
  // yellow, and this is the single step between that and a brick wall.
  const doc = await new NodeIO().read('public/assets/prototype.glb')
  const node = doc.getRoot().listNodes().find((n) => n.getName() === 'Primitive_Wall')
  assert.ok(node, 'Primitive_Wall is missing from prototype.glb')
  const source = node.getMesh().listPrimitives()[0].getAttribute('TEXCOORD_0')

  const uv = new Float32Array(source.getCount() * 2)
  for (let i = 0; i < source.getCount(); i++) {
    const [u, v] = source.getElement(i, [0, 0])
    uv[i * 2] = u
    uv[i * 2 + 1] = v
  }
  const before = [...new Set([...Array(source.getCount()).keys()].map((i) => cellOf(uv[i * 2], uv[i * 2 + 1])))]
  assert.deepEqual(before, [0], `the wall is authored across cells ${before.join(',')}, not on one`)

  // Both a swatch in the pack's own row and one a row down, so a shift that only moves the
  // column cannot pass for a working one.
  assert.notEqual(
    Math.floor(CELL_PROTOTYPE.BRICK / ATLAS.cols),
    Math.floor(CELL_PROTOTYPE.ACCENT / ATLAS.cols),
    'BRICK and ACCENT are in the same atlas row, so this test cannot see a missing row shift'
  )
  for (const target of [CELL_PROTOTYPE.BRICK, CELL_PROTOTYPE.ACCENT]) {
    const geo = new THREE.BufferGeometry()
    geo.setAttribute('uv', new THREE.BufferAttribute(uv.slice(), 2))
    recell(geo, target)

    const moved = geo.getAttribute('uv')
    for (let i = 0; i < moved.count; i++) {
      assert.equal(
        cellOf(moved.getX(i), moved.getY(i)),
        target,
        `vertex ${i} landed in cell ${cellOf(moved.getX(i), moved.getY(i))}, not in ${target}`
      )
      // The swatch is a gradient, and keeping where in it each vertex sat is what stops a
      // wall going flat: the shift is whole cells, never a re-layout.
      assert.ok(Math.abs(((moved.getX(i) * ATLAS.cols) % 1) - ((uv[i * 2] * ATLAS.cols) % 1)) < 1e-5, 'the u gradient moved')
      assert.ok(Math.abs(((moved.getY(i) * ATLAS.rows) % 1) - ((uv[i * 2 + 1] * ATLAS.rows) % 1)) < 1e-5, 'the v gradient moved')
    }
  }
})

test('the prototype kit is registered', () => {
  const src = readFileSync('src/world/kit.js', 'utf8')
  assert.match(src, /prototype:\s*\{\s*file:\s*'prototype\.glb'/, 'prototype kit is not in KITS')
})
