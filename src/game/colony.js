import * as THREE from 'three'
import { PLANETS, createTerrain, createScatter, terrainHeight } from '../world/planet.js'
import { Sky } from '../world/sky.js'
import {
  Plot,
  allocateCells,
  colonyAnchor,
  setColonySpacing,
  cellWorld,
  shipPosition,
  DEPOT_ROAD_SHIFT,
  createLabel,
  createBanner,
  hashString,
  worldToCell,
  DECK_TOP,
  PLOT_PALETTE,
  key,
} from '../world/plots.js'
import { buildingUniforms } from '../world/buildings.js'
import { createHouse } from '../world/houses.js'
import {
  pathLength,
  pointAt,
  kerbBack,
  driveStep,
  ridesAlong,
  drivingLanes,
} from '../world/drive-path.js'
import { depotApproach, planStreets } from '../world/streets.js'
import { roadCells } from '../world/road-path.js'
import { createRoads, DRIVING_LANE_OFFSET, PARKING_LANE_OFFSET, roadSurfaceY } from '../world/road-mesh.js'
import { createTown, townStamp } from '../world/town-mesh.js'
import { createBicycles } from '../world/bicycles.js'
import { createStreetTrees } from '../world/street-trees.js'
import { createParkFurniture } from '../world/park-furniture.js'
import { greenBlocks, keepClearCells, parkItems } from '../world/town-plan.js'
import { Deliveries, CAR_GROUND_DROP, CAR_SPEED } from '../world/deliveries.js'
import { TrafficCars } from '../world/traffic-cars.js'
import {
  HEADWAY,
  headwayFactor,
  newVehicle,
  parkedBikes,
  parkedCars,
  routeEndpoints,
  stepVehicle,
  trafficCount,
} from '../world/traffic.js'
import { Ship } from '../world/ship.js'
import { Astronauts } from '../agents/astronauts.js'
import { Indicators, BADGE } from '../agents/indicators.js'
import { MAX_AGENT_CAP } from '../core/settings.js'
import { Particles } from '../agents/particles.js'
import { Navigation } from '../agents/navigation.js'
import { liveThreadsForColony } from './hidden-projects.js'
import { stepProgress } from './growth.js'
import { statusFor } from './status.js'

export { statusFor }

/**
 * The colony: everything that turns a list of agent threads into a place.
 *
 * The mapping is the whole game. It is a strict precedence rather than a set of independent
 * flags — errored, then running, then merged, then unread — so an astronaut can only ever be
 * telling you one thing, and the loudest true thing wins.
 *
 *   errored        → blocked, red eyes, a `!` over its head
 *   running        → hammering away at its building, sparks flying
 *   PR merged      → celebrating, confetti, a `✓`
 *   unread         → stopped and waiting on you, a bobbing `?` — click it to open the thread
 *   long idle      → asleep on the job
 *   anything else  → pottering about its plot
 *
 * Threads group by repo, one repo per plot, and every thread gets a building seeded
 * from its own session id — so the colony's skyline is a stable, readable picture of what
 * you have running.
 */

/** How wide an astronaut is, for the purpose of not fitting through gaps it should not. */
const AGENT_RADIUS = 0.26
/** Progress a live thread adds per second, so a working site visibly grows while you watch. */
const LIVE_GROWTH = 0.004
/** How many zones' positions to remember, including repos with nothing running in them. */
const LAYOUT_MEMORY = 80

// The depot's own cell, for planning streets. `SHIP_CELL` itself is module-local to
// `plots.js` and deliberately not exported; converting the depot's world position back to a
// cell with `worldToCell` gives the same answer without opening another export. Computed once
// at module scope rather than per call — the depot does not move.
const SHIP_CELL_FOR_STREETS = worldToCell(shipPosition().x, shipPosition().z)

/**
 * The seed kerbside parking is laid out from.
 *
 * Fixed rather than random: the same town parks the same cars every time it is opened,
 * which is what lets them read as scenery. A parked car that moved between sessions would
 * be the only thing in the colony that changed without anything having happened.
 */
const PARKED_SEED = 0x5ca1ab1e

/**
 * The reveal progress at which a house has already hidden itself.
 *
 * `setProgress` in houses.js switches the whole Group off below this, so this is the point
 * where a retiring site has finished emptying out and there is nothing left on screen for
 * `_removeBuilding` to take away.
 */
const RETIRED_PROGRESS = 0.02

/**
 * The reveal progress at which a site has broken ground and can take a delivery.
 *
 * Above `RETIRED_PROGRESS` on purpose: there has to be a house standing there for a car to
 * be driving to it.
 */
const DELIVERY_PROGRESS = 0.03

/**
 * Where a retiring site's reveal is parked while its car is still on the road.
 *
 * Above both of the numbers above, and below the first furniture reveal threshold (0.05, see
 * `revealThresholds` in houses.js): the house stands there stripped of its contents for
 * exactly as long as the car takes to get home, and only then goes. That is the picture the
 * spec asks for — the load leaves before the address does.
 *
 * Holding it above `DELIVERY_PROGRESS` is not cosmetic. `_updateDeliveries` skips a site that
 * has not broken ground, and a skipped site is one whose `driven` stops being stepped — which
 * is precisely how a retiring entry would come to sit on the colony's books forever.
 */
const RETIRE_HOLD = 0.04

export const STATUS_ORDER = ['blocked', 'waiting', 'working', 'celebrating', 'idle', 'sleeping']

export const STATUS_LABEL = {
  working: 'Working',
  waiting: 'Waiting on you',
  blocked: 'Blocked',
  celebrating: 'Shipped',
  idle: 'Idle',
  sleeping: 'Dormant',
  spawning: 'Arriving',
  leaving: 'Heading home',
}

/**
 * Which behaviours earn a badge. Dormant and idle deliberately get none: their pose and
 * face already say it, and with most of a real thread list sitting quiet, a badge over
 * every one of them buries the single `?` that actually wants you.
 */
const BADGE_FOR = {
  waiting: BADGE.waiting,
  blocked: BADGE.blocked,
  working: BADGE.working,
  celebrating: BADGE.done,
  sleeping: BADGE.none,
  idle: BADGE.none,
  spawning: BADGE.spawning,
  leaving: BADGE.leaving,
}

/** Transcript size → how finished the building looks. Log scale: threads grow fast early. */
/**
 * How far along a thread is, on a log scale over its transcript size. This drives the bar
 * on the thread card, and it drives how much furniture has arrived in the house — it no
 * longer drives the sink.
 *
 * The sink is the old mechanism: the shader draws construction by sinking the structure
 * into the ground and discarding what falls below the deck, and this value used to be
 * mapped onto that too, which meant most buildings stood permanently waist-deep in their
 * own plot. Read as a picture of a colony rather than as a chart, that is not "this thread
 * is young", it is "this building is broken" — a dome cut off by a flat plane looks like a
 * rendering fault, and it is the first thing the eye goes to. So the sink is now only what
 * it is good at: the few seconds of a new building rising out of the ground. Driving the
 * furniture reveal from this same value does not bring that bug back — an empty room reads
 * as "not moved in yet", not as broken geometry, so there is no flat plane to look wrong.
 */
export function transcriptProgress(thread) {
  const size = Math.max(1, thread.sizeBytes || 0)
  return THREE.MathUtils.clamp((Math.log10(size) - 3) / 3.5, 0.05, 1)
}

export class Colony {
  constructor(scene, settings, camera, renderer) {
    this.scene = scene
    this.settings = settings
    this.camera = camera
    this.renderer = renderer

    this.planet = PLANETS[settings.get('planet')] || PLANETS.moon
    this.sky = new Sky(scene, settings, renderer)
    this.sky.setPlanet(this.planet)
    // Push the stored time in explicitly. `settings.set` is a no-op when the value has not
    // changed, so a colony restored at dusk would otherwise open in the morning and stay
    // there until something happened to touch the slider.
    this.sky.setTime(settings.get('timeOfDay'))

    this.plots = new Map()
    this.plotOrder = []
    /** colony name → floating district banner, for visiting colonies only. */
    this.colonyBanners = new Map()
    /**
     * Where every zone sits, kept across polls *and* across the departures of the threads
     * that made it: a repo whose last session you archive comes back to the same ground
     * when a new one starts. Seeded from the colony file by `restoreLayout`.
     */
    this.plotCells = new Map()
    this.buildings = new Map()
    this.threads = new Map()
    this.usedAccents = new Set()

    this.worldGroup = new THREE.Group()
    this.worldGroup.name = 'world'
    scene.add(this.worldGroup)

    // Where the depot actually stands. It starts at its cell centre and leans toward the road
    // once the streets are known — see the street-planning block below.
    this._shipAnchor = shipPosition()
    this.ship = new Ship(scene, this._shipAnchor)
    this.astronauts = new Astronauts(scene, settings)
    this.astronauts.world = this._world()
    // Sized for the largest preset rather than the current one: unlike the astronaut meshes these
    // buffers are never rebuilt, so allocating against today's `maxAgents` means raising quality
    // later silently starves the badges — the one `?` that wants you being the thing that goes
    // missing. A badge is a single quad; the spare instances cost almost nothing.
    this.indicators = new Indicators(scene, settings, MAX_AGENT_CAP)
    this.particles = new Particles(scene, settings)
    // One car per thread at most, so the same ceiling the badges get. The cap is per accent
    // rather than per colony — `Deliveries` keeps a mesh pair per plot colour — so this is a
    // generous bound either way, and an unused instance slot costs nothing until it is written.
    this.deliveries = new Deliveries(scene, MAX_AGENT_CAP)
    // Ambient traffic: cars nobody owns, driving the same streets, plus every car parked at a
    // kerb — one fleet, because a parked car is the same instanced body standing still.
    //
    // The capacity is per (body, tint) bucket rather than a total, and it can no longer be
    // derived from `MAX_TRAFFIC`: parked cars are not capped by it. They are bounded by the
    // town instead — at most two per straight carriageway tile, thinned by `PARK_PERCENT` —
    // and spread across the palette's twenty buckets, which on a large colony comes to a few
    // dozen per bucket. 256 clears that with room to spare, and an unused instance slot costs
    // a matrix that is never drawn, since `_writeBucket` sets `count` to what it wrote.
    this.traffic = new TrafficCars(scene, 256)
    this._trafficVehicles = []
    this._parkedCars = []
    this._trafficRoutes = new Map()
    // Ever-increasing, so a vehicle that leaves the pool and a different one that later
    // takes its slot are never the same car with the same seed.
    this._trafficSeed = 0
    this.nav = new Navigation()
    this.astronauts.setNavigation(this.nav)

    this.plotGroup = new THREE.Group()
    this.labelGroup = new THREE.Group()
    scene.add(this.plotGroup, this.labelGroup)

    // Dismissing the HUD has to survive a poll: labels are chrome, and a scan landing while
    // everything is hidden must not quietly put them back on screen.
    this.uiVisible = true
    this.hoveredPlot = null
    this.activePlots = new Set()
    this._dustTint = new THREE.Color(this.planet.ground.high)
    this._c = new THREE.Color()
    this.stats = { agents: 0, projects: 0, working: 0, waiting: 0, blocked: 0, done: 0 }

    this._buildTerrain()
  }

