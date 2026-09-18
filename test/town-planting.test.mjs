import test from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import {
  greenBlocks,
  keepClearCells,
  inTown,
  blockContent,
  parkPlanting,
  parkArms,
  parkPaving,
  parkFurniture,
  parkItems,
  PARK_PATH_WIDTH,
} from '../src/world/town-plan.js'
import { planStreets } from '../src/world/streets.js'
import { vergeFurniture, furnitureWorldBounds } from '../src/world/road-mesh.js'
import { createScatter, PLANETS } from '../src/world/planet.js'
import { CELL_SIZE } from '../src/world/grid.js'

/**
 * The owner's own words, about the running app: trees and rocks were landing on the
 * carriageway. `greenBlocks` is the planting sites the fix offers; `keepClearCells` is the
 * fence that keeps everything else — streets and built blocks alike — off limits to the wild
 * scatter `createScatter` draws for the countryside. See `src/world/planet.js` and
 * `src/game/colony.js`'s `_buildScatter`.
 */

const streets = planStreets()
const cellOf = (x, z) => `${Math.round(x / CELL_SIZE)},${Math.round(z / CELL_SIZE)}`

test('green blocks are offered as planting sites', () => {
  const green = greenBlocks({ streets: streets.all, claimed: new Set() })
  assert.ok(green.length > 5, `only ${green.length} green blocks`)
  for (const g of green) {
    assert.ok(!streets.all.has(cellOf(g.x, g.z)), 'a green block is a street')
  }
})

test('a claimed cell is no longer a planting site', () => {
  const free = greenBlocks({ streets: streets.all, claimed: new Set() })
  const taken = new Set(free.slice(0, 3).map((g) => cellOf(g.x, g.z)))
  const after = greenBlocks({ streets: streets.all, claimed: taken })
  assert.equal(after.length, free.length - 3)
})

// ── keepClearCells: the per-cell fence R8 asks for ──────────────────────────────────────

test('keepClearCells fences off every one of the 150 street cells', () => {
  // 150, not the 172 of the tighten revision: the playful revision raises `JOG_CHANCE` and
  // lets a cut jog more than once (`street-plan.js`) so the network actually bends, and a
  // heavily-jogged cut's own children rectangle excludes more of its rectangle from further
  // slicing (see `JOG_CHANCE`'s own doc comment) — fewer street cells overall even though any
  // one street turns far more. See the report for the full before/after bend-count measurement.
  // The exact figure is still worth pinning: a silent drop would mean the fence swept fewer
  // cells than the real network has.
  const clear = keepClearCells({ streets: streets.all, claimed: new Set() })
  const clearKeys = new Set(clear.map((p) => cellOf(p.x, p.z)))
  assert.equal(streets.cells.length, 150, `expected 150 street cells, found ${streets.cells.length}`)
  for (const s of streets.cells) {
    assert.ok(clearKeys.has(`${s.x},${s.z}`), `street cell ${s.x},${s.z} is not fenced off`)
  }
})

test('keepClearCells never fences off a green block — that would leave nothing to plant', () => {
  const clear = keepClearCells({ streets: streets.all, claimed: new Set() })
  const clearKeys = new Set(clear.map((p) => cellOf(p.x, p.z)))
  const green = greenBlocks({ streets: streets.all, claimed: new Set() })
  for (const g of green) {
    assert.ok(!clearKeys.has(cellOf(g.x, g.z)), `green block ${cellOf(g.x, g.z)} is fenced off from its own planting`)
  }
})

// ── createScatter, with the real fence: the owner's complaint, measured ────────────────────
//
// Kit assets are not loaded under `node --test` (`loadKit` fetches over the network, which a
// unit test never does), so `createScatter` falls back to its primitive shapes here rather
// than the forest kit's models. That is fine: this exercises the placement algorithm and the
// `keepClear` gate, not the geometry, and both are identical either way.

function instancePositions(group) {
  const out = []
  const m = new THREE.Matrix4()
  const pos = new THREE.Vector3()
  const quat = new THREE.Quaternion()
  const scale = new THREE.Vector3()
  for (const mesh of group.children) {
    for (let i = 0; i < mesh.count; i++) {
      mesh.getMatrixAt(i, m)
      m.decompose(pos, quat, scale)
      out.push({ x: pos.x, z: pos.z })
    }
  }
  return out
}

