"""Neighbouring buildings from OpenStreetMap, on request, so their shade counts in the sun hours.

Pressing "Find neighbouring buildings" on the Sun & Shadows page makes a request to an Overpass server (a public read-only
interface to OpenStreetMap data; if one is busy the next of a short list is tried): the property centre rounded to 3 decimals (about 100 m) and a radius. Nothing else is sent, nothing
is stored here and nothing happens unless you press the button. The answer is only a list of candidate outlines; the page decides
which to add to your map (as ordinary, editable objects on their own layer).

Honest limits (shown on the page): OpenStreetMap is volunteer-made. Outlines are usually good for buildings in towns and villages, but
heights are only there when someone added them. Without a height tag EDEN estimates from the number of floors (3 m each) and,
without that, assumes a typical height for the building type: always labelled, always editable. Data: (c) OpenStreetMap contributors, ODbL.
"""
import math
import re
from typing import Any

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from . import config, db

router = APIRouter(prefix="/api")

TRANSPORT: httpx.AsyncBaseTransport | None = None  # tests inject httpx.MockTransport
MAX_RESULTS = 400
MIN_AREA_M2 = 6.0
# typical heights (to the top) where the data has neither a height nor a floor count; deliberately plain and labelled "assumed"
TYPICAL_HEIGHT = {"garage": 3.0, "garages": 3.0, "carport": 2.6, "shed": 2.5, "hut": 2.5, "cabin": 3.5, "barn": 6.0, "farm_auxiliary": 4.5,
                  "greenhouse": 3.0, "roof": 3.0, "house": 6.5, "detached": 6.5, "semidetached_house": 6.5, "terrace": 7.0, "residential": 7.0,
                  "apartments": 12.0, "church": 12.0, "chapel": 6.0, "industrial": 7.0, "warehouse": 7.0, "commercial": 8.0, "retail": 5.0}
DEFAULT_HEIGHT = 6.0
ROOF_SHAPES = {"gabled": "gable", "gable": "gable", "hipped": "hip", "half-hipped": "hip", "pyramidal": "hip", "hip": "hip",
               "mansard": "mansard", "gambrel": "mansard"}  # flat, skillion and the rest stay boxes: the safe overestimate
SOURCE = {"name": "OpenStreetMap via the Overpass API", "licence": "ODbL 1.0",
          "attribution": "(c) OpenStreetMap contributors, Open Database Licence (ODbL)", "url": "https://www.openstreetmap.org/copyright"}


class Query(BaseModel):
    radiusM: int = Field(150, ge=30, le=400)


def parse_number(v: Any) -> float | None:
    if v is None:
        return None
    m = re.match(r"^\s*(\d+(?:[.,]\d+)?)\s*(m|meters|metres)?\s*$", str(v))
    return float(m.group(1).replace(",", ".")) if m else None


def estimate_height(tags: dict[str, str]) -> tuple[float, str]:
    """(height to the top in metres, how it was obtained: 'tag' | 'floors' | 'assumed')."""
    h = parse_number(tags.get("height"))
    if h is not None and 0.5 <= h <= 300:
        return round(h, 1), "tag"
    lv = parse_number(tags.get("building:levels"))
    if lv is not None and 0 < lv <= 100:
        roof = parse_number(tags.get("roof:height")) or (1.5 if tags.get("roof:shape") in ROOF_SHAPES else 0.0)
        return round(lv * 3.0 + roof, 1), "floors"
    return TYPICAL_HEIGHT.get(tags.get("building", ""), DEFAULT_HEIGHT), "assumed"


def roof_of(tags: dict[str, str], height: float) -> tuple[str, float | None]:
    roof = ROOF_SHAPES.get(tags.get("roof:shape", ""), "flat")
    rh = parse_number(tags.get("roof:height"))
    eave = round(height - rh, 1) if roof != "flat" and rh is not None and 0.2 <= rh < height else None
    return roof, eave


