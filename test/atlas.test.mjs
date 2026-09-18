import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The accent cell indices are hand-picked from the atlases and easy to break by accident.
 * A cell outside 0..31 silently masks nothing, which shows up as "no repo has a colour"
 * rather than as an error — so assert the range rather than trusting the eye.
 */
test('accent cells are inside the 8x4 atlas', () => {
  const src = readFileSync('src/world/kit.js', 'utf8')
  for (const name of ['CELL_CITY', 'CELL_FURNITURE']) {
    const match = src.match(new RegExp(`${name}\\s*=\\s*\\{[^}]*ACCENT:\\s*(\\d+)`))
    assert.ok(match, `${name}.ACCENT is not defined in src/world/kit.js`)
    const cell = Number(match[1])
    assert.ok(cell >= 0 && cell < 32, `${name}.ACCENT = ${cell} is outside 0..31`)
  }
})

test('the city and furniture kits are registered', () => {
  const src = readFileSync('src/world/kit.js', 'utf8')
  assert.match(src, /city:\s*\{\s*file:\s*'city\.glb'/, 'city kit is not in KITS')
  assert.match(src, /furniture:\s*\{\s*file:\s*'furniture\.glb'/, 'furniture kit is not in KITS')
})
