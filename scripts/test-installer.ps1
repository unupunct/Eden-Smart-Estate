<#
 Tests the Windows installer (release\EdenSmartEstate-Setup-<version>.exe) for real: signature, tamper detection, silent install
 into a temporary folder, update that keeps data, the installed app starting with its bundled Python, uninstall that keeps
 (or on request removes) data.
   scripts\test-installer.ps1 [-Version 1.2.0]
 Refuses to run if EDEN is already installed through this installer (the test would replace its uninstall entry).
 Needs the .exe from build-installer.ps1. Uses port 8798.
#>
param([string]$Version = '1.2.0', [int]$Port = 8798)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$exe = Join-Path $root "release\EdenSmartEstate-Setup-$Version.exe"
if (-not (Test-Path $exe)) { throw "Build the installer first: $exe is missing." }
$failures = 0
function Check($name, $ok, $extra = '') { if ($ok) { Write-Host "PASS  $name $extra" } else { Write-Host "FAIL  $name $extra" -ForegroundColor Red; $script:failures++ } }

$uninstKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\{6E1D0C58-3B7A-4F0E-9A52-ED3E25A7E001}_is1'
if (Test-Path $uninstKey) { throw 'EDEN is installed with this installer already; uninstall it first (the test would replace its entry).' }
$menu = Join-Path ([Environment]::GetFolderPath('Programs')) 'EDEN Smart Estate'
if (Test-Path $menu) { throw 'A Start Menu folder "EDEN Smart Estate" exists already; the test will not touch it.' }

