#!/usr/bin/env bash
#
# Bot Crossing hub — first-boot provisioning.
#
# Runs once, as root, on the installed NUC's first boot (cloud-init `runcmd` from the autoinstall
# seed calls it). Turns a bare Ubuntu Server install into the running wall: installs
# Node/Chromium/Tailscale + a minimal GUI, clones and builds the app, seeds the hub's neighbours,
# wires up autologin + the systemd unit, joins the tailnet, and reboots into the kiosk.
#
# Idempotent: the /opt/bch-setup/.provisioned marker makes a re-run a no-op. To retry after a
# failure, delete that marker and run this script again (it logs to /var/log/bch-provision.log).
# Every step here is also written out as a manual command in hub/README.md — this is that guide,
# automated. Assumes the machine is already online (the autoinstall seed configured the network).

set -uo pipefail

SETUP_DIR="/opt/bch-setup"
CONFIG="${SETUP_DIR}/config.env"
MARKER="${SETUP_DIR}/.provisioned"
LOG="/var/log/bch-provision.log"

exec > >(tee -a "$LOG") 2>&1
echo "=== bot-crossing hub provision @ $(date -Is) ==="

if [ -f "$MARKER" ]; then
  echo "already provisioned (marker $MARKER present) — nothing to do"
  exit 0
fi
# The pre-fill path (build-usb.sh) lands a config.env here. The headless path (firstboot.sh)
# exports the same account/repo vars from iso.env instead and hands settings via pending.json.
# Either is fine — the checks below catch anything actually missing.
# shellcheck source=/dev/null
[ -f "$CONFIG" ] && source "$CONFIG"

BCH_USER="${BCH_USER:?BCH_USER missing from config.env}"
BCH_HOSTNAME="${BCH_HOSTNAME:-bot-crossing-hub}"
BCH_REPO_URL="${BCH_REPO_URL:?BCH_REPO_URL missing from config.env}"
BCH_BRANCH="${BCH_BRANCH:-main}"
BCH_COLONY_NAME="${BCH_COLONY_NAME:-Hub}"
USER_HOME="$(getent passwd "$BCH_USER" | cut -d: -f6)"
: "${USER_HOME:?could not resolve home directory for $BCH_USER}"

# Run a command as the kiosk user with a login shell. Only file/npm/git work runs this way — the
# systemd user unit is enabled by symlink below, so we never need a running user D-Bus here.
run_as_user() { sudo -u "$BCH_USER" -H bash -lc "$1"; }

export DEBIAN_FRONTEND=noninteractive

echo "--- [1/8] base packages + minimal GUI ---"
apt-get update
# NOT --no-install-recommends: xserver-xorg's recommends are its video/input drivers, and
# without them X finds no screen on real hardware and lightdm drops to a text login.
apt-get install -y \
  curl ca-certificates git jq \
  xserver-xorg xinit x11-xserver-utils openbox lightdm unclutter

echo "--- [2/8] Node 22 ---"
if ! command -v node >/dev/null 2>&1 || ! node -v | grep -Eq '^v(2[2-9]|[3-9][0-9])'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi
echo "node $(node -v)"

echo "--- [3/8] Chromium ---"
apt-get install -y chromium 2>/dev/null || apt-get install -y chromium-browser

echo "--- [4/8] Tailscale ---"
if ! command -v tailscale >/dev/null 2>&1; then
  curl -fsSL https://tailscale.com/install.sh | sh
fi
if [ -n "${TS_AUTHKEY:-}" ]; then
  tailscale up --authkey="${TS_AUTHKEY}" --hostname="${BCH_HOSTNAME}" \
    || echo "WARN: 'tailscale up' failed — join the tailnet by hand later with: sudo tailscale up"
else
  echo "no TS_AUTHKEY set — run 'sudo tailscale up' once by hand to join the tailnet"
fi

echo "--- [5/8] clone + build the app as ${BCH_USER} ---"
run_as_user "
  set -e
  cd \"\$HOME\"
  if [ -d bot-crossing/.git ]; then
    cd bot-crossing && git fetch --all --prune
  else
    git clone '${BCH_REPO_URL}' bot-crossing && cd bot-crossing
  fi
  git checkout '${BCH_BRANCH}'
  git pull --ff-only origin '${BCH_BRANCH}' || true
  npm ci
  npm run build
"

