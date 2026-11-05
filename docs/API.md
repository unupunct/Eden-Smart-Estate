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
| `GET /api/library` | read-only bundled plants, aquatic plants, fish, mushrooms, companion relationships, water-quality ranges and disclaimers |
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

## Smart home endpoints (v0.4)

| Method & path | Purpose |
|---|---|
| `GET/POST /api/integrations` · `PATCH/DELETE /api/integrations/{id}` | Home Assistant (`kind: homeassistant`, `url`, `token`) or MQTT (`kind: mqtt`, host in `url`, `token` = password, `options: {port, username, tls}`). Tokens are **write-only**: responses only say `hasToken`. |
| `POST /api/integrations/{id}/test` · `/sync` | connect and import; returns `{ok, message, count}` |
| `GET /api/devices` · `PATCH/DELETE /api/devices/{id}` | devices with their reported `state` (`null` = nothing reported); patch `name`, `objectId`, `risky`, `unit`, `commandTopic` |
| `POST /api/devices/mqtt` | add an MQTT device `{integrationId, name, stateTopic, commandTopic?, unit?}` (exact topics, no wildcards) |
| `POST /api/devices/{id}/command` | `{service, confirm}`; `409` when a risky device is commanded without `confirm: true`; `422` for a service not allowed for that device type; returns the state read back |
| `GET/POST /api/cameras` · `PATCH/DELETE /api/cameras/{id}` | snapshot / mjpeg / rtsp / ha cameras; credentials in the URL are moved to hidden storage |
| `GET /api/cameras/{id}/snapshot` · `/stream` | picture (`Cache-Control: no-store`) or MJPEG pass-through; failures return `502` (or `501` when ffmpeg is missing) with the reason |
| `GET/POST /api/automations` · `PATCH/DELETE /api/automations/{id}` | rules `{name, trigger, conditions, actions, enabled, riskAck}`; validation errors are `422` in plain words |
| `POST /api/automations/{id}/run` | `{dryRun, confirm}`: dry run (default) sends nothing |
| `GET /api/automations-log?automationId=&limit=` | activity log |
| `GET /api/smart/status` | poll interval, whether `paho-mqtt` and `ffmpeg` are available |

Rule JSON: triggers `{"type":"state","deviceId","to"|"above"|"below"}` or `{"type":"time","at":"07:30","days":[0..6]}`; conditions `{"type":"state","deviceId","op":"eq|ne|gt|lt","value"}` or `{"type":"time","after","before"}`; actions `{"type":"device","deviceId","service"}` or `{"type":"log","message"}`.

## Authentication (v1.2: the admin account)

There is **one admin account**. While none exists the API is open (EDEN listens on 127.0.0.1 only). Once it exists, every `/api` request except `/api/health` and `/api/auth/*` needs the session cookie and otherwise answers `401 {"detail":"Login required"}`.

| Method & path | Purpose |
|---|---|
| `GET /api/auth/status` | `{required, authenticated, setupAvailable, username}` (`setupAvailable` is true only while no admin exists and the caller is this computer) |
| `POST /api/auth/setup` | `{username, password}`: creates the admin and signs this browser in. `409` if one exists, `403` if not from this computer, `422` for a weak password (min. 10 characters) |
| `POST /api/auth/login` | `{username, password}`: `200` + HttpOnly SameSite=Strict cookie; `401` wrong; `429` locked out for 5 minutes after 5 failures |
| `POST /api/auth/password` | `{current, new}` (signed in): changes the password, signs every other session out, keeps this one. `403` wrong current password |
| `POST /api/auth/logout` | clears the cookie |

Writes carrying a foreign `Origin` header are refused (`403`) while protection is on.

## Management endpoints (v0.5)

