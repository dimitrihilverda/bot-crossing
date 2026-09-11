import * as THREE from 'three'
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { GARMENT_SETS } from './garment-sets.js'

/**
 * Real skeletal animation for the whole crew, in one draw call.
 *
 * The body is KayKit's Mannequin_Medium and the motion is KayKit's Character Animations
 * (both CC0) — hand-authored walk cycles, hammering, sitting, cheering. What they are not
 * is instanceable: three skins a `SkinnedMesh` from a `Skeleton` object, one skeleton per
 * character, which for three hundred threads means three hundred draw calls and three
 * hundred skeletons stepped on the CPU every frame.
 *
 * So the animation is **baked once, at load, into a bone-matrix texture**. Every clip is
 * sampled at a fixed rate and each frame's twenty-one skinning matrices are written into a
 * float texture. At draw time one `InstancedMesh` carries the whole crew, and each instance
 * reads its own row of that texture from a single per-instance float — the frame it is on.
 * Skinning happens in the vertex shader against a texture fetch rather than against a
 * uniform block that would have to be re-uploaded per character.
 *
 * The cost is a texture of about a megabyte and a second of work at boot. What it buys is
 * that the crew costs the same whether there are six of them or six hundred.
 *
 * Because the matrices also sit in an ordinary array on the CPU, anything that has to ride
 * *on* a bone — the head, the hair, the hi-vis bands — can be placed by reading one matrix
 * out of it, with no skeleton to evaluate. See `attachMatrixAt(rig, frame, slot, out)`.
 */

/** Sampling rate for the bake. Fast enough that the shader's lerp has nothing to hide. */
const BAKE_FPS = 30

/** Floats per bone in the texture: a full mat4, four RGBA texels. */
const TEXELS_PER_BONE = 4

/**
 * Bones the colony hangs things off. Their *world* transforms are baked into a small
 * side-table on the CPU as well, because a hairstyle does not want the skinning matrix — it
 * wants to know where the head actually is. Three bones over the whole animation set is a
 * hundred and forty kilobytes; the alternative is evaluating a skeleton per astronaut per
 * frame.
 */
const ATTACH = ['head', 'chest', 'hand.r']

/**
 * The clips, and how the colony uses them. `loop` false means the clip is a one-shot that
 * holds on its last frame — which is what a sit-down or a spawn wants.
 */
const CLIP = {
  idle: { name: 'Idle_A', loop: true },
  idleAlt: { name: 'Idle_B', loop: true },
  walk: { name: 'Walking_A', loop: true },
  run: { name: 'Running_A', loop: true },
  work: { name: 'Hammering', loop: true },
  workAlt: { name: 'Working_A', loop: true },
  cheer: { name: 'Cheering', loop: true },
  jump: { name: 'Jump_Full_Short', loop: false },
  wave: { name: 'Waving', loop: true },
  // The sit is the chair sit, not the floor sit: a crew member that has heard nothing for
  // three days dozes off sitting on a moving box, and the floor sit has no room for one.
  sitDown: { name: 'Sit_Chair_Down', loop: false },
  sit: { name: 'Sit_Chair_Idle', loop: true },
  standUp: { name: 'Sit_Chair_StandUp', loop: false },
  hit: { name: 'Hit_A', loop: true },
  spawn: { name: 'Spawn_Ground', loop: false },
  interact: { name: 'Interact', loop: true },
  // The removals beat: stoop for a piece, hold it while you look at where it goes, then set
  // to work on it. `lift` is a one-shot that hands over to `carry`, the same way `sitDown`
  // hands over to `sit`.
  lift: { name: 'PickUp', loop: false },
  carry: { name: 'Holding_A', loop: true },
}

const CREW_URL = `${import.meta.env.BASE_URL}assets/crew.glb`

/**
 * How far a world matrix's elements may drift from another mesh's before `bakeClips`
 * refuses to trust that they describe the same placement. Same reasoning as `head-bind.js`'s
 * `HEAD_BIND_EPS`: a glTF transform is authored and stored as float32, and three composing it
 * into a `Matrix4` on load can leave a few ULPs of noise even where the source was exactly
 * equal — single-precision epsilon near 1 is on the order of 1e-7. 1e-6 clears that noise
 * floor while still catching any transform that would actually move a vertex.
 */
const WORLD_MATRIX_EPS = 1e-6

let loading = null
let rig = null

/** Load and bake the rig. Idempotent — the first caller owns the work. */
export function loadCrew() {
  if (!loading) loading = bake().then((r) => (rig = r))
  return loading
}

/** The baked rig, or null if `loadCrew()` has not resolved yet. */
export function crewRig() {
  return rig
}

