#!/usr/bin/env bash
#
# Bot Crossing hub — build a self-installing Ubuntu ISO (zero keystrokes on the NUC).
#
# Remasters the Ubuntu Server 24.04 ISO so it: (1) auto-runs an unattended install with no key
# press, and (2) drops this whole nuc-image payload + an offline hostapd/dnsmasq bundle onto the
# machine and enables bch-firstboot.service, which does the phone-portal setup on first boot.
#
# RUN THIS ON LINUX (or WSL Ubuntu 24.04 — matching the target so the offline .deb closure is
# right). Needs: xorriso, curl, openssl, and apt-get (to fetch the offline packages).
#
# Usage:  ./build-iso.sh [iso.env]
# Output: build/bot-crossing-hub.iso   (flash to a USB with Ventoy/Rufus/dd and boot the NUC)

set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE"

CONFIG="${1:-iso.env}"
[ -f "$CONFIG" ] || { echo "no '$CONFIG' — copy iso.env.example to iso.env and fill it in" >&2; exit 1; }
# shellcheck source=/dev/null
source "$CONFIG"

: "${BCH_HOSTNAME:?}" "${BCH_USER:?}" "${BCH_PASSWORD:?}" "${BCH_REPO_URL:?}"
[ "$BCH_PASSWORD" = "change-me-please" ] && { echo "set a real BCH_PASSWORD in $CONFIG" >&2; exit 1; }
BCH_BRANCH="${BCH_BRANCH:-main}"

need() { command -v "$1" >/dev/null 2>&1 || { echo "missing tool: $1 (install it; on WSL: sudo apt-get install $2)" >&2; exit 1; }; }
need xorriso xorriso
need curl curl
need openssl openssl
case "$(uname -s)" in Linux) : ;; *) echo "build-iso.sh must run on Linux/WSL (needs xorriso + apt-get)"; exit 1;; esac

WORK="build/iso-work"
OUT="build/bot-crossing-hub.iso"
PAYLOAD="build/payload"
rm -rf "$WORK" "$PAYLOAD"
mkdir -p build "$PAYLOAD"

# ── 1. get the source ISO ─────────────────────────────────────────────────────────────────
ISO="${UBUNTU_ISO:-}"
if [ -z "$ISO" ]; then
  ISO="build/ubuntu-24.04-live-server-amd64.iso"
  if [ ! -s "$ISO" ]; then
    echo "finding the current Ubuntu Server 24.04 LTS ISO…"
    base="https://releases.ubuntu.com/24.04"
    fn="$(curl -fsSL "$base/" | grep -oE 'ubuntu-24\.04(\.[0-9]+)?-live-server-amd64\.iso' | sort -uV | tail -1)"
    [ -n "$fn" ] || { echo "could not find a live-server ISO at $base/" >&2; exit 1; }
    echo "downloading $fn …"
    curl -fL --retry 3 -o "$ISO" "$base/$fn"
  fi
fi
[ -f "$ISO" ] || { echo "source ISO not found: $ISO" >&2; exit 1; }

# ── 2. assemble the payload copied onto the ISO at /bch ───────────────────────────────────
echo "assembling payload…"
cp -r provision.sh firstboot.sh setup-server.py portal net systemd "$PAYLOAD"/
# iso.env for firstboot (account/repo only — no secrets beyond the account it already installs).
cat > "$PAYLOAD/iso.env" <<ENV
BCH_HOSTNAME="${BCH_HOSTNAME}"
BCH_USER="${BCH_USER}"
BCH_REPO_URL="${BCH_REPO_URL}"
BCH_BRANCH="${BCH_BRANCH}"
BCH_COLONY_NAME="Hub"
ENV

echo "fetching offline setup packages (hostapd/dnsmasq/wpasupplicant/iw/rfkill + deps)…"
mkdir -p "$PAYLOAD/offline"
if command -v apt-get >/dev/null 2>&1; then
  apt-get -y -o Dir::Cache::archives="$(cd "$PAYLOAD/offline" && pwd)" \
    install --download-only --no-install-recommends \
    hostapd dnsmasq wpasupplicant iw rfkill >/dev/null 2>&1 \
    || echo "WARN: could not pre-fetch all offline debs — run on Ubuntu 24.04 for a complete set"
  # apt drops partial/lock dirs in the cache; keep only the .debs
  find "$PAYLOAD/offline" -maxdepth 1 -type f ! -name '*.deb' -delete 2>/dev/null || true
  rm -rf "$PAYLOAD/offline/partial" "$PAYLOAD/offline/lock" 2>/dev/null || true
