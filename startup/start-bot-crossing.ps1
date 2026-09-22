# Bot Crossing autostart (portable; werkt vanuit elke clone).
# Start de server (verborgen) en opent een eigen browservenster fullscreen op de doelmonitor.
# Optioneel: leg een snelkoppeling naar dit script in shell:startup om het bij inloggen te draaien.
$ErrorActionPreference = 'SilentlyContinue'

$here    = $PSScriptRoot                       # ...\startup
$project = Split-Path -Parent $here            # de repo-root van deze clone
$url     = 'http://127.0.0.1:5274'
$profile = Join-Path $here 'browser-profile'
$targetDevice = ''  # '' = automatisch (tweede scherm). Zet bv. '\\.\DISPLAY2' voor een vaste monitor.

# node: kies een install van 22.13+ (de app vereist dat); sla een oude PATH-node over.
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

# optionele per-machine override (gitignored)
$localCfg = Join-Path $here 'toggle.local.ps1'
if (Test-Path $localCfg) { . $localCfg }

if (-not $node -or -not (Test-Path $node)) { return }  # stil falen bij autostart

Add-Type -AssemblyName System.Windows.Forms
$screens = [System.Windows.Forms.Screen]::AllScreens
$target = $screens | Where-Object { $_.DeviceName -eq $targetDevice } | Select-Object -First 1
if (-not $target) { $target = $screens | Where-Object { -not $_.Primary } | Sort-Object { $_.Bounds.X } | Select-Object -First 1 }
if (-not $target) { $target = $screens[0] }
$x = $target.Bounds.X; $y = $target.Bounds.Y
$w = $target.Bounds.Width; $h = $target.Bounds.Height

# Server starten als poort 5274 nog niet luistert
if (-not (Get-NetTCPConnection -LocalPort 5274 -State Listen -ErrorAction SilentlyContinue)) {
    Start-Process -FilePath $node -ArgumentList 'server/serve.mjs' -WorkingDirectory $project -WindowStyle Hidden
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 500
        if (Get-NetTCPConnection -LocalPort 5274 -State Listen -ErrorAction SilentlyContinue) { break }
    }
}

Start-Process -FilePath $edge -ArgumentList @(
    "--app=$url",
    "--user-data-dir=$profile",
    "--window-position=$x,$y",
    "--window-size=$w,$h",
    '--start-fullscreen',
    '--no-first-run',
    '--no-default-browser-check'
)