async function bake() {
  const gltf = await new GLTFLoader().loadAsync(CREW_URL)
  const root = gltf.scene
  root.updateMatrixWorld(true)

  const skinned = []
  root.traverse((o) => {
    if (o.isSkinnedMesh) skinned.push(o)
  })
  if (!skinned.length) throw new Error('crew: crew.glb has no skinned mesh')

  const skeleton = skinned[0].skeleton
  const bones = skeleton.bones
  const boneIndex = new Map(bones.map((b, i) => [b.name, i]))

  // One geometry per garment set, and the material name three's loader gave that set's mesh
  // — read off the mesh rather than typed in, so a re-export can never silently disagree with
  // this table. Two sets resolving to the same material would mean both are sharing one
  // texture, which is one of them wearing the other's clothes, so that is a throw and not a
  // warning.
  const textureNames = new Map()
  const sets = GARMENT_SETS.map((set) => {
    const geometry = mergeSet(skinned, set.meshes)
    const bodyMesh = skinned.find((m) => m.name === set.meshes[0])
    const textureName = bodyMesh?.material?.name ?? ''
    const clash = textureNames.get(textureName)
    if (clash) {
      throw new Error(
        `crew: garment sets "${clash}" and "${set.id}" both resolve to material ` +
          `"${textureName}" — one of them is wearing the other's clothes`
      )
    }
    textureNames.set(textureName, set.id)
    // The actual image, alongside its name — the runtime paints the set's `InstancedMesh`
    // with this rather than re-loading anything, since the loader has it decoded already.
    const texture = bodyMesh?.material?.map ?? null
    return { id: set.id, geometry, textureName, texture }
  })

  const bake = bakeClips(root, skeleton, skinned, gltf.animations)

  return { sets, bones, boneIndex, ...bake }
}

/**
 * Three's loader sanitises node names on the way in — a dot is a path separator in an
 * animation track, so `hand.r` arrives as `handr`. Matching loosely costs nothing and the
 * alternative is a prop pinned to the world origin.
 */
const plain = (n) => n.replace(/[.\s_]/g, '').toLowerCase()

/**
 * Merge one garment set's six parts into one geometry, in the fixed order `meshNames` gives
 * so the result is byte-reproducible.
 *
 * They already share a skin, so the joint indices line up and no remapping is needed. The
 * UVs stay this time — the reverse of the mannequin-body merge this replaced, which dropped
 * them because the pack's own texture was a placeholder nobody wanted drawn. Here skin, hair
 * and eyes are three cells of the character's gradient atlas, addressed by UV, so a merged
 * geometry without them could never be repainted per mover at all: the UVs are the entire
 * colour mechanism this stage rests on.
 */
function mergeSet(skinned, meshNames) {
  const byName = new Map(skinned.map((m) => [m.name, m]))
  const parts = []

  for (const name of meshNames) {
    const mesh = byName.get(name)
    if (!mesh) throw new Error(`crew: crew.glb has no ${name}`)
    const geo = new THREE.BufferGeometry()
    const src = mesh.geometry
    const count = src.attributes.position.count

    for (const [attrName, size] of [
      ['position', 3],
      ['normal', 3],
      ['uv', 2],
      ['skinIndex', 4],
      ['skinWeight', 4],
    ]) {
      const a = src.getAttribute(attrName)
      if (!a) throw new Error(`crew: ${mesh.name} has no ${attrName}`)
      const data = new Float32Array(count * size)
      for (let i = 0; i < count; i++) {
        for (let k = 0; k < size; k++) data[i * size + k] = a.getComponent(i, k)
      }
      geo.setAttribute(attrName, new THREE.BufferAttribute(data, size))
    }
    if (src.index) geo.setIndex(Array.from(src.index.array))
    parts.push(geo)
  }

  const merged = parts.length === 1 ? parts[0] : BufferGeometryUtils.mergeGeometries(parts, false)
  if (merged !== parts[0]) parts.forEach((g) => g.dispose())
  merged.computeBoundingBox()
  return merged
}

/**
 * `bakeClips` folds `skinned[0]`'s own world matrix into every baked skinning matrix (see
 * `pre` below), on the assumption that every skinned mesh sits at the same place in the scene
 * graph. That assumption in turn rests on an invariant nobody asserted before now: Task 1's
 * garment re-parent assumed every source node it moved kept an identity local transform.
 * True today, but with twelve meshes across two sets instead of six on one
 * mannequin, a re-export that nudged even one of them would bake that mesh into the wrong
 * place with no shader error and no failing test — it would look exactly like a limb pinned
 * to the wrong bone, indistinguishable from a joint-remap bug without this guard naming the
 * actual offender.
 */
