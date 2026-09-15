import { statusFor } from '../game/status.js'

/** Threads that need a human, worst-waited first. Pure — no DOM, no clock beyond `now`. */
export function triageRows(threads, now = Date.now()) {
  const out = []
  for (const t of threads || []) {
    const status = statusFor(t, now)
    if (status !== 'waiting' && status !== 'blocked') continue
    out.push({
      id: t.id,
      colony: t.colony || '',
      project: t.colony ? String(t.project || '').replace(`${t.colony} · `, '') : t.project || '',
      title: t.title || 'Untitled thread',
      status,
      waitMs: Math.max(0, now - (t.lastActivityAt || now)),
    })
  }
  return out.sort((a, b) => b.waitMs - a.waitMs)
}

/** Ids in `rows` that were not in the previous attention set — the popup triggers. */
export function newlyNeedsAttention(prevIds, rows) {
  const prev = prevIds instanceof Set ? prevIds : new Set(prevIds || [])
  return rows.filter((r) => !prev.has(r.id)).map((r) => r.id)
}
