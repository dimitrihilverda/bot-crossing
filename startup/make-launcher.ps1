# Bouwt "Moving-In Crossing.exe" uit launcher.cs, met het mover-icoon erin.
#
# Waarom een eigen .exe: Windows 11 biedt "Aan taakbalk vastmaken" niet aan voor een
# snelkoppeling die naar een systeemtool in System32 wijst, en powershell.exe is er zo een.
# Zolang de snelkoppeling daarheen wees ontbrak die actie in het rechtsklikmenu, ook onder
# "Meer opties weergeven". Een eigen programma is voor Windows een gewone toepassing.
#
# De compiler zit in Windows zelf (.NET Framework), dus dit vraagt niets extra's.
$ErrorActionPreference = 'Stop'

$here = $PSScriptRoot
$cs   = Join-Path $here 'launcher.cs'
$ico  = Join-Path $here 'bot-crossing-off.ico'
$exe  = Join-Path $here 'Moving-In Crossing.exe'

if (-not (Test-Path $cs))  { throw "launcher.cs niet gevonden in $here" }
if (-not (Test-Path $ico)) {
    Write-Host "Icoon ontbreekt, genereren..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'make-mover-icon.ps1') | Out-Null
}

$csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework64\v4.0.30319\csc.exe'
if (-not (Test-Path $csc)) { $csc = Join-Path $env:WINDIR 'Microsoft.NET\Framework\v4.0.30319\csc.exe' }
if (-not (Test-Path $csc)) { throw "geen C#-compiler gevonden onder $env:WINDIR\Microsoft.NET" }

# /target:winexe -> geen consolevenster dat opflitst bij het klikken.
# /win32icon     -> het programma draagt het icoon zelf, zodat de taakbalk het ook heeft als
#                   Windows ooit het icoon van de snelkoppeling negeert.
$out = & $csc /nologo /target:winexe /optimize+ "/win32icon:$ico" "/out:$exe" `
    /reference:System.dll /reference:System.Windows.Forms.dll "$cs" 2>&1
if ($LASTEXITCODE -ne 0) { $out | ForEach-Object { Write-Host $_ }; throw "compileren mislukt" }

if (-not (Test-Path $exe)) { throw "compiler gaf geen fout maar er staat geen $exe" }
"Gebouwd: $exe ($((Get-Item $exe).Length) bytes)"
