# Changelog

All notable changes. Versions follow the build phases of the project; 1.0.0 completes the original plan.

## 1.2.0: admin account, signed installer, terrain, ONVIF, OCR, push

- **Admin account:** exactly one admin (user name + password, stored only as a salted scrypt hash). Created in *Settings → Admin account*; from then on every browser signs in. **Change password** (needs the current one, signs other browsers out) and `scripts\reset-admin.ps1` for a forgotten password. `start.ps1 -Password` / `-Lan` only seed the first account. Replaces the single shared password.
- **Windows installer (.exe):** `EdenSmartEstate-Setup-<version>.exe` (Inno Setup) installs per user without administrator rights and **bundles its own Python** (the official embeddable build, checked against a pinned hash and its signature), so no Python is needed. Updates keep your data; uninstall asks whether to keep it. Optional tasks: desktop shortcut, autostart, OCR engine. The older zip + `Install-EDEN.cmd` route still works.
- **Signing:** installer and uninstaller are Authenticode-signed (SHA-256, RFC 3161 timestamp) by `scripts\sign-file.ps1`; this release is signed with a **self-signed** certificate (thumbprint in `docs/SIGNING.md`), so the signature proves integrity but Windows still shows *Unknown publisher* until a certificate authority's certificate is used. `docs/SIGNING.md` explains how. `SHA256SUMS.txt` is published with every release.
- **Push notifications:** Web Push with VAPID and end-to-end encrypted payloads, daily task digest, a *send a notification* automation action, test button, device list. Verified by decrypting real messages in tests.
- **OCR and document text:** text of Word/Excel/OpenDocument/text files and PDF text layers is searchable; photos and scanned PDFs are read with Tesseract when installed (language data via `scripts\get-ocr-language.ps1`). OCR text is always labelled machine-read.
- **ONVIF:** find cameras on the network (WS-Discovery), log in with WS-Security digest (using the camera's own clock), choose a video profile and add it; only local-network addresses are contacted. Tested against a simulated camera.
- **Terrain (opt-in):** ground height, slope and aspect, and a skyline profile from 90 m Copernicus data via Open-Meteo; hills block the sun in the sun hours; optional elevation tint on the map; last real answer kept.
- Dependencies: `pywebpush`, `pypdf`; `pytest` moved to the development requirements.

## 1.1.0: MIT licence, privacy and fewer limits

- **MIT licence** (`LICENSE`) and `THIRD_PARTY_NOTICES.md` (libraries, data services and their terms).
- **Photo privacy:** GPS position, camera and date details, XMP/IPTC and comments are removed from JPEG and PNG photos on upload (the picture is not re-encoded; orientation is kept). Switchable per upload.
- **HTTPS:** `start.ps1 -Https` serves EDEN over TLS with a self-signed certificate made on your computer (covers localhost, the computer's name and its LAN addresses, renews itself, fingerprint shown at start-up); the session cookie becomes `Secure`. Resolves the plain-HTTP limit of 1.0.
- **Global search (Ctrl+K):** one search over pages, map objects, the plant library (Romanian names without diacritics work), tasks, documents, devices, automations, cameras and integrations.
- **Calendar and reminders:** export open tasks as a calendar file (`.ics`, with repeats and a 09:00 alarm) for your phone's calendar, and optional browser notifications for overdue and due-today tasks.
- **More accurate shadows:** gable, hip and mansard roofs (and shed roofs once their direction is set) now cast their real shape instead of a box; new optional *wall (eave) height* field on buildings.
- **Real-broker MQTT test:** the MQTT integration is now tested against an actual broker with the real client, not only fakes.
- **Setup:** offers to install Python through winget when it is missing.
- With a password set, the interactive API documentation (`/docs`, `/redoc`, `/openapi.json`) needs the session as well.
- Search palette and documents/library pages accept hints from search results; the start script prints the HTTPS fingerprint; tests grew to cover all of the above.

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
