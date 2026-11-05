"""Runtime configuration. Everything user-owned lives under DATA_DIR."""
import os
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DATA_DIR = Path(os.environ.get("EDEN_DATA_DIR", ROOT / "data")).resolve()
DB_PATH = DATA_DIR / "eden.db"
UPLOAD_DIR = DATA_DIR / "uploads"
BACKUP_DIR = DATA_DIR / "backups"
MIGRATIONS_DIR = Path(__file__).resolve().parents[1] / "migrations"
FRONTEND_DIST = ROOT / "frontend" / "dist"
GEOCODER_URL = os.environ.get("EDEN_GEOCODER_URL", "https://nominatim.openstreetmap.org/search")
USER_AGENT = "EdenSmartEstate/1.3 (+https://github.com/unupunct/Eden-Smart-Estate; self-hosted property editor)"
MAX_UPLOAD_BYTES = 40 * 1024 * 1024
PASSWORD = os.environ.get("EDEN_PASSWORD", "")  # empty = no login (local-only default)
WEATHER_URL = os.environ.get("EDEN_WEATHER_URL", "https://api.open-meteo.com/v1/forecast")
ELEVATION_URL = os.environ.get("EDEN_ELEVATION_URL", "https://api.open-meteo.com/v1/elevation")
WIKI_SUMMARY_URL = os.environ.get("EDEN_WIKI_SUMMARY_URL", "https://en.wikipedia.org/api/rest_v1/page/summary/{title}")
COMMONS_API_URL = os.environ.get("EDEN_COMMONS_API_URL", "https://commons.wikimedia.org/w/api.php")
WIKIMEDIA_EXTRA_HOSTS = {h for h in os.environ.get("EDEN_WIKIMEDIA_HOSTS", "").split(",") if h}  # only for tests against a stand-in server
OVERPASS_URL = os.environ.get("EDEN_OVERPASS_URL", "")  # empty: the public servers below, in order; set it to use your own
OVERPASS_PUBLIC = ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter", "https://overpass.private.coffee/api/interpreter"]


def overpass_urls() -> list[str]:
    return [OVERPASS_URL] if OVERPASS_URL else OVERPASS_PUBLIC
TERRARIUM_URL = os.environ.get("EDEN_TERRARIUM_URL", "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png")
POLL_SECONDS = float(os.environ.get("EDEN_POLL_SECONDS", "15"))  # 0 disables the background poller


def ensure_dirs() -> None:
    for p in (DATA_DIR, UPLOAD_DIR, BACKUP_DIR):
        p.mkdir(parents=True, exist_ok=True)
