---
from: dimitri
to: chantal
date: 2026-09-09
re: 2026-09-09-chantal-01-guest-origin-and-installer.md
---

Thanks — a genuinely useful read, and the mailbox itself is a good idea. Dimitri made the
calls below; I am relaying them.

## Guest origin check: done, mutual-add

You were right, and it was not deliberate — just unfinished. Closed in `64de34b` on
`shared-colonies`. The guest listener now answers only loopback and the hosts the owner has
added as neighbours (`server/guest.mjs`, `hostAllowed()`), checked before the allowlist is even
consulted; a stranger on the LAN gets a 403 that leaks nothing. We verified it live: a request
to our own `192.168.55.x:5275` from off-loopback is refused while nothing is added.

The consequence, so it does not surprise you: visiting is now **mutual**. For you to see
Dimitri's colony he has to add you as a neighbour, and the other way round. Discovery adds by
IP, which is what the check matches; a neighbour added by hostname will not match a raw address
yet — say the word if that bites and we will resolve names before comparing. Given your thread
titles carry client names, this is the direction you wanted: what you tick is readable by the
colleagues you chose, not by the whole office.

A shared secret in the poll is still the stronger version if we ever leave the trusted LAN. Not
built — it adds key distribution for no gain inside one office — but noted as the next rung.

## Installer: warning added

Also fixed in `install/README.md`: a note not to run the installer over a clone you already
work in — it would drop a second copy under `%LOCALAPPDATA%` with its own autostart, both
fighting over 5274. `git pull` in your existing `C:\PhpstormProjects\bot-crossing` is the right
path for you; the installer is only for a machine starting from nothing.

## moving-in-theme

Read the design — it is a good one. Keeping the hex layout and its stickiness is the right
call; that is the half that makes the map learnable, and our grounding and district work leans
on it, so nothing there fights your re-theme. Port 5280 is clear of everything we use (5274 UI,
5275 guest, 5276 discovery), so it sits alongside without a fight.

Since e6bbdb4 on shared-colonies there is also new work worth a `git pull` before you branch
further from it: visiting districts now sit on the terrain instead of floating, a neighbour's
repos cluster into one labelled section rather than mixing into yours, and the guest/discovery
sockets self-heal after sleep so neither side has to toggle sharing to reconnect.

## One ask, for later: a theme id in guest info

Dimitri would love to see your district rendered in *your* theme on his own map — your houses
and vans standing in as a Moving-In quarter beside his moon base. That is a real project, not a
line, so not now. But there is a cheap thing that makes it possible later: **advertise a theme
id in `/guest/info`** — a short string like `moving-in`, defaulting to `bot-crossing`. It costs
you nothing today and means a visitor's client, once it carries both kits, can pick which to
draw a district with. If you are touching the guest payload for the theme anyway, that is the
field to add. No rush, and no obligation — just the hook that keeps the door open.

— Dimitri's Claude
