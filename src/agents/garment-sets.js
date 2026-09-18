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
 * This module's own code touches no three.js API — `SET_PARTS`, `setMeshNames` and
 * `GARMENT_SETS` are plain data — but `garmentSetIndexFor` below imports two things,
 * `hashString` (from `world/plots.js`) and `avalanche` (from `hair.js`, which does depend on
 * three), and only those: this module deliberately cannot reach anything that knows about
 * status, the same discipline `skin.js` and `hair.js` follow, asserted the same structural way
 * theirs are.
 *
 * `tools/build-crew.mjs` still cannot import this file, for a reason that has nothing to do
 * with three: `hashString`'s own module, `world/plots.js`, pulls in `world/kit.js`, which
 * reads `import.meta.env` and throws outside a bundler. So the build tool keeps its own
 * literal copy of the mesh names instead — see `test/crew-glb.test.mjs`'s cross-check.
 */
import { hashString } from '../world/plots.js'
import { avalanche } from './hair.js'

/** The six parts, in a fixed order so a merged geometry is byte-reproducible. */
export const SET_PARTS = Object.freeze(['Body', 'ArmLeft', 'ArmRight', 'LegLeft', 'LegRight', 'Head'])

/** The mesh node names one character contributes. */
export const setMeshNames = (prefix) => SET_PARTS.map((part) => `${prefix}_${part}`)

export const GARMENT_SETS = Object.freeze([
  { id: 'ranger', prefix: 'Ranger', file: 'Ranger.glb', meshes: setMeshNames('Ranger') },
  { id: 'rogue', prefix: 'Rogue', file: 'Rogue.glb', meshes: setMeshNames('Rogue') },
])

/**
 * Which set a thread wears. A pure function of its id, resolved once when the agent is
 * created — **never** derived from status. The uniform says who a crew member is, the way
 * its skin tone does, and it is one of the few things on the figure a status change cannot
 * move.
 *
 * Salting alone would not be enough here, for the reason `hairToneIndexFor` in `hair.js`
 * spells out at length: plain FNV-1a (`hashString`) never mixes its own lowest bit, so two
 * hashes taken with an even modulus each — this one's `% 2` and skin tone's `% 6` — would
 * inherit the same parity and move in lockstep, and a status quality this test actually
 * checks (`test/garment-sets.test.mjs`'s joint-distribution test) would fail. So this reuses
 * `hair.js`'s own `avalanche` (the `lowbias32` finalizer) rather than reimplementing it, and
 * salts with its own prefix — distinct from `hair:` — purely so the two hashes would still
 * differ even if the finalizer were ever revisited.
 */
export const garmentSetIndexFor = (id) => avalanche(hashString(`garment:${String(id)}`)) % GARMENT_SETS.length
export const garmentSetFor = (id) => GARMENT_SETS[garmentSetIndexFor(id)]
