# Crew Garments — Stage 5 of the Moving-In theme

**Status:** approved 2026-09-11
**Stage:** 5, following the world (1), the delivery drive (2), the crew (3) and streets and
traffic (4).
**Preceding specs:** `docs/superpowers/specs/2026-09-09-moving-in-theme-design.md`,
`docs/superpowers/specs/2026-09-10-moving-in-streets-and-traffic-design.md`

## Goal

Replace the crew's bare mannequin with clothed characters from KayKit's **Adventurers** pack,
which sits on the same rig. A mover gets a tunic, trousers, boots, gloves and a modelled head
with modelled hair, instead of one untextured shape tinted a single flat colour.

Two sets, mixed across the colony: **Ranger** and **Rogue**. No capes, no hood.

## Why this is possible: the four compatibility checks

Measured on 2026-09-11, not assumed. They are recorded because they are why this stage is
tractable, and because the same four must be re-run before adopting any future pack.

1. **Same skeleton.** Both the mannequin and every adventurer use KayKit's **`Rig_Medium`**.
   The Adventurers pack ships `Animations/gltf/Rig_Medium/`, the same rig folder
   `tools/build-crew.mjs` already reads from the Character Animations pack.
2. **Same split.** Every adventurer is divided into the same six meshes as the mannequin:
   `_Body`, `_ArmLeft`, `_ArmRight`, `_LegLeft`, `_LegRight`, `_Head`.
3. **Our bones are a strict subset.** The adventurers have **23 joints against our 21**, in a
   different order, but all 21 of ours are present. The only extras are `handslot.l` and
   `handslot.r` — weapon attachment points — and **no body, arm, leg or head mesh references
   either**. A joint-index remap is the whole of the work.
4. **The bind poses are identical to 5.457e-12** across all 21 shared bones. This is the gate
   that matters: a remapped part sits exactly where it belongs, with no offset and no
   deformation.

## The atlas, which is what makes per-mover colour possible

Each adventurer carries one material and one texture: a 1024 × 1024 PNG of 13–15 kB. Looked at
directly, it is an **8-column by 4-row gradient atlas** — eight columns, four rows, each
cell a vertical gradient, the bottom row filler. The same shape `tools/atlas-cells.mjs`
already reads for the kit atlases.

Which cells each mesh uses, computed from its UVs (glTF `v` runs downward, so the row is
`floor(v * 4)` and **not** `floor((1 - v) * 4)` — getting that backwards produces plausible
nonsense):

| Mesh | Cells used |
| --- | --- |
| `Ranger_Head` | **1** `#9b5a45` hair (770), **0** `#f6c09c` skin (322), **2** `#13191b` eyes and brows (80) |
| `Rogue_Head` | **1** `#9b5a45` (1640), **0** `#f6c09c` (309), **2** `#13191b` (98), 3 `#818c91` (84) |
| `Ranger_Body` | 7, 3, 8, 5, 6, 15 |
| `Rogue_Body` | 8, 5, 3, 6, 9, 15 |
| `Ranger_LegLeft` / `Rogue_LegLeft` | 19, 15 |

**So skin, hair and eyes are each their own atlas cell.** That is what lets the heads come
across without losing what stage 3 built.

## What is kept, changed and lost

**Kept, by repainting cells 0, 1 and 2 per mover:**

- **Six skin tones** — cell 0. `SKIN_TONES` and `skinToneFor` in `src/agents/skin.js` survive
  as the palette; only the mechanism changes, from an `instanceColor` on a white head to a
  repainted atlas cell.
- **Eye colour as a status carrier** — cell 2. One of the three carriers stage 3 established,
  and it moves onto a modelled face.
- **Hair colour per mover** — cell 1. This is *more* than stage 3 gave: it deliberately used
  one shared `HAIR_TONE` for every figure, on the grounds that a second per-agent colour was
  spend without a picture to show for it. On a modelled head it is a free consequence of the
  same mechanism.

  **The hair palette does not exist yet and this stage creates it**: five tones, asserted
  against the skin tones rather than eyeballed.

  The rule is **sRGB distance ≥ 0.15 from every one of the six skin tones**, not "darker than
  the skin". Stage 3's single `HAIR_TONE` could be chosen by darkness because there was only
  one; a palette cannot. The six skin tones span 0.035 to 0.675 in luminance and cover the
  whole brown-and-tan range hair also lives in — a mid-brown hair measures 0.048 from one of
  them, effectively the same colour — and requiring every tone to beat the darkest skin at
  0.035 would force six shades of near-black, throwing away the variety the palette exists
  for. Since hair and skin are drawn independently, all 30 pairings occur and each must read.

  **That threshold makes the palette greyscale-to-blue-black, and that is a consequence
  rather than a choice**: browns, gingers and blondes are exactly the colours human skin
  comes in, so none of them can clear it. Measured — black 0.221, blue-black 0.210, slate
  0.227, ash grey 0.244, steel grey 0.310; platinum 0.120, deep olive 0.119 and dark auburn
  0.059 all fail. Read as dark, greying and grey hair, it suits a crew of mixed ages.

