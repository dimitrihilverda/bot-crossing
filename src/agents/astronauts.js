import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { buildFaceAtlas, FACE, FACE_LOOPS, FRAME_COLS, FRAME_ROWS } from './faces.js'
import { attachMatrixAt, decorateSkinned, frameFor } from './crew.js'
import { HAIR_STYLES, hairStyleIndexFor } from './hair.js'
import { GARMENT_SETS, garmentSetIndexFor } from './garment-sets.js'
import { bandPulse } from './band-pulse.js'
import { SUIT_TONES } from './workwear.js'

/**
 * Every astronaut in the colony, drawn in a handful of draw calls.
 *
 * The body is one instanced, GPU-skinned mesh playing KayKit's hand-animated clips (see
 * `crew.js`) — every torso, arm and leg in the colony in a single draw, whether there are
 * six threads or three hundred. The screen-face stays procedural and stays in its own
 * `InstancedMesh`, because it carries the colony's own identity and its own shader.
 *
 * Worn parts are pinned to bones the cheap way. The baked animation lives in an ordinary
 * array as well as in the texture the shader samples, so placing the head or a hairstyle is
 * one matrix read out of that array — no skeleton is evaluated on the CPU, and a worn part
 * can never be a frame out of step with the bone it sits on.
 *
 * Per-agent variation that would normally need a separate material rides along as instanced
 * attributes instead: suit colour and eye colour through `instanceColor`, the face's atlas
 * frame and the body's animation frame through custom `aFrame` attributes.
 *
 * Picking is done analytically rather than by raycasting the instanced meshes — projecting
 * N head positions to screen space is both cheaper and far more forgiving to click at the
 * size these characters render.
 */

/**
 * One hair colour for every style. Deliberately not per-agent: at the size a crew member
 * renders, the silhouette is what tells two of them apart and the shade of a dark head of
 * hair is not, so a second per-agent colour would be spend without a picture to show for it.
 * Dark enough to read as hair against every one of the six skin tones.
 */
const HAIR_TONE = 0x2b2320

/** The part name a style's instanced mesh is registered under, so `parts` stays one flat map. */
const hairPartName = (styleIndex) => `hair_${HAIR_STYLES[styleIndex].name}`

/**
 * Trim + eye colour per behaviour. Eyes are pushed past 1.0 so the bloom pass catches them.
 *
 * The keys are the six statuses of `STATUS_ORDER` plus the two states an agent passes
 * through on its way in and out — that list is the behaviour precedence and is not this
 * table's business. Only the colours are: they read as a removal crew's work clothing now,
 * hi-vis and denim and canvas, rather than as suit trim on a moon base.
 *
 * Two of them are load-bearing rather than decorative and stay where they are. `blocked` is
 * red and `waiting` is blue because those are the states the `!` and `?` badges point at,
 * and the badge and the figure under it have to agree at a glance.
 */
const AGENT_LOOK = {
  // Hi-vis vest, which is what somebody actually working on a lot is wearing.
  working: { trim: 0x74b03c, eye: [0.5, 2.5, 0.9] },
  // Denim, keeping the blue the `?` badge points at.
  waiting: { trim: 0x46689e, eye: [0.45, 1.5, 3.0] },
  // Safety red, keeping the red the `!` badge points at.
  blocked: { trim: 0xc4483c, eye: [3.0, 0.5, 0.45] },
  // Hi-vis tape amber — the warm end of the same workwear palette.
  celebrating: { trim: 0xd9a13c, eye: [2.9, 2.1, 0.6] },
  // Canvas overalls, still the quietest thing on the lot.
  idle: { trim: 0xa2937a, eye: [1.1, 1.4, 1.5] },
  // Navy work jacket, done for the day.
  sleeping: { trim: 0x4c5468, eye: [0.7, 0.8, 1.4] },
  // Removal-firm orange, for the crew member climbing out of the delivery car.
  spawning: { trim: 0xd2703f, eye: [2.4, 1.4, 0.7] },
  // Oiled leather, on its way back to the depot.
  leaving: { trim: 0x7a6a58, eye: [1.0, 1.0, 1.05] },
}

/**
 * How far past 1.0 a hi-vis band's trim colour is pushed, so the bloom pass can catch it.
 *
 * The antenna tip and the chest lamp did exactly this and this is their scheme, kept: an
 * unlit material, the status colour, one scalar. The value is the measured one rather than
 * an inherited one, because the shape changed and so did what clears the threshold.
 *
 * `engine.js` runs `UnrealBloomPass` at threshold 0.92 against REC709 luminance in linear
 * space, so what blooms is decided by `0.2126R + 0.7152G + 0.0722B` and not by how bright a
 * colour looks. That weighting is brutally uneven across the trims: hi-vis green comes out
 * at 0.351 and tape amber at 0.406, but safety red at only 0.167, because red carries barely
 * a fifth of the weight green does.
 *
 * So this is deliberately set *below* the threshold for every trim there is. Measured off the
 * running colony: at 4.0 a calm working band reaches 0.92 and blooms all by itself, while an
 * errored band's own peak only reaches 0.668 and never blooms at all — the bloom then says
 * "working" louder than it says "errored", which is upside down from the precedence the whole
 * colony is ordered by. At 2.6 the brightest calm band there is, tape amber, tops out at 0.76
 * and nothing on the vest's plain lower ring ever clears the threshold.
 *
 * The reflective upper ring (`BAND_SPARK` below) is a different story, and not a rare one: at
 * the calm pulse it already sits over 0.92 for five of the eight trims — celebrating 2.58,
 * working 2.23, idle 1.91, spawning 1.63, leaving 0.96 — so most of a colony is quietly
 * blooming, steadily, most of the time. Only waiting (0.87) and sleeping (0.57) stay under.
 * `blocked` is not the one trim that blooms; it is the one trim whose pulse carries the ring
 * *across* the threshold and back, every 0.625s, instead of sitting on one side of it. That
 * crossing — a bloom that switches on and off against a colony of steadily-lit ones — is the
 * beacon, not the bloom itself. See `BAND_SPARK` for the peak/trough numbers.
 *
 * Still well past 1.0 in the dominant channel — amber lands at (1.80, 0.93, 0.12) — which is
 * what an unlit material needs to read at midnight, and what the HDR target exists to carry.
 */
const BAND_GLOW = 2.6

/**
 * How much brighter the reflective upper band is than the plain lower one — the "small bright
 * detail on the vest" the brief allows for, and what actually carries the errored beacon.
 *
 * It exists because no flat scalar can carry it, and that is arithmetic rather than taste.
 * Bloom is a pure brightness test, and the trims are 2.4x apart in luminance before the pulse
 * is applied at all: tape amber is 0.406 and safety red 0.167. The pulse only spans 0.72 to
 * 1.0, so a calm amber band (0.406 x 0.72 = 0.292) is 1.75x brighter than an errored red one
 * at the very top of its pulse (0.167 x 1.0). *Whatever* single multiplier is chosen, a calm
 * amber band clears the threshold before an errored red one does — so a flat scalar can make
 * the bloom say "celebrating", but never "errored".
 *
 * A second gain breaks that tie, because it is a property of the geometry rather than of the
 * status: it lifts the errored band over the threshold without dragging the plain bands up
 * with it, so the vest keeps its colour and only one thin ring per crew member is ever bright
 * enough to glow.
 *
 * 3.4 is measured against the threshold from both sides on the errored trim, which is the
 * hardest one: safety red reaches 1.48 at the top of the pulse and falls to 0.50 at the
 * bottom, so it crosses 0.92 in both directions every 0.625s. That is the beacon — a bloom
 * that visibly switches on and off, against a colony of steady ones, at a zoom where the band
 * itself is one pixel tall and bloom is the only thing large enough to see.
 *
 * A multiplier on the trim rather than a white fleck, so the bright ring is still the status
 * colour: a white one would read as a headlamp, and this stage takes the headgear off.
 */
const BAND_SPARK = 3.4

const WALK_SPEED = 2.1
const TURN_RATE = 7.5
/**
 * How many astronauts may walk out of the ship in one reconcile. The rest of a big arrival —
 * a reload, a first run, a hidden repo being shown again — are placed on their plots instead.
 */
const MAX_ENTRANCE = 6
/** Around the ramp, where an astronaut standing still blocks everyone still coming out. */
const DOORWAY_CLEAR = 5.5

/** How close counts as "reached this waypoint". A shade over one nav cell. */
const WAYPOINT_REACHED = 0.55
/**
 * How far apart astronauts hold each other, measured against the widest thing they used to
 * wear: the helmet was 0.95 across, so anything under that is a spacing at which they are
 * visibly inside one another. The old 0.72 was exactly that — separation *was* running and
 * holding them at 0.71, which is a quarter of a helmet-width of overlap. This leaves real air:
 * a crowd pressed in from every side settles a little tighter than the radius asks for.
 */
const SEPARATION = 1.15
/** Touching distance: a shade over the helmet-width these figures were sized against. */
const CONTACT = 1
/**
 * How close an idler has to get to the spot it wandered at before it calls that arriving,
 * and how briskly it ambles there.
 *
 * Both exist to keep a drifting agent's speed *above* the threshold that puts it in a walk
 * clip for the whole leg. `_walk` eases off as it closes, so stopping at a generous radius
 * is what stops the last stretch being a crawl — and a crawl is movement the standing clip
 * cannot express, so it reads as an astronaut gliding across the deck.
 */
const DRIFT_ARRIVE = 0.9
const DRIFT_PACE = 0.55
/**
 * How close to its site counts as arrived. Deliberately derived from SEPARATION and larger
 * than it: if an astronaut had to get closer than its neighbours will let it, one standing
 * on a busy spot could never finish arriving, and would spend the rest of its life shoving
 * at the crowd it was trying to join.
 */
const ARRIVE_RADIUS = SEPARATION + 0.45
/** Paths computed per frame. Re-routing the whole crew takes a few frames, unnoticeably. */
const PATH_BUDGET = 6

/**
 * The mannequin is authored 2.2 units tall. The colony wants a "little guy" silhouette at
 * the isometric rest distance, and the buildings are sized against one — so the whole rig
 * is scaled once, here, and every worn part below is measured in the *scaled* character's
 * own units so a worn part does not have to be re-tuned when this moves.
 */
const CREW_SCALE = 0.56

/**
 * How far the mannequin's own head reaches from its centre, straight out into the face.
 *
 * Measured off `crew.glb` rather than guessed: over the patch of the face cap where the
 * features are actually drawn, the head's surface is at most 0.554 from the face origin.
 * This is what the face is painted on now — the old 0.48 was the *helmet's* radius, and
 * the head under it is a good deal bigger than the helmet was, so a cap sized to the
 * helmet sinks about 0.05 inside the brow and the features disappear into the skull.
 *
 * Hoisted out of `P` so the hi-vis bands below can be written as fractions of it inside the
 * same object literal. Sizing anything on this figure against `helmetR` has now shipped a
 * defect twice — the face cap, and nearly the hair — so the one number a worn part should be
 * measured against is the one that describes a part the crew still has.
 */
