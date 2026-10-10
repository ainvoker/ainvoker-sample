param(
  [Parameter(Position = 0)]
  [string]$Sample
)

$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

$map = @{
  "chat" = "chat"
  "stream" = "stream"
  "actions" = "actions"
  "image" = "image"
  "studio" = "studio"
}

if (-not $Sample -or -not $map.ContainsKey($Sample)) {
  Write-Host "Usage: .\scripts\run.ps1 <sample>"
  Write-Host ""
  Write-Host "  chat              server text chat"
  Write-Host "  stream            server text stream"
  Write-Host "  actions           server actions"
  Write-Host "  image             server image generation"
  Write-Host "  studio            http://localhost:5180"
  exit 1
}

npm run $map[$Sample]