**Lost, deliberately, and this is the price of the modelled heads:**

- **The face stops moving.** `src/agents/faces.js`, `buildFaceAtlas`, the sphere-cap face mesh
  and the whole blink-and-expression machinery (`FACE`, `faceFrame`, `faceTimer`, `blinkAt`,
  `faceIndex`, `_faceMaterial`, `_faceUniforms`, `uGlow`) go. An adventurer's face is painted
  into its texture and is static.
- **Four hairstyles become two.** Each adventurer head has one modelled cut, so Ranger heads
  share one and Rogue heads the other. `src/agents/hair.js` loses its four primitive
  geometries, `HAIR_STYLES`, `BALD` and `hairStyleIndexFor`; what remains of it — or what
  replaces it — is the new hair-tone palette and its per-id lookup, so the file becomes the
  counterpart of `skin.js` rather than disappearing. Its import allowlist test must be kept
  and must still forbid anything that knows a status.
- **`src/agents/workwear.js` and its test go.** `SUIT_TONES` exists to tint the mannequin's
  body through `instanceColor`, and after this stage no mannequin body remains. It was added
  one day earlier, in stage 4's Task 1, and it did real work — it is what made the hi-vis band
  legible, because every trim colour measures 0.09–0.41 in luminance against the five white
  bodies at 0.77–0.91. **Carry that finding forward:** the same question applies to the
  garments, so the band's contrast against the Ranger's and Rogue's actual tunic colours must
  be measured and recorded. If a garment is light enough that the band stops reading, that is
  a finding to report, not to paper over.
- **The rigid head attachment goes.** Stage 3 kept the head out of the skinned body and rode
  it on the `head` bone through `attachMatrixAt`, with `src/agents/head-bind.js` asserting the
  bind matrix was identity — because the head needed an `instanceColor` of its own for skin
  tone, and the body's was already spoken for. Skin tone now comes from an atlas repaint, so
  that reason is gone: each adventurer `_Head` is weighted entirely to the single `head` bone
  and merges into its set's geometry like any other part.

**Per-mover variety afterwards:** 2 sets × 6 skin tones × 5 hair tones = 60 combinations, all
stable from the thread id and none of them tracking status. Status stays where stage 3 put it:
the trim colour on the hi-vis band, the eye colour, and the band's pulse when blocked.

No per-mover recolouring of the *garments* themselves — the Ranger set keeps its green and
brown and the Rogue set its dark leather. Tinting a textured garment multiplies the belts,
buckles and boots along with it and throws away the detail this pack is being brought in for.

## The one genuinely new mechanism: three per-instance colours

`instanceColor` carries **one** colour per instance, and this stage needs three — skin, hair
and eyes, on the same mesh. The existing precedent does not scale: `src/world/deliveries.js`
buckets into one `InstancedMesh` per accent colour, and 2 sets × 6 skin × 6 hair × 8 eye
colours would be hundreds of meshes.

The way through is already in the file. The crew geometry carries a **per-instance custom
attribute** today — `aFrame`, the animation frame, an `InstancedBufferAttribute` read by the
vertex shader. Three `vec3` attributes are the same mechanism:

- `aSkin`, `aHair`, `aEye`, each an `InstancedBufferAttribute` of itemSize 3 with
  `DynamicDrawUsage`, written in the same per-frame packing loop that already writes
  `aFrame` and the band colours.
- The fragment shader tests the fragment's UV against the three cell rectangles and
  substitutes the matching per-instance colour. Cell *n* occupies
  `u ∈ [col/8, (col+1)/8)`, `v ∈ [row/4, (row+1)/4)` with `col = n % 8`, `row = ⌊n / 8⌋`.
- **Substitute by ratio, not by replacement.** Every cell is a vertical *gradient*, and
  flattening it to one colour throws away the shading that makes these models read. Multiply
  the sampled texel by `target / base`, where `base` is that cell's mid colour passed in as a
  uniform — so the gradient survives and only the hue shifts. The three base colours are
  `#f6c09c`, `#9b5a45` and `#13191b`.
