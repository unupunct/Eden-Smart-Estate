# Changelog

All notable changes. Versions follow the build phases of the project; 1.0.0 completes the original plan.

## 1.0.0: polish, security and installer (Phase 7)

- **Windows installer:** `Install-EDEN.cmd` installs for the current user without administrator rights: program and Python environment in `%LOCALAPPDATA%\EDEN\app`, **data kept separately** in `...\EDEN\data`, Start Menu entries, an entry in *Installed apps*, optional autostart and desktop icon. Re-running it updates and keeps data. An uninstaller (keeps data unless you type `DELETE`) and an automated setup test (`scripts\test-setup.ps1`) are included.
- **Optional password protection:** `-Lan` now requires a password; `EDEN_PASSWORD` / `-Password` also protects local use. Signed HttpOnly SameSite=Strict cookie, lock-out after repeated failures, cross-site write protection, sign-in screen and *Sign out*.
- **Faster start:** the first-load script shrank from 1.3 MB to about 190 kB: each page loads on demand and the map engine only when a map page opens. A 3000-object benchmark guards map building, shadows and sun-hours against regressions.
- **Accessibility:** automated axe-core audit of every page (no serious or critical violations), zoom no longer blocked, labelled controls and panels, page headings, visible keyboard focus.
- **Resilience:** a crashing page now shows a message with *Reload* instead of a blank screen; the menu stays usable.
- **Buildings page:** footprint, floors, floor area, services, devices placed inside, open tasks and files per building (the last placeholder module).
- Start script checks that the port is free. New `SECURITY.md`, `docs/TROUBLESHOOTING.md`, rewritten install guide.

## 0.5.0: tasks, documents, weather, reports (Phase 6)

Tasks with repeats and maintenance history; documents and photos per property or object (type + content checks, safe serving, in backups); opt-in Open-Meteo weather with derived frost/rain/wind facts and stale fallback; printable estate report; per-object tasks and attachments.

## 0.4.0: smart home, cameras, automations (Phase 5)

Home Assistant and MQTT integrations with truthful device state (no data until reported, offline marking, read-back after commands, risky-device confirmation); snapshot/MJPEG/RTSP/Home Assistant cameras through the server; automations with dry run, log, cooldown and risk acknowledgement; write-only credentials.

## 0.3.0: sun, shadows, night sky (Phase 4)

Astronomical sun, moon and planet positions; cast shadows from buildings, trees and fences; sun hours per bed and for the whole property across the seasons; light-need warnings; night-sky chart with the moon-free dark window.

## 0.2.0: landscape design and plant library (Phase 3)

Plant library (100 plants, 25 aquatic plants, 10 fish, 26 mushrooms) with evidence-labelled companion planting; garden beds, orchard, greenhouse and natural swimming pond planning.

## 0.1.0: foundation and property editor (Phases 1–2)

Map with configurable imagery providers, object system, drawing and editing tools, layers, measurements, undo/redo, autosave, image calibration, 2D/3D, import/export, backup and restore, demo estate.
