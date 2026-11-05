<#
 EDEN Smart Estate - Windows setup.
   Install-EDEN.cmd                         install for the current user (no administrator rights needed)
   scripts\setup.ps1 -Autostart             also start EDEN when you sign in
   scripts\setup.ps1 -InstallDir D:\EDEN    choose another folder
   scripts\setup.ps1 -Portable              copy and prepare only: no shortcuts, no registry entries (used by tests)

 What it does: copies the app to <InstallDir>\app, creates its Python environment, keeps your DATA in <InstallDir>\data
 (so updates never touch it), adds Start Menu shortcuts and an entry in Windows "Installed apps", and offers to start EDEN.
 Running it again over an existing installation UPDATES the app and keeps all data.
#>
param(
    [string]$InstallDir = (Join-Path $env:LOCALAPPDATA 'EDEN'),
    [switch]$Autostart,
    [switch]$DesktopShortcut,
    [switch]$Portable,
    [switch]$NoLaunch,
    [switch]$Yes
)
$ErrorActionPreference = 'Stop'
$src = Split-Path -Parent $PSScriptRoot
$version = if (Test-Path (Join-Path $src 'VERSION')) { (Get-Content (Join-Path $src 'VERSION') -Raw).Trim() } else { 'dev' }

function Find-Python {
    foreach ($c in @(@{ exe = 'py'; args = @('-3') }, @{ exe = 'python'; args = @() }, @{ exe = 'python3'; args = @() })) {
        if (-not (Get-Command $c.exe -ErrorAction SilentlyContinue)) { continue }
        try {
            $v = & $c.exe @($c.args) --version 2>&1 | Out-String
            if ($v -match 'Python (\d+)\.(\d+)') {
                if ([int]$Matches[1] -gt 3 -or ([int]$Matches[1] -eq 3 -and [int]$Matches[2] -ge 11)) { return $c }
            }
        } catch { }
    }
    return $null
}

Write-Host "EDEN Smart Estate $version - setup" -ForegroundColor Green
if (-not (Test-Path (Join-Path $src 'frontend\dist\index.html'))) { Write-Host 'This folder does not contain the built web app. Use the release package (EdenSmartEstate-x.y.z.zip) or run scripts\install.ps1 from a source checkout.' -ForegroundColor Red; exit 1 }
$py = Find-Python
if (-not $py) {
    Write-Host 'Python 3.11 or newer was not found.' -ForegroundColor Yellow
    if (Get-Command winget -ErrorAction SilentlyContinue) {
        $a = if ($Yes) { 'y' } else { Read-Host 'Install Python 3.12 for your user account now with Windows Package Manager (winget)? [Y/n]' }
        if ($a -ne 'n' -and $a -ne 'N') {
            winget install -e --id Python.Python.3.12 --scope user --accept-package-agreements --accept-source-agreements
            # pick up the new PATH without restarting this window
            $env:Path = [Environment]::GetEnvironmentVariable('Path', 'Machine') + ';' + [Environment]::GetEnvironmentVariable('Path', 'User')
            $py = Find-Python
            if (-not $py) {
                $direct = Join-Path $env:LOCALAPPDATA 'Programs\Python\Python312\python.exe'
                if (Test-Path $direct) { $py = @{ exe = $direct; args = @() } }
            }
        }
    }
    if (-not $py) {
        Write-Host 'Install Python 3.11 or newer from https://www.python.org/downloads/ (tick "Add python.exe to PATH") and run setup again.' -ForegroundColor Red
        exit 1
    }
}

$appDir = Join-Path $InstallDir 'app'
$dataDir = Join-Path $InstallDir 'data'
$updating = Test-Path (Join-Path $appDir 'backend\app\main.py')
Write-Host ("{0} in {1}" -f $(if ($updating) { 'Updating' } else { 'Installing' }), $InstallDir) -ForegroundColor Cyan

# stop a running copy so files can be replaced
Get-CimInstance Win32_Process -Filter "Name='python.exe'" -ErrorAction SilentlyContinue | Where-Object { $_.CommandLine -like "*$appDir*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }

New-Item -ItemType Directory -Force -Path $appDir, $dataDir | Out-Null
# copy the app (keep the Python environment of an existing installation: it makes updates fast)
$null = robocopy $src $appDir /MIR /XD '.venv' '__pycache__' 'data' 'release' 'node_modules' '.git' /XF 'Install-EDEN.cmd' /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "Copying the app failed (robocopy exit code $LASTEXITCODE)" }
Copy-Item -Force (Join-Path $src 'scripts\uninstall.ps1') (Join-Path $InstallDir 'Uninstall-EDEN.ps1')