- **Cell 2 is near-black** (`#13191b`), so a ratio against it is numerically unstable — a
  divide by something close to zero. The eye cell is therefore the one exception: replace it
  outright rather than by ratio, and say so in the comment. It is 80–98 vertices of flat dark
  paint with no gradient worth keeping.

`src/agents/skin.js` must stay free of anything that knows a status, and
`test/crew-look.test.mjs` already asserts that structurally through an import allowlist. The
same must hold for whatever module owns the hair palette.

## Architecture

### Build time — `tools/build-crew.mjs`

The pipeline already merges the mannequin with retargeted `Rig_Medium` clips into
`public/assets/crew.glb`. It gains the garments:

- Read `Ranger.glb` and `Rogue.glb` from
  `assets-src/KayKit_Adventurers_2.0_FREE/Characters/gltf/`.
- Keep, per set: `_Body`, `_ArmLeft`, `_ArmRight`, `_LegLeft`, `_LegRight`, `_Head`.
- **Drop** `_Cape`, `Ranger_Quiver`, and everything else the pack ships. `Rogue_Hooded.glb`
  is never read — its own head mesh is `RogueHooded_Head` and a hood is not wanted.
- **Remap `JOINTS_0`** from the adventurer's 23-joint order to the rig's 21-joint order, and
  **assert no surviving vertex references `handslot.l` or `handslot.r`**. A silent remap onto
  a wrong index shows as a limb pinned to the wrong bone, not as an error.
- Merge each set's six meshes into **one geometry per set** — possible because a set shares one
  material — so two sets cost two geometries and two textures.
- **Drop every `Mannequin_Medium_*` mesh**, the head included. The mannequin contributes only
  the rig and the clips now.

`assets-src/` is gitignored and the built `.glb` is committed, so the pack need only be
present when rebuilding. `crew.glb` is the one asset this stage may change.

### Run time — `src/agents/crew.js` and `src/agents/astronauts.js`

- `setRig` builds one `InstancedMesh` from `rig.geometry` today; it builds **two**, one per
  set, each with its own material and texture, both reading the **same baked bone-matrix
  texture**. That sharing is what the identical bind pose buys.
- Which set a mover wears is a **pure function of the thread id**, resolved once when the
  agent is created, exactly as its skin tone is. **It never tracks status** — the uniform says
  who a crew member is, the way the skin tone does.
- The salt must be **independent of the skin-tone and hair-tone hashes**, and the test must
  prove it rather than assume it. Stage 3 recorded why: a plain multiply-xor hash leaves the
  low bits correlated, its suggested salt produced a hairstyle that tracked skin tone 100% of
  the time, and the test written for it would have passed on the broken version. Use the
  `lowbias32` finalizer, and assert the joint distribution.
- The hi-vis bands stay procedural elliptical rings, **re-measured** — see below.
- `HEAD_R` (0.554) is used as the *unit* for the band constants as well as being a measurement
  of the mannequin's head. After this stage the mannequin head is gone, so it is only a unit.
  Either re-express the constants or say plainly in the comment that it is no longer a
  measurement of anything on screen. A constant whose comment describes a part that does not
  exist is this repository's signature defect.

### The bands must grow

Torso half-width and half-depth at the heights the bands sit (y 0.740 and 0.879 in the rig's
own units), from each body mesh's chest- and spine-weighted vertices:

| Body | half-width | half-depth |
| --- | --- | --- |
| `Mannequin_Medium_Body` | 0.365 | 0.271 |
| `Ranger_Body` | 0.366 | **0.346** |
| `Rogue_Body` | 0.386 | **0.340** |

The current constants are `bandR = HEAD_R * 0.7 = 0.388` for the half-width and
`bandDepth = HEAD_R * 0.56 = 0.310` for the half-depth. **So `bandDepth` sits inside both
garments** — a ring at 0.310 sinks about 0.03 into a tunic measuring 0.340–0.346, leaving it
buried front and back and visible only at the sides. The half-width survives but clears the
Rogue by 0.002, which is touching.

**Ruling: one set of band constants, sized to clear the thicker of the two**, rather than one
set per garment. Ranger and Rogue differ by 0.006 in each axis, which does not pay for a
second code path. The implementer measures the clearance actually achieved and records it.

### Two more measurements that shape the work

- **The Ranger's and Rogue's legs are the same mesh** — identical extents (y −0.002 to 0.529,
  x ±0.291, z −0.128 to 0.281) and identical vertex count (780). The sets differ in torso,
  arms and head only; there is no lower-body variety to be had, and no point looking for it.