const HEAD_R = 0.554

/**
 * Where the worn parts sit relative to the bone they hang off, in the mannequin's own
 * units — the root transform carries CREW_SCALE, so everything downstream of a bone is
 * measured in the rig's space and stays put if that scale is ever retuned.
 */
const P = {
  helmetR: 0.48,
  headUp: 0.46, // the head bone sits at the neck; the head and the face centre above it
  headR: HEAD_R,
  /**
   * The two hi-vis bands round the torso, in the chest bone's own frame.
   *
   * Every one of these is a fraction of the head's radius, and every one is checked against
   * the torso as it is actually modelled. Measured off the live rig rather than guessed:
   * taking the body mesh's chest- and spine-weighted vertices and slicing them into
   * horizontal bands gives a torso half-width of 0.365 at y 0.70–0.80 and 0.355 at
   * 0.80–0.90, and a half-depth of 0.27–0.28 through both. The chest bone itself sits at
   * y 0.959. So the widest, flattest part of the torso — the part a vest is worn on — runs
   * from about 0.07 to 0.26 *below* that bone, and it is an ellipse about 0.36 by 0.28
   * rather than a circle.
   *
   * `bandR` is the half-width and `bandDepth` the half-depth, which is what makes the rings
   * elliptical: a circular ring wide enough to clear the shoulders would stand a fifth of
   * the body's depth off its chest. Both sit a little proud of the surface they wrap — about
   * 0.03 in each axis, or 0.017 in world units once CREW_SCALE is applied — which is enough
   * to keep them out of the torso without reading as a hoop floating around it.
   *
   * `bandY` is the pair's midpoint and `bandGap` the distance between the two rings, so they
   * land at 0.879 and 0.740 in the rig's own units: inside the widest slice at both ends.
   */
  bandY: -HEAD_R * 0.27,
  bandR: HEAD_R * 0.7,
  bandDepth: HEAD_R * 0.56,
  bandThickness: HEAD_R * 0.16,
  bandGap: HEAD_R * 0.25,
  // The hammer, in the right hand's own frame. The hand bone's own +Y runs back down the
  // forearm, so the shaft is turned through half a circle to stand the head up out of the
  // fist rather than hang it through the floor.
  gripX: 0,
  gripY: -0.04,
  gripZ: 0.02,
  gripRx: 0,
  gripRz: Math.PI,
  /**
   * The two props, in the *character's own* frame rather than a bone's — they stand on the
   * lot, so they hang off the root transform and inherit only its position, facing and scale.
   *
   * The moving box is placed against the seated pose rather than by eye. KayKit's
   * `Sit_Chair_Idle` perches the rig with its backside at y 0.42 and the soles of its feet at
   * about y 0.39, its hips at z -0.40 and its toes at z 0.04 — one flat surface at 0.41,
   * seven tenths deep, holds all of it, with the toes just over the front edge.
   */
  boxW: 0.56,
  boxH: 0.41,
  boxD: 0.68,
  boxZ: -0.2,
  /**
   * The toppled cabinet, off the crew member's right shoulder and turned a little out of
   * true so it does not read as furniture that was placed there. `cabRx` lays it on its back
   * — the doors end up facing the sky, which is what a cabinet that has gone over looks like,
   * and it is also why the piece that holds it off the ground is its *depth* rather than its
   * height, hence `cabD / 2` below.
   */
  cabW: 0.56,
  cabH: 0.78,
  cabD: 0.34,
  cabX: 0.62,
  cabZ: 0.24,
  cabYaw: 0.34,
  cabRx: -Math.PI / 2,
}

/** How long a crew member holds a piece before setting to work on it, in seconds. */
const CARRY_HOLD = 2

export class Astronauts {
  constructor(scene, settings) {
    this.scene = scene
    this.settings = settings
    this.agents = []
    this.byId = new Map()
    this.capacity = 0
    this.group = new THREE.Group()
    this.group.name = 'astronauts'
    scene.add(this.group)

    this.faceTexture = buildFaceAtlas(Math.min(settings.textureSize, 512))
    this._buildMeshes(Math.max(64, settings.get('maxAgents')))

    // Reusable scratch — allocating inside the frame loop is what makes GC hitch.
    this._m = new THREE.Matrix4()
    this._m2 = new THREE.Matrix4()
    this._m3 = new THREE.Matrix4()
    this._m4 = new THREE.Matrix4()
    this._q = new THREE.Quaternion()
    this._e = new THREE.Euler()
    this._v = new THREE.Vector3()
    this._one = new THREE.Vector3(1, 1, 1)
    this._color = new THREE.Color()
    this._wp = new THREE.Vector3()
    this._sep = new THREE.Vector3()
    this._pickBadge = new THREE.Vector3()
    this._pickLifted = new THREE.Vector3()
    /** Uniform bucket grid for the separation query, so it stays O(n) as the crew grows. */
    this._buckets = new Map()
    this.nav = null
  }

  // ── construction ────────────────────────────────────────────────────────────────────

