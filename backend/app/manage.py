"""Management: tasks and maintenance, documents and photos, weather.

Weather is opt-in (it sends the property's coordinates to the weather service), always shows when it was fetched, and falls
back to the last real answer marked as stale. Nothing is ever estimated or filled in.
"""
import csv
import io
import json
import re
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Literal

import httpx
from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, Field

from . import config, db, ocr, privacy, recurrence

router = APIRouter(prefix="/api")

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")


def _need(conn, table: str, id_: str, what: str):
    r = conn.execute(f"SELECT * FROM {table} WHERE id=?", (id_,)).fetchone()
    if not r:
        raise HTTPException(404, f"{what} not found")
    return r


def _day(s: str | None, what: str = "date") -> date | None:
    if s in (None, ""):
        return None
    if not DATE_RE.match(s):
        raise HTTPException(422, f"The {what} must look like 2025-06-21.")
    try:
        return date.fromisoformat(s)
    except ValueError:
        raise HTTPException(422, f"The {what} is not a real calendar date.")


# ------------------------------------------------------------------ tasks
class TaskIn(BaseModel):
    propertyId: str | None = None
    title: str = Field(min_length=1, max_length=200)
    notes: str = Field(default="", max_length=4000)
    category: str = Field(default="", max_length=60)
    priority: Literal["low", "normal", "high"] = "normal"
    due: str | None = None
    repeatEvery: int | None = Field(default=None, ge=1, le=365)
    repeatUnit: Literal["day", "week", "month", "year"] | None = None
    repeatFrom: Literal["due", "completion"] = "due"
    objectId: str | None = None


class TaskPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    notes: str | None = Field(default=None, max_length=4000)
    category: str | None = Field(default=None, max_length=60)
    priority: Literal["low", "normal", "high"] | None = None
    due: str | None = None
    repeatEvery: int | None = Field(default=None, ge=1, le=365)
    repeatUnit: Literal["day", "week", "month", "year"] | None = None
    repeatFrom: Literal["due", "completion"] | None = None
    objectId: str | None = None
    status: Literal["open", "done"] | None = None


def _task(r) -> dict:
    return {
        "id": r["id"], "propertyId": r["property_id"], "title": r["title"], "notes": r["notes"], "category": r["category"], "priority": r["priority"],
        "due": r["due"], "status": r["status"], "repeatEvery": r["repeat_every"], "repeatUnit": r["repeat_unit"], "repeatFrom": r["repeat_from"],
        "objectId": r["object_id"], "createdAt": r["created_at"], "completedAt": r["completed_at"],
    }


def _check_repeat(every, unit) -> None:
    if (every is None) != (unit is None):
        raise HTTPException(422, "A repeating task needs both a number and a unit (for example every 2 weeks).")


@router.get("/tasks")
def list_tasks(propertyId: str | None = None, status: str | None = None, objectId: str | None = None):
    q, args = "SELECT * FROM tasks WHERE 1=1", []
    if propertyId:
        q += " AND property_id=?"
        args.append(propertyId)
    if status in ("open", "done"):
        q += " AND status=?"
        args.append(status)
    if objectId:
        q += " AND object_id=?"
        args.append(objectId)
    q += " ORDER BY status, (due IS NULL), due, CASE priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, created_at"
    with db.session() as conn:
        return [_task(r) for r in conn.execute(q, args)]


@router.post("/tasks", status_code=201)
def add_task(body: TaskIn):
    _day(body.due, "due date")
    _check_repeat(body.repeatEvery, body.repeatUnit)
    tid = db.new_id()
    with db.session() as conn:
        if body.propertyId:
            _need(conn, "properties", body.propertyId, "Property")
        conn.execute("INSERT INTO tasks(id,property_id,title,notes,category,priority,due,repeat_every,repeat_unit,repeat_from,object_id,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                     (tid, body.propertyId, body.title.strip(), body.notes, body.category.strip(), body.priority, body.due or None, body.repeatEvery,
                      body.repeatUnit, body.repeatFrom, body.objectId, db.now()))
        return _task(_need(conn, "tasks", tid, "Task"))