test('before the fix (no town-aware keepClear), scatter lands on street cells', () => {
  const before = instancePositions(createScatter(PLANETS.terra, 1, [], 4242))
  const onStreet = before.filter((p) => streets.all.has(cellOf(p.x, p.z))).length
  assert.ok(onStreet > 0, `expected props on a street cell with no town fence, got ${onStreet}`)
})

test('after the fix, keepClearCells keeps every scatter prop off every street cell', () => {
  const clear = keepClearCells({ streets: streets.all, claimed: new Set() })
  const after = instancePositions(createScatter(PLANETS.terra, 1, clear, 4242))
  const onStreet = after.filter((p) => streets.all.has(cellOf(p.x, p.z)))
  assert.equal(onStreet.length, 0, `${onStreet.length} props still land on a street cell: ${JSON.stringify(onStreet.slice(0, 3))}`)
})

test('after the fix, keepClearCells keeps every scatter prop off every built town block', () => {
  const clear = keepClearCells({ streets: streets.all, claimed: new Set() })
  const after = instancePositions(createScatter(PLANETS.terra, 1, clear, 4242))
  let checked = 0
  for (const p of after) {
    const cx = Math.round(p.x / CELL_SIZE)
    const cz = Math.round(p.z / CELL_SIZE)
    const cell = { x: cx, z: cz }
    const k = `${cx},${cz}`
    if (!inTown(cell) || streets.all.has(k)) continue
    checked++
    assert.equal(blockContent(cell, streets.all).kind, 'green', `a prop landed on a built cell ${k}`)
  }
  assert.ok(checked > 0, 'no in-town, non-street prop was placed — the check above never ran')
})

test('the town actually plants its green blocks', () => {
  // `greenBlocks` has existed, and been tested, since the planting fix — and until now nothing
  // in production ever called it. The town set aside 18% of its blocks as green and then left
  // them as bare grass, which is the least interesting thing a park can be.
  const green = greenBlocks({ streets: streets.all, claimed: new Set() })
  assert.ok(green.length > 0, 'this street plan has no green blocks at all')
  const plants = parkPlanting(green)
  assert.ok(plants.length > green.length, `${plants.length} plants across ${green.length} parks`)
})

test('a park keeps its planting inside its own block', () => {
  // The radius is what keeps a canopy off the kerb: a green block is a whole cell, but only
  // the inner 5 of its 6 may be planted, and a tree's own spread has to come out of that too.
  // A plant measured only by its centre would hang over the road.
  const green = greenBlocks({ streets: streets.all, claimed: new Set() })
  for (const plant of parkPlanting(green)) {
    const block = green.find((b) => Math.hypot(b.x - plant.x, b.z - plant.z) <= b.radius + 1e-9)
    assert.ok(block, `a plant at (${plant.x.toFixed(1)}, ${plant.z.toFixed(1)}) belongs to no park`)
    const reach = Math.hypot(plant.x - block.x, plant.z - block.z) + plant.spread
    assert.ok(
      reach <= block.radius + 1e-9,
      `a ${plant.part} reaches ${reach.toFixed(2)} from its park's centre, past the ${block.radius} radius`
    )
  }
})

test('every park plant is marked as a forest part', () => {
  // Same seam as the street trees: these are forest-kit parts among city-kit furniture, and an
  // unmarked one is handed to the wrong builder and silently never drawn.
  const green = greenBlocks({ streets: streets.all, claimed: new Set() })
  for (const plant of parkPlanting(green)) assert.equal(plant.kit, 'forest')
})

test('a park is planted the same way every time', () => {
  const green = greenBlocks({ streets: streets.all, claimed: new Set() })
  assert.deepEqual(parkPlanting(green), parkPlanting(green))
})

// ── parkjes: pad, beplanting eromheen, banken ────────────────────────────────────────

const N = { x: 0, z: -1 }
const S = { x: 0, z: 1 }
const E = { x: 1, z: 0 }
const W = { x: -1, z: 0 }
const dirKey = (d) => `${d.x},${d.z}`

