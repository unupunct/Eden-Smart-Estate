"""Terrain: ground elevation, slope, aspect and the horizon the surrounding land makes.

Opt-in (like the weather): turning it on lets EDEN ask the Open-Meteo elevation service for the ground height at a grid of points
around the property. That request contains those coordinates (the property centre rounded to 3 decimals, about 100 m) and
nothing else. The service serves the Copernicus GLO-90 digital surface model (CC BY 4.0, 90 m resolution), so:

* it shows hills, valleys and the general lie of the land, NOT terraces, ditches or garden-scale mounds (smaller than ~90 m);
* it is a surface model, so tall trees and buildings can be present in it at places; vertical error is a few metres;
* the horizon is a single profile seen from the property centre (valid across a normal plot, not across a large estate).

Three sets of points are fetched in one go: a local grid (5 x 5 points, 90 m apart) for slope and aspect, a regional grid
(15 x 15 points, 300 m apart, about +-2 km) for the height range and the map tint, and 36 rays (one every 10 degrees of compass,
a point every 100 m out to 2 km) for the skyline, so a ridge as narrow as the data itself is not skipped over.
The last real answer is kept in the database with its fetch time.
"""
import json
import math
from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from . import config, db

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
SOURCE = {"name": "Copernicus DEM GLO-90 via Open-Meteo", "resolutionM": 90, "licence": "CC BY 4.0",
          "attribution": "Contains Copernicus data (DEM GLO-90) served by Open-Meteo.com", "kind": "surface model"}


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


RAY_DISTANCES = [HORIZON_STEP_M * (j + 1) for j in range(int(HORIZON_REACH_M / HORIZON_STEP_M))]


def ray_points(lat: float, lng: float) -> list[tuple[float, float]]:
    """The points of the skyline rays: for each azimuth, a point every 100 m out to 2 km (azimuth-major order)."""
    mx, my = metres_per_degree(lat)
    return [(lat + (math.cos(math.radians(k * 360 / HORIZON_AZIMUTHS)) * r) / my, lng + (math.sin(math.radians(k * 360 / HORIZON_AZIMUTHS)) * r) / mx)
            for k in range(HORIZON_AZIMUTHS) for r in RAY_DISTANCES]


def horizon_profile(z0: float, rays: list[float]) -> list[dict[str, float]]:
    """Highest angle (degrees above the flat horizon) at which land blocks the view, every 10 degrees of compass, from the centre.
    `rays` holds the heights along each ray in the order of ray_points()."""
    n = len(RAY_DISTANCES)
    out = []
    for k in range(HORIZON_AZIMUTHS):
        best = 0.0
        for j, r in enumerate(RAY_DISTANCES):
            drop = (r * r) / (2 * EARTH_R) * (1 - REFRACTION)
            best = max(best, math.degrees(math.atan2(rays[k * n + j] - drop - (z0 + EYE_HEIGHT), r)))
        out.append({"az": k * 360 / HORIZON_AZIMUTHS, "alt": round(best, 2)})
    return out


def compass8(deg: float) -> str:
    return ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][int(((deg % 360) + 22.5) // 45) % 8]


def analyse(lat: float, lng: float, local_flat: list[float], region_flat: list[float], rays: list[float]) -> dict[str, Any]:
    local, region = as_grid(local_flat, LOCAL_N), as_grid(region_flat, REGION_N)
    slope, aspect = slope_aspect(local, LOCAL_STEP)
    horizon = horizon_profile(local[LOCAL_N // 2][LOCAL_N // 2], rays)
    peak = max(horizon, key=lambda h: h["alt"])
    flat = [v for row in local for v in row]
    return {
        "center": [round(lng, 5), round(lat, 5)],
        "elevation": round(local[LOCAL_N // 2][LOCAL_N // 2], 1),
        "slopeDeg": slope, "aspectDeg": aspect, "aspect": compass8(aspect) if aspect is not None else "flat",
        "localRelief": round(max(flat) - min(flat), 1),
        "regionRelief": round(max(region_flat) - min(region_flat), 1),
        "horizon": horizon,
        "horizonMax": {"az": peak["az"], "alt": peak["alt"]},
        "local": {"n": LOCAL_N, "stepM": LOCAL_STEP, "z": local},
        "region": {"n": REGION_N, "stepM": REGION_STEP, "z": region},
        "source": SOURCE,
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


@router.get("/terrain/settings")
def terrain_settings():
    with db.session() as conn:
        return {"enabled": _setting(conn, "terrain_enabled") == "1", "provider": "Open-Meteo elevation (Copernicus GLO-90)", "url": ELEVATION_URL_NOW()}


@router.put("/terrain/settings")
def set_terrain_settings(body: TerrainSettings):
    with db.session() as conn:
        conn.execute("INSERT INTO settings(key,value) VALUES ('terrain_enabled',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", ("1" if body.enabled else "0",))
    return terrain_settings()


@router.get("/properties/{pid}/terrain")
async def get_terrain(pid: str, refresh: bool = False):
    with db.session() as conn:
        prop = _property(conn, pid)
        enabled = _setting(conn, "terrain_enabled") == "1"
        cached = _cached(conn, pid)
    lat, lng = round(prop["center_lat"], 3), round(prop["center_lng"], 3)
    moved = cached is not None and (abs(cached["center"][1] - lat) > 0.0015 or abs(cached["center"][0] - lng) > 0.0015)
    if moved:
        cached = None  # the property was moved: the old answer is about another place
    fresh = cached is not None and datetime.fromisoformat(cached["fetchedAt"]) > datetime.now(timezone.utc) - timedelta(days=CACHE_DAYS)
    if cached and fresh and not refresh:
        return {"enabled": enabled, "terrain": {**cached, "stale": False}}
    if not enabled:
        return {"enabled": False, "terrain": ({**cached, "stale": True} if cached else None)}
    try:
        vals = await fetch_elevations(grid_points(lat, lng, LOCAL_N, LOCAL_STEP) + grid_points(lat, lng, REGION_N, REGION_STEP) + ray_points(lat, lng))
    except (httpx.HTTPError, ValueError) as e:
        if cached:  # keep showing the last real answer, labelled with its age
            return {"enabled": True, "terrain": {**cached, "stale": True}, "error": f"The elevation service could not be reached ({type(e).__name__}); showing the answer from {cached['fetchedAt'][:10]}."}
        raise HTTPException(502, f"The elevation service could not be reached ({type(e).__name__}). Terrain stays unknown until it can be.")
    a, b = LOCAL_N * LOCAL_N, LOCAL_N * LOCAL_N + REGION_N * REGION_N
    body = analyse(lat, lng, vals[:a], vals[a:b], vals[b:])
    with db.session() as conn:
        conn.execute("INSERT INTO terrain_cache(property_id, fetched_at, body) VALUES (?,?,?) ON CONFLICT(property_id) DO UPDATE SET fetched_at=excluded.fetched_at, body=excluded.body",
                     (pid, db.now(), db.dumps(body)))
        saved = _cached(conn, pid)
    return {"enabled": True, "terrain": {**saved, "stale": False}}


@router.delete("/properties/{pid}/terrain", status_code=204)
def forget_terrain(pid: str):
    with db.session() as conn:
        conn.execute("DELETE FROM terrain_cache WHERE property_id=?", (pid,))
