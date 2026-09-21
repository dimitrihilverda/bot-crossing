/**
 * Packs every source pack the colony needs into the six glbs it loads.
 *
 * The raw packs are not checked in and the built glbs are, so this is a no-op on a fresh
 * clone — it only has work to do when a pack has been re-downloaded into `assets-src/` or
 * one of the lists below has changed.
 */
import { spawnSync } from 'node:child_process'

/**
 * Which of the Forest Nature Pack's 105 models to keep.
 *
 * The pack ships every model in several sizes and colour variants; the colony wants a
 * handful of silhouettes and gets its variety from per-instance scale and rotation instead,
 * so packing the lot would be five times the file for no more to look at.
 */
const FOREST = [
  // Canopies: round, flat-top and fir, each in a common size, plus a rarer large one.
  'Tree_1_A', 'Tree_3_A', 'Tree_4_A', 'Tree_1_C', 'Tree_3_C', 'Tree_4_C',
  'Bush_1_E', 'Bush_3_B',
  'Grass_2_D',
  // Boulders. Painted neutral grey, which is what lets them be tinted per planet.
  'Rock_1_D', 'Rock_2_C', 'Rock_3_E', 'Rock_1_J', 'Rock_2_G', 'Rock_3_L', 'Rock_3_Q',
].map((n) => `${n}_Color1`)

/**
 * Which of Prototype Bits' 72 models to keep.
 *
 * The pack is a modular building kit — walls, openings, roof slopes, beams — and the colony
 * wants it for exactly one thing: composing a building the city kit has no shell for. So this
 * is the structural half of the pack plus a little yard clutter, and none of its targets,
 * coins, tables or dummies.
 */
const PROTOTYPE = [
  // Walls and what goes in them.
  'Primitive_Wall', 'Primitive_Wall_Half', 'Primitive_Wall_Short', 'Primitive_Wall_OpenCorner',
  'Primitive_Doorway', 'Primitive_Window',
  // A roof, with the corners a hipped one needs.
  'Primitive_Slope', 'Primitive_Slope_Half', 'Primitive_Slope_InnerCorner', 'Primitive_Slope_OuterCorner',
  // Structure and plain mass.
  'Primitive_Beam', 'Primitive_Pillar', 'Primitive_Cube', 'Primitive_Cube_Small', 'Primitive_Floor',
  // The yard.
  'Pallet_Large', 'Pallet_Small', 'Barrel_A', 'Box_A',
]

const STEPS = [
  ['tools/build-kit.mjs', 'assets-src/KayKit_Space_Base_Bits_1.0_FREE/Assets/gltf', 'public/assets/spacebase.glb'],
  ['tools/build-kit.mjs', 'assets-src/KayKit_Forest_Nature_Pack_1.0_FREE/Assets/gltf', 'public/assets/forest.glb', FOREST.join(',')],
  ['tools/build-kit.mjs', 'assets-src/KayKit_City_Builder_Bits_1.0_FREE/Assets/gltf', 'public/assets/city.glb'],
  // Straight after the city kit and never before it: `build-kit` rewrites city.glb from the
  // pack, and the pack has no bicycle — KayKit ships none, in any of its 23 packs. Grafting
  // one in therefore has to be the step that follows. See `build-bike.mjs` for where it comes
  // from and why it is one borrowed part rather than a fifth kit.
  ['tools/build-bike.mjs', 'assets-src/Quaternius_LowPoly_Public_Transport/Bicycle.obj', 'public/assets/city.glb'],
  ['tools/build-kit.mjs', 'assets-src/KayKit_Furniture_Bits_1.0_FREE/Assets/gltf', 'public/assets/furniture.glb'],
  ['tools/build-kit.mjs', 'assets-src/KayKit_Prototype_Bits_1.1_FREE/Assets/gltf', 'public/assets/prototype.glb', PROTOTYPE.join(',')],
  ['tools/build-crew.mjs'],
]

for (const [script, ...args] of STEPS) {
  const run = spawnSync(process.execPath, [script, ...args], { stdio: 'inherit' })
  if (run.status !== 0) process.exit(run.status ?? 1)
}
