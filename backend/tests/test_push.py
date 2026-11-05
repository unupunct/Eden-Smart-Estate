"""Web Push: a real encrypted message goes to a local stand-in for the browser's push service and is decrypted with the
subscriber's private key, so the VAPID header, the encryption and the payload are all checked for real."""
import asyncio
import base64
import json
import threading
from datetime import date, datetime
from http.server import BaseHTTPRequestHandler, HTTPServer

import http_ece
import pytest
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import ec

from app import db, push
from app.main import app
from fastapi.testclient import TestClient


def b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


class Service:
    """Pretends to be fcm.googleapis.com: records requests, answers with a chosen status."""

    def __init__(self):
        self.received: list[dict] = []
        self.status = 201
        svc = self

        class H(BaseHTTPRequestHandler):
            def do_POST(self):
                n = int(self.headers.get("Content-Length", 0))
                svc.received.append({"path": self.path, "headers": {k.lower(): v for k, v in self.headers.items()}, "body": self.rfile.read(n)})
                self.send_response(svc.status)
                self.end_headers()

            def log_message(self, *a):
                pass

        self.httpd = HTTPServer(("127.0.0.1", 0), H)
        self.thread = threading.Thread(target=self.httpd.serve_forever, daemon=True)
        self.thread.start()
        self.base = f"http://127.0.0.1:{self.httpd.server_port}"

    def close(self):
        self.httpd.shutdown()


