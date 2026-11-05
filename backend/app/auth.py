"""Optional password protection.

Off by default (EDEN listens on 127.0.0.1 only). Set EDEN_PASSWORD (scripts\\start.ps1 -Lan asks for one) and every /api
request except health and login needs a signed session cookie. Cookies are HttpOnly + SameSite=Strict, tokens are
HMAC-signed with a key derived from the password (changing the password signs everybody out), and repeated wrong passwords
from one address are locked out for a few minutes.
"""
import hashlib
import hmac
import secrets
import time
from urllib.parse import urlsplit

from fastapi import APIRouter, HTTPException, Request, Response
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import config

router = APIRouter(prefix="/api/auth")

COOKIE = "eden_session"
SESSION_SECONDS = 30 * 24 * 3600
MAX_FAILS = 5
LOCKOUT_SECONDS = 300
OPEN_PATHS = ("/api/health", "/api/auth/")
DOC_PATHS = ("/docs", "/redoc", "/openapi.json")  # the API description needs the session too

_fails: dict[str, list[float]] = {}


def required() -> bool:
    return bool(config.PASSWORD)


def _key() -> bytes:
    return hashlib.sha256(("eden-auth-v1|" + config.PASSWORD).encode("utf-8")).digest()


def make_token(now: float | None = None) -> str:
    exp = str(int((now if now is not None else time.time()) + SESSION_SECONDS))
    nonce = secrets.token_hex(8)
    body = f"{exp}.{nonce}"
    sig = hmac.new(_key(), body.encode(), hashlib.sha256).hexdigest()
    return f"{body}.{sig}"


def valid_token(token: str | None, now: float | None = None) -> bool:
    if not token or not required():
        return False
    try:
        exp, nonce, sig = token.split(".")
        good = hmac.new(_key(), f"{exp}.{nonce}".encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(sig, good) and int(exp) > (now if now is not None else time.time())
    except ValueError:
        return False


def _client(request: Request) -> str:
    return request.client.host if request.client else "unknown"


def _locked(ip: str, now: float) -> bool:
    recent = [t for t in _fails.get(ip, []) if now - t < LOCKOUT_SECONDS]
    _fails[ip] = recent
    return len(recent) >= MAX_FAILS


class Login(BaseModel):
    password: str


@router.get("/status")
def status(request: Request):
    return {"required": required(), "authenticated": (not required()) or valid_token(request.cookies.get(COOKIE))}


@router.post("/login")
def login(body: Login, request: Request, response: Response):
    if not required():
        return {"ok": True, "required": False}
    ip, now = _client(request), time.time()
    if _locked(ip, now):
        raise HTTPException(429, f"Too many wrong passwords. Try again in {LOCKOUT_SECONDS // 60} minutes.")
    if not hmac.compare_digest(hashlib.sha256(body.password.encode()).digest(), hashlib.sha256(config.PASSWORD.encode()).digest()):
        _fails.setdefault(ip, []).append(now)
        raise HTTPException(401, "Wrong password.")
    _fails.pop(ip, None)
    response.set_cookie(COOKIE, make_token(), max_age=SESSION_SECONDS, httponly=True, samesite="strict", secure=request.url.scheme == "https", path="/")
    return {"ok": True, "required": True}


@router.post("/logout")
def logout(response: Response):
    response.delete_cookie(COOKIE, path="/")
    return {"ok": True}


async def guard(request: Request, call_next):
    """HTTP middleware: block the API without a valid session, and cross-site writes."""
    path = request.url.path
    if required() and ((path.startswith("/api/") and not path.startswith(OPEN_PATHS)) or path.startswith(DOC_PATHS)):
        if not valid_token(request.cookies.get(COOKIE)):
            return JSONResponse({"detail": "Login required"}, status_code=401)
    if required() and request.method not in ("GET", "HEAD", "OPTIONS"):
        origin = request.headers.get("origin")
        if origin and urlsplit(origin).netloc != request.headers.get("host", ""):
            return JSONResponse({"detail": "Cross-site request refused"}, status_code=403)
    return await call_next(request)
