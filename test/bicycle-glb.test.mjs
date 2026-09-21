import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'
import { CAR_BODY_WIDTH } from '../src/world/deliveries.js'

/**
 * The bicycle is the one part of the city kit that KayKit did not make: it is grafted in from
 * Quaternius' CC0 pack by `tools/build-bike.mjs`, because none of KayKit's 23 packs has one
 * and a Dutch street without a bicycle is missing the thing that makes it Dutch.
 *
 * That graft is a build step over a checked-in binary, so it cannot be re-run on a fresh clone
 * to prove it worked. These assertions stand in for that: they read the shipped glb and check
 * the bicycle is there, is the right way up, the right way round, the right size, and painted
 * out of the same atlas as everything around it.
 */
const doc = await new NodeIO().read('public/assets/city.glb')
const node = doc.getRoot().listNodes().find((n) => n.getName() === 'bicycle')

const COLS = 8
const ROWS = 4

/** The bicycle's own bounding box, and every atlas cell its vertices sample. */
function measure() {
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  const cells = new Set()
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const uv = prim.getAttribute('TEXCOORD_0')
    const p = []
    const t = []
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p)
      uv.getElement(i, t)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p[a])
        max[a] = Math.max(max[a], p[a])
      }
      cells.add(
        Math.min(COLS - 1, Math.floor(t[0] * COLS)) + COLS * Math.min(ROWS - 1, Math.floor(t[1] * ROWS))
      )
    }
  }
  return { min, max, size: max.map((v, a) => v - min[a]), cells }
}

test('the city kit has a bicycle in it', () => {
  assert.ok(node, 'city.glb has no `bicycle` node — was build-bike.mjs skipped?')
  assert.ok(node.getMesh(), 'the bicycle node carries no mesh')
})

test('a bicycle stands on the ground rather than straddling it', () => {
  // The source model centres its wheels on y=0, so a bicycle placed at ground height would be
  // buried to its axles — the same fault the cars had. The graft lifts it by a wheel radius,
  // and this is what holds that.
  const { min } = measure()
  assert.ok(Math.abs(min[1]) < 1e-6, `the bicycle's lowest point is ${min[1].toFixed(4)}, not 0`)
})

test('a bicycle faces the way every other part of this kit faces', () => {
  // Front on local +Z, like the cars and like everything `atan2(d.x, d.z)` aims. The source
  // model faces the other way, so the graft turns it; get that wrong and every parked bicycle
  // in the colony points into the wall it is leaning against.
  const { min, max } = measure()
  // The handlebars are the tallest thing on a bicycle and they are over the front wheel, so
  // the top half of the model has to sit forward of its own middle.
  let frontWeight = 0
  let backWeight = 0
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const p = []
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p)
      if (p[1] > max[1] * 0.75) (p[2] > 0 ? (frontWeight += 1) : (backWeight += 1))
    }
  }
  assert.ok(
    frontWeight > backWeight,
    `the tall end of the bicycle is at -z (${frontWeight} vs ${backWeight}), so it is facing backwards`
  )
  assert.ok(Math.abs(min[2] + max[2]) < 1e-3, 'the bicycle is not centred on its own length')
})

test('a bicycle is the size of a bicycle beside these cars', () => {
  // Anchored to the car rather than to a guess at the pack's metres-per-unit, because beside a
  // car is where it will always be seen: 1.75m against 4.2m is 42%.
  const { size } = measure()
  const carLength = 0.938
  const ratio = size[2] / carLength
  assert.ok(ratio > 0.38 && ratio < 0.46, `the bicycle is ${(ratio * 100).toFixed(0)}% of a car's length`)
  // And narrower than a car, by a lot — a bicycle that is not is a bicycle scaled by its
  // bounding box instead of its length.
  assert.ok(size[0] < CAR_BODY_WIDTH * 0.5, `the bicycle is ${size[0].toFixed(3)} wide`)
  assert.ok(size[1] > size[0], 'a bicycle is taller than it is wide')
})

test('a bicycle is painted out of the city atlas, not out of its own colours', () => {
  // The source model carries four materials that are all the same flat grey — Quaternius
  // colours in Blender, not in the OBJ — so the graft maps each one to a cell of the city
  // atlas instead. If that mapping is ever lost, every vertex collapses to the atlas's
  // top-left corner, which is a silent wrong colour rather than a failure.
  const { cells } = measure()
  assert.deepEqual([...cells].sort((a, b) => a - b), [4, 5, 15, 20])
  // Cell 5 is `CELL_CITY.ACCENT`, the one `decorate()` recolours per material. The frame takes
  // it so a bicycle can be tinted the way a car is; losing it makes every bicycle the same.
  assert.ok(cells.has(5), 'the frame no longer samples the accent cell, so bicycles cannot be tinted')
})
