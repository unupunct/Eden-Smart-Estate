# Architecture and data model

## Overview

```
 Browser (React + TypeScript + MapLibre GL JS)
   ├─ Zustand store ── document (layers + objects) with undo/redo snapshots
   ├─ EdenMap controller ── renders the document, handles pointer/keyboard interaction
   └─ Autosave ── diffs document against last-saved baseline, sends change sets
            │  REST (JSON)
 FastAPI server (Python)
   ├─ routes.py    properties, changes, overlays, import/export, backup/restore, geocoding
   ├─ providers.py map provider catalog, settings, keyed tile proxy
   ├─ repo.py      persistence (SQL, no ORM)
   └─ db.py        SQLite connection + numbered SQL migrations
            │
 SQLite  data/eden.db   +   data/uploads/ (imported images)
```

The server also serves the built web app, so a normal install is a single process on one port.

## Coordinates and measurement

- **Everything is stored as WGS84 longitude/latitude** (GeoJSON order `[lng, lat]`). Screen pixels are never stored, so zooming, panning, rotating or switching base maps cannot move an object.
- **Distances** use the haversine formula on a sphere of radius 6 371 008.8 m. **Areas** use the Chamberlain–Duquette spherical-polygon formula with the authalic radius 6 371 007.2 m. Frontend (`geo/measure.ts`) and backend (`geo.py`) implement the same formulas, so exports match what the editor shows (covered by tests). At property scale the difference to an ellipsoidal calculation is well under 0.5 %.
- **Editing operations** (rotate, scale, circle, rectangle offsets, extruded fence quads) run in a local metric frame around a pivot (equirectangular projection on the same sphere), so shapes keep their true ground dimensions.
- **Image calibration** works in Web Mercator metres with a similarity transform (uniform scale + rotation + translation) fitted to the control points, so straight lines stay straight and the picture is never stretched.

## Object model

One record type for everything on the land (`map_objects`):

```jsonc
{
  "id": "6f1c…",            // 32-char hex UUID, created in the browser
  "layerId": "…",           // which layer it lives on
  "kind": "building",       // entry in the kind catalog
  "name": "Main house",
  "geometry": { "type": "Polygon", "coordinates": [[[lng,lat], …]] },   // Point | LineString | Polygon
  "props": { "floors": 2, "height": 7.5, "roofType": "gable", "status": "good", "notes": "…" }
}
```

- The **kind catalog** (`frontend/src/model/kinds.ts`) is the single place that defines a kind: geometry type, default layer, colours, how it is drawn (true width, true canopy, extrusion height), presets and the property fields that drive the right-hand form. Adding a kind needs no new database table or UI code.
- Kind-specific attributes live in the JSON `props`; typed tables for later modules (orchard records, greenhouse sensors, devices…) will reference `map_objects.id`.
- `backend/app/layers.py` holds the default layer set and the kind → layer map used when importing; a unit test checks that it agrees with the frontend catalog.
- **2D and 3D share the same objects.** 3D geometry is derived at render time (`map/features.ts → buildExtrusions`): building footprint × height, tree trunk + crown from canopy/height, fence/hedge quads from length × height.

## Database schema (migration `0001_init.sql`)

| Table | Purpose |
|---|---|
| `properties` | one row per estate: name, description, centre, zoom/bearing/pitch (last view), base map, `is_demo` |
| `map_layers` | layers per property: `key` (stable identity such as `buildings`), name, group, colour, visible, locked, order |
| `map_objects` | all drawn objects (above) with `rev` counter and timestamps |
| `image_overlays` | imported aerial images: file name, four corner coordinates, opacity, visibility, calibration record |
| `settings` / `secrets` | provider choice and zoom limit / API keys (never returned by the API) |
| `schema_migrations` | applied migrations |

Design choices for the future PostgreSQL move: text UUID keys, no SQLite-specific types, JSON stored as text (becomes `jsonb`), plain SQL in a thin repository layer (`repo.py`). Spatial indexing can be added with PostGIS later without changing the object model.

**Migrations:** every `backend/migrations/NNNN_name.sql` runs once, in filename order, at server start. Restoring an older backup applies newer migrations automatically.

## Autosave protocol

