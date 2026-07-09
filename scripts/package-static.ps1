param(
  [string]$OutputDir = "dist"
)

$ErrorActionPreference = "Stop"

$root = Resolve-Path (Join-Path $PSScriptRoot "..")
$target = Join-Path $root $OutputDir

if (Test-Path $target) {
  Remove-Item -LiteralPath $target -Recurse -Force
}

New-Item -ItemType Directory -Path $target | Out-Null

$files = @(
  "*.html",
  "app.js",
  "srs.js",
  "styles.css",
  "supabase-client.js",
  "supabase-config.js"
)

foreach ($pattern in $files) {
  Get-ChildItem -Path $root -Filter $pattern -File | Copy-Item -Destination $target
}

$dirs = @("assets", "data", "vendor")
foreach ($dir in $dirs) {
  $source = Join-Path $root $dir
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination (Join-Path $target $dir) -Recurse
  }
}

Write-Host "Static deployment bundle created at $target"