test('a park takes one straight route through, not a spur to every street it touches', () => {
  // The first design gave a block an arm to each street-facing side. Drawn out against the real
  // plan it was plainly wrong: five of the thirteen green blocks front three streets and one
  // fronts four, and a three-armed cross took two thirds of the block. A park is a place to walk
  // through, so one route through it is the whole idea — and a pair of opposite sides is what
  // makes a route rather than a bend.
  const streets = new Set(['0,-1', '0,1', '1,0'])
  const arms = parkArms({ x: 0, z: 0 }, streets).map(dirKey).sort()
  assert.deepEqual(arms, [dirKey(N), dirKey(S)].sort(), 'a through-route was available and not taken')
})

test('a park with no opposite pair settles for one way in', () => {
  const streets = new Set(['1,0', '0,1'])
  const arms = parkArms({ x: 0, z: 0 }, streets)
  assert.equal(arms.length, 1, `expected a single arm, got ${arms.length}`)
  assert.ok(streets.has(dirKey({ x: arms[0].x, z: arms[0].z })), 'the arm points at no street')
})

test('a park nothing reaches gets no path at all', () => {
  // Two of the thirteen green blocks front no street. A path from the middle to nowhere is
  // worse than none, so they stay as they are: a copse.
  assert.deepEqual(parkArms({ x: 0, z: 0 }, new Set()), [])
})

test('the paving runs all the way to the kerb', () => {
  // This test used to assert the opposite — that an arm stopped at the block's own boundary —
  // and it was pinning the defect. Reported from the running app: paths you cannot reach. A
  // block edge is not a street. The carriageway runs down the middle of the *next* cell, so
  // stopping at the boundary leaves 4.8 units of grass between the path and the asphalt and the
  // whole thing floats in a field with both ends in nothing.
  const streets = new Set(['0,-1', '0,1'])
  const block = { x: 0, z: 0, radius: 5 }
  const paving = parkPaving(block, parkArms({ x: 0, z: 0 }, streets))
  assert.ok(paving.length > 0, 'a through-route paved nothing')

  const reach = CELL_SIZE - 1.2 // one cell across, less half a carriageway: the asphalt's edge
  let furthest = 0
  for (const slab of paving) {
    const outer = Math.max(Math.abs(slab.x), Math.abs(slab.z)) + PARK_PATH_WIDTH / 2
    furthest = Math.max(furthest, outer)
    assert.ok(outer <= reach + 1e-9, `a slab reaches ${outer.toFixed(2)}, past the kerb at ${reach}`)
  }
  assert.ok(
    Math.abs(furthest - reach) < 1e-9,
    `the path stops ${(reach - furthest).toFixed(2)} short of the kerb — it has to be walkable from the street`
  )
})

/** Whether something of this spread would stand on the path, by the same rule the layout uses. */
const standsOnPath = (p, block, arms) =>
  arms.some((d) => {
    const x = p.x - block.x
    const z = p.z - block.z
    const along = x * d.x + z * d.z
    const across = Math.abs(x * d.z - z * d.x)
    return along >= -PARK_PATH_WIDTH / 2 && along <= CELL_SIZE / 2 && across < PARK_PATH_WIDTH / 2 + p.spread
  })

test('nothing is planted on the path, and nothing is lost to it', () => {
  // The point of planting with the path already known. Filtering afterwards cost about a third
  // of every park's planting, measured across the thirteen green blocks, and a park that loses
  // a third of its trees to its own footpath is a footpath with trees beside it.
  const streets = new Set(['0,-1', '0,1'])
  const block = { x: 0, z: 0, radius: 5 }
  const arms = parkArms({ x: 0, z: 0 }, streets)

  let proved = 0
  for (let seed = 0; seed < 12; seed++) {
    // Planted as though there were no path, so we can see what the rule actually has to move.
    // Without this the test passes on any seed whose draws happened to miss the path, which is
    // exactly what let a broken version through once already.
    const blind = parkPlanting([block], seed, [])
    proved += blind.filter((p) => standsOnPath(p, block, arms)).length

    const aware = parkPlanting([block], seed, arms)
    assert.equal(aware.length, blind.length, `seed ${seed}: the path cost the park some planting`)
    for (const p of aware) {
      assert.ok(
        !standsOnPath(p, block, arms),
        `seed ${seed}: a ${p.part} at (${(p.x - block.x).toFixed(2)}, ${(p.z - block.z).toFixed(2)}) stands on the path`
      )
    }
  }
  assert.ok(proved > 0, 'no draw across twelve seeds ever landed on the path — this test proves nothing')
})

