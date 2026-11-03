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
- API keys are stored in the local database and used only server-side (tile proxy); they are never returned by the API nor logged.
- Uploads: image MIME whitelist, size limit (40 MB), server-generated file names (no path traversal). Backup restore validates the archive, verifies the database opens, takes a safety copy first, and only extracts files directly under `uploads/`.
- The tile proxy only forwards requests to the provider URL configured by the user.

## Where the 28-section specification stands

| Spec section | State |
|---|---|
| 2 Platform/tech, 20 data model (core entities), 22 import/export (GeoJSON, KML, CSV, JSON, images, backup) | ✅ implemented |
| 3 Control Center (navigation, overview) | ✅ shell, overview with real statistics; widgets customisation planned |
| 4 Property editor, 4.1 imagery + calibration, 4.2 boundary/measurements, 4.3 layers, 5 object editor | ✅ implemented (photos/documents/maintenance schedules planned with Phase 6) |
| 5.1/5.2 building editor and 3D | ✅ footprints, properties, extrusion; detail page and roof geometry planned |
| 6 Fences & infrastructure | ✅ fences, gates, roads, paths, pipes, cables; sections computed |
| 7–10 Garden, orchard, greenhouse, pond | ◐ drawing, placement and properties; designers/monitoring planned (Phase 3/5) |
| 11 Plant & mushroom library | planned (Phase 3, needs vetted data) |
| 12–13 Sun/shadows, night sky | planned (Phase 4) |
| 14–15 Smart home, cameras | ◐ placement and camera coverage; integrations planned (Phase 5) |
| 17–19 Notes/tasks, weather, global search | ◐ per-object notes and object search; tasks/weather planned (Phase 6) |
| 25 Data accuracy rules | ✅ no invented values; demo clearly labelled; "not connected" states |
| 26 Demo project | ✅ |
