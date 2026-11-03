"""GeoJSON / KML / CSV / project-JSON export and GeoJSON / KML import."""
import csv
import io
import json
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape

from . import geo

POINT_KINDS_DEFAULT = {"Point": "note", "LineString": "path", "Polygon": "zone"}
KML_NS = "{http://www.opengis.net/kml/2.2}"


def to_geojson(model: dict) -> dict:
    layers = {l["id"]: l for l in model["layers"]}
    feats = []
    for o in model["objects"]:
        m = geo.measure(o["geometry"])
        feats.append({
            "type": "Feature", "id": o["id"], "geometry": o["geometry"],
            "properties": {**o["props"], "id": o["id"], "kind": o["kind"], "name": o["name"],
                           "layer": layers.get(o["layerId"], {}).get("name", ""),
                           "area_m2": round(m["area_m2"], 2), "length_m": round(m["length_m"], 2)}})
    return {"type": "FeatureCollection",
            "name": model["property"]["name"], "features": feats}


def to_csv(model: dict) -> str:
    layers = {l["id"]: l["name"] for l in model["layers"]}
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["id", "kind", "layer", "name", "geometry", "lng", "lat", "area_m2", "perimeter_or_length_m",
                "status", "description"])
    for o in model["objects"]:
        lng, lat = geo.centroid(o["geometry"])
        m = geo.measure(o["geometry"])
        w.writerow([o["id"], o["kind"], layers.get(o["layerId"], ""), o["name"], o["geometry"]["type"],
                    f"{lng:.7f}", f"{lat:.7f}", f"{m['area_m2']:.2f}", f"{m['length_m']:.2f}",
                    o["props"].get("status", ""), o["props"].get("description", "")])
    return buf.getvalue()


def _kml_coords(pts) -> str:
    return " ".join(f"{p[0]:.8f},{p[1]:.8f},0" for p in pts)


def to_kml(model: dict) -> str:
    out = ['<?xml version="1.0" encoding="UTF-8"?>',
           '<kml xmlns="http://www.opengis.net/kml/2.2"><Document>',
           f"<name>{escape(model['property']['name'])}</name>"]
    for o in model["objects"]:
        g = o["geometry"]
        if g["type"] == "Point":
            geom = f"<Point><coordinates>{_kml_coords([g['coordinates']])}</coordinates></Point>"
        elif g["type"] == "LineString":
            geom = f"<LineString><coordinates>{_kml_coords(g['coordinates'])}</coordinates></LineString>"
        else:
            inner = "".join(f"<innerBoundaryIs><LinearRing><coordinates>{_kml_coords(r)}</coordinates></LinearRing></innerBoundaryIs>"
                            for r in g["coordinates"][1:])
            geom = (f"<Polygon><outerBoundaryIs><LinearRing><coordinates>{_kml_coords(g['coordinates'][0])}"
                    f"</coordinates></LinearRing></outerBoundaryIs>{inner}</Polygon>")
        desc = escape(str(o["props"].get("description", "")))
        out.append(f"<Placemark><name>{escape(o['name'])}</name><description>{desc}</description>"
                   f"<ExtendedData><Data name=\"kind\"><value>{escape(o['kind'])}</value></Data></ExtendedData>{geom}</Placemark>")
    out.append("</Document></kml>")
    return "".join(out)


def _close(ring):
    ring = [list(p[:2]) for p in ring]
    if ring and ring[0] != ring[-1]:
        ring.append(ring[0])
    return ring


def _norm_geom(g: dict) -> list[dict]:
    """Flatten Multi* geometries into the three supported types; drop unsupported ones."""
    t, c = g.get("type"), g.get("coordinates")
    if t == "Point":
        return [{"type": "Point", "coordinates": c[:2]}]
    if t == "LineString":
        return [{"type": "LineString", "coordinates": [p[:2] for p in c]}]
    if t == "Polygon":
        return [{"type": "Polygon", "coordinates": [_close(r) for r in c]}]
    if t == "MultiPoint":
        return [{"type": "Point", "coordinates": p[:2]} for p in c]
    if t == "MultiLineString":
        return [{"type": "LineString", "coordinates": [p[:2] for p in line]} for line in c]
    if t == "MultiPolygon":
        return [{"type": "Polygon", "coordinates": [_close(r) for r in poly]} for poly in c]
    return []


def parse_geojson(text: str) -> list[dict]:
    data = json.loads(text)
    feats = data["features"] if data.get("type") == "FeatureCollection" else [data] if data.get("type") == "Feature" else [{"type": "Feature", "geometry": data, "properties": {}}]
    out = []
    for f in feats:
        props = dict(f.get("properties") or {})
        for geom in _norm_geom(f.get("geometry") or {}):
            out.append({"name": str(props.get("name") or ""), "kind": props.get("kind"), "geometry": geom,
                        "props": {k: v for k, v in props.items() if k not in ("id", "kind", "name", "layer", "area_m2", "length_m")}})
    return out


def _parse_coords(text: str) -> list[list[float]]:
    pts = []
    for tok in (text or "").split():
        parts = tok.split(",")
        if len(parts) >= 2:
            pts.append([float(parts[0]), float(parts[1])])
    return pts


def parse_kml(text: str) -> list[dict]:
    root = ET.fromstring(text)
    out = []
    for pm in root.iter(f"{KML_NS}Placemark"):
        name = (pm.findtext(f"{KML_NS}name") or "").strip()
        desc = (pm.findtext(f"{KML_NS}description") or "").strip()
        kind = None
        for d in pm.iter(f"{KML_NS}Data"):
            if d.get("name") == "kind":
                kind = d.findtext(f"{KML_NS}value")
        props = {"description": desc} if desc else {}
        for el in pm.iter(f"{KML_NS}Point"):
            pts = _parse_coords(el.findtext(f"{KML_NS}coordinates"))
            if pts:
                out.append({"name": name, "kind": kind, "geometry": {"type": "Point", "coordinates": pts[0]}, "props": props})
        for el in pm.iter(f"{KML_NS}LineString"):
            pts = _parse_coords(el.findtext(f"{KML_NS}coordinates"))
            if len(pts) >= 2:
                out.append({"name": name, "kind": kind, "geometry": {"type": "LineString", "coordinates": pts}, "props": props})
        for el in pm.iter(f"{KML_NS}Polygon"):
            rings = []
            outer = el.find(f"{KML_NS}outerBoundaryIs/{KML_NS}LinearRing/{KML_NS}coordinates")
            if outer is not None:
                rings.append(_close(_parse_coords(outer.text)))
            for inner in el.findall(f"{KML_NS}innerBoundaryIs/{KML_NS}LinearRing/{KML_NS}coordinates"):
                rings.append(_close(_parse_coords(inner.text)))
            if rings and len(rings[0]) >= 4:
                out.append({"name": name, "kind": kind, "geometry": {"type": "Polygon", "coordinates": rings}, "props": props})
    return out
