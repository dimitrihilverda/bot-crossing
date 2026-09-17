import test from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'

const COLS = 8
const ROWS = 4
const doc = await new NodeIO().read('public/assets/city.glb')

/** Bounding boxes of a part's vertices, grouped by which atlas cell they sample. */
function byAtlasCell(name) {
  const node = doc.getRoot().listNodes().find((n) => n.getName() === name)
  assert.ok(node, `${name} is missing from city.glb`)
  const out = new Map()
  for (const prim of node.getMesh().listPrimitives()) {
    const pos = prim.getAttribute('POSITION')
    const uv = prim.getAttribute('TEXCOORD_0')
    const p = []
    const t = []
    for (let i = 0; i < pos.getCount(); i++) {
      pos.getElement(i, p)
      uv.getElement(i, t)
      const cell =
        Math.min(COLS - 1, Math.floor(t[0] * COLS)) + COLS * Math.min(ROWS - 1, Math.floor(t[1] * ROWS))
      const b = out.get(cell) || { x0: Infinity, x1: -Infinity, z0: Infinity, z1: -Infinity }
      b.x0 = Math.min(b.x0, p[0])
      b.x1 = Math.max(b.x1, p[0])
      b.z0 = Math.min(b.z0, p[2])
      b.z1 = Math.max(b.z1, p[2])
      out.set(cell, b)
    }
  }
  return out
}

const near = (a, b) => Math.abs(a - b) < 0.02

test('road_straight runs along its own Z axis', () => {
  const cells = byAtlasCell('road_straight')
  const white = cells.get(1)
  // The centre line: a narrow band of X, the full length of Z.
  assert.ok(near(white.x0, -0.02) && near(white.x1, 0.02), `centre line x ${white.x0}..${white.x1}`)
  assert.ok(near(white.z0, -0.9) && near(white.z1, 0.9), `centre line z ${white.z0}..${white.z1}`)
  const amber = cells.get(11)
  // The edge lines: two strips at x = +/-0.62, each the full length of Z.
  assert.ok(near(amber.x0, -0.62) && near(amber.x1, 0.62), `edge lines x ${amber.x0}..${amber.x1}`)
  assert.ok(near(amber.z0, -1) && near(amber.z1, 1), `edge lines z ${amber.z0}..${amber.z1}`)
})

test('road_corner joins its +Z edge to its +X edge', () => {
  const cells = byAtlasCell('road_corner')
  const white = cells.get(1)
  // The centre line is a quarter arc of radius 1 about the tile's (+X,+Z) corner, running
  // from (0,+1) to (+1,0), so it lives entirely in the +X/+Z quadrant. A tile turned 90 or
  // 180 degrees puts this box in a different quadrant — which is what makes this test able to
  // see the defect that seam-hunting could not. road_corner and road_straight are the same
  // slab: a wrong rotation produces no seam, no gap and no z-fighting, only paint that runs
  // the wrong way.
  assert.ok(white.x0 > -0.05 && white.z0 > -0.05, `centre arc starts at ${white.x0},${white.z0}`)
  assert.ok(near(white.x1, 0.9) && near(white.z1, 0.9), `centre arc ends at ${white.x1},${white.z1}`)
  const amber = cells.get(11)
  // Inner edge line: radius 0.38 about (+1,+1). Outer: radius 1.62, clipped by the tile.
  // Their union is exactly this box, and only this rotation produces it.
  assert.ok(near(amber.x0, -0.62) && near(amber.x1, 1), `edge arcs x ${amber.x0}..${amber.x1}`)
  assert.ok(near(amber.z0, -0.62) && near(amber.z1, 1), `edge arcs z ${amber.z0}..${amber.z1}`)
})

test('road_corner_curved joins its +Z edge to its +X edge, the same ports as road_corner', () => {
  // The playful revision switches bends from the hard 90-degree road_corner to this rounded
  // piece, and this project's defining defect was a corner rotated the wrong way — the road
  // pieces are all the same 2x2 slab, so a wrong rotation produces no seam, no gap and no
  // z-fighting, only paint that runs the wrong way. Measured exactly the way road_corner is
  // measured above, not assumed to match it: white centre arc bounded x -0.02..0.90, z
  // -0.02..0.90 (the same radius-1 quarter arc about the tile's +X/+Z corner), amber arcs
  // bounded x -0.62..1.00, z -0.62..1.00 (the same inner/outer edge-line pair) — identical
  // bounding boxes to road_corner's, so it joins the same two edges: +Z to +X. That is what
  // lets `CORNER_ARMS` in road-mesh.js stay `[S, E]` for the curved part too, rather than
  // needing its own rotation table.
  const cells = byAtlasCell('road_corner_curved')
  const white = cells.get(1)
  assert.ok(white.x0 > -0.05 && white.z0 > -0.05, `centre arc starts at ${white.x0},${white.z0}`)
  assert.ok(near(white.x1, 0.9) && near(white.z1, 0.9), `centre arc ends at ${white.x1},${white.z1}`)
  const amber = cells.get(11)
  assert.ok(near(amber.x0, -0.62) && near(amber.x1, 1), `edge arcs x ${amber.x0}..${amber.x1}`)
  assert.ok(near(amber.z0, -0.62) && near(amber.z1, 1), `edge arcs z ${amber.z0}..${amber.z1}`)
})

test('road_tsplit runs along Z with a branch reaching +X', () => {
  // Measured the same way as road_straight and road_corner above: its white centre line is
  // the straight's own band (x -0.02..0.90 — widened past 0 by the branch, still the full
  // length of Z), and its amber edge lines reach x = 1.00 on the branch side only, while
  // staying at the straight's -0.62 on the other.
  const cells = byAtlasCell('road_tsplit')
  const white = cells.get(1)
  assert.ok(near(white.x0, -0.02) && near(white.x1, 0.9), `centre line x ${white.x0}..${white.x1}`)
  assert.ok(near(white.z0, -0.9) && near(white.z1, 0.9), `centre line z ${white.z0}..${white.z1}`)
  const amber = cells.get(11)
  assert.ok(near(amber.x0, -0.62) && near(amber.x1, 1), `edge lines x ${amber.x0}..${amber.x1}`)
  assert.ok(near(amber.z0, -1) && near(amber.z1, 1), `edge lines z ${amber.z0}..${amber.z1}`)
})

test('road_straight_crossing runs along Z, a drop-in replacement for road_straight', () => {
  // Same amber edge lines as road_straight, at x = +/-0.62 down the full length of Z; the
  // white zebra stripes cross them as a wide, shallow band (x -0.82..0.82, z -0.30..0.30). A
  // crossing therefore takes the same position and the same `ry` a straight would.
  const cells = byAtlasCell('road_straight_crossing')
  const white = cells.get(1)
  assert.ok(near(white.x0, -0.82) && near(white.x1, 0.82), `zebra stripes x ${white.x0}..${white.x1}`)
  assert.ok(near(white.z0, -0.3) && near(white.z1, 0.3), `zebra stripes z ${white.z0}..${white.z1}`)
  const amber = cells.get(11)
  assert.ok(near(amber.x0, -0.62) && near(amber.x1, 0.62), `edge lines x ${amber.x0}..${amber.x1}`)
  assert.ok(near(amber.z0, -1) && near(amber.z1, 1), `edge lines z ${amber.z0}..${amber.z1}`)
})
