<#
 Removes EDEN Smart Estate (installed with setup.ps1 / Install-EDEN.cmd).
   Uninstall-EDEN.ps1                 asks whether to keep your data (default: keep)
   Uninstall-EDEN.ps1 -RemoveData     also deletes your estate data
   Uninstall-EDEN.ps1 -Yes            no questions
 Your data is in <InstallDir>\data. Export a backup from the app first if you are unsure.
#>
param(
    [switch]$RemoveData,
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$InstallDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Join-Path $InstallDir 'app'
$dataDir = Join-Path $InstallDir 'data'
if (-not (Test-Path $appDir)) { Write-Host "No installation found in $InstallDir." -ForegroundColor Red; exit 1 }

if (-not $Yes -and -not $RemoveData) {
    $a = Read-Host "Also delete your estate data in $dataDir ? [y/N]"
    if ($a -eq 'y' -or $a -eq 'Y') { $RemoveData = $true }
}
if ($RemoveData -and -not $Yes) {
    $b = Read-Host 'This permanently deletes all properties, documents and photos. Type DELETE to confirm'
    if ($b -ne 'DELETE') { Write-Host 'Data kept.'; $RemoveData = $false }
}

Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$appDir*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 800

$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'EDEN Smart Estate'
if (Test-Path $menu) { Remove-Item -LiteralPath $menu -Recurse -Force }
foreach ($l in @((Join-Path ([Environment]::GetFolderPath('Desktop')) 'EDEN Smart Estate.lnk'), (Join-Path ([Environment]::GetFolderPath('Startup')) 'EDEN Smart Estate.lnk'))) {
    if (Test-Path $l) { Remove-Item -LiteralPath $l -Force }
}
$key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EDENSmartEstate'
if (Test-Path $key) { Remove-Item -LiteralPath $key -Recurse -Force }

Remove-Item -LiteralPath $appDir -Recurse -Force
Remove-Item -LiteralPath (Join-Path $InstallDir 'EDEN.cmd') -Force -ErrorAction SilentlyContinue
if ($RemoveData) {
    if (Test-Path $dataDir) { Remove-Item -LiteralPath $dataDir -Recurse -Force }
    # this script lives in the folder being removed: finish from a detached shell
    Start-Process cmd.exe -ArgumentList "/c ping -n 3 127.0.0.1 >nul & rmdir /s /q `"$InstallDir`"" -WindowStyle Hidden
    Write-Host 'EDEN and its data were removed.' -ForegroundColor Green
} else {
    Write-Host "EDEN was removed. Your data is still in $dataDir" -ForegroundColor Green
}