- **The adventurer heads are larger than the mannequin's**: `Mannequin_Medium_Head` is ±0.432
  wide, `Ranger_Head` ±0.543 and `Rogue_Head` ±0.582. Taking each set's own head is what
  removes the collar-fit risk entirely — every head meets the collar it was modelled for.

## Testing

Everything that is arithmetic is pure and tested under `node --test`, following
`src/world/drive-path.js`, `src/game/growth.js` and `src/agents/band-pulse.js`:

- **The joint remap**: every source index maps to the right destination bone *by name*, and no
  surviving vertex references `handslot.l` or `handslot.r`.
- **The garment-set hash**: stable for a given id, independent of the skin-tone and hair-tone
  hashes with the joint distribution asserted, and **never a function of status** — proved
  structurally through the module's import allowlist, the way `test/crew-look.test.mjs`
  already proves it for `skin.js`.
- **The cell rectangles**: cell *n*'s UV bounds are `[n % 8 / 8, …)` by `[⌊n / 8⌋ / 4, …)`,
  asserted for cells 0, 1 and 2 against the measured cells the head actually uses. A test
  here is worth having because the row convention is easy to invert and an inverted one
  repaints the wrong swatch while still looking deliberate.
- **Band clearance**: the new constants sit outside the measured half-width and half-depth of
  both garments, asserted against the numbers rather than eyeballed.
- **Band contrast**: every trim colour's luminance against each garment's tunic cells, with a
  stated threshold, carrying forward what stage 4's workwear test established.
- `src/agents/astronauts.js` needs a GL context and a loaded glb, so it cannot be imported
  under `node --test`. Assert against its source text with `readFileSync`, as
  `test/crew-look.test.mjs` already does — and use that to prove the deleted parts are really
  gone, the way stage 3's `GONE` list proves the spacesuit is.

**Animated behaviour is verified by driving frames by hand**, never through the Browser pane,
which does not tick `requestAnimationFrame` in this project — measured at 0 frames in 3
seconds with the document visible. The engine's updaters are objects with an
`update(dt, elapsed)` method, so the call is `u.update(1/60, t)`.

**And the figure must be looked at**, early. The first task's deliverable is one mover on
screen wearing one set, judged by eye before four more tasks are built on it.

## Global constraints

- `server/` stays **byte-identical** to Dimitri's `shared-colonies` branch;
  `git diff -- server/` must be empty.
- No new dependencies. `package.json` unchanged.
- `public/assets/crew.glb` **is** rebuilt by this stage. `city.glb`, `furniture.glb`,
  `forest.glb` and `spacebase.glb` stay as they are.
- `STATUS_ORDER` and the eight `AGENT_LOOK` keys unchanged.
- Theme port is **5280**. Ports 5274, 5275 and 5276 belong to the always-on installation.
- All code, comments and documents in English.
- A documentation claim must be true of the code. Across stages 1 to 4 every Important review
  finding was documentation asserting the opposite of the implementation — nine by the end of
  stage 4 — and two fix rounds introduced fresh false claims while correcting others. One, in
  stage 4, was a fix report claiming a road followed the terrain when the change it made was
  provably a no-op. Reviewers are to be pointed at this by name, and must check that nothing
  *removed* was true.
- **This stage deletes three modules and a face-animation system.** Every reference to them —
  in code, comments, the README and earlier specs — has to go or be put in the past tense. A
  comment describing the blink timing of a face that no longer blinks is the defect above,
  waiting to happen.

## Explicitly not doing

- **No cape and no hood.** `Rogue_Cape` and `Ranger_Cape` are separate meshes and are not
  imported; `Rogue_Hooded.glb` is never read.
- **No `Ranger_Quiver`.** It could read as a tool holster, and it is not asked for.
- **Nothing from the pack's `Assets/` folder** — swords, bows, shields, spellbooks and a mug.
  Pure fantasy, nothing a removal crew would carry.
- **No Knight, Barbarian or Mage** — plate armour, a bare chest, a robe.
- **No per-mover garment recolouring.**
- **No new animation clips.** The Adventurers pack ships its own `Rig_Medium` animations, but
  the clips already in `crew.glb` are what the state machine drives, and this stage does not
  touch them.
- **No replacement for the face animation.** Blinking and expressions go and nothing takes
  their place; state is carried by pose, by the badge, and by the band.
- **No change to the roads.** Stage 4's outstanding work — its Task 8 documentation, its final
  review, and the open finding that the carriageway does not follow the terrain — is paused,
  not cancelled, and is recorded in that stage's ledger.
