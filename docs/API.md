# API and integrations

The web app talks to the server through a JSON REST API under `/api`. When the server is running, interactive OpenAPI docs are at <http://127.0.0.1:8787/docs>.

## Endpoints

| Method & path | Purpose |
|---|---|
| `GET /api/health` | status, version, property count |
| `GET /api/properties` · `POST /api/properties` | list / create (`{name, center:[lng,lat], zoom?, description?}`); creating adds the 17 default layers |
| `POST /api/demo` | create the fictional demo estate (409 if it exists) |
| `GET /api/properties/{id}` | full model: `{property, layers, objects, overlays}` |
| `DELETE /api/properties/{id}` | delete property, objects and its images |
| `POST /api/properties/{id}/changes` | **autosave**: upsert layers/objects, delete ids, update view/base map/name |
| `POST /api/properties/{id}/overlays` | multipart upload of an image with its four calibrated corners |
| `GET/PATCH/DELETE /api/overlays/{id}[/image]` | serve image · change name/opacity/visibility/corners · remove |
| `GET /api/properties/{id}/export.{geojson,kml,csv,json}` | downloads |
| `POST /api/properties/{id}/import` | multipart GeoJSON/KML file → new objects |
| `POST /api/import-project` | multipart `.eden.json` → new property (new ids) |
| `GET /api/backup` · `POST /api/restore` | full backup zip / restore (validates, takes a safety copy) |
| `GET /api/geocode?q=` | place search via Nominatim (identified with a User-Agent, results trimmed) |
| `GET/PUT /api/settings` | imagery provider, Esri zoom limit, custom tile URL, keys (write-only) |
| `GET /api/map-providers` | provider catalog and base-map definitions for the browser |
| `GET /api/tiles/{provider}/{z}/{x}/{y}` | server-side tile proxy for keyed providers |

### Change set

```json
POST /api/properties/{id}/changes
{
  "layers":        [ { "id": "…", "key": "buildings", "name": "Buildings", "group": "Structures",
                       "color": "#f4a261", "visible": true, "locked": false, "order": 2 } ],
  "objects":       [ { "id": "…", "layerId": "…", "kind": "tree", "name": "Apple 1",
                       "geometry": { "type": "Point", "coordinates": [24.0526, 46.0484] },
                       "props": { "species": "Apple", "canopy": 4.5 } } ],
  "deleteObjects": [ "…" ],
  "deleteLayers":  [ "…" ],
  "view":          { "center": [24.0526, 46.0484], "zoom": 18, "bearing": 0, "pitch": 0 },
  "baseMap":       "satellite"
}
```

Errors are JSON `{ "detail": "…" }` — `422` for invalid geometry, unknown kind/layer or bad files, `404` for unknown ids, `409` when the demo exists, `415` for unsupported image types, `413` for oversized uploads.

## Import and export formats

| Format | Export | Import | Notes |
|---|---|---|---|
| **GeoJSON** | ✅ FeatureCollection, `id`, `kind`, `name`, `layer`, all props plus `area_m2` and `length_m` | ✅ | `Multi*` geometries are split; a `kind` property selects the object kind, otherwise polygons→zone, lines→path, points→note |
| **KML** | ✅ Placemarks with `kind` in ExtendedData | ✅ Point, LineString, Polygon (with holes) | opens in Google Earth |
| **CSV** | ✅ id, kind, layer, name, geometry, lng, lat (centroid), area, perimeter/length, status, description | – | |
| **EDEN project** (`.eden.json`) | ✅ complete model | ✅ new property | `format: "eden-project/1"` |
| **Backup zip** | ✅ database + uploads + manifest | ✅ | `format: "eden-backup/1"` |
| **Images** | – | PNG, JPEG, WebP (+ world file) | not GeoTIFF yet |

## Imagery providers

EDEN does not depend on a single provider and never scrapes tiles.

| Provider | Key | How requests flow |
|---|---|---|
| **Esri World Imagery / Topographic / place labels** | none | browser → Esri (attribution shown). Native zoom limit is a setting because coverage depth varies. |
| **OpenStreetMap (streets)** | none | browser → OSM tile servers (attribution shown; subject to OSM's tile usage policy — light use) |
| **MapTiler Satellite** | yours | browser → `/api/tiles/maptiler-satellite/{z}/{x}/{y}` → MapTiler; the key is added on the server |
| **Custom XYZ** | optional | same proxy; URL template may contain `{key}` |
| **Your own images** | – | uploaded, calibrated, served from `data/uploads` |

Choose the provider for the Satellite/Hybrid maps under *Settings*, or via `PUT /api/settings`:

```json
{ "satelliteProvider": "maptiler-satellite", "maptilerKey": "…", "esriMaxZoom": 17 }
```

Keys are **write-only**: `GET /api/settings` only reports `hasMaptilerKey: true/false`. If a keyed provider has no key the app falls back to Esri. Please review each provider's terms of use; EDEN only forwards requests and never caches or bulk-downloads tiles.

**Adding another provider:** add an entry to `DIRECT` (browser fetches) or `KEYED` (server proxies) in `backend/app/providers.py` and, if it should serve Satellite, to `SATELLITE_CHOICES`.

## Planned integrations (not implemented yet)

Home Assistant REST/WebSocket, MQTT, ONVIF/RTSP cameras, ESPHome, weather APIs — Phases 5 and 6. Until then EDEN shows device and camera positions on the map as *not connected* and never displays invented readings or video.
