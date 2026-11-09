"""Find SWOT Prior Lake Database (PLD) lake_ids for a list of dams.

For each dam:
  1. CMR: find recent SWOT_L2_HR_LakeSP_prior_D granules covering the dam.
  2. Download the granule zip (Earthdata bearer token from EDL_TOKEN).
  3. Read the shapefile and list PLD lakes near the dam (geometry or PLD
     centroid within RADIUS_KM), with name, GRanD reservoir id, type and area.
  4. Verify the best candidate with Hydrocron (no auth needed).

Usage:  python tools/find_pld_ids.py
Output: tools/out/pld_candidates.json  (all candidates, for review)

The token is read from the environment (or the Windows user environment) and
is never printed or written to disk.
"""

import json
import math
import os
import sys
import zipfile
from pathlib import Path

import requests
import shapefile  # pyshp
from shapely.geometry import Point, shape

CMR = "https://cmr.earthdata.nasa.gov/search/granules.umm_json"
HYDROCRON = "https://soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/timeseries"
COLLECTION = "SWOT_L2_HR_LakeSP_prior_D"
RADIUS_KM = 25
GRANULES_PER_DAM = 2

# Approximate dam locations (lat, lon). Candidates are searched within RADIUS_KM,
# so a few km of error is fine.
DAMS = {
    "Lake Victoria / Jinja (Uganda)": (0.444, 33.185),
    "GERD (Ethiopia)": (11.215, 35.093),
    "Tekeze (Ethiopia)": (13.348, 38.744),
    "Roseires Dam (Sudan)": (11.799, 34.387),
    "Sennar Dam (Sudan)": (13.547, 33.633),
    "Jebel Aulia Dam (Sudan)": (15.240, 32.490),
    "Upper Atbara and Setit Dam Complex (Sudan)": (14.230, 36.260),
    "Khashm El Girba Dam (Sudan)": (14.925, 35.900),
    "Merowe Dam (Sudan)": (18.668, 32.050),
    "High Aswan Dam (Egypt)": (23.970, 32.877),
}

TYPE_DIGIT = {"1": "river", "2": "lake", "3": "river-connected lake", "4": "dam/reservoir", "5": "no topology"}

OUT = Path(__file__).parent / "out"
CACHE = OUT / "granules"


def get_token():
    token = os.environ.get("EDL_TOKEN")
    if not token and sys.platform == "win32":
        import winreg

        try:
            with winreg.OpenKey(winreg.HKEY_CURRENT_USER, "Environment") as key:
                token = winreg.QueryValueEx(key, "EDL_TOKEN")[0]
        except OSError:
            token = None
    if not token:
        sys.exit("EDL_TOKEN is not set. Run: setx EDL_TOKEN \"<token>\" and reopen the terminal.")
    return token


def km_between(lat1, lon1, lat2, lon2):
    r = 6371.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * r * math.asin(math.sqrt(a))


def cmr_items(params):
    resp = requests.get(CMR, params=params, headers={"Client-Id": "swot-explorer-tools"}, timeout=60)
    resp.raise_for_status()
    return resp.json()["items"]


def covering_passes(lat, lon):
    """Passes that really observe the point.

    LakeSP footprints are continent-wide bounding boxes, so a point search on
    LakeSP matches passes that never see the dam. PIXC tiles are ~64 km, so
    they give the passes that actually cover it.
    """
    items = cmr_items(
        {"short_name": "SWOT_L2_HR_PIXC_D", "point": f"{lon},{lat}", "sort_key": "-start_date", "page_size": 60}
    )
    counts = {}
    for item in items:
        pass_num = item["umm"]["GranuleUR"].split("_")[5]  # SWOT_L2_HR_PIXC_<cycle>_<pass>_<tile>_...
        counts[pass_num] = counts.get(pass_num, 0) + 1
    return sorted(counts, key=counts.get, reverse=True)


def find_granules(lat, lon):
    urls = []
    for pass_num in covering_passes(lat, lon)[:GRANULES_PER_DAM]:
        items = cmr_items(
            {
                "short_name": COLLECTION,
                # CMR rejects passes[n][pass] without cycle[], so match the pass in the name.
                # One pass spans several continents; all these dams are in Africa (AF).
                "readable_granule_name": f"SWOT_L2_HR_LakeSP_Prior_???_{pass_num}_AF_*",
                "options[readable_granule_name][pattern]": "true",
                "sort_key": "-start_date",
                "page_size": 1,
            }
        )
        for item in items:
            for rel in item["umm"].get("RelatedUrls", []):
                if rel.get("Type") == "GET DATA" and rel["URL"].endswith(".zip"):
                    urls.append(rel["URL"])
    return urls


