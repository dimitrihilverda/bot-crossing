import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { CELL_SIZE } from '../src/world/grid.js'
import { readFileSync } from 'node:fs'
import { SUBGRID, conformToGround } from '../src/world/road-mesh.js'

/**
 * Why the carriageway is bent onto the ground instead of laid on it in slabs.
 *
 * Each road tile used to be placed at the height of the ground under its own middle. A tile
 * is flat, so on any slope at all a road became a staircase: over one straight row of 56
 * tiles the median riser was 0.0196 and the worst 0.0521, against the tile's own raised rim
 * of 0.036. Overlapping the tiles hid the seam between two risers but left the risers, and a
 * staircase is exactly what "the road doesn't flow" looks like.
 *
 * Now every vertex takes the ground at its *own* position rather than its tile's. Two tiles
 * meeting at a seam put their vertices in the same places, so they arrive at the same
 * heights, and the surface is continuous across the join by construction rather than by a
 * tolerance. That is what these tests check: not that the seam is small, but that there is
 * no seam.
 */

const step = CELL_SIZE / SUBGRID

/** A slope steep enough that a per-tile placement would step visibly. */
const slope = (x, z) => x * 0.02 + z * 0.013

/** One flat tile, as the kit authors it: a slab with a surface and a raised rim. */
function slab(cx, cz) {
  const geo = new THREE.BufferGeometry()
  const verts = []
  for (const dx of [-step / 2, step / 2]) {
    for (const dz of [-step / 2, step / 2]) {
      for (const y of [0, 0.084, 0.12]) verts.push(cx + dx, y, cz + dz)
    }
  }
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(verts), 3))
  return geo
}

/** Positions are stored as float32, so everything here is compared at single precision —
 *  seven significant figures, which is every bit the geometry actually holds. */
const EXACT = 1e-6

/** Every vertex, as `x,z -> y`. */
function heights(geo) {
  const pos = geo.getAttribute('position')
  const out = new Map()
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`
    if (!out.has(key)) out.set(key, [])
    out.get(key).push(pos.getY(i))
  }
  return out
}

test('a tile bent onto the ground keeps its own shape', () => {
  // Conforming must move the slab, not deform what the kit authored into it: the surface has
  // to stay 0.084 above the base and the rim 0.12, or the road gets a wavy kerb and paint
  // that dips into its own asphalt.
  const geo = conformToGround(slab(0, 0), slope)
  const pos = geo.getAttribute('position')
  const byColumn = new Map()
  for (let i = 0; i < pos.count; i++) {
    const key = `${pos.getX(i).toFixed(4)},${pos.getZ(i).toFixed(4)}`
    if (!byColumn.has(key)) byColumn.set(key, [])
    byColumn.get(key).push(pos.getY(i))
  }
  for (const [key, ys] of byColumn) {
    ys.sort((a, b) => a - b)
    assert.ok(Math.abs(ys[1] - ys[0] - 0.084) < EXACT, `the surface is ${ys[1] - ys[0]} above the base at ${key}`)
    assert.ok(Math.abs(ys[2] - ys[0] - 0.12) < EXACT, `the rim is ${ys[2] - ys[0]} above the base at ${key}`)
  }
})

test('two tiles that meet arrive at the same height along the whole seam', () => {
  // The property the whole fix rests on. `conformToGround` is a pure function of a vertex's
  // own x and z, so a vertex shared by two tiles is computed twice and comes out the same
  // both times — no tolerance, no epsilon, the same number.
  const left = heights(conformToGround(slab(0, 0), slope))
  const right = heights(conformToGround(slab(step, 0), slope))

  // Two square tiles meet along one edge, which is two corners — and each corner is a column
  // of three vertices: the base, the surface and the rim.
  let shared = 0
  for (const [key, ys] of left) {
    if (!right.has(key)) continue
    shared++
    const a = ys.slice().sort((m, n) => m - n)
    const b = right.get(key).slice().sort((m, n) => m - n)
    assert.equal(a.length, 3, `${key} is not a full column of vertices`)
    for (let i = 0; i < a.length; i++) {
      assert.ok(Math.abs(a[i] - b[i]) < EXACT, `the two tiles disagree at ${key}: ${a[i]} against ${b[i]}`)
    }
  }
  assert.equal(shared, 2, `${shared} corners are shared along the seam, not the two an edge has`)
})

test('the road follows the ground rather than a step per tile', () => {
  // What the owner actually saw. Across a run of tiles the surface must rise smoothly: no two
  // neighbouring vertices may differ by more than the ground itself does between them.
  const run = []
  for (let i = 0; i < 6; i++) run.push(conformToGround(slab(i * step, 0), slope))

  const surface = []
  for (const geo of run) {
    const pos = geo.getAttribute('position')
    for (let i = 0; i < pos.count; i++) surface.push({ x: pos.getX(i), z: pos.getZ(i), y: pos.getY(i) })
  }
  for (const v of surface) {
    // Every vertex sits exactly one authored offset above the ground beneath it.
    const above = v.y - slope(v.x, v.z)
    assert.ok(
      [0, 0.084, 0.12].some((o) => Math.abs(above - o) < EXACT),
      `a vertex sits ${above} above the ground, which is none of the tile's own heights`
    )
  }
})

test('conforming does nothing at all on level ground', () => {
  // The case that has to stay exactly as it was: the town is nearly flat, and a road on a
  // level patch must come out identical to the slab that went in, to the last bit.
  const before = slab(0, 0)
  const copy = before.getAttribute('position').array.slice()
  const after = conformToGround(slab(0, 0), () => 0)
  assert.deepEqual([...after.getAttribute('position').array], [...copy])
})

test('the carriageway is the thing that gets conformed, and the furniture is not', () => {
  // Read rather than run: `createRoads` needs a loaded glb and a WebGL context, so it cannot
  // be built under node — the same reason `composer.test.mjs` checks its own wiring this way.
  // Without this the whole fix can be switched off at the call site with one argument while
  // every test above still passes, which is exactly what one mutant did.
  const src = readFileSync('src/world/road-mesh.js', 'utf8')

  const carriageway = src.match(/for \(const tile of roadTiles\) place\([^\n]*\)/)
  assert.ok(carriageway, 'the carriageway is no longer placed in one loop over roadTiles')
  assert.match(carriageway[0], /,\s*true\s*\)$/, 'the carriageway is placed without being marked for conforming')

  const verge = src.match(/for \(const f of furniture\) place\([^\n]*\)/)
  assert.ok(verge, 'the verge furniture is no longer placed in one loop')
  assert.doesNotMatch(verge[0], /,\s*true\s*\)$/, 'all verge furniture is being conformed — that is a bent lamp post')
})
