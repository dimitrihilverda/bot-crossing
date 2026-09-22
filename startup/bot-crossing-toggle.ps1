# Moving-In Crossing — handmatige toggle (portable; werkt vanuit elke clone).
#
# Dit is Dimitri's toggle, met één verschil: de poort wordt afgeleid uit $url in plaats van op
# drie plaatsen hardgecodeerd te staan (de draait-check, de venster-match en het afsluiten). Deze
# clone is het Moving-In-thema en draait op 5280, niet op 5274 — zonder die afleiding opende de
# toggle 5280 en keek en stopte hij 5274, wat een knop oplevert die wel start maar nooit ziet
# dat er iets draait. De rest is van hem.
#   1e klik: start de server (verborgen) en opent de website fullscreen in een eigen venster.
#   2e klik: vraagt of je wilt afsluiten, en stopt dan de server + sluit het venster.
# Het snelkoppeling-icoon wisselt mee: grijs = uit, groen = draait.
$ErrorActionPreference = 'SilentlyContinue'

# Een spoor, want dit script draait verborgen en slikt zijn fouten: zonder dit is "er gebeurt
# niets" alles wat je te zien krijgt. Eén regel per stap, steeds overschreven.
$log = Join-Path $PSScriptRoot 'toggle.log'
function Log([string]$m) {
    "$(Get-Date -Format 'HH:mm:ss')  $m" | Add-Content -Path $log -Encoding utf8 -ErrorAction SilentlyContinue
}
"--- $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') gestart ---" | Set-Content -Path $log -Encoding utf8 -ErrorAction SilentlyContinue
Log "pid $PID, gebruiker $env:USERNAME, cwd $((Get-Location).Path)"

# ── locatie & config (afgeleid, niet hardcoded) ─────────────────────────────────────────
$here    = $PSScriptRoot                       # ...\startup
$project = Split-Path -Parent $here            # de repo-root van deze clone
$url     = 'http://127.0.0.1:5280'   # deze clone: het Moving-In-thema
$name    = 'Moving-In Crossing'      # naam van de snelkoppeling (Bureaublad + taakbalk-pin)
$profile = Join-Path $here 'browser-profile'   # eigen Edge-profiel (gitignored)
$iconOff = Join-Path $here 'bot-crossing-off.ico'
$iconOn  = Join-Path $here 'bot-crossing-on.ico'
$targetDevice = ''  # '' = automatisch (tweede scherm). Zet bv. '\\.\DISPLAY2' voor een vaste monitor.

# node: kies een install van 22.13+ (de app vereist dat). Kandidaten: node op PATH, plus elke
# draagbare nvm-windows install; pak de eerste die de versie-eis haalt. Een oude PATH-node
# (bv. v20) wordt zo overgeslagen ten gunste van een nieuwere draagbare node.
function Resolve-Node {
    $min = [version]'22.13.0'
    $cands = @()
    $cmd = Get-Command node.exe -ErrorAction SilentlyContinue
    if ($cmd) { $cands += $cmd.Source }
    $nvm = Join-Path $env:APPDATA 'nvm'
    if (Test-Path $nvm) {
        Get-ChildItem $nvm -Directory -Filter 'v*' -ErrorAction SilentlyContinue |
            Sort-Object { try { [version]($_.Name.TrimStart('v')) } catch { [version]'0.0.0' } } -Descending |
            ForEach-Object { $cands += (Join-Path $_.FullName 'node.exe') }
    }
    foreach ($c in ($cands | Where-Object { Test-Path $_ } | Select-Object -Unique)) {
        try { $v = [version]((& $c -v).TrimStart('v')) } catch { $v = $null }
        if ($v -and $v -ge $min) { return $c }
    }
    return $null
}
$node = Resolve-Node
Log "node: $(if ($node) { $node } else { 'NIET GEVONDEN' })"
Log "PATH bevat nodejs: $([bool]($env:PATH -like '*nodejs*'))"

$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }
Log "edge: $(if (Test-Path $edge) { $edge } else { 'NIET GEVONDEN' })"

# optionele per-machine override (gitignored): mag $targetDevice / $node / $edge / $url zetten
$localCfg = Join-Path $here 'toggle.local.ps1'
if (Test-Path $localCfg) { . $localCfg }

# Poort uit $url, ná de override — zo verzet één regel in toggle.local.ps1 de hele toggle mee
# en niet alleen het venster. De gastluisteraar (waar een collega's kolonie binnenkomt) hangt
# niet aan die poort: die staat vast op 5275, tenzij BOT_CROSSING_GUEST_PORT hem verzet.
$port = if ($url -match ':(\d+)') { [int]$Matches[1] } else { 5274 }
$guestPort = if ($env:BOT_CROSSING_GUEST_PORT) { [int]$env:BOT_CROSSING_GUEST_PORT } else { 5275 }

Add-Type -AssemblyName System.Windows.Forms
Log "WinForms geladen: $([bool]([System.Windows.Forms.MessageBox]))"

