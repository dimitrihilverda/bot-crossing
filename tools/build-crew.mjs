/**
 * Packs the crew rig into one glb: KayKit's Mannequin_Medium plus the handful of
 * animations the colony actually plays.
 *
 * The Character Animations pack ships 161 clips across eight files and four megabytes.
 * The colony has eight behaviours. Everything not on the list below is disposed here rather
 * than downloaded and thrown away in the browser.
 *
 * Both packs are CC0 (Kay Lousberg, kaylousberg.com).
 */
import { NodeIO } from '@gltf-transform/core'
import { dedup, mergeDocuments, prune, unpartition } from '@gltf-transform/functions'
import { existsSync, mkdirSync } from 'node:fs'

const SRC = 'assets-src/KayKit_Character_Animations_1.1'
const MANNEQUIN = `${SRC}/Mannequin Character/characters/Mannequin_Medium.glb`
const ANIMS = `${SRC}/Animations/gltf/Rig_Medium`
const OUT = 'public/assets/crew.glb'

const ADVENTURERS = 'assets-src/KayKit_Adventurers_2.0_FREE/Characters/gltf'

/**
 * The two garment sets, kept here as the tool's own literal copy rather than imported from
 * `src/agents/garment-sets.js`: that module will later need `hashString` from
 * `src/world/plots.js`, which pulls in `src/world/kit.js`, which reads `import.meta.env` and
 * throws outside a bundler. This tool runs under plain Node, never a bundler, so it cannot
 * reach that module. `test/crew-glb.test.mjs` cross-checks this list against
 * `src/agents/garment-sets.js` by reading both as source text, the same way
 * `test/crew-clips.test.mjs` cross-checks the clip lists below.
 */
const GARMENT_SETS = [
  {
    id: 'ranger',
    file: 'Ranger.glb',
    meshes: ['Ranger_Body', 'Ranger_ArmLeft', 'Ranger_ArmRight', 'Ranger_LegLeft', 'Ranger_LegRight', 'Ranger_Head'],
  },
  {
    id: 'rogue',
    file: 'Rogue.glb',
    meshes: ['Rogue_Body', 'Rogue_ArmLeft', 'Rogue_ArmRight', 'Rogue_LegLeft', 'Rogue_LegRight', 'Rogue_Head'],
  },
]

/**
 * The clips to keep, by source file. Names are KayKit's own — the runtime looks them up by
 * name, so this list and `CLIPS` in `src/agents/crew.js` have to agree.
 */
const WANTED = {
  'Rig_Medium_General.glb': ['Idle_A', 'Idle_B', 'Interact', 'Hit_A', 'Spawn_Ground', 'PickUp'],
  'Rig_Medium_MovementBasic.glb': ['Walking_A', 'Running_A', 'Jump_Full_Short'],
  // A removal crew dozes off sitting *on* something, so the sit is the chair sit rather than
  // the floor sit the colony used. KayKit authors it perched at seat height with the feet off
  // the ground, which is why it only reads right with the moving box drawn underneath.
  'Rig_Medium_Simulation.glb': ['Cheering', 'Waving', 'Sit_Chair_Down', 'Sit_Chair_Idle', 'Sit_Chair_StandUp'],
  // Holding_A is the symmetric two-handed hold — both hands out front at the same height,
  // which is the one of the three that reads as carrying a piece of furniture.
  'Rig_Medium_Tools.glb': ['Hammering', 'Working_A', 'Holding_A'],
}

// The raw packs are not checked in — the built glb is. Re-running this without them is
// what happens on a fresh clone, and it should be a no-op rather than a broken install.
if (!existsSync(SRC)) {
  if (existsSync(OUT)) {
    console.log(`build-crew: no source pack, keeping the existing ${OUT}`)
    process.exit(0)
  }
  console.error(`build-crew: missing ${SRC} — see README, "Where the art comes from"`)
  process.exit(1)
}

