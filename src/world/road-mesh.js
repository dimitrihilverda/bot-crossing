import * as THREE from 'three'
import { atlasTexture, hasPart } from './kit.js'
import { Composer } from './buildings.js'
import { DECK_TOP, PLOT_CELL } from './plots.js'

/**
 * The street surface: a carriageway down the middle of each street cell, and the kit's own
 * furniture along the verge.
 *
 * A street cell is not a paved cell. A hex cell is 13.16 across — twenty-one car widths —
 * so paving one would read as a plaza. The carriageway is 2.5 wide and the rest is verge.
 *
 * **The 120 degree problem, stated plainly.** A path along the hex lattice turns in
 * multiples of 60 degrees. Every corner piece in the kit turns 90. There is no combination
 * of the six road pieces that makes a correct 120 degree bend, so at each bend this lays a
 * `road_junction` as a patch of carriageway and lets the two straights run into it. A
 * four-armed tile sits where two arms meet and the extra arms read as short stubs. That is
 * a visible compromise, it is not fixable with the parts in the pack, and no comment in
 * this file claims the markings line up. At the colony's resting camera distance of about
 * 36 units the stubs are a few pixels; that is the whole of the mitigation.
 */

/** Every road piece in the kit is a 2 x 2 square tile, 0.1 thick, centred on the origin. */
export const ROAD_TILE_SIZE = 2

/** How wide the driving surface is. The spec's number; a car is 0.61 wide. */
export const CARRIAGEWAY_WIDTH = 2.5

/** What a kit road tile has to be scaled by to become one carriageway width. */
export const roadTileScale = () => CARRIAGEWAY_WIDTH / ROAD_TILE_SIZE

/** How many tiles are laid along one cell-to-cell hop. */
const TILES_PER_HOP = Math.ceil((PLOT_CELL * Math.sqrt(3)) / CARRIAGEWAY_WIDTH)

/**
 * Where each patch of carriageway goes, and what kind it is.
 *
 * Pure: plain numbers in, plain numbers out, so the geometry decisions are testable without
 * a renderer. `radius` is the hex size, passed in rather than imported so a test can use 1
 * and read the arithmetic directly.
 *
 * Two things a caller must say explicitly, because this function cannot guess them from
 * `cells` alone:
 *
 * - `closed` — whether `cells` is a loop (the last cell connects back to the first, as
 *   `streets.ring` does) or an open-ended run (a spur, which starts at a plot and ends on
 *   the cell it joins). A closed run gets an extra hop laid from its last cell back to its
 *   first, and its first and last cells are treated as interior — each has both an
 *   incoming and an outgoing direction — so either can be a bend too.
 * - `placed` — the dedup set. It defaults to a fresh `Set` per call, so a single run is
 *   still deduplicated against itself exactly as before. Callers that lay more than one run
 *   onto the same surface (the ring, then every spur) must pass one shared `Set` across all
 *   of them, or a spur's chain — which ends *on* the ring cell it joins — lays a second,
 *   exactly coincident patch on top of the ring's.
 *
 * @param cells the street cells, in the order the road runs through them
 * @param radius hex size, centre to corner
 * @param options.closed true for a closed loop (the ring); false (default) for an open run
 * @param options.placed the cross-call dedup set; defaults to a fresh one for this call only
 * @returns one entry per patch: `{ x, z, kind, heading }` — `kind` is `'straight'` or
 *   `'junction'`, `heading` is the direction of travel through that patch in radians, as
 *   `Math.atan2(dz, dx)` over the hop the patch belongs to
 */
