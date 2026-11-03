"""Fictional demonstration estate. Everything here is invented - the property is flagged is_demo and removable."""
import math

from . import db, repo
from .layers import KIND_LAYER
from .models import Geometry, ObjectIn, PropertyCreate

# Open meadow in rural Transylvania, chosen only as a plausible map location (fictional estate).
ORIGIN = (24.05261, 46.04842)
ROT = -8.0  # buildings share one orientation, like a real farmstead


def enu(x: float, y: float) -> list[float]:
    """Metres east/north of ORIGIN -> [lng, lat]."""
    lat = ORIGIN[1] + y / 111320.0
    lng = ORIGIN[0] + x / (111320.0 * math.cos(math.radians(ORIGIN[1])))
    return [round(lng, 8), round(lat, 8)]


def poly(pts) -> dict:
    ring = [enu(*p) for p in pts]
    ring.append(ring[0])
    return {"type": "Polygon", "coordinates": [ring]}


def line(pts) -> dict:
    return {"type": "LineString", "coordinates": [enu(*p) for p in pts]}


def pt(x, y) -> dict:
    return {"type": "Point", "coordinates": enu(x, y)}


def rect(cx, cy, w, h, rot=ROT) -> list[tuple[float, float]]:
    a = math.radians(rot)
    out = []
    for dx, dy in ((-w / 2, -h / 2), (w / 2, -h / 2), (w / 2, h / 2), (-w / 2, h / 2)):
        out.append((cx + dx * math.cos(a) - dy * math.sin(a), cy + dx * math.sin(a) + dy * math.cos(a)))
    return out


def blob(cx, cy, rx, ry, n=14, wobble=0.18, rot=0.0) -> list[tuple[float, float]]:
    out = []
    for i in range(n):
        t = 2 * math.pi * i / n
        k = 1 + wobble * math.sin(3 * t + 1) + wobble * 0.6 * math.cos(2 * t)
        x, y = rx * k * math.cos(t), ry * k * math.sin(t)
        r = math.radians(rot)
        out.append((cx + x * math.cos(r) - y * math.sin(r), cy + x * math.sin(r) + y * math.cos(r)))
    return out


