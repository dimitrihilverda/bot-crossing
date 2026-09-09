import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import * as THREE from 'three'
import { CAR_PARTS, LOAD_PART, WHEEL_RADIUS, Deliveries, wheelSpin } from '../src/world/deliveries.js'
import {
  kerbBack,
  driveStep,
  pathLength,
  pointAt,
  KERB_CLEARANCE,
  KERB_MIN_CLEARANCE,
} from '../src/world/drive-path.js'
import { stepProgress } from '../src/game/growth.js'
import { ATLAS, CELL_FURNITURE } from '../src/world/kit.js'

test('every car part the module names exists in the city kit', async () => {
  const doc = await new NodeIO().read('public/assets/city.glb')
  const names = new Set(
    doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName())
      .filter(Boolean)
  )
  for (const name of Object.values(CAR_PARTS)) {
    assert.ok(names.has(name), `city.glb has no node named "${name}"`)
  }
})

test('the roof load names a part the furniture kit actually has', async () => {
  // `part()` throws on an unknown name, and it throws inside a `loadKit().then()` where
  // nothing is watching — so the load would simply never appear, with no error on screen.
  const doc = await new NodeIO().read('public/assets/furniture.glb')
  const names = new Set(
    doc
      .getRoot()
      .listNodes()
      .map((n) => n.getName())
      .filter(Boolean)
  )
  assert.ok(names.has(LOAD_PART), `furniture.glb has no node named "${LOAD_PART}"`)
})

test('the roof load carries no accent, which is why one shared mesh is enough', async () => {
  // `Deliveries` gives the cars one mesh pair per accent because `uAccent` is a per-material
  // uniform, but gives every car in the colony the *same* load mesh. Part of the case for
  // that is this: the chosen part's vertices never land in the furniture atlas's accent
  // swatch, so `uAccent` has nothing to repaint on it and twelve grouped meshes would render
  // identically to one. Swap `LOAD_PART` for a part that does UV into cell
  // `CELL_FURNITURE.ACCENT` — `armchair_pillows` and `rug_rectangle_A` both do, heavily — and
  // that half of the argument is gone, so this test fails and the decision gets re-made.
  //
  // The cell index is computed the way the shader computes it (`atlasCell()` in
  // buildings.js): the row comes from `floor(v * rows)`, with no flip.
  const doc = await new NodeIO().read('public/assets/furniture.glb')
  const node = doc
    .getRoot()
    .listNodes()
    .find((n) => n.getName() === LOAD_PART)
  assert.ok(node?.getMesh(), `no mesh on "${LOAD_PART}"`)

  const cells = new Set()
  for (const prim of node.getMesh().listPrimitives()) {
    const uv = prim.getAttribute('TEXCOORD_0')
    assert.ok(uv, `"${LOAD_PART}" has no UVs, so it cannot sample the atlas at all`)
    for (let i = 0; i < uv.getCount(); i++) {
      const [u, v] = uv.getElement(i, [])
      const cx = Math.min(ATLAS.cols - 1, Math.max(0, Math.floor(u * ATLAS.cols)))
      const cy = Math.min(ATLAS.rows - 1, Math.max(0, Math.floor(v * ATLAS.rows)))
      cells.add(cy * ATLAS.cols + cx)
    }
  }

  assert.ok(cells.size > 0, 'no atlas cells found')
  assert.ok(
    !cells.has(CELL_FURNITURE.ACCENT),
    `"${LOAD_PART}" UVs into the accent cell ${CELL_FURNITURE.ACCENT} ` +
      `(cells: ${[...cells].sort((a, b) => a - b).join(', ')}), so the load would need grouping`
  )
})

test('the car names a body and exactly four wheels', () => {
  assert.ok(CAR_PARTS.body)
  const wheels = Object.keys(CAR_PARTS).filter((k) => k !== 'body')
  assert.equal(wheels.length, 4, `expected 4 wheels, got ${wheels.join(', ')}`)
})

