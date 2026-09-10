import { statusFor } from '../game/status.js'
import { triageRows, newlyNeedsAttention } from './triage.js'
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

const MUTE_KEY = 'botcrossing.hub.muted'
/** How long a toast stays up before it fades — matches the design's "~6s" call. */
const TOAST_MS = 6000
/** The CSS fade-out transition's own duration, so the element isn't yanked mid-animation. */
const TOAST_FADE_MS = 400

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

function readMuted() {
  try {
    return localStorage.getItem(MUTE_KEY) === '1'
  } catch {
    return false
  }
}

function writeMuted(muted) {
  try {
    localStorage.setItem(MUTE_KEY, muted ? '1' : '0')
  } catch {
    /* a kiosk profile with storage disabled just forgets the setting on reload — not fatal */
  }
}

const MUTE_ICON = {
  wave: `<path class="hub-mute-wave" d="M15.5 8.5a5 5 0 0 1 0 7M19 5a9 9 0 0 1 0 14"/>`,
  x: `<path class="hub-mute-x" d="M23 9l-6 6M17 9l6 6"/>`,
}

export class Hub {
  constructor(rootEl) {
    this.muted = readMuted()
    /** The previous poll's attention set. `null` until the first update, which seeds it
     *  without popping — a wall display that just turned on should not replay the backlog. */
    this._prev = null
    this._audioCtx = null

    this.el = document.createElement('div')
    this.el.className = 'hub-hud'
    this.el.innerHTML = `
      <div class="hub-scrim"></div>
      <div class="hub-toasts" role="status" aria-live="polite"></div>
      <header class="hub-head">
        <div class="hub-brand">
          <span class="hub-mark">Bot&nbsp;<b>Crossing</b></span>
          <span class="hub-sub">Team Wall</span>
        </div>
        <span class="hub-ro">● Read-only hub</span>
        <div class="hub-head-right">
          <div class="hub-summary"><b class="hub-need-n">0</b><span>need a human</span></div>
          <button class="hub-mute" type="button" aria-pressed="false" title="Mute the new-attention ping">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 5 6 9H2v6h4l5 4z"/>${MUTE_ICON.wave}${MUTE_ICON.x}
            </svg>
            <span class="hub-mute-label">Sound on</span>
          </button>
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
    this.$toasts = this.el.querySelector('.hub-toasts')
    this.$mute = this.el.querySelector('.hub-mute')

    this._syncMuteButton()
    this.$mute.addEventListener('click', () => {
      this.muted = !this.muted
      writeMuted(this.muted)
      this._syncMuteButton()
      // The click is a user gesture — a kiosk page otherwise never gets one, and without it
      // the browser's autoplay policy can leave the audio context suspended forever. Only worth
      // doing when turning sound on; muting needs no audio context.
      if (!this.muted) this._ensureAudio()
    })
  }

  _syncMuteButton() {
    this.$mute.setAttribute('aria-pressed', String(this.muted))
    this.$mute.classList.toggle('is-muted', this.muted)
    this.$mute.querySelector('.hub-mute-label').textContent = this.muted ? 'Sound off' : 'Sound on'
  }

  /** `threads`: the poll's merged, colony-tagged list. `colonies`: `/api/threads`'s own `.colonies`. */
  update(threads, colonies) {
    const now = Date.now()
    const rows = triageRows(threads, now)
    this._renderBoard(rows)
    this._renderStrip(threads || [], colonies || [], now)
    this._handleAttention(rows)
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

  _handleAttention(rows) {
    if (!this._prev) {
      // First update ever: seed the baseline without popping. Otherwise every page load (or
      // reload) would replay the whole existing backlog as a wall of toasts and dings.
      this._prev = new Set(rows.map((r) => r.id))
      return
    }
    const fresh = newlyNeedsAttention(this._prev, rows)
    if (fresh.length) {
      const byId = new Map(rows.map((r) => [r.id, r]))
      this._showToast(fresh.map((id) => byId.get(id)).filter(Boolean))
      if (!this.muted) this._ping()
    }
    this._prev = new Set(rows.map((r) => r.id))
  }

  _showToast(items) {
    if (!items.length) return
    const el = document.createElement('div')
    el.className = 'hub-toast'
    el.setAttribute('role', 'status')
    if (items.length === 1) {
      const r = items[0]
      el.innerHTML = `
        <div class="hub-toast-bang">!</div>
        <div>
          <div class="hub-toast-who">${esc(r.colony || 'Local')} · ${esc(r.project)} · ${r.status}</div>
          <div class="hub-toast-what">&ldquo;${esc(r.title)}&rdquo; <b>needs a human</b></div>
        </div>`
    } else {
      // Several landed in the same poll — one coalesced toast rather than a stack of them.
      el.innerHTML = `
        <div class="hub-toast-bang">!</div>
        <div>
          <div class="hub-toast-who">${items.length} sessions</div>
          <div class="hub-toast-what"><b>need a human</b></div>
        </div>`
    }
    this.$toasts.appendChild(el)
    setTimeout(() => {
      el.classList.add('is-out')
      setTimeout(() => el.remove(), TOAST_FADE_MS)
    }, TOAST_MS)
  }

  _ensureAudio() {
    if (this._audioCtx) return this._audioCtx
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return null
    try {
      this._audioCtx = new Ctx()
    } catch {
      this._audioCtx = null
    }
    return this._audioCtx
  }

  /** One short, soft ping — a decaying sine tone, no audio asset. */
  _ping() {
    const ctx = this._ensureAudio()
    if (!ctx) return
    if (ctx.state === 'suspended') ctx.resume().catch(() => {})
    const t0 = ctx.currentTime
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.type = 'sine'
    osc.frequency.setValueAtTime(880, t0)
    osc.frequency.exponentialRampToValueAtTime(660, t0 + 0.18)
    gain.gain.setValueAtTime(0.0001, t0)
    gain.gain.exponentialRampToValueAtTime(0.16, t0 + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.35)
    osc.connect(gain).connect(ctx.destination)
    osc.start(t0)
    osc.stop(t0 + 0.4)
    osc.onended = () => {
      osc.disconnect()
      gain.disconnect()
    }
  }
}
