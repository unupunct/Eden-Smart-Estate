<#
 Builds release\EdenSmartEstate-Setup-<version>.exe: a signed Windows installer that brings its own Python (no Python needed on the PC).

   scripts\build-installer.ps1                 build (and sign) version 1.2.0 from this source tree
   scripts\build-installer.ps1 -Version 1.3.0
   scripts\build-installer.ps1 -NoSign         unsigned build (testing only)
   scripts\build-installer.ps1 -SkipPackage    reuse release\stage from a previous package.ps1 run

 Needs on the build machine: Node.js 20+ (builds the web app), Python 3.13 in backend\.venv (installs the components),
 Inno Setup 6 (winget install JRSoftware.InnoSetup) and, for signing, a code-signing certificate (see scripts\sign-file.ps1).
 Bundled Python: the official embeddable package from python.org, checked against a pinned SHA-256 and its Authenticode
 signature (Python Software Foundation) before use.
#>
param(
    [string]$Version = '1.2.0',
    [switch]$NoSign,
    [switch]$SkipPackage
)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$pyVersion = '3.13.15'
$pyZipSha256 = 'D1F04D990AEE1253D8569E8E5104E30FA9F5FA830899F14843448872D936A2CF'
$pyUrl = "https://www.python.org/ftp/python/$pyVersion/python-$pyVersion-embed-amd64.zip"

# --- tools
$iscc = @($env:EDEN_ISCC, (Get-Command ISCC.exe -ErrorAction SilentlyContinue).Source,
    (Join-Path $env:LOCALAPPDATA 'Programs\Inno Setup 6\ISCC.exe'), 'C:\Program Files (x86)\Inno Setup 6\ISCC.exe', 'C:\Program Files\Inno Setup 6\ISCC.exe') |
    Where-Object { $_ -and (Test-Path $_) } | Select-Object -First 1
if (-not $iscc) { throw 'Inno Setup 6 was not found. Install it with: winget install JRSoftware.InnoSetup' }
$hostPy = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $hostPy)) { throw 'backend\.venv is missing (run scripts\install.ps1 once).' }
$hostVer = if (((& $hostPy --version 2>&1) -join ' ') -match 'Python (\d+\.\d+)') { $Matches[1] } else { 'unknown' }
if ($hostVer -ne ($pyVersion -replace '^(\d+\.\d+).*', '$1')) { throw "backend\.venv is Python $hostVer but the bundled Python is ${pyVersion}; the compiled components would not match." }

# --- the staged app (web app built, backend, docs)
if (-not $SkipPackage) { & (Join-Path $PSScriptRoot 'package.ps1') -Version $Version }
$stage = Join-Path $root 'release\stage\EdenSmartEstate'
if (-not (Test-Path (Join-Path $stage 'frontend\dist\index.html'))) { throw 'release\stage is missing: run without -SkipPackage.' }
$istage = Join-Path $root 'release\installer-stage'
if (Test-Path $istage) { Remove-Item -Recurse -Force $istage }
$null = robocopy $stage $istage /MIR /NFL /NDL /NJH /NJS /NP
if ($LASTEXITCODE -ge 8) { throw "robocopy failed ($LASTEXITCODE)" }
foreach ($f in 'Install-EDEN.cmd', 'scripts\setup.ps1', 'scripts\install.ps1', 'scripts\uninstall.ps1') { Remove-Item -Force -ErrorAction SilentlyContinue (Join-Path $istage $f) }

# --- bundled Python (official embeddable build, verified)
$cache = Join-Path $root '.tools\python-embed'
New-Item -ItemType Directory -Force -Path $cache | Out-Null
$zip = Join-Path $cache "python-$pyVersion-embed-amd64.zip"
if (-not (Test-Path $zip)) { Write-Host "Downloading $pyUrl"; Invoke-WebRequest -Uri $pyUrl -OutFile $zip -UseBasicParsing }
$hash = (Get-FileHash $zip -Algorithm SHA256).Hash
if ($hash -ne $pyZipSha256) { Remove-Item -Force $zip; throw "The downloaded Python package has an unexpected SHA-256 ($hash). Deleted. Not building." }
$pyDir = Join-Path $istage 'python'
Expand-Archive -Path $zip -DestinationPath $pyDir -Force
$sig = Get-AuthenticodeSignature (Join-Path $pyDir 'python.exe')
if ($sig.Status -ne 'Valid' -or $sig.SignerCertificate.Subject -notlike '*Python Software Foundation*') { throw "python.exe is not validly signed by the Python Software Foundation ($($sig.Status))." }
$pth = Get-ChildItem $pyDir -Filter 'python*._pth' | Select-Object -First 1
$zipName = (Get-ChildItem $pyDir -Filter 'python*.zip' | Select-Object -First 1).Name
Set-Content -Path $pth.FullName -Encoding ASCII -Value @($zipName, '.', '..\backend', 'Lib\site-packages', 'import site')