test('a wheel turns once per circumference rolled', () => {
  // Rolling exactly one circumference is one full turn.
  const oneTurn = wheelSpin(2 * Math.PI * WHEEL_RADIUS, WHEEL_RADIUS)
  assert.ok(Math.abs(oneTurn - 2 * Math.PI) < 1e-9, `got ${oneTurn}`)
})

test('a stationary wheel does not turn, and a zero radius does not divide by zero', () => {
  assert.equal(wheelSpin(0, WHEEL_RADIUS), 0)
  assert.equal(wheelSpin(5, 0), 0)
})

test('the badge never moves to the car', () => {
  // The indicators module is the only thing allowed to draw badges, and it is driven from
  // the crew roster. A reference to it from the vehicle module would be the first step
  // toward a badge over a moving target, which the spec forbids.
  const src = readFileSync('src/world/deliveries.js', 'utf8')
  assert.doesNotMatch(src, /indicators|BADGE|badgeFor/i, 'deliveries.js reaches into badges')
})

// ── the scene half: which mesh a vehicle's colour comes from ──────────────────────────────
//
// `Deliveries` groups cars into one InstancedMesh pair per distinct accent colour (see the
// class doc in deliveries.js for why: three.js's own per-instance `instanceColor` cannot
// stand in for `decorate()`'s single-uniform `uAccent`, and an earlier version of this
// module that tried it had the effect backwards). That grouping — which mesh a vehicle's
// colour lands in — is plain data-structure logic and is fully assertable on the CPU: no
// WebGL context is needed to build an InstancedMesh, only to render one.
//
// `_build()` normally runs once `loadKit()` resolves, fetching the real city kit through a
// bundler-provided `import.meta.env.BASE_URL` (see the constructor's comment on why that's
// guarded). Neither is available under a plain `node --test` run, and neither is needed
// here: the bug under test is about which mesh a colour lands in, not the shape of the
// geometry, so the kit-built geometry is stood in for with the simplest possible
// `BufferGeometry` after constructing the real class with a stub scene.
function makeDeliveries(capacity = 8) {
  const scene = { add() {}, remove() {} }
  const d = new Deliveries(scene, capacity)

  const bodyGeo = new THREE.BoxGeometry(1, 1, 1)
  bodyGeo.computeBoundingBox()
  const wheelGeo = new THREE.BoxGeometry(0.2, 0.2, 0.2)
  wheelGeo.computeBoundingBox()

  d._bodyGeo = bodyGeo
  d._wheelGeo = wheelGeo
  d._wheelOffsets = [
    new THREE.Vector3(0.1, 0, 0.1),
    new THREE.Vector3(-0.1, 0, 0.1),
    new THREE.Vector3(0.1, 0, -0.1),
    new THREE.Vector3(-0.1, 0, -0.1),
  ]
  d._built = true
  return d
}

const vehicle = (accent, x = 0) => ({ x, y: 0, z: 0, heading: 0, distance: 0, accent })

test('two vehicles with different accents land in different mesh pairs', () => {
  const d = makeDeliveries()
  d.update([vehicle(0xff0000, 0), vehicle(0x00ff00, 1)])

  assert.equal(d._pairs.size, 2)
  const red = d._pairs.get(0xff0000)
  const green = d._pairs.get(0x00ff00)
  assert.ok(red && green, 'both accents should have their own pair')
  assert.notEqual(red.bodies, green.bodies, 'different accents must not share a body mesh')
  assert.notEqual(red.wheels, green.wheels, 'different accents must not share a wheel mesh')
  assert.equal(red.bodies.count, 1)
  assert.equal(green.bodies.count, 1)
  assert.equal(red.wheels.count, 4, 'one car is four wheels')
})

test('two vehicles with the same accent share one mesh pair', () => {
  const d = makeDeliveries()
  d.update([vehicle(0xff0000, 0), vehicle(0xff0000, 1)])

  assert.equal(d._pairs.size, 1)
  const pair = d._pairs.get(0xff0000)
  assert.equal(pair.bodies.count, 2)
  assert.equal(pair.wheels.count, 8)
})

