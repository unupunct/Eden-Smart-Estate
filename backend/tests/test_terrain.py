"""Terrain: slope, aspect, horizon (against known synthetic landscapes) and the opt-in elevation fetch."""
import math

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, terrain
from app.main import app

LAT, LNG = 45.0, 24.0


def metres(lat, lng, lat0=LAT, lng0=LNG):
    mx, my = terrain.metres_per_degree(lat0)
    return (lng - lng0) * mx, (lat - lat0) * my  # east, north


def landscape(fn):
    """A fake elevation service over a synthetic landscape fn(east_m, north_m) -> height."""
    calls = []

    def handler(request: httpx.Request) -> httpx.Response:
        lats = [float(x) for x in request.url.params["latitude"].split(",")]
        lngs = [float(x) for x in request.url.params["longitude"].split(",")]
        calls.append(list(zip(lats, lngs)))
        return httpx.Response(200, json={"elevation": [fn(*metres(la, ln)) for la, ln in zip(lats, lngs)]})

    handler.calls = calls
    return handler


def analyse_landscape(fn):
    pts_l = terrain.grid_points(LAT, LNG, terrain.LOCAL_N, terrain.LOCAL_STEP)
    pts_r = terrain.grid_points(LAT, LNG, terrain.REGION_N, terrain.REGION_STEP)
    z = lambda pts: [fn(*metres(la, ln)) for la, ln in pts]  # noqa: E731
    return terrain.analyse(LAT, LNG, z(pts_l), z(pts_r), z(terrain.ray_points(LAT, LNG)))


# ------------------------------------------------------------------ the maths
def test_grid_geometry_is_centred_north_up_and_evenly_spaced():
    pts = terrain.grid_points(LAT, LNG, 5, 90)
    assert len(pts) == 25 and pts[12] == pytest.approx((LAT, LNG))
    assert pts[0][0] > pts[20][0] and pts[0][1] < pts[4][1]  # row 0 is north, column 0 is west
    e, n = metres(*pts[24])
    assert e == pytest.approx(180, abs=0.5) and n == pytest.approx(-180, abs=0.5)


def test_a_slope_rising_to_the_north_faces_south():
    r = analyse_landscape(lambda e, n: 100 + 0.1 * n)
    assert r["slopeDeg"] == pytest.approx(math.degrees(math.atan(0.1)), abs=0.1)
    assert r["aspectDeg"] == 180 and r["aspect"] == "S"
    assert r["elevation"] == pytest.approx(100, abs=0.2)


@pytest.mark.parametrize("fn,deg,name", [
    (lambda e, n: 100 - 0.08 * n, 0, "N"),      # falling to the north: faces north
    (lambda e, n: 100 + 0.08 * e, 270, "W"),    # rising to the east: faces west
    (lambda e, n: 100 - 0.08 * e, 90, "E"),
    (lambda e, n: 100 + 0.05 * (n - e), 135, "SE"),   # rising to the north-west faces south-east
    (lambda e, n: 100 + 0.05 * (e + n), 225, "SW"),   # rising to the north-east faces south-west
])
def test_aspect_in_every_direction(fn, deg, name):
    r = analyse_landscape(fn)
    assert r["aspectDeg"] == deg and r["aspect"] == name


def test_flat_ground_has_no_aspect_and_no_horizon():
    r = analyse_landscape(lambda e, n: 250.0)
    assert r["slopeDeg"] == 0 and r["aspectDeg"] is None and r["aspect"] == "flat"
    assert r["localRelief"] == 0 and r["horizonMax"]["alt"] == 0
    assert all(h["alt"] == 0 for h in r["horizon"])


def test_a_ridge_as_narrow_as_the_data_is_not_skipped_over():
    ridge = lambda e, n: 100 + (60 if 780 <= e <= 880 else 0)  # noqa: E731  one 100 m wide ridge, narrower than the 300 m regional grid
    r = analyse_landscape(ridge)
    h = {x["az"]: x["alt"] for x in r["horizon"]}
    assert h[90] == pytest.approx(math.degrees(math.atan2(60 - 1.5, 800)), abs=0.3)


def test_a_hill_to_the_east_raises_the_horizon_in_that_direction_only():
    hill = lambda e, n: 100 + (40 if 550 <= e <= 650 and abs(n) <= 700 else 0)  # noqa: E731
    r = analyse_landscape(hill)
    h = {x["az"]: x["alt"] for x in r["horizon"]}
    assert h[90] == pytest.approx(math.degrees(math.atan((40 - 1.5) / 600)), abs=1.2)  # the edge of the hill is 550-600 m away
    assert h[270] == 0 and h[180] == 0 and h[0] == 0
    assert 60 <= r["horizonMax"]["az"] <= 120


