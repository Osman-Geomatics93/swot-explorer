---
title: 'SWOT Explorer: a browser extension for searching, clipping and quality-controlling SWOT satellite hydrology data'
tags:
  - TypeScript
  - browser extension
  - SWOT
  - satellite altimetry
  - hydrology
  - reservoirs
  - remote sensing
authors:
  - name: Osman Osama Ahmed Ibrahim
    orcid: 0009-0003-2594-6310
    corresponding: true
    affiliation: 1
affiliations:
  - name: Hydraulics Research Center, Wad Madani, Gezira State, Sudan
    index: 1
date: 16 November 2026
bibliography: paper.bib
---

# Summary

The Surface Water and Ocean Topography (SWOT) satellite, launched in December 2022 by NASA and
CNES, measures the elevation and extent of rivers, lakes and reservoirs across most of the globe
[@fu2024; @biancamaria2016]. SWOT Explorer is an open-source extension for Google Chrome and
Microsoft Edge that takes a user from a polygon drawn on a map to a clipped SWOT dataset, or to a
quality-controlled time series of water level, area and storage change. It runs entirely in the
browser and needs no server, scripts or GIS software.

The extension keeps only the satellite passes that observe the study area, previews the measured
features on a map before anything is downloaded, clips and merges vector files, and applies one
documented quality rule to every output. It then grades how far each water level series can be
trusted and says so when it cannot. Users can compare SWOT with their own gauge readings and with
independent altimetry from DAHITI [@schwatke2015] and Hydroweb [@cretaux2011].

# Statement of need

SWOT's river and lake vector products [@riversp; @lakesp] are distributed by NASA's Physical
Oceanography Distributed Active Archive Center (PO.DAAC) as one zipped shapefile per satellite pass
and continent. This creates three practical problems for a user who studies one water body.

1. **Searches return passes that never see the study area.** The catalogue footprint of a
   continental file is a continent-wide box. For the Grand Ethiopian Renaissance Dam (GERD)
   reservoir in October 2025, the catalogue returned 27 lake granules. Only 5 of them were needed:
   4 were older reprocessed duplicates and the others came from passes that do not observe the
   reservoir.
2. **Files cannot be subset on the server.** At the time of writing, NASA's subsetting service
   does not cover the high-rate river and lake products, so each continental file must be
   downloaded, unzipped and clipped by the user.
3. **Quality information is easy to miss.** Features that were not observed carry fill values,
   reprocessing creates duplicate records, and quality flags and uncertainties must be applied by
   hand.

SWOT Explorer is for hydrologists, water managers and students who work with maps rather than
code. This includes users in transboundary basins, where in-situ records are sparse or are not
shared, and users without institutional computing resources.

Its main contribution is that it reports when a number should not be trusted. \autoref{fig:gerd}
shows the GERD record on 2 November 2026: 76 of 113 observations pass quality control, but
consecutive accepted levels still differ by a median of 6.74 m, so the extension grades the series
*unreliable*. The Roseires reservoir, about 100 km downstream, is graded *good*, with a median
change of about 0.26 m. A user who only applied the quality flags would treat both records in the
same way. Recorded data for both reservoirs are stored with the unit tests, which check the two
grades.

![SWOT Explorer showing the GERD reservoir. The map shows the water measured on one pass, clipped to the study area. The panel shows the water level history after quality control and the reliability grade. Basemap imagery: Esri, Maxar, Earthstar Geographics.\label{fig:gerd}](timeseries.jpg)

# State of the field

Several tools give access to SWOT hydrology data. NASA Earthdata Search [@earthdatasearch] finds
and downloads whole granules through a web interface. The PO.DAAC data subscriber
[@podaacsubscriber] and the earthaccess library [@earthaccess] automate downloads from the command
line or from Python. Hydrocron [@hydrocron] returns the time series of a known river reach, node
or lake without a file download, and the QSWOT plugin [@qswot] plots Hydrocron series for reaches
and lakes inside QGIS. DAHITI and Hydroweb publish water level series that their teams have
already processed, for a fixed list of targets.

None of the SWOT tools filters passes by their real footprint or clips files to a study area, and
none tells the user whether a series is consistent enough to use. Hydrocron also leaves fill
values, duplicate records and quality flags to the user.

SWOT Explorer builds on these services and does not replace them. It calls the Common Metadata
Repository, Hydrocron and the PO.DAAC archive directly. A separate tool was written, instead of a
contribution to earthaccess, Hydrocron or QSWOT, for two reasons. First, the target users do not
run Python or desktop GIS, and a browser extension needs no separate software to be installed.
Second, the missing functions (pass-aware search, clipping in the browser, reliability grading and
validation against gauges) are not data access. They form a separate layer on top of the existing
services.

# Software design

SWOT Explorer is a Manifest V3 browser extension of about 10,000 lines of TypeScript. It uses the
WXT framework [@wxt], React, MapLibre GL JS [@maplibre] and Turf.js [@turf]. Four design choices
shaped it.

