<# Runs every automated test: backend (pytest), type check, frontend unit tests (vitest) and the browser end-to-end test. #>
param([switch]$SkipE2E)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
Push-Location (Join-Path $root 'backend'); & $py -m pytest -q; $a = $LASTEXITCODE; Pop-Location
Push-Location (Join-Path $root 'frontend')
npx tsc --noEmit; $b = $LASTEXITCODE
npx vitest run; $c = $LASTEXITCODE
$d = 0
if (-not $SkipE2E) { npm run build; node e2e/interact.mjs; $d = $LASTEXITCODE; node e2e/design.mjs; if ($LASTEXITCODE) { $d = $LASTEXITCODE }; node e2e/sun.mjs; if ($LASTEXITCODE) { $d = $LASTEXITCODE }; node e2e/smart.mjs; if ($LASTEXITCODE) { $d = $LASTEXITCODE }; node e2e/manage.mjs; if ($LASTEXITCODE) { $d = $LASTEXITCODE }; node e2e/auth.mjs; if ($LASTEXITCODE) { $d = $LASTEXITCODE }; node e2e/a11y.mjs; if ($LASTEXITCODE) { $d = $LASTEXITCODE } }
Pop-Location
if ($a -or $b -or $c -or $d) { Write-Host 'Some tests failed.' -ForegroundColor Red; exit 1 }
Write-Host 'All tests passed.' -ForegroundColor Green
