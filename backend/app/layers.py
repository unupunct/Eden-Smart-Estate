"""Default layer set created for every new property. Keys are referenced by the frontend kind catalog."""

DEFAULT_LAYERS = [
    # key, name, group, color
    ("boundary", "Property boundary", "Land", "#ffd166"),
    ("zones", "Zones & areas", "Land", "#9ad17a"),
    ("buildings", "Buildings", "Structures", "#f4a261"),
    ("greenhouse", "Greenhouse", "Structures", "#7bdff2"),
    ("fences", "Fences", "Structures", "#c9a27a"),
    ("roads", "Roads & paths", "Structures", "#b8b8b0"),
    ("trees", "Trees", "Vegetation", "#4cc38a"),
    ("bushes", "Bushes", "Vegetation", "#7ccf6e"),
    ("garden_beds", "Garden beds", "Vegetation", "#8bd450"),
    ("pond", "Pond", "Water", "#4aa8ff"),
    ("water_infra", "Water infrastructure", "Water", "#3b82f6"),
    ("electrical", "Electrical infrastructure", "Utilities & smart", "#facc15"),
    ("cameras", "Cameras", "Utilities & smart", "#f87171"),
    ("outlets", "Smart outlets", "Utilities & smart", "#fb923c"),
    ("lighting", "Lighting", "Utilities & smart", "#fde68a"),
    ("solar", "Solar installations", "Utilities & smart", "#38bdf8"),
    ("notes", "Notes & annotations", "Annotations", "#e5e7eb"),
]

# kind -> default layer key (mirrors frontend/src/model/kinds.ts)
KIND_LAYER = {
    "boundary": "boundary", "zone": "zones", "orchard_area": "zones", "forest": "zones", "utility_area": "zones",
    "building": "buildings", "greenhouse": "greenhouse", "garden_bed": "garden_beds", "pond": "pond",
    "pond_zone": "pond", "solar": "solar",
    "fence": "fences", "hedge": "fences", "road": "roads", "path": "roads", "drainage": "water_infra",
    "water_pipe": "water_infra", "irrigation": "water_infra", "cable": "electrical",
    "tree": "trees", "bush": "bushes", "plant": "garden_beds", "note": "notes", "gate": "fences",
    "camera": "cameras", "outlet": "outlets", "light": "lighting", "well": "water_infra", "sensor": "electrical",
}
GEOMETRY_DEFAULT_KIND = {"Point": "note", "LineString": "path", "Polygon": "zone"}
