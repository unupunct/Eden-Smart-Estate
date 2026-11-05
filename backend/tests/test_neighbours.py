"""Neighbouring buildings from OpenStreetMap: parsing, height estimates (always labelled) and what is sent."""
import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, neighbours
from app.main import app

LAT, LNG = 45.0, 24.0


def way(osm_id, tags, east=40.0, north=10.0, w=10.0, d=8.0, closed=True):
    """A rectangular building outline `east`/`north` metres from the property centre, as Overpass `out geom` returns it."""
    mx, my = 111_320.0 * 0.7071067811865476, 110_574.0
    pts = [(east, north), (east + w, north), (east + w, north + d), (east, north + d)]
    geom = [{"lat": LAT + y / my, "lon": LNG + x / mx} for x, y in pts]
    if closed:
        geom.append(dict(geom[0]))
    return {"type": "way", "id": osm_id, "tags": tags, "geometry": geom}


@pytest.mark.parametrize("tags,expected", [
    ({"building": "house", "height": "9.5"}, (9.5, "tag")),
    ({"building": "house", "height": "12 m"}, (12.0, "tag")),
    ({"building": "house", "height": "7,5"}, (7.5, "tag")),
    ({"building": "house", "building:levels": "2"}, (6.0, "floors")),
    ({"building": "house", "building:levels": "2", "roof:shape": "gabled"}, (7.5, "floors")),
    ({"building": "house", "building:levels": "2", "roof:height": "2.4"}, (8.4, "floors")),
    ({"building": "garage"}, (3.0, "assumed")),
    ({"building": "yes"}, (6.0, "assumed")),
    ({"building": "house", "height": "tall"}, (6.5, "assumed")),          # not a number: ignored, not guessed from
    ({"building": "house", "height": "-4"}, (6.5, "assumed")),
    ({"building": "house", "height": "900"}, (6.5, "assumed")),           # an obvious typo is not believed
])
def test_height_is_taken_from_the_data_then_estimated_and_always_labelled(tags, expected):
    assert neighbours.estimate_height(tags) == expected


def test_roof_shapes_map_to_the_ones_the_shadow_model_knows():
    assert neighbours.roof_of({"roof:shape": "gabled"}, 8) == ("gable", None)
    assert neighbours.roof_of({"roof:shape": "hipped", "roof:height": "2"}, 8) == ("hip", 6.0)
    assert neighbours.roof_of({"roof:shape": "gambrel"}, 8)[0] == "mansard"
    assert neighbours.roof_of({"roof:shape": "skillion"}, 8) == ("flat", None)     # direction unknown: stays a box (safe overestimate)
    assert neighbours.roof_of({}, 8) == ("flat", None)


def test_parsing_keeps_real_outlines_and_drops_junk():
    data = {"elements": [
        way(1, {"building": "house", "height": "8", "name": "Casa Popescu"}),
        way(2, {"building": "yes"}, east=-30, north=-30),
        way(3, {"building": "no"}),                                           # explicitly not a building
        way(4, {"building": "shed"}, w=1.5, d=1.5),                           # smaller than 6 m2
        way(5, {"building": "yes"}, east=900),                                # far outside the radius
        {"type": "node", "id": 6, "tags": {"building": "yes"}},               # not a way
        {"type": "way", "id": 7, "tags": {"building": "yes"}, "geometry": [{"lat": 1, "lon": 1}, {"lat": 1, "lon": 2}]},  # not an area
        {"type": "way", "id": 8, "tags": {"highway": "path"}, "geometry": []},
    ]}
    out = neighbours.parse_elements(data, LAT, LNG, 150)
    assert [b["osmId"] for b in out] == [2, 1] or [b["osmId"] for b in out] == [1, 2]
    b = {x["osmId"]: x for x in out}
    assert b[1]["name"] == "Casa Popescu" and b[1]["height"] == 8 and b[1]["heightBasis"] == "tag"
    assert b[1]["areaM2"] == pytest.approx(80, abs=1) and b[1]["ring"][0] == b[1]["ring"][-1] and len(b[1]["ring"]) == 5
    assert out == sorted(out, key=lambda x: x["distanceM"])                   # nearest first


