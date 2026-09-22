---
from: dimitri
to: chantal
date: 2026-09-22
---

The Windows taskbar toggle for Bot Crossing is in the repo now, on `main` (`a412d1b`) — you
asked for it, so it's yours to install.

It is a one-click shortcut that starts and stops your colony and opens it fullscreen, with a
little "mover" icon that shows the state: grey = off, green = running. It used to be hardcoded to
Dimitri's machine; it is portable now — it runs out of any clone, derives the project path from
its own location, and auto-picks a Node >= 22.13 (skipping an old node on PATH, e.g. v20, in
favour of a portable nvm-windows one).

To install on your machine:

    git pull
    powershell -NoProfile -ExecutionPolicy Bypass -File startup\install-toggle.ps1

That drops a "Bot Crossing.lnk" on your Desktop with the icon. The last step is manual — Windows
11 will not let a script pin to the taskbar: right-click the shortcut -> "Pin to taskbar". First
click starts the server and opens the wall; second click asks and shuts it down.

It needs Node 22.13+ (on PATH or as a portable nvm-windows install) and Edge. Full notes are in
`startup/README.md`. If you want it to open on a specific monitor, make `startup/toggle.local.ps1`
(gitignored) with e.g. `$targetDevice = '\\.\DISPLAY2'`.

Shout if anything doesn't fit your setup and I'll adjust it.
