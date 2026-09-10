# Moving-In Crossing — design

A fork of [Bot Crossing](https://github.com/Station-Sciences/bot-crossing) that re-themes the
colony from a moon base into Moving-In's own work: crew assembling rental furniture, delivering
it to houses by car, and collecting it again.

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
| Astronaut | A crew member — no headgear, its own hairstyle and skin tone, hi-vis bands (Stage 3) | One session |
| Building nears completion | House fills up with furniture | Transcript size (log scale) |
| Scaffolding | A delivery car parked at the kerb | Somebody is at that site now |
| The ship, centre of the colony | The depot | — |
| Walking out of the ship | A car drives the whole way out from the depot; its crew member is off screen for the walk | A thread that just appeared |
| Walking back into the ship | The car drives the whole way back to the depot | You archived it |

### Behaviour

Unchanged as a mechanism: a **strict precedence**, so a thread is only ever doing one thing,
first match wins. Only the states that want something from you get a badge — with most of a
real thread list sitting quiet, a symbol over every crew member buries the one `?` that
matters.

| Signal | What the crew member does | Badge |
| --- | --- | --- |
| Errored | Slumps beside a toppled cabinet, hi-vis bands stutter | `!` |
| Running now | Screwing a piece together, shavings fly | `⚒` |
| PR merged | Cheers, confetti | `✓` |
| Unread | **Stops and waits on you** | `?` |
| Nothing for 3 days | Sits on a moving box, dozes off | — |
| Anything else | Potters about the house | — |

### Explicitly not doing

**No real street plan with house numbers.** The hex plots stay, and so does their stickiness —
that is what lets you learn the map, and a literal town would trade it away for realism that
buys nothing. Nothing lays out roads, and no plot moves to accommodate a route.

The car does, however, **drive the whole way** from the depot to the plot rather than only
appearing at its kerb. That was reconsidered after Stage 1 landed, and it does not cost the
stickiness this section protects: driving *across* the hexes changes nothing about where they
sit. It is affordable because `src/world/plots.js` already holds the primitives — `HEX_DIRS`
for the six neighbour directions, `hexToWorld()` and its inverse — and because `TILE` is
`CELL * 0.992`, pulled in by less than one percent purely to stop z-fighting. The colony is
therefore one continuous hex surface, not floating islands, so a journey is a hex line with
height-following rather than pathfinding over gaps.

**A crew member whose status carries a badge is never hidden — not "the badge never moves to
the van".** Implementation sharpened this rule past what it reads like above: the car is not
a thing the crew figure rides visibly the way a person rides a vehicle in a cutscene. Instead,
a crew member walking to or from its plot while its car is on the road simply is not drawn for
that walk — one figure per thread still does everything, the car is a prop it uses, not a
second actor with its own state. Two things bound that, and both are narrower than "hidden
while its car drives":

- **It has to be walking.** A crew member standing on its own plot is drawn, whatever its car
  is doing — and that is the common case, because a thread that merely stops running sends its
  car home from a plot its crew member has not left. Hiding a figure that is standing right
  there buys nothing and costs the click target.
- **It must carry no badge.** A thread whose status carries a badge is drawn regardless of
  where its car is, because the badge is the one thing the whole application exists to make
  findable, and a moving, half-hidden target defeats that.

So a car may legitimately drive with nobody visibly aboard.

## Staging

### Stage 1 — the world reads as Moving-In

Ends with something that works end to end: houses on plots, crew members with correct badges,
furniture accumulating, clicking a crew member still opens the thread in its harness.

Six areas carry it, across seven files:

| File | Change |
| --- | --- |
| `src/world/buildings.js` | `KINDS` becomes houses; progress becomes furniture fill rather than build stages, on the same log-scale curve upstream uses for building completeness. ~565 lines, the bulk of the work |
| `src/world/kit.js` | Register the furniture and city kits |
| `src/world/planet.js` | Default to Terra; retune ground and scatter for a residential setting |
| `src/world/ship.js` | Ship becomes the depot |
| `src/agents/astronauts.js`, `crew.js` | Re-theme behaviour, add clips |
| `src/ui/hud.js` | Terminology (English) |

### Stage 2 — the delivery drives — **Implemented**

Originally scoped as: van pulls up on arrival, crew loads and unloads, van leaves on archive.
Split out because Stage 1 is useful without it and it carried the one unresolved dependency
(below). What actually shipped differs from that framing in two deliberate ways — see
"What changed from the plan" at the end of this section.

**The unresolved dependency is now resolved, and the answer was no.** There is no van in the
free tier, and paying does not help — City Builder Bits' Extra tier adds park assets, not
vehicles. The pack ships five cars: `car_hatchback`, `car_police`, `car_sedan`,
`car_stationwagon` and `car_taxi`, each with its four wheels as separate nodes.

Searching other CC0 libraries did not turn up a van in a matching style either. So the
vehicle is **`car_stationwagon` with a load on its roof** — an armchair from the furniture
kit, so it reads as a delivery rather than as someone dropping by. Three things make staying
inside the city kit worth more than a closer-shaped model from elsewhere: it shares the
houses' atlas, so it merges and takes the repo's accent through the same repainted-cell
trick; its wheels are separate nodes, which `kit.js`'s `solo` mode exists for, so they can
turn; and it is the same artist's hand, so it cannot clash. A van from another pack would
bring a second atlas, a different scale and a different style.

`Scaffolds` — the timber poles that used to ring a finished house, and the last un-themed
object in the colony — is gone. The parked car, at the kerb rather than at the house itself
(so it stays visible instead of vanishing behind the building), is now the "somebody is
working here right now" marker, using the same `_isActive` predicate `Scaffolds` used.

**What changed from the plan.**

- **The crew rides; it does not load or unload.** `astronauts.js` derives a crew member's
  behaviour from `STATUS_ORDER`, a strict, first-match-wins precedence over six statuses plus
  the two states a crew member passes through on its way in and out. A "loading" or
  "unloading" animation would have been a seventh behaviour competing with those eight for
  the same figure, and the plan gave no rule for how it should lose to, say, an `!` that
  starts mid-load. Rather than invent one, the crew member is simply not drawn for the walk
  its car is making on its behalf, and comes back into view when it stops walking.
  `STATUS_ORDER` stays untouched and a thread still does exactly one thing.

  **The two do not arrive together, and the car is the quicker.** `riding` is a draw-time
  skip and nothing more: the crew member walks its own navigation path throughout, so the car
  (3.2 u/s along a straight hex line) and the figure (2.1 u/s ± 14 % per crew member, around
  whatever the grid says is in the way, with an acceleration ramp and braking on arrival) are
  two independent motions. The car parks with its crew member still roughly a third of the
  route short, and the figure comes back into view there to walk the rest in on foot. That is
  not a mistuned constant to be fixed by slowing the car down: because a crew member is
  released the moment it *stops walking*, a slower car would simply move the mismatch to the
  other side, with the figure standing on its plot before its own car pulled up. What the car
  stands in for is the walk, not the arrival.
- **The badge rule is sharper than "never moves to the van."** That phrasing implied the
  badge and the van were both candidates for carrying it and the badge always won. What was
  actually built is narrower: a crew member whose status carries a badge is never hidden at
  all, full stop — not hidden while riding, not hidden for any other reason a future feature
  might introduce. The badge is the one thing the whole application exists to make findable,
  so the rule is about visibility of that crew member, not about where the badge itself can
  live. One concrete effect: a car can be seen driving with nobody visibly aboard — whenever
  the thread it belongs to has something to say, and for the whole of every drive home from a
  plot whose crew member is standing on it.

### Stage 3 — the crew stop being astronauts

Stages 1 and 2 left the figures wearing a spacesuit. Their trim colours, their props and
their animation clips were re-themed; the silhouette never was. Stage 1's plan asked only
for "trim colours that read as work clothing rather than spacesuits" and got exactly that,
so nothing caught it — the reviews checked the work against the brief, and the brief did not
mention the headgear. The mapping table above promises *Astronaut → A crew member*. This
stage is that promise, unpaid since Stage 1.

What they wear now is entirely procedural, in `_buildMeshes` in `src/agents/astronauts.js` —
a `SphereGeometry` helmet, a `sphereCap` visor with a squircle SDF cut in the fragment
shader, a `roundedBox` backpack, a cylinder antenna with a glowing tip, and a chest lamp. No
asset pack is involved, so this is replacing shapes with shapes rather than hunting for a
model.

**What goes, and what arrives:**

| Now | After |
| --- | --- |
| Helmet, visor | Gone. **No headgear at all** |
| — | The **head**, taken off `DROP_MESHES` in `crew.js` and given its own instanced mesh so it can carry a **skin tone** |
| — | **Three or four hairstyles** built from primitives — a short cap, something longer, a bun, and bald |
| Screen-face | **Stays.** It becomes a face on a head rather than a screen on a visor, and it keeps carrying the eye colour |
| Backpack, antenna, glowing tip, chest lamp | Gone |
| — | **Hi-vis bands** on the torso, carrying the status trim colour, bright enough past 1.0 that the bloom pass catches them at night |
| Hammer, toppled cabinet, moving box | Stay |

**Skin tone and hairstyle must never mean anything.** Both are derived stably from the
thread id, the way a plot's accent is derived from its repo name, and neither ever changes
with status. They are how you tell one crew member from another, not how you tell what one
is doing. A colony where skin tone tracked state would be both a bug and grotesque.

**The three status carriers survive, and one of them moves.** Trim colour and eye colour are
untouched in mechanism — the eyes were the reason the screen-face was kept rather than
replaced by the mannequin's blank face. What moves is the night signal: it was two small
unlit spheres pushed past 1.0, and it becomes the hi-vis bands. That is the one readability
trade this stage makes, and it is made deliberately.

The bands inherit one job from the parts they replace. The behaviour table's errored row
used to read "orange beacon stutters", and that beacon **was** the antenna tip and the chest
lamp. Deleting them without moving the stutter would have left the table promising something
no longer in the code — so the row now reads "hi-vis bands stutter", and the bands carry the
blink as well as the glow. Whatever implements this must keep an errored crew member visibly
pulsing, not merely coloured red; the pulse is what catches the eye across a colony, and it
is the one thing an `!` badge cannot do on its own at that distance.

**Two things could sink this, and both are checked before anything is drawn.**

*The head may not be separable.* The crew is drawn as one `InstancedMesh` over a merged body
geometry, with one skeleton baked into a float texture that every instance samples —
`crew.js` says so in its own header. Pulling the head out means a **second** instanced
skinned mesh sampling that same bone texture, and whether that works is not obvious from
reading. So it is the first task, before a single hairstyle exists. If it cannot be done,
the fallback is a skin tone applied to the whole body, which puts skin on the sleeves too:
worse looking, but it works, and it is a fallback rather than a redesign.

*The bands may not bloom.* `engine.js` keeps the bloom threshold high on purpose — its own
comment says a high threshold "keeps this an accent rather than a haze: only the eyes". Two
small bright spheres clear that easily; a band is a different shape, and at the height a
crew member occupies on screen it may be a few pixels. This is verified at night, at colony
zoom, and not by assertion. The fallback is a wider band or a small bright detail on the
vest — not a headlamp, since this stage removes headgear.

Note for whoever verifies either of these: **the Browser pane does not drive
`requestAnimationFrame`** — measured at 0 frames in 3 seconds with the document visible — so
the scene sits frozen there and sampled animated state is worthless. Drive frames by hand
from the console, or use a real browser.

## Assets

Three kits in `assets-src/`, all CC0 from Kay Lousberg, all free tier:

| Pack | For | Output |
| --- | --- | --- |
| KayKit Furniture Bits | Sofas, beds, tables, cabinets, lamps | `public/assets/furniture.glb` |
| KayKit City Builder Bits | Houses, pavement, fences, and the delivery car | `public/assets/city.glb` |
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
house's colour", the fallback is to tint a separate small part (door, or the car's panel).

**Vans are not in the pack at all — resolved, see Stage 2.** The free tier ships five cars and
no van or truck, and the paid tier adds park assets rather than vehicles. Stage 2 therefore
uses `car_stationwagon` with a roof load. This risk is closed; it is left here because the
mitigation it names ("$3.95 is not a blocker") turned out to buy nothing, which is worth
knowing before anyone spends the money.

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

Runs on **port 5280** via `PORT`, which both `serve.mjs` and `vite.config.js` already read,
so it lives alongside the existing Bot Crossing on 5274. The logon autostart
(`shell:startup\Bot Crossing.vbs` → `%LOCALAPPDATA%\bot-crossing\start-bot-crossing.ps1`)
keeps pointing at 5274 until this version is good enough to replace it.