def build_demo(conn) -> dict:
    prop = repo.create_property(
        conn, PropertyCreate(name="DEMO - Eden Hollow (fictional estate)",
                             description="Demonstration data. Nothing here describes a real property, device or sensor. "
                                         "Delete this property to start your own.",
                             center=(ORIGIN[0], ORIGIN[1] + 0.0002), zoom=17.9), is_demo=True)
    pid = prop["id"]
    layers = {r["key"]: r["id"] for r in conn.execute("SELECT id,key FROM map_layers WHERE property_id=?", (pid,))}

    def add(kind, name, geometry, **props):
        props.setdefault("demo", True)
        repo._upsert_object(conn, pid, ObjectIn(id=db.new_id(), layerId=layers[KIND_LAYER[kind]], kind=kind, name=name,
                                               geometry=Geometry(**geometry), props=props))

    boundary = [(-70, -55), (72, -62), (82, 38), (28, 70), (-62, 58), (-80, 4)]
    add("boundary", "Estate boundary", poly(boundary), description="Fictional parcel, about 1.9 ha.")

    # buildings
    add("building", "Main house", poly(rect(-14, 28, 16, 9)), buildingType="main_house", floors=2, height=7.5,
        roofType="gable", roofOrientation=ROT, material="plaster", constructionYear=2008, status="good",
        description="Two-storey family house.", orientation=ROT)
    add("building", "Guest house", poly(rect(16, 33, 9, 7)), buildingType="guest_house", floors=1, height=4.2,
        roofType="hip", roofOrientation=ROT, material="timber", constructionYear=2015, status="good", orientation=ROT)
    add("building", "Workshop", poly(rect(42, 16, 12, 8)), buildingType="workshop", floors=1, height=4.0,
        roofType="shed", roofOrientation=ROT, material="metal", status="fair", orientation=ROT)
    add("building", "Chicken coop", poly(rect(55, 42, 4, 3)), buildingType="chicken_coop", floors=1, height=2.2,
        roofType="shed", material="timber", status="needs_attention", orientation=ROT)
    add("greenhouse", "Greenhouse 1", poly(rect(-36, 6, 12, 6)), height=3.2, roofType="gable", orientation=ROT,
        status="good", description="Polycarbonate greenhouse, ridge along its long side.")

    # orchard
    add("orchard_area", "Orchard", poly([(-62, -46), (-8, -50), (-6, -14), (-60, -10)]),
        description="Mixed fruit orchard, 8 m spacing.")
    species = [("Apple", "Jonathan", 4.5), ("Pear", "Williams", 4.0), ("Plum", "Stanley", 3.5), ("Cherry", "Van", 4.5),
               ("Apple", "Golden Delicious", 4.5), ("Walnut", "", 7.0)]
    n = 0
    for row in range(3):
        for col in range(6):
            sp, var, canopy = species[(row * 2 + col) % len(species)]
            x, y = -54 + col * 9, -40 + row * 9 + col * 0.35
            add("tree", f"{sp} {n + 1}", pt(x, y), species=sp, variety=var, canopy=canopy, height=canopy * 0.9,
                plantedYear=2014 + (n % 4), category="fruit_tree", status="good")
            n += 1

    # vegetable garden
    add("zone", "Vegetable garden", poly(rect(-38, -2, 22, 14, -8)), zoneType="vegetable_garden",
        description="Fenced kitchen garden.")
    for i in range(5):
        add("garden_bed", f"Bed {i + 1}", poly(rect(-46 + i * 4.4, -2, 1.6, 10, -8)), bedType="raised",
            soil="loam", mulch=True, irrigation="drip", description="Raised bed, 1.6 x 10 m.")

    # pond
    add("pond", "Natural swimming pond", poly(blob(38, -26, 11, 7, 18, 0.12, rot=-15)), maxDepth=2.2, status="good",
        description="Natural swimming pond with separate regeneration zone.")
    add("pond_zone", "Swimming zone", poly(blob(36, -25, 6, 4, 14, 0.10, rot=-15)), zoneType="swimming", depth=2.0)
    add("pond_zone", "Regeneration zone", poly(blob(49, -29, 4.2, 3, 12, 0.10, rot=-15)), zoneType="regeneration",
        depth=0.4)

    # fences, gate, roads, paths
    ring = [enu(*p) for p in boundary]
    add("fence", "Perimeter fence", {"type": "LineString", "coordinates": ring + [ring[0]]}, fenceType="wood",
        height=1.6, color="#c9a27a", sectionLength=2.5, status="good", description="Wooden fence on the estate boundary.")
    add("fence", "Garden fence", line([(-49.5, 6), (-26.5, 4.2), (-27.5, -8.4), (-50.6, -6.7), (-49.5, 6)]),
        fenceType="wire_mesh", height=1.8, sectionLength=3.0, status="good")
    add("hedge", "Hedge", line([(-62, 58), (-20, 62), (28, 70)]), height=2.0, status="good")
    add("gate", "Main gate", pt(1, -59), width=4.5, gateType="double", status="good")
    add("road", "Driveway", line([(1, -59), (2, -35), (-4, 0), (-8, 18)]), surface="gravel", width=4)
    add("path", "Path to guest house", line([(-8, 20), (4, 28), (12, 30)]), surface="paving", width=1.2)
    add("path", "Path to greenhouse", line([(-8, 14), (-24, 10), (-30, 8)]), surface="gravel", width=1.0)
    add("path", "Path to workshop", line([(0, 6), (22, 12), (36, 14)]), surface="gravel", width=1.2)

    # infrastructure
    add("water_pipe", "Water main", line([(-14, 22), (-14, 8), (-30, 4), (-38, 0)]), diameterMm=32, material="PE")
    add("cable", "Power to workshop", line([(-14, 22), (10, 18), (36, 14)]), cableType="underground")

    # trees & bushes around the buildings
    for i, (x, y, sp, c) in enumerate([(-30, 40, "Linden", 8), (4, 45, "Oak", 9), (30, 52, "Birch", 5),
                                       (60, 4, "Spruce", 4), (62, 28, "Spruce", 4), (-58, 30, "Ash", 7),
                                       (-4, -8, "Maple", 6)]):
        add("tree", f"{sp} {i + 1}", pt(x, y), species=sp, canopy=c, height=c * 1.3, category="ornamental_tree",
            status="good")
    for i, (x, y, sp) in enumerate([(-24, 22, "Lilac"), (-3, 24, "Hydrangea"), (8, 38, "Rose"),
                                    (24, 40, "Hazel"), (-20, 36, "Elder"), (2, -22, "Currant")]):
        add("bush", f"{sp} {i + 1}", pt(x, y), species=sp, canopy=1.8, height=1.6, status="good")

    # smart-home placeholders: positions only, nothing is connected
    add("outlet", "Workshop outlet", pt(38, 20), deviceId="", connection="not_connected", building="Workshop")
    add("outlet", "Greenhouse outlet", pt(-31, 3), deviceId="", connection="not_connected", building="Greenhouse 1")
    add("outlet", "Pond pump outlet", pt(30, -20), deviceId="", connection="not_connected")
    add("camera", "Front gate camera", pt(3, -56), direction=20, fov=90, range=35, connection="not_connected")
    add("camera", "Yard camera", pt(-4, 35), direction=170, fov=100, range=30, connection="not_connected")
    add("sensor", "Greenhouse climate sensor", pt(-36, 6), sensorType="temperature_humidity", connection="not_connected")
    add("light", "Driveway light", pt(5, -30), connection="not_connected")
    add("light", "Terrace light", pt(-2, 20), connection="not_connected")
    add("note", "Pond filter check", pt(52, -22), description="Clean skimmer basket every two weeks in summer.")
    add("note", "Future solar array", pt(58, 20), description="South-facing roof of the workshop is a candidate.")
    return repo.get_property(conn, pid)
