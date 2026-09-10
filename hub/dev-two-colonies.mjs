#!/usr/bin/env node
/**
 * Dev harness: two fake sharing colonies + a hub, all on one machine (loopback only).
 *
 * Spins up three `server/serve.mjs` instances as child processes — "Colony A", "Colony B"
 * and a "Hub" — each with its own port block and its own `BOT_CROSSING_DATA` directory, the
 * same way two real teammates and a wall display would be three separate machines. Colony A
 * and Colony B are set to share (`network.share = true`) a couple of repos each; the Hub's
 * `data/colony.json` lists both of them as neighbours. Once all three are up it prints the
 * hub URL — open that to see the merged NEEDS YOU board and colony strip, for exercising
 * Tasks 7 and 8 (the triage HUD, the new-attention popup) without needing teammates or the
 * NUC.
 *
 * What "fake" means here: the two colonies' *identities* and network wiring are fake (made
 * up names, made-up ports, throwaway data dirs) — but the threads they share are whatever
 * this machine's own installed harnesses (Claude Code, Codex, Cursor) actually report,
 * exactly as `scanThreads()` would for a real colony. There is no synthetic-thread mode: the
 * two fake colonies just carve up this machine's real threads by repo name into two
 * different `network.shared` allowlists, so the hub has two distinct-looking colonies to
 * merge. If this machine has no threads from any supported harness, both colonies share
 * nothing and the hub's board correctly shows "All clear" — still useful for checking the
 * empty state and the chrome, just not the populated board.
 *
 * Usage:
 *   node hub/dev-two-colonies.mjs [options]
 *
 * Options:
 *   --base-port=N       First port used; 9 consecutive ports are claimed from here
 *                        (web/guest/discovery × 3 instances). Default 5301.
 *   --repos-a=x,y        Repo names Colony A shares, overriding auto-discovery.
 *   --repos-b=x,y        Repo names Colony B shares, overriding auto-discovery.
 *   --data-dir=PATH      Where the three colonies' data directories live. Default a fixed
 *                        folder under the OS temp dir, reused across runs (so any state you
 *                        create by clicking around — network settings, plots dragged in the
 *                        game — survives the next run rather than starting from zero).
 *   --help               Print this and exit.
 *
 * Requires a build: `server/serve.mjs` serves `dist/`, which does not exist until
 * `npm run build` has been run in this checkout. Without it the three servers still start
 * fine (the API works), but the page itself 404s — build first if you want to actually see
 * the HUD.
 *
 * Stop everything with Ctrl+C — all three child processes are killed together.
 */
import fsp from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { scanThreads } from '../server/scan.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = path.join(HERE, '..')
const SERVE_SCRIPT = path.join(REPO_ROOT, 'server', 'serve.mjs')

function parseArgs(argv) {
  const out = {
    basePort: 5301,
    reposA: null,
    reposB: null,
    dataDir: path.join(os.tmpdir(), 'bot-crossing-dev-hub'),
    help: false,
  }
  for (const arg of argv) {
    const eq = arg.indexOf('=')
    const key = eq === -1 ? arg : arg.slice(0, eq)
    const value = eq === -1 ? '' : arg.slice(eq + 1)
    switch (key) {
      case '--base-port':
        out.basePort = Number(value)
        break
      case '--repos-a':
        out.reposA = value.split(',').map((s) => s.trim()).filter(Boolean)
        break
      case '--repos-b':
        out.reposB = value.split(',').map((s) => s.trim()).filter(Boolean)
        break
      case '--data-dir':
        out.dataDir = value
        break
      case '--help':
      case '-h':
        out.help = true
        break
      default:
        console.error(`dev-two-colonies: unknown option "${arg}" (--help for usage)`)
        process.exit(1)
    }
  }
  if (!Number.isInteger(out.basePort) || out.basePort <= 0 || out.basePort > 65527) {
    console.error('dev-two-colonies: --base-port must be an integer in 1-65527')
    process.exit(1)
  }
  return out
}

