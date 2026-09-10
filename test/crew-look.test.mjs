import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { SKIN_TONES, skinToneIndexFor } from '../src/agents/skin.js'
import { HAIR_STYLES, hairStyleIndexFor, BALD } from '../src/agents/hair.js'

const SRC = readFileSync('src/agents/astronauts.js', 'utf8')

/**
 * The spacesuit was six separate instanced meshes. Asserting on the source rather than on a
 * constructed scene because the class needs a GL context and a loaded glb; what matters here
 * is that no part of the suit is built or written any more, and a stale `setPart` call for a
 * part that no longer exists is a runtime crash rather than a wrong pixel.
 */
const GONE = ['helmet', 'visor', 'pack', 'antenna', 'tip', 'lamp']

for (const name of GONE) {
  test(`no spacesuit part named ${name} is built`, () => {
    assert.doesNotMatch(SRC, new RegExp(`parts\\.${name}\\s*=`), `parts.${name} is still built`)
  })

  test(`no spacesuit part named ${name} is written per frame`, () => {
    assert.doesNotMatch(SRC, new RegExp(`setPart\\([^)]*\\b${name}\\b`), `${name} is still written`)
  })
}

test('the face survives, because it carries the eye colour', () => {
  assert.match(SRC, /parts\.face\s*=/, 'parts.face was removed')
  assert.match(SRC, /setPart\([^)]*\bface\b/, 'the face is no longer written')
})

test('the tools and props survive', () => {
  for (const keep of ['hammer', 'cabinet', 'box']) {
    assert.match(SRC, new RegExp(`parts\\.${keep}\\s*=`), `parts.${keep} was removed`)
  }
})

test('the status precedence and the look table are untouched', () => {
  const colony = readFileSync('src/game/colony.js', 'utf8')
  assert.match(colony, /STATUS_ORDER = \['blocked', 'waiting', 'working', 'celebrating', 'idle', 'sleeping'\]/)
  for (const key of ['working', 'waiting', 'blocked', 'celebrating', 'idle', 'sleeping', 'spawning', 'leaving']) {
    assert.match(SRC, new RegExp(`^\\s*${key}: \\{`, 'm'), `AGENT_LOOK lost its ${key} key`)
  }
})

test('there are several skin tones and they are all distinct', () => {
  assert.ok(SKIN_TONES.length >= 4, `only ${SKIN_TONES.length} tones`)
  assert.equal(new Set(SKIN_TONES).size, SKIN_TONES.length, 'duplicate tones')
})

test('a thread always gets the same skin tone', () => {
  const id = 'claude-code:6b17e5c7-1d06-490c-a8fe-9899fee895fa'
  assert.equal(skinToneIndexFor(id), skinToneIndexFor(id))
})

test('every index is inside the table', () => {
  for (const id of ['a', 'bb', 'ccc', '', 'claude-code:x', 'codex:y', '💡']) {
    const i = skinToneIndexFor(id)
    assert.ok(Number.isInteger(i), `${JSON.stringify(id)} gave ${i}`)
    assert.ok(i >= 0 && i < SKIN_TONES.length, `${JSON.stringify(id)} gave ${i}`)
  }
})

test('the tones spread across the table rather than clustering on one', () => {
  // A hash that collapses would give every crew member the same face. 200 ids should touch
  // every tone at least once.
  const seen = new Set()
  for (let n = 0; n < 200; n++) seen.add(skinToneIndexFor(`claude-code:thread-${n}`))
  assert.equal(seen.size, SKIN_TONES.length, `only hit ${seen.size} of ${SKIN_TONES.length}`)
})

test('skin.js cannot reach anything that knows a status', () => {
  // Asserted structurally rather than by hunting for the word "status" in the file: a word
  // hunt fires on the very comment that explains the contract, and a module that cannot
  // import status cannot depend on it whatever its comments say. Only three and hashString.
  const src = readFileSync('src/agents/skin.js', 'utf8')
  const imports = [...src.matchAll(/^import .*? from '([^']+)'/gm)].map((m) => m[1])
  const allowed = new Set(['three', '../world/plots.js'])
  for (const spec of imports) {
    assert.ok(allowed.has(spec), `skin.js imports ${spec}, which is not on its allowlist`)
  }
})

test('the head is built and written, and carries its own colour', () => {
  assert.match(SRC, /parts\.head\s*=/, 'parts.head is not built')
  assert.match(SRC, /setPart\([^)]*\bhead\b/, 'the head is not written per frame')
  assert.match(SRC, /head\.setColorAt/, 'the head never gets a skin tone')
})

test('there are three or four styles and one of them is bald', () => {
  assert.ok(HAIR_STYLES.length >= 3 && HAIR_STYLES.length <= 4, `${HAIR_STYLES.length} styles`)
  assert.ok(HAIR_STYLES.some((s) => s.name === BALD), `no style named ${BALD}`)
})

