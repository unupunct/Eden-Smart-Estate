<#
 EDEN Smart Estate - one-time setup.
 Creates the Python environment and installs backend dependencies.
 If frontend\dist is missing (a source checkout), it also builds the web app (needs Node.js 20+).
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

function Find-Python {
    $candidates = @(
        @{ exe = 'py'; args = @('-3') },
        @{ exe = 'python'; args = @() },
        @{ exe = 'python3'; args = @() }
    )
    foreach ($c in $candidates) {
        if (-not (Get-Command $c.exe -ErrorAction SilentlyContinue)) { continue }
        try {
            $v = & $c.exe @($c.args) --version 2>&1 | Out-String
            if ($v -match 'Python (\d+)\.(\d+)') {
                $maj = [int]$Matches[1]; $min = [int]$Matches[2]
                if ($maj -gt 3 -or ($maj -eq 3 -and $min -ge 11)) { return $c }
            }
        } catch { }
    }
    return $null
}

$py = Find-Python
if (-not $py) {
    Write-Host 'Python 3.11 or newer was not found.' -ForegroundColor Red
    Write-Host 'Install it from https://www.python.org/downloads/ (tick "Add python.exe to PATH"), then run this script again.'
    exit 1
}
Write-Host "Using $($py.exe) $($py.args -join ' ')" -ForegroundColor Cyan

$venv = Join-Path $root 'backend\.venv'
$venvPy = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    Write-Host 'Creating Python environment...' -ForegroundColor Cyan
    & $py.exe @($py.args) -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the virtual environment' }
}
Write-Host 'Installing backend dependencies...' -ForegroundColor Cyan
& $venvPy -m pip install --quiet --upgrade pip
& $venvPy -m pip install --quiet -r (Join-Path $root 'backend\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }

if (-not (Test-Path (Join-Path $root 'frontend\dist\index.html'))) {
    if (-not (Get-Command npm -ErrorAction SilentlyContinue)) {
        Write-Host 'The web app is not built and Node.js was not found.' -ForegroundColor Red
        Write-Host 'Install Node.js 20+ from https://nodejs.org/ and run this script again, or use a release package that already contains the built app.'
        exit 1
    }
    Write-Host 'Building the web app (about a minute)...' -ForegroundColor Cyan
    Push-Location (Join-Path $root 'frontend')
    npm ci --no-audit --no-fund
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm ci failed' }
    npm run build
    if ($LASTEXITCODE -ne 0) { Pop-Location; throw 'npm run build failed' }
    Pop-Location
}
Write-Host ''
Write-Host 'Setup complete. Start EDEN with:  scripts\start.ps1' -ForegroundColor Green
