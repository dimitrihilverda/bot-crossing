---
from: chantal
to: dimitri
date: 2026-09-09
---

Written by Chantal's assistant after reading `shared-colonies` through `7f6c8f6`. Two things,
one of them worth a decision.

## The per-session allowlist is the right fix

`7f6c8f6` closes most of what we were going to raise. It is enforced server-side at
`server/api.mjs:414` and the default is `shared: []` at `server/api.mjs:79`, so sharing can be
on and still hand out nothing until something is explicitly ticked. That is the correct
default and it is real rather than cosmetic — we checked that the filter is not just UI.

## But the guest listener still does not check who is asking

`server/guest.mjs:52` binds `0.0.0.0` and there is no origin check anywhere in that file — no
`req.socket.remoteAddress` test, nothing compared against `network.neighbors`. So whatever is
in the allowlist is readable by **any** host on the LAN that can reach the port, not only by a
configured neighbour.

We are not sure whether that is deliberate. The argument for leaving it is real: the file's own
comment says the security story is the shape of the socket rather than a permission check, and
an allowlist plus a private-profile firewall rule is already two gates. If the intent is "what
I tick is effectively public on this LAN", then this is working as designed and the answer is
to say so in the docs so nobody assumes otherwise.

If it is not deliberate, the cheapest close looks like comparing `req.socket.remoteAddress`
against the hosts in `network.neighbors` before answering — it needs no key management, no
protocol change, and it fails in the safe direction. A shared secret in the neighbour poll
would be stronger but adds a thing to distribute.

Chantal's side of it: her thread titles and previews carry client names and environment names,
so she wants to know which of the two it is before she ticks anything.

## The installer would break an existing install

`install/install-bot-crossing.ps1` installs to `%LOCALAPPDATA%\BotCrossing\bot-crossing` and
adds its own Startup entry. Chantal already runs this repo from `C:\PhpstormProjects\bot-crossing`
with a logon launcher of her own on port 5274, so double-clicking the installer would give her a
**second** copy and a second autostart, both wanting 5274 — and two working directories to keep
updated.

That is not a bug in the installer. It is exactly right for onboarding a colleague from
nothing, which is what it says it is for. It is just missing a line for the case it does not
cover. Something like this in `install/README.md` would have saved us the read:

> Already have a clone you work in? Do not run this. Use `git pull` in that clone instead —
> the installer is for a machine with nothing on it yet.

We did not run it, so this is from reading rather than from breaking anything.

## Heads-up

A `moving-in-theme` branch will appear on the fork: a re-theme of the colony into Moving-In's
own work — houses instead of habitats, crew assembling rental furniture instead of building
rockets. It is Chantal's, it is based on `shared-colonies` so it carries your sharing work, and
it runs on port **5280** to stay clear of 5274, 5275 and 5276. Not something you need to review
unless you want to; the design and plan are in `docs/superpowers/` on that branch.
