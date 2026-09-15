import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { CELL_SIZE } from './grid.js'
import { DECK_TOP } from './plots.js'

/**
 * The street surface: a carriageway down the middle of each street cell, and the kit's own
 * furniture along the verge.
 *
 * A street cell is not a paved cell. A cell is 12 units across — far wider than the 2.5-wide
 * carriageway needs — so paving one edge to edge would read as a plaza. The carriageway runs
 * down the middle and the rest is verge.
 *
 * Every bend on this square lattice is a right angle (see `grid.js`), so a bend gets a real
 * `road_corner` tile, turned to face the way the road actually bends, instead of the
 * four-armed `road_junction` patch a 120 degree hex bend used to need. `road_junction` is
 * kept for cells where road runs genuinely meet three or four ways — not produced by this
 * module yet, but the town a later stage builds will need it.
 */

/** Every road piece in the kit is a 2 x 2 square tile, 0.1 thick, centred on the origin. */
export const ROAD_TILE_SIZE = 2

/** How wide the driving surface is. The spec's number; a car is 0.61 wide. */
export const CARRIAGEWAY_WIDTH = 2.5

/** What a kit road tile has to be scaled by to become one carriageway width. */
export const roadTileScale = () => CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE

/**
 * How far above the sampled ground a carriageway patch's tile sits. A tile's `y` places its
 * *base*, not its centre (`road_straight`'s own bounding box runs from local y=0 to y=0.1,
 * not -0.05 to 0.05), so laying the base at `groundY` exactly would make it touch the
 * terrain's height field with zero gap at the sampled point.
 *
 * Measured in the running colony rather than assumed: at lift 0, rendering the ring's
 * steepest local slope from close range (distance 2.5, polar 78 degrees — a grazing angle,
 * near this rig's 84 degree limit) and diffing two frames a 0.00001-unit camera nudge apart —
 * enough to move silhouette edges a fraction of a pixel but far below anything a person would
 * notice — found only a few dozen changed pixels out of ~650k, almost all contiguous with an
 * ordinary silhouette edge rather than the isolated, scattered pixels a genuine depth-fight
 * produces.
 * Lift 0.01 measured the same way was not measurably cleaner. In other words: this kit's
 * road tile is a solid box, about 0.125 units thick once scaled to carriageway width, and its
 * *rendered* top face is never actually coincident with the terrain — only its back-face-
 * culled underside is, and culling means that face is never rasterised against the terrain
 * from above. No dither was actually caught in this colony at lift 0.
 *
 * The lift is kept anyway, at this small a value, as a margin rather than as the fix for a
 * confirmed artifact: it costs nothing visible, it keeps the tile's touch point from ever
 * being exactly degenerate, and it gives some slack against a steeper local slope than this
 * colony's terrain happened to produce (the worst measured here, across all 90 ring patches,
 * was a 0.039 rise within one tile's footprint).
 */
export const ROAD_SURFACE_LIFT = 0.01

/**
 * Where a carriageway patch's tile sits, vertically — pure so the decision is testable
 * without a renderer. It must *track* `groundY` for any input, never clamp it: a clamp here
 * is exactly the bug this replaced (`Math.max(DECK_TOP, groundY)` clamped every ring patch
 * to `DECK_TOP`, because no street cell is ever decked — see the comment in `createRoads`).
 *
 * @param groundY the terrain height sampled under this patch
 * @param lift how far above that the tile's base sits; defaults to `ROAD_SURFACE_LIFT`
 */
export function carriagewayHeight(groundY, lift = ROAD_SURFACE_LIFT) {
  return groundY + lift
}

