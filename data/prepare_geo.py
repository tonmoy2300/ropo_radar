"""Download geoBoundaries BGD ADM2/ADM3 once, keep one district, simplify, rewind for D3.

Usage:  python data/prepare_geo.py [District]      (default: Rangpur)

Upazilas (ADM3) are selected by testing whether a representative interior point
lies inside the district (ADM2) polygon. Name matching is not safe: several
upazila names repeat across districts (e.g. two "Pirganj").

Source: geoBoundaries gbOpen (release 9469f09), BBS / OCHA ROAP, CC BY 3.0 IGO.
"""
import json
import sys
import urllib.request
from pathlib import Path

BASE = "https://github.com/wmgeolab/geoBoundaries/raw/9469f09/releaseData/gbOpen/BGD"
URLS = {
    "ADM2": f"{BASE}/ADM2/geoBoundaries-BGD-ADM2.geojson",
    "ADM3": f"{BASE}/ADM3/geoBoundaries-BGD-ADM3.geojson",
}
TOLERANCE = 0.0006  # degrees (~65 m) Douglas-Peucker
OUT = Path(__file__).resolve().parent


def fetch(level):
    cache = OUT / f".cache-BGD-{level}.geojson"
    if not cache.exists():
        print("downloading", URLS[level])
        with urllib.request.urlopen(URLS[level]) as r:
            cache.write_bytes(r.read())
    return json.loads(cache.read_text(encoding="utf-8"))


def polygons(geom):
    if geom["type"] == "Polygon":
        return [geom["coordinates"]]
    if geom["type"] == "MultiPolygon":
        return geom["coordinates"]
    return []


def point_in_ring(pt, ring):
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][:2]
        xj, yj = ring[j][:2]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / (yj - yi) + xi:
            inside = not inside
        j = i
    return inside


def point_in_geom(pt, geom):
    for poly in polygons(geom):
        if point_in_ring(pt, poly[0]) and not any(point_in_ring(pt, h) for h in poly[1:]):
            return True
    return False


def ring_area(ring):
    a = 0.0
    for i in range(len(ring) - 1):
        a += ring[i][0] * ring[i + 1][1] - ring[i + 1][0] * ring[i][1]
    return a / 2


def interior_point(geom):
    """Scanline through the largest polygon's vertical middle: midpoint of widest inside span."""
    poly = max(polygons(geom), key=lambda p: abs(ring_area(p[0])))
    ring = poly[0]
    ys = [p[1] for p in ring]
    best = None
    for k in range(1, 20):
        y = min(ys) + (max(ys) - min(ys)) * k / 20
        xs = []
        for i in range(len(ring) - 1):
            (x1, y1), (x2, y2) = ring[i][:2], ring[i + 1][:2]
            if (y1 > y) != (y2 > y):
                xs.append(x1 + (y - y1) * (x2 - x1) / (y2 - y1))
        xs.sort()
        for i in range(0, len(xs) - 1, 2):
            w = xs[i + 1] - xs[i]
            if best is None or w > best[0]:
                best = (w, ((xs[i] + xs[i + 1]) / 2, y))
    return best[1]


def dp(points, tol):
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0][:2], points[-1][:2]
    dx, dy = x2 - x1, y2 - y1
    norm = (dx * dx + dy * dy) ** 0.5 or 1e-12
    idx, dmax = 0, 0.0
    for i in range(1, len(points) - 1):
        px, py = points[i][:2]
        d = abs(dy * px - dx * py + x2 * y1 - y2 * x1) / norm
        if d > dmax:
            idx, dmax = i, d
    if dmax > tol:
        return dp(points[: idx + 1], tol)[:-1] + dp(points[idx:], tol)
    return [points[0], points[-1]]


def simplify_ring(ring, tol):
    # split closed ring in two halves so DP has distinct endpoints
    mid = len(ring) // 2
    a = dp(ring[: mid + 1], tol)
    b = dp(ring[mid:], tol)
    out = a[:-1] + b
    out = [[round(x, 5), round(y, 5)] for x, y, *_ in out]
    if out[0] != out[-1]:
        out.append(out[0])
    return out if len(out) >= 4 else None


def rewind_for_d3(poly):
    """D3 spherical convention: exterior rings clockwise, holes counter-clockwise."""
    out = []
    for k, ring in enumerate(poly):
        ccw = ring_area(ring) > 0
        want_ccw = k > 0
        out.append(ring if ccw == want_ccw else ring[::-1])
    return out


def clean(geom):
    polys = []
    for poly in polygons(geom):
        rings = [simplify_ring(r, TOLERANCE) for r in poly]
        if rings[0] is None:
            continue
        polys.append(rewind_for_d3([r for r in rings if r]))
    return {"type": "MultiPolygon", "coordinates": polys}


def main():
    district = sys.argv[1] if len(sys.argv) > 1 else "Rangpur"
    adm2 = fetch("ADM2")
    adm3 = fetch("ADM3")
    dist = next(f for f in adm2["features"] if f["properties"]["shapeName"] == district)
    feats = []
    for f in adm3["features"]:
        if point_in_geom(interior_point(f["geometry"]), dist["geometry"]):
            feats.append({
                "type": "Feature",
                "properties": {"name": f["properties"]["shapeName"], "id": f["properties"]["shapeID"]},
                "geometry": clean(f["geometry"]),
            })
    feats.sort(key=lambda f: f["properties"]["name"])
    slug = district.lower().replace(" ", "_")
    src = "geoBoundaries gbOpen BGD ADM3 (release 9469f09), BBS/OCHA ROAP, CC BY 3.0 IGO"
    (OUT / f"{slug}_upazilas.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "source": src, "district": district, "features": feats},
        separators=(",", ":")), encoding="utf-8")
    (OUT / f"{slug}_district.geojson").write_text(json.dumps(
        {"type": "FeatureCollection", "source": src.replace("ADM3", "ADM2"), "features": [
            {"type": "Feature", "properties": {"name": district}, "geometry": clean(dist["geometry"])}]},
        separators=(",", ":")), encoding="utf-8")
    print(district, len(feats), "upazilas:", ", ".join(f["properties"]["name"] for f in feats))


if __name__ == "__main__":
    main()
