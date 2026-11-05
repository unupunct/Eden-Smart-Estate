<#
 Downloads language data for the OCR engine (Tesseract) into EDEN's data folder.
   scripts\get-ocr-language.ps1 ron        Romanian
   scripts\get-ocr-language.ps1 eng deu    several
 Source: github.com/tesseract-ocr/tessdata_fast (Apache-2.0). About 1-5 MB per language. Then add the language in
 Settings -> Reading text from documents.
#>
param([Parameter(Mandatory = $true, ValueFromRemainingArguments = $true)][string[]]$Language, [string]$DataDir = '')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$data = if ($DataDir) { $DataDir } elseif ($env:EDEN_DATA_DIR) { $env:EDEN_DATA_DIR } elseif (Test-Path (Join-Path $root 'data')) { Join-Path $root 'data' } else { Join-Path (Split-Path -Parent $root) 'data' }
$dir = Join-Path $data 'tessdata'
New-Item -ItemType Directory -Force -Path $dir | Out-Null
foreach ($l in $Language) {
    if ($l -notmatch '^[a-z_]{3,12}$') { Write-Host "Skipping '$l': language codes look like ron, eng, deu." -ForegroundColor Yellow; continue }
    $url = "https://github.com/tesseract-ocr/tessdata_fast/raw/main/$l.traineddata"
    $target = Join-Path $dir "$l.traineddata"
    Write-Host "Downloading $url"
    try {
        Invoke-WebRequest -Uri $url -OutFile "$target.part" -UseBasicParsing
        if ((Get-Item "$target.part").Length -lt 100000) { throw 'The downloaded file is too small to be language data.' }
        Move-Item -Force "$target.part" $target
        Write-Host "Saved $target" -ForegroundColor Green
    } catch {
        Remove-Item -Force "$target.part" -ErrorAction SilentlyContinue
        Write-Host "Could not download '$l': $($_.Exception.Message)" -ForegroundColor Red
    }
}
