import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { SKIN_TONES, skinToneIndexFor } from '../src/agents/skin.js'
import { HAIR_TONES, hairToneFor, hairToneIndexFor } from '../src/agents/hair.js'
import { BRAND, GARMENT_CELLS, luminanceOf, recolorByLuminance } from '../src/agents/atlas-cells.js'

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

test('the face survives — it is not yet deleted, even though it no longer carries a colour', () => {
  // Still built and still positioned every frame, but never added to the scene (see the
  // comment where `parts.face` is built) and, since this task, never repainted either — the
  // eye colour it used to carry is gone. `faces.js` and this construction are a later task's
  // to delete.
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

test('the head is no longer a separate part — it rides in each garment set\'s own mesh', () => {
  // Task 2 folded the head into each garment set's own merged, skinned geometry (see
  // `mergeSet` in crew.js): it is skinned exactly, the same as every other limb, rather than
  // placed by the old attach-bone approximation a rigid standalone part needed. So there is
  // no `parts.head` any more, and nothing here still reaches the `rig.headGeometry` that
  // used to feed it — `crew.js` deleted that field along with `extractHead`.
  assert.doesNotMatch(SRC, /parts\.head\s*=/, 'parts.head is still built')
  assert.doesNotMatch(SRC, /rig\.headGeometry/, 'astronauts.js still reads the deleted rig.headGeometry')
})

test('setRig builds one InstancedMesh per garment set, each carrying its own texture', () => {
  assert.match(SRC, /rig\.sets\.map/, 'setRig no longer builds one mesh per garment set')
  assert.match(SRC, /map:\s*set\.texture/, 'a garment set mesh is not textured with its own set')
})

// ── D5: the old procedural hairstyles are gone, replaced by a per-mover tone on the atlas.
//
// The primitive-geometry tests that used to live here (`HAIR_STYLES`, `hairStyleIndexFor`,
// `BALD`, sized against `P.headR`) asserted on exports `hair.js` no longer has: every
// adventurer head now has its hair modelled and painted in, and what varies per mover is the
// colour of one atlas cell, not a choice of geometry. Replaced below with the tone-palette
// tests, which are what a status-independent per-mover *colour* actually needs checked:
// distinct from the skin tones, distinct from each other, stable per id, and every tone
// reachable.

const srgb = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]
const distance = (a, b) => {
  const [ar, ag, ab] = srgb(a)
  const [br, bg, bb] = srgb(b)
  return Math.hypot(ar - br, ag - bg, ab - bb)
}

test('there are five hair tones', () => {
  assert.equal(HAIR_TONES.length, 5)
})

test('every hair tone is far enough from every skin tone to read against it', () => {
  // Hair and skin are chosen independently, so any of the 30 pairings can occur and every
  // one has to be legible. The rule is sRGB distance, NOT "hair is darker than skin": the six
  // skin tones span 0.035 to 0.675 in luminance, so they cover the whole brown-and-tan range
  // that hair also lives in, and a mid-brown hair measures about 0.05 from one of them --
  // effectively the same colour. Requiring hair to be darker than the darkest skin (0.035)
  // would force five shades of near-black and throw away the variety it exists for.
  //
  // This threshold is why the palette is greyscale-to-blue-black: browns, gingers and
  // blondes are exactly the colours human skin comes in, so none of them can clear it.
  // Measured: black 0.221, blue-black 0.210, slate 0.227, ash grey 0.244, steel grey 0.310;
  // platinum 0.120, deep olive 0.119 and dark auburn 0.059 all fail.
  for (const hair of HAIR_TONES) {
    for (const skin of SKIN_TONES) {
      const d = distance(hair, skin)
      assert.ok(
        d >= 0.15,
        `hair 0x${hair.toString(16)} is ${d.toFixed(3)} from skin 0x${skin.toString(16)}`
      )
    }
  }
})

test('the hair tones are distinct from each other', () => {
  for (let i = 0; i < HAIR_TONES.length; i++) {
    for (let j = i + 1; j < HAIR_TONES.length; j++) {
      const d = distance(HAIR_TONES[i], HAIR_TONES[j])
      assert.ok(d >= 0.08, `hair tones ${i} and ${j} are only ${d.toFixed(3)} apart`)
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
  assert.equal(pairs.size, 30, `only ${pairs.size} of 30 hair/skin pairs appeared`)
})

test('no primitive hairstyle geometry survives', () => {
  // The four procedural styles are gone: each adventurer head has its hair modelled in, so
  // a primitive cap on top of it would intersect the mesh.
  const src = readFileSync('src/agents/hair.js', 'utf8')
  for (const gone of ['HAIR_STYLES', 'hairStyleIndexFor', 'BALD', 'SphereGeometry', 'CylinderGeometry']) {
    assert.doesNotMatch(src, new RegExp(`\\b${gone}\\b`), `hair.js still mentions ${gone}`)
  }
})

test('hairToneFor returns a THREE.Color and a thread always gets the same one', () => {
  const id = 'claude-code:6b17e5c7-1d06-490c-a8fe-9899fee895fa'
  const a = hairToneFor(id)
  const b = hairToneFor(id)
  assert.equal(a.getHex(), b.getHex())
  assert.equal(a.getHex(), HAIR_TONES[hairToneIndexFor(id)])
})

// ── task 4r: the hi-vis bands and the garment eye repaint are gone at the owner's request.
//
// The `bandPulse` tests and the "the bands are built and written" test that used to live here
// asserted on a mechanism (`band-pulse.js`, `parts.bands`) that no longer exists — rewritten
// below rather than left to fail. Status is still carried by the badge (`indicators.js`) and
// by the pose; see `src/agents/astronauts.js`'s `AGENT_LOOK` comment for the full reasoning.

test('no hi-vis band is built or written', () => {
  // The bands are gone at the owner's request: they read oddly against the garments. Status
  // is carried by the badge (indicators.js) and by the pose, and `sleeping` and `idle` are
  // deliberately BADGE.none, so nothing that wants attention lost its signal.
  for (const gone of ['bands', 'BAND_GLOW', 'BAND_SPARK', 'bandPulse', 'bandY', 'bandR', 'bandDepth', 'bandThickness', 'bandGap']) {
    assert.doesNotMatch(SRC, new RegExp(`\\b${gone}\\b`), `astronauts.js still has ${gone}`)
  }
})

test('band-pulse.js is gone', () => {
  assert.equal(existsSync('src/agents/band-pulse.js'), false)
})

test('the eyes are left as the pack painted them', () => {
  // The atlas's own eye swatch is #13191b -- near-black already, which is why the shader had
  // to special-case it against a ratio that divides by almost nothing. So "dark eyes" is
  // achieved by not repainting that cell at all, rather than by feeding it a dark colour.
  for (const gone of ['aEye', 'vEye', 'CELL_EYES', 'eyeAttr', 'eyeRect']) {
    assert.doesNotMatch(SRC, new RegExp(`\\b${gone}\\b`), `astronauts.js still has ${gone}`)
  }
})

test('skin and hair are still repainted per mover', () => {
  // The regression guard for this task: removing one of three attributes must not take the
  // other two with it.
  for (const kept of ['aSkin', 'aHair', 'CELL_SKIN', 'CELL_HAIR', 'cellRect', 'CELL_BASE']) {
    assert.match(SRC, new RegExp(`\\b${kept}\\b`), `astronauts.js lost ${kept}`)
  }
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

// ── D3/D4: the mid-stage defect fixes. astronauts.js needs a GL context and a loaded glb,
// so — following this file's own precedent above — these are source-text guards rather than
// constructed-scene checks: what matters is that the two constants a user actually saw as a
// visual defect do not drift back to their old values.

test('the face cap is sized to P.headR, not the old 1.047-over multiplier', () => {
  // The old multiplier sized the cap to its own whole footprint (0.581) rather than to the
  // patch where the eyes and mouth are actually drawn (0.548), so the features floated
  // about 0.03 clear of the skull. `P.headR` alone clears the drawn patch by about 0.006.
  assert.match(SRC, /sphereCap\(P\.headR,\s*1\.72,\s*0\.98,\s*16,\s*10\)/, 'the face cap call changed shape unexpectedly')
  assert.doesNotMatch(SRC, /sphereCap\(P\.headR\s*\*\s*1\.047/, 'the face cap is still sized to the old whole-footprint multiplier')
})

test('the face does not glow past 1.0 any more', () => {
  // 1.85 pushed the eyes and mouth over the HDR/bloom threshold, which is what made the
  // face-off-the-head defect (fixed above) conspicuous. Task 4r removed the eyes' status
  // colour entirely (`face.setColorAt(i, agent.eye)` is gone along with `agent.eye`), so
  // there is nothing left to push past 1.0 even in principle — this now just guards that
  // uGlow stays at the harmless value.
  assert.match(SRC, /uGlow = \{ value: 1\.0 \}/, 'uGlow is not set to 1.0')
  assert.doesNotMatch(SRC, /uGlow = \{ value: 1\.85 \}/, 'uGlow is still pushed past 1.0')
  assert.doesNotMatch(SRC, /face\.setColorAt\(i, agent\.eye\)/, 'the face still repaints from the removed agent.eye')
})

// ── moving-in-crew-garments: the ranger and rogue tunics and trousers move to the
// Moving-In brand palette. Garment colour is per *set*, not per agent, so it lives in
// uniforms `_recolorGarment` builds from `GARMENT_CELLS`, not in a third instanced
// attribute alongside `aSkin`/`aHair` — the two tests below on `_recolorGarment` itself
// check that the per-set wiring is actually there, and the luminance test after them
// checks the one thing that needed care: that the recolour cannot flatten a gradient.

test('the five brand hex values match the company colour sheet exactly', () => {
  // The sheet's own hex column is the authority — see the comment on BRAND in
  // atlas-cells.js for why the RGB columns for Mid Gray and Light Gray are not it.
  assert.equal(BRAND.darkBlue, 0x1f262f)
  assert.equal(BRAND.leafGreen, 0x8dc63f)
  assert.equal(BRAND.white, 0xffffff)
  assert.equal(BRAND.midGray, 0x637184)
  assert.equal(BRAND.lightGray, 0xeff3fa)
})

test('each named garment cell maps to the colour the brief asked for', () => {
  const ranger = Object.fromEntries(GARMENT_CELLS.ranger.map((c) => [c.part, c]))
  const rogue = Object.fromEntries(GARMENT_CELLS.rogue.map((c) => [c.part, c]))

  assert.equal(ranger.tunic.cell, 7)
  assert.equal(ranger.tunic.target, BRAND.leafGreen)
  assert.equal(ranger.trousers.cell, 19)
  assert.equal(ranger.trousers.target, BRAND.darkBlue)

  assert.equal(rogue.tunic.cell, 8)
  assert.equal(rogue.tunic.target, BRAND.darkBlue)
  assert.equal(rogue.trousers.cell, 19)
  // Mid Gray, not Dark Blue: the owner's literal first ask would put both the rogue's
  // tunic and trousers at the same near-black colour, which reads as one silhouette that
  // disappears at night. See the comment on GARMENT_CELLS in atlas-cells.js.
  assert.equal(rogue.trousers.target, BRAND.midGray)
})

test('_recolorGarment takes the garment set and gives each material its own garment uniforms', () => {
  // Garment colour is per set, not per agent, so it must be wired as uniforms rather than
  // as a third instanced attribute riding alongside aSkin/aHair — and setRig must hand the
  // set through so _recolorGarment knows which set's uniforms to build.
  assert.match(SRC, /_recolorGarment\(material,\s*set\.id\)/, 'setRig no longer passes the set into _recolorGarment')
  assert.match(SRC, /_recolorGarment\(material,\s*setId\)/, '_recolorGarment no longer takes the set id')
  assert.match(SRC, /GARMENT_CELLS\[setId\]/, '_recolorGarment no longer reads GARMENT_CELLS for its set')
  assert.doesNotMatch(SRC, /attachColorAttribute\(geo,\s*['"]aGarment/, 'garment colour was wired as an instanced attribute instead of a uniform')
})

test('the garment recolour uses luminance, not the skin/hair ratio, and never touches the untouched cells', () => {
  assert.match(SRC, /repaintByLuminance/, 'astronauts.js lost the luminance-preserving garment recolour')
  // The measured, nearly-clipping case this task exists to avoid: the ratio path is used
  // for skin and hair only.
  assert.match(SRC, /uSkinBase,\s*vSkin/, 'skin no longer uses the ratio path')
  assert.match(SRC, /uHairBase,\s*vHair/, 'hair no longer uses the ratio path')
})

// The luminance arithmetic itself, as a pure function both this test and the shader agree
// on (`recolorByLuminance`/`luminanceOf` in atlas-cells.js; the GLSL in `_recolorGarment`
// is a hand-kept mirror of it, since GLSL cannot call into JS — see the comment there).
//
// Darkest, mid and lightest texels below are measured off the source
// `assets-src/KayKit_Adventurers_2.0_FREE/Characters/gltf/{Ranger,Rogue}.glb` atlases, at
// the same three points `tools/atlas-cells.mjs` samples a cell at (its vertical middle) plus
// the top and bottom of the opaque gradient — not guessed. Ranger cell 7's mid and lightest
// match this task's own report (mid (126,90,73), lightest (159,116,89)) to within a rounding
// step.
const GRADIENTS = {
  'ranger tunic (cell 7 -> Leaf Green)': {
    darkest: [93, 65, 57],
    mid: [126, 91, 73],
    lightest: [159, 116, 89],
    target: BRAND.leafGreen,
  },
  'ranger trousers (cell 19 -> Dark Blue)': {
    darkest: [93, 65, 57],
    mid: [126, 91, 73],
    lightest: [159, 116, 89],
    target: BRAND.darkBlue,
  },
  'rogue tunic (cell 8 -> Dark Blue)': {
    darkest: [11, 54, 58],
    mid: [9, 98, 83],
    lightest: [6, 143, 109],
    target: BRAND.darkBlue,
  },
  'rogue trousers (cell 19 -> Mid Gray)': {
    darkest: [125, 61, 44],
    mid: [155, 90, 69],
    lightest: [178, 112, 82],
    target: BRAND.midGray,
  },
}

const to01 = (rgb255) => rgb255.map((v) => v / 255)
const hexTo01 = (hex) => [((hex >> 16) & 255) / 255, ((hex >> 8) & 255) / 255, (hex & 255) / 255]

for (const [label, { darkest, mid, lightest, target }] of Object.entries(GRADIENTS)) {
  test(`recolorByLuminance keeps ${label} in light-to-dark order and in range`, () => {
    const midLum = luminanceOf(to01(mid))
    const targetRgb = hexTo01(target)
    const outputs = [darkest, mid, lightest].map((texel) => recolorByLuminance(to01(texel), midLum, targetRgb))

    // No channel exceeds 1.0 (the ratio path's failure mode: ranger cell 7's lightest texel
    // through it lands the green channel exactly on 255).
    for (const out of outputs) {
      for (const channel of out) assert.ok(channel <= 1.0 + 1e-9, `channel ${channel} exceeds 1.0`)
      for (const channel of out) assert.ok(channel >= 0, `channel ${channel} is negative`)
    }

    // The cell's own light-to-dark ordering survives: the recoloured darkest texel is still
    // darker than the recoloured mid, which is still darker than the recoloured lightest.
    const [darkOut, midOut, lightOut] = outputs.map(luminanceOf)
    assert.ok(darkOut < midOut, `darkest (${darkOut}) is not below mid (${midOut}) after recolouring`)
    assert.ok(midOut < lightOut, `mid (${midOut}) is not below lightest (${lightOut}) after recolouring`)
  })
}

test('recolorByLuminance guards a near-zero mid luminance the way the ratio path guards its base', () => {
  const out = recolorByLuminance([0.01, 0.01, 0.01], 0, [1, 0, 0])
  for (const channel of out) {
    assert.ok(Number.isFinite(channel), `channel ${channel} is not finite`)
    assert.ok(channel <= 1.0 + 1e-9, `channel ${channel} exceeds 1.0`)
  }
})
