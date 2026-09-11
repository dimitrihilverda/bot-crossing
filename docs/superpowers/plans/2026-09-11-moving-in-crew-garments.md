# Crew Garments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the crew's bare mannequin with clothed Ranger and Rogue characters from KayKit's Adventurers pack — bodies, limbs and heads — keeping six skin tones and eye-colour-as-status by repainting three atlas cells per mover.

**Architecture:** The Adventurers sit on the same `Rig_Medium` with bind poses identical to 5.457e-12, so the build step remaps their joint indices onto the mannequin's 21-bone skin and the runtime merges each set into one geometry that reads the existing baked bone-matrix texture. Skin, hair and eyes are each their own cell in the character's 8 × 4 gradient atlas, and three new per-instance `vec3` attributes let one mesh carry three per-mover colours where `instanceColor` carries one.

**Tech Stack:** three.js 0.185, Vite 7, `node --test`, `@gltf-transform/core` and `@gltf-transform/functions` 4.4.

**Spec:** `docs/superpowers/specs/2026-09-11-moving-in-crew-garments-design.md` (approved, commit `4606b8f`)

## Prerequisite — read this before Task 1

`tools/build-crew.mjs` reads **`assets-src/KayKit_Character_Animations_1.1/`**, and that pack
is not currently in `assets-src/`; only `KayKit_Adventurers_2.0_FREE` is. Without it the build
cannot run, and `build-crew.mjs` deliberately no-ops rather than failing when the pack is
absent — so a missing pack shows up as "nothing changed", not as an error.

The Adventurers pack cannot substitute. It ships only `Rig_Medium_General.glb` and
`Rig_Medium_MovementBasic.glb`, which between them hold 9 of the 17 clips the build wants.
Missing are `Rig_Medium_Simulation.glb` (`Cheering`, `Waving`, `Sit_Chair_Down`,
`Sit_Chair_Idle`, `Sit_Chair_StandUp`) and `Rig_Medium_Tools.glb` (`Hammering`, `Working_A`,
`Holding_A`). `Holding_A` is the carrying pose the moving box depends on.

**If `assets-src/KayKit_Character_Animations_1.1/` is missing when Task 1 starts, stop and
report it.** Do not work around it, do not drop the clips, and do not build from an
adventurer's skeleton instead.

## Global Constraints

- Test baseline entering this stage: **205 passing, 0 failing** at `39bfa11`. `npm run build` must succeed after every task.
- `server/` stays **byte-identical** to Dimitri's `shared-colonies` branch. `git diff -- server/` must be empty, checked at the end of every task.
- No new dependencies. `package.json` unchanged.
- `public/assets/crew.glb` **is** rebuilt by this stage — the one asset that may change. `city.glb`, `furniture.glb`, `forest.glb` and `spacebase.glb` stay as they are.
- `STATUS_ORDER` and the eight `AGENT_LOOK` keys unchanged.
- Theme port is **5280**; bind explicitly to IPv4 (`npx vite --host 127.0.0.1 --port 5280 --strictPort`) because the default binding here is IPv6-only. Ports **5274, 5275 and 5276** belong to the always-on installation and must never be used. Any agent that starts a dev server must prove with `netstat` that it freed the port.
- All code, comments and documents in **English**.
- **The Browser pane does not drive `requestAnimationFrame`** in this project — measured at 0 frames in 3 seconds with the document visible. Drive frames by hand: the engine's updaters are **objects with an `update(dt, elapsed)` method**, so it is `u.update(1/60, t)` and never `u(1/60, t)`.
- A documentation claim must be true of the code. Across stages 1 to 4 every Important review finding was documentation asserting the opposite of the implementation — nine by the end of stage 4 — and two fix rounds introduced fresh false claims while correcting others. One was a fix report claiming a road followed the terrain when the change was provably a no-op. Check that nothing *removed* was true either.
- **This stage deletes three modules and a face-animation system.** Every reference in code, comments, README and earlier specs must go or move to the past tense.

## File Structure

| File | Responsibility |
| --- | --- |
| `tools/build-crew.mjs` | Merges the garment sets into `crew.glb`, remapping their joint indices onto the mannequin's skin. Task 1. |
| `src/agents/garment-sets.js` *(new)* | Pure: which mesh names belong to which set, and which set a thread id wears. Tasks 1 and 2. |
| `src/agents/crew.js` | `mergeBody` keeps the UVs; `bake` returns one geometry per set; `extractHead` goes. Tasks 2 and 5. |
| `src/agents/atlas-cells.js` *(new)* | Pure: the UV rectangle of a numbered cell in an 8 × 4 atlas. Task 3. |
| `src/agents/skin.js` | Keeps `SKIN_TONES` and `skinToneFor`; loses nothing. Task 3. |
| `src/agents/hair.js` | Loses its four primitive geometries; becomes the hair-tone palette. Tasks 3 and 5. |
| `src/agents/astronauts.js` | The garment material and its shader, three instanced colour attributes, the packing loop, the band constants. Tasks 3, 4. |
| `src/agents/faces.js`, `src/agents/workwear.js`, `src/agents/head-bind.js` | Deleted. Task 5. |
| `README.md`, the spec | Task 6. |

---

### Task 1: build the garment sets into `crew.glb`

**Files:**
- Modify: `tools/build-crew.mjs`
- Create: `src/agents/garment-sets.js`
- Test: `test/garment-sets.test.mjs`, `test/crew-glb.test.mjs` (both create)

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `src/agents/garment-sets.js` exports `GARMENT_SETS`, an array of `{ id, prefix, meshes }` where `id` is `'ranger'` or `'rogue'`, `prefix` is `'Ranger'` or `'Rogue'`, and `meshes` is the six node names in a fixed order. Also `setMeshNames(prefix) -> string[]`.
  - `public/assets/crew.glb` containing exactly those twelve mesh nodes, one skin of 21 joints, and no `Mannequin_Medium_*` mesh.

- [ ] **Step 1: Write the failing test for the set definitions**