@router.patch("/tasks/{tid}")
def patch_task(tid: str, body: TaskPatch):
    fields = body.model_fields_set
    with db.session() as conn:
        r = _need(conn, "tasks", tid, "Task")
        if "due" in fields:
            _day(body.due, "due date")
        every = body.repeatEvery if "repeatEvery" in fields else r["repeat_every"]
        unit = body.repeatUnit if "repeatUnit" in fields else r["repeat_unit"]
        _check_repeat(every, unit)
        cols = {"title": body.title, "notes": body.notes, "category": body.category, "priority": body.priority, "repeat_from": body.repeatFrom}
        for col, v in cols.items():
            if v is not None:
                conn.execute(f"UPDATE tasks SET {col}=? WHERE id=?", (v.strip() if isinstance(v, str) and col in ("title", "category") else v, tid))
        if "due" in fields:
            conn.execute("UPDATE tasks SET due=? WHERE id=?", (body.due or None, tid))
        if "objectId" in fields:
            conn.execute("UPDATE tasks SET object_id=? WHERE id=?", (body.objectId or None, tid))
        if "repeatEvery" in fields or "repeatUnit" in fields:
            conn.execute("UPDATE tasks SET repeat_every=?, repeat_unit=? WHERE id=?", (every, unit, tid))
        if body.status is not None:
            conn.execute("UPDATE tasks SET status=?, completed_at=? WHERE id=?", (body.status, db.now() if body.status == "done" else None, tid))
        return _task(_need(conn, "tasks", tid, "Task"))


@router.delete("/tasks/{tid}", status_code=204)
def delete_task(tid: str):
    with db.session() as conn:
        _need(conn, "tasks", tid, "Task")
        conn.execute("DELETE FROM tasks WHERE id=?", (tid,))


class CompleteIn(BaseModel):
    note: str = Field(default="", max_length=1000)
    completedOn: str | None = None  # the calendar day it was done (default: today on the server's clock)


@router.post("/tasks/{tid}/complete")
def complete_task(tid: str, body: CompleteIn | None = None):
    body = body or CompleteIn()
    done_on = _day(body.completedOn, "completion date") or date.today()
    with db.session() as conn:
        r = _need(conn, "tasks", tid, "Task")
        if r["status"] == "done":
            raise HTTPException(409, "This task is already done.")
        conn.execute("INSERT INTO task_history(task_id,title,object_id,property_id,due,completed_at,note) VALUES (?,?,?,?,?,?,?)",
                     (tid, r["title"], r["object_id"], r["property_id"], r["due"], done_on.isoformat(), body.note))
        if r["repeat_every"] and r["repeat_unit"]:
            due = date.fromisoformat(r["due"]) if r["due"] else None
            nxt = recurrence.next_due(due, r["repeat_every"], r["repeat_unit"], r["repeat_from"], done_on)
            conn.execute("UPDATE tasks SET due=? WHERE id=?", (nxt.isoformat(), tid))
        else:
            conn.execute("UPDATE tasks SET status='done', completed_at=? WHERE id=?", (done_on.isoformat(), tid))
        return _task(_need(conn, "tasks", tid, "Task"))


@router.get("/tasks-history")
def task_history(propertyId: str | None = None, objectId: str | None = None, limit: int = 100):
    q, args = "SELECT * FROM task_history WHERE 1=1", []
    if propertyId:
        q += " AND property_id=?"
        args.append(propertyId)
    if objectId:
        q += " AND object_id=?"
        args.append(objectId)
    q += " ORDER BY completed_at DESC, id DESC LIMIT ?"
    args.append(max(1, min(limit, 500)))
    with db.session() as conn:
        return [{"id": r["id"], "taskId": r["task_id"], "title": r["title"], "objectId": r["object_id"], "due": r["due"], "completedOn": r["completed_at"], "note": r["note"]}
                for r in conn.execute(q, args)]