1. The editor keeps `lastSaved` (maps id → object reference).
2. On any change a trailing 700 ms debounce starts. It then diffs current objects/layers against `lastSaved` by reference (cheap, thanks to immutable updates) and builds a **change set**: upserted layers/objects, deleted ids, optionally view and base map.
3. `POST /api/properties/{id}/changes` applies it in one transaction (layers first, then objects, then deletions).
4. On success `lastSaved` advances; if the document changed meanwhile another save is scheduled. On failure the status turns red and a retry is scheduled.
5. Moving the map only saves the view position, with lower priority — it can never postpone saving content.

The server validates geometry (finite coordinates in range, closed rings, minimum points), kind names, and that layers/objects belong to the property.

## Undo / redo

The undoable document is `{ layers, objects }`. Updates are immutable, so history is a stack of snapshots that share structure (cheap, 200 steps). Dragging uses *gestures*: `beginGesture` remembers the base, live updates bypass history, `endGesture` pushes one entry. Rapid edits to the same field coalesce (≤ 900 ms). Selection is pruned when undo removes an object.

## Rendering and interaction

- MapLibre renders one GeoJSON source for all objects (data-driven styling by feature properties: colour, opacity, line width, dash, true-size canopy/width via an exponential zoom ramp). Draw order follows layer order, then creation order (`sort-key`).
- Point symbols are emoji badges drawn to canvas at start-up — no glyph server, no external fonts, fully offline. Text labels are DOM markers, placed with collision avoidance and size checks.
- `map/interaction.ts` is a small state machine: selection, move, vertex/edge/rotate handles, drawing (polygon, rectangle, circle, line, point), measuring, snapping, image-calibration clicks, keyboard shortcuts. Mouse and single-touch events share one code path.
- Hit testing ranks points over lines over polygons, and smaller polygons over larger ones, so clicking a bed inside a zone selects the bed. Locked layers are not hit-testable.

## Security notes

- Binds to `127.0.0.1` by default. There is **no authentication** yet; `-Lan` exposes full edit access to the network (documented prominently).
- API keys, Home Assistant tokens, MQTT and camera passwords are stored in the local database (`secrets` table) and used only server-side; they are never returned by the API nor logged. **They are included in a full backup file**, so treat backups as private.
- Without a password, **anyone who can reach the server can operate the connected devices**: EDEN therefore listens on `127.0.0.1` by default and `-Lan` requires a password. With `EDEN_PASSWORD` set, `auth.py` guards every `/api` route (signed HttpOnly SameSite=Strict session cookie, HMAC key derived from the password, per-address lock-out, `Origin` check on writes). Traffic is still plain HTTP: see `SECURITY.md`.
- Uploads: image MIME whitelist, size limit (40 MB), server-generated file names (no path traversal). Backup restore validates the archive, verifies the database opens, takes a safety copy first, and only extracts files directly under `uploads/`.
- The tile proxy only forwards requests to the provider URL configured by the user.

## Landscape design and plant library (v0.2)

**Library data** is bundled with the server (`backend/app/library_plants.py`, `library_other.py`, served read-only by `GET /api/library`). It is deliberately plain Python so it can be reviewed in a diff:

| Collection | Notes |
|---|---|
| `PLANTS` | id, names (common, Latin, Romanian where known), family, categories, native status, edibility, sun, water, soil, size, spacing, hardiness, sowing/flowering/harvest months, wildlife, `med` (traditional use only), `tox` (warning), pollination (fruit trees), `place` (tree / bush / plant) |
| `AQUATIC` | planting zone, water depth range, vigour, invasive flag with reason |
| `FISH` | suitability for a natural swimming pond (`suitable` … `unsuitable`), size, temperature range, warnings |
| `MUSHROOMS` | status (edible → deadly), look-alikes, warnings, cultivation notes; no images |
| `COMPANIONS` | pair, type (beneficial, pest, nutrient, compatible, conditional, incompatible), **evidence** (documented / mixed / traditional), explanation |

Integrity tests enforce unique ids, valid references, an evidence level on every relationship, loud warnings on toxic plants and mushrooms, that traditional claims are never labelled "documented", and that the demo only references existing species.

**Object links:** drawn objects reference the library with `props.speciesId`; nothing about a species is copied except sensible starting sizes. Plant lists for beds live in `props.plantings`, tree records in `props.pruning / fertilizing / pests`, pond data in `props.fish` and `props.waterLog`, greenhouse targets in plain props. No schema change was needed (the object model is generic).

