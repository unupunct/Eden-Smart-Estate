"""Persistence for properties, layers, objects and overlays."""
import json
import sqlite3
from typing import Any

from . import db
from .layers import DEFAULT_LAYERS
from .models import ChangeSet, LayerIn, ObjectIn, PropertyCreate


def _prop_row(r: sqlite3.Row) -> dict:
    return {
        "id": r["id"], "name": r["name"], "description": r["description"],
        "center": [r["center_lng"], r["center_lat"]], "zoom": r["zoom"],
        "bearing": r["bearing"], "pitch": r["pitch"], "baseMap": r["base_map"],
        "isDemo": bool(r["is_demo"]), "createdAt": r["created_at"], "updatedAt": r["updated_at"],
    }


def _layer_row(r) -> dict:
    return {"id": r["id"], "key": r["key"], "name": r["name"], "group": r["group_name"], "color": r["color"],
            "visible": bool(r["visible"]), "locked": bool(r["locked"]), "order": r["sort_order"]}


def _object_row(r) -> dict:
    return {"id": r["id"], "layerId": r["layer_id"], "kind": r["kind"], "name": r["name"],
            "geometry": json.loads(r["geometry"]), "props": json.loads(r["props"]), "rev": r["rev"],
            "createdAt": r["created_at"], "updatedAt": r["updated_at"]}


def overlay_row(r) -> dict:
    return {"id": r["id"], "name": r["name"], "mime": r["mime"], "corners": json.loads(r["corners"]),
            "opacity": r["opacity"], "visible": bool(r["visible"]), "calibration": json.loads(r["calibration"]),
            "url": f"/api/overlays/{r['id']}/image"}


def list_properties(conn) -> list[dict]:
    out = []
    for r in conn.execute("SELECT * FROM properties ORDER BY created_at"):
        p = _prop_row(r)
        p["objectCount"] = conn.execute("SELECT COUNT(*) FROM map_objects WHERE property_id=?", (r["id"],)).fetchone()[0]
        out.append(p)
    return out


def get_property(conn, pid: str) -> dict | None:
    r = conn.execute("SELECT * FROM properties WHERE id=?", (pid,)).fetchone()
    return _prop_row(r) if r else None


def create_property(conn, data: PropertyCreate, is_demo: bool = False, pid: str | None = None) -> dict:
    pid = pid or db.new_id()
    t = db.now()
    conn.execute(
        "INSERT INTO properties(id,name,description,center_lng,center_lat,zoom,is_demo,created_at,updated_at)"
        " VALUES (?,?,?,?,?,?,?,?,?)",
        (pid, data.name, data.description, data.center[0], data.center[1], data.zoom, int(is_demo), t, t))
    for i, (key, name, group, color) in enumerate(DEFAULT_LAYERS):
        conn.execute(
            "INSERT INTO map_layers(id,property_id,key,name,group_name,color,sort_order) VALUES (?,?,?,?,?,?,?)",
            (db.new_id(), pid, key, name, group, color, i))
    return get_property(conn, pid)


def delete_property(conn, pid: str) -> list[str]:
    files = [r["filename"] for r in conn.execute("SELECT filename FROM image_overlays WHERE property_id=?", (pid,))]
    conn.execute("DELETE FROM properties WHERE id=?", (pid,))
    return files


def full_model(conn, pid: str) -> dict | None:
    prop = get_property(conn, pid)
    if not prop:
        return None
    layers = [_layer_row(r) for r in conn.execute(
        "SELECT * FROM map_layers WHERE property_id=? ORDER BY sort_order", (pid,))]
    objects = [_object_row(r) for r in conn.execute(
        "SELECT * FROM map_objects WHERE property_id=? ORDER BY created_at, id", (pid,))]
    overlays = [overlay_row(r) for r in conn.execute(
        "SELECT * FROM image_overlays WHERE property_id=? ORDER BY created_at", (pid,))]
    return {"property": prop, "layers": layers, "objects": objects, "overlays": overlays}


def _upsert_layer(conn, pid: str, l: LayerIn) -> None:
    owner = conn.execute("SELECT property_id FROM map_layers WHERE id=?", (l.id,)).fetchone()
    if owner and owner["property_id"] != pid:
        raise ValueError("layer belongs to another property")
    conn.execute(
        """INSERT INTO map_layers(id,property_id,key,name,group_name,color,visible,locked,sort_order)
           VALUES (?,?,?,?,?,?,?,?,?)
           ON CONFLICT(id) DO UPDATE SET name=excluded.name, group_name=excluded.group_name,
             color=excluded.color, visible=excluded.visible, locked=excluded.locked,
             sort_order=excluded.sort_order""",
        (l.id, pid, l.key, l.name, l.group, l.color, int(l.visible), int(l.locked), l.order))


def _upsert_object(conn, pid: str, o: ObjectIn) -> None:
    owner = conn.execute("SELECT property_id FROM map_objects WHERE id=?", (o.id,)).fetchone()
    if owner and owner["property_id"] != pid:
        raise ValueError("object belongs to another property")
    layer = conn.execute("SELECT property_id FROM map_layers WHERE id=?", (o.layerId,)).fetchone()
    if not layer or layer["property_id"] != pid:
        raise ValueError(f"unknown layer {o.layerId}")
    t = db.now()
    conn.execute(
        """INSERT INTO map_objects(id,property_id,layer_id,kind,name,geometry,props,rev,created_at,updated_at)
           VALUES (?,?,?,?,?,?,?,1,?,?)
           ON CONFLICT(id) DO UPDATE SET layer_id=excluded.layer_id, kind=excluded.kind, name=excluded.name,
             geometry=excluded.geometry, props=excluded.props, rev=map_objects.rev+1,
             updated_at=excluded.updated_at""",
        (o.id, pid, o.layerId, o.kind, o.name, db.dumps(o.geometry.model_dump()), db.dumps(o.props), t, t))


def apply_changes(conn, pid: str, cs: ChangeSet) -> dict:
    """Atomically apply a batch from the editor's autosave (layers first so objects can reference new ones)."""
    if not get_property(conn, pid):
        raise LookupError("property not found")
    for l in cs.layers:
        _upsert_layer(conn, pid, l)
    for o in cs.objects:
        _upsert_object(conn, pid, o)
    for oid in cs.deleteObjects:
        conn.execute("DELETE FROM map_objects WHERE id=? AND property_id=?", (oid, pid))
    for lid in cs.deleteLayers:
        conn.execute("DELETE FROM map_layers WHERE id=? AND property_id=?", (lid, pid))
    sets: list[str] = ["updated_at=?"]
    args: list[Any] = [db.now()]
    if cs.view:
        sets += ["center_lng=?", "center_lat=?", "zoom=?", "bearing=?", "pitch=?"]
        args += [cs.view.center[0], cs.view.center[1], cs.view.zoom, cs.view.bearing, cs.view.pitch]
    if cs.baseMap:
        sets.append("base_map=?")
        args.append(cs.baseMap)
    if cs.name is not None:
        sets.append("name=?")
        args.append(cs.name)
    if cs.description is not None:
        sets.append("description=?")
        args.append(cs.description)
    conn.execute(f"UPDATE properties SET {', '.join(sets)} WHERE id=?", (*args, pid))
    return {"savedAt": db.now(), "objects": len(cs.objects), "deleted": len(cs.deleteObjects)}
