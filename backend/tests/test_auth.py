"""Optional password protection."""
import time

import pytest
from fastapi.testclient import TestClient

from app import auth, config


@pytest.fixture()
def make_client(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "POLL_SECONDS", 0)
    auth._fails.clear()
    clients = []

    def make(password=""):
        monkeypatch.setattr(config, "PASSWORD", password)
        c = TestClient(__import__("app.main", fromlist=["app"]).app)
        c.__enter__()
        clients.append(c)
        return c
    yield make
    for c in clients:
        c.__exit__(None, None, None)


def test_no_password_means_nothing_changes(make_client):
    c = make_client("")
    assert c.get("/api/properties").status_code == 200
    assert c.get("/api/auth/status").json() == {"required": False, "authenticated": True}


def test_api_is_closed_without_a_session_but_health_and_login_are_open(make_client):
    c = make_client("s3cret")
    assert c.get("/api/properties").status_code == 401
    assert c.get("/api/devices").status_code == 401
    assert c.get("/api/documents/x/file").status_code == 401
    assert c.get("/api/health").status_code == 200
    assert c.get("/api/auth/status").json() == {"required": True, "authenticated": False}


def test_login_logout_flow(make_client):
    c = make_client("s3cret")
    assert c.post("/api/auth/login", json={"password": "nope"}).status_code == 401
    r = c.post("/api/auth/login", json={"password": "s3cret"})
    assert r.status_code == 200 and "httponly" in r.headers["set-cookie"].lower() and "samesite=strict" in r.headers["set-cookie"].lower()
    assert c.get("/api/properties").status_code == 200
    assert c.get("/api/auth/status").json()["authenticated"] is True
    c.post("/api/auth/logout")
    assert c.get("/api/properties").status_code == 401


def test_repeated_wrong_passwords_lock_the_address_out(make_client):
    c = make_client("s3cret")
    for _ in range(auth.MAX_FAILS):
        assert c.post("/api/auth/login", json={"password": "bad"}).status_code == 401
    assert c.post("/api/auth/login", json={"password": "s3cret"}).status_code == 429  # even the right one waits
    auth._fails.clear()
    assert c.post("/api/auth/login", json={"password": "s3cret"}).status_code == 200


def test_tokens_cannot_be_forged_replayed_after_expiry_or_after_a_password_change(make_client, monkeypatch):
    make_client("s3cret")
    tok = auth.make_token()
    assert auth.valid_token(tok)
    exp, nonce, sig = tok.split(".")
    assert not auth.valid_token(f"{int(exp) + 999999}.{nonce}.{sig}")  # extended expiry
    assert not auth.valid_token(f"{exp}.{nonce}.{'0' * len(sig)}")
    assert not auth.valid_token("garbage") and not auth.valid_token(None) and not auth.valid_token("")
    assert not auth.valid_token(tok, now=time.time() + auth.SESSION_SECONDS + 10)
    monkeypatch.setattr(config, "PASSWORD", "changed")
    assert not auth.valid_token(tok)  # changing the password signs everybody out


def test_cross_site_writes_are_refused_when_protected(make_client):
    c = make_client("s3cret")
    c.post("/api/auth/login", json={"password": "s3cret"})
    r = c.post("/api/properties", json={"name": "x", "center": [24, 45]}, headers={"Origin": "http://evil.example"})
    assert r.status_code == 403
    r = c.post("/api/properties", json={"name": "x", "center": [24, 45]}, headers={"Origin": "http://testserver"})
    assert r.status_code == 201


def test_the_api_documentation_is_protected_too(make_client):
    c = make_client("s3cret")
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert c.get(path).status_code == 401
    c.post("/api/auth/login", json={"password": "s3cret"})
    assert c.get("/openapi.json").status_code == 200
    open_client = make_client("")
    assert open_client.get("/openapi.json").status_code == 200
