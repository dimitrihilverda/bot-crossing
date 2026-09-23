# Moving-In Crossing installeren met je Claude

> **Voor mensen.** Plak deze ene regel in je Claude Code-sessie:
>
> ```text
> Haal https://raw.githubusercontent.com/dimitrihilverda/bot-crossing/main/install/CLAUDE-SETUP.md op en volg die instructies om Moving-In Crossing op deze machine te installeren en op de team-hub aan te sluiten. Vraag me om toestemming waar de instructies dat zeggen.
> ```
>
> Kan je Claude geen URL's ophalen, plak dan de hele inhoud van dit bestand. Het werkt op
> macOS, Windows en Linux. Alles hieronder is geschreven voor je Claude.

---

Installeer **Moving-In Crossing** op deze machine en sluit hem aan op de team-wall van Moving-In.

Moving-In Crossing is een 3D-dorpje waarin elke Claude Code-sessie een verhuizer is (Codex en
Cursor worden ook herkend). Het leest je sessies zelf uit `~/.claude`, dus daar hoeft niets voor
ingesteld te worden. De **hub** is een scherm op kantoor (een Intel NUC) dat de colonies van het
hele team samen toont, met een "NEEDS YOU"-bord voor sessies die op iemand wachten.

## Spelregels
- Vraag mij om toestemming voordat je software installeert (Node, Tailscale, Homebrew), de
  firewall aanpast, autostart toevoegt of iets op de gedeelde hub wijzigt. Zeg kort wat je gaat doen.
- Deel niets zonder dat ik zelf kies wát. Wat ik deel, zien collega's en de wall:
  sessietitels, repo-namen en mappen, en status. De inhoud van gesprekken gaat niet mee.
- De hub-configuratie is van het hele team. Voeg daar alleen mijn eigen neighbour-regel toe en
  verander verder niets.
- Klopt iets hieronder niet met wat je aantreft? Stop dan en meld het, in plaats van te gokken.

## Vaste gegevens
- Repo: `https://github.com/dimitrihilverda/bot-crossing`, branch **`main`**. Gebruik niet
  `shared-colonies`, dat is een verouderde branch.
- Node **22.13 of nieuwer**.
- Lokale web-UI: `http://127.0.0.1:5280` (macOS/Linux) of `http://127.0.0.1:5274` (via de
  Windows-installer).
- Guest-poort (hier leest de hub je colony uit): **TCP 5275**. Die moet via Tailscale bereikbaar zijn.
- Team-hub (Tailscale-IP `100.78.62.7`):
  - wall: `http://100.78.62.7:5274/?hub=1`
  - configuratie: `http://100.78.62.7:5274/` (zonder `?hub=1`)
- Netwerk: alleen via **Tailscale**. De FortiClient-VPN blokkeert verkeer tussen clients.

## Stappen

### 0. Kijk wat er al is
Stel vast welk OS dit is (macOS, Windows of Linux). Staat er al een clone van `bot-crossing`?
Gebruik die dan (`git checkout main && git pull`) en maak geen tweede.

### 1. Tailscale
Draai `tailscale status`. Is Tailscale niet geïnstalleerd of niet verbonden? Installeer het via
https://tailscale.com/download (op macOS kan het ook via de App Store) en log in op het
Moving-In-tailnet. Zit ik nog niet in dat tailnet, vraag dan Dimitri om een uitnodiging en wacht.
- Noteer mijn IPv4-adres met `tailscale ip -4` (begint met `100.`). Op macOS staat de CLI in de
  app zelf: `/Applications/Tailscale.app/Contents/MacOS/Tailscale ip -4`. Je kunt het adres ook
  aflezen via het menubalk-icoon.
- Test de hub: `curl -s http://100.78.62.7:5274/api/neighbors` moet JSON teruggeven. Lukt dat
  niet, dan kan deze machine de hub niet bereiken. Meld dat en stop.

### 2. Node 22.13+
Controleer met `node -v`. Is Node te oud of ontbreekt het:
- macOS: `brew install node`, of de LTS-installer van https://nodejs.org
- Linux: nvm, of de pakketbron van nodesource
- Windows: dat regelt de installer in stap 3

### 3. Ophalen, bouwen, starten
**macOS / Linux:**
```bash
git clone https://github.com/dimitrihilverda/bot-crossing.git ~/bot-crossing
cd ~/bot-crossing
npm install
npm run build
npm run serve
```
`npm run serve` blijft draaien op `http://127.0.0.1:5280`.

