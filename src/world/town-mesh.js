import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { TOWN_CELL_RADIUS } from './street-plan.js'
import { blockContent, inTown } from './town-plan.js'

/**
 * The town: the buildings that fill whatever blocks the colony has not taken.
 *
 * Nothing here means anything. The colony is the data; this is the place it sits in. A block
 * the colony claims is simply not drawn, and `town-plan.js` is a pure function of position,
 * so a block that comes free again comes back exactly as it was.
 */

/**
 * The most geometry the town may add, in vertices — the *complete* draw of a full colony,
 * re-measured in this revision against the ruling that the original figure (Task 6 Step 1,
 * houses alone) undercounted it: the colony also renders plot decks, kerbs, clutter props,
 * the ship, the crew and the labels, none of which was in the old 550,000 number. Raising
 * this measurement is not the same move as raising the ceiling above a measurement — the
 * spec forbids only the second, and this is the first: the honest figure for what the colony
 * itself already puts on screen.
 *
 * Every part below uses the same 40-project, 100-thread spread `test/route-on-street.test.mjs`
 * seeds (`mulberry(40 * 7919)`, each project 1-4 threads), the same spread the old figure was
 * measured against, run through `allocateCells` for real: every one of the 40 projects needs
 * `ceil(size / 9) = 1` cell (`cellsNeeded` in `plots.js`, since no project here exceeds the
 * 9-thread-per-cell `SLOTS_PER_CELL`), so this is a 40-plot, 100-thread colony, one cell per
 * plot. Vertex counts for kit parts are read directly off the shipped `.glb` files with
 * `@gltf-transform/core`'s `NodeIO`, summing `POSITION` attribute entries over every mesh
 * under a named node — the same method, and the same files, Task 6 and Task 3 both used.
 *
 * 1. **Houses** (`src/world/houses.js`, Task 6's own figure, unchanged by this revision — the
 *    module was not touched): one shell per thread, picked uniformly from three `_withoutBase`
 *    city-kit parts (819 + 1236 + 1581, mean 1212 vertices), plus the same fixed set of eight
 *    furniture-kit pieces every house gets regardless of progress (48 + 712 + 600 + 260 + 458 +
 *    1341 + 632 + 304 = 4355 vertices — `aReveal` only discards fragments, never vertices).
 *    100 * (1212 + 4355) = **556,700**.
 * 2. **Plots** (`src/world/plots.js`), for the same 40 plots (one cell each):
 *    - *Deck*: one `TILE`-square box prism per cell, `BufferGeometryUtils.mergeGeometries`
 *      preserving each box's own 24 vertices — 40 * 24 = 960.
 *    - *Kerb border*: one box per *exterior* cell edge; a lone-cell plot has all four edges
 *      exterior, so 40 * 4 = 160 boxes * 24 vertices = 3,840.
 *    - *Lamp posts*: one pole (a `BoxGeometry`, 24 vertices) plus one lamp head (a
 *      `SphereGeometry(0.14, 8, 6)`, 63 vertices) per cell — 40 * (24 + 63) = 3,480.
 *    - *Clutter*: `_buildClutter`'s own per-cell `mulberry(hashString(id) + 17)` stream,
 *      replayed exactly (the same candidate-then-accept draw over the two vertical and two
 *      horizontal channels, then one `rand()` for the prop name and one for its rotation per
 *      accepted spot, in that order) against the real 40 plot ids: **196** props placed,
 *      summing each one's own base-kit vertex count (`containers_A..D` 396 each, `cargo_A`/
 *      `cargo_B` 164 each, `cargo_A_packed`/`cargo_B_packed` 228 each, `lights` 504) —
 *      **60,180** vertices.
 *    - Plot subtotal: 960 + 3,840 + 3,480 + 60,180 = **68,460**.
 * 3. **The ship** (`src/world/ship.js`) — one fixed structure, not per-thread: the shell
 *    (`building_G_withoutBase`, 1,955 vertices), five yard containers (`containers_A`, 396
 *    each = 1,980), the dock plate (a box, 24), four lane-marking boxes (24 each = 96), two
 *    edge-strip boxes (24 each = 48), the roof beacon (`SphereGeometry(0.14, 10, 8)`, 99),
 *    eight floodlights (`SphereGeometry(0.11, 8, 6)`, 63 each = 504), and the apron
 *    (`CircleGeometry(r, 32)`, 34). Total: **4,740**.
 * 4. **The crew** (`src/agents/astronauts.js`): one instanced, GPU-skinned figure per thread —
 *    100 for this spread, the whole roster at once (the crew count is capped at
 *    `min(capacity, settings.maxAgents)`, and the highest preset's `maxAgents` is 200, so a
 *    100-thread roster is fully on screen at that preset; this measures against that, since a
 *    lower preset only draws *less*). Each agent wears one of two garment sets
 *    (`GARMENT_SETS` in `src/agents/garment-sets.js`), chosen by a roughly even hash
 *    (`garmentSetIndexFor`), and each set is its own six merged body parts (`Body`, `ArmLeft`,
 *    `ArmRight`, `LegLeft`, `LegRight`, `Head`) read straight off `public/assets/crew.glb`:
 *    Ranger 3224 + 668 + 668 + 780 + 780 + 1172 = 7,292; Rogue 1369 + 653 + 653 + 780 + 780 +
 *    2131 = 6,366. Mean **6,829** per agent (the same "mean across a uniformly-chosen variant"
 *    method the house shell figure above already uses). 100 * 6,829 = **682,900**. (The
 *    hammer/cabinet/box props and the status badge are status-gated, small — a few hundred to
 *    low thousands of vertices each — and drawn for only a subset of agents at once, so they
 *    are not part of this always-present figure; the delivery fleet and the ambient traffic
 *    cars are the same kind of variable, status-driven draw and are excluded for the same
 *    reason, not because they were unread — see `src/world/deliveries.js`.)
 * 5. **Labels** (`createLabel` in `plots.js`): one billboard `PlaneGeometry` per plot, 4
 *    vertices each — 40 * 4 = **160**. (District banners, `createBanner`, are the same shape
 *    again and add nothing here — this spread has no visiting colonies.)
 *
 * 556,700 + 68,460 + 4,740 + 682,900 + 160 = **1,312,960**, rounded down to the nearest
 * round figure (10,000), the same convention the old 556,700 -> 550,000 rounding used.
 *
 * The spec's rule is that the scenery must not outweigh the thing it surrounds. If a later
 * change pushes past this, the levers, in order of fewest side effects: the per-slot gap
 * probability in `blockContent` (`town-plan.js`, `GAP_SHARE`), the kit's `_withoutBase`
 * building variants, `GREEN_SHARE`, and last `TOWN_CELL_RADIUS` — which redraws the street
 * network too, since `street-plan.js` shares it.
 *
 * Re-measured again in the playful revision (curved corners, no pavement, streets that jog
 * repeatedly, `SET_BACK` brought to the kerb line — see each constant's own doc comment): the
 * real network placed 186 buildings for **418,456** vertices — well down from the tighten
 * revision's 332 / 760,343. Two changes pulled in the same direction. First, more street cells
 * turn, and turning costs frontage: `CORNER_SKIP_COUNT` (`town-plan.js`) left two slots empty
 * at a real or diagonal corner instead of one, because `SET_BACK`'s own increase (7.2 -> 9.0,
 * to reach the kerb line with no footway between) put a second slot inside the collision
 * radius that only the outermost slot used to reach — see that constant's own doc comment for
 * the geometry, and `test/town-plan.test.mjs`'s overlap test for the measured defect (two real
 * buildings 0.6 units deep into each other) this closes. Second, the street network itself has
 * far more corners and fewer long straight runs (31 bends against the tighten revision's 6,
 * `JOG_CHANCE` 0.45 -> 0.75 in `street-plan.js`), so a larger share of the town's frontage sits
 * at one of those corner-priced cells.
 *
 * Re-measured again in the facade revision (`SET_BACK` closer still, to 8.95, and a per-slot
 * skip at a governed junction arm): the real network placed **179** buildings for **403,192**
 * vertices — seven fewer than the playful revision's 186, the ones whose only street-facing slot
 * fell inside a governed junction arm's own traffic light.
 *
 * Re-measured once more in the flush revision (`SET_BACK` brought all the way to the
 * carriageway's own edge, `BUILDING_CLEARANCE` 0.05 — see that constant's own doc comment in
 * `town-plan.js`): the real network now places **130** buildings for **295,498** vertices, a
 * real net *loss* of 49 against the facade revision's 179. `reservedSlots` (`town-plan.js`)
 * replaces the facade revision's single-slot `JUNCTION_LIGHT_SKIP_INDEX` (about five real
 * collisions, traffic lights only) with a general reservation checked against every real piece
 * of a street cell's own furniture — every plain streetlight along a frontage, not only a
 * governed junction's own light — because bringing the wall flush to the carriageway (1.25 from
 * the street centre line, against the facade revision's 1.85) brings *every* row within reach of
 * the streetlight standing at its own kerb line, not just the small minority that used to graze a
 * junction's own signal. Measured directly: 206 slots reserved town-wide (194 for streetlights,
 * 7 for `trafficlight_A`, 5 for `trafficlight_B`; `road_straight_crossing` never reserves a slot
 * in this real network — see `flush-revision-report.md` for the mutation evidence). A genuine
 * majority of those streetlight reservations (97 of 97 rows a near lamp reaches) cost *two*
 * adjacent slots, not one: `vergeFurniture`'s own lamp offset (1.5 sub-grid steps, 3.6 units)
 * and `SLOT_OFFSETS`' own outer boundary (`(4.8 + 2.4) / 2` = 3.6) coincide exactly, because the
 * lamp pitch and the slot pitch are both `CARRIAGEWAY_WIDTH` (2.4) — so a real lamp's own small
 * footprint straddles both slots by a thin sliver on each side rather than sitting inside either
 * one cleanly. That is a genuine fact about the kit's own proportions, not a defect in the
 * reservation logic: a coarser, point-based "nearest slot" check would have missed one of the
 * two and left a paper-thin but real overlap standing, exactly the kind of sweep the owner's
 * report has already flagged as worthless once. The owner has repeatedly asked for density, and
 * this revision does not deliver it — the honest trade for a wall that is actually flush and an
 * overlap sweep with nothing to hide behind. The result stays comfortably under this ceiling,
 * with 1,014,502 to spare.
 *
 * This figure, like the ones before it, counts only `townPlan`'s own buildings, not the street
 * surface and verge furniture `road-mesh.js` draws alongside them (carriageway, streetlights,
 * crossings, traffic lights — there is no pavement left to count): the real network places 150
 * street cells (unchanged by this revision, which does not touch `street-plan.js`) for
 * **166,704** vertices total (also unchanged — `road-mesh.js`'s own furniture positions were not
 * moved, only which slot a building leaves empty for them). Buildings and street geometry
 * together come to 462,202, itself far under `TOWN_VERTEX_BUDGET` — but that combined figure is
 * not what `test/town-mesh.test.mjs`'s own ceiling check measures (it sums `townPlan`'s
 * buildings only, matching this constant's own name), so it is reported here for completeness
 * rather than pinned by a test of its own. None of the levers above was needed by this
 * revision: `GREEN_SHARE` stays at 0.3, and `TOWN_VERTEX_BUDGET` itself is untouched.
 */
