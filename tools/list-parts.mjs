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
