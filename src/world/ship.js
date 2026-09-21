import * as THREE from 'three'
import * as BufferGeometryUtils from 'three/addons/utils/BufferGeometryUtils.js'
import { Composer, decorate, buildingUniforms } from './buildings.js'
import { ATLAS, CELL_PROTOTYPE, atlasTexture, cellMask, loadKit } from './kit.js'

/**
 * The depot. Every astronaut walks out of its loading dock when a thread appears and back in
 * when one is archived, so it is the colony's one fixed piece of narrative furniture — what
 * used to be the lander is now the yard the whole colony's crew works out of.
 *
 * **It is two buildings, and neither of them came out of a pack.** The depot stands for the
 * owner's own premises: a brick office with a much larger grey loods attached. No pack here
 * has either shape. `city-parts.txt` has no warehouse, depot, industrial, garage or hangar —
 * checked with `grep -iE "warehouse|depot|shop|industrial|garage|hangar"` before any of this
 * was written — and its eight shells are all 2 x 2 townhouse blocks.
 *
 * Three things were tried in order, and the first two are worth not repeating. A base-kit
 * `basemodule_D` repainted brick read as what it is, a space-station pod. The same pod with a
 * city shell balanced on its roof read as a pod with a storey on it. And the city shell that
 * held the middle of the cell for both of those — `building_G_withoutBase`, the pack's
 * largest — read as a townhouse with a shop awning, because that is what it is.
 *
 * So both buildings are composed, piece by piece, out of KayKit's *Prototype Bits*: a greybox
 * pack of walls, openings, roof slopes and beams cut to one 4-unit module, which is the kit
 * for a shape nobody sells. Each is its own merged mesh — see `_buildFrom` — and the
 * base-kit crates in the yard are a third, because a merged geometry carries one material and
 * the two packs have different atlases.
 *
 * The loading dock, the rooftop beacon, the yard floodlights and the apron stay procedural,
 * as they were on the lander: they are operational dressing, not the building itself, and
 * none of them existed as a nameable part in any pack to begin with.
 */

/**
 * The prototype pack's 4-unit module, brought onto the colony's scale.
 *
 * At 0.4 a module is 1.6 world units, which is what puts a wall piece at a believable storey
 * height beside houses built on the city kit's own 2.4. Both buildings here are cut to it, so
 * their courses line up across the join.
 */
const PROTO_SCALE = 0.4

/** The pack's module, which every piece is cut to, and a quarter turn — the only two numbers
 *  the piece lists below repeat often enough to be worth naming. */
const M = 4
const QUARTER = Math.PI / 2

/** How thin a panel has to be to hide inside a wall's own thickness: the glazing behind a
 *  window opening and the leaf in a doorway are both one of these, invisible except through
 *  the hole they sit in. */
const GLAZING = 0.3

/** How far the paved yard reaches from the depot's anchor. Sized to the working yard in front
 *  of the dock, deliberately not to the buildings: the depot owns a 12-unit cell, and an apron
 *  that covered both of them would run out into the street's own verge. */
const YARD_REACH = 1.6

/**
 * Where the depot's front is, and where its big door lands.
 *
 * The loading dock, the crew's door point and the cars' arrival all key off this one line, so
 * it is a number the buildings are placed against rather than one read back off whichever
 * building happens to be at the front. `DOOR_X` is the depot's own anchor, which is where the
 * dock plate already sits — the loods is positioned so its big door is centred on it.
 */
const DEPOT_FRONT = 1.6
const DOOR_X = 0

/**
 * The office: a brick block on the west end, and the smaller half of the depot.
 *
 * It was the first thing built here out of Prototype Bits, as a hall, and it turned out to be
 * an office — brick, low, a rank of windows down the street, its own door. The owner's real
 * depot is that shape too: a modest brick office with a much larger grey loods attached, and
 * once the loods existed this stopped needing to be anything else.
 *
 * Everything is in the pack's own authored units, scaled once on the way out. Working in
 * module units is the point of the pack: a wall is 4 wide, a window is 4 wide, three of them
 * fill a 12-unit side exactly, and no joint needs a measured offset.
 */
export const OFFICE = {
  /** The long walls' centre lines, so the footprint is 8 units across: two modules. */
  halfX: 4,
  /** The gable walls' centre lines: three modules deep, and a window module in each. */
  halfZ: 6,
  /** The brick course — one module, the full height of a wall piece. */
  wall: 4,
  /** The cladding course standing on it, which is what this has instead of a first floor. */
  clad: 2,
  /** The ridge above the eaves. Two units over a five-unit run is a 22-degree pitch. */
  rise: 2,
  /** How far the eaves reach past the wall's centre line — half of it is the wall's own
   *  thickness, so the overhang proper is half a unit. */
  eaveOut: 1,
}