function assertSameWorldMatrix(skinned) {
  const base = skinned[0].matrixWorld.elements
  for (const mesh of skinned) {
    const e = mesh.matrixWorld.elements
    for (let i = 0; i < 16; i++) {
      if (Math.abs(e[i] - base[i]) > WORLD_MATRIX_EPS) {
        throw new Error(
          `crew: ${mesh.name}.matrixWorld differs from ${skinned[0].name}.matrixWorld ` +
            `(element ${i} is ${e[i]}, expected ${base[i]} within ${WORLD_MATRIX_EPS}) — ` +
            `bakeClips folds ${skinned[0].name}'s world matrix into every baked skinning ` +
            `matrix, so a mesh sitting at a different world transform would be baked into ` +
            `the wrong place. Restore an identity local transform on the offending node's ` +
            `source, or fold its own world matrix into the bake as well.`
        )
      }
    }
  }
}

/**
 * Step every clip and record the skinning matrices.
 *
 * What is stored is the matrix the shader can use directly — three's bind matrices folded
 * in — so the vertex stage is a plain weighted sum with nothing left to reconstruct.
 */
function bakeClips(root, skeleton, skinned, animations) {
  assertSameWorldMatrix(skinned)
  const mesh = skinned[0]
  const boneCount = skeleton.bones.length
  const byName = new Map(animations.map((a) => [a.name, a]))

  // Lay the clips out end to end in one table and remember where each one starts.
  const clips = {}
  let frameCount = 0
  for (const [key, spec] of Object.entries(CLIP)) {
    const clip = byName.get(spec.name)
    if (!clip) {
      console.warn(`crew: crew.glb has no clip "${spec.name}" — run \`npm run assets\``)
      continue
    }
    // A looping clip needs its wrap-around frame; a one-shot ends where it ends.
    const frames = Math.max(2, Math.round(clip.duration * BAKE_FPS) + 1)
    clips[key] = { start: frameCount, frames, duration: clip.duration, loop: spec.loop, name: spec.name }
    frameCount += frames
  }

  const stride = boneCount * TEXELS_PER_BONE * 4
  const data = new Float32Array(frameCount * stride)

  // Side-table of world transforms for the attachment bones — what the head, the hair and the
  // bands read. The skinning matrices in `data` cannot answer "where is the head": they map bind
  // space to posed space, which is only the same thing when the bind matrices are identity.
  // Names are matched through `plain()` above, because three sanitises them on the way in.
  const attachBones = ATTACH.map((name) => skeleton.bones.findIndex((b) => plain(b.name) === plain(name)))
  const lost = ATTACH.filter((_, i) => attachBones[i] < 0)
  if (lost.length) throw new Error(`crew: no bone for attachment ${lost.join(', ')}`)
  const attach = new Float32Array(frameCount * ATTACH.length * 16)

  const mixer = new THREE.AnimationMixer(root)
  const scratch = new THREE.Matrix4()
  // `world * bindMatrixInverse * bone * bindMatrix` is the whole of three's skinning
  // pipeline for a vertex, so baking it means the shader has only the weighted sum left.
  // The mesh's own world matrix belongs in there because the merged geometry is left in
  // its authored frame rather than being pre-transformed.
  const bind = mesh.bindMatrix
  const pre = new THREE.Matrix4().multiplyMatrices(mesh.matrixWorld, mesh.bindMatrixInverse)

  for (const spec of Object.values(clips)) {
    const clip = byName.get(spec.name)
    const action = mixer.clipAction(clip)
    action.play()

    for (let f = 0; f < spec.frames; f++) {
      const raw = spec.frames > 1 ? (f / (spec.frames - 1)) * spec.duration : 0
      // The last frame of a loop is the clip's own end, which equals its start again — that
      // is exactly the wrap frame the shader interpolates into. A one-shot must stop just
      // short of it: sampled at precisely its duration the mixer's default loop mode wraps,
      // so the frame a sit-down or a spawn *holds* would be the pose it started from, and
      // the astronaut snaps back to standing on the last frame of sitting down.
      const t = spec.loop ? raw : Math.min(raw, Math.max(0, spec.duration - 1e-3))
      mixer.setTime(t)
      root.updateMatrixWorld(true)
      skeleton.update()

      const offset = (spec.start + f) * stride
      for (let b = 0; b < boneCount; b++) {
        scratch.fromArray(skeleton.boneMatrices, b * 16)
        scratch.premultiply(pre).multiply(bind)
        scratch.toArray(data, offset + b * 16)
      }

      const attachOffset = (spec.start + f) * ATTACH.length * 16
      attachBones.forEach((b, slot) => {
        if (b < 0) return
        skeleton.bones[b].matrixWorld.toArray(attach, attachOffset + slot * 16)
      })
    }

    action.stop()
  }

  const texture = new THREE.DataTexture(
    data,
    boneCount * TEXELS_PER_BONE,
    frameCount,
    THREE.RGBAFormat,
    THREE.FloatType
  )
  texture.minFilter = THREE.NearestFilter
  texture.magFilter = THREE.NearestFilter
  texture.generateMipmaps = false
  texture.needsUpdate = true

  mixer.stopAllAction()
  mixer.uncacheRoot(root)

  return {
    boneTexture: texture,
    attach,
    attachSlot: new Map(ATTACH.map((name, i) => [name, i])),
    boneCount,
    frameCount,
    clips,
    fps: BAKE_FPS,
  }
}

