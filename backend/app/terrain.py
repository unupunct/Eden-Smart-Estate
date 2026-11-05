"""Terrain: ground elevation, slope, aspect and the horizon the surrounding land makes.

Opt-in (like the weather): turning it on lets EDEN ask an elevation service for the ground height around the property. Two sources
are built in and the choice is the user's (Sun & Shadows page):

* "terrarium" (about 30 m): Terrain Tiles on AWS (Terrarium PNG tiles built from Copernicus/EU-DEM, SRTM, 3DEP and other open
  elevation data, finer than 30 m where an open national model exists, e.g. the USA). EDEN downloads the 1-4 map tiles (about 5 km
  across) that cover the property and reads the heights itself (terrarium.py); the request is only a tile number.
* "open-meteo" (90 m): the Open-Meteo elevation service (Copernicus GLO-90, CC BY 4.0). The request contains the property centre
  rounded to 3 decimals (about 100 m) and the grid around it.

There is no free national elevation service with an API that EDEN can use for Romania; where one exists for another country it is one
more entry in PROVIDERS. Either way:

* it shows hills, valleys and the general lie of the land, NOT terraces, ditches or garden-scale mounds (smaller than the resolution);
* it is a surface model, so tall trees and buildings can be present in it at places; vertical error is a few metres;
* the horizon is a single profile seen from the property centre (valid across a normal plot, not across a large estate).

Three sets of points are read in one go: a local grid (5 x 5 points 90 m apart, or 9 x 9 points 30 m apart) for slope and aspect, a
regional grid (15 x 15 points, 300 m apart, about +-2 km) for the height range and the map tint, and 36 rays (one every 10 degrees
of compass, a point every 100 m or 30 m out to 2 km) for the skyline, so a ridge as narrow as the data itself is not skipped over.
The last real answer is kept in the database with its fetch time.
"""
import json
import math
import struct
import zlib
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import config, db, terrarium

router = APIRouter(prefix="/api")

ELEVATION_URL = config.ELEVATION_URL
TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests inject httpx.MockTransport
LOCAL_N, LOCAL_STEP = 5, 90.0
REGION_N, REGION_STEP = 15, 300.0
HORIZON_AZIMUTHS = 36            # every 10 degrees
HORIZON_STEP_M = 100.0           # a point along each ray every 100 m (about the resolution of the data)
HORIZON_REACH_M = 2000.0
EYE_HEIGHT = 1.5                 # metres above the ground at the centre
EARTH_R = 6_371_000.0
REFRACTION = 0.13                # the usual terrestrial refraction share of the curvature drop
BATCH = 100                      # the service takes up to 100 points per request
CACHE_DAYS = 90
PROVIDERS: dict[str, dict[str, Any]] = {
    "open-meteo": {
        "id": "open-meteo", "name": "Open-Meteo elevation (Copernicus GLO-90, 90 m)", "resolutionM": 90, "licence": "CC BY 4.0",
        "attribution": "Contains Copernicus data (DEM GLO-90) served by Open-Meteo.com", "kind": "surface model",
        "localN": LOCAL_N, "localStep": LOCAL_STEP, "rayStep": HORIZON_STEP_M,
        "sends": "the property centre rounded to about 100 m and the grid points around it",
    },
    "terrarium": {
        "id": "terrarium", "name": "Terrain Tiles on AWS (Terrarium, about 30 m)", "resolutionM": 30, "licence": "open data, mixed sources",
        "attribution": "Terrain Tiles (Mapzen/Tilezen on AWS): Copernicus/EU-DEM, SRTM, USGS 3DEP and other open elevation data; "
                       "see github.com/tilezen/joerd/blob/master/docs/attribution.md", "kind": "surface model",
        "localN": 9, "localStep": 30.0, "rayStep": 30.0,
        "sends": "only the numbers of the 1-4 map tiles (about 5 km squares) that cover the property",
    },
}
DEFAULT_PROVIDER = "open-meteo"  # what an existing installation keeps using until the user chooses; the Sun page offers the 30 m source first
SOURCE = PROVIDERS[DEFAULT_PROVIDER]  # kept for older callers and tests


