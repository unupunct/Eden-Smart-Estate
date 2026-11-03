<# Development mode: API with auto-reload on :8787 and the Vite dev server (hot reload) on :5173. #>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$py = Join-Path $root 'backend\.venv\Scripts\python.exe'
if (-not (Test-Path $py)) { Write-Host 'Run scripts\install.ps1 first.' -ForegroundColor Red; exit 1 }
$api = Start-Process -PassThru -NoNewWindow -WorkingDirectory (Join-Path $root 'backend') -FilePath $py -ArgumentList '-m', 'uvicorn', 'app.main:app', '--reload', '--port', '8787'
try {
    Push-Location (Join-Path $root 'frontend')
    if (-not (Test-Path node_modules)) { npm ci --no-audit --no-fund }
    Start-Job -ScriptBlock { Start-Sleep 3; Start-Process 'http://localhost:5173' } | Out-Null
    npm run dev
} finally {
    Pop-Location
    if ($api -and -not $api.HasExited) { Stop-Process -Id $api.Id -Force }
}
