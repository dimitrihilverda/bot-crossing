# Moving-In Crossing Stage 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Re-theme the colony so it reads as Moving-In end to end — houses on the hex plots, crew members carrying the right badges, furniture accumulating as a thread grows — while clicking a crew member still opens its thread in whichever harness it came from.

**Architecture:** The existing structure is kept and its meaning moved. Two new KayKit kits are registered alongside the two already loaded, a house becomes a **two-mesh group** (shell from the city atlas, contents from the furniture atlas) because a geometry can only carry one material, and thread progress stops sinking a building into the ground and starts revealing furniture pieces instead.

**Tech Stack:** Vite 7, three.js 0.185, `@gltf-transform` for the asset pipeline, `node --test` for tests. No new dependencies.

**Spec:** `docs/superpowers/specs/2026-09-09-moving-in-theme-design.md`

## Global Constraints

- Node >= 22.13. UI language stays **English** so upstream merges stay clean.
- The 33 existing tests in `test/` must stay green after every task. They cover harness scanning and state merging and are the safety net proving the re-theme did not change how threads are read.
- Runs on **port 5280** via `PORT`. 5274 is the shared install's owner UI, and 5275 / 5276 are Dimitri's guest API and UDP discovery — so the theme has to stay clear of all three.
- `upstream` remote points at `Station-Sciences/bot-crossing`; work happens on branch `moving-in-theme`.
- Art is CC0 by Kay Lousberg. Raw packs are **never** committed — only the built `.glb`. `public/assets/CREDITS.md` must list every pack used.
- One thread is only ever doing one thing: `STATUS_ORDER` in `src/game/colony.js:51` stays the single strict precedence. Do not add parallel status flags.
- Only states that want something from the user get a badge. Do not give `idle` or `sleeping` a badge.

---

### Task 0: Obtain the source packs (human step)

This task is **not** code. Nothing after it can run without it.

**`assets-src/` does not exist on a fresh clone** — it is git-ignored and the repo ships only the built `.glb` files. So all three packs below have to be downloaded, including the Character Animations one: the checked-in `crew.glb` holds only the 14 clips the original colony plays, and Task 7 needs clips that are not in it.

Extract each archive into `C:\PhpstormProjects\moving-in-crossing\assets-src\`, keeping whatever folder name the archive itself uses. All three are name-your-own-price with a free tier — enter 0. Take the archive that contains a `gltf/` directory.

| Pack | URL | Needed by |
| --- | --- | --- |
| KayKit Furniture Bits | https://kaylousberg.itch.io/furniture-bits | Task 1, 4, 7 |
| KayKit City Builder Bits | https://kaylousberg.itch.io/city-builder-bits | Task 1, 4, 6 |
| KayKit Character Animations | https://kaylousberg.itch.io/kaykit-character-animations | Task 7 |

- [ ] **Step 1: Confirm all three packs are present and contain gltf**

```bash
ls assets-src/
find assets-src -name '*.gltf' | sed 's|/[^/]*$||' | sort -u
```

Expected: three directories, and one `gltf` directory listed per pack. Note the **exact** path to each — Kay's archives vary in how deeply they nest it (the two already wired up sit at `<pack>/Assets/gltf`, the animations at `<pack>/Animations/gltf/Rig_Medium`), and Tasks 1 and 7 need the real ones.

- [ ] **Step 2: Record the paths**

Replace the `Extract to` column above with the real gltf directory paths on disk, so the next task reads truth rather than a guess.

```bash
git add docs/superpowers/plans/2026-09-09-moving-in-theme-stage-1.md
git commit -m "docs: record the real source pack paths"
```

---

### Task 1: Build the two new kits, and a tool to see inside them

**Files:**
- Create: `tools/list-parts.mjs`
- Modify: `tools/build-assets.mjs` (the `STEPS` array)
- Modify: `public/assets/CREDITS.md`
- Test: `test/assets.test.mjs`

**Interfaces:**
- Consumes: the pack paths recorded in Task 0.
- Produces: `public/assets/furniture.glb` and `public/assets/city.glb`. `tools/list-parts.mjs <glb> [filter]` prints one node name per line — **every later task that needs a model name gets it from this tool, not from memory.**

- [ ] **Step 1: Write the failing test**

`test/assets.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { NodeIO } from '@gltf-transform/core'

/**
 * The built glbs are checked in, so this runs on a fresh clone with no source packs.
 * It asserts the pipeline's contract rather than any particular model: one shared
 * material per kit, which is what lets a kit collapse to one draw call.
 */
for (const name of ['furniture', 'city']) {
  test(`${name}.glb exists and shares a single material`, async () => {
    const file = `public/assets/${name}.glb`
    assert.ok(existsSync(file), `${file} is missing — run npm run assets`)

    const doc = await new NodeIO().read(file)
    const materials = doc.getRoot().listMaterials()
    assert.equal(materials.length, 1, `${name}.glb must have exactly one material`)

    const meshes = doc.getRoot().listMeshes()
    assert.ok(meshes.length > 10, `${name}.glb has only ${meshes.length} meshes`)
  })
}
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/assets.test.mjs`
Expected: FAIL — `public/assets/furniture.glb is missing`.

- [ ] **Step 3: Write the part-listing tool**

`tools/list-parts.mjs`:

```javascript
/**
 * Prints every node name in a built kit, one per line.
 *
 * The recipes in src/world/houses.js address parts by their KayKit node name, and those
 * names are only knowable by looking. This is that look.
 *
 * Usage: node tools/list-parts.mjs public/assets/city.glb [filter]
 */