def test_earth_curvature_is_taken_off_distant_land():
    # a 20 m step 1.7 km away: the angle on a flat earth would be slightly larger than the one EDEN reports
    r = analyse_landscape(lambda e, n: 120 if e > 1650 else 100)
    flat_angle = math.degrees(math.atan2(120 - 101.5, 1700))
    drop = 1700 ** 2 / (2 * terrain.EARTH_R) * (1 - terrain.REFRACTION)
    assert r["horizon"][9]["alt"] == pytest.approx(math.degrees(math.atan2(120 - drop - 101.5, 1700)), abs=0.01)
    assert r["horizon"][9]["alt"] < flat_angle


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


def serve(monkeypatch, fn):
    h = landscape(fn)
    monkeypatch.setattr(terrain, "TRANSPORT", httpx.MockTransport(h))
    return h


def test_terrain_is_off_until_switched_on_and_nothing_is_requested(env, monkeypatch):
    c, pid = env
    h = serve(monkeypatch, lambda e, n: 100)
    assert c.get("/api/terrain/settings").json()["enabled"] is False
    r = c.get(f"/api/properties/{pid}/terrain").json()
    assert r == {"enabled": False, "terrain": None} and h.calls == []


def test_turning_it_on_fetches_once_and_then_serves_the_stored_answer(env, monkeypatch):
    c, pid = env
    h = serve(monkeypatch, lambda e, n: 100 + 0.1 * n)
    c.put("/api/terrain/settings", json={"enabled": True})
    r = c.get(f"/api/properties/{pid}/terrain").json()
    t = r["terrain"]
    assert t["aspect"] == "S" and t["stale"] is False and t["source"]["licence"] == "CC BY 4.0" and t["fetchedAt"]
    n = 25 + 225 + 36 * 20
    assert len(h.calls) == -(-n // 100) and all(len(chunk) <= 100 for chunk in h.calls) and sum(len(x) for x in h.calls) == n
    c.get(f"/api/properties/{pid}/terrain")
    calls = len(h.calls)
    c.get(f"/api/properties/{pid}/terrain")
    assert len(h.calls) == calls                   # served from storage, no second request
    c.get(f"/api/properties/{pid}/terrain", params={"refresh": "true"})
    assert len(h.calls) == 2 * calls               # refreshed on request


def test_only_the_rounded_property_centre_ever_leaves_the_computer(env, monkeypatch):
    c, pid = env
    h = serve(monkeypatch, lambda e, n: 100)
    c.put("/api/terrain/settings", json={"enabled": True})
    c.get(f"/api/properties/{pid}/terrain")
    centre = h.calls[0][12]  # the middle of the local grid
    assert centre == (LAT, LNG)  # 45.000 / 24.000 are already at 3 decimals
    for lat, lng in [p for chunk in h.calls for p in chunk]:
        assert abs(lat - LAT) < 0.02 and abs(lng - LNG) < 0.03  # nothing but points around the property


def test_when_the_service_is_down_the_last_real_answer_is_kept_and_labelled(env, monkeypatch):
    c, pid = env
    serve(monkeypatch, lambda e, n: 100 + 0.1 * n)
    c.put("/api/terrain/settings", json={"enabled": True})
    first = c.get(f"/api/properties/{pid}/terrain").json()["terrain"]

    def down(request):
        raise httpx.ConnectError("offline")
    monkeypatch.setattr(terrain, "TRANSPORT", httpx.MockTransport(down))
    r = c.get(f"/api/properties/{pid}/terrain", params={"refresh": "true"}).json()
    assert r["terrain"]["stale"] is True and r["terrain"]["fetchedAt"] == first["fetchedAt"] and "could not be reached" in r["error"]


def test_with_no_answer_ever_the_terrain_stays_unknown(env, monkeypatch):
    c, pid = env
    monkeypatch.setattr(terrain, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(500)))
    c.put("/api/terrain/settings", json={"enabled": True})
    r = c.get(f"/api/properties/{pid}/terrain")
    assert r.status_code == 502 and "unknown" in r.json()["detail"]


def test_a_garbled_answer_is_rejected_not_used(env, monkeypatch):
    c, pid = env
    monkeypatch.setattr(terrain, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200, json={"elevation": [1, 2, 3]})))
    c.put("/api/terrain/settings", json={"enabled": True})
    assert c.get(f"/api/properties/{pid}/terrain").status_code == 502


def test_switching_off_keeps_the_stored_answer_but_stops_asking(env, monkeypatch):
    c, pid = env
    h = serve(monkeypatch, lambda e, n: 100)
    c.put("/api/terrain/settings", json={"enabled": True})
    c.get(f"/api/properties/{pid}/terrain")
    c.put("/api/terrain/settings", json={"enabled": False})
    r = c.get(f"/api/properties/{pid}/terrain", params={"refresh": "true"}).json()
    assert r["enabled"] is False and r["terrain"]["elevation"] == 100 and len(h.calls) == -(-(25 + 225 + 720) // 100)
    assert c.delete(f"/api/properties/{pid}/terrain").status_code == 204
    assert c.get(f"/api/properties/{pid}/terrain").json()["terrain"] is None


def test_unknown_property_is_404(env):
    c, _ = env
    assert c.get("/api/properties/nope/terrain").status_code == 404
