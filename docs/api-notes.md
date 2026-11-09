# API spike notes (Phase 1, Task 1)

Verified 2026-11-07 with curl. Test area: GERD / Roseires, bbox `34.2,10.5,35.6,12.0` (W,S,E,N).

## 1. CMR collections — CONFIRMED

`GET https://cmr.earthdata.nasa.gov/search/collections.umm_json?provider=POCLOUD&keyword=SWOT&page_size=200`

- Use `collections.umm_json` (field `ShortName`). `collections.json` has no `short_name` field (only `entry_id` = `<short_name>_<version>`).
- Version D and Version C (`_2.0`) are both live. Version D short names relevant to the extension:

| Product | Version D short name | Notes |
|---|---|---|
| River single-pass (reach) | `SWOT_L2_HR_RiverSP_reach_D` | split collection, preferred |
| River single-pass (node) | `SWOT_L2_HR_RiverSP_node_D` | |
| River single-pass (parent) | `SWOT_L2_HR_RiverSP_D` | |
| River averaged | `SWOT_L2_HR_RiverAvg_D` | |
| Lake single-pass (prior) | `SWOT_L2_HR_LakeSP_prior_D` | PLD lakes, best for reservoirs |
| Lake single-pass (obs / unassigned) | `SWOT_L2_HR_LakeSP_obs_D`, `SWOT_L2_HR_LakeSP_unassigned_D` | |
| Lake single-pass (parent) | `SWOT_L2_HR_LakeSP_D` | |
| Lake averaged | `SWOT_L2_HR_LakeAvg_D` | |
| Pixel cloud | `SWOT_L2_HR_PIXC_D`, `SWOT_L2_HR_PIXCVec_D` | large files |
| Raster | `SWOT_L2_HR_Raster_100m_D`, `SWOT_L2_HR_Raster_250m_D` (+ parent `SWOT_L2_HR_Raster_D`) | |
| LR SSH | `SWOT_L2_LR_SSH_D`, `_BASIC_D`, `_EXPERT_D`, `_UNSMOOTHED_D`, `_WINDWAVE_D` | **uppercase** suffixes |
| LR pre-cal SSH | `SWOT_L2_LR_PreCalSSH_*_D` | |
| Nadir altimeter | `SWOT_L2_NALT_{GDR,IGDR,OGDR}_*_D` | |
| Discharge (L4) | `SWOT_L4_HR_DAWG_SOS_DISCHARGE_V3` | |
| Prior Lake DB | `SWOT_LAKEDATABASE_{BASIN,CAL,NOM}_2.02` | PLD source (v2 click-to-select) |

Plan correction: LR SSH names are `_BASIC_D` etc. (uppercase), and River/Lake SP have split sub-collections.

## 2. CMR granule search — CONFIRMED

```
GET https://cmr.earthdata.nasa.gov/search/granules.umm_json
  ?short_name=SWOT_L2_HR_LakeSP_prior_D
  &bounding_box=34.2,10.5,35.6,12.0
  &temporal=2025-01-01T00:00:00Z,2025-12-31T23:59:59Z
  &page_size=3
```
- Response headers: `cmr-hits: 273`, `cmr-search-after: ["pocloud",1736822947875,4077552958]`.
- Paging: resend the same query with request header `CMR-Search-After: <value>` → next page. Works.
- `cycle[]=26` → 2 hits; `cycle[]=26&passes[0][pass]=499` → 1 hit. **SWOT track params work.**
- Fallback also works: `readable_granule_name=*_026_499_*&options[readable_granule_name][pattern]=true`.
- curl needs `-g` (brackets); in JS use `URLSearchParams` (encodes `[]` — CMR accepts both).
- GranuleUR format: `SWOT_L2_HR_LakeSP_Prior_<cycle>_<pass>_<continent>_<start>_<end>_<crid>_<counter>_swot`.

### RelatedUrls
Each granule has several URLs; only use `Type == "GET DATA"` (HTTPS):
- `GET DATA` → `https://archive.swot.podaac.earthdata.nasa.gov/podaac-swot-ops-cumulus-protected/SWOT_L2_HR_LakeSP_D/<name>.zip`
- `GET DATA VIA DIRECT ACCESS` → `s3://` (AWS us-west-2 only, ignore)
- `EXTENDED METADATA` → `.log`, `.met.json`, `.rc.xml`, `.iso.xml` (ignore)
- `VIEW RELATED INFORMATION` → s3credentials (ignore)

