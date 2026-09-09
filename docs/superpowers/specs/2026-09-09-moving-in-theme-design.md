# Moving-In Crossing — design

A fork of [Bot Crossing](https://github.com/Station-Sciences/bot-crossing) that re-themes the
colony from a moon base into Moving-In's own work: crew assembling rental furniture, loading
it into vans, driving it to houses, and collecting it again.

- **Upstream:** `bot-crossing` (`git pull upstream main` stays available)
- **Branch:** `moving-in-theme`
- **Audience:** Chantal only, on her left monitor. Not a customer-facing demo, so no logo,
  no brand compliance, no polish beyond "pleasant to look at".
- **UI language:** stays English, so upstream changes keep merging cleanly.

## Why this theme fits

Bot Crossing's central idea is that a thread is a little person who sometimes needs you. The
metaphor has to carry two things: *somebody is there*, and *they will leave again*. Rental
furniture does that better than rockets do — it goes out, it gets used, it comes back. A
thread has the same shape.

## What maps to what

The structure is unchanged; only its meaning moves. This matters: the hex layout carries the
"a zone stays where it was" logic that makes the map learnable, and that is worth more than
realism.

| Bot Crossing | Moving-In Crossing | In your threads |
| --- | --- | --- |
| Hex zone | A plot with a house on it | One repo |
| Astronaut | A crew member | One session |
| Building nears completion | House fills up with furniture | Transcript size (log scale) |
| Scaffolding | Van parked out front | Somebody is at that site now |
| The ship, centre of the colony | The depot | — |
| Walking out of the ship | Van pulls up, crew unloads | A thread that just appeared |
| Walking back into the ship | Crew loads up, van returns to the depot | You archived it |

### Behaviour

Unchanged as a mechanism: a **strict precedence**, so a thread is only ever doing one thing,
first match wins. Only the states that want something from you get a badge — with most of a
real thread list sitting quiet, a symbol over every crew member buries the one `?` that
matters.

| Signal | What the crew member does | Badge |
| --- | --- | --- |
| Errored | Slumps beside a toppled cabinet, orange beacon stutters | `!` |
| Running now | Screwing a piece together, shavings fly | `⚒` |
| PR merged | Cheers, confetti | `✓` |
| Unread | **Stops and waits on you** | `?` |
| Nothing for 3 days | Sits on a moving box, dozes off | — |
| Anything else | Potters about the house | — |

### Explicitly not doing

**No real street plan with house numbers.** The floating hex plots stay. Their stickiness is
what lets you learn the map; a literal town would trade that away for realism that buys
nothing. The van drives along the plot edge, not through a road network.

**The badge never moves to the van.** One crew figure per thread does everything — loads,
drives, unloads, assembles. A van is a tool it uses, not an actor. A moving target is hard to
click and its status is hard to read, and finding that one `?` is the whole point of the app.

## Staging

### Stage 1 — the world reads as Moving-In

Ends with something that works end to end: houses on plots, crew members with correct badges,
furniture accumulating, clicking a crew member still opens the thread in its harness.

Six files carry it:

| File | Change |
| --- | --- |
| `src/world/buildings.js` | `KINDS` becomes houses; progress becomes furniture fill rather than build stages. ~565 lines, the bulk of the work |
| `src/world/kit.js` | Register the furniture and city kits |
| `src/world/planet.js` | Default to Terra; retune ground and scatter for a residential setting |
| `src/world/ship.js` | Ship becomes the depot |
| `src/agents/astronauts.js`, `crew.js` | Re-theme behaviour, add clips |
| `src/ui/hud.js` | Terminology (English) |

### Stage 2 — the vans drive

Van pulls up on arrival, crew loads and unloads, van leaves on archive. Split out because
stage 1 is useful without it and it carries the one unresolved dependency (below).

## Assets

Three kits in `assets-src/`, all CC0 from Kay Lousberg, all free tier:

| Pack | For | Output |
| --- | --- | --- |
| KayKit Furniture Bits | Sofas, beds, tables, cabinets, lamps | `public/assets/furniture.glb` |
| KayKit City Builder Bits | Houses, pavement, fences, later the vans | `public/assets/city.glb` |
| KayKit Character Animations *(already used)* | Longer clip list: lifting, carrying, sitting | `public/assets/crew.glb` |

Both new packs use a single 1024px gradient atlas — the same property `kit.js` already relies
on to collapse a building into one draw call — so `tools/build-kit.mjs` works unchanged.
`tools/build-assets.mjs` gains two calls. For the crew, only `WANTED` in `build-crew.mjs`
grows: the pack ships 161 clips and the colony currently keeps 14.

## Risks

**The accent-colour swatch must be found again.** Each repo gets its own colour because the
building shader repaints one atlas swatch — `CELL.TRIM`, cell 11 in the Space Base atlas,
masked via `ACCENT_MASK`. Which cell plays that role in the furniture and city atlases is
unknown until they are opened. Work, not a blocker; if no single swatch reads as "this
house's colour", the fallback is to tint a separate small part (door, or the van's panel).

**Vans may not be in the free tier.** City Builder Bits previews show vehicles, but whether
they sit in the free tier or the $3.95 tier is unconfirmed. Affects stage 2 only, and $3.95
is not a blocker — but it is not verified either.

**Scale mismatch.** Furniture Bits is interior-scale, City Builder Bits is city-scale. There
is already a `BUILDING_SCALE` constant, so this is expected to be a per-kit factor rather
than a redesign.

## Testing

The 33 existing tests cover harness scanning and state merging — theme-independent, and they
are the safety net proving the re-theme did not break how threads are read. They must stay
green throughout.

New tests go on the pure functions only: the state-to-appearance mapping (which model and
which clip for which thread state) and the furniture-fill curve. The 3D scene itself is not
unit-tested, matching how upstream is built.

## Deployment

Runs on **port 5275** via `PORT`, which both `serve.mjs` and `vite.config.js` already read,
so it lives alongside the existing Bot Crossing on 5274. The logon autostart
(`shell:startup\Bot Crossing.vbs` → `%LOCALAPPDATA%\bot-crossing\start-bot-crossing.ps1`)
keeps pointing at 5274 until this version is good enough to replace it.