  // ── terrain ─────────────────────────────────────────────────────────────────────────

  _buildTerrain() {
    if (this.terrain) {
      this.worldGroup.remove(this.terrain)
      this.terrain.geometry.dispose()
      this.terrain.material.dispose()
    }
    if (this.scatterGroup) {
      this.worldGroup.remove(this.scatterGroup)
      disposeTree(this.scatterGroup)
    }

    this.terrain = createTerrain(this.planet, this.settings.get('groundDetail'))
    this.worldGroup.add(this.terrain)
    this._buildScatter()

    // The ship has legs, and legs have to reach the ground. Its landing spot is a fixed
    // cell, but the height of that spot is the planet's, so it is set here rather than once
    // at construction — a world with more relief would otherwise leave it hovering.
    const ship = this._shipAnchor
    this.ship.group.position.y = terrainHeight(ship.x, ship.z, this.planet)

    this._dustTint.set(this.planet.ground.high)
  }

  /**
   * Ground scatter, placed to miss every tile of every plot, the ship's apron, and — since
   * the owner reported trees and rocks landing on the carriageway — every street and built
   * cell of the town. Green blocks are the one part of the town left open, which is what
   * plants them: the same wild-scatter pass that dresses the countryside also seeds them,
   * because nothing there is fenced off.
   *
   * Kept separate from the terrain because of *when* it has to run: the world is built
   * before the first roster arrives, so at that point there are no plots to avoid, and
   * boulders and trees end up under decks that are laid on top of them afterwards — poking
   * through in fragments. So this runs again whenever a zone's footprint changes, which is
   * cheap next to rebuilding the terrain mesh alongside it. The town is not known yet either,
   * on that same first build — `this.streets` only exists once `_syncPlots` has run once —
   * so the town fence is added only when it does.
   */
  _buildScatter() {
    if (this.scatterGroup) {
      this.worldGroup.remove(this.scatterGroup)
      disposeTree(this.scatterGroup)
    }
    const clear = []
    for (const plot of this.plotOrder) {
      for (const local of plot.localCenters) {
        clear.push({ x: plot.center.x + local.x, z: plot.center.z + local.z, r: 8.6 })
      }
    }
    const ship = this._shipAnchor
    clear.push({ x: ship.x, z: ship.z, r: 7.5 })
    if (this.streets) {
      clear.push(...keepClearCells({ streets: this.streets.all, claimed: this._claimedCells || new Set() }))
    }
    this.scatterGroup = createScatter(this.planet, this.settings.get('scatterDensity'), clear)
    this.worldGroup.add(this.scatterGroup)
    this._scatterFootprint = this._plotFootprint()
    // Whether this build knew the streets — so a colony with no plots yet (footprint stays
    // empty across the first `_syncPlots`) still gets its scatter fenced off the town the
    // moment the street plan exists, rather than waiting on a footprint change that may never
    // come.
    this._scatterHadStreets = !!this.streets
    // The crew routes around scatter, so a new scatter is a new navigation grid.
    if (this.nav) this._rebuildNavigation()
  }

  /** What the scatter has to avoid, as one string — cheap to compare every poll. */
  _plotFootprint() {
    return this.plotOrder.map((plot) => plot.signature).join('|')
  }

  /**
   * Called once the model kits are in.
   *
   * The colony is built before boot has finished fetching them, so the first terrain is
   * scattered with fallback primitives. Rebuilding it here is what puts the real trees and
   * boulders down — without it the ground keeps its placeholders until something else
   * happens to invalidate the terrain, which on a colony nobody touches is never.
   */
  onAssetsReady() {
    this._buildTerrain()
  }

  setPlanet(id) {
    const planet = PLANETS[id]
    if (!planet || planet === this.planet) return
    this.planet = planet
    this.sky.setPlanet(planet)
    this._buildTerrain()
  }

  onSettingsChanged(changed, scope) {
    if (changed.has('planet')) this.setPlanet(this.settings.get('planet'))
    else if (scope.world) this._buildTerrain()

    this.sky.onSettingsChanged(changed)
    this.astronauts.onSettingsChanged(changed)
    this.particles.onSettingsChanged(changed)
    this.deliveries.onSettingsChanged(changed)
    this.traffic.onSettingsChanged(changed)
    if (changed.has('showLabels')) this._syncLabels()
    if (changed.has('timeOfDay')) this.sky.setTime(this.settings.get('timeOfDay'))
  }

  // ── roster ──────────────────────────────────────────────────────────────────────────

  /**
   * Take a fresh scan and reshape the colony around it. Everything here is keyed by stable
   * ids — repo name for plots, session id for buildings — so a poll that changes nothing
   * moves nothing on screen.
   */
  setThreads(threads, archivedIds = new Set(), hiddenProjects = new Set(), knownIds = new Set()) {
    const now = Date.now()
    // Lay the districts out at whatever spacing the config asks for, read fresh each pass. When it
    // changes, wipe the remembered layout so the districts actually re-seed at the new ring —
    // otherwise the drift guard holds them where they were and the slider looks dead.
    const spacing = this.settings.get('colonySpacing')
    setColonySpacing(spacing)
    if (spacing !== this._lastSpacing) {
      this._lastSpacing = spacing
      this.plotCells.clear()
    }
    const live = liveThreadsForColony(threads, archivedIds, hiddenProjects)

    // Group by repo, biggest project first so the busiest work lands nearest the middle.
    const byProject = new Map()
    // Which visiting colony a project belongs to, if any — read off the guest threads, whose
    // project name the server already prefixed with the colony's. A home repo has no entry.
    const projectColony = new Map()
    for (const thread of live) {
      const key = thread.project || 'unknown'
      if (!byProject.has(key)) byProject.set(key, [])
      byProject.get(key).push(thread)
      if (thread.colony && !projectColony.has(key)) {
        projectColony.set(key, { colony: thread.colony, online: thread.colonyOnline !== false })
      }
    }
    this.projectColony = projectColony
    /**
     * Repos where nothing has stirred in days, folded away on request.
     *
     * A colony is a map you learn, and a map is only learnable if what is on it is worth
     * looking at. Someone with a hundred checkouts has most of the ground given over to work
     * they finished in the spring, and the six repos they are actually living in are somewhere
     * in among it. Dormant is already a status the colony understands — nothing for three days
     * — so this is that same line drawn one level up, at the repo rather than the thread.
     *
     * Deliberately all-or-nothing per repo: a zone with one live thread in it stays whole,
     * because half a zone would misrepresent the repo rather than tidy the map.
     */
    const dormant = new Set()
    if (this.settings.get('hideDormant')) {
      for (const [name, list] of byProject) {
        if (list.every((t) => statusFor(t, now) === 'sleeping')) dormant.add(name)
      }
      // Never fold away everything: a colony that answers a poll with an empty planet reads as
      // broken rather than tidy, and there is nothing on screen to tell you which it was.
      if (dormant.size === byProject.size) dormant.clear()
      for (const name of dormant) byProject.delete(name)
    }
    this.dormantProjects = dormant

    const projects = [...byProject.entries()].sort((a, b) => {
      if (b[1].length !== a[1].length) return b[1].length - a[1].length
      return a[0].localeCompare(b[0])
    })

    this._syncPlots(projects)

    // A repo that is off the map keeps its footprint in layout memory, so showing it again
    // reclaims the same ground if it is still free. Re-inserting the entry also keeps
    // LAYOUT_MEMORY from evicting a name you only hid — otherwise a zone folded away for a
    // week loses where it used to be, and comes back somewhere else entirely.
    for (const name of [...hiddenProjects, ...dormant]) {
      const cells = this.plotCells.get(name)
      if (!cells) continue
      this.plotCells.delete(name)
      this.plotCells.set(name, cells)
    }

    const roster = []
    const seenBuildings = new Set()
    const stats = { agents: 0, projects: projects.length }
    for (const key of STATUS_ORDER) stats[key] = 0
    // Plots holding anything that wants your attention get a pulsing rim, so you can spot
    // the repo that needs you from right across the colony without reading a single label.
    const urgent = new Set()
    // Plots with anyone working, waiting or stuck keep their name on screen; quiet ones
    // only show it on hover.
    const active = new Set()

    for (const [name, list] of projects) {
      const plot = this.plots.get(name)
      if (!plot) continue
      // Oldest thread first, so a given session keeps its slot as siblings come and go.
      list.sort((a, b) => a.createdAt - b.createdAt)

      list.forEach((thread, i) => {
        const status = statusFor(thread, now)
        if (stats[status] !== undefined) stats[status]++
        if (status === 'waiting' || status === 'blocked') urgent.add(plot.id)
        if (status === 'waiting' || status === 'blocked' || status === 'working') active.add(plot.id)
        stats.agents++

        const building = this._syncBuilding(thread, plot, i)
        seenBuildings.add(thread.id)

        roster.push({
          id: thread.id,
          thread,
          status,
          site: this._workSite(plot, building, i),
          // Where the work actually is. A working astronaut circles it rather than standing
          // at one spot, so it needs the building, not just a place to stand near it.
          anchor: building.mesh.position.clone(),
          // Already on the colony's books, so it does not need an entrance.
          known: knownIds.has(thread.id),
        })
      })
    }

    // Anything that dropped out of the scan — archived, or a transcript that vanished —
    // takes its building down and walks its astronaut back to the ship.
    for (const [id, entry] of this.buildings) {
      if (!seenBuildings.has(id)) this._removeBuilding(id, entry)
    }

    this.threads = new Map(live.map((t) => [t.id, t]))
    this.urgentPlots = urgent
    this.activePlots = active
    this._rebuildNavigation()
    this.stats = { ...stats, done: stats.celebrating }
    this.astronauts.setRoster(roster, this._world())
    return this.stats
  }