Note: archive path uses the **parent** collection folder (`SWOT_L2_HR_LakeSP_D`) even for `_prior_D` granules.

### Size and footprint
- `DataGranule.ArchiveAndDistributionInformation[]` has one entry per file; take the one matching the `.zip` (example: 12,477,656 bytes ≈ 11.9 MB).
- LakeSP footprint is `Geometry.BoundingRectangles` (not GPolygons). Client must handle **both** BoundingRectangles and GPolygons.

## 3. Hydrocron — CONFIRMED

```
GET https://soto.podaac.earthdatacloud.nasa.gov/hydrocron/v1/timeseries
  ?feature=Reach&feature_id=63470800171
  &start_time=2025-01-01T00:00:00Z&end_time=2025-03-01T00:00:00Z
  &output=csv&fields=reach_id,time_str,wse,width
  &collection_name=SWOT_L2_HR_RiverSP_D
```
Response (HTTP 200):
```json
{"status":"200 OK","time":66.894,"hits":6,
 "results":{"csv":"reach_id,time_str,wse,width,wse_units,width_units\n63470800171,2025-01-07T09:50:03Z,493.1251,1002.014421,m,m\n...","geojson":{}}}
```
- `collection_name=SWOT_L2_HR_RiverSP_D` works → Version D supported.
- Units columns (`wse_units`, `width_units`) are appended automatically.
- No API key needed for light use.
- TODO: confirm lake equivalent (`feature=PriorLake`, `collection_name=SWOT_L2_HR_LakeSP_D`) once we have a GERD PLD lake_id.

## 4. Feature Translation Service — PARTIAL

- Rivers: `GET https://fts.podaac.earthdata.nasa.gov/v1/rivers/Blue%20Nile?page_size=3` → works. Returns `hits` (8829 for "Blue Nile", fuzzy match), per-reach `reach_id`, `x`,`y`, `river_name`, `wse`, `width`, `swot_orbit`, etc. HTTP status is `206 PARTIAL CONTENT` when paged — treat 200 and 206 as success.
- Lakes: no FTS endpoint (`/v1/lakes/...` → 403 "Missing Authentication Token" = route does not exist). **Lake name/ID lookup needs another source** (see open items).

## 5. Download auth — PARTIAL

