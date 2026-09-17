/**
 * Grafts a bicycle into the city kit.
 *
 * **Why this exists at all.** KayKit ships 23 packs and not one of them has a bicycle —
 * checked across all 203 parts of the four packs this colony loads. For a Dutch street that is
 * not a missing detail, it is the missing detail, so one part is borrowed from elsewhere:
 * Quaternius' CC0 "LowPoly Public Transport" pack (`Bicycle.obj`). One prop, not a fifth kit —
 * a whole foreign pack would sit *beside* KayKit rather than *in* it, and the colony is judged
 * against KayKit's own render.
 *
 * **What makes it belong.** The source model carries no colour at all: its four materials are
 * the same flat grey, because Quaternius colours in Blender rather than in the OBJ. So nothing
 * is being thrown away by ignoring them — each material is instead mapped to a cell of the
 * *city atlas*, and the bike comes out sampling the same texture, through the same shader, as
 * every building and car around it. The frame takes `CELL_CITY.ACCENT`, which is the cell
 * `decorate()` recolours per material, so a bike can be tinted the way a car is.
 *
 * Usage: build-bike.mjs <Bicycle.obj> <target.glb>
 *
 * Runs after `build-kit.mjs` has written the city glb, and is a no-op without the source —
 * the same rule every other step follows, since the raw packs are not checked in and the
 * built glb is. On a fresh clone the committed city.glb already has the bicycle in it.
 */
import { Document, NodeIO } from '@gltf-transform/core'
import { dedup, prune, weld } from '@gltf-transform/functions'
import { existsSync, readFileSync } from 'node:fs'

const [SRC, TARGET] = process.argv.slice(2)
if (!SRC || !TARGET) {
  console.error('usage: build-bike.mjs <Bicycle.obj> <target.glb>')
  process.exit(1)
}

if (!existsSync(SRC)) {
  if (existsSync(TARGET)) {
    console.log(`build-bike: no source model, keeping the existing ${TARGET}`)
    process.exit(0)
  }
  console.error(`build-bike: ${SRC} is missing and there is no ${TARGET} to keep`)
  process.exit(1)
}

/** The node the runtime looks the bicycle up by, the same way it looks up any kit part. */
const PART = 'bicycle'

const ATLAS = { cols: 8, rows: 4 }

/**
 * Which atlas cell each of the source model's materials is painted with.
 *
 * The source's own materials are four copies of the same grey, so this is not a translation of
 * anything — it is the colour decision, made here because this is where the geometry and the
 * atlas meet. Read off `tools/atlas-cells.mjs public/assets/city.glb`:
 *
 *  - `Bike` is the frame, and gets cell 5 — `CELL_CITY.ACCENT`, the one `decorate()` swaps per
 *    material. That is what lets a bike be tinted, exactly as a car is.
 *  - `Handle` is the bars: cell 20, the neutral grey the kit uses for bare metal.
 *  - `Wheel` is the tyre: cell 4, the flattest dark in the atlas.
 *  - `Material.003` is the saddle: cell 15, the kit's brown leather.
 */
const CELL_FOR = {
  Bike: 5,
  Handle: 20,
  Wheel: 4,
  'Material.003': 15,
}

/** The middle of an atlas cell — the edges are where one swatch bleeds into the next. */
function uvOf(cell) {
  const col = cell % ATLAS.cols
  const row = Math.floor(cell / ATLAS.cols)
  return [(col + 0.5) / ATLAS.cols, (row + 0.5) / ATLAS.rows]
}

/**
 * Where the model sits and how big it is, both measured rather than guessed.
 *
 * Measured from `Bicycle.obj`: 1.494 x 3.149 x 5.828, its wheels centred on y=0 with a radius
 * of 0.95, and its handlebars at negative z — so the model faces backwards by this kit's
 * convention, and stands on nothing.
 *
 * `SCALE` puts it at 42% of a car's authored length (0.938), which is the real ratio of a
 * bicycle to a car: 1.75m against 4.2m. Anchoring it to the car rather than to a guess at the
 * pack's metres-per-unit is what makes it look right parked beside one, which is where it will
 * always be seen.
 */
