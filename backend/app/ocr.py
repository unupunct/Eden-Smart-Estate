"""Reading text out of documents so they can be searched.

* Text files, Word, Excel and OpenDocument files, and PDFs with a text layer: the text is simply taken from the file.
* Photos, scans and PDFs that are only pictures: read with Tesseract OCR when it is installed on this computer
  (the installer offers it; `EDEN_TESSERACT` can point at it). Everything runs locally; nothing is uploaded anywhere.

OCR output is machine-read and can contain mistakes (smudged print, handwriting, unusual fonts); EDEN always labels it
as such and never treats it as a verified value.
"""
import asyncio
import io
import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from pathlib import Path
from xml.etree import ElementTree as ET

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from . import config, db

router = APIRouter(prefix="/api")

MAX_TEXT = 200_000        # characters kept per document
MAX_PDF_PAGES = 40
OCR_TIMEOUT_S = 90
IMAGE_EXT = {".jpg", ".jpeg", ".png", ".gif", ".webp"}
FILE_TEXT_EXT = {".txt", ".csv", ".md", ".docx", ".xlsx", ".odt", ".ods"}
_NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)

TESSERACT_CANDIDATES = (
    r"C:\Program Files\Tesseract-OCR\tesseract.exe",
    r"C:\Program Files (x86)\Tesseract-OCR\tesseract.exe",
    os.path.expandvars(r"%LOCALAPPDATA%\Programs\Tesseract-OCR\tesseract.exe"),
)


# ------------------------------------------------------------------ engine
def find_tesseract() -> str | None:
    env = os.environ.get("EDEN_TESSERACT", "")
    if env and Path(env).is_file():
        return env
    found = shutil.which("tesseract")
    if found:
        return found
    for c in TESSERACT_CANDIDATES:
        if Path(c).is_file():
            return c
    return None


def _run(cmd: list[str], timeout: int, env: dict | None = None) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, capture_output=True, timeout=timeout, creationflags=_NO_WINDOW, env=env)


def extra_tessdata() -> Path:
    return config.DATA_DIR / "tessdata"


def installed_languages(exe: str) -> dict[str, str]:
    """language code -> tessdata directory ('' = the engine's own). Languages dropped into data/tessdata count too."""
    langs: dict[str, str] = {}
    try:
        out = _run([exe, "--list-langs"], 20).stdout.decode("utf-8", "replace")
        for line in out.splitlines()[1:]:
            line = line.strip()
            if line and line != "osd":
                langs[line] = ""
    except (OSError, subprocess.SubprocessError):
        pass
    extra = extra_tessdata()
    if extra.is_dir():
        for f in extra.glob("*.traineddata"):
            if f.stem != "osd":
                langs.setdefault(f.stem, str(extra))
    return langs


def selected_languages(conn=None) -> list[str]:
    def get(c):
        r = c.execute("SELECT value FROM settings WHERE key='ocr_langs'").fetchone()
        return r["value"] if r else "eng"
    raw = get(conn) if conn is not None else _with_conn(get)
    return [x for x in re.split(r"[+, ]+", raw) if re.fullmatch(r"[a-z_]{2,12}", x)] or ["eng"]


def _with_conn(fn):
    with db.session() as c:
        return fn(c)


def status_info() -> dict:
    exe = find_tesseract()
    sel = selected_languages()
    if not exe:
        return {"available": False, "engine": None, "version": "", "installed": [], "selected": sel, "usable": [],
                "hint": "Tesseract OCR is not installed on this computer. Photos and scanned PDFs cannot be read until it is (the installer can add it, or: winget install UB-Mannheim.TesseractOCR). Text files, Word/Excel/OpenDocument files and PDFs with a text layer are searchable without it."}
    try:
        version = _run([exe, "--version"], 20).stdout.decode("utf-8", "replace").splitlines()[0]
    except (OSError, subprocess.SubprocessError, IndexError):
        version = ""
    inst = installed_languages(exe)
    usable = [x for x in sel if x in inst]
    hint = ""
    missing = [x for x in sel if x not in inst]
    if missing:
        hint = f"Language data for {', '.join(missing)} is not installed. Put {missing[0]}.traineddata into {extra_tessdata()} (scripts\\get-ocr-language.ps1 {missing[0]} downloads it)."
    return {"available": True, "engine": exe, "version": version, "installed": sorted(inst), "selected": sel, "usable": usable, "hint": hint}


