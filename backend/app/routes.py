"""REST API: properties, autosave changes, overlays, import/export, geocoding, backup/restore."""
import json
import shutil
import sqlite3
import tempfile
import zipfile
from pathlib import Path

import httpx
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse, JSONResponse, Response

from . import config, db, exchange, library, repo
from .demo import build_demo
from .layers import GEOMETRY_DEFAULT_KIND, KIND_LAYER
from .models import ChangeSet, Geometry, ObjectIn, OverlayIn, PropertyCreate

router = APIRouter(prefix="/api")

ALLOWED_IMAGE = {"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp"}


@router.get("/health")
def health():
    with db.session() as conn:
        n = conn.execute("SELECT COUNT(*) FROM properties").fetchone()[0]
    return {"status": "ok", "app": "EDEN Smart Estate", "version": "1.0.0", "properties": n}


@router.get("/library")
def get_library():
    """Bundled plant / mushroom / aquatic / companion data (read-only)."""
    return library.payload()


# ---------------------------------------------------------------- properties
@router.get("/properties")
def list_properties():
    with db.session() as conn:
        return repo.list_properties(conn)


@router.post("/properties", status_code=201)
def create_property(body: PropertyCreate):
    with db.session() as conn:
        return repo.create_property(conn, body)


@router.post("/demo", status_code=201)
def create_demo():
    with db.session() as conn:
        if conn.execute("SELECT 1 FROM properties WHERE is_demo=1").fetchone():
            raise HTTPException(409, "A demo property already exists")
        return build_demo(conn)


@router.get("/properties/{pid}")
def get_property(pid: str):
    with db.session() as conn:
        m = repo.full_model(conn, pid)
    if not m:
        raise HTTPException(404, "property not found")
    return m


@router.delete("/properties/{pid}", status_code=204)
def delete_property(pid: str):
    with db.session() as conn:
        if not repo.get_property(conn, pid):
            raise HTTPException(404, "property not found")
        files = repo.delete_property(conn, pid)
    for f in files:
        (config.UPLOAD_DIR / f).unlink(missing_ok=True)


@router.post("/properties/{pid}/changes")
def save_changes(pid: str, body: ChangeSet):
    try:
        with db.session() as conn:
            return repo.apply_changes(conn, pid, body)
    except LookupError:
        raise HTTPException(404, "property not found")
    except ValueError as e:
        raise HTTPException(422, str(e))


# ---------------------------------------------------------------- overlays
@router.post("/properties/{pid}/overlays", status_code=201)
async def add_overlay(pid: str, file: UploadFile = File(...), corners: str = Form(...), name: str = Form(""),
                      calibration: str = Form("{}")):
    ext = ALLOWED_IMAGE.get(file.content_type or "")
    if not ext:
        raise HTTPException(415, "Use a PNG, JPEG or WebP image")
    data = await file.read()
    if len(data) > config.MAX_UPLOAD_BYTES:
        raise HTTPException(413, "Image too large")
    try:
        pts = json.loads(corners)
        Geometry(type="Polygon", coordinates=[pts + [pts[0]]])
        if len(pts) != 4:
            raise ValueError
        cal = json.loads(calibration)
    except Exception:
        raise HTTPException(422, "corners must be four valid [lng, lat] pairs")
    oid = db.new_id()
    filename = oid + ext
    config.ensure_dirs()
    with db.session() as conn:
        if not repo.get_property(conn, pid):
            raise HTTPException(404, "property not found")
        (config.UPLOAD_DIR / filename).write_bytes(data)
        conn.execute(
            "INSERT INTO image_overlays(id,property_id,name,filename,mime,corners,calibration,created_at) VALUES (?,?,?,?,?,?,?,?)",
            (oid, pid, name or (file.filename or "Image"), filename, file.content_type, db.dumps(pts), db.dumps(cal), db.now()))
        return repo.overlay_row(conn.execute("SELECT * FROM image_overlays WHERE id=?", (oid,)).fetchone())


@router.get("/overlays/{oid}/image")
def overlay_image(oid: str):
    with db.session() as conn:
        r = conn.execute("SELECT filename, mime FROM image_overlays WHERE id=?", (oid,)).fetchone()
    if not r:
        raise HTTPException(404, "overlay not found")
    return FileResponse(config.UPLOAD_DIR / r["filename"], media_type=r["mime"])


