# Moving-In Crossing Stage 3 Implementation Plan — the crew stop being astronauts

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The figures stop wearing a spacesuit: no headgear, their own hairstyle and skin tone, and hi-vis bands that carry the status colour and the night glow.

**Architecture:** Everything worn hangs off a baked bone matrix through `attachMatrixAt(rig, frame, slot, out)` and `setPart(...)`. The helmet, visor, backpack, antenna, tip and lamp are removed from that list; the head — rigid, all 959 vertices on one bone — takes the helmet's place at the same slot with a per-agent skin tone; hairstyles are further parts at the same slot, bucketed by style the way the hammer has its own counter; and the bands ride the chest slot the backpack rode. `STATUS_ORDER` and `AGENT_LOOK` are untouched throughout.

**Tech Stack:** three.js 0.185, Vite 7, `node --test`. No new dependencies, no new asset packs.

**Spec:** `docs/superpowers/specs/2026-09-09-moving-in-theme-design.md` — the Stage 3 section.

## Global Constraints

- Node >= 22.13. All code, comments and user-facing text in **English**.
- Baseline is **118 passing, 0 failing**; counts below are relative to 118. `npm run build` must succeed.
- Runs on **port 5280** (`PORT=5280 npm run dev`). 5274 is a live installation's owner UI, 5275 its guest API, 5276 its UDP discovery — never use those three.
- No new dependencies; `package.json` and `public/assets/*.glb` must not change. `crew.glb` already contains `Mannequin_Medium_Head`, so nothing is rebuilt and `assets-src/` is not needed.
- **`STATUS_ORDER` stays the single strict precedence, and `AGENT_LOOK`'s keys must not change.** No new status, no seventh behaviour. `idle` and `sleeping` still carry no badge.
- **A crew member whose status carries a badge is never hidden**, and nor is one that is standing still. Do not touch that rule — it lives in `_markRiding` and `ridesAlong`.
- **Skin tone and hairstyle must never mean anything.** Both derive stably from the thread id, the way a plot's accent derives from its repo name, and neither ever changes with status.
- **`git diff -- server/` must stay empty.** A colleague's LAN colony-sharing work lives there; two reviews have verified it byte-identical to his branch.
- Never switch branches; never touch `C:\PhpstormProjects\bot-crossing` — a live installation whose autostart serves its `dist/`.
- **The Browser pane does not drive `requestAnimationFrame`** — measured at 0 frames in 3 seconds with the document visible. The scene sits frozen there, so sampled animated state is worthless. Drive frames by hand from the console (`for (let i = 0; i < 600; i++) colony.update(1/60, elapsed += 1/60)`) or use a real browser.

## What already exists, and must be reused rather than rebuilt

| Primitive | Where | What it gives you |
| --- | --- | --- |
| `attachMatrixAt(rig, frame, slot, out)` | `src/agents/crew.js:275` | the baked matrix of one attach bone at one frame |
| `rig.attachSlot` | `crew.js` | name → slot index; `ATTACH = ['head', 'chest', 'hand.r']` |
| `this.headSlot`, `this.chestSlot`, `this.handSlot` | `astronauts.js:331-332` | already resolved in the constructor |
| `setPart(child, worn, mesh, i, x, y, z, rx, ry, rz)` | `astronauts.js` | writes one instance of a worn part at an offset from a bone matrix |
| `P` | `astronauts.js:117` | the offset table, in the rig's own units |
| `decorateSkinned(material, uniforms, {normals})` | `crew.js:304` | the shader patch that skins against the bone texture |
| `hashString(str)` | `src/world/plots.js:939` | the stable hash a plot's accent already uses |
| the hammer's own counter | `astronauts.js`, `hands++` | the pattern for a part only some agents wear |
| `agent.index = -1` at the riding skip | `astronauts.js:1259` | why a skipped agent must give up its index — read the comment before touching the loop |

The current per-frame write, which Task 1 edits:

