"""The admin account: setup, login, password change, sessions."""
import time

import pytest
from fastapi.testclient import TestClient

from app import admin as admin_cli, auth, config, db

GOOD = "correct horse battery"
NEW = "a brand new passphrase"


@pytest.fixture()
def make_client(tmp_path_factory, monkeypatch):
    clients = []

    def make(seed_password=""):
        d = tmp_path_factory.mktemp("eden")
        monkeypatch.setattr(config, "DATA_DIR", d)
        monkeypatch.setattr(config, "DB_PATH", d / "eden.db")
        monkeypatch.setattr(config, "UPLOAD_DIR", d / "uploads")
        monkeypatch.setattr(config, "BACKUP_DIR", d / "backups")
        monkeypatch.setattr(config, "POLL_SECONDS", 0)
        monkeypatch.setattr(config, "PASSWORD", seed_password)
        auth._fails.clear()
        c = TestClient(__import__("app.main", fromlist=["app"]).app)
        c.__enter__()
        clients.append(c)
        return c
    yield make
    for c in clients:
        c.__exit__(None, None, None)


def setup_admin(c, username="owner", password=GOOD):
    r = c.post("/api/auth/setup", json={"username": username, "password": password})
    assert r.status_code == 200, r.text
    return r


def test_without_an_admin_nothing_changes_and_setup_is_offered(make_client):
    c = make_client()
    assert c.get("/api/properties").status_code == 200
    st = c.get("/api/auth/status").json()
    assert st["required"] is False and st["setupAvailable"] is True


def test_creating_the_admin_closes_the_api_and_signs_that_browser_in(make_client):
    c = make_client()
    assert c.post("/api/auth/setup", json={"username": "owner", "password": "short"}).status_code == 422
    assert c.post("/api/auth/setup", json={"username": "x", "password": GOOD}).status_code == 422
    r = setup_admin(c)
    assert "httponly" in r.headers["set-cookie"].lower()
    assert c.get("/api/properties").status_code == 200  # this browser has the cookie
    assert c.get("/api/auth/status").json() == {"required": True, "authenticated": True, "setupAvailable": False, "username": "owner"}
    other = TestClient(c.app)
    assert other.get("/api/properties").status_code == 401
    assert other.get("/api/health").status_code == 200
    assert c.post("/api/auth/setup", json={"username": "second", "password": GOOD}).status_code == 409  # only ever one admin


def test_only_one_admin_row_can_exist(make_client):
    c = make_client()
    setup_admin(c)
    with pytest.raises(Exception):
        with db.session() as conn:
            conn.execute("INSERT INTO admin(id,username,pw_hash,created_at,pw_changed_at) VALUES (2,'b','x','t','t')")


def test_the_password_is_stored_hashed_only(make_client):
    c = make_client()
    setup_admin(c)
    with db.session() as conn:
        h = conn.execute("SELECT pw_hash FROM admin").fetchone()["pw_hash"]
    assert h.startswith("scrypt$") and GOOD not in h
    assert auth.verify_password(GOOD, h) and not auth.verify_password(GOOD + "x", h)


def test_login_logout_flow(make_client):
    c = make_client()
    setup_admin(c)
    c.post("/api/auth/logout")
    assert c.get("/api/properties").status_code == 401
    assert c.post("/api/auth/login", json={"username": "owner", "password": "nope-nope-nope"}).status_code == 401
    assert c.post("/api/auth/login", json={"username": "intruder", "password": GOOD}).status_code == 401
    r = c.post("/api/auth/login", json={"username": "OWNER", "password": GOOD})
    assert r.status_code == 200 and "samesite=strict" in r.headers["set-cookie"].lower()
    assert c.get("/api/properties").status_code == 200


def test_repeated_wrong_passwords_lock_the_address_out(make_client):
    c = make_client()
    setup_admin(c)
    c.post("/api/auth/logout")
    for _ in range(auth.MAX_FAILS):
        assert c.post("/api/auth/login", json={"username": "owner", "password": "bad-bad-bad"}).status_code == 401
    assert c.post("/api/auth/login", json={"username": "owner", "password": GOOD}).status_code == 429
    auth._fails.clear()
    assert c.post("/api/auth/login", json={"username": "owner", "password": GOOD}).status_code == 200


