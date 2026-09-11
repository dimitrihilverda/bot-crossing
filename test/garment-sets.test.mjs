import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { GARMENT_SETS, setMeshNames, garmentSetFor, garmentSetIndexFor } from '../src/agents/garment-sets.js'
import { skinToneIndexFor } from '../src/agents/skin.js'

const PARTS = ['Body', 'ArmLeft', 'ArmRight', 'LegLeft', 'LegRight', 'Head']

test('there are two garment sets', () => {
  assert.equal(GARMENT_SETS.length, 2)
  assert.deepEqual(GARMENT_SETS.map((s) => s.id), ['ranger', 'rogue'])
})

test('each set names its own six meshes, and no others', () => {
  // The pack also ships a cape per character, a quiver for the Ranger and headgear for
  // three others. None of them is wanted: a cape hides the torso the hi-vis band wraps,
  // and a hood would hide the head entirely.
  for (const set of GARMENT_SETS) {
    assert.deepEqual(set.meshes, PARTS.map((p) => `${set.prefix}_${p}`))
    assert.equal(set.meshes.length, 6)
  }
})

test('no set names a cape, a quiver, a hood or any headgear', () => {
  const all = GARMENT_SETS.flatMap((s) => s.meshes).join(' ')
  for (const unwanted of ['Cape', 'Quiver', 'Hood', 'Helmet', 'Hat']) {
    assert.ok(!all.includes(unwanted), `a set names a ${unwanted}`)
  }
})

test('setMeshNames agrees with the table', () => {
  assert.deepEqual(setMeshNames('Ranger'), GARMENT_SETS[0].meshes)
  assert.deepEqual(setMeshNames('Rogue'), GARMENT_SETS[1].meshes)
})

test('a thread always wears the same set', () => {
  for (const id of ['a', 'session-1', 'c:/PhpstormProjects', '']) {
    assert.equal(garmentSetIndexFor(id), garmentSetIndexFor(id))
  }
})

test('the set index is always in range', () => {
  for (let i = 0; i < 500; i++) {
    const n = garmentSetIndexFor(`thread-${i}`)
    assert.ok(n === 0 || n === 1, `id thread-${i} gave set ${n}`)
  }
})

test('both sets actually get worn', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(garmentSetIndexFor(`thread-${i}`))
  assert.equal(seen.size, 2, 'one of the two sets is never chosen')
})

test('the set is independent of the skin tone', () => {
  // Stage 3's lesson, restated: its suggested hair salt was FNV-1a over a prefixed string,
  // which never mixes the lowest bit, so with two even moduli the parity of the two hashes
  // agreed 100% of the time and only half the pairs ever appeared — and the test written
  // for it would have passed on that. So this asserts the joint distribution, not a
  // correlation coefficient.
  const pairs = new Map()
  for (let i = 0; i < 4000; i++) {
    const id = `thread-${i}`
    const key = `${garmentSetIndexFor(id)}:${skinToneIndexFor(id)}`
    pairs.set(key, (pairs.get(key) || 0) + 1)
  }
  // Two sets times six skin tones is twelve pairs, and every one must occur.
  assert.equal(pairs.size, 12, `only ${pairs.size} of 12 set/skin pairs appeared`)
  // And roughly evenly: no pair may be rarer than a third of the even share.
  const even = 4000 / 12
  for (const [key, n] of pairs) {
    assert.ok(n > even / 3, `pair ${key} appeared ${n} times, far under the even share ${even.toFixed(0)}`)
  }
})

test('garmentSetFor returns the set the index names', () => {
  for (const id of ['x', 'y', 'z']) {
    assert.equal(garmentSetFor(id), GARMENT_SETS[garmentSetIndexFor(id)])
  }
})

test('garment-sets.js only reaches hashString and avalanche, never anything that knows a status', () => {
  // Asserted structurally rather than by hunting for the word "status": a word hunt fires on
  // the very comment that explains the contract, and a module that cannot import status
  // cannot depend on it whatever its comments say. The same test guards skin.js and hair.js.
  //
  // Unlike skin.js, this module is not import-free: `garmentSetIndexFor` needs a proper
  // avalanche (see the comment above it) and reuses `hair.js`'s rather than reimplementing
  // it, so the allowlist is exactly the two modules that supplies — no more.
  const src = readFileSync('src/agents/garment-sets.js', 'utf8')
  const imports = [...src.matchAll(/^import .*? from '([^']+)'/gm)].map((m) => m[1])
  const allowed = new Set(['../world/plots.js', './hair.js'])
  for (const spec of imports) {
    assert.ok(allowed.has(spec), `garment-sets.js imports ${spec}, which is not on its allowlist`)
  }
})