  _syncPlots(projects) {
    // The previous layout is an input, so a zone only moves when its own footprint changes
    // — never because a different repo gained or lost a thread. `plotCells` carries it
    // between polls, and the colony file carries it between sessions.
    const colonyOf = this.projectColony || new Map()
    // The visiting colonies, in a stable order, so each gets an even slot around the ring and
    // they surround the centre rather than clumping where their names hash.
    const visitingColonies = [...new Set([...colonyOf.values()].map((v) => v.colony).filter(Boolean))].sort()
    const colonyIndex = new Map(visitingColonies.map((c, i) => [c, i]))
    const projectList = projects.map(([name, list]) => {
      const visiting = colonyOf.get(name)
      // A visiting colony's repos anchor to that colony's district out past the home zones,
      // so they cluster together and read as somebody else's settlement.
      return {
        id: name,
        size: list.length,
        anchor: visiting
          ? colonyAnchor(visiting.colony, colonyIndex.get(visiting.colony), visitingColonies.length)
          : null,
      }
    })
    this.streets = planStreets()
    // A route cached before the ring moved would drive the old road. Stamping the plan and
    // comparing it is cheaper than diffing two cell sets on every house on every frame.
    this._streetStamp = [...this.streets.all].sort().join('|')
    // Streets are rebuilt whole rather than diffed. The plan only changes when the layout
    // does, which is a poll-rate event, and a whole street network is two draw calls.
    this.roadGroup?.userData.dispose?.()
    if (this.roadGroup) this.worldGroup.remove(this.roadGroup)
    // The depot leans toward whichever street runs beside it, and that street lays an apron out
    // to their shared edge. Its own cell can never carry a carriageway — it is a
    // `PROTECTED_CELL`, because that would be tarmac under a building — so this is as close to
    // the road as a depot gets: it fronts the street instead of standing in the middle of its
    // own field, and a delivery pulls out of the yard on to tarmac rather than on to grass.
    const approach = depotApproach(SHIP_CELL_FOR_STREETS, this.streets.all)
    this._shipAnchor.copy(shipPosition())
    if (approach) {
      this._shipAnchor.x += approach.x * DEPOT_ROAD_SHIFT
      this._shipAnchor.z += approach.z * DEPOT_ROAD_SHIFT
    }
    this.ship.group.position.x = this._shipAnchor.x
    this.ship.group.position.z = this._shipAnchor.z
    this.ship.group.position.y = terrainHeight(this._shipAnchor.x, this._shipAnchor.z, this.planet)

    this.roadGroup = createRoads({
      streets: this.streets,
      groundAt: (x, z) => this.groundAt(x, z),
      apron: new Set([key(SHIP_CELL_FOR_STREETS.x, SHIP_CELL_FOR_STREETS.z)]),
    })
    this.worldGroup.add(this.roadGroup)
    // Cars standing at the kerb. Rebuilt only when the streets are — they are scenery, and
    // `parkedCars` is deterministic in each tile's own position, so claiming a plot on the
    // far side of the colony does not reshuffle a street here. `y` is sampled once, for the
    // same reason the road tiles sample it: the ground under a street rolls between plots.
    const carriageway = this.roadGroup.userData.carriageway ?? []
    this._parkedCars = parkedCars(carriageway, PARKING_LANE_OFFSET, PARKED_SEED).map((car) => ({
      ...car,
      y: this._carY(car.x, car.z),
    }))

    // Bicycles in the spaces the cars did not take — the same hash on the same kerbside
    // spaces, so the two partition them rather than being laid out independently and
    // overlapping. One merged mesh rather than an instanced fleet: a bicycle never moves.
    this.bikeGroup?.userData.dispose?.()
    if (this.bikeGroup) this.worldGroup.remove(this.bikeGroup)
    this.bikeGroup = createBicycles({
      bikes: parkedBikes(carriageway, PARKING_LANE_OFFSET, PARKED_SEED),
      groundAt: (x, z) => this.groundAt(x, z),
    })
    this.worldGroup.add(this.bikeGroup)

    const layout = allocateCells(projectList, this.plotCells, this.streets.all)

    // Every cell the colony itself occupies: every plot's cells, plus the depot's own —
    // `townPlan` skips these so a town building never lands on ground the colony already
    // claims. Built from `layout`, not `this.plotCells`, so a zone that just vanished frees
    // its block on the same poll rather than a tick later.
    const claimed = new Set([key(SHIP_CELL_FOR_STREETS.x, SHIP_CELL_FOR_STREETS.z)])
    for (const cells of layout.values()) {
      for (const cell of cells) claimed.add(key(cell.x, cell.z))
    }
    // Scatter's own rebuild (`_buildScatter`, triggered below by a footprint change) runs
    // later in this same poll and wants the same claimed set the town was just built from.
    this._claimedCells = claimed
    // The town is a pure function of the street plan, the claimed cells, and `groundAt` — and
    // `groundAt` resolves to `terrainHeight(x, z, this.planet)` for every cell the town ever
    // queries, so the planet counts as an input too. A poll that moved none of the three
    // leaves the town identical — rebuilding it anyway is ~150k+ vertices of merge-and-dispose
    // churn for no visible change. `_streetStamp` already stamps the street plan for exactly
    // this purpose; `townStamp()` folds `claimed` and `this.planet.id` in alongside it, so a
    // planet switch (the UI's picker, or the HUD's Tab shortcut) is not missed the way it was
    // before this stamp covered it — see `src/world/town-mesh.js`.
    const claimedStamp = [...claimed].sort().join('|')
    const stamp = townStamp(this._streetStamp, claimedStamp, this.planet.id)
    if (stamp !== this._townStamp) {
      this.townGroup?.userData.dispose?.()
      if (this.townGroup) this.worldGroup.remove(this.townGroup)
      this.townGroup = createTown({ streets: this.streets.all, claimed, groundAt: (x, z) => this.groundAt(x, z) })
      this.worldGroup.add(this.townGroup)
      this._townStamp = stamp
    }

    // Everything the forest kit plants in the town: the trees lining the streets, which come
    // out of `cellFurniture` like the lamps do — that is what makes a terrace leave room for
    // one — and the parks, whose sites `greenBlocks` has named since the planting fix without
    // anything ever planting them, leaving almost a fifth of the town's blocks as bare grass.
    // One mesh for both, because both are forest-kit parts and neither ever moves.
    //
    // Built here rather than beside the road group, and the ordering matters: a park may not
    // be planted on ground the colony has claimed, and `claimed` is not known until
    // `allocateCells` has run above. Planting from the previous poll's set would put a tree on
    // a plot the frame it was taken.
    this.treeGroup?.userData.dispose?.()
    if (this.treeGroup) this.worldGroup.remove(this.treeGroup)
    // A park is a path with planting arranged around it, so both halves come out of one layout
    // — `parkItems` — and are then split by kit: the slabs, benches and bin are city-kit, the
    // trees, bushes and grass are forest-kit, and the two packs cannot share a mesh.
    const parks = parkItems(greenBlocks({ streets: this.streets.all, claimed }), this.streets.all)

    this.treeGroup = createStreetTrees({
      furniture: [...(this.roadGroup.userData.verge ?? []), ...parks],
      groundAt: (x, z) => this.groundAt(x, z),
    })
    this.worldGroup.add(this.treeGroup)

    this.parkGroup?.userData.dispose?.()
    if (this.parkGroup) this.worldGroup.remove(this.parkGroup)
    this.parkGroup = createParkFurniture({ items: parks, groundAt: (x, z) => this.groundAt(x, z) })
    this.worldGroup.add(this.parkGroup)

    // Remembered, not replaced: a project that has just lost its last thread keeps its
    // ground on the books, and the oldest entries fall off the end.
    for (const [name, cells] of layout) {
      this.plotCells.delete(name)
      this.plotCells.set(name, cells)
    }
    while (this.plotCells.size > LAYOUT_MEMORY) this.plotCells.delete(this.plotCells.keys().next().value)

    const wanted = new Map()
    for (const [name, cells] of layout) wanted.set(name, `${name}:${cells.map((c) => `${c.x},${c.z}`).join('/')}`)

    // A plot is rebuilt whenever its own footprint moved, and left completely alone
    // whenever it did not.
    for (const [name, plot] of this.plots) {
      if (wanted.get(name) === plot.signature) continue
      this.plotGroup.remove(plot.group)
      if (plot.label) {
        this.labelGroup.remove(plot.label)
        plot.label.userData.dispose?.()
      }
      this.usedAccents.delete(plot.accent)
      plot.dispose()
      this.plots.delete(name)
    }

    projects.forEach(([name], index) => {
      if (this.plots.has(name)) return
      const cells = layout.get(name)
      if (!cells?.length) return
      const visiting = colonyOf.get(name)
      const accent = this._pickAccent(name)
      // Sit the slab on the terrain under its root cell. Near the ship that is ~0; a visiting
      // district anchored far out lands on whatever the ground does there, instead of floating.
      const root = cellWorld(cells[0].x, cells[0].z)
      const groundY = terrainHeight(root.x, root.z, this.planet)
      const plot = new Plot({ id: name, name, index, cells, accent, groundY })
      plot.signature = wanted.get(name)
      // A visiting colony's plot carries its colony so the district can be banner-labelled and
      // dimmed together, and so a click knows the repo is read-only.
      plot.colony = visiting ? visiting.colony : ''
      this.plots.set(name, plot)
      this.plotGroup.add(plot.group)

      // Guest plots drop the colony prefix from their own plate — the district banner carries
      // the colony name, so the plate need only say which repo.
      const labelText = visiting ? name.replace(`${visiting.colony} · `, '') : name
      const label = createLabel(labelText, accent)
      label.position.set(plot.labelAnchor.x, plot.groundY + 3.2, plot.labelAnchor.z)
      plot.label = label
      this.labelGroup.add(label)
    })

    // Keep the online/offline flag current on plots that already existed — a colony going
    // offline must dim its district without rebuilding every plot in it.
    for (const [name, plot] of this.plots) {
      if (!plot.colony) continue
      plot.colonyOnline = colonyOf.get(name)?.online !== false
    }

    this.plotOrder = [...this.plots.values()]
    this._syncColonyBanners()
    // Zones that just moved, appeared or grew are zones the scatter does not know about.
    if (this.scatterGroup && (this._plotFootprint() !== this._scatterFootprint || (this.streets && !this._scatterHadStreets)))
      this._buildScatter()
    // Which cells are decked. Ground height is asked for once per moving agent per
    // frame, so it wants to be a lookup rather than a scan over every plot's every tile.
    // Cell → the deck's top height there, so the crew stands on a sunk district's deck rather
    // than at a flat 0.45. Near the ship groundY is ~0, so this is the old DECK_TOP everywhere
    // that mattered before districts existed.
    this.deckedCells = new Map()
    for (const plot of this.plotOrder) {
      for (const cell of plot.cells) this.deckedCells.set(`${cell.x},${cell.z}`, plot.groundY + DECK_TOP)
    }
    this._syncLabels()
  }

