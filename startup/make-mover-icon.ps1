# Tekent het Bot Crossing "mover"-poppetje (hi-vis verhuizer met doos) in twee toestanden:
#   bot-crossing-off.ico  -> grijs/gedempt  (server UIT  -> klik = starten)
#   bot-crossing-on.ico   -> groen/hi-vis   (server AAN  -> klik = stoppen)
# Schrijft ook een preview-PNG met beide naast elkaar.
Add-Type -AssemblyName System.Drawing

$outDir  = Split-Path -Parent $MyInvocation.MyCommand.Path
$icoOff  = Join-Path $outDir 'bot-crossing-off.ico'
$icoOn   = Join-Path $outDir 'bot-crossing-on.ico'
$preview = Join-Path $outDir 'bot-crossing-icon-preview.png'

function C([int]$r,[int]$g,[int]$b) { return [System.Drawing.Color]::FromArgb($r,$g,$b) }
function Brush($col) { return New-Object System.Drawing.SolidBrush $col }
function Add-RoundRect($path,[float]$x,[float]$y,[float]$w,[float]$h,[float]$rad) {
    $d = $rad * 2
    $path.AddArc($x, $y, $d, $d, 180, 90)
    $path.AddArc($x + $w - $d, $y, $d, $d, 270, 90)
    $path.AddArc($x + $w - $d, $y + $h - $d, $d, $d, 0, 90)
    $path.AddArc($x, $y + $h - $d, $d, $d, 90, 90)
    $path.CloseFigure()
}

# Kleurenschema's per toestand
$themes = @{
    on  = @{ bgA=(C 0x3a 0x8f 0x63); bgB=(C 0x1f 0x5a 0x40); vest=(C 0xff 0x8a 0x1e);
             strip=(C 0xff 0xe6 0x9a); hat=(C 0xff 0xcf 0x33); skin=(C 0xf2 0xc9 0xa0);
             box=(C 0xcf 0x9b 0x5e); boxT=(C 0xe4 0xb4 0x77); tape=(C 0xb0 0x80 0x48); leg=(C 0x1b 0x24 0x3a) }
    off = @{ bgA=(C 0x5c 0x64 0x70); bgB=(C 0x33 0x39 0x43); vest=(C 0x9a 0x8a 0x6e);
             strip=(C 0xd6 0xcf 0xbc); hat=(C 0xc4 0xb6 0x86); skin=(C 0xcf 0xc2 0xb2);
             box=(C 0x8f 0x84 0x72); boxT=(C 0xa6 0x9b 0x88); tape=(C 0x77 0x6d 0x5c); leg=(C 0x2a 0x2f 0x38) }
}

function Draw-Mover([int]$S, $t) {
    $bmp = New-Object System.Drawing.Bitmap ($S, $S)
    $g = [System.Drawing.Graphics]::FromImage($bmp)
    $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
    $g.Clear([System.Drawing.Color]::Transparent)
    $g.ScaleTransform($S / 256.0, $S / 256.0)   # alles in 256-ruimte tekenen

    # afgerond vierkant met verticale gradient
    $bgPath = New-Object System.Drawing.Drawing2D.GraphicsPath
    Add-RoundRect $bgPath 6 6 244 244 48
    $bgBrush = New-Object System.Drawing.Drawing2D.LinearGradientBrush(
        (New-Object System.Drawing.Point(0,0)), (New-Object System.Drawing.Point(0,256)), $t.bgA, $t.bgB)
    $g.FillPath($bgBrush, $bgPath)

    $leg=Brush $t.leg; $skin=Brush $t.skin; $vest=Brush $t.vest; $strip=Brush $t.strip
    $box=Brush $t.box; $boxT=Brush $t.boxT; $tape=Brush $t.tape; $hat=Brush $t.hat

    $g.FillRectangle($leg, 98, 190, 20, 42)      # benen
    $g.FillRectangle($leg, 128, 190, 20, 42)
    $body = New-Object System.Drawing.Drawing2D.GraphicsPath   # hesje/romp
    Add-RoundRect $body 82 106 82 92 22
    $g.FillPath($vest, $body)
    $g.FillRectangle($strip, 82, 142, 82, 13)    # reflecterende streep
    $g.FillEllipse($skin, 97, 58, 52, 52)        # hoofd
    $g.FillPie($hat, 92, 46, 62, 62, 180, 180)   # bouwhelm
    $g.FillRectangle($hat, 88, 74, 70, 8)
    $g.FillRectangle($boxT, 150, 146, 60, 16)    # doos boven
    $g.FillRectangle($box, 150, 158, 60, 54)     # doos voor
    $g.FillRectangle($tape, 176, 158, 8, 54)     # tape
    $g.FillRectangle($vest, 150, 150, 20, 18)    # arm om de doos

    $g.Dispose()
    return $bmp
}

