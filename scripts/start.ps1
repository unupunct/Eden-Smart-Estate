<#
 Starts EDEN Smart Estate and opens it in your browser.
   scripts\start.ps1              this computer only            -> http://127.0.0.1:8787
   scripts\start.ps1 -Lan         also reachable from other devices on your network
   scripts\start.ps1 -Port 9000   use another port
 Your data lives in the "data" folder next to the app (override with -DataDir).
#>
param(
    [switch]$Lan,
    [int]$Port = 8787,
    [string]$DataDir = '',
    [switch]$NoBrowser
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { Write-Host 'Not installed yet. Run scripts\install.ps1 first.' -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $root 'frontend\dist\index.html'))) { Write-Host 'The web app is not built. Run scripts\install.ps1 first.' -ForegroundColor Red; exit 1 }
if ($DataDir) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $env:EDEN_DATA_DIR = (Resolve-Path -LiteralPath $DataDir).Path
}

$bind = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
if ($Lan) {
    Write-Host 'LAN mode: anyone on your network can open and EDIT this estate. EDEN has no login yet - only use this on a network you trust.' -ForegroundColor Yellow
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
    foreach ($ip in $ips) { Write-Host "  other devices:  http://$($ip.IPAddress):$Port" }
}
Write-Host "EDEN Smart Estate is starting on http://127.0.0.1:$Port  (Ctrl+C to stop)" -ForegroundColor Green
if (-not $NoBrowser) {
    Start-Job -ScriptBlock { param($p) Start-Sleep 2; Start-Process "http://127.0.0.1:$p" } -ArgumentList $Port | Out-Null
}
Set-Location (Join-Path $root 'backend')
& $py -m uvicorn app.main:app --host $bind --port $Port --log-level warning