Create `test/garment-sets.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { GARMENT_SETS, setMeshNames } from '../src/agents/garment-sets.js'

const PARTS = ['Body', 'ArmLeft', 'ArmRight', 'LegLeft', 'LegRight', 'Head']

test('there are two garment sets', () => {
  assert.equal(GARMENT_SETS.length, 2)
  assert.deepEqual(GARMENT_SETS.map((s) => s.id), ['ranger', 'rogue'])
})

test('each set names its own six meshes, and no others', () => {
  // The pack also ships a cape per character, a quiver for the Ranger and headgear for
  // three others. None of them is wanted: a cape hides the torso the hi-vis band wraps,
  // and a hood would hide the head entirely.
  for (const set of GARMENT_SETS) {
    assert.deepEqual(set.meshes, PARTS.map((p) => `${set.prefix}_${p}`))
    assert.equal(set.meshes.length, 6)
  }
})

test('no set names a cape, a quiver, a hood or any headgear', () => {
  const all = GARMENT_SETS.flatMap((s) => s.meshes).join(' ')
  for (const unwanted of ['Cape', 'Quiver', 'Hood', 'Helmet', 'Hat']) {
    assert.ok(!all.includes(unwanted), `a set names a ${unwanted}`)
  }
})

test('setMeshNames agrees with the table', () => {
  assert.deepEqual(setMeshNames('Ranger'), GARMENT_SETS[0].meshes)
  assert.deepEqual(setMeshNames('Rogue'), GARMENT_SETS[1].meshes)
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/garment-sets.test.mjs`
Expected: FAIL — `src/agents/garment-sets.js` does not exist.

- [ ] **Step 3: Write `src/agents/garment-sets.js`**

```javascript
/**
 * The two garment sets, and which mesh of each belongs to a figure.
 *
 * KayKit's Adventurers pack splits every character into the same six meshes as the
 * mannequin — body, two arms, two legs and a head — on the same `Rig_Medium` skeleton, with
 * bind poses identical to the mannequin's to 5.457e-12. That is what lets a set be used
 * without retargeting anything: see the spec's four compatibility checks.
 *
 * Only those six are taken. The pack also ships a cape per character, a quiver for the
 * Ranger and headgear for three others; a cape would hide the torso the hi-vis band wraps
 * and a hood would hide the head, so none of them is imported.
 *
 * Kept free of three.js so the build tool and `node --test` can both read it.
 */

/** The six parts, in a fixed order so a merged geometry is byte-reproducible. */
export const SET_PARTS = Object.freeze(['Body', 'ArmLeft', 'ArmRight', 'LegLeft', 'LegRight', 'Head'])

/** The mesh node names one character contributes. */
export const setMeshNames = (prefix) => SET_PARTS.map((part) => `${prefix}_${part}`)

export const GARMENT_SETS = Object.freeze([
  { id: 'ranger', prefix: 'Ranger', file: 'Ranger.glb', meshes: setMeshNames('Ranger') },
  { id: 'rogue', prefix: 'Rogue', file: 'Rogue.glb', meshes: setMeshNames('Rogue') },
])
```

- [ ] **Step 4: Run the test**

Run: `node --test test/garment-sets.test.mjs`
Expected: PASS, 4 tests.

- [ ] **Step 5: Write the failing test for the built glb**

Create `test/crew-glb.test.mjs`. It reads the built asset, so it needs no renderer — this is
the same approach `test/deliveries.test.mjs` already takes with `@gltf-transform/core`.

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { NodeIO } from '@gltf-transform/core'
import { GARMENT_SETS } from '../src/agents/garment-sets.js'

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
```

- [ ] **Step 6: Run it to verify it fails**

Run: `node --test test/crew-glb.test.mjs`
Expected: FAIL — the current `crew.glb` has the mannequin's meshes and none of the garments.

- [ ] **Step 7: Read the tool before changing it**

Read `tools/build-crew.mjs` end to end. It reads `Mannequin_Medium.glb`, merges the wanted
animation documents, **retargets every animation channel onto the mannequin's own bones by
name**, disposes the other scenes, walks the reachable set to delete the duplicate rigs their
meshes and their skins, then runs `dedup()`, `prune({ keepAttributes: false })` and
`unpartition()`, and finally asserts no duplicate node names survive.

Two things in it matter for this task:

- The reachable-set walk is what removes a merged document's duplicate rig. The garments must
  be re-parented into the kept scene and their own rigs left unreachable, so the same walk
  removes them.
- `prune({ keepAttributes: false })` prunes vertex attributes nothing uses. The garments' UVs
  are used by their materials, so they survive — but the `crew-glb` test asserts it rather
  than trusting it.

- [ ] **Step 8: Add the garment merge**

Add near the top, beside the existing `SRC`, `MANNEQUIN` and `ANIMS` constants:

```javascript
import { GARMENT_SETS } from '../src/agents/garment-sets.js'

const ADVENTURERS = 'assets-src/KayKit_Adventurers_2.0_FREE/Characters/gltf'
```

Then, **after** the animation merge and the channel retarget but **before** the scene
disposal and the reachable-set walk, add the garment pass. `bones` is already built by the
retarget step as a `Map` from bone name to the mannequin's node; reuse it.

```javascript
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
```

**Verify each `@gltf-transform` call against the installed version (4.4) before trusting it.**
`Accessor.getElement` / `setElement`, `Node.setSkin`, `Node.dispose` and `Scene.addChild` are
the calls this leans on; if any differs, **the library is right and this plan is wrong** —
follow the API and report the discrepancy. An earlier stage of this project had three API
errors in one planned snippet, all found only because the implementer read the real code
first.

- [ ] **Step 9: Rebuild and run both tests**

Run: `node tools/build-crew.mjs`
Expected: it prints the retarget line, then `merged ranger: 6 meshes onto 21 joints` and the
same for rogue, then its animation and mesh summaries. If it prints
`build-crew: no source pack, keeping the existing public/assets/crew.glb`, the Character
Animations pack is missing — **stop and report**, per the Prerequisite above.

Run: `node --test test/crew-glb.test.mjs`
Expected: PASS, 9 tests.

- [ ] **Step 10: Run the whole suite and build**

Run: `npm test`
Expected: **218 passing, 0 failing** (205 + 4 + 9).

`test/crew-clips.test.mjs` cross-checks the `WANTED` clip list in `tools/build-crew.mjs`
against `CLIP` in `src/agents/crew.js` — it reads both as **source text**, not the built glb,
so this task should leave it green. If it fails, you changed one of those two lists and the
other needs the same change. Should any existing test fail here, that is a real consequence:
report it with the failure, and do not weaken a test to make it pass.

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty.

- [ ] **Step 11: Commit**

```bash
git add tools/build-crew.mjs src/agents/garment-sets.js test/garment-sets.test.mjs test/crew-glb.test.mjs public/assets/crew.glb
git commit -m "feat: build the Ranger and Rogue garment sets onto the crew skeleton"
```

---

### Task 2: bake both sets, keep the UVs, and put a clothed mover on screen

**Files:**
- Modify: `src/agents/crew.js` — `mergeBody`, `bake`, `DROP_MESHES`, `extractHead`
- Modify: `src/agents/garment-sets.js` — add the per-id set choice
- Modify: `src/agents/astronauts.js` — `setRig` builds two meshes
- Test: `test/garment-sets.test.mjs` (extend)

**Interfaces:**
- Consumes: `GARMENT_SETS` and `setMeshNames` from Task 1; `public/assets/crew.glb` as Task 1 built it.
- Produces:
  - `garmentSetIndexFor(id) -> 0 | 1` and `garmentSetFor(id) -> GARMENT_SETS[n]`, both pure and stable.
  - `crewRig()` resolves to `{ sets, bones, boneIndex, boneTexture, frameCount, clips, ... }` where `sets` is `[{ id, geometry, textureName }, …]` in `GARMENT_SETS` order. **`headGeometry` is gone.**

- [ ] **Step 1: Write the failing test for the set choice**

Append to `test/garment-sets.test.mjs`:

```javascript
import { garmentSetFor, garmentSetIndexFor } from '../src/agents/garment-sets.js'
import { skinToneIndexFor } from '../src/agents/skin.js'

