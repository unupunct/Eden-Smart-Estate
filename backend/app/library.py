"""Plant, mushroom, aquatic and companion data served to the frontend (read-only, bundled with the app)."""
import json
from pathlib import Path

from . import library_plants_more  # noqa: F401  (adds its plants to PLANTS when imported)
from .library_other import AQUATIC, COMPANIONS, FISH, MUSHROOMS, WATER_QUALITY
from .library_plants import PLANTS

VERSION = "2026.11-v1.3"

DISCLAIMERS = {
    "data": "Names are checked, growing advice is not: scientific names, accepted status, family and whether a plant is native or introduced in Romania "
            "were checked against GBIF (open biodiversity data, see each entry). Everything about growing (heights, spacing, months, soil, uses) is hand-curated "
            "from general horticultural and botanical knowledge, not cited value by value, and it is a starter set. "
            "Check important details with local sources (agricultural extension service, botanical garden, nursery).",
    "evidence": {
        "documented": "Supported by research or consistent agronomy guidance with an understood mechanism.",
        "mixed": "Some trials or reports support it, but results are inconsistent or depend on context.",
        "traditional": "Gardening tradition with little or no controlled evidence.",
    },
    "medicinal": "Medicinal entries describe TRADITIONAL use only. They are not evidence of effectiveness or safety and are not medical advice. "
                 "Many plants interact with medicines or are toxic; consult a doctor or pharmacist.",
    "mushrooms": "NEVER eat a wild mushroom because of an app, a list or a photo. Identification needs the whole fresh specimen, spore print and "
                 "an experienced local expert. Several deadly species look like edible ones. Photos are deliberately not included.",
}

# ---- what was checked against GBIF (written by scripts/verify-taxonomy.py)
_TAXA_FILE = Path(__file__).with_name("library_taxa.json")
TAXA: dict = json.loads(_TAXA_FILE.read_text(encoding="utf-8")) if _TAXA_FILE.exists() else {}


def _taxon(group: str, item_id: str) -> dict | None:
    r = (TAXA.get(group) or {}).get(item_id)
    if not r or "gbif" not in r or r.get("rank") not in ("SPECIES", "VARIETY", "SUBSPECIES", "FORM") or r.get("match") not in ("EXACT", "FUZZY"):
        return None
    out = {"gbif": r["gbif"], "name": r["name"], "authorship": r.get("authorship", ""), "family": r.get("family"), "status": r.get("status"),
           "checked": TAXA.get("checkedOn")}
    if r.get("acceptedName"):
        out["acceptedName"] = r["acceptedName"]  # GBIF's accepted name when the library's name is a synonym there
    if "ro" in r:
        ro = r["ro"]
        out["ro"] = {"verdict": ro["verdict"], "native": ro["native"], "introduced": ro["introduced"]}
    return out


for _group, _items in (("plants", PLANTS), ("aquatic", AQUATIC), ("mushrooms", MUSHROOMS), ("fish", FISH)):
    for _it in _items:
        _it["taxon"] = _taxon(_group, _it["id"])


def payload() -> dict:
    return dict(version=VERSION, disclaimers=DISCLAIMERS, plants=PLANTS, aquatic=AQUATIC, fish=FISH, mushrooms=MUSHROOMS,
                companions=COMPANIONS, waterQuality=WATER_QUALITY,
                taxaSource=TAXA.get("source") and {**TAXA["source"], "checkedOn": TAXA.get("checkedOn")})
