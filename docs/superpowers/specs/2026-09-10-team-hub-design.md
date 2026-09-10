# Team hub — a projected triage board for the whole team's colonies

Approved in brainstorm 2026-09-10. Fase 1 only. Fase 2 (interacting with other people's
sessions — takeover, approvals) is explicitly out of scope: it needs a write path into another
person's harness and a different trust model, and gets its own spec.

## Goal

An always-on screen in the office that shows **every teammate's colony at once**, read-only,
with the workers that need a human surfaced loudly — who is waiting, whose it is, and how long.
Useful first (a triage board), fun second (the colony game as the backdrop). Sized for 2-8
colonies now; the same layout should still read at a handful.

## What runs where

- **The hub device:** an Intel **NUC6i3SYK** (i3-6100U / HD 520) driving the office screen. It
  runs the existing Bot Crossing app (the merged `main` build) in a new **hub mode**, fullscreen,
  in a kiosk browser. The NUC6CAY (Celeron) is too weak for smooth WebGL and stays a reserve.
- **Tailscale:** the NUC joins the tailnet with a stable `100.x` IP. That IP is how teammates
  let it read them, and how it reaches them — same transport that already works between Dimitri
  and Chantal.
- **Render budget:** default the hub to the **Low** preset (HD 520 handles the 3D there); Balanced
  if it stays smooth. No 2D-lite mode is built now — noted as the fallback if a Pi ever replaces
  the NUC.

## Architecture: hub mode in the existing app

Hub mode is the existing app with a flag (`?hub=1`, or a stored setting), which changes three
things and nothing else:

1. **Read-only, no per-user actions.** Open / archive / new-conversation / share controls are all
   hidden — the hub owns no sessions. It is a viewer.
2. **Aggregate everyone.** The hub's `network.neighbors` holds every teammate's `100.x:5275`, so
   its own `/api/threads` already returns everyone's threads merged and tagged by colony (the
   district/merge machinery built for shared colonies). The map renders all colonies as districts,
   as the ambient backdrop.
3. **The triage HUD** (below) becomes the primary layer, drawn over the game.

Reusing the app rather than building a separate dashboard keeps the colony charm and inherits the
merge, districts, grounding, online/offline handling and reconnection for free. The only genuinely
new code is the triage HUD and the "allowed readers" trust tweak.

## Connectivity & trust: "allowed readers"

The hub must **read** everyone, but it shares nothing back, so the current "add a neighbour"
(which both visits and allows) fits awkwardly — a teammate adding the hub would get a dead,
永-offline colony on their own map.

So Fase 1 adds a small, clean separation in `network`:

- **`network.allowedReaders`**: a list of IPs allowed to read this colony **without** being a
  colony this machine visits. The guest origin check becomes: allow **loopback ∪ neighbours'
  hosts ∪ allowedReaders**.
- Each teammate adds the hub's `100.x` once under a new **"Allow a screen / hub to read me"**
  line in Settings → Shared colonies. No dead colony appears on their map.
- The hub side just adds everyone as ordinary neighbours (it visits them).

This is the "allow ≠ visit" split raised earlier; the hub is its first real use, and it is what
Fase 2 will build permissions on top of.

## The triage HUD

Drawn over the game, four parts:

1. **NEEDS YOU board** — the heart, always visible, prominent. Every thread across all colonies
   whose status is `waiting` (handed back to a human, the bobbing `?`) or `blocked` (errored, the
   `!`), sorted by **how long it has been in that state, longest first**. Each row: colony (whose),
   repo, session title, a status pip, and the wait time (`14m`). Empty state: a calm "All clear"
   so a quiet board reads as good news, not a broken screen.
2. **New-attention popup** — when a thread *newly* enters `waiting`/`blocked` (was not in the
   previous poll's set), a large toast slides in over the screen — `⚠ Chantal · mios — "Deploy
   script" needs you` — and fades after ~6s. Coalesced if several land at once.
3. **Sound** — a soft, short tone on a new-attention popup, with an on-screen **mute** toggle
   (state kept in localStorage so the office screen remembers). Silent when muted.
4. **Colony strip** — one compact row per colony: online dot, name, and counts (working /
   waiting / blocked). The team pulse at a glance, and it makes an offline teammate obvious.

The 3D colony map stays as the backdrop so the screen is still alive and fun; the HUD is the
layer you actually read.

## Data flow

- The hub polls its own `/api/threads` (unchanged) every ~10-15s → the merged, colony-tagged
  thread list.
- A pure **triage selector** turns that list into the NEEDS YOU rows: filter to
  `waiting`/`blocked`, compute wait time from `lastActivityAt` (or an entered-state stamp), sort.
- A **diff against the previous poll's attention set** yields the "newly needs you" items that
  drive popups + sound. Kept in memory on the page.
- All of this is client-side, on top of data the server already produces. The only server change
  is `allowedReaders` in the origin check and in the saved `network` block.

## Components (new)

- `src/ui/triage.js` — the triage selector (pure: threads → sorted NEEDS YOU rows; new-since-last
  diff). Unit-tested.
- `src/ui/hub.js` + HUD markup/styles — the hub layer: NEEDS YOU board, popups, sound, colony
  strip, mute. Mounted only in hub mode.
- `server/api.mjs` / `guest.mjs` — `allowedReaders` folded into the origin allowlist and the
  cleaned/saved network block; `hostAllowed` already takes the allowed-hosts list, so this is
  additive.
- Settings (`hud.js`) — the "Allow a hub/screen to read me" line under Shared colonies.
- A hub launcher for the NUC (kiosk fullscreen, autostart) — the same shape as the existing
  Windows autostart, pointed at `?hub=1`.

## Testing

- Unit: the triage selector (which threads count, wait-time sort, the new-since-last diff),
  and the `allowedReaders` origin check (a reader IP is allowed without being a neighbour;
  a stranger is still refused).
- Local multi-colony run: two fake colonies + a hub instance on one machine; confirm the NEEDS
  YOU board fills, a newly-waiting thread pops and dings, and mute silences it.

## Explicitly out of scope (Fase 1)

- Taking over or writing to another person's sessions; approving another person's prompts
  (Fase 2 — separate spec, write-path trust model).
- Auth beyond the tailnet + allowedReaders; accounts; history/metrics over time.
- A non-WebGL/2D dashboard mode (only if a Pi ever replaces the NUC).