def test_changing_the_password(make_client):
    c = make_client()
    setup_admin(c)
    laptop = TestClient(c.app)
    laptop.post("/api/auth/login", json={"username": "owner", "password": GOOD})
    assert laptop.get("/api/properties").status_code == 200
    assert c.post("/api/auth/password", json={"current": "wrong-wrong-wrong", "new": NEW}).status_code == 403
    assert c.post("/api/auth/password", json={"current": GOOD, "new": "short"}).status_code == 422
    assert c.post("/api/auth/password", json={"current": GOOD, "new": GOOD}).status_code == 422
    assert TestClient(c.app).post("/api/auth/password", json={"current": GOOD, "new": NEW}).status_code == 401
    assert c.post("/api/auth/password", json={"current": GOOD, "new": NEW}).status_code == 200
    assert c.get("/api/properties").status_code == 200       # this browser stays signed in
    assert laptop.get("/api/properties").status_code == 401  # every other session is signed out
    laptop.cookies.clear()
    assert laptop.post("/api/auth/login", json={"username": "owner", "password": GOOD}).status_code == 401  # old password is dead
    assert laptop.post("/api/auth/login", json={"username": "owner", "password": NEW}).status_code == 200


def test_tokens_cannot_be_forged_replayed_or_used_after_expiry(make_client):
    c = make_client()
    setup_admin(c)
    tok = auth.make_token()
    assert auth.valid_token(tok)
    exp, nonce, sig = tok.split(".")
    assert not auth.valid_token(f"{int(exp) + 999999}.{nonce}.{sig}")
    assert not auth.valid_token(f"{exp}.{nonce}.{'0' * len(sig)}")
    assert not auth.valid_token("garbage") and not auth.valid_token(None) and not auth.valid_token("")
    assert not auth.valid_token(tok, now=time.time() + auth.SESSION_SECONDS + 10)


def test_cross_site_writes_are_refused_when_protected(make_client):
    c = make_client()
    setup_admin(c)
    assert c.post("/api/properties", json={"name": "x", "center": [24, 45]}, headers={"Origin": "http://evil.example"}).status_code == 403
    assert c.post("/api/properties", json={"name": "x", "center": [24, 45]}, headers={"Origin": "http://testserver"}).status_code == 201


def test_the_api_documentation_is_protected_too(make_client):
    c = make_client()
    assert c.get("/openapi.json").status_code == 200
    setup_admin(c)
    other = TestClient(c.app)
    for path in ("/docs", "/redoc", "/openapi.json"):
        assert other.get(path).status_code == 401
    assert c.get("/openapi.json").status_code == 200


def test_start_script_password_seeds_the_first_admin(make_client):
    c = make_client("seeded-pass")
    st = c.get("/api/auth/status").json()
    assert st["required"] is True and st["authenticated"] is False
    assert c.post("/api/auth/login", json={"username": "admin", "password": "seeded-pass"}).status_code == 200
    assert c.post("/api/auth/login", json={"password": "seeded-pass"}).status_code == 200  # user name optional for the seeded account


def test_reset_tool_creates_and_replaces_the_account(make_client, monkeypatch):
    c = make_client()
    monkeypatch.setenv("EDEN_NEW_PASSWORD", "weak")
    assert admin_cli.main(["reset", "--username", "owner"]) == 1
    monkeypatch.setenv("EDEN_NEW_PASSWORD", GOOD)
    assert admin_cli.main(["reset", "--username", "owner"]) == 0
    c.post("/api/auth/logout")
    assert c.post("/api/auth/login", json={"username": "owner", "password": GOOD}).status_code == 200
    old_token = auth.make_token()
    monkeypatch.setenv("EDEN_NEW_PASSWORD", "another long passphrase")
    assert admin_cli.main(["reset"]) == 0
    assert not auth.valid_token(old_token)  # the reset signs everyone out