test('a pair with no vehicles this frame is emptied, not left showing last frame\'s cars', () => {
  const d = makeDeliveries()
  d.update([vehicle(0xff0000)])
  const red = d._pairs.get(0xff0000)
  assert.equal(red.bodies.count, 1)

  // The red car's thread goes quiet; a different accent is the only one on the road now.
  // A stale `count` on the red pair would leave that car parked here forever.
  d.update([vehicle(0x00ff00)])
  assert.equal(red.bodies.count, 0, 'a stale count would leave a ghost car parked here')
  assert.equal(red.wheels.count, 0)
})

test('a vehicle with no accent falls back to one shared default pair', () => {
  const d = makeDeliveries()
  d.update([vehicle(null)])
  d.update([vehicle(undefined)])
  assert.equal(d._pairs.size, 1, 'both frames should reuse the same default-accent pair')
})

test('every car gets a load, and they all come out of the one mesh', () => {
  const d = makeDeliveries()
  const loadGeo = new THREE.BoxGeometry(0.4, 0.3, 0.4)
  loadGeo.computeBoundingBox()
  d._loadGeo = loadGeo
  d._load = d._makeLoadMesh()

  // Three different accents, so three separate body meshes — and still one load mesh with
  // three instances in it.
  d.update([vehicle(0xff0000, 0), vehicle(0x00ff00, 1), vehicle(0x0000ff, 2)])
  assert.equal(d._pairs.size, 3)
  assert.equal(d._load.count, 3, 'one load per car, all in the same mesh')

  // And it empties with the fleet rather than leaving loads hovering over empty road.
  d.update([])
  assert.equal(d._load.count, 0)
})

test('dispose frees every accent pair, not just a couple of named ones', () => {
  const removed = []
  const d = makeDeliveries()
  d.scene = { add() {}, remove: (m) => removed.push(m) }

  // The load has to exist here the same way `makeDeliveries()` stands in the kit-dependent
  // body and wheel geometry — otherwise `_load` stays null (as the constructor leaves it) and
  // `_meshes()` simply skips it, so this test would pass whether or not `dispose()` actually
  // frees the load. Set up exactly as 'every car gets a load' does.
  const loadGeo = new THREE.BoxGeometry(0.4, 0.3, 0.4)
  loadGeo.computeBoundingBox()
  d._loadGeo = loadGeo
  d._load = d._makeLoadMesh()

  d.update([vehicle(0xff0000, 0), vehicle(0x00ff00, 1), vehicle(0x0000ff, 2)])
  assert.equal(d._pairs.size, 3)

  d.dispose()
  assert.equal(d._pairs.size, 0)
  assert.equal(removed.length, 7, '3 accents * (bodies + wheels), plus the one shared load')
})

test('onSettingsChanged walks the same generator dispose does, load included', () => {
  // `onSettingsChanged` and `dispose()` both walk `_meshes()` so that a mesh added later
  // (or the load, added earlier) cannot be missed by one and not the other. Prove it by
  // flipping every mesh's shadow flags off by hand first, then checking the sweep put them
  // all back — including the load, which is the one `dispose()`'s own test used to miss.
  const d = makeDeliveries()
  const loadGeo = new THREE.BoxGeometry(0.4, 0.3, 0.4)
  loadGeo.computeBoundingBox()
  d._loadGeo = loadGeo
  d._load = d._makeLoadMesh()

  d.update([vehicle(0xff0000, 0), vehicle(0x00ff00, 1)])
  assert.equal(d._pairs.size, 2)

  const meshes = [...d._meshes()]
  assert.equal(meshes.length, 5, '2 accents * (bodies + wheels), plus the one shared load')
  for (const mesh of meshes) {
    mesh.castShadow = false
    mesh.receiveShadow = false
  }

  d.onSettingsChanged(new Set(['shadows']))

  for (const mesh of meshes) {
    assert.equal(mesh.castShadow, true)
    assert.equal(mesh.receiveShadow, true)
  }
})

