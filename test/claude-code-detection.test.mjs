// test/claude-code-detection.test.mjs
import test from 'node:test'
import assert from 'node:assert/strict'
import { isSessionActive, zoneForSession } from '../server/harnesses/claude-code.mjs'

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

test('a real project folder still groups by repo basename', () => {
  const z = zoneForSession({ cwd: 'C:\\Users\\me\\PhpstormProjects\\mios', originCwd: '', title: 'anything' })
  assert.equal(z.project, 'mios')
})

test('a folder-less scratch session becomes its own zone named by its title', () => {
  const cwd = 'C:\\Users\\me\\AppData\\Roaming\\Claude\\scratch-workspaces\\a\\b\\scratch-2026-09-09-e2765d'
  const z = zoneForSession({ cwd, originCwd: '', title: 'Team hub design' })
  assert.equal(z.project, 'Team hub design')
  assert.equal(z.worktree, '')
})

test('a titleless scratch session falls back to a readable label', () => {
  const cwd = 'C:\\x\\scratch-workspaces\\a\\scratch-2026-09-09-e2765d'
  assert.equal(zoneForSession({ cwd, originCwd: '', title: '' }).project, 'Untitled session')
})
