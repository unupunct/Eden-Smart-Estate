import io
import json
import zipfile

import pytest
from fastapi.testclient import TestClient

SQUARE = {"type": "Polygon", "coordinates": [[[24.0, 45.0], [24.001, 45.0], [24.001, 45.001], [24.0, 45.001], [24.0, 45.0]]]}


@pytest.fixture()
def client(tmp_path, monkeypatch):
    from app import config
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    from app.main import app
    with TestClient(app) as c:
        yield c


def make_property(client):
    r = client.post("/api/properties", json={"name": "Test", "center": [24.0, 45.0]})
    assert r.status_code == 201
    pid = r.json()["id"]
    model = client.get(f"/api/properties/{pid}").json()
    return pid, {l["key"]: l["id"] for l in model["layers"]}


def obj(layer_id, kind="zone", geom=SQUARE, oid="o1", **props):
    return {"id": oid, "layerId": layer_id, "kind": kind, "name": "Thing", "geometry": geom, "props": props}


def test_new_property_has_default_layers(client):
    pid, layers = make_property(client)
    assert {"boundary", "buildings", "fences", "trees", "pond", "notes"} <= set(layers)


def test_changes_roundtrip_and_rev(client):
    pid, layers = make_property(client)
    r = client.post(f"/api/properties/{pid}/changes", json={"objects": [obj(layers["zones"], description="hi")]})
    assert r.status_code == 200
    m = client.get(f"/api/properties/{pid}").json()
    assert m["objects"][0]["props"]["description"] == "hi" and m["objects"][0]["rev"] == 1
    client.post(f"/api/properties/{pid}/changes", json={"objects": [obj(layers["zones"], description="v2")]})
    m = client.get(f"/api/properties/{pid}").json()
    assert m["objects"][0]["rev"] == 2 and m["objects"][0]["props"]["description"] == "v2"
    client.post(f"/api/properties/{pid}/changes", json={"deleteObjects": ["o1"]})
    assert client.get(f"/api/properties/{pid}").json()["objects"] == []


def test_view_and_layer_edits_persist(client):
    pid, layers = make_property(client)
    m = client.get(f"/api/properties/{pid}").json()
    layer = {**m["layers"][0], "visible": False, "locked": True, "name": "Renamed"}
    client.post(f"/api/properties/{pid}/changes",
                json={"layers": [layer], "view": {"center": [25, 46], "zoom": 18.5}, "baseMap": "hybrid"})
    m = client.get(f"/api/properties/{pid}").json()
    assert m["layers"][0]["name"] == "Renamed" and m["layers"][0]["locked"] and not m["layers"][0]["visible"]
    assert m["property"]["center"] == [25, 46] and m["property"]["baseMap"] == "hybrid"


@pytest.mark.parametrize("geom", [
    {"type": "Point", "coordinates": [200, 10]},
    {"type": "Point", "coordinates": ["a", 1]},
    {"type": "LineString", "coordinates": [[1, 1]]},
    {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 1]]]},
])
def test_invalid_geometry_rejected(client, geom):
    pid, layers = make_property(client)
    r = client.post(f"/api/properties/{pid}/changes", json={"objects": [obj(layers["zones"], geom=geom)]})
    assert r.status_code == 422


def test_cross_property_layer_rejected(client):
    pid, layers = make_property(client)
    _, other_layers = make_property(client)
    r = client.post(f"/api/properties/{pid}/changes", json={"objects": [obj(other_layers["zones"])]})
    assert r.status_code == 422


def test_demo_create_once_and_delete(client):
    r = client.post("/api/demo")
    assert r.status_code == 201 and r.json()["isDemo"]
    assert client.post("/api/demo").status_code == 409
    pid = r.json()["id"]
    m = client.get(f"/api/properties/{pid}").json()
    kinds = {o["kind"] for o in m["objects"]}
    assert {"boundary", "building", "greenhouse", "tree", "pond", "fence", "camera", "outlet"} <= kinds
    assert client.delete(f"/api/properties/{pid}").status_code == 204
    assert client.get("/api/properties").json() == []


def test_exports_and_geojson_import(client):
    pid, layers = make_property(client)
    client.post(f"/api/properties/{pid}/changes", json={"objects": [
        obj(layers["buildings"], "building", SQUARE, "b1", floors=2),
        obj(layers["fences"], "fence", {"type": "LineString", "coordinates": [[24, 45], [24.001, 45]]}, "f1"),
        obj(layers["trees"], "tree", {"type": "Point", "coordinates": [24.0005, 45.0005]}, "t1"),
    ]})
    gj = client.get(f"/api/properties/{pid}/export.geojson").json()
    assert len(gj["features"]) == 3
    area = next(f for f in gj["features"] if f["id"] == "b1")["properties"]["area_m2"]
    assert 8700 < area < 8800  # 0.001 deg square at 45N is ~78.6 m x 111.2 m
    assert "area_m2" in client.get(f"/api/properties/{pid}/export.csv").text
    assert "<Placemark>" in client.get(f"/api/properties/{pid}/export.kml").text

    pid2, _ = make_property(client)
    r = client.post(f"/api/properties/{pid2}/import", files={"file": ("x.geojson", json.dumps(gj), "application/json")})
    assert r.json()["imported"] == 3
    kinds = sorted(o["kind"] for o in client.get(f"/api/properties/{pid2}").json()["objects"])
    assert kinds == ["building", "fence", "tree"]


