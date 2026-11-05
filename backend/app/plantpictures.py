"""Pictures of plants from Wikipedia / Wikimedia Commons, on request, with their licence and credit.

Opt-in: nothing is sent until "Show pictures of plants" is switched on in the Plants & Mushrooms page. Then, when you open a plant, EDEN
asks wikipedia.org (the article for the plant's scientific name) and commons.wikimedia.org (the licence and author of the article's
picture) and downloads ONE small picture (about 480 px wide) which is kept on this computer. What is sent is the scientific name, nothing
about you or your property. Each plant is looked up once; the answer (including "no free picture found") is remembered.

Only pictures with a free licence are used (public domain, CC0, CC BY, CC BY-SA); anything else, and any picture that is not on
Wikimedia Commons (for example fair-use files on the English Wikipedia), is skipped. The author and licence are always shown with the picture
(that is what CC BY requires). There are NO pictures of mushrooms: a photo is never a safe way to identify one.
"""
import hashlib
import html
import re
from datetime import datetime, timedelta, timezone
from urllib.parse import quote, unquote, urlparse

import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel

from . import config, db, library

router = APIRouter(prefix="/api")

TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests inject httpx.MockTransport
THUMB_WIDTH = 480
MAX_BYTES = 1_500_000
OK_DAYS, NONE_DAYS = 365, 30
KINDS = {"plants": lambda: {p["id"]: p for p in library.PLANTS}, "aquatic": lambda: {p["id"]: p for p in library.AQUATIC}}  # never mushrooms
FREE = re.compile(r"^(cc0|cc[- ]?zero|public domain|pd\b|cc[- ]by(?![- ]?n[cd])(?:[- ]sa)?(?![- ]?n[cd]))", re.I)
WIKIMEDIA_HOSTS = {"upload.wikimedia.org", "thumb.wikimedia.org"}  # thumbnails are served from thumb.wikimedia.org since 2025


def _hosts() -> set[str]:
    return WIKIMEDIA_HOSTS | config.WIKIMEDIA_EXTRA_HOSTS
FILE_NAME = re.compile(r"^[0-9a-f]{40}\.(jpg|png|webp)$")


class Settings(BaseModel):
    enabled: bool


def _enabled(conn) -> bool:
    r = conn.execute("SELECT value FROM settings WHERE key='plant_pictures'").fetchone()
    return bool(r and r["value"] == "1")


def _dir():
    d = config.DATA_DIR / "plant_pictures"
    d.mkdir(parents=True, exist_ok=True)
    return d


def settings_body(conn) -> dict:
    return {"enabled": _enabled(conn),
            "sends": "the plant's scientific name, to wikipedia.org and commons.wikimedia.org; one small picture per plant is saved on this computer",
            "licences": "public domain, CC0, CC BY, CC BY-SA, always shown with the author", "mushrooms": "never"}


@router.get("/library/pictures/settings")
def get_settings():
    with db.session() as conn:
        return settings_body(conn)


@router.put("/library/pictures/settings")
def put_settings(body: Settings):
    with db.session() as conn:
        conn.execute("INSERT INTO settings(key,value) VALUES ('plant_pictures',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("1" if body.enabled else "0",))
        return settings_body(conn)


# ------------------------------------------------------------------ the lookup
def search_title(item: dict) -> str:
    """The article title to ask for: the library's own scientific name (the one people know), two words (genus species)."""
    t = item["sci"]
    t = t.split(" / ")[0].replace(" agg.", "").replace(" x ", " × ")
    words = t.split()
    return " ".join(words[:2]) if len(words) >= 2 and words[1][:1].islower() else t


def commons_file_name(src: str) -> str | None:
    """The Commons file name behind an upload.wikimedia.org picture URL; None for pictures that are not on Commons."""
    u = urlparse(src)
    if u.netloc not in _hosts() or not u.path.startswith("/wikipedia/commons/"):
        return None
    parts = [p for p in u.path.split("/") if p]
    name = parts[-2] if "thumb" in parts and len(parts) >= 3 else parts[-1]
    return unquote(name)


def plain(s: str, limit: int = 160) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]*>", " ", s or ""))).strip()[:limit]


def free_licence(meta: dict) -> tuple[str, str] | None:
    short = plain((meta.get("LicenseShortName") or {}).get("value", ""), 60)
    if not short or not FREE.match(short):
        return None
    return short, plain((meta.get("LicenseUrl") or {}).get("value", ""), 200)


