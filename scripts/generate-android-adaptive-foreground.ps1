param(
  [string]$InputPath = "public/brand/logo-mark.png",
  [string]$OutputPath = "android/app/src/main/res/mipmap-anydpi-v26/ic_launcher_foreground.png",
  [int]$Size = 512
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input image not found: $InputPath"
}

$dir = Split-Path -Parent $OutputPath
if (-not (Test-Path -LiteralPath $dir)) {
  New-Item -ItemType Directory -Path $dir | Out-Null
}

$img = [System.Drawing.Image]::FromFile($InputPath)
$srcW = $img.Width
$srcH = $img.Height

$out = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.Clear([System.Drawing.Color]::Transparent)
$g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
$g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

$scale = [Math]::Min($Size / $srcW, $Size / $srcH)
$newW = [int]([Math]::Round($srcW * $scale))
$newH = [int]([Math]::Round($srcH * $scale))

$x = [int]([Math]::Floor(($Size - $newW) / 2))
$y = [int]([Math]::Floor(($Size - $newH) / 2))

$g.DrawImage($img, $x, $y, $newW, $newH)
$g.Dispose()

if (Test-Path -LiteralPath $OutputPath) {
  Remove-Item -LiteralPath $OutputPath
}

$out.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
$out.Dispose()
$img.Dispose()

Write-Output "Generated $OutputPath"