def test_kml_roundtrip(client):
    pid, layers = make_property(client)
    client.post(f"/api/properties/{pid}/changes", json={"objects": [obj(layers["buildings"], "building", SQUARE, "b1")]})
    kml = client.get(f"/api/properties/{pid}/export.kml").text
    pid2, _ = make_property(client)
    r = client.post(f"/api/properties/{pid2}/import", files={"file": ("x.kml", kml, "application/xml")})
    assert r.json()["imported"] == 1
    o = client.get(f"/api/properties/{pid2}").json()["objects"][0]
    assert o["kind"] == "building" and o["geometry"]["type"] == "Polygon"


def test_project_json_export_import(client):
    r = client.post("/api/demo")
    pid = r.json()["id"]
    exported = client.get(f"/api/properties/{pid}/export.json").content
    r = client.post("/api/import-project", files={"file": ("p.json", exported, "application/json")})
    assert r.status_code == 201
    a = client.get(f"/api/properties/{pid}").json()["objects"]
    b = client.get(f"/api/properties/{r.json()['id']}").json()["objects"]
    assert len(a) == len(b) and {o["id"] for o in a}.isdisjoint({o["id"] for o in b})


PNG = (b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89"
       b"\x00\x00\x00\rIDATx\x9cc\xf8\xff\xff?\x00\x05\xfe\x02\xfe\xa7\x9a\xa0\xa0\x00\x00\x00\x00IEND\xaeB`\x82")
CORNERS = [[24.0, 45.001], [24.001, 45.001], [24.001, 45.0], [24.0, 45.0]]


def test_overlay_upload_patch_delete(client):
    pid, _ = make_property(client)
    r = client.post(f"/api/properties/{pid}/overlays", files={"file": ("a.png", PNG, "image/png")},
                    data={"corners": json.dumps(CORNERS), "name": "Aerial"})
    assert r.status_code == 201
    oid = r.json()["id"]
    assert client.get(f"/api/overlays/{oid}/image").content == PNG
    assert client.patch(f"/api/overlays/{oid}", json={"opacity": 0.4}).json()["opacity"] == 0.4
    assert len(client.get(f"/api/properties/{pid}").json()["overlays"]) == 1
    assert client.delete(f"/api/overlays/{oid}").status_code == 204
    assert client.get(f"/api/overlays/{oid}/image").status_code == 404


def test_overlay_rejects_non_image_and_bad_corners(client):
    pid, _ = make_property(client)
    r = client.post(f"/api/properties/{pid}/overlays", files={"file": ("a.exe", b"MZ", "application/octet-stream")},
                    data={"corners": json.dumps(CORNERS)})
    assert r.status_code == 415
    r = client.post(f"/api/properties/{pid}/overlays", files={"file": ("a.png", PNG, "image/png")},
                    data={"corners": json.dumps(CORNERS[:3])})
    assert r.status_code == 422


def test_backup_and_restore(client):
    pid, layers = make_property(client)
    client.post(f"/api/properties/{pid}/changes", json={"objects": [obj(layers["zones"])]})
    client.post(f"/api/properties/{pid}/overlays", files={"file": ("a.png", PNG, "image/png")},
                data={"corners": json.dumps(CORNERS)})
    blob = client.get("/api/backup").content
    assert "eden.db" in zipfile.ZipFile(io.BytesIO(blob)).namelist()
    client.delete(f"/api/properties/{pid}")
    assert client.get("/api/properties").json() == []
    r = client.post("/api/restore", files={"file": ("b.zip", blob, "application/zip")})
    assert r.status_code == 200
    m = client.get(f"/api/properties/{pid}").json()
    assert len(m["objects"]) == 1 and len(m["overlays"]) == 1
    assert client.get(m["overlays"][0]["url"]).content == PNG


def test_restore_rejects_garbage(client):
    assert client.post("/api/restore", files={"file": ("b.zip", b"nope", "application/zip")}).status_code == 422


def test_settings_never_leak_keys(client):
    r = client.put("/api/settings", json={"maptilerKey": "SECRET123", "satelliteProvider": "maptiler-satellite"})
    assert "SECRET123" not in r.text and r.json()["hasMaptilerKey"]
    cat = client.get("/api/map-providers")
    assert "SECRET123" not in cat.text
    assert cat.json()["satellite"] == "maptiler-satellite"
    assert cat.json()["providers"]["maptiler-satellite"]["tiles"].startswith("/api/tiles/")
    client.put("/api/settings", json={"maptilerKey": ""})
    assert client.get("/api/map-providers").json()["satellite"] == "esri-imagery"  # falls back without a key


def test_settings_validation(client):
    assert client.put("/api/settings", json={"satelliteProvider": "nope"}).status_code == 422
    assert client.put("/api/settings", json={"customTilesUrl": "ftp://x/{z}/{x}/{y}"}).status_code == 422
    assert client.put("/api/settings", json={"customTilesUrl": "https://x/tiles"}).status_code == 422


def test_migrations_idempotent(client):
    from app import db
    assert db.migrate() == []


def test_esri_native_zoom_is_configurable(client):
    cat = client.get("/api/map-providers").json()
    assert cat["providers"]["esri-imagery"]["maxzoom"] == 17
    client.put("/api/settings", json={"esriMaxZoom": 19})
    assert client.get("/api/map-providers").json()["providers"]["esri-imagery"]["maxzoom"] == 19
    assert client.put("/api/settings", json={"esriMaxZoom": 25}).status_code == 422