const io = new NodeIO()
const doc = await io.read(MANNEQUIN)

for (const [file, clips] of Object.entries(WANTED)) {
  const src = await io.read(`${ANIMS}/${file}`)
  const keep = new Set(clips)

  // Drop the unwanted clips *before* merging. Merging first would pull every one of their
  // samplers and accessors into the target document, and prune() cannot tell a disposed
  // animation's buffer from a live one once they share a buffer.
  for (const anim of src.getRoot().listAnimations()) {
    if (!keep.has(anim.getName())) anim.dispose()
  }
  const got = src.getRoot().listAnimations().map((a) => a.getName())
  const missing = clips.filter((c) => !got.includes(c))
  if (missing.length) throw new Error(`${file}: no such clip: ${missing.join(', ')}`)

  mergeDocuments(doc, src)
}

const root = doc.getRoot()
const scene = root.getDefaultScene()

/**
 * Retarget every clip onto the mannequin's own bones.
 *
 * Each animation file ships a full copy of the rig for its channels to drive, and merging
 * brings all of them along — so a merged document ends up with five `hips` nodes and clips
 * that animate the four nobody is looking at. Left alone this loads without a single error
 * and renders the entire crew frozen in its bind pose, which is a miserable thing to debug.
 *
 * The bones are matched by name, which is exactly what a runtime retarget would do, except
 * done once here instead of on every load.
 */
const bones = new Map()
const index = (node) => {
  bones.set(node.getName(), node)
  node.listChildren().forEach(index)
}
scene.listChildren().forEach(index)

let retargeted = 0
let orphaned = 0
for (const anim of root.listAnimations()) {
  for (const channel of anim.listChannels()) {
    const target = channel.getTargetNode()
    if (!target) continue
    const mine = bones.get(target.getName())
    if (!mine) {
      // A channel for something the mannequin has not got — the tool-attachment sockets.
      channel.dispose()
      orphaned++
    } else if (mine !== target) {
      channel.setTargetNode(mine)
      retargeted++
    }
  }
}
console.log(`retargeted ${retargeted} channels, dropped ${orphaned} with no matching bone`)

/**
 * Bring the clothed garment sets across onto the mannequin's own skin.
 *
 * The Adventurers rig is a strict superset of the mannequin's: 23 joints against 21, in a
 * different order, with `handslot.l` and `handslot.r` extra for weapons. Every one of our 21
 * is present, the bind poses are identical to 5.457e-12, and no body, limb or head mesh
 * references either weapon slot — which is why this is a joint-index rewrite rather than a
 * retarget. See the spec's four compatibility checks.
 *
 * The rewrite is by bone NAME, not by position. Matching by position would line up for the
 * first six joints and then diverge, and the result renders as limbs pinned to the wrong
 * bone rather than as an error.
 */
const mannequinSkin = root.listSkins()[0]
if (!mannequinSkin) throw new Error('build-crew: the mannequin has no skin')
const ourJoints = mannequinSkin.listJoints().map((j) => j.getName())
const ourIndex = new Map(ourJoints.map((name, i) => [name, i]))

