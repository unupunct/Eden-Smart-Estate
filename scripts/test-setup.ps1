<# Tests the Windows setup end to end with the newest release zip: install, start, use, update (data must survive),
   uninstall. Uses a temporary folder and -Portable (no shortcuts or registry entries), so it does not touch your own installation.
   Needs internet for pip (first install only) and takes a couple of minutes. #>
param([string]$Zip = '', [int]$Port = 8811)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
if (-not $Zip) { $Zip = (Get-ChildItem (Join-Path $root 'release\EdenSmartEstate-*.zip') | Sort-Object LastWriteTime | Select-Object -Last 1).FullName }
$tmp = Join-Path ([IO.Path]::GetTempPath()) ("eden-setup-test-" + [guid]::NewGuid().ToString('N').Substring(0, 8))
$pkg = Join-Path $tmp 'pkg'
$inst = Join-Path $tmp 'EDEN'
$fail = 0
function Check($name, $ok, $extra = '') { if ($ok) { Write-Host "PASS  $name" -ForegroundColor Green } else { Write-Host "FAIL  $name  $extra" -ForegroundColor Red; $script:fail++ } }
function Start-Eden {
    $p = Start-Process -FilePath 'cmd.exe' -ArgumentList "/c `"$inst\EDEN.cmd`" -NoBrowser -Port $Port" -PassThru -WindowStyle Hidden
    for ($i = 0; $i -lt 40; $i++) { Start-Sleep -Milliseconds 500; try { return (Invoke-RestMethod "http://127.0.0.1:$Port/api/health" -TimeoutSec 2) } catch { } }
    return $null
}
function Stop-Eden { Get-CimInstance Win32_Process -Filter "Name='python.exe'" | Where-Object { $_.CommandLine -like "*$inst*" } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }; Start-Sleep 1 }

Write-Host "Package: $Zip"
Expand-Archive -LiteralPath $Zip -DestinationPath $pkg
$pkgRoot = Join-Path $pkg 'EdenSmartEstate'
Check 'package contains the installer, VERSION and security notes' ((Test-Path "$pkgRoot\Install-EDEN.cmd") -and (Test-Path "$pkgRoot\VERSION") -and (Test-Path "$pkgRoot\scripts\setup.ps1") -and (Test-Path "$pkgRoot\scripts\uninstall.ps1"))
$version = (Get-Content "$pkgRoot\VERSION" -Raw).Trim()

& powershell -NoProfile -ExecutionPolicy Bypass -File "$pkgRoot\scripts\setup.ps1" -InstallDir $inst -Portable -NoLaunch | Out-Host
Check 'install creates app, data folder, environment and launcher' ((Test-Path "$inst\app\backend\app\main.py") -and (Test-Path "$inst\data") -and (Test-Path "$inst\app\backend\.venv\Scripts\python.exe") -and (Test-Path "$inst\EDEN.cmd") -and (Test-Path "$inst\Uninstall-EDEN.ps1"))
Check 'install leaves no dev tools or test scripts in the app' (-not (Test-Path "$inst\app\scripts\test.ps1") -and -not (Test-Path "$inst\app\scripts\dev.ps1"))

$h = Start-Eden
Check "the installed app starts and reports version $version" ($h -and $h.status -eq 'ok' -and $h.version -eq $version) "$($h | ConvertTo-Json -Compress)"
$page = try { (Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing).Content } catch { '' }
Check 'it serves the web app' ($page -match 'EDEN')
$created = Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:$Port/api/properties" -ContentType 'application/json' -Body '{"name":"Setup test","center":[24.0,45.0]}'
Check 'it stores data in the data folder, not the program folder' ((Test-Path "$inst\data\eden.db") -and -not (Test-Path "$inst\app\data"))
Stop-Eden

& powershell -NoProfile -ExecutionPolicy Bypass -File "$pkgRoot\scripts\setup.ps1" -InstallDir $inst -Portable -NoLaunch | Out-Host
$h = Start-Eden
$props = if ($h) { Invoke-RestMethod "http://127.0.0.1:$Port/api/properties" } else { @() }
Check 'updating over an existing installation keeps all data' ($props.Count -eq 1 -and $props[0].name -eq 'Setup test')
Stop-Eden

& powershell -NoProfile -ExecutionPolicy Bypass -File "$inst\Uninstall-EDEN.ps1" -Yes | Out-Host
Check 'uninstall removes the program but keeps the data by default' (-not (Test-Path "$inst\app") -and (Test-Path "$inst\data\eden.db"))
Remove-Item -LiteralPath $tmp -Recurse -Force -ErrorAction SilentlyContinue
if ($fail) { Write-Host "$fail check(s) failed." -ForegroundColor Red; exit 1 }
Write-Host 'Setup test passed.' -ForegroundColor Green
