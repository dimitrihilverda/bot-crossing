# Bot Crossing hub — NUC setup

Turns a spare Intel NUC into an always-on office wall display: the existing Bot Crossing
app running in **hub mode** (`?hub=1`), a read-only view that aggregates every teammate's
colony into one NEEDS YOU board plus a per-colony status strip. This is the deployment
guide for that device — the hub-mode UI itself is regular app code (`src/ui/hub.js`), not
covered here.

## Hardware

- **Use the NUC6i3SYK** (Core i3-6100U, Intel HD 520). Its integrated graphics have solid
  open-source Linux drivers and are enough for the 3D colony view at the **Low** quality
  preset.
- **Do not use the NUC6CAY** (Celeron). It is too weak for smooth WebGL and should stay a
  reserve/spare rather than the wall device.

## 1. Install the OS

A lean Linux, not Windows — this is a 24/7 unattended display, and a minimal Linux install
needs far less babysitting than Windows does for that job.

- **Debian or Ubuntu Server, minimal install**, or a kiosk-oriented distro such as DietPi.
- Enable auto-login on the console/desktop session the kiosk will run under — systemd
  brings the service up, but Chromium still needs a running graphical session (X11 or
  Wayland) to open a window into.
- Give the account a normal username; the setup below assumes commands are run as that
  user, not root, except where noted.

## 2. Install Node 22, Chromium, Tailscale

```bash
# Node 22 (NodeSource) — the app's package.json asks for >=22.13
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Chromium
sudo apt-get install -y chromium || sudo apt-get install -y chromium-browser

# Tailscale
curl -fsSL https://tailscale.com/install.sh | sh
sudo tailscale up
```

`tailscale up` prints a login URL the first time — open it on another device to approve
this machine joining the tailnet. Once it's up, note the NUC's Tailscale IP:

```bash
tailscale ip -4   # → something like 100.x.y.z
```

That `100.x` address is how every teammate's colony reaches the hub, and how the hub
reaches theirs — the same transport already used between teammates' own machines.

## 3. Clone and build the app

```bash
git clone <repo-url> ~/bot-crossing
cd ~/bot-crossing
git checkout main
npm install
npm run build
```

The hub always deploys from `main` — team-hub work merges there first (see the plan's
"After the tasks" section), so there's nothing branch-specific to remember here.
`npm run build` produces `dist/`, which `server/serve.mjs` serves; `hub/start-hub.sh`
refuses to start without it.

To pick up a later update: `git pull && npm install && npm run build`, then restart the
service (step 6).

## 4. Let the hub read every teammate's colony

Sharing is opt-in and one-directional here — a teammate allows the hub to read them
without the hub needing to be added back as a "colony" on their own map (that would make
an always-on reader look like a dead neighbour whenever the wall display itself isn't
polling them, which it never does).

**Each teammate**, on their own machine: open **Settings → Shared colonies → Allow a
screen / hub to read me**, and add the NUC's `100.x` Tailscale IP there.

**On the hub**, add every teammate as a neighbour so their threads flow into `/api/threads`
and get merged into the board. Either through the UI (Settings → Shared colonies → add each
teammate's `100.x:5275`, port `5275` being the guest-API port every colony listens on when
sharing is on), or by seeding `data/colony.json` directly before first boot:

```json
{
  "version": 2,
  "network": {
    "colonyName": "Hub",
    "share": false,
    "neighbors": [
      { "name": "Dimitri", "host": "100.x.x.1", "port": 5275 },
      { "name": "Chantal", "host": "100.x.x.2", "port": 5275 }
    ],
    "shared": [],
    "allowedReaders": []
  }
}
```

The hub itself does not need `share: true` — nobody reads the hub, it only reads others —
so `neighbors` is the only part of this file that matters here.

## 5. Quality preset

Default the hub's own view to the **Low** preset (Settings → the quality picker) — the HD
520 handles the 3D colony comfortably there. Try **Balanced** if it stays smooth; if not,
drop back to Low.

`hub/start-hub.sh` runs Chromium against a persistent profile
(`--user-data-dir`, default `~/.config/bot-crossing-hub-chrome`), not `--incognito`, so
whatever you pick here — like the mute toggle on the hub's own alert sound — survives a
restart of the kiosk (a crash, a reboot, `systemctl restart`) instead of resetting to the
app's defaults every time. Both live in `localStorage`
(`botcrossing.settings.v1` and `botcrossing.hub.muted` respectively), not
`data/colony.json`, which is why the profile needs to persist for either to stick.

## 6. Enable the service

```bash
cd ~/bot-crossing
mkdir -p ~/.config/systemd/user
cp hub/bot-crossing-hub.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now bot-crossing-hub.service
```

If this account isn't kept logged in interactively (no auto-login, or the unit should
survive logout), also run once as root so the user's systemd instance starts at boot:

```bash
sudo loginctl enable-linger <username>
```

Check it came up:

```bash
systemctl --user status bot-crossing-hub.service
journalctl --user -u bot-crossing-hub.service -f
```

The unit restarts forever (`Restart=always`, no `StartLimitIntervalSec` cooldown) — a
Chromium crash or a reboot brings the wall back on its own.

## Troubleshooting

- **Blank window / "connection refused":** the server didn't come up before Chromium
  tried to load it. Check `journalctl --user -u bot-crossing-hub.service` — `start-hub.sh`
  logs when it's waiting for the port and gives up after 60s (`BOT_CROSSING_PORT_WAIT_SECS`
  to change that).
- **"no dist/" error:** run `npm install && npm run build` in the checkout — the service
  does not build the app itself.
- **"neither chromium nor chromium-browser":** install one of the two, or set
  `BOT_CROSSING_CHROMIUM` in the service's `Environment=` to the exact binary name/path.
- **A teammate's colony never appears / stays offline:** confirm they added the hub's
  `100.x` IP under *Allow a screen / hub to read me*, and that the hub's neighbour entry uses
  their `100.x` IP and port `5275`. `tailscale ping <their-100.x-ip>` proves the tailnet
  path works before blaming the app.
- **Service stays inactive / never starts:** this unit is keyed off `graphical-session.target`
  (`After=`/`PartOf=`/`WantedBy=`), which only activates under a systemd-aware display/login
  manager (gdm, sddm, lightdm). A bare `startx`/`.xinitrc` auto-login does not activate it on
  its own. Check `systemctl --user status graphical-session.target` — if it isn't `active`,
  either switch the auto-login to a login manager, or have the session startup (`.xinitrc` or
  equivalent) run `systemctl --user start graphical-session.target` itself before the unit is
  expected to come up.
- **Testing the merge/HUD without teammates or a NUC handy:** `hub/dev-two-colonies.mjs`
  spins up two fake colonies plus a hub on one machine, entirely on loopback.

## Out of scope here

Taking over or writing to another person's session, and anything auth beyond the tailnet +
`allowedReaders`, is a separate spec (Fase 2) — the hub is read-only by construction and
this guide does not change that.
