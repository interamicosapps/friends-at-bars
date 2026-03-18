param(
  [string]$InputPath = "public/brand/logo-mark-ui.png",
  [string]$OutputPath = "public/brand/logo-mark.png"
)

Add-Type -AssemblyName System.Drawing

if (-not (Test-Path -LiteralPath $InputPath)) {
  throw "Input image not found: $InputPath"
}

$img = [System.Drawing.Image]::FromFile($InputPath)
$w = $img.Width
$h = $img.Height

$src = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)
$g = [System.Drawing.Graphics]::FromImage($src)
$g.DrawImage($img, 0, 0, $w, $h)
$g.Dispose()
$img.Dispose()

$out = New-Object System.Drawing.Bitmap($w, $h, [System.Drawing.Imaging.PixelFormat]::Format32bppArgb)

for ($y = 0; $y -lt $h; $y++) {
  for ($x = 0; $x -lt $w; $x++) {
    $c = $src.GetPixel($x, $y)
    # Invert RGB; keep alpha as-is.
    $inv = [System.Drawing.Color]::FromArgb($c.A, (255 - $c.R), (255 - $c.G), (255 - $c.B))
    $out.SetPixel($x, $y, $inv)
  }
}

$out.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)

$src.Dispose()
$out.Dispose()

Write-Output "Inverted $InputPath -> $OutputPath"

