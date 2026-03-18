param(
  [string]$InputPath = "public/brand/logo-full.png",
  [string]$OutputPath = "public/brand/logo-mark.png"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input image not found: $InputPath"
}

$img = [System.Drawing.Image]::FromFile($InputPath)
$bmp = New-Object System.Drawing.Bitmap($img)

$width = $bmp.Width
$height = $bmp.Height

# Treat near-white pixels as "background" so we can:
# 1) find the shield-only region
# 2) optionally make background transparent
$whiteThreshold = 245
$rowNonWhiteCounts = New-Object int[] $height

for ($y = 0; $y -lt $height; $y++) {
  $count = 0
  for ($x = 0; $x -lt $width; $x++) {
    $c = $bmp.GetPixel($x, $y)
    if (-not ($c.R -ge $whiteThreshold -and $c.G -ge $whiteThreshold -and $c.B -ge $whiteThreshold)) {
      $count++
    }
  }
  $rowNonWhiteCounts[$y] = $count
}

# Heuristic: find the first "valley" (mostly-white band) after the mid-point.
# This should land between the shield artwork and the "BAR FEST" text.
$startSearchY = [int]([math]::Floor($height * 0.35))
$valleyStart = $null

for ($y = $startSearchY; $y -lt ($height - 15); $y++) {
  $isValley = $true
  for ($k = 0; $k -lt 12; $k++) {
    if ($rowNonWhiteCounts[$y + $k] -ge 3) {
      $isValley = $false
      break
    }
  }
  if ($isValley) {
    $valleyStart = $y
    break
  }
}

if ($null -eq $valleyStart) {
  # Fallback: crop upper portion
  $valleyStart = [int]([math]::Floor($height * 0.62))
}

$maxCropBottom = [int]([math]::Floor($height * 0.62))
if ($valleyStart -gt $maxCropBottom) {
  # The heuristic can sometimes dip below the "BAR FEST" text.
  # Hard-cap the crop so we end up with shield-only artwork.
  $valleyStart = $maxCropBottom
}

$cropBottom = [int]$valleyStart

$minX = $width
$minY = $cropBottom
$maxX = 0
$maxY = 0
$found = $false

for ($y = 0; $y -lt $cropBottom; $y++) {
  for ($x = 0; $x -lt $width; $x++) {
    $c = $bmp.GetPixel($x, $y)
    if (-not ($c.R -ge $whiteThreshold -and $c.G -ge $whiteThreshold -and $c.B -ge $whiteThreshold)) {
      $found = $true
      if ($x -lt $minX) { $minX = $x }
      if ($y -lt $minY) { $minY = $y }
      if ($x -gt $maxX) { $maxX = $x }
      if ($y -gt $maxY) { $maxY = $y }
    }
  }
}

if (-not $found) {
  # Fallback: just crop a reasonable top strip
  $minX = 0
  $minY = 0
  $maxX = $width - 1
  $maxY = [int]([math]::Min($height * 0.6, $height - 1))
}

$pad = 4
$x0 = [int]([math]::Max(0, $minX - $pad))
$y0 = [int]([math]::Max(0, $minY - $pad))
$x1 = [int]([math]::Min($width - 1, $maxX + $pad))
$y1 = [int]([math]::Min($cropBottom - 1, $maxY + $pad))

$rectW = ($x1 - $x0 + 1)
$rectH = ($y1 - $y0 + 1)

$out = New-Object System.Drawing.Bitmap($rectW, $rectH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.Clear([System.Drawing.Color]::Transparent)
$g.Dispose()

for ($ry = 0; $ry -lt $rectH; $ry++) {
  for ($rx = 0; $rx -lt $rectW; $rx++) {
    $srcX = $x0 + $rx
    $srcY = $y0 + $ry
    $c = $bmp.GetPixel($srcX, $srcY)

    if ($c.R -ge $whiteThreshold -and $c.G -ge $whiteThreshold -and $c.B -ge $whiteThreshold) {
      # Make background transparent
      $out.SetPixel($rx, $ry, [System.Drawing.Color]::FromArgb(0, $c.R, $c.G, $c.B))
    } else {
      $out.SetPixel($rx, $ry, [System.Drawing.Color]::FromArgb(255, $c.R, $c.G, $c.B))
    }
  }
}

if (Test-Path -LiteralPath $OutputPath) {
  Remove-Item -LiteralPath $OutputPath
}

$out.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$out.Dispose()
$bmp.Dispose()
$img.Dispose()

Write-Output "Generated $OutputPath"

