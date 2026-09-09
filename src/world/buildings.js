import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { ATLAS, part } from './kit.js'

/**
 * Shared building machinery — the reveal/construction shader (`decorate`, `depthMaterial`)
 * and the part-placement helper (`Composer`) that `src/world/houses.js` builds every house
 * out of.
 *
 * The timber scaffolding overlay that used to live here is gone. Saying "a thread is running
 * here" is now the job of a delivery car parked at the house — see `src/world/deliveries.js`
 * and `colony._updateDeliveries` — so there is nothing left to prop up.
 *
 * This file used to also assemble the colony's structures directly, out of KayKit's *Space
 * Base Bits* (CC0) — ten seeded recipes (habitat, solar array, relay mast, and so on) dispatched
 * by `createBuilding()`. That entry point and its catalogue are gone: `colony.js` now calls
 * `houses.js`'s `createHouse()` instead. What is left here is exactly the part `houses.js`
 * still depends on.
 *
 * Three things ride on top of the pack's own art, still true of everything built through
 * `decorate()`:
 *
 * 1. **Construction progress sinks a structure into the ground.** The vertex stage lowers
 *    the whole thing and the fragment stage discards whatever ends up below the deck, so
 *    it rises as it grows without ever touching a vertex buffer — and what is on screen is
 *    always a *complete* structure, part of it buried. Slicing the top off instead, which is
 *    what this used to do, guts a kit of closed shells: at two-thirds finished a biodome loses
 *    its entire dome and becomes an empty ring.
 * 2. **The accent is a repainted atlas cell.** The fragment stage swaps one swatch's hue for
 *    the repo's accent while keeping the swatch's own light-to-dark gradient. One repo, one
 *    colour, no extra material.
 * 3. **PBR comes from the atlas too.** Roughness and metalness are looked up per cell, so a
 *    flat texture behaves like brushed metal in one place and glass in another, even though
 *    both arrive as flat colour in a single texture.
 */

/** Shared across every building, so night falling is one uniform write for the whole colony. */
export const buildingUniforms = {
  uNight: { value: 0 },
  /** Seconds, for anything that turns. One write drives every rotor in the colony. */
  uTime: { value: 0 },
}

/** Sizes the per-cell uniform arrays `decorate()` and `depthMaterial()` declare below. */
const CELL_COUNT = ATLAS.cols * ATLAS.rows

// ── composition ───────────────────────────────────────────────────────────────────────

/**
 * A tiny placement helper. Parts are baked to the building's own frame as they are added,
 * each carrying a per-vertex emissive flag, so the whole lot merges into one buffer.
 */
export class Composer {
  /**
   * @param {object} [o]
   * @param {string} [o.kit]  which registry parts resolve against. A merged geometry can
   *   only carry one material, so one Composer means one kit.
   */
  constructor({ kit = 'base' } = {}) {
    this.parts = []
    this.kit = kit
  }

  /**
   * @param {string} name  a node name from the kit
   * @param {object} [o]   `x`/`y`/`z` offset, `ry` yaw, `s` uniform scale, `emissive` 0..1,
   *                       `reveal` the progress this part waits for
   */
  add(name, o = {}) {
    const geo = part(name, this.kit, { solo: o.solo })
    const s = o.s ?? 1
    if (s !== 1) geo.scale(s, s, s)
    if (o.ry) geo.rotateY(o.ry)
    geo.translate(o.x || 0, o.y || 0, o.z || 0)

    const count = geo.attributes.position.count
    geo.setAttribute('aEmissive', new THREE.BufferAttribute(new Float32Array(count).fill(o.emissive || 0), 1))

    // The progress at which this part starts being drawn at all. Written here, per part,
    // because `finish()` merges everything into one buffer with no seams left to address —
    // the same reason `aEmissive` is written here. Zero, the default, means "always drawn",
    // which is every structure in the space base kit.
    geo.setAttribute('aReveal', new THREE.BufferAttribute(new Float32Array(count).fill(o.reveal || 0), 1))

    // Rotors turn in the vertex shader rather than as child meshes, so a turbine is still
    // one merged geometry and one draw call. Each spinning vertex carries the hub it turns
    // about and how fast, which is what lets one building hold several of them.
    const rate = o.spin || 0
    const spin = new Float32Array(count).fill(rate)
    const pivot = new Float32Array(count * 3)
    if (rate) {
      for (let i = 0; i < count; i++) {
        pivot[i * 3] = o.x || 0
        pivot[i * 3 + 1] = o.y || 0
        pivot[i * 3 + 2] = o.z || 0
      }
    }
    geo.setAttribute('aSpin', new THREE.BufferAttribute(spin, 1))
    geo.setAttribute('aPivot', new THREE.BufferAttribute(pivot, 3))

    this.parts.push(geo)
    return this
  }