/**
 * Where an attachment bone is, in character space, on a given frame.
 *
 * This is how anything worn rather than skinned gets placed: the head and the hair read
 * `head`, the bands read `chest`. A straight array slice — no skeleton is evaluated and
 * nothing is allocated. The frame is rounded rather than interpolated; at 30 fps the worst
 * case is half a frame of lag on a worn part whose own body is drawn from the same table, and
 * matrix interpolation here would cost more than it is worth.
 */
export function attachMatrixAt(rig, frame, slot, out) {
  const f = Math.min(rig.frameCount - 1, Math.max(0, Math.round(frame)))
  return out.fromArray(rig.attach, (f * ATTACH.length + slot) * 16)
}

/**
 * Where in the frame table an agent is, given a clip and how long it has been playing.
 * Looping clips wrap; one-shots hold their last frame.
 */
export function frameFor(clip, time) {
  if (!clip) return 0
  const last = clip.frames - 1
  const f = time * BAKE_FPS
  return clip.start + (clip.loop ? f % last : Math.min(f, last))
}

/**
 * Adds GPU skinning to any three material.
 *
 * Slotted in around `<beginnormal_vertex>` and `<begin_vertex>`, which are upstream of
 * three's own instancing — so the skinned vertex still goes through `instanceMatrix` and
 * the crew stays one instanced draw. Three's `USE_SKINNING` path is deliberately not used:
 * it binds to a `Skeleton` object, which is the thing being replaced.
 *
 * `normals` must be false for the shadow pass. Three's depth shader only includes
 * `<beginnormal_vertex>` behind `USE_DISPLACEMENTMAP`, so a depth material decorated as if
 * it had normals would skin against an uninitialised matrix and the crew would cast the
 * shadow of a folded-up bind pose.
 */
export function decorateSkinned(material, uniforms, { normals = true } = {}) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute vec4 skinIndex;
         attribute vec4 skinWeight;
         attribute float aFrame;
         uniform highp sampler2D uBones;
         uniform float uFrameMax;

         mat4 boneAt( int bone, int row ) {
           int x = bone * ${TEXELS_PER_BONE};
           return mat4(
             texelFetch( uBones, ivec2( x + 0, row ), 0 ),
             texelFetch( uBones, ivec2( x + 1, row ), 0 ),
             texelFetch( uBones, ivec2( x + 2, row ), 0 ),
             texelFetch( uBones, ivec2( x + 3, row ), 0 )
           );
         }

         // The two rows either side of a fractional frame, mixed. A component-wise mix of
         // two skinning matrices is not a true interpolation, but a thirtieth of a second
         // apart the error is far below a pixel and it costs one instruction. Both rows are
         // clamped: a one-shot clip holds on its last frame, and its "next" row would
         // otherwise be the first frame of whatever clip was baked after it.
         mat4 botSkinMatrix() {
           float f = clamp( aFrame, 0.0, uFrameMax );
           int a = int( floor( f ) );
           int b = min( a + 1, int( uFrameMax ) );
           float t = f - float( a );
           mat4 m = mat4( 0.0 );
           for ( int i = 0; i < 4; i ++ ) {
             float w = skinWeight[ i ];
             if ( w <= 0.0 ) continue;
             int bone = int( skinIndex[ i ] );
             m += w * ( boneAt( bone, a ) * ( 1.0 - t ) + boneAt( bone, b ) * t );
           }
           return m;
         }

         mat4 botSkin;`
      )

    if (normals) {
      // Three runs the normal stage first, so the matrix is built there and the position
      // stage reuses it — one set of texture fetches per vertex rather than two.
      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <beginnormal_vertex>',
          `#include <beginnormal_vertex>
           botSkin = botSkinMatrix();
           objectNormal = mat3( botSkin ) * objectNormal;`
        )
        .replace(
          '#include <begin_vertex>',
          `#include <begin_vertex>
           transformed = ( botSkin * vec4( transformed, 1.0 ) ).xyz;`
        )
    } else {
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         botSkin = botSkinMatrix();
         transformed = ( botSkin * vec4( transformed, 1.0 ) ).xyz;`
      )
    }
  }
  return material
}
