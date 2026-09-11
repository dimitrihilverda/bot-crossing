import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GARMENT_SETS, setMeshNames } from '../src/agents/garment-sets.js'

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
