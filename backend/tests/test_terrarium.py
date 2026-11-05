"""The ~30 m elevation source: the PNG reader, the tile maths and the whole path through the API against fake tiles of a known landscape."""
import asyncio
import math
import struct
import zlib

import httpx
import pytest
from fastapi.testclient import TestClient

from app import config, terrain, terrarium
from app.main import app

LAT, LNG = 45.0, 24.0


def png(rows: list[bytes], filters=(0,), channels=3) -> bytes:
    """A real PNG of the given raw rows, each row stored with the next filter in `filters` (so every filter type is exercised)."""
    stride = len(rows[0])
    out, prev = bytearray(), bytes(stride)
    for y, row in enumerate(rows):
        f = filters[y % len(filters)]
        line = bytearray()
        for i in range(stride):
            a = row[i - channels] if i >= channels else 0
            b = prev[i]
            c = prev[i - channels] if i >= channels else 0
            if f == 0:
                p = 0
            elif f == 1:
                p = a
            elif f == 2:
                p = b
            elif f == 3:
                p = (a + b) // 2
            else:
                pa, pb, pc = abs(b - c), abs(a - c), abs(a + b - 2 * c)
                p = a if pa <= pb and pa <= pc else b if pb <= pc else c
            line.append((row[i] - p) & 255)
        out += bytes([f]) + line
        prev = row

    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    w = stride // channels
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, len(rows), 8, 2 if channels == 3 else 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(bytes(out))) + chunk(b"IEND", b"")


def encode_height(h: float) -> tuple[int, int, int]:
    v = round((h + 32768) * 256)
    return v >> 16 & 255, v >> 8 & 255, v & 255


def tile_png(tx: int, ty: int, fn, z=terrarium.TILE_ZOOM, filters=(0, 1, 2, 3, 4)) -> bytes:
    rows = []
    for py in range(256):
        row = bytearray()
        for px in range(256):
            n = 256 * 2 ** z
            gx, gy = tx * 256 + px + 0.5, ty * 256 + py + 0.5
            lng = gx / n * 360 - 180
            lat = math.degrees(math.atan(math.sinh(math.pi * (1 - 2 * gy / n))))
            row += bytes(encode_height(fn(lat, lng)))
        rows.append(bytes(row))
    return png(rows, filters)


def heights(pts, transport):
    return asyncio.run(terrarium.fetch_heights(pts, transport))


def metres(lat, lng):
    mx, my = terrain.metres_per_degree(LAT)
    return (lng - LNG) * mx, (lat - LAT) * my


# ------------------------------------------------------------------ the PNG reader
@pytest.mark.parametrize("filters", [(0,), (1,), (2,), (3,), (4,), (0, 1, 2, 3, 4)])
@pytest.mark.parametrize("channels", [3, 4])
def test_every_png_filter_decodes_back_to_the_pixels(filters, channels):
    rows = [bytes((x * 7 + y * 13 + c * 29) & 255 for x in range(10) for c in range(channels)) for y in range(9)]
    w, h, got = terrarium.decode_png(png(rows, filters, channels))
    assert (w, h) == (10, 9) and [bytes(r) for r in got] == rows


@pytest.mark.parametrize("bad", [b"", b"not a png at all", b"\x89PNG\r\n\x1a\n"])
def test_garbage_is_rejected(bad):
    with pytest.raises(ValueError):
        terrarium.decode_png(bad)


def test_unsupported_png_kinds_are_rejected():
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    paletted = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 3, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\0\0\0\0\0\0")) + chunk(b"IEND", b"")
    with pytest.raises(ValueError, match="unsupported"):
        terrarium.decode_png(paletted)


def test_a_known_pixel_converts_to_metres():
    assert encode_height(1234.5) == (((1234.5 + 32768) * 256).__int__() >> 16 & 255, ((1234.5 + 32768) * 256).__int__() >> 8 & 255, ((1234.5 + 32768) * 256).__int__() & 255)
    assert terrarium.tile_pixel(0.0, 0.0, 0) == pytest.approx((128.0, 128.0))


# ------------------------------------------------------------------ reading heights from tiles
def test_heights_are_read_between_pixel_centres_and_match_the_landscape():
    fn = lambda lat, lng: 300 + 0.08 * metres(lat, lng)[1]  # noqa: E731  a smooth slope: bilinear reading must reproduce it
    gx, gy = terrarium.tile_pixel(LAT, LNG)

    def handler(request: httpx.Request) -> httpx.Response:
        z, x, y = (int(p) for p in request.url.path.removesuffix(".png").split("/")[-3:])
        return httpx.Response(200, content=tile_png(x, y, fn, z))

    pts = [(LAT, LNG), (LAT + 0.004, LNG - 0.002), (LAT - 0.006, LNG + 0.005)]
    got = heights(pts, httpx.MockTransport(handler))
    for (la, ln), g in zip(pts, got):
        assert g == pytest.approx(fn(la, ln), abs=0.1)
    assert gx > 0 and gy > 0


def test_a_missing_tile_is_an_error_not_a_zero():
    with pytest.raises(httpx.HTTPError):
        heights([(LAT, LNG)], httpx.MockTransport(lambda r: httpx.Response(404)))


