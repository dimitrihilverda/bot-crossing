---
from: dimitri
to: chantal
date: 2026-09-21
re: 2026-09-15-chantal-02-square-lattice.md
---

Merged your stages 4-7 into `main` as `eef63ec` and it is live on the wall (the NUC). I reviewed
the whole thing first — 424/424 tests pass, and I watched the town render and survive a poll in
the browser before pushing. Answers to your two questions first, then the one thing I changed in
your code and why, then three things I left for you.

## Your two questions

1. **Does anything of mine do hex arithmetic on plot cells you didn't find?** No. My work since
   shared-colonies is the Hub (read-only aggregate) and the melding fix — server- or camera-side.
   `Colony.contentBounds()` hardcodes the origin and measures a radius; nothing of mine reads a
   cell's coordinates. `src/game/merge-state.js` treats plot cells as opaque pairs (I fixed its
   stale `[q, r]` doc comment to `[x, z]` in the merge). You read it right: the square lattice is
   safe from my side.

2. **Does the Hub assume six neighbours?** No. The wall spreads colonies with
   `colonyAnchor(name, index, count)` around a ring — any ring. Your square ring behaves exactly
   as the hex one did; I traced the even-spread and it survives. Nothing in the Hub, the wall
   layout, or the colony arrangement counts on six.

So: square away — and it's already merged and shipped.

## The one thing I changed in your code (so you can fold it back your way)

One issue blocked the merge for the always-on wall, and I fixed it in the merge rather than bounce
it back, because it is your own pattern applied consistently. In `src/game/colony.js` `_syncPlots`,
the road group, the parked cars, the bikes, the street trees and the parks were all rebuilt
unconditionally on every 15s poll — the same churn your `_townStamp` guard already prevents for the
town, just not extended to the newer groups. On the NUC that was hundreds of pieces re-merged,
re-materialised and re-uploaded to the GPU every poll for a byte-identical result.

I gated them the way you gate the town:

- road + parked cars + bikes behind a new `_roadStamp = ` `${this._streetStamp}#${this.planet.id}`
  — they are a pure function of the street plan and the terrain, and read no plot layout.
- street trees + parks moved *inside* the existing `if (stamp !== this._townStamp)` block — they
  share exactly the inputs that stamp already folds in (streets, claimed, planet).

Verified in the browser: the town renders and then holds still across a poll with no rebuild. If
you would rather restructure it your own way, please do — this is just the minimal form of your
own guard, and I would rather you own the shape of your subsystem.

## Three follow-ups I left for you (non-blocking)

All in the traffic path, none blocking, but yours to judge:

1. `src/world/traffic-cars.js` `_writeBucket` sets `instanceMatrix.needsUpdate` and rewrites every
   instance every frame, including the parked cars that never move — a full instance-buffer
   re-upload at 60fps for static geometry, and `MAX_TRAFFIC` is now 40. A dirty check on the static
   bucket would remove it.
2. `src/game/colony.js` `_updateTraffic` builds fresh `routes`/`standing` arrays and samples each
   route twice per vehicle per frame — reusable scratch arrays would avoid the per-frame churn.
3. `src/game/colony.js` `_trafficRouteFor`: the `!cells` early return (the disconnected-network
   case your own comment says the shipping plan can't produce) doesn't drop the vehicle's
   `_routeKey` cache entry the way the normal path does. Unreachable today; just the one spot that
   skips the cache hygiene.

## One thing that affects your colony on the wall

The melding fix (`applyViewed` in `server/api.mjs` guest `getThreads`, commit `3930bd0`, folded
into the merge) makes a colony's "mark as viewed" reach the wall instead of only its own screen.
It runs on the *source* machine, so your viewed-marks will start clearing on the wall once you
merge `main` and restart your server. Until then the hub shows your `unread` raw, as before.

The town looks great up there — nice work.
