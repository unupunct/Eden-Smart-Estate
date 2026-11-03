# EDEN — Smart Estate

**A digital twin of your land.** Open a satellite image of your real property, trace its boundary, and gradually turn it into an editable, measured, geographic model — buildings, fences, trees, garden beds with companion-planting checks, an orchard, a greenhouse and a natural swimming pond — stored on your own computer, no cloud subscription required.

> **Status: v0.4.0 — Phases 1–5 (property editor, landscape design, plant library, sun & shadows, night sky, smart home, cameras, automations).**
> The map, object system, editor, measurements, layers, image calibration, 2D/3D, import/export and backup (v0.1) come with garden-bed planting plans, evidence-labelled companion planting, orchard records, greenhouse and natural-pond planning, a plant library (v0.2), and now **real sun positions, cast shadows, sun hours per bed and a night-sky chart** (v0.3), and **Home Assistant / MQTT devices, camera pictures and simple automations** (v0.4). Tasks and weather are on the [roadmap](#roadmap) and appear in the app as clearly-marked *soon* pages. EDEN never fakes sensor values, camera feeds or device connections.

![Property editor with the demo estate](docs/screenshots/02-property-editor.png)

## What works today

**Map and imagery**
- Satellite, hybrid, street and terrain base maps through a **configurable provider layer** (Esri World Imagery out of the box, MapTiler or any XYZ tile server with your own key). No tile scraping; provider attribution is always shown. API keys stay on the server and are never sent to the browser.
- Search by place name or by `lat, lng` coordinates.
- **Bring your own aerial photo or plan:** import a PNG/JPEG/WebP and calibrate it with two known points, a known distance + bearing, or a world file.

**Property editor**
- Draw **property boundary, zones, buildings (12 presets), greenhouses, fences (6 types), hedges, gates, roads, paths, garden beds, trees (13 fruit/nut presets), bushes, plants, ponds, pipes, drainage, cables, smart outlets, cameras, lights, sensors, solar and notes.**
- Polygons as free shapes, rectangles or circles; lines and points; **snapping** to existing corners and edges.
- Every shape stays editable: **move, reshape, add/remove corners, rotate, scale, duplicate, delete, rename, recolour, move between layers.**
- Per-object properties panel with live measurements (area in m² and ha, perimeter, edge lengths, fence sections…), **17 layers** (show/hide, lock, rename, recolour, reorder), **unlimited undo/redo**, **autosave**, **2D ↔ 3D**.
- Import GeoJSON/KML; export GeoJSON, KML, CSV and a full project file; one-click full **backup & restore**.

**Landscape design (new in v0.2)**
- **Plant library:** 100 plants and trees (vegetables, herbs, fruit and nut trees, native forest trees, wild edibles, climbers, flowers, toxic plants), 25 aquatic plants, 10 pond fish and 26 mushrooms. Filter by name (common, Latin, Romanian), category, native status, sun, water, edibility, winter hardiness, flowering and harvest month, mature height, wildlife value and *companion of…*. **ADD TO PROPERTY** arms the map so you place that species with one click.
- **Companion planting with honest evidence:** 49 recorded relationships, each labelled **documented**, **mixed** or **traditional**. Green = documented compatibility, yellow = conditional or only traditional/mixed evidence, red = known incompatibility. Tomato + marigold (nematodes) is *documented*; tomato + basil is *traditional*; tomato + potato is red, and so are tomato, potato and apple near a walnut tree (juglone, checked out to 15 m). Nothing is invented — and where the library has no entry it says so.
- **Garden beds:** list the crops, counts, spacing and sowing dates per bed; room-for-N estimates, overcrowding warnings, expected harvest windows, and a pair-by-pair companion check. Select any plant to see **green/yellow/red links** to neighbours on the map.
- **Orchard:** per-tree species, variety, planting year → **age**, projected **mature canopy** (toggle on the map), pruning / fertilisation / pest logs, **pollination partner finder** (same species, different variety, within 50 m) and an **orchard statistics page**. **Plant a grid** of trees into an orchard area at chosen spacing, row angle and stagger — undone in one step.
- **Greenhouse:** footprint, true length × width and orientation, interior items (beds, shelving, doors, vents, heater, fan, lights, irrigation, tank), target temperature/humidity/soil-moisture ranges. Monitoring shows **“no sensors connected”** until a real integration exists.
- **Natural swimming pond:** area, **estimated volume** from depth zones, equipment (pump, filter, skimmer, waterfall, steps, stones, stream), aquatic plants by zone with **invasive-species warnings**, fish stock with **suitability warnings** (koi, goldfish, grass carp flagged), and a manual **water-quality log** with trend chart and range warnings.
- **Safety:** medicinal entries are **traditional use only**; toxic plants and mushrooms carry loud warnings; the mushroom library never claims anything is safe from a photo (and bundles no photos).

| Select and edit | 3D view |
|---|---|
| ![Object properties](docs/screenshots/03-object-properties.png) | ![3D view](docs/screenshots/05-3d-view.png) |
| **Garden bed planting plan with companion check** | **Companion links on the map** |
| ![Bed plantings](docs/screenshots/09-bed-plantings.png) | ![Companion links](docs/screenshots/10-companion-links.png) |
| **Plant library** | **Mushroom safety** |
| ![Plant library](docs/screenshots/14-plant-library.png) | ![Mushroom safety](docs/screenshots/15-mushroom-safety.png) |
| **Natural pond: fish and water quality** | **Projected mature canopy** |
| ![Pond panel](docs/screenshots/13-pond-panel.png) | ![Mature canopy](docs/screenshots/11-mature-canopy.png) |
| **Cast shadows and sun hours per bed** | **Sun-hours map for the whole property** |
| ![Sun and shadows](docs/screenshots/20-sun-shadows.png) | ![Sun-hours map](docs/screenshots/22-sun-hours-map.png) |
| **Midwinter shadows (same estate, 21 December)** | **Night sky** |
| ![Winter shadows](docs/screenshots/23-winter-shadows.png) | ![Night sky](docs/screenshots/24-night-sky.png) |
| **Smart Home (test fixture, not real devices)** | **Automations with activity log** |
| ![Smart Home](docs/screenshots/25-smart-home.png) | ![Automations](docs/screenshots/26-automations.png) |
| **Cameras: picture, unreachable camera, missing ffmpeg** | **Integration offline: values marked last known** |
| ![Cameras](docs/screenshots/27-security-cameras.png) | ![Offline](docs/screenshots/28-integration-offline.png) |

<details><summary>More screenshots</summary>

![Season comparison table](docs/screenshots/21-sun-seasons.png)
![Orchard page](docs/screenshots/17-orchard-page.png)
![Greenhouse page](docs/screenshots/18-greenhouse-page.png)
![Pond page](docs/screenshots/19-pond-page.png)
![Garden page](docs/screenshots/16-garden-page.png)
![Tree record](docs/screenshots/12-tree-record.png)
![Layers](docs/screenshots/04-layers.png)
![Measuring](docs/screenshots/06-measure.png)
![Overview](docs/screenshots/01-overview.png)
![Settings](docs/screenshots/08-settings.png)
![Welcome](docs/screenshots/00-welcome.png)

</details>

> The screenshots show the fictional **demo estate** placed on a random open meadow. It is not a real property. The demo's garden bed 5 deliberately pairs potato with tomato, and its pond holds a goldfish, to show the warnings.

**Sun, shadows and sky (new in v0.3)**
- **Sun position** for your exact coordinates, any date and time, in any time zone: azimuth, elevation, sunrise, solar noon, sunset, day length, civil/nautical/astronomical twilight, and the length of a 1 m post's shadow. Standard astronomical formulas (sun to about 0.01°); tested against almanac values.
- **Cast shadows on the map** from every visible building, greenhouse, fence, hedge, tree and bush, with a time-of-day slider and an animated day. Drag a building and watch its shadow move. Trees cast lighter shadows when bare and denser ones in leaf; evergreens shade all year.
- **Sun hours** for every garden bed, greenhouse bed, orchard area and pond on the selected date and on the four season days (March/September equinox, June/December solstice), plus a **whole-property sun-hours map**. Library plants are checked against their light needs ("tomato wants 6 h+, this bed gets 4.3 h").
- **Sun-path diagram** (looking down on the property, north up) with the four season arcs and the day's hours marked.
- **Night sky:** an all-sky chart for your location and time — about 100 bright stars with simplified constellation figures, the five naked-eye planets, the Moon with phase, and the twilight colour of the sky. Moonrise/moonset, next full and new moon, and the **moon-free dark window** for stargazing. Hover anything for its name.
- Honest limits are shown in the app: flat ground (no terrain), roofs as boxes, foliage transmission is an estimate, planets are accurate to about 1°, and EDEN does not know the cloud cover.

**Smart home, cameras and automations (new in v0.4)**
- **Home Assistant** (REST API with a long-lived token) and **MQTT** brokers. Switches, lights, sensors, locks, covers, climate, valves and cameras are imported; you can rename them, link each to its position on the map and mark it *risky*.
- **Only real reports are shown.** A device whose integration has not reported a value says **no data**; if Home Assistant goes offline the values are marked *last known* and controls are disabled. Nothing is simulated or defaulted. Without any integration the app shows no device status at all.
- **Control with safeguards:** on/off, lock/unlock, open/close. Risky devices (locks, covers, heating, valves by default) ask for confirmation, and after each command the state shown is read back from the integration.
- **Cameras:** snapshot (JPEG) URLs, MJPEG streams, RTSP (via ffmpeg, if installed) and Home Assistant cameras, in a grid with full screen. Pictures and passwords go through the EDEN server, so credentials never reach the browser; a camera that cannot be reached shows why, never an old picture.
- **Automations:** *when* a device changes (becomes / rises above / falls below) or at a time of day, *if* conditions hold, *then* control devices or write to the log. Dry run, activity log, a one-minute cooldown, no action on unknown or offline states, and unattended rules on risky devices only after you acknowledge it. Clearly labelled as convenience, **not a safety system**.
- Credentials are stored on this computer, write-only in the API (and therefore part of a full backup file: keep backups private).
- Not included: automatic ONVIF discovery, recording or motion detection, a visual node editor, per-user accounts. The screenshots below use a clearly labelled **test fixture** instead of real devices.

## About the plant data

The library is a **curated starter set** written from general horticultural and botanical knowledge — *not* a citation-backed database and not exhaustive. Every companion relationship carries its evidence level; tradition is never presented as established science. Please verify anything important (especially toxicity, medicinal use and foraging) with local experts and sources. Entries are plain Python in `backend/app/library_*.py`, covered by integrity tests, and meant to be reviewed and extended.

## Install (Windows 11)

You need **Python 3.11 or newer** ([python.org](https://www.python.org/downloads/), tick *Add python.exe to PATH*). Node.js is only needed if you build from source.

```powershell
git clone https://github.com/unupunct/Eden-Smart-Estate.git
cd Eden-Smart-Estate
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
powershell -ExecutionPolicy Bypass -File scripts\start.ps1
```

Your browser opens at <http://127.0.0.1:8787>. Click **Explore the demo estate**, or **Create my property**. Your existing data is migrated automatically when you update.

The complete guide — release zip, LAN/tablet access, autostart, updating, backup, troubleshooting — is in **[docs/INSTALL.md](docs/INSTALL.md)**.

## Documentation

| | |
|---|---|
| [Installation guide](docs/INSTALL.md) | Step by step, plus LAN access, autostart, updates, troubleshooting |
| [User guide](docs/USER_GUIDE.md) | Drawing, editing, layers, measuring, planting plans, orchard, pond, library, sun & shadows, night sky, smart home, cameras, automations, shortcuts |
| [Architecture & data model](docs/ARCHITECTURE.md) | Object model, coordinates, autosave/undo design, library data model, database schema |
| [API & integrations](docs/API.md) | REST endpoints, import/export formats, imagery providers, key handling |
| [Development](docs/DEVELOPMENT.md) | Build, test, extend (object kinds, plant data, migrations, providers) |

## Tech

React 18 + TypeScript + Vite · MapLibre GL JS (maps, 2D/3D) · Zustand · FastAPI · SQLite (portable SQL, ready for PostgreSQL) · 119 frontend unit tests, 71 backend tests and four browser end-to-end suites (35 + 34 + 23 + 29 checks).

## Data, privacy and imagery

- All your data lives in the local `data/` folder (SQLite database + imported images). Nothing is uploaded anywhere by EDEN.
- Your **browser** requests map tiles directly from the imagery provider you select (so that provider sees your IP address and viewed area, like any web map). Place search goes through your local EDEN server to OpenStreetMap Nominatim and is only sent when you press Enter. Both are optional; the editor and the plant library work offline with stored data.
- Please read your imagery provider's terms. Esri World Imagery is shown with its required attribution; heavy or commercial use calls for your own key from a provider such as MapTiler.
- There is **no login yet**. Run on `127.0.0.1` (default). `-Lan` mode exposes editing to your whole network — see the install guide.

## Roadmap

| Phase | Scope | Status |
|---|---|---|
| 1 | Foundation: architecture, database, navigation, property creation, imagery, image calibration | ✅ done (v0.1) |
| 2 | Property editor: boundary, measurements, layers, objects, buildings, fences, notes, undo/redo, autosave | ✅ done (v0.1) |
| 3 | Landscape design: bed planting plans, orchard records, greenhouse, pond, plant library, sourced companion planting | ✅ done (v0.2) |
| 4 | Environment: sun position, real shadow projection, seasonal comparison, night sky | ✅ done (v0.3) |
| 5 | Smart home: Home Assistant, MQTT, outlets, sensors, cameras, automation editor | ✅ done (v0.4) |
| 6 | Management: tasks, maintenance, documents, photos, weather, reports | planned |
| 7 | Polish: performance, installer, further docs | planned |

Known limitations of v0.4.0: no ONVIF discovery, recording or motion detection for cameras; automations are simple rules (one trigger, a few conditions, device and log actions) running on the EDEN server only while it runs; MQTT and ffmpeg/RTSP paths are covered by unit tests with fakes but have not been run against real hardware; **no login, so in LAN mode anyone on your network can operate your devices** (keep EDEN on `127.0.0.1` unless your network is trusted); roofs in 3D and in the shadow model are flat boxes (no gable geometry); there is no terrain elevation, so hills and neighbouring buildings outside your property cast no shade; foliage light transmission and greenhouse glazing are estimates; the night sky shows about 100 stars and five planets (no deep-sky objects, satellites or cloud forecast; planets ±1°); the plant library has no photographs and only about a hundred plants; pollination checks use species and variety names, not full cultivar pollination groups; GeoTIFF is not read directly (use PNG/JPEG + world file); single user, no authentication; touch use is supported but has only been tested with emulated input.

## License

No license has been chosen yet; until one is added, all rights are reserved by the author.
