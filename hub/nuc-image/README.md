# Bot Crossing hub — bootable-USB NUC installer

Boot a bare Intel NUC once from a prepared USB and it installs itself into the running team-hub
wall — Ubuntu, Node/Chromium/Tailscale, the app built and running in hub mode, autologin, and a
service that keeps it up forever. **No keyboard or mouse on the NUC.** You configure wifi and the
hub settings from your phone.

This automates the manual guide in [`../README.md`](../README.md).

> **This wipes the NUC's internal disk.** The install is whole-disk. Nothing else on it survives.

There are two ways to build the stick. **The headless one (A) is the recommended path** — nothing
plugged into the NUC. Method B pre-fills everything on your PC instead and needs one keypress at
the NUC's boot menu.

---

## A. Headless — configure from your phone (recommended)

### What you need
- The target **NUC6i3SYK** (the NUC6CAY Celeron is too weak — see `../README.md`).
- A **USB stick** (≥ 8 GB).
- A **Linux machine or WSL (Ubuntu 24.04)** to build the ISO — it needs `xorriso`, `curl`,
  `openssl`, and `apt-get` (to fetch the offline hotspot packages so the deb set matches the
  target). On Windows: install WSL Ubuntu (`wsl --install -d Ubuntu-24.04`) and build in there.
- A **Tailscale account** (you approve the hub by scanning a QR — no key to handle).

### Build the ISO
```bash
cd hub/nuc-image
cp iso.env.example iso.env      # set the account password; repo defaults are fine
./build-iso.sh                  # in WSL/Linux. Downloads the Ubuntu ISO if you don't pass one.
```
Output: `build/bot-crossing-hub.iso`. `iso.env` holds no wifi/teammate/Tailscale data — those come
from your phone — only the NUC account and where to clone the app.

### Flash + boot
Write `build/bot-crossing-hub.iso` to the stick (**Ventoy**: copy the `.iso` on; or **Rufus** /
**balenaEtcher** / `dd`). Put it in the NUC, power on, pick the USB from the boot menu (F10). It
installs unattended — **no keypress** — and reboots.

### Set it up from your phone
On first boot the NUC raises its own wifi network **`BotCrossing-Setup`**:
1. On your phone, join `BotCrossing-Setup`. A setup page opens automatically (like a hotel login).
2. Enter your **wifi** (or tick "on ethernet"), the **teammates** to show (`Name=100.x` per line),
   and the hub's name. Tap **Set up the wall**.
3. The hotspot disappears and the NUC joins your wifi. Reconnect your phone to your normal wifi.
4. The NUC installs everything (a few minutes), then shows a **QR on the wall screen** — scan it
   and approve **this hub** in the Tailscale app. It then reboots into the live wall.

That's it — no keyboard ever touched the NUC. To change wifi or teammates later, see
**Reconfigure from your phone** below.

---

## B. Pre-filled — everything set on your PC (one keypress at the NUC)

Use this if you'd rather not build an ISO. You fill in a config on your PC; the NUC boots a normal
Ubuntu USB plus a tiny seed volume, and you add one word at its boot menu.

```bash
cd hub/nuc-image
cp config.env.example config.env    # wifi, teammates, Tailscale pre-auth key, account
./build-usb.sh                      # Linux/macOS or Git Bash on Windows -> build/{user-data,meta-data}
```
Then:
1. Write the **Ubuntu Server 24.04** ISO to a USB (Ventoy/Rufus/dd).
2. Put `build/user-data` + `build/meta-data` on a **FAT32 volume labelled `CIDATA`** (a second
   stick, or a small extra partition on a Ventoy stick).
3. Boot the NUC from the Ubuntu USB; at the **GRUB** menu press **`e`**, add ` autoinstall` to the
   end of the `linux` line, **Ctrl-X**. (That one keypress is Ubuntu's safety catch for an
   unattended disk wipe.)

It then installs and provisions the same way, using the values you put in `config.env`
(Tailscale via the pre-auth key rather than a QR).

---

## Verify / debug (either method)

SSH is installed, so you watch from your desk — `ssh <user>@<hostname-or-100.x>`:
```bash
sudo tail -f /var/log/bch-firstboot.log     # headless setup (portal, wifi, Tailscale)
sudo tail -f /var/log/bch-provision.log     # the install/build steps
tailscale status
journalctl --user -u bot-crossing-hub -f    # the wall service, once it's up (as the kiosk user)
```
Re-run setup after a failed first boot: `sudo rm /opt/bch-setup/.provisioned && sudo systemctl start bch-firstboot.service`.

## Reconfigure from your phone (later)

To change wifi or the teammate list without a keyboard, SSH in (or from the wall) and:
```bash
sudo rm -f /opt/bch-setup/pending.json /opt/bch-setup/.provisioned
sudo systemctl start bch-firstboot.service
```
The `BotCrossing-Setup` hotspot comes back so you can re-enter everything from your phone.

## Troubleshooting

- **`BotCrossing-Setup` never appears:** the NUC's wifi may be missing the offline hotspot
  packages — build the ISO on **Ubuntu 24.04** (WSL) so the `.deb` set matches, or plug in ethernet
  for the first boot (setup then uses defaults; add teammates later). `journalctl -u bch-firstboot`.
- **A teammate's colony never shows:** they must have **sharing on** *and* the hub's `100.x` under
  *Allow a screen / hub to read me* — an allowed reader still sees only what's shared. See section 4
  of [`../README.md`](../README.md). `tailscale ping <their-100.x>` proves the path.
- **Blank wall after Tailscale:** check `journalctl --user -u bot-crossing-hub` as the kiosk user.
  Chromium is a snap on Ubuntu; `sudo snap refresh chromium` or install a non-snap Chromium, reboot.
- **`build-iso.sh` fails at repackaging:** your `xorriso` is likely too old to report the source
  ISO's boot layout — install a current xorriso (`sudo apt-get install xorriso`), or use method B
  (no ISO surgery, one keypress).
- **Wall stutters:** set render quality to **Low** once in Settings → quality picker; the
  persistent Chromium profile remembers it.

## What this does and doesn't change

The wall is read-only by construction — it only *reads* teammates' colonies. Taking over or writing
to another person's session is the deferred Fase 2 and is not part of this image.
