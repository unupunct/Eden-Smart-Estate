# Code signing: what it is, what this release has, and how to get the real thing

## The short version

`EdenSmartEstate-Setup-<version>.exe` (and its uninstaller) are **Authenticode-signed** and **time-stamped**. This release is signed with a **self-signed certificate**. That gives you two things and withholds one:

| | Self-signed (this release) | Certificate-authority certificate (the goal) |
|---|---|---|
| Any change to the file after signing breaks the signature (tamper detection) | ✅ | ✅ |
| The signer is identifiable (name + fingerprint you can compare) | ✅ if you compare the fingerprint below | ✅ |
| The signature stays valid after the certificate expires (time-stamp) | ✅ | ✅ |
| Windows recognises the signer, so **SmartScreen / "Unknown publisher" go away** | ❌ | ✅ (after the certificate builds reputation; instantly with EV) |

A self-signed certificate **cannot** remove the Windows warning: Windows only trusts signers whose identity a certificate authority has verified, and EDEN's maintainer has not been through that process yet. Nothing in the build pretends otherwise: `scripts\build-installer.ps1` prints whether the signature is trusted, and the installer's own page says "Unknown publisher" when it is not.

## Checking the installer you downloaded

1. **Checksum.** Compare with `SHA256SUMS.txt` on the release page:

   ```powershell
   Get-FileHash .\EdenSmartEstate-Setup-1.2.0.exe -Algorithm SHA256
   ```

2. **Signature and signer.**

   ```powershell
   Get-AuthenticodeSignature .\EdenSmartEstate-Setup-1.2.0.exe | Format-List Status, StatusMessage, SignerCertificate, TimeStamperCertificate
   ```

   Expect `Status: UnknownError` with the message *"A certificate chain processed, but terminated in a root certificate which is not trusted"* (that is the self-signed case; `HashMismatch` would mean the file was altered, and `NotSigned` that the signature is missing). The signer must be:

   | | |
   |---|---|
   | Subject | `CN=EDEN Smart Estate (self-signed), O=unupunct` |
   | SHA-1 thumbprint | `F4F8DF6EC2B12C5922D739FBABB95E1205BAC4EF` |
   | Valid | 2026-11-05 to 2031-11-05 |
   | Public certificate | `installer/eden-signing.cer` in the repository |

   Time-stamp: DigiCert's public time-stamp service.

3. **Then, if you trust it:** *More info → Run anyway* in SmartScreen. Do **not** install the certificate into Windows' *Trusted Root* store to silence the prompt: that would make Windows trust anything signed with it, and it is not needed.

## What the build does

`scripts\build-installer.ps1`:

1. builds the web app and stages the program;
2. downloads the official **embeddable Python** from python.org, checks it against a **pinned SHA-256** and its own **Authenticode signature** (Python Software Foundation) and refuses to continue otherwise;
3. installs the components into it from wheels (no compiler involved) and starts it once as a smoke test;
4. compiles the installer with Inno Setup and signs **both** the installer and the uninstaller through `scripts\sign-file.ps1` (SHA-256, RFC 3161 time-stamp from DigiCert, falling back to Sectigo and GlobalSign; it refuses to sign without a time-stamp unless you set `EDEN_SIGN_NO_TIMESTAMP=1`);
5. verifies the result and writes `release\SHA256SUMS.txt`.

`scripts\test-installer.ps1` then really installs it into a temporary folder, updates it, runs it with the bundled Python, uninstalls it (keeping the data, then removing it with `/REMOVEDATA=1`), and proves a one-byte change breaks the signature.

## How to get the real thing (and use it)

Any of these produces a certificate Windows trusts. Pick one:

| Route | Cost | Notes |
|---|---|---|
| **SignPath Foundation** (<https://signpath.org/>) | free for open-source projects | Application and identity checks by them; signing happens in their service, usually driven from GitHub Actions. Fits this MIT-licensed project. |
| **Azure Trusted Signing** (<https://azure.microsoft.com/products/trusted-signing>) | a few dollars a month | Microsoft verifies identity; no certificate file to look after. Needs an Azure subscription and its signing dlib. |
| **An OV code-signing certificate** from a certificate authority (Sectigo, DigiCert, SSL.com, ...) | roughly 100-400 USD per year | Since 2023 the private key must live on a hardware token or an HSM, so you sign from the machine the token is plugged into. SmartScreen reputation builds up over time. |
| **An EV certificate** | roughly 250-600 USD per year | Hardware token; SmartScreen trusts it immediately. |

Nobody can do the identity verification for you, which is why this release is self-signed. Once you have a certificate, signing needs no code change. `scripts\sign-file.ps1` takes the certificate from, in this order:

1. `EDEN_SIGN_PFX` (path to a `.pfx`) and `EDEN_SIGN_PFX_PASSWORD`;
2. `EDEN_SIGN_THUMBPRINT` (a certificate in your Windows *Personal* store, which is how a hardware token appears);
3. a self-signed certificate made by `scripts\new-signing-cert.ps1`.

```powershell
$env:EDEN_SIGN_THUMBPRINT = '<thumbprint of your token certificate>'
scripts\build-installer.ps1 -Version 1.3.0
```

For SignPath or Azure Trusted Signing the usual route is a GitHub Actions workflow that builds on `windows-latest` with `scripts\build-installer.ps1 -NoSign` and submits the `.exe` to the service; the build script already produces the unsigned installer for that. (That workflow is not included here because it needs your account.)

## What stays the same either way

EDEN is open source: you can read every script, build the installer yourself (`scripts\build-installer.ps1`) and compare its contents with a download. The older route (zip + `Install-EDEN.cmd`, using your own Python) remains available for anyone who prefers not to run an `.exe` at all.
