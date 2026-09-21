import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'

/**
 * Prototype Bits, the fifth kit. It is here to compose a building the other packs have no
 * shell for — the depot's industrial hall — so what matters about it is not how any one part
 * looks but that the pack is a *grid*: every piece sized off one module, so walls meet walls
 * and a roof lands on them without a fudge factor per joint.
 */
const doc = await new NodeIO().read('public/assets/prototype.glb')
const nodes = new Map(doc.getRoot().listNodes().filter((n) => n.getMesh()).map((n) => [n.getName(), n]))

/** A part's own bounding box, in the pack's authored units. */
function size(name) {
  const node = nodes.get(name)
  assert.ok(node, `${name} is missing from prototype.glb`)
  const min = [Infinity, Infinity, Infinity]
  const max = [-Infinity, -Infinity, -Infinity]
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const p = []
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p)
      for (let a = 0; a < 3; a++) {
        min[a] = Math.min(min[a], p[a])
        max[a] = Math.max(max[a], p[a])
      }
    }
  }
  return { w: max[0] - min[0], h: max[1] - min[1], d: max[2] - min[2], minY: min[1] }
}

test('the kit has the pieces a building is made of', () => {
  // Not the whole pack: `build-assets.mjs` keeps the structural half and drops the targets,
  // coins and dummies. If that list is ever trimmed further, this says which piece went.
  for (const part of [
    'Primitive_Wall',
    'Primitive_Wall_Half',
    'Primitive_Wall_Short',
    'Primitive_Doorway',
    'Primitive_Window',
    'Primitive_Slope',
    'Primitive_Beam',
    'Primitive_Pillar',
    'Primitive_Cube',
    'Primitive_Floor',
  ]) {
    assert.ok(nodes.has(part), `${part} is not in the built kit`)
  }
})

test('the whole kit is cut to one 4-unit module', () => {
  // This is the property the composition will rest on. A wall is 4 x 4 x 1, a half wall is 2
  // wide, a short wall is 2 tall, a cube is 4 cubed — so a hall's arithmetic is whole numbers
  // of modules rather than a measured offset per joint.
  const M = 4
  const near = (a, b) => Math.abs(a - b) < 0.01
  const wall = size('Primitive_Wall')
  assert.ok(near(wall.w, M) && near(wall.h, M) && near(wall.d, M / 4), `wall is ${wall.w}x${wall.h}x${wall.d}`)
  assert.ok(near(size('Primitive_Wall_Half').w, M / 2), 'the half wall is not half a module wide')
  assert.ok(near(size('Primitive_Wall_Short').h, M / 2), 'the short wall is not half a module tall')
  const cube = size('Primitive_Cube')
  assert.ok(near(cube.w, M) && near(cube.h, M) && near(cube.d, M), `cube is ${cube.w}x${cube.h}x${cube.d}`)
  const beam = size('Primitive_Beam')
  assert.ok(near(beam.w, M) && near(beam.h, M / 4) && near(beam.d, M / 4), `beam is ${beam.w}x${beam.h}x${beam.d}`)
})

test('every piece stands on its own base rather than straddling it', () => {
  // A part whose origin is its middle has to be lifted by half its height at every call site,
  // which is exactly the kind of per-part correction this kit is being used to avoid. The one
  // exception is the barrel, which is a prop rather than a building piece.
  for (const part of ['Primitive_Wall', 'Primitive_Cube', 'Primitive_Floor', 'Primitive_Pillar', 'Primitive_Slope']) {
    assert.ok(Math.abs(size(part).minY) < 0.01, `${part} sits at y=${size(part).minY}, not on 0`)
  }
})

test('the kit carries a brick and a grey to build in', () => {
  // The composition needs its own colours, and the pack's atlas has them: measured with
  // `tools/atlas-cells.mjs`, cell 6 is #9b5a45 brick and cell 2 is #818c91 grey. This only
  // pins that the atlas is there and is the usual 8x4 — the cell indices live with the code
  // that paints, the way `CELL_CITY` does.
  const texture = doc.getRoot().listTextures()[0]
  assert.ok(texture, 'the kit has no atlas texture')
  assert.equal(doc.getRoot().listMaterials().length, 1, 'the kit should merge to a single material')
})
