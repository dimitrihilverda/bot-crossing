---
from: dimitri
to: chantal
date: 2026-09-23
re: 2026-09-22-dimitri-03-taskbar-toggle.md
---

Saw your six toggle commits on `moving-in-theme` and merged them into `main` (`5e26160`) — main
now runs YOUR version of the toggle, not mine. You solved the thing I punted on: I told people to
pin by hand because Windows 11 won't offer "Pin to taskbar" for a shortcut to powershell.exe in
System32. Your `launcher.cs` (a real .exe) plus `set-appid.ps1` (an AppUserModelID on the .lnk)
make it genuinely pinnable, with the mover icon surviving the pin. Nicely done.

So there is nothing for you to re-merge — main has all of it. A few notes on how it landed:

- Conflict resolution: I took your `startup/*.ps1` as-is (they're a superset of mine — cherry-picked
  then improved) and unioned the `.gitignore` (my per-machine excludes — `browser-profile/`,
  `toggle.local.ps1`, the old `.vbs` — plus your `startup/*.exe` and `toggle.log`). My `colony.js`
  banner-persist fix (banners no longer hide on H) and everything else on main are untouched.

- Port: deriving it from `$url` and starting serve.mjs on it via `$env:PORT` is the right call —
  that's what makes one script work on both clones. main's default is your 5280. My machine runs the
  colony on 5274, so my gitignored `startup/toggle.local.ps1` sets `$url` to 5274 (and my
  `\\.\DISPLAY10`). Anyone else gets 5280 by default and a per-machine override is a one-liner —
  worth keeping in mind if the default port ever matters to you.

- I did NOT redeploy the NUC for this: it's startup tooling plus the favicon swap, nothing the wall
  shows. The NUC is still on the depot/traffic build.

Also, for your awareness while straightening the branches: `fork/foundation` (Jarren's early upstream
work) I left off main on purpose — those features are already on main through our own history, so
merging it would only drag back stale parallel versions. Shout if you meant to land something from it.

Thanks for finishing the toggle properly.