for (const set of GARMENT_SETS) {
  const src = await io.read(`${ADVENTURERS}/${set.file}`)
  const srcRoot = src.getRoot()

  // Drop everything this set does not contribute, before merging, so its capes and its
  // spare materials never enter the target document.
  const keep = new Set(set.meshes)
  for (const node of srcRoot.listNodes()) {
    if (node.getMesh() && !keep.has(node.getName())) node.dispose()
  }
  const kept = srcRoot.listNodes().filter((n) => n.getMesh()).map((n) => n.getName())
  const missing = set.meshes.filter((m) => !kept.includes(m))
  if (missing.length) throw new Error(`${set.file}: no such mesh: ${missing.join(', ')}`)

  const srcSkin = srcRoot.listSkins()[0]
  if (!srcSkin) throw new Error(`${set.file}: no skin`)
  const theirJoints = srcSkin.listJoints().map((j) => j.getName())

  // Their index -> ours, by name. A joint of theirs we do not have maps to -1, and any
  // vertex that actually references one is a hard error.
  const remap = theirJoints.map((name) => (ourIndex.has(name) ? ourIndex.get(name) : -1))

  mergeDocuments(doc, src)

  for (const name of set.meshes) {
    const node = root.listNodes().find((n) => n.getName() === name)
    if (!node) throw new Error(`build-crew: ${name} did not survive the merge`)
    for (const prim of node.getMesh().listPrimitives()) {
      const joints = prim.getAttribute('JOINTS_0')
      const weights = prim.getAttribute('WEIGHTS_0')
      if (!joints || !weights) throw new Error(`${name}: not skinned`)
      const element = [0, 0, 0, 0]
      const w = [0, 0, 0, 0]
      for (let i = 0; i < joints.getCount(); i++) {
        joints.getElement(i, element)
        weights.getElement(i, w)
        for (let k = 0; k < 4; k++) {
          if (w[k] === 0) {
            // An unweighted slot's index is ignored by the shader; normalise it to 0 so an
            // unmapped joint in a dead slot cannot trip the error below.
            element[k] = 0
            continue
          }
          const to = remap[element[k]]
          if (to < 0) {
            throw new Error(`${name}: vertex ${i} is weighted to ${theirJoints[element[k]]}, which the mannequin has not got`)
          }
          element[k] = to
        }
        joints.setElement(i, element)
      }
    }
    node.setSkin(mannequinSkin)
    scene.addChild(node)
  }
  console.log(`merged ${set.id}: ${set.meshes.length} meshes onto ${ourJoints.length} joints`)
}

// The mannequin contributes the rig and the clips now, and nothing that is drawn.
for (const node of root.listNodes()) {
  if (node.getMesh() && node.getName().startsWith('Mannequin_')) node.dispose()
}

for (const s of root.listScenes()) {
  if (s !== scene) s.dispose()
}

// Disposing those scenes orphans the duplicate rigs, their meshes and their skins without
// deleting them — prune() leaves meshes and skins alone — so the reachable set is walked
// here and everything else goes.
const live = new Set()
const reach = (node) => {
  live.add(node)
  node.listChildren().forEach(reach)
}
scene.listChildren().forEach(reach)

const liveMeshes = new Set([...live].map((n) => n.getMesh()).filter(Boolean))
const liveSkins = new Set([...live].map((n) => n.getSkin()).filter(Boolean))
for (const node of root.listNodes()) if (!live.has(node)) node.dispose()
for (const mesh of root.listMeshes()) if (!liveMeshes.has(mesh)) mesh.dispose()
for (const skin of root.listSkins()) if (!liveSkins.has(skin)) skin.dispose()

await doc.transform(dedup(), prune({ keepAttributes: false }), unpartition())

// A duplicate name would make three's loader rename one of them at parse time, and the
// clips would miss again — this time silently, so it is worth an assertion.
const names = root.listNodes().map((n) => n.getName())
const dupes = names.filter((n, i) => names.indexOf(n) !== i)
if (dupes.length) throw new Error(`duplicate node names survive: ${[...new Set(dupes)].join(', ')}`)

console.log(`animations ${root.listAnimations().length}`)
for (const a of root.listAnimations()) {
  const end = Math.max(...a.listSamplers().map((s) => s.getInput()?.getMax([])[0] ?? 0))
  console.log(`  ${a.getName().padEnd(20)} ${end.toFixed(2)}s`)
}
console.log(`meshes     ${root.listMeshes().length}`)
console.log(`skins      ${root.listSkins().map((s) => s.listJoints().length + ' joints').join(', ')}`)

mkdirSync('public/assets', { recursive: true })
await io.write(OUT, doc)
