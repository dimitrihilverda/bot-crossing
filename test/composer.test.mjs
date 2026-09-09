import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Composer needs three.js and a loaded glb, so it cannot be constructed under node --test.
 * What is worth locking down is the thing that breaks quietly: a recipe asking for a city
 * part and being handed the base kit's registry, which throws "no part named" only once a
 * scene is built.
 */
test('Composer resolves parts against its own kit, not a hardcoded one', () => {
  const src = readFileSync('src/world/buildings.js', 'utf8')
  assert.doesNotMatch(src, /part\(\s*name\s*,\s*'base'/, "Composer still hardcodes the 'base' kit")
  assert.match(src, /this\.kit/, 'Composer does not carry a kit')
})
