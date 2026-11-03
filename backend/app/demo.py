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
        status="good", description="Polycarbonate greenhouse, ridge along its long side.", doors=1, vents=2,
        tempMin=12, tempMax=28, humMin=50, humMax=80, soilMin=40, soilMax=70)
    gx, gy = -36, 6
    for i in range(2):
        add("gh_bed", f"Greenhouse bed {i + 1}", poly(rect(gx - 2.4 + i * 4.8, gy, 3.4, 4.6)),
            crops="Tomatoes" if i == 0 else "Peppers, aubergine", soil="Compost and loam")
    add("gh_shelf", "Seedling shelf", poly(rect(gx + 0.0, gy + 2.5, 8, 0.7)), tiers=3)
    add("gh_door", "Greenhouse door", pt(gx + 6.0, gy - 0.5), width=0.9)
    add("gh_vent", "Roof vent 1", pt(gx - 3, gy + 1.5), ventType="roof", width=0.8)
    add("gh_vent", "Roof vent 2", pt(gx + 3, gy + 1.5), ventType="roof", width=0.8)
    add("gh_heater", "Frost heater", pt(gx + 5, gy + 2.2), powerKw=2.0, fuel="electric", connection="not_connected")
    add("gh_fan", "Circulation fan", pt(gx - 5, gy - 2.2), airflow=600, connection="not_connected")
    add("gh_irrigation", "Drip line", pt(gx, gy - 2.2), irrigationType="drip", connection="not_connected")
    add("gh_tank", "Rain-water tank", pt(gx - 8.5, gy + 4), litres=500)

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
            sid = {"Apple": "apple", "Pear": "pear", "Plum": "plum", "Cherry": "cherry", "Walnut": "walnut"}[sp]
            extra = {"pruning": [{"date": "2026-02-18", "note": "Winter prune, removed crossing branches (demo entry)"}]} if sp == "Apple" else {}
            add("tree", f"{sp} {n + 1}", pt(x, y), speciesId=sid, species=sp, variety=var, canopy=canopy * 0.7,
                height=canopy * 0.9, plantedYear=2014 + (n % 4),
                category="nut_tree" if sp == "Walnut" else "fruit_tree", status="good", **extra)
            n += 1

    # vegetable garden
    add("zone", "Vegetable garden", poly(rect(-38, -2, 22, 14, -8)), zoneType="vegetable_garden",
        description="Fenced kitchen garden.")
    plans = [
        [("tomato", 8, 50), ("basil", 10, 25), ("marigold", 12, 25)],
        [("carrot", 160, 5), ("onion", 60, 10)],
        [("cabbage", 8, 50), ("dill", 6, 20), ("nasturtium", 6, 30)],
        [("bean", 30, 10), ("sweetcorn", 12, 30), ("pumpkin", 2, 150)],
        [("potato", 20, 35), ("tomato", 4, 50)],  # deliberate: same-family conflict, shows the red warning
    ]
    for i in range(5):
        add("garden_bed", f"Bed {i + 1}", poly(rect(-46 + i * 4.4, -2, 1.6, 10, -8)), bedType="raised",
            soil="loam", mulch=True, irrigation="drip", description="Raised bed, 1.6 x 10 m. Demo planting plan.",
            plantings=[{"speciesId": s, "count": c, "spacing": sp} for s, c, sp in plans[i]])

    # pond
    add("pond", "Natural swimming pond", poly(blob(38, -26, 11, 7, 18, 0.12, rot=-15)), maxDepth=2.2, natural=True, status="good",
        description="Natural swimming pond with separate regeneration zone.",
        fish=[{"speciesId": "stickleback", "qty": 12, "introduced": "2025-05-10"},
              {"speciesId": "rudd", "qty": 4, "introduced": "2025-05-10"},
              {"speciesId": "goldfish", "qty": 3, "introduced": "2024-06-01", "note": "demo: shows an unsuitable-species warning"}],
        waterLog=[{"date": "2026-05-12", "tempC": 16.0, "ph": 7.6, "oxygen": 8.2, "ammonia": 0.02, "nitrite": 0.01, "nitrate": 4},
                  {"date": "2026-06-20", "tempC": 22.5, "ph": 8.1, "oxygen": 7.0, "ammonia": 0.05, "nitrite": 0.02, "nitrate": 6},
                  {"date": "2026-07-25", "tempC": 27.5, "ph": 8.7, "oxygen": 4.6, "ammonia": 0.1, "nitrite": 0.03, "nitrate": 9}])
    add("pond_pump", "Circulation pump", pt(31, -20), flowLph=4000, powerW=60, connection="not_connected")
    add("pond_filter", "Biofilter", pt(30, -17), filterType="gravel bed")
    add("pond_skimmer", "Skimmer", pt(44, -20))
    add("pond_waterfall", "Waterfall", pt(32, -14.5), drop=0.6)
    add("pond_steps", "Entry steps", pt(28, -27), treads=4)
    for sx, sy in ((47, -23), (49, -26), (30, -31)):
        add("pond_stone", "Boulder", pt(sx, sy))
    add("pond_stream", "Return stream", line([(32, -14.5), (35, -12), (40, -13), (44, -17)]), width=0.5)
    add("pond_zone", "Swimming zone", poly(blob(36, -25, 6, 4, 14, 0.10, rot=-15)), zoneType="swimming", depth=2.0)
    add("pond_zone", "Regeneration zone", poly(blob(49, -29, 4.2, 3, 12, 0.10, rot=-15)), zoneType="regeneration",
        depth=0.4)

    for x, y, sid, nm in [(52, -25, "yellowflag", "Yellow flag iris"), (49, -30, "reedmace", "Lesser reedmace"),
                          (46, -31, "watermint", "Water mint"), (38, -26, "whitelily", "White water-lily"),
                          (42, -27, "hornwort", "Hornwort")]:
        add("plant", nm, pt(x, y), speciesId=sid, species=nm, canopy=0.8, aquatic=True, quantity=1)
    # a small herb-and-vegetable corner: the library knows how these four get along
    for x, y, sid, nm in [(-24, 16, "tomato", "Tomato"), (-23.2, 16.4, "basil", "Basil"), (-24.9, 15.3, "marigold", "French marigold"),
                          (-22.8, 14.6, "potato", "Potato")]:
        add("plant", nm, pt(x, y), speciesId=sid, species=nm, canopy=0.5, height=0.6, quantity=1)
    add("plant", "Lavender", pt(-4, 18), speciesId="lavender", species="Lavender", canopy=0.5, height=0.6, quantity=3)
    add("plant", "Comfrey (sterile)", pt(-48, -22), speciesId="comfrey", species="Comfrey", canopy=0.8, height=1.0, quantity=1)

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
    ids = {"Linden": "linden", "Oak": "oak", "Birch": "birch", "Spruce": "spruce", "Ash": "ash", "Maple": "fieldmaple"}
    for i, (x, y, sp, c) in enumerate([(-30, 40, "Linden", 8), (4, 45, "Oak", 9), (30, 52, "Birch", 5),
                                       (60, 4, "Spruce", 4), (62, 28, "Spruce", 4), (-58, 30, "Ash", 7),
                                       (-4, -8, "Maple", 6)]):
        add("tree", f"{sp} {i + 1}", pt(x, y), speciesId=ids[sp], species=sp, canopy=c, height=c * 1.3,
            category="ornamental_tree", status="good")
    bush_ids = {"Hazel": "hazelnut", "Elder": "elder", "Currant": "blackcurrant", "Rose": "rosehip"}
    for i, (x, y, sp) in enumerate([(-24, 22, "Lilac"), (-3, 24, "Hydrangea"), (8, 38, "Rose"),
                                    (24, 40, "Hazel"), (-20, 36, "Elder"), (2, -22, "Currant")]):
        extra = {"speciesId": bush_ids[sp]} if sp in bush_ids else {}
        add("bush", f"{sp} {i + 1}", pt(x, y), species=sp, canopy=1.8, height=1.6, status="good", **extra)

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
