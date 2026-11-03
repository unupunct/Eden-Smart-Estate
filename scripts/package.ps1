<# Builds release\EdenSmartEstate-<version>.zip: built web app + backend source + scripts + docs.
   The zip needs only Python 3.11+ on the target PC (no Node.js). #>
param([string]$Version = '0.1.0')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Push-Location (Join-Path $root 'frontend')
npm ci --no-audit --no-fund
npm run build
Pop-Location

$stageRoot = Join-Path $root 'release\stage'
$stage = Join-Path $stageRoot 'EdenSmartEstate'
if (Test-Path $stageRoot) { Remove-Item -Recurse -Force $stageRoot }
New-Item -ItemType Directory -Force -Path (Join-Path $stage 'backend'), (Join-Path $stage 'frontend') | Out-Null
Copy-Item -Recurse -Force (Join-Path $root 'backend\app') (Join-Path $stage 'backend\app')
Copy-Item -Recurse -Force (Join-Path $root 'backend\migrations') (Join-Path $stage 'backend\migrations')
Copy-Item (Join-Path $root 'backend\requirements.txt') (Join-Path $stage 'backend\requirements.txt')
Copy-Item -Recurse -Force (Join-Path $root 'frontend\dist') (Join-Path $stage 'frontend\dist')
Copy-Item -Recurse -Force (Join-Path $root 'scripts') (Join-Path $stage 'scripts')
Copy-Item -Recurse -Force (Join-Path $root 'docs') (Join-Path $stage 'docs')
Copy-Item (Join-Path $root 'README.md') $stage
Get-ChildItem -Recurse -Directory -Filter '__pycache__' $stage | Remove-Item -Recurse -Force
Remove-Item -Force (Join-Path $stage 'scripts\dev.ps1'), (Join-Path $stage 'scripts\package.ps1'), (Join-Path $stage 'scripts\test.ps1')

$zip = Join-Path $root "release\EdenSmartEstate-$Version.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $stage -DestinationPath $zip
Write-Host "Created $zip" -ForegroundColor Green
