"""Map provider catalog, settings storage and the keyed tile proxy.

Direct providers are fetched by the browser. Keyed providers (MapTiler, custom XYZ with a key) are fetched through
/api/tiles/... so API keys stay on the server and are never sent to the frontend or written to logs.
No tiles are scraped or stored: the proxy only forwards requests and passes cache headers through.
"""
import httpx
from fastapi import APIRouter, HTTPException, Response

from . import config, db
from .models import SettingsIn

router = APIRouter(prefix="/api")

ESRI_ATTR = "Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community"

DIRECT = {
    "esri-imagery": {
        "name": "Esri World Imagery", "tiles": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}",
        "attribution": ESRI_ATTR, "maxzoom": 19,
    },
    "esri-labels": {
        "name": "Esri place labels", "tiles": "https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}",
        "attribution": ESRI_ATTR, "maxzoom": 19,
    },
    "esri-topo": {
        "name": "Esri World Topographic", "tiles": "https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}",
        "attribution": "Tiles © Esri — Esri, DeLorme, HERE, USGS, NGA, and others", "maxzoom": 19,
    },
    "osm": {
        "name": "OpenStreetMap", "tiles": "https://tile.openstreetmap.org/{z}/{x}/{y}.png",
        "attribution": "© OpenStreetMap contributors", "maxzoom": 19,
    },
}
KEYED = {
    "maptiler-satellite": {
        "name": "MapTiler Satellite", "url": "https://api.maptiler.com/tiles/satellite-v2/{z}/{x}/{y}.jpg?key={key}",
        "attribution": "© MapTiler © OpenStreetMap contributors", "maxzoom": 20, "secret": "maptiler",
    },
    "custom": {"name": "Custom XYZ tiles", "secret": "custom", "maxzoom": 22},
}
SATELLITE_CHOICES = ["esri-imagery", "maptiler-satellite", "custom"]


def get_setting(conn, key: str, default: str = "") -> str:
    r = conn.execute("SELECT value FROM settings WHERE key=?", (key,)).fetchone()
    return r["value"] if r else default


def _put(conn, table: str, key: str, value: str) -> None:
    if value == "":
        conn.execute(f"DELETE FROM {table} WHERE key=?", (key,))
    else:
        conn.execute(f"INSERT INTO {table}(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value", (key, value))


def _has_secret(conn, name: str) -> bool:
    return conn.execute("SELECT 1 FROM secrets WHERE key=?", (name,)).fetchone() is not None


def public_settings(conn) -> dict:
    return {
        "satelliteProvider": get_setting(conn, "satellite_provider", "esri-imagery"),
        "customTilesUrl": get_setting(conn, "custom_tiles_url"),
        "customAttribution": get_setting(conn, "custom_attribution"),
        "esriMaxZoom": int(get_setting(conn, "esri_maxzoom", "17")),
        "hasMaptilerKey": _has_secret(conn, "maptiler"),
        "hasCustomKey": _has_secret(conn, "custom"),
        "satelliteChoices": SATELLITE_CHOICES,
    }