@router.patch("/overlays/{oid}")
def patch_overlay(oid: str, body: OverlayIn):
    with db.session() as conn:
        if not conn.execute("SELECT 1 FROM image_overlays WHERE id=?", (oid,)).fetchone():
            raise HTTPException(404, "overlay not found")
        if body.name is not None:
            conn.execute("UPDATE image_overlays SET name=? WHERE id=?", (body.name, oid))
        if body.corners is not None:
            if len(body.corners) != 4:
                raise HTTPException(422, "need four corners")
            conn.execute("UPDATE image_overlays SET corners=? WHERE id=?", (db.dumps(body.corners), oid))
        if body.opacity is not None:
            conn.execute("UPDATE image_overlays SET opacity=? WHERE id=?", (body.opacity, oid))
        if body.visible is not None:
            conn.execute("UPDATE image_overlays SET visible=? WHERE id=?", (int(body.visible), oid))
        return repo.overlay_row(conn.execute("SELECT * FROM image_overlays WHERE id=?", (oid,)).fetchone())


@router.delete("/overlays/{oid}", status_code=204)
def delete_overlay(oid: str):
    with db.session() as conn:
        r = conn.execute("SELECT filename FROM image_overlays WHERE id=?", (oid,)).fetchone()
        if not r:
            raise HTTPException(404, "overlay not found")
        conn.execute("DELETE FROM image_overlays WHERE id=?", (oid,))
    (config.UPLOAD_DIR / r["filename"]).unlink(missing_ok=True)


# ---------------------------------------------------------------- geocoding
@router.get("/geocode")
async def geocode(q: str):
    q = q.strip()
    if len(q) < 2:
        return []
    try:
        async with httpx.AsyncClient(timeout=10, headers={"User-Agent": config.USER_AGENT}) as client:
            r = await client.get(config.GEOCODER_URL, params={"q": q, "format": "jsonv2", "limit": 6})
        r.raise_for_status()
    except httpx.HTTPError:
        raise HTTPException(502, "Geocoder unavailable. You can enter coordinates as 'lat, lng' instead.")
    return [{"label": x["display_name"], "center": [float(x["lon"]), float(x["lat"])]} for x in r.json()]


# ---------------------------------------------------------------- export / import
def _model_or_404(pid: str) -> dict:
    with db.session() as conn:
        m = repo.full_model(conn, pid)
    if not m:
        raise HTTPException(404, "property not found")
    return m


def _download(content: str | bytes, media: str, filename: str) -> Response:
    return Response(content, media_type=media, headers={"Content-Disposition": f'attachment; filename="{filename}"'})


def _slug(name: str) -> str:
    return "".join(c if c.isalnum() else "-" for c in name).strip("-").lower() or "property"


@router.get("/properties/{pid}/export.{fmt}")
def export_property(pid: str, fmt: str):
    m = _model_or_404(pid)
    slug = _slug(m["property"]["name"])
    if fmt == "geojson":
        return _download(json.dumps(exchange.to_geojson(m)), "application/geo+json", f"{slug}.geojson")
    if fmt == "kml":
        return _download(exchange.to_kml(m), "application/vnd.google-earth.kml+xml", f"{slug}.kml")
    if fmt == "csv":
        return _download(exchange.to_csv(m), "text/csv", f"{slug}.csv")
    if fmt == "json":
        m["format"] = "eden-project/1"
        return _download(json.dumps(m), "application/json", f"{slug}.eden.json")
    raise HTTPException(404, "unknown format")


@router.post("/properties/{pid}/import")
async def import_features(pid: str, file: UploadFile = File(...)):
    text = (await file.read()).decode("utf-8-sig", errors="replace")
    name = (file.filename or "").lower()
    try:
        feats = exchange.parse_kml(text) if name.endswith(".kml") else exchange.parse_geojson(text)
    except Exception as e:
        raise HTTPException(422, f"Could not read file: {e}")
    imported = 0
    with db.session() as conn:
        layers = {r["key"]: r["id"] for r in conn.execute("SELECT id,key FROM map_layers WHERE property_id=?", (pid,))}
        if not layers:
            raise HTTPException(404, "property not found")
        for f in feats:
            kind = f["kind"] if f["kind"] in KIND_LAYER else GEOMETRY_DEFAULT_KIND[f["geometry"]["type"]]
            try:
                obj = ObjectIn(id=db.new_id(), layerId=layers[KIND_LAYER[kind]], kind=kind, name=f["name"][:200],
                               geometry=Geometry(**f["geometry"]), props=f["props"])
            except ValueError:
                continue
            repo._upsert_object(conn, pid, obj)
            imported += 1
    return {"imported": imported, "skipped": len(feats) - imported}


