# Installeert de Bot Crossing taakbalk-toggle op DEZE machine.
#   - genereert de mover-iconen als ze ontbreken
#   - legt een "Bot Crossing.lnk" op je Bureaublad die de toggle start, met het icoon
# Vastmaken aan de taakbalk doe je daarna zelf (Windows 11 blokkeert dat programmatisch):
#   rechtsklik de snelkoppeling -> "Aan taakbalk vastmaken".
#
# Draaien:  rechtsklik dit bestand -> "Uitvoeren met PowerShell"
#       of: powershell -NoProfile -ExecutionPolicy Bypass -File startup\install-toggle.ps1
$ErrorActionPreference = 'Stop'

$here    = $PSScriptRoot
$toggle  = Join-Path $here 'bot-crossing-toggle.ps1'
$iconOff = Join-Path $here 'bot-crossing-off.ico'
$project = Split-Path -Parent $here

# 1. iconen genereren als ze er nog niet zijn
if (-not (Test-Path $iconOff)) {
    Write-Host "Iconen genereren..."
    & powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'make-mover-icon.ps1') | Out-Null
}

# 2. snelkoppeling op het Bureaublad (lost een eventuele OneDrive-omleiding vanzelf op)
$desktop = [Environment]::GetFolderPath('Desktop')
$lnk = Join-Path $desktop 'Bot Crossing.lnk'
$ps  = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

$sh = New-Object -ComObject WScript.Shell
$sc = $sh.CreateShortcut($lnk)
$sc.TargetPath       = $ps
$sc.Arguments        = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$toggle`""
$sc.WorkingDirectory = $project
$sc.IconLocation     = "$iconOff,0"
$sc.Description       = 'Bot Crossing starten of afsluiten'
$sc.WindowStyle      = 7   # geminimaliseerd, geen flitsend venster
$sc.Save()

Write-Host ""
Write-Host "Klaar. Snelkoppeling gemaakt:" -ForegroundColor Green
Write-Host "  $lnk"
Write-Host ""
Write-Host "Laatste stap (handmatig): rechtsklik de snelkoppeling -> 'Aan taakbalk vastmaken'."
Write-Host "1e klik = starten + wall openen  |  2e klik = vraag + afsluiten."
