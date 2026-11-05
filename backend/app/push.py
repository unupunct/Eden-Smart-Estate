"""Push notifications (Web Push, RFC 8030/8291/8292).

Your browser (or phone, when EDEN is installed as an app from the browser) subscribes through the browser vendor's push
service and EDEN's server sends encrypted messages to that service, so they arrive even when the EDEN tab is closed.
The message content is encrypted end to end (only the subscribed browser can read it); the push service sees only that
a message was sent. Needs the EDEN computer to be online, and the page opened over https:// or http://localhost.

What is sent: a daily task digest (overdue / due today), the `notify` action of automations, and the test button.
Never sensor values or camera pictures in the clear, and nothing at all until a browser subscribes.
"""
import asyncio
import base64
import json
import re
from datetime import date, datetime
from typing import Any
from urllib.parse import urlsplit

from cryptography.hazmat.primitives import serialization
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import config, db

router = APIRouter(prefix="/api/push")

CONTACT = "mailto:eden-smart-estate@users.noreply.github.com"
# Where a subscription may point. A subscription is created by the (signed-in) browser, but the server then POSTs to its
# endpoint, so only the real push services are accepted (a guard against using EDEN to reach other machines).
PUSH_HOSTS = ("fcm.googleapis.com", "updates.push.services.mozilla.com", "push.services.mozilla.com", "notify.windows.com", "push.apple.com", "web.push.apple.com")
ALLOW_ANY_ENDPOINT = False  # tests point subscriptions at a local server
DEFAULT_DIGEST_HOUR = 8
MAX_FAILURES = 5


def endpoint_allowed(url: str) -> bool:
    try:
        u = urlsplit(url)
    except ValueError:
        return False
    if ALLOW_ANY_ENDPOINT:
        return u.scheme in ("http", "https") and bool(u.hostname)
    host = (u.hostname or "").lower()
    return u.scheme == "https" and any(host == h or host.endswith("." + h) for h in PUSH_HOSTS)