**Logic** (`frontend/src/library/logic.ts`, pure and unit-tested): relationship index and green/yellow/red mapping; bed analysis (room, overcrowding, pair checks); neighbour links with per-species reach (walnut 15 m); pollination partner search; orchard statistics; grid-in-polygon generation; smallest-area rotated rectangle for greenhouse size and orientation; pond volume estimate; fish verdicts; water-quality range checks.

**New object kinds:** greenhouse interior (`gh_bed`, `gh_shelf`, `gh_door`, `gh_vent`, `gh_heater`, `gh_fan`, `gh_light`, `gh_irrigation`, `gh_tank`) and pond equipment (`pond_pump`, `pond_filter`, `pond_skimmer`, `pond_waterfall`, `pond_steps`, `pond_stone`, `pond_stream`) on the existing *Greenhouse* and *Pond* layers.

**Map additions:** projected mature canopy rings (own source, optional) and companion links from the selected plant (green/yellow/red, own source). Both are derived from the document at render time.

## Sun, shadows and sky (v0.3)

All astronomy and shadow geometry runs in the browser, in plain tested TypeScript, from the property's coordinates and the document: nothing is stored and no service is called.

| Module | Role |
|---|---|
| `sun/astro.ts` | Sun (NOAA/Meeus, ~0.01°), moon (Meeus ch. 47 main terms, ~0.2°, topocentric parallax, phase and illumination), five planets (JPL approximate Keplerian elements, ~0.5–1°), precession, sunrise/sunset/twilight by bisection (−0.833° standard altitude), moonrise/set, next moon phase. Times are UTC milliseconds. |
| `sun/tz.ts` | Time zones via `Intl` (no tz database shipped): wall-clock ↔ UTC, local day boundaries (23/25 h days work), formatting. |
| `sun/shadows.ts` | Shading volumes from the document (building/greenhouse/solar boxes, fence and hedge walls, tree and bush cylinders) with a **density** per caster; sweep geometry; exact point-in-shadow tests; merged ground-shadow polygons (`polygon-clipping` union); sun-hours sampling; heat-map grid; season days. |
| `sun/store.ts` | Zustand store: shadows on/off, zone, instant, foliage mode, heat-map data. |
| `sky/stars.ts`, `sky/chart.ts` | Bright-star list (J2000), simplified constellation figures, horizontal coordinates, dome projection, twilight colours, moon-free dark window. |
| `pages/Sun.tsx`, `pages/Sky.tsx` | The two pages (the sky is a canvas drawing). |

**Shadow model.** Ground is flat. A point at height *z* casts its shadow *z / tan(elevation)* away from the sun (capped at 20× for grazing sun). A caster's shadow is the footprint swept from the displacement of its bottom to that of its top, so a prism is a hull and a tree crown a capsule. A ground point is shaded by a caster when the segment from the point back towards the sun meets the footprint: exact and cheap, so sun-hours need no polygon operations. Several casters multiply their light transmission (1 − density), so two layers of foliage shade more than one. Densities: buildings, fences and solar 1.0; hedge 0.8; greenhouse glazing 0.4; deciduous crowns 0.75 in leaf and 0.2 bare (interpolated through April and October); evergreen crowns 0.85. `Plant.leaf` in the library says which is which.

**Map integration.** `EdenMap.syncSun` builds the casters and the merged polygons when the document, the sun store or the library changes and writes them to two GeoJSON sources (`shadow`, split into *dense* and *light*, and `sunheat`). Both layers sit under the object layers and are not hit-testable. The Sun page computes the per-area table (15-minute step, about 60 sample points per area) and the heat-map grid (at most 3500 cells) after a short debounce so dragging stays smooth.

## Smart home, cameras and automations (v0.4)

Server side (migration `0002_smart.sql`):

| Table | Purpose |
|---|---|
| `integrations` | Home Assistant or MQTT connection (URL/host, options, status and message). Credentials live in `secrets` (`int:<id>`), never in this table. |
| `devices` | one row per HA entity or MQTT state topic: name, domain, unit, **`state` (NULL until reported)**, last change, linked map object, `risky` flag, MQTT command topic. |
| `cameras` | kind (snapshot / mjpeg / rtsp / ha), clean URL, user name, optional HA entity and map object; password in `secrets` (`cam:<id>`). |
| `automations`, `automation_log` | rules as JSON (trigger, conditions, actions), acknowledgement flag, last run; a rolling log of 500 entries. |

