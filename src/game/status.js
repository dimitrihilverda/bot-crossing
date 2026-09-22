/**
 * Thread → status, and the staleness window it depends on.
 *
 * Pulled out of `colony.js` so it can be imported under plain Node — `colony.js`'s own
 * import chain (`colony.js → agents/astronauts.js → agents/crew.js`) hits an unguarded
 * top-level `import.meta.env.BASE_URL` that only a bundler defines, so `colony.js` itself
 * cannot be loaded outside one. This module imports nothing from `colony.js` or `three`,
 * so anything that only needs to classify a thread — like the triage selector in
 * `src/ui/triage.js` — can do so without dragging that whole chain in.
 */

/** How long a thread can sit untouched before it counts as dormant rather than merely idle. */
export const STALE_MS = 3 * 24 * 60 * 60 * 1000

/** Thread → behaviour. First match wins, exactly like the board's auto-sort. */
export function statusFor(thread, now = Date.now()) {
  if (thread.hasError) return 'blocked'
  if (thread.running) return 'working'
  if (thread.prState === 'MERGED') return 'celebrating'
  if (thread.unread) return 'waiting'
  if (now - thread.lastActivityAt > STALE_MS) return 'sleeping'
  return 'idle'
}
