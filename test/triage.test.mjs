import test from 'node:test'
import assert from 'node:assert/strict'
import { triageRows, newlyNeedsAttention } from '../src/ui/triage.js'

const now = 1_000_000
const mk = (o) => ({ id: o.id, colony: o.colony || '', project: o.project || 'repo', title: o.title || 't',
  hasError: !!o.blocked, unread: !!o.waiting, running: false, prState: '', lastActivityAt: o.at ?? now })

test('only waiting/blocked threads appear, longest wait first', () => {
  const rows = triageRows([
    mk({ id: 'a', waiting: true, at: now - 60_000 }),
    mk({ id: 'b', blocked: true, at: now - 120_000 }),
    mk({ id: 'c' }), // idle — excluded
  ], now)
  assert.deepEqual(rows.map((r) => r.id), ['b', 'a'])
  assert.equal(rows[0].status, 'blocked')
  assert.equal(rows[1].waitMs, 60_000)
})

test('newlyNeedsAttention returns ids not seen last time', () => {
  const rows = [{ id: 'a' }, { id: 'b' }]
  assert.deepEqual(newlyNeedsAttention(new Set(['a']), rows), ['b'])
})