  /**
   * One banner floating over each visiting colony's cluster of plots. Positioned at the
   * centroid of that colony's zones, so it recentres on its own as the district grows or
   * shrinks, and rebuilt only when the set of colonies on the map changes.
   */
  _syncColonyBanners() {
    const groups = new Map()
    for (const plot of this.plotOrder) {
      if (!plot.colony) continue
      if (!groups.has(plot.colony)) groups.set(plot.colony, [])
      groups.get(plot.colony).push(plot)
    }
    // Retire banners for colonies that have left the map entirely.
    for (const [name, banner] of this.colonyBanners) {
      if (groups.has(name)) continue
      this.labelGroup.remove(banner)
      banner.userData.dispose?.()
      this.colonyBanners.delete(name)
    }
    for (const [name, plots] of groups) {
      let banner = this.colonyBanners.get(name)
      if (!banner) {
        // Accent taken from the district's first plot, so the banner glyph matches its zones.
        banner = createBanner(name, plots[0].accent)
        this.colonyBanners.set(name, banner)
        this.labelGroup.add(banner)
      }
      let cx = 0
      let cz = 0
      let cy = 0
      for (const plot of plots) {
        cx += plot.middle.x
        cz += plot.middle.z
        cy += plot.groundY
      }
      banner.position.set(cx / plots.length, cy / plots.length + 5.0, cz / plots.length)
      banner.userData.online = plots.every((p) => p.colonyOnline !== false)
    }
  }

  /**
   * How high the ground is at a world point — the surface anything walking stands on.
   *
   * A plot's tiles are a raised slab, so on one of those it is the deck; everywhere else it
   * is the terrain, sampled from the same noise field the mesh was built from. Without this
   * the crew walks along y=0 while the ground around them runs from -0.35 to +0.20, and they
   * spend half the colony buried to the shins.
   */
  /** The bits of the world the crew needs to know about, as plain callbacks. */
  _world() {
    return {
      shipDoor: () => this.ship.shipDoor(),
      groundAt: (x, z) => this.groundAt(x, z),
    }
  }

  groundAt(x, z) {
    const cell = worldToCell(x, z)
    const deck = this.deckedCells?.get(`${cell.x},${cell.z}`)
    if (deck !== undefined) return deck
    return terrainHeight(x, z, this.planet)
  }

  /** A stable colour per repo, probing forward on a collision so no two plots match. */
  _pickAccent(name) {
    const start = hashString(name) % PLOT_PALETTE.length
    for (let i = 0; i < PLOT_PALETTE.length; i++) {
      const accent = PLOT_PALETTE[(start + i) % PLOT_PALETTE.length]
      if (!this.usedAccents.has(accent)) {
        this.usedAccents.add(accent)
        return accent
      }
    }
    return PLOT_PALETTE[start]
  }

  _syncBuilding(thread, plot, index) {
    let entry = this.buildings.get(thread.id)
    // Furniture count tracks transcript size, on the same log scale as the thread card's bar.
    // This is not the sink the comment above `transcriptProgress` warns off: that objection is
    // about a closed solid cut off by a flat plane, which reads as a rendering fault. A house
    // with some of its furniture missing reads as a house still being moved into — which is
    // the truth, not a glitch — so mapping progress here does not reintroduce the bug upstream
    // removed.
    const target = transcriptProgress(thread)

    if (!entry) {
      const mesh = createHouse({ seed: hashString(thread.id), accent: plot.accent })
      const pos = plot.worldSlot(index)
      mesh.position.copy(pos)
      mesh.rotation.y = ((hashString(thread.id) >>> 8) % 360) * (Math.PI / 180)
      // New buildings rise from nothing rather than appearing whole.
      mesh.userData.setProgress(0)
      this.worldGroup.add(mesh)
      // `driven` is how far along its route this thread's delivery car has got — 0 being
      // sitting at the depot. It belongs next to `progress` for the same reason: it is the
      // one number the car's whole arrival is made of. See `_updateDeliveries`.
      entry = { mesh, plot: plot.id, slot: index, progress: 0, target, retiring: false, driven: 0 }
      this.buildings.set(thread.id, entry)
    } else {
      // Where this building belongs *now*. Comparing the world position rather than the
      // plot id and slot number is what catches a zone that was rebuilt underneath it: the
      // repo is the same and the slot is the same, but the ground moved, and a habitat left
      // behind on bare terrain takes its astronaut off the plot with it.
      const want = plot.worldSlot(index, this._slotAt || (this._slotAt = new THREE.Vector3()))
      if (entry.plot !== plot.id || entry.slot !== index || entry.mesh.position.distanceToSquared(want) > 1e-4) {
        entry.plot = plot.id
        entry.slot = index
        entry.mesh.position.copy(want)
      }
    }

    entry.target = target
    entry.accent = plot.accent
    entry.retiring = false
    return entry
  }

