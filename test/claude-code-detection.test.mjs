// test/claude-code-detection.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { isSessionActive } from '../server/harnesses/claude-code.mjs'

test('a live pid counts as active regardless of transcript age', () => {
  const now = 1_000_000
  assert.equal(isSessionActive({ hasLiveProcess: true, transcriptMtime: 0, now }), true)
})

test('a transcript written in the last 45s counts as active without a pid', () => {
  const now = 1_000_000
  assert.equal(isSessionActive({ hasLiveProcess: false, transcriptMtime: now - 10_000, now }), true)
})

test('an old transcript with no pid is not active', () => {
  const now = 1_000_000
  assert.equal(isSessionActive({ hasLiveProcess: false, transcriptMtime: now - 120_000, now }), false)
})

test('no signals at all is not active', () => {
  assert.equal(isSessionActive({ hasLiveProcess: false, transcriptMtime: 0, now: 1_000_000 }), false)
})
