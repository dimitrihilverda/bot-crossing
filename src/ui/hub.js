import './hub.css'

/**
 * The hub layer: a read-only view drawn over the (otherwise unmodified) colony game.
 *
 * Mounted only in hub mode (`?hub=1`, see main.js), on the same root the normal HUD lives on.
 * It owns no session and fires no action — it only ever reads the exact same merged,
 * colony-tagged `threads` (and the poll's own `.colonies`) the normal HUD already gets.
 *
 * `update()` is a stub for now — the triage HUD (the NEEDS YOU board and the per-colony
 * status strip) and the new-attention popup/sound fill it in next.
 */
export class Hub {
  constructor(rootEl) {
    this.el = document.createElement('div')
    this.el.className = 'hub-hud'
    rootEl.appendChild(this.el)
  }

  update(threads, colonies) {
    console.debug('[hub] threads', (threads || []).length, 'colonies', (colonies || []).length)
  }
}