def ocr_image_file(path: str, exe: str, langs: list[str]) -> str:
    inst = installed_languages(exe)
    use = [x for x in langs if x in inst] or (["eng"] if "eng" in inst else list(inst)[:1])
    if not use:
        raise RuntimeError("no OCR language data is installed")
    base = [exe, path, "stdout", "-l", "+".join(use), "--psm", "3"]
    dirs = {inst[x] for x in use}
    if dirs == {""}:
        r = _run(base, OCR_TIMEOUT_S)
    else:
        # Tesseract reads all languages from one folder: gather the ones we need (engine's own + data/tessdata) in a temp folder
        own = Path(os.environ.get("TESSDATA_PREFIX", "")) if os.environ.get("TESSDATA_PREFIX") else Path(exe).parent / "tessdata"
        with tempfile.TemporaryDirectory() as td:
            for x in use:
                src = (Path(inst[x]) if inst[x] else own) / f"{x}.traineddata"
                if src.is_file():
                    shutil.copyfile(src, Path(td) / src.name)
            r = _run(base + ["--tessdata-dir", td], OCR_TIMEOUT_S)
    if r.returncode != 0:
        raise RuntimeError(r.stderr.decode("utf-8", "replace").strip().splitlines()[-1] if r.stderr else "OCR failed")
    return r.stdout.decode("utf-8", "replace")