- Unauthenticated GET of the archive URL → `302` to `https://urs.earthdata.nasa.gov/oauth/authorize?client_id=...` (TEA OAuth flow, as expected).
- TODO (needs user's EDL token / logged-in browser):
  - (a) Chrome logged into URS → paste URL → downloads?
  - (b) `curl -L -H "Authorization: Bearer $EDL_TOKEN" -o test.zip <URL>` → valid zip?
  - (c) `chrome.downloads.download({url, headers:[Authorization]})` — test in the extension (Task 1.8).

- (b) CONFIRMED: `Authorization: Bearer <EDL token>` + follow redirects downloads the real zip (Python `requests`, which drops the header on the cross-host S3 redirect).

## 6. Finding which passes cover a place — IMPORTANT

- LakeSP / RiverSP granules are continent-wide passes; their footprint is a huge `BoundingRectangles`, so `point=` / `bounding_box=` on LakeSP matches passes that never observe the place.
- Use `SWOT_L2_HR_PIXC_D` (~64 km tiles) with `point=`/`polygon=` to get the passes that really cover it, then fetch LakeSP/RiverSP granules for those passes.
- `passes[0][pass]` is rejected (HTTP 400) unless `cycle[]` is also given. Use
  `readable_granule_name=SWOT_L2_HR_LakeSP_Prior_???_<pass>_AF_*&options[readable_granule_name][pattern]=true`.
- A pass spans several continents (`AF`, `SI`, `EU`, ...); filter by the continent code.

## 7. PLD lake IDs — DONE

Result in `src/config/reservoirs.json`; method in `tools/find_pld_ids.py`.
- LakeSP_prior attributes used: `lake_id`, `lake_name`, `p_res_id` (GRanD id), `p_lat`/`p_lon`, `p_ref_area`, `wse`, `area_total`.
- Fill value `-999999999999` when a prior lake is in the pass but not observed.
- Hydrocron `feature=PriorLake&collection_name=SWOT_L2_HR_LakeSP_D` CONFIRMED (112–405 hits per reservoir); `lake_name` is a valid field.

## 8. Harmony (server-side clipping) — CHECKED

`GET https://harmony.earthdata.nasa.gov/capabilities?shortName=<sn>` (bearer token):
- `SWOT_L2_LR_SSH_*_D`: `podaac/l2-subsetter` → bbox, **shape (polygon)**, temporal, variable subsetting, NetCDF-4 output.
- All HR products (RiverSP, LakeSP, PIXC, Raster): **no Harmony service** → clip client-side (vector) or select by tile (PIXC/Raster).

## 9. Hydrocron response details (found while recording test fixtures)

- `Accept: text/csv` must be sent **without** `output=`; otherwise HTTP 400 "Invalid combination of Accept header and output request parameter".
- With `Accept: text/csv` the body is a **JSON-encoded string** (`"lake_id,...\n..."`), so `JSON.parse` it first.
- Rows can be **duplicated** (same `time_str`, e.g. GERD 2023-08-08T01:03:22Z). De-duplicate on (`feature_id`, `time_str`).

## 10. GERD (1720058403) — data quality warning

- ID is correct: in LakeSP_obs (pass 318, 2026-11-02) every observed piece of the reservoir links to `lake_id` 1720058403.
- But the reservoir is observed as several pieces with inconsistent heights in the same pass:
  690 km² @ 605.7 m (q=1, wse_u 0.047), 174 km² at the dam @ 611.6 m (q=1, wse_u 0.042), and a 2.4 km² piece @ 538.2 m (q=1, wse_u 0.043).
- The PriorLake aggregate in Hydrocron therefore scatters by ±15 m between passes, with no visible fill/release cycle, while Roseires is smooth (median 488.3 m).
- The 538 m piece passes the QC rule (flag 1, wse_u 0.043), so the flag + wse_u rule alone does not catch this. GERD needs observation-level (LakeSP_obs) processing and/or an outlier rule.

## 11. Authenticated download path from a browser

- `GET archive.swot.podaac.earthdata.nasa.gov/...zip` with `Authorization: Bearer <token>` → **303** to
  `https://d176wrl3f7yqfo.cloudfront.net/...?A-userid=…&Expires=…&Signature=…&Key-Pair-Id=…` → 200 `application/zip`.
- CloudFront sends **no CORS headers**, so the extension needs `https://d176wrl3f7yqfo.cloudfront.net/*` in
  `host_permissions`. If NASA changes the CDN host, fetches fail with a network/CORS error; `fetchPieces.ts`
  reports this as `DownloadHostError`.
- LakeSP_obs AF granules are ~10 MB each (GERD passes 318 + 499: 117 granules, 1.17 GB, 2023-08 → 2026-11).

## 12. Robust mode validation (GERD)

Real pieces (`tests/fixtures/obs_pieces_gerd.json`): 1375 pieces, 117 granules, 14 reprocessed duplicates.
Even restricting to one pass and to pieces ≥ 300 km² with wse_u ≤ 0.05 m, the level jumps a median 7.2 m
(max 18.5 m) between 21-day cycles, including dry-season months. Robust aggregation cannot fix this →
graded "unreliable". Calibration of the grade on Hydrocron + QC: Victoria, Roseires, Sennar, Aswan have
median consecutive jumps ≤ 0.26 m and p90 ≤ 1 m.

## 13. Granule search per product family (verified live over GERD, Oct 2025)

| Family | CMR footprint | Correct filter | Raw → kept |
|---|---|---|---|
| RiverSP / LakeSP (continental) | continent-wide box | cycle/pass pairs whose PIXC tiles touch the area | 27 → 5 (+4 duplicates) |
| RiverAvg / LakeAvg | continent-wide box, per cycle + basin | none needed | 4 → 4 |
| PIXC / PIXCVec | accurate ~64 km box | footprint ∩ area | 17 → 17 (4.5 GB) |
| Raster 100/250 m | accurate, but scenes near the antimeridian get W-180 E180 S-90 N90 | pass pairs + footprint ∩ area | 25 → 4 (20 Pacific scenes) |
| LR SSH | GPolygons (real swath) | footprint ∩ area | 8 → 7 (1 duplicate) |

- Raster granule names: `SWOT_L2_HR_Raster_100m_UTM36P_N_x_x_x_<cycle>_<pass>_<scene>F_...`; archive folder is `SWOT_L2_HR_Raster_D` for both resolutions.
- Avg names: `SWOT_L2_HR_RiverAvg_<cycle>_<continent>_<basin>_<start>_<end>_...` (no pass).
- Python clip script verified on `Raster_100m ... 040_318_068F` (37 MB): crop + mask to a 0.3°×0.35° box over GERD → 331×389 grid, all valid cells inside the box.
