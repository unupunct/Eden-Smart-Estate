"""Self-signed HTTPS certificate for EDEN (start.ps1 -Https).

Encrypts traffic between your devices and EDEN so the password and your data cannot be read on the network. The certificate is
created on this computer, lives in <data>/tls and covers localhost, this computer's name and the addresses you pass in. It is
self-signed, so browsers warn once: compare the fingerprint printed at start-up, then continue (or add the certificate to the
trusted store of the device). It is regenerated automatically when it is about to expire or a new address is needed.
"""
import argparse
import datetime as dt
import hashlib
import ipaddress
import os
import socket
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import ec
from cryptography.x509.oid import NameOID

VALID_DAYS = 365
RENEW_BEFORE_DAYS = 30


def _san(names: list[str]) -> list[x509.GeneralName]:
    out: list[x509.GeneralName] = []
    seen: set[str] = set()
    for n in names:
        n = n.strip()
        if not n or n in seen:
            continue
        seen.add(n)
        try:
            out.append(x509.IPAddress(ipaddress.ip_address(n)))
        except ValueError:
            out.append(x509.DNSName(n))
    return out


def _wanted(extra: list[str]) -> list[str]:
    return ["localhost", "127.0.0.1", "::1", socket.gethostname(), *extra]


def _covers(cert: x509.Certificate, names: list[str]) -> bool:
    try:
        san = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    except x509.ExtensionNotFound:
        return False
    have = {str(i) for i in san.get_values_for_type(x509.IPAddress)} | set(san.get_values_for_type(x509.DNSName))
    need = set()
    for g in _san(names):
        need.add(str(g.value))
    return need <= have


def fingerprint(cert: x509.Certificate) -> str:
    h = hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest().upper()
    return ":".join(h[i:i + 2] for i in range(0, len(h), 2))


def ensure_certificate(data_dir: Path, extra_names: list[str] | None = None, now: dt.datetime | None = None) -> tuple[Path, Path, str]:
    """Return (certificate file, key file, SHA-256 fingerprint), creating or renewing the certificate when needed."""
    now = now or dt.datetime.now(dt.timezone.utc)
    names = _wanted(extra_names or [])
    folder = data_dir / "tls"
    folder.mkdir(parents=True, exist_ok=True)
    cert_path, key_path = folder / "eden-cert.pem", folder / "eden-key.pem"
    if cert_path.exists() and key_path.exists():
        try:
            cert = x509.load_pem_x509_certificate(cert_path.read_bytes())
            if cert.not_valid_after_utc - now > dt.timedelta(days=RENEW_BEFORE_DAYS) and cert.not_valid_before_utc <= now and _covers(cert, names):
                return cert_path, key_path, fingerprint(cert)
        except ValueError:
            pass  # unreadable: make a new one
    key = ec.generate_private_key(ec.SECP256R1())
    subject = issuer = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, "EDEN Smart Estate"), x509.NameAttribute(NameOID.ORGANIZATION_NAME, "EDEN Smart Estate (self-signed)")])
    cert = (
        x509.CertificateBuilder().subject_name(subject).issuer_name(issuer).public_key(key.public_key()).serial_number(x509.random_serial_number())
        .not_valid_before(now - dt.timedelta(minutes=5)).not_valid_after(now + dt.timedelta(days=VALID_DAYS))
        .add_extension(x509.SubjectAlternativeName(_san(names)), critical=False)
        .add_extension(x509.BasicConstraints(ca=False, path_length=None), critical=True)
        .add_extension(x509.ExtendedKeyUsage([x509.oid.ExtendedKeyUsageOID.SERVER_AUTH]), critical=False)
        .sign(key, hashes.SHA256())
    )
    key_path.write_bytes(key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption()))
    try:
        os.chmod(key_path, 0o600)
    except OSError:
        pass  # Windows: the file lives in your own data folder
    cert_path.write_bytes(cert.public_bytes(serialization.Encoding.PEM))
    return cert_path, key_path, fingerprint(cert)


def main() -> None:
    ap = argparse.ArgumentParser(description="Create or reuse EDEN's self-signed HTTPS certificate")
    ap.add_argument("--dir", required=True, help="the EDEN data folder")
    ap.add_argument("--name", action="append", default=[], help="extra host name or IP address the certificate must cover (repeatable)")
    a = ap.parse_args()
    cert, key, fp = ensure_certificate(Path(a.dir), a.name)
    print(f"CERT={cert}")
    print(f"KEY={key}")
    print(f"FINGERPRINT={fp}")


if __name__ == "__main__":
    main()
