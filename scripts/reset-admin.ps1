<#
 Sets a new password for the EDEN admin account (or creates the account). Run it on the computer EDEN lives on.
 Your data is not affected; everybody who was signed in is signed out.
   scripts\reset-admin.ps1                 asks for the new password
   scripts\reset-admin.ps1 -UserName me    also changes the user name
#>
param([string]$UserName = '', [string]$DataDir = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'python\python.exe'
if (-not (Test-Path $py)) { $py = Join-Path $root 'backend\.venv\Scripts\python.exe' }
if (-not (Test-Path $py)) { Write-Host 'EDEN is not installed here.' -ForegroundColor Red; exit 1 }
if ($DataDir) { $env:EDEN_DATA_DIR = (Resolve-Path -LiteralPath $DataDir).Path }
Write-Host 'Stop EDEN first if it is running (it will keep working, but sessions only end when it restarts).' -ForegroundColor Yellow
$secure = Read-Host 'New admin password (at least 10 characters)' -AsSecureString
$plain = [System.Runtime.InteropServices.Marshal]::PtrToStringBSTR([System.Runtime.InteropServices.Marshal]::SecureStringToBSTR($secure))
$env:EDEN_NEW_PASSWORD = $plain
Push-Location (Join-Path $root 'backend')
$args2 = @('-m', 'app.admin', 'reset'); if ($UserName) { $args2 += @('--username', $UserName) }
& $py @args2
$code = $LASTEXITCODE
Pop-Location
Remove-Item Env:EDEN_NEW_PASSWORD -ErrorAction SilentlyContinue
if ($code -eq 0) { Write-Host 'The admin password was changed.' -ForegroundColor Green } else { Write-Host 'The password was not changed.' -ForegroundColor Red }
exit $code