test('a thread always wears the same set', () => {
  for (const id of ['a', 'session-1', 'c:/PhpstormProjects', '']) {
    assert.equal(garmentSetIndexFor(id), garmentSetIndexFor(id))
  }
})

test('the set index is always in range', () => {
  for (let i = 0; i < 500; i++) {
    const n = garmentSetIndexFor(`thread-${i}`)
    assert.ok(n === 0 || n === 1, `id thread-${i} gave set ${n}`)
  }
})

test('both sets actually get worn', () => {
  const seen = new Set()
  for (let i = 0; i < 200; i++) seen.add(garmentSetIndexFor(`thread-${i}`))
  assert.equal(seen.size, 2, 'one of the two sets is never chosen')
})

test('the set is independent of the skin tone', () => {
  // Stage 3's lesson, restated: its suggested hair salt was FNV-1a over a prefixed string,
  // which never mixes the lowest bit, so with two even moduli the parity of the two hashes
  // agreed 100% of the time and only half the pairs ever appeared — and the test written
  // for it would have passed on that. So this asserts the joint distribution, not a
  // correlation coefficient.
  const pairs = new Map()
  for (let i = 0; i < 4000; i++) {
    const id = `thread-${i}`
    const key = `${garmentSetIndexFor(id)}:${skinToneIndexFor(id)}`
    pairs.set(key, (pairs.get(key) || 0) + 1)
  }
  // Two sets times six skin tones is twelve pairs, and every one must occur.
  assert.equal(pairs.size, 12, `only ${pairs.size} of 12 set/skin pairs appeared`)
  // And roughly evenly: no pair may be rarer than a third of the even share.
  const even = 4000 / 12
  for (const [key, n] of pairs) {
    assert.ok(n > even / 3, `pair ${key} appeared ${n} times, far under the even share ${even.toFixed(0)}`)
  }
})

test('garmentSetFor returns the set the index names', () => {
  for (const id of ['x', 'y', 'z']) {
    assert.equal(garmentSetFor(id), GARMENT_SETS[garmentSetIndexFor(id)])
  }
})

test('garment-sets.js cannot reach anything that knows a status', () => {
  // Asserted structurally rather than by hunting for the word "status": a word hunt fires on
  // the very comment that explains the contract, and a module that cannot import status
  // cannot depend on it whatever its comments say. The same test guards skin.js.
  const src = readFileSync('src/agents/garment-sets.js', 'utf8')
  const imports = [...src.matchAll(/^import .*? from '([^']+)'/gm)].map((m) => m[1])
  assert.deepEqual(imports, [], 'garment-sets.js should import nothing at all')
})
```

Add `import { readFileSync } from 'node:fs'` to the file's imports.

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/garment-sets.test.mjs`
Expected: FAIL — `garmentSetIndexFor` is not exported.

- [ ] **Step 3: Add the set choice to `src/agents/garment-sets.js`**

```javascript
/**
 * A hash with a proper avalanche. `lowbias32`, the same finalizer `src/agents/hair.js` uses,
 * and for the same reason: a plain multiply-xor hash leaves the low bits correlated, and in
 * stage 3 that showed up as a hairstyle that tracked skin tone for every single id. The
 * garment set has to be independent of the skin tone in the same way, and the test asserts
 * the joint distribution rather than taking a hash's word for it.
 */
function lowbias32(x) {
  x |= 0
  x = (x ^ (x >>> 16)) >>> 0
  x = Math.imul(x, 0x7feb352d) >>> 0
  x = (x ^ (x >>> 15)) >>> 0
  x = Math.imul(x, 0x846ca68b) >>> 0
  return (x ^ (x >>> 16)) >>> 0
}

function hashId(id) {
  let h = 0x811c9dc5
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193) >>> 0
  return lowbias32(h ^ 0x5bf03635)
}

/**
 * Which set a thread wears. A pure function of its id, resolved once when the agent is
 * created — **never** derived from status. The uniform says who a crew member is, the way
 * its skin tone does, and it is one of the few things on the figure a status change cannot
 * move.
 */
export const garmentSetIndexFor = (id) => hashId(id) % GARMENT_SETS.length
export const garmentSetFor = (id) => GARMENT_SETS[garmentSetIndexFor(id)]
```

The salt `0x5bf03635` is this module's own and must differ from the salts `skin.js` and
`hair.js` use. Check both files and pick a different one if it collides.

- [ ] **Step 4: Run the test**

Run: `node --test test/garment-sets.test.mjs`
Expected: PASS, 10 tests.

- [ ] **Step 5: Keep the UVs through the merge**

In `src/agents/crew.js`, `mergeBody` copies four attributes and its comment says why the UVs
are dropped:

> The UVs go: the pack's texture is a name badge and a smiley, and the colony paints its crew
> from its own suit palette instead.

**That reasoning is now inverted** — the atlas UVs are the entire colour mechanism this stage
rests on. Add `['uv', 2]` to the attribute list, and replace that sentence with why the UVs
now stay: skin, hair and eyes are three cells of the character's gradient atlas, addressed by
UV, and a merged geometry without them cannot be repainted per mover at all.

Do not leave the old sentence anywhere. A comment that states the opposite of the code is this
repository's signature defect — nine Important review findings across four stages.

