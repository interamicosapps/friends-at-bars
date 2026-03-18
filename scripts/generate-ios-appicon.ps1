param(
  [string]$InputPath = "public/brand/logo-full.png",
  [string]$OutputPath = "ios/App/App/Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png",
  [int]$Size = 1024
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input image not found: $InputPath"
}

$img = [System.Drawing.Image]::FromFile($InputPath)

$srcW = $img.Width
$srcH = $img.Height

$out = New-Object System.Drawing.Bitmap($Size, $Size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($out)

# Use a white square background. (The source logo already has a white background,
# and using white avoids transparent-icon edge artifacts on iOS.)
$g.Clear([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
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