  /** Scatter `count` copies of a part around a ring, jittered so it never reads as a pattern. */
  ring(name, count, radius, rand, o = {}) {
    for (let i = 0; i < count; i++) {
      const a = (i / count) * Math.PI * 2 + rand() * 0.5
      const r = radius * (0.85 + rand() * 0.3)
      this.add(name, { ...o, x: Math.cos(a) * r, z: Math.sin(a) * r, ry: a + Math.PI / 2 })
    }
    return this
  }

  finish() {
    const merged = BufferGeometryUtils.mergeGeometries(this.parts, false)
    for (const p of this.parts) p.dispose()
    merged.computeBoundingBox()
    return merged
  }
}

// ── the reveal shader ─────────────────────────────────────────────────────────────────

/**
 * Everything the atlas makes possible, in one `onBeforeCompile`.
 *
 * Progress lowers the building and discards whatever falls below ground, with the band just
 * above that line painted in the accent — the "under construction" glow.
 * The accent also replaces the gold trim swatch outright, and per-cell roughness and
 * metalness turn one flat texture into a surface with metal, paint and glass in it.
 *
 * Progress has a second reading, which is what `src/world/houses.js` uses: a vertex tagged
 * with an `aReveal` above the current progress is not drawn at all. The two are independent,
 * and `uSink` picks which one a mesh gets — 1 for a structure that rises out of the ground,
 * 0 for one that is whole from the first frame and reveals its parts one at a time instead.
 * One shader rather than two because a patch this long, copied, drifts.
 */