# Een dialoog zonder eigenaar-venster mag Windows achter je andere vensters openen, en dat is
# precies wat er gebeurde: de knop leek niets te doen terwijl de vraag onzichtbaar stond te
# wachten. Een onzichtbaar topmost venster als eigenaar dwingt hem naar voren.
function Ask([string]$text, [string]$caption) {
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost        = $true
    $owner.ShowInTaskbar  = $false
    $owner.StartPosition  = 'CenterScreen'
    $owner.Size           = New-Object System.Drawing.Size(1, 1)
    $owner.Opacity        = 0
    $owner.Show()
    $owner.Activate()
    try {
        return [System.Windows.Forms.MessageBox]::Show($owner, $text, $caption, 'YesNo', 'Question')
    } finally {
        $owner.Close()
        $owner.Dispose()
    }
}
Log "url $url, poort $port, gastpoort $guestPort, project $project"

if (-not $node -or -not (Test-Path $node)) {
    $owner = New-Object System.Windows.Forms.Form
    $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.Opacity = 0
    $owner.Show(); $owner.Activate()
    [System.Windows.Forms.MessageBox]::Show($owner,
        "Node.js niet gevonden. Installeer Node 22.13+ (of zet node.exe op je PATH) en probeer opnieuw.",
        $name, 'OK', 'Error') | Out-Null
    $owner.Close(); $owner.Dispose()
    return
}

function Server-Running {
    return [bool](Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue)
}

# Zet het icoon van elke "Bot Crossing.lnk" (Desktop + evt. taakbalk-pin) op de opgegeven .ico
# en laat Explorer de icoon-cache verversen zodat het zichtbaar meewisselt.
function Set-ShortcutIcon([string]$icoPath) {
    if (-not (Test-Path $icoPath)) { return }
    $targets = @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) "$name.lnk"),
        (Join-Path $env:USERPROFILE "OneDrive\Desktop\$name.lnk"),
        (Join-Path $env:APPDATA "Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\$name.lnk")
    ) | Select-Object -Unique
    $sh = New-Object -ComObject WScript.Shell
    foreach ($lnk in $targets) {
        if (-not (Test-Path $lnk)) { continue }
        $sc = $sh.CreateShortcut($lnk)
        if ($sc.IconLocation -ne "$icoPath,0") { $sc.IconLocation = "$icoPath,0"; $sc.Save() }
    }
    # SHChangeNotify(SHCNE_ASSOCCHANGED, SHCNF_IDLIST, 0, 0) -> Explorer herleest de iconen
    $sig = '[System.Runtime.InteropServices.DllImport("shell32.dll")] public static extern void SHChangeNotify(int e, uint f, IntPtr a, IntPtr b);'
    $t = Add-Type -MemberDefinition $sig -Name BchShell -Namespace Bch -PassThru
    $t::SHChangeNotify(0x08000000, 0x0000, [IntPtr]::Zero, [IntPtr]::Zero)
}

Log "server draait al: $(Server-Running)"
if (Server-Running) {
    # ---- Draait al -> vragen en afsluiten ----
    $answer = Ask "$name draait. Server en venster nu afsluiten?" $name
    Log "antwoord op de afsluitvraag: $answer"
    if ($answer -eq 'Yes') {
        # Sluit het kolonie-venster (Edge-app op deze URL)
        Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
            Where-Object { $_.CommandLine -like "*127.0.0.1:$port*" } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        # Stop de server (eigenaar van de eigen poort en van de gastluisteraar)
        foreach ($p in $port, $guestPort) {
            Get-NetTCPConnection -LocalPort $p -State Listen -ErrorAction SilentlyContinue |
                Select-Object -ExpandProperty OwningProcess -Unique |
                ForEach-Object { Stop-Process -Id $_ -Force -ErrorAction SilentlyContinue }
        }
        Set-ShortcutIcon $iconOff   # weer grijs: server is uit
    }
} else {
    # ---- Draait niet -> starten en openen op een nieuw scherm ----
    $screens = [System.Windows.Forms.Screen]::AllScreens
    $target = $screens | Where-Object { $_.DeviceName -eq $targetDevice } | Select-Object -First 1
    if (-not $target) { $target = $screens | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X } | Select-Object -First 1 }
    if (-not $target) { $target = $screens[0] }
    $x = $target.Bounds.X; $y = $target.Bounds.Y
    $w = $target.Bounds.Width; $h = $target.Bounds.Height

    # serve.mjs leest zijn poort uit de omgeving en valt terug op 5274; het kind erft deze.
    $env:PORT = "$port"
    Log "server starten: $node server/serve.mjs in $project"
    Start-Process -FilePath $node -ArgumentList 'server/serve.mjs' -WorkingDirectory $project -WindowStyle Hidden
    for ($i = 0; $i -lt 60 -and -not (Server-Running); $i++) { Start-Sleep -Milliseconds 500 }
    Log "na wachten draait de server: $(Server-Running)"

    Start-Process -FilePath $edge -ArgumentList @(
        "--app=$url",
        "--user-data-dir=$profile",
        "--window-position=$x,$y",
        "--window-size=$w,$h",
        '--start-fullscreen',
        '--no-first-run',
        '--no-default-browser-check'
    )
    Log "venster geopend, icoon op groen"
    Set-ShortcutIcon $iconOn   # groen: server draait
}
