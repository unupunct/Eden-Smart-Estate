<#
 Creates a SELF-SIGNED code-signing certificate in your Windows Personal store (current user) and exports its public part to
 installer\eden-signing.cer so anyone can compare the thumbprint.

 Read this first: a self-signed certificate is NOT trusted by Windows. A file signed with it carries a cryptographically valid
 signature (any change to the file breaks it, and the signer's name and thumbprint can be checked), but SmartScreen and the
 "Unknown publisher" prompt do not go away. They go away only with a certificate issued by a certificate authority after it checked
 who you are (an OV/EV code-signing certificate, Azure Trusted Signing, or SignPath Foundation's free signing for open-source
 projects). When you have one, set EDEN_SIGN_PFX / EDEN_SIGN_THUMBPRINT (see scripts\sign-file.ps1): nothing else changes.

 This script does not add anything to Windows' trusted root store and does not touch any security setting.
 Back up the private key if you want to sign future releases with the same identity:
   Export-PfxCertificate -Cert Cert:\CurrentUser\My\<thumbprint> -FilePath eden-signing.pfx -Password (Read-Host -AsSecureString)
#>
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$subject = 'CN=EDEN Smart Estate (self-signed), O=unupunct'
$existing = Get-ChildItem Cert:\CurrentUser\My -CodeSigningCert | Where-Object { $_.Subject -eq $subject -and $_.NotAfter -gt (Get-Date).AddDays(30) } | Sort-Object NotAfter -Descending | Select-Object -First 1
if ($existing) {
    Write-Host "A usable certificate already exists: $($existing.Thumbprint) (valid until $($existing.NotAfter.ToString('yyyy-MM-dd')))" -ForegroundColor Green
    $cert = $existing
} else {
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $subject -KeyAlgorithm RSA -KeyLength 3072 -HashAlgorithm SHA256 `
        -KeyUsage DigitalSignature -KeyExportPolicy Exportable -CertStoreLocation Cert:\CurrentUser\My -NotAfter (Get-Date).AddYears(5)
    Write-Host "Created $($cert.Thumbprint) (valid until $($cert.NotAfter.ToString('yyyy-MM-dd')))" -ForegroundColor Green
}
$out = Join-Path $root 'installer\eden-signing.cer'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $out) | Out-Null
Export-Certificate -Cert $cert -FilePath $out -Type CERT | Out-Null
Write-Host "Public certificate: $out"
Write-Host "Thumbprint (SHA-1): $($cert.Thumbprint)"
Write-Host 'SELF-SIGNED: Windows will still say "Unknown publisher" until a certificate authority issues the certificate.' -ForegroundColor Yellow