def provider_of(pid: str) -> dict[str, Any]:
    return PROVIDERS.get(pid) or PROVIDERS[DEFAULT_PROVIDER]


# ------------------------------------------------------------------ geometry
def metres_per_degree(lat: float) -> tuple[float, float]:
    """(metres per degree of longitude, per degree of latitude)."""
    return 111_320.0 * math.cos(math.radians(lat)), 110_574.0


def grid_points(lat: float, lng: float, n: int, step: float) -> list[tuple[float, float]]:
    """n x n points (row 0 = north, column 0 = west) centred on lat/lng, `step` metres apart, row-major."""
    mx, my = metres_per_degree(lat)
    half = (n - 1) / 2
    return [(lat + ((half - r) * step) / my, lng + ((c - half) * step) / mx) for r in range(n) for c in range(n)]


def as_grid(values: list[float], n: int) -> list[list[float]]:
    return [values[r * n:(r + 1) * n] for r in range(n)]


def bilinear(z: list[list[float]], step: float, x: float, y: float) -> float | None:
    """Elevation at x metres east, y metres north of the grid centre; None outside the grid."""
    n = len(z)
    half = (n - 1) / 2
    c, r = x / step + half, half - y / step
    if c < 0 or r < 0 or c > n - 1 or r > n - 1:
        return None
    c0, r0 = min(int(c), n - 2), min(int(r), n - 2)
    fc, fr = c - c0, r - r0
    top = z[r0][c0] * (1 - fc) + z[r0][c0 + 1] * fc
    bottom = z[r0 + 1][c0] * (1 - fc) + z[r0 + 1][c0 + 1] * fc
    return top * (1 - fr) + bottom * fr


def slope_aspect(local: list[list[float]], step: float) -> tuple[float, float | None]:
    """Horn's method on the 3 x 3 cells at the centre. Returns (slope degrees, aspect degrees clockwise from north or None if flat).
    The aspect is the direction the ground FACES (downhill): 180 = a south-facing slope."""
    m = len(local) // 2
    a, b, c = local[m - 1][m - 1], local[m - 1][m], local[m - 1][m + 1]
    d, f = local[m][m - 1], local[m][m + 1]
    g, h, i = local[m + 1][m - 1], local[m + 1][m], local[m + 1][m + 1]
    dzdx = ((c + 2 * f + i) - (a + 2 * d + g)) / (8 * step)      # rise per metre going east
    dzdy = ((a + 2 * b + c) - (g + 2 * h + i)) / (8 * step)      # rise per metre going north
    slope = math.degrees(math.atan(math.hypot(dzdx, dzdy)))
    if slope < 0.5:
        return round(slope, 1), None
    return round(slope, 1), round(math.degrees(math.atan2(-dzdx, -dzdy)) % 360, 0)


def ray_distances(step: float = HORIZON_STEP_M) -> list[float]:
    return [step * (j + 1) for j in range(int(HORIZON_REACH_M / step))]


RAY_DISTANCES = ray_distances()


def ray_points(lat: float, lng: float, step: float = HORIZON_STEP_M) -> list[tuple[float, float]]:
    """The points of the skyline rays: for each azimuth, a point every `step` metres out to 2 km (azimuth-major order)."""
    mx, my = metres_per_degree(lat)
    return [(lat + (math.cos(math.radians(k * 360 / HORIZON_AZIMUTHS)) * r) / my, lng + (math.sin(math.radians(k * 360 / HORIZON_AZIMUTHS)) * r) / mx)
            for k in range(HORIZON_AZIMUTHS) for r in ray_distances(step)]