def test_a_wrongly_sized_tile_is_rejected():
    small = png([bytes(3 * 4)] * 4)
    with pytest.raises(ValueError, match="size"):
        heights([(LAT, LNG)], httpx.MockTransport(lambda r: httpx.Response(200, content=small)))


def test_an_area_spanning_too_many_tiles_is_refused():
    with pytest.raises(ValueError, match="too many"):
        heights([(LAT + i * 0.2, LNG + j * 0.3) for i in range(5) for j in range(5)], httpx.MockTransport(lambda r: httpx.Response(404)))


# ------------------------------------------------------------------ through the API
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


def serve_tiles(monkeypatch, fn):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        z, x, y = (int(p) for p in request.url.path.removesuffix(".png").split("/")[-3:])
        seen.append((z, x, y))
        return httpx.Response(200, content=tile_png(x, y, fn, z, filters=(1,)))
    monkeypatch.setattr(terrain, "TRANSPORT", httpx.MockTransport(handler))
    return seen


def test_the_30_m_source_gives_a_finer_grid_and_the_right_slope(env, monkeypatch):
    c, pid = env
    seen = serve_tiles(monkeypatch, lambda lat, lng: 200 + 0.1 * metres(lat, lng)[1])
    s = c.put("/api/terrain/settings", json={"enabled": True, "provider": "terrarium"}).json()
    assert s["providerId"] == "terrarium" and {p["id"] for p in s["providers"]} == {"open-meteo", "terrarium"}
    t = c.get(f"/api/properties/{pid}/terrain").json()["terrain"]
    assert t["local"]["n"] == 9 and t["local"]["stepM"] == 30 and t["region"]["n"] == 15
    assert t["source"]["id"] == "terrarium" and t["source"]["resolutionM"] == 30
    assert t["slopeDeg"] == pytest.approx(math.degrees(math.atan(0.1)), abs=0.3) and t["aspect"] == "S"
    assert t["elevation"] == pytest.approx(200, abs=0.5)
    assert 1 <= len({(x, y) for _, x, y in seen}) <= 4 and all(z == 12 for z, _, _ in seen)  # one to four tiles, at zoom 12


def test_only_tile_numbers_leave_the_computer_with_the_30_m_source(env, monkeypatch):
    c, pid = env
    urls = []

    def handler(request: httpx.Request) -> httpx.Response:
        urls.append(str(request.url))
        z, x, y = (int(p) for p in request.url.path.removesuffix(".png").split("/")[-3:])
        return httpx.Response(200, content=tile_png(x, y, lambda *_: 100.0, z))
    monkeypatch.setattr(terrain, "TRANSPORT", httpx.MockTransport(handler))
    c.put("/api/terrain/settings", json={"enabled": True, "provider": "terrarium"})
    c.get(f"/api/properties/{pid}/terrain")
    assert urls and all("?" not in u and u.endswith(".png") and f"/terrarium/{terrarium.TILE_ZOOM}/" in u for u in urls)


def test_switching_source_throws_away_the_old_answer_and_asks_again(env, monkeypatch):
    c, pid = env
    monkeypatch.setattr(terrain, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200, json={"elevation": [100.0] * len(r.url.params["latitude"].split(","))})))
    c.put("/api/terrain/settings", json={"enabled": True, "provider": "open-meteo"})
    assert c.get(f"/api/properties/{pid}/terrain").json()["terrain"]["source"]["id"] == "open-meteo"
    serve_tiles(monkeypatch, lambda *_: 100.0)
    c.put("/api/terrain/settings", json={"enabled": True, "provider": "terrarium"})
    assert c.get(f"/api/properties/{pid}/terrain").json()["terrain"]["source"]["id"] == "terrarium"


def test_the_service_down_keeps_the_last_answer_with_the_30_m_source_too(env, monkeypatch):
    c, pid = env
    serve_tiles(monkeypatch, lambda *_: 100.0)
    c.put("/api/terrain/settings", json={"enabled": True, "provider": "terrarium"})
    first = c.get(f"/api/properties/{pid}/terrain").json()["terrain"]
    monkeypatch.setattr(terrain, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(503)))
    r = c.get(f"/api/properties/{pid}/terrain", params={"refresh": "true"}).json()
    assert r["terrain"]["stale"] is True and r["terrain"]["fetchedAt"] == first["fetchedAt"] and "could not be reached" in r["error"]


def test_a_corrupt_tile_gives_a_clear_error_not_a_crash(env, monkeypatch):
    c, pid = env
    monkeypatch.setattr(terrain, "TRANSPORT", httpx.MockTransport(lambda r: httpx.Response(200, content=b"<html>captive portal</html>")))
    c.put("/api/terrain/settings", json={"enabled": True, "provider": "terrarium"})
    assert c.get(f"/api/properties/{pid}/terrain").status_code == 502


def test_an_unknown_source_is_refused(env):
    c, _ = env
    assert c.put("/api/terrain/settings", json={"enabled": True, "provider": "nope"}).status_code == 422
    assert c.get("/api/terrain/settings").json()["providerId"] == "open-meteo"  # untouched installations keep what they had