/**
 * The loods: the grey shed, and the building the depot actually is.
 *
 * The depot used to be a city-kit shell — `building_G_withoutBase`, the pack's largest — and
 * the owner's verdict on it was that it looked too much like a *building*. It did: it is a
 * townhouse with a shop awning, and no amount of placing it beside an industrial hall stops it
 * reading as somewhere you live. So the shell is gone and the mass it held is a loods.
 *
 * It is the wider of the two and the taller, 16 units across against the office's 8 and eight
 * to the eaves against its six. Its ridge runs along **x**, its own long axis, so the street
 * front is an eaves side with the big door in it rather than a gable — which is what a loods
 * looks like, and what lets the door sit on the dock that was already there.
 */
export const LOODS = {
  /** Four modules across, against the office's two. */
  halfX: 8,
  /** The same depth as the office, so the two share a back wall line. */
  halfZ: 6,
  /** Two full wall courses, plain: a loods has no storeys to mark. */
  wall: 8,
  /** Three units over a seven-unit run: 23 degrees, the office's pitch within a degree, so
   *  two roofs at different heights still read as one roofscape. */
  rise: 3,
  eaveOut: 1,
  /** The big door, in modules. `west` is the stretch of wall between the west corner and the
   *  door, and it is what makes the front modular: 2 + 6 + 8 is the full 16, so every piece
   *  either side of the opening is a whole wall or a whole half wall. */
  door: { width: 6, height: 6, west: 2 },
}

/** Where the big door's centre falls along the loods' own front, in the pack's units. The
 *  building is placed by this rather than by its walls: the door has to land on the dock, and
 *  everything else follows from that. */
const doorCentre = () => -LOODS.halfX + LOODS.door.west + LOODS.door.width / 2

/**
 * Where each building stands in the depot's own frame.
 *
 * The office's front wall face and the loods' front wall face both land on `DEPOT_FRONT`, so
 * the two present one line to the street and neither stands ahead of the loading dock. Across
 * the depot they are placed to *overlap*: the office's east wall and the loods' west wall share
 * the same centre line, so there is no slot of daylight between two buildings meant to read as
 * one, and each one's eaves disappear into the other's wall.
 */
export const OFFICE_SPOT = {
  x: -2.0 - (OFFICE.halfX + 0.5) * PROTO_SCALE,
  z: DEPOT_FRONT - (OFFICE.halfZ + 0.5) * PROTO_SCALE,
  /** Set into the ground rather than balanced on it. The town's ground is flat to within a
   *  fraction of a unit, not perfectly flat, and a building five units deep is long enough for
   *  that fraction to show as daylight under a corner. */
  y: -0.1,
}

export const LOODS_SPOT = {
  x: DOOR_X - doorCentre() * PROTO_SCALE,
  z: DEPOT_FRONT - (LOODS.halfZ + 0.5) * PROTO_SCALE,
  y: -0.1,
}

/** What a composed building occupies, in the depot's frame — eaves included, which is the part
 *  that reaches furthest and the part nobody remembers to check.
 *
 *  `ridgeAxis` is which way the roof runs: the office's ridge runs along z, so its eaves
 *  overhang in x; the loods' runs along x, so its eaves overhang in z. */
function box(shape, spot, ridgeAxis) {
  const out = (halfX, halfZ) => ({
    minX: spot.x - halfX,
    maxX: spot.x + halfX,
    minZ: spot.z - halfZ,
    maxZ: spot.z + halfZ,
    eaveY: spot.y + (shape.wall + (shape.clad ?? 0)) * PROTO_SCALE,
    ridgeY: spot.y + (shape.wall + (shape.clad ?? 0) + shape.rise) * PROTO_SCALE,
  })
  const wall = 0.5 * PROTO_SCALE
  const eave = shape.eaveOut * PROTO_SCALE
  return ridgeAxis === 'z'
    ? out(shape.halfX * PROTO_SCALE + eave, shape.halfZ * PROTO_SCALE + wall)
    : out(shape.halfX * PROTO_SCALE + wall, shape.halfZ * PROTO_SCALE + eave)
}

