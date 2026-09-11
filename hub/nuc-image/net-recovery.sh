#!/usr/bin/env bash
#
# Bot Crossing hub — network recovery watchdog.
#
# Runs continuously (bch-netwatch.service). While the hub is online it does nothing. If it goes
# offline and stays offline past a grace period — moved to a new office, wifi password changed,
# router swapped — it raises the same "BotCrossing-Setup" hotspot + captive portal that first
# boot uses, so the wifi can be reconfigured from a phone with no keyboard on the NUC. On submit
# it applies the new wifi and drops the hotspot; if the network returns on its own first, it
# never raises the AP. Only the wifi is applied here — teammates/colony config are left as they
# are, so a recovery never clobbers what was set from the web config.

set -uo pipefail

SETUP_DIR="/opt/bch-setup"
AP_IP="10.42.0.1"
GRACE_SECS="${BCH_NETWATCH_GRACE:-300}"     # stay offline this long before raising the AP
PORTAL_WAIT="${BCH_NETWATCH_PORTAL_WAIT:-900}"  # keep the portal up this long waiting for a phone
LOG="/var/log/bch-netwatch.log"

exec >> "$LOG" 2>&1

have_net() {
  curl -fsS -m 5 https://archive.ubuntu.com/ >/dev/null 2>&1 \
    || getent hosts archive.ubuntu.com >/dev/null 2>&1
}

wifi_iface() {
  local d
  for d in /sys/class/net/*/wireless; do
    [ -e "$d" ] || continue
    basename "$(dirname "$d")"
    return 0
  done
  return 1
}

raise_ap() {
  local iface="$1"
  echo "$(date -Is) raising recovery AP on ${iface}"
  command -v rfkill >/dev/null 2>&1 && rfkill unblock wifi || true
  systemctl stop wpa_supplicant 2>/dev/null || true
  systemctl stop "netplan-wpa-${iface}.service" 2>/dev/null || true
  sed "s/__WIFI_IF__/${iface}/g" "${SETUP_DIR}/net/hostapd.conf" > /etc/hostapd/hostapd.conf
  sed "s/__WIFI_IF__/${iface}/g" "${SETUP_DIR}/net/dnsmasq.conf" > /etc/dnsmasq.d/bch-setup.conf
  ip addr flush dev "$iface" || true
  ip addr add "${AP_IP}/24" dev "$iface"
  ip link set "$iface" up
  systemctl unmask hostapd 2>/dev/null || true
  systemctl restart dnsmasq
  systemctl restart hostapd
  rm -f "${SETUP_DIR}/.submitted" "${SETUP_DIR}/pending.json"
  BCH_SETUP_DIR="${SETUP_DIR}" BCH_PORTAL_DIR="${SETUP_DIR}/portal" \
    python3 "${SETUP_DIR}/setup-server.py" &
  echo $! > "${SETUP_DIR}/.netwatch-portal.pid"
}

lower_ap() {
  local iface="$1"
  echo "$(date -Is) lowering recovery AP"
  [ -f "${SETUP_DIR}/.netwatch-portal.pid" ] && kill "$(cat "${SETUP_DIR}/.netwatch-portal.pid")" 2>/dev/null || true
  rm -f "${SETUP_DIR}/.netwatch-portal.pid"
  systemctl stop hostapd 2>/dev/null || true
  rm -f /etc/dnsmasq.d/bch-setup.conf
  systemctl stop dnsmasq 2>/dev/null || true
  ip addr flush dev "$iface" || true
}

apply_wifi() {
  local iface="$1" ssid psk
  ssid="$(python3 -c 'import json;d=json.load(open("'"${SETUP_DIR}"'/pending.json"));w=d.get("wifi") or {};print(w.get("ssid",""))' 2>/dev/null || true)"
  [ -n "$ssid" ] || { echo "$(date -Is) submission had no wifi — leaving netplan as is"; return 1; }
  psk="$(python3 -c 'import json;d=json.load(open("'"${SETUP_DIR}"'/pending.json"));w=d.get("wifi") or {};print(w.get("password",""))' 2>/dev/null || true)"
  echo "$(date -Is) applying wifi '${ssid}' on ${iface}"
  umask 077
  cat > /etc/netplan/60-bch-wifi.yaml <<YAML
network:
  version: 2
  wifis:
    ${iface}:
      dhcp4: true
      access-points:
        "${ssid}":
          password: "${psk}"
YAML
  chmod 600 /etc/netplan/60-bch-wifi.yaml
}

echo "=== bch-netwatch start @ $(date -Is) (grace ${GRACE_SECS}s) ==="
offline_since=0
while true; do
  if have_net; then
    offline_since=0
    sleep 30
    continue
  fi

  now=$(date +%s)
  [ "$offline_since" -eq 0 ] && offline_since=$now
  if [ $(( now - offline_since )) -lt "$GRACE_SECS" ]; then
    sleep 15
    continue
  fi

  # Offline past the grace period — bring up the portal so a phone can hand us new wifi.
  IFACE="$(wifi_iface || echo wlp1s0)"
  raise_ap "$IFACE"
  echo "$(date -Is) portal up on '${IFACE}' — join Wi-Fi 'BotCrossing-Setup' to reconfigure"

  waited=0
  submitted=""
  while [ "$waited" -lt "$PORTAL_WAIT" ]; do
    [ -f "${SETUP_DIR}/.submitted" ] && { submitted=1; break; }
    sleep 3
    waited=$(( waited + 3 ))
  done

  lower_ap "$IFACE"
  [ -n "$submitted" ] && apply_wifi "$IFACE"
  netplan apply || true     # restore normal networking (with the new wifi if one was submitted)
  offline_since=0
  sleep 25                  # let the interface associate before the next connectivity check
done
