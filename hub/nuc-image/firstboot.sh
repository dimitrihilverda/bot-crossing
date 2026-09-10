#!/usr/bin/env bash
#
# Bot Crossing hub — first-boot orchestrator (headless / phone-configured).
#
# Runs once as root from bch-firstboot.service on the freshly installed NUC, while the machine is
# still on the text console (no GUI yet). Flow:
#   1. no config yet + a wifi card present -> raise the "BotCrossing-Setup" hotspot + captive
#      portal, wait for the phone to submit wifi + teammate IPs, take the hotspot down.
#   2. apply that wifi (netplan) and wait to be online (skipped if on ethernet).
#   3. run provision.sh (install Node/Chromium/Tailscale/GUI, clone+build, seed colony.json,
#      enable autologin + the hub unit) WITHOUT rebooting.
#   4. connect Tailscale by showing its login URL as a QR on the console/wall to scan; wait for
#      it to come up.
#   5. mark done and reboot into the graphical hub.
#
# Idempotent via /opt/bch-setup/.provisioned. Logs to /var/log/bch-firstboot.log. SSH is on, so
# if any step needs a nudge you can watch and intervene remotely.

set -uo pipefail

SETUP_DIR="/opt/bch-setup"
MARKER="${SETUP_DIR}/.provisioned"
LOG="/var/log/bch-firstboot.log"
AP_IP="10.42.0.1"
OFFLINE="${SETUP_DIR}/offline"

exec > >(tee -a "$LOG") 2>&1
echo "=== bot-crossing firstboot @ $(date -Is) ==="
[ -f "$MARKER" ] && { echo "already provisioned — nothing to do"; exit 0; }

# Account + repo were baked into the ISO; everything else comes from the phone (pending.json).
# shellcheck source=/dev/null
[ -f "${SETUP_DIR}/iso.env" ] && source "${SETUP_DIR}/iso.env"
export BCH_USER="${BCH_USER:-hub}"
export BCH_HOSTNAME="${BCH_HOSTNAME:-bot-crossing-hub}"

set_phase() { echo "$1" > "${SETUP_DIR}/phase"; echo "--- phase: $1 ---"; }