def ring_area_and_centre(ring: list[list[float]], lat0: float, lng0: float) -> tuple[float, float, float]:
    """(area m2, centre east m, centre north m) of a lng/lat ring around lat0/lng0."""
    mx, my = 111_320.0 * math.cos(math.radians(lat0)), 110_574.0
    pts = [((lng - lng0) * mx, (lat - lat0) * my) for lng, lat in ring]
    a = cx = cy = 0.0
    for (x0, y0), (x1, y1) in zip(pts, pts[1:] + pts[:1]):
        c = x0 * y1 - x1 * y0
        a += c
        cx += (x0 + x1) * c
        cy += (y0 + y1) * c
    if abs(a) < 1e-9:
        return 0.0, sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts)
    return abs(a) / 2, cx / (3 * a), cy / (3 * a)


def parse_elements(data: dict[str, Any], lat0: float, lng0: float, radius: float) -> list[dict[str, Any]]:
    out = []
    for el in data.get("elements", []):
        if el.get("type") != "way" or "building" not in (el.get("tags") or {}):
            continue
        tags = {str(k): str(v) for k, v in el["tags"].items()}
        if tags.get("building") == "no":
            continue
        geom = el.get("geometry") or []
        ring = [[float(p["lon"]), float(p["lat"])] for p in geom if "lon" in p and "lat" in p]
        if len(ring) >= 4 and ring[0] == ring[-1]:
            ring = ring[:-1]
        if len(ring) < 3 or len(ring) > 400:
            continue
        area, cx, cy = ring_area_and_centre(ring, lat0, lng0)
        dist = math.hypot(cx, cy)
        if area < MIN_AREA_M2 or dist > radius + 60:
            continue
        height, basis = estimate_height(tags)
        roof, eave = roof_of(tags, height)
        out.append({"osmId": int(el["id"]), "ring": ring + [ring[0]], "areaM2": round(area, 1), "distanceM": round(dist), "height": height,
                    "heightBasis": basis, "roofType": roof, "eaveHeight": eave, "name": tags.get("name") or "", "buildingTag": tags.get("building", "yes")})
    out.sort(key=lambda b: b["distanceM"])
    return out[:MAX_RESULTS]


@router.post("/properties/{pid}/neighbours/search")
async def search(pid: str, body: Query | None = None):
    body = body or Query()
    with db.session() as conn:
        r = conn.execute("SELECT center_lat, center_lng FROM properties WHERE id=?", (pid,)).fetchone()
    if not r:
        raise HTTPException(404, "Property not found.")
    lat, lng = round(r["center_lat"], 3), round(r["center_lng"], 3)
    q = f'[out:json][timeout:25];way["building"](around:{body.radiusM},{lat:.3f},{lng:.3f});out tags geom;'
    data, last = None, "no server answered"
    for url in config.overpass_urls():  # public servers are often busy: try the next one rather than fail
        try:
            async with httpx.AsyncClient(timeout=35, transport=TRANSPORT, headers={"User-Agent": config.USER_AGENT}) as client:
                res = await client.post(url, data={"data": q})
            if res.status_code != 200:
                raise httpx.HTTPError(f"HTTP {res.status_code}")
            got = res.json()
            if not isinstance(got, dict) or not isinstance(got.get("elements"), list):
                raise ValueError("unexpected answer")
            data = got
            break
        except (httpx.HTTPError, ValueError) as e:
            last = type(e).__name__
    if data is None:
        raise HTTPException(502, f"OpenStreetMap could not be reached ({last}). The public servers are sometimes busy: try again in a few minutes. Nothing was added.")
    return {"buildings": parse_elements(data, lat, lng, body.radiusM), "radiusM": body.radiusM, "center": [lng, lat], "source": SOURCE,
            "sent": f"the property centre rounded to about 100 m ({lat:.3f}, {lng:.3f}) and a {body.radiusM} m radius"}
