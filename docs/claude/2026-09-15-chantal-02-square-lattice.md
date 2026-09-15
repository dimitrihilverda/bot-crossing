---
from: chantal
to: dimitri
date: 2026-09-15
---

Chantal is planning to change the colony's plot lattice from hexagonal to square, and it
touches code you build on, so this is a heads-up before any of it is written rather than after.
Nothing has been changed yet.

## Why

Her branch `moving-in-theme` is building a town around the colony out of KayKit's City Builder
Bits. Measured from `public/assets/city.glb`: every one of the eight buildings, all six road
pieces and the `base` slab are exactly **2 x 2** in plan. The kit is built for a square grid at
a 2-unit pitch, and its corner pieces all turn 90 degrees.

The colony is a hex lattice, so a path along it turns in multiples of 60. Stage 4's street work
had to drop a four-armed `road_junction` at every bend and say in the code that the markings do
not line up — see `src/world/road-mesh.js`, the comment above `carriagewayPoints`. Squaring the
lattice removes that compromise, and it removes the seam where the square town would otherwise
meet the hexagonal colony.

## What we measured about the blast radius

Ten files reference the hex primitives, three of them tests. Reference counts are small:
`HEX_DIRS` 16, `hexLine` 14, `hexDistance` 10, `worldToHex` 9, `PLOT_CELL` 9, `cellWorld` 5,
`hexRing` 5, `hexPrism` 2. `src/world/plots.js` is 965 lines and carries most of it — the
lattice primitives, the deck prism, the kerb (one bar per outside edge, so six become four) and
`SLOTS_PER_CELL = 7`, which currently means a centre slot plus six around it.

`src/world/streets.js`, `src/world/road-path.js` and `src/world/drive-path.js` get rewritten,
and they get simpler: a square lattice needs no cube coordinates and no largest-error rounding
repair, so `hexLine` becomes an ordinary Bresenham line.

## What this means for your work, which is the reason for this note

**Your `src/game/merge-state.js` should survive untouched.** We read it: it treats plot cells as
opaque pairs of integers for structural equality and union, and never does hex arithmetic. A
square lattice storing `[x, z]` pairs fits that unchanged. If you think we have misread it, that
is exactly the kind of thing worth saying before rather than after.

**`colonyAnchor` keeps its behaviour but changes its primitive.** You changed it recently to
`colonyAnchor(name, index, count)` so visiting colonies spread evenly around a ring instead of
clumping where their names hash — `src/world/plots.js:148`, and it is called from
`src/game/colony.js:477`. That intent carries over exactly; the ring it picks from becomes a
square ring rather than `hexRing(ANCHOR_RING)`. Districts would still surround the centre
evenly. The geometry your shared-colonies feature renders in changes shape, though, which is
why this note exists.

**`data/colony.json` resets once.** Every remembered `{q, r}` means something different on a
square lattice, so every plot moves once and is sticky again after that. On your side that
shows up as a visiting colony's district landing somewhere new the first time.

**`server/` is not touched by any of this.** Chantal's branch has kept `git diff -- server/`
empty through five stages. Worth saying plainly: that command compares against her own HEAD, so
what it proves is that she has not changed those files — it was never a comparison against your
branch, and we corrected that claim in her ledger after finding her branch had been one commit
behind your VPN fix for some time. It is current now: `moving-in-theme` merged your
`nuc-installer` as `959c7dd` and your `main` as `ea33a93`, and `server/` is byte-identical to
your `main`.

## The ask

Two questions, and no action wanted from you beyond an answer when it suits:

1. Does anything of yours do hex arithmetic on plot cells that we have not found? We grepped
   for the primitives above, but a private helper would not show up that way.
2. Is there a reason to keep the hex lattice that we are not seeing — something in the Hub, the
   wall layout, or how colonies are arranged around it that assumes six neighbours?

If either answer is yes, Chantal would rather know now than after `plots.js` is rewritten.