| Module | Role |
|---|---|
| `smart_ha.py` | Home Assistant REST client (`/api/states`, `/api/services/...`, `/api/camera_proxy/...`), state parsing (drops camera access tokens), the per-domain **allow-list of commands**, plain-language errors. |
| `smart_mqtt.py` | one paho client per MQTT integration, subscribes to the user's topics, stores the last payload; optional dependency (reports itself missing). |
| `smart_auto.py` | pure rule evaluation: comparison that never trusts unknown states, change-detection triggers, time windows, validation, risk detection. |
| `smart.py` | REST routes, the sync/command/camera code, the automation runner and the polling loop (`EDEN_POLL_SECONDS`, default 15, `0` disables). |

**Truthfulness rules, enforced in code and tests:** device state is only written from an integration report; a device missing from a sync loses its state (NULL); an integration in error makes its states count as unknown for automations; after a command the state is **read back** (never assumed); the API never returns tokens or passwords; camera credentials typed into a URL are moved to secrets; commands outside a domain's allow-list are refused; risky devices need `confirm=true`; rules on risky devices need an acknowledgement to be enabled.

**Testing without real hardware:** Home Assistant, cameras and the MQTT broker are replaced by fakes that exist only in `backend/tests/test_smart.py` (httpx `MockTransport`, a fake paho client) and `frontend/e2e/fakes.mjs` (a small HTTP server whose entities are all named *TEST FIXTURE*). Nothing simulated ships in the app.

## Management: tasks, documents, weather, reports (v0.5)

Server side (migration `0003_manage.sql`, module `manage.py`):

| Table | Purpose |
|---|---|
| `tasks`, `task_history` | tasks (calendar-day `due`, priority, category, repeat rule, linked `object_id`) and an append-only record of completions (the maintenance history survives deleting the task) |
| `documents` | metadata of uploaded files (title, tags, note, date, linked object); the file itself is `uploads/doc_<id>.<ext>`: **flat in the uploads folder**, so the existing backup/restore carries it |
| `weather_cache` | the last real answer per rounded location with its fetch time |

- `recurrence.py`: next-occurrence maths. Occurrences are computed from the original anchor (no drift at month ends) and, when keeping the rhythm, past occurrences are skipped.
- **Uploads:** extension allow-list, **content sniffing** (magic bytes), size limit, generated stored names, `Content-Security-Policy: sandbox` + `nosniff`, inline only for images and PDF. Deleting a document or a property removes the files.
- **Weather:** opt-in setting (`weather_enabled`), fixed provider URL (overridable by `EDEN_WEATHER_URL` for tests), 20-minute cache, stale fallback flagged `stale: true` with the original fetch time, `502` when nothing real exists. Only the parts EDEN shows are stored.
- Frontend: `manage/logic.ts` (urgency, due wording, WMO weather codes, facts derived from forecast numbers), `manage/store.ts`, `reports/build.ts` (a pure function from the data to report sections, so honest "nothing to report" wording is unit-tested); pages `Tasks`, `Documents`, `Weather`, `Reports`; `ObjectManage` shows tasks and attachments in an object's panel.

## Privacy, HTTPS, search and roofs (v1.1)

- `privacy.py`: strips metadata from uploaded photos without re-encoding. JPEG: APP1 (EXIF/XMP), APP13 (IPTC), comments and multi-picture data are dropped and a minimal EXIF block holding only the orientation is kept (right after JFIF); PNG: `tEXt`/`zTXt`/`iTXt`/`tIME`/`eXIf` chunks are dropped. A structure the parser does not understand is stored unchanged. Upload responses list what was removed.
- `tls.py` (`python -m app.tls --dir <data> --name <ip>`): self-signed EC P-256 certificate with subject alternative names; reused until a new name is needed or fewer than 30 days remain; `start.ps1 -Https` passes it to uvicorn and the login cookie gets `Secure` over HTTPS.
- `search/global.ts`: a pure function over data the app already holds in its stores (so it is instant and offline); accent- and case-insensitive, all words must match, title matches rank first, per-kind limits. `SearchPalette` is remounted on every open; results carry an intent (`search/intent.ts`) for the library and documents pages.
- `manage.py` `build_ics`: RFC 5545 calendar output (escaping, 75-octet folding, `RRULE` only for repeats that follow the due date, `VALARM` at 09:00). `manage/reminders.ts`: daily browser notifications from the already-loaded tasks.
- **Pitched roofs in the shadow model** (`sun/shadows.ts`): a building becomes walls (prism up to the eave) plus a convex roof volume given by its corner points (`hull3`): eave outline at wall height and the ridge at the full height (gable: ridge along the long side or `roofOrientation`; hip: ridge inset by half the width; mansard: steeper default rise; shed: only with a direction, per-vertex height across the slope). The shadow of a convex volume is the convex hull of its projected corners, so the same exact point test and polygon merge work as before.