/**
 * Where each patch of carriageway goes, and what kind it is.
 *
 * Pure: plain numbers in, plain numbers out, so the geometry decisions are testable without
 * a renderer. `cellSize` is the lattice pitch, passed in rather than imported so a test can
 * read the arithmetic directly against whatever value it hands in.
 *
 * Two things a caller must say explicitly, because this function cannot guess them from
 * `cells` alone:
 *
 * - `closed` — whether `cells` is a loop (the last cell connects back to the first) or an
 *   open-ended run (a spur, which starts at a plot and ends on the cell it joins, or one of
 *   the open arcs `streets.ringRuns` splits the ring into wherever a claimed cell breaks it
 *   — see `streets.js`'s `ringRuns`). A closed run gets an extra hop laid from its last cell
 *   back to its first, and its first and last cells are treated as interior — each has both
 *   an incoming and an outgoing direction — so either can be a bend too.
 * - `placed` — the dedup set. It defaults to a fresh `Set` per call, so a single run is
 *   still deduplicated against itself exactly as before. Callers that lay more than one run
 *   onto the same surface (the ring, then every spur) must pass one shared `Set` across all
 *   of them, or a spur's chain — which ends *on* the ring cell it joins — lays a second,
 *   exactly coincident patch on top of the ring's.
 *
 * @param cells the street cells (`{x, z}`), in the order the road runs through them
 * @param cellSize world units per cell — the lattice pitch a hop spans
 * @param options.closed true for a closed loop (the ring); false (default) for an open run
 * @param options.placed the cross-call dedup set; defaults to a fresh one for this call only
 * @returns one entry per patch: `{ x, z, kind, heading }` — `kind` is `'straight'`,
 *   `'corner'` or `'junction'`, `heading` is the direction a tile is turned to face, in
 *   radians. For a straight patch that is the direction of travel over the hop it belongs
 *   to (`Math.atan2(dz, dx)`); for a corner it is the incoming direction — the same heading
 *   the straight patch just before it carries, so the two tiles' facing edges line up.
 */
