import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import * as THREE from 'three'
import { CAR_PARTS, WHEEL_RADIUS, Deliveries, wheelSpin } from '../src/world/deliveries.js'

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

test('dispose frees every accent pair, not just a couple of named ones', () => {
  const removed = []
  const d = makeDeliveries()
  d.scene = { add() {}, remove: (m) => removed.push(m) }
  d.update([vehicle(0xff0000, 0), vehicle(0x00ff00, 1), vehicle(0x0000ff, 2)])
  assert.equal(d._pairs.size, 3)

  d.dispose()
  assert.equal(d._pairs.size, 0)
  assert.equal(removed.length, 6, '3 accents * (bodies + wheels)')
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
