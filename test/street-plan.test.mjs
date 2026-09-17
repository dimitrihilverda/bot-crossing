import test from 'node:test'
import assert from 'node:assert/strict'
import { planStreetCells, TOWN_CELL_RADIUS, STREET_SEED, PROTECTED_CELLS } from '../src/world/street-plan.js'
import { key, neighbours } from '../src/world/grid.js'

const cells = planStreetCells()
const streetKeys = new Set(cells.map((c) => key(c.x, c.z)))
const inTown = (c) => Math.max(Math.abs(c.x), Math.abs(c.z)) <= TOWN_CELL_RADIUS

test('the same seed gives the same streets', () => {
  assert.deepEqual(planStreetCells(STREET_SEED), planStreetCells(STREET_SEED))
})

test('a different seed gives different streets', () => {
  assert.notDeepEqual(planStreetCells(STREET_SEED), planStreetCells(STREET_SEED + 1))
})

test('the depot and the origin are never streets', () => {
  for (const p of PROTECTED_CELLS) {
    assert.equal(streetKeys.has(key(p.x, p.z)), false, `${p.x},${p.z} is a street`)
  }
})

test('no protected cell is ever a street, across many seeds', () => {
  // `connect()` stitches disconnected components with `line()`, independently of `slice()`'s
  // own protected-cell check — a defect there would not show up at the default seed alone.
  // Seed 44 was the first seed found (out of 0-4999) to pave `{0,0}` before that check existed.
  // A smaller radius keeps this fast without weakening it: the seed count is what gives this
  // test its power, not the town's size.
  const radius = 4
  for (let seed = 0; seed < 1000; seed++) {
    const seedKeys = new Set(planStreetCells(seed, radius).map((c) => key(c.x, c.z)))
    for (const p of PROTECTED_CELLS) {
      assert.equal(seedKeys.has(key(p.x, p.z)), false, `seed ${seed}: ${p.x},${p.z} is a street`)
    }
  }
})

test('the street network is one connected whole', () => {
  const seen = new Set([key(cells[0].x, cells[0].z)])
  const queue = [cells[0]]
  while (queue.length) {
    for (const n of neighbours(queue.pop())) {
      const k = key(n.x, n.z)
      if (streetKeys.has(k) && !seen.has(k)) {
        seen.add(k)
        queue.push(n)
      }
    }
  }
  assert.equal(seen.size, cells.length, `${cells.length - seen.size} street cells are cut off`)
})

test('block sizes vary — this is not a chessboard', () => {
  const blocks = []
  const seen = new Set()
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const k = key(x, z)
      if (streetKeys.has(k) || seen.has(k)) continue
      let size = 0
      const queue = [{ x, z }]
      seen.add(k)
      while (queue.length) {
        const c = queue.pop()
        size++
        for (const n of neighbours(c)) {
          const nk = key(n.x, n.z)
          if (!inTown(n) || streetKeys.has(nk) || seen.has(nk)) continue
          seen.add(nk)
          queue.push(n)
        }
      }
      blocks.push(size)
    }
  }
  assert.ok(blocks.length >= 8, `only ${blocks.length} blocks`)
  assert.ok(new Set(blocks).size >= 3, `block sizes are all but identical: ${[...new Set(blocks)].join(',')}`)
})

test('streets bend — a network of mostly straights and T-junctions is not playful', () => {
  // Before the playful revision (`JOG_CHANCE` 0.45, one jog attempt in the randomly-chosen
  // direction only): 6 bends out of 172 street cells — 6 corners in a network of 156 non-bend
  // cells, indistinguishable from a chessboard at a glance. After (`JOG_CHANCE` 0.75, both
  // directions tried, a cut free to jog more than once — see `slice` in street-plan.js): 31
  // bends out of 150 cells, better than one bend cell in five. `>= 20` sits well clear of the
  // old figure (would fail against it) and of ordinary seed-to-seed noise, without being tied
  // to the exact 31 a re-tuned constant might drift a little from.
  let bends = 0
  for (const c of cells) {
    const arms = neighbours(c).filter((n) => streetKeys.has(key(n.x, n.z)))
    if (arms.length !== 2) continue
    if (arms[0].x !== arms[1].x && arms[0].z !== arms[1].z) bends++
  }
  assert.ok(bends >= 20, `only ${bends} bends — the network still reads as mostly straight`)
})

test('not every street runs the full width of the town', () => {
  const span = TOWN_CELL_RADIUS * 2 + 1
  const columns = new Set(cells.map((c) => c.x))
  let full = 0
  for (const x of columns) {
    if (cells.filter((c) => c.x === x).length === span) full++
  }
  assert.ok(full < columns.size, `all ${columns.size} street columns run the full width`)
})
