import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * build-crew.mjs asserts that every WANTED clip exists in the pack, but only when the pack
 * is present — which it is not on a fresh clone. These assert the other half of the
 * contract, the half that fails silently: a clip the runtime asks for that WANTED never
 * packed, which shows up as a crew member frozen in a T-pose.
 */

const runtime = readFileSync('src/agents/crew.js', 'utf8')
const build = readFileSync('tools/build-crew.mjs', 'utf8')

/** The `key: { name: 'Clip' }` pairs of `CLIP`, which is the whole palette the runtime can play. */
const played = [...runtime.matchAll(/(\w+):\s*\{\s*name:\s*'([A-Za-z0-9_]+)'/g)].map((m) => ({
  key: m[1],
  name: m[2],
}))

test('every clip the runtime plays is packed by build-crew', () => {
  assert.ok(played.length >= 17, `only found ${played.length} clips in crew.js — the new ones are missing`)

  for (const { name } of played) {
    assert.ok(build.includes(`'${name}'`), `${name} is played but never packed`)
  }
})

/**
 * A removal crew lifts things and carries them, and it dozes off sitting on something rather
 * than flat on the floor. Naming the keys here is what stops the retheme quietly reverting to
 * the colony's clip list — the names themselves are KayKit's and are asserted against the pack
 * by build-crew, so this only has to pin the three the theme depends on.
 */
test('the crew has the clips a removals job needs', () => {
  const byKey = new Map(played.map((c) => [c.key, c.name]))

  for (const key of ['lift', 'carry']) {
    assert.ok(byKey.has(key), `CLIP has no "${key}" entry — a removal crew has to pick things up`)
  }
  // A sleeping crew member sits on a moving box, so the sit has to be a seat-height sit.
  // Sit_Floor_* puts them on the ground and the box would be standing in their lap.
  assert.match(byKey.get('sit') ?? '', /^Sit_Chair_/, 'the sit clip must be a sit-on-an-object clip')
})
