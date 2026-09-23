"""Build the hidden lookup data. Requires pyshp, pyproj and shapely.

Usage: python scripts/build-mileage-data.py /path/to/downloaded/shapefiles
The directory must contain NetworkLinks and NetworkWaymarks shp/shx/dbf/prj files.
"""
import json
import math
import sys
from pathlib import Path

import shapefile
from pyproj import Transformer
from shapely.geometry import LineString, Point, shape
from shapely.ops import transform, unary_union
from shapely import make_valid

ROOT = Path(__file__).resolve().parents[1]
SOURCE_COMMIT = "a7c2cece9df7770e68a78cd716604c96ae38cd1a"
to_grid = Transformer.from_crs(4326, 27700, always_xy=True).transform
to_lonlat = Transformer.from_crs(27700, 4326, always_xy=True).transform


def yards(value):
    if value is None or not math.isfinite(value):
        return None
    miles, remainder = f"{abs(value):.4f}".split(".")
    if int(remainder) >= 1760:
        return None
    return (-1 if value < 0 else 1) * (int(miles) * 1760 + int(remainder))


def build(source):
    waymarks = {}
    for item in shapefile.Reader(str(source / "NetworkWaymarks")).iterShapeRecords():
        p = item.record.as_dict()
        value = yards(p["WAYMARK_VA"])
        if p["M_SYSTEM"] == "M" and value is not None:
            waymarks.setdefault(p["ELR"], []).append((Point(item.shape.points[0]), value))

    areas = {}
    results = {}
    for section in sorted((ROOT / "sections").iterdir()):
        geometries = []
        for path in section.glob("*.geojson"):
            data = json.loads(path.read_text())
            geometries.extend(transform(to_grid, shape(f["geometry"]))
                              for f in data["features"] if f.get("geometry"))
        areas[section.name] = unary_union([make_valid(g).buffer(150) for g in geometries])
        results[section.name] = []

    for item in shapefile.Reader(str(source / "NetworkLinks")).iterShapeRecords():
        p = item.record.as_dict()
        start, end = yards(p["L_M_FROM"]), yards(p["L_M_TO"])
        # Do not invent a connection between separate geometry parts.
        if p["L_SYSTEM"] != "M" or start is None or end is None or len(item.shape.parts) != 1:
            continue
        line = LineString(item.shape.points)
        if not line.length:
            continue
        sections = [name for name, area in areas.items() if area.intersects(line)]
        if not sections:
            continue
        anchors = [(0, start), (1, end)]
        direction = 1 if end >= start else -1
        for point, value in waymarks.get(p["ELR"], []):
            if line.distance(point) > 25 or not min(start, end) < value < max(start, end):
                continue
            fraction = line.project(point, normalized=True)
            if 0.000001 < fraction < 0.999999:
                anchors.append((fraction, value))
        anchors.sort()
        # Conflicting anchors may represent a mileage discontinuity or an adjacent
        # route. Leave these links unavailable instead of interpolating across it.
        if any((b[1] - a[1]) * direction <= 0 for a, b in zip(anchors, anchors[1:])):
            if start != end:
                continue
        coords = [[round(x, 7), round(y, 7)] for x, y in
                  (to_lonlat(x, y) for x, y in item.shape.points)]
        link = {"elr": p["ELR"].strip(), "coords": coords,
                "anchors": [[round(f, 9), y] for f, y in anchors]}
        for section in sections:
            results[section].append(link)

    for section, links in results.items():
        path = ROOT / "sections" / section / "mileage.json"
        path.write_text(json.dumps({"version": 1, "sourceCommit": SOURCE_COMMIT,
                                    "links": links}, separators=(",", ":")) + "\n")
        print(f"{section}: {len(links)} links, {path.stat().st_size:,} bytes")


if __name__ == "__main__":
    build(Path(sys.argv[1]))