function printHelp() {
  console.log(
    [
      'Usage: node hub/dev-two-colonies.mjs [options]',
      '',
      '  --base-port=N     First of 9 consecutive ports claimed (default 5301)',
      '  --repos-a=x,y     Repo names Colony A shares (default: auto-discovered)',
      '  --repos-b=x,y     Repo names Colony B shares (default: auto-discovered)',
      '  --data-dir=PATH   Where the three colonies keep their data (default: a fixed',
      '                    folder under the OS temp dir, reused across runs)',
      '  --help            This message',
    ].join('\n')
  )
}

/** Every repo name this machine's real, installed harnesses currently know about. */
async function discoverRepoNames() {
  try {
    const threads = await scanThreads()
    return [...new Set(threads.map((t) => t.project).filter(Boolean))]
  } catch {
    return []
  }
}

/**
 * Carve the discovered repo names into "a couple" for each fake colony. With four or more
 * distinct repos on this machine they get an even, non-overlapping split, so the hub shows
 * two colonies with genuinely different repos. With fewer, there is nothing to split — both
 * colonies share the same handful rather than one of them sharing nothing.
 */
function splitRepos(names) {
  if (names.length >= 4) return { a: names.slice(0, 2), b: names.slice(2, 4) }
  return { a: names, b: names }
}

/**
 * Write (or update) a colony's `data/colony.json`, touching only the `network` block.
 *
 * Merging rather than overwriting means running this harness a second time does not wipe
 * out plots you dragged around or settings you changed by hand in a previous run — exactly
 * the "reusable" part of a reusable verification harness.
 */
async function seedColonyFile(dataDir, networkPatch) {
  await fsp.mkdir(dataDir, { recursive: true })
  const file = path.join(dataDir, 'colony.json')
  let state = {}
  try {
    state = JSON.parse(await fsp.readFile(file, 'utf8'))
  } catch {
    /* first run for this data dir — start fresh */
  }
  const next = {
    ...state,
    version: 2,
    network: { ...(state.network || {}), ...networkPatch },
  }
  await fsp.writeFile(file, JSON.stringify(next, null, 2))
  return file
}

function envFor(dataDir, ports) {
  return {
    ...process.env,
    PORT: String(ports.web),
    BOT_CROSSING_GUEST_PORT: String(ports.guest),
    BOT_CROSSING_DISCOVERY_PORT: String(ports.discovery),
    BOT_CROSSING_DATA: dataDir,
    BOT_CROSSING_HOST: '127.0.0.1',
  }
}

