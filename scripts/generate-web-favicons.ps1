param(
  [string]$InputPath = "public/brand/logo-full.png",
  [string]$OutputDir = "public/favicon"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input image not found: $InputPath"
}

if (-not (Test-Path -LiteralPath $OutputDir)) {
  New-Item -ItemType Directory -Path $OutputDir | Out-Null
}

$img = [System.Drawing.Image]::FromFile($InputPath)
$srcW = $img.Width
$srcH = $img.Height

function WritePngIcon([int]$size, [string]$outPath) {
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)

  # Keep a white background; your source logo already uses white.
  $g.Clear([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $scale = [Math]::Min($size / $srcW, $size / $srcH)
  $newW = [int]([Math]::Round($srcW * $scale))
  $newH = [int]([Math]::Round($srcH * $scale))

  $x = [int]([Math]::Floor(($size - $newW) / 2))
  $y = [int]([Math]::Floor(($size - $newH) / 2))

  $g.DrawImage($img, $x, $y, $newW, $newH)
  $g.Dispose()

  if (Test-Path -LiteralPath $outPath) {
    Remove-Item -LiteralPath $outPath
  }

  $out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Png)
  $out.Dispose()
}

function WriteIco16([string]$outPath) {
  $size = 16
  $out = New-Object System.Drawing.Bitmap($size, $size, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
  $g = [System.Drawing.Graphics]::FromImage($out)
  $g.Clear([System.Drawing.Color]::FromArgb(255, 255, 255, 255))
  $g.InterpolationMode = [System.Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::HighQuality
  $g.PixelOffsetMode = [System.Drawing.Drawing2D.PixelOffsetMode]::HighQuality

  $scale = [Math]::Min($size / $srcW, $size / $srcH)
  $newW = [int]([Math]::Round($srcW * $scale))
  $newH = [int]([Math]::Round($srcH * $scale))

  $x = [int]([Math]::Floor(($size - $newW) / 2))
  $y = [int]([Math]::Floor(($size - $newH) / 2))

  $g.DrawImage($img, $x, $y, $newW, $newH)
  $g.Dispose()

  if (Test-Path -LiteralPath $outPath) {
    Remove-Item -LiteralPath $outPath
  }

  # .NET generally supports saving bitmaps as ICO.
  $out.Save($outPath, [System.Drawing.Imaging.ImageFormat]::Icon)
  $out.Dispose()
}

WritePngIcon 16 (Join-Path $OutputDir "favicon-16x16.png")
WritePngIcon 32 (Join-Path $OutputDir "favicon-32x32.png")
WritePngIcon 180 (Join-Path $OutputDir "apple-touch-icon.png")
WritePngIcon 192 (Join-Path $OutputDir "android-chrome-192x192.png")
WritePngIcon 512 (Join-Path $OutputDir "android-chrome-512x512.png")
WriteIco16 (Join-Path $OutputDir "favicon.ico")

$img.Dispose()

Write-Output "Generated web favicons in $OutputDir"