import { NodeIO } from '@gltf-transform/core'

const [file, filter] = process.argv.slice(2)
if (!file) {
  console.error('usage: list-parts.mjs <glb> [substring filter]')
  process.exit(1)
}

const doc = await new NodeIO().read(file)
const names = doc
  .getRoot()
  .listNodes()
  .map((n) => n.getName())
  .filter((n) => n && (!filter || n.toLowerCase().includes(filter.toLowerCase())))
  .sort()

for (const name of names) console.log(name)
console.error(`${names.length} nodes`)
```

- [ ] **Step 4: Add both packs to the asset build**

In `tools/build-assets.mjs`, add two entries to `STEPS`, using the **real paths recorded in Task 0**:

```javascript
const STEPS = [
  ['tools/build-kit.mjs', 'assets-src/KayKit_Space_Base_Bits_1.0_FREE/Assets/gltf', 'public/assets/spacebase.glb'],
  ['tools/build-kit.mjs', 'assets-src/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf', 'public/assets/forest.glb', FOREST.join(',')],
  ['tools/build-kit.mjs', 'assets-src/KayKit_City_Builder_Bits/Assets/gltf', 'public/assets/city.glb'],
  ['tools/build-kit.mjs', 'assets-src/KayKit_Furniture_Bits/Assets/gltf', 'public/assets/furniture.glb'],
  ['tools/build-crew.mjs'],
]
```

Pack everything at first — no model filter. Trimming the list is a later optimisation, and doing it now means guessing which models the recipes will want.

- [ ] **Step 5: Build and inspect**

```bash
npm run assets
node tools/list-parts.mjs public/assets/city.glb > city-parts.txt
node tools/list-parts.mjs public/assets/furniture.glb > furniture-parts.txt
wc -l city-parts.txt furniture-parts.txt
```

Expected: both glbs written, both lists non-empty. **Keep these two files** — Tasks 2, 4 and 6 read them. Delete them before the final commit of Task 8; they are working notes, not source.

- [ ] **Step 6: Run the test to verify it passes**

Run: `node --test test/assets.test.mjs`
Expected: PASS, both kits.

If `materials.length` is not 1, the pack ships more than one atlas. **Stop and report it** rather than working around it: the one-draw-call design assumes a single atlas per kit, and that assumption failing is a design question.

- [ ] **Step 7: Credit the packs**

Add two rows to the table in `public/assets/CREDITS.md`:

```markdown
| `city.glb` | [KayKit : City Builder Bits](https://kaylousberg.itch.io/city-builder-bits) | CC0 1.0 |
| `furniture.glb` | [KayKit : Furniture Bits](https://kaylousberg.itch.io/furniture-bits) | CC0 1.0 |
```

- [ ] **Step 8: Run the whole suite**

Run: `npm test`
Expected: PASS — 35 tests (33 existing + 2 new).

- [ ] **Step 9: Commit**

```bash
git add tools/list-parts.mjs tools/build-assets.mjs test/assets.test.mjs public/assets/CREDITS.md public/assets/city.glb public/assets/furniture.glb
git commit -m "feat: build the city and furniture kits"
```

---

### Task 2: Register the kits, and find the accent swatch in each atlas

This is the risk the spec named. Each repo gets its own colour because the fragment shader repaints **one** atlas cell — `CELL.TRIM`, cell 11 of the 8x4 Space Base atlas, masked by `ACCENT_MASK` at `src/world/buildings.js:84`. Which cell plays that role in the two new atlases is unknown until looked at.

**Files:**
- Create: `tools/atlas-cells.mjs`
- Modify: `src/world/kit.js` (the `KITS` table, and new `CELL_CITY` / `CELL_FURNITURE` exports)
- Test: `test/atlas.test.mjs`

**Interfaces:**
- Consumes: `public/assets/city.glb`, `public/assets/furniture.glb` from Task 1.
- Produces: `CELL_CITY` and `CELL_FURNITURE`, each an object with an `ACCENT` key holding an integer cell index in `0..31`. `KITS` gains `city` and `furniture`, so `part(name, 'city')` and `atlasTexture('furniture')` work. Task 4 uses all of these.

- [ ] **Step 1: Write the atlas inspector**

`tools/atlas-cells.mjs`:

```javascript
/**
 * Prints the colour of each cell in a kit's 8x4 gradient atlas.
 *
 * The accent trick needs one cell that reads as "this building's colour" — a saturated
 * trim swatch rather than a structural one. Eyeballing a 1024px texture does not tell you
 * a cell *index*, and the index is what the shader mask wants.
 *
 * Usage: node tools/atlas-cells.mjs public/assets/city.glb
 */
import { NodeIO } from '@gltf-transform/core'
import sharp from 'sharp'

const [file] = process.argv.slice(2)
if (!file) {
  console.error('usage: atlas-cells.mjs <glb>')
  process.exit(1)
}

const doc = await new NodeIO().read(file)
const texture = doc.getRoot().listTextures()[0]
if (!texture) throw new Error(`${file}: no texture`)

const COLS = 8
const ROWS = 4
const img = sharp(Buffer.from(texture.getImage()))
const { width, height } = await img.metadata()
const raw = await img.ensureAlpha().raw().toBuffer()

const cellW = Math.floor(width / COLS)
const cellH = Math.floor(height / ROWS)

for (let row = 0; row < ROWS; row++) {
  for (let col = 0; col < COLS; col++) {
    // The middle of the cell: every swatch is a gradient, and the edges are exactly
    // where one swatch bleeds into the next.
    const x = col * cellW + Math.floor(cellW / 2)
    const y = row * cellH + Math.floor(cellH / 2)
    const i = (y * width + x) * 4
    const [r, g, b] = [raw[i], raw[i + 1], raw[i + 2]]
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const sat = max === 0 ? '0.00' : ((max - min) / max).toFixed(2)
    const hex = [r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')
    console.log(`cell ${String(row * COLS + col).padStart(2)}  #${hex}  sat ${sat}`)
  }
}
```

`sharp` is already installed as a transitive dependency of `@gltf-transform/functions`, so this adds nothing to `package.json`.

- [ ] **Step 2: Run it on both kits and pick the accent cells**

```bash
node tools/atlas-cells.mjs public/assets/city.glb
node tools/atlas-cells.mjs public/assets/furniture.glb
```

For each kit, pick the cell with the highest saturation that is **not** an obvious special case — not pure red, not pure green, which are usually signage or foliage. Write down both indices; step 5 needs them.

- [ ] **Step 3: Write the failing test**

`test/atlas.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The accent cell indices are hand-picked from the atlases and easy to break by accident.
 * A cell outside 0..31 silently masks nothing, which shows up as "no repo has a colour"
 * rather than as an error — so assert the range rather than trusting the eye.
 */
test('accent cells are inside the 8x4 atlas', () => {
  const src = readFileSync('src/world/kit.js', 'utf8')
  for (const name of ['CELL_CITY', 'CELL_FURNITURE']) {
    const match = src.match(new RegExp(`${name}\\s*=\\s*\\{[^}]*ACCENT:\\s*(\\d+)`))
    assert.ok(match, `${name}.ACCENT is not defined in src/world/kit.js`)
    const cell = Number(match[1])
    assert.ok(cell >= 0 && cell < 32, `${name}.ACCENT = ${cell} is outside 0..31`)
  }
})

test('the city and furniture kits are registered', () => {
  const src = readFileSync('src/world/kit.js', 'utf8')
  assert.match(src, /city:\s*\{\s*file:\s*'city\.glb'/, 'city kit is not in KITS')
  assert.match(src, /furniture:\s*\{\s*file:\s*'furniture\.glb'/, 'furniture kit is not in KITS')
})
```

- [ ] **Step 4: Run it to make sure it fails**

Run: `node --test test/atlas.test.mjs`
Expected: FAIL — `CELL_CITY.ACCENT is not defined in src/world/kit.js`.

- [ ] **Step 5: Register the kits and name the cells**

In `src/world/kit.js`, extend `KITS`:

```javascript
const KITS = {
  /** Space Base Bits: the original colony's buildings, and its hard surfaces. */
  base: { file: 'spacebase.glb', parts: new Map(), solo: new Map(), atlas: null },
  /** Forest Nature Pack: trees, bushes, grass, and the boulders on every world. */
  forest: { file: 'forest.glb', parts: new Map(), solo: new Map(), atlas: null },
  /** City Builder Bits: house shells, pavement, fences, and later the vans. */
  city: { file: 'city.glb', parts: new Map(), solo: new Map(), atlas: null },
  /** Furniture Bits: everything that goes inside a house. */
  furniture: { file: 'furniture.glb', parts: new Map(), solo: new Map(), atlas: null },
}
```

And below the existing `CELL` export, add the two cell tables — substituting the indices chosen in step 2:

```javascript
/**
 * The cells worth naming in the city atlas. `ACCENT` is the swatch the shader repaints
 * per repo; it was chosen with `tools/atlas-cells.mjs` as the most saturated trim swatch
 * rather than a structural one.
 */
export const CELL_CITY = {
  ACCENT: 11,
}

/** The same, for the furniture atlas. */
export const CELL_FURNITURE = {
  ACCENT: 11,
}
```

- [ ] **Step 6: Run the tests**

Run: `npm test`
Expected: PASS — 37 tests.

- [ ] **Step 7: Commit**

```bash
git add src/world/kit.js tools/atlas-cells.mjs test/atlas.test.mjs
git commit -m "feat: register the city and furniture kits, and find their accent cells"
```

---

### Task 3: Let a recipe name its kit

`Composer.add` at `src/world/buildings.js:105` hardcodes `part(name, 'base', ...)`, so every recipe draws from the Space Base kit and nothing else. This is a prerequisite for Task 4, and it gets its own commit because it changes a shared helper without changing any behaviour — which makes it the one task a reviewer can check by seeing that nothing happened.

**Files:**
- Modify: `src/world/buildings.js:88-148` (the `Composer` class)
- Test: `test/composer.test.mjs`

**Interfaces:**
- Produces: `new Composer({ kit })` binds a registry, defaulting to `'base'`; `add(name, { kit })` overrides it per part. `new Composer()` behaves exactly as it did.

- [ ] **Step 1: Write the failing test**

`test/composer.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Composer needs three.js and a loaded glb, so it cannot be constructed under node --test.
 * What is worth locking down is the thing that breaks quietly: a recipe asking for a city
 * part and being handed the base kit's registry, which throws "no part named" only once a
 * scene is built.
 */
test('Composer resolves parts against its own kit, not a hardcoded one', () => {
  const src = readFileSync('src/world/buildings.js', 'utf8')
  assert.doesNotMatch(src, /part\(\s*name\s*,\s*'base'/, "Composer still hardcodes the 'base' kit")
  assert.match(src, /this\.kit/, 'Composer does not carry a kit')
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/composer.test.mjs`
Expected: FAIL — `Composer still hardcodes the 'base' kit`.

- [ ] **Step 3: Give Composer a kit**

In `src/world/buildings.js`, change the constructor and the first line of `add`:

```javascript
class Composer {
  /**
   * @param {object} [o]
   * @param {string} [o.kit]  which registry parts resolve against. A merged geometry can
   *   only carry one material, so one Composer means one kit.
   */
  constructor({ kit = 'base' } = {}) {
    this.parts = []
    this.kit = kit
  }

  /**
   * @param {string} name  a node name from the kit
   * @param {object} [o]   `x`/`y`/`z` offset, `ry` yaw, `s` uniform scale, `emissive` 0..1,
   *                       `kit` to override this Composer's kit for one part
   */
  add(name, o = {}) {
    const geo = part(name, o.kit ?? this.kit, { solo: o.solo })
```

Leave the rest of `add` untouched.

- [ ] **Step 4: Run the tests**

Run: `npm test`
Expected: PASS — 38 tests. The existing space-base recipes still work because the default is `'base'`.

- [ ] **Step 5: Verify nothing changed on screen**

```bash
PORT=5280 npm run dev
```

Open http://localhost:5280 and confirm the colony renders exactly as before. This task is a pure refactor; anything visibly different is a bug in it.

- [ ] **Step 6: Commit**

```bash
git add src/world/buildings.js test/composer.test.mjs
git commit -m "refactor: let a Composer recipe name its kit"
```

---

### Task 4: A house is a shell plus contents

The heart of the stage. A thread's building becomes a `THREE.Group` of two meshes: the **shell** from the city kit, always fully visible, and the **contents** from the furniture kit, revealed piece by piece as the thread grows. Two meshes rather than one because the kits have separate atlases and a geometry carries one material.

Progress therefore stops sinking anything into the ground. `uProgress` keeps its name and all its plumbing in `src/game/colony.js`, but on the contents mesh it drives a per-piece reveal instead of a vertical slide.

**Files:**
- Create: `src/world/houses.js`
- Modify: `src/world/buildings.js` (export `decorate` and `depthMaterial` for reuse)
- Modify: `src/game/colony.js:477` and its imports
- Test: `test/houses.test.mjs`

**Interfaces:**
- Consumes: `Composer` with a kit (Task 3), `CELL_CITY` / `CELL_FURNITURE` and the `city` / `furniture` registries (Task 2), the part names from Task 1 step 5.
- Produces:
  - `revealThresholds(count)` → `Float32Array` of length `count`, ascending, every value in `(0, 1]`.
  - `createHouse({ seed, accent })` → `THREE.Group` carrying `userData.setProgress(p)`, `userData.progress`, `userData.height`, `userData.footprint`, `userData.label` and **`userData.dispose()`**.

**A Group is not a Mesh, and `colony.js` currently assumes a Mesh.** At `src/game/colony.js:512-514` a retired thread is cleaned up with:

```javascript
entry.mesh.geometry.dispose()
entry.mesh.material.dispose()
entry.mesh.customDepthMaterial?.dispose()
```

A `THREE.Group` has none of those three properties, so every archived thread would throw a `TypeError` — and it would throw in the retire path, which is the one path that only runs minutes after the change looks fine. This is why `createHouse` publishes a `userData.dispose()` and step 8 rewrites those three lines to call it. Nothing else in `colony.js` touches the mesh as a Mesh: lines 492-531, 669-682 and 835-841 use only `position` and `userData`, which a Group has.

- [ ] **Step 1: Write the failing test**

`test/houses.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { revealThresholds } from '../src/world/houses.js'

test('thresholds ascend and stay inside (0, 1]', () => {
  const t = revealThresholds(6)
  assert.equal(t.length, 6)
  for (let i = 0; i < t.length; i++) {
    assert.ok(t[i] > 0, `threshold ${i} is ${t[i]}`)
    assert.ok(t[i] <= 1, `threshold ${i} is ${t[i]}`)
    if (i > 0) assert.ok(t[i] > t[i - 1], `threshold ${i} does not exceed ${i - 1}`)
  }
})

test('the first piece is there for the smallest live thread', () => {
  // threadProgress in src/game/colony.js floors at 0.05, so anything above that leaves
  // a real thread's house empty.
  const t = revealThresholds(4)
  assert.ok(t[0] <= 0.05, `first threshold ${t[0]} would leave a live thread empty`)
})

test('the last piece needs full progress', () => {
  const t = revealThresholds(4)
  assert.equal(t[3], 1)
})

test('one piece is degenerate but valid', () => {
  assert.deepEqual(Array.from(revealThresholds(1)), [1])
})

test('no pieces is not a crash', () => {
  assert.equal(revealThresholds(0).length, 0)
})
```

- [ ] **Step 2: Run it to make sure it fails**

Run: `node --test test/houses.test.mjs`
Expected: FAIL — cannot find module `../src/world/houses.js`.

- [ ] **Step 3: Write the threshold function**

Create `src/world/houses.js` containing only the pure part for now — it is the piece that is testable without a browser, so it is the piece that carries the test:

```javascript
/**
 * When each furniture piece appears, as a fraction of thread progress.
 *
 * Evenly spaced rather than weighted: progress is already a log scale over transcript size
 * (`threadProgress` in src/game/colony.js), and a second curve on top of it would compress
 * the early pieces into invisibility — which is exactly the range most real threads live in.
 *
 * The first threshold is pulled down to 0.05 because that is where `threadProgress` floors:
 * a thread that exists at all should have something in the house.
 */
export function revealThresholds(count) {
  const out = new Float32Array(count)
  for (let i = 0; i < count; i++) out[i] = (i + 1) / count
  if (count > 0) out[0] = Math.min(out[0], 0.05)
  return out
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `node --test test/houses.test.mjs`
Expected: PASS — 5 tests.

- [ ] **Step 5: Commit the tested core before touching the scene**

```bash
git add src/world/houses.js test/houses.test.mjs
git commit -m "feat: furniture reveal thresholds"
```

- [ ] **Step 6: Get the real part names**

```bash
grep -iE "house|home|building|residential|detached" city-parts.txt
grep -iE "sofa|couch|bed|table|chair|lamp|cabinet|shelf|wardrobe" furniture-parts.txt
```

Write down names that actually exist. **Do not invent names** — `part()` throws on an unknown name with the name in the message, so a wrong guess is loud, but only once the scene builds.

- [ ] **Step 7: Write the shell and contents recipes**

Append to `src/world/houses.js`, substituting the real names from step 6 for the illustrative ones below:

```javascript
import * as THREE from 'three'
import { CELL_CITY, CELL_FURNITURE, atlasTexture, cellMask } from './kit.js'
import { mulberry } from './planet.js'

/** Authored on the city pack's grid and scaled once, the way BUILDING_SCALE does for the base kit. */
const HOUSE_SCALE = 1.45

/**
 * Shell silhouettes, kept varied — detached, terrace, tall — so a plot of them reads as a
 * street rather than a row of the same box. Names must exist in the city kit.
 */
const SHELLS = [['building_A'], ['building_B'], ['building_C']]

/**
 * What goes inside, in the order it arrives. A house fills the way a real let does: the big
 * pieces first and the lamps last, so early progress is legible at the height the colony is
 * actually viewed from.
 */
const CONTENTS = [
  { name: 'sofa', x: -0.6, z: 0.4 },
  { name: 'bed_single', x: 0.7, z: -0.5 },
  { name: 'table_medium', x: 0.0, z: 0.0 },
  { name: 'chair', x: 0.35, z: 0.3, ry: Math.PI / 5 },
  { name: 'cabinet', x: -0.75, z: -0.6 },
  { name: 'lamp_standing', x: 0.8, z: 0.7 },
]
```

Then the builder, following `createBuilding`'s shape deliberately so `colony.js` sees an unchanged contract:

```javascript
export function createHouse({ seed = 1, accent = 0xc96442 } = {}) {
  const rand = mulberry(seed)
  const group = new THREE.Group()

  const shell = buildShell(rand, accent)
  const contents = buildContents(rand, accent)
  group.add(shell, contents)

  const box = shell.geometry.boundingBox
  group.userData.label = 'House'
  group.userData.height = box.max.y
  group.userData.footprint = Math.max(
    Math.abs(box.max.x),
    Math.abs(box.min.x),
    Math.abs(box.max.z),
    Math.abs(box.min.z)
  )
  group.userData.progress = 1
  group.userData.setProgress = (p) => {
    const v = THREE.MathUtils.clamp(p, 0, 1)
    group.userData.progress = v
    // The shell is a house: it does not fade in. Only its contents track progress.
    contents.userData.uniforms.uProgress.value = v
    // A retiring thread still has to disappear, which is what colony.js waits on.
    group.visible = v > 0.02
  }

  // A Group owns two meshes, so it owns freeing them. colony.js used to reach in and
  // dispose a Mesh's geometry and material by hand; it cannot know what is in here.
  group.userData.dispose = () => {
    for (const mesh of [shell, contents]) {
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.customDepthMaterial?.dispose()
    }
  }

  return group
}
```

`buildShell` builds a `Composer({ kit: 'city' })` from one entry of `SHELLS`, scales by `HOUSE_SCALE`, computes its bounding box, and materialises it with `atlasTexture('city')` and `cellMask([CELL_CITY.ACCENT])`. Its `uProgress` uniform is pinned at `1` — the shell never slides.

`buildContents` builds a `Composer({ kit: 'furniture' })` from `CONTENTS` and tags every vertex of piece `i` with its threshold. `Composer.add` merges as it goes, so the tag has to be written per part before the merge — the same way `aEmissive` already is:

```javascript
function buildContents(rand, accent) {
  const thresholds = revealThresholds(CONTENTS.length)
  const c = new Composer({ kit: 'furniture' })

  CONTENTS.forEach((piece, i) => {
    c.add(piece.name, { x: piece.x, z: piece.z, ry: piece.ry ?? rand() * 0.4 })
    // Composer.add pushed exactly one geometry; tag the one it just pushed. Doing this
    // after finish() is impossible — by then the pieces are one buffer with no seams.
    const geo = c.parts[c.parts.length - 1]
    const count = geo.attributes.position.count
    geo.setAttribute(
      'aReveal',
      new THREE.BufferAttribute(new Float32Array(count).fill(thresholds[i]), 1)
    )
  })

  const geo = c.finish()
  geo.scale(HOUSE_SCALE, HOUSE_SCALE, HOUSE_SCALE)
  geo.computeBoundingBox()
  // ...then materialise with atlasTexture('furniture') and cellMask([CELL_FURNITURE.ACCENT]),
  // exactly as createBuilding does for the base kit.
}
```

Its material discards fragments the progress has not reached:

```glsl
// vertex, alongside the existing vAtlasUv assignment
vReveal = aReveal;

// fragment, before the atlas cell lookup
if ( vReveal > uProgress ) discard;
```

Reuse `decorate()` and `depthMaterial()` from `buildings.js` by exporting them rather than copying — a shared shader patch used by two modules is better than two that drift apart. Add `aReveal` and `vReveal` to the existing declaration blocks; give the base kit's geometries a constant `aReveal` of `0` so the same shader serves both and the space-base buildings keep behaving exactly as they do.

- [ ] **Step 8: Switch the colony over**

In `src/game/colony.js`, change the import and line 477:

```javascript
const mesh = createHouse({ seed: hashString(thread.id), accent: plot.accent })
```

Then replace the three dispose lines at 512-514 with the one the Group publishes:

```javascript
      this.worldGroup.remove(entry.mesh)
      entry.mesh.userData.dispose()
```

Leave the rest of `colony.js` alone. The progress damping at line 735 and the retire check at line 510 both work off `userData.progress`, which is unchanged.

One known cosmetic consequence, not worth fixing here: line 841 computes `entry.mesh.userData.height * entry.progress`, which assumed a building that rises out of the ground. A house is full height from the start, so this volume is understated for a low-progress thread. It feeds a soft occlusion volume rather than anything clickable, so the effect is a slightly small halo on a nearly-empty house. Note it and move on; if it reads badly on screen, `Math.max(0.6, height)` is the fix.

- [ ] **Step 9: Run the suite and look at it**

```bash
npm test
PORT=5280 npm run dev
```

Expected: all tests pass. On screen: houses on the plots, each holding furniture, and a plot whose threads have small transcripts visibly emptier than one whose threads are large. Compare against http://localhost:5274 — same threads, same layout, different world.

- [ ] **Step 10: Commit**

```bash
git add src/world/houses.js src/world/buildings.js src/game/colony.js
git commit -m "feat: a house is a city shell filled with furniture"
```

---

### Task 5: Terra becomes the ground

**Files:**
- Modify: `src/world/planet.js:52-68` (Terra's entry) and its `SCATTER` weights
- Modify: `src/core/settings.js` (the default planet)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: no new exports. `PLANETS.terra` becomes the default; Luna and Mars stay selectable.

- [ ] **Step 1: Read what Terra already is**

```bash
sed -n '50,70p' src/world/planet.js
grep -n "planet" src/core/settings.js
```

Terra already exists, with the Moon as its companion body. This task tunes it and makes it the default — it does not add a planet.

- [ ] **Step 2: Make Terra the default**

Change the default planet in `src/core/settings.js` to `'terra'`. Keep the *Change planet* control and both other worlds: being able to put the crew on Mars is a feature, not a leftover.

- [ ] **Step 3: Retune Terra's scatter for a residential setting**

In `src/world/planet.js`, weight Terra's `SCATTER` towards trees, bushes and grass over boulders — a street with gardens, not a quarry. The forest kit already holds `Tree_*`, `Bush_*` and `Grass_2_D`; see `FOREST` in `tools/build-assets.mjs` for exactly which.

- [ ] **Step 4: Look at it**

```bash
PORT=5280 npm run dev
```

Expected: opens on Terra, green ground, planting rather than rubble, houses reading as houses standing on it.

- [ ] **Step 5: Run the suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/world/planet.js src/core/settings.js
git commit -m "feat: default to Terra, with a residential scatter"
```

---

### Task 6: The ship becomes the depot

**Files:**
- Modify: `src/world/ship.js`

**Interfaces:**
- Consumes: the `city` registry (Task 2), `Composer` with a kit (Task 3), `city-parts.txt` (Task 1).
- Produces: **no signature change.** Every export `ship.js` has today it still has, with the same arguments — `main.js` must not need editing, and Stage 2 needs the arrival and departure hooks intact.

- [ ] **Step 1: Read how the ship is assembled and what it exports**

```bash
grep -nE "^export|part\(|new Composer|function " src/world/ship.js
```

- [ ] **Step 2: Find depot-shaped parts**

```bash
grep -iE "warehouse|depot|shop|industrial|garage|hangar" city-parts.txt
```

If the city kit has nothing warehouse-shaped, the honest fallback is a large city shell with the base kit's `containers_A` in the yard. Say which you did in the commit message rather than forcing a model that does not fit.

- [ ] **Step 3: Rebuild it from city parts**

Change only what the depot is built from. Keep the module's exports, its placement at the colony centre, and the arrival and departure hooks exactly as they are.

- [ ] **Step 4: Look at it, run the suite, commit**

```bash
PORT=5280 npm run dev
npm test
git add src/world/ship.js
git commit -m "feat: the ship becomes the depot"
```

---

### Task 7: Crew clips and rethemed behaviour

**Files:**
- Modify: `tools/build-crew.mjs:24-28` (`WANTED`)
- Modify: `src/agents/crew.js:48-64` (`CLIP`)
- Modify: `src/agents/astronauts.js:32-41` (`AGENT_LOOK`)
- Test: `test/crew-clips.test.mjs`

**Interfaces:**
- Consumes: the Character Animations pack, downloaded in Task 0. Note that `public/assets/crew.glb` as checked in holds only the 14 clips the original colony plays — the new ones cannot be extracted from it, they have to come from the pack.
- Produces: `CLIP` gains a carry and a lift entry. `AGENT_LOOK`'s **keys are unchanged** — the six statuses of `STATUS_ORDER` plus `spawning` and `leaving`; only their colours move.

- [ ] **Step 1: Find out which clips the pack actually has**

```bash
node -e "
const {NodeIO} = await import('@gltf-transform/core')
const io = new NodeIO()
for (const f of process.argv.slice(1)) {
  const doc = await io.read(f)
  console.log('=== ' + f.split(/[\\\\/]/).pop())
  for (const a of doc.getRoot().listAnimations()) console.log('  ' + a.getName())
}
" --input-type=module assets-src/KayKit_Character_Animations_1.1/Animations/gltf/Rig_Medium/*.glb
```

The pack ships 161 clips across eight files and the colony keeps 14. Look for a carry, a pick-up and a sit-on-object clip. **Use the names this prints** — the runtime looks clips up by name, and `build-crew.mjs` already asserts at build time that every wanted clip exists.

- [ ] **Step 2: Write the failing test**

`test/crew-clips.test.mjs`:

```javascript
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * build-crew.mjs asserts that every WANTED clip exists in the pack, but only when the pack
 * is present — which it is not on a fresh clone. This asserts the other half of the
 * contract, the half that fails silently: a clip the runtime asks for that WANTED never
 * packed, which shows up as a crew member frozen in a T-pose.
 */
test('every clip the runtime plays is packed by build-crew', () => {
  const runtime = readFileSync('src/agents/crew.js', 'utf8')
  const build = readFileSync('tools/build-crew.mjs', 'utf8')

  const used = [...runtime.matchAll(/name:\s*'([A-Za-z0-9_]+)'/g)].map((m) => m[1])
  assert.ok(used.length >= 15, `only found ${used.length} clips in crew.js — the new ones are missing`)

  for (const name of used) {
    assert.ok(build.includes(`'${name}'`), `${name} is played but never packed`)
  }
})
```

- [ ] **Step 3: Run it to make sure it fails**

Run: `node --test test/crew-clips.test.mjs`
Expected: FAIL — `only found 14 clips in crew.js`.

- [ ] **Step 4: Add the clips**

Extend `WANTED` in `tools/build-crew.mjs` and `CLIP` in `src/agents/crew.js` with the carry and lift clips found in step 1. The comment on `WANTED` already says the two lists have to agree; keep them in the same order so that stays easy to see.

- [ ] **Step 5: Rebuild the crew and run the test**

```bash
npm run assets
node --test test/crew-clips.test.mjs
```

Expected: PASS. `build-crew.mjs` prints the new animation count.

- [ ] **Step 6: Retheme the look, not the mechanism**

In `src/agents/astronauts.js`, adjust `AGENT_LOOK`'s trim colours to read as work clothing rather than spacesuits. **Do not add or remove keys, and do not touch `STATUS_ORDER`** — one thread does one thing, and that precedence is the design rather than an implementation detail.

`blocked` keeps its red and `waiting` keeps its blue: those are the two states the badges point at, and their colour is doing real work.

- [ ] **Step 7: Add the two props the behaviour table promises**

The spec's behaviour table asks for two things the colours alone cannot say: a **toppled cabinet** beside a blocked crew member, and a **moving box** for a sleeping one to sit on. Both are furniture-kit parts, and the kit is registered as of Task 2.

```bash
grep -iE "box|crate|cabinet|wardrobe|dresser" furniture-parts.txt
```

Follow the pattern the hammer already uses. `src/agents/astronauts.js:1203` explains it: the hammer exists only while a thread is running, so it gets its own instanced mesh rather than being welded into the crew geometry. Do the same — one instanced mesh per prop, its count driven by how many crew members are currently in that state. Do not attach a prop to the rig, and do not build a prop for a state that does not have one in the table.

- [ ] **Step 8: Run the suite and check each state**

```bash
npm test
PORT=5280 npm run dev
```

Expected: all pass. On screen, find one of each state you can: a running thread working at a piece of furniture, an unread one standing still under a `?`, a three-day-old one sitting down. An `idle` or `sleeping` crew member must have **no** badge.

- [ ] **Step 9: Commit**

```bash
git add tools/build-crew.mjs src/agents/crew.js src/agents/astronauts.js test/crew-clips.test.mjs public/assets/crew.glb
git commit -m "feat: carry and lift clips, work clothes, and the cabinet and box props"
```

---

### Task 8: Wording, the port, and the README

**Files:**
- Modify: `src/ui/hud.js` (visible strings, and the help overlay)
- Modify: `index.html` (the help text and `<title>`)
- Modify: `README.md`
- Modify: `.claude/launch.json`, `package.json`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Text and configuration only.

- [ ] **Step 1: Find every visible string**

```bash
grep -nE "building|astronaut|colony|ship|planet|repo" src/ui/hud.js index.html
```

- [ ] **Step 2: Reword, in English**

`building` → `house`, `astronaut` → `crew`, `ship` → `depot`.

Two deliberate exceptions: **`repos` stays `repos`** — the sidebar lists real repositories, and calling them "addresses" would make the list lie about what it is. And **`needs you` stays** — it is already exactly the right words.

- [ ] **Step 3: Pin the port**

`.claude/launch.json`:

```json
{
  "version": "0.0.1",
  "configurations": [
    {
      "name": "moving-in-crossing",
      "runtimeExecutable": "npm",
      "runtimeArgs": ["run", "dev"],
      "port": 5280,
      "autoPort": true
    }
  ]
}
```

Set `PORT=5280` for the `dev` and `serve` scripts in `package.json` so the fork does not have to be started with an environment variable by hand. It must not default to 5274.

- [ ] **Step 4: Rewrite the README's opening**

Say what this fork is, that it is a re-theme of Bot Crossing, and credit upstream with a link. Keep the harness table and the "Keeping it local" section as they are — both are still true, and both are still upstream's.

- [ ] **Step 5: Remove the working notes**

```bash
rm -f city-parts.txt furniture-parts.txt
```

- [ ] **Step 6: Full verification**

```bash
npm test
npm run build
npm run serve
```

Expected: every test passes, the build succeeds, and the production server serves the themed colony on 5280 while the original still answers on 5274.

- [ ] **Step 7: Commit**

```bash
git add src/ui/hud.js index.html README.md .claude/launch.json package.json
git commit -m "docs: reword for Moving-In, and settle on port 5280"
```

---

## Deliberately left for Stage 2

One row of the spec's mapping table is not implemented here, and it is worth naming so it is not mistaken for an oversight:

**Scaffolding → van parked out front.** The `Scaffolds` class at `src/world/buildings.js:523` renders "somebody is at that site right now" as one instanced mesh for the whole colony. It needs a van model, which is the one asset the spec could not confirm sits in the free tier. Stage 1 therefore leaves `Scaffolds` as it is — visibly still scaffolding, and visibly the odd one out. That is the intended state at the end of this plan, not a bug to report.

## Done when

- `npm test` passes, and the count is the original 33 plus the tests added here.
- `npm run dev` shows houses on the hex plots, crew members with the right badges, and furniture that visibly tracks transcript size.
- **Clicking a crew member still opens its thread in the right harness.** This is the one thing the re-theme must not break — it is the whole reason the app exists.
- No `idle` or `sleeping` crew member carries a badge.
- The original Bot Crossing still answers on 5274 with its logon autostart untouched.
- Stage 2 (the vans) is not in scope, and nothing here blocks it: `ship.js` keeps its arrival and departure hooks and its exports.