const SOURCE = { length: 5.828, wheelRadius: 0.95, centreZ: 0.2835 }
const SCALE = (0.938 * 0.42) / SOURCE.length

/** Parse the subset of OBJ this model uses: positions, normals, faces, and material runs. */
function readObj(path) {
  const positions = []
  const normals = []
  const faces = []
  let material = null

  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    if (line.startsWith('v ')) positions.push(line.slice(2).trim().split(/\s+/).map(Number))
    else if (line.startsWith('vn ')) normals.push(line.slice(3).trim().split(/\s+/).map(Number))
    else if (line.startsWith('usemtl ')) material = line.slice(7).trim()
    else if (line.startsWith('f ')) {
      const corners = line
        .slice(2)
        .trim()
        .split(/\s+/)
        .map((c) => {
          const [v, , n] = c.split('/')
          return { v: Number(v) - 1, n: n ? Number(n) - 1 : -1 }
        })
      // A fan, so a quad or any n-gon comes out as triangles. Blender exports these convex,
      // which is what makes a fan safe here.
      for (let i = 2; i < corners.length; i++) {
        faces.push({ material, corners: [corners[0], corners[i - 1], corners[i]] })
      }
    }
  }
  return { positions, normals, faces }
}

const { positions, normals, faces } = readObj(SRC)
if (!faces.length) {
  console.error(`build-bike: ${SRC} has no faces`)
  process.exit(1)
}

const unknown = [...new Set(faces.map((f) => f.material))].filter((m) => !(m in CELL_FOR))
if (unknown.length) {
  // A material this script has no colour for would come out sampling the atlas's top-left
  // corner — a silent wrong colour rather than a failure, which is the one outcome worth
  // refusing outright.
  console.error(`build-bike: no atlas cell for material(s) ${unknown.join(', ')}`)
  process.exit(1)
}

const POS = []
const NRM = []
const UV = []
for (const face of faces) {
  const [u, v] = uvOf(CELL_FOR[face.material])
  for (const corner of face.corners) {
    const p = positions[corner.v]
    // Turned a half circle about Y so the bicycle faces +Z, the way every part of this kit
    // does (see `pointAt`'s yaw convention in `drive-path.js`), then centred along its own
    // length and stood on the ground: the source model's wheels straddle y=0 rather than
    // resting on it, so a bicycle placed at ground height would be buried to its axles — the
    // same fault the cars had.
    POS.push(-p[0] * SCALE, (p[1] + SOURCE.wheelRadius) * SCALE, -(p[2] - SOURCE.centreZ) * SCALE)
    const n = corner.n >= 0 ? normals[corner.n] : [0, 1, 0]
    NRM.push(-n[0], n[1], -n[2])
    UV.push(u, v)
  }
}

const io = new NodeIO()
const doc = await io.read(TARGET)
const root = doc.getRoot()

// Reuse the kit's own material, so the bicycle samples the city atlas through the same
// texture the rest of the pack does rather than carrying a second copy of it.
const material = root.listMaterials()[0]
if (!material) {
  console.error(`build-bike: ${TARGET} has no material to share`)
  process.exit(1)
}

// Replacing rather than adding, so re-running this is idempotent instead of stacking a second
// bicycle inside the first.
for (const node of root.listNodes()) {
  if (node.getName() === PART) node.dispose()
}

const buffer = root.listBuffers()[0] ?? doc.createBuffer()
const prim = doc
  .createPrimitive()
  .setMaterial(material)
  .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(new Float32Array(POS)).setBuffer(buffer))
  .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(new Float32Array(NRM)).setBuffer(buffer))
  .setAttribute('TEXCOORD_0', doc.createAccessor().setType('VEC2').setArray(new Float32Array(UV)).setBuffer(buffer))

const node = doc.createNode(PART).setMesh(doc.createMesh(PART).addPrimitive(prim))
root.listScenes()[0].addChild(node)

// `weld` indexes the triangle soup the parser produces; the other two keep the document from
// growing a duplicate accessor or an orphan every time this runs.
await doc.transform(weld(), dedup(), prune())
await io.write(TARGET, doc)

const tris = POS.length / 9
console.log(`build-bike: grafted ${PART} into ${TARGET} (${tris} triangles, scale ${SCALE.toFixed(5)})`)
