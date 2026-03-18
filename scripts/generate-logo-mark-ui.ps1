param(
  [string]$InputPath = "public/brand/logo-full.png",
  [string]$OutputPath = "public/brand/logo-mark-ui.png"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input image not found: $InputPath"
}

$img = [System.Drawing.Image]::FromFile($InputPath)
$bmp = New-Object System.Drawing.Bitmap($img)

$width = $bmp.Width
$height = $bmp.Height

# Treat near-white pixels as background so we can still find the shield-only region.
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
  $valleyStart = [int]([math]::Floor($height * 0.62))
}

$maxCropBottom = [int]([math]::Floor($height * 0.62))
if ($valleyStart -gt $maxCropBottom) {
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

# UI variant: keep a white background so it looks correct on dark containers.
$out = New-Object System.Drawing.Bitmap($rectW, $rectH, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($out)
$g.Clear([System.Drawing.Color]::White)
$g.Dispose()

for ($ry = 0; $ry -lt $rectH; $ry++) {
  for ($rx = 0; $rx -lt $rectW; $rx++) {
    $srcX = $x0 + $rx
    $srcY = $y0 + $ry
    $c = $bmp.GetPixel($srcX, $srcY)

    # Keep white background opaque.
    if ($c.R -ge $whiteThreshold -and $c.G -ge $whiteThreshold -and $c.B -ge $whiteThreshold) {
      $out.SetPixel($rx, $ry, [System.Drawing.Color]::FromArgb(255, 255, 255))
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

