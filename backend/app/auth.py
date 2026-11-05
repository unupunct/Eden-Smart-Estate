"""The admin account and its sessions.

There is exactly one account: the admin. Until it exists EDEN is open (it listens on 127.0.0.1 only) and Settings offers to
create it; from then on every /api request except health and the auth endpoints needs a signed session cookie.

* The password is stored only as a salted scrypt hash (database table `admin`, a CHECK keeps it to one row).
* Session cookies are HttpOnly + SameSite=Strict (+ Secure over HTTPS). Tokens are HMAC-signed with a key made from a random
  server secret AND the current password hash, so changing the password signs every other session out.
* Repeated wrong passwords from one address are locked out for a few minutes.
* `EDEN_PASSWORD` (start.ps1 -Password) only seeds the first admin account when none exists yet; the database wins afterwards.
* Forgotten password: `scripts\\reset-admin.ps1` (needs access to this computer).
"""
import base64
import hashlib
import hmac
import re
import secrets
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import config, db

router = APIRouter(prefix="/api/auth")

COOKIE = "eden_session"
SESSION_SECONDS = 30 * 24 * 3600
MAX_FAILS = 5
LOCKOUT_SECONDS = 300
OPEN_PATHS = ("/api/health", "/api/auth/")
DOC_PATHS = ("/docs", "/redoc", "/openapi.json")  # the API description needs the session too
MIN_PASSWORD = 10
SCRYPT_N, SCRYPT_R, SCRYPT_P = 2 ** 14, 8, 1
USERNAME_RE = re.compile(r"^[A-Za-z0-9._-]{3,32}$")
WEAK = {"password123", "1234567890", "qwertyuiop", "0123456789", "passwordpassword", "administrator", "eden smart estate", "edensmartestate"}

_fails: dict[str, list[float]] = {}


# ------------------------------------------------------------------ passwords
def hash_password(password: str, salt: bytes | None = None) -> str:
    salt = salt or secrets.token_bytes(16)
    dk = hashlib.scrypt(password.encode("utf-8"), salt=salt, n=SCRYPT_N, r=SCRYPT_R, p=SCRYPT_P, dklen=32)
    return "scrypt${}${}${}${}${}".format(SCRYPT_N, SCRYPT_R, SCRYPT_P, base64.b64encode(salt).decode(), base64.b64encode(dk).decode())


def verify_password(password: str, stored: str) -> bool:
    try:
        scheme, n, r, p, salt, want = stored.split("$")
        if scheme != "scrypt":
            return False
        dk = hashlib.scrypt(password.encode("utf-8"), salt=base64.b64decode(salt), n=int(n), r=int(r), p=int(p), dklen=32)
        return hmac.compare_digest(dk, base64.b64decode(want))
    except (ValueError, TypeError):
        return False


def check_password_policy(password: str, username: str = "") -> None:
    if len(password) < MIN_PASSWORD:
        raise HTTPException(422, f"Use at least {MIN_PASSWORD} characters (a few random words make a good password).")
    if len(password) > 200:
        raise HTTPException(422, "That password is too long (200 characters at most).")
    if password.lower() in WEAK or (username and password.lower() == username.lower()) or len(set(password)) < 4:
        raise HTTPException(422, "That password is too easy to guess. Choose another one.")


def check_username(username: str) -> str:
    username = username.strip()
    if not USERNAME_RE.match(username):
        raise HTTPException(422, "The user name needs 3–32 letters, digits, dots, dashes or underscores.")
    return username


# ------------------------------------------------------------------ the one admin
def get_admin():
    with db.session() as conn:
        return conn.execute("SELECT * FROM admin WHERE id=1").fetchone()


def required() -> bool:
    return get_admin() is not None


def create_admin(username: str, password: str, enforce_policy: bool = True) -> None:
    username = check_username(username)
    if enforce_policy:
        check_password_policy(password, username)
    with db.session() as conn:
        if conn.execute("SELECT 1 FROM admin WHERE id=1").fetchone():
            raise HTTPException(409, "The admin account already exists.")
        conn.execute("INSERT INTO admin(id, username, pw_hash, created_at, pw_changed_at) VALUES (1,?,?,?,?)", (username, hash_password(password), db.now(), db.now()))
        _ensure_secret(conn)