@router.get("/properties/{pid}/tasks.csv")
def tasks_csv(pid: str):
    with db.session() as conn:
        _need(conn, "properties", pid, "Property")
        rows = conn.execute("SELECT * FROM tasks WHERE property_id=? ORDER BY status, due", (pid,)).fetchall()
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id,name FROM map_objects WHERE property_id=?", (pid,))}
    out = io.StringIO()
    w = csv.writer(out)
    w.writerow(["title", "status", "due", "priority", "category", "repeats", "object", "notes"])
    for r in rows:
        rep = f"every {r['repeat_every']} {r['repeat_unit']}(s)" if r["repeat_every"] else ""
        w.writerow([_csv_safe(r["title"]), r["status"], r["due"] or "", r["priority"], _csv_safe(r["category"]), rep, _csv_safe(names.get(r["object_id"], "")), _csv_safe(r["notes"])])
    return Response(out.getvalue(), media_type="text/csv", headers={"Content-Disposition": 'attachment; filename="tasks.csv"'})


def _ics_escape(v: str) -> str:
    """RFC 5545 text escaping."""
    v = v.replace("\\", "\\\\").replace(";", "\\;").replace(",", "\\,")
    return v.replace("\r\n", "\\n").replace("\n", "\\n").replace("\r", "\\n")


def _ics_fold(line: str) -> str:
    """RFC 5545: lines longer than 75 octets are folded (continuation lines start with a space)."""
    if len(line.encode("utf-8")) <= 75:
        return line
    parts: list[bytes] = []
    cur = b""
    for ch in line:
        b = ch.encode("utf-8")
        limit = 75 if not parts else 74
        if len(cur) + len(b) > limit:
            parts.append(cur)
            cur = b""
        cur += b
    parts.append(cur)
    return "\r\n ".join(x.decode("utf-8") for x in parts)


RRULE_FREQ = {"day": "DAILY", "week": "WEEKLY", "month": "MONTHLY", "year": "YEARLY"}


def build_ics(property_name: str, rows, names: dict[str, str]) -> str:
    """Open tasks with a due date as all-day calendar events (repeats that follow the due date become RRULEs)."""
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//EDEN Smart Estate//Tasks//EN", "CALSCALE:GREGORIAN", f"X-WR-CALNAME:{_ics_escape('EDEN: ' + property_name)}"]
    for r in rows:
        if r["status"] != "open" or not r["due"]:
            continue
        d = date.fromisoformat(r["due"])
        desc = [r["notes"]] if r["notes"] else []
        if r["object_id"] and names.get(r["object_id"]):
            desc.append(f"About: {names[r['object_id']]}")
        if r["repeat_every"] and r["repeat_from"] == "completion":
            desc.append(f"Repeats {r['repeat_every']} {r['repeat_unit']}(s) after completion (shown once: it moves when you finish it in EDEN).")
        lines += ["BEGIN:VEVENT", f"UID:{r['id']}@eden-smart-estate", f"DTSTAMP:{stamp}", f"DTSTART;VALUE=DATE:{d.strftime('%Y%m%d')}",
                  f"DTEND;VALUE=DATE:{(d + timedelta(days=1)).strftime('%Y%m%d')}", f"SUMMARY:{_ics_escape(r['title'])}"]
        if desc:
            lines.append(f"DESCRIPTION:{_ics_escape(chr(10).join(desc))}")
        if r["category"]:
            lines.append(f"CATEGORIES:{_ics_escape(r['category'])}")
        if r["repeat_every"] and r["repeat_unit"] and r["repeat_from"] == "due":
            lines.append(f"RRULE:FREQ={RRULE_FREQ[r['repeat_unit']]};INTERVAL={r['repeat_every']}")
        lines.append({"high": "PRIORITY:1", "low": "PRIORITY:9"}.get(r["priority"], "PRIORITY:5"))
        lines += ["BEGIN:VALARM", "ACTION:DISPLAY", f"DESCRIPTION:{_ics_escape(r['title'])}", "TRIGGER;RELATED=START:PT9H", "END:VALARM", "END:VEVENT"]
    lines.append("END:VCALENDAR")
    return "\r\n".join(_ics_fold(x) for x in lines) + "\r\n"


