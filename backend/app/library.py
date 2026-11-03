"""Plant, mushroom, aquatic and companion data served to the frontend (read-only, bundled with the app)."""
from .library_other import AQUATIC, COMPANIONS, FISH, MUSHROOMS, WATER_QUALITY
from .library_plants import PLANTS

VERSION = "2026.11-starter"

DISCLAIMERS = {
    "data": "A curated starter data set written from general horticultural and botanical knowledge. It is not exhaustive or citation-backed: "
            "check important details with local sources (agricultural extension service, botanical garden, nursery).",
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


def payload() -> dict:
    return dict(version=VERSION, disclaimers=DISCLAIMERS, plants=PLANTS, aquatic=AQUATIC, fish=FISH, mushrooms=MUSHROOMS,
                companions=COMPANIONS, waterQuality=WATER_QUALITY)