else
  echo "WARN: no apt-get here — /bch/offline will be empty; the phone-AP step needs those debs"
fi

# ── 3. autoinstall seed (headless: no wifi/settings, installs the first-boot service) ─────
PWHASH="$(openssl passwd -6 "$BCH_PASSWORD")"
mkdir -p "$PAYLOAD/nocloud"
: > "$PAYLOAD/nocloud/meta-data"
cat > "$PAYLOAD/nocloud/user-data" <<YAML
#cloud-config
autoinstall:
  version: 1
  locale: en_US.UTF-8
  keyboard:
    layout: us
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
  late-commands:
    - cp -r /cdrom/bch /target/opt/bch-setup
    - cp /target/opt/bch-setup/systemd/bch-firstboot.service /target/etc/systemd/system/
    - curtin in-target --target=/target -- systemctl enable bch-firstboot.service
YAML

# ── 4. edit GRUB to auto-run the install (only the two cfg files, not the whole ISO) ──────
echo "editing GRUB to auto-run the install…"
mkdir -p "$WORK"
xorriso -osirrox on -indev "$ISO" -extract /boot/grub/grub.cfg "$WORK/grub.cfg" >/dev/null 2>&1
xorriso -osirrox on -indev "$ISO" -extract /boot/grub/loopback.cfg "$WORK/loopback.cfg" >/dev/null 2>&1 || true
[ -s "$WORK/grub.cfg" ] || { echo "FATAL: could not read /boot/grub/grub.cfg from the ISO" >&2; exit 1; }

edit_grub() {
  local f="$1"; [ -f "$f" ] || return 0
  # Add our NoCloud datasource to the installer's kernel line. The ';' is escaped for GRUB. It is
  # inserted before the ' ---' that separates installer args from kernel args when that marker is
  # present, else appended to the vmlinuz line.
  if grep -q ' ---' "$f"; then
    sed -i 's# ---# autoinstall ds=nocloud\\;s=/cdrom/bch/nocloud/ ---#g' "$f"
  else
    sed -i -E '/\/casper\/vmlinuz/ s#$# autoinstall ds=nocloud\\;s=/cdrom/bch/nocloud/#' "$f"
  fi
  # Start on its own instead of waiting on the menu.
  sed -i -E 's/^(set timeout=).*/\11/' "$f"
  sed -i -E 's/^([[:space:]]*timeout[[:space:]]+)[0-9]+/\11/' "$f"
}
edit_grub "$WORK/grub.cfg"
edit_grub "$WORK/loopback.cfg"

# ── 5. write the new ISO by REPLAYING the source's own boot images, overlaying our files ───
# This preserves the original BIOS (El Torito) + EFI boot exactly — and, crucially, the volume
# id casper searches for by label — instead of trying to reconstruct the boot options. We only
# overlay: our /bch payload, and the edited grub configs.
echo "writing ISO (replaying original boot, overlaying payload)…"
rm -f "$OUT"
MAPS=(-map "$(cd "$(dirname "$PAYLOAD")" && pwd)/$(basename "$PAYLOAD")" /bch
      -map "$(pwd)/$WORK/grub.cfg" /boot/grub/grub.cfg)
[ -f "$WORK/loopback.cfg" ] && MAPS+=(-map "$(pwd)/$WORK/loopback.cfg" /boot/grub/loopback.cfg)
xorriso -indev "$ISO" -outdev "$OUT" \
  -boot_image any replay \
  -overwrite on \
  "${MAPS[@]}" \
  -commit

echo
echo "built: $OUT"
echo "Flash it to a USB (Ventoy: copy the .iso on; or Rufus/balenaEtcher/dd) and boot the NUC."
echo "It installs unattended, then sets itself up from your phone on first boot. See README.md."