## Admin account, push, OCR, ONVIF, terrain and the installer (v1.2)

- **Admin account** (`auth.py`, migration 0004): a one-row `admin` table (`CHECK (id = 1)`), scrypt-hashed password, a random `session_secret` in `settings`. Tokens are HMAC-signed with a key derived from that secret **and** the current password hash, so a password change or reset invalidates every other session without any session table. `EDEN_PASSWORD` only seeds the first account (`auth.bootstrap()` at start-up); `python -m app.admin reset` (via `scripts\reset-admin.ps1`) is the local recovery path.
- **Push** (`push.py`): VAPID keys in `secrets`; `pywebpush` encrypts (RFC 8291 aes128gcm) and sends (RFC 8292 `vapid` header) in a worker thread; subscription endpoints are limited to the known push services (SSRF guard); expired subscriptions (404/410) are forgotten; the daily digest is claimed in `push_sent` before sending so a restart never repeats it. The service worker (`frontend/public/sw.js`) shows notifications and focuses/opens EDEN on click; since v1.3 it also keeps the app and some data for offline use (see the v1.3 section).
- **Document text** (`ocr.py`): `documents.ocr_text/ocr_status/ocr_note`, filled by a background task after upload: direct extraction for text/Office/ODF files and PDF text layers (pypdf), Tesseract for pictures and picture-only PDF pages. Languages come from the engine's own folder plus `data/tessdata` (gathered into a temporary folder per run).
- **ONVIF** (`onvif.py`): WS-Discovery over UDP multicast (one socket per local interface), SOAP with WS-Security digest using the camera's own clock (`GetSystemDateAndTime`), `GetCapabilities` → media service → `GetProfiles`/`GetStreamUri`/`GetSnapshotUri`. Only private-network addresses are ever contacted, including those a camera reports. `add` re-asks the camera instead of trusting addresses from the browser.
- **Terrain** (`terrain.py`, frontend `terrain/`): one request set per property (local 5x5 at 90 m, regional 15x15 at 300 m, 36 rays x 20 points at 100 m) to the Open-Meteo elevation service, stored in `terrain_cache`. Horn slope/aspect, a skyline profile with curvature and refraction correction, and a horizon function that `sunHours`/`possibleHours` accept (`SunHourOptions.horizon`): the sun below the skyline is not counted.
- **Installer** (`installer/eden.iss`, `scripts/build-installer.ps1`): Inno Setup, per-user, with the verified embeddable Python and the dependencies installed from wheels into `python\Lib\site-packages`; `python313._pth` adds `..\backend` and `Lib\site-packages`. `start.ps1` prefers `python\python.exe` and falls back to `backend\.venv`. Signing: see [SIGNING.md](SIGNING.md).

## Library, terrain, neighbours, roofs and offline use (v1.3)