def _b64u(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


# ------------------------------------------------------------------ keys
def _setting(conn, key: str, default: str = "") -> str:
    r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


def _put_setting(conn, key: str, value: str) -> None:
    conn.execute("INSERT INTO settings(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def vapid_keys(conn) -> tuple[str, str]:
    """(private PEM, public key for the browser). Created on first use, kept in the secrets table, never returned by the API."""
    from py_vapid import Vapid02
    pem = conn.execute("SELECT value FROM secrets WHERE key='vapid_private'").fetchone()
    if pem:
        v = Vapid02.from_pem(pem["value"].encode())
    else:
        v = Vapid02()
        v.generate_keys()
        priv = v.private_pem().decode()
        conn.execute("INSERT INTO secrets(key,value) VALUES ('vapid_private',?)", (priv,))
    public = v.public_key.public_bytes(serialization.Encoding.X962, serialization.PublicFormat.UncompressedPoint)
    return (v.private_pem().decode(), _b64u(public))


# ------------------------------------------------------------------ sending
def _send_one(sub: dict, payload: dict, pem: str) -> tuple[bool, int, str]:
    """Blocking: encrypt and POST one message. Returns (ok, http status or 0, short reason)."""
    from py_vapid import Vapid02
    from pywebpush import WebPushException, webpush
    try:
        r = webpush(subscription_info={"endpoint": sub["endpoint"], "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]}},
                    data=json.dumps(payload, ensure_ascii=False), vapid_private_key=Vapid02.from_pem(pem.encode()),
                    vapid_claims={"sub": CONTACT}, ttl=24 * 3600, timeout=15)
        return True, getattr(r, "status_code", 201), "sent"
    except WebPushException as e:
        status = getattr(getattr(e, "response", None), "status_code", 0) or 0
        return False, status, f"the push service answered {status}" if status else "the push service could not be reached"
    except Exception as e:  # bad key material in a stored subscription, network down...
        return False, 0, type(e).__name__


async def notify(title: str, body: str, url: str = "/#tasks", tag: str = "eden") -> dict[str, Any]:
    """Send a notification to every subscribed browser. Returns {sent, failed, removed, subscribers}."""
    with db.session() as conn:
        subs = [dict(r) for r in conn.execute("SELECT * FROM push_subscriptions")]
        if not subs:
            return {"sent": 0, "failed": 0, "removed": 0, "subscribers": 0, "results": []}
        pem, _ = vapid_keys(conn)
    payload = {"title": title[:80], "body": body[:240], "url": url, "tag": tag}
    results = await asyncio.gather(*[asyncio.to_thread(_send_one, s, payload, pem) for s in subs])
    sent = failed = removed = 0
    out = []
    with db.session() as conn:
        for s, (ok, status, why) in zip(subs, results):
            if ok:
                sent += 1
                conn.execute("UPDATE push_subscriptions SET last_ok=?, failures=0 WHERE id=?", (db.now(), s["id"]))
            elif status in (404, 410):  # the browser unsubscribed or the subscription expired: forget it
                removed += 1
                conn.execute("DELETE FROM push_subscriptions WHERE id=?", (s["id"],))
            else:
                failed += 1
                conn.execute("UPDATE push_subscriptions SET failures=failures+1 WHERE id=?", (s["id"],))
                conn.execute("DELETE FROM push_subscriptions WHERE id=? AND failures>=?", (s["id"], MAX_FAILURES))
            out.append({"label": s["label"], "ok": ok, "message": why})
    return {"sent": sent, "failed": failed, "removed": removed, "subscribers": len(subs), "results": out}


# ------------------------------------------------------------------ the daily task digest
def digest_text(conn, today: date) -> tuple[str, str] | None:
    rows = conn.execute("SELECT title, due FROM tasks WHERE status='open' AND due IS NOT NULL AND due <= ? ORDER BY due, title", (today.isoformat(),)).fetchall()
    if not rows:
        return None
    overdue = [r for r in rows if r["due"] < today.isoformat()]
    due = [r for r in rows if r["due"] == today.isoformat()]
    parts = []
    if overdue:
        parts.append(f"{len(overdue)} overdue")
    if due:
        parts.append(f"{len(due)} due today")
    names = ", ".join(r["title"] for r in rows[:3]) + ("…" if len(rows) > 3 else "")
    return "EDEN: " + " · ".join(parts), names


async def send_digest_if_due(now: datetime | None = None) -> bool:
    """Called by the background loop. At most one digest per day, after the chosen hour, and only when something is due."""
    now = now or datetime.now()
    with db.session() as conn:
        if _setting(conn, "push_digest", "1") != "1":
            return False
        if now.hour < int(_setting(conn, "push_digest_hour", str(DEFAULT_DIGEST_HOUR))):
            return False
        if not conn.execute("SELECT 1 FROM push_subscriptions LIMIT 1").fetchone():
            return False
        key = f"digest:{now.date().isoformat()}"
        if conn.execute("SELECT 1 FROM push_sent WHERE key=?", (key,)).fetchone():
            return False
        text = digest_text(conn, now.date())
        conn.execute("INSERT INTO push_sent(key,sent_at) VALUES (?,?)", (key, db.now()))  # claim the day even if nothing is due
        conn.execute("DELETE FROM push_sent WHERE sent_at < ?", (db.now()[:4] + "-01-01",))
    if text is None:
        return False
    res = await notify(text[0], text[1], "/#tasks", "digest")
    return res["sent"] > 0


# ------------------------------------------------------------------ API
class Keys(BaseModel):
    p256dh: str = Field(min_length=20, max_length=200)
    auth: str = Field(min_length=10, max_length=100)


class SubscribeIn(BaseModel):
    endpoint: str = Field(max_length=2000)
    keys: Keys
    label: str = Field(default="", max_length=60)


class UnsubscribeIn(BaseModel):
    endpoint: str


class PushSettings(BaseModel):
    digest: bool | None = None
    hour: int | None = Field(default=None, ge=0, le=23)


def _status() -> dict:
    with db.session() as conn:
        _, public = vapid_keys(conn)
        subs = conn.execute("SELECT id, label, created_at, last_ok, failures FROM push_subscriptions ORDER BY created_at").fetchall()
        return {"publicKey": public, "digest": _setting(conn, "push_digest", "1") == "1",
                "hour": int(_setting(conn, "push_digest_hour", str(DEFAULT_DIGEST_HOUR))),
                "subscriptions": [{"id": r["id"], "label": r["label"], "createdAt": r["created_at"], "lastOk": r["last_ok"], "failures": r["failures"]} for r in subs]}


@router.get("/status")
def status():
    return _status()


@router.post("/subscribe", status_code=201)
def subscribe(body: SubscribeIn):
    if not endpoint_allowed(body.endpoint):
        raise HTTPException(422, "That does not look like a browser push service address.")
    if not re.fullmatch(r"[A-Za-z0-9_\-=]+", body.keys.p256dh) or not re.fullmatch(r"[A-Za-z0-9_\-=]+", body.keys.auth):
        raise HTTPException(422, "The subscription keys are not valid.")
    with db.session() as conn:
        conn.execute("INSERT INTO push_subscriptions(id,endpoint,p256dh,auth,label,created_at) VALUES (?,?,?,?,?,?) "
                     "ON CONFLICT(endpoint) DO UPDATE SET p256dh=excluded.p256dh, auth=excluded.auth, label=excluded.label, failures=0",
                     (db.new_id(), body.endpoint, body.keys.p256dh, body.keys.auth, body.label.strip(), db.now()))
    return _status()


@router.post("/unsubscribe")
def unsubscribe(body: UnsubscribeIn):
    with db.session() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE endpoint=?", (body.endpoint,))
    return _status()


@router.delete("/subscriptions/{sid}", status_code=204)
def remove_subscription(sid: str):
    with db.session() as conn:
        conn.execute("DELETE FROM push_subscriptions WHERE id=?", (sid,))


@router.put("/settings")
def put_settings(body: PushSettings):
    with db.session() as conn:
        if body.digest is not None:
            _put_setting(conn, "push_digest", "1" if body.digest else "0")
        if body.hour is not None:
            _put_setting(conn, "push_digest_hour", str(body.hour))
    return _status()


@router.post("/test")
async def test():
    res = await notify("EDEN test notification", "If you can read this, push notifications work on this device.", "/#settings", "test")
    if res["subscribers"] == 0:
        raise HTTPException(409, "No browser is subscribed yet. Press “Turn on notifications on this device” first.")
    return res