  /**
   * Wind a thread's site down, and take it off the books once nothing of it is left in the
   * street.
   *
   * Called every frame while an entry is retiring rather than once when it starts: the hold
   * below has to be re-decided as the car makes its way home, and the removal has to be
   * re-tried on the frame it arrives.
   *
   * There are two ways a wait like this goes wrong, and both are guarded here.
   *
   *  - **The car vanishes mid-street.** Removing the entry disposes the house *and* the only
   *    record of how far its car had got, so a car still on the road simply stops being drawn
   *    from one frame to the next. Hence the wait for `driven` to be back at the depot.
   *  - **The entry never leaves.** A wait is only safe if the thing waited on is certain to
   *    arrive, and this is the one failure no test on screen would ever show: a leaked entry
   *    is an invisible house that keeps its slot, its accent and its route forever. Three
   *    things make arrival certain. `driveStep` lands `driven` exactly on its target rather
   *    than approaching it (drive-path.js); `stepProgress` does the same for the reveal
   *    (growth.js — that module exists because a damped value that only ever approached its
   *    target cost every house its last piece of furniture); and `_updateDeliveries` forces a
   *    retiring entry's target to 0, so the car cannot be sent back out by a thread that
   *    still claims to be active.
   */
  _removeBuilding(id, entry) {
    entry.retiring = true
    // A house that vanishes mid-frame reads as a glitch; one that empties out reads as being
    // packed up. So the reveal winds down — but only as far as `RETIRE_HOLD`, an emptied
    // house still standing at its address, for as long as its car is out.
    const home = entry.driven <= 0
    entry.target = home ? 0 : RETIRE_HOLD
    if (!home || entry.progress > RETIRED_PROGRESS) return

    this.worldGroup.remove(entry.mesh)
    // A house is a Group of meshes, and only it knows how many. Reaching in for a Mesh's
    // geometry and material — which is what this used to do — throws on a Group.
    entry.mesh.userData.dispose()
    this.buildings.delete(id)
  }

