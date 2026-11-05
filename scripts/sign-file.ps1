<#
 Signs a file (Authenticode, SHA-256, with an RFC 3161 timestamp). Used by build-installer.ps1 for the installer and uninstaller.

 Which certificate is used, in this order:
   1. EDEN_SIGN_PFX (path to a .pfx file) with EDEN_SIGN_PFX_PASSWORD      <- a real code-signing certificate from a certificate authority
   2. EDEN_SIGN_THUMBPRINT (a certificate in your Windows "Personal" store, for example one on a hardware token)
   3. a certificate in your Personal store whose subject starts with "CN=EDEN Smart Estate" (made by scripts\new-signing-cert.ps1,
      SELF-SIGNED: the signature is valid and proves the file was not changed, but Windows does not know the signer,
      so SmartScreen still warns until a certificate authority's certificate is used)

 The timestamp keeps the signature valid after the certificate expires. It is requested from a public timestamp service (only a hash of the
 signature is sent). Set EDEN_SIGN_NO_TIMESTAMP=1 to skip it (not recommended).
#>
param([Parameter(Mandatory = $true)][string]$File)
$ErrorActionPreference = 'Stop'
if (-not (Test-Path -LiteralPath $File)) { throw "File not found: $File" }

$cert = $null
if ($env:EDEN_SIGN_PFX) {
    $pw = if ($env:EDEN_SIGN_PFX_PASSWORD) { ConvertTo-SecureString $env:EDEN_SIGN_PFX_PASSWORD -AsPlainText -Force } else { $null }
    $cert = Get-PfxCertificate -FilePath $env:EDEN_SIGN_PFX -Password $pw
} elseif ($env:EDEN_SIGN_THUMBPRINT) {
    $cert = Get-ChildItem Cert:\CurrentUser\My, Cert:\LocalMachine\My -ErrorAction SilentlyContinue | Where-Object { $_.Thumbprint -eq $env:EDEN_SIGN_THUMBPRINT -and $_.HasPrivateKey } | Select-Object -First 1
} else {
    $cert = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -like 'CN=EDEN Smart Estate*' -and $_.NotAfter -gt (Get-Date) } | Sort-Object NotAfter -Descending | Select-Object -First 1
}
if (-not $cert) { throw 'No code-signing certificate found. Run scripts\new-signing-cert.ps1 (self-signed) or set EDEN_SIGN_PFX / EDEN_SIGN_THUMBPRINT to a real one.' }

$servers = @('http://timestamp.digicert.com', 'http://timestamp.sectigo.com', 'http://timestamp.globalsign.com/tsa/r6advanced1')
$done = $false
if ($env:EDEN_SIGN_NO_TIMESTAMP -eq '1') {
    $r = Set-AuthenticodeSignature -FilePath $File -Certificate $cert -HashAlgorithm SHA256
    $done = $r.SignerCertificate -ne $null
} else {
    foreach ($ts in $servers) {
        try {
            $r = Set-AuthenticodeSignature -FilePath $File -Certificate $cert -HashAlgorithm SHA256 -TimestampServer $ts
            if ($r.TimeStamperCertificate) { $done = $true; break }
        } catch { Write-Host "Timestamp server $ts failed: $($_.Exception.Message)" -ForegroundColor Yellow }
    }
    if (-not $done) { throw 'Could not get a timestamp from any timestamp service (are you online?). Not signing without one; set EDEN_SIGN_NO_TIMESTAMP=1 to override.' }
}
Write-Host "Signed $(Split-Path -Leaf $File) as '$($cert.Subject)' (thumbprint $($cert.Thumbprint))"