| Method & path | Purpose |
|---|---|
| `GET /api/tasks?propertyId=&status=&objectId=` · `POST /api/tasks` · `PATCH/DELETE /api/tasks/{id}` | tasks `{title, notes, category, priority, due: "YYYY-MM-DD", repeatEvery, repeatUnit, repeatFrom: due\|completion, objectId}` |
| `POST /api/tasks/{id}/complete` | `{note?, completedOn?}`: records history; repeating tasks move to the next date, others become `done` |
| `GET /api/tasks-history?propertyId=&objectId=&limit=` | completions |
| `GET /api/properties/{id}/tasks.csv` | CSV export (formula-safe) |
| `GET /api/properties/{id}/tasks.ics` | calendar file: open dated tasks as all-day events with a 09:00 alarm, `RRULE` for repeats that follow the due date |
| `POST /api/documents` (multipart: `file`, `propertyId`, `objectId?`, `title?`, `tags?`, `note?`, `takenAt?`, `stripMetadata?` default `true`) | upload; JPEG/PNG metadata is removed unless `stripMetadata=false`; the answer lists `metadataRemoved`; `415` wrong type or content, `413` too large, `422` empty/bad date |
| `GET /api/documents?propertyId=&objectId=&q=&kind=photo\|document` · `PATCH/DELETE /api/documents/{id}` | list/search, edit metadata, delete (removes the file) |
| `GET /api/documents/{id}/file[?download=true]` | the file, with `nosniff` and a sandbox CSP |
| `GET/PUT /api/weather/settings` | `{enabled}`: weather is off by default |
| `GET /api/weather?lat=&lng=` | `403` while switched off; otherwise `{source, fetchedAt, stale, error?, data}` (current, 7 days, next 48 hours) |

## Notifications, documents, cameras and terrain (v1.2)

| Method & path | Purpose |
|---|---|
| `GET /api/push/status` | `{publicKey, digest, hour, subscriptions[]}`: the VAPID public key the browser subscribes with (the private key never leaves the server) |
| `POST /api/push/subscribe` · `POST /api/push/unsubscribe` · `DELETE /api/push/subscriptions/{id}` | register / remove a browser (`{endpoint, keys:{p256dh, auth}, label}`); only real push-service addresses are accepted |
| `PUT /api/push/settings` | `{digest?, hour?}`: the daily task digest |
| `POST /api/push/test` | send a test notification to every subscribed browser (`409` if none) |
| `GET /api/ocr/status` · `PUT /api/ocr/settings` | OCR engine, installed languages, selected languages (`{languages:["eng","ron"]}`) |
| `GET /api/documents/{id}/text` | `{status, note, text, label}`: text read from the document; `label` says whether it is machine-read (OCR) |
| `POST /api/documents/{id}/ocr` · `POST /api/ocr/run-missing?propertyId=` | read (again) one document / every unread one (background) |
| `GET /api/documents-text/search?q=&propertyId=` | documents whose text contains `q`, with a snippet |
| `POST /api/documents` | now also takes `readText` (`true`/`false`) |
| `POST /api/onvif/discover` | `{seconds?}`: WS-Discovery on the local network → `{cameras:[{xaddr, host, name, hardware, ...}], note}` |
| `POST /api/onvif/profiles` | `{xaddr, username, password}`: logs in to the camera and returns its device information and video profiles with snapshot / RTSP addresses (nothing is stored) |
| `POST /api/onvif/add` | `{xaddr, username, password, profileToken, name, objectId?}`: asks the camera again and creates the camera (snapshot if it has a snapshot address, otherwise RTSP) |
| `GET /api/terrain/settings` · `PUT /api/terrain/settings` | the opt-in switch (`{enabled}`) |
| `GET /api/properties/{id}/terrain?refresh=` | `{enabled, terrain, error?}`: elevation, slope, aspect, relief, skyline profile (36 azimuths), the 5x5 and 15x15 grids, source and licence, `fetchedAt`, `stale`. Fetches only when enabled and not cached; `DELETE` on the same path forgets it |
| automation action `{"type":"notify","message":"..."}` | sends a push notification when the rule fires (dry runs only log it) |

## Planned integrations (not implemented yet)

ESPHome and ONVIF discovery.
