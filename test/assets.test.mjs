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
