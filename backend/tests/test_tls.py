"""Self-signed HTTPS certificate: creation, reuse, renewal, a real TLS handshake and the Secure cookie flag."""
import datetime as dt
import socket
import threading
import time

import httpx
import pytest
import uvicorn
from cryptography import x509
from fastapi.testclient import TestClient

from app import auth, config, tls


def load(path):
    return x509.load_pem_x509_certificate(path.read_bytes())


def san(cert):
    ext = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value
    return {str(i) for i in ext.get_values_for_type(x509.IPAddress)} | set(ext.get_values_for_type(x509.DNSName))


def test_certificate_covers_localhost_this_computer_and_the_given_addresses(tmp_path):
    cert_path, key_path, fp = tls.ensure_certificate(tmp_path, ["192.168.1.20", "eden.lan"])
    cert = load(cert_path)
    names = san(cert)
    assert {"localhost", "127.0.0.1", "::1", "192.168.1.20", "eden.lan", socket.gethostname()} <= names
    assert key_path.read_bytes().startswith(b"-----BEGIN PRIVATE KEY-----")
    assert fp == tls.fingerprint(cert) and len(fp.split(":")) == 32
    left = cert.not_valid_after_utc - dt.datetime.now(dt.timezone.utc)
    assert dt.timedelta(days=360) < left <= dt.timedelta(days=366)
    assert not cert.extensions.get_extension_for_class(x509.BasicConstraints).value.ca  # a server certificate, not a CA


def test_it_is_reused_until_a_new_address_is_needed_or_expiry_nears(tmp_path):
    a = tls.ensure_certificate(tmp_path, ["192.168.1.20"])
    assert tls.ensure_certificate(tmp_path, ["192.168.1.20"])[2] == a[2]  # same fingerprint: reused
    assert tls.ensure_certificate(tmp_path, [])[2] == a[2]  # fewer names needed: still fine
    b = tls.ensure_certificate(tmp_path, ["192.168.1.99"])
    assert b[2] != a[2] and "192.168.1.99" in san(load(b[0]))  # new address: regenerated
    soon = dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=tls.VALID_DAYS - 10)
    c = tls.ensure_certificate(tmp_path, ["192.168.1.99"], now=soon)
    assert c[2] != b[2]  # within 30 days of expiry: renewed


def test_a_damaged_certificate_file_is_replaced(tmp_path):
    cert_path, _key, fp = tls.ensure_certificate(tmp_path)
    cert_path.write_text("not a certificate")
    assert tls.ensure_certificate(tmp_path)[2] != fp


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_the_server_really_speaks_https_with_that_certificate(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "POLL_SECONDS", 0)
    cert, key, _ = tls.ensure_certificate(tmp_path)
    from app.main import app
    port = free_port()
    server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=port, ssl_certfile=str(cert), ssl_keyfile=str(key), log_level="error"))
    t = threading.Thread(target=server.run, daemon=True)
    t.start()
    try:
        for _ in range(80):
            if server.started:
                break
            time.sleep(0.1)
        assert server.started
        r = httpx.get(f"https://127.0.0.1:{port}/api/health", verify=str(cert))  # trusted only because we pinned this certificate
        assert r.status_code == 200 and r.json()["status"] == "ok"
        with pytest.raises(httpx.ConnectError):
            httpx.get(f"https://127.0.0.1:{port}/api/health")  # the system does not trust it: the browser warning is real
        with pytest.raises(httpx.HTTPError):
            httpx.get(f"http://127.0.0.1:{port}/api/health")  # plain HTTP is not answered
    finally:
        server.should_exit = True
        t.join(timeout=10)


def test_the_session_cookie_is_marked_secure_only_over_https(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "POLL_SECONDS", 0)
    monkeypatch.setattr(config, "PASSWORD", "s3cret")
    auth._fails.clear()
    from app.main import app
    with TestClient(app, base_url="https://testserver") as c:
        assert "secure" in c.post("/api/auth/login", json={"password": "s3cret"}).headers["set-cookie"].lower()
    with TestClient(app, base_url="http://testserver") as c:
        assert "secure" not in c.post("/api/auth/login", json={"password": "s3cret"}).headers["set-cookie"].lower()
