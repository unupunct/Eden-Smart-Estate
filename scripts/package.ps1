<# Builds release\EdenSmartEstate-<version>.zip: built web app + backend source + scripts + docs.
   The zip needs only Python 3.11+ on the target PC (no Node.js). #>
param([string]$Version = '1.2.0')
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
Copy-Item (Join-Path $root 'Install-EDEN.cmd') $stage
foreach ($f in 'CHANGELOG.md', 'SECURITY.md', 'LICENSE', 'THIRD_PARTY_NOTICES.md') { if (Test-Path (Join-Path $root $f)) { Copy-Item (Join-Path $root $f) $stage } }
Set-Content -Path (Join-Path $stage 'VERSION') -Value $Version -Encoding ASCII
Get-ChildItem -Recurse -Directory -Filter '__pycache__' $stage | Remove-Item -Recurse -Force
foreach ($f in 'dev.ps1', 'package.ps1', 'test.ps1', 'test-setup.ps1', 'build-installer.ps1', 'test-installer.ps1', 'sign-file.ps1', 'new-signing-cert.ps1') { Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $stage "scripts\$f") }

$zip = Join-Path $root "release\EdenSmartEstate-$Version.zip"
if (Test-Path $zip) { Remove-Item $zip }
Compress-Archive -Path $stage -DestinationPath $zip
Write-Host "Created $zip" -ForegroundColor Green