@router.get("/properties/{pid}/tasks.ics")
def tasks_ics(pid: str):
    with db.session() as conn:
        prop = _need(conn, "properties", pid, "Property")
        rows = conn.execute("SELECT * FROM tasks WHERE property_id=? ORDER BY due", (pid,)).fetchall()
        names = {r["id"]: r["name"] for r in conn.execute("SELECT id,name FROM map_objects WHERE property_id=?", (pid,))}
    return Response(build_ics(prop["name"], rows, names), media_type="text/calendar", headers={"Content-Disposition": 'attachment; filename="eden-tasks.ics"'})


def _csv_safe(v: str) -> str:
    """Stop spreadsheet formula injection: text starting with = + - @ is prefixed with an apostrophe."""
    return "'" + v if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v


# ------------------------------------------------------------------ documents and photos
ALLOWED = {
    ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".gif": "image/gif", ".pdf": "application/pdf",
    ".txt": "text/plain", ".csv": "text/csv", ".md": "text/plain",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".odt": "application/vnd.oasis.opendocument.text", ".ods": "application/vnd.oasis.opendocument.spreadsheet",
}
MAGIC = {".jpg": [b"\xff\xd8\xff"], ".jpeg": [b"\xff\xd8\xff"], ".png": [b"\x89PNG\r\n\x1a\n"], ".gif": [b"GIF87a", b"GIF89a"], ".pdf": [b"%PDF-"],
         ".docx": [b"PK\x03\x04"], ".xlsx": [b"PK\x03\x04"], ".odt": [b"PK\x03\x04"], ".ods": [b"PK\x03\x04"]}
INLINE = {"image/jpeg", "image/png", "image/webp", "image/gif", "application/pdf"}


def sniff_ok(ext: str, head: bytes) -> bool:
    if ext == ".webp":
        return head[:4] == b"RIFF" and head[8:12] == b"WEBP"
    if ext in (".txt", ".csv", ".md"):
        return b"\x00" not in head
    return any(head.startswith(m) for m in MAGIC.get(ext, []))


def _doc(r) -> dict:
    return {
        "id": r["id"], "propertyId": r["property_id"], "objectId": r["object_id"], "title": r["title"], "originalName": r["original_name"], "mime": r["mime"],
        "size": r["size"], "tags": [t for t in r["tags"].split(",") if t], "note": r["note"], "takenAt": r["taken_at"], "createdAt": r["created_at"],
        "isImage": r["mime"].startswith("image/"), "url": f"/api/documents/{r['id']}/file",
        "textStatus": r["ocr_status"], "textNote": r["ocr_note"] if r["ocr_status"] in ("done", "none") else "",
    }


def _tags(s: str) -> str:
    seen: list[str] = []
    for t in re.split(r"[,;]", s or ""):
        t = t.strip().lower()[:30].replace(",", " ")
        if t and t not in seen:
            seen.append(t)
    return ",".join(seen[:12])


@router.post("/documents", status_code=201)
async def upload_document(tasks: BackgroundTasks, file: UploadFile = File(...), propertyId: str = Form(...), objectId: str = Form(""), title: str = Form(""),
                          tags: str = Form(""), note: str = Form(""), takenAt: str = Form(""), stripMetadata: str = Form("true"), readText: str = Form("true")):
    name = Path(file.filename or "file").name
    ext = Path(name).suffix.lower()
    if ext not in ALLOWED:
        raise HTTPException(415, f"File type {ext or '(none)'} is not allowed. Allowed: {', '.join(sorted(ALLOWED))}.")
    data = await file.read(config.MAX_UPLOAD_BYTES + 1)
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, f"File is larger than {config.MAX_UPLOAD_BYTES // (1024 * 1024)} MB.")
    if not data:
        raise HTTPException(422, "The file is empty.")
    if not sniff_ok(ext, data[:16]):
        raise HTTPException(415, f"The content of {name} does not look like a {ext} file.")
    _day(takenAt, "date taken")
    removed: list[str] = []
    if stripMetadata.lower() not in ("false", "0", "no", "off"):
        data, removed = privacy.strip_metadata(ext, data)
    did = db.new_id()
    stored = f"doc_{did}{ext}"
    with db.session() as conn:
        _need(conn, "properties", propertyId, "Property")
        config.ensure_dirs()
        (config.UPLOAD_DIR / stored).write_bytes(data)
        conn.execute("INSERT INTO documents(id,property_id,object_id,title,filename,original_name,mime,size,tags,note,taken_at,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
                     (did, propertyId, objectId or None, (title.strip() or Path(name).stem)[:200], stored, name[:200], ALLOWED[ext], len(data), _tags(tags), note[:2000], takenAt or None, db.now()))
        read = readText.lower() not in ("false", "0", "no", "off")
        if read:
            conn.execute("UPDATE documents SET ocr_status='pending' WHERE id=?", (did,))
            tasks.add_task(ocr.process_document, did)
        return {**_doc(_need(conn, "documents", did, "Document")), "metadataRemoved": removed}