- [ ] **Step 6: Bake one geometry per set**

Still in `src/agents/crew.js`:

- `mergeBody(skinned, dropMeshes)` becomes `mergeSet(skinned, meshNames)` — it takes the six
  names to **keep** rather than a list to drop, and merges them in the given order so the
  result is reproducible. Keep everything else about it, including the `throw` when an
  attribute is missing.
- `bake()` builds one geometry per entry in `GARMENT_SETS` and returns them as
  `sets: [{ id, geometry, textureName }, …]`. `textureName` is the material name three's
  loader gives the set's mesh — read it off the `SkinnedMesh`'s material rather than typing
  it in, and if two sets resolve to the same material, throw: that would mean both sets are
  sharing one texture and one of them is wearing the other's clothes.
- **Delete `extractHead` and `headGeometry`.** The head is part of its set's geometry now.
- **Delete `DROP_MESHES` and the `HEAD_MESH` constant**, and the `dropMeshes` parameter on
  `bake`. Nothing is dropped at runtime any more; Task 1 dropped the mannequin's meshes at
  build time.
- `bakeClips(root, skeleton, skinned[0], gltf.animations)` folds `skinned[0]`'s own world
  matrix into the baked matrices. With twelve meshes instead of six, **assert that every
  skinned mesh has the same world matrix** before baking, and throw naming the offender if
  not. Two sets at different world transforms would bake one of them into the wrong place and
  it would look like an animation bug. This is the same discipline
  `src/agents/head-bind.js`'s `assertIdentity` applied to the head bake in stage 3.

- [ ] **Step 7: Draw both sets**

In `src/agents/astronauts.js`, `setRig` builds one `InstancedMesh` from `rig.geometry`. It
builds one per set instead, each with its own `MeshStandardMaterial` carrying that set's
texture as its `map`, each wrapped in `decorateSkinned` with the same `crewUniforms`, and each
with its own `aFrame` attribute and its own `customDepthMaterial`.

Both meshes share the one `rig.boneTexture`. That sharing is what the identical bind pose
buys, and it is why there is still only one baked animation.

An agent is written into its set's mesh and its slot in the other stays unused; the per-frame
packing loop already walks agents and writes per-slot, so route each agent by
`garmentSetIndexFor(agent.id)` — resolve it once when the agent record is created, alongside
its skin tone, rather than hashing per frame.

The face, the hair and the head meshes keep working for now; Task 5 removes them. **If the
face cap or the hair cannot be placed because `rig.headGeometry` is gone, leave them out and
say so in your report** — Task 5 deletes them anyway and a day of a wrong-looking face costs
less than a task boundary moved for it.

- [ ] **Step 8: Run the suite and build**

Run: `npm test`
Expected: **224 passing, 0 failing** (218 + 6). Existing tests that assert on `mergeBody`,
`extractHead`, `headGeometry` or `DROP_MESHES` will fail — `test/crew-look.test.mjs` and
`test/head-bind.test.mjs` are the likely ones. Those are real consequences: **update them to
the new shape, do not delete a test to make the suite green**, and report which you changed
and why.

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty.

- [ ] **Step 9: Look at it — this is the task's real deliverable**

Start the dev server bound to IPv4:

```bash
npx vite --host 127.0.0.1 --port 5280 --strictPort
```

Open `http://127.0.0.1:5280/`. Drive frames by hand, because the Browser pane does not tick
`requestAnimationFrame` here:

```javascript
const b = window.botCrossing, e = b.engine, r = b.rig, c = b.colony
let t = e.elapsed
for (let i = 0; i < 300; i++) { t += 1/60; for (const u of e.updaters) u.update(1/60, t) }
e.elapsed = t
const a = c.astronauts.agents.filter(x => x && x.pos)
const p = a[5].pos
r.desiredTarget.set(p.x, p.y + 0.62, p.z); r.target.copy(r.desiredTarget)
r.desiredDistance = 3.6; r.distance = 3.6
for (let i = 0; i < 60; i++) { t += 1/60; for (const u of e.updaters) u.update(1/60, t) }
e.elapsed = t; e.composer.render()
```

Take a screenshot and answer these in the report, in words:

- Is the figure clothed, and does the garment's own texture show — belts, buckles, boots?
- Is the head attached to the collar, without a gap and without the head sunk into it?
- Do the limbs follow the animation, or is anything pinned to the world origin or to a wrong
  bone? **A joint remap error shows here and nowhere else.**
- Are both sets visible somewhere in the colony?

Then stop the server and prove the port is free:

```bash
netstat -ano | grep ":5280 "
```

Expected: no `LISTENING` line.

- [ ] **Step 10: Commit**

```bash
git add src/agents/crew.js src/agents/garment-sets.js src/agents/astronauts.js test/
git commit -m "feat: the crew wear clothes, in two sets chosen by thread id"
```

---

### Task 3: three per-mover colours from three atlas cells

**Files:**
- Create: `src/agents/atlas-cells.js`
- Modify: `src/agents/hair.js` — replace the four geometries with a tone palette
- Modify: `src/agents/astronauts.js` — the garment material's shader and three instanced attributes
- Test: `test/atlas-cells.test.mjs` (create), `test/crew-look.test.mjs` (extend)

**Interfaces:**
- Consumes: the two garment meshes from Task 2; `SKIN_TONES` and `skinToneFor` from `src/agents/skin.js`; `AGENT_LOOK`'s eye colours, already written per agent as `agent.eye`.
- Produces:
  - `cellRect(n) -> { u0, v0, u1, v1 }` for an 8 × 4 atlas, and `CELL_SKIN = 0`, `CELL_HAIR = 1`, `CELL_EYES = 2`.
  - `HAIR_TONES` and `hairToneFor(id)` from `src/agents/hair.js`.
  - Three `InstancedBufferAttribute`s named `aSkin`, `aHair` and `aEye`, itemSize 3, on each garment geometry.

- [ ] **Step 1: Write the failing test for the cell rectangles**

