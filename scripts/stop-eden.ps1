<#
 Stops a running EDEN server that belongs to the given installation folder (used by the installer before it replaces files).
   stop-eden.ps1 -Dir "C:\Users\me\AppData\Local\EDEN\app"
#>
param([Parameter(Mandatory = $true)][string]$Dir)
$prefix = ([System.IO.Path]::GetFullPath($Dir)).TrimEnd('\') + '\'
Get-CimInstance Win32_Process -Filter "Name='python.exe' OR Name='pythonw.exe'" -ErrorAction SilentlyContinue |
    Where-Object { $_.ExecutablePath -and $_.ExecutablePath.StartsWith($prefix, [StringComparison]::OrdinalIgnoreCase) -or ($_.CommandLine -and $_.CommandLine -like "*$prefix*") } |
    ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }
Start-Sleep -Milliseconds 600
exit 0