def set_admin(username: str, password: str) -> None:
    """Create or replace the admin account (used by the local reset script; never reachable through the API)."""
    username = check_username(username)
    check_password_policy(password, username)
    with db.session() as conn:
        conn.execute("INSERT INTO admin(id, username, pw_hash, created_at, pw_changed_at) VALUES (1,?,?,?,?) "
                     "ON CONFLICT(id) DO UPDATE SET username=excluded.username, pw_hash=excluded.pw_hash, pw_changed_at=excluded.pw_changed_at",
                     (username, hash_password(password), db.now(), db.now()))
        conn.execute("INSERT INTO settings(key,value) VALUES ('session_secret',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (secrets.token_hex(32),))


def bootstrap() -> bool:
    """Seed the first admin from EDEN_PASSWORD (start.ps1 -Password / -Lan). Returns True if an account was created."""
    if config.PASSWORD and get_admin() is None:
        create_admin("admin", config.PASSWORD, enforce_policy=False)
        return True
    return False


def _ensure_secret(conn) -> str:
    r = conn.execute("SELECT value FROM settings WHERE key='session_secret'").fetchone()
    if r:
        return r["value"]
    s = secrets.token_hex(32)
    conn.execute("INSERT INTO settings(key,value) VALUES ('session_secret',?)", (s,))
    return s


def _key() -> bytes | None:
    with db.session() as conn:
        a = conn.execute("SELECT pw_hash FROM admin WHERE id=1").fetchone()
        if not a:
            return None
        return hashlib.sha256(f"eden-auth-v2|{_ensure_secret(conn)}|{a['pw_hash']}".encode()).digest()


def make_token(now: float | None = None) -> str:
    key = _key()
    if key is None:
        raise RuntimeError("no admin account")
    exp = str(int((now if now is not None else time.time()) + SESSION_SECONDS))
    nonce = secrets.token_hex(8)
    body = f"{exp}.{nonce}"
    return f"{body}.{hmac.new(key, body.encode(), hashlib.sha256).hexdigest()}"


def valid_token(token: str | None, now: float | None = None) -> bool:
    if not token:
        return False
    key = _key()
    if key is None:
        return False
    try:
        exp, nonce, sig = token.split(".")
        good = hmac.new(key, f"{exp}.{nonce}".encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, good) and int(exp) > (now if now is not None else time.time())
    except ValueError:
        return False


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _is_local(request: Request) -> bool:
    return _client(request) in ("127.0.0.1", "::1", "localhost", "testclient")


def _locked(ip: str, now: float) -> bool:
    recent = [t for t in _fails.get(ip, []) if now - t < LOCKOUT_SECONDS]
    _fails[ip] = recent
    return len(recent) >= MAX_FAILS


def _session_cookie(response: Response, request: Request) -> None:
    response.set_cookie(COOKIE, make_token(), max_age=SESSION_SECONDS, httponly=True, samesite="strict", secure=request.url.scheme == "https", path="/")


# ------------------------------------------------------------------ API
class Login(BaseModel):
    username: str = ""
    password: str


class Setup(BaseModel):
    username: str
    password: str


class PasswordChange(BaseModel):
    current: str
    new: str


@router.get("/status")
def status(request: Request):
    admin = get_admin()
    if admin is None:
        return {"required": False, "authenticated": True, "setupAvailable": _is_local(request), "username": None}
    ok = valid_token(request.cookies.get(COOKIE))
    return {"required": True, "authenticated": ok, "setupAvailable": False, "username": admin["username"] if ok else None}


@router.post("/setup")
def setup(body: Setup, request: Request, response: Response):
    """Create the admin account. Only possible while none exists, and only from this computer."""
    if get_admin() is not None:
        raise HTTPException(409, "The admin account already exists.")
    if not _is_local(request):
        raise HTTPException(403, "The admin account can only be created from the computer EDEN runs on.")
    create_admin(body.username, body.password)
    _session_cookie(response, request)
    return {"ok": True, "username": body.username.strip()}


@router.post("/login")
def login(body: Login, request: Request, response: Response):
    admin = get_admin()
    if admin is None:
        return {"ok": True, "required": False}
    ip, now = _client(request), time.time()
    if _locked(ip, now):
        raise HTTPException(429, f"Too many wrong passwords. Try again in {LOCKOUT_SECONDS // 60} minutes.")
    user_ok = hmac.compare_digest(body.username.strip().lower().encode(), admin["username"].lower().encode()) if body.username else True
    pw_ok = verify_password(body.password, admin["pw_hash"])  # always evaluated: no timing difference
    if not (user_ok and pw_ok):
        _fails.setdefault(ip, []).append(now)
        raise HTTPException(401, "Wrong user name or password.")
    _fails.pop(ip, None)
    _session_cookie(response, request)
    return {"ok": True, "required": True, "username": admin["username"]}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


@router.post("/password")
def change_password(body: PasswordChange, request: Request, response: Response):
    """Change the admin password. Needs the current password; every other session is signed out."""
    admin = get_admin()
    if admin is None:
        raise HTTPException(409, "There is no admin account yet.")
    if not valid_token(request.cookies.get(COOKIE)):
        raise HTTPException(401, "Login required")
    ip, now = _client(request), time.time()
    if _locked(ip, now):
        raise HTTPException(429, f"Too many wrong passwords. Try again in {LOCKOUT_SECONDS // 60} minutes.")
    if not verify_password(body.current, admin["pw_hash"]):
        _fails.setdefault(ip, []).append(now)
        raise HTTPException(403, "The current password is not correct.")
    if body.new == body.current:
        raise HTTPException(422, "The new password must be different from the current one.")
    check_password_policy(body.new, admin["username"])
    with db.session() as conn:
        conn.execute("UPDATE admin SET pw_hash=?, pw_changed_at=? WHERE id=1", (hash_password(body.new), db.now()))
    _fails.pop(ip, None)
    _session_cookie(response, request)  # this browser stays signed in; the old tokens no longer verify
    return {"ok": True}


async def guard(request: Request, call_next):
    """HTTP middleware: block the API without a valid session, and cross-site writes."""
    path = request.url.path
    protected = required()
    if protected and ((path.startswith("/api/") and not path.startswith(OPEN_PATHS)) or path.startswith(DOC_PATHS)):
        if not valid_token(request.cookies.get(COOKIE)):
            return JSONResponse({"detail": "Login required"}, status_code=401)
    if protected and request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc != request.headers.get("host", ""):
            return JSONResponse({"detail": "Cross-site request refused"}, status_code=403)
    return await call_next(request)