/**
 * The sign over the loods' big door.
 *
 * The lintel already carries the depot's own colour — it is the one piece of either building
 * that takes the accent, and the one that lights up after dark — so the wordmark goes on that
 * band rather than on a plate of its own. What is added here is the lettering.
 */
const SIGN_TEXT = 'moving-in'
/** Cream, the same off-white the name plates and district banners are lettered in. */
const SIGN_COLOUR = '#f4f2ee'
/** How far the lettering stands off the wall: enough to clear the band it sits on, and well
 *  inside the roof's own 0.2 overhang, so it stays under the canopy. */
const SIGN_PROUD = 0.012

/**
 * Where the wordmark goes and how big it may be, in the depot's own frame.
 *
 * Off the door's own measurements rather than typed: a wider door takes a wider sign, and a
 * door moved along the front takes the sign with it. `maxWidth` and `maxHeight` are the box
 * the lettering has to fit — how much of it the word actually fills depends on how long the
 * word is, which only the canvas can measure.
 */
export function signPlacement() {
  const bottom = LOODS_SPOT.y + LOODS.door.height * PROTO_SCALE
  const top = LOODS_SPOT.y + LOODS.wall * PROTO_SCALE
  return {
    x: DOOR_X,
    y: (bottom + top) / 2,
    z: DEPOT_FRONT + SIGN_PROUD,
    // Signwriting proportions: most of the door's width, about half the band's height.
    maxWidth: LOODS.door.width * PROTO_SCALE * 0.88,
    maxHeight: (top - bottom) * 0.52,
  }
}

export const officeBox = () => box(OFFICE, OFFICE_SPOT, 'z')
export const loodsBox = () => box(LOODS, LOODS_SPOT, 'x')

/**
 * Every piece of the office, in the pack's authored units, as data.
 *
 * A list rather than a run of `c.add` calls because it is the composition that has to be
 * right — that the sides are covered by whole pieces, that the roof reaches the walls it
 * stands on, that nothing sticks out past the cell. All of that is arithmetic on this array,
 * so `test/depot-buildings.test.mjs` checks the building it will actually be rather than the
 * numbers it was typed from.
 *
 * Offsets are the piece's own centre on its own centre line. Walls stand on their footprint
 * line, so a piece stretched to a side's full length closes both corners by overlapping the
 * walls it meets.
 */
export function officePieces() {
  const { halfX, halfZ, wall, clad, rise, eaveOut } = OFFICE
  const { BRICK, GREY, SLATE, DARK, ACCENT } = CELL_PROTOTYPE
  const pieces = []
  const add = (part, o) => pieces.push({ part, ...o })

  // --- the brick course ---------------------------------------------------------------
  add('Primitive_Wall', { z: -halfZ, sx: (halfX * 2) / M, cell: BRICK })
  add('Primitive_Wall', { x: halfX, ry: QUARTER, sx: (halfZ * 2) / M, cell: BRICK })
  // The street side gets the windows — three window modules fill it exactly.
  for (const z of [-M, 0, M]) add('Primitive_Window', { x: -halfX, z, ry: QUARTER, cell: BRICK })
  // Glazing: one dark panel inside the wall's own thickness, so it is invisible except through
  // the three openings, where it is the only thing there is to see.
  add('Primitive_Wall', { x: -halfX, ry: QUARTER, sx: (halfZ * 2) / M, sz: GLAZING, cell: DARK })
  // The front, which is a gable end: a wall for half of it and the door for the other half,
  // out on the street side where nothing has to reach past the loods to use it.
  add('Primitive_Wall', { x: halfX / 2, z: halfZ, sx: halfX / M, cell: BRICK })
  add('Primitive_Wall', { x: -halfX / 2, z: halfZ, sx: halfX / M, sz: GLAZING, cell: DARK })

  // --- the cladding course ------------------------------------------------------------
  add('Primitive_Wall_Short', { y: wall, z: -halfZ, sx: (halfX * 2) / M, cell: GREY })
  add('Primitive_Wall_Short', { y: wall, x: halfX, ry: QUARTER, sx: (halfZ * 2) / M, cell: GREY })
  add('Primitive_Wall_Short', { y: wall, x: -halfX, ry: QUARTER, sx: (halfZ * 2) / M, cell: GREY })
  add('Primitive_Wall_Short', { y: wall, x: halfX / 2, z: halfZ, sx: halfX / M, cell: GREY })
  // ...except directly over the door, which is the sign band.
  add('Primitive_Wall_Short', { y: wall, x: -halfX / 2, z: halfZ, sx: halfX / M, cell: ACCENT })

  // --- the roof, ridge along z ----------------------------------------------------------
  // Two solid wedges meeting over the middle. Solid, not two planes, which is what closes the
  // gable ends: the wedge's own end face is the triangle above the wall, so there is no hole
  // to fill and no third piece to fit into it.
  const run = halfX + eaveOut
  for (const side of [1, -1]) {
    add('Primitive_Slope', {
      sx: run / M,
      sy: rise / M,
      // Out to the gable walls' outer faces, so the roof covers what it stands on.
      sz: (halfZ * 2 + 1) / M,
      // The slope piece falls toward its own +x; the far side is the same piece turned round.
      ry: side > 0 ? 0 : Math.PI,
      x: (side * run) / 2,
      y: wall + clad,
      cell: SLATE,
    })
  }

  return pieces
}

