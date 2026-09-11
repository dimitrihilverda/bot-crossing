import * as THREE from 'three'

/**
 * The precondition `crew.js`'s head bake depends on, pulled out into its own module for one
 * reason: `crew.js` reads `import.meta.env.BASE_URL` at module scope to build `CREW_URL`, so
 * it cannot be imported under `node --test` — the same reason `growth.js` and `drive-path.js`
 * exist. This file has no such statement, so the one part of `extractHead`'s bake that is
 * worth asserting in a unit test — the guard that catches a re-exported `crew.glb` breaking
 * the bake's assumption — can actually be tested. See the comment above `extractHead` in
 * `crew.js` for the derivation this guard protects.
 */

/**
 * How far a matrix element may sit from the identity's own 0s and 1s before `assertIdentity`
 * refuses to trust it. A glTF transform is authored and stored as float32, and composing it
 * into a `Matrix4` (three does this on load) can leave a few ULPs of noise even where the
 * source was exactly the identity — single-precision epsilon near 1 is on the order of 1e-7.
 * 1e-6 sits a couple of orders of magnitude above that noise floor while still catching any
 * transform that would actually move a vertex: on this rig's scale even a small deliberate
 * offset (a re-exported root node nudged, say, a millimetre) lands many orders of magnitude
 * above this threshold. Measured on the committed `crew.glb`: both matrices `extractHead`
 * checks are bit-exact identity, `max|element - identity| = 0`.
 */
export const HEAD_BIND_EPS = 1e-6

const IDENTITY_ELEMENTS = new THREE.Matrix4().elements

/**
 * Fail loudly if a matrix `crew.js`'s head bake depends on being the identity is not one,
 * within `HEAD_BIND_EPS`. `label` is folded into the thrown message so the failure names the
 * mesh and the matrix, not just "something is wrong".
 */
export function assertIdentity(label, matrix) {
  const e = matrix.elements
  for (let i = 0; i < 16; i++) {
    if (Math.abs(e[i] - IDENTITY_ELEMENTS[i]) > HEAD_BIND_EPS) {
      throw new Error(
        `crew: ${label} is not the identity (element ${i} is ${e[i]}, expected ` +
          `${IDENTITY_ELEMENTS[i]} within ${HEAD_BIND_EPS}) — extractHead()'s head bake in ` +
          `crew.js assumes this mesh's bindMatrix equals its matrixWorld (both identity ` +
          `today); see the comment above extractHead() for why, and restore the missing ` +
          `bindMatrix term in the bake before trusting head placement on a re-exported ` +
          `crew.glb.`
      )
    }
  }
}