# bring over data from a previous "run from the unzipped folder" use, once
$oldData = Join-Path $src 'data'
if ((Test-Path (Join-Path $oldData 'eden.db')) -and -not (Test-Path (Join-Path $dataDir 'eden.db'))) {
    Write-Host 'Copying your existing data from the unzipped folder...' -ForegroundColor Cyan
    Copy-Item -Recurse -Force (Join-Path $oldData '*') $dataDir
}

$venv = Join-Path $appDir 'backend\.venv'
$venvPy = Join-Path $venv 'Scripts\python.exe'
if (-not (Test-Path $venvPy)) {
    Write-Host 'Creating the Python environment...' -ForegroundColor Cyan
    & $py.exe @($py.args) -m venv $venv
    if ($LASTEXITCODE -ne 0) { throw 'Could not create the virtual environment' }
}
Write-Host 'Installing components (this needs internet the first time)...' -ForegroundColor Cyan
& $venvPy -m pip install --quiet --disable-pip-version-check -r (Join-Path $appDir 'backend\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install failed. Check your internet connection and run setup again.' }

# launcher
$launcher = Join-Path $InstallDir 'EDEN.cmd'
Set-Content -Path $launcher -Encoding ASCII -Value @(
    '@echo off',
    'title EDEN Smart Estate',
    'powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0app\scripts\start.ps1" -DataDir "%~dp0data" %*'
)

if (-not $Portable) {
    $shell = New-Object -ComObject WScript.Shell
    function New-Link($path, $target, $arguments, $workDir, $desc, $style) {
        $l = $shell.CreateShortcut($path)
        $l.TargetPath = $target; $l.Arguments = $arguments; $l.WorkingDirectory = $workDir; $l.Description = $desc; $l.WindowStyle = $style
        $l.Save()
    }
    $menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'EDEN Smart Estate'
    New-Item -ItemType Directory -Force -Path $menu | Out-Null
    New-Link (Join-Path $menu 'EDEN Smart Estate.lnk') $launcher '' $InstallDir 'Start EDEN Smart Estate' 7
    New-Link (Join-Path $menu 'EDEN data folder.lnk') 'explorer.exe' "`"$dataDir`"" $InstallDir 'Your estate data and backups' 1
    New-Link (Join-Path $menu 'Uninstall EDEN.lnk') 'powershell.exe' "-NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'Uninstall-EDEN.ps1')`"" $InstallDir 'Remove EDEN Smart Estate' 1
    if ($DesktopShortcut) { New-Link (Join-Path ([Environment]::GetFolderPath('Desktop')) 'EDEN Smart Estate.lnk') $launcher '' $InstallDir 'Start EDEN Smart Estate' 7 }
    $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'EDEN Smart Estate.lnk'
    if ($Autostart) { New-Link $startup $launcher '-NoBrowser' $InstallDir 'EDEN Smart Estate' 7 } elseif (Test-Path $startup) { Remove-Item -LiteralPath $startup -Force }
    $key = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\EDENSmartEstate'
    New-Item -Path $key -Force | Out-Null
    Set-ItemProperty $key DisplayName 'EDEN Smart Estate'
    Set-ItemProperty $key DisplayVersion $version
    Set-ItemProperty $key Publisher 'EDEN Smart Estate'
    Set-ItemProperty $key InstallLocation $InstallDir
    Set-ItemProperty $key UninstallString "powershell.exe -NoProfile -ExecutionPolicy Bypass -File `"$(Join-Path $InstallDir 'Uninstall-EDEN.ps1')`""
    Set-ItemProperty $key NoModify 1
    Set-ItemProperty $key NoRepair 1
}

Write-Host ''
Write-Host "EDEN $version is $(if ($updating) { 'updated' } else { 'installed' })." -ForegroundColor Green
Write-Host "  Program : $appDir"
Write-Host "  Your data: $dataDir   (kept when you update or uninstall)"
if (-not $Portable) { Write-Host '  Start it from the Start Menu: EDEN Smart Estate' }
if (-not $Portable -and -not $NoLaunch) {
    $a = Read-Host 'Start EDEN now? [Y/n]'
    if ($a -ne 'n' -and $a -ne 'N') { Start-Process -FilePath $launcher -WorkingDirectory $InstallDir }
}
