<#
 Starts EDEN Smart Estate and opens it in your browser.
   scripts\start.ps1                 this computer only            -> http://127.0.0.1:8787
   scripts\start.ps1 -Lan            also reachable from other devices on your network (asks for a password)
   scripts\start.ps1 -Lan -Https     the same, encrypted with a self-signed certificate (recommended)
   scripts\start.ps1 -Port 9000      use another port
   scripts\start.ps1 -Password ...   create the admin account ("admin") with this password if none exists yet
 The admin account is normally created in Settings. Forgot the password? scripts\reset-admin.ps1
 Your data lives in the "data" folder next to the app (override with -DataDir).
#>
param(
    [switch]$Lan,
    [int]$Port = 8787,
    [string]$DataDir = '',
    [switch]$NoBrowser,
    [string]$Password = '',
    [switch]$NoPassword,
    [switch]$Https
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'python\python.exe'                       # the installer's bundled Python
if (-not (Test-Path $py)) { $py = Join-Path $root 'backend\.venv\Scripts\python.exe' }  # script install / source checkout
if (-not (Test-Path $py)) { Write-Host 'Not installed yet. Run scripts\install.ps1 (or Install-EDEN.cmd) first.' -ForegroundColor Red; exit 1 }
if (-not (Test-Path (Join-Path $root 'frontend\dist\index.html'))) { Write-Host 'The web app is not built. Run scripts\install.ps1 first.' -ForegroundColor Red; exit 1 }
if ($DataDir) {
    New-Item -ItemType Directory -Force -Path $DataDir | Out-Null
    $env:EDEN_DATA_DIR = (Resolve-Path -LiteralPath $DataDir).Path
}
$dataFolder = if ($env:EDEN_DATA_DIR) { $env:EDEN_DATA_DIR } else { Join-Path $root 'data' }

# is the port free?
try {
    $probe = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, $Port)
    $probe.Start(); $probe.Stop()
} catch {
    Write-Host "Port $Port is already in use. EDEN may already be running (try http://127.0.0.1:$Port), or start it on another port with -Port 8788." -ForegroundColor Red
    exit 1
}

if ($Password) { $env:EDEN_PASSWORD = $Password }
$hasAdmin = $false
Push-Location (Join-Path $root 'backend')
try { $hasAdmin = ((& $py -m app.admin status 2>$null) -join '') -match '^ADMIN=(?!none)' } catch { }
Pop-Location
if ($Lan -and -not $hasAdmin -and -not $env:EDEN_PASSWORD -and -not $NoPassword) {
    Write-Host 'LAN mode lets other devices on your network open this estate and operate your devices, so it needs the admin account.' -ForegroundColor Yellow
    $secure = Read-Host 'Choose the admin password (at least 10 characters; the user name is "admin")' -AsSecureString
    $plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
    if ($plain.Length -lt 10) { Write-Host 'Password too short. Not starting. (Use -NoPassword only on a network you fully trust.)' -ForegroundColor Red; exit 1 }
    $env:EDEN_PASSWORD = $plain
}
$bind = if ($Lan) { '0.0.0.0' } else { '127.0.0.1' }
$ips = @()
if ($Lan) {
    $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue | Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' } | ForEach-Object { $_.IPAddress })
}
$scheme = if ($Https) { 'https' } else { 'http' }
$tlsArgs = @()
if ($Https) {
    $nameArgs = @(); foreach ($ip in $ips) { $nameArgs += @('--name', $ip) }
    Push-Location (Join-Path $root 'backend')
    $out = & $py -m app.tls --dir $dataFolder @nameArgs
    Pop-Location
    if ($LASTEXITCODE -ne 0) { Write-Host 'Could not create the HTTPS certificate. Run scripts\install.ps1 again to install the missing component.' -ForegroundColor Red; exit 1 }
    $cert = ($out | Where-Object { $_ -like 'CERT=*' }) -replace '^CERT=', ''
    $key = ($out | Where-Object { $_ -like 'KEY=*' }) -replace '^KEY=', ''
    $fp = ($out | Where-Object { $_ -like 'FINGERPRINT=*' }) -replace '^FINGERPRINT=', ''
    $tlsArgs = @('--ssl-certfile', $cert, '--ssl-keyfile', $key)
    Write-Host 'HTTPS is on with a self-signed certificate made on this computer.' -ForegroundColor Yellow
    Write-Host "  Browsers warn once. Check that the certificate fingerprint matches, then continue:"
    Write-Host "  $fp"
    Write-Host "  Certificate file (to trust it on another device): $cert"
}
if ($Lan) {
    if ($hasAdmin -or $env:EDEN_PASSWORD) { Write-Host 'LAN mode with the admin account.' -ForegroundColor Yellow }
    else { Write-Host 'LAN mode WITHOUT a password: anyone on your network can open, edit and control devices. Only do this on a network you fully trust.' -ForegroundColor Red }
    if (-not $Https) { Write-Host 'Traffic is NOT encrypted (plain HTTP). Add -Https to encrypt it.' -ForegroundColor Yellow }
    foreach ($ip in $ips) { Write-Host "  other devices:  ${scheme}://${ip}:$Port" }
} elseif ($hasAdmin -or $env:EDEN_PASSWORD) { Write-Host 'The admin account protects this estate.' -ForegroundColor Yellow }
else { Write-Host 'No admin account yet: create one in Settings to require a password.' -ForegroundColor DarkYellow }
Write-Host "EDEN Smart Estate is starting on ${scheme}://127.0.0.1:$Port  (Ctrl+C or close this window to stop)" -ForegroundColor Green
if (-not $NoBrowser) {
    Start-Job -ScriptBlock { param($p, $s) Start-Sleep 2; Start-Process "${s}://127.0.0.1:$p" } -ArgumentList $Port, $scheme | Out-Null
}
Set-Location (Join-Path $root 'backend')
& $py -m uvicorn app.main:app --host $bind --port $Port --log-level warning @tlsArgs