async def _lookup(item: dict) -> dict:
    title = search_title(item)
    async with httpx.AsyncClient(timeout=25, transport=TRANSPORT, headers={"User-Agent": config.USER_AGENT}, follow_redirects=True) as c:
        r = await c.get(config.WIKI_SUMMARY_URL.format(title=quote(title.replace(" ", "_"), safe="")))
        alt = (item.get("taxon") or {}).get("acceptedName")
        if r.status_code == 404 and alt:  # the library uses an older name: try GBIF's accepted one
            r = await c.get(config.WIKI_SUMMARY_URL.format(title=quote(alt.replace(" ", "_"), safe="")))
        if r.status_code == 404:
            return {"status": "none", "why": "no article"}
        if r.status_code != 200:
            raise httpx.HTTPError(f"HTTP {r.status_code}")
        s = r.json()
        if s.get("type") != "standard":
            return {"status": "none", "why": "no article"}
        src = (s.get("originalimage") or s.get("thumbnail") or {}).get("source", "")
        fname = commons_file_name(src)
        if not fname:
            return {"status": "none", "why": "no free picture on Wikimedia Commons"}
        q = await c.get(config.COMMONS_API_URL, params={"action": "query", "titles": f"File:{fname}", "prop": "imageinfo", "iiprop": "extmetadata|url|mime",
                                             "iiurlwidth": THUMB_WIDTH, "format": "json", "formatversion": "2"})
        if q.status_code != 200:
            raise httpx.HTTPError(f"HTTP {q.status_code}")
        pages = q.json().get("query", {}).get("pages", [])
        info = (pages[0].get("imageinfo") or [None])[0] if pages else None
        if not info:
            return {"status": "none", "why": "picture details not found"}
        meta = info.get("extmetadata") or {}
        lic = free_licence(meta)
        if not lic:
            return {"status": "none", "why": "the picture's licence is not a free one"}
        thumb = info.get("thumburl") or info.get("url")
        if not thumb or urlparse(thumb).netloc not in _hosts():
            return {"status": "none", "why": "no picture file"}
        img = await c.get(thumb)
        ctype = img.headers.get("content-type", "").split(";")[0]
        ext = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp"}.get(ctype)
        if img.status_code != 200 or not ext or len(img.content) > MAX_BYTES:
            return {"status": "none", "why": "the picture could not be used"}
        name = f"{hashlib.sha1(thumb.encode()).hexdigest()}.{ext}"
        (_dir() / name).write_bytes(img.content)
        return {"status": "ok", "file": name, "credit": {
            "title": plain(fname.rsplit(".", 1)[0].replace("_", " "), 120), "artist": plain((meta.get("Artist") or {}).get("value", "")) or "unknown author",
            "licence": lic[0], "licenceUrl": lic[1], "page": info.get("descriptionurl") or f"https://commons.wikimedia.org/wiki/File:{quote(fname)}",
            "article": (s.get("content_urls", {}).get("desktop", {}) or {}).get("page", ""), "source": "Wikimedia Commons"}}


@router.get("/library/pictures/{kind}/{item_id}")
async def get_picture(kind: str, item_id: str):
    if kind not in KINDS:
        raise HTTPException(404, "No pictures for this kind of entry.")
    item = KINDS[kind]().get(item_id)
    if not item:
        raise HTTPException(404, "Unknown library entry.")
    key = f"{kind}/{item_id}"
    with db.session() as conn:
        if not _enabled(conn):
            raise HTTPException(403, "Plant pictures are switched off.")
        row = conn.execute("SELECT fetched_at, body FROM plant_pictures WHERE key=?", (key,)).fetchone()
    if row:
        import json
        body = json.loads(row["body"])
        age = datetime.now(timezone.utc) - datetime.fromisoformat(row["fetched_at"])
        if age < timedelta(days=OK_DAYS if body["status"] == "ok" else NONE_DAYS) and (body["status"] != "ok" or (_dir() / body["file"]).exists()):
            return _public(body)
    try:
        body = await _lookup(item)
    except (httpx.HTTPError, ValueError, KeyError) as e:
        raise HTTPException(502, f"Wikipedia could not be reached ({type(e).__name__}); try again later.")
    with db.session() as conn:
        conn.execute("INSERT INTO plant_pictures(key, fetched_at, body) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at, body=excluded.body",
                     (key, db.now(), db.dumps(body)))
    return _public(body)


def _public(body: dict) -> dict:
    if body["status"] != "ok":
        return {"status": "none", "why": body.get("why", "")}
    return {"status": "ok", "url": f"/api/library/picture-file/{body['file']}", "credit": body["credit"]}


@router.get("/library/picture-file/{name}")
def picture_file(name: str):
    if not FILE_NAME.match(name):
        raise HTTPException(404, "Not found.")
    p = _dir() / name
    if not p.is_file():
        raise HTTPException(404, "Not found.")
    return FileResponse(p, headers={"Cache-Control": "private, max-age=31536000, immutable"})


@router.delete("/library/pictures", status_code=204)
def forget_pictures():
    """Delete every saved picture and every remembered answer."""
    with db.session() as conn:
        conn.execute("DELETE FROM plant_pictures")
    for f in _dir().iterdir():
        if FILE_NAME.match(f.name):
            f.unlink(missing_ok=True)