- **No backend.** Every request goes from the user's browser to the data provider. This removes
  hosting costs and keeps credentials, study areas and results on the user's computer. The cost is
  that a file must still be transferred in full before it is clipped in the page.
- **A pure numerical core.** Search filtering, clipping, quality control, robust levels, storage
  change and validation are pure functions, separate from the interface. They are covered by 130
  unit tests. On a fresh copy of the repository, 120 of them run offline against responses
  recorded from the live services. The other 10 need two sample granules that are too large to
  store in the repository.
- **A stateless background worker.** The browser can stop an extension's service worker at any
  time, so the download queue keeps nothing in memory. The queue is a pure state machine. Each
  change is read, applied and written back to storage under a lock, and the worker is woken by
  download events, messages and an alarm.
- **Credentials that are not stored.** An Earthdata Login password is sent once to NASA's token
  endpoint and is then discarded. Only the token is kept, in the browser's local storage.

The scientific methods are described below.

**Pass-aware search.** For continental products the extension first queries the pixel cloud
collection [@pixc], whose tiles of about 64 km have accurate footprints. This gives the cycle and
pass pairs that cross the study area. The extension keeps only granules from those passes and
drops older reprocessed versions of the same granule.

**Quality control.** By default an observation is kept when its quality flag is 0 or 1 and its
elevation uncertainty is at most 0.10 m. Fill values are always rejected. The user can also keep
the rejected observations, marked as such, or switch the rule off. Every export states the rule
that was applied and the number of observations rejected for each reason.

**Reliability grade.** Each level series is graded from the absolute change between consecutive
accepted observations. A series is *good* when the median change is at most 0.5 m and the 90th
percentile is at most 2 m, *questionable* when the median is at most 2 m, and *unreliable*
otherwise. Series with fewer than five observations are not graded. The thresholds were set from
Nile reservoirs with well-behaved records and should be reviewed for other regions.

**Robust reservoir level.** SWOT may record one reservoir as several water bodies with different
heights in a single pass. For these cases the extension takes an area-weighted median of the
pieces, removes pieces further than three robust standard deviations from it, and flags isolated
spikes in time with a Hampel filter [@hampel1974].

**Storage change.** A Theil-Sen line [@sen1968] is fitted to area against level, using only passes
that observed the whole lake, and storage change is integrated from it. The fit needs at least
eight such passes and is reported as not physical when area does not grow with level.

**Validation.** Gauge readings are interpolated to each pass time, but only between readings that
are close together. The extension reports the median bias separately from the remaining error,
because SWOT and gauges usually use different vertical datums.

The current version has limits. Pixel cloud, raster and ocean products can be searched and
downloaded but are not clipped. River features follow the SWOT River Database [@altenau2021] and
lake features the SWOT prior lake database, so water bodies missing from these databases have no
ready time series.

# Research impact statement

<!-- BEFORE SUBMISSION: add specific, checkable evidence of research use here (studies, theses or
reports that used SWOT Explorer; users outside the author's group; issues or pull requests from
external users; Chrome Web Store user numbers). JOSS requires this evidence and does not accept
plans or expectations in its place. -->

SWOT Explorer was first released on 9 November 2026. It is published in the Chrome Web Store, and
each release is archived on Zenodo (https://doi.org/10.5281/zenodo.24144882). The evidence
available at this stage is the reproducible example in this paper and the readiness of the
software for use by others.

The GERD example shows that a screening step is needed before SWOT levels are used in water
balance or reservoir operation studies, even for observations with good quality flags. The
recorded GERD and Roseires data are in the repository, so the result can be checked without
network access. Ten lakes and reservoirs of the Nile basin, from Lake Victoria to Lake Nasser, are
built in and can be compared on one time axis. The quality control, robust level, storage and
validation routines are small, tested functions under the MIT license, so other groups can reuse
them or add the reservoirs of their own basin.

# AI usage disclosure

<!-- BEFORE SUBMISSION: confirm that this statement is complete and true. -->

Generative AI tools were used in this work. The author used Claude (Anthropic), through Claude
Code, during software development to help plan the implementation and to find and fix errors in
the code. Claude Opus 5.5 and Claude Fable 5 were used to draft this paper from the software's
source code, tests and documentation. The author made the design decisions, reviewed, edited and
validated all AI-assisted code and text, checked the numbers in this paper against the
repository's tests and recorded data, and takes full responsibility for the software and the
paper.

# Acknowledgements

The author thanks Karadeniz Technical University and the Hydraulics Research Center for their
support. SWOT data are provided by NASA and CNES through PO.DAAC. Independent altimetry is provided
by DAHITI (DGFI-TUM) and by Hydroweb (Theia), whose time series are specified by LEGOS and computed
by CLS on behalf of CNES. This work did not receive any specific grant from funding agencies in the
public, commercial or not-for-profit sectors.

# References