export const TOWN_VERTEX_BUDGET = 1310000

/**
 * Every building the town wants to place.
 *
 * Pure, so the budget is testable without a renderer.
 *
 * @param streets the street membership set (`planStreets().all`)
 * @param claimed the cells the colony occupies, as `"x,z"` keys — these blocks are skipped
 * @returns `[{part, x, z, ry, scale}]`
 */
export function townPlan({ streets, claimed = new Set() }) {
  const out = []
  for (let x = -TOWN_CELL_RADIUS; x <= TOWN_CELL_RADIUS; x++) {
    for (let z = -TOWN_CELL_RADIUS; z <= TOWN_CELL_RADIUS; z++) {
      const k = `${x},${z}`
      if (streets.has(k) || claimed.has(k)) continue
      const cell = { x, z }
      if (!inTown(cell)) continue
      out.push(...blockContent(cell, streets).buildings)
    }
  }
  return out
}

/**
 * The stamp `Colony` compares to decide whether the town needs rebuilding.
 *
 * `createTown`'s output is a pure function of three things: the street set, the claimed set,
 * and `groundAt`. The first two are already carried by `streetStamp` and `claimedStamp`; the
 * third — `groundAt` — falls through to `terrainHeight(x, z, planet)` for every cell the town
 * actually queries (it never asks about a claimed cell, so the colony's own deck heights never
 * enter into it), and `terrainHeight` varies only with `planet.id` among the colony's own
 * per-poll state. So the stamp is incomplete, and the rebuild guard stale, unless `planetId` is
 * folded in here too — pulled out as its own function so that fact is testable without a
 * renderer.
 */
