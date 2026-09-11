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