# ------------------------------------------------------------------ the API
@pytest.fixture()
def env(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_DIR", tmp_path)
    monkeypatch.setattr(config, "DB_PATH", tmp_path / "eden.db")
    monkeypatch.setattr(config, "UPLOAD_DIR", tmp_path / "uploads")
    monkeypatch.setattr(config, "BACKUP_DIR", tmp_path / "backups")
    monkeypatch.setattr(config, "POLL_SECONDS", 0)
    monkeypatch.setattr(config, "PASSWORD", "")
    with TestClient(app) as c:
        pid = c.post("/api/properties", json={"name": "Home", "center": [LNG, LAT]}).json()["id"]
        yield c, pid


def fake_overpass(monkeypatch, elements, status=200):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(status, json={"elements": elements})
    monkeypatch.setattr(neighbours, "TRANSPORT", httpx.MockTransport(handler))
    return seen


def test_search_sends_only_the_rounded_centre_and_a_radius(env, monkeypatch):
    c, pid = env
    seen = fake_overpass(monkeypatch, [way(1, {"building": "house", "height": "8"})])
    r = c.post(f"/api/properties/{pid}/neighbours/search", json={"radiusM": 120}).json()
    assert len(seen) == 1 and seen[0].method == "POST"
    body = seen[0].content.decode()
    assert "around%3A120%2C45.000%2C24.000" in body and "way%5B%22building%22%5D" in body
    assert "Home" not in body and pid not in body                              # nothing about the property but where it is
    assert r["radiusM"] == 120 and r["source"]["licence"] == "ODbL 1.0" and "OpenStreetMap" in r["source"]["attribution"]
    assert "100 m" in r["sent"] and r["buildings"][0]["osmId"] == 1


def test_nothing_is_stored(env, monkeypatch):
    c, pid = env
    fake_overpass(monkeypatch, [way(1, {"building": "house"})])
    before = c.get(f"/api/properties/{pid}").json()
    c.post(f"/api/properties/{pid}/neighbours/search")
    assert c.get(f"/api/properties/{pid}").json()["objects"] == before["objects"]


@pytest.mark.parametrize("radius", [5, 1000])
def test_the_radius_is_bounded(env, monkeypatch, radius):
    c, pid = env
    fake_overpass(monkeypatch, [])
    assert c.post(f"/api/properties/{pid}/neighbours/search", json={"radiusM": radius}).status_code == 422


def test_a_service_error_adds_nothing_and_says_so(env, monkeypatch):
    c, pid = env
    fake_overpass(monkeypatch, [], status=429)
    r = c.post(f"/api/properties/{pid}/neighbours/search")
    assert r.status_code == 502 and "Nothing was added" in r.json()["detail"]


def test_a_garbled_answer_is_rejected(env, monkeypatch):
    c, pid = env
    monkeypatch.setattr(neighbours, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200, text="<html>busy</html>")))
    assert c.post(f"/api/properties/{pid}/neighbours/search").status_code == 502
    monkeypatch.setattr(neighbours, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200, json={"remark": "runtime error"})))
    assert c.post(f"/api/properties/{pid}/neighbours/search").status_code == 502


def test_unknown_property_is_404(env):
    c, _ = env
    assert c.post("/api/properties/nope/neighbours/search").status_code == 404


def test_a_busy_server_is_skipped_for_the_next_one(env, monkeypatch):
    c, pid = env
    hosts = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        return httpx.Response(504) if len(hosts) == 1 else httpx.Response(200, json={"elements": [way(1, {"building": "house"})]})
    monkeypatch.setattr(neighbours, "TRANSPORT", httpx.MockTransport(handler))
    r = c.post(f"/api/properties/{pid}/neighbours/search").json()
    assert len(hosts) == 2 and hosts[0] != hosts[1] and r["buildings"][0]["osmId"] == 1


def test_your_own_server_is_used_alone_when_configured(env, monkeypatch):
    c, pid = env
    monkeypatch.setattr(config, "OVERPASS_URL", "http://overpass.local/api/interpreter")
    hosts = []

    def handler(request: httpx.Request) -> httpx.Response:
        hosts.append(request.url.host)
        return httpx.Response(503)
    monkeypatch.setattr(neighbours, "TRANSPORT", httpx.MockTransport(handler))
    assert c.post(f"/api/properties/{pid}/neighbours/search").status_code == 502 and hosts == ["overpass.local"]
