"""Extract every LakeSP_obs piece linked to one PLD lake, for all passes.

SWOT can observe one reservoir as several pieces (obs features) per pass, each
with its own height. Hydrocron's PriorLake series aggregates them; this script
keeps them separate so a robust level can be computed and validated.

Usage:  python tools/lake_obs_pieces.py <lake_id> <pass> [<pass> ...]
        python tools/lake_obs_pieces.py 1720058403 318 499
Output: tools/out/obs_pieces_<lake_id>.json
"""

import json
import sys
from concurrent.futures import ThreadPoolExecutor

import requests

import find_pld_ids as f

FIELDS = ["obs_id", "lake_id", "time_str", "wse", "wse_u", "quality_f", "area_total", "area_tot_u", "dark_frac", "xovr_cal_q", "ice_clim_f", "n_overlap"]


def granule_urls(pass_num):
    items, headers = [], {"Client-Id": "swot-explorer-tools"}
    params = {
        "short_name": "SWOT_L2_HR_LakeSP_obs_D",
        "readable_granule_name": f"SWOT_L2_HR_LakeSP_Obs_???_{pass_num}_AF_*",
        "options[readable_granule_name][pattern]": "true",
        "page_size": 200,
        "sort_key": "start_date",
    }
    while True:
        resp = requests.get(f.CMR, params=params, headers=headers, timeout=60)
        resp.raise_for_status()
        items += resp.json()["items"]
        after = resp.headers.get("CMR-Search-After")
        if not after or len(items) >= int(resp.headers["CMR-Hits"]):
            break
        headers["CMR-Search-After"] = after
    return [
        rel["URL"]
        for it in items
        for rel in it["umm"]["RelatedUrls"]
        if rel.get("Type") == "GET DATA" and rel["URL"].endswith(".zip")
    ]


def pieces_in(zip_path, lake_id):
    out = []
    for attrs, geom in f.read_features(zip_path):
        linked = str(attrs.get("lake_id", "")).split(";")
        if lake_id not in linked:
            continue
        piece = {k: attrs.get(k) for k in FIELDS if k in attrs}
        piece["granule"] = zip_path.name
        piece["cycle"], piece["pass"] = zip_path.name.split("_")[5:7]
        if geom is not None and not geom.is_empty:
            c = geom.representative_point()
            piece["point"] = [round(c.x, 4), round(c.y, 4)]
            piece["bounds"] = [round(v, 4) for v in geom.bounds]
        out.append(piece)
    return out


def main():
    lake_id, passes = sys.argv[1], sys.argv[2:]
    token = f.get_token()
    urls = [u for p in passes for u in granule_urls(p)]
    print(f"{len(urls)} granules")

    def work(url):
        path = f.download(url, token)
        pieces = pieces_in(path, lake_id)
        path.unlink()  # ~10 MB each; keep only the extracted pieces
        return pieces

    with ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(work, urls))
    pieces = [p for r in results for p in r]
    out = f.OUT / f"obs_pieces_{lake_id}.json"
    out.write_text(json.dumps(pieces, indent=1, default=str), encoding="utf-8")
    print(f"{len(pieces)} pieces from {sum(1 for r in results if r)} granules -> {out}")


if __name__ == "__main__":
    main()