  _buildMeshes(capacity) {
    this.capacity = capacity
    const parts = (this.parts = {})

    // The suit is painted fabric-over-hardshell: fairly rough, not metallic.
    const suit = (roughness, extra = {}) =>
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness, metalness: 0.04, ...extra })

    // Only the hammer is still measured off the helmet radius, so it stays in proportion if
    // the rig is ever scaled again — the cabinet and box are sized in their own units, and the
    // face, hair and hi-vis bands below are all measured off `P.headR` instead (see `HEAD_R`).
    const R = P.helmetR

    // The hi-vis bands. They do three jobs at once: they are the largest surface the status
    // trim colour gets, they are the night glow the antenna tip and the chest lamp used to
    // carry, and they are the beacon the behaviour table promises for an errored thread.
    //
    // Unlit and pushed past 1.0, which is the tip's and the lamp's own scheme rather than a
    // new one: a `MeshBasicMaterial` ignores the light, so a band is as bright at midnight as
    // at noon, and a value over 1 survives the HDR target to reach the bloom pass. Sized
    // against the head rather than the helmet — see `P` for the torso measurements.
    // `vertexColors` is what lets the reflective upper ring be brighter than the plain lower
    // one off a single instance colour: the vertex gain and the instance colour multiply
    // together, so both rings are the same trim and only one is lifted over the bloom
    // threshold. See `bandsGeometry` for why it is a whole ring and not a patch.
    const glow = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true, vertexColors: true })
    parts.bands = this._mesh(bandsGeometry(), glow, capacity, false)

    // The hammer, held in the right hand while a thread is running. Wood and steel rather
    // than suit white, so it reads as a tool at the distance the colony is watched from.
    parts.hammer = this._mesh(hammerGeometry(R), suit(0.62, { vertexColors: true }), capacity, true)

    // The two props the behaviour table asks for: a cabinet on its back beside a crew member
    // whose thread has errored, and a moving box for one that has dozed off. Both follow the
    // hammer rather than the helmet — they exist only for the state that calls for them, so
    // each gets its own instanced mesh and its own count, and neither is welded into the crew
    // geometry where every crew member would be dragging one about.
    parts.cabinet = this._mesh(cabinetGeometry(), suit(0.72, { vertexColors: true }), capacity, true)
    parts.box = this._mesh(movingBoxGeometry(), suit(0.85, { vertexColors: true }), capacity, true)

    // Face: the features only. Built as a sphere cap on the curved surface of the head
    // instead of floating flat in front of it — a flat plane at this radius sinks inside
    // that curve and the features disappear.
    //
    // Sized to `P.headR` exactly, not a hair over it. Stage 3's own ledger recorded two
    // different measurements of the real head's surface under this cap: the DRAWN patch —
    // where the eyes and mouth actually are — reaches out to 0.548, while the cap's whole
    // footprint, corners included, reaches 0.581 at its farthest point. The old `* 1.047`
    // (cap radius 0.580) was sized to that second, larger number, so the drawn features sat
    // about 0.03 clear of the skull instead of on it — which is what read as the face
    // floating off the head. `P.headR` (0.554) clears the drawn patch by about 0.006
    // instead, which is what "a hair over" should have meant.
    //
    // The corners sink into the real head at this radius rather than clearing it — the
    // worst one (0.581) by about 0.027, worse than the 0.0012 stage 3 already measured at
    // the old 0.580 — but that is harmless rather than a new defect: nothing is drawn there.
    // `buildFaceAtlas`'s `DRAW` table keeps every eye, mouth and other shape within roughly
    // 0.14 to 0.86 of the unit box in both axes, with one exception — the sleep frame's
    // `zzz` marks reach out to x ~ 0.98 — but even those stay within y ~ 0.15 to 0.38,
    // nowhere near the y = 0 or y = 1 edge a corner needs both of. So the mask is zero alpha
    // at every corner, and there is nothing visible to clip into the skull.
    const faceGeo = sphereCap(P.headR, 1.72, 0.98, 16, 10)
    parts.face = this._mesh(faceGeo, this._faceMaterial(), capacity, false)
    this._attachFrameAttribute(parts.face, capacity)

    // Hair, one instanced mesh per non-bald style. They cannot share a mesh the way the
    // hammer's shaft and head share one: those are merged into a single geometry, and these
    // are four *different* geometries only one of which any given crew member wears.
    //
    // Sized against `P.headR`, the head's own radius, and not against `R` above — `helmetR`
    // is the radius of the helmet these figures no longer wear, and the head under it is
    // about 15% bigger, so a scalp measured off the helmet is a scalp inside the skull. That
    // is the mistake the face cap made and `hair.js` carries the measurements that fix it.
    //
    // Each style keeps its own material rather than sharing one, so the `dispose` and
    // capacity-rebuild loops over `Object.values(this.parts)` free exactly one material per
    // mesh and never the same one three times.
    this.hairMeshes = HAIR_STYLES.map((style, s) => {
      const geo = style.geometry(P.headR)
      if (!geo) return null // bald builds no geometry, so there is no mesh to draw it with
      const hair = new THREE.MeshStandardMaterial({ color: HAIR_TONE, roughness: 0.86, metalness: 0 })
      const mesh = this._mesh(geo, hair, capacity, true)
      parts[hairPartName(s)] = mesh
      return mesh
    })
    /** One counter per style, reset and refilled every frame. See `_writeMatrices`. */
    this._hairCounts = new Uint32Array(HAIR_STYLES.length)

    for (const [name, mesh] of Object.entries(parts)) {
      mesh.frustumCulled = false // one bounding volume for every agent everywhere is useless
      // The face cap and the primitive hair caps are stopped from drawing here, deliberately,
      // ahead of the rest of this stage's own work. Each garment set's head mesh (see
      // `mergeSet` in crew.js) already carries a painted face and hair modelled into the
      // geometry itself, so drawing these primitives on top doubles up: measured in the
      // running colony, every figure got the old sphere-cap face over a face already on the
      // head, and 71 of 90 got a primitive hair cap over hair already there. Both meshes are
      // still built and still live in `parts` — a later task deletes `faces.js`, this
      // construction and the agent-record fields that feed it — but neither is added to the
      // scene, so nothing about them is ever drawn.
      if (name === 'face' || name.startsWith('hair_')) continue
      this.group.add(mesh)
    }
    this._applyShadowFlags()

    // Ground rings for hover + selection. Two ordinary meshes, moved around as needed.
    this.hoverRing = ring(0.42, 0.5, 0x9fd8ff, 0.5)
    this.selectRing = ring(0.5, 0.62, 0xffd28a, 0.9)
    this.hoverRing.visible = false
    this.selectRing.visible = false
    this.group.add(this.hoverRing, this.selectRing)
  }

  /**
   * Hand over the baked crew rig and build the body mesh.
   *
   * Split out from the constructor because the rig is a fetch: the colony is built before
   * boot has finished loading, and until this lands the crew is an empty shell with nothing
   * to place on it — which is fine, because no agent exists until the first roster arrives,
   * and that comes after.
   */
  setRig(rig) {
    if (!rig || this.rig === rig) return
    this.rig = rig
    this._disposeCrew()

    // One uniform block for the surface and the shadow pass, the same as the buildings do —
    // and shared, by reference, across every set's material below. `Object.assign` in
    // `decorateSkinned` copies the object references into each compiled shader's own uniform
    // block, so `uBones`/`uFrameMax` stay one value updated in one place rather than N copies
    // that could drift; that sharing is also what lets every set play from the one baked
    // animation, since the bind pose is identical across sets (see `garment-sets.js`).
    this.crewUniforms = {
      uBones: { value: rig.boneTexture },
      uFrameMax: { value: rig.frameCount - 1 },
    }

    // One InstancedMesh per garment set rather than one for the whole crew: each set wears
    // its own texture, and a texture is a material, and an InstancedMesh draws one material.
    // Every agent is written into exactly one of these — see `garmentSetIndexFor` and the
    // per-set counters in `_writeMatrices` — so the sum of their counts is the crew size.
    this.crewMeshes = rig.sets.map((set) => {
      const geo = set.geometry.clone()
      const frames = new Float32Array(this.capacity)
      const frameAttr = new THREE.InstancedBufferAttribute(frames, 1)
      frameAttr.setUsage(THREE.DynamicDrawUsage)
      geo.setAttribute('aFrame', frameAttr)

      const material = decorateSkinned(
        new THREE.MeshStandardMaterial({ map: set.texture, roughness: 0.68, metalness: 0.04 }),
        this.crewUniforms
      )

      const mesh = new THREE.InstancedMesh(geo, material, this.capacity)
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
      mesh.count = 0
      mesh.receiveShadow = false
      mesh.frustumCulled = false
      const white = new THREE.Color(1, 1, 1)
      for (let i = 0; i < this.capacity; i++) mesh.setColorAt(i, white)
      mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)

      mesh.customDepthMaterial = decorateSkinned(
        new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking }),
        this.crewUniforms,
        { normals: false }
      )

      this.group.add(mesh)
      return { id: set.id, mesh, frameAttr }
    })
    /** One counter per garment set, reset and refilled every frame. See `_writeMatrices`. */
    this._setCounts = new Uint32Array(this.crewMeshes.length)

    this._applyShadowFlags()

    // Bones anything worn hangs off. Read back per frame from the same baked table the
    // shader samples, so a worn part is never a frame out of step with the bone under it.
    this.headSlot = rig.attachSlot.get('head') ?? 0
    this.chestSlot = rig.attachSlot.get('chest') ?? 0
    this.handSlot = rig.attachSlot.get('hand.r') ?? 0

    // Where the head sits above the ground at rest, in world units. The picker aims here
    // rather than at the feet, so a click lands on the part of an astronaut you are looking
    // at — and reading it off the rig means it follows CREW_SCALE without a second constant.
    const restHeadY = rig.attach[(this.headSlot + 0) * 16 + 13]
    this.headHeight = (restHeadY + P.headUp) * CREW_SCALE
  }

  _disposeCrew() {
    // One entry per garment set — see `setRig`. The head is not a separate part any more: it
    // is part of each set's own merged, skinned geometry, so it is torn down along with it
    // here and needs no disposal of its own.
    if (!this.crewMeshes) return
    for (const { mesh } of this.crewMeshes) {
      this.group.remove(mesh)
      mesh.geometry.dispose()
      mesh.material.dispose()
      mesh.customDepthMaterial?.dispose()
    }
    this.crewMeshes = null
  }

  _mesh(geo, mat, count, castShadow) {
    const mesh = new THREE.InstancedMesh(geo, mat, count)
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.count = 0
    mesh.castShadow = castShadow
    mesh.receiveShadow = false
    // Force USE_INSTANCING_COLOR on every part so tinting is available without a recompile.
    const white = new THREE.Color(1, 1, 1)
    for (let i = 0; i < count; i++) mesh.setColorAt(i, white)
    mesh.instanceColor.setUsage(THREE.DynamicDrawUsage)
    return mesh
  }

  /**
   * The face material. The atlas is a mask, so the shader ignores the sampled colour
   * entirely: the red channel becomes *alpha* and the instance's own colour becomes the
   * glow, which is how every astronaut gets a different eye colour from one shared texture.
   *
   * Carrying alpha in the mask means the only thing this draws is the features themselves,
   * so nothing but the features has an edge — there is no panel behind them any more.
   *
   * `depthWrite` is off because this is transparent now: with it on, the cap would write
   * depth across its whole rectangle and punch a hole in anything drawn behind it later.
   */
  _faceMaterial() {
    const mat = new THREE.MeshBasicMaterial({
      map: this.faceTexture,
      toneMapped: true,
      transparent: true,
      depthWrite: false,
    })
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uFrameScale = { value: new THREE.Vector2(1 / FRAME_COLS, 1 / FRAME_ROWS) }
      // Left at 1.0 rather than pushed past it: a value over 1 survives the HDR target into
      // the bloom pass (see `BAND_GLOW` above for the mechanics), which is what the antenna
      // tip and the chest lamp needed to read as a beacon before stage 3 removed them. The
      // eyes don't carry that job any more. Stage 3's own arithmetic (`BAND_GLOW`,
      // `BAND_SPARK`) already has the hi-vis bands' reflective ring over the 0.92 threshold
      // for five of the eight statuses at the calm pulse, and `blocked` crossing it every
      // 0.625s — so the bands carry night-time status on their own, and dropping the eyes'
      // push into bloom costs no signal. The push only made the face-off-the-head defect
      // (see the face cap above) easier to notice; without it the features stay crisp and
      // readable at colony zoom instead of blown out.
      shader.uniforms.uGlow = { value: 1.0 }
      this._faceUniforms = shader.uniforms

      shader.vertexShader = shader.vertexShader
        .replace(
          '#include <common>',
          `#include <common>
           attribute vec2 aFrame;
           uniform vec2 uFrameScale;`
        )
        .replace(
          '#include <uv_vertex>',
          `#include <uv_vertex>
           vMapUv = uv * uFrameScale + aFrame;`
        )

      shader.fragmentShader = shader.fragmentShader
        .replace(
          '#include <common>',
          `#include <common>
           uniform float uGlow;`
        )
        .replace(
          '#include <map_fragment>',
          `float mask = texture2D( map, vMapUv ).r;
           // The mask is drawn from paths, so its edges are already antialiased — taking
           // alpha straight from it is what gives the features soft edges against the
           // skin without a single extra sample.
           diffuseColor.rgb = vColor.rgb * uGlow;
           diffuseColor.a = mask;`
        )
        // vColor is the glow source above, so the usual instance-colour multiply must go.
        .replace('#include <color_fragment>', '')
    }
    return mat
  }

  _attachFrameAttribute(mesh, capacity) {
    const data = new Float32Array(capacity * 2)
    const attr = new THREE.InstancedBufferAttribute(data, 2)
    attr.setUsage(THREE.DynamicDrawUsage)
    mesh.geometry.setAttribute('aFrame', attr)
    this.frameAttr = attr
  }

  _applyShadowFlags() {
    const on = this.settings.shadowSize > 0
    for (const [name, mesh] of Object.entries(this.parts)) {
      // The face and the bands are unlit glows rather than solids, and neither is a
      // silhouette anybody would miss: the bands are a shell wrapped tight around a torso
      // that is already casting the shadow. Keeping them out of the shadow pass is what the
      // antenna tip and the chest lamp did, for the same reason.
      mesh.castShadow = on && name !== 'face' && name !== 'bands'
    }
    // The body is the shadow that matters — it is the whole silhouette. One flag per set.
    if (this.crewMeshes) for (const { mesh } of this.crewMeshes) mesh.castShadow = on
  }

  /** The colony hands over the navigation grid once it has been built. */
  setNavigation(nav) {
    this.nav = nav
  }

  onSettingsChanged(changed) {
    if (changed.has('shadows')) this._applyShadowFlags()
    if (changed.has('textureQuality')) {
      this.faceTexture.dispose()
      this.faceTexture = buildFaceAtlas(Math.min(this.settings.textureSize, 512))
      this.parts.face.material.map = this.faceTexture
      this.parts.face.material.needsUpdate = true
    }
    if (changed.has('maxAgents')) {
      // The instanced buffers are sized at build time, so a bigger roster needs new ones.
      const wanted = Math.max(64, this.settings.get('maxAgents'))
      if (wanted !== this.capacity) {
        const rig = this.rig
        this._disposeCrew()
        for (const mesh of Object.values(this.parts)) {
          this.group.remove(mesh)
          mesh.geometry.dispose()
          mesh.material.dispose()
        }
        this.group.remove(this.hoverRing, this.selectRing)
        this._buildMeshes(wanted)
        this.rig = null
        this.setRig(rig)
        for (const agent of this.agents) {
          agent.index = -1
          agent.setSlot = -1
          agent.colorDirty = true
        }
      }
      this.roster && this.setRoster(this.roster)
    }
  }

  // ── roster ──────────────────────────────────────────────────────────────────────────

  /**
   * Reconcile the live agents against the current thread list: spawn newcomers at the ship,
   * update the ones that are still here, and send anything that vanished home rather than
   * deleting it out from under the player.
   */
  setRoster(entries, world) {
    this.roster = entries
    this.world = world || this.world
    const cap = Math.min(this.capacity, this.settings.get('maxAgents'))
    // Agents on their way back to the ship still hold a slot, so the roster has to leave room
    // for them. Without this the clamp above would quietly drop whoever sorted last, which is
    // better than an empty planet but still not what the scan said.
    const leaving = this.agents.reduce((n, a) => n + (a.state === 'leaving' ? 1 : 0), 0)
    const wanted = entries.slice(0, Math.max(1, cap - leaving))
    const seen = new Set()

    // The ramp is one door and the ship is a solid obstacle around it, so an entrance is a
    // queue. A handful arriving together is the shot the colony is for; a hundred is a scrum
    // that shoves its own members into the ship's footprint, where they give up, sit down and
    // become the obstacle for everybody behind them. Past this many, the rest are simply
    // already outside — which is what a thread the colony has seen before is anyway.
    let entrances = MAX_ENTRANCE
    for (const entry of wanted) {
      seen.add(entry.id)
      const existing = this.byId.get(entry.id)
      if (existing) {
        this._updateAgent(existing, entry)
        continue
      }
      const walksOut = !entry.known && entrances > 0
      if (walksOut) entrances--
      this._spawnAgent(entry, walksOut)
    }

    for (const agent of this.agents) {
      if (!seen.has(agent.id) && agent.state !== 'leaving') this._sendHome(agent)
    }
    return this.agents.length
  }

  _spawnAgent(entry, walksOut = true) {
    const door = this.world?.shipDoor?.() || new THREE.Vector3(0, 0, 0)
    const jitter = () => (Math.random() - 0.5) * 1.4
    // Straight onto its plot, a pace off the exact spot so a zone's crew does not appear in a
    // stack. The nav grid sorts out anything that lands on a building.
    const site = entry.site || door
    const start = walksOut
      ? new THREE.Vector3(door.x + jitter(), 0, door.z + jitter())
      : new THREE.Vector3(site.x + jitter(), 0, site.z + jitter())

    const agent = {
      id: entry.id,
      thread: entry.thread,
      status: entry.status,
      site: entry.site ? entry.site.clone() : new THREE.Vector3(),
      // The thing being worked on, and where round it this astronaut is standing to do it.
      anchor: entry.anchor ? entry.anchor.clone() : null,
      workSpot: new THREE.Vector3(),
      workAt: 0,
      pos: start,
      vel: new THREE.Vector3(),
      yaw: Math.random() * Math.PI * 2,
      targetYaw: 0,
      speed: WALK_SPEED * (0.86 + Math.random() * 0.28),
      phase: Math.random() * Math.PI * 2,
      bob: 0,
      // An astronaut already outside does not play the entrance; it is just there.
      state: walksOut ? 'spawning' : 'walking',
      stateAge: 0,
      // Every astronaut runs its own clocks so a crowd never blinks in unison.
      blinkAt: 1 + Math.random() * 4,
      faceFrame: FACE.boot,
      faceTimer: 0,
      faceIndex: 0,
      suit: SUIT_TONES[(hash(entry.id) >>> 3) % SUIT_TONES.length],
      // Which hairstyle this thread wears. Resolved once, here, because it is a pure function
      // of the id and can never change — and because hashing a string per agent per frame is
      // work the frame loop does not need. Never derived from status: hair says who a crew
      // member is, the way its skin tone does, and it is the only thing on the figure that a
      // status change cannot move.
      hair: hairStyleIndexFor(entry.id),
      // Which garment set this thread wears — the same one-time, id-only resolution as
      // `hair` above, and the same reason: it is who a crew member is, not what it is doing.
      garmentSet: garmentSetIndexFor(entry.id),
      eye: new THREE.Color(1, 1, 1),
      trim: new THREE.Color(0xffffff),
      hop: 0,
      // Ground tracking. `groundAt` is the height last sampled and `groundY` the eased value
      // actually stood on; both start null so the first frame snaps instead of easing up.
      groundAt: null,
      groundY: null,
      groundX: 0,
      groundZ: 0,
      /** Distance actually covered per second, damped — what picks the animation clip. */
      groundSpeed: 0,
      /** Set by `_walk` on a refused step; latched per wander leg as `driftBlocked`. */
      blocked: false,
      driftBlocked: false,
      // Animation state: which baked clip, how far into it, and the row of the bone table
      // that lands on. Started at a random offset so a crowd never marches in step.
      clipKey: walksOut ? 'spawn' : 'idle',
      clipTime: Math.random() * 0.6,
      frame: 0,
      wander: new THREE.Vector3(),
      wanderAt: 0,
      scale: walksOut ? 0 : 1, // pops up out of the ship, or was already standing there
      alive: true,
      path: null,
      pathAt: 0,
      pathVersion: -1,
      pathGoal: new THREE.Vector3(NaN, 0, NaN),
      colorDirty: true,
      index: -1,
      /** Same sentinel and the same reason as `index`, but scoped to this agent's own
       *  garment set's InstancedMesh — see the colour gates in `_writeMatrices`. */
      setSlot: -1,
      walkAmp: 0,
      screen: new THREE.Vector3(), // filled by the picker each frame
    }
    this._applyStatus(agent, entry.status)
    this.agents.push(agent)
    this.byId.set(agent.id, agent)
    return agent
  }

  _updateAgent(agent, entry) {
    agent.thread = entry.thread
    if (entry.site) {
      const moved = Math.hypot(entry.site.x - agent.site.x, entry.site.z - agent.site.z) > 0.05
      agent.site.copy(entry.site)
      // A site that has moved is a site to walk to. This matters most for an astronaut that
      // gave up on an unreachable one and adopted the ground it was standing on: the next
      // scan hands the real site back, and without this it would stand there for good,
      // parked in the middle of somebody else's zone.
      const away = Math.hypot(agent.site.x - agent.pos.x, agent.site.z - agent.pos.z)
      if (moved && agent.state === 'at-site' && away > ARRIVE_RADIUS) {
        agent.state = 'walking'
        agent.stateAge = 0
        agent.pathVersion = -1
      }
    }
    if (entry.anchor) (agent.anchor ||= new THREE.Vector3()).copy(entry.anchor)
    if (entry.status !== agent.status) {
      agent.status = entry.status
      this._applyStatus(agent, entry.status)
    }
  }

  /** Status change → new behaviour, new trim, new eye colour. */
  _applyStatus(agent, status) {
    const look = AGENT_LOOK[status] || AGENT_LOOK.idle
    agent.trim.set(look.trim)
    agent.eye.setRGB(look.eye[0], look.eye[1], look.eye[2])
    agent.loop = FACE_LOOPS[status] || null
    agent.colorDirty = true

    if (status === 'leaving') {
      this._sendHome(agent)
      return
    }
    // A spawning agent keeps walking out of the ship; everyone else re-targets at once.
    if (agent.state !== 'spawning') agent.state = 'walking'
    agent.stateAge = 0
    agent.pathVersion = -1
  }

  /** Close enough to the ramp that standing still there is in somebody's way. */
  _nearDoor(pos) {
    const door = this.world?.shipDoor?.()
    if (!door) return false
    const dx = pos.x - door.x
    const dz = pos.z - door.z
    return dx * dx + dz * dz < DOORWAY_CLEAR * DOORWAY_CLEAR
  }

  _sendHome(agent) {
    if (agent.state === 'leaving' || agent.state === 'gone') return
    agent.state = 'leaving'
    agent.stateAge = 0
    agent.loop = null
    agent.faceFrame = FACE.wink
    agent.pathVersion = -1
    const door = this.world?.shipDoor?.()
    if (door) agent.site.copy(door)
  }

  remove(id) {
    const agent = this.byId.get(id)
    if (agent) this._sendHome(agent)
  }

  // ── per-frame simulation ────────────────────────────────────────────────────────────

  update(dt, elapsed) {
    const reduced = this.settings.get('reducedMotion')
    const anim = reduced ? 0.35 : 1
    let write = 0

    this._rebuildBuckets()
    this._routeBudget = PATH_BUDGET

    for (let i = this.agents.length - 1; i >= 0; i--) {
      const agent = this.agents[i]
      agent.stateAge += dt
      this._step(agent, dt, elapsed, anim)
      this._animate(agent, dt, anim)
      this._face(agent, dt)

      if (agent.state === 'gone') {
        this.agents.splice(i, 1)
        this.byId.delete(agent.id)
        continue
      }
      write++
    }

    this._writeMatrices(elapsed, anim)
    return write
  }

  /**
   * Make sure the agent has a usable route, and hand back the point it should steer at.
   * Falls back to the goal itself when there is no path — an astronaut heading vaguely the
   * right way and sliding along walls beats one standing still because A* gave up.
   */
  _steerTarget(agent, out) {
    const nav = this.nav
    if (!nav) return out.copy(agent.site)

    const stale =
      agent.pathVersion !== nav.version ||
      agent.pathGoal.distanceToSquared(agent.site) > 0.25
    if (stale && this._routeBudget > 0) {
      this._routeBudget--
      agent.path = nav.findPath(agent.pos.x, agent.pos.z, agent.site.x, agent.site.z)
      agent.pathAt = 0
      agent.pathVersion = nav.version
      agent.pathGoal.copy(agent.site)
    }

    const path = agent.path
    if (!path || !path.length) return out.copy(agent.site)

    // Retire waypoints already reached, and any the agent can already see past.
    while (agent.pathAt < path.length - 1) {
      const wp = path[agent.pathAt]
      const dx = wp.x - agent.pos.x
      const dz = wp.z - agent.pos.z
      if (dx * dx + dz * dz > WAYPOINT_REACHED * WAYPOINT_REACHED) break
      agent.pathAt++
    }
    if (agent.pathAt >= path.length) return out.copy(agent.site)
    const wp = path[agent.pathAt]
    return out.set(wp.x, 0, wp.z)
  }

  _step(agent, dt, elapsed, anim) {
    const fromX = agent.pos.x
    const fromZ = agent.pos.z
    agent.blocked = false
    // Distance is always measured to the real goal; steering follows the route to it.
    const steer = this._steerTarget(agent, this._wp)
    const toSite = this._v.set(steer.x - agent.pos.x, 0, steer.z - agent.pos.z)
    const dist = Math.hypot(agent.site.x - agent.pos.x, agent.site.z - agent.pos.z)

    switch (agent.state) {
      case 'spawning': {
        agent.scale = Math.min(1, agent.scale + dt * 2.6)
        if (agent.stateAge > 0.9) agent.state = 'walking'
        this._walk(agent, toSite, dist, dt, 0.55)
        break
      }

      case 'walking': {
        agent.scale = Math.min(1, agent.scale + dt * 3)
        this._walk(agent, toSite, dist, dt, 1)
        // Close enough — settle into whatever this thread is actually doing. Or close
        // enough to *give up*: a site that something was built on top of between polls can
        // never be reached, and an astronaut shouldering a wall forever is worse than one
        // standing a little short of where it meant to be. It adopts the spot it got to,
        // and the next poll hands it a site that has been checked against the grid.
        const stuck = (agent.blocked && agent.stateAge > 8) || agent.stateAge > 45
        if (dist < ARRIVE_RADIUS || stuck) {
          // Adopting the ground it reached is right for a site something got built on top of.
          // It is exactly wrong next to the ship: an astronaut still shouldering its way out
          // of the doorway would claim the doorway, and the queue behind it inherits a
          // permanent wall. Out there it keeps its real site and tries again, which the crowd
          // thinning out is usually enough to fix.
          const inDoorway = this._nearDoor(agent.pos)
          if (stuck && dist >= ARRIVE_RADIUS && !inDoorway) agent.site.copy(agent.pos)
          if (stuck && inDoorway) {
            agent.stateAge = 0
            agent.pathVersion = -1
            break
          }
          agent.state = agent.status === 'leaving' ? 'leaving' : 'at-site'
          agent.stateAge = 0
        }
        break
      }

      case 'at-site': {
        if (agent.status === 'idle') {
          // Idlers potter around their plot, and `_drift` owns their velocity outright.
          this._drift(agent, dt, elapsed)
        } else if (agent.status === 'working' && agent.anchor) {
          this._workRound(agent, dt, elapsed)
        } else {
          // Everybody else has arrived and stays: a thread that has gone quiet has sat down
          // on the floor, one that is working is at its building. Velocity is zeroed rather
          // than eased down, because nothing here moves the agent any more — a decaying
          // velocity is a number only the animation reads, and what it says is "still
          // walking" for a third of a second after the astronaut has visibly stopped.
          agent.vel.set(0, 0, 0)
          if (agent.status !== 'sleeping') this._faceToward(agent, agent.site, dt)
          this._settle(agent, dt)
        }
        this._sitePose(agent, dt, elapsed, anim)
        break
      }

      case 'leaving': {
        agent.scale = Math.max(0, agent.scale - (dist < 1.4 ? dt * 2.2 : 0))
        this._walk(agent, toSite, dist, dt, 1.15)
        // Reaching the ramp retires the agent; so does giving up on ever reaching it, so a
        // blocked path can never leave a ghost walking forever.
        if (agent.scale <= 0.001 || (dist < 0.9 && agent.stateAge > 1.5) || agent.stateAge > 22) {
          agent.state = 'gone'
        }
        break
      }
    }

    // How fast the astronaut *actually* travelled, not how fast it meant to. The two come
    // apart whenever something is in the way: velocity stays high while the collision code
    // refuses the step, and an agent driven off intent alone walks on the spot against a
    // wall.
    const moved = Math.hypot(agent.pos.x - fromX, agent.pos.z - fromZ) / Math.max(dt, 1e-4)
    // Asymmetric on purpose. Setting off is picked up on the very frame it happens, so an
    // astronaut is never sliding in a standing pose; stopping decays over a tenth of a
    // second, which both stops a half-blocked step flickering the clip and lets the walk
    // cycle finish its stride instead of freezing mid-step.
    agent.groundSpeed =
      moved > agent.groundSpeed ? moved : THREE.MathUtils.damp(agent.groundSpeed || 0, moved, 20, dt)
    agent.phase += dt * (2.2 + agent.groundSpeed * 3.4) * anim
    agent.walkAmp = THREE.MathUtils.damp(agent.walkAmp || 0, Math.min(1, agent.groundSpeed / WALK_SPEED), 8, dt)

    agent.yaw = angleDamp(agent.yaw, agent.targetYaw, TURN_RATE, dt)

    // Stand on the ground rather than on y=0. A plot's deck is a raised slab and the terrain
    // between plots rolls by half a metre either way, so a crew pinned to zero is buried for
    // half the colony. Sampled only when the agent has actually moved — most of the crew is
    // parked at its site, and the sample is a hex lookup plus a noise evaluation.
    const ground = this.world?.groundAt
    if (ground) {
      if (agent.groundAt === null || Math.abs(agent.pos.x - agent.groundX) + Math.abs(agent.pos.z - agent.groundZ) > 0.2) {
        agent.groundX = agent.pos.x
        agent.groundZ = agent.pos.z
        agent.groundAt = ground(agent.pos.x, agent.pos.z)
      }
      // Eased, so walking up onto a deck is a step rather than a teleport. Snapped outright
      // on the first frame, or a spawning astronaut rises out of the floor.
      agent.groundY =
        agent.groundY === null ? agent.groundAt : THREE.MathUtils.damp(agent.groundY, agent.groundAt, 14, dt)
    }
    agent.pos.y = (agent.groundY || 0) + agent.hop
  }

  /**
   * `toTarget` points at the next waypoint; `goalDist` is how far the *final* goal still is.
   * Slowing down uses the goal so an astronaut cruises through intermediate corners and only
   * eases as it actually arrives.
   */
  _walk(agent, toTarget, goalDist, dt, factor) {
    const legDist = toTarget.length()
    if (legDist > 0.05) {
      const dir = toTarget.divideScalar(legDist)
      const want = agent.speed * factor * Math.min(1, goalDist / 1.8)
      agent.vel.x = THREE.MathUtils.damp(agent.vel.x, dir.x * want, 6, dt)
      agent.vel.z = THREE.MathUtils.damp(agent.vel.z, dir.z * want, 6, dt)
    }

    const push = this._separation(agent, this._sep)
    const dx = (agent.vel.x + push.x) * dt
    const dz = (agent.vel.z + push.z) * dt

    if (this.nav) {
      // Blocked head-on, the agent slides; a route that has gone stale can never become a
      // walk through a wall.
      if (!this.nav.slide(agent.pos, dx, dz)) {
        agent.vel.multiplyScalar(0.4)
        // Wedged against something the path did not know about — ask for a new one.
        agent.pathVersion = -1
        agent.blocked = true
      }
    } else {
      agent.pos.x += dx
      agent.pos.z += dz
    }

    if (Math.hypot(agent.vel.x, agent.vel.z) > 0.05) {
      agent.targetYaw = Math.atan2(agent.vel.x, agent.vel.z)
    }
  }

  /** Bucket every agent by a coarse cell, so separation only ever looks at real neighbours. */
  _rebuildBuckets() {
    const buckets = this._buckets
    buckets.clear()
    for (const agent of this.agents) {
      if (agent.state === 'gone' || agent.scale < 0.2) continue
      const key = ((agent.pos.x / 2) | 0) * 10007 + ((agent.pos.z / 2) | 0)
      let list = buckets.get(key)
      if (!list) buckets.set(key, (list = []))
      list.push(agent)
    }
  }

  /** A soft shove away from anyone standing too close. */
  /** Is anybody already standing here? Same bucket grid the separation query walks. */
  _crowded(x, z, ignore) {
    const bx = (x / 2) | 0
    const bz = (z / 2) | 0
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = this._buckets.get((bx + ox) * 10007 + (bz + oz))
        if (!list) continue
        for (const other of list) {
          if (other === ignore) continue
          const dx = x - other.pos.x
          const dz = z - other.pos.z
          if (dx * dx + dz * dz < SEPARATION * SEPARATION) return true
        }
      }
    }
    return false
  }

  _separation(agent, out) {
    out.set(0, 0, 0)
    const buckets = this._buckets
    const bx = (agent.pos.x / 2) | 0
    const bz = (agent.pos.z / 2) | 0
    for (let ox = -1; ox <= 1; ox++) {
      for (let oz = -1; oz <= 1; oz++) {
        const list = buckets.get((bx + ox) * 10007 + (bz + oz))
        if (!list) continue
        for (const other of list) {
          if (other === agent) continue
          const dx = agent.pos.x - other.pos.x
          const dz = agent.pos.z - other.pos.z
          const d2 = dx * dx + dz * dz
          if (d2 > SEPARATION * SEPARATION || d2 < 1e-6) continue
          const d = Math.sqrt(d2)
          // Two regimes, because one is not enough. The gentle term ramps up as they close
          // so a crowd settles instead of oscillating — but in a press, half a dozen gentle
          // pushes from every side cancel, and the equilibrium lands *inside* touching distance.
          // So there is a second, much firmer term that only exists at touching distance,
          // where being apart stops being cosmetic. Widening the gentle radius does not fix
          // that; it makes it worse, by adding more pushes to cancel.
          const strength = (1 - d / SEPARATION) * 1.2 + (d < CONTACT ? (1 - d / CONTACT) * 5 : 0)
          out.x += (dx / d) * strength
          out.z += (dz / d) * strength
        }
      }
    }
    return out
  }

  /** A slow wander inside the plot, re-targeted every few seconds. */
  _drift(agent, dt, elapsed) {
    if (elapsed > agent.wanderAt) {
      agent.wanderAt = elapsed + 3 + Math.random() * 5
      // Stay put rather than walk at a wall — or at somebody. A few candidates and the
      // first that is neither inside a building nor on top of a neighbour wins: separation
      // can push a crowd apart, but it cannot stop one forming if everybody keeps choosing
      // to walk into the same patch of ground.
      agent.wander.copy(agent.site)
      for (let i = 0; i < 4; i++) {
        const a = Math.random() * Math.PI * 2
        const r = 0.8 + Math.random() * 2
        const wx = agent.site.x + Math.cos(a) * r
        const wz = agent.site.z + Math.sin(a) * r
        if (this.nav?.isBlocked(wx, wz)) continue
        if (this._crowded(wx, wz, agent)) continue
        agent.wander.set(wx, 0, wz)
        break
      }
      agent.driftBlocked = false
    }
    const to = this._v.set(agent.wander.x - agent.pos.x, 0, agent.wander.z - agent.pos.z)
    const d = to.length()
    if (d > DRIFT_ARRIVE && !agent.driftBlocked) {
      this._walk(agent, to, d, dt, DRIFT_PACE)
      // A drift leg is a straight line at a spot only ever checked for being *inside* a
      // wall, never for being reachable — so it can run into the side of a building.
      // Give the leg up at the first refused step rather than shuffling against the wall
      // until the next wander comes due, which is several seconds of walking on the spot.
      if (agent.blocked) agent.driftBlocked = true
      return
    }
    // Arrived — or the spot was never far enough away to be worth crossing. Stop dead
    // rather than easing down through the speeds no standing clip can carry, and hold
    // still until the next wander is due, only yielding to anyone standing inside us.
    agent.vel.set(0, 0, 0)
    this._settle(agent, dt)
  }

  /**
   * Push a seated agent out of anyone it has ended up inside, and do nothing else.
   *
   * Separation on its own converges: once no neighbour is within the radius the push is
   * zero and the agent is still. That is the whole difference between resolving a pile-up
   * and wandering. The push is applied to position only, never to velocity, so a nudged
   * sleeper does not read as walking and stays in its sitting clip.
   */
  _settle(agent, dt) {
    const push = this._separation(agent, this._sep)
    if (push.x === 0 && push.z === 0) return
    const dx = push.x * dt
    const dz = push.z * dt
    if (this.nav) this.nav.slide(agent.pos, dx, dz)
    else {
      agent.pos.x += dx
      agent.pos.z += dz
    }
  }

  /**
   * Working: walk round the building and hammer at it from a different side every so often.
   *
   * A thread that is running is *doing* something, and an astronaut welded to one spot for
   * an hour does not say that. Spots are picked on the ring the roster put it on, so it
   * never wanders off its own site, and it always turns to face the thing it is hitting.
   */
  _workRound(agent, dt, elapsed) {
    if (elapsed > agent.workAt) {
      agent.workAt = elapsed + 5 + Math.random() * 7
      const radius = Math.max(1.6, Math.hypot(agent.site.x - agent.anchor.x, agent.site.z - agent.anchor.z))
      // Somewhere else on the ring — at least a third of the way round, so a move is worth
      // making rather than a shuffle on the spot.
      const from = Math.atan2(agent.pos.z - agent.anchor.z, agent.pos.x - agent.anchor.x)
      agent.workSpot.copy(agent.site)
      // Same rule as a drift: a spot on the ring that is walled off, or that somebody else
      // is already working from, is not a spot.
      for (let i = 0; i < 4; i++) {
        const a = from + (Math.random() > 0.5 ? 1 : -1) * (1.1 + Math.random() * 1.6)
        const wx = agent.anchor.x + Math.cos(a) * radius
        const wz = agent.anchor.z + Math.sin(a) * radius
        if (this.nav?.isBlocked(wx, wz)) continue
        if (this._crowded(wx, wz, agent)) continue
        agent.workSpot.set(wx, 0, wz)
        break
      }
      agent.driftBlocked = false
    }

    const to = this._v.set(agent.workSpot.x - agent.pos.x, 0, agent.workSpot.z - agent.pos.z)
    const d = to.length()
    if (d > DRIFT_ARRIVE && !agent.driftBlocked) {
      this._walk(agent, to, d, dt, DRIFT_PACE)
      if (agent.blocked) agent.driftBlocked = true
      return
    }
    // Arrived: stop dead, turn to the work, and swing.
    agent.vel.set(0, 0, 0)
    this._faceToward(agent, agent.anchor, dt)
    this._settle(agent, dt)
  }

  _faceToward(agent, point, dt) {
    // Stand a little back from the build site and look at it.
    const dx = point.x - agent.pos.x
    const dz = point.z - agent.pos.z
    if (Math.abs(dx) + Math.abs(dz) > 0.01) agent.targetYaw = Math.atan2(dx, dz)
  }

  /**
   * What each status adds on top of its clip, once the agent has arrived.
   *
   * Vertical motion used to live here — a hop for celebrating, a slump for blocked. The
   * clips own all of that now, and a hand-written offset on top of an authored one only
   * ever fights it, so the only thing left is the slow turn a celebrating agent does on
   * the spot, which no single clip can express.
   */
  _sitePose(agent, dt, elapsed, anim) {
    agent.hop = 0
    if (agent.status === 'celebrating') agent.targetYaw += dt * 1.4 * anim
  }

  /** Pick this frame's face: a status loop, interrupted by the agent's own blink clock. */
  _face(agent, dt) {
    agent.faceTimer += dt
    agent.blinkAt -= dt

    if (agent.state === 'spawning' && agent.stateAge < 0.8) {
      agent.faceFrame = FACE.boot
      return
    }
    if (agent.state === 'leaving') {
      agent.faceFrame = agent.stateAge % 2 < 1.4 ? FACE.happy : FACE.wink
      return
    }
    // Blink beats everything except sleeping — a sleeping agent's eyes are already shut.
    if (agent.blinkAt <= 0 && agent.status !== 'sleeping' && agent.status !== 'blocked') {
      agent.faceFrame = FACE.blink
      if (agent.blinkAt < -0.12) agent.blinkAt = 2.4 + Math.random() * 5
      return
    }

    const loop = agent.loop
    if (!loop || !loop.length) {
      agent.faceFrame = FACE.idle
      return
    }
    const rate = agent.status === 'working' ? 0.22 : 0.55
    if (agent.faceTimer > rate) {
      agent.faceTimer = 0
      agent.faceIndex = (agent.faceIndex + 1) % loop.length
    }
    agent.faceFrame = loop[agent.faceIndex]
  }

  // ── animation ───────────────────────────────────────────────────────────────────────

  /**
   * Choose the clip an agent should be playing and advance its clock.
   *
   * Locomotion wins over status: an idler pottering across its plot walks, it does not
   * hammer while sliding. Walk playback is driven by actual ground speed so short steps
   * cannot moonwalk — the same rule the old hand-written cycle followed, applied to a real
   * one instead.
   */
  _animate(agent, dt, anim) {
    const rig = this.rig
    if (!rig) return

    // Any real translation belongs in a walk clip. The threshold is low on purpose: what it
    // guards against is the reverse mistake, an agent standing in an idle pose while the
    // world slides past its feet, and the movement code is what keeps it from dawdling
    // just under the line.
    const speed = agent.groundSpeed || 0
    let key
    if (agent.state === 'spawning') key = 'spawn'
    else if (speed > 0.12) key = speed > WALK_SPEED * 1.25 ? 'run' : 'walk'
    else {
      switch (agent.status) {
        // A removals job is three beats, not one: stoop for the piece, hold it while you look
        // at where it goes, then set to work on it. `lift` and `carry` hand over below, so
        // this only has to choose `lift` on the frame the crew member stops walking — every
        // frame after that it is already in the beat it handed over to. `_workRound` moves it
        // to a new spot on the ring every few seconds, which is what starts the beat again.
        case 'working':
          key = agent.clipKey === 'carry' || agent.clipKey === 'work' ? agent.clipKey : 'lift'
          break
        case 'waiting':
          key = 'wave'
          break
        case 'blocked':
          key = 'hit'
          break
        case 'celebrating':
          key = 'cheer'
          break
        // Sitting down is a one-shot that hands over to the loop when it finishes, so an
        // agent that has just nodded off lowers itself rather than snapping into a sit.
        case 'sleeping':
          key = agent.clipKey === 'sit' ? 'sit' : 'sitDown'
          break
        default:
          key = 'idle'
      }
    }

    if (key !== agent.clipKey) {
      agent.clipKey = key
      agent.clipTime = 0
    }

    const clip = rig.clips[key] || rig.clips.idle
    if (!clip) return

    // Stride rate follows the ground, everything else runs at its authored speed.
    const rate = key === 'walk' || key === 'run' ? THREE.MathUtils.clamp(speed / WALK_SPEED, 0.4, 2.1) : 1
    agent.clipTime += dt * anim * rate

    // One-shots that hand over to the pose they end in, so nothing snaps: sitting down hands
    // to sitting, the pick-up hands to the carry, and the carry gives way to the work loop
    // after a couple of beats of standing there holding the thing.
    const handOver =
      (key === 'sitDown' && agent.clipTime >= clip.duration && 'sit') ||
      (key === 'lift' && agent.clipTime >= clip.duration && 'carry') ||
      (key === 'carry' && agent.clipTime >= CARRY_HOLD && 'work')
    if (handOver) {
      agent.clipKey = handOver
      agent.clipTime = 0
      agent.frame = frameFor(rig.clips[handOver], 0)
      return
    }
    agent.frame = frameFor(clip, agent.clipTime)
  }

  // ── writing the instance buffers ────────────────────────────────────────────────────

  _writeMatrices(elapsed, anim) {
    const { face, bands, hammer, cabinet, box } = this.parts
    const rig = this.rig
    const crewMeshes = this.crewMeshes
    const root = this._m
    const child = this._m2
    const bone = this._m3
    const worn = this._m4
    const q = this._q
    const e = this._e
    const v = this._v
    const one = this._one
    const frames = this.frameAttr.array
    const hairMeshes = this.hairMeshes
    const hairCounts = this._hairCounts

    let i = 0
    // One counter per prop, for the same reason the hammer has one: an unused slot in the
    // middle of an instanced mesh still draws, so a prop that only some states own cannot
    // share the crew's own index.
    let hands = 0
    let cabinets = 0
    let boxes = 0
    // And one per hairstyle, for exactly that reason: each style's mesh is packed only with
    // the crew members wearing it, so none of them can use the crew's own index either.
    hairCounts.fill(0)
    // And one per garment set: an agent is written into its own set's InstancedMesh and its
    // slot in the other set's stays unused, so the two sets need their own slot spaces
    // rather than sharing the packing index `i` below (see `agent.garmentSet`,
    // `garmentSetIndexFor`).
    const setCounts = this._setCounts
    setCounts?.fill(0)
    let staticDirty = false
    for (const agent of this.agents) {
      // Never write past the end of the instance buffers. Going over is not a rendering
      // artefact you can squint past: WebGL refuses the whole `drawElementsInstanced` call, so
      // one agent too many takes *every* astronaut off screen at once.
      //
      // It can go over. `setRoster` caps how many agents it will spawn, but an agent that has
      // left the roster stays in this list while it walks back to the ship — and the slot it
      // vacated in the roster is immediately filled by a thread that was previously past the
      // cap. Archive one thread on a colony sitting at the cap and there is briefly one more
      // agent than there are slots, which is exactly when the colony would empty.
      if (i >= this.capacity) break
      if (agent.state === 'gone') continue
      // Riding in its delivery car — the colony sets this flag per frame. Skipping the slot
      // is the only way to hide one crew member: everything here is packed into the first
      // `n` instances, and an unused slot left in the middle still draws. This is a
      // draw-time skip and nothing more — the agent keeps its state, its status and its
      // place in the roster while it rides.
      //
      // Giving up the index matters as much as skipping the write. The colour gates below
      // fire on `index !== i` and `setSlot !== crewSlot`, and every agent behind this one
      // shifts down a slot and overwrites the colours in the slot this one vacated. Left
      // stale instead of reset, the agent would reclaim that same `i` and `crewSlot` on its
      // way back with both gates reading "unchanged", so it would be drawn in whatever suit,
      // trim and eye its neighbour left there — until some unrelated status change happens to
      // set `colorDirty`. Resetting both to `-1` forces a rewrite instead. `-1` is the same
      // sentinel a capacity rebuild uses, and nothing else reads either field.
      if (agent.riding) {
        agent.index = -1
        agent.setSlot = -1
        continue
      }
      const s = agent.scale
      if (s <= 0.001) continue

      // Root transform for the whole character. The rig is authored at 2.2 units tall, so
      // CREW_SCALE rides along here and everything downstream inherits it.
      e.set(0, agent.yaw, 0)
      q.setFromEuler(e)
      v.set(agent.pos.x, agent.pos.y, agent.pos.z)
      root.compose(v, q, one.setScalar(s * CREW_SCALE))
      one.setScalar(1)

      // Written into its own garment set's InstancedMesh — never `i`, which is the shared
      // slot the one-per-crew-member parts below use. `agent.garmentSet` was resolved once
      // at spawn (see `_spawnAgent`), the same as its hairstyle, so this is a lookup rather
      // than a hash on the frame's hot path.
      let crewSlot = -1
      if (crewMeshes) {
        const cm = crewMeshes[agent.garmentSet]
        crewSlot = setCounts[agent.garmentSet]++
        cm.mesh.setMatrixAt(crewSlot, root)
        cm.frameAttr.array[crewSlot] = agent.frame
      }

      // Everything worn hangs off a bone at the frame the body is actually on, so a worn
      // part cannot drift off a head that is looking down or lying on the ground.
      if (rig) {
        attachMatrixAt(rig, agent.frame, this.headSlot, bone)
        worn.multiplyMatrices(root, bone)
        // The head is no longer a separate part: it is baked into each garment set's own
        // merged, skinned geometry (see `crew.js`'s `mergeSet`) and rides the skeleton
        // exactly rather than the attach-bone approximation a rigid part needed. Only the
        // face — the procedural screen the status expressions animate — still rides here,
        // at the same bone-plus-offset the head used to.
        setPart(child, worn, face, i, 0, P.headUp, 0, 0, 0, 0)

        // Hair, written with that same matrix and that same offset — so it rides the head
        // bone rather than trailing it, and a crew member walking, looking down or asleep on
        // the floor keeps its hair on its head. `agent.hair` indexes `HAIR_STYLES`, and a
        // bald crew member's slot is `null`: it writes nothing at all rather than a hidden
        // instance, which is why there is a counter per style instead of one shared index.
        const hair = hairMeshes[agent.hair]
        if (hair) setPart(child, worn, hair, hairCounts[agent.hair]++, 0, P.headUp, 0, 0, 0, 0)

        // The chest slot, back in use. Task 1 emptied this block because both things that
        // hung off it — the backpack and the chest lamp — were going; the bands are what
        // hangs off it now. Off the chest bone rather than off `root` so the bands stay on
        // the torso through every clip: a crew member stooping for a box, swinging a hammer
        // or asleep on the floor is bent at the spine, and a band placed off the root would
        // stay upright in mid-air while the body it belongs to leaned out of it.
        attachMatrixAt(rig, agent.frame, this.chestSlot, bone)
        worn.multiplyMatrices(root, bone)
        setPart(child, worn, bands, i, 0, P.bandY, 0, 0, 0, 0)

        // The hammer only exists while a thread is running, so it gets its own instance
        // counter — an unused slot in the middle of an instanced mesh still draws.
        if (agent.clipKey === 'work') {
          attachMatrixAt(rig, agent.frame, this.handSlot, bone)
          worn.multiplyMatrices(root, bone)
          setPart(child, worn, hammer, hands++, P.gripX, P.gripY, P.gripZ, P.gripRx, 0, P.gripRz)
        }
      }

      // The props stand on the ground next to the crew member, so they hang off `root` and
      // not off a bone — a cabinet that followed the chest around would swing when its owner
      // flinched. They are keyed off the clip rather than the status for the same reason the
      // hammer is: a blocked crew member still walking to its plot has not fallen over
      // anything yet, and a prop is only right once the pose that needs it is playing.
      if (agent.clipKey === 'hit') {
        setPart(child, root, cabinet, cabinets++, P.cabX, P.cabD / 2, P.cabZ, P.cabRx, P.cabYaw, 0)
      }
      if (agent.clipKey === 'sit' || agent.clipKey === 'sitDown') {
        setPart(child, root, box, boxes++, 0, 0, P.boxZ, 0, 0, 0)
      }

      // Suit and trim only change when the status does, or when an agent leaving the roster
      // shuffles everyone's slot along — so they are written on those frames, not all of them.
      //
      // The suit lives in its own garment set's mesh now, at `crewSlot` rather than at `i` —
      // a different slot space, so it needs its own dirty check rather than reusing the
      // `agent.index !== i` one below, which only speaks to the shared per-crew-member slot
      // `face` and `bands` use. `agent.setSlot` is that same check, scoped to the set: it is
      // what catches a garment mesh's slot being reused by a different agent of the same set
      // after somebody ahead of it in that set went home.
      const c = this._color
      const wasDirty = agent.colorDirty
      agent.colorDirty = false
      if (crewMeshes && (agent.setSlot !== crewSlot || wasDirty)) {
        crewMeshes[agent.garmentSet].mesh.setColorAt(crewSlot, c.setHex(agent.suit))
        staticDirty = true
      }
      agent.setSlot = crewSlot
      if (agent.index !== i || wasDirty) {
        face.setColorAt(i, agent.eye)
        staticDirty = true
      }

      /**
       * The bands, written on every frame rather than under the gate above.
       *
       * This is the one per-agent colour that is not a property of the slot. All the others
       * change only when the status does or when an agent leaving the roster shuffles
       * everyone along, which is exactly what `index !== i || colorDirty` fires on. An
       * errored band is *pulsing*: it is a different colour on the next frame with nothing
       * about the agent having changed, so behind that gate it would be written once at the
       * moment the thread errored and then frozen on whatever phase the pulse happened to be
       * at — a band stuck bright, or stuck at its dimmest, and no beacon either way. So the
       * write goes here, below the gate and inside the same loop, which is where the antenna
       * tip and the chest lamp were written for this exact reason.
       *
       * Writing it unconditionally also puts it out of reach of the stale-index bug the
       * riding skip guards against: whichever slot this agent lands in, the band in that slot
       * is recomputed from this agent's own trim this frame, so it can never be caught
       * wearing the colour its predecessor left behind.
       */
      bands.setColorAt(i, c.copy(agent.trim).multiplyScalar(BAND_GLOW * bandPulse(elapsed, agent.status === 'blocked')))

      // Atlas frame for the face.
      const f = agent.faceFrame
      frames[i * 2] = (f % FRAME_COLS) / FRAME_COLS
      frames[i * 2 + 1] = 1 - (Math.floor(f / FRAME_COLS) + 1) / FRAME_ROWS

      agent.index = i
      i++
    }

    const n = i
    // Everything worn is drawn once per crew member; the tool and the props only as often as
    // the state that owns them came up this frame.
    const props = { hammer: hands, cabinet: cabinets, box: boxes }
    // Every hairstyle's own count, the zeroes included. A style nobody is wearing this frame
    // has to be *told* it is empty: `count` is sticky, so a mesh left on last frame's value
    // goes on drawing hair at stale matrices — a head of hair hovering where a crew member
    // used to stand, which is the ghost the delivery cars used to leave parked on a plot.
    // `props[name] ?? n` below reads a zero as a zero, which is the whole reason it is `??`.
    for (let s = 0; s < hairMeshes.length; s++) {
      if (hairMeshes[s]) props[hairPartName(s)] = hairCounts[s]
    }
    for (const [name, mesh] of Object.entries(this.parts)) {
      mesh.count = props[name] ?? n
      mesh.instanceMatrix.needsUpdate = true
      // The bands' colour buffer is new every frame, because an errored band is pulsing —
      // so it re-uploads unconditionally. Everything else only when a status changed or an
      // agent moved slot. The tip and the lamp had a `Set` of animated parts here for the
      // same reason; there is one such part now, so it is one name.
      if (mesh.instanceColor && (staticDirty || name === 'bands')) mesh.instanceColor.needsUpdate = true
    }
    if (crewMeshes) {
      for (let s = 0; s < crewMeshes.length; s++) {
        const cm = crewMeshes[s]
        cm.mesh.count = setCounts[s]
        cm.mesh.instanceMatrix.needsUpdate = true
        cm.frameAttr.needsUpdate = true
        if (staticDirty && cm.mesh.instanceColor) cm.mesh.instanceColor.needsUpdate = true
      }
    }
    this.frameAttr.needsUpdate = true
    this.visibleCount = n
  }

  // ── picking ─────────────────────────────────────────────────────────────────────────

  /**
   * Nearest agent to a screen point, in screen space. Cheaper than raycasting ten instanced
   * meshes and far kinder to click, since the hit radius grows with how big the astronaut
   * actually is on screen rather than with its silhouette.
   */
  pick(camera, ndcX, ndcY, aspect, maxDist = 0.075) {
    let best = null
    let bestScore = Infinity
    const v = this._v
    const b = this._pickBadge
    const lifted = this._pickLifted

    for (const agent of this.agents) {
      // A crew member riding in its car is not drawn, so it must not be clickable either —
      // picking is in screen space and would happily hand back an astronaut that is not
      // there, at the spot on the plot it is walking to.
      //
      // This is also why the colony refuses to set `riding` on a crew member whose status
      // carries a badge: skipping it here is what would take away the click target for the
      // one thread that is asking for you.
      if (agent.scale < 0.3 || agent.state === 'gone' || agent.riding) continue
      v.set(agent.pos.x, agent.pos.y + (this.headHeight || 0.75), agent.pos.z).project(camera)
      if (v.z > 1) continue // behind the camera
      agent.screen.copy(v)
      const dx = (v.x - ndcX) * aspect
      const dy = v.y - ndcY
      let d = Math.hypot(dx, dy)

      // The badge over an astronaut's head is what you actually aim at when one wants you —
      // it is bigger than the astronaut, it is the thing that caught your eye, and it sits
      // clear of the crowd. So the whole bubble picks the astronaut it belongs to, not just
      // a point at its middle.
      //
      // The geometry has to be recomputed the way `indicators.js` draws it rather than
      // guessed at. That shader anchors the quad just above the head and then lifts it by
      // half its own height *in view space*, where the height itself grows with distance so
      // the badge holds a constant pixel size. A fixed world-space offset cannot follow that:
      // it is right at one zoom and most of a metre low at another, which is why this used to
      // demand a click on the astronaut's head.
      const size = agent.badgeSize || 0
      if (size > 0) {
        // View space, exactly as the vertex shader has it.
        b.set(agent.pos.x, agent.badgeY, agent.pos.z).applyMatrix4(camera.matrixWorldInverse)
        const scale = size * (2 + -b.z * 0.22)
        b.y += scale * 0.5
        // A second point one half-height higher gives the quad's on-screen radius without
        // re-deriving the projection: whatever the camera does to one, it does to both.
        lifted.copy(b)
        lifted.y += scale * 0.5
        b.applyMatrix4(camera.projectionMatrix)
        lifted.applyMatrix4(camera.projectionMatrix)
        if (b.z <= 1) {
          // The quad is square, and `bx` is already in the same units as `by`, so one
          // half-extent covers both axes.
          const half = Math.abs(lifted.y - b.y)
          const bx = (b.x - ndcX) * aspect
          const by = b.y - ndcY
          // Anywhere inside the bubble is a hit outright; outside it, the distance to its
          // edge, so a near-miss still competes with a nearer astronaut on the same pixel.
          const ox = Math.max(0, Math.abs(bx) - half)
          const oy = Math.max(0, Math.abs(by) - half)
          const bd = Math.hypot(ox, oy)
          if (bd < d) d = bd
        }
      }
      if (d > maxDist) continue
      // Break ties by depth so the nearer of two overlapping agents wins.
      const score = d + v.z * 0.05
      if (score < bestScore) {
        bestScore = score
        best = agent
      }
    }
    return best
  }

  setHover(agent) {
    this.hoverRing.visible = Boolean(agent)
    if (agent) this.hoverRing.position.set(agent.pos.x, agent.pos.y + 0.03, agent.pos.z)
  }

  setSelected(agent) {
    this.selected = agent || null
    this.selectRing.visible = Boolean(agent)
  }

  updateRings(elapsed) {
    if (this.selected) {
      if (!this.byId.has(this.selected.id)) {
        this.setSelected(null)
      } else {
        const a = this.selected
        this.selectRing.position.set(a.pos.x, a.pos.y + 0.035, a.pos.z)
        this.selectRing.rotation.y = elapsed * 0.6
        const s = 1 + Math.sin(elapsed * 3) * 0.05
        this.selectRing.scale.setScalar(s)
      }
    }
    if (this.hoverRing.visible) this.hoverRing.rotation.y = -elapsed * 0.4
  }

  /** A quick wave — played when you open an agent's thread. */
  celebrate(id) {
    const agent = this.byId.get(id)
    if (!agent) return
    agent.faceFrame = FACE.happy
    agent.blinkAt = 1.5
    agent.hop = 0.25
  }

  dispose() {
    for (const mesh of Object.values(this.parts)) {
      mesh.geometry.dispose()
      mesh.material.dispose()
    }
    this._disposeCrew()
    // The bone texture is the rig's, not this instance's — the rig outlives any one colony.
    this.faceTexture.dispose()
    this.scene.remove(this.group)
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────

const _cq = new THREE.Quaternion()
const _ce = new THREE.Euler()
const _cv = new THREE.Vector3()
const _cs = new THREE.Vector3(1, 1, 1)

/** Compose a child's local transform, concatenate onto the root, and store the instance. */
function setPart(scratch, root, mesh, index, x, y, z, rx, ry, rz) {
  _ce.set(rx, ry, rz)
  _cq.setFromEuler(_ce)
  _cv.set(x, y, z)
  scratch.compose(_cv, _cq, _cs)
  scratch.premultiply(root)
  mesh.setMatrixAt(index, scratch)
}

function angleDamp(current, target, lambda, dt) {
  let delta = target - current
  while (delta > Math.PI) delta -= Math.PI * 2
  while (delta < -Math.PI) delta += Math.PI * 2
  return current + delta * (1 - Math.exp(-lambda * dt))
}

/**
 * The two hi-vis bands round the torso, as one geometry in the chest bone's own frame.
 *
 * Open-ended cylinders rather than tori: a cylinder wall is a flat vertical surface, so the
 * whole of `bandThickness` shows in projection wherever you are standing, where a tube of
 * the same thickness only presents its full width side-on. Under an unlit material that
 * makes the band a solid block of colour of a known height — which is the only thing that
 * decides whether it survives at colony zoom. It is also the cheaper of the two by a long
 * way, and this is drawn once per crew member.
 *
 * Scaled in Z rather than built round, because the torso is not round — see `P`. The rings
 * are centred on y=0 and the write places the pair at `P.bandY`, so the two numbers that
 * decide where they sit stay next to the measurements that justify them.
 */
function bandsGeometry() {
  const pieces = []
  // The upper ring is the reflective one and the lower is plain. Which ring carries the gain
  // is not cosmetic: it was first built as a short bright patch at the front and back of both
  // rings, and measured at the colony's rest distance that turned out to depend entirely on
  // which way the crew member happened to be standing. Facing the camera the pulse moved
  // 55,845 pixels; side-on, with the patch edge-on and the arms over the sides of the band,
  // it moved 7 and produced no bloom at all — an errored thread you can only see from some
  // angles is not a beacon. A whole ring presents the same bright area whichever way the
  // figure turns, and the plain ring below it is what keeps the trim colour readable close
  // up, where the bright one is inevitably washed towards white.
  for (const [side, value] of [
    [1, BAND_SPARK],
    [-1, 1],
  ]) {
    const geo = new THREE.CylinderGeometry(P.bandR, P.bandR, P.bandThickness, 20, 1, true)
    geo.scale(1, 1, P.bandDepth / P.bandR)
    geo.translate(0, (side * P.bandGap) / 2, 0)
    gain(geo, value)
    pieces.push(geo)
  }

  const merged = BufferGeometryUtils.mergeGeometries(pieces, false)
  pieces.forEach((g) => g.dispose())
  return merged
}

/**
 * Bake a flat multiplier into a geometry's vertex colours.
 *
 * `paint` below cannot do this: it goes through `THREE.Color`, which is where a hex arrives
 * already clamped to 1, and the whole point of the reflective patch is a value above it.
 */
function gain(geo, value) {
  const n = geo.attributes.position.count
  const colors = new Float32Array(n * 3).fill(value)
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

/** A cheap rounded box: a low-segment sphere squashed to the requested proportions. */
/**
 * A claw hammer, in the rig's own units: a shaft with a steel head across the top.
 *
 * Coloured per vertex rather than per instance, because the two halves are different
 * materials and the instance colour is already spoken for by the suit palette.
 */
function hammerGeometry(R) {
  const shaft = new THREE.CylinderGeometry(R * 0.055, R * 0.07, R * 1.15, 6)
  shaft.translate(0, R * 0.24, 0)
  paint(shaft, 0x8a6440)

  // The head crosses the shaft. It is authored long along X, which is already square to the
  // shaft's Y — turning it a quarter turn about Z, as this used to, stood the head *up in
  // line with* the handle, so the astronaut appeared to be swinging a mallet end-on.
  const head = roundedBox(R * 0.5, R * 0.19, R * 0.19, R * 0.05)
  head.translate(0, R * 0.82, 0)
  paint(head, 0x9aa0a8)

  const merged = BufferGeometryUtils.mergeGeometries([shaft, head], false)
  shaft.dispose()
  head.dispose()
  return merged
}

/**
 * A cabinet, authored standing up in the rig's own units — whoever draws it lays it on its
 * back. A body, two doors sitting a hair proud of it, and a handle on each.
 *
 * Vertex-coloured for the same reason the hammer is: the instance colour is spoken for by
 * the crew's own palette, and a prop that took its colour from the crew member beside it
 * would be a cabinet in a hi-vis vest.
 */
function cabinetGeometry() {
  const { cabW: w, cabH: h, cabD: d } = P

  const body = roundedBox(w, h, d, 0.035)
  paint(body, 0x8a6a4a)

  const parts = [body]
  for (const side of [-1, 1]) {
    const door = roundedBox(w * 0.44, h * 0.86, d * 0.1, 0.02)
    door.translate(side * w * 0.24, 0, d * 0.52)
    paint(door, 0xa9855e)
    parts.push(door)

    // The handles are what say "cabinet" rather than "crate" once it is on its side.
    const handle = new THREE.CylinderGeometry(0.018, 0.018, h * 0.2, 5)
    handle.translate(side * w * 0.06, 0, d * 0.58)
    paint(handle, 0x4a4a4e)
    parts.push(handle)
  }

  const merged = BufferGeometryUtils.mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return merged
}

/**
 * A moving box, sized to the seated pose in `P` and sitting on the ground with its top at
 * `P.boxH`. Cardboard, with a strip of tape down the middle of the lid and a darker seam
 * round the join, because a plain brown cube at this size reads as a rock.
 */
function movingBoxGeometry() {
  const { boxW: w, boxH: h, boxD: d } = P

  const body = roundedBox(w, h, d, 0.03)
  body.translate(0, h / 2, 0)
  paint(body, 0xb08558)

  // The lid, a shade lighter and a hair proud, so the box has a top rather than a face.
  const lid = roundedBox(w * 0.98, h * 0.1, d * 0.98, 0.02)
  lid.translate(0, h * 0.97, 0)
  paint(lid, 0xc09668)

  const tape = new THREE.BoxGeometry(w * 0.16, h * 0.02, d * 1.005)
  tape.translate(0, h * 1.02, 0)
  paint(tape, 0xd8c6a4)

  const parts = [body, lid, tape]
  const merged = BufferGeometryUtils.mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return merged
}

/** Bake a flat colour into a geometry's vertex colours. */
function paint(geo, hex) {
  const c = new THREE.Color(hex)
  const n = geo.attributes.position.count
  const colors = new Float32Array(n * 3)
  for (let i = 0; i < n; i++) {
    colors[i * 3] = c.r
    colors[i * 3 + 1] = c.g
    colors[i * 3 + 2] = c.b
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3))
}

function roundedBox(w, h, d, r) {
  const geo = new THREE.BoxGeometry(w, h, d, 2, 2, 2)
  const pos = geo.attributes.position
  const v = new THREE.Vector3()
  const half = new THREE.Vector3(w / 2 - r, h / 2 - r, d / 2 - r)
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const inner = new THREE.Vector3(
      THREE.MathUtils.clamp(v.x, -half.x, half.x),
      THREE.MathUtils.clamp(v.y, -half.y, half.y),
      THREE.MathUtils.clamp(v.z, -half.z, half.z)
    )
    const out = v.clone().sub(inner)
    if (out.lengthSq() > 0) out.setLength(r)
    pos.setXYZ(i, inner.x + out.x, inner.y + out.y, inner.z + out.z)
  }
  pos.needsUpdate = true
  geo.computeVertexNormals()
  return geo
}

/**
 * A patch of sphere centred on +Z — the direction the astronaut faces. Three's own
 * parametrisation puts phi=0 at -X, so the patch is offset by a quarter turn to land
 * the cap on the front of the head rather than its cheek.
 */
function sphereCap(radius, phiSpread, thetaSpread, wSeg = 18, hSeg = 12) {
  return new THREE.SphereGeometry(
    radius,
    wSeg,
    hSeg,
    Math.PI / 2 - phiSpread / 2,
    phiSpread,
    Math.PI / 2 - thetaSpread / 2,
    thetaSpread
  )
}

function ring(inner, outer, color, opacity) {
  const geo = new THREE.RingGeometry(inner, outer, 32)
  geo.rotateX(-Math.PI / 2)
  const mat = new THREE.MeshBasicMaterial({
    color,
    transparent: true,
    opacity,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
  })
  const mesh = new THREE.Mesh(geo, mat)
  mesh.renderOrder = 3
  return mesh
}

function hash(str) {
  let h = 2166136261
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

export { hash }
