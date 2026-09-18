#!/usr/bin/env bash
#
# Bot Crossing — hub kiosk launcher (Linux)
#
# Starts the Bot Crossing server against this checkout's built `dist/`, waits for it to
# start answering, then opens Chromium full-screen on the read-only team-wall view
# (`?hub=1`). Meant to run under systemd — see `bot-crossing-hub.service` in this same
# directory — which restarts it forever, so a Chromium crash or a reboot just brings the
# wall back rather than needing a human at the NUC.
#
# Usage: hub/start-hub.sh   (run from anywhere; it cd's to the repo itself)
#
# Env overrides (all optional):
#   PORT                  Server port. Default 5274 — must match the URL Chromium opens.
#   BOT_CROSSING_REPO     Path to the bot-crossing checkout. Default: this script's parent
#                         directory, i.e. wherever `hub/` was cloned.
#   BOT_CROSSING_CHROMIUM Chromium binary. Default: `chromium`, falling back to
#                         `chromium-browser` (the name Debian/Ubuntu package under).
#   BOT_CROSSING_CHROME_PROFILE_DIR
#                         Chromium `--user-data-dir` for the kiosk profile. Default
#                         "$HOME/bot-crossing-hub-chrome" — a NON-hidden path on purpose: the
#                         Chromium snap's confinement blocks `--user-data-dir` under dot-dirs
#                         like ~/.config, so a hidden profile makes the kiosk browser exit at
#                         once. A persistent (non-incognito) profile so the hub's mute state
#                         (`botcrossing.hub.muted`) and render-quality preset
#                         (`botcrossing.settings.v1`), both `localStorage`, survive restarts.
#   BOT_CROSSING_PORT_WAIT_SECS
#                         How long to wait for the server before giving up. Default 60.
#
# See hub/README.md for the full NUC setup (OS, Node, Chromium, Tailscale, sharing).

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="${BOT_CROSSING_REPO:-$(cd "$HERE/.." && pwd)}"
PORT="${PORT:-5274}"
WAIT_SECS="${BOT_CROSSING_PORT_WAIT_SECS:-60}"
CHROME_PROFILE_DIR="${BOT_CROSSING_CHROME_PROFILE_DIR:-$HOME/bot-crossing-hub-chrome}"
URL="http://localhost:${PORT}/?hub=1"

cd "$REPO"

if [ ! -d "$REPO/dist" ]; then
  echo "start-hub.sh: no dist/ in $REPO — run 'npm install && npm run build' first" >&2
  exit 1
fi

CHROMIUM_BIN="${BOT_CROSSING_CHROMIUM:-}"
if [ -z "$CHROMIUM_BIN" ]; then
  if command -v chromium >/dev/null 2>&1; then
    CHROMIUM_BIN=chromium
  elif command -v chromium-browser >/dev/null 2>&1; then
    CHROMIUM_BIN=chromium-browser
  else
    echo "start-hub.sh: neither 'chromium' nor 'chromium-browser' is on PATH" >&2
    exit 1
  fi
fi

SERVER_PID=""
CHROMIUM_PID=""

# Both children die with this script — under systemd that means a crash of either half
# (Chromium falling over, the server hitting an unhandled error) brings the whole unit
# down, which Restart=always then brings back clean rather than leaving an orphaned half.
cleanup() {
  trap - EXIT INT TERM
  [ -n "$CHROMIUM_PID" ] && kill "$CHROMIUM_PID" 2>/dev/null || true
  [ -n "$SERVER_PID" ] && kill "$SERVER_PID" 2>/dev/null || true
  wait 2>/dev/null || true
}
trap cleanup EXIT INT TERM

echo "start-hub.sh: starting server (node server/serve.mjs) in $REPO"
node server/serve.mjs &
SERVER_PID=$!

echo "start-hub.sh: waiting up to ${WAIT_SECS}s for port ${PORT}..."
ready=""
for _ in $(seq 1 "$WAIT_SECS"); do
  if ! kill -0 "$SERVER_PID" 2>/dev/null; then
    echo "start-hub.sh: server exited before it opened port ${PORT}" >&2
    exit 1
  fi
  # Bash's /dev/tcp pseudo-device: a plain TCP connect used only to test "is anything
  # listening yet", opened and closed inside a subshell so nothing here has to track the fd.
  if (exec 3<>"/dev/tcp/127.0.0.1/${PORT}") 2>/dev/null; then
    ready=1
    break
  fi
  sleep 1
done

if [ -z "$ready" ]; then
  echo "start-hub.sh: gave up waiting for port ${PORT} after ${WAIT_SECS}s" >&2
  exit 1
fi

mkdir -p "$CHROME_PROFILE_DIR"

echo "start-hub.sh: opening Chromium kiosk on ${URL} (profile: ${CHROME_PROFILE_DIR})"
# --autoplay-policy: a wall display gets no user gesture, so without this Chromium leaves the
#   hub's AudioContext suspended and the alert ping never sounds.
# --disable-session-crashed-bubble / --no-first-run: Restart=always means Chromium will be
#   killed and relaunched; neither the crash-restore bubble nor a first-run prompt should ever
#   appear over the wall.
"$CHROMIUM_BIN" --kiosk --app="$URL" --noerrdialogs --disable-infobars \
  --autoplay-policy=no-user-gesture-required --disable-session-crashed-bubble --no-first-run \
  --user-data-dir="$CHROME_PROFILE_DIR" &
CHROMIUM_PID=$!

# Block here until either child exits first. Chromium exiting (crash, or `systemctl stop`'s
# TERM reaching this script and the trap killing everything) is the expected shutdown path.
# But the server exiting first (e.g. an unhandled error in `serve.mjs` after the page already
# loaded) matters just as much — without watching for it too, Chromium would sit there
# showing a stale page forever with nothing wrong from systemd's point of view, and
# Restart=always would never fire. `wait -n` on both PIDs ends the script the moment either
# one goes down; the trap above then tears down whichever child is still alive.
wait -n "$SERVER_PID" "$CHROMIUM_PID"