**Windows zonder eigen clone:** gebruik de installer (die regelt een portable Node, autostart en
de firewall):
```powershell
irm https://raw.githubusercontent.com/dimitrihilverda/bot-crossing/main/install/install-bot-crossing.ps1 -OutFile $env:TEMP\install-bot-crossing.ps1
powershell -ExecutionPolicy Bypass -File $env:TEMP\install-bot-crossing.ps1 -Branch main
```
Draai hem als administrator, dan worden de firewall-regels meteen toegevoegd. Stond er al een
installatie van een oudere installer? Deze zet hem in-place over naar `main`, en de colony,
instellingen en neighbours blijven staan. Heeft deze Windows-machine een eigen clone? Gebruik de
installer dan niet, maar doe `git pull`. Voor een aan/uit-knop in de taakbalk: zie
`startup/README.md`. Kies de autostart van de installer óf de taakbalk-knop, niet allebei.

Controleer daarna of de web-UI een dorp met verhuizers laat zien (mijn eigen sessies).

### 4. Firewall (binnenkomend TCP 5275)
- **macOS:** de eerste keer dat delen aangaat, vraagt macOS of `node` binnenkomende verbindingen
  mag accepteren. Kies "Sta toe". Staat "Blokkeer alle inkomende verbindingen" aan? Zet dat dan
  uit, of voeg node toe onder Systeeminstellingen → Netwerk → Firewall → Opties.
- **Windows:** de installer voegt de regels toe als hij als administrator draait. Zo niet, dan
  print hij ze uit zodat je ze zelf kunt plakken.
- **Linux:** bijvoorbeeld `sudo ufw allow 5275/tcp`.

### 5. Delen instellen (dat doe ik zelf in de app, jij begeleidt me)
Open de web-UI, druk op **S** (Settings) en ga naar de sectie **Shared colonies**:
1. **Colony name**: mijn naam zoals collega's die zien, bijvoorbeeld mijn voornaam.
2. **Share on the network**: aan.
3. **Allow a screen / hub to read me**: voeg `100.78.62.7` toe.
4. Kies wat ik deel. Zonder die keuze deelt de app niets, ook niet als delen aan staat. Klik een
   wijk (repo) aan en kies **Share with others**, of klik een losse verhuizer (sessie) aan en kies
   **Share**. Die knoppen verschijnen pas als delen aan staat. Laat mij kiezen welke repo's.

### 6. Op de hub komen
De hub moet mij als neighbour kennen. Vraag mij welke route ik wil:
- **a) Veiligst:** stuur Dimitri mijn colony-naam en mijn Tailscale-IP. Hij voegt me toe.
- **b) Zelf:** open `http://100.78.62.7:5274/` (zonder `?hub=1`), druk op **S**, ga naar
  **Shared colonies** → **Neighbours**, vul als host mijn Tailscale-IP in en als poort `5275`, en
  voeg toe. Doe het in één keer en sluit het tabblad daarna. Laat de planeet, de instellingen en
  de andere neighbours ongemoeid.

### 7. Controleren
- Lokaal: `curl -s http://127.0.0.1:5275/guest/info` geeft JSON terug met `"app":"bot-crossing"`.
- Hub: `curl -s http://100.78.62.7:5274/api/neighbors` toont mijn colony met `"online": true`,
  binnen ongeveer 15 seconden na het toevoegen. Of open `http://100.78.62.7:5274/?hub=1`: daar sta
  ik dan onder **COLONIES · LIVE**.
- Sta ik er wel, maar als offline? Kijk dan in mijn eigen app onder Settings → Shared colonies →
  **Tried to visit you**. Staat daar een adres, dan probeerde de hub mij te lezen maar werd hij
  geweigerd. Eén klik voegt dat adres toe. Staat daar niets, controleer dan de firewall (stap 4)
  en of de app nog draait.

### 8. Optioneel: automatisch starten (vraag het eerst)
Zo blijf ik op de wall staan zonder dat er een terminal open hoeft.
- **macOS:** maak een LaunchAgent `~/Library/LaunchAgents/nl.moving-in.crossing.plist` die
  `<volledig pad uit command -v node> server/serve.mjs` draait, met de clone als werkmap. Zet
  `EnvironmentVariables` op `PORT=5280`, en `RunAtLoad` en `KeepAlive` op true. Laat de logs naar
  `~/Library/Logs/moving-in-crossing.log` gaan. Draai eerst `npm run build`, en daarna
  `launchctl load -w` op de plist.
- **Linux:** een systemd user-unit met hetzelfde idee (`systemctl --user enable --now …`).
- **Windows:** de installer zet al een autostart bij het inloggen.

### 9. Later bijwerken
Draai `git pull && npm install && npm run build` en herstart daarna de server. Op Windows met de
installer: draai de installer gewoon opnieuw.

## Tot slot
Geef me een korte samenvatting: het OS, het pad van de clone, mijn colony-naam, mijn Tailscale-IP,
wat ik deel, of ik online op de hub sta, en wat er eventueel nog openstaat.