function Save-Ico($t, $path) {
    $sizes = 256, 64, 48, 32, 16
    $pngs = @()
    foreach ($sz in $sizes) {
        $b = Draw-Mover $sz $t
        $ms = New-Object System.IO.MemoryStream
        $b.Save($ms, [System.Drawing.Imaging.ImageFormat]::Png)
        $pngs += , ($ms.ToArray()); $ms.Dispose(); $b.Dispose()
    }
    $out = New-Object System.IO.MemoryStream
    $bw = New-Object System.IO.BinaryWriter($out)
    $bw.Write([UInt16]0); $bw.Write([UInt16]1); $bw.Write([UInt16]$sizes.Count)
    $offset = 6 + 16 * $sizes.Count
    for ($i = 0; $i -lt $sizes.Count; $i++) {
        $sz = $sizes[$i]; $len = $pngs[$i].Length; $dim = if ($sz -ge 256) { 0 } else { $sz }
        $bw.Write([Byte]$dim); $bw.Write([Byte]$dim); $bw.Write([Byte]0); $bw.Write([Byte]0)
        $bw.Write([UInt16]1); $bw.Write([UInt16]32); $bw.Write([UInt32]$len); $bw.Write([UInt32]$offset)
        $offset += $len
    }
    foreach ($p in $pngs) { $bw.Write($p) }
    $bw.Flush(); [System.IO.File]::WriteAllBytes($path, $out.ToArray()); $bw.Dispose(); $out.Dispose()
}

Save-Ico $themes.off $icoOff
Save-Ico $themes.on  $icoOn

# preview: beide toestanden naast elkaar met labels
$pw = 560; $ph = 320
$pv = New-Object System.Drawing.Bitmap ($pw, $ph)
$pg = [System.Drawing.Graphics]::FromImage($pv)
$pg.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
$pg.TextRenderingHint = [System.Drawing.Text.TextRenderingHint]::AntiAlias
$pg.Clear((C 0x14 0x17 0x1c))
$font = New-Object System.Drawing.Font('Segoe UI', 15, [System.Drawing.FontStyle]::Bold)
$fg = Brush (C 0xe8 0xe8 0xe8)
$sf = New-Object System.Drawing.StringFormat; $sf.Alignment = 'Center'
$offBmp = Draw-Mover 200 $themes.off
$onBmp  = Draw-Mover 200 $themes.on
$pg.DrawImage($offBmp, 40, 30, 200, 200)
$pg.DrawImage($onBmp, 320, 30, 200, 200)
$pg.DrawString('server UIT  (klik = starten)', $font, $fg, (New-Object System.Drawing.RectangleF(20, 245, 240, 40)), $sf)
$pg.DrawString('server AAN  (klik = stoppen)', $font, $fg, (New-Object System.Drawing.RectangleF(300, 245, 240, 40)), $sf)
$pv.Save($preview, [System.Drawing.Imaging.ImageFormat]::Png)
$pg.Dispose(); $pv.Dispose(); $offBmp.Dispose(); $onBmp.Dispose()

Write-Output "OFF: $icoOff"
Write-Output "ON:  $icoOn"
Write-Output "PNG: $preview"
