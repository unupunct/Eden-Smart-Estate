<#
 Starts EDEN Smart Estate and opens it in your browser.
   scripts\start.ps1                 this computer only            -> http://127.0.0.1:8787
   scripts\start.ps1 -Lan            also reachable from other devices on your network (asks for a password)
   scripts\start.ps1 -Port 9000      use another port
   scripts\start.ps1 -Password ...   protect the estate with a password (also without -Lan)
 Your data lives in the "data" folder next to the app (override with -DataDir).
#>
param(
    [switch]$Lan,
    [int]$Port = 8787,
    [string]$DataDir = '',
    [switch]$NoBrowser,
    [string]$Password = '',
    [switch]$NoPassword
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { Write-Host 'Not installed yet. Run scripts\install.ps1 (or Install-EDEN.cmd) first.' -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $root 'frontend\dist\index.html'))) { Write-Host 'The web app is not built. Run scripts\install.ps1 first.' -ForegroundColor Red; exit 1 }
if ($DataDir) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $env:EDEN_DATA_DIR = (Resolve-Path -LiteralPath $DataDir).Path
}

# is the port free?
try {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $probe.Start(); $probe.Stop()
} catch {
    Write-Host "Port $Port is already in use. EDEN may already be running (try http://127.0.0.1:$Port), or start it on another port with -Port 8788." -ForegroundColor Red
    exit 1
}

if ($Password) { $env:EDEN_PASSWORD = $Password }
if ($Lan -and -not $env:EDEN_PASSWORD -and -not $NoPassword) {
    Write-Host 'LAN mode lets other devices on your network open this estate and operate your devices, so it needs a password.' -ForegroundColor Yellow
    $secure = Read-Host 'Choose a password (at least 8 characters)' -AsSecureString
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if ($plain.Length -lt 8) { Write-Host 'Password too short. Not starting. (Use -NoPassword only on a network you fully trust.)' -ForegroundColor Red; exit 1 }
    $env:EDEN_PASSWORD = $plain
}
$bind = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
if ($Lan) {
    if ($env:EDEN_PASSWORD) { Write-Host 'LAN mode with password protection.' -ForegroundColor Yellow }
    else { Write-Host 'LAN mode WITHOUT a password: anyone on your network can open, edit and control devices. Only do this on a network you fully trust.' -ForegroundColor Red }
    $ips = Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }
    foreach ($ip in $ips) { Write-Host "  other devices:  http://$($ip.IPAddress):$Port" }
} elseif ($env:EDEN_PASSWORD) { Write-Host 'Password protection is on.' -ForegroundColor Yellow }
Write-Host "EDEN Smart Estate is starting on http://127.0.0.1:$Port  (Ctrl+C or close this window to stop)" -ForegroundColor Green
if (-not $NoBrowser) {
    Start-Job -ScriptBlock { param($p) Start-Sleep 2; Start-Process "http://127.0.0.1:$p" } -ArgumentList $Port | Out-Null
}
Set-Location (Join-Path $root 'backend')
& $py -m uvicorn app.main:app --host $bind --port $Port --log-level warning
