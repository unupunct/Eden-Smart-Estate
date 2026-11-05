# Development

## Layout

```
backend/            FastAPI app (app/), SQL migrations, pytest suite
  app/main.py        app + static hosting of the built frontend
  app/routes.py      REST endpoints
  app/providers.py   map providers, settings, tile proxy
  app/repo.py        persistence;  db.py: connections + migrations
  app/exchange.py    GeoJSON/KML/CSV import-export
  app/demo.py        fictional demo estate
  app/layers.py      default layers + kind→layer map
  app/smart*.py      Home Assistant client, MQTT hub, automation rules, smart-home routes and poller
  app/manage.py      tasks, documents/photos, weather proxy; recurrence.py: repeat maths
  app/auth.py        optional password protection (middleware + sign-in routes)
  app/privacy.py     photo metadata removal;  app/tls.py: self-signed HTTPS certificate
  migrations/        0001_init.sql, …
frontend/           React + TypeScript + Vite
  src/model/         types, kind catalog, store (undo/redo), autosave, app state
  src/geo/           measurements, transforms, image calibration
  src/map/           MapLibre controller, layers, interaction, label/overlay support
  src/panels/        editor UI (top bar, left/right panels, dialogs)
  src/sun/           astronomy, time zones, shadow geometry, sun-hours (pure, unit-tested)
  src/sky/           star list, constellation figures, dome projection
  src/smart/         smart-home types and store (devices, cameras, automations)
  src/manage/        tasks, documents, weather: types, logic, store
  src/reports/       report builder (pure)
  src/search/        global search (pure function + Ctrl+K palette)
  src/library/       library types, logic (companions, beds, orchard, pond)
  src/pages/         overview, module pages, settings
  e2e/               Playwright tests and the screenshot generator
scripts/            install, start, dev, test, package (PowerShell)
docs/               guides and screenshots
```

## Set up

```powershell
powershell -ExecutionPolicy Bypass -File scripts\install.ps1
powershell -ExecutionPolicy Bypass -File scripts\dev.ps1     # API (reload) on :8787 + Vite on :5173
```

Open <http://localhost:5173> (Vite proxies `/api` to the API). Use `EDEN_DATA_DIR` to point a dev server at a scratch data folder.

## Tests

```powershell
powershell -ExecutionPolicy Bypass -File scripts\test.ps1            # everything
powershell -ExecutionPolicy Bypass -File scripts\test.ps1 -SkipE2E   # no browser
```

| Suite | Command | Covers |
|---|---|---|
| Backend | `backend\.venv\Scripts\python -m pytest` (in `backend/`) | CRUD, validation, change sets, **photo metadata removal, calendar export, self-signed HTTPS (including a real TLS handshake), MQTT against a real in-process broker (needs `pip install -r requirements-dev.txt`; skipped otherwise), optional password protection (sessions, forged/expired tokens, lock-out, cross-site writes), tasks, recurrence, documents (type/content/size checks, safe serving, backup round trip), weather (opt-in, cache, stale fallback), smart home (fake Home Assistant/MQTT/cameras: state truthfulness, secrets, risky confirmation, automations engine)**, import/export round trips, overlays, backup/restore, settings & key secrecy, migrations, **plant-library integrity** (ids, references, evidence labels, warnings, demo contract) |
| Frontend unit | `npx vitest run` (in `frontend/`) | measurements, transforms, vertex editing, calibration maths, undo/redo, layers, autosave diff, feature building, catalog ↔ backend consistency, **companion levels, bed analysis, neighbour checks, pollination, orchard grid, greenhouse box, pond volume, fish verdicts, water ranges, sun/moon/planet positions against almanac values, sunrise/sunset, polar day/night, time zones and DST, shadow geometry, foliage density, sun hours, heat grid, star list, sky projection, moon-free window** |
| Type check | `npx tsc --noEmit` | strict TypeScript |
| End-to-end | `npm run build && npm run e2e` | real Edge/Chrome via `playwright-core`; each suite starts its own server on a temp data dir. `e2e/interact.mjs`: draws, edits, drags, undoes, calibrates an image, switches 2D/3D, reloads and checks persistence. `e2e/design.mjs`: planting conflicts, library → Add to property, companion links, orchard grid + undo, pollination, pond warnings, module pages, mushroom safety. `e2e/manage.mjs` also covers photo cleaning, Ctrl+K search, browser notifications and the calendar file. `e2e/auth.mjs`: sign-in screen, wrong password, session cookie flags, sign out, lock-out. `e2e/a11y.mjs`: axe-core on every page (fails on serious/critical). `src/perf.test.ts`: 3000-object benchmark. `e2e/manage.mjs`: weather off by default and opt-in (fake forecast server), frost note and reminder, caching, tasks (overdue, repeat, complete, history), tasks and photos from an object's panel, document upload rules, search, safe serving headers, report content and print view. `e2e/smart.mjs` (with the fixtures in `e2e/fakes.mjs`): connect a fake Home Assistant, wrong token, devices and units, commands and risky confirmation, linking to the map, a rule firing on a real value change, dry run, cooldown, risky-rule acknowledgement, cameras (picture, unreachable, ffmpeg missing), integration going offline. `e2e/sun.mjs`: sun readouts, shadow direction morning/afternoon, no shadows at night, season table, foliage, sun-hours map, editor shadow chip, night-sky chart by night and day, moon facts. Needs Microsoft Edge (or change `channel` in the script). |

## Screenshots

`npm run screenshots` (in `frontend/`, after `npm run build`) regenerates `docs/screenshots` from a fresh temporary data folder containing only the fictional demo estate — no personal data can appear.

## Release package

`scripts\package.ps1 -Version 1.1.0` builds `release\EdenSmartEstate-1.1.0.zip` (built web app + backend source + scripts + docs + `Install-EDEN.cmd` + `VERSION`). `scripts\test-setup.ps1` installs that zip into a temporary folder (`-Portable`), starts it, updates it over itself (data must survive) and uninstalls it; it needs internet for pip and a few minutes, so it is a local check rather than part of CI.

## Extending

**New object kind** — add one entry to `KINDS` in `frontend/src/model/kinds.ts` (geometry, layer key, colours, presets, fields) and one line to `KIND_LAYER` in `backend/app/layers.py`. The unit test `kind catalog vs backend` fails if they disagree. No schema change needed.

**New layer** — add a row to `DEFAULT_LAYERS` (`backend/app/layers.py`) and to `LAYER_DEFAULT_COLORS` (`frontend/src/model/ops.ts`). Existing properties keep their layers; add a migration if existing properties should receive it.

**Plant data** — add entries to `backend/app/library_plants.py` (`P(...)`) or `library_other.py` (`A`, `M`, `FISH`, `C`). Every companion pair needs an evidence level (`documented` only when research or consistent agronomy guidance supports it; otherwise `mixed` or `traditional`). `pytest tests/test_library.py` checks ids, references, warnings and evidence rules.

**Database change** — add `backend/migrations/0002_something.sql`. It runs once at start-up. Keep SQL portable (text ids, no SQLite-only syntax) so the PostgreSQL move stays easy.

**Imagery provider** — see *API → Adding another provider*.

**Conventions** — immutable store updates (history and autosave rely on object identity), geographic coordinates only in stored data, measurements through `geo/measure.ts` / `geo.py`, never fabricate live data.
