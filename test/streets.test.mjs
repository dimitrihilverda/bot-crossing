import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planStreets } from '../src/world/streets.js'

const SHIP = { q: -2, r: 1 }
const k = (c) => `${c.q},${c.r}`
const opts = (anchored = []) => ({ ship: SHIP, anchored: new Set(anchored) })

test('a one-cell colony gets a ring around it', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]]])
  const { ring, all } = planStreets(layout, opts())
  assert.ok(ring.length > 0, 'no ring was planned')
  for (const cell of ring) {
    assert.ok(all.has(k(cell)), 'a ring cell is missing from `all`')
  }
})

test('no street cell is ever a plot cell', () => {
  const layout = new Map([
    ['a', [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 0, r: 1 }]],
    ['b', [{ q: 2, r: -1 }, { q: 2, r: 0 }]],
  ])
  const { all } = planStreets(layout, opts())
  for (const cells of layout.values()) {
    for (const cell of cells) {
      assert.ok(!all.has(k(cell)), `street cell ${k(cell)} is also a plot cell`)
    }
  }
})

test('no street cell is an anchored district cell', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]]])
  // A ring-5 district, which is where `colonyAnchor` puts a visiting colony.
  const district = [{ q: 5, r: -5 }, { q: 5, r: -4 }]
  const { all } = planStreets(layout, opts(district.map(k)))
  for (const cell of district) {
    assert.ok(!all.has(k(cell)), `street cell ${k(cell)} belongs to a district`)
  }
})

test('the ring sits outside every home plot cell', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }, { q: 1, r: 0 }, { q: 2, r: 0 }]]])
  const { ring } = planStreets(layout, opts())
  // Cube distance from the origin of the furthest plot cell is 2, so every ring cell
  // must be further out than that.
  const cube = (c) => Math.max(Math.abs(c.q), Math.abs(c.r), Math.abs(-c.q - c.r))
  for (const cell of ring) {
    assert.ok(cube(cell) > 2, `ring cell ${k(cell)} is not outside the colony`)
  }
})

test('every spur is a chain of adjacent cells reaching the ring', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]]])
  const { ring, spurs } = planStreets(layout, opts())
  const onRing = new Set(ring.map(k))
  const spur = spurs.get('a')
  assert.ok(spur && spur.length > 0, 'the plot got no spur')
  for (let i = 1; i < spur.length; i++) {
    const a = spur[i - 1]
    const b = spur[i]
    const dq = b.q - a.q
    const dr = b.r - a.r
    const ds = -dq - dr
    const step = (Math.abs(dq) + Math.abs(dr) + Math.abs(ds)) / 2
    assert.equal(step, 1, `spur step ${i} jumps ${step} cells`)
  }
  assert.ok(onRing.has(k(spur[spur.length - 1])), 'the spur does not end on the ring')
})

test('the depot always gets a spur', () => {
  const layout = new Map([['a', [{ q: 0, r: 0 }]]])
  const { spurs } = planStreets(layout, opts())
  const spur = spurs.get('__ship__')
  assert.ok(spur && spur.length > 0, 'the depot got no spur')
})

test('a plot with no unclaimed neighbour gets no spur', () => {
  // `b` sits at the origin, walled in on all six sides by `a`. There is no free cell
  // adjacent to it, so no road can reach it — which is expected, not an error: the
  // vehicle drives the last stretch over the deck, exactly as it did before stage 4.
  const HEX_DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]]
  const layout = new Map([
    ['b', [{ q: 0, r: 0 }]],
    ['a', HEX_DIRS.map(([dq, dr]) => ({ q: dq, r: dr }))],
  ])
  const { spurs } = planStreets(layout, opts())
  assert.ok(!spurs.has('b'), 'a walled-in plot was given a spur it cannot have')
})

test('planning is stable: the same layout gives the same streets', () => {
  const layout = new Map([
    ['a', [{ q: 0, r: 0 }, { q: 1, r: 0 }]],
    ['b', [{ q: -1, r: 0 }]],
  ])
  const first = planStreets(layout, opts())
  const second = planStreets(layout, opts())
  assert.deepEqual([...first.all].sort(), [...second.all].sort())
  assert.deepEqual(first.ring, second.ring)
})