Create `test/atlas-cells.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { ATLAS_COLS, ATLAS_ROWS, CELL_EYES, CELL_HAIR, CELL_SKIN, cellRect } from '../src/agents/atlas-cells.js'

test('the atlas is eight columns by four rows', () => {
  assert.equal(ATLAS_COLS, 8)
  assert.equal(ATLAS_ROWS, 4)
})

test('cell 0 is the top-left cell', () => {
  // glTF puts the UV origin at the TOP left and `v` runs downward, so cell 0 spans
  // v 0 to 0.25 and not 0.75 to 1. Inverting this repaints a different swatch while still
  // looking deliberate, which is why it is asserted rather than assumed.
  assert.deepEqual(cellRect(0), { u0: 0, v0: 0, u1: 0.125, v1: 0.25 })
})

test('cell 8 is the first cell of the second row', () => {
  assert.deepEqual(cellRect(8), { u0: 0, v0: 0.25, u1: 0.125, v1: 0.5 })
})

test('cell 7 is the last cell of the first row', () => {
  assert.deepEqual(cellRect(7), { u0: 0.875, v0: 0, u1: 1, v1: 0.25 })
})

test('the three named cells are the ones the head meshes use', () => {
  // Measured from the UVs of Ranger_Head and Rogue_Head: cell 1 is hair (770 and 1640
  // vertices), cell 0 is skin (322 and 309), cell 2 is eyes and brows (80 and 98).
  assert.equal(CELL_SKIN, 0)
  assert.equal(CELL_HAIR, 1)
  assert.equal(CELL_EYES, 2)
})

test('every cell index has a rectangle inside the unit square', () => {
  for (let n = 0; n < ATLAS_COLS * ATLAS_ROWS; n++) {
    const r = cellRect(n)
    assert.ok(r.u0 >= 0 && r.u1 <= 1 && r.v0 >= 0 && r.v1 <= 1, `cell ${n} escapes the atlas`)
    assert.ok(r.u1 > r.u0 && r.v1 > r.v0, `cell ${n} is empty`)
  }
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/atlas-cells.test.mjs`
Expected: FAIL — the module does not exist.

- [ ] **Step 3: Write `src/agents/atlas-cells.js`**

```javascript
/**
 * Where a numbered cell sits in a KayKit character atlas.
 *
 * Every character texture in the Adventurers pack is one 1024 x 1024 PNG laid out as eight
 * columns by four rows, each cell a vertical gradient and the bottom row filler. That is the
 * same shape `tools/atlas-cells.mjs` reads for the kit atlases.
 *
 * Three of those cells are what this project repaints per crew member, measured from the UVs
 * of `Ranger_Head` and `Rogue_Head` rather than guessed:
 *
 *  - cell 0, `#f6c09c`, skin — 322 vertices on the Ranger's head, 309 on the Rogue's
 *  - cell 1, `#9b5a45`, hair — 770 and 1640
 *  - cell 2, `#13191b`, eyes and brows — 80 and 98
 *
 * glTF puts the UV origin at the **top** left and `v` runs downward, so cell 0 spans
 * v 0 to 0.25. Inverting that repaints a different swatch and still looks deliberate, which
 * is the one mistake here that a screenshot would not catch.
 *
 * Pure arithmetic, no three.js, so it can be tested under `node --test`.
 */

export const ATLAS_COLS = 8
export const ATLAS_ROWS = 4

export const CELL_SKIN = 0
export const CELL_HAIR = 1
export const CELL_EYES = 2

/** The cell's own mid colour, for the ratio substitution the shader does. */
export const CELL_BASE = Object.freeze({
  [CELL_SKIN]: 0xf6c09c,
  [CELL_HAIR]: 0x9b5a45,
  [CELL_EYES]: 0x13191b,
})

/** The UV rectangle cell `n` occupies. */
export function cellRect(n) {
  const col = n % ATLAS_COLS
  const row = Math.floor(n / ATLAS_COLS)
  return {
    u0: col / ATLAS_COLS,
    v0: row / ATLAS_ROWS,
    u1: (col + 1) / ATLAS_COLS,
    v1: (row + 1) / ATLAS_ROWS,
  }
}
```

- [ ] **Step 4: Run the test**

Run: `node --test test/atlas-cells.test.mjs`
Expected: PASS, 6 tests.

- [ ] **Step 5: Write the failing test for the hair palette**

Append to `test/crew-look.test.mjs`:

```javascript
import { HAIR_TONES, hairToneFor, hairToneIndexFor } from '../src/agents/hair.js'

const srgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
const toLinear = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4))
const luminance = (hex) => {
  const [r, g, b] = srgb(hex).map(toLinear)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

test('there are six hair tones', () => {
  assert.equal(HAIR_TONES.length, 6)
})

test('every hair tone is darker than every skin tone', () => {
  // The constraint stage 3 used to pick its single HAIR_TONE, now applied to six: hair has
  // to read as hair against all six skin tones, and the only way it reliably does at this
  // figure size is by being darker than the face it sits above.
  for (const hair of HAIR_TONES) {
    for (const skin of SKIN_TONES) {
      assert.ok(
        luminance(hair) < luminance(skin),
        `hair 0x${hair.toString(16)} is not darker than skin 0x${skin.toString(16)}`
      )
    }
  }
})

test('a thread always gets the same hair tone, and every tone is used', () => {
  const seen = new Set()
  for (let i = 0; i < 600; i++) {
    const id = `thread-${i}`
    assert.equal(hairToneIndexFor(id), hairToneIndexFor(id))
    seen.add(hairToneIndexFor(id))
  }
  assert.equal(seen.size, HAIR_TONES.length, `only ${seen.size} of ${HAIR_TONES.length} tones appear`)
})

test('the hair tone is independent of the skin tone', () => {
  const pairs = new Set()
  for (let i = 0; i < 6000; i++) {
    const id = `thread-${i}`
    pairs.add(`${hairToneIndexFor(id)}:${skinToneIndexFor(id)}`)
  }
  assert.equal(pairs.size, 36, `only ${pairs.size} of 36 hair/skin pairs appeared`)
})

test('no primitive hairstyle geometry survives', () => {
  // The four procedural styles are gone: each adventurer head has its hair modelled in, so
  // a primitive cap on top of it would intersect the mesh.
  const src = readFileSync('src/agents/hair.js', 'utf8')
  for (const gone of ['HAIR_STYLES', 'hairStyleIndexFor', 'BALD', 'SphereGeometry', 'CylinderGeometry']) {
    assert.doesNotMatch(src, new RegExp(`\\b${gone}\\b`), `hair.js still mentions ${gone}`)
  }
})
```

- [ ] **Step 6: Run it to verify it fails, then rewrite `hair.js`**

Run: `node --test test/crew-look.test.mjs`
Expected: FAIL — `HAIR_TONES` is not exported and the primitives are still there.

Rewrite `src/agents/hair.js` as the counterpart of `skin.js`: six tones and a per-id lookup,
with the four primitive builders, `HAIR_STYLES`, `BALD` and `hairStyleIndexFor` deleted. Pick
the six tones against the stated constraint — each darker in relative luminance than all six
`SKIN_TONES` — and **record the measured worst-case margin in the module comment**. Use a
salt distinct from `skin.js`'s and `garment-sets.js`'s, and the same `lowbias32` finalizer.

Keep the module's existing import-allowlist test passing: it must still be unable to reach
anything that knows a status.

- [ ] **Step 7: Add the three instanced attributes and the shader**

In `src/agents/astronauts.js`, each garment mesh gets three `InstancedBufferAttribute`s of
itemSize 3 with `DynamicDrawUsage` — `aSkin`, `aHair`, `aEye` — written in the same per-frame
packing loop that already writes `aFrame` and the band colours. Follow how
`_attachFrameAttribute` does it.

The material's `onBeforeCompile` patches both stages. Follow `_faceMaterial`'s patch as the
shape to copy — it is the working precedent in this file for editing three's shader chunks —
and note `decorateSkinned` already patches the vertex shader's `#include <common>`, so the
two patches must not fight: apply this one after it and anchor on different chunks.

Vertex stage: declare the three attributes, declare three varyings, assign them.

Fragment stage: three rectangle tests against `vMapUv`, substituting per cell.

```glsl
// Substitute by RATIO, not by replacement. Every cell is a vertical gradient, and flattening
// it to one colour throws away the shading that makes these models read as cloth. Dividing by
// the cell's own mid colour and multiplying by the target keeps the gradient and moves only
// the hue.
vec3 repaint( vec3 texel, vec3 base, vec3 target ) {
  return texel * ( target / max( base, vec3( 0.02 ) ) );
}
```

**Cell 2 is the exception.** `#13191b` is near-black, so a ratio against it divides by almost
nothing and any rounding becomes a colour. Replace the eye cell outright instead of by ratio,
and say so in the comment. It is 80–98 vertices of flat dark paint with no gradient worth
keeping.

Pass the three base colours in as uniforms from `CELL_BASE` rather than typing them into the
shader, so the atlas and the shader cannot drift apart.

- [ ] **Step 8: Write the per-agent colours**

In the packing loop, per agent:

- `aSkin` from `skinToneFor(agent.id)` — the existing function, unchanged.
- `aHair` from `hairToneFor(agent.id)`.
- `aEye` from `agent.eye`, which the loop already maintains from `AGENT_LOOK` and which is
  what makes the eye colour a status carrier. **Do not** make the skin or hair depend on
  status, and do not make the eye colour depend on the id.

Note `skinToneFor` returns a shared mutable `THREE.Color` — a deferred minor from stage 3 —
so read its components immediately rather than holding the object.

- [ ] **Step 9: Run the suite and build**

Run: `npm test`
Expected: **235 passing, 0 failing** (224 + 6 + 5). Tests asserting on the old hair
geometries will fail; update them to the new shape and report what you changed.

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty.

- [ ] **Step 10: Verify the colours actually vary, in the browser**

Start the dev server on IPv4 as in Task 2, then:

```javascript
const c = window.botCrossing.colony, a = c.astronauts
const set0 = a.garments?.[0]?.mesh ?? a.crew
const attr = set0.geometry.getAttribute('aSkin')
const seen = new Set()
for (let i = 0; i < set0.count; i++) {
  seen.add([attr.getX(i), attr.getY(i), attr.getZ(i)].map(v => v.toFixed(3)).join(','))
}
;[...seen]
```

Expected: several distinct skin values, not one. Repeat for `aHair` and `aEye`. Then take a
close-up screenshot of two movers with different skin tones and say in the report whether the
skin, hair and eye colours differ between them **and whether the gradient survived** — a
flat-looking face means the ratio substitution collapsed the cell.

Stop the server and prove with `netstat -ano | grep ":5280 "` that no `LISTENING` line remains.

- [ ] **Step 11: Commit**

```bash
git add src/agents/atlas-cells.js src/agents/hair.js src/agents/astronauts.js test/
git commit -m "feat: repaint skin, hair and eyes per mover from three atlas cells"
```

---

### Task 4: the hi-vis bands must clear the tunics

**Files:**
- Modify: `src/agents/astronauts.js` — `bandR`, `bandDepth`, and the comment above them
- Test: `test/crew-look.test.mjs` (extend)

**Interfaces:**
- Consumes: the garment meshes from Task 2.
- Produces: band constants that clear both garments, and the measured clearance recorded.

- [ ] **Step 1: Write the failing test**

Append to `test/crew-look.test.mjs`:

```javascript
test('the hi-vis bands clear both garments', () => {
  // Measured from the chest- and spine-weighted vertices of each body mesh, at the heights
  // the two rings sit (y 0.740 and 0.879 in the rig's own units):
  //
  //   Mannequin_Medium_Body  half-width 0.365  half-depth 0.271
  //   Ranger_Body            half-width 0.366  half-depth 0.346
  //   Rogue_Body             half-width 0.386  half-depth 0.340
  //
  // The old constants were bandR 0.388 and bandDepth 0.310, sized against the bare
  // mannequin. bandDepth sat INSIDE both tunics, leaving the ring buried front and back and
  // visible only at the sides — which is the defect this task fixes.
  const src = readFileSync('src/agents/astronauts.js', 'utf8')
  const value = (name) => {
    const m = src.match(new RegExp(`${name}:\\s*HEAD_R\\s*\\*\\s*([0-9.]+)`))
    assert.ok(m, `no ${name} expressed as a multiple of HEAD_R`)
    return 0.554 * Number(m[1])
  }
  const GARMENT_HALF_WIDTH = 0.386
  const GARMENT_HALF_DEPTH = 0.346
  const MIN_CLEARANCE = 0.01

  assert.ok(
    value('bandR') >= GARMENT_HALF_WIDTH + MIN_CLEARANCE,
    `bandR ${value('bandR').toFixed(3)} does not clear ${GARMENT_HALF_WIDTH} by ${MIN_CLEARANCE}`
  )
  assert.ok(
    value('bandDepth') >= GARMENT_HALF_DEPTH + MIN_CLEARANCE,
    `bandDepth ${value('bandDepth').toFixed(3)} does not clear ${GARMENT_HALF_DEPTH} by ${MIN_CLEARANCE}`
  )
})
```

- [ ] **Step 2: Run it to verify it fails**

Run: `node --test test/crew-look.test.mjs`
Expected: FAIL on `bandDepth` — 0.310 against a required 0.356.

- [ ] **Step 3: Re-measure the garments yourself**

Do not take the numbers above on trust; they are this plan's measurement, and the geometry may
have changed when Task 1 merged it. Measure the built `crew.glb`'s `Ranger_Body` and
`Rogue_Body`: take the vertices weighted above 0.3 to the `chest` or `spine` joints, slice
them into 0.1-high bands by y, and report the maximum `|x|` and `|z|` in the bands covering
y 0.70–0.90. If your numbers differ from the plan's, **yours are right** — update the test's
constants and say so in your report.

- [ ] **Step 4: Raise the constants**

Set `bandR` and `bandDepth` to multiples of `HEAD_R` that clear your measured half-width and
half-depth by at least 0.01, and rewrite the comment block above them. That block currently
describes the bare mannequin's torso in detail — a half-width of 0.365 at y 0.70–0.80 and a
half-depth of 0.27–0.28 — and every one of those numbers is now about a body that is no longer
drawn. Replace them with the garments' figures and say which garment each came from.

`HEAD_R` is 0.554, measured off the mannequin's head, which this stage also stopped drawing.
It is now only a unit. Either re-express these constants without it or state plainly in the
comment that it is no longer a measurement of anything on screen.

- [ ] **Step 5: Run the suite and build**

Run: `npm test`
Expected: **236 passing, 0 failing** (235 + 1).

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty.

- [ ] **Step 6: Look at a band**

With the dev server on IPv4, zoom to a mover as in Task 2 Step 9 and confirm the band wraps
the tunic all the way round rather than disappearing into it front and back. Report what you
saw, and stop the server, proving the port is free.

- [ ] **Step 7: Commit**

```bash
git add src/agents/astronauts.js test/crew-look.test.mjs
git commit -m "fix: the hi-vis bands clear the tunics instead of sinking into them"
```

---

### Task 5: retire the face, the hairstyles' geometry and the workwear

**Files:**
- Delete: `src/agents/faces.js`, `src/agents/workwear.js`, `src/agents/head-bind.js`
- Delete: `test/workwear.test.mjs`, `test/head-bind.test.mjs`
- Modify: `src/agents/astronauts.js`, `src/agents/crew.js`, `test/crew-look.test.mjs`

**Interfaces:**
- Consumes: everything Tasks 1–4 built.
- Produces: no remaining reference to a face atlas, a face cap, a primitive hairstyle, a suit tone or a rigid head bind.

- [ ] **Step 1: Find every reference before deleting anything**

```bash
grep -rn "faces\.js\|buildFaceAtlas\|faceTexture\|faceFrame\|faceTimer\|faceIndex\|blinkAt\|_faceMaterial\|_faceUniforms\|uGlow\|FACE\b" src/ test/ README.md docs/
grep -rn "workwear\|SUIT_TONES\|head-bind\|assertIdentity\|headGeometry\|extractHead\|attachMatrixAt\|DROP_MESHES\|HEAD_MESH" src/ test/ README.md docs/
```

Write the list into your report **before** you start, with a decision per hit: delete,
rewrite, or keep. A reference in a spec describing what an earlier stage did is history and
stays in the past tense; a present-tense reference in code or the README is the defect.

Note `attachMatrixAt` also places the **props** — the hammer, the cabinet and the moving box
ride bones through it. It stays. Only the head's use of it goes.

- [ ] **Step 2: Write the failing test**

Append to `test/crew-look.test.mjs`:

```javascript
const GONE_MODULES = ['faces.js', 'workwear.js', 'head-bind.js']

for (const mod of GONE_MODULES) {
  test(`nothing imports ${mod}`, () => {
    // The modules are deleted; an import of one is a build failure, and a mention of one in
    // a comment is a description of machinery that no longer exists.
    for (const file of ['src/agents/astronauts.js', 'src/agents/crew.js']) {
      const src = readFileSync(file, 'utf8')
      assert.ok(!src.includes(mod), `${file} still mentions ${mod}`)
    }
  })
}

test('no face-animation machinery survives in astronauts.js', () => {
  // The face is painted into each adventurer's own texture now, and it is static. Blinking
  // and per-state expressions are gone and nothing replaces them: state is carried by the
  // pose, the badge, and the hi-vis band.
  const src = readFileSync('src/agents/astronauts.js', 'utf8')
  for (const gone of ['buildFaceAtlas', 'faceTexture', 'faceFrame', 'faceTimer', 'blinkAt', '_faceMaterial', 'uGlow']) {
    assert.doesNotMatch(src, new RegExp(`\\b${gone}\\b`), `astronauts.js still has ${gone}`)
  }
})

test('the props still ride their bones', () => {
  // attachMatrixAt is NOT retired with the head: the hammer, the cabinet and the moving box
  // all hang off bones through it, and the moving box is what the sitting pose reads against.
  const src = readFileSync('src/agents/astronauts.js', 'utf8')
  assert.match(src, /attachMatrixAt/, 'the props lost their bone placement')
  for (const prop of ['hammer', 'box']) {
    assert.match(src, new RegExp(`parts\\.${prop}\\s*=`), `parts.${prop} is no longer built`)
  }
})
```

- [ ] **Step 3: Run it to verify it fails**

Run: `node --test test/crew-look.test.mjs`
Expected: FAIL — the modules are still imported.

- [ ] **Step 4: Delete, in this order**

1. Remove the face cap mesh, its material, its atlas and the blink and expression state from
   `src/agents/astronauts.js` — `parts.face`, `_faceMaterial`, `_faceUniforms`, `faceTexture`,
   and the `faceFrame`, `faceTimer`, `faceIndex` and `blinkAt` fields on the agent record and
   every line that advances them.
2. Remove the head's rigid placement and its `assertIdentity` call from `src/agents/crew.js`,
   and delete `src/agents/head-bind.js` and `test/head-bind.test.mjs`.
3. Delete `src/agents/faces.js`.
4. Delete `src/agents/workwear.js` and `test/workwear.test.mjs`, and the `suit` field on the
   agent record with every use of it.
5. Carry the workwear finding forward rather than losing it. `workwear.js` established that
   every trim colour measures 0.09–0.41 in luminance while the five white bodies measured
   0.77–0.91, which is why the hi-vis band was a dark smudge for three stages. **Measure the
   same thing against the garments** — each set's tunic cells against all eight trim colours —
   and add a test asserting a stated margin, in `test/crew-look.test.mjs`. If a garment turns
   out light enough that the band stops reading, **report that as a finding**; do not adjust
   the threshold until it passes.

- [ ] **Step 5: Run the suite and build**

Run: `npm test`
Expected: the count drops as `workwear.test.mjs` (5 tests) and `head-bind.test.mjs` (6 tests)
go, and rises by the 3 above plus your band-contrast test — so roughly 236 − 11 + 4 = 229. Report the number you actually observe and
account for the difference; do not force it to a number this plan predicted.

Run: `npm run build`
Expected: succeeds.

Run: `git diff -- server/`
Expected: empty.

- [ ] **Step 6: Commit**

```bash
git add -A src/agents test/
git commit -m "refactor: retire the face atlas, the primitive hairstyles and the suit tones"
```

---

### Task 6: the documents

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-11-moving-in-crew-garments-design.md`

**Interfaces:**
- Consumes: everything Tasks 1–5 built.
- Produces: nothing code depends on.

**This is the task this repository fails.** Across stages 1 to 4, **every** Important review
finding was documentation asserting the opposite of the implementation — nine of them — and
two fix rounds introduced fresh false claims while correcting others. One was a fix report
claiming a road followed the terrain when the change was provably a no-op. Treat every
sentence as a claim to check against the code, and check that nothing you **remove** was true.

- [ ] **Step 1: Grep for every claim this stage falsified**

```bash
grep -rn "mannequin\|Mannequin\|suit\|white\|blink\|smiley\|name badge\|expression\|hairstyle\|face atlas\|screen-face\|visor" README.md docs/superpowers/specs/
grep -rn "six skin tones\|four hairstyles\|4 hairstyles\|48 combination" README.md docs/
```

For each hit record: still true, historical and in the past tense, or false and to be fixed.

- [ ] **Step 2: Rewrite the README's crew section**

Cover, in the README's own voice:

- The crew wear clothes from KayKit's Adventurers pack, in two sets, chosen by thread id.
- The four compatibility checks in one sentence each — same rig, same split, our bones a
  strict subset, identical bind poses — because they are why this was possible.
- Skin, hair and eye colour are three cells of the character's gradient atlas, repainted per
  mover through three per-instance attributes.
- **The face no longer blinks or changes expression**, and nothing replaces it. Say so
  plainly; the README currently describes a face that animates.
- Four hairstyles became two modelled cuts.
- The credits: the Adventurers pack is CC0, Kay Lousberg. Add it to
  `public/assets/CREDITS.md` alongside the other packs if it is not there.

- [ ] **Step 3: Append "What actually happened" to this stage's spec**

Record, verifying each against the code first:

- The final six `HAIR_TONES` and the measured worst-case margin against the six skin tones.
- The final `bandR` and `bandDepth`, and the clearance they actually achieve against each
  garment's measured half-width and half-depth.
- The band-contrast numbers against each set's tunic.
- Whether the ratio substitution kept each cell's gradient, and what the eye cell does
  instead.
- Anything an implementer ruled differently from this plan, and why.

- [ ] **Step 4: Run the suite and build**

Run: `npm test` — unchanged from Task 5.
Run: `npm run build` — must succeed.
Run: `git diff -- server/` — must be empty.

- [ ] **Step 5: Confirm no document claims something the code does not do**

```bash
grep -rn "blink\|expression\|smiley\|suit palette\|name badge" README.md
```

Expected: no present-tense claim that the crew's faces animate or that their colour comes
from a suit palette.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/superpowers/specs/ public/assets/CREDITS.md
git commit -m "docs: describe the clothed crew, and that the face no longer animates"
```

---

## Self-Review

**1. Spec coverage.**

| Spec section | Task |
| --- | --- |
| The four compatibility checks | Task 1 implements the remap they license; Task 6 records them |
| The atlas and its three cells | Task 3 |
| Kept: six skin tones, eye colour as status, hair colour per mover | Task 3 |
| Lost: the face animation | Task 5 |
| Lost: four hairstyles become two | Task 3 (palette) and Task 5 (geometry) |
| Lost: `workwear.js`, and carrying its finding forward | Task 5, Step 4.5 |
| Lost: the rigid head attachment | Tasks 2 and 5 |
| Three per-instance colours, ratio substitution, the eye-cell exception | Task 3 |
| Build time: import, drop, remap, merge, drop the mannequin | Task 1 |
| Run time: two meshes, one bone texture, set by thread id | Task 2 |
| The bands must grow | Task 4 |
| The legs are the same mesh; the heads are larger | Task 1's set table; no task needs more |
| Testing | Every task's own steps |
| Explicitly not doing | No task contradicts it |

**2. Placeholder scan.** No "TBD" and no "handle edge cases". Three places deliberately hand
the implementer a decision rather than a value, each with the constraint stated and a
requirement to record what was chosen: the six hair tones (Task 3 Step 6), the band multiples
(Task 4 Step 4) and the band-contrast threshold (Task 5 Step 4.5). Task 3's shader is given as
the two rules that matter — ratio substitution, and the eye cell's exception — plus the
precedent to copy, rather than as a full listing: `_faceMaterial` is the working example in
the same file, and transcribing three's shader chunks into a plan produces a second source of
truth that drifts.

**3. Type consistency.** `GARMENT_SETS` entries are `{ id, prefix, file, meshes }` in Task 1
and are consumed under exactly those names in Tasks 1, 2 and 3. `garmentSetIndexFor(id)` and
`garmentSetFor(id)` are defined in Task 2 and used in Task 2. `cellRect(n)` returns
`{ u0, v0, u1, v1 }` in Task 3 and is consumed there. `mergeSet(skinned, meshNames)` replaces
`mergeBody(skinned, dropMeshes)` in Task 2 and nothing later calls the old name. `HAIR_TONES`
and `hairToneFor` are defined and consumed in Task 3.

**Test counts are predictions, not requirements.** 205 → 218 → 224 → 235 → 236, then Task 5
moves it down and up. Several existing tests assert on machinery this stage deletes —
`test/crew-look.test.mjs`, `test/crew-clips.test.mjs`, `test/head-bind.test.mjs` — so each
task says to update them and report the change rather than to hit a number. A task that
reaches this plan's predicted count by weakening a test has failed.

**One risk this plan cannot remove.** Task 1's joint remap is the single change that, if
wrong, produces a plausible-looking figure with a limb bound to the wrong bone — and no unit
test can catch that, because the indices are all in range and all the attributes are present.
That is why Task 2 Step 9 asks in words whether the limbs follow the animation, and why it is
the task's stated deliverable rather than a sanity check at the end.
