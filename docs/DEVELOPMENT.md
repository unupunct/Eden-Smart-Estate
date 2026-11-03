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
  migrations/        0001_init.sql, …
frontend/           React + TypeScript + Vite
  src/model/         types, kind catalog, store (undo/redo), autosave, app state
  src/geo/           measurements, transforms, image calibration
  src/map/           MapLibre controller, layers, interaction, label/overlay support
  src/panels/        editor UI (top bar, left/right panels, dialogs)
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
| Backend | `backend\.venv\Scripts\python -m pytest` (in `backend/`) | CRUD, validation, change sets, import/export round trips, overlays, backup/restore, settings & key secrecy, migrations, **plant-library integrity** (ids, references, evidence labels, warnings, demo contract) |
| Frontend unit | `npx vitest run` (in `frontend/`) | measurements, transforms, vertex editing, calibration maths, undo/redo, layers, autosave diff, feature building, catalog ↔ backend consistency, **companion levels, bed analysis, neighbour checks, pollination, orchard grid, greenhouse box, pond volume, fish verdicts, water ranges** |
| Type check | `npx tsc --noEmit` | strict TypeScript |
| End-to-end | `npm run build && npm run e2e` | real Edge/Chrome via `playwright-core`; each suite starts its own server on a temp data dir. `e2e/interact.mjs`: draws, edits, drags, undoes, calibrates an image, switches 2D/3D, reloads and checks persistence. `e2e/design.mjs`: planting conflicts, library → Add to property, companion links, orchard grid + undo, pollination, pond warnings, module pages, mushroom safety. Needs Microsoft Edge (or change `channel` in the script). |

## Screenshots

`npm run screenshots` (in `frontend/`, after `npm run build`) regenerates `docs/screenshots` from a fresh temporary data folder containing only the fictional demo estate — no personal data can appear.

## Release package

`scripts\package.ps1 -Version 0.2.0` builds `release\EdenSmartEstate-0.2.0.zip` (built web app + backend source + scripts + docs).

## Extending

**New object kind** — add one entry to `KINDS` in `frontend/src/model/kinds.ts` (geometry, layer key, colours, presets, fields) and one line to `KIND_LAYER` in `backend/app/layers.py`. The unit test `kind catalog vs backend` fails if they disagree. No schema change needed.

**New layer** — add a row to `DEFAULT_LAYERS` (`backend/app/layers.py`) and to `LAYER_DEFAULT_COLORS` (`frontend/src/model/ops.ts`). Existing properties keep their layers; add a migration if existing properties should receive it.

**Plant data** — add entries to `backend/app/library_plants.py` (`P(...)`) or `library_other.py` (`A`, `M`, `FISH`, `C`). Every companion pair needs an evidence level (`documented` only when research or consistent agronomy guidance supports it; otherwise `mixed` or `traditional`). `pytest tests/test_library.py` checks ids, references, warnings and evidence rules.

**Database change** — add `backend/migrations/0002_something.sql`. It runs once at start-up. Keep SQL portable (text ids, no SQLite-only syntax) so the PostgreSQL move stays easy.

**Imagery provider** — see *API → Adding another provider*.

**Conventions** — immutable store updates (history and autosave rely on object identity), geographic coordinates only in stored data, measurements through `geo/measure.ts` / `geo.py`, never fabricate live data.
