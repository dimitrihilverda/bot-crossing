import { test } from 'node:test'
import assert from 'node:assert/strict'
import * as THREE from 'three'
import { assertIdentity, HEAD_BIND_EPS } from '../src/agents/head-bind.js'

/**
 * `crew.js`'s head bake (`boneInverse * world`, no `bindMatrix` term) is only exact because
 * the head mesh's `bindMatrix` and `matrixWorld` measure as the identity in the committed
 * `crew.glb`. `assertIdentity` is the guard that would catch a re-export changing that; it
 * lives in its own module specifically so it can be exercised here without pulling in
 * `crew.js`, which reads `import.meta.env.BASE_URL` at module scope and cannot be imported
 * under `node --test`.
 */

test('an identity matrix passes', () => {
  assert.doesNotThrow(() => assertIdentity('test.matrix', new THREE.Matrix4()))
})

test('noise well inside the epsilon passes', () => {
  const m = new THREE.Matrix4()
  m.elements[0] += HEAD_BIND_EPS / 10
  assert.doesNotThrow(() => assertIdentity('test.matrix', m))
})

test('a translation just past the epsilon is rejected', () => {
  const m = new THREE.Matrix4()
  m.elements[12] = HEAD_BIND_EPS * 2 // the translation-x element
  assert.throws(() => assertIdentity('Mannequin_Medium_Head.matrixWorld', m), {
    message: /Mannequin_Medium_Head\.matrixWorld is not the identity/,
  })
})

test('a real re-export offset — a bone nudged a millimetre — is rejected', () => {
  // A "millimetre" here is in the mannequin's own units, where the whole head is under one
  // unit across (see task-2-report.md's box D). Far above the epsilon, as any transform a
  // real re-export would introduce should be.
  const m = new THREE.Matrix4().makeTranslation(0.001, 0, 0)
  assert.throws(() => assertIdentity('Mannequin_Medium_Head.bindMatrix', m))
})

test('a non-identity rotation is rejected, not just translation', () => {
  const m = new THREE.Matrix4().makeRotationY(0.1)
  assert.throws(() => assertIdentity('Mannequin_Medium_Head.bindMatrix', m))
})

test('the thrown message names the mesh matrix and points at extractHead', () => {
  const m = new THREE.Matrix4().makeTranslation(1, 0, 0)
  assert.throws(() => assertIdentity('Mannequin_Medium_Head.bindMatrix', m), (err) => {
    assert.match(err.message, /Mannequin_Medium_Head\.bindMatrix/)
    assert.match(err.message, /extractHead/)
    return true
  })
})