- **Library data** (`library_plants.py`, `library_plants_more.py`, `library_other.py`): plain Python data with one helper. `scripts/verify-taxonomy.py` (needs internet, run when the library changes) asks GBIF for every entry: `species/match` (accepted name, status, family) and, for plants, `species/{key}/distributions` filtered to the real regional checklists (WCVP, introduced taxa in Romania, Catalogue of Life, DAISIE). The result is committed as `library_taxa.json`; `library.py` attaches it as `taxon` to each entry and a test fails when an entry has no record. Nothing in the library is changed by the script: it prints the differences (synonyms, family, native vs introduced) for a person to decide.
- **Pictures** (`plantpictures.py`, migration 0005): opt-in; Wikipedia REST summary for the scientific name → the Commons file behind it → the Commons API for licence and author → one thumbnail (about 480 px) downloaded to `data/plant_pictures/<sha1>.<ext>` and served from `/api/library/picture-file/<name>` (strict name pattern). Only free licences, only Wikimedia hosts, size and type limits, answers (including "none") remembered in `plant_pictures`. Mushrooms are never looked up.
- **Terrain** (`terrain.py`, `terrarium.py`, frontend `terrain/`): a provider table (`open-meteo` 90 m JSON service; `terrarium` about 30 m PNG tiles, zoom 12, read with a small stdlib PNG decoder and bilinear sampling between pixel centres). The cached answer records its source; choosing another source makes it stale. `groundAt`/`surfaceFn` give the slope and facing of the ground at a point; `SunHourOptions.surfaceAt` makes a slope turned away from the sun (incidence <= 0) count as its own shade, and `tiltGain` is the direct-light energy on the slope over level ground for the day.
- **Neighbours** (`neighbours.py`, frontend `neighbours/`): one Overpass query (`way["building"](around:R,lat,lon)`), parsed into candidates with a labelled height basis (`tag`, `floors`, `assumed`); the page filters out your own land and what is already imported and creates `neighbour` objects on a custom layer. `neighbour` behaves like `building` in the shadow model and in 3D.
- **Roofs** (`sun/shadows.ts` `roofFrame`, `map/roofs.ts`): one description of the roof (ridge frame, eave, rise) feeds both the shadow volume (a convex hull per roof) and the 3D layer (strips across the ridge for gable and shed roofs, nested rectangles for hip and mansard roofs, each cut to the footprint with `polygon-clipping`).
- **Offline** (`frontend/public/sw.js`, `src/pwa.ts`, `vite.config.ts`): the build writes `asset-manifest.json`; the service worker precaches the page, icons and every built file, serves navigations network-first with the saved page as fallback, `/assets/*` cache-first, read-only `/api/` GETs network-first into a bounded cache (never auth, admin, push, camera pictures, documents, downloads or backups), and tiles and plant pictures cache-first into a bounded cache. `clear-user-data` (sent on sign-out) deletes the data and tile caches. The page re-requests what it loaded before the worker took over on the first visit.

## Startup performance and resilience (v1.0)

The first-load script is about 190 kB: pages are `React.lazy` chunks and the map engine (MapLibre) is only fetched when a map page opens, so the overview, tasks, documents, weather and reports pages appear without it. A page that throws is caught by an error boundary (message + *Reload*) keyed to the route, so the menu keeps working. `src/perf.test.ts` builds a 3000-object estate and asserts generous time limits for map features, 3D extrusions, the autosave diff, shadow projection, sun hours and the heat map.

## Where the 28-section specification stands

| Spec section | State |
|---|---|
| 2 Platform/tech, 20 data model (core entities), 22 import/export (GeoJSON, KML, CSV, JSON, images, backup) | ✅ implemented |
| 3 Control Center (navigation, overview) | ✅ shell, overview with real statistics, sun/moon, tasks, weather, devices; no customisable widgets |
| 4 Property editor, 4.1 imagery + calibration, 4.2 boundary/measurements, 4.3 layers, 5 object editor | ✅ implemented (photos/documents/maintenance schedules planned with Phase 6) |
| 5.1/5.2 building editor and 3D | ✅ footprints, properties, extrusion, Buildings page (floors, floor area, services, devices inside, tasks, files); no roof geometry, no interior floor plans |
| 6 Fences & infrastructure | ✅ fences, gates, roads, paths, pipes, cables; sections computed |
| 7–10 Garden, orchard, greenhouse, pond | ✅ planting plans, companion checks, orchard records/pollination/grid, greenhouse layout and targets, pond planning with fish and water-quality log (live monitoring/automation planned, Phase 5) |
| 11 Plant & mushroom library | ◐ curated starter set (100 plants, 25 aquatic, 10 fish, 26 mushrooms, 49 relationships) with evidence levels; no photographs; broader sourced data welcome |
| 12–13 Sun/shadows, night sky | ✅ sun position, cast shadows, sun hours per bed and for the property, season comparison, night-sky chart with planets, Moon and dark window (v0.3); terrain skyline from 90 m elevation data (v1.2, opt-in); no cloud data |
| 14–15 Smart home, cameras | ✅ Home Assistant and MQTT devices, control with confirmation, camera snapshot/MJPEG/RTSP/HA feeds, ONVIF discovery and set-up (v1.2), automations with log (v0.4); no recording or motion detection |
| 17–19 Notes/tasks, weather, global search | ✅ tasks with repeats and history, documents and photos per object, opt-in weather forecast, object search; search across tasks and documents is per page (no single global search) (v0.5) |
| 25 Data accuracy rules | ✅ no invented values; demo clearly labelled; "not connected" states |
| 26 Demo project | ✅ |
