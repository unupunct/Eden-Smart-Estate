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
- With no login, **anyone who can reach the server can operate the connected devices** (including risky ones, which only ask the browser for a confirmation flag). Keep EDEN on `127.0.0.1` unless the whole network is trusted.
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

## Where the 28-section specification stands

| Spec section | State |
|---|---|
| 2 Platform/tech, 20 data model (core entities), 22 import/export (GeoJSON, KML, CSV, JSON, images, backup) | ✅ implemented |
| 3 Control Center (navigation, overview) | ✅ shell, overview with real statistics; widgets customisation planned |
| 4 Property editor, 4.1 imagery + calibration, 4.2 boundary/measurements, 4.3 layers, 5 object editor | ✅ implemented (photos/documents/maintenance schedules planned with Phase 6) |
| 5.1/5.2 building editor and 3D | ✅ footprints, properties, extrusion; detail page and roof geometry planned |
| 6 Fences & infrastructure | ✅ fences, gates, roads, paths, pipes, cables; sections computed |
| 7–10 Garden, orchard, greenhouse, pond | ✅ planting plans, companion checks, orchard records/pollination/grid, greenhouse layout and targets, pond planning with fish and water-quality log (live monitoring/automation planned, Phase 5) |
| 11 Plant & mushroom library | ◐ curated starter set (100 plants, 25 aquatic, 10 fish, 26 mushrooms, 49 relationships) with evidence levels; no photographs; broader sourced data welcome |
| 12–13 Sun/shadows, night sky | ✅ sun position, cast shadows, sun hours per bed and for the property, season comparison, night-sky chart with planets, Moon and dark window (v0.3); no terrain, no cloud data |
| 14–15 Smart home, cameras | ✅ Home Assistant and MQTT devices, control with confirmation, camera snapshot/MJPEG/RTSP/HA feeds, automations with log (v0.4); no ONVIF discovery, recording or motion detection |
| 17–19 Notes/tasks, weather, global search | ◐ per-object notes and object search; tasks/weather planned (Phase 6) |
| 25 Data accuracy rules | ✅ no invented values; demo clearly labelled; "not connected" states |
| 26 Demo project | ✅ |