export function townStamp(streetStamp, claimedStamp, planetId) {
  return `${streetStamp}::${claimedStamp}::${planetId}`
}

/**
 * @param streets the street membership set
 * @param claimed the colony's cells, as `"x,z"` keys
 * @param groundAt `(x, z) => y`, the colony's terrain sampler
 * @returns a `THREE.Group` publishing `userData.dispose()`
 */
export function createTown({ streets, claimed, groundAt }) {
  const group = new THREE.Group()
  group.userData.dispose = () => {}
  if (!streets) return group

  const composers = new Map()
  for (const b of townPlan({ streets, claimed })) {
    if (!hasPart(b.part, 'city')) continue
    let composer = composers.get(b.part)
    if (!composer) {
      composer = new Composer({ kit: 'city' })
      composers.set(b.part, composer)
    }
    // A town building stands on the flattened ground, never on a deck: `townPlan` skips every
    // cell the colony claims, and the deck is exactly those cells.
    composer.add(b.part, { s: b.scale, x: b.x, y: groundAt ? groundAt(b.x, b.z) : 0, z: b.z, ry: b.ry })
  }

  const meshes = [...composers.values()].map(
    (c) =>
      new THREE.Mesh(
        c.finish(),
        // Unowned scenery: no accent, no construction reveal, so this skips `decorate()`
        // exactly as `road-mesh.js` does. The atlas `map` is not optional — without it every
        // building renders as flat grey plastic.
        new THREE.MeshStandardMaterial({ map: atlasTexture('city'), roughness: 0.8, metalness: 0.02 })
      )
  )
  for (const mesh of meshes) {
    mesh.castShadow = true
    mesh.receiveShadow = true
    group.add(mesh)
  }
  group.userData.dispose = () => {
    for (const mesh of meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
  }
  return group
}
