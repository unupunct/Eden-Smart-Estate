# Third-party notices

EDEN Smart Estate itself is released under the [MIT License](LICENSE). It uses the following open-source components and external services. Each keeps its own licence and terms.

## Libraries shipped in the application

| Component | Used for | Licence |
|---|---|---|
| [React](https://react.dev/) 18 | user interface | MIT |
| [MapLibre GL JS](https://maplibre.org/) 5 | map rendering | BSD-3-Clause |
| [Zustand](https://github.com/pmndrs/zustand) | state management | MIT |
| [Lucide](https://lucide.dev/) (lucide-react) | icons | ISC |
| [polygon-clipping](https://github.com/mfogel/polygon-clipping) | merging shadow polygons | MIT |
| [FastAPI](https://fastapi.tiangolo.com/) / [Starlette](https://www.starlette.io/) / [Pydantic](https://docs.pydantic.dev/) | server | MIT / BSD-3-Clause / MIT |
| [Uvicorn](https://www.uvicorn.org/) | web server | BSD-3-Clause |
| [HTTPX](https://www.python-httpx.org/) | outgoing requests | BSD-3-Clause |
| [python-multipart](https://github.com/Kludex/python-multipart) | file uploads | Apache-2.0 |
| [paho-mqtt](https://github.com/eclipse/paho.mqtt.python) | MQTT client | EPL-2.0 OR BSD-3-Clause (used under BSD-3-Clause) |
| [cryptography](https://cryptography.io/) | self-signed HTTPS certificate (optional `-Https`), push encryption keys | Apache-2.0 OR BSD-3-Clause |
| [pywebpush](https://github.com/web-push-libs/pywebpush), [py-vapid](https://github.com/web-push-libs/vapid), [http-ece](https://github.com/web-push-libs/encrypted-content-encoding) | Web Push (push notifications) | MPL-2.0 (pywebpush, py-vapid, http-ece) |
| [pypdf](https://github.com/py-pdf/pypdf) | text of PDF documents | BSD-3-Clause |
| [Requests](https://requests.readthedocs.io/) / [aiohttp](https://docs.aiohttp.org/) | used by pywebpush | Apache-2.0 |

In the Windows installer only: the official **embeddable Python** from python.org (Python Software Foundation License) is bundled; the installer is built with [Inno Setup](https://jrsoftware.org/isinfo.php) (its own licence permits distributing installers it builds).

Development and test tools (Vite, TypeScript, Vitest, Playwright, axe-core, pytest, amqtt) are not part of the release package. axe-core is MPL-2.0; amqtt is MIT.

## Data and services

| Source | Used for | Terms |
|---|---|---|
| Esri World Imagery / Topographic / Reference layers | default satellite, terrain and labels (loaded by your browser) | Esri's terms of use; attribution is always shown. Heavy or commercial use needs your own arrangement. |
| OpenStreetMap | street map tiles; place search through Nominatim | © OpenStreetMap contributors, ODbL; subject to the tile and Nominatim usage policies (light use only) |
| MapTiler (optional, your key) | optional imagery | MapTiler terms; your own key and quota |
| [Open-Meteo](https://open-meteo.com/) | optional weather forecast (off until enabled) | CC BY 4.0; free for non-commercial use: attribution is shown on the Weather page |
| Open-Meteo elevation API, serving **Copernicus DEM GLO-90** | optional terrain (off until enabled) | "Contains Copernicus data" (DEM GLO-90, ESA/EU, free to use with attribution), served by Open-Meteo under CC BY 4.0; attribution is shown in the terrain card |
| [Tesseract OCR](https://github.com/tesseract-ocr/tesseract) (optional, separate install) | reading text in photos and scans | Apache-2.0; EDEN only calls it as a program. Language data from [tessdata_fast](https://github.com/tesseract-ocr/tessdata_fast) (Apache-2.0) when you download it |
| Browser push services (Google, Mozilla, Microsoft, Apple) | delivering push notifications you turned on | their terms; message contents are encrypted end to end |
| Home Assistant, MQTT brokers, cameras | your own devices | your installation |

## Content included in the application

- **Plant, aquatic plant, fish and mushroom library, companion-planting relationships:** a hand-curated starter set written for this project from general horticultural and botanical knowledge, released under the same MIT licence. It is not a citation-backed database; see the notes in the app and the README.
- **Star positions and constellation figures:** factual astronomical data (rounded J2000 coordinates of bright stars) with simplified figures drawn for this project.
- **Planet and moon calculations:** implemented from published algorithms (Meeus; the JPL "approximate positions of the major planets" elements; NOAA solar calculations).
- **Demo estate:** fictional and clearly labelled.
