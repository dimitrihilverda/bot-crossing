import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'
import { GARMENT_SETS } from '../src/agents/garment-sets.js'

/**
 * `tools/build-crew.mjs` cannot import `GARMENT_SETS`: `src/agents/garment-sets.js` will
 * later need `hashString` from `src/world/plots.js`, which pulls in `src/world/kit.js`,
 * which reads `import.meta.env` and throws outside a bundler — and the build tool runs under
 * plain Node, never a bundler. So the tool keeps its own literal copy of the twelve mesh
 * names, and this cross-checks that copy against the table by reading both as source text —
 * the same approach `test/crew-clips.test.mjs` already takes for the animation clip lists.
 */
test("the build tool's garment mesh list agrees with garment-sets.js", () => {
  const build = readFileSync('tools/build-crew.mjs', 'utf8')
  for (const set of GARMENT_SETS) {
    for (const name of set.meshes) {
      assert.ok(build.includes(`'${name}'`), `${name} is named in garment-sets.js but not in build-crew.mjs`)
    }
  }
})

const doc = await new NodeIO().read('public/assets/crew.glb')
const root = doc.getRoot()
const nodeNames = root.listNodes().map((n) => n.getName())
const meshNodes = root.listNodes().filter((n) => n.getMesh())

test('every garment mesh is present', () => {
  for (const set of GARMENT_SETS) {
    for (const name of set.meshes) {
      assert.ok(nodeNames.includes(name), `crew.glb has no ${name}`)
    }
  }
})

test('no mannequin mesh survives', () => {
  // The mannequin contributes the rig and the clips now, and nothing that is drawn.
  for (const node of meshNodes) {
    assert.ok(
      !node.getName().startsWith('Mannequin_'),
      `${node.getName()} is still a drawn mesh`
    )
  }
})

test('nothing drawn is a cape, a quiver or headgear', () => {
  for (const node of meshNodes) {
    for (const unwanted of ['Cape', 'Quiver', 'Helmet', 'Hat', 'Hooded']) {
      assert.ok(!node.getName().includes(unwanted), `${node.getName()} should not be here`)
    }
  }
})

test('every garment mesh shares the one 21-joint skin', () => {
  // One skin is what lets the runtime keep a single skeleton and a single baked bone
  // texture. Two skins would mean two bone orders and a silently mis-skinned crew.
  const skins = root.listSkins()
  assert.equal(skins.length, 1, `expected one skin, found ${skins.length}`)
  assert.equal(skins[0].listJoints().length, 21)
  for (const node of meshNodes) {
    assert.equal(node.getSkin(), skins[0], `${node.getName()} is on a different skin`)
  }
})

test('the skin has no weapon-slot joints', () => {
  // The Adventurers rig carries `handslot.l` and `handslot.r` for weapons. Our 21 bones are
  // a strict subset of their 23, and no body, limb or head mesh references either slot, so
  // the remap drops them. One surviving here would mean the remap kept a bone the baked
  // bone texture has no row for.
  const joints = root.listSkins()[0].listJoints().map((j) => j.getName())
  for (const slot of ['handslot.l', 'handslot.r']) {
    assert.ok(!joints.includes(slot), `${slot} survived the remap`)
  }
})

test('every garment mesh keeps its UVs and its skinning attributes', () => {
  // The UVs are the whole colour mechanism this stage rests on: skin, hair and eyes are
  // three cells of the character's gradient atlas, addressed by UV.
  for (const node of meshNodes) {
    for (const prim of node.getMesh().listPrimitives()) {
      for (const attr of ['POSITION', 'NORMAL', 'TEXCOORD_0', 'JOINTS_0', 'WEIGHTS_0']) {
        assert.ok(prim.getAttribute(attr), `${node.getName()} has no ${attr}`)
      }
    }
  }
})

test('every joint index refers to a real joint', () => {
  // The remap rewrites JOINTS_0 from the adventurer's 23-joint order to our 21. An index
  // past the end is the failure mode, and it renders as a limb pinned to the world origin
  // rather than as an error.
  const count = root.listSkins()[0].listJoints().length
  for (const node of meshNodes) {
    for (const prim of node.getMesh().listPrimitives()) {
      const j = prim.getAttribute('JOINTS_0').getArray()
      for (let i = 0; i < j.length; i++) {
        assert.ok(j[i] < count, `${node.getName()} references joint ${j[i]} of ${count}`)
      }
    }
  }
})

test('all 17 clips the runtime plays are present', () => {
  // `CLIP` in src/agents/crew.js looks these up by name. A missing one is a crew member
  // frozen in its bind pose for that behaviour.
  const got = new Set(root.listAnimations().map((a) => a.getName()))
  const wanted = [
    'Idle_A', 'Idle_B', 'Interact', 'Hit_A', 'Spawn_Ground', 'PickUp',
    'Walking_A', 'Running_A', 'Jump_Full_Short',
    'Cheering', 'Waving', 'Sit_Chair_Down', 'Sit_Chair_Idle', 'Sit_Chair_StandUp',
    'Hammering', 'Working_A', 'Holding_A',
  ]
  for (const clip of wanted) assert.ok(got.has(clip), `no clip named ${clip}`)
})

test('node names are unique', () => {
  // Three's loader renames a duplicate at parse time and the animation channels then miss
  // silently. `build-crew.mjs` asserts this too; this is the same guard on the artefact.
  const dupes = nodeNames.filter((n, i) => nodeNames.indexOf(n) !== i)
  assert.deepEqual([...new Set(dupes)], [])
})
