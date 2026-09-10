import { statusFor } from '../game/status.js'
import { triageRows } from './triage.js'
import { PLOT_PALETTE, hashString } from '../world/plots.js'
import './hub.css'

/**
 * The hub layer: a read-only triage HUD drawn over the (otherwise unmodified) colony game.
 *
 * Mounted only in hub mode (`?hub=1`, see main.js), on the same root the normal HUD lives on.
 * It owns no session and fires no action — everything here is a projection of the exact same
 * merged `threads`/`colonies` the normal HUD already gets from the poll, read differently:
 * sorted by who has been waiting on a human longest, instead of laid out on the ground.
 */

/** `<60s` → `"now"`; `<60m` → `"Nm"`; otherwise `"Hh Mm"`. */
export function formatWait(ms) {
  if (!(ms > 0)) return 'now'
  if (ms < 60_000) return 'now'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 60) return `${minutes}m`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return `${h}h ${m}m`
}

/**
 * A colony's chip colour: a stable hash of its name into the same accent palette the 3D map
 * itself picks a district's colour from (`world/plots.js`), so a colony's chip on the board
 * agrees with the district it names out on the ground.
 */
function colonyColor(name) {
  const hex = PLOT_PALETTE[hashString(name || '') % PLOT_PALETTE.length]
  return '#' + hex.toString(16).padStart(6, '0')
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c])
}

export class Hub {
  constructor(rootEl) {
    this.el = document.createElement('div')
    this.el.className = 'hub-hud'
    this.el.innerHTML = `
      <div class="hub-scrim"></div>
      <header class="hub-head">
        <div class="hub-brand">
          <span class="hub-mark">Bot&nbsp;<b>Crossing</b></span>
          <span class="hub-sub">Team Wall</span>
        </div>
        <span class="hub-ro">● Read-only hub</span>
        <div class="hub-head-right">
          <div class="hub-summary"><b class="hub-need-n">0</b><span>need a human</span></div>
        </div>
      </header>
      <div class="hub-triage">
        <div class="hub-board">
          <div class="hub-board-head">
            <h1>Needs you</h1>
            <span class="hub-count">0</span>
            <span class="hub-hint">longest waiting first</span>
          </div>
          <div class="hub-rows"></div>
        </div>
        <div class="hub-strip">
          <div class="hub-strip-head">Colonies · live</div>
          <div class="hub-strip-rows"></div>
        </div>
      </div>
    `
    rootEl.appendChild(this.el)

    this.$rows = this.el.querySelector('.hub-rows')
    this.$count = this.el.querySelector('.hub-count')
    this.$needN = this.el.querySelector('.hub-need-n')
    this.$strip = this.el.querySelector('.hub-strip-rows')
  }

  /** `threads`: the poll's merged, colony-tagged list. `colonies`: `/api/threads`'s own `.colonies`. */
  update(threads, colonies) {
    const now = Date.now()
    const rows = triageRows(threads, now)
    this._renderBoard(rows)
    this._renderStrip(threads || [], colonies || [], now)
  }

  _renderBoard(rows) {
    this.$count.textContent = String(rows.length)
    this.$needN.textContent = String(rows.length)
    if (!rows.length) {
      this.$rows.innerHTML = `<div class="hub-clear">All clear</div>`
      return
    }
    const longest = rows[0].waitMs || 1
    this.$rows.innerHTML = rows.map((r) => this._rowHtml(r, longest)).join('')
  }

  _rowHtml(r, longest) {
    const blocked = r.status === 'blocked'
    const pct = Math.max(3, Math.round((r.waitMs / longest) * 100))
    const color = blocked ? 'var(--hub-block)' : 'var(--hub-wait)'
    const colony = r.colony || 'Local'
    const cColor = colonyColor(r.colony)
    return `
      <div class="hub-row ${blocked ? 'is-block' : ''}">
        <span class="hub-pip ${r.status}"></span>
        <div class="hub-rc">
          <div class="hub-title">${esc(r.title)}</div>
          <div class="hub-meta">
            <span class="hub-colony" style="color:${cColor}"><i style="background:${cColor}"></i>${esc(colony)}</span>
            <span class="hub-repo">· ${esc(r.project)}</span>
            <span class="hub-st ${r.status}">${blocked ? 'Blocked' : 'Waiting'}</span>
          </div>
        </div>
        <div class="hub-wt">
          <span class="hub-t ${r.status}">${formatWait(r.waitMs)}</span>
          <span class="hub-bar"><i style="width:${pct}%;background:${color}"></i></span>
        </div>
      </div>`
  }

  _renderStrip(threads, colonies, now) {
    if (!colonies.length) {
      this.$strip.innerHTML = `<div class="hub-strip-empty">No colonies added yet</div>`
      return
    }
    this.$strip.innerHTML = colonies.map((c) => this._stripRowHtml(c, threads, now)).join('')
  }

  _stripRowHtml(c, threads, now) {
    const counts = { working: 0, waiting: 0, blocked: 0 }
    for (const t of threads) {
      if (t.colony !== c.name) continue
      const s = statusFor(t, now)
      if (s in counts) counts[s]++
    }
    const color = colonyColor(c.name)
    // The strip's dot legend uses the same short `work`/`wait`/`block` classes the mockup
    // does; `counts` itself is keyed by `statusFor`'s own names so it lines up with the board.
    const countHtml = (key, dotClass, label) =>
      `<span class="${counts[key] ? '' : 'zero'}"><i class="hub-k ${dotClass}"></i><b>${counts[key]}</b>&nbsp;${label}</span>`
    return `
      <div class="hub-cy">
        <span class="hub-on ${c.online ? 'up' : ''}"></span>
        <span class="hub-accent" style="background:${color}"></span>
        <span class="hub-nm">${esc(c.name)}</span>
        <div class="hub-counts">
          ${countHtml('working', 'work', 'working')}
          ${countHtml('waiting', 'wait', 'waiting')}
          ${countHtml('blocked', 'block', 'blocked')}
        </div>
      </div>`
  }
}
