# Bot Crossing hub — bootable-USB NUC installer

Boot a bare Intel NUC once from a prepared USB stick and it installs itself into the running
team-hub wall: Ubuntu Server, Node/Chromium/Tailscale, the app built and running in hub mode,
autologin, and the systemd service that keeps it up forever. No per-step commands on the NUC.

This automates the manual guide in [`../README.md`](../README.md) — read that if you want to
know what each step does or you'd rather set the NUC up by hand.

> **This wipes the NUC's internal disk.** The autoinstall does a whole-disk install. Nothing
> else on that machine survives.

## What you need

- The target **NUC6i3SYK** (the Celeron NUC6CAY is too weak — see `../README.md`).
- A **USB stick** for the Ubuntu installer (≥ 4 GB), and either a **second small stick** or a
  spare partition for the tiny `CIDATA` seed volume.
- The **Ubuntu Server 24.04 LTS** ISO — <https://ubuntu.com/download/server> (get the LTS
  "manual server installation" ISO).
- A **Tailscale account** and one **reusable pre-auth key**
  (<https://login.tailscale.com/admin/settings/keys> → Generate auth key → make it reusable).
- Wired ethernet on the NUC is strongly recommended. Wifi works (fill in `WIFI_*`) but ethernet
  is one less thing to go wrong on an always-on display.

## 1. Fill in the config

```bash
cd hub/nuc-image
cp config.env.example config.env
# edit config.env: account + password, your Tailscale pre-auth key, and each teammate's
# Name=100.x Tailscale IP.
```

`config.env` is gitignored — it holds your Tailscale key. Keep it (and the CIDATA stick) private;
use a *reusable but revocable* key so you can re-flash later and kill the key if a stick is lost.

## 2. Build the seed

```bash
./build-usb.sh
```

Runs on Linux, macOS, or **Git Bash on Windows** (it only needs `bash` + `openssl`, both of which
Git for Windows ships). It writes `build/user-data` and `build/meta-data`. It refuses to run
while the password is still the default.

If your CIDATA volume is already mounted, hand it to the script to copy straight onto it:

```bash
./build-usb.sh config.env /d          # Git Bash, drive D:
./build-usb.sh config.env /media/you/CIDATA
```

## 3. Make the two USB volumes

**The Ubuntu installer stick** — write the ISO with any of:
- **Ventoy** (easiest on Windows): install Ventoy on the stick, then just copy the `.iso` onto it.
- **Rufus** (Windows) or **balenaEtcher** (any OS): flash the ISO to the stick.
- `dd` (Linux/macOS): `sudo dd if=ubuntu-24.04-live-server-amd64.iso of=/dev/sdX bs=4M status=progress`.

**The CIDATA seed volume** — a small **FAT32** volume whose **label is exactly `CIDATA`**, holding
`build/user-data` and `build/meta-data` at its root. Two ways:
- **Second stick:** format a spare stick FAT32, label it `CIDATA`, copy both files on.
- **One Ventoy stick:** Ventoy leaves free space — create a small extra partition there, format
  it FAT32, label it `CIDATA`, copy both files on. Now one stick carries both.

(The label matters: Ubuntu's cloud-init finds the autoinstall config by looking for a volume
labelled `CIDATA`.)

## 4. Boot the NUC and start the install

1. Insert the stick(s), power on, and pick the USB from the boot menu (tap F10 on a NUC).
2. At the Ubuntu **GRUB** menu, highlight *Try or Install Ubuntu Server*, press **`e`**.
3. Find the line starting `linux` and add ` autoinstall` at its end.
4. Press **Ctrl-X** to boot.

That `autoinstall` word is Ubuntu's safety catch against an unattended disk wipe — it's the only
manual keystroke. From here it installs unattended, reboots, and on that first boot runs
`provision.sh` (Node/Chromium/Tailscale, clone + build, autologin, the hub service, `tailscale
up`), then reboots a final time straight onto the wall. Give it 10–20 minutes on first run.

## 5. Verify / debug

SSH is installed, so you can watch from your desk (`ssh <user>@<hostname-or-100.x>`):

```bash
# the provisioning log
sudo tail -f /var/log/bch-provision.log
# the wall service, once provisioning has finished and it has rebooted
systemctl --user -M <user>@ status bot-crossing-hub.service   # or: journalctl --user -u bot-crossing-hub -f (when logged in as the kiosk user)
tailscale status
```

To re-run provisioning after a failed first boot: `sudo rm /opt/bch-setup/.provisioned && sudo bash /opt/bch-setup/provision.sh`.

## Troubleshooting

- **A teammate's colony never appears:** they must have **sharing on** *and* the hub's `100.x`
  under *Allow a screen / hub to read me* — an allowed reader still sees only what's been shared.
  See section 4 of [`../README.md`](../README.md). `tailscale ping <their-100.x>` proves the path.
- **Blank screen, no wall:** check `journalctl --user -u bot-crossing-hub` as the kiosk user. If
  Chromium (a snap on Ubuntu) won't launch under the kiosk session, `sudo snap refresh chromium`
  or install a non-snap Chromium, then reboot. `start-hub.sh` waits up to 60s for the server.
- **Never joined the tailnet:** the pre-auth key may have expired or been single-use. Generate a
  fresh reusable key and `sudo tailscale up --authkey=…` once on the NUC.
- **Autoinstall didn't trigger** (it dropped to the normal interactive installer): the `CIDATA`
  volume wasn't found — check its label is exactly `CIDATA` and both files are at its root, and
  that you added `autoinstall` to the GRUB `linux` line.
- **Wall stutters:** set the render quality to **Low** once in Settings → the quality picker; the
  persistent Chromium profile remembers it. (The installer intentionally doesn't preset this.)

## What this does and doesn't change

The wall is read-only by construction — it only ever *reads* teammates' colonies. Taking over or
writing to another person's session is the deferred Fase 2 and is not part of this image.