@router.get("/documents")
def list_documents(propertyId: str | None = None, objectId: str | None = None, q: str | None = None, kind: str | None = None):
    sql, args = "SELECT * FROM documents WHERE 1=1", []
    if propertyId:
        sql += " AND property_id=?"
        args.append(propertyId)
    if objectId:
        sql += " AND object_id=?"
        args.append(objectId)
    if kind == "photo":
        sql += " AND mime LIKE 'image/%'"
    elif kind == "document":
        sql += " AND mime NOT LIKE 'image/%'"
    if q and q.strip():
        like = f"%{q.strip().lower()}%"
        sql += " AND (lower(title) LIKE ? OR lower(tags) LIKE ? OR lower(note) LIKE ? OR lower(original_name) LIKE ?)"
        args += [like] * 4
    sql += " ORDER BY COALESCE(taken_at, substr(created_at,1,10)) DESC, created_at DESC"
    with db.session() as conn:
        return [_doc(r) for r in conn.execute(sql, args)]


class DocPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    tags: str | None = None
    note: str | None = Field(default=None, max_length=2000)
    objectId: str | None = None
    takenAt: str | None = None


@router.patch("/documents/{did}")
def patch_document(did: str, body: DocPatch):
    fields = body.model_fields_set
    with db.session() as conn:
        _need(conn, "documents", did, "Document")
        if body.title is not None:
            conn.execute("UPDATE documents SET title=? WHERE id=?", (body.title.strip(), did))
        if body.tags is not None:
            conn.execute("UPDATE documents SET tags=? WHERE id=?", (_tags(body.tags), did))
        if body.note is not None:
            conn.execute("UPDATE documents SET note=? WHERE id=?", (body.note, did))
        if "objectId" in fields:
            conn.execute("UPDATE documents SET object_id=? WHERE id=?", (body.objectId or None, did))
        if "takenAt" in fields:
            _day(body.takenAt, "date taken")
            conn.execute("UPDATE documents SET taken_at=? WHERE id=?", (body.takenAt or None, did))
        return _doc(_need(conn, "documents", did, "Document"))


@router.delete("/documents/{did}", status_code=204)
def delete_document(did: str):
    with db.session() as conn:
        r = _need(conn, "documents", did, "Document")
        conn.execute("DELETE FROM documents WHERE id=?", (did,))
    (config.UPLOAD_DIR / r["filename"]).unlink(missing_ok=True)


@router.get("/documents/{did}/file")
def document_file(did: str, download: bool = False):
    with db.session() as conn:
        r = _need(conn, "documents", did, "Document")
    path = config.UPLOAD_DIR / r["filename"]
    if not path.is_file():
        raise HTTPException(404, "The file is missing from the data folder.")
    inline = r["mime"] in INLINE and not download
    safe_name = re.sub(r'[^\w.\- ]', "_", r["original_name"])
    return FileResponse(path, media_type=r["mime"], headers={
        "Content-Disposition": f'{"inline" if inline else "attachment"}; filename="{safe_name}"',
        "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
    })