def provider_catalog(conn) -> dict:
    """What the frontend needs to build its basemaps. Keyed providers expose only a proxied URL."""
    s = public_settings(conn)
    custom_ready = bool(s["customTilesUrl"])
    sat = s["satelliteProvider"]
    if sat == "maptiler-satellite" and not s["hasMaptilerKey"]:
        sat = "esri-imagery"
    if sat == "custom" and not custom_ready:
        sat = "esri-imagery"
    entries = {k: {"id": k, **v, "available": True} for k, v in DIRECT.items()}
    # Esri's native coverage depth varies by region; beyond it the service returns grey "not available" tiles,
    # so the user picks how deep to request and the map simply magnifies tiles past that level.
    for k in ("esri-imagery", "esri-labels", "esri-topo"):
        entries[k]["maxzoom"] = s["esriMaxZoom"]
    entries["maptiler-satellite"] = {
        "id": "maptiler-satellite", "name": KEYED["maptiler-satellite"]["name"], "tiles": "/api/tiles/maptiler-satellite/{z}/{x}/{y}",
        "attribution": KEYED["maptiler-satellite"]["attribution"], "maxzoom": 20, "available": s["hasMaptilerKey"]}
    entries["custom"] = {
        "id": "custom", "name": KEYED["custom"]["name"], "tiles": "/api/tiles/custom/{z}/{x}/{y}",
        "attribution": s["customAttribution"] or "Custom tile provider", "maxzoom": 22, "available": custom_ready}
    return {"providers": entries, "satellite": sat,
            "basemaps": {
                "satellite": {"label": "Satellite", "layers": [sat]},
                "hybrid": {"label": "Hybrid", "layers": [sat, "esri-labels"]},
                "streets": {"label": "Streets", "layers": ["osm"]},
                "terrain": {"label": "Terrain", "layers": ["esri-topo"]},
                "blank": {"label": "Blank grid", "layers": []},
            }}


@router.get("/settings")
def read_settings():
    with db.session() as conn:
        return public_settings(conn)


@router.put("/settings")
def write_settings(body: SettingsIn):
    with db.session() as conn:
        if body.satelliteProvider is not None:
            if body.satelliteProvider not in SATELLITE_CHOICES:
                raise HTTPException(422, "unknown provider")
            _put(conn, "settings", "satellite_provider", body.satelliteProvider)
        if body.esriMaxZoom is not None:
            if not 14 <= body.esriMaxZoom <= 19:
                raise HTTPException(422, "esriMaxZoom must be between 14 and 19")
            _put(conn, "settings", "esri_maxzoom", str(body.esriMaxZoom))
        if body.customTilesUrl is not None:
            url = body.customTilesUrl.strip()
            if url and not (url.startswith("https://") or url.startswith("http://")):
                raise HTTPException(422, "tile URL must start with http:// or https://")
            if url and not all(t in url for t in ("{z}", "{x}", "{y}")):
                raise HTTPException(422, "tile URL needs {z}, {x} and {y}")
            _put(conn, "settings", "custom_tiles_url", url)
        if body.customAttribution is not None:
            _put(conn, "settings", "custom_attribution", body.customAttribution.strip())
        if body.maptilerKey is not None:
            _put(conn, "secrets", "maptiler", body.maptilerKey.strip())
        if body.customKey is not None:
            _put(conn, "secrets", "custom", body.customKey.strip())
        return public_settings(conn)


@router.get("/map-providers")
def map_providers():
    with db.session() as conn:
        return provider_catalog(conn)


@router.get("/tiles/{provider}/{z}/{x}/{y}")
async def tile_proxy(provider: str, z: int, x: int, y: int):
    if provider not in KEYED:
        raise HTTPException(404, "unknown provider")
    with db.session() as conn:
        row = conn.execute("SELECT value FROM secrets WHERE key=?", (KEYED[provider]["secret"],)).fetchone()
        key = row["value"] if row else ""
        template = KEYED[provider].get("url") or get_setting(conn, "custom_tiles_url")
    if not template or (provider != "custom" and not key):
        raise HTTPException(404, "provider not configured")
    url = template.replace("{z}", str(z)).replace("{x}", str(x)).replace("{y}", str(y)).replace("{key}", key)
    try:
        async with httpx.AsyncClient(timeout=15, headers={"User-Agent": config.USER_AGENT}) as client:
            r = await client.get(url)
    except httpx.HTTPError:
        raise HTTPException(502, "tile provider unreachable")
    if r.status_code != 200:
        raise HTTPException(r.status_code if r.status_code in (401, 403, 404, 429) else 502, "tile provider refused request")
    return Response(r.content, media_type=r.headers.get("content-type", "image/jpeg"),
                    headers={"Cache-Control": r.headers.get("cache-control", "public, max-age=3600")})