```javascript
attachMatrixAt(rig, agent.frame, this.headSlot, bone)
worn.multiplyMatrices(root, bone)
setPart(child, worn, helmet, i, 0, P.headUp, 0, 0, 0, 0)
setPart(child, worn, visor, i, 0, P.headUp, 0, 0, 0, 0)
setPart(child, worn, face, i, 0, P.headUp, 0, 0, 0, 0)
setPart(child, worn, antenna, i, P.antX, P.antY, P.antZ, 0.06, 0, -0.12)
setPart(child, worn, tip, i, P.tipX, P.tipY, P.antZ, 0, 0, 0)

attachMatrixAt(rig, agent.frame, this.chestSlot, bone)
worn.multiplyMatrices(root, bone)
setPart(child, worn, pack, i, 0, P.packUp, P.packZ, 0, 0, 0)
setPart(child, worn, lamp, i, 0, P.lightY, P.lightZ, 0, 0, 0)
```

---

### Task 1: Take the spacesuit off

Removal only. It leaves the figures deliberately odd-looking — a floating face with no head behind it — and that intermediate state is correct for this task, not a defect. Task 2 puts a head there.

**Files:**
- Modify: `src/agents/astronauts.js` — `_buildMeshes` (the `parts` registry), the per-frame write above, `P`, and `dispose`/`onSettingsChanged` if they name parts individually
- Test: `test/crew-look.test.mjs` (create)

**Interfaces:**
- Produces: `parts` no longer contains `helmet`, `visor`, `pack`, `antenna`, `tip` or `lamp`. `parts.face`, `parts.hammer`, `parts.cabinet` and `parts.box` remain. `P` keeps `headUp` and the `grip*` entries; `helmetR` stays because other measurements are expressed in it.

- [ ] **Step 1: Write the failing test**