/**
 * Every piece of the loods, the same way.
 *
 * Two differences from the office, both of them what makes it a loods rather than a big
 * office. Its walls are two plain courses with nothing marking a storey, lighter above than
 * below the way a clad shed is. And its ridge runs along **x**, so the street front is an
 * eaves side: the big door sits under a roof that slopes toward it, and its overhang carries
 * a little way over the dock, which is what a loading bay has.
 */
export function loodsPieces() {
  const { halfX, halfZ, wall, rise, eaveOut, door } = LOODS
  const { GREY, PALE, SLATE, DARK, ACCENT } = CELL_PROTOTYPE
  const pieces = []
  const add = (part, o) => pieces.push({ part, ...o })

  // Where the big door sits along the front, and the two stretches of wall either side of it.
  const centre = doorCentre()
  const doorEast = centre + door.width / 2
  const westRun = door.west
  const eastRun = halfX - doorEast

  // --- the lower course, y 0..4 ---------------------------------------------------------
  add('Primitive_Wall', { z: -halfZ, sx: (halfX * 2) / M, cell: GREY })
  add('Primitive_Wall', { x: -halfX, ry: QUARTER, sx: (halfZ * 2) / M, cell: GREY })
  add('Primitive_Wall', { x: halfX, ry: QUARTER, sx: (halfZ * 2) / M, cell: GREY })
  add('Primitive_Wall', { x: -halfX + westRun / 2, z: halfZ, sx: westRun / M, cell: GREY })
  add('Primitive_Wall', { x: doorEast + eastRun / 2, z: halfZ, sx: eastRun / M, cell: GREY })

  // --- the upper course, y 4..8 ---------------------------------------------------------
  add('Primitive_Wall', { y: M, z: -halfZ, sx: (halfX * 2) / M, cell: PALE })
  add('Primitive_Wall', { y: M, x: -halfX, ry: QUARTER, sx: (halfZ * 2) / M, cell: PALE })
  // The east side carries the clerestory: three window modules high up, which is where a shed
  // takes its daylight from. Their openings land at 5..7, well clear of anything stacked
  // against the wall inside.
  for (const z of [-M, 0, M]) add('Primitive_Window', { y: M, x: halfX, z, ry: QUARTER, cell: PALE })
  add('Primitive_Wall', { y: M, x: halfX, ry: QUARTER, sx: (halfZ * 2) / M, sz: GLAZING, cell: DARK })
  add('Primitive_Wall', { y: M, x: -halfX + westRun / 2, z: halfZ, sx: westRun / M, cell: PALE })
  add('Primitive_Wall', { y: M, x: doorEast + eastRun / 2, z: halfZ, sx: eastRun / M, cell: PALE })

  // --- the big door ----------------------------------------------------------------------
  // A shutter filling the opening, and the depot's own colour on the lintel over it: the one
  // piece of the loods that takes the accent, and the one piece that lights up after dark.
  add('Primitive_Wall', { x: centre, z: halfZ, sx: door.width / M, sy: door.height / M, sz: GLAZING, cell: DARK })
  add('Primitive_Beam', {
    x: centre,
    y: door.height,
    z: halfZ,
    sx: door.width / M,
    sy: wall - door.height,
    cell: ACCENT,
  })

  // --- the roof, ridge along x ------------------------------------------------------------
  const run = halfZ + eaveOut
  for (const side of [1, -1]) {
    add('Primitive_Slope', {
      sx: run / M,
      sy: rise / M,
      sz: (halfX * 2 + 1) / M,
      // A quarter turn from the office's: this ridge runs the other way, so the piece that
      // falls toward its own +x has to be turned to fall along z instead.
      ry: side > 0 ? -QUARTER : QUARTER,
      z: (side * run) / 2,
      y: wall,
      cell: SLATE,
    })
  }

  return pieces
}