# ------------------------------------------------------------------ extraction
def _clean(text: str) -> str:
    text = text.replace("\x00", "").replace("\r\n", "\n")
    text = re.sub(r"[ \t\f\v]+", " ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()[:MAX_TEXT]


def _xml_text(xml: bytes, tags: set[str]) -> str:
    out, root = [], ET.fromstring(xml)
    for el in root.iter():
        local = el.tag.rsplit("}", 1)[-1]
        if local in tags and el.text:
            out.append(el.text)
        elif local in ("p", "tab", "br", "tr", "row", "h") and out and out[-1] != "\n":
            out.append("\n")
    return "".join(out)


def file_text(ext: str, data: bytes) -> str:
    """Text that is already inside the file."""
    if ext in (".txt", ".csv", ".md"):
        for enc in ("utf-8-sig", "cp1250", "latin-1"):
            try:
                return data.decode(enc)
            except UnicodeDecodeError:
                continue
    z = zipfile.ZipFile(io.BytesIO(data))
    names = set(z.namelist())
    if sum(i.file_size for i in z.infolist()) > 200 * 1024 * 1024:
        raise RuntimeError("the archive expands to an unreasonable size")
    if ext == ".docx" and "word/document.xml" in names:
        return _xml_text(z.read("word/document.xml"), {"t"})
    if ext == ".xlsx":
        parts = [n for n in ("xl/sharedStrings.xml",) if n in names]
        return " ".join(_xml_text(z.read(n), {"t"}) for n in parts)
    if ext in (".odt", ".ods") and "content.xml" in names:
        return _xml_text(z.read("content.xml"), {"p", "h", "span"})
    return ""


def pdf_text(data: bytes, exe: str | None, langs: list[str]) -> tuple[str, str]:
    """(text, note). Uses the text layer; pages that are only pictures go through OCR when an engine exists."""
    from pypdf import PdfReader
    reader = PdfReader(io.BytesIO(data))
    parts: list[str] = []
    used_ocr = False
    for page in list(reader.pages)[:MAX_PDF_PAGES]:
        t = (page.extract_text() or "").strip()
        if len(t) >= 25 or exe is None:
            parts.append(t)
            continue
        got = ""
        for img in list(page.images)[:3]:
            with tempfile.TemporaryDirectory() as d:
                f = Path(d) / ("p" + (Path(img.name).suffix or ".png"))
                f.write_bytes(img.data)
                try:
                    got += "\n" + ocr_image_file(str(f), exe, langs)
                    used_ocr = True
                except (RuntimeError, OSError, subprocess.SubprocessError):
                    pass
        parts.append((t + "\n" + got).strip())
    return "\n\n".join(parts), ("ocr" if used_ocr else "text-layer")


def extract(ext: str, data: bytes, langs: list[str] | None = None) -> tuple[str, str, str]:
    """-> (status, text, note). status: done | none | unavailable. note: ocr | text-layer | file-text."""
    langs = langs or ["eng"]
    exe = find_tesseract()
    if ext in FILE_TEXT_EXT:
        t = _clean(file_text(ext, data))
        return ("done" if t else "none"), t, "file-text"
    if ext == ".pdf":
        t, note = pdf_text(data, exe, langs)
        t = _clean(t)
        if t:
            return "done", t, note
        return ("none" if exe else "unavailable"), "", note
    if ext in IMAGE_EXT:
        if exe is None:
            return "unavailable", "", "ocr"
        with tempfile.TemporaryDirectory() as d:
            f = Path(d) / f"scan{ext}"
            f.write_bytes(data)
            t = _clean(ocr_image_file(str(f), exe, langs))
        return ("done" if t else "none"), t, "ocr"
    return "none", "", ""


def process_document(did: str) -> None:
    """Blocking: read one stored document and save the result. Runs in a worker thread after upload."""
    with db.session() as conn:
        r = conn.execute("SELECT filename, original_name FROM documents WHERE id=?", (did,)).fetchone()
        if not r:
            return
        langs = selected_languages(conn)
        conn.execute("UPDATE documents SET ocr_status='pending' WHERE id=?", (did,))
    path = config.UPLOAD_DIR / r["filename"]
    ext = Path(r["filename"]).suffix.lower()
    try:
        status, text, note = extract(ext, path.read_bytes(), langs)
        msg = ""
    except Exception as e:  # a broken file must never break the upload; the reason is shown on the document
        status, text, note, msg = "error", "", "", f"{type(e).__name__}: {str(e)[:160]}"
    with db.session() as conn:
        conn.execute("UPDATE documents SET ocr_status=?, ocr_text=?, ocr_note=? WHERE id=?", (status, text or None, note or msg, did))


# ------------------------------------------------------------------ API
class OcrSettings(BaseModel):
    languages: list[str] = Field(min_length=1, max_length=4)


@router.get("/ocr/status")
def ocr_status():
    return status_info()


@router.put("/ocr/settings")
def ocr_settings(body: OcrSettings):
    langs = [x.strip().lower() for x in body.languages]
    if not all(re.fullmatch(r"[a-z_]{2,12}", x) for x in langs):
        raise HTTPException(422, "Language codes look like eng, ron, deu.")
    with db.session() as conn:
        conn.execute("INSERT INTO settings(key,value) VALUES ('ocr_langs',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("+".join(langs),))
    return status_info()


@router.get("/documents/{did}/text")
def document_text(did: str):
    with db.session() as conn:
        r = conn.execute("SELECT ocr_text, ocr_status, ocr_note FROM documents WHERE id=?", (did,)).fetchone()
    if not r:
        raise HTTPException(404, "Document not found.")
    return {"status": r["ocr_status"], "note": r["ocr_note"], "text": r["ocr_text"] or "",
            "label": {"ocr": "Machine-read text (OCR): it can contain mistakes.", "text-layer": "Text taken from the PDF.", "file-text": "Text taken from the file."}.get(r["ocr_note"], "")}


@router.post("/documents/{did}/ocr", status_code=202)
def reread(did: str, tasks: BackgroundTasks):
    with db.session() as conn:
        if not conn.execute("SELECT 1 FROM documents WHERE id=?", (did,)).fetchone():
            raise HTTPException(404, "Document not found.")
        conn.execute("UPDATE documents SET ocr_status='pending' WHERE id=?", (did,))
    tasks.add_task(process_document, did)
    return {"queued": 1}


@router.post("/ocr/run-missing", status_code=202)
def run_missing(tasks: BackgroundTasks, propertyId: str | None = None):
    """Read every document that has never been read (older uploads) or could not be read before OCR was installed."""
    with db.session() as conn:
        sql = "SELECT id FROM documents WHERE (ocr_status IN ('', 'unavailable', 'error'))" + (" AND property_id=?" if propertyId else "")
        ids = [r["id"] for r in conn.execute(sql, [propertyId] if propertyId else [])]
        conn.executemany("UPDATE documents SET ocr_status='pending' WHERE id=?", [(i,) for i in ids])
    for i in ids:
        tasks.add_task(process_document, i)
    return {"queued": len(ids)}


@router.get("/documents-text/search")
def search_text(q: str, propertyId: str | None = None, limit: int = 50):
    """Documents whose machine-read or file text contains q, with a short snippet around the match."""
    needle = q.strip()
    if len(needle) < 2:
        return []
    like = "%" + needle.lower().replace("%", r"\%").replace("_", r"\_") + "%"
    sql = "SELECT id, ocr_text, ocr_note FROM documents WHERE ocr_text IS NOT NULL AND lower(ocr_text) LIKE ? ESCAPE '\\'" + (" AND property_id=?" if propertyId else "")
    out = []
    with db.session() as conn:
        for r in conn.execute(sql, [like] + ([propertyId] if propertyId else [])):
            text = r["ocr_text"]
            i = text.lower().find(needle.lower())
            a, b = max(0, i - 50), min(len(text), i + len(needle) + 70)
            out.append({"id": r["id"], "snippet": ("…" if a else "") + re.sub(r"\s+", " ", text[a:b]).strip() + ("…" if b < len(text) else ""), "note": r["ocr_note"]})
            if len(out) >= limit:
                break
    return out


async def run_in_thread(did: str) -> None:
    await asyncio.to_thread(process_document, did)