# --- components (compiled wheels for this Python, no source builds)
$site = Join-Path $pyDir 'Lib\site-packages'
New-Item -ItemType Directory -Force -Path $site | Out-Null
Write-Host 'Installing components into the bundled Python...' -ForegroundColor Cyan
# step 1: collect wheels (compiled packages come as published binary wheels; pure-Python packages that publish only source, such as
# http-ece, are built into wheels here: that needs no compiler). step 2: install only from those wheels.
$wheels = Join-Path $root '.tools\wheels'
if (Test-Path $wheels) { Remove-Item -Recurse -Force $wheels }
& $hostPy -m pip wheel --quiet --disable-pip-version-check --wheel-dir $wheels -r (Join-Path $root 'backend\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip wheel failed' }
& $hostPy -m pip install --quiet --disable-pip-version-check --target $site --no-index --find-links $wheels --only-binary=:all: --no-compile -r (Join-Path $root 'backend\requirements.txt')
if ($LASTEXITCODE -ne 0) { throw 'pip install failed' }
Get-ChildItem -Recurse -Directory -Filter '__pycache__' $istage | Remove-Item -Recurse -Force
Get-ChildItem $site -Directory -Filter 'pip*' | Remove-Item -Recurse -Force -ErrorAction SilentlyContinue

# --- smoke test: the staged app starts with the bundled Python alone
$tmpData = Join-Path ([IO.Path]::GetTempPath()) ("eden-build-" + [Guid]::NewGuid().ToString('N'))
$env:EDEN_DATA_DIR = $tmpData
Push-Location (Join-Path $istage 'backend')
try {
    $probe = Join-Path $tmpData 'probe.py'
    New-Item -ItemType Directory -Force -Path $tmpData | Out-Null
    Set-Content -Path $probe -Encoding ASCII -Value @('import app.main, pywebpush, pypdf, cryptography, paho.mqtt, httpx, uvicorn', "print('IMPORTS_OK')")
    $out = & (Join-Path $pyDir 'python.exe') $probe 2>&1
    if (($out -join '') -notmatch 'IMPORTS_OK') { throw "The staged app does not start with the bundled Python:`n$out" }
} finally { Pop-Location; Remove-Item Env:EDEN_DATA_DIR -ErrorAction SilentlyContinue; Remove-Item -Recurse -Force $tmpData -ErrorAction SilentlyContinue }
$sizeMb = [math]::Round((Get-ChildItem $istage -Recurse -File | Measure-Object Length -Sum).Sum / 1MB)
Write-Host "Staged app: $sizeMb MB" -ForegroundColor Green

# --- compile (and sign) the installer
$outDir = Join-Path $root 'release'
$exe = Join-Path $outDir "EdenSmartEstate-Setup-$Version.exe"
if (Test-Path $exe) { Remove-Item -Force $exe }
# the command line is assembled by hand: paths contain spaces and the signing command contains quotes of its own
$q = '"'
$cmdline = "/DVersion=$Version ${q}/DStage=$istage${q} ${q}/DOutDir=$outDir${q}"
if (-not $NoSign) {
    # Inno Setup passes the signing command on without keeping quotes around the script path, so the script is called from a
    # copy in the temp folder (a path without spaces)
    $signScript = Join-Path ([IO.Path]::GetTempPath()) 'eden-sign-file.ps1'
    if ($signScript -match '\s') { throw "The temp folder path contains a space ($signScript); set TEMP to a folder without spaces to sign." }
    Copy-Item -Force (Join-Path $PSScriptRoot 'sign-file.ps1') $signScript
    $cmdline += " /DSign=1 ${q}/Sedensign=powershell -NoProfile -ExecutionPolicy Bypass -File $signScript ${q}${q}`$f${q}${q}${q}"
}
$cmdline += " ${q}$(Join-Path $root 'installer\eden.iss')${q}"
$p = Start-Process -FilePath $iscc -ArgumentList $cmdline -Wait -NoNewWindow -PassThru
if ($p.ExitCode -ne 0) { throw "Inno Setup failed ($($p.ExitCode))" }

# --- report
$s = Get-AuthenticodeSignature $exe
Write-Host ''
Write-Host "Created $exe ($([math]::Round((Get-Item $exe).Length / 1MB)) MB)" -ForegroundColor Green
if ($NoSign) { Write-Host 'NOT SIGNED (-NoSign).' -ForegroundColor Yellow }
else {
    Write-Host "Signature: $($s.Status) - signer: $($s.SignerCertificate.Subject) - timestamp: $(if ($s.TimeStamperCertificate) { $s.TimeStamperCertificate.Subject } else { 'none' })"
    if ($s.Status -eq 'Valid') { Write-Host 'Signed with a certificate Windows trusts.' -ForegroundColor Green }
    elseif ($s.SignerCertificate -and $s.StatusMessage -match 'not trusted|untrusted|root') { Write-Host 'The signature is intact, but the signer is a self-signed certificate that Windows does not trust: SmartScreen / "Unknown publisher" will still appear. Use a certificate authority certificate to remove that (scripts\sign-file.ps1).' -ForegroundColor Yellow }
    else { Write-Host "Signature problem: $($s.StatusMessage)" -ForegroundColor Red }
}
$sums = Join-Path $outDir 'SHA256SUMS.txt'
$lines = foreach ($f in @($exe, (Join-Path $outDir "EdenSmartEstate-$Version.zip"))) { if (Test-Path $f) { "{0}  {1}" -f (Get-FileHash $f -Algorithm SHA256).Hash.ToLower(), (Split-Path -Leaf $f) } }
Set-Content -Path $sums -Value $lines -Encoding ASCII
Write-Host "Checksums: $sums"