# --- signature
$sig = Get-AuthenticodeSignature $exe
Check 'the installer carries an Authenticode signature' ($null -ne $sig.SignerCertificate) "($($sig.SignerCertificate.Subject))"
Check 'the signature is intact (not a hash mismatch)' ($sig.Status -ne 'HashMismatch' -and $sig.Status -ne 'NotSigned') "(status $($sig.Status))"
Check 'the signature is time-stamped' ($null -ne $sig.TimeStamperCertificate)
$tmp = Join-Path ([IO.Path]::GetTempPath()) ('eden-inst-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $tmp | Out-Null
$copy = Join-Path $tmp 'tampered.exe'
Copy-Item $exe $copy
$fs = [IO.File]::Open($copy, 'Open', 'ReadWrite'); $fs.Seek(200000, 'Begin') | Out-Null; $b = $fs.ReadByte(); $fs.Seek(200000, 'Begin') | Out-Null; $fs.WriteByte(($b + 1) -band 255); $fs.Close()
Check 'changing one byte breaks the signature' ((Get-AuthenticodeSignature $copy).Status -eq 'HashMismatch')

function Run-Exe($file, $argString) {
    $p = Start-Process -FilePath $file -ArgumentList $argString -Wait -PassThru
    return $p.ExitCode
}
$dir = Join-Path $tmp 'EDEN Test'
$log = Join-Path $tmp 'install.log'
$install = "/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /SP- /TASKS=`"`" /DIR=`"$dir`" /LOG=`"$log`""
try {
    # --- install
    Check 'silent install succeeds' ((Run-Exe $exe $install) -eq 0)
    $app = Join-Path $dir 'app'
    Check 'bundled Python is installed' (Test-Path (Join-Path $app 'python\python.exe'))
    Check 'web app is installed' (Test-Path (Join-Path $app 'frontend\dist\index.html'))
    Check 'launcher and data folder exist' ((Test-Path (Join-Path $dir 'EDEN.cmd')) -and (Test-Path (Join-Path $dir 'data')))
    Check 'it is listed in Installed apps' (Test-Path $uninstKey)
    Check 'a Start Menu shortcut exists' (Test-Path (Join-Path $menu 'EDEN Smart Estate.lnk'))
    $pySig = Get-AuthenticodeSignature (Join-Path $app 'python\python.exe')
    Check 'the bundled python.exe keeps its Python Software Foundation signature' ($pySig.Status -eq 'Valid')

    # --- data survives an update
    Set-Content -Path (Join-Path $dir 'data\marker.txt') -Value 'my data' -Encoding ASCII
    Check 'installing again (update) succeeds' ((Run-Exe $exe $install) -eq 0)
    Check 'your data is untouched by the update' ((Get-Content (Join-Path $dir 'data\marker.txt') -Raw).Trim() -eq 'my data')

    # --- the installed app runs with ITS Python, nothing else
    $env:EDEN_DATA_DIR = Join-Path $dir 'data'; $env:EDEN_POLL_SECONDS = '0'
    $srv = Start-Process -FilePath (Join-Path $app 'python\python.exe') -ArgumentList "-m uvicorn app.main:app --host 127.0.0.1 --port $Port --log-level warning" -WorkingDirectory (Join-Path $app 'backend') -PassThru -WindowStyle Hidden
    $up = $false
    for ($i = 0; $i -lt 60; $i++) { try { if ((Invoke-WebRequest "http://127.0.0.1:$Port/api/health" -UseBasicParsing).StatusCode -eq 200) { $up = $true; break } } catch { }; Start-Sleep -Milliseconds 500 }
    Check 'the installed server starts with the bundled Python' $up
    if ($up) {
        $h = (Invoke-RestMethod "http://127.0.0.1:$Port/api/health")
        Check 'it reports the right version' ($h.version -eq $Version) "($($h.version))"
        Check 'the web app is served' ((Invoke-WebRequest "http://127.0.0.1:$Port/" -UseBasicParsing).Content -match '<div id="root"')
        $st = Invoke-RestMethod "http://127.0.0.1:$Port/api/auth/status"
        Check 'no admin account yet, setup offered on this computer' (($st.required -eq $false) -and ($st.setupAvailable -eq $true))
        Check 'the push public key can be created (cryptography works in the bundle)' ((Invoke-RestMethod "http://127.0.0.1:$Port/api/push/status").publicKey.Length -gt 40)
        Check 'the OCR status answers' ($null -ne (Invoke-RestMethod "http://127.0.0.1:$Port/api/ocr/status").available)
    }
    if ($srv -and -not $srv.HasExited) { Stop-Process -Id $srv.Id -Force }
    Remove-Item Env:EDEN_DATA_DIR, Env:EDEN_POLL_SECONDS -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800

    # --- uninstall keeps data by default
    $unins = Get-ChildItem $dir -Filter 'unins*.exe' | Select-Object -First 1
    Check 'an uninstaller was installed and is signed' ($unins -and ((Get-AuthenticodeSignature $unins.FullName).SignerCertificate -ne $null))
    Check 'silent uninstall succeeds' ((Run-Exe $unins.FullName '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART') -eq 0)
    for ($i = 0; $i -lt 40 -and (Test-Path (Join-Path $dir 'app')); $i++) { Start-Sleep -Milliseconds 500 }
    Check 'the program files are gone' (-not (Test-Path (Join-Path $dir 'app')))
    Check 'your data is kept' ((Test-Path (Join-Path $dir 'data\marker.txt')))
    Check 'the Installed apps entry and the Start Menu folder are gone' ((-not (Test-Path $uninstKey)) -and (-not (Test-Path $menu)))

    # --- reinstall finds the data again; uninstall with /REMOVEDATA=1 removes everything
    Check 'reinstalling keeps finding the data' (((Run-Exe $exe $install) -eq 0) -and (Test-Path (Join-Path $dir 'data\marker.txt')))
    $unins = Get-ChildItem $dir -Filter 'unins*.exe' | Select-Object -First 1
    $code = Run-Exe $unins.FullName '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /REMOVEDATA=1'
    for ($i = 0; $i -lt 40 -and (Test-Path (Join-Path $dir 'data')); $i++) { Start-Sleep -Milliseconds 500 }   # the uninstaller finishes in a second process
    Check 'uninstall with /REMOVEDATA=1 removes the data too' (($code -eq 0) -and (-not (Test-Path (Join-Path $dir 'data'))))
} finally {
    if (Test-Path $uninstKey) { $u = Get-ChildItem $dir -Filter 'unins*.exe' -ErrorAction SilentlyContinue | Select-Object -First 1; if ($u) { Start-Process $u.FullName '/VERYSILENT /SUPPRESSMSGBOXES /NORESTART /REMOVEDATA=1' -Wait } }
    Start-Sleep -Seconds 1
    Remove-Item -Recurse -Force $tmp -ErrorAction SilentlyContinue
}
if ($failures) { Write-Host "$failures check(s) FAILED" -ForegroundColor Red; exit 1 }
Write-Host 'Installer test passed.' -ForegroundColor Green