# ------------------------------------------------------------------ weather (opt-in)
def _setting(conn, key: str, default: str = "") -> str:
    r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


WEATHER_TTL_S = 20 * 60
WEATHER_TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests inject httpx.MockTransport


class WeatherSettings(BaseModel):
    enabled: bool


@router.get("/weather/settings")
def weather_settings():
    with db.session() as conn:
        return {"enabled": _setting(conn, "weather_enabled") == "1", "provider": "Open-Meteo", "url": config.WEATHER_URL}


@router.put("/weather/settings")
def set_weather_settings(body: WeatherSettings):
    with db.session() as conn:
        conn.execute("INSERT INTO settings(key,value) VALUES ('weather_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("1" if body.enabled else "0",))
    return weather_settings()


def _trim(raw: dict) -> dict:
    """Keep only the parts EDEN shows (current conditions, 7 days, the next 48 hours)."""
    hourly = raw.get("hourly") or {}
    times = hourly.get("time") or []
    now_prefix = (raw.get("current") or {}).get("time", "")[:13]
    start = next((i for i, t in enumerate(times) if t[:13] >= now_prefix), 0) if now_prefix else 0
    sl = slice(start, start + 48)
    return {
        "timezone": raw.get("timezone"), "units": {k: raw.get(k) for k in ("current_units", "daily_units", "hourly_units")},
        "current": raw.get("current"), "daily": raw.get("daily"), "hourly": {k: v[sl] if isinstance(v, list) else v for k, v in hourly.items()},
        "elevation": raw.get("elevation"),
    }


@router.get("/weather")
async def weather(lat: float, lng: float):
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        raise HTTPException(422, "Coordinates out of range.")
    with db.session() as conn:
        if _setting(conn, "weather_enabled") != "1":
            raise HTTPException(403, "Weather is switched off. It sends this property's coordinates to the weather service, so you have to enable it first.")
        key = f"{round(lat, 2)},{round(lng, 2)}"
        cached = conn.execute("SELECT * FROM weather_cache WHERE key=?", (key,)).fetchone()
    now = datetime.now().astimezone()
    if cached:
        age = (now - datetime.fromisoformat(cached["fetched_at"])).total_seconds()
        if age < WEATHER_TTL_S:
            return {"source": "Open-Meteo", "fetchedAt": cached["fetched_at"], "stale": False, "data": json.loads(cached["body"])}
    params = {
        "latitude": round(lat, 4), "longitude": round(lng, 4), "timezone": "auto", "forecast_days": 7,
        "current": "temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,surface_pressure",
        "hourly": "temperature_2m,precipitation,precipitation_probability,soil_temperature_0cm,wind_speed_10m,weather_code",
        "daily": "weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,sunrise,sunset,uv_index_max",
    }
    try:
        async with httpx.AsyncClient(timeout=15, headers={"User-Agent": config.USER_AGENT}, transport=WEATHER_TRANSPORT) as c:
            r = await c.get(config.WEATHER_URL, params=params)
        if r.status_code != 200:
            raise httpx.HTTPError(f"HTTP {r.status_code}")
        body = _trim(r.json())
        if not body.get("current") or not body.get("daily"):
            raise ValueError("incomplete answer")
    except (httpx.HTTPError, ValueError) as e:
        if cached:
            return {"source": "Open-Meteo", "fetchedAt": cached["fetched_at"], "stale": True, "error": f"Could not refresh ({type(e).__name__}); showing the last real forecast.",
                    "data": json.loads(cached["body"])}
        raise HTTPException(502, "The weather service could not be reached and nothing is stored yet.")
    stamp = now.isoformat(timespec="seconds")
    with db.session() as conn:
        conn.execute("INSERT INTO weather_cache(key,fetched_at,body) VALUES (?,?,?) ON CONFLICT(key) DO UPDATE SET fetched_at=excluded.fetched_at, body=excluded.body",
                     (key, stamp, db.dumps(body)))
    return {"source": "Open-Meteo", "fetchedAt": stamp, "stale": False, "data": body}