test('onSettingsChanged is a no-op when "shadows" is not among the changed settings', () => {
  const d = makeDeliveries()
  const loadGeo = new THREE.BoxGeometry(0.4, 0.3, 0.4)
  loadGeo.computeBoundingBox()
  d._loadGeo = loadGeo
  d._load = d._makeLoadMesh()

  d.update([vehicle(0xff0000, 0)])
  for (const mesh of d._meshes()) {
    mesh.castShadow = false
    mesh.receiveShadow = false
  }

  d.onSettingsChanged(new Set(['quality']))

  for (const mesh of d._meshes()) {
    assert.equal(mesh.castShadow, false)
    assert.equal(mesh.receiveShadow, false)
  }
})

test('the colony drives deliveries and no longer builds scaffolding', () => {
  const colony = readFileSync('src/game/colony.js', 'utf8')
  assert.match(colony, /Deliveries/, 'colony.js does not use Deliveries')
  assert.doesNotMatch(colony, /Scaffolds|scaffolds/, 'colony.js still references Scaffolds')

  const buildings = readFileSync('src/world/buildings.js', 'utf8')
  assert.doesNotMatch(buildings, /class Scaffolds/, 'Scaffolds was not removed')
})

test('a car drives at the height of the ground under it', () => {
  // groundAt is the decked-cell-then-terrain lookup; a delivery that ignored it would
  // drive through a plot's deck rather than up onto it.
  const colony = readFileSync('src/game/colony.js', 'utf8')
  assert.match(colony, /groundAt\(/, 'the delivery does not consult groundAt')
})

// ── where the car parks, and how it gets there ─────────────────────────────────────────────
//
// The two tests above are source-text greps and they are worth exactly what they cost: they
// notice if `Deliveries` or `groundAt` is ripped out wholesale, and nothing more. Neither can
// tell a working delivery from a broken one — `/groundAt\(/` is satisfied by the *definition*
// of `groundAt` in colony.js whether or not the delivery ever calls it.
//
// The parts worth actually asserting are the arithmetic ones, and they live in
// `drive-path.js` for the same reason `stepProgress` lives in `game/growth.js`: colony.js
// cannot be imported outside a browser, so anything that has to be tested has to come out of
// it first. These are those two rules — where along the last leg the car stops, and how
// `driven` moves.

/** The footprint measured on a real house at runtime, per the task 3 report. */
const HOUSE_FOOTPRINT = 1.84

test('the kerb sits outside the house, so the parked car can be seen at all', () => {
  // A comfortable last leg: an adjacent cell centre at the shipping CELL of 7.6 is about
  // this far out, and it is the case every car on the current layout is in.
  const back = kerbBack(7.6, HOUSE_FOOTPRINT)
  assert.equal(back, HOUSE_FOOTPRINT + KERB_CLEARANCE)
  assert.ok(back > HOUSE_FOOTPRINT, `parked ${back} from centre, inside a ${HOUSE_FOOTPRINT} footprint`)
})

test('the kerb stays on the last leg rather than backing into the previous cell', () => {
  // A big footprint, but a leg with room to spare: the pull-back is the footprint plus the
  // clearance and nothing more, so the kerb is strictly between the two route points.
  const leg = 12
  const back = kerbBack(leg, 2.5)
  assert.ok(back < leg, `backed ${back} along a ${leg} leg`)
  assert.equal(back, 3)
})

test('a short last leg still parks the car outside the house, not inside it', () => {
  // The residual the review flagged. The old form was one-sided,
  // `Math.min(leg * 0.9, footprint + 0.5)`, so once `leg * 0.9` fell under the footprint the
  // clamp quietly re-parked the car *inside* the building — the exact invisible car the kerb
  // exists to prevent. It does not fire at CELL 7.6, which is why it needs a test rather
  // than a look at the screen.
  const leg = 1.2
  const oneSided = Math.min(leg * 0.9, HOUSE_FOOTPRINT + KERB_CLEARANCE)
  assert.ok(oneSided < HOUSE_FOOTPRINT, 'the old form should be the broken case here')

  const back = kerbBack(leg, HOUSE_FOOTPRINT)
  assert.ok(back > HOUSE_FOOTPRINT, `parked ${back} from centre, inside a ${HOUSE_FOOTPRINT} footprint`)
  assert.equal(back, HOUSE_FOOTPRINT + KERB_MIN_CLEARANCE)
})

test('the kerb clears the footprint for every leg length there is', () => {
  // Sweep it rather than trusting three chosen numbers: whichever side of the clamp binds,
  // the car must end up outside the building.
  for (const footprint of [0.4, 1.4, HOUSE_FOOTPRINT, 3.2]) {
    for (let leg = 0.05; leg <= 20; leg += 0.05) {
      const back = kerbBack(leg, footprint)
      assert.ok(
        back > footprint,
        `leg ${leg.toFixed(2)}, footprint ${footprint}: parked ${back} from centre`
      )
      assert.ok(back <= footprint + KERB_CLEARANCE, `leg ${leg.toFixed(2)}: backed off too far`)
    }
  }
})

test('a degenerate last leg is left alone rather than divided by', () => {
  // The house sharing its cell centre with the cell it is approached from. There is no
  // direction to back off in, and 0 is the caller's signal to leave the point where it is.
  assert.equal(kerbBack(0, HOUSE_FOOTPRINT), 0)
  assert.equal(kerbBack(1e-9, HOUSE_FOOTPRINT), 0)
  assert.equal(kerbBack(-3, HOUSE_FOOTPRINT), 0)
  assert.equal(kerbBack(NaN, HOUSE_FOOTPRINT), 0)
})

test('the kerb really is on the segment, at the distance from the house it claims', () => {
  // The arithmetic as colony.js applies it: the house pulled back along approach → house.
  const approach = { x: 0, z: 0 }
  const house = { x: 6, z: 8 } // a leg of exactly 10
  const d = Math.hypot(house.x - approach.x, house.z - approach.z)
  const back = kerbBack(d, HOUSE_FOOTPRINT)
  const kerb = {
    x: house.x - ((house.x - approach.x) / d) * back,
    z: house.z - ((house.z - approach.z) / d) * back,
  }

  const fromHouse = Math.hypot(house.x - kerb.x, house.z - kerb.z)
  assert.ok(Math.abs(fromHouse - back) < 1e-9, `kerb is ${fromHouse} from the house, not ${back}`)
  assert.ok(fromHouse > HOUSE_FOOTPRINT, 'kerb is inside the footprint')
  // Strictly between the two points, so the car never reverses into its stop.
  const fromApproach = Math.hypot(kerb.x - approach.x, kerb.z - approach.z)
  assert.ok(fromApproach > 0 && fromApproach < d, `kerb is ${fromApproach} along a ${d} leg`)
})

test('driven never runs past the end of the route, however long the frame was', () => {
  // The task 3 report's mid-drive table claimed `driven` reaching 20.88 on a 13.47-unit
  // route, which the clamp makes impossible. This is that claim, as an assertion.
  const length = 13.47
  let driven = 0
  for (let i = 0; i < 500; i++) {
    driven = driveStep(driven, length, 3.2 * (1 / 60))
    assert.ok(driven <= length, `driven ran to ${driven} on a ${length} route`)
    assert.ok(driven >= 0, `driven went negative: ${driven}`)
  }
  assert.equal(driven, length, 'the last step should land exactly on the end, not near it')
})

test('a single huge frame lands the car at the kerb rather than past it', () => {
  // A tab that was backgrounded and comes back with a whole second of dt.
  assert.equal(driveStep(0, 13.47, 1000), 13.47)
  assert.equal(driveStep(13.47, 0, 1000), 0)
})

test('driven comes home to exactly zero, not to a reversed remainder', () => {
  let driven = 13.47
  for (let i = 0; i < 500; i++) {
    driven = driveStep(driven, 0, 3.2 * (1 / 60))
    assert.ok(driven >= 0, `driven reversed off the start of its route: ${driven}`)
  }
  assert.equal(driven, 0)
})

test('a parked car and a paused frame both leave driven alone', () => {
  assert.equal(driveStep(13.47, 13.47, 0.05), 13.47, 'a parked car should not creep')
  assert.equal(driveStep(4, 13.47, 0), 4, 'a zero-length frame is not progress')
  assert.equal(driveStep(4, 13.47, -1), 4, 'a negative dt must not reverse the car')
})

test('driven and the route agree: a full ramp ends the car at the kerb', () => {
  // The two pure functions and `pointAt` together, which is the whole of an arrival.
  const points = [
    { x: 0, z: 0 },
    { x: 6, z: 0 },
    { x: 12, z: 0 },
  ]
  const back = kerbBack(6, HOUSE_FOOTPRINT)
  points[2] = { x: 12 - back, z: 0 }
  const length = pathLength(points)

  let driven = 0
  while (driven < length) driven = driveStep(driven, length, 3.2 * (1 / 60))
  assert.equal(driven, length)

  const at = pointAt(points, driven)
  assert.ok(Math.abs(at.x - (12 - back)) < 1e-9, `parked at ${at.x}, kerb is at ${12 - back}`)
  // And it is outside the house standing at x = 12.
  assert.ok(12 - at.x > HOUSE_FOOTPRINT, 'the car parked inside the house')
})

// ── the return trip: the house waits for its van, and the entry always leaves ──────────────
//
// The retire path has two failure modes and they pull in opposite directions. Take the entry
// out too early and its van vanishes mid-street, because the entry is the only record of how
// far along its route the van had got. Wait for something that never arrives and the entry
// leaks forever — an invisible house holding its slot, its accent and its route — and *that*
// one is invisible on screen too, so it has to be argued rather than watched.
//
// colony.js cannot be imported outside a browser, so this is the same split the rest of this
// file uses: the arithmetic is exercised for real, and the shape of the decision around it is
// asserted against the source.

test('both values a retiring entry waits on arrive exactly, from any starting point', () => {
  // The wait is `driven <= 0 && progress <= RETIRED_PROGRESS`. `driveStep` and `stepProgress`
  // are what have to deliver those, and both are built to land on their target rather than
  // approach it — a bare damp plus an epsilon gate stalls a strictly positive distance short,
  // which is the whole reason src/game/growth.js exists.
  const RETIRE_HOLD = 0.04 // colony.js, checked by the source test below
  const RETIRED_PROGRESS = 0.02
  const dt = 1 / 60

  for (const length of [0.5, 13.47, 90]) {
    for (const from of [1, 0.6, RETIRE_HOLD]) {
      let driven = length
      let progress = from
      let frames = 0
      // The colony's own loop: the reveal is held at RETIRE_HOLD while the van is out, and
      // released to 0 on the frame it gets home.
      while (driven > 0 || progress > RETIRED_PROGRESS) {
        progress = stepProgress(progress, driven > 0 ? RETIRE_HOLD : 0, dt)
        driven = driveStep(driven, 0, 3.2 * dt)
        assert.ok(driven >= 0, `driven reversed past the depot: ${driven}`)
        assert.ok(++frames < 20000, `never released: driven ${driven}, progress ${progress}`)
      }
      assert.equal(driven, 0, 'the van has to land on the depot, not near it')
      // Held above the release threshold for the whole drive, so the house is still standing
      // at its address while the van is on the road.
      assert.ok(RETIRE_HOLD > RETIRED_PROGRESS, 'the hold has to keep the house on screen')
    }
  }
})

test('the hold keeps a retiring site inside the range the delivery still visits', () => {
  // The subtle half of the leak. `_updateDeliveries` skips a site that has not broken ground,
  // and a skipped site is one whose `driven` stops being stepped — so a reveal wound all the
  // way down before the van got home would strand it. The hold sits above the delivery
  // threshold for exactly that reason, and below the first furniture reveal so the house
  // stands there emptied.
  const src = readFileSync('src/game/colony.js', 'utf8')
  const value = (name) => {
    const m = src.match(new RegExp(`^const ${name} = ([0-9.]+)$`, 'm'))
    assert.ok(m, `${name} not found in colony.js`)
    return Number(m[1])
  }

  const retired = value('RETIRED_PROGRESS')
  const delivery = value('DELIVERY_PROGRESS')
  const hold = value('RETIRE_HOLD')

  assert.ok(hold > delivery, `hold ${hold} must stay above the delivery threshold ${delivery}`)
  assert.ok(hold > retired, `hold ${hold} must keep the house visible (hidden at ${retired})`)
  assert.ok(hold < 0.05, `hold ${hold} must be below the first furniture reveal at 0.05`)
})

test('a retiring entry is not removed until its van is home', () => {
  const src = readFileSync('src/game/colony.js', 'utf8')
  const remove = src.match(/_removeBuilding\(id, entry\) \{[\s\S]*?\n {2}\}/)
  assert.ok(remove, '_removeBuilding not found')
  assert.match(remove[0], /entry\.driven/, 'the retire path does not consult the van at all')
  // The disposal has to sit behind the guard, not before it.
  const guard = remove[0].indexOf('return')
  const disposal = remove[0].indexOf('buildings.delete')
  assert.ok(guard > -1 && disposal > guard, 'the removal must be gated on the van being home')

  // And the guard has to be re-tried: gating the call itself on the progress threshold would
  // deadlock, because the hold keeps progress above that threshold while the van is out.
  assert.match(
    src,
    /if \(entry\.retiring\) this\._removeBuilding\(id, entry\)/,
    'a retiring entry must be re-offered for removal every frame'
  )
})

test('a retiring van is never sent back out, whatever its thread still says', () => {
  // `_isActive` reads `this.threads`, which a building can outlive — a repo folded away as
  // dormant keeps its threads on the books. A retiring entry whose van was still being driven
  // *out* would be waiting on an arrival that never comes.
  const src = readFileSync('src/game/colony.js', 'utf8')
  assert.match(
    src,
    /const wants = !entry\.retiring && this\._isActive\(id\)/,
    'a retiring site must want its van home regardless of its thread'
  )
  // And the ground-broken skip must not fire on a van that is already out, or `driven` freezes.
  assert.match(
    src,
    /if \(entry\.progress <= DELIVERY_PROGRESS && entry\.driven <= 0\) continue/,
    'a van already on the road has to keep being stepped'
  )
})

// ── the badge is never suppressed along with the figure ────────────────────────────────────
//
// The rule the review's Critical 1 turned on. `colony.js` cannot be imported here, so these
// assert the shape of the decision rather than running it: the flag is set in exactly one
// place, and that place consults the badge and not the direction of travel.

test('riding is only ever set behind a badge check', () => {
  const colony = readFileSync('src/game/colony.js', 'utf8')

  // Exactly one assignment that turns the flag on, and it is inside `_markRiding`.
  const setters = colony.match(/\.riding = true/g) ?? []
  assert.equal(setters.length, 1, 'riding should be set in one place only')

  const marker = colony.match(/_markRiding\(id\) \{[\s\S]*?\n {2}\}/)
  assert.ok(marker, '_markRiding not found')
  assert.match(
    marker[0],
    /_statusBadgeFor\(agent\) !== BADGE\.none/,
    '_markRiding must refuse a crew member whose status carries a badge'
  )
  assert.match(marker[0], /return[\s\S]*\.riding = true/, 'the badge check must guard the set')

  // And the badge that check consults must not be the one suppression has already zeroed, or
  // the rule is circular: `_statusBadgeFor` is the version that does not look at `riding`.
  const status = colony.match(/_statusBadgeFor\(agent\) \{[\s\S]*?\n {2}\}/)
  assert.ok(status, '_statusBadgeFor not found')
  assert.doesNotMatch(status[0], /riding/, '_statusBadgeFor must not consult riding')
})

test('a riding crew member gives up its instance index, so it does not return miscoloured', () => {
  // The colour write is gated on `index !== i || colorDirty`. A skipped agent that kept its
  // index would reclaim the same slot on its return with the gate reading "unchanged", and
  // wear whatever suit the agent that shifted into that slot left behind.
  const src = readFileSync('src/agents/astronauts.js', 'utf8')
  const skip = src.match(/if \(agent\.riding\) \{[\s\S]*?\n {6}\}/)
  assert.ok(skip, 'the riding skip in the packing loop is not there')
  assert.match(skip[0], /agent\.index = -1/, 'a riding agent must give up its index')
  assert.match(skip[0], /continue/, 'the riding agent must still be skipped')
})
