# NUC bootable-USB installer — design

**Goal:** turn a bare Intel NUC into the running Bot Crossing team-hub wall by booting it once
from a prepared USB stick — no manual OS setup, no per-step commands.

**Status:** approved in chat 2026-09-10 ("Bootable USB, walk away"). This spec is the record;
implementation lives on branch `nuc-installer` under `hub/nuc-image/`.

## Approach

A standard **Ubuntu Server 24.04 LTS** installer USB carrying an **autoinstall** (subiquity /
cloud-init NoCloud) seed. Boot the NUC from it → Ubuntu installs unattended → on the installed
system's **first boot**, cloud-init runs a provisioning script that automates the entire
existing `hub/README.md`:

1. apt: Node 22, Chromium, Tailscale, and a minimal GUI (X + openbox + lightdm autologin) — the
   login manager is what gives the hub's systemd **user** unit its `graphical-session.target`.
2. clone the **public** fork (no credentials needed), `npm ci && npm run build`.
3. seed `data/colony.json` with the team's Tailscale neighbours.
4. install the hub user unit + `enable-linger`, wire lightdm autologin + screen-blank-off.
5. `tailscale up` with a pre-auth key.
6. reboot into the kiosk wall.

## Files (`hub/nuc-image/`)

- `config.env.example` — the single file the operator fills in (account, repo, Tailscale
  pre-auth key, teammate IPs, optional wifi). Copied to `config.env`, which is gitignored.
- `provision.sh` — the first-boot provisioner. Idempotent (a `/opt/bch-setup/.provisioned`
  marker makes a re-run a no-op), logs to `/var/log/bch-provision.log`, runs as root.
- `autoinstall/meta-data` — static NoCloud `instance-id`.
- `build-usb.sh` — run on the operator's machine (Linux/macOS, or Git Bash on Windows).
  Reads `config.env`, hashes the password with `openssl passwd -6`, and assembles
  `build/user-data` by embedding `provision.sh` + `config.env` into the autoinstall seed's
  `user-data.write_files`. Emits `build/{user-data,meta-data}`; optionally copies them onto a
  mounted `CIDATA` volume.
- `README.md` — build the stick, boot + trigger autoinstall, verify, troubleshoot.

## Key decisions

- **Seed transport:** NoCloud datasource — a FAT32 volume **labelled `CIDATA`** holding
  `user-data` + `meta-data`. Trigger by adding `autoinstall` to the kernel line at the Ubuntu
  GRUB menu (one keypress; Ubuntu's safety gate against an unattended disk wipe). Documented for
  both a two-stick layout and a single Ventoy stick with a `CIDATA` partition.
- **Provisioner runs at first boot, not in the installer** (`autoinstall.user-data` cloud-init),
  where it has full network + apt rather than the constrained installer environment.
- **User unit enabled by symlink**, not `systemctl --user enable`, so provisioning needs no
  running user D-Bus: `~/.config/systemd/user/graphical-session.target.wants/…`.
- **Quality preset is not seeded.** `applyAll` sets keys literally (no preset expansion), so
  seeding "Low" would embed the flattened preset and drift from the app. The i3 runs the default
  fine; the README documents setting Low once via the UI as the only optional tweak.
- **Credentials:** the Tailscale pre-auth key stays a placeholder in the repo; the operator
  supplies their own in `config.env`. It ends up (0600) on the CIDATA volume and on the NUC —
  README says to use a reusable-but-revocable key and keep the stick safe. The fork being public
  means no git token is ever needed.

## Out of scope

Rebuilding a custom ISO (the GRUB-edit path avoids it); wifi enterprise/802.1x; anything in the
deferred Fase 2 (writing to teammates' sessions). The wall stays read-only by construction.

## Verification

Scripts pass `shellcheck`; the generated `build/user-data` parses as YAML and its embedded
`provision.sh` passes `bash -n`. On-metal boot is the operator's acceptance test — the README
lists exactly what to check (`journalctl`, `/var/log/bch-provision.log`, SSH is installed for it).