class Browser:
    """The subscriber's side: its key pair and auth secret."""

    def __init__(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        self.auth = b"0123456789abcdef"
        pub = self.key.public_key().public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
        self.keys = {"p256dh": b64u(pub), "auth": b64u(self.auth)}

    def read(self, body: bytes) -> dict:
        return json.loads(http_ece.decrypt(body, private_key=self.key, auth_secret=self.auth, version="aes128gcm"))


@pytest.fixture()
def env(tmp_path, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "POLL_SECONDS", 0)
    monkeypatch.setattr(config, "PASSWORD", "")
    monkeypatch.setattr(push, "ALLOW_ANY_ENDPOINT", True)
    svc = Service()
    with TestClient(app) as c:
        yield c, svc
    svc.close()


def subscribe(c, svc, browser, name="a"):
    r = c.post("/api/push/subscribe", json={"endpoint": f"{svc.base}/send/{name}", "keys": browser.keys, "label": name})
    assert r.status_code == 201, r.text
    return r.json()


def test_the_public_key_is_stable_and_the_private_key_never_leaves(env):
    c, _ = env
    a = c.get("/api/push/status").json()
    b = c.get("/api/push/status").json()
    assert a["publicKey"] == b["publicKey"] and len(base64.urlsafe_b64decode(a["publicKey"] + "==")) == 65
    assert "PRIVATE" not in json.dumps(a) and a["subscriptions"] == []


def test_only_real_push_services_are_accepted_by_default(monkeypatch):
    monkeypatch.setattr(push, "ALLOW_ANY_ENDPOINT", False)
    assert push.endpoint_allowed("https://fcm.googleapis.com/fcm/send/abc")
    assert push.endpoint_allowed("https://updates.push.services.mozilla.com/wpush/v2/x")
    assert push.endpoint_allowed("https://wns2-par02p.notify.windows.com/w/?token=x")
    assert not push.endpoint_allowed("http://fcm.googleapis.com/x")        # not https
    assert not push.endpoint_allowed("https://192.168.1.10/x")             # a machine on the network
    assert not push.endpoint_allowed("https://evilgoogleapis.com/x")       # look-alike
    assert not push.endpoint_allowed("https://fcm.googleapis.com.evil.example/x")


def test_a_message_is_really_encrypted_and_readable_only_by_the_subscriber(env):
    c, svc = env
    br = Browser()
    subscribe(c, svc, br)
    r = c.post("/api/push/test")
    assert r.status_code == 200 and r.json()["sent"] == 1
    got = svc.received[0]
    assert got["path"] == "/send/a" and got["headers"]["content-encoding"] == "aes128gcm"
    assert got["headers"]["authorization"].startswith("vapid t=") and "k=" in got["headers"]["authorization"]
    assert b"EDEN test" not in got["body"]  # not readable in transit
    msg = br.read(got["body"])
    assert msg["title"] == "EDEN test notification" and msg["url"] == "/#settings"


def test_the_authorization_key_matches_the_published_public_key(env):
    c, svc = env
    subscribe(c, svc, Browser())
    pub = c.get("/api/push/status").json()["publicKey"]
    c.post("/api/push/test")
    assert f"k={pub}" in svc.received[0]["headers"]["authorization"]


def test_expired_subscriptions_are_forgotten_and_other_failures_are_counted(env):
    c, svc = env
    subscribe(c, svc, Browser())
    svc.status = 500
    r = c.post("/api/push/test").json()
    assert r["failed"] == 1 and c.get("/api/push/status").json()["subscriptions"][0]["failures"] == 1
    svc.status = 410
    r = c.post("/api/push/test").json()
    assert r["removed"] == 1 and c.get("/api/push/status").json()["subscriptions"] == []
    assert c.post("/api/push/test").status_code == 409  # nobody subscribed


def test_unsubscribe_and_bad_input(env):
    c, svc = env
    br = Browser()
    subscribe(c, svc, br)
    st = c.post("/api/push/unsubscribe", json={"endpoint": f"{svc.base}/send/a"}).json()
    assert all(s["label"] != "a" for s in st["subscriptions"])
    assert c.post("/api/push/subscribe", json={"endpoint": f"{svc.base}/x", "keys": {"p256dh": "not valid!!!!!!!!!!!!!!!", "auth": "short"}}).status_code == 422


def test_digest_is_sent_once_a_day_after_the_hour_and_only_when_something_is_due(env):
    c, svc = env
    br = Browser()
    subscribe(c, svc, br)
    pid = c.post("/api/properties", json={"name": "Home", "center": [24, 45]}).json()["id"]
    assert asyncio.run(push.send_digest_if_due(datetime(2026, 5, 10, 9, 0))) is False  # nothing due: nothing sent
    assert svc.received == []
    c.post("/api/tasks", json={"propertyId": pid, "title": "Service the pump", "due": "2026-05-11"})
    c.post("/api/tasks", json={"propertyId": pid, "title": "Mow", "due": "2026-05-12"})
    c.post("/api/tasks", json={"propertyId": pid, "title": "Next month", "due": "2026-06-01"})
    assert asyncio.run(push.send_digest_if_due(datetime(2026, 5, 12, 6, 0))) is False   # before the digest hour (08:00)
    assert asyncio.run(push.send_digest_if_due(datetime(2026, 5, 12, 9, 0))) is True
    msg = br.read(svc.received[0]["body"])
    assert msg["title"] == "EDEN: 1 overdue · 1 due today" and "Service the pump" in msg["body"] and "Next month" not in msg["body"]
    assert asyncio.run(push.send_digest_if_due(datetime(2026, 5, 12, 15, 0))) is False  # once per day, even after a restart
    assert len(svc.received) == 1
    c.put("/api/push/settings", json={"digest": False})
    assert asyncio.run(push.send_digest_if_due(datetime(2026, 5, 13, 9, 0))) is False  # switched off


def test_automation_notify_action(env):
    c, svc = env
    br = Browser()
    subscribe(c, svc, br)
    body = {"name": "Tell me", "trigger": {"type": "time", "at": "07:00"}, "actions": [{"type": "notify", "message": "Good morning"}], "enabled": False}
    assert c.post("/api/automations", json={**body, "actions": [{"type": "notify", "message": " "}]}).status_code == 422
    aid = c.post("/api/automations", json=body).json()["id"]
    dry = c.post(f"/api/automations/{aid}/run", json={"dryRun": True}).json()
    assert svc.received == [] and "dry run" in json.dumps(dry)
    c.post(f"/api/automations/{aid}/run", json={"dryRun": False})
    assert br.read(svc.received[0]["body"])["body"] == "Good morning"
