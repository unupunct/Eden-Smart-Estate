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
USER_AGENT = "EdenSmartEstate/0.1 (self-hosted property editor)"
MAX_UPLOAD_BYTES = 40 * 1024 * 1024
WEATHER_URL = os.environ.get("EDEN_WEATHER_URL", "https://api.open-meteo.com/v1/forecast")
POLL_SECONDS = float(os.environ.get("EDEN_POLL_SECONDS", "15"))  # 0 disables the background poller


def ensure_dirs() -> None:
    for p in (DATA_DIR, UPLOAD_DIR, BACKUP_DIR):
        p.mkdir(parents=True, exist_ok=True)