/** Crates stacked in the yard, in the base kit's own grid units — scaled by `CONTAINER_SCALE`
 *  after `finish()`, the same order of operations `buildings.js` uses for its own recipes:
 *  offsets baked in before the merge, one uniform scale after it.
 *
 *  Behind the loods, in the strip between its back wall and the cell's own edge. They used to
 *  stand in the middle of the cell, which is where the loods now is — and a crate inside a
 *  closed building is invisible rather than obviously wrong, which is the kind of thing that
 *  survives a move unnoticed. Nothing here pokes out past the loading dock at the front,
 *  which is still the rule. */
const CONTAINER_SCALE = 1.4
const CONTAINER_SPOTS = [
  { x: 0.45, z: -3.15, ry: 0.32 },
  { x: 1.05, z: -3.45, ry: -0.41 },
  { x: 1.75, z: -3.15, ry: 0.18 },
  { x: 2.35, z: -3.5, ry: -0.27 },
  { x: 1.4, z: -3.1, ry: 0.5, y: 0.2 }, // one crate up on the pile
]

const CELL_COUNT = ATLAS.cols * ATLAS.rows

/**
 * Surface response, one flat value for the whole atlas — the same call `houses.js` makes for
 * the city and furniture packs: brick, clad sheet and glass here are all matte, and a per-cell
 * table would be guessing dressed up as data.
 */
const SHELL_ROUGHNESS = new Float32Array(CELL_COUNT).fill(0.7)
const NO_METAL = new Float32Array(CELL_COUNT).fill(0)
/** The one cell either building paints in the depot's own colour: the band over its door.
 *  Everything else is the pack's own brick, grey and slate, which is what keeps the accent
 *  reading as a sign rather than as the building. */
const DEPOT_ACCENT_MASK = cellMask([CELL_PROTOTYPE.ACCENT])

/** The colony's brand colour — the same default `houses.js`/`buildings.js` fall back to for an
 *  unowned structure. Nothing about the depot belongs to one thread, so unlike a house or a
 *  colony building it never takes a per-repo accent as an argument. */
const DEPOT_ACCENT = 0xc96442

/**
 * The wordmark, drawn to a canvas once.
 *
 * The same recipe `plots.js` uses for its name plates — measured, drawn at a pixel ratio,
 * mipmapped — but without the halo and the billboarding those need. This one is painted on a
 * wall: it is lit like the wall, it turns with the building, and it is read from the street
 * rather than from wherever the camera happens to be.
 */
function createWordmark(text, colour, pixelRatio = 4) {
  const fontSize = 64
  const font = `600 ${fontSize}px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif`
  const pad = fontSize * 0.3

  const measure = document.createElement('canvas').getContext('2d')
  measure.font = font
  // Letter-spacing is what makes a word read as a sign rather than as a caption. Chrome has
  // had it since 99; a browser without it ignores the assignment and the wordmark comes out
  // a little tighter, which is a worse sign rather than a broken one.
  measure.letterSpacing = '2px'
  const textWidth = Math.ceil(measure.measureText(text).width)

  const w = textWidth + pad * 2
  const h = fontSize + pad * 2
  const canvas = document.createElement('canvas')
  canvas.width = Math.ceil(w * pixelRatio)
  canvas.height = Math.ceil(h * pixelRatio)
  const c = canvas.getContext('2d')
  c.scale(pixelRatio, pixelRatio)
  c.font = font
  c.letterSpacing = '2px'
  c.textAlign = 'center'
  c.textBaseline = 'middle'
  c.fillStyle = colour
  c.fillText(text, w / 2, h / 2)

  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.minFilter = THREE.LinearMipmapLinearFilter
  texture.magFilter = THREE.LinearFilter
  texture.generateMipmaps = true
  texture.anisotropy = 8
  return { texture, aspect: w / h }
}