export function decorate(material, uniforms) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aEmissive;
         attribute float aSpin;
         attribute vec3 aPivot;
         attribute float aReveal;
         varying float vEmissive;
         varying vec2 vAtlasUv;
         varying float vLocalY;
         varying float vReveal;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uSink;
         uniform float uTime;

         // Turn a point about the Z axis through a hub. The pack's rotors are modelled as
         // vertical discs facing along Z, which is the axis a wind turbine actually turns on.
         vec3 botSpin( vec3 p, vec3 hub, float angle ) {
           vec3 r = p - hub;
           float s = sin( angle );
           float c = cos( angle );
           return hub + vec3( r.x * c - r.y * s, r.x * s + r.y * c, r.z );
         }`
      )
      .replace(
        '#include <beginnormal_vertex>',
        `#include <beginnormal_vertex>
         if ( aSpin > 0.0 ) objectNormal = botSpin( objectNormal, vec3( 0.0 ), uTime * aSpin );`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vEmissive = aEmissive;
         vReveal = aReveal;
         // Our own copy of the UV: three renames its map varying between versions, and the
         // cell lookup below has to survive that.
         vAtlasUv = uv;
         if ( aSpin > 0.0 ) transformed = botSpin( transformed, aPivot, uTime * aSpin );
         // Measured *after* the rotor has turned, so a blade sweeping past the ground line
         // is revealed and hidden by the same rule as everything else.
         vLocalY = transformed.y;
         // The whole structure is lowered into the ground, and the fragment stage throws
         // away whatever ends up below the deck. What is on screen is therefore always a
         // *complete* building, part of it buried — never a sliced one.
         transformed.y -= uSink * ( 1.0 - uProgress ) * ( uMaxY - uMinY );`
      )

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vEmissive;
         varying vec2 vAtlasUv;
         varying float vLocalY;
         varying float vReveal;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uSink;
         uniform vec3 uAccent;
         uniform float uNight;
         uniform float uCellAccent[ ${CELL_COUNT} ];
         uniform float uCellRoughness[ ${CELL_COUNT} ];
         uniform float uCellMetalness[ ${CELL_COUNT} ];

         // Which swatch of the 8x4 gradient atlas this fragment landed in.
         int atlasCell() {
           int cx = int( clamp( floor( vAtlasUv.x * ${ATLAS.cols}.0 ), 0.0, ${ATLAS.cols - 1}.0 ) );
           int cy = int( clamp( floor( vAtlasUv.y * ${ATLAS.rows}.0 ), 0.0, ${ATLAS.rows - 1}.0 ) );
           return cy * ${ATLAS.cols} + cx;
         }`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         // A piece the progress has not reached yet is simply not there. Zero, which is
         // what every space base part carries, is always reached.
         if ( vReveal > uProgress ) discard;
         // Ground level, in the building's own frame, as it sinks. Measured from the
         // geometry's real floor rather than from zero: a few parts of the kit — a rover's
         // wheels, a crate's skids — sit a little proud of it, and testing against zero
         // would cut them off a building that is otherwise finished.
         float ground = uMinY + uSink * ( 1.0 - uProgress ) * ( uMaxY - uMinY );
         if ( vLocalY < ground - 0.001 ) discard;
         int cell = atlasCell();`
      )
      // The accent repaint. Luminance carries the swatch's own gradient across, so the trim
      // keeps its shading instead of going flat the moment it changes colour.
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float accentAmount = uCellAccent[ cell ];
         if ( accentAmount > 0.0 ) {
           float lum = dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
           diffuseColor.rgb = mix( diffuseColor.rgb, uAccent * clamp( lum * 1.9, 0.3, 1.5 ), accentAmount );
         }`
      )
      // Per-cell PBR: painted panels, brushed metal and photovoltaic glass in one texture.
      .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = uCellRoughness[ cell ];')
      .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = uCellMetalness[ cell ];')
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
         // Lamps and beacons, flagged per vertex when the recipe placed them.
         totalEmissiveRadiance += diffuseColor.rgb * vEmissive * ( 0.25 + uNight * 2.4 );
         // Window strips and trim come on after dark, in the repo's own colour.
         totalEmissiveRadiance += uAccent * uCellAccent[ cell ] * uNight * 1.15;
         // The construction line: a bright band riding just above the ground it rises from.
         // Only for something that is actually rising — a house is whole from the first
         // frame, and a glowing stripe along its floor is not a construction line.
         float band = 1.0 - smoothstep( 0.0, 0.22, vLocalY - ground );
         totalEmissiveRadiance += uAccent * band * uSink * ( 1.0 - step( 0.999, uProgress ) ) * 1.5;`
      )
  }
  return material
}

/**
 * Shadows are rendered with three's own depth material, which knows nothing about the
 * sink — so without this a building at ten percent still casts its finished silhouette from
 * its finished position. The depth pass gets the same offset and the same discards, reading
 * the very same uniform objects — including the per-piece reveal, without which a house's
 * unarrived furniture still throws a shadow on the lawn.
 */
export function depthMaterial(uniforms) {
  const mat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking })
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, uniforms)
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         attribute float aSpin;
         attribute vec3 aPivot;
         attribute float aReveal;
         varying float vLocalY;
         varying float vReveal;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uSink;
         uniform float uTime;

         vec3 botSpin( vec3 p, vec3 hub, float angle ) {
           vec3 r = p - hub;
           float s = sin( angle );
           float c = cos( angle );
           return hub + vec3( r.x * c - r.y * s, r.x * s + r.y * c, r.z );
         }`
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         if ( aSpin > 0.0 ) transformed = botSpin( transformed, aPivot, uTime * aSpin );
         vLocalY = transformed.y;
         vReveal = aReveal;
         transformed.y -= uSink * ( 1.0 - uProgress ) * ( uMaxY - uMinY );`
      )
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying float vLocalY;
         varying float vReveal;
         uniform float uProgress;
         uniform float uMaxY;
         uniform float uMinY;
         uniform float uSink;`
      )
      .replace(
        '#include <clipping_planes_fragment>',
        `#include <clipping_planes_fragment>
         if ( vReveal > uProgress ) discard;
         if ( vLocalY < uMinY + uSink * ( 1.0 - uProgress ) * ( uMaxY - uMinY ) - 0.001 ) discard;`
      )
  }
  return mat
}