test('benches stand beside the path and face it', () => {
  const streets = new Set(['0,-1', '0,1'])
  const block = { x: 0, z: 0, radius: 5 }
  const arms = parkArms({ x: 0, z: 0 }, streets)
  const benches = parkFurniture(block, arms, 0).filter((f) => f.part === 'bench')
  assert.ok(benches.length > 0, 'a park with a path got no bench')
  for (const bench of benches) {
    // The path runs north-south here, so a bench belongs clear of it across x...
    assert.ok(Math.abs(bench.x) > PARK_PATH_WIDTH / 2, `a bench at x=${bench.x.toFixed(2)} stands on the path`)
    // ...and faces across it, which for a +Z-fronted part is a quarter turn from the path axis.
    const across = Math.abs(((bench.ry % Math.PI) + Math.PI) % Math.PI)
    assert.ok(Math.abs(across - Math.PI / 2) < 1e-9, `a bench faces ${bench.ry}, along the path rather than at it`)
  }
})

test('a park is laid out the same way every time', () => {
  const streets = new Set(['0,-1', '0,1'])
  const block = { x: 0, z: 0, radius: 5 }
  assert.deepEqual(parkItems([block], streets, 3), parkItems([block], streets, 3))
})

test('every park item says which kit it comes from', () => {
  // Paving, benches and bins are city-kit; trees, bushes and grass are forest-kit. The two have
  // their own atlases and cannot share a mesh, so an unmarked item goes to the wrong renderer
  // and is silently never drawn.
  const streets = new Set(['0,-1', '0,1'])
  for (const item of parkItems([{ x: 0, z: 0, radius: 5 }], streets, 1)) {
    assert.ok(item.kit === 'city' || item.kit === 'forest', `${item.part} claims kit ${item.kit}`)
  }
})

test('a park does not stack its displaced planting on one spot', () => {
  // The rejection draw and the fallback cover each other: switch either off and the other still
  // keeps every plant off the path, so neither is pinned by the test above. What the fallback
  // cannot do alone is *spread* — it has one position, so without the draw every displaced
  // plant in a park lands on the same square metre. That is what this catches.
  const streets = new Set(['0,-1', '0,1'])
  const block = { x: 0, z: 0, radius: 5 }
  const arms = parkArms({ x: 0, z: 0 }, streets)
  for (let seed = 0; seed < 8; seed++) {
    const plants = parkPlanting([block], seed, arms)
    const spots = new Set(plants.map((p) => `${p.x.toFixed(2)},${p.z.toFixed(2)}`))
    assert.equal(spots.size, plants.length, `seed ${seed}: two plants stand on the same spot`)
  }
})

test('a park path does not run through a streetlight', () => {
  // Reaching the kerb means crossing the street cell's verge, which is where the lamps, signals,
  // crossings, props and street trees stand. On this plan nothing collides — measured across all
  // seventeen arms — but that is luck rather than a rule: nothing arranges the two against each
  // other. This test is here to say so when it stops being true. The fix if it fires is to nudge
  // the offending arm's path along its own axis, or to reserve the slot the way `reservedSlots`
  // already does for buildings.
  const furniture = vergeFurniture(streets.cells, CELL_SIZE).filter((f) => furnitureWorldBounds(f))
  assert.ok(furniture.length > 20, `only ${furniture.length} pieces of furniture — nothing to check against`)

  const reach = CELL_SIZE - 1.2
  const half = PARK_PATH_WIDTH / 2
  for (const block of greenBlocks({ streets: streets.all, claimed: new Set() })) {
    const cell = { x: Math.round(block.x / CELL_SIZE), z: Math.round(block.z / CELL_SIZE) }
    for (const d of parkArms(cell, streets.all)) {
      for (const f of furniture) {
        const box = furnitureWorldBounds(f)
        const x = f.x - block.x
        const z = f.z - block.z
        const along = x * d.x + z * d.z
        const across = Math.abs(x * d.z - z * d.x)
        const spread = Math.max(box.xmax - f.x, f.x - box.xmin, box.zmax - f.z, f.z - box.zmin)
        assert.ok(
          !(along >= -half && along <= reach && across < half + spread),
          `the park path out of ${cell.x},${cell.z} runs through a ${f.part} at (${f.x.toFixed(1)}, ${f.z.toFixed(1)})`
        )
      }
    }
  }
})