export class Ship {
  constructor(scene, position) {
    this.group = new THREE.Group()
    this.group.position.copy(position)
    // Turned so the loading dock points back toward the middle of the colony.
    this.group.rotation.y = Math.atan2(-position.x, -position.z)
    this.group.name = 'depot'
    scene.add(this.group)
    this.scene = scene

    // Every dimension the dock, the beacon and the yard lights need, solved from the
    // buildings' own measurements rather than from the buildings themselves — they are
    // composed after `loadKit()` resolves, and all of this has to be in place before then.
    this.frontZ = DEPOT_FRONT // the wall the dock runs out from
    this.ridgeHeight = loodsBox().ridgeY // the loods is the taller of the two
    this.yardRadius = YARD_REACH

    this._buildDock() // sets doorLocal from where the dock actually ends
    this._buildLights()

    this.traffic = 0 // the dock glows brighter while crew or a car are using it

    /**
     * The buildings and the yard all come out of the model kits, and the kits are not
     * necessarily loaded yet: `game/colony.js` constructs the depot synchronously in its own
     * constructor, and `main.js` only awaits `loadKit()` afterwards, once `boot()` runs — so
     * calling `part()` here directly throws ("no part named ...") on every single load.
     * `loadKit()` is written to be idempotent and safe to call from anywhere — "the first
     * call owns the requests and everybody else awaits the same promise" — so this just joins
     * whichever fetch is already in flight rather than starting a second one, and fills the
     * depot in the moment it resolves.
     */
    loadKit().then(() => {
      if (this._disposed) return // archived/rebuilt before the kit ever arrived
      this.office = this._buildFrom(officePieces(), OFFICE_SPOT)
      this.loods = this._buildFrom(loodsPieces(), LOODS_SPOT)
      this._buildSign()
      this._buildYard()
    })
  }

  /**
   * One composed building: its pieces merged, scaled, dropped on its spot, and given the
   * prototype atlas.
   *
   * Both buildings go through this because both are the same idea — a list of pieces out of
   * one greybox pack, painted per piece. Each is its own mesh: a merged geometry carries one
   * material, and while these two share an atlas they do not share a position, so keeping
   * them apart is what lets either be moved or repainted without the other.
   */
  _buildFrom(pieces, spot) {
    const c = new Composer({ kit: 'prototype' })
    for (const piece of pieces) c.add(piece.part, piece)

    const geo = c.finish()
    geo.scale(PROTO_SCALE, PROTO_SCALE, PROTO_SCALE)
    geo.translate(spot.x, spot.y, spot.z)
    geo.computeBoundingBox()

    const mesh = new THREE.Mesh(
      geo,
      decorate(
        new THREE.MeshStandardMaterial({
          map: atlasTexture('prototype'),
          roughness: 0.85,
          metalness: 0,
          emissive: 0x000000,
          // Closed on every side — a leaf in each doorway and glazing behind each window, so
          // there is no inside to see and nothing to render two-sided.
          side: THREE.FrontSide,
        }),
        {
          uProgress: { value: 1 },
          uMaxY: { value: geo.boundingBox.max.y },
          uMinY: { value: geo.boundingBox.min.y },
          // The depot is whole from its first frame — nothing sinks it out of the ground the
          // way a growing colony building does, and nothing about it reveals piece by piece.
          uSink: { value: 0 },
          uAccent: { value: new THREE.Color(DEPOT_ACCENT) },
          uNight: buildingUniforms.uNight,
          uTime: buildingUniforms.uTime,
          uCellAccent: { value: DEPOT_ACCENT_MASK },
          uCellRoughness: { value: SHELL_ROUGHNESS },
          uCellMetalness: { value: NO_METAL },
        }
      )
    )
    mesh.castShadow = true
    mesh.receiveShadow = true
    // No custom depth material: uSink is 0 and uProgress is pinned at 1, so three's own depth
    // pass already puts every vertex exactly where this mesh does.
    this.group.add(mesh)
    return mesh
  }

  /**
   * The wordmark on the band over the big door.
   *
   * Its own mesh and its own material, because it is the one thing on either building that is
   * not a swatch of the prototype atlas — it is a canvas. Which is also what lets the depot
   * say whose depot it is.
   *
   * Lit like the wall by day and emissive after dark, the same way the dock's edge strips and
   * the pad lights work: the band behind it already comes on at night, so lettering that did
   * not would read as a shadow across it.
   */
  _buildSign() {
    const at = signPlacement()
    const { texture, aspect } = createWordmark(SIGN_TEXT, SIGN_COLOUR)
    // Whichever of the two runs out first decides the size, so a longer word sets itself
    // smaller rather than running off the end of the band.
    const height = Math.min(at.maxHeight, at.maxWidth / aspect)

    this.signTexture = texture
    this.signMaterial = new THREE.MeshStandardMaterial({
      map: texture,
      transparent: true,
      roughness: 0.6,
      metalness: 0,
      emissive: new THREE.Color(SIGN_COLOUR),
      emissiveMap: texture,
      emissiveIntensity: 0,
      // It sits a hair off a wall it never has to sort against, and writing depth would have
      // it z-fight its own transparent margin.
      depthWrite: false,
    })
    this.sign = new THREE.Mesh(new THREE.PlaneGeometry(height * aspect, height), this.signMaterial)
    this.sign.position.set(at.x, at.y, at.z)
    this.group.add(this.sign)
  }

