# Bot Crossing — Windows taakbalk-toggle

Een snelkoppeling die Bot Crossing op deze machine met één klik aan- en uitzet, met een
icoon dat de staat toont (grijs = uit, groen = draait).

- **1e klik:** start de server (verborgen) en opent de wall fullscreen in een eigen venster.
- **2e klik:** vraagt of je wilt afsluiten, en stopt dan de server + sluit het venster.

## Installeren

Vanuit je clone van de repo:

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File startup\install-toggle.ps1
```

Of: rechtsklik `startup\install-toggle.ps1` → **Uitvoeren met PowerShell**.

Dat maakt "Bot Crossing.lnk" op je Bureaublad met het mover-icoon. Laatste stap handmatig
(Windows 11 blokkeert programmatisch vastmaken): **rechtsklik de snelkoppeling → "Aan taakbalk
vastmaken"**. Wissel je later van icoon? Maak dan even los en opnieuw vast — de taakbalk cachet het.

## Vereist

- **Node 22.13+** — op je PATH, of als draagbare `nvm-windows`-install (wordt automatisch gevonden).
- **Microsoft Edge** (voor het app-venster).

## Aanpassen

- **Ander scherm:** standaard opent de wall op je tweede scherm. Voor een vaste monitor maak je
  `startup\toggle.local.ps1` (gitignored) met bv. `$targetDevice = '\\.\DISPLAY2'`.
- **Icoon opnieuw genereren of aanpassen:** `startup\make-mover-icon.ps1`.

## Bestanden

| bestand | wat |
|---|---|
| `bot-crossing-toggle.ps1` | de toggle (start/stop + icoonwissel) |
| `install-toggle.ps1` | maakt de Bureaublad-snelkoppeling |
| `make-mover-icon.ps1` | genereert `bot-crossing-off.ico` / `-on.ico` |
| `start-bot-crossing.ps1` | optionele autostart (leg 'm in `shell:startup`) |
| `toggle.local.ps1` | per-machine override (gitignored, optioneel) |