def horizon_profile(z0: float, rays: list[float], step: float = HORIZON_STEP_M) -> list[dict[str, float]]:
    """Highest angle (degrees above the flat horizon) at which land blocks the view, every 10 degrees of compass, from the centre.
    `rays` holds the heights along each ray in the order of ray_points()."""
    dist = ray_distances(step)
    n = len(dist)
    out = []
    for k in range(HORIZON_AZIMUTHS):
        best = 0.0
        for j, r in enumerate(dist):
            drop = (r * r) / (2 * EARTH_R) * (1 - REFRACTION)
            best = max(best, math.degrees(math.atan2(rays[k * n + j] - drop - (z0 + EYE_HEIGHT), r)))
        out.append({"az": k * 360 / HORIZON_AZIMUTHS, "alt": round(best, 2)})
    return out


def compass8(deg: float) -> str:
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][int(((deg % 360) + 22.5) // 45) % 8]


def analyse(lat: float, lng: float, local_flat: list[float], region_flat: list[float], rays: list[float], prov: dict[str, Any] | None = None) -> dict[str, Any]:
    prov = prov or PROVIDERS[DEFAULT_PROVIDER]
    ln, ls = prov["localN"], prov["localStep"]
    local, region = as_grid(local_flat, ln), as_grid(region_flat, REGION_N)
    slope, aspect = slope_aspect(local, ls)
    horizon = horizon_profile(local[ln // 2][ln // 2], rays, prov["rayStep"])
    peak = max(horizon, key=lambda h: h["alt"])
    flat = [v for row in local for v in row]
    return {
        "center": [round(lng, 5), round(lat, 5)],
        "elevation": round(local[ln // 2][ln // 2], 1),
        "slopeDeg": slope, "aspectDeg": aspect, "aspect": compass8(aspect) if aspect is not None else "flat",
        "localRelief": round(max(flat) - min(flat), 1),
        "regionRelief": round(max(region_flat) - min(region_flat), 1),
        "horizon": horizon,
        "horizonMax": {"az": peak["az"], "alt": peak["alt"]},
        "local": {"n": ln, "stepM": ls, "z": local},
        "region": {"n": REGION_N, "stepM": REGION_STEP, "z": region},
        "source": {k: prov[k] for k in ("id", "name", "resolutionM", "licence", "attribution", "kind")},
    }


# ------------------------------------------------------------------ fetching
async def fetch_elevations(points: list[tuple[float, float]]) -> list[float]:
    out: list[float] = []
    async with httpx.AsyncClient(timeout=20, transport=TRANSPORT, headers={"User-Agent": config.USER_AGENT}) as client:
        for i in range(0, len(points), BATCH):
            chunk = points[i:i + BATCH]
            r = await client.get(ELEVATION_URL_NOW(), params={"latitude": ",".join(f"{p[0]:.6f}" for p in chunk), "longitude": ",".join(f"{p[1]:.6f}" for p in chunk)})
            if r.status_code != 200:
                raise httpx.HTTPError(f"HTTP {r.status_code}")
            vals = r.json().get("elevation")
            if not isinstance(vals, list) or len(vals) != len(chunk) or any(not isinstance(v, (int, float)) for v in vals):
                raise httpx.HTTPError("unexpected answer")
            out.extend(float(v) for v in vals)
    return out


def ELEVATION_URL_NOW() -> str:  # read at call time so tests (and the environment) can change it
    return ELEVATION_URL


async def fetch_for(provider_id: str, points: list[tuple[float, float]]) -> list[float]:
    if provider_id == "terrarium":
        return await terrarium.fetch_heights(points, TRANSPORT)
    return await fetch_elevations(points)


def _setting(conn, key: str, default: str = "") -> str:
    r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


def _property(conn, pid: str):
    r = conn.execute("SELECT id, center_lat, center_lng FROM properties WHERE id=?", (pid,)).fetchone()
    if not r:
        raise HTTPException(404, "Property not found.")
    return r


def _cached(conn, pid: str) -> dict | None:
    r = conn.execute("SELECT fetched_at, body FROM terrain_cache WHERE property_id=?", (pid,)).fetchone()
    return {**json.loads(r["body"]), "fetchedAt": r["fetched_at"]} if r else None


class TerrainSettings(BaseModel):
    enabled: bool
    provider: str | None = None


def _provider_id(conn) -> str:
    v = _setting(conn, "terrain_provider", DEFAULT_PROVIDER)
    return v if v in PROVIDERS else DEFAULT_PROVIDER


@router.get("/terrain/settings")
def terrain_settings():
    with db.session() as conn:
        pid = _provider_id(conn)
        return {"enabled": _setting(conn, "terrain_enabled") == "1", "providerId": pid, "provider": PROVIDERS[pid]["name"], "url": ELEVATION_URL_NOW(),
                "providers": [{k: p[k] for k in ("id", "name", "resolutionM", "licence", "sends")} for p in PROVIDERS.values()]}


@router.put("/terrain/settings")
def set_terrain_settings(body: TerrainSettings):
    if body.provider is not None and body.provider not in PROVIDERS:
        raise HTTPException(422, "Unknown elevation source.")
    with db.session() as conn:
        conn.execute("INSERT INTO settings(key,value) VALUES ('terrain_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("1" if body.enabled else "0",))
        if body.provider is not None:
            conn.execute("INSERT INTO settings(key,value) VALUES ('terrain_provider',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (body.provider,))
    return terrain_settings()


@router.get("/properties/{pid}/terrain")
async def get_terrain(pid: str, refresh: bool = False):
    with db.session() as conn:
        prop = _property(conn, pid)
        enabled = _setting(conn, "terrain_enabled") == "1"
        provider = provider_of(_provider_id(conn))
        cached = _cached(conn, pid)
    lat, lng = round(prop["center_lat"], 3), round(prop["center_lng"], 3)
    moved = cached is not None and (abs(cached["center"][1] - lat) > 0.0015 or abs(cached["center"][0] - lng) > 0.0015)
    if moved:
        cached = None  # the property was moved: the old answer is about another place
    same_source = cached is not None and cached.get("source", {}).get("id", "open-meteo") == provider["id"]  # another source chosen: the old answer is not from it
    fresh = cached is not None and same_source and datetime.fromisoformat(cached["fetchedAt"]) > datetime.now(timezone.utc) - timedelta(days=CACHE_DAYS)
    if cached and fresh and not refresh:
        return {"enabled": enabled, "terrain": {**cached, "stale": False}}
    if not enabled:
        return {"enabled": False, "terrain": ({**cached, "stale": True} if cached else None)}
    try:
        ln, ls = provider["localN"], provider["localStep"]
        vals = await fetch_for(provider["id"], grid_points(lat, lng, ln, ls) + grid_points(lat, lng, REGION_N, REGION_STEP) + ray_points(lat, lng, provider["rayStep"]))
    except (httpx.HTTPError, ValueError, KeyError, zlib.error, struct.error) as e:
        if cached:  # keep showing the last real answer, labelled with its age
            return {"enabled": True, "terrain": {**cached, "stale": True}, "error": f"The elevation service could not be reached ({type(e).__name__}); showing the answer from {cached['fetchedAt'][:10]}."}
        raise HTTPException(502, f"The elevation service could not be reached ({type(e).__name__}). Terrain stays unknown until it can be.")
    a, b = ln * ln, ln * ln + REGION_N * REGION_N
    body = analyse(lat, lng, vals[:a], vals[a:b], vals[b:], provider)
    with db.session() as conn:
        conn.execute("INSERT INTO terrain_cache(property_id, fetched_at, body) VALUES (?,?,?) ON CONFLICT(property_id) DO UPDATE SET fetched_at=excluded.fetched_at, body=excluded.body",
                     (pid, db.now(), db.dumps(body)))
        saved = _cached(conn, pid)
    return {"enabled": True, "terrain": {**saved, "stale": False}}


@router.delete("/properties/{pid}/terrain", status_code=204)
def forget_terrain(pid: str):
    with db.session() as conn:
        conn.execute("DELETE FROM terrain_cache WHERE property_id=?", (pid,))