`test/crew-look.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync('src/agents/astronauts.js', 'utf8')

/**
 * The spacesuit was six separate instanced meshes. Asserting on the source rather than on a
 * constructed scene because the class needs a GL context and a loaded glb; what matters here
 * is that no part of the suit is built or written any more, and a stale `setPart` call for a
 * part that no longer exists is a runtime crash rather than a wrong pixel.
 */
const GONE = ['helmet', 'visor', 'pack', 'antenna', 'tip', 'lamp']

for (const name of GONE) {
  test(`no spacesuit part named ${name} is built`, () => {
    assert.doesNotMatch(SRC, new RegExp(`parts\\.${name}\\s*=`), `parts.${name} is still built`)
  })

  test(`no spacesuit part named ${name} is written per frame`, () => {
    assert.doesNotMatch(SRC, new RegExp(`setPart\\([^)]*\\b${name}\\b`), `${name} is still written`)
  })
}

test('the face survives, because it carries the eye colour', () => {
  assert.match(SRC, /parts\.face\s*=/, 'parts.face was removed')
  assert.match(SRC, /setPart\([^)]*\bface\b/, 'the face is no longer written')
})

test('the tools and props survive', () => {
  for (const keep of ['hammer', 'cabinet', 'box']) {
    assert.match(SRC, new RegExp(`parts\\.${keep}\\s*=`), `parts.${keep} was removed`)
  }
})

test('the status precedence and the look table are untouched', () => {
  const colony = readFileSync('src/game/colony.js', 'utf8')
  assert.match(colony, /STATUS_ORDER = \['blocked', 'waiting', 'working', 'celebrating', 'idle', 'sleeping'\]/)
  for (const key of ['working', 'waiting', 'blocked', 'celebrating', 'idle', 'sleeping', 'spawning', 'leaving']) {
    assert.match(SRC, new RegExp(`^\\s*${key}: \\{`, 'm'), `AGENT_LOOK lost its ${key} key`)
  }
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/crew-look.test.mjs`
Expected: FAIL — twelve of the assertions fail, one built-and-one-written per removed part.

- [ ] **Step 3: Remove the six parts**

In `_buildMeshes`, delete the blocks that build `parts.helmet`, `parts.visor`, `parts.pack`, `parts.antenna`, `parts.tip` and `parts.lamp`, together with the `glowMat` they shared if nothing else uses it. Delete their `setPart` lines from the per-frame write. The `chestSlot` block becomes empty for now — leave the `attachMatrixAt` call out rather than calling it for nothing; Task 4 puts the bands there and will add it back.

Prune `P`: `packZ`, `packUp`, `antX`, `antY`, `antZ`, `tipX`, `tipY`, `lightZ`, `lightY` all go. **Keep `helmetR`** — its own comment says everything worn is measured off it, and Tasks 2-4 still measure against it. Rename nothing in this task.

Check `dispose()` and `onSettingsChanged` — if either names the removed meshes individually rather than iterating the registry, fix it to iterate, because Tasks 2-4 add parts and a hand-written list would leak them.

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/crew-look.test.mjs`
Expected: PASS — 15 tests.

- [ ] **Step 5: Run the suite and look at it**

```bash
npm test
PORT=5280 npm run dev
```

Expected: 133 tests passing, 0 failing. On screen: figures with no headgear and a face floating where the helmet's front used to be, no backpack, no antenna, nothing glowing at night. **That is the expected state at this point.** Confirm it is *that* and not something worse — no missing bodies, no console errors, and the hammer still in the right hand of a working thread.

Stop the server and verify with `netstat -ano | grep 5280` that nothing is listening. Paste the empty output in your report.

- [ ] **Step 6: Commit**

```bash
git add src/agents/astronauts.js test/crew-look.test.mjs
git commit -m "feat: take the spacesuit off the crew"
```

---

### Task 2: Give them a head, and a skin tone

**Files:**
- Modify: `src/agents/crew.js` — `DROP_MESHES`, and expose the head geometry in the rig
- Modify: `src/agents/astronauts.js` — `_buildMeshes`, the per-frame head-slot write, and the colour write
- Test: `test/crew-look.test.mjs` (extend)

**Interfaces:**
- Consumes: Task 1's pruned registry.
- Produces:
  - `crewRig()` gains `headGeometry` — the head mesh baked into the **head bone's own local frame**, so it can be placed rigidly.
  - `parts.head` — an instanced mesh at the head slot, with `instanceColor` carrying the skin tone.
  - From `src/agents/skin.js`, all three: `SKIN_TONES` — a frozen array of hex numbers; `skinToneIndexFor(id)` → an integer index into it, stable for a given id; and `skinToneFor(id)` → the corresponding `THREE.Color`, cached. Task 3's tests use `SKIN_TONES` and `skinToneIndexFor` too.

- [ ] **Step 1: Write the failing test**

Add to `test/crew-look.test.mjs`:

```javascript
import { SKIN_TONES, skinToneIndexFor } from '../src/agents/skin.js'

test('there are several skin tones and they are all distinct', () => {
  assert.ok(SKIN_TONES.length >= 4, `only ${SKIN_TONES.length} tones`)
  assert.equal(new Set(SKIN_TONES).size, SKIN_TONES.length, 'duplicate tones')
})

test('a thread always gets the same skin tone', () => {
  const id = 'claude-code:6b17e5c7-1d06-490c-a8fe-9899fee895fa'
  assert.equal(skinToneIndexFor(id), skinToneIndexFor(id))
})

test('every index is inside the table', () => {
  for (const id of ['a', 'bb', 'ccc', '', 'claude-code:x', 'codex:y', '💡']) {
    const i = skinToneIndexFor(id)
    assert.ok(Number.isInteger(i), `${JSON.stringify(id)} gave ${i}`)
    assert.ok(i >= 0 && i < SKIN_TONES.length, `${JSON.stringify(id)} gave ${i}`)
  }
})

test('the tones spread across the table rather than clustering on one', () => {
  // A hash that collapses would give every crew member the same face. 200 ids should touch
  // every tone at least once.
  const seen = new Set()
  for (let n = 0; n < 200; n++) seen.add(skinToneIndexFor(`claude-code:thread-${n}`))
  assert.equal(seen.size, SKIN_TONES.length, `only hit ${seen.size} of ${SKIN_TONES.length}`)
})

test('skin.js cannot reach anything that knows a status', () => {
  // Asserted structurally rather than by hunting for the word "status" in the file: a word
  // hunt fires on the very comment that explains the contract, and a module that cannot
  // import status cannot depend on it whatever its comments say. Only three and hashString.
  const src = readFileSync('src/agents/skin.js', 'utf8')
  const imports = [...src.matchAll(/^import .*? from '([^']+)'/gm)].map((m) => m[1])
  const allowed = new Set(['three', '../world/plots.js'])
  for (const spec of imports) {
    assert.ok(allowed.has(spec), `skin.js imports ${spec}, which is not on its allowlist`)
  }
})

test('the head is built and written, and carries its own colour', () => {
  assert.match(SRC, /parts\.head\s*=/, 'parts.head is not built')
  assert.match(SRC, /setPart\([^)]*\bhead\b/, 'the head is not written per frame')
  assert.match(SRC, /head\.setColorAt/, 'the head never gets a skin tone')
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/crew-look.test.mjs`
Expected: FAIL — cannot find module `../src/agents/skin.js`.

- [ ] **Step 3: Write the skin-tone table**

Create `src/agents/skin.js`:

```javascript
import * as THREE from 'three'
import { hashString } from '../world/plots.js'

/**
 * Skin tones for the crew, and the rule that picks one.
 *
 * A crew member's tone says *who it is*, never *what it is doing* — it is how you tell one
 * figure from another on a plot, in the same way a plot's accent colour tells you which repo
 * you are looking at. So it is a pure function of the thread id and nothing else. This
 * module deliberately imports nothing that knows about status, and a test asserts it.
 *
 * Six tones, spread rather than shaded from one, because at the height a crew member
 * occupies on screen a subtle gradient reads as one colour.
 */
export const SKIN_TONES = Object.freeze([
  0xf3d0b6, 0xe4b191, 0xc98e64, 0xa26b44, 0x76492d, 0x4a2e1d,
])

/** Which tone a thread wears. Stable for a given id, and never anything else's business. */
export function skinToneIndexFor(id) {
  return hashString(String(id)) % SKIN_TONES.length
}

const cache = new Map()

/** The tone itself, as a THREE.Color. Cached, because this is read per agent per frame. */
export function skinToneFor(id) {
  const key = skinToneIndexFor(id)
  let colour = cache.get(key)
  if (!colour) {
    colour = new THREE.Color(SKIN_TONES[key])
    cache.set(key, colour)
  }
  return colour
}
```

- [ ] **Step 4: Run the skin tests**

Run: `node --test test/crew-look.test.mjs`
Expected: the five skin tests PASS; the head test still fails.

If "the tones spread" fails, the problem is `hashString` clustering on this id shape, not the table — report the distribution you measured rather than widening the assertion.

- [ ] **Step 5: Bake the head into the bone's own frame**

In `src/agents/crew.js`, take `'Mannequin_Medium_Head'` off `DROP_MESHES` and instead keep it aside: bake it into the **head bone's local frame** so it can be placed rigidly on that bone.

The head is rigid — all 959 of its vertices are weighted to the single `head` bone, verified against `crew.glb` — so this is exact, not an approximation. `mergeBody` already applies the same class of transform when it bakes the body, and `bakeClips` computes `world * bindMatrixInverse * bone * bindMatrix` as "the whole of three's skinning"; the head needs the inverse of its rest-pose bone transform applied once, so that placing it at the bone reproduces the rest pose. Expose the result as `headGeometry` on the object `crewRig()` returns.

Verify it numerically before moving on: with the rig at rest, the transformed head's bounding-box centre must land within a hair of where the un-transformed head sat in the body. State both boxes in your report.

- [ ] **Step 6: Build and write the head**

In `astronauts.js`, add `parts.head` — an instanced mesh over `rig.headGeometry` with a `MeshStandardMaterial` at roughness around 0.7, no metalness, `vertexColors` off, and `instanceColor` allocated so each agent's tone can be written.

Write it in the head-slot block, at the same offset the helmet used:

```javascript
setPart(child, worn, head, i, 0, P.headUp, 0, 0, 0, 0)
```

Set the tone where the other per-agent colours are written — beside `face.setColorAt(i, agent.eye)` — guarded by the same `colorDirty`/`index !== i` gate those use, and remember `instanceColor.needsUpdate`. The agent's thread id is the key: `skinToneFor(agent.id)`.

- [ ] **Step 7: Run the suite and look at it**

```bash
npm test
PORT=5280 npm run dev
```

Expected: 139 tests passing, 0 failing. On screen: heads on bodies, several visibly different skin tones across the colony, the face still on the front of each head, and the same tone on the same thread after a reload. Reload once and confirm a given crew member's tone did not change.

Stop the server; verify port 5280 is free and paste the output.

- [ ] **Step 8: Commit**

```bash
git add src/agents/skin.js src/agents/crew.js src/agents/astronauts.js test/crew-look.test.mjs
git commit -m "feat: the crew have heads, and their own skin tones"
```

---

### Task 3: Hairstyles

**Files:**
- Create: `src/agents/hair.js`
- Modify: `src/agents/astronauts.js` — `_buildMeshes`, the head-slot write, `dispose`, `onSettingsChanged`
- Test: `test/crew-look.test.mjs` (extend)

**Interfaces:**
- Consumes: `P.helmetR` for scale, `this.headSlot`, `setPart`, and the hammer's own-counter pattern.
- Produces:
  - `HAIR_STYLES` — an array of `{ name, geometry(R) }`, where `geometry(R)` returns a `THREE.BufferGeometry` sized against the head radius `R`.
  - `hairStyleIndexFor(id)` → an integer index into `HAIR_STYLES`, stable per id. One style is bald, and bald builds no geometry at all.

- [ ] **Step 1: Write the failing test**

```javascript
import { HAIR_STYLES, hairStyleIndexFor, BALD } from '../src/agents/hair.js'

test('there are three or four styles and one of them is bald', () => {
  assert.ok(HAIR_STYLES.length >= 3 && HAIR_STYLES.length <= 4, `${HAIR_STYLES.length} styles`)
  assert.ok(HAIR_STYLES.some((s) => s.name === BALD), `no style named ${BALD}`)
})

test('bald builds nothing, every other style builds geometry', () => {
  for (const style of HAIR_STYLES) {
    const geo = style.geometry(0.48)
    if (style.name === BALD) {
      assert.equal(geo, null, 'bald should build no geometry')
      continue
    }
    assert.ok(geo, `${style.name} built nothing`)
    assert.ok(geo.attributes.position.count > 0, `${style.name} has no vertices`)
    geo.computeBoundingBox()
    // Read the extent off the box directly rather than through a Vector3, so this test does
    // not need a three.js import of its own.
    const height = geo.boundingBox.max.y - geo.boundingBox.min.y
    assert.ok(height > 0 && height < 0.48 * 3, `${style.name} is ${height} tall against R 0.48`)
    geo.dispose()
  }
})

test('a thread always gets the same hairstyle', () => {
  const id = 'claude-code:6b17e5c7-1d06-490c-a8fe-9899fee895fa'
  assert.equal(hairStyleIndexFor(id), hairStyleIndexFor(id))
})

test('every hair index is inside the table', () => {
  for (const id of ['a', 'bb', '', 'claude-code:x', '💡']) {
    const i = hairStyleIndexFor(id)
    assert.ok(Number.isInteger(i) && i >= 0 && i < HAIR_STYLES.length, `${JSON.stringify(id)} gave ${i}`)
  }
})

test('hairstyle and skin tone are independent', () => {
  // Both hash the same id. If they used the same modulus in the same way, tone and style
  // would move together and the crew would come in matched pairs instead of looking varied.
  const pairs = new Set()
  for (let n = 0; n < 200; n++) {
    const id = `claude-code:thread-${n}`
    pairs.add(`${skinToneIndexFor(id)}:${hairStyleIndexFor(id)}`)
  }
  assert.ok(pairs.size > SKIN_TONES.length, `only ${pairs.size} distinct combinations`)
})

test('hair.js cannot reach anything that knows a status', () => {
  // Structural for the same reason skin.js's equivalent is: a module that cannot import
  // status cannot depend on it, and a word hunt would fire on the comment explaining that.
  const src = readFileSync('src/agents/hair.js', 'utf8')
  const imports = [...src.matchAll(/^import .*? from '([^']+)'/gm)].map((m) => m[1])
  const allowed = new Set(['three', '../world/plots.js'])
  for (const spec of imports) {
    assert.ok(allowed.has(spec), `hair.js imports ${spec}, which is not on its allowlist`)
  }
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/crew-look.test.mjs`
Expected: FAIL — cannot find module `../src/agents/hair.js`.

- [ ] **Step 3: Write the styles**

Create `src/agents/hair.js`. Four styles: `bald`, `short`, `long`, `bun`. Build each from primitives sized against the head radius `R` — a sphere cap sitting on the crown for `short`, the same with a longer skirt behind for `long`, `short` plus a small sphere above and behind for `bun`. Nothing here is a work of art: at the height a crew member occupies on screen a silhouette is all that reads, and this is the same technique the helmet used.

`hairStyleIndexFor` must not reuse `skinToneIndexFor`'s hash the same way, or tone and style will move together — the test above catches that. Hash a salted string, e.g. `hashString('hair:' + id)`.

Export `BALD` as the style name so the test and the renderer agree on the sentinel rather than both writing the string.

- [ ] **Step 4: Run the hair tests**

Run: `node --test test/crew-look.test.mjs`
Expected: PASS.

- [ ] **Step 5: Build one instanced mesh per style, and write them**

Every non-bald style gets its own instanced mesh, exactly as the delivery cars get one pair per accent — a merged geometry carries one material, and these are separate geometries. Each needs **its own counter**, the way the hammer uses `hands++`, because a style's mesh is packed only with the agents wearing it and an unused slot in the middle still draws.

Per frame, in the head-slot block, after the head: look up the agent's style; if it is bald, write nothing; otherwise `setPart` into that style's mesh at that style's own counter. At the end of the pass set every style mesh's `count` — **including zero for styles nobody is wearing this frame**, which is the same trap the cars had.

Hair colour: keep it out of scope. One dark tone for all styles is enough at this distance, and a second per-agent colour is a separate decision.

- [ ] **Step 6: Run the suite and look at it**

```bash
npm test
PORT=5280 npm run dev
```

Expected: 145 tests passing, 0 failing. On screen: visibly different hair across the colony, no hair floating off a head, and a given crew member keeping its style across a reload. Check a walking crew member specifically — hair rides the head bone, so it must move with the head rather than lag or swim.

Stop the server; verify port 5280 is free and paste the output.

- [ ] **Step 7: Commit**

```bash
git add src/agents/hair.js src/agents/astronauts.js test/crew-look.test.mjs
git commit -m "feat: the crew have hairstyles"
```

---

### Task 4: Hi-vis bands, and the errored pulse

The band replaces three things at once: the trim colour's most visible surface, the night glow that the antenna tip and chest lamp used to carry, and the "orange beacon stutters" the behaviour table promises for an errored thread. That third one is easy to drop by accident, and it is the one that matters most — a pulse is what catches the eye across a colony, and an `!` badge cannot do it alone at that distance.

**Files:**
- Modify: `src/agents/astronauts.js` — `_buildMeshes`, `P`, the chest-slot write, the colour write
- Test: `test/crew-look.test.mjs` (extend)

**Interfaces:**
- Consumes: `this.chestSlot`, `setPart`, `AGENT_LOOK`'s trim colours (read-only).
- Produces: `parts.bands`, and `bandPulse(elapsed, errored)` exported from **`src/agents/band-pulse.js`** → a multiplier in `[0, 1]`, constant when not errored and oscillating when it is. It gets its own module rather than living in `astronauts.js` because `astronauts.js` imports `crew.js`, which reads `import.meta.env.BASE_URL` at module scope and therefore cannot be imported under `node --test` — the same reason `src/game/growth.js` and `src/world/drive-path.js` exist.

- [ ] **Step 1: Write the failing test**

```javascript
import { bandPulse } from '../src/agents/band-pulse.js'
```

```javascript
test('a calm band holds steady', () => {
  const a = bandPulse(0, false)
  const b = bandPulse(1.7, false)
  const c = bandPulse(9.3, false)
  assert.equal(a, b)
  assert.equal(b, c)
  assert.ok(a > 0, 'a calm band is not invisible')
})

test('an errored band actually moves', () => {
  const samples = []
  for (let t = 0; t < 2; t += 0.05) samples.push(bandPulse(t, true))
  const min = Math.min(...samples)
  const max = Math.max(...samples)
  assert.ok(max - min > 0.3, `pulse only spans ${(max - min).toFixed(3)} — invisible at distance`)
})

test('the pulse never goes dark and never blows out', () => {
  for (let t = 0; t < 10; t += 0.017) {
    for (const errored of [true, false]) {
      const v = bandPulse(t, errored)
      assert.ok(v >= 0 && v <= 1, `bandPulse(${t}, ${errored}) = ${v}`)
    }
  }
})

test('an errored band is never fully off, so the figure never disappears', () => {
  let min = Infinity
  for (let t = 0; t < 10; t += 0.017) min = Math.min(min, bandPulse(t, true))
  assert.ok(min > 0.15, `dips to ${min.toFixed(3)} — reads as a flicker, not a beacon`)
})

test('the bands are built and written', () => {
  assert.match(SRC, /parts\.bands\s*=/, 'parts.bands is not built')
  assert.match(SRC, /setPart\([^)]*\bbands\b/, 'the bands are not written per frame')
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/crew-look.test.mjs`
Expected: FAIL — cannot find module `../src/agents/band-pulse.js`.

- [ ] **Step 3: Write the pulse**

Create `src/agents/band-pulse.js`:

```javascript
/**
 * How bright a crew member's hi-vis bands are, as a multiplier.
 *
 * The bands inherited the "orange beacon stutters" the behaviour table promises for an
 * errored thread — that beacon was the antenna tip and the chest lamp, which Stage 3
 * removed. A pulse is what carries across a colony; an `!` badge cannot, at the height a
 * crew member occupies on screen.
 *
 * Never reaches zero. A band that switches fully off reads as a rendering fault or as a
 * figure that vanished, which is the opposite of drawing attention to it.
 */
const CALM = 0.72
const PULSE_HZ = 1.6
const PULSE_LOW = 0.34
const PULSE_HIGH = 1

export function bandPulse(elapsed, errored) {
  if (!errored) return CALM
  // A cosine rather than a square wave: the stutter should read as a beacon turning, not as
  // a strobe, and a hard edge at this size just looks like dropped frames.
  const wave = 0.5 - 0.5 * Math.cos(elapsed * PULSE_HZ * Math.PI * 2)
  return PULSE_LOW + (PULSE_HIGH - PULSE_LOW) * wave
}
```

- [ ] **Step 4: Run the pulse tests**

Run: `node --test test/crew-look.test.mjs`
Expected: the four pulse tests PASS; the built-and-written test still fails.

- [ ] **Step 5: Build and write the bands**

Two bands round the torso: build them as a single geometry of two thin rings (or two flattened tori) sized off `P.helmetR`, added to `P` as `bandY`, `bandR` and `bandThickness` with the numbers you settle on. One instanced mesh, at the chest slot — restore the `attachMatrixAt(rig, agent.frame, this.chestSlot, bone)` call Task 1 removed:

```javascript
attachMatrixAt(rig, agent.frame, this.chestSlot, bone)
worn.multiplyMatrices(root, bone)
setPart(child, worn, bands, i, 0, P.bandY, 0, 0, 0, 0)
```

The colour is the agent's trim from `AGENT_LOOK`, multiplied by `bandPulse(elapsed, agent.status === 'blocked')` and pushed past 1.0 so the bloom pass catches it — the antenna tip and lamp did exactly this, so copy how they were written rather than inventing a scheme. `setColorAt` per agent plus `instanceColor.needsUpdate`, under the same gate the other per-agent colours use. **Note the pulse means this colour changes every frame for an errored agent**, so it cannot sit behind a `colorDirty` gate that only fires on status change — work out where it has to go and say so in your report.

- [ ] **Step 6: Verify the bloom — this is the stage's one open risk**

The spec flags it: `engine.js` keeps the bloom threshold high on purpose, its own comment saying a high threshold "keeps this an accent rather than a haze: only the eyes". Two small bright spheres cleared that easily. A band is a different shape and may be a few pixels at colony zoom.

Check it properly:

```bash
PORT=5280 npm run dev
```

Open it in a **real browser** — the Browser pane does not drive `requestAnimationFrame`, so the scene freezes there. Press `L` to move time of day to night, zoom out to the distance the colony is normally watched at, and look for the bands. Then find an errored thread — force one if none exists, and say that you forced it — and confirm the pulse is visible at that distance.

**If the bands do not read at night:** widen them, or add a small bright detail on the vest. Do not add a headlamp; this stage removes headgear. Report what you tried and what you measured.

- [ ] **Step 7: Run the suite**

```bash
npm test
npm run build
```

Expected: 150 tests passing, 0 failing; build succeeds.

Stop the server; verify port 5280 is free and paste the output.

- [ ] **Step 8: Commit**

```bash
git add src/agents/band-pulse.js src/agents/astronauts.js test/crew-look.test.mjs
git commit -m "feat: hi-vis bands carry the trim, the night glow and the errored pulse"
```

---

### Task 5: The documents

**Files:**
- Modify: `README.md`
- Modify: `docs/superpowers/specs/2026-09-09-moving-in-theme-design.md`
- Modify: `src/agents/crew.js` — the stale header comment

**Interfaces:** none. Text only.

- [ ] **Step 1: Describe the crew in the README**

They have no headgear, their own hairstyle and skin tone, and hi-vis bands that carry the status colour and glow at night. Say that skin tone and hairstyle come from the thread id and never mean anything — a reader who thinks a colour might encode state will hunt for a meaning that is not there.

- [ ] **Step 2: Fix the stale comment that misled this plan**

`src/agents/crew.js`'s header says "See `boneMatrixAt()`". **No such function exists** — it is `attachMatrixAt(rig, frame, slot, out)` at `crew.js:275`. That stale name was copied into this stage's spec before it was caught. Correct the comment. While you are in that header, its list of things that ride a bone still says "the helmet, the visor, the backpack"; those are gone, and it is now the head, the hair and the bands.

- [ ] **Step 3: Mark Stage 3 done in the spec**

Record what it became versus what was planned, including anything the bloom verification forced. If the bands needed widening or a extra detail, that belongs in the spec as what shipped.

- [ ] **Step 4: Check no document now contradicts the code**

The previous two stages produced five findings between them that were all documentation asserting the opposite of the code. Grep for the words this stage retires and confirm every hit is either inside a Stage 3 passage describing what was removed, or genuinely still true:

```bash
grep -rniE "helmet|visor|backpack|antenna|beacon|chest lamp|spacesuit" README.md docs/ src/ --include=*.md --include=*.js | grep -v node_modules
```

- [ ] **Step 5: Full verification**

```bash
npm test
npm run build
```

Expected: all tests passing, build succeeds. `git diff -- server/` must be empty for the whole stage.

- [ ] **Step 6: Commit**

```bash
git add README.md docs/superpowers/specs src/agents/crew.js
git commit -m "docs: describe the crew, and fix the comment that named a missing function"
```

---

## Done when

- `npm test` passes at the 118-test baseline plus the tests added here, and `npm run build` succeeds.
- No helmet, visor, backpack, antenna, glowing tip or chest lamp exists anywhere — built or written.
- Crew members have heads with **visibly different skin tones**, and **visibly different hairstyles**, both stable across a reload and both independent of status.
- The face is still on the head and the **eye colour still carries status**.
- Hi-vis bands carry the trim colour, are visible at night at colony zoom, and **pulse for an errored thread**.
- `STATUS_ORDER` and `AGENT_LOOK`'s keys are unchanged; `idle` and `sleeping` carry no badge; a badge-carrying or standing-still crew member is still never hidden.
- `git diff -- server/` is empty.
- No document claims a part that no longer exists.
