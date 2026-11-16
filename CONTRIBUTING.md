# Contributing to SWOT Explorer

Thank you for your interest in SWOT Explorer. Bug reports, questions, ideas and code are all
welcome.

## Getting help and reporting problems

Please use [GitHub issues](https://github.com/Osman-Geomatics93/swot-explorer/issues) for bug
reports, questions and feature requests. Search the existing issues first.

A good bug report includes:

- the extension version (shown on `chrome://extensions`) and the browser;
- the product, the dates and the study area you used (a bounding box is enough);
- what you expected and what happened, with a screenshot if it helps;
- any error shown in the panel.

Never post your Earthdata password or token.

SWOT Explorer is maintained by one person in their spare time. Issues are usually answered within
two weeks. There is no guaranteed response time.

Problems with the data itself (for example a wrong water level in a SWOT product) should go to the
data provider: [PO.DAAC](https://podaac.jpl.nasa.gov/) for SWOT,
[DAHITI](https://dahiti.dgfi.tum.de/) or [Hydroweb](https://hydroweb.next.theia-land.fr/). If you
are not sure where a problem comes from, open an issue here.

## Setting up

You need a current [Node.js](https://nodejs.org/) LTS release and [pnpm](https://pnpm.io/) (the
project is developed with Node.js 24 and pnpm 10).

```sh
git clone https://github.com/Osman-Geomatics93/swot-explorer.git
cd swot-explorer
pnpm install
pnpm dev            # opens a browser with the extension and live reload
```

## Checks to run before a pull request

```sh
pnpm compile        # type-check
pnpm test           # unit tests
pnpm build          # production build
```

The same three checks run on every pull request.

### About the tests

The unit tests run offline. They use responses recorded from the live services, stored in
`tests/fixtures`.

Ten tests also need two real SWOT granules, which are too large to commit. These tests are skipped
when the files are missing. To run them, download the two files below with the extension
(**Download full files**) or with [Earthdata Search](https://search.earthdata.nasa.gov) and put
them in `tools/out/granules/`:

- `SWOT_L2_HR_LakeSP_Prior_057_499_AF_20261019T105441_20261019T111105_PID0_01.zip`
- `SWOT_L2_HR_RiverSP_Reach_058_318_AF_20261102T202820_20261102T204242_PID0_01.zip`

The scripts in `tools/` that start with `e2e-` drive a real browser against the live services.
They are not part of the automated checks.

## Guidelines for code

- **Keep the numerical code pure.** Search filtering, clipping, quality control, robust levels,
  storage and validation are plain functions with no browser or network calls (`src/qc`,
  `src/robust`, `src/timeseries`, `src/gauge`, `src/clip`, `src/search`). The interface in
  `src/features` calls them.
- **Add a test with every change to that code.** If the change depends on what a service returns,
  record a real response into `tests/fixtures` and test against it.
- **Say what was removed.** Any step that drops or changes observations must report how many rows
  it rejected and why, and exports must state the rule that was applied.
- **Write down what you learn about the services.** Behaviour of the NASA, DAHITI and Hydroweb
  APIs that is not in their documentation goes in [docs/api-notes.md](docs/api-notes.md).
- **Never commit credentials** or downloaded granules.

To add a reservoir to the built-in list, add an entry to `src/config/reservoirs.json`. The lake
identifier comes from the SWOT prior lake database; `tools/find_pld_ids.py` shows how the existing
entries were found.

## Pull requests

1. For anything larger than a small fix, open an issue first so the approach can be agreed.
2. Create a branch from `main`.
3. Make the change, add tests and run the three checks above.
4. Add a line to `CHANGELOG.md` under **Unreleased**.
5. Open the pull request and describe what changed and why.

Contributions are released under the project's [MIT license](LICENSE).

## Conduct

Please be respectful and constructive. Harassment or personal attacks are not accepted in issues,
pull requests or any other project space.