export function carriagewayPoints(cells, cellSize, { closed = false, placed = new Set() } = {}) {
  const world = cells.map((c) => ({ x: c.x * cellSize, z: c.z * cellSize }))
  // How many carriageway-width tiles span one cell-to-cell hop. On this square lattice every
  // hop is exactly `cellSize` long and axis-aligned, so — unlike the old hex hop — no
  // trigonometric factor is needed to turn it into a tile count.
  const tilesPerHop = Math.max(1, Math.ceil(cellSize / CARRIAGEWAY_WIDTH))

  const out = []
  const push = (x, z, kind, heading) => {
    const k = `${x.toFixed(4)},${z.toFixed(4)}`
    if (placed.has(k)) return
    placed.add(k)
    out.push({ x, z, kind, heading })
  }

  if (world.length === 1) {
    // A single-cell run has no hop to take a direction from, and this patch is always laid
    // as a junction tile — four-armed and rotationally symmetric every 90 degrees — so any
    // heading looks the same as any other here. 0 is as good as a computed one.
    push(world[0].x, world[0].z, 'junction', 0)
    return out
  }

  // Hops between consecutive cells, plus — for a closed run — the extra hop that bridges
  // the last cell back to the first, so a ring is actually a ring and not a horseshoe.
  const hops = []
  for (let i = 1; i < world.length; i++) hops.push([i - 1, i])
  if (closed) hops.push([world.length - 1, 0])

  let lastHeading = 0
  for (const [ai, bi] of hops) {
    const a = world[ai]
    const b = world[bi]
    const heading = Math.atan2(b.z - a.z, b.x - a.x)
    lastHeading = heading
    for (let t = 0; t < tilesPerHop; t++) {
      const f = t / tilesPerHop
      push(a.x + (b.x - a.x) * f, a.z + (b.z - a.z) * f, 'straight', heading)
    }
  }
  // The last cell centre, which no hop's loop reaches because each stops short of its end.
  // A closed run doesn't need this: its closing hop's own t=0 tile already lands exactly
  // there, as the start of the hop back to the first cell.
  //
  // This patch sits at the join of two hops (the one that ends here, and — for an interior
  // cell reached this way in an open run — none that starts here, since the run stops). It
  // only has an incoming hop, so it takes that hop's heading; there is no outgoing one to
  // choose instead.
  if (!closed) {
    const last = world[world.length - 1]
    push(last.x, last.z, 'straight', lastHeading)
  }

  // Bends. A cell whose incoming and outgoing directions differ is a bend. On this lattice
  // every hop runs along one of the four square-lattice axes, so the incoming and outgoing
  // directions at a bend are always exactly perpendicular — never the 120 degree turn the
  // hex lattice used to produce — and a real `road_corner` tile fits every one of them. The
  // corner replaces whatever straight patch was laid on its centre, the same way a junction
  // patch used to. An open run's endpoints have no "other side" (a spur starts at a plot and
  // ends on the cell it joins), so only its interior cells are checked. A closed run has no
  // endpoints — every cell, including what would otherwise be index 0 and the last, sits
  // between two neighbours — so every index is checked, wrapping around the loop.
  const n = cells.length
  const bendIndices = closed
    ? Array.from({ length: n }, (_, i) => i)
    : Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1)
  for (const i of bendIndices) {
    const prev = cells[(i - 1 + n) % n]
    const here = cells[i]
    const next = cells[(i + 1) % n]
    const inDir = { x: here.x - prev.x, z: here.z - prev.z }
    const outDir = { x: next.x - here.x, z: next.z - here.z }
    if (inDir.x === outDir.x && inDir.z === outDir.z) continue
    const w = world[i]
    const k = `${w.x.toFixed(4)},${w.z.toFixed(4)}`
    const existing = out.find((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}` === k)
    // The incoming direction, not the outgoing one: `road_corner`'s modelled entrance sits
    // on the same local axis `road_straight`'s lane markings run along, so turning it to the
    // incoming heading — exactly what the straight patch just behind it already carries —
    // keeps that shared edge lined up. The mesh's own bend then carries the lane on to
    // whichever of its two perpendicular ports the model bakes in; which of the four ways a
    // corner can face is what `heading` picks, not which way within the piece it turns.
    const heading = Math.atan2(inDir.z, inDir.x)
    if (existing) {
      existing.kind = 'corner'
      existing.heading = heading
    } else push(w.x, w.z, 'corner', heading)
  }

  return out
}

// ── the scene half ───────────────────────────────────────────────────────────────────

/** The pieces this module draws, all from the city atlas. */
const STRAIGHT_PART = 'road_straight'
const CORNER_PART = 'road_corner'
const JUNCTION_PART = 'road_junction'
const LAMP_PART = 'streetlight'

/**
 * Build the street surface for one street plan.
 *
 * One merged geometry for the carriageway and one for the lamps, so the whole street
 * network is two draw calls however large the colony grows. Merging is what the city
 * atlas is for: every piece in the kit UVs into a single 1024px gradient atlas, which is
 * the only reason a whole street can collapse into one mesh.
 *
 * Verge planting is **not** here. Trees, bushes and grasses live in `forest.glb`, a
 * different atlas, and a merged geometry carries one material — so they cannot join these
 * meshes. The verge reuses the existing scatter system instead.
 *
 * @param streets the `planStreets` result
 * @param groundAt `(x, z) => y`, the colony's own terrain sampler
 * @returns a `THREE.Group` publishing `userData.dispose()`
 */
export function createRoads({ streets, groundAt }) {
  const group = new THREE.Group()
  group.userData.dispose = () => {}
  if (
    !streets ||
    !hasPart(STRAIGHT_PART, 'city') ||
    !hasPart(CORNER_PART, 'city') ||
    !hasPart(JUNCTION_PART, 'city')
  )
    return group

  const spurRuns = [...streets.spurs.values()].filter((run) => run && run.length)
  const ringRuns = (streets.ringRuns || []).filter((run) => run.cells && run.cells.length)
  if (!ringRuns.length && !spurRuns.length) return group

  const scale = roadTileScale()
  const straights = new Composer({ kit: 'city' })
  const corners = new Composer({ kit: 'city' })
  const junctions = new Composer({ kit: 'city' })
  let straightCount = 0
  let cornerCount = 0
  let junctionCount = 0

  // One dedup set shared across every ring run and every spur: a spur's chain ends *on* the
  // ring cell it joins, so without a shared set that pass and the ring's own would each lay
  // an identical, exactly coincident patch there.
  const placed = new Set()
  // Computed once and reused below for the streetlights, so that second pass doesn't ask
  // `carriagewayPoints` to lay patches onto an already-fully-`placed` set and get nothing back.
  //
  // One call per run, each with its own `closed` flag — never one call across the
  // concatenation of every run's cells, which would treat two unrelated arcs as one
  // continuous walk and reintroduce exactly the gapped-ring bug `ringRuns` exists to avoid.
  const ringPatches = ringRuns.flatMap((run) =>
    carriagewayPoints(run.cells, CELL_SIZE, { closed: run.closed, placed })
  )
  const patchRuns = [ringPatches, ...spurRuns.map((run) => carriagewayPoints(run, CELL_SIZE, { placed }))]

  const PART_BY_KIND = { straight: STRAIGHT_PART, corner: CORNER_PART, junction: JUNCTION_PART }

  for (const patches of patchRuns) {
    for (const patch of patches) {
      const composer = patch.kind === 'corner' ? corners : patch.kind === 'junction' ? junctions : straights
      const name = PART_BY_KIND[patch.kind]
      // The carriageway always sits on bare terrain, never on a deck: `planStreets` only
      // takes cells no plot claims (`streets.js`), and the deck is exactly the claimed
      // cells, so no street cell is ever part of it. That's why this follows the ground
      // directly (`carriagewayHeight`, a small lift above `groundAt`) with no
      // `Math.max(DECK_TOP, ...)` clamp — unlike the streetlights below, where the clamp is
      // correct: a lamp on the verge must not sink under a deck it stands beside. If a
      // future change ever put a street cell onto a deck, this patch would sink into it —
      // nothing here would catch that.
      //
      // The tile itself stays flat — it is not tilted to the local slope. That would need a
      // surface normal per patch, and it would open seams between neighbouring tiles
      // wherever two of them picked a slightly different tilt. So this follows the terrain's
      // height, not its slope.
      const y = groundAt ? carriagewayHeight(groundAt(patch.x, patch.z)) : DECK_TOP
      // `road_straight`'s dashed lane markings are modelled along the tile's own local Z
      // axis (confirmed by dumping the part's vertices out of city.glb: the marking strips
      // are narrow bands of X spaced across the tile and subdivided many times along Z, the
      // shape of a dashed line running lengthwise) — not along X. Composer's `ry` rotates
      // the geometry about Y before it is placed, and turning the local +Z axis to point
      // along `heading` takes ry = PI/2 - heading (the local Z axis (0,0,1) rotated by that
      // angle lands on (cos(heading), sin(heading)), i.e. the world direction atan2 was
      // built from). A junction tile's heading barely matters — four-armed and rotationally
      // symmetric every 90 degrees, see `carriagewayPoints` — but a corner's heading is
      // exactly what turns it to face its bend, and every patch, whatever its kind, still
      // gets rotated to the heading it carries.
      composer.add(name, { s: scale, x: patch.x, y, z: patch.z, ry: Math.PI / 2 - patch.heading })
      if (patch.kind === 'corner') cornerCount++
      else if (patch.kind === 'junction') junctionCount++
      else straightCount++
    }
  }

  const meshes = []
  if (straightCount) meshes.push(new THREE.Mesh(straights.finish(), roadMaterial()))
  if (cornerCount) meshes.push(new THREE.Mesh(corners.finish(), roadMaterial()))
  if (junctionCount) meshes.push(new THREE.Mesh(junctions.finish(), roadMaterial()))

  if (hasPart(LAMP_PART, 'city') && ringPatches.length) {
    const lamps = new Composer({ kit: 'city' })
    let lampCount = 0
    // One lamp every fourth patch along the ring, on the verge rather than the carriageway:
    // half a carriageway plus a little, out from the centre line. Reuses `ringPatches` from
    // above rather than calling `carriagewayPoints` on `streets.ringRuns` again — with a
    // shared `placed` set, a second pass would find every one of the ring's coordinates
    // already taken and return nothing.
    const offset = CARRIAGEWAY_WIDTH * 0.5 + 0.6
    for (let i = 0; i < ringPatches.length; i += 4) {
      const p = ringPatches[i]
      const y = groundAt ? Math.max(DECK_TOP, groundAt(p.x + offset, p.z)) : DECK_TOP
      lamps.add(LAMP_PART, { s: 1.6, x: p.x + offset, y, z: p.z })
      lampCount++
    }
    if (lampCount) meshes.push(new THREE.Mesh(lamps.finish(), roadMaterial()))
  }

  for (const mesh of meshes) {
    mesh.receiveShadow = true
    mesh.castShadow = false
    group.add(mesh)
  }

  group.userData.dispose = () => {
    for (const mesh of meshes) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.customDepthMaterial?.dispose()
    }
  }

  return group
}

/**
 * The city kit's flat material, unowned by any repo: streets carry no accent and no
 * construction-progress reveal, so this skips `decorate()` (the reveal/accent shader
 * `houses.js` and `deliveries.js` wrap every *owned* city-kit mesh in) entirely — the same
 * plain, atlas-mapped `MeshStandardMaterial` `plots.js` gives its own unowned kit clutter.
 * Without the atlas `map` here every tile would render as flat grey plastic instead of the
 * kit's painted asphalt and markings; that omission was caught by reading `houses.js` as
 * this module's Step 5 requires, where every city-kit material carries `map: atlasTexture(kit)`.
 */
function roadMaterial() {
  return new THREE.MeshStandardMaterial({ map: atlasTexture('city'), roughness: 0.86, metalness: 0.02 })
}
