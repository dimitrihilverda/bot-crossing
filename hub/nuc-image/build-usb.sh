#!/usr/bin/env bash
#
# Bot Crossing hub — assemble the autoinstall seed from config.env.
#
# Runs on YOUR machine (Linux, macOS, or Git Bash on Windows), NOT on the NUC. Reads config.env,
# hashes the account password, and writes build/user-data + build/meta-data — the two files that
# go onto a FAT32 volume LABELLED  CIDATA  to drive the unattended Ubuntu install. See README.md.
#
# Usage:
#   ./build-usb.sh [config.env] [DEST]
#     config.env  path to your filled-in config (default: ./config.env)
#     DEST        optional path to a mounted CIDATA volume to copy the seed onto directly
#                 (e.g. /media/you/CIDATA, or /d on Git Bash). Copying to a mounted folder only —
#                 this never writes to a raw device.

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

CONFIG="${1:-config.env}"
DEST="${2:-}"

if [ ! -f "$CONFIG" ]; then
  echo "no '$CONFIG' — copy config.env.example to config.env and fill it in" >&2
  exit 1
fi
# shellcheck source=/dev/null
source "$CONFIG"

: "${BCH_HOSTNAME:?set BCH_HOSTNAME in $CONFIG}"
: "${BCH_USER:?set BCH_USER in $CONFIG}"
: "${BCH_PASSWORD:?set BCH_PASSWORD in $CONFIG}"
if [ "$BCH_PASSWORD" = "change-me-please" ]; then
  echo "refusing to build with the default password — set BCH_PASSWORD in $CONFIG" >&2
  exit 1
fi
command -v openssl >/dev/null 2>&1 || { echo "need 'openssl' to hash the password" >&2; exit 1; }
PWHASH="$(openssl passwd -6 "$BCH_PASSWORD")"

mkdir -p build
OUT="build/user-data"

# 10 spaces: content lines sit one level under `content: |` (at 8).
indent() { sed 's/^/          /'; }

{
  cat <<YAML
#cloud-config
autoinstall:
  version: 1
  locale: en_US.UTF-8
  keyboard:
    layout: us
YAML

  # Wifi only when asked; otherwise the autoinstall default (DHCP on ethernet) is used. `match`
  # on wl* means the NUC's actual wireless interface name does not have to be known here.
  if [ -n "${WIFI_SSID:-}" ]; then
    cat <<YAML
  network:
    version: 2
    wifis:
      wifi-any:
        match:
          name: "wl*"
        dhcp4: true
        access-points:
          "${WIFI_SSID}":
            password: "${WIFI_PASSWORD:-}"
YAML
  fi

  cat <<YAML
  storage:
    layout:
      name: direct
  identity:
    hostname: ${BCH_HOSTNAME}
    username: ${BCH_USER}
    password: "${PWHASH}"
  ssh:
    install-server: true
    allow-pw: true
  packages:
    - jq
  user-data:
    write_files:
      - path: /opt/bch-setup/provision.sh
        permissions: "0755"
        owner: root:root
        content: |
YAML
  indent < provision.sh

  cat <<YAML
      - path: /opt/bch-setup/config.env
        permissions: "0600"
        owner: root:root
        content: |
YAML
  indent < "$CONFIG"

  cat <<'YAML'
    runcmd:
      - [ "bash", "/opt/bch-setup/provision.sh" ]
YAML
} > "$OUT"

cp -f autoinstall/meta-data build/meta-data
echo "wrote $OUT and build/meta-data"

if [ -n "$DEST" ]; then
  if [ ! -d "$DEST" ]; then
    echo "dest '$DEST' is not a mounted directory — skipping copy" >&2
    exit 1
  fi
  cp -f build/user-data build/meta-data "$DEST"/
  echo "copied the seed onto $DEST (make sure that volume's LABEL is  CIDATA )"
fi

cat <<'NEXT'

Next steps (full walk-through in README.md):
  1. Put build/user-data + build/meta-data on a FAT32 volume LABELLED  CIDATA.
  2. Boot the NUC from an Ubuntu Server 24.04 USB.
  3. At the GRUB menu press 'e', add  autoinstall  to the end of the 'linux' line, Ctrl-X.
  It installs unattended, reboots, provisions on first boot, and comes up on the wall.
NEXT
