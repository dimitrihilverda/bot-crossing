# Installeert de Moving-In Crossing taakbalk-toggle op DEZE machine.
#   - genereert de mover-iconen als ze ontbreken
#   - legt een "Moving-In Crossing.lnk" op je Bureaublad die de toggle start, met het icoon
# Vastmaken aan de taakbalk doe je daarna zelf (Windows 11 blokkeert dat programmatisch):
#   rechtsklik de snelkoppeling -> "Aan taakbalk vastmaken".
#
# Draaien:  rechtsklik dit bestand -> "Uitvoeren met PowerShell"
#       of: powershell -NoProfile -ExecutionPolicy Bypass -File startup\install-toggle.ps1
$ErrorActionPreference = 'Stop'

$name    = 'Moving-In Crossing'   # moet gelijk zijn aan $name in bot-crossing-toggle.ps1,
                                  # want die zoekt de snelkoppeling op naam om het icoon te wisselen
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
$lnk = Join-Path $desktop "$name.lnk"
$ps  = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'

$sh = New-Object -ComObject WScript.Shell
$sc = $sh.CreateShortcut($lnk)
$sc.TargetPath       = $ps
$sc.Arguments        = "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$toggle`""
$sc.WorkingDirectory = $project
$sc.IconLocation     = "$iconOff,0"
$sc.Description       = "$name starten of afsluiten"
$sc.WindowStyle      = 7   # geminimaliseerd, geen flitsend venster
$sc.Save()

# 3. eigen app-identiteit, anders erft de knop die van PowerShell
#
# Het doel van deze snelkoppeling is powershell.exe. Windows leidt de identiteit van een
# vastgemaakte taakbalk-knop af uit dat doel, en dan pakt hij het icoon en de groepering van
# PowerShell in plaats van wat hier in de snelkoppeling staat — vastmaken leverde een vreemd
# icoon op in plaats van de verhuizer. Een eigen AppUserModelID maakt er voor Windows een losse
# app van, met zijn eigen icoon en zijn eigen plek.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'set-appid.ps1') `
    -Lnk $lnk -AppId 'MovingIn.Crossing.Toggle' | Out-Null

Write-Host ""
Write-Host "Klaar. Snelkoppeling gemaakt:" -ForegroundColor Green
Write-Host "  $lnk"
Write-Host ""
Write-Host "Laatste stap (handmatig): rechtsklik de snelkoppeling -> 'Aan taakbalk vastmaken'."
Write-Host "1e klik = starten + wall openen  |  2e klik = vraag + afsluiten."