export function carriagewayPoints(cells, radius, { closed = false, placed = new Set() } = {}) {
  const world = cells.map((c) => {
    const w = { x: radius * 1.5 * c.q, z: radius * Math.sqrt(3) * (c.r + c.q / 2) }
    return w
  })

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
    for (let t = 0; t < TILES_PER_HOP; t++) {
      const f = t / TILES_PER_HOP
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

  // Bends. A cell whose incoming and outgoing directions differ is a bend, and a bend gets
  // a junction patch on its centre, replacing whatever straight was laid there. An open run's
  // endpoints have no "other side" (a spur starts at a plot and ends on the cell it joins),
  // so only its interior cells are checked. A closed run has no endpoints — every cell,
  // including what would otherwise be index 0 and the last, sits between two neighbours —
  // so every index is checked, wrapping around the loop.
  const n = cells.length
  const bendIndices = closed
    ? Array.from({ length: n }, (_, i) => i)
    : Array.from({ length: Math.max(0, n - 2) }, (_, i) => i + 1)
  for (const i of bendIndices) {
    const prev = cells[(i - 1 + n) % n]
    const here = cells[i]
    const next = cells[(i + 1) % n]
    const inDir = { q: here.q - prev.q, r: here.r - prev.r }
    const outDir = { q: next.q - here.q, r: next.r - here.r }
    if (inDir.q === outDir.q && inDir.r === outDir.r) continue
    const w = world[i]
    const nextWorld = world[(i + 1) % n]
    const k = `${w.x.toFixed(4)},${w.z.toFixed(4)}`
    const existing = out.find((p) => `${p.x.toFixed(4)},${p.z.toFixed(4)}` === k)
    // A junction tile is four-armed and rotationally symmetric every 90 degrees, so which
    // heading it carries barely matters visually — but every patch gets one regardless of
    // kind, so this still assigns the outgoing direction rather than leaving it undefined.
    if (existing) existing.kind = 'junction'
    else push(w.x, w.z, 'junction', Math.atan2(nextWorld.z - w.z, nextWorld.x - w.x))
  }

  return out
}

// ── the scene half ───────────────────────────────────────────────────────────────────

/** The pieces this module draws, all from the city atlas. */
const STRAIGHT_PART = 'road_straight'
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
  if (!streets || !hasPart(STRAIGHT_PART, 'city') || !hasPart(JUNCTION_PART, 'city')) return group

  const spurRuns = [...streets.spurs.values()].filter((run) => run && run.length)
  const hasRing = streets.ring && streets.ring.length
  if (!hasRing && !spurRuns.length) return group

  const scale = roadTileScale()
  const straights = new Composer({ kit: 'city' })
  const junctions = new Composer({ kit: 'city' })
  let straightCount = 0
  let junctionCount = 0

  // One dedup set shared across the ring and every spur: a spur's chain ends *on* the ring
  // cell it joins, so without a shared set the ring's pass and the spur's pass would each
  // lay an identical, exactly coincident patch there.
  const placed = new Set()
  // Computed once and reused below for the streetlights, so that second pass doesn't ask
  // `carriagewayPoints` to lay patches onto an already-fully-`placed` set and get nothing back.
  const ringPatches = hasRing ? carriagewayPoints(streets.ring, PLOT_CELL, { closed: true, placed }) : []
  const runs = [ringPatches, ...spurRuns.map((run) => carriagewayPoints(run, PLOT_CELL, { placed }))]

  for (const patches of runs) {
    for (const patch of patches) {
      const composer = patch.kind === 'junction' ? junctions : straights
      const name = patch.kind === 'junction' ? JUNCTION_PART : STRAIGHT_PART
      // Sample the ground per patch, exactly as the streetlights below already do: a patch
      // against the deck still meets it flush (Math.max keeps it from sinking under
      // DECK_TOP), and a patch out on the surrounding terrain sits on the terrain instead
      // of floating at deck height. The tile itself stays flat — it is not tilted to the
      // local slope. That would need a surface normal per patch, and it would open seams
      // between neighbouring tiles wherever two of them picked a slightly different tilt.
      // So this follows the terrain's height, not its slope.
      const y = groundAt ? Math.max(DECK_TOP, groundAt(patch.x, patch.z)) : DECK_TOP
      // `road_straight`'s dashed lane markings are modelled along the tile's own local Z
      // axis (confirmed by dumping the part's vertices out of city.glb: the marking strips
      // are narrow bands of X spaced across the tile and subdivided many times along Z, the
      // shape of a dashed line running lengthwise) — not along X. Composer's `ry` rotates
      // the geometry about Y before it is placed, and turning the local +Z axis to point
      // along `heading` takes ry = PI/2 - heading (the local Z axis (0,0,1) rotated by that
      // angle lands on (cos(heading), sin(heading)), i.e. the world direction atan2 was
      // built from). A junction tile's heading barely matters — see `carriagewayPoints` —
      // but every patch, straight or junction, still gets rotated to it.
      composer.add(name, { s: scale, x: patch.x, y, z: patch.z, ry: Math.PI / 2 - patch.heading })
      if (patch.kind === 'junction') junctionCount++
      else straightCount++
    }
  }

  const meshes = []
  if (straightCount) meshes.push(new THREE.Mesh(straights.finish(), roadMaterial()))
  if (junctionCount) meshes.push(new THREE.Mesh(junctions.finish(), roadMaterial()))

  if (hasPart(LAMP_PART, 'city') && ringPatches.length) {
    const lamps = new Composer({ kit: 'city' })
    let lampCount = 0
    // One lamp every fourth patch along the ring, on the verge rather than the carriageway:
    // half a carriageway plus a little, out from the centre line. Reuses `ringPatches` from
    // above rather than calling `carriagewayPoints(streets.ring, ...)` again — with a shared
    // `placed` set, a second call would find every one of the ring's coordinates already
    // taken and return nothing.
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