  /**
   * Hand the navigation grid the colony's current footprint.
   *
   * The blocking radius is the building's bounding radius trimmed a little, plus the
   * astronaut's own width. The trim matters: the bounding radius already over-covers
   * anything that is not round, and blocking the full extent closes the gaps between a ring
   * of buildings, which is exactly where the crew needs to walk.
   */
  _rebuildNavigation() {
    const obstacles = []
    for (const entry of this.buildings.values()) {
      if (entry.retiring) continue
      const p = entry.mesh.position
      const r = (entry.mesh.userData.footprint || 1.2) * 0.8 + AGENT_RADIUS
      obstacles.push({ x: p.x, z: p.z, r })
    }
    // Ground clutter counts too. A crate is only knee-high, but an astronaut walking
    // straight through one is exactly as wrong as one walking through a habitat.
    for (const plot of this.plotOrder) {
      for (const spot of plot.clutterSpots || []) {
        obstacles.push({ x: plot.center.x + spot.x, z: plot.center.z + spot.z, r: spot.r + AGENT_RADIUS })
      }
    }
    // Ground scatter counts as well. A boulder an astronaut can walk through is the same
    // bug as a habitat it can walk through, and a sleeping one parked inside a solar panel
    // is what that bug looks like from the outside. Instances are read straight off the
    // matrices, so this costs no bookkeeping of its own.
    const mat = this._navMatrix || (this._navMatrix = new THREE.Matrix4())
    for (const mesh of this.scatterGroup?.children || []) {
      if (!mesh.isInstancedMesh || !mesh.count) continue
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox()
      const box = mesh.geometry.boundingBox
      const spread = Math.max(box.max.x - box.min.x, box.max.z - box.min.z) * 0.5
      for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, mat)
        const scale = Math.hypot(mat.elements[0], mat.elements[1], mat.elements[2])
        const r = spread * scale * 0.65
        // Only what an astronaut would visibly stand *inside*. Blocking every pebble and
        // sprig fences the corridors between zones — the crew walks the gaps between plots
        // to get anywhere, and scatter is placed in exactly those gaps.
        if (r < 0.55) continue
        obstacles.push({ x: mat.elements[12], z: mat.elements[14], r: r + AGENT_RADIUS })
      }
    }

    const ship = this._shipAnchor
    obstacles.push({ x: ship.x, z: ship.z, r: 3.4 + AGENT_RADIUS })
    this.nav.rebuild(obstacles)
  }

  /**
   * The plot under a world point.
   *
   * Not a radius around the nearest cell centre: a square lattice's cells are squares, not
   * circles, so a circular threshold either clips the corners (too small) or reaches past the
   * cell's own edges into its neighbour's (too large) — the old hex-era radius did neither,
   * because 7.6 was that hexagon's own circumradius, but it is meaningless on this lattice's
   * 12-unit cells. `worldToCell` already answers "which cell is this point in" the same way
   * the deck itself is laid out — round each axis to its nearest centre — so a point is on a
   * plot exactly when that cell belongs to it, corners included and with no slop either way.
   */
  plotAt(x, z) {
    const cell = worldToCell(x, z)
    const k = key(cell.x, cell.z)
    for (const plot of this.plotOrder) {
      if (plot.cellKeys.has(k)) return plot
    }
    return null
  }

  /**
   * The plot whose name plate is under the cursor.
   *
   * Plates are billboarded in the vertex shader — a CPU raycast against the quad would test
   * the geometry as authored, which is not where it ends up on screen. So this repeats the
   * shader's own maths instead: the plate sits at its anchor in view space and spans
   * `half * (0.55 + dist * 0.03)`, which projects to `half * k * P / dist` in NDC.
   *
   * Opacity is deliberately not consulted. A quiet project's plate is invisible until it is
   * pointed at, and it is this hit test that decides it is being pointed at.
   */
  pickLabel(ndcX, ndcY) {
    const view = this._labelView || (this._labelView = new THREE.Vector3())
    const p = this.camera.projectionMatrix.elements
    let best = null
    let bestDist = Infinity
    for (const plot of this.plotOrder) {
      const label = plot.label
      if (!label) continue
      const dist = -view.copy(label.position).applyMatrix4(this.camera.matrixWorldInverse).z
      if (dist <= 0.01 || dist >= bestDist) continue
      const geo = label.geometry.parameters
      const k = 0.55 + dist * 0.03
      const cx = (view.x * p[0]) / dist
      const cy = (view.y * p[5]) / dist
      if (Math.abs(ndcX - cx) > ((geo.width / 2) * k * p[0]) / dist) continue
      if (Math.abs(ndcY - cy) > ((geo.height / 2) * k * p[5]) / dist) continue
      bestDist = dist
      best = plot
    }
    return best
  }

  /**
   * Take the zone layout out of the colony file. Cells arrive as `[x, z]` pairs from a file
   * a person can edit, so anything that is not a pair of whole numbers is dropped rather
   * than trusted — a bad entry would put a zone on a cell that does not exist.
   *
   * Cells remembered before the lattice was squared are read as square coordinates. They are
   * valid small integers, so nothing errors -- every plot simply lands somewhere new once and
   * is sticky from then on.
   *
   * It cannot be done more cleanly. `data/colony.json` carries a version, but the gate that
   * reads it is `server/api.mjs:37`, and `server/` is a colleague's file this branch does not
   * touch. So there is no way to announce the change through the file.
   *
   * This is the one-time rearrangement the whole stickiness machinery exists to prevent,
   * happening deliberately. Without this note a reader who finds it later will think it is the
   * bug rather than the migration.
   */
  restoreLayout(saved) {
    const clean = new Map()
    for (const [name, cells] of Object.entries(saved || {})) {
      if (!Array.isArray(cells)) continue
      const list = []
      for (const cell of cells) {
        const x = Array.isArray(cell) ? cell[0] : cell?.x
        const z = Array.isArray(cell) ? cell[1] : cell?.z
        if (Number.isInteger(x) && Number.isInteger(z)) list.push({ x, z })
      }
      if (list.length) clean.set(String(name), list)
    }
    this.plotCells = clean
  }

  /** The same, on the way out. */
  layoutForSave() {
    const out = {}
    for (const [name, cells] of this.plotCells) out[name] = cells.map((c) => [c.x, c.z])
    return out
  }

  /**
   * Centre + radius the hub frames the map by. Centred on the ORIGIN — the Hub's own colony
   * sits there, so it stays the middle of the wall with the visiting colonies around it — and
   * the radius reaches the farthest plot so everything stays in view.
   */
  contentBounds() {
    if (!this.plotOrder.length) return null
    let maxR = 0
    for (const plot of this.plotOrder) {
      const c = plot.middle || plot.center
      if (!c) continue
      maxR = Math.max(maxR, Math.hypot(c.x, c.z))
    }
    return { center: new THREE.Vector3(0, 0, 0), radius: maxR + 10 }
  }

  setHoveredPlot(plot) {
    this.hoveredPlot = plot || null
  }

  /**
   * Names fade in for the plots that have something going on, and for whichever one you are
   * pointing at. Everywhere else the colony stays unlabelled.
   */
  _updateLabels(dt) {
    const show = this.uiVisible && this.settings.get('showLabels')
    for (const plot of this.plotOrder) {
      const label = plot.label
      if (!label) continue
      const wanted = show && (this.activePlots.has(plot.id) || this.hoveredPlot === plot) ? 1 : 0
      const next = THREE.MathUtils.damp(label.material.opacity, wanted, 9, dt)
      label.material.opacity = next
      label.visible = next > 0.01
    }
    // District banners stay up whenever their colony is on the map — they are the sign you
    // read to know whose settlement you are looking at. An offline colony's banner dims
    // rather than vanishing, so a sleeping machine reads as "away", not "gone".
    for (const banner of this.colonyBanners.values()) {
      const wanted = this.uiVisible ? (banner.userData.online ? 1 : 0.4) : 0
      const next = THREE.MathUtils.damp(banner.material.opacity, wanted, 9, dt)
      banner.material.opacity = next
      banner.visible = next > 0.01
    }
  }

  /** Where the astronaut stands: just outside its building, facing in. */
  _workSite(plot, entry, index) {
    const b = entry.mesh.position
    // Outward from the *middle* of the zone rather than from its root tile: the root sits
    // on one edge of a grown blob, and standing spots measured from there all point the
    // same way instead of fanning around the buildings.
    const middle = plot.middle || plot.center
    const dx = b.x - middle.x
    const dz = b.z - middle.z
    const len = Math.hypot(dx, dz)
    // Buildings in the middle of a plot have no outward direction, so fan those out by index.
    const a = len > 0.2 ? Math.atan2(dz, dx) : (index * 2.4) % (Math.PI * 2)
    // Clear of the building's *own* footprint rather than a fixed 2.35: a big habitat blocks
    // more ground than a small one, and a standing spot inside that radius is a spot the
    // crew can never actually reach — it walks at the wall for as long as the thread lives.
    const blocked = (entry.mesh.userData.footprint || 1.2) * 0.8 + AGENT_RADIUS
    const stand = Math.max(2.35, blocked + 0.5)
    let site = new THREE.Vector3(b.x + Math.cos(a) * stand, 0, b.z + Math.sin(a) * stand)
    // Outward points straight off the zone for a building on its edge, and an astronaut
    // standing in the neighbouring repo's yard reads as belonging to that repo. The inside
    // of its own plot is always the better answer when the outside is somebody else's.
    const onPlot = (v) => {
      const cell = worldToCell(v.x, v.z)
      return plot.cellKeys.has(`${cell.x},${cell.z}`)
    }
    if (!onPlot(site)) {
      const inward = new THREE.Vector3(b.x - Math.cos(a) * stand, 0, b.z - Math.sin(a) * stand)
      if (onPlot(inward)) site = inward
    }
    // The grid is the one built for the last roster, so this is a best effort — but sites
    // are recomputed every poll, and anything walled in by a neighbour is nudged out to the
    // nearest ground somebody can stand on rather than left as a trap.
    if (this.nav?.isBlocked(site.x, site.z)) {
      const free = this.nav.nearestFree(site.x, site.z)
      if (free) site.set(this.nav.toWorld(free.ix), 0, this.nav.toWorld(free.iz))
    }
    return site
  }

  // ── per-frame ───────────────────────────────────────────────────────────────────────

  update(dt, elapsed, focus) {
    if (focus) this.sky.setFocus(focus)
    const cycled = this.sky.update(dt, elapsed, this.camera)
    if (cycled) this.settings.values.timeOfDay = this.sky.time

    const night = this.sky.nightFactor ?? 0
    buildingUniforms.uNight.value = night
    // One write turns every rotor in the colony.
    buildingUniforms.uTime.value = elapsed
    this.ship.update(dt, elapsed, night)

    this._growBuildings(dt)
    // Ahead of the crew and the badges on purpose. This is what decides who is riding in a
    // car this frame, and both of those pack their instances from that flag — run it after
    // them and every crew member would be drawn one frame behind its own car.
    this._updateDeliveries(dt)
    this._updateTraffic(dt)
    this.astronauts.update(dt, elapsed)
    this.astronauts.updateRings(elapsed)
    this.indicators.update(this.astronauts.agents, elapsed, (a) => this._badgeFor(a))
    this._emit(dt, elapsed)
    this.particles.ambient(dt, this.camera, this.planet)
    this.particles.update(dt)
    this._updatePlots(night, elapsed)
    this._updateLabels(dt)
  }

  _growBuildings(dt) {
    for (const [id, entry] of this.buildings) {
      // A running thread's site creeps upward while you watch it.
      if (!entry.retiring && this._isLive(id)) entry.target = Math.min(1, entry.target + LIVE_GROWTH * dt)
      // `stepProgress` damps toward the target and lands on it, rather than freezing the
      // last 1.7% short the way a bare damp-plus-epsilon-gate does. See src/game/growth.js:
      // the furniture reveal reads progress against thresholds at exactly 0.05 and exactly 1,
      // so arriving has to mean arriving. It returns the value unchanged when there is
      // nothing to do, which is what keeps a settled building from writing its uniform.
      const next = stepProgress(entry.progress, entry.target, dt)
      if (next !== entry.progress) {
        entry.progress = next
        entry.mesh.userData.setProgress(next)
      }
      // Every frame while retiring, not only once the house has emptied out: the wait for
      // the car is decided inside `_removeBuilding`, and it has to be re-decided as the car
      // moves. Gating this call on the progress threshold instead would deadlock — the hold
      // keeps progress above that threshold for exactly as long as the car is out.
      if (entry.retiring) this._removeBuilding(id, entry)
    }
  }

  _isLive(id) {
    const thread = this.threads.get(id)
    return Boolean(thread && thread.running)
  }

  /** A site somebody is standing at: running, or stopped waiting on you. */
  _isActive(id) {
    const thread = this.threads.get(id)
    return Boolean(thread && (thread.running || thread.unread || thread.hasError))
  }

  /** How many buildings currently have somebody standing at them, by `_isActive`'s own
   *  reckoning — the same test `_updateDeliveries` uses to decide whether a site gets a
   *  delivery car, so traffic density and delivery presence agree on what "active" means. */
  _activeThreadCount() {
    let n = 0
    for (const id of this.buildings.keys()) {
      if (this._isActive(id)) n++
    }
    return n
  }

  /**
   * The badge a crew member's own state and status earn, with no regard for whether it
   * happens to be drawn this frame.
   *
   * Split out from `_badgeFor` because this is the axis the delivery decides suppression on
   * (see `_markRiding`), and a suppression rule that consulted a badge which had already
   * been zeroed *by* suppression would be circular — it would answer "no badge" for every
   * crew member it had hidden on the previous frame and happily keep hiding it.
   */
  _statusBadgeFor(agent) {
    if (agent.state === 'spawning') return BADGE.spawning
    if (agent.state === 'leaving') return BADGE.leaving
    // Badges only appear once an astronaut has actually reached its post — a stream of
    // symbols bobbing over a walking crowd is noise.
    if (agent.state !== 'at-site') return BADGE.none
    return BADGE_FOR[agent.status] ?? BADGE.none
  }

  _badgeFor(agent) {
    // Riding in its delivery car, so there is no head for a badge to sit over. Left where
    // the other state gates are rather than in the status mapping: what a thread wants has
    // not changed, only whether anyone is on screen to ask.
    //
    // This can only ever zero a badge that was already `none` — `_markRiding` refuses to
    // set the flag on a crew member whose status carries one — so it is a consistency guard
    // between the figure and its badge, not a decision.
    if (agent.riding) return BADGE.none
    return this._statusBadgeFor(agent)
  }

  /** Particle emission, driven by what each astronaut is doing. */
  _emit(dt, elapsed) {
    if (!this.particles.enabled) return
    const full = this.settings.get('particles') === 'full'

    for (const agent of this.astronauts.agents) {
      if (agent.scale < 0.5) continue
      // What this one is standing on, which on a plot is the deck rather than the terrain
      // under it. Everything thrown off an astronaut has to land back on the same surface.
      const ground = agent.groundY || 0

      if (agent.state === 'at-site' && agent.status === 'working') {
        // Sparks on the downbeat of the hammer swing, not every frame.
        const swing = Math.sin(agent.workSwing)
        if (swing < -0.75 && !agent._sparked) {
          agent._sparked = true
          const c = this._c.set(0x9fe8c0)
          this.particles.weld(
            agent.pos.x + Math.sin(agent.yaw) * 0.55,
            agent.pos.y + 0.55,
            agent.pos.z + Math.cos(agent.yaw) * 0.55,
            c,
            ground
          )
        } else if (swing > 0) {
          agent._sparked = false
        }
      }

      if (agent.state === 'at-site' && agent.status === 'celebrating' && agent.hop > 0.18 && !agent._cheered) {
        agent._cheered = true
        this.particles.cheer(agent.pos.x, agent.pos.y, agent.pos.z, this._c.set(0xffc86a), ground)
      } else if (agent.hop < 0.05) {
        agent._cheered = false
      }

      if (agent.state === 'at-site' && agent.status === 'sleeping' && Math.random() < dt * 0.35) {
        this.particles.snooze(agent.pos.x + 0.2, agent.pos.y + 1.05, agent.pos.z + 0.15)
      }

      // Boot dust, on the footfall.
      if (full && (agent.walkAmp || 0) > 0.4) {
        const step = Math.sin(agent.phase)
        if (step < -0.9 && !agent._stepped) {
          agent._stepped = true
          this.particles.step(agent.pos.x, agent.pos.y, agent.pos.z, this._dustTint, ground)
        } else if (step > 0) {
          agent._stepped = false
        }
      }

      // The ramp notices anyone stepping on or off it.
      if (agent.state === 'spawning' || (agent.state === 'leaving' && agent.scale < 0.6)) {
        if (Math.random() < dt * 3) this.ship.ping()
      }
    }
  }

  _updatePlots(night, elapsed) {
    const urgent = this.urgentPlots
    for (const plot of this.plotOrder) plot.setNight(night, urgent?.has(plot.id) ?? false, elapsed)
  }

  /**
   * Drive one delivery car per working thread, from the depot out to its house.
   *
   * This is what replaced the timber. The predicate is the one the scaffolding used —
   * `_isActive`, "somebody is standing at this site right now" — so the promise the README
   * makes is unchanged; only the thing that keeps it moved from poles going up around a
   * house to a car pulling up outside it.
   *
   * There is deliberately no "parked" flag and no seventh agent state. A thread that is
   * neither arriving nor leaving has simply run out of road: `driven` sits at the end of its
   * route, `pointAt` clamps there, and the car stands at the kerb for as long as the thread
   * keeps working. Arriving and leaving are the same one number moving in opposite directions.
   */
  _updateDeliveries(dt) {
    // Cleared for everyone first, the way the badges are: a crew member whose entry stops
    // being visited this frame has to get its feet back, or a house that dips under the
    // ground-broken threshold mid-drive leaves an astronaut invisible — and unclickable —
    // for good.
    for (const agent of this.astronauts.agents) agent.riding = false

    const vehicles = []
    for (const [id, entry] of this.buildings) {
      // Nothing to deliver to an address that has not broken ground yet — but a car that is
      // already out gets stepped whatever its house is doing. Skipping it would freeze
      // `driven` where it stands, and a `driven` that never reaches 0 is a retiring entry
      // that never comes off the books (see `_removeBuilding`). A retiring house is held
      // above this threshold for that very reason; this second test is the belt to that
      // brace, and it also keeps a car on the road when a live house dips back under.
      if (entry.progress <= DELIVERY_PROGRESS && entry.driven <= 0) continue

      const route = this._routeFor(entry)
      // A retiring site's car comes home whatever its thread still says. `_isActive` reads
      // `this.threads`, which a building can outlive — a repo folded away as dormant keeps
      // its threads in there — and a retiring entry whose car was still being sent *out*
      // would be waiting on an arrival that never comes.
      const wants = !entry.retiring && this._isActive(id)
      const target = wants ? route.length : 0

      // One number, driven up on the way out and back down on the way home, never past
      // either end of the route.
      entry.driven = driveStep(entry.driven, target, CAR_SPEED * dt)

      // Home again with nowhere to be: no car on the road at all, rather than a heap of
      // them idling on the depot pad for every thread the colony has ever seen.
      if (entry.driven <= 0 && !wants) continue

      // `wants` is also which way this car is going: out to the address, or home again. The
      // lane follows from that, the same as it does for ambient traffic.
      const at = this._sampleLane(route, entry.driven, wants)
      vehicles.push({
        x: at.x,
        // The route is drawn cell to cell, but the ground under it is not flat: plots sit on
        // raised decks and the terrain rolls between them. Sampling the same height the crew
        // walks on is what keeps a car on the surface instead of through a deck.
        y: this._carY(at.x, at.z),
        z: at.z,
        heading: at.heading,
        distance: entry.driven,
        accent: entry.accent,
      })

      // A car between the ends of its route is a car that may be carrying somebody. Which
      // direction it is going is deliberately *not* part of this test — a car drives back
      // out again the moment a quiet thread wants you, and a rule written around the
      // outbound leg would blank that thread's badge for the whole trip. What decides
      // whether anyone is actually aboard is `_markRiding`.
      if (entry.driven > 0 && entry.driven < route.length) this._markRiding(id)
    }
    this.deliveries.update(vehicles)
  }

  /**
   * Ambient traffic: cars nobody owns, driving the same streets a busy colony's deliveries
   * do. The pool is sized off how many threads are active (`trafficCount`, `traffic.js`) and
   * grown or shrunk toward that target; each vehicle steps its own four-state machine
   * (`stepVehicle`) between the depot and a house picked by its own `addressSeed`.
   *
   * Deliberately after `_updateDeliveries` in `update()`, the same way that method is
   * deliberately ahead of the crew: ambient traffic has no rider and nothing downstream
   * depends on its ordering, so there is no similar constraint here — it simply has to run
   * once a frame like everything else.
   */
  _updateTraffic(dt) {
    // How much street there is, not just how busy the colony is — see `trafficCount`.
    const wanted = trafficCount(this._activeThreadCount(), this.streets?.all?.size ?? 0)
    while (this._trafficVehicles.length < wanted) {
      this._trafficVehicles.push(newVehicle(this._trafficSeed++))
    }
    while (this._trafficVehicles.length > wanted) {
      const dropped = this._trafficVehicles.pop()
      // A vehicle dropped from the pool takes its cached route with it, or the cache would
      // grow by one entry for every car the colony has ever shed instead of staying bounded
      // by the pool it currently holds.
      if (dropped._routeKey) this._trafficRoutes.delete(dropped._routeKey)
    }

    // Where each car stands *before* anything moves. Two passes rather than one, so the gap a
    // car keeps is measured against this frame's positions instead of last frame's: with
    // forty cars the extra `pointAt` per car is nothing, and a frame of lag in a following
    // rule is exactly how a queue starts oscillating.
    const routes = []
    const standing = []
    for (const vehicle of this._trafficVehicles) {
      const route = this._trafficRouteFor(vehicle)
      routes.push(route)
      standing.push(this._sampleRoute(route, vehicle))
    }

    const rendered = []
    for (let i = 0; i < this._trafficVehicles.length; i++) {
      const route = routes[i]
      // `standing` holds this car's own entry too; `headwayFactor` skips it by identity.
      const vehicle = stepVehicle(
        this._trafficVehicles[i],
        dt,
        route.length,
        Math.random,
        headwayFactor(standing[i], standing, HEADWAY)
      )
      this._trafficVehicles[i] = vehicle

      const at = this._sampleRoute(route, vehicle)
      rendered.push({
        x: at.x,
        // Sampled the same way `_updateDeliveries` samples it, for the same reason: the
        // route is drawn cell to cell, but the ground under it rolls between plots.
        y: this._carY(at.x, at.z),
        z: at.z,
        heading: at.heading,
        distance: vehicle.driven,
        body: vehicle.body,
        tint: vehicle.tint,
      })
    }
    // Parked cars ride along in the same fleet: same buckets, same instanced meshes, and
    // their fixed `distance` of 0 is what keeps a standing car's wheels from turning.
    for (const car of this._parkedCars) rendered.push(car)

    this.traffic.update(rendered)
  }

  /**
   * The height a car's wheels stand at.
   *
   * On a street cell, the carriageway's own surface; anywhere else, the ground. Cars were
   * placed at `groundAt` everywhere, which is where a road tile's *base* sits rather than the
   * surface a car drives on, so the whole fleet stood 0.084 down inside the asphalt — more
   * than a wheel radius — and read as half-melted into the road.
   *
   * Decided per position rather than per car, because the one car that must *not* be lifted is
   * a delivery at the end of its route: it parks at a house's kerb, off the carriageway, where
   * there is no road surface and the ground is what it stands on.
   */
  _carY(x, z) {
    const ground = this.groundAt(x, z)
    const cell = worldToCell(x, z)
    const surface = this.streets?.all?.has(key(cell.x, cell.z)) ? roadSurfaceY(ground) : ground
    // Plus the drop from the body's own origin to its contact patch. Putting the origin on a
    // surface is not the same as putting the tyres on it, and the difference is most of a
    // wheel — see `CAR_GROUND_DROP` in `deliveries.js`.
    return surface + CAR_GROUND_DROP
  }

  /**
   * Where a car is, on the lane it is actually driving.
   *
   * A round trip is two journeys, and each keeps to its own right, so the way home is its own
   * polyline running the other way (`drivingLanes` in `drive-path.js`). Sampling the outbound
   * line for both is what had every car drive its whole return leg backwards down the wrong
   * side of the road.
   *
   * Progress crosses between them as a **fraction**, not as a distance: offsetting a route
   * right and offsetting it left cut its corners by different amounts, so the two lanes are
   * not the same length and `driven` does not mean the same thing on both. A car turning round
   * does jump across the road once — it is standing still when it happens, which is the
   * cheapest place for a U-turn nobody animated.
   */
  _sampleLane(route, driven, outbound) {
    if (outbound || !route.back) return pointAt(route.points, driven)
    const travelled = route.length > 0 ? driven / route.length : 0
    return pointAt(route.back, (1 - travelled) * route.backLength)
  }

  /** The same, for an ambient vehicle, whose direction of travel is carried by its phase. */
  _sampleRoute(route, vehicle) {
    return this._sampleLane(route, vehicle.driven, vehicle.phase === 'out' || vehicle.phase === 'parked')
  }

  /**
   * The route from the depot to one traffic vehicle's address.
   *
   * Cached in `this._trafficRoutes`, keyed on `addressSeed` plus `this._streetStamp`, for
   * the same reason `_routeFor` caches: a route only changes when its destination or the
   * streets do. `houses` is handed in fresh each frame — the colony's building roster can
   * change under a vehicle mid-journey — but only consulted on a cache miss, so a vehicle's
   * route does not jump to a different house just because one was added or removed.
   *
   * With no house built yet, there is nowhere to send a car: it gets a single-point,
   * zero-length route and sits at the depot rather than throwing on an empty `houses`.
   */
  _trafficRouteFor(vehicle) {
    const streetCells = this.streets?.cells
    const ends = routeEndpoints(vehicle, streetCells?.length ?? 0)
    // Nowhere to drive between: fewer than two street cells, which is where every colony
    // starts and what it falls back to if the plan is ever empty.
    if (!ends) {
      const depot = this._shipAnchor
      const standstill = [{ x: depot.x, z: depot.z }]
      return { points: standstill, back: standstill, length: 0, backLength: 0 }
    }

    // Keyed on both ends, not just the destination: a car's origin is now its own rather than
    // the single cell every car in the colony shared.
    const cacheKey = `${vehicle.originSeed}|${vehicle.addressSeed}|${this._streetStamp}`
    let route = this._trafficRoutes.get(cacheKey)
    if (!route) {
      // Street cell to street cell, and `strict` so it stays there. Both ends being streets was
      // not enough on its own: `OFF_ROAD_COST` makes tarmac a preference, so a shortcut across
      // one cell of grass still beat a seven-cell detour, and half of all ambient routes (20 of
      // 40, measured on the shipping plan) cut a corner across the verge. A delivery may do
      // that — it has to, to reach a house — but a car with no errand driving over a lawn is
      // just a car driving over a lawn.
      const cells = roadCells(streetCells[ends.from], streetCells[ends.to], this.streets.all, {
        strict: true,
      })
      // No street-only route between the two: the car stays where it lives rather than setting
      // off across a field. Needs a disconnected network to happen at all, which this plan does
      // not have, but "drive over the grass" is not the right answer when it does.
      if (!cells) {
        const home = cellWorld(streetCells[ends.from].x, streetCells[ends.from].z)
        const standstill = [{ x: home.x, z: home.z }]
        return { points: standstill, back: standstill, length: 0, backLength: 0 }
      }
      const lanes = drivingLanes(
        cells.map((c) => cellWorld(c.x, c.z)),
        DRIVING_LANE_OFFSET
      )
      // Two lanes, and their lengths are deliberately not assumed equal: offsetting right and
      // offsetting left cut a corner by different amounts. Progress is carried as a fraction
      // of the journey rather than as a distance shared between them — see `_sampleRoute`.
      route = {
        points: lanes.out,
        back: lanes.back,
        length: pathLength(lanes.out),
        backLength: pathLength(lanes.back),
      }
      this._trafficRoutes.set(cacheKey, route)
    }

    // The vehicle has moved on to a different address since the last time this ran — a
    // round trip re-seeds `addressSeed` (see `stepVehicle`'s `'back'` phase in `traffic.js`)
    // — so its previous cache entry is now unreachable by any key this method will look up
    // again for it, and is dropped here rather than left to sit forever.
    if (vehicle._routeKey && vehicle._routeKey !== cacheKey) {
      this._trafficRoutes.delete(vehicle._routeKey)
    }
    vehicle._routeKey = cacheKey
    return route
  }

  /**
   * The route from the depot to one house, built once and kept on the building entry.
   *
   * A route is cheap but not free, and rebuilding one every frame for every thread in a
   * full colony is pure waste — a route only changes when the house it ends at does. Keyed
   * on the plot and slot, plus the house's own position: a zone rebuilt underneath a building
   * keeps its id and its slot but moves the ground, and a route cached on the ids alone would
   * go on driving to where the house used to be.
   */
  _routeFor(entry) {
    const p = entry.mesh.position
    const cached = entry.route
    if (
      cached &&
      cached.plot === entry.plot &&
      cached.slot === entry.slot &&
      cached.x === p.x &&
      cached.z === p.z &&
      cached.streets === this._streetStamp
    ) {
      return cached
    }

    const depot = this._shipAnchor
    const start = worldToCell(depot.x, depot.z)
    const end = worldToCell(p.x, p.z)
    // The cell sequence is the only thing the streets change. Everything below — the kerb
    // pull-back, the cache key, the route object — is stage 2's, verified by hand over 600
    // frames, and is deliberately left alone.
    // Shifted off the centre line into the right-hand lane, once for each direction. A route
    // is built from cell centres and the carriageway is drawn centred on those same cells, so
    // an unshifted route runs straight down the road's own paint, and a single shifted one has
    // the car come home on the wrong side of it — see `drivingLanes` in `drive-path.js`.
    const lanes = drivingLanes(
      roadCells(start, end, this.streets?.all).map((c) => cellWorld(c.x, c.z)),
      DRIVING_LANE_OFFSET
    )
    const points = lanes.out

    // The last cell centre is not the address: parking on it leaves the car a half-cell short
    // of the house it was sent to, or sitting in a neighbour's garden. The house's own centre
    // is not the address either — a house has a footprint of nearly two units and a car
    // driven to the middle of it parks *inside* the building, where it cannot be seen at all.
    //
    // So the route ends at the kerb: the house position, pulled back along the last leg by
    // the building's own radius and a little clearance. That is where a delivery would
    // actually stop, and it is the same radius the scaffolding used to stand its poles on.
    //
    // How far back is `kerbBack` in `drive-path.js` — pure arithmetic, so the rule can be
    // asserted rather than eyeballed against the layout that happens to ship today.
    const kerb = { x: p.x, z: p.z }
    const approach = points[points.length - 2]
    if (approach) {
      const dx = kerb.x - approach.x
      const dz = kerb.z - approach.z
      const d = Math.hypot(dx, dz)
      const back = kerbBack(d, entry.mesh.userData.footprint || 1.4)
      if (back > 0) {
        kerb.x -= (dx / d) * back
        kerb.z -= (dz / d) * back
      }
    }
    points[points.length - 1] = kerb
    // The way home starts from the same kerb the way out ended at, or the car would leave from
    // a point half a cell away from the one it parked on.
    lanes.back[0] = { x: kerb.x, z: kerb.z }

    const route = {
      plot: entry.plot,
      slot: entry.slot,
      x: p.x,
      z: p.z,
      streets: this._streetStamp,
      points,
      back: lanes.back,
      length: pathLength(points),
      backLength: pathLength(lanes.back),
    }
    entry.route = route
    return route
  }

  /**
   * Mark a thread's crew member as riding in its car, if it is one that may be hidden.
   *
   * Not a status and not a behaviour. `STATUS_ORDER` is a strict precedence and a seventh
   * state would compete with the six for the badge — a riding crew member is not doing a new
   * thing, it is just not drawn. The agent keeps its slot in the roster, keeps walking and
   * keeps its status; the packing loop in `astronauts.js` steps over it and `_badgeFor` hands
   * back nothing.
   *
   * **Two rules, both of which have to hold**, and `ridesAlong` in `drive-path.js` is where
   * they are written down and tested — `colony.js` cannot be imported under `node --test`,
   * and a rule whose failure mode is an invisible, unclickable crew member has to be
   * asserted rather than eyeballed. In short:
   *
   *  - The crew member has to be **actually travelling** (`walking`). A thread that stops
   *    running goes idle or dormant, `_isActive` goes false, and its car drives home from a
   *    plot its crew member is standing still on — suppressing that one blanks a figure for
   *    a drive it is not on. That is the most ordinary delivery in the application.
   *  - Its status must carry **no badge**. The badge is what the application promises you can
   *    always find; hide the figure and the badge goes with it (`_badgeFor`) and so does the
   *    click target (`astronauts.pick`).
   *
   * Which way the car is driving is *not* one of them, though it looks like it should be.
   * `_isActive` is `running || unread || hasError`, so a quiet thread parks its car at the
   * depot; when it next comes back as `unread` — `waiting`, the one `?` that wants you — the
   * car drives back *out*, and an outbound-only rule blanks that `?` for the whole drive.
   *
   * The cost of the pair is a car that sometimes drives with nobody visibly aboard. That is
   * fine, and the spec says so: it reads as a car running its own errand. A vanishing crew
   * member does not.
   *
   * Only ever sets the flag. Clearing it is `_updateDeliveries`'s opening sweep, so an entry
   * that stops being visited cannot leave a crew member stranded off screen.
   */
  _markRiding(id) {
    const agent = this.astronauts.byId.get(id)
    if (!agent) return
    if (!ridesAlong(agent.state, this._statusBadgeFor(agent) !== BADGE.none)) return
    agent.riding = true
  }

  // ── interaction ─────────────────────────────────────────────────────────────────────

  pick(ndcX, ndcY, aspect) {
    return this.astronauts.pick(this.camera, ndcX, ndcY, aspect)
  }

  agentFor(id) {
    return this.astronauts.byId.get(id)
  }

  setUiVisible(visible) {
    this.uiVisible = visible
    this._syncLabels()
  }

  _syncLabels() {
    // Visibility is per-label now; the group only ever hides everything at once.
    this.labelGroup.visible = true
  }

  dispose() {
    this.sky.dispose()
    this.ship.dispose()
    this.astronauts.dispose()
    this.indicators.dispose()
    this.particles.dispose()
    this.deliveries.dispose()
    this.traffic.dispose()
    this.roadGroup?.userData.dispose?.()
    this.bikeGroup?.userData.dispose?.()
    this.treeGroup?.userData.dispose?.()
    this.parkGroup?.userData.dispose?.()
    this.townGroup?.userData.dispose?.()
    disposeTree(this.worldGroup)
    disposeTree(this.plotGroup)
    disposeTree(this.labelGroup)
    this.scene.remove(this.worldGroup, this.plotGroup, this.labelGroup)
  }
}

function disposeTree(root) {
  root.traverse((o) => {
    if (!o.isMesh && !o.isPoints) return
    o.geometry?.dispose()
    if (Array.isArray(o.material)) o.material.forEach((m) => m.dispose())
    else o.material?.dispose()
  })
}
