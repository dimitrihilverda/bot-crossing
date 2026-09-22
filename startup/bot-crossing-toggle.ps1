# Bot Crossing — handmatige toggle (portable; werkt vanuit elke clone).
#   1e klik: start de server (verborgen) en opent de website fullscreen in een eigen venster.
#   2e klik: vraagt of je wilt afsluiten, en stopt dan de server + sluit het venster.
# Het snelkoppeling-icoon wisselt mee: grijs = uit, groen = draait.
$ErrorActionPreference = 'SilentlyContinue'

# ── locatie & config (afgeleid, niet hardcoded) ─────────────────────────────────────────
$here    = $PSScriptRoot                       # ...\startup
$project = Split-Path -Parent $here            # de repo-root van deze clone
$url     = 'http://127.0.0.1:5274'
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

$edge = 'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe'
if (-not (Test-Path $edge)) { $edge = 'C:\Program Files\Microsoft\Edge\Application\msedge.exe' }

# optionele per-machine override (gitignored): mag $targetDevice / $node / $edge / $url zetten
$localCfg = Join-Path $here 'toggle.local.ps1'
if (Test-Path $localCfg) { . $localCfg }

Add-Type -AssemblyName System.Windows.Forms

if (-not $node -or -not (Test-Path $node)) {
    [System.Windows.Forms.MessageBox]::Show(
        "Node.js niet gevonden. Installeer Node 22.13+ (of zet node.exe op je PATH) en probeer opnieuw.",
        'Bot Crossing', 'OK', 'Error') | Out-Null
    return
}

function Server-Running {
    return [bool](Get-NetTCPConnection -LocalPort 5274 -State Listen -ErrorAction SilentlyContinue)
}

# Zet het icoon van elke "Bot Crossing.lnk" (Desktop + evt. taakbalk-pin) op de opgegeven .ico
# en laat Explorer de icoon-cache verversen zodat het zichtbaar meewisselt.
function Set-ShortcutIcon([string]$icoPath) {
    if (-not (Test-Path $icoPath)) { return }
    $targets = @(
        (Join-Path ([Environment]::GetFolderPath('Desktop')) 'Bot Crossing.lnk'),
        (Join-Path $env:USERPROFILE 'OneDrive\Desktop\Bot Crossing.lnk'),
        (Join-Path $env:APPDATA 'Microsoft\Internet Explorer\Quick Launch\User Pinned\TaskBar\Bot Crossing.lnk')
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

if (Server-Running) {
    # ---- Draait al -> vragen en afsluiten ----
    $answer = [System.Windows.Forms.MessageBox]::Show(
        'Bot Crossing draait. Server en venster nu afsluiten?',
        'Bot Crossing', 'YesNo', 'Question')
    if ($answer -eq 'Yes') {
        # Sluit het kolonie-venster (Edge-app op deze URL)
        Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" |
            Where-Object { $_.CommandLine -like '*127.0.0.1:5274*' } |
            ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
        # Stop de server (eigenaar van poort 5274/5275)
        foreach ($port in 5274, 5275) {
            Get-NetTCPConnection -LocalPort $port -State Listen -ErrorAction SilentlyContinue |
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

    Start-Process -FilePath $node -ArgumentList 'server/serve.mjs' -WorkingDirectory $project -WindowStyle Hidden
    for ($i = 0; $i -lt 60 -and -not (Server-Running); $i++) { Start-Sleep -Milliseconds 500 }

    Start-Process -FilePath $edge -ArgumentList @(
        "--app=$url",
        "--user-data-dir=$profile",
        "--window-position=$x,$y",
        "--window-size=$w,$h",
        '--start-fullscreen',
        '--no-first-run',
        '--no-default-browser-check'
    )
    Set-ShortcutIcon $iconOn   # groen: server draait
}