  /**
   * Where the depot's buildings stand in the world, as circles for the crew's navigation to
   * walk around.
   *
   * The depot's own keep-clear circle is centred on the anchor and reaches 3.4, which covers
   * neither of these — the loods runs out to 4.8 on one side and the office to 5.8 on the
   * other. Without this, crew would route straight through them.
   *
   * Computed here rather than in `colony.js` because the positions are in the depot's own
   * turned frame, and this is where that frame is known.
   */
  buildingObstacles() {
    const a = this.group.rotation.y
    const cos = Math.cos(a)
    const sin = Math.sin(a)
    return [officeBox(), loodsBox()].map((b) => {
      const x = (b.minX + b.maxX) / 2
      const z = (b.minZ + b.maxZ) / 2
      return {
        x: this.group.position.x + (x * cos + z * sin),
        z: this.group.position.z + (-x * sin + z * cos),
        r: Math.hypot((b.maxX - b.minX) / 2, (b.maxZ - b.minZ) / 2),
      }
    })
  }

  /**
   * The yard: base-kit cargo containers stacked behind the shell. A second mesh, not folded
   * into the shell's own geometry — the city and base kits have separate atlases, and a merged
   * geometry can only carry one material, so a container merged into the shell's buffer would
   * sample its colour off the wrong texture entirely. Requires `loadKit()` to have resolved.
   */
  _buildYard() {
    const c = new Composer({ kit: 'base' })
    for (const spot of CONTAINER_SPOTS) c.add('containers_A', spot)
    const geo = c.finish()
    geo.scale(CONTAINER_SCALE, CONTAINER_SCALE, CONTAINER_SCALE)

    // Plain material, no accent or night glow: yard clutter, not a building — the same
    // treatment `world/plots.js` gives base-kit props scattered on a plot.
    this.yard = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: atlasTexture('base'), roughness: 0.6, metalness: 0.05 }))
    this.yard.castShadow = true
    this.yard.receiveShadow = true
    this.group.add(this.yard)
  }

  /**
   * The loading dock: a flat plate at the shell's front face, since the shell sits flush on
   * the ground and there is no hatch to climb down from any more. Its length and the door
   * point are solved from where the shell's own front wall actually is, the way the lander's
   * ramp used to solve its length from the hatch and the ground.
   */
  _buildDock() {
    const width = 2.2
    const length = 2.0
    const nearZ = this.frontZ
    const farZ = nearZ + length

    const geo = new THREE.BoxGeometry(width, 0.12, length)
    geo.translate(0, 0.06, nearZ + length / 2)
    this.dock = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x3a3a40, roughness: 0.85, metalness: 0.05 }))
    this.dock.castShadow = true
    this.dock.receiveShadow = true
    this.group.add(this.dock)

    // Lane markings across the plate, the way a real loading bay paints its floor.
    const laneParts = []
    const steps = 5
    for (let i = 1; i < steps; i++) {
      const t = new THREE.BoxGeometry(width - 0.3, 0.03, 0.09)
      t.translate(0, 0.13, nearZ + (length * i) / steps)
      laneParts.push(t)
    }
    const laneGeo = merge(laneParts)
    const laneMesh = new THREE.Mesh(laneGeo, new THREE.MeshStandardMaterial({ color: 0xd8d3c8, roughness: 0.6 }))
    this.group.add(laneMesh)

    // Lit edge strips down each side — brighten while the dock is busy, same technique as the
    // lander's ramp strips.
    const edgeParts = []
    for (const dx of [-width / 2 + 0.08, width / 2 - 0.08]) {
      const s = new THREE.BoxGeometry(0.1, 0.05, length - 0.2)
      s.translate(dx, 0.1, nearZ + length / 2)
      edgeParts.push(s)
    }
    this.stripMaterial = new THREE.MeshBasicMaterial({ color: 0xff9a3c, toneMapped: true })
    this.strips = new THREE.Mesh(merge(edgeParts), this.stripMaterial)
    this.group.add(this.strips)

    // Crew and cars appear and vanish a step beyond the dock plate, at ground level.
    this.doorLocal = new THREE.Vector3(0, 0, farZ + 0.6)
  }

  _buildLights() {
    // A rooftop hazard beacon — the industrial-yard equivalent of an aircraft strobe, and
    // just as much a fixture on a real depot as it was on a lander.
    this.beaconMaterial = new THREE.MeshBasicMaterial({ color: 0xffb020, toneMapped: true })
    this.beacon = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), this.beaconMaterial)
    const ridge = loodsBox()
    this.beacon.position.set((ridge.minX + ridge.maxX) / 2, this.ridgeHeight + 0.16, (ridge.minZ + ridge.maxZ) / 2)
    this.group.add(this.beacon)

    // Floodlights ringing the yard — but only where there is yard. The depot used to be one
    // building on the middle of its cell and a plain ring cleared it; it is now two, and most
    // of a ring this size falls inside them. A light inside a closed building is not visible
    // and not wrong-looking, which is exactly why it would never be noticed.
    const pads = []
    const boxes = [officeBox(), loodsBox()]
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2
      const r = this.yardRadius + 1.5
      const x = Math.cos(a) * r
      const z = Math.sin(a) * r
      if (boxes.some((b) => x > b.minX && x < b.maxX && z > b.minZ && z < b.maxZ)) continue
      const l = new THREE.SphereGeometry(0.11, 8, 6)
      l.translate(x, 0.11, z)
      pads.push(l)
    }
    this.padMaterial = new THREE.MeshBasicMaterial({ color: 0x9fd8ff, toneMapped: true })
    this.padLights = new THREE.Mesh(merge(pads), this.padMaterial)
    this.group.add(this.padLights)

    // Plain asphalt under the depot — nothing about a delivery yard launches, so unlike the
    // lander's pad this is not scorched.
    const apron = new THREE.Mesh(
      new THREE.CircleGeometry(this.yardRadius + 2.3, 32),
      new THREE.MeshStandardMaterial({ color: 0x3c3c42, roughness: 0.95 })
    )
    apron.rotation.x = -Math.PI / 2
    apron.position.y = 0.02
    apron.receiveShadow = true
    this.group.add(apron)
  }

  /** World position of the foot of the dock — where crew and cars appear and vanish. */
  shipDoor(out = new THREE.Vector3()) {
    return out.copy(this.doorLocal).applyMatrix4(this.group.matrixWorld)
  }

  update(dt, elapsed, night) {
    // Beacon: a double-blink, like a real hazard light.
    const t = elapsed % 2
    const strobe = t < 0.08 || (t > 0.2 && t < 0.28) ? 1 : 0.08
    this.beaconMaterial.color.setRGB(3.0 * strobe, 1.8 * strobe, 0.15 * strobe)

    const gain = 0.35 + night * 2.2
    this.padMaterial.color.setRGB(0.55 * gain, 0.82 * gain, 1.1 * gain)

    // The sign lights up with the band it is painted on. Guarded because the depot runs from
    // its first frame and the buildings only exist once the kit has loaded.
    if (this.signMaterial) this.signMaterial.emissiveIntensity = night * 1.15

    // Dock edge lights brighten while anyone is using the dock.
    this.traffic = Math.max(0, this.traffic - dt * 1.5)
    const busy = Math.min(1, this.traffic)
    const pulse = 0.6 + 0.4 * Math.sin(elapsed * 4)
    const s = (0.5 + night * 1.2) * (1 + busy * pulse * 1.6)
    this.stripMaterial.color.setRGB(1.0 * s, 0.55 * s, 0.18 * s)
  }

  /** Called when the dock is used, so the lights react. */
  ping() {
    this.traffic = Math.min(2.5, this.traffic + 1)
  }

  dispose() {
    this._disposed = true // in case the kit resolves after this call
    // The sign's texture is the depot's own. Every other map here is a kit atlas, shared with
    // every building on the map, and disposing one of those would blank the colony.
    this.signTexture?.dispose()
    this.group.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose()
        o.material.dispose()
      }
    })
    this.scene.remove(this.group)
  }
}

/** Merge a set of same-material geometries into one draw call, disposing the originals. */
function merge(parts) {
  const geo = BufferGeometryUtils.mergeGeometries(parts, false)
  parts.forEach((g) => g.dispose())
  return geo
}