echo "--- [6/8] seed data/colony.json neighbours ---"
cat > "${SETUP_DIR}/seed-colony.mjs" <<'SEED'
import fs from 'node:fs'
// Settings come from the phone portal (pending.json) when present, else from env (config.env).
let name = process.env.COLONY_NAME || 'Hub'
let neighbors = []
const pending = process.env.PENDING
if (pending && fs.existsSync(pending)) {
  try {
    const p = JSON.parse(fs.readFileSync(pending, 'utf8'))
    if (p.colonyName) name = p.colonyName
    if (Array.isArray(p.neighbors)) {
      neighbors = p.neighbors
        .filter((n) => n && n.host)
        .map((n) => ({ name: n.name || String(n.host), host: String(n.host), port: n.port || 5275 }))
    }
  } catch {
    /* malformed pending.json — fall through to the env form */
  }
}
if (!neighbors.length) {
  const raw = (process.env.NEIGHBORS_RAW || '').trim()
  neighbors = raw
    ? raw
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((pair) => {
          const i = pair.indexOf('=')
          const nm = i >= 0 ? pair.slice(0, i).trim() : pair.trim()
          const host = i >= 0 ? pair.slice(i + 1).trim() : ''
          return { name: nm || host, host, port: 5275 }
        })
        .filter((n) => n.host)
    : []
}
const path = process.argv[2]
let cur = {}
try {
  cur = JSON.parse(fs.readFileSync(path, 'utf8'))
} catch {
  /* first write — an absent or empty file is fine */
}
cur.version = 2
cur.network = {
  colonyName: name,
  share: false,
  shared: [],
  allowedReaders: [],
  ...(cur.network || {}),
  colonyName: name,
  neighbors,
}
fs.writeFileSync(path, JSON.stringify(cur, null, 2))
console.log('seeded ' + neighbors.length + ' neighbour(s) into ' + path)
SEED
run_as_user "cd \"\$HOME/bot-crossing\" && mkdir -p data && PENDING='${SETUP_DIR}/pending.json' NEIGHBORS_RAW='${BCH_NEIGHBORS:-}' COLONY_NAME='${BCH_COLONY_NAME:-Hub}' node '${SETUP_DIR}/seed-colony.mjs' data/colony.json"

echo "--- [7/8] autologin + no screen blanking ---"
mkdir -p /etc/lightdm/lightdm.conf.d
cat > /etc/lightdm/lightdm.conf.d/50-bch.conf <<EOF
[Seat:*]
autologin-user=${BCH_USER}
autologin-session=openbox
xserver-command=X -s 0 -dpms
EOF
systemctl set-default graphical.target
systemctl enable lightdm

# Openbox has no panel or blanking of its own to fight, but make doubly sure a wall never sleeps
# and the idle pointer is hidden. Create ~/.config as the user FIRST — otherwise it is created
# root-owned as a side effect, and step [8/8]'s ~/.config/systemd write then fails.
install -d -o "$BCH_USER" -g "$BCH_USER" "${USER_HOME}/.config" "${USER_HOME}/.config/openbox"
cat > "${USER_HOME}/.config/openbox/autostart" <<'OB'
xset s off -dpms &
xset s noblank &
unclutter -idle 1 &
# A bare openbox session does not activate graphical-session.target, so the hub's user unit is
# never pulled in on its own — start it explicitly. Import the X env first so the kiosk browser
# can reach the display.
systemctl --user import-environment DISPLAY XAUTHORITY
systemctl --user start bot-crossing-hub.service
OB
chown "$BCH_USER:$BCH_USER" "${USER_HOME}/.config/openbox/autostart"

echo "--- [8/8] hub systemd user unit + linger ---"
loginctl enable-linger "$BCH_USER"
run_as_user "
  set -e
  mkdir -p ~/.config/systemd/user/graphical-session.target.wants
  cp ~/bot-crossing/hub/bot-crossing-hub.service ~/.config/systemd/user/
  ln -sf ../bot-crossing-hub.service ~/.config/systemd/user/graphical-session.target.wants/bot-crossing-hub.service
"

echo "--- network recovery watchdog ---"
# Raises the setup hotspot again if the hub is ever offline for a while (moved office, wifi
# changed), so wifi can be re-entered from a phone without a keyboard on the NUC.
if [ -f "${SETUP_DIR}/systemd/bch-netwatch.service" ]; then
  cp "${SETUP_DIR}/systemd/bch-netwatch.service" /etc/systemd/system/
  systemctl daemon-reload
  systemctl enable bch-netwatch.service
fi

echo "=== provision complete @ $(date -Is) ==="
if [ "${BCH_NO_REBOOT:-0}" = "1" ]; then
  # Headless flow: firstboot.sh still has the Tailscale QR step to do, and owns the reboot + the
  # completion marker. Leaving both to it keeps the marker meaning "the whole setup finished".
  echo "BCH_NO_REBOOT=1 — leaving the reboot and completion marker to the caller (firstboot.sh)"
else
  touch "$MARKER"
  echo "rebooting into the wall"
  sync
  systemctl reboot
fi