/** Actually connect, rather than trust a "the process is up" guess — the only honest check. */
function probePort(port, host = '127.0.0.1', timeoutMs = 800) {
  return new Promise((resolve) => {
    const socket = net.connect({ host, port })
    let done = false
    const finish = (ok) => {
      if (done) return
      done = true
      socket.destroy()
      resolve(ok)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

/** Spawn `serve.mjs` with the given env, prefixing every line it prints with `label`. */
function spawnServer(label, env) {
  const child = spawn(process.execPath, [SERVE_SCRIPT], { cwd: REPO_ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  const forward = (readable, writable) => {
    let buf = ''
    readable.on('data', (chunk) => {
      buf += chunk.toString()
      let nl
      while ((nl = buf.indexOf('\n')) >= 0) {
        writable.write(`[${label}] ${buf.slice(0, nl + 1)}`)
        buf = buf.slice(nl + 1)
      }
    })
    readable.on('end', () => {
      if (buf) writable.write(`[${label}] ${buf}\n`)
    })
  }
  forward(child.stdout, process.stdout)
  forward(child.stderr, process.stderr)
  return child
}

/** Wait for a spawned server's port to answer, failing fast if the process dies first. */
async function waitForPort(child, port, label, timeoutMs = 15000) {
  const deadline = Date.now() + timeoutMs
  let exited = null
  const onExit = (code, signal) => {
    exited = { code, signal }
  }
  child.once('exit', onExit)
  try {
    while (Date.now() < deadline) {
      if (exited) {
        throw new Error(
          `${label} exited before port ${port} opened (code ${exited.code}, signal ${exited.signal}) — ` +
            `is that port already in use? Try a different --base-port.`
        )
      }
      if (await probePort(port)) return
      await new Promise((r) => setTimeout(r, 200))
    }
    throw new Error(`${label}: timed out waiting for port ${port} after ${timeoutMs}ms`)
  } finally {
    child.off('exit', onExit)
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2))
  if (args.help) {
    printHelp()
    return
  }

  const base = args.basePort
  const ports = {
    a: { web: base, guest: base + 1, discovery: base + 2 },
    b: { web: base + 3, guest: base + 4, discovery: base + 5 },
    hub: { web: base + 6, guest: base + 7, discovery: base + 8 },
  }
  const dataDirs = {
    a: path.join(args.dataDir, 'colony-a'),
    b: path.join(args.dataDir, 'colony-b'),
    hub: path.join(args.dataDir, 'hub'),
  }

  console.log(`dev-two-colonies: data dirs under ${args.dataDir}`)

  const discovered = args.reposA && args.reposB ? null : await discoverRepoNames()
  const split = discovered ? splitRepos(discovered) : { a: [], b: [] }
  const shared = {
    a: args.reposA || split.a,
    b: args.reposB || split.b,
  }
  if (!shared.a.length && !shared.b.length) {
    console.log(
      'dev-two-colonies: no repos found to share (no Claude Code / Codex / Cursor threads on ' +
        'this machine, and no --repos-a/--repos-b given) — both fake colonies will share ' +
        'nothing, so the hub board will show "All clear".'
    )
  } else {
    console.log(`dev-two-colonies: Colony A shares [${shared.a.join(', ')}]`)
    console.log(`dev-two-colonies: Colony B shares [${shared.b.join(', ')}]`)
  }

  await seedColonyFile(dataDirs.a, { colonyName: 'Colony A', share: true, shared: shared.a })
  await seedColonyFile(dataDirs.b, { colonyName: 'Colony B', share: true, shared: shared.b })

  const children = []
  const killAll = () => {
    for (const child of children) {
      if (!child.killed) child.kill()
    }
  }
  process.once('SIGINT', () => {
    console.log('\ndev-two-colonies: stopping...')
    killAll()
    process.exit(0)
  })
  process.once('SIGTERM', () => {
    killAll()
    process.exit(0)
  })

  try {
    const colonyA = spawnServer('colony-a', envFor(dataDirs.a, ports.a))
    const colonyB = spawnServer('colony-b', envFor(dataDirs.b, ports.b))
    children.push(colonyA, colonyB)

    // Both the web port (the server is up) and the guest port (sharing is actually applied)
    // matter here — the hub is about to be pointed at the guest ports as neighbours.
    await Promise.all([
      waitForPort(colonyA, ports.a.web, 'colony-a'),
      waitForPort(colonyA, ports.a.guest, 'colony-a (guest)'),
      waitForPort(colonyB, ports.b.web, 'colony-b'),
      waitForPort(colonyB, ports.b.guest, 'colony-b (guest)'),
    ])
    console.log(`dev-two-colonies: Colony A up — web :${ports.a.web}, guest :${ports.a.guest}`)
    console.log(`dev-two-colonies: Colony B up — web :${ports.b.web}, guest :${ports.b.guest}`)

    await seedColonyFile(dataDirs.hub, {
      colonyName: 'Hub',
      share: false,
      neighbors: [
        { name: 'Colony A', host: '127.0.0.1', port: ports.a.guest },
        { name: 'Colony B', host: '127.0.0.1', port: ports.b.guest },
      ],
    })

    const hub = spawnServer('hub', envFor(dataDirs.hub, ports.hub))
    children.push(hub)
    await waitForPort(hub, ports.hub.web, 'hub')

    console.log('')
    console.log(`dev-two-colonies: hub ready → http://127.0.0.1:${ports.hub.web}/?hub=1`)
    console.log('dev-two-colonies: Ctrl+C to stop all three instances')
  } catch (err) {
    console.error(`dev-two-colonies: ${err.message}`)
    killAll()
    process.exitCode = 1
  }
}

main()