def download(url, token):
    CACHE.mkdir(parents=True, exist_ok=True)
    dest = CACHE / url.rsplit("/", 1)[1]
    if dest.exists() and zipfile.is_zipfile(dest):
        return dest
    # requests drops the Authorization header on cross-host redirects (S3), as required.
    with requests.get(url, headers={"Authorization": f"Bearer {token}"}, stream=True, timeout=300) as resp:
        resp.raise_for_status()
        if "html" in resp.headers.get("Content-Type", ""):
            sys.exit("Got an HTML page instead of data: the token is invalid or expired.")
        with open(dest, "wb") as fh:
            for chunk in resp.iter_content(1 << 20):
                fh.write(chunk)
    return dest


def read_features(zip_path):
    with zipfile.ZipFile(zip_path) as zf:
        shp_name = next(n for n in zf.namelist() if n.endswith(".shp"))
        base = shp_name[:-4]
        reader = shapefile.Reader(
            shp=zf.open(base + ".shp"), shx=zf.open(base + ".shx"), dbf=zf.open(base + ".dbf")
        )
        fields = [f[0] for f in reader.fields[1:]]
        for rec in reader.iterShapeRecords():
            attrs = dict(zip(fields, rec.record))
            geom = shape(rec.shape.__geo_interface__) if rec.shape.points else None
            yield attrs, geom


def candidates_near(zip_path, lat, lon):
    dam = Point(lon, lat)
    found = {}
    for attrs, geom in read_features(zip_path):
        lake_id = str(attrs.get("lake_id", "")).strip()
        if not lake_id:
            continue
        try:
            plat, plon = float(attrs.get("p_lat")), float(attrs.get("p_lon"))
            centroid_km = km_between(lat, lon, plat, plon)
        except (TypeError, ValueError):
            centroid_km = math.inf
        # ~0.01 deg is ~1.1 km at these latitudes
        geom_km = geom.distance(dam) * 111.0 if geom is not None and not geom.is_empty else math.inf
        dist = min(centroid_km, geom_km)
        if dist > RADIUS_KM:
            continue
        found[lake_id] = {
            "lake_id": lake_id,
            "lake_name": str(attrs.get("lake_name", "")).strip(),
            "p_res_id": attrs.get("p_res_id"),
            "type": TYPE_DIGIT.get(lake_id[-1], "?"),
            "p_ref_area_km2": attrs.get("p_ref_area"),
            "p_ref_wse_m": attrs.get("p_ref_wse"),
            "distance_km": round(dist, 1),
            "observed_in": zip_path.name,
        }
    return list(found.values())


def verify(lake_id):
    params = {
        "feature": "PriorLake",
        "feature_id": lake_id,
        "start_time": "2023-07-01T00:00:00Z",
        "end_time": "2030-01-01T00:00:00Z",
        "output": "csv",
        "fields": "lake_id,lake_name,time_str,wse,area_total",
        "collection_name": "SWOT_L2_HR_LakeSP_D",
    }
    resp = requests.get(HYDROCRON, params=params, timeout=120)
    if resp.status_code != 200:
        return {"ok": False, "detail": resp.text[:200]}
    body = resp.json()
    return {"ok": True, "hits": body.get("hits")}


def area_key(c):
    try:
        return float(c["p_ref_area_km2"])
    except (TypeError, ValueError):
        return -1.0


def main():
    token = get_token()
    results = {}
    for dam, (lat, lon) in DAMS.items():
        print(f"\n== {dam}")
        cands = {}
        for url in find_granules(lat, lon):
            path = download(url, token)
            for c in candidates_near(path, lat, lon):
                cands.setdefault(c["lake_id"], c)
        ranked = sorted(cands.values(), key=area_key, reverse=True)
        for c in ranked[:3]:
            c["hydrocron"] = verify(c["lake_id"])
        for c in ranked[:6]:
            print(
                f"  {c['lake_id']}  {c['lake_name'][:40]:40}  type={c['type']:<20}"
                f" area={c['p_ref_area_km2']}  grand={c['p_res_id']}  dist={c['distance_km']}km"
                f"  hydrocron={c.get('hydrocron', {}).get('hits', '-')}"
            )
        results[dam] = {"lat": lat, "lon": lon, "candidates": ranked}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "pld_candidates.json").write_text(json.dumps(results, indent=2, default=str), encoding="utf-8")
    print(f"\nSaved {OUT / 'pld_candidates.json'}")


if __name__ == "__main__":
    main()
