"""Redraw the HRC (Hydraulics Research Center, Sudan) logo as clean SVG.

The only published versions are 61x60 px (HRC60.png) or that image upscaled, which are
too small for crisp extension icons. This redraws the same design as vectors:
a light-blue heater shield with a dark outline, "HRC" at the top, the outline of Sudan
(pre-2011 borders, as in the original) with the Nile, and "SUDAN" at the bottom.

Colours are sampled from HRC60.png. Geography comes from Natural Earth 1:50m
(public domain): Sudan + South Sudan merged, and the Nile river centrelines.

Usage: python tools/make_logo.py <natural-earth-dir>
Writes: assets/logo/hrc-full.svg, hrc-medium.svg, hrc-small.svg
"""

import json
import sys
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union

FILL = "#6bbce9"
STROKE = "#385f74"
INK = "#111111"
RIVER = "#eaf6fd"
FONT = "'Geist Variable', 'Geist', Arial, sans-serif"

OUT = Path(__file__).resolve().parent.parent / "assets" / "logo"

# Heater shield in a 128 x 128 box: flat top with rounded corners, straight sides, curved point.
SHIELD = "M14 6 H114 Q122 6 122 14 V62 C122 92 98 112 64 124 C30 112 6 92 6 62 V14 Q6 6 14 6 Z"


def load(path):
    return json.loads(Path(path).read_text(encoding="utf-8"))["features"]


def old_sudan(ne):
    feats = load(ne / "ne_50m_admin_0_countries.geojson")
    parts = [shape(f["geometry"]) for f in feats if f["properties"]["ADMIN"] in ("Sudan", "South Sudan")]
    return unary_union(parts)


def nile(ne, clip):
    feats = load(ne / "ne_50m_rivers_lake_centerlines.geojson")
    # Natural Earth names the branches in Arabic transliteration.
    names = {"Nile", "El Bahr el Abyad", "El Bahr el Azraq", "Bahr el Jebel", "Atbara"}
    lines = [shape(f["geometry"]) for f in feats if f["properties"].get("name") in names]
    return unary_union(lines).intersection(clip)


def projector(bounds, box):
    """Equirectangular with cos(lat) scaling, stretched to fill box = (x, y, w, h)."""
    import math

    w0, s0, e0, n0 = bounds
    k = math.cos(math.radians((s0 + n0) / 2))
    gw, gh = (e0 - w0) * k, n0 - s0
    x, y, w, h = box
    # Fill the box like the original artwork, which draws Sudan wider than true proportions.
    sx, sy = w / gw, h / gh
    return lambda lon, lat: (x + (lon - w0) * k * sx, y + (n0 - lat) * sy)


def path_of(geom, proj):
    def ring(coords, close):
        pts = [proj(*c[:2]) for c in coords]
        d = "M" + " L".join(f"{px:.2f} {py:.2f}" for px, py in pts)
        return d + (" Z" if close else "")

    t = geom.geom_type
    if t == "Polygon":
        return ring(geom.exterior.coords, True)
    if t == "MultiPolygon":
        return " ".join(ring(p.exterior.coords, True) for p in geom.geoms)
    if t == "LineString":
        return ring(geom.coords, False)
    if t in ("MultiLineString", "GeometryCollection"):
        return " ".join(path_of(g, proj) for g in geom.geoms if not g.is_empty)
    return ""


def svg(body, title):
    return (
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="128" height="128" role="img">\n'
        f"  <title>{title}</title>\n{body}\n</svg>\n"
    )


def shield(stroke_w):
    return f'  <path d="{SHIELD}" fill="{FILL}" stroke="{STROKE}" stroke-width="{stroke_w}" stroke-linejoin="round"/>'


def text(s, y, size, weight=800, spacing=0):
    return (
        f'  <text x="64" y="{y}" text-anchor="middle" font-family="{FONT}" font-size="{size}" '
        f'font-weight="{weight}" letter-spacing="{spacing}" fill="{INK}">{s}</text>'
    )


def main():
    ne = Path(sys.argv[1])
    country = old_sudan(ne).simplify(0.08, preserve_topology=True)
    rivers = nile(ne, old_sudan(ne).buffer(0.2)).simplify(0.05)
    OUT.mkdir(parents=True, exist_ok=True)

    def map_layer(box, outline_w, river_w):
        proj = projector(country.bounds, box)
        return "\n".join(
            [
                f'  <path d="{path_of(country, proj)}" fill="none" stroke="{STROKE}" stroke-width="{outline_w}" stroke-linejoin="round"/>',
                f'  <path d="{path_of(rivers, proj)}" fill="none" stroke="{RIVER}" stroke-width="{river_w}" stroke-linecap="round" stroke-linejoin="round"/>',
            ]
        )

    full = "\n".join([shield(3), text("HRC", 38, 30), map_layer((30, 44, 68, 40), 2, 1.6), text("SUDAN", 104, 15, 800, 1)])
    medium = "\n".join([shield(5), text("HRC", 50, 40), map_layer((28, 60, 72, 40), 3.5, 3)])
    small = "\n".join([shield(7), text("HRC", 80, 50, 900)])

    (OUT / "hrc-full.svg").write_text(svg(full, "Hydraulics Research Center, Sudan"), encoding="utf-8")
    (OUT / "hrc-medium.svg").write_text(svg(medium, "HRC"), encoding="utf-8")
    (OUT / "hrc-small.svg").write_text(svg(small, "HRC"), encoding="utf-8")
    print("wrote", ", ".join(p.name for p in sorted(OUT.glob("*.svg"))))


if __name__ == "__main__":
    main()