// The head's own radius (astronauts.js P.headR), not P.helmetR (0.48) — the radius of the
// helmet these figures no longer wear. Using 0.48 here would read as endorsing the wrong
// number, in the one file whose job is guarding against exactly that mistake (task 2's face
// cap shipped sized against helmetR and sat inside the skull at every one of its vertices).
const HEAD_R = 0.554

test('bald builds nothing, every other style builds geometry', () => {
  for (const style of HAIR_STYLES) {
    const geo = style.geometry(HEAD_R)
    if (style.name === BALD) {
      assert.equal(geo, null, 'bald should build no geometry')
      continue
    }
    assert.ok(geo, `${style.name} built nothing`)
    assert.ok(geo.attributes.position.count > 0, `${style.name} has no vertices`)
    geo.computeBoundingBox()
    // Read the extent off the box directly rather than through a Vector3, so this test does
    // not need a three.js import of its own.
    const height = geo.boundingBox.max.y - geo.boundingBox.min.y
    assert.ok(height > 0 && height < HEAD_R * 3, `${style.name} is ${height} tall against R ${HEAD_R}`)
    geo.dispose()
  }
})

test('hair is sized against the head, not the helmet the crew stopped wearing', () => {
  // Source-level guard, the same idiom this file already uses for GONE/parts.head/head.setColorAt
  // above: `geometry(HEAD_R)` alone only proves the *shape* is fine at whatever radius is passed
  // in — it says nothing about what the real call site in astronauts.js actually sizes hair
  // against at runtime. Task 2 shipped exactly this defect once (face cap built against
  // helmetR, 187/187 vertices inside the skull), so the call site itself needs its own check.
  assert.match(SRC, /style\.geometry\(P\.headR\)/, 'hair is not sized against the head radius')
  assert.doesNotMatch(SRC, /geometry\(P\.helmetR\)/, 'something is sized against the helmet radius')
})

test('a thread always gets the same hairstyle', () => {
  const id = 'claude-code:6b17e5c7-1d06-490c-a8fe-9899fee895fa'
  assert.equal(hairStyleIndexFor(id), hairStyleIndexFor(id))
})

test('every hair index is inside the table', () => {
  for (const id of ['a', 'bb', '', 'claude-code:x', '💡']) {
    const i = hairStyleIndexFor(id)
    assert.ok(Number.isInteger(i) && i >= 0 && i < HAIR_STYLES.length, `${JSON.stringify(id)} gave ${i}`)
  }
})

test('hairstyle and skin tone are independent', () => {
  // Both hash the same id. If they used the same modulus in the same way, tone and style
  // would move together and the crew would come in matched pairs instead of looking varied.
  //
  // This id set is fixed (thread-0 .. thread-199) and both hashes are pure, so both halves
  // below are deterministic — no flakiness in asserting them exactly rather than by threshold.
  //
  // A threshold of `pairs.size > SKIN_TONES.length` (i.e. > 6) does NOT do that: the defective
  // hash the brief originally suggested (`hashString('hair:' + id) % 4`, no finalizer) reaches
  // exactly 12 of the 24 possible pairs, and 12 > 6, so that assertion passes on the exact bug
  // it exists to catch — every dark-skinned figure bald or long-haired, never short or bunned.
  // The 12 pairs come from a shared, unmixed low bit: both `% 6` and `% 4` are even moduli, so
  // both indices inherit the same parity and move together in lockstep on it.
  //
  // So assert the count exactly (24 = 6 tones x 4 styles, all reachable) and add a direct
  // parity-independence bound the defective hash fails. Measured: shipped hash 94/200 parity
  // agreements (47%, chance), defective hash 200/200 (100%, lockstep) — 70..130 sits safely
  // between the two and is generous around the 50% chance expectation.
  //
  // Deliberately brittle: if SKIN_TONES or HAIR_STYLES ever changes length, `pairs.size` must
  // be re-derived by hand rather than loosened back to a threshold — a threshold is exactly
  // what let this defect through once already.
  const pairs = new Set()
  let agree = 0
  for (let n = 0; n < 200; n++) {
    const id = `claude-code:thread-${n}`
    const tone = skinToneIndexFor(id)
    const style = hairStyleIndexFor(id)
    pairs.add(`${tone}:${style}`)
    if ((tone & 1) === (style & 1)) agree++
  }
  assert.equal(pairs.size, SKIN_TONES.length * HAIR_STYLES.length, `only ${pairs.size} of 24 combinations`)
  assert.ok(agree > 70 && agree < 130, `parities agreed ${agree}/200 times`)
})

test('hair.js cannot reach anything that knows a status', () => {
  // Structural for the same reason skin.js's equivalent is: a module that cannot import
  // status cannot depend on it, and a word hunt would fire on the comment explaining that.
  const src = readFileSync('src/agents/hair.js', 'utf8')
  const imports = [...src.matchAll(/^import .*? from '([^']+)'/gm)].map((m) => m[1])
  const allowed = new Set(['three', '../world/plots.js'])
  for (const spec of imports) {
    assert.ok(allowed.has(spec), `hair.js imports ${spec}, which is not on its allowlist`)
  }
})