wifi_iface() {
  # A wireless interface is the one with a wireless/ dir in sysfs — no `iw` needed.
  local d
  for d in /sys/class/net/*/wireless; do
    [ -e "$d" ] || continue
    basename "$(dirname "$d")"
    return 0
  done
  return 1
}

have_net() {
  curl -fsS -m 5 https://archive.ubuntu.com/ >/dev/null 2>&1 || getent hosts archive.ubuntu.com >/dev/null 2>&1
}

ensure_ap_tools() {
  # The hotspot needs hostapd + dnsmasq + wpasupplicant, which aren't on a minimal server. Prefer
  # installing them online (an ethernet first boot has network already), and fall back to the
  # .debs baked onto the ISO only when there is genuinely no network yet (the pure no-cable case).
  command -v hostapd >/dev/null 2>&1 && command -v dnsmasq >/dev/null 2>&1 && return 0
  if have_net; then
    echo "installing AP tools online…"
    apt-get update -y >/dev/null 2>&1 || true
    DEBIAN_FRONTEND=noninteractive apt-get install -y hostapd dnsmasq wpasupplicant iw rfkill >/dev/null 2>&1 || true
  fi
  if ! command -v hostapd >/dev/null 2>&1 && ls "${OFFLINE}"/*.deb >/dev/null 2>&1; then
    echo "installing AP tools from the offline bundle…"
    dpkg -i "${OFFLINE}"/*.deb >/dev/null 2>&1 || apt-get -y -f install --no-download >/dev/null 2>&1 || true
  fi
}

raise_ap() {
  local iface="$1"
  echo "raising setup AP on ${iface}…"
  command -v rfkill >/dev/null 2>&1 && rfkill unblock wifi || true
  systemctl stop wpa_supplicant 2>/dev/null || true
  sed "s/__WIFI_IF__/${iface}/g" "${SETUP_DIR}/net/hostapd.conf" > /etc/hostapd/hostapd.conf
  sed "s/__WIFI_IF__/${iface}/g" "${SETUP_DIR}/net/dnsmasq.conf" > /etc/dnsmasq.d/bch-setup.conf
  ip addr flush dev "$iface" || true
  ip addr add "${AP_IP}/24" dev "$iface"
  ip link set "$iface" up
  systemctl unmask hostapd 2>/dev/null || true
  systemctl restart dnsmasq
  systemctl restart hostapd
  BCH_SETUP_DIR="${SETUP_DIR}" BCH_PORTAL_DIR="${SETUP_DIR}/portal" \
    python3 "${SETUP_DIR}/setup-server.py" &
  echo $! > "${SETUP_DIR}/.portal.pid"
}

lower_ap() {
  local iface="$1"
  echo "lowering setup AP…"
  [ -f "${SETUP_DIR}/.portal.pid" ] && kill "$(cat "${SETUP_DIR}/.portal.pid")" 2>/dev/null || true
  systemctl stop hostapd 2>/dev/null || true
  rm -f /etc/dnsmasq.d/bch-setup.conf
  systemctl stop dnsmasq 2>/dev/null || true
  ip addr flush dev "$iface" || true
}

# ── 1. collect settings from the phone, unless already provided ───────────────────────────
if [ ! -f "${SETUP_DIR}/pending.json" ]; then
  set_phase collecting
  ensure_ap_tools
  IFACE="$(wifi_iface || true)"
  if [ -n "${IFACE:-}" ] && command -v hostapd >/dev/null 2>&1; then
    raise_ap "$IFACE"
    echo "waiting for the phone to submit settings (join Wi-Fi 'BotCrossing-Setup')…"
    while [ ! -f "${SETUP_DIR}/.submitted" ]; do sleep 2; done
    lower_ap "$IFACE"
  else
    echo "no usable wifi AP — assuming wired ethernet, using defaults"
    echo '{"colonyName":"Hub","neighbors":[]}' > "${SETUP_DIR}/pending.json"
  fi
fi

# ── 2. apply wifi (if the phone gave any) and wait for the network ────────────────────────
set_phase connecting
SSID="$(python3 -c 'import json,sys;d=json.load(open("'"${SETUP_DIR}"'/pending.json"));w=d.get("wifi") or {};print(w.get("ssid",""))' 2>/dev/null || true)"
if [ -n "${SSID}" ]; then
  IFACE="${IFACE:-$(wifi_iface || echo wlan0)}"
  PSK="$(python3 -c 'import json;d=json.load(open("'"${SETUP_DIR}"'/pending.json"));w=d.get("wifi") or {};print(w.get("password",""))' 2>/dev/null || true)"
  echo "configuring wifi '${SSID}' on ${IFACE} via netplan…"
  umask 077
  cat > /etc/netplan/60-bch-wifi.yaml <<YAML
network:
  version: 2
  wifis:
    ${IFACE}:
      dhcp4: true
      access-points:
        "${SSID}":
          password: "${PSK}"
YAML
  chmod 600 /etc/netplan/60-bch-wifi.yaml
  netplan apply || true
fi

echo "waiting for the machine to come online…"
online=""
for _ in $(seq 1 60); do
  if getent hosts deb.nodesource.com >/dev/null 2>&1 && curl -fsS -m 5 https://deb.nodesource.com/ >/dev/null 2>&1; then
    online=1; break
  fi
  sleep 3
done
[ -n "$online" ] || echo "WARN: still not online after ~3min — provisioning may fail; check the cable/wifi"

# ── 3. provision (installs everything, builds, seeds colony.json) — no reboot here ────────
set_phase installing
BCH_NO_REBOOT=1 bash "${SETUP_DIR}/provision.sh" || echo "WARN: provision.sh returned non-zero — see /var/log/bch-provision.log"

# ── 4. Tailscale by QR on the screen (no key ever stored) ─────────────────────────────────
set_phase tailscale
apt-get install -y qrencode >/dev/null 2>&1 || true
if command -v tailscale >/dev/null 2>&1 && ! tailscale status >/dev/null 2>&1; then
  echo "bringing up Tailscale — scan the QR to approve this hub…"
  ( tailscale up --hostname="${BCH_HOSTNAME}" >"${SETUP_DIR}/ts-up.out" 2>&1 & )
  # Wait for the login URL to appear, then draw it big on the console and save it for /wall.
  TS_URL=""
  for _ in $(seq 1 40); do
    TS_URL="$(grep -Eo 'https://login\.tailscale\.com/[a-zA-Z0-9/]+' "${SETUP_DIR}/ts-up.out" 2>/dev/null | head -1 || true)"
    [ -n "$TS_URL" ] && break
    sleep 1
  done
  if [ -n "$TS_URL" ]; then
    echo "$TS_URL" > "${SETUP_DIR}/ts-login-url"
    command -v qrencode >/dev/null 2>&1 && qrencode -o "${SETUP_DIR}/ts-qr.png" -s 10 -m 2 "$TS_URL" || true
    {
      printf '\n\n  Connect this hub to Tailscale — scan with your phone:\n\n'
      command -v qrencode >/dev/null 2>&1 && qrencode -t ANSIUTF8 "$TS_URL"
      printf '\n  or open: %s\n\n' "$TS_URL"
    } > /dev/tty1 2>/dev/null || true
    echo "waiting for Tailscale to be approved…"
    for _ in $(seq 1 120); do
      tailscale status >/dev/null 2>&1 && break
      sleep 5
    done
  else
    echo "WARN: could not read a Tailscale login URL — run 'sudo tailscale up' over SSH once"
  fi
fi

# ── 5. done → reboot into the graphical hub ───────────────────────────────────────────────
set_phase done
touch "$MARKER"
echo "=== firstboot complete @ $(date -Is) — rebooting into the wall ==="
sync
systemctl reboot