@router.post("/import-project", status_code=201)
async def import_project(file: UploadFile = File(...)):
    """Re-create a property from an .eden.json export (new ids, so it never clobbers existing data)."""
    try:
        data = json.loads((await file.read()).decode("utf-8-sig"))
        prop, layers, objects = data["property"], data["layers"], data["objects"]
    except Exception:
        raise HTTPException(422, "Not an EDEN project export")
    with db.session() as conn:
        p = repo.create_property(conn, PropertyCreate(name=prop["name"] + " (imported)", description=prop.get("description", ""),
                                                      center=tuple(prop["center"]), zoom=prop.get("zoom", 17)))
        by_key = {r["key"]: r["id"] for r in conn.execute("SELECT id,key FROM map_layers WHERE property_id=?", (p["id"],))}
        old_to_new = {}
        for l in layers:
            if l["key"] in by_key:
                old_to_new[l["id"]] = by_key[l["key"]]
                conn.execute("UPDATE map_layers SET name=?, color=?, visible=?, locked=?, sort_order=? WHERE id=?",
                             (l["name"], l["color"], int(l["visible"]), int(l["locked"]), l["order"], by_key[l["key"]]))
        for o in objects:
            if o["layerId"] in old_to_new:
                repo._upsert_object(conn, p["id"], ObjectIn(id=db.new_id(), layerId=old_to_new[o["layerId"]], kind=o["kind"],
                                                           name=o["name"], geometry=Geometry(**o["geometry"]), props=o["props"]))
        return p


# ---------------------------------------------------------------- backup / restore
@router.get("/backup")
def backup():
    """Zip with a consistent copy of the database plus all uploaded images."""
    config.ensure_dirs()
    tmp = Path(tempfile.mkdtemp())
    try:
        snap = tmp / "eden.db"
        src = sqlite3.connect(config.DB_PATH)
        dst = sqlite3.connect(snap)
        src.backup(dst)
        src.close()
        dst.close()
        out = tmp / "eden-backup.zip"
        with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
            z.write(snap, "eden.db")
            z.writestr("manifest.json", json.dumps({"format": "eden-backup/1", "created": db.now()}))
            for f in config.UPLOAD_DIR.glob("*"):
                if f.is_file():
                    z.write(f, f"uploads/{f.name}")
        data = out.read_bytes()
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    stamp = db.now().replace(":", "").replace("-", "")[:15]
    return _download(data, "application/zip", f"eden-backup-{stamp}.zip")


@router.post("/restore")
async def restore(file: UploadFile = File(...)):
    raw = await file.read()
    tmp = Path(tempfile.mkdtemp())
    try:
        zpath = tmp / "in.zip"
        zpath.write_bytes(raw)
        try:
            z = zipfile.ZipFile(zpath)
            names = z.namelist()
            if "eden.db" not in names or "manifest.json" not in names:
                raise ValueError
            if json.loads(z.read("manifest.json")).get("format") != "eden-backup/1":
                raise ValueError
        except Exception:
            raise HTTPException(422, "Not an EDEN backup file")
        z.extract("eden.db", tmp)
        probe = sqlite3.connect(tmp / "eden.db")
        try:
            probe.execute("SELECT COUNT(*) FROM properties")
        except sqlite3.DatabaseError:
            raise HTTPException(422, "Backup database is damaged")
        finally:
            probe.close()
        # safety copy of the current state before replacing it
        config.ensure_dirs()
        safety = config.BACKUP_DIR / f"before-restore-{db.now().replace(':', '').replace('-', '')[:15]}.db"
        s = sqlite3.connect(config.DB_PATH)
        d = sqlite3.connect(safety)
        s.backup(d)
        s.close()
        d.close()
        target = sqlite3.connect(config.DB_PATH)
        source = sqlite3.connect(tmp / "eden.db")
        source.backup(target)
        source.close()
        target.close()
        for f in config.UPLOAD_DIR.glob("*"):
            if f.is_file():
                f.unlink()
        for n in names:
            if n.startswith("uploads/") and not n.endswith("/") and "/" not in n[len("uploads/"):] and ".." not in n:
                (config.UPLOAD_DIR / Path(n).name).write_bytes(z.read(n))
        z.close()
        db.migrate()  # bring older backups up to the current schema
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    return {"restored": True, "safetyCopy": safety.name}
