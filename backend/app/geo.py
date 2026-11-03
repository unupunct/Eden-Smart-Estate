"""Geodesic measurements on the WGS84 sphere. Mirrors frontend/src/geo/measure.ts."""
import math

R_LEN = 6371008.8   # mean earth radius, distances
R_AREA = 6371007.2  # authalic radius: area-true on the sphere (Chamberlain & Duquette formula)


def distance(a, b) -> float:
    la1, la2 = math.radians(a[1]), math.radians(b[1])
    dlat = la2 - la1
    dlng = math.radians(b[0] - a[0])
    h = math.sin(dlat / 2) ** 2 + math.cos(la1) * math.cos(la2) * math.sin(dlng / 2) ** 2
    return 2 * R_LEN * math.asin(min(1.0, math.sqrt(h)))


def line_length(coords) -> float:
    return sum(distance(coords[i], coords[i + 1]) for i in range(len(coords) - 1))


def ring_area(ring) -> float:
    total = 0.0
    for i in range(len(ring) - 1):
        (x1, y1), (x2, y2) = ring[i][:2], ring[i + 1][:2]
        total += math.radians(x2 - x1) * (2 + math.sin(math.radians(y1)) + math.sin(math.radians(y2)))
    return abs(total) * R_AREA * R_AREA / 2


def polygon_area(rings) -> float:
    if not rings:
        return 0.0
    return max(0.0, ring_area(rings[0]) - sum(ring_area(r) for r in rings[1:]))


def centroid(geom) -> tuple[float, float]:
    t, c = geom["type"], geom["coordinates"]
    pts = [c] if t == "Point" else c if t == "LineString" else c[0][:-1]
    return (sum(p[0] for p in pts) / len(pts), sum(p[1] for p in pts) / len(pts))


def measure(geom) -> dict:
    t, c = geom["type"], geom["coordinates"]
    if t == "Polygon":
        return {"area_m2": polygon_area(c), "length_m": line_length(c[0])}
    if t == "LineString":
        return {"area_m2": 0.0, "length_m": line_length(c)}
    return {"area_m2": 0.0, "length_m": 0.0}
